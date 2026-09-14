// Timeline Filter for X — content script (isolated world)
// Hides posts from accounts that PAY for verification (X Premium individuals),
// while leaving gold (Business), grey (Government) and legacy badges alone.
//
// The paid/not-paid signal isn't in the rendered HTML, so inject.js (MAIN world)
// reads X's API traffic and posts compact user, AI-label, and language maps.
// A readiness handshake replays classifications captured before this script loads.
(() => {
  const HIDE_CLASS = "hvu-hidden";
  const TWEET_SELECTOR = "article";
  const MAX_CACHE_ENTRIES = 10_000;
  const AI_LABELS = new Set(["AIで生成", "AI生成", "Made with AI", "AI-generated"]);
  const UNKNOWN_LANGUAGE_CODES = new Set(["und", "qam", "qct", "qht", "qme", "qst", "zxx"]);

  const DEBUG = () => {
    try { return localStorage.getItem("hvu-debug") === "1"; } catch (_) { return false; }
  };
  const log = (...a) => DEBUG() && console.log("[HVU/content]", ...a);

  let isHiding = false;
  let hideAiGenerated = false;
  let hideForeignLanguage = false;

  const status = new Map(); // lowercased handle -> "paid" | "other"
  const following = new Set();
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

  function isPaidHandle(handle) {
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

  function tweetId(article, author = authorHandle(article)) {
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


  function articleLabels(article) {
    const labels = [];
    for (const element of article.querySelectorAll('[aria-label], span')) {
      if (element.closest('[role="link"]')) continue;
      const text = (element.getAttribute("aria-label") || element.textContent || "").trim();
      if (text) labels.push({ element, text });
    }
    return labels;
  }

  function isAiGenerated(article, id, labels = null) {
    if (id && aiPostIds.has(id)) return true;

    for (const entry of labels || articleLabels(article)) {
      if (entry.element.closest('[data-testid="tweetText"]')) continue;
      if (AI_LABELS.has(entry.text)) return true;
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

  function isTranslatedFromForeignLanguage(labels) {
    for (const { text: label } of labels) {
      const japaneseLabel = label.match(/^([^\s]{1,24}語)からの翻訳$/);
      if (japaneseLabel) return japaneseLabel[1] !== "日本語";
      const englishLabel = label.match(/^Translated from (.{1,32})$/i);
      if (englishLabel) return englishLabel[1].toLowerCase() !== "japanese";
    }
    return false;
  }

  function languageClassification(language, body = "") {
    if (!language) return null;
    const normalized = language.toLowerCase();
    if (UNKNOWN_LANGUAGE_CODES.has(normalized)) return false;
    if (normalized === "zh" && isAmbiguousShortHan(body)) return false;
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

  function isForeignLanguage(article, id, labels) {
    if (isTranslatedFromForeignLanguage(labels)) return true;

    let body = null;
    const apiLanguage = id && languages.get(id);
    if (apiLanguage === "zh") body = postText(article);
    const apiClassification = languageClassification(apiLanguage, body || "");
    if (apiClassification !== null) return apiClassification;

    const text = article.querySelector('[data-testid="tweetText"][lang]');
    const domLanguage = text?.getAttribute("lang")?.toLowerCase();
    if (domLanguage === "zh" && body === null) body = postText(article);
    const domClassification = languageClassification(domLanguage, body || "");
    if (domClassification !== null) return domClassification;

    if (body === null) body = postText(article);
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
    const filtersEnabled = isHiding || hideForeignLanguage || hideAiGenerated;
    const needsId = filtersEnabled && (!!linkedTweetId || hideForeignLanguage || hideAiGenerated);
    articles.forEach((article) => {
      const handle = isHiding || needsId ? authorHandle(article) : null;
      const id = needsId ? tweetId(article, handle) : null;
      const linkedPost = linkedTweetId && id === linkedTweetId;
      const exempt = linkedPost || following.has(handle);
      let labels = null;
      let filtered = !exempt && isHiding && isPaidHandle(handle);
      if (!exempt && !filtered && hideForeignLanguage) {
        labels = articleLabels(article);
        filtered = isForeignLanguage(article, id, labels);
      }
      if (!exempt && !filtered && hideAiGenerated) {
        filtered = isAiGenerated(article, id, labels);
      }
      if (filtered) {
        article.classList.add(HIDE_CLASS);
      } else {
        article.classList.remove(HIDE_CLASS);
      }
    });
    if (DEBUG()) {
      const handles = [...articles].map(authorHandle).filter(Boolean);
      const hidden = [...articles].filter(article => article.classList.contains(HIDE_CLASS)).length;
      log(`apply: hiding=${isHiding}, ${articles.length} posts, ${hidden} hidden, ${status.size} classified handles`);
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

  // User, AI-label, and language data arriving from the MAIN-world interceptor.
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "hvu") return;
    let changed = false;
    const users = isRecord(data.users) ? data.users : {};
    const incomingFollowing = isRecord(data.following) ? data.following : {};
    const aiPosts = isRecord(data.aiPosts) ? data.aiPosts : {};
    const incomingLanguages = isRecord(data.languages) ? data.languages : {};
    let entries = 0;
    for (const handle in users) {
      if (entries >= MAX_CACHE_ENTRIES) break;
      entries += 1;
      const normalizedHandle = handle.toLowerCase();
      const value = users[handle];
      if (!/^[a-z0-9_]{1,15}$/.test(normalizedHandle) || !["paid", "other"].includes(value)) continue;
      if (status.get(normalizedHandle) !== value) {
        setBounded(status, normalizedHandle, value);
        changed = true;
      }
    }
    entries = 0;
    if (data.followingSnapshot === true) {
      const nextFollowing = new Set();
      for (const handle in incomingFollowing) {
        if (entries >= MAX_CACHE_ENTRIES) break;
        entries += 1;
        const normalizedHandle = handle.toLowerCase();
        if (/^[a-z0-9_]{1,15}$/.test(normalizedHandle) && incomingFollowing[handle] === true) {
          nextFollowing.add(normalizedHandle);
        }
      }
      if (nextFollowing.size !== following.size || [...nextFollowing].some(handle => !following.has(handle))) {
        following.clear();
        for (const handle of nextFollowing) following.add(handle);
        changed = true;
      }
    } else {
      for (const handle in incomingFollowing) {
        if (entries >= MAX_CACHE_ENTRIES) break;
        entries += 1;
        const normalizedHandle = handle.toLowerCase();
        const value = incomingFollowing[handle];
        if (!/^[a-z0-9_]{1,15}$/.test(normalizedHandle) || typeof value !== "boolean") continue;
        if (value && !following.has(normalizedHandle)) {
          addBounded(following, normalizedHandle);
          changed = true;
        } else if (!value && following.delete(normalizedHandle)) {
          changed = true;
        }
      }
    }
    entries = 0;
    for (const id in aiPosts) {
      if (entries >= MAX_CACHE_ENTRIES) break;
      entries += 1;
      if (/^\d{5,20}$/.test(id) && aiPosts[id] === true && !aiPostIds.has(id)) {
        addBounded(aiPostIds, id);
        changed = true;
      }
    }
    entries = 0;
    for (const id in incomingLanguages) {
      if (entries >= MAX_CACHE_ENTRIES) break;
      entries += 1;
      const language = incomingLanguages[id];
      if (!/^\d{5,20}$/.test(id) || typeof language !== "string" || !/^[a-z0-9-]{1,32}$/i.test(language)) continue;
      const normalizedLanguage = language.toLowerCase();
      if (languages.get(id) !== normalizedLanguage) {
        setBounded(languages, id, normalizedLanguage);
        changed = true;
      }
    }
    if (changed) schedule();
  });

  window.postMessage({ source: "tfx-content-ready" }, "*");


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
