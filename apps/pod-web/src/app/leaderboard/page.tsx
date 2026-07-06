import Link from 'next/link';
import { fetchAllBubbleData } from '@/lib/bubble-data';
import { POD, scoreColor, scoreLabel } from '@/design/tokens';
import { PodMark, AssetGlyph } from '@/design/atoms';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'POD Leaderboard — 10 ETF coins ranked',
  description: 'All ten spot-ETF coins ranked by live POD Score.',
};

export default async function LeaderboardPage() {
  const rows = [...(await fetchAllBubbleData())].sort((a, b) => b.score - a.score);

  return (
    <div style={{ minHeight: '100vh', background: POD.ink900, color: POD.ink100, fontFamily: 'Geist, system-ui' }}>
      <NavBar />
      <main style={{ maxWidth: 860, margin: '0 auto', padding: '40px 24px 96px' }}>
        <div style={{ marginBottom: 8, fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: POD.ink400 }}>
          10 ETF assets · ranked live
        </div>
        <h1 style={{ fontFamily: 'Instrument Serif, Georgia, serif', fontSize: 44, fontWeight: 400, margin: '0 0 8px' }}>
          POD Leaderboard
        </h1>
        <p style={{ color: POD.ink300, fontSize: 15, margin: '0 0 32px', maxWidth: 560 }}>
          Every coin with a spot ETF, ranked by today&apos;s POD Score — the institutional read on where money is
          leaning. Click any row for the full reasoning.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((b, i) => {
            const color = scoreColor(b.score);
            return (
              <Link
                key={b.asset}
                href={`/asset/${b.asset}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '28px 34px 1fr auto',
                  alignItems: 'center',
                  gap: 16,
                  padding: '16px 18px',
                  borderRadius: 14,
                  background: POD.ink850,
                  border: '1px solid rgba(255,255,255,0.05)',
                  textDecoration: 'none',
                  color: POD.ink100,
                }}
              >
                <div style={{ fontSize: 14, color: POD.ink400, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
                  {i + 1}
                </div>
                <AssetGlyph symbol={b.asset} size={34} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>{b.asset}</span>
                    <span style={{ color: POD.ink400, fontSize: 13 }}>{b.name}</span>
                    <span style={{ color, fontSize: 12, fontWeight: 600 }}>
                      {scoreLabel(b.score)}
                    </span>
                    {b.uncertain && (
                      <span style={{ color: POD.ink500, fontSize: 11 }}>low confidence</span>
                    )}
                  </div>
                  <div
                    style={{
                      color: POD.ink400,
                      fontSize: 12.5,
                      marginTop: 3,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: 460,
                    }}
                  >
                    {b.reasoning}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 26, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                    {b.score}
                  </div>
                  <div style={{ fontSize: 11, color: POD.ink500, marginTop: 2 }}>
                    {b.direction.replace('_', ' ').toLowerCase()}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        <div style={{ marginTop: 28, display: 'flex', gap: 18, fontSize: 13 }}>
          <Link href="/bubbles" style={{ color: POD.lime, textDecoration: 'none' }}>
            View as bubbles →
          </Link>
          <Link href="/how-it-works" style={{ color: POD.ink400, textDecoration: 'none' }}>
            How scores are built
          </Link>
        </div>
      </main>
    </div>
  );
}

function NavBar() {
  const links = [
    ['/', 'Live scores'],
    ['/bubbles', 'Bubbles'],
    ['/leaderboard', 'Leaderboard'],
    ['/how-it-works', 'How it works'],
    ['/api/scores', 'API'],
  ] as const;
  return (
    <nav
      style={{
        padding: '14px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        backdropFilter: 'blur(20px)',
        background: 'rgba(7,9,13,0.7)',
        position: 'sticky',
        top: 0,
        zIndex: 5,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <Link href="/" style={{ display: 'flex' }}>
          <PodMark size={20} />
        </Link>
        <div style={{ fontSize: 13, color: POD.ink300, display: 'flex', gap: 18 }}>
          {links.map(([href, label]) => (
            <Link key={href} href={href} style={{ color: POD.ink300, textDecoration: 'none' }}>
              {label}
            </Link>
          ))}
        </div>
      </div>
      <a
        href="https://t.me/podttest_bot"
        style={{ background: POD.lime, color: POD.ink900, padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}
      >
        Try on Telegram
      </a>
    </nav>
  );
}
