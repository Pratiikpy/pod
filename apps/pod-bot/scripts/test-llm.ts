/**
 * Live test: real SoSoValue signal → real NVIDIA LLM narration.
 * Run: pnpm --filter @pod/pod-bot exec tsx scripts/test-llm.ts
 */

import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../../../.env') });

import { SoSoValue } from '@pod/sosovalue-sdk';
import { SignalEngine } from '@pod/signal-engine';
import { LLM } from '../src/ai/llm.js';
import { narrateSignal, dailyBriefing, type Personality } from '../src/ai/narrate.js';

async function main() {
  const ssoKey = process.env['SOSOVALUE_API_KEY'];
  const nvidiaKey = process.env['NVIDIA_API_KEY'];
  if (!ssoKey) throw new Error('SOSOVALUE_API_KEY missing');
  if (!nvidiaKey) throw new Error('NVIDIA_API_KEY missing');

  const sso = new SoSoValue({ apiKey: ssoKey });
  const engine = new SignalEngine(sso);
  const llm = new LLM({
    apiKey: nvidiaKey,
    ...(process.env['NVIDIA_BASE_URL'] ? { baseUrl: process.env['NVIDIA_BASE_URL'] } : {}),
    ...(process.env['NVIDIA_MODEL'] ? { model: process.env['NVIDIA_MODEL'] } : {}),
  });
  console.log(`🧠 LLM: ${llm.model}\n`);

  // ── 1. Pull a real BTC signal ────────────────────────────────────────────
  console.log('📡 Generating live BTC signal…');
  const signal = await engine.generate({ asset: 'BTC', riskProfile: 'BALANCED' });
  console.log(`   Direction: ${signal.direction}  POD Score: ${signal.podScore}/100`);
  console.log(`   Template:  ${signal.reasoning}\n`);

  // ── 2. Narrate it 5 ways ─────────────────────────────────────────────────
  const personalities: Personality[] = ['PROFESSOR', 'BRO', 'OWL', 'SAVAGE', 'NERD'];
  for (const personality of personalities) {
    console.log(`────────── ${personality} ──────────`);
    const t0 = Date.now();
    const narration = await narrateSignal(llm, signal, { personality });
    console.log(`(${Date.now() - t0}ms)  ${narration}\n`);
  }

  // ── 3. Multi-language ────────────────────────────────────────────────────
  console.log('────────── 中文 (Mandarin) ──────────');
  console.log(await narrateSignal(llm, signal, { personality: 'PROFESSOR', lang: 'zh' }));
  console.log('\n────────── 日本語 (Japanese) ──────────');
  console.log(await narrateSignal(llm, signal, { personality: 'PROFESSOR', lang: 'ja' }));
  console.log('\n────────── 한국어 (Korean) ──────────');
  console.log(await narrateSignal(llm, signal, { personality: 'PROFESSOR', lang: 'ko' }));

  // ── 4. Multi-asset daily briefing ────────────────────────────────────────
  console.log('\n📰 Daily briefing across BTC + ETH + SOL:');
  const ethSignal = await engine.generate({ asset: 'ETH', riskProfile: 'BALANCED' });
  const solSignal = await engine.generate({ asset: 'SOL', riskProfile: 'BALANCED' });
  const briefing = await dailyBriefing(llm, [signal, ethSignal, solSignal], {
    personality: 'PROFESSOR',
  });
  console.log(briefing);

  console.log('\n✅ All LLM features verified end-to-end.\n');
}

main().catch((err) => {
  console.error('💥 LLM smoke test failed:', err);
  process.exit(1);
});
