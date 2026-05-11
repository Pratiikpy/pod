import { z } from 'zod';
import type { SoSoValueClient } from '../client.js';

export const FundraisingRoundSchema = z.object({
  project: z.string(),
  ticker: z.string().optional(),
  amount_usd: z.number().optional(),
  round: z.string().optional(),
  date: z.string().optional(),
  lead_investors: z.array(z.string()).optional(),
  all_investors: z.array(z.string()).optional(),
  category: z.string().optional(),
  description: z.string().optional(),
  valuation_usd: z.number().optional(),
});
export type FundraisingRound = z.infer<typeof FundraisingRoundSchema>;

export const FundraisingResponseSchema = z
  .object({
    code: z.union([z.number(), z.string()]).optional(),
    data: z.array(FundraisingRoundSchema.passthrough()).default([]),
    msg: z.string().optional(),
  })
  .passthrough();

export class FundraisingModule {
  constructor(private readonly client: SoSoValueClient) {}

  /** Recent crypto/web3 funding rounds. */
  async list(params?: { limit?: number; min_amount?: number; days?: number; category?: string }) {
    const query = {
      limit: params?.limit ?? 50,
      min_amount: params?.min_amount,
      days: params?.days ?? 30,
      category: params?.category,
    };
    const candidates = ['/fundraising/list', '/fundraising', '/fundraises/list', '/funding/list'];
    for (const path of candidates) {
      try {
        const result = await this.client.fetch({
          path,
          method: 'GET',
          query,
          schema: FundraisingResponseSchema,
          cacheTtl: 60 * 60 * 2,
        });
        return result.data;
      } catch {
        /* try next */
      }
    }
    return [];
  }
}
