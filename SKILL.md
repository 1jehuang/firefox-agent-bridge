---
name: firefox-browser
description: "Control the user's Firefox browser with their logins and cookies intact. Use when you need to browse websites as the user, interact with authenticated pages, fill forms, click buttons, take screenshots, or get page content. (user)"
allowed-tools: Bash, Read, Write
---

# Firefox Browser Agent Bridge

Control the user's actual Firefox browser session via WebSocket. This uses their real browser with existing logins and cookies - **not** a headless browser.

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
browser --timing <action> '<json_params>'       # With timing info
browser --record /path/to/dir <action> '<json_params>'  # With screen recording
```

## Actions Reference

### Session & Tab Management

| Action | Description | Key Params |
|--------|-------------|------------|
| `listTabs` | List all open tabs across windows | - |
| `newSession` | Create new tab to work in | `url` (optional), `sandbox` (private window) |
| `setActiveTab` | Switch which tab agent works on | `tabId`, `focus` |
| `getActiveTab` | Get current tab info | - |

### Navigation & Page Info

| Action | Description | Key Params |
|--------|-------------|------------|
| `navigate` | Go to URL in current tab | `url`, `wait`, `newTab` |
| `getContent` | Get page content | `format`: `annotated`, `text`, `html` |
| `getInteractables` | List clickable elements and inputs | `selector` (optional scope) |
| `screenshot` | Capture visible area as PNG | `filename` (optional) |
| `reload` | Reload current tab | - |

### Interaction

| Action | Description | Key Params |
|--------|-------------|------------|
| `click` | Click element | `selector`, `text`, or `x`/`y` coords |
| `type` | Type into focused/selected input | `selector`, `text`, `submit`, `clear` |
| `fillForm` | Fill form fields (inputs, textareas, selects) | `fields[]` array with selector/value |
| `scroll` | Scroll the page or an element | `y`/`x`, `selector`, `position` |
| `waitFor` | Wait for element/text | `selector`, `text`, `timeout` |

`fillForm` requires a `fields` array (there is no `fill` command):
```bash
browser fillForm '{"fields": [{"selector": "#email", "value": "test@example.com"}]}'
```

### Rich Text Editors & File Operations

| Action | Description | Key Params |
|--------|-------------|------------|
| `uploadFile` | Upload file to `<input type="file">` | `selector`, `path` (local file path) |
| `dropFile` | Drag-and-drop file onto element | `selector`, `path` (local file path) |
| `evaluate` | Run JavaScript in page context | `script`, `pageWorld` (bool) |

`type` and `fillForm` handle contenteditable and rich text editors (Draft.js, Lexical, TinyMCE, ProseMirror) automatically.

### Control Flow

| Action | Description | Key Params |
|--------|-------------|------------|
| `fork` | Duplicate tab into multiple paths | `paths[]` with name + commands |
| `killFork` | Close a fork | `fork` (name) |
| `listForks` | List active forks | - |
| `tryUntil` | Try alternatives until one succeeds | `alternatives[]`, `timeout` |
| `parallel` | Run commands on multiple URLs | `branches[]` with url + commands |
| `batch` | Run multiple commands in sequence | `commands[]` |

### Authentication & Vault

| Action | Description | Key Params |
|--------|-------------|------------|
| `autoLogin` | Auto-fill credentials from Bitwarden vault and optionally submit | `domain`, `submit` (default false) |
| `vaultStatus` | Check vault lock state and credential count | - |
| `vaultSync` | Re-sync vault from Bitwarden server via API key | - |
| `getAuthContext` | Detect login pages, available accounts | - |
| `requestAuth` | Request user approval for auth | `reason` |

---

## Recommended Workflow

### 1. Inspect Available Tabs

```bash
browser listTabs '{}'
```

### 2. Start Fresh or Pick Existing Tab

```bash
browser newSession '{"url": "https://amazon.com"}'              # Fresh tab
browser newSession '{"url": "https://example.com", "sandbox": true}'  # Private window
browser setActiveTab '{"tabId": 456}'                            # Existing tab
```

### 3. Read Page with Annotated Format

```bash
browser getContent '{"format": "annotated"}'
```

Returns content with interactive elements marked inline:
```
Product Name Here
$4.99
[button: "Add to cart" | selector: #add-btn]
[input:text: "search" | value: "" | selector: #search-box]
[link: "View details" | href: /product/123 | selector: a.details-link]
```

### 4. Handle Login Pages

If you land on a login page, use `autoLogin` to fill credentials from the Bitwarden vault:

```bash
browser autoLogin '{"domain": "github.com", "submit": true}'
```

After login, use `getContent` to verify you're logged in.

### 5. Interact Using Selectors

```bash
browser click '{"selector": "#add-btn"}'
browser click '{"text": "Add to cart"}'
browser type '{"selector": "#search-box", "text": "query", "submit": true}'
```

---

## Tips

1. **Start with `listTabs`** to see what's open
2. **Use `newSession`** for a clean start
3. **Use `autoLogin` when you hit a login page** - don't fill login forms manually
4. **Use `tabId`** for parallel/isolated execution
5. **Use `annotated` format** - shows content + clickable elements together
6. **Use selectors from annotated output** - more reliable than text matching
7. **Fork when uncertain** - try multiple paths, kill the wrong ones
8. **Never use `sleep` commands** - browser commands are synchronous; use `waitFor` instead
9. **Use `uploadFile` for file inputs** - reads local files and uploads automatically
10. **Use `dropFile` for drop zones** - simulates native drag-and-drop
11. **Use `evaluate` for custom JS** - with `pageWorld: true` for page-context access

## Troubleshooting

1. **Firefox not running?** Start it: `nohup firefox &>/dev/null &`
2. **Check connection**: `browser ping`
3. **Connection refused?** The extension may need to be reloaded in `about:debugging`
4. **Element not found?** Use `browser getContent '{"format": "annotated"}'` to see what's on the page
5. **Rich text editor not filling?** `fillForm` handles Draft.js, Lexical, TinyMCE, ProseMirror automatically
6. **File drop not working?** `dropFile` runs in page world to bypass Firefox security restrictions

See [REFERENCE.md](REFERENCE.md) for detailed examples of fillForm, fork, parallel, tryUntil, authentication setup, evaluate, scroll, isolated sessions, and more.
