// ff-runtracker — Worker de Cloudflare per a RunTracker v2.
//
// Fa dues coses:
//  1. Strava: la clau secreta i el refresh token viuen aquí. L'app només rep tokens d'accés (6 h).
//     La connexió torna al Worker, no a l'app, així funciona també des de l'app instal·lada.
//  2. Còpia de força, cos, configuració i notes de les sortides (RPE, sensacions, cursa, temperatura),
//     perquè no depenguin d'un sol mòbil.
//
// Variables (wrangler.toml i secrets):
//   STRAVA_CLIENT_ID      id públic de l'app de Strava
//   STRAVA_CLIENT_SECRET  secret (wrangler secret put)
//   APP_KEY               clau llarga i aleatòria que l'app envia a cada petició (wrangler secret put)
//   APP_URL               on torna després de connectar, p. ex. https://ffontsere.github.io/runtracker-v2/
//   FF_DATA               KV dels projectes personals. Claus amb el prefix "runtracker:".

const P = "runtracker:";
const K = { tokens: P + "strava:tokens", state: s => P + "strava:state:" + s, sync: c => P + "sync:" + c };
export const SYNC_COLLECTIONS = ["strength", "body", "strengthState", "settings", "actNotes"];
const STRAVA_AUTH = "https://www.strava.com/oauth/authorize";
const STRAVA_TOKEN = "https://www.strava.com/oauth/token";

// ── Utilitats ──
function cors(env) {
  const origin = new URL(env.APP_URL).origin;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
const json = (env, status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...cors(env) } });
const fail = (env, status, code, message) => json(env, status, { error: code, message });

/** Comparació en temps constant, per no filtrar la clau per temps de resposta. */
function sameKey(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !b) return false;
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] || 0) ^ (eb[i] || 0);
  return diff === 0;
}
const bearer = req => (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
const randomState = () => [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, "0")).join("");

function checkEnv(env) {
  const missing = ["STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET", "APP_KEY", "APP_URL"].filter(k => !env[k]);
  if (!env.FF_DATA) missing.push("FF_DATA (KV)");
  if (missing.length) throw new Error("Falta configurar al Worker: " + missing.join(", "));
}

async function stravaTokenRequest(env, params) {
  const resp = await fetch(STRAVA_TOKEN, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET, ...params }),
  });
  const text = await resp.text();
  if (!resp.ok) throw Object.assign(new Error(`Strava ha respost ${resp.status}: ${text.slice(0, 200)}`), { status: resp.status });
  return JSON.parse(text);
}

// ── Rutes ──

/** Inicia la connexió amb Strava. La clau va a la URL perquè és una navegació, no una petició de l'app. */
async function connect(req, env) {
  const url = new URL(req.url);
  if (!sameKey(url.searchParams.get("key"), env.APP_KEY)) return fail(env, 401, "unauthorized", "Clau de l'app incorrecta.");
  const state = randomState();
  await env.FF_DATA.put(K.state(state), "1", { expirationTtl: 600 });
  const redirect = url.origin + "/strava/callback";
  const auth = new URL(STRAVA_AUTH);
  auth.search = new URLSearchParams({ client_id: env.STRAVA_CLIENT_ID, redirect_uri: redirect, response_type: "code", approval_prompt: "auto", scope: "activity:read_all", state }).toString();
  return Response.redirect(auth.toString(), 302);
}

/** Strava torna aquí amb el codi. Es canvia pels tokens i es torna a l'app. */
async function callback(req, env) {
  const url = new URL(req.url);
  const back = (hash) => Response.redirect(env.APP_URL + "#" + hash, 302);
  const state = url.searchParams.get("state") || "";
  if (!state || !(await env.FF_DATA.get(K.state(state)))) return back("strava=error&motiu=" + encodeURIComponent("La connexió ha caducat. Torna-ho a provar."));
  await env.FF_DATA.delete(K.state(state));
  if (url.searchParams.get("error")) return back("strava=error&motiu=" + encodeURIComponent("Has cancel·lat el permís a Strava."));
  const scope = url.searchParams.get("scope") || "";
  if (!scope.includes("activity:read")) return back("strava=error&motiu=" + encodeURIComponent("Cal donar permís per llegir les activitats."));
  try {
    const t = await stravaTokenRequest(env, { code: url.searchParams.get("code"), grant_type: "authorization_code" });
    await env.FF_DATA.put(K.tokens, JSON.stringify({
      access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at,
      athlete: t.athlete ? { id: t.athlete.id, firstname: t.athlete.firstname } : null, scope,
    }));
    return back("strava=ok");
  } catch (e) {
    return back("strava=error&motiu=" + encodeURIComponent(e.message));
  }
}

/** Dona a l'app un token d'accés vàlid; el renova si li queden menys de 5 minuts. */
async function token(req, env, now) {
  const raw = await env.FF_DATA.get(K.tokens);
  if (!raw) return fail(env, 409, "not_connected", "Strava no està connectat.");
  let t = JSON.parse(raw);
  if (now / 1000 >= t.expires_at - 300) {
    try {
      const n = await stravaTokenRequest(env, { refresh_token: t.refresh_token, grant_type: "refresh_token" });
      t = { ...t, access_token: n.access_token, refresh_token: n.refresh_token || t.refresh_token, expires_at: n.expires_at };
      await env.FF_DATA.put(K.tokens, JSON.stringify(t));
    } catch (e) {
      // 400/401 de Strava = permís retirat: cal tornar a connectar. Altres errors = temporals.
      if (e.status === 400 || e.status === 401) return fail(env, 409, "reconnect", "Strava ha retirat el permís. Torna a connectar.");
      return fail(env, 502, "strava_unavailable", e.message);
    }
  }
  return json(env, 200, { access_token: t.access_token, expires_at: t.expires_at, athlete: t.athlete });
}

async function disconnect(req, env) {
  await env.FF_DATA.delete(K.tokens);
  return json(env, 200, { ok: true });
}

/** Llegeix una col·lecció de la còpia. */
async function syncGet(env, col) {
  const raw = await env.FF_DATA.get(K.sync(col));
  return json(env, 200, raw ? JSON.parse(raw) : { value: null, version: 0, updatedAt: null });
}

/**
 * Desa una col·lecció. L'app envia la versió sobre la qual ha treballat: si algú (un altre mòbil)
 * l'ha canviat mentrestant, es respon 409 amb la versió actual perquè l'app les combini.
 */
async function syncPut(req, env, col, now) {
  let body;
  try { body = await req.json(); } catch { return fail(env, 400, "bad_json", "El cos no és JSON vàlid."); }
  if (!body || !("value" in body) || typeof body.baseVersion !== "number") return fail(env, 400, "bad_request", "Cal { value, baseVersion }.");
  const size = JSON.stringify(body.value).length;
  if (size > 5_000_000) return fail(env, 413, "too_large", "Massa dades per a una sola col·lecció.");
  const raw = await env.FF_DATA.get(K.sync(col));
  const cur = raw ? JSON.parse(raw) : { value: null, version: 0, updatedAt: null };
  if (body.baseVersion !== cur.version) return json(env, 409, { error: "conflict", message: "Hi ha una versió més nova.", current: cur });
  const next = { value: body.value, version: cur.version + 1, updatedAt: now };
  await env.FF_DATA.put(K.sync(col), JSON.stringify(next));
  return json(env, 200, { version: next.version, updatedAt: now });
}

export default {
  async fetch(req, env, _ctx, now = Date.now()) {
    try {
      checkEnv(env);
      const url = new URL(req.url);
      const path = url.pathname.replace(/\/+$/, "") || "/";
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });
      if (req.method === "GET" && path === "/") return json(env, 200, { ok: true, app: "ff-runtracker" });
      if (req.method === "GET" && path === "/strava/connect") return connect(req, env);
      if (req.method === "GET" && path === "/strava/callback") return callback(req, env);

      // A partir d'aquí, cal la clau de l'app.
      if (!sameKey(bearer(req), env.APP_KEY)) return fail(env, 401, "unauthorized", "Clau de l'app incorrecta.");
      if (req.method === "POST" && path === "/strava/token") return token(req, env, now);
      if (req.method === "POST" && path === "/strava/disconnect") return disconnect(req, env);
      const m = path.match(/^\/sync\/([A-Za-z]+)$/);
      if (m) {
        if (!SYNC_COLLECTIONS.includes(m[1])) return fail(env, 404, "unknown_collection", "Col·lecció desconeguda.");
        if (req.method === "GET") return syncGet(env, m[1]);
        if (req.method === "PUT") return syncPut(req, env, m[1], now);
      }
      return fail(env, 404, "not_found", "Ruta desconeguda.");
    } catch (e) {
      // Mai en silenci: l'error torna a l'app amb el motiu.
      return new Response(JSON.stringify({ error: "server", message: e.message }), {
        status: 500, headers: { "Content-Type": "application/json; charset=utf-8", ...(env.APP_URL ? cors(env) : {}) },
      });
    }
  },
};
