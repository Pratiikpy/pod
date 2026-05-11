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
