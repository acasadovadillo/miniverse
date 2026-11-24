// The player's needs besides health and hunger (those stay in combat.js): thirst, stamina, rest (fatigue), air under
// water, sleeping in a bed and drinking from the world. Design: docs/planes/gta/PLAN-D-barras-buceo.md §2 and §3.1.
//
// One bar, one job: food fills hunger, drink fills thirst, resting and sleeping fill energy (rest, and the stamina cap
// it gives), health comes back by itself when you are fed and watered, air comes back at the surface. Eating never
// refills energy. Under water only air drains; walking around, only sprinting spends stamina (jogging refills it slowly).
//
// Save keys: thirst, dry, rest, restAt, napAt, rested. Never `energy` (an old field from before 2026-11-04.2, which old
// saves may still hold). Stamina, air and the dive are not saved. The needs values never travel on the network.
//
// Contract with the other tracks (keep the names):
//   from the player (entities.js): p.sprinting, p.jogging, p.fastSwim (from the gated tier), p.headUnder, p.swim, p.pose,
//     p.forceRise (set here: push the diver up until the head is out), p.onJump (wired in game.js to spend), p.sleeping
//     (set here while asleep in a bed; cleared by rest.stand, Rest.reset and refill)
//   for the others: quench, dryBy, spend, work, noRun, refill, gulp, drinkAt, isFresh, sleep, target, swimAction, aimables
import { TOOL_COST, ITEMS, pctOf } from './items.js';
import { Audio } from './audio.js';
import { hud } from './ui/hud.js';
import { keys } from './input.js';
import { t, noun } from './i18n.js';
import { apagada } from './opciones.js';
import { B } from './world/biomes.js';
import { WATER_Y } from './world/planet.js';
import { aabb } from './world/fit.js';

// ---------- constants (§2.1) ----------
export const THIRST_MAX = 20, DRY = 4, DRY_IDLE = 120;        // half-units like hunger; idle: 1 unit per 120 s (empty in 40 min)
export const DRY_EXERT = 0.35;                                // thirst from exertion: this × each NON-idle hunger exertion
export const STAMINA_MAX = 100, REGEN_DELAY = 1.0;            // s without a movement spend before it refills
export const REST_MAX = 100, AWAKE_MIN = 180, REST_BUSY = 1.25; // rest falls 100 % in 180 min idle; ×1.25 while active
export const REST_AWAY_H = 6;                                 // hours away from the game for a full rest
export const NAP = 40, NAP_EVERY_MIN = 60, RESTED_MIN = 30;   // a day nap, how often, and the "well rested" spell after a night
export const AIR_MAX = 30, AIR_PER_LEVEL = 2;                 // seconds of breath; +2 s per diving level (50 s at level 10)
export const RATES = {                                         // per second unless noted
  sprint: 5, swimFast: 12, dive: 0, jump: 4 /*each*/, blow: 2 /*each*/, bow: 5 /*each shot*/, toolK: 2.5 /*x TOOL_COST per use*/,
  regen: 20, regenJog: 8, regenSeated: 35, regenSwim: 12, regenUnder: 6, regenTired: 0.5 /*factor at rest 0*/,
  airDrain: 1, airDrainFast: 1.15, airRefill: 8,
  restBed: 100 / (8 * 60), restFloorLie: 100 / (25 * 60), restSit: 100 / (40 * 60),
};
export const capOf = rest => rest >= 50 ? STAMINA_MAX : 40 + 1.2 * rest;   // 40 at rest 0, 100 from rest 50 up
export const EXHAUST_CLEAR = 0.5;                             // `exhausted` clears at this share of the cap
export const SLEEP_FED = 14;                                  // half-drumsticks of hunger you wake up with at least (as before)
// Drowning damage per second at air 0, by difficulty (floored like hunger at DIFF.starve: only hard kills; peaceful
// takes none and floats you up at once)
export const DIFF_AIR = { peaceful: 0, easy: 1, normal: 2, hard: 3 };

const DRINK_RATE = 5;           // half-units of thirst per second while drinking from the world (25 %/s)
const DRINK_STEP = 5;           // a gulp sound and water chips at each step of this
const DRINK_OFFER = 0.9;        // the "Drink" target only at or below this share of thirst (else it sits over every pond)
const DRINK_REACH = 2.2;        // tiles from the player to the aimed water
const DESERT_HEAT = 1.5, HEAT_POLL = 2;   // idle thirst ×1.5 in the desert; the biome is looked at every 2 s
const TOO_TIRED_EVERY = 20;     // s between two 'needs.too_tired' floats
const FRESH_TTL = 1;            // s an isFresh answer for a tile is kept (dug canals can change it)
const DAY_NAP_FULL = 90;        // by day, from this rest up you are not sleepy
const DOZE_MS = 1500;           // the sleep fade, in all (fade in included)
const AWAKE_RATE = 100 / (AWAKE_MIN * 60);

const fin = (v, def, max) => (Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : def);
const r2 = v => Math.round(v * 100) / 100;
const wait = ms => new Promise(r => setTimeout(r, ms));
const hidden = () => typeof document !== 'undefined' && document.hidden;
// The gestures the network knows (social.js EMOTE_KINDS), read lazily: a static import would close one more import cycle
// (social → reputation → hud → … → combat → needs). Until it is in, no drinking gesture
let emoteKinds = [];
import('./social.js').then(m => { emoteKinds = m.EMOTE_KINDS || []; }, () => {});

// ---------- the system (game.needs, registered right after game.combat) ----------
export class Needs {
  constructor(game) {
    this.game = game;
    // State (§2.2). Units: thirst in half-units of THIRST_MAX (like hunger); stamina and rest 0..100; air in seconds
    this.thirst = THIRST_MAX;   // 0..THIRST_MAX
    this.dry = 0;               // accumulator: one thirst unit goes every DRY
    this.rest = REST_MAX;       // 0..REST_MAX (fatigue: sleep and sitting bring it back)
    this.stamina = STAMINA_MAX; // 0..cap (sprint, fast swim, jumps, blows, the bow and tools spend it)
    this.air = AIR_MAX;         // 0..airMax seconds of breath (drains only while p.headUnder)
    this.exhausted = false;     // latch: set at stamina 0, cleared at EXHAUST_CLEAR × cap (no running meanwhile)
    this.idleT = REGEN_DELAY;   // seconds since the last MOVEMENT spend (sprint, fast swim, jump)
    this.tooTiredSaidAt = -Infinity;   // game.time of the last 'needs.too_tired' float (at most every 20 s)
    this.napAt = 0;             // real ms (Date.now()) of the last day nap
    this.rested = 0;            // real ms until which "well rested" lasts (rest falls at half speed)
    this.drinking = null;       // { x, y, … } while drinking from the world (§3.1), else null
    this.airT = 0;              // s at air 0 since the last drowning tick
    this.heat = 1;              // idle thirst factor here (the desert), polled every HEAT_POLL s
    this.heatT = 0;
    this.dozing = false;        // in the sleep fade
    this.fresh = null;          // Map 'tx,ty' → waterKind answer, kept FRESH_TTL s (freshAt: since when)
    this.freshAt = 0;
    this.aim = null;            // { frame, hit }: the water under the cursor this frame (waterAim)
    // (the URL switches of src/opciones.js: ?sed=0, ?cansancio=0, ?aguante=0)
    this.off = { thirst: apagada('sed'), rest: apagada('cansancio'), stamina: apagada('aguante') };
  }

  // The stamina cap (0..STAMINA_MAX): low rest takes part of it away (the energy bar's locked tail)
  get cap() { return capOf(this.rest); }
  // Effective max of air in seconds, with the diving skill
  get airMax() { return AIR_MAX + AIR_PER_LEVEL * (this.game.skills?.level('diving') || 0); }
  // The player's head is under water (= game.player.headUnder, from entities.js, Track D)
  get headUnder() { return !!this.game.player?.headUnder; }
  get survival() { return this.game.gamemode === 'survival'; }
  get peaceful() { return this.game.difficulty === 'peaceful'; }
  get tireless() { const g = this.game; return g.buffs?.incansable > g.time; }   // (the vegetable soup, /effect tireless)
  // Does thirst drain? (survival, not peaceful, /gamerule doThirst, ?sed=0)
  get thirstOn() { return this.survival && !this.peaceful && this.game.rules?.doThirst !== false && !this.off.thirst; }
  // Does rest fall? (survival, not peaceful, /gamerule doFatigue, ?cansancio=0)
  get fatigueOn() { return this.survival && !this.peaceful && this.game.rules?.doFatigue !== false && !this.off.rest; }
  // Is stamina spent? (survival, any difficulty: it is movement, not punishment; ?aguante=0)
  get staminaOn() { return this.survival && !this.off.stamina; }

  // ---------- hooks ----------
  // (strict hook: must never throw). Old saves start full; only rest gets credit for real time away
  reset(save = {}) {
    const s = save || {};
    this.thirst = fin(s.thirst, THIRST_MAX, THIRST_MAX);
    this.dry = fin(s.dry, 0, DRY);
    this.rest = fin(s.rest, REST_MAX, REST_MAX);
    if (Number.isFinite(s.restAt)) this.rest = Math.min(REST_MAX, this.rest + REST_MAX * Math.max(0, Date.now() - s.restAt) / (REST_AWAY_H * 3600e3));
    this.napAt = Number.isFinite(s.napAt) ? s.napAt : 0;
    this.rested = Number.isFinite(s.rested) ? s.rested : 0;
    this.stamina = STAMINA_MAX;
    this.air = this.airMax;
    this.exhausted = false;
    this.idleT = REGEN_DELAY;
    this.tooTiredSaidAt = -Infinity;
    this.airT = 0; this.heatT = 0; this.heat = 1;
    this.drinking = null; this.dozing = false; this.fresh = null; this.aim = null;
    const p = this.game.player;
    if (p) { p.forceRise = false; p.sleeping = false; }
  }
  save(out) {
    out.thirst = r2(this.thirst);
    out.dry = r2(this.dry);
    out.rest = Math.round(this.rest * 10) / 10;
    out.restAt = Date.now();
    out.napAt = this.napAt;
    out.rested = this.rested;
  }

  update(dt) {
    const g = this.game, p = g.player;
    // 1. Mode: creative, spectator (the world server too) or no player: everything full
    if (!p || !this.survival) { this.fill(); return; }
    // 2. Busy (dialogue, the sleep fade, death, a jump in the dark): stamina comes back, nothing drains
    if (g.busy || g.jumping || hud.dialogOpen) {
      if (this.drinking) this.stopDrinking();
      this.stamina = Math.min(this.cap, this.stamina + RATES.regen * dt);
      if (this.exhausted && this.stamina >= EXHAUST_CLEAR * this.cap) this.exhausted = false;
      return;
    }
    if (this.drinking) this.drinkStep(dt, p);
    this.updateAir(dt, p);
    this.updateStamina(dt, p);
    this.updateRest(dt, p);
    this.updateThirst(dt, p);
  }
  // Everything full (not in survival)
  fill() {
    if (this.drinking) this.stopDrinking();
    this.thirst = THIRST_MAX; this.dry = 0; this.rest = REST_MAX; this.stamina = STAMINA_MAX; this.air = this.airMax;
    this.exhausted = false; this.airT = 0;
    const p = this.game.player;
    if (p?.forceRise) p.forceRise = false;
  }

  // 3. Air: drains with the head under water (not with the tab hidden: alt-tabbing under water must not drown you), comes
  // back at the surface. At 0, a drowning tick every second, floored like hunger; at the floor (or in peaceful) the diver
  // is pushed up (p.forceRise, entities.js) until the head is out
  updateAir(dt, p) {
    const g = this.game, max = this.airMax, under = !!p.headUnder;
    if (!under) {
      this.air = Math.min(max, this.air + RATES.airRefill * dt);
      this.airT = 0;
      if (p.forceRise) p.forceRise = false;
      return;
    }
    if (hidden()) return;
    this.air = Math.max(0, Math.min(max, this.air - dt * (p.fastSwim ? RATES.airDrainFast : RATES.airDrain)));
    if (this.air > 0) { this.airT = 0; return; }
    if ((this.airT += dt) < 1) return;
    this.airT = 0;
    const c = g.combat, dmg = DIFF_AIR[g.difficulty] ?? DIFF_AIR.normal, floor = c ? c.diff.starve : 0;
    if (dmg && c && c.hp > floor) c.hurt(dmg, 'drowned', floor);
    if (!dmg || !c || c.hp <= floor) p.forceRise = true;
  }

  // 4. Stamina: sprinting and fast swimming spend it each second; jumps, blows, the bow and tools once each (spend, work).
  // Only movement spends delay the refill; jogging spends nothing and refills at regenJog. At 0 you cannot sprint
  // (exhausted: game.js drops a sprint to a jog) until half the cap is back
  updateStamina(dt, p) {
    const g = this.game;
    if (!this.staminaOn) { this.stamina = this.cap; this.exhausted = false; this.idleT = REGEN_DELAY; return; }
    const moving = !p.pose && !p.aboard;
    let drain = 0;
    if (moving && !this.tireless) drain = (p.sprinting ? RATES.sprint : 0) + (p.fastSwim ? RATES.swimFast : 0) + (p.headUnder ? RATES.dive : 0);
    if (drain > 0) { this.stamina -= drain * dt; this.idleT = 0; }
    else this.idleT += dt;
    if (this.idleT > REGEN_DELAY) {
      let rate = p.pose ? RATES.regenSeated : p.headUnder ? RATES.regenUnder : p.swim ? RATES.regenSwim : p.jogging ? RATES.regenJog : RATES.regen;
      if (this.rest < 50) rate *= RATES.regenTired + (1 - RATES.regenTired) * (this.rest / 50);
      rate *= g.body?.factors.regen ?? 1;   // (cold and heat refill it more slowly: body.js, Plan E §2.4)
      this.stamina += rate * dt;
    }
    this.stamina = Math.max(0, Math.min(this.cap, this.stamina));   // (falling rest pulls it down)
    if (this.stamina <= 0) this.exhausted = true;
    else if (this.exhausted && this.stamina >= EXHAUST_CLEAR * this.cap) this.exhausted = false;
    if (this.exhausted && keys.sprint && !this.mounted() && g.time - this.tooTiredSaidAt > TOO_TIRED_EVERY) {
      this.tooTiredSaidAt = g.time;
      g.gather?.float(t('needs.too_tired'), '#ffd890');
    }
  }

  // 5. Rest: falls while you are up (faster while active, at half speed while "well rested"); comes back lying in bed,
  // on the floor and, more slowly, sitting. (p.pose has no object: its kind is enough; only beds use 'lie', rest.js)
  // (a bath in a tub, Plan E §4.1, rests at twice a chair; cold makes rest fall faster and a soap bath slower: the body's
  // factor, body.js §2.4)
  updateRest(dt, p) {
    const k = p.pose?.kind;
    if (k === 'lie') this.rest += RATES.restBed * dt;
    else if (k === 'floorLie') this.rest += RATES.restFloorLie * dt;
    else if (k === 'bath') this.rest += 2 * RATES.restSit * dt;
    else if (k === 'sit' || k === 'floorSit') this.rest += RATES.restSit * dt;
    else if (this.fatigueOn && !this.tireless) this.rest -= dt * AWAKE_RATE * (this.idleT < 2 ? REST_BUSY : 1) * (Date.now() < this.rested ? 0.5 : 1) * (this.game.body?.factors.rest ?? 1);
    if (this.off.rest) this.rest = REST_MAX;   // (?cansancio=0: always rested, no cap)
    this.rest = Math.max(0, Math.min(REST_MAX, this.rest));
  }

  // 6. Thirst: one unit every DRY_IDLE s (×1.5 in the desert) plus a share of each exertion (dryBy, from combat.exert).
  // The damage at 0 lives in Combat.update's TICK block, which hunger and thirst share
  updateThirst(dt, p) {
    const g = this.game;
    if (this.off.thirst) { this.thirst = THIRST_MAX; this.dry = 0; return; }   // (?sed=0: always full, the row hidden)
    // (/gamerule doThirst false: full, so it neither hurts nor blocks healing in Combat.update, nor asks for a drink)
    if (g.rules?.doThirst === false) { if (this.thirst !== THIRST_MAX) { this.thirst = THIRST_MAX; this.dry = 0; g.combat?.paint(); } return; }
    if (!this.thirstOn) return;   // (peaceful: it stays where it is, like hunger in peaceful; peaceful heals anyway)
    if ((this.heatT -= dt) <= 0) {
      this.heatT = HEAT_POLL;
      this.heat = g.scene === g.world && g.world?.gen?.biomeAt?.(p.x, p.y) === B.DESERT ? DESERT_HEAT : 1;
    }
    this.dryBy(dt * DRY / DRY_IDLE * Math.max(this.heat, g.body?.factors.thirst ?? 1));   // (a hot afternoon adds to the desert's floor: body.js)
  }

  // ---------- API for the other systems ----------
  // Drinking or eating something that quenches: n half-units of thirst (items.thirstOf(def)), capped at THIRST_MAX
  quench(n) {
    if (!(n > 0)) return;
    this.thirst = Math.min(THIRST_MAX, this.thirst + n);
    this.game.combat?.paint();   // (a repaint of the bars next frame)
  }
  // Thirst from exertion: n half-units into the dry accumulator (combat.exert calls it with n × DRY_EXERT, non-idle only)
  dryBy(n) {
    if (!(n > 0) || !this.thirstOn) return;
    this.dry += n;
    while (this.dry >= DRY) { this.dry -= DRY; if (this.thirst > 0) this.thirst = Math.max(0, this.thirst - 1); }
  }
  // One-off stamina spend of n (0..100 scale). move = true for movement spends (jumps), which also delay the refill
  spend(n, move = false) {
    if (!(n > 0) || !this.staminaOn || this.tireless) return;
    this.stamina = Math.max(0, this.stamina - n);
    if (move) this.idleT = 0;
    if (this.stamina <= 0) this.exhausted = true;
  }
  // Stamina of one tool use: TOOL_COST[kind] × RATES.toolK, halved by skills.costCut (gather.js calls it; no refill delay)
  work(kind) {
    const c = TOOL_COST[kind];
    if (!c) return;
    this.spend(c * RATES.toolK * (this.game.skills?.costCut(kind) ? 0.5 : 1));
  }
  // true while sprinting is blocked by exhaustion (survival only, on foot: a horse gallops and a boat rows on its own
  // strength, and neither spends stamina); game.js ORs it into p.noSprint (jogging stays)
  noRun() { return this.exhausted && this.survival && !this.mounted(); }
  mounted() { const p = this.game.player; return !!(p && (p.mount || p.boat || p.aboard)); }
  // Fill the needs. opts: { death: true } fills thirst, stamina and air, sets rest = max(rest, 50) and clears p.sleeping;
  // without it, everything to the top (rest too)
  refill(opts = {}) {
    if (this.drinking) this.stopDrinking();
    this.thirst = THIRST_MAX; this.dry = 0;
    this.rest = opts.death ? Math.max(this.rest, 50) : REST_MAX;
    this.stamina = this.cap; this.exhausted = false; this.idleT = REGEN_DELAY;
    this.air = this.airMax; this.airT = 0;
    const p = this.game.player;
    if (p) { p.sleeping = false; p.forceRise = false; }
    this.game.combat?.paint();
  }
  // A single quench with its sound and a few drops (the well, a sip from a canteen or jug in hand: the caller already
  // took the sip)
  gulp(n) {
    const g = this.game, p = g.player;
    this.quench(n);
    Audio.plop();
    if (p) g.gather?.chips(p.x + p.face.x * 0.3, p.y + p.face.y * 0.3, 'water', 5);
  }

  // ---------- drinking from the world (§3.1) ----------
  // Start drinking at (x, y) (river, lake, well): one press keeps drinking until full, a move, the head under, or another E
  drinkAt(x, y) {
    const g = this.game, p = g.player;
    if (!p) return;
    if (this.drinking) { this.stopDrinking(); return; }
    if (this.thirst >= THIRST_MAX) { g.gather?.float(t('needs.not_thirsty'), '#d8c3a0'); Audio.error(); return; }
    if (p.headUnder) return;
    g.body?.stopScrub?.();   // (scrubbing there: it stops first, or both would put the crouch back, each its own way)
    const land = !p.swim;
    this.drinking = { x, y, px: p.x, py: p.y, sc: g.scene, land, crouch: !!p.crouch, step: Math.floor(this.thirst / DRINK_STEP), emoteAt: -Infinity, from: this.thirst };
    if (land) p.crouch = true;   // (st.cr shows it to the others)
    this.sip(x, y);
  }
  stopDrinking() {
    const g = this.game, d = this.drinking, p = g.player;
    this.drinking = null;
    if (d?.land && p && !p.swim) p.crouch = d.crouch;
    // (what was drunk, as the canteen and the drinks say it: gather.js; not when dying or leaving)
    const got = d ? pctOf(this.thirst - d.from) : 0;
    if (got > 0 && p && !g.dying) g.gather?.float(t('item.restores.thirst', { n: got }), '#4a9fd8');
  }
  // One frame of drinking: thirst up, a gulp at each step; it stops at full, on a move, with the head under or elsewhere
  drinkStep(dt, p) {
    const g = this.game, d = this.drinking;
    const moved = Math.hypot(p.x - d.px, p.y - d.py) > (d.land ? 0.6 : 1.5);
    if (keys.up || keys.down || keys.left || keys.right || keys.space || moved || p.headUnder || g.scene !== d.sc || p.pose || p.boat || p.mount || p.aboard || p.swim !== !d.land) { this.stopDrinking(); return; }
    this.thirst = Math.min(THIRST_MAX, this.thirst + DRINK_RATE * dt);
    const step = Math.floor(this.thirst / DRINK_STEP);
    if (step > d.step) { d.step = step; this.sip(d.x, d.y); }
    if (d.land && !p.emote && g.time - d.emoteAt > 1.6 && emoteKinds.includes('drink') && g.social?.canEmote(p)) { d.emoteAt = g.time; g.social.emote(p, 'drink'); }
    if (this.thirst >= THIRST_MAX) { this.thirst = THIRST_MAX; this.stopDrinking(); }
  }
  sip(x, y) {
    Audio.plop();
    this.game.gather?.chips(x, y, 'water', 6);
  }
  // Is the water at world point (x, y) fresh? A well, or fishing.waterType not 'mar', not 'hielo', not null (dug canals
  // take their source's type through floodSrc). Cached per tile for a moment: the climate call runs once per tile
  isFresh(x, y) { return this.waterKind(x, y) === 'fresh'; }
  // 'fresh', 'salt' or null (land, ice, or not in the world), cached per tile for FRESH_TTL s (a few tiles at most:
  // the cursor, the tiles ahead, where a swimmer floats)
  waterKind(x, y) {
    const g = this.game, w = g.world;
    if (!w || g.scene !== w) return null;
    if (!this.fresh || Math.abs(g.time - this.freshAt) > FRESH_TTL || this.fresh.size > 32) { this.fresh = new Map(); this.freshAt = g.time; }
    const k = `${Math.floor(x)},${Math.floor(y)}`;
    let v = this.fresh.get(k);
    if (v !== undefined) return v;
    if (w.wellAt?.(x, y)) v = 'fresh';
    else {
      const type = g.fishing?.waterType(x, y);
      v = !type || type === 'hielo' ? null : type === 'mar' ? 'salt' : 'fresh';
    }
    this.fresh.set(k, v);
    return v;
  }
  // The water under the cursor, near the player: { x, y, tx, ty, kind } or null (once per frame). The camera ray against
  // the plane of the water (WATER_Y), within DRINK_REACH tiles
  waterAim(p) {
    const g = this.game, m = g.mouse;
    if (!m?.in || !g.view3d?.rayAt) return null;
    if (this.aim?.frame === g.frameNo) return this.aim.hit;
    let hit = null;
    const ray = g.rayNow ? g.rayNow() : g.view3d.rayAt(m.x, m.y);   // (the same cast as game.aimed's, this frame)
    if (ray && ray.d[1] < -1e-3 && ray.o[1] > WATER_Y) {
      const s = (WATER_Y - ray.o[1]) / ray.d[1], x = ray.o[0] + ray.d[0] * s, y = ray.o[2] + ray.d[2] * s;
      if (Math.hypot(x - p.x, y - p.y) <= DRINK_REACH) { const kind = this.waterKind(x, y); if (kind) hit = { x, y, tx: Math.floor(x), ty: Math.floor(y), kind }; }
    }
    this.aim = { frame: g.frameNo, hit };
    return hit;
  }
  // game.aimTargets asks every system: the water tile under the mouse to drink from, as { kind: 'sys', box: {…, abs: true},
  // act }. Only in survival, in the world (fishing.waterType reads world coordinates: not in a cave or a house), at or
  // below 90 % of thirst (or while drinking: E again stops). The sea says why it cannot be drunk (not to a swimmer, who
  // would see it over all the water around)
  // (what it gave this frame is kept for body.js, which asks right after: aimFrame, aimGave)
  aimables(p, sc, box) {
    const r = this.waterTargets(p, sc, box);
    this.aimFrame = this.game.frameNo; this.aimGave = !!r;
    return r;
  }
  waterTargets(p, sc, box) {
    const g = this.game;
    if (!this.survival || sc !== g.world || !p || p.headUnder || p.boat || p.aboard) return null;
    if (this.thirst > DRINK_OFFER * THIRST_MAX && !this.drinking) return null;
    const hit = this.waterAim(p);
    if (!hit || (hit.kind === 'salt' && p.swim)) return null;
    // (a swimmer with a find in reach: the slab at the surface would cover it; E on nothing aimed still drinks, swimAction)
    if (p.swim && g.dive?.reachable?.(p).length) return null;
    const slab = { ...aabb(hit.tx, hit.ty, hit.tx + 1, hit.ty + 1), y0: WATER_Y - 0.06, y1: WATER_Y + 0.02, abs: true };
    // (alt, X: scrub yourself there, body.js washAlt, Plan E §4.2; the sea washes too)
    if (hit.kind === 'salt') return [{ kind: 'sys', box: slab, act: () => ({ text: t('needs.sea_salty'), run: () => Audio.error(), alt: g.body?.washAlt(hit.x, hit.y) || null }) }];
    return [{ kind: 'sys', box: slab, act: () => ({ text: t('needs.drink_water'), run: () => this.drinkAt(hit.x, hit.y), alt: g.body?.washAlt(hit.x, hit.y) || null }) }];
  }
  // Swimming E without a mouse target (game.js nearest while p.swim: no mouse, or nothing of the systems aimed at): drink if the water here is fresh and the
  // head is above it. An action { text, run }, or null
  swimAction(p, sc) {
    const g = this.game;
    if (!p || sc !== g.world || p.headUnder) return null;
    if (this.drinking) return { text: t('needs.drink_water'), run: () => this.stopDrinking() };
    if (!this.survival || this.thirst > DRINK_OFFER * THIRST_MAX || !this.isFresh(p.x, p.y)) return null;
    return { text: t('needs.drink_water'), run: () => this.drinkAt(p.x, p.y) };
  }

  // ---------- the canteen and the jug: filling them at fresh water ----------
  // gather.pickTarget asks every system: with a canteen or jug in hand (not full) aimed at fresh water, the fill target
  // { tile, ok, label, use } (the farm.target shape), else null
  target(p, held, def) {
    const g = this.game, max = def?.canteen;
    if (!max || !held || g.scene !== g.world) return null;
    const n = Math.max(0, Math.min(max, held.sips || 0));
    if (n >= max) return null;
    const spot = this.freshSpot(p);
    if (!spot) return null;
    return { tile: null, ok: true, label: t('needs.canteen.fill', { item: noun('item', held.id), n, max }), use: () => this.fillHeld(spot) };
  }
  // Fresh water to fill from: under the cursor, a well aimed at, ahead of the player, or where a swimmer floats
  freshSpot(p) {
    const g = this.game, w = g.world;
    const aim = this.waterAim(p);
    if (aim?.kind === 'fresh') return [aim.x, aim.y];
    const [tx, ty] = g.aimTile?.() || [Math.floor(p.x), Math.floor(p.y)], wo = w.wellOf?.(tx, ty);
    if (wo && Math.hypot(wo.tx + wo.n / 2 - p.x, wo.ty + wo.n / 2 - p.y) < 2.4 + (wo.n - 1) * 0.75) return [wo.tx + wo.n / 2, wo.ty + wo.n / 2];
    if (p.swim && !p.headUnder && this.isFresh(p.x, p.y)) return [p.x, p.y];
    for (const r of [1, 1.6]) { const x = p.x + p.face.x * r, y = p.y + p.face.y * r; if (this.isFresh(x, y)) return [x, y]; }
    return null;
  }
  // Fill the canteen or jug in hand to the top (sips live on the stack as s.sips: inventory.js extraOf)
  fillHeld(spot) {
    const g = this.game, s = g.inv?.held, max = s && ITEMS[s.id]?.canteen;
    if (!max) return;
    s.sips = max;
    g.inv.changed();
    Audio.plop();
    if (spot) g.gather?.chips(spot[0], spot[1], 'water', 8);
  }

  // ---------- sleeping (§2.6) ----------
  // Sleep in bed o (game.sleep and family.bed call it; o may be null: then nobody lies down). Time is NOT skipped (the clock
  // is the real Madrid one, shared by everyone): a fade, then a night's sleep (6 to 18 is day, as TimeSystem had it)
  // restores rest to the top and leaves you "well rested"; a nap by day adds NAP, at most once every NAP_EVERY_MIN. You
  // stay lying: moving or E stands you up. Resolves to true if you slept
  async sleep(o = null) {
    const g = this.game, p = g.player;
    if (!p || this.dozing || g.dying || g.busy) return false;
    if (g.carry?.refuse()) return false;
    if (this.survival && g.mobs?.near(p.x, p.y, 8)) { hud.toast(t('needs.sleep.mobs'), 'warn'); Audio.error(); return false; }
    const h = g.days.hour, day = h >= 6 && h < 18;
    if (day) {
      // (the first steps ask to try the bed: then a nap is always allowed)
      const learning = g.steps?.step?.id === 'dormir' && !g.steps.over;
      if (this.fatigueOn && !learning) {
        if (this.rest >= DAY_NAP_FULL) { g.gather?.float(t('needs.sleep.not_tired'), '#d8c3a0'); return false; }
        if (Date.now() - this.napAt < NAP_EVERY_MIN * 60e3) { g.gather?.float(t('needs.sleep.cant_nap'), '#d8c3a0'); return false; }
      }
      g.busy = true;
      let pick;
      try { pick = await hud.ask(p.name, t('needs.sleep.day_q'), [t('needs.sleep.day_yes'), t('needs.sleep.day_no')]); }
      finally { g.busy = false; }
      if (pick !== 0 || g.player !== p || g.dying) return false;
    }
    if (o && p.pose?.kind !== 'lie') { g.rest.lie(o); if (p.pose?.kind !== 'lie') return false; }   // (rest.lie says why not)
    if (this.drinking) this.stopDrinking();
    this.dozing = true;
    p.sleeping = true;   // (st.zz: the others see you asleep, live.js)
    g.busy = true;
    p.stop();
    let slept = false;
    try {
      await hud.fade(true);
      await wait(Math.max(0, DOZE_MS - 280));
      if (g.player === p && !g.dying) {
        if (day) { this.rest = Math.min(REST_MAX, this.rest + NAP); this.napAt = Date.now(); }
        else { this.rest = REST_MAX; this.rested = Date.now() + RESTED_MIN * 60e3; }
        this.stamina = this.cap; this.exhausted = false;
        const c = g.combat;
        if (c && c.hunger < SLEEP_FED) c.feed(SLEEP_FED - c.hunger);   // (thirst does not change)
        g.stats?.add('dormido', 1);   // (the first steps and the HUD's clock count it)
        slept = true;
        try { g.body?.applyGrowth?.(); } catch {}   // (hair and beard grown meanwhile, while the screen is dark: body.js §2.5)
      }
      await hud.fade(false);
    } finally {
      this.dozing = false;
      if (!g.dying) g.busy = false;
    }
    if (!slept) return false;
    g.gather?.float(t(day ? 'needs.napped' : 'needs.slept'), '#a8f0a0');
    g.onSave?.();
    return true;
  }
}
