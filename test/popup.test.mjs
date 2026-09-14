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

test('does not expose a misleading hidden-post count', () => {
  const html = fs.readFileSync(new URL('../popup.html', import.meta.url), 'utf8');
  const popupSource = fs.readFileSync(new URL('../popup.js', import.meta.url), 'utf8');
  const contentSource = fs.readFileSync(new URL('../content.js', import.meta.url), 'utf8');
  assert.equal(html.includes('このページで非表示'), false);
  assert.equal(popupSource.includes('tfx-get-blocked-count'), false);
  assert.equal(popupSource.includes('tfx-blocked-count-updated'), false);
  assert.equal(contentSource.includes('tfx-get-blocked-count'), false);
  assert.equal(contentSource.includes('tfx-blocked-count-updated'), false);
});

test('restores and saves the three filter settings', () => {
  const mainToggle = checkbox();
  const aiToggle = checkbox();
  const foreignToggle = checkbox();
  const writes = [];
  const context = {
    chrome: {
      storage: {
        sync: {
          get(_keys, callback) {
            callback({ isHiding: true, hideAiGenerated: true, hideForeignLanguage: true });
          },
          set(value) { writes.push(value); },
        },
      },
    },
    document: {
      getElementById(id) {
        return {
          toggleSwitch: mainToggle,
          hideAiGenerated: aiToggle,
          hideForeignLanguage: foreignToggle,
        }[id];
      },
    },
  };

  const source = fs.readFileSync(new URL('../popup.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, context);

  assert.equal(mainToggle.checked, true);
  assert.equal(aiToggle.checked, true);
  assert.equal(foreignToggle.checked, true);

  mainToggle.checked = false;
  mainToggle.listeners.change();
  aiToggle.checked = false;
  aiToggle.listeners.change();
  foreignToggle.checked = false;
  foreignToggle.listeners.change();

  assert.deepEqual(
    JSON.parse(JSON.stringify(writes)),
    [
      { isHiding: false },
      { hideAiGenerated: false },
      { hideForeignLanguage: false },
    ],
  );
});
