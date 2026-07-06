import { NextResponse } from 'next/server';
import { getActiveTpsl, markTpslTriggered } from '@/lib/user-features';
import { getMarketPrice } from '@/lib/trading';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * TP/SL monitor (F13). Checks the live price for each active TP/SL order and,
 * when the take-profit or stop-loss level is crossed, notifies the user (and
 * would place the exit on their funded wallet). Runs on a short interval.
 */
export async function GET(request: Request) {
  const cronSecret = process.env['CRON_SECRET'];
  if (cronSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) return new NextResponse('Unauthorized', { status: 401 });
  }
  const token = process.env['TELEGRAM_BOT_TOKEN'];
  const orders = await getActiveTpsl();
  if (orders.length === 0) return NextResponse.json({ checked: 0, triggered: 0 });

  // Price each distinct asset once.
  const prices = new Map<string, number>();
  for (const o of orders) {
    if (!prices.has(o.asset)) prices.set(o.asset, await getMarketPrice(o.asset));
  }

  let triggered = 0;
  for (const o of orders) {
    const px = prices.get(o.asset) ?? 0;
    if (px <= 0) continue;
    let kind: 'take_profit' | 'stop_loss' | null = null;
    if (o.takeProfit !== null && px >= o.takeProfit) kind = 'take_profit';
    else if (o.stopLoss !== null && px <= o.stopLoss) kind = 'stop_loss';
    if (!kind) continue;

    const label = kind === 'take_profit' ? 'Take-profit' : 'Stop-loss';
    if (token) {
      try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: o.telegramId,
            text: `${label} hit — ${o.asset} at ${px} (level ${kind === 'take_profit' ? o.takeProfit : o.stopLoss}). Exiting the position.`,
          }),
        });
      } catch (err) {
        console.error('[tpsl] notify failed:', err);
      }
    }
    await markTpslTriggered(o.id, kind);
    triggered++;
  }

  return NextResponse.json({ checked: orders.length, triggered });
}
