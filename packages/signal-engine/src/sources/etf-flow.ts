import type { SoSoValue } from '@pod/sosovalue-sdk';
import { type EtfSymbol } from '@pod/sosovalue-sdk';
import type { SignalContribution } from '../types.js';
import { mean, stdev, zScore } from '../stats.js';

/**
 * ETF Flow signal — POD's flagship alpha source.
 *
 * Computes the z-score of yesterday's `total_net_inflow` against the
 * trailing 30-day distribution. Strong positive z = institutional money
 * surging in → buy signal. Strong negative z = redemptions → de-risk.
 *
 * Backed by academic research:
 *   - Unexpected ETF flows yield 14% annualised returns, Sharpe 0.88 (QuantPedia)
 *   - Most powerful signals exceed +1σ of 90-day rolling baseline (CFRA)
 */
export async function etfFlowSignal(
  sso: SoSoValue,
  asset: EtfSymbol,
  options: { lookbackDays?: number } = {},
): Promise<SignalContribution> {
  const lookback = options.lookbackDays ?? 30;
  const history = await sso.etf.summaryHistory({
    symbol: asset,
    country_code: 'US',
    limit: lookback,
  });

  if (history.length < 5) {
    return {
      source: 'ETF_FLOW',
      weight: 0,
      zScore: 0,
      confidence: 50,
      rationale: `Insufficient ETF data for ${asset} (only ${history.length} days available).`,
    };
  }

  // SoSoValue returns reverse-chronological (latest first).
  const latest = history[0]!;
  const baseline = history.slice(1).map((r) => r.total_net_inflow);

  const z = zScore(latest.total_net_inflow, baseline);
  const baselineMean = mean(baseline);
  const baselineStd = stdev(baseline);

  // Sigmoid-style confidence (centred at 50)
  const confidence = Math.round((1 / (1 + Math.exp(-z))) * 100);

  const direction = z > 1.5 ? 'strong inflow' : z > 0.5 ? 'mild inflow' : z < -1.5 ? 'strong outflow' : z < -0.5 ? 'mild outflow' : 'flat';
  const inflowDollars = formatUsd(latest.total_net_inflow);
  const baselineDollars = formatUsd(baselineMean);

  const rationale =
    `${asset} ETF flow ${direction}: ${inflowDollars} on ${latest.date} ` +
    `(${z >= 0 ? '+' : ''}${z.toFixed(2)}σ from ${lookback}d mean of ${baselineDollars}, ` +
    `±${formatUsd(baselineStd)} 1-stdev).`;

  return {
    source: 'ETF_FLOW',
    weight: 0.3, // primary signal — heaviest weight
    zScore: z,
    confidence,
    rationale,
    citation: `SoSoValue /etfs/summary-history (${lookback}d)`,
    data: {
      latestDate: latest.date,
      latestInflow: latest.total_net_inflow,
      baselineMean,
      baselineStd,
      lookback,
    },
  };
}

function formatUsd(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}
