import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

class FakeXHR {
  addEventListener() {}
}
FakeXHR.prototype.open = function () {};
FakeXHR.prototype.send = function () {};

test('a partial duplicate cannot overwrite an explicit paid classification', async () => {
  const messages = [];
  const payload = {
    entries: [
      {
        core: { screen_name: 'xiaoming_xxx' },
        is_blue_verified: true,
        verification: { verified: false },
      },
      {
        core: { screen_name: 'xiaoming_xxx' },
      },
    ],
  };
  const response = {
    url: 'https://x.com/i/api/graphql/timeline',
    clone: () => ({ text: async () => JSON.stringify(payload) }),
  };
  const window = {
    fetch: async () => response,
    postMessage: message => messages.push(message),
  };
  const context = {
    console,
    localStorage: { getItem: () => null },
    Map,
    Object,
    window,
    XMLHttpRequest: FakeXHR,
  };

  const source = fs.readFileSync(new URL('../inject.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, context);
  await window.fetch('https://x.com/i/api/graphql/timeline');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(messages.length, 1);
  assert.equal(messages[0].users.xiaoming_xxx, 'paid');
});

test('forwards made_with_ai post IDs to the content script', async () => {
  const messages = [];
  const payload = {
    data: {
      tweet: {
        rest_id: '2098607063819767842',
        made_with_ai: true,
      },
    },
  };
  const response = {
    url: 'https://x.com/i/api/graphql/timeline',
    clone: () => ({ text: async () => JSON.stringify(payload) }),
  };
  const window = {
    fetch: async () => response,
    postMessage: message => messages.push(message),
  };
  const context = {
    console,
    localStorage: { getItem: () => null },
    Map,
    Object,
    window,
    XMLHttpRequest: FakeXHR,
  };

  const source = fs.readFileSync(new URL('../inject.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, context);
  await window.fetch('https://x.com/i/api/graphql/timeline');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(messages.length, 1);
  assert.equal(messages[0].aiPosts['2098607063819767842'], true);
});
