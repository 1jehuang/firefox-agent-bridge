#!/usr/bin/env node
/**
 * Workflow Cache - Records agent workflows and replays them with fallback
 *
 * Usage:
 *   # Execute command (records to current workflow)
 *   node workflow-cache.js exec <action> '<params_json>'
 *
 *   # Start new workflow session
 *   node workflow-cache.js start [workflow-hint]
 *
 *   # Try to replay a cached workflow, fallback on failure
 *   node workflow-cache.js replay <url-or-hint>
 *
 *   # End current workflow (saves to cache)
 *   node workflow-cache.js end
 *
 *   # List cached workflows
 *   node workflow-cache.js list
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WS_URL = 'ws://127.0.0.1:8766';
const TIMEOUT_MS = 30000;
const CACHE_DIR = path.join(__dirname, '.workflow-cache');
const SESSION_FILE = path.join(CACHE_DIR, '.current-session.json');

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Execute a single command via WebSocket
async function executeCommand(action, params) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let responded = false;

    const timeout = setTimeout(() => {
      if (!responded) {
        reject(new Error('Timeout'));
        ws.close();
      }
    }, TIMEOUT_MS);

    ws.on('open', () => {
      ws.send(JSON.stringify({ action, params }));
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'ready') return;

      responded = true;
      clearTimeout(timeout);

      if (msg.ok) {
        resolve(msg.result);
      } else {
        reject(new Error(msg.error || 'Unknown error'));
      }
      ws.close();
    });

    ws.on('error', reject);
  });
}

// Get current session
function getSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    }
  } catch (e) {}
  return null;
}

// Save current session
function saveSession(session) {
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
}

// Clear current session
function clearSession() {
  if (fs.existsSync(SESSION_FILE)) {
    fs.unlinkSync(SESSION_FILE);
  }
}

// Generate workflow ID from URL/hint
function workflowId(urlOrHint) {
  const normalized = urlOrHint.toLowerCase()
    .replace(/https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 50);
  return normalized;
}

// Get cached workflow
function getCachedWorkflow(id) {
  const file = path.join(CACHE_DIR, `${id}.json`);
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {}
  return null;
}

// Save workflow to cache
function saveWorkflow(id, workflow) {
  const file = path.join(CACHE_DIR, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify(workflow, null, 2));
}

// List all cached workflows
function listWorkflows() {
  const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json') && !f.startsWith('.'));
  return files.map(f => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), 'utf8'));
      return {
        id: f.replace('.json', ''),
        steps: data.steps.length,
        url: data.startUrl,
        lastUsed: data.lastUsed,
        successRate: data.successCount / (data.successCount + data.failCount) || 0
      };
    } catch (e) {
      return { id: f.replace('.json', ''), error: e.message };
    }
  });
}

// Extract page signature for matching
function pageSignature(result) {
  if (!result) return {};
  return {
    url: result.url || null,
    title: result.title || null,
    hasText: result.text ? result.text.slice(0, 200) : null
  };
}

// Check if current page matches expected signature
function signatureMatches(expected, actual) {
  if (!expected || !actual) return true; // No signature to check

  // URL must match (ignoring query params for flexibility)
  if (expected.url && actual.url) {
    const expBase = expected.url.split('?')[0];
    const actBase = actual.url.split('?')[0];
    if (expBase !== actBase) return false;
  }

  return true;
}

// Commands
async function cmdStart(hint) {
  const session = {
    id: hint ? workflowId(hint) : `session-${Date.now()}`,
    hint: hint || null,
    startTime: Date.now(),
    steps: [],
    startUrl: null
  };

  // Get current page info
  try {
    const tabInfo = await executeCommand('getActiveTab', {});
    session.startUrl = tabInfo.url;
  } catch (e) {}

  saveSession(session);
  console.log(JSON.stringify({ started: true, id: session.id, startUrl: session.startUrl }));
}

async function cmdExec(action, params) {
  const session = getSession();
  const startTime = Date.now();

  try {
    const result = await executeCommand(action, params);
    const elapsed = Date.now() - startTime;

    // Record step if session active
    if (session) {
      session.steps.push({
        action,
        params,
        result: pageSignature(result),
        elapsed,
        success: true
      });

      // Update start URL if this was a navigate
      if (action === 'navigate' && params.url) {
        if (!session.startUrl) session.startUrl = params.url;
      }

      saveSession(session);
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    // Record failure
    if (session) {
      session.steps.push({
        action,
        params,
        error: err.message,
        elapsed: Date.now() - startTime,
        success: false
      });
      saveSession(session);
    }

    console.error('Error:', err.message);
    process.exit(1);
  }
}

async function cmdEnd() {
  const session = getSession();
  if (!session) {
    console.log(JSON.stringify({ ended: false, error: 'No active session' }));
    return;
  }

  // Only save if we have successful steps
  const successfulSteps = session.steps.filter(s => s.success);
  if (successfulSteps.length > 0 && session.startUrl) {
    const id = workflowId(session.startUrl);
    const existing = getCachedWorkflow(id) || { successCount: 0, failCount: 0 };

    const workflow = {
      id,
      startUrl: session.startUrl,
      hint: session.hint,
      steps: successfulSteps,
      lastUsed: Date.now(),
      successCount: existing.successCount + 1,
      failCount: existing.failCount
    };

    saveWorkflow(id, workflow);
    console.log(JSON.stringify({ ended: true, saved: id, steps: successfulSteps.length }));
  } else {
    console.log(JSON.stringify({ ended: true, saved: false, reason: 'No successful steps or URL' }));
  }

  clearSession();
}

async function cmdReplay(urlOrHint) {
  const id = workflowId(urlOrHint);
  const workflow = getCachedWorkflow(id);

  if (!workflow) {
    console.log(JSON.stringify({
      replayed: false,
      reason: 'No cached workflow found',
      hint: 'Use "exec" commands to record a workflow first'
    }));
    process.exit(1);
  }

  console.error(`Replaying workflow: ${id} (${workflow.steps.length} steps)`);

  const results = [];
  let failedAt = null;

  for (let i = 0; i < workflow.steps.length; i++) {
    const step = workflow.steps[i];
    console.error(`  Step ${i + 1}/${workflow.steps.length}: ${step.action}`);

    try {
      const result = await executeCommand(step.action, step.params);
      results.push({
        index: i,
        action: step.action,
        ok: true,
        result
      });

      // Check if result matches expected signature
      const actual = pageSignature(result);
      if (!signatureMatches(step.result, actual)) {
        console.error(`  Warning: Page signature differs from recording`);
        // Continue anyway - soft mismatch
      }
    } catch (err) {
      console.error(`  Failed: ${err.message}`);
      failedAt = i;
      results.push({
        index: i,
        action: step.action,
        ok: false,
        error: err.message
      });

      // Update workflow stats
      workflow.failCount = (workflow.failCount || 0) + 1;
      workflow.lastUsed = Date.now();
      saveWorkflow(id, workflow);

      break;
    }
  }

  // Collect all content for agent context
  const allContent = results
    .filter(r => r.ok && r.result)
    .map(r => r.result);

  const output = {
    replayed: true,
    completed: failedAt === null,
    stepsExecuted: results.length,
    totalSteps: workflow.steps.length,
    failedAt,
    results,
    // Flatten content for agent
    collectedContent: allContent
  };

  if (failedAt === null) {
    workflow.successCount = (workflow.successCount || 0) + 1;
    workflow.lastUsed = Date.now();
    saveWorkflow(id, workflow);
  }

  console.log(JSON.stringify(output, null, 2));

  if (failedAt !== null) {
    process.exit(1); // Signal to agent that fallback is needed
  }
}

async function cmdList() {
  const workflows = listWorkflows();
  console.log(JSON.stringify(workflows, null, 2));
}

// Main
async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  switch (cmd) {
    case 'start':
      await cmdStart(args[0]);
      break;

    case 'exec':
      if (args.length < 1) {
        console.error('Usage: workflow-cache.js exec <action> [params_json]');
        process.exit(1);
      }
      const params = args[1] ? JSON.parse(args[1]) : {};
      await cmdExec(args[0], params);
      break;

    case 'end':
      await cmdEnd();
      break;

    case 'replay':
      if (!args[0]) {
        console.error('Usage: workflow-cache.js replay <url-or-hint>');
        process.exit(1);
      }
      await cmdReplay(args[0]);
      break;

    case 'list':
      await cmdList();
      break;

    default:
      console.log(`Workflow Cache - Records and replays browser workflows

Commands:
  start [hint]              Start recording a new workflow
  exec <action> [params]    Execute command (records if session active)
  end                       End session and save to cache
  replay <url-or-hint>      Replay cached workflow (exit 1 on failure = fallback needed)
  list                      List cached workflows

Example workflow:
  # First time - record
  node workflow-cache.js start "duckduckgo search"
  node workflow-cache.js exec navigate '{"url":"https://duckduckgo.com"}'
  node workflow-cache.js exec type '{"selector":"input[name=q]","text":"test","submit":true}'
  node workflow-cache.js exec getContent '{"format":"text"}'
  node workflow-cache.js end

  # Next time - replay (falls back to agent on failure)
  node workflow-cache.js replay "duckduckgo"
`);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
