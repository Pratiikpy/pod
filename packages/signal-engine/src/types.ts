import { z } from 'zod';

export type RiskProfile = 'CHILL' | 'BALANCED' | 'SEND_IT';

export interface RiskParameters {
  /** Maximum drawdown the user accepts before forced de-risking. */
  maxDrawdownPct: number;
  /** Allocation skew toward risk-on assets when signal is bullish. */
  riskOnSkew: number;
  /** Min allocation to stables (always held as cushion). */
  minStableAllocation: number;
  /** Max leverage (perps multiplier). 1 = spot only. */
  maxLeverage: number;
}

export const RISK_PRESETS: Record<RiskProfile, RiskParameters> = {
  CHILL: {
    maxDrawdownPct: 0.05,
    riskOnSkew: 0.4,
    minStableAllocation: 0.4,
    maxLeverage: 1,
  },
  BALANCED: {
    maxDrawdownPct: 0.1,
    riskOnSkew: 0.7,
    minStableAllocation: 0.2,
    maxLeverage: 1,
  },
  SEND_IT: {
    maxDrawdownPct: 0.2,
    riskOnSkew: 1.0,
    minStableAllocation: 0.05,
    maxLeverage: 2,
  },
};

export const SignalDirectionSchema = z.enum(['STRONG_SELL', 'SELL', 'HOLD', 'BUY', 'STRONG_BUY']);
export type SignalDirection = z.infer<typeof SignalDirectionSchema>;

export const SignalSourceSchema = z.enum([
  'ETF_FLOW',
  'MACRO_EVENT',
  'NEWS_SENTIMENT',
  'BTC_TREASURY',
  'VC_FUNDING',
  'SOCIAL_SENTIMENT',
  'STABLECOIN_LIQUIDITY',
  'PERP_FUNDING',
  'SSI_INDEX',
]);
export type SignalSource = z.infer<typeof SignalSourceSchema>;

export const SignalContributionSchema = z.object({
  source: SignalSourceSchema,
  weight: z.number(),
  zScore: z.number(),
  confidence: z.number(),
  rationale: z.string(),
  citation: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type SignalContribution = z.infer<typeof SignalContributionSchema>;

export const BasketAllocationSchema = z.object({
  symbol: z.string(),
  weight: z.number(), // 0..1, sums to 1 across the basket
});
export type BasketAllocation = z.infer<typeof BasketAllocationSchema>;

export const PodSignalSchema = z.object({
  asset: z.string(),
  generated_at: z.string(), // ISO timestamp
  direction: SignalDirectionSchema,
  /** 0..100 — final POD Score (logistic-squashed weighted z-score). */
  podScore: z.number(),
  /** Raw composite z-score. */
  compositeZ: z.number(),
  contributions: z.array(SignalContributionSchema),
  /** Target basket allocation given this signal + risk profile. */
  targetBasket: z.array(BasketAllocationSchema),
  /** Plain-English summary for users. */
  reasoning: z.string(),
  /** True if low-confidence (uncertain regime). */
  uncertain: z.boolean(),
});
export type PodSignal = z.infer<typeof PodSignalSchema>;
