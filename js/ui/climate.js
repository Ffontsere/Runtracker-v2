// RunTracker v2 — pestanya Clima: millor finestra de cada dia, hora a hora i el temps de cada sortida.

import { h, say, fmtInt } from "./dom.js";
import { forecastDays, dayBest, dayHours, typeName, missingWx } from "../engine/climate.js";
import { wxTypicalPace } from "../engine/weather.js";
import { runTypeFor } from "../engine/schedule.js";
import { getForecast, setLocation, askPosition, fillActivityWx } from "../data/weather.js";
import { getSettings } from "../data/config.js";

const TYPES = [["auto", "Hàbits"], ["easy", "Fàcil"], ["tempo", "Tempo"], ["quality", "Sèries"], ["long", "Llarga"]];
const DOW = ["dg.", "dl.", "dt.", "dc.", "dj.", "dv.", "ds."];
const DOWFULL = ["Diumenge", "Dilluns", "Dimarts", "Dimecres", "Dijous", "Divendres", "Dissabte"];
const hh = n => String(n).padStart(2, "0") + ":00";
const TONE = { ok: "ok", good: "ok", warn: "warn", hard: "warn", bad: "bad" };

/**
 * @param {HTMLElement} root
 * @param {{db, now?:()=>number, fetchImpl?, geo?, type?:string, day?:number, sleep?}} app  `type` i `day` es mantenen
 */
export async function renderClimate(root, app) {
  const { db } = app;
  const now = (app.now || Date.now)();
  const fetchImpl = app.fetchImpl || ((...a) => fetch(...a));
  const acts = await db.getAll("activities");
  const settings = await getSettings(db);
  const head = h("div.stack", h("p.eyebrow", "Previsió d'Open-Meteo"), h("h1", "Clima"));
  const msg = h("div.msg");
  root.replaceChildren(head, msg);

  async function locate(btn) {
    btn.disabled = true; say(msg, "Buscant la ubicació…");
    try { const p = await askPosition(app.geo); await setLocation(db, p.lat, p.lng); say(msg, ""); await paint(true); }
    catch (e) { say(msg, e.message, "bad"); btn.disabled = false; }
  }

  async function paint(force = false) {
    let fc;
    try { fc = await getForecast(db, { fetchImpl, now, force }); }
    catch (e) {
      say(msg, e.message, "bad");
      root.replaceChildren(head, msg, h("div.row", h("button.btn", { type: "button", onclick: () => paint(true) }, "Torna-ho a provar")), await actsWxCard());
      return;
    }
    if (!fc) {
      const b = h("button.btn.primary", { type: "button", onclick: () => locate(b) }, "Fes servir la ubicació del mòbil");
      root.replaceChildren(head, msg, h("section.card", h("h2", "On corres?"),
        h("p", "Per puntuar les hores cal la previsió del teu lloc. La ubicació es desa al mòbil i només s'envia a Open-Meteo."), h("div.row", b)), await actsWxCard());
      return;
    }
    const s = await getSettings(db);
    const hours = fc.hours, days = forecastDays(hours);
    const pace = wxTypicalPace({ acts, now });
    const mode = app.type || "auto";
    const typeFor = key => mode === "auto" ? runTypeFor(acts, now, Date.parse(key + "T12:00:00")) : mode;
    const sel = Math.min(app.day || 0, days.length - 1);

    const upd = new Date(fc.ts);
    const refresh = h("button.btn.small", { type: "button", onclick: () => paint(true) }, "Actualitza");
    const move = h("button.btn.small", { type: "button", onclick: () => locate(move) }, "Canvia la ubicació");
    const top = h("section.card", { "aria-labelledby": "h-wx-top" },
      h("div.card-head", h("h2", { id: "h-wx-top" }, "Per a quin tipus de sortida?")),
      h("div.seg.wide", { role: "group", "aria-label": "Tipus de sortida" },
        ...TYPES.map(([t, l]) => h("button", { type: "button", "aria-pressed": String(t === mode), onclick: () => { app.type = t; paint(); } }, l))),
      h("p.small.muted", mode === "auto" ? "Segons els teus hàbits: el teu dia habitual de llarga es puntua com a llarga; la resta, com a rodatge fàcil." : `Tots els dies es puntuen per a: ${typeName(mode).toLowerCase()}.`),
      h("p.small.muted", `${s.wxPlace ? s.wxPlace + " · " : ""}${fc.lat.toFixed(2)}, ${fc.lng.toFixed(2)} · actualitzada a les ${String(upd.getHours()).padStart(2, "0")}:${String(upd.getMinutes()).padStart(2, "0")}`),
      h("div.row", refresh, move));

    // Millor finestra de cada dia
    const list = h("ul.list.days");
    days.forEach((d, di) => {
      const t = typeFor(d.key);
      const b = dayBest(hours, d, t, now);
      const date = new Date(d.key + "T12:00:00");
      list.append(h("li", h("button.day", { type: "button", "aria-pressed": String(di === sel), onclick: () => { app.day = di; paint(); } },
        h("span.day-d", h("b", DOW[date.getDay()]), h("span.small.muted", `${date.getDate()}/${date.getMonth() + 1}`)),
        b ? h("span.day-w", h("b", `${hh(b.hour)}${b.span > 1 ? "–" + hh(b.end) : ""}`), h("span.small.muted", typeName(t) + (b.why.length ? " · " + b.why.join(", ") : "")))
          : h("span.day-w.small.muted", "Ja no queden hores"),
        b ? h("span", { class: "day-s " + TONE[b.cat.tone] }, h("b", String(b.score)), h("span", b.cat.l)) : null)));
    });
    const best = h("section.card", { "aria-labelledby": "h-wx-days" },
      h("h2", { id: "h-wx-days" }, "La millor hora de cada dia"),
      h("p.small.muted", "Entre les 5 i les 22 h, puntuant tota la durada de la sortida (0–100)."), list);

    // Hora a hora
    const d = days[sel];
    const t = typeFor(d.key);
    const rows = dayHours(hours, d, t, now, pace);
    const hourly = h("section.card", { "aria-labelledby": "h-wx-hours" },
      h("h2", { id: "h-wx-hours" }, `${DOWFULL[new Date(d.key + "T12:00:00").getDay()]} hora a hora`),
      h("p.small.muted", `Puntuat per a: ${typeName(t).toLowerCase()}${mode === "auto" ? " (hàbits)" : ""}.` + (pace ? " El cost de la calor es tradueix al teu ritme fàcil habitual." : "")),
      h("ul.list.hours", ...rows.map(r => h("li", { class: r.past ? "past" : "" },
        h("div.hour-row",
          h("span.hour-h", hh(r.hour)),
          h("span.hour-t", `${Math.round(r.temp)}°`),
          h("span.hour-sky.small.muted", r.sky),
          h("span", { class: "hour-bar " + TONE[r.cat.tone], role: "img", "aria-label": `Puntuació ${r.score}, ${r.cat.l}` }, h("i", { style: `width:${Math.max(4, r.score)}%` })),
          h("b.hour-s", String(r.score))),
        h("p.small.muted.hour-x", r.bits.join(" · "))))));

    const how = h("section.card", h("details", h("summary", "Com es calcula"),
      h("div.stack.small",
        h("p", "La puntuació parteix de 100 i resta el cost de cada factor, segons el tipus de sortida:"),
        h("ul.bullets",
          h("li", h("b", "Calor i humitat: "), "suma de temperatura i punt de rosada, el mateix model que corregeix els teus ritmes. És el que més pesa, sobretot a les llargues i a les sèries."),
          h("li", h("b", "Sol: "), "només penalitza amb calor (a partir de 12 °C)."),
          h("li", h("b", "Vent: "), "a partir de 22 km/h, i més a les sèries. Amb calor, una mica de vent ajuda."),
          h("li", h("b", "Pluja: "), "segons la intensitat i la probabilitat."),
          h("li", h("b", "Fred: "), "per sota de 3 °C, i més amb vent.")),
        h("p.muted", "Excel·lent ≥ 85 · Bo ≥ 70 · Acceptable ≥ 55 · Exigent ≥ 40 · Evita-ho per sota."))));

    root.replaceChildren(head, msg, top, best, hourly, await actsWxCard(), how);
  }

  // El temps de cada sortida (corregeix el VO₂)
  async function actsWxCard() {
    const cache = (await db.getKV("tempCache")) || {};
    const all = await db.getAll("activities");
    const missing = missingWx(all, cache, now);
    const withWx = all.filter(a => cache[a.id]).length;
    const box = h("div.msg");
    const prog = h("div.progress", { hidden: true }, h("i"));
    const btn = h("button.btn", { type: "button", disabled: !missing.length }, missing.length ? `Busca'l (${fmtInt(Math.min(40, missing.length))})` : "Al dia");
    btn.onclick = async () => {
      btn.disabled = true; prog.hidden = false;
      try {
        const r = await fillActivityWx(db, { fetchImpl, now, ...(app.sleep ? { sleep: app.sleep } : {}), onProgress: (n, tot) => { prog.firstChild.style.width = Math.round(n / tot * 100) + "%"; } });
        say(box, `${r.done} sortides amb el temps del dia i el VO₂ recalculat.` + (r.empty ? ` ${r.empty} sense dades a Open-Meteo.` : "") + (r.failed ? ` ${r.failed} han fallat (es tornaran a provar).` : "") + (r.remaining ? ` En queden ${fmtInt(r.remaining)}: torna a prémer.` : ""), r.failed ? "warn" : "ok");
        btn.textContent = r.remaining ? `Busca'l (${fmtInt(Math.min(40, r.remaining))})` : "Al dia"; btn.disabled = !r.remaining;
      } catch (e) { say(box, e.message, "bad"); btn.disabled = false; }
      finally { prog.hidden = true; }
    };
    return h("section.card", { "aria-labelledby": "h-wx-acts" },
      h("h2", { id: "h-wx-acts" }, "El temps de cada sortida"),
      h("p.small.muted", "La temperatura, la humitat i l'altitud de l'hora en què vas sortir corregeixen el VO₂max. Les sortides noves el busquen soles en sincronitzar."),
      h("p.small", `${fmtInt(withWx)} sortides amb dades · ${fmtInt(missing.length)} de l'últim any sense.`),
      prog, box, h("div.row", btn));
  }

  await paint();
}
