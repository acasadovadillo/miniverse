// El relieve ya calculado, guardado en el navegador (IndexedDB) para no volver a calcularlo: al recargar, al pasar del
// menú a la partida, al volver a una zona o al salir de una cueva, las alturas, el anillo y los biomas de cada bloque
// (ground.js: blockHeights) salen de aquí en un par de milisegundos en vez de calcularse. Lo usa solo el hilo aparte
// (genworker.js). Va en una base propia ('pueblo-brotes-relieve', con el prefijo del juego para la limpieza), no en la de
// las partidas (db.js): así no le cambia la versión ni le cierra la conexión a otra pestaña en mitad de una partida.
// La clave lleva la huella del relieve (groundTag: la semilla y el código), y lo guardado es idéntico bit a bit a lo
// calculado (sin redondear nada: si no, saldrían grietas entre un bloque guardado y uno nuevo). Lo construido nunca
// entra aquí: el allanado lo hace el hilo principal (terrain.js: padded). Si algo falla, se calcula como siempre.
import { BLOCK } from './ground.js';

const DB = 'pueblo-brotes-relieve', STORE = 'bloques';
const N = BLOCK + 1, M = N + 2;
// Lo que ocupa un bloque sin comprimir: alturas y anillo (float32) y biomas de las esquinas y los centros (un byte)
const FLOATS = N * N + 4 * N, BYTES = FLOATS * 4 + M * M + BLOCK * BLOCK;
const FLUSH_MS = 1000, FLUSH_N = 8;          // se escribe en tandas: cada segundo o a las 8 entradas
const TOUCH_MS = 6 * 3600e3;                 // la fecha de uso solo se renueva si tiene más de 6 horas (casi sin escrituras)
const QUOTA_MS = 60e3;                       // cada cuánto se mira lo que queda de sitio en el disco

// Las alturas, revueltas por bytes (todos los primeros bytes de cada número, luego los segundos…): el exponente y el
// principio de la mantisa se repiten mucho, y así el compresor los aprovecha. Es reversible y exacto
function pack(d) {
  const raw = new Uint8Array(BYTES), f = new Float32Array(FLOATS);
  f.set(d.heights, 0); f.set(d.edge, N * N);
  const b = new Uint8Array(f.buffer);
  for (let k = 0; k < 4; k++) for (let i = 0; i < FLOATS; i++) raw[k * FLOATS + i] = b[i * 4 + k];
  raw.set(d.corners, FLOATS * 4); raw.set(d.centers, FLOATS * 4 + M * M);
  return raw;
}
function unpack(raw) {
  if (raw.byteLength !== BYTES) return null;
  const f = new Float32Array(FLOATS), b = new Uint8Array(f.buffer);
  for (let k = 0; k < 4; k++) for (let i = 0; i < FLOATS; i++) b[i * 4 + k] = raw[k * FLOATS + i];
  const heights = f.slice(0, N * N), edge = f.slice(N * N);
  for (const v of heights) if (!Number.isFinite(v)) return null;
  return { heights, edge, corners: raw.slice(FLOATS * 4, FLOATS * 4 + M * M), centers: raw.slice(FLOATS * 4 + M * M), n: N, m: M };
}
// (¿comprime el navegador en 'deflate-raw'? Chrome 80-102 tiene las clases pero no ese formato, y entonces lanzan al crearlas)
const ZIP = (() => { try { new CompressionStream('deflate-raw'); new DecompressionStream('deflate-raw'); return true; } catch { return false; } })();
// La forma de lo guardado (pack, unpack y su tamaño) va en la clave junto a la huella del relieve: si cambia, lo de antes
// ya no se lee como si fuera de ahora (y la limpieza de cleanOld se lo lleva, como lo de otra versión del relieve)
const FORMAT = (() => { let h = 2166136261; for (const c of String(pack) + String(unpack) + BYTES) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0).toString(36); })();
const through = (u8, stream) => new Response(new Blob([u8]).stream().pipeThrough(stream)).arrayBuffer().then(b => new Uint8Array(b));
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = tx => new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = tx.onabort = () => rej(tx.error); });

// Abre la base (como mucho 800 ms: si otra pestaña la bloquea o el navegador no deja, se sigue sin guardar nada).
// tag: la huella de ahora (groundTag). owner: el hilo que limpia lo de otras versiones del relieve. max: cuántos bloques
// se guardan como mucho (los menos usados se van)
export function openGroundCache({ tag, owner = false, max = 1024 }) {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
    let settled = false;
    const end = v => { if (!settled) { settled = true; resolve(v); } else if (v) v.close(); };
    setTimeout(() => end(null), 800);
    let r;
    try { r = indexedDB.open(DB, 1); } catch { end(null); return; }
    r.onupgradeneeded = () => { const s = r.result.createObjectStore(STORE, { keyPath: 'k' }); s.createIndex('t', 't'); };
    r.onblocked = () => end(null);
    r.onerror = () => end(null);
    r.onsuccess = () => {
      const db = r.result;
      if (settled) { db.close(); return; }
      end(new GroundCache(db, tag + '.f' + FORMAT, owner, max));
    };
  });
}

class GroundCache {
  constructor(db, tag, owner, max) {
    this.db = db; this.tag = tag; this.max = max; this.off = false;
    this.queue = []; this.timer = 0; this.writing = false;
    this.full = false; this.quotaAt = 0;
    this.stats = { hits: 0, misses: 0, puts: 0, bytes: 0, removed: 0 };
    db.onversionchange = () => { db.close(); this.off = true; };   // (otra pestaña con otra versión de la base: se deja)
    if (owner) this.cleanLater();
  }
  key(bx, bz) { return `${this.tag}|${bx},${bz}`; }
  close() { this.off = true; try { this.db.close(); } catch {} }

  // Varios bloques de una vez (una sola transacción): each(b, datos) para cada { bx, bz } de la lista, en su orden (el de
  // la lista: lo más cercano, primero) y en cuanto está listo; null si no está o no vale (entonces se calcula)
  async get(list, each) {
    if (this.off || !list.length) return;
    const tx = this.db.transaction(STORE, 'readonly'), st = tx.objectStore(STORE), now = Date.now();
    const recs = await Promise.all(list.map(b => req(st.get(this.key(b.bx, b.bz))).catch(() => null)));
    // (se descomprimen de uno en uno: así el primero sale enseguida, en vez de todos a la vez al final)
    for (let i = 0; i < list.length; i++) {
      const rec = recs[i], b = list[i];
      if (!rec) { this.stats.misses++; each(b, null); continue; }
      let d = null;
      const t0 = performance.now();
      try { d = unpack(rec.z ? await through(new Uint8Array(rec.b), new DecompressionStream('deflate-raw')) : new Uint8Array(rec.b)); } catch { d = null; }
      if (!d) { this.stats.misses++; this.enqueue({ k: rec.k, del: true }); each(b, null); continue; }   // (estropeado o de otra forma: fuera, y se calcula)
      this.stats.hits++;
      if (now - rec.t > TOUCH_MS) this.enqueue({ ...rec, t: now });   // (se ha usado: no es de lo primero que se va)
      d.ms = performance.now() - t0;   // (lo que ha costado sacarlo: descomprimir y deshacer el revuelto)
      each(b, d);
    }
  }
  // Guardar un bloque recién calculado (d: lo de blockHeights; se copia aquí, antes de que se transfiera al hilo principal)
  // Nunca lanza: si falla guardar, el bloque se manda igual (genworker.js) y la próxima vez se calcula
  put(bx, bz, d) {
    if (this.off || this.full) return;
    try {
      const raw = pack(d), k = this.key(bx, bz), t = Date.now();
      (ZIP ? through(raw, new CompressionStream('deflate-raw')) : Promise.resolve(raw))
        .then(b => this.enqueue({ k, t, z: ZIP ? 1 : 0, b: b.buffer.byteLength === b.byteLength ? b.buffer : b.slice().buffer }), () => {});
    } catch { /* (se sigue sin guardar este) */ }
  }
  enqueue(rec) {
    this.queue.push(rec);
    if (this.queue.length >= FLUSH_N) this.flush();
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), FLUSH_MS);
  }
  // Escribir lo pendiente en una sola transacción (ya comprimido: si se espera a algo que no es de la base dentro de una
  // transacción, se cierra sola), y luego quitar lo menos usado si hay demasiado
  async flush() {
    clearTimeout(this.timer); this.timer = 0;
    if (this.writing || !this.queue.length || this.off) return;
    this.writing = true;
    try {
      await this.checkQuota();
      const list = this.queue.splice(0), tx = this.db.transaction(STORE, 'readwrite'), st = tx.objectStore(STORE);
      for (const r of list) {
        if (r.del) { st.delete(r.k); continue; }
        if (this.full) continue;
        st.put(r); this.stats.puts++; this.stats.bytes += r.b.byteLength;
      }
      await done(tx);
      await this.evict();
    } catch { /* (sin sitio o la base cerrada: se sigue sin guardar) */ } finally {
      this.writing = false;
      if (this.queue.length && !this.timer) this.timer = setTimeout(() => this.flush(), FLUSH_MS);
    }
  }
  // El origen (github.io) es compartido con otros proyectos y el sitio que da el navegador es «si cabe»: si se llena, se
  // lleva el origen entero, partidas incluidas. Por eso, con más de la mitad usado, no se guarda más relieve
  async checkQuota() {
    if (performance.now() < this.quotaAt || !navigator.storage?.estimate) return;
    this.quotaAt = performance.now() + QUOTA_MS;
    const e = await navigator.storage.estimate().catch(() => null);
    this.full = !!(e && e.quota && e.usage > e.quota * 0.5);
  }
  // Si hay más de max bloques, se van los que hace más tiempo que no se usan, hasta quedar en el 90 %
  async evict() {
    const tx0 = this.db.transaction(STORE, 'readonly'), count = await req(tx0.objectStore(STORE).count());
    if (count <= this.max) return;
    let extra = count - Math.floor(this.max * 0.9);
    const tx = this.db.transaction(STORE, 'readwrite'), cur = tx.objectStore(STORE).index('t').openKeyCursor();
    cur.onsuccess = () => { const c = cur.result; if (!c || extra <= 0) return; tx.objectStore(STORE).delete(c.primaryKey); this.stats.removed++; extra--; c.continue(); };
    await done(tx);
  }
  // Lo de otras versiones del relieve con esta misma semilla ya no vuelve a valer nunca: fuera (lo de otras semillas se
  // deja: entra en el tope como lo demás). Las claves van ordenadas y empiezan por la huella: son los dos tramos de esta
  // semilla de antes y de después de los míos, dos borrados por rango sin recorrer nada
  async cleanOld() {
    if (this.off) return;
    const seed = this.tag.slice(0, this.tag.indexOf('.') + 1), mine = this.tag + '|', END = '\uffff';
    const tx = this.db.transaction(STORE, 'readwrite'), st = tx.objectStore(STORE);
    st.delete(IDBKeyRange.bound(seed, mine, false, true));
    st.delete(IDBKeyRange.bound(mine + END, seed + END, true, false));
    await done(tx);
  }
  // (unos segundos después de abrir: una escritura en la tabla haría esperar a las lecturas del arranque, que son las que
  // corren prisa)
  cleanLater(ms = 8000) { setTimeout(() => this.cleanOld().catch(() => {}), ms); }
  async count() { return req(this.db.transaction(STORE, 'readonly').objectStore(STORE).count()); }
}
