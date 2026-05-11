/**
 * Statistical utilities for signal computation.
 * No external dependencies — keeps the package light and deterministic.
 */

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

export function variance(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let acc = 0;
  for (const x of xs) acc += (x - m) ** 2;
  return acc / (xs.length - 1);
}

export function stdev(xs: readonly number[]): number {
  return Math.sqrt(variance(xs));
}

/**
 * Z-score: how many standard deviations a value is from the historical mean.
 * Returns 0 if stdev is 0 (no variation).
 */
export function zScore(value: number, history: readonly number[]): number {
  const s = stdev(history);
  if (s === 0) return 0;
  return (value - mean(history)) / s;
}

/**
 * Squash z-score into a 0-100 confidence band, where:
 *   z = -3 → ~0    (strong sell)
 *   z =  0 → 50    (neutral)
 *   z = +3 → ~100  (strong buy)
 *
 * Uses a logistic squash with k = 1.0 for sensible spread.
 */
export function zToConfidence(z: number): number {
  const sigmoid = 1 / (1 + Math.exp(-z));
  return Math.round(sigmoid * 100);
}

/**
 * Clamp a value to [min, max].
 */
export function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

/**
 * Exponentially weighted moving average — gives more weight to recent values.
 * `alpha` is the smoothing factor (0..1); higher = more reactive.
 */
export function ewma(xs: readonly number[], alpha = 0.3): number {
  if (xs.length === 0) return 0;
  let s = xs[0]!;
  for (let i = 1; i < xs.length; i++) {
    s = alpha * xs[i]! + (1 - alpha) * s;
  }
  return s;
}

/**
 * Pearson correlation coefficient between two equal-length series.
 */
export function correlation(xs: readonly number[], ys: readonly number[]): number {
  if (xs.length !== ys.length || xs.length < 2) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dxs = 0;
  let dys = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    num += dx * dy;
    dxs += dx * dx;
    dys += dy * dy;
  }
  if (dxs === 0 || dys === 0) return 0;
  return num / Math.sqrt(dxs * dys);
}
