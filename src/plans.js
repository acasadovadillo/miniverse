// Plan and hammer (docs/planes/realismo/PLAN-R5-construccion.md §3.3, P2): B draws the pieces of a building for free, as a
// blueprint, and the hammer builds them, 1 to 5 swings each; the first swing pays its materials (backpack, then the chests
// within 16 tiles) and needs its station near. Furniture and stations are placed at once, as always. Creative, /setblock
// and /fill too; ?obra=0 is the building of before (opciones.js).
//
// A plan is world data: d.plan["<layer>:<tx>,<ty>"] = { id, r, by: who drew it, w: swings done, p: who paid (from the first
// swing on) }, a field of its chunk: it is saved and synced like the rest (livesync.js), and an old game keeps it unseen.
// Whoever decides the world (alone, you; together, the host or the world server) pays, counts the swings and places the
// piece; a guest asks for it through claims (claims.js): plan_start (the first swing, the one that pays), plan_hit and
// plan_finish (the last one), plan_cancel. Two swinging at once on the same piece pay once, and both swings count. Drawing,
// and erasing what nobody has begun, are ordinary changes of the chunk, checked by arbitrate.
//
// Only logic: three/site3d.js draws plans.list (the blueprint, what is half built, the scaffolding).
import { PIECES, layerOf } from './pieces.js';
import { ITEMS } from './items.js';
import { CHUNK } from './world/gen.js';
import { wrapIndex, nearX } from './world/planet.js';
import { wallRuns } from './art/build.js';
import { WALL_H, ROOF } from './three/build3d.js';
import { aStation } from './recipes.js';
import { CLAIMS } from './claims.js';
import { areCouple } from './social.js';
import { CAM } from './camera.js';
import { keys } from './input.js';
import { apagada } from './opciones.js';
import { Profile } from './accounts.js';
import { Audio } from './audio.js';
import { reportFault } from './faults.js';
import { roofWhy, frameOk } from './structure.js';
import { matText } from './build.js';
import { t } from './i18n.js';

export const HAMMER = 'hammer';
export const PLAN_REACH = 24;        // tiles: drawing, not building
export const HAMMER_REACH = 4.5;     // tiles from the player to the piece
export const SITE_R = 20;            // tiles: what the site line counts
const SWING = 0.55, SKILL = 0.03;    // s a swing lasts, and how much less with each level of building
const TIRED = 1.5;                   // (gather.js TIRED_SLOW)
const IMPACT = 0.55;                 // (of the swing: when it lands)
const NEAR = 3;                      // chunks around the player whose plans are in the list
const LIST_MS = 250;                 // ms between two readings of the list when only the world around has changed
const WHY_MS = 250, LINE_MS = 500;
const LV_JOIN = 1.5;                 // (as scenes.js: the tiles of a house share their level)

// Swings each piece takes
export const HITS = {
  suelo_madera: 1, camino: 1, valla: 1,
  suelo_piedra: 2, puerta_valla: 2, valla_piedra: 2, post: 2,
  muro_madera: 3,
  muro_entramado: 4, ventana: 4, ventana_contraventanas: 4, muro_cuadro: 4, puerta: 4, stone_pillar: 4,
  muro_piedra: 5,
};
export const hitsOf = id => HITS[id] || (PIECES[id]?.layer === 'roof' ? 2 : 3);
const STONE = new Set(['suelo_piedra', 'camino', 'valla_piedra', 'muro_piedra', 'stone_pillar']);
const TILES = new Set(['tejado_rojo', 'tejado_azul', 'tejado_gris', 'tejado_verde']);

const LAYERS = new Set(['floor', 'placed', 'roof']);
export const planKey = (layer, tx, ty) => `${layer}:${tx},${ty}`;
// "placed:3,-4" → ['placed', 3, -4], or null
export function parseKey(key) {
  const m = typeof key === 'string' && /^(\w+):(-?\d+),(-?\d+)$/.exec(key);
  return m && LAYERS.has(m[1]) ? [m[1], +m[2], +m[3]] : null;
}
// Is this a piece that is drawn first (the ones of the palette: furniture and stations, never)?
export const planned = id => !!PIECES[id] && !ITEMS[id] && LAYERS.has(layerOf(id));
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const me = () => Profile.id || 'me';
const chunkKey = (tx, ty) => `${wrapIndex(Math.floor(tx / CHUNK), CHUNK)},${Math.floor(ty / CHUNK)}`;
export const planAt = (world, layer, tx, ty) => world.deltas.get(chunkKey(tx, ty))?.plan?.[planKey(layer, tx, ty)] || null;

// The world as it will be once its plans are built: what structure.js, canPlace and the drawing of a plan ask, so a door
// finds the wall that is drawn beside it. skip: a plan that does not count (the one being changed for another). Nothing of it
// is kept in the world's caches: what fills them goes to the world itself
function overlayOf(world) {
  const bind = {};
  for (const f of ['contentFor', 'collidersNear', 'water', 'natWater', 'digWater', 'floodAt', 'delta', 'levelAt', 'surfaceAt', 'digH', 'cornerH']) if (typeof world[f] === 'function') bind[f] = { value: world[f].bind(world) };
  // (asked over and over for the same tiles while the list is made and the scaffolding looked for: remembered meanwhile)
  const memo = { placed: new Map(), floor: new Map(), roof: new Map() };
  let ver = -1;
  const find = (layer, tx, ty) => { const v = world.at(layer, tx, ty); if (v) return v; const r = planAt(world, layer, tx, ty); return r ? (r.r ? `${r.id}@${r.r}` : r.id) : undefined; };
  return Object.create(world, {
    ...bind,
    overlay: { value: true },
    skip: { value: null, writable: true },
    touches: { get() { return this.skip ? undefined : world.touches + world.planV; } },
    at: { value(layer, tx, ty) {
      const M = memo[layer];
      if (this.skip || !M) return this.skip === planKey(layer, tx, ty) ? world.at(layer, tx, ty) : find(layer, tx, ty);
      const now = world.touches + world.planV;
      if (now !== ver) { ver = now; memo.placed.clear(); memo.floor.clear(); memo.roof.clear(); }
      const k = (ty + 4194304) * 8388608 + (tx + 4194304);
      let v = M.get(k);
      if (v === undefined) M.set(k, (v = find(layer, tx, ty) || ''));
      return v || undefined;
    } },
  });
}

// ---------- the host's word (claims.js) ----------
const recOf = (d, c, k) => { const at = parseKey(c.key); return at && chunkKey(at[1], at[2]) === k && isMap(d?.plan?.[c.key]) ? d.plan[c.key] : null; };
// The first swing: who asks pays, unless someone already has (free: the swing counts all the same)
CLAIMS.plan_start = (g, c, d, k, extra) => {
  const r = recOf(d, c, k);
  if (!r || !g.plans) return false;
  if (g.plans.world.at(...parseKey(c.key))) { g.plans.drop(c.key); return false; }   // (built over meanwhile: nothing is paid)
  if (r.p) extra.free = 1; else r.p = c.by;
  return g.plans.hit(c.key, r, extra);
};
CLAIMS.plan_hit = CLAIMS.plan_finish = (g, c, d, k, extra) => {
  const r = recOf(d, c, k);
  return !!(r && r.p && g.plans?.hit(c.key, r, extra));
};
CLAIMS.plan_cancel = (g, c, d, k) => {
  const r = recOf(d, c, k);
  return !!(r && g.plans?.mayCancel(r, c.by) && g.plans.drop(c.key));
};

export class Plans {
  constructor(game) {
    this.game = game;
    this.on = !apagada('obra');
    this.list = [];                   // the plans around: { key, layer, tx, ty, x, id, rec, y, boxes, pick, hits }
    this.byKey = new Map();
    this.listV = 0;                   // goes up each time the list is made again
    this.workV = 0;                   // … and this one with each swing that only changes how much stands
    this.world = null; this.view = null;
    this.seen = { planV: -1, touches: -1, cx: NaN, cy: NaN, t: -1e9 };
    this.strike = null;               // a swing on its way: { key, at: when it lands (game.time), slot }
    this.pend = new Map();            // (a guest) key → swings asked for and not answered yet
    this.holding = false;             // in build mode, the mouse is held to hammer
    this.force = null;                // … the plan it began on, until the cursor leaves its tile
    this.rest = null;                 // a piece has just been finished, held: where the cursor was (moved)
    this.only = null;                 // … and its layer: the floor is hammered, not the wall the cursor crosses
    this.auto = 0;                    // until when the hammer stays in the hand between two swings in build mode
    this.saidAt = -1e9; this.said = '';
    this.aimMemo = { frame: -1, v: -1, x: NaN, y: NaN, e: null };
    this.whyMemo = { key: null, t: -1e9, v: null };
    this.lineMemo = { t: -1e9, text: '' };
    this.tg = { use: () => this.use(), auto: true, still: true, label: '', plan: null };
    this.R = { text: '', target: { kind: 'plan', tile: null, box: null }, k: 0 };
    this.box = { x: 0, y: 0, hx: 0, hy: 0, ux: 1, uy: 0, vx: 0, vy: 1, y0: 0, y1: 0, abs: true };
  }
  reset() {
    const w = this.game.world;
    this.world = w; this.view = w ? overlayOf(w) : null;
    this.list = []; this.byKey.clear(); this.listV++;
    this.seen.planV = -1;
    this.strike = null; this.pend.clear(); this.holding = false; this.force = null; this.lineMemo.t = -1e9; this.lineMemo.text = '';
    if (w) w.onPlanTaken = (key, r) => this.taken(key, r);
  }
  decides() { const B = this.game.barrow; return !B || B.decides(); }
  // Does building go through plans now? (survival, outside)
  get active() { const g = this.game; return this.on && !g.admin && g.scene === g.world; }
  recAt(key) { const at = parseKey(key); return at && this.world ? this.world.deltas.get(chunkKey(at[1], at[2]))?.plan?.[key] || null : null; }
  note(key) { const at = parseKey(key); this.world.planNote(Math.floor(at[1] / CHUNK), Math.floor(at[2] / CHUNK)); }

  // ---------- drawing ----------
  // What drawing a piece in a tile would do: { ok, plan: 'new' | 'replace' | 'hammer', key } or { ok: false, code }
  check(tile, id) {
    const g = this.game, w = this.world, p = g.player, [x, y] = tile, layer = layerOf(id), V = this.view;
    if (Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) > PLAN_REACH) return { ok: false, code: 'far' };
    const key = planKey(layer, x, y), r = planAt(w, layer, x, y);
    if (r && (r.id === id || r.w > 0 || r.p)) return { ok: true, plan: 'hammer', key };
    V.skip = r ? key : null;
    try {
      if (V.canPlace(x, y, id, null)) return { ok: true, plan: r ? 'replace' : 'new', key };
      return { ok: false, code: g.build.whyNot(tile, id, V) };
    } finally { V.skip = null; }
  }
  // Draw a piece. It costs nothing
  draw(key, id) {
    const at = parseKey(key);
    if (!at || !planned(id)) return false;
    const [, x, y] = at, d = this.world.delta(Math.floor(x / CHUNK), Math.floor(y / CHUNK), true);
    (d.plan ||= {})[key] = { id, r: 0, by: me(), w: 0 };
    this.note(key);
    Audio.chalk();
    return true;
  }
  // May this player erase a plan? One nobody has begun, anyone. Begun: who drew it or their couple, or an op (alone, always)
  mayCancel(r, by) {
    const g = this.game, L = g.live;
    if (!(r.w > 0) && !r.p) return true;
    if (!L?.joined || !r.by || r.by === by || areCouple(g.family?.v, r.by, by)) return true;
    return by === me() && Profile.server ? true : !!L.isOp?.(by);
  }
  // Erase it: free, or, begun, what was paid falls on its tile
  cancel(key) {
    const g = this.game, r = this.recAt(key);
    if (!r) return false;
    if (!this.mayCancel(r, me())) { g.gather.float(t('plan.not_yours'), '#ffb0a0'); Audio.error(); return false; }
    if (this.decides() || (!(r.w > 0) && !r.p)) return this.drop(key);
    const at = parseKey(key);
    g.barrow.claim('plan_cancel', chunkKey(at[1], at[2]), { key });
    return true;
  }
  // The plan goes, and (whoever decides) its materials fall on the tile
  drop(key) {
    const r = this.recAt(key), at = parseKey(key);
    if (!r) return false;
    const d = this.world.deltas.get(chunkKey(at[1], at[2]));
    delete d.plan[key];
    this.note(key);
    if (this.decides()) this.spill(r, at[1], at[2]);
    return true;
  }
  spill(r, tx, ty) {
    if (!r.p || !PIECES[r.id]) return;
    for (const [m, n] of PIECES[r.id].cost) for (let i = 0; i < n; i++) this.game.gather.addDrop({ id: m, x: tx + 0.5 + (Math.random() - 0.5) * 0.7, y: ty + 0.5 + (Math.random() - 0.5) * 0.7, z: 8, vz: 40, t: 0, scene: this.world });
  }
  // Something real stands where a piece was drawn (creative, /setblock, a game of before): the plan goes. scenes.js place
  taken(key) { if (this.decides()) this.drop(key); }

  // ---------- together ----------
  // (whoever decides) A guest's changes of plans in a chunk, before applying them: drawing one, changing one nobody has begun
  // for another, or erasing it; the swings and who paid are never a guest's to write. → { ok, back }
  arbitrate(peer, k, ops) {
    const d = this.world.deltas.get(k) || {}, ok = [], back = [], cur = d.plan || {};
    const no = key => back.push(cur[key] ? ['plan', key, structuredClone(cur[key])] : ['plan', key]);
    for (const op of ops) {
      const [f, key, v] = op;
      if (f !== 'plan') { ok.push(op); continue; }
      if (typeof key !== 'string') { back.push(['plan', null, structuredClone(cur)]); continue; }
      const at = parseKey(key), r = cur[key], begun = isMap(r) && (r.w > 0 || r.p);
      if (begun) { no(key); continue; }
      if (v === undefined) { ok.push(op); continue; }
      if (!at || chunkKey(at[1], at[2]) !== k || !isMap(v) || !planned(v.id) || layerOf(v.id) !== at[0] || this.world.at(...at)) { no(key); continue; }
      const clean = { id: v.id, r: Number.isFinite(v.r) ? v.r & 3 : 0, by: peer?.id || v.by, w: 0 };
      ok.push(['plan', key, clean]);
      if (v.w > 0 || v.p || v.by !== clean.by) back.push(['plan', key, clean]);   // (it is told, or it would go on thinking otherwise)
    }
    return { ok, back };
  }
  // Changes of a chunk have arrived (live.js applyChunk): plans drawn or gone; and, in whoever decides, what was built on one
  onOps(k, ops) {
    let moved = false;
    const hit = this.decides() ? [] : null;
    for (const [f, c, v] of ops) {
      if (f === 'plan') moved = true;
      else if (hit && v !== undefined && typeof c === 'string' && LAYERS.has(f) && this.world?.deltas.get(k)?.plan?.[`${f}:${c}`]) hit.push(`${f}:${c}`);
    }
    if (moved && this.world) this.world.planV++;
    if (hit) for (const key of hit) this.drop(key);
  }
  // (whoever decides) A swing lands on a plan that is paid: counted, and the last one places the piece (extra.done)
  hit(key, r, extra = {}) {
    r.w = (Number.isFinite(r.w) ? r.w : 0) + 1;
    const [layer, tx, ty] = parseKey(key), w = this.world;
    if (r.w < hitsOf(r.id) && !extra.all) {
      // (only how much of it stands changes: the list is as it was)
      this.workV++; w.note(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK));
      return true;
    }
    if (w.at(layer, tx, ty)) { this.drop(key); return false; }
    this.refresh();
    const S = this.seen, fresh = S.planV === w.planV && S.touches === w.touches, e = this.byKey.get(key);
    delete w.deltas.get(chunkKey(tx, ty)).plan[key];
    this.note(key);
    w.place(tx, ty, r.id, r.r || 0);
    // (what was drawn there stands now: for the rest of the list nothing changes, it only leaves it)
    if (e && fresh) { this.list = this.list.filter(q => q !== e); this.byKey.delete(key); this.listV++; S.planV = w.planV; S.touches = w.touches; }
    extra.done = 1;
    return true;
  }

  // ---------- the hammer ----------
  slot() { const I = this.game.inv, S = I.slots; if (I.held?.id === HAMMER) return I.selected; for (let i = 0; i < I.cap; i++) if (S[i]?.id === HAMMER) return i; return -1; }
  swingTime() { const g = this.game; return SWING * (1 - SKILL * (g.skills?.level('construccion') || 0)) * (g.gather.tired() ? TIRED : 1); }
  // Why a piece cannot be hammered now ('': it can): what is drawn under it first, what is missing
  why(e) {
    const g = this.game, p = g.player, r = e.rec, w = this.world, [tx, ty] = [e.tx, e.ty];
    if (p.mount || p.boat || p.aboard) return t('build.why.riding');
    if (g.carry?.handsBusy()) return t('build.why.hands');
    if (this.slot() < 0) return t('build.hint.no_hammer');
    // (a roof rests on what is there; the rest may count on what is drawn beside it: a door, on the wall that comes next)
    this.view.skip = e.key;
    let fits;
    try { fits = (e.layer === 'roof' ? w : this.view).canPlace(tx, ty, e.id, null); } finally { this.view.skip = null; }
    if (!fits) {
      const code = e.layer === 'roof' && roofWhy(w, tx, ty) ? 'roof_first' : e.layer === 'placed' && !frameOk(this.view, tx, ty, e.id) ? 'frame' : 'no_fit';
      return t('build.why.' + code);
    }
    if (!r.p && !g.admin) {
      if (!g.build.stationFor(e.id)) return t('build.why.station', { station: aStation(PIECES[e.id].needs) });
      const lack = this.lacking(PIECES[e.id].cost);
      if (lack.length) return t('build.why.lack', { what: matText(lack) });
    }
    // (the last swing closes the tile: nobody in it)
    if (e.layer === 'placed' && this.done(e) + 1 >= e.hits && this.someone(tx, ty)) return t('build.why.someone');
    return '';
  }
  lacking(cost) { const B = this.game.build; return cost.map(([m, n]) => [m, n - B.have(m)]).filter(([, n]) => n > 0); }
  someone(tx, ty) {
    const g = this.game, near = e => !!e && Math.abs(nearX(e.x, tx + 0.5) - tx - 0.5) < 0.72 && Math.abs(e.y - ty - 0.5) < 0.72;
    if (near(g.player) || g.gather.someoneOn(tx, ty)) return true;
    if (g.live?.joined) for (const q of g.live.peers.values()) if (q.playing && q.sc === 'world' && q.entity && near(q.entity)) return true;
    return false;
  }
  // Swings done, with the ones a guest has asked for
  done(e) { return (e.rec.w || 0) + (this.pend.get(e.key) || 0); }

  // Which plan is aimed at: along the cursor's ray, the nearest within reach; a roof, only if nothing else is (it hides what is
  // under it). Without a mouse, what is in front. reach: in tiles (HAMMER_REACH; erasing, the one of drawing)
  aim(reach = HAMMER_REACH) {
    const g = this.game, p = g.player, m = g.mouse, M = this.aimMemo;
    this.refresh();
    if (!p || !this.list.length) return null;
    const x = m?.in ? m.x : -1, y = m?.in ? m.y : -1;
    if (M.frame === g.frameNo && M.v === this.listV && M.x === x && M.y === y && M.reach === reach) return M.e;
    M.frame = g.frameNo; M.v = this.listV; M.x = x; M.y = y; M.reach = reach;
    if (m?.in) return (M.e = this.pickAt(x, y, reach));
    let best = null, bd = Infinity;
    for (const e of this.list) {
      const dx = e.x + 0.5 - p.x, dy = e.ty + 0.5 - p.y, d = Math.hypot(dx, dy);
      if ((this.only && e.layer !== this.only) || d > Math.min(reach, 2.2) || (d > 0.7 && (dx * p.face.x + dy * p.face.y) / d < 0.3)) continue;
      const s = d + (e.layer === 'roof' ? 10 : 0);
      if (s < bd) { bd = s; best = e; }
    }
    return (M.e = best);
  }
  // (roofLast: a roof only if nothing else is under the ray; max: nothing farther along it than this)
  pickAt(sx, sy, reach = HAMMER_REACH, roofLast = true, max = Infinity) {
    const g = this.game, p = g.player, ray = g.view3d.rayAt?.(sx, sy);
    if (!ray) return null;
    const ox = ray.o[0], oy = ray.o[1], oz = ray.o[2], dx = ray.d[0], dy = ray.d[1], dz = ray.d[2];
    let best = null, near = max, roof = null, rnear = max;
    for (const e of this.list) {
      if ((this.only && e.layer !== this.only) || Math.hypot(e.x + 0.5 - p.x, e.ty + 0.5 - p.y) > reach) continue;
      for (const b of e.pick) {
        const d = slab(ox, oy, oz, dx, dy, dz, b);
        if (d < 0) continue;
        if (roofLast && e.layer === 'roof') { if (d < rnear) { rnear = d; roof = e; } } else if (d < near) { near = d; best = e; }
      }
    }
    return best || roof;
  }
  // What to hammer now: in build mode, while held, the plan it began on until the cursor leaves its tile
  focus() {
    if (this.force) {
      const e = this.byKey.get(this.force), mt = this.game.mouseTile();
      if (e && (!mt || (mt[0] === e.tx && mt[1] === e.ty))) return e;
      this.force = null;
    }
    return this.aim();
  }
  inReach(e) { const p = this.game.player; return Math.hypot(e.x + 0.5 - p.x, e.ty + 0.5 - p.y) <= HAMMER_REACH; }

  // What gather.js asks every system: with the hammer in hand, the plan aimed at
  target(p, held, def) {
    const g = this.game;
    if (def?.tool !== HAMMER || g.scene !== g.world || g.build.on) return null;
    const e = this.aim();
    if (!e) return null;
    this.tg.plan = e; this.tg.label = this.label(e);
    return this.tg;
  }
  // What the hint says of a plan: how to build it, or why not yet
  label(e) {
    const why = this.whyNow(e);
    if (why) return why;
    const item = PIECES[e.id];
    return e.rec.p || this.game.admin ? t('build.hint.hammer_paid', { item }) : t('build.hint.hammer', { item, cost: matText(item.cost) });
  }
  whyNow(e) {
    const M = this.whyMemo, now = performance.now();
    if (M.key !== e.key || now - M.t > WHY_MS || M.w !== e.rec.w) { M.key = e.key; M.t = now; M.w = e.rec.w; M.v = this.why(e); }
    return M.v;
  }
  // The row at the plan aimed at, with its ring (ui/prompts.js): { text, target, k }
  row() {
    const g = this.game;
    if (!g.player || g.mode !== 'play' || g.busy) return null;
    const e = g.build.on ? (this.holding ? this.focus() : null) : g.gather.target === this.tg ? this.tg.plan : null;
    if (!e) return null;
    const R = this.R, why = this.whyNow(e);
    R.text = why || (e.rec.p || g.admin ? t('build.prompt.hammer_paid', { item: PIECES[e.id] }) : t('build.prompt.hammer', { item: PIECES[e.id], cost: matText(PIECES[e.id].cost) }));
    R.dim = !!why;
    R.k = this.done(e) / e.hits;
    R.target.kind = 'plan:' + e.layer; R.target.tile = e.tile; R.target.box = this.boxOf(e, this.box);
    return R;
  }
  // Its box, as what is aimed at has it (with absolute heights)
  boxOf(e, b = { ux: 1, uy: 0, vx: 0, vy: 1, abs: true }) {
    const q = e.pick[0];
    b.x = (q[0] + q[3]) / 2; b.y = (q[2] + q[5]) / 2; b.hx = (q[3] - q[0]) / 2; b.hy = (q[5] - q[2]) / 2; b.y0 = q[1]; b.y1 = q[4];
    return b;
  }
  // Hammer in hand: a click, or each frame while it is held (gather.use)
  // (gather.use makes it longer by itself with no stamina: here it is already in swingTime)
  use() {
    const g = this.game.gather, e = this.tg.plan;
    if (e && this.byKey.get(e.key) === e && this.swing(e, this.slot()) && g.tired()) g.cooldown /= TIRED;
  }
  swing(e, slot) {
    const g = this.game, p = g.player;
    if (this.strike || g.gather.cooldown > 0 || !this.moved()) return false;
    const why = this.why(e);
    if (why) {
      // (held, it is said once)
      const now = performance.now();
      g.gather.cooldown = 0.3;
      if (now - this.saidAt > 1500 || why !== this.said) { g.gather.float(why, '#ffb0a0'); Audio.error(); this.said = why; }
      this.saidAt = now;
      return false;
    }
    this.said = '';
    const T = this.swingTime();
    g.gather.cooldown = T; g.gather.swing = 0.25; g.gather.swingItem = HAMMER;
    this.auto = g.time + T + 0.25;
    // (facing it, standing still)
    const dx = e.x + 0.5 - p.x, dy = e.ty + 0.5 - p.y, d = Math.hypot(dx, dy);
    if (d > 0.35 && !p.moving && !CAM.first) { p.face = { x: dx / d, y: dy / d }; p.dir = [dx, dy]; }
    this.strike = { key: e.key, at: g.time + T * IMPACT, slot };
    return true;
  }
  // Still holding once a piece is done, what is behind it is not begun by itself: the cursor (or the player) moves on first
  moved() {
    const r = this.rest, m = this.game.mouse, p = this.game.player;
    if (!r) return true;
    if (Math.hypot((m?.x || 0) - r.x, (m?.y || 0) - r.y) < 8 && Math.hypot(p.x - r.px, p.y - r.py) < 0.15 && Math.abs(CAM.yaw - r.yaw) + Math.abs((CAM.look || 0) - r.look) < 0.02) return false;
    this.rest = null;
    return true;
  }
  // It lands
  land(S) {
    const g = this.game, e = this.byKey.get(S.key), r = this.recAt(S.key);
    if (!e || !r) { Audio.swish(); return; }
    const admin = g.admin, cost = PIECES[r.id].cost, pays = !r.p && !admin && !this.pend.has(S.key);
    if (pays && !g.build.spend(cost)) { g.gather.float(t('build.why.materials'), '#ffb0a0'); Audio.error(); return; }
    g.gather.spend(HAMMER, S.slot);
    this.knock(e);
    if (this.decides()) {
      if (!r.p) r.p = me();
      const extra = admin ? { all: 1 } : {};
      if (this.hit(S.key, r, extra) && extra.done) this.built(e);
      return;
    }
    const kind = !r.p && !this.pend.has(S.key) ? 'plan_start' : (r.w || 0) + (this.pend.get(S.key) || 0) + 1 >= e.hits ? 'plan_finish' : 'plan_hit';
    this.pend.set(S.key, (this.pend.get(S.key) || 0) + 1);
    g.barrow.claim(kind, chunkKey(e.tx, e.ty), { key: S.key }, v => {
      const n = (this.pend.get(S.key) || 1) - 1;
      if (n > 0) this.pend.set(S.key, n); else this.pend.delete(S.key);
      // (it was not to be paid: someone had, or it is gone)
      if (pays && (!v || !v.ok || v.free)) g.build.giveBack(cost);
      if (v?.ok && v.done) this.built(e);
    });
  }
  knock(e) {
    const g = this.game, b = e.pick[0];
    const kind = STONE.has(e.id) || TILES.has(e.id) ? 'stone' : e.id === 'tejado_paja' ? 'twig' : 'wood';
    g.gather.chips((b[0] + b[3]) / 2, (b[2] + b[5]) / 2, kind, 5);
    Audio.hammer(kind);
  }
  // You have just finished it: as placing a piece always was
  built(e) {
    const g = this.game, m = g.mouse, p = g.player;
    this.rest = { x: m?.x || 0, y: m?.y || 0, px: p.x, py: p.y, yaw: CAM.yaw, look: CAM.look || 0 };
    g.build.recent.set(`${e.layer}:${e.tx},${e.ty}`, { id: e.id, t: Date.now() });
    g.rep?.placed(e.layer, e.tx, e.ty);
    g.skills?.gain('construccion', 1);
    g.stats?.add('piezas', 1);
    g.stats?.add('obra', 1);
    g.gather.chips(e.x + 0.5, e.ty + 0.5, STONE.has(e.id) ? 'stone' : 'wood', 8);
    Audio.place();
  }
  // In build mode the hammer is in the hand while it is used, wherever it is carried
  handId() { const g = this.game; return g.build.on && (this.strike || g.time < this.auto) ? HAMMER : undefined; }
  // In build mode: the mouse pressed on a plan (build.js place) and let go of
  hold(key) { this.holding = true; this.rest = null; this.force = key; this.only = parseKey(key)?.[0] || null; this.aimMemo.frame = -1; const e = this.byKey.get(key); if (e && this.inReach(e)) this.swing(e, this.slot()); else if (e) { this.game.gather.float(t('build.why.far'), '#ffb0a0'); Audio.error(); } }
  release() { this.holding = false; this.force = null; this.only = null; this.aimMemo.frame = -1; }

  update() {
    const g = this.game;
    this.refresh();
    if (this.rest && !keys.use && !this.holding) this.rest = null;
    if (this.strike && g.time >= this.strike.at) { const S = this.strike; this.strike = null; try { this.land(S); } catch (e) { reportFault(e, 'Plans.land'); } }
    if (this.holding) {
      const p = g.player;
      if (!g.build.on || g.busy || !p || p.swim || p.pose) { this.release(); return; }
      const e = this.focus();
      if (e && this.inReach(e)) this.swing(e, this.slot());
    }
  }
  onDeath() { this.strike = null; this.release(); }
  onEnd() { this.strike = null; this.release(); }

  // ---------- the list ----------
  // The plans around the player, with the boxes each takes up: made again when a plan changes, when the world around them
  // does (at most four times a second) or when the player changes of chunk
  refresh() {
    const g = this.game, w = this.world, p = g.player, S = this.seen;
    if (!w || !p || g.scene !== w) { if (this.list.length) { this.list = []; this.byKey.clear(); this.listV++; S.planV = -1; } return; }
    const cx = Math.floor(p.x / CHUNK), cy = Math.floor(p.y / CHUNK), now = performance.now();
    const same = S.planV === w.planV && S.cx === cx && S.cy === cy;
    if (same && (S.touches === w.touches || now - S.t < LIST_MS)) return;
    if (same && !this.list.length) { S.touches = w.touches; return; }   // (no plans, and none drawn since)
    S.planV = w.planV; S.touches = w.touches; S.cx = cx; S.cy = cy; S.t = now;
    this.build(cx, cy);
  }
  build(cx, cy) {
    const w = this.world, old = this.byKey, list = [], by = new Map();
    for (let j = -NEAR; j <= NEAR; j++) for (let i = -NEAR; i <= NEAR; i++) {
      const own = wrapIndex(cx + i, CHUNK), plan = w.deltas.get(`${own},${cy + j}`)?.plan;
      if (!plan) continue;
      const shift = (cx + i - own) * CHUNK;   // (across the planet's seam)
      for (const key in plan) {
        const rec = plan[key], at = parseKey(key);
        if (!at || !isMap(rec) || !planned(rec.id)) continue;
        // (the same record as before: the same entry, so what is aimed at is still it)
        const was = old.get(key), e = was && was.id === rec.id ? was : { key, layer: at[0], tx: at[1], ty: at[2], tile: [at[1], at[2]], id: rec.id, hits: hitsOf(rec.id) };
        e.rec = rec; e.x = at[1] + shift;
        list.push(e); by.set(key, e);
      }
    }
    if (list.length || this.list.length) { this.levels(list); this.shapes(list); this.listV++; }
    this.list = list; this.byKey = by;
  }
  // The height each is drawn at: the one it would have, and the tiles of a house at the same one, as scenes.js setLevel does
  levels(list) {
    const w = this.world, L = new Map(), todo = [];
    const open = e => e.layer === 'roof' || PIECES[e.id].kind === 'post';
    for (const e of list) {
      // (worked out again only if the level of its tile or of one beside it has changed, or something was dug)
      const d = w.deltas.get(chunkKey(e.tx, e.ty)), lv = (x, y) => { const D = Math.floor(x / CHUNK) === Math.floor(e.tx / CHUNK) && Math.floor(y / CHUNK) === Math.floor(e.ty / CHUNK) ? d : w.deltas.get(chunkKey(x, y)); return D?.lvl?.[`${x},${y}`] ?? -50; };
      const a = lv(e.tx, e.ty), b = lv(e.tx + 1, e.ty), c = lv(e.tx - 1, e.ty), f = lv(e.tx, e.ty + 1), h = lv(e.tx, e.ty - 1), G = e.sig;
      if (!G || G[0] !== a || G[1] !== b || G[2] !== c || G[3] !== f || G[4] !== h || G[5] !== w.digV) { e.sig = [a, b, c, f, h, w.digV]; e.own = w.levelFor(e.tx, e.ty, e.id) || 0; }
      e.y = e.own;
      if (open(e)) continue;
      const k = `${e.tx},${e.ty}`;
      L.set(k, Math.max(e.y, L.get(k) ?? -Infinity));
    }
    for (const k of L.keys()) todo.push(k);
    for (let n = 0; n < todo.length && n < 6000; n++) {
      const k = todo[n], [x, y] = k.split(',').map(Number), a = L.get(k);
      for (const [i, j] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const q = `${x + i},${y + j}`, b = L.get(q);
        if (b !== undefined && b < a && a - b <= LV_JOIN) { L.set(q, a); todo.push(q); }
      }
    }
    const roofL = new Map();
    for (const e of list) if (!open(e)) e.y = L.get(`${e.tx},${e.ty}`);
    for (const e of list) if (e.layer === 'roof') {
      const k = `${e.tx},${e.ty}`;
      if (!roofL.has(k)) {
        // (a roof, at the height of its house: the highest tile under it, drawn or built)
        const tiles = [], seen = new Set([k]), go = [[e.tx, e.ty]];
        let top = null, low = e.y;
        while (go.length && tiles.length < 900) {
          const [x, y] = go.pop(), q = `${x},${y}`;
          tiles.push(q);
          const h = L.get(q) ?? w.levelAt(x + 0.5, y + 0.5);
          if (h !== null && h !== undefined) top = Math.max(top ?? h, h); else low = Math.max(low, w.levelAt(x + 0.5, y + 0.5, true) || 0);
          for (const [i, j] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nk = `${x + i},${y + j}`; if (!seen.has(nk) && this.view.roofAt(x + i, y + j)) { seen.add(nk); go.push([x + i, y + j]); } }
        }
        for (const q of tiles) roofL.set(q, top ?? low);
      }
      e.y = roofL.get(k);
    }
  }
  // What each draws (boxes: [x0, y0, z0, x1, y1, z1, slope along x, slope along z]) and what one aims at (pick: plain boxes)
  shapes(list) {
    const V = this.view, memo = new Map();
    for (const e of list) {
      const x = e.x, y = e.y, z = e.ty, kind = PIECES[e.id].kind, B = (e.boxes = []), P = (e.pick = []);
      if (e.layer === 'floor') { B.push([x + 0.02, y, z + 0.02, x + 0.98, y + 0.05, z + 0.98]); P.push([x, y - 0.1, z, x + 1, y + 0.1, z + 1]); continue; }
      if (e.layer === 'roof') {
        const h = V.roofGeometry(e.tx, e.ty, memo)?.h || { nw: 0, ne: 0, se: 0, sw: 0, c: 0 }, b = y + WALL_H + 0.04, K = ROOF.level;
        e.h = h; e.roofY = b;
        // (a slope in one slab, or two halves where the ridge crosses the tile)
        const gx = (h.ne + h.se - h.nw - h.sw) / 2, gz = (h.sw + h.se - h.nw - h.ne) / 2, flat = h.nw + h.ne + h.se + h.sw, ridge = h.c - flat / 4;
        const slabAt = (x0, z0, x1, z1, y0, sx, sz) => B.push([x0, y0, z0, x1, y0 + ROOF.thick, z1, sx, sz]);
        if (ridge > 0.2 && Math.abs(h.nw - h.ne) < 0.01 && Math.abs(h.sw - h.se) < 0.01) { slabAt(x, z, x + 1, z + 0.5, b + (h.nw + h.c) / 2 * K, 0, (h.c - h.nw) * 2 * K); slabAt(x, z + 0.5, x + 1, z + 1, b + (h.sw + h.c) / 2 * K, 0, (h.sw - h.c) * 2 * K); }
        else if (ridge > 0.2 && Math.abs(h.nw - h.sw) < 0.01 && Math.abs(h.ne - h.se) < 0.01) { slabAt(x, z, x + 0.5, z + 1, b + (h.nw + h.c) / 2 * K, (h.c - h.nw) * 2 * K, 0); slabAt(x + 0.5, z, x + 1, z + 1, b + (h.ne + h.c) / 2 * K, (h.ne - h.c) * 2 * K, 0); }
        else slabAt(x, z, x + 1, z + 1, b + (flat / 4 + h.c) / 2 * K, gx * K, gz * K);
        P.push([x, b - 0.05, z, x + 1, b + ROOF.thick + Math.max(h.nw, h.ne, h.se, h.sw, h.c) * K, z + 1]);
        continue;
      }
      const isWall = p => p?.kind === 'wall' || p?.kind === 'door', cx = x + 0.5, cz = z + 0.5, n = (i, j) => V.pieceAt(e.tx + i, e.ty + j);
      if (kind === 'wall') {
        const m = (isWall(n(1, 0)) ? 1 : 0) | (isWall(n(-1, 0)) ? 2 : 0) | (isWall(n(0, 1)) ? 4 : 0) | (isWall(n(0, -1)) ? 8 : 0);
        const win = e.id.startsWith('ventana') && !((m & 3) && (m & 12)) ? (m & 12 ? 'z' : 'x') : null;
        for (const [x0, x1, z0, z1] of wallRuns(m)) {
          P.push([cx + x0, y, cz + z0, cx + x1, y + WALL_H, cz + z1]);
          if (!win) { B.push([cx + x0, y, cz + z0, cx + x1, y + WALL_H, cz + z1]); continue; }
          const at = (u0, u1, y0, y1) => (win === 'x' ? B.push([cx + u0, y + y0, cz + z0, cx + u1, y + y1, cz + z1]) : B.push([cx + x0, y + y0, cz + u0, cx + x1, y + y1, cz + u1]));
          at(-0.5, -0.3, 0, WALL_H); at(0.3, 0.5, 0, WALL_H); at(-0.3, 0.3, 0, 1); at(-0.3, 0.3, 1.95, WALL_H);
        }
      } else if (kind === 'door' || kind === 'gate') {
        const solid = p => p && (kind === 'gate' ? ['fence', 'gate', 'wall', 'post'].includes(p.kind) : p.kind !== 'fence' && p.kind !== 'gate');
        const X = solid(n(-1, 0)) || solid(n(1, 0)) || !(solid(n(0, -1)) || solid(n(0, 1))), T = kind === 'gate' ? 0.06 : 0.12, H = kind === 'gate' ? 1.05 : WALL_H;
        const at = (u0, u1, y0, y1, k = T) => (X ? B.push([cx + u0, y + y0, cz - k, cx + u1, y + y1, cz + k]) : B.push([cx - k, y + y0, cz + u0, cx + k, y + y1, cz + u1]));
        if (kind === 'door') { at(-0.5, -0.42, 0, H); at(0.42, 0.5, 0, H); at(-0.42, 0.42, 2.05, H); at(-0.4, 0.4, 0.02, 2.02, 0.03); } else { at(-0.5, -0.43, 0, H); at(0.43, 0.5, 0, H); for (const q of [0.26, 0.5, 0.74]) at(-0.43, 0.43, q, q + 0.09, 0.035); }
        P.push(X ? [x, y, cz - 0.14, x + 1, y + H, cz + 0.14] : [cx - 0.14, y, z, cx + 0.14, y + H, z + 1]);
      } else if (kind === 'post') {
        const r = PIECES[e.id].r;
        B.push([cx - r - 0.08, y, cz - r - 0.08, cx + r + 0.08, y + 0.16, cz + r + 0.08], [cx - r, y + 0.16, cz - r, cx + r, y + WALL_H, cz + r]);
        P.push([cx - r - 0.1, y, cz - r - 0.1, cx + r + 0.1, y + WALL_H, cz + r + 0.1]);
      } else {
        const J = p => ['fence', 'gate', 'wall', 'post'].includes(p?.kind), stone = e.id === 'valla_piedra', w0 = stone ? 0.17 : 0.06, H = stone ? 0.75 : 0.95;
        B.push([cx - w0, y, cz - w0, cx + w0, y + H, cz + w0]);
        const arms = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([i, j]) => J(n(i, j)));
        for (const [i, j] of arms) for (const [y0, y1] of stone ? [[0, 0.62]] : [[0.36, 0.46], [0.72, 0.82]]) {
          const k = stone ? 0.15 : 0.04;
          B.push(i ? [Math.min(cx + i * w0, cx + i * 0.5), y + y0, cz - k, Math.max(cx + i * w0, cx + i * 0.5), y + y1, cz + k] : [cx - k, y + y0, Math.min(cz + j * w0, cz + j * 0.5), cx + k, y + y1, Math.max(cz + j * w0, cz + j * 0.5)]);
        }
        P.push([arms.some(a => a[0] < 0) || !arms.length ? x : cx - 0.2, y, arms.some(a => a[1] < 0) || !arms.length ? z : cz - 0.2, arms.some(a => a[0] > 0) || !arms.length ? x + 1 : cx + 0.2, y + H, arms.some(a => a[1] > 0) || !arms.length ? z + 1 : cz + 0.2]);
      }
      // (the chalk line on the ground along what stands)
      e.chalk = B.length;
      if (kind === 'wall' || kind === 'door') for (const q of P) B.push(q[3] - q[0] > q[5] - q[2] ? [q[0], y + 0.005, cz - 0.16, q[3], y + 0.02, cz + 0.16] : [cx - 0.16, y + 0.005, q[2], cx + 0.16, y + 0.02, q[5]]);
    }
  }

  // ---------- the site line ----------
  // "Site: 64 pieces · you need 38 planks, 12 stone", with plans within SITE_R; '' without. For the objective's place, top left
  line() {
    const g = this.game, p = g.player, M = this.lineMemo, now = performance.now();
    if (now - M.t < LINE_MS) return M.text;
    M.t = now;
    if (!this.list.length || !p || g.scene !== g.world || g.admin) return (M.text = '');
    let n = 0;
    const need = new Map();
    for (const e of this.list) {
      if (Math.hypot(e.x + 0.5 - p.x, e.ty + 0.5 - p.y) > SITE_R) continue;
      n++;
      if (!e.rec.p) for (const [m, k] of PIECES[e.id].cost) need.set(m, (need.get(m) || 0) + k);
    }
    if (!n) return (M.text = '');
    const missing = [...need].map(([m, k]) => [m, k - g.build.have(m)]).filter(([, k]) => k > 0);
    return (M.text = missing.length ? t('site.line', { n, missing: matText(missing) }) : t('site.ready', { n }));
  }
}
// How far along a ray a box [x0, y0, z0, x1, y1, z1] is (-1: it misses)
function slab(ox, oy, oz, dx, dy, dz, b) {
  let a = 0, c = Infinity, u, v;
  if (Math.abs(dx) < 1e-9) { if (ox < b[0] || ox > b[3]) return -1; } else { u = (b[0] - ox) / dx; v = (b[3] - ox) / dx; if (u > v) { const q = u; u = v; v = q; } if (u > a) a = u; if (v < c) c = v; }
  if (Math.abs(dy) < 1e-9) { if (oy < b[1] || oy > b[4]) return -1; } else { u = (b[1] - oy) / dy; v = (b[4] - oy) / dy; if (u > v) { const q = u; u = v; v = q; } if (u > a) a = u; if (v < c) c = v; }
  if (Math.abs(dz) < 1e-9) { if (oz < b[2] || oz > b[5]) return -1; } else { u = (b[2] - oz) / dz; v = (b[5] - oz) / dz; if (u > v) { const q = u; u = v; v = q; } if (u > a) a = u; if (v < c) c = v; }
  return a <= c ? a : -1;
}
