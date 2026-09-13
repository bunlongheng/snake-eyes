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

      // 2: left and right edge alignment of stacked siblings
      if (rows.length >= LIMITS.minEdgeRows && rows.every((r) => r.items.length === 1) && sameKids) {
        const items = rows.map((r) => r.items[0]);
        if (!centered(el, items)) {
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

    // 3: asymmetric padding on containers (sections belong to the rhythm check)
    for (const el of all) {
      if (el.tagName === "SECTION" || kidsOf(el).length === 0) continue;
      const { cs, r } = get(el);
      if (r.width < LIMITS.minPadW || r.height < LIMITS.minPadH) continue;
      const pl = px(cs.paddingLeft), pr = px(cs.paddingRight), pt = px(cs.paddingTop), pb = px(cs.paddingBottom);
      const guides = [], bits = [];
      if (!same(pl, pr) && Math.max(pl, pr) > 0) {
        bits.push(`left ${pl}px vs right ${pr}px`);
        guides.push(hGuide(r.left, r.left + pl, r.top + r.height / 2, pl, pl > pr), hGuide(r.right - pr, r.right, r.top + r.height / 2, pr, pr > pl));
      }
      if (!same(pt, pb) && Math.max(pt, pb) > 0 && r.height >= LIMITS.minPadHVertical) {
        bits.push(`top ${pt}px vs bottom ${pb}px`);
        guides.push(vGuide(r.top, r.top + pt, r.left + r.width / 2, `${pt}px`, pt > pb), vGuide(r.bottom - pb, r.bottom, r.left + r.width / 2, `${pb}px`, pb > pt));
      }
      if (bits.length) {
        const diff = Math.max(Math.abs(pl - pr), Math.abs(pt - pb));
        // padding asymmetry is often deliberate (an icon, an optical correction), so it never
        // outranks a gap or an edge issue no matter how large it is
        const sev = severityFor(diff);
        add({ type: "padding", severity: sev === "high" ? "medium" : sev, el, title: `Asymmetric padding on ${label(el)}`,
          detail: bits.join("; "), expected: "equal padding on opposite sides unless the asymmetry is deliberate", guides });
      }
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
    const scanW = innerWidth, scanH = innerHeight;
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
        <span class="snk-logo" aria-hidden="true"><i></i><i></i></span>
        <h2 class="snk-title-h">Snake Eyes</h2>
        <span class="snk-count${issues.length ? "" : " snk-count-ok"}"></span>
        <span class="snk-spacer"></span>
        <button class="snk-btn snk-rescan" type="button" title="Measure this page again at the current size" hidden>Re-scan</button>
        <button class="snk-btn snk-all" type="button" title="Draw every guide at once">Show all</button>
        <button class="snk-btn snk-copy" type="button" title="Copy the report for an agent">Copy report</button>
        <button class="snk-icon snk-collapse" type="button" title="Collapse the panel" aria-label="Collapse"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
        <button class="snk-icon snk-x" type="button" title="Close (Esc)" aria-label="Close"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
      </header>
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
      } else if (g.kind === "edge") {
        const pad = LIMITS.edgeGuidePad;
        mk(`snk-line snk-vline snk-edge ${tone}`, { left: `${g.x}px`, top: `${g.y1 - pad}px`, height: `${g.y2 - g.y1 + pad * 2}px` });
        // expected badge above the box, actual badge below it, so 2 close edges never overlap
        mk(`snk-badge ${tone}`, { left: `${g.x}px`, top: `${g.bad ? g.y2 + pad : g.y1 - pad}px` }).textContent = g.text;
      }
    };
    const boxNode = (r, active, frag) => {
      const d = document.createElement("div");
      d.className = `snk-box${active ? " snk-active" : ""}`;
      Object.assign(d.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      frag.appendChild(d);
    };
    // read nothing from the page here: rects were stored at analysis time, so this is writes only.
    // sizeLayer reads scrollWidth/scrollHeight, so it runs on mount and on resize, never per draw.
    const draw = (items, activeIssue) => {
      clearGuides();
      const frag = document.createDocumentFragment();
      for (const i of items) {
        boxNode(i.r, i === activeIssue, frag);
        const gs = items.length === 1 ? i.guides : i.guides.filter((g, idx) => g.bad || idx < LIMITS.guideCap);
        gs.forEach((g) => guideNodes(g, frag));
      }
      layer.appendChild(frag);
    };
    const activate = (i) => {
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
      setTimeout(() => { btn.textContent = "Copy report"; }, LIMITS.copyResetMs);
    });
    on(panel.querySelector(".snk-collapse"), "click", () => { panel.classList.toggle("snk-collapsed"); });
    on(panel.querySelector(".snk-rescan"), "click", () => { close(false); tellWorker("rescan"); });

    // chrome is absent when the tests inject this directly, so every call is guarded.
    const tellWorker = (type) => { try { if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id) chrome.runtime.sendMessage({ type }); } catch { /* worker asleep or not an extension context */ } };
    const returnFocusTo = document.activeElement;
    const close = (notify = true) => {
      ac.abort();
      root.remove();
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
        // Re-scan replaces Show all rather than joining it: every guide it would draw is stale,
        // and a 5th control wraps the header onto a second row.
        panel.querySelector(".snk-rescan").hidden = false;
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

  // ---------- the run ----------
  const scan = scanPage();
  const { issues, total, dropped } = analyze(scan);
  const report = buildReport(issues, { total, dropped, scanTruncated: scan.scanTruncated });
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
  return false;
})();
