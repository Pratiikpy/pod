import { z } from 'zod';
import type { SoSoValueClient } from '../client.js';

export const CryptoStockSchema = z.object({
  ticker: z.string(),
  name: z.string().optional(),
  price: z.number().optional(),
  market_cap: z.number().optional(),
  change_24h_percent: z.number().optional(),
  sector: z.string().optional(),
});

export const CryptoStockListResponseSchema = z
  .object({
    code: z.union([z.number(), z.string()]).optional(),
    data: z.array(CryptoStockSchema.passthrough()).default([]),
    msg: z.string().optional(),
  })
  .passthrough();

export class CryptoStocksModule {
  constructor(private readonly client: SoSoValueClient) {}

  /** Crypto-related stocks (COIN, MARA, MSTR, RIOT, etc.). */
  async list(params?: { limit?: number; sector?: string }) {
    const candidates = ['/crypto-stocks/list', '/crypto-stocks', '/stocks/list', '/stocks'];
    for (const path of candidates) {
      try {
        const result = await this.client.fetch({
          path,
          method: 'GET',
          query: { limit: params?.limit ?? 100, sector: params?.sector },
          schema: CryptoStockListResponseSchema,
          cacheTtl: 60 * 60,
        });
        return result.data;
      } catch {
        /* try next */
      }
    }
    return [];
  }

  async snapshot(ticker: string) {
    const result = await this.client.fetch({
      path: '/crypto-stocks/market-snapshot',
      method: 'GET',
      query: { ticker },
      schema: z.object({
        code: z.number().optional(),
        data: CryptoStockSchema,
      }),
      cacheTtl: 60,
    });
    return result.data;
  }
}
