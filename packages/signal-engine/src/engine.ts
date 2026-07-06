import type { SoSoValue, EtfSymbol } from '@pod/sosovalue-sdk';
import {
  type PodSignal,
  type SignalContribution,
  type SignalDirection,
  type RiskProfile,
  RISK_PRESETS,
  type BasketAllocation,
} from './types.js';
import { etfFlowSignal } from './sources/etf-flow.js';
import { macroEventSignal } from './sources/macro-event.js';
import { newsSentimentSignal } from './sources/news-sentiment.js';
import { treasurySignal } from './sources/treasury.js';
import { fundraisingSignal } from './sources/fundraising.js';
import { socialSentimentSignal } from './sources/social-sentiment.js';
import { stablecoinLiquiditySignal } from './sources/stablecoin-liquidity.js';

type SourceKey =
  | 'ETF_FLOW'
  | 'MACRO_EVENT'
  | 'NEWS_SENTIMENT'
  | 'BTC_TREASURY'
  | 'VC_FUNDING'
  | 'SOCIAL_SENTIMENT'
  | 'STABLECOIN_LIQUIDITY';

const DEFAULT_SOURCES: ReadonlyArray<SourceKey> = [
  'ETF_FLOW',
  'MACRO_EVENT',
  'NEWS_SENTIMENT',
  'BTC_TREASURY',
  'SOCIAL_SENTIMENT',
  'STABLECOIN_LIQUIDITY',
];

export interface SignalRequest {
  asset: EtfSymbol;
  riskProfile: RiskProfile;
  /** Override which sources to run (default: all). */
  sources?: ReadonlyArray<SourceKey>;
}

export interface BatchOptions {
  /** Delay between per-asset bursts to stay under SoSoValue rate limits. */
  perAssetGapMs?: number;
}

/**
 * The Fusion Engine — combines multiple signal sources into one POD Score.
 *
 * Output shape:
 *   - direction: STRONG_SELL | SELL | HOLD | BUY | STRONG_BUY
 *   - podScore: 0-100 (logistic-squashed weighted z-score)
 *   - contributions: per-source breakdown
 *   - targetBasket: allocation that satisfies signal + risk profile
 *   - reasoning: plain-English summary
 */
export class SignalEngine {
  constructor(private readonly sso: SoSoValue) {}

  async generate(req: SignalRequest): Promise<PodSignal> {
    const sources = req.sources ?? DEFAULT_SOURCES;

    // Run sources in parallel, tolerate failures gracefully.
    const tasks: Array<Promise<SignalContribution | null>> = [];
    if (sources.includes('ETF_FLOW')) {
      tasks.push(safe(() => etfFlowSignal(this.sso, req.asset)));
    }
    if (sources.includes('MACRO_EVENT')) {
      tasks.push(safe(() => macroEventSignal(this.sso)));
    }
    if (sources.includes('NEWS_SENTIMENT')) {
      tasks.push(safe(() => newsSentimentSignal(this.sso, req.asset)));
    }
    if (sources.includes('BTC_TREASURY')) {
      tasks.push(safe(() => treasurySignal(this.sso, req.asset)));
    }
    if (sources.includes('VC_FUNDING')) {
      tasks.push(safe(() => fundraisingSignal(this.sso)));
    }
    if (sources.includes('SOCIAL_SENTIMENT')) {
      tasks.push(safe(() => socialSentimentSignal(req.asset)));
    }
    if (sources.includes('STABLECOIN_LIQUIDITY')) {
      tasks.push(safe(() => stablecoinLiquiditySignal(this.sso)));
    }

    const results = (await Promise.all(tasks)).filter((c): c is SignalContribution => c !== null);

    const compositeZ = weightedAverage(
      results.map((r) => ({ value: r.zScore, weight: r.weight })),
    );
    const podScore = Math.round((1 / (1 + Math.exp(-compositeZ))) * 100);
    const direction = scoreToDirection(compositeZ);
    const realCount = results.filter((c) => c.weight > 0).length;
    const uncertain = realCount < 3 || Math.abs(compositeZ) < 0.3;

    const targetBasket = buildTargetBasket(req.asset, req.riskProfile, compositeZ);
    const reasoning = composeReasoning(req.asset, direction, podScore, compositeZ, results);

    return {
      asset: req.asset,
      generated_at: new Date().toISOString(),
      direction,
      podScore,
      compositeZ,
      contributions: results,
      targetBasket,
      reasoning,
      uncertain,
    };
  }

  /**
   * Batch variant for fan-out scenarios (e.g. /bubbles fetching 10 assets).
   *
   * Hoists global sources (MACRO_EVENT, VC_FUNDING) — calls them once and reuses
   * the result across every asset, instead of fanning out 10x. Then runs the
   * per-asset sources serially with a configurable inter-asset gap so a
   * 10-asset request burst doesn't trip SoSoValue rate limits.
   */
  async generateBatch(
    requests: ReadonlyArray<SignalRequest>,
    options: BatchOptions = {},
  ): Promise<PodSignal[]> {
    const gapMs = options.perAssetGapMs ?? 120;

    // Union of every source any request asked for.
    const wanted = new Set<SourceKey>();
    for (const req of requests) {
      const list = req.sources ?? DEFAULT_SOURCES;
      for (const s of list) wanted.add(s);
    }

    // Pre-fetch globals once, in parallel — only if requested.
    const globalTasks: Array<Promise<SignalContribution | null>> = [];
    if (wanted.has('MACRO_EVENT')) {
      globalTasks.push(safe(() => macroEventSignal(this.sso)));
    }
    if (wanted.has('VC_FUNDING')) {
      globalTasks.push(safe(() => fundraisingSignal(this.sso)));
    }
    if (wanted.has('STABLECOIN_LIQUIDITY')) {
      globalTasks.push(safe(() => stablecoinLiquiditySignal(this.sso)));
    }
    const globals = (await Promise.all(globalTasks)).filter(
      (c): c is SignalContribution => c !== null,
    );

    const out: PodSignal[] = [];
    for (let i = 0; i < requests.length; i++) {
      const req = requests[i]!;
      const sources = req.sources ?? DEFAULT_SOURCES;

      const perAssetTasks: Array<Promise<SignalContribution | null>> = [];
      if (sources.includes('ETF_FLOW')) {
        perAssetTasks.push(safe(() => etfFlowSignal(this.sso, req.asset)));
      }
      if (sources.includes('NEWS_SENTIMENT')) {
        perAssetTasks.push(safe(() => newsSentimentSignal(this.sso, req.asset)));
      }
      if (sources.includes('BTC_TREASURY')) {
        perAssetTasks.push(safe(() => treasurySignal(this.sso, req.asset)));
      }
      if (sources.includes('SOCIAL_SENTIMENT')) {
        perAssetTasks.push(safe(() => socialSentimentSignal(req.asset)));
      }

      const perAsset = (await Promise.all(perAssetTasks)).filter(
        (c): c is SignalContribution => c !== null,
      );

      // Only carry global contributions this request actually asked for.
      const requestedGlobals = globals.filter((g) =>
        (sources as ReadonlyArray<SourceKey>).includes(g.source as SourceKey),
      );
      const contributions = [...perAsset, ...requestedGlobals];

      const compositeZ = weightedAverage(
        contributions.map((r) => ({ value: r.zScore, weight: r.weight })),
      );
      const podScore = Math.round((1 / (1 + Math.exp(-compositeZ))) * 100);
      const direction = scoreToDirection(compositeZ);
      const realCount = contributions.filter((c) => c.weight > 0).length;
      const uncertain = realCount < 3 || Math.abs(compositeZ) < 0.3;
      const targetBasket = buildTargetBasket(req.asset, req.riskProfile, compositeZ);
      const reasoning = composeReasoning(req.asset, direction, podScore, compositeZ, contributions);

      out.push({
        asset: req.asset,
        generated_at: new Date().toISOString(),
        direction,
        podScore,
        compositeZ,
        contributions,
        targetBasket,
        reasoning,
        uncertain,
      });

      if (i < requests.length - 1 && gapMs > 0) {
        await new Promise((r) => setTimeout(r, gapMs));
      }
    }

    return out;
  }
}

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    console.error('[signal-engine] source failed:', err);
    return null;
  }
}

function weightedAverage(items: Array<{ value: number; weight: number }>): number {
  let totalW = 0;
  let acc = 0;
  for (const i of items) {
    if (i.weight <= 0) continue;
    totalW += i.weight;
    acc += i.value * i.weight;
  }
  if (totalW === 0) return 0;
  return acc / totalW;
}

function scoreToDirection(z: number): SignalDirection {
  if (z >= 1.5) return 'STRONG_BUY';
  if (z >= 0.5) return 'BUY';
  if (z <= -1.5) return 'STRONG_SELL';
  if (z <= -0.5) return 'SELL';
  return 'HOLD';
}

/**
 * Build a target basket given the asset, risk profile, and composite z-score.
 *
 * For BALANCED + STRONG_BUY: 60% target asset, 25% diversifier, 15% stables.
 * For CHILL + STRONG_SELL: 5% target asset, 5% diversifier, 90% stables.
 */
function buildTargetBasket(
  asset: string,
  profile: RiskProfile,
  compositeZ: number,
): BasketAllocation[] {
  const risk = RISK_PRESETS[profile];

  // Risk-on weight scales with z-score, capped by profile's risk-on skew.
  const riskOnRaw = sigmoid(compositeZ);
  const riskOnTarget = riskOnRaw * risk.riskOnSkew;

  const stableTarget = Math.max(risk.minStableAllocation, 1 - riskOnTarget);
  const remaining = Math.max(0, 1 - stableTarget);

  // Allocate 70% of risk-on to the primary asset, 30% to a diversifier (ETH or BTC respectively).
  const primaryWeight = remaining * 0.7;
  const diversifierWeight = remaining * 0.3;
  const diversifier = asset === 'BTC' ? 'ETH' : 'BTC';

  return [
    { symbol: asset, weight: round4(primaryWeight) },
    { symbol: diversifier, weight: round4(diversifierWeight) },
    { symbol: 'USDC', weight: round4(stableTarget) },
  ].filter((b) => b.weight > 0);
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

function composeReasoning(
  asset: string,
  direction: SignalDirection,
  score: number,
  z: number,
  contributions: SignalContribution[],
): string {
  const dirVerb = {
    STRONG_BUY: 'Strong buy',
    BUY: 'Buy',
    HOLD: 'Hold',
    SELL: 'Reduce',
    STRONG_SELL: 'Defensive',
  }[direction];

  const top = [...contributions]
    .sort((a, b) => Math.abs(b.zScore * b.weight) - Math.abs(a.zScore * a.weight))
    .slice(0, 2);

  const drivers = top.map((c) => c.rationale).join(' ');

  return `${dirVerb} on ${asset} (POD Score ${score}, composite z=${z.toFixed(2)}). ${drivers}`;
}
