import { PrivyClient } from '@privy-io/server-auth';

/**
 * Privy embedded wallet adapter.
 *
 * Privy creates a non-custodial EVM wallet for each user keyed by their Telegram
 * identity. The user signs SoDEX EIP712 actions through Privy's signing API,
 * never touching a seed phrase.
 */
export interface CreateWalletResult {
  address: string;
  did: string; // Privy DID — store on the user record
}

export class PrivyWalletAdapter {
  private readonly client: PrivyClient;

  constructor(opts: { appId: string; appSecret: string }) {
    this.client = new PrivyClient(opts.appId, opts.appSecret);
  }

  /**
   * Create or get a Privy user and return the embedded EVM wallet.
   * The Telegram user ID acts as a stable external identifier.
   */
  async getOrCreateWallet(telegramId: number): Promise<CreateWalletResult> {
    const externalId = `telegram:${telegramId}`;

    // Privy lets us upsert a user by external ID.
    const user = await this.client.importUser({
      linkedAccounts: [
        {
          type: 'custom_auth',
          customUserId: externalId,
        },
      ],
      createEthereumWallet: true,
    });

    type WalletAccount = { type: 'wallet'; address: string; chainType: string };
    const isEvmWallet = (acc: { type: string }): acc is WalletAccount =>
      acc.type === 'wallet' &&
      (acc as { chainType?: string }).chainType === 'ethereum' &&
      typeof (acc as { address?: string }).address === 'string';

    const wallet = (user.linkedAccounts as Array<{ type: string }>).find(isEvmWallet);
    if (!wallet) {
      throw new Error('Privy did not return an EVM wallet for user ' + externalId);
    }
    return { address: wallet.address, did: user.id };
  }
}
