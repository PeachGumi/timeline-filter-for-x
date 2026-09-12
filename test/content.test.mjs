import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function makeArticle({ handle = '', mediaMarker = false, adWrapper = false } = {}) {
  const classes = new Set();
  const header = {
    querySelectorAll: () => handle ? [{ getAttribute: () => `/${handle}` }] : [],
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

test('hides a paid account but keeps an unverified placement-tracked video', () => {
  const normalVideo = makeArticle({ handle: 'love___not_', mediaMarker: true, adWrapper: true });
  const paidPost = makeArticle({ handle: 'paid_user' });
  const articles = [normalVideo, paidPost];
  const source = fs.readFileSync(new URL('../content.js', import.meta.url), 'utf8');
  let messageHandler;

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
    window: {
      addEventListener(type, handler) {
        if (type === 'message') messageHandler = handler;
      },
      postMessage() {},
    },
  };
  context.window.window = context.window;

  vm.runInNewContext(source, context);
  messageHandler({
    source: context.window,
    data: { source: 'hvu', users: { paid_user: 'paid', love___not_: 'other' } },
  });

  assert.equal(normalVideo.classList.contains('hvu-hidden'), false);
  assert.equal(paidPost.classList.contains('hvu-hidden'), true);
});
