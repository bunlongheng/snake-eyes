# Changelog

## Unreleased

- Labels stop falling off the page. A badge is centred on the point it labels and a box caption
  sits above its box, so a section flush with y=0 pushed both off the top: "0px (expected 48)",
  the one value worth reading, was the one you could not read.
- The scanning splash sits in the middle of the docked rail instead of the top of it, on the same
  12px gutters as the panel that replaces it, so it no longer jumps sideways when the scan ends.
- The selected row in the list is green rather than amber, which is the extension's own colour and
  no longer reads as a warning next to the real amber medium-severity tier.

## 1.2.0 - 2026-09-13

- Scanning animation is the snake itself now, breathing over a soft green pulse, instead of 9 dots
  chasing a sine wave.
- Fixed a stylesheet corruption in the icon generator. It wrote the logo data URI with a regex
  bounded by the next semicolon, but a data URI contains one (image/png;base64), so the value was
  truncated and the leftover text ran on and swallowed the declaration after it. That is what made
  the splash art vanish and the primary button lose its colour. A test now asserts the logo
  resolves to real image data.
- New artwork everywhere: the toolbar icon at all 4 sizes and the panel logo now render from
  1 source file, assets/logo-source.png, via npm run icons.
- The docked panel sits on its own dark rail, so it is obvious which pixels belong to the extension
  and which belong to the site underneath.
- Header rebuilt: identity and window controls on the top row, count and actions on the second,
  every row starting on the same left edge. A duplicated count pill and an unclosed span had been
  nesting the toolbar inside the window controls.
- Fixed a bug where the Ruler layer toggles never hid. The UA [hidden] rule is display:none with no
  specificity, so the author rule making that row a flexbox beat it and the panel showed layer
  options with Ruler switched off.

- Docking now reflows position:fixed elements as well. Narrowing the page moved normal content,
  but fixed headers, toasts and cookie bars anchor to the viewport, so they stayed full width and
  slid under the panel. A transform on body makes body their containing block, which brought 9
  spilling elements on a real site down to 3, the rest being marquees that are wider than the
  screen on purpose.
- Docked panel. On a window 1200px or wider the page gives up a 20% strip instead of hiding
  underneath the panel, the way devtools docks to a side, and takes its width back on close. The
  scan runs after the dock lands, so every number describes the layout you can actually see, and
  the report quotes the docked width rather than the window width. Narrower windows keep the
  floating panel, because shrinking them would cross a breakpoint and change the design being
  audited.
- Controls moved to their own toolbar row. At a docked width they cannot share a line with the
  name and the count, and a row that wraps by accident looks broken where one that wraps by design
  looks like a toolbar.

- Edge check compares block boxes only. Inline and inline-block elements start wherever the words
  reach them, so code chips inside a paragraph landed on separate lines, looked like a stack of
  siblings, and were reported for not sharing a left edge they were never meant to share.
- Re-scan is always available, not just after a resize: the layout worth checking is often behind a
  click, so open the modal or the menu and press it.

- Padding check rewritten. It used to report any box whose padding was not symmetric, which on a
  real marketing page produced 41 findings out of 43, every one of them deliberate. Vertical
  padding is no longer compared at all, since section rhythm already covers vertical spacing, and
  uneven side padding is reported only when the element's own same-kind siblings disagree with it.
  That page now reports 4 issues instead of 42.
- 4 page views, one at a time, on their own row: Ruler, X-ray, Heat and Night. Each is structure
  only and none of them is a verdict.
- X-ray is back alongside Ruler rather than replaced by it. They answer different questions: Ruler
  is how big and how much room, X-ray is how deeply buried.
- Heat is a thermal map, normalised to the deepest box on the page so the ramp always spans rather
  than leaving a shallow page a single flat colour.
- Night vision tints the page through green phosphor with scanlines and lit edges. The filter goes
  on body, never on html, or it would tint the panel along with the site, and it comes off with the
  mode and on close.
- Ruler: outlines every region, section, layout container and panel in its own colour, labels each with its size in px, and draws the gap to each side of the page as a purple band. Layer toggles let you show only what you are looking at. It replaces the earlier X-ray depth view, which said less.
- Re-scan moved to a refresh icon beside collapse and close, so the toolbar reads as 3 actions and 3 controls.
- A snake animates across the panel while the page is measured.
- Padding findings now shade the padding strip itself instead of drawing a line across it, and the
  highlighted element is labelled with its selector so it is clear which box is meant.
- The panel shows the version it is running, which matters when reloading an unpacked build.

## 1.1.0 - 2026-09-13

- Single-pass scan: rect and computed style read once per element, 8000-node budget, hidden subtrees skipped
- overlay.js split into 4 named stages (scanPage, analyze, buildReport, mount) that the tests drive independently
- Cap applies after the severity sort and is stated in the panel and the report
- Inline text runs are skipped, and centered stacks are detected from flex alignment or geometry, so neither trips the gap and edge checks
- Panel: keyboard access (buttons, focus rings, Escape), collapse, bottom sheet on phones, dark mode, fixed typography
- Closed shadow root, constructed stylesheet, page-level CSS removed on toggle-off, no clipboardWrite permission
- Report carries the origin and path only (just the basename on file: pages), and element labels are quoted with markdown characters stripped
- Tests: exact fixture count, clean-page zero check, cap check, 3 widths, unit tests for the pure helpers, and a suite that loads the real extension and drives the service worker
- Re-scan button appears once a resize makes the measurements stale, so a new scan is 1 click
- Closing with Escape or the close button now removes the injected page CSS too
- Severity bands moved so the low tier is reachable: high 8px and up, medium 5 to 7, low 3 to 4
- A check now needs a real majority to fire: 3 buttons at their natural widths share no edge, and
  the old median fallback called the middle one correct and reported the other 2 as broken
- Re-scan no longer stacks a second copy of the page CSS that a later toggle off could not clear
- Panel greys out after a resize, and the report always states the viewport it measured
- Header wraps instead of truncating, so wider system fonts cannot clip the controls
- Panel takes focus when it opens, so Tab and Escape work without clicking first
- Every panel control is checked against 4.5:1 contrast in both themes on every test run
- Synthetic keyboard and resize events from the page under audit are ignored
- Keyboard shortcut Alt+Shift+S, release packaging, version check, CI on Node 22 with pinned actions

## 1.0.0 - 2026-09-11

- First release: 4 checks (gap, edge, padding, rhythm), guides with numbers, side panel, agent-ready report
