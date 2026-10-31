// RunTracker v2 — TRIMP recomanat per a una sessió fàcil d'avui (BUGS-v1 #5: a la v1 només existia el nom al glossari).
// Funció pura: rep { acts, settings, now, extraDaily? } i retorna dades, sense pantalla.
//
// Idea: un dia fàcil ha de costar una fracció d'una sessió mitjana teva, i aquesta fracció baixa si l'estat d'avui
// diu que vas carregat. El rang es limita perquè l'ACWR de després de la sessió no passi de 1,3.
// Els percentatges són una heurística: viuen aquí, en un sol lloc, perquè es puguin calibrar amb l'historial.

import { dateStr, daysAgo } from "./dates.js";
import { actLoad, calcFF, ffNow, calcACWR, trainingStatus } from "./load.js";
import { activeZoneBounds } from "./physio.js";

/** Fracció de la sessió mitjana [mínim, màxim] segons l'estat d'avui (trainingStatus). */
export const EASY_FRACTION = {
  fresc: [0.7, 1.0],
  assimilant: [0.6, 0.9],
  carregat: [0.5, 0.75],
  sobrecarregat: [0.3, 0.5],
};
/** L'ACWR que no s'hauria de passar després de la sessió. */
export const EASY_ACWR_MAX = 1.3;

const round5 = x => Math.round(x / 5) * 5;

/** TRIMP per minut a una FC (mateixa fórmula que trimpBanister). */
export function trimpPerMin(hr, mx, r) {
  if (!hr || !mx || !r || mx <= r) return null;
  const x = (hr - r) / (mx - r);
  return x > 0 && x < 1 ? 0.64 * x * Math.exp(1.92 * x) : null;
}

/**
 * @returns {null | {
 *   status: string, lo: number, hi: number, minLo: number|null, minHi: number|null, z2hi: number|null,
 *   session: number, capped: boolean, doneToday: number
 * }} null si no hi ha prou historial (menys de 14 dies o CTL < 10).
 */
export function easyTrimp(ctx) {
  const { acts, settings, now } = ctx;
  const ff = calcFF(ctx), fn = ffNow(ff);
  if (ff.length < 14 || !fn || fn.ctl < 10) return null;
  const st = trainingStatus(ctx, { useBodySignals: false });
  if (!st) return null;

  const today = dateStr(new Date(now));
  const doneToday = Math.round(acts.filter(a => a.date === today).reduce((s, a) => s + actLoad(a), 0));

  // Sessió mitjana: càrrega setmanal (CTL × 7) repartida entre els dies que has sortit en les últimes 4 setmanes.
  const runDays = new Set(acts.filter(a => { const d = daysAgo(a.date, now); return d >= 0 && d < 28 && actLoad(a) > 0; }).map(a => a.date));
  const perWeek = Math.max(1, runDays.size / 4);
  const session = fn.ctl * 7 / perWeek;

  const [fLo, fHi] = EASY_FRACTION[st.key];
  let lo = session * fLo, hi = session * fHi, capped = false;

  // Límit d'ACWR: la càrrega més alta que et deixa a 1,3 o menys.
  const acwrWith = x => calcACWR({ acts: [...acts, { id: "__easy", date: today, trimp: x }], now });
  const a0 = acwrWith(0);
  if (a0 != null && a0 > EASY_ACWR_MAX) { hi = 0; capped = true; }
  else if (a0 != null) {
    const aHi = acwrWith(hi);
    if (aHi != null && aHi > EASY_ACWR_MAX) {
      let l = 0, h = hi;
      for (let i = 0; i < 24; i++) { const m = (l + h) / 2; (acwrWith(m) > EASY_ACWR_MAX ? (h = m) : (l = m)); }
      hi = l; capped = true;
    }
  }
  lo = Math.min(lo, hi);

  // Minuts: TRIMP per minut a la meitat de la teva Z2.
  let minLo = null, minHi = null, z2hi = null;
  const b = settings.hrMax && settings.hrRest ? activeZoneBounds(ctx) : null;
  if (b) {
    z2hi = b[1];
    const rate = trimpPerMin((b[0] + b[1]) / 2, settings.hrMax, settings.hrRest);
    if (rate) { minLo = round5(lo / rate); minHi = round5(hi / rate); }
  }
  return { status: st.key, lo: round5(lo), hi: round5(hi), minLo, minHi, z2hi, session: Math.round(session), capped, doneToday };
}
