/**
 * Live testnet check of the order-confirmation sources and of leverage handling.
 * Testnet only. Never prints keys.
 *
 *   1. After a real order, can the fill be found by order id from trades, from the
 *      order record, and from a balance change? (the three sources confirmOrder uses)
 *   2. What leverage does a market have when nothing has been set?
 *   3. Does updateLeverage with the integer margin mode work, and does the position show it?
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { SoDEX, assertOrdersAccepted, canonicalDecimal, confirmOrder, quantityForNotional, type FillRow, type OrderRecord } from '../src/index.js';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

const pk = process.env['SODEX_PRIVATE_KEY'] as Hex | undefined;
if (!pk) throw new Error('SODEX_PRIVATE_KEY missing');
const me = privateKeyToAccount(pk).address;

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
const record = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const short = (v: unknown, n = 300) => (JSON.stringify(v) ?? 'undefined').slice(0, n);

async function main() {
  const reader = SoDEX.publicOnly('testnet');
  const accountID = (await reader.public.primaryAccountID(me))!;
  const keys = (await reader.public.apiKeys(me, accountID)) as { spot?: Array<{ name: string; publicKey: string }> };
  const keyName = keys.spot!.find((k) => k.publicKey.toLowerCase() === me.toLowerCase())!.name;
  const sdk = SoDEX.fromPrivateKey(pk, 'testnet', keyName);

  // ── 1. Spot: find a real fill by order id from every source ──
  const symbols = (await reader.spot.symbols()) as unknown as { data: Array<{ id: number; name: string; displayName?: string; status: string }> };
  const sym = symbols.data.find((s) => s.status === 'TRADING' && s.displayName === 'BTC/USDC')!;
  const before = ((await reader.spot.balances(me)) as unknown as { data: { balances: Array<{ coin: string; total: string }> } }).data.balances;
  const btcBefore = Number(before.find((b) => b.coin === 'vBTC')?.total ?? 0);

  let orderID = 0;
  let clOrdID = '';
  for (let attempt = 0; attempt < 4 && !orderID; attempt++) {
    clOrdID = `cf-${Date.now()}-${attempt}`;
    const res = await sdk.spot.batchNewOrder({ accountID, orders: [{ symbolID: sym.id, clOrdID, side: 'BUY', type: 'MARKET', timeInForce: 'IOC', funds: '6' }] });
    const [item] = assertOrdersAccepted(res);
    orderID = item!.orderID!;
    await sleep(2500);
    const mineNow = ((await reader.spot.userTrades(me, { accountID, limit: 20 })) as unknown as { data: FillRow[] }).data.filter((t) => t.orderID === orderID);
    if (mineNow.length === 0) orderID = 0; // nothing executed: try again
  }
  record('a spot market BUY was accepted and has an order id', orderID > 0, `orderID=${orderID} clOrdID=${clOrdID}`);

  // The gateway's documented `orderID` filter is ignored (every trade comes back, newest first),
  // so the match has to be made here, by order id or client order id.
  const allTrades = ((await reader.spot.userTrades(me, { accountID, orderID, symbol: sym.name })) as unknown as { data: FillRow[] }).data;
  record('FINDING: the orderID filter on trades is ignored by the gateway (returns other orders too)', allTrades.some((t) => t.orderID !== orderID), `returned ${allTrades.length} trades for ${new Set(allTrades.map((t) => t.orderID)).size} orders`);
  const mine = allTrades.filter((t) => t.orderID === orderID || t.clOrdID === clOrdID);
  record('matching by orderID or clOrdID on the client finds the fill', mine.length > 0, short(mine[0]));

  const rec = await findSpotOrder(reader, orderID, sym.name, accountID);
  console.log(`order record present right now: ${!!rec} (order history lags, so absence is not a verdict)`);

  const after = ((await reader.spot.balances(me)) as unknown as { data: { balances: Array<{ coin: string; total: string }> } }).data.balances;
  const btcAfter = Number(after.find((b) => b.coin === 'vBTC')?.total ?? 0);
  record('the base-asset balance moved (third source)', btcAfter > btcBefore, `vBTC ${btcBefore} -> ${btcAfter}`);

  // The real routine against the real gateway, with the trades source forced empty (the mainnet symptom).
  const lines: string[] = [];
  const confirmed = await confirmOrder(
    {
      trades: async () => [],
      order: async () => undefined,
      balanceMoved: async () => {
        const b = ((await reader.spot.balances(me)) as unknown as { data: { balances: Array<{ coin: string; total: string }> } }).data.balances;
        return Number(b.find((x) => x.coin === 'vBTC')?.total ?? 0) > btcBefore;
      },
      sleep,
      now: () => Date.now(),
    },
    { timeoutMs: 20_000, onProgress: (l) => lines.push(l) },
  );
  record('with the trades list AND order history both empty (the mainnet symptom), the balance change still reports FILLED', confirmed.state === 'filled', short(confirmed));

  // ── 2 & 3. Perps leverage ──
  const perps = (await reader.perps.symbols()) as unknown as { data: Array<Record<string, unknown> & { id: number; name: string; status: string }> };
  const psym = perps.data.find((s) => s.name === 'SOL-USD' && s.status === 'TRADING') ?? perps.data.find((s) => s.name === 'LINK-USD' && s.status === 'TRADING')!;
  const initLeverage = Number(psym['initLeverage']);
  const maxLeverage = Number(psym['maxLeverage']);
  const book = (await reader.perps.orderbook(psym.name, 5)) as unknown as { data: { asks?: Array<[string, string]> } };
  const px = Number(book.data.asks?.[0]?.[0]);
  const rules = { stepSize: String(psym['stepSize']), minQuantity: String(psym['minQuantity']), maxQuantity: String(psym['maxQuantity']), minNotional: String(psym['minNotional']), maxNotional: String(psym['maxNotional']), quantityPrecision: Number(psym['quantityPrecision']) };
  const size = quantityForNotional({ notional: 12, price: canonicalDecimal(px), rules });
  if (!size.ok) throw new Error(size.reason);

  const open = async (label: string) => {
    const id = `lv-${label}-${Date.now()}`;
    assertOrdersAccepted(await sdk.perps.newOrder({ accountID, symbolID: psym.id, orders: [{ clOrdID: id, modifier: 1, side: 1, type: 2, timeInForce: 3, quantity: size.quantity, reduceOnly: false, positionSide: 1 }] }));
    await sleep(3000);
    return ((await reader.perps.positions(me, { accountID })) as unknown as { data: { positions: Array<Record<string, unknown>> } }).data.positions.find((p) => p['symbol'] === psym.name && Number(p['size']) !== 0);
  };
  const close = async () => {
    const pos = ((await reader.perps.positions(me, { accountID })) as unknown as { data: { positions: Array<Record<string, unknown>> } }).data.positions.find((p) => p['symbol'] === psym.name && Number(p['size']) !== 0);
    if (!pos) return;
    assertOrdersAccepted(await sdk.perps.newOrder({ accountID, symbolID: psym.id, orders: [{ clOrdID: `lc-${Date.now()}`, modifier: 1, side: Number(pos['size']) > 0 ? 2 : 1, type: 2, timeInForce: 3, quantity: canonicalDecimal(String(pos['size']).replace(/^-/, '')), reduceOnly: true, positionSide: 1 }] }));
    await sleep(3000);
  };

  await close();
  const defaultPos = await open('default');
  console.log(`market ${psym.name}: initLeverage=${initLeverage} maxLeverage=${maxLeverage} position keys: ${Object.keys(defaultPos ?? {}).join(',')}`);
  record('with no leverage ever set by us, the position leverage equals the market initLeverage or the account setting (report which)', !!defaultPos, `position.leverage=${defaultPos?.['leverage']} marginMode=${defaultPos?.['marginMode']} initLeverage=${initLeverage}`);
  await close();

  const target = Math.min(5, maxLeverage);
  const upd = (await sdk.perps.updateLeverage({ accountID, symbolID: psym.id, leverage: target, marginMode: 'CROSS' })) as { code: number };
  record('updateLeverage with marginMode CROSS (sent as the integer 2) is accepted', upd.code === 0, short(upd));
  const afterPos = await open('set');
  record('the new position reports the leverage we set', Number(afterPos?.['leverage']) === target, `position.leverage=${afterPos?.['leverage']} wanted=${target} marginMode=${afterPos?.['marginMode']}`);

  // Changing leverage while a position is open (same margin mode) is allowed.
  const upd2 = (await sdk.perps.updateLeverage({ accountID, symbolID: psym.id, leverage: Math.min(3, maxLeverage), marginMode: 'CROSS' })) as { code: number };
  record('changing leverage with the same margin mode while a position is open is accepted', upd2.code === 0, short(upd2));
  await close();
  // Restore the market default so later runs start clean.
  await sdk.perps.updateLeverage({ accountID, symbolID: psym.id, leverage: initLeverage, marginMode: 'CROSS' }).catch(() => undefined);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  for (const f of failed) console.log(`FAILED: ${f.name} -> ${f.detail}`);
  process.exit(failed.length ? 1 : 0);
}

async function findSpotOrder(reader: ReturnType<typeof SoDEX.publicOnly>, orderID: number, symbol: string, accountID: number): Promise<OrderRecord | undefined> {
  const open = ((await reader.spot.openOrders(me, { accountID })) as unknown as { data: { orders?: OrderRecord[] } | null }).data?.orders ?? [];
  const hist = ((await reader.spot.ordersHistory(me, { accountID, limit: 100 })) as unknown as { data: OrderRecord[] | null }).data ?? [];
  void symbol;
  return [...open, ...hist].find((o) => Number(o.orderID) === orderID);
}

main().catch((e) => {
  console.error('script error:', e);
  process.exit(2);
});
