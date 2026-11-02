/**
 * The gateway answers a batch with an outer `code: 0` even when an order inside it
 * was refused (for example "open interest cap reached"). Callers that only look at
 * the outer code report success for orders that never existed.
 */
export interface OrderItemResult {
  code: number;
  clOrdID?: string;
  orderID?: number;
  error?: string;
}

export function orderItems(response: unknown): OrderItemResult[] {
  const data = (response as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as OrderItemResult[]) : [];
}

/** Throws unless the outer envelope AND every order inside it succeeded. */
export function assertOrdersAccepted(response: unknown): OrderItemResult[] {
  const outer = (response as { code?: number; error?: string } | null) ?? {};
  if (outer.code !== 0) throw new Error(`order batch rejected (code ${outer.code}): ${outer.error ?? 'no detail'}`);
  const items = orderItems(response);
  if (items.length === 0) throw new Error('order batch returned no per-order results');
  const bad = items.filter((i) => i.code !== 0);
  if (bad.length) {
    throw new Error(`order refused: ${bad.map((i) => `${i.clOrdID ?? '?'}: ${i.error ?? `code ${i.code}`}`).join('; ')}`);
  }
  return items;
}
