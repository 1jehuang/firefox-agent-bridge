#!/usr/bin/env node
const { WebSocketServer } = require("ws");

const WS_HOST = process.env.FAB_WS_HOST || "127.0.0.1";
const WS_PORT = Number(process.env.FAB_WS_PORT || 8765);
const REQUEST_TIMEOUT_MS = Number(process.env.FAB_REQUEST_TIMEOUT_MS || 30000);

let nativeBuffer = Buffer.alloc(0);
let requestCounter = 0;
const pending = new Map();
const sockets = new Set();

function roundMs(value) {
  return Math.round(value * 100) / 100;
}

function nowNs() {
  return process.hrtime.bigint();
}

function nsToMs(ns) {
  return Number(ns) / 1e6;
}

function log(...args) {
  console.error("[firefox-agent-bridge]", ...args);
}

function nextId() {
  requestCounter += 1;
  return `req_${Date.now()}_${requestCounter}`;
}

function sendNative(message) {
  const payload = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  process.stdout.write(Buffer.concat([header, payload]));
}

function handleNativeMessage(message) {
  if (message && message.id && pending.has(message.id)) {
    const { ws, timer, started, profile } = pending.get(message.id);
    clearTimeout(timer);
    pending.delete(message.id);
    if (profile) {
      const hostMs = roundMs(nsToMs(nowNs() - started));
      const timing = message.timing && typeof message.timing === "object" ? message.timing : {};
      timing.hostMs = hostMs;
      message.timing = timing;
    }
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));
    }
    return;
  }

  broadcast({ type: "event", payload: message });
}

function broadcast(message) {
  const data = JSON.stringify(message);
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

function queueRequest(id, ws, started, profile) {
  const timer = setTimeout(() => {
    if (!pending.has(id)) return;
    const entry = pending.get(id);
    pending.delete(id);
    if (ws.readyState === ws.OPEN) {
      const payload = { id, ok: false, error: "Request timed out" };
      if (entry && entry.profile && entry.started) {
        payload.timing = { hostMs: roundMs(nsToMs(nowNs() - entry.started)) };
      }
      ws.send(JSON.stringify(payload));
    }
  }, REQUEST_TIMEOUT_MS);

  pending.set(id, { ws, timer, started, profile });
}

function handleSocketMessage(ws, raw) {
  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch (err) {
    ws.send(JSON.stringify({ ok: false, error: "Invalid JSON" }));
    return;
  }

  if (!message.action) {
    ws.send(JSON.stringify({ ok: false, error: "Missing action" }));
    return;
  }

  if (!message.id) message.id = nextId();
  const profile = Boolean(message.profile || (message.params && message.params.profile));
  const started = nowNs();
  queueRequest(message.id, ws, started, profile);
  sendNative(message);
}

function startWebSocket() {
  const wss = new WebSocketServer({ host: WS_HOST, port: WS_PORT });
  wss.on("connection", (ws) => {
    sockets.add(ws);
    ws.on("message", (data) => handleSocketMessage(ws, data));
    ws.on("close", () => {
      sockets.delete(ws);
      for (const [id, entry] of pending.entries()) {
        if (entry.ws === ws) {
          clearTimeout(entry.timer);
          pending.delete(id);
        }
      }
    });
    ws.send(JSON.stringify({ type: "ready", host: WS_HOST, port: WS_PORT }));
  });

  wss.on("listening", () => {
    log(`WebSocket server listening on ws://${WS_HOST}:${WS_PORT}`);
  });

  wss.on("error", (err) => {
    log("WebSocket error", err);
  });
}

function processNativeBuffer() {
  while (nativeBuffer.length >= 4) {
    const messageLength = nativeBuffer.readUInt32LE(0);
    if (nativeBuffer.length < messageLength + 4) return;

    const payload = nativeBuffer.slice(4, 4 + messageLength);
    nativeBuffer = nativeBuffer.slice(4 + messageLength);

    let message;
    try {
      message = JSON.parse(payload.toString("utf8"));
    } catch (err) {
      log("Failed to parse native message", err);
      continue;
    }

    handleNativeMessage(message);
  }
}

process.stdin.on("data", (chunk) => {
  nativeBuffer = Buffer.concat([nativeBuffer, chunk]);
  processNativeBuffer();
});

process.stdin.on("end", () => {
  log("Native messaging stream ended");
  process.exit(0);
});

process.stdin.on("error", (err) => {
  log("Native messaging stream error", err);
});

startWebSocket();
