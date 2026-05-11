#!/usr/bin/env bash
# End-to-end test of the deployed POD bot via pure HTTP — no imports.
# Tests: production endpoints, Telegram webhook config, signal pipeline,
# AI narration, SoDEX trading flow.
set -e

LIVE="https://pod-app-phi.vercel.app"
source .env 2>/dev/null || source ../.env 2>/dev/null || true

OK=0
FAIL=0
log_ok()   { printf "✅  %-50s %s\n" "$1" "$2"; OK=$((OK+1)); }
log_fail() { printf "❌  %-50s %s\n" "$1" "$2"; FAIL=$((FAIL+1)); }

echo "🧪 POD bot end-to-end (production)"
echo

# ── 1. Production endpoints ───────────────────────────────────────────────
status=$(curl -s -o /dev/null -w "%{http_code}" "$LIVE/")
[ "$status" = "200" ] && log_ok "Homepage" "200" || log_fail "Homepage" "HTTP $status"

scores=$(curl -s "$LIVE/api/scores")
btc=$(echo "$scores" | grep -oE '"BTC"[^}]*"podScore":[0-9]+' | head -1)
[ -n "$btc" ] && log_ok "/api/scores serving live data" "$btc" || log_fail "/api/scores" "no BTC score"

webhook=$(curl -s "$LIVE/api/telegram")
echo "$webhook" | grep -q '"ok":true' && log_ok "/api/telegram health" "ok" || log_fail "/api/telegram" "$webhook"

# ── 2. Telegram bot configuration ─────────────────────────────────────────
hookinfo=$(curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo")
echo "$hookinfo" | grep -q "$LIVE/api/telegram" && \
  log_ok "Telegram webhook bound to prod" "$(echo "$hookinfo" | grep -oE '"url":"[^"]+"')" || \
  log_fail "Telegram webhook" "$hookinfo"

botdesc=$(curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMyDescription")
echo "$botdesc" | grep -q "one-person" && \
  log_ok "Bot description has one-person framing" "ok" || \
  log_fail "Bot description" "$botdesc"

cmds=$(curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMyCommands")
echo "$cmds" | grep -q '"trade"' && \
  log_ok "Bot has /trade command registered" "ok" || \
  log_fail "Bot commands" "/trade missing"

# ── 3. SoSoValue API (what /signal pulls from) ────────────────────────────
sso_etf=$(curl -s "https://openapi.sosovalue.com/openapi/v1/etfs/summary-history?symbol=BTC&country_code=US&limit=3" \
  -H "x-soso-api-key: $SOSOVALUE_API_KEY")
echo "$sso_etf" | grep -q '"data"' && \
  log_ok "SoSoValue API · BTC ETF flow" "live" || \
  log_fail "SoSoValue API" "$sso_etf"

# ── 4. NVIDIA NIM (AI narration) ──────────────────────────────────────────
nim_status=$(curl -s -o /tmp/nim.txt -w "%{http_code}" \
  -X POST "$NVIDIA_BASE_URL/chat/completions" \
  -H "Authorization: Bearer $NVIDIA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"meta/llama-3.3-70b-instruct","messages":[{"role":"user","content":"Reply: ok"}],"max_tokens":10}')
[ "$nim_status" = "200" ] && \
  log_ok "NVIDIA NIM · LLM call" "200 OK" || \
  log_fail "NVIDIA NIM" "HTTP $nim_status: $(head -c 200 /tmp/nim.txt)"

# ── 5. SoDEX testnet (what /trade uses) ───────────────────────────────────
sdx_state=$(curl -s "https://testnet-gw.sodex.dev/api/v1/spot/accounts/0x85987DE711B660d2452AA80D4cBfb2b18981CaaB/state")
aid=$(echo "$sdx_state" | grep -oE '"aid":[0-9]+' | head -1)
[ -n "$aid" ] && log_ok "SoDEX · account state lookup" "$aid" || log_fail "SoDEX state" "$sdx_state"

sdx_bal=$(curl -s "https://testnet-gw.sodex.dev/api/v1/spot/accounts/0x85987DE711B660d2452AA80D4cBfb2b18981CaaB/balances")
echo "$sdx_bal" | grep -q '"vUSDC"' && \
  log_ok "SoDEX · vUSDC balance present" "$(echo "$sdx_bal" | grep -oE '"total":"[^"]+"' | head -1)" || \
  log_fail "SoDEX balances" "$sdx_bal"

# ── 6. Summary ────────────────────────────────────────────────────────────
echo
echo "Result: $OK ok · $FAIL fail / $((OK+FAIL)) total"
exit $FAIL
