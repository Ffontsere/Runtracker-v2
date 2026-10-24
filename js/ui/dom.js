// Ajudes mínimes per construir la pantalla sense innerHTML amb dades (res del que ve de fora s'interpreta com a HTML).

/**
 * h("button.btn.primary", { onclick, disabled }, "Text", fill...)
 * Atributs: on* = esdeveniments, class/className, dataset, la resta com a atribut o propietat.
 */
export function h(tag, attrs, ...kids) {
  const [name, ...classes] = tag.split(".");
  const el = document.createElement(name || "div");
  if (classes.length) el.className = classes.join(" ");
  if (attrs && (typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className += (el.className ? " " : "") + v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
  return el;
}

/** Mostra un missatge en una caixa .msg (tipus: ok, warn, bad o ""). */
export function say(box, text, type = "") {
  box.className = "msg" + (type ? " " + type : "");
  box.textContent = text || "";
}

export const fmtInt = n => n == null ? "—" : new Intl.NumberFormat("ca-ES").format(n);
export function fmtDate(ds) {
  if (!ds) return "—";
  const d = new Date(ds);
  return d.toLocaleDateString("ca-ES", { day: "numeric", month: "short", year: "numeric" });
}
export function fmtAgo(ts, now = Date.now()) {
  if (!ts) return "mai";
  const m = Math.round((now - ts) / 60000);
  if (m < 1) return "ara mateix";
  if (m < 60) return `fa ${m} min`;
  const hh = Math.round(m / 60);
  if (hh < 24) return `fa ${hh} h`;
  const d = Math.round(hh / 24);
  return d === 1 ? "ahir" : `fa ${d} dies`;
}

const pad2 = n => String(n).padStart(2, "0");
/** Ritme en s/km → "m:ss". S'arrodoneix el total abans de partir-lo: 299,6 s → "5:00", no "4:60". */
export const fmtPace = s => { if (!s) return "—"; const t = Math.round(s); return `${Math.floor(t / 60)}:${pad2(t % 60)}`; };
/** Durada en s → "h:mm:ss" o "m:ss", amb el mateix arrodoniment. */
export const fmtDur = s => { if (!s) return "—"; const t = Math.round(s); const hh = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), ss = t % 60; return hh ? `${hh}:${pad2(m)}:${pad2(ss)}` : `${m}:${pad2(ss)}`; };
/** Data curta "16/10". */
export const fmtDayMonth = ds => { const [, m, d] = ds.split("-"); return `${+d}/${+m}`; };
