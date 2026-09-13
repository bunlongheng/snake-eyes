// Snake Eyes browser test: injects the overlay the same way background.js does (pure.js,
// then overlay.js, with panel.css handed over as text) into 3 pages in headless Chromium:
//   tests/fixture.html  - 6 planted mistakes, must find exactly those, and the panel must work
//   tests/clean.html    - consistent spacing, prose with inline links, a centered hero: 0 issues
//   an inline 200-row page - the cap must keep the 150 most severe and say so
// Also runs the fixture at 3 widths. Set SNK_HERO=1 to refresh docs/hero.png.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const css = readFileSync(join(root, "overlay.css"), "utf8");
const panelCss = readFileSync(join(root, "panel.css"), "utf8");
const pure = readFileSync(join(root, "lib", "pure.js"), "utf8");
const js = readFileSync(join(root, "overlay.js"), "utf8");
mkdirSync(join(here, "screenshots"), { recursive: true });

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) failed++; };

const browser = await chromium.launch();
try {
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, permissions: ["clipboard-read", "clipboard-write"] });

async function inject(page) {
  await page.addStyleTag({ content: css });
  await page.evaluate((c) => { window.__SNAKE_EYES_CSS__ = c; window.__snakeEyesTest = true; }, panelCss);
  await page.addScriptTag({ content: pure });
  await page.addScriptTag({ content: js });
  await page.waitForFunction(() => window.__snakeEyes && window.__snakeEyes.ready);
  return page.evaluate(() => ({ issues: window.__snakeEyes.issues, total: window.__snakeEyes.total, dropped: window.__snakeEyes.dropped, report: window.__snakeEyes.report() }));
}
const inShadow = (page, fn, arg) => page.evaluate(fn, arg);

// ---------- fixture: exact set ----------
const page = await context.newPage();
await page.goto("file://" + join(here, "fixture.html"));
const r = await inject(page);
const text = r.issues.map((i) => `${i.title} | ${i.detail}`).join("\n");
check(r.issues.length === 6, `fixture: exactly the 6 planted issues (found ${r.issues.length}${r.issues.length !== 6 ? ": " + r.issues.map((i) => i.title).join(" | ") : ""})`);
check(/Uneven horizontal gaps/.test(text) && /24, 24, 31px/.test(text), "gap: the 31px card gap");
check(/Uneven vertical gaps/.test(text) && /16, 28, 16px/.test(text), "gap: the 28px stack gap");
check(/Left edge off by 6px/.test(text), "edge: the 6px indented list item");
check(/left 16px vs right 24px/.test(text), "padding: the callout");
check(/top padding 48px, others use 64px/.test(text), "rhythm: hero top padding");
check(/Content inset \d+px in <section> "About/.test(text), "rhythm: about section inset");
const sev = r.issues.map((i) => ({ high: 0, medium: 1, low: 2 })[i.severity]);
check(sev.every((s, i) => i === 0 || s >= sev[i - 1]), "issues are sorted high to low");
check(await page.evaluate(() => window.__snakeEyes.issues.every((i, n) => document.querySelector(i.selector) === window.__snakeEyes.elements[n])), "every selector resolves back to exactly its element");
check(/^# Snake Eyes spacing report/.test(r.report) && /- Page: file:\/\//.test(r.report) && /## 1\./.test(r.report) && /Selector: `/.test(r.report), "report is agent-ready markdown with a page id");

// panel
const ui = await inShadow(page, () => { const sh = window.__snakeEyes.shadow; return { items: sh.querySelectorAll(".snk-item").length, buttons: sh.querySelectorAll("button.snk-item").length, guides: sh.querySelectorAll(".snk-line").length, badges: sh.querySelectorAll(".snk-badge").length, box: !!sh.querySelector(".snk-box.snk-active"), h2: !!sh.querySelector("h2"), aria: sh.querySelector("aside").getAttribute("aria-label") }; });
check(ui.items === 6 && ui.buttons === 6, "panel lists every issue as a real button");
check(ui.guides > 0 && ui.badges > 0 && ui.box, "first issue is highlighted with guides and numbers");
check(ui.h2 && !!ui.aria, "panel has a heading and an accessible name");
// A data URI contains a semicolon, so a value written with a sloppy regex truncates and the
// leftover text runs on and eats the next declaration. Assert the art actually resolves.
const art = await inShadow(page, () => {
  const sh = window.__snakeEyes.shadow;
  const bg = getComputedStyle(sh.querySelector(".snk-logo")).backgroundImage;
  return { logo: bg.startsWith('url("data:image/png'), len: bg.length };
});
check(art.logo && art.len > 500, `the panel logo resolves to real image data (${art.len} chars)`);
check(await inShadow(page, () => window.__snakeEyes.shadow.activeElement === window.__snakeEyes.shadow.querySelector(".snk-panel")), "the panel takes focus on open, so Tab and Escape work without a click");
check(await inShadow(page, () => { const sh = window.__snakeEyes.shadow; const cb = getComputedStyle(sh.querySelector(".snk-btn")), ct = getComputedStyle(sh.querySelector(".snk-tag")); return cb.fontSize === "12px" && cb.fontWeight === "600" && ct.fontSize === "10px"; }), "button and tag typography apply (no invalid font shorthand)");

// click the 3rd item, then keyboard to the 2nd
const becomes = (p, n) => p.waitForFunction((want) => window.__snakeEyes.shadow.querySelector(".snk-item.snk-current")?.dataset.n === want, String(n), { timeout: 4000 }).then(() => true, () => false);
await inShadow(page, () => { window.__snakeEyes.shadow.querySelectorAll(".snk-item")[2].click(); });
check(await becomes(page, 3), "clicking an item makes it current and redraws");
check(await inShadow(page, () => window.__snakeEyes.shadow.querySelector(".snk-item.snk-current")?.getAttribute("aria-current") === "true"), "the current item is marked aria-current");
await inShadow(page, () => { window.__snakeEyes.shadow.querySelectorAll(".snk-item")[1].focus(); });
await page.keyboard.press("Enter");
check(await becomes(page, 2), "keyboard: focus + Enter activates an item");

// header controls must stay inside the panel and remain hit-testable. A single nowrap on the
// title once pushed Collapse and Close outside the box while every other check still passed.
const headerFits = async (pg, label) => {
  const r = await inShadow(pg, () => {
    const sh = window.__snakeEyes.shadow;
    const panel = sh.querySelector(".snk-panel").getBoundingClientRect();
    const out = [];
    for (const b of sh.querySelectorAll(".snk-head button")) {
      if (getComputedStyle(b).display === "none") continue;
      const box = b.getBoundingClientRect();
      const inside = box.left >= panel.left - 1 && box.right <= panel.right + 1 && box.top >= panel.top - 1 && box.bottom <= panel.bottom + 1;
      const hit = sh.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      if (!inside || !(hit === b || b.contains(hit))) out.push(`${b.className.replace("snk-btn ", "").replace("snk-icon ", "")}${inside ? " unclickable" : " clipped"}`);
    }
    return out;
  });
  check(r.length === 0, `${label}: every header control sits inside the panel and is clickable${r.length ? " (" + r.join(", ") + ")" : ""}`);
  const clipped = await inShadow(pg, () => [...window.__snakeEyes.shadow.querySelectorAll(".snk-head > *")].filter((e) => getComputedStyle(e).display !== "none" && e.scrollWidth > e.clientWidth + 1).map((e) => e.className || e.tagName));
  check(clipped.length === 0, `${label}: no header text is truncated${clipped.length ? " (" + clipped.join(", ") + ")" : ""}`);
  const contrast = await inShadow(pg, () => {
    const lum = (c) => { const v = c.match(/[\d.]+/g).slice(0, 3).map((n) => { n /= 255; return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
    const bad = [];
    const sh = window.__snakeEyes.shadow;
    sh.querySelector(".snk-rescan").hidden = false;
    for (const el of sh.querySelectorAll(".snk-btn, .snk-tag, .snk-count, .snk-stale, .snk-legend, .snk-title-h")) {
      let bg = getComputedStyle(el).backgroundColor, node = el;
      while (/rgba\(0, 0, 0, 0\)|transparent/.test(bg) && node.parentElement) { node = node.parentElement; bg = getComputedStyle(node).backgroundColor; }
      const l1 = lum(getComputedStyle(el).color), l2 = lum(bg);
      const r = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      if (r < 4.5) bad.push(`${el.className.split(" ").pop()} ${r.toFixed(2)}:1`);
    }
    sh.querySelector(".snk-rescan").hidden = true;
    return bad;
  });
  check(contrast.length === 0, `${label}: every control clears 4.5:1 contrast${contrast.length ? " (" + contrast.join(", ") + ")" : ""}`);
};
await headerFits(page, "header at 1280px");

// edge badges never overlap
const overlap = await inShadow(page, () => { const b = [...window.__snakeEyes.shadow.querySelectorAll(".snk-badge")].map((e) => e.getBoundingClientRect()); for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) { const a = b[i], c = b[j]; if (a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom) return true; } return false; });
check(!overlap, "guide badges of the active issue do not overlap");

// copy report
await inShadow(page, () => { window.__snakeEyes.shadow.querySelector(".snk-copy").click(); });
await page.waitForFunction(() => /Copied|failed/.test(window.__snakeEyes.shadow.querySelector(".snk-copy").textContent));
const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
check(/^# Snake Eyes spacing report/.test(clip), "Copy report puts the markdown on the clipboard");

// show all draws every guide (capped per issue), no current item
await inShadow(page, () => { window.__snakeEyes.shadow.querySelector(".snk-all").click(); });
const showAll = await inShadow(page, () => { const sh = window.__snakeEyes.shadow; return { lines: sh.querySelectorAll(".snk-line").length, boxes: sh.querySelectorAll(".snk-box").length, current: sh.querySelectorAll(".snk-current").length }; });
check(showAll.boxes === 6 && showAll.lines >= 6 && showAll.current === 0, `Show all draws a box per issue (${showAll.boxes}) and ${showAll.lines} guides`);
if (process.env.SNK_HERO) {
  await inShadow(page, () => window.__snakeEyes.shadow.activeElement?.blur()); // no stray focus ring in the docs shot
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1800); // let the Copied label reset
  mkdirSync(join(root, "docs"), { recursive: true });
  await page.screenshot({ path: join(root, "docs", "hero.png"), clip: { x: 0, y: 0, width: 1280, height: 900 } });
  console.log("hero: docs/hero.png refreshed");
}
await page.screenshot({ path: join(here, "screenshots", "fixture-all.png"), fullPage: true });

// collapse, escape, close button, toggle
await inShadow(page, () => { window.__snakeEyes.shadow.querySelector(".snk-collapse").click(); });
check(await inShadow(page, () => window.__snakeEyes.shadow.querySelector(".snk-panel").classList.contains("snk-collapsed")), "collapse button folds the panel");
await page.keyboard.press("Escape");
check(await page.evaluate(() => !document.getElementById("snake-eyes-root") && !window.__snakeEyes), "Escape closes the overlay");
await inject(page);
await inShadow(page, () => { window.__snakeEyes.shadow.querySelector(".snk-x").click(); });
check(await page.evaluate(() => !document.getElementById("snake-eyes-root") && !window.__snakeEyes), "close button removes the overlay");
await inject(page);
const toggled = await page.evaluate((src) => { const s = document.createElement("script"); s.textContent = src; document.head.appendChild(s); return !document.getElementById("snake-eyes-root") && !window.__snakeEyes; }, js);
check(toggled, "injecting again removes the overlay (toggle)");
await page.close();

// ---------- other widths: the scan completes and stays sane ----------
for (const [w, want] of [[390, 6], [768, 6]]) {
  const p = await context.newPage();
  await p.setViewportSize({ width: w, height: 844 });
  await p.goto("file://" + join(here, "fixture.html"));
  const rr = await inject(p);
  check(rr.issues.length === want, `fixture at ${w}px: exactly ${want} issues (found ${rr.issues.length})`);
  await headerFits(p, `header at ${w}px`);
  if (w === 390) {
    check(await p.evaluate(() => { const r = window.__snakeEyes.shadow.querySelector(".snk-panel").getBoundingClientRect(); return r.bottom <= innerHeight + 1 && r.height <= innerHeight * 0.5; }), "phone: panel becomes a bottom sheet under half the screen");
    await inShadow(p, () => { window.__snakeEyes.shadow.querySelector(".snk-collapse").click(); });
    check(await p.evaluate(() => { const r = window.__snakeEyes.shadow.querySelector(".snk-panel").getBoundingClientRect(); return Math.abs(r.bottom - innerHeight) <= 12; }), "phone: collapsing keeps the sheet at the bottom of the screen");
  }
  await p.close();
}

// ---------- a deliberately cramped panel must wrap, never truncate ----------
// CI runs on Linux, where the system font is wider than the one this was designed against, so a
// header sized to fit locally overflowed there. The header wraps now; this pins that behaviour.
const cramped = await context.newPage();
await cramped.goto("file://" + join(here, "fixture.html"));
await cramped.addStyleTag({ content: css });
await cramped.evaluate((c) => { window.__SNAKE_EYES_CSS__ = c + "\n.snk-panel{width:300px !important}"; window.__snakeEyesTest = true; }, panelCss);
await cramped.addScriptTag({ content: pure });
await cramped.addScriptTag({ content: js });
await cramped.waitForFunction(() => window.__snakeEyes && window.__snakeEyes.ready);
await headerFits(cramped, "header in a 300px panel");
check(await inShadow(cramped, () => window.__snakeEyes.shadow.querySelector(".snk-head").getBoundingClientRect().height > 40), "a panel too narrow for 1 row wraps the header instead of clipping it");
await cramped.close();

// ---------- docking must reflow fixed elements too ----------
// Narrowing the page reflows normal content, but position:fixed anchors to the viewport, so a
// sticky header or a cookie bar stayed full width and slid under the panel.
const fixedBar = await context.newPage();
await fixedBar.setViewportSize({ width: 1600, height: 900 });
await fixedBar.setContent(`<!doctype html><html><body style="margin:0;height:3000px">
  <div id="bar" style="position:fixed;top:0;left:0;right:0;height:60px;background:#123"></div>
  <div id="flow" style="height:200px;background:#eee"></div></body></html>`);
await inject(fixedBar);
const fit = await fixedBar.evaluate(() => {
  const page = document.documentElement.getBoundingClientRect().width;
  const bar = document.getElementById("bar").getBoundingClientRect();
  const flow = document.getElementById("flow").getBoundingClientRect();
  return { docked: document.documentElement.classList.contains("snk-docked"), page: Math.round(page), bar: Math.round(bar.right), flow: Math.round(flow.right) };
});
check(fit.docked, "a 1600px window docks");
check(fit.flow <= fit.page + 1, `normal content reflows inside the docked page (${fit.flow} vs ${fit.page})`);
check(fit.bar <= fit.page + 1, `a position:fixed bar reflows too instead of sliding under the panel (${fit.bar} vs ${fit.page})`);
await fixedBar.close();

// ---------- the panel goes stale when the viewport changes under it ----------
const stale = await context.newPage();
await stale.setViewportSize({ width: 1280, height: 900 });
await stale.goto("file://" + join(here, "fixture.html"));
const before = await inject(stale);
const headBefore = await inShadow(stale, () => window.__snakeEyes.shadow.querySelector(".snk-head").getBoundingClientRect().height);
await stale.setViewportSize({ width: 1000, height: 700 });
const staleOk = await stale.waitForFunction(() => { const sh = window.__snakeEyes.shadow; return !sh.querySelector(".snk-stale").hidden && sh.querySelector(".snk-all").hidden && [...sh.querySelectorAll(".snk-item")].every((b) => b.disabled); }, undefined, { timeout: 4000 }).then(() => true, () => false);
check(staleOk, "resizing marks the panel stale and withdraws the measurements it can no longer draw");
check(await inShadow(stale, () => window.__snakeEyes.shadow.querySelector(".snk-rescan").classList.contains("snk-urgent")), "a stale panel highlights Re-scan");
const headAfter = await inShadow(stale, () => window.__snakeEyes.shadow.querySelector(".snk-head").getBoundingClientRect().height);
check(headAfter <= headBefore + 1, `showing Re-scan does not grow the header (${headBefore}px to ${headAfter}px)`);
check(await inShadow(stale, () => { const sh = window.__snakeEyes.shadow; return sh.querySelector(".snk-rescan").getBoundingClientRect().width > 0 && /Re-scan/.test(sh.querySelector(".snk-stale").textContent); }), "the stale notice names the Re-scan button that fixes it");
// The docked page is narrower than the window, so the report must quote the page, not the window.
const measuredAt = Number(await stale.evaluate(() => window.__snakeEyes.report().match(/- Viewport: (\d+)x/)[1]));
check(measuredAt > 0 && measuredAt < 1280, `the report states the docked width it measured (${measuredAt}px), not the window or the resized one`);
check(await stale.evaluate(() => window.__snakeEyes.shadow.querySelectorAll(".snk-line").length === 0), "stale guides are cleared rather than left pointing at the old layout");
void before;
await stale.close();

// ---------- the stages run independently of each other ----------
// The point of splitting scan, analyze and report apart is that each can be driven alone.
// A fresh scan pushed through analyze must reproduce the live run exactly.
const stageCheck = await context.newPage();
await stageCheck.goto("file://" + join(here, "fixture.html"));
const live = await inject(stageCheck);
const replay = await stageCheck.evaluate(() => {
  const { scanPage, analyze, buildReport } = window.__snakeEyes.stages;
  const scan = scanPage();
  const seen = scan.nodesSeen;
  const { issues, total, dropped } = analyze(scan);
  const text = buildReport(issues, { total, dropped, scanTruncated: scan.scanTruncated })();
  return { titles: issues.map((i) => i.title), total, dropped, seen, mapEmptied: scan.info.size, text };
});
check(replay.titles.join("|") === live.issues.map((i) => i.title).join("|"), `analyze replays the same ${replay.titles.length} issues from a fresh scan`);
check(replay.seen > 0 && replay.mapEmptied === 0, `scanPage read ${replay.seen} elements and analyze released every record`);
check(/^# Snake Eyes spacing report/.test(replay.text), "buildReport works on issues it was handed rather than on a closure");
await stageCheck.close();

// ---------- Ruler measures the layout without judging it ----------
const rule = await context.newPage();
await rule.goto("file://" + join(here, "fixture.html"));
await inject(rule);
await inShadow(rule, () => { window.__snakeEyes.shadow.querySelector(".snk-ruler").click(); });
await rule.waitForTimeout(300);
const rulerOn = await inShadow(rule, () => {
  const sh = window.__snakeEyes.shadow;
  return { boxes: sh.querySelectorAll(".snk-rbox").length, sizes: sh.querySelectorAll(".snk-rtag").length, opts: !sh.querySelector(".snk-opts").hidden, pressed: sh.querySelector(".snk-ruler").getAttribute("aria-pressed") };
});
check(rulerOn.boxes > 0 && rulerOn.sizes === rulerOn.boxes, `Ruler outlines ${rulerOn.boxes} boxes and labels every one with its size`);
check(rulerOn.opts && rulerOn.pressed === "true", "Ruler opens its layer toggles and reports itself pressed");
// A UA [hidden] rule loses to any author rule that sets display, so a flex row with hidden set
// stays on screen. This asserts the attribute actually hides, for every element that uses it.
const hiddenWorks = async (pg, when) => {
  const shown = await inShadow(pg, () => [...window.__snakeEyes.shadow.querySelectorAll("[hidden]")].filter((e) => getComputedStyle(e).display !== "none").map((e) => e.className || e.tagName));
  check(shown.length === 0, `${when}: the hidden attribute really hides${shown.length ? " (still shown: " + shown.join(", ") + ")" : ""}`);
};
await hiddenWorks(rule, "with Ruler on");
// both header rows start on the same left edge, or the panel reads as 2 unrelated toolbars
const edges = await inShadow(rule, () => { const sh = window.__snakeEyes.shadow; const l = (s) => Math.round(sh.querySelector(s).getBoundingClientRect().left); return { logo: l(".snk-logo"), tools: l(".snk-tools"), firstTool: l(".snk-tools > *"), opts: l(".snk-opts label") }; });
check(edges.logo === edges.tools && edges.tools === edges.firstTool && edges.opts === edges.logo, `every row starts on the same left edge (logo ${edges.logo}, tools ${edges.firstTool}, options ${edges.opts})`);
check(/[0-9]+ x [0-9]+/.test(await inShadow(rule, () => window.__snakeEyes.shadow.querySelector(".snk-rtag").textContent)), "size labels read as width x height in px");
await inShadow(rule, () => { window.__snakeEyes.shadow.querySelector(".snk-opts input[data-k='sizes']").click(); });
await rule.waitForTimeout(200);
check(await inShadow(rule, () => window.__snakeEyes.shadow.querySelectorAll(".snk-rtag").length === 0), "unticking Sizes drops the size labels");
await inShadow(rule, () => { window.__snakeEyes.shadow.querySelector(".snk-ruler").click(); });
await rule.waitForTimeout(200);
check(await inShadow(rule, () => { const sh = window.__snakeEyes.shadow; return sh.querySelectorAll(".snk-rbox").length === 0 && sh.querySelector(".snk-opts").getBoundingClientRect().height === 0; }), "turning Ruler off clears it and the toggles take up no space");
await hiddenWorks(rule, "with Ruler off");

// ---------- the 4 views are one at a time, and each cleans up after itself ----------
const view = async (name) => {
  await inShadow(rule, (n) => { window.__snakeEyes.shadow.querySelector(`.snk-${n}`).click(); }, name);
  await rule.waitForTimeout(280);
  return inShadow(rule, () => {
    const sh = window.__snakeEyes.shadow;
    const pressed = ["ruler", "xray", "heat", "night"].filter((n) => sh.querySelector(`.snk-${n}`).getAttribute("aria-pressed") === "true");
    return { pressed, boxes: sh.querySelectorAll(".snk-rbox, .snk-xbox, .snk-heatbox, .snk-nvbox").length, tinted: document.documentElement.classList.contains("snk-nv") };
  });
};
for (const name of ["ruler", "xray", "heat", "night"]) {
  const v = await view(name);
  check(v.pressed.length === 1 && v.pressed[0] === name, `${name} is the only view pressed (${v.pressed.join(", ") || "none"})`);
  check(v.boxes > 0, `${name} draws ${v.boxes} boxes`);
  check(v.tinted === (name === "night"), `${name}: the page tint is ${name === "night" ? "on" : "off"}`);
}
const off = await view("night"); // clicking the active view turns it off
check(off.pressed.length === 0 && off.tinted === false, "clicking the active view turns it off and removes the page tint");
check(await rule.evaluate(() => !document.documentElement.classList.contains("snk-nv")), "night vision leaves no filter on the page");
await rule.close();

// ---------- Re-scan closes the overlay and asks the worker for a fresh pass ----------
// The worker side of this channel is covered in tests/extension.mjs, where Escape proves a
// message really reaches background.js. Here we prove the button sends the right one.
const rescan = await context.newPage();
await rescan.goto("file://" + join(here, "fixture.html"));
await rescan.addStyleTag({ content: css });
await rescan.evaluate((c) => {
  window.__SNAKE_EYES_CSS__ = c;
  window.__snakeEyesTest = true;
  window.__sent = [];
  window.chrome = { runtime: { id: "test", sendMessage: (m) => window.__sent.push(m) } };
}, panelCss);
await rescan.addScriptTag({ content: pure });
await rescan.addScriptTag({ content: js });
await rescan.waitForFunction(() => window.__snakeEyes && window.__snakeEyes.ready);
await inShadow(rescan, () => { window.__snakeEyes.shadow.querySelector(".snk-rescan").click(); });
await rescan.waitForTimeout(200);
const sent = await rescan.evaluate(() => ({ msgs: window.__sent.map((m) => m.type), gone: !document.getElementById("snake-eyes-root") }));
check(sent.gone && sent.msgs.join() === "rescan", `Re-scan tears the overlay down and asks for a new pass (sent: ${sent.msgs.join(", ") || "nothing"})`);
check(!sent.msgs.includes("closed"), "Re-scan does not also ask the worker to strip the CSS it is about to reuse");
await rescan.close();

// ---------- a page cannot dismiss or stale the panel behind the user's back ----------
const hostile = await context.newPage();
await hostile.goto("file://" + join(here, "fixture.html"));
await inject(hostile);
await hostile.evaluate(() => { window.__snakeEyesTest = false; });
await hostile.evaluate(() => {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  window.dispatchEvent(new Event("resize"));
});
await hostile.waitForTimeout(400);
check(await hostile.evaluate(() => !!window.__snakeEyes && !!document.getElementById("snake-eyes-root")), "a synthetic Escape from the page cannot close the overlay");
check(await hostile.evaluate(() => window.__snakeEyes.shadow.querySelector(".snk-stale").hidden), "a synthetic resize from the page cannot mark the panel stale");
await hostile.close();

// ---------- dark mode ----------
const darkCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
const dark = await darkCtx.newPage();
await dark.goto("file://" + join(here, "fixture.html"));
await inject(dark);
const darkStyle = await inShadow(dark, () => {
  const sh = window.__snakeEyes.shadow, cs = (sel) => getComputedStyle(sh.querySelector(sel));
  return { panel: cs(".snk-panel").backgroundColor, copyBg: cs(".snk-copy").backgroundColor, copyFg: cs(".snk-copy").color, tag: cs(".snk-tag").backgroundColor };
});
check(darkStyle.panel === "rgb(17, 24, 39)", `dark mode: the panel uses the dark surface (${darkStyle.panel})`);
check(darkStyle.copyBg !== darkStyle.panel && darkStyle.copyFg !== darkStyle.copyBg, "dark mode: the primary button keeps a visible boundary and readable label");
await headerFits(dark, "header in dark mode");
await dark.close();
await darkCtx.close();

// ---------- clean page: 0 issues, empty state ----------
const clean = await context.newPage();
await clean.goto("file://" + join(here, "clean.html"));
const c = await inject(clean);
check(c.issues.length === 0, `clean page: 0 issues (found ${c.issues.length}${c.issues.length ? ": " + c.issues.map((i) => i.title).join(" | ") : ""})`);
const empty = await inShadow(clean, () => { const sh = window.__snakeEyes.shadow; return { empty: !!sh.querySelector(".snk-empty"), ok: sh.querySelector(".snk-count").classList.contains("snk-count-ok") }; });
check(empty.empty && empty.ok, "clean page shows the empty state with a green count pill");
check(/No spacing issues found/.test(c.report), "clean page report says so");
await clean.close();

// ---------- the branches fixture.html cannot reach ----------
const other = await context.newPage();
await other.goto("file://" + join(here, "fixture2.html"));
const o = await inject(other);
const otext = o.issues.map((i) => `${i.title} | ${i.detail}`).join("\n");
check(o.issues.length === 3, `fixture2: exactly the 3 planted issues (found ${o.issues.length})`);
check(/Right edge off by 6px/.test(otext), "right edge: the item that stops 6px short");
check(/left 44px vs right 20px/.test(otext), "padding: uneven sides on a box no sibling matches");
check(/Section bottom padding 24px, others use 56px/.test(otext), "rhythm: the section that ends early");
await other.close();

// ---------- a page past the node budget says so ----------
const huge = await context.newPage();
await huge.setContent(`<!doctype html><html><body style="margin:0">${"<div><span>x</span></div>".repeat(6000)}</body></html>`);
const h = await inject(huge);
check(await huge.evaluate(() => window.__snakeEyes.scanTruncated === true && window.__snakeEyes.nodesSeen > 8000), "a page past the 8000-element budget stops scanning and records it");
check(/scan stopped after 8000 elements/.test(h.report), "the report warns that the page was larger than the budget");
await huge.close();

// ---------- cap: 200 uneven rows keep the 150 most severe ----------
// every row has gaps 10px then 20px, so every row is 1 high issue: 200 found, 150 kept
const cap = await context.newPage();
// 4 items per row with gaps 20, 10, 20: a real majority of 20px and 1 item that breaks it,
// which is exactly the shape the majority rule is meant to report.
const cell = (mr) => `<span class="c" style="width:40px;height:20px;background:#ddd${mr ? `;margin-right:${mr}px` : ""}"></span>`;
await cap.setContent(`<!doctype html><html><body style="margin:0">${Array.from({ length: 200 }, () => `<div class="row" style="display:flex;padding:4px 20px">${cell(20)}${cell(10)}${cell(20)}${cell(0)}</div>`).join("")}</body></html>`);
const cp = await inject(cap);
check(cp.total > 150 && cp.issues.length === 150 && cp.dropped === cp.total - 150, `cap: ${cp.issues.length} shown of ${cp.total}, ${cp.dropped} dropped`);
check(/shown of \d+/.test(cp.report) && /capped at 150/.test(cp.report), "cap is stated in the report");
check(await inShadow(cap, () => { const el = window.__snakeEyes.shadow.querySelector(".snk-count"); return /^150 of 200$/.test(el.textContent) && el.scrollWidth <= el.clientWidth + 1; }), "cap is stated in the panel header without truncating");
await cap.close();

} finally {
  await browser.close();
}
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
