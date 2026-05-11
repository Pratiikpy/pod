import { NextResponse } from 'next/server';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * NAV update cron — placeholder until contracts are deployed.
 * Once REASONING_LOGGER_ADDRESS + DRAWDOWN_GUARD_ADDRESS + POD_VAULT_ADDRESSES
 * are set in env, this will iterate vaults and push fresh NAVs to the
 * DrawdownGuard via viem.
 */
export async function GET(request: Request) {
  const cronSecret = process.env['CRON_SECRET'];
  if (cronSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return new NextResponse('Unauthorized', { status: 401 });
    }
  }

  const guard = process.env['DRAWDOWN_GUARD_ADDRESS'];
  const vaults = process.env['POD_VAULT_ADDRESSES'];
  if (!guard || !vaults) {
    return NextResponse.json({
      generated_at: new Date().toISOString(),
      status: 'awaiting_contracts',
      message: 'No deployed vaults yet. Configure DRAWDOWN_GUARD_ADDRESS + POD_VAULT_ADDRESSES.',
    });
  }

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    status: 'ok',
    vaults: vaults.split(',').map((v) => v.trim()),
  });
}
