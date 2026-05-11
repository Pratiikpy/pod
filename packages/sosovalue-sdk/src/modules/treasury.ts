import { z } from 'zod';
import type { SoSoValueClient } from '../client.js';

export const TreasuryHolderSchema = z.object({
  entity: z.string(),
  ticker: z.string().optional(),
  btc_holdings: z.number(),
  total_cost_usd: z.number().optional(),
  avg_purchase_price: z.number().optional(),
  last_updated: z.string().optional(),
  country: z.string().optional(),
  category: z.string().optional(),
});
export type TreasuryHolder = z.infer<typeof TreasuryHolderSchema>;

export const TreasuryListResponseSchema = z
  .object({
    code: z.union([z.number(), z.string()]).optional(),
    data: z.array(TreasuryHolderSchema.passthrough()).default([]),
    msg: z.string().optional(),
  })
  .passthrough();

export const TreasuryAcquisitionSchema = z.object({
  entity: z.string(),
  date: z.string(),
  btc_amount: z.number(),
  usd_amount: z.number().optional(),
  avg_price: z.number().optional(),
  source: z.string().optional(),
});

export const TreasuryAcquisitionsResponseSchema = z
  .object({
    code: z.union([z.number(), z.string()]).optional(),
    data: z.array(TreasuryAcquisitionSchema.passthrough()).default([]),
    msg: z.string().optional(),
  })
  .passthrough();

export class TreasuryModule {
  constructor(private readonly client: SoSoValueClient) {}

  /** Top corporate / institutional BTC holders (MicroStrategy, Tesla, Marathon, etc.). */
  async holders(params?: { limit?: number; category?: string }) {
    const candidates = ['/btc-treasuries/list', '/treasury/holders', '/btc-treasuries', '/treasuries/holders'];
    for (const path of candidates) {
      try {
        const result = await this.client.fetch({
          path,
          method: 'GET',
          query: { limit: params?.limit ?? 100, category: params?.category },
          schema: TreasuryListResponseSchema,
          cacheTtl: 60 * 60 * 6,
        });
        return result.data;
      } catch {
        /* try next */
      }
    }
    return [];
  }

  /** Recent BTC acquisitions across treasuries. */
  async recentAcquisitions(params?: { limit?: number; days?: number }) {
    const candidates = [
      '/btc-treasuries/acquisitions',
      '/treasury/acquisitions',
      '/btc-treasuries/recent',
      '/treasuries/acquisitions',
    ];
    for (const path of candidates) {
      try {
        const result = await this.client.fetch({
          path,
          method: 'GET',
          query: { limit: params?.limit ?? 50, days: params?.days ?? 30 },
          schema: TreasuryAcquisitionsResponseSchema,
          cacheTtl: 60 * 60,
        });
        return result.data;
      } catch {
        /* try next */
      }
    }
    return [];
  }
}
