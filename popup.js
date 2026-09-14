const toggleSwitch = document.getElementById("toggleSwitch");
const aiToggle = document.getElementById("hideAiGenerated");
const foreignToggle = document.getElementById("hideForeignLanguage");
const countEl = document.getElementById("count");

// Toggle hiding — the content script reacts to this storage change directly.
toggleSwitch.addEventListener("change", () => {
  chrome.storage.sync.set({ isHiding: toggleSwitch.checked });
});

aiToggle.addEventListener("change", () => {
  chrome.storage.sync.set({ hideAiGenerated: aiToggle.checked });
});

foreignToggle.addEventListener("change", () => {
  chrome.storage.sync.set({ hideForeignLanguage: foreignToggle.checked });
});

// Restore the saved toggle state.
chrome.storage.sync.get(["isHiding", "hideAiGenerated", "hideForeignLanguage"], (storage) => {
  toggleSwitch.checked = !!storage.isHiding;
  aiToggle.checked = !!storage.hideAiGenerated;
  foreignToggle.checked = !!storage.hideForeignLanguage;
});

// Ask the active tab so counts from other X tabs cannot overwrite this page.
function validCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function renderCount(value) {
  countEl.textContent = validCount(value) ? value : 0;
}

function validDocumentToken(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

const pendingLiveCounts = new Map();
const MAX_QUERY_ATTEMPTS = 4;
let activeTabId = null;
let activeDocumentToken = null;
let initialQuerySettled = false;
let queryGeneration = 0;

function rememberPendingCount(documentToken, blockedCount) {
  pendingLiveCounts.set(documentToken, blockedCount);
  if (pendingLiveCounts.size > 16) pendingLiveCounts.delete(pendingLiveCounts.keys().next().value);
}

function probeCount(tabId, generation, attempt) {
  chrome.tabs.sendMessage(tabId, { type: "tfx-get-blocked-count" }, (response) => {
    if (generation !== queryGeneration || tabId !== activeTabId) return;
    if (chrome.runtime?.lastError || !validCount(response?.blockedCount) || !validDocumentToken(response?.documentToken)) {
      renderCount(0);
      if (attempt + 1 < MAX_QUERY_ATTEMPTS) {
        setTimeout(() => {
          if (generation === queryGeneration && tabId === activeTabId) {
            probeCount(tabId, generation, attempt + 1);
          }
        }, 100 * (attempt + 1));
      } else {
        initialQuerySettled = true;
        pendingLiveCounts.clear();
      }
      return;
    }
    initialQuerySettled = true;
    activeDocumentToken = response.documentToken;
    const count = pendingLiveCounts.has(activeDocumentToken)
      ? pendingLiveCounts.get(activeDocumentToken)
      : response.blockedCount;
    pendingLiveCounts.clear();
    renderCount(count);
  });
}

function requestCount(tabId) {
  const generation = ++queryGeneration;
  activeDocumentToken = null;
  initialQuerySettled = false;
  probeCount(tabId, generation, 0);
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "tfx-blocked-count-updated" || sender.tab?.id !== activeTabId) return;
  if (!validCount(message.blockedCount) || !validDocumentToken(message.documentToken)) return;
  if (!initialQuerySettled) {
    rememberPendingCount(message.documentToken, message.blockedCount);
    return;
  }
  if (message.documentToken === activeDocumentToken) renderCount(message.blockedCount);
});

chrome.tabs.onUpdated?.addListener((tabId, changeInfo) => {
  if (tabId !== activeTabId) return;
  if (changeInfo.status === "loading") {
    ++queryGeneration;
    activeDocumentToken = null;
    initialQuerySettled = false;
    pendingLiveCounts.clear();
    renderCount(0);
  } else if (changeInfo.status === "complete") {
    requestCount(tabId);
  }
});

chrome.tabs.query({ active: true, currentWindow: true }, ([tab] = []) => {
  if (!Number.isInteger(tab?.id)) return renderCount(0);
  activeTabId = tab.id;
  requestCount(tab.id);
});
