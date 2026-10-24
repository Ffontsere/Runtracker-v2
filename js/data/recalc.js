// RunTracker v2 — recàlcul de totes les sortides quan canvies la FC màxima o la de repòs.
// Fa servir el mateix camí que la migració (TRIMP, zones estables, mètriques dels streams, VO₂),
// així una sortida té els mateixos números tant si ve de la v1 com si s'ha recalculat aquí.

import { migrate } from "./migrate.js";

/**
 * Recalcula i desa, tot o res. Conserva tots els camps de configuració que la migració no coneix.
 * @returns {Promise<{count:number, bounds:number[]}>}
 */
export async function recalcAll(db, { hrMax, hrRest, now = Date.now() }) {
  const settings = (await db.getKV("settings")) || {};
  const acts = await db.getAll("activities");
  const streamsArr = await db.getAll("streams");
  const streams = {};
  for (const s of streamsArr) { const { id, ...rest } = s; streams[String(id).replace("strava-", "")] = rest; }
  const temps = (await db.getKV("tempCache")) || {};
  const r = migrate({ source: "recàlcul", acts, settings, temps, streams, errors: [] }, { hrMax, hrRest, now });
  // migrate() esborra _svErr: es recupera perquè no es tornin a demanar streams que Strava ja ha negat.
  const errs = new Map(acts.filter(a => a._svErr).map(a => [a.id, a._svErr]));
  for (const a of r.acts) if (errs.has(a.id) && a.sv == null) a._svErr = errs.get(a.id);
  await db.putAtomic({
    activities: r.acts,
    kv: [{ key: "settings", value: { ...settings, hrMax, hrRest }, updatedAt: now }],
  });
  // Les sortides sense streams a la cache perden les mètriques que en depenen i tornen a la cua d'anàlisi.
  return { count: r.acts.length, bounds: r.report.bounds, pendingStreams: r.report.pendingStreams };
}
