// Zips exactly the files Chrome needs into snake-eyes-<version>.zip for a store upload or a release.
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
const v = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")).version;
const out = `snake-eyes-${v}.zip`;
rmSync(out, { force: true });
execFileSync("zip", ["-q", "-r", out, "manifest.json", "background.js", "overlay.js", "overlay.css", "panel.css", "lib/pure.js", "icons"], { cwd: new URL("..", import.meta.url).pathname });
console.log(`wrote ${out}`);
