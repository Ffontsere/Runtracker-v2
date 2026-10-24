// RunTracker v2 — sessions de força a la base de dades del mòbil.
// Estat de progressió a kv "strengthState", sessions al magatzem "strength", sessió a mitges a kv "strengthDraft".

import { initState, withAllPatterns, planSession, applyResult, strengthLoad } from "../engine/strength.js";

export async function loadStrength(db) {
  const raw = await db.getKV("strengthState");
  const sessions = (await db.getAll("strength")).sort((a, b) => b.date.localeCompare(a.date) || (b.savedAt || 0) - (a.savedAt || 0));
  return { state: raw ? withAllPatterns(raw) : initState(), sessions, draft: (await db.getKV("strengthDraft")) || {} };
}

export const saveDraft = (db, draft) => db.setKV("strengthDraft", draft);

/** Clau de l'esborrany d'un exercici: si canvia el nivell o les sèries, l'esborrany ja no val. */
export const draftKey = (type, ex) => `${type}:${ex.pattern}:${ex.level}:${ex.sets}`;

export function draftFor(draft, type, ex) {
  const k = draftKey(type, ex);
  if (!draft[k]) draft[k] = ex.plyo ? { quality: null } : { reps: ex.targets.slice(), rir: null, pain: false };
  return draft[k];
}

/**
 * Tanca la sessió: aplica cada resultat a l'estat i desa sessió i estat junts (tot o res).
 * Llança un Error si falta marcar la pliometria.
 */
export async function finishSession(db, { type, state, ctx, draft, minutes, rpe, date, now = Date.now() }) {
  const plan = planSession(type, state, ctx);
  let st = state;
  const results = [];
  for (const ex of plan.exercises) {
    const d = draftFor(draft, type, ex);
    if (ex.plyo && !d.quality) throw new Error(`Marca com ha anat: ${ex.name}.`);
    const res = ex.plyo ? { quality: d.quality } : { reps: d.reps.slice(), rirLast: d.rir, pain: !!d.pain };
    const out = applyResult(st, ex.pattern, res, { fatigued: plan.fatigued });
    st = out.state;
    results.push({ pattern: ex.pattern, name: ex.name, level: ex.level, unit: ex.unit, ...res, verdict: out.verdict });
  }
  minutes = Math.max(1, Math.min(240, Math.round(+minutes || 0)));
  rpe = Math.max(0, Math.min(10, Math.round(+rpe || 0)));
  const session = { id: `forca-${date}-${type}-${now}`, date, type, minutes, rpe, load: strengthLoad(minutes, rpe),
    fatigued: plan.fatigued, ctx: { tsb: ctx.tsb ?? null, acwr: ctx.acwr ?? null }, results, savedAt: now };
  await db.putAtomic({
    strength: [session],
    kv: [{ key: "strengthState", value: st, updatedAt: now }, { key: "strengthDraft", value: {}, updatedAt: now }],
  });
  return { session, state: st };
}

/** Canvia el nivell d'un moviment a mà (calibrar el primer dia). Reinicia les ratxes. */
export async function setLevel(db, state, pattern, level) {
  const next = { ...state, [pattern]: { level, topStreak: 0, lowStreak: 0, cleanCount: 0, lastReps: null } };
  await db.setKV("strengthState", next);
  return next;
}

export async function deleteSession(db, id) { await db.delete("strength", id); }
