// Renders every icon size and the panel logo from 1 source: assets/logo-source.png.
// The artwork is a transparent PNG, so the toolbar icons keep that transparency and sit on
// whatever toolbar the user has. The panel logo is a different problem: the snake is mostly
// white, and the panel header is near white, so that one is composited onto a dark tile.
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";

const path = (rel) => new URL(rel, import.meta.url).pathname;
const art = await sharp(path("../assets/logo-source.png")).trim().toBuffer();

const fit = async (size, pad) => {
  const inner = Math.round(size * (1 - pad * 2));
  const scaled = await sharp(art).resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: scaled, gravity: "center" }]).png();
};

for (const size of [16, 32, 48, 128]) {
  // smaller icons get less padding, or the snake disappears at 16px
  await (await fit(size, size <= 32 ? 0.02 : 0.06)).toFile(path(`../icons/icon-${size}.png`));
}

const S = 64, R = 14;
const tile = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}"><rect width="${S}" height="${S}" rx="${R}" fill="#0b1220"/></svg>`);
const snake = await sharp(art).resize(Math.round(S * 0.84), Math.round(S * 0.84), { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
const logo = await sharp(tile).composite([{ input: snake, gravity: "center" }]).png({ compressionLevel: 9 }).toBuffer();

// A closed shadow root cannot reference an extension file without exposing it to every page,
// so the logo is inlined into panel.css as a data URI.
const cssPath = path("../panel.css");
// Anchor to the end of the line, NOT to the next semicolon: a data URI contains one
// (image/png;base64), so [^;]* truncated the value and the leftover text ran on and ate the
// declaration that followed it.
const setVar = (name, buf, note) => {
  const line = `  --${name}: url("data:image/png;base64,${buf.toString("base64")}"); /* ${note} */`;
  writeFileSync(cssPath, readFileSync(cssPath, "utf8").replace(new RegExp(`^  --${name}: .*$`, "m"), line));
};
setVar("snk-logo", logo, "written by scripts/icons.mjs");

// The scanning splash shows the artwork itself rather than a row of dots, so it needs a bigger
// transparent copy with no tile behind it.
const big = await sharp(art).resize(160, 160, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toBuffer();
setVar("snk-logo-lg", big, "written by scripts/icons.mjs");

console.log(`icons written: 16, 32, 48, 128, the panel logo (${(logo.length / 1024).toFixed(1)} KB) and the splash art (${(big.length / 1024).toFixed(1)} KB)`);
