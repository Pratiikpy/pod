import OpenAI from 'openai';
import type { BubbleData } from '@/lib/bubble-data';

/**
 * LLM layer for the bot — 0G AI (OpenAI-compatible) as primary, NVIDIA NIM as
 * fallback, template/null as last resort. Used for `/ask` (grounded market
 * Q&A) and personality-flavored score narration. Every prompt forbids
 * inventing numbers: answers must come from the POD data passed in.
 */
type Provider = { client: OpenAI; model: string };

function getProvider(): Provider | null {
  const og = process.env['OG_API_KEY'];
  if (og) {
    return {
      client: new OpenAI({ apiKey: og, baseURL: process.env['OG_BASE_URL'] ?? 'https://router-api.0g.ai/v1' }),
      model: process.env['OG_MODEL'] ?? '0gm-1.0-35b-a3b',
    };
  }
  const nv = process.env['NVIDIA_API_KEY'];
  if (nv) {
    return {
      client: new OpenAI({ apiKey: nv, baseURL: process.env['NVIDIA_BASE_URL'] ?? 'https://integrate.api.nvidia.com/v1' }),
      model: process.env['NVIDIA_MODEL'] ?? 'meta/llama-3.3-70b-instruct',
    };
  }
  return null;
}

export function llmAvailable(): boolean {
  return getProvider() !== null;
}

const LANG_INSTRUCTION: Record<string, string> = {
  en: 'Reply in English.',
  zh: '请用中文（简体）回答。',
  ja: '日本語で答えてください。',
  ko: '한국어로 답변해 주세요.',
};

/** Compact, factual grounding block built from the live POD scores. */
export function groundingFromBubbles(bubbles: BubbleData[]): string {
  const lines = bubbles.map((b) => {
    const srcs = b.contributions
      .filter((c) => c.weight > 0)
      .map((c) => `${c.source}=${c.zScore.toFixed(2)}σ`)
      .join(', ');
    return `${b.asset} (${b.name}): POD Score ${b.score}/100, ${b.direction}, composite z=${b.z.toFixed(2)}${b.uncertain ? ' (low confidence)' : ''}. Drivers: ${srcs || 'none'}. ${b.reasoning}`;
  });
  return lines.join('\n');
}

/**
 * Grounded market Q&A. The model may only use `grounding` (the live POD data);
 * if the question isn't covered, it says so. Returns null if no LLM configured.
 */
export async function askPod(
  question: string,
  grounding: string,
  lang = 'en',
): Promise<string | null> {
  const p = getProvider();
  if (!p) return null;
  try {
    const res = await p.client.chat.completions.create({
      model: p.model,
      messages: [
        {
          role: 'system',
          content:
            `You are POD, an assistant that reads institutional crypto ETF-flow data and explains it plainly. ` +
            `Answer ONLY using the POD data below. Do not invent numbers or facts. If the data does not cover the question, say so plainly. ` +
            `Name the driver you used (e.g. "ETF flow", "treasuries", "stablecoin liquidity", "social sentiment"). Keep it to 2-4 short sentences. ${LANG_INSTRUCTION[lang] ?? LANG_INSTRUCTION['en']}\n\n` +
            `POD DATA (today):\n${grounding}`,
        },
        { role: 'user', content: question },
      ],
      temperature: 0.4,
      // 0G is a reasoning model: it spends output tokens thinking before it
      // emits the answer, so the budget must comfortably exceed the reply.
      max_tokens: 2000,
    });
    return res.choices[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('[llm] askPod failed:', err);
    return null;
  }
}

const PERSONALITY_PROMPT: Record<string, string> = {
  PROFESSOR: 'You are a calm, precise financial educator. Cite the data point and what it implies.',
  BRO: 'You are a hyped, casual crypto bro. Energetic, a little slang, still accurate.',
  NERD: 'You are a quant. Lead with the statistic and its rarity in plain numbers.',
};

/** Personality-flavored 2-3 sentence narration of a single score. */
export async function narrateScore(
  args: { asset: string; podScore: number; direction: string; topReason: string },
  personality = 'PROFESSOR',
  lang = 'en',
): Promise<string | null> {
  const p = getProvider();
  if (!p) return null;
  try {
    const res = await p.client.chat.completions.create({
      model: p.model,
      messages: [
        {
          role: 'system',
          content: `${PERSONALITY_PROMPT[personality] ?? PERSONALITY_PROMPT['PROFESSOR']} Never invent numbers; stick to the data. 2-3 sentences. ${LANG_INSTRUCTION[lang] ?? LANG_INSTRUCTION['en']}`,
        },
        {
          role: 'user',
          content: `Asset: ${args.asset}\nDirection: ${args.direction}\nPOD Score: ${args.podScore}/100\nTop driver: ${args.topReason}\nWrite the narration.`,
        },
      ],
      temperature: 0.7,
      max_tokens: 1200,
    });
    return res.choices[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('[llm] narrateScore failed:', err);
    return null;
  }
}
