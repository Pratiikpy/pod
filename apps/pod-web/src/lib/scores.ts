import type { SignalDirection } from '@pod/signal-engine';
import { fetchAllBubbleData } from './bubble-data';

export interface PublicScore {
  asset: string;
  name: string;
  direction: SignalDirection;
  podScore: number;
  compositeZ: number;
  summary: string;
  sources: number;
  uncertain: boolean;
  generatedAt: string;
}

/**
 * Public POD Scores for all ten tracked assets. Reads the same 10-minute
 * cached bubble fan-out the dashboard uses, so `/api/scores`, `/bubbles`, and
 * the Telegram bot never disagree. Falls back to neutral placeholders when no
 * SoSoValue key is configured (handled inside the cache).
 */
export async function fetchPublicScores(): Promise<PublicScore[]> {
  const bubbles = await fetchAllBubbleData();
  return bubbles.map((b) => ({
    asset: b.asset,
    name: b.name,
    direction: b.direction,
    podScore: b.score,
    compositeZ: Number(b.z.toFixed(3)),
    summary: b.reasoning,
    sources: b.contributions.filter((c) => c.weight > 0).length,
    uncertain: b.uncertain,
    generatedAt: b.generatedAt,
  }));
}
