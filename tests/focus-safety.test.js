#!/usr/bin/env node
/**
 * Focus-safety regression tests for extension/background.js.
 *
 * The extension must never activate a tab or raise a window unless the
 * caller asked for it with focus:true. These tests load background.js in a
 * sandbox with a fake `browser` API that records every activation, then
 * drive the real action handlers and assert nothing stole focus.
 *
 * Run: node tests/focus-safety.test.js
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const BACKGROUND = path.join(__dirname, "..", "extension", "background.js");

let failures = 0;
let passes = 0;

function check(name, cond, detail) {
  if (cond) {
    passes++;
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

/** Build a fake WebExtension `browser` that logs focus-relevant mutations. */
function makeBrowser() {
  const events = [];
  let nextId = 100;

  const tabs = new Map();
  // Window 1: human's window, tab 1 active.
  tabs.set(1, { id: 1, windowId: 1, active: true, url: "https://human.example", title: "human" });
  tabs.set(2, { id: 2, windowId: 1, active: false, url: "https://bg.example", title: "bg" });

  const noopListener = { addListener() {}, removeListener() {} };

  const browser = {
    __events: events,
    __tabs: tabs,
    runtime: {
      connectNative: () => ({
        onMessage: noopListener,
        onDisconnect: noopListener,
        postMessage() {},
        disconnect() {},
      }),
      onMessage: noopListener,
      onStartup: noopListener,
      sendMessage: () => Promise.resolve(),
      getManifest: () => ({ version: "test" }),
      lastError: null,
    },
    alarms: { create() {}, onAlarm: noopListener },
    browserAction: { setBadgeText() {}, setBadgeBackgroundColor() {}, setTitle() {} },
    action: { setBadgeText() {}, setBadgeBackgroundColor() {}, setTitle() {} },
    tabs: {
      onUpdated: noopListener,
      onActivated: noopListener,
      onRemoved: noopListener,
      async get(id) {
        const t = tabs.get(id);
        if (!t) throw new Error(`no tab ${id}`);
        return { ...t };
      },
      async query(q) {
        return [...tabs.values()]
          .filter(t => (q.active === undefined || t.active === q.active))
          .filter(t => (q.windowId === undefined || t.windowId === q.windowId))
          .filter(t => (q.currentWindow === undefined || t.windowId === 1))
          .map(t => ({ ...t }));
      },
      async create(props) {
        const id = nextId++;
        const windowId = props.windowId ?? 1;
        const tab = {
          id,
          windowId,
          active: props.active === true,
          url: props.url || "about:blank",
          title: "created",
        };
        if (tab.active) {
          events.push({ type: "tab-activated", tabId: id, via: "create" });
          for (const t of tabs.values()) if (t.windowId === windowId) t.active = false;
        }
        tabs.set(id, tab);
        return { ...tab };
      },
      async update(id, props) {
        const tab = tabs.get(id);
        if (!tab) throw new Error(`no tab ${id}`);
        if (props.active === true && !tab.active) {
          events.push({ type: "tab-activated", tabId: id, via: "update" });
          for (const t of tabs.values()) if (t.windowId === tab.windowId) t.active = false;
          tab.active = true;
        }
        if (props.url) tab.url = props.url;
        return { ...tab };
      },
      async sendMessage() {
        throw new Error("no content script in test");
      },
      async captureVisibleTab() {
        return "data:image/png;base64,TEST";
      },
      // captureTab deliberately absent: forces the legacy focus-stealing path.
    },
    windows: {
      onFocusChanged: noopListener,
      async create(props) {
        const windowId = nextId++;
        const tabId = nextId++;
        if (props.focused === true) {
          events.push({ type: "window-focused", windowId, via: "create" });
        }
        const tab = {
          id: tabId,
          windowId,
          active: true,
          url: props.url || "about:blank",
          title: "new window",
        };
        tabs.set(tabId, tab);
        return { id: windowId, tabs: [{ ...tab }] };
      },
      async update(windowId, props) {
        if (props.focused === true) {
          events.push({ type: "window-focused", windowId, via: "update" });
        }
        return { id: windowId };
      },
    },
  };
  return browser;
}

function loadBackground(browser) {
  const code = fs.readFileSync(BACKGROUND, "utf8");
  const sandbox = {
    browser,
    chrome: browser,
    console: { log() {}, warn() {}, error() {}, debug() {} },
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms || 0, 5)),
    clearTimeout,
    setInterval: () => 0,
    clearInterval,
    performance: { now: () => Date.now() },
    TextEncoder,
    TextDecoder,
    Date,
    Math,
    JSON,
    Promise,
    Error,
    Number,
    String,
    Object,
    Array,
    globalThis: null,
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  // Expose the internal handlers for direct invocation.
  vm.runInContext(
    code +
      "\n;globalThis.__handlers = { openSessionTarget, newSession, newWindow, navigateTo, setActiveTab, captureScreenshot };",
    ctx,
    { filename: "background.js" }
  );
  return sandbox.__handlers;
}

async function run() {
  console.log("focus-safety: extension/background.js\n");

  // 1. newWindow must not focus by default.
  {
    const browser = makeBrowser();
    const h = loadBackground(browser);
    await h.newWindow({ url: "about:blank" });
    const stole = browser.__events.filter(e => e.type === "window-focused");
    check("newWindow defaults to background", stole.length === 0, JSON.stringify(stole));
  }

  // 2. newWindow with focus:true must still honor an explicit request.
  {
    const browser = makeBrowser();
    const h = loadBackground(browser);
    await h.newWindow({ url: "about:blank", focus: true });
    const stole = browser.__events.filter(e => e.type === "window-focused");
    check("newWindow honors explicit focus:true", stole.length === 1, JSON.stringify(stole));
  }

  // 3. newSession targeting a specific windowId must not raise that window.
  {
    const browser = makeBrowser();
    const h = loadBackground(browser);
    await h.newSession({ url: "about:blank", windowId: 1 });
    const stole = browser.__events.filter(
      e => e.type === "tab-activated" || e.type === "window-focused"
    );
    check("newSession with windowId stays background", stole.length === 0, JSON.stringify(stole));
  }

  // 4. navigate with newTab must not activate the new tab by default.
  {
    const browser = makeBrowser();
    const h = loadBackground(browser);
    await h.navigateTo({ url: "https://agent.example", newTab: true, wait: false, returnContent: false });
    const stole = browser.__events.filter(e => e.type === "tab-activated");
    check("navigate newTab defaults to background", stole.length === 0, JSON.stringify(stole));
  }

  // 5. navigate with newTab + focus:true must activate.
  {
    const browser = makeBrowser();
    const h = loadBackground(browser);
    await h.navigateTo({
      url: "https://agent.example",
      newTab: true,
      focus: true,
      wait: false,
      returnContent: false,
    });
    const stole = browser.__events.filter(e => e.type === "tab-activated");
    check("navigate newTab honors focus:true", stole.length === 1, JSON.stringify(stole));
  }

  // 6. setActiveTab must not focus by default.
  {
    const browser = makeBrowser();
    const h = loadBackground(browser);
    await h.setActiveTab({ tabId: 2 });
    const stole = browser.__events.length;
    check("setActiveTab defaults to background", stole === 0, JSON.stringify(browser.__events));
  }

  // 7. screenshot of a background tab must restore the human's active tab.
  {
    const browser = makeBrowser();
    const h = loadBackground(browser);
    await h.captureScreenshot({ tabId: 2 });
    const finalActive = [...browser.__tabs.values()].filter(t => t.windowId === 1 && t.active);
    check(
      "screenshot fallback restores the previously active tab",
      finalActive.length === 1 && finalActive[0].id === 1,
      `active=${JSON.stringify(finalActive.map(t => t.id))} events=${JSON.stringify(browser.__events)}`
    );
  }

  // 8. screenshot of the already-active tab must not touch focus at all.
  {
    const browser = makeBrowser();
    const h = loadBackground(browser);
    await h.captureScreenshot({ tabId: 1 });
    check("screenshot of active tab is a no-op for focus", browser.__events.length === 0, JSON.stringify(browser.__events));
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(err => {
  console.error("harness error:", err);
  process.exit(1);
});
