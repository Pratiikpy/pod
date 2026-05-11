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
};

interface SymbolInfo {
  id: number;
  name: string;
  displayName?: string;
  status: string;
  minNotional?: string;
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
