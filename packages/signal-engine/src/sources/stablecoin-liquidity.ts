import type { SoSoValue } from '@pod/sosovalue-sdk';
import type { SignalContribution } from '../types.js';
import { zScore, clamp } from '../stats.js';

/**
 * Stablecoin liquidity signal — the "dry powder" tide. When the total
 * stablecoin market cap expands, fresh capital is entering the system and is
 * available to bid risk; when it contracts, capital is leaving. We z-score the
 * latest daily change in total stablecoin supply against its recent
 * distribution. A structural, market-wide (non per-asset) input.
 *
 * Source: SoSoValue /analyses/stablecoin_total_market_cap (field `mcap`).
 */
export async function stablecoinLiquiditySignal(sso: SoSoValue): Promise<SignalContribution> {
  const rows = await sso.charts.data('stablecoin_total_market_cap', 35);

  // Keep valid points (filter API anomalies where mcap collapses to a tiny
  // number), sort ascending by time.
  const series = rows
    .map((r) => ({ t: r['timestamp'] ?? 0, mcap: r['mcap'] ?? NaN }))
    .filter((p) => Number.isFinite(p.mcap) && p.mcap > 1e9 && Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);

  if (series.length < 6) {
    return {
      source: 'STABLECOIN_LIQUIDITY',
      weight: 0,
      zScore: 0,
      confidence: 50,
      rationale: 'Insufficient stablecoin supply history.',
      citation: 'SoSoValue /analyses/stablecoin_total_market_cap',
    };
  }

  const deltas: number[] = [];
  for (let i = 1; i < series.length; i++) {
    deltas.push(series[i]!.mcap - series[i - 1]!.mcap);
  }
  const latestDelta = deltas[deltas.length - 1]!;
  const baseline = deltas.slice(0, -1);
  const z = clamp(zScore(latestDelta, baseline), -2.5, 2.5);
  const confidence = Math.round((1 / (1 + Math.exp(-z))) * 100);

  const latestMcap = series[series.length - 1]!.mcap;
  const dir = latestDelta >= 0 ? 'entering' : 'leaving';
  const deltaAbs = Math.abs(latestDelta);
  const deltaStr = deltaAbs >= 1e9 ? `$${(deltaAbs / 1e9).toFixed(2)}B` : `$${(deltaAbs / 1e6).toFixed(0)}M`;

  return {
    source: 'STABLECOIN_LIQUIDITY',
    weight: 0.1,
    zScore: z,
    confidence,
    rationale:
      `Stablecoin supply $${(latestMcap / 1e9).toFixed(1)}B, ${latestDelta >= 0 ? '+' : '-'}${deltaStr} latest ` +
      `(${z >= 0 ? '+' : ''}${z.toFixed(2)}σ) — dry powder ${dir}.`,
    citation: 'SoSoValue /analyses/stablecoin_total_market_cap',
    data: { latestMcap, latestDelta },
  };
}
