#!/bin/zsh
# Installiert die Bridge als launchd-Agent (Start bei Login, Restart bei Crash).
# Ausführen als Micha — vorher pairen (npm run dev) und Whitelist füllen.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_SRC="$REPO_DIR/launchd/com.micha.whatsapp-bridge.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.micha.whatsapp-bridge.plist"

mkdir -p "$HOME/Library/LaunchAgents" "$REPO_DIR/data"
cp "$PLIST_SRC" "$PLIST_DST"

# Falls schon geladen: erst entladen, dann frisch laden.
launchctl unload "$PLIST_DST" 2>/dev/null || true
launchctl load "$PLIST_DST"

echo "Geladen: com.micha.whatsapp-bridge"
echo "Status:  npm run status   |   Log: $REPO_DIR/data/bridge.log"
