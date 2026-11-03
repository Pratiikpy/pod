import { type Hex, type TypedDataDomain, bytesToHex, hexToBytes, keccak256, toBytes } from 'viem';
import { type SoDEXNetwork, NETWORK_CONFIG } from './types.js';
import { actionJson, defaultNonce } from './signing.js';

/**
 * API key housekeeping.
 *
 * Live testing found that a SoDEX account holds at most TEN API keys per engine, that an
 * expired key stays on the account, and that a key can only be removed by a master-wallet
 * signature on the SoDEX chain id. A browser that creates a key each time it is set up
 * runs out of slots, so apps need to see the slots coming and free one.
 */

/** Observed on the testnet gateway: "account has reached maximum number of API keys". */
export const MAX_API_KEYS = 10;

export interface ApiKeyInfo {
  name: string;
  /** Milliseconds since epoch; 0 means the key never expires. */
  expiresAt: number;
  publicKey?: string;
  type?: string;
}

export interface ApiKeyList {
  spot?: ApiKeyInfo[];
  perps?: ApiKeyInfo[];
}

export interface KeySlots {
  /** Keys on the fuller engine. The cap applies per engine, and a key is added to both. */
  used: number;
  free: number;
  full: boolean;
}

export function keySlots(keys: ApiKeyList | null | undefined, max: number = MAX_API_KEYS): KeySlots {
  const used = Math.max(keys?.spot?.length ?? 0, keys?.perps?.length ?? 0);
  return { used, free: Math.max(0, max - used), full: used >= max };
}

/**
 * Every key on the account by name, merged across both engines. A registration that half-failed can
 * leave a key on ONE engine only (live: spot refused a builder while perps accepted the same request),
 * and that orphan still uses a slot, so looking at one engine's list is not enough.
 */
export function allKeys(keys: ApiKeyList): ApiKeyInfo[] {
  const byName = new Map<string, ApiKeyInfo>();
  for (const k of [...(keys.spot ?? []), ...(keys.perps ?? [])]) if (!byName.has(k.name)) byName.set(k.name, k);
  return [...byName.values()];
}

/** Which engines currently list this key. A revoke is only needed (and only possible) where it is listed. */
export function enginesHolding(keys: ApiKeyList, name: string): KeyEngine[] {
  const out: KeyEngine[] = [];
  if (keys.spot?.some((k) => k.name === name)) out.push('spot');
  if (keys.perps?.some((k) => k.name === name)) out.push('perps');
  return out;
}

/**
 * The key an app should remove to make room: one it created (matching `prefix`), expired ones
 * first, then the oldest by the creation time encoded in its name, then the rest. Orphans that
 * exist on only one engine count.
 */
export function pickKeyToRemove(keys: ApiKeyList, prefix: string, now: number = Date.now()): ApiKeyInfo | null {
  const mine = allKeys(keys).filter((k) => k.name.startsWith(prefix));
  if (mine.length === 0) return null;
  const expired = (k: ApiKeyInfo) => k.expiresAt > 0 && k.expiresAt <= now;
  // Names created by this app carry a base-36 millisecond timestamp as their third segment.
  const born = (k: ApiKeyInfo) => {
    const t = Number.parseInt(k.name.split('-')[2] ?? '', 36);
    return Number.isFinite(t) ? t : 0;
  };
  mine.sort((a, b) => Number(expired(b)) - Number(expired(a)) || born(a) - born(b) || a.name.localeCompare(b.name));
  return mine[0] ?? null;
}

// ── Revoking with the master wallet ─────────────────────────────────────────

export type KeyEngine = 'spot' | 'perps';

/**
 * Revocation is an ordinary engine action signed by the MASTER wallet, once per engine.
 * Unlike registration, its EIP-712 domain chain id must be the SoDEX network's own
 * (verified live: signing on another chain is refused as "API key not found"), so a
 * browser wallet has to be on that chain to sign it. The X-API-Chain header may be anything.
 */
export interface RevokeApiKeyInput {
  network: SoDEXNetwork;
  engine: KeyEngine;
  accountID: number | bigint;
  name: string;
  nonce?: bigint;
}

const ENGINE_DOMAIN: Record<KeyEngine, string> = { spot: 'spot', perps: 'futures' };

export function revokeApiKeyTypedData(input: RevokeApiKeyInput) {
  const nonce = input.nonce ?? defaultNonce();
  const accountID = Number(input.accountID);
  if (!Number.isSafeInteger(accountID) || accountID <= 0) throw new RangeError('accountID must be a positive safe integer');
  if (!/^[0-9a-zA-Z_-]{1,36}$/.test(input.name)) throw new RangeError('API key name must match ^[0-9a-zA-Z_-]{1,36}$');
  const params = { accountID, name: input.name };
  const payloadHash = keccak256(toBytes(actionJson({ type: 'revokeAPIKey', params })));
  const domain: TypedDataDomain = {
    name: ENGINE_DOMAIN[input.engine],
    version: '1',
    chainId: NETWORK_CONFIG[input.network].chainId,
    verifyingContract: '0x0000000000000000000000000000000000000000',
  };
  return {
    request: {
      domain,
      types: { ExchangeAction: [{ name: 'payloadHash', type: 'bytes32' }, { name: 'nonce', type: 'uint64' }] },
      primaryType: 'ExchangeAction' as const,
      message: { payloadHash, nonce },
    },
    nonce,
    body: params,
    path: `/api/v1/${input.engine}/accounts/api-keys`,
  };
}

/** Wire form of an engine-action signature: 0x01 || r || s || v with v normalised to 0 or 1. */
export function toEngineSignature(signature: Hex): Hex {
  const bytes = hexToBytes(signature);
  if (bytes.length !== 65) throw new Error(`expected a 65-byte signature, got ${bytes.length}`);
  const out = new Uint8Array(66);
  out[0] = 1;
  out.set(bytes, 1);
  const v = out[65]!;
  if (v === 27 || v === 28) out[65] = v - 27;
  else if (v !== 0 && v !== 1) throw new Error(`unexpected recovery byte ${v}`);
  return bytesToHex(out);
}

export function engineHeaders(network: SoDEXNetwork, signature: Hex, nonce: bigint): Record<string, string> {
  return {
    'content-type': 'application/json',
    accept: 'application/json',
    'X-API-Chain': String(NETWORK_CONFIG[network].chainId),
    'X-API-Sign': toEngineSignature(signature),
    'X-API-Nonce': nonce.toString(),
  };
}
