// RunTracker v2 — llista i detall de sortides. Funcions pures portades de la v1 (renderDetail, sessionSummary,
// renderFeed), que retornen dades en lloc d'HTML.

import { daysAgo, weekKey } from "./dates.js";
import { hrZone } from "./physio.js";
import { getWindowStats, pctChange } from "./performance.js";

export const ZONES = ["Z1 Recuperació", "Z2 Aeròbic", "Z3 Tempo", "Z4 Llindar", "Z5 VO₂max"];

/**
 * Què ha estat la sessió (v1: sessionSummary). Detecta sèries pel temps en zones altes o, sense streams,
 * per una FC màxima que arriba a Z4 amb una mitjana de Z1–Z2.
 * Correcció respecte a la v1: el temps per zona ja és en minuts (la v1 el dividia per 60).
 * @returns {{kind:'intervals'|'easy'|'moderate'|'hard', title:string, text:string, warn?:string}|null}
 */
export function sessionSummary(a, bounds) {
  const z = a.hrZone;
  if (z === null || z === undefined) return null;
  let hardFrac = null, intervals = false, src = null, topMin = 0;
  if (a.tiz) {
    const tot = a.tiz.reduce((s, v) => s + v, 0);
    if (tot > 0) {
      hardFrac = (a.tiz[2] + a.tiz[3] + a.tiz[4]) / tot;
      const top = (a.tiz[3] + a.tiz[4]) / tot;
      topMin = Math.round(a.tiz[3] + a.tiz[4]);
      if ((z <= 1 && top >= 0.08) || (z <= 2 && top >= 0.12)) { intervals = true; src = "tiz"; }
    }
  }
  if (!intervals && z <= 1 && a.maxHR && bounds && hrZone(a.maxHR, bounds) >= 3) { intervals = true; src = "maxhr"; }
  const race = a.vo2 && a.vo2conf === "race" ? " Cursa marcada (VDOT)." : "";
  if (intervals) {
    return { kind: "intervals", title: "Sessió amb canvis de ritme",
      text: (src === "tiz"
        ? "Tot i una FC mitjana baixa, has acumulat temps en zones altes: el patró d'unes sèries o un fartlek." + (topMin > 0 ? ` Uns ${topMin} min en Z4–Z5.` : "")
        : `Tot i una FC mitjana baixa, la màxima (${a.maxHR} ppm) va arribar a zona alta: esforços intensos puntuals, com sèries o fartlek.`) + race };
  }
  if (z <= 1) {
    const homogeneous = hardFrac !== null && hardFrac < 0.1;
    const text = homogeneous && typeof a.dec === "number"
      ? (a.dec <= 5 ? "Ben executat: FC estable de principi a fi." : `Deriva cardíaca del ${String(a.dec).replace(".", ",")} %: el final va costar més que l'inici.`)
      : "La base que fa créixer l'eficiència aeròbica.";
    const out = { kind: "easy", title: "Rodatge fàcil", text };
    if (a.rpe && a.rpe >= 6) out.warn = `RPE alt (${a.rpe}) per a un dia fàcil: si es repeteix, és un senyal primerenc de fatiga encara que la FC sembli normal.`;
    return out;
  }
  if (z === 2) return { kind: "moderate", title: "Sessió moderada (Z3)", text: "Útil puntualment, però que no substitueixi ni el volum fàcil ni la qualitat dura." };
  return { kind: "hard", title: `Sessió intensa (Z${z + 1})`, text: "Estímul de qualitat per al llindar i el VO₂max." + race };
}

/** Intensitat com a % de la FC màxima (v1). tone: info | ok | warn | hard | bad. */
export function intensityRead(avgHR, hrMax) {
  if (!avgHR || !hrMax) return null;
  const pct = Math.round(avgHR / hrMax * 100);
  const [label, tone, text] = pct < 65 ? ["Molt fàcil", "info", "Recuperació. Ideal entre sessions dures."]
    : pct < 75 ? ["Fàcil / Z2", "ok", "Base aeròbica sense fatiga excessiva."]
    : pct < 82 ? ["Moderat / tempo", "warn", "Millora el llindar aeròbic."]
    : pct < 90 ? ["Dur / llindar", "hard", "Prop del llindar anaeròbic: 1 o 2 per setmana."]
    : ["Molt dur / VO₂max", "bad", "Intensitat màxima: cal recuperació."];
  return { pct, label, tone, text };
}

/** Càrrega de la sortida pel TRIMP (v1). */
export function loadRead(trimp) {
  if (!trimp) return null;
  const [label, tone, text] = trimp < 50 ? ["Lleugera", "ok", "Bona per a dies de recuperació."]
    : trimp < 100 ? ["Moderada", "warn", "Adequada per a sessions regulars."]
    : trimp < 150 ? ["Alta", "hard", "Exigent: descansa bé les pròximes 24–48 h."]
    : ["Molt alta", "bad", "Necessitaràs 48–72 h de recuperació."];
  return { label, tone, text };
}

/** Lectura del VO₂max (v1). */
export const vo2Read = vo2 => !vo2 ? null : vo2 >= 55 ? "Excel·lent" : vo2 >= 50 ? "Molt bo" : vo2 >= 45 ? "Bo" : vo2 >= 40 ? "Acceptable" : "A millorar";

/** Eficiència cardíaca: segons per km per batec (més baix = més eficient). */
export const efficiency = a => (a.pace && a.avgHR) ? Math.round(a.pace / a.avgHR * 100) / 100 : null;

/**
 * Fins a 10 sortides anteriors de distància semblant (±30 %) i les seves mitjanes.
 * Null si n'hi ha menys de 2.
 */
export function compareSimilar(acts, a, max = 10) {
  const d = a.distance || 5;
  const list = acts.filter(x => x.id !== a.id && x.distance && x.distance >= d * 0.7 && x.distance <= d * 1.3 && x.date <= a.date)
    .sort((x, y) => (x.startTime || x.date).localeCompare(y.startTime || y.date)).slice(-max);
  if (list.length < 2) return null;
  const avg = xs => xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null;
  const paces = list.filter(x => x.pace).map(x => x.pace);
  const hrs = list.filter(x => x.avgHR).map(x => x.avgHR);
  const effs = list.map(efficiency).filter(v => v != null);
  return {
    n: list.length, list,
    pace: paces.length ? avg(paces) : null,
    hr: hrs.length ? Math.round(avg(hrs)) : null,
    eff: effs.length ? Math.round(avg(effs) * 100) / 100 : null,
  };
}

/** La setmana d'aquella sortida (v1: context setmanal). */
export function weekContext(acts, a) {
  const wk = acts.filter(x => weekKey(x.date) === weekKey(a.date));
  return {
    n: wk.length,
    km: Math.round(wk.reduce((s, x) => s + (x.distance || 0), 0) * 10) / 10,
    trimp: Math.round(wk.reduce((s, x) => s + (x.trimp || 0), 0)),
  };
}

/** Els últims `days` dies contra els `days` anteriors: xifres i variació en %. */
export function periodStats(ctx, days) {
  const cur = getWindowStats(ctx, 0, days), prev = getWindowStats(ctx, days, days * 2);
  return {
    days, cur, prev,
    d: { km: pctChange(cur.km, prev.km), n: pctChange(cur.n, prev.n), dur: pctChange(cur.dur, prev.dur),
      asc: pctChange(cur.asc, prev.asc), pace: pctChange(cur.pace, prev.pace), hr: pctChange(cur.hr, prev.hr) },
  };
}

/** Destacats del període: la més llarga, la de més desnivell i la més ràpida de 5 km o més. */
export function highlights({ acts, now }, days) {
  const r = acts.filter(a => { const d = daysAgo(a.date, now); return d >= 0 && d < days; });
  let longest = null, climb = null, fastest = null;
  for (const a of r) {
    if (a.distance && (!longest || a.distance > longest.distance)) longest = a;
    if (a.ascent && (!climb || a.ascent > climb.ascent)) climb = a;
    if (a.pace && (a.distance || 0) >= 5 && (!fastest || a.pace < fastest.pace)) fastest = a;
  }
  return { longest, climb, fastest };
}

/** Sortides agrupades per mes, del més recent al més antic, amb els km de cada mes. */
export function byMonth(acts) {
  const sorted = [...acts].sort((x, y) => (y.startTime || y.date).localeCompare(x.startTime || x.date));
  const out = [];
  for (const a of sorted) {
    const m = a.date.slice(0, 7);
    let g = out.at(-1);
    if (!g || g.month !== m) { g = { month: m, km: 0, acts: [] }; out.push(g); }
    g.acts.push(a);
    g.km = Math.round((g.km + (a.distance || 0)) * 10) / 10;
  }
  return out;
}
