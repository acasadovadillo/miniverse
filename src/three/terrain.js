// Suelo del mundo en 3D, en bloques de 4 × 4 trozos (64 casillas de lado) alrededor de la cámara. Cada bloque
// es una malla de un vértice por casilla, hundida donde hay agua (mar, lagos, el estanque del pueblo), y una
// textura pintada desde arriba con los mismos colores que el suelo del juego en 2D: el bioma con su paleta
// de la estación, sus manchas, y el camino y la orilla del estanque del pueblo. Encima, un detalle de briznas
// o de piedrecitas que no se repite a la vista. El agua es una malla por bloque a ras de WATER_Y con la profundidad
// en cada vértice (para el color, la espuma y el borde suave) y, donde aún no hay bloque, un plano que sigue a la cámara.
// Los números (alturas, biomas y píxeles: ground.js) los calcula un hilo aparte (genworker.js), lo más cercano
// primero; aquí solo se hacen las mallas (unas pocas por fotograma) y se suben las texturas. Sin hilos aparte, se calcula
// aquí poco a poco. El relieve calculado se guarda en el navegador (groundcache.js) y al volver sale de ahí al momento.
import * as THREE from 'three';
import { CHUNK } from '../world/gen.js';
import * as village from '../world/village.js';
import { BLOCK, PX, groundSmooth, blockHeights, blockNormals, edgeAt, blockColors, paintPixels } from '../world/ground.js';
import { grassDetail, soilDetail, rockDetail, meanOf } from './textures.js';
import { mat } from './geo.js';
import { PAL, SUELO_V2 } from '../arte.js';
import { ContactField, injectContact, contactKey } from './contact3d.js';
// (solo lo usa el hilo aparte, pero se carga también aquí para que index.html lo cuente entre lo que vuelve a pedir sin
// caché al publicar otra versión: lo que carga un hilo no sale en la lista de lo cargado por la página. No hace nada al
// cargarse)
import '../world/groundcache.js';

export { BLOCK };
const RADIUS = 2;                       // bloques alrededor del de la cámara (5 × 5)
export const WATER_Y = -0.12;
// El clima en el suelo y el agua: WET, de 0 a 1, cuánto ha llovido (oscurece y abrillanta el suelo, y se seca
// despacio); RAIN, de 0 a 1, lo que llueve ahora (los círculos de las gotas en el agua). Los pone engine.js
export const WET = { value: 0 }, RAIN = { value: 0 };
// La versión publicada (la meta de index.html; en las páginas de prueba sin ella, ninguna)
const VERSION = (typeof document !== 'undefined' && document.querySelector('meta[name="miniverse-version"]')?.content) || '';
const WORKERS = Math.min(2, Math.max(1, (navigator.hardwareConcurrency || 2) - 1));
// El relieve guardado: ?relieve=0 lo apaga (todo se calcula, como antes) y ?relieve-max=N cambia cuántos bloques se
// guardan como mucho (para las pruebas)
const URLQ = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const CACHE = URLQ.get('relieve') !== '0', CACHE_MAX = +URLQ.get('relieve-max') || 1024;
const PAD_SQ = 8;                       // (padded: el lado de los cuadrados por los que se pregunta si hay algo que allanar)
const BUILD_MS = 3;                     // lo que se dedica como mucho a hacer mallas de bloques nuevos en cada fotograma

const allChunks = () => { const l = []; for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) l.push([i, j]); return l; };

export class Terrain {
  constructor(scene) {
    this.scene = scene;
    this.blocks = new Map();      // "bx,bz" → { mesh, tex, ctx, heights, season, todo, painted }
    this.pending = new Map();     // "bx,bz" → id del trabajo pedido al hilo aparte (y aún sin respuesta)
    this.jobs = new Map();        // id → { kind, key, worker }
    this.gen = null;
    this.season = -1;
    this.nextId = 1;
    this.arrived = [];            // bloques que ya han llegado del hilo aparte, por hacer su malla (unos pocos por fotograma)
    this.stats = { calc: 0, msCalc: 0, hits: 0, msHit: 0, built: 0, msBuild: 0, padded: 0, msPad: 0 };   // (para F3 y el banco; padded: los allanados)
    this.workerStats = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.water = makeWater();
    scene.add(this.water.group);
    this.world = null;            // el mundo de la partida (para allanar el suelo junto a lo construido: padK); lo pone engine.js
    this.padCheck = 0;
    this.padV = 0;                // cuántas veces se ha rehecho la forma de un bloque (remesh: lo de encima mira padStamp)
    this.workers = this.startWorkers();
    // (la sombra de contacto de lo que hay encima del suelo: una textura del mundo que leen el suelo, la hierba y los suelos
    // de las casas; se pinta en estos mismos hilos y se rehace donde algo cambia. Ver contact3d.js)
    this.contact = new ContactField(this);
    village.onVillageChange(() => this.villageChanged());
  }
  // Los hilos aparte (si el navegador los tiene; si no, todo se hace aquí)
  startWorkers() {
    if (typeof Worker === 'undefined') return [];
    try {
      const list = [];
      for (let i = 0; i < WORKERS; i++) {
        // (con la versión en la dirección: index.html solo vuelve a pedir sin caché lo que carga la página, y este archivo lo
        // carga solo el hilo; uno viejo en caché con lo de ahora podría no arrancar)
        // (y lo del relieve guardado, que el hilo necesita al arrancar: abre la base antes de que se le pida nada)
        const extra = (CACHE ? '' : '&relieve=0') + (CACHE_MAX !== 1024 ? `&relieve-max=${CACHE_MAX}` : '') + (SUELO_V2 ? '&suelo=v2' : '');   // (y el suelo de antes: ver arte.js)
        const w = new Worker(new URL('../world/genworker.js?v=' + encodeURIComponent(VERSION) + extra, import.meta.url), { type: 'module' });
        w.onmessage = e => this.onResult(e.data, i);
        w.onerror = e => { console.warn('Suelo: el hilo aparte ha fallado; se calcula aquí', e.message); this.workers = []; this.pending.clear(); this.jobs.clear(); this.arrived.length = 0; };
        list.push(w);
      }
      return list;
    } catch (e) { console.warn('Suelo: sin hilo aparte', e); return []; }
  }
  villageChanged() {
    const m = { t: 'village', projects: village.getProjects(), family: village.familyHouse() };
    for (const w of this.workers) w.postMessage(m);
    this.gen?.fields.clear();
    for (const b of this.blocks.values()) b.stale = true;
    this.contact.villageChanged();   // (las casas del pueblo: otras formas)
  }
  // El mundo cambió (otra partida, el menú): fuera todo lo hecho
  reset(gen) {
    for (const b of this.blocks.values()) this.dispose(b);
    this.blocks.clear();
    this.dropAll();
    this.contact.reset();
    this.gen = gen;
    this.season = gen.season;
    // (owner: el primer hilo es el que limpia lo guardado de otras versiones del relieve)
    this.workers.forEach((w, i) => w.postMessage({ t: 'init', seed: gen.seed, projects: village.getProjects(), family: village.familyHouse(), owner: i === 0 }));
  }
  dispose(b) { this.group.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); b.tex.dispose(); if (b.waterMesh) { this.water.group.remove(b.waterMesh); b.waterMesh.geometry.dispose(); } }
  dropAll() {
    const byWorker = new Map();
    for (const [id, j] of this.jobs) { if (!byWorker.has(j.worker)) byWorker.set(j.worker, []); byWorker.get(j.worker).push(id); }
    for (const [w, ids] of byWorker) w.postMessage({ t: 'drop', ids });
    this.jobs.clear(); this.pending.clear(); this.arrived.length = 0;
  }
  workerFor(bx, bz) { return this.workers[(((bx + bz) % WORKERS) + WORKERS) % WORKERS]; }
  // (transfer: lo que se le pasa al hilo sin copiarlo)
  ask(kind, key, pri, m, transfer) {
    const id = this.nextId++, worker = this.workerFor(m.bx, m.bz);
    this.jobs.set(id, { kind, key, worker });
    worker.postMessage({ ...m, t: kind, id, pri }, transfer || []);
    return id;
  }

  // Pone los bloques que tocan alrededor de (x, z) y quita los lejanos. budget: milisegundos para hacer bloques nuevos
  // (solo cuenta sin hilo aparte)
  update(gen, x, z, budget = 8) {
    if (gen !== this.gen) this.reset(gen);
    // Cambió la estación: se repinta todo (poco a poco, empezando por lo cercano)
    if (gen.season !== this.season) { this.season = gen.season; for (const b of this.blocks.values()) b.stale = true; }
    const bx = Math.floor(x / BLOCK), bz = Math.floor(z / BLOCK), want = [];
    for (let dz = -RADIUS; dz <= RADIUS; dz++) for (let dx = -RADIUS; dx <= RADIUS; dx++) want.push([bx + dx, bz + dz, dx * dx + dz * dz]);
    want.sort((a, b) => a[2] - b[2]);
    const keep = new Set(want.map(([a, b]) => `${a},${b}`));
    for (const [k, b] of this.blocks) if (!keep.has(k)) { this.dispose(b); this.blocks.delete(k); }
    // Las mallas de lo que ha llegado del hilo aparte, de cerca a lejos: las del 3 × 3 de la cámara, todas enseguida (sin
    // ellas no se empieza a jugar: ver ready); las de más allá, al menos una por fotograma y hasta BUILD_MS (todas de
    // golpe con snap). Si llegan muchas a la vez (al cargar o al volver, del relieve guardado), así no se para un fotograma
    const tb = performance.now(), A = this.arrived, ring = m => Math.max(Math.abs(m.bx - bx), Math.abs(m.bz - bz));
    if (A.length > 1) A.sort((a, b) => ring(a) - ring(b));
    for (let n = 0; A.length && (budget > 1e8 || !n || ring(A[0]) <= 1 || performance.now() - tb < BUILD_MS); n++) {
      const m = A.shift(), k = `${m.bx},${m.bz}`;
      this.pending.delete(k);
      if (!keep.has(k) || this.blocks.has(k)) continue;
      this.gen.seedBiomes(m.bx * BLOCK, m.bz * BLOCK, m.corners, m.m, m.centers, m.w);
      const t1 = performance.now(), blk = this.build(m.bx, m.bz, m.heights, m.water, m.colors, m.edge, m.normals);
      this.stats.built++; this.stats.msBuild += performance.now() - t1;
      this.blocks.set(k, blk);
      // (sus 16 trozos de textura, tras los bloques que hacen falta para empezar: ver ask)
      this.repaint(blk, Math.hypot(m.bx * BLOCK + BLOCK / 2 - x, m.bz * BLOCK + BLOCK / 2 - z) / BLOCK);
    }
    // (cada medio segundo: ¿se ha construido algo que allane el suelo de un bloque hecho?)
    if (this.world && performance.now() > this.padCheck) { this.padCheck = performance.now() + 500; for (const b of this.blocks.values()) if (b.raw && this.padSigOf(b.bx, b.bz) !== b.padSig) this.remesh(b); }
    // (la sombra de contacto: mira qué ha cambiado, junta formas, las pide al hilo y sube lo que ha llegado)
    this.contact.update(x, z);
    this.water.mesh.position.set(x, WATER_Y, z);
    // (el plano de fondo solo donde no hay bloque: el shader descarta lo que cae en un bloque hecho)
    const U = this.water.uniforms; U.origin.value.set((bx - RADIUS) * BLOCK, (bz - RADIUS) * BLOCK);
    for (let dz = -RADIUS; dz <= RADIUS; dz++) for (let dx = -RADIUS; dx <= RADIUS; dx++) U.built.value[(dz + RADIUS) * (2 * RADIUS + 1) + dx + RADIUS] = this.blocks.has(`${bx + dx},${bz + dz}`) ? 1 : 0;
    if (this.workers.length) {
      // Lo que ya no hace falta, fuera de la cola; lo que falta, pedido (lo cercano primero: pri)
      const drop = [];
      for (const [id, j] of this.jobs) if (!keep.has(j.key)) { drop.push(id); this.jobs.delete(id); this.pending.delete(j.key); }
      if (drop.length) for (const w of this.workers) w.postMessage({ t: 'drop', ids: drop });
      for (const [a, b, d] of want) {
        const k = `${a},${b}`, cur = this.blocks.get(k);
        if (cur) { if (cur.stale) { cur.stale = false; this.repaint(cur, Math.sqrt(d)); } continue; }
        // (pri: el de la cámara -1 y los de alrededor por debajo de 0,5, antes que cualquier pintura. Los del anillo de fuera,
        // de 1,25 a 2,1: después de pintar el bloque de la cámara (sus pinturas van de 0,5 a 1,2: ver repaint) y mezclados
        // con las del resto del 3 × 3. Sin nada guardado, con las pinturas de su misma distancia el anillo de fuera tardaba
        // 1,7 s más en estar (mientras, ahí hay un hueco con el agua de fondo) y el 3 × 3 solo se pintaba
        // 0,4 s antes: la forma de lejos importa más que el color plano de cerca durante un momento)
        if (!this.pending.has(k)) this.pending.set(k, this.ask('block', k, d <= 2 ? Math.sqrt(d) - 1 : Math.sqrt(d) - 0.75, { bx: a, bz: b, season: this.season }));
      }
      return;
    }
    // Sin hilo aparte: primero la forma (un bloque nuevo por fotograma) y luego la textura, un trozo cada vez
    const t0 = performance.now();
    let built = 0;
    for (const [a, b] of want) {
      const k = `${a},${b}`, cur = this.blocks.get(k);
      if (cur) { if (cur.stale) { cur.stale = false; cur.todo = allChunks(); cur.painted = 0; } continue; }
      if (built && performance.now() - t0 > budget) break;
      const d = blockHeights(gen, a, b);
      this.blocks.set(k, this.build(a, b, d.heights, d.water, blockColors(gen, a, b, this.season), d.edge, d.normals));
      built++;
    }
    for (const [a, b] of want) {
      const blk = this.blocks.get(`${a},${b}`);
      while (blk?.todo.length && (performance.now() - t0 < budget || budget > 1e8)) {
        const [ci, cj] = blk.todo.shift();
        this.paste(blk, ci, cj, paintPixels(gen, blk.bx * 4 + ci, blk.bz * 4 + cj, this.season));
      }
      if (performance.now() - t0 > budget && budget < 1e8) break;
    }
  }
  // Pedir al hilo aparte los 16 trozos de la textura de un bloque (tras sus alturas: pri + 0.5)
  repaint(blk, pri) {
    blk.season = this.season; blk.painted = 0;
    for (const [ci, cj] of allChunks()) this.ask('paint', `${blk.bx},${blk.bz}`, pri + 0.5, { bx: blk.bx, bz: blk.bz, ci, cj, cx: blk.bx * 4 + ci, cy: blk.bz * 4 + cj, season: this.season });
  }
  // Lo que devuelve el hilo aparte (si aún hace falta). Los bloques esperan en arrived a que update haga su malla (y siguen
  // en pending hasta entonces: el banco y las pruebas miran pending para saber si el suelo está hecho)
  onResult(m, wi = 0) {
    const j = this.jobs.get(m.id);
    if (!j) return;
    this.jobs.delete(m.id);
    const k = `${m.bx},${m.bz}`;
    if (m.t === 'fallo') { this.failed(m, k); return; }
    if (m.t === 'ao') { this.contact.result(m); return; }
    if (m.t === 'block') {
      if (m.stats) { this.workerStats[wi] = m.stats; for (const f of ['calc', 'msCalc', 'hits', 'msHit']) this.stats[f] = this.workerStats.reduce((a, s) => a + (s?.[f] || 0), 0); }
      if (this.blocks.has(k) || !this.gen) { this.pending.delete(k); return; }
      this.arrived.push(m);
    } else {
      const blk = this.blocks.get(k);
      if (!blk || blk.season !== m.season) return;
      this.paste(blk, m.ci, m.cj, m.pixels);
    }
  }
  // Un trabajo que ha fallado en el hilo aparte (no debería): se hace aquí, para que no quede un agujero en el suelo
  failed(m, k) {
    if (m.job === 'ao') { this.contact.failed(m); return; }   // (lo pinta aquí: ver contact3d.js)
    if (!this.gen) { this.pending.delete(k); return; }
    try {
      if (m.job === 'block') {
        if (this.blocks.has(k)) { this.pending.delete(k); return; }
        const d = blockHeights(this.gen, m.bx, m.bz);
        this.arrived.push({ ...d, t: 'block', bx: m.bx, bz: m.bz, w: BLOCK, colors: blockColors(this.gen, m.bx, m.bz, this.season) });
      } else {
        const blk = this.blocks.get(k);
        if (blk && blk.season === m.season) this.paste(blk, m.ci, m.cj, paintPixels(this.gen, blk.bx * 4 + m.ci, blk.bz * 4 + m.cj, m.season));
      }
    } catch (e) { this.pending.delete(k); console.warn('Suelo: no se ha podido hacer', k, e); }
  }
  // ¿Está hecho el suelo alrededor de (x, z)? (para no empezar a jugar sobre el vacío)
  ready(x, z) {
    const bx = Math.floor(x / BLOCK), bz = Math.floor(z / BLOCK);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!this.blocks.has(`${bx + dx},${bz + dz}`)) return false;
    return true;
  }

  // La malla de un bloque con sus alturas y, de entrada, cada trozo del color medio de su bioma (colors: 16 × rgb)
  // Las alturas allanadas junto a lo construido (raw: las del mundo, con el agua y el relieve; edge: su anillo), y sus
  // normales, que se rehacen con el anillo allanado igual (así el borde sigue sin costura). Sin nada construido cerca
  // (lo normal), las mismas alturas y las normales que vienen del hilo aparte
  // padK es cara (mira lo construido y los lugares de 9 trozos), así que se pregunta por cuadrados de PAD_SQ casillas
  // (padNear) y solo se mira vértice a vértice en los que tienen algo cerca; en los demás vale 1 (el relieve entero),
  // justo lo mismo que daría padK. Si al final no se ha allanado nada, las normales del hilo valen
  padded(bx, bz, raw, edge, normals) {
    const w = this.world, n = BLOCK + 1, x0 = bx * BLOCK, z0 = bz * BLOCK;
    const plain = () => ({ heights: raw.slice(), normals: normals || blockNormals(raw, edge, n) });
    if (!w?.padK || (w.padNear && !w.padNear(x0, z0, x0 + BLOCK, z0 + BLOCK))) return plain();   // (nada construido ni ningún lugar cerca)
    const t0 = performance.now(), out = raw.slice(), e = edge.slice(), S = PAD_SQ;
    let any = false;
    // (los vértices del bloque y su anillo: de -1 a n por cada lado, sin las cuatro esquinas del anillo)
    for (let sj = -1; sj <= n; sj += S) for (let si = -1; si <= n; si += S) {
      const i1 = Math.min(n, si + S - 1), j1 = Math.min(n, sj + S - 1);
      if (w.padNear && !w.padNear(x0 + si, z0 + sj, x0 + i1, z0 + j1)) continue;
      for (let j = sj; j <= j1; j++) for (let i = si; i <= i1; i++) {
        const ii = i < 0 || i === n, jj = j < 0 || j === n;
        if (ii && jj) continue;
        const H = ii || jj ? e : out, v = ii || jj ? edgeAt(n, i, j) : j * n + i;
        if (H[v] <= 0.01) continue;
        const k = w.padK(x0 + i, z0 + j);
        if (k !== 1) { H[v] *= k; any = true; }
      }
    }
    this.stats.padded++; this.stats.msPad += performance.now() - t0;
    if (!any) return { heights: out, normals: normals || blockNormals(raw, edge, n) };
    return { heights: out, normals: blockNormals(out, e, n) };
  }
  padSigOf(bx, bz) { return this.world?.padSig ? this.world.padSig(bx * BLOCK, bz * BLOCK, (bx + 1) * BLOCK, (bz + 1) * BLOCK) : ''; }
  // El allanado con el que heightAt da ahora la altura de un rectángulo: por bloque, el de su malla, o el de este momento si
  // aún no la tiene (heightAt lo calcula al momento). Lo que va encima (la naturaleza, las matas) se rehace cuando cambia:
  // así no se queda con las alturas de antes mientras la malla espera a padCheck, ni se queda atrás cuando por fin cambia
  padStamp(x0, z0, x1, z1) {
    let s = '';
    for (let bz = Math.floor(z0 / BLOCK); bz <= Math.floor((z1 - 1) / BLOCK); bz++) for (let bx = Math.floor(x0 / BLOCK); bx <= Math.floor((x1 - 1) / BLOCK); bx++) {
      const b = this.blocks.get(`${bx},${bz}`);
      s += (b ? b.padSig : this.padSigOf(bx, bz)) + ';';
    }
    return s;
  }
  // Rehacer la forma de un bloque (alguien ha construido cerca: el suelo se allana o vuelve a su altura)
  remesh(b) {
    const p = this.padded(b.bx, b.bz, b.raw, b.edge, b.normals0);
    b.heights = p.heights; b.padSig = this.padSigOf(b.bx, b.bz); this.padV++;
    const geo = b.mesh.geometry, pos = geo.attributes.position, nor = geo.attributes.normal;
    for (let v = 0; v < pos.count; v++) pos.setY(v, b.heights[v]);
    nor.array.set(p.normals);
    pos.needsUpdate = nor.needsUpdate = true; geo.computeBoundingSphere();
  }
  // edge: el anillo de alturas de alrededor (ground.js: blockHeights) y normals: las normales sin allanar (si no vienen,
  // se calculan)
  build(bx, bz, raw, water, colors, edge, normals) {
    const x0 = bx * BLOCK, z0 = bz * BLOCK, n = BLOCK + 1, { heights, normals: nor } = this.padded(bx, bz, raw, edge, normals);
    const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const v = j * n + i;
      pos[v * 3] = x0 + i; pos[v * 3 + 1] = heights[v]; pos[v * 3 + 2] = z0 + j;
      uv[v * 2] = i / BLOCK; uv[v * 2 + 1] = 1 - j / BLOCK;
    }
    const idx = new Uint16Array(BLOCK * BLOCK * 6);   // (65 × 65 vértices: caben en 16 bits, y ocupa la mitad)
    let q = 0;
    for (let j = 0; j < BLOCK; j++) for (let i = 0; i < BLOCK; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.computeBoundingSphere();
    const W = BLOCK * PX, c = document.createElement('canvas');
    c.width = c.height = W;
    const g = c.getContext('2d');
    for (let cj = 0; cj < 4; cj++) for (let ci = 0; ci < 4; ci++) {
      const o = (cj * 4 + ci) * 3;
      g.fillStyle = `rgb(${colors[o]},${colors[o + 1]},${colors[o + 2]})`; g.fillRect(ci * CHUNK * PX, cj * CHUNK * PX, CHUNK * PX, CHUNK * PX);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    const mesh = new THREE.Mesh(geo, groundMaterial(tex));
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    const waterMesh = water ? this.buildWater(pos, raw, n) : null;
    // (normals0: las de sin allanar, para cuando se quita lo construido; aparte de las de la malla, que remesh cambia)
    const blk = { mesh, tex, ctx: g, heights, raw, edge, normals0: nor === normals ? normals.slice() : normals, padSig: this.padSigOf(bx, bz), x0, z0, n, bx, bz, season: this.season, todo: allChunks(), painted: 0, waterMesh };
    this.contact.added(blk);   // (su hueco de la sombra de contacto, en blanco, y sus 16 trozos por pintar)
    return blk;
  }
  // El agua del bloque: la misma rejilla a ras de WATER_Y, con lo que hay de suelo debajo en cada vértice (depth), y
  // solo las casillas que tocan agua
  buildWater(pos, heights, n) {
    const wpos = new Float32Array(n * n * 3), depth = new Float32Array(n * n), nor = new Float32Array(n * n * 3), idx = [];
    for (let v = 0; v < n * n; v++) { wpos[v * 3] = pos[v * 3]; wpos[v * 3 + 1] = WATER_Y; wpos[v * 3 + 2] = pos[v * 3 + 2]; depth[v] = WATER_Y - heights[v]; nor[v * 3 + 1] = 1; }
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      if (depth[a] > 0 || depth[b] > 0 || depth[c] > 0 || depth[d] > 0) idx.push(a, c, b, b, c, d);
    }
    if (!idx.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(wpos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('depth', new THREE.BufferAttribute(depth, 1));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, this.water.material);
    m.renderOrder = 2;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    this.water.group.add(m);
    return m;
  }
  // Pone los píxeles de un trozo en la textura de su bloque; se sube a la gráfica cuando están los 16 (y, para
  // que lo cercano no espere, también al cuarto)
  paste(blk, ci, cj, pixels) {
    const N = CHUNK * PX;
    blk.ctx.putImageData(new ImageData(pixels, N, N), ci * N, cj * N);
    blk.painted++;
    if (blk.painted === 4 || blk.painted === 16) blk.tex.needsUpdate = true;
  }

  // Altura del suelo en (x, z): la de la malla si su bloque está hecho; si no, la de la profundidad sin suavizar
  heightAt(x, z) {
    const b = this.blocks.get(`${Math.floor(x / BLOCK)},${Math.floor(z / BLOCK)}`);
    if (!b) return this.gen ? groundSmooth(this.gen, x, z, this.world) : 0;   // (aún sin bloque: lo mismo, calculado aquí)
    const u = x - b.x0, v = z - b.z0, i = Math.min(BLOCK - 1, Math.floor(u)), j = Math.min(BLOCK - 1, Math.floor(v)), fu = u - i, fv = v - j, H = b.heights, n = b.n;
    const a = H[j * n + i], bb = H[j * n + i + 1], c = H[(j + 1) * n + i], d = H[(j + 1) * n + i + 1];
    // (cada casilla son dos triángulos: a-c-b y b-c-d)
    return fu + fv <= 1 ? a + (bb - a) * fu + (c - a) * fv : d + (c - d) * (1 - fu) + (bb - d) * (1 - fv);
  }
}

// Material del suelo: la textura del bloque con el detalle de briznas (sobre lo verde) o de piedrecitas (sobre tierra,
// arena y nieve), a dos escalas; en las cuestas fuertes, roca, y en las medias asoma la tierra. Con ?suelo=v2, el de antes
let DETAIL;
// (lo que multiplica el color del suelo al final: la perilla para calibrarlo sin tocar la luz ni la curva de tono)
export const GROUND_GAIN = { value: 1.0 };
function groundMaterial(map) {
  const m = mat({ roughness: 0.96, map }), D = (DETAIL ||= { grass: { value: grassDetail() }, soil: { value: soilDetail() }, rock: { value: SUELO_V2 ? null : rockDetail() }, rockCol: { value: new THREE.Color(PAL.suelo.roca) } });
  m.customProgramCacheKey = () => contactKey(SUELO_V2 ? 'suelo-mojado' : 'suelo-v3');
  m.onBeforeCompile = (sh, r) => {
    // (la sombra de contacto: lee el sitio en el mundo que ya declara el detalle, sin otro varying. Solo en el renderer
    // del juego; el orden con lo de abajo da igual, cada uno deja '#include <common>' delante de lo suyo)
    injectContact(sh, r, 'frag', SUELO_V2 ? 'vWorld' : 'vGP.xz');
    sh.uniforms.grassMap = D.grass; sh.uniforms.soilMap = D.soil; sh.uniforms.uWet = WET;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uWet;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n        roughnessFactor = mix(roughnessFactor, 0.42, uWet * 0.75);   // (mojado: brilla un poco)')
      .replace('#include <color_fragment>', '#include <color_fragment>\n        diffuseColor.rgb *= 1.0 - 0.24 * uWet;   // (y más oscuro)');
    if (SUELO_V2) { oldDetail(sh); return; }
    sh.uniforms.rockMap = D.rock; sh.uniforms.rockCol = D.rockCol; sh.uniforms.uGain = GROUND_GAIN;
    // (la media de cada detalle, de su lienzo o de su foto, cuando llega: ver meanOf. Se lee al subir los uniformes, así
    // sigue a la foto sin que cada píxel lea el último mipmap)
    sh.uniforms.uMean = (D.mean ||= { get value() { return (this.v ||= new THREE.Vector3()).set(meanOf(D.grass.value), meanOf(D.soil.value), meanOf(D.rock.value)); } });
    // (el sitio y la normal en el mundo, para el detalle y para saber cuánta cuesta hay)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGP;\nvarying vec3 vGN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvGN = mat3(modelMatrix) * objectNormal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D grassMap;\nuniform sampler2D soilMap;\nuniform sampler2D rockMap;\nuniform vec3 rockCol;\nuniform float uGain;\nuniform vec3 uMean;\nvarying vec3 vGP;\nvarying vec3 vGN;\n' + NOISE)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n        roughnessFactor = mix(roughnessFactor, 0.82, rockK);   // (la roca, algo menos mate)')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 base = diffuseColor.rgb;
        // (lo verde: que no sea más rojo que verde ni tan azul)
        float green = smoothstep(-0.035, 0.015, base.g - base.r) * smoothstep(0.01, 0.06, base.g - base.b);
        vec2 P = vGP.xz;
        // El detalle, dividido por su media (uMean: la de lo que tenga en ese momento, el lienzo o la foto, cuando llega). Así
        // no aclara ni oscurece el color del suelo, solo le da grano
        float mG = uMean.x, mS = uMean.y;
        float g1 = texture2D(grassMap, P * 0.55).r / mG, g2 = texture2D(grassMap, mat2(0.8, -0.6, 0.6, 0.8) * P * 0.13 + 0.37).r / mG;
        float s1 = texture2D(soilMap, P * 0.6).r / mS, s2 = texture2D(soilMap, P * 0.11 + 0.71).r / mS;
        // La cuesta: de 32° a 38°, roca (con nieve, de 43° a 49°: la nieve se queda en lo que no es pared), con el borde roto
        // por un ruido; y de 14° a 30° la hierba clarea y asoma la tierra. Bajo el agua no hay roca (no
        // tapa el fondo que pinta ground.js). La nieve, por el color: clara y sin croma
        vec3 nW = normalize(vGN);
        float lum = dot(base, vec3(0.2126, 0.7152, 0.0722)), chroma = max(base.r, max(base.g, base.b)) - min(base.r, min(base.g, base.b));
        float snowy = smoothstep(0.40, 0.60, lum) * (1.0 - smoothstep(0.05, 0.14, chroma));
        // (el borde, roto con un ruido propio: el de las texturas lo promedian las mipmaps según la distancia, y con él solo, el
        // contorno de la roca cambiaba de forma al acercarse o girar. Este, de manchas de unos 3 m y de 1 m (giradas, para que
        // no se note su rejilla), es el mismo de cerca y de lejos, y es el que decide dónde va el borde; solo se apaga muy
        // lejos, donde un píxel ya abarca más que sus manchas, para que no centellee. Por la distancia y no por lo que mide un
        // píxel (dFdx), que cambia de golpe de un triángulo a otro. Encima, el grano de la tierra y de la hierba (s2 y g2, de
        // media 1) lo deshilacha de cerca, como antes; de lejos se va, pero el borde se queda donde estaba)
        vec3 dPx = dFdx(vGP), dPy = dFdy(vGP);
        float far = distance(vGP, cameraPosition);
        float ny = nW.y + (gNoise(P * 0.35) - 0.5) * 0.18 * (1.0 - smoothstep(500.0, 1000.0, far))
          + (gNoise(mat2(0.8, -0.6, 0.6, 0.8) * P * 1.1 + 7.3) - 0.5) * 0.1 * (1.0 - smoothstep(160.0, 320.0, far))
          + (s2 - 1.0) * 0.2 + (g2 - 1.0) * 0.08;
        float rockK = smoothstep(0.85 - 0.13 * snowy, 0.79 - 0.12 * snowy, ny) * smoothstep(-0.02, 0.12, vGP.y);
        float mid = smoothstep(0.97, 0.86, ny) * (1.0 - rockK);
        float dG = (1.0 + 0.8 * (g1 - 1.0)) * (1.0 + 0.45 * (g2 - 1.0)), dS = (1.0 + 0.75 * (s1 - 1.0)) * (1.0 + 0.3 * (s2 - 1.0));
        diffuseColor.rgb = base * mix(dS, dG, green * (1.0 - 0.55 * mid)) * uGain;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.02, 0.93, 0.80) * 0.9, mid * green * 0.5);
        // (los cambios del sitio entre píxeles, dPx y dPy, van fuera del if: dentro, con unos píxeles sí y otros no, la gráfica
        // no los sabe)
        if (rockK > 0.002) {
          // (la roca, proyectada en los tres planos según hacia dónde mire la cuesta, para que no se estire; encima,
          // bloques grandes vistos desde arriba y estratos: el ruido de tierra estirado en horizontal. Toma un poco del color
          // del bioma, más cálida en el desierto; con nieve, más fría y con nieve en los salientes que miran arriba)
          vec3 aN = abs(nW), w3 = aN * aN * aN;
          w3 /= w3.x + w3.y + w3.z;
          float mR = uMean.z;
          float r1 = (w3.x * textureGrad(rockMap, vGP.zy * 0.5, dPx.zy * 0.5, dPy.zy * 0.5).r + w3.y * textureGrad(rockMap, P * 0.5, dPx.xz * 0.5, dPy.xz * 0.5).r
            + w3.z * textureGrad(rockMap, vGP.xy * 0.5, dPx.xy * 0.5, dPy.xy * 0.5).r) / mR;
          float r3 = textureGrad(rockMap, P * 0.09 + 0.5, dPx.xz * 0.09, dPy.xz * 0.09).r / mR;
          // (los estratos, en las dos paredes de la proyección: con uno solo, (x + z), en las que miran a (1, 0, 1) no cambiaba a lo
          // largo de la pared y salían rayas rectas. Solo donde hay pared: en lo más tendido apenas se ven, y se apagan poco a
          // poco antes de dejar de leerlos, para que no quede una raya en el sitio del corte)
          float st = 1.0;
          if (w3.y < 0.9) {
            float sA = textureGrad(soilMap, vec2(vGP.z * 0.08, vGP.y * 0.35), vec2(dPx.z * 0.08, dPx.y * 0.35), vec2(dPy.z * 0.08, dPy.y * 0.35)).r;
            float sB = textureGrad(soilMap, vec2(vGP.x * 0.08, vGP.y * 0.35), vec2(dPx.x * 0.08, dPx.y * 0.35), vec2(dPy.x * 0.08, dPy.y * 0.35)).r;
            st = 1.0 + (mix(sB, sA, w3.x / (w3.x + w3.z + 1e-4)) / mS - 1.0) * (1.0 - w3.y) * smoothstep(0.9, 0.75, w3.y);
          }
          vec3 rock = mix(rockCol * 0.9, base * 0.8, 0.22 * (1.0 - snowy)) * max(0.25, (1.0 + 1.0 * (r1 - 1.0)) * (1.0 + 1.3 * (r3 - 1.0)) * (1.0 + 0.6 * (st - 1.0)));
          rock = mix(rock, rock * vec3(0.9, 0.95, 1.02), snowy);
          rock = mix(rock, base, snowy * 0.75 * smoothstep(0.62, 0.7, ny + (r1 - 1.0) * 0.6));
          diffuseColor.rgb = mix(diffuseColor.rgb, rock, rockK);
        }`);
  };
  return m;
}
// Ruido de valor del borde de la roca (terrain.js, suelo-v3): el azar de cada punto de la rejilla y, entre medias, suave
const NOISE = `float gHash(vec2 p) { vec3 q = fract(p.xyx * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float gNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), f.x), f.y); }
`;
// El detalle de antes (?suelo=v2): sin cuestas, y dividido por una media fija, que aclaraba lo verde (×1,5)
function oldDetail(sh) {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vWorld;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xz;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform sampler2D grassMap;\nuniform sampler2D soilMap;\nvarying vec2 vWorld;')
    .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 base = diffuseColor.rgb;
        float green = smoothstep(-0.035, 0.015, base.g - base.r) * smoothstep(0.01, 0.06, base.g - base.b);
        float g1 = texture2D(grassMap, vWorld * 0.55).r / 0.85, g2 = texture2D(grassMap, vWorld * 0.13 + 0.37).r / 0.85;
        float s1 = texture2D(soilMap, vWorld * 0.6).r / 0.84;
        diffuseColor.rgb *= mix(mix(0.72, 1.2, s1), mix(0.62, 1.25, g1) * mix(0.68, 1.24, g2), green);`);
}

// Agua: el material de las mallas por bloque (block: con la profundidad por vértice) y el del plano de fondo (sin
// ella: como si fuera honda, y descartado donde ya hay bloque). Ondas pequeñas en la normal que van a la deriva,
// brillos que se mueven, el reflejo del cielo en los ángulos rasantes, el color más claro y verdoso donde cubre
// poco, espuma que late hacia la orilla y el borde que se desvanece en vez de cortar el suelo (la línea de la orilla
// la pinta el suelo, ground.js, que es más fino que esta malla)
// (los colores de la paleta, poca espuma y olas suaves)
const lin = c => { const k = new THREE.Color(c); return `vec3(${k.r.toFixed(4)}, ${k.g.toFixed(4)}, ${k.b.toFixed(4)})`; };
const WATER = { color: PAL.agua.media, shallow: lin(PAL.agua.orilla), deep: lin(PAL.agua.profunda), foam: lin(PAL.agua.espuma), foamK: '0.35', wave: '0.7' };
function waterMaterial(uniforms, block) {
  const m = new THREE.MeshStandardMaterial({ color: WATER.color, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.8 });
  m.customProgramCacheKey = () => (block ? 'agua-bloque' : 'agua-fondo');   // (si no, Three les da el mismo programa a los dos: el texto de onBeforeCompile es el mismo)
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { time: uniforms.time, sky: uniforms.sky, origin: uniforms.origin, built: uniforms.built, rainK: RAIN });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vW;\nvarying float vDepth;${block ? '\nattribute float depth;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xz;\nvDepth = ${block ? 'depth' : '1.0'};`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float time;\nuniform vec3 sky;\nuniform vec2 origin;\nuniform float built[${(2 * RADIUS + 1) ** 2}];\nuniform float rainK;\nvarying vec2 vW;\nvarying float vDepth;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        ${block ? '' : `vec2 bq = floor((vW - origin) / ${BLOCK}.0);
        if (bq.x >= 0.0 && bq.x < ${2 * RADIUS + 1}.0 && bq.y >= 0.0 && bq.y < ${2 * RADIUS + 1}.0 && built[int(bq.y) * ${2 * RADIUS + 1} + int(bq.x)] > 0.5) discard;`}
        if (vDepth <= 0.0) discard;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float dp = vDepth;
        vec2 q = vW * 1.7 + vec2(time * 0.22, time * 0.1);
        float sp = sin(q.x * 3.1 + time * 0.9 + sin(q.y * 1.7) * 1.5) * sin(q.y * 2.7 - time * 0.7 + sin(q.x * 1.3) * 1.5);   // (brillos sin rejilla)
        diffuseColor.rgb = mix(${WATER.shallow}, diffuseColor.rgb, smoothstep(0.0, 0.4, dp));
        diffuseColor.rgb = mix(diffuseColor.rgb, ${WATER.deep}, smoothstep(0.6, 2.4, dp) * 0.8);   // (lo hondo, más oscuro)
        diffuseColor.rgb += vec3(0.06, 0.08, 0.09) * smoothstep(0.75, 1.0, sp);
        // (espuma: una franja fina junto a la orilla, que late hacia ella)
        float ring = 0.55 + 0.45 * sin(dp * 40.0 - time * 1.8 + sin(vW.x * 1.3 + vW.y * 0.9) * 2.0);
        float foam = smoothstep(0.26, 0.04, dp) * ring;
        diffuseColor.rgb = mix(diffuseColor.rgb, ${WATER.foam}, foam * ${WATER.foamK});
        diffuseColor.a = mix(diffuseColor.a, 0.9, foam * 0.5) * smoothstep(0.0, 0.22, dp);   // (el borde se desvanece: la orilla la dibuja el suelo)`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float w1 = sin(q.x * 1.3 + time * 1.1) * cos(q.y * 1.1 - time * 0.8), w2 = sin((q.x + q.y) * 2.3 - time * 1.7);
        normal = normalize(normal + (mat3(viewMatrix) * vec3(w1 * 0.06 + w2 * 0.03, 0.0, w2 * 0.05 - w1 * 0.03) * ${WATER.wave}));
        // (la lluvia: en cada celda de medio metro, un círculo que se abre y se apaga, a destiempo)
        if (rainK > 0.0) {
          vec2 cell = floor(vW * 2.2), f = fract(vW * 2.2) - 0.5;
          float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453), tt = fract(time * 1.1 + h);
          f -= (vec2(fract(h * 7.3), fract(h * 3.1)) - 0.5) * 0.4;
          float rr = length(f), ring = smoothstep(0.035, 0.0, abs(rr - tt * 0.42)) * (1.0 - tt) * step(h, 0.35 + rainK * 0.6);
          normal = normalize(normal + (mat3(viewMatrix) * vec3(f.x, 0.0, f.y) * ring * 2.5 * rainK));
          diffuseColor.rgb += vec3(0.05) * ring * rainK;
        }
        float fres = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 3.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, sky, fres * 0.4);
        diffuseColor.a = mix(diffuseColor.a, 1.0, fres * 0.6);`);
  };
  return m;
}
function makeWater() {
  const uniforms = { time: { value: 0 }, sky: { value: new THREE.Color('#cfe6f4') }, origin: { value: new THREE.Vector2() }, built: { value: new Float32Array((2 * RADIUS + 1) ** 2) } };
  const geo = new THREE.PlaneGeometry(520, 520, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, waterMaterial(uniforms, false));
  mesh.renderOrder = 1;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  return { mesh, group, material: waterMaterial(uniforms, true), uniforms };
}
