// RunTracker v2 — pestanya Clima. Funcions pures sobre la previsió horària d'Open-Meteo.

import { dateStr } from "./dates.js";
import { wxHourScore, wxWindowScore, wxCat, wxW } from "./weather.js";

/** Descripció curta del codi WMO (en lloc de les icones de la v1). */
export function skyOf(code, isDay = 1) {
  if (code == null) return "";
  if (code === 0) return isDay ? "Serè" : "Serè (nit)";
  if (code <= 2) return "Poc ennuvolat";
  if (code === 3) return "Cobert";
  if (code >= 45 && code <= 48) return "Boira";
  if (code >= 51 && code <= 57) return "Plugim";
  if (code >= 61 && code <= 67) return "Pluja";
  if (code >= 71 && code <= 77) return "Neu";
  if (code >= 80 && code <= 82) return "Ruixats";
  if (code >= 95) return "Tempesta";
  return "Cobert";
}

/** Dies de la previsió amb els índexs de les seves hores. */
export function forecastDays(hours) {
  const out = [];
  hours.forEach((x, i) => {
    const key = x.t.slice(0, 10);
    let d = out.at(-1);
    if (!d || d.key !== key) { d = { key, idx: [] }; out.push(d); }
    d.idx.push(i);
  });
  return out;
}

/** Millor hora per començar d'un dia (05–22 h, sense hores passades). */
export function dayBest(hours, day, type, now) {
  const earliest = now - 20 * 60000;
  let best = null;
  for (const i of day.idx) {
    const hr = +hours[i].t.slice(11, 13);
    if (hr < 5 || hr > 22 || new Date(hours[i].t).getTime() < earliest) continue;
    const r = wxWindowScore(hours, i, type);
    if (r && (!best || r.score > best.score)) best = { i, hour: hr, temp: hours[i].temp, ...r };
  }
  return best ? { ...best, cat: wxCat(best.score), end: Math.min(23, best.hour + best.span) } : null;
}

/** Hores d'un dia (05–22 h) amb la puntuació i el detall. `pace` (s/km) tradueix la calor a segons. */
export function dayHours(hours, day, type, now, pace = null) {
  return day.idx.map(i => {
    const x = hours[i], hr = +x.t.slice(11, 13);
    if (hr < 5 || hr > 22) return null;
    const r = wxHourScore(x, type);
    const bits = [`humitat ${Math.round(x.rh)} %`];
    if (x.wind >= 8) bits.push(`vent ${Math.round(x.wind)} km/h`);
    if (x.pprob >= 25) bits.push(`pluja ${Math.round(x.pprob)} %`);
    if (x.uv >= 3) bits.push(`UV ${Math.round(x.uv)}`);
    if (r.heatPct > 0 && pace) bits.push(`+${Math.round(pace * r.heatPct / 100)} s/km per la calor`);
    return { hour: hr, past: new Date(x.t).getTime() < now - 20 * 60000, temp: x.temp, sky: skyOf(x.code, x.day), score: r.score, cat: wxCat(r.score), why: r.why, bits };
  }).filter(Boolean);
}

export const typeName = t => wxW(t).n;

/** Quines sortides no tenen el temps del dia (per corregir el VO₂). Només Strava, amb posició i hora. */
export function missingWx(acts, tempCache, now, days = 365) {
  return acts.filter(a => a.source === "strava" && a.lat != null && a.lng != null && a.startTime && tempCache[a.id] === undefined &&
    typeof a.tempManual !== "number" && (now - Date.parse(a.date)) / 864e5 <= days)
    .sort((x, y) => y.date.localeCompare(x.date));
}

export { dateStr };
