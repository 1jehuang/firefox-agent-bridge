# Firefox Agent Bridge

Bridge a WebSocket-connected AI agent to a live Firefox profile via a WebExtension and native messaging host.

## Architecture

- Agent connects to the local WebSocket server.
- Native messaging host forwards commands to the Firefox extension.
- Extension executes browser actions and returns results.

## Quick start

```bash
cd native-host
npm install
cd ..
./scripts/install-native-host.sh
```

Load the extension from `extension/manifest.json` via `about:debugging#/runtime/this-firefox`.

Default WebSocket endpoint: `ws://127.0.0.1:8765`

## Profiling

Send `profile: true` with any command to receive timing breakdowns (host/extension/content).
Use `native-host/profile-client.js` for quick latency stats.

See `docs/setup.md`, `docs/api.md`, and `docs/performance.md` for full details.
