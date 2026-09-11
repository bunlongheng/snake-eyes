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
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, permissions: ["clipboard-read", "clipboard-write"] });

async function inject(page) {
  await page.addStyleTag({ content: css });
  await page.evaluate((c) => { window.__SNAKE_EYES_CSS__ = c; window.__snakeEyesTest = true; }, panelCss);
  await page.addScriptTag({ content: pure });
  await page.addScriptTag({ content: js });
  await page.waitForFunction(() => window.__snakeEyes && window.__snakeEyes.ready);
  return page.evaluate(() => ({ issues: window.__snakeEyes.issues, total: window.__snakeEyes.total, dropped: window.__snakeEyes.dropped, report: window.__snakeEyes.report() }));
}
const inShadow = (page, fn) => page.evaluate(fn);

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
check(await inShadow(page, () => { const sh = window.__snakeEyes.shadow; const cb = getComputedStyle(sh.querySelector(".snk-btn")), ct = getComputedStyle(sh.querySelector(".snk-tag")); return cb.fontSize === "12px" && cb.fontWeight === "600" && ct.fontSize === "10px"; }), "button and tag typography apply (no invalid font shorthand)");

// click the 3rd item, then keyboard to the 2nd
await inShadow(page, () => { window.__snakeEyes.shadow.querySelectorAll(".snk-item")[2].click(); });
await page.waitForFunction(() => window.__snakeEyes.shadow.querySelector(".snk-item.snk-current")?.dataset.n === "3");
check(true, "clicking an item makes it current and redraws");
await inShadow(page, () => { window.__snakeEyes.shadow.querySelectorAll(".snk-item")[1].focus(); });
await page.keyboard.press("Enter");
await page.waitForFunction(() => window.__snakeEyes.shadow.querySelector(".snk-item.snk-current")?.dataset.n === "2");
check(true, "keyboard: focus + Enter activates an item");

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
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
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
for (const w of [390, 768]) {
  const p = await context.newPage();
  await p.setViewportSize({ width: w, height: 844 });
  await p.goto("file://" + join(here, "fixture.html"));
  const rr = await inject(p);
  check(rr.issues.length >= 3 && rr.issues.length <= 8, `fixture at ${w}px: scan completes with ${rr.issues.length} issues`);
  if (w === 390) check(await p.evaluate(() => { const r = window.__snakeEyes.shadow.querySelector(".snk-panel").getBoundingClientRect(); return r.bottom <= innerHeight + 1 && r.height <= innerHeight * 0.5; }), "phone: panel becomes a bottom sheet under half the screen");
  await p.close();
}

// ---------- clean page: 0 issues, empty state ----------
const clean = await context.newPage();
await clean.goto("file://" + join(here, "clean.html"));
const c = await inject(clean);
check(c.issues.length === 0, `clean page: 0 issues (found ${c.issues.length}${c.issues.length ? ": " + c.issues.map((i) => i.title).join(" | ") : ""})`);
const empty = await inShadow(clean, () => { const sh = window.__snakeEyes.shadow; return { empty: !!sh.querySelector(".snk-empty"), ok: sh.querySelector(".snk-count").classList.contains("snk-count-ok") }; });
check(empty.empty && empty.ok, "clean page shows the empty state with a green count pill");
check(/No spacing issues found/.test(c.report), "clean page report says so");
await clean.close();

// ---------- cap: 200 uneven rows keep the 150 most severe ----------
// every row has gaps 10px then 20px, so every row is 1 high issue: 200 found, 150 kept
const cap = await context.newPage();
await cap.setContent(`<!doctype html><html><body style="margin:0">${Array.from({ length: 200 }, () => `<div class="row" style="display:flex;padding:4px 20px"><span class="c" style="width:40px;height:20px;background:#ddd;margin-right:10px"></span><span class="c" style="width:40px;height:20px;background:#ddd;margin-right:20px"></span><span class="c" style="width:40px;height:20px;background:#ddd"></span></div>`).join("")}</body></html>`);
const cp = await inject(cap);
check(cp.total > 150 && cp.issues.length === 150 && cp.dropped === cp.total - 150, `cap: ${cp.issues.length} shown of ${cp.total}, ${cp.dropped} dropped`);
check(/shown of \d+/.test(cp.report) && /capped at 150/.test(cp.report), "cap is stated in the report");
check(await inShadow(cap, () => /of \d+ issues/.test(window.__snakeEyes.shadow.querySelector(".snk-count").textContent)), "cap is stated in the panel header");
await cap.close();

await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
