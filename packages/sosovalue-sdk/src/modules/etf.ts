import { z } from 'zod';
import type { SoSoValueClient } from '../client.js';

// ── Schemas ────────────────────────────────────────────────────────────────

export const EtfSummaryHistoryRecordSchema = z.object({
  date: z.string(), // YYYY-MM-DD
  total_net_inflow: z.number(),
  total_value_traded: z.number(),
  total_net_assets: z.number(),
  cum_net_inflow: z.number(),
});
export type EtfSummaryHistoryRecord = z.infer<typeof EtfSummaryHistoryRecordSchema>;

export const EtfSummaryHistoryResponseSchema = z.object({
  code: z.number().optional(),
  data: z.array(EtfSummaryHistoryRecordSchema),
});

export const EtfTickerInfoSchema = z.object({
  ticker: z.string(),
  name: z.string().optional(),
  issuer: z.string().optional(),
  underlying: z.string().optional(),
  inception_date: z.string().optional(),
});
export type EtfTickerInfo = z.infer<typeof EtfTickerInfoSchema>;

export const EtfListResponseSchema = z.object({
  code: z.number().optional(),
  data: z.array(EtfTickerInfoSchema),
});

export const EtfHistoryRecordSchema = z.object({
  date: z.string(),
  net_inflow: z.number(),
  value_traded: z.number().optional(),
  net_assets: z.number().optional(),
  shares_outstanding: z.number().optional(),
});
export type EtfHistoryRecord = z.infer<typeof EtfHistoryRecordSchema>;

export const EtfHistoryResponseSchema = z.object({
  code: z.number().optional(),
  data: z.array(EtfHistoryRecordSchema),
});

export const EtfMarketSnapshotSchema = z.object({
  ticker: z.string(),
  price: z.number().optional(),
  net_assets: z.number().optional(),
  net_inflow_today: z.number().optional(),
  net_inflow_yesterday: z.number().optional(),
  net_inflow_7d: z.number().optional(),
  net_inflow_30d: z.number().optional(),
  shares_outstanding: z.number().optional(),
  premium_discount: z.number().optional(),
  updated_at: z.string().optional(),
});
export type EtfMarketSnapshot = z.infer<typeof EtfMarketSnapshotSchema>;

export const EtfMarketSnapshotResponseSchema = z.object({
  code: z.number().optional(),
  data: EtfMarketSnapshotSchema,
});

// ── Module ─────────────────────────────────────────────────────────────────

export type EtfSymbol =
  | 'BTC'
  | 'ETH'
  | 'SOL'
  | 'LTC'
  | 'HBAR'
  | 'XRP'
  | 'DOGE'
  | 'LINK'
  | 'AVAX'
  | 'DOT';

export type EtfCountryCode = 'US' | 'HK';

/**
 * ETF module — the flagship dataset.
 * Returns institutional flow data for spot crypto ETFs.
 */
export class EtfModule {
  constructor(private readonly client: SoSoValueClient) {}

  /**
   * Aggregate daily flow history for a given crypto symbol + country.
   * Granularity: daily. History limit: 1 month per call. Sorted reverse-chronologically.
   * Cache: 1 hour (data updates after market close).
   */
  async summaryHistory(params: {
    symbol: EtfSymbol;
    country_code?: EtfCountryCode;
    start_date?: string;
    end_date?: string;
    limit?: number;
  }) {
    const result = await this.client.fetch({
      path: '/etfs/summary-history',
      method: 'GET',
      query: {
        symbol: params.symbol,
        country_code: params.country_code ?? 'US',
        start_date: params.start_date,
        end_date: params.end_date,
        limit: params.limit ?? 50,
      },
      schema: EtfSummaryHistoryResponseSchema,
      cacheTtl: 60 * 60,
    });
    return result.data;
  }

  /** List of tracked ETFs with metadata. Cache: 24 hours. */
  async list(symbol: EtfSymbol = 'BTC', country_code: EtfCountryCode = 'US') {
    // The /etfs endpoint requires symbol + country_code query params (returns 400 otherwise).
    const result = await this.client.fetch({
      path: '/etfs',
      method: 'GET',
      query: { symbol, country_code },
      schema: EtfListResponseSchema,
      cacheTtl: 60 * 60 * 24,
    });
    return result.data;
  }

  /** Per-ticker history. Cache: 30 minutes. */
  async history(params: { ticker: string; limit?: number }) {
    const result = await this.client.fetch({
      path: `/etfs/${encodeURIComponent(params.ticker)}/history`,
      method: 'GET',
      query: {
        limit: params.limit ?? 50,
      },
      schema: EtfHistoryResponseSchema,
      cacheTtl: 30 * 60,
    });
    return result.data;
  }

  /** Real-time market snapshot for a ticker. Cache: 1 minute. */
  async marketSnapshot(ticker: string) {
    const result = await this.client.fetch({
      path: `/etfs/${encodeURIComponent(ticker)}/market-snapshot`,
      method: 'GET',
      schema: EtfMarketSnapshotResponseSchema,
      cacheTtl: 60,
    });
    return result.data;
  }
}
