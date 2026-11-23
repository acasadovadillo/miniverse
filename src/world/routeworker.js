// The route worker (Plan J §2.2, §2.5): the A* of the marked route, off the main thread. Created by route.js on the
// first route.set as a module worker (new URL('./world/routeworker.js?v=<version>', import.meta.url), { type: 'module' }),
// terminated after 60 s without a request; never on the world server. It owns one WorldGen(WORLD_SEED) (like
// genworker.js), an LRU of 600 chunk records (routegrid.js chunkRecord, about 600 bytes each), a cache of coarse chunk
// costs and the override masks the main thread sends. The search runs in slices of about 8 ms, so a newer request is
// read between two slices and the older one is dropped.
//
// Main thread → worker:
//   { t: 'init', seed, projects, family }        as genworker.js: the world seed and the village projects
//   { t: 'village', projects, family }           on onVillageChange (village.js): drop the cached records and masks of
//        the village
//   { t: 'route', id, from: { x, y }, to: { x, y }, mode: 'walk' | 'ride' | 'row', explored: ['cx,cy', …], margin?, wide?, debug? }
//        from/to in tiles, fractions allowed (the path ends exactly there); to.x already nearX'd to from.x. explored: the
//        explored keys (own form, wrapIndex) in the bounding box of from and to plus `wide` chunks (or `margin`): the
//        search never leaves the box of `margin` chunks (default 2); when nothing reaches the pin there it is tried once
//        more in the box of `wide` chunks (default: no second try). A chunk not listed is unexplored (flat cost, nothing
//        read there). A newer id supersedes every older one (older searches are dropped, never answered). debug: answer
//        `seen` too (?ruta=ver)
//   { t: 'masks', id, seq?, done?, masks: [[key, v, Uint8Array(256) | null], …] }   the answer to 'need' (seq: the need's),
//        in one or more messages (done false: more follow; omitted or true: the last): per chunk its mask (routegrid.js
//        chunkMask) and v, the version it was built from (the chunk delta's d.v, -1 without a delta). null: that chunk has
//        no mask (the untouched world). A chunk left out keeps what the worker holds (send nothing for a chunk whose v
//        equals the `have` it was asked with)
// Worker → main thread:
//   { t: 'need', id, seq, chunks: ['cx,cy', …], have: [v | null, …] }   the explored chunks of the corridor of search id
//        and, for each, the v of the mask the worker holds (null: none). The main thread answers with 'masks' for the
//        same id and seq (only chunks that need one, maskWanted, get a mask; for the rest it may answer [key, v, null] or
//        nothing). The search waits for the last message at most MASK_WAIT ms, then goes on with what it has (partial)
//   { t: 'path', id, ok, pts: Float32Array, kinds: Uint8Array, len, expanded, ms, why, partial?, cut?, seen? }
//        pts/kinds transferred; at most LIMITS.maxPts + 1 points, string-pulled, from `from` to `to` exactly; ok false =
//        the straight fallback (why: 'far' over LIMITS.maxTiles, 'budget' node budget spent, 'nopath' nothing reaches the
//        pin, 'error'). partial: the masks were not all there when it searched. cut: the pin sits inside something
//        impassable (deep water riding, a cave, a building): the path goes to the nearest open tile and its last segment,
//        to the pin, is KIND.unknown (a gap). seen (debug only): Int32Array [x0,y0,…] of the tiles expanded, at most 20000
import { WorldGen, WORLD_SEED, CHUNK } from './gen.js';
import { setProjects, setFamilyHouse, BOUNDS } from './village.js';
import { NORTH, SOUTH, wrapIndex } from './planet.js';
import { chunkRecord, chunkCost, combine, Search, pathOf, straightPath, KIND, LIMITS, UNKNOWN_COST, COST, MODES } from './routegrid.js';

const RECORDS = 600, COARSE = 20000, MASKS = 4000;   // (cache sizes, in chunks)
const SLICE_MS = 8, STEP = 256;                      // (one slice of the search, and how many nodes between two clock reads)
const MASK_WAIT = 3000;                              // (ms the search waits for the main thread's masks)
const COARSE_BUDGET = 40000, RING = 1, RING_RETRY = 3;   // (the chunk graph: its node budget and the corridor's width around its path)
const GOAL_R = 24, GOAL_R_COARSE = 3;                // (a pin inside something impassable: the nearest open tile / chunk this far)
// (nothing reaches the pin: the way to the nearest tile reached, if it is this near (tiles), in the first box (a pocket
// round the pin, such as a cave's mouth: no wider search) and in the last one)
const CUT_NEAR = 8, CUT_FAR = 24;
const UNKNOWN = Math.round(UNKNOWN_COST * 10), BLOCK = 255;
const UNKNOWN_GRID = { cost: new Uint8Array(256).fill(UNKNOWN), kind: new Uint8Array(256).fill(KIND.unknown) };
const CY0 = Math.floor(NORTH / CHUNK), CY1 = Math.floor((SOUTH - 1) / CHUNK);

let gen = new WorldGen(WORLD_SEED);
const records = new Map();   // own chunk number (num) → chunkRecord
const coarse = new Map();    // own chunk number → Uint8Array(3), chunkCost for the three MODES
const masks = new Map();     // 'cx,cy' → { v, mask: Uint8Array(256) | null }
let job = null;              // (the one search in progress)

// (a chunk as a number: own form for the caches, unwrapped for one search's corridor)
const num = (cx, cy) => (cx + 16384) * 8192 + (cy + 4096);
const lru = (map, k, max, make) => {
  let v = map.get(k);
  if (v !== undefined) { map.delete(k); map.set(k, v); return v; }
  v = make();
  map.set(k, v);
  if (map.size > max) map.delete(map.keys().next().value);
  return v;
};
const record = (cx, cy) => lru(records, num(cx, cy), RECORDS, () => chunkRecord(gen, cx, cy));
const coarseOf = (cx, cy) => lru(coarse, num(cx, cy), COARSE, () => { const c = new Uint8Array(3); chunkCost(gen, cx, cy, 'walk', c); return c; });

onmessage = e => {
  const m = e.data;
  if (!m) return;
  try {
    if (m.t === 'init') {
      setProjects(m.projects); setFamilyHouse(m.family);
      if ((m.seed | 0) !== gen.seed && Number.isFinite(m.seed)) { gen = new WorldGen(m.seed); records.clear(); coarse.clear(); }
      dropVillage();
    } else if (m.t === 'village') { setProjects(m.projects); setFamilyHouse(m.family); gen.fields.clear(); dropVillage(); }
    else if (m.t === 'masks') gotMasks(m);
    else if (m.t === 'route') start(m);
  } catch (err) {
    console.warn('Route (worker): a message failed', err);
    if (m.t === 'route' && job?.id === m.id) fail(job, 'error');
  }
};

// What the village changes (its paths with the projects, the family house) is in the records and the masks of its chunks
function dropVillage() {
  const cx0 = Math.floor(BOUNDS.x0 / CHUNK), cx1 = Math.floor(BOUNDS.x1 / CHUNK), cy0 = Math.floor(BOUNDS.y0 / CHUNK), cy1 = Math.floor(BOUNDS.y1 / CHUNK);
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) { records.delete(num(cx, cy)); coarse.delete(num(cx, cy)); masks.delete(`${cx},${cy}`); }
}

function start(m) {
  const t0 = performance.now();
  const ok = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
  if (!ok(m.from) || !ok(m.to)) return;   // (nothing to answer: route.js never sends these)
  const from = { x: +m.from.x, y: +m.from.y }, to = { x: +m.to.x, y: +m.to.y };
  const j = job = {
    id: m.id, from, to, t0, mode: MODES.includes(m.mode) ? m.mode : 'walk',
    explored: new Set(Array.isArray(m.explored) ? m.explored : []),
    seen: m.debug ? [] : null, grids: new Map(), corridor: null, search: null, phase: '', wait: 0, ring: RING, retried: false,
    fcx: Math.floor(from.x / CHUNK), fcy: Math.floor(from.y / CHUNK), tcx: Math.floor(to.x / CHUNK), tcy: Math.floor(to.y / CHUNK),
    seq: 0, partial: false, wide: false, goal: to, cut: false, cgoal: null,
  };
  j.dist = Math.hypot(to.x - from.x, to.y - from.y);
  if (j.dist > LIMITS.maxTiles) return fail(j, 'far');
  const mg = v => Math.max(0, Math.min(64, v | 0));
  j.margin = mg(Number.isFinite(m.margin) ? m.margin : 2);
  j.wideMargin = Number.isFinite(m.wide) ? Math.max(j.margin, mg(m.wide)) : j.margin;
  begin(j, j.margin);
}
// One try in the box of `margin` chunks round from and to (the first, and the wider one when nothing reached the pin)
function begin(j, margin) {
  j.box = { cx0: Math.min(j.fcx, j.tcx) - margin, cx1: Math.max(j.fcx, j.tcx) + margin, cy0: Math.max(CY0, Math.min(j.fcy, j.tcy) - margin), cy1: Math.min(CY1, Math.max(j.fcy, j.tcy) + margin) };
  j.grids.clear(); j.corridor = null; j.coarseCells = null; j.retried = false; j.cgoal = null; j.memo = -1; j.memoGrid = null;
  if (j.dist <= LIMITS.short) askMasks(j);
  else {
    // A long route: first the chunk graph, to know which corridor the fine search may use (a goal chunk shut in by
    // impassable chunks, deep water riding, moves to the nearest open one)
    j.phase = 'coarse';
    const cost = (cx, cy) => coarseCost(j, cx, cy);
    const q = enclosed(cost, j.tcx, j.tcy) ? nearestOpen(cost, j.tcx, j.tcy, GOAL_R_COARSE) : null;
    if (q) j.cgoal = q;
    j.search = new Search(cost, { x: j.fcx, y: j.fcy }, { x: q ? q[0] : j.tcx, y: q ? q[1] : j.tcy }, { budget: COARSE_BUDGET, hmin: COST.road * 10 });
    pump(j);
  }
}
// Nothing reached the pin in the first box: once more in the wide one, if there is one
function widen(j) {
  if (j.wide || j.wideMargin <= j.margin) return false;
  j.wide = true;
  begin(j, j.wideMargin);
  return true;
}
// (is cell (x, y) blocked with all eight neighbours blocked too?)
function enclosed(cost, x, y) {
  if (cost(x, y) < BLOCK) return false;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && cost(x + dx, y + dy) < BLOCK) return false;
  return true;
}
// The open cell nearest (x, y) within r cells (ring by ring; the nearest of the first ring that has one), or null
function nearestOpen(cost, x, y, r) {
  for (let k = 1; k <= r; k++) {
    let best = null, bd = Infinity;
    for (let dy = -k; dy <= k; dy++) {
      const edge = dy === -k || dy === k;
      for (let dx = -k; dx <= k; dx += edge ? 1 : 2 * k) {
        if (cost(x + dx, y + dy) >= BLOCK) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = [x + dx, y + dy]; }
      }
    }
    if (best) return best;
  }
  return null;
}

// The cost of crossing one chunk (× 10 per tile) in the coarse graph: unexplored chunks are flat like their tiles
function coarseCost(j, cx, cy) {
  const b = j.box;
  if (cx < b.cx0 || cx > b.cx1 || cy < b.cy0 || cy > b.cy1) return BLOCK;
  const own = wrapIndex(cx, CHUNK);
  if (!j.explored.has(`${own},${cy}`)) return UNKNOWN;
  return coarseOf(own, cy)[j.mode === 'ride' ? 1 : j.mode === 'row' ? 2 : 0];
}

// The coarse path, widened by `ring` chunks all round, is the corridor of the fine search
function corridorOf(j, cells, ring) {
  const out = new Set();
  for (let i = 0; i < cells.length; i += 2) {
    for (let dy = -ring; dy <= ring; dy++) for (let dx = -ring; dx <= ring; dx++) out.add(num(cells[i] + dx, cells[i + 1] + dy));
  }
  return out;
}

// Ask the main thread for the masks of the explored chunks the fine search may enter
function askMasks(j) {
  const keys = [], have = [], b = j.box, seen = new Set();
  const add = (cx, cy) => {
    if (cy < b.cy0 || cy > b.cy1) return;
    const k = `${wrapIndex(cx, CHUNK)},${cy}`;
    if (seen.has(k) || !j.explored.has(k)) return;
    seen.add(k); keys.push(k);
    const h = masks.get(k);
    have.push(h ? h.v : null);
  };
  if (j.corridor) for (const n of j.corridor) add(Math.floor(n / 8192) - 16384, (n % 8192) - 4096);
  else for (let cy = b.cy0; cy <= b.cy1; cy++) for (let cx = b.cx0; cx <= b.cx1; cx++) add(cx, cy);
  j.phase = 'masks';
  if (!keys.length) return fine(j);
  const seq = ++j.seq;
  postMessage({ t: 'need', id: j.id, seq, chunks: keys, have });
  j.wait = setTimeout(() => { if (job === j && j.phase === 'masks' && j.seq === seq) { j.partial = true; fine(j); } }, MASK_WAIT);
}
function gotMasks(m) {
  if (Array.isArray(m.masks)) for (const e of m.masks) {
    if (!Array.isArray(e) || typeof e[0] !== 'string') continue;
    const mask = e[2] instanceof Uint8Array && e[2].length === 256 ? e[2] : null;
    masks.delete(e[0]);
    masks.set(e[0], { v: Number.isFinite(e[1]) ? e[1] : -1, mask });
    if (masks.size > MASKS) masks.delete(masks.keys().next().value);
  }
  // (an answer that comes after MASK_WAIT is kept for the next search: the one running keeps the grids it has; a part
  // that is not the last only fills the cache)
  const j = job;
  if (m.done === false || !j || j.id !== m.id || j.phase !== 'masks' || (m.seq !== undefined && m.seq !== j.seq)) return;
  clearTimeout(j.wait); fine(j);
}

// The fine search over tiles
function fine(j) {
  j.phase = 'fine';
  j.memo = -1; j.memoGrid = null;
  const cost = (x, y) => tileCost(j, x, y);
  j.cost = cost;
  // (a pin shut in by impassable tiles, deep water riding or the middle of a cave or a house: the search goes to the
  // nearest open tile, and the last stretch to the pin is a gap. One blocked tile alone, a tree or a wall, stays the goal)
  const gx = Math.floor(j.to.x), gy = Math.floor(j.to.y);
  j.goal = j.to; j.cut = false;
  if (enclosed(cost, gx, gy)) {
    let q = nearestOpen(cost, gx, gy, GOAL_R);
    if (!q && j.cgoal) {   // (the coarse graph moved the goal to another chunk: from its tile nearest the pin)
      const c = j.cgoal, x = Math.max(c[0] * CHUNK, Math.min(c[0] * CHUNK + CHUNK - 1, gx)), y = Math.max(c[1] * CHUNK, Math.min(c[1] * CHUNK + CHUNK - 1, gy));
      q = cost(x, y) < BLOCK ? [x, y] : nearestOpen(cost, x, y, GOAL_R);
    }
    if (q) { j.goal = { x: q[0] + 0.5, y: q[1] + 0.5 }; j.cut = true; }
  }
  j.search = new Search(cost, j.from, j.goal, { budget: LIMITS.budget, weight: LIMITS.weight, seen: j.seen });
  pump(j);
}
// The grid of one chunk for this search (unwrapped cx): null outside the box or the corridor (blocked); the flat one
// for unexplored chunks; else the record with its mask, for the search's mode
function gridFor(j, cx, cy) {
  const n = num(cx, cy);
  let g = j.grids.get(n);
  if (g !== undefined) return g;
  const b = j.box, ends = (cx === j.fcx && cy === j.fcy) || (cx === j.tcx && cy === j.tcy) || (j.cgoal && cx === j.cgoal[0] && cy === j.cgoal[1]);
  if (!ends && (cx < b.cx0 || cx > b.cx1 || cy < b.cy0 || cy > b.cy1 || (j.corridor && !j.corridor.has(n)))) g = null;
  else {
    const own = wrapIndex(cx, CHUNK), key = `${own},${cy}`;
    if (!j.explored.has(key)) g = UNKNOWN_GRID;
    else {
      const kind = new Uint8Array(256);
      g = { key, kind, cost: combine(record(own, cy), masks.get(key)?.mask || null, j.mode, new Uint8Array(256), kind) };
    }
  }
  j.grids.set(n, g);
  return g;
}
function tileCost(j, x, y) {
  if (y < NORTH || y >= SOUTH) return BLOCK;   // (no route crosses a pole)
  const cx = x >> 4, cy = y >> 4, n = num(cx, cy);
  if (n !== j.memo) { j.memo = n; j.memoGrid = gridFor(j, cx, cy); }
  const g = j.memoGrid;
  return g ? g.cost[((y & 15) << 4) | (x & 15)] : BLOCK;
}
function tileKind(j, x, y) {
  const g = y < NORTH || y >= SOUTH ? null : gridFor(j, x >> 4, y >> 4);
  return g ? g.kind[((y & 15) << 4) | (x & 15)] : KIND.unknown;
}

// Run the current phase in slices, answering when it is over (and dropping it if a newer search came meanwhile)
function pump(j) {
  setTimeout(() => {
    if (job !== j) return;
    try {
      const end = performance.now() + SLICE_MS;
      let done = false;
      while (!(done = j.search.step(STEP)) && performance.now() < end);
      if (!done) return pump(j);
      const s = j.search;
      if (j.phase === 'coarse') {
        if (!s.ok) { if (s.why === 'nopath' && widen(j)) return; return fail(j, s.why); }
        j.coarseCells = s.cells;
        j.corridor = corridorOf(j, s.cells, j.ring);
        return askMasks(j);
      }
      if (s.ok) return answer(j, found(j, s.cells, j.goal));
      // (a pin in a pocket nothing enters, a cave's mouth or a pen: the way to the nearest tile reached, and a gap)
      const last = j.wide || j.wideMargin <= j.margin;
      if (s.why === 'nopath' && s.bestH <= (last ? CUT_FAR : CUT_NEAR) && (!j.corridor || j.retried)) {
        const cells = s.partial();
        if (cells && cells.length >= 2) { j.cut = true; return answer(j, found(j, cells, { x: cells[cells.length - 2] + 0.5, y: cells[cells.length - 1] + 0.5 })); }
      }
      // (a corridor too narrow for a detour: once more, three chunks wide all round)
      if (s.why === 'nopath' && j.corridor && !j.retried) {
        j.retried = true; j.grids.clear();
        j.corridor = corridorOf(j, j.coarseCells, RING_RETRY);
        return askMasks(j);
      }
      if (s.why === 'nopath' && widen(j)) return;
      fail(j, s.why);
    } catch (err) {
      console.warn('Route (worker): the search failed', err);
      fail(j, 'error');
    }
  }, 0);
}

// The answer of a way found to goal (the pin, or the open tile nearest it); when it is not the pin (j.cut), the gap from
// there to the pin itself, as one KIND.unknown point
function found(j, cells, goal) {
  const r = pathOf(cells, j.cost, j.from, goal, { kindAt: (x, y) => tileKind(j, x, y), maxPts: LIMITS.maxPts }, j.search.expanded);
  if (j.cut) {
    const n = r.pts.length >> 1, pts = new Float32Array(n * 2 + 2), kinds = new Uint8Array(n + 1);
    pts.set(r.pts); kinds.set(r.kinds);
    pts[n * 2] = j.to.x; pts[n * 2 + 1] = j.to.y; kinds[n] = KIND.unknown;
    r.len += Math.hypot(j.to.x - pts[n * 2 - 2], j.to.y - pts[n * 2 - 1]);
    r.pts = pts; r.kinds = kinds;
  }
  return r;
}
function fail(j, why) { answer(j, straightPath(j.from, j.to, j.search?.expanded || 0, why)); }
function answer(j, r) {
  if (job !== j) return;
  job = null;
  const msg = { t: 'path', id: j.id, ok: r.ok, pts: r.pts, kinds: r.kinds, len: r.len, expanded: r.expanded, ms: performance.now() - j.t0, why: r.why, partial: j.partial, cut: !!(r.ok && j.cut) };
  const list = [r.pts.buffer, r.kinds.buffer];
  if (j.seen) { msg.seen = Int32Array.from(j.seen); list.push(msg.seen.buffer); }
  postMessage(msg, list);
}
