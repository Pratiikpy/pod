import type { CSSProperties, ReactNode } from 'react';
import { POD, scoreColor, scoreLabel } from './tokens';

// ── Eyebrow — tracked uppercase tag ──────────────────────────────────────

export function Eyebrow({
  children,
  color = POD.ink300,
  style = {},
}: {
  children: ReactNode;
  color?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        fontFamily: 'Geist, system-ui',
        fontSize: 10.5,
        fontWeight: 500,
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        color,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ── Hairline divider ─────────────────────────────────────────────────────

export function Hair({
  color = 'rgba(255,255,255,0.07)',
  style = {},
}: {
  color?: string;
  style?: CSSProperties;
}) {
  return <div style={{ height: 1, background: color, ...style }} />;
}

// ── PodMark — capsule + signal dot + italic serif "pod" ──────────────────

export function PodMark({ size = 18, color = POD.ink50 }: { size?: number; color?: string }) {
  const markH = size * 0.95;
  const markW = markH * 1.85;
  const r = markH / 2;
  const cx = markW - r * 0.55;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: size * 0.34,
        color,
        lineHeight: 1,
      }}
    >
      <svg width={markW} height={markH} viewBox={`0 0 ${markW} ${markH}`} style={{ display: 'block' }}>
        <rect x={0} y={0} width={markW} height={markH} rx={r} fill={POD.lime} />
        <circle cx={cx} cy={r} r={r * 0.32} fill={POD.ink900} />
      </svg>
      <span
        style={{
          fontFamily: 'Instrument Serif, serif',
          fontStyle: 'italic',
          fontSize: size * 1.15,
          letterSpacing: -size * 0.03,
          fontWeight: 400,
          lineHeight: 0.92,
        }}
      >
        pod
      </span>
    </span>
  );
}

// ── ScoreGauge — dotted ring with glow ───────────────────────────────────

export function ScoreGauge({
  score = 78,
  size = 220,
  dark = true,
}: {
  score?: number;
  size?: number;
  dark?: boolean;
}) {
  const r = size / 2 - 18;
  const c = size / 2;
  const dots = 64;
  const filled = Math.round((score / 100) * dots);
  const col = scoreColor(score);
  const gradId = `gau-glow-${size}-${score}`;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      <defs>
        <radialGradient id={gradId}>
          <stop offset="0%" stopColor={col} stopOpacity="0.5" />
          <stop offset="60%" stopColor={col} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={c} cy={c} r={r + 12} fill={`url(#${gradId})`} opacity="0.5" />
      {Array.from({ length: dots }).map((_, i) => {
        const angle = (i / dots) * Math.PI * 2 - Math.PI / 2;
        const x1 = c + Math.cos(angle) * (r - 6);
        const y1 = c + Math.sin(angle) * (r - 6);
        const x2 = c + Math.cos(angle) * (r + 6);
        const y2 = c + Math.sin(angle) * (r + 6);
        const on = i < filled;
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={on ? col : dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}
            strokeWidth={on ? 2.5 : 1.5}
            strokeLinecap="round"
            opacity={on ? 0.4 + (i / Math.max(filled, 1)) * 0.6 : 1}
          />
        );
      })}
    </svg>
  );
}

// ── Spark — sparkline area + line ────────────────────────────────────────

export function Spark({
  data,
  w = 100,
  h = 28,
  color = POD.lime,
  fill = true,
}: {
  data: number[];
  w?: number;
  h?: number;
  color?: string;
  fill?: boolean;
}) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / (max - min || 1)) * h;
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ display: 'block', overflow: 'visible' }}
    >
      {fill && <path d={area} fill={color} opacity={0.13} />}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── AssetGlyph — tinted circle with letter ───────────────────────────────

export function AssetGlyph({ symbol, size = 24 }: { symbol: string; size?: number }) {
  const map: Record<string, { bg: string; fg: string; g: string }> = {
    BTC: { bg: '#F7931A', fg: '#fff', g: 'B' },
    ETH: { bg: '#627EEA', fg: '#fff', g: 'Ξ' },
    SOL: { bg: 'linear-gradient(135deg,#9945FF,#14F195)', fg: '#000', g: 'S' },
    USDC: { bg: '#2775CA', fg: '#fff', g: '$' },
  };
  const m = map[symbol] ?? { bg: POD.ink600, fg: POD.ink100, g: '?' };
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: m.bg,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Geist, system-ui',
        fontSize: size * 0.5,
        fontWeight: 700,
        color: m.fg,
        flexShrink: 0,
      }}
    >
      {m.g}
    </div>
  );
}

// ── Citation — pill with src · value ─────────────────────────────────────

export function Citation({
  src,
  val,
  tone = 'neutral',
}: {
  src: string;
  val: string;
  tone?: 'up' | 'down' | 'neutral';
}) {
  const c = tone === 'up' ? POD.lime : tone === 'down' ? POD.red : POD.ink200;
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '6px 11px 6px 9px',
        background: 'rgba(255,255,255,0.04)',
        borderRadius: 99,
        fontSize: 11.5,
      }}
    >
      <span style={{ color: POD.ink400, fontFamily: 'Geist', fontWeight: 500 }}>{src}</span>
      <span className="num mono" style={{ color: c, fontWeight: 500 }}>
        {val}
      </span>
    </div>
  );
}

// ── Stat — label / value / hint vertical block ───────────────────────────

export function Stat({
  label,
  val,
  hint,
  tone = 'neutral',
}: {
  label: string;
  val: string;
  hint?: string;
  tone?: 'ok' | 'down' | 'neutral';
}) {
  const c = tone === 'ok' ? POD.lime : tone === 'down' ? POD.red : POD.ink100;
  return (
    <div>
      <Eyebrow>{label}</Eyebrow>
      <div
        className="num"
        style={{
          fontFamily: 'Instrument Serif, serif',
          fontSize: 26,
          color: c,
          marginTop: 6,
          letterSpacing: -0.4,
        }}
      >
        {val}
      </div>
      {hint && (
        <div className="mono" style={{ fontSize: 11, color: POD.ink400, marginTop: 2 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

// ── ScoreTile — per-asset card on the dashboard ──────────────────────────

export function ScoreTile({
  asset,
  name,
  score,
  delta,
  px,
  pct,
  spark,
  down = false,
}: {
  asset: string;
  name: string;
  score: number;
  delta: string;
  px: string;
  pct: string;
  spark: number[];
  down?: boolean;
}) {
  const c = scoreColor(score);
  return (
    <div
      style={{
        background: POD.ink850,
        borderRadius: 22,
        padding: '22px 24px',
        border: '1px solid rgba(255,255,255,0.05)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <AssetGlyph symbol={asset} size={32} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: POD.ink50 }}>{asset}</div>
            <div style={{ fontSize: 11, color: POD.ink400 }}>{name}</div>
          </div>
        </div>
        <ScoreGauge score={score} size={64} />
      </div>
      <div
        className="num"
        style={{
          fontFamily: 'Instrument Serif, serif',
          fontSize: 64,
          lineHeight: 1,
          marginTop: 14,
          letterSpacing: -1.6,
          color: c,
          fontWeight: 400,
        }}
      >
        {score}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginTop: 4,
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: POD.ink300,
            textTransform: 'uppercase',
            letterSpacing: 0.3,
          }}
        >
          {scoreLabel(score)}
        </span>
        <span className="num mono" style={{ fontSize: 12, color: c }}>
          {delta}
        </span>
      </div>
      <div style={{ marginTop: 14 }}>
        <Spark data={spark} w={300} h={36} color={down ? POD.red : POD.lime} />
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 10,
          fontSize: 11,
          color: POD.ink300,
        }}
      >
        <span className="num mono">{px}</span>
        <span className="num mono" style={{ color: down ? POD.red : POD.lime }}>
          {pct}
        </span>
      </div>
    </div>
  );
}

// ── FlowChart — 14d ETF net flow bars ────────────────────────────────────

export function FlowChart({ data }: { data: number[] }) {
  const max = Math.max(...data.map(Math.abs)) || 1;
  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        alignItems: 'center',
        height: 120,
        marginTop: 12,
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: 0,
          right: 0,
          height: 1,
          background: 'rgba(255,255,255,0.08)',
        }}
      />
      {data.map((v, i) => {
        const h = (Math.abs(v) / max) * 50;
        const up = v >= 0;
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end' }}>
              {up && (
                <div
                  style={{
                    width: '100%',
                    height: `${h}%`,
                    background: POD.lime,
                    opacity: 0.4 + (i / data.length) * 0.6,
                    borderRadius: '2px 2px 0 0',
                  }}
                />
              )}
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start' }}>
              {!up && (
                <div
                  style={{
                    width: '100%',
                    height: `${h}%`,
                    background: POD.red,
                    opacity: 0.5,
                    borderRadius: '0 0 2px 2px',
                  }}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
