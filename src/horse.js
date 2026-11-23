// The horse from the saddle: bond levels, the N whistle, the gallop's stamina, spooks, tricks and dirt (Plan F phase 1,
// docs/planes/gta/PLAN-F-caballo.md §1, §2.3 and §6.1). ranch.js keeps the Animal, the host's behaviour and the menu;
// this file holds the rider's side and the pure rules (so the tests can call them without a game).
//
//   game.horse = game.addSystem(new Horse(game)), right after ranch.
//   horse.stam (0..STAM_MAX), horse.winded, horse.galloping (always a boolean), horse.ridden (the Animal, or null): read
//     by the HUD (F3), the music (musicstate.js reads game.horse.galloping) and the art.
//   horse.update(dt)        stamina, ride time → bx, dirt by distance, spook checks for the ridden horse, level-up toasts
//   horse.noGallop()        winded && survival (game.js: no sprint tier while mounted)
//   horse.canJump()         a winded horse does not jump (entities.js Player.canJump)
//   horse.prepRide(p, sc)   before each mounted step: what the riding physics must know (hearts, shoes, breath, ground, setting)
//   horse.onRide(ev)        what happened riding: a sliding stop, a fence or a slope refused, a crash (entities.js onRide)
//   horse.jumpSpend()       a mounted jump: true = jumped (and paid JUMP_COST), false = refused (winded)
//   horse.held()            the horse is rearing or staggering: the rider has no control (game.js feeds the player no keys)
//   horse.whistle(want?, item?)   N (§1.3); the held whistle item calls it too, with its horse and item = true (any distance)
//   horse.halt(a, s)        it stands still for s seconds (its menu, care): a.halt, read by whoever runs the world
//   horse.promptShown()     whether the get-off prompt of action() shows now (game.js render)
//   horse.pat(), horse.trick(kind, a?)   G and H riding; menu tricks ('stay', 'graze'; 'rear' and its head toss)
//   horse.care(a, kind, item?)       'brush' | 'feed' | 'pat': bx with the daily caps, chips, float, gesture, dirt
//   horse.spook(src)        the ridden horse: rear (and a throw at level 1)
//   horse.ours(a, pid)      owner or couple (social.areCouple): the same rule the host's guard uses (§3.2)
//   horse.pick()            the horse N calls: the last ridden, else your own, else your partner's (foals never)
//   horse.action()          riding, E with nothing aimed: get off, and X the saddlebags (game.nearest)
//   horse.marks()           [{ x, y, kind: 'horse', name, id, mini }] for both maps (ours only; mini: on the minimap too)
//   gainFor(a, kind, today, item) → number   pure: the bx a care action gives now (0 once its daily cap is reached)
//
// What the player carries for the network and the art (F2 sends it in st, F4 draws it): p.horseFill (0..2, the bags),
// p.horseDirt (0..1), p.horseAct ({ kind: 'rear' | 'toss' | 'shake', t, seq }) and p.horseWinded. An unridden horse's
// shake after brushing is a.act = { kind: 'shake', t } (local only: the others do not need it)
import { Profile } from './accounts.js';
import { apagada } from './opciones.js';
import { t, getLang } from './i18n.js';
import { hud } from './ui/hud.js';
import { Audio } from './audio.js';
import { CAM } from './camera.js';
import { distOf, dxOf } from './world/planet.js';
import { collide } from './physics.js';
import { fillOf } from './saddlebags.js';
import { GROUND, CLIMB, CLIMB_DRAIN, VERY, STEEP_WALK, STAGGER, STUMBLE_STAM } from './horseride.js';
import { G_FLOOR, G_PATH, G_SOFT } from './body.js';
import { B } from './world/biomes.js';

// ---------- the rules (§2.3) ----------
export const LEVEL_AT = [0, 3, 6, 9];                     // hearts where levels 1..4 start
export const levelOf = love => love >= 9 ? 4 : love >= 6 ? 3 : love >= 3 ? 2 : 1;
export const GALLOP_S = [12, 18, 26, 36];                  // seconds of gallop from full, by level
export const WHISTLE_M = [60, 150, 300, Infinity];         // whistle range in metres, by level
export const SPOOK = [0.6, 0.35, 0.15, 0.05], THROW_L1 = 0.25, SPOOK_EVERY = 20;
export const STAM_MAX = 100, STAM_DELAY = 1.5, STAM_WALK = 15, STAM_STILL = 25, WINDED_CLEAR = 0.4, JUMP_COST = 8;
export const BX_NEXT = 100, BX_AFTER_LOSS = 50, BX_MAX = 299;
export const GAIN = { brush: 20, brushDirt: 30, brushAgain: 10, carrot: 25, apple: 25, hay: 10, wheat: 10, pat1: 10, pat: 3, ride20s: 1, calm: 8 };
export const CAPS = { treats: 3, pats: 5, rideBx: 40 };
export const SHOD_STAM = 1.15;
// The stamina a second of gallop spends: STAM_MAX / GALLOP_S[L-1] / (shod ? SHOD_STAM : 1) × (1 + max(0, kg - 30) / 40)
export const drainOf = (level, shod, kg = 0) => STAM_MAX / GALLOP_S[Math.max(1, Math.min(4, level)) - 1] / (shod ? SHOD_STAM : 1) * (1 + Math.max(0, kg - 30) / 40);
// The treats a horse takes, best first (the menu offers the first one you have), and which GAIN each one is
export const TREATS = ['zanahoria', 'manzana', 'heno', 'trigo'];
const TREAT_GAIN = { zanahoria: 'carrot', manzana: 'apple', heno: 'hay', trigo: 'wheat' };
export const RIDE_CHUNK = 20;        // s in the saddle per GAIN.ride20s
const WADE_WASH = 0.6, WASH = 0.02;  // wading deeper than this (m) washes the legs: −0.2 per 10 s
const DIRT_KM = 0.1, DIRT_WET_KM = 0.15, DIRT_WRITE = 10, DIRT_STEP = 0.05;   // §1.7; a.dirt at most every 10 s, by 0.05
const SPOOK_TICK = 0.25, MOB_R = 5, BOAR_R = 4, THUNDER_K = 0.25, CALM_WINDOW = 3, CALM_FOR = 60;
const SLIDE_S = 0.85, SAY_EVERY = 4;   // s: the sliding stop's pose; between two texts about the same refusal
const REAR_S = 1.2, TOSS_S = 0.6, FALL_S = 1.1, PAT_S = 1.3;   // (PAT_S: the gesture's length, between two pats in the saddle)
const PROMPT_S = 4, PROMPT_STILL = 1, CLAIM_AFTER = 1;   // s: the get-off prompt after mounting, or standing; a claim of the seat after coming out of a cave
const HALT = { brush: 3.2, feed: 2, pat: 2 };            // s it stands still for each care
const JUMP_MIN = 32, JUMP_SPAN = 8, JUMP_OVER = 40, JUMP_CONE = Math.PI / 3;   // §1.3: the jump-in spot, behind the camera
const FAR_MARK = 6, COME_MARK = 90, ARRIVED = 3, BOLT_M = 8;
const LEVEL_TICK = 0.5;

const me = () => Profile.id || 'yo';   // (the same fallback as ranch.js: a.owner is written with it)
const clamp01 = v => (v > 0 ? (v < 1 ? v : 1) : 0);
const round2 = v => Math.round(v * 100) / 100;

// Today's care of a horse (never mutated here): { d: day, b: brushes, f: treats, p: pats, r: seconds ridden }
export function careOf(a, today) {
  const c = a?.care;
  return c && c.d === today ? { d: today, b: c.b | 0, f: c.f | 0, p: c.p | 0, r: +c.r || 0 } : { d: today, b: 0, f: 0, p: 0, r: 0 };
}
// Pure: the bx a care action gives now (0 once its daily cap is reached). kind: 'brush' | 'feed' (item: a TREATS id) |
// 'pat' | 'ride' (one RIDE_CHUNK more in the saddle) | 'calm'
export function gainFor(a, kind, today, item) {
  const c = careOf(a, today);
  switch (kind) {
    case 'brush': return c.b ? (+a?.dirt > 0.3 ? GAIN.brushAgain : 0) : GAIN.brush + Math.round(GAIN.brushDirt * clamp01(+a?.dirt || 0));
    case 'feed': return c.f >= CAPS.treats ? 0 : GAIN[TREAT_GAIN[item]] || 0;
    case 'pat': return c.p >= CAPS.pats ? 0 : c.p ? GAIN.pat : GAIN.pat1;
    case 'ride': return Math.floor(c.r / RIDE_CHUNK) < CAPS.rideBx ? GAIN.ride20s : 0;
    case 'calm': return GAIN.calm;
  }
  return 0;
}
// Pure (the host's books, ranch.js): bx turned into hearts. Returns { love, bx }
export function settle(love, bx) {
  love = Math.max(0, Math.min(10, Math.floor(+love || 0)));
  bx = Math.max(0, Math.min(BX_MAX, Math.floor(+bx || 0)));
  while (bx >= BX_NEXT && love < 10) { bx -= BX_NEXT; love++; }
  if (love >= 10 && bx > BX_NEXT - 1) bx = BX_NEXT - 1;
  return { love, bx };
}

export class Horse {
  constructor(game) {
    this.game = game;
    this.off = apagada('vinculo');   // (?vinculo=0: the horse as before, see opciones.js)
    this.stam = STAM_MAX;
    this.winded = false;
    this.galloping = false;   // (a real boolean always: musicstate.js trusts it)
    this.ridden = null;
    this.known = new Map();   // horse id → the level last seen (the first value only primes it: no toasts on joining)
    this.actSeq = 0;
    this.spooks = 0;          // (every spook in the saddle: smarthud.js shows the pat tip on the first one)
    this.fences = 0;          // (every fence refused: smarthud.js shows the jump tip on the first one)
    this.resetRide();
  }
  get survival() { return this.game.gamemode === 'survival'; }
  reset() {
    this.stam = STAM_MAX; this.winded = false; this.galloping = false; this.ridden = null; this.lastId = null;
    this.known.clear();
    this.fallUntil = null;
    this.coming = null; this.farMark = null; this.actCache = null;
    this.resetRide();
  }
  // (what belongs to one ride: a new horse under you starts it again)
  resetRide() {
    this.restT = STAM_DELAY; this.rideT = 0; this.dirtT = 0; this.spookT = 0; this.bookT = 0;
    this.lx = null; this.ly = null;
    this.lastSpook = -Infinity; this.spookAt = -Infinity; this.calmedSpook = null; this.calmUntil = -Infinity; this.throwAt = null;
    this.isOurs = false;
    this.actKind = null; this.actUntil = -Infinity;
    this.mobNear = false; this.boarNear = false; this.boltsSeen = this.game.days?.bolts || 0;
    this.patAt = -Infinity; this.rideAt = this.game.time || 0; this.stillT = 0;
    this.tileX = this.tileY = null; this.tileScene = null; this.said = null; this.saidAt = -Infinity;
    this.claims = 0; this.outT = 0;   // (a guest) 1: asked for the seat and not answered yet; s out in the world
  }

  // ---------- each step ----------
  update(dt) {
    const g = this.game, p = g.player;
    if (!p || !g.ranch) { this.galloping = false; return; }
    if ((this.levelT = (this.levelT || 0) + dt) >= LEVEL_TICK) { this.levelT = 0; this.levelUps(); this.freeOld(p); }
    if (this.fallUntil !== null && g.time >= this.fallUntil) { this.fallUntil = null; if (p.pose?.kind === 'floorSit') g.rest?.stand(); }   // (thrown: up again)
    const a = p.mount ? this.riddenNow(p) : null;
    if (a !== this.ridden) this.switchTo(a, p);
    if (!a) {
      this.galloping = false;
      // (unridden it rests: you get on a rested horse)
      if (this.stam < STAM_MAX) this.stam = Math.min(STAM_MAX, this.stam + STAM_STILL * dt);
      if (this.winded && this.stam >= WINDED_CLEAR * STAM_MAX) this.winded = false;
      return;
    }
    if (g.live?.guest && this.lostSeat(dt, a, p)) return;
    const moving = p.moving;
    this.stillT = moving ? 0 : this.stillT + dt;
    this.galloping = moving && p.gait === 2;
    // The rear ends: control comes back (and, at level 1, maybe on the ground: throwOff)
    if (this.actKind && g.time >= this.actUntil) this.actKind = null;
    if (this.throwAt !== null && g.time >= this.throwAt) { this.throwAt = null; this.throwOff(a); if (!p.mount) return; }
    this.stamina(dt, a, moving);
    p.horseWinded = this.winded;
    if (this.off) return;
    if (this.isOurs) this.rideTime(dt, a);   // (only the owner and the partner earn progress)
    this.dirtBy(dt, a, p);
    if ((this.spookT += dt) >= SPOOK_TICK) { this.spookT = 0; this.spookCheck(a, p); }
    if ((this.bookT += dt) >= LEVEL_TICK) { this.bookT = 0; this.bagsLook(a, p); }
  }
  // The Animal under the player (no allocation: a plain loop, the list is short)
  riddenNow(p) {
    const r = this.ridden, list = this.game.ranch.animals;
    if (r && r.id === p.horseId && list.includes(r)) return r;
    for (const a of list) if (a.id === p.horseId) return a;
    return null;
  }
  // (a guest riding) Is the seat not ours after all? Once the host has answered (not while our own write is in flight):
  //  - somebody else rides it, or our claim came back empty (the host refused it: someone has its saddlebags open): off the
  //    saddle, and the horse is left as the host has it (no ranch.dismount: that would move it and write its at)
  //  - nobody rides it and it was ours, or we did not ask (the world joined in the saddle, back from a cave: the host gives
  //    up a rider it cannot see): claimed once, out in the world
  lostSeat(dt, a, p) {
    const g = this.game, S = g.live.items?.animals, mine = me();
    this.outT = g.scene === g.world ? this.outT + dt : 0;
    if (S?.pending?.(a.id, 'rider')) return false;
    if (a.rider === mine) { if (S?.synced?.(a.id, 'rider', mine)) this.claims = 0; return false; }
    if (a.rider || this.claims) { this.refused(a, p); return true; }
    if (this.outT >= CLAIM_AFTER) { a.rider = mine; this.claims = 1; }
    return false;
  }
  // Every LEVEL_TICK on foot: a horse that still has you as its rider (a save from before dying in the saddle was looked
  // after, a game cut off) is free again, where it was. Nothing else frees it while you are in the world
  freeOld(p) {
    const g = this.game, mine = me();
    if (p.mount || g.dying || Profile.server) return;
    const S = g.live?.guest ? g.live.items?.animals : null;
    for (const a of g.ranch.animals) {
      if (!a.def?.ride || a.rider !== mine || S?.pending?.(a.id, 'rider')) continue;
      a.rider = null; a.at = [round2(a.x), round2(a.y)];
      g.onSave?.();
    }
  }
  switchTo(a, p) {
    const was = this.ridden;
    if (was) this.writeDirt(was, true);
    this.ridden = a;
    this.resetRide();
    p.ride.on = false;   // (another horse under you: from a standstill, horseride.js)
    if (a && a.rider === me()) this.claims = 1;   // (a guest: asked just now, until the host's answer)
    if (!a) { p.horseAct = null; p.horseWinded = false; return; }
    if (a.id !== this.lastId) { this.stam = STAM_MAX; this.winded = false; }
    this.lastId = a.id;
    this.dirt = clamp01(+a.dirt || 0);
    p.horseDirt = this.dirt;
    this.lx = p.x; this.ly = p.y;
    this.bagsLook(a, p);
  }
  // The gallop's stamina (§1.4): it falls only galloping, refills after STAM_DELAY without it (faster standing still);
  // at 0 the horse is winded until WINDED_CLEAR. Off (?vinculo=0) or outside survival, it never tires
  stamina(dt, a, moving) {
    if (this.off || !this.survival) { this.stam = STAM_MAX; this.winded = false; return; }
    if (this.galloping) {
      this.restT = 0;
      // (sand, snow, mud and uphill tire it more, a path a little less: horseride.js GROUND, CLIMB)
      const R = this.game.player.ride;
      this.stam -= drainOf(levelOf(a.love), !!a.shod, this.game.saddlebags?.kg?.(a) || 0) * R.ground.drain * (R.grade >= CLIMB ? CLIMB_DRAIN : 1) * dt;
      if (this.stam <= 0) this.blow(a);
      return;
    }
    // (walking up something very steep tires it too)
    if (moving && this.game.player.ride.on && this.game.player.ride.grade >= VERY) {
      this.restT = 0;
      if (this.stam > 0 && (this.stam -= STEEP_WALK * dt) <= 0) this.blow(a);
      return;
    }
    if ((this.restT += dt) < STAM_DELAY) return;
    if (this.stam < STAM_MAX) this.stam = Math.min(STAM_MAX, this.stam + (moving ? STAM_WALK : STAM_STILL) * dt);
    if (this.winded && this.stam >= WINDED_CLEAR * STAM_MAX) this.winded = false;
  }
  // Out of breath: no gallop until 40 % (game.js drops the sprint tier: three new taps to gallop again)
  blow(a) {
    this.stam = 0;
    if (this.winded) return;
    this.winded = true;
    this.game.gather.float(t('horse.winded', { name: a.name }), '#e8c890');
    (Audio.snort || Audio.neigh)?.call(Audio);
  }
  noGallop() { return !this.off && this.winded && this.survival; }
  canJump() { return !this.noGallop() && !this.held(); }
  // A mounted jump: the horse pays it, never the rider (§6.2)
  jumpSpend() {
    if (this.off || !this.survival) return true;
    if (this.winded) return false;
    this.stam -= JUMP_COST; this.restT = 0;
    if (this.stam <= 0) { const a = this.ridden; if (a) this.blow(a); else { this.stam = 0; this.winded = true; } }
    return true;
  }
  held() { return (this.actKind === 'rear' || this.actKind === 'stumble') && this.game.time < this.actUntil; }

  // ---------- riding with weight (R4-1; the physics is horseride.js, moved by entities.js) ----------
  // Before each mounted step (game.update). arcade: the setting (Ajustes › Juego › Montar, or ?montar=arcade)
  prepRide(p, sc, arcade) {
    const R = p.ride, a = this.ridden;
    R.love = a ? a.love : 5; R.shod = !!a?.shod;
    R.winded = this.noGallop(); R.noGallop = R.winded;
    R.hold = this.held(); R.arcade = !!arcade;
    const tx = Math.floor(p.x), ty = Math.floor(p.y);
    if (tx === this.tileX && ty === this.tileY && sc === this.tileScene && R.on) return;
    this.tileX = tx; this.tileY = ty; this.tileScene = sc;
    R.ground = this.groundAt(p, sc, tx, ty);
  }
  // What the horse treads on this tile (asked when the tile changes): what is built, the paths and the soft ground as the
  // body has them (body.js groundKind), the rest by the biome, as the route's costs (routegrid.js)
  groundAt(p, sc, tx, ty) {
    const g = this.game, kind = g.body?.groundKind ? g.body.groundKind(p, sc) : null;
    if (kind === G_FLOOR || kind === G_PATH) return GROUND.hard;
    if (kind === G_SOFT) return GROUND.mud;
    // (the body has just looked the biome up for this tile; without it, asked here)
    switch (sc !== g.world ? undefined : kind === null ? g.world.gen?.biomeAt?.(tx + 0.5, ty + 0.5) : g.body.tile?.biome) {
      case B.BEACH: case B.DESERT: case B.OCEAN: case B.SHALLOW: case B.LAKE: return GROUND.sand;
      case B.FOREST: case B.PINES: return GROUND.forest;
      case B.SWAMP: return GROUND.mud;
      case B.SNOW: return GROUND.snow;
      case B.ICE: return GROUND.ice;
      case B.ROCKY: return GROUND.rocky;
    }
    return GROUND.open;
  }
  // What happened in a step (Player.onRide)
  onRide(ev) {
    const g = this.game, p = g.player, R = p.ride;
    if (ev === 'crash') { this.crash(); return; }
    if (ev === 'slide' || ev === 'fence') {
      this.act('slide', SLIDE_S);
      Audio.skid?.();
      g.gather.chips(p.x + p.face.x * 0.8, p.y + p.face.y * 0.8, this.slideKind(R), 10);
    } else if (ev === 'stopped') {
      // (only now, stopped: Space while it slides still goes over)
      if (R.fence) { R.fence = false; this.fences++; this.act('toss', TOSS_S); Audio.snort?.(); this.say('horse.refuse.fence'); }
    } else if (ev === 'up' || ev === 'down') {
      if (this.actKind && g.time < this.actUntil) return;
      this.act('toss', TOSS_S);
      Audio.snort?.();
      this.say(ev === 'up' ? 'horse.refuse.slope' : 'horse.refuse.down');
    }
  }
  slideKind(R) { return R.ground === GROUND.snow || R.ground === GROUND.ice ? 'water' : 'dirt'; }
  // (the same refusal again and again, as when W stays held against a fence, is said once in a while)
  say(key) {
    const g = this.game;
    if (this.said === key && g.time - this.saidAt < SAY_EVERY) return;
    this.said = key; this.saidAt = g.time;
    g.gather.float(t(key, { name: this.ridden?.name || t('horse.your') }), '#fff3c0');
  }
  // It hit something at speed: a stumble, with no control for STAGGER and some of its breath; at level 1 it may throw you (F's
  // throw, at most once per SPOOK_EVERY; G within it calms the horse, as after a scare). Only in survival and not in peaceful
  crash() {
    const g = this.game, p = g.player, a = this.ridden;
    Audio.dump?.();
    if (!this.survival || g.difficulty === 'peaceful') return;
    this.act('stumble', STAGGER);
    Audio.snort?.();
    this.say('horse.stumble');
    if (this.off) return;
    this.stam = Math.max(0, this.stam - STUMBLE_STAM); this.restT = 0;
    if (this.stam <= 0 && a) this.blow(a);
    if (a && p.mount && levelOf(a.love) === 1 && g.time - this.lastSpook >= SPOOK_EVERY && Math.random() < THROW_L1) { this.lastSpook = this.spookAt = g.time; this.throwAt = g.time + STAGGER; }
  }

  // ---------- the bond ----------
  // Time in the saddle: one GAIN.ride20s per RIDE_CHUNK, up to CAPS.rideBx a day (written once a chunk, not each step)
  rideTime(dt, a) {
    if ((this.rideT += dt) < RIDE_CHUNK) return;
    this.rideT -= RIDE_CHUNK;
    const today = this.game.ranch.today, gain = gainFor(a, 'ride', today), c = careOf(a, today);
    c.r += RIDE_CHUNK;
    a.care = c;
    if (gain) a.bx = (+a.bx || 0) + gain;
  }
  // Brush, feed or pat (the menu, G riding, a stranger's pat). Returns whether something was done
  care(a, kind, item) {
    const g = this.game, r = g.ranch;
    if (!a || !r) return false;
    const today = r.today;
    if (this.off) return this.careAsBefore(a, kind, item);
    if (!this.ours(a)) {
      // (anyone may pat it: the hearts and the nuzzle, never progress. petDay stays free, as before)
      if (kind !== 'pat') return false;
      a.petDay = today;
      this.fondness(a, 6);
      g.gather.float(t('horse.patted'), '#ff9ac8');
      g.social?.emote(g.player, 'pat');
      return true;
    }
    const c = careOf(a, today), gain = gainFor(a, kind, today, item);
    if (kind === 'brush') {
      if (!gain) { g.gather.float(t('horse.brush_tomorrow'), '#fff3c0'); return false; }
      c.b++; a.brushDay = today; a.dirt = 0;
      if (a === this.ridden) { this.dirt = 0; g.player.horseDirt = 0; }
      a.act = { kind: 'shake', t: g.time + 2 };   // (the shake once the strokes are done: three/animals.js)
      g.gather.float(t('horse.brushed'), '#ff9ac8');
      g.social?.emote(g.player, 'brush');
      g.skills?.gain('granja', 1);
    } else if (kind === 'feed') {
      if (!gain) { g.gather.float(t('horse.full_treats'), '#fff3c0'); return false; }
      if (!item || !g.inv.count(item)) return false;
      g.inv.remove(item, 1);
      c.f++; a.carrotDay = today;   // (any treat: onDay's neglect rule reads carrotDay)
      g.gather.float(t('horse.fed'), '#ff9ac8');
      g.skills?.gain('granja', 1);
    } else if (kind === 'pat') {
      g.social?.emote(g.player, 'pat');
      if (!gain) { this.halt(a, HALT.pat); g.gather.float(t('horse.pat_enough'), '#fff3c0'); return true; }   // (the day's pats are done: the gesture, and nothing written)
      c.p++; a.petDay = today;
      g.gather.float(t(a === this.ridden ? 'horse.patted_riding' : 'horse.patted'), '#ff9ac8');
    } else return false;
    a.care = c;
    if (gain) a.bx = (+a.bx || 0) + gain;
    this.halt(a, HALT[kind]);
    this.fondness(a, gain ? 8 : 4);
    g.onSave?.();
    return true;
  }
  // It stands still for s seconds (its menu open, or being looked after): whoever runs the world reads it (ranch.js)
  halt(a, s) {
    if (!a || a === this.ridden || a.rider || a.calling || !this.ours(a)) return;
    a.halt = Math.round(((this.game.world?.clock || 0) + s) * 10) / 10;
    if (!this.game.live?.guest) { this.game.ranch.stopGrazing(a); a.vx = a.vy = 0; }
  }
  // ?vinculo=0: brushing or a carrot is a heart, a pat is today's pet()
  careAsBefore(a, kind, item) {
    const g = this.game, r = g.ranch;
    if (kind === 'brush') { if (a.brushDay === r.today) return false; a.brushDay = r.today; r.bond(a, t('horse.brushed')); return true; }
    if (kind === 'feed') { if (a.carrotDay === r.today || !item || !g.inv.count(item)) return false; g.inv.remove(item, 1); a.carrotDay = r.today; r.bond(a, t('horse.fed')); return true; }
    if (kind === 'pat') { r.petAsBefore(a); return true; }
    return false;
  }
  fondness(a, n) {
    const g = this.game, p = g.player, x = a === this.ridden && p ? p.x : a.x, y = a === this.ridden && p ? p.y : a.y;
    g.gather.chips(x, y, 'heart', n);
    if (a !== this.ridden) a.wait = Math.max(a.wait || 0, 1.5);
    Audio.neigh();
  }
  // The level-up toast (§3.1): on every game that sees the hearts of a horse it may use cross into a new level. The first
  // value seen of each horse only primes the memory
  levelUps() {
    const r = this.game.ranch;
    if (this.off || !r) return;
    for (const a of r.animals) {
      if (!a.def?.ride || !this.ours(a)) continue;
      const L = levelOf(a.love), was = this.known.get(a.id);
      this.known.set(a.id, L);
      if (was === undefined || L <= was || !this.game.player || Profile.server) continue;
      hud.toast(t('horse.level_up', { name: a.name, n: L, learnt: t('horse.learnt.' + L) }), 'good');
      const p = this.game.player, here = a === this.ridden;
      this.game.gather.chips(here ? p.x : a.x, here ? p.y : a.y, 'heart', 12);
    }
  }

  // ---------- G and H riding, and the menu's tricks ----------
  // G riding: a pat on the neck; right after a spook it calms the horse (and saves the rider from a throw)
  pat() {
    const g = this.game, p = g.player, a = this.ridden;
    if (!p?.mount || !a || this.off) return false;
    const soon = g.time - this.patAt < PAT_S;
    if (g.time - this.spookAt <= CALM_WINDOW && this.calmedSpook !== this.spookAt) {
      this.calmUntil = g.time + CALM_FOR; this.throwAt = null; this.calmedSpook = this.spookAt;
      if (this.actKind === 'rear') this.actUntil = Math.min(this.actUntil, g.time + 0.3);   // (it settles at once)
      if (this.isOurs) { a.bx = (+a.bx || 0) + gainFor(a, 'calm', g.ranch.today); g.onSave?.(); }
      g.gather.float(t('horse.calmed', { name: a.name }), '#c8f0a0');
      g.social?.emote(p, 'pat');
      this.patAt = g.time;
      this.fondness(a, 6);
      return true;
    }
    if (soon || this.held()) return true;   // (one pat at a time, and none while it rears)
    this.patAt = g.time;
    return this.care(a, 'pat');
  }
  // H riding (rear, level 3; below it a head toss and «doesn't know that yet»), and the menu's Stay / Let it graze
  trick(kind, a = this.ridden) {
    const g = this.game, p = g.player;
    if (!a || this.off) return false;
    if (kind === 'rear') {
      if (!p?.mount || a !== this.ridden || (this.actKind && g.time < this.actUntil)) return false;   // (one at a time)
      if (levelOf(a.love) < 3) { this.act('toss', TOSS_S); g.gather.float(t('horse.not_yet', { name: a.name }), '#fff3c0'); return true; }
      this.act('rear', REAR_S);
      Audio.neigh();
      return true;
    }
    if (kind === 'stay') {
      if (levelOf(a.love) < 2 || !this.ours(a)) return false;
      a.stay = 1; a.at = [round2(a.x), round2(a.y)];
      g.gather.float(t('horse.stays', { name: a.name }), '#fff3c0');
      g.onSave?.();
      return true;
    }
    if (kind === 'graze') {
      if (!a.stay) return false;
      delete a.stay;
      g.gather.float(t('horse.grazes', { name: a.name }), '#fff3c0');
      g.onSave?.();
      return true;
    }
    return false;
  }
  // The ridden horse's animation (rear, toss, shake): the art and the network read p.horseAct
  act(kind, s) {
    const g = this.game, p = g.player;
    this.actKind = kind; this.actUntil = g.time + s;
    if (p) p.horseAct = { kind, t: g.time, seq: ++this.actSeq };
  }

  // ---------- spooks (§1.5) ----------
  // Every SPOOK_TICK, only the ridden horse: a monster within 5 m, a boar within 4 m or a thunderbolt, each one roll when it
  // starts (its rising edge), at most one spook per SPOOK_EVERY. Survival only, never peaceful
  spookCheck(a, p) {
    const g = this.game;
    if (!this.survival || g.difficulty === 'peaceful' || g.scene !== g.world) { this.mobNear = this.boarNear = false; this.boltsSeen = g.days?.bolts || 0; return; }
    const mob = !!g.mobs?.near?.(p.x, p.y, MOB_R), boar = this.boarAt(p), bolts = g.days?.bolts || 0;
    const bolt = bolts > this.boltsSeen;
    const src = (mob && !this.mobNear) ? 'mob' : (boar && !this.boarNear) ? 'boar' : bolt ? 'thunder' : null;
    this.mobNear = mob; this.boarNear = boar; this.boltsSeen = bolts;
    if (!src || g.time - this.lastSpook < SPOOK_EVERY || this.held()) return;
    const L = levelOf(a.love), k = SPOOK[L - 1] * (src === 'thunder' ? THUNDER_K : 1) * (g.time < this.calmUntil ? 0.5 : 1);
    if (Math.random() < k) this.spook(src);
  }
  boarAt(p) {
    for (const w of this.game.wildlife?.list || []) if (w.type === 'jabali' && !w.dead && distOf(w.x, w.y, p.x, p.y) < BOAR_R) return true;
    return false;
  }
  // The ridden horse gets scared: it rears (no control for REAR_S) and, at level 1, may throw you when it lands
  spook(src) {
    const g = this.game, p = g.player, a = this.ridden;
    if (!a || !p?.mount || this.off) return false;
    this.lastSpook = this.spookAt = g.time;
    this.spooks++;
    this.act('rear', REAR_S);
    g.gather.float(t('horse.spooked', { name: a.name }), '#ffb0a0');
    (Audio.whinnyScared || Audio.neigh)?.call(Audio);
    if (levelOf(a.love) === 1 && Math.random() < THROW_L1) this.throwAt = g.time + REAR_S;
    return true;
  }
  // Thrown (level 1 only): beside the horse, 2 damage (never below diff.starve: it never kills on easy or normal), and the
  // horse trots BOLT_M away and stops (where whoever runs the world moves it: alone or hosting; a guest's stays beside)
  throwOff(a) {
    const g = this.game, p = g.player;
    if (!p?.mount) return;
    const fx = p.face?.x || 0, fy = p.face?.y || 0;
    g.ranch.dismount();
    if (p.mount) return;   // (refused: deep water with a big thing behind the saddle)
    g.combat?.hurt?.(2, 'thrown');
    g.gather.float(t('horse.thrown', { name: a.name }), '#ffb0a0');
    // (sitting on the ground for a moment, as you fell; walking gets you up after the first half)
    Audio.dump?.();
    if (!g.dying && !g.carry?.held && !p.depth && g.rest?.floor('floorSit')) { p.pose.min = g.time + FALL_S / 2; this.fallUntil = g.time + FALL_S; }
    if (!g.live?.guest) {
      const w = g.world;
      for (const s of [1, 0.6, 0.3]) {
        const x = a.x + fx * BOLT_M * s, y = a.y + fy * BOLT_M * s;
        if (!w.blocked(x, y)) { a.bolt = [x, y]; a.stuck = 0; break; }
      }
    }
  }

  // ---------- dirt (§1.7) ----------
  // Counted by the rider: by distance (more in rain or snow, or wading), washed wading deep. a.dirt written at most every
  // DIRT_WRITE s, and only when it moved by DIRT_STEP
  dirtBy(dt, a, p) {
    const g = this.game, d = this.lx === null ? 0 : distOf(p.x, p.y, this.lx, this.ly);
    this.lx = p.x; this.ly = p.y;
    if (d > 0 && d < 5) {   // (not a teleport)
      const T = g.days, wet = (!g.indoors && !!(T?.info?.rain || T?.info?.snow)) || p.depth > 0.05;
      this.dirt += d / 1000 * (DIRT_KM + (wet ? DIRT_WET_KM : 0));
    }
    if (p.depth > WADE_WASH) this.dirt -= WASH * dt;
    this.dirt = clamp01(this.dirt);
    p.horseDirt = this.dirt;
    if ((this.dirtT += dt) >= DIRT_WRITE) { this.dirtT = 0; this.writeDirt(a); }
  }
  writeDirt(a, force = false) {
    if (this.off || !a || this.dirt === undefined) return;
    const now = clamp01(+a.dirt || 0);
    if (Math.abs(this.dirt - now) >= DIRT_STEP || (force && Math.abs(this.dirt - now) >= 0.01)) a.dirt = round2(this.dirt);
  }
  // The bags seen from the saddle: whether there are any, and how full (the model and st.hb)
  bagsLook(a, p) {
    this.isOurs = this.ours(a);   // (refreshed with the bags: ours asks the family, not each step)
    p.horseBags = !!a.bags;
    p.horseFill = a.bags ? fillOf(this.game.saddlebags?.kg?.(a) || 0) : 0;
  }
  // (a guest) The host gave the horse to another rider, or said no: off the saddle, nothing written to the horse
  refused(a, p) {
    const g = this.game;
    p.mount = false; p.horseAct = null; p.horseWinded = false;
    this.dirt = undefined; this.galloping = false;   // (switchTo writes no dirt to a horse that is not ours to ride now)
    g.carry?.syncArms();
    g.saddlebags?.release?.(a);
    const by = a.rider || g.saddlebags?.holder?.(a), who = (by && g.live?.nameOf?.(by)) || t('horse.someone');
    g.gather.float(a.rider ? t('horse.whistle.ridden', { who, name: a.name }) : by && by !== me() ? t('horse.bags.busy', { who }) : t('horse.refused', { name: a.name }), '#fff3c0');
    Audio.error?.();
  }
  // Got off (ranch.dismount): the dirt goes to the horse now
  onDismount(a) { if (a && a === this.ridden) this.writeDirt(a, true); }

  // ---------- the whistle (N, §1.3) ----------
  ours(a, pid = me()) { return !!a && !!pid && (a.owner === pid || !!this.game.social?.areCouple?.(a.owner, pid)); }
  // Which horse comes: the one you rode last if it is yours or your partner's; else your own with the most hearts; else
  // your partner's with the most hearts. Foals never
  pick() {
    const g = this.game, r = g.ranch, p = g.player, mine = me();
    let last = null, own = null, theirs = null;
    for (const a of r?.animals || []) {
      if (!a.def?.ride || r.young(a) || !this.ours(a)) continue;
      if (a.id === p?.horseId) last = a;
      if (a.owner === mine) { if (!own || a.love > own.love) own = a; }
      else if (!theirs || a.love > theirs.love) theirs = a;
    }
    return last || own || theirs;
  }
  // N, or the held whistle (want: its horse; item: it hears it from any distance, as it always did). Returns whether it did
  // something
  whistle(want = null, item = false) {
    const g = this.game, p = g.player;
    if (!p || g.mode !== 'play' || g.busy || hud.dialogOpen || g.gamemode === 'spectator') return false;
    if (this.off && !want) return false;   // (?vinculo=0: no N key; the held whistle calls as before, see ranch.callHorse)
    if (p.mount) { this.gesture(); return true; }   // (riding: a short whistle, so the key never feels dead)
    const a = want || this.pick();
    if (!a) {
      if (g.inv.count('caballo')) { g.ranch.newHorse(); return true; }   // (the whistle bought and no horse yet: as using the item)
      g.gather.float(t('horse.whistle.none'), '#fff3c0');
      Audio.error?.();
      return false;
    }
    if (g.scene !== g.world || p.inside || p.boat || p.aboard || (g.underRoof && !g.ranch.houseAround(p))) {
      g.gather.float(t('horse.whistle.inside', { name: a.name }), '#fff3c0');
      return false;
    }
    if (a.rider && a.rider !== me()) {
      this.gesture();
      g.gather.float(t('horse.whistle.ridden', { who: g.live?.nameOf?.(a.rider) || t('horse.someone'), name: a.name }), '#fff3c0');
      return false;
    }
    const d = distOf(a.x, a.y, p.x, p.y);
    if (d < ARRIVED && !item) { this.gesture(); return true; }   // (here already: the gesture, and nothing is sent)
    if (!this.off && !item && d > WHISTLE_M[levelOf(a.love) - 1]) {
      this.gesture(true);
      g.gather.float(t('horse.whistle.far', { name: a.name }), '#ffd890');
      this.farMark = { id: a.id, until: g.time + FAR_MARK };
      return false;
    }
    this.gesture();
    g.gather.float(t('horse.whistle.come', { name: a.name }), '#fff3c0');
    this.call(a, p, d);
    return true;
  }
  gesture(long = false) {
    const g = this.game;
    g.social?.emote(g.player, 'whistle');
    (long && Audio.whistleLong ? Audio.whistleLong : Audio.whistle).call(Audio);
  }
  // The call itself: who called (the host brings it to them), and the jump-in spot when it is far (§3.3)
  call(a, p, d) {
    const g = this.game;
    delete a.stay;
    delete a.bolt;
    delete a.halt;
    a.call = (a.call || 0) + 1;
    a.callBy = me();
    const spot = d > JUMP_OVER ? this.jumpSpot(p) : null;
    if (spot) a.callAt = spot; else delete a.callAt;
    if (!g.live?.guest) g.ranch.called(a);   // (a guest's call: the host sees call grow, ranch.netField)
    this.coming = { id: a.id, until: g.time + COME_MARK };
    g.onSave?.();
  }
  // Where the horse comes in from (the caller decides: the host knows nothing of this camera): dry land JUMP_MIN to
  // JUMP_MIN + JUMP_SPAN metres away, behind the camera (±60°), not inside anything. null: none (it walks the whole way).
  // behind: the angle to look at, for a player whose camera is not this one (ranch.js goAround)
  jumpSpot(p, behind) {
    const w = this.game.world;
    if (!w) return null;
    // (the camera looks along screenToWorld(0, -1) = (−sin yaw, −cos yaw): behind it is the opposite way)
    const base = behind ?? Math.atan2(Math.cos(CAM.yaw), Math.sin(CAM.yaw)), q = { x: 0, y: 0 };
    for (let i = 0; i < 8; i++) {
      const off = ((i + 1) >> 1) * (i & 1 ? 1 : -1) * (JUMP_CONE / 4), ang = base + off, r = JUMP_MIN + Math.random() * JUMP_SPAN;
      const x = p.x + Math.cos(ang) * r, y = p.y + Math.sin(ang) * r;
      if (w.blocked(x, y) || (w.waterDepth?.(x, y) || 0) > 0.3) continue;
      q.x = x; q.y = y;
      collide(q, w.collidersNear(x, y), 0.45);
      if (Math.abs(q.x - x) + Math.abs(q.y - y) > 0.02) continue;   // (inside a house, a fence, a rock: no)
      return [round2(x), round2(y)];
    }
    return null;
  }

  // ---------- riding: E with nothing aimed, and the maps ----------
  action() {
    const g = this.game, p = g.player;
    if (!p?.mount) return null;
    const a = this.ridden || this.riddenNow(p), bags = !!a?.bags && g.scene === g.world, lang = getLang(), C = this.actCache;   // (in a cave the saddlebags stay shut)
    // (asked every frame by game.nearest: the same object while the horse, its name, its bags and the language stay the same)
    if (C && C.a === a && C.name === a?.name && C.bags === bags && C.lang === lang) return C.v;
    const text = a ? t('horse.get_off', { name: a.name }) : t('horse.item.get_off');
    const alt = bags ? { text: t('horse.alt_bags'), run: () => g.saddlebags?.open(a) } : null;
    this.actCache = { a, name: a?.name, bags, lang, v: { text, run: () => g.ranch.dismount(), alt, riding: true } };
    return this.actCache.v;
  }
  // The get-off prompt, in the minimal HUD: just after mounting, standing still, or with Tab (E and X work all the same)
  promptShown() {
    const g = this.game, sh = g.smartHud;
    return !sh || sh.held || (!this.held() && (this.stillT >= PROMPT_STILL || g.time - this.rideAt < PROMPT_S));   // (not over a rearing horse)
  }
  // Your horses and your partner's for both maps; mini: also on the minimap (coming to a whistle, or just out of range)
  marks() {
    const g = this.game, r = g.ranch, p = g.player, out = [];
    if (!r || !p) return out;
    if (this.coming && (g.time > this.coming.until)) this.coming = null;
    if (this.farMark && g.time > this.farMark.until) this.farMark = null;
    for (const a of r.animals) {
      if (!a.def?.ride || a.rider === me() || !this.ours(a)) continue;
      let mini = false;
      if (this.coming?.id === a.id) { if (distOf(a.x, a.y, p.x, p.y) < ARRIVED) this.coming = null; else mini = true; }
      if (this.farMark?.id === a.id) mini = true;
      const at = a.rider ? r.player(a.rider) : a;   // (ridden by your partner: where they are; in a cave, nowhere)
      if (!at) continue;
      out.push({ x: p.x + dxOf(at.x, p.x), y: at.y, kind: 'horse', name: a.name, id: a.id, mini, mine: a.owner === me() });
    }
    return out;
  }
}

