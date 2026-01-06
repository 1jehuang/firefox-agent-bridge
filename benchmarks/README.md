# Benchmarks

Run these benchmarks to track performance and compare browser automation approaches.

## Quick Start

```bash
# Start test server (for local benchmarks)
./benchmarks/start-test-server.sh

# Run direct API benchmarks
./benchmarks/run-all.sh

# Run agent E2E benchmarks
node benchmarks/bench-agent-e2e.js local

# Run Playwright comparison
./benchmarks/run-comparison.sh
```

## Benchmark Types

### 1. Direct API Benchmarks

Test raw bridge performance without spawning agents.

| Benchmark | Description |
|-----------|-------------|
| `bench-search.js` | DuckDuckGo search flow (navigate, type, submit, get results) |
| `bench-parallel.js` | Parallel vs sequential fetch comparison |
| `bench-complex-nav.js` | Multi-page workflow with clicks and forms |

```bash
node benchmarks/bench-search.js
node benchmarks/bench-parallel.js
node benchmarks/bench-complex-nav.js
```

### 2. Agent E2E Benchmarks

Spawn real Claude agents and measure end-to-end task completion.

**External site tasks** (no setup required):
- `search-duckduckgo` - Search and extract results
- `find-complaint-form` - Navigate to find form fields
- `multi-site-fetch` - Fetch from multiple sites in parallel

**Local test site tasks** (requires test server):
- `login-flow` - Log into test site and verify
- `search-extract` - Search and extract structured results
- `contact-form` - Fill multi-field form
- `wizard-complete` - Complete 3-step wizard
- `table-scrape` - Extract table data
- `protected-access` - Login then access protected content

```bash
# List available tasks
node benchmarks/bench-agent-e2e.js list

# Run specific task
node benchmarks/bench-agent-e2e.js login-flow

# Run all local tasks
node benchmarks/bench-agent-e2e.js local

# Run all external tasks
node benchmarks/bench-agent-e2e.js external
```

### 3. Playwright Comparison

Compare Firefox Agent Bridge vs Playwright MCP on identical tasks.

```bash
./benchmarks/run-comparison.sh
# or
node benchmarks/bench-playwright-comparison.js all
```

## Test Server

Local benchmarks use a test server with controlled pages:

```bash
# Start server (default port 3456)
./benchmarks/start-test-server.sh

# Or with custom port
TEST_PORT=8080 node benchmarks/test-server.js
```

**Test pages:**
- `/` - Home with navigation
- `/login.html` - Login form (any non-empty credentials work)
- `/search.html` - Search with mock results
- `/contact.html` - Multi-field contact form
- `/data.html` - Data table for extraction
- `/wizard/step1.html` - 3-step form wizard
- `/protected.html` - Protected content (requires login)

**API endpoints:**
- `POST /api/login` - Login
- `GET /api/protected` - Protected data
- `GET /api/search?q=` - Search
- `GET /api/health` - Health check

## Results

Results are saved to `benchmarks/results/`:
- `YYYY-MM-DD-vX.X.X.json` - Aggregated direct benchmark results
- `e2e-{task}-{timestamp}.json` - Individual agent benchmark results
- `comparison-{timestamp}.json` - Playwright comparison results

## Metrics

**Direct benchmarks measure:**
- Command latency (avg ~65ms)
- Navigation time (avg ~2000ms)
- Total workflow time

**Agent benchmarks measure:**
- Total task time
- Agent thinking time (LLM inference)
- Command execution time
- Number of commands/turns

**Comparison benchmarks measure:**
- Time per tool (Firefox vs Playwright)
- Success rate
- Speedup ratio
