// RunTracker v2 — còpia de força, cos i configuració al Worker, perquè no depenguin d'un sol mòbil.
// Cada sincronització: baixa la còpia, la combina amb el que hi ha al mòbil i, si cal, puja el resultat.
// - Llistes (sessions, mesures): es combinen per id; guanya el registre amb `updatedAt` més recent.
//   Un registre esborrat es queda com a { id, deleted:true, updatedAt } perquè l'esborrat també viatgi.
// - Valors (estat de força, configuració): guanya el més recent.
// - Notes de les sortides (RPE, sensacions, cursa, temperatura): llista per id, com les sessions.
// Les sortides no es copien: Strava ja les guarda.

import { workerClient, SyncError } from "./strava.js";
import { getWorkerConfig } from "./config.js";
import { applyNotes, seedNotesFromActivities } from "./notes.js";

/** Camps de configuració que viatgen entre mòbils. La ubicació, el Worker i la FC es queden a cada mòbil. */
export const PORTABLE_SETTINGS = ["strengthDays", "weight", "height", "weeklyTarget", "yearlyGoal", "sex", "birth", "name"];

const stamp = r => r.updatedAt ?? r.savedAt ?? 0;

/** Combina dues llistes de registres per id. Funció pura. */
export function mergeLists(a = [], b = []) {
  const m = new Map();
  for (const r of [...(a || []), ...(b || [])]) {
    if (!r || !r.id) continue;
    const cur = m.get(r.id);
    if (!cur || stamp(r) > stamp(cur)) m.set(r.id, r);
  }
  return [...m.values()].sort((x, y) => String(x.date || "").localeCompare(String(y.date || "")) || String(x.id).localeCompare(String(y.id)));
}

/** El valor més recent de dos { value, at }. */
export const newer = (a, b) => (!a || a.value == null) ? b : (!b || b.value == null) ? a : (b.at > a.at ? b : a);

const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

/** Com es llegeix i s'escriu cada col·lecció al mòbil. */
const LOCAL = {
  strength: {
    read: db => db.getAll("strength"),
    merge: mergeLists,
    write: (db, v) => db.putMany("strength", v),
  },
  body: {
    read: db => db.getAll("body"),
    merge: mergeLists,
    write: (db, v) => db.putMany("body", v),
  },
  strengthState: {
    read: async db => { const r = await db.get("kv", "strengthState"); return r ? { value: r.value, at: r.updatedAt || 0 } : null; },
    merge: newer,
    write: (db, v) => db.put("kv", { key: "strengthState", value: v.value, updatedAt: v.at }),
  },
  actNotes: {
    read: async db => (await db.getKV("actNotes")) || [],
    merge: mergeLists,
    write: async (db, v) => { await db.setKV("actNotes", v); await applyNotes(db); },
  },
  settings: {
    read: async db => {
      const r = await db.get("kv", "settings");
      if (!r) return null;
      const value = {}; for (const k of PORTABLE_SETTINGS) if (r.value[k] !== undefined) value[k] = r.value[k];
      return { value, at: r.updatedAt || 0 };
    },
    merge: newer,
    write: async (db, v) => {
      const r = await db.get("kv", "settings");
      await db.put("kv", { key: "settings", value: { ...(r ? r.value : {}), ...v.value }, updatedAt: v.at });
    },
  },
};
export const COLLECTIONS = Object.keys(LOCAL);

/**
 * Sincronitza totes les col·leccions. No llança per una col·lecció: recull els errors.
 * @returns {Promise<{ok:boolean, pulled:string[], pushed:string[], errors:string[], at:number}>}
 */
export async function syncAll(db, { fetchImpl = fetch, now = Date.now(), worker = null } = {}) {
  if (!worker) {
    const cfg = await getWorkerConfig(db);
    if (!cfg.appKey) return { ok: false, skipped: true, pulled: [], pushed: [], errors: ["Falta la clau de l'app."], at: now };
    worker = workerClient({ url: cfg.url, appKey: cfg.appKey, fetchImpl });
  }
  const out = { ok: true, pulled: [], pushed: [], errors: [], pending: [], at: now };
  await seedNotesFromActivities(db, now);
  for (const col of COLLECTIONS) {
    const L = LOCAL[col];
    try {
      let remote = await worker.syncGet(col);
      for (let attempt = 0; attempt < 3; attempt++) {
        const local = await L.read(db);
        const merged = L.merge(local, remote.value);
        if (merged == null || (Array.isArray(merged) && !merged.length)) break; // res a copiar enlloc
        if (!same(merged, local)) { await L.write(db, merged); out.pulled.push(col); }
        if (same(merged, remote.value)) break;
        const r = await worker.syncPut(col, merged, remote.version);
        if (r.status === 200) { out.pushed.push(col); break; }
        if (r.status === 409 && r.body.current) { remote = r.body.current; continue; } // un altre mòbil hi ha escrit: es torna a combinar
        throw new SyncError("worker", r.body.message || "Error " + r.status);
      }
    } catch (e) {
      // Un Worker que encara no coneix aquesta col·lecció (cal tornar-lo a publicar): no és un error de l'app.
      if (/Col·lecció desconeguda/.test(e.message)) { out.pending.push(col); continue; }
      out.ok = false;
      out.errors.push(`${col}: ${e.message}`);
      if (e.code === "app_key" || e.code === "network") break; // no cal provar la resta
    }
  }
  out.pulled = [...new Set(out.pulled)];
  await db.setKV("backup", { at: now, ok: out.ok, errors: out.errors, pushed: out.pushed, pulled: out.pulled, pending: out.pending });
  return out;
}

/** Programa una sincronització en segon pla, agrupant canvis seguits. No bloqueja la pantalla. */
let pending = null;
export function syncSoon(db, opts = {}, delay = 1500) {
  clearTimeout(pending);
  return new Promise(res => {
    pending = setTimeout(() => { syncAll(db, opts).then(res, e => res({ ok: false, errors: [e.message] })); }, delay);
  });
}
