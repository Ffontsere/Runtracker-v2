// RunTracker v2 — puntuació del clima per córrer. Port fidel de la v1 (v47).

import { daysAgo } from "./dates.js";
import { heatPaceAdjPct } from "./physio.js";

/** Pesos per tipus de sessió (v1: WXW). dur = minuts que dura la sessió. */
export const WXW = {
  easy: { heat: 1.00, sun: 0.70, wind: 0.60, rain: 0.70, dur: 45, n: "Rodatge fàcil" },
  long: { heat: 1.40, sun: 1.30, wind: 0.70, rain: 1.10, dur: 95, n: "Tirada llarga" },
  quality: { heat: 1.50, sun: 1.00, wind: 1.40, rain: 1.00, dur: 60, n: "Sèries / Qualitat" },
  tempo: { heat: 1.40, sun: 1.00, wind: 1.25, rain: 0.90, dur: 55, n: "Tempo / Llindar" },
  rest: { heat: 1.00, sun: 0.70, wind: 0.60, rain: 0.70, dur: 45, n: "Rodatge fàcil" },
};
export const wxW = t => WXW[t] || WXW.easy;

/**
 * Puntuació 0–100 d'una hora per a un tipus de sessió (v1: wxHourScore).
 * h = { temp, dp, rad, wind, gust, pprob, prec } en °C, W/m², km/h, %, mm.
 */
export function wxHourScore(h, type) {
  const w = wxW(type);
  let pen = 0; const why = [];
  const heatPct = heatPaceAdjPct(h.temp, h.dp);
  if (heatPct > 0) { pen += heatPct * 4.2 * w.heat; if (heatPct >= 2.5) why.push("calor i humitat"); }
  if (h.temp < 3) { pen += (3 - h.temp) * 2.2; why.push("fred"); }
  if (h.rad > 60) {
    const hf = Math.max(0, Math.min(1, (h.temp - 12) / 14));
    const rp = (h.rad / 900) * 16 * hf * w.sun;
    if (rp > 0) { pen += rp; if (rp > 5) why.push("sol directe"); }
  }
  const wd = h.wind || 0, gu = h.gust || 0;
  if (h.temp >= 20 && wd >= 6 && wd <= 20) pen -= Math.min(6, (wd - 4) * 0.5);
  if (wd > 22) { pen += (wd - 22) * 0.85 * w.wind; why.push("vent fort"); }
  if (gu > 45) pen += (gu - 45) * 0.40 * w.wind;
  if (h.temp < 6 && wd > 15) pen += (wd - 15) * 0.50;
  const pp = h.pprob || 0, mm = h.prec || 0;
  if (mm > 0.1 || pp > 25) {
    const inten = mm > 4 ? 26 : mm > 1.5 ? 15 : mm > 0.3 ? 7 : 3;
    const rp = inten * (Math.max(pp, mm > 0.1 ? 60 : 0) / 100) * w.rain;
    if (rp > 3) { pen += rp; why.push(mm > 1.5 ? "pluja" : "risc de pluja"); }
  }
  return { score: Math.max(0, Math.min(100, Math.round(100 - pen))), heatPct, why };
}

/** Categoria d'una puntuació. `tone` en lloc del color de la v1. */
export function wxCat(sc) {
  if (sc >= 85) return { l: "Excel·lent", tone: "ok" };
  if (sc >= 70) return { l: "Bo", tone: "good" };
  if (sc >= 55) return { l: "Acceptable", tone: "warn" };
  if (sc >= 40) return { l: "Exigent", tone: "hard" };
  return { l: "Evita-ho", tone: "bad" };
}

/** Puntuació mitjana de les hores que dura una sessió que comença a l'hora i (v1: wxWindowScore). */
export function wxWindowScore(hours, i, type) {
  const w = wxW(type);
  const span = Math.max(1, Math.round(w.dur / 60));
  let tot = 0, n = 0, maxHeat = 0; const why = {};
  for (let k = 0; k < span && i + k < hours.length; k++) {
    const r = wxHourScore(hours[i + k], type);
    tot += r.score; n++;
    if (r.heatPct > maxHeat) maxHeat = r.heatPct;
    r.why.forEach(x => { why[x] = 1; });
  }
  if (!n) return null;
  return { score: Math.round(tot / n), heatPct: maxHeat, why: Object.keys(why), span };
}

/** Ritme fàcil típic dels últims 120 dies, per traduir el cost de la calor a segons (v1: wxTypicalPace). */
export function wxTypicalPace({ acts, now }) {
  const r = acts.filter(a => a.pace && a.distance >= 4 && daysAgo(a.date, now) <= 120 && (a.hrZone === null || a.hrZone <= 1));
  const src = r.length >= 4 ? r : acts.filter(a => a.pace && daysAgo(a.date, now) <= 120);
  if (!src.length) return null;
  const p = src.map(a => a.pace).sort((a, b) => a - b);
  return p[Math.floor(p.length / 2)];
}
