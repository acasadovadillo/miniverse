// Sites: where the world's places go (docs/planes/realismo/PLAN-R7-mundo.md §3.1). Pure: only the seed and the generator's
// noise (biomes.js), no game, no DOM and no Three, so it gives the same on the main thread, in a worker and on the server.
//
// The world is cut into square cells of chunks, one grid per tier; a cell has one site at most, on the best spot it has
// for that kind: a watchtower on a high point, a lighthouse facing the open sea, a hamlet on low flat land by the water, a
// cave at the foot of a slope, a beached boat on a wide beach, a camp on flat ground near water. Its key is that of the
// chunk it stands in ("cx,cy"), as the places always had (explore.js: found, d.opened).
//
// LegacyPlaces are the places of before (one roll per chunk): old worlds keep the ones their players built by, used or
// found (explore.js, places1).
import { ihash } from '../util.js';
import { CHUNK } from './gen.js';
import { B, BIOMES, climate, classify, wetness, reliefOf, depthOfWet, biomeAt as biomeOf } from './biomes.js';
import { CENTER } from './village.js';
import { wrapIndex, wrapX, dxOf, distOf, inPlanet, W as PLANET_W } from './planet.js';
import { houseSize } from './blueprints.js';

// The tiers, from the rarest: the side of a cell (chunks), the chunks left free along its border (two sites of a tier are
// never nearer than twice that), and how likely a cell is to have one (major: by kind). Tunable: all in one table
export const SITE_TIERS = {
  hamlet: { cell: 40, margin: 4, chance: 0.65, kinds: ['aldea'] },
  major: { cell: 24, margin: 2, chance: { faro: 0.55, templo: 0.5, torre: 0.45, mina: 0.3 }, kinds: ['faro', 'templo', 'torre', 'mina'] },
  cave: { cell: 6, margin: 1, chance: 0.5, kinds: ['cueva'] },
  minor: { cell: 8, margin: 1, chance: 0.8, kinds: ['campamento', 'barco', 'manantial', 'arbol', 'risco', 'salegar'] },
};
export const TIERS = Object.keys(SITE_TIERS);
export const TIER_OF = Object.fromEntries(TIERS.flatMap(t => SITE_TIERS[t].kinds.map(k => [k, t])));
// The kinds with a place in the game today. The others (a mine, a spring, a great tree, a tor, a salt lick) have their spot
// taken already, so that nothing moves when they come (R7-3, R7-5): the game (explore.js) leaves them out
export const READY = new Set(['aldea', 'faro', 'templo', 'torre', 'cueva', 'campamento', 'barco']);
// What each place takes up, as a circle (a hamlet, about its houses: see HAMLET_BOX)
export const SITE_SIZE = { campamento: 1.8, torre: 3.7, barco: 2.2, templo: 2.2, cueva: 1.4, aldea: 16, faro: 3, ruinas: 2.2, mina: 2, manantial: 1.5, arbol: 2, risco: 2, salegar: 1.2 };
// Where in its chunk a place may stand (the chunk keeps all of it, with its clearing and its chest)
const ROOM = { torre: [5, 10], faro: [4, 11], barco: [3, 11], templo: [3, 11] }, ROOM_ANY = [3, 12];
// No site this near the village's centre, and what it guarantees around it: one of each of these within RING
export const HOME_CLEAR = 110, RING = 1200;
const RING_KINDS = { hamlet: 'aldea', major: 'torre', cave: 'cueva', minor: 'campamento' };
const KEEP_OFF = 40;             // a small site this near a hamlet or a great one is left out
const OWN = 200;                 // a great site this near a hamlet is that hamlet's
const HAMLET_HIGH = 1.6;         // a hamlet's ground is 0 (its houses have no height of their own): only on low land
const PROMINENCE = 6, LOOK_R = 64;
const CELLS = 8000;              // cells remembered (a couple of bytes each: their sites are few)
// (the minor kinds by biome: what a cell of it may hold, as [kind, weight]; the rest, nothing)
// (made on first use: this module may be read before biomes.js, which is in a cycle of imports, has its B)
let MINOR = null;
const minorOf = b => (MINOR ||= {
  [B.MEADOW]: [['campamento', 0.4], ['arbol', 0.25], ['manantial', 0.15], ['salegar', 0.15], ['risco', 0.05]],
  [B.FOREST]: [['campamento', 0.4], ['arbol', 0.25], ['manantial', 0.2], ['salegar', 0.15]],
  [B.PINES]: [['campamento', 0.35], ['risco', 0.2], ['arbol', 0.2], ['manantial', 0.15], ['salegar', 0.1]],
  [B.ROCKY]: [['risco', 0.6], ['manantial', 0.2]],
  [B.SNOW]: [['risco', 0.5]],
  [B.DESERT]: [['risco', 0.4]],
  [B.SWAMP]: [['arbol', 0.4]],
  [B.BEACH]: [['manantial', 0.1]],
})[b] || [];
const DIR8 = [[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]];
const DIR16 = [[1, 0], [0.9239, 0.3827], [0.7071, 0.7071], [0.3827, 0.9239], [0, 1], [-0.3827, 0.9239], [-0.7071, 0.7071], [-0.9239, 0.3827], [-1, 0], [-0.9239, -0.3827], [-0.7071, -0.7071], [-0.3827, -0.9239], [0, -1], [0.3827, -0.9239], [0.7071, -0.7071], [0.9239, -0.3827]];   // (written out: the same in every engine)
const GREEN = b => b === B.MEADOW || b === B.FOREST || b === B.PINES;

// The four spots of a hamlet's houses round its square (explore.js, aldea): their origin from the square's tile
export const HAMLET_SPOTS = [[-14, -12], [2, -13], [-15, 2], [2, 2]];
export const HAMLET_BOX = [-15, -13, 14, 12];
// The first three of them with no water under the house. wet(x, y): is there water (the world's own, never what was dug)
export function hamletSlots(cx, cy, wet) {
  const px = cx * CHUNK + 8, py = cy * CHUNK + 8, { w: hw, h: hh } = houseSize(false), out = [];
  for (const [dx, dy] of HAMLET_SPOTS) {
    let dry = true;
    for (let y = 0; y < hh && dry; y++) for (let x = 0; x < hw; x++) if (wet(px + dx + x + 0.5, py + dy + y + 0.5)) { dry = false; break; }
    if (dry) out.push([dx, dy]);
    if (out.length === 3) break;
  }
  return out;
}

export class Sites {
  constructor(seed) {
    this.seed = seed | 0;
    this.cells = new Map();    // `${tier}:${ix},${iy}` → its site or null (an LRU)
    this.forced = {};          // tier → the cell of the first ring that must have one, or null (made on first use)
    this.stats = { cells: 0, ms: 0, worst: 0 };
    this.c = {};               // (the climate of the last probe)
  }
  // ---------- reading the land ----------
  // The climate (this.c), the wetness (u), the biome (b) and the ground's height (h) of a point. No objects are made
  probe(x, y) {
    const c = climate(x, y, this.seed, this.c);
    this.u = wetness(c);
    this.b = classify(c.T, c.M, c.C, c.R, c.L, c.K, c.P, c.f, 0, c.Q, c.Tl, c.Ml);
    this.h = this.u > 0 ? depthOfWet(this.u, c, x, y, this.seed) : reliefOf(c, this.u, x, y, this.seed);
    return this.h;
  }
  height(x, y) { const c = climate(x, y, this.seed, this.c), u = wetness(c); return u > 0 ? depthOfWet(u, c, x, y, this.seed) : reliefOf(c, u, x, y, this.seed); }
  wet(x, y) { return wetness(climate(x, y, this.seed, this.c)) > 0; }
  // How near fresh water or the sea is, by the last probe's climate: 1 on the shore, 0 some 30 m away
  waterHint() { const c = this.c; return Math.max(c.C > 0.4 ? 1 - (Math.abs(c.R - 0.5) - 0.008) / 0.09 : 0, 1 - (0.82 - c.L) / 0.16, 1 - (c.C - 0.36) / 0.08); }
  wetWithin(x, y, r) {
    for (let i = 0; i < 8; i++) if (this.wet(x + DIR8[i][0] * r, y + DIR8[i][1] * r) || this.wet(x + DIR8[i][0] * r * 0.5, y + DIR8[i][1] * r * 0.5)) return true;
    return false;
  }
  // Is all of it dry, round (x, y) up to r? (the rings r / 2 and r, in sixteen and eight directions: streams are narrow)
  dryRound(x, y, r) {
    for (let i = 0; i < 16; i++) { const [c, s] = DIR16[i]; if (this.wet(x + c * r, y + s * r) || (!(i & 1) && this.wet(x + c * r * 0.5, y + s * r * 0.5))) return false; }
    return true;
  }
  // How many of the eight directions have open sea at r
  sea(x, y, r) {
    let n = 0;
    for (const [i, j] of DIR8) { const c = climate(x + i * r, y + j * r, this.seed, this.c); if (c.C < 0.34 && c.Q <= 0.5) n++; }
    return n;
  }
  // How much higher a point is than the land LOOK_R m round it
  prominence(x, y) {
    let sum = 0;
    for (const [i, j] of DIR8) sum += Math.max(0, this.height(x + i * LOOK_R, y + j * LOOK_R));
    return this.height(x, y) - sum / 8;
  }
  roll(ix, iy, salt) { return ihash(ix, iy, this.seed + salt); }

  // ---------- cells ----------
  // The site of a cell (or null)
  inCell(tier, ix, iy) {
    const k = `${tier}:${ix},${iy}`, C = this.cells, hit = C.get(k);
    if (hit !== undefined) { C.delete(k); C.set(k, hit); return hit; }
    let s = this.natural(tier, ix, iy);
    if (!s && this.inRing(tier, ix, iy)) { const f = this.ringCell(tier); if (f && f.ix === ix && f.iy === iy) s = f.site; }
    C.set(k, s);
    if (C.size > CELLS) C.delete(C.keys().next().value);
    return s;
  }
  // What a cell has by itself
  natural(tier, ix, iy) {
    const k = `n${tier}:${ix},${iy}`, had = this.cells.get(k);
    if (had !== undefined) return had;
    const t0 = globalThis.performance?.now?.() ?? 0, s = this.make(tier, ix, iy, false), ms = (globalThis.performance?.now?.() ?? 0) - t0;
    this.stats.cells++; this.stats.ms += ms; this.stats.worst = Math.max(this.stats.worst, ms);
    this.cells.set(k, s);
    return s;
  }
  inRing(tier, ix, iy) {
    const n = SITE_TIERS[tier].cell * CHUNK, x0 = ix * n, y0 = iy * n;
    return Math.hypot(Math.max(0, x0 - CENTER.x, CENTER.x - x0 - n), Math.max(0, y0 - CENTER.y, CENTER.y - y0 - n)) < RING;
  }
  // The first ring: a hamlet, a watchtower, a camp and (if there is rock or snow) a cave within RING of the village. If no
  // cell has one by itself, the nearest one where it fits has to: { ix, iy, site } (or null: there is one, or nowhere)
  ringCell(tier) {
    if (this.forced[tier] !== undefined) return this.forced[tier];
    this.forced[tier] = null;
    const n = SITE_TIERS[tier].cell * CHUNK, want = RING_KINDS[tier], list = [], cx = Math.floor(CENTER.x / n), cy = Math.floor(CENTER.y / n), r = Math.ceil(RING / n) + 1;
    for (let iy = cy - r; iy <= cy + r; iy++) for (let ix = cx - r; ix <= cx + r; ix++) if (this.inRing(tier, ix, iy)) list.push([Math.hypot((ix + 0.5) * n - CENTER.x, (iy + 0.5) * n - CENTER.y), ix, iy]);
    list.sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]);
    const ok = s => s && s.kind === want && distOf(s.x, s.y, CENTER.x, CENTER.y) < RING;
    for (const [, ix, iy] of list) if (ok(this.natural(tier, ix, iy))) return null;
    for (const [, ix, iy] of list) {
      if (this.natural(tier, ix, iy)) continue;
      const s = this.make(tier, ix, iy, true);
      if (ok(s)) return (this.forced[tier] = { ix, iy, site: s });
    }
    return null;
  }
  make(tier, ix, iy, force) {
    const T = SITE_TIERS[tier], s = tier === 'hamlet' ? this.hamlet(T, ix, iy, force) : tier === 'major' ? this.major(T, ix, iy, force) : tier === 'cave' ? this.cave(T, ix, iy, force) : this.minor(T, ix, iy, force);
    return s;
  }
  // A site that stands at (x, y), if nothing forbids it
  site(tier, ix, iy, kind, x, y, extra) {
    // (a cell cut by the seam has only its part on this side: what is beyond is another cell's)
    if (!inPlanet(x, y) || distOf(x, y, CENTER.x, CENTER.y) < HOME_CLEAR) return null;
    const cx = wrapIndex(Math.floor(x / CHUNK), CHUNK), cy = Math.floor(y / CHUNK), h = Math.max(0, this.probe(x, y));
    return { kind, tier, ix, iy, x, y, key: `${cx},${cy}`, id: Math.floor(ihash(cx, cy, this.seed + 701) * 1e6), snow: this.b === B.SNOW, biome: this.b,
      z: kind === 'aldea' ? 0 : Math.round(h * 100) / 100, sea: this.c.C < 0.45, water: this.u <= 0 && this.waterHint() > 0.35, ...extra };
  }
  // A point of chunk (cx, cy) as near (x, y) as the kind's room in its chunk lets, on the centre of a tile
  fit(kind, cx, cy, x, y) {
    const [lo, hi] = ROOM[kind] || ROOM_ANY, on = (v, c) => c * CHUNK + Math.max(lo, Math.min(hi, Math.floor(v) - c * CHUNK)) + 0.5;
    return [on(x, cx), on(y, cy)];
  }
  // (the candidate of a chunk: its centre, plus a jitter of its own)
  spot(kind, cx, cy, salt = 0) {
    const [lo, hi] = ROOM[kind] || ROOM_ANY, n = hi - lo + 1;
    return [cx * CHUNK + lo + Math.floor(this.roll(cx, cy, 9400 + salt) * n) + 0.5, cy * CHUNK + lo + Math.floor(this.roll(cx, cy, 9401 + salt) * n) + 0.5];
  }

  // A hamlet: low, flat, dry land (its houses stand at height 0), better by the water and in the open
  hamlet(T, ix, iy, force) {
    if (!force && this.roll(ix, iy, 9001) >= T.chance) return null;
    const x0 = ix * T.cell + T.margin, y0 = iy * T.cell + T.margin, n = T.cell - T.margin * 2, STEP = 4, list = [];
    for (let j = 0; j < n; j += STEP) for (let i = 0; i < n; i += STEP) {
      const cx = x0 + i + Math.floor(this.roll(x0 + i, y0 + j, 9010) * STEP), cy = y0 + j + Math.floor(this.roll(x0 + i, y0 + j, 9011) * STEP);
      const x = cx * CHUNK + 8.5, y = cy * CHUNK + 8.5;
      if (distOf(x, y, CENTER.x, CENTER.y) < HOME_CLEAR + 60) continue;
      const h = this.probe(x, y);
      if (!GREEN(this.b) || this.u > 0 || h > HAMLET_HIGH) continue;
      list.push([this.waterHint() * 0.5 - h * 0.3 + (this.b === B.MEADOW ? 0.2 : this.b === B.FOREST ? 0.1 : 0) + this.roll(cx, cy, 9012) * 0.1, cx, cy]);
    }
    list.sort((a, b) => b[0] - a[0] || a[2] - b[2] || a[1] - b[1]);
    const good = [];
    for (const [s0, cx, cy] of list.slice(0, 12)) {
      const x = cx * CHUNK + 8.5, y = cy * CHUNK + 8.5;
      let lo = 99, hi = 0, dry = true;
      for (const [i, j] of [[-15, -13], [14, -13], [-15, 12], [14, 12], [0, -13], [0, 12], [-15, 0], [14, 0]]) {
        const h = this.height(x + i, y + j);
        if (h > HAMLET_HIGH + 0.6) { dry = false; break; }
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      const rise = hi - Math.max(0, lo);
      if (dry && rise <= 2) good.push([s0 - rise * 0.25, cx, cy]);
    }
    good.sort((a, b) => b[0] - a[0] || a[2] - b[2] || a[1] - b[1]);
    // (by the water if one of the best four is; and the first of those with room for its houses)
    const order = good.slice(0, 4).map(g => [g[0] + (this.wetWithin(g[1] * CHUNK + 8.5, g[2] * CHUNK + 8.5, 40) ? 0.4 : 0), g[1], g[2]]).sort((a, b) => b[0] - a[0] || a[2] - b[2] || a[1] - b[1]);
    const best = order.concat(good.slice(4)).map(g => [g[1], g[2]]).find(([cx, cy]) => this.dryRound(cx * CHUNK + 8.5, cy * CHUNK + 8.5, 5) && this.dryRound(cx * CHUNK + 8.5, cy * CHUNK + 8.5, 9) && hamletSlots(cx, cy, (a, b) => this.wet(a, b)).length >= 2);
    return best && this.site('hamlet', ix, iy, 'aldea', best[0] * CHUNK + 8.5, best[1] * CHUNK + 8.5);
  }

  // The great places, one per cell: a lighthouse, a temple or a watchtower (or the spot of a mine), in this order
  major(T, ix, iy, force) {
    const on = k => force || this.roll(ix, iy, 9100 + T.kinds.indexOf(k)) < T.chance[k];
    if (!T.kinds.some(on)) return null;
    // (the cell every two chunks, and two more steps round it, which are the 64 m of a tower's outlook)
    const G = 2, P = 2, n = T.cell / G + P * 2, hs = new Float32Array(n * n), list = { faro: [], templo: [], torre: [], mina: [] };
    const X = i => (ix * T.cell + (i - P) * G) * CHUNK + 8.5, Y = j => (iy * T.cell + (j - P) * G) * CHUNK + 8.5, m = T.margin / G;
    const inside = (i, j) => i >= P + m && j >= P + m && i < n - P - m && j < n - P - m;
    const desert = [], rocky = [];
    for (let j = 0, k = 0; j < n; j++) for (let i = 0; i < n; i++, k++) {
      const x = X(i), y = Y(j);
      hs[k] = Math.max(0, this.probe(x, y));
      if (!inside(i, j) || this.u > 0) continue;
      const C = this.c.C;
      if (C < 0.44 && this.c.Q <= 0.5) list.faro.push([C, x, y]);
      if (this.b === B.DESERT) desert.push([this.u, x, y]);
      if (this.b === B.ROCKY) rocky.push([this.roll(i, j, 9140), x, y]);
      if (this.b === B.MEADOW || this.b === B.FOREST || this.b === B.PINES || this.b === B.ROCKY || this.b === B.SNOW || this.b === B.DESERT) list.torre.push([k, x, y]);
    }
    const put = (kind, x, y) => this.great(T, ix, iy, kind, x, y);
    if (on('faro') && !force) { const p = this.headland(list.faro), s = p && put('faro', ...p); if (s) return s; }
    if (on('templo') && !force) { const p = this.dryFlat(desert), s = p && put('templo', ...p); if (s) return s; }
    if (on('torre')) { const p = this.ridge(list.torre, hs, n), s = p && put('torre', ...p); if (s) return s; }
    if (on('mina') && !force) { const p = this.hillside(rocky), s = p && put('mina', ...p); if (s) return s; }
    return null;
  }
  great(T, ix, iy, kind, x, y) {
    let owner = null, od = OWN;
    for (const q of this.near(x, y, OWN, null, 'hamlet')) { const d = distOf(q.x, q.y, x, y); if (d < KEEP_OFF + 24) return null; if (d < od) { od = d; owner = q.key; } }
    return this.site('major', ix, iy, kind, x, y, owner ? { owner } : null);
  }
  inCellChunks(T, ix, iy, x, y) { const cx = Math.floor(x / CHUNK) - ix * T.cell, cy = Math.floor(y / CHUNK) - iy * T.cell; return cx >= 1 && cy >= 1 && cx < T.cell - 1 && cy < T.cell - 1; }
  // The headland: the coast's point that faces most open sea (of the eight directions, three at least, at 24 m)
  headland(list) {
    list.sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]);
    let best = null, bn = 2.5;
    for (const [, x0, y0] of list.slice(0, 8)) for (let k = -1; k < 4; k++) {
      const i = k < 0 ? 0 : DIR8[k * 2][0] * 9, j = k < 0 ? 0 : DIR8[k * 2][1] * 9, [x, y] = this.fit('faro', Math.floor((x0 + i) / CHUNK), Math.floor((y0 + j) / CHUNK), x0 + i, y0 + j);
      this.probe(x, y);
      if (this.u > -0.4 || (this.b !== B.BEACH && this.b !== B.ROCKY) || this.c.C > 0.42) continue;
      const n = this.sea(x, y, 24), s = n + this.roll(Math.floor(x), Math.floor(y), 9120) * 0.4;
      if (s > bn && n >= 3 && this.dryRound(x, y, 3.5)) { bn = s; best = [x, y]; }
    }
    return best;
  }
  // The desert's driest flat ground
  dryFlat(list) {
    list.sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]);
    for (const [, x0, y0] of list.slice(0, 12)) {
      const [x, y] = this.fit('templo', Math.floor(x0 / CHUNK), Math.floor(y0 / CHUNK), x0, y0), h = this.probe(x, y);
      if (this.b !== B.DESERT || this.u > 0) continue;
      if (this.dryRound(x, y, 5) && [[5, 0], [-5, 0], [0, 5], [0, -5]].every(([i, j]) => Math.abs(this.height(x + i, y + j) - h) < 1)) return [x, y];
    }
    return null;
  }
  // The ridge's high point: the one that stands out most over the land round it (PROMINENCE at least)
  ridge(list, hs, n) {
    const scored = [];
    for (const [k, x, y] of list) {
      const i = k % n, j = (k - i) / n;
      if (i < 2 || j < 2 || i >= n - 2 || j >= n - 2) continue;
      const mean = (hs[k - 2] + hs[k + 2] + hs[k - 2 * n] + hs[k + 2 * n] + hs[k - n - 1] + hs[k - n + 1] + hs[k + n - 1] + hs[k + n + 1]) / 8;
      scored.push([hs[k] - mean, x, y]);
    }
    scored.sort((a, b) => b[0] - a[0] || a[2] - b[2] || a[1] - b[1]);
    let best = null, bp = PROMINENCE;
    for (const [p0, sx, sy] of scored.slice(0, 4)) {
      if (p0 < 1) break;
      // (uphill, in steps of 6 m, and then where its chunk lets it stand)
      let x = sx, y = sy, h = this.height(x, y);
      for (let k = 0; k < 4; k++) {
        let up = null;
        for (const [i, j] of DIR8) { const hh = this.height(x + i * 6, y + j * 6); if (hh > h) { h = hh; up = [x + i * 6, y + j * 6]; } }
        if (!up || Math.hypot(up[0] - sx, up[1] - sy) > 24) break;
        [x, y] = up;
      }
      [x, y] = this.fit('torre', Math.floor(x / CHUNK), Math.floor(y / CHUNK), x, y);
      const p = this.prominence(x, y);
      if (p < bp) continue;
      this.probe(x, y);
      if (this.u > 0 || this.b === B.SWAMP || this.b === B.ICE || this.b === B.BEACH || !this.dryRound(x, y, 6)) continue;
      bp = p; best = [x, y];
    }
    return best;
  }
  hillside(list) {
    list.sort((a, b) => a[0] - b[0]);
    for (const [, x, y] of list.slice(0, 12)) { const h = this.height(x, y); if (DIR8.some(([i, j]) => this.height(x + i * 6, y + j * 6) - h >= 2.4)) return [Math.floor(x) + 0.5, Math.floor(y) + 0.5]; }
    return null;
  }

  // A cave: at the foot of a slope of rock or snow that rises behind it (to the north: its mouth looks south)
  cave(T, ix, iy, force) {
    if (!force && this.roll(ix, iy, 9201) >= T.chance) return null;
    let best = null, br = 3;
    for (let j = T.margin; j < T.cell - T.margin; j++) for (let i = T.margin; i < T.cell - T.margin; i++) for (let k = 0; k < 3; k++) {
      const cx = ix * T.cell + i, cy = iy * T.cell + j, [x, y] = this.spot('cueva', cx, cy, 10 * k), h = this.probe(x, y);
      if ((this.b !== B.ROCKY && this.b !== B.SNOW) || this.u > 0) { if (k === 0) k = 9; continue; }   // (the land changes slowly: not this chunk)
      const rise = this.height(x, y - 6) - h;
      if (rise <= br || this.height(x, y + 4) > h + 0.6 || !this.dryRound(x, y, 3)) continue;
      br = rise; best = [x, y];
    }
    if (!best) return null;
    if (this.near(best[0], best[1], KEEP_OFF, null, 'hamlet').length || this.near(best[0], best[1], KEEP_OFF, null, 'major').length) return null;
    return this.site('cave', ix, iy, 'cueva', best[0], best[1]);
  }

  // The small ones: the kind first, by the cell's land, and then its best spot
  minor(T, ix, iy, force) {
    if (!force && this.roll(ix, iy, 9301) >= T.chance) return null;
    const list = [], count = new Uint8Array(BIOMES.length);
    let beach = 0;
    for (let j = T.margin; j < T.cell - T.margin; j++) for (let i = T.margin; i < T.cell - T.margin; i++) {
      const cx = ix * T.cell + i, cy = iy * T.cell + j, [x, y] = this.spot('barco', cx, cy), h = this.probe(x, y);
      count[this.b]++;
      if (this.u > 0) continue;
      if (this.b === B.BEACH) beach++;
      list.push({ x, y, h, b: this.b, u: this.u, water: this.waterHint(), r: this.roll(cx, cy, 9310) });
    }
    // (the kind it rolls; and if that has no spot here, the others its land may hold, in order)
    const kinds = [];
    if (force) kinds.push('campamento');
    else {
      if (beach && this.roll(ix, iy, 9302) < 0.6) kinds.push('barco');
      let main = 0;
      for (let b = 1; b < count.length; b++) if (count[b] > count[main]) main = b;
      const all = minorOf(main);
      let r = this.roll(ix, iy, 9303), at = -1;
      for (let i = 0; i < all.length && at < 0; i++) { if (r < all[i][1]) at = i; else r -= all[i][1]; }
      if (at >= 0) for (let i = 0; i < all.length; i++) kinds.push(all[(at + i) % all.length][0]);
    }
    let kind = null, p = null;
    for (const k of kinds) if ((p = this.minorSpot(k, list))) { kind = k; break; }
    if (!p) return null;
    if (this.near(p.x, p.y, KEEP_OFF, null, 'hamlet').length || this.near(p.x, p.y, KEEP_OFF, null, 'major').length || this.near(p.x, p.y, KEEP_OFF, null, 'cave').length) return null;
    return this.site('minor', ix, iy, kind, p.x, p.y);
  }
  minorSpot(kind, list) {
    const by = (f, ok) => list.filter(ok).sort((a, b) => f(b) - f(a) || a.y - b.y || a.x - b.x);
    const flat = (p, d, r = 4) => [[r, 0], [-r, 0], [0, r], [0, -r]].every(([i, j]) => { const h = this.height(p.x + i, p.y + j); return h > -0.1 && Math.abs(h - p.h) < d; });
    if (kind === 'barco') return by(p => p.r, p => p.b === B.BEACH).slice(0, 5).find(p => this.sea(p.x, p.y, 12) > 0 && flat(p, 1.2, 3) && this.dryRound(p.x, p.y, 3)) || null;
    if (kind === 'campamento') return by(p => p.water + p.r * 0.2, p => GREEN(p.b) && p.water > 0 && p.u < -0.5).slice(0, 8).find(p => flat(p, 0.7) && this.dryRound(p.x, p.y, 5) && this.wetWithin(p.x, p.y, 30)) || null;
    if (kind === 'manantial') return by(p => p.water - p.h * 0.2, p => p.b !== B.BEACH && p.u > -6)[0] || null;
    if (kind === 'arbol') return by(p => p.r, p => p.b === B.MEADOW || p.b === B.FOREST || p.b === B.PINES || p.b === B.SWAMP)[0] || null;
    if (kind === 'risco') return by(p => p.h, p => p.b !== B.BEACH && p.b !== B.SWAMP && p.h > 1)[0] || null;
    if (kind === 'salegar') return by(p => p.r, p => GREEN(p.b)).slice(0, 4).find(p => flat(p, 0.8) && this.dryRound(p.x, p.y, 2)) || null;
    return null;
  }

  // ---------- asking ----------
  // The site that stands in chunk (cx, cy), or null
  at(cx, cy) {
    cx = wrapIndex(cx, CHUNK);
    const k = `${cx},${cy}`;
    for (const t of TIERS) { const n = SITE_TIERS[t].cell, s = this.inCell(t, Math.floor(cx / n), Math.floor(cy / n)); if (s && s.key === k) return s; }
    return null;
  }
  // Every cell of a tier that touches the circle (the planet goes round): fn(ix, iy)
  eachCell(tier, x, y, r, fn) {
    const n = SITE_TIERS[tier].cell * CHUNK, half = PLANET_W / 2, y0 = Math.floor((y - r) / n), y1 = Math.floor((y + r) / n);
    const a = wrapX(x) - r, b = wrapX(x) + r, spans = [[Math.max(a, -half), Math.min(b, half - 1e-6)]];
    if (a < -half) spans.push([a + PLANET_W, half - 1e-6]);
    if (b >= half) spans.push([-half, b - PLANET_W]);
    for (const [p, q] of spans) for (let iy = y0; iy <= y1; iy++) for (let ix = Math.floor(p / n); ix <= Math.floor(q / n); ix++) fn(ix, iy);
  }
  // The sites within r of (x, y); kinds: only those (a list or a Set); tier: only that one
  near(x, y, r, kinds = null, tier = null) {
    const out = [], has = kinds && (k => (kinds.has ? kinds.has(k) : kinds.includes(k))), seen = new Set();
    for (const t of tier ? [tier] : TIERS) {
      if (has && !SITE_TIERS[t].kinds.some(has)) continue;
      this.eachCell(t, x, y, r, (ix, iy) => { const s = this.inCell(t, ix, iy); if (s && !seen.has(s.key + t) && (!has || has(s.kind)) && distOf(s.x, s.y, x, y) <= r) { seen.add(s.key + t); out.push(s); } });
    }
    return out;
  }
  // The nearest site of these kinds within maxR that is not in skip (a Set of keys) and passes ok(site), or null: its
  // tiers' cells, ring by ring outwards
  nearest(x, y, kinds, maxR = 4000, skip = null, ok = null) {
    const list = Array.isArray(kinds) ? kinds : [...kinds];
    let best = null, bd = maxR;
    for (const t of new Set(list.map(k => TIER_OF[k]).filter(Boolean))) {
      const n = SITE_TIERS[t].cell * CHUNK, cols = Math.ceil(PLANET_W / n), px = wrapX(x), ix0 = Math.floor(px / n), iy0 = Math.floor(y / n);
      for (let r = 0; (r - 1) * n <= bd && r <= cols; r++) for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i += Math.abs(j) === r ? 1 : Math.max(1, 2 * r)) {
        const at = wrapX((ix0 + i + 0.5) * n), s = this.inCell(t, Math.floor(at / n), iy0 + j);
        if (!s || !list.includes(s.kind) || skip?.has(s.key) || (ok && !ok(s))) continue;
        const d = distOf(s.x, s.y, x, y);
        if (d < bd || (d === bd && best && s.key < best.key)) { bd = d; best = s; }
      }
    }
    return best;
  }
  // One cell not known yet of those within r of (x, y), in the idle time (see explore.js): false if they all are
  warm(x, y, r) {
    for (const t of TIERS) {
      let todo = null;
      this.eachCell(t, x, y, r, (ix, iy) => { if (!todo && !this.cells.has(`${t}:${ix},${iy}`)) todo = [ix, iy]; });
      if (todo) { this.inCell(t, ...todo); return true; }
    }
    return false;
  }
}
const made = new Map();
// The sites of a seed (one for all who ask)
export function sitesFor(seed) { let s = made.get(seed | 0); if (!s) { s = new Sites(seed); made.set(seed | 0, s); } return s; }

// ---------- the places of before ----------
const AROUND = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
export const LEGACY_KINDS = new Set(['cueva', 'torre', 'templo', 'barco', 'faro', 'campamento', 'aldea', 'ruinas']);
// The place each chunk had until 2026-11-24 (with the ruins, which are gone): one roll per chunk, at its centre. A hamlet
// reaches into the chunks round it, so those have no other place (and of two hamlets side by side, one stays)
export class LegacyPlaces {
  constructor(seed, biome = null) { this.seed = seed | 0; this.biome = biome || ((x, y) => biomeOf(x, y, this.seed)); this.kinds = new Map(); }
  wet(x, y) { return !!BIOMES[this.biome(x, y)].water; }
  at(cx, cy) {
    cx = wrapIndex(cx, CHUNK);
    let kind = this.raw(cx, cy);
    if (kind === 'aldea' ? !this.isHamlet(cx, cy) : kind && AROUND.some(([i, j]) => this.isHamlet(cx + i, cy + j))) kind = null;
    return kind && this.place(cx, cy, kind);
  }
  place(cx, cy, kind) {
    const x = cx * CHUNK + 8.5, y = cy * CHUNK + 8.5, b = this.biome(x, y);
    return { kind, x, y, z: 0, key: `${cx},${cy}`, id: Math.floor(ihash(cx, cy, this.seed + 701) * 1e6), snow: b === B.SNOW, biome: b, legacy: true };
  }
  isHamlet(cx, cy) {
    cx = wrapIndex(cx, CHUNK);
    if (this.raw(cx, cy) !== 'aldea') return false;
    const r = ihash(cx, cy, this.seed + 700);
    return !AROUND.some(([i, j]) => { const k = this.raw(cx + i, cy + j); return k === 'faro' || (k === 'aldea' && ihash(cx + i, cy + j, this.seed + 700) < r); });
  }
  raw(cx, cy) {
    cx = wrapIndex(cx, CHUNK);
    const k = `${cx},${cy}`;
    if (this.kinds.has(k)) return this.kinds.get(k);
    const s = this.seed, x = cx * CHUNK + 8.5, y = cy * CHUNK + 8.5;
    let kind = null;
    if (Math.hypot(x - CENTER.x, y - CENTER.y) > 45) {
      const b = this.biome(x, y), r = ihash(cx, cy, s + 700), far = Math.hypot(x - CENTER.x, y - CENTER.y) > 110;
      if (b === B.ROCKY) kind = r < 0.25 ? 'cueva' : null;
      else if (b === B.SNOW) kind = r < 0.1 ? 'cueva' : r < 0.18 ? 'torre' : null;
      else if (b === B.DESERT) kind = r < 0.1 ? 'templo' : r < 0.14 ? 'ruinas' : null;
      else if (b === B.BEACH) kind = r < 0.1 ? 'barco' : far && r < 0.13 ? 'faro' : null;
      else if (GREEN(b)) kind = r < 0.03 ? 'ruinas' : r < 0.055 ? 'campamento' : r < 0.075 ? 'torre' : far && r < 0.125 ? 'aldea' : null;
      if (kind === 'aldea' && (this.wet(x, y) || hamletSlots(cx, cy, (a, b2) => this.wet(a, b2)).length < 2)) kind = null;
    }
    if (this.kinds.size > 20000) this.kinds.clear();
    this.kinds.set(k, kind);
    return kind;
  }
}
