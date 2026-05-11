/**
 * Vercel Function entrypoint for the daily-signal cron job.
 *
 * Configure in vercel.ts:
 *   crons: [{ path: '/api/cron/daily-signal', schedule: '0 4 * * *' }]
 */

import { runDailySignal } from './daily-signal.js';
import { loadWorkerConfig } from './config.js';

export const GET = async (request: Request): Promise<Response> => {
  const cfg = loadWorkerConfig();
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET>.
  if (cfg.CRON_SECRET) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cfg.CRON_SECRET}`) {
      return new Response('Unauthorized', { status: 401 });
    }
  }
  const result = await runDailySignal();
  return Response.json(result);
};

export { runDailySignal } from './daily-signal.js';
export { runNavUpdate } from './nav-update.js';
