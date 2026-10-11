#!/usr/bin/env python3
"""Build per-browser packages of the Browser Agent Bridge extension.

extension/ is the single source of truth. This script emits:

  dist/firefox/           MV2 package (manifest as committed)
  dist/chrome/            MV3 package for Chrome, Edge, Brave, Chromium
  dist/safari/            MV3 package for `xcrun safari-web-extension-converter`
  dist/browser-agent-bridge-<ver>.xpi
  dist/browser-agent-bridge-chrome-<ver>.zip
  dist/browser-agent-bridge-safari-<ver>.zip

The Chrome manifest embeds a public key so the unpacked extension always gets
the same ID, which the native messaging manifest's allowed_origins needs.
"""
import copy
import json
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "extension"
DIST = ROOT / "dist"

# Public half of the Chrome extension signing key. Yields the stable ID below.
CHROME_PUBLIC_KEY = (
    "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3Ia0X9n173BX5Rvs+u4ubpuVTsk8GZqHI1BDPSwI4m4prpv9CYftsTw27zptwySBMlJAeiGyMl29dlJu6uZdQcUFJ2BciSJjB+aiUrRCgb+DmvLEMyBbwIcOyNz3DlCPADEqzR7B1vzGEcxemEPZMh3+ZLEZtENMQ3hdLzPAA+RRagQQLDitLIQtfI7rJDNGQqH7bEQV+VruQY+Dka+FXwMq0zNiQRsPQj5rqiKSqy6FuiddfhJ+XS4YlhYq6/ZH9feRkYm+j6pG+k+UPUj7zBT7iVV2IZZfQ6FLlZiRa6LQ5heOaiBEuettn2S+Y9lpX3wyKn87Zx1m8916UvQFewIDAQAB"
)
CHROME_EXTENSION_ID = "ijifgeepmnbalajhfjnpbnobfobflfkk"

FILES = ["background.js", "content.js", "popup.html", "popup.js", "LICENSE", "icons"]


def base_manifest():
    return json.loads((SRC / "manifest.json").read_text())


def chrome_manifest(mv2):
    m = {
        "manifest_version": 3,
        "name": mv2["name"],
        "version": mv2["version"],
        "description": mv2["description"],
        "icons": mv2["icons"],
        "key": CHROME_PUBLIC_KEY,
        "minimum_chrome_version": "116",
        "permissions": [
            "tabs", "activeTab", "nativeMessaging", "notifications", "storage",
            "webNavigation", "downloads", "scripting", "alarms", "debugger",
        ],
        # userScripts lets evaluate bypass strict page CSPs once the user
        # enables "Allow user scripts"; evaluate falls back to MAIN world.
        "optional_permissions": ["userScripts"],
        "host_permissions": ["<all_urls>"],
        "background": {"service_worker": "background.js"},
        "content_scripts": copy.deepcopy(mv2["content_scripts"]),
        "action": copy.deepcopy(mv2["browser_action"]),
    }
    return m


def safari_manifest(mv2):
    m = chrome_manifest(mv2)
    m.pop("key")
    m.pop("minimum_chrome_version")
    m.pop("optional_permissions")
    # Safari cannot launch arbitrary native hosts; the extension uses the
    # host's local WebSocket relay instead.
    m["permissions"] = [p for p in m["permissions"] if p not in ("nativeMessaging", "downloads", "debugger")]
    m["background"] = {"scripts": ["background.js"], "persistent": False}
    m["browser_specific_settings"] = {"safari": {"strict_min_version": "17.0"}}
    return m


def stage(target, manifest):
    out = DIST / target
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    for name in FILES:
        src = SRC / name
        if src.is_dir():
            shutil.copytree(src, out / name)
        elif src.exists():
            shutil.copy2(src, out / name)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return out


def pack(directory, archive):
    archive.unlink(missing_ok=True)
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(directory.rglob("*")):
            if path.is_file():
                zf.write(path, path.relative_to(directory).as_posix())
    return archive


def main():
    mv2 = base_manifest()
    version = mv2["version"]
    DIST.mkdir(exist_ok=True)
    firefox = stage("firefox", mv2)
    chrome = stage("chrome", chrome_manifest(mv2))
    safari = stage("safari", safari_manifest(mv2))
    outputs = [
        pack(firefox, DIST / f"browser-agent-bridge-{version}.xpi"),
        pack(chrome, DIST / f"browser-agent-bridge-chrome-{version}.zip"),
        pack(safari, DIST / f"browser-agent-bridge-safari-{version}.zip"),
    ]
    for o in outputs:
        print(o.relative_to(ROOT))
    print(f"chrome extension id: {CHROME_EXTENSION_ID}")


if __name__ == "__main__":
    sys.exit(main())
