import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/src/index.js";

const APP_KEY = "clau-de-prova-molt-llarga-0123456789";
const NOW = Date.parse("2026-10-24T09:00:00Z");

function kv() {
  const m = new Map();
  return { m, get: async k => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); } };
}
let env, calls, realFetch;
beforeEach(() => {
  env = { STRAVA_CLIENT_ID: "220720", STRAVA_CLIENT_SECRET: "secret", APP_KEY, APP_URL: "https://ffontsere.github.io/runtracker-v2/", FF_DATA: kv() };
  calls = []; realFetch = globalThis.fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

const stravaReplies = (...replies) => {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
    const r = replies.shift();
    return new Response(JSON.stringify(r.body), { status: r.status || 200 });
  };
};
const call = (path, { method = "GET", key = APP_KEY, body } = {}) =>
  worker.fetch(new Request("https://ff-runtracker.ffontsere.workers.dev" + path, {
    method, headers: { ...(key ? { Authorization: "Bearer " + key } : {}), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }), env, {}, NOW);

async function connectFlow() {
  const r1 = await call("/strava/connect?key=" + APP_KEY, { key: null });
  assert.equal(r1.status, 302);
  const auth = new URL(r1.headers.get("Location"));
  assert.equal(auth.origin + auth.pathname, "https://www.strava.com/oauth/authorize");
  assert.equal(auth.searchParams.get("redirect_uri"), "https://ff-runtracker.ffontsere.workers.dev/strava/callback");
  const state = auth.searchParams.get("state");
  stravaReplies({ body: { access_token: "A1", refresh_token: "R1", expires_at: NOW / 1000 + 21600, athlete: { id: 7, firstname: "Francesc", city: "La Garriga" } } });
  const r2 = await call(`/strava/callback?code=CODI&state=${state}&scope=read,activity:read_all`, { key: null });
  assert.equal(r2.status, 302);
  return r2.headers.get("Location");
}

test("connecta amb Strava i el secret no surt mai cap a l'app", async () => {
  const back = await connectFlow();
  assert.equal(back, "https://ffontsere.github.io/runtracker-v2/#strava=ok");
  assert.equal(calls[0].body.client_secret, "secret");
  assert.equal(calls[0].body.grant_type, "authorization_code");
  const r = await call("/strava/token", { method: "POST" });
  const body = await r.json();
  assert.deepEqual(body, { access_token: "A1", expires_at: NOW / 1000 + 21600, athlete: { id: 7, firstname: "Francesc" } });
  assert.ok(!JSON.stringify(body).includes("R1") && !JSON.stringify(body).includes("secret"));
});

test("sense la clau de l'app no es pot iniciar la connexió ni demanar tokens", async () => {
  assert.equal((await call("/strava/connect?key=dolenta", { key: null })).status, 401);
  assert.equal((await call("/strava/token", { method: "POST", key: "dolenta" })).status, 401);
  assert.equal((await call("/strava/token", { method: "POST", key: null })).status, 401);
});

test("un callback sense state vàlid no desa res", async () => {
  const r = await call("/strava/callback?code=X&state=inventat&scope=activity:read_all", { key: null });
  assert.match(r.headers.get("Location"), /strava=error/);
  assert.equal(env.FF_DATA.m.has("runtracker:strava:tokens"), false);
});

test("el state només serveix una vegada", async () => {
  const r1 = await call("/strava/connect?key=" + APP_KEY, { key: null });
  const state = new URL(r1.headers.get("Location")).searchParams.get("state");
  stravaReplies({ body: { access_token: "A", refresh_token: "R", expires_at: 1 } });
  await call(`/strava/callback?code=C&state=${state}&scope=activity:read_all`, { key: null });
  const again = await call(`/strava/callback?code=C&state=${state}&scope=activity:read_all`, { key: null });
  assert.match(again.headers.get("Location"), /strava=error/);
});

test("sense permís de lectura d'activitats, avisa", async () => {
  const r1 = await call("/strava/connect?key=" + APP_KEY, { key: null });
  const state = new URL(r1.headers.get("Location")).searchParams.get("state");
  const r = await call(`/strava/callback?code=C&state=${state}&scope=read`, { key: null });
  assert.match(decodeURIComponent(r.headers.get("Location")), /permís per llegir/);
});

test("renova el token quan està a punt de caducar i guarda el refresh nou", async () => {
  await connectFlow();
  const t = JSON.parse(env.FF_DATA.m.get("runtracker:strava:tokens"));
  t.expires_at = NOW / 1000 + 60; env.FF_DATA.m.set("runtracker:strava:tokens", JSON.stringify(t));
  stravaReplies({ body: { access_token: "A2", refresh_token: "R2", expires_at: NOW / 1000 + 21600 } });
  const body = await (await call("/strava/token", { method: "POST" })).json();
  assert.equal(body.access_token, "A2");
  assert.equal(calls.at(-1).body.refresh_token, "R1");
  assert.equal(JSON.parse(env.FF_DATA.m.get("runtracker:strava:tokens")).refresh_token, "R2");
});

test("si Strava retira el permís, demana reconnectar; si està caigut, ho diu", async () => {
  await connectFlow();
  const t = JSON.parse(env.FF_DATA.m.get("runtracker:strava:tokens")); t.expires_at = 0;
  env.FF_DATA.m.set("runtracker:strava:tokens", JSON.stringify(t));
  stravaReplies({ status: 400, body: { message: "Bad Request" } });
  const r = await call("/strava/token", { method: "POST" });
  assert.equal(r.status, 409); assert.equal((await r.json()).error, "reconnect");
  stravaReplies({ status: 503, body: { message: "down" } });
  const r2 = await call("/strava/token", { method: "POST" });
  assert.equal(r2.status, 502); assert.equal((await r2.json()).error, "strava_unavailable");
});

test("sense connexió prèvia, ho diu clar", async () => {
  const r = await call("/strava/token", { method: "POST" });
  assert.equal(r.status, 409); assert.equal((await r.json()).error, "not_connected");
});

test("còpia de força i cos amb control de versions", async () => {
  assert.deepEqual(await (await call("/sync/strength")).json(), { value: null, version: 0, updatedAt: null });
  const p1 = await call("/sync/strength", { method: "PUT", body: { value: [{ id: "s1" }], baseVersion: 0 } });
  assert.equal((await p1.json()).version, 1);
  // Un altre mòbil desa sobre la versió 0, ja superada: conflicte amb la versió actual.
  const p2 = await call("/sync/strength", { method: "PUT", body: { value: [{ id: "x" }], baseVersion: 0 } });
  assert.equal(p2.status, 409);
  assert.deepEqual((await p2.json()).current.value, [{ id: "s1" }]);
  const g = await (await call("/sync/strength")).json();
  assert.equal(g.version, 1); assert.deepEqual(g.value, [{ id: "s1" }]);
  assert.equal((await call("/sync/altres")).status, 404);
  assert.equal((await call("/sync/body", { method: "PUT", body: { value: 1 } })).status, 400);
});

test("CORS només per a l'app i error clar si falta configuració", async () => {
  const r = await call("/sync/body", { method: "OPTIONS", key: null });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://ffontsere.github.io");
  delete env.STRAVA_CLIENT_SECRET;
  const e = await call("/");
  assert.equal(e.status, 500);
  assert.match((await e.json()).message, /STRAVA_CLIENT_SECRET/);
});

// ── Garmin ──
const PUSH = "clau-de-l-action-molt-llarga-9876543210";
const withPush = () => { env.GARMIN_PUSH_KEY = PUSH; };

test("Garmin: sense GARMIN_PUSH_KEY les rutes d'escriptura no existeixen", async () => {
  const r = await call("/garmin/wellness", { method: "PUT", key: PUSH, body: { days: {} } });
  assert.equal(r.status, 404); assert.equal((await r.json()).error, "garmin_off");
});

test("Garmin: la clau de l'app no serveix per escriure ni per llegir els tokens, i la de l'Action no serveix per a la resta", async () => {
  withPush();
  assert.equal((await call("/garmin/wellness", { method: "PUT", key: APP_KEY, body: { days: {} } })).status, 401);
  assert.equal((await call("/garmin/tokens", { key: APP_KEY })).status, 401);
  assert.equal((await call("/garmin/tokens", { key: null })).status, 401);
  assert.equal((await call("/garmin/wellness", { key: PUSH })).status, 401, "llegir benestar és per a l'app");
  assert.equal((await call("/sync/body", { key: PUSH })).status, 401, "la clau de l'Action no obre la resta");
  assert.equal((await call("/strava/token", { method: "POST", key: PUSH })).status, 401);
});

test("Garmin: l'Action escriu benestar, es combina per dia i l'app el llegeix", async () => {
  withPush();
  assert.deepEqual(await (await call("/garmin/wellness")).json(), { days: {}, updatedAt: null });
  const p1 = await call("/garmin/wellness", { method: "PUT", key: PUSH, body: { days: {
    "2026-10-30": { rhr: 46, hrvLast: 62.456, hrvStatus: "BALANCED", sleepSec: 27000, sleepScore: 81, inventat: 9 },
    "2026-10-31": { rhr: 47 }, "no-es-data": { rhr: 1 }, "2026-10-29": { cosa: 1 },
  } } });
  assert.deepEqual(await p1.json(), { accepted: 2, total: 2, updatedAt: NOW });
  await call("/garmin/wellness", { method: "PUT", key: PUSH, body: { days: { "2026-10-31": { hrvLast: 58, bbWake: 74 } } } });
  const g = await (await call("/garmin/wellness")).json();
  assert.deepEqual(g.days["2026-10-30"], { rhr: 46, hrvLast: 62.46, hrvStatus: "BALANCED", sleepSec: 27000, sleepScore: 81 });
  assert.deepEqual(g.days["2026-10-31"], { rhr: 47, hrvLast: 58, bbWake: 74 }, "ajunta camps del mateix dia");
  assert.equal(g.updatedAt, NOW);
  assert.equal(g.days["no-es-data"], undefined);
});

test("Garmin: només es guarden els últims 400 dies", async () => {
  withPush();
  const days = {};
  for (let i = 0; i < 450; i++) days[new Date(Date.UTC(2025, 0, 1) + i * 864e5).toISOString().slice(0, 10)] = { rhr: 40 + (i % 10) };
  await call("/garmin/wellness", { method: "PUT", key: PUSH, body: { days } });
  const g = await (await call("/garmin/wellness")).json();
  const keys = Object.keys(g.days);
  assert.equal(keys.length, 400);
  assert.equal(keys.at(-1), "2026-03-26");
});

test("Garmin: peticions mal formades es refusen", async () => {
  withPush();
  assert.equal((await call("/garmin/wellness", { method: "PUT", key: PUSH, body: { dies: {} } })).status, 400);
  assert.equal((await call("/garmin/wellness", { method: "PUT", key: PUSH, body: { days: [] } })).status, 400);
  assert.equal((await call("/garmin/tokens", { method: "PUT", key: PUSH, body: { tokens: "curt" } })).status, 400);
});

test("Garmin: els tokens van i tornen només per a l'Action", async () => {
  withPush();
  assert.equal((await call("/garmin/tokens", { key: PUSH })).status, 404, "encara no n'hi ha");
  const tokens = JSON.stringify({ di_token: "abc", di_refresh_token: "def" });
  assert.deepEqual(await (await call("/garmin/tokens", { method: "PUT", key: PUSH, body: { tokens } })).json(), { updatedAt: NOW });
  assert.deepEqual(await (await call("/garmin/tokens", { key: PUSH })).json(), { tokens, updatedAt: NOW });
  // I l'app no els veu mai, ni dins del benestar.
  const g = JSON.stringify(await (await call("/garmin/wellness")).json());
  assert.ok(!g.includes("di_token"));
});
