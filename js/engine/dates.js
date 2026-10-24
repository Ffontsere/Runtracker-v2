// RunTracker v2 — utilitats de dates, idèntiques a les de la v1 però amb "ara" com a paràmetre.
// Les dates d'activitat són cadenes 'AAAA-MM-DD' en hora local.

/** Data local 'AAAA-MM-DD' d'un objecte Date (v1: dateStr). */
export const dateStr = d => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};

/** Dies sencers des d'una data fins a `now` (ms). v1: dS, que feia servir Date.now(). */
export const daysAgo = (ds, now) => Math.floor((now - new Date(ds).getTime()) / 864e5);

/** Dilluns de la setmana d'una data (v1: wK). */
export const weekKey = d => {
  const dt = new Date(d), dy = dt.getDay(), df = dt.getDate() - dy + (dy === 0 ? -6 : 1);
  const m = new Date(dt); m.setDate(df);
  return dateStr(m);
};

const MONTHS = ["gen", "feb", "mar", "abr", "mai", "jun", "jul", "ago", "set", "oct", "nov", "des"];
/** Etiqueta curta d'una setmana o data: "18 oct" (v1: wL). */
export const weekLabel = w => { const d = new Date(w); return d.getDate() + " " + MONTHS[d.getMonth()]; };

/** Claus de dia de la setmana de la v1. getDay(): 0 = diumenge. */
export const DOW = ["dg", "dl", "dt", "dc", "dj", "dv", "ds"];
export const DOW_ORDER = ["dl", "dt", "dc", "dj", "dv", "ds", "dg"];
