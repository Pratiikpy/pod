import { z } from 'zod';
import type { SoSoValueClient } from '../client.js';

/**
 * Macro calendar. The live `/macro/events` endpoint returns a list of days,
 * each with an array of event names (no importance/actual/forecast on the
 * calendar itself — those live in `/macro/events/{event}/history`).
 *
 *   { code, data: [ { date: "2026-07-13", events: ["CPI (MoM)", ...] } ] }
 */
export const MacroDaySchema = z.object({
  date: z.string(),
  events: z.array(z.string()).default([]),
});
export type MacroDay = z.infer<typeof MacroDaySchema>;

export const MacroEventsResponseSchema = z
  .object({
    code: z.union([z.number(), z.string()]).optional(),
    data: z.array(MacroDaySchema).default([]),
    message: z.string().optional(),
  })
  .passthrough();

export interface MacroEvent {
  /** Event name, e.g. "CPI (MoM)". */
  name: string;
  /** ISO date (day granularity) the event is scheduled for. */
  date: string;
}

/** One row of an event's release history. */
export const MacroEventHistoryRowSchema = z.object({
  date: z.string(),
  actual: z.union([z.string(), z.number()]).nullable().optional(),
  forecast: z.union([z.string(), z.number()]).nullable().optional(),
  previous: z.union([z.string(), z.number()]).nullable().optional(),
});
export type MacroEventHistoryRow = z.infer<typeof MacroEventHistoryRowSchema>;

export const MacroEventHistoryResponseSchema = z
  .object({
    code: z.union([z.number(), z.string()]).optional(),
    data: z.array(MacroEventHistoryRowSchema).default([]),
    message: z.string().optional(),
  })
  .passthrough();

export class MacroModule {
  constructor(private readonly client: SoSoValueClient) {}

  /**
   * Upcoming macro calendar, flattened to one entry per (event, date).
   * Sorted ascending by date. Cache 30 min.
   */
  async events(): Promise<MacroEvent[]> {
    const result = await this.client.fetch({
      path: '/macro/events',
      method: 'GET',
      schema: MacroEventsResponseSchema,
      cacheTtl: 30 * 60,
    });
    const flat: MacroEvent[] = [];
    for (const day of result.data) {
      for (const name of day.events) {
        flat.push({ name, date: day.date });
      }
    }
    flat.sort((a, b) => a.date.localeCompare(b.date));
    return flat;
  }

  /**
   * Release history for a single named event (actual vs forecast vs previous).
   * Key is the event name, e.g. "Nonfarm Payrolls". Cache 24h.
   */
  async eventHistory(eventName: string, limit = 12): Promise<MacroEventHistoryRow[]> {
    const result = await this.client.fetch({
      path: `/macro/events/${encodeURIComponent(eventName)}/history`,
      method: 'GET',
      query: { limit },
      schema: MacroEventHistoryResponseSchema,
      cacheTtl: 60 * 60 * 24,
    });
    return result.data;
  }
}
