# Performance & Profiling

The bridge supports low-overhead profiling by setting `profile: true` (or `params.profile: true`) on any request.

## What you get

Responses include timing data:

```json
{
  "timing": {
    "hostMs": 12.3,
    "extensionMs": 4.1,
    "contentMs": 2.7
  }
}
```

- `hostMs`: end-to-end time in the native host (WebSocket receive → native response)
- `extensionMs`: background script time
- `contentMs`: content script time (only for DOM actions)

## Quick profiling loop

From `native-host/`:

```bash
node profile-client.js ping "{}" 25
node profile-client.js getContent '{"format":"textFast"}' 10
node profile-client.js click '{"selector":"button"}' 10
```

The script prints average, p50, p95, and max for client, host, extension, and content timings.

## Speed tips

- Prefer `textFast` for fast page text extraction.
- Provide `tabId` when possible to skip active tab lookup.
- For clicks, set `dispatchEvents: false` for fastest direct click when the page allows it.
