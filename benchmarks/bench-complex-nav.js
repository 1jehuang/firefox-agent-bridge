#!/usr/bin/env node
/**
 * Benchmark: Complex Navigation
 * Multi-page workflow on brightairindustries.com
 */

const { execSync } = require('child_process');
const CLIENT = `${process.env.HOME}/.claude/skills/firefox-browser/client.js`;

function run(action, params) {
  const start = Date.now();
  try {
    const result = execSync(`node ${CLIENT} ${action} '${JSON.stringify(params)}'`, {
      encoding: 'utf8',
      timeout: 30000
    });
    return { ok: true, result: JSON.parse(result), ms: Date.now() - start };
  } catch (err) {
    return { ok: false, error: err.message, ms: Date.now() - start };
  }
}

async function main() {
  console.log(`\n📊 Benchmark: Complex Navigation`);
  console.log(`Site: brightairindustries.com\n`);

  const steps = [];
  const start = Date.now();

  // Step 1: Navigate with interactables
  console.log('1. Navigate to site with returnInteractables...');
  const nav = run('navigate', {
    url: 'https://brightairindustries.com/?audience=community',
    returnInteractables: true
  });
  steps.push({ step: 'navigate+interactables', ...nav });
  console.log(`   ${nav.ok ? '✓' : '✗'} ${nav.ms}ms`);

  // Step 2: Get interactables (if returnInteractables didn't work)
  console.log('2. Get interactables...');
  const inter = run('getInteractables', {});
  steps.push({ step: 'getInteractables', ...inter });
  const elementCount = inter.ok ? inter.result.elements?.length : 0;
  console.log(`   ${inter.ok ? '✓' : '✗'} ${inter.ms}ms (${elementCount} elements)`);

  // Step 3: Click on permits
  console.log('3. Click "Open comment period permits"...');
  const click1 = run('click', { text: 'Open comment period permits' });
  steps.push({ step: 'click-permits', ...click1 });
  console.log(`   ${click1.ok ? '✓' : '✗'} ${click1.ms}ms`);

  // Step 4: Wait and get interactables
  console.log('4. Wait for page and get interactables...');
  const batch1 = run('batch', {
    commands: [
      { action: 'waitFor', params: { contains: 'permit', timeout: 5000 } },
      { action: 'getInteractables', params: {} }
    ]
  });
  steps.push({ step: 'wait+interactables', ...batch1 });
  console.log(`   ${batch1.ok ? '✓' : '✗'} ${batch1.ms}ms`);

  // Step 5: Click first permit
  console.log('5. Click first permit...');
  const click2 = run('branch', {
    alternatives: [
      { action: 'click', params: { text: 'Ash Grove' } },
      { action: 'click', params: { text: 'Permit No' } },
      { action: 'click', params: { selector: '.permit-card' } }
    ],
    timeout: 5000
  });
  steps.push({ step: 'click-first-permit', ...click2 });
  console.log(`   ${click2.ok ? '✓' : '✗'} ${click2.ms}ms`);

  // Step 6: Get permit details
  console.log('6. Get permit details...');
  const content = run('batch', {
    commands: [
      { action: 'waitFor', params: { contains: 'comment', timeout: 5000 } },
      { action: 'getContent', params: { format: 'text' } }
    ]
  });
  steps.push({ step: 'get-details', ...content });
  console.log(`   ${content.ok ? '✓' : '✗'} ${content.ms}ms`);

  // Step 7: Navigate to complaint form
  console.log('7. Click "File a complaint"...');
  const click3 = run('click', { text: 'File a complaint' });
  steps.push({ step: 'click-complaint', ...click3 });
  console.log(`   ${click3.ok ? '✓' : '✗'} ${click3.ms}ms`);

  // Step 8: Get form fields
  console.log('8. Get complaint form interactables...');
  const form = run('batch', {
    commands: [
      { action: 'waitFor', params: { selector: 'form', timeout: 5000 } },
      { action: 'getInteractables', params: {} }
    ]
  });
  steps.push({ step: 'get-form', ...form });
  console.log(`   ${form.ok ? '✓' : '✗'} ${form.ms}ms`);

  const total = Date.now() - start;
  const successful = steps.filter(s => s.ok).length;

  console.log('\n--- Results ---');
  console.log(`Total time: ${total}ms`);
  console.log(`Steps: ${successful}/${steps.length} successful`);
  console.log(`Avg per step: ${Math.round(total / steps.length)}ms`);
  console.log('\nBreakdown:');
  steps.forEach(s => console.log(`  ${s.step}: ${s.ms}ms ${s.ok ? '✓' : '✗'}`));

  const result = {
    benchmark: 'complex-navigation',
    version: require('../extension/manifest.json').version,
    timestamp: new Date().toISOString(),
    site: 'brightairindustries.com',
    totalMs: total,
    stepsTotal: steps.length,
    stepsSuccessful: successful,
    breakdown: steps.map(s => ({ step: s.step, ms: s.ms, ok: s.ok }))
  };

  console.log('\n📄 JSON:');
  console.log(JSON.stringify(result, null, 2));

  return result;
}

main().catch(err => {
  console.error('Benchmark failed:', err.message);
  process.exit(1);
});
