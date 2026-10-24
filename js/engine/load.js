// RunTracker v2 — càrrega d'entrenament: TRIMP, CTL/ATL/TSB, ACWR, monotonia, projecció i recuperació.
// Port fidel de la v1 (v47). Cada funció rep { acts, settings, now } en lloc de llegir globals.
// Les diferències de comportament que s'hagin de corregir es fan després, de manera explícita.

import { dateStr, daysAgo, weekLabel } from "./dates.js";

/** Càrrega d'una activitat: TRIMP, o 5 per km si no en té (v1). */
export const actLoad = a => a.trimp || (a.distance || 0) * 5;

/** TRIMP de Banister amb la FC mitjana (v1: cTR). dm = minuts. */
export const trimpBanister = (dm, hr, mx, r) => {
  if (!dm || !hr || !mx || !r) return null;
  const x = (hr - r) / (mx - r);
  return x > 0 && x < 1 ? Math.round(dm * x * .64 * Math.exp(1.92 * x)) : null;
};

/** TRIMP integrat mostra a mostra des dels streams de FC (v1: trimpFromStream). */
export function trimpFromStream(streams, settings) {
  if (!streams || !streams.heartrate || !streams.time) return null;
  const hr = streams.heartrate.data, t = streams.time.data;
  if (!hr || !t || hr.length < 90) return null;
  const mx = settings.hrMax, r = settings.hrRest;
  if (!mx || !r || mx <= r) return null;
  let tr = 0, tot = 0;
  for (let i = 1; i < hr.length; i++) {
    if (!hr[i]) continue;
    const dt = Math.min(t[i] - t[i - 1], 30);
    const x = Math.min((hr[i] - r) / (mx - r), 1);
    if (x > 0) tr += (dt / 60) * x * 0.64 * Math.exp(1.92 * x);
    tot += dt;
  }
  if (tot < 600) return null;
  return Math.round(tr);
}

/** TRIMP a partir dels minuts per zona (v1: trimpFromTiZ). */
export function trimpFromTiZ(tiz) {
  if (!tiz) return null;
  const hrr = [0.45, 0.6, 0.73, 0.85, 0.95];
  let t = 0; tiz.forEach((m, i) => { t += m * hrr[i] * 0.64 * Math.exp(1.92 * hrr[i]); });
  return Math.round(t);
}

/**
 * Fitness, fatiga i forma dia a dia, des de la primera activitat fins avui inclòs (v1: calcFF).
 * `extraDaily` permet sumar-hi càrrega que no ve de les curses (força), per data.
 */
export function calcFF({ acts, now, extraDaily = null }) {
  if (!acts.length && !extraDaily) return [];
  const sorted = [...acts].sort((a, b) => a.date.localeCompare(b.date));
  const daily = {};
  sorted.forEach(a => { daily[a.date] = (daily[a.date] || 0) + actLoad(a); });
  let first = sorted.length ? sorted[0].date : null;
  if (extraDaily) for (const [d, v] of Object.entries(extraDaily)) {
    daily[d] = (daily[d] || 0) + v;
    if (!first || d < first) first = d;
  }
  if (!first) return [];
  const todayStr = dateStr(new Date(now));
  let cur = new Date(first + "T12:00:00");
  let ctl = 0, atl = 0; const data = [];
  let guard = 0;
  while (guard++ < 20000) {
    const ds = dateStr(cur);
    const tr = daily[ds] || 0;
    ctl = ctl * (1 - 1 / 42) + tr / 42; atl = atl * (1 - 1 / 7) + tr / 7;
    data.push({ date: ds, label: weekLabel(ds), ctl: Math.round(ctl * 10) / 10, atl: Math.round(atl * 10) / 10, tsb: Math.round((ctl - atl) * 10) / 10 });
    if (ds >= todayStr) break;
    cur.setDate(cur.getDate() + 1);
  }
  return data;
}

/** Estat "d'avui" amb el CTL/ATL de final d'ahir, convenció TrainingPeaks (v1: ffNow). */
export const ffNow = ff => ff.length > 1 ? ff[ff.length - 2] : (ff.length ? ff[ff.length - 1] : null);

/** ACWR per EWMA (Williams) sobre 70 dies (v1: calcACWR). */
export function calcACWR({ acts, now }) {
  const D = 70, daily = new Array(D).fill(0);
  acts.forEach(a => { const d = daysAgo(a.date, now); if (d >= 0 && d < D) daily[d] += actLoad(a); });
  const la = 2 / 8, lc = 2 / 29; let ac = 0, cr = 0;
  for (let i = D - 1; i >= 0; i--) { ac = daily[i] * la + ac * (1 - la); cr = daily[i] * lc + cr * (1 - lc); }
  return cr > 0.5 ? Math.round(ac / cr * 100) / 100 : null;
}

/** Monotonia i strain de Foster sobre 28 dies (v1: calcMonotony). */
export function calcMonotony({ acts, now }) {
  const r28 = acts.filter(a => daysAgo(a.date, now) <= 28);
  if (r28.length < 5) return null;
  const daily = {};
  for (let i = 0; i < 28; i++) { const d = new Date(now); d.setDate(d.getDate() - i); daily[dateStr(d)] = 0; }
  r28.forEach(a => { daily[a.date] = (daily[a.date] || 0) + actLoad(a); });
  const loads = Object.values(daily);
  const mean = loads.reduce((s, v) => s + v, 0) / loads.length;
  const std = Math.sqrt(loads.reduce((s, v) => s + (v - mean) ** 2, 0) / loads.length);
  const monotony = std > 0 ? Math.round(mean / std * 100) / 100 : 0;
  const weeklyLoad = loads.slice(0, 7).reduce((s, v) => s + v, 0);
  const strain = Math.round(weeklyLoad * monotony);
  return { monotony, strain, mean: Math.round(mean) };
}

/** Projecta CTL/ATL/TSB N dies amb una càrrega diària constant (v1: projectFitness). */
export function projectFitness(ff, days, dailyLoad) {
  if (!ff.length) return [];
  let ctl = ff[ff.length - 1].ctl, atl = ff[ff.length - 1].atl;
  const out = [];
  for (let i = 1; i <= days; i++) {
    ctl = ctl * (1 - 1 / 42) + dailyLoad / 42; atl = atl * (1 - 1 / 7) + dailyLoad / 7;
    out.push({ day: i, ctl: Math.round(ctl * 10) / 10, atl: Math.round(atl * 10) / 10, tsb: Math.round((ctl - atl) * 10) / 10 });
  }
  return out;
}

/** Hores de recuperació estimades des de l'últim dia d'entrenament (v1: estRecovery). */
export function estRecovery({ acts, now }) {
  const recent = acts.filter(a => daysAgo(a.date, now) <= 3)
    .sort((a, b) => (b.startTime || b.date + "T12:00").localeCompare(a.startTime || a.date + "T12:00"));
  if (!recent.length) return null;
  const day = recent[0].date;
  const sameDay = recent.filter(a => a.date === day);
  const tr = sameDay.reduce((sm, a) => sm + actLoad(a), 0);
  const total = Math.min(72, Math.round(tr * 0.5));
  const last = sameDay[0];
  const startMs = last.startTime ? new Date(last.startTime).getTime() : new Date(last.date + "T12:00:00").getTime();
  const elapsed = Math.max(0, (now - startMs) / 3600000);
  const remaining = Math.max(0, Math.round(total - elapsed));
  return { total, elapsed: Math.round(elapsed), remaining, approx: !last.startTime, dayTrimp: Math.round(tr) };
}

/** Estat d'entrenament per tendència del CTL (v1: getStatus). Retorna una clau, no colors. */
export function getStatus({ acts, now }, ff) {
  if (ff.length < 14) return { key: "insuficient", s: "Insuficient", d: "Mínim 2 setmanes de dades" };
  const l = ffNow(ff), p = ff[Math.max(0, ff.length - 29)], t = l.ctl - p.ctl;
  const r7 = acts.filter(a => daysAgo(a.date, now) <= 7);
  if (r7.length === 0 && l.atl < 5) return { key: "desentrenament", s: "Desentrenament", d: "Sense activitat recent" };
  if (l.tsb > 15 && l.ctl > 20) return { key: "peaking", s: "Peaking", d: "Fresc i en forma!" };
  if (l.tsb < -20) return { key: "sobrecarregat", s: "Sobrecarregat", d: "Fatiga alta. Descansa." };
  if (t > 1) return { key: "productiu", s: "Productiu", d: "Fitness pujant!" };
  if (Math.abs(t) <= 1 && l.ctl > 10) return { key: "manteniment", s: "Manteniment", d: "Fitness estable." };
  if (t < -1) return { key: "recuperacio", s: "Recuperació", d: "Cos recuperant-se." };
  return { key: "base", s: "Base", d: "Construint base." };
}

/** Mitjana de la FC en repòs: últims 7 registres contra els 33 anteriors (v1: hrRestStatus). */
export function hrRestStatus({ settings }) {
  const lg = (settings.hrRestLog || []).slice().sort((a, b) => a.d.localeCompare(b.d));
  if (lg.length < 10) return null;
  const last7 = lg.slice(-7), base = lg.slice(-40, -7);
  if (base.length < 10) return null;
  const a7 = last7.reduce((s, e) => s + e.v, 0) / last7.length;
  const b = base.reduce((s, e) => s + e.v, 0) / base.length;
  return { a7: Math.round(a7 * 10) / 10, base: Math.round(b * 10) / 10, diff: Math.round((a7 - b) * 10) / 10 };
}

/** RPE de les sessions fàcils: últims 28 dies contra els 28 anteriors (v1: rpeTrend). */
export function rpeTrend({ acts, now }) {
  const f = (from, to) => {
    const xs = acts.filter(a => { const d = daysAgo(a.date, now); return d >= from && d < to && a.rpe && a.hrZone !== null && a.hrZone <= 1; });
    return xs.length >= 3 ? { avg: Math.round(xs.reduce((s, a) => s + a.rpe, 0) / xs.length * 10) / 10, n: xs.length } : null;
  };
  const rec = f(0, 28), prev = f(28, 56);
  if (!rec) return null; return { rec, prev, delta: prev ? Math.round((rec.avg - prev.avg) * 10) / 10 : null };
}

/**
 * Estat d'avui a partir del TSB i l'ACWR (v1: trainingStatus).
 * `useBodySignals` = false treu la FC en repòs i l'RPE, com has decidit a l'inventari.
 */
export function trainingStatus(ctx, { useBodySignals = true } = {}) {
  const ff = calcFF(ctx); if (!ff.length) return null;
  const fn = ffNow(ff); if (!fn) return null;
  const tsb = Math.round(fn.tsb);
  const acwr = calcACWR(ctx);
  const hrs = useBodySignals ? hrRestStatus(ctx) : null, rpt = useBodySignals ? rpeTrend(ctx) : null;
  const hrWarn = !!(hrs && hrs.diff >= 5), rpeWarn = !!(rpt && rpt.delta !== null && rpt.delta >= 1);
  let key;
  if ((acwr && acwr > 1.45) || tsb < -25 || ((acwr && acwr > 1.3) && (hrWarn || rpeWarn))) key = "sobrecarregat";
  else if (tsb < -10 || (acwr && acwr > 1.25) || hrWarn || rpeWarn) key = "carregat";
  else if (tsb > 5) key = "fresc";
  else key = "assimilant";
  const label = { sobrecarregat: "Sobrecarregat", carregat: "Carregat", fresc: "Fresc", assimilant: "Assimilant" }[key];
  let phrase = "TSB " + tsb + (acwr ? " · ACWR " + acwr : "") + " — ";
  if (key === "sobrecarregat") phrase += "el cos va per darrere de la càrrega: toca descàrrega o descans actiu.";
  else if (key === "carregat") phrase += "fatiga acumulada normal dins d'un bloc de càrrega: avui, fàcil de debò.";
  else if (key === "assimilant") phrase += "assimiles bé la càrrega: pots seguir el pla tal com està.";
  else phrase += "estàs fresc: bon dia per a la sessió de qualitat.";
  return { key, label, phrase, tsb, acwr, hrWarn, rpeWarn, hrDiff: hrs ? hrs.diff : null, rpeDelta: rpt ? rpt.delta : null };
}
