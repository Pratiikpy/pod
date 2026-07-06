import Link from 'next/link';
import { fetchSsiOverview, type SsiRow } from '@/lib/ssi';
import { POD } from '@/design/tokens';
import { PodMark } from '@/design/atoms';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'SSI Index Co-Pilot — SoSoValue baskets',
  description: 'SoSoValue SSI index baskets ranked by momentum, with the ones tradable on SoDEX.',
};

function pct(n: number | undefined): string {
  if (n === undefined || n === null) return '—';
  const v = n * 100;
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}
function roiColor(n: number | undefined): string {
  if (n === undefined || n === null) return POD.ink500;
  return n > 0 ? POD.lime : n < 0 ? POD.red : POD.ink400;
}

export default async function SsiPage() {
  const { rows, featured } = await fetchSsiOverview();

  return (
    <div style={{ minHeight: '100vh', background: POD.ink900, color: POD.ink100, fontFamily: 'Geist, system-ui' }}>
      <NavBar />
      <main style={{ maxWidth: 960, margin: '0 auto', padding: '40px 24px 96px' }}>
        <div style={{ marginBottom: 8, fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: POD.ink400 }}>
          SoSoValue SSI · {rows.length} baskets
        </div>
        <h1 style={{ fontFamily: 'Instrument Serif, Georgia, serif', fontSize: 44, fontWeight: 400, margin: '0 0 8px' }}>
          SSI Index Co-Pilot
        </h1>
        <p style={{ color: POD.ink300, fontSize: 15, margin: '0 0 32px', maxWidth: 640 }}>
          SoSoValue&apos;s on-chain index baskets, ranked by 7-day momentum. The ones marked{' '}
          <span style={{ color: POD.lime }}>tradable</span> can be bought directly on SoDEX — one token for a whole
          sector. POD reads the basket; SoDEX executes it.
        </p>

        {rows.length === 0 ? (
          <div style={{ color: POD.ink400 }}>SSI data unavailable right now — try again shortly.</div>
        ) : (
          <div style={{ overflowX: 'auto', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
              <thead>
                <tr style={{ background: POD.ink850 }}>
                  <th style={{ ...th, textAlign: 'left' }}>Basket</th>
                  <th style={th}>Level</th>
                  <th style={th}>24h</th>
                  <th style={th}>7d</th>
                  <th style={th}>1m</th>
                  <th style={th}>3m</th>
                  <th style={{ ...th, textAlign: 'right' }}>SoDEX</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: SsiRow) => (
                  <tr key={r.ticker} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ ...td, textAlign: 'left' }}>
                      <span style={{ fontWeight: 600 }}>{r.name}</span>
                      <span style={{ color: POD.ink500, marginLeft: 8, fontSize: 12 }}>{r.ticker}</span>
                    </td>
                    <td style={{ ...td, color: POD.ink200 }}>{r.snapshot ? r.snapshot.price.toFixed(2) : '—'}</td>
                    <td style={{ ...td, color: roiColor(r.snapshot?.change24hPct) }}>{pct(r.snapshot?.change24hPct)}</td>
                    <td style={{ ...td, color: roiColor(r.snapshot?.roi7d), fontWeight: 600 }}>{pct(r.snapshot?.roi7d)}</td>
                    <td style={{ ...td, color: roiColor(r.snapshot?.roi1m) }}>{pct(r.snapshot?.roi1m)}</td>
                    <td style={{ ...td, color: roiColor(r.snapshot?.roi3m) }}>{pct(r.snapshot?.roi3m)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {r.tradablePair ? (
                        <span style={{ color: POD.lime, fontSize: 12, fontWeight: 600 }}>{r.tradablePair}</span>
                      ) : (
                        <span style={{ color: POD.ink600, fontSize: 12 }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {featured && featured.constituents.length > 0 && (
          <section style={{ marginTop: 40 }}>
            <div style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: POD.ink400, marginBottom: 12 }}>
              {featured.name} basket ({featured.ticker})
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {featured.constituents.slice(0, 12).map((c) => (
                <div
                  key={c.currencyId}
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 8,
                    padding: '8px 12px',
                    borderRadius: 10,
                    background: POD.ink850,
                    border: '1px solid rgba(255,255,255,0.05)',
                    fontSize: 13,
                  }}
                >
                  <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{c.symbol.replace(/-/g, ' ')}</span>
                  <span style={{ color: POD.lime, fontVariantNumeric: 'tabular-nums' }}>
                    {(c.weight * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
            <p style={{ color: POD.ink500, fontSize: 12.5, marginTop: 14, maxWidth: 620 }}>
              To replicate this basket on SoDEX, POD sizes each leg to its weight and places the orders — the
              &quot;index co-pilot&quot; path. The one-token version ({featured.ticker}) trades directly where listed.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}

const th = {
  padding: '12px 14px',
  textAlign: 'right' as const,
  fontSize: 12,
  fontWeight: 600,
  color: POD.ink400,
  whiteSpace: 'nowrap' as const,
};
const td = { padding: '11px 14px', textAlign: 'right' as const, whiteSpace: 'nowrap' as const };

function NavBar() {
  const links = [
    ['/', 'Live scores'],
    ['/bubbles', 'Bubbles'],
    ['/leaderboard', 'Leaderboard'],
    ['/flows', 'ETF flows'],
    ['/ssi', 'SSI'],
    ['/how-it-works', 'How it works'],
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
