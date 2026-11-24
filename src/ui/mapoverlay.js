// What players and villages put on the land, for both maps (docs/planes/realismo/PLAN-R8-hud-mapa.md §3.4.3): the satellite
// pictures (sattiles.js) are the land as it was generated; this is drawn on top of them, chunk by chunk.
//
//   overlay.picture(cx, cy)      a 64 × 64 canvas (4 px per tile, see-through) with the chunk's fields, floors, paths, walls,
//                                fences and roofs, or null: nothing there. Made again only when what is seen of its chunk changes
//   overlay.footprints(x0, y0, x1, y1)   the buildings of that rectangle of tiles: [{ x0, y0, x1, y1, h, color }], one per
//                                roofed region, x0 unwrapped (h: how tall, in metres). Plan R8-3's rising houses and the 3D map
//   overlay.begin(ms)            before drawing: how long it may spend making pictures in this drawing (the rest, the next)
//   overlay.pending              whether something was left for the next drawing;  overlay.v: goes up with each one made
//
// It reads: the players' deltas (world.deltas, never world.delta(), which fills old chunks with empty fields), the village's
// own houses (world.village.built) and, of the hamlets, only the discovered ones (places.builtIn): an undiscovered one is not
// on the map. Roofs are shaded with the shape they have in the world (roof.js), across chunk borders.
import { CHUNK } from '../world/gen.js';
import { roofShape } from '../world/roof.js';
import { PIECES, parsePlaced } from '../pieces.js';
import { wrapIndex, nearX } from '../world/planet.js';
import { SAT_PX, SAT_N, hillshade } from '../world/satpixels.js';
import { goneKey } from '../world/scenes.js';
import { inBounds } from '../world/village.js';
import { CROPS } from '../items.js';
import { rgbOf, ihash } from '../util.js';

const LAYERS = ['floor', 'placed', 'roof', 'tilled', 'crops', 'trees', 'dig', 'gone'];
const KEEP = 400, REGION_MAX = 1200, FLOOR_H = 3;
const ROOFS = { tejado_rojo: '#a0664c', tejado_azul: '#54677a', tejado_gris: '#6b6f74', tejado_verde: '#5f7a64', tejado_paja: '#b59f72' };
const FLOORS = { suelo_madera: '#8d6f4e', suelo_piedra: '#8f8c84', camino: '#a39a88' };
const THINGS = { stall: rgbOf('#b05a45'), stall2: rgbOf('#5f7aa0'), stall3: rgbOf('#b59a4c'), fountain: rgbOf('#98a3a6'), dock: rgbOf('#8d6f4e') };
const SOIL = rgbOf('#6b4e36'), FURROW = rgbOf('#573e2a'), LEAF = rgbOf('#6f9440'), RIPE = rgbOf('#c9a53e'), DEAD = rgbOf('#8f8058'), DIRT = rgbOf('#7d5f45'), HEAP = rgbOf('#947353'), WALL = rgbOf('#4f4438'), FENCE = rgbOf('#6f5a44'), STONE = rgbOf('#77736a'), THING = rgbOf('#5f5346');

export class MapOverlay {
  // world(), places(): those of the game now (or null)
  constructor({ world, places = () => null }) {
    this.world = world; this.places = places;
    this.recs = new Map();   // "cx,cy" → { sig, pic, feet: [footprint], cross }
    this.v = 0; this.budget = 0; this.pending = false;
    this.of = null;
  }
  begin(ms) {
    const w = this.world();
    if (w !== this.of) { this.of = w; this.recs.clear(); this.v++; }
    this.budget = ms; this.pending = false;
  }
  // The pieces of a chunk by who put them: the players' (d), the village's (vb) and a discovered hamlet's (hb)
  src(cx, cy, k = `${wrapIndex(cx, CHUNK)},${cy}`) {
    const w = this.of, d = w.deltas.get(k), vb = w.village?.built?.[k], hb = this.places()?.builtIn?.(k);
    return d || vb || hb ? { d, vb, hb } : null;
  }
  at(layer, tx, ty) {
    const s = this.src(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK));
    if (!s) return undefined;
    const t = `${tx},${ty}`, own = s.d?.[layer]?.[t];
    if (own) return own;
    const v = s.vb?.[layer]?.[t] || s.hb?.[layer]?.[t];
    return v && !s.d?.gone?.[goneKey(layer, t)] ? v : undefined;
  }
  sig(cx, cy, cross) {
    const w = this.of;
    let s = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((dx || dy) && !cross) continue;
      const k = `${wrapIndex(cx + dx, CHUNK)},${cy + dy}`;
      s = s * 31 + (w.deltas.get(k)?.v ?? -1) + (this.places()?.builtIn?.(k) ? 7 : 0);
      s %= 1e12;
    }
    return s;
  }
  // What can be seen from above of a chunk's delta (and of those round it), as a number
  looks(cx, cy, cross) {
    let h = 17;
    const mix = s => { for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; };
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((dx || dy) && !cross) continue;
      const k = `${wrapIndex(cx + dx, CHUNK)},${cy + dy}`, d = this.of.deltas.get(k);
      mix(this.places()?.builtIn?.(k) ? `${k}+` : k);
      if (d) for (const layer of LAYERS) for (const t in d[layer] || {}) { const v = d[layer][t]; mix(t); mix(layer === 'crops' ? `${v?.id}${v?.grow | 0}${v?.dead ? 'x' : ''}` : typeof v === 'object' ? '' : String(v)); }
    }
    return h;
  }
  rec(cx, cy, k = `${cx},${cy}`) {
    const w = this.of;
    if (!w?.deltas || !this.src(cx, cy, k)) return null;
    const r = this.recs.get(k);
    if (r) {
      this.recs.delete(k); this.recs.set(k, r);
      const sig = r.vb === w.village?.built ? this.sig(cx, cy, r.cross) : null;
      if (sig === r.sig) return r;
      // (a touched chunk is seldom one that looks different from above: a door, a chest, something picked up)
      if (sig !== null && this.looks(cx, cy, r.cross) === r.looks) { r.sig = sig; return r; }
    }
    if (this.budget <= 0) { this.pending = true; return r || null; }
    const t0 = performance.now(), made = this.make(cx, cy);
    this.budget -= performance.now() - t0;
    this.recs.set(k, made);
    if (this.recs.size > KEEP) this.recs.delete(this.recs.keys().next().value);
    this.v++;
    return made;
  }
  picture(cx, cy, k) { return this.rec(cx, cy, k)?.pic || null; }   // (cx inside the planet; k: "cx,cy", if at hand)
  footprints(x0, y0, x1, y1) {
    const out = [], seen = new Set();
    for (let cy = Math.floor(y0 / CHUNK) - 1; cy <= Math.floor(y1 / CHUNK) + 1; cy++) for (let cx = Math.floor(x0 / CHUNK) - 1; cx <= Math.floor(x1 / CHUNK) + 1; cx++) {
      for (const f of this.rec(wrapIndex(cx, CHUNK), cy)?.feet || []) {
        const fx0 = nearX(f.x0, (x0 + x1) / 2), id = `${f.x0},${f.y0},${f.x1},${f.y1}`;
        if (seen.has(id) || fx0 >= x1 || fx0 + f.x1 - f.x0 <= x0 || f.y0 >= y1 || f.y1 <= y0) continue;
        seen.add(id);
        out.push({ x0: fx0, y0: f.y0, x1: fx0 + f.x1 - f.x0, y1: f.y1, h: f.h, color: f.color });
      }
    }
    return out;
  }

  make(cx, cy) {
    const { d, vb, hb } = this.src(cx, cy), x0 = cx * CHUNK, y0 = cy * CHUNK, N = SAT_N, S = SAT_PX, feet = [];
    const px = new Uint8ClampedArray(N * N * 4);
    let any = false, cross = false;
    const put = (i, j, c, v = 1, a = 255) => { const o = (j * N + i) * 4; px[o] = c[0] * v; px[o + 1] = c[1] * v; px[o + 2] = c[2] * v; px[o + 3] = a; any = true; };
    // fn(i, j, its place in the tile) for each pixel of a tile of this chunk
    const tile = (tx, ty, fn) => { const bi = (tx - x0) * S, bj = (ty - y0) * S; if (bi < 0 || bj < 0 || bi >= N || bj >= N) return; for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) fn(bi + i, bj + j, i, j); };
    const each = (layer, fn) => {
      const seen = new Set();
      for (const [src, fixed] of [[d, false], [vb, true], [hb, true]]) for (const [t, raw] of Object.entries(src?.[layer] || {})) {
        if (typeof raw !== 'string' || seen.has(t)) continue;
        const c = t.indexOf(','), tx = +t.slice(0, c), ty = +t.slice(c + 1);
        if (!Number.isInteger(tx) || !Number.isInteger(ty)) continue;
        if (fixed && d?.gone?.[goneKey(layer, t)]) continue;
        seen.add(t); fn(tx, ty, parsePlaced(raw)[0]);
      }
    };
    const tiles = (o, fn) => { for (const [t, v] of Object.entries(o || {})) { const c = t.indexOf(','), tx = +t.slice(0, c), ty = +t.slice(c + 1); if (Number.isInteger(tx) && Number.isInteger(ty)) fn(tx, ty, v, t); } };
    // Dug ground and heaps (dry: the water in them is floodOver's), fields with their rows and crops, floors and paths
    tiles(d?.dig, (tx, ty, h) => { if (typeof h !== 'number') return; const up = h > (inBounds(tx + 0.5, ty + 0.5) ? 0 : this.of.gen.groundAt(tx + 0.5, ty + 0.5)); tile(tx, ty, (i, j) => put(i, j, up ? HEAP : DIRT, 0.9 + ihash(i + x0 * 4, j + y0 * 4, 5) * 0.2)); });
    tiles(d?.tilled, (tx, ty, v, t) => {
      const c = d.crops?.[t], col = c && (c.dead ? DEAD : c.grow >= (CROPS[c.id]?.days ?? 1e9) ? RIPE : LEAF), k = c ? Math.min(1, 0.35 + (c.grow || 0) / (CROPS[c.id]?.days || 4)) : 0;
      tile(tx, ty, (i, j, u, w) => { const row = w % 2 === 1; put(i, j, row && col && ihash(i + x0 * 4, j + y0 * 4, 6) < k ? col : row ? SOIL : FURROW, 0.92 + ihash(i + x0 * 4, j + y0 * 4, 7) * 0.16); });
    });
    tiles(d?.trees, (tx, ty) => tile(tx, ty, (i, j, u, w) => { if (Math.hypot(u - 1.5, w - 1.5) < 1.6) put(i, j, LEAF, 0.8); }));
    each('floor', (tx, ty, id) => { const c = rgbOf(FLOORS[id] || FLOORS.suelo_madera); tile(tx, ty, (i, j, u, w) => put(i, j, c, 0.94 + (id === 'suelo_madera' ? (w % 2) * 0.07 : ihash(i + x0 * 4, j + y0 * 4, 8) * 0.12))); });
    // The village's own things that take more than a tile (stalls, the fountain, the dock)
    if (vb || this.thingsAt(cx, cy)) for (const q of this.of.village?.objects || []) {
      const c = q.fx && THINGS[q.model];
      if (c) for (let ty = Math.floor(q.fy[0]); ty < q.fy[1]; ty++) for (let tx = Math.floor(q.fx[0]); tx < q.fx[1]; tx++) tile(tx, ty, (i, j, u, w) => {
        if (q.model === 'fountain' && Math.hypot(tx + (u + 0.5) / S - q.x, ty + (w + 0.5) / S - q.y) > 1.5) return;
        put(i, j, c, q.model === 'dock' ? 0.9 + (u % 2) * 0.12 : (w % 2 ? 1 : 0.92));
      });
    }
    // Walls, doors and fences as thin lines joined to their neighbours; other things (stations, wells, furniture outdoors), a dot
    each('placed', (tx, ty, id) => {
      const p = PIECES[id], line = p && (p.kind === 'wall' || p.kind === 'door' || p.kind === 'fence' || p.kind === 'gate');
      const col = !line ? THING : p.kind === 'fence' || p.kind === 'gate' ? (id === 'valla_piedra' ? STONE : FENCE) : /piedra/.test(id) ? STONE : WALL;
      if (!line && /alfombra|maceta|candelabro/.test(id)) return;
      const joins = (a, b) => { const v = this.at('placed', a, b), q = v && PIECES[parsePlaced(v)[0]]; return !!q && q.kind !== 'hearth'; };
      const L = line && joins(tx - 1, ty), R = line && joins(tx + 1, ty), U = line && joins(tx, ty - 1), D = line && joins(tx, ty + 1);
      tile(tx, ty, (i, j, u, w) => { const mu = u === 1 || u === 2, mw = w === 1 || w === 2; if ((mu && mw) || (mw && ((L && u < 1) || (R && u > 2))) || (mu && ((U && w < 1) || (D && w > 2)))) put(i, j, col, p?.kind === 'door' ? 1.4 : 1); });
    });
    // Roofs: each region once (it may go on into the chunks round it), shaded by its own slopes, with a dark rim, and its
    // shadow on the ground to the south-east
    const done = new Set(), roofed = new Set();
    each('roof', (tx, ty) => {
      roofed.add(`${tx},${ty}`);
      if (done.has(`${tx},${ty}`)) return;
      const reg = [], ids = [], key = new Set([`${tx},${ty}`]), todo = [[tx, ty]];
      while (todo.length && reg.length < REGION_MAX) {
        const [x, y] = todo.pop(), raw = this.at('roof', x, y);
        if (!raw) continue;
        reg.push([x, y]); ids.push(raw);
        if (Math.floor(x / CHUNK) !== cx || Math.floor(y / CHUNK) !== cy) cross = true;
        for (const [a, b] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) { const k = `${a},${b}`; if (!key.has(k)) { key.add(k); todo.push([a, b]); } }
      }
      const set = new Set(reg.map(q => q.join())), shape = roofShape(reg, (a, b) => set.has(`${a},${b}`));
      for (const [x, y] of reg) done.add(`${x},${y}`);
      const body = rgbOf(ROOFS[parsePlaced(ids[0])[0]] || ROOFS.tejado_rojo);
      feet.push({ x0: shape.x0, y0: shape.y0, x1: shape.x1, y1: shape.y1, h: FLOOR_H, color: `rgb(${body})` });
      for (let n = 0; n < reg.length; n++) {
        const [x, y] = reg[n], col = rgbOf(ROOFS[parsePlaced(ids[n])[0]] || ROOFS.tejado_rojo);
        tile(x, y, (i, j, u, w) => {
          const gx = x + (u + 0.5) / S, gy = y + (w + 0.5) / S, e = 0.2, dx = (shape.H(gx + e, gy) - shape.H(gx - e, gy)) / (2 * e), dy = (shape.H(gx, gy + e) - shape.H(gx, gy - e)) / (2 * e);
          const rim = (u === 0 && !set.has(`${x - 1},${y}`)) || (u === S - 1 && !set.has(`${x + 1},${y}`)) || (w === 0 && !set.has(`${x},${y - 1}`)) || (w === S - 1 && !set.has(`${x},${y + 1}`));
          put(i, j, col, hillshade(dx * 0.45, dy * 0.45) * (rim ? 0.72 : 1.04) * (0.96 + ihash(i + x0 * 4, (j >> 1) + y0 * 4, 9) * 0.08));
        });
      }
    });
    // (which tiles have a roof, from one tile west and north of the chunk: only those can shade it)
    const n = CHUNK + 1, roofAt = new Uint8Array(n * n);
    let shade = false;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (i && j ? roofed.has(`${x0 + i - 1},${y0 + j - 1}`) : this.at('roof', x0 + i - 1, y0 + j - 1)) { roofAt[j * n + i] = 1; shade = true; }
    if (shade) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (roofAt[((j >> 2) + 1) * n + (i >> 2) + 1] || !roofAt[(((j - 3) >> 2) + 1) * n + ((i - 3) >> 2) + 1]) continue;
      const o = (j * N + i) * 4;
      if (px[o + 3]) { px[o] *= 0.68; px[o + 1] *= 0.68; px[o + 2] *= 0.68; } else { px[o + 3] = 82; any = true; }
    }
    let pic = null;
    if (any) {
      pic = document.createElement('canvas');
      pic.width = pic.height = N;
      pic.getContext('2d').putImageData(new ImageData(px, N, N), 0, 0);
    }
    return { sig: this.sig(cx, cy, cross), looks: this.looks(cx, cy, cross), vb: this.of.village?.built, cross, pic, feet };
  }
  thingsAt(cx, cy) { return !!this.of.village?.objects?.some(q => q.fx && THINGS[q.model] && q.fx[1] > cx * CHUNK && q.fx[0] < (cx + 1) * CHUNK && q.fy[1] > cy * CHUNK && q.fy[0] < (cy + 1) * CHUNK); }
}
