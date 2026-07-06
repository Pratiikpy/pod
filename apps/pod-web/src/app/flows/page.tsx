import Link from 'next/link';
import { fetchEtfFlowTable, type AssetFlows } from '@/lib/etf-flows';
import { POD } from '@/design/tokens';
import { PodMark } from '@/design/atoms';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'ETF Flows — daily spot-ETF net flows',
  description: 'Daily spot crypto ETF net inflows and outflows, the institutional demand read.',
};

function fmt(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return n === 0 ? '—' : `${sign}$${abs.toFixed(0)}`;
}

function flowColor(n: number): string {
  if (n > 0) return POD.lime;
  if (n < 0) return POD.red;
  return POD.ink500;
}

function cellFor(a: AssetFlows, date: string): number | null {
  const c = a.cells.find((x) => x.date === date);
  return c ? c.netInflow : null;
}

export default async function FlowsPage() {
  const table = await fetchEtfFlowTable();
  const { dates, assets } = table;

  return (
    <div style={{ minHeight: '100vh', background: POD.ink900, color: POD.ink100, fontFamily: 'Geist, system-ui' }}>
      <NavBar />
      <main style={{ maxWidth: 1000, margin: '0 auto', padding: '40px 24px 96px' }}>
        <div style={{ marginBottom: 8, fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: POD.ink400 }}>
          Spot ETF net flows · US · last {dates.length} days
        </div>
        <h1 style={{ fontFamily: 'Instrument Serif, Georgia, serif', fontSize: 44, fontWeight: 400, margin: '0 0 8px' }}>
          ETF Flows
        </h1>
        <p style={{ color: POD.ink300, fontSize: 15, margin: '0 0 32px', maxWidth: 620 }}>
          Daily net creations and redemptions across US spot crypto ETFs — the money the biggest desks watch every
          morning. Green is money in, red is money out. This is the heaviest input to the POD Score.
        </p>

        {assets.length === 0 || dates.length === 0 ? (
          <div style={{ color: POD.ink400 }}>Flow data unavailable right now — try again shortly.</div>
        ) : (
          <div style={{ overflowX: 'auto', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
              <thead>
                <tr style={{ background: POD.ink850 }}>
                  <th style={{ ...thStyle, textAlign: 'left', position: 'sticky', left: 0, background: POD.ink850 }}>Asset</th>
                  {dates.map((d) => (
                    <th key={d} style={thStyle}>
                      {d.slice(5)}
                    </th>
                  ))}
                  <th style={{ ...thStyle, color: POD.ink200 }}>7d net</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.asset} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ ...tdStyle, textAlign: 'left', position: 'sticky', left: 0, background: POD.ink900 }}>
                      <Link href={`/asset/${a.asset}`} style={{ color: POD.ink100, textDecoration: 'none', fontWeight: 600 }}>
                        {a.asset}
                      </Link>
                      <span style={{ color: POD.ink500, marginLeft: 8, fontWeight: 400 }}>{a.name}</span>
                    </td>
                    {dates.map((d) => {
                      const v = cellFor(a, d);
                      return (
                        <td key={d} style={{ ...tdStyle, color: v === null ? POD.ink600 : flowColor(v) }}>
                          {v === null ? '·' : fmt(v)}
                        </td>
                      );
                    })}
                    <td style={{ ...tdStyle, color: flowColor(a.cum7d), fontWeight: 700 }}>{fmt(a.cum7d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: 20, fontSize: 12, color: POD.ink500 }}>
          Source: SoSoValue <code style={{ color: POD.ink400 }}>/etfs/summary-history</code>. Positive = net creations
          (institutional buying), negative = net redemptions.
        </div>
      </main>
    </div>
  );
}

const thStyle = {
  padding: '12px 14px',
  textAlign: 'right' as const,
  fontSize: 12,
  fontWeight: 600,
  color: POD.ink400,
  whiteSpace: 'nowrap' as const,
};
const tdStyle = {
  padding: '11px 14px',
  textAlign: 'right' as const,
  whiteSpace: 'nowrap' as const,
};

function NavBar() {
  const links = [
    ['/', 'Live scores'],
    ['/bubbles', 'Bubbles'],
    ['/leaderboard', 'Leaderboard'],
    ['/flows', 'ETF flows'],
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
