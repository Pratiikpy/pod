import { describe, it, expect } from 'vitest';
import { SignalEngine } from './engine.js';
import type { SoSoValue } from '@pod/sosovalue-sdk';

// Minimal mock SoSoValue with the shape needed for engine.generate.
function makeMockSso(opts: {
  etfFlows?: Array<{ date: string; total_net_inflow: number }>;
  news?: Array<{ id: number; title: string; sentiment?: number; symbols?: string[] }>;
  events?: unknown[];
  acquisitions?: Array<{ entity: string; date: string; btc_amount: number }>;
  funding?: Array<{ project: string; amount_usd?: number }>;
}): SoSoValue {
  const flows = opts.etfFlows ?? [];
  const news = opts.news ?? [];
  const events = opts.events ?? [];
  const acquisitions = opts.acquisitions ?? [];
  const funding = opts.funding ?? [];

  return {
    etf: {
      summaryHistory: async () =>
        flows.map((f) => ({
          ...f,
          total_value_traded: 0,
          total_net_assets: 0,
          cum_net_inflow: 0,
        })),
    },
    macro: {
      events: async () => events,
    },
    news: {
      feed: async () => news,
    },
    treasury: {
      recentAcquisitions: async () => acquisitions,
    },
    fundraising: {
      list: async () => funding,
    },
  } as unknown as SoSoValue;
}

describe('SignalEngine', () => {
  it('produces STRONG_BUY when ETF flow z is very positive', async () => {
    // Realistic baseline with variance (not constant — needs nonzero stdev)
    const baseline = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-04-${String(i + 1).padStart(2, '0')}`,
      // ~$100M ± $50M, deterministic via sine wave
      total_net_inflow: 100_000_000 + 50_000_000 * Math.sin(i),
    }));
    // Latest day is 7x the baseline mean → strong positive z
    const flows = [
      { date: '2026-04-30', total_net_inflow: 700_000_000 },
      ...baseline,
    ];
    const sso = makeMockSso({ etfFlows: flows });
    const engine = new SignalEngine(sso);

    const signal = await engine.generate({
      asset: 'BTC',
      riskProfile: 'BALANCED',
      sources: ['ETF_FLOW'],
    });

    expect(['BUY', 'STRONG_BUY']).toContain(signal.direction);
    expect(signal.podScore).toBeGreaterThan(70);
    expect(signal.contributions.length).toBe(1);
    expect(signal.contributions[0]!.source).toBe('ETF_FLOW');
    expect(signal.targetBasket).toBeDefined();
  });

  it('produces STRONG_SELL when ETF flow z is very negative', async () => {
    const baseline = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-04-${String(i + 1).padStart(2, '0')}`,
      total_net_inflow: 100_000_000 + 50_000_000 * Math.sin(i),
    }));
    const flows = [
      { date: '2026-04-30', total_net_inflow: -500_000_000 },
      ...baseline,
    ];
    const sso = makeMockSso({ etfFlows: flows });
    const engine = new SignalEngine(sso);

    const signal = await engine.generate({
      asset: 'BTC',
      riskProfile: 'BALANCED',
      sources: ['ETF_FLOW'],
    });

    expect(['SELL', 'STRONG_SELL']).toContain(signal.direction);
    expect(signal.podScore).toBeLessThan(30);
  });

  it('marks signal uncertain when too few sources', async () => {
    const sso = makeMockSso({
      etfFlows: [{ date: '2026-04-30', total_net_inflow: 100_000_000 }],
    });
    const engine = new SignalEngine(sso);
    const signal = await engine.generate({
      asset: 'BTC',
      riskProfile: 'BALANCED',
      sources: ['ETF_FLOW'],
    });
    expect(signal.uncertain).toBe(true);
  });

  it('builds basket that respects min stable allocation', async () => {
    const baseline = Array.from({ length: 30 }, () => ({
      date: '2026-04-30',
      total_net_inflow: 100_000_000,
    }));
    const sso = makeMockSso({ etfFlows: baseline });
    const engine = new SignalEngine(sso);
    const signal = await engine.generate({
      asset: 'BTC',
      riskProfile: 'CHILL',
      sources: ['ETF_FLOW'],
    });
    const stable = signal.targetBasket.find((b) => b.symbol === 'USDC');
    expect(stable).toBeDefined();
    expect(stable!.weight).toBeGreaterThanOrEqual(0.4);
  });

  it('basket weights sum to ~1', async () => {
    const baseline = Array.from({ length: 30 }, () => ({
      date: '2026-04-30',
      total_net_inflow: 100_000_000,
    }));
    const sso = makeMockSso({ etfFlows: baseline });
    const engine = new SignalEngine(sso);
    const signal = await engine.generate({
      asset: 'BTC',
      riskProfile: 'BALANCED',
      sources: ['ETF_FLOW'],
    });
    const total = signal.targetBasket.reduce((s, b) => s + b.weight, 0);
    expect(total).toBeCloseTo(1, 1);
  });

  it('survives empty data gracefully', async () => {
    const sso = makeMockSso({});
    const engine = new SignalEngine(sso);
    const signal = await engine.generate({
      asset: 'BTC',
      riskProfile: 'BALANCED',
    });
    expect(signal).toBeDefined();
    expect(signal.uncertain).toBe(true);
  });
});
