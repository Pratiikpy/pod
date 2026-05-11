import { SoSoValueClient, type SoSoValueClientConfig, type CacheAdapter } from './client.js';
import { EtfModule } from './modules/etf.js';
import { IndexModule } from './modules/sosovalue-index.js';
import { NewsModule } from './modules/news.js';
import { MacroModule } from './modules/macro.js';
import { TreasuryModule } from './modules/treasury.js';
import { FundraisingModule } from './modules/fundraising.js';
import { CurrencyModule } from './modules/currency.js';
import { CryptoStocksModule } from './modules/stocks.js';
import { AnalysisChartsModule } from './modules/charts.js';

export {
  SoSoValueAPIError,
  SoSoValueRateLimitError,
  SoSoValueValidationError,
} from './errors.js';

export type { SoSoValueClientConfig, CacheAdapter };

// Re-export module schemas / types
export * from './modules/etf.js';
export * from './modules/sosovalue-index.js';
export * from './modules/news.js';
export * from './modules/macro.js';
export * from './modules/treasury.js';
export * from './modules/fundraising.js';
export * from './modules/currency.js';
export * from './modules/stocks.js';
export * from './modules/charts.js';

/**
 * SoSoValue API SDK — fully typed client for all 9 modules.
 *
 * @example
 * const sso = new SoSoValue({ apiKey: process.env.SOSOVALUE_API_KEY! });
 * const flows = await sso.etf.summaryHistory({ symbol: 'BTC', country_code: 'US' });
 */
export class SoSoValue {
  readonly client: SoSoValueClient;
  readonly etf: EtfModule;
  readonly index: IndexModule;
  readonly news: NewsModule;
  readonly macro: MacroModule;
  readonly treasury: TreasuryModule;
  readonly fundraising: FundraisingModule;
  readonly currency: CurrencyModule;
  readonly stocks: CryptoStocksModule;
  readonly charts: AnalysisChartsModule;

  constructor(config: SoSoValueClientConfig) {
    this.client = new SoSoValueClient(config);
    this.etf = new EtfModule(this.client);
    this.index = new IndexModule(this.client);
    this.news = new NewsModule(this.client);
    this.macro = new MacroModule(this.client);
    this.treasury = new TreasuryModule(this.client);
    this.fundraising = new FundraisingModule(this.client);
    this.currency = new CurrencyModule(this.client);
    this.stocks = new CryptoStocksModule(this.client);
    this.charts = new AnalysisChartsModule(this.client);
  }
}

export { SoSoValueClient };
