import {
  SoDEX,
  assertOrdersAccepted,
  buySellability,
  canonicalDecimal,
  checkSize,
  confirmOrder,
  quantityForNotional,
  quoteBuilderFee,
  sellability,
  type BuySellability,
  type Confirmation,
  type FeeQuote,
  type FillRow,
  type OrderRecord,
  type SellCheck,
} from '@pod/sodex-sdk';
import type { Address } from 'viem';
import { BUILDER_ID, NETWORK, REQUESTED_FEE } from './config';
import { balancesOf, executablePrice, reader, wait, type Market } from './engine';
import type { TradeKey } from './session';

/**
 * Placing orders and finding out what became of them.
 *
 * Live mainnet testing showed a filled order being reported as "no fill yet": the
 * trades, open-orders and order-history endpoints can all stay empty for minutes after
 * a fill. So an order is first SUBMITTED, then CONFIRMED from three independent sources
 * (see confirmOrder in the SDK), and "not filled" is only ever said when the order's own
 * record says so.
 */

function newClOrdID(prefix: string): string {
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

function tradeClient(key: TradeKey) {
  return SoDEX.fromPrivateKey(key.privateKey, NETWORK, key.name);
}

export interface Submitted {
  clOrdID: string;
  orderID?: number;
}

/** What the page shows once an order's fate is known. `result` is the honest verdict. */
export interface OrderOutcome extends Submitted {
  quote: FeeQuote;
  result: Confirmation;
}

// ── Reading what happened ──────────────────────────────────────────────────

/** The gateway returns lists either bare or wrapped as `{ orders: [...] }`. */
function asList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  const inner = (data as { orders?: unknown } | null | undefined)?.orders;
  return Array.isArray(inner) ? (inner as T[]) : [];
}

/**
 * The gateway ignores the documented `orderID` filter on trades and returns everything,
 * newest first, so the match is made here by order id or client order id.
 */
async function tradesFor(engine: 'spot' | 'perps', address: Address, accountID: number, sub: Submitted): Promise<FillRow[]> {
  const res = (await (engine === 'spot'
    ? reader.spot.userTrades(address, { accountID, limit: 50 })
    : reader.perps.userTrades(address, { accountID, limit: 50 }))) as unknown as { data?: FillRow[] };
  return (res.data ?? []).filter((t) => (sub.orderID !== undefined && Number(t.orderID) === sub.orderID) || t.clOrdID === sub.clOrdID);
}

/** The order's own record, from open orders or history. Either may lag, so a miss is not a verdict. */
async function recordFor(engine: 'spot' | 'perps', address: Address, accountID: number, sub: Submitted): Promise<OrderRecord | undefined> {
  const api = engine === 'spot' ? reader.spot : reader.perps;
  const [open, hist] = await Promise.all([
    api.openOrders(address, { accountID }).catch(() => ({ data: [] })),
    api.ordersHistory(address, { accountID, limit: 100 }).catch(() => ({ data: [] })),
  ]);
  const all = [...asList<OrderRecord>((open as { data?: unknown }).data), ...asList<OrderRecord>((hist as { data?: unknown }).data)];
  return all.find((o) => (sub.orderID !== undefined && Number(o.orderID) === sub.orderID) || o.clOrdID === sub.clOrdID);
}

export interface Position {
  symbol: string;
  /** Signed: negative is short. */
  size: string;
  avgEntryPrice: string;
  initialMargin: string;
  leverage?: number | string;
  marginMode?: string;
}

export async function loadPositions(address: Address): Promise<Position[]> {
  const res = (await reader.perps.positions(address)) as unknown as { data?: { positions?: Position[] } };
  return (res.data?.positions ?? []).filter((p) => Number(p.size) !== 0);
}

async function spotBase(address: Address, coin: string): Promise<number> {
  const rows = await balancesOf('spot', address);
  return rows.find((h) => h.coin.replace(/^v/, '') === coin)?.total ?? 0;
}

async function perpsSize(address: Address, symbol: string): Promise<number> {
  const rows = await loadPositions(address).catch(() => [] as Position[]);
  return Number(rows.find((p) => p.symbol === symbol)?.size ?? 0);
}

/** Reads what the account looked like before the order, so a later change can be attributed to it. */
async function baselineFor(market: Market, address: Address): Promise<number> {
  return market.engine === 'spot' ? spotBase(address, market.baseCoin) : perpsSize(address, market.name);
}

async function confirmSubmitted(input: {
  market: Market;
  side: 'BUY' | 'SELL';
  address: Address;
  accountID: number;
  submitted: Submitted;
  baseline: number;
  onProgress?: (line: string) => void;
}): Promise<Confirmation> {
  const { market, side, address, accountID, submitted, baseline } = input;
  return confirmOrder(
    {
      trades: () => tradesFor(market.engine, address, accountID, submitted),
      order: () => recordFor(market.engine, address, accountID, submitted),
      balanceMoved: async () => {
        const now = await baselineFor(market, address);
        // Spot: the asset bought rises, the asset sold falls. Perps: the signed position size moves the same way.
        return side === 'BUY' ? now > baseline : now < baseline;
      },
      sleep: wait,
      now: () => Date.now(),
    },
    { timeoutMs: 45_000, intervalMs: 1_500, ...(input.onProgress ? { onProgress: input.onProgress } : {}) },
  );
}

// ── Sizing and sellability ─────────────────────────────────────────────────

export type SizeCheck = { ok: true; quantity: string; notional: string; price: number } | { ok: false; reason: string };

/** Sizes an order from a USD amount using the live book and the market's own rules. */
export async function sizeOrder(market: Market, side: 'BUY' | 'SELL', usd: number): Promise<SizeCheck> {
  const price = await executablePrice(market, side);
  const r = quantityForNotional({ notional: usd, price: price ? canonicalDecimal(price) : 0, rules: market });
  if (!r.ok) return r;
  return { ok: true, quantity: r.quantity, notional: r.notional, price };
}

/**
 * Sizes an order from an exact quantity (used by "sell all", where converting a dollar amount back into a
 * quantity can land one step short when the price ticks between the quote and the click).
 */
export async function sizeExact(market: Market, side: 'BUY' | 'SELL', quantity: string): Promise<SizeCheck> {
  const price = await executablePrice(market, side);
  if (!price) return { ok: false, reason: 'no price available for this market right now' };
  const r = checkSize(canonicalDecimal(quantity), canonicalDecimal(price), market);
  if (!r.ok) return r;
  return { ok: true, quantity: r.quantity, notional: r.notional, price };
}

/** A spot buy can strand a holding too small to sell, because the buy fee comes out of the asset bought. */
export function checkBuyIsSellable(market: Market, quantity: string, price: number): BuySellability | null {
  if (market.engine !== 'spot' || !market.takerFee) return null;
  return buySellability({ quantity, takerFee: market.takerFee, price: canonicalDecimal(price), rules: market });
}

/** What can actually be sold from a holding of this market's base asset. */
export function checkHoldingIsSellable(market: Market, holding: number, price: number): SellCheck {
  return sellability({ holding: canonicalDecimal(holding), price: canonicalDecimal(price), rules: market });
}

export function quoteFor(market: Market, side: 'BUY' | 'SELL', notional: number, approvedFee: number): FeeQuote {
  return quoteBuilderFee({
    engine: market.engine,
    side,
    notional,
    requestedFee: REQUESTED_FEE[market.engine],
    approvedFee,
  });
}

// ── Spot ───────────────────────────────────────────────────────────────────

export async function placeSpot(input: {
  key: TradeKey;
  address: Address;
  market: Market;
  side: 'BUY' | 'SELL';
  usd: number;
  /** Sell exactly this quantity instead of converting `usd` (the amount is then only for display). */
  quantity?: string;
  approvedFee: number;
  /** Called the moment SoDEX accepts the order, before the fill is known. */
  onSubmitted?: (s: Submitted) => void;
  onProgress?: (line: string) => void;
}): Promise<OrderOutcome> {
  const { key, market, side } = input;
  const sized = input.quantity && side === 'SELL' ? await sizeExact(market, side, input.quantity) : await sizeOrder(market, side, input.usd);
  if (!sized.ok) throw new Error(sized.reason);
  if (side === 'BUY') {
    const minOk = checkSize(sized.quantity, sized.price, market);
    if (!minOk.ok) throw new Error(minOk.reason);
  }
  const clOrdID = newClOrdID('pod');
  const order =
    side === 'BUY'
      ? { symbolID: market.id, clOrdID, side, type: 'MARKET' as const, timeInForce: 'IOC' as const, funds: canonicalDecimal(input.usd) }
      : { symbolID: market.id, clOrdID, side, type: 'MARKET' as const, timeInForce: 'IOC' as const, quantity: sized.quantity };
  const baseline = await baselineFor(market, input.address).catch(() => 0);
  const res = await tradeClient(key).spot.batchNewOrder({
    accountID: key.accountID,
    orders: [order],
    builder: { id: BUILDER_ID, fee: REQUESTED_FEE.spot },
  });
  const [item] = assertOrdersAccepted(res);
  const submitted: Submitted = { clOrdID, ...(item?.orderID !== undefined ? { orderID: item.orderID } : {}) };
  input.onSubmitted?.(submitted);
  const result = await confirmSubmitted({ market, side, address: input.address, accountID: key.accountID, submitted, baseline, ...(input.onProgress ? { onProgress: input.onProgress } : {}) });
  return { ...submitted, quote: quoteFor(market, side, Number(sized.notional), input.approvedFee), result };
}

// ── Perps leverage ─────────────────────────────────────────────────────────

/**
 * Sets the leverage for a market before opening a position. A market that has never been touched
 * starts at its `initLeverage` in CROSS mode (verified on testnet), but the current leverage is
 * only readable from an open position, so a new position always sets it explicitly.
 *
 * A margin mode cannot change while a position is open, so an existing position's mode is kept.
 */
export async function applyLeverage(input: { key: TradeKey; address: Address; market: Market; leverage: number }): Promise<void> {
  const { key, market } = input;
  const existing = (await loadPositions(input.address)).find((p) => p.symbol === market.name);
  if (existing && Number(existing.leverage) === input.leverage) return;
  const marginMode = existing?.marginMode === 'ISOLATED' ? 'ISOLATED' : 'CROSS';
  const sdk = tradeClient(key);
  const res = await sdk.perps.updateLeverage({ accountID: key.accountID, symbolID: market.id, leverage: input.leverage, marginMode });
  sdk.client.assertEnvelopeOk(res, 'updateLeverage');
}

/** Initial margin an order needs at the chosen leverage, plus what the taker fee adds. */
export function marginNeeded(notional: number, leverage: number, takerFee = 0.0004): number {
  return notional / leverage + notional * takerFee;
}

export async function placePerps(input: {
  key: TradeKey;
  address: Address;
  market: Market;
  side: 'BUY' | 'SELL';
  usd: number;
  reduceOnly: boolean;
  leverage?: number;
  approvedFee: number;
  onSubmitted?: (s: Submitted) => void;
  onProgress?: (line: string) => void;
}): Promise<OrderOutcome> {
  const { key, market, side } = input;
  const sized = await sizeOrder(market, side, input.usd);
  if (!sized.ok) throw new Error(sized.reason);
  if (input.leverage !== undefined && !input.reduceOnly) {
    if (market.maxLeverage !== undefined && input.leverage > market.maxLeverage) {
      throw new Error(`The maximum leverage on ${market.label} is ${market.maxLeverage}x.`);
    }
    await applyLeverage({ key, address: input.address, market, leverage: input.leverage });
  }
  const clOrdID = newClOrdID('pod');
  const baseline = await baselineFor(market, input.address).catch(() => 0);
  const res = await tradeClient(key).perps.newOrder({
    accountID: key.accountID,
    symbolID: market.id,
    builder: { id: BUILDER_ID, fee: REQUESTED_FEE.perps },
    orders: [
      { clOrdID, modifier: 1, side: side === 'BUY' ? 1 : 2, type: 2, timeInForce: 3, quantity: sized.quantity, reduceOnly: input.reduceOnly, positionSide: 1 },
    ],
  });
  const [item] = assertOrdersAccepted(res);
  const submitted: Submitted = { clOrdID, ...(item?.orderID !== undefined ? { orderID: item.orderID } : {}) };
  input.onSubmitted?.(submitted);
  const result = await confirmSubmitted({ market, side, address: input.address, accountID: key.accountID, submitted, baseline, ...(input.onProgress ? { onProgress: input.onProgress } : {}) });
  return { ...submitted, quote: quoteFor(market, side, Number(sized.notional), input.approvedFee), result };
}

/** Closes a position with a reduce-only market order on the opposite side for its exact size. */
export async function closePosition(input: {
  key: TradeKey;
  address: Address;
  market: Market;
  position: Position;
  approvedFee: number;
  onSubmitted?: (s: Submitted) => void;
  onProgress?: (line: string) => void;
}): Promise<OrderOutcome> {
  const { key, market, position } = input;
  const long = Number(position.size) > 0;
  const quantity = canonicalDecimal(position.size.replace(/^-/, ''));
  const side = long ? 'SELL' : 'BUY';
  const price = await executablePrice(market, side);
  const clOrdID = newClOrdID('pod');
  const baseline = Number(position.size);
  // Closing is never blocked by the minimum notional: a reduce-only order may be smaller than it.
  const res = await tradeClient(key).perps.newOrder({
    accountID: key.accountID,
    symbolID: market.id,
    builder: { id: BUILDER_ID, fee: REQUESTED_FEE.perps },
    orders: [{ clOrdID, modifier: 1, side: long ? 2 : 1, type: 2, timeInForce: 3, quantity, reduceOnly: true, positionSide: 1 }],
  });
  const [item] = assertOrdersAccepted(res);
  const submitted: Submitted = { clOrdID, ...(item?.orderID !== undefined ? { orderID: item.orderID } : {}) };
  input.onSubmitted?.(submitted);
  const result = await confirmSubmitted({ market, side, address: input.address, accountID: key.accountID, submitted, baseline, ...(input.onProgress ? { onProgress: input.onProgress } : {}) });
  return { ...submitted, quote: quoteFor(market, side, price * Number(quantity), input.approvedFee), result };
}
