import { z } from 'zod';
import type { SoSoValueClient } from '../client.js';

export const IndexInfoSchema = z.object({
  symbol: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  inception_date: z.string().optional(),
  base_value: z.number().optional(),
});
export type IndexInfo = z.infer<typeof IndexInfoSchema>;

export const IndexListResponseSchema = z
  .object({
    code: z.union([z.number(), z.string()]).optional(),
    data: z.array(IndexInfoSchema.passthrough()).default([]),
    msg: z.string().optional(),
  })
  .passthrough();

export const IndexConstituentSchema = z.object({
  symbol: z.string(),
  weight: z.number(),
  market_cap: z.number().optional(),
  price: z.number().optional(),
});

export const IndexConstituentsResponseSchema = z.object({
  code: z.number().optional(),
  data: z.object({
    index_symbol: z.string(),
    constituents: z.array(IndexConstituentSchema),
    rebalanced_at: z.string().optional(),
  }),
});

export const IndexMarketSnapshotSchema = z.object({
  symbol: z.string(),
  value: z.number(),
  change_24h: z.number().optional(),
  change_24h_percent: z.number().optional(),
  market_cap_total: z.number().optional(),
  updated_at: z.string().optional(),
});

export const IndexMarketSnapshotResponseSchema = z.object({
  code: z.number().optional(),
  data: IndexMarketSnapshotSchema,
});

export const IndexKlineSchema = z.object({
  timestamp: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().optional(),
});

export const IndexKlinesResponseSchema = z.object({
  code: z.number().optional(),
  data: z.array(IndexKlineSchema),
});

export type IndexKlineInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';

export class IndexModule {
  constructor(private readonly client: SoSoValueClient) {}

  /** List all available SoSoValue indices (e.g., Magnificent Seven crypto, sector indices). */
  async list() {
    const candidates = ['/index/list', '/indices/list', '/index', '/indices'];
    for (const path of candidates) {
      try {
        const result = await this.client.fetch({
          path,
          method: 'GET',
          schema: IndexListResponseSchema,
          cacheTtl: 60 * 60,
        });
        return result.data;
      } catch {
        /* try next */
      }
    }
    return [];
  }

  /** Get the current basket composition for an index. */
  async constituents(symbol: string) {
    const result = await this.client.fetch({
      path: '/index/constituents',
      method: 'GET',
      query: { symbol },
      schema: IndexConstituentsResponseSchema,
      cacheTtl: 60 * 30,
    });
    return result.data;
  }

  /** Real-time index snapshot. */
  async marketSnapshot(symbol: string) {
    const result = await this.client.fetch({
      path: '/index/market-snapshot',
      method: 'GET',
      query: { symbol },
      schema: IndexMarketSnapshotResponseSchema,
      cacheTtl: 60,
    });
    return result.data;
  }

  /** Candlestick data for the index. */
  async klines(params: { symbol: string; interval: IndexKlineInterval; limit?: number }) {
    const result = await this.client.fetch({
      path: '/index/klines',
      method: 'GET',
      query: {
        symbol: params.symbol,
        interval: params.interval,
        limit: params.limit ?? 100,
      },
      schema: IndexKlinesResponseSchema,
      cacheTtl: 60,
    });
    return result.data;
  }
}
