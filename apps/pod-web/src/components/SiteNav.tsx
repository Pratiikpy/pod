import Link from 'next/link';
import { POD } from '@/design/tokens';
import { PodMark } from '@/design/atoms';

/**
 * The one navigation bar every page uses. Each page previously carried its own
 * copy with a different subset of links, which left /flows, /ssi and /intel
 * reachable but with no way back out to the rest of the product.
 */
const LINKS: ReadonlyArray<readonly [string, string]> = [
  ['/', 'Live scores'],
  ['/bubbles', 'Bubbles'],
  ['/leaderboard', 'Leaderboard'],
  ['/flows', 'ETF flows'],
  ['/ssi', 'SSI'],
  ['/intel', 'Intel'],
  ['/track-record', 'Track record'],
  ['/how-it-works', 'How it works'],
  ['/developers', 'API'],
];

export function SiteNav({ active }: { active?: string }) {
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
        zIndex: 20,
        gap: 16,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, minWidth: 0 }}>
        <Link href="/" style={{ display: 'flex' }} aria-label="POD home">
          <PodMark size={20} />
        </Link>
        <div
          style={{
            fontSize: 13,
            color: POD.ink300,
            display: 'flex',
            gap: 18,
            flexWrap: 'wrap',
          }}
        >
          {LINKS.map(([href, label]) => {
            const isActive = active === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={isActive ? 'page' : undefined}
                style={{
                  color: isActive ? POD.ink50 : POD.ink300,
                  fontWeight: isActive ? 500 : 400,
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </Link>
            );
          })}
        </div>
      </div>
      <a
        href="https://t.me/podttest_bot"
        style={{
          background: POD.lime,
          color: POD.ink900,
          padding: '8px 14px',
          borderRadius: 10,
          fontSize: 13,
          fontWeight: 600,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        Try on Telegram
      </a>
    </nav>
  );
}
