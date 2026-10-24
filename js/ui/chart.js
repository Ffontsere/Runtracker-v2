// RunTracker v2 — gràfics SVG petits, sense llibreries.
// Un sol eix per gràfic, línies de 2 px, graella discreta, cursor vertical amb etiqueta (línies)
// i etiqueta per barra (barres). Els textos van amb textContent, mai com a HTML.

const NS = "http://www.w3.org/2000/svg";
const s = (tag, attrs = {}) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v); return el; };
const d = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };

/** Valors "rodons" per a l'eix. */
function ticks(lo, hi, n = 4) {
  const span = hi - lo || 1, raw = span / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(st => span / st <= n) || 10 * mag;
  const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

function frame(root, { height, label }) {
  const W = 320, H = height, pad = { l: 34, r: 8, t: 8, b: 20 };
  const wrap = d("div", "chart-wrap");
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart-svg", role: "img", "aria-label": label });
  const tip = d("div", "chart-tip"); tip.hidden = true;
  wrap.append(svg, tip);
  root.append(wrap);
  return { W, H, pad, svg, tip, wrap };
}

/**
 * Gràfic de línies.
 * @param {HTMLElement} root
 * @param {{labels:string[], series:{key:string,name:string,cls:string,values:(number|null)[],dashFrom?:number}[],
 *          yFmt?:(v:number)=>string, xFmt?:(l:string)=>string, zero?:boolean, height?:number, label:string, band?:[number,number]}} o
 */
export function lineChart(root, o) {
  const { W, H, pad, svg, tip, wrap } = frame(root, { height: o.height || 170, label: o.label });
  const all = o.series.flatMap(x => x.values).filter(v => v != null);
  if (!all.length) { wrap.remove(); return; }
  let lo = Math.min(...all), hi = Math.max(...all);
  if (o.zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (o.band) { lo = Math.min(lo, o.band[0]); hi = Math.max(hi, o.band[1]); }
  const m = (hi - lo) * 0.08 || 1; lo -= m; hi += m;
  const n = o.labels.length;
  const X = i => pad.l + (n === 1 ? 0 : i / (n - 1)) * (W - pad.l - pad.r);
  const Y = v => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const fy = o.yFmt || (v => String(Math.round(v)));
  const fx = o.xFmt || (l => l);
  // banda (p. ex. zona òptima del TSB)
  if (o.band) svg.append(s("rect", { x: pad.l, y: Y(o.band[1]), width: W - pad.l - pad.r, height: Y(o.band[0]) - Y(o.band[1]), class: "chart-band" }));
  for (const t of ticks(lo, hi)) {
    svg.append(s("line", { x1: pad.l, x2: W - pad.r, y1: Y(t), y2: Y(t), class: t === 0 && o.zero ? "chart-zero" : "chart-grid" }));
    const tx = s("text", { x: pad.l - 5, y: Y(t) + 3, class: "chart-axis", "text-anchor": "end" }); tx.textContent = fy(t); svg.append(tx);
  }
  // etiquetes de l'eix X: primera, mitja i última
  for (const i of [...new Set([0, Math.floor((n - 1) / 2), n - 1])]) {
    const tx = s("text", { x: X(i), y: H - 5, class: "chart-axis", "text-anchor": i === 0 ? "start" : i === n - 1 ? "end" : "middle" }); tx.textContent = fx(o.labels[i]); svg.append(tx);
  }
  for (const se of o.series) {
    const seg = (from, to, dashed) => {
      let p = "", pen = false;
      for (let i = from; i <= to; i++) { const v = se.values[i]; if (v == null) { pen = false; continue; } p += `${pen ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`; pen = true; }
      if (p) svg.append(s("path", { d: p, class: `chart-line ${se.cls}${dashed ? " dashed" : ""}` }));
    };
    if (se.dashFrom != null) { seg(0, se.dashFrom, false); seg(se.dashFrom, n - 1, true); } else seg(0, n - 1, false);
    // punt final de la part sòlida
    const li = se.dashFrom != null ? se.dashFrom : se.values.map((v, i) => v != null ? i : -1).filter(i => i >= 0).at(-1);
    if (li != null && li >= 0 && se.values[li] != null) svg.append(s("circle", { cx: X(li), cy: Y(se.values[li]), r: 4, class: `chart-dot ${se.cls}` }));
  }
  // cursor vertical i etiqueta
  const hair = s("line", { y1: pad.t, y2: H - pad.b, class: "chart-hair", visibility: "hidden" });
  const hit = s("rect", { x: pad.l, y: 0, width: W - pad.l - pad.r, height: H, fill: "transparent", tabindex: 0 });
  svg.append(hair, hit);
  const show = i => {
    hair.setAttribute("x1", X(i)); hair.setAttribute("x2", X(i)); hair.setAttribute("visibility", "visible");
    tip.replaceChildren(d("div", "tip-x", fx(o.labels[i])), ...o.series.filter(se => se.values[i] != null).map(se => {
      const r = d("div", "tip-row"); r.append(d("span", `tip-key ${se.cls}`), d("b", null, fy(se.values[i])), d("span", null, " " + se.name)); return r;
    }));
    tip.hidden = false;
    const left = X(i) / W * 100;
    tip.style.left = left > 55 ? "" : `calc(${left}% + 10px)`;
    tip.style.right = left > 55 ? `calc(${100 - left}% + 10px)` : "";
  };
  const at = ev => { const r = svg.getBoundingClientRect(); const x = (ev.clientX - r.left) / r.width * W; return Math.max(0, Math.min(n - 1, Math.round((x - pad.l) / (W - pad.l - pad.r) * (n - 1)))); };
  let cur = n - 1;
  hit.addEventListener("pointermove", ev => { cur = at(ev); show(cur); });
  hit.addEventListener("pointerleave", () => { hair.setAttribute("visibility", "hidden"); tip.hidden = true; });
  hit.addEventListener("focus", () => show(cur));
  hit.addEventListener("blur", () => { hair.setAttribute("visibility", "hidden"); tip.hidden = true; });
  hit.addEventListener("keydown", ev => { if (ev.key === "ArrowLeft") { cur = Math.max(0, cur - 1); show(cur); } if (ev.key === "ArrowRight") { cur = Math.min(n - 1, cur + 1); show(cur); } });
  // llegenda per a 2 o més sèries
  if (o.series.length > 1) {
    const lg = d("div", "chart-legend");
    for (const se of o.series) { const it = d("span", "lg-item"); it.append(d("span", `lg-key ${se.cls}`), document.createTextNode(se.name)); lg.append(it); }
    wrap.append(lg);
  }
}

/**
 * Gràfic de barres verticals. Cada barra té la seva etiqueta en passar-hi el dit o amb el teclat.
 * @param {{items:{label:string,value:number,strong?:boolean}[], fmt?:(v)=>string, xFmt?:(l)=>string, target?:number, targetLabel?:string, height?:number, label:string}} o
 */
export function barChart(root, o) {
  const { W, H, pad, svg, tip } = frame(root, { height: o.height || 150, label: o.label });
  const n = o.items.length;
  const hi = Math.max(1, ...o.items.map(x => x.value), o.target || 0) * 1.1;
  const Y = v => pad.t + (1 - v / hi) * (H - pad.t - pad.b);
  const slot = (W - pad.l - pad.r) / n, bw = Math.max(4, slot - 2);
  const fy = o.fmt || (v => String(Math.round(v)));
  const fx = o.xFmt || (l => l);
  for (const t of ticks(0, hi)) {
    svg.append(s("line", { x1: pad.l, x2: W - pad.r, y1: Y(t), y2: Y(t), class: t === 0 ? "chart-zero" : "chart-grid" }));
    const tx = s("text", { x: pad.l - 5, y: Y(t) + 3, class: "chart-axis", "text-anchor": "end" }); tx.textContent = fy(t); svg.append(tx);
  }
  if (o.target) {
    svg.append(s("line", { x1: pad.l, x2: W - pad.r, y1: Y(o.target), y2: Y(o.target), class: "chart-target" }));
    const tx = s("text", { x: W - pad.r, y: Y(o.target) - 4, class: "chart-axis", "text-anchor": "end" }); tx.textContent = o.targetLabel || fy(o.target); svg.append(tx);
  }
  o.items.forEach((it, i) => {
    const x = pad.l + i * slot + 1, y = Y(it.value), h = Math.max(0, Y(0) - y);
    const r = Math.min(4, bw / 2, h);
    // extrem arrodonit a dalt, recte a la base
    const p = h > 0 ? `M${x} ${Y(0)}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + bw - r}Q${x + bw} ${y} ${x + bw} ${y + r}V${Y(0)}Z` : "";
    const bar = s("path", { d: p, class: "chart-bar s1" + (it.strong ? " strong" : "") });
    const hit = s("rect", { x: pad.l + i * slot, y: pad.t, width: slot, height: H - pad.t - pad.b, fill: "transparent", tabindex: 0 });
    const show = () => {
      bar.classList.add("hover");
      tip.replaceChildren(d("div", "tip-x", fx(it.label)), (() => { const rr = d("div", "tip-row"); rr.append(d("b", null, fy(it.value))); return rr; })());
      tip.hidden = false;
      const left = (x + bw / 2) / W * 100;
      tip.style.left = left > 55 ? "" : `calc(${left}% + 8px)`;
      tip.style.right = left > 55 ? `calc(${100 - left}% + 8px)` : "";
    };
    const hide = () => { bar.classList.remove("hover"); tip.hidden = true; };
    hit.addEventListener("pointerenter", show); hit.addEventListener("pointerleave", hide);
    hit.addEventListener("focus", show); hit.addEventListener("blur", hide);
    svg.append(bar, hit);
  });
  for (const i of [...new Set([0, Math.floor((n - 1) / 2), n - 1])]) {
    const tx = s("text", { x: pad.l + i * slot + slot / 2, y: H - 5, class: "chart-axis", "text-anchor": i === 0 ? "start" : i === n - 1 ? "end" : "middle" }); tx.textContent = fx(o.items[i].label); svg.append(tx);
  }
}
