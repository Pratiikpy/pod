/**
 * Local dev driver — invoke worker functions from the CLI.
 *
 * Usage:
 *   pnpm --filter @pod/pod-workers dev daily-signal
 *   pnpm --filter @pod/pod-workers dev nav-update <rpcUrl>
 */

import 'dotenv/config';
import { runDailySignal } from './daily-signal.js';
import { runNavUpdate } from './nav-update.js';

async function main() {
  const [, , cmd, ...args] = process.argv;
  if (!cmd) {
    console.error('Usage: tsx src/local.ts <daily-signal|nav-update> [args...]');
    process.exit(2);
  }

  switch (cmd) {
    case 'daily-signal': {
      const result = await runDailySignal();
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    case 'nav-update': {
      const rpcUrl = args[0];
      if (!rpcUrl) throw new Error('rpcUrl arg required');
      const result = await runNavUpdate(rpcUrl);
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    default:
      console.error(`Unknown command: ${cmd}`);
      process.exit(2);
  }
}

main().catch((err) => {
  console.error('💥 worker failed:', err);
  process.exit(1);
});
