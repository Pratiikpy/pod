/**
 * One-off: withdraw WSOSO from SoDEX testnet spot ledger to the EVM wallet
 * as native SOSO (the ValueChain gas token). Once this lands we can deploy
 * the PodScoreReceipt contracts.
 *
 * Run:
 *   pnpm tsx scripts/withdraw-wsoso-to-evm.ts
 */

import { SoDEX } from '@pod/sodex-sdk';
import { createPublicClient, http, formatEther, type Hex } from 'viem';

const DEPLOYER_KEY = process.env['DEPLOYER_PRIVATE_KEY'] as Hex;
const RPC = process.env['VALUECHAIN_TESTNET_RPC']!;
const NETWORK = (process.env['SODEX_NETWORK'] ?? 'testnet') as 'testnet' | 'mainnet';

if (!DEPLOYER_KEY) throw new Error('DEPLOYER_PRIVATE_KEY missing');
if (!RPC) throw new Error('VALUECHAIN_TESTNET_RPC missing');

const sdk = SoDEX.fromPrivateKey(DEPLOYER_KEY, NETWORK);
const ADDR = sdk.client.signerAddress;

const evm = createPublicClient({ transport: http(RPC) });

async function nativeBalance(): Promise<bigint> {
  return await evm.getBalance({ address: ADDR });
}

async function spotState(): Promise<{ aid: number; wsoso: string }> {
  const r = await sdk.client.get<{
    data: { aid: number; B: Array<{ a: string; t: string }> };
  }>(`/api/v1/spot/accounts/${ADDR}/state`);
  const wsoso = r.data.B.find((b) => b.a === 'WSOSO')?.t ?? '0';
  return { aid: r.data.aid, wsoso };
}

async function main() {
  console.log('Deployer EVM:', ADDR);
  const before = await nativeBalance();
  const { aid, wsoso } = await spotState();
  console.log('Spot account ID:', aid);
  console.log('Spot WSOSO balance:', wsoso);
  console.log('Native SOSO before:', formatEther(before));

  const AMOUNT = '10'; // 10 WSOSO — enough for many deploys
  if (Number(wsoso) < Number(AMOUNT)) {
    throw new Error(`Need ${AMOUNT} WSOSO in spot, only ${wsoso} available`);
  }

  console.log(`\nWithdrawing ${AMOUNT} WSOSO to EVM (toAccountID=999, type=EVM_WITHDRAW)…`);
  // SDK types say id: string, but the server wants uint64. Pass as number,
  // bypass the TS type via `as any`.
  const res = await sdk.spot.transferAsset({
    id: Date.now() as unknown as string,
    fromAccountID: aid,
    toAccountID: 999,
    coinID: 4, // WSOSO
    amount: AMOUNT,
    type: 2 as unknown as string,
  });
  console.log('Transfer response:', JSON.stringify(res));

  // Poll for native balance to land
  console.log('\nPolling native balance for up to 2 minutes…');
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const cur = await nativeBalance();
    if (cur > before) {
      console.log(`✓ Native SOSO landed! new balance = ${formatEther(cur)}`);
      return;
    }
    process.stdout.write('.');
  }
  console.log('\n⚠ Native balance unchanged after 2min — check SoDEX explorer.');
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
