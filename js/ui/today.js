// RunTracker v2 — pantalla Avui: estat del dia, setmana, millor hora per córrer i proteïna.

import { h, say, fmtInt, fmtPace } from "./dom.js";
import { todaySummary, bestWindow } from "../engine/today.js";
import { proteinTarget, bodySummary } from "../engine/body.js";
import { loadBody, sexOf } from "../data/body.js";
import { dateStr } from "../engine/dates.js";
import { getForecast, setLocation, askPosition } from "../data/weather.js";
import { getSettings } from "../data/config.js";
import { loadStrength } from "../data/strength.js";
import { nextSession, strengthDaily, strengthContext, runTypeFor } from "../engine/schedule.js";
import { WXW } from "../engine/weather.js";
import { SESSIONS, fatigueState } from "../engine/strength.js";

const TONE = { fresc: "ok", assimilant: "ok", carregat: "warn", sobrecarregat: "bad" };
const dec = (n, d = 1) => n == null ? "—" : n.toLocaleString("ca-ES", { minimumFractionDigits: d, maximumFractionDigits: d });
const sign = n => n == null ? "" : (n > 0 ? "+" : n < 0 ? "−" : "") + dec(Math.abs(n));
export { fmtPace } from "./dom.js";
const hh = h0 => String(h0).padStart(2, "0") + ":00";

function lastRunText(l) {
  const when = l.daysAgo === 0 ? "Avui" : l.daysAgo === 1 ? "Ahir" : `Fa ${l.daysAgo} dies`;
  return `${when}: ${dec(l.distance)} km a ${fmtPace(l.pace)}/km` + (l.avgHR ? `, ${l.avgHR} ppm` : "");
}

/**
 * @param {HTMLElement} root
 * @param {{db, fetchImpl?, now?:()=>number, geo?}} app
 */
export async function renderToday(root, app) {
  const { db } = app;
  const now = (app.now || Date.now)();
  const fetchImpl = app.fetchImpl || ((...a) => fetch(...a));
  const dateLabel = new Date(now).toLocaleDateString("ca-ES", { weekday: "long", day: "numeric", month: "long" });
  root.replaceChildren(h("div.stack", h("p.eyebrow", dateLabel), h("h1", "Avui")));

  const acts = await db.getAll("activities");
  const settings = await getSettings(db);
  if (!acts.length) {
    root.append(h("section.card.empty", h("h2", "Encara no hi ha sortides"),
      h("p", "Connecta Strava o importa les dades de la v1 per veure com estàs avui."),
      h("p", h("a.btn.primary", { href: "#/perfil" }, "Ves al Perfil"))));
    return;
  }

  const { sessions } = await loadStrength(db);
  const s = todaySummary({ acts, settings, now, extraDaily: strengthDaily(sessions) });

  // ── Estat del dia ──
  if (s.status) {
    const st = s.status;
    const advice = st.phrase.split(" — ")[1] || "";
    root.append(h("section.card.verdict", { "aria-labelledby": "h-state", dataset: { tone: TONE[st.key] || "" } },
      h("div.card-head", h("p.eyebrow", { id: "h-state" }, "Estat"),
        s.recovery && s.recovery.remaining > 0 ? h("span.status.warn", `Recuperant ${s.recovery.remaining} h`) : h("span.status.ok", "Recuperat")),
      h("p.verdict-label", st.label),
      h("p", advice.charAt(0).toUpperCase() + advice.slice(1)),
      h("div.stats",
        h("div.stat", h("b", sign(s.tsb) || "0"), h("span", "Forma (TSB)")),
        h("div.stat", h("b", st.acwr == null ? "—" : dec(st.acwr, 2)), h("span", "ACWR")),
        h("div.stat", h("b", dec(s.ctl)), h("span", "Fitness (CTL)"))),
      s.ctlDelta28 == null ? null : h("p.small.muted", `El fitness ${s.ctlDelta28 > 0 ? "puja" : s.ctlDelta28 < 0 ? "baixa" : "es manté"}: ${sign(s.ctlDelta28) || "0"} en les últimes 4 setmanes.`)));
  }

  // ── Sessió fàcil ──
  if (s.easy) {
    const e = s.easy;
    const rest = e.hi <= 0;
    const range = e.lo >= e.hi ? fmtInt(e.hi) : `${fmtInt(e.lo)}–${fmtInt(e.hi)}`;
    root.append(h("section.card", { "aria-labelledby": "h-easy" },
      h("div.card-head", h("h2", { id: "h-easy" }, "Sessió fàcil d'avui"), h("span.small.muted", "TRIMP recomanat")),
      rest ? h("p.big", h("b", "Millor descansar"))
        : h("p.big", h("b", range), e.minHi ? h("span.muted", ` · uns ${e.minLo === e.minHi ? e.minHi : e.minLo + "–" + e.minHi} min a Z2`) : null),
      h("p.small.muted",
        (e.doneToday ? `Avui ja portes ${fmtInt(e.doneToday)} de TRIMP. ` : "") +
        (rest ? "Amb la càrrega d'aquests dies, una sessió més deixaria l'ACWR per sobre d'1,3. "
          : e.capped ? "El límit és l'ACWR: passar-te'n el deixaria per sobre d'1,3. " : "") +
        (e.z2hi && !rest ? `Per sota de ${e.z2hi} ppm. ` : "") +
        `Surt d'una sessió teva mitjana (${fmtInt(e.session)}) segons com estàs avui.`)));
  }

  // ── Força ──
  const ns = nextSession(sessions, settings, now);
  if (ns.due || ns.doneToday) {
    const sc = strengthContext({ acts, now, sessions });
    const fat = fatigueState(sc);
    root.append(h("section.card", { "aria-labelledby": "h-str" },
      h("div.today-strength",
        h("div", h("p.eyebrow", { id: "h-str" }, "Força"),
          h("h2", ns.doneToday ? `Sessió ${ns.doneToday.type} feta` : `Toca la sessió ${ns.type}`),
          h("p.small.muted", ns.doneToday ? `${ns.doneToday.minutes} min · càrrega ${ns.doneToday.load}` :
            SESSIONS[ns.type].name + (fat.high ? " · versió suau per la fatiga" : "") + (sc.dayBeforeLong && ns.type === "A" ? " · demà és la llarga" : ""))),
        ns.doneToday ? h("span.status.ok", "Fet") : h("a.btn.primary", { href: "#/forca" }, "Comença"))));
  }

  // ── Setmana ──
  const w = s.week;
  root.append(h("section.card", { "aria-labelledby": "h-week" },
    h("div.card-head", h("h2", { id: "h-week" }, "Aquesta setmana"),
      h("span.small.muted", `${w.runs} ${w.runs === 1 ? "sortida" : "sortides"}`)),
    h("p.big", h("b", dec(w.km)), w.target ? h("span.muted", ` de ${fmtInt(w.target)} km`) : " km"),
    w.target ? h("div.progress", { role: "progressbar", "aria-valuenow": Math.min(100, w.pct), "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": "Quilòmetres de la setmana" },
      h("i", { style: `width:${Math.min(100, w.pct)}%` })) : null,
    s.last ? h("p.small.muted", lastRunText(s.last)) : null));

  // ── Millor hora ──
  const wxBox = h("div.stack");
  const wxMsg = h("div.msg");
  root.append(h("section.card", { "aria-labelledby": "h-wx" },
    h("div.card-head", h("h2", { id: "h-wx" }, "Quan córrer"), h("a.small", { href: "#/clima" }, "Clima")),
    wxBox, wxMsg));

  // ── Proteïna ──
  // Pes: la mitjana de 7 dies del Cos; si no n'hi ha, el del Perfil.
  const bodyW = bodySummary(await loadBody(db), { height: settings.height, sex: sexOf(settings.sex) }, dateStr(new Date(now))).weight;
  const wUsed = bodyW || settings.weight;
  const p = proteinTarget(wUsed);
  root.append(h("section.card", { "aria-labelledby": "h-prot" },
    h("div.card-head", h("h2", { id: "h-prot" }, "Proteïna d'avui")),
    p ? [h("p.big", h("b", `${p.g} g`), h("span.muted", ` (${p.lo}–${p.hi} g)`)),
      h("p.small.muted", `1,6 g per kg amb ${dec(wUsed)} kg` + (bodyW ? " (mitjana de 7 dies del Cos)." : ". Registra el pes al Cos perquè segueixi la teva tendència."))]
      : h("p.small", "Registra el pes al ", h("a", { href: "#/cos" }, "Cos"), " per calcular-la.")));

  async function paintWx(force = false) {
    let fc;
    try { fc = await getForecast(db, { fetchImpl, now, force }); }
    catch (e) {
      wxBox.replaceChildren(h("button.btn", { type: "button", onclick: () => paintWx(true) }, "Torna-ho a provar"));
      return say(wxMsg, e.message, "bad");
    }
    say(wxMsg, "");
    if (!fc) {
      const b = h("button.btn.primary", { type: "button" }, "Fes servir la ubicació del mòbil");
      b.onclick = async () => {
        b.disabled = true; say(wxMsg, "Buscant la ubicació…");
        try { const pos = await askPosition(app.geo); await setLocation(db, pos.lat, pos.lng); await paintWx(true); }
        catch (e) { say(wxMsg, e.message, "bad"); b.disabled = false; }
      };
      wxBox.replaceChildren(h("p.small", "Per dir-te la millor hora cal saber on corres. La ubicació només s'envia a Open-Meteo per baixar la previsió."), h("div.row", b));
      return;
    }
    // Tipus de sortida: el que has triat avui, o el dels teus hàbits (la llarga el seu dia, la resta fàcil).
    const today = dateStr(new Date(now));
    const saved = await db.getKV("wxType");
    const manual = saved && saved.date === today ? saved.type : null;
    let type = manual || runTypeFor(acts, now, now);
    let b = bestWindow(fc.hours, now, type);
    if (b && b.day === "demà" && !manual) { const t2 = runTypeFor(acts, now, now + 864e5); if (t2 !== type) { type = t2; b = bestWindow(fc.hours, now, type); } }
    const picker = h("div.seg.wide", { role: "group", "aria-label": "Tipus de sortida" },
      ...[["easy", "Fàcil"], ["tempo", "Tempo"], ["quality", "Sèries"], ["long", "Llarga"]].map(([t, l]) =>
        h("button", { type: "button", "aria-pressed": String(t === type), onclick: async () => {
          await db.setKV("wxType", { date: today, type: t }); await paintWx();
        } }, l)));
    if (!b) { wxBox.replaceChildren(picker, h("p.small.muted", "La previsió no cobreix les pròximes hores.")); return; }
    const why = b.why.length ? `, amb ${b.why.join(" i ")}` : "";
    const w = WXW[type];
    const origin = manual ? "triat per tu" : type === "long" ? "és el teu dia habitual de llarga" : "per defecte";
    wxBox.replaceChildren(picker,
      h("div.best", { dataset: { tone: b.cat.tone } },
        h("div", h("p.eyebrow", b.day === "avui" ? "Millor hora avui" : "Avui ja no; demà"),
          h("p.best-time", hh(b.hour))),
        h("div.best-score", h("b", String(b.score)), h("span", b.cat.l))),
      h("p.small", `${dec(b.temp, 0)} °C per a ${w.n.toLowerCase()} de ${w.dur} min (${origin})${why}.` +
        (b.now && b.day === "avui" && b.hour !== new Date(now).getHours() ? ` Ara mateix: ${b.now.score} (${b.now.cat.l.toLowerCase()}), ${dec(b.now.temp, 0)} °C.` : "")));
  }
  await paintWx();
}
