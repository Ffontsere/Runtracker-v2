// RunTracker v2 — el que afegeixes tu a una sortida: RPE, sensacions, cursa i temperatura manual.
// Es desa a l'activitat (el motor ho fa servir) i també a kv "actNotes", que viatja a la còpia del Worker:
// Strava no ho guarda, així que si el mòbil es perd, és l'única manera de recuperar-ho.

import { vo2ForActivity } from "../engine/physio.js";

export const NOTE_FIELDS = ["rpe", "feel", "isRace", "tempManual"];

export async function getNotes(db) { return (await db.getKV("actNotes")) || []; }

/** Aplica una nota a una activitat i recalcula el VO₂ si cal (cursa o temperatura). */
async function applyTo(db, act, note) {
  const next = { ...act };
  for (const k of NOTE_FIELDS) if (k in note) { if (note[k] == null || note[k] === false) delete next[k]; else next[k] = note[k]; }
  if ("isRace" in note || "tempManual" in note) {
    const settings = (await db.getKV("settings")) || {};
    Object.assign(next, vo2ForActivity(next, settings, (await db.getKV("tempCache")) || {}));
  }
  return next;
}

/**
 * Canvia camps d'una sortida (p. ex. { rpe: 6 }). null o false treu el camp.
 * @returns {Promise<object>} l'activitat actualitzada
 */
export async function setNote(db, id, patch, now = Date.now()) {
  const act = await db.get("activities", id);
  if (!act) throw new Error("Aquesta sortida ja no hi és.");
  for (const k of Object.keys(patch)) if (!NOTE_FIELDS.includes(k)) throw new Error("Camp desconegut: " + k);
  if (patch.rpe != null && !(patch.rpe >= 1 && patch.rpe <= 10)) throw new Error("L'RPE va de 1 a 10.");
  if (patch.feel != null && !(patch.feel >= 1 && patch.feel <= 5)) throw new Error("Les sensacions van de 1 a 5.");
  if (patch.tempManual != null && !(patch.tempManual >= -30 && patch.tempManual <= 50)) throw new Error("La temperatura ha d'estar entre −30 i 50 °C.");
  const updated = await applyTo(db, act, patch);
  const notes = await getNotes(db);
  const cur = notes.find(n => n.id === id) || { id };
  const merged = { ...cur, ...patch, updatedAt: now };
  await db.putAtomic({
    activities: [updated],
    kv: [{ key: "actNotes", value: [...notes.filter(n => n.id !== id), merged], updatedAt: now }],
  });
  return updated;
}

/** Torna a posar les notes a les activitats (després de baixar-les de la còpia o de sincronitzar Strava). */
export async function applyNotes(db) {
  const notes = await getNotes(db);
  if (!notes.length) return 0;
  const out = [];
  for (const n of notes) {
    const a = await db.get("activities", n.id);
    if (!a) continue;
    const next = await applyTo(db, a, n);
    if (NOTE_FIELDS.some(k => a[k] !== next[k]) || a.vo2 !== next.vo2) out.push(next);
  }
  if (out.length) await db.putMany("activities", out);
  return out.length;
}

/**
 * Un sol cop: les notes que ja tenies a la v1 (importades amb les activitats) s'afegeixen a la llista,
 * perquè també entrin a la còpia. No trepitja cap camp que ja hi sigui.
 */
export async function seedNotesFromActivities(db, now = Date.now()) {
  if (await db.getKV("notesSeeded")) return 0;
  const notes = await getNotes(db);
  const byId = new Map(notes.map(n => [n.id, { ...n }]));
  let added = 0;
  for (const a of await db.getAll("activities")) {
    for (const k of NOTE_FIELDS) {
      if (a[k] == null || a[k] === false) continue;
      const n = byId.get(a.id) || { id: a.id, updatedAt: 1 };
      if (!(k in n)) { n[k] = a[k]; byId.set(a.id, n); added++; }
    }
  }
  await db.putAtomic({ kv: [
    ...(added ? [{ key: "actNotes", value: [...byId.values()], updatedAt: now }] : []),
    { key: "notesSeeded", value: true, updatedAt: now },
  ] });
  return added;
}
