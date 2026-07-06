import { Bot, InlineKeyboard, type Context } from 'grammy';
import { webhookCallback } from 'grammy';
import { type EtfSymbol } from '@pod/sosovalue-sdk';
import {
  type PodSignal,
  type RiskProfile,
} from '@pod/signal-engine';
import { tradeOnSignal } from '@/lib/trading';
import { getBubble, fetchAllBubbleData, type BubbleData } from '@/lib/bubble-data';
import { askPod, narrateScore, groundingFromBubbles } from '@/lib/bot/llm';
import { getOrCreateUser } from '@/lib/bot/store';
import { SoDEX } from '@pod/sodex-sdk';
import type { Hex } from 'viem';

/** Read an in-bot wallet's SoDEX testnet USDC balance (0 if none/unfunded). */
async function walletUsdcBalance(address: string): Promise<number> {
  try {
    const sdk = SoDEX.publicOnly('testnet');
    const resp = (await sdk.spot.balances(address)) as {
      data?: { balances?: Array<{ coin: string; total: string }> };
    };
    const usdc = resp.data?.balances?.find((b) => b.coin === 'vUSDC' || b.coin === 'USDC');
    return usdc ? Number(usdc.total) : 0;
  } catch {
    return 0;
  }
}

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
    en: `Commands:\n/start /signal /score /ask /wallet /trade /lang /help\n\n/ask <question> — ask about the market in plain English\n/wallet — your in-bot wallet + balance`,
    zh: `命令：\n/start /signal /score /ask /wallet /trade /lang /help\n\n/ask <问题> — 用自然语言询问市场\n/wallet — 你的机器人钱包和余额`,
    ja: `コマンド：\n/start /signal /score /ask /wallet /trade /lang /help\n\n/ask <質問> — 市場について質問\n/wallet — あなたのウォレットと残高`,
    ko: `명령어:\n/start /signal /score /ask /wallet /trade /lang /help\n\n/ask <질문> — 시장에 대해 질문\n/wallet — 내 지갑 및 잔액`,
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

  // /start — greet, mint an in-bot wallet, show deposit address, pick risk
  bot.command('start', async (ctx) => {
    const state = getOrCreateState(ctx);
    await ctx.reply(welcome(state.language), {
      reply_markup: new InlineKeyboard()
        .text('Chill', 'risk:CHILL')
        .text('Balanced', 'risk:BALANCED')
        .text('Send it', 'risk:SEND_IT'),
    });

    // Create (or fetch) this user's in-bot ValueChain wallet.
    const opts: { username?: string; language: Lang } = { language: state.language };
    if (ctx.from?.username) opts.username = ctx.from.username;
    const user = await getOrCreateUser(ctx.from!.id, opts);
    if (user?.walletAddress) {
      await ctx.reply(
        `Your POD wallet is ready.\n\nAddress:\n\`${user.walletAddress}\`\n\n` +
          `This is your own wallet on the SoDEX testnet. Fund it from the SoDEX faucet to trade your own orders, or use /trade to try the shared demo wallet. Check it anytime with /wallet.`,
        { parse_mode: 'Markdown' },
      );
    }
  });

  // /wallet — show the user's in-bot wallet + balance
  bot.command('wallet', async (ctx) => {
    const state = getOrCreateState(ctx);
    const opts: { username?: string; language: Lang } = { language: state.language };
    if (ctx.from?.username) opts.username = ctx.from.username;
    const user = await getOrCreateUser(ctx.from!.id, opts);
    if (!user?.walletAddress) {
      await ctx.reply('Wallet storage is not configured on this deployment.');
      return;
    }
    const bal = await walletUsdcBalance(user.walletAddress);
    await ctx.reply(
      `Your POD wallet\n\nAddress:\n\`${user.walletAddress}\`\n\n` +
        `SoDEX testnet balance: ${bal.toFixed(2)} USDC\n` +
        `${bal <= 0 ? 'Fund it from the SoDEX testnet faucet to place your own trades.' : 'Ready to trade — use /score then /trade.'}`,
      { parse_mode: 'Markdown' },
    );
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
    const narration = await narrateScore(
      {
        asset: signal.asset,
        podScore: signal.podScore,
        direction: signal.direction,
        topReason: signal.contributions[0]?.rationale ?? signal.reasoning,
      },
      state.personality,
      state.language,
    );
    if (narration) await ctx.reply(narration);
  });

  // /ask — natural-language Q&A grounded in the live POD scores
  bot.command('ask', async (ctx) => {
    const state = getOrCreateState(ctx);
    const question = ctx.match?.toString().trim();
    if (!question) {
      await ctx.reply('Ask me about the market, e.g. "/ask is smart money accumulating BTC?"');
      return;
    }
    await ctx.reply('Thinking…');
    const bubbles = await fetchAllBubbleData();
    const grounding = groundingFromBubbles(bubbles);
    const answer = await askPod(question, grounding, state.language);
    await ctx.reply(
      answer ??
        'I can only answer from live POD data and could not reach the model just now. Try /score BTC or /signal.',
    );
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
  // grammY's default webhook timeout is 10s, but a cold score cache runs the
  // full fan-out (~35s). Allow up to 55s (under the 60s function limit) and
  // return on timeout so Telegram does not retry-storm.
  const opts: { secretToken?: string; timeoutMilliseconds: number; onTimeout: 'return' } = {
    timeoutMilliseconds: 55_000,
    onTimeout: 'return',
  };
  if (secret) opts.secretToken = secret;
  cachedHandler = webhookCallback(bot, 'std/http', opts) as (req: Request) => Promise<Response>;
  return cachedHandler;
}

export const POST = async (req: Request): Promise<Response> => getHandler()(req);
export const GET = async () => Response.json({ ok: true, msg: 'POD telegram webhook' });
