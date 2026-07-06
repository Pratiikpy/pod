import { z } from 'zod';
import type { SoSoValueClient } from '../client.js';

/**
 * Currencies. The live endpoints are id-keyed:
 *   /currencies                          → [{ currency_id, symbol, name }]
 *   /currencies/{id}/market-snapshot     → price, ath, cycle_low, fdv, rank…
 *   /currencies/{id}/pairs               → order-book depth (±2%) per market
 *   /currencies/{id}/token-economics     → allocation + unlock timeline
 *   /currencies/sector-spotlight         → sector rotation + trending
 */
export const CurrencyRefSchema = z.object({
  currency_id: z.string(),
  symbol: z.string(),
  name: z.string().nullable().optional(),
});
export const CurrencyListResponseSchema = z.object({
  code: z.union([z.number(), z.string()]).optional(),
  data: z.array(CurrencyRefSchema).default([]),
});

const num = z.union([z.number(), z.string()]).nullable().optional();

export const CurrencySnapshotSchema = z
  .object({
    price: num,
    change_pct_24h: num,
    marketcap: num,
    fdv: num,
    max_supply: num,
    total_supply: num,
    circulating_supply: num,
    ath: num,
    ath_date: num,
    down_from_ath: num,
    cycle_low: num,
    up_from_cycle_low: num,
    marketcap_rank: num,
  })
  .passthrough();
export const CurrencySnapshotResponseSchema = z.object({
  code: z.union([z.number(), z.string()]).optional(),
  data: CurrencySnapshotSchema,
});

export const PairDepthSchema = z
  .object({
    base: z.string().optional(),
    target: z.string().optional(),
    market: z.string().optional(),
    price: num,
    turnover_24h: num,
    cost_to_move_up_usd: num,
    cost_to_move_down_usd: num,
  })
  .passthrough();
export const PairsResponseSchema = z.object({
  code: z.union([z.number(), z.string()]).optional(),
  data: z.object({ list: z.array(PairDepthSchema).default([]), total: num }).default({ list: [] }),
});

export const UnlockVestingSchema = z.object({ label: z.string().optional(), amount: num }).passthrough();
export const TokenEconomicsResponseSchema = z.object({
  code: z.union([z.number(), z.string()]).optional(),
  data: z
    .object({
      token_allocation: z.array(z.unknown()).nullable().optional(),
      token_unlock: z.unknown().nullable().optional(),
      unlock_timeline: z
        .array(z.object({ date: z.string().optional(), vestings: z.array(UnlockVestingSchema).optional() }).passthrough())
        .nullable()
        .optional(),
    })
    .passthrough(),
});

export const SectorSpotlightResponseSchema = z.object({
  code: z.union([z.number(), z.string()]).optional(),
  data: z
    .object({
      sector: z.array(z.object({ name: z.string(), change_pct_24h: num, marketcap_dom: num }).passthrough()).default([]),
      spotlight: z.array(z.object({ name: z.string(), change_pct_24h: num }).passthrough()).default([]),
    })
    .passthrough(),
});

function toNum(v: number | string | null | undefined): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v);
  return undefined;
}

export interface CurrencySnapshot {
  price?: number | undefined;
  marketcap?: number | undefined;
  fdv?: number | undefined;
  ath?: number | undefined;
  downFromAth?: number | undefined;
  cycleLow?: number | undefined;
  upFromCycleLow?: number | undefined;
  rank?: number | undefined;
}
export interface SectorRow {
  name: string;
  change24hPct: number;
  dominance: number;
}
export interface UnlockPoint {
  date: string;
  amount: number;
  label?: string;
}

export class CurrencyModule {
  constructor(private readonly client: SoSoValueClient) {}

  /** All currencies (id, symbol, name). Cache 6h. */
  async list(pageSize = 200) {
    const result = await this.client.fetch({
      path: '/currencies',
      method: 'GET',
      query: { page: 1, page_size: pageSize },
      schema: CurrencyListResponseSchema,
      cacheTtl: 60 * 60 * 6,
    });
    return result.data;
  }

  /** symbol (lowercase) → currency_id map. Cache handled by list(). */
  async idMap(): Promise<Map<string, string>> {
    const rows = await this.list();
    const map = new Map<string, string>();
    for (const r of rows) map.set(r.symbol.toLowerCase(), r.currency_id);
    return map;
  }

  async snapshot(currencyId: string): Promise<CurrencySnapshot> {
    const result = await this.client.fetch({
      path: `/currencies/${encodeURIComponent(currencyId)}/market-snapshot`,
      method: 'GET',
      schema: CurrencySnapshotResponseSchema,
      cacheTtl: 5 * 60,
    });
    const d = result.data;
    return {
      price: toNum(d.price),
      marketcap: toNum(d.marketcap),
      fdv: toNum(d.fdv),
      ath: toNum(d.ath),
      downFromAth: toNum(d.down_from_ath),
      cycleLow: toNum(d.cycle_low),
      upFromCycleLow: toNum(d.up_from_cycle_low),
      rank: toNum(d.marketcap_rank),
    };
  }

  /** Aggregate ±2% order-book depth (USD) across the top markets. Cache 5m. */
  async depth(currencyId: string): Promise<{ up: number; down: number; markets: number }> {
    const result = await this.client.fetch({
      path: `/currencies/${encodeURIComponent(currencyId)}/pairs`,
      method: 'GET',
      query: { page: 1, page_size: 30 },
      schema: PairsResponseSchema,
      cacheTtl: 5 * 60,
    });
    let up = 0;
    let down = 0;
    for (const p of result.data.list) {
      up += toNum(p.cost_to_move_up_usd) ?? 0;
      down += toNum(p.cost_to_move_down_usd) ?? 0;
    }
    return { up, down, markets: result.data.list.length };
  }

  /** Upcoming token unlocks (vesting cliffs). Empty for coins without vesting (e.g. BTC). Cache 6h. */
  async unlocks(currencyId: string): Promise<UnlockPoint[]> {
    const result = await this.client.fetch({
      path: `/currencies/${encodeURIComponent(currencyId)}/token-economics`,
      method: 'GET',
      schema: TokenEconomicsResponseSchema,
      cacheTtl: 60 * 60 * 6,
    });
    const out: UnlockPoint[] = [];
    for (const row of result.data.unlock_timeline ?? []) {
      for (const v of row.vestings ?? []) {
        const amount = toNum(v.amount) ?? 0;
        if (amount > 0 && row.date) out.push({ date: row.date, amount, ...(v.label ? { label: v.label } : {}) });
      }
    }
    return out;
  }

  /** Sector rotation + trending assets. Cache 5m. */
  async sectorSpotlight(): Promise<{ sectors: SectorRow[]; trending: Array<{ name: string; change24hPct: number }> }> {
    const result = await this.client.fetch({
      path: '/currencies/sector-spotlight',
      method: 'GET',
      schema: SectorSpotlightResponseSchema,
      cacheTtl: 5 * 60,
    });
    return {
      sectors: result.data.sector.map((s) => ({ name: s.name, change24hPct: toNum(s.change_pct_24h) ?? 0, dominance: toNum(s.marketcap_dom) ?? 0 })),
      trending: result.data.spotlight.map((s) => ({ name: s.name, change24hPct: toNum(s.change_pct_24h) ?? 0 })),
    };
  }
}
