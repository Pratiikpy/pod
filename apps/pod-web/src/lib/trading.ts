import { SoDEX } from '@pod/sodex-sdk';
import type { Hex } from 'viem';
import type { PodSignal } from '@pod/signal-engine';

/**
 * Translates a POD signal into one or more SoDEX orders.
 * Wave 1 strategy: market-buy when direction is BUY/STRONG_BUY,
 * skip otherwise (no short side until perps account is funded).
 *
 * Returns the order response (or a structured error explaining why
 * trading is gated — e.g. API key not registered yet on testnet).
 */
export interface TradeAttempt {
  attempted: boolean;
  reason?: string;
  result?: unknown;
  error?: string;
  symbolID?: number;
  funds?: string;
}

const SUPPORTED_SYMBOLS: Record<string, string[]> = {
  BTC: ['BTC/USDC', 'TESTBTC/USDC'],
  ETH: ['ETH/USDC', 'TESTETH/USDC'],
  SOL: ['SOL/USDC'],
  XRP: ['XRP/USDC'],
  DOGE: ['DOGE/USDC'],
  AVAX: ['AVAX/USDC'],
  LINK: ['LINK/USDC'],
  LTC: ['LTC/USDC'],
};

interface SymbolInfo {
  id: number;
  name: string;
  displayName?: string;
  status: string;
  minNotional?: string;
  pricePrecision?: number;
  baseCoinPrecision?: number;
}

interface Ticker {
  symbol?: string;
  lastPx?: string;
  bidPx?: string;
  askPx?: string;
}

/** "vSOL_vUSDC" / "SOL/USDC" → "SOLUSDC" for robust matching. */
function normSym(s: string | undefined): string {
  return (s ?? '').replace(/^v/, '').replace(/_v/g, '').replace(/\//g, '').replace(/_/g, '').toUpperCase();
}

async function resolveAccountAndSymbol(
  sdk: ReturnType<typeof SoDEX.fromPrivateKey>,
  asset: string,
): Promise<{ accountID: number; symbol: SymbolInfo; price: number } | { error: string }> {
  const addr = sdk.client.signerAddress;
  const state = (await sdk.spot.accountState(addr)) as { data: { aid: number } };
  const accountID = state.data.aid;
  const resp = (await sdk.spot.symbols()) as { data: SymbolInfo[] };
  const candidates = SUPPORTED_SYMBOLS[asset] ?? [];
  const symbol = resp.data.find(
    (s) => s.status === 'TRADING' && candidates.includes(s.displayName ?? s.name),
  );
  if (!symbol) return { error: `No tradable ${asset} pair on SoDEX testnet.` };
  // Price off the live orderbook best bid — on testnet the ticker lastPx can
  // diverge wildly from the book, and a limit price must sit inside the band.
  let price = 0;
  try {
    const ob = (await sdk.spot.orderbook(symbol.name, 5)) as {
      data?: { bids?: Array<[string, string]> };
    };
    price = Number(ob.data?.bids?.[0]?.[0] ?? 0);
  } catch {
    /* fall through to ticker */
  }
  if (price <= 0) {
    const target = normSym(symbol.displayName ?? symbol.name);
    const tickers = (await sdk.spot.tickers()) as { data: Ticker[] };
    const t = tickers.data.find((x) => normSym(x.symbol) === target);
    price = Number(t?.lastPx ?? t?.bidPx ?? 0);
  }
  return { accountID, symbol, price };
}

/**
 * Signal-triggered limit ladder (F39): places a batch of GTC limit buys
 * stepped below the current price. Returns the order response or an error.
 */
export async function placeLimitLadder(params: {
  privateKey: Hex;
  asset: string;
  totalUsd: number;
  steps?: number;
}): Promise<TradeAttempt> {
  const sdk = SoDEX.fromPrivateKey(params.privateKey, 'testnet');
  const r = await resolveAccountAndSymbol(sdk, params.asset).catch((e) => ({ error: (e as Error).message }));
  if ('error' in r) return { attempted: false, error: r.error };
  if (r.price <= 0) return { attempted: false, error: 'No live price to ladder against right now.' };

  const steps = Math.max(2, Math.min(params.steps ?? 4, 6));
  const per = Math.max(1, params.totalUsd / steps);
  const pp = r.symbol.pricePrecision ?? 2;
  const qp = Math.min(r.symbol.baseCoinPrecision ?? 4, 6);
  const orders = Array.from({ length: steps }, (_, i) => {
    const price = r.price * (1 - (i + 1) * 0.01); // -1%, -2%, ...
    const quantity = per / price; // limit orders need quantity + price, not funds
    return {
      symbolID: r.symbol.id,
      clOrdID: `pod-lad-${Date.now()}-${i}`,
      side: 'BUY' as const,
      type: 'LIMIT' as const,
      timeInForce: 'GTC' as const,
      price: price.toFixed(pp),
      quantity: quantity.toFixed(qp),
    };
  });
  try {
    const result = await sdk.spot.batchNewOrder({ accountID: r.accountID, orders });
    return { attempted: true, result, symbolID: r.symbol.id, funds: String(params.totalUsd) };
  } catch (err) {
    return { attempted: true, error: (err as Error).message, symbolID: r.symbol.id };
  }
}

/**
 * Dead-man switch (F19): schedules a cancel-all after `minutes`. If the trader
 * does nothing, all resting orders are cancelled automatically.
 */
export async function scheduleDeadman(params: { privateKey: Hex; minutes: number }): Promise<TradeAttempt> {
  const sdk = SoDEX.fromPrivateKey(params.privateKey, 'testnet');
  try {
    const addr = sdk.client.signerAddress;
    const state = (await sdk.spot.accountState(addr)) as { data: { aid: number } };
    const scheduledTimestamp = Date.now() + Math.max(1, params.minutes) * 60_000;
    const result = await sdk.spot.scheduleCancel({ accountID: state.data.aid, scheduledTimestamp });
    return { attempted: true, result };
  } catch (err) {
    return { attempted: false, error: (err as Error).message };
  }
}

export async function tradeOnSignal(params: {
  privateKey: Hex;
  signal: PodSignal;
  fundsUsd: number;
}): Promise<TradeAttempt> {
  const { privateKey, signal, fundsUsd } = params;

  if (signal.direction !== 'BUY' && signal.direction !== 'STRONG_BUY') {
    return {
      attempted: false,
      reason: `Skipped — direction is ${signal.direction}, only BUY/STRONG_BUY trade in Wave 1.`,
    };
  }

  const sdk = SoDEX.fromPrivateKey(privateKey, 'testnet');
  const addr = sdk.client.signerAddress;

  let accountID: number;
  try {
    const state = (await sdk.spot.accountState(addr)) as { data: { aid: number } };
    accountID = state.data.aid;
  } catch (err) {
    return {
      attempted: false,
      error: `Could not resolve account: ${(err as Error).message}`,
    };
  }

  let symbols: SymbolInfo[];
  try {
    const resp = (await sdk.spot.symbols()) as { data: SymbolInfo[] };
    symbols = resp.data;
  } catch (err) {
    return {
      attempted: false,
      error: `Could not list symbols: ${(err as Error).message}`,
    };
  }

  const candidates = SUPPORTED_SYMBOLS[signal.asset] ?? [];
  const targets = symbols.filter(
    (s) => s.status === 'TRADING' && candidates.includes(s.displayName ?? s.name),
  );
  if (targets.length === 0) {
    return {
      attempted: false,
      reason: `No tradable ${signal.asset} pair on SoDEX testnet right now.`,
    };
  }

  // Try each tradable pair in order. On testnet, individual pairs intermittently
  // go into "cancel only mode" or report "MissingOraclePrice" — that is a venue
  // state, not an auth problem. Walk the list until one accepts the order, and
  // if none do, report what happened on each.
  const notes: string[] = [];
  for (const target of targets) {
    const funds = String(Math.max(fundsUsd, Number(target.minNotional ?? '5') + 1));
    const clOrdID = `pod-${Date.now()}-${signal.asset}`;
    try {
      const result = await sdk.spot.batchNewOrder({
        accountID,
        orders: [
          { symbolID: target.id, clOrdID, side: 'BUY', type: 'MARKET', timeInForce: 'IOC', funds },
        ],
      });
      // batchNewOrder returns code 0 at the envelope level even when an individual
      // order is rejected — unpack the per-order result.
      const inner = (result as { data?: Array<{ code: number; error?: string }> }).data?.[0];
      if (inner && inner.code !== 0) {
        notes.push(`${target.displayName ?? target.name}: ${inner.error ?? 'rejected'}`);
        continue;
      }
      return { attempted: true, result, symbolID: target.id, funds };
    } catch (err) {
      notes.push(`${target.displayName ?? target.name}: ${(err as Error).message}`);
    }
  }
  return {
    attempted: true,
    error: `No ${signal.asset} pair accepted the order. ${notes.join(' · ')}`,
    symbolID: targets[0]!.id,
    funds: String(fundsUsd),
  };
}
