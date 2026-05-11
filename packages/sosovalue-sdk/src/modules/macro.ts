import { z } from 'zod';
import type { SoSoValueClient } from '../client.js';

// Permissive schema — the live API returns events in different shapes per region/category.
// We extract what we can and tolerate the rest.
export const MacroEventSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    name: z.string().optional(),
    title: z.string().optional(), // some events use 'title' instead of 'name'
    event: z.string().optional(),
    category: z.string().optional(),
    country: z.string().optional(),
    region: z.string().optional(),
    scheduled_at: z.string().optional(),
    timestamp: z.union([z.string(), z.number()]).optional(),
    date: z.string().optional(),
    importance: z.union([z.string(), z.number()]).optional(),
    actual: z.union([z.string(), z.number()]).nullable().optional(),
    forecast: z.union([z.string(), z.number()]).nullable().optional(),
    previous: z.union([z.string(), z.number()]).nullable().optional(),
    unit: z.string().optional(),
  })
  .passthrough();

export type MacroEvent = z.infer<typeof MacroEventSchema>;

export const MacroEventsResponseSchema = z
  .object({
    code: z.union([z.number(), z.string()]).optional(),
    data: z.array(MacroEventSchema).default([]),
    msg: z.string().optional(),
  })
  .passthrough();

export class MacroModule {
  constructor(private readonly client: SoSoValueClient) {}

  async events(params?: { from?: string; to?: string; importance?: number; limit?: number }) {
    const result = await this.client.fetch({
      path: '/macro/events',
      method: 'GET',
      query: {
        from: params?.from,
        to: params?.to,
        importance: params?.importance,
        limit: params?.limit ?? 50,
      },
      schema: MacroEventsResponseSchema,
      cacheTtl: 30 * 60,
    });
    // Normalise: every event needs a `name` and `scheduled_at` for downstream code.
    return result.data
      .map(normalise)
      .filter((e): e is NormalisedMacroEvent => e !== null);
  }

  async eventHistory(params: { eventCode: string; limit?: number }) {
    const result = await this.client.fetch({
      path: `/macro/events/${encodeURIComponent(params.eventCode)}/history`,
      method: 'GET',
      query: { limit: params.limit ?? 30 },
      schema: MacroEventsResponseSchema,
      cacheTtl: 60 * 60 * 24,
    });
    return result.data
      .map(normalise)
      .filter((e): e is NormalisedMacroEvent => e !== null);
  }
}

export interface NormalisedMacroEvent {
  id: string;
  name: string;
  scheduled_at: string;
  importance: number;
  category?: string;
  country?: string;
  actual?: string | number | null | undefined;
  forecast?: string | number | null | undefined;
  previous?: string | number | null | undefined;
}

function normalise(raw: MacroEvent): NormalisedMacroEvent | null {
  const name = raw.name ?? raw.title ?? raw.event;
  const scheduled =
    raw.scheduled_at ??
    raw.date ??
    (typeof raw.timestamp === 'number'
      ? new Date(raw.timestamp).toISOString()
      : typeof raw.timestamp === 'string'
        ? raw.timestamp
        : undefined);
  if (!name || !scheduled) return null;

  const importance =
    typeof raw.importance === 'number'
      ? raw.importance
      : typeof raw.importance === 'string'
        ? Number(raw.importance) || 1
        : 1;

  const out: NormalisedMacroEvent = {
    id: raw.id !== undefined ? String(raw.id) : `${name}-${scheduled}`,
    name,
    scheduled_at: scheduled,
    importance,
  };
  if (raw.category !== undefined) out.category = raw.category;
  if (raw.country !== undefined) out.country = raw.country;
  if (raw.actual !== undefined) out.actual = raw.actual;
  if (raw.forecast !== undefined) out.forecast = raw.forecast;
  if (raw.previous !== undefined) out.previous = raw.previous;
  return out;
}
