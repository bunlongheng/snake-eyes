// Renders every icon size, plus the panel logo, from 1 source: assets/logo-source.png.
// The artwork arrives with a white margin around the tile, so it is trimmed first and the
// result is written straight into icons/ and into panel.css as a data URI.
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";

const SRC = new URL("../assets/logo-source.png", import.meta.url).pathname;
const trimmed = await sharp(SRC).trim({ threshold: 10 }).toBuffer();

for (const size of [16, 32, 48, 128]) {
  await sharp(trimmed).resize(size, size, { fit: "cover" }).png().toFile(new URL(`../icons/icon-${size}.png`, import.meta.url).pathname);
}

// The panel lives in a closed shadow root, so it cannot reference an extension URL without
// making the file web-accessible to every page. A data URI keeps the logo self-contained.
const logo = await sharp(trimmed).resize(64, 64, { fit: "cover" }).png({ compressionLevel: 9 }).toBuffer();
const uri = `url("data:image/png;base64,${logo.toString("base64")}")`;
const cssPath = new URL("../panel.css", import.meta.url).pathname;
const css = readFileSync(cssPath, "utf8").replace(/(--snk-logo: )[^;]*(;)/, `$1${uri}$2`);
writeFileSync(cssPath, css);

console.log(`icons written: 16, 32, 48, 128, and the panel logo (${(logo.length / 1024).toFixed(1)} KB)`);
