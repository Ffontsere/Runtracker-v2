// RunTracker v2 — motor de força a casa, sense material.
// Funcions pures: no toquen la pantalla ni l'emmagatzematge.
//
// Cada moviment té una escala de variants (nivells). Es progressa amb
// "doble progressió": primer repeticions dins del rang, després nivell.

/** @typedef {'reps'|'s'|'contactes'} Unit */

export const LADDERS = {
  genoll: {
    name: "Genoll", muscles: "Quàdriceps i glutis", unit: "reps",
    levels: [
      { n: "Sentadilla", lo: 12, hi: 20, uni: false, cue: "Peus a l'amplada de les espatlles, baixa fins que les cuixes quedin paral·leles i puja sense rebotar." },
      { n: "Sentadilla búlgara", lo: 8, hi: 15, uni: true, cue: "Peu del darrere sobre una cadira. Baixa amb la cama del davant fins que el genoll del darrere gairebé toqui a terra." },
      { n: "Búlgara amb baixada de 3 s", lo: 8, hi: 12, uni: true, cue: "Com la búlgara, però comptant 3 segons a la baixada." },
      { n: "Sentadilla a una cama fins a la cadira", lo: 5, hi: 10, uni: true, cue: "Dempeus davant d'una cadira, baixa a una cama fins a tocar el seient i torna a pujar sense recolzar-t'hi." },
      { n: "Sentadilla gamba", lo: 5, hi: 10, uni: true, cue: "Agafa el peu lliure per darrere i baixa fins que el genoll toqui un coixí a terra." },
      { n: "Pistol", lo: 3, hi: 8, uni: true, cue: "Sentadilla completa a una cama amb l'altra estirada endavant. Si cal, agafa't a un marc de porta." },
    ],
  },
  maluc: {
    name: "Maluc", muscles: "Glutis i isquiotibials", unit: "reps",
    levels: [
      { n: "Pont de glutis", lo: 15, hi: 20, uni: false, cue: "Estirat panxa amunt, genolls flexionats. Puja el maluc fins alinear genolls, maluc i espatlles." },
      { n: "Hip thrust a una cama", lo: 10, hi: 15, uni: true, cue: "Esquena recolzada al sofà, un peu a terra. Empeny el maluc amunt només amb aquella cama." },
      { n: "Hip thrust a una cama amb 2 s a dalt", lo: 8, hi: 12, uni: true, cue: "Igual, però aguanta 2 segons a dalt contraient el glutis." },
      { n: "Curl nòrdic assistit", lo: 4, hi: 8, uni: false, cue: "De genolls, talons sota el sofà. Baixa endavant tan lent com puguis i frena amb les mans en arribar a terra." },
      { n: "Curl nòrdic", lo: 3, hi: 6, uni: false, cue: "Igual, però baixant fins a terra sense ajuda de les mans fins al final." },
    ],
  },
  panxell: {
    name: "Panxell", muscles: "Bessons i soli", unit: "reps",
    levels: [
      { n: "Talons a dues cames a l'esglaó", lo: 15, hi: 25, uni: false, cue: "Puntes a la vora d'un esglaó. Baixa els talons per sota i puja tan alt com puguis." },
      { n: "Talons a una cama a l'esglaó", lo: 10, hi: 20, uni: true, cue: "Igual, a una cama. Agafa't a la paret només per equilibrar." },
      { n: "Talons a una cama, baixada de 3 s", lo: 8, hi: 15, uni: true, cue: "Puja ràpid i baixa comptant 3 segons." },
      { n: "Talons a una cama amb genoll flexionat", lo: 8, hi: 15, uni: true, cue: "Genoll lleugerament flexionat tota l'estona per treballar el soli. Baixada de 3 s." },
    ],
  },
  empenta: {
    name: "Empenta", muscles: "Pit, espatlles i tríceps", unit: "reps",
    levels: [
      { n: "Flexions amb mans a la taula", lo: 10, hi: 20, uni: false, cue: "Mans a la vora d'una taula ferma, cos recte. Baixa el pit fins a la taula." },
      { n: "Flexions", lo: 8, hi: 15, uni: false, cue: "Mans una mica més obertes que les espatlles, cos recte, pit a prop de terra." },
      { n: "Flexions amb baixada de 3 s", lo: 6, hi: 12, uni: false, cue: "Baixa comptant 3 segons i puja normal." },
      { n: "Flexions amb peus a la cadira", lo: 6, hi: 12, uni: false, cue: "Peus sobre una cadira, cos recte." },
      { n: "Flexions arquer", lo: 4, hi: 8, uni: true, cue: "Mans molt obertes. Baixa cap a un costat amb l'altre braç gairebé estirat." },
    ],
  },
  traccio: {
    name: "Tracció", muscles: "Esquena i bíceps", unit: "reps",
    levels: [
      { n: "Rem sota la taula, genolls flexionats", lo: 8, hi: 15, uni: false, cue: "Estirat sota una taula ferma, agafa la vora i porta el pit cap a la taula. Comprova abans que la taula no bolca." },
      { n: "Rem sota la taula, cames estirades", lo: 6, hi: 12, uni: false, cue: "Igual, amb les cames estirades i el cos recte." },
      { n: "Rem sota la taula amb 2 s a dalt", lo: 6, hi: 12, uni: false, cue: "Aguanta 2 segons amb el pit a prop de la taula." },
      { n: "Rem sota la taula a un braç", lo: 4, hi: 8, uni: true, cue: "Amb un sol braç, sense girar el tronc." },
    ],
  },
  coreFrontal: {
    name: "Core frontal", muscles: "Abdominals i lumbars", unit: "s", iso: true,
    levels: [
      { n: "Dead bug aguantat", lo: 20, hi: 45, uni: false, cue: "Panxa amunt, lumbar enganxada a terra, braços amunt i genolls a 90°. Estira una cama sense que la lumbar s'aixequi i aguanta." },
      { n: "Planxa", lo: 30, hi: 60, uni: false, cue: "Avantbraços i puntes dels peus, cos recte, abdomen actiu." },
      { n: "Hollow hold", lo: 20, hi: 45, uni: false, cue: "Panxa amunt, espatlles i cames lleugerament elevades, lumbar enganxada a terra." },
      { n: "Planxa amb braços avançats", lo: 20, hi: 45, uni: false, cue: "Planxa amb els colzes uns 10 cm per davant de les espatlles." },
    ],
  },
  coreLateral: {
    name: "Core lateral", muscles: "Oblics i adductors", unit: "s", iso: true,
    levels: [
      { n: "Planxa lateral", lo: 20, hi: 45, uni: true, cue: "Sobre l'avantbraç, cos recte de cap a peus." },
      { n: "Copenhagen curt", lo: 15, hi: 30, uni: true, cue: "Planxa lateral amb el genoll de dalt sobre el sofà i la cama de baix a l'aire." },
      { n: "Copenhagen llarg", lo: 15, hi: 30, uni: true, cue: "Igual, però amb el peu de dalt sobre el sofà." },
    ],
  },
  // Isomètrics per als tendons: aguantades intenses en posicions llargues del múscul.
  // Per al tendó cal intensitat alta (≥70 %): als nivells alts s'empeny contra un obstacle fix.
  isoGenoll: {
    name: "Isomètric de genoll", muscles: "Quàdriceps i tendó rotulià", unit: "s", iso: true,
    levels: [
      { n: "Sentadilla a la paret", lo: 30, hi: 60, uni: false, cue: "Esquena a la paret i cuixes paral·leles a terra. Aguanta sense recolzar les mans a les cames." },
      { n: "Sentadilla a la paret a una cama", lo: 20, hi: 45, uni: true, cue: "Igual, amb una cama aixecada. Genoll alineat amb el peu." },
      { n: "Búlgara aguantada a baix", lo: 20, hi: 45, uni: true, cue: "Peu del darrere a la cadira. Baixa fins que el genoll del darrere gairebé toqui a terra i aguanta-hi." },
    ],
  },
  isoPanxell: {
    name: "Isomètric de panxell", muscles: "Soli i tendó d'Aquil·les", unit: "s", iso: true,
    levels: [
      { n: "Talons a una cama aguantat", lo: 20, hi: 45, uni: true, cue: "A una cama, puja els talons fins a mitja alçada i aguanta-hi, sense deixar caure el turmell." },
      { n: "Soli contra la taula", lo: 20, hi: 45, uni: false, cue: "Assegut amb els genolls a 90° sota una taula ferma. Aixeca els talons i empeny els genolls amunt contra la taula amb tota la força." },
      { n: "Empentes explosives contra la taula", lo: 10, hi: 10, uni: false, unit: "reps", sets: 4, cue: "Mateixa posició. Empeny tan fort i ràpid com puguis durant 1 s, descansa 5 s i repeteix." },
    ],
  },
  pliometria: {
    name: "Pliometria", muscles: "Rigidesa elàstica i potència", unit: "contactes", plyo: true,
    levels: [
      { n: "Salts de turmell", lo: 15, hi: 15, uni: false, cue: "Salts curts rebotant des dels turmells, genolls gairebé rectes, contacte breu." },
      { n: "Salts de sentadilla", lo: 8, hi: 8, uni: false, cue: "Mitja sentadilla i salt vertical. Aterra suau i encadena." },
      { n: "Salts de turmell a una cama", lo: 10, hi: 10, uni: true, cue: "Com els salts de turmell, a una cama." },
      { n: "Salts laterals a una cama", lo: 6, hi: 6, uni: true, cue: "Salta de costat d'una cama a l'altra i aguanta l'aterratge un segon." },
      { n: "Salts alterns", lo: 6, hi: 6, uni: true, cue: "Salts llargs alternant cames, com una carrera exagerada." },
    ],
  },
};

export const PATTERNS = Object.keys(LADDERS);

export const SESSIONS = {
  A: { name: "Cames fortes", slots: [
    { pattern: "genoll", sets: 3 }, { pattern: "maluc", sets: 3 },
    { pattern: "panxell", sets: 3 }, { pattern: "coreFrontal", sets: 2 },
  ] },
  B: { name: "Tronc, potència i tendons", slots: [
    { pattern: "empenta", sets: 3 }, { pattern: "traccio", sets: 3 },
    { pattern: "pliometria", sets: 3 }, { pattern: "isoGenoll", sets: 2 },
    { pattern: "isoPanxell", sets: 2 }, { pattern: "coreLateral", sets: 2 },
  ] },
};

/** Nivell inicial raonable per a un corredor entrenat (0-based). L'usuari el pot canviar. */
export const DEFAULT_START = {
  genoll: 1, maluc: 1, panxell: 1, empenta: 1, traccio: 0,
  coreFrontal: 1, coreLateral: 0, isoGenoll: 0, isoPanxell: 0, pliometria: 0,
};

/** Unitat efectiva d'un nivell (un nivell pot canviar la de l'escala). */
export const unitOf = (pattern, level) => LADDERS[pattern].levels[level].unit ?? LADDERS[pattern].unit;
/** Pas de progressió: +1 repetició, o +5 s a les aguantades. */
const stepOf = unit => unit === "s" ? 5 : 1;

export const RULES = {
  rirTarget: 2,          // RIR objectiu normal (es deixen 1-2 repeticions)
  rirFatigued: 3,        // RIR objectiu amb fatiga alta
  topStreakToAdvance: 2, // sessions seguides al màxim per pujar
  easyRir: 3,            // RIR a l'última sèrie que indica "massa fàcil"
  lowStreakToDrop: 2,    // sessions seguides per sota del mínim per baixar
  plyoCleanToAdvance: 3, // sessions netes de pliometria per pujar
  minRegularWeeksForPlyo: 6,
  tsbHigh: -12,          // TSB per sota d'això = fatiga alta
  acwrHigh: 1.35,        // ACWR per sobre d'això = fatiga alta
  loadFactor: 0.5,       // càrrega = minuts × RPE × factor (estimació)
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Estat inicial de progressió per a tots els moviments. */
export function initState(start = DEFAULT_START) {
  const st = {};
  for (const p of PATTERNS) {
    const max = LADDERS[p].levels.length - 1;
    st[p] = { level: clamp(start[p] ?? 0, 0, max), topStreak: 0, lowStreak: 0, cleanCount: 0, lastReps: null };
  }
  return st;
}

/** Afegeix els moviments nous a un estat desat abans que existissin. No modifica l'entrada. */
export function withAllPatterns(state) {
  const missing = PATTERNS.filter(p => !state || !state[p]);
  if (!missing.length) return state;
  const fresh = initState();
  const out = { ...(state || {}) };
  for (const p of missing) out[p] = fresh[p];
  return out;
}

/** Fatiga a partir de la càrrega de cursa. Valors absents = sense fatiga. */
export function fatigueState({ tsb = null, acwr = null } = {}) {
  const high = (typeof tsb === "number" && tsb < RULES.tsbHigh) ||
               (typeof acwr === "number" && acwr > RULES.acwrHigh);
  return { high, reason: !high ? null :
    (typeof tsb === "number" && tsb < RULES.tsbHigh ? `TSB ${tsb.toFixed(0)}` : `ACWR ${acwr.toFixed(2)}`) };
}

function targetsFor(lv, pState, sets, unit) {
  // Primera vegada en aquest nivell: comença pel mínim del rang.
  if (!pState.lastReps || !pState.lastReps.length) return Array(sets).fill(lv.lo);
  const step = stepOf(unit), out = [];
  for (let i = 0; i < sets; i++) {
    const prev = pState.lastReps[Math.min(i, pState.lastReps.length - 1)];
    out.push(prev >= lv.hi ? lv.hi : clamp(prev + step, lv.lo, lv.hi));
  }
  return out;
}

/**
 * Prepara la sessió del dia.
 * @param {'A'|'B'} type
 * @param {object} state  estat de progressió (initState)
 * @param {{tsb?:number, acwr?:number, regularWeeks?:number, dayBeforeLong?:boolean}} ctx
 */
export function planSession(type, state, ctx = {}) {
  const def = SESSIONS[type];
  if (!def) throw new Error(`Sessió desconeguda: ${type}`);
  const fat = fatigueState(ctx);
  const plyoOk = !fat.high && (ctx.regularWeeks ?? 0) >= RULES.minRegularWeeksForPlyo;
  const notes = [];
  state = withAllPatterns(state);
  if (fat.high) notes.push(`Fatiga alta (${fat.reason}): una sèrie menys als exercicis dinàmics, deixa 3 repeticions de marge i avui no es puja de nivell. Els isomètrics es mantenen.`);
  if (!plyoOk && def.slots.some(s => s.pattern === "pliometria"))
    notes.push(fat.high ? "Avui no hi ha pliometria per la fatiga." :
      `La pliometria s'activa quan portis ${RULES.minRegularWeeksForPlyo} setmanes corrent amb regularitat.`);
  if (type === "A" && ctx.dayBeforeLong) notes.push("Demà toca la llarga: si pots, mou aquesta sessió a un altre dia.");

  const exercises = [];
  for (const slot of def.slots) {
    if (slot.pattern === "pliometria" && !plyoOk) continue;
    const lad = LADDERS[slot.pattern];
    const ps = state[slot.pattern];
    const lv = lad.levels[ps.level];
    const unit = unitOf(slot.pattern, ps.level);
    const base = lv.sets ?? slot.sets;
    // Els isomètrics cansen poc: amb fatiga es mantenen les sèries.
    const sets = fat.high && !lad.iso ? Math.max(2, base - 1) : base;
    exercises.push({
      pattern: slot.pattern, patternName: lad.name, muscles: lad.muscles,
      level: ps.level, levels: lad.levels.length, name: lv.n, cue: lv.cue,
      unit, uni: lv.uni, lo: lv.lo, hi: lv.hi, sets,
      targets: lad.plyo ? Array(sets).fill(lv.hi) : targetsFor(lv, ps, sets, unit),
      rirTarget: lad.plyo ? null : (fat.high ? RULES.rirFatigued : RULES.rirTarget),
      plyo: !!lad.plyo, iso: !!lad.iso && unit === "s",
    });
  }
  return { type, name: def.name, fatigued: fat.high, exercises, notes };
}

/**
 * Aplica el resultat d'un exercici a l'estat. No modifica l'estat d'entrada.
 * @param {object} state
 * @param {string} pattern
 * @param {{reps?:number[], rirLast?:number, pain?:boolean, quality?:'ok'|'pain'}} result
 * @param {{fatigued?:boolean}} ctx  sessió feta amb fatiga alta (no es puja)
 * @returns {{state:object, verdict:{action:string, msg:string, suggestLevel?:number}}}
 */
export function applyResult(state, pattern, result, ctx = {}) {
  const lad = LADDERS[pattern];
  if (!lad) throw new Error(`Moviment desconegut: ${pattern}`);
  const max = lad.levels.length - 1;
  state = withAllPatterns(state);
  const prev = state[pattern];
  const ps = { ...prev };
  const lv = lad.levels[ps.level];
  const next = { ...state, [pattern]: ps };
  const up = () => { ps.level = Math.min(max, ps.level + 1); ps.topStreak = 0; ps.lowStreak = 0; ps.cleanCount = 0; ps.lastReps = null; };
  const down = () => { ps.level = Math.max(0, ps.level - 1); ps.topStreak = 0; ps.lowStreak = 0; ps.cleanCount = 0; ps.lastReps = null; };

  // ── Pliometria: no es va al fracàs, es compta la qualitat ──
  if (lad.plyo) {
    if (result.quality === "pain" || result.pain) {
      const was = ps.level; down();
      return { state: next, verdict: { action: was > 0 ? "down" : "hold",
        msg: was > 0 ? `Molèstia: baixes a «${lad.levels[ps.level].n}».` : "Molèstia: mantens el nivell més fàcil. Si es repeteix, deixa la pliometria uns dies." } };
    }
    ps.cleanCount += 1;
    if (ps.cleanCount >= RULES.plyoCleanToAdvance && ps.level < max && !ctx.fatigued) {
      up();
      return { state: next, verdict: { action: "up", msg: `${RULES.plyoCleanToAdvance} sessions netes: puges a «${lad.levels[ps.level].n}».` } };
    }
    return { state: next, verdict: { action: "hold",
      msg: ps.level >= max ? "Ja ets al nivell més alt de pliometria." :
        `Sessió neta (${ps.cleanCount} de ${RULES.plyoCleanToAdvance} per pujar).` } };
  }

  const reps = (result.reps || []).filter(r => typeof r === "number" && r >= 0);
  if (!reps.length) return { state, verdict: { action: "skip", msg: "Sense dades: no canvia res." } };
  ps.lastReps = reps;

  if (result.pain) {
    ps.topStreak = 0;
    return { state: next, verdict: { action: "pain",
      msg: ps.level > 0 ? `Molèstia: no puges de nivell. Et proposo tornar a «${lad.levels[ps.level - 1].n}».` :
        "Molèstia: no puges de nivell. Si es repeteix, consulta-ho.",
      suggestLevel: ps.level > 0 ? ps.level - 1 : 0 } };
  }

  const top = reps.every(r => r >= lv.hi);
  const low = reps[0] < lv.lo;
  const rir = typeof result.rirLast === "number" ? result.rirLast : null;

  if (ctx.fatigued) {
    return { state: next, verdict: { action: "hold", msg: "Sessió amb fatiga alta: es guarda, però avui no compta per pujar." } };
  }

  if (top && rir !== null && rir >= RULES.easyRir && ps.level < max) {
    up();
    return { state: next, verdict: { action: "up", msg: `Massa fàcil: puges a «${lad.levels[ps.level].n}».` } };
  }
  if (top) {
    ps.topStreak += 1; ps.lowStreak = 0;
    if (ps.topStreak >= RULES.topStreakToAdvance && ps.level < max) {
      up();
      return { state: next, verdict: { action: "up", msg: `${RULES.topStreakToAdvance} sessions al màxim: puges a «${lad.levels[ps.level].n}».` } };
    }
    return { state: next, verdict: { action: "progress",
      msg: ps.level >= max ? "Ets al nivell més alt: mantén-lo i fes-lo més lent o més intens." :
        `Al màxim del rang. Una sessió més així i puges.` } };
  }
  ps.topStreak = 0;
  if (low) {
    ps.lowStreak += 1;
    if (ps.lowStreak >= RULES.lowStreakToDrop && ps.level > 0) {
      down();
      return { state: next, verdict: { action: "down", msg: `Dues sessions per sota del mínim: baixes a «${lad.levels[ps.level].n}».` } };
    }
    return { state: next, verdict: { action: "hold", msg: `Per sota del mínim (${lv.lo}). Si torna a passar, baixaràs un nivell.` } };
  }
  ps.lowStreak = 0;
  return { state: next, verdict: { action: "progress", msg: "Bé. La propera vegada, una repetició més a les sèries que no han arribat al màxim." } };
}

/** Càrrega estimada d'una sessió de força, en unitats comparables al TRIMP. */
export function strengthLoad(minutes, rpe, k = RULES.loadFactor) {
  if (!(minutes > 0) || !(rpe >= 0)) return 0;
  return Math.round(minutes * clamp(rpe, 0, 10) * k);
}

/** Text del rang: "8–15 per cama", "20–45 s", "15 contactes". */
export function rangeLabel(ex) {
  const side = ex.pattern.startsWith("core") || ex.pattern === "empenta" || ex.pattern === "traccio";
  const per = ex.uni ? (side ? " per costat" : " per cama") : "";
  if (ex.unit === "contactes") return `${ex.hi} contactes${per}`;
  if (ex.lo === ex.hi) return `${ex.hi}${ex.unit === "s" ? " s" : ""}${per}`;
  if (ex.unit === "s") return `${ex.lo}–${ex.hi} s${per}`;
  return `${ex.lo}–${ex.hi}${per}`;
}
