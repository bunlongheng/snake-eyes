# <img src="docs/icon.png" width="36" height="36" align="top" alt=""> Snake Eyes

Spacing auditor for any page, in your browser.

Click the icon and it looks at the page the way a picky designer does: uneven gaps between cards, a list item nudged 6px right, a section padded unlike every other section, a heading rendering at 2 sizes. It draws the guides with the exact numbers, lists every finding in a side panel you can click through, and hands you a markdown report your coding agent can act on. Nothing runs until you click, nothing leaves the browser, and it never edits your DOM.

![Snake Eyes on the fixture page](docs/hero.png)

[![CI](https://github.com/bunlongheng/snake-eyes/actions/workflows/ci.yml/badge.svg)](https://github.com/bunlongheng/snake-eyes/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Chrome](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)
![Runtime deps](https://img.shields.io/badge/runtime%20deps-0-000000)

## Features

- **One click, and nothing before it** - no background scanning, no content script on page load. It asks for `activeTab` and `scripting` only, so it can reach the 1 tab you clicked and only while you are on it.
- **5 checks on the rendered layout** - gaps, edges, padding, section rhythm and type scale, all measured from bounding boxes at the current viewport with a 2px tolerance. A 24px gap made of margin plus padding is still a 24px gap.
- **Every finding says where and why** - the selector on its own line, the count that earned it a row, and the reason it is a defect. The why travels into the report, so an agent knows what it is preserving when it edits.
- **A report you can paste** - markdown on the clipboard: selector, what was found, why it matters, what was expected.
- **A whole site in 1 command** - `npm run crawl` runs the same engine across every page on the origin and link-checks everything it finds, off-site links included.
- **4 ways to look at the page** - guides, X-ray, Heat and Night, with a Ruler switch that lays over any of them.
- **Silence you can trust** - 14 shapes it refuses to guess at, each one a rule with a measured case behind it.

## Quick start

1. Clone or download this repo.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, pick the folder.
3. Pin the icon. Click it on any page to audit, click again to clear. Keyboard: `Alt+Shift+S` (change it at `chrome://extensions/shortcuts`).

To audit a local `file://` page, enable **Allow access to file URLs** on the extension's details page.

## What it catches

| Check | What it compares | Guide it draws |
|-------|------------------|----------------|
| Gap | Gaps between 3 or more siblings in a row, or between stacked blocks | Dashed line across each gap with its px value, red when it differs from what the rest agree on |
| Edge | Left and right edges of stacked siblings | Green line at the shared edge, red line at the odd one, with the offset |
| Padding | Left vs right padding on containers whose edges are drawn | Dashed spans inside the box with both numbers |
| Section | Top and bottom padding across page sections, and the content inset in each | Red span on the section that breaks the pattern, with the expected value |
| Type | `font-size` across every `<h1>`-`<h6>` and `<p>` of the same kind | Red band over the odd one, labelled with its size and the size the rest use |

Severity is how far off it is: high at 8px or more, medium at 5 to 7, low at 3 to 4. Inside the 2px tolerance nothing is reported. Resize the window and the panel greys out, because every number on screen belongs to the old layout, and a **Re-scan** button takes its place.

The scan measures the page as it stands, so for a state behind a click - a modal, a menu, an expanded card - open it yourself and press **Re-scan**.

## What it never flags

Silence is only useful if you trust it. Every row is a rule with a real page behind it.

| Shape | Why silence is right |
|-------|----------------------|
| Siblings of different kinds | A heading against a card compares nothing. Same tag or first class, or no measurement. |
| Runs of text | A paragraph with links in it has uneven gaps by nature. |
| Centered groups | Items centered on a parent are meant to have different edges. |
| Inline and inline-block | A code chip starts where the words reach it, not on a shared edge. |
| Shadow roots and iframes | The scan walks the main document only. |
| Type doing another job | Per tag and first class, within 25%. A 48px `<p>` is a hero line, not a typo. |
| Type under utility classes | `class="text-lg ..."` groups every size alone, so Tailwind pages get little from Type. |
| Type in another region | Judged inside the nearest landmark. Footer microcopy is not body copy. |
| A component outvoting the page | 1 vote per page strip, so 6 cards cannot outvote 2 section headings. |
| Padding on an invisible box | No drawn edge, nothing to be off centre from. A 1-sided `padding-left` is a gutter. |
| A box edge nothing paints | A negative-margin row hangs left of its own content, so the edge is where its children paint. |
| A 2-up row read as a stack | Centred columns have different tops. Overlapping vertically but not horizontally means beside. |
| A gap somebody typed | Excess equal to a margin on a different-kind item was a decision, not a slip. |
| Non-`<section>` sections | The Section check needs real section tags. |

## A whole site, not 1 page

```bash
npm run crawl -- https://example.com --depth 1 --out site-report.md
```

Scans the start page and everything it links to on the same origin, checks every link it finds including the off-site ones, and writes 1 markdown report: a page-by-page table, the dead links with the page each was found on, and the full findings per page.

| Flag | Default | What it does |
|------|---------|--------------|
| `--depth` | `1` | How many hops from the start page to follow. 1 is the start page and its links |
| `--max` | `25` | Hard cap on pages scanned |
| `--width` | `1280` | Viewport width to measure at |
| `--out` | stdout | Write the report to a file instead |

A link checker that calls everything non-200 broken is one nobody reads twice. The first run of this called 15 healthy pages dead because it had asked for them all at once and been rate limited.

| Verdict | Statuses | Why |
|---------|----------|-----|
| Dead | 404, 410, no DNS record, connection refused | The page is genuinely gone |
| Broken | 5xx | The server is failing on it |
| Unverified | 401, 403, 429, 999, protocol errors | The server declined to answer a crawler. That says nothing about whether the page works, so it is listed separately and never counted as dead |

Same-origin links go through a narrow spaced queue and off-site links go wide, a 429 is retried once after a backoff, and requests carry a real User-Agent so bot filters do not turn every external link into a false alarm. Files are link-checked but never scanned, whether they say so with an extension or only a `Content-Disposition`.

This is a script and not a button because the extension holds `activeTab`. Reading a second page needs `host_permissions` for the whole web, and a spacing tool asking to read every site you visit is a worse trade than running the crawl yourself. The engine is identical: `lib/pure.js` and `overlay.js` injected exactly as `background.js` injects them. It scans undocked, because a site report should describe the layout visitors actually get.

## The panel

On a window 1200px or wider the panel docks: the page narrows to about 80% and the panel takes the strip beside it, so nothing is hidden and no guide is covered. The page gets its width back when you close. The scan runs after the dock, so the report quotes the width it actually measured. Narrower windows keep a floating panel, since shrinking them would cross a breakpoint and change the layout you were auditing. On a phone-sized window it becomes a bottom sheet, and it follows your light or dark theme.

| View | What it is for |
|------|----------------|
| Guides (default) | The page untouched, carrying every guide and number |
| X-ray | The page as a radiograph, no colour at all: the deeper a box is buried the brighter it comes through, and findings burn bone white |
| Heat | A thermal map of the findings. Green is clear, yellow is an area holding one, red is the measurement that is off. Blurred together so the 3 read as one ramp. No blue, because a page has no colder than normal |
| Night | Green phosphor and scanlines, lighting nothing but the findings |
| Ruler (a switch, not a view) | Lays over whichever view is on, or none. Every region, section, container and panel outlined in its own colour and labelled in px, with purple bands showing the gap to each page edge |

Every lens marks a finding the same way - a spotlight and a numbered target with dashed sightlines crossing it - and only the colour changes. Ruler and X-ray show you what is there; Heat and Night show you the findings all at once instead of one row at a time.

- Every guide is drawn from the moment the panel opens. Clicking a row narrows the page to that 1 finding, and keeps whichever lens you are reading through.
- The list follows the page. Scroll and the row for the finding you are looking at selects itself and scrolls into view. A row you clicked stays selected until you scroll it off screen.
- Click a row, or Tab to it and press Enter: the page scrolls to it, the element gets a red outline, its guides appear.
- Findings are sorted high to low and capped at 150 most severe, and the panel says when it dropped any.
- The copy icon puts the report on the clipboard and turns green when it lands. The refresh icon measures the page as it looks right now. `Esc` closes and hands focus back where it was.
- While it scans, a 5 second loop plays: binary rain, a beam sweeping the snake top to bottom, a glowing ring and a bar that fills. The hold is one full turn of it, in `LIMITS.splashMs`.

## The report

```markdown
# Snake Eyes spacing report

- Page: https://example.dev/pricing
- Viewport: 1280x900
- Date: 2026-09-13
- Issues: 6 (3 high, 3 medium, 0 low)

Fix each item below in the source, then re-run Snake Eyes to confirm 0 issues. Selectors are relative to <body>.

## 1. Uneven vertical gaps in <div> "Paragraph 1 Paragraph 2 (28p..." (high)
- Selector: `section#stack > div > div.stack`
- Found: 4 stacked blocks, gaps 16, 28, 16px (most are 16px)
- Why it matters: A stack with one gap out of step reads as 2 groups instead of 1 list. 1 of 3 gaps differ from the 16px the rest share.
- Expected: 16px between every block
```

Paste it to your coding agent as is. The report carries the page origin and path only, never the query string or fragment.

## How it works

| Diagram | What it shows |
|---------|---------------|
| [Architecture](https://flows-bheng.vercel.app/?id=68d4e219-832e-4ad3-b801-6494b1089e3a) | The pieces: toolbar, service worker, the 1 tab, the engine, the report, and the crawl reusing it |
| [Click to report](https://sequences-bheng.vercel.app/d/934d6cbc-86d6-4650-9934-78683b094f6c) | Every step from the click to the clipboard, and the teardown on the next click |

[![Click to report](https://sequences-bheng.vercel.app/svg/934d6cbc-86d6-4650-9934-78683b094f6c)](https://sequences-bheng.vercel.app/d/934d6cbc-86d6-4650-9934-78683b094f6c)

The overlay adds 1 element to the page, `#snake-eyes-root`, with a closed shadow root inside. Page CSS cannot restyle it, page script cannot reach into it, and it never edits your DOM. Clicking again removes it and the 1 injected rule.

## Privacy

- Nothing runs until you click. No background scanning, no content script on page load.
- Nothing leaves the browser. No network requests, no storage, no analytics.
- The report you copy holds the page's origin and path, your viewport size, element selectors and short text labels. That is all.

## Layout and tests

```
background.js   the only thing that runs on install: listens for the click, injects, cleans up on toggle-off
lib/pure.js     the math with no DOM - tolerance, severity bands, majority, outliers, sibling kinds
overlay.js      4 stages the tests drive separately: scanPage (1 read, capped at 8000 elements),
                analyze (judges what it read), buildReport (the markdown), mount (the panel)
panel.css       the panel and guides, a constructed stylesheet inside the shadow root
overlay.css     1 rule for the host element so page CSS cannot hide or re-stack it
scripts/        crawl.mjs (whole-site run), pack, icons, check-version
preview/        the real overlay as an ordinary web page, no extension installed - npm run dev, then
                /preview/preview.html (or ?auto=1 for scripts). Deliberate drift, so 0 issues means something broke
tests/          fixture.html   1 planted mistake per check, beside prose and deep nesting that must stay silent
                fixture2.html  the branches the first cannot reach: a right edge, vertical padding, a short section
                clean.html     the control, centered flex groups included: 0 issues
                verify.mjs     the overlay against those pages at 3 widths, in dark mode, and a 200-issue cap
                extension.mjs  the packed extension in Chromium: manifest, CSS hand-off, toggle, Escape cleanup
                crawl.mjs      the whole-site run against a local fixture site
```

```bash
npm install
npx playwright install chromium   # once
npm test                # unit, the overlay against 3 pages, then the real extension in Chromium
npm run lint            # eslint, zero warnings
npm run check:version   # manifest.json and package.json must agree
npm run pack            # zip just the files Chrome needs
npm run icons           # regenerate the icon PNGs
npm run hero            # refresh docs/hero.png from the fixture
```

CI runs all of it on every push to main and every pull request, on Node 22 with SHA-pinned actions. A `v*` tag runs the suite again and attaches a zip of the extension to the GitHub release.

## Decisions

| Decision | Why |
|----------|-----|
| Measure the rendered layout, not the CSS | What the eye sees is the bounding box. A 24px gap made of margin plus padding is still a 24px gap. |
| A real majority, or silence | The expected value has to be one most siblings actually share. 3 buttons at their natural widths agree on nothing, so nothing is reported. Guessing a middle value would invent a rule the designer never wrote. |
| 1 vote per page strip | A component rendered 6 times is 1 decision, not 6 votes. Counting instances let a card outvote the headings it should answer to. |
| Only measure edges you can see | A box edge nothing paints is not an edge. This is what killed a whole class of false findings on negative-margin grids. |
| 2px tolerance | Subpixel rounding and borders create 1px noise. 3px is where a human starts to notice. |
| Report first, pictures second | The clipboard report is the product. Guides exist so you can trust the report before pasting it. |
| No background scanning | It only runs when clicked. A spacing audit on every page load would be noise and a privacy problem. |
| Cap after sort | Past 150 findings the ones kept are the worst, and the report says how many were left. |

---

<div align="center">

<a href="https://bunlongheng.com"><img src="https://img.shields.io/badge/bunlongheng.com-3A3A3C?style=for-the-badge&logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABYAAAAWAQMAAAD+ev54AAAABlBMVEVMaXH///+a4ocPAAAAAXRSTlMAQObYZgAAAAlwSFlzAAAD6AAAA+gBtXtSawAAAC1JREFUCNdjYEADzP+A+D8INzAwvwfi4w0QNlCMcX8DAyOQzfgcKgcVB+lBAwANvRHlhhcQugAAAABJRU5ErkJggg==" alt="bunlongheng.com"></a>
<a href="https://www.linkedin.com/in/bunlongheng/"><img src="https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white" alt="LinkedIn"></a>
<a href="https://www.instagram.com/ibunlong/"><img src="https://img.shields.io/badge/Instagram-C13584?style=for-the-badge&logo=instagram&logoColor=white" alt="Instagram"></a>
<a href="mailto:bheng.code@gmail.com"><img src="https://img.shields.io/badge/Email-2E7D32?style=for-the-badge&logo=gmail&logoColor=white" alt="Email"></a>

<br>

Built by **[Bunlong](https://bunlongheng.com)** &nbsp;&middot;&nbsp; [more apps](https://bunlongheng.com/projects)

</div>
