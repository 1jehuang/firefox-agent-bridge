---
name: firefox-browser
description: Control the user's Firefox browser with their logins and cookies intact. Use when you need to browse websites as the user, interact with authenticated pages, fill forms, click buttons, take screenshots, or get page content. (user)
allowed-tools: Bash, Read, Write
---

# Firefox Browser Agent Bridge

Control the user's actual Firefox browser session via WebSocket. This uses their real browser with existing logins and cookies - **not** a headless browser.

## Quick Start

```bash
# Verify connection
node ~/.claude/skills/firefox-browser/client.js ping

# Navigate and get page elements in one call
node ~/.claude/skills/firefox-browser/client.js navigate '{"url": "https://example.com", "returnInteractables": true}'

# Get page text
node ~/.claude/skills/firefox-browser/client.js getContent '{"format": "text"}'
```

## Client Usage

```bash
node ~/.claude/skills/firefox-browser/client.js <action> '<json_params>'
```

## Actions Reference

### Navigation & Page Info

| Action | Description | Key Params |
|--------|-------------|------------|
| `navigate` | Go to URL | `url`, `wait`, `newTab`, `returnInteractables` |
| `getActiveTab` | Get current tab info | - |
| `getContent` | Get page content | `format`: `text`, `textFast`, `html`, `title`, `annotated` |
| `getInteractables` | List clickable elements and inputs | `selector` (optional scope) |
| `screenshot` | Capture visible area as PNG | `filename` (optional) |

### Interaction

| Action | Description | Key Params |
|--------|-------------|------------|
| `click` | Click element | `selector`, `text`, or `x`/`y` coords |
| `type` | Type into input | `selector`, `text`, `submit`, `clear`, `append` |
| `fillForm` | Fill multiple fields | `fields[]` with selector/value pairs |
| `waitFor` | Wait for element/text | `selector`, `text`, or `contains`; `timeout` |

### Advanced

| Action | Description | Key Params |
|--------|-------------|------------|
| `batch` | Run commands sequentially | `commands[]`, `stopOnError` |
| `parallel` | Run commands on multiple pages | `branches[]` with url + commands |
| `branch` | Try alternatives until one succeeds | `alternatives[]`, `timeout` |
| `scout` | Explore site structure | `url`, `goal`, `depth`, `maxPages` |

### Authentication

| Action | Description | Key Params |
|--------|-------------|------------|
| `getAuthContext` | Detect if page is login/auth, get available accounts | - |
| `requestAuth` | Request user approval for auth action | `reason` |
| `configureAuth` | Set auth preferences | `authMode`, `setSiteRule`, `domain` |

## Common Patterns

### 1. Navigate and Understand Page (Recommended First Step)

```bash
# Get page with interactive elements in one call
node ~/.claude/skills/firefox-browser/client.js navigate '{"url": "https://site.com", "returnInteractables": true}'
```

Returns: `{tabId, url, interactables: {elements: [...]}}`

### 2. Search a Website

```bash
# Navigate
node ~/.claude/skills/firefox-browser/client.js navigate '{"url": "https://duckduckgo.com"}'

# Type and submit
node ~/.claude/skills/firefox-browser/client.js type '{"selector": "input[name=q]", "text": "search query", "submit": true}'

# Wait for results
node ~/.claude/skills/firefox-browser/client.js waitFor '{"contains": "results", "timeout": 10000}'

# Get content
node ~/.claude/skills/firefox-browser/client.js getContent '{"format": "text"}'
```

### 3. Click Elements

```bash
# By CSS selector
node ~/.claude/skills/firefox-browser/client.js click '{"selector": "button.submit"}'

# By visible text
node ~/.claude/skills/firefox-browser/client.js click '{"text": "Sign In"}'

# By coordinates (for tricky elements)
node ~/.claude/skills/firefox-browser/client.js click '{"x": 100, "y": 200}'
```

### 4. Fill a Form

```bash
node ~/.claude/skills/firefox-browser/client.js fillForm '{"fields": [
  {"selector": "#email", "value": "user@example.com"},
  {"selector": "#password", "value": "secret"},
  {"selector": "#remember", "checked": true}
]}'
```

### 5. Fetch Multiple Pages in Parallel

```bash
node ~/.claude/skills/firefox-browser/client.js parallel '{"branches": [
  {"url": "https://site1.com", "commands": [{"action": "getContent", "params": {"format": "title"}}]},
  {"url": "https://site2.com", "commands": [{"action": "getContent", "params": {"format": "title"}}]}
]}'
```

### 6. Handle Uncertain UI (Try Alternatives)

```bash
node ~/.claude/skills/firefox-browser/client.js branch '{"alternatives": [
  {"action": "click", "params": {"selector": "#accept-cookies"}},
  {"action": "click", "params": {"text": "Accept"}},
  {"action": "click", "params": {"selector": ".cookie-banner button"}}
], "timeout": 3000}'
```

### 7. Take Screenshot

```bash
node ~/.claude/skills/firefox-browser/client.js screenshot '{}'
# Saves to /tmp/firefox-screenshot-<timestamp>.png

node ~/.claude/skills/firefox-browser/client.js screenshot '{"filename": "/tmp/my-screenshot.png"}'
```

## Using getContent with `annotated` Format (Recommended)

The `annotated` format combines page content with interactable elements inline, giving you everything in one call:

```bash
node ~/.claude/skills/firefox-browser/client.js getContent '{"format": "annotated"}'
```

Returns content with interactive elements marked:
```
Amazon Grocery, Ground Beef, 80% Lean/20% Fat, 1 lb
$4.99
In Stock
[button: "Qty: 1" | selector: #qty-button]
[button: "Add to cart" | selector: #add-to-cart-btn]

[input:text: "search" | value: "ground beef" | selector: #twotabsearchtextbox]
[link: "Go to Cart" | href: /cart | selector: #nav-cart]
```

**Format of annotations:**
- Buttons: `[button: "text" | selector: ...]`
- Links: `[link: "text" | href: ... | selector: ...]`
- Inputs: `[input:type: "name" | value: "..." | selector: ...]`

This is better than separate `getContent` + `getInteractables` calls because you can see the context around each button (which product it belongs to, etc.).

## Using getInteractables

The `getInteractables` action returns all clickable elements and form inputs. Use this to understand page structure:

```bash
node ~/.claude/skills/firefox-browser/client.js getInteractables '{}'
```

Returns:
```json
{
  "url": "https://example.com",
  "title": "Page Title",
  "elements": [
    {"type": "clickable", "tag": "A", "text": "Link Text", "selector": "#link-id", "rect": {...}},
    {"type": "input", "tag": "INPUT", "inputType": "text", "name": "email", "selector": "#email", "label": "Email"}
  ]
}
```

## Macros (Pre-built Workflows)

Run common multi-step tasks with one command:

```bash
# List available macros
node ~/.claude/skills/firefox-browser/macro.js

# Search DuckDuckGo
node ~/.claude/skills/firefox-browser/macro.js "search duckduckgo for weather in seattle"

# Search Google
node ~/.claude/skills/firefox-browser/macro.js "search google for best restaurants"

# Get page content
node ~/.claude/skills/firefox-browser/macro.js "get the content of https://example.com"
```

### 8. Working with Authentication

The bridge can detect auth pages and leverage the user's existing browser sessions:

```bash
# Check if current page is a login page
node ~/.claude/skills/firefox-browser/client.js getAuthContext '{}'
```

Returns:
```json
{
  "isAuthPage": true,
  "authType": "login",
  "detectedProvider": "Google",
  "availableAccounts": ["j***@gmail.com"],
  "formFields": ["email", "password"],
  "oauthOptions": ["Google", "GitHub"],
  "pageTitle": "Sign in",
  "config": {"authMode": "always-allow"}
}
```

**Auth workflow:**
```bash
# Navigate to a site requiring login
node ~/.claude/skills/firefox-browser/client.js navigate '{"url": "https://github.com/settings"}'

# Check auth context
node ~/.claude/skills/firefox-browser/client.js getAuthContext '{}'

# If already logged in (user's browser has cookies), just proceed
# If login page detected, the user can leverage their saved accounts

# Request auth with reason (shows desktop notification in "ask" mode)
node ~/.claude/skills/firefox-browser/client.js requestAuth '{"reason": "Access GitHub settings"}'
```

**Configure auth preferences:**
```bash
# Set global mode: always-allow (default), ask, or always-deny
node ~/.claude/skills/firefox-browser/client.js configureAuth '{"authMode": "always-allow"}'

# Set per-site rule
node ~/.claude/skills/firefox-browser/client.js configureAuth '{"domain": "github.com", "setSiteRule": "allow"}'

# Remove site rule
node ~/.claude/skills/firefox-browser/client.js configureAuth '{"domain": "example.com", "setSiteRule": "remove"}'
```

## Tips

1. **Always start with `navigate` + `returnInteractables: true`** - saves a round trip
2. **Use `textFast` format** when you just need raw text quickly
3. **Use `text` for finding elements** when CSS selectors are unreliable
4. **Use `batch`** to combine multiple commands into one request
5. **Use `parallel`** to fetch from multiple pages simultaneously
6. **Use `branch`** when the UI might vary (cookie banners, A/B tests)
7. **Screenshots save to `/tmp/`** by default - use Read tool to view them

## Troubleshooting

If commands fail:

1. **Check connection**: `node ~/.claude/skills/firefox-browser/client.js ping`
2. **Verify Firefox is running** with the Browser Agent Bridge extension loaded
3. **Check `about:debugging`** in Firefox for extension errors
4. **Element not found?** Use `getInteractables` to see what's actually on the page
