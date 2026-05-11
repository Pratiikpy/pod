import { z } from 'zod';
import type { SoSoValueClient } from '../client.js';

export const AnalysisChartSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string().optional(),
  description: z.string().optional(),
});

export const AnalysisChartListResponseSchema = z.object({
  code: z.number().optional(),
  data: z.array(AnalysisChartSchema),
});

export const AnalysisChartDataPointSchema = z.object({
  timestamp: z.number(),
  value: z.number(),
  label: z.string().optional(),
});

export const AnalysisChartDataResponseSchema = z.object({
  code: z.number().optional(),
  data: z.object({
    chart_id: z.string(),
    name: z.string().optional(),
    points: z.array(AnalysisChartDataPointSchema),
  }),
});

export class AnalysisChartsModule {
  constructor(private readonly client: SoSoValueClient) {}

  /** Catalog of available analysis charts (BTC dominance, fear & greed, etc.). */
  async catalog() {
    const result = await this.client.fetch({
      path: '/charts/catalog',
      method: 'GET',
      schema: AnalysisChartListResponseSchema,
      cacheTtl: 60 * 60 * 24,
    });
    return result.data;
  }

  /** Get the actual time series for a specific chart. */
  async data(params: { chart_id: string; limit?: number; from?: string; to?: string }) {
    const result = await this.client.fetch({
      path: '/charts/data',
      method: 'GET',
      query: {
        chart_id: params.chart_id,
        limit: params.limit ?? 100,
        from: params.from,
        to: params.to,
      },
      schema: AnalysisChartDataResponseSchema,
      cacheTtl: 60 * 30,
    });
    return result.data;
  }
}
