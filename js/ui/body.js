// RunTracker v2 — pantalla Cos: pes com a tendència, cintura, greix i proteïna.

import { h, say } from "./dom.js";
import { bodySummary } from "../engine/body.js";
import { dateStr } from "../engine/dates.js";
import { loadBody, addEntry, deleteEntry, FIELDS, FIRST_ENTRY, FIRST_HEIGHT, sexOf } from "../data/body.js";
import { getSettings } from "../data/config.js";
import { syncSoon } from "../data/sync.js";

const fmt = (v, n = 1) => v == null ? "—" : Number(v).toLocaleString("ca-ES", { minimumFractionDigits: n, maximumFractionDigits: n });
const short = ds => { const [, m, d] = ds.split("-"); return `${+d}/${+m}`; };
const SVG = "http://www.w3.org/2000/svg";
const s = (tag, attrs) => { const el = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };

/** Línia del pes dels últims 90 dies. */
function weightChart(entries, today) {
  const from = dateStr(new Date(Date.parse(today + "T12:00:00") - 90 * 864e5));
  const pts = entries.filter(e => e.weight > 0 && e.date >= from).map(e => ({ d: e.date, w: e.weight }));
  if (pts.length < 2) return h("p.small.muted", "La línia del pes surt a partir de la segona pesada.");
  const xs = pts.map(p => Date.parse(p.d)), ys = pts.map(p => p.w);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys) - 0.3, y1 = Math.max(...ys) + 0.3;
  const X = x => 4 + (x - x0) / (x1 - x0 || 1) * 292, Y = y => 52 - (y - y0) / (y1 - y0 || 1) * 46;
  const svg = s("svg", { viewBox: "0 0 300 58", preserveAspectRatio: "none", class: "spark", role: "img", "aria-label": `Pes del ${short(pts[0].d)} al ${short(pts.at(-1).d)}: de ${fmt(ys[0])} a ${fmt(ys.at(-1))} kg` });
  svg.append(s("path", { d: pts.map((p, i) => `${i ? "L" : "M"}${X(xs[i]).toFixed(1)} ${Y(p.w).toFixed(1)}`).join(""), fill: "none", stroke: "currentColor", "stroke-width": 2, "vector-effect": "non-scaling-stroke" }));
  svg.append(s("circle", { cx: X(xs.at(-1)), cy: Y(ys.at(-1)), r: 3.5, fill: "currentColor" }));
  return h("div", svg, h("p.small.muted", `${short(pts[0].d)} – ${short(pts.at(-1).d)} · ${fmt(Math.min(...ys))}–${fmt(Math.max(...ys))} kg`));
}

/**
 * @param {HTMLElement} root
 * @param {{db, now?:()=>number, win?:Window, noSync?:boolean}} app
 */
export async function renderBody(root, app) {
  const { db } = app;
  const win = app.win || window;
  const today = dateStr(new Date((app.now || Date.now)()));
  const settings = await getSettings(db);
  const entries = await loadBody(db);
  const height = settings.height || null;
  const sex = sexOf(settings.sex);
  const sync = () => { if (!app.noSync) syncSoon(db); };
  const again = () => renderBody(root, app);

  root.replaceChildren(h("div.stack", h("p.eyebrow", height ? `Alçada ${fmt(height)} cm` : "Cos"), h("h1", "Cos")));

  if (!entries.length) {
    const msg = h("div.msg");
    const b = h("button.btn.primary", { type: "button", onclick: async () => {
      b.disabled = true;
      try {
        await addEntry(db, FIRST_ENTRY);
        if (!height) { const cur = await getSettings(db); await db.setKV("settings", { ...cur, height: FIRST_HEIGHT }); }
        sync(); await again();
      } catch (e) { say(msg, e.message, "bad"); b.disabled = false; }
    } }, "Afegeix-les");
    root.append(h("section.card", { "aria-labelledby": "h-first" },
      h("h2", { id: "h-first" }, "Comença amb les teves mesures"),
      h("p", `El 18 d'octubre em vas donar: ${fmt(FIRST_ENTRY.weight)} kg, cintura ${fmt(FIRST_ENTRY.waist)} cm, coll ${FIRST_ENTRY.neck} cm, maluc ${FIRST_ENTRY.hip} cm i ${fmt(FIRST_ENTRY.scaleFat)} % de greix a la bàscula` + (height ? "." : `, amb una alçada de ${fmt(FIRST_HEIGHT)} cm.`)),
      msg, h("div.row", b)));
  } else {
    const r = bodySummary(entries, { height, sex }, today);
    if (r.signal) root.append(h("p.msg.warn", r.signal.text));
    const tr = r.trend;
    const tile = (label, value, unit, note, cls = "", wide = false) =>
      h("div", { class: "tile" + (wide ? " wide" : "") }, h("p.eyebrow", label), h("p.tile-v", value, unit ? h("small", unit) : null), note ? h("p", { class: "small " + (cls || "muted") }, note) : null);
    root.append(h("section.tiles", { "aria-label": "Resum del cos" },
      h("div.tile.wide", h("p.eyebrow", "Pes · mitjana de 7 dies"), h("p.tile-v", fmt(r.weight), h("small", "kg")),
        h("p.small.muted", tr ? `${tr.delta > 0 ? "+" : ""}${fmt(tr.delta)} kg en 4 setmanes (${tr.perWeek > 0 ? "+" : ""}${fmt(tr.perWeek, 2)} kg per setmana)`
          : `${r.weightN} ${r.weightN === 1 ? "pesada" : "pesades"} en 7 dies. La tendència surt quan hi hagi pesades de fa 4 setmanes.`),
        h("div.chart", weightChart(entries, today))),
      height ? tile("Cintura / alçada", fmt(r.waistHeight, 2), "", r.waistHeightRead ? r.waistHeightRead.text : "Falta la cintura", r.waistHeightRead ? r.waistHeightRead.level : "")
        : h("div.tile", h("p.eyebrow", "Cintura / alçada"), h("p.small", "Posa l'alçada al ", h("a", { href: "#/perfil" }, "Perfil"), ".")),
      tile("Cintura / maluc", fmt(r.waistHip, 2), "", r.waistHipRead ? r.waistHipRead.text : "Opcional: afegeix el maluc", r.waistHipRead ? r.waistHipRead.level : ""),
      tile("Greix · Marina", fmt(r.navyFat), "%", `Bàscula: ${r.scaleFat != null ? fmt(r.scaleFat) + " %" : "—"}`),
      tile("Massa magra", fmt(r.lean), "kg", "Pes × (1 − greix Marina)"),
      tile("Proteïna d'avui", r.protein ? String(r.protein.g) : "—", "g", r.protein ? `1,6 g per kg · ${r.protein.lo}–${r.protein.hi} g en 3–4 àpats` : "Registra el pes", "", true)));
  }

  // ── Nova mesura ──
  const msg = h("div.msg");
  const dateIn = h("input.input", { id: "b-date", type: "date", value: today, max: today });
  const inputs = Object.fromEntries(FIELDS.map(([k]) => [k, h("input.input", { id: "b-" + k, type: "text", inputmode: "decimal", autocomplete: "off" })]));
  const field = k => { const [, label, , , , unit] = FIELDS.find(f => f[0] === k); return h("div.field", h("label", { for: "b-" + k }, label), h("div.unit", inputs[k], h("span", unit))); };
  const saveBtn = h("button.btn.primary", { type: "submit" }, "Desa la mesura");
  const form = h("form.card", { novalidate: true, "aria-labelledby": "h-new", onsubmit: async ev => {
    ev.preventDefault();
    const input = { date: dateIn.value || today };
    for (const k of Object.keys(inputs)) { const v = inputs[k].value.replace(",", "."); input[k] = v === "" ? null : +v; }
    saveBtn.disabled = true;
    try { await addEntry(db, input); sync(); await again(); say(root.querySelector("#b-msg"), "Mesura desada.", "ok"); }
    catch (e) { say(msg, e.message, "bad"); saveBtn.disabled = false; }
  } },
    h("h2", { id: "h-new" }, "Nova mesura"),
    h("div.grid2", h("div.field", h("label", { for: "b-date" }, "Data"), dateIn), field("weight")),
    h("div.grid3", field("waist"), field("neck"), field("hip")),
    field("scaleFat"),
    h("p.small.muted", "Pesa't al matí, en dejú. La cintura, a l'altura del melic després d'expirar. Omple només el que hagis mesurat."),
    h("div", { id: "b-msg", class: "msg" }), msg, h("div.row", saveBtn));
  root.append(form);

  // ── Llista ──
  if (entries.length) {
    root.append(h("section.card", { "aria-labelledby": "h-list" },
      h("h2", { id: "h-list" }, "Mesures"),
      h("ul.list", ...entries.slice().reverse().slice(0, 30).map(e => h("li.li",
        h("div", h("b", short(e.date)), h("p.small.muted", [e.weight && fmt(e.weight) + " kg", e.waist && "cintura " + fmt(e.waist), e.neck && "coll " + fmt(e.neck), e.hip && "maluc " + fmt(e.hip), e.scaleFat && "bàscula " + fmt(e.scaleFat) + " %"].filter(Boolean).join(" · "))),
        h("button.btn.quiet.small", { type: "button", "aria-label": `Esborra la mesura del ${short(e.date)}`, onclick: async () => {
          if (!win.confirm(`Vols esborrar la mesura del ${short(e.date)}?`)) return;
          await deleteEntry(db, e.id); sync(); await again();
        } }, "Esborra"))))));
  }
}
