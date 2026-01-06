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

## Performance

Benchmark results (v0.5.0):

| Metric | Value |
|--------|-------|
| Command latency (avg) | **65ms** |
| Navigation (avg) | **2000ms** |
| Complex step (avg) | **60ms** |

**Search flow** (4 commands): 2.1s total
- navigate: 423ms, type+submit: 64ms, waitFor: 53ms, getContent: 50ms

**8-step workflow**: 4.7s total, 100% success rate

Send `profile: true` with any command for timing breakdowns.
See `benchmarks/README.md` for full benchmark suite.

## Profiling

Use `native-host/profile-client.js` for quick latency stats.

See `docs/setup.md`, `docs/api.md`, and `docs/performance.md` for full details.
