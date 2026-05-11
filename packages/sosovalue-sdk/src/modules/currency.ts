import { z } from 'zod';
import type { SoSoValueClient } from '../client.js';

export const CurrencyInfoSchema = z.object({
  symbol: z.string(),
  name: z.string().optional(),
  market_cap: z.number().optional(),
  price: z.number().optional(),
  change_24h_percent: z.number().optional(),
  volume_24h: z.number().optional(),
  circulating_supply: z.number().optional(),
  total_supply: z.number().optional(),
  max_supply: z.number().nullable().optional(),
});
export type CurrencyInfo = z.infer<typeof CurrencyInfoSchema>;

export const CurrencyListResponseSchema = z
  .object({
    code: z.union([z.number(), z.string()]).optional(),
    data: z.array(CurrencyInfoSchema.passthrough()).default([]),
    msg: z.string().optional(),
  })
  .passthrough();

export const CurrencySnapshotResponseSchema = z.object({
  code: z.number().optional(),
  data: CurrencyInfoSchema,
});

export const CandlestickSchema = z.object({
  timestamp: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().optional(),
});

export const KlinesResponseSchema = z.object({
  code: z.number().optional(),
  data: z.array(CandlestickSchema),
});

export type CurrencyKlineInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';

export class CurrencyModule {
  constructor(private readonly client: SoSoValueClient) {}

  async list(params?: { limit?: number }) {
    const candidates = ['/currency/list', '/currencies/list', '/coin/list', '/coins/list'];
    for (const path of candidates) {
      try {
        const result = await this.client.fetch({
          path,
          method: 'GET',
          query: { limit: params?.limit ?? 100 },
          schema: CurrencyListResponseSchema,
          cacheTtl: 60 * 60,
        });
        return result.data;
      } catch {
        /* try next */
      }
    }
    return [];
  }

  async snapshot(symbol: string) {
    const result = await this.client.fetch({
      path: '/currency/market-snapshot',
      method: 'GET',
      query: { symbol },
      schema: CurrencySnapshotResponseSchema,
      cacheTtl: 30,
    });
    return result.data;
  }

  async klines(params: { symbol: string; interval: CurrencyKlineInterval; limit?: number }) {
    const result = await this.client.fetch({
      path: '/currency/klines',
      method: 'GET',
      query: {
        symbol: params.symbol,
        interval: params.interval,
        limit: params.limit ?? 100,
      },
      schema: KlinesResponseSchema,
      cacheTtl: 60,
    });
    return result.data;
  }
}
