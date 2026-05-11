import Link from 'next/link';
import { POD } from '@/design/tokens';
import { PodMark, Eyebrow, Hair } from '@/design/atoms';

export const metadata = {
  title: 'How POD scores are calculated · POD',
  description:
    'POD scores combine five SoSoValue data sources into one number. This page documents the math, the weights, and the limits.',
};

const SOURCES = [
  {
    key: 'ETF_FLOW',
    label: 'ETF flow',
    weight: 0.40,
    api: '/etfs/summary-history',
    measures:
      'Daily net inflow / outflow on spot crypto ETFs. Compares latest day against the trailing 30-day mean and standard deviation.',
    why:
      'ETF flow is the cleanest measure of institutional appetite. A single $300M outflow day matters more than a thousand retail tweets.',
  },
  {
    key: 'MACRO_EVENT',
    label: 'Macro events',
    weight: 0.20,
    api: '/macro/events',
    measures:
      'Tier-1 macro events (FOMC, CPI, NFP) scheduled in the next 48 hours. Pre-positions defensively when a high-impact print is imminent.',
    why:
      'Even a strong asset-specific signal gets overruled when an FOMC print is 6 hours away. POD respects that.',
  },
  {
    key: 'NEWS_SENTIMENT',
    label: 'News sentiment',
    weight: 0.15,
    api: '/news',
    measures:
      'Recent featured news per asset, scored for sentiment polarity and confidence. Decays exponentially with age.',
    why:
      'Headlines are noisy. They get the smallest weight, but a unanimous sentiment shift across 20 stories matters.',
  },
  {
    key: 'BTC_TREASURY',
    label: 'BTC treasuries',
    weight: 0.20,
    api: '/btc-treasuries',
    measures:
      'Velocity of public-company BTC purchases over the last 30 days. Rising = real fiduciary capital deploying. Applies to BTC; passes through 0 for other assets.',
    why:
      'When MicroStrategy or a sovereign buys $500M of BTC, that is patient capital. The signal is slow but stickier than ETF flow.',
  },
  {
    key: 'VC_FUNDING',
    label: 'VC funding',
    weight: 0.05,
    api: '/fundraising/list',
    measures:
      'VC capital deployed into crypto sectors over the last 30 days vs the prior 30 days. Cycle indicator.',
    why:
      'Fundraising leads narratives by months. Small weight because it is structural, not tactical.',
  },
] as const;

export default function HowItWorks() {
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
          maxWidth: 880,
          margin: '0 auto',
          padding: '48px 32px 96px',
          display: 'flex',
          flexDirection: 'column',
          gap: 56,
        }}
      >
        {/* Hero */}
        <section>
          <Eyebrow color={POD.ink400}>The math</Eyebrow>
          <h1
            style={{
              marginTop: 12,
              fontFamily: 'Instrument Serif, serif',
              fontSize: 56,
              lineHeight: 1.05,
              letterSpacing: -1.4,
              fontWeight: 400,
              color: POD.ink50,
            }}
          >
            How POD scores are calculated.
          </h1>
          <p
            style={{
              marginTop: 18,
              fontSize: 17,
              lineHeight: 1.55,
              color: POD.ink200,
              maxWidth: 640,
            }}
          >
            POD scores blend five SoSoValue data sources into one number from 0 to 100.
            No magic, no model weights kept secret. The full pipeline is documented below.
          </p>
        </section>

        {/* Pipeline */}
        <Section eyebrow="Pipeline">
          <p style={{ fontSize: 16, lineHeight: 1.6, color: POD.ink200, marginBottom: 18 }}>
            Each source returns a <Mono>z-score</Mono> (how unusual today&apos;s reading is vs its
            recent history) and a <Mono>weight</Mono>. POD takes the weighted average of the
            z-scores, then squashes it through a logistic function to get a 0–100 score:
          </p>
          <Code>
{`compositeZ = sum(zᵢ × wᵢ) / sum(wᵢ)
podScore   = round(100 / (1 + e^(-compositeZ)))`}
          </Code>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: POD.ink300, marginTop: 14 }}>
            <Mono>compositeZ = 0</Mono> maps to score <Mono>50</Mono> (neutral). A composite of{' '}
            <Mono>+1.0</Mono> maps to <Mono>73</Mono>; <Mono>+2.0</Mono> to <Mono>88</Mono>;{' '}
            <Mono>-1.5</Mono> to <Mono>18</Mono>.
          </p>
        </Section>

        {/* The 5 sources */}
        <Section eyebrow="The five sources">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {SOURCES.map((s) => (
              <SourceCard key={s.key} source={s} />
            ))}
          </div>
          <p style={{ marginTop: 14, fontSize: 13, color: POD.ink400, lineHeight: 1.55 }}>
            Weights sum to 1.00. Per-asset weights can shift when a source returns no data
            (e.g. <Mono>BTC_TREASURY</Mono> contributes 0 weight for ETH because it does not
            apply); composites then renormalize across the contributing sources.
          </p>
        </Section>

        {/* Confidence */}
        <Section eyebrow="Confidence rules">
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              fontSize: 15,
              lineHeight: 1.55,
              color: POD.ink200,
            }}
          >
            <Bullet>
              A score is flagged <Highlight>low confidence</Highlight> when fewer than three
              sources contributed, or when |compositeZ| &lt; 0.3 (the signal is too neutral to act on).
            </Bullet>
            <Bullet>
              Low-confidence scores still render in the bubbles canvas, but the Trade button in
              the Telegram bot disables and the drawer shows the reason.
            </Bullet>
            <Bullet>
              Direction labels: composite ≥ 1.5 is <Mono>STRONG_BUY</Mono>, ≥ 0.5 is{' '}
              <Mono>BUY</Mono>, ≤ -0.5 is <Mono>SELL</Mono>, ≤ -1.5 is{' '}
              <Mono>STRONG_SELL</Mono>, anything in between is <Mono>HOLD</Mono>.
            </Bullet>
          </ul>
        </Section>

        {/* Freshness */}
        <Section eyebrow="Freshness">
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              fontSize: 15,
              lineHeight: 1.55,
              color: POD.ink200,
            }}
          >
            <Bullet>
              Bubble scores cache for <Mono>10 minutes</Mono> per request. After that window
              the next request triggers a fresh fan-out.
            </Bullet>
            <Bullet>
              When SoSoValue rate-limits, the failed source contributes <Mono>null</Mono> and
              the composite falls back to the remaining sources. We never invent data.
            </Bullet>
            <Bullet>
              ETF flow data updates after market close. Weekend scores hold the Friday read —
              the drawer shows the data&apos;s actual timestamp, not when the page rendered.
            </Bullet>
          </ul>
        </Section>

        {/* Limitations */}
        <Section eyebrow="Limitations" tone="warn">
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              fontSize: 15,
              lineHeight: 1.55,
              color: POD.ink200,
            }}
          >
            <Bullet>
              POD scores are research signals, <Highlight>not investment advice</Highlight>.
              No backtest replaces real risk management.
            </Bullet>
            <Bullet>
              Trade execution runs on the SoDEX <Mono>testnet</Mono>. There is no real money
              at risk and no real money to be made. Receipts are real on-chain transactions on
              ValueChain testnet.
            </Bullet>
            <Bullet>
              The composite blend is fixed in code; we do not yet train weights on outcomes.
              Per-asset learning is a Wave-2 concern.
            </Bullet>
            <Bullet>
              SoSoValue free-tier rate limits cap the concurrent fan-out. Heavy traffic can
              cause individual sources to skip; the drawer surfaces this honestly.
            </Bullet>
          </ul>
        </Section>

        {/* Verify */}
        <Section eyebrow="Verify">
          <p style={{ fontSize: 15, lineHeight: 1.6, color: POD.ink200 }}>
            Every claim on this page is testable.{' '}
            <PlainLink href="/api/scores">/api/scores</PlainLink> returns the live numbers behind
            the bubbles. Source code lives in{' '}
            <Mono>packages/signal-engine</Mono>; each contribution carries the exact rationale
            the bubble drawer renders.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 18 }}>
            <CTA href="/bubbles" primary>See live scores →</CTA>
            <CTA href="/api/scores">Raw API</CTA>
            <CTA href="https://github.com/Pratiikpy/Stealth-AP">Source on GitHub</CTA>
          </div>
        </Section>
      </main>

      <Footer />
    </div>
  );
}

// ── Layout helpers ─────────────────────────────────────────────────────

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
          <span style={{ color: POD.ink50, fontWeight: 500 }}>How it works</span>
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

function Footer() {
  return (
    <footer
      style={{
        padding: '36px 32px 48px',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        color: POD.ink400,
        fontSize: 13,
      }}
    >
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <Link href="/" style={{ color: POD.ink300, textDecoration: 'none' }}>Live scores</Link>
        <Link href="/bubbles" style={{ color: POD.ink300, textDecoration: 'none' }}>Bubbles</Link>
        <Link href="/how-it-works" style={{ color: POD.ink300, textDecoration: 'none' }}>How it works</Link>
        <Link href="/api/scores" style={{ color: POD.ink300, textDecoration: 'none' }}>API</Link>
        <a href="https://t.me/podttest_bot" style={{ color: POD.ink300, textDecoration: 'none' }}>Telegram</a>
      </div>
      <div style={{ color: POD.ink500, fontSize: 12 }}>
        POD · A one-person on-chain finance build for the SoSoValue Buildathon · MIT
      </div>
    </footer>
  );
}

function Section({
  eyebrow,
  children,
  tone,
}: {
  eyebrow: string;
  children: React.ReactNode;
  tone?: 'warn';
}) {
  return (
    <section>
      <Eyebrow color={tone === 'warn' ? POD.amber : POD.lime}>{eyebrow}</Eyebrow>
      <Hair color="rgba(255,255,255,0.06)" style={{ marginTop: 12, marginBottom: 22 }} />
      {children}
    </section>
  );
}

function SourceCard({
  source,
}: {
  source: { key: string; label: string; weight: number; api: string; measures: string; why: string };
}) {
  return (
    <div
      style={{
        background: POD.ink850,
        border: '1px solid rgba(255,255,255,0.05)',
        borderRadius: 14,
        padding: '18px 20px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 12,
          marginBottom: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: POD.ink50 }}>{source.label}</span>
          <span style={{ fontSize: 11, color: POD.ink400 }} className="num mono">
            {source.api}
          </span>
        </div>
        <span
          className="num mono"
          style={{
            fontSize: 12,
            color: POD.lime,
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 500,
          }}
        >
          weight {(source.weight * 100).toFixed(0)}%
        </span>
      </div>
      <p style={{ fontSize: 14, lineHeight: 1.55, color: POD.ink200, margin: 0 }}>
        {source.measures}
      </p>
      <p style={{ fontSize: 13, lineHeight: 1.5, color: POD.ink300, marginTop: 10, marginBottom: 0, fontStyle: 'italic' }}>
        {source.why}
      </p>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li style={{ paddingLeft: 18, position: 'relative' }}>
      <span
        style={{
          position: 'absolute',
          left: 0,
          top: 9,
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: POD.lime,
        }}
      />
      {children}
    </li>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code
      className="mono"
      style={{
        background: 'rgba(207,255,61,0.08)',
        color: POD.lime,
        padding: '1px 6px',
        borderRadius: 4,
        fontSize: '0.9em',
        fontFamily: 'Geist Mono, ui-monospace, SFMono-Regular, monospace',
      }}
    >
      {children}
    </code>
  );
}

function Highlight({ children }: { children: React.ReactNode }) {
  return <span style={{ color: POD.ink50, fontWeight: 500 }}>{children}</span>;
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <pre
      className="mono"
      style={{
        background: POD.ink850,
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 12,
        padding: '18px 20px',
        fontSize: 13,
        lineHeight: 1.6,
        color: POD.ink100,
        overflow: 'auto',
        margin: 0,
        fontFamily: 'Geist Mono, ui-monospace, SFMono-Regular, monospace',
      }}
    >
      {children}
    </pre>
  );
}

function PlainLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      style={{
        color: POD.lime,
        textDecoration: 'underline',
        textDecorationColor: 'rgba(207,255,61,0.4)',
        textUnderlineOffset: 3,
      }}
    >
      {children}
    </a>
  );
}

function CTA({
  href,
  children,
  primary,
}: {
  href: string;
  children: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <a
      href={href}
      style={{
        background: primary ? POD.lime : 'rgba(255,255,255,0.05)',
        color: primary ? POD.ink900 : POD.ink100,
        padding: '10px 18px',
        borderRadius: 10,
        fontSize: 13,
        fontWeight: primary ? 600 : 500,
        textDecoration: 'none',
        border: primary ? 'none' : '1px solid rgba(255,255,255,0.08)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {children}
    </a>
  );
}
