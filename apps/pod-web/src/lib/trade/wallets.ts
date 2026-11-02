import { createWalletClient, custom, type Address, type EIP1193Provider, type Hex } from 'viem';

/**
 * Browser wallet discovery with EIP-6963, the standard that lets several wallet
 * extensions announce themselves instead of fighting over `window.ethereum`.
 * Falls back to `window.ethereum` for wallets that do not announce.
 */

export interface DiscoveredWallet {
  id: string;
  name: string;
  icon?: string;
  provider: EIP1193Provider;
}

interface Eip6963Detail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: EIP1193Provider;
}

declare global {
  interface Window {
    ethereum?: EIP1193Provider & { isMetaMask?: boolean; isRabby?: boolean };
  }
}

/**
 * Listens for announcements for `waitMs`, then resolves with every wallet found.
 * The returned stop function removes the listener.
 */
export function discoverWallets(onFound: (wallets: DiscoveredWallet[]) => void, waitMs = 400): () => void {
  const found = new Map<string, DiscoveredWallet>();
  const emit = () => onFound([...found.values()]);

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<Eip6963Detail>).detail;
    if (!detail?.info?.uuid || !detail.provider) return;
    found.set(detail.info.uuid, {
      id: detail.info.uuid,
      name: detail.info.name,
      icon: detail.info.icon,
      provider: detail.provider,
    });
    emit();
  };

  window.addEventListener('eip6963:announceProvider', handler);
  window.dispatchEvent(new Event('eip6963:requestProvider'));

  const timer = window.setTimeout(() => {
    if (found.size === 0 && window.ethereum) {
      found.set('window.ethereum', {
        id: 'window.ethereum',
        name: window.ethereum.isRabby ? 'Rabby' : window.ethereum.isMetaMask ? 'MetaMask' : 'Browser wallet',
        provider: window.ethereum,
      });
    }
    emit();
  }, waitMs);

  return () => {
    window.clearTimeout(timer);
    window.removeEventListener('eip6963:announceProvider', handler);
  };
}

export interface ConnectedWallet {
  wallet: DiscoveredWallet;
  address: Address;
  chainId: number;
}

/** Prompts the wallet for an account and reads its active chain. */
export async function connectWallet(wallet: DiscoveredWallet): Promise<ConnectedWallet> {
  const accounts = (await wallet.provider.request({ method: 'eth_requestAccounts' })) as Address[];
  const address = accounts[0];
  if (!address) throw new Error('The wallet did not return an account.');
  const chainId = Number(await wallet.provider.request({ method: 'eth_chainId' }));
  return { wallet, address, chainId };
}

/**
 * A viem wallet client over the injected provider, used only to request
 * `eth_signTypedData_v4` for account-level actions. The wallet never signs orders.
 */
export function walletClientFor(connected: ConnectedWallet) {
  return createWalletClient({
    account: connected.address,
    transport: custom(connected.wallet.provider),
  });
}

/** Signs an EIP-712 request produced by the SDK with the user's wallet. */
export async function signWithWallet(connected: ConnectedWallet, request: unknown): Promise<Hex> {
  const client = walletClientFor(connected);
  const typed = request as Parameters<typeof client.signTypedData>[0];
  return client.signTypedData({ ...typed, account: connected.address });
}

/** True for the wallet rejecting a prompt (EIP-1193 code 4001, or ethers-style ACTION_REJECTED). */
export function isUserRejection(err: unknown): boolean {
  const e = err as { code?: number | string; cause?: { code?: number | string }; message?: string } | null;
  const code = e?.code ?? e?.cause?.code;
  return code === 4001 || code === 'ACTION_REJECTED' || /user (rejected|denied)/i.test(e?.message ?? '');
}
