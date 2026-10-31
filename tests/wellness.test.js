// Benestar de Garmin: motor (senyals i base pròpia), baixada del Worker i targeta a Avui.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { makeDataset } from "./fixtures/make-dataset.mjs";
import { wellnessSummary, wellnessAdvice, baseline, WELLNESS } from "../js/engine/wellness.js";
import { dateStr } from "../js/engine/dates.js";
import { pullWellness, loadWellness } from "../js/data/garmin.js";

const NOW = new Date("2026-10-31T08:00:00").getTime();
const day = n => dateStr(new Date(NOW - n * 864e5));

/** 30 dies de base estable: HRV 60 ± 4, FC en repòs 46 ± 1, 7,5 h de son. Avui (n=0) amb els valors que es passin. */
function make(today = {}, { stale = 0 } = {}) {
  const days = {};
  for (let n = 1; n <= 30; n++) days[day(n + stale)] = { hrvLast: 60 + (n % 3 === 0 ? 4 : n % 3 === 1 ? -4 : 0), rhr: 46 + (n % 2), sleepSec: 27000, sleepScore: 80 };
  days[day(stale)] = { hrvLast: 60, rhr: 46, sleepSec: 27000, sleepScore: 80, bbWake: 85, readiness: 70, readinessLevel: "MODERATE", ...today };
  return { days };
}

test("base pròpia: mitjana dels 28 dies anteriors, sense comptar el dia", () => {
  const w = make();
  const b = baseline(w.days, "hrvLast", day(0), NOW);
  assert.ok(b.n >= 7 && Math.abs(b.mean - 60) < 1);
  assert.ok(b.sd > 2 && b.sd < 5, "amb 14 o més dies hi ha desviació");
  assert.equal(baseline({ days: { [day(1)]: { hrvLast: 60 } } }.days, "hrvLast", day(0), NOW), null, "sense prou dies no hi ha base");
});

test("dia normal: tot verd i frase tranquil·la", () => {
  const s = wellnessSummary(make(), NOW);
  assert.equal(s.tone, "ok"); assert.equal(s.stale, false);
  assert.deepEqual(s.signals.map(x => x.key), ["hrv", "rhr", "sleep", "bb", "readiness"]);
  assert.match(wellnessAdvice(s), /dins del teu normal/);
});

test("HRV molt per sota de la teva base amb poc son: senyal vermella i frase", () => {
  const s = wellnessSummary(make({ hrvLast: 40, sleepSec: 5 * 3600, sleepScore: 52 }), NOW);
  assert.equal(s.signals.find(x => x.key === "hrv").tone, "bad");
  assert.equal(s.signals.find(x => x.key === "sleep").tone, "bad");
  assert.equal(s.tone, "bad");
  assert.match(wellnessAdvice(s), /l'HRV i el son no acompanyen/i);
});

test("una sola senyal una mica fora: avís suau", () => {
  const s = wellnessSummary(make({ rhr: 51 }), NOW);
  assert.equal(s.signals.find(x => x.key === "rhr").tone, "warn");
  assert.equal(s.tone, "warn");
  assert.match(wellnessAdvice(s), /la FC en repòs s'allunya/i);
});

test("sense base (poques dades) no s'inventa cap avís per HRV ni FC", () => {
  const s = wellnessSummary({ days: { [day(0)]: { hrvLast: 20, rhr: 90 } } }, NOW);
  assert.equal(s.tone, "ok");
  assert.equal(s.signals[0].base, null);
});

test("dades velles es marquen i el futur no compta", () => {
  const s = wellnessSummary(make({}, { stale: 5 }), NOW);
  assert.equal(s.stale, true); assert.equal(s.ageDays, 5);
  const fut = make(); fut.days[dateStr(new Date(NOW + 864e5))] = { rhr: 99 };
  assert.equal(wellnessSummary(fut, NOW).date, day(0));
  assert.equal(wellnessSummary({ days: {} }, NOW), null);
  assert.equal(wellnessSummary(null, NOW), null);
  assert.ok(WELLNESS.minForBaseline >= 5);
});

// ── Baixada del Worker ──
function fakeDb() {
  const kv = new Map();
  return { kv, getKV: async k => kv.get(k) ?? null, setKV: async (k, v) => { kv.set(k, v); } };
}
const cfgDb = (db, appKey = "a".repeat(64)) => { db.kv.set("worker", { url: "https://w.example", appKey }); return db; };
const reply = (status, body) => async () => new Response(JSON.stringify(body), { status });

test("pullWellness: sense clau de l'app no fa res", async () => {
  const db = fakeDb();
  assert.deepEqual(await pullWellness(db, { fetchImpl: reply(200, {}), now: NOW }), { ok: false, reason: "no_key" });
});

test("pullWellness: desa el que arriba i només marca canvi quan n'hi ha", async () => {
  const db = cfgDb(fakeDb());
  const body = { days: make().days, updatedAt: 111 };
  const r1 = await pullWellness(db, { fetchImpl: reply(200, body), now: NOW });
  assert.equal(r1.ok, true); assert.equal(r1.changed, true);
  assert.equal(Object.keys((await loadWellness(db)).days).length, 31);
  const r2 = await pullWellness(db, { fetchImpl: reply(200, body), now: NOW });
  assert.equal(r2.changed, false);
});

test("pullWellness: Worker vell, clau dolenta, xarxa caiguda o resposta rara no trenquen res", async () => {
  const db = cfgDb(fakeDb());
  assert.equal((await pullWellness(db, { fetchImpl: reply(404, { error: "not_found" }), now: NOW })).reason, "off");
  assert.equal((await pullWellness(db, { fetchImpl: reply(401, { error: "unauthorized" }), now: NOW })).reason, "auth");
  assert.equal((await pullWellness(db, { fetchImpl: async () => { throw new Error("sense xarxa"); }, now: NOW })).reason, "network");
  assert.equal((await pullWellness(db, { fetchImpl: reply(200, { hourly: {} }), now: NOW })).reason, "bad", "una previsió del temps no és benestar");
  assert.equal(await loadWellness(db), null);
});

// ── Pantalla ──
const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/<script type="module".*?<\/script>/, "");
let openDB, renderToday;
before(async () => {
  globalThis.IDBKeyRange = IDBKeyRange;
  const dom = new JSDOM(HTML, { url: "https://ffontsere.github.io/Runtracker-v2/", pretendToBeVisual: true });
  for (const k of ["window", "document", "Node", "HTMLElement", "Event"]) globalThis[k] = k === "window" ? dom.window : dom.window[k];
  ({ openDB } = await import("../js/data/db.js"));
  ({ renderToday } = await import("../js/ui/today.js"));
});

async function screen(extra, fetchImpl) {
  const { acts, settings } = makeDataset();
  const db = await openDB(new IDBFactory());
  await db.putMany("activities", acts);
  await db.setKV("settings", { ...settings, hrMax: 176, hrRest: 45, wxLat: 41.68, wxLng: 2.28 });
  if (extra) await extra(db);
  const root = document.getElementById("view");
  await renderToday(root, { db, now: () => NOW, fetchImpl: fetchImpl || (async () => new Response("{}", { status: 500 })) });
  return { db, root };
}
const tick = () => new Promise(r => setTimeout(r, 30));

test("Avui: sense dades de Garmin no hi ha targeta de Recuperació", async () => {
  const { root } = await screen();
  assert.ok(![...root.querySelectorAll("h2")].some(x => x.textContent === "Recuperació"));
});

test("Avui: amb dades desades surt la targeta i no toca l'Estat", async () => {
  const { root } = await screen(db => db.setKV("wellness", { days: make({ hrvLast: 40, sleepSec: 5 * 3600, sleepScore: 50 }).days, updatedAt: 1 }));
  const card = [...root.querySelectorAll("section.card")].find(c => /Recuperació/.test(c.querySelector("h2")?.textContent || ""));
  assert.ok(card, "hi ha la targeta");
  assert.match(card.textContent, /40 ms.*HRV/s);
  assert.match(card.textContent, /5 h 00 · 50/);
  assert.match(card.textContent, /no acompanyen/);
  assert.match(card.textContent, /no canvia l'Estat/);
  assert.match(card.textContent, /Disposició \(Garmin\) \(moderada\)/, "el nivell de Garmin es mostra en català");
  assert.equal(card.dataset.tone, "bad");
});

test("Avui: baixa en segon pla i repinta quan arriba benestar nou", async () => {
  const body = { days: make().days, updatedAt: 5 };
  const f = async url => String(url).endsWith("/garmin/wellness") ? new Response(JSON.stringify(body), { status: 200 }) : new Response("{}", { status: 500 });
  const { root } = await screen(db => db.setKV("worker", { url: "https://w.example", appKey: "b".repeat(64) }), f);
  for (let i = 0; i < 50 && ![...root.querySelectorAll("h2")].some(x => x.textContent === "Recuperació"); i++) await tick();
  assert.ok([...root.querySelectorAll("h2")].some(x => x.textContent === "Recuperació"), "la targeta apareix després de la baixada");
});
