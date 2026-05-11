import type { SoSoValue } from '@pod/sosovalue-sdk';
import type { SignalContribution } from '../types.js';

/**
 * Macro event signal — pre-positions defensively before high-impact events
 * (FOMC, CPI, NFP). When a tier-1 macro event is within 24h, the signal
 * pushes toward a more defensive allocation regardless of other inputs.
 */
export async function macroEventSignal(sso: SoSoValue): Promise<SignalContribution> {
  const now = new Date();
  const horizonHours = 48;
  const horizonEnd = new Date(now.getTime() + horizonHours * 60 * 60 * 1000);

  const events = await sso.macro.events({
    from: now.toISOString().slice(0, 10),
    to: horizonEnd.toISOString().slice(0, 10),
    importance: 3, // tier-1 events only
    limit: 20,
  });

  // Filter to events that haven't yet occurred but are within horizon.
  // Treat unparseable dates as "not in window" rather than crashing.
  const upcoming = events.filter((e) => {
    const t = new Date(e.scheduled_at).getTime();
    if (Number.isNaN(t)) return false;
    return t >= now.getTime() && t <= horizonEnd.getTime();
  });

  if (upcoming.length === 0) {
    return {
      source: 'MACRO_EVENT',
      weight: 0.15,
      zScore: 0,
      confidence: 50,
      rationale: 'No tier-1 macro events in the next 48h.',
      citation: 'SoSoValue /macro/events',
    };
  }

  // The closer + higher-importance the event, the more defensive we get.
  const next = upcoming[0]!;
  const hoursAway = (new Date(next.scheduled_at).getTime() - now.getTime()) / (60 * 60 * 1000);
  const proximityScore = Math.max(0, 1 - hoursAway / horizonHours); // 1 = imminent, 0 = at edge

  // Defensive bias: negative z, scaled by proximity.
  const z = -1.5 * proximityScore;
  const confidence = Math.round((1 / (1 + Math.exp(-z))) * 100);

  return {
    source: 'MACRO_EVENT',
    weight: 0.15,
    zScore: z,
    confidence,
    rationale:
      `${next.name} in ${hoursAway.toFixed(1)}h — pre-positioning defensively ` +
      `(${upcoming.length} tier-1 event${upcoming.length === 1 ? '' : 's'} in 48h).`,
    citation: 'SoSoValue /macro/events',
    data: {
      nextEvent: next.name,
      hoursAway,
      upcomingCount: upcoming.length,
    },
  };
}
