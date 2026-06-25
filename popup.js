const toggleSwitch = document.getElementById("toggleSwitch");
const countEl = document.getElementById("count");

// Toggle hiding — the content script reacts to this storage change directly.
toggleSwitch.addEventListener("change", () => {
  chrome.storage.sync.set({ isHiding: toggleSwitch.checked });
});

// Restore the saved toggle state.
chrome.storage.sync.get("isHiding", (storage) => {
  toggleSwitch.checked = !!storage.isHiding;
});

// Show the current hidden count and keep it live while the popup is open.
function renderCount(value) {
  countEl.textContent = value || 0;
}

chrome.storage.local.get("blockedCount", (storage) => {
  renderCount(storage.blockedCount);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.blockedCount) {
    renderCount(changes.blockedCount.newValue);
  }
});
