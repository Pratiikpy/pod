import { Bot, InlineKeyboard, type Context } from 'grammy';
import { webhookCallback } from 'grammy';
import { type EtfSymbol } from '@pod/sosovalue-sdk';
import {
  type PodSignal,
  type RiskProfile,
} from '@pod/signal-engine';
import OpenAI from 'openai';
import { tradeOnSignal } from '@/lib/trading';
import { getBubble, type BubbleData } from '@/lib/bubble-data';
import type { Hex } from 'viem';

/**
 * Adapt a cached BubbleData into the PodSignal shape the card + trade code
 * expects. Reading from the shared cache means /signal, /score, /trade and the
 * web /bubbles page all show the same number — no per-call rate-limit drift.
 */
function bubbleToSignal(b: BubbleData): PodSignal {
  return {
    asset: b.asset,
    generated_at: b.generatedAt,
    direction: b.direction,
    podScore: b.score,
    compositeZ: b.z,
    contributions: b.contributions,
    targetBasket: b.targetBasket,
    reasoning: b.reasoning,
    uncertain: b.uncertain,
  };
}

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POD Telegram bot.
 *
 *  - Multi-language UI (English / 中文 / 日本語 / 한국어)
 *  - Commands: /start /signal /score /trade /lang /help
 *  - AI-written explanation via NVIDIA NIM (falls back to template text)
 *  - /trade builds, signs (EIP-712), and submits a real order on the SoDEX testnet
 *  - Scores come from the same 10-minute cache the web dashboard uses
 */

type Lang = 'en' | 'zh' | 'ja' | 'ko';
type Personality = 'PROFESSOR' | 'BRO' | 'OWL' | 'SAVAGE' | 'NERD';

interface UserState {
  language: Lang;
  riskProfile?: RiskProfile;
  personality: Personality;
  streakDays: number;
  lastActiveDate?: string;
}

const userStates = new Map<number, UserState>();

const SUPPORTED_ASSETS: EtfSymbol[] = ['BTC', 'ETH', 'SOL'];

// ── Localised copy ───────────────────────────────────────────────────────────

function welcome(lang: Lang): string {
  return {
    en: `POD scores ten crypto coins from institutional ETF flow data, macro events, news, corporate Bitcoin holdings, and venture funding.\n\n/signal — full BTC analysis\n/score BTC|ETH|SOL — one-line score for a coin\n/trade — place a test order on SoDEX testnet\n/lang — change language\n/help — list commands`,
    zh: `POD 用机构级数据为十个加密币种打分：现货 ETF 流入、宏观事件、新闻、企业比特币持仓、风投融资。\n\n/signal — BTC 完整分析\n/score BTC|ETH|SOL — 单币种评分\n/trade — 在 SoDEX 测试网下单\n/lang — 切换语言\n/help — 命令列表`,
    ja: `POD は機関投資家レベルのデータ（現物 ETF フロー、マクロイベント、ニュース、企業のビットコイン保有、VC 資金）で 10 銘柄をスコアリングします。\n\n/signal — BTC の詳細分析\n/score BTC|ETH|SOL — 銘柄ごとのスコア\n/trade — SoDEX テストネットで注文\n/lang — 言語変更\n/help — コマンド一覧`,
    ko: `POD는 기관급 데이터(현물 ETF 흐름, 매크로, 뉴스, 기업 비트코인 보유, VC 펀딩)로 10개 코인을 평가합니다.\n\n/signal — BTC 전체 분석\n/score BTC|ETH|SOL — 코인별 점수\n/trade — SoDEX 테스트넷 주문\n/lang — 언어 변경\n/help — 명령어 목록`,
  }[lang];
}

function help(lang: Lang): string {
  return {
    en: `Commands:\n/start /signal /score /trade /lang /help`,
    zh: `命令：\n/start /signal /score /trade /lang /help`,
    ja: `コマンド：\n/start /signal /score /trade /lang /help`,
    ko: `명령어:\n/start /signal /score /trade /lang /help`,
  }[lang];
}

function signalCard(lang: Lang, signal: PodSignal): string {
  const directionLabels: Record<PodSignal['direction'], Record<Lang, string>> = {
    STRONG_BUY: { en: 'Strong buy', zh: '强买入', ja: '強い買い', ko: '강력 매수' },
    BUY: { en: 'Buy', zh: '买入', ja: '買い', ko: '매수' },
    HOLD: { en: 'Hold', zh: '持有', ja: 'ホールド', ko: '보유' },
    SELL: { en: 'Reduce', zh: '减仓', ja: '減らす', ko: '축소' },
    STRONG_SELL: { en: 'Defensive', zh: '防御', ja: '防御', ko: '방어' },
  };
  const directionLabel = directionLabels[signal.direction][lang];
  const baskets = signal.targetBasket
    .map((b) => `  ${b.symbol}: ${(b.weight * 100).toFixed(0)}%`)
    .join('\n');
  const headline = {
    en: `*${signal.asset} — POD Score*`,
    zh: `*${signal.asset} — POD 评分*`,
    ja: `*${signal.asset} — POD スコア*`,
    ko: `*${signal.asset} — POD 점수*`,
  }[lang];
  return [
    headline,
    '',
    `Direction: *${directionLabel}*`,
    `POD Score: *${signal.podScore}/100*  (z=${signal.compositeZ.toFixed(2)})`,
    '',
    `*Why?*`,
    signal.reasoning,
    '',
    `*Target basket:*`,
    baskets,
  ].join('\n');
}

const PERSONALITY_PROMPT: Record<Personality, string> = {
  PROFESSOR: 'You are a calm, precise financial educator. Cite the data point and what it implies. 2-3 sentences max.',
  BRO: 'You are a hyped, casual crypto bro. Use slang sparingly ("yo", "send it", "wagmi"). Energetic. 2-3 sentences max.',
  OWL: 'You are a patient, contemplative observer. Wise, deliberate. Treat the market as a long arc. 2-3 sentences max.',
  SAVAGE: 'You are a sharp, opinionated trader. Witty, slightly cocky, never rude. Land a clean truth. 2-3 sentences max.',
  NERD: 'You are a quant. Lead with the statistic. State its rarity in plain numbers. 2-3 sentences max.',
};

const LANG_INSTRUCTION: Record<Lang, string> = {
  en: 'Reply in English.',
  zh: '请用中文（简体）回答。',
  ja: '日本語で答えてください。',
  ko: '한국어로 답변해 주세요.',
};

async function narrate(
  signal: PodSignal,
  personality: Personality,
  lang: Lang,
): Promise<string | null> {
  const apiKey = process.env['NVIDIA_API_KEY'];
  if (!apiKey) return null;
  try {
    const client = new OpenAI({
      apiKey,
      baseURL: process.env['NVIDIA_BASE_URL'] ?? 'https://integrate.api.nvidia.com/v1',
    });
    const result = await client.chat.completions.create({
      model: process.env['NVIDIA_MODEL'] ?? 'meta/llama-3.3-70b-instruct',
      messages: [
        {
          role: 'system',
          content: `${PERSONALITY_PROMPT[personality]}\n${LANG_INSTRUCTION[lang]}\nNever invent numbers. Stick to the data.`,
        },
        {
          role: 'user',
          content:
            `Asset: ${signal.asset}\nDirection: ${signal.direction}\nPOD Score: ${signal.podScore}/100\n` +
            `Top reason: ${signal.contributions[0]?.rationale ?? signal.reasoning}\n` +
            `Write the personality-flavored 2-3 sentence narration.`,
        },
      ],
      temperature: 0.7,
      max_tokens: 220,
    });
    return result.choices[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

// ── Bot setup ────────────────────────────────────────────────────────────────

let cachedHandler: ((req: Request) => Promise<Response>) | null = null;

function detectLang(code?: string): Lang {
  if (!code) return 'en';
  if (code.startsWith('zh')) return 'zh';
  if (code.startsWith('ja')) return 'ja';
  if (code.startsWith('ko')) return 'ko';
  return 'en';
}

function getOrCreateState(ctx: Context): UserState {
  const id = ctx.from?.id;
  if (!id) throw new Error('No Telegram user');
  let state = userStates.get(id);
  if (!state) {
    state = {
      language: detectLang(ctx.from?.language_code),
      personality: 'PROFESSOR',
      streakDays: 1,
    };
    userStates.set(id, state);
  }
  return state;
}

function getHandler() {
  if (cachedHandler) return cachedHandler;

  const token = process.env['TELEGRAM_BOT_TOKEN'];
  if (!token) {
    return async () => new Response('TELEGRAM_BOT_TOKEN not configured', { status: 500 });
  }

  const bot = new Bot(token);

  // /start
  bot.command('start', async (ctx) => {
    const state = getOrCreateState(ctx);
    await ctx.reply(welcome(state.language), {
      reply_markup: new InlineKeyboard()
        .text('Chill', 'risk:CHILL')
        .text('Balanced', 'risk:BALANCED')
        .text('Send it', 'risk:SEND_IT'),
    });
  });

  // Risk picker
  bot.callbackQuery(/^risk:(CHILL|BALANCED|SEND_IT)$/, async (ctx) => {
    const state = getOrCreateState(ctx);
    state.riskProfile = ctx.match[1] as RiskProfile;
    await ctx.answerCallbackQuery({ text: `Risk profile: ${state.riskProfile}` });
    await ctx.reply(`Risk profile set: ${state.riskProfile}. Try /signal for a live BTC analysis.`);
  });

  // /signal
  bot.command('signal', async (ctx) => {
    const state = getOrCreateState(ctx);
    await ctx.reply('Reading the flow…');
    const b = await getBubble('BTC');
    if (!b || b.citation === 'No live data') {
      await ctx.reply('Live data is unavailable right now (rate limit). Try again in a minute.');
      return;
    }
    const signal = bubbleToSignal(b);
    // signalCard text is fully controlled (no user input, balanced *bold*) — Markdown is safe here.
    await ctx.reply(signalCard(state.language, signal), { parse_mode: 'Markdown' });
    const narration = await narrate(signal, state.personality, state.language);
    if (narration) await ctx.reply(narration);
  });

  // /score [SYMBOL]
  bot.command('score', async (ctx) => {
    const arg = ctx.match?.toString().trim().toUpperCase();
    const asset: EtfSymbol = SUPPORTED_ASSETS.includes(arg as EtfSymbol)
      ? (arg as EtfSymbol)
      : 'BTC';
    const b = await getBubble(asset);
    if (!b || b.citation === 'No live data') {
      await ctx.reply('Live data is unavailable right now. Try again in a minute.');
      return;
    }
    await ctx.reply(
      `${asset} POD Score: ${b.score}/100  (${b.direction}${b.uncertain ? ', low confidence' : ''})\n\n${b.reasoning}`,
    );
  });

  // /trade — confirm card → on Confirm, place a real SoDEX testnet order
  bot.command('trade', async (ctx) => {
    const state = getOrCreateState(ctx);
    const tradePk = process.env['SODEX_PRIVATE_KEY'] as Hex | undefined;
    if (!tradePk) {
      await ctx.reply(
        'Trade execution is not configured on this deployment. The production design gives each user their own embedded wallet.',
      );
      return;
    }
    const b = await getBubble('BTC');
    if (!b || b.citation === 'No live data') {
      await ctx.reply('Live data is unavailable, so a trade cannot be built right now.');
      return;
    }
    const funds = 6; // fixed $6 testnet ticket
    if (b.direction !== 'BUY' && b.direction !== 'STRONG_BUY') {
      await ctx.reply(
        `BTC POD Score ${b.score}/100, direction ${b.direction}. No trade — POD only acts on BUY or STRONG_BUY. Nothing to confirm.`,
      );
      return;
    }
    await ctx.reply(
      `Trade confirmation\n\nBuy $${funds} of BTC at market on the SoDEX testnet.\nBasis: POD Score ${b.score}/100 (${b.direction}, z=${b.z.toFixed(2)}).\n\nThis is a real testnet order signed with the demo wallet. No mainnet value.`,
      {
        reply_markup: new InlineKeyboard()
          .text('Confirm', `trade:go:${funds}`)
          .text('Cancel', 'trade:cancel'),
      },
    );
  });

  // /trade — cancel
  bot.callbackQuery('trade:cancel', async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Cancelled' });
    await ctx.editMessageText('Trade cancelled. Nothing was sent.');
  });

  // /trade — confirmed: execute
  bot.callbackQuery(/^trade:go:(\d+)$/, async (ctx) => {
    const funds = Number(ctx.match[1]);
    await ctx.answerCallbackQuery({ text: 'Submitting…' });
    await ctx.editMessageText('Submitting the order to the SoDEX testnet…');
    const tradePk = process.env['SODEX_PRIVATE_KEY'] as Hex;
    const b = await getBubble('BTC');
    if (!b) {
      await ctx.reply('Lost the signal — run /trade again.');
      return;
    }
    try {
      const trade = await tradeOnSignal({ privateKey: tradePk, signal: bubbleToSignal(b), fundsUsd: funds });
      // Plain text only — SoDEX responses contain chars that break Telegram Markdown.
      let body = `BTC ${b.direction} (POD Score ${b.score}/100)\n\n`;
      if (!trade.attempted) {
        body += `No order placed. ${trade.reason ?? trade.error ?? 'nothing to trade'}`;
      } else if (trade.error) {
        body += `Order not placed. ${trade.error}`;
      } else {
        const resp = JSON.stringify(trade.result).slice(0, 500);
        body += `Order submitted.\nSymbol ID: ${trade.symbolID}\nFunds: $${trade.funds}\nResponse: ${resp}`;
      }
      await ctx.reply(body);
    } catch (err) {
      await ctx.reply(`Error: ${(err as Error).message}`);
    }
  });

  // /lang
  bot.command('lang', async (ctx) => {
    await ctx.reply('Pick your language:', {
      reply_markup: new InlineKeyboard()
        .text('English', 'lang:en')
        .text('中文', 'lang:zh')
        .row()
        .text('日本語', 'lang:ja')
        .text('한국어', 'lang:ko'),
    });
  });

  bot.callbackQuery(/^lang:(en|zh|ja|ko)$/, async (ctx) => {
    const state = getOrCreateState(ctx);
    state.language = ctx.match[1] as Lang;
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`Language: ${state.language}`);
  });

  // /help
  bot.command('help', async (ctx) => {
    const state = getOrCreateState(ctx);
    await ctx.reply(help(state.language));
  });

  // Fallback
  bot.on('message', async (ctx) => {
    const state = getOrCreateState(ctx);
    await ctx.reply(help(state.language));
  });

  // Only enforce secretToken if Telegram was registered with one. An empty
  // string (env var unset) makes grammY reject every Telegram request with 401.
  const secret = process.env['TELEGRAM_WEBHOOK_SECRET'];
  const opts = secret ? { secretToken: secret } : {};
  cachedHandler = webhookCallback(bot, 'std/http', opts) as (req: Request) => Promise<Response>;
  return cachedHandler;
}

export const POST = async (req: Request): Promise<Response> => getHandler()(req);
export const GET = async () => Response.json({ ok: true, msg: 'POD telegram webhook' });
