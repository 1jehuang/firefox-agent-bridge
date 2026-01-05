#!/usr/bin/env node
/**
 * Benchmark: Parallel vs Sequential
 * Compares fetching 3 sites in parallel vs sequentially
 */

const { execSync } = require('child_process');
const CLIENT = `${process.env.HOME}/.claude/skills/firefox-browser/client.js`;

const SITES = [
  'https://example.com',
  'https://httpbin.org/html',
  'https://duckduckgo.com'
];

function run(action, params) {
  const start = Date.now();
  const result = execSync(`node ${CLIENT} ${action} '${JSON.stringify(params)}'`, {
    encoding: 'utf8',
    timeout: 60000
  });
  return { result: JSON.parse(result), ms: Date.now() - start };
}

async function benchParallel() {
  const params = {
    branches: SITES.map(url => ({
      url,
      commands: [{ action: 'getContent', params: { format: 'text' } }]
    }))
  };
  return run('parallel', params);
}

async function benchSequential() {
  const start = Date.now();
  const results = [];

  for (const url of SITES) {
    run('navigate', { url });
    const content = run('getContent', { format: 'text' });
    results.push({ url, ms: content.ms });
  }

  return { ms: Date.now() - start, results };
}

async function main() {
  console.log(`\n📊 Benchmark: Parallel vs Sequential`);
  console.log(`Sites: ${SITES.length}\n`);

  // Run parallel
  console.log('1. Running PARALLEL fetch...');
  const parallel = await benchParallel();
  console.log(`   ✓ ${parallel.ms}ms`);

  // Run sequential
  console.log('2. Running SEQUENTIAL fetch...');
  const sequential = await benchSequential();
  console.log(`   ✓ ${sequential.ms}ms`);

  const speedup = (sequential.ms / parallel.ms).toFixed(2);

  console.log('\n--- Results ---');
  console.log(`Parallel:   ${parallel.ms}ms`);
  console.log(`Sequential: ${sequential.ms}ms`);
  console.log(`Speedup:    ${speedup}x`);

  const result = {
    benchmark: 'parallel-vs-sequential',
    version: require('../extension/manifest.json').version,
    timestamp: new Date().toISOString(),
    sites: SITES.length,
    parallelMs: parallel.ms,
    sequentialMs: sequential.ms,
    speedup: parseFloat(speedup)
  };

  console.log('\n📄 JSON:');
  console.log(JSON.stringify(result, null, 2));

  return result;
}

main().catch(err => {
  console.error('Benchmark failed:', err.message);
  process.exit(1);
});
