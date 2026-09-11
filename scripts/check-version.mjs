// Fails when manifest.json and package.json disagree on the version (both are hand-written).
import { readFileSync } from "node:fs";
const m = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")).version;
const p = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
if (m !== p) { console.error(`version mismatch: manifest.json ${m} vs package.json ${p}`); process.exit(1); }
console.log(`version ${m} ok`);
