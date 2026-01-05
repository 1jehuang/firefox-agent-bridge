#!/usr/bin/env node
/**
 * Benchmark: Simple Search
 * Measures time to search DuckDuckGo and get results
 */

const { execSync } = require('child_process');
const CLIENT = `${process.env.HOME}/.claude/skills/firefox-browser/client.js`;

function run(action, params) {
  const start = Date.now();
  const result = execSync(`node ${CLIENT} ${action} '${JSON.stringify(params)}'`, {
    encoding: 'utf8',
    timeout: 30000
  });
  return { result: JSON.parse(result), ms: Date.now() - start };
}

async function main() {
  const query = process.argv[2] || 'firefox extension development';
  console.log(`\n📊 Benchmark: Simple Search`);
  console.log(`Query: "${query}"\n`);

  const times = [];
  const start = Date.now();

  // Step 1: Navigate
  console.log('1. Navigating to DuckDuckGo...');
  const nav = run('navigate', { url: 'https://duckduckgo.com', returnInteractables: true });
  times.push({ step: 'navigate', ms: nav.ms });
  console.log(`   ✓ ${nav.ms}ms`);

  // Step 2: Type and submit
  console.log('2. Typing query and submitting...');
  const type = run('type', { selector: 'input[name="q"]', text: query, submit: true });
  times.push({ step: 'type+submit', ms: type.ms });
  console.log(`   ✓ ${type.ms}ms`);

  // Small delay for page navigation
  await new Promise(r => setTimeout(r, 1500));

  // Step 3: Wait for results
  console.log('3. Waiting for results...');
  const wait = run('waitFor', { contains: 'results', timeout: 10000 });
  times.push({ step: 'waitFor', ms: wait.ms });
  console.log(`   ✓ ${wait.ms}ms`);

  // Step 4: Get content
  console.log('4. Getting content...');
  const content = run('getContent', { format: 'text' });
  times.push({ step: 'getContent', ms: content.ms });
  console.log(`   ✓ ${content.ms}ms`);

  const total = Date.now() - start;

  console.log('\n--- Results ---');
  console.log(`Total time: ${total}ms`);
  console.log(`Commands: ${times.length}`);
  console.log(`Avg per command: ${Math.round(total / times.length)}ms`);
  console.log('\nBreakdown:');
  times.forEach(t => console.log(`  ${t.step}: ${t.ms}ms`));

  // Output JSON for logging
  const result = {
    benchmark: 'simple-search',
    version: require('../extension/manifest.json').version,
    timestamp: new Date().toISOString(),
    query,
    totalMs: total,
    commands: times.length,
    breakdown: times
  };

  console.log('\n📄 JSON:');
  console.log(JSON.stringify(result, null, 2));

  return result;
}

main().catch(err => {
  console.error('Benchmark failed:', err.message);
  process.exit(1);
});
