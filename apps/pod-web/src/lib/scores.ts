import { SoSoValue, type EtfSymbol } from '@pod/sosovalue-sdk';
import { SignalEngine, type SignalDirection } from '@pod/signal-engine';

export interface PublicScore {
  asset: EtfSymbol;
  direction: SignalDirection;
  podScore: number;
  summary: string;
  uncertain: boolean;
  generatedAt: string;
}

const ASSETS: EtfSymbol[] = ['BTC', 'ETH', 'SOL'];

/**
 * Fetches public POD Scores for the homepage. Used by the (revalidating)
 * server component on the index page. Falls back to neutral placeholders
 * if SOSOVALUE_API_KEY isn't configured.
 */
export async function fetchPublicScores(): Promise<PublicScore[]> {
  const apiKey = process.env['SOSOVALUE_API_KEY'];
  if (!apiKey) {
    return ASSETS.map((asset) => ({
      asset,
      direction: 'HOLD' as SignalDirection,
      podScore: 50,
      summary:
        'API key not configured — connect SOSOVALUE_API_KEY to see live scores.',
      uncertain: true,
      generatedAt: new Date().toISOString(),
    }));
  }

  const sso = new SoSoValue({ apiKey });
  const engine = new SignalEngine(sso);

  const out = await Promise.all(
    ASSETS.map(async (asset) => {
      try {
        const signal = await engine.generate({ asset, riskProfile: 'BALANCED' });
        return {
          asset,
          direction: signal.direction,
          podScore: signal.podScore,
          summary: signal.reasoning,
          uncertain: signal.uncertain,
          generatedAt: signal.generated_at,
        };
      } catch (err) {
        console.error(`[fetchPublicScores] ${asset} failed`, err);
        return {
          asset,
          direction: 'HOLD' as SignalDirection,
          podScore: 50,
          summary: 'Score temporarily unavailable.',
          uncertain: true,
          generatedAt: new Date().toISOString(),
        };
      }
    }),
  );
  return out;
}
