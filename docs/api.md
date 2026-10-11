# Command API

All commands are JSON objects sent over WebSocket:

```json
{
  "id": "optional-client-id",
  "action": "newSession | newWindow | navigate | click | type | fillForm | getContent | screenshot | getActiveTab | ping",
  "params": { "...": "..." },
  "profile": true
}
```

When `profile` (or `params.profile`) is true, responses include a `timing` object with:
- `hostMs` (native host end-to-end)
- `extensionMs` (background script time)
- `contentMs` (content script time when applicable)
## Actions

### newWindow

```json
{ "action": "newWindow", "params": { "url": "https://example.com" } }
```

Params:
- `url` (optional, defaults to `about:blank`)
- `focus` (optional, defaults true)
- `wait` (optional, boolean)
- `timeoutMs` (optional)
- `sandbox` (optional, boolean; opens private window with no cookies/cache)
- `returnContent` (optional, defaults true when url is not `about:blank`)
- `contentFormat` (optional, defaults `annotated`)

Returns the new window's `tabId` and `windowId`.

### navigate

```json
{ "action": "navigate", "params": { "url": "https://example.com", "wait": true } }
```

Params:
- `url` (required)
- `tabId` (optional)
- `newTab` (optional, boolean)
- `wait` (optional, boolean)
- `timeoutMs` (optional)

### click

```json
{ "action": "click", "params": { "selector": "button.submit" } }
```

Params:
- `selector` (CSS selector)
- `text` (find element by text)
- `x`, `y` (viewport coordinates)
- `tabId` (optional)
- `frameId` (optional)
- `dispatchEvents` (optional, defaults true; set false for faster direct click)

### type

```json
{ "action": "type", "params": { "selector": "input[name=q]", "text": "hello" } }
```

Params:
- `selector` (CSS selector)
- `text` (required)
- `append` (optional)
- `clear` (optional, defaults true)
- `submit` (optional, submit parent form)
- `tabId` (optional)
- `frameId` (optional)
- `dispatchEvents` (optional, defaults true; set false to skip input/change events)

### fillForm

Fill multiple form fields at once. Works with `<input>`, `<textarea>`, `<select>`, checkboxes, and radio buttons.

```json
{ "action": "fillForm", "params": {
  "fields": [
    { "selector": "#name", "value": "John Doe" },
    { "selector": "#email", "value": "john@example.com" },
    { "selector": "#subject", "value": "support" },
    { "selector": "#message", "value": "Hello world" }
  ]
}}
```

Params:
- `fields` (required) - array of `{ selector, value }` objects
- `tabId` (optional)
- `frameId` (optional)

**Note:** There is no `fill` action. Use `fillForm` with a single-element `fields` array for individual fields.

### getContent

```json
{ "action": "getContent", "params": { "format": "text" } }
```

Params:
- `format`: `html` | `text` | `textFast` | `title`
- `selector` (optional)
- `tabId` (optional)
- `frameId` (optional)

### screenshot

Returns a PNG data URL.

```json
{ "action": "screenshot" }
```

Params:
- `tabId` (optional)

### getActiveTab

```json
{ "action": "getActiveTab" }
```

### ping

```json
{ "action": "ping" }
```
