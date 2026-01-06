#!/usr/bin/env node
/**
 * Playwright MCP vs Firefox Agent Bridge Comparison Benchmark
 *
 * Runs the same tasks with both tools (in separate runs) and compares results.
 * Requires: Firefox Agent Bridge running, Playwright MCP available (optional)
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const TEST_SERVER = process.env.TEST_SERVER || 'http://localhost:3456';
const RESULTS_DIR = path.join(__dirname, 'results');

// Comparison tasks that work with both tools
const COMPARISON_TASKS = {
  'navigate-and-extract': {
    description: 'Navigate to page and extract title',
    firefox: {
      prompt: `Using the firefox-browser skill, navigate to ${TEST_SERVER} and return the page title. Use: node ~/.claude/skills/firefox-browser/client.js <action> '<json>'`
    },
    playwright: {
      prompt: `Using Playwright MCP tools, navigate to ${TEST_SERVER} and return the page title. Use browser_navigate and browser_snapshot.`
    }
  },
  'form-fill': {
    description: 'Fill and submit a form',
    firefox: {
      prompt: `Using the firefox-browser skill, go to ${TEST_SERVER}/login.html, fill username "test" and password "test", click the login button. Use: node ~/.claude/skills/firefox-browser/client.js <action> '<json>'`
    },
    playwright: {
      prompt: `Using Playwright MCP tools, go to ${TEST_SERVER}/login.html, fill username "test" and password "test", click the login button.`
    }
  },
  'search-flow': {
    description: 'Search and get results',
    firefox: {
      prompt: `Using the firefox-browser skill, go to ${TEST_SERVER}/search.html, search for "api", get the result titles. Use: node ~/.claude/skills/firefox-browser/client.js <action> '<json>'`
    },
    playwright: {
      prompt: `Using Playwright MCP tools, go to ${TEST_SERVER}/search.html, search for "api", get the result titles.`
    }
  },
  'table-extract': {
    description: 'Extract table data',
    firefox: {
      prompt: `Using the firefox-browser skill, go to ${TEST_SERVER}/data.html and extract all names from the table. Use: node ~/.claude/skills/firefox-browser/client.js <action> '<json>'`
    },
    playwright: {
      prompt: `Using Playwright MCP tools, go to ${TEST_SERVER}/data.html and extract all names from the table.`
    }
  }
};

async function runAgentTask(prompt, label) {
  return new Promise((resolve) => {
    const metrics = {
      label,
      startTime: Date.now(),
      commandCount: 0,
      success: false,
      error: null
    };

    const agent = spawn('claude', [
      '--print',
      '--dangerously-skip-permissions',
      '-p', prompt
    ], {
      env: { ...process.env, TERM: 'dumb' },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let output = '';

    agent.stdout.on('data', (data) => {
      output += data.toString();
      // Count tool calls
      const toolCalls = output.match(/\[Tool:/g);
      if (toolCalls) metrics.commandCount = toolCalls.length;
    });

    agent.stderr.on('data', (data) => {
      // Capture errors
    });

    agent.on('close', (code) => {
      metrics.totalMs = Date.now() - metrics.startTime;
      metrics.success = code === 0;
      metrics.output = output.slice(-500); // Last 500 chars
      resolve(metrics);
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      agent.kill();
      metrics.error = 'Timeout';
      metrics.totalMs = Date.now() - metrics.startTime;
      resolve(metrics);
    }, 120000);
  });
}

async function checkPlaywrightAvailable() {
  // Check if Playwright MCP tools are available
  return new Promise((resolve) => {
    const agent = spawn('claude', [
      '--print',
      '--dangerously-skip-permissions',
      '-p', 'List your available MCP tools. Just list the tool names, nothing else.'
    ], {
      env: { ...process.env, TERM: 'dumb' },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let output = '';
    agent.stdout.on('data', (data) => output += data.toString());

    agent.on('close', () => {
      const hasPlaywright = output.toLowerCase().includes('browser_navigate') ||
                           output.toLowerCase().includes('playwright');
      resolve(hasPlaywright);
    });

    setTimeout(() => {
      agent.kill();
      resolve(false);
    }, 30000);
  });
}

async function runComparison(taskName) {
  const task = COMPARISON_TASKS[taskName];
  if (!task) {
    console.error(`Unknown task: ${taskName}`);
    return null;
  }

  console.log(`\n📊 Comparison: ${taskName}`);
  console.log(`   ${task.description}`);
  console.log('='.repeat(50));

  const results = {
    task: taskName,
    description: task.description,
    timestamp: new Date().toISOString(),
    firefox: null,
    playwright: null
  };

  // Run Firefox Agent Bridge
  console.log('\n🦊 Running with Firefox Agent Bridge...');
  results.firefox = await runAgentTask(task.firefox.prompt, 'firefox');
  console.log(`   Time: ${(results.firefox.totalMs / 1000).toFixed(1)}s`);
  console.log(`   Commands: ${results.firefox.commandCount}`);
  console.log(`   Success: ${results.firefox.success}`);

  // Run Playwright MCP (if available)
  console.log('\n🎭 Running with Playwright MCP...');
  const playwrightAvailable = await checkPlaywrightAvailable();

  if (playwrightAvailable) {
    results.playwright = await runAgentTask(task.playwright.prompt, 'playwright');
    console.log(`   Time: ${(results.playwright.totalMs / 1000).toFixed(1)}s`);
    console.log(`   Commands: ${results.playwright.commandCount}`);
    console.log(`   Success: ${results.playwright.success}`);
  } else {
    console.log('   ⚠️ Playwright MCP not available');
    results.playwright = { available: false };
  }

  // Comparison summary
  if (results.firefox && results.playwright && results.playwright.totalMs) {
    const speedup = results.playwright.totalMs / results.firefox.totalMs;
    console.log('\n📈 Comparison:');
    console.log(`   Firefox: ${(results.firefox.totalMs / 1000).toFixed(1)}s`);
    console.log(`   Playwright: ${(results.playwright.totalMs / 1000).toFixed(1)}s`);
    console.log(`   Speedup: ${speedup.toFixed(2)}x ${speedup > 1 ? '(Firefox faster)' : '(Playwright faster)'}`);
    results.speedup = speedup;
  }

  return results;
}

async function main() {
  const taskName = process.argv[2];

  if (!taskName || taskName === 'list' || taskName === '--help') {
    console.log('Playwright vs Firefox Agent Bridge Comparison\n');
    console.log('Usage: node bench-playwright-comparison.js <task|all>\n');
    console.log('Tasks:');
    for (const [name, task] of Object.entries(COMPARISON_TASKS)) {
      console.log(`  ${name} - ${task.description}`);
    }
    console.log('\nNote: Requires test server running (node benchmarks/test-server.js)');
    return;
  }

  const allResults = [];

  if (taskName === 'all') {
    for (const name of Object.keys(COMPARISON_TASKS)) {
      const result = await runComparison(name);
      if (result) allResults.push(result);
      console.log('\n');
    }
  } else {
    const result = await runComparison(taskName);
    if (result) allResults.push(result);
  }

  // Save results
  if (allResults.length > 0) {
    const filename = `comparison-${Date.now()}.json`;
    const filepath = path.join(RESULTS_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify({
      date: new Date().toISOString(),
      results: allResults,
      summary: {
        tasksRun: allResults.length,
        firefoxAvgMs: allResults.reduce((sum, r) => sum + (r.firefox?.totalMs || 0), 0) / allResults.length,
        playwrightAvgMs: allResults.filter(r => r.playwright?.totalMs).reduce((sum, r) => sum + r.playwright.totalMs, 0) / allResults.filter(r => r.playwright?.totalMs).length || null
      }
    }, null, 2));
    console.log(`\n📄 Results saved to: ${filepath}`);
  }
}

main().catch(console.error);
