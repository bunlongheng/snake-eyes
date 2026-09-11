// Snake Eyes: on-demand injection only. Nothing runs on a page until the icon is clicked.
// Clicking again removes the overlay (overlay.js toggles itself). panel.css is handed to
// the overlay as text so it can live inside a shadow root, isolated from page styles.
let panelCss = "";
async function loadPanelCss() {
  if (!panelCss) panelCss = await (await fetch(chrome.runtime.getURL("panel.css"))).text();
  return panelCss;
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !/^https?:|^file:/.test(tab.url || "")) return;
  try {
    const css = await loadPanelCss();
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["overlay.css"] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (c) => { window.__SNAKE_EYES_CSS__ = c; }, args: [css] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["overlay.js"] });
  } catch (e) {
    console.warn("snake-eyes: could not inject", e);
  }
});
