/**
 * Local long-polling entrypoint for development.
 * Run with: pnpm --filter @pod/pod-bot dev
 *
 * In production, the bot runs as a Vercel Function via webhook (see `webhook.ts`).
 */

import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../../../.env') });
loadEnv(); // also load apps/pod-bot/.env if present
import { loadConfig } from './config.js';
import { SoSoValue } from '@pod/sosovalue-sdk';
import { SignalEngine } from '@pod/signal-engine';
import { createBot, type BotDeps } from './bot.js';
import { InMemoryUserStore } from './store.js';
import { LLM } from './ai/llm.js';

async function main() {
  const config = loadConfig();
  const sso = new SoSoValue({ apiKey: config.SOSOVALUE_API_KEY });
  const signalEngine = new SignalEngine(sso);
  const store = new InMemoryUserStore();

  const deps: BotDeps = { config, store, sso, signalEngine };
  if (config.NVIDIA_API_KEY) {
    deps.llm = new LLM({
      apiKey: config.NVIDIA_API_KEY,
      ...(config.NVIDIA_BASE_URL ? { baseUrl: config.NVIDIA_BASE_URL } : {}),
      ...(config.NVIDIA_MODEL ? { model: config.NVIDIA_MODEL } : {}),
    });
    console.log(`🧠 LLM enabled: ${deps.llm.model}`);
  }

  const bot = createBot(deps);

  console.log('🤖 POD bot starting in long-polling mode…');
  await bot.start({
    onStart: (info) => console.log(`✅ Connected as @${info.username}`),
  });
}

main().catch((err) => {
  console.error('💥 POD bot crashed:', err);
  process.exit(1);
});
