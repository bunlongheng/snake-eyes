// Snake Eyes across a whole site instead of 1 page.
//
// Why this is a script and not a button in the extension: the extension holds activeTab, which is
// permission to read the 1 tab you clicked on and nothing else. Reading a second page needs
// host_permissions for the whole web, and a spacing tool that asks to read every site you visit is
// both a hard store review and a worse trade than running it yourself. The engine is identical -
// lib/pure.js and overlay.js injected the same way background.js injects them - so a finding here
// is the same finding the panel would show on that page.
//
// Usage: npm run crawl -- https://example.com [--depth 1] [--max 25] [--width 1280] [--out report.md]
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const R = new URL("..", import.meta.url);
const read = (f) => readFileSync(new URL(f, R), "utf8");
const overlayCss = read("overlay.css"), panelCss = read("panel.css");
const pure = read("lib/pure.js"), overlay = read("overlay.js");

const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i === -1 ? fallback : argv[i + 1]; };
const start = argv.find((a) => !a.startsWith("--") && /^https?:\/\//.test(a));
if (!start) {
  console.error("usage: npm run crawl -- <url> [--depth 1] [--max 25] [--width 1280] [--out report.md]");
  process.exit(2);
}
const DEPTH = Number(flag("depth", 1));
const MAX = Number(flag("max", 25));
const WIDTH = Number(flag("width", 1280));
const OUT = flag("out", null);
const origin = new URL(start).origin;

// A URL is the same page whether or not it carries a fragment or a trailing slash, and scanning it
// twice would double every finding on it.
const canon = (u) => {
  try {
    const x = new URL(u, start);
    if (!/^https?:$/.test(x.protocol)) return null;
    x.hash = "";
    if (x.pathname.length > 1 && x.pathname.endsWith("/")) x.pathname = x.pathname.slice(0, -1);
    return x.toString();
  } catch { return null; }
};
// Files are still worth link-checking but there is no layout in a PDF to measure, so they are
// never queued for a scan. /resume has no extension and serves a download anyway, which is why
// the navigation is guarded as well.
const looksLikeFile = (u) => /\.(pdf|zip|gz|dmg|exe|png|jpe?g|gif|svg|webp|avif|ico|mp4|webm|mp3|wav|docx?|xlsx?|pptx?|csv|txt|xml|json)$/i.test(new URL(u).pathname);

const browser = await chromium.launch();
// A real User-Agent, because a headless default gets 403 from every bot filter on the web and a
// link that Cloudflare refused to show a robot is not a link that is broken for your readers.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 SnakeEyes/1.2";
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 900 }, userAgent: UA });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// What a status actually means, which is the whole difference between a useful monitor and one
// nobody reads. 404 and a name that does not resolve are dead. 5xx is broken. 401, 403 and 429 are
// the server declining to answer a crawler, so they are reported as unverified and never as dead:
// the first run of this reported 15 of your own project pages as dead links when the only thing
// wrong was that this script asked for them all at once.
const verdictOf = (status, error) => {
  if (error) return /no DNS record|connection refused/.test(error) ? "dead" : "unverified";
  if (status === 404 || status === 410) return "dead";
  // 999 is LinkedIn's "you are a bot" code and anything above 599 is not a real HTTP status at all,
  // so both are a refusal to answer rather than evidence of a broken page.
  if (status === 999 || status > 599) return "unverified";
  if (status >= 500) return "broken";
  if (status === 401 || status === 403 || status === 429) return "unverified";
  return "ok";
};

// HEAD first because it costs no body. Plenty of servers answer HEAD with 405 or 501 while serving
// the page fine, so those fall back to GET rather than being called broken.
const linkCache = new Map();
const checkLink = async (url, attempt = 0) => {
  if (linkCache.has(url)) return linkCache.get(url);
  let out;
  try {
    let res = await ctx.request.head(url, { timeout: 15000, maxRedirects: 5 });
    if (res.status() === 405 || res.status() === 501) res = await ctx.request.get(url, { timeout: 20000, maxRedirects: 5 });
    // 429 means we asked too fast, not that the page is gone. Back off once and take the 2nd answer.
    if (res.status() === 429 && attempt === 0) { await sleep(2000); linkCache.delete(url); return checkLink(url, 1); }
    out = { status: res.status(), modified: res.headers()["last-modified"] || "" };
  } catch (e) {
    const raw = String(e.message || e).split("\n")[0];
    const short = /ENOTFOUND|ERR_NAME/.test(raw) ? "no DNS record" : /ECONNREFUSED/.test(raw) ? "connection refused"
      : /EAI_AGAIN/.test(raw) ? "DNS lookup failed" : /[Tt]imeout/.test(raw) ? "timed out" : raw.replace(/^apiRequestContext\.\w+: /, "").slice(0, 60);
    out = { status: 0, modified: "", error: short, raw };
  }
  out.verdict = verdictOf(out.status, out.error);
  delete out.raw;
  linkCache.set(url, out);
  return out;
};

const pages = [];          // { url, depth, issues, report, error }
const linksOn = new Map(); // url -> the page it was first found on
const queue = [{ url: canon(start), depth: 0 }];
const seen = new Set([canon(start)]);

while (queue.length && pages.length < MAX) {
  const { url, depth } = queue.shift();
  process.stderr.write(`scanning ${url} ... `);
  const page = await ctx.newPage();
  try {
    const res = await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    // A 404 page renders, so it would scan happily and report spacing issues on an error page.
    // It is already named in the dead links table; measuring it twice helps nobody.
    if (res && !res.ok()) {
      pages.push({ url, depth, issues: [], total: 0, report: "", error: `HTTP ${res.status()}` });
      process.stderr.write(`HTTP ${res.status()}, not scanned\n`);
      await page.close();
      continue;
    }
    const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href") || ""));
    await page.addStyleTag({ content: overlayCss });
    await page.evaluate((c) => { window.__SNAKE_EYES_CSS__ = c; window.__snakeEyesTest = true; window.__snakeEyesNoDock = true; }, panelCss);
    await page.addScriptTag({ content: pure });
    await page.addScriptTag({ content: overlay });
    await page.waitForFunction(() => window.__snakeEyes && window.__snakeEyes.ready, null, { timeout: 30000 });
    const got = await page.evaluate(() => ({ issues: window.__snakeEyes.issues, total: window.__snakeEyes.total, report: window.__snakeEyes.report() }));
    pages.push({ url, depth, ...got });
    for (const h of hrefs) {
      const abs = canon(h);
      if (!abs) continue;
      if (!linksOn.has(abs)) linksOn.set(abs, url);
      if (abs.startsWith(origin) && depth < DEPTH && !seen.has(abs) && !looksLikeFile(abs)) { seen.add(abs); queue.push({ url: abs, depth: depth + 1 }); }
    }
    process.stderr.write(`${got.total} issues, ${hrefs.length} links\n`);
  } catch (e) {
    const msg = String(e.message || e).split("\n")[0];
    // A URL that serves a download is a file, not a page that failed to render.
    const skipped = /Download is starting/.test(msg);
    pages.push({ url, depth, issues: [], total: 0, report: "", error: skipped ? "file download, not a page" : msg });
    process.stderr.write(`${skipped ? "skipped (file)" : `FAILED: ${msg}`}\n`);
  }
  await page.close();
}

// Every link found anywhere gets checked, including the ones off-site, because a dead link to
// someone else's page is still dead on yours.
process.stderr.write(`checking ${linksOn.size} links ... `);
const status = new Map();
// The site's own links go through a narrow, spaced queue and everyone else's go wide. Hammering
// your own origin with 8 parallel HEADs is what produced the 429s in the first place.
const drain = async (list, pool, spacing) => {
  const q = [...list];
  await Promise.all(Array.from({ length: pool }, async () => {
    for (let u = q.shift(); u !== undefined; u = q.shift()) {
      status.set(u, await checkLink(u));
      if (spacing) await sleep(spacing);
    }
  }));
};
const own = [...linksOn.keys()].filter((u) => u.startsWith(origin));
const ext = [...linksOn.keys()].filter((u) => !u.startsWith(origin));
await drain(own, 2, 150);
await drain(ext, 8, 0);
const dead = [...status.entries()].filter(([, v]) => v.verdict === "dead" || v.verdict === "broken");
const unverified = [...status.entries()].filter(([, v]) => v.verdict === "unverified");
process.stderr.write(`${dead.length} dead or broken, ${unverified.length} unverified\n`);

const counts = { high: 0, medium: 0, low: 0 };
for (const p of pages) for (const i of p.issues) counts[i.severity]++;
const totalIssues = pages.reduce((n, p) => n + p.total, 0);
const short = (u) => u.replace(origin, "") || "/";

const lines = [
  `# Snake Eyes site report`, ``,
  `- Site: ${origin}`,
  `- Pages scanned: ${pages.length} (depth ${DEPTH}, cap ${MAX})`,
  `- Viewport: ${WIDTH}px wide, undocked`,
  `- Date: ${new Date().toISOString().slice(0, 10)}`,
  `- Spacing issues: ${totalIssues} (${counts.high} high, ${counts.medium} medium, ${counts.low} low)`,
  `- Links checked: ${status.size} (${dead.length} dead or broken, ${unverified.length} unverified)`, ``,
  `## Pages`, ``,
  `| Page | Issues | High | Med | Low | Last modified |`,
  `|---|---|---|---|---|---|`,
];
for (const p of pages.slice().sort((a, b) => b.total - a.total)) {
  const c = { high: 0, medium: 0, low: 0 };
  for (const i of p.issues) c[i.severity]++;
  const mod = (status.get(p.url) || {}).modified || "-";
  lines.push(`| ${short(p.url)} | ${p.error || p.total} | ${c.high} | ${c.medium} | ${c.low} | ${mod} |`);
}
const row = ([url, v]) => `| ${v.status || v.error || "no response"} | ${url} | ${short(linksOn.get(url))} |`;
if (dead.length) {
  lines.push(``, `## Dead links`, ``, `| Status | Link | First found on |`, `|---|---|---|`,
    ...dead.sort((a, b) => b[1].status - a[1].status).map(row));
}
if (unverified.length) {
  lines.push(``, `## Unverified links`, ``,
    `The server declined to answer a crawler (401, 403, 429) or the connection failed in a way that`,
    `says nothing about the page. Check these by hand rather than treating them as broken.`, ``,
    `| Status | Link | First found on |`, `|---|---|---|`,
    ...unverified.sort((a, b) => b[1].status - a[1].status).map(row));
}
// The per-page report carries its own header - page, viewport, date, counts - which this report
// already states once. Keep the numbered findings and drop everything above them.
const findingsOf = (report) => {
  const at = report.indexOf("\n## ");
  return at === -1 ? "" : report.slice(at + 1).trim();
};
lines.push(``, `## Findings`, ``);
for (const p of pages.filter((x) => x.total)) lines.push(`### ${short(p.url)}`, ``, findingsOf(p.report), ``);
if (!totalIssues) lines.push(`No spacing issues on any page scanned.`);

const out = lines.join("\n");
if (OUT) { writeFileSync(OUT, out); console.error(`wrote ${OUT}`); } else { console.log(out); }
await browser.close();
