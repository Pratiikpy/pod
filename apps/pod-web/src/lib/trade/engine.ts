import {
  SoDEX,
  canonicalDecimal,
  enginesHolding,
  keySlots,
  pickKeyToRemove,
  type ApiKeyInfo,
  type ApiKeyList,
  type KeySlots,
  type MarketRules,
} from '@pod/sodex-sdk';
import type { Address } from 'viem';
import { APPROVAL_CEILING, BUILDER_ID, NETWORK, POD_KEY_PREFIX, SODEX_CHAIN } from './config';
import { createTradeKey, forgetTradeKey, saveTradeKey, type TradeKey } from './session';
import { checkBuilderHealth } from './health';
import { ensureWalletChain, signWithWallet, type ConnectedWallet } from './wallets';

/**
 * Everything the trade page does against SoDEX, run in the visitor's browser.
 * The gateway allows cross-origin signed requests, so orders go straight from the
 * browser to SoDEX. POD never proxies, stores or sees a key.
 */

export const reader = SoDEX.publicOnly(NETWORK);
export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

export async function balancesOf(engine: 'spot' | 'perps', address: Address): Promise<Holding[]> {
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
/**
 * Thrown before any signature is requested when POD's builder account is below SoDEX's 100 vUSDC floor.
 * Without this check the gateway refuses the approval on one engine but can accept the key on the other,
 * which leaves an orphan key that uses up one of the account's ten slots every time the user retries.
 */
export class BuilderPausedError extends Error {
  constructor() {
    super('POD’s builder account is below the 100 USDC SoDEX requires, so fee approvals are paused. Nothing was signed. Try again shortly.');
    this.name = 'BuilderPausedError';
  }
}

export async function enableTrading(connected: ConnectedWallet, accountID: number): Promise<EnableResult> {
  const health = await checkBuilderHealth();
  if (health && !health.ok) throw new BuilderPausedError();
  await assertKeyRoom(connected.address, accountID);
  const key = createTradeKey(connected.address, accountID);
  try {
    await registerKey(connected, accountID, key);
  } catch (err) {
    // The cap is only ever seen on the gateway, so its own refusal is as good as the preflight.
    if (/maximum number of API keys/i.test(err instanceof Error ? err.message : '')) throw await keyLimitError(connected.address, accountID);
    throw err;
  }
  return confirmKey(connected, key);
}

async function registerKey(connected: ConnectedWallet, accountID: number, key: TradeKey): Promise<void> {
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
}

async function confirmKey(connected: ConnectedWallet, key: TradeKey): Promise<EnableResult> {
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

// ── API key slots ──────────────────────────────────────────────────────────

/**
 * SoDEX allows ten API keys per account and keeps expired ones. Every browser that enables trading
 * creates one, so an account that has been set up on enough devices can no longer enable trading.
 * This error carries what the page needs to offer a way out.
 */
export class KeyLimitError extends Error {
  readonly slots: KeySlots;
  /** The oldest key this app created, which is the one the page offers to remove. */
  readonly removable: ApiKeyInfo | null;
  constructor(slots: KeySlots, removable: ApiKeyInfo | null) {
    super(`Your SoDEX account has used all ${slots.used} of its API key slots.`);
    this.name = 'KeyLimitError';
    this.slots = slots;
    this.removable = removable;
  }
}

async function keyLimitError(address: Address, accountID: number): Promise<KeyLimitError> {
  const keys = (await reader.public.apiKeys(address, accountID)) as ApiKeyList;
  return new KeyLimitError(keySlots(keys), pickKeyToRemove(keys, POD_KEY_PREFIX));
}

async function assertKeyRoom(address: Address, accountID: number): Promise<void> {
  const keys = (await reader.public.apiKeys(address, accountID)) as ApiKeyList;
  if (keySlots(keys).full) throw new KeyLimitError(keySlots(keys), pickKeyToRemove(keys, POD_KEY_PREFIX));
}

/**
 * Removes the oldest key this app created, on both engines, to make room. Removal is signed by the
 * master wallet with the SoDEX chain id in the signed data, so the wallet is moved to that chain first.
 * Returns the wallet as it is afterwards (its chain changed).
 */
export async function freeKeySlot(connected: ConnectedWallet, accountID: number): Promise<{ removed: string; connected: ConnectedWallet }> {
  const keys = (await reader.public.apiKeys(connected.address, accountID)) as ApiKeyList;
  const victim = pickKeyToRemove(keys, POD_KEY_PREFIX);
  if (!victim) {
    throw new Error('None of the API keys on this account were created by POD, so POD cannot remove any of them. Remove one on sodex.com first.');
  }
  const onChain = await ensureWalletChain(connected, SODEX_CHAIN);
  // Only ask an engine to remove the key where it is listed: an orphan from a half-failed registration exists on one.
  for (const engine of enginesHolding(keys, victim.name)) {
    await reader.public.revokeApiKey(
      connected.address,
      { network: NETWORK, engine, accountID, name: victim.name },
      (req) => signWithWallet(onChain, req),
    );
  }
  for (let i = 0; i < 8; i++) {
    await wait(1000);
    const after = (await reader.public.apiKeys(connected.address, accountID)) as ApiKeyList;
    if (!after.spot?.some((k) => k.name === victim.name) && !after.perps?.some((k) => k.name === victim.name)) {
      return { removed: victim.name, connected: onChain };
    }
  }
  throw new Error('The removal was accepted but the key is still listed. Wait a moment and try again.');
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
  /** Taker fee as a decimal string, e.g. "0.00065". Spot buys pay it in the asset bought. */
  takerFee?: string;
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
  takerFee?: string;
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
    ...(s.takerFee !== undefined ? { takerFee: s.takerFee } : {}),
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
