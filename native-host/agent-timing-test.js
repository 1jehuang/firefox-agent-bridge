#!/usr/bin/env node
const { execSync } = require('child_process');

const actions = [
  ['ping', '{}'],
  ['getActiveTab', '{}'],
  ['getContent', '{"format":"textFast"}'],
];

console.log('Measuring client.js invocation overhead...\n');

for (const [action, params] of actions) {
  const times = [];
  for (let i = 0; i < 5; i++) {
    const start = process.hrtime.bigint();
    execSync(`node /home/jeremy/.claude/skills/firefox-browser/client.js ${action} '${params}'`, {
      stdio: 'pipe',
      timeout: 10000
    });
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    times.push(elapsed);
  }
  const avg = times.reduce((a,b) => a+b, 0) / times.length;
  console.log(`${action}: avg=${avg.toFixed(1)}ms (${times.map(t => t.toFixed(0)).join(', ')})`);
}
