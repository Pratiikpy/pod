import { describe, it, expect, vi, afterEach } from 'vitest';
import { socialSentimentSignal } from './social-sentiment.js';

function mockCg(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('socialSentimentSignal', () => {
  it('maps a 70% bullish vote to ~+1.0σ with the social weight', async () => {
    mockCg({ sentiment_votes_up_percentage: 70, market_data: { price_change_percentage_7d: 5 } });
    const c = await socialSentimentSignal('BTC');
    expect(c.source).toBe('SOCIAL_SENTIMENT');
    expect(c.weight).toBe(0.07);
    expect(c.zScore).toBeCloseTo(1.0, 5);
    expect(c.rationale).toContain('70% bullish');
  });

  it('maps a neutral 50% vote to z=0', async () => {
    mockCg({ sentiment_votes_up_percentage: 50 });
    const c = await socialSentimentSignal('ETH');
    expect(c.zScore).toBe(0);
  });

  it('maps a 30% bullish vote to ~-1.0σ', async () => {
    mockCg({ sentiment_votes_up_percentage: 30 });
    const c = await socialSentimentSignal('SOL');
    expect(c.zScore).toBeCloseTo(-1.0, 5);
  });

  it('clamps extreme sentiment to ±2.5σ', async () => {
    mockCg({ sentiment_votes_up_percentage: 100 });
    const c = await socialSentimentSignal('DOGE');
    expect(c.zScore).toBe(2.5);
  });

  it('returns a zero-weight neutral contribution when sentiment is missing', async () => {
    mockCg({ sentiment_votes_up_percentage: null });
    const c = await socialSentimentSignal('XRP');
    expect(c.weight).toBe(0);
    expect(c.zScore).toBe(0);
  });

  it('returns zero-weight for an asset with no CoinGecko mapping', async () => {
    mockCg({ sentiment_votes_up_percentage: 90 });
    const c = await socialSentimentSignal('WIF');
    expect(c.weight).toBe(0);
  });

  it('degrades to a zero-weight neutral contribution on a hard error', async () => {
    mockCg({}, 404);
    const c = await socialSentimentSignal('BTC');
    expect(c.weight).toBe(0);
    expect(c.zScore).toBe(0);
  });
});
