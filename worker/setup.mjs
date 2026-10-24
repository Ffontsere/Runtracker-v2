#!/usr/bin/env node
// Configura i publica el Worker ff-runtracker amb una sola ordre:
//
//     node worker/setup.mjs
//
// Fa: inicia sessió a Cloudflare si cal, troba (o crea) el KV FF_DATA, el posa a wrangler.toml,
// publica el Worker, genera la clau de l'app, et demana el Client Secret de Strava, desa tots dos
// com a secrets i comprova que el Worker respon. Es pot tornar a executar sense trencar res:
// si la clau de l'app ja existeix, no la canvia (afegeix --clau-nova per generar-ne una altra).

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOML = join(HERE, "wrangler.toml");
const KEY_FILE = join(HERE, ".app-key");
export const WRANGLER = process.env.RT_WRANGLER || "npx --yes wrangler@4.149.0";
const say = (...a) => console.log(...a);
const ok = s => say("  ✓ " + s);
const step = s => say("\n▸ " + s);

export class SetupError extends Error {}

/** Executa wrangler. `input` s'envia per l'entrada estàndard (secrets). */
export function wrangler(args, { input, interactive = false } = {}) {
  const r = spawnSync(WRANGLER + " " + args, {
    cwd: HERE, shell: true, encoding: "utf8", input,
    stdio: interactive ? "inherit" : ["pipe", "pipe", "pipe"],
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", NO_COLOR: "1" },
  });
  if (r.error) throw new SetupError("No s'ha pogut executar wrangler: " + r.error.message + ". Tens Node.js instal·lat?");
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

/** Busca el KV FF_DATA a la llista de wrangler. Retorna l'id, null si no n'hi ha, o la llista si n'hi ha diversos. */
export function findFFData(listOutput) {
  const start = listOutput.indexOf("[");
  if (start < 0) throw new SetupError("No he entès la llista de KV de wrangler:\n" + listOutput.slice(0, 400));
  const list = JSON.parse(listOutput.slice(start, listOutput.lastIndexOf("]") + 1));
  const exact = list.filter(n => n.title === "FF_DATA");
  if (exact.length === 1) return exact[0].id;
  const loose = list.filter(n => /(^|[-_])FF_DATA$/i.test(n.title));
  if (loose.length === 1) return loose[0].id;
  if (loose.length > 1) return loose;
  return null;
}

/** Posa l'id del KV a wrangler.toml. */
export function setKvId(toml, id) {
  if (!/^[0-9a-f]{32}$/.test(id)) throw new SetupError("Id de KV no vàlid: " + id);
  return toml.replace(/(binding\s*=\s*"FF_DATA"\s*\nid\s*=\s*")[^"]*(")/, `$1${id}$2`);
}

export const workerUrl = deployOutput => (deployOutput.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i) || [null])[0];

async function askHidden(question) {
  if (process.env.STRAVA_CLIENT_SECRET) return process.env.STRAVA_CLIENT_SECRET;
  process.stdout.write(question);
  const stdin = process.stdin;
  if (!stdin.isTTY) { // sense terminal interactiu: llegeix una línia normal
    return await new Promise(res => { let s = ""; stdin.setEncoding("utf8"); stdin.on("data", d => { s += d; if (s.includes("\n")) { stdin.pause(); res(s.split("\n")[0].trim()); } }); });
  }
  return await new Promise(res => {
    let s = ""; stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
    const on = c => {
      if (c === "\r" || c === "\n") { stdin.setRawMode(false); stdin.pause(); stdin.off("data", on); process.stdout.write("\n"); res(s.trim()); }
      else if (c === "\u0003") { process.stdout.write("\n"); process.exit(130); }
      else if (c === "\u007f" || c === "\b") { if (s) { s = s.slice(0, -1); process.stdout.write("\b \b"); } }
      else { s += c; process.stdout.write("•".repeat(c.length)); }
    };
    stdin.on("data", on);
  });
}

async function verify(url, appKey) {
  let r;
  try { r = await fetch(url + "/"); } catch (e) { throw new SetupError("El Worker no respon a " + url + ": " + e.message); }
  const root = await r.json().catch(() => ({}));
  if (!root.ok) throw new SetupError("El Worker respon però no està ben configurat: " + (root.message || r.status));
  const t = await fetch(url + "/strava/token", { method: "POST", headers: { Authorization: "Bearer " + appKey } });
  const body = await t.json().catch(() => ({}));
  if (t.status === 401) throw new SetupError("El Worker no accepta la clau de l'app. Torna a executar amb --clau-nova.");
  return body.error === "not_connected" ? "a punt (Strava encara no connectat)" : t.status === 200 ? "a punt i ja connectat a Strava" : "respon (" + (body.message || t.status) + ")";
}

export async function main(argv = process.argv.slice(2)) {
  const newKey = argv.includes("--clau-nova");
  say("Configuració del Worker ff-runtracker\n");

  step("Sessió de Cloudflare");
  let who = wrangler("whoami");
  if (/not authenticated|not logged in|wrangler login/i.test(who.out) || who.code !== 0) {
    say("  S'obrirà el navegador per entrar a Cloudflare. Accepta el permís i torna aquí.");
    const l = wrangler("login", { interactive: true });
    if (l.code !== 0) throw new SetupError("No s'ha pogut iniciar sessió a Cloudflare.");
    who = wrangler("whoami");
  }
  const email = (who.out.match(/[\w.+-]+@[\w-]+\.[\w.]+/) || ["el teu compte"])[0];
  ok("Connectat com a " + email);

  step("KV FF_DATA");
  const list = wrangler("kv namespace list");
  if (list.code !== 0) throw new SetupError("No s'han pogut llistar els KV:\n" + list.out.slice(0, 400));
  let id = findFFData(list.out);
  if (Array.isArray(id)) throw new SetupError("Hi ha diversos KV que s'assemblen a FF_DATA: " + id.map(n => `${n.title} (${n.id})`).join(", ") + ". Posa l'id correcte a worker/wrangler.toml i torna a executar.");
  if (!id) {
    say("  No hi ha cap KV FF_DATA: el creo.");
    const c = wrangler("kv namespace create FF_DATA");
    id = (c.out.match(/[0-9a-f]{32}/) || [null])[0];
    if (!id) throw new SetupError("No s'ha pogut crear el KV:\n" + c.out.slice(0, 400));
  }
  const toml = readFileSync(TOML, "utf8"), toml2 = setKvId(toml, id);
  if (toml2 !== toml) writeFileSync(TOML, toml2);
  ok("FF_DATA = " + id);

  step("Publicació");
  const d = wrangler("deploy");
  const url = workerUrl(d.out);
  if (d.code !== 0 || !url) throw new SetupError("La publicació ha fallat:\n" + d.out.slice(-800));
  ok("Publicat a " + url);

  step("Secrets");
  const secrets = wrangler("secret list");
  const have = new Set((secrets.out.match(/"name"\s*:\s*"([A-Z_]+)"/g) || []).map(s => s.split('"')[3]));
  let appKey = existsSync(KEY_FILE) ? readFileSync(KEY_FILE, "utf8").trim() : null;
  if (newKey || !have.has("APP_KEY") || !appKey) {
    appKey = randomBytes(32).toString("hex");
    const r = wrangler("secret put APP_KEY", { input: appKey + "\n" });
    if (r.code !== 0) throw new SetupError("No s'ha pogut desar APP_KEY:\n" + r.out.slice(0, 400));
    writeFileSync(KEY_FILE, appKey + "\n");
    ok("Clau de l'app nova generada i desada");
  } else ok("La clau de l'app ja hi era: no la canvio");
  if (!have.has("STRAVA_CLIENT_SECRET")) {
    say("  Copia el «Client Secret» de https://www.strava.com/settings/api (botó «Show»).");
    const secret = await askHidden("  Enganxa'l aquí i prem Enter: ");
    if (!/^[0-9a-f]{40}$/i.test(secret)) throw new SetupError("Això no sembla un Client Secret de Strava (són 40 caràcters hexadecimals).");
    const r = wrangler("secret put STRAVA_CLIENT_SECRET", { input: secret + "\n" });
    if (r.code !== 0) throw new SetupError("No s'ha pogut desar el secret de Strava:\n" + r.out.slice(0, 400));
    ok("Secret de Strava desat");
  } else ok("El secret de Strava ja hi era");

  step("Comprovació");
  // Els secrets triguen uns segons a arribar al Worker.
  let state, lastErr;
  for (let i = 0; i < 6 && !state; i++) {
    try { state = await verify(url, appKey); } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 3000)); }
  }
  if (!state) throw lastErr;
  ok("El Worker està " + state);

  const host = new URL(url).host;
  say(`
────────────────────────────────────────────────────────────
Fet. Queden dues coses, i la primera la puc fer jo:

1. A https://www.strava.com/settings/api, «Authorization Callback Domain»:
     ${host}

2. Al Perfil de RunTracker v2, quan existeixi:
     Adreça del Worker: ${url}
     Clau de l'app:     ${appKey}
   (La clau també és a worker/.app-key, que no es puja a GitHub.)
────────────────────────────────────────────────────────────`);
  return { url, appKey, kvId: id };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main().catch(e => { console.error("\n✗ " + (e instanceof SetupError ? e.message : e.stack || e.message)); process.exit(1); });
