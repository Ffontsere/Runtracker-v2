// RunTracker v2 — previsió d'Open-Meteo amb una cache d'1 hora a la base de dades. Mateixa crida que la v1.

const TTL = 3600000;

export function forecastUrl(lat, lng) {
  return "https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lng +
    "&hourly=temperature_2m,dew_point_2m,relative_humidity_2m,precipitation,precipitation_probability," +
    "wind_speed_10m,wind_gusts_10m,shortwave_radiation,uv_index,weather_code,is_day&forecast_days=7&timezone=auto";
}

/** Converteix la resposta d'Open-Meteo a una llista d'hores. */
export function parseForecast(d) {
  const H = d && d.hourly;
  if (!H || !H.time) throw new Error("La previsió ha arribat sense dades horàries.");
  return H.time.map((t, i) => ({
    t, temp: H.temperature_2m[i], dp: H.dew_point_2m[i], rh: H.relative_humidity_2m[i], prec: H.precipitation[i],
    pprob: H.precipitation_probability[i], wind: H.wind_speed_10m[i], gust: H.wind_gusts_10m[i],
    rad: H.shortwave_radiation[i], uv: H.uv_index[i], code: H.weather_code[i], day: H.is_day[i],
  }));
}

/**
 * Previsió per a la ubicació del Perfil. Fa servir la cache si té menys d'1 hora i és del mateix lloc.
 * @returns {Promise<{ts, lat, lng, hours, cached:boolean} | null>} null si no hi ha ubicació.
 */
export async function getForecast(db, { fetchImpl = fetch, now = Date.now(), force = false } = {}) {
  const s = (await db.getKV("settings")) || {};
  if (s.wxLat == null || s.wxLng == null) return null;
  const c = await db.getKV("wxfc");
  if (!force && c && now - c.ts < TTL && c.lat === s.wxLat && c.lng === s.wxLng) return { ...c, cached: true };
  let r;
  try { r = await fetchImpl(forecastUrl(s.wxLat, s.wxLng)); }
  catch (e) { throw new Error("No s'ha pogut baixar la previsió: " + e.message); }
  if (!r.ok) throw new Error("Open-Meteo ha respost " + r.status + ".");
  const fc = { ts: now, lat: s.wxLat, lng: s.wxLng, hours: parseForecast(await r.json()) };
  await db.setKV("wxfc", fc);
  return { ...fc, cached: false };
}

/** Desa la ubicació (arrodonida a ~10 m, com la v1). */
export async function setLocation(db, lat, lng) {
  const s = (await db.getKV("settings")) || {};
  await db.setKV("settings", { ...s, wxLat: Math.round(lat * 1e4) / 1e4, wxLng: Math.round(lng * 1e4) / 1e4, wxLocTs: Date.now() });
}

/** Demana la posició al navegador. Error amb un missatge que es pot mostrar. */
export function askPosition(geo = globalThis.navigator && navigator.geolocation) {
  return new Promise((res, rej) => {
    if (!geo) return rej(new Error("Aquest navegador no permet saber la ubicació."));
    geo.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude }), e => {
      rej(new Error(e.code === 1 ? "Has denegat el permís d'ubicació. Activa'l als permisos del navegador per a aquesta web."
        : e.code === 3 ? "El GPS ha trigat massa. Torna-ho a provar." : "No s'ha pogut saber la ubicació."));
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
  });
}

// ── Temps del dia de cada sortida (per corregir el VO₂ per calor i altitud) ──

/** Les dades dels últims 5 dies encara no són a l'arxiu: es demanen a la previsió (que guarda el passat recent). */
export function historyUrl(a, now = Date.now()) {
  const date = a.startTime.slice(0, 10);
  const recent = (now - Date.parse(date + "T12:00:00")) / 864e5 <= 5;
  const base = recent ? "https://api.open-meteo.com/v1/forecast" : "https://archive-api.open-meteo.com/v1/archive";
  return `${base}?latitude=${a.lat.toFixed(3)}&longitude=${a.lng.toFixed(3)}&start_date=${date}&end_date=${date}` +
    "&hourly=temperature_2m,dew_point_2m,wind_speed_10m&timezone=auto&elevation=nan";
}

/**
 * Temperatura, punt de rosada, vent i altitud a l'hora de començar (v1: fetchActTemp).
 * Retorna { t, dp, elev, w } o null si Open-Meteo no en té.
 */
export async function fetchActivityWx(a, { fetchImpl = fetch, now = Date.now() } = {}) {
  const hour = +a.startTime.slice(11, 13);
  const r = await fetchImpl(historyUrl(a, now));
  if (!r.ok) throw new Error("Open-Meteo ha respost " + r.status + ".");
  const d = await r.json();
  const H = d && d.hourly;
  if (!H || !H.temperature_2m || !H.temperature_2m.length || H.temperature_2m[Math.min(hour, H.temperature_2m.length - 1)] == null) return null;
  const i = Math.min(hour, H.temperature_2m.length - 1);
  let elev = null;
  try {
    const er = await fetchImpl(`https://api.open-meteo.com/v1/elevation?latitude=${a.lat.toFixed(4)}&longitude=${a.lng.toFixed(4)}`);
    if (er.ok) { const ed = await er.json(); if (ed && ed.elevation && ed.elevation.length) elev = Math.round(ed.elevation[0]); }
  } catch { /* sense altitud: es corregeix només per calor */ }
  return {
    t: Math.round(H.temperature_2m[i]),
    dp: H.dew_point_2m && H.dew_point_2m[i] != null ? Math.round(H.dew_point_2m[i]) : null,
    elev,
    w: H.wind_speed_10m && H.wind_speed_10m[i] != null ? Math.round(H.wind_speed_10m[i]) : null,
  };
}

/**
 * Busca el temps de les sortides que no en tenen i recalcula el VO₂ d'aquestes.
 * Una sortida sense dades a Open-Meteo es marca amb null per no tornar-la a demanar.
 * @returns {Promise<{done:number, empty:number, failed:number, remaining:number}>}
 */
export async function fillActivityWx(db, { fetchImpl = fetch, now = Date.now(), max = 40, sleep = ms => new Promise(r => setTimeout(r, ms)), onProgress = () => {} } = {}) {
  const { missingWx } = await import("../engine/climate.js");
  const { vo2ForActivity } = await import("../engine/physio.js");
  const acts = await db.getAll("activities");
  const settings = (await db.getKV("settings")) || {};
  const cache = (await db.getKV("tempCache")) || {};
  const queue = missingWx(acts, cache, now);
  let done = 0, empty = 0, failed = 0;
  const updated = [];
  for (const a of queue.slice(0, max)) {
    try {
      const wx = await fetchActivityWx(a, { fetchImpl, now });
      cache[a.id] = wx;
      if (wx) { done++; updated.push({ ...a, ...vo2ForActivity(a, settings, cache) }); } else empty++;
    } catch { failed++; }
    onProgress(done + empty + failed, Math.min(max, queue.length));
    await sleep(250);
  }
  await db.putAtomic({ kv: [{ key: "tempCache", value: cache, updatedAt: now }], activities: updated });
  return { done, empty, failed, remaining: Math.max(0, queue.length - done - empty) };
}
