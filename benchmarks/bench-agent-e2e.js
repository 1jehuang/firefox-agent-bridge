#!/usr/bin/env node
/**
 * End-to-End Agent Benchmark
 * Spawns a real agent, gives it a browser task, measures everything
 */

const { spawn } = require('child_process');
const fs = require('fs');

// Test server URL (start with: node benchmarks/test-server.js)
const TEST_SERVER = process.env.TEST_SERVER || 'http://localhost:3456';

const TASKS = {
  // === External site tasks (original) ===
  'search-duckduckgo': {
    prompt: `Using the firefox-browser skill, search DuckDuckGo for "weather in seattle" and return the first 3 results. Use: browser <action> '<json>'`,
    expectedActions: ['navigate', 'type', 'getContent']
  },
  'find-complaint-form': {
    prompt: `Using the firefox-browser skill, go to https://brightairindustries.com/?audience=community, find the "File a complaint" page, and list the form fields. Use scout first if available. Use: browser <action> '<json>'`,
    expectedActions: ['scout', 'navigate', 'click', 'getInteractables']
  },
  'multi-site-fetch': {
    prompt: `Using the firefox-browser skill, get the page titles from these 3 sites: example.com, httpbin.org, duckduckgo.com. Use parallel if possible. Use: browser <action> '<json>'`,
    expectedActions: ['parallel']
  },

  // === Local test site tasks ===
  'login-flow': {
    prompt: `Using the firefox-browser skill, log into the test site at ${TEST_SERVER}/login.html. Use username "testuser" and password "secret123". After login, verify you see the protected content. Report what secret data is shown. Use: browser <action> '<json>'`,
    expectedActions: ['navigate', 'type', 'click', 'getContent'],
    requiresTestServer: true
  },
  'search-extract': {
    prompt: `Using the firefox-browser skill, go to ${TEST_SERVER}/search.html, search for "documentation", and extract the titles of all results found. Return the results as a list. Use: browser <action> '<json>'`,
    expectedActions: ['navigate', 'type', 'getContent'],
    requiresTestServer: true
  },
  'contact-form': {
    prompt: `Using the firefox-browser skill, go to ${TEST_SERVER}/contact.html and fill out the contact form with: Name="John Doe", Email="john@example.com", Phone="555-123-4567", Subject="Technical Support", Message="This is a test message". Check the newsletter checkbox. Submit the form and confirm success. Use: browser <action> '<json>'`,
    expectedActions: ['navigate', 'fillForm', 'click', 'getContent'],
    requiresTestServer: true
  },
  'wizard-complete': {
    prompt: `Using the firefox-browser skill, complete the 3-step wizard at ${TEST_SERVER}/wizard/step1.html. Step 1: Enter First Name="Jane", Last Name="Smith", Email="jane@example.com". Step 2: Select Plan="Pro", Notifications="Weekly", Timezone="Pacific Time". Step 3: Confirm and complete. Report the final success message. Use: browser <action> '<json>'`,
    expectedActions: ['navigate', 'type', 'click', 'getContent'],
    requiresTestServer: true
  },
  'table-scrape': {
    prompt: `Using the firefox-browser skill, go to ${TEST_SERVER}/data.html and extract all rows from the data table. Return a JSON array with each row containing: ID, Name, Email, Department, Status, Score. Use: browser <action> '<json>'`,
    expectedActions: ['navigate', 'getContent'],
    requiresTestServer: true
  },
  'protected-access': {
    prompt: `Using the firefox-browser skill, first log into ${TEST_SERVER}/login.html with any username/password, then navigate to the protected page and extract the secret API key and Account ID. Use: browser <action> '<json>'`,
    expectedActions: ['navigate', 'type', 'click', 'getContent'],
    requiresTestServer: true
  }
};

async function checkTestServer() {
  return new Promise((resolve) => {
    const http = require('http');
    const url = new URL(TEST_SERVER);
    const req = http.get({
      hostname: url.hostname,
      port: url.port,
      path: '/api/health',
      timeout: 2000
    }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function runAgentTask(taskName) {
  const task = TASKS[taskName];
  if (!task) {
    console.error(`Unknown task: ${taskName}`);
    console.log('Available:', Object.keys(TASKS).join(', '));
    process.exit(1);
  }

  // Check if test server is required and running
  if (task.requiresTestServer) {
    const serverUp = await checkTestServer();
    if (!serverUp) {
      console.error(`\n❌ Task "${taskName}" requires the test server.`);
      console.error(`   Start it with: node benchmarks/test-server.js`);
      console.error(`   Or: ./benchmarks/start-test-server.sh`);
      process.exit(1);
    }
  }

  console.log(`\n📊 E2E Benchmark: ${taskName}`);
  console.log('='.repeat(50));

  const metrics = {
    task: taskName,
    startTime: Date.now(),
    agentThinkingMs: 0,
    commandExecutionMs: 0,
    commandCount: 0,
    turns: 0,
    events: []
  };

  return new Promise((resolve) => {
    const startTime = Date.now();
    let lastCommandEnd = startTime;
    let output = '';

    // Spawn claude with the task
    const agent = spawn('claude', [
      '--print',
      '--dangerously-skip-permissions',
      '-p', task.prompt
    ], {
      env: { ...process.env, TERM: 'dumb' },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    agent.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;

      // Detect command execution (look for browser calls)
      const cmdMatches = text.match(/browser\s+(\w+)/g);
      if (cmdMatches) {
        cmdMatches.forEach(cmd => {
          const now = Date.now();
          const thinkTime = now - lastCommandEnd;
          metrics.agentThinkingMs += thinkTime;
          metrics.commandCount++;
          metrics.events.push({
            type: 'command',
            action: cmd.match(/browser\s+(\w+)/)?.[1],
            thinkTimeMs: thinkTime,
            timestamp: now - startTime
          });
          lastCommandEnd = now;
        });
      }
    });

    agent.stderr.on('data', (data) => {
      // Ignore stderr for now
    });

    agent.on('close', (code) => {
      const endTime = Date.now();
      metrics.totalMs = endTime - startTime;
      metrics.commandExecutionMs = metrics.totalMs - metrics.agentThinkingMs;

      // Count approximate turns (each command is roughly a turn)
      metrics.turns = metrics.commandCount;

      console.log(`\n--- Results ---`);
      console.log(`Total time:        ${(metrics.totalMs / 1000).toFixed(1)}s`);
      console.log(`Agent thinking:    ${(metrics.agentThinkingMs / 1000).toFixed(1)}s (${Math.round(metrics.agentThinkingMs / metrics.totalMs * 100)}%)`);
      console.log(`Command execution: ${(metrics.commandExecutionMs / 1000).toFixed(1)}s (${Math.round(metrics.commandExecutionMs / metrics.totalMs * 100)}%)`);
      console.log(`Commands:          ${metrics.commandCount}`);
      console.log(`Avg think/command: ${metrics.commandCount ? Math.round(metrics.agentThinkingMs / metrics.commandCount) : 0}ms`);

      console.log(`\nTimeline:`);
      metrics.events.forEach((e, i) => {
        console.log(`  ${i + 1}. ${e.action} (after ${e.thinkTimeMs}ms thinking)`);
      });

      // Save results
      const resultFile = `benchmarks/results/e2e-${taskName}-${Date.now()}.json`;
      fs.writeFileSync(resultFile, JSON.stringify(metrics, null, 2));
      console.log(`\n📄 Saved to ${resultFile}`);

      resolve(metrics);
    });

    // Timeout after 3 minutes
    setTimeout(() => {
      agent.kill();
      console.log('⚠️ Timeout after 3 minutes');
      resolve(metrics);
    }, 180000);
  });
}

async function main() {
  const taskName = process.argv[2] || 'list';

  if (taskName === 'list' || taskName === '--help' || taskName === '-h') {
    console.log('Agent E2E Benchmark\n');
    console.log('Usage: node bench-agent-e2e.js <task|command>\n');
    console.log('Commands:');
    console.log('  list     - Show available tasks (default)');
    console.log('  all      - Run all tasks');
    console.log('  local    - Run only local test site tasks');
    console.log('  external - Run only external site tasks\n');
    console.log('Tasks:');
    for (const [name, task] of Object.entries(TASKS)) {
      const marker = task.requiresTestServer ? '(local)' : '(external)';
      console.log(`  ${name} ${marker}`);
    }
    console.log('\nNote: Local tasks require the test server running.');
    console.log('Start with: node benchmarks/test-server.js');
    return;
  }

  if (taskName === 'all') {
    for (const name of Object.keys(TASKS)) {
      try {
        await runAgentTask(name);
      } catch (err) {
        console.error(`Task ${name} failed:`, err.message);
      }
      console.log('\n');
    }
  } else if (taskName === 'local') {
    const localTasks = Object.entries(TASKS)
      .filter(([_, t]) => t.requiresTestServer)
      .map(([name]) => name);
    console.log(`Running ${localTasks.length} local tasks...\n`);
    for (const name of localTasks) {
      try {
        await runAgentTask(name);
      } catch (err) {
        console.error(`Task ${name} failed:`, err.message);
      }
      console.log('\n');
    }
  } else if (taskName === 'external') {
    const externalTasks = Object.entries(TASKS)
      .filter(([_, t]) => !t.requiresTestServer)
      .map(([name]) => name);
    console.log(`Running ${externalTasks.length} external tasks...\n`);
    for (const name of externalTasks) {
      try {
        await runAgentTask(name);
      } catch (err) {
        console.error(`Task ${name} failed:`, err.message);
      }
      console.log('\n');
    }
  } else {
    await runAgentTask(taskName);
  }
}

main().catch(console.error);
