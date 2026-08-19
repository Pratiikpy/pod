import Link from 'next/link';
import { getTrackRecordStats, getScoreHistory } from '@/lib/db';
import { fetchAllBubbleData } from '@/lib/bubble-data';
import { POD, scoreColor } from '@/design/tokens';
import { PodMark } from '@/design/atoms';
import { SiteNav } from '@/components/SiteNav';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'POD Track Record — every score, anchored on-chain',
  description: 'Every POD Score is recorded and hash-anchored on ValueChain. Honest performance accrues over time.',
};

export default async function TrackRecordPage() {
  const [stats, bubbles] = await Promise.all([getTrackRecordStats(), fetchAllBubbleData()]);
  const btcHistory = await getScoreHistory('BTC', 30);

  const stat = (label: string, value: string | number, sub?: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '20px 22px', background: POD.ink850, borderRadius: 14, border: '1px solid rgba(255,255,255,0.05)', minWidth: 160 }}>
      <div style={{ fontSize: 34, fontWeight: 700, color: POD.ink50, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 13, color: POD.ink400 }}>{label}</div>
      {sub && <div style={{ fontSize: 11.5, color: POD.ink500 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: POD.ink900, color: POD.ink100, fontFamily: 'Geist, system-ui' }}>
      <SiteNav active="/track-record" />
      <main style={{ maxWidth: 860, margin: '0 auto', padding: '40px 24px 96px' }}>
        <div style={{ marginBottom: 8, fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: POD.ink400 }}>
          Verifiable · on-chain
        </div>
        <h1 style={{ fontFamily: 'Instrument Serif, Georgia, serif', fontSize: 44, fontWeight: 400, margin: '0 0 8px' }}>
          Track record
        </h1>
        <p style={{ color: POD.ink300, fontSize: 15, margin: '0 0 32px', maxWidth: 640 }}>
          Every POD Score is recorded and a hash of its data is anchored on ValueChain, so the record can&apos;t be
          quietly edited. Honest hit-rate accrues as the daily job runs — no cherry-picking.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 40 }}>
          {stat('Scores recorded', stats.totalScores)}
          {stat('Anchored on-chain', stats.anchoredOnChain, 'ReasoningLogger / ValueChain')}
          {stat('Days of history', stats.distinctDays, stats.firstDate ? `since ${stats.firstDate}` : undefined)}
          {stat('Coins tracked', bubbles.length)}
        </div>

        <h2 style={{ fontFamily: 'Instrument Serif, serif', fontSize: 26, fontWeight: 400, margin: '0 0 14px' }}>
          BTC score trace
        </h2>
        {btcHistory.length > 1 ? (
          <Sparkline points={btcHistory.map((h) => h.podScore)} />
        ) : (
          <p style={{ color: POD.ink400, fontSize: 14 }}>
            The trace fills in as the daily job records scores. {btcHistory.length} point(s) so far.
          </p>
        )}

        <p style={{ color: POD.ink500, fontSize: 13, marginTop: 30, maxWidth: 640 }}>
          Why this matters: a signal you can&apos;t verify after the fact is a marketing claim. POD writes the hash
          first, so the score you see today is the score anyone can check tomorrow. See any coin&apos;s receipt on its{' '}
          <Link href="/leaderboard" style={{ color: POD.lime }}>
            page
          </Link>
          .
        </p>
      </main>
    </div>
  );
}

function Sparkline({ points }: { points: number[] }) {
  const w = 640;
  const h = 120;
  const max = Math.max(...points, 100);
  const min = Math.min(...points, 0);
  const range = max - min || 1;
  const step = w / Math.max(points.length - 1, 1);
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(1)} ${(h - ((p - min) / range) * h).toFixed(1)}`)
    .join(' ');
  const last = points[points.length - 1] ?? 50;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} style={{ maxWidth: w }}>
      <path d={path} fill="none" stroke={scoreColor(last)} strokeWidth={2} />
    </svg>
  );
}


