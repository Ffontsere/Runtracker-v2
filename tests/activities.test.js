// Sortides: motor de lectura, notes de les sortides i la seva còpia, i les dues pantalles.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { makeDataset } from "./fixtures/make-dataset.mjs";
import { sessionSummary, intensityRead, compareSimilar, periodStats, byMonth, highlights } from "../js/engine/activity.js";
import worker from "../worker/src/index.js";

const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/<script type="module".*?<\/script>/, "");
const NOW = new Date("2026-10-24T09:00:00").getTime();
const KEY = "ab".repeat(32), WK = "https://ff-runtracker.ffontsere.workers.dev";
let openDB, N, renderActivities, renderActivity, syncAll;

before(async () => {
  globalThis.IDBKeyRange = IDBKeyRange;
  const dom = new JSDOM(HTML, { url: "https://ffontsere.github.io/Runtracker-v2/", pretendToBeVisual: true });
  for (const k of ["window", "document", "Node", "HTMLElement", "Event"]) globalThis[k] = k === "window" ? dom.window : dom.window[k];
  ({ openDB } = await import("../js/data/db.js"));
  N = await import("../js/data/notes.js");
  ({ renderActivities, renderActivity } = await import("../js/ui/activities.js"));
  ({ syncAll } = await import("../js/data/sync.js"));
});
const wait = async (fn, ms = 3000) => { const t = Date.now(); while (!(await fn())) { if (Date.now() - t > ms) throw new Error("temps esgotat"); await new Promise(r => setTimeout(r, 10)); } };

test("resum de la sessió: sèries amb els minuts reals a Z4–Z5 (no dividits per 60 com a la v1)", () => {
  const bounds = [120, 140, 150, 160];
  const s = sessionSummary({ hrZone: 1, tiz: [5, 30, 4, 9, 3] }, bounds);
  assert.equal(s.kind, "intervals");
  assert.match(s.text, /Uns 12 min en Z4–Z5/);
  assert.equal(sessionSummary({ hrZone: 1, maxHR: 165 }, bounds).kind, "intervals", "sense streams, per la FC màxima");
  const e = sessionSummary({ hrZone: 1, tiz: [10, 40, 2, 0, 0], dec: 3.2, rpe: 7 }, bounds);
  assert.equal(e.kind, "easy"); assert.match(e.text, /FC estable/); assert.match(e.warn, /RPE alt \(7\)/);
  assert.equal(sessionSummary({ hrZone: 3 }, bounds).title, "Sessió intensa (Z4)");
  assert.equal(sessionSummary({ hrZone: null }, bounds), null);
  assert.equal(intensityRead(140, 176).label, "Moderat / tempo");
});

test("similars, període, destacats i mesos", () => {
  const { acts, settings } = makeDataset();
  const a = acts.at(-1);
  const c = compareSimilar(acts, a);
  assert.ok(c.n >= 2 && c.n <= 10);
  assert.ok(c.list.every(x => x.date <= a.date && x.distance >= a.distance * 0.7 && x.distance <= a.distance * 1.3));
  const p = periodStats({ acts, settings, now: NOW }, 28);
  const r28 = acts.filter(x => Math.floor((NOW - new Date(x.date).getTime()) / 864e5) < 28);
  assert.equal(p.cur.n, r28.length);
  const hl = highlights({ acts, now: NOW }, 28);
  assert.equal(hl.longest.distance, Math.max(...r28.map(x => x.distance)));
  const m = byMonth(acts);
  assert.equal(m[0].month, acts.map(x => x.date).sort().at(-1).slice(0, 7));
  assert.equal(m.reduce((s, g) => s + g.acts.length, 0), acts.length);
});

test("notes: RPE i sensacions, cursa recalcula el VO₂ amb el VDOT, i es poden treure", async () => {
  const db = await openDB(new IDBFactory());
  await db.setKV("settings", { hrMax: 176, hrRest: 45 });
  await db.put("activities", { id: "strava-1", date: "2026-10-11", distance: 10, duration: 2400, pace: 240, avgHR: 168, source: "strava" });
  let a = await N.setNote(db, "strava-1", { rpe: 9, feel: 2 }, 10);
  assert.deepEqual([a.rpe, a.feel], [9, 2]);
  a = await N.setNote(db, "strava-1", { isRace: true }, 20);
  assert.equal(a.vo2conf, "race"); assert.ok(a.vo2 > 50);
  a = await N.setNote(db, "strava-1", { isRace: false, rpe: null }, 30);
  assert.equal(a.isRace, undefined); assert.equal(a.rpe, undefined); assert.equal(a.vo2conf, "low");
  await assert.rejects(N.setNote(db, "strava-1", { rpe: 11 }), /RPE va de 1 a 10/);
  await assert.rejects(N.setNote(db, "strava-1", { title: "x" }), /Camp desconegut/);
  const notes = await N.getNotes(db);
  assert.deepEqual(notes, [{ id: "strava-1", rpe: null, feel: 2, isRace: false, updatedAt: 30 }]);
});

function kv() { const m = new Map(); return { m, get: async k => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); } }; }

test("còpia de les notes: un mòbil nou les recupera i les aplica; amb el Worker antic queda pendent", async () => {
  const env = { STRAVA_CLIENT_ID: "1", STRAVA_CLIENT_SECRET: "s", APP_KEY: KEY, APP_URL: "https://ffontsere.github.io/Runtracker-v2/", FF_DATA: kv() };
  const net = async (url, init = {}) => worker.fetch(new Request(String(url), init), env, {}, Date.now());
  const act = { id: "strava-9", date: "2026-10-11", distance: 10, duration: 2400, pace: 240, avgHR: 168, source: "strava" };
  const p1 = await openDB(new IDBFactory());
  await p1.setKV("worker", { url: WK, appKey: KEY }); await p1.setKV("settings", { hrMax: 176, hrRest: 45 });
  await p1.put("activities", { ...act, rpe: 5 }); // nota que ve de la v1
  await N.setNote(p1, "strava-9", { isRace: true }, 50);
  const r1 = await syncAll(p1, { fetchImpl: net, now: 100 });
  assert.ok(r1.ok, r1.errors.join()); assert.ok(r1.pushed.includes("actNotes"));
  // mòbil nou: l'activitat arriba de Strava sense notes
  const p2 = await openDB(new IDBFactory());
  await p2.setKV("worker", { url: WK, appKey: KEY }); await p2.setKV("settings", { hrMax: 176, hrRest: 45 });
  await p2.put("activities", act);
  await syncAll(p2, { fetchImpl: net, now: 200 });
  const a2 = await p2.get("activities", "strava-9");
  assert.equal(a2.rpe, 5, "la nota de la v1 també viatja");
  assert.equal(a2.isRace, true); assert.equal(a2.vo2conf, "race");
  // Worker antic, que encara no coneix actNotes
  const old = async (url, init = {}) => String(url).includes("/sync/actNotes")
    ? new Response(JSON.stringify({ error: "unknown_collection", message: "Col·lecció desconeguda." }), { status: 404 }) : net(url, init);
  const r3 = await syncAll(p1, { fetchImpl: old, now: 300 });
  assert.ok(r3.ok, "no és un error"); assert.deepEqual(r3.pending, ["actNotes"]);
});

async function withData() {
  const db = await openDB(new IDBFactory());
  const { acts, settings } = makeDataset();
  await db.putMany("activities", acts);
  await db.setKV("settings", { ...settings, hrMax: 176, hrRest: 45 });
  return { db, acts };
}

test("llista: període, destacats, mesos i mostrar-ne més", async () => {
  const { db, acts } = await withData();
  const root = document.getElementById("view");
  const app = { db, now: () => NOW };
  await renderActivities(root, app);
  assert.match(root.querySelector("h1").previousSibling.textContent, new RegExp(acts.length.toLocaleString("ca-ES").replace(".", "\\.")));
  assert.equal(root.querySelectorAll(".month").length, 3);
  [...root.querySelectorAll("button")].find(b => b.textContent === "Mostra'n més").click();
  assert.equal(root.querySelectorAll(".month").length, 9);
  [...root.querySelectorAll('[aria-label="Període"] button')].find(b => b.textContent === "7 dies").click();
  assert.equal(app.period, 7);
  assert.ok(root.querySelector(".act").getAttribute("href").startsWith("#/activitats/strava-"));
});

test("detall: xifres, valoració desada, cursa, semblants i navegació", async () => {
  const { db, acts } = await withData();
  const a = [...acts].sort((x, y) => x.date.localeCompare(y.date)).at(-3);
  const root = document.getElementById("view");
  await renderActivity(root, { db, now: () => NOW, noSync: true }, a.id);
  assert.equal(root.querySelector("h1").textContent, a.title);
  assert.match(root.textContent, /Sortides semblants/);
  assert.equal(root.querySelectorAll(".prevnext a").length, 2);
  [...root.querySelectorAll('[aria-label="RPE de 1 a 10"] button')].find(b => b.textContent === "7").click();
  await wait(async () => (await db.get("activities", a.id)).rpe === 7);
  await wait(() => root.querySelector('[aria-label="RPE de 1 a 10"] [aria-pressed="true"]')?.textContent === "7");
  const race = root.querySelector('input[type="checkbox"]');
  race.checked = true; race.dispatchEvent(new window.Event("change"));
  await wait(async () => (await db.get("activities", a.id)).isRace === true);
  assert.ok((await N.getNotes(db)).some(n => n.id === a.id && n.rpe === 7 && n.isRace));
  await renderActivity(root, { db, now: () => NOW }, "no-existeix");
  assert.match(root.textContent, /No trobo aquesta sortida/);
});

test("detall: carrega les dades segon a segon de Strava a través del Worker", async () => {
  const { db, acts } = await withData();
  await db.setKV("worker", { url: WK, appKey: KEY });
  const a = acts.at(-1);
  const { makeStreams } = await import("./fixtures/make-dataset.mjs");
  const streams = makeStreams({ secs: 4400 });
  const f = async url => {
    url = String(url);
    if (url.endsWith("/strava/token")) return new Response(JSON.stringify({ access_token: "T", expires_at: NOW / 1000 + 3600 }));
    if (url.includes(`/activities/${a.id.replace("strava-", "")}/streams`)) return new Response(JSON.stringify(streams));
    return new Response("{}", { status: 404 });
  };
  const root = document.getElementById("view");
  await renderActivity(root, { db, now: () => NOW, noSync: true, fetchImpl: f }, a.id);
  [...root.querySelectorAll("button")].find(b => b.textContent === "Carrega-les de Strava").click();
  await wait(() => /FC 1a meitat/.test(root.textContent));
  assert.ok(await db.get("streams", a.id));
  assert.equal((await db.get("activities", a.id)).sv, 2);
});
