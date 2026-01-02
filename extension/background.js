/* eslint-env browser */
const NATIVE_APP_NAME = "firefox_agent_bridge";

let nativePort = null;
let reconnectTimer = null;
let cachedActiveTabId = null;
let cachedWindowId = null;

function roundMs(value) {
  return Math.round(value * 100) / 100;
}

function shouldProfile(message, params) {
  return Boolean(message && (message.profile || (params && params.profile)));
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectNative();
  }, 1500);
}

function connectNative() {
  if (nativePort) return;
  try {
    nativePort = browser.runtime.connectNative(NATIVE_APP_NAME);
    nativePort.onMessage.addListener(handleNativeMessage);
    nativePort.onDisconnect.addListener(() => {
      nativePort = null;
      scheduleReconnect();
    });
    nativePort.postMessage({ type: "hello", version: "0.1.0" });
  } catch (err) {
    console.error("Failed to connect native host", err);
    nativePort = null;
    scheduleReconnect();
  }
}

async function handleNativeMessage(message) {
  if (!message) return;
  if (message.type && !message.action) return;

  const id = message.id;
  const profile = shouldProfile(message, message.params);
  const started = profile ? performance.now() : 0;
  try {
    const result = await dispatchAction(message.action, message.params || {}, profile);
    if (profile) {
      const timing = { extensionMs: roundMs(performance.now() - started) };
      if (result && result.__timing) {
        if (typeof result.__timing.contentMs === "number") {
          timing.contentMs = result.__timing.contentMs;
        }
        delete result.__timing;
      }
      sendNative({ id, ok: true, result, timing });
    } else {
      sendNative({ id, ok: true, result });
    }
  } catch (err) {
    const payload = { id, ok: false, error: err && err.message ? err.message : String(err) };
    if (profile) {
      payload.timing = { extensionMs: roundMs(performance.now() - started) };
    }
    sendNative(payload);
  }
}

function sendNative(payload) {
  if (!nativePort) throw new Error("Native host not connected");
  nativePort.postMessage(payload);
}

async function dispatchAction(action, params, profile) {
  switch (action) {
    case "ping":
      return { pong: true, time: Date.now() };
    case "navigate":
      return navigateTo(params);
    case "click":
      return sendToContent("click", params, profile);
    case "type":
      return sendToContent("type", params, profile);
    case "getContent":
      return sendToContent("getContent", params, profile);
    case "screenshot":
      return captureScreenshot(params);
    case "getActiveTab":
      return getActiveTabInfo();
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

async function resolveTabId(params) {
  if (params && Number.isInteger(params.tabId)) return params.tabId;
  if (Number.isInteger(cachedActiveTabId) && Number.isInteger(cachedWindowId)) {
    return cachedActiveTabId;
  }
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length) throw new Error("No active tab found");
  cachedActiveTabId = tabs[0].id;
  cachedWindowId = tabs[0].windowId;
  return tabs[0].id;
}

async function getActiveTabInfo() {
  const tabId = await resolveTabId({});
  const tab = await browser.tabs.get(tabId);
  return { tabId: tab.id, url: tab.url, title: tab.title, windowId: tab.windowId };
}

async function waitForTabComplete(tabId, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for page load"));
    }, timeoutMs);

    function onUpdated(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === "complete") {
        cleanup();
        resolve({ tabId });
      }
    }

    function cleanup() {
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(onUpdated);
    }

    browser.tabs.onUpdated.addListener(onUpdated);
  });
}

async function navigateTo(params) {
  if (!params || !params.url) throw new Error("Missing url parameter");
  if (params.newTab) {
    const tab = await browser.tabs.create({ url: params.url, active: true });
    if (params.wait) await waitForTabComplete(tab.id, params.timeoutMs);
    return { tabId: tab.id, url: params.url };
  }
  const tabId = await resolveTabId(params);
  await browser.tabs.update(tabId, { url: params.url });
  if (params.wait) await waitForTabComplete(tabId, params.timeoutMs);
  return { tabId, url: params.url };
}

async function sendToContent(action, params, profile) {
  const tabId = await resolveTabId(params || {});
  const message = { type: "agent-bridge", action, params: params || {} };
  if (profile) message.profile = true;
  const options = {};
  if (params && Number.isInteger(params.frameId)) options.frameId = params.frameId;
  return browser.tabs.sendMessage(tabId, message, options);
}

async function captureScreenshot(params) {
  const tabId = await resolveTabId(params || {});
  const tab = await browser.tabs.get(tabId);
  const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  return { tabId, dataUrl };
}

connectNative();

browser.tabs.onActivated.addListener(({ tabId, windowId }) => {
  cachedActiveTabId = tabId;
  cachedWindowId = windowId;
});

browser.tabs.onRemoved.addListener((tabId) => {
  if (tabId === cachedActiveTabId) {
    cachedActiveTabId = null;
    cachedWindowId = null;
  }
});

browser.windows.onFocusChanged.addListener((windowId) => {
  cachedWindowId = windowId;
  cachedActiveTabId = null;
});
