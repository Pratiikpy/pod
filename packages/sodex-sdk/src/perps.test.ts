import { describe, it, expect } from 'vitest';
import { PerpsAPI } from './perps.js';
import { SpotAPI } from './spot.js';
import { MARGIN_MODE } from './types.js';
import { actionJson } from './signing.js';
import type { SoDEXClient } from './client.js';

function fake() {
  const signed: Array<{ domain: string; path: string; payload: { type: string; params: unknown } }> = [];
  const gets: Array<{ path: string; query?: Record<string, unknown> }> = [];
  const client = {
    spotBase: '/api/v1/spot',
    perpsBase: '/api/v1/perps',
    postSigned: async (domain: string, path: string, payload: { type: string; params: unknown }) => {
      signed.push({ domain, path, payload });
      return { code: 0 };
    },
    get: async (path: string, query?: Record<string, unknown>) => {
      gets.push(query === undefined ? { path } : { path, query });
      return { data: [] };
    },
  } as unknown as SoDEXClient;
  return { client, signed, gets };
}

describe('updateLeverage wire format (bug found on live mainnet)', () => {
  it('the margin mode names map to the integers the gateway needs: 1 isolated, 2 cross', () => {
    expect(MARGIN_MODE).toEqual({ ISOLATED: 1, CROSS: 2 });
  });

  it('sends the integer, not the word the gateway cannot unmarshal', async () => {
    const { client, signed } = fake();
    await new PerpsAPI(client).updateLeverage({ accountID: 9, symbolID: 3, leverage: 5, marginMode: 'CROSS' });
    expect(actionJson(signed[0]!.payload)).toBe('{"type":"updateLeverage","params":{"accountID":9,"symbolID":3,"leverage":5,"marginMode":2}}');
    await new PerpsAPI(client).updateLeverage({ accountID: 9, symbolID: 3, leverage: 5, marginMode: 'ISOLATED' });
    expect(actionJson(signed[1]!.payload)).toContain('"marginMode":1');
  });

  it('still accepts the integer directly', async () => {
    const { client, signed } = fake();
    await new PerpsAPI(client).updateLeverage({ accountID: 9, symbolID: 3, leverage: 40, marginMode: 2 });
    expect(actionJson(signed[0]!.payload)).toContain('"marginMode":2');
  });

  it('keeps the documented key order so the signature matches', async () => {
    const { client, signed } = fake();
    await new PerpsAPI(client).updateLeverage({ accountID: 9, symbolID: 3, leverage: 5, marginMode: 'CROSS' });
    expect(Object.keys(signed[0]!.payload.params as object)).toEqual(['accountID', 'symbolID', 'leverage', 'marginMode']);
  });

  it('refuses nonsense before anything is signed', async () => {
    const { client, signed } = fake();
    const api = new PerpsAPI(client);
    expect(() => api.updateLeverage({ accountID: 9, symbolID: 3, leverage: 0, marginMode: 'CROSS' })).toThrow(RangeError);
    expect(() => api.updateLeverage({ accountID: 9, symbolID: 3, leverage: 2.5, marginMode: 'CROSS' })).toThrow(RangeError);
    expect(() => api.updateLeverage({ accountID: 9, symbolID: 3, leverage: 5, marginMode: 7 })).toThrow(RangeError);
    expect(() => api.updateLeverage({ accountID: 9, symbolID: 3, leverage: 5, marginMode: 'NOPE' as never })).toThrow(RangeError);
    expect(signed).toHaveLength(0);
  });
});

describe('account queries use the parameter names the gateway documents', () => {
  it('trades and order history take symbol, orderID and accountID, not the old symbolID', async () => {
    const { client, gets } = fake();
    await new SpotAPI(client).userTrades('0xabc', { accountID: 5, orderID: 77, symbol: 'vBTC_vUSDC', limit: 10 });
    await new SpotAPI(client).ordersHistory('0xabc', { accountID: 5, symbol: 'vBTC_vUSDC' });
    await new PerpsAPI(client).userTrades('0xabc', { accountID: 5, orderID: 77 });
    expect(gets[0]).toEqual({ path: '/api/v1/spot/accounts/0xabc/trades', query: { accountID: 5, orderID: 77, symbol: 'vBTC_vUSDC', limit: 10 } });
    expect(gets[1]!.query).toEqual({ accountID: 5, symbol: 'vBTC_vUSDC' });
    expect(gets[2]!.query).toEqual({ accountID: 5, orderID: 77 });
  });

  it('open orders and positions accept an account id', async () => {
    const { client, gets } = fake();
    await new SpotAPI(client).openOrders('0xabc', { accountID: 5 });
    await new PerpsAPI(client).positions('0xabc', { accountID: 5 });
    expect(gets[0]!.query).toEqual({ accountID: 5 });
    expect(gets[1]!.query).toEqual({ accountID: 5 });
  });
});
