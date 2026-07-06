import { NextResponse } from 'next/server';
import { fetchAllBubbleData } from '@/lib/bubble-data';
import { logScoreOnChain } from '@/lib/onchain-log';
import { recordScore } from '@/lib/db';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * Daily signal job. Generates the ten POD Scores (from the shared cache),
 * anchors each one on-chain in the ReasoningLogger, and persists it to the
 * score-history database. This is what builds the real 30-day trace, the
 * verifiable on-chain receipts, and the leaderboard trend over time.
 *
 * `?anchor=0` skips the on-chain writes (persist only) for a cheaper run.
 */
export async function GET(request: Request) {
  const cronSecret = process.env['CRON_SECRET'];
  if (cronSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return new NextResponse('Unauthorized', { status: 401 });
    }
  }

  const anchor = new URL(request.url).searchParams.get('anchor') !== '0';
  const bubbles = await fetchAllBubbleData();

  const results: Array<{
    asset: string;
    podScore: number;
    persisted: boolean;
    onchainTx?: string;
    entryId?: number;
  }> = [];

  for (const b of bubbles) {
    const scoreForLog = {
      asset: b.asset,
      podScore: b.score,
      compositeZ: b.z,
      generatedAt: b.generatedAt,
      contributions: b.contributions,
    };

    const onchain = anchor ? await logScoreOnChain(scoreForLog) : null;

    const persisted = await recordScore({
      asset: b.asset,
      name: b.name,
      podScore: b.score,
      compositeZ: b.z,
      direction: b.direction,
      uncertain: b.uncertain,
      sources: b.contributions.filter((c) => c.weight > 0).length,
      reasoning: b.reasoning,
      ...(onchain ? { reasoningHash: onchain.reasoningHash } : {}),
      ...(onchain ? { onchainTx: onchain.txHash } : {}),
      ...(onchain ? { onchainEntryId: onchain.entryId } : {}),
      generatedAt: b.generatedAt,
    });

    results.push({
      asset: b.asset,
      podScore: b.score,
      persisted,
      ...(onchain ? { onchainTx: onchain.txHash, entryId: onchain.entryId } : {}),
    });
  }

  // Fan out to the monitors so a single daily cron drives everything
  // (Vercel Hobby caps the number of scheduled crons).
  const origin = new URL(request.url).origin;
  const headers = cronSecret ? { authorization: `Bearer ${cronSecret}` } : undefined;
  const monitors = ['check-alerts', 'tpsl-monitor', 'dca', 'digest'];
  const monitorResults = await Promise.allSettled(
    monitors.map((m) => fetch(`${origin}/api/cron/${m}`, headers ? { headers } : {}).then((r) => r.json())),
  );

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    anchored: anchor,
    count: results.length,
    results,
    monitors: Object.fromEntries(
      monitors.map((m, i) => [m, monitorResults[i]?.status === 'fulfilled' ? (monitorResults[i] as PromiseFulfilledResult<unknown>).value : 'failed']),
    ),
  });
}
