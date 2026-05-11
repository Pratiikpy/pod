import { NextResponse } from 'next/server';
import { SoSoValue, type EtfSymbol } from '@pod/sosovalue-sdk';
import { SignalEngine, type RiskProfile } from '@pod/signal-engine';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const ASSETS: EtfSymbol[] = ['BTC', 'ETH', 'SOL'];
const PROFILES: RiskProfile[] = ['CHILL', 'BALANCED', 'SEND_IT'];

export async function GET(request: Request) {
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET>.
  const cronSecret = process.env['CRON_SECRET'];
  if (cronSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return new NextResponse('Unauthorized', { status: 401 });
    }
  }

  const apiKey = process.env['SOSOVALUE_API_KEY'];
  if (!apiKey) {
    return NextResponse.json({ error: 'SOSOVALUE_API_KEY missing' }, { status: 500 });
  }

  const sso = new SoSoValue({ apiKey });
  const engine = new SignalEngine(sso);

  const signals: Array<{ asset: EtfSymbol; profile: RiskProfile; direction: string; podScore: number; reasoning: string }> = [];
  const errors: Array<{ asset: EtfSymbol; profile: RiskProfile; error: string }> = [];

  for (const asset of ASSETS) {
    for (const profile of PROFILES) {
      try {
        const s = await engine.generate({ asset, riskProfile: profile });
        signals.push({
          asset,
          profile,
          direction: s.direction,
          podScore: s.podScore,
          reasoning: s.reasoning,
        });
      } catch (err) {
        errors.push({
          asset,
          profile,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    signals,
    errors,
  });
}
