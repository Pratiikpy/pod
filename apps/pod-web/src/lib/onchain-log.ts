import {
  createWalletClient,
  createPublicClient,
  defineChain,
  http,
  keccak256,
  toHex,
  parseEventLogs,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/**
 * On-chain reasoning log. Writes a tamper-evident hash of each POD Score's
 * underlying data to the ReasoningLogger contract on the ValueChain testnet,
 * so any score POD quotes can be verified later by recomputing the hash and
 * comparing it to the immutable on-chain entry.
 *
 * The deployer wallet holds the LOGGER role and native gas. Failures are
 * swallowed (returns null) so a logging hiccup never breaks score generation.
 */

const CHAIN_ID = Number(process.env['SODEX_TESTNET_CHAIN_ID'] ?? 138565);
const RPC_URL = process.env['VALUECHAIN_TESTNET_RPC'] ?? 'https://testnet-rpc.valuechain.xyz';
const LOGGER_ADDRESS = (process.env['REASONING_LOGGER_ADDRESS'] ??
  '0x0723dc7D775864ec08797e84d2A5E068876B221B') as Hex;
const ZERO = '0x0000000000000000000000000000000000000000' as Hex;

export const valueChainTestnet = defineChain({
  id: CHAIN_ID,
  name: 'ValueChain Testnet',
  nativeCurrency: { name: 'SOSO', symbol: 'SOSO', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

const LOGGER_ABI = [
  {
    type: 'function',
    name: 'logReasoning',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'vault', type: 'address' },
      { name: 'reasoningHash', type: 'bytes32' },
      { name: 'ipfsCid', type: 'string' },
      { name: 'compositeZ', type: 'int256' },
      { name: 'podScore', type: 'uint256' },
      { name: 'sourceCitations', type: 'bytes32[]' },
    ],
    outputs: [{ name: 'id', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'totalEntries',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'ReasoningLogged',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'vault', type: 'address', indexed: true },
      { name: 'actor', type: 'address', indexed: true },
      { name: 'reasoningHash', type: 'bytes32', indexed: false },
      { name: 'compositeZ', type: 'int256', indexed: false },
      { name: 'podScore', type: 'uint256', indexed: false },
      { name: 'ipfsCid', type: 'string', indexed: false },
    ],
  },
] as const;

export interface ScoreForLog {
  asset: string;
  podScore: number;
  compositeZ: number;
  generatedAt: string;
  contributions: Array<{ source: string; weight: number; zScore: number }>;
}

/** Canonical, stable JSON of the score payload — the pre-image of the hash. */
export function canonicalScorePayload(s: ScoreForLog): string {
  const sources = s.contributions
    .filter((c) => c.weight > 0)
    .map((c) => ({ source: c.source, weight: c.weight, z: Number(c.zScore.toFixed(4)) }))
    .sort((a, b) => a.source.localeCompare(b.source));
  return JSON.stringify({
    asset: s.asset,
    podScore: s.podScore,
    compositeZ: Number(s.compositeZ.toFixed(6)),
    generatedAt: s.generatedAt,
    sources,
  });
}

export function reasoningHashOf(s: ScoreForLog): Hex {
  return keccak256(toHex(canonicalScorePayload(s)));
}

export interface OnChainLogResult {
  txHash: Hex;
  entryId: number;
  reasoningHash: Hex;
  explorerUrl: string;
}

function loggerKey(): Hex | null {
  const k = process.env['DEPLOYER_PRIVATE_KEY'] ?? process.env['SODEX_PRIVATE_KEY'];
  return k ? (k as Hex) : null;
}

/** Write one score's reasoning hash on-chain. Returns null if not configured or on error. */
export async function logScoreOnChain(s: ScoreForLog): Promise<OnChainLogResult | null> {
  const pk = loggerKey();
  if (!pk) return null;

  try {
    const account = privateKeyToAccount(pk);
    const wallet = createWalletClient({ account, chain: valueChainTestnet, transport: http(RPC_URL) });
    const pub = createPublicClient({ chain: valueChainTestnet, transport: http(RPC_URL) });

    const reasoningHash = reasoningHashOf(s);
    const compositeZScaled = BigInt(Math.round(s.compositeZ * 1e6));
    const citations = s.contributions
      .filter((c) => c.weight > 0)
      .map((c) => keccak256(toHex(c.source)));

    const txHash = await wallet.writeContract({
      address: LOGGER_ADDRESS,
      abi: LOGGER_ABI,
      functionName: 'logReasoning',
      args: [ZERO, reasoningHash, '', compositeZScaled, BigInt(s.podScore), citations],
    });
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash });

    // Authoritative entry id comes from the emitted event, not a pre-read
    // (which lags behind on the read node between sequential writes).
    let entryId = -1;
    const logs = parseEventLogs({ abi: LOGGER_ABI, eventName: 'ReasoningLogged', logs: receipt.logs });
    const ev = logs[0] as { args?: { id?: bigint } } | undefined;
    if (ev?.args?.id !== undefined) entryId = Number(ev.args.id);

    return {
      txHash,
      entryId,
      reasoningHash,
      explorerUrl: `https://test-scan.valuechain.xyz/tx/${txHash}`,
    };
  } catch (err) {
    console.error('[onchain-log] logReasoning failed:', err);
    return null;
  }
}
