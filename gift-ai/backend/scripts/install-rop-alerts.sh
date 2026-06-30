#!/bin/bash
# Полная установка алертов РОПа: .env + API + туннель + инструкция Bitrix
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$BACKEND_DIR"

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

PUBLIC_URL=""
TUNNEL_PID=""

cleanup() {
  if [[ -n "$TUNNEL_PID" ]] && kill -0 "$TUNNEL_PID" 2>/dev/null; then
    kill "$TUNNEL_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

wait_for_health() {
  local url="$1"
  for _ in $(seq 1 30); do
    if curl -sf "$url/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

patch_env_public_url() {
  local url="${1%/}"
  local env_file="$BACKEND_DIR/.env"
  if grep -q '^PUBLIC_API_URL=' "$env_file" 2>/dev/null; then
    sed -i '' "s|^PUBLIC_API_URL=.*|PUBLIC_API_URL=$url|" "$env_file"
  else
    echo "PUBLIC_API_URL=$url" >>"$env_file"
  fi
  launchctl kickstart -k "gui/$(id -u)/com.pressa.gift-ai-api" 2>/dev/null || true
}

start_localtunnel() {
  if ! command -v npx >/dev/null 2>&1; then
    return 1
  fi

  local log="/tmp/pressa-localtunnel.log"
  npx --yes localtunnel --port 3100 >"$log" 2>&1 &
  TUNNEL_PID=$!

  for _ in $(seq 1 60); do
    local url
    url=$(grep -oE 'https://[a-z0-9-]+\.loca\.lt' "$log" | head -1 || true)
    if [[ -n "$url" ]]; then
      PUBLIC_URL="$url"
      echo "Туннель (localtunnel): $PUBLIC_URL"
      return 0
    fi
    sleep 1
  done
  return 1
}

start_cloudflared_tunnel() {
  if ! command -v cloudflared >/dev/null 2>&1; then
    echo "cloudflared не найден — пропускаем туннель"
    return 1
  fi

  local log="/tmp/pressa-cloudflared.log"
  cloudflared tunnel --url http://localhost:3100 >"$log" 2>&1 &
  TUNNEL_PID=$!

  for _ in $(seq 1 45); do
    local url
    url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$log" | head -1 || true)
    if [[ -n "$url" ]]; then
      PUBLIC_URL="$url"
      echo "Туннель: $PUBLIC_URL"
      return 0
    fi
    sleep 1
  done
  return 1
}

echo "=== Установка алертов РОПа ==="
echo ""

# 1. API как сервис
"$SCRIPT_DIR/install-backend-service.sh"
echo ""

# 2. Ждём health
if ! wait_for_health "http://localhost:3100"; then
  echo "❌ API не отвечает на :3100 — смотрите /tmp/pressa-gift-ai-api.log"
  exit 1
fi
echo "✓ API отвечает на localhost:3100"
echo ""

# 3. Публичный URL
if [[ -z "${PUBLIC_API_URL:-}" ]]; then
  if start_cloudflared_tunnel; then
    :
  elif start_localtunnel; then
    :
  else
    echo "⚠️  Не удалось поднять туннель. Установите cloudflared: brew install cloudflared"
    echo "   или задайте PUBLIC_API_URL в .env (Railway URL)"
    PUBLIC_URL="http://localhost:3100"
  fi
else
  PUBLIC_URL="${PUBLIC_API_URL%/}"
  echo "Используем PUBLIC_API_URL=$PUBLIC_URL"
fi

# 4. Bootstrap .env + Telegram тест + инструкция Bitrix
npm run bootstrap-rop-alerts -- --public-url="$PUBLIC_URL"

if [[ "$PUBLIC_URL" != http://localhost* ]]; then
  patch_env_public_url "$PUBLIC_URL"
fi

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  Готово. Осталось только сохранить webhook в Bitrix (см. выше)."
if [[ -n "$TUNNEL_PID" ]] && kill -0 "$TUNNEL_PID" 2>/dev/null; then
  disown "$TUNNEL_PID" 2>/dev/null || true
  trap - EXIT
  echo ""
  echo "  Туннель оставлен в фоне (PID $TUNNEL_PID)."
  echo "  Для постоянного URL лучше Railway — см. gift-ai/RAILWAY.md"
fi
echo "══════════════════════════════════════════════════════════"
