'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BubbleCanvas } from '@/components/BubbleCanvas';
import { BubbleDrawer } from '@/components/BubbleDrawer';
import type { BubbleData } from '@/lib/bubble-data';
import { POD } from '@/design/tokens';
import { PodMark, Eyebrow } from '@/design/atoms';

export function BubblesClient({ bubbles }: { bubbles: BubbleData[] }) {
  const [selected, setSelected] = useState<BubbleData | null>(null);

  const allFallback = bubbles.length > 0 && bubbles.every((b) => b.citation === 'No live data');

  return (
    <div
      style={{
        minHeight: '100vh',
        background: POD.ink900,
        color: POD.ink100,
        fontFamily: 'Geist, system-ui',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '14px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          backdropFilter: 'blur(20px)',
          background: 'rgba(7,9,13,0.7)',
          zIndex: 5,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <Link href="/" style={{ display: 'flex' }}>
            <PodMark size={20} />
          </Link>
          <div style={{ fontSize: 13, color: POD.ink300, display: 'flex', gap: 18 }}>
            <Link href="/" style={{ color: POD.ink300, textDecoration: 'none' }}>
              Live scores
            </Link>
            <span style={{ color: POD.ink50, fontWeight: 500 }}>Bubbles</span>
            <Link href="/how-it-works" style={{ color: POD.ink300, textDecoration: 'none' }}>
              How it works
            </Link>
            <Link href="/api/scores" style={{ color: POD.ink300, textDecoration: 'none' }}>
              API
            </Link>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Eyebrow color={POD.ink400}>10 ETF assets · live</Eyebrow>
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
              display: 'inline-flex',
              gap: 6,
              alignItems: 'center',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12">
              <path d="M2 2l8 4-8 4 2-4z" fill="currentColor" />
            </svg>
            Try on Telegram
          </a>
        </div>
      </div>

      {/* Honest banner when SoSoValue can't be reached */}
      {allFallback && (
        <div
          role="status"
          style={{
            padding: '10px 24px',
            background: 'rgba(232, 162, 58, 0.08)',
            borderBottom: '1px solid rgba(232, 162, 58, 0.2)',
            color: POD.amber,
            fontSize: 12.5,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <span>
            Live data unavailable — showing neutral scores. SoSoValue is rate-limited or
            unreachable.
          </span>
          <a
            href="/bubbles"
            style={{
              color: POD.amber,
              textDecoration: 'underline',
              textUnderlineOffset: 2,
            }}
          >
            Retry
          </a>
        </div>
      )}

      {/* Title strip */}
      <div
        style={{
          padding: '24px 36px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: 'Instrument Serif, serif',
              fontSize: 44,
              lineHeight: 1,
              letterSpacing: -1,
              fontWeight: 400,
              color: POD.ink50,
            }}
          >
            POD Bubbles
          </h1>
          <p style={{ marginTop: 8, fontSize: 14, color: POD.ink400, maxWidth: 580 }}>
            Each bubble is a crypto with a spot ETF. <span style={{ color: POD.lime }}>Color</span>{' '}
            = today&apos;s POD Score. Size = market rank. <span style={{ color: POD.lime }}>Pulse</span>{' '}
            = how unusual the institutional flow is. Click for the full reasoning.
          </p>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 14, fontSize: 11 }}>
          <Legend dot={POD.red} label="Defensive · 0–30" />
          <Legend dot={POD.amber} label="Mixed · 31–55" />
          <Legend dot={POD.limeSoft} label="Constructive · 56–80" />
          <Legend dot={POD.lime} label="Conviction · 81–100" />
        </div>
      </div>

      {/* Canvas */}
      <div style={{ flex: 1, position: 'relative', minHeight: 600 }}>
        <BubbleCanvas bubbles={bubbles} onSelect={setSelected} />
        {/* Keyboard + screen-reader fallback. Visually hidden until focused. */}
        <ul
          className="pod-bubbles-fallback"
          aria-label="POD scores by asset"
        >
          {bubbles.map((b) => (
            <li key={b.asset}>
              <button
                type="button"
                onClick={() => setSelected(b)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelected(b);
                  }
                }}
              >
                {b.asset} {b.name} — POD score {b.score}, direction {b.direction}
                {b.uncertain ? ', low confidence' : ''}.
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Footer */}
      <footer
        style={{
          padding: '20px 32px',
          borderTop: '1px solid rgba(255,255,255,0.05)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          fontSize: 12,
          color: POD.ink500,
          background: POD.ink900,
        }}
      >
        <div style={{ display: 'flex', gap: 16, color: POD.ink400, flexWrap: 'wrap' }}>
          <Link href="/how-it-works" style={{ color: POD.ink400, textDecoration: 'none' }}>
            How POD scores are calculated
          </Link>
          <Link href="/api/scores" style={{ color: POD.ink400, textDecoration: 'none' }}>
            Raw API
          </Link>
          <a
            href="https://github.com/Pratiikpy/Stealth-AP"
            style={{ color: POD.ink400, textDecoration: 'none' }}
          >
            Source
          </a>
        </div>
        <span>SoSoValue Buildathon · MIT</span>
      </footer>

      {/* Drawer */}
      <BubbleDrawer data={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: POD.ink300 }}>
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: '50%',
          background: dot,
          boxShadow: `0 0 10px ${dot}80`,
        }}
      />
      {label}
    </div>
  );
}
