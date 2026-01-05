# Firefox Agent Bridge - Performance Changelog

## Speed Improvement Summary

| Version | Feature | Agent Time | Command Time | Improvement |
|---------|---------|------------|--------------|-------------|
| v0.1.0 | Baseline | ~61.7s | ~60ms | - |
| v0.2.0 | Batch commands | ~45s | ~50ms | ~1.4x faster |
| v0.3.0 | Macros | 113ms (no agent) | ~50ms | **546x faster** |
| v0.4.0 | waitFor, fillForm, Enter key | ~40s | ~50ms | Fewer retries |
| v0.4.1 | branch, getInteractables | ~35s | ~50ms | Fewer turns |
| v0.5.0 | parallel, returnInteractables, smart fallbacks | ~30s | ~50ms | 1.24x parallel speedup |

## Version History

### v0.6.0 (2025-01-04)
**Features:**
- `scout` action - Multi-page site exploration with goal-based ranking
- `preexplore` action - Single-page analysis with headings, forms, ranked links
- Goal-based link scoring (matches goal keywords → higher score)
- `suggestedActions` in scout response - ready-to-use actions for agent

**Benchmarks:**
- Scout explores 3-5 pages in ~3-5 seconds
- Returns condensed sitemap (headings, buttons, forms only)
- Reduces agent exploration time by providing pre-mapped site structure

### v0.5.0 (2025-01-04)
**Features:**
- `returnInteractables` flag on navigate - auto-returns clickable elements (saves 1 turn)
- `parallel` action - execute multiple branches in separate tabs simultaneously
- Smart selector fallbacks - auto-tries ID/class/aria-label variants when primary fails

**Benchmarks:**
- Parallel 3-site fetch: 892ms vs 1104ms sequential (1.24x faster)
- Complex site navigation (brightairindustries.com): 8 commands reduced to 4 batch operations

### v0.4.1 (2025-01-04)
**Features:**
- `branch` action - try multiple selector alternatives, first success wins
- `getInteractables` action - returns all clickable elements & inputs with selectors

**Benchmarks:**
- Reduces agent turns when page structure is uncertain
- Single call returns 20-50 interactive elements with selectors

### v0.4.0 (2025-01-04)
**Features:**
- `waitFor` action - poll for selector/text/contains
- `fillForm` action - fill multiple form fields atomically
- Enter key simulation for React apps without form elements
- Fixed checkbox/radio button click handling

**Benchmarks:**
- Form filling: single command vs 4+ type commands
- Eliminated retry loops for page load waiting

### v0.3.0 (2025-01-04)
**Features:**
- Macro system for known workflows
- Workflow cache for auto-record/replay

**Benchmarks:**
- DuckDuckGo search: 113ms (macro) vs 61.7s (agent) = **546x faster**
- Macros skip all agent thinking time

### v0.2.0 (2025-01-04)
**Features:**
- `batch` action - execute multiple commands sequentially
- Profiling/timing support

**Benchmarks:**
- Batch reduces Node.js startup overhead (~5ms per command saved)
- Single WebSocket round-trip for multiple commands

### v0.1.0 (Initial)
**Baseline measurements:**
- Agent thinking: ~6s per turn (99% of time)
- Command execution: ~60ms (1% of time)
- DuckDuckGo search task: 61.7s total

## Key Insights

1. **Agent thinking dominates** - 99% of time is agent thinking, not command execution
2. **Reduce turns, not command speed** - Batch, branch, and getInteractables help most
3. **Macros for known workflows** - 546x speedup when agent thinking is eliminated
4. **Parallel execution helps** - 1.24x speedup for multi-site tasks
