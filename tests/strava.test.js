import { test } from "node:test";
import assert from "node:assert/strict";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { openDB } from "../js/data/db.js";
import { workerClient, parseActivity, syncActivities, runBackfill, backfillQueue, pruneStreams, SyncError } from "../js/data/strava.js";
import { makeStreams } from "./fixtures/make-dataset.mjs";
import { SV } from "../js/engine/derive.js";

globalThis.IDBKeyRange = IDBKeyRange;
const NOW = new Date("2026-10-24T09:00:00").getTime();
const SETTINGS = { hrMax: 176, hrRest: 45 };

const stravaRun = (id, date, extra = {}) => ({
  id, name: "Carrera", sport_type: "Run", start_date_local: date + "T09:30:00Z", distance: 15100, moving_time: 4600,
  average_heartrate: 141.4, max_heartrate: 158, total_elevation_gain: 210, average_cadence: 94.5, start_latlng: [41.68, 2.28], ...extra,
});

/** Fetch de prova: respon segons la URL i apunta les crides. */
function fakeFetch(routes) {
  const calls = [];
  const f = async (url, init) => {
    calls.push(String(url));
    for (const [re, fn] of routes) { const m = String(url).match(re); if (m) { const r = await fn(m, init, calls); return new Response(JSON.stringify(r.body ?? r), { status: r.status || 200 }); } }
    return new Response("{}", { status: 404 });
  };
  f.calls = calls; return f;
}
const worker = (tokens = ["A1"]) => {
  let i = 0;
  return { token: async () => ({ access_token: tokens[Math.min(i++, tokens.length - 1)], expires_at: NOW / 1000 + 3600 }) };
};
async function freshDB(acts = []) {
  const db = await openDB(new IDBFactory());
  await db.setKV("settings", SETTINGS);
  if (acts.length) await db.putMany("activities", acts);
  return db;
}

test("converteix una activitat com la v1, amb FC 176/45", () => {
  const a = parseActivity(stravaRun(20618517667, "2026-10-17"), SETTINGS, [120, 130, 155, 164]);
  assert.equal(a.id, "strava-20618517667");
  assert.equal(a.date, "2026-10-17");
  assert.equal(a.distance, 15.1);
  assert.equal(a.avgHR, 141);
  assert.equal(a.cadence, 189);
  assert.equal(a.hrZone, 2);
  const x = (141 - 45) / (176 - 45);
  assert.equal(a.trimp, Math.round(4600 / 60 * x * .64 * Math.exp(1.92 * x)));
  assert.equal(a.vo2conf, "low");
});

test("sincronització incremental: només curses, sense duplicats, des de l'última data menys un dia", async () => {
  const db = await freshDB([{ id: "strava-1", date: "2026-10-15", source: "strava", distance: 15 }]);
  const f = fakeFetch([[/athlete\/activities.*page=1/, () => [stravaRun(1, "2026-10-15"), stravaRun(2, "2026-10-17"), stravaRun(3, "2026-10-18", { sport_type: "Ride" }), stravaRun(4, "2026-10-20", { sport_type: "TrailRun" })]]]);
  const r = await syncActivities({ db, worker: worker(), fetchImpl: f, now: NOW });
  assert.deepEqual(r, { fetched: 4, runs: 3, added: 2 });
  assert.equal(await db.count("activities"), 3);
  const after = Number(new URL(f.calls[0]).searchParams.get("after"));
  assert.equal(after, Math.floor(new Date("2026-10-15").getTime() / 1000) - 86400);
  db.close();
});

test("pagina fins que una pàgina té menys de 200", async () => {
  const db = await freshDB();
  const page = (n, from) => Array.from({ length: n }, (_, i) => stravaRun(from + i, "2026-09-01"));
  const f = fakeFetch([[/page=1(&|$)/, () => page(200, 1000)], [/page=2(&|$)/, () => page(37, 2000)]]);
  const r = await syncActivities({ db, worker: worker(), fetchImpl: f, now: NOW, full: true });
  assert.equal(r.added, 237);
  assert.equal(f.calls.length, 2);
  assert.ok(!f.calls[0].includes("after="), "la sincronització completa no filtra per data");
  db.close();
});

test("amb un 401 demana un token nou i ho torna a provar una vegada", async () => {
  const db = await freshDB();
  let n = 0;
  const f = fakeFetch([[/athlete\/activities/, () => (n++ === 0 ? { status: 401, body: {} } : [stravaRun(5, "2026-10-20")])]]);
  const r = await syncActivities({ db, worker: worker(["vell", "nou"]), fetchImpl: f, now: NOW });
  assert.equal(r.added, 1);
  db.close();
});

test("límit de Strava i errors de xarxa donen un missatge clar", async () => {
  const db = await freshDB();
  await assert.rejects(syncActivities({ db, worker: worker(), fetchImpl: fakeFetch([[/athlete/, () => ({ status: 429, body: {} })]]), now: NOW }), e => e.code === "quota");
  await assert.rejects(syncActivities({ db, worker: worker(), fetchImpl: async () => { throw new Error("offline"); }, now: NOW }), e => e.code === "network" && /offline/.test(e.message));
  db.close();
});

test("errors del Worker: no connectat, permís retirat, clau incorrecta", async () => {
  const mk = (status, body) => workerClient({ url: "https://w", appKey: "k", fetchImpl: async () => new Response(JSON.stringify(body), { status }) });
  await assert.rejects(mk(409, { error: "not_connected" }).token(), e => e instanceof SyncError && e.code === "not_connected");
  await assert.rejects(mk(409, { error: "reconnect" }).token(), e => e.code === "reconnect");
  await assert.rejects(mk(401, { error: "unauthorized" }).token(), e => e.code === "app_key");
  await assert.rejects(workerClient({ url: "https://w", appKey: "k", fetchImpl: async () => { throw new Error("DNS"); } }).token(), e => e.code === "network");
  assert.equal(workerClient({ url: "https://w/", appKey: "a b" }).connectUrl(), "https://w/strava/connect?key=a%20b");
});

test("backfill: streams de les més recents, mètriques recalculades, s'atura amb el límit", async () => {
  const acts = [
    { id: "strava-11", date: "2026-10-20", source: "strava", duration: 4600, distance: 15, avgHR: 141, pace: 306 },
    { id: "strava-12", date: "2026-10-10", source: "strava", duration: 3000, distance: 10, avgHR: 138, pace: 300 },
    { id: "strava-13", date: "2026-09-01", source: "strava", duration: 3000, distance: 10, avgHR: 138, pace: 300 },
    { id: "strava-14", date: "2024-01-01", source: "strava", duration: 3000, distance: 10, avgHR: 138, pace: 300 },
  ];
  const db = await freshDB(acts);
  assert.deepEqual(backfillQueue(acts, NOW).map(a => a.id), ["strava-11", "strava-12", "strava-13"]);
  let n = 0;
  const f = fakeFetch([[/activities\/(\d+)\/streams/, () => (n++ < 2 ? makeStreams({ secs: 3000 }) : { status: 429, body: {} })]]);
  const r = await runBackfill({ db, worker: worker(), fetchImpl: f, now: NOW, sleep: async () => {} });
  assert.deepEqual(r, { done: 2, failed: 0, remaining: 1, stopped: "quota" });
  const a11 = await db.get("activities", "strava-11");
  assert.equal(a11.sv, SV);
  assert.ok(a11.tiz && a11.be && a11.trimp > 0);
  assert.equal(await db.count("streams"), 2);
  // la segona vegada fa servir els streams desats i no torna a demanar-los
  const f2 = fakeFetch([[/streams/, () => makeStreams({ secs: 3000 })]]);
  await db.put("activities", { ...a11, sv: 1 });
  await runBackfill({ db, worker: worker(), fetchImpl: f2, now: NOW, sleep: async () => {}, max: 1 });
  assert.equal(f2.calls.length, 0);
  db.close();
});

test("una activitat sense streams queda marcada i no bloqueja la cua", async () => {
  const db = await freshDB([{ id: "strava-21", date: "2026-10-20", source: "strava", duration: 3000 }, { id: "strava-22", date: "2026-10-19", source: "strava", duration: 3000, avgHR: 140, distance: 10, pace: 300 }]);
  const f = fakeFetch([[/activities\/21\/streams/, () => ({ status: 404, body: {} })], [/activities\/22\/streams/, () => makeStreams({ secs: 3000 })]]);
  const r = await runBackfill({ db, worker: worker(), fetchImpl: f, now: NOW, sleep: async () => {} });
  assert.deepEqual(r, { done: 1, failed: 1, remaining: 0, stopped: null });
  assert.equal((await db.get("activities", "strava-21"))._svErr, 404);
  assert.equal(backfillQueue(await db.getAll("activities"), NOW).length, 0);
  db.close();
});

test("només es guarden els streams més recents", async () => {
  const db = await freshDB();
  await db.putMany("streams", Array.from({ length: 5 }, (_, i) => ({ id: "s" + i, _ts: i })));
  assert.equal(await pruneStreams(db, 3), 2);
  assert.deepEqual((await db.getAll("streams")).map(s => s.id).sort(), ["s2", "s3", "s4"]);
  db.close();
});
