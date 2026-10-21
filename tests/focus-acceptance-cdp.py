#!/usr/bin/env python3
"""Acceptance test: does the real extension steal focus in a real browser?

Attaches to the extension's service worker over CDP, calls the actual
action handlers through the extension's own message router, and reads tab
state back from the real browser via chrome.tabs. No mocks, no stubs: the
browser decides what "active" means.

Usage: focus_acceptance.py <cdp-port>
"""
import json
import sys
import time
import urllib.request

import websocket

PORT = sys.argv[1] if len(sys.argv) > 1 else "9222"


def sw_socket():
    targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list"))
    for t in targets:
        if t.get("type") == "service_worker" and "ijifge" in t.get("url", ""):
            return t["webSocketDebuggerUrl"]
    raise SystemExit("extension service worker not found")


class SW:
    def __init__(self):
        self.ws = websocket.create_connection(sw_socket(), timeout=25)
        self.id = 0

    def eval(self, expr):
        self.id += 1
        self.ws.send(json.dumps({
            "id": self.id,
            "method": "Runtime.evaluate",
            "params": {
                "expression": expr,
                "awaitPromise": True,
                "returnByValue": True,
            },
        }))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == self.id:
                r = msg.get("result", {})
                if "exceptionDetails" in r:
                    raise RuntimeError(json.dumps(r["exceptionDetails"])[:400])
                return r.get("result", {}).get("value")


sw = SW()

# Ground truth comes from the browser, not from the extension's own cache.
STATE = """
(async () => {
  const tabs = await chrome.tabs.query({});
  const wins = await chrome.windows.getAll();
  return {
    active: tabs.filter(t => t.active).map(t => [t.id, t.windowId]),
    focusedWindows: wins.filter(w => w.focused).map(w => w.id),
    tabCount: tabs.length,
  };
})()
"""


def state():
    return sw.eval(STATE)


def call(action, params):
    """Invoke the extension's real action router, exactly as the native host does."""
    expr = (
        "(async () => { try { return { ok: true, result: await dispatchAction("
        + json.dumps(action) + ", " + json.dumps(params) + ", null"
        + ") }; } catch (e) { return { ok: false, error: String(e) }; } })()"
    )
    return sw.eval(expr)


def has_router():
    return sw.eval("typeof dispatchAction")


results = []


def record(name, ok, detail=""):
    results.append((name, ok))
    print(f"  {'ok  ' if ok else 'FAIL'} {name}" + (f" -- {detail}" if detail else ""))


print(f"acceptance: real browser, CDP port {PORT}")
print(f"  router: dispatchAction = {has_router()}\n")

base = state()
print(f"  baseline: active={base['active']} focusedWindows={base['focusedWindows']}\n")
base_active = [tuple(a) for a in base["active"]]

# --- 1. newWindow must not raise a window ---
r = call("newWindow", {"url": "about:blank", "returnContent": False})
time.sleep(1.2)
s = state()
new_win = r.get("result", {}).get("windowId") if r.get("ok") else None
stole = new_win in s["focusedWindows"]
record("newWindow does not raise the new window", not stole,
       f"focused={s['focusedWindows']} new={new_win} err={r.get('error','')}")

# --- 2. newWindow focus:true must still raise ---
r = call("newWindow", {"url": "about:blank", "focus": True, "returnContent": False})
time.sleep(1.2)
s = state()
win2 = r.get("result", {}).get("windowId") if r.get("ok") else None
record("newWindow honors explicit focus:true", win2 in s["focusedWindows"],
       f"focused={s['focusedWindows']} new={win2} err={r.get('error','')}")

# --- 3. navigate newTab must not activate ---
before = state()
before_active = [tuple(a) for a in before["active"]]
r = call("navigate", {"url": "https://example.com", "newTab": True,
                      "wait": False, "returnContent": False})
time.sleep(1.5)
after = state()
new_tab = r.get("result", {}).get("tabId") if r.get("ok") else None
after_active = [tuple(a) for a in after["active"]]
stole = any(t == new_tab for t, _ in after_active)
record("navigate newTab does not activate the new tab", not stole,
       f"newTab={new_tab} active={after_active} err={r.get('error','')}")

# --- 4. navigate newTab focus:true must activate ---
r = call("navigate", {"url": "https://example.com", "newTab": True, "focus": True,
                      "wait": False, "returnContent": False})
time.sleep(1.5)
s = state()
tab4 = r.get("result", {}).get("tabId") if r.get("ok") else None
record("navigate newTab honors focus:true",
       any(t == tab4 for t, _ in [tuple(a) for a in s["active"]]),
       f"newTab={tab4} active={s['active']} err={r.get('error','')}")

# --- 5. screenshot of a background tab must not change the active tab ---
r = call("newSession", {"url": "https://example.com", "wait": False, "returnContent": False})
bg_tab = r.get("result", {}).get("tabId") if r.get("ok") else None
time.sleep(1.5)
pre = state()
pre_active = [tuple(a) for a in pre["active"]]
r = call("screenshot", {"tabId": bg_tab})
time.sleep(1.0)
post = state()
post_active = [tuple(a) for a in post["active"]]
record("screenshot of a background tab leaves the active tab alone",
       pre_active == post_active,
       f"bgTab={bg_tab} before={pre_active} after={post_active} err={r.get('error','')}")

# --- 6. setActiveTab must not focus by default ---
pre = state()
pre_active = [tuple(a) for a in pre["active"]]
r = call("setActiveTab", {"tabId": bg_tab})
time.sleep(0.8)
post = state()
post_active = [tuple(a) for a in post["active"]]
record("setActiveTab does not focus by default", pre_active == post_active,
       f"before={pre_active} after={post_active} err={r.get('error','')}")

passed = sum(1 for _, ok in results if ok)
print(f"\n{passed} passed, {len(results) - passed} failed")
sys.exit(0 if passed == len(results) else 1)
