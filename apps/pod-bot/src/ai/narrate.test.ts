import { describe, it, expect, vi } from 'vitest';
import { narrateSignal, dailyBriefing, compileRule } from './narrate.js';
import type { PodSignal } from '@pod/signal-engine';

const sampleSignal: PodSignal = {
  asset: 'BTC',
  generated_at: '2026-04-30T12:00:00Z',
  direction: 'STRONG_BUY',
  podScore: 82,
  compositeZ: 1.7,
  contributions: [
    {
      source: 'ETF_FLOW',
      weight: 0.3,
      zScore: 2.1,
      confidence: 92,
      rationale: 'BTC ETF strong inflow: +$697M.',
    },
  ],
  targetBasket: [
    { symbol: 'BTC', weight: 0.6 },
    { symbol: 'ETH', weight: 0.2 },
    { symbol: 'USDC', weight: 0.2 },
  ],
  reasoning: 'Strong buy on BTC.',
  uncertain: false,
};

describe('narrateSignal', () => {
  it('falls back to template reasoning when LLM throws', async () => {
    const fakeLlm = { complete: vi.fn().mockRejectedValue(new Error('boom')) } as unknown as Parameters<
      typeof narrateSignal
    >[0];
    const out = await narrateSignal(fakeLlm, sampleSignal);
    expect(out).toBe(sampleSignal.reasoning);
  });

  it('returns the LLM completion when present', async () => {
    const fakeLlm = {
      complete: vi.fn().mockResolvedValue('We loaded BTC because Wall Street did first.'),
    } as unknown as Parameters<typeof narrateSignal>[0];
    const out = await narrateSignal(fakeLlm, sampleSignal, { personality: 'BRO' });
    expect(out).toMatch(/Wall Street/);
  });

  it('passes user context into the prompt', async () => {
    const completeMock = vi.fn().mockResolvedValue('ok');
    const fakeLlm = { complete: completeMock } as unknown as Parameters<typeof narrateSignal>[0];
    await narrateSignal(fakeLlm, sampleSignal, { userContext: 'alice prefers low risk' });
    const userPrompt = completeMock.mock.calls[0]![0].user as string;
    expect(userPrompt).toMatch(/alice/);
  });
});

describe('dailyBriefing', () => {
  it('falls back when LLM fails', async () => {
    const fakeLlm = { complete: vi.fn().mockRejectedValue(new Error('boom')) } as unknown as Parameters<
      typeof dailyBriefing
    >[0];
    const out = await dailyBriefing(fakeLlm, [sampleSignal]);
    expect(out).toMatch(/BTC.*STRONG_BUY/);
  });
});

describe('compileRule', () => {
  it('returns null on invalid JSON', async () => {
    const fakeLlm = {
      complete: vi.fn().mockResolvedValue('not json at all'),
    } as unknown as Parameters<typeof compileRule>[0];
    const out = await compileRule(fakeLlm, 'sell ETH if BTC drops 10%');
    expect(out).toBeNull();
  });

  it('parses fenced JSON', async () => {
    const fakeLlm = {
      complete: vi.fn().mockResolvedValue(
        '```json\n' +
          JSON.stringify({
            description: 'sell ETH if BTC drops 10%',
            conditions: [{ metric: 'BTC_RETURN', operator: '<', threshold: -0.1, window: '7d' }],
            action: { type: 'REBALANCE', target: [{ symbol: 'USDC', weight: 1 }] },
            riskNotes: 'BTC and ETH correlate >0.8.',
          }) +
          '\n```',
      ),
    } as unknown as Parameters<typeof compileRule>[0];
    const out = await compileRule(fakeLlm, 'sell ETH if BTC drops 10%');
    expect(out?.action.type).toBe('REBALANCE');
    expect(out?.conditions[0]?.threshold).toBe(-0.1);
  });
});
