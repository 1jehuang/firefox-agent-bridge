#!/usr/bin/env node
/**
 * Long-Horizon Agent Benchmark
 * Tasks that take 10-100 seconds, simulating real agent workflows
 * Uses sandbox mode for reproducible results (no cached logins/cookies)
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const TEST_SERVER = process.env.TEST_SERVER || 'http://localhost:3456';

// Long-horizon tasks designed for 10-100 second execution
const TASKS = {
  // ~15-30 seconds: Multi-page navigation with data extraction
  'multi-page-scrape': {
    prompt: `Using the firefox-browser skill with sandbox mode for a clean browser:
1. First create a sandbox session: browser newSession '{"url": "${TEST_SERVER}/products.html", "sandbox": true}'
2. Extract all product names and prices from the products page
3. Click "Next Page" and extract from page 2
4. Click "Next Page" and extract from page 3
5. Return a summary: total products found, price range (min/max), average price
Use: browser <action> '<json>'`,
    expectedDuration: [15, 30],
    requiresTestServer: true
  },

  // ~20-40 seconds: Complete registration flow
  'full-registration': {
    prompt: `Using the firefox-browser skill with sandbox mode:
1. Create a sandbox session: browser newSession '{"url": "${TEST_SERVER}/register.html", "sandbox": true}'
2. Fill out the registration form with realistic fake data:
   - Full name, email (use unique timestamp), password
   - Select a random plan from available options
   - Check terms checkbox
3. Submit the form
4. Verify registration success
5. Find and click the "verify email" link on the confirmation page
6. Complete email verification
7. Report the final confirmation message and any account details shown
Use: browser <action> '<json>'`,
    expectedDuration: [20, 40],
    requiresTestServer: true
  },

  // ~30-60 seconds: E-commerce checkout flow
  'checkout-flow': {
    prompt: `Using the firefox-browser skill with sandbox mode:
1. Create a sandbox session: browser newSession '{"url": "${TEST_SERVER}/shop/index.html", "sandbox": true}'
2. Browse the product catalog and add 3 different items to cart
3. Navigate to the shopping cart
4. Verify all 3 items are in cart with correct prices
5. Proceed to checkout
6. Fill out shipping information (use fake but valid-looking data)
7. Select shipping method
8. Fill out payment information (use test card: 4242424242424242)
9. Review order and complete purchase
10. Report the order confirmation number
Use: browser <action> '<json>'`,
    expectedDuration: [30, 60],
    requiresTestServer: true
  },

  // ~40-80 seconds: Multi-site price comparison
  'price-comparison': {
    prompt: `Using the firefox-browser skill with sandbox mode:
1. Create sandbox session: browser newSession '{"sandbox": true}'
2. Search for "mechanical keyboard" on these 3 sites:
   - Amazon (https://amazon.com)
   - Newegg (https://newegg.com)
   - Best Buy (https://bestbuy.com)
3. From each site, extract the top 3 results with name and price
4. Create a comparison table
5. Identify the best deal (lowest price for comparable items)
6. Return structured results with your recommendation
Note: Sites may show different results, handle variations gracefully
Use: browser <action> '<json>'`,
    expectedDuration: [40, 80],
    requiresTestServer: false
  },

  // ~25-50 seconds: Form wizard with validation
  'complex-form-wizard': {
    prompt: `Using the firefox-browser skill with sandbox mode:
1. Create sandbox session: browser newSession '{"url": "${TEST_SERVER}/application/start.html", "sandbox": true}'
2. Complete a 5-step application wizard:
   Step 1: Personal info (name, DOB, SSN-format, address)
   Step 2: Employment history (add 2 past employers with dates)
   Step 3: Education (add college degree info)
   Step 4: References (add 2 references with contact info)
   Step 5: Review and submit
3. Each step has validation - ensure fields are filled correctly before proceeding
4. If validation fails, fix the error and retry
5. Report the final application ID
Use: browser <action> '<json>'`,
    expectedDuration: [25, 50],
    requiresTestServer: true
  },

  // ~30-60 seconds: Data entry with verification
  'bulk-data-entry': {
    prompt: `Using the firefox-browser skill with sandbox mode:
1. Create sandbox session: browser newSession '{"url": "${TEST_SERVER}/admin/data-entry.html", "sandbox": true}'
2. Login with test credentials (admin/admin123)
3. Navigate to "Add Records" section
4. Add 5 new employee records with the following data:
   - John Smith, Engineering, $85000
   - Jane Doe, Marketing, $72000
   - Bob Wilson, Sales, $68000
   - Alice Brown, HR, $65000
   - Charlie Davis, IT, $78000
5. After each entry, verify it appears in the records table
6. Export the final table data
7. Report total count and salary sum
Use: browser <action> '<json>'`,
    expectedDuration: [30, 60],
    requiresTestServer: true
  },

  // ~45-90 seconds: Research task across multiple pages
  'research-task': {
    prompt: `Using the firefox-browser skill with sandbox mode:
1. Create sandbox session: browser newSession '{"sandbox": true}'
2. Research "best practices for password security in 2024"
3. Visit at least 5 different authoritative sources
4. From each source, extract:
   - The URL and site name
   - Key recommendations (bullet points)
   - Any specific numbers/statistics mentioned
5. Synthesize findings into a summary report
6. List sources with the most unique/valuable insights
7. Return a structured report with citations
Use: browser <action> '<json>'`,
    expectedDuration: [45, 90],
    requiresTestServer: false
  },

  // ~20-40 seconds: Interactive debugging scenario
  'debug-workflow': {
    prompt: `Using the firefox-browser skill with sandbox mode:
1. Create sandbox session: browser newSession '{"url": "${TEST_SERVER}/debug/broken-page.html", "sandbox": true}'
2. The page has intentional issues. Find and report:
   - Any JavaScript console errors (check page state)
   - Broken links (click and verify)
   - Missing images (check for placeholders)
   - Form validation issues (try submitting with bad data)
3. Navigate to the "error log" page
4. Extract all logged errors
5. Produce a bug report listing all issues found with severity
Use: browser <action> '<json>'`,
    expectedDuration: [20, 40],
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

async function runTask(taskName) {
  const task = TASKS[taskName];
  if (!task) {
    console.error(`Unknown task: ${taskName}`);
    console.log('Available:', Object.keys(TASKS).join(', '));
    process.exit(1);
  }

  if (task.requiresTestServer) {
    const serverUp = await checkTestServer();
    if (!serverUp) {
      console.error(`\nTask "${taskName}" requires the test server.`);
      console.error(`Start with: node benchmarks/test-server.js`);
      process.exit(1);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`LONG-HORIZON BENCHMARK: ${taskName}`);
  console.log(`Expected duration: ${task.expectedDuration[0]}-${task.expectedDuration[1]}s`);
  console.log(`${'='.repeat(60)}\n`);

  const metrics = {
    task: taskName,
    startTime: Date.now(),
    expectedDuration: task.expectedDuration,
    events: [],
    commandCount: 0,
    sandbox: true
  };

  return new Promise((resolve) => {
    const startTime = Date.now();
    let output = '';
    let lastEventTime = startTime;

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

      // Track browser commands
      const cmdMatches = text.match(/browser\s+(\w+)/g);
      if (cmdMatches) {
        cmdMatches.forEach(cmd => {
          const now = Date.now();
          const action = cmd.replace('browser ', '');
          metrics.events.push({
            type: 'command',
            action,
            timestamp: now - startTime,
            sinceLast: now - lastEventTime
          });
          metrics.commandCount++;
          lastEventTime = now;

          // Live progress indicator
          const elapsed = ((now - startTime) / 1000).toFixed(1);
          process.stdout.write(`  [${elapsed}s] ${action}\n`);
        });
      }
    });

    agent.stderr.on('data', (data) => {
      // Could log errors here
    });

    agent.on('close', (code) => {
      const endTime = Date.now();
      metrics.totalMs = endTime - startTime;
      metrics.totalSeconds = metrics.totalMs / 1000;
      metrics.exitCode = code;

      // Check if within expected range
      const [minExpected, maxExpected] = task.expectedDuration;
      metrics.withinExpected = metrics.totalSeconds >= minExpected && metrics.totalSeconds <= maxExpected;
      if (metrics.totalSeconds < minExpected) {
        metrics.deviation = 'faster';
      } else if (metrics.totalSeconds > maxExpected) {
        metrics.deviation = 'slower';
      }

      // Calculate timing breakdown
      const thinkTime = metrics.events.reduce((sum, e) => sum + e.sinceLast, 0);
      metrics.thinkTimeMs = thinkTime;
      metrics.execTimeMs = metrics.totalMs - thinkTime;

      console.log(`\n${'─'.repeat(40)}`);
      console.log(`RESULTS`);
      console.log(`${'─'.repeat(40)}`);
      console.log(`Total time:       ${metrics.totalSeconds.toFixed(1)}s`);
      console.log(`Expected:         ${minExpected}-${maxExpected}s`);
      console.log(`Status:           ${metrics.withinExpected ? '✓ Within range' : `⚠ ${metrics.deviation} than expected`}`);
      console.log(`Commands:         ${metrics.commandCount}`);
      console.log(`Think time:       ${(metrics.thinkTimeMs / 1000).toFixed(1)}s (${Math.round(metrics.thinkTimeMs / metrics.totalMs * 100)}%)`);
      console.log(`Exec time:        ${(metrics.execTimeMs / 1000).toFixed(1)}s (${Math.round(metrics.execTimeMs / metrics.totalMs * 100)}%)`);
      console.log(`Avg/command:      ${metrics.commandCount ? Math.round(metrics.totalMs / metrics.commandCount) : 0}ms`);

      // Save results
      const resultDir = path.join(__dirname, 'results');
      if (!fs.existsSync(resultDir)) fs.mkdirSync(resultDir, { recursive: true });

      const resultFile = path.join(resultDir, `long-${taskName}-${Date.now()}.json`);
      fs.writeFileSync(resultFile, JSON.stringify(metrics, null, 2));
      console.log(`\nSaved: ${resultFile}`);

      resolve(metrics);
    });

    // Extended timeout for long-horizon tasks (5 minutes)
    setTimeout(() => {
      agent.kill();
      console.log('⚠ Timeout after 5 minutes');
      metrics.timedOut = true;
      resolve(metrics);
    }, 300000);
  });
}

async function runAll() {
  const results = [];

  for (const [name, task] of Object.entries(TASKS)) {
    if (task.requiresTestServer) {
      const serverUp = await checkTestServer();
      if (!serverUp) {
        console.log(`Skipping ${name} (requires test server)`);
        continue;
      }
    }

    try {
      const result = await runTask(name);
      results.push(result);
    } catch (err) {
      console.error(`Task ${name} failed:`, err.message);
    }

    // Brief pause between tasks
    await new Promise(r => setTimeout(r, 2000));
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log(`SUMMARY: ${results.length} tasks completed`);
  console.log(`${'='.repeat(60)}`);

  let totalTime = 0;
  let totalCommands = 0;
  let withinRange = 0;

  for (const r of results) {
    const status = r.withinExpected ? '✓' : `⚠ ${r.deviation}`;
    console.log(`  ${status} ${r.task}: ${r.totalSeconds.toFixed(1)}s (expected ${r.expectedDuration[0]}-${r.expectedDuration[1]}s)`);
    totalTime += r.totalMs;
    totalCommands += r.commandCount;
    if (r.withinExpected) withinRange++;
  }

  console.log(`\nTotal: ${(totalTime / 1000).toFixed(1)}s, ${totalCommands} commands`);
  console.log(`Within expected range: ${withinRange}/${results.length}`);
}

async function main() {
  const arg = process.argv[2] || 'list';

  if (arg === 'list' || arg === '--help' || arg === '-h') {
    console.log('Long-Horizon Agent Benchmark\n');
    console.log('Usage: node bench-long-horizon.js <task|command>\n');
    console.log('Commands:');
    console.log('  list  - Show available tasks (default)');
    console.log('  all   - Run all tasks sequentially');
    console.log('  local - Run only local test site tasks\n');
    console.log('Tasks:');
    for (const [name, task] of Object.entries(TASKS)) {
      const marker = task.requiresTestServer ? '(local)' : '(external)';
      console.log(`  ${name.padEnd(25)} ${marker.padEnd(12)} ${task.expectedDuration[0]}-${task.expectedDuration[1]}s`);
    }
    console.log('\nNote: All tasks use sandbox mode (private window, no cached data)');
    console.log('Local tasks require: node benchmarks/test-server.js');
    return;
  }

  if (arg === 'all') {
    await runAll();
  } else if (arg === 'local') {
    const localTasks = Object.entries(TASKS)
      .filter(([_, t]) => t.requiresTestServer)
      .map(([name]) => name);

    const serverUp = await checkTestServer();
    if (!serverUp) {
      console.error('Test server not running. Start with: node benchmarks/test-server.js');
      process.exit(1);
    }

    for (const name of localTasks) {
      await runTask(name);
      await new Promise(r => setTimeout(r, 2000));
    }
  } else {
    await runTask(arg);
  }
}

main().catch(console.error);
