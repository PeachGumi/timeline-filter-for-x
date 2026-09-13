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
    URL,
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

test('an explicit false fragment cannot overwrite a stronger paid record', async () => {
  const messages = [];
  const response = {
    url: 'https://x.com/i/api/graphql/timeline',
    clone: () => ({ text: async () => JSON.stringify({ entries: [
      { core: { screen_name: 'paid_user' }, is_blue_verified: true, verified_type: 'Blue' },
      { core: { screen_name: 'paid_user' }, is_blue_verified: false },
    ] }) }),
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
    URL,
    window,
    XMLHttpRequest: FakeXHR,
  };

  const source = fs.readFileSync(new URL('../inject.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, context);
  await window.fetch('https://x.com/i/api/graphql/timeline');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(messages[0].users.paid_user, 'paid');
});

test('a blue-only fragment cannot overwrite a stronger Business record', async () => {
  const messages = [];
  const response = {
    url: 'https://x.com/i/api/graphql/timeline',
    clone: () => ({ text: async () => JSON.stringify({ entries: [
      { core: { screen_name: 'business_user' }, is_blue_verified: true, verified_type: 'Business' },
      { core: { screen_name: 'business_user' }, is_blue_verified: true },
    ] }) }),
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
    URL,
    window,
    XMLHttpRequest: FakeXHR,
  };

  const source = fs.readFileSync(new URL('../inject.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, context);
  await window.fetch('https://x.com/i/api/graphql/timeline');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(messages[0].users.business_user, 'other');
});

test('a None type cannot shadow a nested Business type', async () => {
  const messages = [];
  const response = {
    url: 'https://x.com/i/api/graphql/timeline',
    clone: () => ({ text: async () => JSON.stringify({
      core: { screen_name: 'business_user' },
      is_blue_verified: true,
      verified_type: 'None',
      verification: { verified_type: 'business' },
    }) }),
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
    URL,
    window,
    XMLHttpRequest: FakeXHR,
  };

  const source = fs.readFileSync(new URL('../inject.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, context);
  await window.fetch(response.url);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(messages[0].users.business_user, 'other');
});

test('a weaker later response cannot overwrite a stronger Business record', async () => {
  const messages = [];
  let payload = {
    core: { screen_name: 'business_user' },
    is_blue_verified: true,
    verified_type: 'Business',
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
    URL,
    window,
    XMLHttpRequest: FakeXHR,
  };

  const source = fs.readFileSync(new URL('../inject.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, context);
  await window.fetch(response.url);
  await new Promise(resolve => setImmediate(resolve));

  payload = { core: { screen_name: 'business_user' }, is_blue_verified: true };
  await window.fetch(response.url);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(messages.length, 1);
  assert.equal(messages[0].users.business_user, 'other');
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
    URL,
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

test('forwards tweet language codes to the content script', async () => {
  const messages = [];
  const payload = {
    data: {
      tweet: {
        rest_id: '2098600810179358878',
        legacy: { lang: 'pt' },
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
    URL,
    window,
    XMLHttpRequest: FakeXHR,
  };

  const source = fs.readFileSync(new URL('../inject.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, context);
  await window.fetch('https://x.com/i/api/graphql/timeline');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(messages.length, 1);
  assert.equal(messages[0].languages['2098600810179358878'], 'pt');
});

test('classifies REST v2 type-only blue users', async () => {
  const messages = [];
  const response = {
    url: 'https://api.x.com/2/users/2244994945',
    clone: () => ({ text: async () => JSON.stringify({
      id: '2244994945',
      username: 'rest_paid_user',
      verified_type: 'blue',
    }) }),
  };
  const window = {
    location: { href: 'https://x.com/home' },
    fetch: async () => response,
    postMessage: message => messages.push(message),
  };
  const context = {
    console,
    localStorage: { getItem: () => null },
    Map,
    Object,
    URL,
    window,
    XMLHttpRequest: FakeXHR,
  };

  const source = fs.readFileSync(new URL('../inject.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, context);
  await window.fetch(response.url);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(messages[0]?.users.rest_paid_user, 'paid');
});

test('classifies REST v2 paid users', async () => {
  const messages = [];
  const response = {
    url: 'https://api.x.com/2/users/2244994945',
    clone: () => ({ text: async () => JSON.stringify({
      id: '2244994945',
      username: 'rest_paid_user',
      verified: true,
      verified_type: 'blue',
    }) }),
  };
  const window = {
    location: { href: 'https://x.com/home' },
    fetch: async () => response,
    postMessage: message => messages.push(message),
  };
  const context = {
    console,
    localStorage: { getItem: () => null },
    Map,
    Object,
    URL,
    window,
    XMLHttpRequest: FakeXHR,
  };

  const source = fs.readFileSync(new URL('../inject.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, context);
  await window.fetch(response.url);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(messages[0]?.users.rest_paid_user, 'paid');
});

test('forwards REST-style id language codes to the content script', async () => {
  const messages = [];
  const response = {
    url: 'https://api.x.com/2/tweets/2098600810179358878',
    clone: () => ({ text: async () => JSON.stringify({
      id: '2098600810179358878',
      lang: 'en',
    }) }),
  };
  const window = {
    location: { href: 'https://x.com/home' },
    fetch: async () => response,
    postMessage: message => messages.push(message),
  };
  const context = {
    console,
    localStorage: { getItem: () => null },
    Map,
    Object,
    URL,
    window,
    XMLHttpRequest: FakeXHR,
  };

  const source = fs.readFileSync(new URL('../inject.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, context);
  await window.fetch(response.url);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(messages[0]?.languages['2098600810179358878'], 'en');
});

test('forwards language data from XHR JSON responses', () => {
  const messages = [];
  class WorkingXHR {
    addEventListener(type, handler) {
      if (type === 'load') this.loadHandler = handler;
    }
  }
  WorkingXHR.prototype.open = function () {};
  WorkingXHR.prototype.send = function () { this.loadHandler(); };

  const window = {
    location: { href: 'https://x.com/home' },
    fetch: async () => ({ url: '', clone: () => ({ text: async () => '' }) }),
    postMessage: message => messages.push(message),
  };
  const context = {
    console,
    localStorage: { getItem: () => null },
    Map,
    Object,
    URL,
    window,
    XMLHttpRequest: WorkingXHR,
  };

  const source = fs.readFileSync(new URL('../inject.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, context);
  const xhr = new WorkingXHR();
  xhr.responseType = 'json';
  xhr.response = { rest_id: '2098600810179358878', legacy: { lang: 'pt' } };
  xhr.open('GET', 'https://x.com/i/api/graphql/timeline');
  xhr.send();

  assert.equal(messages[0]?.languages['2098600810179358878'], 'pt');
});

test('does not inspect unrecognized X subdomains', async () => {
  let cloned = false;
  const response = {
    url: 'https://unrecognized.x.com/api/events',
    clone: () => {
      cloned = true;
      return { text: async () => '{}' };
    },
  };
  const window = {
    fetch: async () => response,
    postMessage() {},
  };
  const context = {
    console,
    localStorage: { getItem: () => null },
    Map,
    Object,
    URL,
    window,
    XMLHttpRequest: FakeXHR,
  };

  const source = fs.readFileSync(new URL('../inject.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, context);
  await window.fetch(response.url);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(cloned, false);
});

test('does not inspect cross-origin API responses requested by the X page', async () => {
  const messages = [];
  let cloned = false;
  const response = {
    url: 'https://analytics.example/api/events',
    clone: () => {
      cloned = true;
      return { text: async () => JSON.stringify({
        core: { screen_name: 'not_x_data' },
        is_blue_verified: true,
      }) };
    },
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
    URL,
    window,
    XMLHttpRequest: FakeXHR,
  };

  const source = fs.readFileSync(new URL('../inject.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, context);
  await window.fetch('https://analytics.example/api/events');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(cloned, false);
  assert.equal(messages.length, 0);
});

test('bounds primitive property traversal', async () => {
  const messages = [];
  const oversizedPayload = {};
  for (let index = 0; index < 100_001; index++) oversizedPayload[`p${index}`] = index;
  oversizedPayload.lateUser = {
    core: { screen_name: 'late_paid_user' },
    is_blue_verified: true,
  };
  const response = {
    url: 'https://x.com/i/api/graphql/timeline',
    clone: () => ({ text: async () => JSON.stringify(oversizedPayload) }),
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
    URL,
    window,
    XMLHttpRequest: FakeXHR,
  };

  const source = fs.readFileSync(new URL('../inject.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, context);
  await window.fetch(response.url);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(messages.length, 0);
});

test('bounds recursive harvesting of already-parsed responses', async () => {
  const messages = [];
  const oversizedPayload = Array.from({ length: 100_001 }, () => ({}));
  oversizedPayload.push({
    core: { screen_name: 'late_paid_user' },
    is_blue_verified: true,
  });
  const response = {
    url: 'https://x.com/i/api/graphql/timeline',
    clone: () => ({ text: async () => JSON.stringify(oversizedPayload) }),
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
    URL,
    window,
    XMLHttpRequest: FakeXHR,
  };

  const source = fs.readFileSync(new URL('../inject.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, context);
  await window.fetch(response.url);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(messages.length, 0);
});

test('bounds each classification message', async () => {
  const messages = [];
  const tweets = Array.from({ length: 20_000 }, (_, index) => ({
    rest_id: String(2098600810179300000n + BigInt(index)),
    lang: 'en',
  }));
  const response = {
    url: 'https://x.com/i/api/graphql/timeline',
    clone: () => ({ text: async () => JSON.stringify(tweets) }),
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
    URL,
    window,
    XMLHttpRequest: FakeXHR,
  };

  const source = fs.readFileSync(new URL('../inject.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, context);
  await window.fetch(response.url);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(Object.keys(messages[0].languages).length, 10_000);
});

test('bounds replay caches to the most recent classifications', async () => {
  const messages = [];
  let pageMessageHandler;
  const tweets = Array.from({ length: 10_001 }, (_, index) => ({
    rest_id: String(2098600810179300000n + BigInt(index)),
    lang: 'en',
  }));
  const response = {
    url: 'https://x.com/i/api/graphql/timeline',
    clone: () => ({ text: async () => JSON.stringify(tweets) }),
  };
  const window = {
    fetch: async () => response,
    postMessage: message => messages.push(message),
    addEventListener(type, handler) {
      if (type === 'message') pageMessageHandler = handler;
    },
  };
  const context = {
    console,
    localStorage: { getItem: () => null },
    Map,
    Object,
    URL,
    window,
    XMLHttpRequest: FakeXHR,
  };

  const source = fs.readFileSync(new URL('../inject.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, context);
  await window.fetch(response.url);
  await new Promise(resolve => setImmediate(resolve));
  messages.length = 0;
  pageMessageHandler({ source: window, data: { source: 'tfx-content-ready' } });

  const firstId = '2098600810179300000';
  const lastId = String(2098600810179300000n + 10_000n);
  assert.equal(messages[0].languages[firstId], undefined);
  assert.equal(messages[0].languages[lastId], 'en');
});

test('replays classifications when the content script becomes ready', async () => {
  const messages = [];
  let pageMessageHandler;
  const payload = {
    user: { core: { screen_name: 'paid_user' }, is_blue_verified: true },
    tweet: { rest_id: '2098607063819767842', made_with_ai: true, lang: 'en' },
  };
  const response = {
    url: 'https://x.com/i/api/graphql/timeline',
    clone: () => ({ text: async () => JSON.stringify(payload) }),
  };
  const window = {
    fetch: async () => response,
    postMessage: message => messages.push(message),
    addEventListener(type, handler) {
      if (type === 'message') pageMessageHandler = handler;
    },
  };
  const context = {
    console,
    localStorage: { getItem: () => null },
    Map,
    Object,
    URL,
    window,
    XMLHttpRequest: FakeXHR,
  };

  const source = fs.readFileSync(new URL('../inject.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, context);
  await window.fetch('https://x.com/i/api/graphql/timeline');
  await new Promise(resolve => setImmediate(resolve));
  messages.length = 0;

  pageMessageHandler({ source: window, data: { source: 'tfx-content-ready' } });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].users.paid_user, 'paid');
  assert.equal(messages[0].aiPosts['2098607063819767842'], true);
  assert.equal(messages[0].languages['2098607063819767842'], 'en');
});
