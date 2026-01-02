# Command API

All commands are JSON objects sent over WebSocket:

```json
{
  "id": "optional-client-id",
  "action": "navigate | click | type | getContent | screenshot | getActiveTab | ping",
  "params": { "...": "..." }
}
```

## Actions

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

### getContent

```json
{ "action": "getContent", "params": { "format": "text" } }
```

Params:
- `format`: `html` | `text` | `title`
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
