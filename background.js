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

// Named so a test can drive it directly; the listener below is the only caller in the extension.
const run = async (tab) => {
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
    // Only Chrome's own injection refusals mean the page is off limits. Anything else is our
    // own bug, and saying "this page blocks extensions" would send the user chasing the wrong thing.
    const blocked = /^Cannot access|^The extensions gallery|^Extension manifest/.test(e.message || "");
    const why = /file:/.test(tab.url || "") && blocked
      ? "enable Allow access to file URLs on the extension card"
      : blocked
        ? "this page blocks extensions"
        : `overlay error: ${e.message || e}`;
    unsupported(tab.id, why);
    console.warn("snake-eyes: could not inject", e);
  }
};

chrome.action.onClicked.addListener(run);

// The overlay talks back for the 2 things it cannot do itself: dropping the page-level CSS when
// it closes by Escape or the close button (a click toggle already handles that path), and asking
// for a fresh scan after a resize without making the user click the icon twice.
chrome.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab && sender.tab.id;
  if (!tabId) return;
  if (msg && msg.type === "closed") chrome.scripting.removeCSS({ target: { tabId }, files: ["overlay.css"] }).catch(() => {});
  if (msg && msg.type === "rescan") run(sender.tab);
});
