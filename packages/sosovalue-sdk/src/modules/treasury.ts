import { z } from 'zod';
import type { SoSoValueClient } from '../client.js';

/**
 * BTC treasuries. The list is thin (`ticker`, `name`, `list_location`); the
 * holdings + acquisition cost live in the per-ticker purchase-history:
 *
 *   /btc-treasuries              → [ { ticker, name, list_location } ]
 *   /btc-treasuries/{t}/purchase-history
 *                                → [ { date, ticker, btc_holding, btc_acq,
 *                                      acq_cost, avg_btc_cost } ]
 * (numeric fields come back as strings.)
 */
export const BtcTreasurySchema = z
  .object({
    ticker: z.string(),
    name: z.string().nullable().optional(),
    list_location: z.string().nullable().optional(),
  })
  .passthrough();

export const BtcTreasuryListResponseSchema = z
  .object({
    code: z.union([z.number(), z.string()]).optional(),
    data: z.array(BtcTreasurySchema).default([]),
  })
  .passthrough();

export const TreasuryPurchaseRowSchema = z
  .object({
    date: z.string(),
    ticker: z.string().nullable().optional(),
    btc_holding: z.union([z.number(), z.string()]).nullable().optional(),
    btc_acq: z.union([z.number(), z.string()]).nullable().optional(),
    acq_cost: z.union([z.number(), z.string()]).nullable().optional(),
    avg_btc_cost: z.union([z.number(), z.string()]).nullable().optional(),
  })
  .passthrough();

export const TreasuryPurchaseHistoryResponseSchema = z
  .object({
    code: z.union([z.number(), z.string()]).optional(),
    data: z.array(TreasuryPurchaseRowSchema).default([]),
  })
  .passthrough();

export interface TreasuryEntity {
  ticker: string;
  name?: string;
  listLocation?: string;
}

export interface TreasuryPurchase {
  date: string;
  btcAcquired: number;
  acqCostUsd: number;
  btcHolding: number;
}

function num(v: number | string | null | undefined): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v) || 0;
  return 0;
}

export class TreasuryModule {
  constructor(private readonly client: SoSoValueClient) {}

  /** Public companies holding BTC (MSTR, MARA, Metaplanet, …). Cache 6h. */
  async list(params?: { pageSize?: number; page?: number }): Promise<TreasuryEntity[]> {
    const result = await this.client.fetch({
      path: '/btc-treasuries',
      method: 'GET',
      query: { page: params?.page ?? 1, page_size: params?.pageSize ?? 30 },
      schema: BtcTreasuryListResponseSchema,
      cacheTtl: 60 * 60 * 6,
    });
    return result.data.map((r) => {
      const e: TreasuryEntity = { ticker: r.ticker };
      if (r.name) e.name = r.name;
      if (r.list_location) e.listLocation = r.list_location;
      return e;
    });
  }

  /** Per-company BTC purchase history (most recent first). Cache 3h. */
  async purchaseHistory(ticker: string, params?: { limit?: number }): Promise<TreasuryPurchase[]> {
    const result = await this.client.fetch({
      path: `/btc-treasuries/${encodeURIComponent(ticker)}/purchase-history`,
      method: 'GET',
      query: { limit: params?.limit ?? 12 },
      schema: TreasuryPurchaseHistoryResponseSchema,
      cacheTtl: 60 * 60 * 3,
    });
    return result.data.map((r) => ({
      date: r.date,
      btcAcquired: num(r.btc_acq),
      acqCostUsd: num(r.acq_cost),
      btcHolding: num(r.btc_holding),
    }));
  }
}
