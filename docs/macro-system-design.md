# Macro System Design

## Problem
AI agent takes ~6s per turn. For known workflows, this is wasteful because the agent already knows what to do.

## Solution
Record successful action sequences as "macros" that can be replayed without AI reasoning.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Macro System                              │
├─────────────────────────────────────────────────────────────────┤
│  Recording:                                                      │
│    Agent executes commands → success → save sequence as macro   │
│                                                                  │
│  Playback:                                                       │
│    Recognize pattern → replay macro → verify result → done      │
│    If verification fails → fall back to AI agent                │
└─────────────────────────────────────────────────────────────────┘
```

## Macro Format

```json
{
  "id": "search-duckduckgo",
  "name": "Search DuckDuckGo",
  "trigger": {
    "type": "intent",
    "patterns": ["search duckduckgo for *", "search ddg *"]
  },
  "variables": {
    "query": { "from": "trigger", "capture": 1 }
  },
  "steps": [
    {
      "action": "navigate",
      "params": { "url": "https://duckduckgo.com" }
    },
    {
      "action": "type",
      "params": {
        "selector": "input[name='q']",
        "text": "{{query}}",
        "submit": true
      }
    },
    {
      "action": "getContent",
      "params": { "format": "text" }
    }
  ],
  "verify": {
    "action": "getContent",
    "expect": { "contains": "results" }
  }
}
```

## Implementation Plan

### Phase 1: Batch Command Support
Add ability to send multiple commands in one request:

```javascript
// Single request with multiple commands
{
  "action": "batch",
  "commands": [
    { "action": "navigate", "params": { "url": "..." } },
    { "action": "waitFor", "params": { "selector": "input", "timeout": 5000 } },
    { "action": "type", "params": { "selector": "input", "text": "query" } }
  ]
}
```

### Phase 2: Macro Recording
Instrument the skill client to record successful sequences:

```javascript
// After successful multi-step workflow
{
  "recordedAt": "2025-01-02T...",
  "context": "user asked to search duckduckgo",
  "commands": [...],
  "result": "success"
}
```

### Phase 3: Macro Playback
Add pattern matching to recognize when a macro applies:

```javascript
// In skill client
const macro = findMatchingMacro(userIntent);
if (macro) {
  return executeMacro(macro, extractVariables(userIntent));
} else {
  return executeWithAgent(userIntent);
}
```

### Phase 4: Verification & Fallback
After macro execution, verify expected outcome:

```javascript
const result = await executeMacro(macro);
if (!verifyResult(result, macro.verify)) {
  // Page structure changed, fall back to AI
  return executeWithAgent(userIntent);
}
```

## Timing Impact

| Scenario | Current | With Macros |
|----------|---------|-------------|
| New workflow | ~6s × N steps | ~6s × N steps (same) |
| Known workflow | ~6s × N steps | ~8ms × N commands |
| 3-step search | ~18s | ~24ms |

## Next Steps

1. Implement batch command support in extension
2. Create macro storage format
3. Add recording mode to skill client
4. Implement pattern matching for macro triggers
5. Add verification/fallback logic
