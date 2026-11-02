import {
  SoDEX,
  assertOrdersAccepted,
  canonicalDecimal,
  checkSize,
  quantityForNotional,
  quoteBuilderFee,
  type FeeQuote,
  type MarketRules,
} from '@pod/sodex-sdk';
import type { Address } from 'viem';
import { APPROVAL_CEILING, BUILDER_ID, NETWORK, REQUESTED_FEE } from './config';
import { createTradeKey, forgetTradeKey, saveTradeKey, type TradeKey } from './session';
import { signWithWallet, type ConnectedWallet } from './wallets';

/**
 * Everything the trade page does against SoDEX, run in the visitor's browser.
 * The gateway allows cross-origin signed requests, so orders go straight from the
 * browser to SoDEX. POD never proxies, stores or sees a key.
 */

const reader = SoDEX.publicOnly(NETWORK);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Account ────────────────────────────────────────────────────────────────

export interface Holding {
  coin: string;
  total: number;
}

export interface AccountSnapshot {
  /** null until the address has made its first SoDEX deposit. */
  accountID: number | null;
  spotUsdc: number;
  perpsUsdc: number;
  spotHoldings: Holding[];
  approval: { spot: number; perps: number; approvedBothEngines: boolean };
  /** Whether the stored trading key is registered on BOTH engines. */
  keyListed: boolean;
}

interface BalancesEnvelope {
  data?: { balances?: Array<{ coin: string; total: string }> };
}

async function balancesOf(engine: 'spot' | 'perps', address: Address): Promise<Holding[]> {
  const res = (await (engine === 'spot' ? reader.spot.balances(address) : reader.perps.balances(address))) as unknown as BalancesEnvelope;
  return (res.data?.balances ?? []).map((b) => ({ coin: b.coin, total: Number(b.total) }));
}

export async function loadAccount(address: Address, key: TradeKey | null): Promise<AccountSnapshot> {
  const accountID = await reader.public.primaryAccountID(address);
  if (!accountID) {
    return { accountID: null, spotUsdc: 0, perpsUsdc: 0, spotHoldings: [], approval: { spot: 0, perps: 0, approvedBothEngines: false }, keyListed: false };
  }
  const [spot, perps, approval, keys] = await Promise.all([
    balancesOf('spot', address),
    balancesOf('perps', address),
    reader.public.approvalFor(address, BUILDER_ID),
    key ? reader.public.apiKeys(address, accountID) : Promise.resolve(null),
  ]);
  const listed = (engine: unknown) => Array.isArray(engine) && engine.some((k: { name?: string }) => k.name === key?.name);
  const k = keys as { spot?: unknown; perps?: unknown } | null;
  return {
    accountID,
    spotUsdc: spot.find((h) => h.coin === 'vUSDC')?.total ?? 0,
    perpsUsdc: perps.find((h) => h.coin === 'vUSDC')?.total ?? 0,
    spotHoldings: spot.filter((h) => h.total > 0),
    approval,
    keyListed: !!key && !!k && listed(k.spot) && listed(k.perps),
  };
}

// ── Enabling trading: one wallet signature ─────────────────────────────────

export interface EnableResult {
  key: TradeKey;
  approval: { spot: number; perps: number; approvedBothEngines: boolean };
}

/**
 * Registers a fresh browser-held trading key AND approves POD's builder fee in a
 * single wallet signature (`AddAPIKeyWithBuilder`). The wallet signs on its own
 * active chain, which the gateway accepts and which avoids a network switch.
 */
export async function enableTrading(connected: ConnectedWallet, accountID: number): Promise<EnableResult> {
  const key = createTradeKey(connected.address, accountID);
  await reader.public.addApiKey(
    connected.address,
    {
      network: NETWORK,
      domainChainId: connected.chainId,
      accountID,
      name: key.name,
      publicKey: key.address,
      expiresAt: key.expiresAt,
      builder: { id: BUILDER_ID, fee: APPROVAL_CEILING },
    },
    (req) => signWithWallet(connected, req),
  );

  // The gateway applies each engine separately and queries can lag: confirm both.
  for (let i = 0; i < 8; i++) {
    await wait(1200);
    const snap = await loadAccount(connected.address, key);
    if (snap.keyListed && snap.approval.approvedBothEngines) {
      saveTradeKey(connected.address, key);
      return { key, approval: snap.approval };
    }
  }
  throw new Error('SoDEX accepted the signature but the key or fee approval has not appeared on both engines yet. Refresh in a minute and check again.');
}

/** Re-approves the builder for a user whose key is fine but whose approval was cleared. */
export async function reapproveFee(connected: ConnectedWallet, accountID: number): Promise<void> {
  await reader.public.approveBuilderFee(
    connected.address,
    { network: NETWORK, domainChainId: connected.chainId, accountID, builderID: BUILDER_ID, maxFeeRate: APPROVAL_CEILING },
    (req) => signWithWallet(connected, req),
  );
  for (let i = 0; i < 8; i++) {
    await wait(1200);
    if ((await reader.public.approvalFor(connected.address, BUILDER_ID)).approvedBothEngines) return;
  }
  throw new Error('The approval was accepted but is not visible on both engines yet.');
}

/** Clears the fee approval with the wallet (universal signature, no network switch). */
export async function clearFeeApproval(connected: ConnectedWallet, accountID: number): Promise<void> {
  await reader.public.approveBuilderFee(
    connected.address,
    { network: NETWORK, domainChainId: connected.chainId, accountID, builderID: BUILDER_ID, maxFeeRate: 0 },
    (req) => signWithWallet(connected, req),
  );
}

export function forgetLocalKey(address: Address): void {
  forgetTradeKey(address);
}

// ── Markets ────────────────────────────────────────────────────────────────

export interface Market extends MarketRules {
  engine: 'spot' | 'perps';
  id: number;
  /** Gateway symbol name used for order books, e.g. "vBTC_vUSDC" or "BTC-USD". */
  name: string;
  /** Human label, e.g. "BTC/USDC" or "BTC-USD". */
  label: string;
  baseCoin: string;
  maxLeverage?: number;
  initLeverage?: number;
}

interface RawSymbol {
  id: number;
  name: string;
  displayName?: string;
  baseCoin: string;
  status: string;
  stepSize: string;
  minQuantity: string;
  maxQuantity?: string;
  marketMinQuantity?: string;
  marketMaxQuantity?: string;
  minNotional: string;
  maxNotional?: string;
  quantityPrecision: number;
  maxLeverage?: number;
  initLeverage?: number;
}

function toMarket(engine: 'spot' | 'perps', s: RawSymbol): Market {
  return {
    engine,
    id: s.id,
    name: s.name,
    label: s.displayName ?? s.name,
    baseCoin: s.baseCoin.replace(/^v/, ''),
    stepSize: s.stepSize,
    minQuantity: s.marketMinQuantity && s.marketMinQuantity !== '0' ? s.marketMinQuantity : s.minQuantity,
    maxQuantity: s.marketMaxQuantity && s.marketMaxQuantity !== '0' ? s.marketMaxQuantity : s.maxQuantity ?? '0',
    minNotional: s.minNotional,
    maxNotional: s.maxNotional ?? '0',
    quantityPrecision: s.quantityPrecision,
    ...(s.maxLeverage !== undefined ? { maxLeverage: s.maxLeverage } : {}),
    ...(s.initLeverage !== undefined ? { initLeverage: s.initLeverage } : {}),
  };
}

/** Wealth funds are published by the mainnet gateway only. */
const WEALTH_URL = 'https://mainnet-gw.sodex.dev/api/v1/wealth/funds';

export interface WealthFund {
  fundId: string;
  name: string;
  fundType: string;
  fundStatus: string;
  spot?: { symbol: string; displayName: string };
}

export async function loadWealthFunds(): Promise<WealthFund[]> {
  const res = await fetch(WEALTH_URL, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Wealth funds request failed (${res.status})`);
  const body = (await res.json()) as { code?: number; data?: WealthFund[] };
  if (body.code !== 0 || !Array.isArray(body.data)) throw new Error('Wealth funds response was not in the expected shape');
  return body.data;
}

/**
 * The Wealth products that trade on the order book (`fundType: clob`): tokenized
 * ETFs and stocks such as QQQ and VOO. They are ordinary spot markets, so they use
 * the same signed-order and builder-fee path as Spot. Vault funds are not included.
 */
export function wealthMarkets(funds: WealthFund[], spot: Market[]): Market[] {
  const live = new Map(funds.filter((f) => f.fundType === 'clob' && f.fundStatus === 'live' && f.spot).map((f) => [f.spot!.symbol, f]));
  return spot.filter((m) => live.has(m.name)).map((m) => ({ ...m, label: m.label }));
}

export async function loadMarkets(engine: 'spot' | 'perps'): Promise<Market[]> {
  const res = (await (engine === 'spot' ? reader.spot.symbols() : reader.perps.symbols())) as unknown as { data: RawSymbol[] };
  return res.data.filter((s) => s.status === 'TRADING').map((s) => toMarket(engine, s));
}

/** Best executable price: the ask when buying, the bid when selling. */
export async function executablePrice(market: Market, side: 'BUY' | 'SELL'): Promise<number> {
  const book = (await (market.engine === 'spot' ? reader.spot.orderbook(market.name, 5) : reader.perps.orderbook(market.name, 5))) as unknown as {
    data?: { asks?: Array<[string, string]>; bids?: Array<[string, string]> };
  };
  const level = side === 'BUY' ? book.data?.asks?.[0] : book.data?.bids?.[0];
  return Number(level?.[0] ?? 0);
}

// ── Orders ─────────────────────────────────────────────────────────────────

function newClOrdID(prefix: string): string {
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

function tradeClient(key: TradeKey) {
  return SoDEX.fromPrivateKey(key.privateKey, NETWORK, key.name);
}

export interface Fill {
  price: string;
  quantity: string;
  fee?: string;
  builderFee?: string;
  feeCoin?: string;
}

export interface OrderOutcome {
  clOrdID: string;
  orderID?: number;
  filled: Fill | null;
  quote: FeeQuote;
}

interface TradeRow extends Fill {
  clOrdID: string;
}

async function waitForFill(engine: 'spot' | 'perps', address: Address, clOrdID: string): Promise<Fill | null> {
  for (let i = 0; i < 7; i++) {
    await wait(1200);
    const res = (await (engine === 'spot' ? reader.spot.userTrades(address, { limit: 20 }) : reader.perps.userTrades(address, { limit: 20 }))) as unknown as { data: TradeRow[] };
    const row = res.data.find((t) => t.clOrdID === clOrdID);
    if (row) return row;
  }
  return null;
}

export type SizeCheck = { ok: true; quantity: string; notional: string; price: number } | { ok: false; reason: string };

/** Sizes an order from a USD amount using the live book and the market's own rules. */
export async function sizeOrder(market: Market, side: 'BUY' | 'SELL', usd: number): Promise<SizeCheck> {
  const price = await executablePrice(market, side);
  const r = quantityForNotional({ notional: usd, price: price ? canonicalDecimal(price) : 0, rules: market });
  if (!r.ok) return r;
  return { ok: true, quantity: r.quantity, notional: r.notional, price };
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

export async function placeSpot(input: {
  key: TradeKey;
  address: Address;
  market: Market;
  side: 'BUY' | 'SELL';
  usd: number;
  approvedFee: number;
}): Promise<OrderOutcome> {
  const { key, market, side } = input;
  const sized = await sizeOrder(market, side, input.usd);
  if (!sized.ok) throw new Error(sized.reason);
  const clOrdID = newClOrdID('pod');
  const order =
    side === 'BUY'
      ? { symbolID: market.id, clOrdID, side, type: 'MARKET' as const, timeInForce: 'IOC' as const, funds: canonicalDecimal(input.usd) }
      : { symbolID: market.id, clOrdID, side, type: 'MARKET' as const, timeInForce: 'IOC' as const, quantity: sized.quantity };
  if (side === 'BUY') {
    const minOk = checkSize(sized.quantity, sized.price, market);
    if (!minOk.ok) throw new Error(minOk.reason);
  }
  const res = await tradeClient(key).spot.batchNewOrder({
    accountID: key.accountID,
    orders: [order],
    builder: { id: BUILDER_ID, fee: REQUESTED_FEE.spot },
  });
  const [item] = assertOrdersAccepted(res);
  const filled = await waitForFill('spot', input.address, clOrdID);
  return { clOrdID, filled, quote: quoteFor(market, side, Number(sized.notional), input.approvedFee), ...(item?.orderID !== undefined ? { orderID: item.orderID } : {}) };
}

export async function placePerps(input: {
  key: TradeKey;
  address: Address;
  market: Market;
  side: 'BUY' | 'SELL';
  usd: number;
  reduceOnly: boolean;
  approvedFee: number;
}): Promise<OrderOutcome> {
  const { key, market, side } = input;
  const sized = await sizeOrder(market, side, input.usd);
  if (!sized.ok) throw new Error(sized.reason);
  const clOrdID = newClOrdID('pod');
  const res = await tradeClient(key).perps.newOrder({
    accountID: key.accountID,
    symbolID: market.id,
    builder: { id: BUILDER_ID, fee: REQUESTED_FEE.perps },
    orders: [
      {
        clOrdID,
        modifier: 1,
        side: side === 'BUY' ? 1 : 2,
        type: 2,
        timeInForce: 3,
        quantity: sized.quantity,
        reduceOnly: input.reduceOnly,
        positionSide: 1,
      },
    ],
  });
  const [item] = assertOrdersAccepted(res);
  const filled = await waitForFill('perps', input.address, clOrdID);
  return { clOrdID, filled, quote: quoteFor(market, side, Number(sized.notional), input.approvedFee), ...(item?.orderID !== undefined ? { orderID: item.orderID } : {}) };
}

// ── Perps positions ────────────────────────────────────────────────────────

export interface Position {
  symbol: string;
  /** Signed: negative is short. */
  size: string;
  avgEntryPrice: string;
  initialMargin: string;
}

export async function loadPositions(address: Address): Promise<Position[]> {
  const res = (await reader.perps.positions(address)) as unknown as { data?: { positions?: Position[] } };
  return (res.data?.positions ?? []).filter((p) => Number(p.size) !== 0);
}

/** Closes a position with a reduce-only market order on the opposite side for its exact size. */
export async function closePosition(input: {
  key: TradeKey;
  address: Address;
  market: Market;
  position: Position;
  approvedFee: number;
}): Promise<OrderOutcome> {
  const { key, market, position } = input;
  const long = Number(position.size) > 0;
  const quantity = canonicalDecimal(position.size.replace(/^-/, ''));
  const side = long ? 'SELL' : 'BUY';
  const price = await executablePrice(market, side);
  // Closing is never blocked by the minimum notional: a reduce-only order may be smaller than it.
  const clOrdID = newClOrdID('pod');
  const res = await tradeClient(key).perps.newOrder({
    accountID: key.accountID,
    symbolID: market.id,
    builder: { id: BUILDER_ID, fee: REQUESTED_FEE.perps },
    orders: [{ clOrdID, modifier: 1, side: long ? 2 : 1, type: 2, timeInForce: 3, quantity, reduceOnly: true, positionSide: 1 }],
  });
  const [item] = assertOrdersAccepted(res);
  const filled = await waitForFill('perps', input.address, clOrdID);
  const notional = price * Number(quantity);
  return { clOrdID, filled, quote: quoteFor(market, side, notional, input.approvedFee), ...(item?.orderID !== undefined ? { orderID: item.orderID } : {}) };
}
