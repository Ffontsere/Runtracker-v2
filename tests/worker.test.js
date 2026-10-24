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
