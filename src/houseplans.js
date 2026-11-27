// House plans (docs/planes/realismo/PLAN-R5-construccion.md §3.6 and §4, phase P4): whole buildings to lay out with B at one click.
// Nilo sells four (a cabin, a shed with a porch, a barn and the village house: economy.js SHOPS.nilo, { house }), and the Copy tool
// saves something you built as a plan of your own (at most MINE_MAX, 24 × 24 tiles at most). In B › Plans the footprint follows the
// cursor (three/works3d.js draws it: blue where it goes, red where something is in the way), R turns it and a click draws every free
// tile as a blueprint (plans.js draw): nothing is paid until the hammer, or the crew (works.js), builds it. What is not a piece of
// the palette (furniture, the hearth) is never in a plan.
//
// Saved with the game: housePlans (the ids bought) and myPlans ([{ name, w, h, placed, floor, roof }], relative 'x,y' maps, the
// shape of world/blueprints.js, so stamping is the same code for both). An old save has neither.
// A couple shares what they bought (social.js areCouple): each game also writes its ids in the family's record, which every game
// and the world server share (family.v.housePlans: { playerId: [ids] }), and the partner's ids count as yours. Plans of your own
// (Copy) stay yours. ?cuadrilla=0: no Plans tab, no
// Copy tool and Nilo sells no house plans; what was bought stays in the save.
import { PIECES, parsePlaced, layerOf } from './pieces.js';
import { planned, planKey, PLAN_REACH } from './plans.js';
import { houseBlueprint, turnBlueprint } from './world/blueprints.js';
import { apagada } from './opciones.js';
import { Audio } from './audio.js';
import { hud } from './ui/hud.js';
import { t } from './i18n.js';
import { Profile } from './accounts.js';
import { areCouple } from './social.js';

export const WORKS_ON = !apagada('cuadrilla');
export const MINE_MAX = 6, COPY_MAX = 24;
const LAYERS = ['floor', 'placed', 'roof'];
const IDS = new WeakMap();
let nextId = 0;
const idOf = bp => { let n = IDS.get(bp); if (!n) IDS.set(bp, (n = ++nextId)); return n; };
const K = (x, y) => `${x},${y}`;
// The order a plan is drawn in: what each piece leans on goes first (a door on its wall, a roof on what holds it)
const RANK = id => { const p = PIECES[id]; return p.layer === 'floor' ? 0 : p.layer === 'roof' ? 3 : p.kind === 'door' || p.kind === 'gate' || id.startsWith('ventana') ? 2 : 1; };

// ---------- the plans Nilo sells ----------
function box(w, h, { wall, roof, floor, door = [[w >> 1, h - 1]], windows = [] }) {
  const placed = {}, fl = {}, rf = {};
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (floor) fl[K(x, y)] = floor; rf[K(x, y)] = roof; if (!x || !y || x === w - 1 || y === h - 1) placed[K(x, y)] = wall; }
  for (const [x, y] of windows) placed[K(x, y)] = 'ventana';
  for (const [x, y] of door) placed[K(x, y)] = 'puerta';
  return { placed, floor: fl, roof: rf };
}
// A cabin (6 × 5): boards and thatch, a wooden floor, the door in the middle of the front and a window on each side
const cabin = () => box(6, 5, { wall: 'muro_madera', roof: 'tejado_paja', floor: 'suelo_madera', door: [[3, 4]], windows: [[0, 2], [5, 2], [1, 4]] });
// A shed (4 × 3) with its front open on two posts, under thatch
function shed() {
  const placed = {}, roof = {};
  for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) roof[K(x, y)] = 'tejado_paja';
  for (let x = 0; x < 4; x++) placed[K(x, 0)] = 'muro_madera';
  placed[K(0, 1)] = placed[K(3, 1)] = 'muro_madera';
  placed[K(0, 2)] = placed[K(3, 2)] = 'post';
  return { placed, floor: {}, roof };
}
// A barn (8 × 6): boards on a stone floor, red tiles, a double door in front and a window high on each end
const barn = () => box(8, 6, { wall: 'muro_madera', roof: 'tejado_rojo', floor: 'suelo_piedra', door: [[3, 5], [4, 5]], windows: [[0, 2], [7, 2], [0, 4], [7, 4]] });
// The village house (12 × 10, as yours in the village), empty
const village = () => houseBlueprint({ x0: 0, y0: 0, furnish: 'none' });
export const HOUSE_PLANS = {
  cabin: { w: 6, h: 5, price: 150, make: cabin },
  shed: { w: 4, h: 3, price: 120, make: shed },
  barn: { w: 8, h: 6, price: 300, make: barn },
  house: { w: 12, h: 10, price: 500, make: village },
};
const cache = new Map();
// A plan's maps, only with what is drawn (pieces of the palette), and its size: { w, h, placed, floor, roof }
export function housePlan(id) {
  if (cache.has(id)) return cache.get(id);
  const H = HOUSE_PLANS[id];
  if (!H) return null;
  const bp = clean(H.make());
  const out = { id, w: H.w, h: H.h, ...bp };
  cache.set(id, out);
  return out;
}
const clean = bp => { const out = { placed: {}, floor: {}, roof: {} }; for (const L of LAYERS) for (const [k, raw] of Object.entries(bp[L] || {})) { const id = parsePlaced(raw)[0]; if (planned(id) && layerOf(id) === L) out[L][k] = id; } return out; };
// How many pieces, and what they cost, all together: { n, cost: [[m, n]] }
export function planCost(bp) {
  let n = 0;
  const m = new Map();
  for (const L of LAYERS) for (const id of Object.values(bp[L])) { n++; for (const [a, k] of PIECES[id].cost) m.set(a, (m.get(a) || 0) + k); }
  return { n, cost: [...m] };
}

// Its footprint, drawn small (the Plans tab and the shop): the roof pale, the walls dark, windows blue, doors open, posts dots
export function footprintIcon(bp, size = 56) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), s = Math.floor((size - 6) / Math.max(bp.w, bp.h)), ox = (size - s * bp.w) >> 1, oy = (size - s * bp.h) >> 1;
  for (let y = 0; y < bp.h; y++) for (let x = 0; x < bp.w; x++) {
    const k = K(x, y), id = bp.placed[k], X = ox + x * s, Y = oy + y * s;
    if (bp.roof[k]) { g.fillStyle = bp.roof[k] === 'tejado_paja' ? '#c9a860' : bp.roof[k] === 'tejado_gris' || bp.roof[k] === 'tejado_azul' ? '#7a8a96' : '#b8644a'; g.fillRect(X, Y, s, s); }
    else if (bp.floor[k]) { g.fillStyle = '#a88a62'; g.fillRect(X, Y, s, s); }
    if (!id) continue;
    const p = PIECES[id];
    g.fillStyle = p.kind === 'door' || p.kind === 'gate' ? '#e8d8b0' : id.startsWith('ventana') ? '#8ec4f0' : p.kind === 'post' ? '#3a2a1c' : STONE_WALL.has(id) ? '#5a5a58' : '#4a3424';
    if (p.kind === 'post') g.fillRect(X + s * 0.25, Y + s * 0.25, s * 0.5, s * 0.5); else g.fillRect(X, Y, s, s);
  }
  return c;
}
const STONE_WALL = new Set(['muro_piedra', 'ashlar_wall', 'limewash_wall', 'stone_pillar']);

export class HousePlans {
  constructor(game) {
    this.game = game;
    this.on = WORKS_ON;
    this.owned = new Set();     // the ids of the house plans bought
    this.mine = [];             // the plans of your own: [{ name, w, h, placed, floor, roof }]
    this.q = 0;                 // how the plan being laid out is turned (quarters)
    this.copyFrom = null;       // the Copy tool: the tile the drag began on
    this.copyTo = null;
    this.v = 0;                 // goes up when the footprint to draw changes (three/works3d.js)
    this.memo = { key: '', tiles: null };
  }
  reset(save) {
    this.owned = new Set((Array.isArray(save?.housePlans) ? save.housePlans : []).filter(id => HOUSE_PLANS[id]));
    this.mine = (Array.isArray(save?.myPlans) ? save.myPlans : []).map(sound).filter(Boolean).slice(0, MINE_MAX);
    this.q = 0; this.copyFrom = this.copyTo = null; this.v++;
  }
  save(out) {
    if (this.owned.size) out.housePlans = [...this.owned];
    if (this.mine.length) out.myPlans = this.mine.map(p => ({ name: p.name, w: p.w, h: p.h, placed: p.placed, floor: p.floor, roof: p.roof }));
  }
  // The ids you may lay out: yours and your partner's (by the family's record)
  all() {
    this.share();
    const F = this.game.family?.v, out = new Set(this.owned), me = Profile.id, S = this.game.social;
    const rec = F?.housePlans;
    if (me && rec && typeof rec === 'object') for (const [id, ids] of Object.entries(rec)) {
      if (id === me || !Array.isArray(ids) || !(areCouple(F, me, id) || S?.isPartnerId?.(id))) continue;
      for (const h of ids) if (HOUSE_PLANS[h]) out.add(h);
    }
    return out;
  }
  // Your bought ids into the family's record, when it lacks any (a new purchase, a save from before, a record that came from the
  // world's host without them)
  share() {
    const F = this.game.family?.v, me = Profile.id;
    if (!F || !me || !this.owned.size) return;
    const had = Array.isArray(F.housePlans?.[me]) ? F.housePlans[me] : [];
    if ([...this.owned].every(h => had.includes(h))) return;
    F.housePlans = { ...(F.housePlans && typeof F.housePlans === 'object' ? F.housePlans : {}), [me]: [...new Set([...had.filter(h => HOUSE_PLANS[h]), ...this.owned])] };
  }
  has(id) { return this.all().has(id); }
  learn(id) { if (!HOUSE_PLANS[id]) return false; this.owned.add(id); this.share(); this.game.build?.onChange?.(); this.game.onSave?.(); return true; }
  // What the Plans tab lists: [{ ref: 'plano:house:<id>' | 'plano:mine:<i>', name, bp, mine }]
  list() {
    const out = [], all = this.all();
    for (const id of Object.keys(HOUSE_PLANS)) if (all.has(id)) out.push({ ref: `plano:house:${id}`, name: t(`plan.${id}`), bp: housePlan(id), mine: false });
    this.mine.forEach((p, i) => out.push({ ref: `plano:mine:${i}`, name: p.name, bp: p, mine: true, i }));
    return out;
  }
  byRef(ref) {
    const m = /^plano:(house|mine):(\w+)$/.exec(ref || '');
    if (!m) return null;
    return m[1] === 'house' ? (this.all().has(m[2]) ? housePlan(m[2]) : null) : this.mine[+m[2]] || null;
  }
  get tool() { const b = this.game.build; return b.on && this.on ? b.tool : null; }
  get chosen() { const b = this.game.build; return this.tool === 'stamp' ? this.byRef(b.stampRef) : null; }

  // ---------- laying one out ----------
  turn(dir = 1) { this.q = (this.q + (dir < 0 ? 3 : 1)) % 4; this.v++; Audio.blip(); }
  // The plan turned and moved so that the cursor's tile is its middle: { x0, y0, w, h, maps }
  placedAt(bp, tile) {
    const w = this.q % 2 ? bp.h : bp.w, h = this.q % 2 ? bp.w : bp.h, x0 = tile[0] - (w >> 1), y0 = tile[1] - (h >> 1);
    return { x0, y0, w, h, maps: turnBlueprint(bp, this.q, x0, y0, [bp.w, bp.h]) };
  }
  // Each tile of it, and whether it can be drawn there (cheap: the ground and what stands; the rest is asked when it is drawn):
  // [{ x, y, layer, id, ok, same }]. Kept until the cursor, the turn or the world change
  tiles(bp, tile) {
    const w = this.game.world, key = `${idOf(bp)}|${tile}|${this.q}|${w.touches}|${w.planV}`, M = this.memo;
    if (M.key === key) return M.tiles;
    const at = this.placedAt(bp, tile), out = [], p = this.game.player, ground = new Map();
    for (const L of LAYERS) for (const [k, id] of Object.entries(at.maps[L])) {
      const [x, y] = k.split(',').map(Number), real = w.at(L, x, y), base = real && parsePlaced(real)[0];
      if (!ground.has(k)) ground.set(k, Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) <= PLAN_REACH && w.canPlace(x, y, 'suelo_madera', null));
      // (what stands in a tile is asked of a plain wall or post, which needs nothing beside it: a door's frame comes with the plan)
      const near = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) <= PLAN_REACH, same = base === id;
      const ok = same || (!real && (L === 'placed' ? near && w.canPlace(x, y, PIECES[id].kind === 'post' ? 'post' : 'muro_madera', null) : ground.get(k) || (L === 'roof' && near && !!w.at('floor', x, y))));
      out.push({ x, y, layer: L, id, ok, same });
    }
    M.key = key; M.tiles = out; this.v++;
    return out;
  }
  // Click: every free tile is drawn, in the order its pieces lean on each other. → how many were drawn
  stamp(tile) {
    const g = this.game, P = g.plans, bp = this.chosen;
    if (!bp || !tile || !P) return 0;
    // (in creative it stands at once; with ?obra=0 there are no blueprints to lay out)
    if (!P.active && !g.admin) { g.gather.float(t('plans.why.no_plans'), '#ffb0a0'); Audio.error(); return 0; }
    const list = this.tiles(bp, tile).filter(e => e.ok && !e.same).sort((a, b) => RANK(a.id) - RANK(b.id)), w = g.world;
    let n = 0, skip = 0;
    for (const e of list) {
      if (!P.active) { if (w.canPlace(e.x, e.y, e.id, null)) { w.place(e.x, e.y, e.id); n++; } else skip++; continue; }
      const c = P.check([e.x, e.y], e.id);
      if (c.ok && (c.plan === 'new' || c.plan === 'replace')) { if (P.draw(planKey(e.layer, e.x, e.y), e.id)) n++; } else skip++;
    }
    const blocked = this.memo.tiles.filter(e => !e.ok).length + skip;
    if (n) g.gather.float(blocked ? t('plans.laid_some', { n, k: blocked }) : t('plans.laid', { n }), '#cfe6ff');
    else { g.gather.float(t('plans.why.nothing'), '#ffb0a0'); Audio.error(); }
    this.memo.key = '';
    return n;
  }

  // ---------- Copy ----------
  // The rectangle being dragged (tiles, both ends in), or null
  copyRect() {
    const a = this.copyFrom, b = this.copyTo || a;
    if (!a) return null;
    const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]), x1 = Math.min(Math.max(a[0], b[0]), x0 + COPY_MAX - 1), y1 = Math.min(Math.max(a[1], b[1]), y0 + COPY_MAX - 1);
    return [x0, y0, x1, y1];
  }
  // What of yours stands in it, as a plan with its corner at 0, 0 (null: nothing)
  copyOf(R) {
    const w = this.game.world, out = { placed: {}, floor: {}, roof: {} };
    let n = 0, mx = Infinity, my = Infinity, Mx = -Infinity, My = -Infinity;
    for (let y = R[1]; y <= R[3]; y++) for (let x = R[0]; x <= R[2]; x++) for (const L of LAYERS) {
      const raw = w.ownAt(L, x, y), id = raw && parsePlaced(raw)[0];
      if (!id || !planned(id) || layerOf(id) !== L) continue;
      out[L][K(x, y)] = id; n++; mx = Math.min(mx, x); my = Math.min(my, y); Mx = Math.max(Mx, x); My = Math.max(My, y);
    }
    if (!n) return null;
    const rel = { placed: {}, floor: {}, roof: {} };
    for (const L of LAYERS) for (const [k, id] of Object.entries(out[L])) { const [x, y] = k.split(',').map(Number); rel[L][K(x - mx, y - my)] = id; }
    return { w: Mx - mx + 1, h: My - my + 1, ...rel };
  }
  press(tile, drag) {
    const b = this.game.build;
    if (b.tool === 'stamp') { if (!drag) this.stamp(tile); return; }
    if (b.tool !== 'copy' || !tile) return;
    if (!drag || !this.copyFrom) this.copyFrom = tile;
    this.copyTo = tile; this.v++;
  }
  // The mouse let go of: with Copy, what was dragged over is saved
  release() {
    const g = this.game, R = this.copyRect();
    this.copyFrom = this.copyTo = null; this.v++;
    if (!R || g.build.tool !== 'copy') return;
    const bp = this.copyOf(R);
    if (!bp) { g.gather.float(t('plans.copy.nothing'), '#ffb0a0'); Audio.error(); return; }
    if (this.mine.length >= MINE_MAX) { g.gather.float(t('plans.copy.full', { n: MINE_MAX }), '#ffb0a0'); Audio.error(); return; }
    let i = this.mine.length + 1;
    while (this.mine.some(p => p.name === t('plans.mine_name', { n: i }))) i++;
    this.mine.push({ name: t('plans.mine_name', { n: i }), ...bp });
    g.gather.float(t('plans.copy.saved', { name: this.mine.at(-1).name, n: planCost(bp).n }), '#cfe6ff');
    Audio.unlock();
    g.build.onChange?.();
    g.onSave?.();
  }
  async rename(i) {
    const p = this.mine[i];
    if (!p) return;
    const name = (await hud.askText('Nilo', t('plans.rename'), p.name)).replace(/[\u0000-\u001f<>]/g, '').slice(0, 16);
    if (name) p.name = name;
    this.game.build?.onChange?.(); this.game.onSave?.();
  }
  remove(i) {
    if (!this.mine[i]) return;
    this.mine.splice(i, 1);
    const b = this.game.build;
    if (b.tool === 'stamp' && b.stampRef?.startsWith('plano:mine:')) b.select('copiar');
    b.onChange?.(); this.game.onSave?.();
  }
  // What the bar's hint says
  hint(tile) {
    const b = this.game.build;
    if (b.tool === 'copy') { const R = this.copyRect(); return R ? t('plans.hint.copying', { w: R[2] - R[0] + 1, h: R[3] - R[1] + 1 }) : t('plans.hint.copy', { n: COPY_MAX }); }
    const bp = this.chosen;
    if (!bp || !tile) return '';
    const T = this.tiles(bp, tile), k = T.filter(e => !e.ok).length;
    return k ? t('plans.hint.stamp_some', { plan: bp.name || t(`plan.${bp.id}`), n: T.length - k, k }) : t('plans.hint.stamp', { plan: bp.name || t(`plan.${bp.id}`), n: T.filter(e => !e.same).length });
  }
}
// (a plan of one's own, from a save: only its pieces of the palette, and its size within bounds)
function sound(p) {
  if (!p || typeof p !== 'object' || typeof p.name !== 'string') return null;
  const w = p.w | 0, h = p.h | 0;
  if (w < 1 || h < 1 || w > COPY_MAX || h > COPY_MAX) return null;
  const out = { name: p.name.slice(0, 16), w, h, placed: {}, floor: {}, roof: {} };
  let n = 0;
  for (const L of LAYERS) for (const [k, id] of Object.entries(p[L] || {})) {
    const m = /^(\d+),(\d+)$/.exec(k);
    if (m && +m[1] < w && +m[2] < h && typeof id === 'string' && planned(id) && layerOf(id) === L) { out[L][k] = id; n++; }
  }
  return n ? out : null;
}
