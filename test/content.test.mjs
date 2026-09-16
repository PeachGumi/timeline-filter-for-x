import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function makeArticle({ handle = '', tweetId = '', tweetIds = null, statusLinks = null, statusLinkOnly = false, text = '', textContainer = true, domLanguage = '', collapseTextWhenHidden = false, aiLabel = '', quotedAiLabel = '', translationSource = '', quotedTranslationSource = '', mediaMarker = false, adWrapper = false } = {}) {
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
            closest: (closestSelector) => link.quoted && closestSelector === '[role="link"]' ? {} : null,
          }));
        }
        return (tweetIds || (tweetId ? [tweetId] : [])).map((id) => ({
          getAttribute: () => `/${handle}/status/${id}`,
        }));
      }
      if (selector === '[aria-label], span') {
        const elements = [];
        if (aiLabel) elements.push({ textContent: aiLabel, getAttribute: () => null, closest: () => null });
        if (quotedAiLabel) elements.push({
          textContent: quotedAiLabel,
          getAttribute: () => null,
          closest: (closestSelector) => closestSelector === '[role="link"]' ? {} : null,
        });
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
      if (selector === '[data-testid="tweetText"][lang]' && domLanguage) {
        return { getAttribute: () => domLanguage };
      }
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
  const postedMessages = [];
  let detectCalls = 0;
  const pageLocation = { pathname };
  const context = {
    chrome: {
      i18n: {
        detectLanguage(_text, callback) {
          detectCalls++;
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
    location: pageLocation,
    Map,
    MutationObserver: class { observe() {} },
    requestAnimationFrame: (callback) => callback(),
    window: {
      addEventListener(type, handler) {
        if (type === 'message') messageHandler = handler;
      },
      postMessage(message) { postedMessages.push(message); },
    },
  };
  context.window.window = context.window;
  vm.runInNewContext(source, context);
  messageHandler({ source: context.window, data: { source: 'hvu', users, ...messageData } });
  const dispatch = (data) => messageHandler({ source: context.window, data: { source: 'hvu', ...data } });

  dispatch.postedMessages = postedMessages;
  dispatch.detectCalls = () => detectCalls;
  // The X page is a SPA: route changes reuse the same articles.
  dispatch.setPath = (next) => { pageLocation.pathname = next; };
  return dispatch;
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

test('keeps followed accounts visible across every filter and reapplies after unfollow', () => {
  const followed = makeArticle({
    handle: 'followed_user',
    tweetId: '123456789',
    text: 'This is an English AI post',
    domLanguage: 'en',
    aiLabel: 'Made with AI',
  });
  const other = makeArticle({
    handle: 'other_user',
    tweetId: '123456790',
    text: 'This is another English AI post',
    domLanguage: 'en',
    aiLabel: 'Made with AI',
  });

  const dispatch = runContent({
    articles: [followed, other],
    users: { followed_user: 'paid', other_user: 'paid' },
    storage: { isHiding: true, hideAiGenerated: true, hideForeignLanguage: true },
    messageData: { following: { followed_user: true } },
  });

  assert.equal(followed.classList.contains('hvu-hidden'), false);
  assert.equal(other.classList.contains('hvu-hidden'), true);

  dispatch({ following: { followed_user: false } });
  assert.equal(followed.classList.contains('hvu-hidden'), true);
});

test('bounds forged following maps from the page', () => {
  const article = makeArticle({ handle: 'followed_user' });
  const following = Object.fromEntries(
    Array.from({ length: 10_000 }, (_, index) => [`x${index}`, true]),
  );
  following.followed_user = true;

  runContent({
    articles: [article],
    users: { followed_user: 'paid' },
    messageData: { following },
  });

  assert.equal(article.classList.contains('hvu-hidden'), true);
});

test('replaces followed exemptions from a complete relationship snapshot', () => {
  const article = makeArticle({ handle: 'followed_user' });
  const dispatch = runContent({
    articles: [article],
    users: { followed_user: 'paid' },
    messageData: { following: { followed_user: true }, followingSnapshot: true },
  });
  assert.equal(article.classList.contains('hvu-hidden'), false);

  const following = Object.fromEntries(
    Array.from({ length: 10_000 }, (_, index) => [`x${index}`, false]),
  );
  dispatch({ following, followingSnapshot: true });
  assert.equal(article.classList.contains('hvu-hidden'), true);
});


test('announces readiness so early API classifications can be replayed', () => {
  const dispatch = runContent({ articles: [] });

  assert.equal(dispatch.postedMessages.some(message => message.source === 'tfx-content-ready'), true);
});

test('leaves a profile page unfiltered and filters again once the reader leaves it', () => {
  const paidPost = makeArticle({
    handle: 'lemontea_star',
    tweetId: '2098574607339159828',
    text: 'This is an English AI post',
    domLanguage: 'en',
    aiLabel: 'Made with AI',
  });
  const dispatch = runContent({
    pathname: '/lemontea_star',
    articles: [paidPost],
    users: { lemontea_star: 'paid' },
    storage: { isHiding: true, hideAiGenerated: true, hideForeignLanguage: true },
  });
  assert.equal(paidPost.classList.contains('hvu-hidden'), false);

  dispatch.setPath('/home');
  dispatch({ users: { refresh_one: 'other' } });
  assert.equal(paidPost.classList.contains('hvu-hidden'), true);

  dispatch.setPath('/lemontea_star');
  dispatch({ users: { refresh_two: 'other' } });
  assert.equal(paidPost.classList.contains('hvu-hidden'), false);

  dispatch.setPath('/lemontea_star/status/2098574607339159828');
  dispatch({ users: { refresh_three: 'other' } });
  assert.equal(paidPost.classList.contains('hvu-hidden'), false);
});

test('filters paid replies again under a post opened from a profile', () => {
  const linkedPost = makeArticle({ handle: 'lemontea_star', tweetId: '2098574607339159828' });
  const paidReply = makeArticle({ handle: 'paid_user', tweetId: '2098574607339159829' });
  runContent({
    pathname: '/lemontea_star/status/2098574607339159828',
    articles: [linkedPost, paidReply],
    users: { lemontea_star: 'paid', paid_user: 'paid' },
  });

  assert.equal(linkedPost.classList.contains('hvu-hidden'), false);
  assert.equal(paidReply.classList.contains('hvu-hidden'), true);
});

test('keeps the posts tabs of a profile unfiltered as well', () => {
  for (const path of ['/lemontea_star/with_replies', '/lemontea_star/media', '/lemontea_star/likes']) {
    const paidPost = makeArticle({ handle: 'lemontea_star', tweetId: '2098574607339159828' });
    runContent({
      pathname: path,
      articles: [paidPost],
      users: { lemontea_star: 'paid' },
    });
    assert.equal(paidPost.classList.contains('hvu-hidden'), false, path);
  }
});

test('still filters routes that only look like a handle', () => {
  for (const path of ['/home', '/explore', '/search', '/notifications', '/i/web/status/2098574607339159827']) {
    const paidPost = makeArticle({ handle: 'paid_user', tweetId: '2098574607339159828' });
    runContent({
      pathname: path,
      articles: [paidPost],
      users: { paid_user: 'paid' },
    });
    assert.equal(paidPost.classList.contains('hvu-hidden'), true, path);
  }
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

test('keeps the linked post visible but filters AI-labeled replies', () => {
  const linkedPost = makeArticle({ handle: 'root_user', tweetId: '2098574607339159828' });
  const aiReply = makeArticle({ handle: 'reply_user', tweetId: '2098574607339159829', aiLabel: 'AIで生成' });
  runContent({
    pathname: '/root_user/status/2098574607339159828',
    articles: [linkedPost, aiReply],
    storage: { isHiding: false, hideAiGenerated: true },
  });

  assert.equal(linkedPost.classList.contains('hvu-hidden'), false);
  assert.equal(aiReply.classList.contains('hvu-hidden'), true);
});

test('keeps a linked quote post visible when its quoted post has another ID', () => {
  const linkedQuotePost = makeArticle({
    handle: 'tkzwgrs',
    tweetId: '2098569707494539578',
    tweetIds: ['2098569707494539578', '2098582777331605753'],
  });
  runContent({
    pathname: '/tkzwgrs/status/2098569707494539578',
    articles: [linkedQuotePost],
    users: { tkzwgrs: 'paid' },
  });

  assert.equal(linkedQuotePost.classList.contains('hvu-hidden'), false);
});

test('filters a paid reply that quotes the linked post', () => {
  const linkedPost = makeArticle({ handle: 'root_user', tweetId: '2098569707494539578' });
  const quotingReply = makeArticle({
    handle: 'paid_reply',
    statusLinks: [
      { handle: 'paid_reply', id: '2098569707494539579' },
      { handle: 'root_user', id: '2098569707494539578' },
    ],
  });
  runContent({
    pathname: '/root_user/status/2098569707494539578',
    articles: [linkedPost, quotingReply],
    users: { root_user: 'other', paid_reply: 'paid' },
  });

  assert.equal(linkedPost.classList.contains('hvu-hidden'), false);
  assert.equal(quotingReply.classList.contains('hvu-hidden'), true);
});

test('keeps a linked paid self-quote visible when the quoted link comes first', () => {
  const selfQuote = makeArticle({
    handle: 'root_user',
    statusLinks: [
      { handle: 'root_user', id: '2098569707494539500', quoted: true },
      { handle: 'root_user', id: '2098569707494539578' },
    ],
  });
  runContent({
    pathname: '/root_user/status/2098569707494539578',
    articles: [selfQuote],
    users: { root_user: 'paid' },
  });

  assert.equal(selfQuote.classList.contains('hvu-hidden'), false);
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

test('keeps posts with X pseudo-language codes visible', () => {
  const codes = ['und', 'qam', 'qct', 'qht', 'qme', 'qst', 'zxx'];
  const articles = codes.map((code, index) => makeArticle({
    handle: `user_${index}`,
    tweetId: String(2098600810179358900n + BigInt(index)),
  }));
  const languageMap = Object.fromEntries(articles.map((article, index) => [
    String(2098600810179358900n + BigInt(index)),
    codes[index],
  ]));
  runContent({
    articles,
    storage: { isHiding: false, hideForeignLanguage: true },
    messageData: { languages: languageMap },
  });

  for (const article of articles) {
    assert.equal(article.classList.contains('hvu-hidden'), false);
  }
});

test('does not hide short kanji-only text from a DOM zh result', () => {
  const japanesePost = makeArticle({
    handle: 'jp_user',
    tweetId: '2098600810179358997',
    text: '東京株式市場',
    domLanguage: 'zh',
  });
  runContent({
    articles: [japanesePost],
    storage: { isHiding: false, hideForeignLanguage: true },
  });

  assert.equal(japanesePost.classList.contains('hvu-hidden'), false);
});

test('does not hide short kanji-only text from an API zh result', () => {
  const japanesePost = makeArticle({
    handle: 'jp_user',
    tweetId: '2098600810179358998',
    text: '東京株式市場',
  });
  runContent({
    articles: [japanesePost],
    storage: { isHiding: false, hideForeignLanguage: true },
    messageData: { languages: { '2098600810179358998': 'zh' } },
  });

  assert.equal(japanesePost.classList.contains('hvu-hidden'), false);
});

test('does not override an explicit unknown API language with DOM lang', () => {
  const unknownPost = makeArticle({
    handle: 'unknown_user',
    tweetId: '2098600810179358999',
    text: 'Hello',
    domLanguage: 'en',
  });
  runContent({
    articles: [unknownPost],
    storage: { isHiding: false, hideForeignLanguage: true },
    messageData: { languages: { '2098600810179358999': 'und' } },
  });

  assert.equal(unknownPost.classList.contains('hvu-hidden'), false);
});

test('bounds content classification caches to recent entries', () => {
  const firstId = '2098600810179300000';
  const oldestPost = makeArticle({ handle: 'old_user', tweetId: firstId });
  const languages = Object.fromEntries(Array.from({ length: 10_000 }, (_, index) => [
    String(2098600810179300000n + BigInt(index)),
    'en',
  ]));
  const dispatch = runContent({
    articles: [oldestPost],
    storage: { isHiding: false, hideForeignLanguage: true },
    messageData: { languages },
  });
  dispatch({ languages: { '2098600810179310000': 'en' } });

  assert.equal(oldestPost.classList.contains('hvu-hidden'), false);
});

test('prefers X API language over translated DOM lang', () => {
  const translatedPost = makeArticle({
    handle: 'foreign_user',
    tweetId: '2098600810179358890',
    text: '日本語へ翻訳された本文',
    domLanguage: 'ja',
  });
  runContent({
    articles: [translatedPost],
    storage: { isHiding: false, hideForeignLanguage: true },
    messageData: { languages: { '2098600810179358890': 'en' } },
  });

  assert.equal(translatedPost.classList.contains('hvu-hidden'), true);
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

test('combines language and AI filters while preserving an /i/web/status root post', () => {
  const linkedPost = makeArticle({
    handle: 'root_user',
    tweetId: '2098600810179358878',
    aiLabel: 'Made with AI',
  });
  const aiReply = makeArticle({
    handle: 'ai_reply',
    tweetId: '2098600810179358879',
    text: 'これは日本語の返信です。',
    aiLabel: 'Made with AI',
  });
  const foreignReply = makeArticle({
    handle: 'foreign_reply',
    tweetId: '2098600810179358880',
  });
  runContent({
    pathname: '/i/web/status/2098600810179358878',
    articles: [linkedPost, aiReply, foreignReply],
    storage: { isHiding: false, hideAiGenerated: true, hideForeignLanguage: true },
    messageData: {
      languages: {
        '2098600810179358878': 'en',
        '2098600810179358879': 'ja',
        '2098600810179358880': 'en',
      },
    },
  });

  assert.equal(linkedPost.classList.contains('hvu-hidden'), false);
  assert.equal(aiReply.classList.contains('hvu-hidden'), true);
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

test('does not classify a Japanese outer post from an AI label in its quote card', () => {
  const japaneseQuotePost = makeArticle({
    handle: 'jp_user',
    tweetId: '2098805946738774193',
    text: 'これは日本語の投稿です。',
    quotedAiLabel: 'Made with AI',
  });
  runContent({
    articles: [japaneseQuotePost],
    storage: { isHiding: false, hideAiGenerated: true },
  });

  assert.equal(japaneseQuotePost.classList.contains('hvu-hidden'), false);
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

test('does not hide short kanji-only Japanese text on a reliable zh result', async () => {
  const japanesePost = makeArticle({ handle: 'jp_user', text: '東京株式市場' });
  runContent({
    articles: [japanesePost],
    storage: { isHiding: false, hideForeignLanguage: true },
    detectedResult: { isReliable: true, languages: [{ language: 'zh', percentage: 100 }] },
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(japanesePost.classList.contains('hvu-hidden'), false);
});

test('caches an ambiguous local language result for unchanged text', async () => {
  const ambiguousPost = makeArticle({ handle: 'short_user', text: '東京株式市場' });
  const dispatch = runContent({
    articles: [ambiguousPost],
    storage: { isHiding: false, hideForeignLanguage: true },
    detectedResult: { isReliable: true, languages: [{ language: 'zh', percentage: 100 }] },
  });
  await new Promise(resolve => setImmediate(resolve));

  dispatch({ users: { first_user: 'other' } });
  dispatch({ users: { second_user: 'other' } });
  dispatch({ users: { third_user: 'other' } });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(dispatch.detectCalls(), 1);
  assert.equal(ambiguousPost.classList.contains('hvu-hidden'), false);
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
