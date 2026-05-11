import { SoDEXClient, type SoDEXClientConfig } from './client.js';
import { SpotAPI } from './spot.js';
import { PerpsAPI } from './perps.js';
import { createSigner, type SoDEXSigner } from './signing.js';
import type { LocalAccount } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import type { SoDEXNetwork } from './types.js';
import { NETWORK_CONFIG } from './types.js';

export * from './types.js';
export * from './signing.js';
export { SoDEXClient, SoDEXAPIError } from './client.js';
export { SpotAPI } from './spot.js';
export { PerpsAPI } from './perps.js';

/**
 * High-level SoDEX SDK — unified entry point for spot + perps.
 *
 * @example Testnet with private key (testnet uses wallet privkey directly):
 *   const sdk = SoDEX.fromPrivateKey('0x...', 'testnet');
 *   const state = await sdk.spot.accountState(sdk.client.signerAddress);
 *
 * @example Place a market buy on spot:
 *   await sdk.spot.batchNewOrder({
 *     accountID: 12345n,
 *     orders: [{
 *       symbolID: 1n,
 *       clOrdID: 'pod-' + Date.now(),
 *       side: 'BUY',
 *       type: 'MARKET',
 *       timeInForce: 'IOC',
 *       funds: '5',
 *     }],
 *   });
 */
export class SoDEX {
  readonly client: SoDEXClient;
  readonly spot: SpotAPI;
  readonly perps: PerpsAPI;

  constructor(config: SoDEXClientConfig) {
    this.client = new SoDEXClient(config);
    this.spot = new SpotAPI(this.client);
    this.perps = new PerpsAPI(this.client);
  }

  /** Quick constructor from a hex private key. Optional apiKeyName for X-API-Key header. */
  static fromPrivateKey(privateKey: Hex, network: SoDEXNetwork, apiKeyName?: string): SoDEX {
    const account: LocalAccount = privateKeyToAccount(privateKey);
    const signer = createSigner({
      account,
      chainId: NETWORK_CONFIG[network].chainId,
    });
    return new SoDEX(apiKeyName ? { network, signer, apiKeyName } : { network, signer });
  }

  /** Construct from a viem LocalAccount (e.g., from a Privy embedded wallet). */
  static fromAccount(account: LocalAccount, network: SoDEXNetwork): SoDEX {
    const signer = createSigner({
      account,
      chainId: NETWORK_CONFIG[network].chainId,
    });
    return new SoDEX({ network, signer });
  }

  /** Custom signer (useful for hardware wallets, MPC, etc.). */
  static fromSigner(signer: SoDEXSigner, network: SoDEXNetwork): SoDEX {
    return new SoDEX({ network, signer });
  }

  /** Public-only client — no signing. */
  static publicOnly(network: SoDEXNetwork): SoDEX {
    return new SoDEX({ network });
  }
}
