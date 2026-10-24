import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { readV1Storage, readV1Backup, migrate, saveMigration } from "../js/data/migrate.js";
import { openDB } from "../js/data/db.js";
import { makeDataset, makeStreams } from "./fixtures/make-dataset.mjs";
import { calcFF, ffNow } from "../js/engine/load.js";
import { thresholdZones } from "../js/engine/physio.js";

globalThis.IDBKeyRange = IDBKeyRange;
const NOW = new Date("2026-10-24T09:00:00").getTime();

/** localStorage de prova que falla si algú hi escriu. */
function readOnlyStorage(map) {
  return {
    getItem: k => (k in map ? map[k] : null),
    setItem: k => { throw new Error("La migració ha intentat escriure a " + k); },
    removeItem: k => { throw new Error("La migració ha intentat esborrar " + k); },
    clear: () => { throw new Error("La migració ha intentat buidar el localStorage"); },
  };
}

function v1Storage() {
  const d = makeDataset();
  d.settings.stravaSecret = "secret-de-prova"; d.settings.stravaToken = "tok"; d.settings.aiKey = "sk-prova";
  d.settings.hrMax = 190; d.settings.hrRest = 43;
  d.acts.forEach(a => { a.sv = 1; a.gp = [[1, 2]]; a.fp = { s: [0, 0] }; a.gapr = 1.02; });
  const last = d.acts.at(-1);
  const streams = { [last.id.replace("strava-", "")]: makeStreams({ secs: last.duration }) };
  return { d, store: readOnlyStorage({
    "rt4:a": JSON.stringify(d.acts), "rt4:s": JSON.stringify(d.settings),
    "rt4:temps": JSON.stringify(d.tempCache), "rt4:streams": JSON.stringify(streams),
  }) };
}

test("llegeix la v1 sense escriure-hi mai", () => {
  const { d, store } = v1Storage();
  const v1 = readV1Storage(store);
  assert.equal(v1.acts.length, d.acts.length);
  assert.deepEqual(v1.errors, []);
});

test("una clau corrupta no atura la migració i queda a l'informe", () => {
  const v1 = readV1Storage(readOnlyStorage({ "rt4:a": "[{trencat", "rt4:s": "{}" }));
  assert.equal(v1.acts.length, 0);
  assert.match(v1.errors[0], /activitats/);
});

test("FC 176/45, sense claus secretes, camps de FC recalculats", () => {
  const { store } = v1Storage();
  const r = migrate(readV1Storage(store), { hrMax: 176, hrRest: 45, now: NOW });
  assert.equal(r.settings.hrMax, 176); assert.equal(r.settings.hrRest, 45);
  for (const k of ["stravaSecret", "stravaToken", "aiKey"]) assert.equal(r.settings[k], undefined, k);
  assert.deepEqual(r.report.secretsDropped.sort(), ["aiKey", "stravaSecret", "stravaToken"]);
  assert.deepEqual(r.report.hrBefore, { hrMax: 190, hrRest: 43 });
  const a = r.acts.find(x => x.avgHR && x.duration && !x.sv);
  const x = (a.avgHR - 45) / (176 - 45);
  assert.equal(a.trimp, Math.round(a.duration / 60 * x * .64 * Math.exp(1.92 * x)));
  assert.ok(r.acts.every(x => x.gp === undefined && x.fp === undefined && x.gapr === undefined));
  assert.ok(r.acts.every(x => x.vo2conf), "tots tenen VO₂ recalculat");
  assert.equal(r.report.derivedFromStreams, 1);
  assert.equal(r.acts.at(-1).sv, 2);
  assert.ok(r.report.pendingStreams > 0);
});

test("les zones s'estabilitzen i coincideixen amb les del motor", () => {
  const { store } = v1Storage();
  const v1 = readV1Storage(store);
  const r = migrate(v1, { hrMax: 176, hrRest: 45, now: NOW });
  const tz = thresholdZones({ acts: r.acts, settings: r.settings, now: NOW, streamCache: v1.streams });
  assert.deepEqual(r.report.bounds, tz.zones.slice(0, 4).map(z => z.hi));
  assert.equal(tz.lt1src, "desacoblament", "amb streams de la llarga, el LT1 surt del desacoblament");
});

test("descarta registres sense id o data i duplicats", () => {
  const v1 = { source: "prova", acts: [{ id: "a", date: "2026-10-01" }, { id: "a", date: "2026-10-01" }, { date: "2026-10-02" }, { id: "b", date: "ahir" }], settings: {}, temps: {}, streams: {}, errors: [] };
  const r = migrate(v1, { hrMax: 176, hrRest: 45, now: NOW });
  assert.equal(r.acts.length, 1);
  assert.equal(r.report.skipped.length, 3);
});

test("rebutja una FC impossible", () => {
  assert.throws(() => migrate({ acts: [], settings: {}, temps: {}, streams: {}, errors: [] }, { hrMax: 45, hrRest: 176, now: NOW }));
});

test("desa a IndexedDB tot de cop", async () => {
  const { store } = v1Storage();
  const r = migrate(readV1Storage(store), { hrMax: 176, hrRest: 45, now: NOW });
  const db = await openDB(new IDBFactory());
  await saveMigration(db, r, NOW);
  assert.equal(await db.count("activities"), r.acts.length);
  assert.equal(await db.count("streams"), 1);
  assert.equal((await db.getKV("settings")).hrMax, 176);
  assert.equal((await db.getKV("migration")).count, r.acts.length);
  db.close();
});

const PRIVATE = new URL("./private/backup.json", import.meta.url);
test("còpia real: migració amb 176/45", { skip: !existsSync(PRIVATE) && "sense còpia a tests/private/" }, () => {
  const v1 = readV1Backup(readFileSync(PRIVATE, "utf8"));
  const r = migrate(v1, { hrMax: 176, hrRest: 45, now: NOW });
  assert.equal(r.report.migrated, 2018);
  assert.deepEqual(r.report.skipped, []);
  assert.deepEqual(r.report.secretsDropped, []);
  const tz = thresholdZones({ acts: r.acts, settings: r.settings, now: NOW, streamCache: {} });
  assert.ok(tz && tz.lt2 >= 145 && tz.lt2 <= 170, "LT2 estimat a partir dels teus esforços: " + (tz && tz.lt2));
  const ff = ffNow(calcFF({ acts: r.acts, now: NOW }));
  assert.ok(ff.ctl > 30 && ff.ctl < 120, "CTL plausible: " + ff.ctl);
});

test("un fitxer que no és una còpia es rebutja", () => {
  assert.throws(() => readV1Backup({ hola: 1 }), /no és una còpia/);
});
