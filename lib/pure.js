// Pure helpers shared by overlay.js (injected before it as a classic script) and the
// node --test unit tests (loaded with require). No DOM access in here.
(function (root) {
  const TOL = 2; // px: values inside this are treated as equal

  const LIMITS = {
    maxIssues: 150,         // panel + report cap; the rest is counted and reported as dropped
    maxNodes: 8000,         // scan budget; beyond it the report says the scan was truncated
    minPadW: 160,           // padding check only on containers at least this wide
    minPadH: 40,            // and this tall
    minPadHVertical: 80,    // top/bottom padding compared only on containers this tall
    sectionWidthRatio: 0.6, // a section counts for rhythm when it spans 60% of the viewport
    minSectionH: 120,       // and is at least this tall
    sevHigh: 8,             // px off for high severity
    sevMedium: 3,           // px off for medium (below is low)
    selectorDepth: 7,       // ancestors walked when building a selector
    contentDepth: 8,        // first-child hops when finding where section content starts
    labelChars: 28,         // characters of text kept in an element label
    guideCap: 12,           // guides drawn per issue in Show all (bad ones always drawn)
  };

  const px = (v) => Math.round(parseFloat(v) || 0);
  const same = (a, b) => Math.abs(a - b) <= TOL;
  const severityFor = (diff) => (diff >= LIMITS.sevHigh ? "high" : diff >= LIMITS.sevMedium ? "medium" : "low");

  // Most frequent value; on an all-unique list the median, so "what the siblings agree on"
  // is always defined. Ties go to the first value that reached the top count.
  const mode = (nums) => {
    if (!nums.length) return 0;
    const counts = new Map();
    for (const n of nums) counts.set(n, (counts.get(n) || 0) + 1);
    let best = nums[0], bestN = 0;
    for (const [n, c] of counts) if (c > bestN) { best = n; bestN = c; }
    if (bestN === 1) { const s = [...nums].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }
    return best;
  };

  // The expected value, the spread, and which indexes disagree with it.
  const outliers = (vals) => {
    const exp = mode(vals);
    let min = Infinity, max = -Infinity;
    for (const v of vals) { if (v < min) min = v; if (v > max) max = v; }
    const off = [];
    vals.forEach((v, i) => { if (!same(v, exp)) off.push(i); });
    return { exp, diff: vals.length ? max - min : 0, off };
  };

  // Siblings are comparable when they are the same kind of thing: same tag, or same first class.
  const sameKind = (tags, firstClasses) => {
    if (new Set(tags).size === 1) return true;
    const cls = new Set(firstClasses);
    return cls.size === 1 && !cls.has("");
  };

  const P = { TOL, LIMITS, px, same, severityFor, mode, outliers, sameKind };
  if (typeof module === "object" && module.exports) module.exports = P;
  else root.__snkPure = P;
})(typeof globalThis !== "undefined" ? globalThis : this);
