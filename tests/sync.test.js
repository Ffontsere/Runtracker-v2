// Còpia de força, cos i configuració: dos mòbils contra el Worker real (executat en local amb un KV de mentida).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import worker from "../worker/src/index.js";
import { openDB } from "../js/data/db.js";
import { syncAll, mergeLists, newer } from "../js/data/sync.js";
import { deleteSession, loadStrength } from "../js/data/strength.js";

globalThis.IDBKeyRange = IDBKeyRange;
const KEY = "ab".repeat(32);
const URL0 = "https://ff-runtracker.ffontsere.workers.dev";
let env, puts;

function kv() {
  const m = new Map();
  return { m, get: async k => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); } };
}
beforeEach(() => {
  env = { STRAVA_CLIENT_ID: "220720", STRAVA_CLIENT_SECRET: "s", APP_KEY: KEY, APP_URL: "https://ffontsere.github.io/Runtracker-v2/", FF_DATA: kv() };
  puts = 0;
});
const net = async (url, init = {}) => {
  if (init.method === "PUT") puts++;
  return worker.fetch(new Request(String(url), init), env, {}, Date.now());
};

async function phone() {
  const db = await openDB(new IDBFactory());
  await db.setKV("worker", { url: URL0, appKey: KEY });
  return db;
}
const session = (id, date, savedAt, extra = {}) => ({ id, date, type: "A", minutes: 30, rpe: 6, load: 90, results: [], savedAt, ...extra });

test("combinar: per id guanya el més recent; el valor més recent guanya", () => {
  const a = [session("s1", "2026-10-20", 1), session("s2", "2026-10-22", 1)];
  const b = [session("s2", "2026-10-22", 5, { minutes: 40 }), session("s3", "2026-10-24", 2)];
  const m = mergeLists(a, b);
  assert.deepEqual(m.map(x => x.id), ["s1", "s2", "s3"]);
  assert.equal(m[1].minutes, 40);
  assert.deepEqual(newer({ value: 1, at: 5 }, { value: 2, at: 3 }), { value: 1, at: 5 });
  assert.deepEqual(newer(null, { value: 2, at: 3 }), { value: 2, at: 3 });
});

test("primer mòbil puja; un mòbil nou ho recupera tot sense trepitjar-ho", async () => {
  const p1 = await phone();
  await p1.putMany("strength", [session("s1", "2026-10-20", 100), session("s2", "2026-10-23", 200)]);
  await p1.putMany("body", [{ id: "b1", date: "2026-10-18", weight: 70.5, waist: 78.5, updatedAt: 50 }]);
  await p1.put("kv", { key: "strengthState", value: { genoll: { level: 3 } }, updatedAt: 300 });
  await p1.put("kv", { key: "settings", value: { hrMax: 176, hrRest: 45, weight: 70.5, strengthDays: { A: 2, B: 5 }, wxLat: 41.6 }, updatedAt: 400 });
  const r1 = await syncAll(p1, { fetchImpl: net, now: 1000 });
  assert.ok(r1.ok, r1.errors.join());
  assert.deepEqual(r1.pushed.sort(), ["body", "settings", "strength", "strengthState"]);
  assert.equal(JSON.parse(env.FF_DATA.m.get("runtracker:sync:settings")).value.value.wxLat, undefined, "la ubicació no viatja");

  // mòbil nou: configuració per defecte amb updatedAt 0, com fa l'app en arrencar
  const p2 = await phone();
  await p2.put("kv", { key: "settings", value: { hrMax: 176, hrRest: 45 }, updatedAt: 0 });
  const r2 = await syncAll(p2, { fetchImpl: net, now: 2000 });
  assert.ok(r2.ok, r2.errors.join());
  assert.equal((await loadStrength(p2)).sessions.length, 2);
  assert.equal((await loadStrength(p2)).state.genoll.level, 3);
  assert.equal((await p2.getAll("body"))[0].weight, 70.5);
  const s2 = await p2.getKV("settings");
  assert.deepEqual([s2.weight, s2.strengthDays.B, s2.hrMax], [70.5, 5, 176]);
  assert.equal(r2.pushed.length, 0, "no cal tornar a pujar res");
  assert.ok((await p2.getKV("backup")).ok);
});

test("dos mòbils amb sessions diferents: s'ajunten, i un esborrat arriba a l'altre", async () => {
  const p1 = await phone(), p2 = await phone();
  await p1.putMany("strength", [session("s1", "2026-10-20", 100)]);
  await syncAll(p1, { fetchImpl: net, now: 1 });
  await p2.putMany("strength", [session("s2", "2026-10-21", 150)]);
  await syncAll(p2, { fetchImpl: net, now: 2 });
  await syncAll(p1, { fetchImpl: net, now: 3 });
  assert.deepEqual((await loadStrength(p1)).sessions.map(s => s.id).sort(), ["s1", "s2"]);
  await deleteSession(p1, "s2", 500);
  await syncAll(p1, { fetchImpl: net, now: 4 });
  await syncAll(p2, { fetchImpl: net, now: 5 });
  assert.deepEqual((await loadStrength(p2)).sessions.map(s => s.id), ["s1"]);
});

test("si un altre mòbil escriu just abans (409), es torna a combinar sense perdre res", async () => {
  const p1 = await phone();
  await p1.putMany("strength", [session("s1", "2026-10-20", 100)]);
  // L'altre mòbil escriu entre el GET i el PUT d'aquest.
  let raced = false;
  const racy = async (url, init = {}) => {
    if (init.method === "PUT" && !raced && String(url).endsWith("/sync/strength")) {
      raced = true;
      const cur = JSON.parse(env.FF_DATA.m.get("runtracker:sync:strength") || '{"version":0}');
      await net(URL0 + "/sync/strength", { method: "PUT", headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ value: [session("sX", "2026-10-19", 90)], baseVersion: cur.version }) });
    }
    return net(url, init);
  };
  const r = await syncAll(p1, { fetchImpl: racy, now: 10 });
  assert.ok(r.ok, r.errors.join());
  assert.deepEqual((await loadStrength(p1)).sessions.map(s => s.id).sort(), ["s1", "sX"]);
  assert.deepEqual(JSON.parse(env.FF_DATA.m.get("runtracker:sync:strength")).value.map(s => s.id).sort(), ["s1", "sX"]);
});

test("sense clau no es fa res; amb clau incorrecta, error clar i desat", async () => {
  const p = await openDB(new IDBFactory());
  const r = await syncAll(p, { fetchImpl: net, now: 1 });
  assert.equal(r.skipped, true);
  await p.setKV("worker", { url: URL0, appKey: "cd".repeat(32) });
  await p.putMany("strength", [session("s1", "2026-10-20", 1)]);
  const r2 = await syncAll(p, { fetchImpl: net, now: 2 });
  assert.equal(r2.ok, false);
  assert.match(r2.errors[0], /Clau de l'app incorrecta/);
  assert.equal(puts, 0);
  assert.equal((await p.getKV("backup")).ok, false);
});
