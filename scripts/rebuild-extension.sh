#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_DIR="${ROOT_DIR}/extension"
XPI_PATH="$(find ~/.mozilla/firefox -name 'browser-agent-bridge@*.xpi' 2>/dev/null | head -1)"

if [[ -z "$XPI_PATH" ]]; then
  echo "❌ Extension XPI not found in Firefox profile"
  exit 1
fi

echo "Building XPI from ${EXT_DIR}..."
cd "$EXT_DIR"
zip -r /tmp/agent-bridge.xpi * -q
cp /tmp/agent-bridge.xpi "$XPI_PATH"
echo "✓ Installed to $XPI_PATH"

if command -v browser &>/dev/null; then
  echo "Reloading extension..."
  browser reload 2>/dev/null || true
  sleep 2
  if browser ping 2>/dev/null | grep -q pong; then
    echo "✓ Extension reloaded and responding"
  else
    echo "⚠ Extension reloaded but not responding yet (may need a moment)"
  fi
else
  echo "⚠ 'browser' CLI not found — reload manually via about:debugging"
fi
