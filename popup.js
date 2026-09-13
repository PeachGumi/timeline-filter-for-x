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
function renderCount(value) {
  countEl.textContent = Number.isInteger(value) && value >= 0 ? value : 0;
}

chrome.tabs.query({ active: true, currentWindow: true }, ([tab] = []) => {
  if (!Number.isInteger(tab?.id)) return renderCount(0);
  chrome.tabs.sendMessage(tab.id, { type: "tfx-get-blocked-count" }, (response) => {
    if (chrome.runtime?.lastError) return renderCount(0);
    renderCount(response?.blockedCount);
  });
});
