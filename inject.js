// Runs in the page's MAIN world so it can observe X's own fetch/XHR traffic.
// X's API responses carry the verification details that the rendered HTML hides:
// whether a check is paid (X Premium individual) vs. a business/government/legacy
// badge. We scrape those, classify each handle, and forward the result to the
// isolated content script via window.postMessage.
(() => {
  const MAX_HARVEST_NODES = 100_000;
  const MAX_CACHE_ENTRIES = 10_000;
  const DEBUG = () => {
    try { return localStorage.getItem("hvu-debug") === "1"; } catch (_) { return false; }
  };
  const log = (...a) => DEBUG() && console.log("[HVU/inject]", ...a);

  // Classify a User object from X's GraphQL/REST payloads.
  // Returns "paid" only for individuals who pay for X Premium (blue check),
  // excluding gold (Business) and grey (Government) and legacy-only badges.
  // X has shuffled where these live over time, so we probe several locations.
  function classify(user) {
    const legacy = user.legacy || {};
    const core = user.core || {};
    const verification = user.verification || {};

    const handle = (
      core.screen_name ||
      legacy.screen_name ||
      user.screen_name ||
      user.username ||
      ""
    ).toLowerCase();
    if (!handle) return null;

    // Some timeline payloads repeat the same user as a partial object. A
    // partial copy must not be treated as explicitly unverified.
    const hasVerificationSignal =
      typeof user.is_blue_verified === "boolean" ||
      typeof user.isBlueVerified === "boolean" ||
      typeof verification.is_blue_verified === "boolean" ||
      typeof verification.verified === "boolean" ||
      typeof user.verified === "boolean" ||
      typeof user.verified_type === "string" ||
      typeof verification.verified_type === "string" ||
      typeof legacy.verified_type === "string";
    if (!hasVerificationSignal) return null;

    const types = [
      user.verified_type,
      verification.verified_type,
      legacy.verified_type,
    ].filter((value) => typeof value === "string").map((value) => value.toLowerCase());

    const isBlue =
      types.includes("blue") ||
      user.is_blue_verified === true ||
      user.isBlueVerified === true ||
      verification.is_blue_verified === true ||
      verification.verified === true ||
      (user.verified === true && types.includes("blue"));
    const protectedType = types.includes("business") || types.includes("government");
    const specificType = types.some((value) => value !== "none");
    const status = isBlue && !protectedType ? "paid" : "other";
    const confidence = specificType ? 3 : (isBlue ? 2 : 1);
    return { handle, status, confidence };
  }

  const seen = new Map(); // handle -> { status, confidence }
  const seenAiPosts = new Set();
  const seenLanguages = new Map();

  function setBounded(map, key, value) {
    if (map.has(key)) map.delete(key);
    while (map.size >= MAX_CACHE_ENTRIES) map.delete(map.keys().next().value);
    map.set(key, value);
  }

  function addBounded(set, value) {
    while (set.size >= MAX_CACHE_ENTRIES) set.delete(set.values().next().value);
    set.add(value);
  }

  // Recursively walk a parsed response, collecting User, AI-label and language data.
  function harvest(node, userOut, aiOut, languageOut, depth, budget) {
    if (!node || typeof node !== "object" || depth > 40 || budget.nodes >= MAX_HARVEST_NODES) return;
    budget.nodes++;
    if (Array.isArray(node)) {
      for (const item of node) {
        if (budget.nodes >= MAX_HARVEST_NODES) break;
        budget.nodes++;
        if (item && typeof item === "object") {
          harvest(item, userOut, aiOut, languageOut, depth + 1, budget);
        }
      }
      return;
    }
    if (node.made_with_ai === true || node.madeWithAi === true) {
      const id = String(node.rest_id || node.id_str || node.tweet_id || node.id || "");
      if (/^\d{5,}$/.test(id)) aiOut.push(id);
    }
    const tweetId = String(node.rest_id || node.id_str || node.tweet_id || node.id || "");
    const language = node.lang || (node.legacy && node.legacy.lang);
    if (/^\d{5,}$/.test(tweetId) && typeof language === "string" && language) {
      languageOut.push({ id: tweetId, language: language.toLowerCase() });
    }
    const hasUserShape =
      "is_blue_verified" in node ||
      "isBlueVerified" in node ||
      "verified" in node ||
      "verified_type" in node ||
      (node.core && typeof node.core === "object" && "screen_name" in node.core) ||
      (node.verification && typeof node.verification === "object" && "verified_type" in node.verification) ||
      (node.legacy && typeof node.legacy === "object" && "screen_name" in node.legacy);
    if (hasUserShape) {
      const result = classify(node);
      if (result) userOut.push(result);
    }
    for (const key in node) {
      if (budget.nodes >= MAX_HARVEST_NODES) break;
      budget.nodes++;
      const val = node[key];
      if (val && typeof val === "object") harvest(val, userOut, aiOut, languageOut, depth + 1, budget);
    }
  }

  // Accepts either a JSON string or an already-parsed object.
  function process(input) {
    let data = input;
    if (typeof input === "string") {
      if (!input || input.length > 5_000_000) return;
      try {
        data = JSON.parse(input);
      } catch (_) {
        return;
      }
    }
    if (!data || typeof data !== "object") return;
    const found = [];
    const foundAiPosts = [];
    const foundLanguages = [];
    harvest(data, found, foundAiPosts, foundLanguages, 0, { nodes: 0 });
    const updates = new Map();
    const aiPosts = new Map();
    const languageUpdates = new Map();
    const resolvedUsers = new Map();
    for (const result of found) {
      const current = resolvedUsers.get(result.handle);
      if (!current || result.confidence > current.confidence) {
        resolvedUsers.set(result.handle, result);
      }
    }
    for (const { handle, status } of resolvedUsers.values()) {
      const result = resolvedUsers.get(handle);
      const previous = seen.get(handle);
      if (previous && result.confidence < previous.confidence) continue;
      setBounded(seen, handle, { status, confidence: result.confidence });
      if (previous?.status !== status) setBounded(updates, handle, status);
    }
    for (const id of foundAiPosts) {
      if (!seenAiPosts.has(id)) {
        addBounded(seenAiPosts, id);
        setBounded(aiPosts, id, true);
      }
    }
    for (const { id, language } of foundLanguages) {
      if (seenLanguages.get(id) !== language) {
        setBounded(seenLanguages, id, language);
        setBounded(languageUpdates, id, language);
      }
    }
    if (found.length) log("scanned response:", found.length, "users,", updates.size, "new");
    if (updates.size || aiPosts.size || languageUpdates.size) {
      const paid = [...updates].filter(([, status]) => status === "paid").map(([handle]) => handle);
      if (paid.length) log("paid handles:", paid.join(", "));
      window.postMessage({
        source: "hvu",
        users: Object.fromEntries(updates),
        aiPosts: Object.fromEntries(aiPosts),
        languages: Object.fromEntries(languageUpdates),
      }, "*");
    }
  }

  function replaySnapshot() {
    const users = Object.fromEntries([...seen].map(([handle, value]) => [handle, value.status]));
    const aiPosts = Object.fromEntries([...seenAiPosts].map((id) => [id, true]));
    const languages = Object.fromEntries(seenLanguages);
    window.postMessage({ source: "hvu", users, aiPosts, languages }, "*");
  }

  window.addEventListener?.("message", (event) => {
    if (event.source !== window || event.data?.source !== "tfx-content-ready") return;
    replaySnapshot();
  });

  function isXApiUrl(input) {
    try {
      const url = new URL(String(input), window.location?.href || "https://x.com/");
      const host = url.hostname.toLowerCase();
      const isWebHost = host === "x.com" || host === "twitter.com";
      const isRestApiHost = host === "api.x.com" || host === "api.twitter.com";
      const isWebApiPath = url.pathname.includes("/graphql/") || url.pathname.includes("/api/");
      const isRestApiPath = /^\/(?:1\.1|2)\//.test(url.pathname);
      return url.protocol === "https:" &&
        ((isWebHost && isWebApiPath) || (isRestApiHost && isRestApiPath));
    } catch (_) {
      return false;
    }
  }

  // --- Patch fetch ---
  const origFetch = window.fetch;
  window.fetch = function (...args) {
    return origFetch.apply(this, args).then((res) => {
      const url = res.url || "";
      if (isXApiUrl(url)) {
        res
          .clone()
          .text()
          .then(process)
          .catch(() => {});
      }
      return res;
    });
  };

  // --- Patch XHR ---
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__hvuUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener("load", () => {
      try {
        const url = this.__hvuUrl || "";
        if (!isXApiUrl(url)) return;
        const rt = this.responseType;
        if (rt === "json") {
          process(this.response); // already a parsed object
        } else if (rt === "" || rt === "text") {
          process(this.responseText);
        }
      } catch (_) {}
    });
    return origSend.apply(this, arguments);
  };
})();
