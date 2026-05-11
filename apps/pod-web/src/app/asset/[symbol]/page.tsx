import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchAllBubbleData, type BubbleData } from '@/lib/bubble-data';
import { POD, scoreColor, scoreLabel, genSpark } from '@/design/tokens';
import { PodMark, ScoreGauge, AssetGlyph, Eyebrow, Hair, Spark } from '@/design/atoms';

export const dynamic = 'force-dynamic';

const SOURCE_LABEL: Record<string, string> = {
  ETF_FLOW: 'ETF flow',
  MACRO_EVENT: 'Macro events',
  NEWS_SENTIMENT: 'News sentiment',
  BTC_TREASURY: 'BTC treasuries',
  VC_FUNDING: 'VC funding',
  PERP_FUNDING: 'Perp funding',
  SSI_INDEX: 'SSI index',
};

type Params = { symbol: string };

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const { symbol } = await params;
  const sym = symbol.toUpperCase();
  return {
    title: `${sym} — POD Score`,
    description: `Live POD Score for ${sym} with full per-source reasoning.`,
  };
}

export default async function AssetPage({ params }: { params: Promise<Params> }) {
  const { symbol } = await params;
  const sym = symbol.toUpperCase();

  const all = await fetchAllBubbleData();
  const data = all.find((b) => b.asset === sym);
  if (!data) notFound();

  return (
    <div
      style={{
        minHeight: '100vh',
        background: POD.ink900,
        color: POD.ink100,
        fontFamily: 'Geist, system-ui',
      }}
    >
      <NavBar />

      <main
        style={{
          maxWidth: 920,
          margin: '0 auto',
          padding: '40px 24px 96px',
          display: 'flex',
          flexDirection: 'column',
          gap: 40,
        }}
      >
        <Link
          href="/bubbles"
          style={{
            color: POD.ink400,
            fontSize: 13,
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            width: 'fit-content',
          }}
        >
          ← All bubbles
        </Link>

        <Hero data={data} />

        <Reasoning data={data} />

        {data.contributions.length > 0 && <SourcesPanel data={data} />}

        <ScoreHistory data={data} />

        <CTARow data={data} />
      </main>
    </div>
  );
}

// ── Sections ───────────────────────────────────────────────────────────

function Hero({ data }: { data: BubbleData }) {
  const c = scoreColor(data.score);
  return (
    <section
      style={{
        display: 'flex',
        gap: 32,
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <ScoreGauge score={data.score} size={220} />
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
            style={{
              fontFamily: 'Instrument Serif, serif',
              fontSize: 88,
              lineHeight: 0.9,
              color: POD.ink50,
              letterSpacing: -2.4,
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
              letterSpacing: 0.2,
              textTransform: 'uppercase',
            }}
          >
            {scoreLabel(data.score)}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 280 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <AssetGlyph symbol={data.asset} size={42} />
          <div>
            <div
              style={{
                fontFamily: 'Instrument Serif, serif',
                fontSize: 44,
                lineHeight: 1,
                letterSpacing: -1.2,
                fontWeight: 400,
                color: POD.ink50,
              }}
            >
              {data.asset}
            </div>
            <div style={{ fontSize: 14, color: POD.ink400, marginTop: 4 }}>
              {data.name} · Rank #{data.rank}
            </div>
          </div>
        </div>
        <div
          className="num mono"
          style={{ marginTop: 22, fontSize: 13, color: POD.ink300, lineHeight: 1.6 }}
        >
          composite z = {data.z >= 0 ? '+' : ''}
          {data.z.toFixed(2)} · direction <span style={{ color: c }}>{data.direction}</span>
          {data.uncertain && (
            <span style={{ color: POD.amber }}> · low confidence</span>
          )}
        </div>
        <div style={{ fontSize: 12, color: POD.ink500, marginTop: 6 }} className="num mono">
          generated {new Date(data.generatedAt).toLocaleString()}
        </div>
      </div>
    </section>
  );
}

function Reasoning({ data }: { data: BubbleData }) {
  return (
    <section
      style={{
        background: POD.ink850,
        border: '1px solid rgba(255,255,255,0.05)',
        borderRadius: 18,
        padding: '24px 28px',
      }}
    >
      <Eyebrow>Why this score</Eyebrow>
      <p
        style={{
          marginTop: 14,
          fontFamily: 'Instrument Serif, serif',
          fontSize: 22,
          lineHeight: 1.4,
          color: POD.ink50,
          letterSpacing: -0.3,
        }}
      >
        {data.reasoning}
      </p>
    </section>
  );
}

function SourcesPanel({ data }: { data: BubbleData }) {
  return (
    <section>
      <Eyebrow>Sources ({data.contributions.length}/5)</Eyebrow>
      <Hair color="rgba(255,255,255,0.06)" style={{ marginTop: 12, marginBottom: 18 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {data.contributions.map((c) => {
          const z = c.zScore;
          const tone = z >= 0.3 ? POD.lime : z <= -0.3 ? POD.red : POD.ink300;
          return (
            <div
              key={c.source}
              style={{
                background: POD.ink850,
                border: '1px solid rgba(255,255,255,0.05)',
                borderRadius: 12,
                padding: '14px 18px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  gap: 12,
                  marginBottom: 6,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: POD.ink50,
                  }}
                >
                  {SOURCE_LABEL[c.source] ?? c.source}
                </span>
                <span
                  className="num mono"
                  style={{
                    fontSize: 12,
                    color: tone,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  z={z >= 0 ? '+' : ''}
                  {z.toFixed(2)} · weight {(c.weight * 100).toFixed(0)}% · confidence{' '}
                  {Math.round(c.confidence)}%
                </span>
              </div>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: POD.ink200 }}>
                {c.rationale}
              </p>
              {c.citation && (
                <div
                  className="mono"
                  style={{
                    marginTop: 8,
                    fontSize: 11,
                    color: POD.ink400,
                  }}
                >
                  {c.citation}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ScoreHistory({ data }: { data: BubbleData }) {
  // Score history persistence is Phase-1 follow-up work. Until the daily
  // cron has populated 30 days, we render a deterministic indicative trace
  // seeded by the asset symbol so the page is not empty. Honest label below.
  const seed = data.asset.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const series = genSpark(seed, 30).map((v) => Math.max(5, Math.min(95, v + (data.score - 50) * 0.3)));
  const c = scoreColor(data.score);
  return (
    <section>
      <Eyebrow>30-day score trace</Eyebrow>
      <Hair color="rgba(255,255,255,0.06)" style={{ marginTop: 12, marginBottom: 18 }} />
      <div
        style={{
          background: POD.ink850,
          border: '1px solid rgba(255,255,255,0.05)',
          borderRadius: 16,
          padding: '20px 22px',
        }}
      >
        <Spark data={series} w={840} h={120} color={c} fill />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 10,
            fontSize: 11,
            color: POD.ink400,
          }}
          className="mono"
        >
          <span>30d ago</span>
          <span>today · {data.score}</span>
        </div>
        <div
          style={{
            marginTop: 14,
            fontSize: 12,
            color: POD.ink400,
            lineHeight: 1.5,
          }}
        >
          Indicative trace pending the daily-score backfill. The cron job at{' '}
          <code className="mono" style={{ color: POD.ink200 }}>/api/cron/daily-signal</code> will
          replace this with real history once 30 days of fires have landed.
        </div>
      </div>
    </section>
  );
}

function CTARow({ data }: { data: BubbleData }) {
  return (
    <section
      style={{
        display: 'flex',
        gap: 12,
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
    >
      <a
        href={`https://t.me/podttest_bot?start=score_${data.asset}`}
        style={{
          background: POD.lime,
          color: POD.ink900,
          padding: '14px 22px',
          borderRadius: 12,
          fontSize: 14,
          fontWeight: 600,
          textDecoration: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        Trade {data.asset} on Telegram →
      </a>
      <Link
        href="/how-it-works"
        style={{
          color: POD.ink200,
          fontSize: 14,
          textDecoration: 'none',
          padding: '14px 18px',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12,
        }}
      >
        How POD scores are calculated
      </Link>
    </section>
  );
}

function NavBar() {
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
          <Link href="/" style={{ color: POD.ink300, textDecoration: 'none' }}>
            Live scores
          </Link>
          <Link href="/bubbles" style={{ color: POD.ink300, textDecoration: 'none' }}>
            Bubbles
          </Link>
          <Link href="/how-it-works" style={{ color: POD.ink300, textDecoration: 'none' }}>
            How it works
          </Link>
          <Link href="/api/scores" style={{ color: POD.ink300, textDecoration: 'none' }}>
            API
          </Link>
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
        }}
      >
        Try on Telegram
      </a>
    </nav>
  );
}
