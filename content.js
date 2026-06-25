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
  let blockedCount = 0;
  const status = new Map(); // lowercased handle -> "paid" | "other"

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

  // Promoted/ad posts. X wraps these in a placementTracking node; the advertiser
  // is usually a gold (business) account, so it isn't caught by the paid check.
  function isAd(article) {
    return !!article.querySelector('[data-testid="placementTracking"]');
  }

  function apply() {
    const articles = document.querySelectorAll(TWEET_SELECTOR);
    let count = 0;
    articles.forEach((article) => {
      const paid = isPaid(article) || isAd(article);
      if (isHiding && paid) {
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

  // Verification data arriving from the MAIN-world interceptor.
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "hvu" || !data.users) return;
    let changed = false;
    for (const handle in data.users) {
      if (status.get(handle) !== data.users[handle]) {
        status.set(handle, data.users[handle]);
        changed = true;
      }
    }
    if (changed) schedule();
  });

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.isHiding) {
      isHiding = !!changes.isHiding.newValue;
      apply();
    }
  });

  chrome.storage.sync.get("isHiding", (storage) => {
    isHiding = !!storage.isHiding;
    apply();
  });
})();
