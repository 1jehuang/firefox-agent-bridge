# Setup

## Prerequisites

- Firefox browser
- Rust toolchain (for building)

## 1) Build the Rust Binaries

```bash
cd rust-cli
cargo build --release
```

This produces two binaries:
- `target/release/browser` - CLI for sending commands
- `target/release/firefox-agent-bridge-host` - Native messaging host

## 2) Install the Native Messaging Host

```bash
./scripts/install-native-host.sh
```

This writes `~/.mozilla/native-messaging-hosts/firefox_agent_bridge.json` pointing to the Rust native host binary.

## 3) Load the Firefox Extension

**Option A: Signed Extension (Recommended)**

Download from [GitHub Releases](https://github.com/1jehuang/firefox-agent-bridge/releases/latest) and install via `about:addons`.

**Option B: Temporary Add-on (Development)**

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `extension/manifest.json`

The extension uses your current Firefox profile, so existing cookies/logins are preserved.

## 4) Install the CLI

```bash
# Install globally
cargo install --path rust-cli

# Or copy to local bin
cp rust-cli/target/release/browser ~/.local/bin/
```

## 5) Connect an Agent

The native host runs a WebSocket server on `ws://127.0.0.1:8766`.

### Using the CLI

```bash
# Check connection
browser ping

# Start Firefox if not running
browser start

# Navigate to a URL
browser navigate '{"url": "https://example.com"}'

# Get page content
browser getContent '{"format": "text"}'
```

### Direct WebSocket

Send JSON commands with an `action` and optional `params`:

```json
{ "action": "navigate", "params": { "url": "https://example.com", "wait": true } }
```

Responses echo the `id` (auto-generated if omitted):

```json
{ "id": "req_...", "ok": true, "result": { "tabId": 123, "url": "https://example.com" } }
```

## Claude Code Integration

```bash
browser setup claude
```

This installs the skill file to `~/.claude/skills/firefox-browser/SKILL.md`.

## Troubleshooting

- **WebSocket not reachable**: Ensure the extension is loaded (it launches the native host)
- **Check extension logs**: Firefox → `about:debugging` → inspect the extension
- **Verify native host**: Check `~/.mozilla/native-messaging-hosts/firefox_agent_bridge.json` points to the correct binary
- **Start Firefox**: Run `browser start` to launch Firefox and wait for connection

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FAB_WS_HOST` | `127.0.0.1` | WebSocket server host |
| `FAB_WS_PORT` | `8766` | WebSocket server port |
| `FAB_REQUEST_TIMEOUT_MS` | `30000` | Request timeout in milliseconds |
