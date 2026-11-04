# POD

*Institutional ETF-flow scores for crypto — a signal-to-execution platform on a web dashboard and in Telegram.*

POD reads the same crypto ETF flow data that institutional desks watch every morning, fuses it with five other institutional signals into a single score from 0 to 100 for ten major coins, and explains the reasoning in plain English with every number cited. You read the scores on a web dashboard, ask about them in a Telegram bot, and act on them in one tap — a market order on the SoDEX testnet, or a take-profit, DCA schedule, or limit ladder. Every score is hash-anchored on-chain so it can be verified after the fact.

**▶ Watch the 2-minute demo:** https://youtu.be/cn1l-CzNZhQ — the full web tour plus the Telegram signal-to-execution flow (a live SoDEX testnet order).

[![POD — 2-minute demo](https://img.youtube.com/vi/cn1l-CzNZhQ/hq720.jpg)](https://youtu.be/cn1l-CzNZhQ)

**Live**

| Surface | URL |
|---|---|
| Web — bubble dashboard | https://pod-app-phi.vercel.app/bubbles |
| Web — leaderboard | https://pod-app-phi.vercel.app/leaderboard |
| Web — ETF flow table | https://pod-app-phi.vercel.app/flows |
| Web — SSI index co-pilot | https://pod-app-phi.vercel.app/ssi |
| Web — market intel | https://pod-app-phi.vercel.app/intel |
| Web — per-coin detail | https://pod-app-phi.vercel.app/asset/BTC |
| Web — how scoring works | https://pod-app-phi.vercel.app/how-it-works |
| Web — track record | https://pod-app-phi.vercel.app/track-record |
| Web — developer API | https://pod-app-phi.vercel.app/developers |
| Web — connect / QR | https://pod-app-phi.vercel.app/connect |
| Telegram bot | https://t.me/podttest_bot |
| Public scores API (JSON) | https://pod-app-phi.vercel.app/api/scores |
| MCP server (agent tools) | https://pod-app-phi.vercel.app/api/mcp |

Built with the SoSoValue API, the SoDEX trading API, ValueChain (an EVM-compatible L1), CoinGecko, and the 0G AI model. Made for the SoSoValue Buildathon.

---

## What problem this solves

When a spot Bitcoin or Ethereum ETF takes in or loses hundreds of millions of dollars in a day, that says something about how serious money is positioned. A research desk at a fund watches this every morning. Most retail traders never see it, see it too late, or don't know how to read it.

POD does three things:

1. **Reads the data** — ETF flows, macro calendar, coin-tagged news, corporate Bitcoin accumulation, stablecoin liquidity, and social sentiment, from SoSoValue and CoinGecko.
2. **Scores it** — a documented weighted z-score across those six sources, one POD Score per coin, with a written explanation that points at the exact numbers behind it, and an honest low-confidence flag.
3. **Lets you act on it** — the same scores show up in a Telegram bot with an auto-generated in-bot wallet, one-tap orders on SoDEX, take-profit/stop-loss, DCA, alerts, and a shareable everything.

The buildathon's theme is "a one-person on-chain finance business." POD is the signal-to-execution piece of that: data in, a clear call, a way to act on it, and on-chain proof — running with no team and no app to install.

---

## How a POD Score is built

Each source returns a **z-score** (how unusual today's reading is versus its recent history) and a **weight** (how much it counts). POD takes the weighted average of the z-scores and maps it to a 0–100 number through a logistic curve.

```
compositeZ = sum(z_i * w_i) / sum(w_i)
podScore   = round(100 / (1 + e^(-compositeZ)))
```

A composite of 0 maps to a score of 50 (neutral). +1.0 maps to about 73. −1.5 maps to about 18.

| Source | Weight | What it measures |
|---|---|---|
| ETF flow | 0.30 | Daily net inflow/outflow on spot crypto ETFs, z-scored against the trailing 30-day distribution. |
| Macro events | 0.15 | A tier-1 macro release (CPI, FOMC, jobs) in the next 48h leans the score defensive; silent otherwise. |
| News sentiment | 0.15 | Recency-weighted tone of coin-tagged SoSoValue news over the last few days. |
| BTC treasuries | 0.10 | 30-day corporate BTC accumulation across the largest public holders. BTC only. |
| Stablecoin liquidity | 0.10 | Z-score of the change in total stablecoin supply — the "dry powder" tide. |
| Social sentiment | 0.07 | CoinGecko per-coin crowd vote — the fast retail counterweight to the slow institutional sources. |

Weights are normalised by their sum, so a source with no data contributes nothing rather than dragging the score to neutral. A score is marked **low confidence** when fewer than three sources returned a weighted contribution, or when the composite is too close to zero to act on. When a source is rate-limited or empty, it contributes nothing and the explanation says so — POD never invents data. Full method: [`/how-it-works`](https://pod-app-phi.vercel.app/how-it-works).

![POD bubble dashboard](docs/images/bubbles-live-wave0.png)

---

## Trade from your own wallet (`/trade`)

POD is a SoDEX **builder**: it earns a small fee on orders routed through it, and a user always approves that fee first.

- **Non-custodial.** Connect any browser wallet (EIP-6963). One signature registers a trading key that lives only in your browser (30-day expiry) and approves POD's builder fee. Orders are signed in the browser and go straight to the SoDEX gateway. POD never holds keys or funds.
- **Spot, Perps and Wealth.** Spot and tokenized ETFs/stocks (Wealth, order-book funds such as QQQ and VOO) share one path. Perps support long, short and close. Wealth vault funds (CXMT, UNITREE, Morpho Earn) are not part of this page.
- **Fees, as the gateway charges them.** Perps 10 bp on both sides, spot 10 bp on sells only (spot buys carry no builder fee), capped by what the user approved. The page shows the estimate before the order and the amount charged after it.
- **Builder account:** SoDEX account `235300` (mainnet).
- **Deep links.** Every coin page and every `/score` reply in the Telegram bot links to `/trade?asset=BTC&side=sell`, with POD's own direction pre-selected.

Proof, all against the real SoDEX testnet gateway, not mocks:

| Check | Result |
|---|---|
| SDK unit tests (signing, caps, decimals, sizing, order confirmation, key slots, leverage wire format) | 128 passing |
| `packages/sodex-sdk/scripts/verify-builder-testnet.ts` | 18/18: approve, both-engine visibility, wrong signer rejected, replay rejected, fee on real fills at the exact rate, key registration with builder, revoke, clear |
| `packages/sodex-sdk/scripts/verify-confirm-testnet.ts` | 9/9: a fill is found from the order record or the balance when the trades list is empty, the gateway ignores the `orderID` filter on trades, and the leverage and margin-mode wire format |
| `packages/sodex-sdk/scripts/verify-keys-testnet.ts` | 7/7: the 10-key cap, a wallet-signed removal on both engines, registering again afterwards |
| `apps/pod-web/e2e/trade.e2e.mjs` (real browser, real EIP-712 signatures, a wallet that refuses typed data on the wrong chain like MetaMask) | 64/64: connect, enable, buy, sell, perps long and short at a chosen leverage, declined signature, minimum-order and sellable-holding guidance, stale quotes, order confirmation with the order lists forced empty, key-slot recovery for one-engine and two-engine keys, a paused builder, deep links, onboarding, mobile layout, zero console errors |

On the live fills, the builder fee matched `notional x rate / 100000` to the digit: 5 bp on perps open and close (before the perps rate was raised to 10 bp, which the 10 bp ceiling every user already approved allows without a new signature), 10 bp on a spot sell, a request of 100 against an approval of 50 charged 5 bp, and no fee with no approval.

![Trade page, spot, with the POD read](docs/images/trade-spot-ready.png)
![Perps fill and open position](docs/images/trade-perps-filled.png)
![Mobile](docs/images/trade-mobile.png)
![Dust warning on a minimum buy](docs/images/trade-dust-warning.png)
![Leverage selector and margin](docs/images/trade-leverage.png)
![Out of API key slots, with the way out](docs/images/trade-key-limit.png)

Run the tests: `pnpm --filter @pod/sodex-sdk test`, then with `NEXT_PUBLIC_SODEX_NETWORK=testnet pnpm --filter @pod/pod-web dev` running, `node apps/pod-web/e2e/trade.e2e.mjs`. The e2e test needs the funded testnet key in `.env` and a Chrome install.

### What live testing found, and how the page handles it

A tester ran ten funded wallets through the live page on mainnet and filed a bug report. Each finding is fixed and has a test that reproduces it.

- **A filled order was reported as "no fill yet".** The trades, open-orders and history endpoints can all stay empty for minutes after a fill. An order is now submitted first and confirmed from three independent sources (the fills, the order's own record, and the balance or position change). "Not filled" is only said when the order's record says so, and a market order recorded as `CANCELED` with a non-zero `executedQty` is a fill.
- **Fee details lag behind the fill.** When the order is confirmed from its own record or the balance, the card says the fee details are not published yet and upgrades itself when SoDEX's trade list catches up.
- **A minimum buy left a holding that cannot be sold.** The spot buy fee comes out of the asset bought, so the smallest buy ends up one step short of the smallest sell. The ticket now warns, names the amounts and offers a size that stays sellable, and "Sell all I can" sells an exact quantity.
- **Small perps trades.** A leverage selector (bounded by the market maximum) shows the margin an order needs.
- **`updateLeverage` sent the margin mode as a word.** It is an integer on the wire (1 isolated, 2 cross).
- **A quote for an older amount could be acted on.** Each quote is stamped with its inputs, and the order is locked until it matches.

Found while fixing these, not in the report:

- **SoDEX allows 10 API keys per account and keeps expired ones.** Each browser that enables trading uses one, and a half-failed registration can leave a key on one engine only. The page checks the slots before asking for a signature and, at the cap, removes POD's oldest key with the wallet.
- **The builder account must hold 100 vUSDC in both Spot and Perps, or every new approval is refused.** The page checks this first and pauses sign-ups with an explanation instead of asking for a signature that cannot work. `GET /api/builder-health` returns 200 when healthy and 503 when below the floor, for an uptime monitor.
- The minimum deposit is 5 USDC on every chain, the first deposit pays 1 USDC to activate the account, and most spot markets need a $5 order.

Not verified yet: a real-money mainnet run of the fixes (every test above is against testnet, which has no tokenized-ETF markets, so the Wealth tab is tested with a mocked fund list), and how the mainnet gateway behaves for the order-confirmation sources after the fix.

---

## The web surfaces

- **Bubbles** (`/bubbles`) — ten coins, ten bubbles. Colour is the score (red defensive, lime conviction), size is rank, pulse is how unusual the flow is. Click for a drawer with the full reasoning and per-source breakdown. Responsive; mobile bottom-sheet; keyboard/screen-reader list; respects reduce-motion.
- **Leaderboard** (`/leaderboard`) — all ten ranked by score with the one-line why.
- **ETF flows** (`/flows`) — a Farside-style table of daily per-asset net creations/redemptions, green in / red out, with a 7-day net column.
- **SSI co-pilot** (`/ssi`) — SoSoValue's thirteen SSI index baskets ranked by momentum with their ROI ladder, the ones tradable on SoDEX flagged, and the featured basket's constituents.
- **Market intel** (`/intel`) — sector rotation, token-unlock radar, cycle position (down-from-ATH / up-from-cycle-low), crypto-equity sectors, and a corporate BTC-buy feed.
- **Per-coin** (`/asset/[symbol]`) — score gauge, reasoning, every source contribution with its citation, target basket, real score trace, and an **on-chain receipt** (the reasoning hash + the ValueChain tx that anchored it). Each page ships a shareable OG card.
- **Track record** (`/track-record`) — how many scores are recorded and anchored on-chain; honest hit-rate accrues over time, no cherry-picking.
- **Developers** (`/developers`) + **Connect** (`/connect`) — the open API, a scannable QR into the bot, deep links, and an embeddable live score badge.

![Leaderboard](docs/images/leaderboard-wave2.png)
![Per-coin detail with on-chain receipt](docs/images/asset-btc-wave2.png)
![Market intel](docs/images/intel-f7f9.png)

---

## The Telegram bot

Auto-generates an in-bot ValueChain wallet on `/start` (private key encrypted at rest, AES-256-GCM) so a new user is trading in ~30 seconds — no external wallet.

| Command | What it does |
|---|---|
| `/start` | Intro + risk profile; mints your in-bot wallet. Handles deep links (`?start=score-BTC`, `?start=ref-<id>`). |
| `/score BTC` | One-line score + reasoning, with one-tap **Buy $5 / $10** buttons on constructive coins. |
| `/signal` | Full BTC card + an AI-written explanation. |
| `/ask <question>` | Natural-language Q&A answered **only** from live POD data, with citations (0G AI). |
| `/trade` | Confirm card → real EIP-712-signed SoDEX testnet order, result reported back. |
| `/tp BTC 70000 60000` | Server-side take-profit / stop-loss; a monitor exits when a level is hit. |
| `/dca BTC 5` | Recurring buy on a schedule. |
| `/ladder BTC 20` | A batch of limit buys stepped below the orderbook. |
| `/safety` | Dead-man switch — auto-cancels resting orders after N minutes. |
| `/alert BTC above 70` | Ping when a score crosses; also POSTs to your `/webhook` URL. |
| `/watch` · `/watchlist` | Personal watchlist for the daily digest. |
| `/wallet` · `/portfolio` | Your wallet + balance; the demo trading wallet's holdings. |
| `/import` · `/export` | Bring your own wallet / reveal your key. |
| `/pro` · `/ref` · `/webhook` | Freshness tier, referral link, event webhook. |
| `/lang` · `/help` | Language (EN/中文/日本語/한국어), commands. |
| inline mode | Type `@podttest_bot BTC` in **any** chat to drop a live score card. |

The bot and web read the same 10-minute cached scores, so `/score BTC` matches `/bubbles` and `/api/scores`.

![Telegram bot](docs/images/mobile.png)

---

## On-chain

Contracts on the ValueChain testnet (chain ID 138565):

| Contract | Address |
|---|---|
| `ReasoningLogger` | `0x0723dc7D775864ec08797e84d2A5E068876B221B` |
| `DrawdownGuard` | `0xaB318f90a8EB8dce770f7B39D5F1175c07706B83` |

**`ReasoningLogger` is now written to.** The daily job anchors a `keccak256` of each score's canonical data on-chain and stores the tx. A per-coin page shows the receipt; `GET /api/receipt/BTC` returns the hash, tx, and explorer link. Anyone can recompute the hash from the public score and confirm it matches. `DrawdownGuard` holds the per-profile max-drawdown caps (Chill 5% / Balanced 10% / Send-it 20%) for the vault design.

```bash
cast code 0x0723dc7D775864ec08797e84d2A5E068876B221B --rpc-url https://testnet-rpc.valuechain.xyz
```

Note on gas: the SoDEX testnet faucet drips USDC, not the native SOSO for gas. The workaround was to buy WSOSO on the SoDEX spot market and `transferAsset` (`type=EVM_WITHDRAW`, `toAccountID=999`) it to the deployer as native gas. Trading itself is gasless (off-chain EIP-712), so users never need native gas.

---

## Run it locally

Node 22+ and pnpm 10+ (pinned `pnpm@10.32.1`).

```bash
git clone https://github.com/Pratiikpy/pod.git
cd pod
pnpm install
pnpm --filter @pod/sosovalue-sdk build
pnpm --filter @pod/sodex-sdk build
pnpm --filter @pod/signal-engine build

cp .env.example apps/pod-web/.env.local   # then fill it in
pnpm --filter @pod/pod-web dev            # http://localhost:3000/bubbles
```

The bot runs as a webhook route inside the web app (`/api/telegram`) — no separate process. Point Telegram at it with `setWebhook`.

Environment variables:

| Variable | Needed by | Effect if missing |
|---|---|---|
| `SOSOVALUE_API_KEYS` | scores | Comma-separated key pool (round-robin + 429 failover); the 10-coin fan-out exceeds one key's 20/min. Falls back to `SOSOVALUE_API_KEY`. Without any, scores fall back to neutral and say so. |
| `DATABASE_URL` | history, wallets, alerts, DCA, watchlist, referrals | Postgres (Neon free tier). Without it, those features no-op. |
| `TELEGRAM_BOT_TOKEN` | bot | The bot won't respond. |
| `SODEX_PRIVATE_KEY` | `/trade`, presets, TP/SL, DCA | Execution disabled. |
| `WALLET_ENCRYPTION_KEY` | in-bot wallets | 32-byte hex; without it, wallet features off. |
| `OG_API_KEY` | `/ask`, narration | 0G AI (OpenAI-compatible); NVIDIA is the fallback, then templates. |
| `COINGECKO_API_KEY` | social source | Optional demo key; without it the free tier rate-limits the 10-coin burst (works for ~5). |
| `DEPLOYER_PRIVATE_KEY`, `VALUECHAIN_TESTNET_RPC` | on-chain logging | Falls back to `SODEX_PRIVATE_KEY` + a default RPC. |

---

## How to check it works (~5 minutes)

1. Open [`/bubbles`](https://pod-app-phi.vercel.app/bubbles). Ten bubbles, **different** scores (not all 50). Click one → drawer with reasoning + a "Sources (N/6)" breakdown.
2. Open [`/api/scores`](https://pod-app-phi.vercel.app/api/scores) → same ten scores as JSON with a fresh `generated_at`.
3. Open [`/asset/BTC`](https://pod-app-phi.vercel.app/asset/BTC) → scroll to **On-chain receipt**; the tx link opens on the ValueChain explorer.
4. In [the bot](https://t.me/podttest_bot): `/score BTC` (matches the web), `/ask which coin is most bearish and why`, `/wallet`, and tap **Buy $5** on a constructive `/score` — a real SoDEX order ID comes back.
5. Type `@podttest_bot BTC` in any chat to see inline mode; hit [`/api/mcp`](https://pod-app-phi.vercel.app/api/mcp) to see the agent tools.

---

## How this maps to the judging criteria

- **User value & practical impact (30%)** — the institutional read on the ten ETF coins for free, plus market intel (sector rotation, unlocks, cycle, corporate buys), an AI you can ask, and one-tap execution with TP/SL, DCA, and alerts.
- **Functionality & working demo (25%)** — ten web surfaces, ~20 bot commands + inline mode, real SoDEX order IDs, on-chain receipts, an MCP server — none of the core flow is mocked, all verified end-to-end.
- **Logic, workflow & product design (20%)** — a documented six-source weighted z-score, every claim cited, confirm-gated trades, honest low-confidence, and one shared cache so web/bot/API never disagree.
- **Data & API integration (15%)** — SoSoValue across ETF flow, macro, news, treasuries, fundraising, indices/SSI, sector-spotlight, token-economics, stablecoin analyses, and per-coin snapshots + order-book depth; SoDEX spot (market/limit/batch/cancel/schedule-cancel) with EIP-712 signing; CoinGecko social; ValueChain contracts.
- **UX & clarity (10%)** — the bubble front door, consistent nav, share cards, QR + deep links, and honest loading/empty/error states.

---

## Proven demand — every feature maps to a product that validated it

None of POD's features are speculative. Each one copies a pattern already proven at scale by a real product with real users, revenue, or engagement — then applies it to institutional ETF-flow data and on-chain execution.

| POD feature | Who proved the demand | The evidence |
|---|---|---|
| **In-bot wallet on `/start`** (F11) | Trojan, Maestro, Banana Gun, BONKbot | 500k+ users each; auto-generated custodial wallet is the #1 onboarding conversion lever — trade in ~30s, no external wallet. |
| **One-tap preset orders** (F12) | Every top Telegram bot | Preset buy/sell buttons are the universal speed win; Telegram bots drove ~$23.4B of 2025 crypto volume. |
| **Server-side TP/SL** (F13) | Trojan | Auto-sell that runs with Telegram closed is the #1 retention feature — keeps positions and money in the product. |
| **Score-triggered alerts** (F15) | Whale Alert, Nansen Smart Alerts, CryptoQuant | Whale Alert's pure alert feed has **310k** Telegram subscribers; alerts are the universally-paid daily-use primitive. |
| **`/ask` grounded Q&A** (F16) | aixbt Terminal, Bankr, Messari Copilot | Conversational "ask the agent" is the most-used AI pattern; Messari grounds every answer in cited data (POD does the same — no invented numbers). |
| **DCA schedules** (F17) | Trojan / Maestro DCA, 3Commas | "Set a rule, let it run" is proven retail behaviour. |
| **Portfolio / PnL view** (F18) | Every bot's daily surface; CoinStats/Delta (multi-million users) | Portfolio is the daily-open hook. |
| **Shareable score cards + inline mode** (F20, F43) | Trojan/BONKbot PnL cards; Stripe payment links, Cash App `$cashtag` | Shareable artifacts are the free viral loop; inline mode drops a live score into any group chat with no install. |
| **Composite score + leaderboard** (F1, F2) | Kaito "Mindshare", Nansen "Smart Money" | One branded proprietary number becomes the daily-open hook and the thing people quote. |
| **Per-issuer ETF flow table** (F21) | Farside Investors | The single most-screenshotted ETF artifact in crypto; media and traders cite it nightly. |
| **On-chain receipts + track record** (F26, F27) | dHEDGE, Enzyme, Index Coop | Verifiable-on-chain everything is the entire trust model of on-chain asset management; aixbt shows even honest hit-rate earns trust. |
| **SSI index co-pilot** (F24) | Index Coop, Set/TokenSets, SoSoValue SSI | "One token = a whole strategy" is a proven, trusted product. |
| **Market intel** (F6/F7/F8/F9) | Nansen, Messari, Santiment, Arkham | Sector rotation, unlock calendars, cycle metrics, and labelled corporate flows are what users pay for daily. |
| **MCP server + open API** (F29, F30) | DeFiLlama, Glassnode (MCP), Kaiko, Messari | The API/agent surface is a core revenue + credibility line and matches the "agent-friendly" ValueChain theme. |
| **Webhooks** (F31) | TradingView alerts → webhook → bot | The canonical "signal → action" bridge retail already understands. |
| **Referral + fee-share** (F32–34) | Trojan (5-level, 35%), Banana ($BANANA 40% fee share) | The documented primary growth engine of every top bot. |
| **Freshness / Pro tier** (F37) | CryptoQuant, Glassnode, Nansen | A delayed free tier + real-time paid tier is the proven monetization funnel. |
| **Dead-man switch, limit ladder** (F19, F39) | Pro trading tooling (SoDEX `scheduleCancel`, batch orders) | Standard risk/execution primitives that carry the "risk control" judging bonus. |
| **Embed badge + QR/connect** (F46, F49) | Stripe buy-button, TradingView widgets, bot deposit QRs | Frictionless distribution surfaces. |

One honest caveat POD keeps front-and-centre: ETF flow is a **lagging, medium-term** signal (Farside, CoinGlass). POD frames the score as institutional-demand *context* with an explicit confidence flag — honesty is itself a trust feature, and it carries the risk-control judging bonus.

The full research behind this — competitor-by-competitor, with sources — is in [`docs/POD_MASTER_PLAN.md`](docs/POD_MASTER_PLAN.md).

---

## What is not done yet

- **Trading uses one shared demo wallet.** `/trade` and presets sign with a single server-side `SODEX_PRIVATE_KEY`. Each user gets their own in-bot wallet (and can `/import` one), but trades execute on the shared funded wallet — per-user trading needs each wallet funded, which the testnet faucet doesn't do per-user. Custodial, fine for a testnet demo.
- **Testnet fills depend on venue state.** Orders are placed and signed with real order IDs; whether they fill depends on the SoDEX testnet's thin liquidity and per-pair state (`cancel only`, `MissingOraclePrice`). The bot reports the exact venue result.
- **Perps not funded.** The perps signing domain is fixed (`futures`), but the perps ledger isn't funded, so perps orders aren't demoed. Spot is the demo path.
- **Score history is young.** The trace and hit-rate on `/track-record` accrue as the daily job runs — real, just early.
- **Fixed weights.** The composite weights are a reasoned starting point, not trained on outcomes.
- **No per-user public profile.** Shareable OG cards, the public track record, and connect links exist; a per-user handle profile would need an auth system POD deliberately doesn't have.
- **English-first reasoning.** The bot UI has four languages; the AI explanations are English.

Every limitation is also stated on `/how-it-works`.

---

## Tech stack

- **Web + bot** — Next.js 15 (App Router, server components) on Vercel; the grammY bot is a webhook route inside the app.
- **Signal engine** — a TypeScript package turning raw SoSoValue + CoinGecko data into a `PodSignal`; a batch mode hoists global sources and reuses them across all ten coins under the rate limit.
- **SoSoValue SDK** — a typed, Zod-validated client with a round-robin API-key pool, 429 failover, and a process-wide cache that dedupes the fan-out.
- **SoDEX SDK** — a typed spot/perps client with EIP-712 signing ported from the Go SDK, plus an account WebSocket for fill receipts.
- **Data** — Neon Postgres (scores, wallets, alerts, DCA, TP/SL, watchlist, referrals, webhooks); 0G AI for reasoning; CoinGecko for social.
- **Contracts** — Foundry: `ReasoningLogger`, `DrawdownGuard`, a `PodVault` design.

## Repo layout

```
pod/
├── apps/
│   ├── pod-web/          Next.js app — all web pages, the Telegram webhook,
│   │                     the public + MCP APIs, and the cron jobs
│   ├── pod-bot/          legacy standalone bot (the live bot is the webhook route)
│   └── pod-workers/      background job scaffolding
├── packages/
│   ├── sosovalue-sdk/    typed SoSoValue client (key rotation + cache)
│   ├── sodex-sdk/        typed SoDEX client + EIP-712 signing + WebSocket
│   ├── signal-engine/    the six-source scoring engine
│   └── pod-contracts/    Foundry contracts
├── docs/
│   ├── POD_MASTER_PLAN.md   the full build plan
│   └── images/             screenshots
├── deploy.sh · vercel.json · .env.example
```

## License

MIT. Built by one person for the SoSoValue Buildathon, in the spirit of the "one-person on-chain finance business" theme.
