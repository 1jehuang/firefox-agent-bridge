#!/usr/bin/env bash
# Wrap dist/safari in a macOS app with Xcode's converter, then build it.
# Safari only loads web extensions shipped inside an app. Unsigned local
# builds need Safari > Settings > Advanced > "Show features for web
# developers", then Develop > "Allow unsigned extensions".
#
# The Safari extension talks to the native host over the WebSocket relay, so
# run the host in relay mode (jcode does this automatically):
#   firefox-agent-bridge-host --relay
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/dist/safari-app}"
command -v xcrun >/dev/null || { echo "xcrun not found: install Xcode" >&2; exit 1; }
python3 "$ROOT/scripts/build-extensions.py" >/dev/null
rm -rf "$OUT"
xcrun safari-web-extension-converter "$ROOT/dist/safari" \
  --project-location "$OUT" \
  --app-name "Browser Agent Bridge" \
  --bundle-identifier io.github.1jehuang.browser-agent-bridge \
  --swift --macos-only --no-open --no-prompt --force
PROJECT="$(find "$OUT" -name '*.xcodeproj' -maxdepth 2 | head -1)"
xcodebuild -project "$PROJECT" -configuration Release -derivedDataPath "$OUT/build" \
  CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO build
APP="$(find "$OUT/build" -name 'Browser Agent Bridge.app' -maxdepth 5 | head -1)"
echo "Built $APP"
echo "Open it once, then enable the extension in Safari > Settings > Extensions."
