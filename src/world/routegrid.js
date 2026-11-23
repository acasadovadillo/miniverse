// The cost grid and the search of the marked route (Plan J §2.2-2.5, docs/planes/gta/PLAN-J-ruta-musica.md). Pure: no
// DOM, no Three, no game state, so the route worker (routeworker.js), the main thread and the tests import the same code.
// The only function that looks at the game's world is chunkMask (and maskWanted), which takes it as an argument: the
// main thread builds the override masks with it (§2.4), the worker never calls it.
//
// Units: tiles (1 m). Chunks are CHUNK (16) tiles a side, keyed "cx,cy" like game.explored; cx always through
// wrapIndex(cx, CHUNK). Costs are stored × 10 in a byte (10 = open meadow); 255 = blocked.
import { CHUNK } from './gen.js';
import { B, BIOMES, climate, classify, wetness, depthOfWet, reliefOf } from './biomes.js';
import { depthOf } from './ground.js';
import { WATER_Y, wrapIndex } from './planet.js';
import { inBounds, distToPath, PLAZA, BOUNDS as VILLAGE } from './village.js';

// Cost of one step onto a tile, per class (× 10 when stored). road: village path, plaza, built floors (camino, wood,
// stone) and bridges; wade: natural depth < SWIM_IN (entities.js); swim: deeper, walking; blocked: walls, fences, closed
// gates, house footprints (doors open), tree and boulder colliders, dug holes and mounds, cliffs (slope > 0.9), poles
export const COST = { road: 0.55, open: 1, forest: 1.5, swamp: 2.2, snow: 1.7, rocky: 1.9, sand: 1.15, wade: 3, swim: 9, blocked: 255 };
// Flat cost of a tile in a chunk that is not explored: no terrain is read there at all (Decision 1)
export const UNKNOWN_COST = 2;
// Kind of each point of a path (route.kinds): how the maps and the ribbon draw it
export const KIND = { land: 0, road: 1, wade: 2, swim: 3, unknown: 4 };
// Travel modes: on foot, riding (no deep water, wade below HORSE_DEEP) and rowing (water costs 1, land 6)
export const MODES = ['walk', 'ride', 'row'];
// Bits of an override mask (Uint8Array(256), one byte per tile of a chunk, built on the main thread by chunkMask from
// the chunk's delta, the village and the aldeas: §2.4); 0 everywhere, or no mask, = the untouched world.
//   road: a built floor or a bridge (cheap, and dry even over water); blocked: something solid on the tile centre;
//   own: this mask knows the tile's obstacles, so the world's trees and rocks (gen.content) no longer count there (they
//        may have been cut, or a place may hide them). chunkMask sets it on every tile
export const OVR = { road: 1, blocked: 2, own: 4 };
// Limits shared by the worker and route.js
export const LIMITS = { short: 256, maxTiles: 4096, budget: 120000, weight: 1.6, maxPts: 400 };

// (the same costs as bytes; MIN_STEP is what the heuristic counts per tile: the cheapest tile, so it never overestimates)
const C10 = k => Math.round(COST[k] * 10);
const ROAD = C10('road'), OPEN = C10('open'), WADE = C10('wade'), SWIM = C10('swim'), BLOCK = 255, UNKNOWN = Math.round(UNKNOWN_COST * 10);
const ROW_WATER = OPEN, ROW_LAND = 60, ROCK_STEP = 3;   // (rowing: water like a meadow, land 6; a small rock to step over)
const MIN_STEP = COST.road * 10;
const BIOME_COST = new Uint8Array(BIOMES.length).fill(OPEN);
BIOME_COST[B.BEACH] = C10('sand'); BIOME_COST[B.DESERT] = C10('sand');
BIOME_COST[B.FOREST] = C10('forest'); BIOME_COST[B.PINES] = C10('forest');
BIOME_COST[B.SWAMP] = C10('swamp'); BIOME_COST[B.SNOW] = C10('snow'); BIOME_COST[B.ICE] = C10('snow'); BIOME_COST[B.ROCKY] = C10('rocky');
BIOME_COST[B.OCEAN] = BIOME_COST[B.SHALLOW] = BIOME_COST[B.LAKE] = C10('sand');   // (a water biome tile whose bed is dry)
// Slope (m per m, from the 4 corners of the tile): free up to SLOPE_FREE, then SLOPE_K per unit (× 10), a cliff past SLOPE_MAX
const SLOPE_FREE = 0.35, SLOPE_K = 40, SLOPE_MAX = 0.9;
// Depth classes (natural depth at the tile centre): dry below DRY, wading below SWIM_IN (1.0, entities.js), a horse
// still wades below HORSE_DEEP (1.25); deeper is swimming (walk), blocked (ride), open water (row)
const DRY = 0.05, SWIM_IN = 1.0, HORSE_DEEP = 1.25;
// Per-tile flags of a chunk record (chunkRecord): the depth class in the two low bits, then the world's obstacle and the
// village road
const F_WET = 3, F_OBST = 4, F_ROAD = 8;
// The world's objects that do not block a step: small rocks (col.top 0.3, stepped onto) cost a little; the rest without
// a collider (flowers, dead bushes) nothing
const STEP_ON = new Set(['rock']);
const SQRT2 = Math.SQRT2;

const iMode = mode => (mode === 'ride' ? 1 : mode === 'row' ? 2 : 0);

// ---------- the untouched world of one chunk ----------
// What the worker caches per chunk (LRU): { base: Uint8Array(256) land step cost × 10 from the biome and the slope (255 a
// cliff), flags: Uint8Array(256) (F_* bits) }. Mode and mask independent, so one record serves every travel mode and
// every version of the chunk's delta. cx is the chunk's own index (wrapIndex). About 4-6 ms: one climate() per corner
// (17 × 17) and gen.content(cx, cy, false) for trees and rocks
const CK = ['T', 'M', 'C', 'R', 'L', 'K', 'P', 'f', 'Q', 'Tl', 'Ml'], NK = CK.length, NC = CHUNK + 1;
const corner = new Float32Array(NC * NC * NK), heights = new Float32Array(NC * NC), cc = {}, ci = {};
export function chunkRecord(gen, cx, cy) {
  cx = wrapIndex(cx, CHUNK);
  const s = gen.seed, x0 = cx * CHUNK, y0 = cy * CHUNK;
  const base = new Uint8Array(256), flags = new Uint8Array(256);
  for (let j = 0, k = 0; j < NC; j++) for (let i = 0; i < NC; i++, k++) {
    const x = x0 + i, y = y0 + j;
    climate(x, y, s, cc);
    for (let q = 0; q < NK; q++) corner[k * NK + q] = cc[CK[q]];
    // (the bed and the relief as the ground mesh has them: ground.js groundOf, without what is built)
    if (inBounds(x, y)) heights[k] = depthOf(gen, x, y);
    else { const u = wetness(cc); heights[k] = u > 0 ? depthOfWet(u, cc, x, y, s) : reliefOf(cc, u, x, y, s); }
  }
  for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) {
    const t = j * CHUNK + i, a = j * NC + i, b = a + 1, c = a + NC, d = c + 1;
    // The biome of the tile centre, from the mean climate of its corners (like gen.field; close to gen.biomeAt there)
    for (let q = 0; q < NK; q++) ci[CK[q]] = (corner[a * NK + q] + corner[b * NK + q] + corner[c * NK + q] + corner[d * NK + q]) * 0.25;
    const biome = classify(ci.T, ci.M, ci.C, ci.R, ci.L, ci.K, ci.P, ci.f, 0, ci.Q, ci.Tl, ci.Ml);
    const ha = heights[a], hb = heights[b], hc = heights[c], hd = heights[d];
    const depth = WATER_Y - (ha + hb + hc + hd) * 0.25;
    const wetHere = BIOMES[biome].water || (inBounds(x0 + i + 0.5, y0 + j + 0.5) && depth > DRY);
    if (wetHere && depth > DRY) {
      flags[t] = depth < SWIM_IN ? 1 : depth < HORSE_DEEP ? 2 : 3;
      base[t] = BIOME_COST[biome];
      continue;
    }
    // On land the slope of the ground as walked (never below 0: the bank down into the water is not a cliff)
    const pa = Math.max(0, ha), pb = Math.max(0, hb), pc = Math.max(0, hc), pd = Math.max(0, hd);
    const sl = Math.hypot((pb + pd - pa - pc) * 0.5, (pc + pd - pa - pb) * 0.5);
    base[t] = sl > SLOPE_MAX ? BLOCK : Math.min(254, Math.round(BIOME_COST[biome] + SLOPE_K * Math.max(0, sl - SLOPE_FREE)));
  }
  // Trees, bushes and boulders block their tile (one object per tile, at its centre: gen.js content); small rocks cost a
  // little more. (Not kept in gen's cache: the route asks for far more chunks than the game keeps)
  for (const o of gen.content(cx, cy, false).objects) {
    if (!o.col || !(o.col.r > 0)) continue;
    const lx = Math.floor(o.x) - x0, ly = Math.floor(o.y) - y0;
    if (lx < 0 || lx >= CHUNK || ly < 0 || ly >= CHUNK) continue;
    const t = ly * CHUNK + lx;
    if (STEP_ON.has(o.kind)) { if (base[t] < BLOCK) base[t] = Math.min(254, base[t] + ROCK_STEP); }
    else flags[t] |= F_OBST;
  }
  // The village path and the plaza (village.js: the same test as its map thumbnail); the rest of the village (houses,
  // fences, the fountain) comes in the main thread's mask
  if (x0 + CHUNK > VILLAGE.x0 && x0 < VILLAGE.x1 && y0 + CHUNK > VILLAGE.y0 && y0 < VILLAGE.y1) {
    for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) {
      const x = x0 + i + 0.5, y = y0 + j + 0.5;
      if (inBounds(x, y) && (distToPath(x, y) < 0.8 || Math.hypot((x - PLAZA.x) / PLAZA.rx, (y - PLAZA.y) / PLAZA.ry) < 1)) flags[j * CHUNK + i] |= F_ROAD;
    }
  }
  return { base, flags };
}

// A record and a mask (or null) to the step costs (× 10, 255 blocked) and kinds of one travel mode. cost and kind: the
// outputs (Uint8Array(256)), filled and returned
export function combine(rec, mask, mode, cost = new Uint8Array(256), kind = null) {
  const m = iMode(mode), { base, flags } = rec, own = mask && mask.length === 256 ? mask : null;
  for (let t = 0; t < 256; t++) {
    const f = flags[t], o = own ? own[t] : 0;
    const obst = o & OVR.own ? o & OVR.blocked : (f & F_OBST) || (o & OVR.blocked);
    let c, k = KIND.land;
    if (obst) c = BLOCK;
    else if ((f & F_ROAD) || (o & OVR.road)) { c = m === 2 ? ROW_LAND : ROAD; k = KIND.road; }   // (a bridge: dry, even over water)
    else if (f & F_WET) {
      const w = f & F_WET;
      if (m === 2) c = ROW_WATER;
      else if (m === 1) c = w === 3 ? BLOCK : WADE;
      else c = w === 1 ? WADE : SWIM;
      k = w === 1 || (m === 1 && w === 2) ? KIND.wade : KIND.swim;
    } else c = m === 2 && base[t] !== BLOCK ? ROW_LAND : base[t];
    cost[t] = c;
    if (kind) kind[t] = k;
  }
  return cost;
}

// The 16 × 16 step costs (× 10, row-major: index = ly * 16 + lx) of chunk (cx, cy) for a travel mode, from the climate
// at the 17 × 17 corners (biome of each tile centre, slope, natural depth) and gen.content(cx, cy, false) (trees and
// rocks); override (optional, OVR bits) wins over the world. Never reads anything outside that chunk.
// gen: a WorldGen; mode: one of MODES (default 'walk'); kinds (optional Uint8Array(256)): filled with the KIND of each
// tile. Returns a new Uint8Array(256). Uncached: the worker caches chunkRecord and calls combine
export function tileCosts(gen, cx, cy, override = null, mode = 'walk', kinds = null) {
  return combine(chunkRecord(gen, cx, cy), override, mode, new Uint8Array(256), kinds);
}

// One byte (× 10, 255 = impassable) for the coarse chunk graph of long routes, for a travel mode: 4 × 4 samples of the
// climate (biome, natural depth and relief) and the share of deep water. Cheap (16 climate calls) and rough: the fine
// search on the corridor has the last word. costs (optional Uint8Array(3)): filled for the three MODES at once, so a
// cache needs one call per chunk
const SAMPLE_BLOCKED = 120;
const sh = new Float32Array(16);
export function chunkCost(gen, cx, cy, mode = 'walk', costs = null) {
  cx = wrapIndex(cx, CHUNK);
  const s = gen.seed, x0 = cx * CHUNK, y0 = cy * CHUNK, sum = [0, 0, 0], blocked = [0, 0, 0];
  for (let j = 0, k = 0; j < 4; j++) for (let i = 0; i < 4; i++, k++) {
    const x = x0 + 2 + i * 4, y = y0 + 2 + j * 4;
    climate(x, y, s, cc);
    const u = wetness(cc), village = inBounds(x, y);
    const h = village ? depthOf(gen, x, y) : u > 0 ? depthOfWet(u, cc, x, y, s) : reliefOf(cc, u, x, y, s);
    sh[k] = Math.max(0, h);
    const depth = WATER_Y - h, b = classify(cc.T, cc.M, cc.C, cc.R, cc.L, cc.K, cc.P, cc.f, 0, cc.Q, cc.Tl, cc.Ml);
    if ((BIOMES[b].water || village) && depth > DRY) {
      const deep = depth >= HORSE_DEEP;
      sum[0] += depth < SWIM_IN ? WADE : SWIM;
      if (deep) blocked[1]++; else sum[1] += WADE;
      sum[2] += ROW_WATER;
    } else {
      const c = village ? (ROAD + OPEN) / 2 : BIOME_COST[b];
      sum[0] += c; sum[1] += c; sum[2] += ROW_LAND;
    }
  }
  // (the relief between samples 4 m apart: a rough slope, the same rule as per tile, never a cliff here)
  let sl = 0;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const h = sh[j * 4 + i];
    if (i < 3) sl = Math.max(sl, Math.abs(sh[j * 4 + i + 1] - h) / 4);
    if (j < 3) sl = Math.max(sl, Math.abs(sh[(j + 1) * 4 + i] - h) / 4);
  }
  const steep = SLOPE_K * Math.max(0, sl - SLOPE_FREE);
  const out = costs || new Uint8Array(3);
  for (let m = 0; m < 3; m++) {
    if (blocked[m] >= 12) { out[m] = BLOCK; continue; }
    out[m] = Math.min(254, Math.max(1, Math.round((sum[m] + blocked[m] * SAMPLE_BLOCKED) / 16 + (m === 2 ? 0 : steep))));
  }
  return out[iMode(mode)];
}

// ---------- the search ----------
// Weighted A* on an unbounded grid of integer cells, in typed arrays shared by every search of this thread (one search at
// a time: starting one ends the one before). Cells are kept relative to the start (±SPAN), so the planet's seam never
// shows: the caller passes x already unwrapped (nearX) and wraps it in costAt.
const HBITS = 19, HSIZE = 1 << HBITS, NCAP = 1 << 18, SPAN = 16383;
let pool = null;
// (about 14 MB while it lives: the worker frees it when it is terminated; a main-thread caller, the tests, with releasePool)
export const releasePool = () => { pool = null; };
const getPool = () => (pool ||= {
  hk: new Int32Array(HSIZE), hv: new Int32Array(HSIZE), hs: new Uint32Array(HSIZE), stamp: 0,
  nx: new Int32Array(NCAP), ny: new Int32Array(NCAP), ng: new Float32Array(NCAP), np: new Int32Array(NCAP), shut: new Uint8Array(NCAP),
  heapN: new Int32Array(HSIZE), heapF: new Float32Array(HSIZE),
});
const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1], OC = new Uint8Array(4);

// A sliced search: new Search(costAt, from, to, opts), then step(n) until it returns true (done). Fields when done: ok,
// why ('ok' | 'nopath' | 'budget' | 'far'), expanded, cells (Int32Array [x0,y0,…] raw path from the start to the goal
// when ok), bestH (tiles, octile, from the goal to the nearest cell reached) and partial() (the raw path to that cell:
// call it before another Search starts, they share the pool). opts: budget (nodes), weight, hmin (the cheapest step,
// × 10; default COST.road × 10), seen (an array: the expanded cells are pushed to it as x, y, at most opts.seenMax pairs;
// for ?ruta=ver)
// The start and the goal are always passable (the player stands somewhere odd; a pin may sit on a tree or a wall)
export class Search {
  constructor(costAt, from, to, opts = {}) {
    const P = (this.P = getPool());
    this.costAt = costAt;
    this.fx = Math.floor(from.x); this.fy = Math.floor(from.y);
    this.tx = Math.floor(to.x); this.ty = Math.floor(to.y);
    this.budget = opts.budget ?? LIMITS.budget;
    this.hw = (opts.hmin ?? MIN_STEP) * (opts.weight ?? LIMITS.weight);
    this.seen = opts.seen || null; this.seenMax = opts.seenMax ?? 20000;
    this.expanded = 0; this.nodes = 0; this.heap = 0; this.done = false; this.ok = false; this.why = ''; this.cells = null;
    this.best = -1; this.bestH = Infinity;
    if (++P.stamp > 0xfffffff0) { P.hs.fill(0); P.stamp = 1; }
    if (Math.abs(this.tx - this.fx) > SPAN || Math.abs(this.ty - this.fy) > SPAN) { this.finish(false, 'far'); return; }
    const s = this.node(this.fx, this.fy);
    P.ng[s] = 0; P.np[s] = -1;
    this.push(s, this.h(this.fx, this.fy));
  }
  // (the octile distance to the goal, × the cheapest step × the weight)
  h(x, y) { const ax = Math.abs(x - this.tx), ay = Math.abs(y - this.ty); return (ax > ay ? ax + (SQRT2 - 1) * ay : ay + (SQRT2 - 1) * ax) * this.hw; }
  // The node of a cell (found or added; -1 when the pool is full)
  node(x, y) {
    const P = this.P, key = ((x - this.fx + SPAN) << 15) | (y - this.fy + SPAN);
    let i = Math.imul(key, 0x9e3779b1) >>> (32 - HBITS);
    while (P.hs[i] === P.stamp) { if (P.hk[i] === key) return P.hv[i]; i = (i + 1) & (HSIZE - 1); }
    if (this.nodes >= NCAP) return -1;
    const n = this.nodes++;
    P.hs[i] = P.stamp; P.hk[i] = key; P.hv[i] = n;
    P.nx[n] = x; P.ny[n] = y; P.ng[n] = Infinity; P.np[n] = -1; P.shut[n] = 0;
    return n;
  }
  push(n, f) {
    const P = this.P, N = P.heapN, F = P.heapF;
    if (this.heap >= HSIZE) return false;
    let i = this.heap++;
    while (i > 0) { const p = (i - 1) >> 1; if (F[p] <= f) break; N[i] = N[p]; F[i] = F[p]; i = p; }
    N[i] = n; F[i] = f;
    return true;
  }
  pop() {
    const P = this.P, N = P.heapN, F = P.heapF, top = N[0], n = --this.heap;
    if (n > 0) {
      const ln = N[n], lf = F[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && F[c + 1] < F[c]) c++;
        if (F[c] >= lf) break;
        N[i] = N[c]; F[i] = F[c]; i = c;
      }
      N[i] = ln; F[i] = lf;
    }
    return top;
  }
  finish(ok, why) { this.done = true; this.ok = ok; this.why = why; return true; }
  // Up to n expansions; true when the search is over
  step(n = Infinity) {
    if (this.done) return true;
    // (the hot loop: everything in locals, the hash lookup and the heuristic written out)
    const P = this.P, tx = this.tx, ty = this.ty, fx = this.fx, fy = this.fy, hw = this.hw, costAt = this.costAt, oc = OC;
    const hs = P.hs, hk = P.hk, hv = P.hv, nx = P.nx, ny = P.ny, ng = P.ng, np = P.np, shut = P.shut, stamp = P.stamp, R2 = SQRT2 - 1;
    for (let k = 0; k < n; k++) {
      if (!this.heap) return this.finish(false, 'nopath');
      const u = this.pop();
      if (shut[u]) continue;
      shut[u] = 1;
      const ux = nx[u], uy = ny[u], gu = ng[u];
      if (ux === tx && uy === ty) { this.cells = this.trace(u); return this.finish(true, 'ok'); }
      if (++this.expanded > this.budget) return this.finish(false, 'budget');
      { const ax = ux > tx ? ux - tx : tx - ux, ay = uy > ty ? uy - ty : ty - uy, hd = ax > ay ? ax + R2 * ay : ay + R2 * ax; if (hd < this.bestH) { this.bestH = hd; this.best = u; } }
      if (this.seen && this.seen.length < this.seenMax * 2) this.seen.push(ux, uy);
      for (let d = 0; d < 8; d++) {
        const vx = ux + DX[d], vy = uy + DY[d];
        if (d >= 4 && (oc[DX[d] > 0 ? 0 : 1] || oc[DY[d] > 0 ? 2 : 3])) continue;   // (no corner cutting: both side cells open)
        let c = costAt(vx, vy);
        if (c >= BLOCK && vx === tx && vy === ty) c = OPEN;   // (the goal is always reachable)
        if (d < 4) oc[d] = c >= BLOCK ? 1 : 0;
        if (c >= BLOCK) continue;
        const g = gu + (d < 4 ? c : c * SQRT2);
        // (the node of (vx, vy): found in the hash, or added)
        const key = ((vx - fx + SPAN) << 15) | (vy - fy + SPAN);
        let i = Math.imul(key, 0x9e3779b1) >>> (32 - HBITS), v = -1;
        while (hs[i] === stamp) { if (hk[i] === key) { v = hv[i]; break; } i = (i + 1) & (HSIZE - 1); }
        if (v < 0) {
          if (this.nodes >= NCAP) return this.finish(false, 'budget');
          v = this.nodes++;
          hs[i] = stamp; hk[i] = key; hv[i] = v;
          nx[v] = vx; ny[v] = vy; shut[v] = 0;
        } else if (shut[v] || g >= ng[v]) continue;
        ng[v] = g; np[v] = u;
        const ax = vx > tx ? vx - tx : tx - vx, ay = vy > ty ? vy - ty : ty - vy;
        if (!this.push(v, g + (ax > ay ? ax + R2 * ay : ay + R2 * ax) * hw)) return this.finish(false, 'budget');
      }
    }
    return false;
  }
  partial() { return this.best >= 0 ? this.trace(this.best) : null; }
  trace(n) {
    const P = this.P;
    let len = 0;
    for (let m = n; m >= 0; m = P.np[m]) len++;
    const out = new Int32Array(len * 2);
    for (let m = n, i = len - 1; m >= 0; m = P.np[m], i--) { out[i * 2] = P.nx[m]; out[i * 2 + 1] = P.ny[m]; }
    return out;
  }
}

// Weighted A* (8 neighbours, no corner cutting) from tile `from` to tile `to` ({ x, y }; to.x already brought next to
// from.x with nearX, so the search never sees the seam; fractions are kept as the two end points).
//   costAt(x, y) → the step cost × 10 of that tile (1..254) or 255 if blocked; x unwrapped (the caller wraps it)
//   opts: { budget (nodes, LIMITS.budget), weight (LIMITS.weight; heuristic = octile × COST.road × 10 × weight),
//           kindAt(x, y) → KIND of a tile (default land), maxPts (LIMITS.maxPts, after string pulling), hmin, seen }
// Returns { pts: Float32Array [x0,y0,x1,y1,…] from `from` to `to` (tile centres between them), kinds: Uint8Array (one per
//           point), len: tiles along the path, expanded: nodes taken from the open set, ok: a path was found, why }.
// When !ok (no path, budget spent, over LIMITS.maxTiles) pts is the straight line from → to with both kinds 'unknown'.
export function findPath(costAt, from, to, opts = {}) {
  if (Math.hypot(to.x - from.x, to.y - from.y) > LIMITS.maxTiles) return straightPath(from, to, 0, 'far');
  const s = new Search(costAt, from, to, opts);
  s.step();
  return s.ok ? pathOf(s.cells, costAt, from, to, opts, s.expanded) : straightPath(from, to, s.expanded, s.why);
}

// The fallback: from → to straight, both points 'unknown'
export function straightPath(from, to, expanded = 0, why = 'nopath') {
  const pts = new Float32Array([from.x, from.y, to.x, to.y]);
  return { pts, kinds: new Uint8Array([KIND.unknown, KIND.unknown]), len: Math.hypot(to.x - from.x, to.y - from.y), expanded, ok: false, why };
}

// A raw path of cells (Search.cells) to the answer: kinds per cell, string pulled (pull), at most maxPts points, the
// exact from and to as the two ends
export function pathOf(cells, costAt, from, to, opts = {}, expanded = 0) {
  const n = cells.length >> 1, kindAt = opts.kindAt || (() => KIND.land);
  if (n < 2) {   // (the pin on the player's own tile)
    const k = n ? kindAt(cells[0], cells[1]) : KIND.land;
    return { pts: new Float32Array([from.x, from.y, to.x, to.y]), kinds: new Uint8Array([k, k]), len: Math.hypot(to.x - from.x, to.y - from.y), expanded, ok: true, why: 'ok' };
  }
  const kinds = new Uint8Array(n);
  for (let i = 0; i < n; i++) kinds[i] = kindAt(cells[i * 2], cells[i * 2 + 1]);
  const gx = Math.floor(to.x), gy = Math.floor(to.y);
  const cost = (x, y) => { const c = costAt(x, y); return c >= BLOCK && x === gx && y === gy ? OPEN : c; };
  let keep = pull(cells, kinds, cost);
  const maxPts = Math.max(2, opts.maxPts ?? LIMITS.maxPts);
  if (keep.length > maxPts) keep = thin(keep, kinds, maxPts);
  const m = keep.length, pts = new Float32Array(m * 2), ks = new Uint8Array(m);
  for (let i = 0; i < m; i++) { const c = keep[i]; pts[i * 2] = cells[c * 2] + 0.5; pts[i * 2 + 1] = cells[c * 2 + 1] + 0.5; ks[i] = kinds[c]; }
  // (the ends where they really are: the player's feet and the pin, not their tiles' centres)
  pts[0] = from.x; pts[1] = from.y; pts[m * 2 - 2] = to.x; pts[m * 2 - 1] = to.y;
  let len = 0;
  for (let i = 1; i < m; i++) len += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
  return { pts, kinds: ks, len, expanded, ok: true, why: 'ok' };
}

// Line-of-sight string pulling over a raw path: from each kept cell, the farthest cell of the same run of kinds (a kind
// change is always a point, so every segment between two points of the same kind is all of that kind) reachable in a
// straight line where no tile costs more than the dearer end + 3 (× 10) and none is blocked. First one straight shot to
// the end of the run (an unknown stretch, all one flat cost, becomes one straight dashed line, never a staircase), else
// the farthest cell within PULL_MAX tiles. Returns the indices of the cells kept
const PULL_MAX = 64, PULL_SLACK = 3;
function pull(cells, kinds, cost) {
  const n = cells.length >> 1, keep = [0];
  let a = 0;
  while (a < n - 1) {
    let e = a + 1;
    while (e + 1 < n && kinds[e + 1] === kinds[a] && kinds[e] === kinds[a]) e++;
    let b = a + 1;
    if (e > a + 1 && sight(cells[a * 2], cells[a * 2 + 1], cells[e * 2], cells[e * 2 + 1], cost)) b = e;
    else for (let j = a + 2; j <= e && j - a <= PULL_MAX; j++) {
      if (!sight(cells[a * 2], cells[a * 2 + 1], cells[j * 2], cells[j * 2 + 1], cost)) break;
      b = j;
    }
    keep.push(b);
    a = b;
  }
  return keep;
}
// Can one walk straight from the centre of tile (ax, ay) to that of (bx, by)? Every tile the line touches (a supercover
// walk: where it passes a corner exactly, both side tiles too) must be open and cost at most the dearer end + PULL_SLACK
function sight(ax, ay, bx, by, cost) {
  const limit = Math.max(cost(ax, ay), cost(bx, by)) + PULL_SLACK;
  if (limit > 254 + PULL_SLACK) return false;
  const dx = bx - ax, dy = by - ay, sx = Math.sign(dx), sy = Math.sign(dy), adx = Math.abs(dx), ady = Math.abs(dy);
  let x = ax, y = ay, ix = 0, iy = 0;
  const ok = (x, y) => { const c = cost(x, y); return c < 255 && c <= limit; };
  while (ix < adx || iy < ady) {
    // (which border comes first along the line, compared without division: (ix + 0.5) / adx against (iy + 0.5) / ady)
    const d = (1 + 2 * ix) * ady - (1 + 2 * iy) * adx;
    if (d === 0) {
      if (!ok(x + sx, y) || !ok(x, y + sy)) return false;
      x += sx; y += sy; ix++; iy++;
    } else if (d < 0) { x += sx; ix++; }
    else { y += sy; iy++; }
    if (!ok(x, y)) return false;
  }
  return true;
}
// At most max points: the ends and every kind change first, then evenly spaced others (or, if the changes alone are too
// many, evenly spaced among everything)
function thin(keep, kinds, max) {
  const n = keep.length, must = [];
  for (let i = 0; i < n; i++) if (i === 0 || i === n - 1 || kinds[keep[i]] !== kinds[keep[i - 1]] || (i + 1 < n && kinds[keep[i]] !== kinds[keep[i + 1]])) must.push(i);
  const pick = new Uint8Array(n);
  if (must.length >= max) { for (let k = 0; k < max; k++) pick[Math.round((k * (n - 1)) / (max - 1))] = 1; }
  else {
    for (const i of must) pick[i] = 1;
    const extra = max - must.length;
    for (let k = 1; k <= extra; k++) pick[Math.round((k * (n - 1)) / (extra + 1))] = 1;
  }
  const out = [];
  for (let i = 0; i < n; i++) if (pick[i]) out.push(keep[i]);
  return out;
}

// For the ribbon only: line-of-sight string pulling (a shortcut only if no tile on it costs more than the dearer end
// + 3 in ×10 units; skipped without costAt), then Chaikin × 2 (the two ends stay). pts as findPath's; returns a new
// Float32Array (never the same array)
export function smooth(pts, costAt) {
  let p = Float32Array.from(pts);
  const n = p.length >> 1;
  if (n < 3) return p;
  if (costAt) {
    const cells = new Int32Array(n * 2);
    for (let i = 0; i < n * 2; i++) cells[i] = Math.floor(p[i]);
    const keep = pullPoints(cells, costAt);
    const q = new Float32Array(keep.length * 2);
    keep.forEach((k, i) => { q[i * 2] = p[k * 2]; q[i * 2 + 1] = p[k * 2 + 1]; });
    p = q;
  }
  for (let it = 0; it < 2 && p.length >= 6; it++) p = chaikin(p);
  return p;
}
// (pull for points that are not neighbours: each shortcut tested against the next points with sight)
function pullPoints(cells, cost) {
  const n = cells.length >> 1, keep = [0];
  let a = 0;
  while (a < n - 1) {
    let b = a + 1;
    for (let j = a + 2; j < n; j++) { if (!sight(cells[a * 2], cells[a * 2 + 1], cells[j * 2], cells[j * 2 + 1], cost)) break; b = j; }
    keep.push(b);
    a = b;
  }
  return keep;
}
function chaikin(p) {
  const n = p.length >> 1, out = new Float32Array((n - 1) * 4);
  let k = 0;
  out[k++] = p[0]; out[k++] = p[1];
  for (let i = 0; i < n - 1; i++) {
    const ax = p[i * 2], ay = p[i * 2 + 1], bx = p[i * 2 + 2], by = p[i * 2 + 3];
    if (i > 0) { out[k++] = 0.75 * ax + 0.25 * bx; out[k++] = 0.75 * ay + 0.25 * by; }
    if (i < n - 2) { out[k++] = 0.25 * ax + 0.75 * bx; out[k++] = 0.25 * ay + 0.75 * by; }
  }
  out[k++] = p[n * 2 - 2]; out[k++] = p[n * 2 - 1];
  return out.slice(0, k);
}

// ---------- the main thread's override masks (§2.4) ----------
// Does chunk (cx, cy) need a mask? Only where the untouched world is not the whole story: a chunk with a delta (built,
// cut, dug), one that touches the village, or one near a place or an aldea (the explore layer: its houses and the trees
// it hides). world: the game's world (scenes.js); cheap (no content is built)
export function maskWanted(world, cx, cy) {
  cx = wrapIndex(cx, CHUNK);
  const x0 = cx * CHUNK, y0 = cy * CHUNK;
  if (world.deltas?.has(`${cx},${cy}`)) return true;
  if (x0 + CHUNK > VILLAGE.x0 && x0 < VILLAGE.x1 && y0 + CHUNK > VILLAGE.y0 && y0 < VILLAGE.y1) return true;
  return !!world.layers?.some(l => l.padNear?.(x0, y0, x0 + CHUNK, y0 + CHUNK));
}
// The mask of chunk (cx, cy) from the world as it is now: what is solid on each tile centre (the merged colliders of
// world.colliderShapes: trees not cut, rocks, walls, fences, closed gates, furniture, the houses of the village and the
// aldeas, dug holes and mounds) and the built floors (paths, wood, stone, bridges). Open doors and gates let through
// (their jambs and posts sit on the tile's edges); a closed door too (one opens it walking); the village pond is water,
// not a wall (the worker knows its depth). OVR.own on every tile. Cache it by the chunk's d.v (and village changes): it
// costs what colliderShapes costs (gen.content when that chunk is not cached, a millisecond or two)
const MARGIN = 0.05;
export function chunkMask(world, cx, cy, out = new Uint8Array(256)) {
  cx = wrapIndex(cx, CHUNK);
  const x0 = cx * CHUNK, y0 = cy * CHUNK;
  out.fill(OVR.own);
  const c = world.colliderShapes(cx, cy);
  for (const s of c.colliders) {
    if (s.pond || (s.wall && s.shut)) continue;
    let ax, ay, bx, by;
    if (s.r !== undefined) { if (!(s.r > 0) || s.top === 0.3) continue; ax = s.x - s.r; bx = s.x + s.r; ay = s.y - s.r; by = s.y + s.r; }
    else if (s.rx !== undefined) { ax = s.x - s.rx; bx = s.x + s.rx; ay = s.y - s.ry; by = s.y + s.ry; }
    else { ax = s.x0; ay = s.y0; bx = s.x1; by = s.y1; }
    const i0 = Math.max(0, Math.ceil(ax - x0 - 0.5 - MARGIN)), i1 = Math.min(CHUNK - 1, Math.floor(bx - x0 - 0.5 + MARGIN));
    const j0 = Math.max(0, Math.ceil(ay - y0 - 0.5 - MARGIN)), j1 = Math.min(CHUNK - 1, Math.floor(by - y0 - 0.5 + MARGIN));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = x0 + i + 0.5, py = y0 + j + 0.5;
      if (inside(s, px, py)) out[j * CHUNK + i] |= OVR.blocked;
    }
  }
  for (const f of c.floors || []) {
    const [tx, ty] = f.tile || [Math.floor(f.x), Math.floor(f.y)], i = tx - x0, j = ty - y0;
    if (i >= 0 && i < CHUNK && j >= 0 && j < CHUNK) out[j * CHUNK + i] |= OVR.road;
  }
  return out;
}
// (is the point inside a collider, grown by MARGIN: a circle, an ellipse, an oriented box or an axis box)
function inside(s, x, y) {
  if (s.r !== undefined) return Math.hypot(x - s.x, y - s.y) < s.r + MARGIN;
  if (s.rx !== undefined) return Math.hypot((x - s.x) / (s.rx + MARGIN), (y - s.y) / (s.ry + MARGIN)) < 1;
  if (s.obb) {
    const b = s.obb, dx = x - b.x, dy = y - b.y;
    return Math.abs(dx * b.ux + dy * b.uy) < b.hx + MARGIN && Math.abs(dx * b.vx + dy * b.vy) < b.hy + MARGIN;
  }
  return x > s.x0 - MARGIN && x < s.x1 + MARGIN && y > s.y0 - MARGIN && y < s.y1 + MARGIN;
}
