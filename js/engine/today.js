// RunTracker v2 — resum d'Avui. Funcions pures: reben { acts, settings, now } i retornen dades, sense pantalla.

import { dateStr, weekKey, daysAgo } from "./dates.js";
import { calcFF, ffNow, estRecovery, trainingStatus } from "./load.js";
import { wxWindowScore, wxCat } from "./weather.js";

/** Estat, forma, setmana, recuperació i última sortida. */
export function todaySummary(ctx) {
  const { acts, settings, now } = ctx;
  if (!acts.length) return null;
  const ff = calcFF(ctx);
  const fn = ffNow(ff);
  // Senyals del cos (FC en repòs, RPE) fora: decisió de l'inventari.
  const status = trainingStatus(ctx, { useBodySignals: false });
  const wk = weekKey(dateStr(new Date(now)));
  const week = acts.filter(a => a.date >= wk && a.date <= dateStr(new Date(now)));
  const km = Math.round(week.reduce((s, a) => s + (a.distance || 0), 0) * 10) / 10;
  const target = settings.weeklyTarget || null;
  const last = [...acts].sort((a, b) => (b.startTime || b.date).localeCompare(a.startTime || a.date))[0];
  // CTL de fa 28 dies, per dir si la forma puja o baixa.
  const past = ff.length > 29 ? ff[ff.length - 30] : null;
  return {
    status,
    ctl: fn ? fn.ctl : null, atl: fn ? fn.atl : null, tsb: fn ? fn.tsb : null,
    ctlDelta28: fn && past ? Math.round((fn.ctl - past.ctl) * 10) / 10 : null,
    week: { km, runs: week.length, target, pct: target ? Math.round(km / target * 100) : null },
    recovery: estRecovery(ctx),
    last: last ? { ...last, daysAgo: daysAgo(last.date, now) } : null,
  };
}

/**
 * Millor hora per començar una sortida entre les 05:00 i les 22:00, avui si encara en queda, si no, demà.
 * `hours` = previsió horària [{ t:'AAAA-MM-DDTHH:MM', temp, dp, rad, wind, gust, pprob, prec }].
 */
export function bestWindow(hours, now, type = "easy") {
  if (!hours || !hours.length) return null;
  const today = dateStr(new Date(now));
  const tomorrow = dateStr(new Date(now + 864e5));
  const earliest = now - 20 * 60000; // una hora que ha començat fa més de 20 min ja no val
  const pick = day => {
    let best = null;
    hours.forEach((x, i) => {
      if (x.t.slice(0, 10) !== day) return;
      const hr = +x.t.slice(11, 13);
      if (hr < 5 || hr > 22) return;
      if (new Date(x.t).getTime() < earliest) return;
      const r = wxWindowScore(hours, i, type);
      if (r && (!best || r.score > best.score)) best = { i, hour: hr, t: x.t, temp: x.temp, ...r };
    });
    return best;
  };
  const b = pick(today);
  const out = b ? { ...b, day: "avui" } : (() => { const t = pick(tomorrow); return t ? { ...t, day: "demà" } : null; })();
  if (!out) return null;
  // Ara mateix, per comparar.
  const ni = hours.findIndex(x => x.t.slice(0, 13) === dateStr(new Date(now)) + "T" + String(new Date(now).getHours()).padStart(2, "0"));
  const nowScore = ni >= 0 ? wxWindowScore(hours, ni, type) : null;
  return { ...out, cat: wxCat(out.score), now: nowScore ? { score: nowScore.score, temp: hours[ni].temp, cat: wxCat(nowScore.score) } : null };
}
