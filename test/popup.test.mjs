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
      runtime: {
        onMessage: { addListener() {} },
      },
      tabs: {
        query(_options, callback) { callback([{ id: 7 }]); },
        sendMessage(_id, _message, callback) { callback({ blockedCount: 0, documentToken: 'test-document' }); },
      },
      storage: {
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

test('shows the hidden count from the active tab', () => {
  const count = { textContent: '' };
  const requestedTabs = [];
  let runtimeMessageHandler;
  const context = {
    chrome: {
      runtime: {
        lastError: null,
        onMessage: { addListener(handler) { runtimeMessageHandler = handler; } },
      },
      tabs: {
        query(options, callback) {
          requestedTabs.push(options);
          callback([{ id: 42 }]);
        },
        sendMessage(tabId, message, callback) {
          assert.equal(tabId, 42);
          assert.deepEqual(JSON.parse(JSON.stringify(message)), { type: 'tfx-get-blocked-count' });
          callback({ blockedCount: 6, documentToken: 'current-document' });
        },
      },
      storage: {
        onChanged: { addListener() {} },
        sync: {
          get(_keys, callback) { callback({}); },
          set() {},
        },
      },
    },
    document: {
      getElementById(id) {
        if (id === 'count') return count;
        return checkbox();
      },
    },
  };

  const source = fs.readFileSync(new URL('../popup.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, context);

  assert.deepEqual(JSON.parse(JSON.stringify(requestedTabs)), [{ active: true, currentWindow: true }]);
  assert.equal(count.textContent, 6);

  runtimeMessageHandler(
    { type: 'tfx-blocked-count-updated', blockedCount: 3, documentToken: 'current-document' },
    { tab: { id: 42 } },
  );
  assert.equal(count.textContent, 3);

  runtimeMessageHandler(
    { type: 'tfx-blocked-count-updated', blockedCount: 9, documentToken: 'current-document' },
    { tab: { id: 99 } },
  );
  assert.equal(count.textContent, 3);
});

function delayedCountPopup() {
  const count = { textContent: '' };
  const initialResponses = [];
  const timers = [];
  let runtimeMessageHandler;
  let tabUpdatedHandler;
  const context = {
    chrome: {
      runtime: {
        lastError: null,
        onMessage: { addListener(handler) { runtimeMessageHandler = handler; } },
      },
      tabs: {
        onUpdated: { addListener(handler) { tabUpdatedHandler = handler; } },
        query(_options, callback) { callback([{ id: 42 }]); },
        sendMessage(_tabId, _message, callback) { initialResponses.push(callback); },
      },
      storage: {
        onChanged: { addListener() {} },
        sync: {
          get(_keys, callback) { callback({}); },
          set() {},
        },
      },
    },
    document: {
      getElementById(id) {
        if (id === 'count') return count;
        return checkbox();
      },
    },
    setTimeout(callback) { timers.push(callback); },
  };

  const source = fs.readFileSync(new URL('../popup.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, context);
  return {
    count,
    live(message) { runtimeMessageHandler(message, { tab: { id: 42 } }); },
    respond(response, lastError = null) {
      context.chrome.runtime.lastError = lastError;
      initialResponses.shift()(response);
    },
    runTimer() { timers.shift()(); },
    updated(status) { tabUpdatedHandler(42, { status }); },
  };
}

test('does not overwrite a same-document live count with a late initial response', () => {
  const popup = delayedCountPopup();
  popup.live({ type: 'tfx-blocked-count-updated', blockedCount: 3, documentToken: 'current-document' });
  popup.respond({ blockedCount: 1, documentToken: 'current-document' });
  assert.equal(popup.count.textContent, 3);
});

test('replaces a previous-document update with the current initial response', () => {
  const popup = delayedCountPopup();
  popup.live({ type: 'tfx-blocked-count-updated', blockedCount: 8, documentToken: 'previous-document' });
  popup.respond({ blockedCount: 2, documentToken: 'current-document' });
  assert.equal(popup.count.textContent, 2);
});

test('clears a previous-document update when the current document has no receiver', () => {
  const popup = delayedCountPopup();
  popup.live({ type: 'tfx-blocked-count-updated', blockedCount: 8, documentToken: 'previous-document' });
  popup.respond(undefined, { message: 'Receiving end does not exist' });
  assert.equal(popup.count.textContent, 0);
});

test('does not let a malformed live update suppress the current initial response', () => {
  const popup = delayedCountPopup();
  popup.live({ type: 'tfx-blocked-count-updated', blockedCount: -1, documentToken: 'current-document' });
  popup.live({ type: 'tfx-blocked-count-updated', blockedCount: 9 });
  popup.respond({ blockedCount: 2, documentToken: 'current-document' });
  assert.equal(popup.count.textContent, 2);
});

test('keeps the current pending update when an older document update arrives later', () => {
  const popup = delayedCountPopup();
  popup.live({ type: 'tfx-blocked-count-updated', blockedCount: 3, documentToken: 'current-document' });
  popup.live({ type: 'tfx-blocked-count-updated', blockedCount: 8, documentToken: 'previous-document' });
  popup.respond({ blockedCount: 1, documentToken: 'current-document' });
  assert.equal(popup.count.textContent, 3);
});

test('rejects late document updates after the current document has no receiver', () => {
  const popup = delayedCountPopup();
  popup.respond(undefined, { message: 'Receiving end does not exist' });
  popup.live({ type: 'tfx-blocked-count-updated', blockedCount: 8, documentToken: 'previous-document' });
  assert.equal(popup.count.textContent, 0);
});

test('re-establishes the document token after a full reload', () => {
  const popup = delayedCountPopup();
  popup.respond({ blockedCount: 2, documentToken: 'first-document' });
  popup.updated('loading');
  popup.live({ type: 'tfx-blocked-count-updated', blockedCount: 1, documentToken: 'second-document' });
  popup.updated('complete');
  popup.respond({ blockedCount: 0, documentToken: 'second-document' });
  assert.equal(popup.count.textContent, 1);
});

test('accepts the current live update after a startup no-receiver retry', () => {
  const popup = delayedCountPopup();
  popup.respond(undefined, { message: 'Receiving end does not exist' });
  popup.live({ type: 'tfx-blocked-count-updated', blockedCount: 4, documentToken: 'current-document' });
  popup.runTimer();
  popup.respond({ blockedCount: 0, documentToken: 'current-document' });
  assert.equal(popup.count.textContent, 4);
});

test('settles at zero after bounded no-receiver retries', () => {
  const popup = delayedCountPopup();
  for (let attempt = 0; attempt < 4; attempt++) {
    popup.respond(undefined, { message: 'Receiving end does not exist' });
    if (attempt < 3) popup.runTimer();
  }
  popup.live({ type: 'tfx-blocked-count-updated', blockedCount: 8, documentToken: 'previous-document' });
  assert.equal(popup.count.textContent, 0);
});
