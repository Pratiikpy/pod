import { z } from 'zod';
import type { SoSoValueClient } from '../client.js';

/**
 * SoSoValue SSI indices (ssiMAG7, ssiDeFi, ssiLayer1, …). Read-only:
 *   /indices                      → ["ssiMAG7", "ssiDeFi", ...]
 *   /indices/{ticker}/constituents → [{ currency_id, symbol, weight }]
 *   /indices/{ticker}/market-snapshot → { price, change_pct_24h, roi_7d, ... }
 *   /indices/{ticker}/klines       → [{ timestamp, open, high, low, close }]
 */
export const IndexListResponseSchema = z.object({
  code: z.union([z.number(), z.string()]).optional(),
  data: z.array(z.string()).default([]),
});

export const IndexConstituentSchema = z.object({
  currency_id: z.string(),
  symbol: z.string(),
  weight: z.number(),
});
export const IndexConstituentsResponseSchema = z.object({
  code: z.union([z.number(), z.string()]).optional(),
  data: z.array(IndexConstituentSchema).default([]),
});

export const IndexSnapshotSchema = z.object({
  price: z.number(),
  change_pct_24h: z.number().nullable().optional(),
  roi_7d: z.number().nullable().optional(),
  roi_1m: z.number().nullable().optional(),
  roi_3m: z.number().nullable().optional(),
  roi_1y: z.number().nullable().optional(),
  ytd: z.number().nullable().optional(),
});
export const IndexSnapshotResponseSchema = z.object({
  code: z.union([z.number(), z.string()]).optional(),
  data: IndexSnapshotSchema,
});

export const IndexKlineRowSchema = z.object({
  timestamp: z.union([z.number(), z.string()]),
  open: z.number().nullable().optional(),
  high: z.number().nullable().optional(),
  low: z.number().nullable().optional(),
  close: z.number().nullable().optional(),
});
export const IndexKlinesResponseSchema = z.object({
  code: z.union([z.number(), z.string()]).optional(),
  data: z.array(IndexKlineRowSchema).default([]),
});

export interface IndexConstituent {
  currencyId: string;
  symbol: string;
  weight: number;
}
export interface IndexSnapshot {
  price: number;
  change24hPct?: number;
  roi7d?: number;
  roi1m?: number;
  roi3m?: number;
  roi1y?: number;
  ytd?: number;
}

export class IndexModule {
  constructor(private readonly client: SoSoValueClient) {}

  /** All SSI index tickers. Cache 6h. */
  async list(): Promise<string[]> {
    const result = await this.client.fetch({
      path: '/indices',
      method: 'GET',
      schema: IndexListResponseSchema,
      cacheTtl: 60 * 60 * 6,
    });
    return result.data;
  }

  /** Weighted basket for an index. Cache 1h. */
  async constituents(ticker: string): Promise<IndexConstituent[]> {
    const result = await this.client.fetch({
      path: `/indices/${encodeURIComponent(ticker)}/constituents`,
      method: 'GET',
      schema: IndexConstituentsResponseSchema,
      cacheTtl: 60 * 60,
    });
    return result.data.map((c) => ({ currencyId: c.currency_id, symbol: c.symbol, weight: c.weight }));
  }

  /** Index level + ROI ladder. Cache 5m. */
  async marketSnapshot(ticker: string): Promise<IndexSnapshot> {
    const result = await this.client.fetch({
      path: `/indices/${encodeURIComponent(ticker)}/market-snapshot`,
      method: 'GET',
      schema: IndexSnapshotResponseSchema,
      cacheTtl: 5 * 60,
    });
    const d = result.data;
    const out: IndexSnapshot = { price: d.price };
    if (d.change_pct_24h != null) out.change24hPct = d.change_pct_24h;
    if (d.roi_7d != null) out.roi7d = d.roi_7d;
    if (d.roi_1m != null) out.roi1m = d.roi_1m;
    if (d.roi_3m != null) out.roi3m = d.roi_3m;
    if (d.roi_1y != null) out.roi1y = d.roi_1y;
    if (d.ytd != null) out.ytd = d.ytd;
    return out;
  }
}
