# Firefox Agent Bridge

Bridge a WebSocket-connected AI agent to a live Firefox profile via a WebExtension and native messaging host.

## Architecture

- Agent connects to the local WebSocket server.
- Native messaging host forwards commands to the Firefox extension.
- Extension executes browser actions and returns results.

## Installation

### 1. Install the Firefox Extension

Download the signed extension from [GitHub Releases](https://github.com/1jehuang/firefox-agent-bridge/releases/latest):

1. Download `browser-agent-bridge-X.X.X.xpi`
2. In Firefox, go to `about:addons`
3. Click gear icon → "Install Add-on From File..."
4. Select the downloaded XPI

### 2. Install the Native Messaging Host

```bash
cd native-host
npm install
cd ..
./scripts/install-native-host.sh
```

### 3. Install the CLI (Rust - Recommended)

```bash
cargo install --path rust-cli
browser setup claude  # Installs Claude Code skill
```

Or use npx for one-off commands:
```bash
npx browser ping
```

Default WebSocket endpoint: `ws://127.0.0.1:8765`

## Performance

Benchmark results (v1.0.0 - January 2026):

### CLI Performance (Rust vs Node.js)

| CLI | Per-Command | Improvement |
|-----|-------------|-------------|
| **Rust** (`browser`) | **12ms** | baseline |
| Node.js (`client.js`) | 105ms | 8.75x slower |

The Rust CLI provides **88% faster** command execution.

### Command Timing Breakdown

Use `--timing` flag for detailed breakdown:

```bash
browser --timing navigate '{"url": "http://example.com"}'
# Returns: {"_timing": {"total_ms": 156, "connect_ms": 0, "roundtrip_ms": 155}, ...}
```

| Action | Total (ms) | Connect (ms) | Roundtrip (ms) |
|--------|-----------|--------------|----------------|
| ping | 3-8 | 0 | 3-8 |
| navigate | 150-170 | 0 | 150-165 |
| getContent | 2-33 | 0 | 2-33 |
| type | 2-11 | 0 | 2-11 |
| click | 2-5 | 0 | 2-5 |
| fillForm | 3-10 | 0 | 3-10 |

### E2E Agent Benchmark Results

| Task | Status | Commands | Description |
|------|--------|----------|-------------|
| table-scrape | PASS | 3 | Extract 8-row data table |
| oauth-flow | PASS | ~20 | Complete mock Google OAuth |
| contact-form | PASS | 9 | Fill and submit form |
| login-flow | PASS | 6 | Login and extract secrets |

**Note:** Parallel E2E tests require isolated sessions (`tabId`) to avoid conflicts.

See `benchmarks/README.md` for the full benchmark suite and setup instructions.

## Profiling

Use `native-host/profile-client.js` for quick latency stats.

See `docs/setup.md`, `docs/api.md`, and `docs/performance.md` for full details.
