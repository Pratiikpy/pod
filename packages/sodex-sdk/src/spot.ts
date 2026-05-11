import type { SoDEXClient } from './client.js';

/**
 * Spot trading client. Endpoints + action names match the official Go SDK
 * exactly (sodex-tech/sodex-go-sdk-public/client/spot.go).
 */
export class SpotAPI {
  constructor(private readonly client: SoDEXClient) {}

  // ── Market data (public) ────────────────────────────────────────────────

  symbols() {
    return this.client.get<{ data: unknown[] }>(`${this.client.spotBase}/markets/symbols`);
  }

  tickers() {
    return this.client.get<{ data: unknown[] }>(`${this.client.spotBase}/markets/tickers`);
  }

  orderbook(symbol: string, depth = 50) {
    return this.client.get<{ data: unknown }>(
      `${this.client.spotBase}/markets/${symbol}/orderbook`,
      { depth },
    );
  }

  klines(params: {
    symbol: string;
    interval: string;
    limit?: number;
    startTime?: number;
    endTime?: number;
  }) {
    return this.client.get<{ data: unknown[][] }>(
      `${this.client.spotBase}/markets/${params.symbol}/klines`,
      { interval: params.interval, limit: params.limit, startTime: params.startTime, endTime: params.endTime },
    );
  }

  publicTrades(symbol: string, limit = 100) {
    return this.client.get<{ data: unknown[] }>(
      `${this.client.spotBase}/markets/${symbol}/trades`,
      { limit },
    );
  }

  // ── Account state (public read by address) ──────────────────────────────

  accountState(address: string) {
    return this.client.get<{ data: unknown }>(
      `${this.client.spotBase}/accounts/${address}/state`,
    );
  }

  balances(address: string) {
    return this.client.get<{ data: unknown[] }>(
      `${this.client.spotBase}/accounts/${address}/balances`,
    );
  }

  openOrders(address: string) {
    return this.client.get<{ data: unknown[] }>(
      `${this.client.spotBase}/accounts/${address}/orders`,
    );
  }

  ordersHistory(address: string, params?: { symbolID?: string; limit?: number }) {
    return this.client.get<{ data: unknown[] }>(
      `${this.client.spotBase}/accounts/${address}/orders/history`,
      params,
    );
  }

  userTrades(address: string, params?: { symbolID?: string; limit?: number }) {
    return this.client.get<{ data: unknown[] }>(
      `${this.client.spotBase}/accounts/${address}/trades`,
      params,
    );
  }

  // ── Trading (signed write) ──────────────────────────────────────────────

  /**
   * Place one or more spot orders.
   * Action type: "batchNewOrder"
   * Wire format: side/type/timeInForce are ints (1=BUY, 2=SELL; 1=LIMIT, 2=MARKET; 1=GTC, 2=FOK, 3=IOC, 4=GTX).
   */
  batchNewOrder(params: {
    accountID: number | bigint;
    orders: Array<{
      symbolID: number | bigint;
      clOrdID: string;
      side: 'BUY' | 'SELL';
      type: 'LIMIT' | 'MARKET';
      timeInForce: 'GTC' | 'IOC' | 'FOK' | 'GTX';
      price?: string;
      quantity?: string;
      funds?: string;
    }>;
  }) {
    const sideMap = { BUY: 1, SELL: 2 } as const;
    const typeMap = { LIMIT: 1, MARKET: 2 } as const;
    const tifMap = { GTC: 1, FOK: 2, IOC: 3, GTX: 4 } as const;
    const wireParams = {
      accountID: params.accountID,
      orders: params.orders.map((o) => {
        const out: Record<string, unknown> = {
          symbolID: o.symbolID,
          clOrdID: o.clOrdID,
          side: sideMap[o.side],
          type: typeMap[o.type],
          timeInForce: tifMap[o.timeInForce],
        };
        if (o.price !== undefined) out['price'] = o.price;
        if (o.quantity !== undefined) out['quantity'] = o.quantity;
        if (o.funds !== undefined) out['funds'] = o.funds;
        return out;
      }),
    };
    return this.client.postSigned('spot', `${this.client.spotBase}/trade/orders/batch`, {
      type: 'batchNewOrder',
      params: wireParams,
    });
  }

  /**
   * Cancel one or more spot orders.
   * Action type: "batchCancelOrder"
   */
  batchCancelOrder(params: {
    accountID: number | bigint;
    cancels: Array<{
      symbolID: number | bigint;
      clOrdID: string;
      orderID?: number | bigint;
      origClOrdID?: string;
    }>;
  }) {
    return this.client.deleteSigned('spot', `${this.client.spotBase}/trade/orders/batch`, {
      type: 'batchCancelOrder',
      params,
    });
  }

  /** Replace orders. Action type: "replaceOrder" */
  replaceOrder(params: { accountID: number | bigint; orders: unknown[] }) {
    return this.client.postSigned('spot', `${this.client.spotBase}/trade/orders/replace`, {
      type: 'replaceOrder',
      params,
    });
  }

  /** Action type: "transferAsset" */
  transferAsset(params: {
    id: string;
    fromAccountID: number | bigint;
    toAccountID: number | bigint;
    coinID: number | bigint;
    amount: string;
    type: string;
  }) {
    return this.client.postSigned('spot', `${this.client.spotBase}/accounts/transfers`, {
      type: 'transferAsset',
      params,
    });
  }

  /** Action type: "scheduleCancel" — dead-man switch */
  scheduleCancel(params: { accountID: number | bigint; scheduledTimestamp: number }) {
    return this.client.postSigned(
      'spot',
      `${this.client.spotBase}/trade/orders/schedule-cancel`,
      { type: 'scheduleCancel', params },
    );
  }
}
