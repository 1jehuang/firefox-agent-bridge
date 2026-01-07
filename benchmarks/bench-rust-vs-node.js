#!/usr/bin/env node
/**
 * Benchmark: Rust CLI vs Node.js CLI
 * Compares startup time and command latency
 */

const { execSync } = require('child_process');
const path = require('path');

const NODE_CLIENT = `node ${process.env.HOME}/.claude/skills/firefox-browser/client.js`;
const RUST_CLIENT = path.join(__dirname, '..', 'rust-cli', 'target', 'release', 'browser');

// Also check for installed `browser` command
function getRustClient() {
  try {
    execSync('which browser', { encoding: 'utf8' });
    return 'browser';
  } catch {
    return RUST_CLIENT;
  }
}

function runCommand(client, action, params = {}) {
  const start = Date.now();
  try {
    const cmd = `${client} ${action} '${JSON.stringify(params)}'`;
    const result = execSync(cmd, { encoding: 'utf8', timeout: 10000 });
    return { ok: true, ms: Date.now() - start, result };
  } catch (err) {
    return { ok: false, ms: Date.now() - start, error: err.message };
  }
}

async function benchmark(client, name, iterations = 10) {
  console.log(`\n📊 ${name}`);
  console.log(`   Client: ${client}`);

  const results = {
    ping: [],
    listTabs: [],
    getContent: [],
  };

  // Warm up
  runCommand(client, 'ping');

  for (let i = 0; i < iterations; i++) {
    // Ping (minimal payload)
    const ping = runCommand(client, 'ping');
    if (ping.ok) results.ping.push(ping.ms);

    // ListTabs (medium payload)
    const tabs = runCommand(client, 'listTabs', {});
    if (tabs.ok) results.listTabs.push(tabs.ms);

    // GetContent (larger payload)
    const content = runCommand(client, 'getContent', { format: 'text' });
    if (content.ok) results.getContent.push(content.ms);
  }

  const stats = {};
  for (const [action, times] of Object.entries(results)) {
    if (times.length === 0) {
      stats[action] = { avg: NaN, min: NaN, max: NaN };
      continue;
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);
    stats[action] = { avg: Math.round(avg), min, max, samples: times.length };
    console.log(`   ${action.padEnd(12)} avg: ${avg.toFixed(0)}ms  min: ${min}ms  max: ${max}ms`);
  }

  return stats;
}

async function main() {
  console.log('='.repeat(60));
  console.log('BENCHMARK: Rust CLI vs Node.js CLI');
  console.log('='.repeat(60));

  const iterations = parseInt(process.argv[2]) || 10;
  console.log(`Running ${iterations} iterations per command\n`);

  // Check if Rust binary exists
  const rustClient = getRustClient();
  try {
    execSync(`${rustClient} --version`, { encoding: 'utf8' });
  } catch {
    console.error('Rust binary not found. Build with: cd rust-cli && cargo build --release');
    process.exit(1);
  }

  // Run benchmarks
  const nodeStats = await benchmark(NODE_CLIENT, 'Node.js CLI', iterations);
  const rustStats = await benchmark(rustClient, 'Rust CLI', iterations);

  // Comparison
  console.log('\n' + '='.repeat(60));
  console.log('COMPARISON (Rust vs Node.js)');
  console.log('='.repeat(60));

  for (const action of ['ping', 'listTabs', 'getContent']) {
    const nodeAvg = nodeStats[action]?.avg || NaN;
    const rustAvg = rustStats[action]?.avg || NaN;

    if (!isNaN(nodeAvg) && !isNaN(rustAvg)) {
      const diff = nodeAvg - rustAvg;
      const pct = ((diff / nodeAvg) * 100).toFixed(1);
      const faster = diff > 0 ? 'Rust' : 'Node';
      console.log(`${action.padEnd(12)} Node: ${nodeAvg}ms  Rust: ${rustAvg}ms  -> ${faster} is ${Math.abs(diff)}ms (${Math.abs(pct)}%) faster`);
    }
  }

  // Summary
  const nodeTotal = Object.values(nodeStats).reduce((sum, s) => sum + (s.avg || 0), 0);
  const rustTotal = Object.values(rustStats).reduce((sum, s) => sum + (s.avg || 0), 0);

  console.log('\n' + '-'.repeat(60));
  console.log(`Total avg latency - Node: ${nodeTotal}ms, Rust: ${rustTotal}ms`);

  if (rustTotal < nodeTotal) {
    const speedup = ((nodeTotal - rustTotal) / nodeTotal * 100).toFixed(1);
    console.log(`Rust CLI is ${speedup}% faster overall`);
  } else {
    const slowdown = ((rustTotal - nodeTotal) / nodeTotal * 100).toFixed(1);
    console.log(`Rust CLI is ${slowdown}% slower overall`);
  }

  // JSON output
  const report = {
    timestamp: new Date().toISOString(),
    iterations,
    node: nodeStats,
    rust: rustStats,
    summary: {
      nodeTotal,
      rustTotal,
      rustSpeedup: ((nodeTotal - rustTotal) / nodeTotal * 100).toFixed(1) + '%'
    }
  };

  console.log('\n📄 JSON Report:');
  console.log(JSON.stringify(report, null, 2));
}

main().catch(console.error);
