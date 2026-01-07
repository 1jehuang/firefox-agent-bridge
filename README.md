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

Benchmark results (v0.7.0 - January 2026):

### Direct API Performance

| Metric | Value |
|--------|-------|
| Command latency (avg) | **120ms** |
| Navigation (avg) | **1.8s** |
| Complex step (avg) | **120ms** |

### Benchmark Results

**Search Flow** (4 commands): 3.5s total
- Navigate to DuckDuckGo: 1594ms
- Type query + submit: 124ms
- Wait for results: 116ms
- Get content: 123ms

**Parallel Fetch** (3 sites): 1.36s parallel vs 2.41s sequential
- **1.77x speedup** with parallel execution

**Complex Navigation** (8 steps): 2.85s total, 100% success rate
- Navigate + get interactables: 2010ms
- Form navigation steps (avg): 120ms per step
- All 8 steps successful

### Agent E2E Results

**Note:** Agent e2e benchmarks currently experience connection timeouts and require proper Anthropic API configuration. Previous successful runs (v0.6.0) showed:

- Search DuckDuckGo: 2 commands (navigate, getContent)
- Complaint form with scout: 3 commands (scout, click, getContent)
- 100% success rate on standard tasks

Send `profile: true` with any command for detailed timing breakdowns.
See `benchmarks/README.md` for the full benchmark suite and setup instructions.

## Profiling

Use `native-host/profile-client.js` for quick latency stats.

See `docs/setup.md`, `docs/api.md`, and `docs/performance.md` for full details.
