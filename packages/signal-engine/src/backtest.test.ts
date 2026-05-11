import { describe, it, expect } from 'vitest';
import { backtest, type BacktestPriceBar } from './backtest.js';
import { type EtfSummaryHistoryRecord } from '@pod/sosovalue-sdk';

function makeFlows(days: number, latestDate = '2026-04-30'): EtfSummaryHistoryRecord[] {
  const records: EtfSummaryHistoryRecord[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(latestDate + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - i);
    records.push({
      date: d.toISOString().slice(0, 10),
      total_net_inflow: 100_000_000 + 50_000_000 * Math.sin(i / 3),
      total_value_traded: 0,
      total_net_assets: 0,
      cum_net_inflow: 0,
    });
  }
  return records;
}

function makePriceSeries(flows: EtfSummaryHistoryRecord[], driftPct = 0.001): BacktestPriceBar[] {
  // Generate a simple deterministic price series: BTC starts at 100k and drifts up daily.
  const sorted = [...flows].sort((a, b) => a.date.localeCompare(b.date));
  let price = 100_000;
  return sorted.map((r) => {
    price *= 1 + driftPct;
    return { date: r.date, close: price };
  });
}

describe('backtest', () => {
  it('produces full PnL trace + summary', () => {
    const flows = makeFlows(120);
    const prices = makePriceSeries(flows);
    const result = backtest(flows, prices, { riskProfile: 'BALANCED', capital: 10_000 });

    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.startDate).toBeDefined();
    expect(result.endDate).toBeDefined();
    expect(result.rows[0]!.navHodl).toBeGreaterThan(0);
    expect(result.rows[0]!.navStrategy).toBeGreaterThan(0);
  });

  it('hodl beats strategy in pure uptrend (strategy gives up upside when defensive)', () => {
    const flows = makeFlows(120);
    const prices = makePriceSeries(flows, 0.005); // strong uptrend
    const result = backtest(flows, prices, { riskProfile: 'CHILL' });
    // chill profile keeps a lot in stables → underperforms in steady uptrend
    expect(result.totalReturnHodl).toBeGreaterThan(result.totalReturnStrategy);
  });

  it('respects baseline window — fewer rows when baseline larger', () => {
    const flows = makeFlows(60);
    const prices = makePriceSeries(flows);
    const r10 = backtest(flows, prices, { riskProfile: 'BALANCED', baselineDays: 10 });
    const r30 = backtest(flows, prices, { riskProfile: 'BALANCED', baselineDays: 30 });
    expect(r10.rows.length).toBeGreaterThan(r30.rows.length);
  });

  it('handles empty flows', () => {
    const result = backtest([], [], { riskProfile: 'BALANCED' });
    expect(result.rows.length).toBe(0);
    expect(result.totalReturnHodl).toBe(0);
  });

  it('summary stats are coherent', () => {
    const flows = makeFlows(120);
    const prices = makePriceSeries(flows, 0.002);
    const result = backtest(flows, prices, { riskProfile: 'BALANCED' });
    // Drawdowns are non-negative
    expect(result.maxDrawdownHodl).toBeGreaterThanOrEqual(0);
    expect(result.maxDrawdownStrategy).toBeGreaterThanOrEqual(0);
    // Alpha = strategy - hodl
    expect(result.alpha).toBeCloseTo(result.totalReturnStrategy - result.totalReturnHodl, 6);
  });

  it('trade count reflects allocation switches', () => {
    const flows = makeFlows(120);
    const prices = makePriceSeries(flows);
    const r = backtest(flows, prices, { riskProfile: 'BALANCED' });
    expect(r.tradesCount).toBeGreaterThan(0);
  });
});
