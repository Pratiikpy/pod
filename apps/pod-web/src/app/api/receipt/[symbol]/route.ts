import { NextResponse } from 'next/server';
import { getLatestReceipt } from '@/lib/db';

export const revalidate = 300;

/**
 * Latest on-chain-anchored receipt for an asset: the reasoning hash written to
 * the ReasoningLogger, the tx that wrote it, and the explorer link. A verifier
 * can recompute the hash from the public score payload and confirm it matches.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await params;
  const asset = symbol.toUpperCase();
  const receipt = await getLatestReceipt(asset);
  if (!receipt) {
    return NextResponse.json({ asset, receipt: null, note: 'No on-chain receipt yet.' });
  }
  return NextResponse.json({
    asset,
    receipt: {
      podScore: receipt.podScore,
      reasoningHash: receipt.reasoningHash,
      onchainTx: receipt.onchainTx,
      onchainEntryId: receipt.onchainEntryId,
      explorerUrl: `https://test-scan.valuechain.xyz/tx/${receipt.onchainTx}`,
      contract: process.env['REASONING_LOGGER_ADDRESS'] ?? '0x0723dc7D775864ec08797e84d2A5E068876B221B',
      generatedAt: receipt.generatedAt,
    },
  });
}
