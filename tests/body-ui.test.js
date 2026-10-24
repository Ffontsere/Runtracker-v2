// Pantalla Cos i dades del cos.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";

const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/<script type="module".*?<\/script>/, "");
const NOW = new Date("2026-10-24T09:00:00").getTime();
let openDB, renderBody, renderToday, B;

before(async () => {
  globalThis.IDBKeyRange = IDBKeyRange;
  const dom = new JSDOM(HTML, { url: "https://ffontsere.github.io/Runtracker-v2/", pretendToBeVisual: true });
  for (const k of ["window", "document", "Node", "HTMLElement", "Event"]) globalThis[k] = k === "window" ? dom.window : dom.window[k];
  ({ openDB } = await import("../js/data/db.js"));
  ({ renderBody } = await import("../js/ui/body.js"));
  ({ renderToday } = await import("../js/ui/today.js"));
  B = await import("../js/data/body.js");
});
const wait = async (fn, ms = 3000) => { const t = Date.now(); while (!(await fn())) { if (Date.now() - t > ms) throw new Error("temps esgotat"); await new Promise(r => setTimeout(r, 10)); } };
const btn = (root, re) => [...root.querySelectorAll("button")].find(b => re.test(b.textContent));

async function screen(setup = async () => {}, confirm = () => true) {
  const db = await openDB(new IDBFactory());
  await db.setKV("settings", { hrMax: 176, hrRest: 45 });
  await setup(db);
  const root = document.getElementById("view");
  await renderBody(root, { db, now: () => NOW, noSync: true, win: { confirm } });
  return { db, root };
}

test("dades: validació, desar i esborrar amb marca", async () => {
  const db = await openDB(new IDBFactory());
  await assert.rejects(B.addEntry(db, { date: "2026-10-20" }), /almenys una mesura/);
  await assert.rejects(B.addEntry(db, { date: "2026-10-20", weight: 7 }), /Pes ha d'estar entre 30 i 200/);
  const e = await B.addEntry(db, { date: "2026-10-20", weight: "70.2", waist: "", neck: null }, 10);
  assert.deepEqual({ ...e }, { id: "cos-2026-10-20-10", date: "2026-10-20", weight: 70.2, updatedAt: 10 });
  await B.deleteEntry(db, e.id, 20);
  assert.deepEqual(await B.loadBody(db), []);
  assert.equal((await db.get("body", e.id)).deleted, true);
  assert.equal(B.sexOf("M"), "male"); assert.equal(B.sexOf("F"), "female");
});

test("primer cop: ofereix les mesures del 18/10 i calcula els índexs", async () => {
  const { db, root } = await screen();
  assert.match(root.textContent, /El 18 d'octubre em vas donar: 70,5 kg/);
  btn(root, /^Afegeix-les$/).click();
  await wait(() => root.querySelector(".tile-v"));
  assert.equal((await db.getKV("settings")).height, 179.5);
  const t = root.textContent;
  assert.match(t, /0,44/, "cintura/alçada");
  assert.match(t, /0,84/, "cintura/maluc");
  assert.match(t, /Saludable \(< 0,5\)/);
  assert.match(t, /113\s*g/, "proteïna");
});

test("nova mesura i esborrar-la", async () => {
  const { db, root } = await screen(async db => { await db.setKV("settings", { hrMax: 176, hrRest: 45, height: 179.5 }); await B.addEntry(db, { date: "2026-10-18", weight: 70.5 }, 1); });
  root.querySelector("#b-weight").value = "70,1";
  root.querySelector("form").dispatchEvent(new window.Event("submit", { cancelable: true }));
  await wait(async () => (await B.loadBody(db)).length === 2);
  await wait(() => /Mesura desada/.test(root.textContent));
  assert.ok(root.querySelector(".spark"), "amb dues pesades surt la línia");
  root.querySelector("#b-weight").value = "700";
  root.querySelector("form").dispatchEvent(new window.Event("submit", { cancelable: true }));
  await wait(() => /Pes ha d'estar entre 30 i 200/.test(root.textContent));
  btn(root, /^Esborra$/).click();
  await wait(async () => (await B.loadBody(db)).length === 1);
});

test("l'Avui calcula la proteïna amb el pes del Cos", async () => {
  const db = await openDB(new IDBFactory());
  await db.setKV("settings", { hrMax: 176, hrRest: 45, weight: 60 });
  await db.put("activities", { id: "a1", date: "2026-10-20", distance: 10, duration: 3300, avgHR: 140, trimp: 60, source: "strava" });
  await B.addEntry(db, { date: "2026-10-23", weight: 75 }, 1);
  const root = document.getElementById("view");
  await renderToday(root, { db, now: () => NOW, fetchImpl: async () => { throw new Error("x"); } });
  assert.match(root.textContent, /120 g.*mitjana de 7 dies del Cos/s);
});
