import { describe, it, expect } from 'vitest';
import { canonicalDecimal } from './decimal.js';

describe('canonicalDecimal', () => {
  // The six rows of the documented table.
  it.each([
    ['00123', '123'],
    ['+32.1', '32.1'],
    ['32.100', '32.1'],
    ['0.500', '0.5'],
    ['1.234e+2', '123.4'],
    ['001.230', '1.23'],
  ])('%s -> %s (documented example)', (input, want) => {
    expect(canonicalDecimal(input)).toBe(want);
  });

  it('fixes the real gateway rejection: 0.00020 -> 0.0002', () => {
    expect(canonicalDecimal('0.00020')).toBe('0.0002');
  });

  it('handles zero, negatives and whole numbers', () => {
    expect(canonicalDecimal('0')).toBe('0');
    expect(canonicalDecimal('0.000')).toBe('0');
    expect(canonicalDecimal('-0')).toBe('0');
    expect(canonicalDecimal('-1.50')).toBe('-1.5');
    expect(canonicalDecimal('10')).toBe('10');
    expect(canonicalDecimal('10.0')).toBe('10');
    expect(canonicalDecimal('.5')).toBe('0.5');
    expect(canonicalDecimal('5.')).toBe('5');
  });

  it('expands exponents in both directions', () => {
    expect(canonicalDecimal('1e3')).toBe('1000');
    expect(canonicalDecimal('1.5e-3')).toBe('0.0015');
    expect(canonicalDecimal('25E-1')).toBe('2.5');
    expect(canonicalDecimal('1e-7')).toBe('0.0000001');
  });

  it('accepts JS numbers, including ones JS prints in exponent form', () => {
    expect(canonicalDecimal(0.0002)).toBe('0.0002');
    expect(canonicalDecimal(1e-7)).toBe('0.0000001');
    expect(canonicalDecimal(1e21)).toBe('1000000000000000000000');
    expect(canonicalDecimal(12.5)).toBe('12.5');
  });

  it('is idempotent', () => {
    for (const s of ['123.4', '0.0002', '0', '-1.5', '1000']) expect(canonicalDecimal(canonicalDecimal(s))).toBe(s);
  });

  it('rejects things that are not numbers', () => {
    for (const bad of ['', 'abc', '1.2.3', '--1', '1e', 'NaN', 'Infinity', '.']) {
      expect(() => canonicalDecimal(bad), bad).toThrow(RangeError);
    }
    expect(() => canonicalDecimal(Number.NaN)).toThrow(RangeError);
    expect(() => canonicalDecimal(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
