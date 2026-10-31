// RunTracker v2 — utilitats de dates, idèntiques a les de la v1 però amb "ara" com a paràmetre.
// Les dates d'activitat són cadenes 'AAAA-MM-DD' en hora local.

/** Data local 'AAAA-MM-DD' d'un objecte Date (v1: dateStr). */
export const dateStr = d => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};

/**
 * Dies de calendari des d'una data 'AAAA-MM-DD' fins al dia local de `now` (ms). 0 = avui.
 * La v1 (dS) comptava des de la mitjanit UTC: entre les 00:00 i les 02:00 (01:00 a l'hivern)
 * una sortida d'avui sortia amb -1 dies (BUGS-v1 #8).
 */
export const daysAgo = (ds, now) => {
  const [y, m, d] = String(ds).slice(0, 10).split("-").map(Number);
  const n = new Date(now);
  return Math.round((Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) - Date.UTC(y, m - 1, d)) / 864e5);
};

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
