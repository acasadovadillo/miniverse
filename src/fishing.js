// Fishing: with the rod in hand, aim at the water and click: the float goes there (6 m with the cane rod, 9 m with the
// fibre one). Then you watch it. Now and then it trembles and it is nothing (a small fish pecking: pulling then scares them
// off, and now and then one steals the bait); when something bites, each kind does it its own way (BITES): two dips and
// under, a slow run, a lift, gone at once, a string of taps and a steady pull. A click (or Space) in its window strikes.
// The fight plays out by itself (no bars, no timing game): the rod bends, the reel ticks, and the line holds or breaks by
// the weight of the fish. On the bank, a card says what it is: E keeps it, X held lets it go.
// What bites, and how soon, is the water's word (fishwater.js): its kind and depth, the spot, the light, the season, the
// water's temperature, the weather and how fished-out that spot is.
//
//   state   null, or { phase: 'wait' | 'bite' | 'fight', t, fly, nib, bx, by, px, py, ctx, rate, … }: what
//           three/fishing3d.js draws (bite: the profile; bt: s in the bite; ex, ey: the end of the line in the fight; load)
//   card    null, or the fish in the hands { id, cm, kg, g, rec, trophy, t }, which ui/fishcard.js shows
//   records, log   the largest of each (cm; older games read it), and cm, g, the day and the water of it, the counts and the last ones
import { FISH, ITEMS } from './items.js';
import { WATER_Y } from './world/biomes.js';
import { Audio } from './audio.js';
import { Profile } from './accounts.js';
import { hud } from './ui/hud.js';
import { nearX } from './world/planet.js';
import { t as tr, has, fmt } from './i18n.js';
import * as FW from './fishwater.js';
import { HOLD_X } from './input.js';

export const MIN_CAST = 1.2, REACH = { 1: 6, 2: 9 };      // tiles: the least, and how far each rod throws
const LINE_KG = { 1: 5, 2: 12 }, SEDAL_KG = 2;            // kg the line holds; Lía's good line (her gift at three hearts) adds
const ROD_K = { 1: 1, 2: 1.15 };                          // how the rod changes the rate
const NIB = 0.3, NIB_GAP = [4, 10], STEAL = 0.06, SPOOK = { r: 3, s: 30, k: 1.5 };
const KEEP_S = 5, BIG = 2.5;                              // s the card stays; kg from which it can slip off at a steep bank
const FIND = 0.03, RARE = 0.04, TAP = 0.4;
// How each kind takes the float. pre: s of warning before it can be struck (pulling then is too soon), win: s to strike
export const BITES = { dip: { pre: 0.6, win: 0.7 }, run: { pre: 0, win: 2 }, lift: { pre: 0.4, win: 1.5 }, slam: { pre: 0, win: 1 }, taps: { pre: 0, win: 1.2 } };
export const BITE_IDS = ['dip', 'run', 'lift', 'slam', 'taps'];
const PHASES = { wait: 1, bite: 2, fight: 3 };
const kgClass = kg => (kg < 0.5 ? 0 : kg < 2.5 ? 1 : kg < 8 ? 2 : 3);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = v => Math.round(v * 100) / 100;
const seasonNames = list => list.map(s => tr('nature.season.' + s));
export const fishName = id => (has(`nature.name.${id}`) ? tr(`nature.name.${id}`) : ITEMS[id]?.name || id);
export const kgText = kg => fmt.num(kg, { maximumFractionDigits: kg < 1 ? 2 : 1 });
// P(the line breaks) for what the fish pulls over what it holds (o)
export const breakP = o => (o <= 0.8 ? 0 : o <= 2.5 ? (o - 0.8) * 0.22 : Math.min(0.92, 0.374 + (o - 2.5) * 0.25));
export const fightS = (kg, pull) => clamp(1.5 + 2.2 * Math.sqrt(kg) * pull, 1.5, 22);

export class Fishing {
  constructor(game) {
    this.game = game;
    this.reset(null);
    if (typeof addEventListener === 'function') addEventListener('keyup', e => { if (this.card && (e.code === 'KeyX' || e.code === 'Delete' || e.code === 'Backspace')) this.card.x0 = null; });
  }
  get world() { return this.game.world; }
  reset(save) {
    this.state = null; this.card = null;
    this.spooks = [];
    this.riseT = 5; this.rise2 = null;
    this.records = save?.fishRecords || {};
    // (a save from before the log: its record lengths, their weight worked out)
    const L = save?.fishLog, ok = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    this.log = { v: 1, rec: { ...ok(L?.rec) }, n: { ...ok(L?.n) }, last: Array.isArray(L?.last) ? L.last.slice(0, 20) : [] };
    for (const [id, r] of Object.entries(this.log.rec)) if (!Array.isArray(r) || !Number.isFinite(r[0])) delete this.log.rec[id];
    for (const [id, cm] of Object.entries(this.records)) if (FISH[id] && Number.isFinite(cm) && !(this.log.rec[id]?.[0] >= cm)) this.log.rec[id] = [cm, Math.round(FW.kgOf(FISH[id], cm) * 1000), 0, ''];
  }
  save(out) { out.fishRecords = this.records; out.fishLog = this.log; }

  // ---------- the rod ----------
  get tier() { return ITEMS[this.game.inv.held?.id]?.tier > 1 ? 2 : 1; }
  get reach() { return REACH[this.tier]; }
  get level() { return this.game.skills?.level('pesca') || 0; }
  get lineKg() { return LINE_KG[this.tier] + (this.game.neighbors?.flags?.sedal ? SEDAL_KG : 0) + 0.3 * this.level; }
  // Sitting on the ground, a chair or a stool (never lying or in the tub): the rod, and only the rod, works (gather.js use)
  seated(p) { return !!p?.pose && (p.pose.kind === 'floorSit' || p.pose.kind === 'sit') && !p.bathing; }

  canUse(p) { return this.seated(p) && ITEMS[this.game.inv.held?.id]?.tool === 'cana'; }

  waterType(x, y) { return FW.waterType(this.world, x, y); }
  // Where a cast would go: the water under the cursor (the camera's ray on the water's plane), or { far: true } if it is
  // water but out of reach; with no mouse, the water ahead, off the edge. null: nowhere
  aimSpot(p) {
    const g = this.game, m = g.mouse, R = this.reach;
    if (m?.in && g.view3d?.rayAt) {
      if (this.aim?.frame === g.frameNo && this.aim.R === R) return this.aim.hit;
      let hit = null;
      const ray = g.rayNow ? g.rayNow() : g.view3d.rayAt(m.x, m.y);
      if (ray && ray.d[1] < -1e-3 && ray.o[1] > WATER_Y) {
        const s = (WATER_Y - ray.o[1]) / ray.d[1], x = ray.o[0] + ray.d[0] * s, y = ray.o[2] + ray.d[2] * s, r = Math.hypot(x - p.x, y - p.y);
        if (r < 40) { const water = this.waterType(x, y); if (water) hit = this.canCast(p, x, y, r) ? { x, y, r, water } : r > R ? { far: true, water } : null; }
      }
      this.aim = { frame: g.frameNo, R, hit };
      return hit;
    }
    const f = this.seated(p) ? { x: Math.sin(p.pose.yaw), y: Math.cos(p.pose.yaw) } : p.face;
    let hit = null;
    for (let r = MIN_CAST; r <= R && r <= 4.5; r += 0.3) {
      const x = p.x + f.x * r, y = p.y + f.y * r, water = this.waterType(x, y);
      if (water && this.canCast(p, x, y, r)) hit = { x, y, r, water };
      else if (hit) break;
    }
    return hit;
  }
  canCast(p, x, y, r) {
    if (r < MIN_CAST || r > this.reach) return false;
    if (this.seated(p) && Math.sin(p.pose.yaw) * (x - p.x) + Math.cos(p.pose.yaw) * (y - p.y) < 0.25 * r) return false;   // (seated, ahead)
    return !this.world.reaches || this.world.reaches(p.x, p.y, x, y);
  }

  target(p, held, def) {
    if (def?.tool !== 'cana' || this.game.scene !== this.world || p.swim || (p.pose && !this.seated(p))) return null;
    const s = this.state;
    // (biting or fighting, no words: the float says it)
    if (s) return { tile: null, ok: true, still: true, label: s.phase === 'wait' && s.fly === 1 ? tr('fish.reel') : '', use: () => this.press() };
    const spot = this.aimSpot(p);
    if (!spot) return null;
    return spot.far ? { tile: null, ok: false, label: tr('fish.too_far') } : { tile: null, ok: true, label: this.card ? '' : tr(`fish.in.${spot.water}`), use: () => this.press() };
  }

  // A click: cast, reel in, or strike
  press() {
    const g = this.game, s = this.state;
    g.gather.cooldown = 0.3;
    if (this.card) this.keep();
    if (!s) return this.cast();
    if (s.phase === 'bite') return this.strike();
    if (s.phase !== 'wait') return;
    if (s.fly === 1 && s.nib > -0.35) return this.nothing();   // (it was only pecking)
    this.state = null; Audio.swish(); Audio.reel(0.5);
  }
  // Space strikes too
  space() {
    if (this.state?.phase !== 'bite') return false;
    this.strike();
    return true;
  }

  cast() {
    const g = this.game, p = g.player, held = g.inv.held, spot = this.aimSpot(p);
    if (!spot || spot.far || !g.gather.spend('cana')) return;
    g.gather.swing = 0.25; g.gather.swingItem = held.id;
    Audio.swish();
    if (!p.pose && !p.boat && !p.aboard && !p.mount && spot.r > 0.1) p.face = { x: (spot.x - p.x) / spot.r, y: (spot.y - p.y) / spot.r };
    const ctx = FW.here(g, spot.x, spot.y, ROD_K[this.tier]), rate = ctx ? FW.rates(ctx) : 0;
    let wait = FW.waitFor(rate);
    const now = g.time;
    this.spooks = this.spooks.filter(q => q.until > now);
    if (this.spooks.some(q => Math.hypot(q.x - spot.x, q.y - spot.y) < SPOOK.r)) wait *= SPOOK.k;
    this.state = { phase: 'wait', t: wait, rate, ctx, nib: -9, next: this.nibGap(rate), bare: false, fly: 0, bx: spot.x, by: spot.y, px: p.x, py: p.y, water: spot.water };
  }
  nibGap(rate) { return (NIB_GAP[0] + Math.random() * (NIB_GAP[1] - NIB_GAP[0])) / clamp(rate, 0.5, 2); }   // (a busy float: a good spot)

  // Pulled on nothing: those round the float are scared off for a while
  nothing() {
    const s = this.state;
    this.spooks.push({ x: s.bx, y: s.by, until: this.game.time + SPOOK.s });
    if (this.spooks.length > 6) this.spooks.shift();
    this.lose(tr('fish.nothing'));
    Audio.reel(0.5);
  }

  // Which fish takes it (or a find: an old boot…), and how
  pick(ctx) {
    if (!(FW.rates(ctx) > 0)) return null;
    if (FISH.pez_dorado.water.includes(ctx.water) && Math.random() < RARE + (this.game.skills?.bonus('pesca') || 0) * 0.1) return 'pez_dorado';   // (as always: 4 %, and a little more with the skill)
    return FW.pickFish(ctx);
  }
  bite() {
    const s = this.state, id = this.pick(s.ctx);
    if (!id) { s.t = Infinity; return; }
    s.phase = 'bite'; s.bt = 0; s.id = id;
    s.find = Math.random() < FIND;
    s.bite = id === 'carpa' && Math.random() < 0.3 ? 'lift' : FISH[id].bite || 'dip';   // (a carp on a float sometimes lifts it)
    s.taps = s.bite === 'taps' ? 3 + Math.floor(Math.random() * 4) : 0;
    s.pre = s.taps ? s.taps * TAP : BITES[s.bite].pre;
    s.win = BITES[s.bite].win + (this.tier > 1 ? 0.15 : 0) + 0.02 * this.level;
    s.side = Math.random() < 0.5 ? -1 : 1;
    s.sound = -1;
    if (s.bite === 'slam') this.bob(true);
  }
  // (a real bite, from fishing level 4, is heard a little lower than a nibble: something learnt)
  bob(deep = false) {
    if (deep) Audio.bob(this.level >= 4); else Audio.nibble();
    const s = this.state;
    if (deep && s) this.game.gather.chips(s.bx, s.by, 'water', 4);
  }
  strike() {
    const s = this.state, g = this.game;
    g.gather.cooldown = 0.3;
    g.gather.swing = 0.25; g.gather.swingItem = g.inv.held?.id;
    if (s.bt < s.pre) return this.nothing();
    const q = clamp(1 - (s.bt - s.pre) / s.win, 0, 1);
    if (Math.random() > Math.min(0.97, 0.72 + 0.24 * q + 0.02 * this.level)) return this.lose(tr('fish.spat'));
    this.hook();
  }
  // Hooked: its length and weight, how long it fights and whether the line will break (and when)
  hook(size = null) {
    const s = this.state, f = FISH[s.id], z = size || FW.sizeOf(f, this.level, s.bare);
    const kg = s.find ? 0.4 : FW.kgOf(f, z.cm), o = (kg * (s.find ? 0.6 : f.pull || 1)) / this.lineKg;
    Object.assign(s, { phase: 'fight', cm: Math.round(z.cm), kg, trophy: !s.find && z.trophy, ft: 0, T: s.find ? 1.2 : fightS(kg, f.pull || 1), load: clamp(0.15 + 0.5 * o, 0.15, 1), run: 0, click: 0, splash: 0.6, ph: Math.random() * 6 });
    s.breakAt = Math.random() < breakP(o) ? s.T * (0.5 + 0.5 * Math.random()) : Infinity;
    // (where it is brought in to: the last water between the float and the player)
    const p = this.game.player, dx = p.x - s.bx, dy = p.y - s.by, L = Math.hypot(dx, dy) || 1;
    let hx = s.bx, hy = s.by;
    for (let r = 0.3; r < L - 0.5; r += 0.3) { const x = s.bx + (dx / L) * r, y = s.by + (dy / L) * r; if (!this.waterType(x, y)) break; hx = x; hy = y; }
    Object.assign(s, { hx, hy, ex: s.bx, ey: s.by, nx: -dy / L, ny: dx / L });
    Audio.splash(); this.game.gather.chips(s.bx, s.by, 'water', 8);
  }
  fight(dt) {
    const s = this.state, g = this.game, p = g.player, far = Math.hypot(p.x - s.px, p.y - s.py);
    s.ft += dt;
    if (s.ft >= s.breakAt) return this.snap();
    if (!p.boat && !p.aboard && far > 1.2) return this.snap();
    const k = Math.min(1, s.ft / s.T);
    // (it comes in little by little, running back out and to the sides; the harder, the heavier)
    const wild = 0.35 + 0.65 * s.load, q = s.ft * (1.6 + 0.5 * wild) + s.ph;
    s.run = Math.max(0, Math.sin(q)) * wild * (1 - k);            // (0-1: how hard it pulls out now, for the rod and the reel)
    const e = clamp(k * k * (3 - 2 * k) - 0.18 * s.run, 0, 1), side = Math.sin(s.ft * 1.7 + s.ph * 2) * (0.5 + 1.5 * s.load) * (1 - k) * Math.min(1, s.ft);
    s.ex = s.bx + (s.hx - s.bx) * e + s.nx * side; s.ey = s.by + (s.hy - s.by) * e + s.ny * side;
    if ((s.click -= dt) <= 0) { s.click = 0.16 - 0.1 * s.run; Audio.reel(0.4 + 0.6 * s.run); }
    if (s.breakAt < Infinity && s.breakAt - s.ft < 1.2 && !s.cry) { s.cry = true; Audio.lineCry(s.breakAt - s.ft); }
    if ((s.splash -= dt) <= 0) { s.splash = 1 + Math.random() * 2.2; this.splashAt(s.ex, s.ey, 0.5 + s.load * 0.5); }
    if (s.ft >= s.T) this.bank();
  }
  splashAt(x, y, k) {
    const g = this.game;
    g.gather.chips(x, y, 'water', Math.round(4 + 8 * k));
    g.view3d?.fx?.rippleAt?.(x, y, 0.6 + 0.7 * k, 0.5);
    if (k > 0.7) Audio.splash(); else Audio.plop();
  }
  snap() { Audio.lineSnap(); this.lose(tr('fish.broke')); }
  // At the bank: from a steep one, or where it is deep at your feet, a big fish can still slip off (a boat or a shelving
  // shore is the way to land it)
  steep() {
    const g = this.game, p = g.player, s = this.state;
    if (p.boat || p.aboard || p.depth > 0.05) return false;
    const up = (g.view3d?.groundY?.(this.world, p.x, p.y) ?? WATER_Y) + (p.floor || 0) - WATER_Y;
    return up > 0.5 || FW.bedDepth(this.world, s.hx, s.hy) > 0.8;
  }
  bank() {
    const s = this.state, g = this.game;
    if (s.find) return this.found();
    if (s.kg > BIG && this.steep() && Math.random() < 0.25) return this.lose(tr('fish.slipped'));
    this.splashAt(s.ex, s.ey, 1);
    this.state = null;
    this.landed({ id: s.id, cm: s.cm, kg: s.kg, trophy: s.trophy, water: s.water, x: s.bx, y: s.by });
  }
  // Something that is not a fish: an old boot, a bottle; now and then an old coin
  found() {
    const g = this.game, r = Math.random();
    this.state = null;
    if (r < 0.35) { this.jump('moneda_antigua'); g.stats?.add('tesoros', 1); g.gather.float(tr('fish.find.coin'), '#ffd77a'); Audio.pickup(); }
    else g.gather.float(tr(r < 0.7 ? 'fish.find.boot' : 'fish.find.bottle'), '#cfd8dc');
  }

  // ---------- the catch ----------
  landed({ id, cm, kg, trophy = false, water = '', x, y }) {
    const g = this.game, f = FISH[id], grams = Math.max(1, Math.round(kg * 1000)), day = g.days.realDay, best = this.records[id] || 0, rec = cm > best;
    if (rec) { this.records[id] = cm; this.log.rec[id] = [cm, grams, day, water]; }
    this.log.n[id] = (this.log.n[id] || 0) + 1;
    this.log.last.unshift([id, cm, grams, day, water]); this.log.last.length = Math.min(20, this.log.last.length);
    if (this.card) this.keep();
    this.card = { id, cm, kg, g: grams, rec: rec && best > 0, trophy, water, x, y, t: 0, x0: null, xp: 3 * Math.round(3 + f.dif * 9 + Math.min(10, kg)) };   // (×3: a fish takes several times longer than before)
    Audio.unlock();
    if (this.card.rec) hud.big({ title: fishName(id), sub: `${tr('fish.record')} · ${tr('fish.card', { cm, kg: kgText(kg) })}` });
    g.gather.cooldown = 0.3;
    g.stats?.add('peces', 1);
    g.xp?.add(1 + Math.floor(Math.random() * 6));
    const fresh = !!g.collection && !g.collection.got.has(id);   // (Collections' "new" toast wins over the book's message)
    g.collection?.found(id);
    g.nature?.harvested(id, 1, fresh);   // (the nature book: Studied, five catches Known)
    // (a record or a trophy is told to the others: heard)
    if ((this.card.rec || trophy) && !Profile.server && g.live?.joined) g.live.net?.send({ t: 'catch', id, cm, g: grams, rec: this.card.rec ? 1 : 0 });
  }
  // E, a click, walking off or a few seconds: it goes in the backpack. Returns whether there was one
  keep() {
    const c = this.card, g = this.game;
    if (!c) return false;
    this.card = null;
    this.jump(c.id);
    g.skills?.gain('pesca', c.xp);
    this.tire(c, 1);
    return true;
  }
  // X held: back in the water. Half the practice, and the spot keeps it (a little wiser)
  release() {
    const c = this.card, g = this.game;
    if (!c) return false;
    this.card = null;
    g.skills?.gain('pesca', Math.max(1, Math.round(c.xp / 2)));
    this.tire(c, 0.3);
    g.stats?.add('soltados', 1);
    g.gather.float(tr('fish.released'), '#9ad0ff');
    if (Number.isFinite(c.x)) this.splashAt(c.x, c.y, 0.5); else Audio.plop();
    return true;
  }
  tire(c, n) { if (c.water && Number.isFinite(c.x)) FW.takeFrom(this.world, c.x, c.y, c.water, this.game.days.realDay, n); }
  // X pressed with the card up (game.altAction): held from now on. Returns whether it is the card's
  holdX() {
    if (!this.card) return false;
    this.card.x0 = performance.now();
    return true;
  }
  // It falls at the player's side and goes to the backpack by itself
  jump(id) {
    const g = this.game;
    g.gather.drops.push({ id, x: g.player.x + (Math.random() - 0.5) * 0.4, y: g.player.y + 0.2, z: 14, vz: 70 + Math.random() * 20, t: 0.2, scene: g.scene });
  }
  lose(text) {
    if (text) { this.game.gather.float(text, '#ffb0a0'); Audio.error(); }
    this.state = null;
  }

  // ---------- each step ----------
  update(dt) {
    const s = this.state, g = this.game, p = g.player, c = this.card;
    if (!p) return;
    if (c) {
      c.t += dt;
      if (c.x0 !== null && performance.now() - c.x0 >= HOLD_X * 1000) this.release();
      else if ((c.t > KEEP_S && c.x0 === null) || c.t > KEEP_S + 2 || g.scene !== this.world || (c.t > 0.6 && !p.pose && Math.hypot(p.vx || 0, p.vy || 0) > 1 && !p.boat && !p.aboard)) this.keep();
    }
    this.rises(dt, p);
    if (!s) return;
    // Another thing in the hand, another place or the water: the line is let go; walking reels it in (fighting, it breaks)
    if (ITEMS[g.inv.held?.id]?.tool !== 'cana' || g.scene !== this.world || p.swim) { if (s.phase === 'fight') this.snap(); else this.lose(null); return; }
    const afloat = !!(p.boat || p.aboard), moved = Math.hypot(p.x - s.px, p.y - s.py);
    if (s.phase !== 'fight' && (moved > (afloat ? 1.5 : 0.4) || Math.hypot(p.x - s.bx, p.y - s.by) > this.reach + 2.5)) { this.state = null; return; }
    if (g.busy) return;   // (with a dialog or a scene on, the fish waits)
    if (s.fly < 1) {
      s.fly = Math.min(1, s.fly + dt / 0.4);
      if (s.fly === 1) { Audio.plop(); g.gather.chips(s.bx, s.by, 'water', 5); g.view3d?.fx?.rippleAt?.(s.bx, s.by, 0.5, 0.4); if (!(s.rate > 0)) g.gather.float(tr('fish.too_shallow'), '#ffd0a0'); }
      return;
    }
    if (s.phase === 'fight') return this.fight(dt);
    if (s.phase === 'wait') {
      s.t -= dt; s.nib -= dt;
      if ((s.next -= dt) <= 0 && s.t > 1.5) {
        s.next = this.nibGap(s.rate);
        if (s.rate > 0) {   // (where nothing lives, not even a tremble)
          s.nib = NIB; this.bob();
          if (!s.bare && Math.random() < STEAL) { s.bare = true; s.t = Math.min(FW.WAIT[1], s.t * 3); g.gather.float(tr('fish.stolen'), '#ffd0a0'); }
        }
      }
      if (s.t <= 0) this.bite();
    } else if (s.phase === 'bite') {
      s.bt += dt;
      this.biteSounds(s);
      if (s.bt > s.pre + s.win) this.lose(tr('fish.gone'));
    }
  }
  // (each dip, tap or sinking is heard once)
  biteSounds(s) {
    const b = s.bt, n = s.bite === 'dip' ? (b < 0.3 ? 0 : b < 0.6 ? 1 : 2) : s.bite === 'taps' ? Math.min(s.taps, Math.floor(b / TAP)) : s.bite === 'run' ? (b < 0.8 ? 0 : 1) : s.bite === 'lift' ? 0 : 1;
    if (n <= s.sound) return;
    s.sound = n;
    this.bob((s.bite === 'dip' && n === 2) || (s.bite === 'taps' && n === s.taps) || (s.bite === 'run' && n === 1));
  }

  // Rises: now and then a fish rings the water near the player, where there are fish (more at dawn and dusk, and over the
  // better spots; none over a fished-out one); one in six jumps. One point looked at each time
  rises(dt, p) {
    const g = this.game, fx = g.view3d?.fx;
    if (this.rise2 && (this.rise2.t -= dt) <= 0) { fx?.rippleAt?.(this.rise2.x, this.rise2.y, 0.8, 0.55); this.rise2 = null; }
    if ((this.riseT -= dt) > 0) return;
    this.riseT = 1.5;
    if (Profile.server || !fx?.rippleAt || g.scene !== this.world || g.gamemode === 'spectator' || p.headUnder) return;
    const spot = this.riseSpot(p);
    if (!spot) return;
    const T = g.days;
    this.riseT = (6 + Math.random() * 9) / clamp(FW.activity(T.localHour, false, T.localSeason), 0.6, 1.5);
    fx.rippleAt(spot.x, spot.y, 0.45, 0.8);
    this.rise2 = { x: spot.x, y: spot.y, t: 0.3 };
    if (spot.depth > 0.6 && Math.random() < 1 / 6) g.view3d.fx.fishing?.leap(spot.x, spot.y);
  }
  riseSpot(p) {
    const w = this.world, a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 22, x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
    if (!(w.waterDepth(x, y) > 0.3)) return null;
    const water = this.waterType(x, y);
    if (!water || water === 'hielo' || FW.stockK(FW.caughtAt(w, x, y, water, this.game.days.realDay), water) <= 0.5) return null;
    const depth = FW.bedDepth(w, x, y);
    return Math.random() * 1.6 < FW.structure(w, x, y, water, depth) ? { x, y, depth } : null;
  }

  // ---------- what the others see ----------
  // st.fb, only with a line out or a fish in the hands: [x, y of the float or the line's end, phase (0 flying, 1 waiting,
  // 2 biting, 3 fighting, 4 the catch), bite (BITE_IDS), weight class]. A game from before ignores it
  net() {
    const s = this.state, c = this.card;
    if (!s) return c ? [0, 0, 4, 0, kgClass(c.kg)] : undefined;
    const fight = s.phase === 'fight';
    return [r2(fight ? s.ex : s.bx), r2(fight ? s.ey : s.by), s.fly < 1 ? 0 : PHASES[s.phase], s.bite ? BITE_IDS.indexOf(s.bite) : 0, fight ? Math.max(kgClass(s.kg), Math.round(s.load * 3)) : 0];
  }
  // A record or a trophy of another player: in the feed if they are near or your couple
  heard(peer, m) {
    const g = this.game, p = g.player, e = peer?.entity;
    if (!p || !FISH[m.id] || !Number.isFinite(m.cm) || !Number.isFinite(m.g) || m.cm <= 0 || m.cm > 500 || m.g <= 0 || m.g > 5e5) return false;
    const near = e && peer.sc === 'world' && g.scene === this.world && Math.hypot(nearX(e.x, p.x) - p.x, e.y - p.y) < 100;
    if (!near && !g.social?.isPartner?.(peer)) return false;
    hud.toast(tr(m.rec ? 'fish.feed_rec' : 'fish.feed', { who: String(peer.name || '').slice(0, 24), fish: fishName(m.id), cm: Math.round(m.cm), kg: kgText(m.g / 1000) }), 'net');
    return true;
  }

  // How the player stands: the rod out, leaning back on it in the fight, the fish held in both hands
  pose() {
    const s = this.state;
    if (this.card && !s) return HELD;
    if (!s || s.fly < 1) return null;
    if (s.phase !== 'fight') return OUT;
    FIGHT.arm = -0.75 - 0.3 * s.load + 0.12 * Math.sin(s.ft * 3.1); FIGHT.lean = -0.06 - 0.14 * s.load;
    return FIGHT;
  }

  // The angler's log (diary): each fish, where and when, its record and how many
  journal() {
    const g = this.game, ids = Object.keys(FISH), known = id => g.collection.got.has(id) || !!this.records[id];
    const water = f => f.water.map(w => tr('nature.water.' + w)), T = g.days;
    const when = f => [
      f.seasons ? tr('nature.fact.fish_seasons', { list: seasonNames(f.seasons) }) : '',
      f.hours ? tr('nature.fact.fish_hours', { a: f.hours[0], b: f.hours[1] }) : f.night ? tr('nature.fact.fish_night') : f.rare ? '' : tr('nature.fact.fish_dawn'),
      f.weather ? tr('nature.fact.rain') : '',
    ].filter(Boolean).join(' · ');
    const rec = id => {
      const r = this.log.rec[id], cm = this.records[id];
      if (!cm) return '';
      const at = r?.[2] > 0 ? fmt.date(r[2] * 86400000, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';
      return `${fmt.num(cm)} cm${r ? `<small>${kgText(r[1] / 1000)} kg</small>` : ''}${at || this.log.n[id] ? `<small>${[this.log.n[id] ? tr('fish.log.count', { n: this.log.n[id] }) : '', at].filter(Boolean).join(' · ')}</small>` : ''}`;
    };
    return `<p class="j-note">${tr('fish.log.summary', { n: ids.filter(known).length, of: ids.length, fish: g.stats.get('peces') })}</p>` + ids.map(id => {
      const f = FISH[id], k = known(id);
      return `<div class="j-fish"><span class="j-cell ${k ? 'done' : 'none'}"><img alt="" data-icon="${id}"></span>` +
        `<span><b>${k ? fishName(id) : '???'}</b><small>${tr('nature.fact.waters', { list: water(f) })}${k ? ' · ' + when(f) : ''}</small></span>` +
        `<span class="lvl">${rec(id)}</span></div>`;
    }).join('');
  }
}
const OUT = { arm: -0.35, lean: 0 }, FIGHT = { arm: -0.9, lean: -0.1 }, HELD = { arm: -1.05, lean: -0.04, both: true };
