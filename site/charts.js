/* Small dependency-free SVG charts: line (with band, dots, reference lines), stacked bars, sparkline. */
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const PAD = { l: 40, r: 10, t: 10, b: 24 };
  const tooltip = () => document.getElementById("tooltip");

  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  const cssVar = (name) => getComputedStyle(document.querySelector(".viz-root")).getPropertyValue(name).trim();
  const color = (c) => (c && c.startsWith("--") ? cssVar(c) : c);
  const fmtDate = (d) => (d && d.length >= 10 ? `${+d.slice(8, 10)}/${+d.slice(5, 7)}` : d);
  const fmtDateLong = (d) => {
    if (!d || d.length < 10) return d;
    const days = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
    const dt = new Date(d + "T12:00:00");
    return `יום ${days[dt.getDay()]} ${fmtDate(d)}/${d.slice(2, 4)}`;
  };
  const defFmt = (v) => (v == null ? "–" : Math.abs(v) >= 100 ? Math.round(v).toLocaleString("he-IL") : (+v.toFixed(1)).toString());

  function niceTicks(min, max, count) {
    if (min === max) { min -= 1; max += 1; }
    const span = max - min, step0 = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || 10 * mag;
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
    return ticks;
  }

  function setup(container, opts) {
    container.innerHTML = "";
    const legendItems = (opts.series || []).filter((s) => !s.noLegend).map((s) => ({ name: s.name, color: s.color, kind: s.dash ? "dash" : s.dotsOnly ? "dot" : "" }));
    if (opts.band && opts.band.name) legendItems.unshift({ name: opts.band.name, color: opts.band.color, kind: "area" });
    if (legendItems.length >= 2 || opts.band) {
      const lg = document.createElement("div");
      lg.className = "legend";
      lg.innerHTML = legendItems.map((it) => `<span><i class="${it.kind}" style="background:${color(it.color)};color:${color(it.color)}"></i>${it.name}</span>`).join("");
      container.appendChild(lg);
    }
    const W = Math.max(200, container.clientWidth);
    const H = Math.max(120, container.clientHeight - (container.querySelector(".legend")?.offsetHeight || 0) - 4);
    const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}` }, container);
    return { svg, W, H, iw: W - PAD.l - PAD.r, ih: H - PAD.t - PAD.b };
  }

  function empty(container, msg) {
    container.innerHTML = `<div class="empty">${msg || "אין נתונים בטווח הזה"}</div>`;
  }

  function axes(g, ctx, x, yTicks, yScale, yFmt, xLabelEvery) {
    const grid = cssVar("--grid"), muted = cssVar("--text-muted");
    yTicks.forEach((t) => {
      const y = yScale(t);
      el("line", { x1: PAD.l, x2: PAD.l + ctx.iw, y1: y, y2: y, stroke: grid, "stroke-width": 1 }, g);
      const tx = el("text", { x: PAD.l - 6, y: y + 4, "text-anchor": "end", "font-size": 11, fill: muted }, g);
      tx.textContent = yFmt(t);
    });
    const n = x.length, step = ctx.iw / n;
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(ctx.iw / 70))));
    for (let i = 0; i < n; i += every) {
      const tx = el("text", { x: PAD.l + step * (i + 0.5), y: ctx.H - 6, "text-anchor": "middle", "font-size": 11, fill: muted }, g);
      tx.textContent = xLabelEvery ? xLabelEvery(x[i]) : fmtDate(x[i]);
    }
  }

  function hover(ctx, x, rows, xFmt, onIndex) {
    const tip = tooltip();
    const n = x.length, step = ctx.iw / n;
    const cross = el("line", { y1: PAD.t, y2: PAD.t + ctx.ih, stroke: cssVar("--text-muted"), "stroke-width": 1, "stroke-dasharray": "3 3", opacity: 0 }, ctx.svg);
    const hit = el("rect", { x: PAD.l, y: 0, width: ctx.iw, height: ctx.H, fill: "transparent" }, ctx.svg);
    const move = (evt) => {
      const r = ctx.svg.getBoundingClientRect();
      const px = (evt.touches ? evt.touches[0].clientX : evt.clientX) - r.left;
      const i = Math.min(n - 1, Math.max(0, Math.floor((px - PAD.l) / step)));
      const lines = rows(i).filter((row) => row.value != null);
      if (!lines.length) { tip.classList.remove("on"); cross.setAttribute("opacity", 0); return; }
      const cx = PAD.l + step * (i + 0.5);
      cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("opacity", 1);
      tip.innerHTML = `<div class="t-date">${(xFmt || fmtDateLong)(x[i])}</div>` +
        lines.map((row) => `<div class="t-row"><span>${row.color ? `<i style="background:${color(row.color)}"></i>` : ""}${row.name}</span><b>${row.value}</b></div>`).join("");
      tip.classList.add("on");
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let left = r.left + cx + 14;
      if (left + tw > window.innerWidth - 8) left = r.left + cx - tw - 14;
      tip.style.left = left + "px";
      tip.style.top = Math.max(8, r.top + PAD.t + 4 - (th > ctx.H ? th - ctx.H : 0)) + "px";
      if (onIndex) onIndex(i);
    };
    const leave = () => { tip.classList.remove("on"); cross.setAttribute("opacity", 0); };
    hit.addEventListener("mousemove", move);
    hit.addEventListener("touchstart", move, { passive: true });
    hit.addEventListener("touchmove", move, { passive: true });
    hit.addEventListener("mouseleave", leave);
    hit.addEventListener("touchend", () => setTimeout(leave, 1500));
  }

  /* opts: {x, series:[{name, values, color, dash, dotsOnly, dots, width, fmt}], band:{low, high, color, name}, yFmt, yMin, yMax, refs:[{y,label}], xFmt, tickFmt} */
  function line(container, opts) {
    const x = opts.x || [];
    const all = [];
    opts.series.forEach((s) => s.values.forEach((v) => v != null && all.push(v)));
    if (opts.band) [opts.band.low, opts.band.high].forEach((a) => a.forEach((v) => v != null && all.push(v)));
    (opts.refs || []).forEach((r) => all.push(r.y));
    if (!x.length || !opts.series.some((s) => s.values.some((v) => v != null))) return empty(container);
    const ctx = setup(container, opts);
    let lo = opts.yMin != null ? opts.yMin : Math.min(...all), hi = opts.yMax != null ? opts.yMax : Math.max(...all);
    const pad = (hi - lo) * 0.08 || 1;
    if (opts.yMin == null) lo -= pad;
    if (opts.yMax == null) hi += pad;
    let ticks;
    if (opts.tickStep) { ticks = []; for (let t = Math.ceil(lo / opts.tickStep) * opts.tickStep; t <= hi; t += opts.tickStep) ticks.push(t); }
    else ticks = niceTicks(lo, hi, 4).filter((t) => t >= lo - 1e-9 && t <= hi + 1e-9);
    const y = (v) => PAD.t + ctx.ih - ((v - lo) / (hi - lo)) * ctx.ih;
    const step = ctx.iw / x.length, xs = (i) => PAD.l + step * (i + 0.5);
    const yFmt = opts.tickFmt || opts.yFmt || defFmt;
    axes(el("g", {}, ctx.svg), ctx, x, ticks, y, yFmt, opts.xLabel);

    if (opts.band) {
      const b = opts.band, c = color(b.color);
      let d = "", seg = [];
      const flush = () => {
        if (seg.length > 1) {
          d += "M" + seg.map((i) => `${xs(i)},${y(b.high[i])}`).join("L") + "L" + seg.slice().reverse().map((i) => `${xs(i)},${y(b.low[i])}`).join("L") + "Z";
        }
        seg = [];
      };
      x.forEach((_, i) => (b.low[i] != null && b.high[i] != null ? seg.push(i) : flush()));
      flush();
      el("path", { d, fill: c, opacity: 0.14 }, ctx.svg);
    }
    (opts.refs || []).forEach((r) => {
      el("line", { x1: PAD.l, x2: PAD.l + ctx.iw, y1: y(r.y), y2: y(r.y), stroke: cssVar("--text-muted"), "stroke-dasharray": "4 4", "stroke-width": 1 }, ctx.svg);
      if (r.label) {
        const t = el("text", { x: PAD.l + ctx.iw - 4, y: y(r.y) - 5, "text-anchor": "end", "font-size": 11, fill: cssVar("--text-muted"), stroke: cssVar("--surface-1"), "stroke-width": 3, "paint-order": "stroke" }, ctx.svg);
        t.textContent = r.label;
      }
    });
    const surface = cssVar("--surface-1");
    opts.series.forEach((s) => {
      const c = color(s.color);
      if (!s.dotsOnly) {
        let d = "", pen = false;
        s.values.forEach((v, i) => {
          if (v == null) { if (!s.connect) pen = false; return; }
          d += (pen ? "L" : "M") + xs(i) + "," + y(v);
          pen = true;
        });
        el("path", { d, fill: "none", stroke: c, "stroke-width": s.width || 2, "stroke-linejoin": "round", "stroke-linecap": "round", "stroke-dasharray": s.dash ? "5 4" : "none" }, ctx.svg);
      }
      if (s.dotsOnly || s.dots) {
        const r = s.r || (step > 6 ? 3.5 : 2.5);
        s.values.forEach((v, i) => v != null && el("circle", { cx: xs(i), cy: y(v), r, fill: c, stroke: surface, "stroke-width": 1.5, opacity: s.dotOpacity || 1 }, ctx.svg));
      }
    });
    // last-value label for the first series
    const main = opts.series[0];
    const li = main.values.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0).pop();
    if (li != null && !opts.noEndLabel) {
      el("circle", { cx: xs(li), cy: y(main.values[li]), r: 4, fill: color(main.color), stroke: surface, "stroke-width": 2 }, ctx.svg);
    }
    hover(ctx, x, (i) => {
      const rows = opts.series.map((s) => ({ name: s.name, color: s.color, value: s.values[i] == null ? null : (s.fmt || opts.yFmt || defFmt)(s.values[i]) }));
      if (opts.band && opts.band.low[i] != null) rows.push({ name: opts.band.name || "טווח", value: `${defFmt(opts.band.low[i])}–${defFmt(opts.band.high[i])}` });
      return rows;
    }, opts.xFmt);
  }

  /* opts: {x, series:[{name, values, color}], yFmt, refs, xFmt, xLabel, totalLabel} stacked */
  function bars(container, opts) {
    const x = opts.x || [];
    const totals = x.map((_, i) => opts.series.reduce((a, s) => a + (s.values[i] || 0), 0));
    if (!x.length || !totals.some((t) => t > 0)) return empty(container);
    const ctx = setup(container, opts);
    const refMax = Math.max(0, ...(opts.refs || []).map((r) => r.y));
    const hi = Math.max(...totals, refMax) * 1.06;
    const ticks = niceTicks(0, hi, 4).filter((t) => t <= hi);
    const y = (v) => PAD.t + ctx.ih - (v / hi) * ctx.ih;
    const step = ctx.iw / x.length;
    const gap = step > 8 ? 2 : step > 3 ? 1 : 0;
    const bw = Math.max(1, step - gap);
    axes(el("g", {}, ctx.svg), ctx, x, ticks, y, opts.tickFmt || opts.yFmt || defFmt, opts.xLabel);
    const surface = cssVar("--surface-1");
    x.forEach((_, i) => {
      let acc = 0;
      const segs = opts.series.map((s) => ({ s, v: s.values[i] || 0 })).filter((p) => p.v > 0);
      segs.forEach((p, k) => {
        const y0 = y(acc), y1 = y(acc + p.v);
        acc += p.v;
        const h = Math.max(0.5, y0 - y1 - (k < segs.length - 1 && gap ? 1 : 0));
        const top = k === segs.length - 1;
        const r = top && bw >= 6 ? Math.min(3, bw / 2) : 0;
        const x0 = PAD.l + step * i + gap / 2;
        if (r) {
          el("path", { d: `M${x0},${y0}V${y1 + r}Q${x0},${y1} ${x0 + r},${y1}H${x0 + bw - r}Q${x0 + bw},${y1} ${x0 + bw},${y1 + r}V${y0}Z`, fill: color(p.s.color) }, ctx.svg);
        } else {
          el("rect", { x: x0, y: y1, width: bw, height: h, fill: color(p.s.color) }, ctx.svg);
        }
        if (k < segs.length - 1 && gap) el("line", { x1: x0, x2: x0 + bw, y1: y1, y2: y1, stroke: surface, "stroke-width": 1.5 }, ctx.svg);
      });
    });
    (opts.refs || []).forEach((r) => {
      el("line", { x1: PAD.l, x2: PAD.l + ctx.iw, y1: y(r.y), y2: y(r.y), stroke: cssVar("--text-muted"), "stroke-dasharray": "4 4" }, ctx.svg);
      if (r.label) {
        const t = el("text", { x: PAD.l + ctx.iw - 4, y: y(r.y) - 5, "text-anchor": "end", "font-size": 11, fill: cssVar("--text-muted"), stroke: cssVar("--surface-1"), "stroke-width": 3, "paint-order": "stroke" }, ctx.svg);
        t.textContent = r.label;
      }
    });
    hover(ctx, x, (i) => {
      const rows = opts.series.slice().reverse().map((s) => ({ name: s.name, color: s.color, value: s.values[i] ? (opts.yFmt || defFmt)(s.values[i]) : null }));
      if (opts.series.length > 1 && totals[i]) rows.push({ name: opts.totalLabel || "סה״כ", value: (opts.yFmt || defFmt)(totals[i]) });
      return rows;
    }, opts.xFmt);
  }

  function spark(container, values, c) {
    container.innerHTML = "";
    const vals = values.filter((v) => v != null);
    if (vals.length < 2) return;
    const W = container.clientWidth || 160, H = container.clientHeight || 34;
    const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
    const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}` }, container);
    const xs = (i) => 2 + (i / (values.length - 1)) * (W - 4), ys = (v) => H - 3 - ((v - lo) / span) * (H - 6);
    let d = "", pen = false;
    values.forEach((v, i) => { if (v == null) return; d += (pen ? "L" : "M") + xs(i) + "," + ys(v); pen = true; });
    el("path", { d, fill: "none", stroke: color(c), "stroke-width": 1.5, "stroke-linejoin": "round" }, svg);
    const li = values.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0).pop();
    el("circle", { cx: xs(li), cy: ys(values[li]), r: 2.5, fill: color(c) }, svg);
  }

  window.Charts = { line, bars, spark, fmtDate, fmtDateLong, defFmt, cssVar };
})();
