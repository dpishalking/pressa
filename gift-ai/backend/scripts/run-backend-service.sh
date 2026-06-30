#!/bin/bash
# Постоянный запуск Gift AI API (алерты РОПа + бот)
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="/tmp/pressa-gift-ai-api.log"

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

cd "$BACKEND_DIR"

{
  echo "=== $(date '+%Y-%m-%d %H:%M:%S %Z') API start ==="
  npm run build
  exec node --env-file=.env dist/index.js
} >> "$LOG_FILE" 2>&1
