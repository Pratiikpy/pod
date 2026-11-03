import { describe, it, expect } from 'vitest';
import {
  ceilToStep,
  checkSize,
  floorToStep,
  minimumOrder,
  notionalOf,
  quantityForNotional,
  quoteBuilderFee,
  buySellability,
  sellability,
  type MarketRules,
} from './market.js';

// Rules copied from the live mainnet BTC/USDC spot market and the testnet ADA-USD perps market.
const BTC_SPOT: MarketRules = { stepSize: '0.00001', minQuantity: '0.00001', maxQuantity: '0', minNotional: '5', maxNotional: '0', quantityPrecision: 5 };
const ADA_PERP: MarketRules = { stepSize: '0.1', minQuantity: '0.1', maxQuantity: '10000000', minNotional: '10', maxNotional: '1000000', quantityPrecision: 1 };

describe('floorToStep / ceilToStep', () => {
  it('rounds to a multiple of the step without float drift', () => {
    expect(floorToStep('0.00019', '0.00001')).toBe('0.00019');
    expect(floorToStep('0.000199', '0.00001')).toBe('0.00019');
    expect(ceilToStep('0.000191', '0.00001')).toBe('0.0002');
    expect(floorToStep('0.30000000000000004', '0.1')).toBe('0.3');
    expect(floorToStep(0.3, '0.1')).toBe('0.3');
    expect(floorToStep('7', '1')).toBe('7');
    expect(floorToStep('7.9', '1')).toBe('7');
  });
  it('returns canonical decimals (the gateway rejects 0.00020)', () => {
    expect(ceilToStep('0.00015', '0.00005')).toBe('0.00015');
    expect(ceilToStep('0.000151', '0.00005')).toBe('0.0002');
  });
  it('rejects a non-positive step', () => {
    expect(() => floorToStep('1', '0')).toThrow(RangeError);
  });
});

describe('notionalOf', () => {
  it('multiplies exactly', () => {
    expect(notionalOf('78570', '0.00007')).toBe('5.4999');
    expect(notionalOf('0.1', '0.2')).toBe('0.02');
  });
});

describe('quantityForNotional', () => {
  it('sizes a $6 BTC spot buy and never exceeds the amount asked for', () => {
    const r = quantityForNotional({ notional: 6, price: 78570, rules: BTC_SPOT });
    expect(r).toEqual({ ok: true, quantity: '0.00007', notional: '5.4999' });
    if (r.ok) expect(Number(r.notional)).toBeLessThanOrEqual(6);
  });
  it('refuses an amount below the market minimum notional', () => {
    const r = quantityForNotional({ notional: 3, price: 78570, rules: BTC_SPOT });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/below the minimum 5/);
  });
  it('explains a request smaller than one step', () => {
    const r = quantityForNotional({ notional: 0.5, price: 78570, rules: BTC_SPOT });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/smallest step|below the minimum/);
  });
  it('respects a coarse step (perps ADA, step 0.1, min notional 10)', () => {
    const r = quantityForNotional({ notional: 12, price: 0.2, rules: ADA_PERP });
    expect(r).toEqual({ ok: true, quantity: '60', notional: '12' });
  });
  it('enforces the maximum notional', () => {
    expect(quantityForNotional({ notional: 2_000_000, price: 1, rules: ADA_PERP }).ok).toBe(false);
  });
  it('fails clearly with no price, zero or negative amounts', () => {
    expect(quantityForNotional({ notional: 10, price: 0, rules: BTC_SPOT }).ok).toBe(false);
    expect(quantityForNotional({ notional: 0, price: 100, rules: BTC_SPOT }).ok).toBe(false);
    expect(quantityForNotional({ notional: -5, price: 100, rules: BTC_SPOT }).ok).toBe(false);
  });
});

describe('minimumOrder', () => {
  it('finds the smallest valid BTC order and it really clears the minimum notional', () => {
    const m = minimumOrder(78377, BTC_SPOT)!;
    expect(m.quantity).toBe('0.00007');
    expect(Number(m.notional)).toBeGreaterThanOrEqual(5);
    // One step smaller must NOT clear it, or this is not the minimum.
    expect(Number(notionalOf(78377, '0.00006'))).toBeLessThan(5);
  });
  it('honours a minimum quantity larger than the notional alone requires', () => {
    const rules: MarketRules = { stepSize: '1', minQuantity: '10', maxQuantity: '0', minNotional: '5', maxNotional: '0', quantityPrecision: 0 };
    expect(minimumOrder(0.01, rules)!.quantity).toBe('500');
    expect(minimumOrder(100, rules)!.quantity).toBe('10');
  });
  it('returns null without a price', () => {
    expect(minimumOrder(0, BTC_SPOT)).toBeNull();
  });
  it('the refusal message tells the trader the smallest order', () => {
    const r = quantityForNotional({ notional: 5, price: 78377, rules: BTC_SPOT });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/smallest order right now is about \$5\.\d\d/);
  });
});

describe('sellability (the stranded-holding bug found on live mainnet)', () => {
  it('reproduces it: a minimum BTC buy leaves 0.0000699545, which cannot be sold at 78,100', () => {
    const r = sellability({ holding: '0.0000699545', price: 78100, rules: BTC_SPOT });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.maxSellable).toBe('0.00006');
      expect(r.smallest?.quantity).toBe('0.00007');
      expect(r.reason).toMatch(/hold 0\.0000699545/);
      expect(r.reason).toMatch(/smallest sell right now is 0\.00007/);
    }
  });
  it('a holding below one step can never be sold, in whole or in part', () => {
    const r = sellability({ holding: '0.0000099', price: 78100, rules: BTC_SPOT });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/less than one step \(0\.00001\)/);
  });
  it('a holding that clears the minimum is sellable and capped at a whole step', () => {
    const r = sellability({ holding: '0.00012345', price: 78100, rules: BTC_SPOT });
    expect(r).toEqual({ ok: true, maxQuantity: '0.00012', notional: '9.372' });
  });
  it('works on another market (SOSO-like: step 0.01, min notional 1)', () => {
    const SOSO: MarketRules = { stepSize: '0.01', minQuantity: '0.01', maxQuantity: '0', minNotional: '1', maxNotional: '0', quantityPrecision: 2 };
    expect(sellability({ holding: '4.6', price: 0.25, rules: SOSO }).ok).toBe(true);
    expect(sellability({ holding: '3.99', price: 0.25, rules: SOSO }).ok).toBe(false);
  });
});

describe('buySellability', () => {
  it('warns that the smallest BTC buy cannot be sold back after the 0.065% fee, and suggests a size that can', () => {
    const r = buySellability({ quantity: '0.00007', takerFee: '0.00065', price: 78100, rules: BTC_SPOT });
    expect(r.sellable).toBe(false);
    if (!r.sellable) {
      expect(r.holdingAfterFee).toBe('0.0000699545');
      expect(r.suggestedQuantity).toBe('0.00008');
      const after = buySellability({ quantity: r.suggestedQuantity!, takerFee: '0.00065', price: 78100, rules: BTC_SPOT });
      expect(after.sellable).toBe(true);
    }
  });
  it('a bigger buy is sellable', () => {
    expect(buySellability({ quantity: '0.0002', takerFee: '0.00065', price: 78100, rules: BTC_SPOT }).sellable).toBe(true);
  });
  it('every suggestion across many prices is itself sellable (property check)', () => {
    for (const price of [20000, 55555, 78100, 99999, 150000]) {
      const min = quantityForNotional({ notional: 5.01, price, rules: BTC_SPOT });
      if (!min.ok) continue;
      const w = buySellability({ quantity: min.quantity, takerFee: '0.00065', price, rules: BTC_SPOT });
      if (w.sellable) continue;
      expect(buySellability({ quantity: w.suggestedQuantity!, takerFee: '0.00065', price, rules: BTC_SPOT }).sellable).toBe(true);
    }
  });
  it('a zero fee changes nothing', () => {
    expect(buySellability({ quantity: '0.00007', takerFee: '0', price: 78100, rules: BTC_SPOT }).sellable).toBe(true);
  });
});

describe('checkSize', () => {
  it('accepts a valid explicit quantity and rejects one below the minimum', () => {
    expect(checkSize('0.0002', 78500, BTC_SPOT).ok).toBe(true);
    expect(checkSize('0.000001', 78500, BTC_SPOT).ok).toBe(false);
  });
});

describe('quoteBuilderFee (matches the live testnet fills)', () => {
  it('spot BUY carries no fee', () => {
    const q = quoteBuilderFee({ engine: 'spot', side: 'BUY', notional: 100, requestedFee: 100, approvedFee: 100 });
    expect(q.fee).toBe(0);
    expect(q.note).toMatch(/Spot buys carry no builder fee/);
  });
  it('spot SELL charges the requested rate when approved (10 bp of 5.4999)', () => {
    const q = quoteBuilderFee({ engine: 'spot', side: 'SELL', notional: 5.4999, requestedFee: 100, approvedFee: 100 });
    expect(q.rateBp).toBe(10);
    expect(q.fee).toBeCloseTo(0.0054999, 6);
  });
  it('is reduced to the user approval, as the gateway did (approved 50, requested 100 -> 5 bp)', () => {
    const q = quoteBuilderFee({ engine: 'spot', side: 'SELL', notional: 5.4999, requestedFee: 100, approvedFee: 50 });
    expect(q.rateBp).toBe(5);
    expect(q.note).toMatch(/Capped at 5 bp/);
  });
  it('is zero with no approval', () => {
    const q = quoteBuilderFee({ engine: 'spot', side: 'SELL', notional: 100, requestedFee: 100, approvedFee: 0 });
    expect(q.fee).toBe(0);
    expect(q.note).toMatch(/No builder fee is approved/);
  });
  it('perps charge both sides and are capped at 0.2%', () => {
    for (const side of ['BUY', 'SELL'] as const) {
      const q = quoteBuilderFee({ engine: 'perps', side, notional: 1000, requestedFee: 50, approvedFee: 100 });
      expect(q.rateBp).toBe(5);
      expect(q.fee).toBeCloseTo(0.5, 9);
    }
    const capped = quoteBuilderFee({ engine: 'perps', side: 'BUY', notional: 1000, requestedFee: 500, approvedFee: 2000 });
    expect(capped.rateBp).toBe(20);
  });
});
