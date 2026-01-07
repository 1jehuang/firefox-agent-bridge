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
    // Success: Agent reports search results about weather
    successCriteria: ['weather', 'seattle'],
    successDescription: 'Returns search results mentioning weather in Seattle'
  },
  'find-complaint-form': {
    prompt: `Using the firefox-browser skill, go to https://brightairindustries.com/?audience=community, find the "File a complaint" page, and list the form fields. Use scout first if available. Use: browser <action> '<json>'`,
    successCriteria: ['complaint', 'form'],
    successDescription: 'Lists form fields from the complaint page'
  },
  'multi-site-fetch': {
    prompt: `Using the firefox-browser skill, get the page titles from these 3 sites: example.com, httpbin.org, duckduckgo.com. Use parallel if possible. Use: browser <action> '<json>'`,
    successCriteria: ['example', 'httpbin', 'duckduckgo'],
    successDescription: 'Returns titles from all 3 sites'
  },

  // === Local test site tasks ===
  'login-flow': {
    prompt: `Using the firefox-browser skill, log into the test site at ${TEST_SERVER}/login.html. Use username "testuser" and password "secret123". After login, report what secret data is shown on the protected page. Use: browser <action> '<json>'`,
    // The protected page shows: API Key "sk-test-1234567890" and Account ID "ACC-98765"
    successCriteria: ['sk-test-1234567890', 'ACC-98765'],
    successDescription: 'Reports the secret API key and Account ID from protected page',
    requiresTestServer: true
  },
  'search-extract': {
    prompt: `Using the firefox-browser skill, go to ${TEST_SERVER}/search.html, search for "documentation", and extract the titles of all results found. Return the results as a list. Use: browser <action> '<json>'`,
    // Search results for "documentation" include these titles
    successCriteria: ['documentation'],
    successDescription: 'Returns list of search result titles',
    requiresTestServer: true
  },
  'contact-form': {
    prompt: `Using the firefox-browser skill, go to ${TEST_SERVER}/contact.html and fill out the contact form with: Name="John Doe", Email="john@example.com", Subject="Technical Support", Message="This is a test message". Submit the form and report the confirmation. Use: browser <action> '<json>'`,
    // Success message after form submission
    successCriteria: ['success', 'submitted'],
    successDescription: 'Form submitted successfully with confirmation',
    requiresTestServer: true
  },
  'wizard-complete': {
    prompt: `Using the firefox-browser skill, complete the 3-step wizard at ${TEST_SERVER}/wizard/step1.html. Fill in any reasonable values for each step. Report the final success message. Use: browser <action> '<json>'`,
    successCriteria: ['complete', 'success'],
    successDescription: 'Completes all wizard steps and reports success',
    requiresTestServer: true
  },
  'table-scrape': {
    prompt: `Using the firefox-browser skill, go to ${TEST_SERVER}/data.html and extract the data from the table. Return the data showing ID, Name, and Department for each row. Use: browser <action> '<json>'`,
    // Table contains employee data
    successCriteria: ['Engineering', 'Marketing', 'Sales'],
    successDescription: 'Extracts table data with department info',
    requiresTestServer: true
  },
  'protected-access': {
    prompt: `Using the firefox-browser skill, log into ${TEST_SERVER}/login.html with any username/password, then navigate to the protected page and extract the secret API key. Use: browser <action> '<json>'`,
    successCriteria: ['sk-test-1234567890'],
    successDescription: 'Extracts the secret API key from protected page',
    requiresTestServer: true
  },
  'oauth-flow': {
    prompt: `Using the firefox-browser skill, go to ${TEST_SERVER}/oauth-demo.html, click "Sign in with Google", complete the OAuth flow by selecting an account and granting permission, then report the logged-in user's email. Use: browser <action> '<json>'`,
    // Mock OAuth accounts use @gmail.com emails
    successCriteria: ['@gmail.com'],
    successDescription: 'Completes OAuth flow and reports user email',
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

      // Evaluate success based on output containing expected criteria
      const outputLower = output.toLowerCase();
      const criteriaResults = task.successCriteria.map(criterion => ({
        criterion,
        found: outputLower.includes(criterion.toLowerCase())
      }));
      const successCount = criteriaResults.filter(r => r.found).length;
      metrics.success = successCount === task.successCriteria.length;
      metrics.successRate = successCount / task.successCriteria.length;
      metrics.criteriaResults = criteriaResults;
      metrics.successDescription = task.successDescription;

      console.log(`\n--- Results ---`);
      console.log(`Success:           ${metrics.success ? '✅ PASS' : '❌ FAIL'} (${successCount}/${task.successCriteria.length} criteria met)`);
      console.log(`Goal:              ${task.successDescription}`);
      console.log(`Total time:        ${(metrics.totalMs / 1000).toFixed(1)}s`);
      console.log(`Commands:          ${metrics.commandCount}`);
      console.log(`Avg think/command: ${metrics.commandCount ? Math.round(metrics.agentThinkingMs / metrics.commandCount) : 0}ms`);

      // Show which criteria passed/failed
      console.log(`\nSuccess criteria:`);
      criteriaResults.forEach(r => {
        console.log(`  ${r.found ? '✓' : '✗'} "${r.criterion}"`);
      });

      console.log(`\nTimeline:`);
      metrics.events.forEach((e, i) => {
        console.log(`  ${i + 1}. ${e.action} (after ${e.thinkTimeMs}ms thinking)`);
      });

      // Save results with full output for analysis
      metrics.output = output;
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

function printSummary(results) {
  console.log('\n' + '='.repeat(60));
  console.log('📊 BENCHMARK SUMMARY');
  console.log('='.repeat(60));

  const passed = results.filter(r => r.success).length;
  const failed = results.length - passed;
  const totalTime = results.reduce((sum, r) => sum + (r.totalMs || 0), 0);
  const totalCommands = results.reduce((sum, r) => sum + (r.commandCount || 0), 0);

  console.log(`\nOverall: ${passed}/${results.length} passed (${Math.round(passed / results.length * 100)}%)`);
  console.log(`Total time: ${(totalTime / 1000).toFixed(1)}s`);
  console.log(`Total commands: ${totalCommands}`);

  console.log('\nResults by task:');
  results.forEach(r => {
    const status = r.success ? '✅' : '❌';
    const time = r.totalMs ? `${(r.totalMs / 1000).toFixed(1)}s` : 'N/A';
    const cmds = r.commandCount !== undefined ? r.commandCount : 'N/A';
    console.log(`  ${status} ${r.name.padEnd(20)} ${time.padStart(8)} ${String(cmds).padStart(3)} cmds`);
  });

  // Save aggregate results
  const summaryFile = `benchmarks/results/summary-${Date.now()}.json`;
  fs.writeFileSync(summaryFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    passRate: passed / results.length,
    passed,
    failed,
    totalTime,
    totalCommands,
    results: results.map(r => ({
      name: r.name,
      success: r.success,
      totalMs: r.totalMs,
      commandCount: r.commandCount,
      successRate: r.successRate
    }))
  }, null, 2));
  console.log(`\n📄 Summary saved to ${summaryFile}`);
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
    const results = [];
    for (const name of Object.keys(TASKS)) {
      try {
        results.push({ name, ...(await runAgentTask(name)) });
      } catch (err) {
        console.error(`Task ${name} failed:`, err.message);
        results.push({ name, success: false, error: err.message });
      }
      console.log('\n');
    }
    printSummary(results);
  } else if (taskName === 'local') {
    const localTasks = Object.entries(TASKS)
      .filter(([_, t]) => t.requiresTestServer)
      .map(([name]) => name);
    console.log(`Running ${localTasks.length} local tasks...\n`);
    const results = [];
    for (const name of localTasks) {
      try {
        results.push({ name, ...(await runAgentTask(name)) });
      } catch (err) {
        console.error(`Task ${name} failed:`, err.message);
        results.push({ name, success: false, error: err.message });
      }
      console.log('\n');
    }
    printSummary(results);
  } else if (taskName === 'external') {
    const externalTasks = Object.entries(TASKS)
      .filter(([_, t]) => !t.requiresTestServer)
      .map(([name]) => name);
    console.log(`Running ${externalTasks.length} external tasks...\n`);
    const results = [];
    for (const name of externalTasks) {
      try {
        results.push({ name, ...(await runAgentTask(name)) });
      } catch (err) {
        console.error(`Task ${name} failed:`, err.message);
        results.push({ name, success: false, error: err.message });
      }
      console.log('\n');
    }
    printSummary(results);
  } else {
    await runAgentTask(taskName);
  }
}

main().catch(console.error);
