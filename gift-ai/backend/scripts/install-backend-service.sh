#!/bin/bash
# Устанавливает постоянный запуск API на Mac (launchd)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PLIST_SRC="$SCRIPT_DIR/com.pressa.gift-ai-api.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.pressa.gift-ai-api.plist"

chmod +x "$SCRIPT_DIR/run-backend-service.sh"

TMP_PLIST="$(mktemp)"
sed "s|__BACKEND_DIR__|$BACKEND_DIR|g" "$PLIST_SRC" > "$TMP_PLIST"
mkdir -p "$HOME/Library/LaunchAgents"
cp "$TMP_PLIST" "$PLIST_DST"
rm -f "$TMP_PLIST"

launchctl bootout "gui/$(id -u)/com.pressa.gift-ai-api" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
launchctl enable "gui/$(id -u)/com.pressa.gift-ai-api"
launchctl kickstart -k "gui/$(id -u)/com.pressa.gift-ai-api" 2>/dev/null || true

echo "API запущен как фоновый сервис (launchd)"
echo "Лог:   /tmp/pressa-gift-ai-api.log"
echo "Health: curl -s http://localhost:3100/health"
echo ""
echo "Остановить:"
echo "  launchctl bootout gui/$(id -u)/com.pressa.gift-ai-api"
