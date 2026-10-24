// RunTracker v2 — quan toca força i amb quin context. Funcions pures.

import { dateStr, weekKey, daysAgo } from "./dates.js";
import { calcFF, ffNow, calcACWR } from "./load.js";
import { strengthLoad } from "./strength.js";

export const DOW_NAMES = ["diumenge", "dilluns", "dimarts", "dimecres", "dijous", "divendres", "dissabte"];
export const DEFAULT_DAYS = { A: 1, B: 4 }; // dilluns i dijous

/** Dies de força del Perfil, amb els per defecte. */
export const strengthDays = settings => ({ A: settings?.strengthDays?.A ?? DEFAULT_DAYS.A, B: settings?.strengthDays?.B ?? DEFAULT_DAYS.B });

/**
 * Setmanes seguides, fins a la setmana passada, amb almenys `min` sortides.
 * La setmana en curs compta si ja hi arriba (així no es perd un dilluns).
 */
export function regularWeeks(acts, now, min = 2) {
  const per = {};
  for (const a of acts) { const k = weekKey(a.date); per[k] = (per[k] || 0) + 1; }
  const cur = weekKey(dateStr(new Date(now)));
  let n = (per[cur] || 0) >= min ? 1 : 0;
  const d = new Date(cur + "T12:00:00");
  for (let i = 0; i < 520; i++) {
    d.setDate(d.getDate() - 7);
    if ((per[dateStr(d)] || 0) >= min) n++; else break;
  }
  return n;
}

/** Dia de la setmana habitual de la llarga: el més repetit de la sortida més llarga de cada setmana (8 setmanes). */
export function longRunDow(acts, now, weeks = 8) {
  const best = {};
  for (const a of acts) {
    if (!a.distance || daysAgo(a.date, now) > weeks * 7) continue;
    const k = weekKey(a.date);
    if (!best[k] || a.distance > best[k].distance) best[k] = a;
  }
  const count = {};
  for (const a of Object.values(best)) { const d = new Date(a.date + "T12:00:00").getDay(); count[d] = (count[d] || 0) + 1; }
  const top = Object.entries(count).sort((x, y) => y[1] - x[1])[0];
  return top && top[1] >= Math.ceil(Object.keys(best).length / 2) ? +top[0] : null;
}

/**
 * Tipus de sortida per puntuar el clima d'un dia, segons els teus hàbits:
 * el dia habitual de la llarga és "long"; la resta, "easy". Es pot canviar a mà.
 */
export function runTypeFor(acts, now, dayMs) {
  const lr = longRunDow(acts, now);
  return lr !== null && new Date(dayMs).getDay() === lr ? "long" : "easy";
}

/** Càrrega de força per dia, per sumar-la a la forma (CTL/ATL). */
export function strengthDaily(sessions) {
  const out = {};
  for (const s of sessions || []) out[s.date] = (out[s.date] || 0) + (s.load ?? strengthLoad(s.minutes, s.rpe));
  return out;
}

/** Context per planificar la sessió: TSB i ACWR de les curses, setmanes regulars i si demà és la llarga. */
export function strengthContext({ acts, now, sessions = [] }) {
  const ff = calcFF({ acts, now, extraDaily: strengthDaily(sessions) });
  const fn = ffNow(ff);
  const lr = longRunDow(acts, now);
  const tomorrow = new Date(now + 864e5).getDay();
  return {
    tsb: fn ? Math.round(fn.tsb) : null,
    acwr: calcACWR({ acts, now }),
    regularWeeks: regularWeeks(acts, now),
    dayBeforeLong: lr !== null && lr === tomorrow,
    longRunDow: lr,
  };
}

/**
 * Quina sessió toca: la del dia si avui és dia A o B; si avui ja n'has fet una, l'altra;
 * si no, la que fa més temps que no fas.
 * @returns {{type:'A'|'B', due:boolean, doneToday:object|null}}
 */
export function nextSession(sessions, settings, now) {
  const today = dateStr(new Date(now));
  const days = strengthDays(settings);
  const sorted = [...(sessions || [])].sort((a, b) => b.date.localeCompare(a.date) || (b.savedAt || 0) - (a.savedAt || 0));
  const doneToday = sorted.find(s => s.date === today) || null;
  if (doneToday) return { type: doneToday.type === "A" ? "B" : "A", due: false, doneToday };
  const dow = new Date(now).getDay();
  if (dow === days.A) return { type: "A", due: true, doneToday: null };
  if (dow === days.B) return { type: "B", due: true, doneToday: null };
  const lastA = sorted.find(s => s.type === "A"), lastB = sorted.find(s => s.type === "B");
  const type = !lastA ? "A" : !lastB ? "B" : lastA.date > lastB.date ? "B" : "A";
  return { type, due: false, doneToday: null };
}
