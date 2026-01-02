#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST_PATH="${ROOT_DIR}/native-host/host.js"
MANIFEST_SRC="${ROOT_DIR}/native-host/manifest.json"
TARGET_DIR="${HOME}/.mozilla/native-messaging-hosts"
TARGET_PATH="${TARGET_DIR}/firefox_agent_bridge.json"

mkdir -p "${TARGET_DIR}"

python - <<PY
from pathlib import Path
manifest = Path("${MANIFEST_SRC}").read_text()
manifest = manifest.replace("__HOST_PATH__", "${HOST_PATH}")
Path("${TARGET_PATH}").write_text(manifest)
PY

chmod +x "${HOST_PATH}"

printf "Installed native host manifest to %s\n" "${TARGET_PATH}"
