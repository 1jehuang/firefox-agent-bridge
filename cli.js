#!/usr/bin/env node
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const WS_URL = 'ws://127.0.0.1:8766';
const TIMEOUT_MS = 30000;
const VERSION = require('./package.json').version;

const action = process.argv[2];
const paramsArg = process.argv[3];

// Handle special commands
if (!action || action === '--help' || action === '-h' || action === 'help') {
  printHelp();
  process.exit(0);
}

if (action === '--version' || action === '-v') {
  console.log(VERSION);
  process.exit(0);
}

if (action === 'docs') {
  printDocs();
  process.exit(0);
}

if (action === 'setup') {
  setup(paramsArg);
  process.exit(0);
}

// Regular action - send to Firefox
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

// --- Helper functions ---

function printHelp() {
  console.log(`
firefox-agent-bridge v${VERSION}
Control Firefox browser from LLM agents

USAGE:
  browser <action> [params_json]
  browser <command>

COMMANDS:
  help, --help      Show this help
  docs              Show full documentation
  setup claude      Install Claude Code skill files
  setup generic     Print docs to stdout
  --version         Show version

ACTIONS:
  Session:     listTabs, newSession, setActiveTab, getActiveTab
  Navigation:  navigate, getContent, getInteractables, screenshot
  Interaction: click, type, fillForm, waitFor
  Control:     fork, killFork, listForks, tryUntil, parallel
  Auth:        getAuthContext, requestAuth, configureAuth
  Utility:     ping

EXAMPLES:
  browser ping
  browser newSession '{"url": "https://example.com"}'
  browser click '{"selector": "#btn"}'
  browser getContent '{"format": "annotated"}'

QUICK START:
  1. Install Firefox extension from extension/ folder
  2. browser ping                    # verify connection
  3. browser newSession '{"url": "https://google.com"}'
  4. browser click '{"text": "Sign in"}'
`);
}

function printDocs() {
  const docsPath = path.join(__dirname, 'DOCS.md');
  if (fs.existsSync(docsPath)) {
    console.log(fs.readFileSync(docsPath, 'utf-8'));
  } else {
    // Inline essential docs
    console.log(`
# Firefox Agent Bridge

Control Firefox browser via WebSocket. Uses real browser with existing logins.

## Actions

### Session & Tab Management
- listTabs          List all open tabs
- newSession        Create new tab (returns content by default)
- setActiveTab      Switch active tab
- getActiveTab      Get current tab info

### Navigation & Content
- navigate          Go to URL (returns content by default)
- getContent        Get page content (format: annotated, text, html)
- getInteractables  List clickable elements
- screenshot        Capture visible area

### Interaction
- click             Click element (selector, text, or x/y)
- type              Type into input (selector, text, submit)
- fillForm          Fill multiple fields
- waitFor           Wait for element/text

### Control Flow
- fork              Duplicate tab into multiple paths
- killFork          Close a fork
- listForks         List active forks
- tryUntil          Try alternatives until success
- parallel          Run commands on multiple URLs

### Auth
- getAuthContext    Detect login pages
- requestAuth       Request user auth approval
- configureAuth     Set auth preferences

## Content Formats

getContent supports:
- annotated (default): Text with clickable elements marked
- text: Plain text
- html: Full HTML

## Fork Example

browser fork '{"paths": [
  {"name": "path-a", "commands": [{"action": "click", "params": {"text": "Option A"}}]},
  {"name": "path-b", "commands": [{"action": "click", "params": {"text": "Option B"}}]}
]}'

browser click '{"text": "Continue", "fork": "path-a"}'
browser killFork '{"fork": "path-b"}'
`);
  }
}

function setup(target) {
  if (!target || target === 'claude') {
    setupClaude();
  } else if (target === 'generic') {
    printDocs();
  } else {
    console.error(`Unknown setup target: ${target}`);
    console.error('Available: claude, generic');
    process.exit(1);
  }
}

function setupClaude() {
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  const skillDir = path.join(homeDir, '.claude', 'skills', 'firefox-browser');

  // Create directory
  fs.mkdirSync(skillDir, { recursive: true });

  // Copy SKILL.md
  const skillMdSrc = path.join(__dirname, 'SKILL.md');
  const skillMdDst = path.join(skillDir, 'SKILL.md');

  if (fs.existsSync(skillMdSrc)) {
    fs.copyFileSync(skillMdSrc, skillMdDst);
    console.log(`✓ Copied SKILL.md to ${skillMdDst}`);
  } else {
    // Generate basic SKILL.md
    const skillContent = `---
name: firefox-browser
description: Control Firefox browser with user's logins and cookies. Use for browsing, form filling, clicking, screenshots.
allowed-tools: Bash, Read, Write
---

# Firefox Browser Agent Bridge

Run \`browser --help\` for usage.
Run \`browser docs\` for full documentation.

## Quick Start

\`\`\`bash
browser ping                                    # test connection
browser newSession '{"url": "https://example.com"}'  # open page (returns content)
browser click '{"selector": "#button"}'         # interact
\`\`\`
`;
    fs.writeFileSync(skillMdDst, skillContent);
    console.log(`✓ Created SKILL.md at ${skillMdDst}`);
  }

  console.log(`✓ Claude Code skill installed at ${skillDir}`);
  console.log('\nClaude Code will now recognize the "browser" command.');
}
