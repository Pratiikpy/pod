import type { SoDEXNetwork } from '@pod/sodex-sdk';

/**
 * Trading configuration. Everything here is public: the builder ID is an account
 * number, and no key material ever lives in configuration.
 *
 * `NEXT_PUBLIC_SODEX_NETWORK=testnet` points the whole flow at testnet for
 * verification. Production is mainnet.
 */
export const NETWORK: SoDEXNetwork =
  process.env['NEXT_PUBLIC_SODEX_NETWORK'] === 'testnet' ? 'testnet' : 'mainnet';

/** POD's builder account per network. Mainnet is the funded SoDEX account that receives fees. */
const BUILDER_IDS: Record<SoDEXNetwork, number> = {
  mainnet: 235300,
  testnet: 53229,
};

export const BUILDER_ID: number = Number(process.env['NEXT_PUBLIC_POD_BUILDER_ID'] ?? BUILDER_IDS[NETWORK]);

/**
 * Fees POD requests on each order, in tenths of a basis point (10 = 1 bp).
 * Perps 5 bp on both sides, spot 10 bp on sells (spot buys carry no builder fee),
 * Wealth 10 bp. A user approves one ceiling that covers all of them.
 */
export const REQUESTED_FEE = { spot: 100, perps: 50, wealth: 100 } as const;

/** The ceiling a user signs once. The gateway charges min(requested, ceiling, engine cap). */
export const APPROVAL_CEILING = 100;

/** How long a browser-held trading key stays valid before the user re-enables. */
export const TRADE_KEY_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export const EXPLORER = {
  signup: 'https://sodex.com',
  deposit: 'https://sodex.com/portfolio',
  approvals: 'https://sodex.com/builder-code-approvals',
} as const;

export const FEE_DESCRIPTION = {
  spot: `${REQUESTED_FEE.spot / 10} bp on sells`,
  perps: `${REQUESTED_FEE.perps / 10} bp each way`,
  wealth: `${REQUESTED_FEE.wealth / 10} bp on redeems and sells`,
} as const;
