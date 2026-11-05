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
const DUNE = rgbOf('#c8a868'), DIRT = rgbOf('#c49a64'), DIRT_D = rgbOf('#a8804e'), SAND = rgbOf('#dcc791'), MUD = rgbOf('#8a7a5a');
// La orilla y el fondo, por clase (arena, barro, lodo): el borde seco, el mojado junto al agua y el fondo hondo
// La orilla y el fondo, por clase (arena, barro, lodo): el borde seco y el mojado junto al agua; y el agua misma, pintada
// en el suelo (la malla de agua de encima se desvanece en el borde, así la línea de la orilla la da esta pintura, que es
// más fina que la malla): de clara en la orilla, con una línea de espuma, a honda
const SHORE = [[SAND, rgbOf('#ad9560')], [rgbOf('#9c8a64'), rgbOf('#6e5e42')], [rgbOf('#5a5a3c'), rgbOf('#3c3c2a')]], SHALLOW_W = rgbOf('#86c6cc'), DEEP = rgbOf('#2f6a9a'), FOAM = rgbOf('#eef6f8');
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

// Profundidad del suelo en un punto, seguida (0 en tierra): el estanque del pueblo por su distancia; lo demás, por
// el clima (gen.depthAt)
export function depthOf(gen, x, z) {
  if (village.inBounds(x, z)) {
    const pd = village.pondDist(x, z);
    return pd < 1 ? -0.7 * (1 - pd * pd) - 0.1 : pd < 1.3 ? -0.1 * (1 - (pd - 1) / 0.3) : 0;
  }
  return gen.depthAt(x, z);
}

// Las alturas de un bloque (un vértice por casilla, hundido donde hay agua según la profundidad seguida) y los
// biomas de sus esquinas (n+2 por lado, desde una casilla antes del bloque) y de los centros de sus casillas (BLOCK
// por lado), para que el juego no los tenga que volver a calcular. Si a 2 m no se ve agua en todo el bloque, es llano
export function blockHeights(gen, bx, bz) {
  const x0 = bx * BLOCK, z0 = bz * BLOCK, n = BLOCK + 1, m = n + 2;
  const corners = new Uint8Array(m * m), centers = new Uint8Array(BLOCK * BLOCK);
  for (let j = -1; j <= n; j++) for (let i = -1; i <= n; i++) corners[(j + 1) * m + i + 1] = gen.biomeAt(x0 + i, z0 + j);
  for (let j = 0; j < BLOCK; j++) for (let i = 0; i < BLOCK; i++) centers[j * BLOCK + i] = gen.biomeAt(x0 + i + 0.5, z0 + j + 0.5);
  let water = false;
  for (let j = -1; j <= BLOCK / 2 + 1 && !water; j++) for (let i = -1; i <= BLOCK / 2 + 1; i++) if (depthOf(gen, x0 + i * 2, z0 + j * 2) < 0) { water = true; break; }
  const heights = new Float32Array(n * n);
  if (water) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = depthOf(gen, x0 + i, z0 + j);
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

// Lo que abarca la mezcla de biomas al pintar el suelo, en muestras de cuarto de casilla: BLEND a cada lado (una franja
// de dos casillas) más SWAY, lo que se mueve con el ruido para que la franja no siga la rejilla
const BLEND = 4, SWAY = 2, MARGIN = BLEND + SWAY;
// Los biomas de alrededor de un trozo (con MARGIN muestras de más por cada lado, de los trozos vecinos) y, si hay más
// de un bioma de tierra, cuántas muestras de cada uno hay en cada rectángulo (tablas de sumas): así se sabe en un
// momento cuánto de cada bioma hay alrededor de un punto. El agua no cuenta: su orilla ya se pinta aparte. Sin borde
// en el trozo (lo normal), devuelve null
function biomeBlend(gen, cx, cy, f) {
  const N = CHUNK * RES, P = N + 1 + 2 * MARGIN, grid = new Uint8Array(P * P), near = new Array(9), seen = new Uint8Array(BIOMES.length);
  near[4] = f;
  for (let j = -MARGIN; j <= N + MARGIN; j++) {
    const fy = j < 0 ? -1 : j > N ? 1 : 0, sj = j - fy * N, row = (j + MARGIN) * P + MARGIN;
    for (let i = -MARGIN; i <= N + MARGIN; i++) {
      const fx = i < 0 ? -1 : i > N ? 1 : 0, q = (fy + 1) * 3 + fx + 1, g = near[q] || (near[q] = gen.field(cx + fx, cy + fy));
      seen[grid[row + i] = g.biome[sj * g.n + i - fx * N]] = 1;
    }
  }
  const list = [];
  for (let b = 0; b < seen.length; b++) if (seen[b] && !BIOMES[b].water) list.push(b);
  if (list.length < 2) return null;
  const W = P + 1, sums = list.map(b => {
    const t = new Int32Array(W * W);
    for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) t[(j + 1) * W + i + 1] = t[j * W + i + 1] + t[(j + 1) * W + i] - t[j * W + i] + (grid[j * P + i] === b ? 1 : 0);
    return t;
  });
  return { list, sums, W, P };
}

// Los píxeles de un trozo de la textura, visto desde arriba: el color del bioma de cada cuarto de casilla (del campo
// de biomas del trozo), mezclando suave los cuatro tonos de su paleta y, en los bordes, con los biomas de alrededor; junto al agua, la orilla (arena, barro o lodo,
// mojada al borde) y, debajo, el fondo, que se oscurece con la profundidad; y el camino y la orilla del estanque del
// pueblo con el borde irregular. field: gen.field(cx, cy) (se pasa para poder guardarlo en caché aparte)
export function paintPixels(gen, cx, cy, season, field = gen.field(cx, cy)) {
  const N = CHUNK * PX, step = RES / PX, S = gen.seed, f = field, near = gen.nearVillage(cx, cy), blend = biomeBlend(gen, cx, cy, f);
  const d = new Uint8ClampedArray(N * N * 4), tone = (pal, k) => mix3(mix3(pal[3], pal[0], ss(0.18, 0.42, k)), mix3(pal[1], pal[2], ss(0.6, 0.85, k)), ss(0.45, 0.62, k));
  const pals = blend && blend.list.map(b => seasonalPalette(b, BIOMES[b], season));
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const si = Math.min(f.n - 1, Math.round(i * step)), sj = Math.min(f.n - 1, Math.round(j * step)), s = sj * f.n + si;
    const gx = cx * CHUNK + (i + 0.5) / PX, gy = cy * CHUNK + (j + 0.5) / PX, h = ihash(Math.floor(gx * PX), Math.floor(gy * PX), 77);
    const biome = f.biome[s], info = BIOMES[biome], pal = seasonalPalette(biome, info, season);
    const k = f.patch[s] + (vnoise(gx * 0.9, gy * 0.9, S + 12) - 0.5) * 0.25;
    let col = tone(pal, k), own = 1;
    if (blend && !info.water) {
      // Cuánto hay de cada bioma en un cuadrado alrededor del punto, movido con el ruido (si en todo lo que puede
      // abarcar solo hay de un bioma, no hay nada que mezclar: es lo normal, salvo en la franja del borde)
      const { list, sums, W, P } = blend, m = MARGIN, whole = sums[list.indexOf(biome)], all = (2 * m + 1) * (2 * m + 1);
      const inBox = (t, x0, y0, x1, y1) => t[y1 * W + x1] - t[y0 * W + x1] - t[y1 * W + x0] + t[y0 * W + x0];
      if (whole && inBox(whole, si, sj, si + 2 * m + 1, sj + 2 * m + 1) === all) { /* (solo este bioma) */ } else {
      const qx = si + m + Math.round((vnoise(gx * 0.8, gy * 0.8, S + 16) - 0.5) * 2 * SWAY), qy = sj + m + Math.round((vnoise(gx * 0.8, gy * 0.8, S + 17) - 0.5) * 2 * SWAY);
      const x0 = Math.max(0, qx - BLEND), x1 = Math.min(P, qx + BLEND + 1), y0 = Math.max(0, qy - BLEND), y1 = Math.min(P, qy + BLEND + 1);
      let total = 0, r = 0, g = 0, b = 0;
      for (let q = 0; q < list.length; q++) {
        const c = inBox(sums[q], x0, y0, x1, y1);
        if (!c) continue;
        const v = tone(pals[q], k);
        total += c; r += v[0] * c; g += v[1] * c; b += v[2] * c;
        if (list[q] === biome) own = c;
      }
      if (total) { col = [r / total, g / total, b / total]; own /= total; }
      }
    }
    if (biome === B.DESERT && Math.sin((gx + gy * 0.6) * 4 + f.patch[s] * 9) > 0.93) col = mix3(col, DUNE, 0.6 * own);
    const u = info.water ? Math.max(f.wet[s], -0.2) : f.wet[s];   // (el tramado de los biomas de agua, como borde mojado)
    if (u > -0.45) {   // la orilla, el borde mojado y el fondo
      const [dry, wetc] = SHORE[f.shore[s]];
      col = u <= 0 ? mix3(col, mix3(dry, wetc, ss(-0.2, 0, u)), ss(-0.45, -0.15, u)) : mix3(mix3(SHALLOW_W, DEEP, ss(0, 1, u)), FOAM, 0.6 * (1 - ss(0, 0.08, u)));
    }
    const sh = 1 + (h - 0.5) * 0.08;
    if (near && village.inBounds(gx, gy)) col = villageGround(gx, gy, col, S);
    const o = (j * N + i) * 4;
    d[o] = col[0] * sh; d[o + 1] = col[1] * sh; d[o + 2] = col[2] * sh; d[o + 3] = 255;
  }
  return d;
}
