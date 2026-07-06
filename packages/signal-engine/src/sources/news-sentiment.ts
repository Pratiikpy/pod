import type { SoSoValue } from '@pod/sosovalue-sdk';
import type { SignalContribution } from '../types.js';
import { clamp } from '../stats.js';

/**
 * News sentiment signal — reads SoSoValue's live news feed, keeps items that
 * mention the asset within the last few days, and scores their tone with a
 * keyword-polarity model weighted by recency (newer news counts more). The
 * SoSoValue feed has no sentiment field, so tone is derived from the text.
 * When no relevant recent news exists, the source stays silent (weight 0).
 */

/** Asset → the terms that identify it in a headline / tags. Full names only,
 *  to avoid false positives from short tickers ("link", "dot", "sol"). */
const ASSET_TERMS: Record<string, string[]> = {
  BTC: ['bitcoin', 'btc'],
  ETH: ['ethereum', 'ether ', 'eth '],
  SOL: ['solana'],
  XRP: ['xrp', 'ripple'],
  DOGE: ['dogecoin', 'doge'],
  AVAX: ['avalanche', 'avax'],
  LINK: ['chainlink'],
  LTC: ['litecoin'],
  DOT: ['polkadot'],
  HBAR: ['hedera', 'hbar'],
};

const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

export async function newsSentimentSignal(
  sso: SoSoValue,
  asset: string,
): Promise<SignalContribution> {
  const items = await sso.news.feed({ pageSize: 60 });
  const now = Date.now();
  const terms = ASSET_TERMS[asset] ?? [asset.toLowerCase()];

  const relevant = items.filter((it) => {
    if (it.releaseTime !== undefined && now - it.releaseTime > MAX_AGE_MS) return false;
    const tagHit = it.tags.some((t) => terms.some((term) => t.toLowerCase().includes(term.trim())));
    if (tagHit) return true;
    const hay = `${it.title} ${it.content ?? ''}`.toLowerCase();
    return terms.some((term) => hay.includes(term));
  });

  if (relevant.length === 0) {
    return {
      source: 'NEWS_SENTIMENT',
      weight: 0,
      zScore: 0,
      confidence: 50,
      rationale: `No recent news mentioning ${asset}.`,
      citation: 'SoSoValue /news',
      data: { articleCount: 0 },
    };
  }

  // Recency-weighted average polarity (newer news weighted higher).
  let wSum = 0;
  let acc = 0;
  for (const it of relevant) {
    const ageMs = it.releaseTime !== undefined ? now - it.releaseTime : MAX_AGE_MS / 2;
    const recency = clamp(1 - ageMs / MAX_AGE_MS, 0.1, 1); // 1 = fresh, 0.1 = old
    const polarity = keywordPolarity(`${it.title} ${it.content ?? ''}`);
    acc += polarity * recency;
    wSum += recency;
  }
  const avgPolarity = wSum > 0 ? acc / wSum : 0; // ~[-1, 1]
  const z = clamp(avgPolarity * 2, -2.5, 2.5);
  const confidence = Math.round((1 / (1 + Math.exp(-z))) * 100);

  const tone =
    z > 0.8 ? 'bullish' : z > 0.3 ? 'mildly bullish' : z < -0.8 ? 'bearish' : z < -0.3 ? 'mildly bearish' : 'mixed';

  return {
    source: 'NEWS_SENTIMENT',
    weight: 0.15,
    zScore: z,
    confidence,
    rationale: `News tone for ${asset} is ${tone} across ${relevant.length} recent article${relevant.length === 1 ? '' : 's'} (${z >= 0 ? '+' : ''}${z.toFixed(2)}σ).`,
    citation: 'SoSoValue /news',
    data: { articleCount: relevant.length, avgPolarity },
  };
}

const POSITIVE_TERMS = [
  'inflow', 'inflows', 'rally', 'surge', 'surges', 'breakout', 'all-time high', 'record high',
  'institutional', 'adoption', 'approve', 'approved', 'approval', 'bullish', 'gain', 'gains',
  'jumps', 'soars', 'rises', 'rally', 'pumps', 'accumulate', 'accumulation', 'upgrade', 'partnership',
];
const NEGATIVE_TERMS = [
  'outflow', 'outflows', 'crash', 'plunge', 'plunges', 'dump', 'sell-off', 'selloff', 'liquidation',
  'liquidations', 'rejection', 'reject', 'rejected', 'bearish', 'loss', 'losses', 'falls', 'drops',
  'tumbles', 'slumps', 'rug', 'hack', 'hacked', 'exploit', 'scam', 'fraud', 'lawsuit', 'ban', 'delay',
];

function keywordPolarity(text: string): number {
  const t = text.toLowerCase();
  let pos = 0;
  let neg = 0;
  for (const w of POSITIVE_TERMS) if (t.includes(w)) pos++;
  for (const w of NEGATIVE_TERMS) if (t.includes(w)) neg++;
  if (pos === 0 && neg === 0) return 0;
  return (pos - neg) / (pos + neg);
}
