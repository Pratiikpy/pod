import { SoSoValue, type EtfSymbol } from '@pod/sosovalue-sdk';
import { SignalEngine, type RiskProfile, type PodSignal } from '@pod/signal-engine';
import { loadWorkerConfig } from './config.js';

const SUPPORTED: EtfSymbol[] = ['BTC', 'ETH', 'SOL'];
const PROFILES: RiskProfile[] = ['CHILL', 'BALANCED', 'SEND_IT'];

export interface DailySignalRunResult {
  generatedAt: string;
  signals: Array<{ asset: EtfSymbol; profile: RiskProfile; signal: PodSignal }>;
  errors: Array<{ asset: EtfSymbol; profile: RiskProfile; error: string }>;
}

/**
 * Runs the signal engine for every (asset × risk profile) combo.
 * Designed to be invoked once per day at 04:00 UTC by Vercel Cron.
 */
export async function runDailySignal(): Promise<DailySignalRunResult> {
  const config = loadWorkerConfig();
  const sso = new SoSoValue({ apiKey: config.SOSOVALUE_API_KEY });
  const engine = new SignalEngine(sso);

  const signals: DailySignalRunResult['signals'] = [];
  const errors: DailySignalRunResult['errors'] = [];

  for (const asset of SUPPORTED) {
    for (const profile of PROFILES) {
      try {
        const signal = await engine.generate({ asset, riskProfile: profile });
        signals.push({ asset, profile, signal });
        console.log(
          `[daily-signal] ${asset}/${profile}: ${signal.direction} (${signal.podScore}/100, z=${signal.compositeZ.toFixed(2)})`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ asset, profile, error: msg });
        console.error(`[daily-signal] ${asset}/${profile} failed:`, msg);
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    signals,
    errors,
  };
}
