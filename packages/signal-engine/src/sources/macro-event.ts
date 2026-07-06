import type { SoSoValue } from '@pod/sosovalue-sdk';
import type { SignalContribution } from '../types.js';
import { clamp } from '../stats.js';

/**
 * Macro event signal — an event-driven defensive overlay. When a tier-1
 * macro release (CPI, FOMC/rate decision, jobs, PPI, GDP, PCE) is scheduled
 * within the next 48h, the signal leans defensive (negative z) scaled by how
 * close the event is. When no tier-1 event is near, it stays silent
 * (weight 0) rather than diluting the composite toward neutral.
 *
 * The live `/macro/events` calendar returns event names + dates only, so we
 * match names against a tier-1 pattern list.
 */
const TIER1_PATTERNS: RegExp[] = [
  /\bCPI\b/i,
  /core cpi/i,
  /\bPCE\b/i,
  /\bPPI\b/i,
  /\bGDP\b/i,
  /nonfarm|non-farm|\bNFP\b/i,
  /unemployment rate/i,
  /jobless claims/i,
  /\bFOMC\b/i,
  /interest rate decision|rate decision|fed funds|federal funds/i,
  /fed chair|powell|fed speaks/i,
];

function isTier1(name: string): boolean {
  return TIER1_PATTERNS.some((re) => re.test(name));
}

export async function macroEventSignal(sso: SoSoValue): Promise<SignalContribution> {
  const events = await sso.macro.events();

  // Day-granular horizon: today + next 2 days (≈48h).
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const dayMs = 24 * 60 * 60 * 1000;
  const startOfToday = new Date(`${todayStr}T00:00:00Z`).getTime();
  const horizonEnd = startOfToday + 2 * dayMs;

  const upcoming = events
    .filter((e) => isTier1(e.name))
    .map((e) => ({ ...e, t: new Date(`${e.date}T00:00:00Z`).getTime() }))
    .filter((e) => !Number.isNaN(e.t) && e.t >= startOfToday && e.t <= horizonEnd)
    .sort((a, b) => a.t - b.t);

  if (upcoming.length === 0) {
    return {
      source: 'MACRO_EVENT',
      weight: 0,
      zScore: 0,
      confidence: 50,
      rationale: 'No tier-1 macro events (CPI, FOMC, jobs) scheduled in the next 48h.',
      citation: 'SoSoValue /macro/events',
      data: { upcomingCount: 0 },
    };
  }

  const next = upcoming[0]!;
  const daysAway = (next.t - startOfToday) / dayMs;
  // Proximity 1.0 = today, 0.0 = at the 2-day edge.
  const proximity = clamp(1 - daysAway / 2, 0, 1);
  const z = -1.2 * proximity; // defensive bias
  const confidence = Math.round((1 / (1 + Math.exp(-z))) * 100);

  return {
    source: 'MACRO_EVENT',
    weight: 0.15,
    zScore: z,
    confidence,
    rationale:
      `${next.name} on ${next.date} — leaning defensive before the release ` +
      `(${upcoming.length} tier-1 event${upcoming.length === 1 ? '' : 's'} within 48h).`,
    citation: 'SoSoValue /macro/events',
    data: {
      nextEvent: next.name,
      nextDate: next.date,
      daysAway,
      upcomingCount: upcoming.length,
    },
  };
}
