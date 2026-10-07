const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(`${__dirname}/../extension/background.js`, 'utf8');
const start = source.indexOf('async function closeSessionWindow(');
const end = source.indexOf('// Set which tab', start);
function fixture(windows, tab) {
  const removed = [];
  const context = vm.createContext({ browser: {
    windows: { getAll: async () => windows, remove: async id => removed.push(id) },
    tabs: { get: async () => tab },
  }});
  vm.runInContext(source.slice(start, end), context);
  return { close: context.closeSessionWindow, removed };
}
test('stopping closes the saved bound window', async () => {
  const f = fixture([{ id: 3 }, { id: 8 }], { windowId: 3 });
  await f.close({ windowId: 3, tabId: 2 });
  assert.deepEqual(f.removed, [3]);
});
test('already closed window is clean', async () => {
  const f = fixture([], null);
  await f.close({ windowId: 3, tabId: 2 });
  assert.deepEqual(f.removed, []);
});
test('moved tab and missing IDs never close another window', async () => {
  const f = fixture([{ id: 3 }], { windowId: 8 });
  await assert.rejects(f.close({ windowId: 3, tabId: 2 }), /moved/);
  await assert.rejects(f.close({ windowId: 3 }), /requires/);
  assert.deepEqual(f.removed, []);
});
