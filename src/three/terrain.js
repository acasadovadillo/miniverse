// Suelo del mundo en 3D, en bloques de 4 × 4 trozos (64 casillas de lado) alrededor de la cámara. Cada bloque
// es una malla de un vértice por casilla, hundida donde hay agua (mar, lagos, el estanque del pueblo), y una
// textura pintada desde arriba con los mismos colores que el suelo del juego en 2D: el bioma con su paleta
// de la estación, sus manchas, y el camino y la orilla del estanque del pueblo. Encima, un detalle de briznas
// o de piedrecitas que no se repite a la vista. El agua es una malla por bloque a ras de WATER_Y con la profundidad
// en cada vértice (para el color, la espuma y el borde suave) y, donde aún no hay bloque, un plano que sigue a la cámara.
// Los números (alturas, biomas y píxeles: ground.js) los calcula un hilo aparte (genworker.js), lo más cercano
// primero; aquí solo se hacen las mallas y se suben las texturas. Sin hilos aparte, se calcula aquí poco a poco.
import * as THREE from 'three';
import { CHUNK } from '../world/gen.js';
import * as village from '../world/village.js';
import { BLOCK, PX, groundSmooth, blockHeights, blockColors, paintPixels } from '../world/ground.js';
import { grassDetail, soilDetail } from './textures.js';
import { mat } from './geo.js';
import { ARTE, PAL } from '../arte.js';

export { BLOCK };
const RADIUS = 2;                       // bloques alrededor del de la cámara (5 × 5)
export const WATER_Y = -0.12;
// (?arte=2) El clima en el suelo y el agua: WET, de 0 a 1, cuánto ha llovido (oscurece y abrillanta el suelo, y se seca
// despacio); RAIN, de 0 a 1, lo que llueve ahora (los círculos de las gotas en el agua). Los pone engine.js
export const WET = { value: 0 }, RAIN = { value: 0 };
const A2 = ARTE === 2;
const WORKERS = Math.min(2, Math.max(1, (navigator.hardwareConcurrency || 2) - 1));

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
    this.group = new THREE.Group();
    scene.add(this.group);
    this.water = makeWater();
    scene.add(this.water.group);
    this.world = null;            // el mundo de la partida (para allanar el suelo junto a lo construido: padK); lo pone engine.js
    this.padCheck = 0;
    this.workers = this.startWorkers();
    village.onVillageChange(() => this.villageChanged());
  }
  // Los hilos aparte (si el navegador los tiene; si no, todo se hace aquí)
  startWorkers() {
    if (typeof Worker === 'undefined') return [];
    try {
      const list = [];
      for (let i = 0; i < WORKERS; i++) {
        const w = new Worker(new URL('../world/genworker.js', import.meta.url), { type: 'module' });
        w.onmessage = e => this.onResult(e.data);
        w.onerror = e => { console.warn('Suelo: el hilo aparte ha fallado; se calcula aquí', e.message); this.workers = []; this.pending.clear(); this.jobs.clear(); };
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
  }
  // El mundo cambió (otra partida, el menú): fuera todo lo hecho
  reset(gen) {
    for (const b of this.blocks.values()) this.dispose(b);
    this.blocks.clear();
    this.dropAll();
    this.gen = gen;
    this.season = gen.season;
    for (const w of this.workers) w.postMessage({ t: 'init', seed: gen.seed, projects: village.getProjects(), family: village.familyHouse(), arte: ARTE });
  }
  dispose(b) { this.group.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); b.tex.dispose(); if (b.waterMesh) { this.water.group.remove(b.waterMesh); b.waterMesh.geometry.dispose(); } }
  dropAll() {
    const byWorker = new Map();
    for (const [id, j] of this.jobs) { if (!byWorker.has(j.worker)) byWorker.set(j.worker, []); byWorker.get(j.worker).push(id); }
    for (const [w, ids] of byWorker) w.postMessage({ t: 'drop', ids });
    this.jobs.clear(); this.pending.clear();
  }
  workerFor(bx, bz) { return this.workers[(((bx + bz) % WORKERS) + WORKERS) % WORKERS]; }
  ask(kind, key, pri, m) {
    const id = this.nextId++, worker = this.workerFor(m.bx, m.bz);
    this.jobs.set(id, { kind, key, worker });
    worker.postMessage({ ...m, t: kind, id, pri });
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
    // (cada medio segundo: ¿se ha construido algo que allane el suelo de un bloque hecho?)
    if (this.world && performance.now() > this.padCheck) { this.padCheck = performance.now() + 500; for (const b of this.blocks.values()) if (b.raw && this.padSigOf(b.bx, b.bz) !== b.padSig) this.remesh(b); }
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
        if (cur) { if (cur.stale) { cur.stale = false; this.repaint(cur, d); } continue; }
        if (!this.pending.has(k)) this.pending.set(k, this.ask('block', k, d, { bx: a, bz: b, season: this.season }));
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
      this.blocks.set(k, this.build(a, b, d.heights, d.water, blockColors(gen, a, b, this.season)));
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
  // Lo que devuelve el hilo aparte (si aún hace falta)
  onResult(m) {
    const j = this.jobs.get(m.id);
    if (!j) return;
    this.jobs.delete(m.id);
    const k = `${m.bx},${m.bz}`;
    if (m.t === 'block') {
      this.pending.delete(k);
      if (this.blocks.has(k) || !this.gen) return;
      this.gen.seedBiomes(m.bx * BLOCK, m.bz * BLOCK, m.corners, m.m, m.centers, m.w);
      const blk = this.build(m.bx, m.bz, m.heights, m.water, m.colors);
      this.blocks.set(k, blk);
      this.repaint(blk, Math.hypot(m.bx * BLOCK + BLOCK / 2 - this.water.mesh.position.x, m.bz * BLOCK + BLOCK / 2 - this.water.mesh.position.z) / BLOCK);
    } else {
      const blk = this.blocks.get(k);
      if (!blk || blk.season !== m.season) return;
      this.paste(blk, m.ci, m.cj, m.pixels);
    }
  }
  // ¿Está hecho el suelo alrededor de (x, z)? (para no empezar a jugar sobre el vacío)
  ready(x, z) {
    const bx = Math.floor(x / BLOCK), bz = Math.floor(z / BLOCK);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!this.blocks.has(`${bx + dx},${bz + dz}`)) return false;
    return true;
  }

  // La malla de un bloque con sus alturas y, de entrada, cada trozo del color medio de su bioma (colors: 16 × rgb)
  // Las alturas allanadas junto a lo construido (raw: las del mundo, con el agua y el relieve)
  padded(bx, bz, raw) {
    const w = this.world, out = raw.slice();
    if (!w?.padK) return out;
    const x0 = bx * BLOCK, z0 = bz * BLOCK, n = BLOCK + 1;
    if (w.padNear && !w.padNear(x0, z0, x0 + BLOCK, z0 + BLOCK)) return out;   // (nada construido ni ningún lugar cerca)
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const v = j * n + i; if (out[v] > 0.01) out[v] *= w.padK(x0 + i, z0 + j); }
    return out;
  }
  padSigOf(bx, bz) { return this.world?.padSig ? this.world.padSig(bx * BLOCK, bz * BLOCK, (bx + 1) * BLOCK, (bz + 1) * BLOCK) : ''; }
  // Rehacer la forma de un bloque (alguien ha construido cerca: el suelo se allana o vuelve a su altura)
  remesh(b) {
    b.heights = this.padded(b.bx, b.bz, b.raw); b.padSig = this.padSigOf(b.bx, b.bz);
    const geo = b.mesh.geometry, pos = geo.attributes.position;
    for (let v = 0; v < pos.count; v++) pos.setY(v, b.heights[v]);
    pos.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere();
  }
  build(bx, bz, raw, water, colors) {
    const x0 = bx * BLOCK, z0 = bz * BLOCK, n = BLOCK + 1, heights = this.padded(bx, bz, raw);
    const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const v = j * n + i;
      pos[v * 3] = x0 + i; pos[v * 3 + 1] = heights[v]; pos[v * 3 + 2] = z0 + j;
      uv[v * 2] = i / BLOCK; uv[v * 2 + 1] = 1 - j / BLOCK;
    }
    const idx = new Uint32Array(BLOCK * BLOCK * 6);
    let q = 0;
    for (let j = 0; j < BLOCK; j++) for (let i = 0; i < BLOCK; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    if (heights.some(h => h !== 0)) geo.computeVertexNormals();   // (con agua o relieve)
    else { const nor = new Float32Array(n * n * 3); for (let i = 1; i < nor.length; i += 3) nor[i] = 1; geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); }
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
    return { mesh, tex, ctx: g, heights, raw, padSig: this.padSigOf(bx, bz), x0, z0, n, bx, bz, season: this.season, todo: allChunks(), painted: 0, waterMesh };
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
    if (!b) { if (!this.gen) return 0; const h = groundSmooth(this.gen, x, z); return h > 0 && this.world?.padK ? h * this.world.padK(x, z) : h; }   // (aún sin bloque: lo mismo, calculado aquí)
    const u = x - b.x0, v = z - b.z0, i = Math.min(BLOCK - 1, Math.floor(u)), j = Math.min(BLOCK - 1, Math.floor(v)), fu = u - i, fv = v - j, H = b.heights, n = b.n;
    const a = H[j * n + i], bb = H[j * n + i + 1], c = H[(j + 1) * n + i], d = H[(j + 1) * n + i + 1];
    // (cada casilla son dos triángulos: a-c-b y b-c-d)
    return fu + fv <= 1 ? a + (bb - a) * fu + (c - a) * fv : d + (c - d) * (1 - fu) + (bb - d) * (1 - fv);
  }
}

// Material del suelo: la textura del bloque con el detalle de briznas (sobre lo verde) o de piedrecitas
// (sobre tierra, arena y nieve), a dos escalas
let DETAIL;
function groundMaterial(map) {
  const m = mat({ roughness: 0.96, map }), D = (DETAIL ||= { grass: { value: grassDetail() }, soil: { value: soilDetail() } });
  if (A2) m.customProgramCacheKey = () => 'suelo-mojado';
  m.onBeforeCompile = sh => {
    sh.uniforms.grassMap = D.grass; sh.uniforms.soilMap = D.soil; sh.uniforms.uWet = WET;
    if (A2) sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uWet;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n        roughnessFactor = mix(roughnessFactor, 0.42, uWet * 0.75);   // (mojado: brilla un poco)')
      .replace('#include <color_fragment>', '#include <color_fragment>\n        diffuseColor.rgb *= 1.0 - 0.24 * uWet;   // (y más oscuro)');
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D grassMap;\nuniform sampler2D soilMap;\nvarying vec2 vWorld;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 base = diffuseColor.rgb;
        // (lo verde: que no sea más rojo que verde ni tan azul; con los verdes sobrios y el otoño, la resta de siempre daba
        // casi cero y el pasto se quedaba sin briznas)
        float green = smoothstep(-0.035, 0.015, base.g - base.r) * smoothstep(0.01, 0.06, base.g - base.b);
        float g1 = texture2D(grassMap, vWorld * 0.55).r / 0.85, g2 = texture2D(grassMap, vWorld * 0.13 + 0.37).r / 0.85;
        float s1 = texture2D(soilMap, vWorld * 0.6).r / 0.84;
        // (con las fotos de hierba y tierra, bien marcado: la escala grande se ve como manchas a la distancia de juego)
        diffuseColor.rgb *= mix(mix(0.72, 1.2, s1), mix(0.62, 1.25, g1) * mix(0.68, 1.24, g2), green);`);
  };
  return m;
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
        ${A2 ? `diffuseColor.rgb = mix(diffuseColor.rgb, ${WATER.deep}, smoothstep(0.6, 2.4, dp) * 0.8);   // (lo hondo, más oscuro)` : ''}
        diffuseColor.rgb += vec3(0.06, 0.08, 0.09) * smoothstep(0.75, 1.0, sp);
        // (espuma: una franja fina junto a la orilla, que late hacia ella)
        float ring = 0.55 + 0.45 * sin(dp * 40.0 - time * 1.8 + sin(vW.x * 1.3 + vW.y * 0.9) * 2.0);
        float foam = smoothstep(0.26, 0.04, dp) * ring;
        diffuseColor.rgb = mix(diffuseColor.rgb, ${WATER.foam}, foam * ${WATER.foamK});
        diffuseColor.a = mix(diffuseColor.a, 0.9, foam * 0.5) * smoothstep(0.0, 0.22, dp);   // (el borde se desvanece: la orilla la dibuja el suelo)`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float w1 = sin(q.x * 1.3 + time * 1.1) * cos(q.y * 1.1 - time * 0.8), w2 = sin((q.x + q.y) * 2.3 - time * 1.7);
        normal = normalize(normal + (mat3(viewMatrix) * vec3(w1 * 0.06 + w2 * 0.03, 0.0, w2 * 0.05 - w1 * 0.03) * ${WATER.wave}));
        ${A2 ? `// (la lluvia: en cada celda de medio metro, un círculo que se abre y se apaga, a destiempo)
        if (rainK > 0.0) {
          vec2 cell = floor(vW * 2.2), f = fract(vW * 2.2) - 0.5;
          float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453), tt = fract(time * 1.1 + h);
          f -= (vec2(fract(h * 7.3), fract(h * 3.1)) - 0.5) * 0.4;
          float rr = length(f), ring = smoothstep(0.035, 0.0, abs(rr - tt * 0.42)) * (1.0 - tt) * step(h, 0.35 + rainK * 0.6);
          normal = normalize(normal + (mat3(viewMatrix) * vec3(f.x, 0.0, f.y) * ring * 2.5 * rainK));
          diffuseColor.rgb += vec3(0.05) * ring * rainK;
        }` : ''}
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
