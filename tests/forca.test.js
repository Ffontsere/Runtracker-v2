// Força a l'app: calendari i context, desar sessions, i la pantalla en un navegador simulat.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { makeDataset } from "./fixtures/make-dataset.mjs";
import { regularWeeks, longRunDow, nextSession, strengthDaily, strengthContext } from "../js/engine/schedule.js";
import { planSession, initState } from "../js/engine/strength.js";

const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/<script type="module".*?<\/script>/, "");
const at = s => new Date(s).getTime();
let openDB, renderStrength, renderToday, renderProfile, data;

before(async () => {
  globalThis.IDBKeyRange = IDBKeyRange;
  const dom = new JSDOM(HTML, { url: "https://ffontsere.github.io/Runtracker-v2/", pretendToBeVisual: true });
  for (const k of ["window", "document", "Node", "HTMLElement", "Event"]) globalThis[k] = k === "window" ? dom.window : dom.window[k];
  ({ openDB } = await import("../js/data/db.js"));
  ({ renderStrength } = await import("../js/ui/strength.js"));
  ({ renderToday } = await import("../js/ui/today.js"));
  ({ renderProfile } = await import("../js/ui/profile.js"));
  data = await import("../js/data/strength.js");
});

const run = (date, distance = 10) => ({ id: "r" + date + distance, date, distance, duration: distance * 330, avgHR: 140, trimp: 60, source: "strava" });

test("setmanes regulars: compta enrere fins a la primera setmana amb menys de 2 sortides", () => {
  const acts = [];
  // 7 setmanes amb 3 sortides (des del 7/9), una setmana buida abans
  for (let w = 0; w < 7; w++) for (const d of [1, 3, 5]) { const x = new Date(at("2026-09-07T12:00") + (w * 7 + d - 1) * 864e5); acts.push(run(x.toISOString().slice(0, 10))); }
  acts.push(run("2026-08-24"));
  assert.equal(regularWeeks(acts, at("2026-10-24T10:00")), 7);
  // dilluns d'una setmana nova sense sortides: no es perd la ratxa
  assert.equal(regularWeeks(acts, at("2026-10-26T08:00")), 7);
  assert.equal(regularWeeks([], at("2026-10-24T10:00")), 0);
});

test("dia de la llarga: el més repetit de la sortida més llarga de cada setmana", () => {
  const acts = [];
  for (const sun of ["2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27", "2026-10-04", "2026-10-11", "2026-10-18"]) {
    acts.push(run(sun, 21));
    const tue = new Date(at(sun + "T12:00") - 5 * 864e5).toISOString().slice(0, 10); acts.push(run(tue, 10));
  }
  assert.equal(longRunDow(acts, at("2026-10-24T10:00")), 0, "diumenge");
  const ctx = strengthContext({ acts, now: at("2026-10-24T10:00"), sessions: [] });
  assert.equal(ctx.dayBeforeLong, true, "dissabte, demà llarga");
  assert.equal(strengthContext({ acts, now: at("2026-10-22T10:00") }).dayBeforeLong, false);
});

test("quina sessió toca", () => {
  const s = { strengthDays: { A: 1, B: 4 } };
  assert.deepEqual(nextSession([], s, at("2026-10-26T10:00")), { type: "A", due: true, doneToday: null }); // dilluns
  assert.equal(nextSession([], s, at("2026-10-29T10:00")).type, "B"); // dijous
  const done = [{ date: "2026-10-26", type: "A", savedAt: 1 }];
  const r = nextSession(done, s, at("2026-10-26T19:00"));
  assert.equal(r.type, "B"); assert.equal(r.due, false); assert.equal(r.doneToday.type, "A");
  // un dia qualsevol: la que fa més temps
  assert.equal(nextSession([{ date: "2026-10-20", type: "A" }, { date: "2026-10-22", type: "B" }], s, at("2026-10-24T10:00")).type, "A");
  assert.deepEqual(strengthDaily([{ date: "2026-10-20", minutes: 30, rpe: 6 }, { date: "2026-10-20", load: 10 }]), { "2026-10-20": 100 });
});

test("desar una sessió: aplica la progressió, desa sessió i estat junts i buida l'esborrany", async () => {
  const db = await openDB(new IDBFactory());
  const st = initState();
  const ctx = { tsb: 0, acwr: 1, regularWeeks: 8 };
  const plan = planSession("A", st, ctx);
  const draft = {};
  // genoll al màxim i molt fàcil: puja
  const g = plan.exercises.find(e => e.pattern === "genoll");
  data.draftFor(draft, "A", g).reps = Array(g.sets).fill(g.hi); data.draftFor(draft, "A", g).rir = 4;
  const r = await data.finishSession(db, { type: "A", state: st, ctx, draft, minutes: 32, rpe: 7, date: "2026-10-26", now: 5 });
  assert.equal(r.state.genoll.level, st.genoll.level + 1);
  assert.equal(r.session.load, 112);
  const back = await data.loadStrength(db);
  assert.equal(back.sessions.length, 1);
  assert.equal(back.state.genoll.level, st.genoll.level + 1);
  assert.deepEqual(back.draft, {});
  // la pliometria s'ha de marcar
  const p = planSession("B", back.state, ctx);
  await assert.rejects(data.finishSession(db, { type: "B", state: back.state, ctx, draft: {}, minutes: 30, rpe: 6, date: "2026-10-29" }), new RegExp("Marca com ha anat: " + p.exercises.find(e => e.plyo).name));
  assert.equal((await data.loadStrength(db)).sessions.length, 1, "no s'ha desat res");
});

async function strengthScreen(now, setup = async () => {}) {
  const db = await openDB(new IDBFactory());
  const { acts, settings } = makeDataset();
  await db.putMany("activities", acts);
  await db.setKV("settings", { ...settings, hrMax: 176, hrRest: 45 });
  await setup(db);
  const root = document.getElementById("view");
  const app = { db, now: () => now };
  await renderStrength(root, app);
  return { db, root, app };
}
const btns = (root, re) => [...root.querySelectorAll("button")].filter(b => re.test(b.textContent));

test("pantalla: dilluns toca A, es registren sèries i es desa", async () => {
  const { db, root } = await strengthScreen(at("2026-10-26T18:00"));
  assert.match(root.querySelector("h2").textContent, /Sessió A · Cames fortes/);
  assert.equal(root.querySelectorAll(".ex").length, 4);
  const card = root.querySelector('[data-pattern="genoll"]');
  const before = +card.querySelector("output").textContent;
  card.querySelector('button[aria-label="Més a la sèrie 1"]').click();
  assert.equal(+root.querySelector('[data-pattern="genoll"] output').textContent, before + 1);
  await new Promise(r => setTimeout(r, 300));
  const d = await db.getKV("strengthDraft");
  assert.ok(Object.values(d).some(x => x.reps && x.reps[0] === before + 1), "l'esborrany es desa");
  btns(root, /^Desa la sessió$/)[0].click();
  for (let i = 0; i < 100 && !root.querySelector(".saved"); i++) await new Promise(r => setTimeout(r, 10));
  assert.match(root.textContent, /Sessió desada/);
  assert.equal((await db.getAll("strength")).length, 1);
  assert.match(root.querySelector("h2:not(#h-saved)").textContent, /Sessió B/, "després toca l'altra");
});

test("pantalla: canviar A/B i el nivell d'un moviment", async () => {
  const { db, root } = await strengthScreen(at("2026-10-24T10:00"));
  btns(root, /^B$/)[0].click();
  assert.match(root.textContent, /Sessió B · Tronc, potència i tendons/);
  assert.ok(btns(root, /^Cronometra \d+ s$/).length >= 4, "isomètrics amb cronòmetre");
  const sel = root.querySelector("#lvl-empenta");
  sel.value = "3"; sel.dispatchEvent(new window.Event("change"));
  for (let i = 0; i < 100 && (await db.getKV("strengthState"))?.empenta?.level !== 3; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal((await db.getKV("strengthState")).empenta.level, 3);
  assert.match(root.querySelector('[data-pattern="empenta"] .ex-name').textContent, /peus a la cadira/);
});

test("Avui avisa que toca força i el Perfil desa els dies", async () => {
  const db = await openDB(new IDBFactory());
  const { acts, settings } = makeDataset();
  await db.putMany("activities", acts);
  await db.setKV("settings", { ...settings, hrMax: 176, hrRest: 45, strengthDays: { A: 6, B: 3 } });
  const root = document.getElementById("view");
  await renderToday(root, { db, now: () => at("2026-10-24T09:00"), fetchImpl: async () => { throw new Error("sense xarxa"); } });
  assert.match(root.textContent, /Toca la sessió A/);
  assert.equal(root.querySelector('a[href="#/forca"]').textContent, "Comença");
  await renderProfile(root, { db, now: () => at("2026-10-24T09:00"), fetchImpl: async () => new Response("{}"), win: { location: {}, localStorage: window.localStorage, confirm: () => true } });
  const sel = root.querySelector("#sd-B");
  assert.equal(sel.value, "3");
  sel.value = "4"; sel.dispatchEvent(new window.Event("change"));
  for (let i = 0; i < 100 && (await db.getKV("settings")).strengthDays.B !== 4; i++) await new Promise(r => setTimeout(r, 10));
  assert.deepEqual((await db.getKV("settings")).strengthDays, { A: 6, B: 4 });
});
