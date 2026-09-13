// Zips exactly the files Chrome needs into snake-eyes-<version>.zip for a store upload or a release.
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
const v = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")).version;
const out = `snake-eyes-${v}.zip`;
rmSync(out, { force: true });
// Named explicitly, never a recursive folder add, so a stray file next to the icons
// (a .DS_Store, a source .svg, an experiment) can never ride along into a release.
const files = ["manifest.json", "background.js", "overlay.js", "overlay.css", "panel.css", "lib/pure.js",
  "icons/icon-16.png", "icons/icon-32.png", "icons/icon-48.png", "icons/icon-128.png"];
execFileSync("zip", ["-q", out, ...files], { cwd: fileURLToPath(new URL("..", import.meta.url)) });
console.log(`wrote ${out}`);
