/**
 * User-facing copy in 4 languages. Each function takes a typed payload and returns
 * the localised message body. Keeping copy as functions (not raw strings) gives us
 * type safety and easy template injection.
 */

import type { PodSignal } from '@pod/signal-engine';

type Lang = 'en' | 'zh' | 'ja' | 'ko';

export const welcome = (lang: Lang): string =>
  ({
    en: `👋 Hey, I'm POD.

I grow your crypto using Wall Street's playbook — real spot ETF flow data, macro events, news.

I trade through SoDEX, log every decision onchain, and never let you lose more than your chosen cap.

Ready to set up? Tap a vibe below.`,
    zh: `👋 你好，我是 POD。

我用华尔街的真实数据（现货 ETF 流入、宏观事件、新闻）帮你管理加密资产。

通过 SoDEX 执行，每一次决策上链记录，永不超过你设定的最大亏损上限。

准备好了吗？选择风险偏好开始：`,
    ja: `👋 こんにちは、POD です。

私はウォール街と同じデータ（現物 ETF フロー、マクロイベント、ニュース）であなたの暗号資産を運用します。

SoDEX で執行し、すべての判断をオンチェーンに記録。設定した損失上限を超えることはありません。

準備はいいですか？スタイルを選んでください：`,
    ko: `👋 안녕하세요, POD입니다.

저는 월스트리트가 사용하는 데이터 (현물 ETF 자금 흐름, 매크로 이벤트, 뉴스) 로 당신의 암호화폐를 키웁니다.

SoDEX를 통해 실행하고, 모든 결정을 온체인에 기록하며, 당신이 설정한 손실 한도를 절대 넘기지 않습니다.

준비되셨나요? 아래에서 스타일을 선택하세요:`,
  })[lang];

export const riskPicker = (lang: Lang): string =>
  ({
    en: `🛡️ *Chill* — slow & steady, max -5% loss\n⚖️ *Balanced* — ETF flow strategy, max -10%\n🚀 *Send it* — leveraged, max -20%`,
    zh: `🛡️ *稳健* - 缓慢稳定，最大 -5% 亏损\n⚖️ *平衡* - ETF 流入策略，最大 -10%\n🚀 *激进* - 杠杆，最大 -20%`,
    ja: `🛡️ *ゆっくり* — じっくり、最大 -5% の損失\n⚖️ *バランス* — ETF フロー戦略、最大 -10%\n🚀 *攻め* — レバレッジ、最大 -20%`,
    ko: `🛡️ *천천히* - 느리고 안정적, 최대 -5% 손실\n⚖️ *균형* - ETF 흐름 전략, 최대 -10%\n🚀 *공격적* - 레버리지, 최대 -20%`,
  })[lang];

export const depositPrompt = (lang: Lang, address: string): string =>
  ({
    en: `✅ Vibe locked.\n\nYour POD wallet: \`${address}\`\n\nDeposit any USDC to start. Min $10.\n\nFirst trade in 24h.`,
    zh: `✅ 风格已锁定。\n\n您的 POD 钱包：\`${address}\`\n\n存入任意金额 USDC 即可开始。最低 $10。\n\n24小时内开始首次交易。`,
    ja: `✅ スタイル設定完了。\n\nあなたの POD ウォレット: \`${address}\`\n\n任意の額の USDC を入金してスタート。最低 $10。\n\n24時間以内に初回取引を実行します。`,
    ko: `✅ 스타일이 설정되었습니다.\n\n당신의 POD 지갑: \`${address}\`\n\n원하는 금액의 USDC를 입금하여 시작하세요. 최소 $10.\n\n24시간 이내에 첫 거래가 실행됩니다.`,
  })[lang];

export function signalCard(lang: Lang, signal: PodSignal): string {
  const headline = {
    en: `📊 *Today's signal for ${signal.asset}*`,
    zh: `📊 *今日 ${signal.asset} 信号*`,
    ja: `📊 *${signal.asset} の本日のシグナル*`,
    ko: `📊 *오늘의 ${signal.asset} 시그널*`,
  }[lang];

  const directionLabels: Record<PodSignal['direction'], Record<Lang, string>> = {
    STRONG_BUY: { en: 'Strong Buy 🟢', zh: '强买入 🟢', ja: '強い買い 🟢', ko: '강력 매수 🟢' },
    BUY: { en: 'Buy 🟢', zh: '买入 🟢', ja: '買い 🟢', ko: '매수 🟢' },
    HOLD: { en: 'Hold 🟡', zh: '持有 🟡', ja: 'ホールド 🟡', ko: '보유 🟡' },
    SELL: { en: 'Reduce 🔴', zh: '减仓 🔴', ja: '減らす 🔴', ko: '축소 🔴' },
    STRONG_SELL: { en: 'Defensive 🔴', zh: '防御 🔴', ja: '防御 🔴', ko: '방어 🔴' },
  };
  const directionLabel = directionLabels[signal.direction][lang];

  const baskets = signal.targetBasket
    .map((b: { symbol: string; weight: number }) => `  • ${b.symbol}: ${(b.weight * 100).toFixed(0)}%`)
    .join('\n');

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
    signal.uncertain ? `\n_⚠️ Low confidence — limited data._` : '',
  ].join('\n');
}

export const help = (lang: Lang): string =>
  ({
    en: `Commands:\n/start — onboard\n/signal — get today's signal\n/balance — show your vault\n/withdraw — exit anytime\n/lang — change language\n/help — this menu`,
    zh: `命令：\n/start — 入门\n/signal — 今日信号\n/balance — 我的钱包\n/withdraw — 随时退出\n/lang — 修改语言\n/help — 帮助菜单`,
    ja: `コマンド：\n/start — 開始\n/signal — 本日のシグナル\n/balance — 残高\n/withdraw — 引き出し\n/lang — 言語変更\n/help — このメニュー`,
    ko: `명령어:\n/start — 시작\n/signal — 오늘의 시그널\n/balance — 잔액\n/withdraw — 인출\n/lang — 언어 변경\n/help — 도움말`,
  })[lang];
