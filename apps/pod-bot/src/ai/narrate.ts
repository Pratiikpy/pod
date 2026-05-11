import type { PodSignal } from '@pod/signal-engine';
import type { LLM } from './llm.js';

export type Personality = 'BRO' | 'PROFESSOR' | 'OWL' | 'SAVAGE' | 'NERD';
export type Lang = 'en' | 'zh' | 'ja' | 'ko';

const PERSONALITY_PROMPT: Record<Personality, string> = {
  BRO: `You are a hyped, casual crypto bro. Use slang ("yo", "send it", "ngmi", "wagmi") sparingly. Energetic. Emojis OK. 2-3 sentences max.`,
  PROFESSOR: `You are a calm, precise financial educator. Use measured language. Cite the data point and what it implies. 2-3 sentences max.`,
  OWL: `You are a patient, contemplative observer. Wise, deliberate. Treat the market as a long arc. 2-3 sentences max.`,
  SAVAGE: `You are a sharp, opinionated trader. Witty, slightly cocky, never rude. Land a clean truth. 2-3 sentences max.`,
  NERD: `You are a quant. Lead with the statistic. State its rarity in plain numbers. No jargon beyond z-score. 2-3 sentences max.`,
};

const LANG_INSTRUCTION: Record<Lang, string> = {
  en: 'Reply in English.',
  zh: '请用中文（简体）回答。',
  ja: '日本語で答えてください。',
  ko: '한국어로 답변해 주세요.',
};

/**
 * Turn a deterministic PodSignal into a personality-flavored 1-paragraph narration.
 * Always falls back to the engine's reasoning string if the LLM fails.
 */
export async function narrateSignal(
  llm: LLM,
  signal: PodSignal,
  options: { personality?: Personality; lang?: Lang; userContext?: string } = {},
): Promise<string> {
  const personality = options.personality ?? 'PROFESSOR';
  const lang = options.lang ?? 'en';

  const system =
    `${PERSONALITY_PROMPT[personality]}\n` +
    `${LANG_INSTRUCTION[lang]}\n` +
    `You're explaining a crypto investing decision to a retail user.\n` +
    `Stay 100% faithful to the data given — do not invent numbers, sources, or events.\n` +
    `Focus on: (1) what we're doing, (2) the strongest reason in the data, (3) one sentence on risk.\n` +
    `Never give financial advice. Never use the word "guaranteed".`;

  const topContributions = signal.contributions
    .slice()
    .sort((a, b) => Math.abs(b.zScore * b.weight) - Math.abs(a.zScore * a.weight))
    .slice(0, 3)
    .map((c) => `- ${c.source} (z=${c.zScore.toFixed(2)}, weight=${c.weight}): ${c.rationale}`)
    .join('\n');

  const basket = signal.targetBasket
    .map((b) => `${b.symbol} ${(b.weight * 100).toFixed(0)}%`)
    .join(' / ');

  const user =
    `Asset: ${signal.asset}\n` +
    `Direction: ${signal.direction}\n` +
    `POD Score: ${signal.podScore}/100 (composite z=${signal.compositeZ.toFixed(2)})\n` +
    `Target basket: ${basket}\n` +
    `Top reasons:\n${topContributions}\n` +
    (options.userContext ? `\nUser context: ${options.userContext}\n` : '') +
    `\nWrite the narration now.`;

  try {
    return await llm.complete({ system, user, maxTokens: 220 });
  } catch (err) {
    console.warn('[narrate] LLM failed, falling back to template:', err);
    return signal.reasoning;
  }
}

/**
 * Build a 60-word morning briefing across multiple assets.
 */
export async function dailyBriefing(
  llm: LLM,
  signals: readonly PodSignal[],
  options: { personality?: Personality; lang?: Lang } = {},
): Promise<string> {
  const personality = options.personality ?? 'PROFESSOR';
  const lang = options.lang ?? 'en';

  const summary = signals
    .map(
      (s) =>
        `${s.asset}: ${s.direction} (POD ${s.podScore}/100). ${s.contributions[0]?.rationale ?? ''}`,
    )
    .join('\n');

  const system =
    `${PERSONALITY_PROMPT[personality]}\n` +
    `${LANG_INSTRUCTION[lang]}\n` +
    `Write a 60-word morning crypto briefing for a retail trader.\n` +
    `Lead with the headline (what's hot today), then list each asset in one sentence.\n` +
    `Stay faithful to the data. End with one sentence on what to watch.`;

  try {
    return await llm.complete({
      system,
      user: `Today's signals across the portfolio:\n${summary}\n\nWrite the briefing.`,
      maxTokens: 250,
    });
  } catch (err) {
    console.warn('[dailyBriefing] LLM failed, falling back to template:', err);
    return signals
      .map((s) => `${s.asset} ${s.direction} (${s.podScore}/100)`)
      .join(' · ');
  }
}

/**
 * Compile a natural-language conditional rule into a structured DSL.
 * Used for /rule "Sell ETH if BTC drops 10% in 7 days" → executable.
 */
export interface CompiledRule {
  description: string;
  conditions: Array<{
    metric: string;
    operator: '<' | '>' | '<=' | '>=' | '==';
    threshold: number;
    window?: string;
  }>;
  action: {
    type: 'REBALANCE' | 'EXIT' | 'NOTIFY';
    target?: { symbol: string; weight: number }[];
  };
  riskNotes: string;
}

export async function compileRule(llm: LLM, naturalLanguage: string): Promise<CompiledRule | null> {
  const system =
    `You compile natural-language crypto trading rules into structured JSON.\n` +
    `Return ONLY a JSON object matching this TypeScript type:\n` +
    `{ description: string;\n` +
    `  conditions: { metric: string; operator: '<'|'>'|'<='|'>='|'=='; threshold: number; window?: string }[];\n` +
    `  action: { type: 'REBALANCE'|'EXIT'|'NOTIFY'; target?: {symbol:string;weight:number}[] };\n` +
    `  riskNotes: string }\n` +
    `Refuse and return null if the rule is ambiguous, asks for >5x leverage, or could lose >50% of capital.`;
  try {
    const raw = await llm.complete({
      system,
      user: naturalLanguage,
      temperature: 0.1,
      maxTokens: 500,
    });
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(cleaned) as CompiledRule;
    if (!parsed.action || !parsed.conditions || !Array.isArray(parsed.conditions)) return null;
    return parsed;
  } catch (err) {
    console.warn('[compileRule] failed:', err);
    return null;
  }
}
