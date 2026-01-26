/* eslint-env browser */
const NATIVE_APP_NAME = "firefox_agent_bridge";

let nativePort = null;
let reconnectTimer = null;
let cachedActiveTabId = null;
let cachedWindowId = null;

// Fork tracking
const activeForks = new Map(); // forkName -> {tabId, createdAt, parentTabId}

// AI control tracking
let isConnected = false;
let activeRequests = 0;
let recentActions = [];
const MAX_RECENT_ACTIONS = 20;
let badgeResetTimer = null;

// Auth config defaults
const DEFAULT_AUTH_CONFIG = {
  authNotifications: true,
  authMode: "always-allow", // "ask" | "always-allow" | "always-deny"
  siteRules: {},   // domain -> "allow" | "deny"
  notifyOnAuthPage: true
};

let authConfig = { ...DEFAULT_AUTH_CONFIG };
let pendingAuthRequests = new Map(); // notificationId -> { tabId, domain, resolve, reject }

// Load auth config on startup
async function loadAuthConfig() {
  try {
    const stored = await browser.storage.local.get("authConfig");
    if (stored.authConfig) {
      authConfig = { ...DEFAULT_AUTH_CONFIG, ...stored.authConfig };
    }
  } catch (err) {
    console.error("Failed to load auth config:", err);
  }
}

async function saveAuthConfig() {
  try {
    await browser.storage.local.set({ authConfig });
  } catch (err) {
    console.error("Failed to save auth config:", err);
  }
}

function getDomainFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function maskEmail(email) {
  if (!email || !email.includes("@")) return email;
  const [local, domain] = email.split("@");
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

async function showAuthNotification(tabId, authInfo) {
  if (!authConfig.authNotifications) return { allowed: authConfig.authMode === "always-allow" };

  const domain = getDomainFromUrl(authInfo.url);

  // Check site rules first
  if (domain && authConfig.siteRules[domain]) {
    return { allowed: authConfig.siteRules[domain] === "allow", cached: true };
  }

  // Check global mode
  if (authConfig.authMode === "always-allow") return { allowed: true };
  if (authConfig.authMode === "always-deny") return { allowed: false };

  // Ask mode - show notification
  const maskedAccounts = (authInfo.availableAccounts || []).map(maskEmail);
  const accountText = maskedAccounts.length > 0
    ? `Account: ${maskedAccounts[0]}`
    : "No saved account detected";

  const notificationId = `auth-${Date.now()}`;

  return new Promise((resolve) => {
    browser.notifications.create(notificationId, {
      type: "basic",
      iconUrl: browser.runtime.getURL("icons/icon-48.png"),
      title: `🔐 Auth: ${authInfo.detectedProvider || domain || "Login"}`,
      message: `${accountText}\nPage: ${authInfo.pageTitle || domain}\nReason: ${authInfo.reason || "Agent requested access"}`
    });

    pendingAuthRequests.set(notificationId, {
      tabId,
      domain,
      authInfo,
      resolve,
      timeout: setTimeout(() => {
        pendingAuthRequests.delete(notificationId);
        browser.notifications.clear(notificationId);
        resolve({ allowed: false, reason: "timeout" });
      }, 30000) // 30 second timeout
    });
  });
}

// Handle notification clicks (allow)
browser.notifications.onClicked.addListener((notificationId) => {
  const pending = pendingAuthRequests.get(notificationId);
  if (pending) {
    clearTimeout(pending.timeout);
    pendingAuthRequests.delete(notificationId);
    browser.notifications.clear(notificationId);
    pending.resolve({ allowed: true, userApproved: true });
  }
});

// Handle notification closed (deny)
browser.notifications.onClosed.addListener((notificationId, byUser) => {
  const pending = pendingAuthRequests.get(notificationId);
  if (pending) {
    clearTimeout(pending.timeout);
    pendingAuthRequests.delete(notificationId);
    if (byUser) {
      pending.resolve({ allowed: false, userDenied: true });
    }
  }
});

loadAuthConfig();

function updateBadge() {
  if (activeRequests > 0) {
    browser.browserAction.setBadgeText({ text: "AI" });
    browser.browserAction.setBadgeBackgroundColor({ color: "#4ade80" });
    browser.browserAction.setTitle({ title: "Browser Agent Bridge - AI Active" });
  } else if (!isConnected) {
    browser.browserAction.setBadgeText({ text: "!" });
    browser.browserAction.setBadgeBackgroundColor({ color: "#ef4444" });
    browser.browserAction.setTitle({ title: "Browser Agent Bridge - Disconnected" });
  } else {
    browser.browserAction.setBadgeText({ text: "" });
    browser.browserAction.setTitle({ title: "Browser Agent Bridge - Idle" });
  }
  broadcastStatus();
}

function logAction(action) {
  recentActions.unshift({ action, time: Date.now() });
  if (recentActions.length > MAX_RECENT_ACTIONS) {
    recentActions.pop();
  }
}

function getStatus() {
  return {
    connected: isConnected,
    active: activeRequests > 0,
    recentActions: recentActions.slice(0, 10)
  };
}

function broadcastStatus() {
  browser.runtime.sendMessage({ type: "statusUpdate", state: getStatus() }).catch(() => {});
}

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
      isConnected = false;
      updateBadge();
      scheduleReconnect();
    });
    nativePort.postMessage({ type: "hello", version: "0.2.0" });
    isConnected = true;
    updateBadge();
  } catch (err) {
    console.error("Failed to connect native host", err);
    nativePort = null;
    isConnected = false;
    updateBadge();
    scheduleReconnect();
  }
}

async function handleNativeMessage(message) {
  if (!message) return;
  if (message.type && !message.action) return;

  const id = message.id;
  const action = message.action;
  const profile = shouldProfile(message, message.params);
  const started = profile ? performance.now() : 0;

  // Track AI activity
  activeRequests++;
  logAction(action);
  updateBadge();

  // Reset badge after brief delay when request completes
  function finishRequest() {
    activeRequests = Math.max(0, activeRequests - 1);
    if (badgeResetTimer) clearTimeout(badgeResetTimer);
    badgeResetTimer = setTimeout(() => {
      updateBadge();
    }, 500);
  }

  try {
    const result = await dispatchAction(action, message.params || {}, profile);
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
  } finally {
    finishRequest();
  }
}

function sendNative(payload) {
  if (!nativePort) throw new Error("Native host not connected");
  nativePort.postMessage(payload);
}

async function dispatchAction(action, params, profile) {
  // Handle fork targeting - if params.fork is set, resolve to that fork's tabId
  if (params && params.fork && activeForks.has(params.fork)) {
    params = { ...params, tabId: activeForks.get(params.fork).tabId };
  }

  switch (action) {
    case "ping":
      return { pong: true, time: Date.now() };

    case "reload":
      // Reload the extension - response sent before reload happens
      setTimeout(() => browser.runtime.reload(), 100);
      return { reloading: true, message: "Extension will reload in 100ms" };

    // Session/Tab Management
    case "listTabs":
      return listAllTabs();
    case "newSession":
      return newSession(params);
    case "setActiveTab":
      return setActiveTab(params);
    case "getActiveTab":
      return getActiveTabInfo();

    // Navigation
    case "navigate":
      return navigateTo(params);

    // Interaction
    case "click":
      return sendToContent("click", params, profile);
    case "type":
      return sendToContent("type", params, profile);
    case "fillForm":
      return sendToContent("fillForm", params, profile);
    case "waitFor":
      return sendToContent("waitFor", params, profile);

    // Page Content
    case "getContent":
      return sendToContent("getContent", params, profile);
    case "getInteractables":
      return sendToContent("getInteractables", params, profile);
    case "preexplore":
      return sendToContent("preexplore", params, profile);
    case "screenshot":
      return captureScreenshot(params);

    // Control Flow
    case "tryUntil":
      return sendToContent("tryUntil", params, profile);
    case "fork":
      return executeFork(params, profile);
    case "killFork":
      return killFork(params);
    case "listForks":
      return listForks();
    case "parallel":
      return executeParallel(params, profile);
    case "scout":
      return executeScout(params, profile);

    // Auth
    case "getAuthContext":
      return getAuthContext(params, profile);
    case "configureAuth":
      return configureAuth(params);
    case "requestAuth":
      return requestAuth(params);

    // JavaScript evaluation
    case "evaluate":
      return sendToContent("evaluate", params, profile);

    // Scrolling
    case "scroll":
      return sendToContent("scroll", params, profile);

    // Legacy (keeping for backwards compat)
    case "batch":
      return executeBatch(params, profile);
    case "branch":
      return sendToContent("tryUntil", params, profile); // Alias to tryUntil

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

async function executeBatch(params, profile) {
  if (!params.commands || !Array.isArray(params.commands)) {
    throw new Error("batch requires commands array");
  }

  const results = [];
  const timings = [];
  const stopOnError = params.stopOnError !== false;

  for (let i = 0; i < params.commands.length; i++) {
    const cmd = params.commands[i];
    const cmdStart = profile ? performance.now() : 0;

    try {
      const result = await dispatchAction(cmd.action, cmd.params || {}, false);
      results.push({ index: i, action: cmd.action, ok: true, result });
      if (profile) {
        timings.push({ index: i, action: cmd.action, ms: roundMs(performance.now() - cmdStart) });
      }
    } catch (err) {
      const errorResult = { index: i, action: cmd.action, ok: false, error: err.message };
      results.push(errorResult);
      if (profile) {
        timings.push({ index: i, action: cmd.action, ms: roundMs(performance.now() - cmdStart), error: true });
      }
      if (stopOnError) {
        break;
      }
    }
  }

  const response = { batch: true, results, completed: results.length, total: params.commands.length };
  if (profile) {
    response.timings = timings;
  }
  return response;
}

async function executeScout(params, profile) {
  const startTime = profile ? performance.now() : 0;
  const goal = params.goal || '';
  const maxDepth = Math.min(params.depth || 1, 2);  // Max 2 levels deep
  const maxPages = Math.min(params.maxPages || 5, 10);  // Max 10 pages
  const startUrl = params.url;

  if (!startUrl) throw new Error("scout requires url parameter");

  const visited = new Set();
  const results = [];
  const createdTabs = [];

  try {
    // Create a background tab for scouting
    const tab = await browser.tabs.create({ url: startUrl, active: false });
    createdTabs.push(tab.id);
    await waitForTabComplete(tab.id, 15000);
    await new Promise(r => setTimeout(r, 200));

    // Get initial page info
    const startPage = await browser.tabs.sendMessage(tab.id,
      { type: "agent-bridge", action: "preexplore", params: { goal, maxLinks: 10 } },
      { frameId: 0 }
    );
    visited.add(startUrl);
    results.push({ depth: 0, ...startPage });

    // Explore linked pages if depth > 0
    if (maxDepth > 0 && startPage.links) {
      const linksToVisit = startPage.links
        .filter(l => l.href && !visited.has(l.href) && l.href.startsWith('http'))
        .slice(0, maxPages - 1);

      for (const link of linksToVisit) {
        if (results.length >= maxPages) break;
        if (visited.has(link.href)) continue;

        try {
          visited.add(link.href);
          await browser.tabs.update(tab.id, { url: link.href });
          await waitForTabComplete(tab.id, 10000);
          await new Promise(r => setTimeout(r, 150));

          const pageInfo = await browser.tabs.sendMessage(tab.id,
            { type: "agent-bridge", action: "preexplore", params: { goal, maxLinks: 5 } },
            { frameId: 0 }
          );
          results.push({ depth: 1, fromLink: link.text, ...pageInfo });
        } catch (err) {
          results.push({ depth: 1, url: link.href, error: err.message });
        }
      }
    }

    // Cleanup
    await browser.tabs.remove(tab.id);

    // Build summary for agent
    const summary = {
      goal,
      pagesExplored: results.length,
      startUrl,
      sitemap: results.map(r => ({
        depth: r.depth,
        url: r.url,
        title: r.title,
        headings: r.headings,
        buttons: r.buttons,
        formCount: r.forms?.length || 0,
        linkCount: r.links?.length || 0,
        relevantLinks: r.links?.filter(l => l.score > 0).slice(0, 3) || []
      })),
      allForms: results.flatMap(r => (r.forms || []).map(f => ({
        page: r.title,
        url: r.url,
        ...f
      }))),
      suggestedActions: []
    };

    // Generate suggested actions based on goal
    if (goal) {
      const goalLower = goal.toLowerCase();
      for (const page of results) {
        // Check buttons
        for (const btn of (page.buttons || [])) {
          if (btn.toLowerCase().includes(goalLower)) {
            summary.suggestedActions.push({
              type: 'click',
              text: btn,
              page: page.title,
              url: page.url
            });
          }
        }
        // Check links
        for (const link of (page.links || [])) {
          if (link.score > 5) {
            summary.suggestedActions.push({
              type: 'navigate',
              text: link.text,
              href: link.href,
              score: link.score
            });
          }
        }
      }
    }

    if (profile) {
      summary.timing = { totalMs: roundMs(performance.now() - startTime) };
    }

    return summary;

  } catch (err) {
    // Cleanup on error
    for (const tabId of createdTabs) {
      try { await browser.tabs.remove(tabId); } catch (e) {}
    }
    throw err;
  }
}

async function getAuthContext(params, profile) {
  const tabId = await resolveTabId(params);
  const tab = await browser.tabs.get(tabId);

  // Get auth detection from content script
  const authInfo = await sendToContent("detectAuth", params, false);

  return {
    ...authInfo,
    url: tab.url,
    pageTitle: tab.title,
    config: {
      authMode: authConfig.authMode,
      siteRule: authConfig.siteRules[getDomainFromUrl(tab.url)] || null
    }
  };
}

async function configureAuth(params) {
  if (params.authMode && ["ask", "always-allow", "always-deny"].includes(params.authMode)) {
    authConfig.authMode = params.authMode;
  }
  if (typeof params.authNotifications === "boolean") {
    authConfig.authNotifications = params.authNotifications;
  }
  if (params.setSiteRule && params.domain) {
    if (params.setSiteRule === "remove") {
      delete authConfig.siteRules[params.domain];
    } else if (["allow", "deny"].includes(params.setSiteRule)) {
      authConfig.siteRules[params.domain] = params.setSiteRule;
    }
  }
  await saveAuthConfig();
  return { ok: true, config: authConfig };
}

async function requestAuth(params) {
  const tabId = await resolveTabId(params);
  const tab = await browser.tabs.get(tabId);

  // Get current auth context
  const authInfo = await sendToContent("detectAuth", params, false);

  // Add reason from agent
  authInfo.reason = params.reason || "Agent requested authentication";
  authInfo.url = tab.url;
  authInfo.pageTitle = tab.title;

  // Show notification and wait for response
  const result = await showAuthNotification(tabId, authInfo);

  return {
    ...result,
    authContext: authInfo
  };
}

async function executeParallel(params, profile) {
  if (!params.branches || !Array.isArray(params.branches)) {
    throw new Error("parallel requires branches array");
  }

  const startTime = profile ? performance.now() : 0;
  const createdTabs = [];

  try {
    // Create a new tab for each branch
    const branchPromises = params.branches.map(async (branch, branchIndex) => {
      const branchStart = profile ? performance.now() : 0;

      // Create new tab for this branch
      const tab = await browser.tabs.create({ url: branch.url || "about:blank", active: false });
      createdTabs.push(tab.id);

      // Wait for page load if URL provided
      if (branch.url) {
        await waitForTabComplete(tab.id, branch.timeoutMs || 15000);
        // Small delay for content script
        await new Promise(r => setTimeout(r, 100));
      }

      // Execute commands in this tab
      const results = [];
      const commands = branch.commands || [];

      for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i];
        try {
          // Force commands to use this specific tab
          const cmdParams = { ...cmd.params, tabId: tab.id };
          const result = await dispatchAction(cmd.action, cmdParams, false);
          results.push({ index: i, action: cmd.action, ok: true, result });
        } catch (err) {
          results.push({ index: i, action: cmd.action, ok: false, error: err.message });
          if (branch.stopOnError !== false) break;
        }
      }

      // Close tab if requested
      if (branch.closeTab !== false && !branch.keepTab) {
        try {
          await browser.tabs.remove(tab.id);
          createdTabs.splice(createdTabs.indexOf(tab.id), 1);
        } catch (e) { /* tab may already be closed */ }
      }

      return {
        branchIndex,
        tabId: tab.id,
        url: branch.url,
        results,
        completed: results.length,
        total: commands.length,
        timing: profile ? { ms: roundMs(performance.now() - branchStart) } : undefined
      };
    });

    // Wait for all branches to complete
    const branchResults = await Promise.all(branchPromises);

    return {
      parallel: true,
      branches: branchResults,
      totalBranches: params.branches.length,
      timing: profile ? { totalMs: roundMs(performance.now() - startTime) } : undefined
    };

  } catch (err) {
    // Clean up any created tabs on error
    for (const tabId of createdTabs) {
      try { await browser.tabs.remove(tabId); } catch (e) { }
    }
    throw err;
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

// List all open tabs across all windows
async function listAllTabs() {
  const tabs = await browser.tabs.query({});
  const windows = await browser.windows.getAll();

  const tabsByWindow = {};
  for (const win of windows) {
    tabsByWindow[win.id] = {
      windowId: win.id,
      focused: win.focused,
      tabs: []
    };
  }

  for (const tab of tabs) {
    if (tabsByWindow[tab.windowId]) {
      tabsByWindow[tab.windowId].tabs.push({
        tabId: tab.id,
        url: tab.url,
        title: tab.title,
        active: tab.active,
        index: tab.index
      });
    }
  }

  return {
    activeTabId: cachedActiveTabId,
    windows: Object.values(tabsByWindow),
    totalTabs: tabs.length
  };
}

// Create a new session (new tab)
async function newSession(params) {
  const url = params?.url || "about:blank";
  const sandbox = params?.sandbox === true;
  let tab;

  if (sandbox) {
    // Create a private (incognito) window for sandbox mode
    // This gives us a clean slate: no cookies, no logins, no cache
    const privateWindow = await browser.windows.create({
      url,
      incognito: true,
      focused: params?.focus === true
    });
    tab = privateWindow.tabs[0];
  } else {
    tab = await browser.tabs.create({ url, active: params?.focus === true });
  }

  if (url !== "about:blank" && params?.wait !== false) {
    await waitForTabComplete(tab.id, params?.timeoutMs || 15000);
  }

  cachedActiveTabId = tab.id;
  cachedWindowId = tab.windowId;

  const result = {
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url,
    title: tab.title,
    sandbox
  };

  // Return content by default (or if explicitly requested)
  if (url !== "about:blank" && params?.returnContent !== false) {
    try {
      await new Promise(r => setTimeout(r, 100)); // Wait for content script
      const format = params?.contentFormat || "annotated";
      const content = await sendToContent("getContent", { format }, false);
      result.content = content;
    } catch (err) {
      result.contentError = err.message;
    }
  }

  return result;
}

// Set which tab the agent is working on
async function setActiveTab(params) {
  if (!params?.tabId) throw new Error("setActiveTab requires tabId");

  const tab = await browser.tabs.get(params.tabId);
  cachedActiveTabId = tab.id;
  cachedWindowId = tab.windowId;

  // Optionally focus the tab in the browser (default: no focus stealing)
  if (params.focus === true) {
    await browser.tabs.update(tab.id, { active: true });
    await browser.windows.update(tab.windowId, { focused: true });
  }

  return {
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url,
    title: tab.title
  };
}

// Fork: duplicate current tab into multiple paths
async function executeFork(params, profile) {
  if (!params?.paths || !Array.isArray(params.paths)) {
    throw new Error("fork requires paths array");
  }

  const startTime = profile ? performance.now() : 0;
  const sourceTabId = await resolveTabId(params);
  const sourceTab = await browser.tabs.get(sourceTabId);

  const forks = [];

  for (const path of params.paths) {
    const name = path.name || `fork-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // Duplicate the tab
    const newTab = await browser.tabs.duplicate(sourceTabId);

    // Store fork info
    activeForks.set(name, {
      tabId: newTab.id,
      parentTabId: sourceTabId,
      parentUrl: sourceTab.url,
      createdAt: Date.now(),
      name
    });

    // Run initial commands if provided
    const results = [];
    if (path.commands && Array.isArray(path.commands)) {
      for (const cmd of path.commands) {
        try {
          const cmdParams = { ...cmd.params, tabId: newTab.id };
          const result = await dispatchAction(cmd.action, cmdParams, false);
          results.push({ action: cmd.action, ok: true, result });
        } catch (err) {
          results.push({ action: cmd.action, ok: false, error: err.message });
          if (path.stopOnError !== false) break;
        }
      }
    }

    // Get current state of fork
    const forkTab = await browser.tabs.get(newTab.id);

    forks.push({
      name,
      tabId: newTab.id,
      url: forkTab.url,
      title: forkTab.title,
      commandResults: results
    });
  }

  return {
    forked: true,
    sourceTabId,
    sourceUrl: sourceTab.url,
    forks,
    timing: profile ? { ms: roundMs(performance.now() - startTime) } : undefined
  };
}

// Kill a fork (close the tab)
async function killFork(params) {
  const name = params?.fork || params?.name;
  if (!name) throw new Error("killFork requires fork name");

  const fork = activeForks.get(name);
  if (!fork) throw new Error(`Fork not found: ${name}`);

  try {
    await browser.tabs.remove(fork.tabId);
  } catch (err) {
    // Tab may already be closed
  }

  activeForks.delete(name);

  return { killed: true, fork: name };
}

// List all active forks
async function listForks() {
  const forks = [];

  for (const [name, fork] of activeForks) {
    try {
      const tab = await browser.tabs.get(fork.tabId);
      forks.push({
        name,
        tabId: fork.tabId,
        url: tab.url,
        title: tab.title,
        parentTabId: fork.parentTabId,
        createdAt: fork.createdAt,
        alive: true
      });
    } catch (err) {
      // Tab was closed externally
      forks.push({
        name,
        tabId: fork.tabId,
        alive: false,
        error: "Tab no longer exists"
      });
      activeForks.delete(name);
    }
  }

  return { forks, count: forks.length };
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
  let tabId;

  if (params.newTab) {
    const tab = await browser.tabs.create({ url: params.url, active: true });
    tabId = tab.id;
    if (params.wait !== false) await waitForTabComplete(tabId, params.timeoutMs);
  } else {
    tabId = await resolveTabId(params);
    await browser.tabs.update(tabId, { url: params.url });
    if (params.wait !== false) await waitForTabComplete(tabId, params.timeoutMs);
  }

  const result = { tabId, url: params.url };

  // Small delay to ensure content script is ready
  await new Promise(r => setTimeout(r, 100));

  // Return content by default (annotated format)
  if (params.returnContent !== false) {
    try {
      const format = params.contentFormat || "annotated";
      const content = await sendToContent("getContent", { format }, false);
      result.content = content;
    } catch (err) {
      result.contentError = err.message;
    }
  }

  // Legacy: also return interactables if explicitly requested
  if (params.returnInteractables) {
    try {
      const interactables = await sendToContent("getInteractables", {}, false);
      result.interactables = interactables;
    } catch (err) {
      result.interactablesError = err.message;
    }
  }

  return result;
}

async function sendToContent(action, params, profile) {
  const tabId = await resolveTabId(params || {});
  const message = { type: "agent-bridge", action, params: params || {} };
  if (profile) message.profile = true;
  // Default to main frame (frameId: 0) to avoid responding from iframes like Stripe trackers
  const frameId = (params && Number.isInteger(params.frameId)) ? params.frameId : 0;
  return browser.tabs.sendMessage(tabId, message, { frameId });
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

// Handle messages from popup
browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "getStatus") {
    sendResponse(getStatus());
  }
  return false;
});
