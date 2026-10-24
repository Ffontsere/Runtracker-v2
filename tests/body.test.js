import { test } from "node:test";
import assert from "node:assert/strict";
import { navyBodyFat, waistToHeight, waistToHip, leanMass, proteinTarget,
  weightAverage, weightTrend, muscleLossSignal, bodySummary, readWaistHeight } from "../js/engine/body.js";

test("Marina amb les mesures de Francesc (18/10/2026)", () => {
  assert.equal(navyBodyFat({ waist: 78.5, neck: 36, height: 179.5 }), 12.6);
  assert.equal(navyBodyFat({ waist: 77, neck: 36, height: 179.5 }), 11.3);
});

test("Marina rebutja mesures impossibles", () => {
  assert.equal(navyBodyFat({ waist: 30, neck: 36, height: 179.5 }), null);
  assert.equal(navyBodyFat({ waist: 0, neck: 36, height: 179.5 }), null);
  assert.equal(navyBodyFat({ waist: 70, neck: 32, height: 165, sex: "female" }), null); // falta el maluc
  assert.ok(navyBodyFat({ waist: 70, neck: 32, height: 165, hip: 95, sex: "female" }) > 15);
});

test("índexs de cintura", () => {
  assert.equal(waistToHeight(78.5, 179.5), 0.44);
  assert.equal(waistToHip(78.5, 93), 0.84);
  assert.equal(readWaistHeight(0.44).level, "ok");
  assert.equal(readWaistHeight(0.55).level, "warn");
  assert.equal(leanMass(70.5, 12.6), 61.6);
});

test("proteïna 1,6 g/kg amb rang 1,4–1,8", () => {
  assert.deepEqual(proteinTarget(70.5), { g: 113, lo: 99, hi: 127 });
  assert.equal(proteinTarget(0), null);
});

const days = (start, n, f) => Array.from({ length: n }, (_, i) => {
  const d = new Date(Date.parse(start + "T00:00:00Z") + i * 864e5).toISOString().slice(0, 10);
  return { date: d, ...f(i) };
});

test("mitjana i tendència del pes", () => {
  const e = days("2026-09-01", 50, i => ({ weight: 72 - i * 0.05 })); // −0,35 kg/setmana
  const avg = weightAverage(e, "2026-10-20", 7);
  assert.equal(avg.n, 7);
  const tr = weightTrend(e, "2026-10-20", 4);
  assert.equal(tr.delta, -1.4);
  assert.equal(tr.perWeek, -0.35);
  assert.equal(weightTrend(e.slice(-5), "2026-10-20", 4), null); // falten dades fa 4 setmanes
});

test("senyal de pèrdua de múscul: pes baixa, cintura igual", () => {
  const e = days("2026-09-01", 50, i => ({ weight: 72 - i * 0.05 }));
  e[20].waist = 79; e[49].waist = 79;
  const s = muscleLossSignal(e, "2026-10-20", 4);
  assert.ok(s);
  assert.equal(s.waistDelta, 0);
  e[49].waist = 77.5; // la cintura també baixa: és greix, no hi ha senyal
  assert.equal(muscleLossSignal(e, "2026-10-20", 4), null);
});

test("resum amb la primera entrada real", () => {
  const e = [{ date: "2026-10-18", weight: 70.5, waist: 78.5, neck: 36, hip: 93, scaleFat: 16.6 }];
  const s = bodySummary(e, { height: 179.5 }, "2026-10-19");
  assert.equal(s.weight, 70.5);
  assert.equal(s.navyFat, 12.6);
  assert.equal(s.waistHeight, 0.44);
  assert.equal(s.waistHip, 0.84);
  assert.equal(s.protein.g, 113);
  assert.equal(s.trend, null);
  assert.equal(s.signal, null);
});
