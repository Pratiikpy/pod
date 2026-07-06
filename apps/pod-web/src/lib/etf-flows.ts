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
