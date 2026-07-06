import { neon } from '@neondatabase/serverless';
import crypto from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

/**
 * Persistent bot user store + in-bot custodial wallet (Neon Postgres).
 *
 * On first `/start` each user gets a fresh ValueChain keypair. The private key
 * is encrypted at rest with AES-256-GCM (WALLET_ENCRYPTION_KEY) and only
 * decrypted server-side to sign that user's SoDEX orders. This is custodial —
 * fine for a testnet demo; the production path is a per-user embedded wallet
 * (Privy/Turnkey) so POD never holds keys. See docs/POD_MASTER_PLAN.md (F11).
 */

export type Lang = 'en' | 'zh' | 'ja' | 'ko';
export type RiskProfile = 'CHILL' | 'BALANCED' | 'SEND_IT';

export interface BotUser {
  telegramId: number;
  username?: string;
  language: Lang;
  riskProfile?: RiskProfile;
  personality: string;
  walletAddress?: string;
  streakDays: number;
  lastActiveDate?: string;
}

function db() {
  const url = process.env['DATABASE_URL'];
  return url ? neon(url) : null;
}

function encKey(): Buffer | null {
  const k = process.env['WALLET_ENCRYPTION_KEY'];
  if (!k || k.length < 64) return null;
  return Buffer.from(k.slice(0, 64), 'hex');
}

/** AES-256-GCM → base64(iv | tag | ciphertext). */
function encrypt(plaintext: string): string | null {
  const key = encKey();
  if (!key) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

function decrypt(blob: string): string | null {
  const key = encKey();
  if (!key) return null;
  const raw = Buffer.from(blob, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

function rowToUser(r: Record<string, unknown>): BotUser {
  const u: BotUser = {
    telegramId: Number(r['telegram_id']),
    language: (r['language'] as Lang) ?? 'en',
    personality: (r['personality'] as string) ?? 'PROFESSOR',
    streakDays: Number(r['streak_days'] ?? 1),
  };
  if (r['username']) u.username = String(r['username']);
  if (r['risk_profile']) u.riskProfile = r['risk_profile'] as RiskProfile;
  if (r['wallet_address']) u.walletAddress = String(r['wallet_address']);
  if (r['last_active_date']) u.lastActiveDate = String(r['last_active_date']);
  return u;
}

export async function getUser(telegramId: number): Promise<BotUser | null> {
  const sql = db();
  if (!sql) return null;
  const rows = (await sql`select * from bot_users where telegram_id = ${telegramId}`) as Array<
    Record<string, unknown>
  >;
  return rows[0] ? rowToUser(rows[0]) : null;
}

/** Get the user, creating the row + a fresh encrypted wallet on first contact. */
export async function getOrCreateUser(
  telegramId: number,
  opts: { username?: string; language?: Lang } = {},
): Promise<BotUser | null> {
  const sql = db();
  if (!sql) return null;

  const existing = await getUser(telegramId);
  if (existing) {
    // Backfill a wallet if an older row predates wallet support.
    if (!existing.walletAddress) await ensureWallet(telegramId);
    return (await getUser(telegramId)) ?? existing;
  }

  const pk = generatePrivateKey();
  const address = privateKeyToAccount(pk).address;
  const encrypted = encrypt(pk);

  await sql`
    insert into bot_users (telegram_id, username, language, wallet_address, wallet_encrypted, last_active_date)
    values (${telegramId}, ${opts.username ?? null}, ${opts.language ?? 'en'}, ${address}, ${encrypted}, now()::date)
    on conflict (telegram_id) do nothing
  `;
  return getUser(telegramId);
}

/** Ensure the user has a wallet; returns the address. */
export async function ensureWallet(telegramId: number): Promise<string | null> {
  const sql = db();
  if (!sql) return null;
  const u = await getUser(telegramId);
  if (u?.walletAddress) return u.walletAddress;

  const pk = generatePrivateKey();
  const address = privateKeyToAccount(pk).address;
  const encrypted = encrypt(pk);
  await sql`update bot_users set wallet_address = ${address}, wallet_encrypted = ${encrypted}, updated_at = now() where telegram_id = ${telegramId}`;
  return address;
}

/** Decrypt and return the user's wallet private key (server-side signing only). */
export async function getWalletKey(telegramId: number): Promise<Hex | null> {
  const sql = db();
  if (!sql) return null;
  const rows = (await sql`select wallet_encrypted from bot_users where telegram_id = ${telegramId}`) as Array<{
    wallet_encrypted: string | null;
  }>;
  const blob = rows[0]?.wallet_encrypted;
  if (!blob) return null;
  const pk = decrypt(blob);
  return pk ? (pk as Hex) : null;
}

export async function updateUser(
  telegramId: number,
  patch: Partial<Pick<BotUser, 'language' | 'riskProfile' | 'personality' | 'username'>>,
): Promise<void> {
  const sql = db();
  if (!sql) return;
  await sql`
    update bot_users set
      language = coalesce(${patch.language ?? null}, language),
      risk_profile = coalesce(${patch.riskProfile ?? null}, risk_profile),
      personality = coalesce(${patch.personality ?? null}, personality),
      username = coalesce(${patch.username ?? null}, username),
      updated_at = now()
    where telegram_id = ${telegramId}
  `;
}
