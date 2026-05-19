---
name: firefox-browser
description: "Control the user's Firefox browser with their logins and cookies intact. Use when you need to browse websites as the user, interact with authenticated pages, fill forms, click buttons, take screenshots, or get page content."
allowed-tools: Bash, Read, Write
---

# Firefox Browser Agent Bridge

Control the user's actual Firefox browser session via WebSocket. Uses their real browser with existing logins and cookies — **not** a headless browser.

## Quick Start

```bash
# 0. If Firefox isn't running, start it first
nohup firefox &>/dev/null &

# 1. Check connection
browser ping

# 2. See what tabs are open
browser listTabs '{}'

# 3. Start a new session (recommended)
browser newSession '{"url": "https://example.com"}'

# 4. Read the page with interactable elements marked
browser getContent '{"format": "annotated"}'
```

## Client Usage

```bash
browser <action> '<json_params>'
```

## Actions Reference

### Session & Tab Management

| Action | Description | Key Params |
|--------|-------------|------------|
| `listTabs` | List all open tabs across windows | - |
| `newSession` | Create new tab to work in | `url` (optional) |
| `setActiveTab` | Switch which tab agent works on | `tabId`, `focus` |
| `getActiveTab` | Get current tab info | - |

### Navigation & Page Info

| Action | Description | Key Params |
|--------|-------------|------------|
| `navigate` | Go to URL in current tab | `url`, `wait`, `newTab` |
| `getContent` | Get page content | `format`: `annotated`, `text`, `html` |
| `getInteractables` | List clickable elements and inputs | `selector` (optional scope) |
| `screenshot` | Capture visible area as PNG | `filename` (optional) |

### Interaction

| Action | Description | Key Params |
|--------|-------------|------------|
| `click` | Click element | `selector`, `text`, or `x`/`y` coords |
| `type` | Type into input (handles contenteditable editors automatically) | `selector`, `text`, `submit`, `clear` |
| `fillForm` | Fill multiple fields (handles contenteditable editors automatically) | `fields[]` with selector/value pairs |
| `waitFor` | Wait for element/text | `selector`, `text`, `timeout` |
| `scroll` | Scroll the page | `y`/`x`, `selector`, `position` |
| `evaluate` | Execute JavaScript and return result | `script`, `pageWorld` |

### Control Flow

| Action | Description | Key Params |
|--------|-------------|------------|
| `fork` | Duplicate tab into multiple paths | `paths[]` with name + commands |
| `killFork` | Close a fork | `fork` (name) |
| `listForks` | List active forks | - |
| `tryUntil` | Try alternatives until one succeeds | `alternatives[]`, `timeout` |
| `parallel` | Run commands on multiple URLs | `branches[]` with url + commands |

### Cross-Origin Iframe Support

| Action | Description | Key Params |
|--------|-------------|------------|
| `listFrames` | List all frames with URLs, inputs, and clickable elements | - |
| Any action | Target a specific frame | Add `"frameId": N` to params |
| Any action | Try all frames | Add `"allFrames": true` to params |

### Authentication & Vault

| Action | Description | Key Params |
|--------|-------------|------------|
| `autoLogin` | Auto-fill credentials from Bitwarden vault and optionally submit | `domain`, `submit` (default false) |
| `vaultStatus` | Check vault lock state and credential count | - |
| `vaultSync` | Re-sync vault from Bitwarden server via API key | - |
| `getAuthContext` | Detect login pages, available accounts | - |
| `requestAuth` | Request user approval for auth | `reason` |

## Recommended Workflow

1. **Inspect**: `browser listTabs '{}'` then `browser newSession '{"url": "..."}'`
2. **Read**: `browser getContent '{"format": "annotated"}'` — shows content with clickable elements inline as `[button: "Add to cart" | selector: #add-btn]`
3. **Authenticate** (if needed): `browser autoLogin '{"domain": "github.com", "submit": true}'`, then `getContent` to confirm you're logged in
4. **Interact**: Use selectors from annotated output — `browser click '{"selector": "#add-btn"}'` or `browser type '{"selector": "#input", "text": "query", "submit": true}'`. After each action, re-run `getContent` to verify the expected state before proceeding

## Tips

1. **Start with `listTabs`** to see what's open
2. **Use `newSession`** for a clean start
3. **Use `tabId`** for parallel/isolated execution — pass it in all commands for that session
4. **Use `annotated` format** — shows content + clickable elements together
5. **Use selectors from annotated output** — more reliable than text matching
6. **Fork when uncertain** — try multiple paths, kill the wrong ones
7. **Use `allFrames: true`** when targeting login iframes (Apple, Google, Microsoft)

## Troubleshooting

1. **Firefox not running?** Start it: `nohup firefox &>/dev/null &`
2. **Check connection**: `browser ping`
3. **Connection refused?** The extension may need to be reloaded in `about:debugging`
4. **Element not found?** Use `browser getContent '{"format": "annotated"}'` to see what's on the page
5. **Login form in iframe?** Use `browser listFrames '{}'` to discover frames, then add `"frameId": N` to your commands

> See [REFERENCE.md](REFERENCE.md) for detailed examples of fork, parallel, authentication, evaluate, scroll, iframe handling, rich text editors, and more.
