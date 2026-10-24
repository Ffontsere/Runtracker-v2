// RunTracker v2 — pestanya Progrés. Funcions pures.
// Inclou les dues correccions de BUGS-v1.md que afecten aquesta pantalla:
//  · #2 Marques: també es fan servir els millors esforços dels streams (un 10 km dins d'una tirada de 15 compta).
//  · #3 Predicció: VDOT de Daniels de debò (la v1 en deia VDOT però era Riegel 1,07).

import { daysAgo, weekKey, dateStr } from "./dates.js";
import { calcFF, ffNow, projectFitness, actLoad } from "./load.js";
import { o2Cost, thresholdZones, lt2Estimate, karvonen } from "./physio.js";
import { RACE_DISTS, personalRiegelExp, getWeekly } from "./performance.js";

const WINDOWS = [60, 120, 300, 600, 1200, 1800, 3600];

/**
 * Temps (s) per cobrir `km` amb els millors esforços d'una sortida (`a.be`: m/s per finestra de temps,
 * ajustats al pendent). Interpola en escala logarítmica entre les dues finestres que l'envolten.
 * Null si la distància queda fora del que cobreixen les finestres.
 */
export function timeFromEfforts(be, km) {
  if (!be) return null;
  const pts = WINDOWS.filter(w => be[w]).map(w => ({ t: w, d: be[w] * w })).sort((x, y) => x.d - y.d);
  const D = km * 1000;
  for (let i = 0; i < pts.length; i++) {
    if (Math.abs(pts[i].d - D) < 1) return pts[i].t;
    if (i && pts[i - 1].d < D && pts[i].d > D) {
      const a = pts[i - 1], b = pts[i];
      const f = (Math.log(D) - Math.log(a.d)) / (Math.log(b.d) - Math.log(a.d));
      return Math.exp(Math.log(a.t) + f * (Math.log(b.t) - Math.log(a.t)));
    }
  }
  return null;
}

/**
 * Marques per distància. Per a cada distància es queda el temps més ràpid entre:
 *  - sortides senceres prou llargues (com la v1: ritme mitjà × distància), i
 *  - els millors esforços dels streams (nou), marcats com a ajustats al pendent.
 * @returns {{[nom:string]: {time:number, date:string, id:string, src:'sortida'|'esforç'}|null}}
 */
export function personalBests({ acts }, days = null, now = Date.now()) {
  const pool = days == null ? acts : acts.filter(a => daysAgo(a.date, now) < days);
  const out = {};
  for (const rd of RACE_DISTS) {
    let best = null;
    for (const a of pool) {
      if (a.distance && a.duration && a.distance >= rd.k * 0.95) {
        const t = (a.pace || a.duration / a.distance) * rd.k;
        if (!best || t < best.time) best = { time: t, date: a.date, id: a.id, src: "sortida" };
      }
      const te = timeFromEfforts(a.be, rd.k);
      if (te && (!best || te < best.time)) best = { time: te, date: a.date, id: a.id, src: "esforç" };
    }
    out[rd.n] = best ? { ...best, time: Math.round(best.time) } : null;
  }
  return out;
}

/** VDOT de Daniels sense arrodonir (per poder-lo invertir). */
function vdotRaw(km, sec) {
  const v = km * 1000 / (sec / 60), tMin = sec / 60;
  const pct = 0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);
  return o2Cost(v) / pct;
}
export const vdotOf = (km, sec) => (km > 0 && sec > 0) ? Math.round(vdotRaw(km, sec) * 10) / 10 : null;

/** Temps (s) que correspon a un VDOT per a una distància: inversa de Daniels per bisecció. */
export function timeForVdot(vdot, km) {
  if (!(vdot > 0 && km > 0)) return null;
  let lo = km * 120, hi = km * 900; // de 2:00 a 15:00 /km
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (vdotRaw(km, mid) > vdot) lo = mid; else hi = mid; }
  return Math.round((lo + hi) / 2);
}

/**
 * Prediccions per a les distàncies de cursa a partir de la millor marca de referència
 * (la de més VDOT entre 5 km i mitja, que és on els dos models funcionen millor).
 */
export function predictions(ctx, bests) {
  const cands = RACE_DISTS.filter(d => d.k >= 5 && d.k <= 21.1 && bests[d.n]).map(d => ({ d, b: bests[d.n], v: vdotRaw(d.k, bests[d.n].time) }));
  if (!cands.length) return null;
  const ref = cands.sort((x, y) => y.v - x.v)[0];
  const exp = personalRiegelExp(ctx);
  const vdot = Math.round(ref.v * 10) / 10;
  return {
    ref: { n: ref.d.n, k: ref.d.k, time: ref.b.time, date: ref.b.date, src: ref.b.src }, vdot, exp,
    rows: RACE_DISTS.map(d => ({
      n: d.n, k: d.k,
      vdot: timeForVdot(ref.v, d.k),
      riegel: Math.round(ref.b.time * Math.pow(d.k / ref.d.k, exp || 1.06)),
    })),
  };
}

/**
 * Forma (CTL/ATL/TSB) dels últims `days` dies i projecció de `ahead` dies suposant la teva
 * càrrega diària mitjana dels últims 28 dies (decisió de la proposta: sense pla de cursa).
 */
export function formSeries(ctx, days = 120, ahead = 14) {
  const ff = calcFF(ctx);
  if (!ff.length) return null;
  const { acts, now, extraDaily } = ctx;
  let load28 = 0;
  for (const a of acts) { const d = daysAgo(a.date, now); if (d >= 0 && d < 28) load28 += actLoad(a); }
  for (const [d, v] of Object.entries(extraDaily || {})) { const ago = daysAgo(d, now); if (ago >= 0 && ago < 28) load28 += v; }
  const daily = Math.round(load28 / 28 * 10) / 10;
  const past = ff.slice(-days);
  const last = ff.at(-1);
  const proj = projectFitness(ff, ahead, daily).map((p, i) => ({ ...p, date: dateStr(new Date(Date.parse(last.date + "T12:00:00") + (i + 1) * 864e5)) }));
  return { past, proj, daily, now: ffNow(ff) };
}

/** Km per setmana de les últimes 16 setmanes, incloses les que no tenen cap sortida. */
export function weeklyVolume(ctx, weeks = 16) {
  const by = Object.fromEntries(getWeekly(ctx).map(w => [w.week, w]));
  const cur = weekKey(dateStr(new Date(ctx.now)));
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(Date.parse(cur + "T12:00:00") - i * 7 * 864e5);
    const k = dateStr(d);
    const w = by[k];
    out.push({ week: k, km: w ? w.km : 0, n: w ? w.n : 0, current: i === 0 });
  }
  return out;
}

/** VO₂max setmanal (mitjana de les sortides amb valor fiable, si n'hi ha; si no, de totes). */
export function vo2Series({ acts, now }, weeks = 26) {
  const from = now - weeks * 7 * 864e5;
  const by = {};
  for (const a of acts) {
    if (!a.vo2 || Date.parse(a.date) < from) continue;
    const k = weekKey(a.date);
    const good = a.vo2conf === "stream" || a.vo2conf === "race";
    (by[k] = by[k] || { good: [], all: [] })[good ? "good" : "all"].push(a.vo2);
  }
  return Object.entries(by).sort(([x], [y]) => x.localeCompare(y)).map(([week, g]) => {
    const xs = g.good.length ? g.good : g.all;
    return { week, value: Math.round(xs.reduce((s, v) => s + v, 0) / xs.length * 10) / 10, reliable: !!g.good.length };
  });
}

/** Km de l'any en curs contra l'objectiu anual, i on hauries de ser avui. */
export function yearProgress({ acts, settings, now }) {
  const y = new Date(now).getFullYear();
  const km = Math.round(acts.filter(a => a.date.startsWith(String(y))).reduce((s, a) => s + (a.distance || 0), 0));
  const goal = settings.yearlyGoal || null;
  const start = new Date(y, 0, 1).getTime(), end = new Date(y + 1, 0, 1).getTime();
  const frac = (now - start) / (end - start);
  return { year: y, km, goal, expected: goal ? Math.round(goal * frac) : null, pct: goal ? Math.round(km / goal * 100) : null };
}

/**
 * Les zones que s'apliquen de debò, amb el seu origen: manuals (Perfil/Progrés), Seiler (LT1 i LT2) o Karvonen.
 * bounds = inici de Z2, Z3, Z4 i Z5. LT1 = inici de Z3; LT2 = inici de Z4.
 */
export function activeZones(ctx) {
  const { settings } = ctx;
  const names = ["Recuperació", "Fàcil (aeròbic)", "Tempo", "Llindar", "VO₂max"];
  let bounds, source, detail = null;
  if (settings.zones && settings.zones.length === 4) { bounds = settings.zones; source = "manual"; }
  else {
    const tz = thresholdZones(ctx);
    if (tz) { bounds = [tz.zones[0].hi, tz.zones[1].hi, tz.zones[2].hi, tz.zones[3].hi]; source = "seiler"; detail = { lt1src: tz.lt1src, lt2src: lt2Estimate(ctx)?.src || null }; }
    else { bounds = karvonen(settings.hrMax, settings.hrRest); source = "karvonen"; }
  }
  const top = settings.hrMax || bounds[3] + 10;
  const rows = names.map((n, i) => ({ z: `Z${i + 1}`, name: n, lo: i === 0 ? null : bounds[i - 1], hi: i === 4 ? top : bounds[i] }));
  return { bounds, source, detail, lt1: bounds[1], lt2: bounds[2], rows };
}

/** Valida 4 límits de zona. Retorna el missatge d'error o null. */
export function validateZones(b, { hrMax, hrRest }) {
  if (b.length !== 4 || b.some(v => !Number.isInteger(v))) return "Posa els quatre límits en pulsacions, sense decimals.";
  if (b[0] <= hrRest) return `L'inici de Z2 ha de ser més alt que la FC en repòs (${hrRest}).`;
  if (b[3] >= hrMax) return `L'inici de Z5 ha de ser més baix que la FC màxima (${hrMax}).`;
  for (let i = 1; i < 4; i++) if (b[i] <= b[i - 1]) return "Cada límit ha de ser més alt que l'anterior.";
  return null;
}
