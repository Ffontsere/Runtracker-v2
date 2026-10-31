// RunTracker v2 — senyals de recuperació de Garmin: HRV, FC en repòs, son, Body Battery i disposició.
// Funció pura. NO canvia l'estat d'entrenament (trainingStatus): és una lectura a part, com es va decidir a l'inventari.
// Els llindars són una heurística i viuen aquí, a dalt, per poder-los calibrar amb el teu historial.

import { dateStr, daysAgo } from "./dates.js";

export const WELLNESS = {
  baselineDays: 28,       // finestra de la teva línia base (sense comptar avui)
  minForBaseline: 7,      // dies mínims perquè la base valgui
  hrvLowSd: 1,            // HRV per sota de la base en aquestes desviacions → "baixa" (2 → "molt baixa")
  hrvLowPct: 0.07,        // si encara no hi ha prou dies per a la desviació: 7 % per sota de la base
  rhrHigh: 4,             // bpm per sobre de la base → "alta"
  sleepShortSec: 6 * 3600,
  sleepLowScore: 60,
  staleDays: 2,           // si l'última dada és de fa més dies, es diu que és vella
};

/** Nivells de disposició que dona Garmin (en anglès). Els desconeguts no es mostren. */
const READINESS_CA = { LOW: "baixa", MODERATE: "moderada", HIGH: "alta", PRIME: "òptima" };

const avg = xs => xs.reduce((s, v) => s + v, 0) / xs.length;
const sd = xs => { const m = avg(xs); return Math.sqrt(avg(xs.map(v => (v - m) ** 2))); };

/** Base d'un camp: mitjana dels `baselineDays` dies anteriors a `day` que en tenen. */
export function baseline(days, field, day, now) {
  const xs = Object.entries(days)
    .filter(([d, v]) => d < day && daysAgo(d, now) <= WELLNESS.baselineDays + daysAgo(day, now) && typeof v[field] === "number")
    .map(([, v]) => v[field]);
  if (xs.length < WELLNESS.minForBaseline) return null;
  return { mean: avg(xs), sd: xs.length >= 14 ? sd(xs) : null, n: xs.length };
}

const TONE_RANK = { ok: 0, warn: 1, bad: 2 };

/**
 * @param {{ days: Record<string, object> }} wellness  el que desa js/data/garmin.js
 * @returns {null | { date, ageDays, stale, signals: Array, tone: "ok"|"warn"|"bad", raw: object }}
 *   null si no hi ha cap dia amb dades.
 */
export function wellnessSummary(wellness, now) {
  const days = wellness && wellness.days;
  if (!days) return null;
  const today = dateStr(new Date(now));
  const dates = Object.keys(days).filter(d => d <= today && Object.keys(days[d] || {}).length).sort();
  if (!dates.length) return null;
  const date = dates[dates.length - 1], v = days[date], ageDays = daysAgo(date, now);
  const stale = ageDays > WELLNESS.staleDays;
  const signals = [];

  if (typeof v.hrvLast === "number") {
    const b = baseline(days, "hrvLast", date, now);
    let tone = "ok", level = null;
    if (b) {
      const diff = v.hrvLast - b.mean;
      const low = b.sd ? diff < -WELLNESS.hrvLowSd * b.sd : diff < -WELLNESS.hrvLowPct * b.mean;
      const veryLow = b.sd ? diff < -2 * b.sd : diff < -2 * WELLNESS.hrvLowPct * b.mean;
      tone = veryLow ? "bad" : low ? "warn" : "ok";
      level = veryLow ? "molt baixa" : low ? "baixa" : diff > 0 ? "per sobre" : "normal";
    }
    signals.push({ key: "hrv", label: "HRV", value: v.hrvLast, unit: "ms", base: b ? Math.round(b.mean) : null, level, tone, garminStatus: v.hrvStatus || null });
  }
  if (typeof v.rhr === "number") {
    const b = baseline(days, "rhr", date, now);
    const diff = b ? v.rhr - b.mean : null;
    const tone = diff != null && diff >= 2 * WELLNESS.rhrHigh ? "bad" : diff != null && diff >= WELLNESS.rhrHigh ? "warn" : "ok";
    signals.push({ key: "rhr", label: "FC en repòs", value: v.rhr, unit: "ppm", base: b ? Math.round(b.mean) : null, level: diff == null ? null : diff >= WELLNESS.rhrHigh ? "alta" : "normal", tone });
  }
  if (typeof v.sleepSec === "number") {
    const short = v.sleepSec < WELLNESS.sleepShortSec;
    const lowScore = typeof v.sleepScore === "number" && v.sleepScore < WELLNESS.sleepLowScore;
    signals.push({ key: "sleep", label: "Son", value: v.sleepSec, unit: "s", score: v.sleepScore ?? null, level: short ? "curt" : lowScore ? "de mala qualitat" : "normal", tone: short && lowScore ? "bad" : short || lowScore ? "warn" : "ok" });
  }
  if (typeof v.bbWake === "number") signals.push({ key: "bb", label: "Body Battery en despertar", value: v.bbWake, unit: "", level: null, tone: "ok" });
  if (typeof v.readiness === "number") signals.push({ key: "readiness", label: "Disposició (Garmin)", value: v.readiness, unit: "", level: READINESS_CA[String(v.readinessLevel || "").toUpperCase()] || null, tone: "ok" });

  // Dues senyals en vermell o groc alhora pesen més que una de sola.
  const warns = signals.filter(s => s.tone !== "ok");
  const tone = warns.some(s => s.tone === "bad") || warns.length >= 2 ? "bad" : warns.length === 1 ? "warn" : "ok";
  return { date, ageDays, stale, signals, tone, raw: v };
}

/** Una frase per a la targeta. */
export function wellnessAdvice(s) {
  if (!s || !s.signals.length) return "";
  const bad = s.signals.filter(x => x.tone !== "ok").map(x => x.key);
  const names = { hrv: "l'HRV", rhr: "la FC en repòs", sleep: "el son" };
  const list = bad.map(k => names[k]).filter(Boolean);
  if (!list.length) return "Les senyals estan dins del teu normal.";
  const txt = list.length === 1 ? list[0] : list.slice(0, -1).join(", ") + " i " + list.at(-1);
  const first = txt.charAt(0).toUpperCase() + txt.slice(1);
  return s.tone === "bad"
    ? `${first} no acompanyen: avui, fàcil de debò o descans.`
    : `${first} s'allunya del teu habitual: vigila com et trobes abans d'apujar la intensitat.`;
}
