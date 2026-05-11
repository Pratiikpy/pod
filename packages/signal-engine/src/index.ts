export * from './types.js';
export * from './stats.js';
export { SignalEngine, type SignalRequest } from './engine.js';
export { etfFlowSignal } from './sources/etf-flow.js';
export { macroEventSignal } from './sources/macro-event.js';
export { newsSentimentSignal } from './sources/news-sentiment.js';
export { treasurySignal } from './sources/treasury.js';
export { fundraisingSignal } from './sources/fundraising.js';
export {
  backtest,
  type BacktestRow,
  type BacktestSummary,
  type BacktestOptions,
  type BacktestPriceBar,
} from './backtest.js';
