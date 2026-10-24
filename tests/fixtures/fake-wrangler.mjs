#!/usr/bin/env node
// wrangler de mentida per provar worker/setup.mjs sense compte de Cloudflare.
// L'estat (sessió, KV, secrets, publicat) es guarda al fitxer de FAKE_WRANGLER_STATE.
import { readFileSync, writeFileSync } from "node:fs";

const file = process.env.FAKE_WRANGLER_STATE;
const st = JSON.parse(readFileSync(file, "utf8"));
const save = () => writeFileSync(file, JSON.stringify(st));
const args = process.argv.slice(2).join(" ");
st.calls = [...(st.calls || []), args];

if (args === "whoami") { console.log(st.logged ? "You are logged in with an OAuth Token, associated with the email ffontsere@gmail.com." : "You are not authenticated. Please run `wrangler login`."); }
else if (args === "login") { st.logged = true; console.log("Successfully logged in."); }
else if (args === "kv namespace list") { console.log(JSON.stringify(st.kv, null, 2)); }
else if (args === "kv namespace create FF_DATA") { const id = "c".repeat(32); st.kv.push({ id, title: "FF_DATA" }); console.log(`🌀 Creating namespace with title "FF_DATA"\n✨ Success!\n[[kv_namespaces]]\nbinding = "FF_DATA"\nid = "${id}"`); }
else if (args === "deploy") {
  const toml = readFileSync(process.cwd() + "/wrangler.toml", "utf8");
  st.deployedKv = (toml.match(/id = "([^"]+)"/) || [])[1];
  st.deployed = true; console.log("Total Upload: 12.34 KiB\nUploaded ff-runtracker (2.1 sec)\nDeployed ff-runtracker triggers (0.5 sec)\n  https://ff-runtracker.ffontsere.workers.dev\nCurrent Version ID: abc");
}
else if (args === "secret list") { console.log(JSON.stringify(Object.keys(st.secrets).map(name => ({ name, type: "secret_text" })), null, 2)); }
else if (args.startsWith("secret put ")) {
  const name = args.slice(11).trim();
  const value = readFileSync(0, "utf8").trim();
  st.secrets[name] = value; console.log(`✨ Success! Uploaded secret ${name}`);
}
else { console.error("ordre desconeguda: " + args); save(); process.exit(1); }
save();
