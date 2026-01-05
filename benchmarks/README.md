# Standardized Benchmarks

Run these benchmarks after each version change to track performance.

## Quick Run

```bash
# Run all benchmarks
./benchmarks/run-all.sh

# Run specific benchmark
node benchmarks/bench-search.js
node benchmarks/bench-parallel.js
node benchmarks/bench-complex-nav.js
```

## Benchmark Suite

### 1. Simple Search (bench-search.js)
- Navigate to DuckDuckGo
- Type query and submit
- Wait for results
- Get content

**Metrics:** Total time, commands executed

### 2. Parallel Fetch (bench-parallel.js)
- Fetch 3 sites in parallel vs sequential
- Compare timing

**Metrics:** Parallel time, sequential time, speedup ratio

### 3. Complex Navigation (bench-complex-nav.js)
- Navigate multi-page workflow
- Click through 3+ pages
- Fill a form
- Get final content

**Metrics:** Total time, agent turns (simulated), commands per turn

### 4. Macro vs Agent (bench-macro.js)
- Run same task as macro
- Compare to agent baseline

**Metrics:** Macro time, agent time (from logs), speedup ratio

## Recording Results

Results are logged to `benchmarks/results/YYYY-MM-DD-vX.X.X.json`
