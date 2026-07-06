import type { SignalContribution } from '../types.js';
import { clamp } from '../stats.js';

/**
 * Social-sentiment signal — the crowd-mood counterweight to the slow
 * institutional sources (ETF flow, treasuries, VC). Fast-moving retail
 * sentiment often leads or diverges from institutional flow, so a small
 * social weight adds a different timescale to the composite.
 *
 * Source: CoinGecko's free Demo API, `sentiment_votes_up_percentage` — a
 * live, populated, per-coin crowd up/down vote (0-100). CoinGecko's reddit
 * counters are deprecated (return 0) so we intentionally do NOT use them;
 * the vote percentage is the one real free social signal.
 *
 * Free tier: 10k calls/month, ~30/min, no card. An optional demo key
 * (COINGECKO_API_KEY → `x-cg-demo-api-key`) raises the limit. Paid upgrade
 * path: swap this module's fetch for LunarCrush Galaxy Score behind the same
 * SignalContribution interface — no engine change.
 */

const CG_BASE = 'https://api.coingecko.com/api/v3';

/** POD's ten tracked ETF assets → CoinGecko coin ids. */
const COINGECKO_ID: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  XRP: 'ripple',
  DOGE: 'dogecoin',
  AVAX: 'avalanche-2',
  LINK: 'chainlink',
  LTC: 'litecoin',
  DOT: 'polkadot',
  HBAR: 'hedera-hashgraph',
};

interface CoinGeckoCoinResponse {
  sentiment_votes_up_percentage?: number | null;
  sentiment_votes_down_percentage?: number | null;
  market_data?: {
    price_change_percentage_24h?: number | null;
    price_change_percentage_7d?: number | null;
  };
}

export async function socialSentimentSignal(asset: string): Promise<SignalContribution> {
  const id = COINGECKO_ID[asset];
  if (!id) {
    return neutral(asset, `No CoinGecko mapping for ${asset}.`);
  }

  const url =
    `${CG_BASE}/coins/${id}` +
    `?localization=false&tickers=false&market_data=true` +
    `&community_data=true&developer_data=false&sparkline=false`;

  const headers: Record<string, string> = { accept: 'application/json' };
  const key = process.env['COINGECKO_API_KEY'];
  if (key) headers['x-cg-demo-api-key'] = key;

  // CoinGecko's free tier rate-limits bursts (the 10-coin fan-out). Retry a
  // couple of times with backoff on 429/5xx so every coin still gets a signal.
  const body = await fetchWithRetry(url, headers);
  if (!body) {
    return neutral(asset, `Social sentiment for ${asset} unavailable (rate-limited).`);
  }

  const up = body.sentiment_votes_up_percentage;
  if (up === null || up === undefined) {
    return neutral(asset, `No community sentiment for ${asset} on CoinGecko.`);
  }

  // Map crowd vote (0..100, neutral 50) to a bounded z-like score.
  // 20 points ≈ 1σ, so 70% up → +1.0, 30% up → -1.0. Clamp to ±2.5.
  const z = clamp((up - 50) / 20, -2.5, 2.5);
  const confidence = Math.round((1 / (1 + Math.exp(-z))) * 100);

  const mood = up >= 65 ? 'bullish' : up >= 55 ? 'mildly bullish' : up <= 35 ? 'bearish' : up <= 45 ? 'mildly bearish' : 'mixed';
  const chg7d = body.market_data?.price_change_percentage_7d;
  const priceNote =
    typeof chg7d === 'number'
      ? ` Price ${chg7d >= 0 ? '+' : ''}${chg7d.toFixed(1)}% over 7d.`
      : '';

  return {
    source: 'SOCIAL_SENTIMENT',
    weight: 0.07,
    zScore: z,
    confidence,
    rationale: `${asset} crowd sentiment ${mood}: ${up.toFixed(0)}% bullish votes (${z >= 0 ? '+' : ''}${z.toFixed(2)}σ).${priceNote}`,
    citation: `CoinGecko /coins/${id} (community sentiment)`,
    data: {
      upPercentage: up,
      downPercentage: body.sentiment_votes_down_percentage ?? undefined,
      priceChange7d: chg7d ?? undefined,
    },
  };
}

// Serialise CoinGecko calls with a minimum gap so the 10-coin fan-out never
// exceeds the free tier's burst limit. Slot reservation is synchronous (no
// await between read and write) so concurrent callers get sequential slots.
const CG_MIN_GAP_MS = 1300;
let cgNextSlot = 0;
async function cgThrottle(): Promise<void> {
  if (process.env['VITEST']) return; // don't throttle unit tests
  const now = Date.now();
  const wait = Math.max(0, cgNextSlot - now);
  cgNextSlot = Math.max(now, cgNextSlot) + CG_MIN_GAP_MS;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  attempts = 3,
): Promise<CoinGeckoCoinResponse | null> {
  for (let i = 0; i < attempts; i++) {
    await cgThrottle();
    const res = await fetch(url, { headers });
    if (res.ok) return (await res.json()) as CoinGeckoCoinResponse;
    if (res.status !== 429 && res.status < 500) return null; // hard error, don't retry
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, 1500 * (i + 1))); // 1.5s, 3s backoff
    }
  }
  return null;
}

function neutral(asset: string, reason: string): SignalContribution {
  return {
    source: 'SOCIAL_SENTIMENT',
    weight: 0,
    zScore: 0,
    confidence: 50,
    rationale: reason,
    citation: 'CoinGecko /coins',
    data: { asset },
  };
}
