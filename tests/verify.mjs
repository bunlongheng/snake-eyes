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
check(/top padding 48px, others use 64px/.test(text), "section: hero top padding");
check(/Content inset \d+px in <section> "About/.test(text), "section: about section inset");
const sev = r.issues.map((i) => ({ high: 0, medium: 1, low: 2 })[i.severity]);
check(sev.every((s, i) => i === 0 || s >= sev[i - 1]), "issues are sorted high to low");
check(await page.evaluate(() => window.__snakeEyes.issues.every((i, n) => document.querySelector(i.selector) === window.__snakeEyes.elements[n])), "every selector resolves back to exactly its element");
check(/^# Snake Eyes spacing report/.test(r.report) && /- Page: file:\/\//.test(r.report) && /## 1\./.test(r.report) && /Selector: `/.test(r.report), "report is agent-ready markdown with a page id");

// panel
const ui = await inShadow(page, () => { const sh = window.__snakeEyes.shadow; return { items: sh.querySelectorAll(".snk-item").length, buttons: sh.querySelectorAll("button.snk-item").length, guides: sh.querySelectorAll(".snk-line").length, badges: sh.querySelectorAll(".snk-badge").length, boxes: sh.querySelectorAll(".snk-box").length, active: sh.querySelectorAll(".snk-box.snk-active").length, h2: !!sh.querySelector("h2"), aria: sh.querySelector("aside").getAttribute("aria-label") }; });
check(ui.items === 6 && ui.buttons === 6, "panel lists every issue as a real button");
check(ui.guides > 0 && ui.badges > 0 && ui.boxes === 6 && ui.active === 0, `on open every issue is drawn with guides and numbers, none singled out (${ui.boxes} boxes, ${ui.active} active)`);
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
check(await inShadow(page, () => { const sh = window.__snakeEyes.shadow; const cb = getComputedStyle(sh.querySelector(".snk-chip")), ct = getComputedStyle(sh.querySelector(".snk-tag")); return cb.fontSize === "12px" && cb.fontWeight === "600" && ct.fontSize === "10px"; }), "button and tag typography apply (no invalid font shorthand)");

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
      if (!inside || !(hit === b || b.contains(hit))) out.push(`${b.className.replace("snk-chip ", "").replace("snk-icon ", "")}${inside ? " unclickable" : " clipped"}`);
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
    for (const el of sh.querySelectorAll(".snk-chip, .snk-switch, .snk-tag, .snk-count, .snk-stale, .snk-legend, .snk-title-h")) {
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
await page.waitForFunction(() => !!window.__snakeEyes.shadow.querySelector(".snk-copy").dataset.state);
const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
check(/^# Snake Eyes spacing report/.test(clip), "Copy report puts the markdown on the clipboard");

// a clicked row narrows the layer to that finding alone, which is the only thing that still
// takes the layer away from the everything-drawn state it opens in
const picked = await inShadow(page, () => { const sh = window.__snakeEyes.shadow; return { lines: sh.querySelectorAll(".snk-line").length, boxes: sh.querySelectorAll(".snk-box").length, active: sh.querySelectorAll(".snk-box.snk-active").length, current: sh.querySelectorAll(".snk-item.snk-current").length }; });
check(picked.boxes === 1 && picked.active === 1 && picked.current === 1 && picked.lines > 0, `clicking a row draws that finding alone (${picked.boxes} box, ${picked.lines} guides)`);
if (process.env.SNK_HERO) {
  await inShadow(page, () => window.__snakeEyes.shadow.activeElement?.blur()); // no stray focus ring in the docs shot
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1800); // let the Copied label reset
  mkdirSync(join(root, "docs"), { recursive: true });
  await page.screenshot({ path: join(root, "docs", "hero.png"), clip: { x: 0, y: 0, width: 1280, height: 900 } });
  console.log("hero: docs/hero.png refreshed");
}
await page.screenshot({ path: join(here, "screenshots", "fixture-all.png"), fullPage: true });

// escape, close button, toggle
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
const staleOk = await stale.waitForFunction(() => { const sh = window.__snakeEyes.shadow; return !sh.querySelector(".snk-stale").hidden && sh.querySelector(".snk-count").hidden && [...sh.querySelectorAll(".snk-item")].every((b) => b.disabled); }, undefined, { timeout: 4000 }).then(() => true, () => false);
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
  return { boxes: sh.querySelectorAll(".snk-rbox").length, sizes: sh.querySelectorAll(".snk-rtag").length, opts: !sh.querySelector(".snk-opts").hidden, checked: sh.querySelector(".snk-ruler").getAttribute("aria-checked"), views: ["xray", "heat", "night"].filter((n) => sh.querySelector(`.snk-${n}`).getAttribute("aria-pressed") === "true").length };
});
check(rulerOn.boxes > 0 && rulerOn.sizes === rulerOn.boxes, `Ruler outlines ${rulerOn.boxes} boxes and labels every one with its size`);
check(rulerOn.opts && rulerOn.checked === "true", "Ruler opens its layer toggles and reports itself switched on");
check(rulerOn.views === 0, "Ruler on its own leaves every mode chip unpressed: it is a switch, not a 4th view");
// The point of making Ruler a switch: it has to survive a mode being turned on over it, and the
// 2 layers have to be on screen together. Every painter used to clear the layer for itself.
await inShadow(rule, () => { window.__snakeEyes.shadow.querySelector(".snk-heat").click(); });
await rule.waitForTimeout(400);
const both = await inShadow(rule, () => {
  const sh = window.__snakeEyes.shadow;
  return { rboxes: sh.querySelectorAll(".snk-rbox").length, heat: sh.querySelectorAll(".snk-heatbox").length, checked: sh.querySelector(".snk-ruler").getAttribute("aria-checked"), heatOn: sh.querySelector(".snk-heat").getAttribute("aria-pressed") };
});
check(both.rboxes > 0 && both.heat > 0 && both.checked === "true" && both.heatOn === "true", `Ruler lays over a mode: ${both.rboxes} ruler boxes and ${both.heat} heat blobs drawn together`);
await inShadow(rule, () => { window.__snakeEyes.shadow.querySelector(".snk-ruler").click(); });
await rule.waitForTimeout(300);
const rulerOff = await inShadow(rule, () => {
  const sh = window.__snakeEyes.shadow;
  return { rboxes: sh.querySelectorAll(".snk-rbox").length, heat: sh.querySelectorAll(".snk-heatbox").length, opts: !sh.querySelector(".snk-opts").hidden };
});
check(rulerOff.rboxes === 0 && rulerOff.heat > 0 && !rulerOff.opts, "switching Ruler off leaves the mode under it running");
// Clicking a row is how you follow a finding up, and it used to drop you out of whatever lens you
// were reading the page through to do it. Heat is on here, and has to still be on afterwards.
await inShadow(rule, () => { window.__snakeEyes.shadow.querySelectorAll(".snk-item")[1].click(); });
await rule.waitForTimeout(500);
const clickedUnderHeat = await inShadow(rule, () => {
  const sh = window.__snakeEyes.shadow;
  return { heat: sh.querySelectorAll(".snk-heatbox").length, heatOn: sh.querySelector(".snk-heat").getAttribute("aria-pressed"), current: sh.querySelector(".snk-item.snk-current")?.dataset.n, boxes: sh.querySelectorAll(".snk-box").length };
});
check(clickedUnderHeat.heatOn === "true" && clickedUnderHeat.heat > 0, `clicking a row keeps the lens it was read through (heat still on, ${clickedUnderHeat.heat} blobs)`);
check(clickedUnderHeat.current === "2" && clickedUnderHeat.boxes === 1, `clicking a row under a lens still goes to that finding (row ${clickedUnderHeat.current}, ${clickedUnderHeat.boxes} box drawn)`);
// back to Ruler alone, which is the state the checks below describe
await inShadow(rule, () => { const sh = window.__snakeEyes.shadow; sh.querySelector(".snk-heat").click(); sh.querySelector(".snk-ruler").click(); });
await rule.waitForTimeout(400);
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
    const pressed = ["xray", "heat", "night"].filter((n) => sh.querySelector(`.snk-${n}`).getAttribute("aria-pressed") === "true");
    return { pressed, boxes: sh.querySelectorAll(".snk-rbox, .snk-xbox, .snk-heatbox, .snk-mtarget").length, tinted: document.documentElement.classList.contains("snk-nv") };
  });
};
for (const name of ["xray", "heat", "night"]) {
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

// ---------- the list follows the page ----------
// A long page means scrolling to something you can see is wrong, then hunting the panel for which
// of 40 rows describes it. The spy is what closes that gap, so it gets a test that actually scrolls.
const spyPage = await context.newPage();
await spyPage.setViewportSize({ width: 1280, height: 420 });
await spyPage.goto("file://" + join(here, "fixture.html"));
await inject(spyPage);
const currentN = () => spyPage.evaluate(() => window.__snakeEyes.shadow.querySelector(".snk-item.snk-current")?.dataset.n || null);
// what the spy should pick: the finding whose centre is nearest the middle of the viewport
const expectedN = () => spyPage.evaluate(() => {
  const mid = scrollY + innerHeight / 2;
  let best = null, bestD = Infinity;
  window.__snakeEyes.issues.forEach((i, n) => {
    const r = window.__snakeEyes.elements[n].getBoundingClientRect();
    const d = Math.abs(r.top + scrollY + r.height / 2 - mid);
    if (d < bestD) { bestD = d; best = i.n; }
  });
  return String(best);
});
const scrollTo = async (y) => { await spyPage.evaluate((v) => scrollTo({ top: v }), y); await spyPage.waitForTimeout(220); };
await scrollTo(0);
const atTop = await currentN();
check(atTop === await expectedN(), `scrolled to the top, the list selects the finding nearest the viewport (row ${atTop})`);
await scrollTo(99999);
const atBottom = await currentN();
check(atBottom === await expectedN(), `scrolled to the bottom, the list selects the finding nearest the viewport (row ${atBottom})`);
check(atTop !== atBottom, `scrolling the page moves the selection (${atTop} at the top, ${atBottom} at the bottom)`);
// the selected row has to be on screen in the panel, or following the page is no help
check(await spyPage.evaluate(() => {
  const sh = window.__snakeEyes.shadow, list = sh.querySelector(".snk-list"), row = sh.querySelector(".snk-item.snk-current");
  if (!row) return false;
  const lr = list.getBoundingClientRect(), rr = row.getBoundingClientRect();
  return rr.bottom > lr.top - 1 && rr.top < lr.bottom + 1;
}), "the selected row is scrolled into view inside the panel");
// and the page itself must not have been dragged by the panel scrolling its own list
const beforeY = await spyPage.evaluate(() => scrollY);
await spyPage.waitForTimeout(250);
check(await spyPage.evaluate(() => scrollY) === beforeY, "following the page does not scroll the page");
await spyPage.close();

// ---------- dark mode ----------
const darkCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
const dark = await darkCtx.newPage();
await dark.goto("file://" + join(here, "fixture.html"));
await inject(dark);
const darkStyle = await inShadow(dark, () => {
  const sh = window.__snakeEyes.shadow, cs = (sel) => getComputedStyle(sh.querySelector(sel));
  return { panel: cs(".snk-panel").backgroundColor, chipBg: cs(".snk-chip").backgroundColor, chipFg: cs(".snk-chip").color, tag: cs(".snk-tag").backgroundColor };
});
check(darkStyle.panel === "rgb(17, 24, 39)", `dark mode: the panel uses the dark surface (${darkStyle.panel})`);
check(darkStyle.chipFg !== darkStyle.chipBg, "dark mode: a view chip keeps a readable label against its own background");
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
check(/Section bottom padding 24px, others use 56px/.test(otext), "section: the section that ends early");
await other.close();

// ---------- every page view actually paints ----------
// X-ray shipped broken: overlay.js created .snk-xbox nodes and panel.css had no rule for them, so
// 1200 divs went onto the page with an inline border-colour, no position and no border-width, and
// painted nothing. Counting the nodes would have passed. This checks they are visible.
const views = await context.newPage();
// Section 3 is padded unlike the other 5 on purpose, and the sections are tall enough to be
// judged as sections: Heat maps findings rather than nesting depth, so a page with nothing wrong
// has nothing to paint and this check would pass on an empty layer.
await views.setContent(`<!doctype html><meta charset=utf-8><body style="margin:0">
  ${Array.from({ length: 6 }, (_, i) => `<section style="padding:${i === 2 ? "40px 40px 16px" : "40px"}"><div style="height:90px"><div><p>row ${i}</p></div></div></section>`).join("")}`);
await inject(views);
for (const [name, cls] of [["ruler", ".snk-rbox"], ["xray", ".snk-xbox"], ["heat", ".snk-heatbox"], ["night", ".snk-mtarget"]]) {  // ruler included: it paints the same way, it just is not a mode
  const seen = await views.evaluate(([m, sel]) => {
    const sh = window.__snakeEyes.shadow;
    sh.querySelector(`.snk-${m}`).click();
    const nodes = [...sh.querySelectorAll(sel)];
    const paints = nodes.filter((n) => {
      const c = getComputedStyle(n), r = n.getBoundingClientRect();
      const edge = parseFloat(c.borderTopWidth) > 0 && c.borderTopStyle !== "none";
      const fill = (c.backgroundColor !== "rgba(0, 0, 0, 0)" && c.backgroundColor !== "transparent") || c.backgroundImage !== "none";
      return c.position === "absolute" && (edge || fill) && r.width > 2 && r.height > 2;
    });
    return { drawn: nodes.length, paints: paints.length };
  }, [name, cls]);
  check(seen.drawn > 0 && seen.paints === seen.drawn, `${name}: every box it draws is actually visible (${seen.paints}/${seen.drawn})`);
}
await views.close();
// ---------- type scale: the near miss fires, the different role does not ----------
const type = await context.newPage();
await type.setContent(`<!doctype html><meta charset=utf-8><style>
  body { margin:0; font:16px/1.5 system-ui; padding:40px }
  .card { margin-bottom:32px }
  .card-h { font-size:24px; margin:0 0 12px } .card-b { font-size:16px; margin:0 }
  .card:nth-child(4) .card-h { font-size:22px }   /* 8% off: meant to match, does not */
  .card:nth-child(6) .card-b { font-size:14px }   /* 13% off */
  .hero { font-size:48px; margin:0 0 8px }        /* 200% off: a role, not a defect */
  .lede { font-size:24px; margin:0 0 40px }
</style>
<p class=hero>Hi.</p><p class=lede>Senior Full-Stack Developer</p>
${Array.from({ length: 5 }, (_, i) => `<div class=card><h2 class=card-h>Card ${i + 1}</h2><p class=card-b>body copy ${i + 1}</p></div>`).join("")}`);
const ty = await inject(type);
const tset = ty.issues.filter((i) => i.type === "type");
check(tset.length === 2, `type: exactly the 2 near misses (found ${tset.length}: ${tset.map((i) => i.title).join(" | ")})`);
check(tset.some((i) => /<h2> "Card 2" is 22px/.test(i.title)), "type: the 22px heading among 24px ones");
check(tset.some((i) => /<p> "body copy 4" is 14px/.test(i.title)), "type: the 14px body copy among 16px ones");
check(!tset.some((i) => /48px|Hi\./.test(i.title)), "type: the 48px hero <p> is a different role and stays quiet");
await type.close();

// ---------- the 3 false positives a real theme page produced, and the real defect beside each ----------
// kactusbio.com reported 6 findings and 5 of them were properties of the grid framework or of a
// decision somebody made on purpose. Every shape below is taken from that page: the left column is
// what must stay quiet, the right column is the defect of the same kind that must still fire.
const fp = await context.newPage();
await fp.setContent(`<!doctype html><meta charset=utf-8><style>
  body { margin:0; font:16px/1.5 system-ui }
  .blk, .cell { width:120px; height:80px; background:#e5e7eb }
  main p { font-size:20px } footer p { font-size:16px }
  h2 { font-size:45px; margin:0 } #small { font-size:40px }
  .strip h3 { font-size:50px; margin:0 } #wide { font-size:56px } #narrow { font-size:45px }
</style>
<!-- gap: an explicit margin on a block that is not the same kind as the row is authored spacing -->
<div style="display:flex;column-gap:20px">
  <div class="blk blk--logo" style="margin-right:35px">logoA</div>
  <div class="blk blk--menu">m1</div><div class="blk blk--menu">m2</div><div class="blk blk--menu">m3</div></div>
<!-- gap: the same margin on a block that shares its siblings' class is a stray, and still fires -->
<div style="display:flex;column-gap:20px">
  <div class="cell" style="margin-right:35px">cellB</div>
  <div class="cell">c2</div><div class="cell">c3</div><div class="cell">c4</div></div>
<!-- padding: a transparent box, then a divider rule, then a box you can actually see -->
<div><div style="width:400px;height:120px;padding:20px 0 20px 22px"><span style="display:block">gutter</span></div>
  <div style="width:400px;height:120px;padding:20px 0 20px 45px;border-left:1px solid #ccc"><span style="display:block">rule</span></div>
  <div style="width:400px;height:120px;padding:20px 20px 20px 44px;background:#fff6e0"><span style="display:block">cardP</span></div></div>
<!-- edge: 2 columns of a 2-up row, centred so their tops differ, are not a stack -->
<div style="display:flex;align-items:center;width:1192px">
  <div class="col" style="width:596px;height:480px;background:#eef2ff">colA</div>
  <div class="col" style="width:596px;height:390px;background:#eef2ff">colB</div></div>
<!-- edge: a real stack, 1 item nudged 6px right, still fires -->
<div><div class="li" style="width:300px;height:40px;background:#eef2ff">li1</div>
  <div class="li" style="width:300px;height:40px;margin-left:6px;background:#eef2ff">li2</div>
  <div class="li" style="width:300px;height:40px;background:#eef2ff">li3</div></div>
<!-- edge: a negative-margin grid row paints where its cells do, not where its box hangs -->
<div style="width:600px">
  <div class="sec" style="height:60px;background:#eef2ff">sec1</div>
  <div class="sec" style="height:60px;margin-left:-22px;display:flex"><div style="padding-left:22px;width:600px">gut</div></div>
  <div class="sec" style="height:60px;background:#eef2ff">sec3</div></div>
<!-- type: 1 component rendered 6 times must not outvote 2 real section headings -->
<div><div class="strip"><h3>Reproducibility</h3><h3>Responsiveness</h3><h3>Resolve</h3>
    <h3>Reasoning</h3><h3>Relevance</h3><h3>Responsibility</h3></div></div>
<div><div class="strip"><h3 id=wide>Why researchers choose KACTUS</h3></div></div>
<div><div class="strip"><h3 id=narrow>Curated protein catalog</h3></div></div>
<!-- type: the footer line is not body copy, the short heading is a broken heading level -->
<main><p>main copy one</p><p>main copy two</p><p>main copy three</p>
  <h2>Heading A</h2><h2>Heading B</h2><h2 id=small>Partners heading</h2></main>
<footer><p>footer address line</p></footer>`);
const f = await inject(fp);
const only = (t) => f.issues.filter((i) => i.type === t);
const names = (t) => only(t).map((i) => `${i.title} | ${i.detail}`).join(" / ") || "none";
check(only("gaps").length === 1 && /cellB/.test(names("gaps")),
  `gap: the authored 35px margin is quiet and the stray one fires (${names("gaps")})`);
check(only("padding").length === 1 && /left 44px vs right 20px/.test(names("padding")),
  `padding: only the box whose edges are drawn is reported (${names("padding")})`);
check(only("type").length === 1 && /Partners heading/.test(names("type")) && /is 40px/.test(names("type")),
  `type: the footer line is quiet and the 40px <h2> among 45px ones fires (${names("type")})`);
check(!/596px/.test(names("align")) && /Left edge off by 6px/.test(names("align")),
  `edge: a 2-up row is not a stack, and the 6px nudge in a real stack still fires (${names("align")})`);
check(!/22px/.test(names("align")),
  `edge: a negative-margin grid row is measured where it paints (${names("align")})`);
check(!/<h3>/.test(names("type")) && !/Reproducibility|KACTUS|Curated/.test(names("type")),
  `type: 6 instances of 1 component cannot outvote 2 section headings (${names("type")})`);
await fp.close();

// ---------- a finding says why it is one, and which one it is ----------
check(r.issues.every((i) => typeof i.why === "string" && i.why.length > 40), "every issue carries a why line");
check(/- Why it matters: /.test(r.report), "the report carries the why line for an agent");
// its own page: the fixture tab was closed further up, and a row is only readable while it exists
const rowPage = await context.newPage();
await rowPage.goto("file://" + join(here, "fixture.html"));
await inject(rowPage);
const rows = await inShadow(rowPage, () => [...window.__snakeEyes.shadow.querySelectorAll(".snk-item")].map((b) => ({
  where: b.querySelector(".snk-where").textContent, why: b.querySelector(".snk-why").textContent })));
check(rows.every((x) => x.where.length > 2), "every row shows the selector, so 2 findings with the same title are told apart");
check(new Set(rows.map((x) => x.where)).size === rows.length, "those selectors are unique per row");
check(rows.every((x) => x.why.length > 40), "every row shows its why line");
await rowPage.close();

// ---------- an inline stylesheet is never an element's name ----------
const styled = await context.newPage();
await styled.setContent(`<!doctype html><meta charset=utf-8><body style="margin:0">
  <div><style>h2 { font-weight: 500; } .lorem { color: red }</style>
    <div style="padding:20px 20px 20px 44px;width:400px;height:120px">a</div></div></body>`);
const st = await inject(styled);
check(!st.issues.some((i) => /font-weight|\{/.test(i.title + i.detail)), `no finding is named after CSS source${st.issues.filter((i) => /\{/.test(i.title)).map((i) => ` (${i.title})`).join("")}`);
await styled.close();

// ---------- labels on the page's top edge stay on the page ----------
// A badge is centred on the point it labels and the caption sits above its box, so a section
// flush with y=0 used to push both off the top of the page: the 0px value, the one worth reading,
// was the one you could not read.
const edge = await context.newPage();
await edge.setContent(`<!doctype html><meta charset=utf-8><style>
  body { margin:0; font:16px system-ui }
  section { padding:48px 24px; min-height:160px }
  #home { padding-top:0; padding-bottom:0 }
  #home > :first-child { margin-top:0 } #home > :last-child { margin-bottom:0 }
</style>
<section id=home><h1>Hero</h1><p>flush with the top of the page</p></section>
${Array.from({ length: 8 }, (_, i) => `<section><h2>S${i + 2}</h2><p>body</p></section>`).join("")}`);
await inject(edge);
const labels = await edge.evaluate(() => {
  const sh = window.__snakeEyes.shadow;
  sh.querySelector(".snk-item").click();
  const L = sh.querySelector(".snk-layer").getBoundingClientRect();
  return [...sh.querySelectorAll(".snk-badge, .snk-boxtag")].map((el) => {
    const r = el.getBoundingClientRect();
    return { text: el.textContent, top: Math.round(r.top - L.top), left: Math.round(r.left - L.left) };
  });
});
const offPage = labels.filter((l) => l.top < 0 || l.left < 0);
check(labels.length > 0, `the top-edge section is labelled at all (${labels.length} labels)`);
check(offPage.length === 0, `no label hangs off the top or left of the page${offPage.length ? ": " + offPage.map((l) => `"${l.text}" at ${l.left},${l.top}`).join(" | ") : ""}`);
await edge.close();

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
