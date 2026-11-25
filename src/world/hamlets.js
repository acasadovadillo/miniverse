// What the places of the world are laid out like (docs/planes/realismo/PLAN-R7-mundo.md §3.6; R7-3): the hamlets by what they live
// on, the camps, the temples, the beached boats and the singular landmarks. Pure, without Three: the same for the same site on every
// computer. What it gives, in the world's own coordinates (a Plan):
//   { placed, floor, roof: { 'x,y': piece }, props: [{ m: model, x, y, yaw, z }], nature: [{ kind, x, y, k }], crops: [[x, y, id, stage]],
//     decks: [{ kind, x, y, yaw, L }] (what one walks on over the water: deckHeight), lvl: what its pieces stand at (or null: the
//     ground made flat at 0), box: [x0, y0, x1, y1], homes: [{ x, y, w, h, roof, wall, door: [x, y], empty }], work: [[x, y, yaw]]
//     (where its people work), trader: [x, y], boats: [[x, y, yaw]], chest: [x, y, yaw], mine: [x, y] }
// Everything in it can be built by the players: pieces (pieces.js), or the things of B › Outside (buildables.js); the rest is land.
import { ihash } from '../util.js';
import { B } from './biomes.js';
import { HOMES, STYLES, homeBlueprint, shedBlueprint, hutBlueprint, templeBlueprint, TEMPLES, sanctuaryBlueprint, turnBlueprint } from './blueprints.js';

export const SPECIALTIES = ['fishing', 'shepherds', 'woodcutters', 'miners', 'farmers'];
export const HALF = 24;          // a hamlet is all within this of its middle (so that it reaches the chunks next to its own, no more)
const LOW = 2.4;                 // no house on ground higher than this (it stands at 0)
const DRY = { fishing: 'south', shepherds: 'north', woodcutters: 'woods', miners: 'north', farmers: 'meadow' };
// Of what it is built: by the land it stands in, and by its trade
export const styleOf = (specialty, biome) => (specialty === 'fishing' ? (biome === B.PINES ? 'north' : 'south') : specialty === 'farmers' && biome === B.FOREST ? 'woods' : specialty === 'miners' || biome === B.PINES ? 'north' : DRY[specialty] || 'meadow');

// ---------- turning ----------
// A point (tiles and quarter turns q: the south front to the east, the north, the west) about the middle
const turnP = (x, y, q) => (q === 1 ? [y, -x] : q === 2 ? [-x, -y] : q === 3 ? [-y, x] : [x, y]);
const turnT = (x, y, q) => (q === 1 ? [y, -x - 1] : q === 2 ? [-x - 1, -y - 1] : q === 3 ? [-y - 1, x] : [x, y]);

// A plan while it is laid out, in parts: each goes in whole or not at all (a house in the water does not)
class Plan {
  constructor() { this.parts = []; this.trader = [0.5, 1.5]; this.chest = null; this.mine = null; this.boats = []; }
  part(kind, o) { this.parts.push({ kind, placed: {}, floor: {}, roof: {}, props: [], crops: [], nature: [], work: [], decks: [], ...o }); return this.parts[this.parts.length - 1]; }
  add(bp, o = {}) { this.part('piece', { ...bp, ...o }); return this; }
  // A home whose front (q: 0 south, 1 east, 2 north, 3 west) is there: (x, y) its corner
  home(kind, style, x, y, q = 0) {
    const { w, h } = HOMES[kind], H = h + (kind === 'porched' ? 2 : 0), S = STYLES[style] || STYLES.meadow, bp = turnBlueprint(homeBlueprint(kind, style), q, x, y, [w, H]);
    const door = Object.keys(bp.placed).find(k => bp.placed[k].startsWith('puerta')).split(',').map(Number), out = [[0, 1], [1, 0], [0, -1], [-1, 0]][q];
    this.part('home', { ...bp, home: { x, y, w: q & 1 ? H : w, h: q & 1 ? w : H, roof: S.roof, wall: S.wall, door: [door[0] + 0.5 + out[0] * 1.2, door[1] + 0.5 + out[1] * 1.2] }, kindOf: kind, style, bp: [kind, style, q] });
    return this;
  }
  // Gravel, from (x0, y0) to (x1, y1): tile by tile
  path(x0, y0, x1, y1, id = 'camino') { const p = this.parts.find(q => q.kind === 'path') || this.part('path'); for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) p.floor[`${x},${y}`] ||= id; return this; }
  put(m, x, y, yaw = 0, o = {}) { this.part('prop', { props: [{ m, x, y, yaw, z: o.z || 0 }], ...o }); return this; }
  // A thing of the game that is placed (a well, an oven): it works
  set(id, x, y) { this.part('thing', { placed: { [`${x},${y}`]: id } }); return this; }
  work(x, y, yaw) { (this.parts.find(q => q.kind === 'path') || this.part('path')).work.push([x, y, yaw]); return this; }
  // A pen of fence round a rectangle, with its gates
  pen(x0, y0, x1, y1, id, gates = [], gate = 'puerta_valla', o = {}) {
    const placed = {};
    for (let x = x0; x <= x1; x++) placed[`${x},${y0}`] = placed[`${x},${y1}`] = id;
    for (let y = y0; y <= y1; y++) placed[`${x0},${y}`] = placed[`${x1},${y}`] = id;
    for (const [x, y] of gates) placed[`${x},${y}`] = gate;
    this.part('piece', { placed, ...o }); return this;
  }
  field(x0, y0, x1, y1, id, stage = 3) { const crops = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) crops.push([x, y, id, stage]); this.part('field', { crops }); return this; }
  deck(kind, x, y, yaw, L) { this.part('deck', { decks: [{ kind, x, y, yaw, L }], props: [{ m: `${kind}:${L}`, x, y, yaw, z: 0 }], wet: true }); return this; }
}
// The tiles a part takes (those that must be dry and low)
function tilesOf(p) {
  if (p.ts) return p.ts;
  const out = (p.ts = []);
  for (const l of ['placed', 'floor', 'roof']) for (const k of Object.keys(p[l])) out.push(k.split(',').map(Number));
  for (const [x, y] of p.crops) out.push([x, y]);
  for (const o of p.props) { const r = p.r ?? 1; for (const [i, j] of [[0, 0], [-r, 0], [r, 0], [0, -r], [0, r]]) out.push([Math.floor(o.x + i), Math.floor(o.y + j)]); }
  return out;
}
// Laid on the land at the tile (cx, cy), turned q: the parts that fit. land: { wet(x, y), height(x, y) } or null (all fits);
// exact: tile by tile (if not, a few of them: to compare the four turns)
function lay(P, cx, cy, q, land, exact = true) {
  const out = { placed: {}, floor: {}, roof: {}, props: [], nature: [], crops: [], decks: [], work: [], homes: [], boats: [], box: [Infinity, Infinity, -Infinity, -Infinity], q, score: 0, lvl: null };
  const grow = (x0, y0, x1, y1) => { const b = out.box; b[0] = Math.min(b[0], x0); b[1] = Math.min(b[1], y0); b[2] = Math.max(b[2], x1); b[3] = Math.max(b[3], y1); };
  const T = (x, y) => { const [a, b] = turnT(x, y, q); return [a + cx, b + cy]; }, Pt = (x, y) => { const [a, b] = turnP(x, y, q); return [a + cx, b + cy]; };
  const ok = (x, y) => { const [a, b] = T(x, y); return !land.wet(a + 0.5, b + 0.5) && land.height(a + 0.5, b + 0.5) < LOW; };
  // (the gravel goes last: under nothing)
  for (const p of [...P.parts.filter(o => o.kind !== 'path'), ...P.parts.filter(o => o.kind === 'path')]) {
    if (land && p.kind !== 'path' && !p.wet) {
      const ts = tilesOf(p), n = exact ? ts.length : Math.min(ts.length, 14), step = Math.max(1, Math.floor(ts.length / n));
      let fits = true;
      for (let i = 0; i < ts.length && fits; i += step) fits = ok(...ts[i]);
      if (!fits) continue;
    }
    out.score += p.kind === 'home' ? 12 : p.kind === 'piece' ? 4 : p.kind === 'path' ? 0 : 1;
    if (p.home) {
      const o = p.home, a = turnT(o.x, o.y, q), b = turnT(o.x + o.w - 1, o.y + o.h - 1, q);
      out.homes.push({ x: Math.min(a[0], b[0]) + cx, y: Math.min(a[1], b[1]) + cy, w: Math.abs(a[0] - b[0]) + 1, h: Math.abs(a[1] - b[1]) + 1, roof: o.roof, wall: o.wall, door: Pt(...o.door) });
    }
    if (!exact) continue;
    for (const l of ['placed', 'floor', 'roof']) for (const [k, id] of Object.entries(p[l])) {
      const [x, y] = k.split(',').map(Number), i = id.indexOf('@'); let [a, b] = T(x, y); const base = i < 0 ? id : id.slice(0, i), rot = i < 0 ? 0 : +id.slice(i + 1);
      if (id === 'big_well') { const [c, d] = T(x + 1, y + 1); a = Math.min(a, c); b = Math.min(b, d); }   // (its anchor has the lowest of its four tiles)
      if (p.kind === 'path' && land && !ok(x, y)) continue;
      if (l === 'floor' && out.floor[`${a},${b}`]) continue;
      out[l][`${a},${b}`] = l === 'placed' && (i >= 0 || TURNS.has(base)) && (rot + q) % 4 ? `${base}@${(rot + q) % 4}` : base;
      grow(a, b, a + 1, b + 1);
    }
    for (const o of p.props) { const [x, y] = Pt(o.x, o.y); out.props.push({ m: o.m, x, y, yaw: o.yaw + (q * Math.PI) / 2, z: o.z }); if (!p.wet) grow(x - 1, y - 1, x + 1, y + 1); }
    for (const o of p.nature) { const [x, y] = Pt(o.x, o.y); out.nature.push({ ...o, x, y }); }
    for (const [x, y, id, s] of p.crops) { const [a, b] = T(x, y); out.crops.push([a, b, id, s]); grow(a, b, a + 1, b + 1); }
    for (const d of p.decks) { const [x, y] = Pt(d.x, d.y); out.decks.push({ ...d, x, y, yaw: d.yaw + (q * Math.PI) / 2 }); }
    for (const [x, y, a] of p.work) { const [wx, wy] = Pt(x, y); if (!land || (!land.wet(wx, wy) && land.height(wx, wy) < LOW)) out.work.push([wx, wy, a + (q * Math.PI) / 2]); }
  }
  if (!exact) return out;
  out.trader = Pt(...P.trader);
  out.boats = P.boats.map(([x, y, a]) => [...Pt(x, y), a + (q * Math.PI) / 2]);
  if (P.chest) { const [x, y] = Pt(P.chest[0], P.chest[1]); out.chest = [x, y, (P.chest[2] || 0) + (q * Math.PI) / 2]; }
  if (P.mine) out.mine = Pt(...P.mine);
  return out;
}
const TURNS = new Set(['cama', 'chimenea', 'estanteria', 'mesa', 'comoda', 'maceta', 'lampara', 'barril', 'alfombra', 'silla', 'horno', 'yunque']);

// ---------- what one walks on over the water ----------
// The height of a deck (a jetty, a bridge) at (x, y), or null if it is not on it. Along it, z from -L / 2 to L / 2 (the bridge) or
// from -0.5 to L - 0.4 (the jetty, its near end first): three/places3d.js draws them with these
export const JETTY_Y = 0.2, BRIDGE_W = 1.62, TIMBER_W = 1.42;
// (a timber bridge: flat, with a short ramp at each end; its lengths)
export const TIMBER_L = [5, 7, 9, 11];
export const timberY = (z, L) => { const e = L / 2 - Math.abs(z); return e >= 1 ? 0.36 : 0.06 + 0.3 * Math.max(0, e); };
export const bridgeY = (z, L) => 0.1 + (L > 11 ? 0.75 : 1.0) * Math.max(0, Math.cos((z / (L / 2)) * Math.PI / 2)) ** 0.9;
export function deckHeight(d, x, y) {
  const dx = x - d.x, dy = y - d.y, s = Math.sin(d.yaw), c = Math.cos(d.yaw), z = dx * s + dy * c, u = dx * c - dy * s;
  if (d.kind === 'jetty') return Math.abs(u) <= 0.97 && z >= -0.55 && z <= d.L - 0.36 ? JETTY_Y : null;
  if (d.kind === 'timber_bridge') return Math.abs(u) <= TIMBER_W + 0.02 && Math.abs(z) <= d.L / 2 ? timberY(z, d.L) : null;
  return Math.abs(u) <= BRIDGE_W + 0.02 && Math.abs(z) <= d.L / 2 ? bridgeY(z, d.L) : null;
}
export function deckBox(d) { const r = d.kind === 'jetty' ? d.L : d.L / 2 + 1; return [d.x - r, d.y - r, d.x + r, d.y + r]; }
// What stops one on it: the bridge's parapets and, at their ends, their posts
export function deckColliders(d) {
  if (d.kind === 'jetty') return [];
  const wood = d.kind === 'timber_bridge', out = [], s = Math.sin(d.yaw), c = Math.cos(d.yaw), W = wood ? TIMBER_W : BRIDGE_W - 0.15, e = wood ? d.L / 2 - 0.9 : d.L / 2;   // (a timber bridge's rails do not reach the ends of its ramps)
  for (const k of [-1, 1]) for (let z = -e; z <= e + 1e-6; z += wood ? 0.3 : 0.4) out.push({ x: d.x + z * s + k * W * c, y: d.y + z * c - k * W * s, r: wood ? 0.12 : 0.24, deck: true });
  return out;
}

// ---------- the hamlets: their road along x, the square in the middle ----------
function square(P, { big = false, X = 22 } = {}) {
  P.path(-X, -1, X, 0).path(-4, -4, 4, 3);
  if (big) P.set('big_well', -1, -4); else P.set('pozo', -2, -3);
  P.put('signpost:90-270-200', 3.6, -1.9).put('stone_bench', -2.2, 2.9, Math.PI);
  P.trader = [1.5, 1.8];
}
// (the gardens: the light crops of the cold season, some 600 triangles a plant: three/wintercrops.js)
const GARDEN = ['potato', 'cabbage', 'broad_bean', 'garlic'];
const HAMLET = {
  // (by the water, which is to the south, from y = shore on)
  fishing(P, S, { shore = 15 }) {
    square(P, { X: 21 });
    P.home('small', S, -19, -14).home('porched', S, -5, -14).home('long', S, 7, -12);
    if (shore >= 13) P.home('cottage', S, -15, 3, 2);
    P.path(-13, -4, -12, -2).path(0, -5, 0, -5).path(14, -4, 14, -2);
    P.path(-1, 4, 0, shore - 1);
    P.deck('jetty', 0, shore - 0.5, 0, 8);
    for (const [x, y, a] of [[-6.5, shore - 3.2, 0.2], [-10, shore - 2.8, -0.15], [5.5, shore - 3.4, 0.1]]) P.put('net_rack', x, y, a);
    P.put('fish_rack', 9.5, shore - 3.2, 0.05).put('fish_rack', 12.6, shore - 3.3, -0.1);
    P.put('beached:up:1', -4.4, shore - 1.6, 0.3, { r: 0.5 }).put('beached:up:2', 4.2, shore - 1.4, -0.35, { r: 0.5 }).put('beached:trestle:1', 8.2, shore - 6.2, 1.2);
    P.put('barril', 1.6, shore - 1.9).put('barril', 2.3, shore - 2.5, 0.5).put('firewood', -17.5, 1.9).put('stone_trough', 6.2, 3.2).put('log', 11, 2, 0.3).put('stone_bench', 12.5, 4.2, Math.PI).put('signpost:180', 3.8, shore - 4);
    P.work(-6.5, shore - 2.1, Math.PI).work(9.5, shore - 2.1, Math.PI).work(6.8, shore - 5, 1);
    P.boats = [[1.75, shore + 4, 0.05], [-1.75, shore + 5.2, 3.1]];
  },
  shepherds(P, S) {
    square(P, { X: 18 });
    P.home('small', S, -17, -14).home('cottage', S, -2, -14).home('long', S, -18, 4, 2);
    P.path(-11, -4, -11, -2).path(2, -6, 2, -5);
    // The fold, with its hay barn and its trough, the rick outside
    P.pen(8, -13, 21, -4, 'valla_piedra', [[13, -4], [14, -4]]);
    P.add(turnBlueprint(shedBlueprint('north', 8, 4), 0, 13, -12, [8, 4]));
    P.put('hay_pile', 15.3, -10.4).put('hay_pile', 18.6, -10.2, 1.2).put('stone_trough', 10.2, -10.5, Math.PI / 2).put('comedero', 10.5, -6);
    P.path(13, -3, 14, -2);
    P.put('hayrick', 5, 8).put('hayrick', 9.3, 9.2, 1).put('firewood', -6.6, -5.4).put('hide_rack:goat', 13.5, 4.5, 0.5).put('chop_block', -3.2, -5).put('spring:trough', -6.5, 9.5, Math.PI * 0.85, { r: 2 });
    P.pen(13, 7, 20, 12, 'valla', [[13, 9]]);
    P.work(11.5, -8, -1.5).work(13.2, 5.8, Math.PI).work(6.8, 6.6, 0.4);
  },
  woodcutters(P, S) {
    square(P, { X: 18 });
    P.home('small', S, -17, -14).home('porched', S, 4, -13).home('porched', S, -16, 3, 2);
    P.path(-11, -4, -11, -2).path(8, -2, 8, -2).path(-12, 1, -12, 2);
    // The yard: the saw, the logs that come in and the boards that go out
    P.add(turnBlueprint(shedBlueprint('woods', 9, 5), 2, 5, 12, [9, 5]));
    P.put('plank_stack', 7.2, 14.7).put('plank_stack', 9.5, 14.8).put('plank_stack', 11.7, 14.6, 0.05);
    P.put('sawpit', 9, 7, 0.06).put('log_pile:3', 14.5, 4.2, 1.5).put('log_pile:2', 14.2, 7.4, 1.65).put('log_pile:3', 15.8, 10.4, 1.5).put('log', 5.6, 8.6, 0.7).put('log', 5.2, 7.9, 0.5).put('chop_block', 3.4, 11.2).put('firewood', -0.5, -11.5).put('firewood', -8.4, -5.2, Math.PI / 2 + 0.02);
    // The burners', off to one side
    P.put('charcoal_clamp:lit', -7.5, 16.5, 0, { r: 1.6 }).put('charcoal_heap', -3.6, 18).put('log_pile:2', -11, 17.4, 0.3).put('tent:grey:open', -8.5, 12.2, 0.25).put('campfire:laid', -5.6, 13.4);
    P.work(9.5, 8.6, Math.PI).work(3.4, 12.3, Math.PI).work(-5.4, 16, -1.6);
  },
  miners(P, S) {
    square(P, { X: 20 });
    P.home('cottage', S, -18, -12).home('cottage', S, -8, -12).home('long', S, -18, 4, 2).home('cottage', S, 11, 4, 2);
    P.path(-14, -4, -14, -2).path(-4, -4, -4, -4);
    // The mine at the foot of the slope, its rails, the tips; the smithy
    P.put('mine_mouth', 9.5, -15.5, 0, { r: 2.5 });
    for (let y = -13.5; y < -5; y++) P.put('rail', 9.5, y, 0, { r: 0 });
    P.put('ore_cart:full', 9.5, -10.2).put('ore_cart:empty', 9.5, -6.1).put('spoil_heap', 14.6, -8.6, 0.4).put('spoil_heap', 5, -11.5, 1.4).put('log_pile:2', 14.5, -13.2, 1.3).put('signpost:180', 6.6, -5.4);
    P.add(turnBlueprint(shedBlueprint('north', 8, 5), 2, 0, 5, [8, 5]));
    P.set('horno@2', 1, 8).set('yunque', 3, 6);
    P.put('barril', 6.3, 8.4).put('charcoal_heap', 5.8, 7.0, 0.5);
    P.path(9, -4, 10, -2).path(3, 1, 4, 4);
    P.put('firewood', -7.4, 4.6, Math.PI / 2).put('stone_trough', 9.3, 5.4, Math.PI / 2);
    P.work(8, -9.6, 1.6).work(3.6, 5.2, 0).work(12.6, -8, 1.2);
    P.mine = [9.5, -14.6];
  },
  farmers(P, S, { salt = 0 } = {}) {
    square(P, { big: true, X: 22 });
    P.home('long', S, -19, -12).home('small', S, 7, -14).home('porched', S, -17, 3, 2).home('cottage', S, 8, 4, 2);
    P.path(-12, -4, -12, -2).path(13, -4, 13, -2);
    const g = i => GARDEN[(i + salt) % GARDEN.length];
    P.pen(-17, 15, -8, 20, 'valla', [[-13, 15]]).field(-16, 16, -14, 18, g(0)).field(-11, 16, -9, 18, g(1));
    P.pen(-3, 12, 5, 17, 'valla', [[1, 12]]).field(-2, 13, 0, 14, g(2)).field(2, 16, 4, 16, g(3)).field(-2, 16, -1, 16, g(0), 2);
    P.add(turnBlueprint(shedBlueprint('meadow', 10, 5), 0, 10, 16, [10, 5]));
    P.put('hay_pile', 12.5, 17.8).put('hay_pile', 16.2, 17.6, 1).put('wheelbarrow', 15, 21.4, 0.6).put('hayrick', 21.4, 10.6).put('hayrick', 8, 13.6, 2).put('firewood', -4.8, -8, Math.PI / 2).put('stone_trough', 8.6, 22.2).put('colmena', -20.6, 1.8, 2.6).put('colmena', -19.3, 2.3, 2.9).put('barril', 5.8, -5.2);
    P.work(-13, 13.8, 0).work(1, 10.8, 0).work(14, 21.6, 2.8);
  },
};
// How far the water is to the south of the middle, along the middle of the turned plan, or 0: where the jetty would start
function shoreOf(cx, cy, q, land) {
  const wet = (x, y) => { const [a, b] = turnP(x, y, q); return land.wet(a + cx, b + cy); };
  for (let y = 5; y <= 15; y++) {
    if (!wet(0, y + 0.5)) continue;
    if (y < 9) return 0;
    for (const [i, j] of [[0, 2], [0, 3.5], [0, 5], [0, 6.5], [-1.5, 4], [1.5, 4]]) if (!wet(i, y + j)) return 0;
    return y;
  }
  return 0;
}
// What a hamlet lives on and how it is laid, always the same for the same site. land: { wet(x, y), height(x, y) } of the world itself;
// mine: is there one near (world/sites.js)? scattered: the houses' old spots ([x, y] from the middle), for where none of the four turns
// has room for two houses
export function hamletPlan(p, land, { mine = false, scattered = [] } = {}) {
  const cx = Math.floor(p.x), cy = Math.floor(p.y), salt = Math.floor(ihash(p.id, 31, 7177) * 4);
  // (the land, every three tiles: the four turns are compared on it; the one chosen, tile by tile)
  const N = 17, G = 3, high = new Float32Array(N * N), probe = land.probe || ((x, y) => (land.wet(x, y) ? -1 : land.height(x, y)));
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) high[j * N + i] = probe(cx - HALF + i * G + 0.5, cy - HALF + j * G + 0.5);
  const at = (x, y) => { const i = Math.max(0, Math.min(N - 1, Math.round((x - 0.5 - cx + HALF) / G))), j = Math.max(0, Math.min(N - 1, Math.round((y - 0.5 - cy + HALF) / G))); return j * N + i; };
  const rough = { wet: (x, y) => high[at(x, y)] < 0, height: (x, y) => high[at(x, y)] }, wets = new Map();
  // (tile by tile: the water as it is in the world, each asked once; the height, as above)
  const exact = { wet: (x, y) => { const k = Math.floor(x) * 100003 + Math.floor(y); let v = wets.get(k); if (v === undefined) wets.set(k, (v = land.wet(x, y))); return v; }, height: rough.height };
  let best = null, bs = -1;
  const made = new Map(), plan = (sp, o) => { const k = sp + (o.shore || ''); let P = made.get(k); if (!P) { P = new Plan(); HAMLET[sp](P, styleOf(sp, p.biome), { salt, ...o }); made.set(k, P); } return P; };
  const take = (sp, q, o, bonus) => { const P = plan(sp, o); const L = lay(P, cx, cy, q, rough, false), s = L.homes.length < 2 ? -1 : L.score + bonus + ihash(p.id, 40 + q, 7177); if (s > bs) { bs = s; best = { sp, q, P }; } };
  for (let q = 0; q < 4; q++) { const shore = shoreOf(cx, cy, q, land); if (shore) take('fishing', q, { shore }, 30); }
  if (!best) {
    const r = ihash(p.id, 30, 7177);
    const sp = mine ? 'miners' : p.biome === B.PINES ? 'shepherds' : p.biome === B.FOREST ? (r < 0.75 ? 'woodcutters' : 'farmers') : r < 0.65 ? 'farmers' : r < 0.85 ? 'shepherds' : 'woodcutters';
    for (let q = 0; q < 4; q++) take(sp, q, {}, 0);
    if (!best) best = { sp, q: 0, P: null };
  }
  let L = best.P && lay(best.P, cx, cy, best.q, exact);
  if (!L || L.homes.length < 2) {
    const P = new Plan(), S = styleOf(best.sp, p.biome);
    P.path(-4, -4, 4, 3); P.set('pozo', -2, -3); P.trader = [1.5, 1.8];
    for (const [x, y] of scattered) P.home('small', S, x, y, 0);
    P.put('signpost:90-270-200', 3.6, -1.9).put('stone_bench', -2.2, 2.9, Math.PI).put('firewood', 0, 4.8).work(0.5, 4, 0);
    L = lay(P, cx, cy, 0, { wet: land.wet, height: () => 0 });
  }
  L.specialty = best.sp;
  L.style = styleOf(best.sp, p.biome);
  // (one house in five is empty: nothing in it, and it can be taken apart; never all of them)
  L.homes.forEach((h, i) => {
    h.empty = i > 0 && ihash(p.id, 50 + i, 7177) < 0.2;
    if (!h.empty) return;
    for (let y = h.y; y < h.y + h.h; y++) for (let x = h.x; x < h.x + h.w; x++) { const k = `${x},${y}`, v = L.placed[k]; if (v && TURNS.has(v.split('@')[0]) || v === 'candelabro') delete L.placed[k]; }
  });
  L.mine = L.specialty === 'miners' && L.props.some(o => o.m === 'mine_mouth') ? L.mine : null;
  return L;
}
// The same, of a trade one asks for, with nothing in its way (the test pages)
export function hamletLayout(sp, { land = null, shore = 14 } = {}) { const P = new Plan(); HAMLET[sp](P, land || DRY[sp], { shore }); return lay(P, 0, 0, 0, null); }

// ---------- the camps ----------
// Whose a camp is: fishers by the water, hunters and charcoal burners in the woods, shepherds in the open
export function campOf(p) {
  const r = ihash(p.id, 32, 7177);
  return p.biome === B.FOREST ? (r < 0.5 ? 'hunters' : r < 0.85 ? 'burners' : 'fishers') : p.biome === B.PINES ? (r < 0.5 ? 'hunters' : 'shepherds') : r < 0.6 ? 'shepherds' : 'fishers';
}
// state: kept (the tent open, the fire laid) or empty (cold and shut)
export function campLayout(by, state = 'kept', snow = false) {
  const P = new Plan(), kept = state !== 'empty', fire = kept ? 'laid' : 'cold', mouth = kept ? 'open' : 'shut', sn = snow ? ':snow' : '', pot = kept ? ':pot' : '';
  P.chest = [-3.2, -2.6, 0.5];
  if (by === 'shepherds') { P.put(`tent:raw:${mouth}${sn}`, -1.4, -1.2, 0.5).put(`campfire:${fire}${pot}`, 1.2, 1.4).put('log', 2.5, 1.0, 1.4).put('log', 1.6, 2.7, 0.15); P.pen(4, -4, 7, -1, 'valla', [[5, -1]]); P.put('firewood' + (snow ? ':snow' : ''), -4, 0.8, 0.6); }
  else if (by === 'hunters') { P.put(`tent:green:${mouth}${sn}`, -1.6, -1.0, 0.35).put(`campfire:${fire}`, 1.0, 1.5).put('log', 2.3, 1.2, 1.2).put('hide_rack:deer', 3.0, -1.6, -0.5).put('hide_rack:boar', -4.4, 1.2, 0.9).put('chop_block', 0.2, 3.2); }
  else if (by === 'fishers') { P.put(`tent:grey:${mouth}${sn}`, -1.8, -1.0, 0.3).put(`campfire:${fire}${pot}`, 0.8, 1.5).put('log', 2.1, 1.9, 1.1).put('net_rack', 2.8, -1.4, -0.4).put('fish_rack', -4.4, 1.6, 0.7).put('beached:up:3', 4.6, 2.4, 0.6); }
  else { P.put(`tent:rust:${mouth}${sn}`, -2.6, -1.4, 0.5).put(`campfire:${fire}`, -0.6, 1.6).put('log', 0.6, 2.4, 0.4).put('charcoal_clamp:cold', 3.4, -1.0, 0, { r: 1.5 }).put('charcoal_heap', 2.4, 2.6).put('log_pile:3' + sn, -3.6, 2.6, 0.5); P.chest = [-4.6, -2.6, 0.5]; }
  return P;
}
export const campPlan = (p, state) => lay(campLayout(campOf(p), state, p.snow), Math.floor(p.x), Math.floor(p.y), 0, null);

// ---------- the beached boats ----------
const POSES = ['side', 'keel', 'buried'];
export function wreckPlan(p) {
  const P = new Plan(), n = 1 + Math.floor(ihash(p.id, 33, 7177) * 3), r = k => ihash(p.id, 34 + k, 7177);
  const AT = [[0.5, 0.5], [-3.0, 1.4], [3.8, -0.6]];
  for (let i = 0; i < n; i++) P.put(`beached:${POSES[Math.floor(r(i) * 3)]}:${1 + Math.floor(r(i + 4) * 4)}${p.snow ? ':snow' : ''}`, AT[i][0], AT[i][1], r(i + 8) * 6.28);
  P.chest = [0.5, 2.9, 0.3];
  return lay(P, Math.floor(p.x), Math.floor(p.y), 0, null);
}

// ---------- the temples ----------
// The columns a temple has: 4, 6 or 8, the most its ground has room for. wet(x, y)
export function templeColumns(p, wet) {
  const want = [4, 6, 8][Math.floor(ihash(p.id, 35, 7177) * 3)], cx = Math.floor(p.x), cy = Math.floor(p.y);
  for (const c of [8, 6, 4]) {
    if (c > want) continue;
    const { w, h } = TEMPLES[c], x0 = cx - (w >> 1) - 1, y0 = cy - (h >> 1) - 1, x1 = x0 + w + 2, y1 = y0 + h + 3;
    let dry = true;
    for (let i = 0; i <= 4 && dry; i++) for (let j = 0; j <= 4; j++) if (wet(x0 + (x1 - x0) * i / 4, y0 + (y1 - y0) * j / 4)) { dry = false; break; }
    if (dry) return c;
  }
  return 4;
}
export const PODIUM = 0.3;
export function templeLayout(columns = 4, { state = 'empty' } = {}) {
  const P = new Plan(), { w, h, porch } = TEMPLES[columns], x0 = -(w >> 1), y0 = -(h >> 1);
  P.add(turnBlueprint(templeBlueprint(columns), 0, x0, y0, [w, h]));
  const hatch = [0.5, y0 + (h - porch) / 2 - 0.3];
  P.put('crypt_hatch', ...hatch);
  const fy = y0 + h - porch + 0.2;
  for (const s of [-1, 1]) P.put(`brazier:${state === 'kept' ? 'lit' : 'cold'}`, 0.5 + s * (w > 8 ? 2.6 : 1.5), fy);
  P.chest = [...hatch, 0];   // (where one goes down)
  return P;
}
export function templePlan(p, wet) { const c = templeColumns(p, wet), L = lay(templeLayout(c), Math.floor(p.x), Math.floor(p.y), 0, null); L.columns = c; L.lvl = (p.z || 0) + PODIUM; L.hatch = L.chest; L.chest = null; return L; }

// ---------- the lighthouses ----------
export const liveryOf = p => { const r = ihash(p.id, 36, 7177); return p.biome === B.SNOW || p.biome === B.ICE || p.biome === B.PINES ? 'black' : p.biome === B.ROCKY || r < 0.2 ? 'stone' : r < 0.35 ? 'black' : 'red'; };
// The keeper's cottage, beside a lighthouse where somebody lives, where the ground lets it (nearly level, dry), or null: the same
// height for all of it
export function keeperPlan(p, land) {
  const cx = Math.floor(p.x), cy = Math.floor(p.y), S = liveryOf(p) === 'red' ? 'south' : 'north';
  for (const [x, y, q] of [[4, -4, 0], [-12, -4, 0], [-4, -13, 0], [4, 1, 0], [-12, 1, 0], [-4, 5, 2]]) {
    let lo = Infinity, hi = -Infinity, dry = true;
    for (let j = 0; j <= 4 && dry; j++) for (let i = 0; i <= 4; i++) { const X = cx + x + i * 2, Y = cy + y + j * 2, h = land.height(X, Y); if (land.wet(X, Y)) { dry = false; break; } lo = Math.min(lo, h); hi = Math.max(hi, h); }
    if (!dry || hi - lo > 1.1) continue;
    const P = new Plan();
    P.home('cottage', S, x, y, q);
    const L = lay(P, cx, cy, 0, null);
    L.lvl = Math.ceil(hi / 0.25 - 0.05) * 0.25;
    L.work = [[L.homes[0].door[0], L.homes[0].door[1], q ? Math.PI : 0]];
    return L;
  }
  return null;
}

// ---------- the singular landmarks, once in the world each ----------
export const LANDMARKS = ['roble', 'puente', 'majada', 'atalaya', 'faro', 'santuario'];
export function landmarkLayout(id) {
  const P = new Plan();
  if (id === 'roble') {   // the council's oak: the ring of benches under it
    P.part('nature', { nature: [{ kind: 'greatOak', x: 0.5, y: 0.5, k: 1.3 }], wet: true });
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + 0.26; P.put('stone_bench', 0.5 + Math.sin(a) * 3.3, 0.5 + Math.cos(a) * 3.3, a); }
    P.put('signpost:45-135-225', 4.6, 4.2);
  } else if (id === 'majada') {
    P.add(turnBlueprint(hutBlueprint('tejado_gris'), 0, -9, -6, [6, 6]));
    P.pen(-2, -7, 8, 3, 'valla_piedra', [[-2, -2], [-2, -1]]);
    P.put('spring:trough', -7.2, 4.2, Math.PI * 0.9, { r: 2 }).put('stone_trough', 2.2, -5.6).put('hayrick', 6, -4.6).put('firewood', -10.4, -3, Math.PI / 2).put('stone_bench', -3.6, 1.8).put('chop_block', -10.8, 1.2);
    P.path(-6, 0, -6, 0).path(-6, 1, -4, 1).path(-3, -2, -3, 1);
    P.work(0.5, -1, -1.2);
  } else if (id === 'santuario') {
    P.add(turnBlueprint(sanctuaryBlueprint(), 0, -3, -6, [7, 8]));
    P.put('bell_frame', 6.2, 0.2).put('stone_bench', -5.2, 2.4, 0.5).put('stone_bench', 5.8, 4.2, -0.6).put('spring:seep', -7.0, -2.6, 0.9, { r: 1.5 }).put('brazier:cold', 2.9, 2.6).put('brazier:cold', -1.9, 2.6);
    P.path(0, 2, 0, 7).path(-1, 2, 1, 3);
  } else if (id === 'puente') P.deck('stone_bridge', 0.5, 0.5, 0, 9);
  return P;
}
export function landmarkPlan(p, id) {
  const L = lay(landmarkLayout(id), Math.floor(p.x), Math.floor(p.y), 0, null);
  if (id === 'puente') { L.decks = L.decks.map(d => ({ ...d, yaw: p.yaw || 0, L: p.len || 9 })); L.props = L.props.map(o => ({ ...o, m: `stone_bridge:${p.len || 9}`, yaw: p.yaw || 0 })); L.box = deckBox(L.decks[0]); }
  else if (L.box[0] === Infinity) L.box = [p.x - 5, p.y - 5, p.x + 5, p.y + 5];
  if (id !== 'roble' && id !== 'puente') L.lvl = p.z ? p.z : null;
  return L;
}
