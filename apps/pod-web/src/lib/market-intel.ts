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
export interface MarketIntel {
  sectors: SectorRow[];
  trending: Array<{ name: string; change24hPct: number }>;
  unlocks: UnlockRow[];
  cycle: CyclePos[];
  generatedAt: string;
}

// Our tracked coins → their /currencies symbol (lowercase ticker) for id lookup.
const UNLOCK_ASSETS = ['SOL', 'XRP', 'AVAX', 'LINK', 'DOT', 'HBAR'];
const CYCLE_ASSETS = ['BTC', 'ETH', 'SOL'];

async function fetchMarketIntelInner(): Promise<MarketIntel> {
  const apiKeys = resolveSoSoValueKeys();
  const generatedAt = new Date().toISOString();
  if (apiKeys.length === 0) return { sectors: [], trending: [], unlocks: [], cycle: [], generatedAt };

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

  return { sectors, trending, unlocks: unlocks.slice(0, 12), cycle, generatedAt };
}

export const fetchMarketIntel = unstable_cache(fetchMarketIntelInner, ['market-intel-v1'], {
  revalidate: 600,
  tags: ['intel'],
});
