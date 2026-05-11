import { unstable_cache } from 'next/cache';
import { SoSoValue, type EtfSymbol } from '@pod/sosovalue-sdk';
import {
  SignalEngine,
  type SignalContribution,
  type SignalDirection,
  type SignalRequest,
  type BasketAllocation,
} from '@pod/signal-engine';

export interface BubbleData {
  asset: EtfSymbol;
  name: string;
  /** POD Score 0–100. */
  score: number;
  direction: SignalDirection;
  /** Composite z-score from the signal engine — drives pulse intensity. */
  z: number;
  /** Plain-language reasoning, 1 sentence. */
  reasoning: string;
  /** Top citation (e.g. "BTC ETF flow mild outflow: -$137.8M on 2026-04-29"). */
  citation: string;
  /** Per-source breakdown — drives the drawer "Why this score" panel. */
  contributions: SignalContribution[];
  /** Target basket allocation (risk-profile BALANCED) — used by the bot's /trade flow. */
  targetBasket: BasketAllocation[];
  /** Approximate ETF AUM rank — drives bubble size. */
  rank: number;
  uncertain: boolean;
  generatedAt: string;
}

const TRACKED: Array<{ asset: EtfSymbol; name: string; rank: number }> = [
  { asset: 'BTC', name: 'Bitcoin', rank: 1 },
  { asset: 'ETH', name: 'Ethereum', rank: 2 },
  { asset: 'SOL', name: 'Solana', rank: 3 },
  { asset: 'XRP', name: 'XRP', rank: 4 },
  { asset: 'DOGE', name: 'Dogecoin', rank: 5 },
  { asset: 'AVAX', name: 'Avalanche', rank: 6 },
  { asset: 'LINK', name: 'Chainlink', rank: 7 },
  { asset: 'LTC', name: 'Litecoin', rank: 8 },
  { asset: 'DOT', name: 'Polkadot', rank: 9 },
  { asset: 'HBAR', name: 'Hedera', rank: 10 },
];

const ALL_SOURCES = [
  'ETF_FLOW',
  'MACRO_EVENT',
  'NEWS_SENTIMENT',
  'BTC_TREASURY',
  'VC_FUNDING',
] as const;

function citationFromReasoning(text: string): string {
  const m = text.match(/[A-Z]{2,5} ETF flow[^.]+\./);
  if (m) return m[0];
  return text.split('.')[0] + '.';
}

function fallbackBubble(t: { asset: EtfSymbol; name: string; rank: number }, reason: string): BubbleData {
  return {
    asset: t.asset,
    name: t.name,
    score: 50,
    direction: 'HOLD' as SignalDirection,
    z: 0,
    reasoning: reason,
    citation: 'No live data',
    contributions: [],
    targetBasket: [
      { symbol: t.asset, weight: 0.25 },
      { symbol: t.asset === 'BTC' ? 'ETH' : 'BTC', weight: 0.1 },
      { symbol: 'USDC', weight: 0.65 },
    ],
    rank: t.rank,
    uncertain: true,
    generatedAt: new Date().toISOString(),
  };
}

async function fetchAllBubbleDataInner(): Promise<BubbleData[]> {
  const apiKey = process.env['SOSOVALUE_API_KEY'];
  if (!apiKey) {
    return TRACKED.map((t) => fallbackBubble(t, 'Set SOSOVALUE_API_KEY to see live signals.'));
  }

  const sso = new SoSoValue({ apiKey });
  const engine = new SignalEngine(sso);

  const requests: SignalRequest[] = TRACKED.map((t) => ({
    asset: t.asset,
    riskProfile: 'BALANCED',
    sources: ALL_SOURCES,
  }));

  let signals;
  try {
    signals = await engine.generateBatch(requests, { perAssetGapMs: 120 });
  } catch (err) {
    console.error('[bubble-data] generateBatch failed:', err);
    return TRACKED.map((t) => fallbackBubble(t, 'Signal temporarily unavailable.'));
  }

  return TRACKED.map((t, i) => {
    const signal = signals[i];
    if (!signal) {
      return fallbackBubble(t, 'Signal temporarily unavailable.');
    }
    return {
      asset: t.asset,
      name: t.name,
      score: signal.podScore,
      direction: signal.direction,
      z: signal.compositeZ,
      reasoning: signal.reasoning,
      citation: citationFromReasoning(signal.reasoning),
      contributions: signal.contributions,
      targetBasket: signal.targetBasket,
      rank: t.rank,
      uncertain: signal.uncertain,
      generatedAt: signal.generated_at,
    };
  });
}

/** Single-asset lookup against the same cached fan-out the web UI uses. */
export async function getBubble(asset: EtfSymbol): Promise<BubbleData | undefined> {
  const all = await fetchAllBubbleData();
  return all.find((b) => b.asset === asset);
}

// 10-minute TTL on the SoSoValue fan-out so we don't slam free-tier limits.
// Stale-while-revalidate behaviour: first request after expiry returns last
// cached value while a fresh fetch fills the cache for the next request.
export const fetchAllBubbleData = unstable_cache(
  fetchAllBubbleDataInner,
  ['bubble-data-v2'],
  { revalidate: 600, tags: ['bubbles'] },
);
