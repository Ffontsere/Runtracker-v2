// Correccions respecte a la v1 (BUGS-v1.md #4, #6 i #8), cadascuna amb el seu test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { daysAgo, dateStr } from "../js/engine/dates.js";
import * as L from "../js/engine/load.js";

const at = s => new Date(s).getTime();

test("#8 els dies es compten en hora local, també entre les 00:00 i les 02:00", () => {
  // 10/11/2026 00:30 a Barcelona (hivern, UTC+1) = 9/11 23:30 UTC: la v1 donava -1 per a una sortida d'avui.
  const now = at("2026-11-10T00:30:00");
  assert.equal(daysAgo("2026-11-10", now), 0, "avui és 0");
  assert.equal(daysAgo("2026-11-09", now), 1);
  assert.equal(daysAgo("2026-10-13", now), 28);
  // Estiu (UTC+2): 00:30 local = 22:30 UTC del dia abans.
  assert.equal(daysAgo("2026-07-15", at("2026-07-15T00:30:00")), 0);
  // Durant el dia, igual que sempre.
  assert.equal(daysAgo("2026-11-09", at("2026-11-10T15:00:00")), 1);
  // Canvi d'hora (25/10/2026, dia de 25 hores): continua sent 1 dia d'ahir a avui.
  assert.equal(daysAgo("2026-10-24", at("2026-10-25T23:30:00")), 1);
  assert.equal(daysAgo("2026-10-25", at("2026-10-26T00:10:00")), 1);
});

test("#8 una sortida d'avui a les 00:30 compta a l'ACWR", () => {
  const now = at("2026-11-10T00:30:00");
  const acts = [];
  for (let i = 1; i <= 30; i++) acts.push({ id: "a" + i, date: dateStr(new Date(now - i * 864e5)), trimp: 50, distance: 10 });
  const sense = L.calcACWR({ acts, settings: {}, now });
  const amb = L.calcACWR({ acts: [...acts, { id: "avui", date: "2026-11-10", trimp: 200, distance: 10 }], settings: {}, now });
  assert.notEqual(amb, sense, "la sortida d'avui ha de moure l'ACWR");
});

test("#6 la monotonia fa servir exactament 28 dies: el dia 28 no hi entra", () => {
  const now = at("2026-10-24T08:00:00");
  const day = n => dateStr(new Date(now - n * 864e5));
  const base = [];
  for (let i = 0; i < 28; i += 2) base.push({ id: "b" + i, date: day(i), trimp: 60 + (i % 3) * 20 });
  const ctx = a => ({ acts: a, settings: {}, now });
  const sense = L.calcMonotony(ctx(base));
  const ambDia28 = L.calcMonotony(ctx([...base, { id: "x28", date: day(28), trimp: 500 }]));
  assert.deepEqual(ambDia28, sense, "una sortida de fa 28 dies no canvia res");
  const ambDia27 = L.calcMonotony(ctx([...base, { id: "x27", date: day(27), trimp: 500 }]));
  assert.notDeepEqual(ambDia27, sense, "una de fa 27 dies sí que compta");
});

test("#4 només hi ha un estat d'entrenament: trainingStatus", () => {
  assert.equal(L.getStatus, undefined);
  assert.equal(typeof L.trainingStatus, "function");
});
