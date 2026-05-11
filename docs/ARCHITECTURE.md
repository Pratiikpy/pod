# Architecture

This is the short version of how POD fits together. The README covers what it does and how to run it; this file is for someone reading the code.

## The flow, end to end

```
SoSoValue API ──┐
   ETF flows     │
   macro events  │
   news          ├──▶ signal-engine ──▶ PodSignal ──┬──▶ pod-web  /bubbles, /asset/[sym], /api/scores
   BTC treasuries│        (per coin)                 │           (cached 10 min via unstable_cache)
   fundraising   │                                   │
                 │                                   └──▶ pod-bot  /signal, /score, /trade
SoDEX API ───────┤                                              │
   spot symbols  │                                              ▼  (only on /trade Confirm)
   account state │                                       sodex-sdk: build + EIP-712 sign + submit order
   place order   │                                              │
ValueChain RPC ──┘                                              ▼
   contracts                                          SoDEX testnet order → result back to the chat
```

## Packages

### `signal-engine`

Turns raw SoSoValue data into a `PodSignal`:

```ts
interface PodSignal {
  asset: string;
  generated_at: string;
  direction: 'STRONG_SELL' | 'SELL' | 'HOLD' | 'BUY' | 'STRONG_BUY';
  podScore: number;        // 0..100
  compositeZ: number;      // weighted average of source z-scores
  contributions: SignalContribution[];   // one per source that returned data
  targetBasket: { symbol: string; weight: number }[];
  reasoning: string;       // plain-English summary
  uncertain: boolean;      // < 3 sources, or |compositeZ| < 0.3
}
```

Two entry points:

- `generate(req)` — one coin, one set of sources.
- `generateBatch(requests, { perAssetGapMs })` — many coins. It notices that `MACRO_EVENT` and `VC_FUNDING` do not depend on the coin, fetches them once, and reuses the result across every request. The per-coin sources (`ETF_FLOW`, `NEWS_SENTIMENT`, `BTC_TREASURY`) run with a small gap between coins. A ten-coin batch costs roughly 32 SoSoValue calls instead of 50, which keeps it under the free-tier rate limit.

Each source is a function `(sso, asset?) => SignalContribution`. They are wrapped so a failure (rate limit, missing data) returns `null` instead of throwing, and the composite is computed from whatever came back. If nothing came back, `compositeZ` is 0, the score is 50, and `uncertain` is true.

### `sosovalue-sdk`

A typed client over the SoSoValue API. Zod schemas validate responses. Rate-limit errors come back as a typed `SoSoValueRateLimitError` so the engine can catch them by type rather than string-matching.

### `sodex-sdk`

A typed client over the SoDEX spot and perps APIs. The interesting part is signing: SoDEX uses EIP-712 over an `ExchangeAction { payloadHash, nonce }` struct, with a `0x01` prefix byte on the wire signature. This was ported byte-for-byte from the official Go SDK so the hashes match. The signature goes in the `X-API-Sign` header, not the body — the body is the unwrapped params, and the action type is read from the URL path.

### `pod-contracts`

Foundry. `ReasoningLogger` (anchor a hash of a score's underlying data), `DrawdownGuard` (drawdown cap for the vault design), `PodVault` (per-user vault, deployed on first deposit). `Deploy.s.sol` deploys the first two; the deployed addresses are in the README.

## Apps

### `pod-web`

Next.js App Router on Vercel.

- `/bubbles` — `force-dynamic` page. Calls `fetchAllBubbleData()`, which is wrapped in `unstable_cache` with a 10-minute TTL. The first request after the cache expires triggers the full five-source fan-out (about 30 seconds cold); requests within the window are instant. Was originally a statically-rendered ISR page, but the build-time pre-render hit the SoSoValue rate limit and the 60-second per-page timeout, so it moved to dynamic + a data-layer cache.
- `/asset/[symbol]` — per-coin detail, reads the same cached data.
- `/how-it-works` — static page documenting the method.
- `/api/scores` — JSON of all ten scores.
- `/api/cron/daily-signal`, `/api/cron/nav-update` — Vercel cron jobs (defined in `vercel.json`).
- `/api/telegram` — the bot webhook. The bot logic lives here (and in `pod-bot`). The webhook only enforces a `secretToken` if `TELEGRAM_WEBHOOK_SECRET` is set; passing an empty string makes grammY reject every Telegram request with 401.

The bot reads scores through `getBubble(asset)`, which goes through the same cache the web pages use, so the bot and the web never show different numbers.

### `pod-bot`

The grammY bot logic as a standalone package. The deployed bot runs from the `pod-web` webhook route, which imports and reuses this.

### `pod-workers`

Scaffolding for background jobs (a signal poller, a rebalancer). Not wired into the live deployment yet.

## Deployment

`vercel.json` at the repo root holds the build configuration: `pnpm install --frozen-lockfile`, then build the three SDKs in order, then build `pod-web`, output to `apps/pod-web/.next`. Two cron schedules are declared there.

`deploy.sh` is a one-shot for a full deploy from a clean checkout: run tests, build the SDKs, deploy the contracts if the deployer wallet has gas, deploy the web app via the Vercel CLI.

## Things worth knowing if you change something

- The bubble physics in `BubbleCanvas.tsx` is a small Verlet simulation with a centre pull and collision repulsion. It uses smaller radii below a 640px viewport and stops the pulse animation under `prefers-reduced-motion`.
- `BubbleData` carries `targetBasket` so the bot can build a `PodSignal` from the cached bubble without re-running the engine.
- The bot's `/trade` Confirm button carries the dollar amount in the callback data (`trade:go:6`). On Confirm it re-fetches the cached signal and calls `tradeOnSignal`. Non-BUY directions never reach the confirm card.
- SoDEX API responses contain `_`, `*`, and backtick characters that break Telegram's legacy Markdown parser, so the order-result message is sent as plain text. The signal card text is fully controlled, so it keeps Markdown for the bold.
