// Snake Eyes: on-demand injection only. Nothing runs on a page until the icon is clicked
// (or the keyboard shortcut in manifest.json fires the same action). Clicking again removes
// the overlay: overlay.js returns true when it closed one, and then the page-level CSS is
// removed too, so a tab never accumulates anything. panel.css is handed to the overlay as
// text so it can be adopted inside the closed shadow root.
let panelCss = "";
async function loadPanelCss() {
  if (!panelCss) panelCss = await (await fetch(chrome.runtime.getURL("panel.css"))).text();
  return panelCss;
}

const unsupported = (tabId, why) => {
  chrome.action.setBadgeText({ tabId, text: "!" });
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#c0392b" });
  chrome.action.setTitle({ tabId, title: `Snake Eyes cannot run here: ${why}` });
};

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  if (!/^https?:|^file:/.test(tab.url || "")) { unsupported(tab.id, "only http, https and file pages"); return; }
  const target = { tabId: tab.id };
  try {
    const css = await loadPanelCss();
    await chrome.scripting.insertCSS({ target, files: ["overlay.css"] });
    await chrome.scripting.executeScript({ target, func: (c) => { window.__SNAKE_EYES_CSS__ = c; }, args: [css] });
    const [res] = await chrome.scripting.executeScript({ target, files: ["lib/pure.js", "overlay.js"] });
    if (res && res.result === true) await chrome.scripting.removeCSS({ target, files: ["overlay.css"] });
    chrome.action.setBadgeText({ tabId: tab.id, text: "" });
    chrome.action.setTitle({ tabId: tab.id, title: "Snake Eyes: audit spacing on this page" });
  } catch (e) {
    unsupported(tab.id, /file:/.test(tab.url || "") ? "enable Allow access to file URLs on the extension card" : "this page blocks extensions");
    console.warn("snake-eyes: could not inject", e);
  }
});
