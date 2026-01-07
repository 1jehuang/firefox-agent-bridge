---
name: firefox-browser
description: Control the user's Firefox browser with their logins and cookies intact. Use when you need to browse websites as the user, interact with authenticated pages, fill forms, click buttons, take screenshots, or get page content. (user)
allowed-tools: Bash, Read, Write
---

# Firefox Browser Agent Bridge

Control the user's actual Firefox browser session via WebSocket. This uses their real browser with existing logins and cookies - **not** a headless browser.

## Quick Start

```bash
# 1. Check connection
node ~/.claude/skills/firefox-browser/client.js ping

# 2. See what tabs are open
node ~/.claude/skills/firefox-browser/client.js listTabs '{}'

# 3. Start a new session (recommended)
node ~/.claude/skills/firefox-browser/client.js newSession '{"url": "https://example.com"}'

# 4. Read the page with interactable elements marked
node ~/.claude/skills/firefox-browser/client.js getContent '{"format": "annotated"}'
```

## Client Usage

```bash
node ~/.claude/skills/firefox-browser/client.js <action> '<json_params>'
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
| `type` | Type into input | `selector`, `text`, `submit`, `clear` |
| `fillForm` | Fill multiple fields | `fields[]` with selector/value pairs |
| `waitFor` | Wait for element/text | `selector`, `text`, `timeout` |

### Control Flow

| Action | Description | Key Params |
|--------|-------------|------------|
| `fork` | Duplicate tab into multiple paths | `paths[]` with name + commands |
| `killFork` | Close a fork | `fork` (name) |
| `listForks` | List active forks | - |
| `tryUntil` | Try alternatives until one succeeds | `alternatives[]`, `timeout` |
| `parallel` | Run commands on multiple URLs | `branches[]` with url + commands |

### Authentication

| Action | Description | Key Params |
|--------|-------------|------------|
| `getAuthContext` | Detect login pages, available accounts | - |
| `requestAuth` | Request user approval for auth | `reason` |
| `configureAuth` | Set auth preferences | `authMode`, `setSiteRule`, `domain` |

---

## Recommended Workflow

### 1. Start by Inspecting Available Tabs

```bash
node ~/.claude/skills/firefox-browser/client.js listTabs '{}'
```

Returns:
```json
{
  "activeTabId": 123,
  "windows": [
    {
      "windowId": 1,
      "focused": true,
      "tabs": [
        {"tabId": 123, "url": "https://...", "title": "...", "active": true}
      ]
    }
  ],
  "totalTabs": 5
}
```

### 2. Start Fresh or Pick Existing Tab

```bash
# Start fresh
node ~/.claude/skills/firefox-browser/client.js newSession '{"url": "https://amazon.com"}'

# Or switch to existing tab
node ~/.claude/skills/firefox-browser/client.js setActiveTab '{"tabId": 456}'
```

### 3. Read Page with Annotated Format (Recommended)

```bash
node ~/.claude/skills/firefox-browser/client.js getContent '{"format": "annotated"}'
```

Returns content with interactive elements marked inline:
```
Product Name Here
$4.99
[button: "Add to cart" | selector: #add-btn]
[input:text: "search" | value: "" | selector: #search-box]
[link: "View details" | href: /product/123 | selector: a.details-link]
```

This shows **what's clickable** and **where it is in context**.

### 4. Interact Using Selectors

```bash
# Click using selector from annotated output
node ~/.claude/skills/firefox-browser/client.js click '{"selector": "#add-btn"}'

# Or by text (prefers visible elements)
node ~/.claude/skills/firefox-browser/client.js click '{"text": "Add to cart"}'

# Type into input
node ~/.claude/skills/firefox-browser/client.js type '{"selector": "#search-box", "text": "query", "submit": true}'
```

---

## Fork: Speculative Parallel Execution

When you're not sure which path is right, fork the tab and try both:

```bash
# Create forks
node ~/.claude/skills/firefox-browser/client.js fork '{
  "paths": [
    {
      "name": "google-auth",
      "commands": [{"action": "click", "params": {"text": "Sign in with Google"}}]
    },
    {
      "name": "email-auth",
      "commands": [{"action": "click", "params": {"text": "Sign in with Email"}}]
    }
  ]
}'
```

Returns:
```json
{
  "forked": true,
  "sourceTabId": 123,
  "forks": [
    {"name": "google-auth", "tabId": 456, "url": "...", "commandResults": [...]},
    {"name": "email-auth", "tabId": 789, "url": "...", "commandResults": [...]}
  ]
}
```

Work on specific fork:
```bash
node ~/.claude/skills/firefox-browser/client.js getContent '{"format": "annotated", "fork": "google-auth"}'
node ~/.claude/skills/firefox-browser/client.js click '{"text": "Continue", "fork": "google-auth"}'
```

Kill the wrong path:
```bash
node ~/.claude/skills/firefox-browser/client.js killFork '{"fork": "email-auth"}'
```

---

## TryUntil: Handle Uncertain UI

When the exact button varies (cookie banners, A/B tests):

```bash
node ~/.claude/skills/firefox-browser/client.js tryUntil '{
  "alternatives": [
    {"action": "click", "params": {"selector": "#accept-cookies"}},
    {"action": "click", "params": {"text": "Accept All"}},
    {"action": "click", "params": {"selector": ".cookie-dismiss"}}
  ],
  "timeout": 3000
}'
```

Tries each until one succeeds.

---

## Parallel: Multiple URLs at Once

Compare prices across sites:

```bash
node ~/.claude/skills/firefox-browser/client.js parallel '{
  "branches": [
    {"url": "https://amazon.com/product", "commands": [{"action": "getContent", "params": {"format": "text"}}]},
    {"url": "https://walmart.com/product", "commands": [{"action": "getContent", "params": {"format": "text"}}]}
  ]
}'
```

---

## Authentication

The bridge detects auth pages and leverages existing browser sessions:

```bash
# Check if on login page
node ~/.claude/skills/firefox-browser/client.js getAuthContext '{}'

# Returns available accounts, OAuth options, etc.
```

---

## Tips

1. **Start with `listTabs`** to see what's open
2. **Use `newSession`** for a clean start
3. **Use `annotated` format** - shows content + clickable elements together
4. **Use selectors from annotated output** - more reliable than text matching
5. **Fork when uncertain** - try multiple paths, kill the wrong ones

## Troubleshooting

1. **Check connection**: `client.js ping`
2. **Verify Firefox is running** with Browser Agent Bridge extension
3. **Check `about:debugging`** in Firefox for extension errors
4. **Element not found?** Use `getContent '{"format": "annotated"}'` to see what's on the page
