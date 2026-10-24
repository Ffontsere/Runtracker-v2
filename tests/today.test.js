// Pantalla Avui: motor (todaySummary, bestWindow), previsió i pantalla en un navegador simulat.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { makeDataset } from "./fixtures/make-dataset.mjs";
import { todaySummary, bestWindow } from "../js/engine/today.js";
import { trainingStatus } from "../js/engine/load.js";
import { parseForecast, getForecast, forecastUrl } from "../js/data/weather.js";

const NOW = new Date("2026-10-24T09:20:00").getTime(); // dissabte
const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/<script type="module".*?<\/script>/, "");
let openDB, renderToday;

before(async () => {
  globalThis.IDBKeyRange = IDBKeyRange;
  const dom = new JSDOM(HTML, { url: "https://ffontsere.github.io/Runtracker-v2/", pretendToBeVisual: true });
  for (const k of ["window", "document", "Node", "HTMLElement", "Event"]) globalThis[k] = k === "window" ? dom.window : dom.window[k];
  ({ openDB } = await import("../js/data/db.js"));
  ({ renderToday } = await import("../js/ui/today.js"));
});

/** Previsió de 2 dies: fresc al matí, calor i sol a migdia, pluja a les 19 h. */
function forecast(day0 = "2026-10-24") {
  const time = [], T = [], DP = [], RH = [], P = [], PP = [], W = [], G = [], R = [], UV = [], C = [], D = [];
  for (const day of [day0, "2026-10-25"]) for (let hr = 0; hr < 24; hr++) {
    time.push(`${day}T${String(hr).padStart(2, "0")}:00`);
    const t = hr < 7 ? 9 : hr < 11 ? 12 + (hr - 7) : hr < 17 ? 27 : hr < 20 ? 20 : 15;
    T.push(t); DP.push(hr >= 11 && hr < 17 ? 19 : 8); RH.push(60);
    const rain = hr === 19 || hr === 20; P.push(rain ? 3 : 0); PP.push(rain ? 90 : 5);
    W.push(8); G.push(15); R.push(hr >= 11 && hr < 17 ? 750 : hr >= 8 && hr < 18 ? 200 : 0); UV.push(0); C.push(0); D.push(hr >= 7 && hr < 19 ? 1 : 0);
  }
  return { hourly: { time, temperature_2m: T, dew_point_2m: DP, relative_humidity_2m: RH, precipitation: P, precipitation_probability: PP,
    wind_speed_10m: W, wind_gusts_10m: G, shortwave_radiation: R, uv_index: UV, weather_code: C, is_day: D } };
}

test("todaySummary: estat igual que el motor, setmana de dilluns a avui i última sortida", () => {
  const { acts, settings } = makeDataset();
  const s = todaySummary({ acts, settings, now: NOW });
  assert.deepEqual(s.status, trainingStatus({ acts, settings, now: NOW }, { useBodySignals: false }));
  const wk = acts.filter(a => a.date >= "2026-10-19" && a.date <= "2026-10-24");
  assert.equal(s.week.runs, wk.length);
  assert.equal(s.week.km, Math.round(wk.reduce((t, a) => t + a.distance, 0) * 10) / 10);
  assert.equal(s.week.target, 45);
  assert.equal(s.last.date, acts.map(a => a.date).sort().at(-1));
  assert.equal(typeof s.ctlDelta28, "number");
  assert.equal(todaySummary({ acts: [], settings, now: NOW }), null);
});

test("bestWindow: evita la calor de migdia i la pluja, i no tria hores passades", () => {
  const hours = parseForecast(forecast());
  const b = bestWindow(hours, NOW, "easy");
  assert.equal(b.day, "avui");
  assert.ok(b.hour >= 9, "no proposa una hora que ja ha passat");
  assert.ok(!(b.hour >= 11 && b.hour < 17), "evita la calor: " + b.hour);
  assert.ok(b.hour !== 19 && b.hour !== 20, "evita la pluja");
  assert.ok(b.score >= 85 && b.cat.l === "Excel·lent");
  assert.ok(b.now && b.now.score <= b.score);
  // A les 22:30 ja no queda res d'avui: passa a demà.
  const late = bestWindow(hours, new Date("2026-10-24T22:30:00").getTime(), "easy");
  assert.equal(late.day, "demà");
  assert.equal(bestWindow([], NOW), null);
});

test("previsió: crida d'Open-Meteo, cache d'1 hora i error clar", async () => {
  const db = await openDB(new IDBFactory());
  assert.equal(await getForecast(db, { fetchImpl: async () => { throw new Error("no"); }, now: NOW }), null, "sense ubicació no es crida");
  await db.setKV("settings", { hrMax: 176, hrRest: 45, wxLat: 41.68, wxLng: 2.28 });
  let calls = 0;
  const f = async url => { calls++; assert.equal(url, forecastUrl(41.68, 2.28)); return new Response(JSON.stringify(forecast())); };
  const a = await getForecast(db, { fetchImpl: f, now: NOW });
  assert.equal(a.hours.length, 48); assert.equal(a.cached, false);
  const b = await getForecast(db, { fetchImpl: f, now: NOW + 30 * 60000 });
  assert.equal(b.cached, true); assert.equal(calls, 1);
  await getForecast(db, { fetchImpl: f, now: NOW + 61 * 60000 });
  assert.equal(calls, 2);
  await assert.rejects(getForecast(db, { fetchImpl: async () => new Response("x", { status: 503 }), now: NOW, force: true }), /Open-Meteo ha respost 503/);
});

async function screen(setup) {
  const db = await openDB(new IDBFactory());
  await setup(db);
  const root = document.getElementById("view");
  await renderToday(root, { db, now: () => NOW, fetchImpl: async () => new Response(JSON.stringify(forecast())), geo: { getCurrentPosition: ok => ok({ coords: { latitude: 41.68123, longitude: 2.28456 } }) } });
  return { db, root };
}

test("pantalla sense dades: porta al Perfil", async () => {
  const { root } = await screen(async db => db.setKV("settings", { hrMax: 176, hrRest: 45 }));
  assert.match(root.textContent, /Encara no hi ha sortides/);
  assert.equal(root.querySelector("a.btn").getAttribute("href"), "#/perfil");
});

test("pantalla amb dades: veredicte, setmana, millor hora i proteïna", async () => {
  const { acts, settings } = makeDataset();
  const { root } = await screen(async db => { await db.putMany("activities", acts); await db.setKV("settings", { ...settings, hrMax: 176, hrRest: 45, wxLat: 41.68, wxLng: 2.28, weight: 70.5 }); });
  const st = trainingStatus({ acts, settings: { ...settings, hrMax: 176, hrRest: 45 }, now: NOW }, { useBodySignals: false });
  assert.equal(root.querySelector(".verdict-label").textContent, st.label);
  assert.match(root.textContent, /dissabte, 24 d’octubre|dissabte 24 d'octubre|dissabte, 24 d'octubre/i);
  assert.match(root.textContent, /Aquesta setmana.*de 45 km/s);
  assert.match(root.querySelector(".best-time").textContent, /^(0[5-9]|10):00$/);
  assert.match(root.textContent, /113 g.*\(99–127 g\)/s);
});

test("pantalla sense ubicació: botó per fer servir el GPS i després la millor hora", async () => {
  const { acts, settings } = makeDataset();
  const { db, root } = await screen(async db => { await db.putMany("activities", acts.slice(-60)); await db.setKV("settings", { ...settings, hrMax: 176, hrRest: 45, wxLat: null, wxLng: null }); });
  const b = [...root.querySelectorAll("button")].find(x => /ubicació del mòbil/.test(x.textContent));
  assert.ok(b);
  b.click();
  for (let i = 0; i < 100 && !root.querySelector(".best-time"); i++) await new Promise(r => setTimeout(r, 10));
  assert.ok(root.querySelector(".best-time"));
  const s = await db.getKV("settings");
  assert.deepEqual([s.wxLat, s.wxLng], [41.6812, 2.2846]);
});

test("tipus de sortida per al clima: llarga el dia habitual, fàcil la resta, i es pot canviar per a avui", async () => {
  const { runTypeFor } = await import("../js/engine/schedule.js");
  const acts = [];
  for (const sun of ["2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27", "2026-10-04", "2026-10-11", "2026-10-18"]) {
    acts.push({ id: "l" + sun, date: sun, distance: 21, duration: 7000, avgHR: 140, trimp: 120, source: "strava" });
    const wed = new Date(Date.parse(sun + "T12:00") - 4 * 864e5).toISOString().slice(0, 10);
    acts.push({ id: "e" + wed, date: wed, distance: 10, duration: 3300, avgHR: 138, trimp: 60, source: "strava" });
  }
  const SUN = new Date("2026-10-25T07:30:00").getTime(), SAT = new Date("2026-10-24T07:30:00").getTime();
  assert.equal(runTypeFor(acts, SUN, SUN), "long");
  assert.equal(runTypeFor(acts, SAT, SAT), "easy");

  const db = await openDB(new IDBFactory());
  await db.putMany("activities", acts);
  await db.setKV("settings", { hrMax: 176, hrRest: 45, wxLat: 41.68, wxLng: 2.28 });
  const fc = forecast("2026-10-25");
  const root = document.getElementById("view");
  const show = () => renderToday(root, { db, now: () => SUN, fetchImpl: async () => new Response(JSON.stringify(fc)) });
  await show();
  const pressed = () => root.querySelector('[aria-label="Tipus de sortida"] [aria-pressed="true"]').textContent;
  assert.equal(pressed(), "Llarga");
  assert.match(root.textContent, /tirada llarga de 95 min \(és el teu dia habitual de llarga\)/);
  [...root.querySelectorAll('[aria-label="Tipus de sortida"] button')].find(b => b.textContent === "Sèries").click();
  for (let i = 0; i < 100 && pressed() !== "Sèries"; i++) await new Promise(r => setTimeout(r, 10));
  assert.match(root.textContent, /sèries \/ qualitat de 60 min \(triat per tu\)/);
  await show();
  assert.equal(pressed(), "Sèries", "la tria es manté durant el dia");
  await renderToday(root, { db, now: () => SUN + 864e5, fetchImpl: async () => new Response(JSON.stringify(fc)) });
  assert.notEqual(root.querySelector('[aria-label="Tipus de sortida"] [aria-pressed="true"]').textContent, "Sèries", "l'endemà torna als hàbits");
});
