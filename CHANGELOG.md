# Changelog

## 1.1.0 - 2026-09-11

- Single-pass scan: rect and computed style read once per element, 8000-node budget, hidden subtrees skipped
- Cap applies after the severity sort and is stated in the panel and the report
- Inline text runs and inherited text-align no longer trip the gap and edge checks
- Panel: keyboard access (buttons, focus rings, Escape), collapse, bottom sheet on phones, dark mode, fixed typography
- Closed shadow root, constructed stylesheet, page-level CSS removed on toggle-off, no clipboardWrite permission
- Report uses origin + path only, page text is fenced
- Tests: exact fixture count, clean-page zero check, cap check, 3 widths, unit tests for the pure helpers
- Keyboard shortcut Alt+Shift+S, release packaging, version check, CI on Node 22 with pinned actions

## 1.0.0 - 2026-09-11

- First release: 4 checks (gap, edge, padding, rhythm), guides with numbers, side panel, agent-ready report
