/**
 * End-to-end smoke test against live SoSoValue API.
 * Verifies every layer: SDK → Signal Engine → Backtest.
 *
 * Run: pnpm --filter @pod/signal-engine smoke
 */

import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../../../.env') });

import { SoSoValue } from '@pod/sosovalue-sdk';
import { SignalEngine } from '../src/engine.js';
import { backtest, type BacktestPriceBar } from '../src/backtest.js';

type Status = 'ok' | 'warn' | 'fail';

interface CheckResult {
  layer: string;
  test: string;
  status: Status;
  detail: string;
  ms: number;
}

const results: CheckResult[] = [];

async function run<T>(layer: string, test: string, fn: () => Promise<T>): Promise<T | null> {
  const t0 = Date.now();
  try {
    const out = await fn();
    const ms = Date.now() - t0;
    results.push({ layer, test, status: 'ok', detail: summarise(out), ms });
    return out;
  } catch (err) {
    const ms = Date.now() - t0;
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ layer, test, status: 'fail', detail, ms });
    return null;
  }
}

function summarise(value: unknown): string {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    return `object{${keys.slice(0, 4).join(',')}${keys.length > 4 ? ',…' : ''}}`;
  }
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.slice(0, 80);
  return String(value);
}

async function main() {
  const apiKey = process.env['SOSOVALUE_API_KEY'];
  if (!apiKey) {
    console.error('❌ SOSOVALUE_API_KEY missing from .env');
    process.exit(1);
  }
  console.log('🔬 POD smoke test against live SoSoValue API\n');

  const sso = new SoSoValue({ apiKey });

  // ── 1. SoSoValue SDK — every module ──────────────────────────────────────
  await run('SDK · ETF', 'list', () => sso.etf.list());
  const etfHistory = await run('SDK · ETF', 'summaryHistory(BTC, US, 30d)', () =>
    sso.etf.summaryHistory({ symbol: 'BTC', country_code: 'US', limit: 30 }),
  );
  await run('SDK · ETF', 'summaryHistory(ETH, US, 30d)', () =>
    sso.etf.summaryHistory({ symbol: 'ETH', country_code: 'US', limit: 30 }),
  );

  await run('SDK · Index', 'list', () => sso.index.list());
  await run('SDK · News', 'feed(20)', () => sso.news.feed({ limit: 20 }));
  await run('SDK · News', 'hot(10)', () => sso.news.hot({ limit: 10 }));
  await run('SDK · Macro', 'events(7d)', () =>
    sso.macro.events({
      from: new Date().toISOString().slice(0, 10),
      to: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
      limit: 30,
    }),
  );
  await run('SDK · Treasury', 'holders(top 20)', () => sso.treasury.holders({ limit: 20 }));
  await run('SDK · Treasury', 'recentAcquisitions(30d)', () =>
    sso.treasury.recentAcquisitions({ days: 30, limit: 50 }),
  );
  await run('SDK · Fundraising', 'list(30d, $1M+)', () =>
    sso.fundraising.list({ days: 30, min_amount: 1_000_000, limit: 50 }),
  );
  await run('SDK · Currency', 'list(top 10)', () => sso.currency.list({ limit: 10 }));
  await run('SDK · Stocks', 'list', () => sso.stocks.list({ limit: 20 }));

  // ── 2. Signal Engine — real fusion run ───────────────────────────────────
  const engine = new SignalEngine(sso);
  const btcSignal = await run('Engine', 'BTC / BALANCED full fusion', () =>
    engine.generate({ asset: 'BTC', riskProfile: 'BALANCED' }),
  );
  await run('Engine', 'ETH / BALANCED full fusion', () =>
    engine.generate({ asset: 'ETH', riskProfile: 'BALANCED' }),
  );
  await run('Engine', 'SOL / SEND_IT (ETF only)', () =>
    engine.generate({ asset: 'SOL', riskProfile: 'SEND_IT', sources: ['ETF_FLOW'] }),
  );

  // ── 3. Backtest — using real ETF history + currency klines ───────────────
  if (etfHistory && etfHistory.length >= 30) {
    const klines = await run('SDK · Currency', 'klines BTC 1d', () =>
      sso.currency.klines({ symbol: 'BTC', interval: '1d', limit: 60 }),
    );
    if (klines) {
      const prices: BacktestPriceBar[] = klines.map((k) => ({
        date: new Date(k.timestamp).toISOString().slice(0, 10),
        close: k.close,
      }));
      const result = backtest(etfHistory, prices, { riskProfile: 'BALANCED', capital: 10_000 });
      results.push({
        layer: 'Backtest',
        test: `${etfHistory.length}d window`,
        status: 'ok',
        detail: `HODL ${pct(result.totalReturnHodl)} · POD ${pct(result.totalReturnStrategy)} · DD HODL ${pct(result.maxDrawdownHodl)} / POD ${pct(result.maxDrawdownStrategy)} · Sharpe POD ${result.sharpeStrategy.toFixed(2)}`,
        ms: 0,
      });
    }
  }

  // ── 4. Render the report ─────────────────────────────────────────────────
  console.log('\n┌────────────────────────────────────────────────────────────────────────────┐');
  console.log('│                        SMOKE TEST RESULTS                                  │');
  console.log('└────────────────────────────────────────────────────────────────────────────┘\n');

  let okCount = 0;
  let warnCount = 0;
  let failCount = 0;
  for (const r of results) {
    const icon = r.status === 'ok' ? '✅' : r.status === 'warn' ? '⚠️ ' : '❌';
    if (r.status === 'ok') okCount++;
    else if (r.status === 'warn') warnCount++;
    else failCount++;
    const time = r.ms ? `${r.ms}ms`.padStart(7) : '—'.padStart(7);
    console.log(`${icon} ${time}  ${r.layer.padEnd(20)} ${r.test.padEnd(40)} ${truncate(r.detail, 70)}`);
  }

  console.log(`\n  Result: ${okCount} ok · ${warnCount} warn · ${failCount} fail / ${results.length} total\n`);

  // Pretty-print the BTC signal contributions
  if (btcSignal) {
    console.log('🔍 Live BTC signal breakdown:');
    console.log(`  Direction:       ${btcSignal.direction}`);
    console.log(`  POD Score:       ${btcSignal.podScore}/100`);
    console.log(`  Composite z:     ${btcSignal.compositeZ.toFixed(3)}`);
    console.log(`  Uncertain:       ${btcSignal.uncertain}`);
    console.log(`  Reasoning:       ${btcSignal.reasoning}`);
    console.log(`  Target basket:`);
    for (const b of btcSignal.targetBasket) {
      console.log(`    • ${b.symbol.padEnd(6)} ${(b.weight * 100).toFixed(1)}%`);
    }
    console.log(`  Source contributions:`);
    for (const c of btcSignal.contributions) {
      console.log(
        `    [${c.source.padEnd(15)}] z=${c.zScore.toFixed(2)} w=${c.weight} conf=${c.confidence}/100 — ${c.rationale.slice(0, 120)}`,
      );
    }
    console.log('');
  }

  process.exit(failCount > 0 ? 1 : 0);
}

function pct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

main().catch((err) => {
  console.error('💥 smoke test crashed:', err);
  process.exit(1);
});
