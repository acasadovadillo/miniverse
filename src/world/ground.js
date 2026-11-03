// El suelo del mundo, en números: lo que necesita la vista en 3D para hacer los bloques de terreno (sus alturas) y
// pintar su textura (los píxeles de cada trozo), y los biomas de las casillas. Todo son funciones puras del
// generador, sin nada de dibujo ni de documento: así se calculan igual en el hilo principal (si no hay otro) y en el
// hilo aparte (genworker.js), que es donde van normalmente para que el juego no dé tirones al estrenar terreno.
import { CHUNK, RES } from './gen.js';
import { B, BIOMES } from './biomes.js';
import * as village from './village.js';
import { seasonalPalette } from '../art/seasons.js';
import { ihash, vnoise, rgbOf } from '../util.js';

export const BLOCK = CHUNK * 4;         // lado de un bloque de suelo, en casillas (metros)
export const PX = 4;                    // píxeles de textura por metro
export const DEPTH = { deep: -1.25, shallow: -0.42 };
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

// Profundidad del suelo en un punto (sin suavizar): 0 en tierra. biome: el del punto, si ya se sabe
export function depthOf(gen, x, z, biome) {
  if (village.inBounds(x, z)) {
    const pd = village.pondDist(x, z);
    return pd < 1 ? -0.7 * (1 - pd * pd) - 0.1 : pd < 1.3 ? -0.1 * (1 - (pd - 1) / 0.3) : 0;
  }
  const w = BIOMES[biome ?? gen.biomeAt(x, z)].water;
  return w ? DEPTH[w] : 0;
}

// Las alturas de un bloque (un vértice por casilla, con un borde de más para suavizar la orilla) y los biomas de
// sus esquinas (n+2 por lado, desde una casilla antes del bloque) y de los centros de sus casillas (BLOCK por lado),
// para que el juego no los tenga que volver a calcular. Si a 2 m no se ve agua en todo el bloque, es llano
export function blockHeights(gen, bx, bz) {
  const x0 = bx * BLOCK, z0 = bz * BLOCK, n = BLOCK + 1, m = n + 2;
  const corners = new Uint8Array(m * m), centers = new Uint8Array(BLOCK * BLOCK);
  for (let j = -1; j <= n; j++) for (let i = -1; i <= n; i++) corners[(j + 1) * m + i + 1] = gen.biomeAt(x0 + i, z0 + j);
  for (let j = 0; j < BLOCK; j++) for (let i = 0; i < BLOCK; i++) centers[j * BLOCK + i] = gen.biomeAt(x0 + i + 0.5, z0 + j + 0.5);
  const corner = (i, j) => (i >= -1 && i <= n && j >= -1 && j <= n ? corners[(j + 1) * m + i + 1] : undefined);
  let water = false;
  for (let j = -1; j <= BLOCK / 2 + 1 && !water; j++) for (let i = -1; i <= BLOCK / 2 + 1; i++) if (depthOf(gen, x0 + i * 2, z0 + j * 2, corner(i * 2, j * 2)) < 0) { water = true; break; }
  const raw = new Float32Array(m * m);
  if (water) for (let j = -1; j <= n; j++) for (let i = -1; i <= n; i++) { const k = (j + 1) * m + i + 1; raw[k] = depthOf(gen, x0 + i, z0 + j, corners[k]); }
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let s = 0;
    for (let dj = 0; dj < 3; dj++) for (let di = 0; di < 3; di++) s += raw[(j + dj) * m + i + di] * (di === 1 && dj === 1 ? 4 : 1);
    const c = raw[(j + 1) * m + i + 1];
    heights[j * n + i] = c < 0 ? Math.min(c * 0.6 + (s / 12) * 0.4, s / 12) : s / 12;
  }
  return { heights, water, corners, centers, n, m };
}

// El color medio de cada trozo de un bloque (16 trozos: el bioma del centro con su paleta de la estación), para
// pintar la textura de entrada mientras se pinta de verdad
export function blockColors(gen, bx, bz, season) {
  const out = new Uint8Array(16 * 3);
  for (let cj = 0; cj < 4; cj++) for (let ci = 0; ci < 4; ci++) {
    const b = gen.biomeAt((bx * 4 + ci + 0.5) * CHUNK, (bz * 4 + cj + 0.5) * CHUNK), pal = seasonalPalette(b, BIOMES[b], season);
    out.set(pal[0], (cj * 4 + ci) * 3);
  }
  return out;
}

// Los píxeles de un trozo de la textura, visto desde arriba: el color del bioma de cada cuarto de casilla (del campo
// de biomas del trozo), mezclando suave los cuatro tonos de su paleta, y el camino y la orilla del estanque del
// pueblo con el borde irregular. field: gen.field(cx, cy) (se pasa para poder guardarlo en caché aparte)
export function paintPixels(gen, cx, cy, season, field = gen.field(cx, cy)) {
  const N = CHUNK * PX, step = RES / PX, S = gen.seed, f = field, near = gen.nearVillage(cx, cy);
  const d = new Uint8ClampedArray(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const si = Math.min(f.n - 1, Math.round(i * step)), sj = Math.min(f.n - 1, Math.round(j * step)), s = sj * f.n + si;
    const gx = cx * CHUNK + (i + 0.5) / PX, gy = cy * CHUNK + (j + 0.5) / PX, h = ihash(Math.floor(gx * PX), Math.floor(gy * PX), 77);
    const biome = f.biome[s], info = BIOMES[biome], pal = seasonalPalette(biome, info, season);
    const k = f.patch[s] + (vnoise(gx * 0.9, gy * 0.9, S + 12) - 0.5) * 0.25;
    let col = mix3(mix3(pal[3], pal[0], ss(0.18, 0.42, k)), mix3(pal[1], pal[2], ss(0.6, 0.85, k)), ss(0.45, 0.62, k));
    if (biome === B.DESERT && Math.sin((gx + gy * 0.6) * 4 + f.patch[s] * 9) > 0.93) col = mix3(col, DUNE, 0.6);
    const sh = 1 + (h - 0.5) * 0.08;
    if (near && village.inBounds(gx, gy)) col = villageGround(gx, gy, col, S);
    const o = (j * N + i) * 4;
    d[o] = col[0] * sh; d[o + 1] = col[1] * sh; d[o + 2] = col[2] * sh; d[o + 3] = 255;
  }
  return d;
}
