// RunTracker v2 — motor de composició corporal.
// Funcions pures. Mesures en cm i kg. Les dates són cadenes 'AAAA-MM-DD'.

const DAY = 864e5;
const t = d => Date.parse(d + "T00:00:00Z");
const round = (v, n = 1) => (v == null || !isFinite(v)) ? null : Math.round(v * 10 ** n) / 10 ** n;

/**
 * % de greix pel mètode de la Marina dels EUA (fórmula en cm).
 * Homes: cintura al melic i coll. Dones: també cal el maluc.
 */
export function navyBodyFat({ waist, neck, height, hip = null, sex = "male" }) {
  if (!(waist > 0 && neck > 0 && height > 0)) return null;
  if (sex === "female") {
    if (!(hip > 0) || waist + hip - neck <= 0) return null;
    return round(495 / (1.29579 - 0.35004 * Math.log10(waist + hip - neck) + 0.22100 * Math.log10(height)) - 450);
  }
  if (waist - neck <= 0) return null;
  return round(495 / (1.0324 - 0.19077 * Math.log10(waist - neck) + 0.15456 * Math.log10(height)) - 450);
}

export const waistToHeight = (waist, height) => (waist > 0 && height > 0) ? round(waist / height, 2) : null;
export const waistToHip = (waist, hip) => (waist > 0 && hip > 0) ? round(waist / hip, 2) : null;
export const leanMass = (weight, bodyFatPct) => (weight > 0 && bodyFatPct >= 0) ? round(weight * (1 - bodyFatPct / 100)) : null;

/** Lectura de cada índex, amb els llindars per a homes. */
export function readWaistHeight(r) {
  if (r == null) return null;
  return r < 0.5 ? { level: "ok", text: "Saludable (< 0,5)" } : r < 0.6 ? { level: "warn", text: "Risc augmentat (0,5–0,6)" } : { level: "bad", text: "Risc alt (≥ 0,6)" };
}
export function readWaistHip(r, sex = "male") {
  if (r == null) return null;
  const lim = sex === "female" ? 0.85 : 0.90;
  return r < lim ? { level: "ok", text: `Saludable (< ${String(lim).replace(".", ",")})` } : { level: "warn", text: `Risc augmentat (≥ ${String(lim).replace(".", ",")})` };
}

/** Darrer valor d'un camp en entrades ordenables per data. */
export function latest(entries, field, beforeOrOn = null) {
  const rows = entries.filter(e => e[field] != null && (!beforeOrOn || t(e.date) <= t(beforeOrOn)))
    .sort((a, b) => t(a.date) - t(b.date));
  return rows.length ? rows.at(-1) : null;
}

/** Mitjana del pes als `days` dies que acaben a `ref` (inclòs). */
export function weightAverage(entries, ref, days = 7) {
  const end = t(ref), start = end - (days - 1) * DAY;
  const w = entries.filter(e => e.weight > 0 && t(e.date) >= start && t(e.date) <= end).map(e => e.weight);
  return w.length ? { avg: round(w.reduce((s, x) => s + x, 0) / w.length), n: w.length } : null;
}

/**
 * Tendència del pes: diferència entre la mitjana de 7 dies d'ara i la de fa `weeks` setmanes.
 * Retorna kg totals i kg per setmana. Null si no hi ha prou dades als dos extrems.
 */
export function weightTrend(entries, ref, weeks = 4) {
  const now = weightAverage(entries, ref, 7);
  const thenRef = new Date(t(ref) - weeks * 7 * DAY).toISOString().slice(0, 10);
  const then = weightAverage(entries, thenRef, 7);
  if (!now || !then) return null;
  const delta = round(now.avg - then.avg);
  return { delta, perWeek: round(delta / weeks, 2), from: then.avg, to: now.avg };
}

/** Objectiu de proteïna diari (g) a partir del pes: 1,6 g/kg, rang 1,4–1,8. */
export function proteinTarget(weight) {
  if (!(weight > 0)) return null;
  return { g: Math.round(weight * 1.6), lo: Math.round(weight * 1.4), hi: Math.round(weight * 1.8) };
}

/**
 * Senyal de possible pèrdua de múscul: el pes baixa clarament però la cintura no.
 * Compara la primera i l'última cintura dins la finestra, amb la tendència del pes.
 */
export function muscleLossSignal(entries, ref, weeks = 4) {
  const trend = weightTrend(entries, ref, weeks);
  if (!trend || trend.delta > -0.8) return null;
  const startD = t(ref) - weeks * 7 * DAY;
  const ws = entries.filter(e => e.waist > 0 && t(e.date) >= startD - 7 * DAY && t(e.date) <= t(ref))
    .sort((a, b) => t(a.date) - t(b.date));
  if (ws.length < 2 || t(ws.at(-1).date) - t(ws[0].date) < 14 * DAY) return null;
  const dWaist = round(ws.at(-1).waist - ws[0].waist);
  if (dWaist > -0.5) {
    return { weightDelta: trend.delta, waistDelta: dWaist,
      text: `El pes ha baixat ${String(Math.abs(trend.delta)).replace(".", ",")} kg en ${weeks} setmanes però la cintura no: pot ser pèrdua de múscul o d'aigua. Revisa la proteïna i l'energia.` };
  }
  return null;
}

/** Resum complet del cos per a la pantalla, a partir de les entrades i el perfil. */
export function bodySummary(entries, { height, sex = "male" }, ref) {
  const w = latest(entries, "weight", ref), wa = latest(entries, "waist", ref);
  const ne = latest(entries, "neck", ref), hi = latest(entries, "hip", ref);
  const sc = latest(entries, "scaleFat", ref);
  const avg = weightAverage(entries, ref, 7);
  const weight = avg ? avg.avg : (w ? w.weight : null);
  const navy = (wa && ne) ? navyBodyFat({ waist: wa.waist, neck: ne.neck, height, hip: hi ? hi.hip : null, sex }) : null;
  const wht = wa ? waistToHeight(wa.waist, height) : null;
  const whr = (wa && hi) ? waistToHip(wa.waist, hi.hip) : null;
  return {
    weight, weightN: avg ? avg.n : 0,
    trend: weightTrend(entries, ref, 4),
    waist: wa ? wa.waist : null, waistDate: wa ? wa.date : null,
    waistHeight: wht, waistHeightRead: readWaistHeight(wht),
    waistHip: whr, waistHipRead: readWaistHip(whr, sex),
    navyFat: navy, scaleFat: sc ? sc.scaleFat : null,
    lean: (weight && navy != null) ? leanMass(weight, navy) : null,
    protein: proteinTarget(weight),
    signal: muscleLossSignal(entries, ref, 4),
  };
}
