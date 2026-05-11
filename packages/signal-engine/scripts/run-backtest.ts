/**
 * CLI: run a backtest against live SoSoValue data.
 *
 * Usage:
 *   pnpm --filter @pod/signal-engine exec tsx scripts/run-backtest.ts BTC BALANCED
 *
 * Falls back to synthetic data if SOSOVALUE_API_KEY isn't set, so you can verify
 * the math even before securing API access.
 */

import 'dotenv/config';
import { SoSoValue, type EtfSymbol } from '@pod/sosovalue-sdk';
import { backtest, type BacktestPriceBar } from '../src/backtest.js';
import { type RiskProfile } from '../src/types.js';

const SUPPORTED: EtfSymbol[] = ['BTC', 'ETH', 'SOL', 'XRP', 'AVAX', 'DOGE', 'LINK', 'DOT', 'LTC', 'HBAR'];

async function main() {
  const [, , assetArg = 'BTC', profileArg = 'BALANCED'] = process.argv;
  const asset = SUPPORTED.includes(assetArg as EtfSymbol) ? (assetArg as EtfSymbol) : 'BTC';
  const profile = (['CHILL', 'BALANCED', 'SEND_IT'].includes(profileArg)
    ? profileArg
    : 'BALANCED') as RiskProfile;

  console.log(`📊 POD backtest: asset=${asset} profile=${profile}`);

  const apiKey = process.env['SOSOVALUE_API_KEY'];
  let flows;
  let prices: BacktestPriceBar[];

  if (apiKey) {
    console.log('🔑 Using live SoSoValue API…');
    const sso = new SoSoValue({ apiKey });
    flows = await sso.etf.summaryHistory({ symbol: asset, country_code: 'US', limit: 300 });
    // Pull daily candles for the asset to get close prices.
    const klines = await sso.currency.klines({ symbol: asset, interval: '1d', limit: 300 });
    prices = klines.map((k) => ({
      date: new Date(k.timestamp).toISOString().slice(0, 10),
      close: k.close,
    }));
  } else {
    console.log('⚠️ No SOSOVALUE_API_KEY — using synthetic data.');
    flows = synthFlows(180);
    prices = synthPrices(flows);
  }

  const result = backtest(flows, prices, { riskProfile: profile, capital: 10_000 });

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Backtest: ${result.startDate} → ${result.endDate}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Days simulated:        ${result.rows.length}`);
  console.log(`  Trades executed:       ${result.tradesCount}`);
  console.log('');
  console.log(`  Total return — HODL:     ${pct(result.totalReturnHodl)}`);
  console.log(`  Total return — POD:      ${pct(result.totalReturnStrategy)}`);
  console.log(`  Alpha (POD − HODL):      ${pct(result.alpha)}`);
  console.log('');
  console.log(`  Max drawdown — HODL:     ${pct(result.maxDrawdownHodl)}`);
  console.log(`  Max drawdown — POD:      ${pct(result.maxDrawdownStrategy)}`);
  console.log('');
  console.log(`  Sharpe — HODL:           ${result.sharpeHodl.toFixed(2)}`);
  console.log(`  Sharpe — POD:            ${result.sharpeStrategy.toFixed(2)}`);
  console.log('═══════════════════════════════════════════════════════════════');
}

function pct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

function synthFlows(days: number) {
  const out = [] as Array<{
    date: string;
    total_net_inflow: number;
    total_value_traded: number;
    total_net_assets: number;
    cum_net_inflow: number;
  }>;
  for (let i = days; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    out.push({
      date: d.toISOString().slice(0, 10),
      total_net_inflow: 200_000_000 + 250_000_000 * Math.sin(i / 7) + (Math.random() - 0.5) * 100_000_000,
      total_value_traded: 0,
      total_net_assets: 0,
      cum_net_inflow: 0,
    });
  }
  return out;
}

function synthPrices(flows: Array<{ date: string; total_net_inflow: number }>): BacktestPriceBar[] {
  let price = 95_000;
  return flows.map((f) => {
    // price moves sympathetically with flows + noise
    const delta = (f.total_net_inflow / 1e9) * 0.005 + (Math.random() - 0.5) * 0.01;
    price *= 1 + delta;
    return { date: f.date, close: price };
  });
}

main().catch((err) => {
  console.error('💥 backtest failed:', err);
  process.exit(1);
});
