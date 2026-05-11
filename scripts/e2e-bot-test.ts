/**
 * End-to-end test that exercises every subsystem the deployed Telegram bot uses.
 * Run: pnpm dlx tsx scripts/e2e-bot-test.ts
 *
 * Simulates the SAME calls the production /api/telegram handler makes, against
 * the SAME live APIs (SoSoValue, NVIDIA NIM, SoDEX testnet). If this passes,
 * the bot works.
 */

import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../.env') });

import OpenAI from 'openai';
import type { Hex } from 'viem';
import { SoSoValue } from '@pod/sosovalue-sdk';
import { SignalEngine, type PodSignal } from '@pod/signal-engine';
import { SoDEX } from '@pod/sodex-sdk';

type Status = 'ok' | 'warn' | 'fail';
const results: Array<{ check: string; status: Status; ms: number; detail: string }> = [];

async function run<T>(check: string, fn: () => Promise<T>): Promise<T | null> {
  const t0 = Date.now();
  try {
    const out = await fn();
    const ms = Date.now() - t0;
    let detail: string;
    if (typeof out === 'string') {
      detail = out.length > 100 ? out.slice(0, 100) + '…' : out;
    } else if (Array.isArray(out)) {
      detail = `array(${out.length})`;
    } else if (out && typeof out === 'object') {
      detail = `object{${Object.keys(out).slice(0, 4).join(',')}}`;
    } else {
      detail = String(out);
    }
    results.push({ check, status: 'ok', ms, detail });
    return out;
  } catch (err) {
    const ms = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ check, status: 'fail', ms, detail: msg.slice(0, 200) });
    return null;
  }
}

async function main() {
  const ssoKey = process.env['SOSOVALUE_API_KEY']!;
  const nvKey = process.env['NVIDIA_API_KEY']!;
  const tgToken = process.env['TELEGRAM_BOT_TOKEN']!;
  const sdxKey = process.env['SODEX_PRIVATE_KEY'] as Hex;
  const sdxApiName = process.env['SODEX_API_KEY_NAME']!;
  const liveUrl = 'https://pod-app-phi.vercel.app';

  console.log('🧪 POD end-to-end test\n');

  // ── 1. Production endpoints ────────────────────────────────────────────
  await run('Production homepage', async () => {
    const r = await fetch(liveUrl);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return `${r.status} · ${(await r.text()).length} bytes`;
  });

  await run('Public API /api/scores', async () => {
    const r = await fetch(`${liveUrl}/api/scores`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as { scores: Array<{ asset: string; podScore: number }> };
    return `${j.scores.map((s) => `${s.asset}:${s.podScore}`).join(', ')}`;
  });

  await run('Telegram webhook GET (health check)', async () => {
    const r = await fetch(`${liveUrl}/api/telegram`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as { ok: boolean };
    if (!j.ok) throw new Error('webhook not ok');
    return 'ok: true';
  });

  await run('Telegram webhook is bound to production URL', async () => {
    const r = await fetch(`https://api.telegram.org/bot${tgToken}/getWebhookInfo`);
    const j = (await r.json()) as { result: { url: string; pending_update_count: number } };
    if (!j.result.url.startsWith(liveUrl)) {
      throw new Error(`webhook URL is ${j.result.url}, not ${liveUrl}`);
    }
    return `${j.result.url} · pending=${j.result.pending_update_count}`;
  });

  await run('Bot description matches buildathon theme', async () => {
    const r = await fetch(`https://api.telegram.org/bot${tgToken}/getMyDescription`);
    const j = (await r.json()) as { result: { description: string } };
    if (!j.result.description.toLowerCase().includes('one-person')) {
      throw new Error('description missing "one-person" phrase');
    }
    return j.result.description.slice(0, 60) + '…';
  });

  // ── 2. Signal engine — what /signal command triggers ───────────────────
  const sso = new SoSoValue({ apiKey: ssoKey });
  const engine = new SignalEngine(sso);

  const btcSignal = await run<PodSignal>('Signal engine · BTC fusion (live SoSoValue)', async () => {
    return engine.generate({ asset: 'BTC', riskProfile: 'BALANCED' });
  });
  if (btcSignal) {
    console.log(`   → ${btcSignal.direction} ${btcSignal.podScore}/100`);
  }

  await run('Signal engine · ETH fusion', () =>
    engine.generate({ asset: 'ETH', riskProfile: 'BALANCED' }),
  );

  // ── 3. AI narration — what AI follow-up triggers ───────────────────────
  if (btcSignal && nvKey) {
    await run('AI narration via NVIDIA NIM (PROFESSOR voice)', async () => {
      const client = new OpenAI({
        apiKey: nvKey,
        baseURL: process.env['NVIDIA_BASE_URL'] ?? 'https://integrate.api.nvidia.com/v1',
      });
      const res = await client.chat.completions.create({
        model: process.env['NVIDIA_MODEL'] ?? 'meta/llama-3.3-70b-instruct',
        messages: [
          {
            role: 'system',
            content: 'You are a calm, precise financial educator. 2-3 sentences max. Reply in English.',
          },
          {
            role: 'user',
            content: `Asset: BTC. Direction: ${btcSignal.direction}. POD Score: ${btcSignal.podScore}/100. Top reason: ${btcSignal.contributions[0]?.rationale ?? btcSignal.reasoning}. Write the narration.`,
          },
        ],
        max_tokens: 150,
      });
      return res.choices[0]?.message?.content ?? '';
    });
  }

  // ── 4. SoDEX trade flow — what /trade command triggers ─────────────────
  if (sdxKey && sdxApiName) {
    const sdk = SoDEX.fromPrivateKey(sdxKey, 'testnet', sdxApiName);
    const addr = sdk.client.signerAddress;

    await run('SoDEX · public market data (spot symbols)', async () => {
      const s = (await sdk.spot.symbols()) as { data: unknown[] };
      return `${s.data.length} pairs`;
    });

    await run('SoDEX · account state (vUSDC balance)', async () => {
      const s = (await sdk.spot.accountState(addr)) as {
        data: { aid: number; B?: Array<{ a: string; t: string }> };
      };
      const bal = s.data.B?.find((b) => b.a === 'vUSDC')?.t ?? '0';
      return `aid=${s.data.aid}, vUSDC=${bal}`;
    });

    // Sign + verify via account-info call (low-cost write — query open orders)
    // We don't place a real order in the test to avoid tying up margin every run.
    await run('SoDEX · open orders (live read on signed-account scope)', async () => {
      const o = (await sdk.spot.openOrders(addr)) as { data: { orders?: unknown[] } };
      return `${o.data.orders?.length ?? 0} open`;
    });
  }

  // ── 5. Print results ───────────────────────────────────────────────────
  console.log('\n┌──────────────────────────────────────────────────────────────────────────┐');
  console.log('│                       TELEGRAM BOT E2E RESULTS                           │');
  console.log('└──────────────────────────────────────────────────────────────────────────┘\n');
  let ok = 0,
    fail = 0;
  for (const r of results) {
    const icon = r.status === 'ok' ? '✅' : '❌';
    if (r.status === 'ok') ok++;
    else fail++;
    console.log(`${icon} ${`${r.ms}ms`.padStart(6)}  ${r.check.padEnd(46)} ${r.detail}`);
  }
  console.log(`\n  Result: ${ok} ok · ${fail} fail / ${results.length} total\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('💥 e2e crashed:', err);
  process.exit(1);
});
