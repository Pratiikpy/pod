import { Bot, InlineKeyboard, type Context } from 'grammy';
import { SoSoValue, type EtfSymbol } from '@pod/sosovalue-sdk';
import { SignalEngine, type RiskProfile } from '@pod/signal-engine';
import { type Config } from './config.js';
import { type UserStore, type UserRecord, updateStreak, InMemoryUserStore } from './store.js';
import { welcome, riskPicker, depositPrompt, signalCard, help } from './copy.js';
import { LLM } from './ai/llm.js';
import { narrateSignal, type Personality } from './ai/narrate.js';

const SUPPORTED_ASSETS: EtfSymbol[] = ['BTC', 'ETH', 'SOL'];

export interface BotDeps {
  config: Config;
  store: UserStore;
  sso: SoSoValue;
  signalEngine: SignalEngine;
  llm?: LLM;
}

export function createBot(deps: BotDeps): Bot {
  const bot = new Bot(deps.config.TELEGRAM_BOT_TOKEN);
  // Default personality for v1; user customisation comes in Wave 2.
  const defaultPersonality: Personality = 'PROFESSOR';

  // ── /start: onboarding ──────────────────────────────────────────────────
  bot.command('start', async (ctx) => {
    const user = await getOrCreateUser(deps.store, ctx);
    await ctx.reply(welcome(user.language), {
      parse_mode: 'Markdown',
      reply_markup: makeRiskKeyboard(),
    });
    await deps.store.upsert({ ...user, state: 'PICKING_RISK' });
  });

  // ── Risk picker callback ────────────────────────────────────────────────
  bot.callbackQuery(/^risk:(CHILL|BALANCED|SEND_IT)$/, async (ctx) => {
    const profile = ctx.match[1] as RiskProfile;
    const user = await getOrCreateUser(deps.store, ctx);
    const updated: UserRecord = {
      ...user,
      riskProfile: profile,
      state: 'AWAITING_DEPOSIT',
    };
    await deps.store.upsert(updated);

    // In production, mint an embedded wallet (Privy / Turnkey).
    // For now we surface a deterministic placeholder so the flow demos end-to-end.
    // Deterministic placeholder address derived from Telegram ID (until embedded wallet is wired).
    const placeholderAddr = `0x${BigInt(ctx.from!.id).toString(16).padStart(40, '0')}`;

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `${riskPicker(user.language)}\n\n${depositPrompt(user.language, placeholderAddr)}`,
      { parse_mode: 'Markdown' },
    );
  });

  // ── /signal: today's signal ─────────────────────────────────────────────
  bot.command('signal', async (ctx) => {
    const user = await getOrCreateUser(deps.store, ctx);
    if (!user.riskProfile) {
      return ctx.reply('Run /start first to pick your vibe.');
    }
    await ctx.reply('🤖 Crunching the numbers…');

    try {
      const signal = await deps.signalEngine.generate({
        asset: 'BTC',
        riskProfile: user.riskProfile,
      });

      // Send the structured card first (always works, no latency).
      await ctx.reply(signalCard(user.language, signal), { parse_mode: 'Markdown' });

      // Then enrich with AI narration if available.
      if (deps.llm) {
        try {
          const narration = await narrateSignal(deps.llm, signal, {
            personality: defaultPersonality,
            lang: user.language,
          });
          await ctx.reply(`🧠 ${narration}`);
        } catch (err) {
          console.warn('[bot] AI narration skipped:', err);
        }
      }
    } catch (err) {
      console.error('[bot] /signal failed', err);
      await ctx.reply(
        '⚠️ Signal data not available right now (likely API rate limit). Try again in 60s.',
      );
    }
  });

  // ── /score: live POD Score for any supported asset ──────────────────────
  bot.command('score', async (ctx) => {
    const user = await getOrCreateUser(deps.store, ctx);
    const arg = ctx.match?.toString().trim().toUpperCase();
    const asset = SUPPORTED_ASSETS.includes(arg as EtfSymbol)
      ? (arg as EtfSymbol)
      : 'BTC';
    try {
      const signal = await deps.signalEngine.generate({
        asset,
        riskProfile: user.riskProfile ?? 'BALANCED',
        sources: ['ETF_FLOW'],
      });
      await ctx.reply(`*${asset}* POD Score: *${signal.podScore}/100*\n${signal.reasoning}`, {
        parse_mode: 'Markdown',
      });
    } catch (err) {
      console.error('[bot] /score failed', err);
      await ctx.reply('⚠️ Could not compute score right now.');
    }
  });

  // ── /lang: change language ──────────────────────────────────────────────
  bot.command('lang', async (ctx) => {
    await ctx.reply('Pick your language:', {
      reply_markup: new InlineKeyboard()
        .text('🇬🇧 English', 'lang:en')
        .text('🇨🇳 中文', 'lang:zh')
        .row()
        .text('🇯🇵 日本語', 'lang:ja')
        .text('🇰🇷 한국어', 'lang:ko'),
    });
  });

  bot.callbackQuery(/^lang:(en|zh|ja|ko)$/, async (ctx) => {
    const lang = ctx.match[1] as 'en' | 'zh' | 'ja' | 'ko';
    const user = await getOrCreateUser(deps.store, ctx);
    await deps.store.upsert({ ...user, language: lang });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`✅ Language set to ${lang}.`);
  });

  // ── /help and /balance ──────────────────────────────────────────────────
  bot.command('help', async (ctx) => {
    const user = await getOrCreateUser(deps.store, ctx);
    await ctx.reply(help(user.language));
  });

  bot.command('balance', async (ctx) => {
    const user = await getOrCreateUser(deps.store, ctx);
    if (!user.walletAddress) {
      return ctx.reply('No wallet yet. Run /start.');
    }
    // Future: read PodVault balance via on-chain RPC.
    await ctx.reply(
      `🪙 Wallet: \`${user.walletAddress}\`\n` +
        `📊 Vault NAV: connect production wallet to see live balance.`,
      { parse_mode: 'Markdown' },
    );
  });

  // ── Catch-all fallback ──────────────────────────────────────────────────
  bot.on('message', async (ctx) => {
    const user = await getOrCreateUser(deps.store, ctx);
    await ctx.reply(help(user.language));
  });

  return bot;
}

function makeRiskKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🛡️ Chill', 'risk:CHILL')
    .text('⚖️ Balanced', 'risk:BALANCED')
    .text('🚀 Send it', 'risk:SEND_IT');
}

async function getOrCreateUser(store: UserStore, ctx: Context): Promise<UserRecord> {
  const tgId = ctx.from?.id;
  if (!tgId) throw new Error('No Telegram user on this update');
  const existing = await store.get(tgId);
  const today = new Date().toISOString().slice(0, 10);
  if (existing) {
    const fresh = updateStreak(existing, today);
    if (fresh !== existing) await store.upsert(fresh);
    return fresh;
  }
  const created: UserRecord = {
    telegramId: tgId,
    language: detectLanguage(ctx.from?.language_code),
    state: 'NEW',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    streakDays: 1,
    lastActiveDate: today,
  };
  if (ctx.from?.username) created.username = ctx.from.username;
  await store.upsert(created);
  return created;
}

function detectLanguage(code?: string): UserRecord['language'] {
  if (!code) return 'en';
  if (code.startsWith('zh')) return 'zh';
  if (code.startsWith('ja')) return 'ja';
  if (code.startsWith('ko')) return 'ko';
  return 'en';
}

/** Convenience for tests + local dev. */
export function createDevBot(token: string, ssoApiKey: string): Bot {
  const config = {
    TELEGRAM_BOT_TOKEN: token,
    SOSOVALUE_API_KEY: ssoApiKey,
    SODEX_NETWORK: 'testnet' as const,
    NODE_ENV: 'development' as const,
    PUBLIC_APP_URL: 'http://localhost:3000',
  };
  const sso = new SoSoValue({ apiKey: ssoApiKey });
  return createBot({
    config,
    store: new InMemoryUserStore(),
    sso,
    signalEngine: new SignalEngine(sso),
  });
}
