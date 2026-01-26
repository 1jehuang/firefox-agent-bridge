# TODO / Improvements

## Implemented

### 1. `evaluate` command returns JavaScript results ✅

**Implemented in:** `extension/content.js` - `handleEvaluate()`

```bash
browser evaluate '{"script": "return document.title"}'
# Returns: {"result": "Page Title", "type": "string"}
```

### 2. Form element state in `getContent` ✅

**Implemented in:** `extension/content.js` - `addInteractable()`

The annotated format now shows:
- `checked: true/false` for radio buttons and checkboxes
- `selected: "Option Text"` for select dropdowns
- `value: "..."` for text inputs (already existed)

### 3. Dedicated scroll command ✅

**Implemented in:** `extension/content.js` - `handleScroll()`

```bash
browser scroll '{"y": 500}'                    # Scroll down by pixels
browser scroll '{"selector": "#element"}'      # Scroll element into view
browser scroll '{"position": "bottom"}'        # Scroll to bottom
browser scroll '{"scrollTo": {"x": 0, "y": 1000}}'  # Absolute position
```

---

## Medium Priority (Future)

### 4. Get element state/properties

Add ability to query specific element properties:
```bash
browser getElement '{"selector": "#my-input", "properties": ["value", "checked", "disabled"]}'
# Returns: {"value": "hello", "checked": false, "disabled": false}
```

### 5. Wait for element state

Extend `waitFor` to support state conditions:
```bash
browser waitFor '{"selector": "#submit", "state": "enabled"}'
browser waitFor '{"selector": "#loading", "state": "hidden"}'
```

### 6. Keyboard input

Send keyboard events beyond just typing text:
```bash
browser press '{"key": "Enter"}'
browser press '{"key": "Tab", "selector": "#input"}'
browser press '{"key": "Escape"}'
```

---

## Notes

- Improvements 1-3 were identified while using the bridge with Claude Code to interact with a Canvas LMS quiz
- The main pain point was verifying which radio buttons were selected without relying on screenshots
- After implementing these, the bridge can now properly report form state and execute/return JS results
