// RunTracker v2 — pantalla de Força: sessió del dia, registre de sèries, cronòmetre, nivells i historial.

import { h, say } from "./dom.js";
import { LADDERS, PATTERNS, planSession, rangeLabel, strengthLoad } from "../engine/strength.js";
import { strengthContext, nextSession, DOW_NAMES } from "../engine/schedule.js";
import { dateStr } from "../engine/dates.js";
import { loadStrength, saveDraft, draftFor, finishSession, setLevel } from "../data/strength.js";
import { getSettings } from "../data/config.js";
import { syncSoon } from "../data/sync.js";

const dec = (n, d = 2) => n == null ? "—" : n.toLocaleString("ca-ES", { minimumFractionDigits: d, maximumFractionDigits: d });
const shortDate = ds => { const [, m, d] = ds.split("-"); return `${+d}/${+m}`; };
const UNIT = { s: "s", contactes: "contactes", reps: "reps" };

// ── Cronòmetre de les aguantades (un de sol a la vegada) ──
let timer = null, audio = null, wakeLock = null;
function beep() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    audio = audio || new AC();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(audio.destination);
    o.start(); o.stop(audio.currentTime + 0.25);
  } catch { /* sense so, el cronòmetre funciona igual */ }
}
function stopTimer() {
  if (!timer) return null;
  clearInterval(timer.iv);
  const t = timer; timer = null;
  try { wakeLock && wakeLock.release(); } catch { /* ja alliberat */ }
  wakeLock = null;
  return t;
}

/**
 * @param {HTMLElement} root
 * @param {{db, now?:()=>number, chosen?:'A'|'B'}} app
 */
export async function renderStrength(root, app) {
  const { db } = app;
  const now = (app.now || Date.now)();
  const today = dateStr(new Date(now));
  stopTimer();

  const settings = await getSettings(db);
  const acts = await db.getAll("activities");
  let { state, sessions, draft } = await loadStrength(db);
  const ctx = strengthContext({ acts, now, sessions });
  let next = nextSession(sessions, settings, now);
  let type = app.chosen || next.type;
  let lastSaved = null;

  let saveT = null;
  const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => saveDraft(db, draft).catch(e => say(finishMsg, "No s'ha pogut desar l'esborrany: " + e.message, "bad")), 250); };

  const finishMsg = h("div.msg");
  const minIn = h("input.input", { id: "f-min", type: "number", inputmode: "numeric", min: 5, max: 240 });
  const rpeIn = h("input.input", { id: "f-rpe", type: "number", inputmode: "numeric", min: 0, max: 10 });
  const loadOut = h("b");

  function paint() {
    const plan = planSession(type, state, ctx);
    const head = h("div.stack",
      h("p.eyebrow", `${DOW_NAMES[new Date(now).getDay()]} ${shortDate(today)}`),
      h("div.sess-row",
        h("h1", "Força"),
        h("div.seg", { role: "group", "aria-label": "Sessió" },
          ...["A", "B"].map(t => h("button", { type: "button", "aria-pressed": String(t === type), onclick: () => { type = t; app.chosen = t; stopTimer(); paint(); } }, t)))));

    const notes = [];
    if (next.doneToday && !app.chosen) notes.push(["info", `Avui ja has fet la sessió ${next.doneToday.type}. Aquesta és la següent, per a un altre dia.`]);
    plan.notes.forEach(n => notes.push(["warn", n]));

    const kids = [head];
    if (lastSaved) kids.push(savedSummary(lastSaved));
    kids.push(h("section.stack",
      h("h2", `Sessió ${type} · ${plan.name}`),
      h("div.row",
        h("span", { class: "status " + (plan.fatigued ? "warn" : "ok") }, plan.fatigued ? "Fatiga alta" : "Fatiga normal"),
        h("span.small.muted", [ctx.tsb != null ? `TSB ${ctx.tsb}` : null, ctx.acwr != null ? `ACWR ${dec(ctx.acwr)}` : null].filter(Boolean).join(" · "))),
      ...notes.map(([k, n]) => h("p", { class: "msg " + (k === "warn" ? "warn" : "") }, n))));
    for (const ex of plan.exercises) kids.push(exerciseCard(ex, plan));
    kids.push(finishCard(plan), levelsCard(), historyCard());
    root.replaceChildren(...kids);
  }

  function exerciseCard(ex) {
    const card = h("article.card.ex", { dataset: { pattern: ex.pattern } });
    const fill = () => {
      const d = draftFor(draft, type, ex);
      const lad = LADDERS[ex.pattern];
      const unit = UNIT[ex.unit] || "reps";
      const parts = [
        h("div.ex-head",
          h("div", h("p.eyebrow", `${ex.patternName} · ${ex.muscles}`), h("p.ex-name", ex.name),
            h("div.ladder", { "aria-hidden": "true" }, ...lad.levels.map((_, i) => h("i", { class: i < ex.level ? "done" : i === ex.level ? "now" : "" })))),
          h("span.lvl", `Nivell ${ex.level + 1} de ${ex.levels}`)),
        h("details", h("summary", "Com es fa"), h("p.small", ex.cue)),
        h("p.small.muted", `${ex.sets} sèries · rang `, h("b", rangeLabel(ex)),
          ex.rirTarget != null ? [" · deixa'n ", h("b", ex.rirTarget === 3 ? "3" : "1 o 2"), " de marge"] : " · sense fracàs, tècnica neta"),
      ];
      if (ex.plyo) {
        parts.push(h("div.row", h("span.small.muted", "Com ha anat?"),
          h("div.seg", { role: "group", "aria-label": "Qualitat" },
            ...[["ok", "Neta"], ["pain", "Molèstia"]].map(([q, l]) => h("button", { type: "button", "aria-pressed": String(d.quality === q),
              onclick: () => { d.quality = d.quality === q ? null : q; persist(); fill(); } }, l)))));
      } else {
        const step = ex.unit === "s" ? 5 : 1, max = ex.unit === "s" ? 300 : 60;
        parts.push(h("div.sets", ...d.reps.map((r, i) => {
          const running = timer && timer.pattern === ex.pattern && timer.i === i;
          const out = h("output", { id: `o-${ex.pattern}-${i}` }, String(running ? timer.shown : r));
          return h("div", { class: "set" + (r >= ex.hi ? " hit" : "") },
            h("span.lab", `Sèrie ${i + 1}${ex.unit === "s" ? " · s" : ""}`),
            h("div.step",
              h("button", { type: "button", "aria-label": `Menys a la sèrie ${i + 1}`, onclick: () => { d.reps[i] = Math.max(0, d.reps[i] - step); persist(); fill(); } }, "−"),
              out,
              h("button", { type: "button", "aria-label": `Més a la sèrie ${i + 1}`, onclick: () => { d.reps[i] = Math.min(max, d.reps[i] + step); persist(); fill(); } }, "+")),
            ex.iso ? h("button", { type: "button", class: "timer" + (running ? " on" : ""), onclick: () => {
              if (running) { const t = stopTimer(); d.reps[i] = Math.min(300, t.shown); persist(); fill(); return; }
              const prev = stopTimer(); if (prev) { const pc = root.querySelector(`[data-pattern="${prev.pattern}"]`); pc && pc._fill && pc._fill(); }
              timer = { pattern: ex.pattern, i, target: ex.targets[i], t0: Date.now(), shown: 0, beeped: false };
              try { navigator.wakeLock && navigator.wakeLock.request("screen").then(l => { wakeLock = l; }).catch(() => {}); } catch { /* sense wake lock */ }
              beep();
              timer.iv = setInterval(() => {
                if (!timer) return;
                timer.shown = Math.floor((Date.now() - timer.t0) / 1000);
                const o = document.getElementById(`o-${timer.pattern}-${timer.i}`); if (o) o.textContent = timer.shown;
                if (!timer.beeped && timer.shown >= timer.target) { timer.beeped = true; beep(); }
              }, 250);
              fill();
            } }, running ? "Atura" : `Cronometra ${ex.targets[i]} s`) : null);
        })));
        parts.push(h("div.stack",
          h("span.small.muted", ex.iso ? "A l'última, quant més podies aguantar?" : "A l'última, quantes més en podies fer?"),
          h("div.seg.wide", { role: "group", "aria-label": "Marge a l'última sèrie" },
            ...[0, 1, 2, 3, 4].map(v => h("button", { type: "button", "aria-pressed": String(d.rir === v),
              onclick: () => { d.rir = d.rir === v ? null : v; persist(); fill(); } }, ex.iso ? ["Res", "5 s", "10 s", "15 s", "20 s+"][v] : v === 4 ? "4+" : String(v))))));
        parts.push(h("label.check", h("input", { type: "checkbox", checked: !!d.pain, onchange: e => { d.pain = e.target.checked; persist(); } }), " He notat molèstia"));
      }
      card.replaceChildren(...parts);
    };
    card._fill = fill;
    fill();
    return card;
  }

  function finishCard() {
    if (minIn.value === "") minIn.value = draft._min ?? 30;
    if (rpeIn.value === "") rpeIn.value = draft._rpe ?? 6;
    const upd = () => { draft._min = +minIn.value; draft._rpe = +rpeIn.value; loadOut.textContent = String(strengthLoad(+minIn.value, +rpeIn.value)); persist(); };
    minIn.oninput = rpeIn.oninput = upd;
    loadOut.textContent = String(strengthLoad(+minIn.value, +rpeIn.value));
    const btn = h("button.btn.primary", { type: "button" }, "Desa la sessió");
    btn.onclick = async () => {
      const t = stopTimer();
      if (t) { const ex = planSession(type, state, ctx).exercises.find(e => e.pattern === t.pattern); if (ex) draftFor(draft, type, ex).reps[t.i] = t.shown; }
      btn.disabled = true;
      try {
        const r = await finishSession(db, { type, state, ctx, draft, minutes: minIn.value, rpe: rpeIn.value, date: today, now: Date.now() });
        state = r.state; sessions = [r.session, ...sessions]; draft = {}; lastSaved = r.session; app.chosen = null;
        next = nextSession(sessions, settings, now); type = next.type;
        if (!app.noSync) syncSoon(db);
        minIn.value = ""; rpeIn.value = "";
        paint(); try { window.scrollTo(0, 0); } catch { /* sense scroll */ }
      } catch (e) { say(finishMsg, e.message, "bad"); btn.disabled = false; }
    };
    return h("section.card", { "aria-labelledby": "h-finish" },
      h("h2", { id: "h-finish" }, "Acabar la sessió"),
      h("div.grid2",
        h("div.field", h("label", { for: "f-min" }, "Durada"), h("div.unit", minIn, h("span", "min"))),
        h("div.field", h("label", { for: "f-rpe" }, "Esforç (0–10)"), rpeIn)),
      h("p.small.muted", "Càrrega estimada: ", loadOut, " (minuts × esforç × 0,5). Compta a la forma al costat del TRIMP de les curses."),
      finishMsg, h("div.row", btn));
  }

  function savedSummary(s) {
    const ups = s.results.filter(r => r.verdict.action === "up").length;
    return h("section.card", { "aria-labelledby": "h-saved", class: "saved" },
      h("div.card-head", h("h2", { id: "h-saved" }, "Sessió desada"), h("span.status.ok", `${s.minutes} min · càrrega ${s.load}`)),
      ups ? h("p.msg.ok", `Puges de nivell en ${ups} moviment${ups > 1 ? "s" : ""}.`) : null,
      h("ul.list", ...s.results.map(r => h("li", h("b", r.name), h("span.small.muted", " " + (r.reps ? r.reps.join(" · ") + (r.unit === "s" ? " s" : "") : r.quality === "ok" ? "neta" : "molèstia")),
        h("p", { class: "small verdict-" + r.verdict.action }, r.verdict.msg)))));
  }

  function levelsCard() {
    const msg = h("div.msg");
    return h("section.card", { "aria-labelledby": "h-levels" },
      h("details", { id: "levels" }, h("summary", { id: "h-levels" }, "Nivell de cada moviment"),
        h("div.stack",
          h("p.small.muted", "El primer dia, tria a cada moviment el nivell on et costin les últimes repeticions del rang. Després l'app el puja i el baixa sola."),
          ...PATTERNS.map(p => {
            const lad = LADDERS[p];
            const sel = h("select.input", { id: `lvl-${p}`, onchange: async e => {
              try { state = await setLevel(db, state, p, +e.target.value); if (!app.noSync) syncSoon(db); say(msg, `${lad.name}: nivell ${+e.target.value + 1}.`, "ok"); stopTimer(); paint(); root.querySelector("#levels").open = true; }
              catch (err) { say(msg, "No s'ha pogut desar: " + err.message, "bad"); }
            } }, ...lad.levels.map((l, i) => h("option", { value: String(i), selected: i === state[p].level }, `${i + 1}. ${l.n}`)));
            return h("div.field", h("label", { for: `lvl-${p}` }, `${lad.name} `, h("span.muted", `· ${lad.muscles}`)), sel);
          }), msg)));
  }

  function historyCard() {
    if (!sessions.length) return h("p.small.muted", `Dies de força: ${DOW_NAMES[(settings.strengthDays || {}).A ?? 1]} (A) i ${DOW_NAMES[(settings.strengthDays || {}).B ?? 4]} (B). Es canvien al Perfil.`);
    return h("section.card", { "aria-labelledby": "h-hist" },
      h("h2", { id: "h-hist" }, "Historial"),
      h("ul.list", ...sessions.slice(0, 12).map(s => h("li.li",
        h("div", h("b", `${shortDate(s.date)} · sessió ${s.type}`), h("p.small.muted", `${s.minutes} min · esforç ${s.rpe}${s.fatigued ? " · amb fatiga" : ""}`)),
        h("span.num", String(s.load))))));
  }

  paint();
}
