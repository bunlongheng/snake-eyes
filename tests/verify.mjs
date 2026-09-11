// Snake Eyes test: loads the fixture page in headless Chromium, injects the overlay the
// same way background.js does, and checks that every planted inconsistency is found,
// the panel works, and the report copies. Also renders docs/hero.png.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const css = readFileSync(join(root, "overlay.css"), "utf8");
const panelCss = readFileSync(join(root, "panel.css"), "utf8");
const js = readFileSync(join(root, "overlay.js"), "utf8");
mkdirSync(join(here, "screenshots"), { recursive: true });
mkdirSync(join(root, "docs"), { recursive: true });

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) failed++; };

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, permissions: ["clipboard-read", "clipboard-write"] });
const page = await context.newPage();
await page.goto("file://" + join(here, "fixture.html"));

// inject exactly what background.js injects, plus the panel CSS the worker hands to the shadow root
await page.addStyleTag({ content: css });
await page.evaluate((c) => { window.__SNAKE_EYES_CSS__ = c; }, panelCss);
await page.addScriptTag({ content: js });
await page.waitForTimeout(300);

const result = await page.evaluate(() => ({ issues: window.__snakeEyes.issues, report: window.__snakeEyes.report() }));
const types = result.issues.map((i) => i.type);
const titles = result.issues.map((i) => `${i.title} | ${i.detail}`).join("\n");
check(result.issues.length >= 6, `finds the planted issues (found ${result.issues.length})`);
check(types.includes("gaps") && /horizontal gaps/.test(titles), "uneven horizontal gap in the card row");
check(/vertical gaps/.test(titles), "uneven vertical gap in the stack");
check(types.includes("align") && /off by 6px/.test(titles), "the 6px indented list item");
check(types.includes("padding") && /left 16px vs right 24px/.test(titles), "asymmetric padding on the callout");
check(/top padding 48px, others use 64px/.test(titles), "section rhythm: hero top padding");
check(/Content inset \d+px in <section> "About/.test(titles), "content inset: about section");
check(result.issues.every((i) => i.selector && !/undefined/.test(i.selector)), "every issue has a selector");
check(/^# Snake Eyes spacing report/.test(result.report) && /## 1\./.test(result.report) && /Selector: `/.test(result.report), "report is agent-ready markdown");

// panel + guides in the shadow root
const ui = await page.evaluate(() => {
  const sh = document.getElementById("snake-eyes-root").shadowRoot;
  return { items: sh.querySelectorAll(".snk-item").length, guides: sh.querySelectorAll(".snk-line").length, badges: sh.querySelectorAll(".snk-badge").length, box: !!sh.querySelector(".snk-box.snk-active") };
});
check(ui.items === result.issues.length, `panel lists every issue (${ui.items})`);
check(ui.guides > 0 && ui.badges > 0 && ui.box, "first issue is highlighted with guides and numbers");

// click the 3rd item, guides change and the item is marked current
await page.evaluate(() => { const sh = document.getElementById("snake-eyes-root").shadowRoot; sh.querySelectorAll(".snk-item")[2].click(); });
await page.waitForTimeout(400);
const current = await page.evaluate(() => { const sh = document.getElementById("snake-eyes-root").shadowRoot; return sh.querySelector(".snk-item.snk-current")?.dataset.n; });
check(current === "3", "clicking an item makes it current and redraws");

// copy report
await page.evaluate(() => { document.getElementById("snake-eyes-root").shadowRoot.querySelector(".snk-copy").click(); });
await page.waitForTimeout(300);
// eslint-disable-next-line no-undef
const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
check(/^# Snake Eyes spacing report/.test(clip), "Copy report puts the markdown on the clipboard");

// show all, then screenshot for the README
await page.evaluate(() => { document.getElementById("snake-eyes-root").shadowRoot.querySelector(".snk-all").click(); });
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(400);
await page.screenshot({ path: join(root, "docs", "hero.png"), clip: { x: 0, y: 0, width: 1280, height: 900 } });
await page.screenshot({ path: join(here, "screenshots", "fixture-all.png"), fullPage: true });

// toggle off by injecting again
await page.addScriptTag({ content: js });
const gone = await page.evaluate(() => !document.getElementById("snake-eyes-root") && !window.__snakeEyes);
check(gone, "injecting again removes the overlay (toggle)");

await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
