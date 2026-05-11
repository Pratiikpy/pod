import type { SoSoValue } from '@pod/sosovalue-sdk';
import type { SignalContribution } from '../types.js';

/**
 * BTC Treasury signal — detects smart-money corporate accumulation.
 * When MicroStrategy / Tesla / Marathon / Coinbase add to BTC holdings,
 * it's a positive structural signal even if short-term flow data is mixed.
 */
export async function treasurySignal(
  sso: SoSoValue,
  asset: string,
): Promise<SignalContribution> {
  // Only meaningful for BTC right now (treasury data is BTC-centric).
  if (asset !== 'BTC') {
    return {
      source: 'BTC_TREASURY',
      weight: 0,
      zScore: 0,
      confidence: 50,
      rationale: 'Treasury signal applies to BTC only.',
    };
  }

  const recent = await sso.treasury.recentAcquisitions({ days: 30, limit: 50 });

  if (recent.length === 0) {
    return {
      source: 'BTC_TREASURY',
      weight: 0.1,
      zScore: 0,
      confidence: 50,
      rationale: 'No corporate BTC acquisitions in the last 30 days.',
      citation: 'SoSoValue /treasury/acquisitions',
    };
  }

  const totalBtc = recent.reduce((acc, r) => acc + r.btc_amount, 0);
  const totalUsd = recent.reduce((acc, r) => acc + (r.usd_amount ?? 0), 0);

  // Heuristic: > 5,000 BTC of corporate buying in 30d is a strong signal.
  // Scale to a z-score-ish range.
  const z = Math.min(2.5, Math.max(-2.5, (totalBtc - 2500) / 2500));
  const confidence = Math.round((1 / (1 + Math.exp(-z))) * 100);

  return {
    source: 'BTC_TREASURY',
    weight: 0.1,
    zScore: z,
    confidence,
    rationale:
      `Corporate treasuries added ${totalBtc.toFixed(0)} BTC (~$${(totalUsd / 1e9).toFixed(2)}B) ` +
      `in the last 30 days — ${z > 1 ? 'strong' : z > 0 ? 'mild' : 'limited'} smart-money confirmation.`,
    citation: 'SoSoValue /treasury/acquisitions',
    data: { totalBtc, totalUsd, acquisitionCount: recent.length },
  };
}
