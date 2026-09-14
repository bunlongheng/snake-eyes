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
    sevMedium: 5,           // px off for medium; 3 to 4 is low. A check only fires above TOL,
                            // so this must stay above TOL + 1 or the low tier is unreachable.
    selectorDepth: 7,       // ancestors walked when building a selector
    contentDepth: 8,        // first-child hops when finding where section content starts
    labelChars: 28,         // characters of text kept in an element label
    guideCap: 12,           // guides drawn per issue in Show all (bad ones always drawn)
    splashMs: 750,          // the snake is held on screen this long: the scan itself takes about
                            // 30ms, too fast to read, and a click with no feedback feels broken
    edgeGuidePad: 12,       // px a guide line overshoots its box, and the badge offset
    copyResetMs: 1600,      // how long the Copy button shows its result
    resizeDebounceMs: 150,  // quiet period before the panel calls itself stale
    minRowItems: 3,         // items needed in a row before gaps are compared
    minStackRows: 3,        // rows needed in a stack before vertical gaps are compared
    minEdgeRows: 2,         // stacked siblings needed before edges are compared
    maxSelectorClasses: 2,  // classes kept on the leaf of a selector
    dockMinWidth: 1200,     // below this the page cannot spare a strip without changing layout
    rulerNodes: 1200,       // boxes drawn in Ruler before it stops, to keep the paint quick
    minTypeSamples: 3,      // instances of a tag needed before its size is judged. With 2 there is
                            // no majority to break, only 2 opinions, and picking one is a coin toss
    typeHighRatio: 0.2,     // a size this far off its own tag's norm is high severity
    typeMedRatio: 0.08,     // and this far off is medium. Type is judged in proportion, not px:
                            // 2px on a 12px label is a different mistake from 2px on a 48px hero
    typeMaxRatio: 0.25,     // past this the sizes were never trying to match. A 48px <p> next to
                            // 16px ones is a hero line, not a typo; the defect worth reporting is
                            // the near miss, the value that meant to match its level and does not
  };

  // The value a strict majority of siblings share, or null when they never agreed. mode() falls
  // back to the median on an all-unique list, which is fine for "pick something" but wrong here:
  // 3 buttons of natural width share no edge, and calling the middle one correct invents a rule
  // the designer never wrote and reports the other 2 as broken.
  const majority = (nums) => {
    if (nums.length < 2) return null;
    const counts = new Map();
    for (const n of nums) counts.set(n, (counts.get(n) || 0) + 1);
    let best = null, bestCount = 0;
    for (const [value, count] of counts) if (count > bestCount) { best = value; bestCount = count; }
    return bestCount >= 2 && bestCount > nums.length / 2 ? best : null;
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
  // What the siblings agree on, and which of them break it. Returns nothing when there is no
  // agreement to break: silence is the right answer for a group that was never meant to line up.
  const outliers = (vals) => {
    const exp = majority(vals);
    if (exp === null) return { exp: 0, diff: 0, off: [] };
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

  const P = { TOL, LIMITS, px, same, severityFor, mode, majority, outliers, sameKind };
  if (typeof module === "object" && module.exports) module.exports = P;
  else root.__snkPure = P;
})(typeof globalThis !== "undefined" ? globalThis : this);
