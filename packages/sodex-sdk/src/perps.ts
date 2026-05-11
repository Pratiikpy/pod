import type { SoDEXClient } from './client.js';

/**
 * Perpetuals trading client. Mirrors sodex-go-sdk-public/client/perps.go.
 */
export class PerpsAPI {
  constructor(private readonly client: SoDEXClient) {}

  // ── Market data (public) ────────────────────────────────────────────────

  symbols() {
    return this.client.get<{ data: unknown[] }>(`${this.client.perpsBase}/markets/symbols`);
  }

  tickers() {
    return this.client.get<{ data: unknown[] }>(`${this.client.perpsBase}/markets/tickers`);
  }

  orderbook(symbol: string, depth = 50) {
    return this.client.get<{ data: unknown }>(
      `${this.client.perpsBase}/markets/${symbol}/orderbook`,
      { depth },
    );
  }

  klines(params: { symbol: string; interval: string; limit?: number }) {
    return this.client.get<{ data: unknown[][] }>(
      `${this.client.perpsBase}/markets/${params.symbol}/klines`,
      { interval: params.interval, limit: params.limit },
    );
  }

  publicTrades(symbol: string, limit = 100) {
    return this.client.get<{ data: unknown[] }>(
      `${this.client.perpsBase}/markets/${symbol}/trades`,
      { limit },
    );
  }

  // ── Account state (public read by address) ──────────────────────────────

  balances(address: string) {
    return this.client.get<{ data: unknown[] }>(
      `${this.client.perpsBase}/accounts/${address}/balances`,
    );
  }

  openOrders(address: string) {
    return this.client.get<{ data: unknown[] }>(
      `${this.client.perpsBase}/accounts/${address}/orders`,
    );
  }

  positions(address: string) {
    return this.client.get<{ data: unknown[] }>(
      `${this.client.perpsBase}/accounts/${address}/positions`,
    );
  }

  fundings(address: string, params?: { symbolID?: string; limit?: number }) {
    return this.client.get<{ data: unknown[] }>(
      `${this.client.perpsBase}/accounts/${address}/fundings`,
      params,
    );
  }

  ordersHistory(address: string, params?: { symbolID?: string; limit?: number }) {
    return this.client.get<{ data: unknown[] }>(
      `${this.client.perpsBase}/accounts/${address}/orders/history`,
      params,
    );
  }

  userTrades(address: string, params?: { symbolID?: string; limit?: number }) {
    return this.client.get<{ data: unknown[] }>(
      `${this.client.perpsBase}/accounts/${address}/trades`,
      params,
    );
  }

  // ── Trading (signed write) ──────────────────────────────────────────────

  /** Action type: "newOrder" */
  newOrder(params: {
    accountID: number | bigint;
    symbolID: number | bigint;
    orders: Array<Record<string, unknown>>;
  }) {
    return this.client.postSigned('perps', `${this.client.perpsBase}/trade/orders`, {
      type: 'newOrder',
      params,
    });
  }

  /** Action type: "cancelOrder" */
  cancelOrder(params: {
    accountID: number | bigint;
    symbolID: number | bigint;
    cancels: Array<{ orderID?: number | bigint; clOrdID?: string }>;
  }) {
    return this.client.deleteSigned('perps', `${this.client.perpsBase}/trade/orders`, {
      type: 'cancelOrder',
      params,
    });
  }

  /** Action type: "modifyOrder" */
  modifyOrder(params: Record<string, unknown>) {
    return this.client.postSigned('perps', `${this.client.perpsBase}/trade/orders/modify`, {
      type: 'modifyOrder',
      params,
    });
  }

  /** Action type: "replaceOrder" */
  replaceOrder(params: Record<string, unknown>) {
    return this.client.postSigned('perps', `${this.client.perpsBase}/trade/orders/replace`, {
      type: 'replaceOrder',
      params,
    });
  }

  /** Action type: "updateLeverage" */
  updateLeverage(params: {
    accountID: number | bigint;
    symbolID: number | bigint;
    leverage: number;
    marginMode: 'CROSS' | 'ISOLATED';
  }) {
    return this.client.postSigned('perps', `${this.client.perpsBase}/trade/leverage`, {
      type: 'updateLeverage',
      params,
    });
  }

  /** Action type: "updateMargin" */
  updateMargin(params: {
    accountID: number | bigint;
    symbolID: number | bigint;
    amount: string;
  }) {
    return this.client.postSigned('perps', `${this.client.perpsBase}/trade/margin`, {
      type: 'updateMargin',
      params,
    });
  }

  /** Action type: "transferAsset" */
  transferAsset(params: Record<string, unknown>) {
    return this.client.postSigned('perps', `${this.client.perpsBase}/accounts/transfers`, {
      type: 'transferAsset',
      params,
    });
  }

  /** Action type: "scheduleCancel" */
  scheduleCancel(params: { accountID: number | bigint; scheduledTimestamp: number }) {
    return this.client.postSigned(
      'perps',
      `${this.client.perpsBase}/trade/orders/schedule-cancel`,
      { type: 'scheduleCancel', params },
    );
  }
}
