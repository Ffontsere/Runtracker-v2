// RunTracker v2 — fisiologia: zones (Seiler), VO₂max, eficiència aeròbica, deriva i condicions.
// Port fidel de la v1 (v47). ctx = { acts, settings, now, tempCache, streamCache }.

import { daysAgo } from "./dates.js";

// ═══ Condicions de cada sortida ═══

/** {t, dp, elev, w} d'una activitat: temperatura manual o la d'Open-Meteo guardada (v1: actWx). */
export function actWx(a, tempCache = {}) {
  if (typeof a.tempManual === "number") return { t: a.tempManual, dp: null, elev: (a.altManual != null ? a.altManual : null) };
  const c = tempCache[a.id];
  if (c !== undefined && c !== null) {
    if (typeof c === "number") return { t: c, dp: null, elev: null };
    return c;
  }
  return null;
}

/** % de ritme perdut per calor i humitat, model temp + punt de rosada en °F (v1: heatPaceAdjPct). */
export function heatPaceAdjPct(tempC, dewC) {
  if (typeof tempC !== "number") return 0;
  const tF = tempC * 9 / 5 + 32;
  const dF = (typeof dewC === "number") ? dewC * 9 / 5 + 32 : tF - 8;
  const s = tF + dF;
  if (s <= 100) return 0;
  if (s <= 110) return 0.25; if (s <= 120) return 0.75; if (s <= 130) return 1.5;
  if (s <= 140) return 2.5; if (s <= 150) return 3.75; if (s <= 160) return 5.25;
  if (s <= 170) return 7.0; if (s <= 180) return 9.0; return 11.0;
}

/** Ritme equivalent en pla i fresc (v1: correctedPace). */
export function correctedPace(pace, ascent, distance, wx) {
  let p = pace;
  if (ascent && distance && distance > 0) {
    const grad = (ascent / (distance * 1000)) * 100;
    const f = 1 + 0.015 * Math.min(grad, 20);
    if (f > 0) p = pace / f;
  }
  const tC = wx && typeof wx.t === "number" ? wx.t : null;
  const dC = wx && typeof wx.dp === "number" ? wx.dp : null;
  const adj = heatPaceAdjPct(tC, dC);
  if (adj > 0) p = p * (1 - adj / 100);
  return p;
}

/** VO₂ equivalent a nivell del mar per sobre de 600 m (v1: altitudeCorrect). */
export function altitudeCorrect(vo2, wx) {
  if (vo2 === null) return null;
  const elev = wx && typeof wx.elev === "number" ? wx.elev : null;
  if (elev !== null && elev > 600) { const lossPct = 6.3 * (elev - 600) / 1000; return vo2 / (1 - lossPct / 100); }
  return vo2;
}

// ═══ Pendent ═══

/** Factor d'esforç per pendent: +3,3 %/1 % pujant, −1,8 %/1 % baixant fins a −10 % (v1: gradeAdjFactor). */
export function gradeAdjFactor(g) {
  if (typeof g !== "number" || !isFinite(g)) return 1;
  const gc = Math.max(-30, Math.min(30, g));
  const f = gc >= 0 ? 1 + 0.033 * gc : 1 + 0.018 * Math.max(gc, -10);
  return Math.max(0.6, f);
}

export function gradeAdjustedVelocity(streams) {
  if (!streams || !streams.velocity_smooth || !streams.velocity_smooth.data) return null;
  const v = streams.velocity_smooth.data;
  const g = streams.grade_smooth && streams.grade_smooth.data;
  if (!g || g.length !== v.length) return { data: v, adj: false };
  return { data: v.map((x, i) => x * gradeAdjFactor(g[i])), adj: true };
}

// ═══ Deriva cardíaca ═══

/** Desacoblament ritme:FC primera meitat contra segona (v1: calcCardiacDrift). */
export function calcCardiacDrift(streams) {
  if (!streams || !streams.heartrate || !streams.velocity_smooth) return null;
  const hr = streams.heartrate.data;
  const gv = gradeAdjustedVelocity(streams);
  const vel = gv ? gv.data : streams.velocity_smooth.data;
  if (!hr || !vel || hr.length < 60) return null;
  const half = Math.floor(hr.length / 2);
  let hr1 = 0, v1 = 0, n1 = 0;
  for (let i = 0; i < half; i++) { if (hr[i] > 0 && vel[i] > 0.5) { hr1 += hr[i]; v1 += vel[i]; n1++; } }
  let hr2 = 0, v2 = 0, n2 = 0;
  for (let i = half; i < hr.length; i++) { if (hr[i] > 0 && vel[i] > 0.5) { hr2 += hr[i]; v2 += vel[i]; n2++; } }
  if (n1 < 10 || n2 < 10) return null;
  const avgHr1 = hr1 / n1, avgHr2 = hr2 / n2, avgV1 = v1 / n1, avgV2 = v2 / n2;
  const ratio1 = avgV1 / avgHr1, ratio2 = avgV2 / avgHr2;
  const decoupling = Math.round((ratio1 - ratio2) / ratio1 * 1000) / 10;
  return {
    drift: Math.round((avgHr2 - avgHr1) * 10) / 10, decoupling,
    hr1: Math.round(avgHr1), hr2: Math.round(avgHr2),
    v1: Math.round(avgV1 * 100) / 100, v2: Math.round(avgV2 * 100) / 100,
    adj: !!(gv && gv.adj),
  };
}

/** Desacoblament mitjà a les llargues: últims 90 dies contra els 90 anteriors (v1: durabilityTrend). */
export function durabilityTrend({ acts, now }) {
  const f = (from, to) => {
    const xs = acts.filter(a => { const d = daysAgo(a.date, now); return d >= from && d < to && typeof a.dec === "number"; });
    return xs.length >= 2 ? { avg: Math.round(xs.reduce((s, a) => s + a.dec, 0) / xs.length * 10) / 10, n: xs.length } : null;
  };
  const rec = f(0, 90), prev = f(90, 180);
  if (!rec) return null; return { rec, prev };
}

// ═══ Zones (Seiler: LT2 = inici de Z4, LT1 = sostre de Z2) ═══

export const karvonen = (mx, r) => [Math.round(r + (mx - r) * .6), Math.round(r + (mx - r) * .7), Math.round(r + (mx - r) * .8), Math.round(r + (mx - r) * .9)];

/** LT1 conservador: 65 % de la FC de reserva (v1: lt1Conservative). */
export function lt1Conservative({ settings }) {
  const mx = settings.hrMax, rest = settings.hrRest;
  if (!mx || !rest) return null;
  return Math.round(rest + 0.65 * (mx - rest));
}

/** LT1 per desacoblament a les sortides llargues amb streams (v1: lt1Decoupling). */
export function lt1Decoupling({ acts, now, streamCache = {} }) {
  const longRuns = acts.filter(a => daysAgo(a.date, now) <= 730 && a.source === "strava" && (a.duration || 0) >= 2700 && streamCache[a.id.replace("strava-", "")]);
  const below = [], above = [];
  longRuns.forEach(a => {
    const d = calcCardiacDrift(streamCache[a.id.replace("strava-", "")]);
    if (!d) return;
    if (d.decoupling < 5) below.push(d.hr2 || d.hr1); else above.push(d.hr1);
  });
  if (!below.length) return null;
  const est = Math.max(...below);
  return { value: Math.round(est), nStable: below.length, nDrift: above.length,
    conf: (below.length >= 3 && above.length >= 1) ? "alta" : (below.length >= 2) ? "mitjana" : "baixa" };
}

/** LT2 del test de camp o estimat dels esforços durs de 20–60 min (v1: lt2Estimate). */
export function lt2Estimate({ acts, settings, now }) {
  if (settings.fieldTestLT2) return { value: settings.fieldTestLT2, src: "test de camp" };
  const efforts = acts.filter(a => daysAgo(a.date, now) <= 730 && a.avgHR && (a.duration || 0) >= 1200 && (a.duration || 0) <= 3600 && (a.hrZone >= 3));
  if (!efforts.length) return null;
  const top = efforts.slice().sort((a, b) => b.avgHR - a.avgHR).slice(0, 3);
  const est = Math.round(top.reduce((s, a) => s + a.avgHR, 0) / top.length);
  return { value: est, src: "estimat d'esforços durs" };
}

/** Zones Seiler amb dues àncores (v1: thresholdZones). */
export function thresholdZones(ctx) {
  const { settings } = ctx;
  const lt2 = lt2Estimate(ctx);
  if (!lt2 || !lt2.value) return null;
  const t = lt2.value, mx = settings.hrMax;
  let lt1src = "manual", lt1 = settings.lt1Manual;
  if (!lt1) { const d = lt1Decoupling(ctx); if (d) { lt1 = d.value; lt1src = "desacoblament"; } }
  if (!lt1) { lt1 = lt1Conservative(ctx); lt1src = "65% FCR"; }
  if (!lt1 || lt1 >= t) { lt1 = Math.round(t * 0.88); lt1src = "88% LT2"; }
  const z1hi = Math.round(lt1 * 0.92);
  const z4hi = Math.min(Math.round(t * 1.06), (mx || Math.round(t * 1.1)) - 1);
  return {
    anchor: "Seiler", lt2: t, lt1, lt1src,
    zones: [
      { z: "Z1", lo: 0, hi: z1hi, name: "Recuperació" },
      { z: "Z2", lo: z1hi, hi: lt1, name: "Fàcil (aeròbic)" },
      { z: "Z3", lo: lt1, hi: t, name: "Tempo / GA" },
      { z: "Z4", lo: t, hi: z4hi, name: "Llindar" },
      { z: "Z5", lo: z4hi, hi: mx || Math.round(t * 1.1), name: "VO₂max" },
    ],
  };
}

/** Límits de zona actius: manuals → Seiler → Karvonen (v1: activeZoneBounds). */
export function activeZoneBounds(ctx) {
  const { settings } = ctx;
  if (settings.zones && settings.zones.length === 4) return settings.zones;
  const tz = thresholdZones(ctx);
  if (tz) return [tz.zones[0].hi, tz.zones[1].hi, tz.zones[2].hi, tz.zones[3].hi];
  return karvonen(settings.hrMax, settings.hrRest);
}

/** Zona 0–4 d'una FC (v1: hZ). Cal passar els límits ja calculats. */
export const hrZone = (hr, bounds) => hr < bounds[0] ? 0 : hr < bounds[1] ? 1 : hr < bounds[2] ? 2 : hr < bounds[3] ? 3 : 4;

/** Minuts a cada zona des dels streams (v1: computeTiZ). */
export function computeTiZ(streams, bounds) {
  if (!streams || !streams.heartrate || !streams.time) return null;
  const hr = streams.heartrate.data, t = streams.time.data;
  if (!hr || !t || hr.length < 90) return null;
  const tiz = [0, 0, 0, 0, 0];
  for (let i = 1; i < hr.length; i++) {
    if (!hr[i]) continue;
    const dt = Math.min(t[i] - t[i - 1], 30);
    const z = hrZone(hr[i], bounds);
    if (z !== null && z >= 0 && z <= 4) tiz[z] += dt;
  }
  const tot = tiz.reduce((s, v) => s + v, 0);
  if (tot < 600) return null;
  return tiz.map(s => Math.round(s / 60 * 10) / 10);
}

/** Distribució del temps per zones en una finestra de dies (v1: getZoneDist). */
export function getZoneDist({ acts, now }, days) {
  // Fidel a la v1: una activitat amb hrZone absent (undefined) hi entra i dona NaN. Vegeu BUGS-v1.md.
  const r = acts.filter(a => daysAgo(a.date, now) <= days && a.hrZone !== null && a.duration);
  const z = [0, 0, 0, 0, 0]; let tot = 0, tizDur = 0, allDur = 0;
  r.forEach(a => {
    if (a.tiz) { a.tiz.forEach((m, i) => { z[i] += m * 60; }); tizDur += a.duration; }
    else z[a.hrZone] += a.duration;
    tot += a.duration; allDur += a.duration;
  });
  if (tot === 0) return null;
  const sum = z.reduce((s, v) => s + v, 0) || 1;
  return { pct: z.map(v => Math.round(v / sum * 100)), tot, coverage: allDur ? Math.round(tizDur / allDur * 100) : 0 };
}

// ═══ VO₂max ═══

/** Cost d'O₂ (Daniels) a v m/min. */
export const o2Cost = vMin => -4.6 + 0.182258 * vMin + 0.000104 * vMin * vMin;
/** Fracció del VO₂max a un %FCmàx (Swain). */
export const swainFrac = r => (r - 0.3727) / 0.6463;

/** VO₂max estimat per ritme i FC de tota l'activitat (v1: estVO2). */
export const estVO2 = (p, hr, mx) => {
  if (!p || !hr || !mx || p <= 0) return null;
  const v = (1000 / p) * 60, vo2 = o2Cost(v), r = hr / mx;
  if (r < .5 || r > 1) return null;
  const pv = swainFrac(r);
  return pv > 0 && pv < 1.1 ? Math.round(vo2 / pv * 10) / 10 : null;
};

/** VDOT de Daniels i Gilbert per a un esforç màxim (v1: vdotFromEffort). */
export function vdotFromEffort(distKm, durSec) {
  if (!distKm || !durSec || distKm <= 0 || durSec <= 0) return null;
  const v = distKm * 1000 / (durSec / 60), tMin = durSec / 60;
  const vo2 = o2Cost(v);
  const pct = 0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);
  if (pct <= 0) return null;
  return Math.round(vo2 / pct * 10) / 10;
}

/** VO₂max per finestres estacionàries dels streams, estil Firstbeat (v1: vo2FromStream). */
export function vo2FromStream(streams, settings) {
  if (!streams || !streams.heartrate || !streams.velocity_smooth || !streams.time) return null;
  const hr = streams.heartrate.data, vel = streams.velocity_smooth.data;
  const grade = streams.grade_smooth && streams.grade_smooth.data;
  const time = streams.time.data;
  const mx = settings.hrMax;
  if (!hr || !vel || !mx || hr.length < 180) return null;
  const drift = calcCardiacDrift(streams);
  const highDrift = drift && typeof drift.decoupling === "number" && drift.decoupling > 7;
  const N = hr.length, WIN = 120, STEP = 30, est = [];
  for (let s = 0; s + WIN <= N; s += STEP) {
    const e = s + WIN;
    if (time && time[s] != null && time[s] < 600) continue;
    if (highDrift && s > N / 2) continue;
    let sumHR = 0, sumHR2 = 0, sumEquiv = 0, cnt = 0, gExtreme = false;
    for (let i = s; i < e; i++) {
      const hv = hr[i], vv = vel[i];
      if (!(hv > 0) || !(vv > 0.8)) continue;
      const g = grade ? grade[i] : 0;
      if (typeof g === "number" && Math.abs(g) > 25) gExtreme = true;
      sumHR += hv; sumHR2 += hv * hv;
      sumEquiv += vv * gradeAdjFactor(typeof g === "number" ? g : 0);
      cnt++;
    }
    if (cnt < WIN * 0.7 || gExtreme) continue;
    const meanHR = sumHR / cnt;
    const sdHR = Math.sqrt(Math.max(0, sumHR2 / cnt - meanHR * meanHR));
    if (sdHR > 6) continue;
    const r = meanHR / mx;
    if (r < 0.70 || r > 0.90) continue;
    const pv = swainFrac(r);
    if (pv <= 0.4) continue;
    const vo2 = o2Cost((sumEquiv / cnt) * 60) / pv;
    if (vo2 > 25 && vo2 < 90) est.push(vo2);
  }
  if (est.length < 3) return null;
  est.sort((a, b) => a - b);
  return { vo2: Math.round(est[Math.floor(est.length / 2)] * 10) / 10, n: est.length };
}

/** VO₂ per FC corregit per pendent, calor i altitud (v1: estVO2corr). */
export function estVO2corr(pace, hr, mx, ascent, distance, wx) {
  const cp = correctedPace(pace, ascent, distance, wx);
  const vo2 = estVO2(cp, hr, mx);
  const c = altitudeCorrect(vo2, wx);
  return c !== null ? Math.round(c * 10) / 10 : null;
}

/**
 * Camps de VO₂ d'una activitat: streams → cursa (VDOT) → FC (v1: recomputeVO2).
 * Retorna { vo2, vo2raw, vo2conf } en lloc de modificar l'activitat.
 */
export function vo2ForActivity(a, settings, tempCache = {}) {
  const wx = actWx(a, tempCache);
  if (typeof a.vo2s === "number" && a.vo2s > 0) {
    const c = altitudeCorrect(a.vo2s, wx);
    return { vo2: c !== null ? Math.round(c * 10) / 10 : a.vo2s, vo2raw: a.vo2s, vo2conf: "stream" };
  }
  if (a.isRace && a.distance && a.duration) {
    const rawV = vdotFromEffort(a.distance, a.duration);
    const cp = correctedPace(a.pace, a.ascent, a.distance, wx);
    let v = vdotFromEffort(a.distance, cp * a.distance);
    v = altitudeCorrect(v, wx);
    return { vo2: v !== null ? Math.round(v * 10) / 10 : null, vo2raw: rawV !== null ? Math.round(rawV * 10) / 10 : null, vo2conf: "race" };
  }
  const rawE = (a.pace && a.avgHR) ? estVO2(a.pace, a.avgHR, settings.hrMax) : null;
  return {
    vo2: estVO2corr(a.pace, a.avgHR, settings.hrMax, a.ascent, a.distance, wx),
    vo2raw: rawE !== null && rawE !== undefined ? Math.round(rawE * 10) / 10 : null,
    vo2conf: "low",
  };
}

/** VO₂max actual: mitjana ponderada per finestres i recència dels últims N dies (v1: currentVO2max). */
export function currentVO2max({ acts, now }, days) {
  const D = days || 42;
  const strm = acts.filter(a => daysAgo(a.date, now) <= D && a.vo2conf === "stream" && a.vo2 > 0);
  const races = acts.filter(a => daysAgo(a.date, now) <= D && a.vo2conf === "race" && a.vo2 > 0);
  if (strm.length) {
    let wsum = 0, vsum = 0;
    strm.forEach(a => {
      const rec = Math.exp(-daysAgo(a.date, now) / 28);
      const w = Math.max(1, (a.vo2n || 3)) * rec;
      wsum += w; vsum += a.vo2 * w;
    });
    const val = vsum / wsum;
    const raceMax = races.length ? Math.max(...races.map(a => a.vo2)) : 0;
    const value = Math.max(val, raceMax);
    return { value: Math.round(value * 10) / 10, conf: "stream", n: strm.length, fromRace: raceMax > val };
  }
  if (races.length) return { value: Math.max(...races.map(a => a.vo2)), conf: "race", n: races.length };
  const any = acts.filter(a => daysAgo(a.date, now) <= D && a.vo2);
  if (!any.length) return null;
  const med = any.map(a => a.vo2).sort((x, y) => x - y);
  return { value: med[Math.floor(med.length / 2)], conf: "low", n: any.length };
}

// ═══ Eficiència aeròbica ═══

/** Metres per minut per batec en rodatges fàcils, amb ritme corregit (v1: aerobicEfficiency). */
export function aerobicEfficiency({ acts, now, tempCache = {} }, fromAgo, windowDays) {
  const to = fromAgo || 0, from = (fromAgo || 0) + (windowDays || 28);
  const easy = acts.filter(a => {
    const d = daysAgo(a.date, now);
    if (!(d >= to && d < from && a.avgHR && a.pace && a.hrZone !== null && a.hrZone !== undefined && a.hrZone <= 1 && (a.duration || 0) >= 1500)) return false;
    if ((a.ascent || 0) / (a.distance || 1) >= 18) return false;
    const wx0 = actWx(a, tempCache); if (wx0 && typeof wx0.w === "number" && wx0.w > 30) return false;
    return true;
  });
  if (easy.length < 2) return null;
  let tot = 0, n = 0, totPace = 0, totHR = 0;
  easy.forEach(a => {
    const cp = correctedPace(a.pace, a.ascent, a.distance, actWx(a, tempCache));
    tot += (1000 / cp * 60) / a.avgHR; n++;
    totPace += cp; totHR += a.avgHR;
  });
  if (!n) return null;
  return { index: Math.round(tot / n * 1000) / 1000, n, avgPace: Math.round(totPace / n), avgHR: Math.round(totHR / n) };
}

export function efficiencyTrend(ctx) {
  const recent = aerobicEfficiency(ctx, 0, 28), prev = aerobicEfficiency(ctx, 28, 28);
  if (!recent) return null;
  if (!prev) return { recent: recent.index, prev: null, pct: null, n: recent.n };
  return { recent: recent.index, prev: prev.index, pct: Math.round((recent.index - prev.index) / prev.index * 1000) / 10, n: recent.n };
}

export function efficiencySeries(ctx, windows, windowDays) {
  const W = windows || 8, WD = windowDays || 28, step = Math.round(WD / 2);
  const out = [];
  for (let i = W - 1; i >= 0; i--) {
    const e = aerobicEfficiency(ctx, i * step, WD);
    if (e) out.push({ daysAgo: i * step, index: e.index, avgPace: e.avgPace, avgHR: e.avgHR, n: e.n });
  }
  return out;
}
