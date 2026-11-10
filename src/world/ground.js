// El suelo del mundo, en números: lo que necesita la vista en 3D para hacer los bloques de terreno (sus alturas) y
// pintar su textura (los píxeles de cada trozo), y los biomas de las casillas. Todo son funciones puras del
// generador, sin nada de dibujo ni de documento: así se calculan igual en el hilo principal (si no hay otro) y en el
// hilo aparte (genworker.js), que es donde van normalmente para que el juego no dé tirones al estrenar terreno.
import { CHUNK, RES } from './gen.js';
import { B, BIOMES, climate, classify, biomeAt, wetness, depthOfWet, reliefOf } from './biomes.js';
import * as village from './village.js';
import { seasonalPalette } from '../art/seasons.js';
import { ihash, vnoise, rgbOf } from '../util.js';
import { PAL } from '../arte.js';

export const BLOCK = CHUNK * 4;         // lado de un bloque de suelo, en casillas (metros)
export const PX = 4;                    // píxeles de textura por metro
// Dunas, camino (claro y oscuro), arena y barro (de la paleta sobria). La orilla, por clase (arena, barro, lodo): el borde
// seco y el mojado junto al agua; y el agua misma, pintada en el suelo (la malla de agua de encima se desvanece en el
// borde, así la línea de la orilla la da esta pintura, que es más fina que la malla): de clara en la orilla, con una
// línea de espuma, a honda
const DUNE = rgbOf('#b3a27c'), DIRT = rgbOf(PAL.suelo.camino), DIRT_D = rgbOf(PAL.suelo.tierra), SAND = rgbOf(PAL.suelo.arena), MUD = rgbOf(PAL.suelo.barro);
const SHORE = [[SAND, rgbOf('#8f8164')], [rgbOf('#80745d'), rgbOf('#665b48')], [rgbOf('#5a5244'), rgbOf('#3f3a30')]];
const SHALLOW_W = rgbOf(PAL.agua.orilla), DEEP = rgbOf(PAL.agua.profunda), FOAM = rgbOf(PAL.agua.espuma);
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
// Lo mismo, como lo da la malla del suelo (un vértice por casilla y, entre medias, los dos triángulos de cada casilla,
// como terrain.heightAt): para poner algo en el suelo antes de que esté hecho su bloque y que luego no flote ni se hunda.
// k: lo que se allana cada vértice junto a lo construido (padK), como hace la malla
export function groundSmooth(gen, x, z, k = null) {
  const x0 = Math.floor(x), z0 = Math.floor(z), fu = x - x0, fv = z - z0;
  const at = (i, j) => { const h = groundOf(gen, i, j); return k && h > 0.01 ? h * k(i, j) : h; };
  const b = at(x0 + 1, z0), c = at(x0, z0 + 1);
  // (cada casilla son dos triángulos: a-c-b y b-c-d)
  if (fu + fv <= 1) { const a = at(x0, z0); return a + (b - a) * fu + (c - a) * fv; }
  const d = at(x0 + 1, z0 + 1); return d + (c - d) * (1 - fu) + (b - d) * (1 - fv);
}
// La altura del suelo (sin lo construido): en el pueblo, la del estanque; fuera, el agua o el relieve (gen.groundAt)
export function groundOf(gen, x, z) {
  if (village.inBounds(x, z)) return depthOf(gen, x, z);
  return gen.groundAt(x, z);
}
// Lo mismo con el clima de ese punto ya calculado (c, de climate): da justo lo mismo que groundOf, bit a bit (las mismas
// cuentas que gen.groundAt), y así blockHeights saca el bioma y la altura de cada vértice de una sola vez
function groundWith(gen, x, z, c) {
  if (village.inBounds(x, z)) return depthOf(gen, x, z);
  const u = wetness(c);
  return u > 0 ? depthOfWet(u) : reliefOf(c, u, x, z, gen.seed);
}

// Las alturas de un bloque, un vértice por casilla y todas exactas (el relieve casilla a casilla, hundido donde hay agua
// según la profundidad seguida: lo mismo que gen.groundAt, que es lo que usa lo construido para apoyarse), más el anillo
// de vértices de alrededor (edge: los de la casilla de antes y de después por cada lado, para que las normales del borde
// salgan iguales a las del bloque de al lado), las normales (blockNormals), y los biomas de sus esquinas (n+2 por lado,
// desde una casilla antes del bloque) y de los centros de sus casillas (BLOCK por lado), para que el juego no los tenga
// que volver a calcular. water: si hay algo bajo el agua en el bloque (para su malla)
// (las esquinas de los biomas y los vértices con su anillo son los mismos puntos: el clima se calcula una vez para los dos)
export function blockHeights(gen, bx, bz) {
  const x0 = bx * BLOCK, z0 = bz * BLOCK, n = BLOCK + 1, m = n + 2, S = gen.seed, c = {};
  const corners = new Uint8Array(m * m), centers = new Uint8Array(BLOCK * BLOCK), heights = new Float32Array(n * n), edge = new Float32Array(4 * n);
  let water = false;
  for (let j = -1; j <= n; j++) for (let i = -1; i <= n; i++) {
    const x = x0 + i, z = z0 + j;
    climate(x, z, S, c);
    corners[(j + 1) * m + i + 1] = classify(c.T, c.M, c.C, c.R, c.L, c.K, c.P, c.f, 0, c.Q, c.Tl, c.Ml);   // (= biomeAt)
    const ii = i < 0 || i === n, jj = j < 0 || j === n;
    if (ii && jj) continue;   // (las esquinas del anillo no hacen falta)
    const h = groundWith(gen, x, z, c);
    if (!ii && !jj) { heights[j * n + i] = h; if (h < 0) water = true; }
    else edge[ii ? (i < 0 ? 0 : n) + j : (j < 0 ? 2 * n : 3 * n) + i] = h;
  }
  for (let j = 0; j < BLOCK; j++) for (let i = 0; i < BLOCK; i++) centers[j * BLOCK + i] = biomeAt(x0 + i + 0.5, z0 + j + 0.5, S);
  return { heights, edge, normals: blockNormals(heights, edge, n), water, corners, centers, n, m };
}
// El anillo de un bloque: edge[0..n) la columna de antes (x0 - 1, z0 + j), [n..2n) la de después (x0 + n), [2n..3n) la
// fila de antes (x0 + i, z0 - 1) y [3n..4n) la de después (z0 + n)
export const edgeAt = (n, i, j) => i < 0 ? j : i >= n ? n + j : j < 0 ? 2 * n + i : 3 * n + i;
// Las normales de los vértices de un bloque, por diferencias centrales (con el anillo en el borde): ∝ (-dh/dx, 1, -dh/dz).
// Cada vértice da la misma normal se calcule desde el bloque que se calcule, y así no hay una línea de luz cada 64 m en
// las sierras (con las normales de los triángulos de cada bloque por separado, el borde solo veía su lado)
export function blockNormals(H, edge, n, out = new Float32Array(n * n * 3)) {
  const at = (i, j) => (i < 0 || i >= n || j < 0 || j >= n ? edge[edgeAt(n, i, j)] : H[j * n + i]);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (at(i - 1, j) - at(i + 1, j)) * 0.5, z = (at(i, j - 1) - at(i, j + 1)) * 0.5, l = 1 / Math.sqrt(x * x + 1 + z * z), o = (j * n + i) * 3;
    out[o] = x * l; out[o + 1] = l; out[o + 2] = z * l;
  }
  return out;
}

// La huella del relieve: cambia si cambia cualquier cosa de la que salen las alturas y los biomas de blockHeights (su
// código, el del clima y el relieve, o sus constantes, que se ven en lo que dan unos puntos de prueba). Es la clave de
// lo guardado (groundcache.js): con otra semilla u otro código, lo guardado no vale. Se calcula con el código que corre
// de verdad en el hilo (un genworker.js viejo de la caché del navegador da otra huella). Sube RELIEF_V a mano si cambia
// algo que esto no vea
export const RELIEF_V = 1;
export function groundTag(gen) {
  let h = 2166136261;
  const f = new Float32Array(1), u = new Uint32Array(f.buffer), mix = v => { h = Math.imul(h ^ v, 16777619); };
  const text = fn => { const t = String(fn); for (let i = 0; i < t.length; i++) mix(t.charCodeAt(i)); };
  for (const fn of [blockHeights, groundWith, groundOf, depthOf, climate, classify, biomeAt, wetness, depthOfWet, reliefOf, gen.groundAt, gen.depthAt, village.pondDist, village.inBounds]) text(fn);
  // (puntos de prueba: por todo el planeta, alrededor del pueblo y su estanque, y unos cuantos al azar cerca)
  const P = [];
  for (let j = 0; j < 12; j++) for (let i = 0; i < 12; i++) P.push([-32768 + i * 5461.3 + j * 97, -6000 + j * 1000 + i * 31]);
  for (const [x, z] of [[31.5, 27], [20, 30], [0.5, 1.5], [39.5, 61.5], [60, 24], [150, 24], [-120, 80], [400, -300], [-900, 1200], [2000, -1500]]) P.push([x, z]);
  for (let k = 0; k < 64; k++) P.push([((k * 2654435761) % 4001) - 2000 + 0.25, ((k * 40503) % 3001) - 1500 + 0.75]);
  for (const [x, z] of P) { f[0] = groundOf(gen, x, z); mix(u[0]); mix(biomeAt(x, z, gen.seed)); }
  mix(BLOCK);
  return `s${gen.seed}.v${RELIEF_V}.${(h >>> 0).toString(36)}`;
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
