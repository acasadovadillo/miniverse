// El hilo aparte que calcula el suelo (ver ground.js): las alturas de cada bloque de terreno, los biomas de sus
// casillas y los píxeles de la textura de cada trozo. El juego le pide los trabajos (terrain.js) con una prioridad
// (lo más cercano a la cámara, antes) y le avisa de los que ya no hacen falta; él los va haciendo de uno en uno y
// devuelve los números, sin copiarlos (transferidos). Así el hilo del juego no se para al estrenar terreno.
// El relieve ya calculado se guarda en el navegador (groundcache.js): un bloque guardado no pasa por la cola, sale en
// cuanto se lee (un par de milisegundos), y solo se calcula lo que nunca se ha visto.
import { WorldGen, WORLD_SEED, CHUNK } from './gen.js';
import { setProjects, setFamilyHouse } from './village.js';
import { blockHeights, blockNormals, blockColors, paintPixels, groundTag, BLOCK } from './ground.js';
import { openGroundCache } from './groundcache.js';
import { rasterTile, TILE } from './contact.js';

// (?relieve=0 en la dirección del hilo: sin guardar nada; ?relieve-max=N: cuántos bloques como mucho. Ver terrain.js)
const OPT = new URLSearchParams(self.location?.search || ''), CACHE = OPT.get('relieve') !== '0', MAX = +OPT.get('relieve-max') || 1024;
let gen = null, tag = '';
let cache = null, cacheDb = null, cacheTag = '', cleaned = false;   // (cache: la promesa de abrir la base; cacheDb: ya abierta)
const queue = [];   // trabajos pendientes: { t: 'block' | 'paint' | …, id, pri, … }
// (a igual prioridad, primero la forma, luego la pintura y luego lo demás: terrain.js da a los bloques que hacen falta
// para empezar a jugar una prioridad menor que la de cualquier pintura)
const RANK = { block: 0, paint: 1, ao: 2 };
const waiting = new Map(), reading = new Set(), gone = new Set();   // bloques esperando a la caché, los que se están leyendo y los quitados mientras
const stats = { calc: 0, msCalc: 0, hits: 0, msHit: 0 };
let pumping = false, batching = false;

// El mundo es siempre el mismo (WORLD_SEED): se prepara al arrancar el hilo y la base se abre ya, mientras el juego aún
// está empezando la partida; así, cuando llegan los primeros bloques, lo guardado se lee sin esperar a nada
useSeed(WORLD_SEED);

onmessage = e => {
  const m = e.data;
  if (m.t === 'init') {
    setProjects(m.projects); setFamilyHouse(m.family);
    useSeed(m.seed);
    // (el primer hilo limpia lo guardado de otras versiones del relieve, una vez y pasados unos segundos: ver cleanLater)
    if (m.owner && !cleaned && cache) { cleaned = true; cache.then(c => c?.cleanLater()).catch(() => {}); }
  } else if (m.t === 'village') { setProjects(m.projects); setFamilyHouse(m.family); gen?.fields.clear(); }
  else if (m.t === 'block') {
    if (cache) { waiting.set(m.id, m); if (!batching) { batching = true; setTimeout(readBatch, 0); } }
    else { queue.push(m); pump(); }
  } else if (m.t === 'paint' || m.t === 'ao') { queue.push(m); pump(); }
  else if (m.t === 'drop') {
    const ids = new Set(m.ids);
    for (let i = queue.length - 1; i >= 0; i--) if (ids.has(queue[i].id)) queue.splice(i, 1);
    for (const id of ids) { waiting.delete(id); if (reading.has(id)) gone.add(id); }
  }
};

// El generador y la huella del relieve para una semilla, y su base abierta (una por huella: el menú y la partida tienen
// el mismo mundo y la comparten)
function useSeed(seed) {
  if (gen?.seed === (seed | 0)) return;
  gen = new WorldGen(seed); tag = groundTag(gen);
  if (!CACHE || cacheTag === tag) return;
  cache?.then(c => c?.close());
  cacheTag = tag; cacheDb = null;
  const c = openGroundCache({ tag, max: MAX });
  cache = c; c.then(v => { if (cache !== c) return; if (v) cacheDb = v; else cache = null; });
}

// Los bloques pedidos en el mismo momento se leen juntos (una transacción) y cada uno se manda en cuanto está; los que
// no están, a la cola de siempre
function readBatch() {
  batching = false;
  const list = [...waiting.values()].sort((a, b) => a.pri - b.pri), c = cache, t = tag;
  waiting.clear();
  if (!list.length) return;
  if (!c) { for (const m of list) queue.push(m); pump(); return; }
  for (const m of list) reading.add(m.id);
  const finish = (m, d) => {
    if (!reading.delete(m.id)) return;
    if (gone.delete(m.id)) return;
    if (!d || t !== tag) { queue.push(m); pump(); return; }
    const t1 = performance.now();
    d.normals = blockNormals(d.heights, d.edge, d.n);
    d.water = d.heights.some(h => h < 0);
    stats.hits++; stats.msHit += (d.ms || 0) + performance.now() - t1;   // (lo que cuesta: descomprimir y las normales)
    post(m, d, true);
  };
  c.then(db => db?.get(list, finish)).catch(() => {}).then(() => {
    for (const m of list) finish(m, null);   // (lo que no ha salido de la base, por lo que sea: a calcular)
  });
}

function post(m, d, cached) {
  const colors = blockColors(gen, m.bx, m.bz, m.season);
  const { heights, edge, normals, water, corners, centers, n, m: mm } = d;
  postMessage({ t: 'block', id: m.id, bx: m.bx, bz: m.bz, heights, edge, normals, water, corners, m: mm, centers, w: BLOCK, n, colors, cached, stats },
    [heights.buffer, edge.buffer, normals.buffer, corners.buffer, centers.buffer, colors.buffer]);
}

// Un trabajo cada vez, dejando entre uno y otro que lleguen mensajes (para quitar trabajos o cambiar prioridades). Si
// uno falla, la cola sigue (si no, se quedaría parada para siempre y no llegaría nada más de este hilo)
function pump() { if (!pumping) { pumping = true; setTimeout(step, 0); } }
function step() {
  // (la sombra de contacto no necesita el generador: lo que no sea eso espera a que lo haya)
  if (!queue.length || (!gen && !queue.some(q => q.t === 'ao'))) { pumping = false; return; }
  let m = null;
  try {
    queue.sort((a, b) => a.pri - b.pri || RANK[a.t] - RANK[b.t]);
    m = gen ? queue.shift() : queue.splice(queue.findIndex(q => q.t === 'ao'), 1)[0];
    if (m.t === 'ao') {
      // La sombra de contacto de unos trozos de un bloque: las formas ya vienen juntas (contact3d.js); aquí, los píxeles
      const pixels = m.tiles.map(ti => rasterTile(m.shapes, m.x0 + (ti % 4) * CHUNK, m.z0 + ((ti / 4) | 0) * CHUNK, new Uint8Array(TILE * TILE * 2)));
      postMessage({ t: 'ao', id: m.id, bx: m.bx, bz: m.bz, tiles: m.tiles, seqs: m.seqs, pixels }, pixels.map(p => p.buffer));
    } else if (m.t === 'block') {
      const t0 = performance.now(), d = blockHeights(gen, m.bx, m.bz);
      stats.calc++; stats.msCalc += performance.now() - t0;
      // (a guardar: put copia los números en el momento, porque luego se transfieren al hilo principal y aquí se quedan
      // vacíos; si la base aún se está abriendo, se copian ya y se guardan al abrirse. Guardar nunca impide mandarlo)
      try {
        if (cacheDb) cacheDb.put(m.bx, m.bz, d);
        else if (cache) { const copy = { heights: d.heights.slice(), edge: d.edge.slice(), corners: d.corners.slice(), centers: d.centers.slice() }; cache.then(c => c?.put(m.bx, m.bz, copy)).catch(() => {}); }
      } catch { /* (sin guardar) */ }
      post(m, d, false);
    } else {
      const pixels = paintPixels(gen, m.cx, m.cy, m.season);
      postMessage({ t: 'paint', id: m.id, bx: m.bx, bz: m.bz, ci: m.ci, cj: m.cj, season: m.season, pixels }, [pixels.buffer]);
    }
  } catch (e) {
    // (el juego lo hace él: ver terrain.js, onResult)
    console.warn('Suelo (hilo aparte): un trabajo ha fallado', e);
    if (m) postMessage({ t: 'fallo', job: m.t, id: m.id, bx: m.bx, bz: m.bz, ci: m.ci, cj: m.cj, season: m.season, tiles: m.tiles });
  }
  finally { setTimeout(step, 0); }
}
