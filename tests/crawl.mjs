// scripts/crawl.mjs against a 4-page site served from memory: 1 hub, 2 pages worth scanning, a
// PDF that must be link-checked but never scanned, a 404 that must be reported, and a 403 that
// must NOT be, because a server refusing a crawler says nothing about whether the page works.
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) failed++; };

const page = (body) => `<!doctype html><meta charset=utf-8><style>
  body { margin:0; font:16px/1.5 system-ui }
  section { padding:48px 24px } #odd { padding-top:12px }
</style>${body}`;
const sections = (n) => Array.from({ length: n }, (_, i) => `<section><h2>S${i + 1}</h2><p>body</p></section>`).join("");

const routes = {
  "/": page(`<a href="/clean">clean</a> <a href="/odd">odd</a> <a href="/cv.pdf">cv</a>
             <a href="/brochure">brochure</a> <a href="/gone">gone</a> <a href="/locked">locked</a>
             <a href="/botwall">botwall</a> ${sections(3)}`),
  "/clean": page(sections(4)),
  // 1 section out of 4 breaks the padding every other section agrees on
  "/odd": page(`${sections(3)}<section id=odd><h2>Odd</h2><p>body</p></section>`),
};

const server = createServer((req, res) => {
  const path = req.url.split("?")[0];
  // No extension to filter on, and it serves a download: the live site's /resume does exactly this
  // and used to be reported as a failed scan.
  if (path === "/brochure") { res.writeHead(200, { "content-type": "application/pdf", "content-disposition": "attachment; filename=b.pdf" }); return res.end("%PDF-1.4\n"); }
  if (path === "/cv.pdf") { res.writeHead(200, { "content-type": "application/pdf", "content-disposition": "attachment; filename=cv.pdf" }); return res.end("%PDF-1.4\n"); }
  if (path === "/gone") { res.writeHead(404, { "content-type": "text/html" }); return res.end("no"); }
  if (path === "/locked") { res.writeHead(403, { "content-type": "text/html" }); return res.end("no"); }
  // LinkedIn answers crawlers with 999, which is not a real HTTP status and not a broken page
  if (path === "/botwall") { res.writeHead(999, { "content-type": "text/html" }); return res.end("no"); }
  if (routes[path] === undefined) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(routes[path]);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

// os.tmpdir and not tests/screenshots: only *.png is gitignored under there, so a report written
// into the repo would show up as an untracked file after every test run.
const out = join(tmpdir(), `snake-eyes-crawl-${process.pid}.md`);
try {
  // execFile and not execFileSync: the server under test lives in this process, and a sync child
  // blocks the event loop, so every request the crawler makes would hang until it gave up.
  await promisify(execFile)("node", [join(here, "..", "scripts", "crawl.mjs"), base, "--depth", "1", "--max", "10", "--out", out]);
} catch (e) {
  console.log("FAIL  the crawler ran at all");
  console.log(String(e.stderr || e));
  server.close();
  process.exit(1);
}
const report = readFileSync(out, "utf8");
rmSync(out, { force: true });
server.close();

check(/- Pages scanned: 7 /.test(report), `every queued url was visited (${(report.match(/- Pages scanned: .*/) || [])[0]})`);
// A healthy link is counted, never listed: the report is a list of problems, not an inventory.
check(/- Links checked: 7 /.test(report), `all 7 links were checked including the 2 files (${(report.match(/- Links checked: .*/) || [])[0]})`);
check(!/\/cv\.pdf/.test(report), "the healthy pdf is counted but not queued for a scan and not listed as a problem");
check((report.match(/\| \/\w+ \| 0 \|/g) || []).length + (report.match(/\| \/\w+ \| 1 \|/g) || []).length === 2, "only the 2 html children were actually measured");
check(/\| \/gone \| HTTP 404 \|/.test(report), "the 404 page is named as HTTP 404, not measured for spacing");
check(/\| \/odd \| 1 \|/.test(report), "the section that breaks the padding is reported, on the right page");
check(/\| \/clean \| 0 \|/.test(report), "the consistent page reports nothing");
check(/## Dead links[\s\S]*\/gone/.test(report), "the 404 is listed as dead");
check(!/## Dead links[\s\S]*?\n\n##[\s\S]*|## Dead links[\s\S]*\/locked/.test(report.split("## Unverified")[0]), "the 403 is NOT called dead");
check(/## Unverified links[\s\S]*\/locked/.test(report), "the 403 is listed as unverified instead");
check(/## Unverified links[\s\S]*\/botwall/.test(report) && !/## Dead links[\s\S]*?\/botwall/.test(report.split("## Unverified")[0]), "a 999 bot wall is unverified, not dead");
check(/\| \/brochure \| file download, not a page \|/.test(report), "an extensionless download is named as a file rather than a failed scan");
check(/- Why it matters: /.test(report), "per-page findings keep their why line");
check(!/# Snake Eyes spacing report/.test(report), "the per-page report headers are stripped, so the site report has 1 header");

console.log(failed ? `\n${failed} crawl check(s) failed` : "\nall crawl checks passed");
process.exit(failed ? 1 : 0);
