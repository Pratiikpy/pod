# Demo readiness pass — 2026-08-19

Full functional + visual test of the live site and the Telegram bot ahead of the
Wave-3 Top-10 feature, plus the fixes that came out of it. Everything below was
checked against production (`pod-app-phi.vercel.app`, `@podttest_bot`), not from
code reading.

## Security incident (found and closed)

The bot token had been committed in `scripts/set-bot-meta.sh` since the repo's
first commit, in a public repository. Someone used it: the bot's description was
replaced with a scam ad, its command list with a casino link, and the **webhook
was re-pointed to `ssh.inkognit.org`** — meaning user messages, including
anything sent to `/import`, went to a third party for an unknown period.

Closed out the same day: token revoked and rotated, webhook restored and now
secret-authenticated, description and commands restored, the hardcoded token
removed from the script, `CRON_SECRET` and `TELEGRAM_WEBHOOK_SECRET` generated
and set, and all other Telegram sessions terminated.

Still outstanding for the operator: enable Two-Step Verification on the Telegram
account, and treat any wallet key sent to `/import` before this date as
compromised.

## What was broken and is now fixed

| Area | Problem | Fix |
|---|---|---|
| Bot AI | `/ask` and `/signal` returned "could not reach the model". 0G is out of credit (HTTP 402) and the configured NIM model hangs; the provider chain only chose by which key existed, never failed over at request time. | Real runtime fallback with a per-provider timeout, and NVIDIA repointed to a model that responds. |
| Landing page | ETF flow chart, "MSTR +1.2k BTC", "CPI clear", "Today +$381M" and the BTC/ETH/SOL prices were all hardcoded — BTC showed $108,420 against a real $64,385, under a "live SoSoValue feed" label. | Every number now comes from the API: real 14-day flow series, real spot prices, real per-source σ chips, real recorded score traces. |
| Methodology | `/how-it-works` documented five sources with weights (0.40/0.20/0.15/0.20/0.05) that matched neither the engine nor the README, listed VC funding (not used) and omitted stablecoins and social (both used). | Rewritten to the six sources the engine actually runs, at their real weights. |
| Score consistency | `/api/scores` was HTTP-cached separately from `/bubbles`, so the two published different scores for the same moment, and the API stamped `generated_at: now()` on scores computed up to ten minutes earlier. | Both read the one shared cache; the timestamp is the real computation time. Homepage aligned too. |
| Score quality | A cache refill landing while the SoSoValue keys were rate-limited published a collapsed read — average 1.0 live sources, four coins flat at 50, all ten flagged low-confidence — and that stuck for the whole cache window. | The last healthy fan-out is persisted and served whenever a refill collapses. Baseline seeded at coverage 29. |
| Asset page | The 30-day trace was a deterministic placeholder even though real history existed. | Plots the real recorded scores; says so plainly when a coin has none yet. |
| Navigation | Nine pages each defined their own nav with different links; `/flows`, `/ssi` and `/intel` only linked home, so a visitor landed in a dead end. | One shared `SiteNav` with the full link set and active state, used everywhere. |
| Leaderboard | Seven of ten rows rendered a "?" placeholder glyph. | Brand glyphs for all ten assets. |
| Bubbles | The field overflowed the fold (page scrolled, cluster cut off) and settled as a hollow ring. | Sized to the space left on screen; centre pull weighted by market rank. |
| Deep links | Drawer and asset-page Telegram CTAs sent `?start=score_BTC` while the bot matched `score-`, so both silently did nothing. | Corrected; verified the bot answers the deep link. |
| Source link | "Source on GitHub" pointed at `Pratiikpy/Stealth-AP`, a different project. | Points at this repo. |

## Verified working

- **All 19 routes** return 200 (`/asset/NOPE` correctly 404s), warm responses 0.15–1.7s.
- **Signal → execution, end to end**: `/trade` → Confirm → real SoDEX testnet order
  `1283205629`, independently confirmed on the venue as **0.00009 BTC filled for $5.80**
  (IOC cancels the remainder, which is expected).
- **On-chain receipt**: tx `0xbafe5fcc…dba27303` verified on ValueChain — status success,
  block 11811822, calling the `ReasoningLogger` contract, entry #422.
- **28 bot commands** answered 200; `/score`, `/signal`, `/ask`, wallet, watchlist, DCA,
  TP/SL, alerts, referral, language, and the junk/invalid-input paths.
- **Inline mode** returns a live card in any chat.
- **Mobile** (390×844): layout, wrapped nav, and the bottom-sheet drawer all correct.
- **Cross-surface agreement**: `/api/scores`, `/bubbles`, the homepage and the embed badge
  all publish identical scores.
- **Track record**: 430 scores recorded, all 430 anchored on-chain, 41 days of history.
- **Tests**: 66 passing (sosovalue-sdk 5, sodex-sdk 9, signal-engine 38, pod-bot 14).

## Known limitations (unchanged, and stated honestly in the product)

- Social sentiment drops out on roughly half the coins because CoinGecko's keyless
  free tier rate-limits a ten-coin burst. A free CoinGecko demo key removes this.
- Macro and treasury sources are legitimately silent when there is no tier-1 event in
  48h and no corporate BTC buying in 30 days. Both say so on the coin's page.
- Small-cap ETFs (DOT, LTC, HBAR, AVAX) genuinely have near-zero flow, so those coins
  carry fewer live sources and are flagged low confidence.
- Trading still uses one shared demo wallet on testnet.
