import { z } from 'zod';
import type { SoSoValueClient } from '../client.js';

/**
 * Analysis charts. The live API exposes:
 *   /analyses              → [ { chart_name, time_field, fields:[{name,type}] } ]
 *   /analyses/{chart_name} → [ { timestamp, <dynamic numeric fields> } ]
 * Values and timestamps can come back as numbers or numeric strings.
 */
export const AnalysisChartMetaSchema = z.object({
  chart_name: z.string(),
  time_field: z.string().optional(),
  fields: z
    .array(z.object({ name: z.string(), type: z.string().optional() }))
    .default([]),
});

export const AnalysisCatalogResponseSchema = z.object({
  code: z.union([z.number(), z.string()]).optional(),
  data: z.array(AnalysisChartMetaSchema).default([]),
});

const NumericCell = z.union([z.number(), z.string()]).nullable().optional();
export const AnalysisRowSchema = z.record(z.string(), NumericCell);

export const AnalysisDataResponseSchema = z.object({
  code: z.union([z.number(), z.string()]).optional(),
  data: z.array(AnalysisRowSchema).default([]),
});

export type AnalysisRow = Record<string, number>;

function toNum(v: number | string | null | undefined): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v);
  return NaN;
}

export class AnalysisChartsModule {
  constructor(private readonly client: SoSoValueClient) {}

  /** Catalog of available analysis charts + their field schemas. Cache 24h. */
  async catalog() {
    const result = await this.client.fetch({
      path: '/analyses',
      method: 'GET',
      schema: AnalysisCatalogResponseSchema,
      cacheTtl: 60 * 60 * 24,
    });
    return result.data;
  }

  /**
   * Time series for a named chart. Rows are returned newest-first by the API;
   * numeric cells are coerced to numbers. Cache 30 min.
   */
  async data(chartName: string, limit = 60): Promise<AnalysisRow[]> {
    const result = await this.client.fetch({
      path: `/analyses/${encodeURIComponent(chartName)}`,
      method: 'GET',
      query: { limit },
      schema: AnalysisDataResponseSchema,
      cacheTtl: 30 * 60,
    });
    return result.data.map((row) => {
      const out: AnalysisRow = {};
      for (const [k, v] of Object.entries(row)) out[k] = toNum(v);
      return out;
    });
  }
}
