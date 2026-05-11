#!/usr/bin/env bash
# POD one-shot deploy script.
# Idempotent — safe to re-run.
#
# Prereqs:
#   - .env populated (SOSOVALUE_API_KEY, TELEGRAM_BOT_TOKEN, NVIDIA_API_KEY,
#     DEPLOYER_PRIVATE_KEY, VALUECHAIN_TESTNET_RPC)
#   - vercel CLI logged in (run: vercel login)
#   - foundry installed (run: curl -L https://foundry.paradigm.xyz | bash && foundryup)
#   - deployer wallet funded with testnet SOSO from https://testnet.sodex.com/faucet

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# Load .env
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

step() {
  printf "\n\033[1;36m▶ %s\033[0m\n" "$1"
}

ok() { printf "\033[1;32m✓\033[0m %s\n" "$1"; }
warn() { printf "\033[1;33m⚠\033[0m %s\n" "$1"; }
fail() { printf "\033[1;31m✗\033[0m %s\n" "$1"; exit 1; }

# ── 1. Tests ─────────────────────────────────────────────────────────────────
step "1/6  Running tests"
pnpm install --frozen-lockfile
pnpm -r test
( cd packages/pod-contracts && forge test )
ok "All tests passing"

# ── 2. Build SDKs ────────────────────────────────────────────────────────────
step "2/6  Building SDKs"
pnpm --filter @pod/sosovalue-sdk build
pnpm --filter @pod/sodex-sdk build
pnpm --filter @pod/signal-engine build
ok "SDK builds complete"

# ── 3. Deploy contracts to ValueChain testnet ───────────────────────────────
step "3/6  Deploying contracts to ValueChain testnet"
if [ -z "${DEPLOYER_PRIVATE_KEY:-}" ] || [ -z "${VALUECHAIN_TESTNET_RPC:-}" ]; then
  warn "Skipping: DEPLOYER_PRIVATE_KEY or VALUECHAIN_TESTNET_RPC not set"
else
  cd packages/pod-contracts
  DEPLOYER_ADDR=$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")
  BAL=$(cast balance "$DEPLOYER_ADDR" --rpc-url "$VALUECHAIN_TESTNET_RPC" 2>/dev/null || echo 0)
  if [ "$BAL" = "0" ]; then
    warn "Deployer $DEPLOYER_ADDR has 0 SOSO on testnet."
    warn "Fund it via https://testnet.sodex.com/faucet then re-run."
  else
    forge script script/Deploy.s.sol:DeployScript \
      --rpc-url "$VALUECHAIN_TESTNET_RPC" \
      --broadcast -vvv | tee /tmp/pod-deploy.log
    LOGGER=$(grep -oE 'ReasoningLogger: 0x[a-fA-F0-9]+' /tmp/pod-deploy.log | tail -1 | awk '{print $2}')
    GUARD=$(grep -oE 'DrawdownGuard: 0x[a-fA-F0-9]+' /tmp/pod-deploy.log | tail -1 | awk '{print $2}')
    ok "ReasoningLogger: $LOGGER"
    ok "DrawdownGuard:   $GUARD"
    # Persist addresses to root .env
    cd "$ROOT"
    if grep -q '^REASONING_LOGGER_ADDRESS=' .env; then
      sed -i "s|^REASONING_LOGGER_ADDRESS=.*|REASONING_LOGGER_ADDRESS=$LOGGER|" .env
    else
      echo "REASONING_LOGGER_ADDRESS=$LOGGER" >> .env
    fi
    if grep -q '^DRAWDOWN_GUARD_ADDRESS=' .env; then
      sed -i "s|^DRAWDOWN_GUARD_ADDRESS=.*|DRAWDOWN_GUARD_ADDRESS=$GUARD|" .env
    else
      echo "DRAWDOWN_GUARD_ADDRESS=$GUARD" >> .env
    fi
  fi
fi
cd "$ROOT"

# ── 4. Push env vars to Vercel ───────────────────────────────────────────────
step "4/6  Syncing env vars to Vercel"
push_env() {
  local key="$1"
  local value="${!key:-}"
  if [ -z "$value" ]; then
    warn "Skipping $key (empty)"
    return
  fi
  echo "$value" | vercel env add "$key" production --force >/dev/null 2>&1 && ok "$key" || warn "$key (may already be set)"
}
push_env SOSOVALUE_API_KEY
push_env NVIDIA_API_KEY
push_env NVIDIA_BASE_URL
push_env NVIDIA_MODEL
push_env TELEGRAM_BOT_TOKEN
push_env TELEGRAM_BOT_USERNAME
push_env TELEGRAM_WEBHOOK_SECRET
push_env CRON_SECRET
push_env REASONING_LOGGER_ADDRESS
push_env DRAWDOWN_GUARD_ADDRESS

# ── 5. Deploy to Vercel (production) ─────────────────────────────────────────
step "5/6  Deploying web + functions to Vercel"
DEPLOY_URL=$(vercel deploy --prod --yes | tail -1 | tr -d '\r' )
ok "Deployed: $DEPLOY_URL"

# ── 6. Set Telegram webhook ──────────────────────────────────────────────────
step "6/6  Pointing Telegram webhook at production"
if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  warn "Skipping: TELEGRAM_BOT_TOKEN not set"
else
  WEBHOOK_URL="${DEPLOY_URL}/api/telegram"
  RESP=$(curl -s -F "url=$WEBHOOK_URL" \
    ${TELEGRAM_WEBHOOK_SECRET:+-F "secret_token=$TELEGRAM_WEBHOOK_SECRET"} \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook")
  if echo "$RESP" | grep -q '"ok":true'; then
    ok "Telegram webhook set to $WEBHOOK_URL"
  else
    warn "Webhook setup response: $RESP"
  fi
fi

printf "\n\033[1;32m🚀 Deploy complete.\033[0m  Visit %s\n" "$DEPLOY_URL"
