#!/usr/bin/env node
/**
 * End-to-End Agent Benchmark
 * Spawns a real agent, gives it a browser task, measures everything
 */

const { spawn } = require('child_process');
const fs = require('fs');

const TASKS = {
  'search-duckduckgo': {
    prompt: `Using the firefox-browser skill, search DuckDuckGo for "weather in seattle" and return the first 3 results. Use: node ~/.claude/skills/firefox-browser/client.js <action> '<json>'`,
    expectedActions: ['navigate', 'type', 'getContent']
  },
  'find-complaint-form': {
    prompt: `Using the firefox-browser skill, go to https://brightairindustries.com/?audience=community, find the "File a complaint" page, and list the form fields. Use scout first if available. Use: node ~/.claude/skills/firefox-browser/client.js <action> '<json>'`,
    expectedActions: ['scout', 'navigate', 'click', 'getInteractables']
  },
  'multi-site-fetch': {
    prompt: `Using the firefox-browser skill, get the page titles from these 3 sites: example.com, httpbin.org, duckduckgo.com. Use parallel if possible. Use: node ~/.claude/skills/firefox-browser/client.js <action> '<json>'`,
    expectedActions: ['parallel']
  }
};

async function runAgentTask(taskName) {
  const task = TASKS[taskName];
  if (!task) {
    console.error(`Unknown task: ${taskName}`);
    console.log('Available:', Object.keys(TASKS).join(', '));
    process.exit(1);
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

      // Detect command execution (look for client.js calls)
      const cmdMatches = text.match(/node.*client\.js\s+(\w+)/g);
      if (cmdMatches) {
        cmdMatches.forEach(cmd => {
          const now = Date.now();
          const thinkTime = now - lastCommandEnd;
          metrics.agentThinkingMs += thinkTime;
          metrics.commandCount++;
          metrics.events.push({
            type: 'command',
            action: cmd.match(/client\.js\s+(\w+)/)?.[1],
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
  const taskName = process.argv[2] || 'search-duckduckgo';

  if (taskName === 'all') {
    for (const name of Object.keys(TASKS)) {
      await runAgentTask(name);
      console.log('\n');
    }
  } else {
    await runAgentTask(taskName);
  }
}

main().catch(console.error);
