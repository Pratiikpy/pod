import type { SoSoValue } from '@pod/sosovalue-sdk';
import type { SignalContribution } from '../types.js';
import { mean } from '../stats.js';

/**
 * News sentiment signal — aggregates recent article sentiment for a symbol.
 * Falls back to simple keyword-based scoring when SoSoValue doesn't provide
 * a sentiment field directly.
 */
export async function newsSentimentSignal(
  sso: SoSoValue,
  asset: string,
): Promise<SignalContribution> {
  const articles = await sso.news.feed({ symbols: [asset], limit: 30 });

  if (articles.length === 0) {
    return {
      source: 'NEWS_SENTIMENT',
      weight: 0.15,
      zScore: 0,
      confidence: 50,
      rationale: `No recent news for ${asset}.`,
      citation: 'SoSoValue /news/feed',
    };
  }

  // Use API-provided sentiment if present; else fall back to importance × keyword polarity.
  const scored = articles.map((a) => {
    if (typeof a.sentiment === 'number') return a.sentiment;
    return keywordPolarity(`${a.title} ${a.summary ?? ''}`);
  });

  const avgSentiment = mean(scored); // ranges roughly [-1, 1]
  const z = avgSentiment * 2; // amplify so |z| ≈ 2 for very positive/negative news cycles
  const confidence = Math.round((1 / (1 + Math.exp(-z))) * 100);

  const tone =
    z > 0.8
      ? 'very bullish'
      : z > 0.3
        ? 'mildly bullish'
        : z < -0.8
          ? 'very bearish'
          : z < -0.3
            ? 'mildly bearish'
            : 'mixed';

  return {
    source: 'NEWS_SENTIMENT',
    weight: 0.15,
    zScore: z,
    confidence,
    rationale: `News sentiment for ${asset} is ${tone} (${articles.length} recent articles, avg score ${avgSentiment.toFixed(2)}).`,
    citation: 'SoSoValue /news/feed',
    data: { articleCount: articles.length, avgSentiment },
  };
}

const POSITIVE_TERMS = [
  'inflow',
  'inflows',
  'rally',
  'surge',
  'breakout',
  'all-time high',
  'institutional',
  'adoption',
  'approve',
  'approved',
  'buy',
  'bullish',
  'green',
  'gain',
  'jumps',
  'soars',
  'rises',
  'pumps',
  'moons',
  'new high',
];
const NEGATIVE_TERMS = [
  'outflow',
  'outflows',
  'crash',
  'plunge',
  'dump',
  'sell-off',
  'sell off',
  'liquidation',
  'liquidations',
  'rejection',
  'reject',
  'rejected',
  'bearish',
  'red',
  'loss',
  'falls',
  'drops',
  'tumbles',
  'rugs',
  'rug',
  'hack',
  'exploit',
  'scam',
  'fraud',
];

function keywordPolarity(text: string): number {
  const t = text.toLowerCase();
  let pos = 0;
  let neg = 0;
  for (const w of POSITIVE_TERMS) if (t.includes(w)) pos++;
  for (const w of NEGATIVE_TERMS) if (t.includes(w)) neg++;
  if (pos === 0 && neg === 0) return 0;
  return (pos - neg) / Math.max(pos + neg, 1);
}
