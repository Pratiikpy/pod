import { describe, it, expect } from 'vitest';
import { assertOrdersAccepted, orderItems } from './results.js';

describe('assertOrdersAccepted', () => {
  it('passes when every order succeeded', () => {
    const r = { code: 0, data: [{ code: 0, clOrdID: 'a', orderID: 1 }] };
    expect(assertOrdersAccepted(r)).toHaveLength(1);
  });

  it('fails on an inner refusal even though the outer code is 0 (real gateway behaviour)', () => {
    const r = { code: 0, data: [{ code: -1, clOrdID: 'bpo-1', error: 'open interest cap reached' }] };
    expect(() => assertOrdersAccepted(r)).toThrow(/open interest cap reached/);
  });

  it('fails when only some orders in the batch were accepted', () => {
    const r = { code: 0, data: [{ code: 0, clOrdID: 'a' }, { code: -1, clOrdID: 'b', error: 'quantity is invalid' }] };
    expect(() => assertOrdersAccepted(r)).toThrow(/b: quantity is invalid/);
  });

  it('fails on a rejected envelope and on an empty result', () => {
    expect(() => assertOrdersAccepted({ code: -1, error: 'API key not found' })).toThrow(/API key not found/);
    expect(() => assertOrdersAccepted({ code: 0, data: [] })).toThrow(/no per-order results/);
    expect(() => assertOrdersAccepted(null)).toThrow();
  });

  it('orderItems tolerates a missing payload', () => {
    expect(orderItems(undefined)).toEqual([]);
    expect(orderItems({ code: 0 })).toEqual([]);
  });
});
