'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import type { BubbleData } from '@/lib/bubble-data';
import { POD, scoreColor, scoreLabel } from '@/design/tokens';
import { ScoreGauge, Citation, Eyebrow, AssetGlyph } from '@/design/atoms';

const SOURCE_LABEL: Record<string, string> = {
  ETF_FLOW: 'ETF flow',
  MACRO_EVENT: 'Macro events',
  NEWS_SENTIMENT: 'News sentiment',
  BTC_TREASURY: 'BTC treasuries',
  VC_FUNDING: 'VC funding',
  SOCIAL_SENTIMENT: 'Social sentiment',
  STABLECOIN_LIQUIDITY: 'Stablecoin liquidity',
  PERP_FUNDING: 'Perp funding',
  SSI_INDEX: 'SSI index',
};

export function BubbleDrawer({
  data,
  onClose,
}: {
  data: BubbleData | null;
  onClose: () => void;
}) {
  // Esc closes drawer; only attaches when open.
  useEffect(() => {
    if (!data) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [data, onClose]);

  if (!data) return null;
  const c = scoreColor(data.score);

  return (
    <>
      {/* Scrim */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(4,6,10,0.55)',
          backdropFilter: 'blur(4px)',
          zIndex: 40,
        }}
      />
      {/* Drawer — desktop side-sheet, mobile bottom-sheet (CSS handled in pod-bubbles.css) */}
      <aside
        className="pod-drawer"
        role="dialog"
        aria-label={`${data.asset} POD score detail`}
        aria-modal="true"
      >
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <AssetGlyph symbol={data.asset} size={36} />
            <div>
              <div style={{ fontSize: 17, fontWeight: 600, color: POD.ink50 }}>{data.asset}</div>
              <div style={{ fontSize: 12, color: POD.ink400 }}>{data.name}</div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              border: 0,
              background: 'rgba(255,255,255,0.06)',
              color: POD.ink200,
              borderRadius: '50%',
              width: 32,
              height: 32,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-label="Close"
          >
            <svg width="11" height="11" viewBox="0 0 11 11">
              <path
                d="M1 1L10 10M10 1L1 10"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* score */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '10px 0 14px',
          }}
        >
          <div style={{ position: 'relative' }}>
            <ScoreGauge score={data.score} size={200} />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div
                className="num"
                style={{
                  fontFamily: 'Instrument Serif, serif',
                  fontSize: 80,
                  lineHeight: 0.9,
                  color: POD.ink50,
                  letterSpacing: -2,
                }}
              >
                {data.score}
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontSize: 11,
                  fontWeight: 500,
                  color: c,
                  letterSpacing: 0.18,
                  textTransform: 'uppercase',
                }}
              >
                {scoreLabel(data.score)}
              </div>
            </div>
          </div>
          <div
            className="num mono"
            style={{ marginTop: 14, fontSize: 12, color: POD.ink400 }}
          >
            composite z = {data.z >= 0 ? '+' : ''}
            {data.z.toFixed(2)}
            {data.uncertain && ' · low confidence'}
          </div>
        </div>

        {/* reasoning */}
        <div
          style={{
            background: POD.ink800,
            borderRadius: 16,
            padding: '16px 18px',
            border: '1px solid rgba(255,255,255,0.04)',
          }}
        >
          <Eyebrow>Why this score</Eyebrow>
          <p
            style={{
              marginTop: 10,
              fontFamily: 'Instrument Serif, serif',
              fontSize: 19,
              lineHeight: 1.32,
              color: POD.ink50,
              letterSpacing: -0.2,
            }}
          >
            {data.reasoning}
          </p>
        </div>

        {/* citations */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Citation
            src="ETF flow"
            val={data.citation.match(/[+-]\$[\d.]+[BMK]/)?.[0] ?? '—'}
            tone={data.score >= 56 ? 'up' : data.score >= 31 ? 'neutral' : 'down'}
          />
          <Citation src="Direction" val={data.direction} tone="neutral" />
          <Citation
            src="Confidence"
            val={data.uncertain ? 'Low' : data.score >= 70 ? 'High' : 'Medium'}
          />
        </div>

        {/* per-source contributions */}
        {data.contributions.length > 0 && (
          <div
            style={{
              background: POD.ink800,
              borderRadius: 16,
              padding: '14px 16px',
              border: '1px solid rgba(255,255,255,0.04)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <Eyebrow>Sources ({data.contributions.filter((c) => c.weight > 0).length}/6)</Eyebrow>
            {data.contributions.map((c) => {
              const label = SOURCE_LABEL[c.source] ?? c.source;
              const z = c.zScore;
              const tone = z >= 0.3 ? POD.lime : z <= -0.3 ? POD.red : POD.ink300;
              return (
                <div
                  key={c.source}
                  style={{ display: 'flex', flexDirection: 'column', gap: 3 }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        textTransform: 'uppercase',
                        letterSpacing: 0.4,
                        color: POD.ink300,
                        fontWeight: 500,
                      }}
                    >
                      {label}
                    </span>
                    <span
                      className="num mono"
                      style={{ fontSize: 11, color: tone, fontVariantNumeric: 'tabular-nums' }}
                    >
                      z={z >= 0 ? '+' : ''}
                      {z.toFixed(2)} · w {(c.weight * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: POD.ink200, lineHeight: 1.4 }}>
                    {c.rationale}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer actions */}
        <div
          style={{
            marginTop: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <Link
            href={`/asset/${data.asset}`}
            style={{
              fontSize: 12,
              color: POD.ink300,
              textDecoration: 'none',
              alignSelf: 'center',
              borderBottom: `1px solid ${POD.ink600}`,
              paddingBottom: 1,
            }}
          >
            View full analysis →
          </Link>
          <a
            href={`https://t.me/podttest_bot?start=score_${data.asset}`}
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 8,
              background: POD.lime,
              color: POD.ink900,
              padding: '14px 0',
              borderRadius: 14,
              fontWeight: 600,
              fontSize: 14,
              textDecoration: 'none',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 12 12">
              <path d="M2 2l8 4-8 4 2-4z" fill="currentColor" />
            </svg>
            Trade {data.asset} on Telegram
          </a>
        </div>
      </aside>
    </>
  );
}
