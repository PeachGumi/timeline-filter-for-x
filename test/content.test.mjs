import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function makeArticle({ handle = '', tweetId = '', tweetIds = null, statusLinkOnly = false, text = '', aiLabel = '', mediaMarker = false, adWrapper = false } = {}) {
  const classes = new Set();
  const header = {
    querySelectorAll: () => handle ? [{ getAttribute: () => `/${handle}` }] : [],
    textContent: '',
  };
  return {
    innerText: text,
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    },
    closest: (selector) =>
      selector === '[data-testid="placementTracking"]' && adWrapper ? {} : null,
    querySelectorAll: (selector) => {
      if (selector === 'time') {
        if (statusLinkOnly) return [];
        return (tweetIds || (tweetId ? [tweetId] : [])).map((id) => ({
          closest: () => ({ getAttribute: () => `/${handle}/status/${id}` }),
        }));
      }
      if (selector === 'a[href*="/status/"]') {
        return (tweetIds || (tweetId ? [tweetId] : [])).map((id) => ({
          getAttribute: () => `/${handle}/status/${id}`,
        }));
      }
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
      if (selector === 'time' && tweetId && !statusLinkOnly) {
        return { closest: () => ({ getAttribute: () => `/${handle}/status/${tweetId}` }) };
      }
      return null;
    },
  };
}

function runContent({ pathname = '/home', articles, users = {}, storage = { isHiding: true }, messageData = {}, detectedLanguage = null }) {
  const source = fs.readFileSync(new URL('../content.js', import.meta.url), 'utf8');
  let messageHandler;
  const context = {
    chrome: {
      i18n: {
        detectLanguage(_text, callback) {
          if (detectedLanguage) setImmediate(() => callback({ isReliable: true, languages: [{ language: detectedLanguage, percentage: 100 }] }));
        },
      },
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

test('keeps a linked quote post visible when its quoted post has another ID', () => {
  const linkedQuotePost = makeArticle({
    handle: 'tkzwgrs',
    tweetId: '2098569707494539578',
    tweetIds: ['2098569707494539578', '2098582777331605753'],
  });
  runContent({
    pathname: '/tkzwgrs/status/2098582777331605753',
    articles: [linkedQuotePost],
    users: { tkzwgrs: 'paid' },
  });

  assert.equal(linkedQuotePost.classList.contains('hvu-hidden'), false);
});

test('hides foreign-language posts but keeps Japanese posts when enabled', () => {
  const foreignPost = makeArticle({ handle: 'caralhodog', tweetId: '2098600810179358878' });
  const japanesePost = makeArticle({ handle: 'jp_user', tweetId: '2098600810179358879' });
  const unknownPost = makeArticle({ handle: 'unknown_user', tweetId: '2098600810179358881' });
  runContent({
    articles: [foreignPost, japanesePost, unknownPost],
    storage: { isHiding: false, hideForeignLanguage: true },
    messageData: {
      languages: {
        '2098600810179358878': 'pt',
        '2098600810179358879': 'ja',
        '2098600810179358881': 'und',
      },
    },
  });

  assert.equal(foreignPost.classList.contains('hvu-hidden'), true);
  assert.equal(japanesePost.classList.contains('hvu-hidden'), false);
  assert.equal(unknownPost.classList.contains('hvu-hidden'), false);
});

test('keeps the linked foreign post visible but filters foreign replies', () => {
  const linkedPost = makeArticle({ handle: 'caralhodog', tweetId: '2098600810179358878' });
  const foreignReply = makeArticle({ handle: 'foreign_reply', tweetId: '2098600810179358880' });
  runContent({
    pathname: '/caralhodog/status/2098600810179358878',
    articles: [linkedPost, foreignReply],
    storage: { isHiding: false, hideForeignLanguage: true },
    messageData: {
      languages: {
        '2098600810179358878': 'pt',
        '2098600810179358880': 'en',
      },
    },
  });

  assert.equal(linkedPost.classList.contains('hvu-hidden'), false);
  assert.equal(foreignReply.classList.contains('hvu-hidden'), true);
});

test('hides a foreign post whose modern X markup has a status link but no time element', () => {
  const foreignPost = makeArticle({
    handle: 'shriii_raut',
    tweetId: '2098457357617648028',
    statusLinkOnly: true,
  });
  runContent({
    articles: [foreignPost],
    storage: { isHiding: false, hideForeignLanguage: true },
    messageData: { languages: { '2098457357617648028': 'en' } },
  });

  assert.equal(foreignPost.classList.contains('hvu-hidden'), true);
});

test('locally detects foreign text when X provides no language metadata', async () => {
  const foreignPost = makeArticle({
    handle: 'shriii_raut',
    tweetId: '2098457357617648028',
    statusLinkOnly: true,
    text: 'Always re-watch your favourite movies at different stages of your life.',
  });
  runContent({
    articles: [foreignPost],
    storage: { isHiding: false, hideForeignLanguage: true },
    detectedLanguage: 'en',
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(foreignPost.classList.contains('hvu-hidden'), true);
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
