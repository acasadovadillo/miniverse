// Fish traps (Plan R1-4, docs/planes/realismo/PLAN-R1-pesca.md §3.9): a wicker creel dropped in the water from the bank, a boat
// or a built floor, with whatever bait is chosen (R), and marked by a cork buoy. Hours later (real ones) E on the buoy hauls it:
// crayfish and eels in fresh water, crabs and now and then an octopus at sea. At most FULL catches in it, however long it
// stays; what is inside is alive, so it never goes off (its day is the day it is hauled).
//
//   d.traps["tx,ty"] = [owner's id, bait's id ('' none), set (ms of the clock of whoever decides), 1]   a field of its chunk,
//     saved and synced like any other. One a tile, MAX a player. An older game keeps it and sees no buoy.
//   Whoever decides the world (alone, the host or the world server; barrow.decides()) has the word on all of it: a guest
//   asks through claims (claims.js): trap_set, trap (haul it, with its new bait) and trap_take (its owner or their couple brings it back).
//   A guest never writes d.traps: arbitrate() puts back what one tries. The owner's couple hauls it and takes it out too (areCouple).
//   What is inside is not stored: catchOf() rolls it from the tile, the world's seed and the moment it was set, the same in
//   every game; how many, only whoever decides says (count: hours, the bait, the water and how fished-out it is).
//
//   traps.at(key)       its record, or null      traps.near   the keys of those round the player (three/traps3d.js draws them)
//   traps.mine()        those of the player and their couple: [{ key, x, y, own, set }] (the map and the angler's log)
import { ITEMS, FISH, itemNoun } from './items.js';
import { CHUNK } from './world/gen.js';
import { WATER_Y } from './world/biomes.js';
import { wrapIndex, wrapX, nearX, latOf, lonOf } from './world/planet.js';
import { seasonOf, madridMs } from './time.js';
import { ihash } from './util.js';
import { CLAIMS } from './claims.js';
import { Profile } from './accounts.js';
import { areCouple } from './social.js';
import { hud } from './ui/hud.js';
import { Audio } from './audio.js';
import { HOLD_X } from './input.js';
import { reportFault } from './faults.js';
import { t, getLang } from './i18n.js';
import * as FW from './fishwater.js';

export const FULL = 3, FULL_H = 8, MAX = 4;        // catches a trap holds, the real hours the best of them takes to fill, traps out per player
export const REACH = 2.3, MIN_DEPTH = 0.3;       // tiles (as far as E reaches the buoy: game.js AIM_REACH); metres of water it needs
// What goes into one: how readily, and the longest (cm) that gets through its mouth
export const TRAP_FISH = {
  crayfish: [1.5, 14], cangrejo: [1.3, 25], anguila: [1, 85], pulpo: [0.8, 62], sea_bream: [0.5, 38], siluro: [0.35, 72], barbel: [0.4, 42], carpa: [0.3, 42],
};
const HOUR = 3600000, DAY = 24 * HOUR, NEAR = 2, SCAN = 0.4, ASK_WAIT = 2.5;
const BAITED = ['rotten_fish', 'cut_bait', 'cangrejo', 'worm', 'saltamontes', 'maiz', 'pan'];   // (one of each kind: the best of them in a water is its measure)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const me = () => Profile.id || 'me';
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
export const keyOf = (x, y) => `${wrapX(Math.floor(x))},${Math.floor(y)}`;
const KEY = /^-?\d{1,6},-?\d{1,6}$/;
export const tileOf = key => (typeof key === 'string' && KEY.test(key) ? key.split(',').map(Number) : null);
export const chunkOf = ([tx, ty]) => `${wrapIndex(Math.floor(tx / CHUNK), CHUNK)},${Math.floor(ty / CHUNK)}`;
export const isRec = r => Array.isArray(r) && typeof r[0] === 'string' && (r[1] === '' || typeof r[1] === 'string') && Number.isFinite(r[2]);
// The bait that can go in a trap (no lure), or ''
export const baitOk = id => typeof id === 'string' && id !== '' && !ITEMS[id]?.lure && (FW.INSECTS.has(id) || BAITED.includes(id));

// ---------- what goes in (pure: the world's water, the moment it was set, the bait) ----------
// The water of a tile, or null: { water, depth, spot }
export function waterAt(w, tx, ty) {
  const x = tx + 0.5, y = ty + 0.5, water = FW.waterType(w, x, y);
  if (!water) return null;
  const depth = FW.bedDepth(w, x, y);
  return { water, depth, spot: FW.structure(w, x, y, water, depth) };
}
// The season and the local hour at a tile, at a moment of the world's clock (T: time.js; its shift goes along)
function moment(T, tx, ty, ms) {
  const now = T.now - Date.now() + ms, season = seasonOf(Math.floor(now / DAY)).season;
  return { season: latOf(ty) < 0 ? (season + 2) % 4 : season, hour: ((((now % DAY) / HOUR + lonOf(tx) / 15) % 24) + 24) % 24 };
}
// How readily a species goes into a trap with that bait, at its best hour and season
const pull = (f, id, W, bait) => (f.water.includes(W.water) ? f.base * TRAP_FISH[id][0] * FW.depthK(f.depth, W.depth) * FW.baitK(f, bait) : 0);
const IDS = Object.keys(TRAP_FISH);
export const lives = W => !!W && IDS.some(id => pull(FISH[id], id, W, 'rotten_fish') > 0);
// 0-1.2: how good bait, water, season and spot are, against the best bait there (the hour of the day, no: a trap stays)
export function trapK(W, bait, season, tempC) {
  let sum = 0, best = 0;
  for (const id of IDS) {
    const f = FISH[id], k = (f.seasons && !f.seasons.includes(season) ? 0.15 : 1) * (f.temp && Number.isFinite(tempC) ? FW.tempK(f.temp, tempC) : 1);
    sum += pull(f, id, W, bait) * k;
  }
  for (const b of BAITED) { let q = 0; for (const id of IDS) q += pull(FISH[id], id, W, b); best = Math.max(best, q); }
  return best > 0 ? Math.min(1.2, (sum / best) * clamp(W.spot, 0.7, 1.3)) : 0;
}
// How many are in it: hours, real ones, since it was set. stock: how fished-out the cell is (fishwater.js stockK)
export const countFor = (hours, k, stock) => Math.max(0, Math.min(FULL, Math.floor((Math.max(0, hours) / FULL_H) * FULL * k * stock + 1e-6)));
export function count(g, key, rec, now) {
  const at = tileOf(key), w = g.world, W = at && waterAt(w, ...at);
  if (!W || !lives(W)) return 0;
  const { season } = moment(g.days, ...at, rec[2]), x = at[0] + 0.5, y = at[1] + 0.5;
  return countFor((now - rec[2]) / HOUR, trapK(W, rec[1], season, FW.waterC(w, x, y, season, W.water, W.depth)), FW.stockK(FW.caughtAt(w, x, y, W.water, g.days.realDay), W.water));
}
// The n that went in, [{ id, cm, g }]: each at its own moment of the hours it took (crayfish and eels, mostly by night)
export function catchOf(g, key, set, bait, n) {
  const at = tileOf(key), w = g.world, W = at && waterAt(w, ...at), out = [];
  if (!W || !(n > 0)) return out;
  const [tx, ty] = at, x = tx + 0.5, y = ty + 0.5, seed = ((w.gen?.seed | 0) + Math.floor(set / 1000)) | 0;
  const roll = i => ihash(tx, ty, (seed + 5501 + i * 131) | 0);
  for (let i = 0; i < Math.min(FULL, n); i++) {
    const M = moment(g.days, tx, ty, set + ((i + 0.5) / FULL) * FULL_H * HOUR), c = { water: W.water, depth: W.depth, hour: M.hour, season: M.season, weather: 'nubes', tempC: FW.waterC(w, x, y, M.season, W.water, W.depth) };
    let sum = 0, id = null;
    const share = q => pull(FISH[q], q, W, bait) * FW.momentK(FISH[q], c);
    for (const q of IDS) sum += share(q);
    if (!(sum > 0)) continue;
    let r = roll(i * 3) * sum;
    for (const q of IDS) { const v = share(q); if (!(v > 0)) continue; id = q; if ((r -= v) <= 0) break; }
    const f = FISH[id], top = Math.min(f.cm[1], TRAP_FISH[id][1]), cm = f.cm[0] + (top - f.cm[0]) * roll(i * 3 + 1) ** 2;
    out.push({ id, cm: Math.round(cm * 10) / 10, g: Math.max(1, Math.round(FW.kgOf(f, cm) * 1000)) });
  }
  return out;
}

// ---------- the host's word (claims.js) ----------
const recIn = (d, c, k) => { const at = tileOf(c.key), r = at && chunkOf(at) === k && Object.prototype.hasOwnProperty.call(d?.traps || {}, c.key) ? d.traps[c.key] : null; return isRec(r) ? r : null; };
// (a trap set with no account, 'me', is whoever's world it is)
const owns = (r, by) => r[0] === by || r[0] === 'me';
const shares = (g, r, by) => owns(r, by) || areCouple(g.family?.v, r[0], by);
CLAIMS.trap_set = (g, c, d, k, extra) => {
  const at = tileOf(c.key), T = g.traps, by = typeof c.by === 'string' ? c.by.slice(0, 64) : '';
  if (!at || !T || !by || chunkOf(at) !== k || wrapX(at[0]) !== at[0]) return false;
  extra.why = T.why(...at) || (T.outOf(by) >= MAX ? 'max' : '');
  if (extra.why) return false;
  (d.traps ||= {})[c.key] = [by, baitOk(c.bait) ? c.bait : '', T.now(), 1];
  T.moved();
  return true;
};
// Hauled: extra.n of those that were in, rolled by who hauls from extra.set and extra.bait; the new bait goes in and it starts
// again. Nothing in it yet: refused (why 'none'), unless it had no bait and one is put
CLAIMS.trap = (g, c, d, k, extra) => {
  const r = recIn(d, c, k), T = g.traps;
  if (!r || !T) { extra.why = 'gone'; return false; }
  if (!shares(g, r, c.by)) { extra.why = 'not_yours'; return false; }
  if (r[2] !== c.set) { extra.why = 'late'; return false; }
  const now = T.now(), n = count(g, c.key, r, now), bait = baitOk(c.bait) ? c.bait : '';
  if (!n && (r[1] || !bait)) { extra.why = 'none'; return false; }
  Object.assign(extra, { n, set: r[2], bait0: r[1] });
  d.traps[c.key] = [r[0], bait, now, 1];
  T.fished(c.key, n); T.moved();
  return true;
};
// Brought back, by its owner or their couple: what was in it first
CLAIMS.trap_take = (g, c, d, k, extra) => {
  const r = recIn(d, c, k), T = g.traps;
  if (!r || !T) { extra.why = 'gone'; return false; }
  if (!shares(g, r, c.by)) { extra.why = 'not_yours'; return false; }
  if (r[2] !== c.set) { extra.why = 'late'; return false; }
  const n = count(g, c.key, r, T.now());
  Object.assign(extra, { n, set: r[2], bait0: r[1] });
  delete d.traps[c.key];
  if (!Object.keys(d.traps).length) delete d.traps;
  T.fished(c.key, n); T.moved();
  return true;
};

export class Traps {
  constructor(game) {
    this.game = game;
    this.skew = 0;             // ms the clock is ahead (the tests)
    this.reset();
  }
  reset() {
    this.near = []; this.sig = ''; this.acc = 0; this.v = 0; this.world = null;
    this.asked = new Map();    // (a guest) key → game.time it asked for it
    this.said = ''; this.hinted = null; this.mineAt = -1e9; this.mineList = []; this.mineV = -1;
  }
  now() { return Date.now() + this.skew; }
  at(key) { const c = tileOf(key), r = c && this.game.world?.deltas.get(chunkOf(c))?.traps?.[key]; return isRec(r) ? r : null; }
  moved() { this.acc = 0; this.mineAt = -1e9; }
  decides() { const B = this.game.barrow; return !B || B.decides(); }
  // The traps of a player, in all of the world this game knows
  outOf(by) { let n = 0; for (const d of this.game.world.deltas.values()) if (d?.traps) for (const k in d.traps) if (isRec(d.traps[k]) && d.traps[k][0] === by) n++; return n; }
  // Why one cannot go on a tile ('' it can)
  why(tx, ty) {
    const w = this.game.world, key = `${tx},${ty}`;
    if (this.at(key)) return 'taken';
    const x = tx + 0.5, y = ty + 0.5;
    if (!FW.waterType(w, x, y)) return 'land';
    if (!((w.waterDepth?.(x, y) || 0) >= MIN_DEPTH)) return 'shallow';
    const W = waterAt(w, tx, ty);
    return lives(W) ? '' : 'nothing';
  }
  // (whoever decides) n were caught there: its cell has fewer
  fished(key, n) {
    const at = tileOf(key);
    if (!(n > 0) || !at) return;
    const x = at[0] + 0.5, y = at[1] + 0.5, water = FW.waterType(this.game.world, x, y);
    if (water) FW.takeFrom(this.game.world, x, y, water, this.game.days.realDay, n);
  }
  // live.js, a guest's changes of a chunk: the traps are only whoever decides'
  arbitrate(k, ops) {
    if (!ops.some(([f]) => f === 'traps')) return null;
    const cur = this.game.world.deltas.get(k)?.traps || {}, back = [];
    const ok = ops.filter(([f, c]) => {
      if (f !== 'traps') return true;
      back.push(typeof c !== 'string' ? ['traps', null, structuredClone(cur)] : cur[c] === undefined ? ['traps', c] : ['traps', c, structuredClone(cur[c])]);
      return false;
    });
    return { ok, back };
  }

  // ---------- the bait ----------
  // The one that would go in now: the one chosen with the rod's R, or the first real one at hand; never a lure
  bait() {
    const F = this.game.fishing, b = F?.bait;
    if (!F) return null;
    if (b?.id && baitOk(b.id)) return b;
    return F.chosen === '' ? null : F.baits().find(q => q.use && baitOk(q.id) && (q.id !== 'cut_bait' || this.game.inv.count('cut_bait') > 0)) || null;
  }
  // R with the trap in the hand: the next bait that goes in one (with Shift, the one before), and none
  cycle(dir = 1) {
    const F = this.game.fishing, seen = new Set(), list = F.baits().filter(b => baitOk(b.id) && !seen.has(b.id) && seen.add(b.id));
    const keys = [...list.map(b => b.key), ''], now = this.bait(), i = keys.findIndex(k => k === (now ? list.find(b => b.id === now.id)?.key : ''));
    F.chosen = keys[(Math.max(0, i) + dir + keys.length) % keys.length];
    this.said = '';
    Audio.tick();
  }
  baitText() { const b = this.bait(); return b ? t('fish.bait', { item: itemNoun(b.id), n: this.game.fishing.left(b.id) }) : t('fish.no_bait'); }
  // One of it out of the backpack now; back if the answer is no
  payBait() {
    const b = this.bait(), g = this.game;
    if (!b) return '';
    g.fishing.prepare(b);
    if (!g.inv.count(b.id)) return '';
    g.fishing.spendBait(b.id);
    return b.id;
  }
  refund(id) { if (id && !this.game.inv.infinite) this.give(id, 1); }

  // ---------- setting it ----------
  holding(held) { return held?.id === 'fish_trap'; }
  // Where it would go: the water under the cursor, or (with no mouse) the first ahead; { tx, ty, far }
  spot(p) {
    const g = this.game, m = g.mouse;
    if (m?.in && g.view3d?.rayAt) {
      const ray = g.rayNow ? g.rayNow() : g.view3d.rayAt(m.x, m.y);
      if (!ray || !(ray.d[1] < -1e-3) || !(ray.o[1] > WATER_Y)) return null;
      const s = (WATER_Y - ray.o[1]) / ray.d[1], tx = Math.floor(ray.o[0] + ray.d[0] * s), ty = Math.floor(ray.o[2] + ray.d[2] * s), r = Math.hypot(tx + 0.5 - p.x, ty + 0.5 - p.y);
      return r < 8 ? { tx, ty, far: r > REACH } : null;
    }
    const f = p.face;
    for (let r = 0.6; r <= REACH + 0.4; r += 0.3) { const tx = Math.floor(p.x + f.x * r), ty = Math.floor(p.y + f.y * r); if (Math.hypot(tx + 0.5 - p.x, ty + 0.5 - p.y) <= REACH && (this.game.world.waterDepth(tx + 0.5, ty + 0.5) || 0) >= MIN_DEPTH) return { tx, ty, far: false }; }
    return null;
  }
  target(p, held, def) {   // (the hook of gather.js: three parameters, as the others)
    if (!this.holding(held) || this.game.scene !== this.game.world || p.swim || p.pose) return null;
    const q = this.spot(p);
    if (!q) return null;
    const key = keyOf(q.tx, q.ty), memo = this.memo;
    const no = memo?.key === key && memo.v === this.v && memo.touches === this.game.world.touches ? memo.why : (this.memo = { key, v: this.v, touches: this.game.world.touches, why: this.why(wrapX(q.tx), q.ty) }).why;
    if (no === 'land') return null;
    if (q.far || no) return { tile: null, ok: false, label: t(`trap.why.${q.far ? 'far' : no}`) };
    return { tile: [q.tx, q.ty], ok: true, trap: true, label: t('trap.set'), use: () => this.set(wrapX(q.tx), q.ty) };
  }
  set(tx, ty) {
    const g = this.game, I = g.inv, key = `${tx},${ty}`;
    g.gather.cooldown = 0.4;
    if (this.asked.has(key) || !this.holding(I.held)) return;
    if (this.outOf(me()) >= MAX) { this.say('max'); return; }
    const bait = this.payBait(), inf = I.infinite;
    if (!inf) I.remove('fish_trap', 1);
    g.gather.swing = 0.25; g.gather.swingItem = 'fish_trap';
    Audio.swish();
    this.ask('trap_set', key, { bait }, (ok, v) => {
      if (!ok) { this.refund(bait); if (!inf) this.give('fish_trap', 1); this.say(v?.why || 'no_answer'); return; }
      const x = nearX(tx + 0.5, g.player?.x ?? tx), y = ty + 0.5;
      Audio.splash(); g.gather.chips(x, y, 'water', 12); g.view3d?.fx?.rippleAt?.(x, y, 1.1, 0.7);
      if (!bait) g.gather.float(t('trap.unbaited'), '#ffd0a0');
      g.stats?.add('nasas', 1);
      g.onSave?.();
    });
  }
  // Asks whoever decides (this game, or the host through a claim): done(ok, its answer)
  ask(kind, key, data, done) {
    const g = this.game, w = g.world, at = tileOf(key), k = chunkOf(at), B = g.barrow;
    if (this.decides()) {
      const extra = {}, d = w.delta(Math.floor(at[0] / CHUNK), Math.floor(at[1] / CHUNK), true);
      let ok = false;
      try { ok = !!CLAIMS[kind](g, { by: me(), k: kind, key, ...data }, d, k, extra); } catch (e) { reportFault(e, 'Traps.ask'); }
      if (ok) w.note(Math.floor(at[0] / CHUNK), Math.floor(at[1] / CHUNK));
      this.look(true);
      done(ok, extra);
      return;
    }
    this.asked.set(key, g.time);
    B.claim(kind, k, { key, ...data }, v => { this.asked.delete(key); if (this.game.world !== w || !this.game.player) return; this.look(true); done(!!v?.ok, v); });
  }
  say(why) { this.game.gather.float(t(`trap.${why === 'land' || why === 'shallow' || why === 'nothing' || why === 'taken' || why === 'far' ? 'why.' : ''}${why}`), '#ffb0a0'); Audio.error(); }

  // ---------- the buoy ----------
  // Those in reach of p
  reachable(p) {
    const g = this.game, out = [];
    if (!p || g.scene !== g.world || !this.near.length) return out;
    for (const e of this.near) { const x = nearX(e.x, p.x); if (Math.abs(x - p.x) < 4 && Math.abs(e.y - p.y) < 4) out.push(e); }
    return out;
  }
  aimables(p, sc, box) {
    if (sc !== this.game.world || !this.near.length) return null;
    const list = this.reachable(p);
    if (!list.length) return null;
    const out = [], view = this.game.view3d;
    for (const e of list) {
      const x = nearX(e.x, p.x), b = box(x, e.y, 0.32, 0.32, WATER_Y - 0.12, WATER_Y + 0.34);
      b.abs = true;
      out.push({ kind: 'sys', trap: e.key, box: b, act: () => this.offer(e) });
      // (under water, the creel itself on the bed)
      if (p.swim && Math.abs((this.game.dive?.diverY(p) ?? WATER_Y) - (WATER_Y - e.depth)) < 2) {
        const bed = view?.bedY?.(x + e.cx, e.y + e.cy), y0 = Number.isFinite(bed) ? bed : WATER_Y - e.depth, c = box(x + e.cx, e.y + e.cy, 0.34, 0.34, y0, y0 + 0.42);
        c.abs = true;
        out.push({ kind: 'sys', trap: e.key, creel: true, box: c, act: () => this.offer(e) });
      }
    }
    return out;
  }
  // E from a boat, where E is usually the boat's (game.js nearest): only the one aimed at
  boatAction() { const a = this.near.length ? this.game.aimed() : null; return a?.trap ? this.game.actionFor(a) : null; }
  // Without a mouse: the nearest within reach
  interact(p, sc) {
    if (sc !== this.game.world || p.swim) return null;
    let best = null, bd = REACH;
    for (const e of this.reachable(p)) { const d = Math.hypot(nearX(e.x, p.x) - p.x, e.y - p.y); if (d < bd) { bd = d; best = e; } }
    return best && this.offer(best);
  }
  offer(e) {
    const r = this.at(e.key);
    if (!r) return null;
    if (this.asked.has(e.key)) return { text: t('trap.wait'), run: () => {} };
    if (!this.may(r)) { const who = this.game.live?.nameOf?.(r[0]); return { text: who ? t('trap.of', { name: who }) : t('trap.of_other'), run: () => this.say('not_yours') }; }
    const b = this.bait(), act = { text: b ? t('trap.empty_bait', { item: itemNoun(b.id) }) : t('trap.empty'), run: () => this.haul(e.key) };
    act.alt = { text: t('trap.take'), hold: HOLD_X, run: () => this.take(e.key) };
    return act;
  }
  may(r) { return owns(r, me()) || !!this.game.social?.isPartnerId?.(r[0]) || areCouple(this.game.family?.v, r[0], me()); }
  haul(key) {
    const g = this.game, r = this.at(key);
    if (!r || this.asked.has(key) || g.carry?.refuse?.('boat')) return;
    g.gather.swing = 0.25; g.gather.swingItem = null;
    // (the bait leaves the backpack first: nothing in it yet, or somebody was quicker, it comes back)
    const bait = this.payBait();
    Audio.reel(0.3);
    this.ask('trap', key, { set: r[2], bait }, (ok, v) => {
      if (!ok) { this.refund(bait); this.refusal(key, v); return; }
      this.got(key, v, bait);
    });
  }
  take(key) {
    const g = this.game, r = this.at(key);
    if (!r || this.asked.has(key) || !this.may(r) || g.carry?.refuse?.('boat')) return;
    this.ask('trap_take', key, { set: r[2] }, (ok, v) => {
      if (!ok) { this.refusal(key, v); return; }
      this.got(key, v, '', true);
      this.give('fish_trap', 1);
      g.onSave?.();
    });
  }
  refusal(key, v) {
    if (v?.why === 'none') { this.splash(key, 0.6); this.game.gather.float(t(this.at(key)?.[1] ? 'trap.none' : 'trap.none_bare'), '#ffd0a0'); Audio.plop(); try { this.game.view3d?.world?.traps?.haul?.(key, []); } catch (e) { reportFault(e, 'TrapsView.haul'); } return; }
    this.say(v?.why || 'no_answer');
  }
  splash(key, k = 1) {
    const at = tileOf(key), g = this.game, x = nearX(at[0] + 0.5, g.player?.x ?? at[0]), y = at[1] + 0.5;
    g.gather.chips(x, y, 'water', Math.round(10 * k)); g.view3d?.fx?.rippleAt?.(x, y, 0.8 + 0.5 * k, 0.6);
  }
  // What was in it, to the backpack (what does not fit, at your feet). In the log and the books like any other catch; no record:
  // those are of the line
  got(key, v, bait, gone = false) {
    const g = this.game, F = g.fishing, n = Number.isInteger(v?.n) ? clamp(v.n, 0, FULL) : 0;
    const list = n && Number.isFinite(v.set) ? catchOf(g, key, v.set, typeof v.bait0 === 'string' ? v.bait0 : '', n) : [], day = g.days.realDay, at = tileOf(key), water = FW.waterType(g.world, at[0] + 0.5, at[1] + 0.5) || '';
    this.splash(key, 1);
    Audio.trapRattle(list.length);
    try { g.view3d?.world?.traps?.haul?.(key, list, gone); } catch (e) { reportFault(e, 'TrapsView.haul'); }
    let xp = 0;
    for (const c of list) {
      this.give(c.id, 1, { g: c.g, day });
      F.log.n[c.id] = (F.log.n[c.id] || 0) + 1;
      F.log.last.unshift([c.id, Math.round(c.cm), c.g, day, water]);
      const fresh = !!g.collection && !g.collection.got.has(c.id);
      g.collection?.found(c.id); g.nature?.harvested(c.id, 1, fresh);
      g.stats?.add('peces', 1);
      xp += Math.round(2 + FISH[c.id].dif * 5);
    }
    F.log.last.length = Math.min(20, F.log.last.length);
    if (xp) g.skills?.gain('pesca', xp);
    if (!list.length) g.gather.float(t(gone ? 'trap.none' : 'trap.baited', { item: bait ? itemNoun(bait) : undefined }), '#cfe8c0');
    else if (!bait && !gone) g.gather.float(t('trap.no_bait_left'), '#ffd0a0');
    g.onSave?.();
  }
  give(id, n, extra) {
    const g = this.game, left = g.inv.add(id, n, extra);
    for (let i = left; i < n; i++) g.gather?.collected?.(id);
    if (left > 0) g.gather?.throwOut?.(id, left, extra);
  }

  // The click hint with the trap in the hand: where it goes, and its bait with its key
  hint() {
    const g = this.game, T = g.gather.target;
    if (!T?.trap || !T.label || g.mode !== 'play' || g.busy || g.player?.swim || g.build.on || !this.holding(g.inv.held)) return '';
    const key = `${T.label}|${g.fishing.chosen}|${g.inv.v}|${getLang()}`;
    if (this.said !== key) { const text2 = this.baitText(); this.said = key; this.hinted = { text: T.label, key2: 'R', text2, all: `${T.label} ${text2}` }; }
    return this.hinted;
  }
  ownsR() { const g = this.game, p = g.player; return !!p && !g.build.on && this.holding(g.inv.held) && g.scene === this.game.world && !p.swim && !g.busy && !hud.dialogOpen; }

  // ---------- each step ----------
  update(dt) {
    if ((this.acc -= dt) > 0) return;
    this.acc = SCAN;
    this.look();
    if (this.asked.size) for (const [k, at] of this.asked) if (this.game.time - at > 60) this.asked.delete(k);
  }
  // The traps of the chunks round the player (looked at twice a second; made again only when they change)
  look(now = false) {
    const g = this.game, w = g.world, p = g.player;
    if (now) this.acc = SCAN;
    if (!p || !w || Profile.server || g.scene !== w) { if (this.near.length) { this.near = []; this.sig = ''; this.v++; } return; }
    const cx = Math.floor(p.x / CHUNK), cy = Math.floor(p.y / CHUNK);
    let sig = '';
    for (let j = -NEAR; j <= NEAR; j++) for (let i = -NEAR; i <= NEAR; i++) {
      const d = w.deltas.get(`${wrapIndex(cx + i, CHUNK)},${cy + j}`);
      if (d?.traps) for (const k in d.traps) if (isRec(d.traps[k])) sig += k + ';';
    }
    if (sig) sig += w.touches;   // (the water under them may have changed)
    if (sig === this.sig && this.world === w) return;
    this.sig = sig; this.world = w; this.v++;
    this.near = [];
    for (const k of sig.split(';')) {
      const at = tileOf(k);
      if (!at) continue;
      const [tx, ty] = at, x = tx + 0.5, y = ty + 0.5, a = ihash(tx, ty, 77) * Math.PI * 2;
      this.near.push({ key: k, x, y, depth: FW.bedDepth(w, x, y), wet: !!FW.waterType(w, x, y), yaw: a, cx: Math.sin(a) * 0.3, cy: Math.cos(a) * 0.3 });
    }
  }
  // The player's and their couple's, everywhere they are known (looked for every couple of seconds at most: the map, the diary)
  mine() {
    const g = this.game, w = g.world, now = performance.now();
    if (this.mineW === w && Math.abs(now - this.mineAt) < 2000) return this.mineList;
    this.mineAt = now; this.mineW = w; this.mineList = [];
    for (const d of w.deltas.values()) if (isMap(d?.traps)) for (const k in d.traps) {
      const r = d.traps[k], at = tileOf(k);
      if (at && isRec(r) && this.may(r)) this.mineList.push({ key: k, x: at[0] + 0.5, y: at[1] + 0.5, own: owns(r, me()), bait: r[1], set: r[2] });
    }
    return this.mineList;
  }
  // (the angler's log, fishing.js journal)
  journal() {
    const l = this.mine();
    if (!l.length) return '';
    const row = e => {
      const water = FW.waterType(this.game.world, e.x, e.y), h = Math.max(0, Math.floor((this.now() - e.set) / HOUR));
      return `<div class="j-fish"><span class="j-cell done"><img alt="" data-icon="fish_trap"></span><span><b>${water ? t('nature.water.' + water) : ''}</b><small>${e.bait ? t('fish.log.bait', { item: itemNoun(e.bait) }) : t('fish.no_bait')}${e.own ? '' : ' · ' + t('trap.log.partner')}</small></span><span class="lvl">${h < 1 ? t('trap.log.now') : t('trap.log.hours', { n: h })}</span></div>`;
    };
    return `<h3>${t('trap.log.title', { n: l.filter(e => e.own).length, max: MAX })}</h3>${l.sort((a, b) => a.set - b.set).map(row).join('')}`;
  }
}
