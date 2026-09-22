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

  const { TOL, LIMITS, px, same, severityFor, outliers, sameKind, majority } = globalThis.__snkPure;
  // chrome is absent when the tests inject this directly, so every call is guarded.
  const VERSION = (() => { try { return chrome.runtime.getManifest().version; } catch { return "dev"; } })();
  const tellWorker = (type) => { try { if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id) chrome.runtime.sendMessage({ type }); } catch { /* worker asleep or not an extension context */ } };
  const NOT_TEXT = new Set(["STYLE", "SCRIPT", "NOSCRIPT", "TEMPLATE"]); // their text is source, never a name
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
      // SKIP_TAGS keeps <style> and <script> out of the scan but not out of this walk, so a
      // container holding an inline stylesheet was labelled with its CSS. Reject that text here.
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (NOT_TEXT.has(n.parentNode && n.parentNode.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
      });
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
    // Where a box paints its left or right edge, which is the edge the eye lines up. Normally
    // that is the box itself, border and padding included. The exception is a negative margin:
    // a grid row built that way hangs outside everything painted in it, because the gutter it is
    // cancelling is carried as padding on its cells. On kactusbio.com a .custom-content row sits
    // at -22px and reads as 22px out of line with every section above it, while its text lands in
    // exactly the same place; on a Timber or Expanse theme every grid on every page does this. So
    // when the margin on that side is negative, the edge is where its children start painting,
    // floored at its own content edge so an overflowing child cannot drag the answer outwards.
    const visEdge = (el, side) => {
      const { r, cs } = get(el);
      const left = side === "left";
      const own = left
        ? r.left + px(cs.borderLeftWidth) + px(cs.paddingLeft)
        : r.right - px(cs.borderRightWidth) - px(cs.paddingRight);
      if (px(left ? cs.marginLeft : cs.marginRight) >= 0) return Math.round(own);
      let kid = null;
      for (const c of el.children) {
        const i = get(c);
        if (!i) continue;
        const v = left
          ? i.r.left + px(i.cs.borderLeftWidth) + px(i.cs.paddingLeft)
          : i.r.right - px(i.cs.borderRightWidth) - px(i.cs.paddingRight);
        if (kid === null || (left ? v < kid : v > kid)) kid = v;
      }
      if (kid === null) return Math.round(own);
      return Math.round(left ? Math.max(own, kid) : Math.min(own, kid));
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
        // A gap is only a defect when nothing explains it. When the excess over the shared gap is
        // exactly an explicit margin on one of the 2 items beside it, and that item is not the
        // same kind as the rest of the row, the space was typed on purpose: a real footer holds
        // its logo block away from its menus with margin-right: 35px on top of a 20px flex gap,
        // and calling that a mistake is how a report loses the reader's trust.
        // Both signals are needed. 4 cards that share a class and differ by a stray margin still
        // report, and so does a margin that IS the row's gap rule rather than an addition to it:
        // a row spaced by margin-right: 24px with 31px on 1 card has an excess of 7px, which no
        // margin on the page equals.
        const classSig = (x) => [...x.el.classList].sort().join(" ");
        const sigs = row.items.map(classSig);
        const sigCount = new Map();
        for (const sg of sigs) sigCount.set(sg, (sigCount.get(sg) || 0) + 1);
        let rowSig = "", rowSigN = 0;
        for (const [sg, n] of sigCount) if (n > rowSigN) { rowSig = sg; rowSigN = n; }
        const authored = (k) => {
          const excess = gaps[k].v - exp;
          if (excess <= TOL) return false;
          for (const [idx, side] of [[k, "marginRight"], [k + 1, "marginLeft"]]) {
            if (sigs[idx] === rowSig || rowSigN < 2) continue;
            if (same(px(get(row.items[idx].el).cs[side]), excess)) return true;
          }
          return false;
        };
        if (diff > TOL && off.some((k) => !authored(k))) {
          add({ type: "gaps", severity: severityFor(diff), el, title: `Uneven horizontal gaps in ${label(el)}`,
            detail: `${row.items.length} items in a row, gaps ${gaps.map((g) => g.v).join(", ")}px (most are ${exp}px)`,
            why: `Equal gaps are what make a row read as one set. ${off.length} of ${gaps.length} disagree with the ${exp}px the rest share, so the row looks like it has groups in it that the markup never put there.`,
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
              why: `A stack with one gap out of step reads as 2 groups instead of 1 list. ${off.length} of ${gaps.length} gaps differ from the ${exp}px the rest share.`,
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
      // 2 boxes that overlap vertically but not horizontally are beside each other, not stacked.
      // Rows are grouped by a shared top, so a 2-up row whose columns are centred on each other
      // has 2 different tops and arrives here as 2 rows of 1 item. Comparing their edges reports
      // each column for not sharing the other's edge, off by exactly half the container: that is
      // the width of a column and never the width of a mistake.
      const beside = (a, b) => Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top) > TOL
        && (a.r.right <= b.r.left + TOL || b.r.right <= a.r.left + TOL);
      if (rows.length >= LIMITS.minEdgeRows && rows.every((r) => r.items.length === 1) && sameKids) {
        const items = rows.map((r) => r.items[0]);
        const sideBySide = items.some((a, i) => items.slice(i + 1).some((b) => beside(a, b)));
        if (!sideBySide && !centered(el, items) && items.every(startsItsOwnLine) && !isInlineRun(el, items)) {
          let top = Infinity, bottom = -Infinity;
          for (const x of items) { if (x.r.top < top) top = x.r.top; if (x.r.bottom > bottom) bottom = x.r.bottom; }
          for (const side of ["left", "right"]) {
            const vals = items.map((x) => visEdge(x.el, side));
            const { exp, off } = outliers(vals);
            if (!off.length || off.length === items.length) continue;
            for (const idx of off) {
              const o = items[idx], d = vals[idx] - exp;
              add({ type: "align", severity: severityFor(Math.abs(d)), el: o.el,
                title: `${side === "left" ? "Left" : "Right"} edge off by ${Math.abs(d)}px: ${label(o.el)}`,
                detail: `${side} edge sits at ${vals[idx]}px, its siblings in ${label(el)} sit at ${exp}px`,
                why: `A shared edge is what makes a stack read as one column. ${items.length - off.length} of its ${items.length} siblings line up at ${exp}px, and ${Math.abs(d)}px is too small to look intentional and too big to look clean.`,
                expected: `${side} edge at ${exp}px like its siblings`,
                guides: [edgeGuide(exp, top, bottom, `${exp}px`, false), edgeGuide(vals[idx], o.r.top, o.r.bottom, `${vals[idx]}px (${d > 0 ? "+" : ""}${d})`, true)] });
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
  // the section check already covers vertical spacing), and horizontal padding is only reported when the
  // element's own same-kind siblings disagree with it.
  const padOf = (el) => { const { cs } = get(el); return [px(cs.paddingLeft), px(cs.paddingRight)]; };
  // Padding pushes content off centre only on a box you can SEE. A transparent div with
  // padding-left: 22px and nothing on the right is indistinguishable from a 22px margin: there is
  // no edge on screen for the content to be off centre from, and the reader is being asked to fix
  // a symmetry nobody can perceive. This is what a grid framework's gutters look like from the
  // outside - a Shopify .grid__item carries the column gutter as padding-left with 0 on the right,
  // on every item of every grid - so on a real theme page this check fired 3 times and was wrong
  // 3 times. Both side edges have to be drawn: a background or a shadow, which fills the whole
  // box and shows both, or a border on both sides. A border on 1 side is a divider rule and the
  // padding beside it is the gap from the rule, which is the point of it.
  const opaque = (v) => { const m = /^rgba?\(([^)]+)\)$/.exec(v || ""); if (!m) return !!v && v !== "transparent"; const p = m[1].split(",").map(Number); return p.length < 4 || p[3] > 0.01; };
  const drawn = (v, w) => v && v !== "none" && px(w) > 0;
  const sidesDrawn = (el) => {
    const { cs } = get(el);
    if (opaque(cs.backgroundColor) || (cs.backgroundImage && cs.backgroundImage !== "none")) return true;
    if (cs.boxShadow && cs.boxShadow !== "none") return true;
    if (drawn(cs.outlineStyle, cs.outlineWidth)) return true;
    return drawn(cs.borderLeftStyle, cs.borderLeftWidth) && drawn(cs.borderRightStyle, cs.borderRightWidth);
  };
  for (const el of all) {
    if (el.tagName === "SECTION" || kidsOf(el).length === 0) continue;
    const { r } = get(el);
    if (r.width < LIMITS.minPadW || r.height < LIMITS.minPadH) continue;
    const [pl, pr] = padOf(el);
    if (same(pl, pr) || Math.max(pl, pr) === 0) continue;
    if (!sidesDrawn(el)) continue;

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
      why: `${peers.length ? `Its ${peers.length} same-kind sibling${peers.length === 1 ? "" : "s"} set the expectation and none of them pads like this` : "Nothing beside it repeats this padding"}, so the ${diff}px difference pushes the content off centre and reads as a mistake rather than a choice.`,
      expected: `equal left and right padding, or the same values its siblings use`,
      guides: [band(r.left, r.top, pl, r.height, `${pl}px`, pl > pr), band(r.right - pr, r.top, pr, r.height, `${pr}px`, pr > pl)] });
  }

  // 4: sections - top/bottom padding and content inset compared across the page's sections.
  // Named "Section" and not "Rhythm": rhythm is what the defect costs you, but the panel chip has
  // to say WHERE to look, and every other chip already does (Gap, Edge, Padding, Type).
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
          add({ type: "section", severity: severityFor(Math.abs(o[side] - exp)), el: o.el,
            title: `Section ${side === "pt" ? "top" : "bottom"} padding ${o[side]}px, others use ${exp}px`,
            detail: `${pads.length - off.length} of the ${pads.length} sections on this page use ${exp}px here, ${label(o.el)} uses ${o[side]}px`,
            why: `Sections set the spacing a reader learns to expect while scrolling. The seam between this one and the next is ${Math.abs(o[side] - exp)}px ${o[side] > exp ? "wider" : "tighter"} than every other seam on the page, so it reads as a break in the page rather than the next part of it.`,
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
            add({ type: "section", severity: severityFor(Math.abs(o.inset - exp)), el: o.first,
              title: `Content inset ${o.inset}px in ${label(o.el)}, other sections use ${exp}px`,
              detail: `the first block starts ${o.inset}px from the section's left edge`,
              why: `Every section starting its content the same distance from the edge is what gives a page one left margin. ${insets.length - off.length} of ${insets.length} start at ${exp}px, so the text steps in and out as you scroll and the eye has to re-find it here.`,
              expected: `${exp}px inset like the other sections`,
              guides: [edgeGuide(o.r.left + exp, fr.top, fr.bottom, `${exp}px`, false), edgeGuide(fr.left, fr.top, fr.bottom, `${o.inset}px`, true)] });
          }
        }
      }
    }

  // 5: type scale - the same tag rendering at more than 1 size.
  // A heading level is a size promise: <h2> twice on a page should be the same h2 both times.
  // Sizes are compared per tag and never between tags, because h2 being smaller than h1 is the
  // whole point of h2. Unlike every other check this one compares exactly rather than through
  // TOL: 2px of layout drift is invisible, but a font-size is a number somebody typed, and 22px
  // sitting among 24px is a second value for a level that is only allowed one.
  //
  // Grouped by tag AND first class, the same "is this the same kind of thing" test the padding
  // check uses. A real page puts <p> to more than 1 job: bunlongheng.com renders its hero line,
  // its subtitle and its meta strip all as <p>, at 48, 24 and 14px against 16px body copy. Judged
  // by tag alone that is 3 findings and all 3 are wrong. Judged by tag plus class each of those is
  // a group of 1 and says nothing, while 10 cards whose <p class="card-body"> disagree still do.
  //
  // Grouped by REGION as well, because "the other <p> on this page" is not 1 population. A footer's
  // address line and the body copy in <main> are both unclassed <p> and were never trying to match:
  // judged together, a 16px footer line is reported as 4px short of 20px body copy, and the number
  // it is told to use is one nobody typed and nobody should. Judged inside its own region it is a
  // group of 1 and says nothing, while the 23 paragraphs in <main> still hold each other to 20px.
  const LANDMARKS = new Set(["MAIN", "FOOTER", "HEADER", "NAV", "ASIDE", "FORM", "DIALOG"]);
  const LANDMARK_ROLE = /^(main|contentinfo|banner|navigation|complementary|form|dialog)$/;
  const regionOf = (el) => {
    for (let c = el.parentElement; c; c = c.parentElement) {
      if (LANDMARKS.has(c.tagName)) return c.tagName;
      const role = c.getAttribute && c.getAttribute("role");
      if (role && LANDMARK_ROLE.test(role)) return role;
    }
    return "";
  };
  const TYPE_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6", "P"]);
  const byTag = new Map();
  for (const el of all) {
    if (!TYPE_TAGS.has(el.tagName) || !el.textContent.trim()) continue;
    const { cs, r } = get(el);
    const key = `${el.tagName}|${el.classList[0] || ""}|${regionOf(el)}`;
    if (!byTag.has(key)) byTag.set(key, []);
    byTag.get(key).push({ el, r, size: px(cs.fontSize) });
  }
  // One vote per page strip, not per instance. A component rendered 6 times is 1 decision, not 6
  // votes: on kactusbio.com/pages/company 6 card titles at 50px outvoted 2 genuine section
  // headings and reported THEM as the deviants, which is the report telling you to break the page
  // to match a card. A strip is the band of page a sample lives in, the last ancestor before
  // <main> or <body>: a <section> on a semantic page, a theme's section div on a generated one.
  // Inside 1 strip the instances still answer to each other, because 6 cards whose titles
  // disagree is exactly the defect this check is for.
  const stripOf = (el) => {
    let last = el;
    for (let c = el.parentElement; c; c = c.parentElement) {
      if (c.tagName === "BODY" || LANDMARKS.has(c.tagName)) return last;
      last = c;
    }
    return last;
  };
  for (const [key, items] of byTag) {
    if (items.length < LIMITS.minTypeSamples) continue;
    const byStrip = new Map();
    for (const t of items) { const st = stripOf(t.el); if (!byStrip.has(st)) byStrip.set(st, []); byStrip.get(st).push(t); }
    const strips = [...byStrip.values()];
    // What 1 strip has to say: its only size when it holds 1 sample, the size its samples agree on
    // when it holds several, and nothing at all when they never agreed. A strip that disagrees with
    // itself holds 2 roles, not an opinion, and letting the median stand in for it invents a vote:
    // the homepage has a strip with a 45px heading and a 25px subheading, and that invented 45
    // outvoted the 56px statement heading the design actually uses.
    const vote = (g) => (g.length === 1 ? g[0].size : majority(g.map((t) => t.size)));
    const votes = strips.map(vote).filter((v) => v !== null);
    const across = votes.length >= LIMITS.minTypeSamples ? majority(votes) : null;
    for (const g of strips) g.exp = g.length >= LIMITS.minTypeSamples ? majority(g.map((t) => t.size)) : across;
    const off = [];
    for (const g of strips) for (const t of g) if (g.exp !== null && t.size !== g.exp) off.push({ t, exp: g.exp });
    if (!off.length) continue;
    const [tag, cls] = key.split("|");
    const name = `<${tag.toLowerCase()}>`;
    for (const { t, exp } of off) {
      const d = t.size - exp;
      const agree = items.filter((x) => x.size === exp).length;
      const ratio = Math.abs(d) / exp;
      if (ratio > LIMITS.typeMaxRatio) continue; // a different role, not a broken one
      add({ type: "type", severity: ratio >= LIMITS.typeHighRatio ? "high" : ratio >= LIMITS.typeMedRatio ? "medium" : "low", el: t.el,
        title: `${label(t.el)} is ${t.size}px, the other ${agree} matching ${name} are ${exp}px`,
        detail: `${t.size}px here against ${exp}px on ${agree} of the ${items.length} ${name}${cls ? ` with class "${cls}"` : " with no class"}, ${Math.abs(d)}px ${d > 0 ? "bigger" : "smaller"}`,
        why: tag === "P"
          ? `Body copy at 2 sizes reads as 2 kinds of text. This paragraph is ${Math.round(ratio * 100)}% off the ${exp}px its ${agree} matching siblings use, so it looks like a caption or a callout when nothing says it is one.`
          : `A heading level is a size promise: ${agree} of the ${items.length} matching ${name} keep it at ${exp}px. This one is ${Math.round(ratio * 100)}% off, close enough that it was meant to match and did not, so the level renders at 2 sizes.`,
        expected: `font-size: ${exp}px, like every other ${name}`,
        guides: [band(t.r.left, t.r.top, t.r.width, t.r.height, `${t.size}px (rest use ${exp})`, true)] });
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
      for (const i of issues) lines.push(`## ${i.n}. ${i.title} (${i.severity})`, `- Selector: \`${i.selector}\``, `- Found: ${i.detail}`, `- Why it matters: ${i.why}`, `- Expected: ${i.expected}`, ``);
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

    const TYPE_LABEL = { gaps: "Gap", align: "Edge", padding: "Padding", section: "Section", type: "Type" };
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
        <button class="snk-icon snk-copy" type="button" title="Copy the report for an agent" aria-label="Copy the report"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
        <button class="snk-icon snk-x" type="button" title="Close (Esc)" aria-label="Close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19"/></svg></button>
      </span>
      <div class="snk-tools">
        <span class="snk-count${issues.length ? "" : " snk-count-ok"}"></span>
        <button class="snk-switch snk-ruler" type="button" role="switch" aria-checked="false" title="Measure the layout: region, section, container and panel with sizes and side gaps"><span class="snk-switch-track" aria-hidden="true"><span class="snk-switch-knob"></span></span>Ruler</button>
      </div>
    </header>
      <div class="snk-views" role="group" aria-label="Page views">
      <button class="snk-chip snk-xray" type="button" title="Every box outlined, cyan where it sits shallow and violet where it nests deep" aria-pressed="false">X-ray</button>
      <button class="snk-chip snk-heat" type="button" title="Heat map: green is clear, yellow is an area with a finding, red is the gap to fix" aria-pressed="false">Heat</button>
      <button class="snk-chip snk-night" type="button" title="Night vision: the page through green phosphor, with every finding locked on and numbered" aria-pressed="false">Night</button>
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
      btn.innerHTML = `<span class="snk-n">${i.n}</span><span class="snk-tag">${TYPE_LABEL[i.type]}</span><span class="snk-title"></span><span class="snk-where"></span><span class="snk-detail"></span><span class="snk-why"></span>`;
      btn.querySelector(".snk-title").textContent = i.title;
      // The leaf is what identifies a finding; the ancestors are context you can hover for. Shown
      // whole, a 5-level selector wraps to 4 lines and buries the 2 words that tell 5 identical
      // "Uneven side padding on <div>" rows apart.
      const parts = i.selector.split(" > ");
      const where = btn.querySelector(".snk-where");
      where.textContent = parts.length > 2 ? `\u2026 ${parts.slice(-2).join(" > ")}` : i.selector;
      where.title = i.selector;
      btn.querySelector(".snk-detail").textContent = i.detail;
      btn.querySelector(".snk-why").textContent = i.why || "";
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
        Object.assign(tag.style, { left: `${r.left}px`, top: `${Math.max(0, r.top - 22)}px` });
        frag.appendChild(tag);
      }
    };
    // A badge is centred on the point it labels, so one sitting on the page's top or left edge
    // loses half of itself off the page, which is how a 0px value - the very case worth reading -
    // came out clipped. Nudge it back inside. Every badge is measured first and moved after, so
    // the pass costs 1 layout instead of 1 per badge, and it reads our own nodes, never the page.
    const clampBadges = () => {
      const badges = layer.querySelectorAll(".snk-badge");
      if (!badges.length) return;
      const w = layer.clientWidth, h = layer.clientHeight;
      const read = [...badges].map((el) => ({ el, hw: el.offsetWidth / 2, hh: el.offsetHeight / 2 }));
      for (const m of read) {
        const x = Math.min(Math.max(parseFloat(m.el.style.left), m.hw), Math.max(m.hw, w - m.hw));
        const y = Math.min(Math.max(parseFloat(m.el.style.top), m.hh), Math.max(m.hh, h - m.hh));
        m.el.style.left = `${x}px`;
        m.el.style.top = `${y}px`;
      }
    };
    // read nothing from the page here: rects were stored at analysis time, so this is writes only.
    // sizeLayer reads scrollWidth/scrollHeight, so it runs on mount and on resize, never per draw.
    const drawIssues = (items, activeIssue) => {
      const frag = document.createDocumentFragment();
      for (const i of items) {
        boxNode(i.r, i === activeIssue, frag, i.selector ? `${i.n} \u00b7 ${i.selector.split(" > ").pop()}` : `${i.n}`);
        const gs = items.length === 1 ? i.guides : i.guides.filter((g, idx) => g.bad || idx < LIMITS.guideCap);
        gs.forEach((g) => guideNodes(g, frag));
      }
      layer.appendChild(frag);
    };
    // Which findings the guide layer is showing. Every guide is drawn from the start, because
    // the panel already lists every finding and a button to say "yes, all of them" was answering
    // a question nobody had. Clicking a row narrows it to that one.
    let shown = issues.length ? { items: issues, active: null } : null;
    let rulerOn = false;
    let stale = false;
    const markCurrent = (i) => {
      list.querySelectorAll(".snk-item").forEach((b) => {
        const on = !!i && b.dataset.n === String(i.n);
        b.classList.toggle("snk-current", on);
        if (on) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
      });
    };
    // Clicking a row goes to that finding. It does not change the lens: whichever of Heat, Night
    // or X-ray you are reading the page through is the reason you are reading it, and dropping it
    // to jump to a row meant losing your view every time you followed one up.
    const activate = (i) => {
      spyN = i.n;             // the scroll this kicks off must not be read as the reader moving
      shown = { items: [i], active: i };
      render();
      markCurrent(i);
      i.el.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    };
    on(panel.querySelector(".snk-copy"), "click", async (ev) => {
      const btn = ev.currentTarget;
      if (!ev.isTrusted && !window.__snakeEyesTest) return; // only a real click may write the clipboard
      let state = "done";
      try { await navigator.clipboard.writeText(report()); } catch { state = "failed"; }
      btn.dataset.state = state;
      btn.title = state === "done" ? "Report copied" : "Copy failed";
      setTimeout(() => { delete btn.dataset.state; btn.title = "Copy the report for an agent"; }, LIMITS.copyResetMs);
    });
    on(panel.querySelector(".snk-rescan"), "click", () => { close(false); tellWorker("rescan"); });

    // Ruler: the layout with its numbers on. Boxes are coloured by the job they do rather than by
    // depth, each carries its own size, and layout containers show the gap to each side of the
    // page. Structure and dimensions, never a verdict.
    const ROLE = { region: "#e11d48", section: "#2563eb", container: "#16a34a", panel: "#ea580c" };
    const SHOW = { region: true, section: true, container: true, panel: true, sizes: true, gaps: true };
    const drawRuler = () => {
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
          tag.textContent = `${Math.round(r.width)} x ${Math.round(r.height)}px`;
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
            t.textContent = `${w}px`;
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
      return `Ruler: ${count} boxes, sizes in px. <b style="color:${ROLE.region}">Region</b> <b style="color:${ROLE.section}">Section</b> <b style="color:${ROLE.container}">Container</b> <b style="color:${ROLE.panel}">Panel</b>. Purple bands are the gap to each side. No judgement here, your findings are the list above.`;
    };
    for (const cb of panel.querySelectorAll(".snk-opts input")) {
      on(cb, "change", () => { SHOW[cb.dataset.k] = cb.checked; if (rulerOn) render(); });
    }
    // X-ray answers a different question from Ruler: not how big a box is, but how deeply it is
    // buried. Every element, outlined only, cyan shallow to violet deep. Never red or green,
    // which already mean wrong and right on every guide.
    const drawXray = () => {
      const frag = document.createDocumentFragment();
      const ground = document.createElement("div");
      ground.className = "snk-xrground";
      frag.appendChild(ground);
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
              // A radiograph has no hue. Depth is exposure instead: the deeper a box is
              // buried, the brighter it comes through, the way overlapping bone does.
              borderColor: `hsl(0 0% ${42 + Math.min(depth, 11) * 5}% / 0.75)`,
            });
            frag.appendChild(d);
          }
          walk(kid, depth + 1);
        }
      };
      walk(document.body, 0);
      const gaps = markFindings(frag);
      layer.appendChild(frag);
      return `X-ray: the page as a radiograph, no colour and no judgement. ${seen} boxes, the deeper one is buried the brighter it comes through, and the ${issues.length} finding${issues.length === 1 ? "" : "s"} ${issues.length === 1 ? "burns" : "burn"} bone white with ${gaps === 1 ? "its" : "their"} measurement.`;
    };

    // FLIR: the classic thermal ramp, black through violet and red to white, driven by how deeply
    // a box is buried. Filled, unlike X-ray, because a heat map without fill is just an outline.
    // Heat: a thermal map of the findings, read the way any heat map is read. Green is the whole
    // page by default, because most of a page has nothing wrong with it. Yellow is an area a
    // finding sits in. Red is the measurement inside it that is actually off, which is the thing
    // you go and change. The blobs are soft and the layer is blurred as a whole, so the 3 bleed
    // into a green-to-red ramp instead of reading as 3 stacked rectangles.
    // It used to shade every box by nesting depth, which is what X-ray already outlines, so the
    // view cost a button and a legend and told you nothing the view beside it did not.
    const drawHeat = () => {
      const frag = document.createDocumentFragment();
      for (const cls of ["snk-heatground", "snk-heatfield"]) {
        const d = document.createElement("div");
        d.className = cls;
        frag.appendChild(d);
      }
      // The blobs share one blurred parent, so they smear into each other rather than each
      // carrying its own blur and staying a separate smudge.
      const map = document.createElement("div");
      map.className = "snk-heatmap";
      const spot = (cls, r, grow) => {
        const d = document.createElement("div");
        d.className = `snk-heatbox ${cls}`;
        Object.assign(d.style, { left: `${r.left - grow}px`, top: `${r.top - grow}px`, width: `${Math.max(r.width, 2) + grow * 2}px`, height: `${Math.max(r.height, 2) + grow * 2}px` });
        map.appendChild(d);
      };
      // A guide is a line or a band, and a 4px seam painted at its true thickness is a hairline
      // nobody can see across a page, so a gap claims a fixed thickness across its short side.
      const T = LIMITS.heatMinSpot;
      const gapRect = (g) => {
        if (g.kind === "h") return { left: g.x1, top: g.y - T / 2, width: g.x2 - g.x1, height: T };
        if (g.kind === "band") return { left: g.x, top: g.y, width: g.w, height: g.h };
        return { left: g.x - T / 2, top: g.y1, width: T, height: g.y2 - g.y1 }; // v and edge
      };
      // 2 passes, because every red core must sit above every yellow area, not just its own.
      for (const i of issues) spot("snk-heat-area", i.r, LIMITS.heatAreaGrow);
      let gaps = 0;
      for (const i of issues) for (const g of i.guides) if (g.bad) { spot("snk-heat-gap", gapRect(g), LIMITS.heatGapGrow); gaps++; }
      frag.appendChild(map);
      // The blobs say which region is worst; the marks say which element and by how much. Without
      // them a heat map is a mood, and you still have to go and find the thing it is warm about.
      markFindings(frag);
      layer.appendChild(frag);
      return issues.length
        ? `Heat: green is clear, yellow is an area holding a finding, red is the measurement inside it that is off. ${issues.length} finding${issues.length === 1 ? "" : "s"}, ${gaps} red spot${gaps === 1 ? "" : "s"}.`
        : `Heat: green everywhere, because nothing on this page was found to be off.`;
    };

    // Night vision: the page itself through green phosphor, plus scanlines and a lit edge on
    // every box. The filter lives on the page, so it comes off with the mode and on close.
    // The marks that say "a finding is here": a light pool, a dashed crosshair through it, a
    // target box and the numbered tag, plus the guides the panel already draws carrying the
    // numbers. Every lens paints them; only the colour changes, and that comes from the class
    // render() puts on the layer. 1 pass, so a finding reads the same wherever you are looking.
    const markFindings = (frag) => {
      const put = (cls, r) => {
        const d = document.createElement("div");
        d.className = cls;
        Object.assign(d.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${Math.max(r.width, 2)}px`, height: `${Math.max(r.height, 2)}px` });
        frag.appendChild(d);
        return d;
      };
      let gaps = 0;
      for (const i of issues) {
        const g = LIMITS.markSpotGrow;
        put("snk-mspot", { left: i.r.left - g, top: i.r.top - g, width: i.r.width + g * 2, height: i.r.height + g * 2 });
        put("snk-mcross", i.r);
        put("snk-mtarget", i.r);
        const tag = document.createElement("div");
        tag.className = "snk-mtag";
        tag.textContent = `${i.n} \u00b7 ${TYPE_LABEL[i.type]}`;
        Object.assign(tag.style, { left: `${i.r.left}px`, top: `${i.r.top}px` });
        frag.appendChild(tag);
        for (const gd of i.guides) if (gd.bad) { guideNodes(gd, frag); gaps++; }
      }
      return gaps;
    };

    const drawNight = () => {
      const frag = document.createDocumentFragment();
      const scan = document.createElement("div");
      scan.className = "snk-scanlines";
      frag.appendChild(scan);
      // Nothing is outlined here but the findings. Lighting the page's own boxes, at any size
      // threshold, drew a grid over every logo strip and nav row on the page, and a box that is
      // not a finding is exactly the thing this view is trying not to draw your eye to. The
      // phosphor already shows the layout; the light is spent on what is wrong with it.
      const gaps = markFindings(frag);
      layer.appendChild(frag);
      return issues.length
        ? `Night vision: nothing lit but the findings. ${issues.length} under a spotlight and numbered to match the list, with the ${gaps === 1 ? "1 measurement that is" : `${gaps} measurements that are`} off picked out in white and labelled. The tint comes off with the mode.`
        : `Night vision: nothing lit, because nothing on this page was found to be off.`;
    };

    const LEGEND = "Click an issue to jump to it. Red = off, green = the value the siblings agree on.";
    // 3 views of the same page, so only 1 can be on at a time. Ruler is not one of them: it
    // measures the layout rather than recolouring it, which is a question you can ask of any
    // view, so it is a switch that lays over whichever mode is on, or over none.
    const VIEWS = ["xray", "heat", "night"];
    const DRAW = { xray: drawXray, heat: drawHeat, night: drawNight };
    let mode = "none";
    // One painter for the whole layer. Every control changes state and calls this, so a mode,
    // the Ruler switch and the guides of a selected finding compose instead of clearing
    // each other: each used to own clearGuides(), which is why they could never be combined.
    const render = () => {
      sizeLayer();
      clearGuides();
      document.documentElement.classList.toggle("snk-nv", mode === "night");
      document.documentElement.classList.toggle("snk-xr", mode === "xray");
      for (const m of VIEWS) layer.classList.toggle(`snk-m-${m}`, mode === m);
      const notes = [];
      if (mode !== "none") notes.push(DRAW[mode]());
      if (shown) drawIssues(shown.items, shown.active);
      if (rulerOn) notes.push(drawRuler());
      clampBadges();
      panel.querySelector(".snk-legend").innerHTML = notes.length ? notes.join(" ") : LEGEND;
    };
    const syncControls = () => {
      for (const name of VIEWS) {
        const btn = panel.querySelector(`.snk-${name}`);
        btn.classList.toggle("snk-on", mode === name);
        btn.setAttribute("aria-pressed", String(mode === name));
      }
      const sw = panel.querySelector(".snk-ruler");
      sw.setAttribute("aria-checked", String(rulerOn));
      panel.querySelector(".snk-opts").hidden = !rulerOn;
    };
    const setMode = (want) => {
      mode = want === mode ? "none" : want;
      // Changing the lens is a look at the whole page, so it unpins whatever row was pinned and
      // draws every finding again. The highlight is then handed back to the spy, which puts it on
      // whatever you are actually looking at rather than leaving it on the row you last clicked.
      shown = issues.length ? { items: issues, active: null } : null;
      syncControls();
      render();
      spyN = 0;
      spy();
    };
    const toggleRuler = () => { rulerOn = !rulerOn; syncControls(); render(); };
    for (const name of VIEWS) on(panel.querySelector(`.snk-${name}`), "click", () => setMode(name));
    on(panel.querySelector(".snk-ruler"), "click", toggleRuler);

    const returnFocusTo = document.activeElement;
    const close = (notify = true) => {
      ac.abort();
      root.remove();
      document.documentElement.classList.remove("snk-docked", "snk-nv", "snk-xr"); // page gets its width and its colours back
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

    // Scroll spy: the list follows the page, so the row on the right is always the finding you
    // are looking at. Without it a long page means scrolling to something you can see is wrong,
    // then hunting the panel for which of 40 rows describes it.
    // Rects were captured at scan time and are page coordinates, so this is arithmetic, not layout.
    const nearestIssue = () => {
      const mid = scrollY + innerHeight / 2;
      let best = null, bestD = Infinity;
      for (const i of issues) {
        const d = Math.abs(i.r.top + i.r.height / 2 - mid);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    };
    // Centre the row in its own list without letting scrollIntoView move the page underneath us,
    // which would be the panel scrolling the thing it is trying to follow.
    const revealRow = (n) => {
      const row = list.querySelector(`.snk-item[data-n="${n}"]`);
      if (!row) return;
      const lr = list.getBoundingClientRect(), rr = row.getBoundingClientRect();
      if (rr.top < lr.top || rr.bottom > lr.bottom) list.scrollTop += rr.top - lr.top - (lr.height - rr.height) / 2;
    };
    const inView = (i) => i.r.top + i.r.height > scrollY && i.r.top < scrollY + innerHeight;
    let spyFrame = 0, spyN = 0;
    const spy = () => {
      spyFrame = 0;
      if (stale) return;
      // A finding you clicked stays selected for as long as it is still on screen. Handing the
      // highlight to whatever is nearest the middle would take it off the row the page is drawing
      // the moment you clicked it, because a tall finding is rarely the one centred in the window.
      if (shown && shown.active && inView(shown.active)) return;
      // It has scrolled off, so the pin goes with it and the page draws every finding again.
      // 1 repaint when you leave, never a repaint per scroll step. Not gated on the lens: the
      // guides draw over whichever one is on, so a pin left set under a mode would freeze the
      // highlight on a row you scrolled past ages ago.
      if (shown && shown.active) { shown = { items: issues, active: null }; render(); }
      const i = nearestIssue();
      if (!i || i.n === spyN) return;
      spyN = i.n;
      markCurrent(i);
      revealRow(i.n);
    };
    window.addEventListener("scroll", (e) => {
      if (!real(e) || spyFrame) return;
      spyFrame = requestAnimationFrame(spy);
    }, { signal: ac.signal, passive: true });
    let resizeTimer = 0;
    on(window, "resize", (e) => {
      if (!real(e)) return;
      sizeLayer();
      clearGuides();
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        stale = true;   // the spy stops too: every rect it compares belongs to the old viewport
        panel.querySelector(".snk-stale").hidden = false;
        panel.querySelector(".snk-legend").hidden = true;
        // Re-scan is always available, since the state worth measuring is often behind a click.
        // Going stale only highlights it.
        panel.querySelector(".snk-rescan").classList.add("snk-urgent");
        panel.querySelector(".snk-count").hidden = true; // that tally described the old layout too
        // every measurement on screen belongs to the old viewport, so nothing here may be replayed.
        // Copy stays live on purpose: the report states the viewport it was measured at.
        list.querySelectorAll(".snk-item").forEach((b) => { b.disabled = true; });
      }, LIMITS.resizeDebounceMs);
    });

    document.documentElement.appendChild(root);
    render();
    spy();   // the reader may have opened this halfway down a long page
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
    // The rain is real text so it reads as data rather than as stripes, and the block is written
    // twice so translating it by exactly half its height loops with no seam.
    const rows = Array.from({ length: 14 }, () => Array.from({ length: 24 }, () => (Math.random() < 0.5 ? "0" : "1")).join(" ")).join("\n");
    const panes = [[6, 14], [72, 8], [2, 58], [78, 54]]
      .map(([x, y], i) => `<i class="snk-pane" style="left:${x}%;top:${y}%;animation-delay:${i * 0.6}s"></i>`).join("");
    box.innerHTML = `<div class="snk-scene">
        <div class="snk-rain" aria-hidden="true">${rows}\n${rows}</div>
        ${panes}
        <div class="snk-floor"></div>
        <div class="snk-snake"><div class="snk-art"></div><div class="snk-beam"></div></div>
      </div>
      <div class="snk-bar"><i></i></div>
      <span class="snk-splash-text">Scanning</span>`;
    shadow.appendChild(box);
    document.documentElement.appendChild(root);
    return { root, shadow };
  }

  // ---------- the run ----------
  // Dock first, then measure. Shrinking the page after the scan would leave every rect describing
  // a layout the panel is now covering.
  // Docking narrows the page, which can cross a responsive breakpoint and change the very layout
  // being audited. Only wide windows have room to give up a strip and still be the same design.
  // __snakeEyesNoDock is how the crawler opts out. Docking narrows the page to 80% so the panel
  // does not cover it, which is right when a human is reading the panel and wrong when nobody is:
  // a site report must describe the layout visitors actually get, not one squeezed by a panel.
  const canDock = innerWidth >= LIMITS.dockMinWidth && !window.__snakeEyesNoDock;
  if (canDock) document.documentElement.classList.add("snk-docked");
  const splash = showSnake();
  // a second click, or Escape, must cancel a scan in flight, so the handle exists from frame 1
  const splashAc = new AbortController();
  const undock = () => document.documentElement.classList.remove("snk-docked");
  const cancel = () => { splashAc.abort(); splash.root.remove(); undock(); delete window.__snakeEyes; tellWorker("closed"); };
  window.__snakeEyes = { ready: false, close: cancel };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && (e.isTrusted || window.__snakeEyesTest)) cancel(); }, { signal: splashAc.signal });

  // A fixed 60ms under test, not a fraction of splashMs: the tests inject dozens of times and
  // have no interest in watching the animation, so tying them to it put 29s on the suite the day
  // the hold became a full 5s loop.
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = window.__snakeEyesTest ? 60 : reduced ? LIMITS.splashReducedMs : LIMITS.splashMs;
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
