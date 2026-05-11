import { type EtfSummaryHistoryRecord } from '@pod/sosovalue-sdk';
import { mean, stdev, zScore } from './stats.js';
import { type RiskProfile, RISK_PRESETS } from './types.js';

export interface BacktestPriceBar {
  date: string; // YYYY-MM-DD
  close: number;
}

export interface BacktestRow {
  date: string;
  flow: number;
  z: number;
  riskOnTarget: number; // 0..1
  price: number;
  navHodl: number;
  navStrategy: number;
  signal: 'BUY' | 'SELL' | 'HOLD';
}

export interface BacktestSummary {
  startDate: string;
  endDate: string;
  rows: BacktestRow[];
  totalReturnHodl: number; // 0..1 (e.g. 0.42 = +42%)
  totalReturnStrategy: number;
  alpha: number; // strategy - hodl
  maxDrawdownHodl: number;
  maxDrawdownStrategy: number;
  sharpeStrategy: number;
  sharpeHodl: number;
  tradesCount: number;
}

export interface BacktestOptions {
  riskProfile: RiskProfile;
  /** Days of trailing baseline for the z-score. Default 30. */
  baselineDays?: number;
  /** Z-thresholds for going risk-on / risk-off. Defaults: 1.0 / -1.0. */
  buyZ?: number;
  sellZ?: number;
  /** Initial capital (USDC). Default 10_000. */
  capital?: number;
}

/**
 * Pure-function backtester. Takes ETF flow records and a price series
 * and replays the strategy day by day, producing a full PnL trace and
 * summary statistics.
 *
 * Strategy:
 *   - Each day, compute z-score of latest flow vs baseline.
 *   - z > buyZ → risk-on (full risk allocation per profile)
 *   - z < sellZ → defensive (min stable per profile)
 *   - else → linear interpolation
 *   - At each rebalance, record HODL NAV vs Strategy NAV.
 */
export function backtest(
  flows: readonly EtfSummaryHistoryRecord[],
  prices: readonly BacktestPriceBar[],
  options: BacktestOptions,
): BacktestSummary {
  const baselineDays = options.baselineDays ?? 30;
  const buyZ = options.buyZ ?? 1.0;
  const sellZ = options.sellZ ?? -1.0;
  const capital = options.capital ?? 10_000;
  const risk = RISK_PRESETS[options.riskProfile];

  // Index price series by date for O(1) lookup.
  const priceByDate = new Map<string, number>();
  for (const p of prices) priceByDate.set(p.date, p.close);

  // Sort flows ascending by date so we can walk forward.
  const sorted = [...flows].sort((a, b) => a.date.localeCompare(b.date));

  const rows: BacktestRow[] = [];
  let navStrategy = capital;
  let navHodl = capital;
  let prevPrice: number | null = null;
  let prevAllocation = 0; // 0..1 share invested in the asset
  let trades = 0;
  let firstPrice: number | null = null;

  for (let i = baselineDays; i < sorted.length; i++) {
    const today = sorted[i]!;
    const baseline = sorted.slice(i - baselineDays, i).map((r) => r.total_net_inflow);
    const z = zScore(today.total_net_inflow, baseline);

    const price = priceByDate.get(today.date);
    if (price === undefined) continue; // skip days without price data

    if (firstPrice === null) firstPrice = price;
    if (prevPrice !== null) {
      const ret = price / prevPrice - 1;
      // HODL NAV grows with full asset return.
      navHodl *= 1 + ret;
      // Strategy NAV grows in proportion to the previous day's allocation.
      navStrategy *= 1 + prevAllocation * ret;
    }

    // Determine today's allocation.
    const riskOnRaw = clamp01(linearInterp(z, sellZ, buyZ, 0, 1));
    const allocation = riskOnRaw * risk.riskOnSkew;
    if (Math.abs(allocation - prevAllocation) > 0.05) trades++;

    const signal: 'BUY' | 'SELL' | 'HOLD' =
      z > buyZ ? 'BUY' : z < sellZ ? 'SELL' : 'HOLD';

    rows.push({
      date: today.date,
      flow: today.total_net_inflow,
      z,
      riskOnTarget: allocation,
      price,
      navHodl,
      navStrategy,
      signal,
    });

    prevPrice = price;
    prevAllocation = allocation;
  }

  if (rows.length === 0) {
    return {
      startDate: '',
      endDate: '',
      rows: [],
      totalReturnHodl: 0,
      totalReturnStrategy: 0,
      alpha: 0,
      maxDrawdownHodl: 0,
      maxDrawdownStrategy: 0,
      sharpeStrategy: 0,
      sharpeHodl: 0,
      tradesCount: 0,
    };
  }

  const startDate = rows[0]!.date;
  const endDate = rows[rows.length - 1]!.date;
  const totalReturnHodl = rows[rows.length - 1]!.navHodl / capital - 1;
  const totalReturnStrategy = rows[rows.length - 1]!.navStrategy / capital - 1;

  const navStrategySeries = rows.map((r) => r.navStrategy);
  const navHodlSeries = rows.map((r) => r.navHodl);
  const dailyReturnsStrategy = computeDailyReturns(navStrategySeries);
  const dailyReturnsHodl = computeDailyReturns(navHodlSeries);

  return {
    startDate,
    endDate,
    rows,
    totalReturnHodl,
    totalReturnStrategy,
    alpha: totalReturnStrategy - totalReturnHodl,
    maxDrawdownHodl: maxDrawdown(navHodlSeries),
    maxDrawdownStrategy: maxDrawdown(navStrategySeries),
    sharpeStrategy: annualisedSharpe(dailyReturnsStrategy),
    sharpeHodl: annualisedSharpe(dailyReturnsHodl),
    tradesCount: trades,
  };
}

function linearInterp(x: number, x0: number, x1: number, y0: number, y1: number): number {
  if (x1 === x0) return y0;
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function maxDrawdown(navs: readonly number[]): number {
  let peak = navs[0] ?? 0;
  let maxDd = 0;
  for (const nav of navs) {
    if (nav > peak) peak = nav;
    const dd = peak === 0 ? 0 : (peak - nav) / peak;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

function computeDailyReturns(navs: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < navs.length; i++) {
    const prev = navs[i - 1]!;
    if (prev === 0) continue;
    out.push(navs[i]! / prev - 1);
  }
  return out;
}

function annualisedSharpe(dailyReturns: readonly number[]): number {
  if (dailyReturns.length < 2) return 0;
  const m = mean(dailyReturns);
  const s = stdev(dailyReturns);
  if (s === 0) return 0;
  return (m / s) * Math.sqrt(365);
}
