// TRIMP recomanat per a una sessió fàcil (BUGS-v1 #5).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDataset } from "./fixtures/make-dataset.mjs";
import { easyTrimp, trimpPerMin, EASY_FRACTION, EASY_ACWR_MAX } from "../js/engine/easy.js";
import { trainingStatus, calcACWR } from "../js/engine/load.js";
import { dateStr } from "../js/engine/dates.js";

const NOW = new Date("2026-10-24T09:20:00").getTime();
const { acts, settings } = makeDataset();
const ctx = { acts, settings: { ...settings, hrMax: 176, hrRest: 45 }, now: NOW };

test("trimpPerMin és la fórmula de Banister per minut", () => {
  const r = trimpPerMin(135, 176, 45);
  assert.ok(Math.abs(r - 0.64 * (90 / 131) * Math.exp(1.92 * 90 / 131)) < 1e-9);
  assert.ok(r > 1.5 && r < 1.8, "uns 1,6 per minut a 135 ppm: " + r);
  assert.equal(trimpPerMin(40, 176, 45), null, "per sota del repòs");
  assert.equal(trimpPerMin(135, 176, null), null);
});

test("rang coherent: ordenat, múltiple de 5 i ve de la sessió mitjana i de l'estat", () => {
  const e = easyTrimp(ctx);
  assert.ok(e, "hi ha prou historial");
  const st = trainingStatus(ctx, { useBodySignals: false });
  assert.equal(e.status, st.key);
  assert.ok(e.lo <= e.hi);
  assert.equal(e.lo % 5, 0); assert.equal(e.hi % 5, 0);
  if (!e.capped) {
    const [fl, fh] = EASY_FRACTION[e.status];
    assert.ok(Math.abs(e.lo - e.session * fl) <= 2.5 + 1e-9, "mínim = fracció de la sessió mitjana");
    assert.ok(Math.abs(e.hi - e.session * fh) <= 2.5 + 1e-9, "màxim = fracció de la sessió mitjana");
  }
  assert.ok(e.minLo != null && e.minLo <= e.minHi, "hi ha minuts");
  assert.ok(e.z2hi > 100 && e.z2hi < 176);
});

test("els estats més carregats donen un rang més baix", () => {
  const f = EASY_FRACTION;
  for (const k of ["fresc", "assimilant", "carregat", "sobrecarregat"]) assert.ok(f[k][0] < f[k][1], k);
  assert.ok(f.fresc[1] >= f.assimilant[1] && f.assimilant[1] > f.carregat[1] && f.carregat[1] > f.sobrecarregat[1]);
  assert.ok(f.fresc[0] >= f.assimilant[0] && f.assimilant[0] > f.carregat[0] && f.carregat[0] > f.sobrecarregat[0]);
});

test("el màxim no deixa l'ACWR per sobre d'1,3 després de la sessió", () => {
  // Busquem una setmana carregada però no tant com perquè ja calgui descansar: el límit d'ACWR mana i el màxim és > 0.
  const today = dateStr(new Date(NOW));
  let found = null;
  for (let trimp = 100; trimp <= 400 && !found; trimp += 20) {
    const dur = [...acts];
    for (let i = 1; i <= 4; i++) dur.push({ id: "dur" + i, date: dateStr(new Date(NOW - i * 864e5)), trimp, distance: 20 });
    const e = easyTrimp({ ...ctx, acts: dur });
    if (e && e.capped && e.hi > 0) found = { dur, e };
  }
  assert.ok(found, "hi ha una càrrega on el límit d'ACWR s'aplica i encara queda marge");
  const amb = calcACWR({ acts: [...found.dur, { id: "x", date: today, trimp: found.e.hi }], now: NOW });
  assert.ok(amb <= EASY_ACWR_MAX + 0.03, "ACWR després de la sessió màxima (arrodonida a 5): " + amb);
});

test("si l'ACWR ja passa d'1,3, recomana descansar (màxim 0)", () => {
  const today = dateStr(new Date(NOW));
  const dur = [...acts, { id: "bestiara", date: today, trimp: 4000, distance: 60 }];
  const e = easyTrimp({ ...ctx, acts: dur });
  assert.equal(e.hi, 0);
  assert.equal(e.lo, 0);
  assert.ok(e.capped);
  assert.ok(e.doneToday >= 4000);
});

test("sense prou historial no recomana res", () => {
  assert.equal(easyTrimp({ ...ctx, acts: acts.slice(0, 3) }), null);
  assert.equal(easyTrimp({ ...ctx, acts: [] }), null);
});

test("sense FC màxima o en repòs dona el rang en TRIMP però sense minuts", () => {
  const e = easyTrimp({ ...ctx, settings: { ...ctx.settings, hrMax: null } });
  assert.ok(e);
  assert.equal(e.minLo, null); assert.equal(e.minHi, null);
});
