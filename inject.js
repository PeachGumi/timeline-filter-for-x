// Runs in the page's MAIN world so it can observe X's own fetch/XHR traffic.
// X's API responses carry the verification details that the rendered HTML hides:
// whether a check is paid (X Premium individual) vs. a business/government/legacy
// badge. We scrape those, classify each handle, and forward the result to the
// isolated content script via window.postMessage.
(() => {
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
      ""
    ).toLowerCase();
    if (!handle) return null;

    const isBlue =
      user.is_blue_verified === true ||
      user.isBlueVerified === true ||
      verification.is_blue_verified === true ||
      verification.verified === true; // newer schema

    const type =
      user.verified_type ||
      verification.verified_type ||
      legacy.verified_type ||
      "None"; // None | Blue | Business | Government

    const status =
      isBlue && type !== "Business" && type !== "Government" ? "paid" : "other";
    return { handle, status };
  }

  const seen = new Map(); // handle -> status, to avoid re-posting duplicates

  // Recursively walk a parsed response, collecting any User-shaped objects.
  function harvest(node, out, depth) {
    if (!node || typeof node !== "object" || depth > 40) return;
    if (Array.isArray(node)) {
      for (const item of node) harvest(item, out, depth + 1);
      return;
    }
    const hasUserShape =
      "is_blue_verified" in node ||
      "isBlueVerified" in node ||
      (node.core && typeof node.core === "object" && "screen_name" in node.core) ||
      (node.verification && typeof node.verification === "object" && "verified_type" in node.verification) ||
      (node.legacy && typeof node.legacy === "object" && "screen_name" in node.legacy);
    if (hasUserShape) {
      const result = classify(node);
      if (result) out.push(result);
    }
    for (const key in node) {
      const val = node[key];
      if (val && typeof val === "object") harvest(val, out, depth + 1);
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
    harvest(data, found, 0);
    const updates = {};
    for (const { handle, status } of found) {
      if (seen.get(handle) !== status) {
        seen.set(handle, status);
        updates[handle] = status;
      }
    }
    if (found.length) log("scanned response:", found.length, "users,", Object.keys(updates).length, "new");
    if (Object.keys(updates).length) {
      const paid = Object.entries(updates).filter(([, s]) => s === "paid").map(([h]) => h);
      if (paid.length) log("paid handles:", paid.join(", "));
      window.postMessage({ source: "hvu", users: updates }, "*");
    }
  }

  // --- Patch fetch ---
  const origFetch = window.fetch;
  window.fetch = function (...args) {
    return origFetch.apply(this, args).then((res) => {
      const url = res.url || "";
      if (url.includes("twitter.com") || url.includes("x.com") || url.includes("/graphql") || url.includes("/api/")) {
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
        if (!url.includes("/graphql") && !url.includes("/api/")) return;
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
