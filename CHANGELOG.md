# Changelog

## Unreleased

- 3 checks were reporting things nobody should change, and a report you have to audit is worse than
  no report. On kactusbio.com the engine found 6 issues and 5 of them were false: it now finds the
  1 that was real. Each rule below asks for a reason the finding could be real before it fires.
- **Padding only on a box whose edges are drawn.** Padding pushes content off centre only when
  there is an edge on screen to be off centre from. A transparent div with `padding-left: 22px` and
  nothing on the right is indistinguishable from a margin - and that is what a grid framework's
  gutters look like: a Shopify `.grid__item` carries the column gutter as padding on 1 side, on
  every item of every grid. A background, a shadow, or a border on both sides makes the box
  visible; a border on 1 side is a divider rule, and the padding beside it is the gap from the rule.
- **Type compared inside its own region.** "The other `<p>` on this page" is not 1 population. A
  footer's 16px address line and the 20px body copy in `<main>` are both unclassed `<p>` and were
  never trying to match, and comparing them told the footer to use a size nobody typed. Sizes are
  now grouped by the nearest landmark as well as by tag and first class.
- **A gap explained by a margin somebody typed.** When the excess over the shared gap is exactly an
  explicit margin on one of the 2 items beside it, and that item is not the same kind as the rest of
  the row, the space was a decision - a footer holding its logo away from its menus with
  `margin-right: 35px` on top of a 20px flex gap. Both signals are needed, so 4 cards that share a
  class and differ by a stray margin still report, and so does a margin that is the row's gap rule
  rather than an addition to it.
- **A 2-up row is not a stack.** Rows are grouped by a shared top, so 2 columns centred on each
  other have 2 different tops and arrived at the edge check as 2 rows of 1 item. Each column was
  then reported for not sharing the other's edge, off by exactly half the container. 2 boxes that
  overlap vertically but not horizontally are beside each other, and their edges are not compared.
- **Edges are measured where a box paints, not where its box hangs.** A negative-margin grid row
  cancels a gutter its cells carry as padding, so the row sits 22px left of anything painted in it
  and read as 22px out of line with every section above it while its text landed in the same place.
  When the margin on that side is negative, the edge is where its children start painting.
- **1 vote per page strip in the type check, not 1 per instance.** A component rendered 6 times is
  1 decision: on the company page 6 card titles at 50px outvoted 2 genuine section headings and
  reported THEM as the deviants, which is the report asking you to break the page to match a card.
  Sizes are now voted on by strip - the band of page a sample lives in - and a strip whose own
  samples disagree holds 2 roles rather than an opinion, so it casts no vote at all. Inside 1 strip
  the instances still answer to each other, because 6 cards whose titles disagree is the defect
  this check is for.
- Measured end to end on 3 pages of a real Shopify theme: the homepage went 5 findings to 0, the
  SAMS page 4 to 0, the company page 16 to 0, and bunlongheng.com kept all 3 of its real findings.
- All 6 shapes are in the test suite next to the defect of the same kind that must still fire, so
  the silence is asserted and not assumed.

- Every lens marks a finding the same way: a light pool, a dashed crosshair through it, a target
  box, the numbered tag, and the guides carrying the numbers. 1 pass of geometry, so a finding sits
  in the same place wherever you are looking; only the colour changes, and it comes from the class
  the layer wears. Night is white, Heat is red, X-ray is bone.
- X-ray is a radiograph. Depth was hue, cyan to violet, which is a legend to memorise; it is now
  exposure, with no colour on the page at all. The deeper a box is buried the brighter it comes
  through, and the findings burn bone white.
- The sightlines were black in every lens. `border-top: 1px dashed` is a shorthand and it resets
  border-color to currentColor, so the colour each lens set was overwritten a line later. Widths
  are longhands now.
- With no lens on, the page is untouched and carries the guides and boxes, as before. A lens only
  changes how that is painted.

- Clicking a row keeps the lens. It dropped you back to the plain view to jump to a finding, so
  following one up while reading the page through Heat, Night or X-ray cost you the view that made
  you want to follow it up. The guides for the row you clicked now draw over whichever lens is on.

- The list follows the page. On a long page, scrolling to something you can see is wrong meant
  hunting the panel for which of 40 rows describes it. The row for the finding nearest the middle
  of the window now selects itself and scrolls into view, from the moment the panel opens, since
  you may have opened it halfway down. A row you clicked stays selected until it scrolls off
  screen, and only then does the page go back to drawing every finding.
- Night lights nothing but the findings. It outlined every box on the page, then every box over
  56px, and both drew a grid over every logo strip and nav row dense enough to hide the targets.
  A box that is not a finding is the thing the view is trying not to draw your eye to.
- Night lost its red. Red is the panel's colour for wrong, and on a green phosphor field it read
  as another tool's output leaking through. The same guides carrying the same numbers come out
  white there, with a spotlight and dashed sightlines crossing on each finding.
- Night's root is coloured, not just its body. The filter can only go on body, so the strips of
  html background beside a centred page came through white, and washing them dark from the guide
  layer washed the content with them until the page could not be read.

- The splash is a scanning animation rather than a logo that breathes: binary rain behind, browser
  panes drifting at the edges, a beam sweeping the snake top to bottom, a glowing floor ring and a
  bar that fills. 1 loop, 5s, every keyframe on the same clock so they come back round together.
  The hold is set to a full turn, so a click plays the whole loop instead of cutting off mid sweep.
  It is 1 constant, LIMITS.splashMs, and the keyframes in panel.css must match it.

- The selected row carries its own severity instead of a green highlight. Green in this tool means
  the value the siblings agree on, so outlining a finding in it said the opposite of what it meant.
  A high row is now outlined red, a medium one amber, the same colour its tag already carried.
- Ruler labels carry their unit. A bare `177` beside a `1524 x 186` reads as a third dimension
  rather than a gap measured in px.

- Ruler is a switch instead of a 4th view. Measuring the layout is a question you can ask of any
  view, so making it exclusive with the other 3 meant you could never read a size while looking at
  where the findings are. It now lays over whichever mode is on, or over none. Every painter used
  to call clearGuides() for itself, which is exactly why 2 could never be on at once; they now
  append, and 1 render() composes the mode, the switch and the guides of a selected finding.
- Show all is gone. Every guide is drawn from the moment the panel opens, which is what the button
  did, and clicking a row narrows to that one finding. A button that says "yes, all of them" is
  answering a question nobody asked.
- Copy is an icon in the header where Collapse used to be, and turns green when the report lands.
  Collapse folded a panel that already has a close button beside it.

- Heat is a thermal map of the findings. It used to shade every box by nesting depth, which is the
  same thing X-ray already outlines, so the view cost a button and told you nothing the view beside
  it did not. It now reads the way any heat map reads: green is clear, yellow is an area holding a
  finding, red is the measurement inside it that is actually off. The blobs share one blurred
  parent, so the 3 colours smear into a ramp instead of stacking as rectangles. No blue, because a
  page has no such thing as colder than normal.
- Night vision locks on. It lit every box on the page equally, which is the same as lighting none:
  the view looked good and left you with no idea where to start. The boxes are now faint terrain,
  every finding gets a numbered target matching its row in the list, and the measurement that is
  off burns white. Its tint also sat at 0.85 brightness, which turned a white page pale green
  rather than dark, so the lit targets had nothing to stand out against.
- The issue rows line up. The type tag sat in its own grid column beside the title, which left the
  title a ~200px gutter to wrap in: a long finding broke over 4 lines and every row ended a
  different shape. The number and tag now share one line and the title takes the full width.
- The panel's scrollbar follows the panel's theme. Left to the browser it inherited the page's,
  so a dark panel on a light site had a white bar down its side.

- X-ray works. It never did: overlay.js created .snk-xbox nodes and panel.css had no rule for
  them at all, so 1200 divs went onto the page carrying an inline border-colour with no position
  and no border-width, which paints nothing. Every view now has a test that its boxes are visible,
  not merely present, because counting the nodes would have passed all along.
- `npm run crawl -- <url>` runs the whole engine across a site instead of 1 page: every page 1 hop
  from the start, every link checked including the off-site ones, 1 markdown report. It is a script
  and not a panel button because the extension holds activeTab and reading a 2nd page would mean
  asking for host permission to the entire web.
- Link verdicts are sorted by what the status means. Dead is 404, 410 and a name that does not
  resolve; broken is 5xx; 401, 403, 429 and LinkedIn's 999 are unverified, because a server
  refusing a crawler says nothing about whether the page works. The first run of the crawler called
  15 healthy pages dead after rate limiting itself, so same-origin requests now go through a narrow
  spaced queue, a 429 is retried once, and requests carry a real User-Agent.
- The crawler scans undocked. Docking narrows the page to 80% so the panel does not cover it, which
  is right for a human reading the panel and wrong for a report about what visitors actually get.
- New Type check: the same tag rendering at more than 1 size. A heading level is a size promise,
  so 4 <h2 class="card-h"> at 24px and a 5th at 22px is a defect, while a 48px <p> hero beside
  16px body copy is a different job and stays quiet. Sizes are grouped by tag AND first class and
  compared only within 25% of each other. Judged by tag alone the live portfolio produced 3
  findings and all 3 were wrong; with both rules it produces none, and a planted near miss still
  fires. Unlike every other check this one compares exactly rather than through the 2px tolerance:
  layout drifts, but a font-size is a number somebody typed.
- Every finding now says where it is and why it is a finding. The selector was computed for the
  report and never shown, so 5 rows reading "Uneven side padding on <div>" were the same row 5
  times; it now sits under the title, trimmed to the leaf with the whole thing on hover. The why
  line states the count that earned the row and what the defect costs the page, in the panel and
  in the report.
- The Rhythm chip is called Section. Rhythm is what the defect costs you, not where to look, and
  every other chip already names a place: Gap, Edge, Padding, Type. The findings dropped the beat
  metaphor with it and say the count instead - "6 of the 7 sections on this page use 64px here".
- An inline stylesheet is no longer an element's name. The label walker took every text node under
  an element, so a container holding a <style> was labelled with its CSS: kactusbio.com reported a
  finding on <div> "h2 { font-weight: 500; } .lo...".
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
