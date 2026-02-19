#!/usr/bin/env node
/**
 * ProseMirror Editor Benchmark
 *
 * Tests the firefox-agent-bridge's ability to interact with ProseMirror editors.
 *
 * Usage:
 *   node benchmarks/bench-prosemirror.js          # run all tests
 *   node benchmarks/bench-prosemirror.js basic     # run single test
 *   node benchmarks/bench-prosemirror.js --list    # list tests
 *
 * Requires:
 *   - Test server: node benchmarks/test-server.js
 *   - Firefox with agent bridge extension loaded
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');

const TEST_SERVER = process.env.TEST_SERVER || 'http://localhost:3456';
const EDITOR_URL = `${TEST_SERVER}/prosemirror-editor.html`;
const BROWSER = process.env.BROWSER_CLI || 'browser';

function browserCmd(action, params = {}) {
  const paramsStr = JSON.stringify(params);
  try {
    const result = spawnSync(BROWSER, [action, paramsStr], {
      timeout: 30000,
      encoding: 'utf-8'
    });
    if (result.error) return { ok: false, error: result.error.message };
    const stdout = (result.stdout || '').trim();
    if (!stdout) return { ok: false, error: result.stderr || 'no output' };
    return JSON.parse(stdout);
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function pageEval(script) {
  return browserCmd('evaluate', { script, pageWorld: true });
}

function sleep(ms) {
  spawnSync('sleep', [String(ms / 1000)]);
}

function navigateAndWait() {
  browserCmd('navigate', { url: EDITOR_URL, wait: true });
  sleep(1500);
  // Verify PM loaded
  for (let i = 0; i < 10; i++) {
    const check = pageEval('return window.__prosemirrorViews ? Object.keys(window.__prosemirrorViews).length : 0');
    if (check?.result >= 4) return true;
    sleep(500);
  }
  return false;
}

// ============================================================
// Tests
// ============================================================

const TESTS = {
  'type-basic': {
    name: 'type action → basic PM editor',
    description: 'Standard `type` command on a ProseMirror contenteditable element',
    run() {
      if (!navigateAndWait()) return { pass: false, error: 'PM not loaded' };

      const typeResult = browserCmd('type', {
        selector: '#editor-basic .ProseMirror',
        text: 'Hello from the agent!'
      });

      sleep(200);

      const check = pageEval(
        'var v=window.__prosemirrorViews.basic;' +
        'return {pmText:v.state.doc.textContent,domText:v.dom.textContent}'
      );

      const pmText = check?.result?.pmText || '';
      const isPM = typeResult?.prosemirror === true;
      return {
        typeResult: { typed: typeResult?.typed, prosemirror: typeResult?.prosemirror },
        pmText,
        usedProseMirrorPath: isPM,
        pass: pmText.includes('Hello from the agent')
      };
    }
  },

  'type-replace': {
    name: 'type action → replace existing PM content',
    description: 'Clear pre-populated ProseMirror editor and type new text',
    run() {
      if (!navigateAndWait()) return { pass: false, error: 'PM not loaded' };

      const before = pageEval('return window.__prosemirrorViews.replace.state.doc.textContent');

      const typeResult = browserCmd('type', {
        selector: '#editor-replace .ProseMirror',
        text: 'Brand new content!',
        clear: true
      });

      sleep(200);

      const after = pageEval('return window.__prosemirrorViews.replace.state.doc.textContent');

      const pmText = after?.result || '';
      return {
        before: before?.result,
        pmText,
        oldGone: !pmText.includes('existing content'),
        newPresent: pmText.includes('Brand new content'),
        pass: pmText.includes('Brand new content') && !pmText.includes('existing content')
      };
    }
  },

  'type-append': {
    name: 'type action → append to PM editor',
    description: 'Append text to existing ProseMirror content without clearing',
    run() {
      if (!navigateAndWait()) return { pass: false, error: 'PM not loaded' };

      // First type something
      browserCmd('type', { selector: '#editor-basic .ProseMirror', text: 'First. ' });
      sleep(200);

      // Append more
      browserCmd('type', { selector: '#editor-basic .ProseMirror', text: 'Second.', append: true, clear: false });
      sleep(200);

      const check = pageEval('return window.__prosemirrorViews.basic.state.doc.textContent');
      const pmText = check?.result || '';
      return {
        pmText,
        pass: pmText.includes('First') && pmText.includes('Second')
      };
    }
  },

  'fillform-pm': {
    name: 'fillForm action → PM contenteditable field',
    description: 'Use fillForm with a ProseMirror editor as one of the fields',
    run() {
      if (!navigateAndWait()) return { pass: false, error: 'PM not loaded' };

      const result = browserCmd('fillForm', {
        fields: [
          { selector: '#editor-body .ProseMirror', value: 'Body content from fillForm' },
          { selector: '#editor-summary .ProseMirror', value: 'Summary from fillForm' }
        ]
      });

      sleep(200);

      const bodyCheck = pageEval('return window.__prosemirrorViews.body.state.doc.textContent');
      const summaryCheck = pageEval('return window.__prosemirrorViews.summary.state.doc.textContent');

      const bodyText = bodyCheck?.result || '';
      const summaryText = summaryCheck?.result || '';
      return {
        fillResult: result,
        bodyText,
        summaryText,
        pass: bodyText.includes('Body content') && summaryText.includes('Summary from fillForm')
      };
    }
  },

  'form-mixed': {
    name: 'Form: input + PM editors + submit',
    description: 'Fill regular input and ProseMirror editors then submit form',
    run() {
      if (!navigateAndWait()) return { pass: false, error: 'PM not loaded' };

      browserCmd('type', { selector: '#field-title', text: 'My Article Title' });

      browserCmd('type', {
        selector: '#editor-body .ProseMirror',
        text: 'This is the body of my article.'
      });

      browserCmd('type', {
        selector: '#editor-summary .ProseMirror',
        text: 'A brief summary.'
      });

      sleep(200);

      browserCmd('click', { selector: '#submit-btn' });
      sleep(300);

      const formData = pageEval('return window.__formSubmitted || null');
      const data = formData?.result;

      return {
        formData: data,
        pass: data &&
              data.title === 'My Article Title' &&
              (data.body || '').includes('body of my article') &&
              (data.summary || '').includes('brief summary')
      };
    }
  },

  'rich-format-via-eval': {
    name: 'Rich: insert formatted content via pageWorld eval',
    description: 'Use evaluate with pageWorld to insert heading + bold text',
    run() {
      if (!navigateAndWait()) return { pass: false, error: 'PM not loaded' };

      const result = pageEval(
        'var view=window.__prosemirrorViews.rich;' +
        'var schema=window.__prosemirrorSchema;' +
        'if(!view||!schema)return {error:"not loaded"};' +
        'var h=schema.node("heading",{level:1},[schema.text("My Heading")]);' +
        'var bold=schema.text("Bold text",[schema.marks.strong.create()]);' +
        'var normal=schema.text(" and normal text.");' +
        'var p=schema.node("paragraph",null,[bold,normal]);' +
        'var tr=view.state.tr;' +
        'tr.replaceWith(0,tr.doc.content.size,[h,p]);' +
        'view.dispatch(tr);' +
        'return {text:view.state.doc.textContent,hasH1:!!view.dom.querySelector("h1"),hasBold:!!view.dom.querySelector("strong")}'
      );

      const r = result?.result || {};
      return {
        result: r,
        pass: r.hasH1 && r.hasBold && (r.text || '').includes('My Heading')
      };
    }
  },

  'detect-pm-editors': {
    name: 'Detection: identify ProseMirror editors on page',
    description: 'Check that the bridge can detect ProseMirror editors',
    run() {
      if (!navigateAndWait()) return { pass: false, error: 'PM not loaded' };

      const detect = pageEval(
        'var pms=document.querySelectorAll(".ProseMirror[contenteditable=true]");' +
        'return {count:pms.length,views:Object.keys(window.__prosemirrorViews||{})}'
      );

      const content = browserCmd('getContent', { format: 'text' });
      const contentText = JSON.stringify(content);
      const mentionsPM = contentText.includes('ProseMirror') || contentText.includes('existing content');

      return {
        detected: detect?.result,
        contentSeesEditors: mentionsPM,
        pass: (detect?.result?.count || 0) >= 4
      };
    }
  },

  'state-sync': {
    name: 'State sync: PM state matches DOM after type',
    description: 'Verify ProseMirror internal doc state matches what the DOM shows',
    run() {
      if (!navigateAndWait()) return { pass: false, error: 'PM not loaded' };

      browserCmd('type', {
        selector: '#editor-basic .ProseMirror',
        text: 'State sync test content.'
      });

      sleep(200);

      const check = pageEval(
        'var v=window.__prosemirrorViews.basic;' +
        'return {pmText:v.state.doc.textContent,domText:v.dom.textContent,' +
        'match:v.state.doc.textContent===v.dom.textContent}'
      );

      const r = check?.result || {};
      return {
        pmText: r.pmText,
        domText: r.domText,
        stateMatchesDom: r.match,
        pass: r.match && (r.pmText || '').includes('State sync test')
      };
    }
  }
};

// ============================================================
// Runner
// ============================================================

function checkPrereqs() {
  try {
    execSync(`curl -sf ${TEST_SERVER}/api/health`, { timeout: 3000, encoding: 'utf-8' });
  } catch {
    console.error(`❌ Test server not running at ${TEST_SERVER}`);
    console.error('   Start with: node benchmarks/test-server.js');
    process.exit(1);
  }

  try {
    const ping = JSON.parse(spawnSync(BROWSER, ['ping'], { timeout: 5000, encoding: 'utf-8' }).stdout);
    if (!ping.pong) throw new Error('No pong');
  } catch {
    console.error('❌ Browser bridge not responding');
    process.exit(1);
  }
}

function runTest(name) {
  const test = TESTS[name];
  const start = Date.now();
  let result;
  try {
    result = test.run();
    result.elapsed = Date.now() - start;
  } catch (err) {
    result = { pass: false, error: err.message, elapsed: Date.now() - start };
  }

  const status = result.pass ? '✅ PASS' : '❌ FAIL';
  console.log(`  ${status} ${test.name} (${result.elapsed}ms)`);
  if (!result.pass) {
    if (result.error) console.log(`         Error: ${result.error}`);
    if (result.pmText !== undefined) console.log(`         PM text: "${result.pmText}"`);
    if (result.fillResult) console.log(`         fillForm: ${JSON.stringify(result.fillResult).slice(0,200)}`);
  }
  return { name, ...result };
}

function main() {
  const arg = process.argv[2];

  if (arg === '--list' || arg === 'list') {
    console.log('ProseMirror Benchmark Tests\n');
    for (const [name, test] of Object.entries(TESTS)) {
      console.log(`  ${name.padEnd(25)} ${test.description}`);
    }
    return;
  }

  checkPrereqs();

  console.log('\n🔬 ProseMirror Editor Benchmark');
  console.log('='.repeat(60));
  console.log(`Server: ${TEST_SERVER}`);
  console.log(`Page:   ${EDITOR_URL}\n`);

  const testsToRun = arg ? [arg] : Object.keys(TESTS);
  const results = [];

  for (const name of testsToRun) {
    if (!TESTS[name]) { console.error(`Unknown test: ${name}`); continue; }
    results.push(runTest(name));
  }

  const passed = results.filter(r => r.pass).length;
  const failed = results.length - passed;
  const totalTime = results.reduce((s, r) => s + (r.elapsed || 0), 0);

  console.log('\n' + '='.repeat(60));
  console.log(`Results: ${passed}/${results.length} passed (${Math.round(passed/results.length*100)}%)`);
  console.log(`Total time: ${(totalTime/1000).toFixed(1)}s`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.pass).forEach(r => {
      console.log(`  ❌ ${r.name}`);
    });
  }

  console.log('\n📋 Summary:');
  const typeTest = results.find(r => r.name === 'type-basic');
  if (typeTest) {
    console.log(`  type action:     ${typeTest.pass ? '✅ Works' : '❌ Broken'} (PM path: ${typeTest.usedProseMirrorPath ? 'yes' : 'no'})`);
  }
  const fillTest = results.find(r => r.name === 'fillform-pm');
  if (fillTest) {
    console.log(`  fillForm action: ${fillTest.pass ? '✅ Works' : '❌ Broken'}`);
  }
  const syncTest = results.find(r => r.name === 'state-sync');
  if (syncTest) {
    console.log(`  State sync:      ${syncTest.pass ? '✅ PM state = DOM' : '❌ PM state ≠ DOM'}`);
  }

  const resultFile = `benchmarks/results/prosemirror-${Date.now()}.json`;
  fs.mkdirSync('benchmarks/results', { recursive: true });
  fs.writeFileSync(resultFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    passed, failed, totalTime,
    results: results.map(r => ({
      name: r.name, pass: r.pass, elapsed: r.elapsed,
      pmText: r.pmText, usedProseMirrorPath: r.usedProseMirrorPath
    }))
  }, null, 2));
  console.log(`\n📄 Saved to ${resultFile}`);
}

main();
