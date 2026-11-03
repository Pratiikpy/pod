import { SoDEX, builderEligibility } from '@pod/sodex-sdk';
import { BUILDER_ADDRESS, NETWORK } from './config';

/**
 * SoDEX only lets a user approve a builder fee while the builder account holds at least 100 vUSDC
 * in BOTH the spot and the perps engine. Below that, every new approval is refused ("builderID is
 * invalid") and nobody can enable trading. Existing approvals keep working.
 *
 * Source: https://docs.sodex.com/for-developers/developers/trading/builder-codes-in-trading
 */
export const BUILDER_FLOOR_VUSDC = 100;

export interface BuilderHealth {
  /** True when new fee approvals will be accepted. */
  ok: boolean;
  spot: number;
  perps: number;
  floor: number;
}

interface BalancesEnvelope {
  data?: { balances?: Array<{ coin: string; total: string }> };
}

function usdc(res: unknown): number {
  const rows = (res as BalancesEnvelope).data?.balances ?? [];
  return Number(rows.find((b) => b.coin === 'vUSDC')?.total ?? 0);
}

/**
 * Reads the builder account's balances. Returns null when they cannot be read, and callers must then
 * NOT block anyone: a failed read is not evidence that the builder is underfunded.
 */
export async function checkBuilderHealth(): Promise<BuilderHealth | null> {
  const api = SoDEX.publicOnly(NETWORK);
  try {
    const [spot, perps] = await Promise.all([api.spot.balances(BUILDER_ADDRESS), api.perps.balances(BUILDER_ADDRESS)]);
    const s = usdc(spot);
    const p = usdc(perps);
    return { ok: builderEligibility({ spot: s, perps: p }, BUILDER_FLOOR_VUSDC).ok, spot: s, perps: p, floor: BUILDER_FLOOR_VUSDC };
  } catch {
    return null;
  }
}
