/**
 * Vercel Function entrypoint for the Telegram webhook.
 * Wire this up at /api/telegram on your deployment, then run:
 *   curl -F "url=https://yourdomain.com/api/telegram" \
 *        https://api.telegram.org/bot<TOKEN>/setWebhook
 */

import { webhookCallback } from 'grammy';
import { loadConfig } from './config.js';
import { SoSoValue } from '@pod/sosovalue-sdk';
import { SignalEngine } from '@pod/signal-engine';
import { createBot } from './bot.js';
import { InMemoryUserStore } from './store.js';

const config = loadConfig();
const sso = new SoSoValue({ apiKey: config.SOSOVALUE_API_KEY });
const signalEngine = new SignalEngine(sso);
const store = new InMemoryUserStore(); // swap to Postgres in prod

const bot = createBot({ config, store, sso, signalEngine });

const webhookOpts: { secretToken?: string } = {};
if (config.TELEGRAM_WEBHOOK_SECRET) {
  webhookOpts.secretToken = config.TELEGRAM_WEBHOOK_SECRET;
}
export const POST = webhookCallback(bot, 'std/http', webhookOpts as { secretToken: string });

export const GET = () => new Response('OK');
