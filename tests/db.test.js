import { test } from "node:test";
import assert from "node:assert/strict";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { openDB, STORES } from "../js/data/db.js";

globalThis.IDBKeyRange = IDBKeyRange;
const fresh = () => openDB(new IDBFactory());

test("crea tots els magatzems", async () => {
  const db = await fresh();
  assert.deepEqual([...db.raw.objectStoreNames].sort(), Object.keys(STORES).sort());
  db.close();
});

test("desa, llegeix i filtra per data", async () => {
  const db = await fresh();
  await db.putMany("activities", [
    { id: "strava-1", date: "2026-10-01", distance: 10 },
    { id: "strava-2", date: "2026-10-12", distance: 15 },
    { id: "strava-3", date: "2026-10-20", distance: 21 },
  ]);
  assert.equal(await db.count("activities"), 3);
  assert.equal((await db.get("activities", "strava-2")).distance, 15);
  assert.deepEqual((await db.byDate("activities", "2026-10-05", "2026-10-20")).map(a => a.id), ["strava-2", "strava-3"]);
  await db.delete("activities", "strava-1");
  assert.equal(await db.count("activities"), 2);
  db.close();
});

test("clau-valor amb valor per defecte", async () => {
  const db = await fresh();
  assert.equal(await db.getKV("settings", "res"), "res");
  await db.setKV("settings", { hrMax: 176, hrRest: 45 });
  assert.deepEqual(await db.getKV("settings"), { hrMax: 176, hrRest: 45 });
  db.close();
});

test("escriptura atòmica: si una falla, no se'n desa cap", async () => {
  const db = await fresh();
  await assert.rejects(db.putAtomic({
    activities: [{ id: "strava-9", date: "2026-10-01" }],
    kv: [{ notakey: true }], // sense clau: falla
  }));
  assert.equal(await db.count("activities"), 0);
  db.close();
});

test("sense IndexedDB dona un error clar", async () => {
  await assert.rejects(openDB(undefined), /IndexedDB/);
});
