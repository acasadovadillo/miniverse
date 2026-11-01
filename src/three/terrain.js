// Suelo del mundo en 3D, en bloques de 4 × 4 trozos (64 casillas de lado) alrededor de la cámara. Cada bloque
// es una malla de un vértice por casilla, hundida donde hay agua (mar, lagos, el estanque del pueblo), y una
// textura pintada desde arriba con los mismos colores que el suelo del juego en 2D: el bioma con su paleta
// de la estación, sus manchas, y el camino y la orilla del estanque del pueblo. Encima, un detalle de briznas
// o de piedrecitas que no se repite a la vista. El agua es un plano que acompaña a la cámara.
import * as THREE from 'three';
import { CHUNK, RES } from '../world/gen.js';
import { B, BIOMES } from '../world/biomes.js';
import * as village from '../world/village.js';
import { seasonalPalette } from '../art/seasons.js';
import { ihash, vnoise, rgbOf } from '../util.js';
import { grassDetail, soilDetail } from './textures.js';
import { mat } from './geo.js';

export const BLOCK = CHUNK * 4;         // lado de un bloque de suelo, en casillas (metros)
const PX = 4;                           // píxeles de textura por metro
const RADIUS = 2;                       // bloques alrededor del de la cámara (5 × 5)
export const WATER_Y = -0.12;
const DEPTH = { deep: -1.25, shallow: -0.42 };
const DUNE = rgbOf('#c8a868'), DIRT = rgbOf('#c49a64'), DIRT_D = rgbOf('#a8804e'), SAND = rgbOf('#dcc791'), MUD = rgbOf('#8a7a5a');
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// Suelo propio del pueblo: el camino de tierra (con el borde irregular), la entrada de tu casa y la orilla de
// arena del estanque, con el fondo de barro
function villageGround(x, y, col, S) {
  const n1 = vnoise(x * 0.6, y * 0.6, S + 14), n2 = vnoise(x * 2.1, y * 2.1, S + 15);
  const p = village.distToPath(x, y) + (n1 - 0.5) * 0.35, door = Math.hypot((x - 21.5) / 1.6, (y - 17.6) / 0.8);
  const t = Math.max(1 - ss(0.62, 0.95, p), 1 - ss(0.85, 1.1, door));
  if (t > 0) col = mix3(col, mix3(DIRT, DIRT_D, n2 * 0.9), t);
  const pd = village.pondDist(x, y) + (n1 - 0.5) * 0.14;
  if (pd < 1.3) col = mix3(col, pd < 1 ? mix3(MUD, SAND, ss(0.6, 1, pd)) : SAND, 1 - ss(1.12, 1.3, pd));
  return col;
}

const allChunks = () => { const l = []; for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) l.push([i, j]); return l; };
// Profundidad del suelo en un punto (sin suavizar): 0 en tierra
function rawDepth(gen, x, z) {
  if (village.inBounds(x, z)) {
    const pd = village.pondDist(x, z);
    return pd < 1 ? -0.7 * (1 - pd * pd) - 0.1 : pd < 1.3 ? -0.1 * (1 - (pd - 1) / 0.3) : 0;
  }
  const w = BIOMES[gen.biomeAt(x, z)].water;
  return w ? DEPTH[w] : 0;
}

export class Terrain {
  constructor(scene) {
    this.scene = scene;
    this.blocks = new Map();      // "bx,bz" → { mesh, tex, heights, season }
    this.queue = [];
    this.gen = null;
    this.season = -1;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.water = makeWater();
    scene.add(this.water.mesh);
  }
  // El mundo cambió (otra partida, el menú): fuera todo lo hecho
  reset(gen) {
    for (const b of this.blocks.values()) this.dispose(b);
    this.blocks.clear();
    this.gen = gen;
    this.season = gen.season;
  }
  dispose(b) { this.group.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); b.tex.dispose(); }

  // Pone los bloques que tocan alrededor de (x, z) y quita los lejanos. budget: milisegundos para hacer bloques nuevos
  update(gen, x, z, budget = 8) {
    if (gen !== this.gen) this.reset(gen);
    // Cambió la estación: se repinta todo (poco a poco, empezando por lo cercano)
    if (gen.season !== this.season) { this.season = gen.season; for (const b of this.blocks.values()) b.stale = true; }
    const bx = Math.floor(x / BLOCK), bz = Math.floor(z / BLOCK), want = [];
    for (let dz = -RADIUS; dz <= RADIUS; dz++) for (let dx = -RADIUS; dx <= RADIUS; dx++) want.push([bx + dx, bz + dz, dx * dx + dz * dz]);
    want.sort((a, b) => a[2] - b[2]);
    const keep = new Set(want.map(([a, b]) => `${a},${b}`));
    for (const [k, b] of this.blocks) if (!keep.has(k)) { this.dispose(b); this.blocks.delete(k); }
    const t0 = performance.now();
    // Primero la forma (un bloque nuevo por fotograma, con un color provisional) y luego la textura, un trozo
    // cada vez, empezando por lo más cercano: así no hay tirones al andar
    let built = 0;
    for (const [a, b] of want) {
      const k = `${a},${b}`, cur = this.blocks.get(k);
      if (cur) { if (cur.stale) { cur.stale = false; cur.todo = allChunks(); } continue; }
      if (built && performance.now() - t0 > budget) break;
      this.blocks.set(k, this.build(a, b));
      built++;
    }
    for (const [a, b] of want) {
      const blk = this.blocks.get(`${a},${b}`);
      while (blk?.todo.length && (performance.now() - t0 < budget || budget > 1e8)) this.paintChunk(blk, blk.todo.shift());
      if (performance.now() - t0 > budget && budget < 1e8) break;
    }
    this.water.mesh.position.set(x, WATER_Y, z);
  }
  // ¿Están hechos los bloques de alrededor de (x, z)? (para no empezar a jugar sobre el vacío)
  ready(x, z) { return this.blocks.has(`${Math.floor(x / BLOCK)},${Math.floor(z / BLOCK)}`); }

  build(bx, bz) {
    const gen = this.gen, x0 = bx * BLOCK, z0 = bz * BLOCK, n = BLOCK + 1;
    // Alturas: un vértice por casilla, con un borde de más para suavizar la orilla. Si a 2 m no se ve agua en
    // todo el bloque, es llano (y no hace falta mirar casilla a casilla)
    let water = false;
    for (let j = -1; j <= BLOCK / 2 + 1 && !water; j++) for (let i = -1; i <= BLOCK / 2 + 1; i++) if (rawDepth(gen, x0 + i * 2, z0 + j * 2) < 0) { water = true; break; }
    const raw = new Float32Array((n + 2) * (n + 2));
    if (water) for (let j = -1; j <= n; j++) for (let i = -1; i <= n; i++) raw[(j + 1) * (n + 2) + i + 1] = rawDepth(gen, x0 + i, z0 + j);
    const heights = new Float32Array(n * n), pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      let s = 0;
      for (let dj = 0; dj < 3; dj++) for (let di = 0; di < 3; di++) s += raw[(j + dj) * (n + 2) + i + di] * (di === 1 && dj === 1 ? 4 : 1);
      const c = raw[(j + 1) * (n + 2) + i + 1], h = c < 0 ? Math.min(c * 0.6 + (s / 12) * 0.4, s / 12) : s / 12;
      heights[j * n + i] = h;
      const v = j * n + i;
      pos[v * 3] = x0 + i; pos[v * 3 + 1] = h; pos[v * 3 + 2] = z0 + j;
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
    // Textura: de entrada, cada trozo del color medio de su bioma; luego se pinta de verdad (paintChunk)
    const W = BLOCK * PX, c = document.createElement('canvas');
    c.width = c.height = W;
    const g = c.getContext('2d');
    for (let cj = 0; cj < 4; cj++) for (let ci = 0; ci < 4; ci++) {
      const b = gen.biomeAt((bx * 4 + ci + 0.5) * CHUNK, (bz * 4 + cj + 0.5) * CHUNK), pal = seasonalPalette(b, BIOMES[b], gen.season);
      g.fillStyle = `rgb(${pal[0].join(',')})`; g.fillRect(ci * CHUNK * PX, cj * CHUNK * PX, CHUNK * PX, CHUNK * PX);
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
    return { mesh, tex, ctx: g, heights, x0, z0, n, bx, bz, todo: allChunks() };
  }

  // Pinta uno de los 16 trozos de la textura de un bloque, vista desde arriba: el color del bioma de cada cuarto
  // de casilla (del campo de biomas del trozo), mezclando suave los cuatro tonos de su paleta, y el camino y la
  // orilla del estanque del pueblo con el borde irregular
  paintChunk(blk, [ci, cj]) {
    const gen = this.gen, N = CHUNK * PX, step = RES / PX, S = gen.seed;
    const cx = blk.bx * 4 + ci, cy = blk.bz * 4 + cj, f = gen.field(cx, cy), near = gen.nearVillage(cx, cy);
    const img = blk.ctx.createImageData(N, N), d = img.data;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const si = Math.min(f.n - 1, Math.round(i * step)), sj = Math.min(f.n - 1, Math.round(j * step)), s = sj * f.n + si;
      const gx = cx * CHUNK + (i + 0.5) / PX, gy = cy * CHUNK + (j + 0.5) / PX, h = ihash(Math.floor(gx * PX), Math.floor(gy * PX), 77);
      const biome = f.biome[s], info = BIOMES[biome], pal = seasonalPalette(biome, info, gen.season);
      const k = f.patch[s] + (vnoise(gx * 0.9, gy * 0.9, S + 12) - 0.5) * 0.25;
      let col = mix3(mix3(pal[3], pal[0], ss(0.18, 0.42, k)), mix3(pal[1], pal[2], ss(0.6, 0.85, k)), ss(0.45, 0.62, k));
      if (biome === B.DESERT && Math.sin((gx + gy * 0.6) * 4 + f.patch[s] * 9) > 0.93) col = mix3(col, DUNE, 0.6);
      const sh = 1 + (h - 0.5) * 0.08;
      if (near && village.inBounds(gx, gy)) col = villageGround(gx, gy, col, S);
      const o = (j * N + i) * 4;
      d[o] = col[0] * sh; d[o + 1] = col[1] * sh; d[o + 2] = col[2] * sh; d[o + 3] = 255;
    }
    blk.ctx.putImageData(img, ci * N, cj * N);
    // (se sube a la gráfica cada cuatro trozos pintados, no con cada uno)
    if (blk.todo.length % 4 === 0) blk.tex.needsUpdate = true;
  }

  // Altura del suelo en (x, z): la de la malla si su bloque está hecho; si no, la de la profundidad sin suavizar
  heightAt(x, z) {
    const b = this.blocks.get(`${Math.floor(x / BLOCK)},${Math.floor(z / BLOCK)}`);
    if (!b) return this.gen ? Math.min(0, rawDepth(this.gen, x, z)) : 0;
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
