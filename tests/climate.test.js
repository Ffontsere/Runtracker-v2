// Clima: millor hora de cada dia, hora a hora, temps de cada sortida i la pantalla.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { forecastDays, dayBest, dayHours, skyOf, missingWx } from "../js/engine/climate.js";
import { parseForecast, historyUrl, fetchActivityWx } from "../js/data/weather.js";

const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/<script type="module".*?<\/script>/, "");
const NOW = new Date("2026-10-24T09:20:00").getTime(); // dissabte
let openDB, renderClimate, W;
before(async () => {
  globalThis.IDBKeyRange = IDBKeyRange;
  const dom = new JSDOM(HTML, { url: "https://ffontsere.github.io/Runtracker-v2/", pretendToBeVisual: true });
  for (const k of ["window", "document", "Node", "HTMLElement", "Event"]) globalThis[k] = k === "window" ? dom.window : dom.window[k];
  ({ openDB } = await import("../js/data/db.js"));
  ({ renderClimate } = await import("../js/ui/climate.js"));
  W = await import("../js/data/weather.js");
});

/** 3 dies: matí fresc, migdia calorós i assolellat, pluja a les 19 h. */
function forecast() {
  const time = [], T = [], DP = [], RH = [], P = [], PP = [], Wd = [], G = [], R = [], UV = [], C = [], D = [];
  for (const day of ["2026-10-24", "2026-10-25", "2026-10-26"]) for (let hr = 0; hr < 24; hr++) {
    time.push(`${day}T${String(hr).padStart(2, "0")}:00`);
    const t = hr < 7 ? 9 : hr < 11 ? 12 + (hr - 7) : hr < 17 ? 28 : hr < 20 ? 20 : 15;
    T.push(t); DP.push(hr >= 11 && hr < 17 ? 19 : 8); RH.push(60);
    const rain = hr === 19; P.push(rain ? 3 : 0); PP.push(rain ? 90 : 5);
    Wd.push(8); G.push(15); R.push(hr >= 11 && hr < 17 ? 750 : 0); UV.push(hr >= 11 && hr < 17 ? 5 : 0); C.push(rain ? 63 : 0); D.push(hr >= 7 && hr < 19 ? 1 : 0);
  }
  return { hourly: { time, temperature_2m: T, dew_point_2m: DP, relative_humidity_2m: RH, precipitation: P, precipitation_probability: PP,
    wind_speed_10m: Wd, wind_gusts_10m: G, shortwave_radiation: R, uv_index: UV, weather_code: C, is_day: D } };
}

test("dies, millor finestra i hora a hora", () => {
  const hours = parseForecast(forecast());
  const days = forecastDays(hours);
  assert.equal(days.length, 3); assert.equal(days[0].idx.length, 24);
  const b = dayBest(hours, days[0], "easy", NOW);
  assert.ok(b.hour >= 9 && !(b.hour >= 11 && b.hour < 17) && b.hour !== 19, "ni passat, ni calor, ni pluja: " + b.hour);
  const long = dayBest(hours, days[1], "long", NOW);
  assert.equal(long.span, 2, "la llarga ocupa 2 hores");
  const rows = dayHours(hours, days[0], "easy", NOW, 300);
  assert.equal(rows.length, 18, "de 5 a 22 h");
  assert.ok(rows.find(r => r.hour === 7).past, "les 7 h ja han passat");
  assert.ok(rows.find(r => r.hour === 13).bits.some(x => /s\/km per la calor/.test(x)), "la calor en s/km");
  assert.equal(rows.find(r => r.hour === 19).sky, "Pluja");
  assert.equal(skyOf(0, 0), "Serè (nit)");
});

test("temps de cada sortida: arxiu o previsió segons l'antiguitat, i l'hora local de Strava", async () => {
  const a = { id: "strava-1", lat: 41.6812, lng: 2.2846, startTime: "2026-09-10T18:30:00Z", date: "2026-09-10", source: "strava" };
  assert.match(historyUrl(a, NOW), /^https:\/\/archive-api\.open-meteo\.com\/v1\/archive\?latitude=41\.681&longitude=2\.285&start_date=2026-09-10/);
  assert.match(historyUrl({ ...a, startTime: "2026-10-22T07:00:00Z" }, NOW), /^https:\/\/api\.open-meteo\.com\/v1\/forecast/);
  const hourly = { temperature_2m: Array.from({ length: 24 }, (_, i) => i), dew_point_2m: Array(24).fill(10), wind_speed_10m: Array(24).fill(12) };
  const f = async url => new Response(JSON.stringify(String(url).includes("/v1/elevation") ? { elevation: [312.4] } : { hourly }));
  const wx = await fetchActivityWx(a, { fetchImpl: f, now: NOW });
  assert.deepEqual(wx, { t: 18, dp: 10, elev: 312, w: 12 }, "hora 18 tal com la dona Strava, sense convertir-la de UTC");
  const none = await fetchActivityWx(a, { fetchImpl: async () => new Response(JSON.stringify({ hourly: { temperature_2m: [] } })), now: NOW });
  assert.equal(none, null);
});

test("omplir el temps de les sortides: recalcula el VO₂, marca les que no en tenen i no torna a demanar-les", async () => {
  const db = await openDB(new IDBFactory());
  await db.setKV("settings", { hrMax: 176, hrRest: 45 });
  const base = { distance: 10, duration: 3000, pace: 300, avgHR: 150, source: "strava", lat: 41.68, lng: 2.28 };
  await db.putMany("activities", [
    { ...base, id: "strava-1", date: "2026-09-10", startTime: "2026-09-10T13:00:00Z" },
    { ...base, id: "strava-2", date: "2026-09-12", startTime: "2026-09-12T13:00:00Z" },
    { ...base, id: "strava-3", date: "2026-09-14", startTime: "2026-09-14T08:00:00Z", tempManual: 10 },
  ]);
  const hot = { temperature_2m: Array(24).fill(32), dew_point_2m: Array(24).fill(22), wind_speed_10m: Array(24).fill(5) };
  let calls = 0;
  const f = async url => { calls++; url = String(url);
    if (url.includes("/v1/elevation")) return new Response(JSON.stringify({ elevation: [200] }));
    return new Response(JSON.stringify(url.includes("2026-09-12") ? { hourly: { temperature_2m: [] } } : { hourly: hot })); };
  assert.equal(missingWx(await db.getAll("activities"), {}, NOW).length, 2, "la de temperatura manual no cal");
  const r = await W.fillActivityWx(db, { fetchImpl: f, now: NOW, sleep: async () => {} });
  assert.deepEqual([r.done, r.empty, r.failed, r.remaining], [1, 1, 0, 0]);
  const cache = await db.getKV("tempCache");
  assert.deepEqual(cache["strava-1"], { t: 32, dp: 22, elev: 200, w: 5 });
  assert.equal(cache["strava-2"], null);
  const a1 = await db.get("activities", "strava-1");
  assert.ok(a1.vo2 > a1.vo2raw, "amb calor, el VO₂ corregit és més alt que el cru");
  const before = calls;
  await W.fillActivityWx(db, { fetchImpl: f, now: NOW, sleep: async () => {} });
  assert.equal(calls, before, "no torna a demanar res");
});

test("pantalla: tipus segons hàbits, canviar de dia i de tipus, i sense ubicació", async () => {
  const db = await openDB(new IDBFactory());
  const acts = [];
  for (const sun of ["2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27", "2026-10-04", "2026-10-11", "2026-10-18"]) {
    acts.push({ id: "l" + sun, date: sun, distance: 21, duration: 7000, pace: 333, avgHR: 140, hrZone: 1, trimp: 120, source: "strava" });
    const wed = new Date(Date.parse(sun + "T12:00") - 4 * 864e5).toISOString().slice(0, 10);
    acts.push({ id: "e" + wed, date: wed, distance: 10, duration: 3000, pace: 300, avgHR: 138, hrZone: 1, trimp: 60, source: "strava" });
  }
  await db.putMany("activities", acts);
  await db.setKV("settings", { hrMax: 176, hrRest: 45, wxLat: 41.68, wxLng: 2.28 });
  const root = document.getElementById("view");
  const app = { db, now: () => NOW, fetchImpl: async () => new Response(JSON.stringify(forecast())) };
  await renderClimate(root, app);
  const dayBtns = () => [...root.querySelectorAll("button.day")];
  assert.equal(dayBtns().length, 3);
  assert.match(dayBtns()[0].textContent, /Rodatge fàcil/, "dissabte, fàcil");
  assert.match(dayBtns()[1].textContent, /Tirada llarga/, "diumenge, el dia de la llarga");
  assert.match(root.textContent, /Dissabte hora a hora/);
  dayBtns()[1].click();
  for (let i = 0; i < 100 && !/Diumenge hora a hora/.test(root.textContent); i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(app.day, 1);
  [...root.querySelectorAll('[aria-label="Tipus de sortida"] button')].find(b => b.textContent === "Sèries").click();
  for (let i = 0; i < 100 && !/Tots els dies es puntuen per a: sèries/.test(root.textContent); i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(app.type, "quality");
  assert.ok(dayBtns().every(b => /Sèries \/ Qualitat/.test(b.textContent) || /Ja no queden/.test(b.textContent)));
  // sense ubicació
  await db.setKV("settings", { hrMax: 176, hrRest: 45 });
  await renderClimate(root, { db, now: () => NOW });
  assert.match(root.textContent, /On corres\?/);
  assert.match(root.textContent, /El temps de cada sortida/);
});
