import { NextResponse } from 'next/server';
import { fetchAllBubbleData } from '@/lib/bubble-data';
import { getAllWatchlists } from '@/lib/user-features';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Daily digest (F48). Sends each user who has a watchlist a short morning read:
 * their watched coins' scores plus the day's top mover among them.
 */
export async function GET(request: Request) {
  const cronSecret = process.env['CRON_SECRET'];
  if (cronSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) return new NextResponse('Unauthorized', { status: 401 });
  }
  const token = process.env['TELEGRAM_BOT_TOKEN'];
  const watchlists = await getAllWatchlists();
  if (watchlists.size === 0) return NextResponse.json({ sent: 0 });

  const bubbles = await fetchAllBubbleData();
  const byAsset = new Map(bubbles.map((b) => [b.asset, b] as const));

  let sent = 0;
  for (const [telegramId, assets] of watchlists) {
    const rows = assets
      .map((a) => byAsset.get(a as (typeof bubbles)[number]['asset']))
      .filter((b): b is (typeof bubbles)[number] => Boolean(b));
    if (rows.length === 0) continue;

    const top = [...rows].sort((a, b) => b.score - a.score)[0]!;
    const lines = rows.map((b) => `• ${b.asset}: ${b.score}/100 (${b.direction})`);
    const text =
      `Your POD morning read\n\n${lines.join('\n')}\n\n` +
      `Top of your list: ${top.asset} at ${top.score}. ${top.reasoning}`;

    if (token) {
      try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: telegramId, text }),
        });
        sent++;
      } catch (err) {
        console.error('[digest] send failed:', err);
      }
    }
  }
  return NextResponse.json({ sent });
}
