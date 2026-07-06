# POD — Master Plan (Best Possible Version)

*The definitive build plan. Derived from: deep read of the SoSoValue API + SoDEX API + ValueChain, live verification of POD's production behaviour, and competitive/PMF research across on-chain intel dashboards, index/vault protocols, ETF-flow products, Telegram trading bots, copy-trading, AI agents, and retail alert products.*

**Rule for this plan:** every item is either (a) a proven high-PMF feature validated by a real product with real demand, or (b) a foundation fix without which the product's thesis is hollow. No speculative features. Everything here is feasible on SoSoValue mainnet API (paid, works) + SoDEX testnet (gasless, works) + ValueChain testnet (contracts deploy). No large money, no mainnet trading, no impractical integrations.

---

## Part 0 — What the research actually found (verified, not assumed)

### 0.1 The core engine is running on ~1 of 5 sources (VERIFIED against live `/api/scores`)

Live production output on the day this plan was written:

| Asset | Score | z | Reasoning shown | Reality |
|---|---|---|---|---|
| BTC | 50 | 0.00 | "No tier-1 macro events… No recent news for BTC." | **ETF flow line absent.** Score fell back to neutral. |
| ETH | 42 | −0.32 | "ETH ETF flow mild outflow −$65.6M… No tier-1 macro events." | Only asset with a real signal. |
| SOL | 50 | 0.00 | "No recent news for SOL. Treasury applies to BTC only." | Neutral fallback. |

**Root cause:** the SoSoValue SDK wraps several endpoints on guessed paths/schemas that don't match the live API and degrade to `[]` instead of throwing:

- **News** (`/news`): SDK maps `sentiment / importance / summary / published_at` — none of those exist. Real signal fields are `impression_count / like_count / retweet_count / matched_currencies / tags / is_blue_verified / category`. → news source contributes nothing.
- **Macro** (`/macro/events`): the calendar endpoint returns event **names only**. Actual/forecast/previous live in `/macro/events/{event}/history`. SDK expects rich objects on the calendar call → empty.
- **Treasury** (`/btc-treasuries`): SDK guesses `/btc-treasuries/list` + `/acquisitions`; real data is `/btc-treasuries` (thin list) + `/btc-treasuries/{ticker}/purchase-history` (holdings/cost).
- **Fundraising** (`/fundraising`): SDK guesses flat `/fundraising/list`; real shape is `/fundraising/projects` → `/fundraising/projects/{id}` with nested rounds/investors.
- **Index/SSI**: SDK uses `/index/*`; real is `/indices` + `/indices/{ticker}/{constituents,market-snapshot,klines}`. Constituent + snapshot schemas differ.
- **Currency / crypto-stocks / charts**: path guesses (`/currency/list`, `/crypto-stocks/list`, `/charts/catalog`) vs documented `/currencies`, `/crypto-stocks`, `/analyses`.
- **ETF** (flagship) is the closest to correct — paths right, but the snapshot field names still need aligning (`mkt_price / prem_dsc / cum_inflow / volume / sponsor_fee`), and BTC ETF flow is intermittently absent, which must be debugged.

**Consequence:** POD's headline claim — "composite across ETF flow + macro + news + treasury + VC" — is not true in production today. **This is P0. Nothing else matters until the five sources return real data and the composite moves off 50.**

### 0.2 SoSoValue API — hard facts

- Base: `https://openapi.sosovalue.com/openapi/v1`, header `x-soso-api-key`. All GET, read-only.
- Limits: **100k requests/month, 20 requests/minute** per key. No documented free/paid tiers — a single approved-key quota. (Update README: don't claim "free tier"; say "100k/mo, 20/min".)
- Recency caps: klines 1d only, last 3 months; ETF net-inflow history last 1 month; news time filters last 7 days.
- **SSI/index is read-only. There is NO create/publish/rebalance endpoint.** The buildathon "index publisher" direction is not doable via API. The honest, strong framing is **index co-pilot**: read SSI baskets, recompute NAV from live constituent prices, detect drift, and let a user *replicate* a basket on SoDEX.

### 0.3 Under-used SoSoValue data (each directly strengthens the thesis)

1. `/currencies/{id}/pairs` → `cost_to_move_up_usd / down_usd` = **±2% order-book depth**. Real liquidity → slippage-aware SoDEX order sizing.
2. `/currencies/{id}/token-economics` → **unlock/vesting schedule** → supply-shock alerts.
3. `/currencies/sector-spotlight` → **sector rotation + dominance** in one call, no params.
4. `/currencies/{id}/market-snapshot` rich fields → ATH, `down_from_ath`, cycle-low, FDV, `marketcap_rank` → cycle-position context.
5. `/crypto-stocks/sector/{sector}/index` → sector index vs **`btc_price` vs `nasdaq100_index`** in one row → crypto-equity divergence / risk-on gauge.
6. `/analyses/*` → **stablecoin total market cap** (dry-powder liquidity tide) + ETF-flow chart; call `/analyses` live to enumerate the full catalog.
7. `/indices/*` → SSI baskets (MAG7, Layer1, etc.) with ROI ladder + constituents → replication + NAV-drift.

### 0.4 SoDEX / ValueChain — hard facts

- Spot signed writes **work today** (SOSO/USDC market buy returned an order ID). Trading is **gasless** (off-chain EIP-712, not on-chain tx) → the USDC-only faucet is sufficient; native SOSO gas is only for on-chain bridge deposit/withdraw, which POD never needs.
- Spot order types: **LIMIT and MARKET only. No native stop/TP/SL on spot.** TIF: GTC / IOC / GTX (post-only); FOK "not supported yet". Market buy can use `funds` (quote spend).
- Perps has **stop / TP/SL / leverage / positions / funding** via `modifier` (NORMAL/STOP/BRACKET/ATTACHED_STOP), but: only one-way `positionSide=BOTH`, only `MARK_PRICE` triggers, must fund the perps ledger (spot→perps transfer), and **the signing domain must be `futures` not `perps`** — current `signing.ts` bug blocks all perps writes. One-line fix.
- Batch orders up to 100 (limit ladders). `scheduleCancel` = dead-man switch. Full **WebSocket** at `wss://…/ws/spot` & `/ws/perps` incl. `account-order-updates` / `account-trades` → **real-time fill receipts** (currently unwrapped).
- Chain IDs: testnet 138565 (`testnet-v2.valuechain.xyz`, explorer `test-scan.valuechain.xyz`), mainnet 286623.
- Testnet reliability: pick a live `TRADING` pair with fallback (BTC/USDC intermittently cancel-only, TESTBTC/USDC intermittently MissingOraclePrice — venue state, not auth). SOSO/USDC is the reliable demo pair.

### 0.5 Proven high-PMF features (who validated each)

- **Telegram-native trade bots are a real, huge market:** ~$23.4B 2025 volume; Trojan/Maestro/Banana/BONKbot each 500k+ users, billions lifetime, ~1% fee revenue (15,500+ ETH to operators in 2024).
- **#1 onboarding unlock:** auto-generate an in-bot wallet on `/start` (no external wallet) → trade in ~30s. Every top bot does this.
- **#1 retention feature:** server-side TP/SL that runs 24/7 (Trojan auto-sells with Telegram closed).
- **Alerts to Telegram** are the universally-paid daily-use primitive (Whale Alert 310k subs; Nansen/Arkham/CryptoQuant/Santiment all monetise alerts).
- **One branded composite score + leaderboard** as the daily hook (Kaito "Mindshare", Nansen "Smart Money") — POD's z-score *is* this.
- **Cited "why" on every score** (Messari Copilot source-grounded; aixbt publishes reasoning "thought logs"; even a 31% hit-rate + transparency earns trust) — POD's reasoning drawer *is* this.
- **Natural-language "ask" over the data** (aixbt Terminal, Bankr) is the most-used AI pattern — not black-box autonomy.
- **Per-issuer ETF flow table** (Farside — most-screenshotted ETF artifact; CoinGlass; SoSoValue).
- **Shareable PnL/score cards** = free viral loop (Trojan/BONKbot).
- **On-chain verifiable receipts/track record** = the trust model of on-chain asset management (dHEDGE verifiable positions, Enzyme on-chain fees, Index Coop public rebalances) — POD's `ReasoningLogger` maps here but **is deployed and never written to**.
- **Referral + fee-share** = the documented growth engine (Trojan 5-level 35%, Banana $BANANA 40% fee share) — design now, enable once execution charges a fee.
- **Honesty caveat:** ETF flow is a **lagging, medium-term** signal (Farside/CoinGlass). Frame the score as institutional-demand *context* with explicit confidence — honesty is itself a trust feature and a judging bonus (risk-control/security-awareness).

### 0.6 — Social-sentiment source: free vs paid (VERIFIED, 2026)

A social-sentiment input diversifies POD's composite (ETF flow is slow; social is fast). Options were checked; costs are real:

| Source | Free API? | Free limits | Data | Cost if paid |
|---|---|---|---|---|
| **CoinGecko Demo** | ✅ **Yes, real free key, no card** | 10k calls/mo, 100/min | Per-coin `sentiment_votes_up/down_%`, Twitter followers, Reddit subscribers/activity (momentum of these) | Pro from ~$129/mo |
| **Santiment Free** | ✅ Yes, no card | 1k calls/mo | Social volume / dominance / trending words — but **30-day lag** on free (useless for live) | Pro $49/mo (present-day), Max $249/mo (real-time) |
| **LunarCrush** | ❌ **No** — free "Discover" is dashboard-only, **no API key** | — | Galaxy Score, AltRank, deep per-coin social sentiment (the best signal) | **$90/mo** (Individual) min for a key; $300/mo (Builder) for all endpoints |
| **CryptoPanic** | ❌ Free API **discontinued Apr 1 2026** | — | News + PanicScore sentiment | Paid only now |

**Decision:** add **social sentiment as a free 6th source via CoinGecko Demo** (small weight, clearly labeled). It's shallow but real, free, ToS-clean, and keyable from the Node backend. **LunarCrush ($90/mo Galaxy Score) is the optional paid upgrade** if you later want a strong social signal — not a default, because it breaks the money constraint. Do **not** depend on scraping (agent-reach/Twitter/Reddit cookies): ban risk + can't run unattended in front of judges.

---

## Part 1 — Foundation fixes (P0, blocks everything)

> These are correctness, not features. Ship these first or the rest is built on sand.

- **P0-1 — Repair every SoSoValue source against a live key.** For each module (news, macro, treasury, fundraising, index, currency, crypto-stocks, charts): call the real documented path, align the Zod schema to the real fields, and write an integration test that asserts a non-empty, well-typed response with a real key. Acceptance: each of the 5 scoring sources returns a real contribution for at least BTC/ETH, and the composite z moves off 0.00. **Proof artifact:** a `sources-health` check that prints per-source `{ok, fields, sample}` for BTC/ETH/SOL.
- **P0-2 — Fix BTC ETF flow specifically.** BTC currently shows no ETF-flow line. Debug `summary-history` for `symbol=BTC, country_code=US` and confirm the latest row + 30d baseline. Acceptance: BTC reasoning shows an ETF-flow sentence with a real σ.
- **P0-3 — Rebuild the news source on real fields.** Replace the fake `sentiment` with an engagement/recency model: score tone from `matched_currencies` presence + `category` (institution/announcement vs KOL) + engagement velocity (`impression/retweet` counts) + recency decay. Cite `SoSoValue /news` with the item title/time.
- **P0-4 — Rebuild macro on the two-call model.** `/macro/events` for the calendar (names/dates) + `/macro/events/{event}/history` for actual/forecast/previous to compute a surprise. Keep the "event in next 48h → defensive" rule but back it with real event data.
- **P0-5 — Rebuild treasury on `purchase-history`.** Pull `/btc-treasuries` then per-ticker `purchase-history` for `btc_acq / avg_btc_cost`; compute 30-day corporate accumulation velocity. Add an "underwater treasuries" flag (avg cost vs live price).
- **P0-6 — Fix the SoDEX perps signing domain** (`perps` → `futures` in `signing.ts`). Add a perps signing test vector. Unblocks all perps features (Wave 3).
- **P0-7 — Expand `/api/scores` to all 10 tracked assets** and back it with the shared bubble cache (today it's a separate 3-asset path that returns HOLD/50). One source of truth for web + bot + API.
- **P0-8 — Write the on-chain hash on every score (`ReasoningLogger`).** The contract is deployed but never called. Wire the daily cron to log `keccak256(score payload)` to ValueChain and expose the tx hash in the drawer + API. Turns "deployed contract" into "used contract".
- **P0-9 — Retire or clearly mark the dead `apps/pod-bot/bot.ts`.** The live bot is the webhook route; the package copy is stale (emojis, no `/trade`). Make the package a thin import of shared handlers, or delete it, so there's one bot implementation.
- **P0-10 — Score-history persistence (free-tier Postgres: Neon/Supabase).** Daily cron writes each score. Unlocks the real 30-day trace, the leaderboard trend, and backtest — all currently "indicative". Small, free, high-leverage.
- **P0-11 — Add a free social-sentiment source (CoinGecko Demo) as the 6th composite input.** New source module `SOCIAL_SENTIMENT` (weight ~7%, small): z-score the momentum of per-coin up/down vote % + Twitter/Reddit activity vs its recent baseline; cite `CoinGecko /coins/{id}`. Makes the composite genuinely 6-source and adds a fast-moving signal to complement slow ETF flow. Keep the "N/M sources" confidence display honest. (Paid upgrade path documented: swap in LunarCrush Galaxy Score at $90/mo for a stronger signal — same interface.)

---

## Part 2 — The feature build (proven, PMF-ranked)

Each feature: **[criterion it lifts] · proof (who validated) · feasibility.** Grouped by surface.

### A. Signal quality & product logic (lifts 20% Logic + 30% User Value + 15% Data)

- **F1 — All-5-sources-live composite, shown honestly.** Post-P0, the drawer shows every source's real contribution with citation + a confidence badge (`N/5 sources`, uncertain rule). *Proof: Messari cited answers, aixbt thought logs. Feasible now.*
- **F2 — POD Score leaderboard** — all 10 assets ranked by score, sortable, with the 1-line why. The daily-open hook. *Proof: Kaito Mindshare / Nansen Smart Money. Feasible now.*
- **F3 — Score trend per asset (real history)** from P0-10. Replace the indicative line with real data + "score vs price" overlay. *Proof: every dashboard. Feasible after P0-10.*
- **F4 — Slippage-aware sizing** using `/currencies/{id}/pairs` ±2% depth: POD never suggests an order that moves price >2%; low-liquidity lowers confidence. *Proof: pro execution desks; unique data edge. Lifts 15% Data. Feasible now.*
- **F5 — Stablecoin liquidity tide** (`/analyses` stablecoin market cap) as a composite input: rising stables = dry powder → risk-on context. *Proof: CryptoQuant/Glassnode flow-as-pressure. Feasible now.*
- **F6 — Sector-rotation drawer** (`/currencies/sector-spotlight`): "capital rotating into X" + trending assets as `/score` candidates. *Proof: Nansen/Messari narrative views. Feasible now.*
- **F7 — Crypto-equity risk-on gauge** (`/crypto-stocks/sector/{btc treasury}/index`: price vs `btc_price` vs `nasdaq100_index`): flag when MSTR/COIN decouple from BTC. *Proof: macro desks; unused data. Lifts 15% Data. Feasible now.*
- **F8 — Unlock-cliff radar** (`/currencies/{id}/token-economics`): alert N days before a large vesting release. *Proof: Messari/Santiment unlock alerts. Feasible now.*
- **F9 — Corporate-accumulation ticker** (treasury `purchase-history`): "MSTR bought X BTC at $Y" + underwater flag. *Proof: Arkham entity-flow tracking. Feasible now.*
- **F10 — Confidence/uncertainty model, explicit.** Keep and strengthen the "lagging signal" honesty: label the score as institutional-demand context, show the confidence, never oversell. *Proof: honesty = trust (aixbt); judging risk-control bonus. Feasible now.*
- **F35 — Social-sentiment signal (free, 6th source).** CoinGecko Demo per-coin sentiment-vote + social-activity momentum, z-scored, small weight, labeled "social" and separated from institutional sources in the drawer so users see fast-crowd vs slow-institution. *Proof: LunarCrush Galaxy Score / Kaito mindshare demand — delivered on a free source. Lifts 15% Data + User Value. Feasible now.*

### B. Telegram execution & retention (lifts 30% User Value + 25% Demo)

- **F11 — Auto in-bot wallet on `/start`.** Generate a ValueChain keypair per Telegram user, encrypted at rest, show deposit address, enable gas-free trading. Replaces the custodial single-key `/trade`. **The single biggest conversion unlock.** *Proof: Trojan/Maestro/Banana 500k+ users each. Feasible on testnet (keygen + encrypted store; no paid service needed).*
- **F12 — Preset one-tap orders.** After a score, show "Buy 25 / 50 / 100 USDC" preset buttons → straight to a SoDEX market buy on the reliable pair, with slippage-aware size (F4). *Proof: universal in every top bot. Feasible now.*
- **F13 — Server-side TP/SL bracket (spot-emulated).** On a POD buy: market entry + resting GTC limit-sell at TP + a backend watcher that market-sells on stop breach (spot has no native TP/SL). Runs 24/7 with Telegram closed. **The #1 retention feature.** *Proof: Trojan. Feasible now (spot); upgrade to native perps bracket in Wave 3.*
- **F14 — Real-time fill receipts via WS.** Subscribe `account-order-updates` after an order; render the actual FILLED event + orderID (not "accepted"). *Proof: turns demo from "submitted" to "executed" — lifts 25% Demo. Feasible now.*
- **F15 — Score-triggered Telegram alerts (`/alerts`).** Subscribe to "BTC score crosses 65" or "ETF flow flips sign" → push. Recurring daily-active driver, cheapest retention. *Proof: Whale Alert 310k, Nansen Smart Alerts. Feasible now.*
- **F16 — `/ask` natural-language Q&A** grounded ONLY in POD data, with citations ("is smart money accumulating BTC?" → cites ETF flow + treasury). No invented numbers. *Proof: aixbt Terminal, Bankr; most-used AI pattern. Lifts AI bonus + 30% User Value. Feasible now (NVIDIA NIM already wired).*
- **F17 — DCA schedule.** "DCA $5 into BTC while score > 60" — backend places recurring market buys, stops when the rule breaks. *Proof: Trojan/Maestro DCA; retail set-and-forget demand. Feasible now.*
- **F18 — Portfolio & PnL view** (`/portfolio`): read SoDEX balances + entry prices → live PnL per holding. *Proof: every bot's daily surface. Feasible now.*
- **F19 — Dead-man safety switch** (`scheduleCancel`): "auto-cancel my resting orders in N min if I don't check in." *Proof: pro risk tooling; judging security-awareness bonus. Feasible now (signed, deterministic, no fill needed).*
- **F20 — Shareable score/PnL cards.** Render a branded OG image ("POD Score 78 → BTC long → +4.2%") shareable to X/Telegram. *Proof: Trojan/BONKbot viral loop. Lifts UX + growth. Feasible now (Next OG image).*

### C. Web dashboard (lifts 10% UX + 25% Demo)

- **F21 — Per-issuer ETF flow table** (Farside-grade): issuer × day net flow, sortable, flow-vs-price overlay, the canonical institutional artifact done beautifully. *Proof: Farside most-screenshotted. Feasible now (`/etfs` + per-ticker snapshot).*
- **F22 — Bubble dashboard polish pass** to the `pod-home-1440.png` bar: drawer completeness (all real sources), mobile bottom-sheet, dark mode, reduce-motion, keyboard/screen-reader list. *Proof: CLAUDE.md visual bar. Feasible now.*
- **F23 — Per-asset page = full institutional card**: score gauge, real reasoning w/ citations, every source contribution, target basket, real score trace (F3), cycle-position badge (0.3.4), unlock radar (F8), liquidity/slippage (F4), and the on-chain log tx (P0-8). *Proof: Nansen token-god-mode density. Feasible now.*
- **F24 — SSI index co-pilot page.** Read `/indices`, show ROI-ladder leaderboard of SoSoValue baskets, recompute NAV from live constituents, show drift vs official snapshot, and a "replicate this basket on SoDEX" button that sizes weighted legs. *Proof: Index Coop/Set/SSI "one-token strategy". Lifts 15% Data heavily. Feasible now (read) + Wave 2 (replicate execution).*
- **F25 — Public methodology page** updated to the real, now-working math + honest limits + real API limits (100k/mo). *Proof: Messari standardized reports; verifiability. Feasible now.*

### D. On-chain proof & trust (lifts 20% Logic + 15% Data + risk-control bonus)

- **F26 — Verifiable score receipts.** Every score's data hash on `ReasoningLogger` (P0-8) with a public "verify this score" path (recompute hash → compare on-chain). *Proof: dHEDGE/Enzyme verifiable-everything. Feasible now.*
- **F27 — Public signal track record.** From score-history (P0-10): "POD score vs next-N-day outcome" ledger, honest hit-rate shown (aixbt-style). *Proof: aixbt transparency earns trust despite ~31% hit rate. Feasible after P0-10 accrues data.*
- **F28 — `DrawdownGuard` wired to the basket design.** Enforce the risk-profile max-drawdown as an on-chain guard for the vault path. *Proof: Index Coop drawdown limits; risk-control bonus. Feasible now (contract deployed).*

### E. Data/API product & agent-friendliness (lifts 15% Data + AI bonus)

- **F29 — Clean public API** = 10-asset scores + per-source breakdown + flow tables + on-chain hashes, documented. *Proof: DeFiLlama/Kaiko/Messari API as credibility line. Feasible now.*
- **F30 — MCP server over POD data** ("agent-friendly ValueChain" framing): expose `getScore`, `getFlows`, `ask` as MCP tools so any LLM/agent can query POD. *Proof: Glassnode MCP; matches SoSoValue's agentic-finance theme. Lifts AI bonus. Feasible now.*
- **F31 — Webhook alerts** (TradingView pattern): fire POD score events to a user webhook → the "signal → action" bridge retail understands. *Proof: TradingView alerts. Feasible now.*

### F. Growth loops (defer until execution charges a fee; design schema now)

- **F32 — Multi-level referral** on SoDEX trade fees + referee fee discount. *Proof: Trojan 5-level 35%, BONKbot tiered. Design now, enable with fees.*
- **F33 — Fee revenue-share** to a future POD token/holders. *Proof: Banana $BANANA 40% share. Design later.*
- **F34 — Copy-the-regime (not blind copy).** "Follow institutional accumulation" auto-order rule + leaderboard of POD signals' historical performance — the defensible, verifiable version of copy-trading. *Proof: eToro 30M users, but Nansen notes blind copy is hard → signal-led is better. Feasible after P0-10.*

### G. Completeness sweep — remaining proven patterns (so nothing validated is left out)

- **F36 — Multi-wallet management.** Let a Telegram user hold several in-bot wallets (trade / hold / test), switch active wallet. *Proof: Trojan (up to 10 wallets). Extends F11. Feasible now.*
- **F37 — Freshness / real-time tier as the monetization seam.** Free = daily/delayed score + daily flow; a "Pro" gate = real-time score refresh + instant alerts + `/ask` priority. Design the gate now even if everything is free during the buildathon. *Proof: CryptoQuant real-time paywall, Glassnode/Nansen free-vs-paid funnels. Feasible now (feature-flag).* 
- **F38 — Issuer-as-named-entity on ETF flows.** Present flows as "BlackRock / IBIT", "Fidelity / FBTC" with per-issuer trend + alerts, not raw tickers. *Proof: Arkham (750k+ entities, ETF-issuer tracking) — named entities beat hex/tickers. Extends F21. Feasible now (`/etfs` per-ticker).*
- **F39 — Grid / limit-ladder execution presets.** Package the batch limit ladder (F12/F13) as named presets ("ladder 5 buys −1%…−5%", "scale-out grid"). *Proof: retail grid-bot demand (3Commas/Bitget); SoDEX supports 100-order batches. Feasible now.*
- **F40 — Wallet security surface.** Encrypted key storage, `/export` with confirmation, optional 2FA, and the dead-man switch (F19) surfaced as a "safety" menu. *Proof: every top bot ships security settings; judging security-awareness bonus. Feasible now.*
- **F41 — Curated-universe safety framing (POD's built-in anti-scam edge).** POD only scores the 10 spot-ETF coins — no honeypots, no rugs, no random contract addresses. Make this an explicit trust point vs meme-bot roulette. *Proof: anti-rug/honeypot is a headline trust feature for Banana/Trojan; POD gets it for free by construction. Feasible now (copy/positioning).*
- **F42 — Onboarding-to-first-score in <30s, measured.** First `/start` → wallet → live score → one-tap order path instrumented and kept under 30s. *Proof: bot onboarding speed = conversion (Trojan/Maestro). Lifts 10% UX. Feasible now.*

### H. UX-layer PMF — same engine, pure packaging (the "payment link" layer)

> These need **no new data or engine work** — they repackage the existing score + trade into shareable, one-tap, deep-linked surfaces. This is where most viral growth actually comes from (Stripe payment links, Cash App `$cashtag`, Dune shareable dashboards, Trojan PnL cards). Every item below rides on the engine POD already has.

- **F43 — Telegram inline mode (POD's "payment link").** Type `@podbot BTC` in *any* chat → the bot posts a live POD score card inline, no install needed. The single highest-leverage viral UX for a Telegram product — the score spreads into the exact trading group chats POD targets. *Proof: inline bots (@gif, trading-bot share cards); Stripe/CashApp shareable-artifact growth loop. Same engine. Feasible now.*
- **F44 — Shareable permalinks + deep links for every score, trade, and basket.** Each score = a public URL (`/asset/BTC?share=…`) **and** a Telegram deep link (`t.me/podbot?start=score-BTC`). "Share this score / share my trade / share this basket" turns any action into a link that opens the exact view — web↔bot bridged both ways. *Proof: payment links, Farside screenshots, Dune share URLs. Same engine. Feasible now.*
- **F45 — Auto-generated share cards on every action** (extends F20): score card, trade/PnL card, leaderboard card, basket card — each rendered as an OG image with a back-link. Every screenshot is an ad. *Proof: Trojan/BONKbot PnL cards. Same engine. Feasible now.*
- **F46 — Embeddable live score badge/widget.** A one-line embed (or image URL) that shows a coin's live POD score on a site, blog, or X bio — auto-updating. *Proof: Stripe "buy button" embeds, TradingView widgets, DeFiLlama embeds. Same engine. Feasible now.*
- **F47 — Watchlist + per-holding alerts.** User stars coins → personalized leaderboard + "your BTC score just crossed 70" pushes. Personalization = daily return. *Proof: CoinStats/Delta watchlists. Same engine (alerts F15). Feasible now.*
- **F48 — Daily digest / morning briefing push.** Scheduled "your POD morning read: top mover, biggest flow, your watchlist" to Telegram. *Proof: Whale Alert feed (310k), newsletter cadence. Same engine (score-history + cron). Feasible now.*
- **F49 — QR + "Open in Telegram" bridges.** QR for wallet deposit; every web view has an "open in bot" deep link; every bot card has a "view on web" link. Frictionless cross-surface. *Proof: bot onboarding UX (Trojan deposit QR). Same engine. Feasible now.*
- **F50 — "Copy this basket / follow this signal" link.** A shareable link that opens the bot pre-loaded with a basket's preset orders or an alert subscription — one tap from seeing it to acting on it. *Proof: eToro copy links, Set/TokenSets share. Same engine. Feasible now.*
- **F51 — Public shareable profile / track-record page.** "podscore.xyz/u/handle" showing a user's followed signals + honest performance — a link they post. *Proof: eToro trader profiles, dHEDGE manager pages. Same engine (F27). Feasible after P0-10.*

**These 9 UX features are the difference between "an engine that computes a score" and "a product thousands of people share and open daily." None require touching the scoring engine or the API integration — only the presentation layer.**

---

## Part 3 — Judging-criteria headroom map

Where POD has the most to gain and which features close each gap.

| Weight | Criterion | Current gap | Features that close it |
|---|---|---|---|
| **30%** | User Value & Practical Impact | Scores are neutral/dead → little real value delivered today | P0-1..5 (real signal), F11 wallet, F12 one-tap, F13 TP/SL, F15 alerts, F16 ask, F17 DCA |
| **25%** | Functionality & Working Demo | Trade path works but signal is hollow; "submitted" not "filled" | P0-1..7, F14 fill receipts, F21 flow table, F23 asset page, F24 replicate |
| **20%** | Logic, Workflow & Product Design | Composite runs on ~1 source; contract unused; no real history | P0-1..10, F1 honest composite, F10 confidence, F26 receipts, F27 track record, F28 drawdown |
| **15%** | Data / API Integration | Using a fraction of SoSoValue; no perps; contract not written; no WS | F4 depth, F5 stablecoin, F6 sector, F7 equity, F8 unlock, F24 SSI, P0-6 perps, P0-8 log, F14 WS, F29/F30 API+MCP |
| **10%** | UX & Clarity | Good bones; drawer half-empty because sources empty | F22 polish, F23 density, F20 share cards, F25 methodology, F2 leaderboard |

**Biggest headroom = User Value + Data Integration.** Both are unlocked primarily by P0 (make the signal real) + the SoSoValue-data features (F4–F9, F24) + the Telegram execution stack (F11–F17).

---

## Part 4 — Sequencing (waves)

No time limit, but ordered by dependency and judge-impact-per-unit-effort.

**Wave 0 — Make it true (P0-1..10).** Sources live, composite real, `/api/scores` 10 assets, on-chain log written, history persisted, perps domain fixed, one bot. *Without this, every demo screen shows 50/uncertain.*

**Wave 1 — Signal depth + Telegram execution.** F1, F2, F4, F5, F6, F10 (signal) + F11, F12, F13, F14, F15, F16, F18, F19, F20 (bot). This is the product: real institutional composite → one-tap execution → 24/7 TP/SL → alerts → ask → share. Hits User Value + Demo hardest.

**Wave 2 — Web depth + data breadth + proof.** F3, F7, F8, F9, F21, F22, F23, F24, F25, F26, F28, F29. The dashboard becomes an institutional terminal; unused SoSoValue data lands; on-chain proof visible.

**Wave 3 — Perps + advanced execution.** After P0-6 + perps funding: native perps TP/SL bracket, perps hedge on defensive score, leverage controls. Adds SoDEX-perps API coverage (bonus).

**Wave 4 — Agent surface + growth.** F17 DCA, F27 track record, F30 MCP, F31 webhooks, F34 copy-the-regime; design F32/F33 referral/fee-share schema.

---

## Part 5 — Scope guardrails (what NOT to build, and real blockers)

**Do not build** (fails PMF or feasibility):
- An "index publisher" — SoSoValue API is read-only, no write path. Build the **index co-pilot** (F24) instead.
- Blind wallet copy-trading — speed/gas/impact make it weak (Nansen's own caution). Do **copy-the-regime** (F34).
- Mainnet trading, real-money vaults, real liquidity provision — money blocker; stay testnet, say so honestly.
- Hedge-mode perps, LAST_PRICE/INDEX triggers, FOK — SoDEX marks these "not supported yet".

**Real external blockers to state honestly:**
- Per-user non-custodial wallets via a provider (Privy/Turnkey) — F11 uses server-side keygen (custodial, fine for testnet) to avoid a paid dependency; note the non-custodial upgrade path.
- Real trade fees / referral payouts (F32/F33) — need a fee mechanism + mainnet economics; design schema, defer enablement.
- Longer score history (F3/F27) — needs the daily cron to accrue for weeks; P0-10 starts the clock now.
- Strong social sentiment (LunarCrush Galaxy Score) — **$90/mo**, breaks the money constraint. Ship the free CoinGecko source (F35) now; the source interface is identical, so LunarCrush is a drop-in swap if funded later. Do **not** scrape Twitter/Reddit (agent-reach/cookies) — ban risk + can't run unattended for judges.

---

## Part 6 — One-line thesis to carry into every doc/demo

> POD reads the institutional signals SoSoValue exposes — ETF flow, macro surprise, corporate BTC accumulation, unlock schedules, order-book depth, sector rotation, stablecoin liquidity — plus a free social-sentiment layer, and fuses them into one honest, cited POD Score across ten coins. Then it lets a user act on it in Telegram in one tap: auto-wallet, preset order on SoDEX, 24/7 TP/SL, and an on-chain receipt anyone can verify. Signal → reason → execute → prove, run by one person on testnet — every feature borrowed from a product that already proved the demand.
