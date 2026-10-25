// RunTracker v2 — configuració local: on és el Worker, la clau de l'app i l'estat de la sincronització.
// Tot es desa a la base de dades del mòbil (magatzem kv). La clau de l'app no surt mai d'aquest dispositiu
// excepte cap al Worker.

export const DEFAULT_WORKER = "https://ff-runtracker.ffontsere.workers.dev";
// Objectius per defecte: els mateixos que la v1 (DSET), que els aplicava encara que no estiguessin desats.
export const DEFAULT_SETTINGS = { hrMax: 176, hrRest: 45, weeklyTarget: 45, yearlyGoal: 2200 };

export async function getWorkerConfig(db) {
  const c = await db.getKV("worker");
  return { url: (c && c.url) || DEFAULT_WORKER, appKey: (c && c.appKey) || "" };
}

/** Valida i desa. Llança un Error amb un missatge que es pot mostrar. */
export async function setWorkerConfig(db, { url, appKey }) {
  url = String(url || "").trim().replace(/\/+$/, "");
  appKey = String(appKey || "").trim();
  let u;
  try { u = new URL(url); } catch { throw new Error("L'adreça del Worker no és vàlida."); }
  if (u.protocol !== "https:") throw new Error("L'adreça del Worker ha de començar per https://");
  if (!/^[0-9a-f]{64}$/i.test(appKey)) throw new Error("La clau de l'app són 64 caràcters (0-9 i a-f). Copia-la de worker/.app-key.");
  await db.setKV("worker", { url, appKey });
  return { url, appKey };
}

export async function getSettings(db) {
  return { ...DEFAULT_SETTINGS, ...((await db.getKV("settings")) || {}) };
}

export async function getSyncState(db) {
  return (await db.getKV("syncState")) || { lastSync: null, lastResult: null, athlete: null };
}
export async function setSyncState(db, patch) {
  const cur = await getSyncState(db);
  const next = { ...cur, ...patch };
  await db.setKV("syncState", next);
  return next;
}

/** Llegeix el retorn del Worker després de connectar Strava (#strava=ok o #strava=error&motiu=…). */
export function parseStravaReturn(hash) {
  const h = String(hash || "").replace(/^#/, "");
  if (!h.startsWith("strava=")) return null;
  const p = new URLSearchParams(h);
  return { ok: p.get("strava") === "ok", reason: p.get("motiu") || null };
}
