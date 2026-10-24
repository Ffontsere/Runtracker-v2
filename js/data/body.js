// RunTracker v2 — mesures del cos a la base de dades del mòbil (magatzem "body").

export const FIELDS = [
  // [camp, etiqueta, mínim, màxim, pas, unitat]
  ["weight", "Pes", 30, 200, 0.1, "kg"],
  ["waist", "Cintura", 40, 200, 0.5, "cm"],
  ["neck", "Coll", 20, 80, 0.5, "cm"],
  ["hip", "Maluc", 50, 200, 0.5, "cm"],
  ["scaleFat", "% greix de la bàscula", 3, 60, 0.1, "%"],
];

/** Les mesures que vas donar el 18/10/2026 (proposta de la v2). */
export const FIRST_ENTRY = { date: "2026-10-18", weight: 70.5, waist: 78.5, neck: 36, hip: 93, scaleFat: 16.6 };
export const FIRST_HEIGHT = 179.5;

export async function loadBody(db) {
  return (await db.getAll("body")).filter(e => !e.deleted).sort((a, b) => a.date.localeCompare(b.date) || (a.updatedAt || 0) - (b.updatedAt || 0));
}

/** Valida una entrada. Retorna el missatge d'error o null. */
export function validate(e) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || "")) return "La data no és vàlida.";
  for (const [k, label, lo, hi] of FIELDS) if (e[k] != null && !(e[k] >= lo && e[k] <= hi)) return `${label} ha d'estar entre ${lo} i ${hi}.`;
  if (FIELDS.every(([k]) => e[k] == null)) return "Omple almenys una mesura.";
  return null;
}

/** Desa una entrada nova. Llança un Error amb un missatge que es pot mostrar. */
export async function addEntry(db, input, now = Date.now()) {
  const e = { date: input.date };
  for (const [k] of FIELDS) if (input[k] != null && input[k] !== "" && !Number.isNaN(+input[k])) e[k] = +input[k];
  const err = validate(e);
  if (err) throw new Error(err);
  const entry = { id: `cos-${e.date}-${now}`, ...e, updatedAt: now };
  await db.put("body", entry);
  return entry;
}

/** Esborra deixant la marca perquè arribi a la còpia. */
export async function deleteEntry(db, id, now = Date.now()) {
  const e = await db.get("body", id);
  if (e) await db.put("body", { id, date: e.date, deleted: true, updatedAt: now });
}

/** "M"/"F" de la v1 o "male"/"female". */
export const sexOf = s => (s === "F" || s === "female") ? "female" : "male";
