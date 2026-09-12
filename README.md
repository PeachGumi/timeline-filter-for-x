## Hide Paid Verified Users on X

A Chrome extension that hides posts from accounts that **pay for verification**
(X Premium individuals — the blue check) on **X / Twitter**. It deliberately
leaves other checkmarks alone:

- 🟡 **Gold** (Verified Organizations / Business) — shown
- ⚪ **Grey** (Government / official) — shown
- **Legacy notable** verified accounts — shown
- 🔵 **Paid blue (X Premium individual)** — hidden

An independent popup option can also hide posts carrying X's **Made with AI**
label. It is off by default. On an individual post page, the linked post itself
remains visible while paid verified replies are still filtered.

The blue badge in the page looks identical regardless of *why* it was granted —
the paid/not-paid distinction only exists in X's API data. So the extension reads
X's own API responses to classify each account, then hides only the paid ones.

Available on the [Chrome Web Store](https://chrome.google.com/webstore/detail/hide-verified-twitter-use/egpeogmkamgdmolhpkajgnoookedcghb).

![chrome store logo](https://user-images.githubusercontent.com/11499173/234866562-cfb9fac2-70fa-4e44-a6fc-f222025c402f.png)

### How to use

1. Install the extension (or load it unpacked — see below).
2. Click the toolbar icon and flip the **Hiding verified posts** switch.
3. Verified posts are hidden live as you browse. The popup shows how many are
   currently hidden on the page.

The preference is stored in `chrome.storage.sync`, so it follows you across
devices and applies to every open X / Twitter tab at once.

### Load unpacked (for development)

1. Visit `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder.

### How it works

- `inject.js` runs in the page's **MAIN world** at `document_start` and patches
  `fetch`/`XHR` to observe X's API responses. Each User object carries
  `is_blue_verified` and `verified_type`, which it uses to classify a handle as
  `paid` (blue, individual) vs. `other` (business/government/legacy). It posts a
  `handle -> status` map to the content script via `window.postMessage`.
- `content.js` (isolated world) watches the page with a `MutationObserver`, reads
  each post's author handle, and hides the post only if that handle is `paid`.
- The popup writes the on/off flag to `chrome.storage.sync`; the content script
  reacts to that change directly, so no background service worker is needed.
- The live hidden count is written to `chrome.storage.local` and shown in the
  popup.

Because classification depends on X's API traffic, a freshly loaded post is hidden
as soon as its user data arrives (usually the same response that rendered it).

### Files

| File | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest, host permissions, content-script registration |
| `inject.js` | MAIN-world API interceptor that classifies paid vs. other badges |
| `content.js` | Hides paid-verified posts via `MutationObserver` |
| `popup.html` / `popup.js` | Toggle UI and live hidden count |
