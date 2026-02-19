const { execSync } = require('child_process');

function browserCmd(action, params = {}) {
  const json = JSON.stringify(params);
  const result = execSync(`browser ${action} '${json.replace(/'/g, "'\\''")}'`, {
    encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe']
  });
  return JSON.parse(result.trim());
}

const results = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    passed++;
    console.log(`  ✅ PASS ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    failed++;
    console.log(`  ❌ FAIL ${name}`);
    console.log(`         ${e.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

console.log('\n🔥 Reddit Post Smoke Test (r/ClaudeAI)');
console.log('=' .repeat(60));

// Navigate to Reddit submit
console.log('\nNavigating to r/ClaudeAI/submit...');
browserCmd('navigate', { url: 'https://www.reddit.com/r/ClaudeAI/submit', wait: true });
execSync('sleep 2');

// 1. Shadow DOM: fill title via faceplate-textarea-input
test('fillForm into shadow DOM title (faceplate-textarea-input)', () => {
  const r = browserCmd('fillForm', {
    fields: [{ selector: 'faceplate-textarea-input[name=title]', value: 'SMOKE TEST — do not post' }]
  });
  assert(r.success === 1, `fillForm failed: ${JSON.stringify(r.results)}`);
  assert(r.results[0].type === 'text', `Expected type=text, got ${r.results[0].type}`);
});

// 2. Shadow DOM: type into shadow DOM title
test('type into shadow DOM title (faceplate-textarea-input)', () => {
  const r = browserCmd('type', {
    selector: 'faceplate-textarea-input[name=title]',
    text: 'jcode: SMOKE TEST title — do not post',
    clear: true
  });
  assert(r.typed, 'type did not report typed=true');
});

// 3. Verify title content
test('verify title content via evaluate', () => {
  const r = browserCmd('evaluate', {
    script: 'var el = document.querySelector("faceplate-textarea-input[name=title]"); var ta = el.shadowRoot.querySelector("textarea"); return ta.value'
  });
  assert(r.result.includes('SMOKE TEST'), `Title doesn't contain expected text: ${r.result}`);
});

// 4. Type multiline into Lexical body (visible editor)
test('type multiline into Lexical body editor', () => {
  const r = browserCmd('type', {
    selector: 'shreddit-composer[name=body] div[role=textbox]',
    text: 'First paragraph of the post.\n\nSecond paragraph with details.\n\nThird paragraph conclusion.',
    clear: true
  });
  assert(r.typed, 'type did not report typed=true');
  assert(r.richEditor, 'Expected richEditor=true');
});

// 5. Verify body has multiple paragraphs
test('verify body has multiple paragraphs', () => {
  const r = browserCmd('evaluate', {
    script: 'var ed = document.querySelector("shreddit-composer[name=body] div[role=textbox]"); var ps = ed.querySelectorAll("p"); return { count: ps.length, texts: Array.from(ps).map(p => p.textContent) }'
  });
  assert(r.result.count >= 3, `Expected >=3 paragraphs, got ${r.result.count}: ${JSON.stringify(r.result.texts)}`);
  assert(r.result.texts[0].includes('First paragraph'), `First para wrong: ${r.result.texts[0]}`);
});

// 6. Click by text in shadow DOM (flair button)
test('click text in shadow DOM (flair button)', () => {
  const r = browserCmd('click', { text: 'Add flair' });
  assert(r.clicked, 'click did not report clicked=true');
});

// 7. Close any flair modal
try {
  browserCmd('evaluate', {
    script: 'var m = document.querySelector("r-post-flairs-modal"); var sr = m?.shadowRoot; if(sr){var btn = sr.querySelector("#post-flair-modal-cancel-button"); if(btn) btn.click();} return "ok"'
  });
} catch(e) {}
execSync('sleep 0.3');

// 8. Verify type prefers visible element
test('type prefers visible contenteditable over hidden one', () => {
  const r = browserCmd('type', {
    selector: 'div[role=textbox][contenteditable=true]',
    text: 'Visible editor test',
    clear: true
  });
  assert(r.typed, 'type failed');
  const el = r.element;
  assert(el.rect.height > 0, `Typed into invisible element (height=${el.rect.height})`);
});

console.log('\n' + '='.repeat(60));
console.log(`Results: ${passed}/${passed + failed} passed (${Math.round(passed/(passed+failed)*100)}%)`);
if (failed > 0) {
  console.log('\nFailed:');
  for (const r of results) {
    if (!r.ok) console.log(`  ❌ ${r.name}: ${r.error}`);
  }
}
console.log('');

process.exit(failed > 0 ? 1 : 0);
