import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function makeArticle({ handle = '', tweetId = '', aiLabel = '', mediaMarker = false, adWrapper = false } = {}) {
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
    querySelectorAll: (selector) => {
      if (selector === '[aria-label], span' && aiLabel) {
        return [{
          textContent: aiLabel,
          getAttribute: () => null,
          closest: () => null,
        }];
      }
      return [];
    },
    querySelector: (selector) => {
      if (selector === '[data-testid="User-Name"]') return header;
      if (selector === '[data-testid="placementTracking"]' && mediaMarker) return {};
      if (selector === 'time' && tweetId) {
        return { closest: () => ({ getAttribute: () => `/${handle}/status/${tweetId}` }) };
      }
      return null;
    },
  };
}

function runContent({ pathname = '/home', articles, users = {}, storage = { isHiding: true }, messageData = {} }) {
  const source = fs.readFileSync(new URL('../content.js', import.meta.url), 'utf8');
  let messageHandler;
  const context = {
    chrome: {
      storage: {
        local: { set() {} },
        onChanged: { addListener() {} },
        sync: { get(_key, callback) { callback(storage); } },
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
    location: { pathname },
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
  messageHandler({ source: context.window, data: { source: 'hvu', users, ...messageData } });
}

test('hides a paid account but keeps an unverified placement-tracked video', () => {
  const normalVideo = makeArticle({ handle: 'love___not_', mediaMarker: true, adWrapper: true });
  const paidPost = makeArticle({ handle: 'paid_user' });
  runContent({
    articles: [normalVideo, paidPost],
    users: { paid_user: 'paid', love___not_: 'other' },
  });

  assert.equal(normalVideo.classList.contains('hvu-hidden'), false);
  assert.equal(paidPost.classList.contains('hvu-hidden'), true);
});

test('keeps the linked post visible but filters paid replies on a status page', () => {
  const linkedPost = makeArticle({ handle: 'paid_user', tweetId: '2098574607339159828' });
  const paidReply = makeArticle({ handle: 'paid_reply', tweetId: '2098574607339159829' });
  runContent({
    pathname: '/paid_user/status/2098574607339159828',
    articles: [linkedPost, paidReply],
    users: { paid_user: 'paid', paid_reply: 'paid' },
  });

  assert.equal(linkedPost.classList.contains('hvu-hidden'), false);
  assert.equal(paidReply.classList.contains('hvu-hidden'), true);
});

test('hides AI-labeled posts only when the option is enabled', () => {
  const enabledPost = makeArticle({ handle: 'ner2048', tweetId: '2098607063819767842' });
  runContent({
    articles: [enabledPost],
    storage: { isHiding: false, hideAiGenerated: true },
    messageData: { aiPosts: { '2098607063819767842': true } },
  });

  const disabledPost = makeArticle({ handle: 'ner2048', tweetId: '2098607063819767842' });
  runContent({
    articles: [disabledPost],
    storage: { isHiding: true, hideAiGenerated: false },
    messageData: { aiPosts: { '2098607063819767842': true } },
  });

  assert.equal(enabledPost.classList.contains('hvu-hidden'), true);
  assert.equal(disabledPost.classList.contains('hvu-hidden'), false);
});

test('recognizes the visible Japanese AI label when API data is absent', () => {
  const aiPost = makeArticle({ handle: 'ner2048', tweetId: '2098607063819767842', aiLabel: 'AIで生成' });
  runContent({
    articles: [aiPost],
    storage: { isHiding: true, hideAiGenerated: true },
  });

  assert.equal(aiPost.classList.contains('hvu-hidden'), true);
});
