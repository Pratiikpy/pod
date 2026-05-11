import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { type RiskProfile } from '@pod/signal-engine';
import { users } from './schema.js';
import {
  type UserStore,
  type UserRecord,
  type OnboardingState,
} from '../store.js';

export interface PostgresStoreOptions {
  databaseUrl: string;
}

/**
 * Postgres-backed UserStore. Drop-in replacement for InMemoryUserStore.
 * Schema is `apps/pod-bot/src/db/schema.ts`. Run drizzle-kit to generate migrations.
 */
export class PostgresUserStore implements UserStore {
  private readonly client: ReturnType<typeof postgres>;
  private readonly db: PostgresJsDatabase;

  constructor(options: PostgresStoreOptions) {
    this.client = postgres(options.databaseUrl, { max: 5 });
    this.db = drizzle(this.client);
  }

  async get(telegramId: number): Promise<UserRecord | null> {
    const rows = await this.db.select().from(users).where(eq(users.telegramId, telegramId));
    const row = rows[0];
    if (!row) return null;
    return rowToRecord(row);
  }

  async upsert(user: UserRecord): Promise<void> {
    const row = recordToRow(user);
    await this.db
      .insert(users)
      .values(row)
      .onConflictDoUpdate({
        target: users.telegramId,
        set: row,
      });
  }

  async delete(telegramId: number): Promise<void> {
    await this.db.delete(users).where(eq(users.telegramId, telegramId));
  }

  async list(): Promise<UserRecord[]> {
    const rows = await this.db.select().from(users);
    return rows.map(rowToRecord);
  }

  async close(): Promise<void> {
    await this.client.end();
  }
}

function rowToRecord(row: typeof users.$inferSelect): UserRecord {
  const rec: UserRecord = {
    telegramId: row.telegramId,
    language: (row.language as UserRecord['language']) ?? 'en',
    state: (row.state as OnboardingState) ?? 'NEW',
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    streakDays: row.streakDays,
  };
  if (row.username) rec.username = row.username;
  if (row.riskProfile) rec.riskProfile = row.riskProfile as RiskProfile;
  if (row.walletAddress) rec.walletAddress = row.walletAddress;
  if (row.lastActiveDate) rec.lastActiveDate = row.lastActiveDate;
  return rec;
}

function recordToRow(rec: UserRecord) {
  return {
    telegramId: rec.telegramId,
    username: rec.username ?? null,
    language: rec.language,
    state: rec.state,
    riskProfile: rec.riskProfile ?? null,
    walletAddress: rec.walletAddress ?? null,
    lastActiveDate: rec.lastActiveDate ?? null,
    streakDays: rec.streakDays,
    createdAt: new Date(rec.createdAt),
    updatedAt: new Date(rec.updatedAt),
  };
}
