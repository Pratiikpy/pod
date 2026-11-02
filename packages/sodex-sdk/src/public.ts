import type { Hex } from 'viem';
import type { SoDEXClient } from './client.js';
import {
  type AddApiKeyInput,
  type ApproveBuilderFeeInput,
  addApiKeyTypedData,
  approveBuilderFeeTypedData,
  universalHeaders,
} from './builder.js';

export interface UserSubaccounts {
  userID: number;
  primaryAccountID: number;
  subaccounts: Array<{ id: number; evmAddress: string }>;
}

/** One approval row from `GET /user/{address}/builders`. */
export interface BuilderApproval {
  userID: number;
  builderID: number;
  feeRate: number;
}

export interface UserBuilders {
  spot: BuilderApproval[];
  perps: BuilderApproval[];
}

export interface BuilderFeeStats {
  address?: string;
  name: string;
  builderCode: string;
  userCount: string;
  builderFee: string;
  tradeCount: string;
  [key: string]: unknown;
}

interface Envelope<T> {
  code: number;
  data: T;
  timestamp?: number;
  message?: string;
}

/** A typed-data request produced by this SDK and signed by the user's wallet. */
export type WalletSigner = (request: ReturnType<typeof approveBuilderFeeTypedData>['request']) => Promise<Hex>;

/**
 * Cross-engine public endpoints: account lookup, API keys and builder codes.
 * Reads are unauthenticated. Writes are signed by the user's master wallet.
 */
export class PublicAPI {
  constructor(private readonly client: SoDEXClient) {}

  private userPath(address: string, suffix: string): string {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new RangeError(`invalid EVM address: ${address}`);
    return `${this.client.publicBase}/user/${address}${suffix}`;
  }

  async subaccounts(address: string): Promise<UserSubaccounts | null> {
    const r = await this.client.get<Envelope<UserSubaccounts | null>>(this.userPath(address, '/subaccounts'));
    return r.data ?? null;
  }

  /** The primary account ID, or null when the address has never been activated. */
  async primaryAccountID(address: string): Promise<number | null> {
    const s = await this.subaccounts(address);
    return s && s.primaryAccountID > 0 ? s.primaryAccountID : null;
  }

  async apiKeys(address: string, accountID?: number) {
    const r = await this.client.get<Envelope<unknown[]>>(this.userPath(address, '/api-keys'), { accountID });
    return r.data ?? [];
  }

  async builders(address: string): Promise<UserBuilders> {
    const r = await this.client.get<Envelope<Partial<UserBuilders> | null>>(this.userPath(address, '/builders'));
    return { spot: r.data?.spot ?? [], perps: r.data?.perps ?? [] };
  }

  /**
   * The user's approved rate for one builder, per engine. The approval is only
   * usable when both engines agree, so callers should treat any mismatch as
   * "not approved yet" and re-query before retrying.
   */
  async approvalFor(address: string, builderID: number | bigint) {
    const b = await this.builders(address);
    const id = Number(builderID);
    const spot = b.spot.find((x) => x.builderID === id)?.feeRate ?? 0;
    const perps = b.perps.find((x) => x.builderID === id)?.feeRate ?? 0;
    return { spot, perps, approvedBothEngines: spot > 0 && perps > 0 };
  }

  async builderSummary(ownerAddress: string, accountID?: number): Promise<BuilderFeeStats | null> {
    const r = await this.client.get<Envelope<BuilderFeeStats | null>>(
      this.userPath(ownerAddress, '/builder/summary'),
      { accountID },
    );
    return r.data ?? null;
  }

  async builderDailyChart(ownerAddress: string, params?: { accountID?: number; limit?: number }) {
    const r = await this.client.get<Envelope<unknown[]>>(this.userPath(ownerAddress, '/builder/daily-chart'), params);
    return r.data ?? [];
  }

  /**
   * Approve (or with maxFeeRate 0, clear) a builder fee on both engines.
   * `sign` receives the EIP-712 request and returns the wallet's signature.
   */
  async approveBuilderFee(
    userAddress: string,
    input: ApproveBuilderFeeInput,
    sign: WalletSigner,
  ): Promise<Envelope<null>> {
    const { request, nonce, body } = approveBuilderFeeTypedData(input);
    const signature = await sign(request);
    return this.client.postWithHeaders<Envelope<null>>(
      this.userPath(userAddress, '/builders'),
      body,
      universalHeaders(input.network, signature, nonce, input.domainChainId),
    );
  }

  /** Register a trading key on both engines, optionally approving a builder in the same signature. */
  async addApiKey(
    userAddress: string,
    input: AddApiKeyInput,
    sign: (request: ReturnType<typeof addApiKeyTypedData>['request']) => Promise<Hex>,
  ): Promise<Envelope<null>> {
    const { request, nonce, body } = addApiKeyTypedData(input);
    const signature = await sign(request);
    return this.client.postWithHeaders<Envelope<null>>(
      this.userPath(userAddress, '/api-keys'),
      body,
      universalHeaders(input.network, signature, nonce, input.domainChainId),
    );
  }
}
