import { neon } from '@neondatabase/serverless';

/** Watchlist + DCA persistence for the bot. Falls back to no-ops without a DB. */
function db() {
  const url = process.env['DATABASE_URL'];
  return url ? neon(url) : null;
}

// ── Watchlist (F47) ──────────────────────────────────────────────────────────

export async function addToWatchlist(telegramId: number, asset: string): Promise<boolean> {
  const sql = db();
  if (!sql) return false;
  try {
    await sql`insert into watchlist (telegram_id, asset) values (${telegramId}, ${asset}) on conflict do nothing`;
    return true;
  } catch (err) {
    console.error('[watchlist] add failed:', err);
    return false;
  }
}

export async function removeFromWatchlist(telegramId: number, asset: string): Promise<void> {
  const sql = db();
  if (!sql) return;
  await sql`delete from watchlist where telegram_id = ${telegramId} and asset = ${asset}`;
}

export async function getWatchlist(telegramId: number): Promise<string[]> {
  const sql = db();
  if (!sql) return [];
  const rows = (await sql`select asset from watchlist where telegram_id = ${telegramId} order by created_at`) as Array<{ asset: string }>;
  return rows.map((r) => r.asset);
}

/** All watchlists grouped by user — for the digest job. */
export async function getAllWatchlists(): Promise<Map<number, string[]>> {
  const sql = db();
  if (!sql) return new Map();
  const rows = (await sql`select telegram_id, asset from watchlist`) as Array<{ telegram_id: number; asset: string }>;
  const map = new Map<number, string[]>();
  for (const r of rows) {
    const id = Number(r.telegram_id);
    const list = map.get(id) ?? [];
    list.push(r.asset);
    map.set(id, list);
  }
  return map;
}

// ── DCA schedules (F17) ──────────────────────────────────────────────────────

export interface DcaSchedule {
  id: number;
  telegramId: number;
  asset: string;
  amountUsd: number;
  intervalHours: number;
  lastRunAt: string | null;
}

export async function addDca(telegramId: number, asset: string, amountUsd: number, intervalHours: number): Promise<boolean> {
  const sql = db();
  if (!sql) return false;
  try {
    await sql`insert into dca_schedules (telegram_id, asset, amount_usd, interval_hours, active) values (${telegramId}, ${asset}, ${amountUsd}, ${intervalHours}, true)`;
    return true;
  } catch (err) {
    console.error('[dca] add failed:', err);
    return false;
  }
}

export async function listDca(telegramId: number): Promise<DcaSchedule[]> {
  const sql = db();
  if (!sql) return [];
  const rows = (await sql`select id, telegram_id, asset, amount_usd, interval_hours, last_run_at from dca_schedules where telegram_id = ${telegramId} and active = true order by created_at`) as Array<Record<string, unknown>>;
  return rows.map(mapDca);
}

export async function clearDca(telegramId: number): Promise<number> {
  const sql = db();
  if (!sql) return 0;
  const rows = (await sql`update dca_schedules set active = false where telegram_id = ${telegramId} and active = true returning id`) as Array<{ id: number }>;
  return rows.length;
}

/** Schedules whose interval has elapsed — for the DCA job. */
export async function getDueDca(): Promise<DcaSchedule[]> {
  const sql = db();
  if (!sql) return [];
  const rows = (await sql`
    select id, telegram_id, asset, amount_usd, interval_hours, last_run_at
    from dca_schedules
    where active = true
      and (last_run_at is null or last_run_at < now() - (interval_hours || ' hours')::interval)
  `) as Array<Record<string, unknown>>;
  return rows.map(mapDca);
}

export async function markDcaRun(id: number): Promise<void> {
  const sql = db();
  if (!sql) return;
  await sql`update dca_schedules set last_run_at = now() where id = ${id}`;
}

function mapDca(r: Record<string, unknown>): DcaSchedule {
  return {
    id: Number(r['id']),
    telegramId: Number(r['telegram_id']),
    asset: String(r['asset']),
    amountUsd: Number(r['amount_usd']),
    intervalHours: Number(r['interval_hours']),
    lastRunAt: r['last_run_at'] ? String(r['last_run_at']) : null,
  };
}
