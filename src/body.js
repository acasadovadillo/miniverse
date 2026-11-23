// The player's body: what the world leaves on it (dirt, mud, wet, snow, blood), the felt temperature, the "fresh" spell
// after a soap bath and the hair and beard growth clocks. Design: docs/planes/gta/PLAN-E-cuerpo-aspecto.md §2, §4.1,
// §4.2, §6, §7.1 (the Critic notes appendix wins over older lines). Owner: Track A1.
//
// Body never owns a bar: it feeds Plan D's needs (needs.js) through `factors`, and those reads are guarded
// (`g.body?.factors.rest ?? 1`), so needs.js works without it. No health damage from cold or heat (user decision 2).
//
// Phase E1: the surface, the temperature, the factors, washing (tub, river, basin) and the chip are real. The growth
// clocks count and are saved, but nothing is applied to the look yet (APPLY_GROWTH, E3).
//
// Contract (plan §10; keep the names, other tracks code against them):
//   channels, 0..100:  body.dirt  body.mud  body.wet  body.wetLegs  body.snow  body.blood
//                      (wetLegs: the wet line up the legs, in cm: the water depth while wading × 100, then it dries)
//   temperature:       body.airC  body.feelC (°C)   body.cold  body.heat (0..1 stresses), polled every 2 s, 20 s lag
//   body.fresh         getter: a soap bath under 2 real hours ago (freshUntil > Date.now())
//   body.factors       { rest, regen, thirst, hunger }, refreshed at 2 Hz, mutated in place (never reallocated):
//                        rest   × the drain line of Needs.updateRest
//                        regen  × `rate` in Needs.updateStamina
//                        thirst Needs.updateThirst uses Math.max(this.heat, factors.thirst)
//                        hunger × the idle exertion in combat.update
//                      all 1 in creative, spectator, peaceful, on the world server, with /gamerule doBodyWeather false
//                      and with ?frio=0
//   body.surface()     the reused object { dirt, mud, wet, wetLegs, snow, blood, shiver, sweat }, each 0..1 (shiver and
//                      sweat 0 or 1): what RealPerson.setGrime draws. Channels 0 with ?cuerpo=0; shiver (cold ≥ 0.6) and
//                      sweat (heat ≥ 0.35) 0 with ?frio=0
//   body.bd            the packed st.bd of surface() (packBd), refreshed at 2 Hz: live.js sends it when nonzero
//   body.bathing       true while in a tub (p.bathing too, and p.pose.kind === 'bath')
//   body.work(kind)    one tool use (gather.spend), kind as TOOL_COST's (pick, hoe and shovel dirty more). It counts
//                      the time worked, not the uses: a use adds the seconds since the last one (1 s at most), so the
//                      rate is the same at any swing speed (a use can come every 0.32 s, about 190 a minute)
//   body.hit()         a hit taken (combat)
//   body.butchered()   a carcass cut up (carry.js butcher / convert)
//   body.bathe(o)      E on a tub (game.placedAction 'banera'): true if the bath started, false if refused
//   body.scrub(x, y)   X at the water while wading or at the bank (true if it started; again: stop)
//   body.stopScrub()   stop scrubbing (Needs.drinkAt calls it: one crouch at a time)
//   body.onDeath()     combat.die, before going home: out of the tub or the chair where you fell, no scrub
//   body.washFace()    the basin's "Wash your face and hands"
//   body.washAlt(x, y) the scrub as an `alt` action { text, run } for the water target of Needs.aimables (world point of
//                      the aimed water), or null
//   body.aimables(p, sc, box) game.aimTargets hook: the scrub target when D offers no water target there, or null
//   body.applyGrowth() apply a pending hair or beard step now (call it only at a hidden moment); true if one changed
//   body.growth()      the reused object { hairStep 0..3, beardStep 0..4, pending } computed from the clocks
//   body.applied       { hair, beard }: the steps applied to the look, read by game.appearance() (never in player.look)
//   body.cut()         a haircut: cutAt = now (hair step back to 0 at the next apply)
//   body.shave()       a shave or beard trim: shaveAt = now
//   body.beardGrows    false stops beard growth (the mirror's "Let the beard grow" switch)
//   body.condition()   the REMARKS id (remarks.js) that holds for the player now, or null (conditions(out): all of them)
//   body.chip()        { id, text } of a garment that just crossed a tear stage (ids worn, torn; keys body.chip.<id>),
//                      for 4 s, or null. The other chips (cold, freezing, hot, soaked, filthy) are decided by
//                      ui/bodychip.js from the fields above, with its own thresholds (CHIP there): the one place
//   body.tore(id, stage) a worn piece crossed a tear stage (1 worn, 2 torn): the chip shows it for 4 s (E2, A2's tear)
//   packBd(surface) / unpackBd(bd, out)  the network int st.bd (§6), exported below
//
// Save (§2.1): out.body = { v: 1, dirt, mud, wet, blood, freshUntil, cutAt, shaveAt, beardGrows }. wetLegs, snow and
// the temperature are not saved. A save without `body` starts clean and dry, with cutAt and shaveAt = now (an old save
// never wakes up with a beard). reset() must never throw (strict hook).
import { apagada } from './opciones.js';
import { t, noun } from './i18n.js';
import { hud } from './ui/hud.js';
import { Audio } from './audio.js';
import { keys } from './input.js';
import { climate, B, WATER_Y } from './world/biomes.js';
import { nearX } from './world/planet.js';
import { aabb } from './world/fit.js';
import { inBounds, distToPath } from './world/village.js';
import { CHUNK } from './world/gen.js';
import { BULKY } from './carry-items.js';
import { clothesOf, feelOf, TEMP } from './clothing.js';

export const BODY_V = 1;
const MAX = 100;
const fin = (v, def, max = MAX) => (Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : def);
const r1 = v => Math.round(v * 10) / 10;
const cap = v => (v > MAX ? MAX : v < 0 ? 0 : v);

// E1: the clocks count and are saved, nothing is applied to the look (E3 turns this on, with appearance() and the art)
const APPLY_GROWTH = false;
const DAY_MS = 864e5, HOUR_MS = 36e5;

// ---------- rates (§2.3: per second unless noted) ----------
// Tool work, per second worked (§2.3: about 45 min of steady work reach Filthy, 70; pick, hoe and shovel about 26 min).
// A use credits the time since the last one, WORK_GAP s at most (see work())
const DIRT_WORK = 0.026, DIRT_WORK_HARD = 0.045, WORK_GAP = 1;
const HARD_TOOLS = new Set(['pico', 'azada', 'pala']);
const DIRT_BUTCHER = 12, BLOOD_BUTCHER = 8, DIRT_HIT = 1, DIRT_LAND = 2, DIRT_GROUND = 0.01;
const LAND_DROP = 2;                                     // m of fall that make a hard landing (a jump is about 1.2)
const DIRT_RAIN = 0.02, DIRT_SWIM = 8, DIRT_SWIM_MIN = 15;
const MUD_SOFT = 0.08, MUD_RAIN = 0.03, BAREFOOT = 1.5;  // per metre walked: tilled, dug or swamp; any soil on a rain day
const MUD_WADE = 10, MUD_DRY = 0.06;                     // (dry mud flakes off in about 17 min from 60, not a whole session)
const WET_RAIN = 1.1, WET_STORM = 1.8, WET_MELT = 0.8;   // melting snow: wet per point of snow (a full coat of snow melted
                                                         // by the hearth soaks you, §1.1; nothing dries while it melts)
const DRY_RATE = 0.4, DRY_FIRE = 4, DRY_COLD = 0.5, DRY_SUN = 0.5;
const SNOW_GAIN = 0.8, SNOW_MELT = 2;
const BLOOD_CARRY = 0.1, BLOOD_WASH = 10;
const BATH_CLEAN = 12, BATH_T = 15, BATH_WET = 30;       // s to clean, s in all (then you get out), wet when towelled
const SCRUB_T = 8, SCRUB_DIRT = 12, SCRUB_MIN = 10, SCRUB_WET = 35;
const BASIN = 30, BASIN_MIN = 25;
const WASH_FROM = 15;                                    // the scrub is offered above this dirt, mud or blood
// At the bank: the aimed water within the reach of drinking (needs.js DRINK_REACH, measured to the aimed point: the edge is
// nearer), or wading at least this deep
const BANK = 2.2, WADE_SCRUB = 0.25;
const FRESH_MS = 2 * HOUR_MS, FRESH_REMARK_MS = 30 * 60e3;
const TICK = 0.5;                                        // s between two refreshes of the factors and bd
// The garment chip (§7.1: the rest of the chip is ui/bodychip.js) and the shiver and the sweat of the surface
const FLASH = 4, SHIVER = 0.6, SWEAT = 0.35;
// The ground under the feet, for mud (looked at when the tile changes)
const G_FLOOR = 0, G_PATH = 1, G_SOIL = 2, G_SOFT = 3, G_DRY = 4;
const DRY_LAND = new Set([B.BEACH, B.DESERT, B.SNOW, B.ICE, B.ROCKY]);

// The gestures the network knows (social.js EMOTE_KINDS), read lazily as needs.js does (a static import would close an
// import cycle). Until it is in, or while 'scrub' is not in it, the scrub has no gesture
let emoteKinds = [];
import('./social.js').then(m => { emoteKinds = m.EMOTE_KINDS || []; }, () => {});
// Who I am, for the tub tie (accounts.js pulls in the vault and GitHub: lazily, and only the id is read)
let me = () => '';
import('./accounts.js').then(m => { me = () => String(m.Profile?.id || ''); }, () => {});

// ---------- the network int st.bd (§6) ----------
// dirt, mud, wet, snow, blood at 4 bits each (0..15, bits 0-3, 4-7, 8-11, 12-15, 16-19), bit 20 shivering, bit 21 sweat.
// Sent only when nonzero; a state without bd means clean (old clients never send it and ignore it). wetLegs does not
// travel (unpacked as 0). surface values are 0..1, so they unpack within 1/15
export const BD_CHANNELS = ['dirt', 'mud', 'wet', 'snow', 'blood'];
const BD_SHIVER = 1 << 20, BD_SWEAT = 1 << 21;
export const BD_MAX = 1 << 22;   // (every valid bd is below this)
const q4 = v => Math.max(0, Math.min(15, Math.round((Number(v) || 0) * 15)));
export function packBd(s) {
  if (!s) return 0;
  let bd = 0;
  for (let i = 0; i < BD_CHANNELS.length; i++) bd |= q4(s[BD_CHANNELS[i]]) << (4 * i);
  if (s.shiver) bd |= BD_SHIVER;
  if (s.sweat) bd |= BD_SWEAT;
  return bd;
}
export function unpackBd(bd, out = {}) {
  const n = Number.isInteger(bd) && bd > 0 && bd < BD_MAX ? bd : 0;
  for (let i = 0; i < BD_CHANNELS.length; i++) out[BD_CHANNELS[i]] = ((n >> (4 * i)) & 15) / 15;
  out.wetLegs = 0;
  out.shiver = n & BD_SHIVER ? 1 : 0;
  out.sweat = n & BD_SWEAT ? 1 : 0;
  return out;
}

// ---------- the system (game.body, registered right after game.needs) ----------
export class Body {
  constructor(game) {
    this.game = game;
    // Surface channels, 0..100 (§2.3)
    this.dirt = 0; this.mud = 0; this.wet = 0; this.wetLegs = 0; this.snow = 0; this.blood = 0;
    // Temperature (§2.2), recomputed, never saved
    this.airC = 15; this.feelC = 15; this.cold = 0; this.heat = 0;
    // Real-ms clocks (Date.now()): the fresh spell, the last haircut and the last shave
    this.freshUntil = 0;
    this.cutAt = Date.now(); this.shaveAt = Date.now();
    this.beardGrows = true;
    // What the needs read (mutated in place, never reallocated)
    this.factors = { rest: 1, regen: 1, thirst: 1, hunger: 1 };
    // The growth steps applied to the look (not saved; appearance() reads them) and the reused answers
    this.applied = { hair: 0, beard: 0 };
    this._growth = { hairStep: 0, beardStep: 0, pending: false };
    this._surface = { dirt: 0, mud: 0, wet: 0, wetLegs: 0, snow: 0, blood: 0, shiver: 0, sweat: 0 };
    this._chip = { id: '', text: '' };
    this._chipKey = { id: '', item: null };
    this._feel = { airC: 15, feelC: 15, cold: 0, heat: 0 };
    this._env = { Tl: TEMP.tlRef, season: 0, hour: 12, weather: 'sol', indoors: false, cave: false, fireD: Infinity, swim: null, W: 0, rain: 0, shade: 0, wet: 0, raining: false };
    this._clim = {};
    this.cl = clothesOf(null, {});   // what the worn clothes do (warm, rain, shade, work, outer), at every poll
    this.bd = 0;
    // (the URL switches of src/opciones.js, §11: ?cuerpo=0, ?frio=0, ?crecer=0, ?desgaste=0)
    this.off = { surface: apagada('cuerpo'), cold: apagada('frio'), grow: apagada('crecer'), tear: apagada('desgaste') };
    this.clear();
  }
  // The transient state (what reset and leaving survival forget)
  clear() {
    this.bath = null;        // { t, spot, soap, done, from: {dirt, mud, blood} } while in a tub
    this.scrubbing = null;   // { x, y, px, py, sc, t, soap, salt, crouch, emoteAt } while scrubbing at the water
    this.pollT = 0; this.tickT = 0; this.snap = true;
    this.fireD = Infinity; this.sunny = false; this.blizzard = false;
    this.workAt = -Infinity; // (g.time of the last tool use: work())
    this.tear = null;        // { id, stage, until }: the last worn piece that crossed a stage (the chip)
    this.last = null;        // { x, y, sc }: where the feet were last frame (mud per metre)
    this.tile = null;        // { tx, ty, sc, kind }: the ground kind under the feet
    this.peak = 0;           // the highest z of the current fall
  }

  // Only playing for real (survival with a player): creative, spectator and the world server keep everything at 0
  get counts() { const g = this.game; return !!g.player && g.gamemode === 'survival'; }
  // Do cold and heat change the factors? (counts, not peaceful, /gamerule doBodyWeather, ?frio=0)
  get weatherOn() { const g = this.game; return this.counts && g.difficulty !== 'peaceful' && g.rules?.doBodyWeather !== false && !this.off.cold; }
  get fresh() { return this.freshUntil > Date.now(); }
  get bathing() { return !!this.bath; }
  // Is there a soap in the bag? (the tub's text says it will use one)
  hasSoap() { const inv = this.game.inv; return !!inv && (inv.infinite || (inv.count?.('soap') || 0) > 0); }

  // ---------- hooks ----------
  reset(save = {}) {
    const b = (save && typeof save.body === 'object' && save.body) || {}, now = Date.now();
    this.dirt = fin(b.dirt, 0); this.mud = fin(b.mud, 0); this.wet = fin(b.wet, 0); this.blood = fin(b.blood, 0);
    this.wetLegs = 0; this.snow = 0;
    this.freshUntil = Number.isFinite(b.freshUntil) ? Math.min(b.freshUntil, now + FRESH_MS) : 0;
    this.cutAt = Number.isFinite(b.cutAt) && b.cutAt <= now ? b.cutAt : now;
    this.shaveAt = Number.isFinite(b.shaveAt) && b.shaveAt <= now ? b.shaveAt : now;
    this.beardGrows = b.beardGrows !== false;
    this.airC = 15; this.feelC = 15; this.cold = 0; this.heat = 0;
    const f = this.factors; f.rest = 1; f.regen = 1; f.thirst = 1; f.hunger = 1;
    this.applied.hair = 0; this.applied.beard = 0;
    this.bd = 0;
    this.clear();
    const p = this.game.player;
    if (p) p.bathing = false;
  }
  save(out) {
    out.body = { v: BODY_V, dirt: r1(this.dirt), mud: r1(this.mud), wet: r1(this.wet), blood: r1(this.blood), freshUntil: this.freshUntil, cutAt: this.cutAt, shaveAt: this.shaveAt, beardGrows: this.beardGrows };
  }

  update(dt) {
    const g = this.game, p = g.player;
    if (!p || !this.counts) { this.idle(dt, p); return; }
    if (this.off.surface) { this.dirt = this.mud = this.wet = this.wetLegs = this.snow = this.blood = 0; this.last = null; }
    else this.surfaceStep(dt, p);
    if (this.bath) this.bathStep(dt, p);
    if (this.scrubbing) this.scrubStep(dt, p);
    if ((this.pollT -= dt) <= 0 || this.snap) { this.pollT = TEMP.poll; this.poll(p); }
    if ((this.tickT -= dt) <= 0) { this.tickT = TICK; this.tick(); }
  }
  // Not in survival (creative, spectator, the world server, no player): clean, dry, comfortable, factors 1. A bath still
  // works as a pose (it ends as usual)
  idle(dt, p) {
    if (this.bath) { if (p?.pose?.kind === 'bath') this.bathStep(dt, p); else this.endBath(); }
    this.dirt = this.mud = this.wet = this.wetLegs = this.snow = this.blood = 0;
    this.cold = 0; this.heat = 0;
    const f = this.factors; f.rest = 1; f.regen = 1; f.thirst = 1; f.hunger = 1;
    this.bd = 0;
    if (this.scrubbing) this.stopScrub();
    this.snap = true; this.last = null;
  }

  // ---------- the surface, every frame (§2.3) ----------
  surfaceStep(dt, p) {
    const g = this.game, sc = g.scene, w = g.world, inWorld = sc === w, out = inWorld && !g.indoors;
    const info = g.days?.info || {}, rainDay = !!info.rain, raining = out && rainDay, wade = !!p.wading && !p.swim;
    const still = !!(p.pose || p.boat || p.aboard || p.mount);
    // Snow: settles outdoors while it snows (not under a roof); melts indoors, by a fire and above 1 °C, into wet. (Before
    // the drying: while it melts, nothing dries, or the hearth would dry the melt as fast as it came)
    let melting = false;
    if (out && info.snow && !p.swim && this.airC <= 1 && this.fireD >= TEMP.fireR) this.snow = Math.min(MAX, this.snow + SNOW_GAIN * (this.blizzard ? 2 : 1) * dt);
    else if (this.snow > 0 && (!out || this.fireD < TEMP.fireR || this.airC > 1 || !info.snow)) {
      const m = Math.min(this.snow, SNOW_MELT * dt);
      this.snow -= m; this.wet = Math.min(MAX, this.wet + m * WET_MELT); melting = m > 0;
    }
    // Water
    if (p.swim) {
      this.wet = MAX; this.mud = 0; this.wetLegs = MAX; this.snow = 0;
      if (this.dirt > DIRT_SWIM_MIN) this.dirt = Math.max(DIRT_SWIM_MIN, this.dirt - DIRT_SWIM * dt);
      this.blood = Math.max(0, this.blood - BLOOD_WASH * dt);
    } else {
      if (wade) { this.wetLegs = Math.max(this.wetLegs, Math.min(MAX, (p.depth || 0) * 100)); this.mud = Math.max(0, this.mud - MUD_WADE * dt); }
      if (raining) this.wet = Math.min(MAX, this.wet + (info.rain >= 2 ? WET_STORM : WET_RAIN) * (1 - this.cl.rain) * dt);
      else if (!this.bath && !melting) {
        // Drying: faster in the sun, by a fire and the warmer it is; at half speed in the cold
        let k = 1 + Math.max(0, this.airC) / 20 + (out && this.sunny ? DRY_SUN : 0);
        if (this.fireD < TEMP.fireR) k *= DRY_FIRE;
        else if (this.airC < 5) k *= DRY_COLD;
        const d = DRY_RATE * k * dt;
        if (this.wet > 0) this.wet = Math.max(0, this.wet - d);
        if (this.wetLegs > 0 && !wade) this.wetLegs = Math.max(0, this.wetLegs - d);
      }
      if (raining && this.dirt > 0) this.dirt = Math.max(0, this.dirt - DIRT_RAIN * dt);
    }
    // Mud: per metre walked on soft ground (tilled, dug, swamp) and, on a rain day, on any soil; it dries and flakes off
    // elsewhere while it is not raining
    const kind = this.groundKind(p, sc);
    let moved = 0;
    if (this.last && this.last.sc === sc && !still && !p.swim && !p.airborne) {
      moved = Math.hypot(p.x - this.last.x, p.y - this.last.y);
      if (moved > 1) moved = 0;   // (a teleport, a respawn, a door: not walked)
    }
    if (this.last) { this.last.x = p.x; this.last.y = p.y; this.last.sc = sc; } else this.last = { x: p.x, y: p.y, sc };
    if (moved > 0 && !wade) {
      const per = kind === G_SOFT ? MUD_SOFT : kind === G_SOIL && rainDay ? MUD_RAIN : 0;
      if (per) this.mud = Math.min(MAX, this.mud + per * moved * (this.game.inv?.equip?.pies ? 1 : BAREFOOT));
    }
    if (this.mud > 0 && !(rainDay && out) && kind !== G_SOFT) this.mud = Math.max(0, this.mud - MUD_DRY * dt);
    // Blood: carrying a carcass across the shoulders (on a horse or in a boat it rides behind or in the bow)
    const held = g.carry?.held;
    if (held && BULKY[held]?.hold === 'across' && !p.mount && !p.boat) this.blood = Math.min(MAX, this.blood + BLOOD_CARRY * dt);
    // Dirt: lying or sitting on the ground outdoors; a hard landing
    const k = p.pose?.kind;
    if (out && (k === 'floorLie' || k === 'floorSit')) this.dirt = Math.min(MAX, this.dirt + DIRT_GROUND * dt);
    if (p.airborne && !p.swim) this.peak = Math.max(this.peak, (p.z || 0) - (p.floor || 0));
    else { if (this.peak >= LAND_DROP && !p.swim && !p.wading) this.dirt = Math.min(MAX, this.dirt + DIRT_LAND); this.peak = 0; }
  }
  // What the feet stand on, looked at only when the tile changes
  groundKind(p, sc) {
    const g = this.game, w = g.world, tx = Math.floor(p.x), ty = Math.floor(p.y), c = this.tile;
    const under = sc !== w || g.indoors;
    if (c && c.tx === tx && c.ty === ty && c.sc === sc && c.under === under) return c.kind;
    let kind = G_FLOOR;
    if (!under) {
      const d = sc.delta?.(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK)), k = `${tx},${ty}`;
      if (d?.tilled?.[k] !== undefined || (sc.digH?.(tx, ty) ?? null) !== null) kind = G_SOFT;
      else if (sc.levelAt && sc.levelAt(p.x, p.y) !== null) kind = G_FLOOR;   // (a floor, a platform, furniture: built)
      else if (inBounds(tx + 0.5, ty + 0.5) && distToPath(tx + 0.5, ty + 0.5) < 1.05) kind = G_PATH;
      else {
        const b = w?.gen?.biomeAt?.(tx + 0.5, ty + 0.5);
        kind = b === B.SWAMP ? G_SOFT : DRY_LAND.has(b) ? G_DRY : G_SOIL;
      }
    }
    if (c) Object.assign(c, { tx, ty, sc, under, kind }); else this.tile = { tx, ty, sc, under, kind };
    return kind;
  }

  // ---------- the temperature, every 2 s (§2.2) ----------
  poll(p) {
    const g = this.game, sc = g.scene, w = g.world, e = this._env, days = g.days;
    this.cl = clothesOf(g.inv?.equip, this.cl);
    const cave = sc?.kind === 'grid';
    e.cave = cave;
    e.indoors = !!g.indoors;
    e.Tl = TEMP.tlRef;
    if (!cave && sc === w && w?.gen) e.Tl = climate(p.x, p.y, w.gen.seed, this._clim).Tl;
    e.season = days?.localSeason ?? 0;
    e.hour = days?.localHour ?? 12;
    e.weather = days?.weatherHere || 'sol';
    this.sunny = e.weather === 'sol' && !days?.isNight?.();   // (read every frame by the drying: kept from the poll)
    this.blizzard = e.weather === 'ventisca';
    this.fireD = this.fireNear(p, sc);
    e.fireD = this.fireD;
    e.swim = p.swim && sc === w ? (g.needs?.waterKind?.(p.x, p.y) === 'salt' ? 'sea' : 'fresh') : null;
    e.W = this.cl.warm; e.rain = this.cl.rain; e.shade = this.cl.shade;
    e.wet = Math.min(MAX, this.wet + this.wetLegs / 3);   // (wading cools only the legs: a third)
    e.raining = !!days?.raining && sc === w;
    const f = feelOf(e, this._feel);
    // (20 s of lag, so it never flickers; the first poll after a load or a mode change snaps)
    const k = this.snap ? 1 : 1 - Math.exp(-TEMP.poll / TEMP.lag);
    this.snap = false;
    this.airC += (f.airC - this.airC) * k;
    this.feelC += (f.feelC - this.feelC) * k;
    this.cold += (f.cold - this.cold) * k;
    this.heat += (f.heat - this.heat) * k;
    if (this.cold < 1e-3) this.cold = 0;
    if (this.heat < 1e-3) this.heat = 0;
  }
  // Tiles to the nearest lit fire within TEMP.fireR in this scene (a hearth, an oven, a kitchen range), or Infinity
  fireNear(p, sc) {
    if (!sc?.contentFor) return Infinity;
    const R = TEMP.fireR, cx = Math.floor(p.x / CHUNK), cy = Math.floor(p.y / CHUNK);
    let best = Infinity;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x0 = (cx + dx) * CHUNK, y0 = (cy + dy) * CHUNK;
      if (p.x < x0 - R || p.x > x0 + CHUNK + R || p.y < y0 - R || p.y > y0 + CHUNK + R) continue;
      const c = sc.contentFor(cx + dx, cy + dy);
      for (const list of [c.objects, c.flats]) if (list) for (const o of list) {
        if (!o.glow || o.off) continue;
        const d = Math.hypot(o.x - p.x, o.y - p.y);
        if (d < best) best = d;
      }
    }
    return best <= R ? best : Infinity;
  }

  // ---------- the factors and bd, at 2 Hz (§2.4, §6) ----------
  tick() {
    const g = this.game, f = this.factors;
    if (this.weatherOn) {
      const cold = this.cold, heat = this.heat;
      f.rest = 1 + 1.0 * cold - (this.fresh ? 0.15 : 0);
      f.regen = (1 - 0.4 * cold) * (1 - 0.25 * heat);
      f.thirst = 1 + 0.8 * heat;
      f.hunger = 1 + 0.3 * cold;
    } else { f.rest = 1; f.regen = 1; f.thirst = 1; f.hunger = 1; }
    this.bd = packBd(this.surface());
    // (two players who got into the same tub at once: the one whose id sorts later gets out)
    if (this.bath) { const q = this.tubTaken(this.bath.spot); if (q && String(q.id) < me()) { g.rest?.stand(); hud.toast(t('body.bath.taken')); } }
  }

  // ---------- reads ----------
  surface() {
    const s = this._surface, off = this.off.surface || !this.counts;
    s.dirt = off ? 0 : this.dirt / MAX; s.mud = off ? 0 : this.mud / MAX; s.wet = off ? 0 : this.wet / MAX;
    s.wetLegs = off ? 0 : this.wetLegs / MAX; s.snow = off ? 0 : this.snow / MAX; s.blood = off ? 0 : this.blood / MAX;
    const temp = this.counts && !this.off.cold;
    s.shiver = temp && this.cold >= SHIVER ? 1 : 0;
    s.sweat = temp && this.heat >= SWEAT ? 1 : 0;
    return s;
  }
  growth() {
    const g = this._growth, now = Date.now(), look = this.game.player?.look;
    const days = Math.max(0, now - this.cutAt) / DAY_MS;
    g.hairStep = days < 7 ? 0 : days < 14 ? 1 : days < 28 ? 2 : 3;
    const h = Math.max(0, now - this.shaveAt) / HOUR_MS, male = look?.sex === 'chico';
    g.beardStep = !male || !this.beardGrows ? 0 : h < 20 ? 0 : h < 72 ? 1 : h < 192 ? 2 : h < 384 ? 3 : 4;
    g.pending = APPLY_GROWTH && !this.off.grow && this.counts && (g.hairStep !== this.applied.hair || g.beardStep !== this.applied.beard);
    return g;
  }
  // The REMARKS ids (remarks.js) that hold for the player now, good news first (§4.5), into out (reused). The ones Body
  // cannot see (haircut, new_clothes, couple) are for E2/E3 to add where that data lives
  conditions(out = []) {
    out.length = 0;
    const g = this.game, p = g.player;
    if (!p || !this.counts) return out;
    const eq = g.inv?.equip || {}, snowing = !!g.days?.info?.snow && g.scene === g.world && !g.indoors;
    // good news
    if (this.freshUntil - FRESH_MS + FRESH_REMARK_MS > Date.now()) out.push('fresh');
    if (eq.outer && snowing) out.push('wrapped_up');
    // the rest, by priority
    const held = g.carry?.held, hk = held && BULKY[held]?.hold;
    if (hk === 'across') out.push('carcass');
    else if (held === 'log') out.push('log');
    if (!this.off.surface) {
      if (this.blood >= 40) out.push('blood');
      if (this.wet >= 70) out.push('soaked');
      if (this.snow >= 50) out.push('snowy');
      if (this.mud >= 60) out.push('muddy');
      if (this.dirt >= 70) out.push('filthy');
    }
    for (const k in eq) if ((eq[k]?.tear || 0) >= 75 && k !== 'interiorArriba' && k !== 'interiorAbajo') { out.push('torn'); break; }
    if (!eq.torso && !eq.piernas) out.push('underwear');
    else if (!eq.pies) out.push('barefoot');
    if (this.weatherOn) {
      if (this.cold >= 0.6) out.push('underdressed');
      else if (this.heat >= 0.5 && eq.outer) out.push('overdressed');
    }
    return out;
  }
  condition() { return this.conditions(this._conds ||= [])[0] || null; }
  // The garment chip (§7.1): a piece that just crossed a tear stage, with its name, for 4 s; null otherwise. The other
  // chips are ui/bodychip.js's (it reads the fields: one set of rules, there)
  chip() {
    if (!this.counts || !this.tear || this.game.time >= this.tear.until) return null;
    const id = this.tear.stage >= 2 ? 'torn' : 'worn', item = this.tear.id, out = this._chip, k = this._chipKey;
    if (k.id !== id || k.item !== item) {   // (the text is made again only when it changes: no garbage per frame)
      k.id = id; k.item = item;
      out.id = id; out.text = t(`body.chip.${id}`, { item: noun('item', item) });
    }
    return out;
  }
  // A worn piece crossed a tear stage (A2's tear calls it, E2): its chip for 4 s
  tore(id, stage) { if (stage > 0 && id) this.tear = { id, stage, until: this.game.time + FLASH }; }

  // ---------- what the other systems call ----------
  work(kind) {
    if (!this.counts || this.off.surface) return;
    const now = this.game.time, worked = Math.min(WORK_GAP, Math.max(0, now - this.workAt));
    this.workAt = now;
    this.dirt = Math.min(MAX, this.dirt + (HARD_TOOLS.has(kind) ? DIRT_WORK_HARD : DIRT_WORK) * worked * (1 - (this.cl.work || 0)));
  }
  hit() { if (this.counts && !this.off.surface) this.dirt = Math.min(MAX, this.dirt + DIRT_HIT); }
  butchered() {
    if (!this.counts || this.off.surface) return;
    this.dirt = Math.min(MAX, this.dirt + DIRT_BUTCHER);
    this.blood = Math.min(MAX, this.blood + BLOOD_BUTCHER);
  }

  // ---------- the bath (§4.1) ----------
  // E on a tub: get in (rest.bath: the 'bath' pose), for about 15 s; moving, E or the time get you out
  bathe(o) {
    const g = this.game, p = g.player;
    if (!p || !o || g.gamemode === 'spectator' || g.busy || g.dying) return false;
    if (this.bath && p.pose?.kind === 'bath') { g.rest.stand(); return false; }
    if (g.carry?.refuse()) return false;
    if (p.swim || (p.depth || 0) > 0.3 || p.mount || p.boat || p.aboard) return false;
    const spot = g.rest.bathSpot(o);
    if (this.tubTaken(spot)) { hud.toast(t('body.bath.taken')); Audio.error(); return false; }
    if (this.scrubbing) this.stopScrub();
    if (g.needs?.drinking) g.needs.stopDrinking();
    g.rest.bath(o);
    if (p.pose?.kind !== 'bath') return false;
    this.bath = { t: 0, spot, soap: this.hasSoap(), done: false, from: { dirt: this.dirt, mud: this.mud, blood: this.blood } };
    this.snow = 0;
    Audio.splash();
    return true;
  }
  // Another player bathing in this tub (their st.ba, near the spot), or null
  tubTaken(spot) {
    const live = this.game.live;
    if (!spot || !live?.joined) return null;
    for (const q of live.others) {
      const e = q.entity;
      if (q.sc !== 'world' || !e?.bathing) continue;
      const [x, y] = e.to || [e.x, e.y];
      if (Math.hypot(nearX(x, spot[0]) - spot[0], y - spot[1]) < 0.6) return q;
    }
    return null;
  }
  bathStep(dt, p) {
    const b = this.bath;
    if (p.pose?.kind !== 'bath') { this.endBath(); return; }
    b.t += dt;
    const k = Math.max(0, 1 - b.t / BATH_CLEAN);
    if (!this.off.surface) {
      this.dirt = Math.min(this.dirt, b.from.dirt * k); this.mud = Math.min(this.mud, b.from.mud * k); this.blood = Math.min(this.blood, b.from.blood * k);
      this.wet = MAX; this.snow = 0;
    }
    if (!b.done && b.t >= BATH_CLEAN) this.bathClean(b);
    if (b.t >= BATH_T) { this.game.rest.stand(); this.endBath(); }
  }
  // Clean: with soap (one is used) also fresh for two real hours
  bathClean(b) {
    const g = this.game;
    b.done = true;
    this.dirt = 0; this.mud = 0; this.blood = 0; this.snow = 0;
    const soap = this.counts && b.soap && this.hasSoap();
    if (soap) { if (!g.inv.infinite) g.inv.remove('soap', 1); this.freshUntil = Date.now() + FRESH_MS; }
    g.gather?.float(t(soap ? 'body.bath.fresh' : 'body.bath.done'), '#a8f0ff');
    Audio.blip();
  }
  // Out of the tub (stood up, moved, the time, a reset): towelled, a little damp
  endBath() {
    const b = this.bath, p = this.game.player;
    this.bath = null;
    if (p) p.bathing = false;
    if (!b) return;
    if (!this.off.surface && this.counts) this.wet = Math.min(this.wet, BATH_WET);
  }
  // Dying (combat.die, before goHome): no scrub, and out of the tub (or the chair, the floor) where you fell, without
  // rest.stand's step back to where you got in: else the bath's own end, 15 s in, would take you back to the tub
  onDeath() {
    const g = this.game, p = g.player;
    if (this.scrubbing) this.stopScrub();
    if (p?.pose && g.rest) { g.rest.back = null; g.rest.stand(); }
    this.endBath();
  }

  // ---------- the river, the lake and the sea (§4.2) ----------
  // Something worth washing off?
  washable() { return !this.off.surface && this.counts && (this.dirt > WASH_FROM || this.mud > WASH_FROM || this.blood > WASH_FROM); }
  // Can the player scrub at the water at world point (x, y)? Wading deep enough, or standing at the bank
  canScrubAt(p, x, y) {
    if (!p || p.swim || p.pose || p.boat || p.aboard || p.mount || p.headUnder || this.game.carry?.held) return false;
    if (p.wading && (p.depth || 0) >= WADE_SCRUB) return true;
    return Math.hypot(nearX(x, p.x) - p.x, y - p.y) <= BANK;
  }
  // The scrub as X on the water target of Needs.aimables (§9 hook 4), or null
  washAlt(x, y) {
    const p = this.game.player;
    if (this.scrubbing) return { text: t('body.scrub.stop'), run: () => this.stopScrub() };
    if (!this.washable() || !Number.isFinite(x) || !Number.isFinite(y) || !this.canScrubAt(p, x, y)) return null;
    return { text: t('body.scrub'), run: () => this.scrub(x, y) };
  }
  // game.aimTargets: when Plan D puts no target on the water under the cursor (above 90 % of thirst), the scrub is the
  // main action there. The same slab as D's, through needs.waterAim (the ray is cast once per frame)
  aimables(p, sc, box) {
    const g = this.game, n = g.needs;
    if (!n || sc !== g.world || !p || p.swim || p.headUnder || p.boat || p.aboard) return null;
    if (!this.scrubbing && !this.washable()) return null;
    const hit = n.waterAim?.(p);
    if (!hit || !this.canScrubAt(p, hit.x, hit.y)) return null;
    // (D has a target there: the scrub is its X. Needs runs before Body and says what it gave this frame; asked again only
    // if it did not)
    if (n.aimFrame === g.frameNo ? n.aimGave : n.aimables(p, sc, box)) return null;
    // (one target per water tile, reused while the cursor stays on it: no garbage per frame; its act reads the point now)
    const c = (this._aim ||= { tx: NaN, ty: NaN, x: 0, y: 0, out: null });
    c.x = hit.x; c.y = hit.y;
    if (c.tx !== hit.tx || c.ty !== hit.ty) {
      c.tx = hit.tx; c.ty = hit.ty;
      const slab = { ...aabb(hit.tx, hit.ty, hit.tx + 1, hit.ty + 1), y0: WATER_Y - 0.06, y1: WATER_Y + 0.02, abs: true };
      // (E and X both wash here: X is the key the tip and the controls name, wherever the target comes from)
      c.out = [{ kind: 'sys', box: slab, act: () => { const a = this.washAlt(c.x, c.y); return a && { text: a.text, run: a.run, alt: a }; } }];
    }
    return c.out;
  }
  // Scrub at the water: a crouch and a scrubbing gesture for about 8 s, stopped by moving. Fresh water with soap in the
  // bag: one is used at the end, dirt goes to 0 and you are fresh; the sea washes too, without soap's effect
  scrub(x, y) {
    const g = this.game, p = g.player;
    if (this.scrubbing) { this.stopScrub(); return false; }
    if (!this.canScrubAt(p, x, y) || g.busy || this.bath) return false;
    if (g.needs?.drinking) g.needs.stopDrinking();
    const salt = g.needs?.waterKind?.(x, y) === 'salt';
    this.scrubbing = { x, y, px: p.x, py: p.y, sc: g.scene, t: 0, salt, soap: !salt && this.hasSoap(), crouch: !!p.crouch, land: !p.wading, emoteAt: -Infinity };
    p.crouch = true;   // (st.cr shows it to the others)
    Audio.plop();
    g.gather?.chips?.(x, y, 'water', 6);
    return true;
  }
  stopScrub() {
    const s = this.scrubbing, p = this.game.player;
    this.scrubbing = null;
    if (s && p && !p.swim) p.crouch = s.crouch;
  }
  scrubStep(dt, p) {
    const g = this.game, s = this.scrubbing;
    const moved = Math.hypot(p.x - s.px, p.y - s.py) > (s.land ? 0.6 : 1);
    if (keys.up || keys.down || keys.left || keys.right || keys.space || moved || p.swim || p.pose || p.boat || p.mount || p.aboard || g.scene !== s.sc || g.carry?.held || g.busy) { this.stopScrub(); return; }
    s.t += dt;
    if (!this.off.surface) {
      const floor = s.soap ? 0 : SCRUB_MIN;
      if (this.dirt > floor) this.dirt = Math.max(floor, this.dirt - SCRUB_DIRT * dt);
      this.mud = Math.max(0, this.mud - MUD_WADE * dt);
      this.blood = Math.max(0, this.blood - BLOOD_WASH * dt);
      if (this.wet < SCRUB_WET) this.wet = SCRUB_WET;
    }
    if (!p.emote && g.time - s.emoteAt > 1.6 && emoteKinds.includes('scrub') && g.social?.canEmote?.(p)) { s.emoteAt = g.time; g.social.emote(p, 'scrub'); }
    if (Math.floor(s.t / 2) !== Math.floor((s.t - dt) / 2)) { Audio.plop(); g.gather?.chips?.(s.x, s.y, 'water', 4); }
    if (s.t >= SCRUB_T) {
      if (s.soap && this.counts && this.hasSoap()) {
        if (!g.inv.infinite) g.inv.remove('soap', 1);
        this.dirt = 0;
        this.freshUntil = Date.now() + FRESH_MS;
        g.gather?.float(t('body.scrub.fresh'), '#a8f0ff');
      } else g.gather?.float(t(this.dirt <= 0 && this.mud <= 0 && this.blood <= 0 ? 'body.scrub.clean' : 'body.scrub.done'), '#a8f0ff');
      this.stopScrub();
    }
  }
  // The basin: face and hands (dirt −30 once, not below 25)
  washFace() {
    const g = this.game, p = g.player;
    if (!p) return;
    if (this.counts && !this.off.surface && this.dirt > BASIN_MIN) this.dirt = Math.max(BASIN_MIN, this.dirt - BASIN);
    Audio.plop();
    if (emoteKinds.includes('scrub') && g.social?.canEmote?.(p)) g.social.emote(p, 'scrub');
  }

  // ---------- growth (§2.5) ----------
  // Apply a pending step now (only at a hidden moment: the load, the sleep fade, a door, the mirror, the barber). In E1
  // nothing is applied (APPLY_GROWTH): the clocks only count
  applyGrowth() {
    const g = this.growth();
    if (!g.pending) return false;
    this.applied.hair = g.hairStep; this.applied.beard = g.beardStep;
    return true;
  }
  cut() { this.cutAt = Date.now(); }
  shave() { this.shaveAt = Date.now(); }

  // ---------- /body (commands.js, op only): for testing without waiting for real days ----------
  // what: 'hair' | 'beard' (n days since the cut or the shave), 'dirt' (n 0..100), 'wet', 'clean'. Returns the line to
  // say, or null for a usage error
  testSet(what, n) {
    const now = Date.now(), days = Math.max(0, Math.min(365, Number(n) || 0));
    if (what === 'hair') { this.cutAt = now - days * DAY_MS; this.applyGrowth(); return t('cmd.body.hair', { n: days }); }
    if (what === 'beard') { this.shaveAt = now - days * DAY_MS; this.applyGrowth(); return t('cmd.body.beard', { n: days }); }
    if (!this.counts) return t('cmd.body.survival');
    if (what === 'dirt') { if (!Number.isFinite(Number(n))) return null; this.dirt = cap(Number(n)); this.tickT = 0; return t('cmd.body.dirt', { n: Math.round(this.dirt) }); }
    if (what === 'wet') { this.wet = MAX; this.tickT = 0; return t('cmd.body.wet'); }
    if (what === 'clean') { this.dirt = this.mud = this.wet = this.wetLegs = this.snow = this.blood = 0; this.tickT = 0; return t('cmd.body.clean'); }
    return null;
  }
}
