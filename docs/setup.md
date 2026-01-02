# Setup

## 1) Install host dependencies

```bash
cd native-host
npm install
```

## 2) Install the native messaging host manifest

```bash
./scripts/install-native-host.sh
```

This writes `~/.mozilla/native-messaging-hosts/firefox_agent_bridge.json` pointing at `native-host/host.js`.

## 3) Load the Firefox extension (current profile)

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `extension/manifest.json`

The extension uses your current Firefox profile, so existing cookies/logins are preserved.

## 4) Connect an agent

The native host runs a WebSocket server on `ws://127.0.0.1:8765` by default.

Send JSON commands with an `action` and optional `params`:

```json
{ "action": "navigate", "params": { "url": "https://example.com", "wait": true } }
```

Responses echo the `id` (auto-generated if you omit it):

```json
{ "id": "req_...", "ok": true, "result": { "tabId": 123, "url": "https://example.com" } }
```

## Troubleshooting

- If the WebSocket server is not reachable, ensure the extension is loaded (it launches the native host).
- Check Firefox’s **about:debugging** console for native messaging errors.
