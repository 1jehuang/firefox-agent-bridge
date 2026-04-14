---
name: firefox-browser
description: "Control the user's Firefox browser with their logins and cookies intact. Use when you need to browse websites as the user, interact with authenticated pages, fill forms, click buttons, take screenshots, or get page content."
allowed-tools: Bash, Read, Write
---

# Firefox Browser Agent Bridge

Control the user's actual Firefox browser session via WebSocket. This uses their real browser with existing logins and cookies — **not** a headless browser.

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
| `listTabs` | List all open tabs across windows | — |
| `newSession` | Create new tab to work in | `url` (optional) |
| `setActiveTab` | Switch which tab agent works on | `tabId`, `focus` |
| `getActiveTab` | Get current tab info | — |

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
| `fillForm` | Fill multiple fields (handles rich text editors automatically) | `fields[]` with selector/value pairs |
| `waitFor` | Wait for element/text | `selector`, `text`, `timeout` |
| `scroll` | Scroll the page | `y`/`x`, `selector`, `position` |
| `evaluate` | Execute JavaScript and return result | `script`, `pageWorld` |

### Control Flow

| Action | Description | Key Params |
|--------|-------------|------------|
| `fork` | Duplicate tab into multiple paths | `paths[]` with name + commands |
| `killFork` | Close a fork | `fork` (name) |
| `listForks` | List active forks | — |
| `tryUntil` | Try alternatives until one succeeds | `alternatives[]`, `timeout` |
| `parallel` | Run commands on multiple URLs | `branches[]` with url + commands |

### Cross-Origin Iframe Support

| Action | Description | Key Params |
|--------|-------------|------------|
| `listFrames` | List all frames on the page | — |
| Any action | Target a specific frame | `frameId` param |
| `getContent` / `getInteractables` | Include all frames | `allFrames: true` |

### Authentication & Vault

| Action | Description | Key Params |
|--------|-------------|------------|
| `autoLogin` | Auto-fill credentials from Bitwarden vault and optionally submit | `domain`, `submit` (default false) |
| `vaultStatus` | Check vault lock state and credential count | — |
| `vaultSync` | Re-sync vault from Bitwarden server | — |
| `getAuthContext` | Detect login pages, available accounts | — |
| `requestAuth` | Request user approval for auth | `reason` |

## Recommended Workflow

1. **Inspect** — `listTabs` to see open tabs, then `newSession` or `setActiveTab`
2. **Read** — `getContent '{"format": "annotated"}'` to see page content with clickable elements marked inline
3. **Authenticate** (if needed) — `autoLogin '{"domain": "example.com", "submit": true}'`, then `getContent` to confirm you're logged in
4. **Interact** — use selectors from annotated output with `click`, `type`, `fillForm`; after each action, re-run `getContent` to verify the expected state before proceeding. Use `fork` when uncertain which path to take

## Tips

1. **Use `annotated` format** — shows content + clickable elements together with selectors
2. **Use selectors from annotated output** — more reliable than text matching
3. **Use `tabId`** for parallel/isolated execution across multiple sessions
4. **Fork when uncertain** — try multiple paths, keep the one that works
5. **`type`/`fillForm` handle rich text editors** (ProseMirror, Lexical, Slate, etc.) automatically

## Troubleshooting

1. **Firefox not running?** Start it: `nohup firefox &>/dev/null &`
2. **Check connection**: `browser ping`
3. **Connection refused?** The extension may need to be reloaded in `about:debugging`
4. **Element not found?** Use `getContent '{"format": "annotated"}'` to see what's on the page

> See [REFERENCE.md](REFERENCE.md) for detailed examples of fork, parallel, authentication, evaluate, scroll, iframe handling, rich text editors, form state inspection, and isolated sessions.
