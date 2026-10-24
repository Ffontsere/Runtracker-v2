// Prova worker/setup.mjs de punta a punta amb un wrangler de mentida i el Worker real executant-se en local.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TOML = join(ROOT, "worker/wrangler.toml"), KEY = join(ROOT, "worker/.app-key");
const STATE = join(mkdtempSync(join(tmpdir(), "rt-setup-")), "state.json");
const SECRET = "0123456789abcdef0123456789abcdef01234567";
let tomlBackup, keyBackup, setup, worker, realFetch;

const state = () => JSON.parse(readFileSync(STATE, "utf8"));
const kvStore = new Map();

before(async () => {
  tomlBackup = readFileSync(TOML, "utf8");
  keyBackup = existsSync(KEY) ? readFileSync(KEY, "utf8") : null;
  writeFileSync(STATE, JSON.stringify({ logged: false, secrets: {}, kv: [{ id: "a".repeat(32), title: "LKN_DATA" }, { id: "b".repeat(32), title: "FF_DATA" }] }));
  process.env.RT_WRANGLER = `"${process.execPath}" "${join(ROOT, "tests/fixtures/fake-wrangler.mjs")}"`;
  process.env.FAKE_WRANGLER_STATE = STATE;
  process.env.STRAVA_CLIENT_SECRET = SECRET;
  setup = await import("../worker/setup.mjs");
  worker = (await import("../worker/src/index.js")).default;
  // El "Worker publicat": el codi real, amb els secrets que el setup ha desat al wrangler de mentida.
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith("https://ff-runtracker.ffontsere.workers.dev")) return realFetch(url, init);
    const s = state();
    const env = { STRAVA_CLIENT_ID: "220720", APP_URL: "https://ffontsere.github.io/Runtracker-v2/", ...s.secrets,
      FF_DATA: { get: async k => kvStore.get(k) ?? null, put: async (k, v) => { kvStore.set(k, v); }, delete: async k => { kvStore.delete(k); } } };
    return worker.fetch(new Request(url, init), env, {});
  };
  console.log = () => {}; // silencia els missatges del setup durant el test
});
after(() => {
  writeFileSync(TOML, tomlBackup);
  if (keyBackup === null) rmSync(KEY, { force: true }); else writeFileSync(KEY, keyBackup);
  globalThis.fetch = realFetch;
});

test("primera vegada: inicia sessió, troba FF_DATA, publica, desa secrets i comprova", async () => {
  const r = await setup.main([]);
  const s = state();
  assert.ok(s.calls.includes("login"));
  assert.equal(r.kvId, "b".repeat(32));
  assert.match(readFileSync(TOML, "utf8"), new RegExp(`binding = "FF_DATA"\\nid = "${"b".repeat(32)}"`));
  assert.equal(s.deployedKv, "b".repeat(32), "es publica amb l'id ja posat");
  assert.equal(r.url, "https://ff-runtracker.ffontsere.workers.dev");
  assert.match(r.appKey, /^[0-9a-f]{64}$/);
  assert.equal(s.secrets.APP_KEY, r.appKey);
  assert.equal(s.secrets.STRAVA_CLIENT_SECRET, SECRET);
  assert.equal(readFileSync(KEY, "utf8").trim(), r.appKey);
});

test("segona vegada: no torna a iniciar sessió ni canvia la clau", async () => {
  const before = state();
  const r = await setup.main([]);
  const s = state();
  assert.equal(s.calls.filter(c => c === "login").length, 1);
  assert.equal(r.appKey, before.secrets.APP_KEY);
  assert.equal(s.calls.filter(c => c.startsWith("secret put")).length, 2, "no torna a desar cap secret");
});

test("--clau-nova en genera una de nova i el Worker l'accepta", async () => {
  const old = state().secrets.APP_KEY;
  const r = await setup.main(["--clau-nova"]);
  assert.notEqual(r.appKey, old);
  assert.equal(state().secrets.APP_KEY, r.appKey);
});

test("eines internes: lectura de la llista de KV, URL i id", () => {
  assert.equal(setup.findFFData('⛅️ wrangler\n[{"id":"' + "d".repeat(32) + '","title":"ff-runtracker-FF_DATA"}]'), "d".repeat(32));
  assert.equal(setup.findFFData('[{"id":"x","title":"LKN_DATA"}]'), null);
  assert.equal(setup.findFFData('[{"id":"1","title":"FF_DATA"},{"id":"2","title":"FF_DATA"}]').length, 2);
  assert.throws(() => setup.findFFData("error"), /No he entès/);
  assert.equal(setup.workerUrl("…\n  https://ff-runtracker.abc.workers.dev\n…"), "https://ff-runtracker.abc.workers.dev");
  assert.throws(() => setup.setKvId(tomlBackup, "no-és-un-id"), /no vàlid/);
});

test("un Client Secret mal enganxat s'atura amb un missatge clar", async () => {
  const s = state(); delete s.secrets.STRAVA_CLIENT_SECRET; writeFileSync(STATE, JSON.stringify(s));
  process.env.STRAVA_CLIENT_SECRET = "hola";
  await assert.rejects(setup.main([]), /no sembla un Client Secret/);
  process.env.STRAVA_CLIENT_SECRET = SECRET;
});
