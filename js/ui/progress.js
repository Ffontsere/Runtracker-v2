// RunTracker v2 — pestanya Progrés: Forma, Rendiment i Fisiologia.

import { h, say, fmtInt } from "./dom.js";
import { fmtPace, fmtDur } from "./activities.js";
import { lineChart, barChart } from "./chart.js";
import { formSeries, weeklyVolume, yearProgress, personalBests, predictions, vo2Series, activeZones, validateZones } from "../engine/progress.js";
import { calcACWR, calcMonotony } from "../engine/load.js";
import { blockReport, loadResponse, calcStreaks } from "../engine/performance.js";
import { currentVO2max, efficiencyTrend, efficiencySeries, durabilityTrend, getZoneDist } from "../engine/physio.js";
import { strengthDaily } from "../engine/schedule.js";
import { getSettings } from "../data/config.js";
import { loadStrength } from "../data/strength.js";
import { recalcAll } from "../data/recalc.js";

const dec = (n, d = 1) => n == null ? "—" : Number(n).toLocaleString("ca-ES", { minimumFractionDigits: d, maximumFractionDigits: d });
const sign = n => n == null ? "—" : (n > 0 ? "+" : n < 0 ? "−" : "") + dec(Math.abs(n));
const dm = ds => { const [, m, d] = ds.split("-"); return `${+d}/${+m}`; };
const longD = ds => { const [y, m, d] = ds.split("-"); return `${+d}/${+m}/${y.slice(2)}`; };
const SUBS = [["forma", "Forma"], ["rendiment", "Rendiment"], ["fisio", "Fisiologia"]];

/**
 * @param {HTMLElement} root
 * @param {{db, now?:()=>number, sub?:string}} app  `sub` es manté entre visites
 */
export async function renderProgress(root, app) {
  const { db } = app;
  const now = (app.now || Date.now)();
  const acts = await db.getAll("activities");
  const settings = await getSettings(db);
  const tempCache = (await db.getKV("tempCache")) || {};
  const { sessions } = await loadStrength(db);
  const ctx = { acts, settings, now, tempCache, extraDaily: strengthDaily(sessions) };

  const head = h("div.stack", h("p.eyebrow", "Com evoluciones"), h("h1", "Progrés"));
  if (!acts.length) {
    root.replaceChildren(head, h("section.card.empty", h("h2", "Encara no hi ha sortides"), h("p", "Connecta Strava o importa la v1 des del Perfil."), h("p", h("a.btn.primary", { href: "#/perfil" }, "Ves al Perfil"))));
    return;
  }
  const body = h("div.stack");
  const tabs = h("div.seg.wide", { role: "tablist", "aria-label": "Apartat" });
  const paint = () => {
    const sub = app.sub || "forma";
    tabs.replaceChildren(...SUBS.map(([k, l]) => h("button", { type: "button", role: "tab", "aria-selected": String(k === sub), "aria-pressed": String(k === sub), onclick: () => { app.sub = k; paint(); } }, l)));
    body.replaceChildren(...(sub === "forma" ? forma(ctx) : sub === "rendiment" ? rendiment(ctx) : fisio(ctx, app)));
  };
  root.replaceChildren(head, tabs, body);
  app.repaint = () => renderProgress(root, app);
  paint();
}

// ─────────────── Forma ───────────────
function forma(ctx) {
  const out = [];
  const fs = formSeries(ctx, 120, 14);
  if (fs) {
    const all = [...fs.past, ...fs.proj];
    const cut = fs.past.length - 1;
    const end = fs.proj.at(-1);
    const card = h("section.card", { "aria-labelledby": "h-form" },
      h("div.card-head", h("h2", { id: "h-form" }, "Fitness i fatiga"), h("span.small.muted", "120 dies + 14")),
      h("div.stats",
        h("div.stat", h("b", dec(fs.now.ctl)), h("span", "fitness (CTL)")),
        h("div.stat", h("b", dec(fs.now.atl)), h("span", "fatiga (ATL)")),
        h("div.stat", h("b", sign(fs.now.tsb)), h("span", "forma (TSB)"))));
    lineChart(card, {
      label: "Fitness i fatiga dels últims 120 dies i projecció de 14 dies",
      labels: all.map(p => p.date), xFmt: dm, yFmt: v => String(Math.round(v)),
      series: [
        { key: "ctl", name: "Fitness (CTL)", cls: "s1", values: all.map(p => p.ctl), dashFrom: cut },
        { key: "atl", name: "Fatiga (ATL)", cls: "s2", values: all.map(p => p.atl), dashFrom: cut },
      ],
    });
    const tsbCard = h("div.stack", h("p.eyebrow", "Forma (TSB)"));
    lineChart(tsbCard, {
      label: "Forma (TSB) dels últims 120 dies i projecció", height: 120, zero: true,
      labels: all.map(p => p.date), xFmt: dm, yFmt: v => String(Math.round(v)),
      series: [{ key: "tsb", name: "Forma (TSB)", cls: "s1", values: all.map(p => p.tsb), dashFrom: cut }],
    });
    card.append(tsbCard, h("p.small.muted",
      `La línia discontínua suposa que segueixes amb la teva càrrega mitjana dels últims 28 dies (${dec(fs.daily, 0)} de TRIMP al dia, força inclosa). ` +
      `D'aquí 14 dies: fitness ${dec(end.ctl)} i forma ${sign(end.tsb)}.`));
    out.push(card);
  }

  // Càrrega
  const acwr = calcACWR(ctx), mono = calcMonotony(ctx);
  out.push(h("section.card", { "aria-labelledby": "h-load" },
    h("h2", { id: "h-load" }, "Càrrega"),
    h("div.stats",
      h("div.stat", h("b", acwr == null ? "—" : dec(acwr, 2)), h("span", "ACWR")),
      h("div.stat", h("b", mono ? dec(mono.monotony, 2) : "—"), h("span", "monotonia")),
      h("div.stat", h("b", mono ? fmtInt(mono.strain) : "—"), h("span", "strain setmanal"))),
    h("p.small.muted", (acwr == null ? "" : acwr > 1.5 ? "ACWR alt: la càrrega puja més de pressa del que el cos està acostumat. " : acwr < 0.8 ? "ACWR baix: aquests dies has carregat menys que de costum. " : "ACWR a la zona habitual (0,8–1,3). ") +
      (mono ? (mono.monotony > 2 ? "Monotonia alta: tots els dies s'assemblen; alterna dies durs i fàcils." : "Monotonia correcta: hi ha prou contrast entre dies.") : ""))));

  // Volum
  const wv = weeklyVolume(ctx, 16), yp = yearProgress(ctx);
  const vol = h("section.card", { "aria-labelledby": "h-vol" },
    h("div.card-head", h("h2", { id: "h-vol" }, "Volum setmanal"), h("span.small.muted", "16 setmanes")));
  barChart(vol, {
    label: "Quilòmetres per setmana de les últimes 16 setmanes",
    items: wv.map(w => ({ label: w.week, value: w.km, strong: w.current })),
    fmt: v => dec(v, Number.isInteger(v) ? 0 : 1), xFmt: dm,
    target: ctx.settings.weeklyTarget || null, targetLabel: ctx.settings.weeklyTarget ? `objectiu ${ctx.settings.weeklyTarget}` : null,
  });
  vol.append(h("p.small.muted", yp.goal
    ? `${yp.year}: ${fmtInt(yp.km)} de ${fmtInt(yp.goal)} km (${yp.pct} %). Avui hauries de ser a ${fmtInt(yp.expected)}: ${yp.km >= yp.expected ? `vas ${fmtInt(yp.km - yp.expected)} km per davant` : `et falten ${fmtInt(yp.expected - yp.km)} km`}.`
    : `${yp.year}: ${fmtInt(yp.km)} km.`));
  out.push(vol);

  // Informe de bloc
  const br = blockReport(ctx), lr = loadResponse(ctx);
  if (br) out.push(h("section.card", { "aria-labelledby": "h-block" },
    h("h2", { id: "h-block" }, "Informe de bloc"),
    h("p.small.muted", `Últimes 4 setmanes contra les 4 anteriors: ${fmtInt(br.km1)} km en ${br.n1} sortides (abans ${fmtInt(br.km0)} km).`),
    h("ul.bullets", ...br.concl.map(c => h("li", c))),
    lr ? h("p.small.muted", `Resposta a la càrrega: correlació ${dec(lr.r, 2)} entre el volum de 4 setmanes i l'eficiència de les 4 següents (${lr.n} punts). ` +
      (lr.r > 0.3 ? "Quan puges volum, l'eficiència acaba millorant." : lr.r < -0.3 ? "Quan puges volum, l'eficiència empitjora: pot ser fatiga." : "Encara no hi ha una relació clara.")) : null));
  return out;
}

// ─────────────── Rendiment ───────────────
function rendiment(ctx) {
  const out = [];
  const all = personalBests(ctx), year = personalBests(ctx, 365, ctx.now);
  const row = (n, b) => h("tr",
    h("td", n),
    h("td", b ? fmtDur(b.time) : "—"),
    h("td", b ? h("a", { href: `#/activitats/${encodeURIComponent(b.id)}` }, longD(b.date)) : "—"),
    h("td", b ? h("span", { class: "tag" + (b.src === "esforç" ? "" : " ok"), title: b.src === "esforç" ? "Tram més ràpid dins d'una sortida, ajustat al pendent" : "Sortida sencera" }, b.src === "esforç" ? "tram" : "sortida") : null));
  const names = Object.keys(all);
  out.push(h("section.card", { "aria-labelledby": "h-pr" },
    h("h2", { id: "h-pr" }, "Marques"),
    h("p.small.muted", "El temps més ràpid de cada distància, sigui una sortida sencera o un tram dins d'una sortida més llarga (els trams surten de les dades segon a segon i estan ajustats al pendent)."),
    h("table.tbl", h("thead", h("tr", h("th", "Distància"), h("th", "Temps"), h("th", "Data"), h("th", ""))),
      h("tbody", ...names.map(n => row(n, all[n])))),
    h("details", h("summary", "Últims 12 mesos"),
      h("table.tbl", h("tbody", ...names.map(n => row(n, year[n])))))));

  const pr = predictions(ctx, year);
  if (pr) out.push(h("section.card", { "aria-labelledby": "h-pred" },
    h("h2", { id: "h-pred" }, "Predicció"),
    h("p.small.muted", `A partir de la teva millor marca dels últims 12 mesos: ${pr.ref.n} en ${fmtDur(pr.ref.time)} (${longD(pr.ref.date)}), que és un VDOT de ${dec(pr.vdot)}.`),
    h("table.tbl", h("thead", h("tr", h("th", "Distància"), h("th", "VDOT (Daniels)"), h("th", pr.exp ? `Riegel (${dec(pr.exp, 3)})` : "Riegel (1,06)"))),
      h("tbody", ...pr.rows.map(r => h("tr", h("td", r.n), h("td", fmtDur(r.vdot)), h("td", fmtDur(r.riegel)))))),
    h("p.small.muted", "VDOT suposa que la resistència és la típica per al teu nivell. Riegel " + (pr.exp ? "fa servir el teu exponent, calculat amb la teva corba d'esforços." : "fa servir l'exponent estàndard: el teu propi surt quan hi ha prou esforços llargs.") +
      " A la marató, tots dos depenen molt de l'entrenament específic.")));

  const sk = calcStreaks(ctx);
  out.push(h("section.card", { "aria-labelledby": "h-streak" },
    h("h2", { id: "h-streak" }, "Ratxes"),
    h("div.stats", h("div.stat", h("b", String(sk.cur)), h("span", "dies seguits ara")), h("div.stat", h("b", String(sk.best)), h("span", "la millor")))));
  return out;
}

// ─────────────── Fisiologia ───────────────
function fisio(ctx, app) {
  const out = [];
  const v = currentVO2max(ctx, 42);
  const vs = vo2Series(ctx, 26);
  const vo2 = h("section.card", { "aria-labelledby": "h-vo2p" },
    h("div.card-head", h("h2", { id: "h-vo2p" }, "VO₂max"),
      v ? h("span", { class: "tag" + (v.conf === "low" ? "" : " ok") }, v.conf === "low" ? "orientatiu" : "fiable") : null),
    h("p.big", h("b", v ? dec(v.value) : "—"), h("span.muted", " ml/kg/min")),
    h("p.small.muted", !v ? "Calen sortides de les últimes 6 setmanes." : v.conf === "stream"
      ? `Mitjana de ${v.n} sortides de les últimes 6 setmanes amb dades segon a segon, les recents pesen més.` + (v.fromRace ? " Una cursa marcada dona un valor més alt i és el que es mostra." : "")
      : v.conf === "race" ? "Surt de les curses marcades de les últimes 6 setmanes." : "Estimat amb la mitjana de cada sortida: analitza els streams al Perfil perquè sigui fiable."));
  if (vs.length >= 2) lineChart(vo2, {
    label: "VO₂max mitjà per setmana dels últims 6 mesos", height: 140,
    labels: vs.map(x => x.week), xFmt: dm, yFmt: x => dec(x, 0),
    series: [{ key: "vo2", name: "VO₂max", cls: "s1", values: vs.map(x => x.value) }],
  });
  out.push(vo2);

  const et = efficiencyTrend(ctx), es = efficiencySeries(ctx, 10, 28), du = durabilityTrend(ctx);
  const eff = h("section.card", { "aria-labelledby": "h-eff" },
    h("h2", { id: "h-eff" }, "Eficiència aeròbica"),
    h("p.small.muted", "Metres per minut per batec als rodatges fàcils, amb el ritme corregit per desnivell i calor. Més alt és millor."),
    et ? h("div.stats",
      h("div.stat", h("b", dec(et.recent, 3)), h("span", "últimes 4 setmanes")),
      h("div.stat", h("b", et.prev == null ? "—" : dec(et.prev, 3)), h("span", "4 anteriors")),
      h("div.stat", h("b", et.pct == null ? "—" : (et.pct > 0 ? "+" : "") + dec(et.pct) + " %"), h("span", "canvi"))) : h("p.small", "Calen almenys dos rodatges fàcils de 25 minuts o més en les últimes 4 setmanes."));
  if (es.length >= 3) lineChart(eff, {
    label: "Eficiència aeròbica en finestres de 4 setmanes", height: 130,
    labels: es.map(p => dateFromAgo(ctx.now, p.daysAgo)), xFmt: dm, yFmt: x => dec(x, 2),
    series: [{ key: "eff", name: "Eficiència", cls: "s1", values: es.map(p => p.index) }],
  });
  if (du) eff.append(h("p.small.muted", `Deriva a les llargues: ${dec(du.rec.avg)} % de mitjana als últims 3 mesos (${du.rec.n} sortides)` +
    (du.prev ? `, abans ${dec(du.prev.avg)} %. ${du.rec.avg < du.prev.avg ? "La durabilitat millora." : "La durabilitat no millora: allarga la llarga de mica en mica."}` : ".")));
  out.push(eff);

  out.push(zonesCard(ctx, app));
  return out;
}

/** Zones: les que s'apliquen, la distribució de 28 dies i l'editor. */
function zonesCard(ctx, app) {
  const az = activeZones(ctx);
  // Les sortides sense zona (antigues) es deixen fora: a la v1 feien que la distribució donés NaN (BUGS-v1 #7).
  const zd = getZoneDist({ acts: ctx.acts.filter(a => a.hrZone != null), now: ctx.now }, 28);
  const src = az.source === "manual" ? "Zones manuals." : az.source === "seiler"
    ? `Automàtiques, model polaritzat de Seiler: LT1 ${az.lt1} ppm (${az.detail.lt1src}), LT2 ${az.lt2} ppm (${az.detail.lt2src || "estimat"}).`
    : "Automàtiques per la FC de reserva (Karvonen): encara no hi ha prou esforços durs per estimar el llindar.";
  const z = h("section.card", { "aria-labelledby": "h-zones" },
    h("div.card-head", h("h2", { id: "h-zones" }, "Zones"), h("span", { class: "tag" + (az.source === "manual" ? " ok" : "") }, az.source === "manual" ? "manuals" : "automàtiques")),
    h("p.small.muted", src),
    h("table.tbl", h("thead", h("tr", h("th", "Zona"), h("th", "FC"), h("th", "28 dies"))),
      h("tbody", ...az.rows.map((x, i) => h("tr", h("td", `${x.z} ${x.name}`), h("td", x.lo == null ? `< ${x.hi}` : `${x.lo}–${x.hi}`), h("td", zd ? `${zd.pct[i]} %` : "—"))))));
  if (zd) {
    const easy = zd.pct[0] + zd.pct[1];
    z.append(h("p", { class: "small " + (easy >= 75 ? "" : "warn-text") }, easy >= 75 ? `${easy} % del temps en Z1–Z2: la distribució és polaritzada, com toca.` : `Només ${easy} % en Z1–Z2: massa intensitat, o unes zones que no són les teves. L'objectiu és un 80 % fàcil.`),
      h("p.small.muted", `${zd.coverage} % del temps amb dades segon a segon; la resta, per la FC mitjana de cada sortida.`));
  }

  // ── Editor ──
  const msg = h("div.msg");
  const labels = ["Inici de Z2", "Inici de Z3 (LT1)", "Inici de Z4 (LT2)", "Inici de Z5"];
  const ins = az.bounds.map((b, i) => h("input.input", { id: `zb-${i}`, type: "text", inputmode: "numeric", autocomplete: "off", value: String(b) }));
  const save = h("button.btn.primary", { type: "button" }, "Desa i recalcula");
  const reset = h("button.btn.quiet", { type: "button", hidden: az.source !== "manual" }, "Torna a les automàtiques");
  const apply = async zones => {
    save.disabled = reset.disabled = true;
    say(msg, "Recalculant les zones de totes les sortides…");
    try {
      const { db } = app;
      const cur = (await db.getKV("settings")) || {};
      await db.setKV("settings", { ...cur, zones });
      const r = await recalcAll(db, { hrMax: cur.hrMax, hrRest: cur.hrRest, now: ctx.now });
      app.zoneMsg = [`Desat. ${fmtInt(r.count)} sortides recalculades.` + (r.pendingStreams ? ` El temps per zona de ${fmtInt(r.pendingStreams)} sortides de l'últim any es refarà en analitzar els streams (Perfil → Analitza les pendents).` : ""), "ok"];
      await app.repaint();
    } catch (e) { say(msg, "No s'ha pogut desar: " + e.message, "bad"); save.disabled = reset.disabled = false; }
  };
  save.onclick = () => {
    const b = ins.map(x => Number(x.value.trim()));
    const err = validateZones(b, ctx.settings);
    if (err) return say(msg, err, "bad");
    apply(b);
  };
  reset.onclick = () => apply(null);
  if (app.zoneMsg) { say(msg, ...app.zoneMsg); app.zoneMsg = null; }
  z.append(h("details", { open: !!msg.textContent || undefined }, h("summary", "Edita les zones"),
    h("div.stack",
      h("p.small.muted", `Posa on comença cada zona, en pulsacions. FC en repòs ${ctx.settings.hrRest}, màxima ${ctx.settings.hrMax}. En desar, es recalcula la zona i el temps per zona de totes les sortides.`),
      h("div.grid2", ...ins.map((x, i) => h("div.field", h("label", { for: `zb-${i}` }, labels[i]), h("div.unit", x, h("span", "ppm"))))),
      msg, h("div.row", save, reset))));
  return z;
}

const dateFromAgo = (now, ago) => { const d = new Date(now - ago * 864e5); return d.toISOString().slice(0, 10); };
