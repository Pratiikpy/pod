import Link from 'next/link';
import { POD } from '@/design/tokens';
import { PodMark } from '@/design/atoms';

export const metadata = {
  title: 'Connect — POD on Telegram',
  description: 'Scan to open the POD bot, or embed a live score badge on your site.',
};

const BOT = 'https://t.me/podttest_bot';

export default function ConnectPage() {
  return (
    <div style={{ minHeight: '100vh', background: POD.ink900, color: POD.ink100, fontFamily: 'Geist, system-ui' }}>
      <NavBar />
      <main style={{ maxWidth: 780, margin: '0 auto', padding: '40px 24px 96px' }}>
        <div style={{ marginBottom: 8, fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: POD.ink400 }}>
          30 seconds to a live score
        </div>
        <h1 style={{ fontFamily: 'Instrument Serif, Georgia, serif', fontSize: 44, fontWeight: 400, margin: '0 0 28px' }}>
          Connect
        </h1>

        <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/qr?text=${encodeURIComponent(BOT)}`} alt="Scan to open POD on Telegram" width={200} height={200} style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)' }} />
            <a href={BOT} style={{ background: POD.lime, color: POD.ink900, padding: '10px 18px', borderRadius: 10, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
              Open @podttest_bot
            </a>
          </div>

          <div style={{ flex: 1, minWidth: 280, display: 'flex', flexDirection: 'column', gap: 22 }}>
            <div>
              <div style={{ fontSize: 13, color: POD.ink400, marginBottom: 6 }}>Deep links (open the bot on a coin)</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {['BTC', 'ETH', 'SOL'].map((s) => (
                  <a key={s} href={`${BOT}?start=score-${s}`} style={{ color: POD.lime, fontSize: 14, textDecoration: 'none', fontFamily: 'ui-monospace, monospace' }}>
                    t.me/podttest_bot?start=score-{s}
                  </a>
                ))}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 13, color: POD.ink400, marginBottom: 6 }}>Embed a live badge on your site</div>
              <pre style={{ background: POD.ink1000, border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '12px 14px', fontSize: 12.5, color: POD.ink200, overflowX: 'auto', margin: 0, fontFamily: 'ui-monospace, monospace' }}>
{`<img src="https://pod-app-phi.vercel.app/api/badge/BTC" alt="POD BTC">`}
              </pre>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/api/badge/BTC" alt="POD BTC badge" style={{ marginTop: 10, height: 28 }} />
            </div>

            <div>
              <div style={{ fontSize: 13, color: POD.ink400, marginBottom: 6 }}>Or read the scores as JSON</div>
              <Link href="/api/scores" style={{ color: POD.lime, fontSize: 14, fontFamily: 'ui-monospace, monospace' }}>
                /api/scores
              </Link>
              <span style={{ color: POD.ink500, fontSize: 13 }}> · </span>
              <Link href="/developers" style={{ color: POD.ink300, fontSize: 14 }}>
                full API
              </Link>
            </div>
          </div>
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
    ['/intel', 'Intel'],
    ['/developers', 'API'],
    ['/connect', 'Connect'],
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
