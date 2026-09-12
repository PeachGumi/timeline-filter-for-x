import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function makeArticle({ mediaMarker = false, adWrapper = false } = {}) {
  const classes = new Set();
  const header = {
    querySelectorAll: () => [],
    textContent: '',
  };
  return {
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    },
    closest: (selector) =>
      selector === '[data-testid="placementTracking"]' && adWrapper ? {} : null,
    querySelector: (selector) => {
      if (selector === '[data-testid="User-Name"]') return header;
      if (selector === '[data-testid="placementTracking"]' && mediaMarker) return {};
      return null;
    },
  };
}

test('hides a promoted wrapper but keeps a normal video post', () => {
  const normalVideo = makeArticle({ mediaMarker: true });
  const promotedPost = makeArticle({ adWrapper: true });
  const articles = [normalVideo, promotedPost];
  const source = fs.readFileSync(new URL('../content.js', import.meta.url), 'utf8');

  const context = {
    chrome: {
      storage: {
        local: { set() {} },
        onChanged: { addListener() {} },
        sync: { get(_key, callback) { callback({ isHiding: true }); } },
      },
    },
    console,
    document: {
      createElement: () => ({ id: '', textContent: '' }),
      documentElement: { appendChild() {} },
      head: { appendChild() {} },
      querySelectorAll: (selector) => selector === 'article' ? articles : [],
    },
    localStorage: { getItem: () => null },
    Map,
    MutationObserver: class { observe() {} },
    requestAnimationFrame: (callback) => callback(),
    window: { addEventListener() {}, postMessage() {} },
  };
  context.window.window = context.window;

  vm.runInNewContext(source, context);

  assert.equal(normalVideo.classList.contains('hvu-hidden'), false);
  assert.equal(promotedPost.classList.contains('hvu-hidden'), true);
});
