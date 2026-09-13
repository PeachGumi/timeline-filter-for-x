import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function makeArticle({ handle = '', tweetId = '', tweetIds = null, statusLinks = null, statusLinkOnly = false, text = '', textContainer = true, collapseTextWhenHidden = false, aiLabel = '', translationSource = '', quotedTranslationSource = '', mediaMarker = false, adWrapper = false } = {}) {
  const classes = new Set();
  const header = {
    querySelectorAll: () => handle ? [{ getAttribute: () => `/${handle}` }] : [],
    textContent: '',
  };
  return {
    get innerText() {
      return collapseTextWhenHidden && classes.has('hvu-hidden') ? '' : text;
    },
    textContent: text,
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
        if (statusLinks) {
          return statusLinks.map((link) => ({
            getAttribute: () => `/${link.handle}/status/${link.id}`,
          }));
        }
        return (tweetIds || (tweetId ? [tweetId] : [])).map((id) => ({
          getAttribute: () => `/${handle}/status/${id}`,
        }));
      }
      if (selector === '[aria-label], span') {
        const elements = [];
        if (aiLabel) elements.push({ textContent: aiLabel, getAttribute: () => null, closest: () => null });
        if (translationSource) elements.push({
          textContent: `${translationSource}からの翻訳`,
          getAttribute: () => null,
          closest: () => null,
        });
        if (quotedTranslationSource) elements.push({
          textContent: `${quotedTranslationSource}からの翻訳`,
          getAttribute: () => null,
          closest: (closestSelector) => closestSelector === '[role="link"]' ? {} : null,
        });
        return elements;
      }
      return [];
    },
    querySelector: (selector) => {
      if (selector === '[data-testid="User-Name"]') return header;
      if (selector === 'div[dir="auto"]' && text && textContainer) return { textContent: text };
      if (selector === '[data-testid="placementTracking"]' && mediaMarker) return {};
      if (selector === 'time' && tweetId && !statusLinkOnly) {
        return { closest: () => ({ getAttribute: () => `/${handle}/status/${tweetId}` }) };
      }
      return null;
    },
  };
}

function runContent({ pathname = '/home', articles, users = {}, storage = { isHiding: true }, messageData = {}, detectedLanguage = null, detectedResult = null }) {
  const source = fs.readFileSync(new URL('../content.js', import.meta.url), 'utf8');
  let messageHandler;
  const context = {
    chrome: {
      i18n: {
        detectLanguage(_text, callback) {
          const result = detectedResult || (detectedLanguage && { isReliable: true, languages: [{ language: detectedLanguage, percentage: 100 }] });
          if (result) setImmediate(() => callback(result));
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
  return (data) => messageHandler({ source: context.window, data: { source: 'hvu', ...data } });
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

test('hides an X-translated foreign post even when the visible text is Japanese', () => {
  const translatedPost = makeArticle({
    handle: 'OutofOces',
    tweetId: '2098805946738774191',
    text: 'タッチコントロールを使うくらいなら、親指を切断してもらった方がマシだ。',
    translationSource: 'スペイン語',
  });
  runContent({
    articles: [translatedPost],
    storage: { isHiding: false, hideForeignLanguage: true },
    detectedLanguage: 'ja',
  });

  assert.equal(translatedPost.classList.contains('hvu-hidden'), true);
});

test('does not classify a Japanese outer post from a translated quote label', () => {
  const japaneseQuotePost = makeArticle({
    handle: 'jp_user',
    tweetId: '2098805946738774192',
    text: 'これは日本語の投稿です。',
    quotedTranslationSource: '英語',
  });
  runContent({
    articles: [japaneseQuotePost],
    storage: { isHiding: false, hideForeignLanguage: true },
    detectedLanguage: 'ja',
  });

  assert.equal(japaneseQuotePost.classList.contains('hvu-hidden'), false);
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

test('locally detects a foreign article before X adds its status link', async () => {
  const foreignPost = makeArticle({
    handle: 'richharvin',
    text: 'Lil Durk is out!! 🎉',
  });
  runContent({
    articles: [foreignPost],
    storage: { isHiding: false, hideForeignLanguage: true },
    detectedResult: { isReliable: false, languages: [{ language: 'en', percentage: 100 }] },
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(foreignPost.classList.contains('hvu-hidden'), true);
});

test('does not hide short kanji-only Japanese text on an unreliable local result', async () => {
  const japanesePost = makeArticle({ handle: 'jp_user', text: '東京株式市場' });
  runContent({
    articles: [japanesePost],
    storage: { isHiding: false, hideForeignLanguage: true },
    detectedResult: { isReliable: false, languages: [{ language: 'zh', percentage: 100 }] },
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(japanesePost.classList.contains('hvu-hidden'), false);
});

test('keeps a locally detected foreign article hidden across later rechecks', async () => {
  const foreignPost = makeArticle({
    handle: 'richharvin',
    text: 'Lil Durk is out!! 🎉',
    textContainer: false,
    collapseTextWhenHidden: true,
  });
  const dispatch = runContent({
    articles: [foreignPost],
    storage: { isHiding: false, hideForeignLanguage: true },
    detectedResult: { isReliable: false, languages: [{ language: 'en', percentage: 100 }] },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(foreignPost.classList.contains('hvu-hidden'), true);

  dispatch({ users: { another_user: 'other' } });
  assert.equal(foreignPost.classList.contains('hvu-hidden'), true);
});

test('uses the outer author status ID instead of a quoted post ID', () => {
  const foreignQuotePost = makeArticle({
    handle: 'SamErde',
    statusLinkOnly: true,
    statusLinks: [
      { handle: 'GsInfosystems', id: '2098428914704286121' },
      { handle: 'SamErde', id: '2098780362599956940' },
    ],
  });
  runContent({
    articles: [foreignQuotePost],
    storage: { isHiding: false, hideForeignLanguage: true },
    messageData: { languages: { '2098780362599956940': 'en' } },
  });

  assert.equal(foreignQuotePost.classList.contains('hvu-hidden'), true);
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
