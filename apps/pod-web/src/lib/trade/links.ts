/**
 * Deep links into the trade page. Server-safe: no wallet or browser code here,
 * so the asset page and the Telegram bot can both use it.
 */
export const SITE_URL = 'https://pod-app-phi.vercel.app';

type Direction = 'STRONG_SELL' | 'SELL' | 'HOLD' | 'BUY' | 'STRONG_BUY' | string;

/** Pre-selects the coin and, when POD has a directional view, the matching side. */
export function tradeUrl(asset: string, direction?: Direction, base: string = SITE_URL): string {
  const params = new URLSearchParams({ asset: asset.toUpperCase() });
  if (direction === 'BUY' || direction === 'STRONG_BUY') params.set('side', 'buy');
  else if (direction === 'SELL' || direction === 'STRONG_SELL') params.set('side', 'sell');
  return `${base}/trade?${params.toString()}`;
}
