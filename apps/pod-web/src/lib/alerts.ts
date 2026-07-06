import { neon } from '@neondatabase/serverless';

/**
 * Score alerts — the retention loop. A user subscribes to "ping me when BTC's
 * POD Score crosses 70" and the check cron notifies them in Telegram when it
 * fires. Persisted in Postgres so subscriptions survive restarts.
 */
export type AlertKind = 'score_above' | 'score_below';

export interface Alert {
  id: number;
  telegramId: number;
  asset: string;
  kind: AlertKind;
  threshold: number;
  lastFiredScore: number | null;
}

function db() {
  const url = process.env['DATABASE_URL'];
  return url ? neon(url) : null;
}

export async function addAlert(
  telegramId: number,
  asset: string,
  kind: AlertKind,
  threshold: number,
): Promise<boolean> {
  const sql = db();
  if (!sql) return false;
  try {
    await sql`
      insert into alerts (telegram_id, asset, kind, threshold, active)
      values (${telegramId}, ${asset}, ${kind}, ${threshold}, true)
    `;
    return true;
  } catch (err) {
    console.error('[alerts] add failed:', err);
    return false;
  }
}

export async function listUserAlerts(telegramId: number): Promise<Alert[]> {
  const sql = db();
  if (!sql) return [];
  const rows = (await sql`
    select id, telegram_id, asset, kind, threshold, last_fired_score
    from alerts where telegram_id = ${telegramId} and active = true
    order by created_at desc
  `) as Array<Record<string, unknown>>;
  return rows.map(mapAlert);
}

export async function clearUserAlerts(telegramId: number): Promise<number> {
  const sql = db();
  if (!sql) return 0;
  const rows = (await sql`
    update alerts set active = false where telegram_id = ${telegramId} and active = true returning id
  `) as Array<{ id: number }>;
  return rows.length;
}

export async function getActiveAlerts(): Promise<Alert[]> {
  const sql = db();
  if (!sql) return [];
  const rows = (await sql`
    select id, telegram_id, asset, kind, threshold, last_fired_score
    from alerts where active = true
  `) as Array<Record<string, unknown>>;
  return rows.map(mapAlert);
}

export async function markFired(id: number, score: number): Promise<void> {
  const sql = db();
  if (!sql) return;
  await sql`update alerts set last_fired_score = ${score}, last_fired_at = now() where id = ${id}`;
}

function mapAlert(r: Record<string, unknown>): Alert {
  return {
    id: Number(r['id']),
    telegramId: Number(r['telegram_id']),
    asset: String(r['asset']),
    kind: r['kind'] as AlertKind,
    threshold: Number(r['threshold']),
    lastFiredScore: r['last_fired_score'] === null ? null : Number(r['last_fired_score']),
  };
}

/**
 * Decide whether an alert should fire for the current score. Edge-triggered:
 * only fires when the threshold is freshly crossed (guards against repeat
 * pings while the score sits past the line).
 */
export function shouldFire(alert: Alert, score: number): boolean {
  const crossed = alert.kind === 'score_above' ? score >= alert.threshold : score <= alert.threshold;
  if (!crossed) return false;
  if (alert.lastFiredScore === null) return true;
  const prevCrossed =
    alert.kind === 'score_above'
      ? alert.lastFiredScore >= alert.threshold
      : alert.lastFiredScore <= alert.threshold;
  return !prevCrossed; // only fire on a fresh crossing
}
