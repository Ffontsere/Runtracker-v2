// RunTracker v2 — mètriques que surten dels streams d'una activitat (v1: applyStreamDerived).
// Només es guarden les que fan servir les pantalles de la v2: millors esforços, temps per zona,
// TRIMP exacte, deriva a les llargues i VO₂max per finestres.

import { trimpFromStream, trimpFromTiZ } from "./load.js";
import { computeTiZ, calcCardiacDrift, vo2FromStream } from "./physio.js";
import { computeBestEfforts } from "./performance.js";

/** Versió de l'algoritme. Una activitat amb `sv` diferent es torna a calcular quan hi ha streams. */
export const SV = 2;

/**
 * Camps nous d'una activitat a partir dels seus streams. No modifica l'activitat.
 * @param {object} a activitat
 * @param {object} streams streams de Strava (key_by_type)
 * @param {{hrMax:number, hrRest:number}} settings
 * @param {number[]} bounds límits de zona actius
 */
export function deriveFromStreams(a, streams, settings, bounds) {
  const out = { sv: SV };
  const be = computeBestEfforts(streams); if (be) out.be = be;
  const tiz = computeTiZ(streams, bounds); if (tiz) out.tiz = tiz;
  const tst = trimpFromStream(streams, settings);
  if (tst) out.trimp = tst; else if (tiz) { const t = trimpFromTiZ(tiz); if (t) out.trimp = t; }
  const drift = calcCardiacDrift(streams);
  if (drift && typeof drift.decoupling === "number" && a.duration >= 4200) out.dec = drift.decoupling;
  const vs = vo2FromStream(streams, settings);
  if (vs) { out.vo2s = vs.vo2; out.vo2n = vs.n; }
  return out;
}
