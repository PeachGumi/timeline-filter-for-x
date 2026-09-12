// Hide Verified Users on X — content script (isolated world)
// Hides posts from accounts that PAY for verification (X Premium individuals),
// while leaving gold (Business), grey (Government) and legacy badges alone.
//
// The paid/not-paid signal isn't in the rendered HTML, so inject.js (MAIN world)
// reads X's API traffic and posts us a handle -> status map. We match each post's
// author handle against that map.
(() => {
  const HIDE_CLASS = "hvu-hidden";
  const TWEET_SELECTOR = "article";
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
  const localLanguages = new Map();
  const pendingLanguageIds = new Set();

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
        const href = link.getAttribute("href") || "";
        const match = href.match(/\/(?:https?:\/\/(?:www\.)?(?:x|twitter)\.com\/)?([A-Za-z0-9_]{1,15})\/status\/(\d+)/i);
        if (match && match[1].toLowerCase() === author) return match[2];
      }
    }
    return statusIds(article)[0] || null;
  }

  function hasTweetId(article, id) {
    return statusIds(article).includes(id);
  }

  function isAiGenerated(article) {
    const id = tweetId(article);
    if (id && aiPostIds.has(id)) return true;

    const labels = new Set(["AIで生成", "AI生成", "Made with AI", "AI-generated"]);
    for (const element of article.querySelectorAll('[aria-label], span')) {
      if (element.closest('[data-testid="tweetText"]')) continue;
      const text = (element.getAttribute("aria-label") || element.textContent || "").trim();
      if (labels.has(text)) return true;
    }
    return false;
  }

  function isForeignLanguage(article) {
    const knownForeign = (language) =>
      !!language && !["ja", "und", "qme", "zxx"].includes(language.toLowerCase());

    const text = article.querySelector('[data-testid="tweetText"][lang]');
    const domLanguage = text?.getAttribute("lang");
    if (domLanguage) return knownForeign(domLanguage);

    const id = tweetId(article);
    const apiLanguage = id && languages.get(id);
    if (apiLanguage) return knownForeign(apiLanguage);

    const localLanguage = id && localLanguages.get(id);
    if (localLanguage) return knownForeign(localLanguage);

    if (id && !pendingLanguageIds.has(id) && chrome.i18n?.detectLanguage) {
      const body = (
        article.querySelector('[data-testid="tweetText"]')?.textContent ||
        article.innerText ||
        ""
      ).trim();
      if (body.length >= 4) {
        pendingLanguageIds.add(id);
        try {
          chrome.i18n.detectLanguage(body, (result) => {
            pendingLanguageIds.delete(id);
            const top = result?.languages?.[0];
            if (top && (result.isReliable || top.percentage >= 70)) {
              localLanguages.set(id, top.language.toLowerCase());
              schedule();
            }
          });
        } catch (_) {
          pendingLanguageIds.delete(id);
        }
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
      const linkedPost = linkedTweetId && hasTweetId(article, linkedTweetId);
      const filtered = !linkedPost && (
        (isHiding && isPaid(article)) ||
        (hideForeignLanguage && isForeignLanguage(article)) ||
        (!linkedTweetId && hideAiGenerated && isAiGenerated(article))
      );
      if (filtered) {
        article.classList.add(HIDE_CLASS);
        count++;
      } else {
        article.classList.remove(HIDE_CLASS);
      }
    });
    if (count !== blockedCount) {
      blockedCount = count;
      try {
        chrome.storage.local.set({ blockedCount });
      } catch (_) {}
    }
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

  // Verification and AI-label data arriving from the MAIN-world interceptor.
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "hvu") return;
    let changed = false;
    for (const handle in (data.users || {})) {
      if (status.get(handle) !== data.users[handle]) {
        status.set(handle, data.users[handle]);
        changed = true;
      }
    }
    for (const id in (data.aiPosts || {})) {
      if (data.aiPosts[id] && !aiPostIds.has(id)) {
        aiPostIds.add(id);
        changed = true;
      }
    }
    for (const id in (data.languages || {})) {
      if (languages.get(id) !== data.languages[id]) {
        languages.set(id, data.languages[id]);
        changed = true;
      }
    }
    if (changed) schedule();
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
