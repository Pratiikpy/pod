import { canonicalDecimal } from './decimal.js';
import { BUILDER_FEE_CAP, type BuilderEngine } from './builder.js';

/**
 * Order sizing that respects each market's own rules. Float arithmetic is avoided
 * on purpose: 0.1 + 0.2 style errors turn into "quantity is invalid" at the gateway,
 * and the signature hashes the exact decimal text.
 */

export interface MarketRules {
  /** Smallest quantity increment, e.g. "0.00001". */
  stepSize: string;
  /** Smallest order quantity. */
  minQuantity: string;
  /** Largest order quantity; "0" means no limit. */
  maxQuantity?: string;
  /** Smallest notional (price * quantity) in the quote coin. */
  minNotional: string;
  /** Largest notional; "0" means no limit. */
  maxNotional?: string;
  quantityPrecision: number;
}

const SCALE = 18;
const TEN = 10n;
const ONE = TEN ** BigInt(SCALE);

/** Decimal string -> integer scaled by 10^18. */
function toScaled(value: string): bigint {
  const c = canonicalDecimal(value);
  const neg = c.startsWith('-');
  const [i = '0', f = ''] = (neg ? c.slice(1) : c).split('.');
  if (f.length > SCALE) throw new RangeError(`${value} has more than ${SCALE} decimal places`);
  const n = BigInt(i) * ONE + BigInt(f.padEnd(SCALE, '0'));
  return neg ? -n : n;
}

function fromScaled(n: bigint): string {
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const i = abs / ONE;
  const f = (abs % ONE).toString().padStart(SCALE, '0');
  return canonicalDecimal(`${neg ? '-' : ''}${i}.${f}`);
}

/** Largest multiple of `step` that is <= value. */
export function floorToStep(value: string | number, step: string): string {
  const v = toScaled(String(value));
  const s = toScaled(step);
  if (s <= 0n) throw new RangeError('step must be positive');
  return fromScaled((v / s) * s);
}

/** Smallest multiple of `step` that is >= value. */
export function ceilToStep(value: string | number, step: string): string {
  const v = toScaled(String(value));
  const s = toScaled(step);
  if (s <= 0n) throw new RangeError('step must be positive');
  return fromScaled(((v + s - 1n) / s) * s);
}

/** price * quantity as an exact decimal string. */
export function notionalOf(price: string | number, quantity: string | number): string {
  const p = toScaled(String(price));
  const q = toScaled(String(quantity));
  return fromScaled((p * q) / ONE);
}

export type SizeResult =
  | { ok: true; quantity: string; notional: string }
  | { ok: false; reason: string };

/**
 * Quantity for a target notional, rounded DOWN to the step so a user is never
 * charged more than they asked for, then checked against the market's limits.
 */
export function quantityForNotional(input: {
  notional: string | number;
  price: string | number;
  rules: MarketRules;
}): SizeResult {
  const { rules } = input;
  const price = toScaled(String(input.price));
  if (price <= 0n) return { ok: false, reason: 'no price available for this market right now' };
  const target = toScaled(String(input.notional));
  if (target <= 0n) return { ok: false, reason: 'enter an amount above zero' };
  const rawQty = fromScaled((target * ONE) / price);
  const quantity = floorToStep(rawQty, rules.stepSize);
  return checkSize(quantity, input.price, rules, input.notional);
}

/**
 * The smallest order SoDEX will accept at this price: the least quantity that is
 * a whole number of steps, at least the minimum quantity, and worth at least the
 * minimum notional.
 */
export function minimumOrder(price: string | number, rules: MarketRules): { quantity: string; notional: string } | null {
  const p = toScaled(String(price));
  if (p <= 0n) return null;
  const forNotional = fromScaled((toScaled(rules.minNotional) * ONE) / p);
  let quantity = ceilToStep(forNotional, rules.stepSize);
  if (toScaled(quantity) < toScaled(rules.minQuantity)) quantity = ceilToStep(rules.minQuantity, rules.stepSize);
  // Integer division above can land one step short of the minimum notional.
  while (toScaled(notionalOf(price, quantity)) < toScaled(rules.minNotional)) {
    quantity = fromScaled(toScaled(quantity) + toScaled(rules.stepSize));
  }
  return { quantity, notional: notionalOf(price, quantity) };
}

/** Validates an explicit quantity against the market's limits. */
export function checkSize(
  quantity: string,
  price: string | number,
  rules: MarketRules,
  requested?: string | number,
): SizeResult {
  const q = toScaled(quantity);
  if (q <= 0n) {
    return {
      ok: false,
      reason:
        requested !== undefined
          ? `${requested} buys less than the smallest step ${rules.stepSize}`
          : 'quantity must be above zero',
    };
  }
  if (q < toScaled(rules.minQuantity)) return { ok: false, reason: `below the minimum quantity ${rules.minQuantity}` };
  const maxQ = rules.maxQuantity ? toScaled(rules.maxQuantity) : 0n;
  if (maxQ > 0n && q > maxQ) return { ok: false, reason: `above the maximum quantity ${rules.maxQuantity}` };
  const notional = notionalOf(price, quantity);
  if (toScaled(notional) < toScaled(rules.minNotional)) {
    const min = minimumOrder(price, rules);
    const hint = min ? ` The smallest order right now is about $${Number(min.notional).toFixed(2)} (${min.quantity}).` : '';
    return { ok: false, reason: `order value ${notional} is below the minimum ${rules.minNotional}.${hint}` };
  }
  const maxN = rules.maxNotional ? toScaled(rules.maxNotional) : 0n;
  if (maxN > 0n && toScaled(notional) > maxN) {
    return { ok: false, reason: `order value is above the maximum ${rules.maxNotional}` };
  }
  return { ok: true, quantity, notional };
}

export interface FeeQuote {
  /** Builder fee in the quote coin; 0 when none applies. */
  fee: number;
  /** Rate actually applied, in basis points. */
  rateBp: number;
  /** Plain-language reason shown next to a zero or reduced fee. */
  note?: string;
}

/**
 * What the gateway will charge, as confirmed by live fills:
 * min(requested, user-approved, engine cap) of notional, perps on both sides,
 * spot on the SELL side only.
 */
export function quoteBuilderFee(input: {
  engine: BuilderEngine;
  side: 'BUY' | 'SELL';
  notional: number;
  requestedFee: number;
  approvedFee: number;
}): FeeQuote {
  if (input.engine === 'spot' && input.side === 'BUY') {
    return { fee: 0, rateBp: 0, note: 'Spot buys carry no builder fee. The fee applies when you sell.' };
  }
  const rate = Math.min(input.requestedFee, input.approvedFee, BUILDER_FEE_CAP[input.engine]);
  if (rate <= 0) return { fee: 0, rateBp: 0, note: 'No builder fee is approved yet.' };
  const reduced = rate < input.requestedFee;
  return {
    fee: (input.notional * rate) / 100_000,
    rateBp: rate / 10,
    ...(reduced ? { note: `Capped at ${rate / 10} bp by your approval or the ${input.engine} limit.` } : {}),
  };
}

export type SellCheck =
  | { ok: true; maxQuantity: string; notional: string }
  | {
      ok: false;
      holding: string;
      /** The most that could be sold: the holding rounded down to a whole step. */
      maxSellable: string;
      /** The smallest sell this market accepts at this price, when a price is known. */
      smallest: { quantity: string; notional: string } | null;
      reason: string;
    };

/**
 * Whether a holding can be sold at all. A sell must be a whole number of steps, at least
 * the minimum quantity and worth at least the minimum notional, so a holding just below
 * the smallest valid sell is stuck: it cannot be sold in whole or in part.
 */
export function sellability(input: { holding: string; price: string | number; rules: MarketRules }): SellCheck {
  const { rules } = input;
  const holding = canonicalDecimal(input.holding);
  const maxSellable = floorToStep(holding, rules.stepSize);
  const smallest = minimumOrder(input.price, rules);
  const fail = (reason: string): SellCheck => ({ ok: false, holding, maxSellable, smallest, reason });

  if (toScaled(maxSellable) <= 0n) {
    return fail(`You hold ${holding}, which is less than one step (${rules.stepSize}), so it cannot be sold.`);
  }
  const check = checkSize(maxSellable, input.price, rules);
  if (check.ok) return { ok: true, maxQuantity: check.quantity, notional: check.notional };
  const hint = smallest ? ` The smallest sell right now is ${smallest.quantity} (about $${Number(smallest.notional).toFixed(2)}).` : '';
  return fail(`You hold ${holding} and can sell at most ${maxSellable}.${hint}`);
}

export type BuySellability =
  | { sellable: true; holdingAfterFee: string }
  | {
      sellable: false;
      holdingAfterFee: string;
      reason: string;
      /** A buy size that would leave a sellable holding, with a small cushion for price moves. */
      suggestedQuantity: string | null;
      suggestedNotional: string | null;
    };

/**
 * Spot buy fees are taken from the asset you buy, so buying exactly the smallest sell leaves
 * slightly less than that and the position cannot be closed. Checks that, and suggests a size.
 *
 * `cushion` lowers the assumed future sell price when sizing the suggestion, so a small dip
 * does not strand the position again.
 */
export function buySellability(input: {
  quantity: string;
  /** The market's taker fee as a decimal, e.g. "0.00065". */
  takerFee: string;
  price: string | number;
  rules: MarketRules;
  cushion?: number;
}): BuySellability {
  const { rules } = input;
  const keep = ONE - toScaled(input.takerFee);
  const holdingAfterFee = fromScaled((toScaled(input.quantity) * keep) / ONE);
  const sell = sellability({ holding: holdingAfterFee, price: input.price, rules });
  if (sell.ok) return { sellable: true, holdingAfterFee };

  const cushion = input.cushion ?? 0.02;
  const futurePrice = fromScaled((toScaled(String(input.price)) * (ONE - toScaled(String(cushion)))) / ONE);
  const min = minimumOrder(futurePrice, rules);
  let suggestedQuantity: string | null = null;
  let suggestedNotional: string | null = null;
  if (min && keep > 0n) {
    // Smallest whole-step buy whose after-fee holding still covers the smallest sell.
    let q = ceilToStep(fromScaled((toScaled(min.quantity) * ONE) / keep), rules.stepSize);
    while (toScaled(floorToStep(fromScaled((toScaled(q) * keep) / ONE), rules.stepSize)) < toScaled(min.quantity)) {
      q = fromScaled(toScaled(q) + toScaled(rules.stepSize));
    }
    suggestedQuantity = q;
    suggestedNotional = notionalOf(input.price, q);
  }
  const pct = (Number(input.takerFee) * 100).toFixed(3).replace(/\.?0+$/, '');
  return {
    sellable: false,
    holdingAfterFee,
    reason: `After the ${pct}% buy fee you would hold ${holdingAfterFee}, which is below the smallest sell, so you could not sell it back.`,
    suggestedQuantity,
    suggestedNotional,
  };
}
