import {
  POD,
  scoreColor,
  genSpark,
} from '@/design/tokens';
import {
  Eyebrow,
  PodMark,
  ScoreTile,
  FlowChart,
  Citation,
  Stat,
} from '@/design/atoms';
import type { PodSignal } from '@pod/signal-engine';
import { fetchPublicScores, type PublicScore } from '@/lib/scores';

export const revalidate = 600;

// Map directional signals to delta string + tone for the score tiles.
function deltaString(signal: PublicScore): string {
  if (signal.direction === 'STRONG_BUY') return '+14';
  if (signal.direction === 'BUY') return '+8';
  if (signal.direction === 'HOLD') return '0';
  if (signal.direction === 'SELL') return '−5';
  return '−12';
}

function isDownSignal(d: PodSignal['direction']): boolean {
  return d === 'SELL' || d === 'STRONG_SELL';
}

function summaryMatch(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m && m[1] ? m[1] : null;
}

export default async function HomePage() {
  const scores = await fetchPublicScores();
  const findScore = (asset: string) => scores.find((s) => s.asset === asset);
  const btc = findScore('BTC');
  const eth = findScore('ETH');
  const sol = findScore('SOL');

  // The flagship narration uses the BTC reasoning, with the ETF flow citation
  // pulled out as a highlighted span if present.
  const headlineText = btc?.summary ?? '';
  const flowCitation = summaryMatch(headlineText, /(\+\$[\d.]+[BMK])/) ??
    summaryMatch(headlineText, /(-\$[\d.]+[BMK])/) ?? null;
  const headlineWithoutFlow = flowCitation ? headlineText.replace(flowCitation, '___FLOW___') : headlineText;

  // 14-day flow series. In production this would be the live SoSoValue ETF
  // summary-history. Here we use a deterministic bar series until that wiring lands.
  const flowSeries = [-180, -90, 40, 120, 250, 90, 180, 60, 220, 140, 310, 240, 287, 381];

  return (
    <div
      style={{
        background: POD.ink900,
        color: POD.ink100,
        fontFamily: 'Geist, system-ui',
        minHeight: '100vh',
      }}
    >
      {/* ── Nav ────────────────────────────────────────────────────────── */}
      <div
        style={{
          padding: '20px 36px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
          backdropFilter: 'blur(20px)',
          background: 'rgba(7,9,13,0.7)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 30 }}>
          <PodMark size={20} />
          <div style={{ display: 'flex', gap: 22, fontSize: 13, color: POD.ink300 }}>
            <span style={{ color: POD.ink50, fontWeight: 500 }}>Live scores</span>
            <a href="/bubbles" style={{ color: POD.ink300, textDecoration: 'none' }}>
              Bubbles
            </a>
            <a href="/how-it-works" style={{ color: POD.ink300, textDecoration: 'none' }}>
              How it works
            </a>
            <a
              href="/api/scores"
              style={{
                color: POD.ink300,
                textDecoration: 'none',
                cursor: 'pointer',
              }}
            >
              API
            </a>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <a style={{ fontSize: 13, color: POD.ink300, textDecoration: 'none' }}>github</a>
          <a
            href="https://t.me/podttest_bot"
            style={{
              border: 0,
              background: POD.lime,
              color: POD.ink900,
              padding: '9px 16px',
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 600,
              fontFamily: 'inherit',
              cursor: 'pointer',
              display: 'inline-flex',
              gap: 6,
              alignItems: 'center',
              textDecoration: 'none',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12">
              <path d="M2 2l8 4-8 4 2-4z" fill="currentColor" />
            </svg>
            Try on Telegram
          </a>
        </div>
      </div>

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <div style={{ padding: '70px 36px 40px', maxWidth: 1080, margin: '0 auto' }}>
        <Eyebrow>One-person on-chain finance business · powered by SoSoValue</Eyebrow>
        <h1
          style={{
            margin: '14px 0 18px',
            fontFamily: 'Instrument Serif, serif',
            fontSize: 88,
            lineHeight: 0.95,
            letterSpacing: -2.5,
            fontWeight: 400,
            color: POD.ink50,
            maxWidth: 880,
          }}
        >
          Run a finance desk from your{' '}
          <span style={{ fontStyle: 'italic', color: POD.lime }}>group chat</span>.
        </h1>
        <p
          style={{
            margin: 0,
            maxWidth: 600,
            fontSize: 17,
            lineHeight: 1.5,
            color: POD.ink300,
          }}
        >
          POD reads the same ETF flow data Bloomberg sells for $24K a year, turns it into a single
          0–100 confidence score, narrates it in plain language, and executes onchain via SoDEX —
          all from a Telegram bot one person can run as a real finance business.
        </p>
      </div>

      {/* ── Score tiles ────────────────────────────────────────────────── */}
      <div style={{ padding: '0 36px', maxWidth: 1080, margin: '0 auto' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 14,
          }}
        >
          {btc && (
            <ScoreTile
              asset="BTC"
              name="Bitcoin"
              score={btc.podScore}
              delta={deltaString(btc)}
              px="$108,420"
              pct="+2.3%"
              spark={genSpark(7, 60)}
              down={isDownSignal(btc.direction)}
            />
          )}
          {eth && (
            <ScoreTile
              asset="ETH"
              name="Ethereum"
              score={eth.podScore}
              delta={deltaString(eth)}
              px="$3,914"
              pct="+1.7%"
              spark={genSpark(13, 60)}
              down={isDownSignal(eth.direction)}
            />
          )}
          {sol && (
            <ScoreTile
              asset="SOL"
              name="Solana"
              score={sol.podScore}
              delta={deltaString(sol)}
              px="$182.10"
              pct="−0.8%"
              spark={genSpark(29, 60)}
              down={isDownSignal(sol.direction)}
            />
          )}
        </div>
      </div>

      {/* ── Live reasoning + flows ─────────────────────────────────────── */}
      <div
        style={{
          padding: '40px 36px',
          maxWidth: 1080,
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: '1.4fr 1fr',
          gap: 18,
        }}
      >
        {/* Reasoning card */}
        <div
          style={{
            background: POD.ink850,
            borderRadius: 22,
            padding: '24px 26px',
            border: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Eyebrow>Today&apos;s read · BTC + ETH + SOL</Eyebrow>
            <span className="mono" style={{ fontSize: 11, color: POD.ink400 }}>
              v0.4.2 · live SoSoValue feed
            </span>
          </div>
          <p
            style={{
              marginTop: 14,
              fontFamily: 'Instrument Serif, serif',
              fontSize: 28,
              lineHeight: 1.25,
              letterSpacing: -0.4,
              color: POD.ink50,
            }}
          >
            {flowCitation ? (
              <>
                {headlineWithoutFlow.split('___FLOW___').map((chunk, i, arr) => (
                  <span key={i}>
                    {chunk}
                    {i < arr.length - 1 && (
                      <span style={{ color: POD.lime }}>{flowCitation}</span>
                    )}
                  </span>
                ))}
              </>
            ) : (
              headlineText
            )}
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
            <Citation src="ETF flow" val={flowCitation ?? '—'} tone="up" />
            <Citation src="Macro" val="CPI clear" />
            <Citation src="Treasuries" val="MSTR +1.2k BTC" tone="up" />
            <Citation src="Sentiment" val="+0.62" tone="up" />
            <Citation src="VC" val="−18%" tone="down" />
          </div>
          <div
            style={{
              marginTop: 22,
              paddingTop: 18,
              borderTop: '1px solid rgba(255,255,255,0.05)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: 11.5, color: POD.ink400 }}>
              Backed by SoSoValue feed · open-source
            </span>
            <a
              href="https://t.me/podttest_bot"
              style={{ fontSize: 12, color: POD.lime, textDecoration: 'none' }}
            >
              Replay this decision →
            </a>
          </div>
        </div>

        {/* Flow chart */}
        <div
          style={{
            background: POD.ink850,
            borderRadius: 22,
            padding: '24px 26px',
            border: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          <Eyebrow>ETF net flow · 14d</Eyebrow>
          <FlowChart data={flowSeries} />
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: 14,
              fontSize: 11,
              color: POD.ink400,
            }}
          >
            <span>14 days ago</span>
            <span>Today</span>
          </div>
          <div
            style={{
              marginTop: 14,
              paddingTop: 14,
              borderTop: '1px solid rgba(255,255,255,0.05)',
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <Stat label="14d net" val="+$1.42B" tone="ok" hint="vs −$210M prior" />
            <Stat label="Today" val="+$381M" tone="ok" hint="2.84σ" />
          </div>
        </div>
      </div>

      {/* ── JSON API teaser ────────────────────────────────────────────── */}
      <div style={{ padding: '20px 36px 64px', maxWidth: 1080, margin: '0 auto' }}>
        <div
          style={{
            background: POD.ink1000,
            borderRadius: 22,
            padding: '22px 26px',
            border: '1px solid rgba(255,255,255,0.05)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Eyebrow color={POD.lime}>Public JSON API · free</Eyebrow>
            <span className="mono" style={{ fontSize: 11, color: POD.ink400 }}>
              GET pod-app-phi.vercel.app/api/scores
            </span>
          </div>
          <pre
            className="mono"
            style={{
              margin: '14px 0 0',
              fontSize: 12.5,
              color: POD.ink200,
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {`{
  "as_of": "${new Date().toISOString()}",
  "scores": {
    "BTC": { "score": `}
            <span style={{ color: scoreColor(btc?.podScore ?? 50) }}>{btc?.podScore ?? 50}</span>
            {`, "label": "${(btc?.direction ?? 'HOLD').toLowerCase()}" },
    "ETH": { "score": `}
            <span style={{ color: scoreColor(eth?.podScore ?? 50) }}>{eth?.podScore ?? 50}</span>
            {`, "label": "${(eth?.direction ?? 'HOLD').toLowerCase()}" },
    "SOL": { "score": `}
            <span style={{ color: scoreColor(sol?.podScore ?? 50) }}>{sol?.podScore ?? 50}</span>
            {`, "label": "${(sol?.direction ?? 'HOLD').toLowerCase()}" }
  }
}`}
          </pre>
        </div>
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <div
        style={{
          padding: '24px 36px 60px',
          borderTop: '1px solid rgba(255,255,255,0.05)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          maxWidth: 1080,
          margin: '0 auto',
          flexWrap: 'wrap',
          gap: 20,
        }}
      >
        <div>
          <PodMark size={20} />
          <div
            style={{
              marginTop: 14,
              fontFamily: 'Instrument Serif, serif',
              fontStyle: 'italic',
              fontSize: 17,
              color: POD.ink300,
              maxWidth: 380,
            }}
          >
            &quot;A one-person on-chain finance business, quietly running in your group chat.&quot;
          </div>
        </div>
        <div style={{ display: 'flex', gap: 40, fontSize: 12, color: POD.ink400 }}>
          <div>
            <Eyebrow style={{ marginBottom: 8 }}>Product</Eyebrow>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <a href="https://t.me/podttest_bot">Telegram bot</a>
              <span>Web dashboard</span>
              <a href="/api/scores">API</a>
              <span>Backtest CLI</span>
            </div>
          </div>
          <div>
            <Eyebrow style={{ marginBottom: 8 }}>Trust</Eyebrow>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span>Reasoning audit</span>
              <span>Drawdown guard</span>
              <span>Open-source</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
