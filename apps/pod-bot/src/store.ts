import type { RiskProfile } from '@pod/signal-engine';

export type OnboardingState = 'NEW' | 'PICKING_RISK' | 'AWAITING_DEPOSIT' | 'ACTIVE';

export interface UserRecord {
  telegramId: number;
  username?: string;
  language: 'en' | 'zh' | 'ja' | 'ko';
  state: OnboardingState;
  riskProfile?: RiskProfile;
  walletAddress?: string;
  createdAt: number;
  updatedAt: number;
  /** Streak tracking: last day they opened the bot, in YYYY-MM-DD. */
  lastActiveDate?: string;
  streakDays: number;
}

/**
 * Storage abstraction. Wave 1 ships an in-memory implementation;
 * production swaps for Postgres via Drizzle.
 */
export interface UserStore {
  get(telegramId: number): Promise<UserRecord | null>;
  upsert(user: UserRecord): Promise<void>;
  delete(telegramId: number): Promise<void>;
  list(): Promise<UserRecord[]>;
}

export class InMemoryUserStore implements UserStore {
  private readonly users = new Map<number, UserRecord>();

  async get(telegramId: number): Promise<UserRecord | null> {
    return this.users.get(telegramId) ?? null;
  }

  async upsert(user: UserRecord): Promise<void> {
    this.users.set(user.telegramId, { ...user, updatedAt: Date.now() });
  }

  async delete(telegramId: number): Promise<void> {
    this.users.delete(telegramId);
  }

  async list(): Promise<UserRecord[]> {
    return Array.from(this.users.values());
  }
}

/** Update a user's streak based on today's date. */
export function updateStreak(user: UserRecord, todayIso: string): UserRecord {
  if (user.lastActiveDate === todayIso) return user;
  const yesterday = new Date(todayIso + 'T00:00:00Z');
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayIso = yesterday.toISOString().slice(0, 10);

  if (user.lastActiveDate === yesterdayIso) {
    return { ...user, streakDays: user.streakDays + 1, lastActiveDate: todayIso };
  }
  return { ...user, streakDays: 1, lastActiveDate: todayIso };
}
