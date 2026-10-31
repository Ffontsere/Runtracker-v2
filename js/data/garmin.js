// RunTracker v2 — benestar de Garmin (HRV, son, FC en repòs, Body Battery…).
// Una Action de GitHub el baixa de Garmin Connect i el deixa al Worker (privat); aquí només es llegeix i es desa al mòbil.
// Mai és obligatori: sense Garmin configurat, l'app funciona igual i la targeta de Recuperació no surt.

import { workerClient } from "./strava.js";
import { getWorkerConfig } from "./config.js";

const KEY = "wellness";

/** El que hi ha desat al mòbil: { days: { 'AAAA-MM-DD': {...} }, updatedAt, fetchedAt } o null. */
export async function loadWellness(db) {
  const w = await db.getKV(KEY);
  return w && w.days && typeof w.days === "object" ? w : null;
}

/**
 * Baixa el benestar del Worker i el desa. No llança: retorna què ha passat perquè la pantalla no s'espatlli.
 * @returns {Promise<{ok:boolean, changed?:boolean, days?:number, reason?:"no_key"|"off"|"bad"|"network"|"auth", message?:string}>}
 */
export async function pullWellness(db, { fetchImpl = (...a) => fetch(...a), now = Date.now(), worker = null } = {}) {
  try {
    if (!worker) {
      const cfg = await getWorkerConfig(db);
      if (!cfg.appKey) return { ok: false, reason: "no_key" };
      worker = workerClient({ url: cfg.url, appKey: cfg.appKey, fetchImpl });
    }
    const { status, body } = await worker.wellness();
    if (status === 401) return { ok: false, reason: "auth", message: "La clau de l'app no és correcta." };
    if (status === 404) return { ok: false, reason: "off", message: "El Worker encara no té les rutes de Garmin: cal tornar-lo a publicar." };
    if (status !== 200 || !body || typeof body.days !== "object" || body.days === null || Array.isArray(body.days)) return { ok: false, reason: "bad", message: "Resposta inesperada del Worker." };
    const days = Object.keys(body.days).length;
    if (!days) return { ok: true, changed: false, days: 0 };
    const cur = await loadWellness(db);
    const changed = !cur || cur.updatedAt !== body.updatedAt;
    if (changed) await db.setKV(KEY, { days: body.days, updatedAt: body.updatedAt, fetchedAt: now });
    return { ok: true, changed, days };
  } catch (e) {
    return { ok: false, reason: "network", message: e.message };
  }
}
