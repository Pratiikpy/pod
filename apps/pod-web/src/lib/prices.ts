import { unstable_cache } from 'next/cache';
import { SoSoValue, resolveSoSoValueKeys } from '@pod/sosovalue-sdk';

/**
 * Spot price and 24h move per asset, straight from SoSoValue's currency
 * snapshot. The dashboard tiles quote these, so they have to be the real
 * market print rather than a placeholder.
 */
export interface SpotPrice {
  price: number;
  changePct24h: number;
}

async function fetchSpotPricesInner(assets: string[]): Promise<Record<string, SpotPrice>> {
  const out: Record<string, SpotPrice> = {};
  const apiKeys = resolveSoSoValueKeys();
  if (apiKeys.length === 0) return out;
  try {
    const sso = new SoSoValue({ apiKeys });
    const ids = await sso.currency.idMap();
    await Promise.all(
      assets.map(async (asset) => {
        const id = ids.get(asset.toLowerCase()) ?? ids.get(asset.toUpperCase()) ?? ids.get(asset);
        if (!id) return;
        try {
          const snap = await sso.currency.snapshot(id);
          if (typeof snap.price === 'number') {
            out[asset] = {
              price: snap.price,
              changePct24h: snap.change24hPct ?? 0,
            };
          }
        } catch {
          /* leave the asset out; the caller renders a dash */
        }
      }),
    );
  } catch {
    /* no keys or the listing failed — caller renders dashes */
  }
  return out;
}

export const fetchSpotPrices = unstable_cache(fetchSpotPricesInner, ['spot-prices-v1'], {
  revalidate: 300,
  tags: ['prices'],
});

/** "$64,385" / "$3,914" / "$182.10" — more decimals for the small numbers. */
export function fmtPrice(v: number): string {
  const digits = v >= 1000 ? 0 : v >= 1 ? 2 : 4;
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** "+2.3%" / "−0.8%", using the same minus glyph as the rest of the UI. */
export function fmtPct(v: number): string {
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
}
