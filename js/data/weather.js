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
