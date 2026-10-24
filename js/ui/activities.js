// RunTracker v2 — Sortides: llista per mesos amb les xifres del període, i el detall de cada sortida.

import { h, say, fmtInt } from "./dom.js";
import { ZONES, sessionSummary, intensityRead, loadRead, vo2Read, efficiency, compareSimilar, weekContext, periodStats, highlights, byMonth } from "../engine/activity.js";
import { calcStreaks } from "../engine/performance.js";
import { activeZoneBounds, actWx, heatPaceAdjPct, calcCardiacDrift } from "../engine/physio.js";
import { calcFF } from "../engine/load.js";
import { strengthDaily } from "../engine/schedule.js";
import { getSettings, getWorkerConfig } from "../data/config.js";
import { loadStrength } from "../data/strength.js";
import { setNote } from "../data/notes.js";
import { workerClient, activityStreams } from "../data/strava.js";
import { syncSoon } from "../data/sync.js";

const dec = (n, d = 1) => n == null ? "—" : Number(n).toLocaleString("ca-ES", { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtPace = s => s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "—";
export const fmtDur = s => { if (!s) return "—"; const hh = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = Math.round(s % 60); return hh ? `${hh}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`; };
const longDate = ds => new Date(ds + "T12:00:00").toLocaleDateString("ca-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDate = ds => new Date(ds + "T12:00:00").toLocaleDateString("ca-ES", { weekday: "short", day: "numeric" });
const monthName = k => { const s = new Date(k + "-15T12:00:00").toLocaleDateString("ca-ES", { month: "long", year: "numeric" }); return s.charAt(0).toUpperCase() + s.slice(1); };
const zoneChip = z => z == null ? null : h("span", { class: `zchip z${z}` }, `Z${z + 1}`);
const PERIODS = [[7, "7 dies"], [28, "28 dies"], [365, "1 any"]];

function delta(pct, higherBetter = true) {
  if (pct == null) return h("span.delta", "—");
  const good = Math.abs(pct) < 1 ? null : (pct > 0) === higherBetter;
  return h("span", { class: "delta" + (good === null ? "" : good ? " up" : " down") }, `${pct > 0 ? "▲ +" : pct < 0 ? "▼ " : ""}${dec(pct)} %`);
}

// ═══════════════ Llista ═══════════════

export async function renderActivities(root, app) {
  const { db } = app;
  const now = (app.now || Date.now)();
  const acts = await db.getAll("activities");
  const settings = await getSettings(db);
  root.replaceChildren(h("div.stack", h("p.eyebrow", `${fmtInt(acts.length)} sortides`), h("h1", "Sortides")));
  if (!acts.length) {
    root.append(h("section.card.empty", h("h2", "Encara no hi ha sortides"), h("p", "Connecta Strava o importa la v1 des del Perfil."), h("p", h("a.btn.primary", { href: "#/perfil" }, "Ves al Perfil"))));
    return;
  }
  const ctx = { acts, settings, now };

  // ── Període ──
  let days = app.period || 28;
  const periodBox = h("section.card", { "aria-labelledby": "h-period" });
  function paintPeriod() {
    const p = periodStats(ctx, days), c = p.cur;
    const hl = highlights(ctx, days);
    const sk = calcStreaks(ctx);
    const link = (label, a, val) => a ? h("a.hl", { href: `#/activitats/${encodeURIComponent(a.id)}` }, h("span.small.muted", label), h("b", val), h("span.small.muted", shortDate(a.date))) : null;
    periodBox.replaceChildren(
      h("div.card-head", h("h2", { id: "h-period" }, "Període"),
        h("div.seg", { role: "group", "aria-label": "Període" }, ...PERIODS.map(([d, l]) => h("button", { type: "button", "aria-pressed": String(d === days), onclick: () => { days = d; app.period = d; paintPeriod(); } }, l)))),
      h("div.stats",
        h("div.stat", h("b", dec(c.km)), h("span", "km"), delta(p.d.km)),
        h("div.stat", h("b", String(c.n)), h("span", "sortides"), delta(p.d.n)),
        h("div.stat", h("b", fmtDur(c.dur).replace(/:\d\d$/, "")), h("span", "temps (h:mm)"), delta(p.d.dur)),
        h("div.stat", h("b", fmtInt(Math.round(c.asc))), h("span", "m de desnivell"), delta(p.d.asc)),
        h("div.stat", h("b", fmtPace(c.pace)), h("span", "ritme mitjà"), delta(p.d.pace, false)),
        h("div.stat", h("b", c.hr ? String(c.hr) : "—"), h("span", "FC mitjana"), delta(p.d.hr, false))),
      h("p.small.muted", `Comparat amb els ${days === 365 ? "12 mesos" : days + " dies"} anteriors. Ratxa: ${sk.cur} ${sk.cur === 1 ? "dia" : "dies"} seguits (la millor, ${sk.best}).`),
      (hl.longest || hl.climb || hl.fastest) ? h("div.hls",
        link("Més llarga", hl.longest, hl.longest && `${dec(hl.longest.distance)} km`),
        link("Més desnivell", hl.climb, hl.climb && `${fmtInt(hl.climb.ascent)} m`),
        link("Més ràpida (≥ 5 km)", hl.fastest, hl.fastest && `${fmtPace(hl.fastest.pace)}/km`)) : null);
  }
  paintPeriod();
  root.append(periodBox);

  // ── Llista per mesos ──
  const months = byMonth(acts);
  let shown = app.monthsShown || 3;
  const listBox = h("div.stack");
  const more = h("button.btn", { type: "button" }, "Mostra'n més");
  function paintList() {
    listBox.replaceChildren(...months.slice(0, shown).map(m => h("section.card.month", { "aria-label": monthName(m.month) },
      h("div.card-head", h("h2", monthName(m.month)), h("span.small.muted", `${m.acts.length} · ${dec(m.km)} km`)),
      h("ul.list.acts", ...m.acts.map(a => h("li", h("a.act", { href: `#/activitats/${encodeURIComponent(a.id)}` },
        h("div.act-main", h("span.small.muted", shortDate(a.date)), h("b", a.title || "Cursa"),
          h("span.small.muted", [fmtPace(a.pace) + "/km", fmtDur(a.duration), a.avgHR ? a.avgHR + " ppm" : null, a.ascent ? `${a.ascent} m+` : null].filter(Boolean).join(" · "))),
        h("div.act-side", h("b.act-km", dec(a.distance)), h("span.small.muted", "km"), zoneChip(a.hrZone)))))))));
    more.hidden = shown >= months.length;
  }
  more.onclick = () => { shown += 6; app.monthsShown = shown; paintList(); };
  paintList();
  root.append(listBox, h("div.row", more));
  if (app.scrollY) { try { window.scrollTo(0, app.scrollY); } catch { /* sense scroll */ } }
}

// ═══════════════ Detall ═══════════════

export async function renderActivity(root, app, id) {
  const { db } = app;
  const now = (app.now || Date.now)();
  const fetchImpl = app.fetchImpl || ((...x) => fetch(...x));
  let act = await db.get("activities", id);
  const back = h("a.back", { href: "#/activitats" }, "← Sortides");
  if (!act) { root.replaceChildren(back, h("section.card.empty", h("h2", "No trobo aquesta sortida"), h("p", "Potser s'ha esborrat o encara no s'ha sincronitzat."))); return; }
  const acts = (await db.getAll("activities")).sort((x, y) => (x.startTime || x.date).localeCompare(y.startTime || y.date));
  const settings = await getSettings(db);
  const tempCache = (await db.getKV("tempCache")) || {};
  const bounds = activeZoneBounds({ acts, settings, now, streamCache: {} });
  const sync = () => { if (!app.noSync) syncSoon(db, { fetchImpl }); };
  const again = () => renderActivity(root, app, id);

  const i = acts.findIndex(x => x.id === id);
  const prev = acts[i - 1], next = acts[i + 1];
  const a = act;
  const kids = [back,
    h("div.stack", h("p.eyebrow", longDate(a.date) + (a.startTime ? " · " + a.startTime.slice(11, 16) : "")),
      h("h1", a.title || "Cursa"),
      a.hrZone != null ? h("div.row", zoneChip(a.hrZone), h("span.small.muted", ZONES[a.hrZone])) : null)];

  // ── Xifres ──
  const trimpEst = a.trimp == null && a.distance ? Math.round(a.distance * 5) : null;
  kids.push(h("section.stats.big-stats", { "aria-label": "Xifres" },
    h("div.stat", h("b", dec(a.distance, 2)), h("span", "km")),
    h("div.stat", h("b", fmtDur(a.duration)), h("span", "temps")),
    h("div.stat", h("b", fmtPace(a.pace)), h("span", "ritme /km")),
    h("div.stat", h("b", a.avgHR ? String(a.avgHR) : "—"), h("span", "FC mitjana")),
    h("div.stat", h("b", a.maxHR ? String(a.maxHR) : "—"), h("span", "FC màxima")),
    h("div.stat", h("b", a.trimp != null ? String(Math.round(a.trimp)) : trimpEst != null ? trimpEst + "*" : "—"), h("span", "TRIMP"))));
  if (trimpEst != null) kids.push(h("p.small.muted", "* Estimat per la distància: aquesta sortida no té FC."));

  // ── Resum ──
  const sum = sessionSummary(a, bounds);
  if (sum) kids.push(h("section.card.summary", { dataset: { kind: sum.kind } }, h("h2", sum.title), h("p", sum.text), sum.warn ? h("p.msg.warn", sum.warn) : null));

  // ── Valoració ──
  const noteMsg = h("div.msg");
  const save = async patch => {
    try { act = await setNote(db, id, patch); sync(); await again(); }
    catch (e) { say(noteMsg, e.message, "bad"); }
  };
  kids.push(h("section.card", { "aria-labelledby": "h-rate" },
    h("h2", { id: "h-rate" }, "Valoració"),
    h("p.small.muted", "Esforç percebut (RPE): com de dura t'ha semblat, independentment del ritme."),
    h("div.rpe", { role: "group", "aria-label": "RPE de 1 a 10" }, ...Array.from({ length: 10 }, (_, k) => k + 1).map(v =>
      h("button", { type: "button", "aria-pressed": String(a.rpe === v), onclick: () => save({ rpe: a.rpe === v ? null : v }) }, String(v)))),
    h("p.small.muted", "Sensacions"),
    h("div.seg.wide", { role: "group", "aria-label": "Sensacions" }, ...["Molt dur", "Dur", "Normal", "Bé", "Genial"].map((l, k) =>
      h("button", { type: "button", "aria-pressed": String(a.feel === k + 1), onclick: () => save({ feel: a.feel === k + 1 ? null : k + 1 }) }, l))),
    noteMsg));

  // ── Detalls ──
  const wx = actWx(a, tempCache);
  const ir = intensityRead(a.avgHR, settings.hrMax);
  const eff = efficiency(a);
  const cal = a.calories || (a.duration && settings.weight ? Math.round(a.duration / 60 * settings.weight * 0.175) : null);
  const reliable = a.vo2conf === "stream" || a.vo2conf === "race";
  const cell = (l, v, extra) => h("div.cell", h("span.small.muted", l), h("b", v), extra || null);
  kids.push(h("section.card", { "aria-labelledby": "h-det" },
    h("h2", { id: "h-det" }, "Detalls"),
    h("div.cells",
      cell("Desnivell +", a.ascent ? `${a.ascent} m` : "—"),
      cell("Cadència", a.cadence ? `${a.cadence} ppm` : "—"),
      cell("VO₂max", a.vo2 ? dec(a.vo2) : "—", a.vo2 ? h("span", { class: "tag" + (reliable ? " ok" : "") }, reliable ? "fiable" : "orientatiu") : null),
      cell("Calories", cal ? `${fmtInt(cal)} kcal` : "—"),
      cell("Intensitat", ir ? `${ir.pct} % FC màx.` : "—"),
      cell("Eficiència", eff ? `${dec(eff, 2)} s/ppm` : "—"),
      cell("Temperatura", wx && wx.t != null ? `${dec(wx.t, 0)} °C` : "—"),
      cell("Temps per zona", a.tiz ? a.tiz.map(m => Math.round(m)).join(" · ") + " min" : "—"))));

  // ── Condicions i VO₂ ──
  if (a.source === "strava" || typeof a.tempManual === "number") {
    const adj = wx ? heatPaceAdjPct(wx.t, wx.dp) : 0;
    const notes = [];
    if (a.ascent && a.distance) notes.push("desnivell");
    if (adj > 0) notes.push(`calor i humitat (−${dec(adj, 2)} % de ritme)`);
    if (wx && wx.elev != null && wx.elev > 600) notes.push(`altitud (+${dec(6.3 * (wx.elev - 600) / 1000)} % de VO₂)`);
    const tIn = h("input.input", { id: "t-man", type: "text", inputmode: "decimal", autocomplete: "off", value: typeof a.tempManual === "number" ? String(a.tempManual).replace(".", ",") : "" });
    const tBtn = h("button.btn.small", { type: "button", onclick: () => { const v = tIn.value.trim().replace(",", "."); save({ tempManual: v === "" ? null : +v }); } }, "Desa");
    kids.push(h("section.card", { "aria-labelledby": "h-vo2" },
      h("h2", { id: "h-vo2" }, "Condicions i VO₂max"),
      wx ? h("div.stats",
        h("div.stat", h("b", wx.t != null ? `${dec(wx.t, 0)}°` : "—"), h("span", "temperatura")),
        h("div.stat", h("b", wx.dp != null ? `${dec(wx.dp, 0)}°` : "—"), h("span", "punt de rosada")),
        h("div.stat", h("b", wx.elev != null ? `${fmtInt(wx.elev)} m` : "—"), h("span", "altitud"))) : h("p.small", "Sense dades del temps d'aquesta sortida. Pots posar la temperatura a mà."),
      wx ? h("p.small.muted", "Font: " + (typeof a.tempManual === "number" ? "manual" : "Open-Meteo")) : null,
      a.vo2raw != null && a.vo2 != null && a.vo2raw !== a.vo2 ? h("p", "VO₂max cru → corregit: ", h("b", `${dec(a.vo2raw)} → ${dec(a.vo2)}`)) : null,
      h("p.small", "Mètode: " + (a.vo2conf === "stream" ? `relació FC–ritme per finestres (${a.vo2n || 0} finestres vàlides): estable.` : a.vo2conf === "race" ? "VDOT, perquè és una cursa marcada: fiable." : "estimació amb la sortida sencera: orientativa.")),
      h("p.small.muted", notes.length ? "Correccions aplicades: " + notes.join(" · ") + "." : "Condicions neutres: sense correccions."),
      h("label.check", h("input", { type: "checkbox", checked: !!a.isRace, onchange: e => save({ isRace: e.target.checked }) }), " És una cursa o un test (fa servir el VDOT)"),
      h("div.field", h("label", { for: "t-man" }, "Temperatura manual"), h("div.with-btn", h("div.unit", { style: "flex:1" }, tIn, h("span", "°C")), tBtn))));
  }

  // ── Avaluació ──
  const lr = loadRead(a.trimp);
  const cmp = compareSimilar(acts, a);
  const evals = [];
  if (ir) evals.push(["Intensitat", ir.label, ir.text, ir.tone]);
  if (lr) evals.push(["Càrrega", lr.label, lr.text, lr.tone]);
  if (a.vo2) evals.push(["VO₂max", `${dec(a.vo2)} · ${vo2Read(a.vo2)}`, reliable ? "Calculat amb les dades segon a segon o com a cursa." : "Orientatiu: estimat amb la mitjana de la sortida.", "ok"]);
  if (eff && cmp && cmp.eff) evals.push(["Eficiència", `${dec(eff, 2)} s/ppm`, eff < cmp.eff ? `Millor que la mitjana de sortides semblants (${dec(cmp.eff, 2)}).` : `Per sobre de la mitjana de sortides semblants (${dec(cmp.eff, 2)}): fatiga, calor o terreny dur.`, eff < cmp.eff ? "ok" : "warn"]);
  if (evals.length) kids.push(h("section.card", { "aria-labelledby": "h-eval" }, h("h2", { id: "h-eval" }, "Avaluació"),
    h("ul.list", ...evals.map(([t, l, x, tone]) => h("li", h("div.li", h("b", t), h("span", { class: "tag " + tone }, l)), h("p.small.muted", x))))));

  // ── Forma aquell dia ──
  const { sessions } = await loadStrength(db);
  const ff = calcFF({ acts, now, extraDaily: strengthDaily(sessions) });
  const day = ff.find(f => f.date === a.date);
  if (day) kids.push(h("section.card", { "aria-labelledby": "h-ff" }, h("h2", { id: "h-ff" }, "Forma aquell dia"),
    h("div.stats", h("div.stat", h("b", dec(day.ctl)), h("span", "fitness (CTL)")), h("div.stat", h("b", dec(day.atl)), h("span", "fatiga (ATL)")), h("div.stat", h("b", dec(day.tsb)), h("span", "forma (TSB)"))),
    h("p.small.muted", day.tsb > 10 ? "Hi arribaves fresc." : day.tsb < -15 ? "Hi havia fatiga acumulada: pot haver afectat el rendiment." : "Equilibri normal entre fitness i fatiga.")));

  // ── Sortides semblants ──
  if (cmp) {
    const rows = [...cmp.list.slice(-7), a];
    const dp = a.pace && cmp.pace ? Math.round(a.pace - cmp.pace) : null;
    kids.push(h("section.card", { "aria-labelledby": "h-sim" },
      h("h2", { id: "h-sim" }, `Sortides semblants (~${Math.round(a.distance || 0)} km)`),
      h("p.small", dp == null ? "" : dp < 0 ? `${-dp} s/km més ràpida que la mitjana de les ${cmp.n} anteriors` : dp > 0 ? `${dp} s/km més lenta que la mitjana de les ${cmp.n} anteriors` : `Al ritme mitjà de les ${cmp.n} anteriors`,
        a.avgHR && cmp.hr ? `, amb la FC ${a.avgHR - cmp.hr > 0 ? "+" : ""}${a.avgHR - cmp.hr} ppm.` : "."),
      h("table.tbl", h("thead", h("tr", h("th", "Data"), h("th", "km"), h("th", "Ritme"), h("th", "FC"))),
        h("tbody", ...rows.reverse().map(x => h("tr", { class: x.id === a.id ? "me" : "" },
          h("td", x.id === a.id ? "Aquesta" : h("a", { href: `#/activitats/${encodeURIComponent(x.id)}` }, shortDate(x.date))),
          h("td", dec(x.distance)), h("td", fmtPace(x.pace)), h("td", x.avgHR ? String(x.avgHR) : "—")))))));
  }

  // ── Setmana ──
  const wk = weekContext(acts, a);
  if (wk.n > 1) kids.push(h("p.small.muted.week-ctx", `Aquella setmana: ${dec(wk.km)} km en ${wk.n} sortides · TRIMP ${fmtInt(wk.trimp)}.`));

  // ── Segon a segon ──
  const adv = h("div.stack");
  const advMsg = h("div.msg");
  kids.push(h("section.card", { "aria-labelledby": "h-adv" }, h("h2", { id: "h-adv" }, "Anàlisi segon a segon"), adv, advMsg));
  const paintAdv = streams => {
    const drift = streams ? calcCardiacDrift(streams) : null;
    const parts = [];
    if (drift) {
      const tone = drift.decoupling < 5 ? "ok" : drift.decoupling < 10 ? "warn" : "bad";
      parts.push(h("div.stats",
        h("div.stat", h("b", String(drift.hr1)), h("span", "FC 1a meitat")),
        h("div.stat", h("b", String(drift.hr2)), h("span", "FC 2a meitat")),
        h("div.stat", h("b", { class: "t-" + tone }, `${dec(drift.decoupling)} %`), h("span", "deriva" + (drift.adj ? " (aj. pendent)" : "")))),
        h("p.small.muted", tone === "ok" ? "Excel·lent: FC molt estable, bona resistència aeròbica." : tone === "warn" ? "Acceptable: lleugera deriva, normal en sortides llargues." : "Deriva alta: fatiga, deshidratació o calor."));
    }
    if (a.be || act.be) {
      const be = act.be || a.be;
      const lab = { 60: "1 min", 120: "2 min", 300: "5 min", 600: "10 min", 1200: "20 min", 1800: "30 min", 3600: "60 min" };
      parts.push(h("p.small", h("b", "Millors esforços d'aquesta sortida")),
        h("div.cells", ...Object.keys(lab).filter(k => be[k]).map(k => h("div.cell", h("span.small.muted", lab[k]), h("b", fmtPace(1000 / be[k]) + "/km")))));
    }
    if (!parts.length) parts.push(h("p.small.muted", streams ? "No s'ha pogut calcular: falten dades de FC o GPS en aquesta sortida." : "Deriva cardíaca i millors esforços, amb les dades segon a segon de Strava."));
    adv.replaceChildren(...parts);
  };
  const cachedStreams = await db.get("streams", id);
  paintAdv(cachedStreams);
  if (!cachedStreams && a.source === "strava") {
    const b = h("button.btn", { type: "button" }, "Carrega-les de Strava");
    b.onclick = async () => {
      b.disabled = true; say(advMsg, "Baixant de Strava…");
      try {
        const cfg = await getWorkerConfig(db);
        const r = await activityStreams({ db, worker: workerClient({ ...cfg, fetchImpl }), fetchImpl, act, now });
        act = r.act; say(advMsg, ""); b.remove(); paintAdv(r.streams);
      } catch (e) { say(advMsg, e.message, "bad"); b.disabled = false; }
    };
    adv.append(h("div.row", b));
  }

  // ── Anterior i següent ──
  kids.push(h("nav.row.prevnext", { "aria-label": "Altres sortides" },
    prev ? h("a.btn", { href: `#/activitats/${encodeURIComponent(prev.id)}` }, `← ${shortDate(prev.date)}`) : h("span"),
    next ? h("a.btn", { href: `#/activitats/${encodeURIComponent(next.id)}` }, `${shortDate(next.date)} →`) : h("span")));

  root.replaceChildren(...kids);
}
