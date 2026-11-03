// Suelo del mundo en 3D, en bloques de 4 × 4 trozos (64 casillas de lado) alrededor de la cámara. Cada bloque
// es una malla de un vértice por casilla, hundida donde hay agua (mar, lagos, el estanque del pueblo), y una
// textura pintada desde arriba con los mismos colores que el suelo del juego en 2D: el bioma con su paleta
// de la estación, sus manchas, y el camino y la orilla del estanque del pueblo. Encima, un detalle de briznas
// o de piedrecitas que no se repite a la vista. El agua es un plano que acompaña a la cámara.
// Los números (alturas, biomas y píxeles: ground.js) los calcula un hilo aparte (genworker.js), lo más cercano
// primero; aquí solo se hacen las mallas y se suben las texturas. Sin hilos aparte, se calcula aquí poco a poco.
import * as THREE from 'three';
import { CHUNK } from '../world/gen.js';
import * as village from '../world/village.js';
import { BLOCK, PX, depthOf, blockHeights, blockColors, paintPixels } from '../world/ground.js';
import { grassDetail, soilDetail } from './textures.js';
import { mat } from './geo.js';

export { BLOCK };
const RADIUS = 2;                       // bloques alrededor del de la cámara (5 × 5)
export const WATER_Y = -0.12;
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
    scene.add(this.water.mesh);
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
    for (const w of this.workers) w.postMessage({ t: 'init', seed: gen.seed, projects: village.getProjects(), family: village.familyHouse() });
  }
  dispose(b) { this.group.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); b.tex.dispose(); }
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
    this.water.mesh.position.set(x, WATER_Y, z);
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
  build(bx, bz, heights, water, colors) {
    const x0 = bx * BLOCK, z0 = bz * BLOCK, n = BLOCK + 1;
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
    if (water) geo.computeVertexNormals();
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
    return { mesh, tex, ctx: g, heights, x0, z0, n, bx, bz, season: this.season, todo: allChunks(), painted: 0 };
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
    if (!b) return this.gen ? Math.min(0, depthOf(this.gen, x, z)) : 0;
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
  m.onBeforeCompile = sh => {
    sh.uniforms.grassMap = D.grass; sh.uniforms.soilMap = D.soil;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D grassMap;\nuniform sampler2D soilMap;\nvarying vec2 vWorld;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 base = diffuseColor.rgb;
        float green = smoothstep(0.01, 0.06, base.g - max(base.r, base.b));
        float g1 = texture2D(grassMap, vWorld * 0.55).r / 0.85, g2 = texture2D(grassMap, vWorld * 0.13 + 0.37).r / 0.85;
        float s1 = texture2D(soilMap, vWorld * 0.6).r / 0.84;
        diffuseColor.rgb *= mix(mix(0.86, 1.1, s1), mix(0.82, 1.12, g1) * mix(0.92, 1.06, g2), green);`);
  };
  return m;
}

// Agua: un plano grande que sigue a la cámara; solo asoma donde el suelo está más bajo. Ondas en la normal,
// brillos que se mueven y algo de transparencia para ver el fondo
function makeWater() {
  const geo = new THREE.PlaneGeometry(520, 520, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.MeshStandardMaterial({ color: '#3f8fd0', roughness: 0.06, metalness: 0.2, transparent: true, opacity: 0.74 });
  const uniforms = { time: { value: 0 } };
  m.onBeforeCompile = sh => {
    sh.uniforms.time = uniforms.time;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vW;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float time;\nvarying vec2 vW;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec2 q = vW * 1.7;
        float w1 = sin(q.x * 1.3 + time * 1.1) * cos(q.y * 1.1 - time * 0.8), w2 = sin((q.x + q.y) * 2.3 - time * 1.7);
        normal = normalize(normal + (mat3(viewMatrix) * vec3(w1 * 0.06 + w2 * 0.03, 0.0, w2 * 0.05 - w1 * 0.03)));`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sp = sin(vW.x * 3.1 + time * 0.9) * sin(vW.y * 2.7 - time * 0.7);
        diffuseColor.rgb += vec3(0.05, 0.07, 0.08) * smoothstep(0.75, 1.0, sp);`);
  };
  const mesh = new THREE.Mesh(geo, m);
  mesh.renderOrder = 1;
  mesh.receiveShadow = true;
  return { mesh, uniforms };
}
