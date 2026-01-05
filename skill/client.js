#!/usr/bin/env node
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const WS_URL = 'ws://127.0.0.1:8766';
const TIMEOUT_MS = 30000;

const action = process.argv[2];
const paramsArg = process.argv[3];

if (!action) {
  console.error('Usage: client.js <action> [params_json]');
  console.error('Actions: navigate, click, type, getContent, screenshot, getActiveTab, ping');
  process.exit(1);
}

let params = {};
if (paramsArg) {
  try {
    params = JSON.parse(paramsArg);
  } catch (e) {
    console.error('Invalid JSON params:', e.message);
    process.exit(1);
  }
}

const ws = new WebSocket(WS_URL);
let responded = false;

const timeout = setTimeout(() => {
  if (!responded) {
    console.error('Timeout waiting for response');
    ws.close();
    process.exit(1);
  }
}, TIMEOUT_MS);

ws.on('open', () => {
  ws.send(JSON.stringify({ action, params }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  // Skip the ready message
  if (msg.type === 'ready') return;

  responded = true;
  clearTimeout(timeout);

  if (msg.ok) {
    // For screenshots, save to file
    if (action === 'screenshot' && msg.result && msg.result.dataUrl) {
      const base64Data = msg.result.dataUrl.replace(/^data:image\/png;base64,/, '');
      const filename = params.filename || `/tmp/firefox-screenshot-${Date.now()}.png`;
      fs.writeFileSync(filename, base64Data, 'base64');
      console.log(JSON.stringify({ saved: filename, tabId: msg.result.tabId }));
    } else {
      console.log(JSON.stringify(msg.result || msg, null, 2));
    }
  } else {
    console.error('Error:', msg.error || 'Unknown error');
    process.exit(1);
  }

  ws.close();
});

ws.on('error', (err) => {
  console.error('WebSocket error:', err.message);
  console.error('Is Firefox running with the Browser Agent Bridge extension enabled?');
  process.exit(1);
});
