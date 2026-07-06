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
import { getOrCreateUser, getWalletKey } from '@/lib/bot/store';
import { addAlert, listUserAlerts, clearUserAlerts, type AlertKind } from '@/lib/alerts';
import { addToWatchlist, getWatchlist, addDca, listDca, clearDca, recordReferral, countReferrals, setWebhookUrl } from '@/lib/user-features';
import { SoDEX } from '@pod/sodex-sdk';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

/** Read all of an in-bot wallet's SoDEX testnet balances. */
async function walletBalances(address: string): Promise<Array<{ coin: string; total: number }>> {
  try {
    const sdk = SoDEX.publicOnly('testnet');
    const resp = (await sdk.spot.balances(address)) as {
      data?: { balances?: Array<{ coin: string; total: string }> };
    };
    return (resp.data?.balances ?? [])
      .map((b) => ({ coin: b.coin.replace(/^v/, ''), total: Number(b.total) }))
      .filter((b) => b.total > 0);
  } catch {
    return [];
  }
}

/** USDC balance for one wallet (0 if none/unfunded). */
async function walletUsdcBalance(address: string): Promise<number> {
  const bals = await walletBalances(address);
  return bals.find((b) => b.coin === 'USDC')?.total ?? 0;
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

const SUPPORTED_ASSETS: EtfSymbol[] = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'AVAX', 'LINK', 'LTC', 'DOT', 'HBAR'];

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
    en: `Commands:\n/start /signal /score /ask /alert /watch /dca /wallet /portfolio /trade /lang /help\n\n/ask <question> — ask the market in plain English\n/alert BTC above 70 — ping when a score crosses\n/watch BTC ETH — add to your daily digest\n/dca BTC 5 — recurring $5 buy\n/wallet · /portfolio — wallet + holdings\n/ref — referral link · /webhook — event URL`,
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

  // /start — greet, mint an in-bot wallet, show deposit address, pick risk.
  // Handles deep-link payloads: "ref-<id>" (referral) and "score-BTC".
  bot.command('start', async (ctx) => {
    const state = getOrCreateState(ctx);
    const payload = ctx.match?.toString().trim() ?? '';

    if (payload.startsWith('ref-')) {
      const referrer = Number(payload.slice(4));
      if (Number.isFinite(referrer)) await recordReferral(referrer, ctx.from!.id);
    }
    if (payload.startsWith('score-')) {
      const asset = payload.slice(6).toUpperCase();
      const b = await getBubble(asset as EtfSymbol);
      if (b) {
        await ctx.reply(`${asset} POD Score: ${b.score}/100 (${b.direction})\n\n${b.reasoning}`);
      }
    }

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

  // /export — reveal your in-bot wallet private key (you own it)
  bot.command('export', async (ctx) => {
    const arg = ctx.match?.toString().trim().toLowerCase();
    if (arg !== 'confirm') {
      await ctx.reply(
        'This reveals your wallet private key. Anyone with it controls your wallet — never share it.\n\n' +
          'Send /export confirm to reveal it.',
      );
      return;
    }
    const key = await getWalletKey(ctx.from!.id);
    if (!key) {
      await ctx.reply('No wallet key found. Run /start first.');
      return;
    }
    await ctx.reply(`Your private key (keep it secret):\n\`${key}\``, { parse_mode: 'Markdown' });
  });

  // /portfolio — holdings in the demo trading wallet (where /trade executes)
  bot.command('portfolio', async (ctx) => {
    const pk = process.env['SODEX_PRIVATE_KEY'] as Hex | undefined;
    if (!pk) {
      await ctx.reply('Trading is not configured on this deployment.');
      return;
    }
    const addr = privateKeyToAccount(pk).address;
    const bals = await walletBalances(addr);
    if (bals.length === 0) {
      await ctx.reply('The demo trading wallet holds nothing right now.');
      return;
    }
    const lines = bals
      .sort((a, b) => b.total - a.total)
      .map((b) => `  ${b.coin}: ${b.total.toLocaleString(undefined, { maximumFractionDigits: 4 })}`);
    await ctx.reply(
      `POD demo trading wallet (shared testnet)\n\`${addr}\`\n\nHoldings:\n${lines.join('\n')}\n\nThis is where /score → Buy and /trade place orders.`,
      { parse_mode: 'Markdown' },
    );
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

  // /alert <ASSET> <above|below> <N> — subscribe to a score threshold
  bot.command('alert', async (ctx) => {
    const parts = (ctx.match?.toString().trim() ?? '').split(/\s+/).filter(Boolean);
    const asset = parts[0]?.toUpperCase();
    const dir = parts[1]?.toLowerCase();
    const n = Number(parts[2]);
    const validAsset = asset && SUPPORTED_ASSETS.concat(['XRP', 'DOGE', 'AVAX', 'LINK', 'LTC', 'DOT', 'HBAR'] as EtfSymbol[]).includes(asset as EtfSymbol);
    if (!validAsset || (dir !== 'above' && dir !== 'below') || !Number.isFinite(n) || n < 0 || n > 100) {
      await ctx.reply('Usage: /alert BTC above 70  (or "below 40"). I will ping you when the POD Score crosses it.');
      return;
    }
    const kind: AlertKind = dir === 'above' ? 'score_above' : 'score_below';
    const ok = await addAlert(ctx.from!.id, asset!, kind, n);
    await ctx.reply(
      ok
        ? `Alert set: I'll ping you when ${asset} POD Score goes ${dir} ${n}. See all with /alerts.`
        : 'Could not save the alert (storage not configured).',
    );
  });

  // /watch <COIN...> — add coins to your watchlist
  bot.command('watch', async (ctx) => {
    const syms = (ctx.match?.toString().trim().toUpperCase().split(/\s+/) ?? []).filter((s) =>
      SUPPORTED_ASSETS.includes(s as EtfSymbol),
    );
    if (syms.length === 0) {
      await ctx.reply('Usage: /watch BTC ETH SOL — adds coins to your watchlist for the daily digest.');
      return;
    }
    for (const s of syms) await addToWatchlist(ctx.from!.id, s);
    await ctx.reply(`Watching: ${syms.join(', ')}. See all with /watchlist.`);
  });

  // /watchlist — show your watchlist with current scores
  bot.command('watchlist', async (ctx) => {
    const list = await getWatchlist(ctx.from!.id);
    if (list.length === 0) {
      await ctx.reply('Your watchlist is empty. Add coins with /watch BTC ETH.');
      return;
    }
    const bubbles = await fetchAllBubbleData();
    const lines = list.map((a) => {
      const b = bubbles.find((x) => x.asset === a);
      return b ? `• ${a}: ${b.score}/100 (${b.direction})` : `• ${a}`;
    });
    await ctx.reply(`Your watchlist:\n${lines.join('\n')}`);
  });

  // /dca <COIN> <USD> — schedule a recurring daily buy
  bot.command('dca', async (ctx) => {
    const parts = (ctx.match?.toString().trim() ?? '').split(/\s+/).filter(Boolean);
    if (parts[0]?.toLowerCase() === 'clear') {
      const n = await clearDca(ctx.from!.id);
      await ctx.reply(n > 0 ? `Cleared ${n} DCA schedule(s).` : 'No active DCA schedules.');
      return;
    }
    if (parts[0]?.toLowerCase() === 'list') {
      const list = await listDca(ctx.from!.id);
      if (list.length === 0) {
        await ctx.reply('No DCA schedules. Start one with /dca BTC 5.');
        return;
      }
      await ctx.reply(
        `Your DCA schedules:\n${list.map((d) => `• $${d.amountUsd} ${d.asset} every ${d.intervalHours}h`).join('\n')}\n\nClear with /dca clear.`,
      );
      return;
    }
    const asset = parts[0]?.toUpperCase();
    const amount = Number(parts[1]);
    if (!asset || !SUPPORTED_ASSETS.includes(asset as EtfSymbol) || !Number.isFinite(amount) || amount < 1) {
      await ctx.reply('Usage: /dca BTC 5 — buys $5 of BTC daily on the demo wallet. /dca list · /dca clear.');
      return;
    }
    const ok = await addDca(ctx.from!.id, asset, amount, 24);
    await ctx.reply(
      ok
        ? `DCA set: $${amount} ${asset} every 24h (demo wallet). See /dca list.`
        : 'Could not save the DCA schedule.',
    );
  });

  // /webhook <url> — receive alert events on your own URL ("/webhook off" to clear)
  bot.command('webhook', async (ctx) => {
    const arg = ctx.match?.toString().trim() ?? '';
    if (arg.toLowerCase() === 'off' || arg === '') {
      await setWebhookUrl(ctx.from!.id, null);
      await ctx.reply('Webhook cleared. Set one with /webhook https://your-url.com/hook');
      return;
    }
    if (!/^https:\/\/.+/.test(arg)) {
      await ctx.reply('Give an https URL: /webhook https://your-url.com/hook');
      return;
    }
    await setWebhookUrl(ctx.from!.id, arg);
    await ctx.reply('Webhook set. Your alert events will POST there as JSON too.');
  });

  // /ref — your referral link + count
  bot.command('ref', async (ctx) => {
    const id = ctx.from!.id;
    const count = await countReferrals(id);
    await ctx.reply(
      `Your referral link:\nhttps://t.me/podttest_bot?start=ref-${id}\n\n` +
        `Invites so far: ${count}. When execution charges a fee, referrers earn a share of it.`,
    );
  });

  // /alerts — list active alerts; "/alerts clear" to remove them
  bot.command('alerts', async (ctx) => {
    if (ctx.match?.toString().trim().toLowerCase() === 'clear') {
      const removed = await clearUserAlerts(ctx.from!.id);
      await ctx.reply(removed > 0 ? `Cleared ${removed} alert${removed === 1 ? '' : 's'}.` : 'No active alerts to clear.');
      return;
    }
    const alerts = await listUserAlerts(ctx.from!.id);
    if (alerts.length === 0) {
      await ctx.reply('No active alerts. Set one with:\n/alert BTC above 70');
      return;
    }
    const lines = alerts.map((a) => `• ${a.asset} ${a.kind === 'score_above' ? 'above' : 'below'} ${a.threshold}`);
    await ctx.reply(`Your alerts:\n${lines.join('\n')}\n\nClear all with /alerts clear.`);
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
    const text = `${asset} POD Score: ${b.score}/100  (${b.direction}${b.uncertain ? ', low confidence' : ''})\n\n${b.reasoning}`;

    // One-tap preset orders when POD is constructive and execution is configured.
    const canTrade = process.env['SODEX_PRIVATE_KEY'] && (b.direction === 'BUY' || b.direction === 'STRONG_BUY');
    if (canTrade) {
      await ctx.reply(text, {
        reply_markup: new InlineKeyboard()
          .text(`Buy $5 ${asset}`, `trade:preset:${asset}:5`)
          .text(`Buy $10 ${asset}`, `trade:preset:${asset}:10`),
      });
    } else {
      await ctx.reply(text);
    }
  });

  // One-tap preset order from a /score card
  bot.callbackQuery(/^trade:preset:([A-Z]+):(\d+)$/, async (ctx) => {
    const asset = ctx.match[1] as EtfSymbol;
    const funds = Number(ctx.match[2]);
    const tradePk = process.env['SODEX_PRIVATE_KEY'] as Hex | undefined;
    await ctx.answerCallbackQuery({ text: 'Submitting…' });
    if (!tradePk) {
      await ctx.reply('Trade execution is not configured on this deployment.');
      return;
    }
    const b = await getBubble(asset);
    if (!b) {
      await ctx.reply('Lost the signal — run /score again.');
      return;
    }
    await ctx.reply(`Placing a $${funds} ${asset} market order on the SoDEX testnet (demo wallet)…`);
    try {
      const trade = await tradeOnSignal({ privateKey: tradePk, signal: bubbleToSignal(b), fundsUsd: funds });
      let body = `${asset} ${b.direction} (POD Score ${b.score}/100)\n\n`;
      if (!trade.attempted) body += `No order placed. ${trade.reason ?? trade.error ?? 'nothing to trade'}`;
      else if (trade.error) body += `Order not placed. ${trade.error}`;
      else body += `Order submitted.\nSymbol ID: ${trade.symbolID}\nFunds: $${trade.funds}\nResponse: ${JSON.stringify(trade.result).slice(0, 400)}`;
      await ctx.reply(body);
    } catch (err) {
      await ctx.reply(`Error: ${(err as Error).message}`);
    }
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

  // Inline mode — type "@podttest_bot BTC" in any chat to drop a live score
  // card (needs inline enabled via BotFather /setinline).
  bot.on('inline_query', async (ctx) => {
    const q = ctx.inlineQuery.query.trim().toUpperCase();
    const bubbles = await fetchAllBubbleData();
    const matches = q
      ? bubbles.filter((b) => b.asset.includes(q) || b.name.toUpperCase().includes(q))
      : bubbles;
    const results = matches.slice(0, 10).map((b) => ({
      type: 'article' as const,
      id: b.asset,
      title: `${b.asset} — POD Score ${b.score}/100 (${b.direction})`,
      description: b.reasoning.slice(0, 90),
      input_message_content: {
        message_text: `${b.asset} — POD Score ${b.score}/100 (${b.direction})\n\n${b.reasoning}\n\nvia @podttest_bot`,
      },
    }));
    try {
      await ctx.answerInlineQuery(results, { cache_time: 10 });
    } catch (err) {
      console.error('[bot] inline answer failed:', err);
    }
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
