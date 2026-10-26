"use strict";

// Regression tests for tab targeting in extension/background.js, covering the
// reports in #2 (navigate leaves content calls on the old tab) and #3
// (getContent ignores an explicit tabId).
//
// Background pages have no module system, so the functions under test are
// extracted from the source and evaluated in a vm context with a fake
// `browser` object.
//
// Run from the repository root: node --test tests/

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const BACKGROUND = path.join(__dirname, "..", "extension", "background.js");
const source = fs.readFileSync(BACKGROUND, "utf8");

function extractFunction(name) {
  const asyncStart = source.indexOf(`async function ${name}(`);
  const start = asyncStart === -1 ? source.indexOf(`function ${name}(`) : asyncStart;
  assert.notEqual(start, -1, `${name} not found in extension/background.js`);
  // Top-level functions close with a "}" in column 0.
  const end = source.indexOf("\n}\n", start);
  assert.notEqual(end, -1, `could not find the end of ${name}`);
  return source.slice(start, end + 3);
}

// Two tabs in two windows: tab 1 is active in window 10, tab 2 in window 20.
// The content script answers with the tab it was messaged on, so a routed
// message is distinguishable from a stale one.
function fakeBrowser() {
  const tabs = {
    1: { id: 1, windowId: 10, active: true, url: "https://one.example/", title: "one" },
    2: { id: 2, windowId: 20, active: true, url: "https://two.example/", title: "two" }
  };
  const state = { sent: [], updates: [], queries: [] };

  const browser = {
    tabs: {
      async query(query) {
        state.queries.push(query);
        if (query && query.windowId === 20) return [tabs[2]];
        if (query && query.windowId === 10) return [tabs[1]];
        return [tabs[1]];
      },
      async get(tabId) {
        if (!tabs[tabId]) throw new Error(`no tab ${tabId}`);
        return tabs[tabId];
      },
      async update(tabId, props) {
        state.updates.push({ tabId, props });
        return { ...tabs[tabId], ...props };
      },
      async sendMessage(tabId, message, options) {
        state.sent.push({ tabId, action: message.action, frameId: options && options.frameId });
        return { tabId, url: tabs[tabId].url, content: `content-of-${tabId}` };
      }
    }
  };

  return { browser, state, tabs };
}

function load(context, names) {
  const body = names.map(extractFunction).join("\n\n");
  const exported = names.map((name) => `this.${name} = ${name};`).join("\n");
  const sandbox = vm.createContext({
    browser: context.browser,
    cachedActiveTabId: null,
    cachedWindowId: null,
    setTimeout,
    console
  });
  new vm.Script(`${body}\n${exported}`).runInContext(sandbox);
  return sandbox;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("getContent with an explicit tabId messages that tab, not the cached one", async () => {
  const { browser, state } = fakeBrowser();
  const ctx = load({ browser }, ["resolveTabId", "tabsSendMessage", "sendToContent"]);
  ctx.cachedActiveTabId = 1;
  ctx.cachedWindowId = 10;

  const result = await ctx.sendToContent("getContent", { format: "annotated", tabId: 2 });

  assert.equal(plain(result).tabId, 2);
  assert.equal(plain(result).content, "content-of-2");
  assert.deepEqual(plain(state.sent), [{ tabId: 2, action: "getContent", frameId: 0 }]);
});

test("resolveTabId prefers an explicit tabId over the cached tab", async () => {
  const { browser } = fakeBrowser();
  const ctx = load({ browser }, ["resolveTabId"]);
  ctx.cachedActiveTabId = 1;
  ctx.cachedWindowId = 10;

  assert.equal(await ctx.resolveTabId({ tabId: 2 }), 2);
  assert.equal(await ctx.resolveTabId({}), 1, "without a tabId the cached tab wins");
});

test("windowId scoping resolves that window's active tab without touching the cache", async () => {
  const { browser } = fakeBrowser();
  const ctx = load({ browser }, ["resolveTabId"]);
  ctx.cachedActiveTabId = 1;
  ctx.cachedWindowId = 10;

  assert.equal(await ctx.resolveTabId({ windowId: 20 }), 2);
  assert.equal(ctx.cachedActiveTabId, 1, "window-scoped calls leave the shared cache alone");
});

test("navigate targets one tab and later content calls follow the navigated tab", async () => {
  const { browser, state } = fakeBrowser();
  const ctx = load({ browser }, ["resolveTabId", "tabsSendMessage", "sendToContent", "navigateTo"]);
  ctx.cachedActiveTabId = 1;
  ctx.cachedWindowId = 10;

  const result = await ctx.navigateTo({ url: "https://two.example/next", tabId: 2, wait: false });

  assert.equal(result.tabId, 2);
  assert.equal(plain(result.content).tabId, 2, "returned content must come from the navigated tab");
  assert.deepEqual(plain(result.content).content, "content-of-2");
  assert.deepEqual(plain(state.updates), [
    { tabId: 2, props: { url: "https://two.example/next" } }
  ]);
  assert.equal(ctx.cachedActiveTabId, 2, "cache follows the navigated tab");
  assert.equal(ctx.cachedWindowId, 20);

  // A later getContent without a tabId must read the navigated tab, not the
  // tab that was active before navigate ran.
  const next = await ctx.sendToContent("getContent", { format: "annotated" });
  assert.equal(plain(next).tabId, 2);
  assert.deepEqual(plain(state.sent).map((call) => call.tabId), [2, 2]);
});

test("navigate honours windowId scoping without overwriting the shared cache", async () => {
  const { browser } = fakeBrowser();
  const ctx = load({ browser }, ["resolveTabId", "tabsSendMessage", "sendToContent", "navigateTo"]);
  ctx.cachedActiveTabId = 1;
  ctx.cachedWindowId = 10;

  const result = await ctx.navigateTo({ url: "https://two.example/", windowId: 20, wait: false });

  assert.equal(result.tabId, 2);
  assert.equal(plain(result.content).tabId, 2);
  assert.equal(ctx.cachedActiveTabId, 1, "window-scoped navigation leaves the cache alone");
});
