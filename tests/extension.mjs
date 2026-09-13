// Loads the REAL unpacked extension in Chromium and drives background.js end to end.
// tests/verify.mjs injects overlay.js by hand, which means the service worker, the manifest,
// the CSS hand-off and the toggle path were never executed by anything. This covers them.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp, mkdir, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) failed++; };

// The extension has no host permissions, so file:// is off limits without a user opt-in.
// A throwaway static server gives us a normal http page, which is what activeTab covers.
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
const server = createServer(async (req, res) => {
  try {
    const body = await readFile(join(here, req.url === "/" ? "fixture.html" : req.url.slice(1)));
    res.writeHead(200, { "content-type": types[extname(req.url)] || "text/plain" });
    res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

// activeTab is granted only by a real toolbar click, and Playwright cannot click browser chrome.
// So the test loads a COPY of the extension with 1 added host permission for the local server.
// Every file under test is the real one; only the grant differs, and the check below asserts the
// shipped manifest still asks for nothing but activeTab and scripting.
const shipped = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
const extDir = await mkdtemp(join(tmpdir(), "snk-ext-"));
await mkdir(join(extDir, "lib"), { recursive: true });
await mkdir(join(extDir, "icons"), { recursive: true });
for (const f of ["background.js", "overlay.js", "overlay.css", "panel.css", "lib/pure.js",
  "icons/icon-16.png", "icons/icon-32.png", "icons/icon-48.png", "icons/icon-128.png"]) {
  await copyFile(join(root, f), join(extDir, f));
}
await writeFile(join(extDir, "manifest.json"), JSON.stringify({ ...shipped, host_permissions: [`${origin}/*`] }, null, 2));

const userDataDir = await mkdtemp(join(tmpdir(), "snk-"));
// channel "chromium" selects the new headless mode, the only one that runs MV3 service workers.
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: "chromium",
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
  check(!!worker, "the service worker from manifest.json starts");
  check(!shipped.host_permissions && shipped.permissions.join() === "scripting,activeTab",
    `the shipped manifest asks for activeTab and scripting only (${shipped.permissions.join(", ")})`);

  const page = context.pages()[0] || (await context.newPage());
  const url = `${origin}/fixture.html`;
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // The manifest asks for activeTab, not tabs, so chrome.tabs.query hands back ids but no urls.
  // A real toolbar click passes a tab that carries its url, so the test builds the same shape.
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
  const click = async (tab = { id: tabId, url }) => {
    await worker.evaluate(async (t) => { await run(t); }, tab);
    await page.waitForTimeout(600);
  };

  await click();
  const on = await page.evaluate(() => {
    const host = document.getElementById("snake-eyes-root");
    return { mounted: !!host, styled: host ? getComputedStyle(host).position : null, closedShadow: !!host && host.shadowRoot === null };
  });
  check(on.mounted, "clicking the action injects the overlay into a normal http page");
  check(on.styled === "absolute", `overlay.css is applied to the host element (position: ${on.styled})`);
  check(on.closedShadow, "the shadow root is closed, so the page cannot reach into the panel");
  check(await page.evaluate(() => window.__SNAKE_EYES_CSS__ === undefined), "panel.css is handed over and then deleted from the page window");

  const title = await worker.evaluate((id) => chrome.action.getTitle({ tabId: id }), tabId);
  check(!/cannot run here/.test(title), `the action title reports success (${title})`);

  await click();
  const off = await page.evaluate(() => ({ mounted: !!document.getElementById("snake-eyes-root"), styled: getComputedStyle(document.createElement("div")).position }));
  check(!off.mounted, "clicking again removes the overlay");
  const leftover = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.id = "snake-eyes-root";
    document.body.appendChild(probe);
    const pos = getComputedStyle(probe).position;
    probe.remove();
    return pos;
  });
  check(leftover !== "absolute", `overlay.css is removed from the tab on toggle off (a fresh #snake-eyes-root is ${leftover})`);

  // Escape closes from inside the page; background.js must still drop the injected CSS.
  await click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
  const afterEsc = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.id = "snake-eyes-root";
    document.body.appendChild(probe);
    const pos = getComputedStyle(probe).position;
    probe.remove();
    return { mounted: !!document.getElementById("snake-eyes-root"), pos };
  });
  check(!afterEsc.mounted && afterEsc.pos !== "absolute", `closing with Escape also clears the injected CSS (${afterEsc.pos})`);

  // A page Chrome will not let us touch must be reported honestly, not as a crash.
  const blocked = await worker.evaluate(async (id) => {
    await run({ id, url: "chrome://settings" });
    return chrome.action.getTitle({ tabId: id });
  }, tabId);
  check(/only http, https and file pages/.test(blocked), `an unsupported page is refused with a reason (${blocked})`);
} finally {
  await context.close();
  server.close();
  await rm(userDataDir, { recursive: true, force: true });
  await rm(extDir, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall extension checks passed");
process.exit(failed ? 1 : 0);
