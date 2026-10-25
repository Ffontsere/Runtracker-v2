// Pantalla de Perfil i navegació, en un navegador simulat (jsdom) amb una base de dades i un Worker de mentida.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { makeDataset } from "./fixtures/make-dataset.mjs";

const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/<script type="module".*?<\/script>/, "");
const NOW = new Date("2026-10-24T09:00:00").getTime();
const KEY = "ab".repeat(32);
const WK = "https://ff-runtracker.ffontsere.workers.dev";

let openDB, start, renderProfile;
let dom;
function newDom(url = "https://ffontsere.github.io/Runtracker-v2/") {
  dom = new JSDOM(HTML, { url, pretendToBeVisual: true });
  for (const k of ["window", "document", "Node", "HTMLElement", "Event"]) globalThis[k] = k === "window" ? dom.window : dom.window[k];
  dom.window.__RT_TEST__ = true;
  return dom.window;
}
before(async () => {
  globalThis.IDBKeyRange = IDBKeyRange;
  newDom();
  ({ openDB } = await import("../js/data/db.js"));
  ({ start } = await import("../js/app.js"));
  ({ renderProfile } = await import("../js/ui/profile.js"));
});

/** Worker i Strava de mentida. `state.connected` decideix si hi ha tokens. */
function fakeNet(state = { connected: false }) {
  const calls = [];
  const res = (body, status = 200) => new Response(JSON.stringify(body), { status });
  const f = async (url, init = {}) => {
    url = String(url); calls.push((init.method || "GET") + " " + url);
    const auth = (init.headers || {}).Authorization || "";
    if (url === WK + "/") return res({ ok: true, app: "ff-runtracker" });
    if (url.startsWith(WK)) {
      if (auth !== "Bearer " + KEY) return res({ error: "unauthorized", message: "Clau de l'app incorrecta." }, 401);
      if (url.endsWith("/strava/token")) return state.connected ? res({ access_token: "T", expires_at: NOW / 1000 + 3600, athlete: { id: 1, firstname: "Francesc" } }) : res({ error: "not_connected", message: "Strava no està connectat." }, 409);
      if (url.endsWith("/strava/disconnect")) { state.connected = false; return res({ ok: true }); }
    }
    if (url.includes("/athlete/activities")) {
      const page = +new URL(url).searchParams.get("page");
      return res(page === 1 ? [{ id: 777, name: "Matí", sport_type: "Run", start_date_local: "2026-10-23T08:00:00Z", distance: 12000, moving_time: 3600, average_heartrate: 140 },
        { id: 778, name: "Bici", sport_type: "Ride", start_date_local: "2026-10-22T08:00:00Z", distance: 40000, moving_time: 5000 }] : []);
    }
    return res({}, 404);
  };
  f.calls = calls; return f;
}

async function waitFor(fn, what = "condició", ms = 4000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("Temps esgotat esperant: " + what);
    await new Promise(r => setTimeout(r, 15));
  }
}
const $ = sel => document.querySelector(sel);
const btn = text => { const all = [...document.querySelectorAll("button")]; return all.find(b => b.textContent.trim() === text) || all.find(b => b.textContent.trim().startsWith(text)); };
const status = () => $("#h-strava").parentElement.querySelector(".status").textContent;
const msgOf = id => $(id).closest("section").querySelector(".msg").textContent;

async function profile({ net = fakeNet(), db, win = {}, ...rest } = {}) {
  const w = newDom();
  db = db || await openDB(new IDBFactory());
  if (!(await db.getKV("settings"))) await db.setKV("settings", { hrMax: 176, hrRest: 45 });
  const assigned = [];
  const fakeWin = { location: { assign: u => assigned.push(u) }, localStorage: w.localStorage, confirm: () => true, ...win };
  const root = $("#view");
  await renderProfile(root, { db, fetchImpl: net, now: () => NOW, win: fakeWin, sleep: async () => {}, ...rest });
  return { db, net, assigned, w };
}

test("sense clau: ho diu i obre el formulari amb l'adreça del Worker ja posada", async () => {
  await profile();
  assert.equal(status(), "Falta la clau");
  assert.ok($("#wk-details").open);
  assert.equal($("#wk-url").value, WK);
  assert.match(msgOf("#h-strava"), /clau de l'app/);
  assert.match(msgOf("#h-data") + $("#h-data").closest("section").textContent, /Encara no hi ha cap sortida/);
});

test("clau mal enganxada: error clar i no es desa", async () => {
  const { db } = await profile();
  $("#wk-key").value = "hola";
  btn("Desa i comprova").click();
  await waitFor(() => /64 caràcters/.test(msgOf("#h-strava")), "missatge d'error");
  assert.equal(await db.getKV("worker"), null);
});

test("clau correcta sense Strava connectat: botó per connectar que porta al Worker", async () => {
  const { db, assigned } = await profile();
  $("#wk-key").value = KEY;
  btn("Desa i comprova").click();
  await waitFor(() => status() === "No connectat", "estat no connectat");
  assert.deepEqual(await db.getKV("worker"), { url: WK, appKey: KEY });
  const c = btn("Connecta Strava");
  assert.ok(c && !c.hidden);
  c.click();
  assert.deepEqual(assigned, [WK + "/strava/connect?key=" + KEY]);
});

test("una clau que el Worker no accepta es marca com a incorrecta", async () => {
  const db = await openDB(new IDBFactory());
  await db.setKV("worker", { url: WK, appKey: "cd".repeat(32) });
  await profile({ db });
  assert.equal(status(), "Clau incorrecta");
  assert.ok($("#wk-details").open);
});

test("importa de la v1 del mateix navegador, recalculant amb 176/45 i sense tocar la v1", async () => {
  const w = newDom();
  const { acts, settings, tempCache } = makeDataset();
  w.localStorage.setItem("rt4:a", JSON.stringify(acts));
  w.localStorage.setItem("rt4:s", JSON.stringify({ ...settings, hrMax: 190, hrRest: 43, stravaSecret: "x" }));
  w.localStorage.setItem("rt4:temps", JSON.stringify(tempCache));
  const before = { ...w.localStorage };
  const db = await openDB(new IDBFactory());
  await db.setKV("settings", { hrMax: 176, hrRest: 45 });
  const root = $("#view");
  await renderProfile(root, { db, fetchImpl: fakeNet(), now: () => NOW, win: { location: {}, localStorage: w.localStorage, confirm: () => true } });
  const b = btn("Importa");
  assert.match(b.textContent, new RegExp(`Importa ${acts.length.toLocaleString("ca-ES").replace(".", "\\.")} sortides de la v1`));
  b.click();
  await waitFor(() => /Importades/.test(msgOf("#h-data")), "importació");
  assert.equal(await db.count("activities"), acts.length);
  const s = await db.getKV("settings");
  assert.equal(s.hrMax, 176); assert.equal(s.hrRest, 45); assert.equal(s.stravaSecret, undefined);
  assert.equal(s.weight, 70, "es queda el pes de la v1");
  assert.deepEqual({ ...w.localStorage }, before, "la v1 no es toca");
  assert.match($("#h-data").closest("section").querySelector(".stats").textContent, new RegExp(String(new Date(acts[0].date).getFullYear())));
});

test("connectat: sincronitza només les curses noves i ho explica", async () => {
  const db = await openDB(new IDBFactory());
  await db.setKV("worker", { url: WK, appKey: KEY });
  const net = fakeNet({ connected: true });
  await profile({ db, net });
  assert.equal(status(), "Connectat");
  assert.match(msgOf("#h-strava"), /com a Francesc/);
  // sense dades: també es pot baixar tot de Strava
  btn("Sincronitza ara").click();
  await waitFor(() => /1 sortida nova/.test(msgOf("#h-data")), "sincronització");
  assert.equal(await db.count("activities"), 1, "la bici no entra");
  assert.ok((await db.getKV("syncState")).lastSync === NOW);
});

test("desconnectar demana confirmació i deixa les dades", async () => {
  const db = await openDB(new IDBFactory());
  await db.setKV("worker", { url: WK, appKey: KEY });
  await db.put("activities", { id: "strava-1", date: "2026-10-01", distance: 10, source: "strava" });
  let asked = 0;
  await profile({ db, net: fakeNet({ connected: true }), win: { confirm: () => (asked++, true) } });
  btn("Desconnecta").click();
  await waitFor(() => status() === "No connectat", "desconnectat");
  assert.equal(asked, 1);
  assert.equal(await db.count("activities"), 1);
});

test("canviar la FC recalcula totes les sortides", async () => {
  const db = await openDB(new IDBFactory());
  const { acts } = makeDataset();
  await db.putMany("activities", acts.slice(-40).map(a => ({ ...a, trimp: 1 })));
  await db.setKV("settings", { hrMax: 176, hrRest: 45, weeklyTarget: 45 });
  await profile({ db });
  $("#ph-hrmax").value = "180"; $("#ph-weight").value = "70.5"; $("#ph-height").value = "179.5";
  btn("Desa").click();
  await waitFor(() => /recalculades/.test(msgOf("#h-phys")), "recàlcul");
  const s = await db.getKV("settings");
  assert.deepEqual([s.hrMax, s.hrRest, s.weight, s.height, s.weeklyTarget], [180, 45, 70.5, 179.5, 45]);
  const after = await db.getAll("activities");
  assert.ok(after.every(a => a.trimp !== 1 || !a.avgHR), "el TRIMP s'ha recalculat");
});

test("valors de FC impossibles no es desen", async () => {
  const { db } = await profile();
  $("#ph-hrrest").value = "190";
  btn("Desa").click();
  await waitFor(() => /per sota de la màxima/.test(msgOf("#h-phys")), "error");
  assert.equal((await db.getKV("settings")).hrRest, 45);
});

test("tornada de Strava: va al Perfil, ho diu i sincronitza sola", async () => {
  const w = newDom("https://ffontsere.github.io/Runtracker-v2/#strava=ok");
  const db = await openDB(new IDBFactory());
  await db.setKV("worker", { url: WK, appKey: KEY });
  const net = fakeNet({ connected: true });
  const app = await start({ win: w, db, fetchImpl: net, now: () => NOW });
  await app.ready;
  assert.equal(app.route(), "perfil");
  assert.equal(w.location.hash, "#/perfil");
  assert.match(msgOf("#h-strava"), /Strava connectat/);
  assert.ok(net.calls.some(c => c.includes("/athlete/activities")));
  assert.match(msgOf("#h-data"), /1 sortida nova/);
  assert.equal($('.icon-btn[data-route="perfil"]').getAttribute("aria-current"), "page");
});

test("tornada amb error: ho explica", async () => {
  const w = newDom("https://ffontsere.github.io/Runtracker-v2/#strava=error&motiu=Has%20cancel%C2%B7lat%20el%20perm%C3%ADs%20a%20Strava.");
  const db = await openDB(new IDBFactory());
  await db.setKV("worker", { url: WK, appKey: KEY });
  const app = await start({ win: w, db, fetchImpl: fakeNet(), now: () => NOW });
  await app.ready;
  assert.match(msgOf("#h-strava"), /No s'ha connectat: Has cancel·lat/);
});

test("navegació: pestanya marcada i pantalles pendents", async () => {
  const w = newDom("https://ffontsere.github.io/Runtracker-v2/#/clima");
  const db = await openDB(new IDBFactory());
  const app = await start({ win: w, db, fetchImpl: fakeNet(), now: () => NOW });
  await app.ready;
  assert.equal(app.route(), "clima");
  assert.equal($('.nav [data-route="clima"]').getAttribute("aria-current"), "page");
  assert.equal($("#view h1").textContent, "Clima");
  assert.deepEqual(await db.getKV("settings"), { hrMax: 176, hrRest: 45, weeklyTarget: 45, yearlyGoal: 2200 }, "configuració per defecte, amb els objectius de la v1");
});
