import Link from 'next/link';
import { fetchMarketIntel } from '@/lib/market-intel';
import { POD } from '@/design/tokens';
import { PodMark } from '@/design/atoms';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Market Intel — sector rotation, unlocks, cycle',
  description: 'Sector rotation, token-unlock radar, and cycle position — the context around the POD Score.',
};

function pct(n: number): string {
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`;
}
function col(n: number): string {
  return n > 0 ? POD.lime : n < 0 ? POD.red : POD.ink400;
}

export default async function IntelPage() {
  const { sectors, unlocks, cycle, equitySectors, recentBuys } = await fetchMarketIntel();
  const topSectors = [...sectors].sort((a, b) => b.change24hPct - a.change24hPct);

  return (
    <div style={{ minHeight: '100vh', background: POD.ink900, color: POD.ink100, fontFamily: 'Geist, system-ui' }}>
      <NavBar />
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px 96px' }}>
        <div style={{ marginBottom: 8, fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: POD.ink400 }}>
          Context around the score
        </div>
        <h1 style={{ fontFamily: 'Instrument Serif, Georgia, serif', fontSize: 44, fontWeight: 400, margin: '0 0 8px' }}>
          Market Intel
        </h1>
        <p style={{ color: POD.ink300, fontSize: 15, margin: '0 0 36px', maxWidth: 640 }}>
          The under-used institutional data that frames a POD Score: which sectors money is rotating into, which coins
          have a supply unlock coming, and where the majors sit in their cycle.
        </p>

        {/* Sector rotation (F6) */}
        <Section title="Sector rotation (24h)">
          {topSectors.length === 0 ? (
            <Empty />
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {topSectors.map((s) => (
                <div key={s.name} style={chip}>
                  <span style={{ fontWeight: 600 }}>{s.name}</span>
                  <span style={{ color: col(s.change24hPct), fontVariantNumeric: 'tabular-nums' }}>{pct(s.change24hPct)}</span>
                  <span style={{ color: POD.ink500, fontSize: 11 }}>{(s.dominance * 100).toFixed(1)}% dom</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Unlock radar (F8) */}
        <Section title="Token unlock radar (next 120 days)">
          {unlocks.length === 0 ? (
            <p style={{ color: POD.ink400, fontSize: 14 }}>No large unlocks detected in the tracked altcoins.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {unlocks.map((u, i) => (
                <div key={`${u.asset}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: POD.ink850, borderRadius: 10, fontSize: 13.5 }}>
                  <span>
                    <span style={{ fontWeight: 600 }}>{u.asset}</span>
                    <span style={{ color: POD.ink400, marginLeft: 10 }}>{u.date}</span>
                  </span>
                  <span style={{ color: POD.amber }}>
                    {u.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })} tokens · in {Math.round(u.daysAway)}d
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Crypto-equity sectors (F7) */}
        <Section title="Crypto-equity sectors (24h)">
          {equitySectors.length === 0 ? (
            <p style={{ color: POD.ink400, fontSize: 14 }}>Crypto-equity data unavailable right now.</p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {equitySectors.map((s) => (
                <div key={s.name} style={chip}>
                  <span style={{ fontWeight: 600 }}>{s.name}</span>
                  <span style={{ color: col(s.change24hPct), fontVariantNumeric: 'tabular-nums' }}>{pct(s.change24hPct)}</span>
                  <span style={{ color: POD.ink500, fontSize: 11 }}>${(s.marketCap / 1e9).toFixed(0)}B</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Corporate BTC accumulation (F9) */}
        <Section title="Corporate BTC buys (last 45 days)">
          {recentBuys.length === 0 ? (
            <p style={{ color: POD.ink400, fontSize: 14 }}>No recent corporate BTC purchases detected.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {recentBuys.map((b, i) => (
                <div key={`${b.ticker}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: POD.ink850, borderRadius: 10, fontSize: 13.5 }}>
                  <span>
                    <span style={{ fontWeight: 600 }}>{b.name}</span>
                    <span style={{ color: POD.ink400, marginLeft: 10 }}>{b.date}</span>
                  </span>
                  <span style={{ color: POD.lime }}>
                    +{Math.round(b.btc).toLocaleString()} BTC{b.usd > 0 ? ` · $${(b.usd / 1e6).toFixed(0)}M` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Cycle position */}
        <Section title="Cycle position">
          {cycle.length === 0 ? (
            <Empty />
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {cycle.map((c) => (
                <div key={c.asset} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '16px 20px', background: POD.ink850, borderRadius: 12, minWidth: 180 }}>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{c.asset}</div>
                  {c.downFromAthPct !== null && (
                    <div style={{ fontSize: 13, color: POD.ink300 }}>
                      {c.downFromAthPct.toFixed(0)}% below ATH
                    </div>
                  )}
                  {c.upFromCycleLowPct !== null && (
                    <div style={{ fontSize: 13, color: POD.lime }}>
                      +{c.upFromCycleLowPct.toFixed(0)}% from cycle low
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>

        <p style={{ color: POD.ink500, fontSize: 12.5, marginTop: 24 }}>
          Source: SoSoValue <code style={{ color: POD.ink400 }}>/currencies/sector-spotlight</code>,{' '}
          <code style={{ color: POD.ink400 }}>/token-economics</code>, and per-coin market snapshots.
        </p>
      </main>
    </div>
  );
}

const chip = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  borderRadius: 10,
  background: POD.ink850,
  border: '1px solid rgba(255,255,255,0.05)',
  fontSize: 13,
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 36 }}>
      <div style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: POD.ink400, marginBottom: 14 }}>{title}</div>
      {children}
    </section>
  );
}
function Empty() {
  return <p style={{ color: POD.ink400, fontSize: 14 }}>Data unavailable right now — try again shortly.</p>;
}

function NavBar() {
  const links = [
    ['/', 'Live scores'],
    ['/bubbles', 'Bubbles'],
    ['/leaderboard', 'Leaderboard'],
    ['/flows', 'ETF flows'],
    ['/ssi', 'SSI'],
    ['/intel', 'Intel'],
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
      <a href="https://t.me/podttest_bot" style={{ background: POD.lime, color: POD.ink900, padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
        Try on Telegram
      </a>
    </nav>
  );
}
