import { type Hex, type TypedDataDomain, hexToBytes, bytesToHex } from 'viem';
import { type SoDEXNetwork, NETWORK_CONFIG } from './types.js';
import { defaultNonce } from './signing.js';

/**
 * SoDEX builder codes: a builder account earns a fee on fills an application
 * routes for a user, provided the user approved a maximum rate for that builder
 * with their master wallet.
 *
 * Source: https://docs.sodex.com/for-developers/developers/trading/builder-codes-in-trading
 * and https://docs.sodex.com/for-developers/developers/trading/authentication-and-signing
 *
 * Fee units are tenths of a basis point: 10 = 1 bp = 0.01%.
 */

/** Engine caps in tenths of a basis point. Spot 2%, Perps 0.2%. */
export const BUILDER_FEE_CAP = { spot: 2000, perps: 200 } as const;

/** Highest value the approval endpoint accepts. */
export const BUILDER_MAX_FEE_RATE = 2000;

/** A builder needs this much vUSDC in each engine to receive a non-zero approval. */
export const BUILDER_MIN_BALANCE_VUSDC = 100;

/**
 * Whether a builder account can receive new approvals: SoDEX requires BUILDER_MIN_BALANCE_VUSDC in
 * BOTH engines at the moment a user approves. Falling below it later does not stop fee credits, but
 * every new approval is refused until the balance is restored.
 */
export function builderEligibility(balances: { spot: number; perps: number }, floor: number = BUILDER_MIN_BALANCE_VUSDC) {
  const shortfall = { spot: Math.max(0, floor - balances.spot), perps: Math.max(0, floor - balances.perps) };
  return { ok: shortfall.spot === 0 && shortfall.perps === 0, shortfall };
}

/** A user can hold at most this many active builder approvals. */
export const BUILDER_MAX_APPROVALS_PER_USER = 10;

export type BuilderEngine = keyof typeof BUILDER_FEE_CAP;

/** The builder object embedded in a signed order, `id` before `fee`. */
export interface BuilderParams {
  /** Builder trading account ID (non-zero). */
  id: number | bigint;
  /** Requested rate in tenths of a basis point. */
  fee: number;
}

export function bpToFeeUnits(bp: number): number {
  if (!Number.isFinite(bp) || bp < 0) throw new RangeError(`basis points must be a non-negative number, got ${bp}`);
  const units = bp * 10;
  if (!Number.isInteger(units)) {
    throw new RangeError(`${bp} bp is finer than the 0.1 bp resolution SoDEX supports`);
  }
  return units;
}

export function feeUnitsToBp(units: number): number {
  return units / 10;
}

/** Validates a builder object for the engine it will be sent to. */
export function assertBuilderParams(builder: BuilderParams, engine: BuilderEngine): void {
  const id = BigInt(builder.id);
  if (id <= 0n) throw new RangeError('builder id must be non-zero');
  if (!Number.isInteger(builder.fee) || builder.fee < 0) {
    throw new RangeError(`builder fee must be a non-negative integer, got ${builder.fee}`);
  }
  if (builder.fee > BUILDER_MAX_FEE_RATE) {
    throw new RangeError(`builder fee ${builder.fee} is above the protocol maximum ${BUILDER_MAX_FEE_RATE}`);
  }
  // SoDEX reduces an over-cap rate rather than rejecting the order, which would
  // silently charge less than the caller expects, so refuse it up front.
  if (builder.fee > BUILDER_FEE_CAP[engine]) {
    throw new RangeError(
      `builder fee ${builder.fee} is above the ${engine} cap ${BUILDER_FEE_CAP[engine]} (${feeUnitsToBp(BUILDER_FEE_CAP[engine])} bp)`,
    );
  }
}

/** Normalises to the wire shape with the documented key order (id, then fee). */
export function toWireBuilder(builder: BuilderParams): { id: number; fee: number } {
  const id = Number(builder.id);
  if (!Number.isSafeInteger(id)) throw new RangeError(`builder id ${builder.id} is not a safe integer`);
  return { id, fee: builder.fee };
}

// ── Universal (account-level) EIP-712 actions ───────────────────────────────

/**
 * Domain for account-level actions. `chainId` must equal the X-API-Chain header.
 *
 * SoDEX accepts any uint64 here, so a browser wallet can sign with whatever
 * network it is currently on. Wallets such as MetaMask refuse typed data whose
 * domain chain differs from the active one, and the message's own `chainID`
 * field (always the SoDEX network) is what binds the action to mainnet/testnet.
 */
export function universalDomain(network: SoDEXNetwork, domainChainId?: number): TypedDataDomain {
  return {
    name: 'universal',
    version: '1',
    chainId: domainChainId ?? NETWORK_CONFIG[network].chainId,
    verifyingContract: '0x0000000000000000000000000000000000000000',
  };
}

const T = {
  ApproveBuilderFeeAction: [
    { name: 'chainID', type: 'uint64' },
    { name: 'nonce', type: 'uint64' },
    { name: 'accountID', type: 'uint64' },
    { name: 'builderID', type: 'uint64' },
    { name: 'maxFeeRate', type: 'uint64' },
  ],
  AddAPIKey: [
    { name: 'accountID', type: 'uint64' },
    { name: 'name', type: 'string' },
    { name: 'keyType', type: 'uint8' },
    { name: 'publicKey', type: 'bytes' },
    { name: 'expiresAt', type: 'uint64' },
    { name: 'nonce', type: 'uint64' },
  ],
  AddAPIKeyWithBuilder: [
    { name: 'chainID', type: 'uint64' },
    { name: 'nonce', type: 'uint64' },
    { name: 'accountID', type: 'uint64' },
    { name: 'name', type: 'string' },
    { name: 'keyType', type: 'uint8' },
    { name: 'publicKey', type: 'bytes' },
    { name: 'expiresAt', type: 'uint64' },
    { name: 'builderID', type: 'uint64' },
    { name: 'maxFeeRate', type: 'uint64' },
  ],
} as const;

/** Field order is part of the signature, so the type strings are exported for tests. */
export const UNIVERSAL_TYPES = T;

export const API_KEY_TYPE_EVM = 1;

const API_KEY_NAME = /^[0-9a-zA-Z_-]{1,36}$/;

export interface TypedDataRequest<P extends string, M> {
  domain: TypedDataDomain;
  types: Record<string, ReadonlyArray<{ name: string; type: string }>>;
  primaryType: P;
  message: M;
}

function assertUint64(label: string, value: bigint): void {
  if (value < 0n || value > 0xffffffffffffffffn) throw new RangeError(`${label} does not fit in uint64`);
}

export interface ApproveBuilderFeeInput {
  network: SoDEXNetwork;
  /** Wallet's active chain id, when it differs from the SoDEX network. Sent as X-API-Chain. */
  domainChainId?: number;
  /** The user's primary account ID (from the subaccounts endpoint). */
  accountID: number | bigint;
  builderID: number | bigint;
  /** 0 clears the approval; otherwise 1 to 2000 in tenths of a basis point. */
  maxFeeRate: number;
  nonce?: bigint;
}

export function approveBuilderFeeTypedData(input: ApproveBuilderFeeInput) {
  if (!Number.isInteger(input.maxFeeRate) || input.maxFeeRate < 0 || input.maxFeeRate > BUILDER_MAX_FEE_RATE) {
    throw new RangeError(`maxFeeRate must be an integer from 0 to ${BUILDER_MAX_FEE_RATE}`);
  }
  const builderID = BigInt(input.builderID);
  if (builderID <= 0n) throw new RangeError('builderID must be non-zero');
  const accountID = BigInt(input.accountID);
  assertUint64('accountID', accountID);
  const nonce = input.nonce ?? defaultNonce();
  const message = {
    chainID: BigInt(NETWORK_CONFIG[input.network].chainId),
    nonce,
    accountID,
    builderID,
    maxFeeRate: BigInt(input.maxFeeRate),
  };
  const request: TypedDataRequest<'ApproveBuilderFeeAction', typeof message> = {
    domain: universalDomain(input.network, input.domainChainId),
    types: { ApproveBuilderFeeAction: T.ApproveBuilderFeeAction },
    primaryType: 'ApproveBuilderFeeAction',
    message,
  };
  return { request, nonce, body: { accountID: Number(accountID), builderID: Number(builderID), maxFeeRate: input.maxFeeRate } };
}

export interface AddApiKeyInput {
  network: SoDEXNetwork;
  /** Wallet's active chain id, when it differs from the SoDEX network. Sent as X-API-Chain. */
  domainChainId?: number;
  accountID: number | bigint;
  /** 1-36 chars of [0-9a-zA-Z_-]. This is the value sent later in X-API-Key. */
  name: string;
  /** EVM address of the key pair held by the trading client. */
  publicKey: Hex;
  /** Milliseconds since epoch; 0 never expires. */
  expiresAt?: number;
  /** When set, the same signature also approves this builder. */
  builder?: BuilderParams;
  nonce?: bigint;
}

export function addApiKeyTypedData(input: AddApiKeyInput) {
  if (!API_KEY_NAME.test(input.name)) {
    throw new RangeError('API key name must match ^[0-9a-zA-Z_-]{1,36}$');
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.publicKey)) {
    throw new RangeError('publicKey must be a 20-byte EVM address');
  }
  const accountID = BigInt(input.accountID);
  assertUint64('accountID', accountID);
  const nonce = input.nonce ?? defaultNonce();
  const expiresAt = BigInt(input.expiresAt ?? 0);
  const chainID = BigInt(NETWORK_CONFIG[input.network].chainId);

  if (input.builder) {
    const builderID = BigInt(input.builder.id);
    if (builderID <= 0n) throw new RangeError('builder id must be non-zero');
    if (!Number.isInteger(input.builder.fee) || input.builder.fee < 0 || input.builder.fee > BUILDER_MAX_FEE_RATE) {
      throw new RangeError(`builder fee must be an integer from 0 to ${BUILDER_MAX_FEE_RATE}`);
    }
    const message = {
      chainID,
      nonce,
      accountID,
      name: input.name,
      keyType: API_KEY_TYPE_EVM,
      publicKey: input.publicKey,
      expiresAt,
      builderID,
      maxFeeRate: BigInt(input.builder.fee),
    };
    const request: TypedDataRequest<'AddAPIKeyWithBuilder', typeof message> = {
      domain: universalDomain(input.network, input.domainChainId),
      types: { AddAPIKeyWithBuilder: T.AddAPIKeyWithBuilder },
      primaryType: 'AddAPIKeyWithBuilder',
      message,
    };
    return {
      request,
      nonce,
      body: {
        accountID: Number(accountID),
        name: input.name,
        type: API_KEY_TYPE_EVM,
        publicKey: input.publicKey,
        expiresAt: Number(expiresAt),
        builder: toWireBuilder(input.builder),
      },
    };
  }

  const message = {
    accountID,
    name: input.name,
    keyType: API_KEY_TYPE_EVM,
    publicKey: input.publicKey,
    expiresAt,
    nonce,
  };
  const request: TypedDataRequest<'AddAPIKey', typeof message> = {
    domain: universalDomain(input.network, input.domainChainId),
    types: { AddAPIKey: T.AddAPIKey },
    primaryType: 'AddAPIKey',
    message,
  };
  return {
    request,
    nonce,
    body: {
      accountID: Number(accountID),
      name: input.name,
      type: API_KEY_TYPE_EVM,
      publicKey: input.publicKey,
      expiresAt: Number(expiresAt),
    },
  };
}

/**
 * Turns a wallet's 65-byte EIP-712 signature into the universal wire form:
 * 0x02 || r || s || v, with v normalised to 0 or 1 (wallets return 27 or 28).
 */
export function toUniversalSignature(signature: Hex): Hex {
  const bytes = hexToBytes(signature);
  if (bytes.length !== 65) throw new Error(`expected a 65-byte signature, got ${bytes.length}`);
  const out = new Uint8Array(66);
  out[0] = 2;
  out.set(bytes, 1);
  const v = out[65]!;
  if (v === 27 || v === 28) out[65] = v - 27;
  else if (v !== 0 && v !== 1) throw new Error(`unexpected recovery byte ${v}`);
  return bytesToHex(out);
}

/** Headers for an account-level request. `X-API-Chain` must equal the domain chainId. */
export function universalHeaders(
  network: SoDEXNetwork,
  signature: Hex,
  nonce: bigint,
  domainChainId?: number,
): Record<string, string> {
  return {
    'content-type': 'application/json',
    accept: 'application/json',
    'X-API-Chain': String(domainChainId ?? NETWORK_CONFIG[network].chainId),
    'X-API-Sign': toUniversalSignature(signature),
    'X-API-Nonce': nonce.toString(),
  };
}
