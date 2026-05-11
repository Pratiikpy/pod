/**
 * Live trade — place a real market order on SoDEX testnet.
 * This proves the entire signed-write flow works end-to-end.
 */

import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../../../.env') });

import { SoDEX } from '../src/index.js';
import type { Hex } from 'viem';

interface SymbolInfo {
  id: number;
  name: string;
  displayName?: string;
  baseCoin: string;
  quoteCoin: string;
  status: string;
  minNotional?: string;
  marketMinQuantity?: string;
}

async function main() {
  const pk = process.env['SODEX_PRIVATE_KEY'] as Hex | undefined;
  if (!pk) throw new Error('SODEX_PRIVATE_KEY missing');

  const sdk = SoDEX.fromPrivateKey(pk, 'testnet');
  const addr = sdk.client.signerAddress;

  // 1. Resolve our account ID
  const stateResp = (await sdk.spot.accountState(addr)) as {
    data: { aid: number; B?: Array<{ i: number; a: string; t: string; l: string }> };
  };
  const accountID = stateResp.data.aid;
  const usdcBalance = stateResp.data.B?.find((b) => b.a === 'vUSDC')?.t ?? '0';
  console.log(`👛 Account ID: ${accountID}`);
  console.log(`💰 vUSDC balance: ${usdcBalance}\n`);

  // 2. Find an active spot pair to trade against vUSDC
  const symbolsResp = (await sdk.spot.symbols()) as { data: SymbolInfo[] };
  const tradable = symbolsResp.data.filter(
    (s) => s.quoteCoin === 'vUSDC' && s.status === 'TRADING',
  );
  console.log('📊 First 5 tradable USDC pairs:');
  tradable.slice(0, 5).forEach((s) =>
    console.log(`   ${s.id.toString().padStart(3)}  ${s.displayName ?? s.name}  (min ${s.minNotional} USDC)`),
  );
  console.log('');

  // Pick BTC/USDC if available, else first pair, with min notional ≤ $10
  const target =
    tradable.find((s) => (s.displayName ?? '').includes('BTC')) ??
    tradable.find((s) => Number(s.minNotional ?? '0') <= 10) ??
    tradable[0];
  if (!target) {
    throw new Error('No tradable USDC pair found');
  }
  // Use 2× min notional for safety
  const fundsToUse = String(Math.max(5, Number(target.minNotional ?? '5')) + 1);
  console.log(`🎯 Buying ${target.displayName ?? target.name} (id=${target.id}) with $${fundsToUse} vUSDC market order\n`);

  // 3. Place a market buy with funds=$2
  const clOrdID = `pod-${Date.now()}`;
  const orderResp = await sdk.spot.batchNewOrder({
    accountID,
    orders: [
      {
        symbolID: target.id,
        clOrdID,
        side: 'BUY',
        type: 'MARKET',
        timeInForce: 'IOC',
        funds: fundsToUse,
      },
    ],
  });
  console.log('🚀 Order submitted:');
  console.log('   ', JSON.stringify(orderResp, null, 2));

  // 4. Sleep briefly + check open orders
  await new Promise((r) => setTimeout(r, 1500));
  console.log('\n📋 Open orders after submission:');
  const openOrders = await sdk.spot.openOrders(addr);
  console.log('   ', JSON.stringify(openOrders, null, 2).slice(0, 500));

  // 5. Final balances
  console.log('\n💰 Final balances:');
  const finalBalances = await sdk.spot.balances(addr);
  console.log('   ', JSON.stringify(finalBalances, null, 2).slice(0, 500));
}

main().catch((err) => {
  console.error('💥 place-order failed:', err);
  process.exit(1);
});
