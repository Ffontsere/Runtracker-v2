// Genera un conjunt de dades de prova per comparar la v1 amb el motor nou.
// Les sortides de juliol a octubre de 2026 són les teves de Strava (distància, temps, desnivell, data);
// les anteriors, la FC i els camps derivats són sintètics però plausibles i reproduïbles (llavor fixa).
// La comparació no depèn que les dades siguin reals: comprova que v1 i v2 donen el mateix.

let seed = 20261024;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (a, b) => a + (b - a) * rnd();

// [data, hora, km, segons en moviment, desnivell] — Strava, 18/7–17/10/2026 (curses)
const REAL = [
  ["2026-10-17", "10:03", 15.10, 4621, 368], ["2026-10-15", "19:16", 15.26, 4305, 75], ["2026-10-12", "11:07", 4.80, 1406, 45],
  ["2026-10-12", "10:14", 10.51, 3059, 242], ["2026-10-11", "10:00", 15.03, 4612, 260], ["2026-10-09", "17:58", 16.04, 4768, 277],
  ["2026-10-04", "16:51", 21.37, 7081, 608], ["2026-10-03", "09:24", 15.06, 4532, 188], ["2026-09-30", "19:13", 15.31, 4252, 74],
  ["2026-09-27", "10:06", 21.21, 6494, 299], ["2026-09-25", "09:57", 15.26, 4299, 132], ["2026-09-23", "19:08", 15.22, 4295, 68],
  ["2026-09-20", "09:33", 18.41, 6226, 720], ["2026-09-18", "19:06", 15.03, 4291, 254], ["2026-09-17", "19:08", 12.01, 3382, 54],
  ["2026-09-13", "09:33", 21.21, 6439, 480], ["2026-09-11", "09:45", 15.15, 4168, 135], ["2026-09-08", "19:25", 15.29, 4340, 73],
  ["2026-09-06", "10:00", 5.07, 1670, 59], ["2026-09-06", "09:08", 10.01, 2904, 211], ["2026-09-05", "08:38", 15.06, 4590, 189],
  ["2026-08-30", "09:23", 18.66, 6243, 740], ["2026-08-28", "19:37", 5.11, 1566, 52], ["2026-08-28", "18:46", 10.01, 2819, 189],
  ["2026-08-26", "19:03", 15.04, 4406, 187], ["2026-08-23", "09:32", 15.56, 5124, 554], ["2026-08-21", "09:17", 15.11, 4380, 224],
  ["2026-08-20", "09:17", 15.10, 4374, 131], ["2026-08-18", "09:12", 15.11, 4421, 141], ["2026-08-16", "09:27", 15.01, 4844, 407],
  ["2026-08-14", "10:51", 4.71, 1525, 38], ["2026-08-14", "10:05", 6.41, 2478, 98], ["2026-08-14", "09:37", 5.01, 1570, 85],
  ["2026-08-12", "10:30", 4.71, 1548, 38], ["2026-08-12", "09:32", 10.30, 2928, 68], ["2026-08-11", "09:37", 15.11, 4617, 128],
  ["2026-08-09", "09:38", 15.12, 4588, 187], ["2026-08-06", "09:58", 19.59, 6401, 727], ["2026-08-04", "10:50", 15.32, 4638, 353],
  ["2026-08-02", "17:45", 14.66, 4627, 281], ["2026-07-29", "19:11", 15.21, 4435, 83], ["2026-07-26", "09:54", 20.06, 6139, 498],
  ["2026-07-24", "09:17", 15.04, 4557, 194], ["2026-07-22", "19:22", 10.60, 3484, 23], ["2026-07-21", "19:25", 10.02, 2907, 50],
  ["2026-07-19", "09:31", 18.05, 6123, 461], ["2026-07-18", "09:47", 6.01, 1887, 34], ["2026-07-18", "09:00", 9.20, 2680, 148],
];

const HRMAX = 176, HRREST = 49;
const cTR = (dm, hr) => { const x = (hr - HRREST) / (HRMAX - HRREST); return x > 0 && x < 1 ? Math.round(dm * x * .64 * Math.exp(1.92 * x)) : null; };

function synthEarlier() {
  // Agost 2025 – mitjan juliol 2026: 3–4 sortides per setmana
  const out = [];
  const start = Date.parse("2025-08-04T00:00:00Z"), end = Date.parse("2026-07-15T00:00:00Z");
  for (let t = start; t < end; t += 864e5) {
    const dow = new Date(t).getUTCDay();
    const runDay = [2, 4, 6, 0].includes(dow) && rnd() < 0.85;
    if (!runDay) continue;
    const long = dow === 0 || dow === 6;
    const km = long ? pick(16, 22) : pick(8, 15.5);
    const pace = long ? pick(305, 335) : pick(282, 318);
    const asc = long && rnd() < 0.5 ? pick(300, 750) : pick(40, 260);
    const d = new Date(t).toISOString().slice(0, 10);
    out.push([d, rnd() < 0.5 ? "09:30" : "19:10", Math.round(km * 100) / 100, Math.round(km * pace), Math.round(asc)]);
  }
  return out;
}

export function makeDataset() {
  seed = 20261024;
  const rows = [...synthEarlier(), ...REAL].sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
  const acts = rows.map((r, i) => {
    const [date, hm, km, dur, asc] = r;
    const pace = dur / km;
    const hard = rnd() < 0.12;                      // ~1 de cada 8, tempo o sèries
    const avgHR = Math.round(hard ? pick(150, 164) : pick(128, 146));
    const a = {
      id: "strava-" + (19000000000 + i * 7919), date, title: hard ? "Sèries" : "Carrera", distance: km, duration: dur,
      avgHR, maxHR: Math.min(HRMAX + 2, avgHR + Math.round(pick(8, 22))), pace, ascent: asc,
      cadence: Math.round(pick(182, 194)), temp: null, lat: 41.68 + pick(-0.01, 0.01), lng: 2.28 + pick(-0.01, 0.01),
      startTime: date + "T" + hm + ":00", trimp: cTR(dur / 60, avgHR), vo2: null, hrZone: null, source: "strava",
    };
    if (rnd() < 0.35) { a.vo2s = Math.round(pick(47, 53) * 10) / 10; a.vo2n = Math.round(pick(3, 25)); }
    if (rnd() < 0.5) {
      const tot = dur / 60, z = hard ? [0.05, 0.25, 0.25, 0.35, 0.10] : [0.20, 0.65, 0.12, 0.03, 0];
      a.tiz = z.map(f => Math.round(tot * f * 10) / 10);
    }
    if (rnd() < 0.6 && km >= 3) {
      const v = 1000 / pace;
      a.be = { 60: +(v * 1.45).toFixed(3), 120: +(v * 1.35).toFixed(3), 300: +(v * 1.22).toFixed(3), 600: +(v * 1.15).toFixed(3), 1200: +(v * 1.09).toFixed(3) };
      if (dur >= 1800) a.be[1800] = +(v * 1.06).toFixed(3);
      if (dur >= 3600) a.be[3600] = +(v * 1.01).toFixed(3);
    }
    if (dur >= 4200 && rnd() < 0.8) a.dec = Math.round(pick(1, 9) * 10) / 10;
    if (rnd() < 0.3) a.rpe = Math.round(pick(2, 8));
    if (rnd() < 0.05) a.tempManual = Math.round(pick(5, 30));
    return a;
  });
  // una cursa marcada, per al VDOT
  const race = acts.find(a => a.date === "2026-09-11"); if (race) { race.isRace = true; race.avgHR = 166; }
  const hrRestLog = [];
  for (let i = 60; i >= 1; i--) {
    const d = new Date(Date.parse("2026-10-24T00:00:00Z") - i * 864e5).toISOString().slice(0, 10);
    if (rnd() < 0.85) hrRestLog.push({ d, v: Math.round(pick(46, 53)) });
  }
  const settings = {
    hrMax: HRMAX, hrRest: HRREST, weeklyTarget: 45, yearlyGoal: 2200, name: "Francesc", weight: 70, zones: null,
    birth: "1981-08-18", hrRestLog, _zMigrated: true, stravaClientId: "220720",
  };
  const tempCache = {};
  acts.forEach((a, i) => { if (i % 3 === 0) tempCache[a.id] = { t: Math.round(pick(4, 31)), dp: Math.round(pick(0, 19)), elev: Math.round(pick(150, 1300)), w: Math.round(pick(2, 36)) }; });
  return { acts, settings, tempCache };
}

/** Streams sintètics d'una sortida: 1 mostra per segon. */
export function makeStreams({ secs = 4200, v0 = 3.35, hr0 = 132, drift = 8, hard = false } = {}) {
  seed = 4242 + secs + Math.round(v0 * 100) + hr0;
  const time = [], hr = [], vel = [], grade = [], dist = [], latlng = [];
  let d = 0, lat = 41.68, lng = 2.28;
  for (let t = 0; t < secs; t++) {
    const g = 6 * Math.sin(t / 300) + pick(-1, 1);
    const rep = hard && t > 900 && t < secs - 600 && Math.floor((t - 900) / 180) % 2 === 0;
    const v = Math.max(0, (rep ? v0 * 1.25 : v0) * (1 - g * 0.012) + pick(-0.08, 0.08));
    const h = Math.min(185, hr0 + drift * t / secs + (rep ? 18 : 0) + Math.min(20, t / 30) - 20 + pick(-2, 2));
    d += v; lat += v * 0.000004 * Math.cos(t / 900); lng += v * 0.000004 * Math.sin(t / 900);
    time.push(t); hr.push(Math.round(h)); vel.push(+v.toFixed(3)); grade.push(+g.toFixed(1)); dist.push(+d.toFixed(1));
    latlng.push([+lat.toFixed(6), +lng.toFixed(6)]);
  }
  return {
    time: { data: time }, heartrate: { data: hr }, velocity_smooth: { data: vel },
    grade_smooth: { data: grade }, distance: { data: dist }, latlng: { data: latlng },
  };
}
