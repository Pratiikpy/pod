import { neon } from '@neondatabase/serverless';

/**
 * Score-history persistence (Neon Postgres). Powers the real 30-day score
 * trace, the leaderboard trend, and the verifiable on-chain receipt lookup.
 * All writes/reads no-op gracefully when DATABASE_URL is unset.
 */
function db() {
  const url = process.env['DATABASE_URL'];
  if (!url) return null;
  return neon(url);
}

export interface ScoreRecord {
  asset: string;
  name?: string;
  podScore: number;
  compositeZ: number;
  direction: string;
  uncertain: boolean;
  sources: number;
  reasoning?: string;
  reasoningHash?: string;
  onchainTx?: string;
  onchainEntryId?: number;
  generatedAt: string;
}

export async function recordScore(r: ScoreRecord): Promise<boolean> {
  const sql = db();
  if (!sql) return false;
  try {
    await sql`
      insert into score_history
        (asset, name, pod_score, composite_z, direction, uncertain, sources,
         reasoning, reasoning_hash, onchain_tx, onchain_entry_id, generated_at)
      values
        (${r.asset}, ${r.name ?? null}, ${r.podScore}, ${r.compositeZ}, ${r.direction},
         ${r.uncertain}, ${r.sources}, ${r.reasoning ?? null}, ${r.reasoningHash ?? null},
         ${r.onchainTx ?? null}, ${r.onchainEntryId ?? null}, ${r.generatedAt})
    `;
    return true;
  } catch (err) {
    console.error('[db] recordScore failed:', err);
    return false;
  }
}

export interface HistoryPoint {
  date: string;
  podScore: number;
  compositeZ: number;
}

/** Daily score trace for one asset (most recent per day), oldest → newest. */
export async function getScoreHistory(asset: string, days = 30): Promise<HistoryPoint[]> {
  const sql = db();
  if (!sql) return [];
  try {
    const rows = (await sql`
      select distinct on (generated_at::date)
        generated_at::date as date, pod_score, composite_z
      from score_history
      where asset = ${asset} and generated_at > now() - (${days} || ' days')::interval
      order by generated_at::date desc, generated_at desc
      limit ${days}
    `) as Array<{ date: string; pod_score: number; composite_z: number }>;
    return rows
      .map((r) => ({
        date: new Date(r.date).toISOString().slice(0, 10),
        podScore: r.pod_score,
        compositeZ: r.composite_z,
      }))
      .reverse();
  } catch (err) {
    console.error('[db] getScoreHistory failed:', err);
    return [];
  }
}

export interface OnChainReceipt {
  asset: string;
  podScore: number;
  reasoningHash: string;
  onchainTx: string;
  onchainEntryId: number | null;
  generatedAt: string;
}

/** Latest on-chain-anchored score for an asset (for the "verify this score" panel). */
export async function getLatestReceipt(asset: string): Promise<OnChainReceipt | null> {
  const sql = db();
  if (!sql) return null;
  try {
    const rows = (await sql`
      select asset, pod_score, reasoning_hash, onchain_tx, onchain_entry_id, generated_at
      from score_history
      where asset = ${asset} and onchain_tx is not null
      order by generated_at desc
      limit 1
    `) as Array<{
      asset: string;
      pod_score: number;
      reasoning_hash: string;
      onchain_tx: string;
      onchain_entry_id: number | null;
      generated_at: string;
    }>;
    const r = rows[0];
    if (!r) return null;
    return {
      asset: r.asset,
      podScore: r.pod_score,
      reasoningHash: r.reasoning_hash,
      onchainTx: r.onchain_tx,
      onchainEntryId: r.onchain_entry_id,
      generatedAt: r.generated_at,
    };
  } catch (err) {
    console.error('[db] getLatestReceipt failed:', err);
    return null;
  }
}
