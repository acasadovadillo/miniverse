// Base de datos del navegador (IndexedDB). Cabe mucho más que en localStorage,
// que es lo que hace falta cuando el mundo infinito empiece a guardar cambios.
const NAME = 'pueblo-brotes';
const STORES = {
  accounts: { keyPath: 'id' },
  saves: { keyPath: 'accountId' },
  chunks: {},   // cambios del jugador en cada trozo del mundo (desde la fase 2)
  vaults: {},   // la partida cifrada de cada cuenta (como <usuario>-miniverse-data.enc), por usuario
};
let opening = null;

// Abre la base de datos y crea las tablas que falten (si falta alguna, sube la versión para poder crearla)
function openVersion(version) {
  return new Promise((resolve, reject) => {
    const req = version ? indexedDB.open(NAME, version) : indexedDB.open(NAME);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, opts] of Object.entries(STORES)) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, opts);
    };
    req.onsuccess = () => {
      const db = req.result;
      // Si otra pestaña necesita actualizar la base de datos, cerramos esta conexión para no bloquearla
      db.onversionchange = () => { db.close(); opening = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}
function open() {
  opening ||= openVersion().then(db => {
    if (Object.keys(STORES).every(n => db.objectStoreNames.contains(n))) return db;
    const next = db.version + 1;
    db.close();
    return openVersion(next);
  });
  return opening;
}

async function run(store, mode, action) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const prefixRange = prefix => IDBKeyRange.bound(prefix, prefix + '￿');

export const db = {
  get: (store, key) => run(store, 'readonly', s => s.get(key)),
  put: (store, value, key) => run(store, 'readwrite', s => s.put(value, key)),
  del: (store, key) => run(store, 'readwrite', s => s.delete(key)),
  count: store => run(store, 'readonly', s => s.count()),
  // Todas las entradas cuya clave empieza por `prefix`, como [clave, valor]
  async entries(store, prefix) {
    const out = [];
    await run(store, 'readonly', s => {
      const req = s.openCursor(prefixRange(prefix));
      req.onsuccess = () => { const c = req.result; if (c) { out.push([c.key, c.value]); c.continue(); } };
      return req;
    });
    return out;
  },
  delPrefix: (store, prefix) => run(store, 'readwrite', s => s.delete(prefixRange(prefix))),
};
