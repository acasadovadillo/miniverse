// Roads (docs/planes/realismo/PLAN-R7-mundo.md §3.7): the dirt roads that join the village, the hamlets and the landmarks, and the
// tracks that lead from them to the watchtowers, the temples, the mines, the lighthouses and the camps by them. Pure, like sites.js:
// the seed and the land, so it gives the same on the main thread, in the workers and on the server. What a world adds to it is the
// list of what its players had built before there were roads (setKept): a road keeps clear of it, cut there.
//
// The graph: an edge joins two nodes with no third one nearer to both (a relative-neighbourhood graph), up to MAX_EDGE. Its shape is
// searched on the land (way): it goes round the hills and the water and crosses a narrow stream square, on a timber bridge. A track
// is searched from its place to the nearest road.
//   roads.inChunk(cx, cy)      the stretches that touch a chunk (and MARGIN round it), or null
//   roads.mask(cx, cy)         what each of its tiles is (ON, CLEAR, DECK), or null
//   roads.near(x, y)           the nearest centreline within MARGIN: { d, side, half, cart, s, road }, or null
//   roads.mapSegments(box)     the lines, to draw
//   roads.postsIn, bridgesIn   the signposts and the timber bridges of a chunk
// No objects are made by what is asked per tile (onRoad): it reads the mask
import { vnoise } from '../util.js';
import { CHUNK } from './gen.js';
import { B, BIOMES } from './biomes.js';
import { sitesFor, hamletSlots, SITE_TIERS } from './sites.js';
import { hamletPlan } from './hamlets.js';
// (BASE_BOUNDS: the village land of before, which never changes, so the roads of every world stay where they were; the sites
// of the village keep off the roads: village.js SITES)
import { inBounds, BASE_BOUNDS as BOUNDS } from './village.js';
import { HOME_SEED, HOME_ROADS } from './homeroads.js';
import { wrapIndex, wrapX, dxOf, nearX, inPlanet } from './planet.js';

export const CART = 1.2, TRACK = 0.62;   // (half the width of a cart road, and of a track)
export const MARGIN = 3;                 // a chunk knows the roads this far out of it
export const ON = 1, CLEAR = 2, DECK = 4; // bits of the mask: the road itself; its sides, where nothing big grows; on a bridge
export const MAX_EDGE = 1400;
// How far a place may be from the road its track starts at (metres)
export const TRACK_RANGE = { torre: 380, mina: 380, templo: 420, faro: 480, campamento: 120 };
const GREAT = ['torre', 'mina', 'templo', 'faro'];
const TRACK_MAX = 480, TRACK_W = 70;     // (the farthest of them, and how far a track strays from the straight line)
const GRAPH_R = 16 + MAX_EDGE * 1.5 + 250;   // (how far off a hamlet counts for the roads of a place)
export const BRIDGE_MAX = 8;             // a wider stretch of water is not bridged
const G = 8;                             // the lattice a road is searched on
const STEP = 4;                          // and how far apart its points are
const HAMLET_HALF = 27;
const SLOPE = { cart: 0.45, track: 0.72 };
// The landmarks of the one world (sites.js, hunt, finds them: src/pruebas.js compares them). Another seed has none here
const LANDMARKS = { 20261030: { '-26,3': 'majada', '34,12': 'santuario', '-4,62': 'roble', '21,19': { kind: 'hito', x: 336.5, y: 307.5, key: '21,19', id: 355140, z: 0, snow: false, yaw: 0, len: 9, biome: 1 } } };
export const landmarksOf = seed => LANDMARKS[seed] || {};
// How much room the places want (a road goes round them)
const ROOM = { campamento: 6.5, barco: 6, manantial: 4, arbol: 5, risco: 4.5, salegar: 4, cueva: 5, templo: 12, torre: 6, faro: 7, mina: 7 };
// Where a track comes to a place: this far from its middle
const DOOR = { torre: 5.2, faro: 4.6, templo: 11.5, mina: 5, campamento: 5 };
// (nothing of a road is in the village, but for its last two metres, where its path ends)
export const OUT_Y = 60;
const HOME = { id: 'home', kind: 'home', x: 16, y: 60.5, ports: [[16, 60.2, 0, 1]], r: 0 };
const TURNS = [[1, 0], [0.7, 0.7], [0.7, -0.7], [0, 1], [0, -1], [-0.86, 0.5]];   // (cosine and sine, written out)
const DIR4 = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const DIR8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const BIOME_K = [];
const biomeK = b => { if (!BIOME_K.length) { for (let i = 0; i < BIOMES.length; i++) BIOME_K.push(1); Object.assign(BIOME_K, { [B.FOREST]: 1.12, [B.PINES]: 1.15, [B.SWAMP]: 2.6, [B.SNOW]: 1.2, [B.ROCKY]: 1.25, [B.BEACH]: 1.35, [B.DESERT]: 1.05, [B.ICE]: 4 }); } return BIOME_K[b]; };
// (its own: the square root is the same to the bit in every engine, Math.hypot is not)
const hyp = (x, y) => Math.sqrt(x * x + y * y);
const num = (cx, cy) => (cx + 4096) * 8192 + cy + 4096;
const segDist = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0; return hyp(px - ax - t * dx, py - ay - t * dy); };
// How far a road may stray from the straight line between its ends
const stray = (len, home) => Math.max(home ? 190 : 90, Math.min(240, 50 + 0.22 * len));
function lruSet(m, k, v, max) { m.set(k, v); if (m.size > max) m.delete(m.keys().next().value); return v; }
function lruGet(m, k) { const v = m.get(k); if (v !== undefined) { m.delete(k); m.set(k, v); } return v; }

// ---------- the search ----------
// Buffers shared by every search of this thread (they grow)
let buf = null;
function buffers(n) {
  if (!buf || buf.n < n) buf = { n, h: new Float32Array(n), u: new Float32Array(n), b: new Uint8Array(n), st: new Uint8Array(n), g: new Float32Array(n), from: new Int32Array(n), hop: new Int32Array(n), heap: new Int32Array(n * 2), hf: new Float32Array(n * 2), mid: new Uint8Array(n * 4) };
  buf.st.fill(0, 0, n); buf.g.fill(Infinity, 0, n); buf.hop.fill(0, 0, n); buf.mid.fill(0, 0, n * 4);
  return buf;
}
// The way from one of the starts to one of the goals ([x, y] each, x not wrapped) over the land of S (Sites), within `wide` of the
// segment between (ax, ay) and (bx, by): { pts: [[x, y, pinned]…], bridges: [{ x, y, yaw, L, w }] } or null. blocked(x, y): not there
function way(S, starts, goals, { ax, ay, bx, by, wide, blocked, track }) {
  const mx = Math.min(ax, bx) - wide - G, my = Math.min(ay, by) - wide - G, i0 = Math.floor(mx / G), j0 = Math.floor(my / G);
  const nx = Math.ceil((Math.max(ax, bx) + wide + G) / G) - i0 + 1, ny = Math.ceil((Math.max(ay, by) + wide + G) / G) - j0 + 1, n = nx * ny;
  const { h, u, b, st, g, from, hop, heap, hf, mid } = buffers(n);
  const X = i => (i + i0) * G + 0.5, Y = j => (j + j0) * G + 0.5, limit = track ? SLOPE.track : SLOPE.cart;
  // (st: 0 not looked at, 1 open ground, 2 water, 3 out of bounds; + 4 done)
  const look = (i, j) => {
    const k = j * nx + i;
    if (st[k]) return st[k] & 3;
    const x = X(i), y = Y(j);
    if (i < 1 || j < 1 || i >= nx - 1 || j >= ny - 1 || segDist(x, y, ax, ay, bx, by) > wide || !inPlanet(wrapX(x), y) || blocked(x, y)) return (st[k] = 3);
    h[k] = Math.max(0, S.probe(x, y)); u[k] = S.u; b[k] = S.b;
    return (st[k] = S.u > 0 || BIOMES[S.b].water ? 2 : 1);
  };
  let size = 0;
  const push = (k, f) => { let i = size++; while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= f) break; heap[i] = heap[p]; hf[i] = hf[p]; i = p; } heap[i] = k; hf[i] = f; };
  const pop = () => {
    const top = heap[0], lk = heap[--size], lf = hf[size];
    let i = 0;
    for (;;) { let c = i * 2 + 1; if (c >= size) break; if (c + 1 < size && hf[c + 1] < hf[c]) c++; if (hf[c] >= lf) break; heap[i] = heap[c]; hf[i] = hf[c]; i = c; }
    heap[i] = lk; hf[i] = lf;
    return top;
  };
  const guess = k => { const x = X(k % nx), y = Y((k / nx) | 0); let d = Infinity; for (const q of goals) d = Math.min(d, hyp(q[0] - x, q[1] - y)); return d * 1.3; };
  const cell = p => { const i = Math.max(1, Math.min(nx - 2, Math.round((p[0] - 0.5) / G) - i0)), j = Math.max(1, Math.min(ny - 2, Math.round((p[1] - 0.5) / G) - j0)); return j * nx + i; };
  // (the open cell nearest to a point: its own, or one of the eight round it)
  const around = p => { const k = cell(p), i = k % nx, j = (k / nx) | 0; let best = -1, bd = Infinity; for (let q = -1; q <= 1; q++) for (let r = -1; r <= 1; r++) { const a = i + r, c = j + q; if (a < 1 || c < 1 || a >= nx - 1 || c >= ny - 1 || look(a, c) !== 1) continue; const d = hyp(X(a) - p[0], Y(c) - p[1]); if (d < bd) { bd = d; best = c * nx + a; } } return best; };
  const goalAt = new Map(), startAt = new Map();
  for (const q of goals) { const k = around(q); if (k >= 0 && !goalAt.has(k)) goalAt.set(k, q); }
  if (!goalAt.size) return null;
  for (const p of starts) { const k = around(p); if (k < 0 || startAt.has(k)) continue; startAt.set(k, p); g[k] = hyp(X(k % nx) - p[0], Y((k / nx) | 0) - p[1]); from[k] = -1; push(k, g[k] + guess(k)); }
  const relax = (k, kk, cost, o) => { const v = g[k] + cost; if (v >= g[kk] - 1e-6) return; g[kk] = v; from[kk] = k; hop[kk] = o; push(kk, v + guess(kk)); };
  const hops = [null];
  let end = -1, max = 60000;
  while (size && max-- > 0) {
    const k = pop();
    if (st[k] & 4) continue;
    st[k] |= 4;
    if (goalAt.has(k)) { end = k; break; }
    const i = k % nx, j = (k / nx) | 0, x = X(i), y = Y(j), hk = h[k], uk = u[k];
    for (let d = 0; d < 8; d++) {
      const [di, dj] = DIR8[d], a = i + di, c = j + dj, what = look(a, c);
      if (what === 3) continue;
      const kk = c * nx + a, square = !(d & 1), len = square ? G : G * Math.SQRT2;
      let wet = what === 2;
      if (!wet) {
        if (st[kk] & 4) continue;
        const sl = Math.abs(h[kk] - hk) / len;
        if (sl > limit) continue;
        const v = 1 + (track ? 5 : 11) * sl * sl + (sl > 0.2 ? (sl - 0.2) * (track ? 5 : 14) : 0), m = biomeK(b[kk]) * (0.82 + 0.36 * vnoise(X(a) * 0.017, Y(c) * 0.017, S.seed + 8801)) + (u[kk] > -0.9 ? 1.1 : 0), cost = len * v * m;
        if (g[k] + cost >= g[kk] - 1e-6) continue;
        // (near water, also between the two: a stream may be narrower than the lattice)
        // (mid: the four ways of a point that have been looked at, by their lower end: 1 dry, 2 wet)
        if (Math.max(uk, u[kk]) > -5) {
          const low = di > 0 || (di === 0 && dj > 0), e = (low ? k : kk) * 4 + (di === 0 ? 0 : dj === 0 ? 1 : di === dj ? 2 : 3);
          if (!mid[e]) { mid[e] = 1; for (let q = 2; q !== 0; q = q === 2 ? 1 : q === 1 ? 3 : 0) if (S.wet(x + di * G * q / 4, y + dj * G * q / 4)) { mid[e] = 2; break; } }
          wet = mid[e] === 2;
        }
        if (!wet) { relax(k, kk, cost, 0); continue; }
      }
      // (across it, if there is ground two or three steps on that is no better reached already)
      if (square && !track) {
        let land = false;
        for (let q = 2; q <= 3 && !land; q++) { const a2 = i + di * q, c2 = j + dj * q; if (a2 > 0 && c2 > 0 && a2 < nx - 1 && c2 < ny - 1 && look(a2, c2) === 1 && !(st[c2 * nx + a2] & 4) && g[k] + q * G + 78 < g[c2 * nx + a2]) land = true; }
        if (!land) continue;
        const o = span(S, x, y, di, dj);
        if (!o) continue;
        const a2 = i + di * o.n, c2 = j + dj * o.n;
        if (a2 < 1 || c2 < 1 || a2 >= nx - 1 || c2 >= ny - 1 || look(a2, c2) !== 1) continue;
        const k2 = c2 * nx + a2;
        if (st[k2] & 4) continue;
        hops.push(o);
        relax(k, k2, o.n * G + 70 + o.w * 8, hops.length - 1);
      }
    }
  }
  if (end < 0) return null;
  const out = [], bridges = [];
  for (let k = end; k >= 0; k = from[k]) {
    out.push([X(k % nx), Y((k / nx) | 0), false]);
    const o = hops[hop[k]];
    if (o && from[k] >= 0) {
      const p = from[k], px = X(p % nx), py = Y((p / nx) | 0), x = px + o.di * o.c, y = py + o.dj * o.c, r = o.L / 2 + 1.5;
      bridges.push({ x, y, yaw: o.di ? Math.PI / 2 : 0, L: o.L, w: o.w });
      out.push([x + o.di * r, y + o.dj * r, true], [x - o.di * r, y - o.dj * r, true]);
    }
    if (from[k] < 0) { const s = startAt.get(k); out.push([s[0], s[1], true]); }
  }
  out.reverse(); bridges.reverse();
  const q = goalAt.get(end); out.push([q[0], q[1], true]);
  return { pts: out, bridges };
}
// Across the water from (x, y) along a direction of the lattice: { n: lattice steps to the far side, c: where the middle of the bridge
// goes (tiles from here), L: how long it is, w: how wide the water }, or null
function span(S, x, y, di, dj) {
  let t0 = -1, t1 = -1;
  const at = t => S.wet(x + di * t, y + dj * t);
  // (every two metres, and then to the metre)
  for (let t = 2; t <= 18; t += 2) { const w = at(t); if (w && t0 < 0) t0 = t; else if (!w && t0 >= 0) { t1 = t; break; } else if (w && t - t0 >= BRIDGE_MAX) break; else if (!w && t > 10) break; }
  if (t0 < 0 || t1 < 0) return null;
  if (at(t0 - 1)) t0--;
  if (!at(t1 - 1)) t1--;
  if (t0 < 0 || t1 < 0 || t1 - t0 > BRIDGE_MAX) return null;
  const w = t1 - t0, L = w <= 2 ? 5 : w <= 4 ? 7 : w <= 6 ? 9 : 11, c = Math.round((t0 + t1 - 1) / 2), e = L / 2 + 0.3, n = Math.max(2, Math.ceil((c + e + 1.2) / G - 1e-6));
  if (c - e < 1.2 - 1e-6 || n > 3) return null;
  // (its banks: dry and low, at the middle and at both sides, and nothing else to cross on the way)
  for (const z of [c - e, c - e - 1.2, c + e, c + e + 1.2]) for (const s of [-1.3, 0, 1.3]) { const px = x + di * z - dj * s, py = y + dj * z + di * s; if (S.wet(px, py) || Math.max(0, S.height(px, py)) > 0.45) return null; }
  for (let t = Math.ceil(c + e); t < n * G; t++) if (at(t)) return null;
  for (const s of [-1.4, 1.4]) { let k = 0; for (let t = t0 - 2; t < t1 + 2; t++) if (S.wet(x + di * t - dj * s, y + dj * t + di * s)) k++; if (!k || k > BRIDGE_MAX) return null; }
  return { n, c, L, w, di, dj };
}

// ---------- the roads ----------
export class Roads {
  // (home: with the ones round the village, worked out beforehand: homeroads.js)
  constructor(seed, home = true) {
    this.seed = seed | 0;
    this.sites = sitesFor(this.seed);
    this.linesV = 0;           // (goes up with each line that is worked out or comes from the worker)
    this.keptV = 0; this.kept = new Set(); this.keptList = []; this.keptKey = '';
    this.nodes = new Map();    // a hamlet's key → its node
    this.links = new Map();    // a node's id → its edges
    this.lines = new Map();    // an edge's id → its road, or null (there is no way)
    this.cells = new Map();    // a chunk → its stretches, or null
    this.masks = new Map();    // …and its tiles
    this.lists = new Map();
    this.stats = { lines: 0, ms: 0, worst: 0, plans: 0, msPlans: 0 };
    this.homeLeft = home && this.seed === HOME_SEED ? HOME_ROADS : null;
    this.hit = { d: 0, side: 0, half: 0, cart: false, s: 0, road: null };
    this.landmarks = null;
  }
  // What had been built in this world before its roads (frozenplaces.js, roadCells): 'cx,cy,hhhh', a chunk and which of its sixteen
  // squares of 4 m, a bit each. A road is cut there. → did it change?
  setKept(list) {
    list = Array.isArray(list) ? list : [];
    const key = list.join(';');
    if (key === this.keptKey) return false;
    this.keptKey = key; this.keptV++; this.keptList = list;
    this.kept = new Set();
    for (const q of list) { const [cx, cy, h] = q.split(','), m = parseInt(h, 16) || 0; for (let k = 0; k < 16; k++) if (m >> k & 1) this.kept.add(`${cx * 4 + (k & 3)},${cy * 4 + (k >> 2)}`); }
    this.forget();
    return true;
  }
  forget() { for (const r of this.lines.values()) if (r) { r.cut = null; r.sign = null; } for (const n of this.landmark()) n.post = undefined; this.home0 = null; this.cells.clear(); this.masks.clear(); this.lists.clear(); }

  // ---------- the graph ----------
  landmark() {
    if (this.landmarks) return this.landmarks;
    const out = [];
    for (const [key, v] of Object.entries(landmarksOf(this.seed))) {
      const id = typeof v === 'string' ? v : 'puente', [cx, cy] = key.split(',').map(Number), s = typeof v === 'string' ? this.sites.at(cx, cy) : v;
      if (!s) continue;
      const n = { id: key, kind: 'hito', hito: id, site: s, x: s.x, y: s.y, ports: [], r: { majada: 13, santuario: 10, roble: 7, puente: 6 }[id] };
      if (id === 'puente') { const e = s.len / 2 + 1.6, dx = Math.sin(s.yaw), dy = Math.cos(s.yaw); n.ports = [[s.x + dx * e, s.y + dy * e, dx, dy], [s.x - dx * e, s.y - dy * e, -dx, -dy]]; n.deck = { x: s.x, y: s.y, yaw: s.yaw, L: s.len }; }
      else if (id === 'santuario') n.ports = [[s.x, s.y + 7.5, 0, 1]];
      else for (const [i, j] of DIR8) { const l = hyp(i, j), e = id === 'roble' ? 5.5 : 12.5; n.ports.push([s.x + i / l * e, s.y + j / l * e, i / l, j / l]); }
      out.push(n);
    }
    return (this.landmarks = out);
  }
  hamletNode(s) {
    let n = this.nodes.get(s.key);
    if (!n) lruSet(this.nodes, s.key, (n = { id: s.key, kind: 'aldea', site: s, x: s.x, y: s.y, ports: null, r: HAMLET_HALF }), 400);
    return n;
  }
  // A hamlet's street: where the roads come in (its ends), worked out when first wanted
  portsOf(n) {
    if (n.ports) return n.ports;
    const t0 = globalThis.performance?.now?.() ?? 0, S = this.sites, p = n.site, L = hamletPlan(p, this.land(), { mine: this.mineBy(p), scattered: hamletSlots(Math.floor(p.x / CHUNK), Math.floor(p.y / CHUNK), this.land().wet) });
    n.ports = [];
    for (const [i, j] of DIR4) {
      // (the farthest tile of its gravel that way, in the middle of the street; the ends of the square are no street)
      let best = null, far = 8;
      for (const [k, id] of Object.entries(L.floor)) {
        if (id !== 'camino') continue;
        const c = k.indexOf(','), x = +k.slice(0, c) + 0.5 - p.x, y = +k.slice(c + 1) + 0.5 - p.y, a = x * i + y * j, o = Math.abs(x * j - y * i);
        if (o < 1.6 && a > far) { far = a; best = a; }
      }
      if (best !== null) { const side = i ? [0, L.q & 1 ? 0 : -0.5] : [L.q & 1 ? -0.5 : 0, 0]; n.ports.push([p.x + i * (best + 0.6) + side[0], p.y + j * (best + 0.6) + side[1], i, j]); }
    }
    // (with no street, from wherever one comes: at the edge of the square)
    if (!n.ports.length) for (const [i, j] of DIR4) if (S.dryRound(p.x + i * 24, p.y + j * 24, 4)) n.ports.push([p.x + i * 24, p.y + j * 24, i, j]);
    this.stats.plans++; this.stats.msPlans += (globalThis.performance?.now?.() ?? 0) - t0;
    return n.ports;
  }
  land() {
    const S = this.sites;
    return (this.theLand ||= { wet: (x, y) => { S.probe(x, y); return !!BIOMES[S.b].water; }, height: (x, y) => Math.max(0, S.height(x, y)), probe: (x, y) => { S.probe(x, y); return S.u > 0 ? -1 : Math.max(0, S.h); } });
  }
  // Is there a mine by a hamlet? (what it lives on: explore.js asks the same of sites.near, cell by cell; here, only the cells that may)
  mineBy(p) { return this.sites.mineNear(p.x, p.y, 420); }
  // The nodes within r of a point
  nodesNear(x, y, r) {
    const out = [];
    for (const s of this.sites.near(x, y, r, null, 'hamlet')) out.push(this.hamletNode(s));
    if (hyp(dxOf(HOME.x, x), HOME.y - y) <= r) out.push(HOME);
    for (const n of this.landmark()) if (hyp(dxOf(n.x, x), n.y - y) <= r) out.push(n);
    return out;
  }
  // The edges of a node: [{ id, a, b, len, wide }] (a is the one with the lower id)
  edgesOf(n) {
    const had = lruGet(this.links, n.id);
    if (had) return had;
    const near = this.nodesNear(n.x, n.y, MAX_EDGE).filter(q => q.id !== n.id), out = [];
    const dist = (p, q) => hyp(dxOf(p.x, q.x), p.y - q.y);
    for (const q of near) {
      const d = dist(n, q);
      if (near.some(c => c !== q && Math.max(dist(n, c), dist(q, c)) < d)) continue;
      const [a, b] = n.id < q.id ? [n, q] : [q, n];
      out.push({ id: `${a.id}>${b.id}`, a, b, len: d, wide: stray(d, a === HOME || b === HOME) });
    }
    return lruSet(this.links, n.id, out, 600);
  }

  // ---------- the lines ----------
  // The road of an edge, or null: { id, kind: 'cart' | 'track', a, b (its ends: nodes; a track's b, a site), pts: Float64Array [x, y…] (x
  // not wrapped: it goes on from its first point), at: Float32Array (metres from the start), len, box, bridges, cut (per point: does it
  // go on?) }
  line(e) {
    const had = lruGet(this.lines, e.id);
    if (had !== undefined) return had;
    const home = this.unpack(e.id);
    if (home !== undefined) return home;
    const t0 = globalThis.performance?.now?.() ?? 0, r = this.trace(e), ms = (globalThis.performance?.now?.() ?? 0) - t0;
    this.stats.lines++; this.stats.ms += ms; this.stats.worst = Math.max(this.stats.worst, ms);
    return this.keep(e.id, r);
  }
  // Those round the village, as homeroads.js has them: id → [kind, the points (in 64ths of a metre, each from the one before), the stretches
  // that are not there, the bridges, and of a track its road, where it leaves it and its place], or 0 (there is no way)
  packed() {
    const o = [];
    for (const [id, r] of this.lines) {
      if (!r) { o.push(`${JSON.stringify(id)}: 0`); continue; }
      const d = [], gone = []; let x = 0, y = 0;
      for (let i = 0; i < r.n; i++) { const a = Math.round(r.pts[i * 2] * 64), b = Math.round(r.pts[i * 2 + 1] * 64); d.push(a - x, b - y); x = a; y = b; if (!r.dry[i]) gone.push(i); }
      o.push(`${JSON.stringify(id)}: ${JSON.stringify([r.cart ? 1 : 0, d.join(), gone.join(), r.bridges.map(b => [b.x, b.y, b.yaw ? 1 : 0, b.L, b.w]), r.parent ? [r.parent.id, r.join, r.b.key, r.b.kind, r.b.x, r.b.y] : 0])}`);
    }
    return `{\n${o.join(',\n')}\n}`;
  }
  unpack(id) {
    const v = this.homeLeft?.[id];
    if (v === undefined) return undefined;
    if (!v) return this.keep(id, null);
    const d = v[1].split(','), n = d.length / 2, pts = new Float64Array(n * 2), at = new Float32Array(n), dry = new Uint8Array(n).fill(1);
    let x = 0, y = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      x += +d[i * 2]; y += +d[i * 2 + 1];
      const a = (pts[i * 2] = x / 64), b = (pts[i * 2 + 1] = y / 64);
      if (i) at[i] = at[i - 1] + hyp(a - pts[i * 2 - 2], b - pts[i * 2 - 1]);
      x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, a); y1 = Math.max(y1, b);
    }
    if (v[2]) for (const i of v[2].split(',')) dry[+i] = 0;
    const t = v[4], parent = t ? this.lineById(t[0]) : null;
    const [a, b] = t ? [{ id: t[0], key: '', kind: 'join' }, { id: t[2], key: t[2], kind: t[3], x: t[4], y: t[5] }] : id.split('>').map(q => this.node(q));
    if (!a || !b || (t && !parent)) return undefined;
    const kind = v[0] ? 'cart' : 'track';
    return this.keep(id, { id, kind, cart: !!v[0], half: v[0] ? CART : TRACK, a, b, pts, n, at, len: at[n - 1], box: [x0, y0, x1, y1], bridges: v[3].map(q => ({ x: q[0], y: q[1], yaw: q[2] ? Math.PI / 2 : 0, L: q[3], w: q[4] })), dry, cut: null, sign: null, ...(t ? { parent, join: t[1] } : null) });
  }
  lineById(id) { const had = lruGet(this.lines, id); return had !== undefined ? had : this.unpack(id); }
  keep(id, r) { this.linesV++; return lruSet(this.lines, id, r, 500); }
  trace(e) {
    const { a, b } = e, S = this.sites, ax = wrapX(a.x), ay = a.y, bx = nearX(b.x, ax), by = b.y;
    // (out of each end a little, straight on from its street, before turning)
    const ends = n => {
      const all = n.kind === 'aldea' ? this.portsOf(n) : n.ports, clear = (p, out) => { for (let t = 1; t <= out; t += 1.5) if (S.wet(p[0] + p[2] * t, p[1] + p[3] * t)) return false; return true; };
      if (n === HOME) return all.map(p => ({ p, out: 11 }));
      // (as far out as it is dry: 11 m if it can be, 3 at least)
      const ok = all.map(p => ({ p, out: (n.kind === 'hito' ? [4] : [11, 7, 3]).find(o => clear(p, o)) || 0 })).filter(q => q.out);
      return ok.length ? ok : all.map(p => ({ p, out: 0 }));
    };
    const pa = ends(a), pb = ends(b);
    const at = (n, q, ref) => { const x = nearX(q.p[0], ref) + q.p[2] * q.out, y = q.p[1] + q.p[3] * q.out; return [x, y, q]; };
    const starts = pa.map(q => at(a, q, ax)), goals = pb.map(q => at(b, q, bx));
    const others = this.nodesNear((ax + bx) / 2, (ay + by) / 2, e.len / 2 + e.wide + 40).filter(n => n.r).map(n => [nearX(n.x, (ax + bx) / 2), n.y, n.kind === 'aldea' ? n.r : n.r + (n.deck ? 1 : 2), n.kind]);
    const mouth = [...starts, ...goals].filter(q => q[2].out && q[2].out < 11);
    const blocked = (x, y) => {
      if (x > BOUNDS.x0 - 8 && x < BOUNDS.x1 + 8 && y > BOUNDS.y0 - 8 && y < BOUNDS.y1 + 3) return true;
      for (const q of mouth) if (hyp(q[0] - x, q[1] - y) < 9) return false;
      for (const [ox, oy, r, kind] of others) if (kind === 'aldea' ? Math.abs(x - ox) < r && Math.abs(y - oy) < r : hyp(x - ox, y - oy) < r) return true;
      return false;
    };
    const w = way(S, starts, goals, { ax, ay, bx, by, wide: e.wide, blocked, track: false });
    if (!w) return null;
    const s = starts.find(q => q[0] === w.pts[0][0] && q[1] === w.pts[0][1]), z = w.pts[w.pts.length - 1], g = goals.find(q => q[0] === z[0] && q[1] === z[1]);
    const ps = s && s[2].p, pg = g && g[2].p;
    if (ps) w.pts.unshift([nearX(ps[0], ax), ps[1], true]);
    if (pg) w.pts.push([nearX(pg[0], bx), pg[1], true]);
    return this.make(e.id, 'cart', a, b, w);
  }
  // From the raw way to the road: a point every STEP, smoothed, out of the water and round the places
  make(id, kind, a, b, w) {
    const S = this.sites, half = kind === 'cart' ? CART : TRACK, P = [];
    for (let i = 0; i < w.pts.length; i++) {
      const p = w.pts[i], q = w.pts[i + 1];
      P.push([p[0], p[1], p[2] ? 1 : 0]);
      if (!q) break;
      const d = hyp(q[0] - p[0], q[1] - p[1]), n = Math.round(d / STEP), both = p[2] && q[2];
      for (let k = 1; k < n; k++) P.push([p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n, both ? 1 : 0]);
    }
    const N = P.length, raw = P.map(p => [p[0], p[1]]);
    const soft = (times, from = 0, to = N) => { for (let t = 0; t < times; t++) { let px = P[Math.max(0, from - 1)][0], py = P[Math.max(0, from - 1)][1]; for (let i = Math.max(1, from); i < Math.min(N - 1, to); i++) { const p = P[i], ox = p[0], oy = p[1]; if (!p[2]) { p[0] = ox * 0.4 + (px + P[i + 1][0]) * 0.3; p[1] = oy * 0.4 + (py + P[i + 1][1]) * 0.3; } px = ox; py = oy; } } };
    soft(26);
    // (no road is straight for long: it sways a few metres)
    if (kind === 'cart' || N > 20) {
      const sway = kind === 'cart' ? 9 : 5, Q = P.map(p => [p[0], p[1]]);
      for (let i = 1; i < N - 1; i++) {
        if (P[i][2]) continue;
        let k = 12; for (let t = 1; t < 12; t++) if (i - t < 1 || i + t > N - 2 || P[i - t][2] || P[i + t][2]) { k = t; break; }
        const dx = Q[i + 1][0] - Q[i - 1][0], dy = Q[i + 1][1] - Q[i - 1][1], l = hyp(dx, dy) || 1, w = (vnoise(Q[i][0] * 0.021, Q[i][1] * 0.021, this.seed + 8802) + vnoise(Q[i][0] * 0.05, Q[i][1] * 0.05, this.seed + 8803) * 0.5 - 0.75) * sway * (k / 12);
        P[i][0] += -dy / l * w; P[i][1] += dx / l * w;
      }
      soft(4);
    }
    // Round the places by it
    const sites = this.sitesBy(P, a, b);
    if (sites.length) {
      for (let pass = 0; pass < 3; pass++) {
        let moved = false;
        for (const [sx, sy, r] of sites) for (const p of P) {
          if (p[2]) continue;
          const dx = p[0] - sx, dy = p[1] - sy, d = hyp(dx, dy), R = r + half + 1;
          if (d >= R + 8) continue;
          const want = d < R ? R : d, k = (want - d) + (d < R + 8 ? (1 - (Math.max(d, R) - R) / 8) * 0.6 : 0);
          if (k > 0.05) { const l = d || 1; p[0] += (d ? dx / l : 1) * k; p[1] += (d ? dy / l : 0) * k; moved = true; }
        }
        if (!moved) break;
        soft(6);
      }
    }
    // Out of the water: a point that has strayed into it goes back towards where it was found
    const wet = (x, y) => { S.probe(x, y); return S.u > -0.12 || !!BIOMES[S.b].water; };
    const bad = p => wet(p[0], p[1]) || (S.u > -3 && (wet(p[0] + half, p[1]) || wet(p[0] - half, p[1]) || wet(p[0], p[1] + half) || wet(p[0], p[1] - half)));
    const onDeck = p => w.bridges.some(q => (q.yaw ? Math.abs(p[1] - q.y) < 1.4 && Math.abs(p[0] - q.x) < q.L / 2 + 1.2 : Math.abs(p[0] - q.x) < 1.4 && Math.abs(p[1] - q.y) < q.L / 2 + 1.2));
    for (let i = 1; i < N - 1; i++) { const p = P[i]; if (p[2] || !bad(p)) continue; for (const k of [0.5, 1]) { const x = p[0] + (raw[i][0] - p[0]) * k, y = p[1] + (raw[i][1] - p[1]) * k; if (k === 1 || !bad([x, y])) { p[0] = x; p[1] = y; break; } } }
    // (and what is still in it: a few steps to one side or the other, with what is before and after, if that is dry)
    const moved = new Uint8Array(N);
    const fine = (k, [x, y]) => { return !wet(x, y) && !sites.some(([sx, sy, r]) => hyp(x - sx, y - sy) < r + 0.5); };
    for (let i = 1; i < N - 1; i++) {
      const open = k => P[k][2] || onDeck(P[k]) || inBounds(P[k][0], P[k][1]) || (!wet(P[k][0], P[k][1]) && !S.wet((P[k][0] + P[k + 1][0]) / 2, (P[k][1] + P[k + 1][1]) / 2));
      if (open(i)) continue;
      let e = i;
      while (e < N - 2 && e < i + 12 && !open(e + 1)) e++;
      const A = Math.max(1, i - 6), Z = Math.min(N - 2, e + 6);
      let done = false;
      for (const off of [2.5, -2.5, 5, -5, 8, -8, 11, -11]) {
        if (done) break;
        const to = [];
        let ok = true;
        for (let k = A; k <= Z && ok; k++) {
          const p = P[k];
          if (p[2]) { to.push(null); if (k >= i && k <= e + 1) ok = false; continue; }
          const dx = P[k + 1][0] - P[k - 1][0], dy = P[k + 1][1] - P[k - 1][1], l = hyp(dx, dy) || 1, t = k < i ? (k - A + 1) / (i - A + 1) : k > e ? (Z + 1 - k) / (Z - e + 1) : 1, w = off * t * t * (3 - 2 * t), q = [p[0] - dy / l * w, p[1] + dx / l * w];
          if (k >= i - 2 && k <= e + 2 && !fine(k, q)) ok = false;
          to.push(q);
        }
        for (let k = 0; k + 1 < to.length && ok; k++) if (to[k] && to[k + 1] && S.wet((to[k][0] + to[k + 1][0]) / 2, (to[k][1] + to[k + 1][1]) / 2)) ok = false;
        if (!ok) continue;
        for (let k = A; k <= Z; k++) if (to[k - A]) { P[k][0] = to[k - A][0]; P[k][1] = to[k - A][1]; moved.fill(1, Math.max(1, A - 2), Math.min(N - 1, Z + 3)); }
        done = true;
      }
      i = e;
    }
    // (what has been moved, softened again where that keeps it dry: no knots)
    for (let t = 0; t < 5; t++) for (let i = 1; i < N - 1; i++) {
      if (!moved[i] || P[i][2]) continue;
      const x = P[i][0] * 0.4 + (P[i - 1][0] + P[i + 1][0]) * 0.3, y = P[i][1] * 0.4 + (P[i - 1][1] + P[i + 1][1]) * 0.3;
      const clear = (px, py) => !wet(px, py) && !S.wet((px + P[i - 1][0]) / 2, (py + P[i - 1][1]) / 2) && !S.wet((px + P[i + 1][0]) / 2, (py + P[i + 1][1]) / 2);
      if (!clear(x, y) && clear(P[i][0], P[i][1])) continue;
      P[i][0] = x; P[i][1] = y;
    }
    const far = (x, y) => { S.probe(x, y); return S.u < -8; };   // (well away from any water)
    // A brook that is still crossed: a short bridge over it, square to one of the axes, if its banks let
    if (kind === 'cart') for (let i = 3; i < N - 4; i++) {
      const brook = k => { for (const q of [0.5, 0.25, 0.75, 0]) { const x = P[k][0] + (P[k + 1][0] - P[k][0]) * q, y = P[k][1] + (P[k + 1][1] - P[k][1]) * q; if (S.wet(x, y)) return onDeck([x, y]) ? null : [x, y]; if (q === 0.5 && far(x, y)) return null; } return null; };
      if (P[i][2] || P[i + 1][2]) continue;
      const w0 = brook(i);
      if (!w0) continue;
      const q = this.footbridge(P, i, w0);
      if (!q) continue;
      const n = q.z - q.a;
      for (let k = q.a; k <= q.z; k++) { const t = (k - q.a) / n; P[k] = [q.from[0] + (q.to[0] - q.from[0]) * t, q.from[1] + (q.to[1] - q.from[1]) * t, 1]; }
      w.bridges.push(q.bridge);
      i = q.z;
    }
    // Its points, what of it goes on (the rest is not there: water with no bridge, too near a place) and its length
    const pts = new Float64Array(N * 2), dry = new Uint8Array(N), at = new Float32Array(N);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < N; i++) {
      const p = P[i];
      // (to the 64th of a metre: what is kept and handed over is exactly this)
      p[0] = Math.round(p[0] * 64) / 64; p[1] = Math.round(p[1] * 64) / 64;
      pts[i * 2] = p[0]; pts[i * 2 + 1] = p[1];
      if (i) at[i] = at[i - 1] + hyp(p[0] - P[i - 1][0], p[1] - P[i - 1][1]);
      dry[i] = onDeck(p) || inBounds(p[0], p[1]) || (!wet(p[0], p[1]) && !sites.some(([sx, sy, r]) => hyp(p[0] - sx, p[1] - sy) < r * 0.8)) ? 1 : 0;
      x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    }
    // (dry is of each stretch, from a point to the next: both of them, and what is between, which may be a brook: a ford)
    for (let i = 0; i + 1 < N; i++) { if (!dry[i + 1]) { dry[i] = 0; continue; } if (dry[i]) for (const k of [0.5, 0.25, 0.75]) { const mx = P[i][0] + (P[i + 1][0] - P[i][0]) * k, my = P[i][1] + (P[i + 1][1] - P[i][1]) * k; if (!onDeck([mx, my]) && S.wet(mx, my)) { dry[i] = 0; break; } if (k === 0.5 && far(mx, my)) break; } }
    dry[N - 1] = 0;
    return { id, kind, cart: kind === 'cart', half, a, b, pts, n: N, at, len: at[N - 1], box: [x0, y0, x1, y1], bridges: w.bridges, dry, cut: null, sign: null };
  }
  // A bridge of 5 or 7 tiles over the brook at p (w0), by the points round i of a way: { bridge, a, z: the points it takes, from, to: where it
  // is come onto and left }, or null
  footbridge(P, i, w0) {
    const S = this.sites, a = i - 1, z = i + 2;
    if (a < 2 || z > P.length - 3 || P[a][2] || P[z][2] || P[a - 1][2] || P[z + 1][2]) return null;
    const dx = P[z][0] - P[a][0], dy = P[z][1] - P[a][1], x = Math.abs(dx) >= Math.abs(dy);
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 5) return null;
    const sx = x ? Math.sign(dx) : 0, sy = x ? 0 : Math.sign(dy), cx = Math.floor(w0[0]) + 0.5, cy = Math.floor(w0[1]) + 0.5;
    for (const side of [0, 1, -1, 2, -2]) for (const along of [0, 1, -1, 2, -2]) for (const L of [5, 7]) {
      const bx = cx + sx * along - sy * side, by = cy + sy * along + sx * side, e = L / 2 + 0.3;
      if (!S.wet(bx, by) || (x ? Math.abs(by - (P[a][1] + P[z][1]) / 2) > 4 : Math.abs(bx - (P[a][0] + P[z][0]) / 2) > 4)) continue;
      let ok = true, n = 0;
      for (const m of [e, e + 1, -e, -e - 1]) for (const s of [-1.3, 0, 1.3]) { const px = bx + sx * m - sy * s, py = by + sy * m + sx * s; if (ok && (S.wet(px, py) || Math.max(0, S.height(px, py)) > 0.45)) ok = false; }
      if (!ok) continue;
      for (let m = -Math.floor(L / 2); m <= L / 2; m++) if (S.wet(bx + sx * m, by + sy * m)) n++;
      const r = L / 2 + 1, from = [bx - sx * r, by - sy * r], to = [bx + sx * r, by + sy * r];
      // (and from the road to it and back, dry)
      const dry = (p, q) => { for (const t of [0.25, 0.5, 0.75]) if (S.wet(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)) return false; return true; };
      if (hyp(P[a - 1][0] - from[0], P[a - 1][1] - from[1]) > 11 || hyp(P[z + 1][0] - to[0], P[z + 1][1] - to[1]) > 11 || (P[z + 1][0] - to[0]) * sx + (P[z + 1][1] - to[1]) * sy < -0.5 || (from[0] - P[a - 1][0]) * sx + (from[1] - P[a - 1][1]) * sy < -0.5 || !dry(P[a - 1], from) || !dry(to, P[z + 1])) continue;
      return { bridge: { x: bx, y: by, yaw: x ? Math.PI / 2 : 0, L, w: n }, a, z, from, to };
    }
    return null;
  }
  // The places by a way (not its own two ends): [x, y, room]
  sitesBy(P, a, b) {
    const S = this.sites, out = [], seen = new Set([a.id, b.id, a.key, b.key]), R = 70;
    for (let i = 0; i < P.length; i += 24) for (const tier of ['minor', 'cave', 'major']) for (const s of S.near(wrapX(P[Math.min(P.length - 1, i + 12)][0]), P[Math.min(P.length - 1, i + 12)][1], R, null, tier)) {
      if (seen.has(s.key)) continue;
      seen.add(s.key);
      const x = nearX(s.x, P[i][0]), r = ROOM[s.kind] || 5;
      if (P.some(p => hyp(p[0] - x, p[1] - s.y) < r + 12)) out.push([x, s.y, r]);
    }
    for (const n of this.landmark()) { if (seen.has(n.id)) continue; const x = nearX(n.x, P[0][0]); if (P.some(p => hyp(p[0] - x, p[1] - n.y) < n.r + 12)) out.push([x, n.y, n.r]); }
    return out;
  }

  // ---------- the tracks ----------
  // The track to a place, or null
  track(s) {
    const id = `t${s.key}`, had = lruGet(this.lines, id);
    if (had !== undefined) return had;
    const home = this.unpack(id);
    if (home !== undefined) return home;
    // (what is asked meanwhile may ask for this same one: no)
    this.lines.set(id, null);
    const t0 = globalThis.performance?.now?.() ?? 0, r = this.traceTrack(s, id), ms = (globalThis.performance?.now?.() ?? 0) - t0;
    this.stats.lines++; this.stats.ms += ms; this.stats.worst = Math.max(this.stats.worst, ms);
    return this.keep(id, r);
  }
  traceTrack(s, id) {
    const range = TRACK_RANGE[s.kind], S = this.sites;
    if (!range) return null;
    // The roads that may pass near, the nearest first by their straight line; and of them, the point nearest to it
    const list = [];
    for (const [e, d] of this.edgesBy(s.x, s.y, range)) list.push([Math.max(0, d - 60), e]);
    list.sort((p, q) => p[0] - q[0] || (p[1].id < q[1].id ? -1 : 1));
    let best = null, bd = range;
    for (const [d, e] of list) {
      if (d >= bd) break;
      const r = this.line(e);
      if (!r) continue;
      const sx = nearX(s.x, r.pts[0]);
      for (let i = 0; i < r.n; i++) { const q = hyp(r.pts[i * 2] - sx, r.pts[i * 2 + 1] - s.y); if (q < bd && (r.dry[i] || r.dry[i - 1])) { bd = q; best = [r, i]; } }
    }
    if (!best) return null;
    const [r, i] = best, jx = wrapX(r.pts[i * 2]), jy = r.pts[i * 2 + 1], sx = nearX(s.x, jx);
    // (its door: a tower's, to the side it looks to; the rest, from where one comes)
    const R = DOOR[s.kind], goals = [];
    if (s.kind === 'torre' && s.yaw !== undefined) goals.push([sx + Math.sin(s.yaw) * (R + 4), s.y + Math.cos(s.yaw) * (R + 4)]);
    else { const l = hyp(jx - sx, jy - s.y) || 1, ux = (jx - sx) / l, uy = (jy - s.y) / l; for (const [c, q] of TURNS) goals.push([sx + (ux * c - uy * q) * (R + 4), s.y + (ux * q + uy * c) * (R + 4)]); }
    const at = { id: `${id}:j`, key: '', x: jx, y: jy, kind: 'join' };
    const others = this.nodesNear(jx, jy, range + 120).filter(n => n.r).map(n => [nearX(n.x, jx), n.y, n.kind === 'aldea' ? n.r : n.r + 2, n.kind]);
    const blocked = (x, y) => {
      if (x > BOUNDS.x0 - 8 && x < BOUNDS.x1 + 8 && y > BOUNDS.y0 - 8 && y < BOUNDS.y1 + 3) return true;
      if (hyp(x - sx, y - s.y) < R) return true;
      for (const [ox, oy, q, kind] of others) if (kind === 'aldea' ? Math.abs(x - ox) < q && Math.abs(y - oy) < q : hyp(x - ox, y - oy) < q) return true;
      return false;
    };
    const w = way(S, [[jx, jy]], goals, { ax: jx, ay: jy, bx: sx, by: s.y, wide: TRACK_W, blocked, track: true });
    if (!w) return null;
    // Out from the road where it last leaves it, and up to the door
    const offR = p => { let d = Infinity; for (let k = 0; k + 1 < r.n; k++) { const ax = nearX(r.pts[k * 2], jx); d = Math.min(d, segDist(p[0], p[1], ax, r.pts[k * 2 + 1], ax + r.pts[k * 2 + 2] - r.pts[k * 2], r.pts[k * 2 + 3])); if (d < 2) break; } return d; };
    let k0 = 0;
    for (let k = 1; k < w.pts.length - 1; k++) if (offR(w.pts[k]) < 7) k0 = k;
    if (k0 > 0) {
      const p = w.pts[k0]; let bi = 0, b2 = Infinity;
      for (let k = 0; k < r.n; k++) { const q = hyp(nearX(r.pts[k * 2], jx) - p[0], r.pts[k * 2 + 1] - p[1]); if (q < b2) { b2 = q; bi = k; } }
      w.pts = [[nearX(r.pts[bi * 2], jx), r.pts[bi * 2 + 1], true], ...w.pts.slice(k0 + 1)];
      at.i = bi;
    } else at.i = i;
    if (s.kind !== 'campamento') { const g = w.pts[w.pts.length - 1], d = hyp(sx - g[0], s.y - g[1]), k = Math.max(0, (d - R * 0.8) / d); w.pts.push([g[0] + (sx - g[0]) * k, g[1] + (s.y - g[1]) * k, true]); }
    if (w.pts.length < 3) return null;
    const out = this.make(id, 'track', { id: r.id, key: '', kind: 'join' }, s, w);
    out.parent = r; out.join = at.i;
    return out;
  }
  // The edges whose straight line passes within `reach` + what they may stray of a point: [[edge, how far the line is]…]
  edgesBy(x, y, reach) {
    const out = [], seen = new Set();
    for (const n of this.nodesNear(x, y, MAX_EDGE / 2 + 250 + reach)) for (const e of this.edgesOf(n)) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      const ax = nearX(e.a.x, x), d = segDist(x, y, ax, e.a.y, ax + dxOf(e.b.x, e.a.x), e.b.y);
      if (d <= reach + e.wide) out.push([e, d]);
    }
    return out;
  }

  // ---------- by chunk ----------
  // The roads that touch a chunk (grown by MARGIN), or null
  roadsIn(cx, cy) {
    cx = wrapIndex(cx, CHUNK);
    const k = num(cx, cy), had = lruGet(this.lists, k);
    if (had !== undefined) return had;
    const x = (cx + 0.5) * CHUNK, y = (cy + 0.5) * CHUNK, R = CHUNK * 0.7072 + MARGIN, out = [];
    const take = r => {
      if (!r) return;
      const off = nearX(r.pts[0], x) - r.pts[0], o2 = offsetFor(r, x, off);
      if (r.box[2] + o2 < x - 8 - MARGIN || r.box[0] + o2 > x + 8 + MARGIN || r.box[3] < y - 8 - MARGIN || r.box[1] > y + 8 + MARGIN) return;
      for (let i = 0; i + 1 < r.n; i++) {
        const ax = r.pts[i * 2] + o2, ay = r.pts[i * 2 + 1], bx = r.pts[i * 2 + 2] + o2, by = r.pts[i * 2 + 3];
        if (Math.max(ax, bx) >= x - 8 - MARGIN && Math.min(ax, bx) <= x + 8 + MARGIN && Math.max(ay, by) >= y - 8 - MARGIN && Math.min(ay, by) <= y + 8 + MARGIN) { out.push(r); return; }
      }
    };
    for (const [, make] of this.around(x, y, R)) take(make());
    return lruSet(this.lists, k, out.length ? out : null, 4000);
  }
  // Where a road goes on, stretch by stretch (what is built in this world taken away)
  open(r) {
    if (r.cut) return r.cut;
    const c = (r.cut = r.dry.slice());
    if (this.kept.size) for (let i = 0; i + 1 < r.n; i++) if (c[i] && (this.keptBy(r.pts[i * 2], r.pts[i * 2 + 1], r.half + 2.2) || this.keptBy(r.pts[i * 2 + 2], r.pts[i * 2 + 3], r.half + 2.2))) c[i] = 0;
    return c;
  }
  // Is anything that was built within m of a point?
  keptBy(x, y, m) {
    if (!this.kept.size) return false;
    const x0 = Math.floor((x - m) / 4), x1 = Math.floor((x + m) / 4), y0 = Math.floor((y - m) / 4), y1 = Math.floor((y + m) / 4);
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) if (this.kept.has(`${wrapIndex(i, 4)},${j}`)) { const ex = Math.max(0, i * 4 - x, x - i * 4 - 4), ey = Math.max(0, j * 4 - y, y - j * 4 - 4); if (ex * ex + ey * ey <= m * m) return true; }
    return false;
  }
  // Is there a road in a chunk, or in one by it?
  nearby(cx, cy) { for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (this.roadsIn(cx + i, cy + j)) return true; return false; }
  // The stretches of a chunk (as its own copy of the planet has it): { n, a: Float64Array [ax, ay, bx, by, half, s (metres along)…], roads }
  inChunk(cx, cy) {
    cx = wrapIndex(cx, CHUNK);
    const k = num(cx, cy), had = lruGet(this.cells, k);
    if (had !== undefined) return had;
    const list = this.roadsIn(cx, cy), x = (cx + 0.5) * CHUNK, y = (cy + 0.5) * CHUNK, lim = 8 + MARGIN, a = [], who = [];
    for (const r of list || []) {
      const off = offsetFor(r, x, 0), c = this.open(r);
      for (let i = 0; i + 1 < r.n; i++) {
        if (!c[i]) continue;
        const ax = r.pts[i * 2] + off, ay = r.pts[i * 2 + 1], bx = r.pts[i * 2 + 2] + off, by = r.pts[i * 2 + 3];
        if (Math.max(ax, bx) < x - lim || Math.min(ax, bx) > x + lim || Math.max(ay, by) < y - lim || Math.min(ay, by) > y + lim) continue;
        a.push(ax, ay, bx, by, r.half, r.at[i]); who.push(r);
      }
    }
    return lruSet(this.cells, k, who.length ? { n: who.length, a: Float64Array.from(a), roads: who } : null, 4000);
  }
  // What each tile of a chunk is: Uint8Array(256) (ON | CLEAR | DECK), or null if there is no road
  mask(cx, cy) {
    cx = wrapIndex(cx, CHUNK);
    const k = num(cx, cy), had = lruGet(this.masks, k);
    if (had !== undefined) return had;
    const C = this.inChunk(cx, cy);
    if (!C) return lruSet(this.masks, k, null, 6000);
    const m = new Uint8Array(256), x0 = cx * CHUNK, y0 = cy * CHUNK;
    let any = false;
    for (let s = 0; s < C.n; s++) {
      const q = s * 6, ax = C.a[q], ay = C.a[q + 1], bx = C.a[q + 2], by = C.a[q + 3], h = C.a[q + 4], R = h + 1.9;
      const i0 = Math.max(0, Math.floor(Math.min(ax, bx) - R - x0)), i1 = Math.min(15, Math.floor(Math.max(ax, bx) + R - x0)), j0 = Math.max(0, Math.floor(Math.min(ay, by) - R - y0)), j1 = Math.min(15, Math.floor(Math.max(ay, by) + R - y0));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { if (y0 + j < OUT_Y && inBounds(x0 + i + 0.5, y0 + j + 0.5)) continue; const d = segDist(x0 + i + 0.5, y0 + j + 0.5, ax, ay, bx, by); if (d < R) { m[j * 16 + i] |= d < h + 0.12 ? ON | CLEAR : CLEAR; any = true; } }
    }
    for (const b of this.bridgesIn(cx, cy)) this.deckTiles(b, (x, y) => { const i = x - x0, j = y - y0; if (i >= 0 && j >= 0 && i < 16 && j < 16) { m[j * 16 + i] |= ON | CLEAR | DECK; any = true; } });
    return lruSet(this.masks, k, any ? m : null, 6000);
  }
  deckTiles(b, fn) { const r = Math.floor(b.L / 2); for (let t = -r; t <= r; t++) for (let s = -1; s <= 1; s++) b.yaw ? fn(Math.floor(b.x) + t, Math.floor(b.y) + s) : fn(Math.floor(b.x) + s, Math.floor(b.y) + t); }
  bits(tx, ty) { const m = this.mask(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK)); return m ? m[(((ty % 16) + 16) % 16) * 16 + (((tx % 16) + 16) % 16)] : 0; }
  onRoad(tx, ty) { return (this.bits(tx, ty) & ON) !== 0; }
  // The nearest centreline within MARGIN of (x, y) (this.hit, reused), or null. side: to the left (-) or the right (+) of it, going along
  near(x, y) {
    const C = this.inChunk(Math.floor(x / CHUNK), Math.floor(y / CHUNK));
    return C ? this.nearIn(C, wrapX(x), y) : null;
  }
  // …of the stretches of its chunk (x wrapped)
  nearIn(C, px, y) {
    const H = this.hit;
    H.d = MARGIN; H.road = null;
    for (let s = 0; s < C.n; s++) {
      const q = s * 6, ax = C.a[q], ay = C.a[q + 1], dx = C.a[q + 2] - ax, dy = C.a[q + 3] - ay, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (y - ay) * dy) / l)) : 0, ex = px - ax - t * dx, ey = y - ay - t * dy, d = hyp(ex, ey);
      if (d < H.d) { H.d = d; H.side = Math.sign(dx * ey - dy * ex) * d; H.half = C.a[q + 4]; H.cart = C.roads[s].cart; H.s = C.a[q + 5] + Math.sqrt(l) * t; H.road = C.roads[s]; }
    }
    return H.road ? H : null;
  }
  // The timber bridges whose middle is in a chunk grown by a bridge's length: [{ key, x, y, yaw, L }]
  bridgesIn(cx, cy) {
    const out = [], x = (wrapIndex(cx, CHUNK) + 0.5) * CHUNK, y = (cy + 0.5) * CHUNK;
    for (const r of this.roadsIn(cx, cy) || []) {
      if (!r.bridges.length) continue;
      const off = offsetFor(r, x, 0);
      for (const b of r.bridges) {
        const bx = b.x + off;
        if (Math.abs(bx - x) > 8 + 7 || Math.abs(b.y - y) > 8 + 7 || this.keptBy(bx, b.y, b.L / 2 + 2)) continue;
        out.push({ key: `${Math.floor(wrapX(bx))},${Math.floor(b.y)}`, x: bx, y: b.y, yaw: b.yaw, L: b.L });
      }
    }
    // (two roads over the same brook, side by side: one bridge, the same one whichever chunk asks)
    return out.length < 2 ? out : out.sort((p, q) => p.x - q.x || p.y - q.y || p.L - q.L).filter((b, i) => !out.slice(0, i).some(q => Math.abs(q.x - b.x) < 4 && Math.abs(q.y - b.y) < 4));
  }

  // ---------- the signposts ----------
  // Those of a chunk: [{ x, y, arms: [{ yaw, to: key of a place (or 'home'), m: metres }], node? }]. A hamlet's stands in its square already (arms
  // only: postOf)
  postsIn(cx, cy) {
    cx = wrapIndex(cx, CHUNK);
    const out = [], x = (cx + 0.5) * CHUNK, y = (cy + 0.5) * CHUNK, mine = p => p && Math.floor(p.x / CHUNK) === cx && Math.floor(p.y / CHUNK) === cy;
    // (a post may stand just over the edge of the chunk its road is in)
    const seen = new Set(), all = new Set();
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) for (const r of this.roadsIn(cx + i, cy + j) || []) all.add(r);
    for (const r of all) {
      for (const n of [r.a, r.b]) if (n.kind === 'home' && !seen.has(n.id)) { seen.add(n.id); const p = this.homePost(); if (mine(p)) out.push(p); }
      if (!r.cart && r.parent && TRACK_RANGE[r.b.kind] > 200 && !seen.has(r.id)) { seen.add(r.id); const p = this.trackPost(r); if (mine(p)) out.push(p); }
      for (const n of [r.a, r.b]) if (n.kind === 'hito' && n.hito !== 'roble' && n.hito !== 'puente' && !seen.has(n.id)) { seen.add(n.id); const p = this.nodePost(n); if (mine(p)) out.push(p); }
    }
    return out.filter(p => { const tx = Math.floor(p.x), ty = Math.floor(p.y); return hyp(dxOf(p.x, x), p.y - y) < 40 && !this.keptBy(p.x, p.y, 2) && !this.sites.wet(p.x, p.y) && !this.sites.wet(tx + 0.5, ty + 0.5); });
  }
  // The arms of a node's roads: { yaw, to, m }, the nearest first
  armsOf(n) {
    const out = [];
    for (const e of this.edgesOf(n)) {
      const r = this.line(e);
      if (!r || !this.whole(r, n)) continue;
      const first = r.a.id === n.id, far = first ? r.b : r.a, k = Math.min(17, r.n >> 1), i = first ? k : r.n - 1 - k, j = first ? 0 : r.n - 1;
      // (to where the road is some 60 m on: several may leave by the same street)
      out.push({ yaw: Math.atan2(r.pts[i * 2] - r.pts[j * 2], r.pts[i * 2 + 1] - r.pts[j * 2 + 1]), to: far.id, m: r.len, dx: r.pts[j * 2], dy: r.pts[j * 2 + 1] });
    }
    return out.sort((p, q) => p.m - q.m);
  }
  // (a road that is cut in the first stretch out of a node is no way for a sign to point to)
  whole(r, n) { const c = this.open(r), first = r.a.id === n.id; for (let k = 2; k < Math.min(8, r.n - 1); k++) if (!c[first ? k : r.n - 2 - k]) return false; return true; }
  // The post at the village's way out, by the road
  homePost() { if (this.home0) return this.home0; const arms = this.armsOf(HOME); return (this.home0 = arms.length ? { x: 18.5, y: 63.5, arms: arms.slice(0, 4) } : null); }
  nodePost(n) {
    if (n.post !== undefined) return n.post;
    const arms = this.armsOf(n);
    if (!arms.length) return (n.post = null);
    const p = n.ports.reduce((q, c) => (hyp(c[0] - arms[0].dx, c[1] - arms[0].dy) < hyp(q[0] - arms[0].dx, q[1] - arms[0].dy) ? c : q));
    return (n.post = { x: Math.floor(p[0] + p[2] * 1.5 - p[3] * 2.4) + 0.5, y: Math.floor(p[1] + p[3] * 1.5 + p[2] * 2.4) + 0.5, arms: arms.slice(0, 4) });
  }
  // The arms of a hamlet's post (its square's) or of the council oak's: null if no road comes
  postOf(key) {
    const n = this.landmark().find(q => q.id === key) || this.nodes.get(key);
    if (!n) { const [cx, cy] = key.split(',').map(Number), s = this.sites.at(cx, cy); if (s?.kind !== 'aldea') return null; return this.armsOf(this.hamletNode(s)); }
    return this.armsOf(n);
  }
  // Where a track leaves its road
  trackPost(r) {
    if (r.sign !== null) return r.sign || null;
    const p = r.parent, i = Math.max(1, Math.min(p.n - 2, r.join)), jx = r.pts[0], jy = r.pts[1], off = nearX(p.pts[i * 2], jx) - p.pts[i * 2];
    const dx = p.pts[i * 2 + 2] - p.pts[i * 2 - 2], dy = p.pts[i * 2 + 3] - p.pts[i * 2 - 1], l = hyp(dx, dy) || 1, k = Math.min(r.n - 1, 3), tx = r.pts[k * 2] - jx, ty = r.pts[k * 2 + 1] - jy;
    // (on the side the track leaves by, just past it)
    const side = Math.sign(-dy * tx + dx * ty) || 1, nx = -dy / l * side, ny = dx / l * side, along = Math.sign(tx * dx + ty * dy) || 1;
    const x = Math.floor(jx + nx * (p.half + 1.1) - dx / l * along * 2.4) + 0.5, y = Math.floor(jy + ny * (p.half + 1.1) - dy / l * along * 2.4) + 0.5;
    void off;
    const arms = [{ yaw: Math.atan2(tx, ty), to: r.b.key, m: r.len }, { yaw: Math.atan2(dx, dy), to: p.b.id, m: p.len - p.at[i] }, { yaw: Math.atan2(-dx, -dy), to: p.a.id, m: p.at[i] }];
    return (r.sign = { x: wrapX(x), y, arms }) || null;
  }

  // ---------- for the maps ----------
  // The lines that touch a box [x0, y0, x1, y1] (x0 < x1, not wrapped): [{ kind, pts: Float64Array, off (what to add to its x), open, bridges }]
  // known: only what is worked out already
  mapSegments([x0, y0, x1, y1], known = false) {
    const out = new Map(), n = Math.max(1, Math.ceil((x1 - x0) / 480)), m = Math.max(1, Math.ceil((y1 - y0) / 480)), sx = (x1 - x0) / n, sy = (y1 - y0) / m, R = hyp(sx, sy) / 2;
    const add = r => { if (!r) return; const off = nearX((r.box[0] + r.box[2]) / 2, (x0 + x1) / 2) - (r.box[0] + r.box[2]) / 2; if (r.box[2] + off >= x0 && r.box[0] + off <= x1 && r.box[3] >= y0 && r.box[1] <= y1) out.set(r.id, { id: r.id, kind: r.kind, pts: r.pts, n: r.n, off, open: this.open(r), bridges: r.bridges, box: r.box }); };
    if (known) { for (const r of this.lines.values()) add(r); return [...out.values()]; }
    for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) {
      const x = wrapX(x0 + (i + 0.5) * sx), y = y0 + (j + 0.5) * sy;
      for (const [, make] of this.around(x, y, R)) add(make());
    }
    return [...out.values()];
  }
  // In the idle time: works out one thing of what is within r of (x, y) that is not yet: true if there was something to do. lines false:
  // only the graph (the lines come from the ground worker: pack and adopt)
  warm(x, y, r, lines = true) {
    const R = r + CHUNK;
    if (this.sites.warm(x, y, r + GRAPH_R, ['hamlet'])) return true;
    for (const n of this.nodesNear(x, y, MAX_EDGE / 2 + 250 + R)) if (!this.links.has(n.id)) { this.edgesOf(n); return true; }
    if (!lines) return false;
    for (const [id, make, ends] of this.around(x, y, R)) if (!this.lines.has(id)) {
      for (const n of ends || []) if (n.kind === 'aldea' && !n.ports) { this.portsOf(n); return true; }
      make(); return true;
    }
    return false;
  }
  // The lines within R of a point: [[id, how to make it, its ends]…]. tracks false: of the roads alone
  around(x, y, R, tracks = true) {
    const out = [];
    for (const [e] of this.edgesBy(x, y, R)) out.push([e.id, () => this.line(e), [e.a, e.b]]);
    if (!tracks) return out;
    for (const s of this.sites.near(x, y, R + TRACK_MAX + TRACK_W, GREAT, 'major')) if (hyp(dxOf(s.x, x), s.y - y) < TRACK_RANGE[s.kind] + TRACK_W + R) out.push([`t${s.key}`, () => this.track(s), null]);
    for (const s of this.sites.near(x, y, R + TRACK_RANGE.campamento + TRACK_W, ['campamento'], 'minor')) out.push([`t${s.key}`, () => this.track(s), null]);
    return out;
  }
  // What is known of the lines within r of a point, as plain data, without those of `have` (a Set of ids, which gets them): for another
  // thread to have them. Nothing is worked out
  pack(x, y, r, have) {
    const out = [], R = r + CHUNK, put = (id, q) => {
      if (have.has(id)) return;
      have.add(id);
      if (!q) { out.push([id, null]); return; }
      if (q.parent) put(q.parent.id, q.parent);
      out.push([id, { kind: q.kind, pts: q.pts, dry: q.dry, at: q.at, box: q.box, bridges: q.bridges, join: q.join, parent: q.parent?.id, to: q.cart ? null : { key: q.b.key, kind: q.b.kind, x: q.b.x, y: q.b.y } }]);
    };
    for (const [id, q] of [...this.lines]) {
      if (have.has(id)) continue;
      // (that there is no way between two nodes is told with whatever else is told)
      if (!q) { put(id, q); continue; }
      const off = offsetFor(q, x);
      if (q.box[0] + off < x + R && q.box[2] + off > x - R && q.box[1] < y + R && q.box[3] > y - R) put(id, q);
    }
    return out;
  }
  // …and the hamlets round it, cell by cell, which the graph is made of (sites.js)
  packCells(x, y, r) { const out = []; this.sites.eachCell('hamlet', x, y, r + GRAPH_R, (ix, iy) => { const v = this.sites.cells.get(`hamlet:${ix},${iy}`); if (v !== undefined) out.push([`hamlet:${ix},${iy}`, v]); }); return out; }
  // …and here they come: the same as they would be worked out here
  adopt(list, cells = null) {
    for (const [k, v] of cells || []) if (!this.sites.cells.has(k)) this.sites.cells.set(k, v);
    for (const [id, q] of list) {
      if (this.lines.has(id)) continue;
      if (!q) { this.keep(id, null); continue; }
      const parent = q.parent ? this.lines.get(q.parent) : null;
      if (q.parent && !parent) continue;
      const [ia, ib] = id.split('>'), a = q.parent ? { id: q.parent, key: '', kind: 'join' } : this.node(ia), b = q.parent ? { ...q.to, id: q.to.key } : this.node(ib);
      if (!a || !b) continue;
      const n = q.dry.length;
      this.keep(id, { id, kind: q.kind, cart: q.kind === 'cart', half: q.kind === 'cart' ? CART : TRACK, a, b, pts: q.pts, n, at: q.at, len: q.at[n - 1], box: q.box, bridges: q.bridges, dry: q.dry, cut: null, sign: null, ...(parent ? { parent, join: q.join } : null) });
    }
  }
  node(id) {
    if (id === HOME.id) return HOME;
    const l = this.landmark().find(n => n.id === id);
    if (l) return l;
    const [cx, cy] = id.split(',').map(Number), c = SITE_TIERS.hamlet.cell, s = this.sites.inCell('hamlet', Math.floor(cx / c), Math.floor(cy / c));
    return s && s.key === id ? this.hamletNode(s) : null;
  }
}
// What to add to the x of a road's points so that it passes by x
function offsetFor(r, x) { const m = (r.box[0] + r.box[2]) / 2; return nearX(m, x) - m; }

const made = new Map();
// The roads of a seed (one for all who ask in this thread)
export function roadsFor(seed) { let r = made.get(seed | 0); if (!r) { r = new Roads(seed); made.set(seed | 0, r); } return r; }
// What a worker has to know of the roads of a generator (what is kept clear of them), or null: it has none
export const roadList = gen => (gen?.roads ? gen.roads.keptList : null);
