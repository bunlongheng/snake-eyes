// Snake Eyes: spacing audit overlay.
// Injected on demand by background.js. Runs once, draws guides + a panel, and removes
// itself when injected again (toggle). Everything lives under #snake-eyes-root so the page
// is never modified; window.__snakeEyes exposes the issues and the report for tests.
(() => {
  const ROOT_ID = "snake-eyes-root";
  const existing = document.getElementById(ROOT_ID);
  if (existing) {
    existing.remove();
    delete window.__snakeEyes;
    return;
  }

  const TOL = 2; // px: anything inside this is treated as equal
  const MAX_ISSUES = 150;
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT", "TEMPLATE", "BR", "HR", "SVG", "PATH", "CANVAS", "IFRAME", "OPTION"]);

  // ---------- helpers ----------
  const px = (v) => Math.round(parseFloat(v) || 0);
  const same = (a, b) => Math.abs(a - b) <= TOL;
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top + scrollY, left: r.left + scrollX, right: r.right + scrollX, bottom: r.bottom + scrollY, width: r.width, height: r.height };
  };
  const isVisible = (el) => {
    if (!(el instanceof Element) || SKIP_TAGS.has(el.tagName.toUpperCase()) || el.namespaceURI !== "http://www.w3.org/1999/xhtml" || el.closest(`#${ROOT_ID}`)) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const inFlow = (el) => {
    const cs = getComputedStyle(el);
    return cs.position !== "absolute" && cs.position !== "fixed" && cs.display !== "contents";
  };
  const kidsOf = (el) => [...el.children].filter((c) => isVisible(c) && inFlow(c));
  const mode = (nums) => {
    const counts = new Map();
    for (const n of nums) counts.set(n, (counts.get(n) || 0) + 1);
    let best = nums[0], bestN = 0;
    for (const [n, c] of counts) if (c > bestN) { best = n; bestN = c; }
    if (bestN === 1) { const s = [...nums].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }
    return best;
  };
  const selector = (el) => {
    const parts = [];
    let e = el, depth = 0;
    while (e && e.nodeType === 1 && e !== document.body && depth < 7) {
      let s = e.tagName.toLowerCase();
      if (e.id && !/\d{3,}/.test(e.id)) { parts.unshift(`${s}#${CSS.escape(e.id)}`); break; }
      const p = e.parentElement;
      if (p) {
        const sib = [...p.children].filter((c) => c.tagName === e.tagName);
        if (sib.length > 1) s += `:nth-of-type(${sib.indexOf(e) + 1})`;
      }
      if (depth === 0) {
        const cls = [...e.classList].filter((c) => /^[a-z][\w-]*$/i.test(c)).slice(0, 2);
        if (cls.length) s += "." + cls.join(".");
      }
      parts.unshift(s);
      e = p; depth++;
    }
    return parts.join(" > ");
  };
  const label = (el) => {
    const t = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 28);
    return `<${el.tagName.toLowerCase()}>${t ? ` "${t}${t.length === 28 ? "..." : ""}"` : ""}`;
  };
  // siblings are comparable when they are the same kind of thing: same tag, or same first class
  const sameKind = (items) => {
    const tags = new Set(items.map((x) => x.tagName));
    if (tags.size === 1) return true;
    const cls = new Set(items.map((x) => x.classList[0] || ""));
    return cls.size === 1 && !cls.has("");
  };
  // a centered layout: every child's center sits on the parent's center
  const centered = (el, items) => {
    const c = rectOf(el); const mid = c.left + c.width / 2;
    const cs = getComputedStyle(el);
    if (cs.textAlign === "center" || cs.alignItems === "center" || cs.justifyContent === "center") return true;
    // stretched blocks (as wide as the parent's content box) are aligned, not centered
    const inner = c.width - px(cs.paddingLeft) - px(cs.paddingRight);
    const stretched = items.filter((x) => x.r.width >= inner - TOL * 2).length;
    if (stretched >= items.length / 2) return false;
    return items.every((x) => Math.abs(x.r.left + x.r.width / 2 - mid) <= TOL + 1);
  };
  const groupRows = (kids) => {
    const rows = [];
    for (const k of kids) {
      const r = rectOf(k);
      const row = rows.find((row) => same(row.top, r.top));
      if (row) row.items.push({ el: k, r }); else rows.push({ top: r.top, items: [{ el: k, r }] });
    }
    return rows.map((row) => ({ ...row, items: row.items.sort((a, b) => a.r.left - b.r.left) }));
  };

  // ---------- analysis ----------
  const issues = [];
  const add = (issue) => { if (issues.length < MAX_ISSUES) issues.push(issue); };
  const severityFor = (diff) => (diff >= 8 ? "high" : diff >= 3 ? "medium" : "low");

  const all = [...document.body.querySelectorAll("*")].filter(isVisible);

  // 1 + 2: gaps between siblings, and left/right edge alignment of stacked siblings
  for (const el of all) {
    const kids = kidsOf(el);
    if (kids.length < 2) continue;
    const rows = groupRows(kids);
    const guides = [];

    // horizontal gaps inside each row
    for (const row of rows) {
      if (row.items.length < 3 || !sameKind(row.items.map((x) => x.el))) continue;
      const gaps = [];
      for (let i = 1; i < row.items.length; i++) {
        const a = row.items[i - 1].r, b = row.items[i].r;
        gaps.push({ v: Math.round(b.left - a.right), x1: a.right, x2: b.left, y: (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2 });
      }
      const vals = gaps.map((g) => g.v);
      if (vals.some((v) => v < 0)) continue;
      const exp = mode(vals);
      const diff = Math.max(...vals) - Math.min(...vals);
      if (diff > TOL) {
        const g2 = gaps.map((g) => ({ kind: "h", x1: g.x1, x2: g.x2, y: g.y, text: `${g.v}px`, bad: !same(g.v, exp) }));
        add({ type: "gaps", severity: severityFor(diff), el, title: `Uneven horizontal gaps in ${label(el)}`,
          detail: `${row.items.length} items in a row, gaps ${vals.join(", ")}px (most are ${exp}px)`,
          expected: `${exp}px between every item`, guides: g2 });
      }
    }

    // vertical gaps between rows (stacked blocks or grid rows)
    if (rows.length >= 3 && sameKind(kids)) {
      const gaps = [];
      for (let i = 1; i < rows.length; i++) {
        const prev = rows[i - 1], cur = rows[i];
        const prevBottom = Math.max(...prev.items.map((x) => x.r.bottom));
        const curTop = Math.min(...cur.items.map((x) => x.r.top));
        const left = Math.min(...cur.items.map((x) => x.r.left));
        const right = Math.max(...cur.items.map((x) => x.r.right));
        gaps.push({ v: Math.round(curTop - prevBottom), y1: prevBottom, y2: curTop, x: (left + right) / 2 });
      }
      const vals = gaps.map((g) => g.v);
      if (!vals.some((v) => v < 0)) {
        const exp = mode(vals);
        const diff = Math.max(...vals) - Math.min(...vals);
        if (diff > TOL) {
          add({ type: "gaps", severity: severityFor(diff), el, title: `Uneven vertical gaps in ${label(el)}`,
            detail: `${rows.length} stacked blocks, gaps ${vals.join(", ")}px (most are ${exp}px)`,
            expected: `${exp}px between every block`,
            guides: gaps.map((g) => ({ kind: "v", y1: g.y1, y2: g.y2, x: g.x, text: `${g.v}px`, bad: !same(g.v, exp) })) });
        }
      }
    }

    // left and right edge alignment of stacked siblings (1 per row)
    if (rows.length >= 2 && rows.every((r) => r.items.length === 1) && sameKind(kids) && !centered(el, rows.map((r) => r.items[0]))) {
      const items = rows.map((r) => r.items[0]);
      for (const side of ["left", "right"]) {
        const vals = items.map((x) => Math.round(x.r[side]));
        const exp = mode(vals);
        const off = items.filter((x, i) => !same(vals[i], exp));
        if (off.length && off.length < items.length) {
          for (const o of off) {
            const d = Math.round(o.r[side] - exp);
            const top = Math.min(...items.map((x) => x.r.top)), bottom = Math.max(...items.map((x) => x.r.bottom));
            add({ type: "align", severity: severityFor(Math.abs(d)), el: o.el,
              title: `${side === "left" ? "Left" : "Right"} edge off by ${Math.abs(d)}px: ${label(o.el)}`,
              detail: `${side} edge sits at ${Math.round(o.r[side])}px, its siblings in ${label(el)} sit at ${exp}px`,
              expected: `${side} edge at ${exp}px like its siblings`,
              guides: [
                { kind: "edge", x: exp, y1: top, y2: bottom, text: `${exp}px`, bad: false },
                { kind: "edge", x: o.r[side], y1: o.r.top, y2: o.r.bottom, text: `${Math.round(o.r[side])}px (${d > 0 ? "+" : ""}${d})`, bad: true },
              ] });
          }
        }
      }
    }
    void guides;
  }

  // 3: asymmetric padding on containers
  for (const el of all) {
    if (el.tagName === "SECTION" || kidsOf(el).length === 0) continue; // sections belong to the rhythm check
    const cs = getComputedStyle(el);
    const r = rectOf(el);
    if (r.width < 160 || r.height < 40) continue;
    const pl = px(cs.paddingLeft), pr = px(cs.paddingRight), pt = px(cs.paddingTop), pb = px(cs.paddingBottom);
    const guides = [], bits = [];
    if (!same(pl, pr) && Math.max(pl, pr) > 0) {
      bits.push(`left ${pl}px vs right ${pr}px`);
      guides.push({ kind: "h", x1: r.left, x2: r.left + pl, y: r.top + r.height / 2, text: `${pl}px`, bad: pl !== Math.min(pl, pr) || true });
      guides.push({ kind: "h", x1: r.right - pr, x2: r.right, y: r.top + r.height / 2, text: `${pr}px`, bad: true });
    }
    if (!same(pt, pb) && Math.max(pt, pb) > 0 && r.height >= 80) {
      bits.push(`top ${pt}px vs bottom ${pb}px`);
      guides.push({ kind: "v", y1: r.top, y2: r.top + pt, x: r.left + r.width / 2, text: `${pt}px`, bad: true });
      guides.push({ kind: "v", y1: r.bottom - pb, y2: r.bottom, x: r.left + r.width / 2, text: `${pb}px`, bad: true });
    }
    if (bits.length) {
      const diff = Math.max(Math.abs(pl - pr), Math.abs(pt - pb));
      add({ type: "padding", severity: diff >= 8 ? "medium" : "low", el, title: `Asymmetric padding on ${label(el)}`,
        detail: bits.join("; "), expected: "equal padding on opposite sides unless the asymmetry is deliberate", guides });
    }
  }

  // 4: section rhythm - top/bottom padding and content inset across page sections
  const sections = all.filter((el) => el.tagName === "SECTION" && rectOf(el).width >= innerWidth * 0.6 && rectOf(el).height >= 120);
  if (sections.length >= 2) {
    const pads = sections.map((s) => {
      const cs = getComputedStyle(s);
      return { el: s, r: rectOf(s), pt: px(cs.paddingTop), pb: px(cs.paddingBottom) };
    });
    for (const side of ["pt", "pb"]) {
      const vals = pads.map((p) => p[side]);
      const exp = mode(vals);
      const off = pads.filter((p) => !same(p[side], exp));
      if (off.length && off.length < pads.length) {
        for (const o of off) {
          add({ type: "rhythm", severity: severityFor(Math.abs(o[side] - exp)), el: o.el,
            title: `Section ${side === "pt" ? "top" : "bottom"} padding ${o[side]}px, others use ${exp}px`,
            detail: `${label(o.el)} breaks the vertical rhythm shared by ${pads.length - off.length} other sections`,
            expected: `${side === "pt" ? "padding-top" : "padding-bottom"}: ${exp}px`,
            guides: [{ kind: "v", y1: side === "pt" ? o.r.top : o.r.bottom - o[side], y2: side === "pt" ? o.r.top + o[side] : o.r.bottom, x: o.r.left + o.r.width / 2, text: `${o[side]}px (expected ${exp})`, bad: true }] });
        }
      }
    }
    // where content really starts: walk down the first visible child until the left edge moves inward
    const contentStart = (section) => {
      let cur = section, left = rectOf(section).left, found = null;
      for (let depth = 0; depth < 8; depth++) {
        const kid = kidsOf(cur)[0];
        if (!kid) break;
        const kl = rectOf(kid).left;
        if (kl - left > TOL) { found = kid; break; }
        cur = kid;
      }
      return found;
    };
    const insets = pads.map((p) => {
      const first = contentStart(p.el);
      return first ? { ...p, inset: Math.round(rectOf(first).left - p.r.left), first } : null;
    }).filter(Boolean);
    if (insets.length >= 2) {
      const vals = insets.map((i) => i.inset);
      const exp = mode(vals);
      const off = insets.filter((i) => !same(i.inset, exp));
      if (off.length && off.length < insets.length) {
        for (const o of off) {
          const fr = rectOf(o.first);
          add({ type: "rhythm", severity: severityFor(Math.abs(o.inset - exp)), el: o.first,
            title: `Content inset ${o.inset}px in ${label(o.el)}, other sections use ${exp}px`,
            detail: `the first block starts ${o.inset}px from the section's left edge`,
            expected: `${exp}px inset like the other sections`,
            guides: [
              { kind: "edge", x: o.r.left + exp, y1: fr.top, y2: fr.bottom, text: `${exp}px`, bad: false },
              { kind: "edge", x: fr.left, y1: fr.top, y2: fr.bottom, text: `${o.inset}px`, bad: true },
            ] });
        }
      }
    }
  }

  const order = { high: 0, medium: 1, low: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  issues.forEach((i, n) => { i.n = n + 1; i.selector = selector(i.el); });

  // ---------- report ----------
  const report = () => {
    const counts = { high: 0, medium: 0, low: 0 };
    issues.forEach((i) => counts[i.severity]++);
    const lines = [
      `# Snake Eyes spacing report`,
      ``,
      `- Page: ${location.href}`,
      `- Viewport: ${innerWidth}x${innerHeight}`,
      `- Date: ${new Date().toISOString().slice(0, 10)}`,
      `- Issues: ${issues.length} (${counts.high} high, ${counts.medium} medium, ${counts.low} low)`,
      ``,
      `Fix each item below in the source, then re-run Snake Eyes to confirm 0 issues. Selectors are relative to <body>.`,
      ``,
    ];
    for (const i of issues) {
      lines.push(`## ${i.n}. ${i.title} (${i.severity})`, `- Selector: \`${i.selector}\``, `- Found: ${i.detail}`, `- Expected: ${i.expected}`, ``);
    }
    if (!issues.length) lines.push(`No spacing issues found at this viewport.`);
    return lines.join("\n");
  };

  // ---------- UI ----------
  const root = document.createElement("div");
  root.id = ROOT_ID;
  document.documentElement.appendChild(root);
  const shadow = root.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = window.__SNAKE_EYES_CSS__ || "";
  shadow.appendChild(style);

  const layer = document.createElement("div");
  layer.className = "snk-layer";
  const sizeLayer = () => { layer.style.width = `${document.documentElement.scrollWidth}px`; layer.style.height = `${document.documentElement.scrollHeight}px`; };
  sizeLayer();
  shadow.appendChild(layer);

  const panel = document.createElement("aside");
  panel.className = "snk-panel";
  panel.innerHTML = `
    <header class="snk-head">
      <span class="snk-logo" aria-hidden="true"><i></i><i></i></span>
      <b>Snake Eyes</b>
      <span class="snk-count">${issues.length} issue${issues.length === 1 ? "" : "s"}</span>
      <button class="snk-btn snk-all" title="Draw every guide at once">Show all</button>
      <button class="snk-btn snk-copy" title="Copy the report for an agent">Copy report</button>
      <button class="snk-x" title="Close (or click the icon again)" aria-label="Close">x</button>
    </header>
    <ol class="snk-list"></ol>
    <footer class="snk-foot">Click an issue to jump to it. Red = off, green = the value the siblings agree on.</footer>`;
  shadow.appendChild(panel);
  const list = panel.querySelector(".snk-list");
  const TYPE_LABEL = { gaps: "Gap", align: "Edge", padding: "Padding", rhythm: "Rhythm" };
  for (const i of issues) {
    const li = document.createElement("li");
    li.className = `snk-item snk-${i.severity}`;
    li.dataset.n = i.n;
    li.innerHTML = `<span class="snk-n">${i.n}</span><span class="snk-tag">${TYPE_LABEL[i.type]}</span><span class="snk-title"></span><span class="snk-detail"></span>`;
    li.querySelector(".snk-title").textContent = i.title;
    li.querySelector(".snk-detail").textContent = i.detail;
    li.addEventListener("click", () => activate(i));
    list.appendChild(li);
  }
  if (!issues.length) list.innerHTML = `<li class="snk-empty">No spacing issues at this viewport. Resize and click the icon again to test another width.</li>`;

  const clearGuides = () => { layer.innerHTML = ""; };
  const drawGuide = (g) => {
    const mk = (cls, css) => { const d = document.createElement("div"); d.className = cls; Object.assign(d.style, css); layer.appendChild(d); return d; };
    const tone = g.bad ? "snk-bad" : "snk-ok";
    if (g.kind === "h") {
      mk(`snk-line snk-hline ${tone}`, { left: `${g.x1}px`, top: `${g.y}px`, width: `${Math.max(1, g.x2 - g.x1)}px` });
      mk(`snk-badge ${tone}`, { left: `${(g.x1 + g.x2) / 2}px`, top: `${g.y}px` }).textContent = g.text;
    } else if (g.kind === "v") {
      mk(`snk-line snk-vline ${tone}`, { left: `${g.x}px`, top: `${g.y1}px`, height: `${Math.max(1, g.y2 - g.y1)}px` });
      mk(`snk-badge ${tone}`, { left: `${g.x}px`, top: `${(g.y1 + g.y2) / 2}px` }).textContent = g.text;
    } else if (g.kind === "edge") {
      mk(`snk-line snk-vline snk-edge ${tone}`, { left: `${g.x}px`, top: `${g.y1 - 12}px`, height: `${g.y2 - g.y1 + 24}px` });
      mk(`snk-badge ${tone}`, { left: `${g.x}px`, top: `${g.y1 - 12}px` }).textContent = g.text;
    }
  };
  const highlight = (el, active) => {
    const r = rectOf(el);
    const d = document.createElement("div");
    d.className = `snk-box${active ? " snk-active" : ""}`;
    Object.assign(d.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    layer.appendChild(d);
  };
  const activate = (i) => {
    clearGuides();
    sizeLayer();
    highlight(i.el, true);
    i.guides.forEach(drawGuide);
    list.querySelectorAll(".snk-item").forEach((li) => li.classList.toggle("snk-current", li.dataset.n === String(i.n)));
    i.el.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  panel.querySelector(".snk-all").addEventListener("click", () => {
    clearGuides(); sizeLayer();
    issues.forEach((i) => { highlight(i.el, false); i.guides.forEach(drawGuide); });
    list.querySelectorAll(".snk-item").forEach((li) => li.classList.remove("snk-current"));
  });
  panel.querySelector(".snk-copy").addEventListener("click", async (ev) => {
    const btn = ev.currentTarget;
    try { await navigator.clipboard.writeText(report()); btn.textContent = "Copied"; }
    catch { btn.textContent = "Copy failed"; }
    setTimeout(() => { btn.textContent = "Copy report"; }, 1600);
  });
  panel.querySelector(".snk-x").addEventListener("click", () => { root.remove(); delete window.__snakeEyes; });
  addEventListener("resize", clearGuides);

  if (issues.length) activate(issues[0]);
  window.__snakeEyes = { issues: issues.map(({ el, guides, ...rest }) => ({ ...rest, guides: guides.length })), report };
})();
