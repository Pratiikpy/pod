import { describe, it, expect } from 'vitest';
import { mean, variance, stdev, zScore, zToConfidence, ewma, correlation, clamp } from './stats.js';

describe('mean', () => {
  it('returns 0 for empty array', () => {
    expect(mean([])).toBe(0);
  });
  it('computes simple mean', () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3);
  });
});

describe('stdev', () => {
  it('returns 0 for length < 2', () => {
    expect(stdev([])).toBe(0);
    expect(stdev([5])).toBe(0);
  });
  it('matches sample stdev', () => {
    // [2,4,4,4,5,5,7,9] -> sample stdev ≈ 2.138
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2);
  });
});

describe('variance', () => {
  it('returns 0 for length < 2', () => {
    expect(variance([])).toBe(0);
    expect(variance([5])).toBe(0);
  });
  it('matches sample variance', () => {
    expect(variance([1, 2, 3, 4, 5])).toBeCloseTo(2.5, 5);
  });
});

describe('zScore', () => {
  it('returns 0 when stdev is 0', () => {
    expect(zScore(5, [5, 5, 5])).toBe(0);
  });
  it('positive z for value above mean', () => {
    const z = zScore(10, [1, 2, 3, 4, 5]);
    expect(z).toBeGreaterThan(2);
  });
  it('negative z for value below mean', () => {
    const z = zScore(0, [5, 6, 7, 8, 9]);
    expect(z).toBeLessThan(-2);
  });
});

describe('zToConfidence', () => {
  it('z=0 -> 50', () => {
    expect(zToConfidence(0)).toBe(50);
  });
  it('z=+3 -> high confidence', () => {
    expect(zToConfidence(3)).toBeGreaterThan(90);
  });
  it('z=-3 -> low confidence', () => {
    expect(zToConfidence(-3)).toBeLessThan(10);
  });
});

describe('ewma', () => {
  it('returns 0 for empty', () => {
    expect(ewma([])).toBe(0);
  });
  it('returns first value when length=1', () => {
    expect(ewma([5])).toBe(5);
  });
  it('weights recent values more heavily', () => {
    const flat = ewma([1, 1, 1, 10], 0.5);
    expect(flat).toBeGreaterThan(2);
  });
});

describe('correlation', () => {
  it('returns 1 for identical series', () => {
    expect(correlation([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
  });
  it('returns -1 for inverse series', () => {
    expect(correlation([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1, 5);
  });
  it('returns 0 for unrelated', () => {
    expect(correlation([1, 2, 3], [5, 5, 5])).toBe(0);
  });
});

describe('clamp', () => {
  it('clamps to bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });
});
