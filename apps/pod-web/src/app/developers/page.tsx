import Link from 'next/link';
import { POD } from '@/design/tokens';
import { PodMark } from '@/design/atoms';

export const metadata = {
  title: 'POD API — developer reference',
  description: 'Public POD Score API: scores, history, and on-chain receipts.',
};

const ENDPOINTS = [
  {
    method: 'GET',
    path: '/api/scores',
    desc: 'All ten POD Scores from the shared cache — the same numbers the dashboard and bot show.',
    sample: `{
  "generated_at": "2026-07-06T…",
  "scores": [
    { "asset": "BTC", "podScore": 63, "direction": "BUY",
      "compositeZ": 0.55, "sources": 5, "summary": "…" }
  ]
}`,
  },
  {
    method: 'GET',
    path: '/api/history/{symbol}',
    desc: 'Daily POD Score trace for one coin (grows as the daily job records scores).',
    sample: `{ "asset": "BTC", "points": [ { "date": "2026-07-06", "podScore": 63, "compositeZ": 0.55 } ] }`,
  },
  {
    method: 'GET',
    path: '/api/receipt/{symbol}',
    desc: 'Latest on-chain-anchored receipt: the reasoning hash, the ValueChain tx that wrote it, and the explorer link.',
    sample: `{ "asset": "BTC", "receipt": {
  "reasoningHash": "0x32a9…", "onchainTx": "0xcdbd…",
  "explorerUrl": "https://test-scan.valuechain.xyz/tx/0xcdbd…",
  "contract": "0x0723dc7D…876B221B" } }`,
  },
];

const SOURCES = [
  ['ETF flow', 'SoSoValue /etfs/summary-history', '30-day z-score of daily net inflows'],
  ['Macro events', 'SoSoValue /macro/events', 'defensive lean before tier-1 releases'],
  ['News sentiment', 'SoSoValue /news', 'recency-weighted tone of coin-tagged news'],
  ['BTC treasuries', 'SoSoValue /btc-treasuries/{t}/purchase-history', '30-day corporate accumulation'],
  ['Stablecoin liquidity', 'SoSoValue /analyses/stablecoin_total_market_cap', 'z-score of stablecoin supply change'],
  ['Social sentiment', 'CoinGecko /coins/{id}', 'crowd vote (free tier)'],
];

export default function DevelopersPage() {
  return (
    <div style={{ minHeight: '100vh', background: POD.ink900, color: POD.ink100, fontFamily: 'Geist, system-ui' }}>
      <NavBar />
      <main style={{ maxWidth: 820, margin: '0 auto', padding: '40px 24px 96px' }}>
        <div style={{ marginBottom: 8, fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: POD.ink400 }}>
          Public API · no key required
        </div>
        <h1 style={{ fontFamily: 'Instrument Serif, Georgia, serif', fontSize: 44, fontWeight: 400, margin: '0 0 8px' }}>
          POD for developers
        </h1>
        <p style={{ color: POD.ink300, fontSize: 15, margin: '0 0 36px', maxWidth: 620 }}>
          Every POD Score is available as open JSON — no auth, no key. Build on the institutional composite, wire it
          into an agent, or verify a score against the chain.
        </p>

        {ENDPOINTS.map((e) => (
          <section key={e.path} style={{ marginBottom: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: POD.ink900, background: POD.lime, padding: '2px 8px', borderRadius: 6 }}>
                {e.method}
              </span>
              <code style={{ fontSize: 15, fontFamily: 'ui-monospace, monospace', color: POD.ink100 }}>{e.path}</code>
            </div>
            <p style={{ color: POD.ink300, fontSize: 13.5, margin: '0 0 10px' }}>{e.desc}</p>
            <pre
              style={{
                background: POD.ink1000,
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 10,
                padding: '14px 16px',
                fontSize: 12.5,
                color: POD.ink200,
                overflowX: 'auto',
                margin: 0,
                fontFamily: 'ui-monospace, monospace',
              }}
            >
              {e.sample}
            </pre>
          </section>
        ))}

        <h2 style={{ fontFamily: 'Instrument Serif, serif', fontSize: 28, fontWeight: 400, margin: '44px 0 14px' }}>
          The six sources
        </h2>
        <div style={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, overflow: 'hidden' }}>
          {SOURCES.map(([name, cite, what], i) => (
            <div
              key={name}
              style={{
                display: 'grid',
                gridTemplateColumns: '150px 1fr',
                gap: 12,
                padding: '12px 16px',
                borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.05)',
                fontSize: 13,
              }}
            >
              <div style={{ fontWeight: 600 }}>{name}</div>
              <div>
                <div style={{ color: POD.ink300 }}>{what}</div>
                <code style={{ color: POD.ink500, fontSize: 11.5, fontFamily: 'ui-monospace, monospace' }}>{cite}</code>
              </div>
            </div>
          ))}
        </div>

        <p style={{ color: POD.ink500, fontSize: 13, marginTop: 28 }}>
          Rate limits: cached 10 minutes server-side. See{' '}
          <Link href="/how-it-works" style={{ color: POD.lime }}>
            how scores are built
          </Link>{' '}
          for the full method.
        </p>
      </main>
    </div>
  );
}

function NavBar() {
  const links = [
    ['/', 'Live scores'],
    ['/bubbles', 'Bubbles'],
    ['/leaderboard', 'Leaderboard'],
    ['/flows', 'ETF flows'],
    ['/ssi', 'SSI'],
    ['/developers', 'API'],
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
