import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../../../.env') });

import { SoDEX } from '../src/index.js';
import type { Hex } from 'viem';

interface PerpsSymbolInfo {
  id: number;
  name: string;
  baseCoin: string;
  quoteCoin: string;
  status?: string;
  tickSize?: string;
  stepSize?: string;
}

async function main() {
  const pk = process.env['SODEX_PRIVATE_KEY'] as Hex | undefined;
  if (!pk) throw new Error('SODEX_PRIVATE_KEY missing');
  const sdk = SoDEX.fromPrivateKey(pk, 'testnet');
  const addr = sdk.client.signerAddress;

  // For perps trading, the user needs a separate perps account.
  // The aid here is the spot aid; perps may require its own.
  const stateResp = (await sdk.spot.accountState(addr)) as { data: { aid: number } };
  const accountID = stateResp.data.aid;
  console.log(`👛 Spot account ID: ${accountID}`);

  const symbolsResp = (await sdk.perps.symbols()) as { data: PerpsSymbolInfo[] };
  const btc = symbolsResp.data.find((s) => s.name === 'BTC-USD');
  if (!btc) {
    console.log('❌ BTC-USD not in perps symbols');
    return;
  }
  console.log(`🎯 Placing GTC limit BTC-USD @ $1000 buy 0.001 (won't fill)\n`);

  // SoDEX perps newOrder shape (from sodex-go-sdk/perps/types):
  // RawOrder has clOrdID, modifier, side, type, timeInForce, price, quantity, etc.
  // Wire shape uses int enums (1=BUY, 1=LIMIT, 1=GTC, 1=LONG)
  const result = await sdk.perps.newOrder({
    accountID,
    symbolID: btc.id,
    orders: [
      {
        clOrdID: `pod-${Date.now()}`,
        modifier: 1, // NORMAL
        side: 1, // BUY
        type: 1, // LIMIT
        timeInForce: 1, // GTC
        price: '1000',
        quantity: '0.02', // 0.02 × $1000 = $20 notional, above min
        reduceOnly: false,
        positionSide: 1, // BOTH — used when account is in one-way mode
      },
    ],
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('💥 perps trade failed:', err);
  process.exit(1);
});
