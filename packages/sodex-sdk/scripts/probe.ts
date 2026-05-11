/**
 * Live probe of SoDEX testnet — what does our wallet see?
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
  if (!pk) throw new Error('SODEX_PRIVATE_KEY missing');

  const sdk = SoDEX.fromPrivateKey(pk, 'testnet');
  const addr = sdk.client.signerAddress;
  console.log(`🔑 Address: ${addr}\n`);

  const safe = async <T>(label: string, fn: () => Promise<T>) => {
    try {
      const out = await fn();
      const summary = JSON.stringify(out).slice(0, 600);
      console.log(`✅ ${label}\n   ${summary}\n`);
      return out;
    } catch (e) {
      console.log(`❌ ${label}\n   ${(e as Error).message}\n`);
      return null;
    }
  };

  await safe('Spot symbols', () => sdk.spot.symbols());
  await safe('Perps symbols', () => sdk.perps.symbols());
  await safe('Spot tickers', () => sdk.spot.tickers());
  await safe('Spot account state', () => sdk.spot.accountState(addr));
  await safe('Spot balances', () => sdk.spot.balances(addr));
  await safe('Spot open orders', () => sdk.spot.openOrders(addr));
  await safe('Perps balances', () => sdk.perps.balances(addr));
  await safe('Perps positions', () => sdk.perps.positions(addr));
}

main().catch((err) => {
  console.error('💥 probe failed:', err);
  process.exit(1);
});
