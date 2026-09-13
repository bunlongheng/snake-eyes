# Changelog

## 1.1.0 - 2026-09-11

- Single-pass scan: rect and computed style read once per element, 8000-node budget, hidden subtrees skipped
- Cap applies after the severity sort and is stated in the panel and the report
- Inline text runs are skipped, and centered stacks are detected from flex alignment or geometry, so neither trips the gap and edge checks
- Panel: keyboard access (buttons, focus rings, Escape), collapse, bottom sheet on phones, dark mode, fixed typography
- Closed shadow root, constructed stylesheet, page-level CSS removed on toggle-off, no clipboardWrite permission
- Report carries the origin and path only (just the basename on file: pages), and element labels are quoted with markdown characters stripped
- Tests: exact fixture count, clean-page zero check, cap check, 3 widths, unit tests for the pure helpers, and a suite that loads the real extension and drives the service worker
- Re-scan button appears once a resize makes the measurements stale, so a new scan is 1 click
- Closing with Escape or the close button now removes the injected page CSS too
- Severity bands moved so the low tier is reachable: high 8px and up, medium 5 to 7, low 3 to 4
- Panel greys out after a resize, and the report always states the viewport it measured
- Header wraps instead of truncating, so wider system fonts cannot clip the controls
- Panel takes focus when it opens, so Tab and Escape work without clicking first
- Every panel control is checked against 4.5:1 contrast in both themes on every test run
- Synthetic keyboard and resize events from the page under audit are ignored
- Keyboard shortcut Alt+Shift+S, release packaging, version check, CI on Node 22 with pinned actions

## 1.0.0 - 2026-09-11

- First release: 4 checks (gap, edge, padding, rhythm), guides with numbers, side panel, agent-ready report
