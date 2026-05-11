import {
  type Hex,
  type LocalAccount,
  keccak256,
  toBytes,
  toHex,
} from 'viem';

/**
 * EIP-712 signing for SoDEX, ported byte-for-byte from the official Go SDK
 * (sodex-tech/sodex-go-sdk-public). Matches the wire-format exactly:
 *
 *   1. payloadHash = keccak256(compact JSON of {type, params})
 *      - JSON keys MUST be in struct declaration order (no alphabetisation)
 *      - decimals serialised as strings ("5", not 5)
 *      - omitempty fields removed when null/undefined
 *   2. EIP-712 sign of ExchangeAction{payloadHash, nonce} with domain
 *      { name: "spot" | "perps", version: "1", chainId }
 *   3. 65-byte ECDSA signature, prepended by 0x01 → 66-byte wire signature
 *
 * The signature is sent in the **X-API-Sign** header (NOT the POST body),
 * along with X-API-Nonce and X-API-Chain.
 */

export type SigningDomain = 'spot' | 'perps';

const DOMAIN_NAME: Record<SigningDomain, string> = {
  spot: 'spot',
  perps: 'perps',
};

export interface ActionPayload<T = unknown> {
  type: string;
  params: T;
}

export interface SignedAction {
  payload: ActionPayload;
  nonce: bigint;
  /** 66-byte hex signature (1-byte type prefix + 65-byte ECDSA). */
  signature: Hex;
}

export interface SoDEXSigner {
  readonly address: Hex;
  sign(payload: ActionPayload, domain: SigningDomain): Promise<SignedAction>;
}

export interface CreateSignerOptions {
  account: LocalAccount;
  chainId: number;
  /** Defaults to a monotonic ms timestamp; SoDEX accepts (now-2d, now+1d). */
  nonceGenerator?: () => bigint;
}

let lastNonce = 0n;
function defaultNonce(): bigint {
  const ts = BigInt(Date.now());
  if (ts <= lastNonce) {
    lastNonce = lastNonce + 1n;
  } else {
    lastNonce = ts;
  }
  return lastNonce;
}

/**
 * Stable JSON.stringify that preserves insertion order, omits undefined/null,
 * and converts bigints to strings. Matches Go's json.Marshal output for the
 * SoDEX action payload structures.
 */
export function actionJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v === null || v === undefined) return undefined;
    if (typeof v === 'bigint') return v.toString();
    return v;
  });
}

export function payloadHash(payload: ActionPayload): Hex {
  return keccak256(toBytes(actionJson(payload)));
}

export function createSigner(opts: CreateSignerOptions): SoDEXSigner {
  const generateNonce = opts.nonceGenerator ?? defaultNonce;
  const account = opts.account;

  return {
    address: account.address,
    async sign(payload, domain): Promise<SignedAction> {
      const nonce = generateNonce();
      const ph = payloadHash(payload);

      // The full EIP712 domain per SoDEX whitepaper:
      // name + version + chainId + verifyingContract (zero address).
      // viem auto-injects the EIP712Domain typed-data record from the domain object.
      const sigHex = await account.signTypedData({
        domain: {
          name: DOMAIN_NAME[domain],
          version: '1',
          chainId: opts.chainId,
          verifyingContract: '0x0000000000000000000000000000000000000000',
        },
        types: {
          ExchangeAction: [
            { name: 'payloadHash', type: 'bytes32' },
            { name: 'nonce', type: 'uint64' },
          ],
        },
        primaryType: 'ExchangeAction',
        message: {
          payloadHash: ph,
          nonce,
        },
      });

      // Normalise the v byte: viem returns Ethereum-style 27/28, Go's
      // crypto.Sign expects 0/1. Subtract 27 from the last byte if needed.
      const sigBytes = toBytes(sigHex);
      if (sigBytes.length !== 65) {
        throw new Error(`expected 65-byte signature, got ${sigBytes.length}`);
      }
      const normalised = new Uint8Array(sigBytes);
      const lastByte = normalised[64];
      if (lastByte === undefined) {
        throw new Error('signature missing recovery byte');
      }
      if (lastByte >= 27) {
        normalised[64] = lastByte - 27;
      }

      // Prepend the SignatureTypeEIP712 (0x01) byte → 66-byte wire signature.
      const wire = new Uint8Array(normalised.length + 1);
      wire[0] = 1;
      wire.set(normalised, 1);

      return {
        payload,
        nonce,
        signature: toHex(wire),
      };
    },
  };
}
