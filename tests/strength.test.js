import { test } from "node:test";
import assert from "node:assert/strict";
import { LADDERS, PATTERNS, initState, planSession, applyResult, fatigueState, strengthLoad, rangeLabel, RULES } from "../js/engine/strength.js";

test("totes les escales són coherents", () => {
  for (const p of PATTERNS) {
    const lad = LADDERS[p];
    assert.ok(lad.levels.length >= 3, p);
    for (const lv of lad.levels) {
      assert.ok(lv.lo > 0 && lv.hi >= lv.lo, `${p}: ${lv.n}`);
      assert.ok(lv.cue.length > 10, `${p}: ${lv.n} sense explicació`);
    }
  }
});

test("sessió A normal: 4 exercicis, 3 sèries, comença pel mínim", () => {
  const s = planSession("A", initState(), { tsb: 0, acwr: 1, regularWeeks: 10 });
  assert.equal(s.exercises.length, 4);
  const g = s.exercises[0];
  assert.equal(g.name, "Sentadilla búlgara");
  assert.deepEqual(g.targets, [8, 8, 8]);
  assert.equal(g.rirTarget, 2);
  assert.equal(s.exercises[3].sets, 2);
});

test("sessió B amb fatiga: sense pliometria, una sèrie menys, RIR 3", () => {
  const s = planSession("B", initState(), { tsb: -15, regularWeeks: 10 });
  assert.equal(s.fatigued, true);
  assert.ok(!s.exercises.some(e => e.plyo));
  assert.equal(s.exercises[0].sets, 2);
  assert.equal(s.exercises[0].rirTarget, 3);
  assert.ok(s.notes.some(n => n.includes("Fatiga alta")));
});

test("pliometria només amb 6 setmanes de base", () => {
  assert.ok(!planSession("B", initState(), { regularWeeks: 3 }).exercises.some(e => e.plyo));
  assert.ok(planSession("B", initState(), { regularWeeks: 6 }).exercises.some(e => e.plyo));
});

test("doble progressió: +1 rep, després nivell al cap de 2 sessions al màxim", () => {
  let st = initState();
  let r = applyResult(st, "genoll", { reps: [10, 9, 8], rirLast: 1 });
  assert.equal(r.verdict.action, "progress");
  st = r.state;
  assert.deepEqual(planSession("A", st).exercises[0].targets, [11, 10, 9]);
  r = applyResult(st, "genoll", { reps: [15, 15, 15], rirLast: 1 }); st = r.state;
  assert.equal(r.verdict.action, "progress");
  assert.equal(st.genoll.level, 1);
  r = applyResult(st, "genoll", { reps: [15, 15, 15], rirLast: 0 }); st = r.state;
  assert.equal(r.verdict.action, "up");
  assert.equal(st.genoll.level, 2);
  assert.deepEqual(planSession("A", st).exercises[0].targets, [8, 8, 8]);
});

test("massa fàcil: puja de cop si sobren 3 repeticions", () => {
  const r = applyResult(initState(), "genoll", { reps: [15, 15, 15], rirLast: 3 });
  assert.equal(r.verdict.action, "up");
  assert.equal(r.state.genoll.level, 2);
});

test("baixa de nivell després de 2 sessions per sota del mínim", () => {
  let st = initState();
  let r = applyResult(st, "genoll", { reps: [6, 5, 5], rirLast: 0 }); st = r.state;
  assert.equal(r.verdict.action, "hold");
  r = applyResult(st, "genoll", { reps: [7, 6, 5], rirLast: 0 }); st = r.state;
  assert.equal(r.verdict.action, "down");
  assert.equal(st.genoll.level, 0);
});

test("una sessió normal entre dues de baixes reinicia el comptador", () => {
  let st = initState();
  st = applyResult(st, "genoll", { reps: [6, 5, 5] }).state;
  st = applyResult(st, "genoll", { reps: [9, 9, 8] }).state;
  const r = applyResult(st, "genoll", { reps: [6, 5, 5] });
  assert.equal(r.verdict.action, "hold");
  assert.equal(r.state.genoll.level, 1);
});

test("amb fatiga es guarda però no es puja", () => {
  const r = applyResult(initState(), "genoll", { reps: [15, 15], rirLast: 4 }, { fatigued: true });
  assert.equal(r.verdict.action, "hold");
  assert.equal(r.state.genoll.level, 1);
  assert.equal(r.state.genoll.topStreak, 0);
});

test("molèstia: no puja i proposa el nivell anterior", () => {
  const r = applyResult(initState(), "genoll", { reps: [15, 15, 15], rirLast: 3, pain: true });
  assert.equal(r.verdict.action, "pain");
  assert.equal(r.state.genoll.level, 1);
  assert.equal(r.verdict.suggestLevel, 0);
});

test("pliometria: puja després de 3 sessions netes, baixa amb molèstia", () => {
  let st = { ...initState(), pliometria: { level: 1, topStreak: 0, lowStreak: 0, cleanCount: 0, lastReps: null } };
  for (let i = 0; i < 2; i++) st = applyResult(st, "pliometria", { quality: "ok" }).state;
  let r = applyResult(st, "pliometria", { quality: "ok" });
  assert.equal(r.verdict.action, "up");
  assert.equal(r.state.pliometria.level, 2);
  r = applyResult(r.state, "pliometria", { quality: "pain" });
  assert.equal(r.verdict.action, "down");
  assert.equal(r.state.pliometria.level, 1);
});

test("no surt del rang de nivells", () => {
  const top = LADDERS.traccio.levels.length - 1;
  let st = { ...initState(), traccio: { level: top, topStreak: 0, lowStreak: 0, cleanCount: 0, lastReps: null } };
  for (let i = 0; i < 3; i++) st = applyResult(st, "traccio", { reps: [8, 8, 8], rirLast: 4 }).state;
  assert.equal(st.traccio.level, top);
  st = { ...initState(), traccio: { level: 0, topStreak: 0, lowStreak: 0, cleanCount: 0, lastReps: null } };
  for (let i = 0; i < 3; i++) st = applyResult(st, "traccio", { reps: [2, 2, 2], rirLast: 0 }).state;
  assert.equal(st.traccio.level, 0);
});

test("l'estat d'entrada no es modifica", () => {
  const st = initState();
  const before = JSON.stringify(st);
  applyResult(st, "genoll", { reps: [15, 15, 15], rirLast: 3 });
  assert.equal(JSON.stringify(st), before);
});

test("fatiga, càrrega i etiquetes", () => {
  assert.equal(fatigueState({ tsb: -13 }).high, true);
  assert.equal(fatigueState({ acwr: 1.4 }).high, true);
  assert.equal(fatigueState({ tsb: -5, acwr: 1.1 }).high, false);
  assert.equal(fatigueState({}).high, false);
  assert.equal(strengthLoad(25, 7), Math.round(25 * 7 * RULES.loadFactor));
  assert.equal(strengthLoad(0, 7), 0);
  const s = planSession("A", initState(), { regularWeeks: 10 });
  assert.equal(rangeLabel(s.exercises[0]), "8–15 per cama");
  assert.equal(rangeLabel(s.exercises[3]), "30–60 s");
});

import { withAllPatterns, unitOf } from "../js/engine/strength.js";

test("isomètrics: +5 s per sessió i sèries intactes amb fatiga", () => {
  let st = initState();
  st = applyResult(st, "isoGenoll", { reps: [40, 35], rirLast: 1 }).state;
  const b = planSession("B", st, { regularWeeks: 10 });
  const iso = b.exercises.find(e => e.pattern === "isoGenoll");
  assert.equal(iso.iso, true);
  assert.deepEqual(iso.targets, [45, 40]);
  const bf = planSession("B", st, { tsb: -20, regularWeeks: 10 });
  assert.equal(bf.exercises.find(e => e.pattern === "isoGenoll").sets, 2);
  assert.equal(bf.exercises.find(e => e.pattern === "empenta").sets, 2);
});

test("core del tot isomètric", () => {
  assert.equal(LADDERS.coreFrontal.iso, true);
  assert.equal(LADDERS.coreLateral.iso, true);
  assert.equal(LADDERS.coreFrontal.levels[0].n, "Dead bug aguantat");
});

test("empentes explosives: 4×10 repeticions, no segons", () => {
  const top = LADDERS.isoPanxell.levels.length - 1;
  const st = { ...initState(), isoPanxell: { level: top, topStreak: 0, lowStreak: 0, cleanCount: 0, lastReps: null } };
  const ex = planSession("B", st, { regularWeeks: 10 }).exercises.find(e => e.pattern === "isoPanxell");
  assert.equal(unitOf("isoPanxell", top), "reps");
  assert.equal(ex.sets, 4);
  assert.equal(ex.iso, false);
  assert.equal(rangeLabel(ex), "10");
});

test("un estat desat abans dels isomètrics es completa sol", () => {
  const old = initState(); delete old.isoGenoll; delete old.isoPanxell;
  const full = withAllPatterns(old);
  assert.equal(full.isoGenoll.level, 0);
  assert.equal(old.isoGenoll, undefined);
  assert.doesNotThrow(() => planSession("B", old, { regularWeeks: 10 }));
  assert.doesNotThrow(() => applyResult(old, "isoPanxell", { reps: [30, 30] }));
});
