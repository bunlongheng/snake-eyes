// Renders the toolbar icons from 1 SVG: a dark rounded tile with 2 slit-pupil eyes.
import sharp from "sharp";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#0b1220"/>
  <ellipse cx="44" cy="64" rx="17" ry="24" fill="#d1fa4a"/>
  <ellipse cx="84" cy="64" rx="17" ry="24" fill="#d1fa4a"/>
  <rect x="41" y="44" width="6" height="40" rx="3" fill="#0b1220"/>
  <rect x="81" y="44" width="6" height="40" rx="3" fill="#0b1220"/>
</svg>`;
for (const s of [16, 32, 48, 128]) await sharp(Buffer.from(svg)).resize(s, s).png().toFile(`icons/icon-${s}.png`);
console.log("icons written: 16, 32, 48, 128");
