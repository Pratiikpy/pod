import { NextResponse } from 'next/server';
import { BUILDER_ADDRESS, BUILDER_ID, NETWORK } from '@/lib/trade/config';
import { checkBuilderHealth } from '@/lib/trade/health';

/**
 * Is POD's SoDEX builder account funded well enough for new users to approve its fee?
 *
 * SoDEX refuses every new approval while the builder holds less than 100 vUSDC in either engine, so
 * this is the number to watch. It answers 200 when healthy and 503 when not, so an uptime monitor can
 * alert on the status code alone.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const health = await checkBuilderHealth();
  const body = {
    network: NETWORK,
    builderID: BUILDER_ID,
    builderAddress: BUILDER_ADDRESS,
    checkedAt: new Date().toISOString(),
    ...(health ?? { ok: null, spot: null, perps: null, floor: 100 }),
    ...(health ? {} : { note: 'The builder balances could not be read just now.' }),
    ...(health && !health.ok
      ? { note: 'New fee approvals are being refused. Add vUSDC to the builder account in the engine that is below the floor.' }
      : {}),
  };
  return NextResponse.json(body, { status: health && !health.ok ? 503 : 200, headers: { 'cache-control': 'no-store' } });
}
