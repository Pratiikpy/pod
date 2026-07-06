import { NextResponse } from 'next/server';
import { fetchAllBubbleData } from '@/lib/bubble-data';
import { getActiveAlerts, markFired, shouldFire } from '@/lib/alerts';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Checks every active score alert against the current POD Scores and pushes a
 * Telegram message for each one that freshly crossed its threshold. Meant to
 * run on a schedule (and callable manually).
 */
export async function GET(request: Request) {
  const cronSecret = process.env['CRON_SECRET'];
  if (cronSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) return new NextResponse('Unauthorized', { status: 401 });
  }

  const token = process.env['TELEGRAM_BOT_TOKEN'];
  const alerts = await getActiveAlerts();
  if (alerts.length === 0) return NextResponse.json({ checked: 0, fired: 0 });

  const bubbles = await fetchAllBubbleData();
  const scoreOf = new Map(bubbles.map((b) => [b.asset, b] as const));

  let fired = 0;
  for (const a of alerts) {
    const b = scoreOf.get(a.asset as (typeof bubbles)[number]['asset']);
    if (!b) continue;
    if (!shouldFire(a, b.score)) continue;

    const arrow = a.kind === 'score_above' ? 'crossed above' : 'dropped below';
    const text =
      `POD alert — ${a.asset} ${arrow} ${a.threshold}.\n\n` +
      `${a.asset} POD Score is now ${b.score}/100 (${b.direction}).\n${b.reasoning}`;

    if (token) {
      try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: a.telegramId, text }),
        });
      } catch (err) {
        console.error('[check-alerts] send failed:', err);
      }
    }
    await markFired(a.id, b.score);
    fired++;
  }

  return NextResponse.json({ checked: alerts.length, fired });
}
