// Unit tests for the pure helpers in lib/pure.js (no browser needed): node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { TOL, LIMITS, px, same, severityFor, mode, outliers, sameKind } = createRequire(import.meta.url)("../lib/pure.js");

test("px rounds and tolerates junk", () => {
  assert.equal(px("16px"), 16);
  assert.equal(px("15.6px"), 16);
  assert.equal(px(""), 0);
  assert.equal(px(undefined), 0);
});

test("same uses the 2px tolerance inclusively", () => {
  assert.equal(TOL, 2);
  assert.equal(same(10, 12), true);
  assert.equal(same(10, 13), false);
});

test("severityFor bands: high at 8, medium at 5, low below", () => {
  assert.equal(severityFor(LIMITS.sevHigh), "high");
  assert.equal(severityFor(7), "medium");
  assert.equal(severityFor(LIMITS.sevMedium), "medium");
  assert.equal(severityFor(2), "low");
});

test("the low tier is reachable: a check only fires above TOL, so 3 and 4 must be low", () => {
  assert.ok(LIMITS.sevMedium > TOL + 1, "sevMedium must leave room above the tolerance");
  assert.equal(severityFor(TOL + 1), "low");
  assert.equal(severityFor(4), "low");
  assert.equal(severityFor(5), "medium");
});

test("mode picks the majority, the median when all differ, 0 when empty", () => {
  assert.equal(mode([24, 24, 31, 24]), 24);
  assert.equal(mode([16, 28, 16]), 16);
  assert.equal(mode([10, 20, 30]), 20);
  assert.equal(mode([16, 28]), 28); // all unique: median of 2 is the upper one
  assert.equal(mode([]), 0);
});

test("outliers reports the expected value, spread, and offending indexes", () => {
  const o = outliers([24, 24, 31, 24]);
  assert.equal(o.exp, 24);
  assert.equal(o.diff, 7);
  assert.deepEqual(o.off, [2]);
  const none = outliers([16, 17, 16]);
  assert.equal(none.diff, 1);
  assert.deepEqual(none.off, []);
  assert.deepEqual(outliers([]), { exp: 0, diff: 0, off: [] });
});

test("sameKind: same tag, or same first class, never an empty class", () => {
  assert.equal(sameKind(["DIV", "DIV", "DIV"], ["", "", ""]), true);
  assert.equal(sameKind(["A", "SPAN", "A"], ["chip", "chip", "chip"]), true);
  assert.equal(sameKind(["A", "SPAN"], ["", ""]), false);
  assert.equal(sameKind(["A", "SPAN"], ["chip", "pill"]), false);
});
