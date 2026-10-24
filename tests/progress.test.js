// Progrés: marques amb millors esforços (BUGS-v1 #2), VDOT de debò (#3), forma i projecció, i la pantalla.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { makeDataset } from "./fixtures/make-dataset.mjs";
import { timeFromEfforts, personalBests, vdotOf, timeForVdot, predictions, formSeries, weeklyVolume, yearProgress } from "../js/engine/progress.js";
import { calcPRs } from "../js/engine/performance.js";
import { calcFF } from "../js/engine/load.js";

const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/<script type="module".*?<\/script>/, "");
const NOW = new Date("2026-10-24T09:00:00").getTime();
let openDB, renderProgress;
before(async () => {
  globalThis.IDBKeyRange = IDBKeyRange;
  const dom = new JSDOM(HTML, { url: "https://ffontsere.github.io/Runtracker-v2/", pretendToBeVisual: true });
  for (const k of ["window", "document", "Node", "HTMLElement", "Event"]) globalThis[k] = k === "window" ? dom.window : dom.window[k];
  ({ openDB } = await import("../js/data/db.js"));
  ({ renderProgress } = await import("../js/ui/progress.js"));
});

test("temps per a una distància a partir dels millors esforços (interpolació)", () => {
  const be = { 300: 4.0, 600: 3.8, 1200: 3.6, 1800: 3.5, 3600: 3.3 }; // m/s
  assert.equal(timeFromEfforts(be, 1.2), 300, "exacte: 4 m/s × 300 s = 1,2 km");
  const t5 = timeFromEfforts(be, 5);
  assert.ok(t5 > 1200 && t5 < 1800, "5 km cau entre 20 i 30 min: " + t5);
  assert.equal(timeFromEfforts(be, 21.1), null, "més enllà de 3.600 s no s'inventa");
  assert.equal(timeFromEfforts(null, 5), null);
});

test("marques: un 10 km dins d'una tirada de 15 compta, i mai surt pitjor que a la v1", () => {
  const acts = [
    { id: "a", date: "2026-09-01", distance: 10.2, duration: 3000, pace: 3000 / 10.2 },               // 10 km sencer a 4:54
    { id: "b", date: "2026-10-01", distance: 15, duration: 4500, pace: 300, be: { 1800: 3.6, 3600: 3.45 } }, // tram de 10 km més ràpid
  ];
  const v1 = calcPRs({ acts }), v2 = personalBests({ acts });
  assert.equal(v2["10 km"].id, "b"); assert.equal(v2["10 km"].src, "esforç");
  assert.ok(v2["10 km"].time < v1["10 km"].time);
  const { acts: real } = makeDataset();
  const r1 = calcPRs({ acts: real }), r2 = personalBests({ acts: real });
  for (const k of Object.keys(r1)) if (r1[k]) assert.ok(r2[k].time <= Math.round(r1[k].time), k);
});

test("VDOT de Daniels: s'inverteix bé i dona les taules conegudes", () => {
  assert.ok(Math.abs(vdotOf(5, 20 * 60) - 49.8) < 0.3, "5 km en 20:00 ≈ VDOT 50");
  const t = timeForVdot(vdotOf(10, 2400), 10);
  assert.ok(Math.abs(t - 2400) <= 5, "inversa amb el VDOT arrodonit a una dècima: " + t);
  const m = timeForVdot(50, 42.195);
  assert.ok(m > 3 * 3600 + 5 * 60 && m < 3 * 3600 + 15 * 60, "VDOT 50 → marató entre 3:05 i 3:15: " + m);
  const p = predictions({ acts: [], now: NOW }, { "1 km": null, "5 km": { time: 1200, date: "2026-10-01", src: "sortida" }, "10 km": null, "Mitja": null, "Marató": null });
  assert.equal(p.ref.n, "5 km"); assert.equal(p.rows.find(r => r.n === "5 km").vdot, 1200);
});

test("forma: la projecció continua des d'avui amb la càrrega mitjana de 28 dies", () => {
  const { acts, settings } = makeDataset();
  const ctx = { acts, settings, now: NOW };
  const fs = formSeries(ctx, 120, 14);
  assert.equal(fs.past.length, 120); assert.equal(fs.proj.length, 14);
  const ff = calcFF(ctx);
  assert.deepEqual(fs.past.at(-1), ff.at(-1));
  assert.equal(fs.proj[0].date, "2026-10-25");
  // amb força, la càrrega diària puja
  const withStrength = formSeries({ ...ctx, extraDaily: { "2026-10-20": 280 } }, 120, 14);
  assert.equal(Math.round((withStrength.daily - fs.daily) * 10) / 10, 10);
  const wv = weeklyVolume(ctx, 16);
  assert.equal(wv.length, 16); assert.equal(wv.at(-1).week, "2026-10-19"); assert.ok(wv.at(-1).current);
  const yp = yearProgress(ctx);
  assert.equal(yp.goal, 2200); assert.ok(yp.expected > 1600 && yp.expected < 1800);
});

test("pantalla: els tres apartats amb gràfics, taules i el tram marcat", async () => {
  const db = await openDB(new IDBFactory());
  const { acts, settings } = makeDataset();
  await db.putMany("activities", acts);
  await db.setKV("settings", { ...settings, hrMax: 176, hrRest: 45 });
  const root = document.getElementById("view");
  const app = { db, now: () => NOW };
  await renderProgress(root, app);
  assert.match(root.textContent, /Fitness i fatiga/);
  assert.equal(root.querySelectorAll(".chart-svg").length, 3, "CTL/ATL, TSB i volum");
  assert.ok(root.querySelector(".chart-line.dashed"), "projecció discontínua");
  assert.ok(root.querySelector(".chart-legend"), "llegenda amb dues sèries");
  [...root.querySelectorAll('[role="tab"]')].find(b => b.textContent === "Rendiment").click();
  assert.equal(app.sub, "rendiment");
  assert.match(root.textContent, /Marques.*Predicció.*VDOT \(Daniels\)/s);
  assert.equal(root.querySelectorAll("#h-pr ~ table tbody tr").length, 5);
  [...root.querySelectorAll('[role="tab"]')].find(b => b.textContent === "Fisiologia").click();
  assert.match(root.textContent, /VO₂max.*Eficiència aeròbica.*Zones/s);
  assert.doesNotMatch(root.textContent, /NaN/);
  // el cursor del gràfic mostra els valors
  [...root.querySelectorAll('[role="tab"]')].find(b => b.textContent === "Forma").click();
  const hit = root.querySelector(".chart-svg rect[tabindex]");
  hit.dispatchEvent(new window.FocusEvent("focus"));
  const tip = root.querySelector(".chart-tip");
  assert.equal(tip.hidden, false);
  assert.match(tip.textContent, /Fitness \(CTL\).*Fatiga \(ATL\)/s);
});

test("ritme i durada: s'arrodoneix el total (mai 4:60)", async () => {
  const { fmtPace, fmtDur, fmtDayMonth } = await import("../js/ui/dom.js");
  assert.equal(fmtPace(299.6), "5:00"); assert.equal(fmtPace(298.4), "4:58"); assert.equal(fmtPace(null), "—");
  assert.equal(fmtDur(3599.7), "1:00:00"); assert.equal(fmtDur(59.6), "1:00"); assert.equal(fmtDur(4516), "1:15:16");
  assert.equal(fmtDayMonth("2026-10-04"), "4/10");
});

test("zones: manuals, validació, recàlcul de totes les sortides i tornar a les automàtiques", async () => {
  const { activeZones, validateZones } = await import("../js/engine/progress.js");
  assert.equal(activeZones({ acts: [], settings: { hrMax: 176, hrRest: 45, zones: [125, 140, 155, 166] }, now: NOW }).source, "manual");
  assert.match(validateZones([125, 140, 138, 166], { hrMax: 176, hrRest: 45 }), /més alt que l'anterior/);
  assert.match(validateZones([40, 140, 155, 166], { hrMax: 176, hrRest: 45 }), /FC en repòs/);
  assert.match(validateZones([125, 140, 155, 180], { hrMax: 176, hrRest: 45 }), /FC màxima/);
  assert.equal(validateZones([125, 140, 155, 166], { hrMax: 176, hrRest: 45 }), null);

  const db = await openDB(new IDBFactory());
  const { acts, settings } = makeDataset();
  await db.putMany("activities", acts.slice(-30).map(a => ({ ...a, avgHR: 138 })));
  await db.setKV("settings", { ...settings, hrMax: 176, hrRest: 45 });
  const root = document.getElementById("view");
  const app = { db, now: () => NOW, sub: "fisio" };
  await renderProgress(root, app);
  const set = vals => vals.forEach((v, i) => { root.querySelector(`#zb-${i}`).value = String(v); });
  set([125, 140, 138, 166]);
  [...root.querySelectorAll("button")].find(b => b.textContent === "Desa i recalcula").click();
  assert.match(root.textContent, /més alt que l'anterior/);
  set([125, 142, 156, 166]);
  [...root.querySelectorAll("button")].find(b => b.textContent === "Desa i recalcula").click();
  for (let i = 0; i < 200 && !/sortides recalculades/.test(root.textContent); i++) await new Promise(r => setTimeout(r, 10));
  assert.deepEqual((await db.getKV("settings")).zones, [125, 142, 156, 166]);
  assert.ok((await db.getAll("activities")).every(a => a.hrZone === 1), "138 ppm passa a Z2 amb LT1 a 142");
  assert.match(root.querySelector("#h-zones").parentElement.textContent, /manuals/);
  assert.match(root.textContent, /Z3 Tempo142–156/);
  [...root.querySelectorAll("button")].find(b => b.textContent === "Torna a les automàtiques").click();
  for (let i = 0; i < 200 && (await db.getKV("settings")).zones !== null; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal((await db.getKV("settings")).zones, null);
});
