import { z } from 'zod';

// ── Network ─────────────────────────────────────────────────────────────────

export type SoDEXNetwork = 'mainnet' | 'testnet';

export const NETWORK_CONFIG: Record<
  SoDEXNetwork,
  { chainId: number; spotBaseUrl: string; perpsBaseUrl: string; spotWs: string; perpsWs: string }
> = {
  mainnet: {
    chainId: 286623,
    spotBaseUrl: 'https://mainnet-gw.sodex.dev/api/v1/spot',
    perpsBaseUrl: 'https://mainnet-gw.sodex.dev/api/v1/perps',
    spotWs: 'wss://mainnet-gw.sodex.dev/ws/spot',
    perpsWs: 'wss://mainnet-gw.sodex.dev/ws/perps',
  },
  testnet: {
    chainId: 138565,
    spotBaseUrl: 'https://testnet-gw.sodex.dev/api/v1/spot',
    perpsBaseUrl: 'https://testnet-gw.sodex.dev/api/v1/perps',
    spotWs: 'wss://testnet-gw.sodex.dev/ws/spot',
    perpsWs: 'wss://testnet-gw.sodex.dev/ws/perps',
  },
};

// ── Transfers ───────────────────────────────────────────────────────────────

/** TransferAssetTypeEnum integer values. The wire format takes the integer, not the name. */
export const TRANSFER_TYPE = {
  EVM_DEPOSIT: 0,
  PERPS_DEPOSIT: 1,
  EVM_WITHDRAW: 2,
  PERPS_WITHDRAW: 3,
  INTERNAL: 4,
  SPOT_WITHDRAW: 5,
} as const;
export type TransferTypeName = keyof typeof TRANSFER_TYPE;

export interface TransferAssetParams {
  /** Unique request id; sent as an unquoted uint64. */
  id: number | bigint | string;
  fromAccountID: number | bigint;
  /** 999 targets the EVM chain or the other engine, depending on `type`. */
  toAccountID: number | bigint;
  coinID: number | bigint;
  /** Human-readable decimal string, within the coin's precision. */
  amount: string;
  type: TransferTypeName | number;
}

/** Normalises a transfer to the wire shape: integer id, integer type. */
export function toWireTransfer(p: TransferAssetParams) {
  const id = typeof p.id === 'string' ? Number(p.id) : Number(p.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new RangeError(`transfer id must be a positive safe integer, got ${p.id}`);
  const type = typeof p.type === 'number' ? p.type : TRANSFER_TYPE[p.type];
  if (type === undefined) throw new RangeError(`unknown transfer type ${String(p.type)}`);
  return { id, fromAccountID: p.fromAccountID, toAccountID: p.toAccountID, coinID: p.coinID, amount: p.amount, type };
}

// ── Order types ─────────────────────────────────────────────────────────────

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'LIMIT' | 'MARKET' | 'STOP' | 'STOP_LIMIT';
export type TimeInForce = 'GTC' | 'IOC' | 'FOK' | 'GTX';
export type PositionSide = 'LONG' | 'SHORT' | 'BOTH';
export type MarginMode = 'CROSS' | 'ISOLATED';

// ── Response schemas (for typed downstream consumers) ───────────────────────

export const ApiResponseSchema = z.object({
  code: z.number(),
  data: z.unknown().optional(),
  message: z.string().optional(),
  timestamp: z.number().optional(),
});
