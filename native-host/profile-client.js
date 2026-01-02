#!/usr/bin/env node
const { WebSocket } = require("ws");

function roundMs(value) {
  return Math.round(value * 100) / 100;
}

function nowNs() {
  return process.hrtime.bigint();
}

function nsToMs(ns) {
  return Number(ns) / 1e6;
}

const args = process.argv.slice(2);
const action = args[0] || "ping";
const paramsJson = args[1];
const count = Number(args[2] || 10);

let params = {};
if (paramsJson) {
  try {
    params = JSON.parse(paramsJson);
  } catch (err) {
    console.error("Failed to parse params JSON. Example: '{" + "\"url\"" + ":\"https://example.com\"}'");
    process.exit(1);
  }
}

const host = process.env.FAB_WS_HOST || "127.0.0.1";
const port = Number(process.env.FAB_WS_PORT || 8765);
const ws = new WebSocket(`ws://${host}:${port}`);

let sent = 0;
let received = 0;
const pending = new Map();
const stats = {
  clientMs: [],
  hostMs: [],
  extensionMs: [],
  contentMs: []
};

function recordStat(array, value) {
  if (typeof value === "number" && Number.isFinite(value)) array.push(value);
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

function summarize(values) {
  if (!values.length) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    avg: roundMs(sum / values.length),
    p50: roundMs(percentile(values, 0.5)),
    p95: roundMs(percentile(values, 0.95)),
    max: roundMs(Math.max(...values))
  };
}

function sendOne() {
  sent += 1;
  const id = `prof_${Date.now()}_${sent}`;
  pending.set(id, nowNs());
  ws.send(
    JSON.stringify({
      id,
      action,
      params,
      profile: true
    })
  );
}

function finish() {
  const report = {
    count: received,
    clientMs: summarize(stats.clientMs),
    hostMs: summarize(stats.hostMs),
    extensionMs: summarize(stats.extensionMs),
    contentMs: summarize(stats.contentMs)
  };
  console.log(JSON.stringify(report, null, 2));
  ws.close();
}

ws.on("open", () => {
  sendOne();
});

ws.on("message", (data) => {
  let message;
  try {
    message = JSON.parse(data.toString());
  } catch (err) {
    console.error("Bad JSON from server", err);
    return;
  }

  if (!message.id || !pending.has(message.id)) return;

  const start = pending.get(message.id);
  pending.delete(message.id);
  received += 1;

  const clientMs = nsToMs(nowNs() - start);
  recordStat(stats.clientMs, clientMs);

  if (message.timing) {
    recordStat(stats.hostMs, message.timing.hostMs);
    recordStat(stats.extensionMs, message.timing.extensionMs);
    recordStat(stats.contentMs, message.timing.contentMs);
  }

  if (sent < count) {
    sendOne();
  } else if (received >= count) {
    finish();
  }
});

ws.on("error", (err) => {
  console.error("WebSocket error", err);
  process.exit(1);
});
