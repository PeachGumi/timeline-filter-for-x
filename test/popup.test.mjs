import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function checkbox() {
  return {
    checked: false,
    listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
  };
}

test('restores and saves the optional content filters', () => {
  const mainToggle = checkbox();
  const aiToggle = checkbox();
  const foreignToggle = checkbox();
  const count = { textContent: '' };
  const writes = [];
  const context = {
    chrome: {
      storage: {
        local: { get(_key, callback) { callback({ blockedCount: 0 }); } },
        onChanged: { addListener() {} },
        sync: {
          get(_keys, callback) { callback({ isHiding: true, hideAiGenerated: true, hideForeignLanguage: true }); },
          set(value) { writes.push(value); },
        },
      },
    },
    document: {
      getElementById(id) {
        return { toggleSwitch: mainToggle, hideAiGenerated: aiToggle, hideForeignLanguage: foreignToggle, count }[id];
      },
    },
  };

  const source = fs.readFileSync(new URL('../popup.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, context);

  assert.equal(aiToggle.checked, true);
  assert.equal(foreignToggle.checked, true);
  aiToggle.checked = false;
  aiToggle.listeners.change();
  assert.deepEqual(JSON.parse(JSON.stringify(writes.at(-1))), { hideAiGenerated: false });
  foreignToggle.checked = false;
  foreignToggle.listeners.change();
  assert.deepEqual(JSON.parse(JSON.stringify(writes.at(-1))), { hideForeignLanguage: false });
});
