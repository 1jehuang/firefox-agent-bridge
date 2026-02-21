---
name: firefox-browser
description: Control the user's Firefox browser with their logins and cookies intact. Use when you need to browse websites as the user, interact with authenticated pages, fill forms, click buttons, take screenshots, or get page content. (user)
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

# With timing info
browser --timing <action> '<json_params>'

# With screen recording
browser --record /path/to/dir <action> '<json_params>'
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

### Rich Text Editors & File Operations

| Action | Description | Key Params |
|--------|-------------|------------|
| `uploadFile` | Upload file to `<input type="file">` | `selector`, `path` (local file path) |
| `dropFile` | Drag-and-drop file onto element | `selector`, `path` (local file path) |
| `evaluate` | Run JavaScript in page context | `script`, `pageWorld` (bool) |

#### uploadFile - Upload Files to Input Elements

```bash
browser uploadFile '{"selector": "#fileInput", "path": "/home/user/doc.pdf"}'
```

The CLI reads the file, base64-encodes it, and sends it via `fillForm` internally. Works with any `<input type="file">` including hidden ones.

#### dropFile - Drag-and-Drop Files

```bash
browser dropFile '{"selector": "#dropZone", "path": "/home/user/image.png"}'
```

Simulates a native file drop. Creates a DataTransfer with the file and dispatches dragenter → dragover → drop events in the page world. Works with drop zones, contenteditable editors, and any element with drop handlers.

#### evaluate - Run JavaScript on the Page

```bash
# Simple evaluation
browser evaluate '{"script": "return document.title"}'

# In page world (needed for accessing page JS objects)
browser evaluate '{"script": "return window.someAppState", "pageWorld": true}'
```

Use `pageWorld: true` when you need to interact with the page's own JavaScript context (React state, app globals, etc). Default runs in content script context.

#### fillForm - The Right Way to Fill Forms

**IMPORTANT:** There is no `fill` command. Use `fillForm` with a `fields` array:

```bash
# Fill a single field
browser fillForm '{"fields": [{"selector": "#email", "value": "test@example.com"}]}'

# Fill multiple fields at once (text inputs, textareas, AND select dropdowns)
browser fillForm '{"fields": [
  {"selector": "#name", "value": "John Doe"},
  {"selector": "#email", "value": "john@example.com"},
  {"selector": "#subject", "value": "support"},
  {"selector": "#message", "value": "Hello world"}
]}'
```

Works with: `<input>`, `<textarea>`, `<select>`, checkboxes, radio buttons, contenteditable elements, rich text editors (Draft.js, Lexical, TinyMCE, ProseMirror).

For rich text editors, fillForm automatically detects the editor type and uses the appropriate insertion method (execCommand, InputEvent, or direct DOM manipulation in page world).

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

### 1. Start by Inspecting Available Tabs

```bash
browser listTabs '{}'
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
browser newSession '{"url": "https://amazon.com"}'

# Start in sandbox (private window, no cookies)
browser newSession '{"url": "https://example.com", "sandbox": true}'

# Or switch to existing tab
browser setActiveTab '{"tabId": 456}'
```

### 3. Read Page with Annotated Format (Recommended)

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

This shows **what's clickable** and **where it is in context**.

### 4. Interact Using Selectors

```bash
# Click using selector from annotated output
browser click '{"selector": "#add-btn"}'

# Or by text (prefers visible elements)
browser click '{"text": "Add to cart"}'

# Type into input
browser type '{"selector": "#search-box", "text": "query", "submit": true}'
```

---

## Fork: Speculative Parallel Execution

When you're not sure which path is right, fork the tab and try both:

```bash
# Create forks
browser fork '{
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
browser getContent '{"format": "annotated", "fork": "google-auth"}'
browser click '{"text": "Continue", "fork": "google-auth"}'
```

Kill the wrong path:
```bash
browser killFork '{"fork": "email-auth"}'
```

---

## TryUntil: Handle Uncertain UI

When the exact button varies (cookie banners, A/B tests):

```bash
browser tryUntil '{
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
browser parallel '{
  "branches": [
    {"url": "https://amazon.com/product", "commands": [{"action": "getContent", "params": {"format": "text"}}]},
    {"url": "https://walmart.com/product", "commands": [{"action": "getContent", "params": {"format": "text"}}]}
  ]
}'
```

---

## Authentication (Autonomous Login)

The bridge integrates with a Bitwarden vault (via [bronzewarden](https://github.com/1jehuang/bronzewarden)) for fully autonomous credential fill. No human interaction needed.

### Initial Setup

**1. Install bronzewarden** (local Bitwarden vault client):

```bash
cd ~/projects/bronzewarden   # or wherever you cloned it
cargo install --path .
```

**2. Log in to Bitwarden:**

```bash
# With email + master password
bronzewarden login -e you@example.com

# Or with API key (if password login is challenged by 2FA/captcha)
# Get your API key from: Bitwarden Web Vault → Settings → Security → Keys → API Key
export BW_CLIENTID="user.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
export BW_CLIENTSECRET="your_client_secret"
bronzewarden login --apikey
```

**3. Sync the vault:**

```bash
bronzewarden sync
```

This downloads and caches your encrypted vault locally at `~/.config/bronzewarden/vault.json`.

**4. Set up passwordless unlock** (so the native host can unlock the vault automatically):

```bash
bronzewarden setup-fingerprint
```

This prompts for your master password one last time, derives the decryption key, and stores it in `~/.config/bronzewarden/protected_key.json`. After this, the native host unlocks the vault at startup without any password prompt.

**Alternative: password file unlock** (if you don't want to use setup-fingerprint):

```bash
# Store master password in a file (permissions should be 0600)
echo "your_master_password" > ~/.config/bronzewarden/master_password
chmod 600 ~/.config/bronzewarden/master_password
export BW_PASSWORD_FILE=~/.config/bronzewarden/master_password
```

Add the `BW_PASSWORD_FILE` export to `native-host-wrapper.sh` so it's available when Firefox launches the host.

**5. Set up API key for vault sync** (needed for `browser vaultSync`):

```bash
# Store your Bitwarden API credentials
echo "user.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" > ~/.config/bronzewarden/client_id
echo "your_client_secret" > ~/.config/bronzewarden/client_secret
chmod 600 ~/.config/bronzewarden/client_id ~/.config/bronzewarden/client_secret
```

Or set environment variables `BW_CLIENT_ID` and `BW_CLIENT_SECRET` in `native-host-wrapper.sh`.

**6. Verify it works:**

```bash
browser ping                    # Check bridge connection
browser vaultStatus '{}'        # Should show: {"locked": false, "loginEntries": N}
```

### Fingerprint Verification (Optional Security)

By default, `autoLogin` requires fingerprint verification before filling credentials. This is controlled by:

```bash
# In native-host-wrapper.sh:
export FAB_AUTOLOGIN_REQUIRE_FINGERPRINT=true   # Require fingerprint touch (default)
export FAB_AUTOLOGIN_REQUIRE_FINGERPRINT=false   # No fingerprint needed (fully autonomous)
```

When enabled, a desktop notification prompts you to touch the fingerprint sensor before credentials are filled. Requires `fprintd` to be installed and a fingerprint enrolled.

### Auto-Login Flow

```bash
# 1. Navigate to the site
browser navigate '{"url": "https://github.com"}'

# 2. Auto-fill credentials (looks up domain in vault, fills form)
browser autoLogin '{"domain": "github.com", "submit": false}'
# Returns: {"filled": true, "maskedUsername": "j***1", "matchedUri": "https://github.com/"}

# 3. Or auto-fill AND submit in one step
browser autoLogin '{"domain": "github.com", "submit": true}'
```

### Vault Management

```bash
# Check vault status
browser vaultStatus '{}'
# Returns: {"locked": false, "loginEntries": 322}

# Re-sync vault from server (if credentials were updated)
browser vaultSync '{}'
# Returns: {"synced": true, "loginEntries": 322}
```

### How It Works
- Credentials are stored in Bitwarden and decrypted locally by the native host
- The `autoLogin` action sends credentials directly to the extension via the native messaging channel (never over WebSocket)
- Vault is auto-unlocked at host startup using a protected key (from `setup-fingerprint`) or a password file (`BW_PASSWORD_FILE`)
- Credential lookup priority: `BW_PASSWORD` env var → `BW_PASSWORD_FILE` → protected key → gnome-keyring (deprecated)
- API credential lookup priority: `BW_CLIENT_ID`/`BW_CLIENT_SECRET` env vars → `~/.config/bronzewarden/client_id`/`client_secret` files

### Legacy Auth Detection

```bash
# Detect login pages and available accounts
browser getAuthContext '{}'
```

---

## Evaluate: Run JavaScript and Get Results

Execute arbitrary JavaScript in the page context and get the result back:

```bash
# Get page title
browser evaluate '{"script": "return document.title"}'
# Returns: {"result": "My Page Title", "type": "string"}

# Count elements
browser evaluate '{"script": "return document.querySelectorAll(\"input\").length"}'
# Returns: {"result": 5, "type": "number"}

# Get form values
browser evaluate '{"script": "return document.querySelector(\"#email\").value"}'
# Returns: {"result": "user@example.com", "type": "string"}

# Complex queries
browser evaluate '{"script": "return Array.from(document.querySelectorAll(\"input:checked\")).map(el => el.value)"}'
# Returns: {"result": ["option1", "option3"], "type": "object"}
```

**Note:** Use `return` to get a value back. The script runs in page context with full DOM access.

---

## Scroll: Navigate Long Pages

Scroll the page by pixels, to elements, or to positions:

```bash
# Scroll down 500 pixels
browser scroll '{"y": 500}'

# Scroll up 300 pixels
browser scroll '{"y": -300}'

# Scroll element into view
browser scroll '{"selector": "#section-5"}'

# Scroll to top/bottom
browser scroll '{"position": "top"}'
browser scroll '{"position": "bottom"}'

# Smooth scrolling
browser scroll '{"y": 500, "behavior": "smooth"}'

# Scroll to absolute position
browser scroll '{"scrollTo": {"x": 0, "y": 1000}}'
```

---

## Form State in Annotated Content

The `getContent` annotated format now shows form element states:

```bash
browser getContent '{"format": "annotated"}'
```

Output includes checked/selected states:
```
[input:radio: "Option A" | checked: true | selector: #opt-a]
[input:radio: "Option B" | checked: false | selector: #opt-b]
[input:checkbox: "Remember me" | checked: true | selector: #remember]
[select: "Country" | selected: "United States" | selector: #country]
[input:text: "Email" | value: "user@example.com" | selector: #email]
```

This is useful for verifying form state without screenshots.

---

## Isolated Sessions (for Parallel Execution)

When running multiple tasks in parallel, use `tabId` to avoid conflicts:

```bash
# 1. Create isolated session - get a unique tabId
browser newSession '{"url": "https://example.com"}'
# Returns: {"tabId": 15, "url": "...", "windowId": 1}

# 2. Use that tabId in ALL subsequent commands
browser navigate '{"url": "https://example.com/page", "tabId": 15}'
browser getContent '{"format": "annotated", "tabId": 15}'
browser click '{"selector": "#btn", "tabId": 15}'
browser type '{"selector": "#input", "text": "hello", "tabId": 15}'
```

This lets multiple agents work in parallel without stepping on each other.

## Tips

1. **Start with `listTabs`** to see what's open
2. **Use `newSession`** for a clean start
3. **Use `tabId`** for parallel/isolated execution
4. **Use `annotated` format** - shows content + clickable elements together
5. **Use selectors from annotated output** - more reliable than text matching
6. **Fork when uncertain** - try multiple paths, kill the wrong ones
7. **Never use `sleep` commands** - browser commands are synchronous and wait for completion. Use `waitFor` action if you need to wait for specific elements or text to appear
8. **Use `uploadFile` for file inputs** - reads local files and uploads automatically
9. **Use `dropFile` for drop zones** - simulates native drag-and-drop
10. **Use `evaluate` for custom JS** - with `pageWorld: true` for page-context access

## Troubleshooting

1. **Firefox not running?** Start it: `nohup firefox &>/dev/null &`
2. **Check connection**: `browser ping`
3. **Connection refused?** The extension may need to be reloaded in `about:debugging`
4. **Element not found?** Use `browser getContent '{"format": "annotated"}'` to see what's on the page
5. **Rich text editor not filling?** `fillForm` handles Draft.js, Lexical, TinyMCE, ProseMirror automatically
6. **File drop not working?** `dropFile` runs in page world to bypass Firefox security restrictions
