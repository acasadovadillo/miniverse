// The player's body: what the world leaves on it (dirt, mud, wet, snow, blood), the felt temperature, the "fresh" spell
// after a soap bath and the hair and beard growth clocks. Design: docs/planes/gta/PLAN-E-cuerpo-aspecto.md §2, §4.1,
// §4.2, §6, §7.1 (the Critic notes appendix wins over older lines). Owner: Track A1.
//
// Body never owns a bar: it feeds Plan D's needs (needs.js) through `factors`, and those reads are guarded
// (`g.body?.factors.rest ?? 1`), so needs.js works without it. No health damage from cold or heat (user decision 2).
//
// Phase E1: the surface, the temperature, the factors, washing (tub, river, basin) and the chip are real. Phase E2: the
// clothes tear (§3.2: in place on inv.equip, inv.changed() only at a stage crossing), the remark conditions are complete
// (new_clothes, couple) and the worn or torn piece chip comes from the tear. Phase E3: the growth clocks show in the look
// (applied, read by game.appearance()), only at hidden moments, and the barber and the mirror (barber.js) set them back.
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
//                      rate is the same at any swing speed (a use can come every 0.32 s, about 190 a minute). The same
//                      worked time tears the torso layer (torso, encima, outer), less under an apron (§3.2)
//   body.hit()         a hit taken (combat): a little dirt, and tear on one random worn piece
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
//   body.condition()   the REMARKS id (remarks.js) that holds for the player now, or null; conditions(out) gives all of
//                      them, good news first (fresh, haircut, new_clothes, couple, wrapped_up), then by REMARKS order.
//                      haircut: the day of a haircut at the barber's; new_clothes: a garment never worn before put on
//                      today (and still on); couple: your partner (social.isPartner) within 3 tiles, both outdoors
//   body.chip()        { id, text } of a garment that just crossed a tear stage (ids worn, torn; keys body.chip.<id>),
//                      for 4 s, or null. The other chips (cold, freezing, hot, soaked, filthy) are decided by
//                      ui/bodychip.js from the fields above, with its own thresholds (CHIP there): the one place
//   body.tore(id, stage) a worn piece crossed a tear stage (1 worn, 2 torn): the chip shows it for 4 s
//   tear (§3.2)        it.tear 0..100 on the pieces of inv.equip (inventory.js keeps it in extraOf and wear/unwear),
//                      grown in place by Body: worked time with the tools (torso layer), sprinting through a forest, pines
//                      or past a bush (legs), lying on the ground (torso layer and legs) or crawling crouched (legs),
//                      swimming clothed (all), a hit (one piece). Rates in clothing.js TEAR_RATE. Accumulated every frame
//                      in a few numbers and laid on the pieces at 2 Hz; inv.changed() once, only when a piece crosses 40,
//                      75 or 100. Never in creative, spectator, on the server, or with ?desgaste=0
//   packBd(surface) / unpackBd(bd, out)  the network int st.bd (§6), exported below
//
// Save (§2.1): out.body = { v: 1, dirt, mud, wet, blood, freshUntil, cutAt, shaveAt, beardGrows }. wetLegs, snow and
// the temperature are not saved. A save without `body` starts clean and dry, with cutAt and shaveAt = now (an old save
// never wakes up with a beard). reset() must never throw (strict hook).
import { apagada } from './opciones.js';
import { t } from './i18n.js';
import { itemNoun } from './items.js';
import { hud } from './ui/hud.js';
import { Audio } from './audio.js';
import { keys } from './input.js';
import { climate, B, WATER_Y } from './world/biomes.js';
import { nearX } from './world/planet.js';
import { aabb } from './world/fit.js';
import { inBounds, distToPath } from './world/village.js';
import { CHUNK } from './world/gen.js';
import { BULKY } from './carry-items.js';
import { dressed } from './looks.js';
import { clothesOf, feelOf, roomFire, TEMP, TEAR, TEAR_RATE, TEAR_TOUGH, tearStage, canTear } from './clothing.js';

export const BODY_V = 1;
const MAX = 100;
const fin = (v, def, max = MAX) => (Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : def);
const r1 = v => Math.round(v * 10) / 10;
const cap = v => (v > MAX ? MAX : v < 0 ? 0 : v);

const DAY_MS = 864e5, HOUR_MS = 36e5;
const GROW_WAIT = 1800;   // s a grown step waits for a hidden moment before showing while you stand still (§2.5)

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
export const G_FLOOR = 0, G_PATH = 1, G_SOIL = 2, G_SOFT = 3, G_DRY = 4;
const DRY_LAND = new Set([B.BEACH, B.DESERT, B.SNOW, B.ICE, B.ROCKY]);
// Tear (§3.2; the rates are clothing.js TEAR_RATE). Where it lands: the torso layer (tools, lying down), the legs
// (sprinting through the undergrowth, crawling), everything (swimming)
const TORSO_LAYER = ['torso', 'encima', 'outer'], GROUND_LAYER = ['torso', 'encima', 'outer', 'piernas'];
const ROUGH = new Set([B.FOREST, B.PINES, B.SWAMP]);   // sprinting here tears the legs (and past a bush anywhere: BUSH_R)
const BUSH_R = 1.1;                           // tiles from a bush's centre (a bush is solid: this is brushing past it)
const OVERDRESSED_HEAT = 0.1;                 // a coat on when it is warm enough to feel it: the 'overdressed' remark (a coat in a village summer afternoon)
const NEW_TEAR = 0.5;                         // a piece with less tear than this has never really been worn (new_clothes)
const COUPLE_R = 3;                           // tiles to your partner for the couple remark

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
    this._env = { Tl: TEMP.tlRef, season: 0, hour: 12, weather: 'sol', indoors: false, pull: undefined, cave: false, fireD: Infinity, swim: null, W: 0, rain: 0, shade: 0, wet: 0, raining: false };
    this._clim = {};
    this.cl = clothesOf(null, {});   // what the worn clothes do (warm, rain, shade, work, outer), at every poll
    this.bd = 0;
    // Seconds of each tearing action since the last flush (tick): grown every frame, laid on the pieces at 2 Hz
    this.wearAcc = { work: 0, sprint: 0, ground: 0, crawl: 0, swim: 0 };
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
    this.tearFlash = null;   // { id, stage, until }: the last worn piece that crossed a stage (the chip)
    this.last = null;        // { x, y, sc }: where the feet were last frame (mud per metre)
    this.tile = null;        // { tx, ty, sc, kind }: the ground kind under the feet
    this.peak = 0;           // the highest z of the current fall
    const a = this.wearAcc; if (a) { a.work = 0; a.sprint = 0; a.ground = 0; a.crawl = 0; a.swim = 0; }
    // new_clothes: the never-worn piece put on today, by slot and id:colour (the inventory makes a new object each time
    // a piece is put on, so taking it off and on again keeps it new that day)
    this.invRef = null; this.invV = -1;
    this.newDay = -1; this.newSlot = ''; this.newKey = '';
    this.cutDay = -1;        // (the day of a haircut: the haircut remark)
    this.growT = 0;          // (how long a growth step has waited for a hidden moment)
    this.warmK = -1; this.warmBase = null;   // (the look to come asked for: growthTick)
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
    this.applyGrowth();   // (the load is a hidden moment: what grew while away shows from the start)
  }
  save(out) {
    out.body = { v: BODY_V, dirt: r1(this.dirt), mud: r1(this.mud), wet: r1(this.wet), blood: r1(this.blood), freshUntil: this.freshUntil, cutAt: this.cutAt, shaveAt: this.shaveAt, beardGrows: this.beardGrows };
  }

  update(dt) {
    const g = this.game, p = g.player;
    if (!p || !this.counts) { this.idle(dt, p); return; }
    if (this.off.surface) { this.dirt = this.mud = this.wet = this.wetLegs = this.snow = this.blood = 0; this.last = null; }
    else this.surfaceStep(dt, p);
    if (!this.off.tear) this.tearStep(dt, p);
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
    let kind = G_FLOOR, rough = false, biome;
    if (!under) {
      const d = sc.delta?.(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK)), k = `${tx},${ty}`;
      if (d?.tilled?.[k] !== undefined || (sc.digH?.(tx, ty) ?? null) !== null) kind = G_SOFT;
      else if (sc.levelAt && sc.levelAt(p.x, p.y) !== null) kind = G_FLOOR;   // (a floor, a platform, furniture: built)
      else if (inBounds(tx + 0.5, ty + 0.5) && distToPath(tx + 0.5, ty + 0.5) < 1.05) kind = G_PATH;
      else {
        const b = w?.gen?.biomeAt?.(tx + 0.5, ty + 0.5);
        kind = b === B.SWAMP ? G_SOFT : DRY_LAND.has(b) ? G_DRY : G_SOIL;
        rough = ROUGH.has(b);
        biome = b;
      }
    }
    // (bush: whether one is within reach, looked at only when asked, sprinting: null until then)
    const tl = c || (this.tile = {});
    tl.tx = tx; tl.ty = ty; tl.sc = sc; tl.under = under; tl.kind = kind; tl.rough = rough; tl.biome = biome; tl.bush = null;
    return kind;
  }
  // Is the ground under the feet undergrowth that tears the legs at a sprint? A forest or pines off the paths, or a bush
  // within BUSH_R anywhere outdoors (in the chunk underfoot: the content is cached by the scene)
  roughUnder(p, sc) {
    const kind = this.groundKind(p, sc), c = this.tile;
    if (c.rough) return true;
    if (c.under || kind === G_FLOOR || kind === G_PATH) return false;
    if (c.bush === null) {
      c.bush = false;
      const list = sc.contentFor?.(Math.floor(p.x / CHUNK), Math.floor(p.y / CHUNK))?.objects;
      if (list) for (const o of list) if (o.kind === 'bush' && Math.hypot(o.x - p.x, o.y - p.y) < BUSH_R) { c.bush = true; break; }
    }
    return c.bush;
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
    const room = sc === w ? g.room : null;   // (structure.js roomAt: a shut room keeps the warmth, a porch hardly)
    e.pull = room?.kind ? TEMP.pull[room.kind] : undefined;
    this.fireD = roomFire(room, this.fireNear(p, sc));
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
    this.flushTear();
    this.scanWorn();
    this.growthTick();
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
    g.pending = !this.off.grow && this.counts && (g.hairStep !== this.applied.hair || g.beardStep !== this.applied.beard);
    return g;
  }
  // The REMARKS ids (remarks.js) that hold for the player now, good news first (§4.5), into out (reused). The ones Body
  // cannot see come from where that data lives
  conditions(out = []) {
    out.length = 0;
    const g = this.game, p = g.player;
    if (!p || !this.counts) return out;
    const eq = g.inv?.equip || {}, snowing = !!g.days?.info?.snow && g.scene === g.world && !g.indoors;
    // good news (in REMARKS order)
    const today = g.days?.dayIndex;
    if (this.freshUntil - FRESH_MS + FRESH_REMARK_MS > Date.now()) out.push('fresh');
    if (this.cutDay >= 0 && this.cutDay === today) out.push('haircut');
    const np = this.newKey && this.newDay === today && eq[this.newSlot];
    if (np && np.id + ':' + (np.color || '') === this.newKey && !((np.tear || 0) >= NEW_TEAR)) out.push('new_clothes');
    if (this.partnerNear(p)) out.push('couple');
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
    // (a piece that can be seen: socks inside boots and what the wool coat covers do not count; realperson.js toReal)
    const coat = eq.outer?.id === 'wool_coat';
    for (const k in eq) {
      if (!canTear(k, eq[k]) || tearStage(eq[k].tear || 0) < 2) continue;
      if ((k === 'calcetines' && eq.pies) || (coat && (k === 'torso' || k === 'encima'))) continue;
      out.push('torn'); break;
    }
    if (!eq.torso && !eq.piernas) out.push('underwear');
    else if (!eq.pies) out.push('barefoot');
    if (this.weatherOn) {
      if (this.cold >= 0.6) out.push('underdressed');
      else if (this.heat >= OVERDRESSED_HEAT && eq.outer) out.push('overdressed');
    }
    return out;
  }
  condition() { return this.conditions(this._conds ||= [])[0] || null; }
  // Your partner (a child in common: social.isPartner) within COUPLE_R tiles, both out in the world
  partnerNear(p) {
    const g = this.game, L = g.live, S = g.social;
    if (!L?.joined || !L.peers?.size || typeof S?.isPartner !== 'function' || g.scene !== g.world || g.indoors) return false;
    for (const q of L.peers.values()) {
      const e = q.entity;
      if (!e || !q.playing || q.server || q.sc !== 'world' || e.gm === 3) continue;
      if (Math.hypot(nearX(e.x, p.x) - p.x, e.y - p.y) <= COUPLE_R && S.isPartner(q)) return true;
    }
    return false;
  }
  // The garment chip (§7.1): a piece that just crossed a tear stage, with its name, for 4 s; null otherwise. The other
  // chips are ui/bodychip.js's (it reads the fields: one set of rules, there)
  chip() {
    if (!this.counts || !this.tearFlash || this.game.time >= this.tearFlash.until) return null;
    const id = this.tearFlash.stage >= 2 ? 'torn' : 'worn', item = this.tearFlash.id, out = this._chip, k = this._chipKey;
    if (k.id !== id || k.item !== item) {   // (the text is made again only when it changes: no garbage per frame)
      k.id = id; k.item = item;
      out.id = id; out.text = t(`body.chip.${id}`, { item: itemNoun(item) });   // (itemNoun: the older ids, camisa…, have no key)
    }
    return out;
  }
  // A worn piece crossed a tear stage (addTear, /body tear): its chip for 4 s
  tore(id, stage) { if (stage > 0 && id) this.tearFlash = { id, stage, until: this.game.time + FLASH }; }

  // ---------- what the other systems call ----------
  work(kind) {
    if (!this.counts) return;
    const now = this.game.time, worked = Math.min(WORK_GAP, Math.max(0, now - this.workAt));
    this.workAt = now;
    if (!this.off.surface) this.dirt = Math.min(MAX, this.dirt + (HARD_TOOLS.has(kind) ? DIRT_WORK_HARD : DIRT_WORK) * worked * (1 - (this.cl.work || 0)));
    if (!this.off.tear) this.wearAcc.work += worked;
  }
  hit() {
    if (!this.counts) return;
    if (!this.off.surface) this.dirt = Math.min(MAX, this.dirt + DIRT_HIT);
    if (!this.off.tear) this.tearRandom(TEAR_RATE.hit);
  }
  butchered() {
    if (!this.counts || this.off.surface) return;
    this.dirt = Math.min(MAX, this.dirt + DIRT_BUTCHER);
    this.blood = Math.min(MAX, this.blood + BLOOD_BUTCHER);
  }

  // ---------- tear (§3.2) ----------
  // Every frame: only seconds are added up here (no piece is touched, nothing allocated)
  tearStep(dt, p) {
    const a = this.wearAcc;
    if (p.swim) { a.swim += dt; return; }
    const k = p.pose?.kind;
    if (k === 'floorLie') { a.ground += dt; return; }
    if (p.pose || p.mount || p.boat || p.aboard || p.airborne || !p.moving) return;
    if (p.crouch) a.crawl += dt;
    else if (p.sprinting && this.roughUnder(p, this.game.scene)) a.sprint += dt;
  }
  // At 2 Hz (tick): the seconds added up, laid on the worn pieces in place. inv.changed() once if a piece crossed a stage
  flushTear() {
    const a = this.wearAcc, eq = this.game.inv?.equip;
    if (!eq || !this.counts || this.off.tear) { a.work = 0; a.sprint = 0; a.ground = 0; a.crawl = 0; a.swim = 0; return; }
    const R = TEAR_RATE;
    let crossed = false;
    // (tool work: the apron or coat takes its full share, the torso piece under it keeps 1 − work)
    if (a.work > 0) crossed = this.tearSlots(eq, TORSO_LAYER, R.work * a.work, 1 - (this.cl.work || 0)) || crossed;
    if (a.ground > 0) crossed = this.tearSlots(eq, GROUND_LAYER, R.ground * a.ground) || crossed;
    if (a.crawl > 0 || a.sprint > 0) {
      // (the legs: trousers or a skirt; with neither, a long tunic takes it)
      const legs = eq.piernas ? 'piernas' : eq.torso?.id === 'tunica_larga' ? 'torso' : null, it = legs && eq[legs];
      if (canTear(legs, it)) crossed = this.addTear(it, R.ground * a.crawl + R.sprint * a.sprint) || crossed;
    }
    if (a.swim > 0) { const n = R.swim * a.swim; for (const k in eq) if (canTear(k, eq[k])) crossed = this.addTear(eq[k], n) || crossed; }
    a.work = 0; a.sprint = 0; a.ground = 0; a.crawl = 0; a.swim = 0;
    if (crossed) this.game.inv.changed();
  }
  tearSlots(eq, slots, n, torsoMul = 1) {
    if (!(n > 0)) return false;
    let crossed = false;
    for (let i = 0; i < slots.length; i++) {
      const k = slots[i], it = eq[k];
      if (canTear(k, it)) crossed = this.addTear(it, k === 'torso' ? n * torsoMul : n) || crossed;
    }
    return crossed;
  }
  // A hit taken: n of tear on one worn piece picked at random (none worn: nothing)
  tearRandom(n) {
    const eq = this.game.inv?.equip;
    if (!eq) return;
    let count = 0;
    for (const k in eq) if (canTear(k, eq[k])) count++;
    if (!count) return;
    let pick = Math.floor(Math.random() * count);
    for (const k in eq) if (canTear(k, eq[k]) && pick-- === 0) { if (this.addTear(eq[k], n)) this.game.inv.changed(); return; }
  }
  // n more tear on one piece, in place (up to 100: rags, the piece stays). True when it crossed 40, 75 or 100; a new stage
  // shows its chip (body.chip)
  addTear(it, n) {
    const t0 = Number.isFinite(it.tear) ? Math.max(0, it.tear) : 0;
    n *= TEAR_TOUGH[it.id] ?? 1;
    if (t0 >= TEAR.rags || !(n > 0)) return false;
    const t1 = Math.min(TEAR.rags, t0 + n), s0 = tearStage(t0), s1 = tearStage(t1);
    it.tear = t1;
    if (s1 !== s0) this.tore(it.id, s1);
    return s1 !== s0 || t1 >= TEAR.rags;
  }
  // When what is worn changes (inv.v): a garment never worn before (no donned mark on the piece, little tear) put on today
  // is new clothes. Putting it on marks the piece itself (donned: 1, kept by the inventory, chests, drops and the saves:
  // inventory.js extraOf), so taking it off and on, a later session or a mend never make it new again. The first look at
  // an inventory only marks what is on (an older save's clothes are not new)
  scanWorn() {
    const inv = this.game.inv;
    if (!inv?.equip) return;
    const first = inv !== this.invRef;
    if (!first && inv.v === this.invV) return;
    this.invRef = inv; this.invV = inv.v;
    const eq = inv.equip;
    for (const k in eq) {
      const it = eq[k];
      if (!canTear(k, it) || it.donned) continue;
      it.donned = 1;   // (in place: saved with the equip; no inv.changed needed)
      if (!first && this.counts && !((it.tear || 0) >= NEW_TEAR)) { this.newDay = this.game.days?.dayIndex ?? -1; this.newSlot = k; this.newKey = `${it.id}:${it.color || ''}`; }
    }
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
  // Apply a pending step now (only at a hidden moment: the load, the sleep fade, a door, a respawn, the mirror, the
  // barber). game.appearance() reads `applied`
  applyGrowth() {
    const g = this.growth();
    this.growT = 0;
    if (!g.pending) return false;
    this.applied.hair = g.hairStep; this.applied.beard = g.beardStep;
    this.game.view3d?.actors?.rush?.();
    return true;
  }
  // A haircut or a shave shows at once, in creative too (what had grown in survival goes)
  cut() { this.cutAt = Date.now(); this.cutDay = this.game.days?.dayIndex ?? -1; this.applied.hair = 0; this.game.view3d?.actors?.rush?.(); }
  shave() { this.shaveAt = Date.now(); this.applied.beard = 0; this.game.view3d?.actors?.rush?.(); }
  // A pending step, twice a second: the look to come is made in idle time (actors.js prewarm), so the swap at the hidden
  // moment costs nothing; after half an hour without one, it is applied while the player stands still
  growthTick() {
    const g = this.game, G = this.growth();
    if (!G.pending) { this.growT = 0; return; }
    this.growT += TICK;
    const p = g.player, now = g.appearance(), key = G.hairStep * 10 + G.beardStep;
    if (this.warmK !== key || this.warmBase !== now) {
      this.warmK = key; this.warmBase = now;
      g.view3d?.actors?.warmUp?.(dressed(p.look, g.inv.equip, { hair: G.hairStep, beard: G.beardStep }));
    }
    if (this.growT > GROW_WAIT && !g.busy && !p.vx && !p.vy && !p.z) this.applyGrowth();
  }

  // ---------- /body (commands.js, op only): for testing without waiting for real days ----------
  // what: 'hair' | 'beard' (n days since the cut or the shave), 'dirt' (n 0..100), 'tear' (n 0..100 on every worn piece),
  // 'wet', 'clean'. Returns the line to say, or null for a usage error
  testSet(what, n) {
    const now = Date.now(), days = Math.max(0, Math.min(365, Number(n) || 0));
    if (!this.counts) return t('cmd.body.survival');
    if (what === 'hair') { this.cutAt = now - days * DAY_MS; this.applyGrowth(); return t('cmd.body.hair', { n: days }); }
    if (what === 'beard') { this.shaveAt = now - days * DAY_MS; this.applyGrowth(); return t('cmd.body.beard', { n: days }); }
    if (what === 'dirt') { if (!Number.isFinite(Number(n))) return null; this.dirt = cap(Number(n)); this.tickT = 0; return t('cmd.body.dirt', { n: Math.round(this.dirt) }); }
    if (what === 'wet') { this.wet = MAX; this.tickT = 0; return t('cmd.body.wet'); }
    if (what === 'tear') {
      // every worn piece that can tear set to n (0..100), its stage applied at once (the chip and the look)
      if (!Number.isFinite(Number(n))) return null;
      const v = cap(Number(n)), eq = this.game.inv?.equip;
      let any = false;
      if (eq) for (const k in eq) if (canTear(k, eq[k])) {
        const it = eq[k], s0 = tearStage(it.tear || 0);
        it.tear = v; any = true;
        if (tearStage(v) !== s0) this.tore(it.id, tearStage(v));
      }
      if (any) this.game.inv.changed();
      return any ? t('cmd.body.tear', { n: Math.round(v) }) : t('cmd.body.tear_none');
    }
    if (what === 'clean') { this.dirt = this.mud = this.wet = this.wetLegs = this.snow = this.blood = 0; this.tickT = 0; return t('cmd.body.clean'); }
    return null;
  }
}
