import type { SoSoValue } from '@pod/sosovalue-sdk';
import type { SignalContribution } from '../types.js';
import { clamp } from '../stats.js';

/**
 * BTC Treasury signal — corporate accumulation as a structural bull signal.
 * Sums BTC acquired across the largest public treasuries (MSTR, MARA,
 * Metaplanet, …) over the last 30 days. Heavy corporate buying is smart-money
 * confirmation even when short-term ETF flow is mixed. One-sided: strong
 * accumulation is bullish, its absence is neutral (weight 0), never bearish.
 *
 * Applies to BTC only (the dataset is BTC-centric).
 */
const TOP_N = 5; // sample the largest holders to stay under the rate limit
const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

export async function treasurySignal(sso: SoSoValue, asset: string): Promise<SignalContribution> {
  if (asset !== 'BTC') {
    return {
      source: 'BTC_TREASURY',
      weight: 0,
      zScore: 0,
      confidence: 50,
      rationale: 'Treasury signal applies to BTC only.',
    };
  }

  const holders = await sso.treasury.list({ pageSize: 30 });
  const top = holders.slice(0, TOP_N);
  const cutoff = Date.now() - LOOKBACK_MS;

  let totalBtc = 0;
  let totalUsd = 0;
  const contributors: string[] = [];

  const histories = await Promise.all(
    top.map((h) => sso.treasury.purchaseHistory(h.ticker, { limit: 12 }).catch(() => [])),
  );

  top.forEach((h, i) => {
    let added = 0;
    for (const row of histories[i] ?? []) {
      const t = new Date(`${row.date}T00:00:00Z`).getTime();
      if (!Number.isNaN(t) && t >= cutoff) {
        added += row.btcAcquired;
        totalUsd += row.acqCostUsd;
      }
    }
    if (added > 0) {
      totalBtc += added;
      contributors.push(h.name ?? h.ticker);
    }
  });

  if (totalBtc <= 0) {
    return {
      source: 'BTC_TREASURY',
      weight: 0,
      zScore: 0,
      confidence: 50,
      rationale: 'No corporate BTC accumulation among top treasuries in the last 30 days.',
      citation: 'SoSoValue /btc-treasuries',
      data: { totalBtc: 0 },
    };
  }

  // 3,000 BTC/30d ≈ +1σ; 7,500 ≈ +2.5σ. One-sided (floor at 0).
  const z = clamp(totalBtc / 3000, 0, 2.5);
  const confidence = Math.round((1 / (1 + Math.exp(-z))) * 100);
  const who = contributors.slice(0, 3).join(', ');

  return {
    source: 'BTC_TREASURY',
    weight: 0.1,
    zScore: z,
    confidence,
    rationale:
      `Corporate treasuries added ${Math.round(totalBtc).toLocaleString()} BTC` +
      `${totalUsd > 0 ? ` (~$${(totalUsd / 1e9).toFixed(2)}B)` : ''} in the last 30 days` +
      `${who ? ` — led by ${who}` : ''} (${z >= 1 ? 'strong' : 'mild'} accumulation).`,
    citation: 'SoSoValue /btc-treasuries/{ticker}/purchase-history',
    data: { totalBtc, totalUsd, contributors },
  };
}
