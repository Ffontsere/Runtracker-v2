// RunTracker v2 — service worker.
// Xarxa primer, i revalidant sempre: si hi ha connexió, l'app és sempre l'última versió publicada
// (GitHub Pages diu als navegadors que guardin els fitxers 10 minuts). Sense connexió, la còpia desada.
// Només els fitxers de l'app: Strava, el Worker i Open-Meteo no passen per aquí.

const CACHE = "runtracker-v2";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      // "no-cache" = pregunta al servidor si ha canviat (ETag); si no, és una resposta curta.
      const res = await fetch(req, { cache: "no-cache" });
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === "navigate") { const idx = await cache.match(new URL("./", self.registration.scope).href); if (idx) return idx; }
      throw err;
    }
  })());
});
