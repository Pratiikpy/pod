import { NextResponse } from 'next/server';
import { getBubble } from '@/lib/bubble-data';
import { getDueDca, markDcaRun } from '@/lib/user-features';
import { tradeOnSignal } from '@/lib/trading';
import type { Hex } from 'viem';
import type { PodSignal } from '@pod/signal-engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * DCA job (F17). For each schedule whose interval has elapsed, places the
 * recurring market buy on the demo wallet and notifies the user. Runs the
 * proven signal-to-execution path on a timer.
 */
export async function GET(request: Request) {
  const cronSecret = process.env['CRON_SECRET'];
  if (cronSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) return new NextResponse('Unauthorized', { status: 401 });
  }
  const token = process.env['TELEGRAM_BOT_TOKEN'];
  const pk = process.env['SODEX_PRIVATE_KEY'] as Hex | undefined;
  const due = await getDueDca();
  if (due.length === 0 || !pk) return NextResponse.json({ due: due.length, placed: 0 });

  let placed = 0;
  for (const d of due) {
    const b = await getBubble(d.asset as Parameters<typeof getBubble>[0]);
    if (!b) continue;

    // DCA buys regardless of direction (that is the point), so present it as BUY.
    const signal: PodSignal = {
      asset: b.asset,
      generated_at: b.generatedAt,
      direction: 'BUY',
      podScore: b.score,
      compositeZ: b.z,
      contributions: b.contributions,
      targetBasket: b.targetBasket,
      reasoning: b.reasoning,
      uncertain: b.uncertain,
    };

    let note = '';
    try {
      const trade = await tradeOnSignal({ privateKey: pk, signal, fundsUsd: d.amountUsd });
      note = trade.error ? `attempted, venue: ${trade.error}` : trade.attempted ? 'order submitted' : (trade.reason ?? 'skipped');
    } catch (err) {
      note = `error: ${(err as Error).message}`;
    }
    await markDcaRun(d.id);
    placed++;

    if (token) {
      try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: d.telegramId,
            text: `DCA — $${d.amountUsd} ${d.asset} (POD Score ${b.score}/100): ${note}.`,
          }),
        });
      } catch {
        /* ignore notify failure */
      }
    }
  }
  return NextResponse.json({ due: due.length, placed });
}
