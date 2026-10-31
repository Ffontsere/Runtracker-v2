// RunTracker v2 — sincronització amb Strava a través del Worker ff-runtracker.
// Port de la v1 (stravaFetchActivities, runBackfill) amb tres canvis:
//  - el token l'administra el Worker; l'app no guarda ni el secret ni el refresh token;
//  - cada error torna amb un missatge que es pot mostrar (cap error en silenci);
//  - les activitats i els streams es desen a IndexedDB.

import { dateStr } from "../engine/dates.js";
import { trimpBanister } from "../engine/load.js";
import { activeZoneBounds, hrZone, vo2ForActivity } from "../engine/physio.js";
import { deriveFromStreams, SV } from "../engine/derive.js";

const API = "https://www.strava.com/api/v3";
const RUN_TYPES = ["run", "trailrun", "trail_run", "virtualrun", "virtual_run", "treadmill"];
export const STREAM_KEYS = "time,distance,altitude,velocity_smooth,heartrate,cadence,grade_smooth,latlng";
export const STREAM_CACHE_MAX = 120; // streams crus que es guarden (els més recents)

export class SyncError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** Client del Worker. */
export function workerClient({ url, appKey, fetchImpl = fetch }) {
  const base = url.replace(/\/+$/, "");
  const call = async (path, init = {}) => {
    let r;
    try { r = await fetchImpl(base + path, { ...init, headers: { Authorization: "Bearer " + appKey, "Content-Type": "application/json", ...(init.headers || {}) } }); }
    catch (e) { throw new SyncError("network", "No s'ha pogut contactar amb el Worker: " + e.message); }
    const body = await r.json().catch(() => ({}));
    return { status: r.status, body };
  };
  return {
    connectUrl: () => base + "/strava/connect?key=" + encodeURIComponent(appKey),
    async token() {
      const { status, body } = await call("/strava/token", { method: "POST" });
      if (status === 200) return body;
      if (body.error === "not_connected") throw new SyncError("not_connected", "Strava no està connectat. Connecta'l des del Perfil.");
      if (body.error === "reconnect") throw new SyncError("reconnect", "Strava ha retirat el permís. Torna a connectar des del Perfil.");
      if (status === 401) throw new SyncError("app_key", "La clau de l'app no és correcta. Revisa-la al Perfil.");
      throw new SyncError("worker", body.message || "Error del Worker (" + status + ").");
    },
    async disconnect() { return call("/strava/disconnect", { method: "POST" }); },
    /** Benestar de Garmin (HRV, son, FC en repòs…) que hi ha deixat l'Action de GitHub. */
    async wellness() { return call("/garmin/wellness"); },
    async syncGet(col) { const { status, body } = await call("/sync/" + col); if (status !== 200) throw new SyncError("worker", body.message || "Error " + status); return body; },
    async syncPut(col, value, baseVersion) { return call("/sync/" + col, { method: "PUT", body: JSON.stringify({ value, baseVersion }) }); },
  };
}

/** Converteix una activitat de Strava al format de RunTracker (v1: stravaParseActivity). */
export function parseActivity(a, settings, bounds) {
  const dist = a.distance ? Math.round(a.distance / 10) / 100 : null;
  const dur = a.moving_time || a.elapsed_time || null;
  const avgHR = a.average_heartrate ? Math.round(a.average_heartrate) : null;
  const d = new Date(a.start_date_local || a.start_date);
  const out = {
    id: "strava-" + a.id, date: dateStr(d), title: a.name || "Cursa",
    distance: dist, duration: dur, avgHR, maxHR: a.max_heartrate ? Math.round(a.max_heartrate) : null,
    pace: (dist && dur && dist > 0) ? dur / dist : null,
    ascent: a.total_elevation_gain ? Math.round(a.total_elevation_gain) : null,
    cadence: a.average_cadence ? Math.round(a.average_cadence * 2) : null,
    temp: (typeof a.average_temp === "number") ? a.average_temp : null,
    lat: (a.start_latlng && a.start_latlng.length) ? a.start_latlng[0] : null,
    lng: (a.start_latlng && a.start_latlng.length) ? a.start_latlng[1] : null,
    startTime: a.start_date_local || a.start_date || null,
    trimp: trimpBanister(dur ? dur / 60 : null, avgHR, settings.hrMax, settings.hrRest),
    hrZone: avgHR ? hrZone(avgHR, bounds) : null,
    source: "strava",
  };
  return { ...out, ...vo2ForActivity(out, settings, {}) };
}

const isRun = a => RUN_TYPES.includes(String(a.sport_type || a.type || "").toLowerCase());

/**
 * Baixa les sortides noves (o totes, si full = true) i les desa.
 * @returns {Promise<{fetched:number, runs:number, added:number}>}
 */
export async function syncActivities({ db, worker, fetchImpl = fetch, now = Date.now(), full = false }) {
  const settings = await db.getKV("settings");
  if (!settings || !settings.hrMax) throw new SyncError("settings", "Falta la configuració (FC màxima i de repòs).");
  const existing = await db.getAll("activities");
  const ids = new Set(existing.map(a => a.id));
  let after = 0;
  if (!full) {
    const strava = existing.filter(a => a.source === "strava");
    if (strava.length) after = Math.floor(new Date(strava.reduce((m, a) => a.date > m ? a.date : m, strava[0].date)).getTime() / 1000) - 86400;
  }
  let tok = await worker.token();
  const fetched = [];
  let retried = false;
  for (let page = 1; page <= 20;) {
    const url = `${API}/athlete/activities?per_page=200&page=${page}` + (after > 0 ? "&after=" + after : "");
    let r;
    try { r = await fetchImpl(url, { headers: { Authorization: "Bearer " + tok.access_token } }); }
    catch (e) { throw new SyncError("network", "Sense connexió amb Strava: " + e.message); }
    if (r.status === 401 && !retried) { retried = true; tok = await worker.token(); continue; }
    if (r.status === 429) throw new SyncError("quota", "Límit de peticions de Strava assolit. Torna-ho a provar d'aquí 15 minuts.");
    if (!r.ok) throw new SyncError("strava", "Strava ha respost " + r.status + ".");
    const data = await r.json();
    if (!data || !data.length) break;
    fetched.push(...data);
    if (data.length < 200) break;
    page++;
  }
  const runs = fetched.filter(isRun);
  const ctx = { acts: existing, settings, now, streamCache: {} };
  const bounds = activeZoneBounds(ctx);
  const added = runs.map(a => parseActivity(a, settings, bounds)).filter(a => !ids.has(a.id));
  if (added.length) await db.putMany("activities", added);
  return { fetched: fetched.length, runs: runs.length, added: added.length };
}

/** Activitats dels últims 365 dies que encara no tenen les mètriques dels streams a la versió actual. */
export function backfillQueue(acts, now) {
  return acts.filter(a => a.source === "strava" && (now - Date.parse(a.date)) / 864e5 <= 365 && a.sv !== SV && !a._svErr)
    .sort((x, y) => y.date.localeCompare(x.date));
}

/**
 * Baixa streams i recalcula les mètriques, de la més recent a la més antiga.
 * S'atura amb el límit de Strava i es pot reprendre. `onProgress(pendents)` per a la pantalla.
 */
export async function runBackfill({ db, worker, fetchImpl = fetch, now = Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms)), max = Infinity, onProgress = () => {} }) {
  const settings = await db.getKV("settings");
  const acts = await db.getAll("activities");
  const bounds = activeZoneBounds({ acts, settings, now, streamCache: {} });
  const queue = backfillQueue(acts, now);
  let tok = await worker.token();
  let done = 0, failed = 0, stopped = null;
  for (let i = 0, retried = false; i < queue.length; ) {
    if (done + failed >= max) break;
    const a = queue[i];
    const sid = a.id.replace("strava-", "");
    let streams = await db.get("streams", a.id);
    if (!streams) {
      const r = await fetchImpl(`${API}/activities/${sid}/streams?keys=${STREAM_KEYS}&key_by_type=true&resolution=medium`, { headers: { Authorization: "Bearer " + tok.access_token } })
        .catch(e => { throw new SyncError("network", "Sense connexió amb Strava: " + e.message); });
      if (r.status === 429) { stopped = "quota"; break; }
      if (r.status === 401 && !retried) { retried = true; tok = await worker.token(); continue; } // mateixa activitat, token nou
      retried = false;
      if (!r.ok) { failed++; i++; await db.put("activities", { ...a, _svErr: r.status }); continue; }
      streams = { id: a.id, ...(await r.json()), _ts: now };
      await db.put("streams", streams);
    }
    const derived = deriveFromStreams(a, streams, settings, bounds);
    const updated = { ...a, ...derived };
    Object.assign(updated, vo2ForActivity(updated, settings, (await db.getKV("tempCache")) || {}));
    await db.put("activities", updated);
    done++; i++;
    onProgress(queue.length - done - failed);
    await sleep(1500);
  }
  await pruneStreams(db);
  return { done, failed, remaining: queue.length - done - failed, stopped };
}

/** Manté només els STREAM_CACHE_MAX streams més recents. */
export async function pruneStreams(db, max = STREAM_CACHE_MAX) {
  const all = await db.getAll("streams");
  if (all.length <= max) return 0;
  const old = all.sort((a, b) => (b._ts || 0) - (a._ts || 0)).slice(max);
  for (const s of old) await db.delete("streams", s.id);
  return old.length;
}

/**
 * Streams d'una sola sortida (per al Detall): els de la base de dades, o els baixa de Strava,
 * recalcula les mètriques i els desa. Retorna { streams, act } o llança un SyncError.
 */
export async function activityStreams({ db, worker, fetchImpl = fetch, act, now = Date.now() }) {
  let streams = await db.get("streams", act.id);
  if (!streams) {
    if (act.source !== "strava") return { streams: null, act };
    const tok = await worker.token();
    const sid = act.id.replace("strava-", "");
    let r;
    try { r = await fetchImpl(`${API}/activities/${sid}/streams?keys=${STREAM_KEYS}&key_by_type=true&resolution=medium`, { headers: { Authorization: "Bearer " + tok.access_token } }); }
    catch (e) { throw new SyncError("network", "Sense connexió amb Strava: " + e.message); }
    if (r.status === 429) throw new SyncError("quota", "Límit de peticions de Strava assolit. Torna-ho a provar d'aquí 15 minuts.");
    if (r.status === 404) throw new SyncError("strava", "Strava no té dades segon a segon d'aquesta sortida.");
    if (!r.ok) throw new SyncError("strava", "Strava ha respost " + r.status + ".");
    streams = { id: act.id, ...(await r.json()), _ts: now };
    await db.put("streams", streams);
  }
  if (act.sv === SV) return { streams, act };
  const settings = await db.getKV("settings");
  const acts = await db.getAll("activities");
  const bounds = activeZoneBounds({ acts, settings, now, streamCache: {} });
  const updated = { ...act, ...deriveFromStreams(act, streams, settings, bounds) };
  Object.assign(updated, vo2ForActivity(updated, settings, (await db.getKV("tempCache")) || {}));
  await db.put("activities", updated);
  return { streams, act: updated };
}
