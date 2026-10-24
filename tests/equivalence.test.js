// Comprova que el motor nou dona exactament el mateix que la v1 (v47) amb les mateixes dades.
// La v1 es carrega sencera en un navegador simulat (jsdom) amb un rellotge fix i l'hora de Barcelona.
// Executa amb:  npm test   (fixa TZ=Europe/Madrid)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { JSDOM } from "jsdom";
import { makeDataset, makeStreams } from "./fixtures/make-dataset.mjs";

import * as L from "../js/engine/load.js";
import * as P from "../js/engine/physio.js";
import * as R from "../js/engine/performance.js";
import * as W from "../js/engine/weather.js";

const V1 = readFileSync(new URL("./fixtures/v1/index.v47.html", import.meta.url), "utf8");
const json = x => JSON.parse(JSON.stringify(x ?? null));
const same = (a, b, msg) => assert.deepStrictEqual(json(a), json(b), msg);

// Dates d'"avui" per provar: un dia normal, l'endemà d'una llarga, un diumenge i un dia de canvi d'hora.
const NOWS = ["2026-10-24T08:34:00", "2026-10-05T07:00:00", "2026-09-27T21:30:00", "2026-10-25T12:00:00"];

const LONG_IDS = []; // activitats amb streams a la cache de la v1 (per al LT1 per desacoblament)

function loadV1(nowLocal, data) {
  const T = new Date(nowLocal).getTime();
  const streams = {};
  if (data.synthetic) data.acts.filter(a => a.duration >= 2700).slice(-3).forEach((a, i) => {
    const s = makeStreams({ secs: Math.min(a.duration, 4800), hr0: 128 + i * 4, drift: i === 2 ? 14 : 5 });
    streams[a.id.replace("strava-", "")] = { time: s.time, heartrate: s.heartrate, velocity_smooth: s.velocity_smooth, grade_smooth: s.grade_smooth };
    LONG_IDS.push(a.id);
  });
  const dom = new JSDOM(V1, {
    runScripts: "dangerously", url: "https://ffontsere.github.io/runtracker/", pretendToBeVisual: true,
    beforeParse(w) {
      const RD = w.Date;
      class FD extends RD { constructor(...a) { if (a.length === 0) super(T); else super(...a); } static now() { return T; } }
      w.Date = FD;
      w.localStorage.setItem("rt4:a", JSON.stringify(data.acts));
      w.localStorage.setItem("rt4:s", JSON.stringify(data.settings));
      w.localStorage.setItem("rt4:temps", JSON.stringify(data.tempCache));
      w.localStorage.setItem("rt4:streams", JSON.stringify(streams));
      // Estat d'un mòbil que ja ha passat les migracions de la v1. Sense "rt4:vo2fix", la v1
      // desa una llista buida abans de carregar (bug documentat a BUGS-v1.md); sense "rt4:gadj1",
      // esborra els millors esforços i la deriva.
      w.localStorage.setItem("rt4:vo2fix", "4");
      w.localStorage.setItem("rt4:gadj1", "1");
      w.scrollTo = () => {}; w.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
      w.HTMLCanvasElement.prototype.getContext = () => null;
    },
  });
  const w = dom.window;
  const v1 = src => w.eval(src);
  // La v1 pot recalcular camps en carregar: comparem amb el que la v1 té de veritat en memòria.
  const acts = json(v1("acts")), settings = json(v1("settings")), tempCache = json(v1("tempCache")), streamCache = json(v1("streamCache"));
  return { w, v1, ctx: { acts, settings, now: T, tempCache, streamCache } };
}

assert.equal(process.env.TZ, "Europe/Madrid", "Executa els tests amb TZ=Europe/Madrid (npm test)");

// Conjunts de dades: el sintètic sempre; la teva còpia de seguretat real si és a tests/private/ (no es puja a GitHub).
const DATASETS = [{ name: "sintètic", data: { ...makeDataset(), synthetic: true }, nows: NOWS }];
const PRIVATE = new URL("./private/backup.json", import.meta.url);
if (existsSync(PRIVATE)) {
  const b = JSON.parse(readFileSync(PRIVATE, "utf8"));
  DATASETS.push({ name: "còpia real", data: { acts: b.activities, settings: b.settings, tempCache: b.temps || {} },
    nows: ["2026-10-24T08:34:00", "2026-10-23T06:30:00", "2026-10-05T07:00:00"] });
}

for (const { name, data, nows } of DATASETS) for (const nowLocal of nows) {
  const { v1, ctx } = loadV1(nowLocal, data);
  const tag = s => `${s} · ${name} · avui ${nowLocal}`;

  test(tag("càrrega: CTL/ATL/TSB, ACWR, monotonia, projecció, recuperació"), () => {
    assert.ok(ctx.acts.length > 150, "el conjunt de dades s'ha carregat a la v1");
    assert.equal(ctx.acts.length, data.acts.length, "la v1 té totes les activitats en memòria");
    const ff = L.calcFF(ctx);
    same(ff, v1("calcFF()"), "calcFF");
    same(L.ffNow(ff), v1("ffNow(calcFF())"), "ffNow");
    same(L.calcACWR(ctx), v1("calcACWR()"), "calcACWR");
    same(L.calcMonotony(ctx), v1("calcMonotony()"), "calcMonotony");
    same(L.projectFitness(ff, 14, 55), v1("projectFitness(calcFF(),14,55)"), "projectFitness");
    same(L.estRecovery(ctx), v1("estRecovery()"), "estRecovery");
    const s1 = v1("getStatus(calcFF())"), s2 = L.getStatus(ctx, ff);
    same([s2.s, s2.d], [s1.s, s1.d], "getStatus");
    same(L.hrRestStatus(ctx), v1("hrRestStatus()"), "hrRestStatus");
    same(L.rpeTrend(ctx), v1("rpeTrend()"), "rpeTrend");
    const t1 = v1("trainingStatus()"), t2 = L.trainingStatus(ctx);
    same([t2.label, t2.phrase], [t1.label, t1.phrase], "trainingStatus");
  });

  test(tag("TRIMP de cada activitat i dels streams"), () => {
    for (const a of ctx.acts.slice(-40)) same(L.trimpBanister(a.duration / 60, a.avgHR, 176, 49), v1(`cTR(${a.duration / 60},${a.avgHR},176,49)`), a.id);
    for (const opt of [{}, { hard: true }, { secs: 500 }]) {
      const s = makeStreams(opt);
      const w = v1("window"); w.__s = s;
      same(L.trimpFromStream(s, ctx.settings), v1("trimpFromStream(window.__s)"), "trimpFromStream " + JSON.stringify(opt));
    }
    same(L.trimpFromTiZ([10, 30, 8, 2, 0]), v1("trimpFromTiZ([10,30,8,2,0])"), "trimpFromTiZ");
  });

  test(tag("zones, VO₂max, eficiència i durabilitat"), () => {
    same(P.lt2Estimate(ctx), v1("lt2Estimate()"), "lt2Estimate");
    same(P.lt1Decoupling(ctx), v1("lt1Decoupling()"), "lt1Decoupling");
    same(P.thresholdZones(ctx), v1("thresholdZones()"), "thresholdZones");
    const b = P.activeZoneBounds(ctx);
    same(b, v1("activeZoneBounds()"), "activeZoneBounds");
    for (const hr of [100, 130, 141, 150, 159, 160, 170, 190]) same(P.hrZone(hr, b), v1(`hZ(${hr},176,49)`), "hZ " + hr);
    same(P.currentVO2max(ctx, 42), v1("currentVO2max(42)"), "currentVO2max 42");
    same(P.currentVO2max(ctx, 90), v1("currentVO2max(90)"), "currentVO2max 90");
    same(P.aerobicEfficiency(ctx, 0, 28), v1("aerobicEfficiency(0,28)"), "aerobicEfficiency");
    same(P.efficiencyTrend(ctx), v1("efficiencyTrend()"), "efficiencyTrend");
    same(P.efficiencySeries(ctx, 10, 28), v1("efficiencySeries(10,28)"), "efficiencySeries");
    same(P.durabilityTrend(ctx), v1("durabilityTrend()"), "durabilityTrend");
    same(P.getZoneDist(ctx, 28), v1("getZoneDist(28)"), "getZoneDist 28");
    same(P.getZoneDist(ctx, 90), v1("getZoneDist(90)"), "getZoneDist 90");
  });

  test(tag("VO₂ de cada activitat (streams, cursa, FC)"), () => {
    for (const a of ctx.acts.slice(-60)) {
      const w = v1("window"); w.__a = JSON.parse(JSON.stringify(a));
      v1("recomputeVO2(window.__a)");
      const want = { vo2: w.__a.vo2, vo2raw: w.__a.vo2raw, vo2conf: w.__a.vo2conf };
      same(P.vo2ForActivity(a, ctx.settings, ctx.tempCache), want, a.id + (a.isRace ? " (cursa)" : ""));
      same(P.actWx(a, ctx.tempCache), v1("actWx(window.__a)"), "actWx " + a.id);
    }
  });

  test(tag("funcions de streams: deriva, VO₂, millors esforços, temps per zona"), () => {
    const b = P.activeZoneBounds(ctx);
    for (const opt of [{}, { hard: true }, { drift: 20 }, { secs: 1500 }, { secs: 120 }]) {
      const s = makeStreams(opt);
      const w = v1("window"); w.__s = s;
      const o = JSON.stringify(opt);
      same(P.calcCardiacDrift(s), v1("calcCardiacDrift(window.__s)"), "deriva " + o);
      same(P.vo2FromStream(s, ctx.settings), v1("vo2FromStream(window.__s)"), "vo2FromStream " + o);
      same(R.computeBestEfforts(s), v1("computeBestEfforts(window.__s)"), "computeBestEfforts " + o);
      same(P.computeTiZ(s, b), v1("computeTiZ(window.__s)"), "computeTiZ " + o);
    }
  });

  test(tag("marques, predicció, ratxes, resums i informe de bloc"), () => {
    const prs = R.calcPRs(ctx);
    same(prs, v1("calcPRs()"), "calcPRs");
    same(R.calcPredictions(prs), v1("calcPredictions(calcPRs())"), "calcPredictions");
    same(R.personalRiegelExp(ctx), v1("personalRiegelExp()"), "personalRiegelExp");
    same(R.calcMultiPredict(ctx, prs, 21.0975, 300), v1("calcMultiPredict(calcPRs(),21.0975,300)"), "calcMultiPredict");
    same(R.vdotFromCurve(ctx), v1("vdotFromCurve()"), "vdotFromCurve");
    same(R.calcStreaks(ctx), v1("calcStreaks()"), "calcStreaks");
    same(R.getWeekly(ctx), v1("getWeekly()"), "getWeekly");
    same(R.getS28(ctx), v1("getS28()"), "getS28");
    same(R.getWindowStats(ctx, 28, 56), v1("getWindowStats(28,56)"), "getWindowStats");
    same(R.getPeriodRecords(ctx, 90), v1("getPeriodRecords(90)"), "getPeriodRecords");
    same(R.loadResponse(ctx), v1("loadResponse()"), "loadResponse");
    same(R.blockReport(ctx), v1("blockReport()"), "blockReport");
    same(R.analyzeHistory(ctx), v1("analyzeHistory()"), "analyzeHistory");
  });

  test(tag("clima: puntuació per hores i finestres"), () => {
    const hours = [];
    for (let i = 0; i < 48; i++) hours.push({ temp: -2 + i * 0.75, dp: 2 + i * 0.4, rad: Math.max(0, 800 * Math.sin((i % 24 - 6) / 12 * Math.PI)), wind: (i * 7) % 40, gust: (i * 11) % 70, pprob: (i * 13) % 100, prec: ((i * 3) % 9) / 2 });
    const w = v1("window"); w.__h = hours;
    for (const type of ["easy", "long", "quality", "tempo", "rest", "x"]) {
      for (let i = 0; i < hours.length; i += 5) {
        same(W.wxHourScore(hours[i], type), v1(`wxHourScore(window.__h[${i}],${JSON.stringify(type)})`), `wxHourScore ${type} ${i}`);
        same(W.wxWindowScore(hours, i, type), v1(`wxWindowScore(window.__h,${i},${JSON.stringify(type)})`), `wxWindowScore ${type} ${i}`);
      }
    }
    for (const sc of [100, 85, 84, 70, 55, 40, 39, 0]) same(W.wxCat(sc).l, v1(`wxCat(${sc}).l`), "wxCat " + sc);
    same(W.wxTypicalPace(ctx), v1("wxTypicalPace()"), "wxTypicalPace");
  });
}
