#!/usr/bin/env node
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const WS_URL = 'ws://127.0.0.1:8766';
const TIMEOUT_MS = 60000;
const MACROS_FILE = path.join(__dirname, 'macros.json');

// Load macros
function loadMacros() {
  try {
    return JSON.parse(fs.readFileSync(MACROS_FILE, 'utf8')).macros;
  } catch (e) {
    console.error('Failed to load macros:', e.message);
    return [];
  }
}

// Match trigger pattern and extract variables
function matchTrigger(input, trigger) {
  // Convert trigger pattern to regex
  // "search duckduckgo for {{query}}" -> /^search duckduckgo for (.+)$/i
  const varNames = [];
  let pattern = trigger.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    varNames.push(name);
    return '(.+)';
  });
  pattern = '^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, (m) =>
    m === '(' || m === ')' || m === '+' || m === '.' ? m : '\\' + m
  ) + '$';

  const regex = new RegExp(pattern, 'i');
  const match = input.match(regex);

  if (!match) return null;

  const vars = {};
  varNames.forEach((name, i) => {
    vars[name] = match[i + 1];
  });
  return vars;
}

// Substitute variables in params
function substituteVars(obj, vars) {
  if (typeof obj === 'string') {
    return obj.replace(/\{\{(\w+)\}\}/g, (_, name) => vars[name] || '');
  }
  if (Array.isArray(obj)) {
    return obj.map(item => substituteVars(item, vars));
  }
  if (typeof obj === 'object' && obj !== null) {
    const result = {};
    for (const key of Object.keys(obj)) {
      result[key] = substituteVars(obj[key], vars);
    }
    return result;
  }
  return obj;
}

// Find macro by ID or trigger
function findMacro(input, macros) {
  // First try exact ID match
  const byId = macros.find(m => m.id === input);
  if (byId) return { macro: byId, vars: {} };

  // Then try trigger pattern matching
  for (const macro of macros) {
    const vars = matchTrigger(input, macro.trigger);
    if (vars) return { macro, vars };
  }

  return null;
}

// Execute macro via batch command
async function executeMacro(macro, vars) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let responded = false;

    const timeout = setTimeout(() => {
      if (!responded) {
        reject(new Error('Timeout waiting for response'));
        ws.close();
      }
    }, TIMEOUT_MS);

    ws.on('open', () => {
      // Substitute variables in all steps
      const commands = macro.steps.map(step => ({
        action: step.action,
        params: substituteVars(step.params, vars)
      }));

      // Send as batch
      ws.send(JSON.stringify({
        action: 'batch',
        params: { commands, stopOnError: true }
      }));
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

    ws.on('error', (err) => {
      reject(err);
    });
  });
}

// Main
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: macro.js <macro-id-or-trigger> [--var name=value ...]');
    console.log('\nAvailable macros:');
    const macros = loadMacros();
    macros.forEach(m => {
      console.log(`  ${m.id}: "${m.trigger}"`);
    });
    process.exit(0);
  }

  // Parse arguments
  const input = args[0];
  const extraVars = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--var' && args[i + 1]) {
      const [name, value] = args[i + 1].split('=');
      extraVars[name] = value;
      i++;
    }
  }

  const macros = loadMacros();
  const found = findMacro(input, macros);

  if (!found) {
    console.error('No matching macro found for:', input);
    console.error('\nAvailable macros:');
    macros.forEach(m => {
      console.log(`  ${m.id}: "${m.trigger}"`);
    });
    process.exit(1);
  }

  const { macro, vars } = found;
  const allVars = { ...vars, ...extraVars };

  console.error(`Running macro: ${macro.name}`);
  console.error(`Variables:`, allVars);

  const startTime = Date.now();

  try {
    const result = await executeMacro(macro, allVars);
    const elapsed = Date.now() - startTime;

    console.error(`\nCompleted in ${elapsed}ms`);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Macro failed:', err.message);
    process.exit(1);
  }
}

main();
