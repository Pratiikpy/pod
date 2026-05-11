/**
 * Real testnet trade with proper API key flow:
 *  - Sign with the user's main wallet private key (owns the account)
 *  - Pass the registered API key NAME in X-API-Key header
 */

import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../../../.env') });

import { SoDEX } from '../src/index.js';
import type { Hex } from 'viem';

async function main() {
  const pk = process.env['SODEX_PRIVATE_KEY'] as Hex | undefined;
  const apiKeyName = process.env['SODEX_API_KEY_NAME'];
  if (!pk) throw new Error('SODEX_PRIVATE_KEY missing');
  if (!apiKeyName) throw new Error('SODEX_API_KEY_NAME missing');

  const sdk = SoDEX.fromPrivateKey(pk, 'testnet', apiKeyName);
  const addr = sdk.client.signerAddress;
  console.log(`🔑 Signer: ${addr}`);
  console.log(`🪪 API key name: ${apiKeyName}\n`);

  const stateResp = (await sdk.spot.accountState(addr)) as {
    data: { aid: number; B?: Array<{ a: string; t: string }> };
  };
  const accountID = stateResp.data.aid;
  const bal = stateResp.data.B?.find((b) => b.a === 'vUSDC')?.t ?? '0';
  console.log(`📋 Account: aid=${accountID}, vUSDC=${bal}\n`);

  // Pick BTC/USDC and place a far-below-market resting limit
  const symbolsResp = (await sdk.spot.symbols()) as {
    data: Array<{
      id: number;
      name: string;
      displayName?: string;
      status: string;
      quoteCoin: string;
      tickSize?: string;
      stepSize?: string;
      minQuantity?: string;
      minNotional?: string;
    }>;
  };
  // Try several pairs in priority order — some are in cancel-only mode
  const candidates = ['SOSO/USDC', 'ETH/USDC', 'SOL/USDC', 'BTC/USDC'];
  let target: typeof symbolsResp.data[number] | undefined;
  for (const name of candidates) {
    target = symbolsResp.data.find(
      (s) => s.status === 'TRADING' && (s.displayName ?? '') === name,
    );
    if (target) {
      console.log(`✅ Picked ${name} (id=${target.id})`);
      break;
    }
  }
  if (!target) {
    console.log('❌ no candidate pair found');
    return;
  }

  const ob = (await sdk.spot.orderbook(target.name, 5)) as {
    data: { bids?: Array<[string, string]>; asks?: Array<[string, string]> };
  };
  const bid = Number(ob.data.bids?.[0]?.[0] ?? '90000');

  const tick = Number(target.tickSize ?? '1');
  const tickDecimals = Math.max(0, -Math.floor(Math.log10(tick)));
  const limitPrice = (Math.floor((bid * 0.7) / tick) * tick).toFixed(tickDecimals);

  const minNotional = Number(target.minNotional ?? '5');
  const step = Number(target.stepSize ?? '0.00001');
  const stepDecimals = Math.max(0, -Math.floor(Math.log10(step)));
  const requiredQty = Math.max(
    Number(target.minQuantity ?? step),
    (minNotional + 0.5) / Number(limitPrice),
  );
  const qty = Math.ceil(requiredQty / step) * step;
  const qtyStr = qty.toFixed(stepDecimals);

  console.log(`🎯 LIMIT BUY ${qtyStr} BTC @ $${limitPrice} (notional ≈ $${(qty * Number(limitPrice)).toFixed(2)})\n`);

  const result = await sdk.spot.batchNewOrder({
    accountID,
    orders: [
      {
        symbolID: target.id,
        clOrdID: `pod-${Date.now()}`,
        side: 'BUY',
        type: 'LIMIT',
        timeInForce: 'GTC',
        price: limitPrice,
        quantity: qtyStr,
      },
    ],
  });

  console.log('🚀 Server response:');
  console.log(JSON.stringify(result, null, 2));

  // Show open orders after
  await new Promise((r) => setTimeout(r, 1500));
  const open = await sdk.spot.openOrders(addr);
  console.log('\n📋 Open orders:');
  console.log(JSON.stringify(open, null, 2).slice(0, 600));
}

main().catch((err) => {
  console.error('💥', err);
  process.exit(1);
});
