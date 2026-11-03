import { describe, it, expect } from 'vitest';
import { confirmOrder, type ConfirmDeps, type FillRow, type OrderRecord } from './fills.js';

/** A fake clock so the polling loop runs instantly and deterministically. */
function harness(over: Partial<ConfirmDeps>) {
  let t = 0;
  const calls = { trades: 0, order: 0, balance: 0 };
  const deps: ConfirmDeps = {
    trades: async () => {
      calls.trades++;
      return [];
    },
    order: async () => {
      calls.order++;
      return undefined;
    },
    sleep: async (ms) => {
      t += ms;
    },
    now: () => t,
    ...over,
  };
  return { deps, calls };
}

const fill: FillRow = { tradeID: 1, orderID: 9, price: '78000', quantity: '0.00007', fee: '0.0000000455', builderFee: '0.0055' };
const rec = (status: string, executedQty = '0', executedValue = '0'): OrderRecord => ({ orderID: 9, status, executedQty, executedValue });

describe('confirmOrder', () => {
  it('returns the fills as soon as the trades endpoint has them', async () => {
    const { deps } = harness({ trades: async () => [fill] });
    const r = await confirmOrder(deps);
    expect(r).toMatchObject({ state: 'filled', source: 'trades', fills: [fill] });
  });

  it('the live mainnet bug: trades stays empty but the order record says FILLED -> filled, not "no fill"', async () => {
    const { deps } = harness({ order: async () => rec('FILLED', '0.00007', '5.4559') });
    const r = await confirmOrder(deps, { timeoutMs: 30_000 });
    expect(r.state).toBe('filled');
    if (r.state === 'filled') {
      expect(r.source).toBe('order');
      expect(r.executedQty).toBe('0.00007');
      expect(Number(r.avgPrice)).toBeCloseTo(77_941.43, 1);
      expect(r.fills).toEqual([]);
    }
  });

  it('waits a little for fee detail from trades before settling on the order record', async () => {
    let n = 0;
    const { deps } = harness({
      order: async () => rec('FILLED', '0.00007', '5.4'),
      trades: async () => (++n >= 3 ? [fill] : []),
    });
    const r = await confirmOrder(deps);
    expect(r).toMatchObject({ state: 'filled', source: 'trades' });
  });

  it('when both the trades list and the order record are empty, a balance change still proves a fill', async () => {
    const { deps } = harness({ balanceMoved: async () => true });
    const r = await confirmOrder(deps, { timeoutMs: 10_000 });
    expect(r).toMatchObject({ state: 'filled', source: 'balance', fills: [] });
  });

  it('reports not_filled ONLY when the order record says the order did not execute', async () => {
    for (const status of ['CANCELED', 'EXPIRED', 'REJECTED']) {
      const { deps } = harness({ order: async () => rec(status) });
      const r = await confirmOrder(deps);
      expect(r.state).toBe('not_filled');
      if (r.state === 'not_filled') expect(r.status).toBe(status);
    }
  });

  it('a market order recorded as CANCELED with a non-zero executedQty is a FILL (the real gateway does this)', async () => {
    // Observed on the live gateway: origQty 0.00008, executedQty 0.00007, status CANCELED.
    const { deps } = harness({ order: async () => rec('CANCELED', '0.00007', '5.36599') });
    const r = await confirmOrder(deps, { timeoutMs: 30_000 });
    expect(r.state).toBe('filled');
    if (r.state === 'filled') {
      expect(r.executedQty).toBe('0.00007');
      expect(r.partial).toBeUndefined();
    }
  });

  it('only PARTIALLY_FILLED is flagged partial', async () => {
    const { deps } = harness({ order: async () => rec('PARTIALLY_FILLED', '0.00004', '3.1') });
    const r = await confirmOrder(deps, { timeoutMs: 30_000 });
    expect(r.state).toBe('filled');
    if (r.state === 'filled') expect(r.partial).toBe(true);
  });

  it('silence from every source is "unknown", never "not filled"', async () => {
    const { deps } = harness({});
    const r = await confirmOrder(deps, { timeoutMs: 8_000 });
    expect(r.state).toBe('unknown');
    if (r.state === 'unknown') expect(r.detail).toMatch(/Do not send it again/);
  });

  it('errors from the endpoints are treated as silence, not as a verdict', async () => {
    const { deps } = harness({
      trades: async () => {
        throw new Error('502');
      },
      order: async () => {
        throw new Error('timeout');
      },
      balanceMoved: async () => {
        throw new Error('down');
      },
    });
    const r = await confirmOrder(deps, { timeoutMs: 6_000 });
    expect(r.state).toBe('unknown');
  });

  it('a resting NEW order is reported as resting', async () => {
    const { deps } = harness({ order: async () => rec('NEW') });
    const r = await confirmOrder(deps, { timeoutMs: 6_000 });
    expect(r).toMatchObject({ state: 'resting' });
  });

  it('keeps polling for the full window and reports progress', async () => {
    const lines: string[] = [];
    const { deps, calls } = harness({});
    await confirmOrder(deps, { timeoutMs: 9_000, intervalMs: 1_500, onProgress: (l) => lines.push(l) });
    expect(calls.trades).toBeGreaterThanOrEqual(5);
    expect(lines[0]).toMatch(/confirming/i);
  });

  it('a late fill that shows up after several empty rounds is still found', async () => {
    let n = 0;
    const { deps } = harness({ trades: async () => (++n >= 12 ? [fill] : []) });
    const r = await confirmOrder(deps, { timeoutMs: 45_000 });
    expect(r).toMatchObject({ state: 'filled', source: 'trades' });
  });
});
