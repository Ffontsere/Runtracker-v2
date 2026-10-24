// RunTracker v2 — arrencada i navegació entre pantalles (#/avui, #/activitats, … #/perfil).

import { openDB } from "./data/db.js";
import { DEFAULT_SETTINGS, parseStravaReturn } from "./data/config.js";
import { renderProfile } from "./ui/profile.js";
import { renderToday } from "./ui/today.js";
import { renderStrength } from "./ui/strength.js";
import { h, fmtInt } from "./ui/dom.js";

export const ROUTES = {
  avui: { title: "Avui", note: "Estat de forma, càrrega i què toca avui." },
  activitats: { title: "Sortides", note: "Llista de sortides i el detall de cadascuna." },
  progres: { title: "Progrés", note: "Marques, prediccions, VO₂max i informe de bloc." },
  forca: { title: "Força", note: "Sessions a casa amb escales d'exercicis i isomètrics." },
  cos: { title: "Cos", note: "Pes, cintura i proteïna." },
  clima: { title: "Clima", note: "Les millors hores per córrer avui i demà." },
  perfil: { title: "Perfil" },
};

function placeholder(root, route, count) {
  const r = ROUTES[route];
  root.replaceChildren(
    h("div.stack", h("p.eyebrow", "RunTracker v2"), h("h1", r.title)),
    h("section.card.empty",
      h("h2", "Pantalla en construcció"),
      h("p", r.note),
      count ? h("p.small", `Les ${fmtInt(count)} sortides ja són al mòbil i el motor de càlculs està provat.`) :
        h("p.small", h("a", { href: "#/perfil" }, "Comença pel Perfil"), " per connectar Strava i portar les dades de la v1.")));
}

/**
 * Arrenca l'app. Els paràmetres permeten provar-la amb una base de dades i un fetch de mentida.
 */
export async function start({ win = window, db = null, fetchImpl, now, sleep, geo } = {}) {
  const root = win.document.getElementById("view");
  try {
    db = db || await openDB(win.indexedDB);
  } catch (e) {
    root.replaceChildren(h("section.card", h("h2", "No es poden guardar dades"), h("p.msg.bad", e.message)));
    throw e;
  }
  if (!(await db.getKV("settings"))) await db.setKV("settings", { ...DEFAULT_SETTINGS });

  // Retorn del Worker després de connectar Strava: #strava=ok → Perfil amb l'avís.
  let notice = parseStravaReturn(win.location.hash);
  if (notice) win.history.replaceState(null, "", win.location.pathname + win.location.search + "#/perfil");

  let current = null;
  async function show() {
    const route = (win.location.hash.match(/^#\/(\w+)/) || [])[1];
    const name = ROUTES[route] ? route : "avui";
    current = name;
    for (const a of win.document.querySelectorAll("[data-route]")) {
      if (a.dataset.route === name) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    }
    win.document.title = "RunTracker · " + ROUTES[name].title;
    if (name === "perfil") {
      const n = notice; notice = null;
      return renderProfile(root, { db, fetchImpl, now, win, sleep, notice: n });
    }
    if (name === "avui") return renderToday(root, { db, fetchImpl, now, geo });
    if (name === "forca") return renderStrength(root, { db, now });
    placeholder(root, name, await db.count("activities"));
  }
  win.addEventListener("hashchange", () => { show().catch(e => console.error(e)); });
  const first = show();
  return { db, ready: first, route: () => current };
}

if (typeof window !== "undefined" && !window.__RT_TEST__) {
  start().catch(e => console.error(e));
}
