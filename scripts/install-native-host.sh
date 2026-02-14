#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST_SRC="${ROOT_DIR}/native-host/manifest.json"
TARGET_DIR="${HOME}/.mozilla/native-messaging-hosts"
TARGET_PATH="${TARGET_DIR}/firefox_agent_bridge.json"

# Determine which host binary to use:
# 1. If running from dev, use target/release binary
# 2. If installed via cargo, use ~/.cargo/bin binary
# 3. Fall back to node.js host if Rust binary not found
if [[ -x "${ROOT_DIR}/rust-cli/target/release/firefox-agent-bridge-host" ]]; then
    HOST_PATH="${ROOT_DIR}/rust-cli/target/release/firefox-agent-bridge-host"
    echo "Using Rust host from: ${HOST_PATH}"
elif [[ -x "${HOME}/.cargo/bin/firefox-agent-bridge-host" ]]; then
    HOST_PATH="${HOME}/.cargo/bin/firefox-agent-bridge-host"
    echo "Using installed Rust host from: ${HOST_PATH}"
elif [[ -x "${ROOT_DIR}/native-host/host.js" ]]; then
    HOST_PATH="${ROOT_DIR}/native-host/host.js"
    echo "Warning: Falling back to Node.js host (deprecated)"
else
    echo "Error: No host binary found. Build with:"
    echo "  cd ${ROOT_DIR}/rust-cli && cargo build --release --bin firefox-agent-bridge-host"
    exit 1
fi

mkdir -p "${TARGET_DIR}"

# Read manifest template and substitute path
MANIFEST_CONTENT=$(cat "${MANIFEST_SRC}")
MANIFEST_CONTENT="${MANIFEST_CONTENT/__HOST_PATH__/${HOST_PATH}}"

# Add both extension IDs for compatibility
MANIFEST_CONTENT=$(python3 -c "
import json
import sys

manifest = json.loads('''${MANIFEST_CONTENT}''')
manifest['allowed_extensions'] = [
    'firefox-agent-bridge@local',
    'browser-agent-bridge@1jehuang.github.io'
]
print(json.dumps(manifest, indent=2))
")

echo "${MANIFEST_CONTENT}" > "${TARGET_PATH}"

printf "Installed native host manifest to %s\n" "${TARGET_PATH}"
printf "Host path: %s\n" "${HOST_PATH}"
