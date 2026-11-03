import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Address, Hex } from 'viem';
import { NETWORK, POD_KEY_PREFIX, TRADE_KEY_TTL_MS } from './config';

/**
 * The trading key lives only in this browser. It signs orders; the user's wallet
 * signs once to register it. POD's servers never see it.
 *
 * Stored in localStorage under the wallet address and network. A key is only
 * trusted while it is also listed by the gateway and unexpired.
 */

export interface TradeKey {
  /** The API key name sent as X-API-Key. */
  name: string;
  privateKey: Hex;
  address: Address;
  accountID: number;
  /** Milliseconds since epoch. */
  expiresAt: number;
}

function slot(owner: string): string {
  return `pod.tradekey.${NETWORK}.${owner.toLowerCase()}`;
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function createTradeKey(owner: Address, accountID: number, now = Date.now()): TradeKey {
  const privateKey = generatePrivateKey();
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(2)), (b) => b.toString(16).padStart(2, '0')).join('');
  return {
    // pod-<owner6>-<base36 ms>-<rand>: the timestamp lets the oldest key be found when a slot has to be freed.
    name: `${POD_KEY_PREFIX}${owner.slice(2, 8).toLowerCase()}-${now.toString(36)}-${rand}`,
    privateKey,
    address: privateKeyToAccount(privateKey).address,
    accountID,
    expiresAt: now + TRADE_KEY_TTL_MS,
  };
}

export function saveTradeKey(owner: Address, key: TradeKey): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(slot(owner), JSON.stringify(key));
    return true;
  } catch {
    return false;
  }
}

export function loadTradeKey(owner: Address, now = Date.now()): TradeKey | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(slot(owner));
    if (!raw) return null;
    const key = JSON.parse(raw) as Partial<TradeKey>;
    if (
      typeof key.name !== 'string' ||
      typeof key.privateKey !== 'string' ||
      !/^0x[0-9a-fA-F]{64}$/.test(key.privateKey) ||
      typeof key.accountID !== 'number' ||
      typeof key.expiresAt !== 'number'
    ) {
      return null;
    }
    if (key.expiresAt <= now) return null;
    return {
      name: key.name,
      privateKey: key.privateKey as Hex,
      address: privateKeyToAccount(key.privateKey as Hex).address,
      accountID: key.accountID,
      expiresAt: key.expiresAt,
    };
  } catch {
    return null;
  }
}

export function forgetTradeKey(owner: Address): void {
  try {
    storage()?.removeItem(slot(owner));
  } catch {
    /* storage unavailable: nothing to forget */
  }
}
