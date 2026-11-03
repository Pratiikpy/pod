/**
 * Confirming what happened to an order after the gateway accepted it.
 *
 * Live mainnet testing found the user-trades endpoint returning an empty list for
 * orders that had plainly filled (balances and positions had moved), so a single
 * poll of that endpoint is not a reliable verdict. This routine reads up to three
 * independent sources and only reports a failure when the order's own record says
 * the order did not execute:
 *
 *   1. trades filtered by order id      -> the fills, with price, fee and builder fee
 *   2. the order record (open, history) -> status and executed quantity
 *   3. a balance or position change     -> proof that something executed
 *
 * If none of them can settle the question it answers "unknown". It never answers
 * "not filled" from silence.
 */

export interface FillRow {
  tradeID?: number;
  orderID?: number;
  clOrdID?: string;
  side?: string;
  price: string;
  quantity: string;
  fee?: string;
  builderFee?: string;
  feeCoin?: string;
}

export interface OrderRecord {
  orderID?: number;
  clOrdID?: string;
  /** NEW, PARTIALLY_FILLED, FILLED, CANCELED, REJECTED, EXPIRED, TRIGGERED. */
  status: string;
  executedQty?: string;
  executedValue?: string;
  origQty?: string;
}

export type Confirmation =
  | {
      state: 'filled';
      /** Where the proof came from, so the page can be honest about missing detail. */
      source: 'trades' | 'order' | 'balance';
      fills: FillRow[];
      executedQty?: string;
      /** Average price from the order record (executedValue / executedQty), when known. */
      avgPrice?: string;
      /**
       * True only while the engine still reports PARTIALLY_FILLED. A market order's unused
       * remainder is cancelled by design (status CANCELED with a non-zero executedQty), and
       * that is a complete fill of what the market could give, not a partial one.
       */
      partial?: boolean;
    }
  | { state: 'not_filled'; status: string; reason: string }
  | { state: 'resting'; status: string }
  | { state: 'unknown'; detail: string };

export interface ConfirmDeps {
  /** Fills for this order, matched by order id. May legitimately be empty while the indexer catches up. */
  trades(): Promise<FillRow[]>;
  /** The order's record from open orders or history. */
  order(): Promise<OrderRecord | undefined>;
  /** True once the account's balance or position has moved the way this order would move it. */
  balanceMoved?(): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export interface ConfirmOptions {
  timeoutMs?: number;
  intervalMs?: number;
  /** Called after each round with a short status line for the page. */
  onProgress?: (line: string) => void;
}

const TERMINAL_NO_EXEC = new Set(['CANCELED', 'REJECTED', 'EXPIRED']);

const num = (v: string | undefined) => (v === undefined || v === '' ? 0 : Number(v));

/** A read that fails is the same as a read that says nothing: never a verdict. */
async function quietly<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch {
    return undefined;
  }
}

function avgPrice(rec: OrderRecord | undefined): string | undefined {
  const qty = num(rec?.executedQty);
  const val = num(rec?.executedValue);
  return qty > 0 && val > 0 ? String(val / qty) : undefined;
}

export async function confirmOrder(deps: ConfirmDeps, options: ConfirmOptions = {}): Promise<Confirmation> {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const intervalMs = options.intervalMs ?? 1_500;
  const deadline = deps.now() + timeoutMs;

  let lastRecord: OrderRecord | undefined;
  let balanceMoved = false;
  let recordSaidFilledAt: number | null = null;

  for (let round = 0; ; round++) {
    const fills = (await quietly(() => deps.trades())) ?? [];
    if (fills.length > 0) {
      const rec = lastRecord ?? (await quietly(() => deps.order()));
      const partial = rec?.status === 'PARTIALLY_FILLED';
      return { state: 'filled', source: 'trades', fills, ...(rec?.executedQty ? { executedQty: rec.executedQty } : {}), ...(avgPrice(rec) ? { avgPrice: avgPrice(rec)! } : {}), ...(partial ? { partial } : {}) };
    }

    const rec = await quietly(() => deps.order());
    if (rec) {
      lastRecord = rec;
      const executed = num(rec.executedQty) > 0;
      if (executed || rec.status === 'FILLED' || rec.status === 'PARTIALLY_FILLED') {
        // The order record proves the fill. Give the trades endpoint a short chance to add the fee detail.
        recordSaidFilledAt ??= deps.now();
        if (deps.now() - recordSaidFilledAt >= Math.min(6_000, timeoutMs)) {
          const partial = rec.status === 'PARTIALLY_FILLED';
          return { state: 'filled', source: 'order', fills: [], ...(rec.executedQty ? { executedQty: rec.executedQty } : {}), ...(avgPrice(rec) ? { avgPrice: avgPrice(rec)! } : {}), ...(partial ? { partial } : {}) };
        }
      } else if (TERMINAL_NO_EXEC.has(rec.status)) {
        return {
          state: 'not_filled',
          status: rec.status,
          reason:
            rec.status === 'REJECTED'
              ? 'SoDEX rejected the order, so nothing was bought or sold.'
              : 'The market order found no liquidity at an acceptable price, so nothing was bought or sold.',
        };
      }
    }

    if (deps.balanceMoved && !balanceMoved) balanceMoved = (await quietly(() => deps.balanceMoved!())) ?? false;

    options.onProgress?.(
      rec ? `Order ${rec.status.toLowerCase().replace('_', ' ')}, waiting for the fill details…` : 'Submitted, confirming with SoDEX…',
    );

    if (deps.now() + intervalMs > deadline) break;
    await deps.sleep(intervalMs);
  }

  // Out of time. Use the strongest proof collected, in order.
  if (lastRecord && (num(lastRecord.executedQty) > 0 || lastRecord.status === 'FILLED' || lastRecord.status === 'PARTIALLY_FILLED')) {
    return { state: 'filled', source: 'order', fills: [], ...(lastRecord.executedQty ? { executedQty: lastRecord.executedQty } : {}), ...(avgPrice(lastRecord) ? { avgPrice: avgPrice(lastRecord)! } : {}), ...(lastRecord.status === 'PARTIALLY_FILLED' ? { partial: true } : {}) };
  }
  if (balanceMoved) return { state: 'filled', source: 'balance', fills: [] };
  if (lastRecord?.status === 'NEW') return { state: 'resting', status: lastRecord.status };
  return {
    state: 'unknown',
    detail: 'SoDEX accepted the order but has not reported what happened to it yet. Your balances are the source of truth. Do not send it again until you have checked them.',
  };
}
