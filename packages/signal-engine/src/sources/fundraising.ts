import type { SoSoValue } from '@pod/sosovalue-sdk';
import type { SignalContribution } from '../types.js';

/**
 * VC funding signal — measures whether venture capital is actively
 * deploying into crypto sectors. Rising funding velocity → bullish
 * structural signal.
 */
export async function fundraisingSignal(sso: SoSoValue): Promise<SignalContribution> {
  const [recent30, prior30] = await Promise.all([
    sso.fundraising.list({ days: 30, limit: 100 }),
    sso.fundraising.list({ days: 60, limit: 200 }),
  ]);

  const recentTotal = sumAmount(recent30);
  // prior30 returns 60-day window; subtract recent to get prior 30.
  const priorTotal = Math.max(0, sumAmount(prior30) - recentTotal);

  if (recentTotal === 0 && priorTotal === 0) {
    return {
      source: 'VC_FUNDING',
      weight: 0.05,
      zScore: 0,
      confidence: 50,
      rationale: 'No VC funding data available.',
      citation: 'SoSoValue /fundraising/list',
    };
  }

  const ratio = priorTotal === 0 ? 1.5 : recentTotal / priorTotal;
  // ratio = 1.0 means flat. > 1.5 = strong acceleration. < 0.5 = collapse.
  const z = Math.min(2.5, Math.max(-2.5, (ratio - 1) * 2));
  const confidence = Math.round((1 / (1 + Math.exp(-z))) * 100);

  return {
    source: 'VC_FUNDING',
    weight: 0.05,
    zScore: z,
    confidence,
    rationale:
      `VC deployed $${(recentTotal / 1e6).toFixed(0)}M in last 30d vs $${(priorTotal / 1e6).toFixed(0)}M prior 30d ` +
      `(${ratio >= 1 ? '+' : ''}${((ratio - 1) * 100).toFixed(0)}%).`,
    citation: 'SoSoValue /fundraising/list',
    data: { recentTotal, priorTotal, ratio },
  };
}

function sumAmount(rounds: Array<{ amount_usd?: number | undefined }>): number {
  return rounds.reduce((acc, r) => acc + (r.amount_usd ?? 0), 0);
}
