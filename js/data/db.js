// RunTracker v2 — base de dades al mòbil (IndexedDB).
// Una sola base "runtracker" amb un magatzem per tipus de dada. Tots els errors es propaguen:
// cap funció s'empassa un error en silenci.

export const DB_NAME = "runtracker";
export const DB_VERSION = 1;

/** Magatzems i la seva clau. */
export const STORES = {
  activities: { keyPath: "id", indexes: [["date", "date"]] }, // sortides (de Strava)
  streams: { keyPath: "id" },                                  // streams crus, cache que es pot esborrar
  strength: { keyPath: "id", indexes: [["date", "date"]] },    // sessions de força registrades
  body: { keyPath: "id", indexes: [["date", "date"]] },        // mesures del cos
  kv: { keyPath: "key" },                                      // configuració, estat de força, caches petites
};

const req2p = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const tx2p = t => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error("Transacció avortada")); });

/**
 * Obre la base de dades. `idb` permet passar una implementació per als tests.
 * @returns {Promise<DB>}
 */
export async function openDB(idb = globalThis.indexedDB, name = DB_NAME) {
  if (!idb) throw new Error("Aquest navegador no té IndexedDB: no es poden guardar dades.");
  const r = idb.open(name, DB_VERSION);
  r.onupgradeneeded = () => {
    const db = r.result;
    for (const [store, def] of Object.entries(STORES)) {
      if (db.objectStoreNames.contains(store)) continue;
      const os = db.createObjectStore(store, { keyPath: def.keyPath });
      for (const [ix, path] of def.indexes || []) os.createIndex(ix, path);
    }
  };
  const raw = await new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error("La base de dades està oberta en una altra pestanya amb una versió antiga. Tanca-la i torna-ho a provar."));
  });
  return new DB(raw);
}

export class DB {
  constructor(raw) { this.raw = raw; }
  close() { this.raw.close(); }

  async get(store, key) {
    const t = this.raw.transaction(store, "readonly");
    return req2p(t.objectStore(store).get(key));
  }
  async getAll(store) {
    const t = this.raw.transaction(store, "readonly");
    return req2p(t.objectStore(store).getAll());
  }
  /** Registres d'un magatzem amb `date` entre from i to (inclosos), ordenats per data. */
  async byDate(store, from, to) {
    const t = this.raw.transaction(store, "readonly");
    return req2p(t.objectStore(store).index("date").getAll(IDBKeyRange.bound(from, to)));
  }
  async count(store) {
    const t = this.raw.transaction(store, "readonly");
    return req2p(t.objectStore(store).count());
  }
  async put(store, value) {
    const t = this.raw.transaction(store, "readwrite");
    t.objectStore(store).put(value);
    return tx2p(t);
  }
  /** Desa molts registres en una sola transacció: o tots o cap. */
  async putMany(store, values) {
    return this.putAtomic({ [store]: values });
  }
  async delete(store, key) {
    const t = this.raw.transaction(store, "readwrite");
    t.objectStore(store).delete(key);
    return tx2p(t);
  }
  async clear(store) {
    const t = this.raw.transaction(store, "readwrite");
    t.objectStore(store).clear();
    return tx2p(t);
  }

  // ── Clau-valor ──
  async getKV(key, fallback = null) { const r = await this.get("kv", key); return r ? r.value : fallback; }
  async setKV(key, value) { return this.put("kv", { key, value, updatedAt: Date.now() }); }

  /**
   * Escriu diversos magatzems en una sola transacció atòmica. `writes` = { store: [registres] }.
   * Si alguna escriptura falla, no se'n desa cap.
   */
  async putAtomic(writes) {
    const stores = Object.keys(writes);
    const t = this.raw.transaction(stores, "readwrite");
    const done = tx2p(t);
    try {
      for (const s of stores) { const os = t.objectStore(s); for (const v of writes[s]) os.put(v); }
    } catch (e) {
      // Un registre invàlid llança l'error a l'instant: cal avortar perquè el que ja s'havia posat no es desi.
      try { t.abort(); } catch (_) { /* ja avortada */ }
      done.catch(() => {}); // l'error que interessa és `e`
      throw e;
    }
    return done;
  }
}
