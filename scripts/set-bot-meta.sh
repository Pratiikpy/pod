#!/usr/bin/env bash
# Set Telegram bot metadata (commands, description, short description).
set -e
TOKEN="${TELEGRAM_BOT_TOKEN:-8744661042:AAHY4_Vi_yeSsf7JxRfDtfWTBr39BmXiycs}"

curl -s -X POST "https://api.telegram.org/bot${TOKEN}/setMyCommands" \
  -H "Content-Type: application/json; charset=utf-8" \
  --data-binary @- <<'JSON'
{
  "commands": [
    {"command": "start", "description": "Pick your risk profile to begin"},
    {"command": "signal", "description": "Live BTC POD Score with AI reasoning"},
    {"command": "score", "description": "Quick score lookup BTC ETH or SOL"},
    {"command": "trade", "description": "Execute on SoDEX testnet"},
    {"command": "lang", "description": "Change language en zh ja ko"},
    {"command": "help", "description": "Show all commands"}
  ]
}
JSON
echo
curl -s -X POST "https://api.telegram.org/bot${TOKEN}/setMyDescription" \
  -H "Content-Type: application/json; charset=utf-8" \
  --data-binary @- <<'JSON'
{
  "description": "POD turns Wall Street ETF flow data into AI-narrated crypto signals. Pick a risk profile, tap signal, get a real trading recommendation grounded in live SoSoValue institutional data. Built for the SoSoValue Buildathon 2026."
}
JSON
echo
