// Timeline Filter for X — content script (isolated world)
// Hides posts from accounts that PAY for verification (X Premium individuals),
// while leaving gold (Business), grey (Government) and legacy badges alone.
//
// The paid/not-paid signal isn't in the rendered HTML, so inject.js (MAIN world)
// reads X's API traffic and posts us a handle -> status map. We match each post's
// author handle against that map.
(() => {
  const HIDE_CLASS = "hvu-hidden";
  const TWEET_SELECTOR = "article";
  const MAX_CACHE_ENTRIES = 10_000;
  const DEBUG = () => {
    try { return localStorage.getItem("hvu-debug") === "1"; } catch (_) { return false; }
  };
  const log = (...a) => DEBUG() && console.log("[HVU/content]", ...a);

  let isHiding = false;
  let hideAiGenerated = false;
  let hideForeignLanguage = false;
  let blockedCount = 0;
  const status = new Map(); // lowercased handle -> "paid" | "other"
  const aiPostIds = new Set();
  const languages = new Map(); // tweet ID -> X language code
  const localLanguages = new WeakMap(); // article -> { body, language }
  const pendingLanguageBodies = new WeakMap(); // article -> body being detected

  function setBounded(map, key, value) {
    if (map.has(key)) map.delete(key);
    while (map.size >= MAX_CACHE_ENTRIES) map.delete(map.keys().next().value);
    map.set(key, value);
  }

  function addBounded(set, value) {
    while (set.size >= MAX_CACHE_ENTRIES) set.delete(set.values().next().value);
    set.add(value);
  }

  const style = document.createElement("style");
  style.id = "hvu-style";
  style.textContent = `.${HIDE_CLASS} { display: none !important; }`;
  (document.head || document.documentElement).appendChild(style);

  // Pull the author handle (@name) out of a tweet article.
  function authorHandle(article) {
    const header = article.querySelector('[data-testid="User-Name"]') || article;
    // Profile links look like /handle or /handle/... — the first one in the
    // header is the author.
    const links = header.querySelectorAll('a[href^="/"]');
    for (const a of links) {
      const seg = a.getAttribute("href").split("/")[1];
      if (seg && /^[A-Za-z0-9_]{1,15}$/.test(seg)) return seg.toLowerCase();
    }
    // Fallback: an "@handle" text node.
    const m = header.textContent && header.textContent.match(/@([A-Za-z0-9_]{1,15})/);
    return m ? m[1].toLowerCase() : null;
  }

  function isPaid(article) {
    const handle = authorHandle(article);
    return handle ? status.get(handle) === "paid" : false;
  }

  function statusIds(article) {
    const ids = [];
    const addHref = (href) => {
      const match = href && href.match(/\/status\/(\d+)/);
      if (match && !ids.includes(match[1])) ids.push(match[1]);
    };

    for (const time of article.querySelectorAll("time")) {
      addHref(time.closest('a[href*="/status/"]')?.getAttribute("href"));
    }
    for (const link of article.querySelectorAll('a[href*="/status/"]')) {
      addHref(link.getAttribute("href"));
    }
    return ids;
  }

  function tweetId(article) {
    const author = authorHandle(article);
    if (author) {
      for (const link of article.querySelectorAll('a[href*="/status/"]')) {
        if (link.closest?.('[role="link"]')) continue;
        const href = link.getAttribute("href") || "";
        const match = href.match(/\/(?:https?:\/\/(?:www\.)?(?:x|twitter)\.com\/)?([A-Za-z0-9_]{1,15})\/status\/(\d+)/i);
        if (match && match[1].toLowerCase() === author) return match[2];
        const webStatus = href.match(/\/i\/web\/status\/(\d+)/i);
        if (webStatus) return webStatus[1];
      }
    }
    return statusIds(article)[0] || null;
  }


  function isAiGenerated(article) {
    const id = tweetId(article);
    if (id && aiPostIds.has(id)) return true;

    const labels = new Set(["AIで生成", "AI生成", "Made with AI", "AI-generated"]);
    for (const element of article.querySelectorAll('[aria-label], span')) {
      if (element.closest('[data-testid="tweetText"]') || element.closest('[role="link"]')) continue;
      const text = (element.getAttribute("aria-label") || element.textContent || "").trim();
      if (labels.has(text)) return true;
    }
    return false;
  }

  function postText(article) {
    return (
      article.querySelector('[data-testid="tweetText"]')?.textContent ||
      article.querySelector('div[dir="auto"]')?.textContent ||
      article.textContent ||
      ""
    ).trim();
  }

  function isTranslatedFromForeignLanguage(article) {
    for (const element of article.querySelectorAll('[aria-label], span')) {
      if (element.closest('[role="link"]')) continue;
      const label = (element.getAttribute("aria-label") || element.textContent || "").trim();
      const japaneseLabel = label.match(/^([^\s]{1,24}語)からの翻訳$/);
      if (japaneseLabel) return japaneseLabel[1] !== "日本語";
      const englishLabel = label.match(/^Translated from (.{1,32})$/i);
      if (englishLabel) return englishLabel[1].toLowerCase() !== "japanese";
    }
    return false;
  }

  function languageClassification(language) {
    if (!language) return null;
    const normalized = language.toLowerCase();
    if (["und", "qam", "qct", "qht", "qme", "qst", "zxx"].includes(normalized)) return false;
    return normalized !== "ja";
  }

  function isAmbiguousShortHan(body) {
    const han = body.match(/\p{Script=Han}/gu) || [];
    const nonHanText = body.replace(/[\p{Script=Han}\p{P}\p{S}\p{N}\s]/gu, "");
    return han.length > 0 && han.length <= 12 && !nonHanText;
  }

  function acceptedDetectedLanguage(body, result) {
    const top = result?.languages?.[0];
    if (!top?.language) return null;
    if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(body)) return "ja";

    const detected = top.language.toLowerCase();
    if (detected === "zh" && isAmbiguousShortHan(body)) {
      return null;
    }
    if (result.isReliable || detected === "ja") {
      return detected;
    }

    const distinctiveForeignScript = /\p{Script=Thai}|\p{Script=Hangul}|\p{Script=Cyrillic}|\p{Script=Arabic}|\p{Script=Hebrew}|\p{Script=Devanagari}|\p{Script=Greek}|\p{Script=Bengali}|\p{Script=Tamil}|\p{Script=Telugu}/u;
    if (distinctiveForeignScript.test(body)) return top.language.toLowerCase();

    const latinWords = body.match(/\p{Script=Latin}{2,}/gu) || [];
    const latinLetters = (body.match(/\p{Script=Latin}/gu) || []).length;
    if (latinWords.length >= 3 && latinLetters >= 10 && top.percentage >= 70) {
      return top.language.toLowerCase();
    }
    return null;
  }

  function isForeignLanguage(article) {
    if (isTranslatedFromForeignLanguage(article)) return true;

    const id = tweetId(article);
    const apiLanguage = id && languages.get(id);
    if (apiLanguage === "zh" && isAmbiguousShortHan(postText(article))) return false;
    const apiClassification = languageClassification(apiLanguage);
    if (apiClassification !== null) return apiClassification;

    const text = article.querySelector('[data-testid="tweetText"][lang]');
    const domLanguage = text?.getAttribute("lang")?.toLowerCase();
    if (domLanguage === "zh" && isAmbiguousShortHan(postText(article))) return false;
    const domClassification = languageClassification(domLanguage);
    if (domClassification !== null) return domClassification;

    const body = postText(article);
    const localResult = localLanguages.get(article);
    if (localResult?.body === body) {
      return languageClassification(localResult.language) === true;
    }

    if (
      body.length >= 4 &&
      pendingLanguageBodies.get(article) !== body &&
      chrome.i18n?.detectLanguage
    ) {
      pendingLanguageBodies.set(article, body);
      try {
        chrome.i18n.detectLanguage(body, (result) => {
          if (pendingLanguageBodies.get(article) !== body) return;
          pendingLanguageBodies.delete(article);
          const language = acceptedDetectedLanguage(body, result);
          localLanguages.set(article, { body, language });
          if (language) schedule();
        });
      } catch (_) {
        pendingLanguageBodies.delete(article);
      }
    }
    return false;
  }

  function routeStatusId() {
    const match = location.pathname.match(/^\/(?:[A-Za-z0-9_]{1,15}|i\/web)\/status\/(\d+)(?:\/|$)/);
    return match ? match[1] : null;
  }

  function apply() {
    const articles = document.querySelectorAll(TWEET_SELECTOR);
    const linkedTweetId = routeStatusId();
    let count = 0;
    articles.forEach((article) => {
      const linkedPost = linkedTweetId && tweetId(article) === linkedTweetId;
      const filtered = !linkedPost && (
        (isHiding && isPaid(article)) ||
        (hideForeignLanguage && isForeignLanguage(article)) ||
        (hideAiGenerated && isAiGenerated(article))
      );
      if (filtered) {
        article.classList.add(HIDE_CLASS);
        count++;
      } else {
        article.classList.remove(HIDE_CLASS);
      }
    });
    blockedCount = count;
    if (DEBUG()) {
      const handles = [...articles].map(authorHandle).filter(Boolean);
      log(`apply: hiding=${isHiding}, ${articles.length} posts, ${count} hidden, ${status.size} classified handles`);
      log("visible post handles:", handles.join(", "));
    }
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      apply();
    });
  }

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  // Verification and AI-label data arriving from the MAIN-world interceptor.
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "hvu") return;
    let changed = false;
    const users = isRecord(data.users) ? data.users : {};
    const aiPosts = isRecord(data.aiPosts) ? data.aiPosts : {};
    const incomingLanguages = isRecord(data.languages) ? data.languages : {};
    for (const handle in users) {
      const normalizedHandle = handle.toLowerCase();
      const value = users[handle];
      if (!/^[a-z0-9_]{1,15}$/.test(normalizedHandle) || !["paid", "other"].includes(value)) continue;
      if (status.get(normalizedHandle) !== value) {
        setBounded(status, normalizedHandle, value);
        changed = true;
      }
    }
    for (const id in aiPosts) {
      if (/^\d{5,}$/.test(id) && aiPosts[id] === true && !aiPostIds.has(id)) {
        addBounded(aiPostIds, id);
        changed = true;
      }
    }
    for (const id in incomingLanguages) {
      const language = incomingLanguages[id];
      if (!/^\d{5,}$/.test(id) || typeof language !== "string" || !/^[a-z0-9-]{1,32}$/i.test(language)) continue;
      const normalizedLanguage = language.toLowerCase();
      if (languages.get(id) !== normalizedLanguage) {
        setBounded(languages, id, normalizedLanguage);
        changed = true;
      }
    }
    if (changed) schedule();
  });

  window.postMessage({ source: "tfx-content-ready" }, "*");

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "tfx-get-blocked-count") return;
    sendResponse({ blockedCount });
  });

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && (changes.isHiding || changes.hideAiGenerated || changes.hideForeignLanguage)) {
      if (changes.isHiding) isHiding = !!changes.isHiding.newValue;
      if (changes.hideAiGenerated) hideAiGenerated = !!changes.hideAiGenerated.newValue;
      if (changes.hideForeignLanguage) hideForeignLanguage = !!changes.hideForeignLanguage.newValue;
      apply();
    }
  });

  chrome.storage.sync.get(["isHiding", "hideAiGenerated", "hideForeignLanguage"], (storage) => {
    isHiding = !!storage.isHiding;
    hideAiGenerated = !!storage.hideAiGenerated;
    hideForeignLanguage = !!storage.hideForeignLanguage;
    apply();
  });
})();
