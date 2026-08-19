import { unstable_cache } from 'next/cache';
import { SoSoValue, resolveSoSoValueKeys, type EtfSymbol } from '@pod/sosovalue-sdk';

/**
 * Recent per-asset spot-ETF net flows — the canonical institutional-flow read
 * (a Farside-style table). Pulls the last N days of `total_net_inflow` for each
 * tracked ETF asset from SoSoValue and shapes it into a grid.
 */
export interface FlowCell {
  date: string;
  netInflow: number;
}
export interface AssetFlows {
  asset: EtfSymbol;
  name: string;
  cells: FlowCell[]; // oldest → newest
  latest: number;
  cum7d: number;
}
export interface FlowTable {
  dates: string[]; // oldest → newest
  assets: AssetFlows[];
  generatedAt: string;
}

const TRACKED: Array<{ asset: EtfSymbol; name: string }> = [
  { asset: 'BTC', name: 'Bitcoin' },
  { asset: 'ETH', name: 'Ethereum' },
  { asset: 'SOL', name: 'Solana' },
  { asset: 'XRP', name: 'XRP' },
  { asset: 'DOGE', name: 'Dogecoin' },
  { asset: 'LTC', name: 'Litecoin' },
  { asset: 'HBAR', name: 'Hedera' },
];

const DAYS = 7;

async function fetchEtfFlowTableInner(): Promise<FlowTable> {
  const apiKeys = resolveSoSoValueKeys();
  const generatedAt = new Date().toISOString();
  if (apiKeys.length === 0) {
    return { dates: [], assets: [], generatedAt };
  }
  const sso = new SoSoValue({ apiKeys });

  const results = await Promise.all(
    TRACKED.map(async (t) => {
      try {
        const hist = await sso.etf.summaryHistory({ symbol: t.asset, country_code: 'US', limit: DAYS });
        // API returns latest-first; reverse to oldest→newest and keep last DAYS.
        const rows = [...hist].reverse().slice(-DAYS);
        const cells = rows.map((r) => ({ date: r.date, netInflow: r.total_net_inflow }));
        const latest = cells.length ? cells[cells.length - 1]!.netInflow : 0;
        const cum7d = cells.reduce((s, c) => s + c.netInflow, 0);
        return { asset: t.asset, name: t.name, cells, latest, cum7d };
      } catch {
        return { asset: t.asset, name: t.name, cells: [], latest: 0, cum7d: 0 };
      }
    }),
  );

  // Union of dates across assets (they should align), oldest→newest.
  const dateSet = new Set<string>();
  for (const a of results) for (const c of a.cells) dateSet.add(c.date);
  const dates = [...dateSet].sort();

  return { dates, assets: results, generatedAt };
}

export const fetchEtfFlowTable = unstable_cache(fetchEtfFlowTableInner, ['etf-flow-table-v1'], {
  revalidate: 600,
  tags: ['flows'],
});

/**
 * The BTC spot-ETF flow series behind the homepage chart: the last 14 sessions
 * of net creations/redemptions, plus the 30-day z-score of the latest print so
 * the headline stat carries the same "how unusual is this" reading the score
 * engine uses.
 */
export interface HeadlineFlow {
  /** Net inflow per session in millions of USD, oldest → newest. */
  series: number[];
  /** Sum of the 14 sessions, in USD. */
  net14d: number;
  /** Sum of the 14 sessions before those, in USD — the comparison baseline. */
  netPrior: number;
  /** Most recent session's net inflow, in USD. */
  today: number;
  /** Standard deviations the latest print sits from its trailing mean. */
  todayZ: number | null;
  generatedAt: string;
}

async function fetchHeadlineFlowInner(): Promise<HeadlineFlow> {
  const empty: HeadlineFlow = {
    series: [],
    net14d: 0,
    netPrior: 0,
    today: 0,
    todayZ: null,
    generatedAt: new Date().toISOString(),
  };
  const apiKeys = resolveSoSoValueKeys();
  if (apiKeys.length === 0) return empty;
  try {
    const sso = new SoSoValue({ apiKeys });
    const hist = await sso.etf.summaryHistory({ symbol: 'BTC', country_code: 'US', limit: 30 });
    const rows = [...hist].reverse(); // API is latest-first
    if (rows.length === 0) return empty;
    const flows = rows.map((r) => r.total_net_inflow);
    const last14 = flows.slice(-14);
    const prior14 = flows.slice(-28, -14);
    const latest = last14[last14.length - 1] ?? 0;
    // Same shape as the engine's ETF source: latest against the days before it.
    const baseline = flows.slice(0, -1);
    let todayZ: number | null = null;
    if (baseline.length >= 5) {
      const mean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
      const variance =
        baseline.reduce((a, b) => a + (b - mean) ** 2, 0) / (baseline.length - 1);
      const sd = Math.sqrt(variance);
      todayZ = sd > 0 ? (latest - mean) / sd : 0;
    }
    return {
      series: last14.map((v) => v / 1_000_000),
      net14d: last14.reduce((a, b) => a + b, 0),
      netPrior: prior14.reduce((a, b) => a + b, 0),
      today: latest,
      todayZ,
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return empty;
  }
}

export const fetchHeadlineFlow = unstable_cache(fetchHeadlineFlowInner, ['headline-flow-v1'], {
  revalidate: 600,
  tags: ['flows'],
});

/** Compact USD for headline stats: 1_420_000_000 → "+$1.42B". */
export function fmtUsdCompact(v: number): string {
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  const a = Math.abs(v);
  if (a >= 1_000_000_000) return `${sign}$${(a / 1_000_000_000).toFixed(2)}B`;
  if (a >= 1_000_000) return `${sign}$${Math.round(a / 1_000_000)}M`;
  if (a >= 1_000) return `${sign}$${Math.round(a / 1_000)}K`;
  return `${sign}$${Math.round(a)}`;
}
