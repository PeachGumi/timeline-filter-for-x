const toggleSwitch = document.getElementById("toggleSwitch");
const aiToggle = document.getElementById("hideAiGenerated");
const foreignToggle = document.getElementById("hideForeignLanguage");

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
