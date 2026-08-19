import Link from 'next/link';
import { POD } from '@/design/tokens';
import { PodMark, Eyebrow, Hair } from '@/design/atoms';
import { SiteNav } from '@/components/SiteNav';

export const metadata = {
  title: 'How POD scores are calculated · POD',
  description:
    'POD scores combine six data sources into one number. This page documents the math, the weights, and the limits.',
};

const SOURCES = [
  {
    key: 'ETF_FLOW',
    label: 'ETF flow',
    weight: 0.30,
    api: '/etfs/summary-history',
    measures:
      'Daily net inflow / outflow on spot crypto ETFs. Compares the latest session against the trailing 30-day mean and standard deviation.',
    why:
      'ETF flow is the cleanest measure of institutional appetite. A single $300M outflow day matters more than a thousand retail tweets.',
  },
  {
    key: 'MACRO_EVENT',
    label: 'Macro events',
    weight: 0.15,
    api: '/macro/events',
    measures:
      'Tier-1 macro events (FOMC, CPI, NFP) scheduled in the next 48 hours. Leans defensive as a high-impact print approaches, and stays silent when the calendar is clear.',
    why:
      'Even a strong asset-specific signal gets overruled when an FOMC print is 6 hours away. POD respects that.',
  },
  {
    key: 'NEWS_SENTIMENT',
    label: 'News sentiment',
    weight: 0.15,
    api: '/news',
    measures:
      'Coin-tagged news from the last three days, scored for sentiment polarity and weighted by recency.',
    why:
      'Headlines are noisy, but a unanimous sentiment shift across a day of coverage is worth something.',
  },
  {
    key: 'BTC_TREASURY',
    label: 'BTC treasuries',
    weight: 0.10,
    api: '/btc-treasuries',
    measures:
      'Corporate BTC accumulation across the largest public holders over the last 30 days. BTC only; contributes nothing for other assets.',
    why:
      'When a public company buys $500M of BTC, that is patient capital. The signal is slow but stickier than ETF flow.',
  },
  {
    key: 'STABLECOIN_LIQUIDITY',
    label: 'Stablecoin liquidity',
    weight: 0.10,
    api: '/analyses/stablecoin_total_market_cap',
    measures:
      'Change in total stablecoin supply against its recent history — the dry powder sitting on exchanges.',
    why:
      'Rising stablecoin supply is capital staged to buy. It moves before price does, and it is market-wide rather than per-coin.',
  },
  {
    key: 'SOCIAL_SENTIMENT',
    label: 'Social sentiment',
    weight: 0.07,
    api: 'CoinGecko /coins/{id}',
    measures:
      'Per-coin crowd vote (share of participants voting bullish), centred on 50% and scaled to standard deviations.',
    why:
      'The fast retail counterweight to the five slower institutional sources. It gets the smallest weight on purpose.',
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
      <SiteNav active="/how-it-works" />

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
            POD scores blend six institutional data sources into one number from 0 to 100.
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

        {/* The six sources */}
        <Section eyebrow="The six sources">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {SOURCES.map((s) => (
              <SourceCard key={s.key} source={s} />
            ))}
          </div>
          <p style={{ marginTop: 14, fontSize: 13, color: POD.ink400, lineHeight: 1.55 }}>
            The composite divides by the weights that actually returned data, so a source with
            nothing to say contributes nothing rather than dragging the score toward neutral.
            <Mono>BTC_TREASURY</Mono> carries 0 weight for every asset except BTC, and any source
            can go quiet on a given day — the per-asset breakdown on each coin&apos;s page shows
            exactly which ones counted.
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

        {/* Built-in safety */}
        <Section eyebrow="Built-in safety">
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
              POD only scores the ten coins with a <Highlight>spot ETF</Highlight> — no honeypots,
              no rug pulls, no random contract addresses. The universe is curated by construction,
              not by roulette.
            </Bullet>
            <Bullet>
              Every trade sits behind a <Highlight>confirm step</Highlight>. Nothing executes
              without a tap, and each order is signed EIP-712 and reported back with its result.
            </Bullet>
            <Bullet>
              Low-confidence scores are flagged; POD never pretends missing data is there. When a
              source is rate-limited it contributes nothing and the drawer says so.
            </Bullet>
            <Bullet>
              Each risk profile carries a max-drawdown cap — <Highlight>Chill 5%</Highlight>,{' '}
              <Highlight>Balanced 10%</Highlight>, <Highlight>Send it 20%</Highlight> — that shapes the
              target basket&apos;s stablecoin cushion. The on-chain{' '}
              <Mono>DrawdownGuard</Mono> (0xaB318f…706B83, ValueChain testnet) enforces the cap for the
              vault design.
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
            <CTA href="https://github.com/Pratiikpy/pod">Source on GitHub</CTA>
          </div>
        </Section>
      </main>

      <Footer />
    </div>
  );
}

// ── Layout helpers ─────────────────────────────────────────────────────



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
