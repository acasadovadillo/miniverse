// Wear and repair (docs/planes/realismo/PLAN-R5-construccion.md §3.5, P3): what the players build ages with the days lived in
// the world, by its material, the weather and the place. Two stages: weathered (only the look: grey wood, dark thatch, moss) and
// worn: a worn roof leaks in the rain, and three worn walls round a room (or a leak) let the air in. Nothing ever falls, is lost
// or stops one's way. The hammer repairs: two swings and one unit of the piece's first material, and it is as new.
// What came with the village, the neighbours' houses, the player's house in the village and the aldeas never wears (they keep
// theirs); furniture, neither.
//
// The clock. game.wear.v.d: the days of wear of this world, 0 the day this arrived: everything built before starts as new then.
// Each morning adds the day before, if somebody played on it (farm.playedOn): weeks with nobody count nothing. A day counts by
// its weather, from 0.8 (clear) to 1.5 (a storm): about 1 on average over a year. Whoever decides the world keeps it, and it is
// saved and shared with the world (livesync.js 'wear'); an old game that runs the world keeps it as it is.
// A piece: d.aged["<layer>:<tx>,<ty>"] = the clock the day it was put, swapped or repaired (absent: 0), a field of its chunk,
// saved and synced like the rest; in whoever decides, a guest's piece is stamped by arbitrate, never by the guest.
// Its age is the days since then × the place's factor (its biome), and slower under a roof.
//
// Contract:
//   ruleOf, stageAt, placeK…  the numbers: wearrules.js
//   wear.at(layer, tx, ty)    the stage of what a player put there (0 for the rest); scenes.js wearAt asks it
//   wear.sig(cx, cy)          { all, roof }: they change when a stage of that chunk does (all: its floors and what stands; roof:
//                             its roofs, which three/world3d.js draws apart), to draw it again
//   wear.put(d, layer, k, id), wear.gone(d, layer, k)   scenes.js: something was put, or taken away
//   wear.raining, wear.leaks, wear.under   the roof tiles that leak near the player now (LEAK_R, LEAKS at most), and whether
//                             he stands under one (body.js)
//   wear.fix(key)             (whoever decides) that piece is as new. A guest asks with the claim wear_fix: paid once
//   wear.conditions(out)      remarks.js: 'house_kept', 'roof_worn'
// The stages of a chunk are worked out when someone asks and kept until it changes (d.v) or the clock reaches the next change
// of any piece of it: nothing per frame. ?deterioro=0: nothing wears in this game (and, deciding the world, its clock stops).
import { PIECES, parsePlaced } from './pieces.js';
import { CHUNK } from './world/gen.js';
import { wrapIndex, nearX } from './world/planet.js';
import { BOUNDS, onOwnLot } from './world/village.js';
import { ruleOf, placeK, EAVES, REPAIR_HITS, LEAK_R, LEAKS, DAY_K } from './wearrules.js';
import { WALL_H, ROOF } from './three/build3d.js';
import { HAMMER_REACH, planKey, parseKey } from './plans.js';
import { CLAIMS } from './claims.js';
import { CAM } from './camera.js';
import { apagada } from './opciones.js';
import { reportFault } from './faults.js';
import { matText } from './build.js';
import { Audio } from './audio.js';
import { Profile } from './accounts.js';
import { hud } from './ui/hud.js';
import { t } from './i18n.js';

export { ruleOf, stageAt, placeK, EAVES, REPAIR_HITS, AIR_WALLS, LEAK_R, LEAKS, DAY_K } from './wearrules.js';

const FIRST = 40 / 1.25;        // (before this many days of the clock nothing can have changed)
const LAYERS = ['floor', 'placed', 'roof'], LAYER = new Set(LAYERS);
const NONE = { v: -1, from: 0, next: Infinity, map: new Map(), worn: [], all: '', roof: '' };
const TICK = 0.25, AIM_MS = 100;
const KEPT_ROOF = 12, KEPT_DAYS = 40, KEPT_R = 14;   // (a house to speak of: that many roof tiles built, this near; kept: not before the thatch would have darkened)
const round1 = n => Math.round(n * 10) / 10;

CLAIMS.wear_fix = (g, c, d, k) => {
  const at = parseKey(c.key);
  return !!(at && g.wear && g.wear.chunkKey(at[1], at[2]) === k && g.wear.fix(c.key));
};

export class Wear {
  constructor(game) {
    this.game = game;
    this.on = !apagada('deterioro');
    this.v = { d: 0 };
    this.dayV = 0;                    // goes up with each change of the clock (structure.js RoomWatch, the caches)
    this.cache = new WeakMap();       // chunk delta → its stages
    this.memo = { cx: NaN, cy: NaN, touches: -1, dayV: -1, c: NONE };
    this.world = null;
    this.raining = false; this.leaks = []; this.under = false;
    this.acc = 0;
    this.strike = null;               // a swing on its way: { key, at, slot }
    this.prog = { key: '', n: 0, at: -1e9 };
    this.pend = new Set();            // (a guest) repairs asked for and not answered yet
    this.aimed = { t: -1e9, frame: -1, e: null };
    this.saidAt = -1e9; this.said = '';
    this.tg = { use: () => this.use(), auto: true, still: true, label: '', e: null };
    this.R = { text: '', target: { kind: 'wear', tile: null, box: null }, k: 0, dim: false };
  }

  // ---------- the clock ----------
  reset(save) {
    const d = save?.wear?.d;
    this.world = this.game.world;
    if (this.world) this.world.wear = this;
    this.cache = new WeakMap();
    this.raining = this.under = false; this.leaks.length = 0;
    this.strike = null; this.prog.key = ''; this.prog.n = 0; this.pend.clear(); this.aimed.e = null; this.aimed.t = -1e9;
    this.v = { d: Number.isFinite(d) && d > 0 ? d : 0 };
    this.told = save?.wearTip === 1;   // (the player's own: he has been told what the hammer does about it)
    this.dayV++;
  }
  save(out) { out.wear = { d: this.v.d }; if (this.told) out.wearTip = 1; }
  // (livesync.js: what whoever decides says)
  share(v) { if (Number.isFinite(v?.d) && v.d >= 0) this.set(v.d); }
  set(d) {
    d = Math.round(d * 100) / 100;
    if (d === this.v.d) return;
    if (d < this.v.d) this.cache = new WeakMap();
    this.v.d = d; this.dayV++;
  }
  get now() { return round1(this.v.d); }
  // A day more, if somebody played on the one before (day: the world's, as farm.js)
  onDay(day) {
    const g = this.game;
    if (!this.on || g.live?.guest || !g.farm?.playedOn(day - 1)) return;
    this.set(this.v.d + (DAY_K[g.days.weatherFor(day - 1)] ?? 1));
  }
  decides() { const b = this.game.barrow; return !b || b.decides(); }

  // ---------- the stages ----------
  chunkKey(tx, ty) { return `${wrapIndex(Math.floor(tx / CHUNK), CHUNK)},${Math.floor(ty / CHUNK)}`; }
  // The stages of a chunk: { map: "layer:x,y" → 1 or 2, worn: the leaking roof tiles, all, roof: signatures, next }
  chunk(cx, cy) {
    const w = this.world, M = this.memo;
    if (!this.on || !w || this.v.d < FIRST) return NONE;
    cx = wrapIndex(cx, CHUNK);
    if (M.cx === cx && M.cy === cy && M.touches === w.touches && M.dayV === this.dayV) return M.c;
    const d = w.deltas.get(`${cx},${cy}`);
    let c = NONE;
    if (d && (d.placed || d.floor || d.roof)) {
      c = this.cache.get(d);
      if (!c || c.v !== d.v || this.v.d < c.from || this.v.d >= c.next) this.cache.set(d, (c = this.work(d, cx, cy)));
    }
    M.cx = cx; M.cy = cy; M.touches = w.touches; M.dayV = this.dayV; M.c = c;
    return c;
  }
  work(d, cx, cy) {
    const w = this.world, K = placeK(w.gen.biomeAt((cx + 0.5) * CHUNK, (cy + 0.5) * CHUNK)), now = this.v.d, aged = d.aged, town = cx * CHUNK < BOUNDS.x1 && (cx + 1) * CHUNK > BOUNDS.x0 && cy * CHUNK < BOUNDS.y1 && (cy + 1) * CHUNK > BOUNDS.y0;
    let map = null, next = Infinity, h = 0, hr = 0, n = 0;
    const worn = [];
    for (const layer of LAYERS) {
      const L = d[layer];
      if (L) for (const k in L) {
        const raw = L[k], r = ruleOf(parsePlaced(raw)[0]);
        if (!r || (town && onOwnLot(...k.split(',').map(Number)))) continue;
        const key = `${layer}:${k}`, from = aged?.[key], since = Number.isFinite(from) ? Math.min(from, now) : 0;
        let f = K;
        if (layer !== 'roof') { if (d.roof?.[k]) f /= EAVES; else { const c = k.indexOf(','); if (w.baseAt('roof', +k.slice(0, c), +k.slice(c + 1))) f /= EAVES; } }
        const age = (now - since) * f, s = age >= r.at[1] ? 2 : age >= r.at[0] ? 1 : 0;
        if (s < 2) next = Math.min(next, since + r.at[s] / f);
        if (!s) continue;
        (map ||= new Map()).set(key, s);
        const z = hash(key) * s | 0;
        if (layer === 'roof') hr = (hr + z) | 0; else { h = (h + z) | 0; n++; }
        if (s === 2 && r.leaks) { const c = k.indexOf(','); worn.push([+k.slice(0, c), +k.slice(c + 1)]); }
      }
    }
    return { v: d.v, from: now, next, map: map || NONE.map, worn, all: n ? `${n}.${h}` : '', roof: hr ? String(hr) : '' };
  }
  at(layer, tx, ty) {
    if (!this.on || this.v.d < FIRST) return 0;
    const c = this.chunk(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK));
    return c.map.size ? c.map.get(`${layer}:${tx},${ty}`) || 0 : 0;
  }
  sig(cx, cy) { return this.chunk(cx, cy); }
  // Does it leak (when it rains)?
  leaksAt(tx, ty) {
    if (this.at('roof', tx, ty) !== 2) return false;
    const raw = this.world.ownAt('roof', tx, ty);
    return !!raw && !!ruleOf(parsePlaced(raw)[0])?.leaks;
  }
  // Something has been put (or swapped) in a tile: as new. (Nothing to note while the clock is at 0)
  put(d, layer, k, id) {
    const key = `${layer}:${k}`, n = this.now;
    if (n > 0 && LAYER.has(layer) && ruleOf(parsePlaced(id)[0])) (d.aged ||= {})[key] = n;
    else if (d.aged) delete d.aged[key];
  }
  gone(d, layer, k) { if (d.aged) delete d.aged[`${layer}:${k}`]; }
  // (whoever decides) That piece is as new
  fix(key) {
    const at = parseKey(key), w = this.world;
    if (!at || !w || (this.on && !this.at(...at))) return false;   // (with ?deterioro=0 here, what another game sees worn is mended all the same)
    const [layer, tx, ty] = at, cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK), d = w.delta(cx, cy), raw = d?.[layer]?.[`${tx},${ty}`];
    if (!raw) return false;
    this.put(d, layer, `${tx},${ty}`, raw);
    w.touch(cx, cy);
    return true;
  }

  // ---------- together ----------
  // (whoever decides) A guest's changes of a chunk, before applying them: what they put is stamped here; their own stamps are
  // never taken. → { ok, back }
  arbitrate(k, ops) {
    const d = this.world?.deltas.get(k), cur = isMap(d?.aged) ? d.aged : {}, n = this.now;
    let ok = null, back = null, put = null;
    for (let i = 0; i < ops.length; i++) {
      const [f, key, v] = ops[i];
      if (f === 'aged') {
        ok ||= ops.slice(0, i); back ||= [];
        if (typeof key !== 'string') back.push(['aged', null, structuredClone(cur)]); else back.push(cur[key] === undefined ? ['aged', key] : ['aged', key, cur[key]]);
        continue;
      }
      ok?.push(ops[i]);
      if (!LAYER.has(f) || typeof key !== 'string') continue;
      const q = `${f}:${key}`;
      if (typeof v === 'string' && n > 0 && ruleOf(parsePlaced(v)[0])) (put ||= []).push(['aged', q, n]);
      else if (cur[q] !== undefined) (put ||= []).push(['aged', q]);
    }
    if (put) {
      ok = (ok || ops.slice()).concat(put);
      // (theirs is told only if it is not what was put here)
      if (back) for (const op of put) { const i = back.findIndex(b => b[1] === op[1]); if (i >= 0) back[i] = op; }
    }
    return { ok: ok || ops, back: back || NO_OPS };
  }

  // ---------- the rain ----------
  update(dt) {
    const g = this.game, p = g.player;
    if (this.strike && g.time >= this.strike.at) { const S = this.strike; this.strike = null; try { this.land(S); } catch (e) { reportFault(e, 'Wear.land'); } }
    if ((this.acc += dt) < TICK) return;
    this.acc = 0;
    this.raining = this.on && !!p && g.scene === this.world && !!g.days?.info?.rain;
    this.leaks.length = 0; this.under = false;
    if (this.v.d < FIRST) return;
    if (!this.told && this.on && !Profile.server && p && g.mode === 'play' && !g.busy && g.scene === this.world && this.any(p)) { this.told = true; hud.toast(t('wear.tip'), 'info'); }
    if (!this.raining) return;
    const cx = Math.floor(p.x / CHUNK), cy = Math.floor(p.y / CHUNK), tx = Math.floor(p.x), ty = Math.floor(p.y), L = this.leaks;
    let far = 0;   // (the farthest of those there are, once there are enough)
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const c = this.chunk(cx + i, cy + j);
      for (const q of c.worn) {
        const d = Math.hypot(nearX(q[0] + 0.5, p.x) - p.x, q[1] + 0.5 - p.y);
        if (d > LEAK_R || (L.length === LEAKS && d >= far) || this.dry(q[0], q[1])) continue;
        if (q[0] === tx && q[1] === ty) this.under = true;
        if (L.length < LEAKS) L.push({ x: q[0], y: q[1], d });
        else { let k = 0; for (let m = 1; m < LEAKS; m++) if (L[m].d > L[k].d) k = m; L[k] = { x: q[0], y: q[1], d }; }
        far = 0; for (const e of L) far = Math.max(far, e.d);
      }
    }
  }
  // (over a wall, nothing is seen to drip)
  dry(tx, ty) { const k = this.world.pieceAt(tx, ty)?.kind; return k === 'wall' || k === 'door'; }

  // ---------- the hammer ----------
  // What gather.js asks every system: with the hammer in hand and no plan aimed at (plans.js goes first), what has worn
  target(p, held, def) {
    const g = this.game;
    if (!this.on || def?.tool !== 'hammer' || g.scene !== g.world || g.build.on || this.v.d < FIRST) return null;
    const e = this.aim();
    if (!e) return null;
    this.tg.e = e; this.tg.label = this.label(e);
    return this.tg;
  }
  // Is there anything worn around?
  any(p) {
    const cx = Math.floor(p.x / CHUNK), cy = Math.floor(p.y / CHUNK);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (this.chunk(cx + i, cy + j).map.size) return true;
    return false;
  }
  aim() {
    const g = this.game, p = g.player, A = this.aimed, now = performance.now();
    if (!p) return null;
    if (A.frame === g.frameNo || now - A.t < AIM_MS) return A.e && this.at(A.e.layer, A.e.tx, A.e.ty) ? A.e : null;
    A.frame = g.frameNo; A.t = now;
    return (A.e = this.any(p) ? this.look(p) : null);
  }
  // What one sees under the cursor, if it has worn. The roof above, from inside (where it is not drawn), by the tile aimed at
  // under it; and the floor under the furniture that stands on it
  look(p) {
    const g = this.game, m = g.mouse;
    if (!m?.in) {
      const tx = Math.floor(p.x + p.face.x), ty = Math.floor(p.y + p.face.y);
      return this.entry('placed', tx, ty) || (g.indoors ? this.entry('roof', tx, ty) : null) || this.entry('floor', tx, ty);
    }
    const hit = g.build.pick();
    if (!hit || hit.plan) return null;
    const [tx, ty] = hit.tile, e = this.entry(hit.layer, tx, ty, hit);
    if (e && hit.layer === 'placed') return e;
    const floor = e || (hit.layer !== 'roof' && !(hit.layer === 'placed' && PIECES[hit.o?.placed]) ? this.entry('floor', tx, ty) : null), up = hit.layer !== 'roof' && g.underRoof ? this.entry('roof', tx, ty) : null;
    return up && (!floor || up.stage >= floor.stage) ? up : floor;
  }
  entry(layer, tx, ty, hit = null) {
    const stage = this.at(layer, tx, ty);
    if (!stage) return null;
    const g = this.game, p = g.player, w = this.world, raw = w.ownAt(layer, tx, ty), id = raw && parsePlaced(raw)[0];
    if (!id) return null;
    const old = this.aimed.e, key = planKey(layer, tx, ty), x = Math.floor(nearX(tx + 0.5, p.x));
    const e = old?.key === key && old.stage === stage ? old : { key, layer, tx, ty, tile: [tx, ty], x, id, stage, pick: [[0, 0, 0, 0, 0, 0]], box: { x: 0, y: 0, hx: 0, hy: 0, ux: 1, uy: 0, vx: 0, vy: 1, y0: 0, y1: 0, abs: true }, o: null };
    e.hit = hit?.layer === layer ? hit : null;
    const q = e.pick[0], gy = g.view3d?.groundY?.(w, x + 0.5, ty + 0.5) ?? 0, b = e.hit?.box;
    if (layer === 'roof') {
      const h = w.roofGeometry?.(tx, ty, new Map())?.h.c ?? 0, y = gy + WALL_H + ROOF.level * h;
      q[0] = x; q[1] = y; q[2] = ty; q[3] = x + 1; q[4] = y + ROOF.thick; q[5] = ty + 1;
    } else if (b) { q[0] = b.x - b.hx; q[1] = b.y0 + gy; q[2] = b.y - b.hy; q[3] = b.x + b.hx; q[4] = b.y1 + gy; q[5] = b.y + b.hy; }
    else { q[0] = x; q[1] = gy; q[2] = ty; q[3] = x + 1; q[4] = gy + (layer === 'floor' ? 0.1 : WALL_H); q[5] = ty + 1; }
    const B = e.box;
    B.x = (q[0] + q[3]) / 2; B.y = (q[2] + q[5]) / 2; B.hx = (q[3] - q[0]) / 2; B.hy = (q[5] - q[2]) / 2; B.y0 = q[1]; B.y1 = q[4];
    return e;
  }
  // What it costs: one unit of its first material
  costOf(e) { const c = PIECES[e.id].cost[0]; return [[c[0], 1]]; }
  why(e) {
    const g = this.game, p = g.player;
    if (p.mount || p.boat || p.aboard) return t('build.why.riding');
    if (g.carry?.handsBusy()) return t('build.why.hands');
    if (g.plans.slot() < 0) return t('build.hint.no_hammer');
    if (Math.hypot(e.x + 0.5 - p.x, e.ty + 0.5 - p.y) > HAMMER_REACH) return t('build.why.far');
    if (g.admin) return '';
    const lack = g.plans.lacking(this.costOf(e));
    return lack.length ? t('build.why.lack', { what: matText(lack) }) : '';
  }
  label(e) {
    const why = this.why(e), item = PIECES[e.id];
    return why ? t('wear.hint.why', { item, state: this.state(e), why }) : this.game.admin ? t('wear.hint.repair_free', { item, state: this.state(e) }) : t('wear.hint.repair', { item, state: this.state(e), cost: matText(this.costOf(e)) });
  }
  state(e) { return t(e.stage > 1 ? 'wear.worn' : 'wear.weathered'); }
  // The row at it, with its ring (ui/prompts.js)
  row() {
    const g = this.game;
    if (!g.player || g.mode !== 'play' || g.busy || g.build.on || g.gather.target !== this.tg) return null;
    const e = this.tg.e, R = this.R, why = e && this.why(e);
    if (!e) return null;
    R.text = why || (g.admin ? t('wear.prompt.repair_free', { item: PIECES[e.id] }) : t('wear.prompt.repair', { item: PIECES[e.id], cost: matText(this.costOf(e)) }));
    R.dim = !!why;
    R.k = this.prog.key === e.key ? this.prog.n / REPAIR_HITS : 0;
    R.target.kind = 'wear:' + e.layer; R.target.tile = e.tile; R.target.box = e.box;
    return R;
  }
  // (its outline, when it is what one sees: engine.js highlight, as what is about to be taken down)
  outline() { const g = this.game, e = g.gather.target === this.tg ? this.tg.e : null; return e?.hit?.o && !g.busy ? { kind: 'placed', o: e.hit.o, yaw: e.hit.o.yaw, box: e.hit.box } : null; }
  // Hammer in hand: a click, or each frame while it is held (gather.use; as plans.js use and swing)
  use() {
    const g = this.game, G = g.gather, e = this.tg.e;
    if (e && this.swing(e) && G.tired()) G.cooldown /= 1.5;
  }
  swing(e) {
    const g = this.game, G = g.gather, p = g.player, P = g.plans;
    if (this.strike || G.cooldown > 0 || this.pend.has(e.key) || !P.moved()) return false;
    const why = this.why(e);
    if (why) {
      const now = performance.now();
      G.cooldown = 0.3;
      if (now - this.saidAt > 1500 || why !== this.said) { G.float(why, '#ffb0a0'); Audio.error(); this.said = why; }
      this.saidAt = now;
      return false;
    }
    this.said = '';
    const T = P.swingTime();
    G.cooldown = T; G.swing = 0.25; G.swingItem = 'hammer';
    const dx = e.x + 0.5 - p.x, dy = e.ty + 0.5 - p.y, d = Math.hypot(dx, dy);
    if (d > 0.35 && !p.moving && !CAM.first) { p.face = { x: dx / d, y: dy / d }; p.dir = [dx, dy]; }
    this.strike = { e, at: g.time + T * 0.55, slot: P.slot() };
    return true;
  }
  // It lands: the second one repairs (and pays)
  land(S) {
    const g = this.game, e = S.e, Q = this.prog;
    if (!this.at(e.layer, e.tx, e.ty)) { Audio.swish(); return; }
    g.gather.spend('hammer', S.slot);
    g.plans.knock(e);
    if (Q.key !== e.key || g.time - Q.at > 20) { Q.key = e.key; Q.n = 0; }
    Q.at = g.time; Q.n++;
    if (Q.n < REPAIR_HITS) return;
    Q.key = ''; Q.n = 0;
    const cost = this.costOf(e), pays = !g.admin;
    if (pays && !g.build.spend(cost)) { g.gather.float(t('build.why.materials'), '#ffb0a0'); Audio.error(); return; }
    this.rest();
    if (this.decides()) { if (this.fix(e.key)) this.done(e); else if (pays) g.build.giveBack(cost); return; }
    this.pend.add(e.key);
    g.barrow.claim('wear_fix', this.chunkKey(e.tx, e.ty), { key: e.key }, v => {
      this.pend.delete(e.key);
      // (someone had repaired it, or it is gone: not paid)
      if (pays && !v?.ok) g.build.giveBack(cost);
      if (v?.ok) this.done(e);
    });
  }
  // Still holding, the next one is not begun until the cursor (or the player) moves on (plans.js moved)
  rest() { const g = this.game, m = g.mouse, p = g.player; g.plans.rest = { x: m?.x || 0, y: m?.y || 0, px: p.x, py: p.y, yaw: CAM.yaw, look: CAM.look || 0 }; }
  done(e) {
    const g = this.game, b = e.pick[0];
    this.aimed.e = null; this.aimed.t = -1e9; this.aimed.frame = -1;
    g.skills?.gain('construccion', 1);
    g.gather.chips((b[0] + b[3]) / 2, (b[2] + b[5]) / 2, ruleOf(e.id)?.kind === 'stone' ? 'stone' : 'wood', 6);
    g.gather.float(t('wear.repaired'), '#c8f0b0');
    Audio.place();
  }
  onDeath() { this.strike = null; }
  onEnd() { this.strike = null; this.leaks.length = 0; this.raining = this.under = false; if (this.world?.wear === this) this.world.wear = null; }

  // ---------- what the neighbours say ----------
  // Near a house somebody built: its roof has worn, or it is well kept (remarks.js; looked at when asked, about once a second)
  conditions(out) {
    const g = this.game, p = g.player, w = this.world;
    if (!this.on || !p || !w || g.scene !== w || this.v.d < KEPT_DAYS) return out;
    const cx = Math.floor(p.x / CHUNK), cy = Math.floor(p.y / CHUNK);
    let n = 0, weathered = 0, worn = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const d = w.deltas.get(`${wrapIndex(cx + i, CHUNK)},${cy + j}`);
      if (!d?.roof) continue;
      const c = this.chunk(cx + i, cy + j);
      for (const k in d.roof) {
        const q = k.indexOf(',');
        if (Math.abs(nearX(+k.slice(0, q) + 0.5, p.x) - p.x) > KEPT_R || Math.abs(+k.slice(q + 1) + 0.5 - p.y) > KEPT_R) continue;
        n++;
        const s = c.map.size ? c.map.get('roof:' + k) : 0;
        if (s === 2) worn++; else if (s) weathered++;
      }
    }
    if (n < KEPT_ROOF) return out;
    if (worn) out.push('roof_worn');
    else if (weathered * 5 <= n) out.push('house_kept');
    return out;
  }
}
const NO_OPS = [];
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
