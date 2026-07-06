import { unstable_cache } from 'next/cache';
import { SoSoValue, resolveSoSoValueKeys, type IndexSnapshot, type IndexConstituent } from '@pod/sosovalue-sdk';

/**
 * SSI index co-pilot data. Reads SoSoValue's SSI baskets and their ROI
 * ladders, flags the ones that are live-tradable on SoDEX, and pulls the
 * constituents for a featured basket so a user can see (and replicate) it.
 */

// SSI ticker → SoDEX testnet spot pair (the ones actually tradable there).
const SODEX_TRADABLE: Record<string, string> = {
  ssiMAG7: 'MAG7ssi/USDC',
  ssiDeFi: 'DEFIssi/USDC',
  ssiMeme: 'MEMEssi/USDC',
};

const NICE_NAME: Record<string, string> = {
  ssiMAG7: 'Magnificent 7',
  ssiDeFi: 'DeFi',
  ssiLayer1: 'Layer 1',
  ssiLayer2: 'Layer 2',
  ssiMeme: 'Meme',
  ssiAI: 'AI',
  ssiRWA: 'RWA',
  ssiDePIN: 'DePIN',
  ssiGameFi: 'GameFi',
  ssiSocialFi: 'SocialFi',
  ssiPayFi: 'PayFi',
  ssiCeFi: 'CeFi',
  ssiNFT: 'NFT',
};

export interface SsiRow {
  ticker: string;
  name: string;
  snapshot: IndexSnapshot | null;
  tradablePair?: string;
}
export interface SsiOverview {
  rows: SsiRow[];
  featured: { ticker: string; name: string; constituents: IndexConstituent[] } | null;
  generatedAt: string;
}

async function fetchSsiOverviewInner(): Promise<SsiOverview> {
  const apiKeys = resolveSoSoValueKeys();
  const generatedAt = new Date().toISOString();
  if (apiKeys.length === 0) return { rows: [], featured: null, generatedAt };

  const sso = new SoSoValue({ apiKeys });

  let tickers: string[] = [];
  try {
    tickers = await sso.index.list();
  } catch {
    return { rows: [], featured: null, generatedAt };
  }

  const rows = await Promise.all(
    tickers.map(async (ticker): Promise<SsiRow> => {
      let snapshot: IndexSnapshot | null = null;
      try {
        snapshot = await sso.index.marketSnapshot(ticker);
      } catch {
        snapshot = null;
      }
      const row: SsiRow = { ticker, name: NICE_NAME[ticker] ?? ticker.replace(/^ssi/, ''), snapshot };
      if (SODEX_TRADABLE[ticker]) row.tradablePair = SODEX_TRADABLE[ticker];
      return row;
    }),
  );

  // Sort by 7d ROI (momentum), unknowns last.
  rows.sort((a, b) => (b.snapshot?.roi7d ?? -Infinity) - (a.snapshot?.roi7d ?? -Infinity));

  // Feature MAG7 (or the first tradable) with its constituents.
  const featuredTicker = rows.find((r) => r.ticker === 'ssiMAG7')?.ticker ?? rows.find((r) => r.tradablePair)?.ticker;
  let featured: SsiOverview['featured'] = null;
  if (featuredTicker) {
    try {
      const constituents = await sso.index.constituents(featuredTicker);
      featured = {
        ticker: featuredTicker,
        name: NICE_NAME[featuredTicker] ?? featuredTicker,
        constituents: [...constituents].sort((a, b) => b.weight - a.weight),
      };
    } catch {
      featured = null;
    }
  }

  return { rows, featured, generatedAt };
}

export const fetchSsiOverview = unstable_cache(fetchSsiOverviewInner, ['ssi-overview-v1'], {
  revalidate: 600,
  tags: ['ssi'],
});
