import { unstable_cache } from 'next/cache';
import { SoSoValue, resolveSoSoValueKeys, type SectorRow, type UnlockPoint } from '@pod/sosovalue-sdk';

/**
 * Market intel: sector rotation (F6), token-unlock radar (F8), and cycle
 * position from the currency snapshot — the under-used SoSoValue data that
 * adds context around the POD Score.
 */
export interface UnlockRow {
  asset: string;
  date: string;
  amount: number;
  daysAway: number;
}
export interface CyclePos {
  asset: string;
  downFromAthPct: number | null;
  upFromCycleLowPct: number | null;
}
export interface EquitySector {
  name: string;
  marketCap: number;
  change24hPct: number;
}
export interface BtcBuy {
  ticker: string;
  name: string;
  date: string;
  btc: number;
  usd: number;
}
export interface MarketIntel {
  sectors: SectorRow[];
  trending: Array<{ name: string; change24hPct: number }>;
  unlocks: UnlockRow[];
  cycle: CyclePos[];
  equitySectors: EquitySector[];
  recentBuys: BtcBuy[];
  generatedAt: string;
}

// Our tracked coins → their /currencies symbol (lowercase ticker) for id lookup.
const UNLOCK_ASSETS = ['SOL', 'XRP', 'AVAX', 'LINK', 'DOT', 'HBAR'];
const CYCLE_ASSETS = ['BTC', 'ETH', 'SOL'];

async function fetchMarketIntelInner(): Promise<MarketIntel> {
  const apiKeys = resolveSoSoValueKeys();
  const generatedAt = new Date().toISOString();
  if (apiKeys.length === 0)
    return { sectors: [], trending: [], unlocks: [], cycle: [], equitySectors: [], recentBuys: [], generatedAt };

  const sso = new SoSoValue({ apiKeys });

  let sectors: SectorRow[] = [];
  let trending: Array<{ name: string; change24hPct: number }> = [];
  try {
    const s = await sso.currency.sectorSpotlight();
    sectors = s.sectors;
    trending = s.trending;
  } catch {
    /* leave empty */
  }

  let idMap = new Map<string, string>();
  try {
    idMap = await sso.currency.idMap();
  } catch {
    /* leave empty */
  }

  // Unlock radar — collect near-term vesting cliffs across altcoins.
  const now = Date.now();
  const unlocks: UnlockRow[] = [];
  await Promise.all(
    UNLOCK_ASSETS.map(async (asset) => {
      const id = idMap.get(asset.toLowerCase());
      if (!id) return;
      try {
        const points: UnlockPoint[] = await sso.currency.unlocks(id);
        for (const p of points) {
          const t = new Date(p.date).getTime();
          const daysAway = (t - now) / (24 * 60 * 60 * 1000);
          if (daysAway >= 0 && daysAway <= 120) unlocks.push({ asset, date: p.date, amount: p.amount, daysAway });
        }
      } catch {
        /* skip */
      }
    }),
  );
  unlocks.sort((a, b) => a.daysAway - b.daysAway);

  // Cycle position for the majors.
  const cycle: CyclePos[] = [];
  await Promise.all(
    CYCLE_ASSETS.map(async (asset) => {
      const id = idMap.get(asset.toLowerCase());
      if (!id) return;
      try {
        const snap = await sso.currency.snapshot(id);
        cycle.push({
          asset,
          downFromAthPct: snap.downFromAth !== undefined ? snap.downFromAth * 100 : null,
          upFromCycleLowPct: snap.upFromCycleLow !== undefined ? snap.upFromCycleLow * 100 : null,
        });
      } catch {
        /* skip */
      }
    }),
  );

  // Crypto-equity sectors (F7).
  let equitySectors: EquitySector[] = [];
  try {
    equitySectors = (await sso.stocks.sectors())
      .map((s) => ({ name: s.name, marketCap: s.marketCap, change24hPct: s.change24hPct }))
      .sort((a, b) => b.marketCap - a.marketCap)
      .slice(0, 6);
  } catch {
    /* skip */
  }

  // Corporate BTC accumulation feed (F9) — recent buys across top treasuries.
  const recentBuys: BtcBuy[] = [];
  try {
    const holders = (await sso.treasury.list({ pageSize: 8 })).slice(0, 6);
    const cutoff = now - 45 * 24 * 60 * 60 * 1000;
    await Promise.all(
      holders.map(async (h) => {
        try {
          const hist = await sso.treasury.purchaseHistory(h.ticker, { limit: 6 });
          for (const row of hist) {
            const t = new Date(`${row.date}T00:00:00Z`).getTime();
            if (!Number.isNaN(t) && t >= cutoff && row.btcAcquired > 0) {
              recentBuys.push({ ticker: h.ticker, name: h.name ?? h.ticker, date: row.date, btc: row.btcAcquired, usd: row.acqCostUsd });
            }
          }
        } catch {
          /* skip */
        }
      }),
    );
    recentBuys.sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    /* skip */
  }

  return { sectors, trending, unlocks: unlocks.slice(0, 12), cycle, equitySectors, recentBuys: recentBuys.slice(0, 10), generatedAt };
}

export const fetchMarketIntel = unstable_cache(fetchMarketIntelInner, ['market-intel-v1'], {
  revalidate: 600,
  tags: ['intel'],
});
