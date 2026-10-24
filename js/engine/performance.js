// RunTracker v2 — rendiment i resums: marques, predicció, ratxes, millors esforços, informe de bloc.
// Port fidel de la v1 (v47). ctx = { acts, settings, now, tempCache }.

import { daysAgo, weekKey, DOW, DOW_ORDER } from "./dates.js";
import { gradeAdjFactor, vdotFromEffort, aerobicEfficiency, efficiencySeries, getZoneDist, durabilityTrend } from "./physio.js";

export const RACE_DISTS = [{ n: "1 km", k: 1 }, { n: "5 km", k: 5 }, { n: "10 km", k: 10 }, { n: "Mitja", k: 21.0975 }, { n: "Marató", k: 42.195 }];

/** Millor temps per distància a partir del ritme mitjà de sortides prou llargues (v1: calcPRs). */
export function calcPRs({ acts }) {
  const prs = {};
  RACE_DISTS.forEach(rd => {
    const el = acts.filter(a => a.distance && a.duration && a.distance >= rd.k * .95);
    let best = null;
    el.forEach(a => { const t = (a.pace || a.duration / a.distance) * rd.k; if (!best || t < best.time) best = { time: t, date: a.date }; });
    prs[rd.n] = best;
  });
  return prs;
}

/** Prediccions de Riegel (exponent 1,06) des de la marca de distància més llarga (v1: calcPredictions). */
export function calcPredictions(prs) {
  let ref = null;
  for (const d of RACE_DISTS) { const p = prs[d.n]; if (p) ref = { t: p.time, d: d.k }; }
  if (!ref) return null;
  return RACE_DISTS.map(d => ({ n: d.n, k: d.k, t: Math.round(ref.t * Math.pow(d.k / ref.d, 1.06)) }));
}

/** v1: vdotPredict. Malgrat el nom, és Riegel amb exponent 1,07. */
export const vdotPredict = (t1, d1, d2) => t1 * Math.pow(d2 / d1, 1.07);

/** Predicció per a una cursa: Riegel personal i Riegel 1,07, més desnivell (v1: calcMultiPredict). */
export function calcMultiPredict(ctx, prs, targetKm, targetAscent) {
  let ref = null;
  for (const d of RACE_DISTS) { const p = prs[d.n]; if (p) ref = { t: p.time, d: d.k }; }
  if (!ref) return null;
  const riegel = ref.t * Math.pow(targetKm / ref.d, (personalRiegelExp(ctx) || 1.06));
  const vdot = vdotPredict(ref.t, ref.d, targetKm);
  const elevPenalty = (targetAscent || 0) * 0.6;
  const avg = (riegel + vdot) / 2;
  return { riegel: Math.round(riegel), vdot: Math.round(vdot), avg: Math.round(avg), withElev: Math.round(avg + elevPenalty), elevPenalty: Math.round(elevPenalty) };
}

/** Ratxa actual i millor de dies seguits corrent (v1: calcStreaks). */
export function calcStreaks({ acts, now }) {
  if (!acts.length) return { cur: 0, best: 0 };
  const dates = [...new Set(acts.map(a => a.date))].sort();
  let c = 1, b = 1;
  for (let i = 1; i < dates.length; i++) {
    const diff = Math.round((new Date(dates[i]) - new Date(dates[i - 1])) / 864e5);
    if (diff === 1) { c++; if (c > b) b = c; } else c = 1;
  }
  return { cur: daysAgo(dates[dates.length - 1], now) <= 1 ? c : 0, best: b };
}

// ═══ Millors esforços (alimenten l'exponent de Riegel personal) ═══

/** Millor velocitat (m/s) per finestra de temps, ajustada per pendent (v1: computeBestEfforts). */
export function computeBestEfforts(streams) {
  if (!streams || !streams.time || !streams.distance) return null;
  const t = streams.time.data; let d = streams.distance.data;
  if (!t || !d || t.length < 90) return null;
  const g = streams.grade_smooth && streams.grade_smooth.data;
  if (g && g.length === d.length) {
    const da = new Array(d.length); da[0] = d[0] || 0;
    for (let i = 1; i < d.length; i++) { const step = Math.max(0, (d[i] || 0) - (d[i - 1] || 0)); da[i] = da[i - 1] + step * gradeAdjFactor(g[i]); }
    d = da;
  }
  const out = {};
  [60, 120, 300, 600, 1200, 1800, 3600].forEach(w => {
    let best = 0, j = 0;
    for (let i = 0; i < t.length; i++) {
      while (t[i] - t[j] > w) j++;
      const dt = t[i] - t[j];
      if (dt >= w * 0.97) { const v = (d[i] - d[j]) / dt; if (v > best) best = v; }
    }
    if (best > 1.5 && best < 8) out[w] = Math.round(best * 1000) / 1000;
  });
  return Object.keys(out).length ? out : null;
}

/** Millor velocitat per finestra entre totes les activitats (v1: mmpAggregate). */
export function mmpAggregate({ acts, now }, days) {
  const out = {};
  acts.filter(a => a.be && (days == null || daysAgo(a.date, now) <= days)).forEach(a => {
    [60, 120, 300, 600, 1200, 1800, 3600].forEach(w => { if (a.be[w] && (!out[w] || a.be[w] > out[w])) out[w] = a.be[w]; });
  });
  return out;
}

/** Exponent de Riegel personal per regressió log-log de la corba (v1: personalRiegelExp). */
export function personalRiegelExp(ctx) {
  const m = mmpAggregate(ctx, null);
  const pts = [300, 600, 1200, 1800, 3600].filter(w => m[w]).map(w => ({ d: m[w] * w, t: w }));
  if (pts.length < 3) return null;
  const xs = pts.map(p => Math.log(p.d)), ys = pts.map(p => Math.log(p.t));
  const n = xs.length, sx = xs.reduce((a, b) => a + b, 0), sy = ys.reduce((a, b) => a + b, 0);
  const sxy = xs.reduce((s, x, i) => s + x * ys[i], 0), sxx = xs.reduce((s, x) => s + x * x, 0);
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  if (!(b > 1.01 && b < 1.15)) return null;
  return Math.round(b * 1000) / 1000;
}

/** VDOT mínim de la corba d'esforços dels últims 90 dies (v1: vdotFromCurve). */
export function vdotFromCurve(ctx) {
  const m = mmpAggregate(ctx, 90);
  const w = m[1800] ? 1800 : (m[1200] ? 1200 : null);
  if (!w) return null;
  const v = vdotFromEffort(m[w] * w / 1000, w);
  return v ? Math.round(v * 10) / 10 : null;
}

// ═══ Resums de períodes ═══

export function getWeekly({ acts }) {
  const w = {};
  acts.forEach(a => {
    const wk = weekKey(a.date);
    if (!w[wk]) w[wk] = { week: wk, km: 0, n: 0, trimp: 0, pcs: [], hrs: [], vo2s: [] };
    w[wk].km += a.distance || 0; w[wk].n++; w[wk].trimp += a.trimp || 0;
    if (a.pace) w[wk].pcs.push(a.pace); if (a.avgHR) w[wk].hrs.push(a.avgHR); if (a.vo2) w[wk].vo2s.push(a.vo2);
  });
  return Object.values(w).map(x => ({
    ...x, km: Math.round(x.km * 10) / 10,
    avgP: x.pcs.length ? x.pcs.reduce((s, v) => s + v, 0) / x.pcs.length : null,
    avgHR: x.hrs.length ? Math.round(x.hrs.reduce((s, v) => s + v, 0) / x.hrs.length) : null,
    avgVO2: x.vo2s.length ? Math.round(x.vo2s.reduce((s, v) => s + v, 0) / x.vo2s.length * 10) / 10 : null,
  })).sort((a, b) => a.week.localeCompare(b.week)).slice(-16);
}

export function getS28({ acts, now }) {
  const r = acts.filter(a => daysAgo(a.date, now) <= 28);
  const pc = r.filter(a => a.pace), hr = r.filter(a => a.avgHR);
  return {
    km: r.reduce((s, a) => s + (a.distance || 0), 0), dur: r.reduce((s, a) => s + (a.duration || 0), 0),
    trimp: r.reduce((s, a) => s + (a.trimp || 0), 0), asc: r.reduce((s, a) => s + (a.ascent || 0), 0),
    pace: pc.length ? pc.reduce((s, a) => s + a.pace, 0) / pc.length : null,
    hr: hr.length ? Math.round(hr.reduce((s, a) => s + a.avgHR, 0) / hr.length) : null, n: r.length,
  };
}

export function getWindowStats({ acts, now }, fromAgo, toAgo) {
  const r = acts.filter(a => { const d = daysAgo(a.date, now); return d >= fromAgo && d < toAgo; });
  const pc = r.filter(a => a.pace), hr = r.filter(a => a.avgHR);
  return {
    km: r.reduce((s, a) => s + (a.distance || 0), 0), dur: r.reduce((s, a) => s + (a.duration || 0), 0),
    asc: r.reduce((s, a) => s + (a.ascent || 0), 0), n: r.length,
    pace: pc.length ? pc.reduce((s, a) => s + a.pace, 0) / pc.length : null,
    hr: hr.length ? Math.round(hr.reduce((s, a) => s + a.avgHR, 0) / hr.length) : null,
  };
}

export function pctChange(cur, prev) { if (prev === null || prev === 0 || cur === null) return null; return Math.round((cur - prev) / prev * 1000) / 10; }

export function getPeriodRecords({ acts, now }, days) {
  const r = acts.filter(a => daysAgo(a.date, now) <= days);
  if (!r.length) return null;
  let longest = null, fastest = null, mostAsc = null;
  r.forEach(a => {
    if (a.distance && (!longest || a.distance > longest.distance)) longest = a;
    if (a.pace && (a.distance || 0) >= 3 && (!fastest || a.pace < fastest.pace)) fastest = a;
    if (a.ascent && (!mostAsc || a.ascent > mostAsc.ascent)) mostAsc = a;
  });
  const wk = {}; r.forEach(a => { const w = weekKey(a.date); wk[w] = (wk[w] || 0) + (a.distance || 0); });
  let bestWeek = null; Object.entries(wk).forEach(([w, km]) => { if (!bestWeek || km > bestWeek.km) bestWeek = { w, km }; });
  return { longest, fastest, mostAsc, bestWeek };
}

/** Correlació entre el volum de 4 setmanes i l'eficiència de les 4 següents (v1: loadResponse). */
export function loadResponse(ctx) {
  const { acts, now } = ctx;
  const es = efficiencySeries(ctx, 10, 28); if (es.length < 6) return null;
  const pts = es.map(p => {
    const vol = acts.filter(a => { const d = daysAgo(a.date, now); return d >= p.daysAgo + 28 && d < p.daysAgo + 56; }).reduce((s, a) => s + (a.distance || 0), 0);
    return { x: vol, y: p.index };
  });
  const n = pts.length, mx = pts.reduce((s, p) => s + p.x, 0) / n, my = pts.reduce((s, p) => s + p.y, 0) / n;
  let num = 0, dx = 0, dy = 0; pts.forEach(p => { num += (p.x - mx) * (p.y - my); dx += (p.x - mx) ** 2; dy += (p.y - my) ** 2; });
  if (dx <= 0 || dy <= 0) return null;
  return { r: Math.round(num / Math.sqrt(dx * dy) * 100) / 100, n };
}

/** Informe dels últims 28 dies contra els 28 anteriors (v1: blockReport). */
export function blockReport(ctx) {
  const { acts, now } = ctx;
  const win = (f, t) => acts.filter(a => { const d = daysAgo(a.date, now); return d >= f && d < t; });
  const cur = win(0, 28), prev = win(28, 56); if (cur.length < 4) return null;
  const km = xs => Math.round(xs.reduce((s, a) => s + (a.distance || 0), 0));
  const e1 = aerobicEfficiency(ctx, 0, 28), e0 = aerobicEfficiency(ctx, 28, 28);
  const zd = getZoneDist(ctx, 28), dur = durabilityTrend(ctx);
  const concl = [];
  const easy = zd ? zd.pct[0] + zd.pct[1] : null;
  if (easy !== null) concl.push(easy >= 75 ? "Polarització correcta (" + easy + "% fàcil)." : "Massa intensitat: només " + easy + "% en Z1-Z2 — torna al 80/20.");
  if (e1 && e0) {
    const d = Math.round((e1.index - e0.index) / e0.index * 1000) / 10;
    concl.push(d > 1.5 ? "Eficiència aeròbica +" + d + "%: la base creix." : d < -1.5 ? "Eficiència " + d + "%: revisa fatiga, calor o excés d'intensitat." : "Eficiència estable — normal; la millora aeròbica és lenta.");
  }
  if (dur && dur.prev) concl.push(dur.rec.avg < dur.prev.avg ? "Durabilitat millorant (menys deriva a les llargues)." : "Durabilitat sense millora: allarga progressivament la tirada llarga.");
  return { km1: km(cur), km0: km(prev), n1: cur.length, easy, concl };
}

/** Patró habitual: dies per setmana, volum i distàncies típiques (v1: analyzeHistory). */
export function analyzeHistory({ acts, now }) {
  const r = acts.filter(a => daysAgo(a.date, now) <= 730 && a.distance);
  if (r.length < 8) return null;
  const weeks = {}; r.forEach(a => { weeks[weekKey(a.date)] = true; });
  const nWeeks = Math.max(1, Object.keys(weeks).length);
  const dayFreq = { dl: 0, dt: 0, dc: 0, dj: 0, dv: 0, ds: 0, dg: 0 };
  r.forEach(a => { dayFreq[DOW[new Date(a.date).getDay()]]++; });
  const perWeekDays = {};
  r.forEach(a => { const w = weekKey(a.date); (perWeekDays[w] = perWeekDays[w] || new Set()).add(DOW[new Date(a.date).getDay()]); });
  const avgDays = Math.round(Object.values(perWeekDays).reduce((s, set) => s + set.size, 0) / nWeeks);
  const wV = {}; r.forEach(a => { wV[weekKey(a.date)] = (wV[weekKey(a.date)] || 0) + (a.distance || 0); });
  const vols = Object.values(wV); const avgVol = vols.reduce((s, v) => s + v, 0) / vols.length;
  const durs = r.filter(a => a.duration).map(a => a.duration).sort((x, y) => x - y);
  const dists = r.filter(a => a.distance).map(a => a.distance).sort((x, y) => x - y);
  const pctl = (arr, p) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0;
  const rankedDays = Object.entries(dayFreq).sort((a, b) => b[1] - a[1]).slice(0, Math.max(3, Math.min(6, avgDays))).map(e => e[0]);
  return {
    nWeeks, avgDays: Math.max(3, Math.min(6, avgDays)), avgVol: Math.round(avgVol),
    longKm: Math.round(pctl(dists, 0.9)), easyKm: Math.round(pctl(dists, 0.45)),
    longDur: Math.round(pctl(durs, 0.9)), easyDur: Math.round(pctl(durs, 0.45)),
    chosenDays: DOW_ORDER.filter(d => rankedDays.includes(d)), dayFreq, total: r.length,
  };
}
