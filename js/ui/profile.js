// RunTracker v2 — pantalla de Perfil: connexió amb Strava, dades i fisiologia.
// Cada acció mostra el resultat o l'error en una caixa de missatge: res falla en silenci.

import { h, say, fmtInt, fmtDate, fmtAgo } from "./dom.js";
import { getWorkerConfig, setWorkerConfig, getSettings, getSyncState, setSyncState, DEFAULT_WORKER } from "../data/config.js";
import { workerClient, syncActivities, runBackfill, backfillQueue, SyncError } from "../data/strava.js";
import { readV1Storage, readV1Backup, migrate, saveMigration } from "../data/migrate.js";
import { recalcAll } from "../data/recalc.js";
import { strengthDays, DOW_NAMES } from "../engine/schedule.js";

/**
 * @param {HTMLElement} root
 * @param {{db, fetchImpl?:Function, now?:()=>number, win?:Window, notice?:{ok:boolean,reason:string|null}}} app
 */
export async function renderProfile(root, app) {
  const { db } = app;
  const fetchImpl = app.fetchImpl || ((...a) => fetch(...a));
  const now = app.now || (() => Date.now());
  const win = app.win || window;
  const sleep = app.sleep;

  root.replaceChildren(h("div.stack", h("p.eyebrow", "Configuració"), h("h1", "Perfil")));

  // ─────────────── Strava ───────────────
  const stravaStatus = h("span.status", "Comprovant…");
  const stravaMsg = h("div.msg");
  const urlIn = h("input.input", { id: "wk-url", type: "url", inputmode: "url", autocomplete: "off", spellcheck: false });
  const keyIn = h("input.input.mono", { id: "wk-key", type: "password", autocomplete: "off", spellcheck: false, placeholder: "64 caràcters" });
  const showKey = h("button.btn.small", { type: "button", "aria-pressed": "false", onclick: () => {
    const on = keyIn.type === "password"; keyIn.type = on ? "text" : "password"; showKey.setAttribute("aria-pressed", String(on)); showKey.textContent = on ? "Amaga" : "Mostra";
  } }, "Mostra");
  const saveBtn = h("button.btn", { type: "button" }, "Desa i comprova");
  const connectBtn = h("button.btn.primary.grow", { type: "button", hidden: true }, "Connecta Strava");
  const disconnectBtn = h("button.btn.quiet.danger", { type: "button", hidden: true }, "Desconnecta");
  const keyDetails = h("details", { id: "wk-details" },
    h("summary", "Worker i clau de l'app"),
    h("div.stack",
      h("div.field", h("label", { for: "wk-url" }, "Adreça del Worker"), urlIn),
      h("div.field", h("label", { for: "wk-key" }, "Clau de l'app"), h("div.with-btn", keyIn, showKey),
        h("span.hint", "És a worker/.app-key, a la carpeta del projecte del teu PC. L'script de configuració també la mostra en acabar.")),
      h("div.row", saveBtn)));

  root.append(h("section.card", { "aria-labelledby": "h-strava" },
    h("div.card-head", h("h2", { id: "h-strava" }, "Strava"), stravaStatus),
    stravaMsg,
    h("div.row", connectBtn, disconnectBtn),
    keyDetails));

  // ─────────────── Dades ───────────────
  const dataStats = h("div.stats");
  const dataMeta = h("p.small.muted");
  const dataMsg = h("div.msg");
  const dataActions = h("div.stack");
  root.append(h("section.card", { "aria-labelledby": "h-data" },
    h("div.card-head", h("h2", { id: "h-data" }, "Dades")),
    dataStats, dataMeta, dataMsg, dataActions));

  // ─────────────── Fisiologia ───────────────
  const physMsg = h("div.msg");
  const num = (id, label, unit, attrs) => {
    const input = h("input.input", { id, type: "number", inputmode: "decimal", ...attrs });
    return { input, el: h("div.field", h("label", { for: id }, label), h("div.unit", input, h("span", unit))) };
  };
  const fMax = num("ph-hrmax", "FC màxima", "ppm", { min: 120, max: 230, step: 1 });
  const fRest = num("ph-hrrest", "FC en repòs", "ppm", { min: 25, max: 100, step: 1 });
  const fWeight = num("ph-weight", "Pes", "kg", { min: 30, max: 200, step: 0.1 });
  const fHeight = num("ph-height", "Alçada", "cm", { min: 120, max: 230, step: 0.5 });
  const physBtn = h("button.btn", { type: "button" }, "Desa");
  root.append(h("section.card", { "aria-labelledby": "h-phys" },
    h("div.card-head", h("h2", { id: "h-phys" }, "Fisiologia")),
    h("p.small.muted", "Si canvies la FC màxima o la de repòs, es recalculen la càrrega, les zones i el VO₂ de totes les sortides."),
    h("div.grid2", fMax.el, fRest.el, fWeight.el, fHeight.el),
    physMsg,
    h("div.row", physBtn)));

  // ─────────────── Dies de força ───────────────
  const daysMsg = h("div.msg");
  const sd = strengthDays(await getSettings(db));
  const ORDER = [1, 2, 3, 4, 5, 6, 0];
  const daySel = (t, label) => h("div.field", h("label", { for: `sd-${t}` }, label),
    h("select.input", { id: `sd-${t}`, onchange: async e => {
      try {
        const cur = await getSettings(db);
        const next = { ...strengthDays(cur), [t]: +e.target.value };
        await db.setKV("settings", { ...cur, strengthDays: next });
        say(daysMsg, next.A === next.B ? "Les dues sessions cauen el mateix dia: millor separar-les almenys 48 h." : `Desat: A el ${DOW_NAMES[next.A]}, B el ${DOW_NAMES[next.B]}.`, next.A === next.B ? "warn" : "ok");
      } catch (err) { say(daysMsg, "No s'ha pogut desar: " + err.message, "bad"); }
    } }, ...ORDER.map(d => h("option", { value: String(d), selected: d === sd[t] }, DOW_NAMES[d].charAt(0).toUpperCase() + DOW_NAMES[d].slice(1)))));
  root.append(h("section.card", { "aria-labelledby": "h-sdays" },
    h("div.card-head", h("h2", { id: "h-sdays" }, "Dies de força")),
    h("p.small.muted", "L'Avui t'avisa quan toca. Si un dia no pots, la pestanya Força et proposa la sessió que fa més temps que no fas."),
    h("div.grid2", daySel("A", "Sessió A · Cames"), daySel("B", "Sessió B · Tronc i tendons")),
    daysMsg));

  // ─────────────── Lògica ───────────────
  let cfg = await getWorkerConfig(db);
  let stravaState = "unknown"; // unknown | no_key | bad_key | offline | not_connected | connected
  urlIn.value = cfg.url; keyIn.value = cfg.appKey;
  const busy = (btn, on, label) => { btn.disabled = on; if (label) btn.textContent = label; };
  const client = () => workerClient({ url: cfg.url, appKey: cfg.appKey, fetchImpl });

  function paintStrava(state, text, msgType = "") {
    stravaState = state;
    const cls = { connected: "ok", not_connected: "warn", no_key: "warn", bad_key: "bad", offline: "bad" }[state] || "";
    stravaStatus.className = "status" + (cls ? " " + cls : "");
    stravaStatus.textContent = { connected: "Connectat", not_connected: "No connectat", no_key: "Falta la clau", bad_key: "Clau incorrecta", offline: "Sense Worker" }[state] || "Comprovant…";
    if (text !== undefined) say(stravaMsg, text, msgType);
    connectBtn.hidden = !["not_connected"].includes(state);
    disconnectBtn.hidden = state !== "connected";
    keyDetails.open = ["no_key", "bad_key", "offline"].includes(state) || keyDetails.open;
    paintDataActions();
  }

  async function checkStrava() {
    if (!cfg.appKey) return paintStrava("no_key", "Posa la clau de l'app perquè el mòbil pugui parlar amb el teu Worker.", "warn");
    try {
      const r = await fetchImpl(cfg.url + "/").catch(e => { throw new SyncError("network", "No s'ha pogut contactar amb el Worker (" + e.message + ")."); });
      const b = await r.json().catch(() => ({}));
      if (!b.ok) throw new SyncError("worker", "El Worker respon però no està ben configurat: " + (b.message || r.status));
      const t = await client().token();
      const who = t.athlete && t.athlete.firstname ? " com a " + t.athlete.firstname : "";
      await setSyncState(db, { athlete: t.athlete || null });
      paintStrava("connected", "Connectat" + who + ". El Worker guarda el permís; l'app només rep tokens de curta durada.", "");
    } catch (e) {
      const code = e.code || "network";
      if (code === "not_connected" || code === "reconnect") paintStrava("not_connected", e.message, "warn");
      else if (code === "app_key") paintStrava("bad_key", e.message, "bad");
      else paintStrava("offline", e.message, "bad");
    }
  }

  saveBtn.onclick = async () => {
    busy(saveBtn, true, "Comprovant…");
    try { cfg = await setWorkerConfig(db, { url: urlIn.value || DEFAULT_WORKER, appKey: keyIn.value }); urlIn.value = cfg.url; await checkStrava(); }
    catch (e) { say(stravaMsg, e.message, "bad"); }
    finally { busy(saveBtn, false, "Desa i comprova"); }
  };
  connectBtn.onclick = () => { win.location.assign(client().connectUrl()); };
  disconnectBtn.onclick = async () => {
    if (!win.confirm("Vols desconnectar Strava? Les sortides que ja tens es queden; només deixarà de baixar-ne de noves.")) return;
    busy(disconnectBtn, true);
    try {
      const r = await client().disconnect();
      if (r.status !== 200) throw new Error(r.body.message || "Error " + r.status);
      await setSyncState(db, { athlete: null });
      paintStrava("not_connected", "Strava desconnectat.", "");
    } catch (e) { say(stravaMsg, "No s'ha pogut desconnectar: " + e.message, "bad"); }
    finally { busy(disconnectBtn, false); }
  };

  // Dades
  async function paintData() {
    const acts = await db.getAll("activities");
    const sync = await getSyncState(db);
    const dates = acts.map(a => a.date).sort();
    const pending = backfillQueue(acts, now()).length;
    dataStats.replaceChildren(
      h("div.stat", h("b", fmtInt(acts.length)), h("span", "sortides")),
      h("div.stat", h("b", dates.length ? String(new Date(dates[0]).getFullYear()) : "—"), h("span", "des de")),
      h("div.stat", h("b", fmtInt(pending)), h("span", "per analitzar")));
    dataMeta.textContent = acts.length
      ? `De ${fmtDate(dates[0])} a ${fmtDate(dates[dates.length - 1])}. Última sincronització: ${fmtAgo(sync.lastSync, now())}.`
      : "Encara no hi ha cap sortida en aquest mòbil.";
    dataState = { count: acts.length, pending };
    paintDataActions();
  }

  let dataState = { count: 0, pending: 0 };
  let running = false;
  const syncBtn = h("button.btn.primary.grow", { type: "button" }, "Sincronitza ara");
  const backBtn = h("button.btn.grow", { type: "button" }, "Analitza les pendents");
  const prog = h("div.progress", { hidden: true }, h("i"));
  const v1Count = (() => { try { const raw = win.localStorage.getItem("rt4:a"); return raw ? JSON.parse(raw).length : 0; } catch { return 0; } })();
  const v1Btn = h("button.btn.primary", { type: "button" }, `Importa ${fmtInt(v1Count)} sortides de la v1`);
  const fileIn = h("input", { type: "file", accept: "application/json,.json", hidden: true, id: "v1-file" });
  const fileBtn = h("button.btn", { type: "button", onclick: () => fileIn.click() }, "Importa una còpia de seguretat");

  function paintDataActions() {
    const connected = stravaState === "connected";
    syncBtn.disabled = running || !connected;
    backBtn.disabled = running || !connected || !dataState.pending;
    backBtn.textContent = dataState.pending ? `Analitza ${fmtInt(dataState.pending)} pendents` : "Res per analitzar";
    v1Btn.disabled = fileBtn.disabled = running;
    const importBlock = h("div.stack",
      h("p.small", dataState.count ? "Torna a importar si a la v1 hi ha sortides que aquí no tens. No es perd res: les que ja hi són s'actualitzen." :
        v1Count ? "Aquest navegador també té la v1. Importa'n les sortides: la v1 no es toca." :
          "Per portar l'historial de la v1, a la v1 fes Importar → Exporta còpia i obre el fitxer aquí."),
      h("div.row", v1Count ? v1Btn : null, fileBtn, fileIn));
    const kids = [];
    if (dataState.count) {
      kids.push(h("div.row", syncBtn, backBtn), prog);
      if (!connected) kids.push(h("p.small.muted", "Connecta Strava per sincronitzar."));
      kids.push(h("details", h("summary", "Importar de la v1"), importBlock));
    } else {
      kids.push(importBlock);
      if (connected) kids.push(h("p.small.muted", "O baixa-ho tot directament de Strava:"), h("div.row", syncBtn));
    }
    dataActions.replaceChildren(...kids);
  }

  async function doImport(v1) {
    running = true; paintDataActions();
    say(dataMsg, "Important i recalculant amb la teva FC…");
    try {
      const s = await getSettings(db);
      const r = migrate(v1, { hrMax: s.hrMax, hrRest: s.hrRest, now: now() });
      await saveMigration(db, { ...r, settings: { ...s, ...r.settings, hrMax: s.hrMax, hrRest: s.hrRest } }, now());
      const rp = r.report;
      const extra = [rp.skipped.length ? `${rp.skipped.length} descartades (sense data o repetides)` : null,
        rp.errors.length ? `avisos: ${rp.errors.join("; ")}` : null].filter(Boolean).join(". ");
      say(dataMsg, `Importades ${fmtInt(rp.migrated)} sortides (${fmtDate(rp.range && rp.range[0])} – ${fmtDate(rp.range && rp.range[1])}).` +
        (rp.pendingStreams ? ` ${fmtInt(rp.pendingStreams)} de l'últim any s'analitzaran amb els streams de Strava.` : "") + (extra ? " " + extra + "." : ""), rp.errors.length ? "warn" : "ok");
    } catch (e) { say(dataMsg, "No s'ha pogut importar: " + e.message, "bad"); }
    finally { running = false; await paintData(); }
  }
  v1Btn.onclick = () => doImport(readV1Storage(win.localStorage));
  fileIn.onchange = async () => {
    const f = fileIn.files && fileIn.files[0]; fileIn.value = "";
    if (!f) return;
    let v1;
    try { v1 = readV1Backup(await f.text()); } catch (e) { return say(dataMsg, e.message.startsWith("Aquest") ? e.message : "El fitxer no és JSON vàlid.", "bad"); }
    await doImport(v1);
  };

  async function doSync() {
    running = true; paintDataActions();
    say(dataMsg, "Baixant sortides de Strava…");
    try {
      const r = await syncActivities({ db, worker: client(), fetchImpl, now: now() });
      await setSyncState(db, { lastSync: now(), lastResult: r });
      say(dataMsg, r.added ? `${r.added === 1 ? "1 sortida nova" : fmtInt(r.added) + " sortides noves"}.` : "Ja ho tenies tot.", "ok");
    } catch (e) {
      say(dataMsg, e.message, "bad");
      if (e.code === "reconnect" || e.code === "not_connected") paintStrava("not_connected", e.message, "warn");
    } finally { running = false; await paintData(); }
  }
  syncBtn.onclick = doSync;
  backBtn.onclick = async () => {
    running = true; paintDataActions();
    const total = dataState.pending; prog.hidden = false; prog.firstChild.style.width = "0";
    say(dataMsg, `Analitzant streams… pots continuar fent servir l'app.`);
    try {
      const r = await runBackfill({ db, worker: client(), fetchImpl, now: now(), ...(sleep ? { sleep } : {}),
        onProgress: left => { prog.firstChild.style.width = Math.round((total - left) / total * 100) + "%"; say(dataMsg, `Analitzant streams… en queden ${fmtInt(left)}.`); } });
      const parts = [`${fmtInt(r.done)} analitzades`];
      if (r.failed) parts.push(`${r.failed} sense streams a Strava`);
      if (r.stopped === "quota") parts.push(`aturat pel límit de Strava; en queden ${fmtInt(r.remaining)}, torna-ho a provar d'aquí 15 minuts`);
      say(dataMsg, parts.join(", ") + ".", r.stopped ? "warn" : "ok");
    } catch (e) { say(dataMsg, e.message, "bad"); }
    finally { running = false; prog.hidden = true; await paintData(); }
  };

  // Fisiologia
  const s0 = await getSettings(db);
  fMax.input.value = s0.hrMax ?? ""; fRest.input.value = s0.hrRest ?? "";
  fWeight.input.value = s0.weight ?? ""; fHeight.input.value = s0.height ?? "";
  physBtn.onclick = async () => {
    const hrMax = Math.round(+fMax.input.value), hrRest = Math.round(+fRest.input.value);
    const weight = fWeight.input.value === "" ? null : Math.round(+fWeight.input.value * 10) / 10;
    const height = fHeight.input.value === "" ? null : +fHeight.input.value;
    if (!(hrMax >= 120 && hrMax <= 230)) return say(physMsg, "La FC màxima ha d'estar entre 120 i 230.", "bad");
    if (!(hrRest >= 25 && hrRest <= 100 && hrRest < hrMax)) return say(physMsg, "La FC en repòs ha d'estar entre 25 i 100 i per sota de la màxima.", "bad");
    if (weight != null && !(weight >= 30 && weight <= 200)) return say(physMsg, "El pes no sembla correcte.", "bad");
    if (height != null && !(height >= 120 && height <= 230)) return say(physMsg, "L'alçada no sembla correcta.", "bad");
    busy(physBtn, true, "Desant…");
    try {
      const cur = await getSettings(db);
      const hrChanged = cur.hrMax !== hrMax || cur.hrRest !== hrRest;
      await db.setKV("settings", { ...cur, weight, height });
      if (hrChanged && dataState.count) {
        say(physMsg, "Recalculant totes les sortides…");
        const r = await recalcAll(db, { hrMax, hrRest, now: now() });
        say(physMsg, `Desat. ${fmtInt(r.count)} sortides recalculades amb ${hrMax}/${hrRest}.` +
          (r.pendingStreams ? ` ${fmtInt(r.pendingStreams)} de l'últim any tornen a la cua d'anàlisi.` : ""), "ok");
        await paintData();
      } else {
        await db.setKV("settings", { ...cur, weight, height, hrMax, hrRest });
        say(physMsg, "Desat.", "ok");
      }
    } catch (e) { say(physMsg, "No s'ha pogut desar: " + e.message, "bad"); }
    finally { busy(physBtn, false, "Desa"); }
  };

  // Retorn de Strava: l'avís mana per sobre del missatge de l'estat.
  await paintData();
  await checkStrava();
  if (app.notice) {
    if (app.notice.ok) say(stravaMsg, "Strava connectat.", "ok");
    else say(stravaMsg, "No s'ha connectat: " + (app.notice.reason || "motiu desconegut") + ".", "bad");
  }
  if (app.notice && app.notice.ok && stravaState === "connected") { app.notice = null; await doSync(); }
  return { checkStrava, doSync };
}
