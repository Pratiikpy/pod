import { pgTable, bigint, text, integer, timestamp, varchar } from 'drizzle-orm/pg-core';

export const users = pgTable('pod_users', {
  telegramId: bigint('telegram_id', { mode: 'number' }).primaryKey(),
  username: varchar('username', { length: 64 }),
  language: varchar('language', { length: 8 }).notNull().default('en'),
  state: varchar('state', { length: 32 }).notNull().default('NEW'),
  riskProfile: varchar('risk_profile', { length: 16 }),
  walletAddress: varchar('wallet_address', { length: 64 }),
  privyDid: text('privy_did'),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
  lastActiveDate: varchar('last_active_date', { length: 10 }),
  streakDays: integer('streak_days').notNull().default(1),
});

export type DbUser = typeof users.$inferSelect;
export type NewDbUser = typeof users.$inferInsert;
