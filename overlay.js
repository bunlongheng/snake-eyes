// Snake Eyes: spacing audit overlay.
// Injected on demand by background.js after lib/pure.js. Runs once, draws guides + a panel,
// and removes itself when injected again (toggle). Everything lives in a closed shadow root
// under #snake-eyes-root, so page CSS cannot restyle it and page script cannot reach it.
// The IIFE returns true when it closed an existing overlay, so background.js can remove
// the page-level CSS again. window.__snakeEyes (isolated world only) is the test hook.
(() => {
  const ROOT_ID = "snake-eyes-root";
  // window.__snakeEyes lives in the extension's isolated world, so the page cannot forge it.
  // A page CAN plant an element with our id, hence we never trust the DOM to decide the toggle.
  if (window.__snakeEyes && typeof window.__snakeEyes.close === "function") {
    window.__snakeEyes.close();
    return true;
  }
  if (!document.body) return false;

  const { TOL, LIMITS, px, same, severityFor, outliers, sameKind } = globalThis.__snkPure;
  // chrome is absent when the tests inject this directly, so every call is guarded.
  const VERSION = (() => { try { return chrome.runtime.getManifest().version; } catch { return "dev"; } })();
  const tellWorker = (type) => { try { if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id) chrome.runtime.sendMessage({ type }); } catch { /* worker asleep or not an extension context */ } };
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT", "TEMPLATE", "BR", "HR", "CANVAS", "IFRAME", "OPTION"]);
  const HTML_NS = "http://www.w3.org/1999/xhtml";

  // ---------- stage 1: read the page ----------
  // 1 pass over the DOM, rect + computed style once per element. Nothing here judges anything.
  function scanPage() {
      const info = new Map();
      let nodesSeen = 0, scanTruncated = false;
      const visit = (el) => {
      if (el.namespaceURI !== HTML_NS || SKIP_TAGS.has(el.tagName) || el.id === ROOT_ID) return false;
      const cs = getComputedStyle(el);
      if (cs.display === "none") return false;
      const b = el.getBoundingClientRect();
      const r = { top: b.top + scrollY, left: b.left + scrollX, right: b.right + scrollX, bottom: b.bottom + scrollY, width: b.width, height: b.height };
      const visible = cs.visibility !== "hidden" && cs.opacity !== "0" && b.width > 1 && b.height > 1;
      const inFlow = cs.position !== "absolute" && cs.position !== "fixed" && cs.display !== "contents";
      info.set(el, { cs, r, visible, inFlow, kids: null, label: null });
      // opacity:0 cannot be undone by a child, so skip the whole subtree. visibility:hidden can be,
      // so keep descending there. A zero-size box can still have visible overflow.
      if (cs.opacity === "0") return false;
      return visible || cs.overflow === "visible";
    };
      const stack = [document.body];
      while (stack.length) {
        const el = stack.pop();
        if (++nodesSeen > LIMITS.maxNodes) { scanTruncated = true; break; }
        if (!visit(el)) continue;
        for (let i = el.children.length - 1; i >= 0; i--) stack.push(el.children[i]);
      }
      return { info, nodesSeen, scanTruncated };
  }

  // ---------- stage 2: judge what was read ----------
  // Takes the scan and returns ranked issues. Every measurement it needs is already in `info`,
  // so this stage never touches layout and can be driven against a scan captured elsewhere.
  function analyze({ info }) {
    const get = (el) => info.get(el);
    const rectOf = (el) => get(el).r;
    const kidsOf = (el) => {
      const i = get(el);
      if (!i) return [];
      if (!i.kids) {
        i.kids = [];
        for (const c of el.children) { const ci = get(c); if (ci && ci.visible && ci.inFlow) i.kids.push(c); }
      }
      return i.kids;
    };
    const all = [...info.keys()].filter((el) => get(el).visible);

    // ---------- helpers that need the DOM ----------
    const selector = (el) => {
      const parts = [];
      let e = el, depth = 0;
      while (e && e.nodeType === 1 && e !== document.body && depth < LIMITS.selectorDepth) {
        let s = e.tagName.toLowerCase();
        if (e.id && !/\d{3,}/.test(e.id)) { parts.unshift(`${s}#${CSS.escape(e.id)}`); break; }
        const p = e.parentElement;
        if (p) {
          const sib = [...p.children].filter((c) => c.tagName === e.tagName);
          if (sib.length > 1) s += `:nth-of-type(${sib.indexOf(e) + 1})`;
        }
        if (depth === 0) {
          const cls = [...e.classList].filter((c) => /^[a-z][\w-]*$/i.test(c)).slice(0, LIMITS.maxSelectorClasses);
          if (cls.length) s += "." + cls.join(".");
        }
        parts.unshift(s);
        e = p; depth++;
      }
      return parts.join(" > ");
    };
    // Up to labelChars of the element's text, reading text nodes in order and stopping early.
    const label = (el) => {
      const i = get(el);
      if (i && i.label !== null) return i.label;
      let t = "";
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      while (t.length < LIMITS.labelChars) {
        const n = w.nextNode();
        if (!n) break;
        const s = n.nodeValue.replace(/\s+/g, " ").trim();
        if (s) t += (t ? " " : "") + s;
      }
      const cut = t.length > LIMITS.labelChars;
      t = t.slice(0, LIMITS.labelChars).replace(/[`#*_[\]>]/g, "");
      const out = `<${el.tagName.toLowerCase()}>${t ? ` "${t}${cut ? "..." : ""}"` : ""}`;
      if (i) i.label = out;
      return out;
    };
    const kinds = (els) => sameKind(els.map((x) => x.tagName), els.map((x) => x.classList[0] || ""));
    // group siblings into rows: sort by top once, then sweep
    const groupRows = (kids) => {
      const sorted = kids.map((el) => ({ el, r: rectOf(el) })).sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left);
      const rows = [];
      for (const it of sorted) {
        const last = rows[rows.length - 1];
        if (last && same(last.top, it.r.top)) last.items.push(it); else rows.push({ top: it.r.top, items: [it] });
      }
      for (const row of rows) row.items.sort((a, b) => a.r.left - b.r.left);
      return rows;
    };
    // a centered layout: children are centered on the parent and do not stretch across it
    const centered = (el, items) => {
      const { r: c, cs } = get(el);
      const flex = cs.display.includes("flex");
      const column = cs.flexDirection.startsWith("column");
      if (flex && column && cs.alignItems === "center") return true;
      if (flex && !column && cs.justifyContent === "center") return true;
      const inner = c.width - px(cs.paddingLeft) - px(cs.paddingRight);
      const stretched = items.filter((x) => x.r.width >= inner - TOL * 2).length;
      if (stretched >= items.length / 2) return false;
      const mid = c.left + c.width / 2;
      return items.every((x) => Math.abs(x.r.left + x.r.width / 2 - mid) <= TOL + 1);
    };
    // inline text runs (a paragraph with links) are not a layout row
    const isInlineRun = (el, items) => {
      const cs = get(el).cs;
      if (cs.display.includes("flex") || cs.display.includes("grid")) return false;
      for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) return true;
      return items.some((x) => get(x.el).cs.display.startsWith("inline"));
    };
    const hGuide = (x1, x2, y, v, bad) => ({ kind: "h", x1, x2, y, text: `${v}px`, bad });
    const vGuide = (y1, y2, x, text, bad) => ({ kind: "v", y1, y2, x, text, bad });
    const edgeGuide = (x, y1, y2, text, bad) => ({ kind: "edge", x, y1, y2, text, bad });
  // a filled band over a real region (a padding strip), so the space itself is visible, not just a line
  const band = (x, y, w, h, text, bad) => ({ kind: "band", x, y, w, h, text, bad });

    // ---------- analysis ----------
    const issues = [];
    const add = (issue) => { issue.r = rectOf(issue.el); issues.push(issue); };

    for (const el of all) {
      const kids = kidsOf(el);
      if (kids.length < 2) continue;
      const rows = groupRows(kids);
      const sameKids = kinds(kids); // asked by both the stack and the edge check below

      // 1a: horizontal gaps inside each row
      for (const row of rows) {
        if (row.items.length < LIMITS.minRowItems || !kinds(row.items.map((x) => x.el)) || isInlineRun(el, row.items)) continue;
        const gaps = [];
        for (let i = 1; i < row.items.length; i++) {
          const a = row.items[i - 1].r, b = row.items[i].r;
          gaps.push({ v: Math.round(b.left - a.right), x1: a.right, x2: b.left, y: (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2 });
        }
        if (gaps.some((g) => g.v < 0)) continue;
        const { exp, diff, off } = outliers(gaps.map((g) => g.v));
        if (diff > TOL) {
          add({ type: "gaps", severity: severityFor(diff), el, title: `Uneven horizontal gaps in ${label(el)}`,
            detail: `${row.items.length} items in a row, gaps ${gaps.map((g) => g.v).join(", ")}px (most are ${exp}px)`,
            expected: `${exp}px between every item`,
            guides: gaps.map((g, i) => hGuide(g.x1, g.x2, g.y, g.v, off.includes(i))) });
        }
      }

      // 1b: vertical gaps between rows
      if (rows.length >= LIMITS.minStackRows && sameKids) {
        const gaps = [];
        for (let i = 1; i < rows.length; i++) {
          const prev = rows[i - 1], cur = rows[i];
          let prevBottom = -Infinity, curTop = Infinity, left = Infinity, right = -Infinity;
          for (const x of prev.items) if (x.r.bottom > prevBottom) prevBottom = x.r.bottom;
          for (const x of cur.items) { if (x.r.top < curTop) curTop = x.r.top; if (x.r.left < left) left = x.r.left; if (x.r.right > right) right = x.r.right; }
          gaps.push({ v: Math.round(curTop - prevBottom), y1: prevBottom, y2: curTop, x: (left + right) / 2 });
        }
        if (!gaps.some((g) => g.v < 0)) {
          const { exp, diff, off } = outliers(gaps.map((g) => g.v));
          if (diff > TOL) {
            add({ type: "gaps", severity: severityFor(diff), el, title: `Uneven vertical gaps in ${label(el)}`,
              detail: `${rows.length} stacked blocks, gaps ${gaps.map((g) => g.v).join(", ")}px (most are ${exp}px)`,
              expected: `${exp}px between every block`,
              guides: gaps.map((g, i) => vGuide(g.y1, g.y2, g.x, `${g.v}px`, off.includes(i))) });
          }
        }
      }

      // 2: left and right edge alignment of stacked siblings.
      // Block boxes only. Inline and inline-block elements start wherever the words reach them, so
      // 3 code chips inside a paragraph land on 3 lines, look like a stack of 3 siblings, and get
      // reported for not sharing a left edge they were never meant to share. Telling someone to
      // push a chip out of the middle of its own sentence is worse than the imaginary defect.
      const startsItsOwnLine = (x) => { const d = get(x.el).cs.display; return !d.startsWith("inline") && d !== "contents"; };
      if (rows.length >= LIMITS.minEdgeRows && rows.every((r) => r.items.length === 1) && sameKids) {
        const items = rows.map((r) => r.items[0]);
        if (!centered(el, items) && items.every(startsItsOwnLine) && !isInlineRun(el, items)) {
          let top = Infinity, bottom = -Infinity;
          for (const x of items) { if (x.r.top < top) top = x.r.top; if (x.r.bottom > bottom) bottom = x.r.bottom; }
          for (const side of ["left", "right"]) {
            const vals = items.map((x) => Math.round(x.r[side]));
            const { exp, off } = outliers(vals);
            if (!off.length || off.length === items.length) continue;
            for (const idx of off) {
              const o = items[idx], d = vals[idx] - exp;
              add({ type: "align", severity: severityFor(Math.abs(d)), el: o.el,
                title: `${side === "left" ? "Left" : "Right"} edge off by ${Math.abs(d)}px: ${label(o.el)}`,
                detail: `${side} edge sits at ${vals[idx]}px, its siblings in ${label(el)} sit at ${exp}px`,
                expected: `${side} edge at ${exp}px like its siblings`,
                guides: [edgeGuide(exp, top, bottom, `${exp}px`, false), edgeGuide(o.r[side], o.r.top, o.r.bottom, `${vals[idx]}px (${d > 0 ? "+" : ""}${d})`, true)] });
            }
          }
        }
      }
    }

    // 3: padding that disagrees with its own siblings.
  // This used to report any box whose padding was not symmetric, which was wrong in principle and
  // catastrophic in practice: on a real marketing page 41 of 43 findings were this check, and every
  // one was deliberate. A card with more room at the bottom than the top is a design decision, and
  // so is a 3px optical nudge under a heading. What is NOT a decision is 1 card in a row of 4 with
  // padding the other 3 do not share. So: vertical padding is no longer compared at all (section
  // rhythm already covers vertical spacing), and horizontal padding is only reported when the
  // element's own same-kind siblings disagree with it.
  const padOf = (el) => { const { cs } = get(el); return [px(cs.paddingLeft), px(cs.paddingRight)]; };
  for (const el of all) {
    if (el.tagName === "SECTION" || kidsOf(el).length === 0) continue;
    const { r } = get(el);
    if (r.width < LIMITS.minPadW || r.height < LIMITS.minPadH) continue;
    const [pl, pr] = padOf(el);
    if (same(pl, pr) || Math.max(pl, pr) === 0) continue;

    // the design-system escape hatch: if same-kind siblings use this exact padding, it is the rule
    const parent = el.parentElement;
    const peers = parent ? kidsOf(parent).filter((c) => c !== el && kinds([c, el])) : [];
    const agreeing = peers.filter((c) => { const [l, rr] = padOf(c); return same(l, pl) && same(rr, pr); }).length;
    if (agreeing >= 1) continue;

    const diff = Math.abs(pl - pr);
    // padding asymmetry is often deliberate, so it never outranks a gap or an edge issue
    const sev = severityFor(diff);
    add({ type: "padding", severity: sev === "high" ? "medium" : sev, el,
      title: `Uneven side padding on ${label(el)}`,
      detail: `left ${pl}px vs right ${pr}px${peers.length ? `, and its ${peers.length} sibling${peers.length === 1 ? " does" : "s do"} not use this` : ""}`,
      expected: `equal left and right padding, or the same values its siblings use`,
      guides: [band(r.left, r.top, pl, r.height, `${pl}px`, pl > pr), band(r.right - pr, r.top, pr, r.height, `${pr}px`, pr > pl)] });
  }

  // 4: section rhythm - top/bottom padding and content inset across page sections
    const sections = all.filter((el) => el.tagName === "SECTION" && get(el).r.width >= innerWidth * LIMITS.sectionWidthRatio && get(el).r.height >= LIMITS.minSectionH);
    if (sections.length >= 2) {
      const pads = sections.map((s) => { const { cs, r } = get(s); return { el: s, r, pt: px(cs.paddingTop), pb: px(cs.paddingBottom) }; });
      for (const side of ["pt", "pb"]) {
        const vals = pads.map((p) => p[side]);
        const { exp, off } = outliers(vals);
        if (!off.length || off.length === pads.length) continue;
        for (const idx of off) {
          const o = pads[idx];
          const y1 = side === "pt" ? o.r.top : o.r.bottom - o[side], y2 = side === "pt" ? o.r.top + o[side] : o.r.bottom;
          add({ type: "rhythm", severity: severityFor(Math.abs(o[side] - exp)), el: o.el,
            title: `Section ${side === "pt" ? "top" : "bottom"} padding ${o[side]}px, others use ${exp}px`,
            detail: `${label(o.el)} breaks the vertical rhythm shared by ${pads.length - off.length} other sections`,
            expected: `${side === "pt" ? "padding-top" : "padding-bottom"}: ${exp}px`,
            guides: [vGuide(y1, y2, o.r.left + o.r.width / 2, `${o[side]}px (expected ${exp})`, true)] });
        }
      }
      // where content really starts: walk down the first visible child until the left edge moves inward
      const contentStart = (section) => {
        let cur = section;
        const left = get(section).r.left;
        for (let depth = 0; depth < LIMITS.contentDepth; depth++) {
          let kid = null;
          for (const c of cur.children) { const ci = get(c); if (ci && ci.visible && ci.inFlow) { kid = c; break; } }
          if (!kid) return null;
          if (get(kid).r.left - left > TOL) return kid;
          cur = kid;
        }
        return null;
      };
      const insets = pads.map((p) => { const first = contentStart(p.el); return first ? { ...p, inset: Math.round(get(first).r.left - p.r.left), first } : null; }).filter(Boolean);
      if (insets.length >= 2) {
        const { exp, off } = outliers(insets.map((i) => i.inset));
        if (off.length && off.length < insets.length) {
          for (const idx of off) {
            const o = insets[idx], fr = get(o.first).r;
            add({ type: "rhythm", severity: severityFor(Math.abs(o.inset - exp)), el: o.first,
              title: `Content inset ${o.inset}px in ${label(o.el)}, other sections use ${exp}px`,
              detail: `the first block starts ${o.inset}px from the section's left edge`,
              expected: `${exp}px inset like the other sections`,
              guides: [edgeGuide(o.r.left + exp, fr.top, fr.bottom, `${exp}px`, false), edgeGuide(fr.left, fr.top, fr.bottom, `${o.inset}px`, true)] });
          }
        }
      }
    }

    // sort by severity first, then cap, so the cap only ever drops the least severe
    const order = { high: 0, medium: 1, low: 2 };
    issues.sort((a, b) => order[a.severity] - order[b.severity]);
    const total = issues.length;
    const dropped = Math.max(0, total - LIMITS.maxIssues);
    issues.length = Math.min(total, LIMITS.maxIssues);
    issues.forEach((i, n) => { i.n = n + 1; i.selector = selector(i.el); });
    // selectors and labels are resolved, so the per-element records (rects + styles for every
    // node on the page) are dead weight. Each issue already carries its own rect and element.
    info.clear();
    return { issues, total, dropped };
  }

  // ---------- stage 3: say it ----------
  // Captured at scan time: the numbers in the report must describe the layout that was measured,
  // not whatever the window was resized to afterwards. On file: pages only the basename is used,
  // so a report pasted into a chat never carries the local directory tree.
  function buildReport(issues, { total, dropped, scanTruncated }) {
    const scanW = Math.round(document.documentElement.getBoundingClientRect().width), scanH = innerHeight;
    const pageId = location.protocol === "file:" ? `file:///${location.pathname.split("/").pop()}` : `${location.origin}${location.pathname}`;
    return () => {
      const counts = { high: 0, medium: 0, low: 0 };
      issues.forEach((i) => counts[i.severity]++);
      const lines = [
        `# Snake Eyes spacing report`, ``,
        `- Page: ${pageId}`,
        `- Viewport: ${scanW}x${scanH}`,
        `- Date: ${new Date().toISOString().slice(0, 10)}`,
        `- Issues: ${issues.length}${dropped ? ` shown of ${total}` : ""} (${counts.high} high, ${counts.medium} medium, ${counts.low} low)`,
      ];
      if (dropped) lines.push(`- Note: capped at ${LIMITS.maxIssues}; fix these, then re-run for the remaining ${dropped}`);
      if (scanTruncated) lines.push(`- Note: scan stopped after ${LIMITS.maxNodes} elements; the page is larger than that`);
      lines.push(``, `Fix each item below in the source, then re-run Snake Eyes to confirm 0 issues. Selectors are relative to <body>.`, ``);
      for (const i of issues) lines.push(`## ${i.n}. ${i.title} (${i.severity})`, `- Selector: \`${i.selector}\``, `- Found: ${i.detail}`, `- Expected: ${i.expected}`, ``);
      if (!issues.length) lines.push(`No spacing issues found at this viewport.`);
      return lines.join("\n");
    };
  }

  // ---------- stage 4: show it ----------
  // Builds the guide layer and the panel inside a closed shadow root and wires every listener
  // to 1 AbortController, so close() takes the whole thing down in 1 call.
  function mount(issues, report, { total, dropped }) {
    const ac = new AbortController();
    const on = (target, type, fn) => target.addEventListener(type, fn, { signal: ac.signal });
    const root = document.createElement("div");
    root.id = ROOT_ID;
    const shadow = root.attachShadow({ mode: "closed" });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(window.__SNAKE_EYES_CSS__ || "");
    shadow.adoptedStyleSheets = [sheet];
    delete window.__SNAKE_EYES_CSS__;

    if (document.documentElement.classList.contains("snk-docked")) {
      const rail = document.createElement("div");
      rail.className = "snk-rail";
      shadow.appendChild(rail);
    }
    const layer = document.createElement("div");
    layer.className = "snk-layer";
    layer.setAttribute("aria-hidden", "true"); // pure decoration, never announced
    const sizeLayer = () => { layer.style.width = `${document.documentElement.scrollWidth}px`; layer.style.height = `${document.documentElement.scrollHeight}px`; };
    sizeLayer();
    shadow.appendChild(layer);

    const TYPE_LABEL = { gaps: "Gap", align: "Edge", padding: "Padding", rhythm: "Rhythm" };
    const countText = dropped ? `${issues.length} of ${total}` : `${issues.length} issue${issues.length === 1 ? "" : "s"}`;
    const panel = document.createElement("aside");
    panel.className = "snk-panel";
    panel.setAttribute("aria-label", "Snake Eyes spacing issues");
    panel.tabIndex = -1; // the panel takes focus on open so Tab walks the issues and Escape closes
    panel.innerHTML = `
      <header class="snk-head">
      <span class="snk-logo" aria-hidden="true"></span>
      <h2 class="snk-title-h">Snake Eyes <span class="snk-ver">v${VERSION}</span></h2>
      <span class="snk-spacer"></span>
      <span class="snk-ctrls">
        <button class="snk-icon snk-rescan" type="button" title="Measure again as the page looks right now: open a modal, a menu or a card first" aria-label="Re-scan"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg></button>
        <button class="snk-icon snk-collapse" type="button" title="Collapse the panel" aria-label="Collapse"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
        <button class="snk-icon snk-x" type="button" title="Close (Esc)" aria-label="Close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19"/></svg></button>
      </span>
      <div class="snk-tools">
        <span class="snk-count${issues.length ? "" : " snk-count-ok"}"></span>
        <button class="snk-btn snk-all" type="button" title="Draw every guide on the page at once">All</button>

        <button class="snk-btn snk-copy" type="button" title="Copy the report for an agent">Copy</button>
      </div>
    </header>
      <div class="snk-views" role="group" aria-label="Page views">
      <button class="snk-chip snk-ruler" type="button" title="Measure the layout: region, section, container and panel with sizes and side gaps" aria-pressed="false">Ruler</button>
      <button class="snk-chip snk-xray" type="button" title="Every box outlined, cyan where it sits shallow and violet where it nests deep" aria-pressed="false">X-ray</button>
      <button class="snk-chip snk-heat" type="button" title="Thermal map: the deeper a box is buried, the hotter it burns" aria-pressed="false">Heat</button>
      <button class="snk-chip snk-night" type="button" title="Night vision: the page through green phosphor, with every edge lit" aria-pressed="false">Night</button>
    </div>
    <div class="snk-opts" hidden>
      <span class="snk-opts-title">Layers</span>
      <label><input type="checkbox" data-k="region" checked><i style="background:#e11d48"></i>Region</label>
      <label><input type="checkbox" data-k="section" checked><i style="background:#2563eb"></i>Section</label>
      <label><input type="checkbox" data-k="container" checked><i style="background:#16a34a"></i>Container</label>
      <label><input type="checkbox" data-k="panel" checked><i style="background:#ea580c"></i>Panel</label>
      <span class="snk-opts-title">Detail</span>
      <label><input type="checkbox" data-k="sizes" checked>Sizes</label>
      <label><input type="checkbox" data-k="gaps" checked><i style="background:#7c3aed"></i>Side gaps</label>
    </div>
    <ol class="snk-list"></ol>
      <footer class="snk-foot"><span class="snk-legend">Click an issue to jump to it. Red = off, green = the value the siblings agree on.</span><span class="snk-stale" hidden>Viewport changed. Re-scan to measure this size.</span></footer>`;
    panel.querySelector(".snk-count").textContent = countText;
    shadow.appendChild(panel);
    const list = panel.querySelector(".snk-list");
    for (const i of issues) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `snk-item snk-${i.severity}`;
      btn.dataset.n = i.n;
      btn.innerHTML = `<span class="snk-n">${i.n}</span><span class="snk-tag">${TYPE_LABEL[i.type]}</span><span class="snk-title"></span><span class="snk-detail"></span>`;
      btn.querySelector(".snk-title").textContent = i.title;
      btn.querySelector(".snk-detail").textContent = i.detail;
      on(btn, "click", () => activate(i));
      li.appendChild(btn);
      list.appendChild(li);
    }
    if (!issues.length) list.innerHTML = `<li class="snk-empty">No spacing issues at this viewport. Resize the window and Re-scan to test another width.</li>`;

    const clearGuides = () => { layer.replaceChildren(); };
    const guideNodes = (g, frag) => {
      const mk = (cls, css) => { const d = document.createElement("div"); d.className = cls; Object.assign(d.style, css); frag.appendChild(d); return d; };
      const tone = g.bad ? "snk-bad" : "snk-ok";
      if (g.kind === "h") {
        mk(`snk-line snk-hline ${tone}`, { left: `${g.x1}px`, top: `${g.y}px`, width: `${Math.max(1, g.x2 - g.x1)}px` });
        mk(`snk-badge ${tone}`, { left: `${(g.x1 + g.x2) / 2}px`, top: `${g.y}px` }).textContent = g.text;
      } else if (g.kind === "v") {
        mk(`snk-line snk-vline ${tone}`, { left: `${g.x}px`, top: `${g.y1}px`, height: `${Math.max(1, g.y2 - g.y1)}px` });
        mk(`snk-badge ${tone}`, { left: `${g.x}px`, top: `${(g.y1 + g.y2) / 2}px` }).textContent = g.text;
      } else if (g.kind === "band") {
      mk(`snk-band ${tone}`, { left: `${g.x}px`, top: `${g.y}px`, width: `${Math.max(1, g.w)}px`, height: `${Math.max(1, g.h)}px` });
      mk(`snk-badge ${tone}`, { left: `${g.x + g.w / 2}px`, top: `${g.y + g.h / 2}px` }).textContent = g.text;
    } else if (g.kind === "edge") {
        const pad = LIMITS.edgeGuidePad;
        mk(`snk-line snk-vline snk-edge ${tone}`, { left: `${g.x}px`, top: `${g.y1 - pad}px`, height: `${g.y2 - g.y1 + pad * 2}px` });
        // expected badge above the box, actual badge below it, so 2 close edges never overlap
        mk(`snk-badge ${tone}`, { left: `${g.x}px`, top: `${g.bad ? g.y2 + pad : g.y1 - pad}px` }).textContent = g.text;
      }
    };
    const boxNode = (r, active, frag, caption) => {
      const d = document.createElement("div");
      d.className = `snk-box${active ? " snk-active" : ""}`;
      Object.assign(d.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      frag.appendChild(d);
      // name the box: on a page of nested wrappers, an outline alone does not say what it traces
      if (active && caption) {
        const tag = document.createElement("div");
        tag.className = "snk-boxtag";
        tag.textContent = caption;
        Object.assign(tag.style, { left: `${r.left}px`, top: `${Math.max(0, r.top - 20)}px` });
        frag.appendChild(tag);
      }
    };
    // read nothing from the page here: rects were stored at analysis time, so this is writes only.
    // sizeLayer reads scrollWidth/scrollHeight, so it runs on mount and on resize, never per draw.
    const draw = (items, activeIssue) => {
      clearGuides();
      const frag = document.createDocumentFragment();
      for (const i of items) {
        boxNode(i.r, i === activeIssue, frag, i.selector ? i.selector.split(" > ").pop() : "");
        const gs = items.length === 1 ? i.guides : i.guides.filter((g, idx) => g.bad || idx < LIMITS.guideCap);
        gs.forEach((g) => guideNodes(g, frag));
      }
      layer.appendChild(frag);
    };
    const activate = (i) => {
      if (mode !== "none") setMode("none");
      draw([i], i);
      list.querySelectorAll(".snk-item").forEach((b) => {
        const on = b.dataset.n === String(i.n);
        b.classList.toggle("snk-current", on);
        if (on) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
      });
      i.el.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    };
    on(panel.querySelector(".snk-all"), "click", () => {
      draw(issues, null);
      list.querySelectorAll(".snk-item").forEach((b) => { b.classList.remove("snk-current"); b.removeAttribute("aria-current"); });
    });
    on(panel.querySelector(".snk-copy"), "click", async (ev) => {
      const btn = ev.currentTarget;
      if (!ev.isTrusted && !window.__snakeEyesTest) return; // only a real click may write the clipboard
      try { await navigator.clipboard.writeText(report()); btn.textContent = "Copied"; }
      catch { btn.textContent = "Copy failed"; }
      setTimeout(() => { btn.textContent = "Copy"; }, LIMITS.copyResetMs);
    });
    on(panel.querySelector(".snk-collapse"), "click", () => { panel.classList.toggle("snk-collapsed"); });
    on(panel.querySelector(".snk-rescan"), "click", () => { close(false); tellWorker("rescan"); });

    // Ruler: the layout with its numbers on. Boxes are coloured by the job they do rather than by
    // depth, each carries its own size, and layout containers show the gap to each side of the
    // page. Structure and dimensions, never a verdict.
    const ROLE = { region: "#e11d48", section: "#2563eb", container: "#16a34a", panel: "#ea580c" };
    const SHOW = { region: true, section: true, container: true, panel: true, sizes: true, gaps: true };
    let ruler = false;
    const drawRuler = () => {
      sizeLayer(); clearGuides();
      const frag = document.createDocumentFragment();
      const seen = new Set();
      const pageW = document.documentElement.getBoundingClientRect().width;
      let count = 0;
      const put = (el, role, solid) => {
        if (count > LIMITS.rulerNodes || !SHOW[role]) return;
        const b = el.getBoundingClientRect();
        if (b.width < 60 || b.height < 24) return;
        const r = { left: b.left + scrollX, top: b.top + scrollY, width: b.width, height: b.height };
        const key = `${role}:${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
        if (seen.has(key)) return;
        seen.add(key);
        count++;
        const d = document.createElement("div");
        d.className = "snk-rbox";
        Object.assign(d.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, borderColor: ROLE[role], borderStyle: solid ? "solid" : "dashed" });
        frag.appendChild(d);
        if (SHOW.sizes) {
          const tag = document.createElement("div");
          tag.className = "snk-rtag";
          tag.textContent = `${Math.round(r.width)} x ${Math.round(r.height)}`;
          Object.assign(tag.style, { left: `${r.left}px`, top: `${r.top}px`, background: ROLE[role] });
          frag.appendChild(tag);
        }
        if (role === "container" && SHOW.gaps) {
          const bandH = Math.min(r.height, 60);
          for (const [x, w] of [[0, Math.round(r.left)], [Math.round(r.left + r.width), Math.round(pageW - r.left - r.width)]]) {
            if (w <= 1 || w >= pageW) continue;
            const g = document.createElement("div");
            g.className = "snk-rgap";
            Object.assign(g.style, { left: `${x}px`, top: `${r.top}px`, width: `${w}px`, height: `${bandH}px` });
            const t = document.createElement("div");
            t.className = "snk-rgaptag";
            t.textContent = `${w}`;
            g.appendChild(t);
            frag.appendChild(g);
          }
        }
      };
      document.querySelectorAll("header, nav, aside, footer").forEach((el) => put(el, "region", false));
      document.querySelectorAll("section, main > div, [class*='section']").forEach((el) => put(el, "section", false));
      for (const el of document.querySelectorAll("body *")) {
        if (el.id === ROOT_ID || count > LIMITS.rulerNodes) continue;
        const d = getComputedStyle(el).display;
        if (!/^(inline-)?(flex|grid)$/.test(d)) continue;
        const b = el.getBoundingClientRect();
        if (b.width < 200 || b.height < 48) continue;
        put(el, "container", false);
        for (const kid of el.children) {
          const kr = kid.getBoundingClientRect();
          if (kr.width >= 80 && kr.height >= 40 && kr.width <= b.width * 0.98) put(kid, "panel", true);
        }
      }
      layer.appendChild(frag);
      panel.querySelector(".snk-legend").innerHTML =
        `Ruler: ${count} boxes, sizes in px. <b style="color:${ROLE.region}">Region</b> <b style="color:${ROLE.section}">Section</b> <b style="color:${ROLE.container}">Container</b> <b style="color:${ROLE.panel}">Panel</b>. Purple bands are the gap to each side. No judgement here, your findings are the list above.`;
    };
    for (const cb of panel.querySelectorAll(".snk-opts input")) {
      on(cb, "change", () => { SHOW[cb.dataset.k] = cb.checked; if (ruler) drawRuler(); });
    }
    // X-ray answers a different question from Ruler: not how big a box is, but how deeply it is
    // buried. Every element, outlined only, cyan shallow to violet deep. Never red or green,
    // which already mean wrong and right on every guide.
    const drawXray = () => {
      sizeLayer(); clearGuides();
      const frag = document.createDocumentFragment();
      let seen = 0;
      const walk = (el, depth) => {
        if (seen > LIMITS.rulerNodes) return;
        for (const kid of el.children) {
          if (kid.id === ROOT_ID) continue;
          const cs = getComputedStyle(kid);
          if (cs.display === "none" || cs.visibility === "hidden") continue;
          const b = kid.getBoundingClientRect();
          if (b.width > 2 && b.height > 2) {
            seen++;
            const d = document.createElement("div");
            d.className = "snk-xbox";
            Object.assign(d.style, {
              left: `${b.left + scrollX}px`, top: `${b.top + scrollY}px`,
              width: `${b.width}px`, height: `${b.height}px`,
              borderColor: `hsl(${190 + Math.min(depth, 11) * 10} 85% 55% / 0.8)`,
            });
            frag.appendChild(d);
          }
          walk(kid, depth + 1);
        }
      };
      walk(document.body, 0);
      layer.appendChild(frag);
      panel.querySelector(".snk-legend").textContent = `X-ray: structure only, no judgement. ${seen} boxes on this page, cyan sits shallow and violet sits deep. Your findings are the list above.`;
    };

    // FLIR: the classic thermal ramp, black through violet and red to white, driven by how deeply
    // a box is buried. Filled, unlike X-ray, because a heat map without fill is just an outline.
    const HEAT = ["#0b0033", "#3b0f70", "#7b2382", "#b5367a", "#e05c5c", "#f08f3c", "#f7c531", "#fdf6b2"];
    const drawHeat = () => {
      sizeLayer(); clearGuides();
      // Collect first, then colour. A fixed 8-step ramp leaves a shallow page entirely violet,
      // so the scale is normalised to the deepest box actually on this page: whatever is most
      // buried here burns white, whatever sits on the surface stays cold.
      const found = [];
      let deepest = 1;
      const walk = (el, depth) => {
        if (found.length > LIMITS.rulerNodes) return;
        for (const kid of el.children) {
          if (kid.id === ROOT_ID) continue;
          const cs = getComputedStyle(kid);
          if (cs.display === "none" || cs.visibility === "hidden") continue;
          const b = kid.getBoundingClientRect();
          if (b.width > 2 && b.height > 2) { found.push({ b, depth }); if (depth > deepest) deepest = depth; }
          walk(kid, depth + 1);
        }
      };
      walk(document.body, 0);
      const frag = document.createDocumentFragment();
      for (const { b, depth } of found) {
        const d = document.createElement("div");
        d.className = "snk-heatbox";
        const c = HEAT[Math.min(HEAT.length - 1, Math.round((depth / deepest) * (HEAT.length - 1)))];
        Object.assign(d.style, { left: `${b.left + scrollX}px`, top: `${b.top + scrollY}px`, width: `${b.width}px`, height: `${b.height}px`, background: c, borderColor: c });
        frag.appendChild(d);
      }
      layer.appendChild(frag);
      panel.querySelector(".snk-legend").textContent = `Heat: ${found.length} boxes over ${deepest} levels. Cold violet sits on the surface, white hot is the most deeply buried on this page. Structure only, your findings are the list above.`;
    };

    // Night vision: the page itself through green phosphor, plus scanlines and a lit edge on
    // every box. The filter lives on the page, so it comes off with the mode and on close.
    const drawNight = () => {
      sizeLayer(); clearGuides();
      document.documentElement.classList.add("snk-nv");
      const frag = document.createDocumentFragment();
      const scan = document.createElement("div");
      scan.className = "snk-scanlines";
      frag.appendChild(scan);
      let seen = 0;
      for (const el of document.querySelectorAll("body *")) {
        if (seen > LIMITS.rulerNodes) break;
        if (el.id === ROOT_ID) continue;
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        const b = el.getBoundingClientRect();
        if (b.width < 8 || b.height < 8) continue;
        seen++;
        const d = document.createElement("div");
        d.className = "snk-nvbox";
        Object.assign(d.style, { left: `${b.left + scrollX}px`, top: `${b.top + scrollY}px`, width: `${b.width}px`, height: `${b.height}px` });
        frag.appendChild(d);
      }
      layer.appendChild(frag);
      panel.querySelector(".snk-legend").textContent = `Night vision: ${seen} boxes lit. The page is tinted, not changed, and the tint comes off with the mode.`;
    };

    const LEGEND = "Click an issue to jump to it. Red = off, green = the value the siblings agree on.";
    // 2 views of the same page, so only 1 can be on at a time
    let mode = "none";
    const DRAW = { ruler: drawRuler, xray: drawXray, heat: drawHeat, night: drawNight };
    const setMode = (want) => {
      mode = want === mode ? "none" : want;
      ruler = mode === "ruler";
      document.documentElement.classList.toggle("snk-nv", mode === "night");
      for (const name of ["ruler", "xray", "heat", "night"]) {
        const btn = panel.querySelector(`.snk-${name}`);
        btn.classList.toggle("snk-on", mode === name);
        btn.setAttribute("aria-pressed", String(mode === name));
      }
      panel.querySelector(".snk-opts").hidden = !ruler;
      if (mode === "none") { panel.querySelector(".snk-legend").textContent = LEGEND; if (issues.length) activate(issues[0]); else clearGuides(); return; }
      DRAW[mode]();
      list.querySelectorAll(".snk-item").forEach((b) => { b.classList.remove("snk-current"); b.removeAttribute("aria-current"); });
    };
    for (const name of ["ruler", "xray", "heat", "night"]) on(panel.querySelector(`.snk-${name}`), "click", () => setMode(name));

    const returnFocusTo = document.activeElement;
    const close = (notify = true) => {
      ac.abort();
      root.remove();
      document.documentElement.classList.remove("snk-docked", "snk-nv"); // page gets its width and its colours back
      delete window.__snakeEyes;
      // hand focus back where it was rather than dropping the keyboard user on <body>
      if (returnFocusTo && returnFocusTo.isConnected && typeof returnFocusTo.focus === "function") returnFocusTo.focus({ preventScroll: true });
      if (notify) tellWorker("closed");
    };
    on(panel.querySelector(".snk-x"), "click", () => close());
    // A page can dispatch its own keydown and resize events. Acting on those would let the site
    // being audited quietly dismiss the panel or mark it stale, so only real user input counts.
    const real = (e) => e.isTrusted || window.__snakeEyesTest;
    on(document, "keydown", (e) => { if (e.key === "Escape" && real(e)) close(); });
    let resizeTimer = 0;
    on(window, "resize", (e) => {
      if (!real(e)) return;
      sizeLayer();
      clearGuides();
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        panel.querySelector(".snk-stale").hidden = false;
        panel.querySelector(".snk-legend").hidden = true;
        // Re-scan is always available, since the state worth measuring is often behind a click.
        // Going stale only highlights it, and takes Show all away: every guide it would draw is
        // stale, and a 5th control would wrap the header onto a second row.
        panel.querySelector(".snk-rescan").classList.add("snk-urgent");
        panel.querySelector(".snk-all").hidden = true;
        panel.querySelector(".snk-count").hidden = true; // that tally described the old layout too
        // every measurement on screen belongs to the old viewport, so nothing here may be replayed.
        // Copy stays live on purpose: the report states the viewport it was measured at.
        list.querySelectorAll(".snk-item").forEach((b) => { b.disabled = true; });
      }, LIMITS.resizeDebounceMs);
    });

    document.documentElement.appendChild(root);
    if (issues.length) activate(issues[0]);
    panel.focus({ preventScroll: true });
    return { shadow, close };
  }

  // ---------- stage 0: say we heard the click ----------
  // The scan takes about 30ms, far too fast to see, so a click would otherwise look like nothing
  // happened until the panel appeared. The snake holds the moment and names the extension.
  function showSnake() {
    const root = document.createElement("div");
    root.id = ROOT_ID;
    const shadow = root.attachShadow({ mode: "closed" });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(window.__SNAKE_EYES_CSS__ || "");
    shadow.adoptedStyleSheets = [sheet];
    if (canDock) {
      const rail = document.createElement("div");
      rail.className = "snk-rail";
      shadow.appendChild(rail);
    }
    const box = document.createElement("div");
    box.className = "snk-splash";
    box.setAttribute("role", "status");
    box.innerHTML = `<div class="snk-snake"><div class="snk-art"></div></div>
      <span class="snk-splash-text">Measuring the page</span>`;
    shadow.appendChild(box);
    document.documentElement.appendChild(root);
    return { root, shadow };
  }

  // ---------- the run ----------
  // Dock first, then measure. Shrinking the page after the scan would leave every rect describing
  // a layout the panel is now covering.
  // Docking narrows the page, which can cross a responsive breakpoint and change the very layout
  // being audited. Only wide windows have room to give up a strip and still be the same design.
  const canDock = innerWidth >= LIMITS.dockMinWidth;
  if (canDock) document.documentElement.classList.add("snk-docked");
  const splash = showSnake();
  // a second click, or Escape, must cancel a scan in flight, so the handle exists from frame 1
  const splashAc = new AbortController();
  const undock = () => document.documentElement.classList.remove("snk-docked");
  const cancel = () => { splashAc.abort(); splash.root.remove(); undock(); delete window.__snakeEyes; tellWorker("closed"); };
  window.__snakeEyes = { ready: false, close: cancel };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && (e.isTrusted || window.__snakeEyesTest)) cancel(); }, { signal: splashAc.signal });

  const wait = window.__snakeEyesTest ? LIMITS.splashMs / 10 : LIMITS.splashMs;
  const startedAt = performance.now();
  requestAnimationFrame(() => {
  const scan = scanPage();
  const { issues, total, dropped } = analyze(scan);
  const report = buildReport(issues, { total, dropped, scanTruncated: scan.scanTruncated });
  setTimeout(() => {
  if (!window.__snakeEyes || window.__snakeEyes.ready) return; // cancelled mid-scan
  splashAc.abort();
  splash.root.remove();
  const ui = mount(issues, report, { total, dropped });

  window.__snakeEyes = {
    ready: true,
    issues: issues.map(({ el: _el, guides, r, ...rest }) => ({ ...rest, guides: guides.length, box: r })),
    elements: issues.map((i) => i.el),
    total, dropped, scanTruncated: scan.scanTruncated, nodesSeen: scan.nodesSeen,
    report, shadow: ui.shadow, close: ui.close,
    // the stages, so a test can drive one without the other 3
    stages: { scanPage, analyze, buildReport, mount },
  };
  }, Math.max(0, wait - (performance.now() - startedAt)));
  });
  return false;
})();
