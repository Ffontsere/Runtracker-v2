// RunTracker v2 — migració des de la v1.
// Llegeix les claus rt4:* (o una còpia de seguretat) SENSE ESCRIURE-HI MAI, i prepara les dades de la v2.
// Tot el que depèn de la FC es recalcula amb la FC màxima i de repòs que tries (176 i 45).

import { trimpBanister } from "../engine/load.js";
import { activeZoneBounds, hrZone, vo2ForActivity } from "../engine/physio.js";
import { deriveFromStreams, SV } from "../engine/derive.js";

/** Camps de configuració que passen a la v2. La resta (claus, tokens, IA, cursa) es queda enrere. */
const SETTINGS_KEEP = ["weeklyTarget", "yearlyGoal", "name", "weight", "birth", "sex", "fieldTestLT2", "lt1Manual",
  "zones", "hrRestLog", "wxLat", "wxLng", "wxPlace", "stravaClientId"];
/** Claus que no es copien mai, encara que hi siguin. */
const SECRET_KEYS = ["stravaSecret", "stravaToken", "stravaRefresh", "stravaExpires", "aiKey"];
/** Camps d'activitat que depenen de la FC màxima o de les zones: es recalculen. */
const HR_DEPENDENT = ["trimp", "hrZone", "tiz", "vo2", "vo2raw", "vo2conf", "vo2s", "vo2n", "sv", "_svErr"];
/** Camps de funcions que la v2 ja no té (perfil de pendent, rutes, GAP). */
const DROPPED = ["gp", "fp", "gapr"];

const parse = (raw, what, errors) => {
  if (raw == null) return null;
  try { return JSON.parse(raw); } catch (e) { errors.push(`${what}: no es pot llegir (${e.message})`); return null; }
};

/** Llegeix les dades de la v1 d'un localStorage. Només fa getItem. */
export function readV1Storage(storage) {
  const errors = [];
  const get = k => { try { return storage.getItem(k); } catch (e) { errors.push(`${k}: ${e.message}`); return null; } };
  return {
    source: "localStorage",
    acts: parse(get("rt4:a"), "activitats", errors) || [],
    settings: parse(get("rt4:s"), "configuració", errors) || {},
    temps: parse(get("rt4:temps"), "temperatures", errors) || {},
    streams: parse(get("rt4:streams"), "streams", errors) || {},
    errors,
  };
}

/** Llegeix una còpia de seguretat de la v1 (Importar → Exporta còpia). */
export function readV1Backup(json) {
  const b = typeof json === "string" ? JSON.parse(json) : json;
  if (!b || b.app !== "runtracker" || !Array.isArray(b.activities)) throw new Error("Aquest fitxer no és una còpia de seguretat de RunTracker.");
  return { source: "backup " + (b.exported || ""), acts: b.activities, settings: b.settings || {}, temps: b.temps || {}, streams: {}, errors: [] };
}

/**
 * Converteix les dades de la v1 a la v2. Funció pura.
 * @param {ReturnType<typeof readV1Storage>} v1
 * @param {{hrMax:number, hrRest:number, now:number}} opts
 */
export function migrate(v1, { hrMax, hrRest, now }) {
  if (!(hrMax > hrRest && hrRest > 20)) throw new Error("FC màxima i de repòs no vàlides.");
  const report = { source: v1.source, read: v1.acts.length, errors: [...v1.errors], skipped: [], secretsDropped: [], derivedFromStreams: 0, pendingStreams: 0 };

  // ── Configuració ──
  const settings = { hrMax, hrRest };
  for (const k of SETTINGS_KEEP) if (v1.settings[k] !== undefined) settings[k] = v1.settings[k];
  for (const k of SECRET_KEYS) if (v1.settings[k]) report.secretsDropped.push(k);
  report.hrBefore = { hrMax: v1.settings.hrMax ?? null, hrRest: v1.settings.hrRest ?? null };

  // ── Activitats: neteja i TRIMP amb la FC nova ──
  const seen = new Set();
  const acts = [];
  for (const raw of v1.acts) {
    if (!raw || !raw.id || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date || "")) { report.skipped.push(raw && raw.id || "(sense id)"); continue; }
    if (seen.has(raw.id)) { report.skipped.push(raw.id + " (duplicada)"); continue; }
    seen.add(raw.id);
    const a = { ...raw };
    for (const k of [...HR_DEPENDENT, ...DROPPED]) delete a[k];
    a.trimp = trimpBanister(a.duration ? a.duration / 60 : null, a.avgHR, hrMax, hrRest);
    a.hrZone = null;
    acts.push(a);
  }
  acts.sort((x, y) => x.date.localeCompare(y.date));

  // ── Zones: el LT2 depèn de les zones de cada sortida i a l'inrevés. Es repeteix fins que s'estabilitza. ──
  const ctx = { acts, settings, now, tempCache: v1.temps, streamCache: v1.streams };
  let bounds = null;
  for (let i = 0; i < 8; i++) {
    const nb = activeZoneBounds(ctx);
    acts.forEach(a => { a.hrZone = a.avgHR ? hrZone(a.avgHR, nb) : null; });
    if (bounds && nb.every((v, j) => v === bounds[j])) break;
    bounds = nb;
  }
  report.bounds = bounds;

  // ── Mètriques dels streams que ja hi ha a la cache de la v1: es recalculen ara amb la FC nova ──
  for (const a of acts) {
    const s = v1.streams[String(a.id).replace("strava-", "")];
    if (s) { Object.assign(a, deriveFromStreams(a, s, settings, bounds)); report.derivedFromStreams++; }
    else if (a.source === "strava" && (now - Date.parse(a.date)) / 864e5 <= 365) report.pendingStreams++;
    Object.assign(a, vo2ForActivity(a, settings, v1.temps));
  }

  report.migrated = acts.length;
  report.range = acts.length ? [acts[0].date, acts[acts.length - 1].date] : null;
  const streams = Object.entries(v1.streams).map(([id, s]) => ({ id: "strava-" + id, ...s }));
  return { acts, settings, tempCache: v1.temps, streams, report };
}

/** Desa el resultat de la migració a la base de dades nova, tot o res. */
export async function saveMigration(db, result, now) {
  await db.putAtomic({
    activities: result.acts,
    streams: result.streams,
    kv: [
      { key: "settings", value: result.settings, updatedAt: now },
      { key: "tempCache", value: result.tempCache, updatedAt: now },
      { key: "migration", value: { from: result.report.source, at: now, count: result.acts.length, sv: SV }, updatedAt: now },
      { key: "notesSeeded", value: false, updatedAt: now }, // les notes de la v1 (RPE, cursa…) entraran a la còpia
    ],
  });
}
