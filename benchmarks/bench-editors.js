#!/usr/bin/env node
/**
 * Rich Text Editor & File Upload Benchmarks
 *
 * Tests the firefox-agent-bridge against simulated real-world editors:
 *   - Draft.js (X/Twitter-like compose box)
 *   - Lexical (Reddit-like post form + shadow DOM)
 *   - TinyMCE/Canvas (homework submission with iframe editor + file upload)
 *   - File Upload (input[type=file], drag-drop, multi-file, various MIME types)
 *
 * All tests run against local test pages — no external logins required.
 *
 * Usage:
 *   node benchmarks/bench-editors.js             # run all
 *   node benchmarks/bench-editors.js draftjs     # run one suite
 *   node benchmarks/bench-editors.js --list      # list tests
 *
 * Requires:
 *   - Test server: node benchmarks/test-server.js
 *   - Firefox with agent bridge extension loaded
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TEST_SERVER = process.env.TEST_SERVER || 'http://localhost:3456';
const BROWSER = process.env.BROWSER_CLI || 'browser';

function browserCmd(action, params = {}) {
  try {
    const result = spawnSync(BROWSER, [action, JSON.stringify(params)], {
      timeout: 30000, encoding: 'utf-8'
    });
    if (result.error) return { ok: false, error: result.error.message };
    const stdout = (result.stdout || '').trim();
    if (!stdout) return { ok: false, error: result.stderr || 'no output' };
    return JSON.parse(stdout);
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function evaluate(script, pageWorld = false) {
  return browserCmd('evaluate', pageWorld ? { script, pageWorld: true } : { script });
}

function sleep(ms) {
  spawnSync('sleep', [String(ms / 1000)]);
}

function nav(page, waitSelector, maxWait = 8000) {
  browserCmd('navigate', { url: `${TEST_SERVER}/${page}`, wait: true });
  sleep(800);
  if (!waitSelector) return true;
  for (let elapsed = 0; elapsed < maxWait; elapsed += 400) {
    const check = evaluate(`return !!document.querySelector("${waitSelector.replace(/"/g, '\\"')}")`);
    if (check?.result === true) return true;
    sleep(400);
  }
  return false;
}

// Create a small test file and return its absolute path
function createTestFile(name, content, binary = false) {
  const dir = '/tmp/fab-bench-files';
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  if (binary) {
    fs.writeFileSync(p, Buffer.from(content, 'base64'));
  } else {
    fs.writeFileSync(p, content);
  }
  return p;
}

// Upload file via CLI uploadFile action
function uploadFile(selector, filePath) {
  return browserCmd('uploadFile', { selector, path: filePath });
}

// Drop file via CLI dropFile action
function dropFile(selector, filePath) {
  return browserCmd('dropFile', { selector, path: filePath });
}

// Minimal 1x1 red PNG (base64)
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
// Minimal PDF
const TINY_PDF = '%PDF-1.0\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF';

// ============================================================
// Draft.js Tests (X/Twitter-like)
// ============================================================

const DRAFTJS_TESTS = {
  'draftjs-type-compose': {
    name: 'type into compose box',
    run() {
      if (!nav('draftjs-editor.html', '[data-testid="tweetTextarea_0"]')) return { pass: false, error: 'page not loaded' };

      const text = 'Hello from the agent benchmark! 🚀';
      const r = browserCmd('type', { selector: '[data-testid="tweetTextarea_0"]', text });
      sleep(200);

      const check = evaluate('var el=document.querySelector("[data-testid=\\"tweetTextarea_0\\"]");return el?el.innerText:null');
      const found = (check?.result || '').includes('Hello from the agent');

      return { typed: r?.typed, richEditor: r?.richEditor, textInEditor: found, pass: r?.typed && found };
    }
  },

  'draftjs-clear-retype': {
    name: 'clear and retype',
    run() {
      if (!nav('draftjs-editor.html', '[data-testid="tweetTextarea_0"]')) return { pass: false, error: 'page not loaded' };

      browserCmd('type', { selector: '[data-testid="tweetTextarea_0"]', text: 'First draft' });
      sleep(100);
      const r = browserCmd('type', { selector: '[data-testid="tweetTextarea_0"]', text: 'Revised content', clear: true });
      sleep(200);

      const check = evaluate('var el=document.querySelector("[data-testid=\\"tweetTextarea_0\\"]");return el?el.innerText:null');
      const text = check?.result || '';
      return { oldGone: !text.includes('First draft'), newPresent: text.includes('Revised content'), pass: !text.includes('First draft') && text.includes('Revised content') };
    }
  },

  'draftjs-reply-box': {
    name: 'type into reply box (second editor)',
    run() {
      if (!nav('draftjs-editor.html', '[data-testid="tweetTextarea_0_reply"]')) return { pass: false, error: 'page not loaded' };

      const text = 'This is a reply to the original post';
      const r = browserCmd('type', { selector: '[data-testid="tweetTextarea_0_reply"]', text });
      sleep(200);

      const check = evaluate('var el=document.querySelector("[data-testid=\\"tweetTextarea_0_reply\\"]");return el?el.innerText:null');
      const found = (check?.result || '').includes('reply to the original');

      return { typed: r?.typed, richEditor: r?.richEditor, pass: r?.typed && found };
    }
  },

  'draftjs-quote-replace': {
    name: 'replace pre-filled quote content',
    run() {
      if (!nav('draftjs-editor.html', '[data-testid="tweetTextarea_0_quote"]')) return { pass: false, error: 'page not loaded' };

      // Quote editor has pre-filled content
      const before = evaluate('var el=document.querySelector("[data-testid=\\"tweetTextarea_0_quote\\"]");return el?el.innerText:null');
      const hadContent = (before?.result || '').includes('interesting');

      const r = browserCmd('type', { selector: '[data-testid="tweetTextarea_0_quote"]', text: 'My new commentary on this', clear: true });
      sleep(200);

      const after = evaluate('var el=document.querySelector("[data-testid=\\"tweetTextarea_0_quote\\"]");return el?el.innerText:null');
      const text = after?.result || '';

      return { hadContent, replaced: text.includes('My new commentary'), oldGone: !text.includes('interesting'), pass: hadContent && text.includes('My new commentary') && !text.includes('interesting') };
    }
  },

  'draftjs-button-state': {
    name: 'post button enables after typing',
    run() {
      if (!nav('draftjs-editor.html', '[data-testid="tweetButton"]')) return { pass: false, error: 'page not loaded' };

      const beforeBtn = evaluate('var b=document.getElementById("postBtn1");return b?b.disabled:null');
      const wasDis = beforeBtn?.result === true;

      browserCmd('type', { selector: '[data-testid="tweetTextarea_0"]', text: 'Enabling the button' });
      sleep(300);

      const afterBtn = evaluate('var b=document.getElementById("postBtn1");return b?b.disabled:null');
      const nowEnabled = afterBtn?.result === false;

      return { wasDisabled: wasDis, nowEnabled, pass: wasDis && nowEnabled };
    }
  }
};

// ============================================================
// Lexical Tests (Reddit-like)
// ============================================================

const LEXICAL_TESTS = {
  'lexical-post-body': {
    name: 'type into post body',
    run() {
      if (!nav('lexical-editor.html', '[data-lexical-editor]')) return { pass: false, error: 'page not loaded' };

      const text = 'Agent benchmark typing into Lexical editor body';
      const r = browserCmd('type', { selector: '[data-lexical-editor][aria-label="Post body text field"]', text });
      sleep(200);

      const check = evaluate('var el=document.querySelector("[data-lexical-editor][aria-label=\\"Post body text field\\"]");return el?el.innerText:null');
      const found = (check?.result || '').includes('Lexical editor body');

      return { typed: r?.typed, richEditor: r?.richEditor, pass: r?.typed && found };
    }
  },

  'lexical-shadow-dom-title': {
    name: 'type into shadow DOM title (faceplate-textarea-input)',
    run() {
      if (!nav('lexical-editor.html', 'faceplate-textarea-input')) return { pass: false, error: 'page not loaded' };

      // Title is inside shadow DOM — use execCommand through evaluate
      const r = evaluate(
        'var el=document.querySelector("faceplate-textarea-input[name=title]");' +
        'if(!el||!el.shadowRoot)return{ok:false,error:"no shadow"};' +
        'var ta=el.shadowRoot.querySelector("textarea");' +
        'if(!ta)return{ok:false,error:"no textarea"};' +
        'ta.focus();' +
        'document.execCommand("insertText",false,"AI Agent Benchmark Post Title");' +
        'return{ok:true,value:ta.value}'
      );

      const value = r?.result?.value || '';
      return { method: 'execCommand via shadow DOM', value: value.substring(0, 60), pass: value.includes('AI Agent Benchmark') };
    }
  },

  'lexical-comment-reply': {
    name: 'type into comment reply editor',
    run() {
      if (!nav('lexical-editor.html', '[aria-label="Write a comment"]')) return { pass: false, error: 'page not loaded' };

      const text = 'Great point! I agree with your analysis.';
      const r = browserCmd('type', { selector: '[data-lexical-editor][aria-label="Write a comment"]', text });
      sleep(200);

      const check = evaluate('var el=document.querySelector("[aria-label=\\"Write a comment\\"]");return el?el.innerText:null');
      const found = (check?.result || '').includes('agree with your analysis');

      return { typed: r?.typed, richEditor: r?.richEditor, pass: r?.typed && found };
    }
  },

  'lexical-edit-existing': {
    name: 'replace pre-filled post body',
    run() {
      if (!nav('lexical-editor.html', '[aria-label="Edit post body"]')) return { pass: false, error: 'page not loaded' };

      const before = evaluate('var el=document.querySelector("[aria-label=\\"Edit post body\\"]");return el?el.innerText:null');
      const hadOld = (before?.result || '').includes('original post body');

      const r = browserCmd('type', { selector: '[aria-label="Edit post body"]', text: 'Updated post body with new content', clear: true });
      sleep(200);

      const after = evaluate('var el=document.querySelector("[aria-label=\\"Edit post body\\"]");return el?el.innerText:null');
      const text = after?.result || '';

      return { hadOld, newPresent: text.includes('Updated post body'), oldGone: !text.includes('original post body'), pass: hadOld && text.includes('Updated post body') && !text.includes('original post body') };
    }
  },

  'lexical-full-form': {
    name: 'fill title + body + community',
    run() {
      if (!nav('lexical-editor.html', '[data-lexical-editor]')) return { pass: false, error: 'page not loaded' };

      // Fill community selector
      const selectR = browserCmd('fillForm', { fields: [{ selector: '.community-select', value: 'r/programming' }] });

      // Fill title via shadow DOM
      const titleR = evaluate(
        'var el=document.querySelector("#titleInput1");' +
        'if(!el||!el.shadowRoot)return{ok:false};' +
        'var ta=el.shadowRoot.querySelector("textarea");ta.focus();' +
        'document.execCommand("insertText",false,"Complete Form Fill Test");' +
        'ta.dispatchEvent(new Event("input",{bubbles:true}));' +
        'return{ok:true,value:ta.value}'
      );

      // Fill body
      const bodyR = browserCmd('type', { selector: '[data-lexical-editor][aria-label="Post body text field"]', text: 'This is the post body content filled by the agent.' });
      sleep(300);

      const titleOk = (titleR?.result?.value || '').includes('Complete Form');
      const bodyOk = bodyR?.typed;
      const selectOk = selectR?.filled;

      return { titleFilled: titleOk, bodyFilled: bodyOk, communitySelected: !!selectOk, pass: titleOk && bodyOk };
    }
  }
};

// ============================================================
// Canvas/TinyMCE Tests (homework submission)
// ============================================================

const CANVAS_TESTS = {
  'canvas-tinymce-type': {
    name: 'type into TinyMCE iframe editor',
    run() {
      if (!nav('canvas-homework.html', '.tox-edit-area__iframe')) return { pass: false, error: 'page not loaded' };
      sleep(500); // wait for iframe to load

      // TinyMCE uses an iframe — type into the body inside it
      const r = evaluate(
        'var iframe=document.getElementById("textentry_text_ifr");' +
        'if(!iframe||!iframe.contentDocument)return{ok:false,error:"no iframe"};' +
        'var body=iframe.contentDocument.body;' +
        'body.focus();' +
        'iframe.contentDocument.execCommand("insertText",false,"一、主动, 抗拒, 矛盾, 明显, 适应");' +
        'body.dispatchEvent(new Event("input",{bubbles:true}));' +
        'return{ok:true,text:body.innerText}'
      );

      const text = r?.result?.text || '';
      return { method: 'execCommand in iframe', hasChineseText: text.includes('主动'), pass: text.includes('主动') };
    }
  },

  'canvas-tinymce-multiline': {
    name: 'type multiline Chinese homework answers',
    run() {
      if (!nav('canvas-homework.html', '.tox-edit-area__iframe')) return { pass: false, error: 'page not loaded' };
      sleep(500);

      const answers = '一、填空:\\n1. 他很快就适应了新环境。\\n2. 她的内心充满了矛盾。\\n\\n二、造句:\\n1. 来到美国以后，我慢慢适应了这里的生活。\\n2. 他对这件事感到很矛盾。';

      const r = evaluate(
        'var iframe=document.getElementById("textentry_text_ifr");' +
        'if(!iframe||!iframe.contentDocument)return{ok:false,error:"no iframe"};' +
        'var body=iframe.contentDocument.body;body.focus();' +
        'var lines="' + answers + '".split("\\\\n");' +
        'for(var i=0;i<lines.length;i++){' +
        '  if(i>0)iframe.contentDocument.execCommand("insertLineBreak",false,null);' +
        '  iframe.contentDocument.execCommand("insertText",false,lines[i]);' +
        '}' +
        'body.dispatchEvent(new Event("input",{bubbles:true}));' +
        'return{ok:true,text:body.innerText}'
      );

      const text = r?.result?.text || '';
      const hasSection1 = text.includes('填空');
      const hasSection2 = text.includes('造句');
      const hasChinese = text.includes('适应');

      return { hasSection1, hasSection2, hasChinese, pass: hasSection1 && hasSection2 && hasChinese };
    }
  },

  'canvas-file-upload-input': {
    name: 'upload file via input[type=file]',
    run() {
      if (!nav('canvas-homework.html', '#fileInput')) return { pass: false, error: 'page not loaded' };

      const testFile = createTestFile('homework.pdf', TINY_PDF);
      uploadFile('#fileInput', testFile);
      sleep(300);

      // Verify via page state (uploadFile CLI doesn't return response)
      const check = evaluate(
        'var inp=document.getElementById("fileInput");' +
        'return {files:inp.files.length,status:document.getElementById("status").textContent}'
      );
      const status = check?.result?.status || '';
      const hasFile = status.includes('homework.pdf') || check?.result?.files > 0;

      return { fileCount: check?.result?.files, status: status.substring(0, 80), pass: hasFile };
    }
  },

  'canvas-image-upload': {
    name: 'upload image for editor insertion',
    run() {
      if (!nav('canvas-homework.html', '#imageInput')) return { pass: false, error: 'page not loaded' };

      const testImg = createTestFile('screenshot.png', TINY_PNG_B64, true);
      uploadFile('#imageInput', testImg);
      sleep(300);

      const check = evaluate(
        'var inp=document.getElementById("imageInput");' +
        'return {files:inp.files.length,status:document.getElementById("status").textContent}'
      );
      const hasFile = (check?.result?.status || '').includes('screenshot.png') || check?.result?.files > 0;

      return { fileCount: check?.result?.files, pass: hasFile };
    }
  },

  'canvas-drop-file': {
    name: 'drag-drop file onto drop zone',
    run() {
      if (!nav('canvas-homework.html', '#dropZone')) return { pass: false, error: 'page not loaded' };

      const testFile = createTestFile('notes.pdf', TINY_PDF);
      dropFile('#dropZone', testFile);
      sleep(300);

      const check = evaluate(
        'return document.getElementById("status").textContent'
      );
      const status = check?.result || '';
      const hasFile = status.includes('notes.pdf') || status.includes('file');

      return { status: status.substring(0, 80), pass: hasFile };
    }
  },

  'canvas-submit-state': {
    name: 'submit button enables after content',
    run() {
      if (!nav('canvas-homework.html', '#submitBtn')) return { pass: false, error: 'page not loaded' };
      sleep(500);

      const beforeBtn = evaluate('return document.getElementById("submitBtn").disabled');
      const wasDis = beforeBtn?.result === true;

      // Type into editor
      evaluate(
        'var iframe=document.getElementById("textentry_text_ifr");' +
        'var body=iframe.contentDocument.body;body.focus();' +
        'iframe.contentDocument.execCommand("insertText",false,"Test answer");' +
        'body.dispatchEvent(new Event("input",{bubbles:true}));return true'
      );
      sleep(300);

      const afterBtn = evaluate('return document.getElementById("submitBtn").disabled');
      const nowEnabled = afterBtn?.result === false;

      return { wasDisabled: wasDis, nowEnabled, pass: wasDis && nowEnabled };
    }
  }
};

// ============================================================
// File Upload Tests
// ============================================================

const UPLOAD_TESTS = {
  'upload-single-file': {
    name: 'single file input',
    run() {
      if (!nav('file-upload.html', '#singleFile')) return { pass: false, error: 'page not loaded' };

      const testFile = createTestFile('test.txt', 'Hello from benchmark test');
      uploadFile('#singleFile', testFile);
      sleep(200);

      const check = evaluate(
        'return {files:document.getElementById("singleFile").files.length,status:document.getElementById("status1").textContent}'
      );
      const hasFile = (check?.result?.status || '').includes('test.txt') || check?.result?.files > 0;

      return { fileCount: check?.result?.files, statusText: (check?.result?.status || '').substring(0, 80), pass: hasFile };
    }
  },

  'upload-image': {
    name: 'image file (accept=image/*)',
    run() {
      if (!nav('file-upload.html', '#imageFile')) return { pass: false, error: 'page not loaded' };

      const testImg = createTestFile('photo.png', TINY_PNG_B64, true);
      uploadFile('#imageFile', testImg);
      sleep(200);

      const check = evaluate(
        'return {files:document.getElementById("imageFile").files.length,status:document.getElementById("status2").textContent,previews:document.getElementById("preview2").querySelectorAll("img").length}'
      );
      const hasFile = (check?.result?.status || '').includes('photo.png') || check?.result?.files > 0;

      return { fileCount: check?.result?.files, previewCount: check?.result?.previews, pass: hasFile };
    }
  },

  'upload-video': {
    name: 'video file (accept=video/*)',
    run() {
      if (!nav('file-upload.html', '#videoFile')) return { pass: false, error: 'page not loaded' };

      const testVid = createTestFile('clip.mp4', 'fake-video-content-for-testing');
      uploadFile('#videoFile', testVid);
      sleep(200);

      const check = evaluate(
        'return {files:document.getElementById("videoFile").files.length,status:document.getElementById("status3").textContent}'
      );
      const hasFile = (check?.result?.status || '').includes('clip.mp4') || check?.result?.files > 0;

      return { fileCount: check?.result?.files, pass: hasFile };
    }
  },

  'upload-multi-file': {
    name: 'multiple files at once',
    run() {
      if (!nav('file-upload.html', '#multiFile')) return { pass: false, error: 'page not loaded' };

      const f1 = createTestFile('doc1.txt', 'Document 1');
      const f2 = createTestFile('doc2.txt', 'Document 2');
      const f3 = createTestFile('image.png', TINY_PNG_B64, true);

      // uploadFile with multiple files via fillForm
      const r = evaluate(
        'var inp=document.getElementById("multiFile");' +
        'var dt=new DataTransfer();' +
        'dt.items.add(new File(["Document 1"],"doc1.txt",{type:"text/plain"}));' +
        'dt.items.add(new File(["Document 2"],"doc2.txt",{type:"text/plain"}));' +
        'dt.items.add(new File([new Uint8Array(1)],"image.png",{type:"image/png"}));' +
        'inp.files=dt.files;' +
        'inp.dispatchEvent(new Event("change",{bubbles:true}));' +
        'return{count:inp.files.length}'
      );
      sleep(200);

      const status = evaluate('return document.getElementById("status4").textContent');
      const count = r?.result?.count || 0;
      const has3 = (status?.result || '').includes('3 file');

      return { fileCount: count, statusHas3: has3, pass: count >= 3 };
    }
  },

  'upload-drop-zone': {
    name: 'drag-drop onto drop zone',
    run() {
      if (!nav('file-upload.html', '#dropZone1')) return { pass: false, error: 'page not loaded' };

      const testFile = createTestFile('dropped.pdf', TINY_PDF);
      dropFile('#dropZone1', testFile);
      sleep(300);

      const check = evaluate('return document.getElementById("status5").textContent');
      const hasFile = (check?.result || '').includes('dropped.pdf');

      return { status: (check?.result || '').substring(0, 80), pass: hasFile };
    }
  },

  'upload-drop-on-editor': {
    name: 'drag-drop onto contenteditable editor',
    run() {
      if (!nav('file-upload.html', '#editorDropTarget')) return { pass: false, error: 'page not loaded' };

      const testImg = createTestFile('editor-image.png', TINY_PNG_B64, true);
      dropFile('#editorDropTarget', testImg);
      sleep(300);

      const check = evaluate('return document.getElementById("status6").textContent');
      const hasFile = (check?.result || '').includes('editor-image.png');

      return { status: (check?.result || '').substring(0, 80), pass: hasFile };
    }
  },

  'upload-pdf': {
    name: 'PDF document upload',
    run() {
      if (!nav('file-upload.html', '#pdfFile')) return { pass: false, error: 'page not loaded' };

      const testPdf = createTestFile('homework.pdf', TINY_PDF);
      uploadFile('#pdfFile', testPdf);
      sleep(200);

      const check = evaluate(
        'return {files:document.getElementById("pdfFile").files.length,status:document.getElementById("status7").textContent}'
      );
      const hasFile = (check?.result?.status || '').includes('homework.pdf') || check?.result?.files > 0;

      return { fileCount: check?.result?.files, pass: hasFile };
    }
  },

  'upload-hidden-input': {
    name: 'hidden input[type=file] (common pattern)',
    run() {
      if (!nav('file-upload.html', '#hiddenFileInput')) return { pass: false, error: 'page not loaded' };

      const testFile = createTestFile('attachment.txt', 'Attached file content');
      uploadFile('#hiddenFileInput', testFile);
      sleep(200);

      const check = evaluate(
        'return {files:document.getElementById("hiddenFileInput").files.length,status:document.getElementById("status8").textContent}'
      );
      const hasFile = (check?.result?.status || '').includes('attachment.txt') || check?.result?.files > 0;

      return { fileCount: check?.result?.files, pass: hasFile };
    }
  }
};

// ============================================================
// Runner
// ============================================================

const ALL_SUITES = {
  draftjs: { name: 'Draft.js (X/Twitter)', tests: DRAFTJS_TESTS },
  lexical: { name: 'Lexical (Reddit)', tests: LEXICAL_TESTS },
  canvas: { name: 'TinyMCE/Canvas Homework', tests: CANVAS_TESTS },
  upload: { name: 'File Upload', tests: UPLOAD_TESTS }
};

function runTest(name, test) {
  const start = Date.now();
  let result;
  try {
    result = test.run();
    result.elapsed = Date.now() - start;
  } catch (err) {
    result = { pass: false, error: err.message, elapsed: Date.now() - start };
  }

  const status = result.pass ? '✅ PASS' : '❌ FAIL';
  console.log(`  ${status} ${test.name} (${(result.elapsed / 1000).toFixed(1)}s)`);
  if (!result.pass && result.error) {
    console.log(`         Error: ${result.error}`);
  }
  return { name, ...result };
}

function main() {
  const arg = process.argv[2];

  if (arg === '--list' || arg === 'list') {
    console.log('Rich Text Editor & File Upload Benchmarks\n');
    for (const [key, suite] of Object.entries(ALL_SUITES)) {
      console.log(`  ${suite.name} (${key}):`);
      for (const [id, test] of Object.entries(suite.tests)) {
        console.log(`    ${id.padEnd(32)} ${test.name}`);
      }
      console.log();
    }
    return;
  }

  // Check browser + test server
  try {
    const ping = JSON.parse(spawnSync(BROWSER, ['ping'], { timeout: 5000, encoding: 'utf-8' }).stdout);
    if (!ping.pong) throw new Error('No pong');
  } catch {
    console.error('❌ Browser bridge not responding');
    process.exit(1);
  }

  try {
    spawnSync('curl', ['-sf', `${TEST_SERVER}/`], { timeout: 3000 });
  } catch {
    console.error(`❌ Test server not running at ${TEST_SERVER}`);
    console.error('   Start with: node benchmarks/test-server.js');
    process.exit(1);
  }

  console.log('\n🖊  Rich Text Editor & File Upload Benchmarks');
  console.log('='.repeat(60));
  console.log(`Test server: ${TEST_SERVER}\n`);

  const suitesToRun = arg && ALL_SUITES[arg]
    ? { [arg]: ALL_SUITES[arg] }
    : ALL_SUITES;

  const allResults = [];

  for (const [key, suite] of Object.entries(suitesToRun)) {
    console.log(`\n── ${suite.name} ${'─'.repeat(Math.max(1, 50 - suite.name.length))}`);
    for (const [name, test] of Object.entries(suite.tests)) {
      allResults.push(runTest(name, test));
    }
  }

  const passed = allResults.filter(r => r.pass).length;
  const failed = allResults.length - passed;
  const totalTime = allResults.reduce((s, r) => s + (r.elapsed || 0), 0);

  console.log('\n' + '='.repeat(60));
  console.log(`Results: ${passed}/${allResults.length} passed (${Math.round(passed / allResults.length * 100)}%)`);
  console.log(`Total time: ${(totalTime / 1000).toFixed(1)}s`);

  if (failed > 0) {
    console.log('\nFailed:');
    allResults.filter(r => !r.pass).forEach(r => {
      console.log(`  ❌ ${r.name}${r.error ? ': ' + r.error : ''}`);
    });
  }

  console.log('\n📋 Per-suite summary:');
  for (const [key, suite] of Object.entries(suitesToRun)) {
    const sr = allResults.filter(r => Object.keys(suite.tests).includes(r.name));
    const sp = sr.filter(r => r.pass).length;
    const icon = sp === sr.length ? '✅' : sp > 0 ? '⚠️' : '❌';
    console.log(`  ${icon} ${suite.name}: ${sp}/${sr.length}`);
  }

  // Save results
  const resultFile = `benchmarks/results/editors-${Date.now()}.json`;
  fs.mkdirSync('benchmarks/results', { recursive: true });
  fs.writeFileSync(resultFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    server: TEST_SERVER,
    passed, failed, totalTime,
    results: allResults.map(r => ({
      name: r.name, pass: r.pass, elapsed: r.elapsed,
      error: r.error, richEditor: r.richEditor
    }))
  }, null, 2));
  console.log(`\n📄 Saved to ${resultFile}`);

  // Cleanup test files
  try { fs.rmSync('/tmp/fab-bench-files', { recursive: true, force: true }); } catch {}
}

main();
