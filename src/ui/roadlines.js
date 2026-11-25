// The roads on the maps (docs/planes/realismo/PLAN-R7-mundo.md §3.7; world/roads.js, mapSegments): their lines, where the land is explored,
// over its pictures (which show them too, but thin: at the wide zooms they would not be seen). On the minimap (ui/minimap.js), on the big
// map (ui/map.js) and, as ribbons on the relief, on the one in 3D (three/map3d.js).
//   lines.flat(g, gen, box, t)   strokes those of box [x0, y0, x1, y1]; t(off): sets the canvas to tiles, off added to their x
//   lines.runs(gen, box)         the same as points: [{ cart, pts: [x, y, …], off }]
//   lines.warm(gen, x, y, w, h)  (the big map, open) asks the ground worker for the lines of what is explored in sight, a piece at a time
// Nothing is worked out here in the game's thread: what is not known yet comes from the ground worker (Roads.adopt).
import { CHUNK } from '../world/gen.js';
import { wrapIndex, wrapX } from '../world/planet.js';

export const ROAD_COL = 'rgba(226, 212, 182, .62)', ROAD_EDGE = 'rgba(52, 42, 30, .34)', CART_W = 2.2, TRACK_W = 1.1;
const NONE = new Set();
const CELL = 640, REACH = 420;      // (the pieces it asks for, in tiles, and how far round their middle)

export class RoadLines {
  constructor(game, terrain = () => null) {
    this.game = game; this.terrain = terrain;
    this.made = new WeakMap();      // a road's points → { n: what was explored, open, path, runs }
    this.asked = new Set(); this.flying = false; this.of = null; this.oldV = -1;
    this.cells = new Set(); this.cellsN = 0; this.cellsOf = null;
  }
  get explored() { return this.game()?.explored || NONE; }
  // Goes up when there is something else to draw
  version(gen) { const R = gen?.roads; return R ? `${R.linesV}.${R.keptV}` : ''; }
  seen(gen, box) { const R = gen?.roads; return R ? R.mapSegments(box, true) : []; }
  // The explored stretches of a road: [[x, y, x, y…]…]
  of1(q) {
    const E = this.explored, had = this.made.get(q.pts);
    if (had && had.n === E.size && had.open === q.open && had.E === E) return had;
    const runs = [];
    let run = null, k = '', yes = false;
    for (let i = 0; i < q.n; i++) {
      const x = q.pts[i * 2], y = q.pts[i * 2 + 1], cx = wrapIndex(Math.floor(wrapX(x) / CHUNK), CHUNK), cy = Math.floor(y / CHUNK), kk = `${cx},${cy}`;
      if (kk !== k) { k = kk; yes = E.has(kk); }
      if (!yes) { run = null; continue; }
      if (!run) runs.push((run = [x, y])); else run.push(x, y);
      if (!q.open[i]) run = null;
    }
    const out = { n: E.size, E, open: q.open, runs: runs.filter(r => r.length > 2), path: null };
    this.made.set(q.pts, out);
    return out;
  }
  flat(g, gen, box, t, a) {
    const px = 1 / a;
    g.lineJoin = g.lineCap = 'round';
    const list = this.seen(gen, box).map(q => [q, this.of1(q)]).filter(p => p[1].runs.length);
    for (const edge of [true, false]) for (const [q, m] of list) {
      if (!m.path) { const P = (m.path = new Path2D()); for (const r of m.runs) { P.moveTo(r[0], r[1]); for (let i = 2; i < r.length; i += 2) P.lineTo(r[i], r[i + 1]); } }
      const cart = q.kind === 'cart', w = cart ? Math.max(CART_W, 1.7 * px) : Math.max(TRACK_W, 1.1 * px);
      if (edge && !cart) continue;
      t(q.off);
      g.lineWidth = edge ? w + 1.6 * px : w;
      g.strokeStyle = edge ? ROAD_EDGE : ROAD_COL;
      if (!cart) g.setLineDash([5 * px, 3.5 * px]);
      g.stroke(m.path);
      if (!cart) g.setLineDash([]);
    }
  }
  runs(gen, box) { const out = []; for (const q of this.seen(gen, box)) for (const r of this.of1(q).runs) out.push({ cart: q.kind === 'cart', pts: r, off: q.off }); return out; }

  // ---------- asking ----------
  warm(gen, x, y, w, h) {
    const R = gen?.roads, T = this.terrain();
    if (this.of !== R) { this.of = R; this.asked.clear(); this.flying = false; }
    if (!R || this.flying || !T?.workers?.length || T.gen !== gen) return;
    this.grow();
    let best = null, bd = Infinity;
    for (let cy = Math.floor((y - h / 2) / CELL); cy <= Math.floor((y + h / 2) / CELL); cy++) for (let cx = Math.floor((x - w / 2) / CELL); cx <= Math.floor((x + w / 2) / CELL); cx++) {
      const kx = wrapIndex(cx, CELL), k = `${kx},${cy}`;
      if (this.asked.has(k) || !this.cells.has(k)) continue;
      const d = Math.hypot((cx + 0.5) * CELL - x, (cy + 0.5) * CELL - y);
      if (d < bd) { bd = d; best = [k, (kx + 0.5) * CELL, (cy + 0.5) * CELL]; }
    }
    if (!best) return;
    const [k, mx, my] = best;
    this.asked.add(k);
    this.flying = !!T.askMap('lines', gen, Math.floor(mx / CHUNK), Math.floor(my / CHUNK), 500, { x: mx, y: my, r: REACH, have: [...R.lines.keys()] }, m => { this.flying = false; if (gen.roads === R && m?.list) R.adopt(m.list, m.cells); else this.asked.delete(k); });
  }
  // The pieces with anything explored (what was explored since the last time)
  grow() {
    const E = this.explored;
    if (this.cellsOf !== E || E.size < this.cellsN) { this.cellsOf = E; this.cells.clear(); this.cellsN = 0; }
    if (E.size === this.cellsN) return;
    let i = 0;
    for (const key of E) { if (i++ < this.cellsN) continue; const c = key.indexOf(','), cx = +key.slice(0, c), cy = +key.slice(c + 1); this.cells.add(`${wrapIndex(Math.floor(cx * CHUNK / CELL), CELL)},${Math.floor(cy * CHUNK / CELL)}`); }
    this.cellsN = E.size;
  }
}
