import { describe, it, expect } from 'vitest';
import { InMemoryUserStore, updateStreak, type UserRecord } from './store.js';

const baseUser: UserRecord = {
  telegramId: 1,
  language: 'en',
  state: 'NEW',
  createdAt: 0,
  updatedAt: 0,
  streakDays: 1,
};

describe('InMemoryUserStore', () => {
  it('returns null for unknown user', async () => {
    const s = new InMemoryUserStore();
    expect(await s.get(42)).toBeNull();
  });

  it('upserts and retrieves', async () => {
    const s = new InMemoryUserStore();
    await s.upsert({ ...baseUser, telegramId: 1 });
    const got = await s.get(1);
    expect(got?.telegramId).toBe(1);
  });

  it('overwrites on second upsert', async () => {
    const s = new InMemoryUserStore();
    await s.upsert({ ...baseUser, telegramId: 1, language: 'en' });
    await s.upsert({ ...baseUser, telegramId: 1, language: 'ja' });
    const got = await s.get(1);
    expect(got?.language).toBe('ja');
  });

  it('lists all', async () => {
    const s = new InMemoryUserStore();
    await s.upsert({ ...baseUser, telegramId: 1 });
    await s.upsert({ ...baseUser, telegramId: 2 });
    expect((await s.list()).length).toBe(2);
  });

  it('deletes', async () => {
    const s = new InMemoryUserStore();
    await s.upsert({ ...baseUser, telegramId: 1 });
    await s.delete(1);
    expect(await s.get(1)).toBeNull();
  });
});

describe('updateStreak', () => {
  it('increments streak when user opened bot yesterday', () => {
    const u: UserRecord = { ...baseUser, lastActiveDate: '2026-04-29', streakDays: 5 };
    const updated = updateStreak(u, '2026-04-30');
    expect(updated.streakDays).toBe(6);
    expect(updated.lastActiveDate).toBe('2026-04-30');
  });

  it('keeps streak unchanged when same day', () => {
    const u: UserRecord = { ...baseUser, lastActiveDate: '2026-04-30', streakDays: 5 };
    const updated = updateStreak(u, '2026-04-30');
    expect(updated).toBe(u);
  });

  it('resets streak to 1 when more than a day gap', () => {
    const u: UserRecord = { ...baseUser, lastActiveDate: '2026-04-25', streakDays: 10 };
    const updated = updateStreak(u, '2026-04-30');
    expect(updated.streakDays).toBe(1);
    expect(updated.lastActiveDate).toBe('2026-04-30');
  });
});
