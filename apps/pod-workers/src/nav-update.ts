import { createPublicClient, createWalletClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { loadWorkerConfig } from './config.js';

/**
 * Pushes the latest NAV for each PodVault into the DrawdownGuard.
 * If the guard trips, the PodVault.applyRebalance() flow will revert
 * on the next attempt and the vault must rotate to defensive via SoDEX
 * (handled by the rebalancer worker, not here).
 *
 * Designed to run every ~5 minutes via Vercel Cron.
 */

const DRAWDOWN_GUARD_ABI = [
  {
    type: 'function',
    name: 'updateNav',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'vault', type: 'address' },
      { name: 'newNav', type: 'uint256' },
    ],
    outputs: [{ name: 'tripped', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'isTripped',
    stateMutability: 'view',
    inputs: [{ name: 'vault', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
] as const;

const POD_VAULT_ABI = [
  {
    type: 'function',
    name: 'lastNav',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'totalSupply',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const;

export interface NavUpdateRunResult {
  generatedAt: string;
  vaults: Array<{ vault: Address; previousNav: bigint; newNav: bigint; tripped: boolean }>;
  errors: Array<{ vault: Address; error: string }>;
}

export async function runNavUpdate(rpcUrl: string): Promise<NavUpdateRunResult> {
  const cfg = loadWorkerConfig();
  if (!cfg.SODEX_REBALANCER_PRIVATE_KEY) {
    throw new Error('SODEX_REBALANCER_PRIVATE_KEY required to push NAV updates');
  }
  if (!cfg.DRAWDOWN_GUARD_ADDRESS) {
    throw new Error('DRAWDOWN_GUARD_ADDRESS required');
  }
  if (!cfg.POD_VAULT_ADDRESSES) {
    return { generatedAt: new Date().toISOString(), vaults: [], errors: [] };
  }

  const account = privateKeyToAccount(cfg.SODEX_REBALANCER_PRIVATE_KEY as Hex);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ transport });
  const walletClient = createWalletClient({ account, transport });

  const guardAddr = cfg.DRAWDOWN_GUARD_ADDRESS as Address;
  const vaults = cfg.POD_VAULT_ADDRESSES.split(',').map((s) => s.trim() as Address);

  const result: NavUpdateRunResult = {
    generatedAt: new Date().toISOString(),
    vaults: [],
    errors: [],
  };

  for (const vault of vaults) {
    try {
      const previousNav = await publicClient.readContract({
        address: vault,
        abi: POD_VAULT_ABI,
        functionName: 'lastNav',
      });

      // For Wave 1 we trust the vault's lastNav as the live mark — in production
      // we'd compute live NAV from basket holdings + market prices.
      const newNav = previousNav;

      const txHash = await walletClient.writeContract({
        address: guardAddr,
        abi: DRAWDOWN_GUARD_ABI,
        functionName: 'updateNav',
        args: [vault, newNav],
        chain: null,
      });

      // Wait for receipt to read the trip status.
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      const tripped = await publicClient.readContract({
        address: guardAddr,
        abi: DRAWDOWN_GUARD_ABI,
        functionName: 'isTripped',
        args: [vault],
      });

      result.vaults.push({ vault, previousNav, newNav, tripped });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ vault, error: msg });
      console.error(`[nav-update] ${vault} failed:`, msg);
    }
  }

  return result;
}
