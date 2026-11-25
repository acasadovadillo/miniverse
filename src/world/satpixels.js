// The pixels of the maps' satellite picture (docs/planes/realismo/PLAN-R8-hud-mapa.md §3.4): pure numbers, no canvas and no
// document, so they are made in the ground worker (genworker.js jobs 'sat' and 'thumb') and, without a worker, here.
//   satPixels    a chunk from above at SAT_PX px per tile (64 × 64, RGBA): the same paint as the ground of the world
//                (ground.js paintPixels: biomes, blends, shores, the village paths), the water as water, the relief
//                shaded with the light from the north-west, and the trees as soft round crowns with a small shadow
//   thumbPixels  the same chunk at 1 px per tile (16 × 16, RGBA), from the biome field alone: for the widest zooms
//   satHeights   the land's heights on a grid (jobs 'satmesh'), and satTrees, a chunk's trees (job 'sattrees'): the 3D map's
// Both show the land as it was generated (what players changed goes on top: ui/mapoverlay.js), only what stands in sight:
// never what lies on the sea bed (gen.seabed is not read), nor caves, nor undiscovered places.
// opts: gone (the keys of what was felled or cut there: not drawn), clear ([[x0, y0, x1, y1]…]: no trees inside), paint (the
// chunk's paint, already made: it is drawn over)
import { CHUNK, RES } from './gen.js';
import { B, BIOMES } from './biomes.js';
import * as village from './village.js';
import { PX, paintPixels } from './ground.js';
import { canopyOf } from './treedims.js';
import { seasonalPalette } from '../art/seasons.js';
import { ihash, rgbOf } from '../util.js';
import { PAL, HOJAS, SAUCE } from '../arte.js';
import { wrapIndex, wrapX, WATER_Y, NORTH, SOUTH } from './planet.js';

export const SAT_PX = PX;                 // px per tile of a tile picture
export const SAT_N = CHUNK * SAT_PX;      // its side
// The relief: the light from the north-west, 45° up; SLOPE makes the hills read (a slope is seen from straight above), and
// the result is kept within HILL (so no slope goes black or white)
const HILL = [0.74, 1.16], SLOPE = 1.5, L_XY = 0.5, L_Z = Math.SQRT1_2;
const REACH = 3;                          // (tiles beyond the chunk whose trees may reach into it)
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const ROCK = [122, 116, 106], WATER_IN = rgbOf('#4f8f9c'), WATER_OUT = rgbOf('#274f66'), POND = rgbOf('#4a7f8c'), ROOF = rgbOf('#9c6a50'), PATH = rgbOf(PAL.suelo.camino);
// The crowns by kind, from spring to winter: [a colour, one of them by the tree's place…]; null: bare (in winter, twigs)
// (a little greyer and darker than each leaf is: a whole crown from above)
const soft = c => { const m = (c[0] + c[1] + c[2]) / 3; return c.map(v => (v + (m - v) * 0.2) * 0.92); };
const same = (...c) => Array(4).fill(c.map(rgbOf)), leaves = [0, 1, 2].map(i => HOJAS[i].c.map(c => soft(rgbOf(c))));
const CROWN = {
  oak: [...leaves, null], fruit: [...leaves, null], pear: [...leaves, null], cherry: [...leaves, null], bush: [...leaves, [rgbOf('#858c84')]], swampTree: [0, 1, 2].map(i => SAUCE[i].c.map(c => soft(rgbOf(c)))).concat([null]),
  pine: same(PAL.follaje.pino, '#475a45', '#3a4c3d'), snowPine: [same('#5d6f5f')[0], same('#4f6250')[0], same('#5d6f5f')[0], same('#a9b5b4', '#97a5a3')[0]],
  palm: same('#6f7f49', '#78884f'), cactus: same('#5f7350'), boulder: same('#8d8a82', '#7f7c74'), snowBoulder: same('#c9cfd1'),
};
const TWIG = rgbOf('#6a5c4c'), SMALL = { bush: 0.5, cactus: 0.5, boulder: 0.75, snowBoulder: 0.65 };
// How much of each biome's tiles the crowns cover, and their colour, for the 1 px pictures (no object list there)
const WOOD = { [B.FOREST]: 0.5, [B.PINES]: 0.5, [B.SWAMP]: 0.22, [B.SNOW]: 0.18, [B.MEADOW]: 0.06 };

// The land's height for the shading: flat on water and in the village (the world levels both)
const heightOf = (gen, x, y) => (village.inBounds(x, y) ? 0 : Math.max(0, gen.groundAt(x, y)));
// How lit the 17 × 17 corners of a chunk are (1: flat; out: steep), from the heights of the 19 × 19 around them
function shadeGrid(gen, cx, cy) {
  const n = CHUNK + 1, m = n + 2, h = new Float32Array(m * m), x0 = cx * CHUNK - 1, y0 = cy * CHUNK - 1;
  let any = false;
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) if ((h[j * m + i] = heightOf(gen, x0 + i, y0 + j)) > 0) any = true;
  if (!any) return null;
  const lit = new Float32Array(n * n), steep = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const q = (j + 1) * m + i + 1, dx = (h[q + 1] - h[q - 1]) / 2, dy = (h[q + m] - h[q - m]) / 2;
    lit[j * n + i] = hillshade(dx, dy); steep[j * n + i] = Math.hypot(dx, dy);
  }
  return { lit, steep, n };
}
// The light on a slope that goes up dx metres per metre to the east and dy to the south (1: flat ground)
export function hillshade(dx, dy) {
  dx *= SLOPE; dy *= SLOPE;
  const v = (dx * L_XY + dy * L_XY + L_Z) / Math.sqrt(1 + dx * dx + dy * dy) / L_Z;
  return Math.max(HILL[0], Math.min(HILL[1], v));
}
const bil = (a, n, x, y) => { const i = Math.min(n - 2, x | 0), j = Math.min(n - 2, y | 0), u = x - i, v = y - j, q = j * n + i; return (a[q] * (1 - u) + a[q + 1] * u) * (1 - v) + (a[q + n] * (1 - u) + a[q + n + 1] * u) * v; };

// The trees and big bushes of a chunk as [x, y (in the chunk), r, kind, key, a number of its own], remembered (a chunk's picture needs those of its neighbours)
const TREES_MAX = 260;
function treesOf(gen, cx, cy) {
  cx = wrapIndex(cx, CHUNK);
  const T = (gen.satTrees ||= new Map()), k = `${cx},${cy}`, hit = T.get(k);
  if (hit) return hit;
  const out = [];
  for (const o of gen.content(cx, cy, false).objects) { const r = canopyOf(o) || SMALL[o.kind]; if (r && CROWN[o.kind]) out.push([o.x - cx * CHUNK, o.y - cy * CHUNK, r, o.kind, o.key, ihash(Math.floor(o.x), Math.floor(o.y), 41)]); }
  T.set(k, out);
  if (T.size > TREES_MAX) T.delete(T.keys().next().value);
  return out;
}

export function satPixels(gen, cx, cy, season, { gone = null, clear = null, paint = null } = {}) {
  const N = SAT_N, f = gen.field(cx, cy), d = paint || paintPixels(gen, cx, cy, season, f), hill = shadeGrid(gen, cx, cy), near = gen.nearVillage(cx, cy), step = RES / SAT_PX;
  const x0 = cx * CHUNK, y0 = cy * CHUNK;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const o = (j * N + i) * 4, s = Math.min(f.n - 1, Math.round(j * step)) * f.n + Math.min(f.n - 1, Math.round(i * step)), w = f.wet[s];
    if (w > 0) {   // (the paint is the bed as seen through the water; from this high, the water itself: clearer by the shore)
      const a = 0.35 + 0.5 * ss(0, 1.2, w), k = ss(0.2, 3.5, w), e = f.deep ? Math.min(1, f.deep[s] / 9) : 0;
      for (let c = 0; c < 3; c++) d[o + c] = d[o + c] * (1 - a) + (WATER_IN[c] + (WATER_OUT[c] - WATER_IN[c]) * Math.max(k * 0.7, e)) * a;
    } else if (hill) {
      const x = (i + 0.5) / SAT_PX, y = (j + 0.5) / SAT_PX, v = bil(hill.lit, hill.n, x, y), rock = 0.55 * ss(0.5, 0.95, bil(hill.steep, hill.n, x, y));
      for (let c = 0; c < 3; c++) d[o + c] = (d[o + c] * (1 - rock) + ROCK[c] * rock) * v;
    }
    if (near) {
      const gx = x0 + (i + 0.5) / SAT_PX, gy = y0 + (j + 0.5) / SAT_PX;
      if (village.inBounds(gx, gy) && village.pondDist(gx, gy) < 1) { const a = 0.45 + 0.4 * ss(1, 0.4, village.pondDist(gx, gy)); for (let c = 0; c < 3; c++) d[o + c] = d[o + c] * (1 - a) + POND[c] * a; }
    }
  }
  // The crowns: every shadow first (down and to the right: the light comes from the north-west), then the crowns
  const trees = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const q of treesOf(gen, cx + dx, cy + dy)) {
    if (gone?.has(q[4])) continue;
    const tx = q[0] + dx * CHUNK, ty = q[1] + dy * CHUNK;
    if (tx < -REACH || ty < -REACH || tx > CHUNK + REACH || ty > CHUNK + REACH) continue;
    if (clear?.some(b => tx + x0 > b[0] && tx + x0 < b[2] && ty + y0 > b[1] && ty + y0 < b[3])) continue;
    trees.push([tx * SAT_PX, ty * SAT_PX, q[2] * SAT_PX, q[3], q[5]]);
  }
  trees.sort((a, b) => a[1] - b[1]);
  for (const [x, y, r, kind] of trees) disc(d, N, x + 1.6, y + 1.8, r, (o, q) => { const a = (CROWN[kind][season] ? 0.34 : 0.14) * (1 - q * q); d[o] *= 1 - a; d[o + 1] *= 1 - a; d[o + 2] *= 1 - a; });
  for (const [x, y, r, kind, h] of trees) {
    const set = CROWN[kind][season], bare = !set, col = bare ? TWIG : set[Math.floor(h * 997) % set.length], tone = 0.9 + h * 0.2;
    disc(d, N, x, y, r, (o, q, ux, uy, px, py) => {
      // (bare in winter: a brown ring of twigs, the ground showing through)
      const edge = 1 - ss(0.72, 1, q), a = bare ? 0.45 * ss(0.15, 0.7, q) * edge : 0.94 * edge;
      const v = tone * (1 - 0.26 * (ux + uy)) * (0.9 + 0.2 * ihash(px, py, 43 + (h * 97 | 0)));
      for (let c = 0; c < 3; c++) d[o + c] = d[o + c] * (1 - a) + col[c] * v * a;
    });
  }
  return d;
}
// Each pixel of a disc of the picture: fn(its offset, its distance to the centre 0-1, the direction, its pixel)
function disc(d, N, x, y, r, fn) {
  const i0 = Math.max(0, Math.floor(x - r)), i1 = Math.min(N - 1, Math.ceil(x + r)), j0 = Math.max(0, Math.floor(y - r)), j1 = Math.min(N - 1, Math.ceil(y + r));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const ux = (i + 0.5 - x) / r, uy = (j + 0.5 - y) / r, q = Math.sqrt(ux * ux + uy * uy);
    if (q < 1) fn((j * N + i) * 4, q, ux, uy, i, j);
  }
}

export function thumbPixels(gen, cx, cy, season) {
  const N = CHUNK, f = gen.field(cx, cy), hill = shadeGrid(gen, cx, cy), near = gen.nearVillage(cx, cy), d = new Uint8ClampedArray(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const s = (j * RES + RES / 2) * f.n + i * RES + RES / 2, b = f.biome[s], info = BIOMES[b], pal = seasonalPalette(b, info, season), k = ss(0.3, 0.75, f.patch[s]), wood = WOOD[b] || 0;
    const w = f.wet[s], o = (j * N + i) * 4, x = cx * CHUNK + i + 0.5, y = cy * CHUNK + j + 0.5, crown = CROWN[b === B.PINES ? 'pine' : b === B.SNOW ? 'snowPine' : 'oak'][season]?.[0] || TWIG;
    let c0 = pal[0][0] * (1 - k) + pal[1][0] * k, c1 = pal[0][1] * (1 - k) + pal[1][1] * k, c2 = pal[0][2] * (1 - k) + pal[1][2] * k;
    if (w > 0) {
      const t = Math.max(ss(0.1, 3.2, w) * 0.75, f.deep ? Math.min(1, f.deep[s] / 9) : 0);
      c0 = WATER_IN[0] + (WATER_OUT[0] - WATER_IN[0]) * t; c1 = WATER_IN[1] + (WATER_OUT[1] - WATER_IN[1]) * t; c2 = WATER_IN[2] + (WATER_OUT[2] - WATER_IN[2]) * t;
    } else {
      const a = wood && ihash(x | 0, y | 0, 44) < wood * 1.4 ? 0.75 : wood * 0.4;
      c0 += (crown[0] - c0) * a; c1 += (crown[1] - c1) * a; c2 += (crown[2] - c2) * a;
      if (hill) { const v = bil(hill.lit, hill.n, i + 0.5, j + 0.5); c0 *= v; c1 *= v; c2 *= v; }
    }
    if (near && village.inBounds(x, y)) {
      let col = null;
      if (village.inOwnHouse(x, y) || village.inTavern(x, y) || village.inVillageHouse(x, y)) col = ROOF;
      else if (village.pondDist(x, y) < 1) col = POND;
      else if (village.distToPath(x, y) < 0.8) col = PATH;
      if (col) [c0, c1, c2] = col;
    }
    d[o] = c0; d[o + 1] = c1; d[o + 2] = c2; d[o + 3] = 255;
  }
  return d;
}

// The land of the 3D map (three/map3d.js): n × n heights, s tiles apart from (x0, y0), row by row; the water level where there is
// water, and NONE (no height is looked at there) outside the chunks of seen (mw × mh of them from chunk (mx, my), not wrapped, 1: explored)
export const NONE = -1;
export function satHeights(gen, { x0, y0, s, n, mx, my, mw, mh, seen }) {
  const out = new Float32Array(n * n).fill(NONE);
  for (let j = 0; j < n; j++) {
    const y = y0 + j * s, kj = Math.floor(y / CHUNK) - my;
    if (kj < 0 || kj >= mh || y < NORTH || y >= SOUTH) continue;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * s, ki = Math.floor(x / CHUNK) - mx;
      if (ki < 0 || ki >= mw || !seen[kj * mw + ki]) continue;
      const wx = wrapX(x), h = village.inBounds(wx, y) ? 0 : gen.groundAt(wx, y);
      out[j * n + i] = h < 0 ? WATER_Y : h;
    }
  }
  return out;
}
// The trees of a chunk for the 3D map, TREE numbers each: x, y (in the chunk), the radius of the crown, how tall, its colour (0xrrggbb)
// and its shape (0: round, 1: a cone, 2: low). gone and clear: as in satPixels
export const TREE = 6;
const CONE = new Set(['pine', 'snowPine']), LOW = new Set(['bush', 'boulder', 'snowBoulder']);
export function satTrees(gen, cx, cy, season, { gone = null, clear = null } = {}) {
  const out = [], x0 = cx * CHUNK, y0 = cy * CHUNK;
  for (const [x, y, r, kind, key, h] of treesOf(gen, cx, cy)) {
    if (gone?.has(key) || clear?.some(b => x + x0 > b[0] && x + x0 < b[2] && y + y0 > b[1] && y + y0 < b[3])) continue;
    const set = CROWN[kind][season], col = set ? set[Math.floor(h * 997) % set.length] : TWIG, v = 0.94 + h * 0.16;
    const [a, b, c] = col.map(k => Math.max(0, Math.min(255, Math.round(k * v)))), shape = CONE.has(kind) ? 1 : LOW.has(kind) ? 2 : 0;
    out.push(x, y, set ? r : r * 0.7, shape === 1 ? r * 3.4 : shape === 2 ? r * 1.1 : kind === 'palm' || kind === 'cactus' ? r * 2.2 + 1.2 : r * 2.1, a * 65536 + b * 256 + c, shape);
  }
  return new Float32Array(out);
}
