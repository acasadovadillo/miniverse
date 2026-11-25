// Animales salvajes: ciervos y jabalíes en los bosques y los prados, y cisnes en los lagos. Aparecen lejos del
// jugador, pasean despacio y huyen si se acerca (o si les ladra un perro); al quedar muy lejos, se van. Nunca en
// lo construido: ni aparecen ni entran bajo un tejado o sobre un suelo, y chocan con los muros con todo su cuerpo.
// Se pueden cazar (hunt.js): para llegar a ellos hay que acercarse agachado o, a los más lentos, correr.
// Son los mismos para todos, como en Minecraft: jugando juntos los lleva quien lleva el mundo, que los hace aparecer
// alrededor de cada jugador, los mueve y les dice a los demás dónde están (y si pastan). No se guardan.
// Los ciervos pastan: al pararse, si tienen hierba delante, bajan la cabeza y se la comen (queda como segada, para todos;
// ver scenes.js, pasture). Pocas veces y unas pocas casillas cada uno, para que no se coman el campo. Solo la dejan
// comida en los trozos que ya tienen algo cambiado (lo que se apunta de un trozo se guarda y se manda a quien entra: un
// trozo que nadie ha tocado no se apunta por un ciervo que pasa); en los demás, bajan la cabeza igual y la hierba sigue.
//
// Wounds (Plan G §3.2, docs/planes/gta/PLAN-G-caza.md): a hit that does not kill a deer or a boar makes it bleed (the host
// decides it in hunt.js damage and runs it here). A light wound (bleed 1) bleeds for LIGHT_FOR seconds and then heals as
// before. A heavy one (bleed 2) never heals: it loses 1 hp every BLEED_TICK seconds, flees far (FLIGHT metres, towards
// cover), limps, beds down (lying) and, if nobody finishes it, bleeds out (hunt.bledOut: the host leaves its carcass).
// A wounded animal stays while anyone is within LEASH and counts towards MAX for whoever wounded it. The 'wild' message
// carries [id, type, x, y, hurt, grazing, bleed, lying, sx, sy, limp, f]: the last six are optional (old peers send six).
// sx, sy: the spawn point, quantised, which keys the animal's trail (trailKey; tracks.js lays the backtrail to it).
// ?wounds=0 (opciones.js) keeps the old behaviour: no bleeding, heal after 30 s, gone beyond GONE.
//
// Senses (Plan R3-1, docs/planes/realismo/PLAN-R3-caza.md §3.2, §3.4, §3.10; the numbers in senses.js): whoever runs the
// world works out, four times a second, what each animal sees, hears and smells of every player (presence.js, wind.js), and
// its awareness w.aw (0..1). Alert (w.alert), it stops, lifts its head and stares; tense, a deer stamps and a boar huffs;
// alarmed, it flees (fleeFrom: one run away, and a deer often stops, broadside, to look back before trotting off). A
// grazing deer is head down most of the time, sees a third as far, and lifts its head every few seconds: move then, freeze
// when it looks up. A badly wounded animal does what its wound says (above), not this. Index 11 of 'wild' (senses.js
// packF, optional) carries the alert, the stare and the tail, so every game draws them and plays their sounds (cues).
// ?sentidos=0 (the host's) keeps the old way: they run from whoever comes within their fear radius.
//
// Herds (Plan R3-2, docs/planes/realismo/PLAN-R3-caza.md §3.3; the cells, the members and the hours in herds.js): the deer,
// the boar and the swans live in groups, each in its own places. Whoever runs the world makes a group real when a player
// comes within HERD.NEAR of its middle (never nearer anybody than HERD.MIN) and lets it go when nobody is within HERD.GONE of
// any of it (herdTick). A real group (this.groups) follows its middle through its hours: its leader goes there, the others
// keep about it, the young about their mothers (nextPlace); they graze, root, drink and lie in their bed (bedded: not a
// wounded one's lying). An alarm goes through the group, and one that fled stays about where it fled to. Their ids say whose
// they are (herds.js memberId), so a game that takes the world over adopts them. Traits (female, age, young, size) travel in f.
// ?manadas=0 (the host's; or ?sentidos=0): single animals at random round each player, as before. /summon's are on their own.
import { B } from './world/biomes.js';
import { inBounds } from './world/village.js';
import { CHUNK } from './world/gen.js';
import { collide } from './physics.js';
import { wrapX, dxOf, distOf, wrapIndex } from './world/planet.js';
import { apagada } from './opciones.js';
import { Audio } from './audio.js';
import { Profile } from './accounts.js';
import { shotHit } from './world/shots.js';
import { Presence, stalkingAs } from './presence.js';
import { Herds, HERD, AGE, memberId, parseId, breedOf, dayOfYear } from './herds.js';
import { SENSES, ALERT, CALM, TENSE, ALARM, FAR, DIFF_K, EVENT_S, A_CALM, A_ALERT, A_ALARM, A_TENSE, perceive, hearEvent, advance, lightAt, packF, unpackF } from './senses.js';

const MAX = 6, SPAWN_EVERY = 4, NEAR = [14, 26], GONE = 42, CREEP = 0.3, SEND_EVERY = 0.15, RESEND = 2;
// With the senses: they see further than they used to run from, so they appear further off and stay longer (the cap
// counts the ones within ROOM of each player, so it is not spread thinner than before)
const NEAR_S = [34, 56], GONE_S = 120, ROOM = 75, MAX_S = 10, NOBODY = [];
const ESCAPE_FOR = 0.6;   // seconds a fleeing animal keeps the way it turned to when something was in its way
const LOCK_WAIT = 5;   // seconds a guest's hit waits for the host to say the animal bleeds (then no auto lock)
const KINDS = {
  ciervo: { biomes: [B.FOREST, B.PINES, B.MEADOW], hours: [6, 20], speed: 0.8, flee: 5.5, fear: 7, r: 0.55 },
  jabali: { biomes: [B.FOREST, B.PINES], hours: [5, 23], speed: 0.9, flee: 4.8, fear: 4.5, r: 0.45 },
  cisne: { water: true, biomes: [B.LAKE], hours: [6, 21], speed: 0.4, flee: 1.2, fear: 4, r: 0.35 },
};

// Los que pastan: hasta dónde llega el morro, cuántas casillas se comen como mucho, cada cuánto (segundos) y cuánto tardan
const GRAZE = { ciervo: { mouth: 0.75, max: 5, every: [25, 60], eat: [6, 11] } };
// With the senses they graze most of the time, in bouts (bout, seconds; rest between two), lifting the head every down
// seconds for up seconds (twice as often when uneasy); what they eat of the field is as before (one tile every `every`)
const BOUT = { bout: [20, 45], rest: [3, 10], down: [4, 9], up: [1.5, 3] };
// How often an animal's senses run and the most lines of sight looked along in each of those turns; past UNEASY the
// head-ups come twice as often
const SENSE = { EVERY: 0.25, RAYS: 8, UNEASY: 0.2, LOOK_AT: 40, SPREAD: 20, RAY_H: 1.2, HILL: 0.6 };
// A flight (unwounded): the burst at the start, how far whoever scared it must be before it stops, the look back (seconds),
// the most legs in a row, and how long one leg may last
export const FLIGHT = { BURST_FOR: 2, CLEAR: 40, LOOK_FOR: [2, 5], LEGS: 4, LEG: [30, 50], LEG_FOR: 30, TURN_AT: 12, TROT: 0.5, SWAN: 2, STOPPED: 1.2 };
// What you hear of them: the stamp and the huff (m), the bark of alarm (m)
const HEARD = { STAMP: 20, BARK: 60, EVERY: [2.2, 4], STAMP_FOR: 0.45 };

export { KINDS, GRAZE, CREEP };   // (read by the nature book's facts, nature.js)
const r2 = v => Math.round(v * 100) / 100;
const within = ([a, b]) => a + Math.random() * (b - a);

// The wound constants (exported so balance and the tests can read them). Times in game seconds, distances in tiles (m)
export const WOUND = {
  LIGHT_FOR: 90,          // a light wound bleeds this long, then stops (and hp heals HEAL_AFTER later, as before)
  BLEED_TICK: 25,         // a heavy wound takes 1 hp every this
  FLIGHT: [40, 70],       // the first flight of a heavy wound: this far from the hitter
  GETUP: [20, 30],        // each later run (got up by someone standing close, or hit again): this far, slower every time
  COVER_R: 30,            // the flight's end is nudged towards a tree or a bush within this of it
  RUN_FOR: 40,            // a run lasts at most this; then it beds down where it is
  BLOCKS: 3,              // blocked steps in a row with no open way out before it beds down where it is (reaim)
  SLOW: 0.35,             // the flight speed loses this share at hp 0 (× the missing hp share)
  TIRE: 0.8,              // each get-up run is this much slower than the last
  LIE_FEAR: 0.5,          // lying, the fear radius is this share (the crouch factor still applies)
  CORNERED: 4,            // with no way out it stays down this long before it can get up again
  LEASH: 160,             // a wounded animal stays while any player is within this (instead of GONE)
  HARD_STOP: 480,         // a heavy wound always ends by this: it bleeds out
};
// What a fleeing wounded animal looks for at the end of its run (the cover of trees and bushes)
const COVER = new Set(['oak', 'pine', 'snowPine', 'fruit', 'swampTree', 'bush']);
// The spawn point travels quantised to a tenth, so every game builds the same trail key and backtrail from it
const qs = v => Math.round(v * 10) / 10;
const STEP = { x: 0, y: 0 };   // (the next step of a wounded animal: reused, no allocation per frame)
const PROBE = { x: 0, y: 0 }, PROBE_D = 1.5;   // (a blocked run's look for a way out: the turns off its heading, see reaim)
const SHUN = 20;   // (a run that turns never heads back towards someone within this)
const REAIM = [0, 1, -1, 2, -2, 3, -3].map(n => n * Math.PI / 4);
// On unless ?sentidos=0. Wildlife.senses: the tests turn them on and off without the URL
export const sensesOn = () => Wildlife.senses ?? !apagada('sentidos');
// The herds: on unless ?manadas=0 (or without the senses). Wildlife.herding: the tests turn them on and off
export const herdsOn = () => sensesOn() && (Wildlife.herding ?? !apagada('manadas'));
const WHERE = { x: 0, y: 0, act: '', night: 0 }, TAU = Math.PI * 2;
const DIR8 = Array.from({ length: 8 }, (_, i) => [Math.cos(i * TAU / 8), Math.sin(i * TAU / 8)]);
const SEEN = {}, ENV = { light: 1, sky: 1, diff: 1, wx: 1, wy: 0, ws: 0.4 }, ANIMAL = { fx: 0, fy: 1, down: false, staring: false, bedded: false };   // (reused: no allocation in the senses)
// On unless ?wounds=0. Wildlife.wounds: the tests turn it on and off without the URL
export const woundsOn = () => Wildlife.wounds ?? !apagada('wounds');

// The src of a wild animal's trail (tracks.js, Plan G §3.1): wild ids restart with the host, so the id alone could join two
// animals' trails; the spawn point (w.sx, w.sy: set by the host at spawn, quantised, and sent in 'wild') tells them apart
export const trailKey = w => `${w.id}@${w.sx ?? '?'},${w.sy ?? '?'}`;

class Wild {
  constructor(type, x, y, id) { Object.assign(this, { id, type, x, y, tx: x, ty: y, wait: Math.random() * 3, vx: 0, vy: 0, scared: 0, bleed: 0, lying: false, limp: 0, aw: 0, alert: A_CALM, flag: false, staring: false, stareYaw: 0, quiet: 9, flight: 0, senseT: Math.random() * SENSE.EVERY }); }
  faceTo(dx, dy) { this.dir = [dx, dy]; }
}

export class Wildlife {
  static wounds = null;
  static senses = null;
  static herding = null;
  constructor(game) { this.game = game; this.herds = null; this.groups = new Map(); this.gT = 0; this.presence = new Presence(game); this.presT = 0; this.rays = 0; this.raysT = -9; this.tension = false; this.hunting = false; this.walkers = []; this.list = []; this.t = 0; this.n = 0; this.sendT = 0; this.resend = 0; this.lastSent = ''; this.bCache = new Map(); this.bWorld = null; this.bTouch = -1; this.bSlot = -1; }
  reset() { this.list = []; this.herds = null; this.groups.clear(); this.lastSent = ''; this.tension = this.hunting = false; this.presence.reset(); }
  get world() { return this.game.world; }

  update(dt) {
    const g = this.game;
    if (!g.world) return;
    if (g.live.guest) { if (this.groups.size) this.disband(); this.attend(dt, null); this.follow(dt); this.cues(dt); return; }   // (en el mundo de otro, donde dice su juego)
    const players = g.mobs.players(), walkers = players.filter(q => q.gm !== 'spectator'), senses = sensesOn(), gone = senses ? GONE_S : GONE;
    this.attend(dt, walkers);
    // (el que se queda lejos de todos, o dentro de algo construido, se va; a wounded one only beyond LEASH, so its trail
    // leads somewhere, and a badly wounded one not while whoever wounded it is in a cave: they come back to its trail)
    // (one of a herd, only with all of it: herdTick)
    const herds = this.herdsNow();
    this.list = this.list.filter(w => (w.herd || this.stays(w, players, gone)) && (KINDS[w.type].water || !this.built(w.x, w.y, 0)));
    if (herds) this.herdTick(dt, herds, walkers, players);
    else if ((this.t += dt) > SPAWN_EVERY) {
      this.t = 0;
      // (a wounded animal beyond GONE still counts for whoever wounded it, or every wound would let one more spawn)
      const room = senses ? ROOM : GONE;
      for (const q of walkers) {
        let n = 0, m = 0;
        if (senses) for (const w of this.list) if (distOf(q.x, q.y, w.x, w.y) < GONE_S) m++;
        for (const w of this.list) if (distOf(q.x, q.y, w.x, w.y) < room || (w.bleed > 0 && this.woundedBy(w, q))) n++;
        if (n < MAX && m < MAX_S) this.spawn(q, walkers);
      }
    }
    for (const w of this.list) this.move(w, dt, walkers);
    this.cues(dt);
    this.bleedAll(dt);
    if (g.live.joined && (this.sendT += dt) >= SEND_EVERY) {
      const m = this.list.map(w => [w.id, w.type, r2(w.x), r2(w.y), w.hurt > 0 ? 1 : 0, w.grazing ? 1 : 0, w.bleed || 0, w.lying ? 1 : 0, w.sx ?? r2(w.x), w.sy ?? r2(w.y), w.limp || 0, packF(w)]), s = JSON.stringify(m);
      this.resend += this.sendT; this.sendT = 0;
      if (s !== this.lastSent || this.resend >= RESEND) { this.lastSent = s; this.resend = 0; g.live.net?.send({ t: 'wild', w: m }); }   // (de vez en cuando, aunque no cambie: por quien acaba de entrar)
    }
  }
  stays(w, players, gone) {
    for (const q of players) if (distOf(q.x, q.y, w.x, w.y) < (w.bleed > 0 || w.lying || w.flight ? WOUND.LEASH : gone)) return true;
    return w.bleed === 2 && this.wounderAway(w);
  }

  // ---------- herds (host side; Plan R3 §3.3, herds.js) ----------
  // The herds of this world, or null (off: ?manadas=0, ?sentidos=0)
  herdsNow() {
    if (!herdsOn()) { if (this.groups.size) this.disband(); return null; }
    const gen = this.world.gen;
    if (!this.herds || this.herds.gen !== gen || this.herds.seed !== gen.seed) { this.disband(); this.herds = new Herds(gen); }
    return this.herds;
  }
  // The groups no more (another game runs the world, or they are off): the animals stay, each on its own
  disband() { for (const w of this.list) w.herd = null; this.groups.clear(); }
  now() { return this.game.days.now; }
  // Once a second: what each real group is at, the ones that go, and the ones somebody comes near (this.t, as the old
  // spawn's timer: the tests hold it back)
  herdTick(dt, herds, walkers, players) {
    if ((this.gT += dt) >= HERD.EVERY) {
      this.gT = 0;
      for (const w of this.list) if (!w.herd && typeof w.id === 'string' && w.id[0] === 'g') this.adopt(w, herds);
      for (const G of this.groups.values()) this.groupTick(G, herds, players);
    }
    if ((this.t += dt) <= HERD.EVERY) return;
    this.t = 0;
    let best = null, bd = HERD.NEAR + HERD.WARM;
    const ms = this.now(), now = this.game.time;
    for (const q of walkers) herds.around(q.x, q.y, 2, g => {
      if (this.groups.has(g.id)) return;
      herds.where(g, this.game.days.hourAt(g.bed[0]), ms, now, WHERE);
      const d = distOf(q.x, q.y, WHERE.x, WHERE.y);
      if (d < bd && !(g.retry > now && g.retry < now + HERD.RETRY * 2) && !inBounds(q.x, q.y)) { bd = d; best = g; }
    });
    if (!best) return;
    // (the ground where it will be, made ready a little before: a chunk a look)
    herds.where(best, this.game.days.hourAt(best.bed[0]), ms, now, WHERE);
    if (!this.ready(WHERE.x, WHERE.y)) { this.warm(WHERE.x, WHERE.y); return; }
    if (bd < HERD.NEAR && !this.appear(best, herds, walkers)) best.retry = now + HERD.RETRY;
  }
  // A group comes into being where its hours say (or the nearest place to it that will do). false: no room, or nowhere now
  appear(g, herds, walkers) {
    const ms = this.now(), time = this.game.time, members = herds.members(g, dayOfYear(ms, g.bed[1]), ms);
    if (!members.length) return false;
    herds.where(g, this.game.days.hourAt(g.bed[0]), ms, time, WHERE);
    const { x, y, act, night } = WHERE;
    if (!this.room(g, x, y, members.length, walkers)) return false;
    for (let n = 0; n < 9 && !this.ready(x, y); n++) this.warm(x, y);
    const k = KINDS[g.type], at = this.spotFor(g, x, y, k, walkers);
    if (!at) return false;
    const G = { g, id: g.id, list: [], x: at[0], y: at[1], act, night, lead: null, run: null, runT: -9, spook: 0 };
    const md = dayOfYear(ms, g.bed[1]), uneasy = herds.spooked.has(g.id);
    // (moved over, because of what is built there: it keeps off it a while)
    if (at[2]) herds.spook(g.id, dxOf(at[0], x), at[1] - y, time + HERD.SPOOKED);
    for (const m of members) {
      const mom = m.mother >= 0 ? G.list.find(o => o.mi === m.mother) : null, R = m.young ? HERD.YOUNG : act === 'bed' ? HERD.BED : HERD.AROUND, slot = (m.i / members.length) * TAU + Math.random() * 0.8;
      const p = this.placeNear(mom ? mom.x : at[0], mom ? mom.y : at[1], R, slot, k, walkers);
      if (!p) continue;
      const w = new Wild(g.type, p[0], p[1], memberId(g, m.i));
      Object.assign(w, { sx: qs(w.x), sy: qs(w.y), traits: true, female: m.female, young: m.young, age: m.age, size: m.size, breed: breedOf(g.type, m.female, m.young, md), herd: G, mi: m.i, mother: m.mother, slot, aw: uneasy ? HERD.WARY : 0, wait: Math.random() * 3 });
      w.dir = [Math.cos(slot * 3), Math.sin(slot * 3)];
      if (act === 'bed' && g.kind !== 'swan') w.bedded = true;
      G.list.push(w); this.list.push(w);
    }
    if (!G.list.length) return false;
    this.groups.set(g.id, G);
    this.lead(G);
    return true;
  }
  // Is there room for n more at (x, y)? So many round each player, the wounded and the summoned ones among them; a calm group
  // that is further off than it, and far from everybody (HERD.SWAP), makes room
  room(g, x, y, n, walkers) {
    for (let tries = 0; tries < HERD.GROUPS + 1; tries++) {
      let full = null;
      for (const q of walkers) {
        if (distOf(q.x, q.y, x, y) > WOUND.LEASH) continue;
        let a = 0, m = 0;
        for (const w of this.list) if (!w.herd && (distOf(q.x, q.y, w.x, w.y) < WOUND.LEASH || (w.bleed > 0 && this.woundedBy(w, q)))) a++;
        for (const G of this.groups.values()) if (G.list.some(w => distOf(q.x, q.y, w.x, w.y) < WOUND.LEASH || (w.bleed > 0 && this.woundedBy(w, q)))) { m++; a += G.list.length; }
        if (a + n > HERD.MAX || m >= HERD.GROUPS) { full = q; break; }
      }
      if (!full) return true;
      let far = null, fd = HERD.SWAP;
      for (const G of this.groups.values()) {
        let d = Infinity;
        for (const w of G.list) { if (w.bleed > 0 || w.lying || w.flight || w.alert) { d = 0; break; } for (const q of walkers) d = Math.min(d, distOf(q.x, q.y, w.x, w.y)); }
        if (d > fd) { fd = d; far = G; }
      }
      if (!far || distOf(full.x, full.y, x, y) > fd) return false;
      this.vanish(far);
    }
    return false;
  }
  // Where a group may come into being: at (x, y), or round there; the third, true: not its own place, for what is built
  spotFor(g, x, y, k, walkers) {
    const far = (px, py) => walkers.every(q => distOf(q.x, q.y, px, py) >= HERD.MIN + HERD.AROUND[1] * 0.75);
    const ok = (px, py) => far(px, py) && !this.offLimits({ x: px, y: py }, k) && (k.water || (!this.world.blocked?.(px, py) && this.quiet(px, py)));
    if (ok(x, y)) return [x, y, false];
    const built = !k.water && !this.quiet(x, y);
    for (const r of k.water ? [4, 8, 14] : [10, 18, 26]) for (const [c, s] of DIR8) { const px = wrapX(x + c * r), py = y + s * r; if (ok(px, py)) return [px, py, built]; }
    // (somebody stands where it is: it comes into being off from them, where it would have seen them come)
    for (const q of walkers) {
      if (distOf(q.x, q.y, x, y) > HERD.MIN + HERD.AROUND[1]) continue;
      const a0 = Math.atan2(y - q.y, dxOf(x, q.x));
      for (let i = 0; i < 8; i++) {
        const a = a0 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * TAU / 8, px = wrapX(q.x + Math.cos(a) * (HERD.MIN + HERD.AROUND[1] + 2)), py = q.y + Math.sin(a) * (HERD.MIN + HERD.AROUND[1] + 2);
        if (ok(px, py) && this.ready(px, py)) return [px, py, false];
      }
    }
    return null;
  }
  // A free place for one of them r (a [min, max] range) from (x, y), about the angle a
  placeNear(x, y, R, a, k, walkers) {
    for (let i = 0; i < 9; i++) {
      const an = a + (i ? (Math.random() - 0.5) * TAU : 0), r = i < 8 ? within(R) : 0, px = wrapX(x + Math.cos(an) * r), py = y + Math.sin(an) * r, p = { x: px, y: py };
      if (this.offLimits(p, k) || (!k.water && this.world.blocked?.(px, py)) || this.built(px, py, k.r + 0.5) || walkers.some(q => distOf(q.x, q.y, px, py) < HERD.MIN)) continue;
      if (!k.water) { collide(p, this.world.collidersNear(px, py), k.r); if (Math.hypot(dxOf(p.x, px), p.y - py) > 0.05) continue; }
      return [px, py];
    }
    return null;
  }
  // Nothing built at a place nor round it (a house, a hamlet): they keep away from those
  quiet(x, y) {
    if (this.builtAt(Math.floor(x), Math.floor(y))) return false;
    for (const r of HERD.QUIET) for (const [c, s] of DIR8) if (this.builtAt(Math.floor(wrapX(x + c * r)), Math.floor(y + s * r))) return false;
    return true;
  }
  // One of the chunks round (x, y) that nothing has asked for yet (ready: all of them are there)
  warm(x, y) {
    const M = this.world.merged, cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!M?.has(`${wrapIndex(cx + dx, CHUNK)},${cy + dy}`)) { this.world.contentFor(cx + dx, cy + dy); return; }
  }
  // Its leader, the oldest of the grown that is left (the first of them: herds.js); and each young one's mother
  lead(G) {
    const L = G.list;
    G.lead = L.find(w => !w.young && w.bleed !== 2) || L.find(w => !w.young) || L[0] || null;
    for (const w of L) w.mom = w.mother >= 0 ? L.find(o => o.mi === w.mother) || null : null;
  }
  // A real group, once a second: who is left, where its middle is and what it is at; it goes when nobody is near any of it
  groupTick(G, herds, players) {
    G.list = G.list.filter(w => this.list.includes(w));
    if (!G.list.length) { this.groups.delete(G.id); return; }
    this.lead(G);
    const g = this.game, now = g.time, h = g.days.hourAt(G.g.bed[0]), ms = this.now();
    // (it fled: where its leader is, is where it keeps about for a while)
    if (G.spook > now && G.lead.flight) {
      herds.spooked.delete(G.id);
      herds.where(G.g, h, ms, now, WHERE);
      herds.spook(G.id, dxOf(G.lead.x, WHERE.x), G.lead.y - WHERE.y, G.spook);
    }
    herds.where(G.g, h, ms, now, WHERE);
    G.x = WHERE.x; G.y = WHERE.y; G.act = WHERE.act; G.night = WHERE.night;
    // (off its places, it does not go to the water: it grazes, or lies, where it is. And its place built over while it was here,
    // it keeps about where its leader is)
    const off = herds.spooked.has(G.id), k = KINDS[G.g.type];
    if (off && (G.act === 'walk' || G.act === 'drink')) G.act = 'feed';
    if (!off && !k.water && this.ready(G.x, G.y) && !this.quiet(G.x, G.y) && this.quiet(G.lead.x, G.lead.y)) herds.spook(G.id, dxOf(G.lead.x, WHERE.x), G.lead.y - WHERE.y, now + HERD.SPOOKED);
    let wide = 0;
    for (const w of G.list) if (!w.young && !w.lying && w.bleed !== 2) wide = Math.max(wide, distOf(w.x, w.y, G.lead.x, G.lead.y));
    G.wide = wide;
    if (!G.list.some(w => this.stays(w, players, HERD.GONE))) this.vanish(G);
  }
  vanish(G) {
    this.groups.delete(G.id);
    this.list = this.list.filter(w => w.herd !== G);
  }
  // One with a herd's id that no group here has (another game ran the world until now)
  adopt(w, herds) {
    const p = parseId(w.id), g = p && herds.cell(p.cx, p.cy).find(o => o.id === p.id);
    if (!g) { w.id = `w${++this.n}`; return; }
    let G = this.groups.get(g.id);
    if (!G) { this.groups.set(g.id, G = { g, id: g.id, list: [], x: w.x, y: w.y, act: 'feed', night: 0, lead: null, run: null, runT: -9, spook: 0 }); }
    if (G.list.some(o => o.mi === p.i)) { w.id = `w${++this.n}`; return; }
    const ms = this.now(), m = herds.members(g, dayOfYear(ms, g.bed[1]), ms).find(o => o.i === p.i);
    Object.assign(w, { herd: G, mi: p.i, mother: m ? m.mother : -1, slot: Math.random() * TAU });
    G.list.push(w); G.list.sort((a, b) => a.mi - b.mi);
    this.lead(G);
  }
  // (hunt.js) One died: its group is one less for some days
  lost(w) { if (w.herd && this.herds) { this.herds.take(w.herd.id, w.mi, this.now()); w.herd.list = w.herd.list.filter(o => o !== w); if (w.herd.list.length) this.lead(w.herd); } }
  // (hunt.js) One was hit, from (x, y): the rest of its group takes fright
  startle(w, x, y) { if (w.herd && sensesOn() && Number.isFinite(x) && Number.isFinite(y)) this.warn(w, x, y); }
  warn(w, x, y) {
    for (const o of w.herd.list) {
      if (o === w || o.flight || o.bleed === 2 || distOf(o.x, o.y, w.x, w.y) > HERD.SPREAD) continue;
      if (o.aw < HERD.WARN) { o.aw = HERD.WARN; o.awKey = w.awKey; o.awX = x; o.awY = y; o.quiet = 0; o.senseT = Math.max(o.senseT, SENSE.EVERY - Math.random() * 0.4); }
    }
  }
  // One has just noticed something: the ones by it look where it looks
  rouse(w) {
    for (const o of w.herd.list) {
      if (o === w || o.flight || o.alert || o.bleed === 2 || o.aw >= ALERT || distOf(o.x, o.y, w.x, w.y) > HERD.ROUSE) continue;
      o.aw = ALERT; o.awKey = w.awKey; o.awX = w.awX; o.awY = w.awY; o.quiet = 0;
    }
  }
  // Where one of a herd goes next: its leader, with the group's middle; the others, about the leader; the young, about their
  // mothers. There it grazes, roots, drinks or lies down, by its group's hour
  nextPlace(w, k) {
    const G = w.herd, lead = w === G.lead || !G.lead, time = this.game.time;
    const go = (x, y, wait, graze) => { w.tx = w.x + dxOf(x, w.x); w.ty = y; w.wait = wait; w.vx = w.vy = 0; if (graze) this.tryGraze(w); };
    w.hurry = false;
    if (G.act === 'bed' && G.g.kind !== 'swan') {
      const n = w.slot * 7.3, r = lead ? 0 : HERD.BED[0] + (n - Math.floor(n)) * (HERD.BED[1] - HERD.BED[0]), bx = G.x + Math.cos(w.slot) * r, by = G.y + Math.sin(w.slot) * r, d = distOf(bx, by, w.x, w.y);
      w.bedTry = (w.bedTry || 0) + 1;
      if (d < 1.2 || (d < 12 && w.bedTry > 3) || w.bedTry > 14) { this.lieDown(w); return; }
      const s = Math.min(1, 9 / d);
      w.hurry = d > HERD.STRAY * 2;
      go(wrapX(w.x + dxOf(bx, w.x) * s), w.y + (by - w.y) * s, d > 12 ? Math.random() : within([1, 4]), false);
      return;
    }
    w.bedTry = 0;
    if (G.act === 'drink' && !(w.drankAt > time)) {
      // (the shore, side by side: each up to the water, and there it drinks: wander)
      const W = G.g.water, l = Math.hypot(W[2] - W[0], W[3] - W[1]) || 1, side = ((w.mi % 7) - 3) * 1.5;
      go(wrapX(W[2] - (W[3] - W[1]) / l * side), W[3] + (W[2] - W[0]) / l * side, Math.random() * 2, false);
      return;
    }
    const anchor = w.mom && !w.mom.flight ? w.mom : lead ? null : G.lead;
    if (!anchor) {
      const d = distOf(G.x, G.y, w.x, w.y);
      if (d > 8) {   // (the group's middle has moved on: that way, in short stretches, and not without the others)
        const a = Math.atan2(G.y - w.y, dxOf(G.x, w.x)) + (Math.random() - 0.5), s = Math.min(d, within([4, 7])), slow = G.wide > HERD.STRAY;
        w.hurry = d > HERD.STRAY * 3 && !slow;
        go(wrapX(w.x + Math.cos(a) * s), w.y + Math.sin(a) * s, slow ? within([4, 9]) : G.act === 'walk' ? within([0.3, 2]) : within([1, 5]), slow || G.act !== 'walk' || Math.random() < 0.4);
      } else { const a = Math.random() * TAU; go(wrapX(w.x + Math.cos(a) * 3), w.y + Math.sin(a) * 3, within([2, 8]), true); }
      return;
    }
    const night = w.young ? 0 : G.night, r0 = w.young ? HERD.YOUNG[0] : HERD.AROUND[0] + (HERD.NIGHT[0] - HERD.AROUND[0]) * night, r1 = w.young ? HERD.YOUNG[1] : HERD.AROUND[1] + (HERD.NIGHT[1] - HERD.AROUND[1]) * night;
    const d = distOf(anchor.x, anchor.y, w.x, w.y), behind = d > r1 + (w.young ? 1 : 2), a = w.slot + (Math.random() - 0.5) * 1.6, r = r0 + Math.random() * (r1 - r0);
    const x = anchor.x + Math.cos(a) * r, y = anchor.y + Math.sin(a) * r, dd = distOf(x, y, w.x, w.y), s = behind ? Math.min(1, 12 / (dd || 1)) : Math.min(1, 4 / (dd || 1));
    w.hurry = d > HERD.STRAY;
    go(wrapX(w.x + dxOf(x, w.x) * s), w.y + (y - w.y) * s, behind ? Math.random() * 1.2 : within([2, 8]), !behind);
  }
  lieDown(w) { Object.assign(w, { bedded: true, bedTry: 0, vx: 0, vy: 0, tx: w.x, ty: w.y, eating: 0, grazing: false, headUp: false }); }
  // At the water's edge, its head down to it
  drink(w) {
    w.drankAt = this.game.time + 40 + Math.random() * 60;
    Object.assign(w, { grazeAt: null, eating: within(HERD.DRINK), headUp: false, headT: within(BOUT.down), grazing: true, tx: w.x, ty: w.y, vx: 0, vy: 0 });
  }
  // Uno nuevo en un sitio que le vaya, a cierta distancia de quien juega (y de los demás) y fuera del pueblo
  spawn(q, walkers) {
    const near = sensesOn() ? NEAR_S : NEAR, a = Math.random() * Math.PI * 2, r = within(near);
    const x = wrapX(q.x + Math.cos(a) * r), y = q.y + Math.sin(a) * r, h = this.game.days.hourAt(x);
    if (inBounds(x, y) || walkers.some(o => distOf(o.x, o.y, x, y) < near[0])) return;
    const biome = this.world.gen.biomeAt(x, y), water = !!this.world.water(x, y);
    const ok = Object.entries(KINDS).filter(([, k]) => k.biomes.includes(biome) && !!k.water === water && h >= k.hours[0] && h < k.hours[1]);
    if (!ok.length || this.world.blocked?.(x, y)) return;
    const [type] = ok[Math.floor(Math.random() * ok.length)];
    if (this.built(x, y, KINDS[type].r + 0.5)) return;   // (ni dentro de una casa ni pegado a ella)
    const at = { x, y };
    if (!KINDS[type].water) { collide(at, this.world.collidersNear(x, y), KINDS[type].r); if (Math.hypot(at.x - x, at.y - y) > 0.05) return; }
    const n = type === 'jabali' && Math.random() < 0.4 ? 2 : 1;   // (los jabalíes, a veces en pareja)
    for (let i = 0; i < n; i++) this.summon(type, x + i * 0.8, y + i * 0.5);
  }
  move(w, dt, walkers) {
    const k = KINDS[w.type], g = this.game;
    if (!(w.eating > 0)) w.grazing = false;   // (lo que llegó por red, si ahora los mueve este juego)
    if (w.bleed === 2) { if (w.aw || w.flight || w.alert) this.calm(w); this.moveWounded(w, dt, walkers, k); return; }
    if (sensesOn()) { this.moveAware(w, dt, walkers, k); return; }
    let sp = k.speed, q = null, d = Infinity, flee = false;
    for (const o of walkers) { const od = distOf(o.x, o.y, w.x, w.y); if (od < d) { d = od; q = o; } }
    if (q && (d < k.fear * (q.crouch ? CREEP : 1) || w.scared > g.time)) {   // huye, alejándose de quien tiene más cerca (agachado, se deja acercar)
      const ax = dxOf(w.x, q.x), ay = w.y - q.y, l = Math.hypot(ax, ay) || 1;
      w.tx = w.x + (ax / l) * 6; w.ty = w.y + (ay / l) * 6; w.wait = 0; sp = k.flee;
      w.eating = 0; w.grazing = false;   // (si estaba comiendo, lo deja)
      if (w.escT > g.time) { w.tx = w.x + Math.cos(w.esc) * 6; w.ty = w.y + Math.sin(w.esc) * 6; }   // (round something in its way: see below)
      else { flee = true; w.fa = Math.atan2(ay, ax); }
    } else if (w.eating > 0) { w.vx = w.vy = 0; if ((w.eating -= dt) <= 0) this.ate(w); return; }
    else if ((w.wait -= dt) > 0) { w.vx = w.vy = 0; return; }
    this.wander(w, dt, k, sp, flee, q, d);
  }
  // On its way to (tx, ty) at sp; there, it picks another place nearby and waits, or grazes (flee: from q, d away, the old
  // way: no senses)
  wander(w, dt, k, sp, flee = false, q = null, d = Infinity) {
    const g = this.game, dx = w.tx - w.x, dy = w.ty - w.y, dist = Math.hypot(dx, dy);
    if (dist < 0.2) {
      if (w.herd) { this.nextPlace(w, k); return; }
      const a = Math.random() * Math.PI * 2; w.tx = w.x + Math.cos(a) * 3; w.ty = w.y + Math.sin(a) * 3; w.wait = 2 + Math.random() * 6; w.vx = w.vy = 0; this.tryGraze(w); return;
    }
    const s = Math.min(dist, sp * dt), p = { x: w.x + (dx / dist) * s, y: w.y + (dy / dist) * s };
    if (!k.water) collide(p, this.world.collidersNear(p.x, p.y), k.r);
    // (los del agua, en la de verdad: en lo cavado con agua tampoco entran, como los de tierra; ver scenes.js, reflood)
    if (this.offLimits(p, k)) {   // (cada uno en su medio, fuera del pueblo y de lo construido)
      // (fleeing into a bank or a wall: it turns along it for a moment, or it would stand there with the player on it)
      if (flee && !(w.escNo > g.time)) {
        if (this.reaim(w, k, Math.max(s, 0.05), 6, q, d)) { w.esc = Math.atan2(w.ty - w.y, w.tx - w.x); w.escT = g.time + ESCAPE_FOR; return; }
        w.escNo = g.time + ESCAPE_FOR;   // (cornered: looked for again in a moment, not every frame)
      }
      w.tx = w.x; w.ty = w.y; w.wait = 1; w.escT = 0;
      if (w.herd?.act === 'drink' && !k.water && !(w.drankAt > g.time) && this.world.natWater(wrapX(p.x + dx / dist * 0.6), p.y + dy / dist * 0.6)) { w.faceTo(dx, dy); this.drink(w); }
      return;
    }
    // (held by a trunk or a fence on its way: somewhere else)
    if (w.herd) {
      if (Math.hypot(p.x - w.x, p.y - w.y) < s * 0.4) { if ((w.stuckT = (w.stuckT || 0) + dt) > 0.8) { w.stuckT = 0; w.tx = w.x; w.ty = w.y; w.wait = 0.3 + Math.random(); return; } } else w.stuckT = 0;
    }
    w.faceTo(dx, dy);
    w.vx = (p.x - w.x) / dt; w.vy = (p.y - w.y) / dt;
    w.x = wrapX(p.x); w.y = p.y;
  }
  // (cada uno en su medio, fuera del pueblo y de lo construido) May an animal of kind k not stand at p?
  offLimits(p, k) {
    const W = this.world;
    return !!(k.water ? W.natWater : W.water).call(W, p.x, p.y) !== !!k.water || (k.water && W.digH(Math.floor(p.x), Math.floor(p.y)) !== null) || inBounds(p.x, p.y) || this.built(p.x, p.y, k.r);
  }

  // ---------- senses (host side; Plan R3 §3.2, §3.4) ----------
  // Four times a second: how each player can be noticed (walkers: mobs.players without the spectators; null on a guest, who
  // only keeps their own, and only while they hunt), and whether an animal near you is on its guard (the music: tension)
  attend(dt, walkers) {
    const g = this.game, p = g.player;
    if ((this.presT += dt) < SENSE.EVERY) return;
    this.presT = Math.min(this.presT - SENSE.EVERY, SENSE.EVERY);
    const out = !!p && !Profile.server && g.scene === g.world && g.gamemode !== 'spectator', mine = out && stalkingAs(p, g.inv?.held?.id);
    if (walkers) this.presence.update(sensesOn() && (this.list.length || mine) ? walkers : NOBODY);
    else {
      this.walkers.length = 0;
      if (mine) this.walkers.push({ me: true, e: p, x: p.x, y: p.y, gm: g.gamemode, crouch: p.crouch });
      this.presence.update(this.walkers);
    }
    this.hunting = mine;
    let tense = false;
    if (mine) for (const w of this.list) if ((w.alert === A_ALERT || w.alert === A_TENSE) && distOf(p.x, p.y, w.x, w.y) < SENSE.LOOK_AT) { tense = true; break; }
    this.tension = tense;
  }
  // Nothing on its mind (a heavy wound takes over: wound)
  calm(w) { w.aw = 0; w.alert = A_CALM; w.flag = w.staring = false; w.flight = 0; w.quiet = 9; }
  // What w notices now (dt since its last turn), and what that makes of it. From ALARM it flees
  sense(w, dt) {
    const g = this.game, K = SENSES[w.type], P = this.presence, f = w.dir, fl = f ? Math.hypot(f[0], f[1]) || 1 : 1;
    let fx = f ? f[0] / fl : 0, fy = f ? f[1] / fl : 1, sure = 0, heard = 0, best = 0, by = null, bx = 0, byY = 0;
    if (w.staring) { fx = Math.sin(w.stareYaw); fy = Math.cos(w.stareYaw); }
    ENV.light = lightAt(g.days.hourAt(w.x), K.night);
    ENV.diff = DIFF_K[g.difficulty] ?? 1;
    ENV.wx = g.wind?.x ?? 1; ENV.wy = g.wind?.y ?? 0;
    ANIMAL.fx = fx; ANIMAL.fy = fy; ANIMAL.down = !!w.grazing; ANIMAL.bedded = !!(w.lying || w.bedded);
    for (const r of P.list) {
      const dx = dxOf(r.x, w.x), dy = r.y - w.y, d = Math.hypot(dx, dy);
      if (d > FAR) continue;
      ENV.sky = r.sky; ENV.ws = r.ws;
      ANIMAL.staring = w.staring && w.awKey === r.key;
      perceive(K, ANIMAL, r, ENV, dx, dy, d, SEEN);
      if (SEEN.see > 0 && d > 2 && !this.inSight(w, K, r, d)) SEEN.see = 0;
      const rate = SEEN.see + SEEN.smell + (SEEN.loud ? SEEN.hear : 0);
      sure += rate;
      if (!SEEN.loud) heard += SEEN.hear;
      if (rate + SEEN.hear > best) { best = rate + SEEN.hear; by = r.key; bx = r.x; byY = r.y; }
    }
    const now = g.time;
    for (const v of P.events) {
      const left = 1 - (now - v.t) / EVENT_S;
      if (left <= 0 || left > 1) continue;
      hearEvent(K, v.n, distOf(v.x, v.y, w.x, w.y), v.r, ENV.diff, SEEN);
      if (!SEEN.hear) continue;
      if (SEEN.loud) sure += SEEN.hear * left; else heard += SEEN.hear * left;
      if (SEEN.hear > best) { best = SEEN.hear; by = null; bx = v.x; byY = v.y; }
    }
    w.quiet = best > 0 ? 0 : w.quiet + dt;
    if (best > 0) { w.awKey = by; w.awX = bx; w.awY = byY; }
    w.aw = advance(w.aw, sure, heard, w.quiet, dt);
    if (w.flight === 1) return;   // (running: it minds where it goes)
    if (w.aw >= ALARM) { this.alarm(w, w.awX ?? w.x, w.awY ?? w.y); return; }
    if (w.flight === 3) return;
    w.flag = false;
    const was = w.alert;
    w.alert = w.aw >= TENSE ? A_TENSE : w.aw >= ALERT || (w.alert && w.aw > CALM) ? A_ALERT : A_CALM;
    w.staring = w.alert !== A_CALM || w.flight === 2;
    if (w.staring && w.awX !== undefined) w.stareYaw = Math.atan2(dxOf(w.awX, w.x), w.awY - w.y);
    if (w.herd && was === A_CALM && w.alert !== A_CALM && best > 0) this.rouse(w);
  }
  // Nothing between w's eyes and r's chest: trunks, walls, rocks, fences (world/shots.js), nor a rise of the ground. At
  // most RAYS a turn; past that it is taken as seen (what a wood hides is already in r.hidden)
  inSight(w, K, r, d) {
    const g = this.game, W = this.world;
    if (g.time - this.raysT >= SENSE.EVERY || g.time < this.raysT) { this.raysT = g.time; this.rays = 0; }
    if (++this.rays > SENSE.RAYS) return true;
    const gy = this.groundOf ||= (x, y) => (this.game.view3d?.groundY && !Profile.server ? this.game.archery.ground(x, y) : this.world.groundRaw(x, y));
    const dx = dxOf(r.x, w.x), dy = r.y - w.y, h0 = W.groundRaw(w.x, w.y) + K.eye, h1 = W.groundRaw(r.x, r.y) + (r.crouch ? 0.8 : SENSE.RAY_H), dh = h1 - h0;
    // (the ground first, at three points of the way: it is the cheap part. A little over the line, so a fold of it does not hide)
    for (let i = 1; i <= 3; i++) if (W.groundRaw(wrapX(w.x + dx * i / 4), w.y + dy * i / 4) > h0 + dh * i / 4 + SENSE.HILL) return false;
    const len = Math.hypot(dx, dh, dy), o = this.rayO ||= [0, 0, 0], v = this.rayD ||= [0, 0, 0];
    o[0] = w.x; o[1] = h0; o[2] = w.y; v[0] = dx / len; v[1] = dh / len; v[2] = dy / len;
    const t = shotHit(W, o, v, len - 0.4, gy);
    return t === null || t > len - 0.5;
  }
  // It flees from (x, y), and so do the ones of its kind close by (a deer barks: every game, cues): its herd, as it goes
  // through it (warn), all about the same way
  alarm(w, x, y) {
    const G = w.herd, now = this.game.time;
    if (G) {
      if (!(now - G.runT < 5)) {
        let mx = 0, my = 0;
        for (const o of G.list) { mx += dxOf(o.x, x); my += o.y - y; }
        G.runT = now; G.run = { a: Math.atan2(my, mx), len: within(SENSES[w.type].run) };
      }
      G.spook = now + HERD.SPOOKED;
      this.fleeFrom(w, x, y);
      this.warn(w, x, y);
    } else this.fleeFrom(w, x, y);
    for (const o of this.list) if (o !== w && !(G && o.herd === G) && o.type === w.type && !o.flight && o.bleed !== 2 && distOf(o.x, o.y, w.x, w.y) < SENSE.SPREAD) { o.awKey = w.awKey; o.awX = x; o.awY = y; this.fleeFrom(o, x, y); }
  }
  // Off it goes, away from (x, y): a run of its species' length to one point, nudged towards cover, and the ones after it
  // (moveFlight). flight: 1 running, 2 stopped looking back, 3 trotting off
  fleeFrom(w, x, y, range = SENSES[w.type].run, legs = 0) {
    let from = [x, y];
    const G = w.herd, run = G && legs === 0 && range === SENSES[w.type].run && this.game.time - G.runT < 5 ? G.run : null;
    if (run) {   // (with the others, unless whoever it is stands on that side of it)
      const own = Math.atan2(w.y - y, dxOf(w.x, x)), turn = Math.atan2(Math.sin(run.a - own), Math.cos(run.a - own));
      const a = Math.abs(turn) < 1.6 ? own + turn * 0.7 : own;
      from = [w.x - Math.cos(a) * 10, w.y - Math.sin(a) * 10];
      range = [run.len * 0.9, run.len * 1.1];
    }
    this.bolt(w, from, range, SENSES[w.type].cover && 'ready');
    Object.assign(w, { bedded: false, flight: 1, flT: 0, legs, turnT: 0, aw: 1, quiet: 0, alert: A_ALARM, flag: w.type === 'ciervo', staring: false, headUp: false, run: false, flX: x, flY: y });
  }
  // With the senses on: running away, stopped on its guard, grazing, or wandering about
  moveAware(w, dt, walkers, k) {
    const g = this.game;
    // (a hit, or a dog: hunt.scare and ranch.js set scared, once each)
    if (w.scared > g.time && w.scared !== w.scaredAt) {
      w.scaredAt = w.scared;
      const at = w.scareAt || this.nearestTo(w, walkers);
      this.alarm(w, at ? at[0] : w.x + Math.random() - 0.5, at ? at[1] : w.y + Math.random() - 0.5);
      w.scareAt = null;
    }
    if ((w.senseT += dt) >= SENSE.EVERY) { const t = Math.min(w.senseT, 0.6); w.senseT = 0; this.sense(w, t); }
    if (w.flight) { this.moveFlight(w, dt, walkers, k); return; }
    if (w.alert) {   // (it stops and stares: the body turns a little when whoever it is stands behind it)
      w.vx = w.vy = 0; w.grazing = false;
      if (w.bedded) { if (w.alert === A_TENSE) w.bedded = false; return; }   // (it looks from where it lies, and gets up when it is sure)
      const f = w.dir || [0, 1], off = Math.atan2(Math.sin(w.stareYaw - Math.atan2(f[0], f[1])), Math.cos(w.stareYaw - Math.atan2(f[0], f[1])));
      if (Math.abs(off) > 1.3) { const a = w.stareYaw - Math.sign(off) * 0.9; w.faceTo(Math.sin(a), Math.cos(a)); }
      return;
    }
    if (w.eating > 0) {
      w.vx = w.vy = 0;
      if ((w.eating -= dt) <= 0) { this.ate(w); return; }
      // (the head down, and every few seconds up to look around)
      if ((w.headT = (w.headT ?? within(BOUT.down)) - dt) <= 0) { w.headUp = !w.headUp; w.headT = within(w.headUp ? BOUT.up : BOUT.down) * (!w.headUp && w.aw > SENSE.UNEASY ? 0.5 : 1); }
      if (!w.headUp && w.aw > SENSE.UNEASY) w.headT = Math.min(w.headT, BOUT.down[1] / 2);
      w.grazing = !w.headUp;
      return;
    }
    if (w.bedded) {
      w.vx = w.vy = 0;
      const G = w.herd;
      if (!G || G.act !== 'bed' || distOf(G.x, G.y, w.x, w.y) > HERD.STRAY * 2) Object.assign(w, { bedded: false, tx: w.x, ty: w.y, wait: within([1, 6]) });
      return;
    }
    if ((w.wait -= dt) > 0) { w.vx = w.vy = 0; return; }
    this.wander(w, dt, k, w.hurry ? k.speed * HERD.HURRY : k.speed);
  }
  nearestTo(w, walkers) {
    let q = null, d = Infinity;
    for (const o of walkers) { const od = distOf(o.x, o.y, w.x, w.y); if (od < d) { d = od; q = o; } }
    return q && [q.x, q.y];
  }
  moveFlight(w, dt, walkers, k) {
    const K = SENSES[w.type], g = this.game;
    w.eating = 0; w.grazing = false; w.flT += dt;
    let q = null, d = Infinity;
    for (const o of walkers) { const od = distOf(o.x, o.y, w.x, w.y); if (od < d) { d = od; q = o; } }
    if (w.flight === 2) {   // (stopped, broadside, looking back at where it fled from: a second chance)
      w.vx = w.vy = 0; w.alert = A_ALERT; w.staring = true; w.flag = false;
      if (w.awX === undefined) { w.awX = w.flX; w.awY = w.flY; }
      w.stareYaw = Math.atan2(dxOf(w.awX, w.x), w.awY - w.y);
      if (w.flT >= w.lookFor) this.trotOff(w, k);
      return;
    }
    const dx = dxOf(w.tx, w.x), dy = w.ty - w.y, dist = Math.hypot(dx, dy);
    if (dist < 0.5 || w.flT > FLIGHT.LEG_FOR) {
      if (w.flight === 3) { this.settle(w); return; }
      // (whoever scared it close, or running after it: on it goes. Else it may stop and look back, and then trots off)
      this.runOver(w, k, q, d);
      return;
    }
    // (somebody in its way: it turns away from them, for what it had left)
    if (w.flight === 1 && q && d < FLIGHT.TURN_AT && (w.turnT -= dt) <= 0 && (dx * dxOf(q.x, w.x) + dy * (q.y - w.y)) / (dist * (d || 1)) > 0.3) {
      w.turnT = 0.5;
      this.bolt(w, [q.x, q.y], [Math.max(15, dist), Math.max(15, dist)], false); w.run = false;
      return;
    }
    const sp = w.flight === 3 ? k.flee * FLIGHT.TROT : (w.type === 'cisne' ? FLIGHT.SWAN : k.flee) * (w.flT < FLIGHT.BURST_FOR && w.legs === 0 ? K.burst : 1);
    const s = Math.min(dist, sp * dt), p = STEP;
    p.x = w.x + (dx / dist) * s; p.y = w.y + (dy / dist) * s;
    if (!k.water) collide(p, this.world.collidersNear(p.x, p.y), k.r);
    if (this.offLimits(p, k) || Math.hypot(dxOf(p.x, w.x), p.y - w.y) < s * 0.2) {
      w.vx = w.vy = 0;
      if (g.time < (w.escNo || 0)) return;
      if (++w.blocks >= WOUND.BLOCKS || !this.reaim(w, k, Math.max(s, 0.05), dist, q, d)) {   // (cornered: it stays a moment, and tries again if they are still there)
        w.escNo = g.time + ESCAPE_FOR; w.blocks = 0;
        if (w.flight === 3) this.settle(w);
        else if (!q || d > FLIGHT.TURN_AT * 2) this.runOver(w, k, q, d, true);
      }
      return;
    }
    w.blocks = 0;
    w.faceTo(dx, dy);
    w.vx = (p.x - w.x) / dt; w.vy = (p.y - w.y) / dt;
    w.x = wrapX(p.x); w.y = p.y;
  }
  // The end of a run (stopped: something cut it short)
  runOver(w, k, q, d, stopped = false) {
    const K = SENSES[w.type], near = K.run[0] < 30, after = q && (d < FLIGHT.CLEAR * (near ? 0.3 : 1) || this.chased(w, q, d));
    if (after && w.legs < FLIGHT.LEGS) { this.fleeFrom(w, q.x, q.y, near ? K.run : FLIGHT.LEG, w.legs + 1); return; }
    if (!after && Math.random() < K.look) this.lookBack(w);
    else if (K.trot && !stopped) this.trotOff(w, k);
    else this.settle(w);
  }
  // Is q (d away) running after it?
  chased(w, q, d) {
    const r = this.presence.byKey.get(q.me ? 'me' : q.conn);
    return !!r && r.speed > 4 && d < 70 && (r.vx * dxOf(w.x, r.x) + r.vy * (w.y - r.y)) / (r.speed * (d || 1)) > 0.7;
  }
  // It stops, side on (a quartering stance), the head turned back
  lookBack(w) {
    const x = w.awX ?? w.flX, y = w.awY ?? w.flY, a = Math.atan2(dxOf(x, w.x), y - w.y) + (Math.random() < 0.5 ? -1 : 1) * FLIGHT.STOPPED;
    Object.assign(w, { flight: 2, flT: 0, lookFor: within(FLIGHT.LOOK_FOR), vx: 0, vy: 0, aw: TENSE - 0.05, quiet: 0, alert: A_ALERT, flag: false, staring: true, stareYaw: Math.atan2(dxOf(x, w.x), y - w.y) });
    w.faceTo(Math.sin(a), Math.cos(a));
  }
  trotOff(w, k) {
    const t = SENSES[w.type].trot || 10;
    this.bolt(w, [w.awX ?? w.flX, w.awY ?? w.flY], [t * 0.8, t * 1.2], SENSES[w.type].cover && 'ready');
    Object.assign(w, { flight: 3, flT: 0, run: false, aw: ALERT - 0.01, alert: A_CALM, staring: false, flag: false });
  }
  settle(w) { Object.assign(w, { flight: 0, vx: 0, vy: 0, tx: w.x, ty: w.y, wait: within([3, 7]), aw: Math.min(w.aw, ALERT - 0.01), alert: A_CALM, staring: false, flag: false, quiet: 0 }); }
  // What you hear and see of them, in every game (the host's and the guests'): the stamp of a tense deer and the huff of a
  // boar, the bark of alarm. Not on the world server
  cues(dt) {
    const g = this.game, p = g.player;
    if (Profile.server || !p || g.scene !== g.world) return;
    for (const w of this.list) {
      const was = w.cueA; w.cueA = w.alert;
      if (w.alert === A_TENSE) {
        if ((w.cueT = (w.cueT ?? 0.4) - dt) <= 0) {
          w.cueT = within(HEARD.EVERY); w.stampAt = g.time;
          const v = 1 - distOf(p.x, p.y, w.x, w.y) / HEARD.STAMP;
          if (v > 0) { if (w.type === 'ciervo') Audio.stamp?.(0.3 + 0.7 * v); else if (w.type === 'jabali') Audio.huff?.(0.3 + 0.7 * v); }
        }
      } else if (w.alert === A_ALARM && was !== A_ALARM && was !== undefined) {
        const v = 1 - distOf(p.x, p.y, w.x, w.y) / HEARD.BARK;
        if (v > 0 && !(this.barkAt > g.time) && !this.barked(w)) { this.barkAt = g.time + 0.8; if (w.type === 'ciervo') Audio.alarmBark?.(0.2 + 0.8 * v); else if (w.type === 'jabali') Audio.huff?.(0.4 + 0.6 * v, true); }
      }
      if (w.stampAt !== undefined) { w.stamp = (g.time - w.stampAt) / HEARD.STAMP_FOR; if (!(w.stamp >= 0 && w.stamp < 1)) { w.stamp = 0; w.stampAt = undefined; } }
    }
  }
  // Has its herd barked in this flight already? (one bark each: every game, by the id)
  barked(w) {
    const p = typeof w.id === 'string' && w.id[0] === 'g' ? w.id.slice(0, w.id.lastIndexOf('.')) : null;
    if (!p) return false;
    const M = this.barks ||= new Map(), t = M.get(p), now = this.game.time;
    if (t !== undefined && now - t >= 0 && now - t < 8) return true;
    if (M.size > 40) M.clear();
    M.set(p, now);
    return false;
  }
  // Your tool strikes, a loud thing somewhere, another player's (presence.js)
  toolHit() { this.presence.toolHit(); }
  noise(x, y, n, r) { this.presence.noise(x, y, n, r); }

  // ---------- wounds (host side; Plan G §3.2) ----------
  // Did the player q (an entry of mobs.players) wound w? (w.by: { me } for the host's own player, { conn, id } for a guest)
  // (the connection of a guest changes if theirs drops and comes back: then their profile id says who they are)
  woundedBy(w, q) {
    const b = w.by;
    if (!b || q.me || b.me) return !!b && !!q.me && !!b.me;
    return b.conn === q.conn || (b.id != null && this.game.live.peers?.get(q.conn)?.id === b.id);
  }
  // Is whoever wounded it playing, but underground (or in another scene)?
  wounderAway(w) {
    const g = this.game, b = w.by;
    if (!b) return false;
    if (b.me) return !!g.player && g.scene !== g.world;
    const peer = g.live.peers?.get(g.hunt?.connOf(b));
    return !!peer?.playing && !peer.server && peer.sc !== 'world';
  }
  // hunt.js damage: w was hit and lives. level 1 light, 2 heavy (a wound never gets lighter); from: [x, y] of the hitter.
  // A heavy wound bolts far the first time and runs a shorter, slower way every later time
  wound(w, level, from) {
    if (level > (w.bleed || 0)) { w.bleed = level; w.bleedT = 0; if (level === 2) { w.woundT = 0; w.tickT = 0; } }
    else if (w.bleed === 1) w.bleedT = 0;   // (hit again while lightly wounded: it bleeds LIGHT_FOR more)
    if (w.bleed !== 2) return;
    w.limp = this.limpOf(w);
    if (w.fled) w.runs = (w.runs || 0) + 1;
    this.bolt(w, from, w.fled ? WOUND.GETUP : WOUND.FLIGHT);
    w.fled = true;
  }
  limpOf(w) { const max = w.hpMax || 1; return Math.round(Math.max(0, Math.min(1, 1 - (w.hp ?? max) / max)) * 10) / 10; }
  // Run from the point `from`, dist (a [min, max] range) away, to one point (the end nudged towards cover)
  bolt(w, from, range, cover = true) {
    let a = from && Number.isFinite(from[0]) && Number.isFinite(from[1]) ? Math.atan2(w.y - from[1], dxOf(w.x, from[0])) : Math.random() * Math.PI * 2;   // (away from the hitter; a guest's message may say nowhere)
    const dist = within(range);
    // (not into the village: up to four turns of 60°, alternating sides)
    for (let i = 0; i < 4 && inBounds(wrapX(w.x + Math.cos(a) * dist), w.y + Math.sin(a) * dist); i++) a += (i % 2 ? -1 : 1) * (i + 1) * Math.PI / 3;
    let tx = w.x + Math.cos(a) * dist, ty = w.y + Math.sin(a) * dist;
    // (the cover nearest that point, within COVER_R of it: it ends just past it, on the far side from the hitter; never
    // cover that would cut the run short, back towards where it was hit)
    let best = null, bd = WOUND.COVER_R * WOUND.COVER_R;
    const ca = Math.cos(a), sa = Math.sin(a), keep = dist * 0.8;
    for (const o of (cover && (cover !== 'ready' || this.ready(wrapX(tx), ty)) && this.world.harvestablesNear?.(wrapX(tx), ty)) || []) {
      if (!COVER.has(o.kind)) continue;
      const dx = dxOf(o.x, tx), dy = o.y - ty, d2 = dx * dx + dy * dy;
      if (d2 < bd && (dist + dx * ca + dy * sa) >= keep) { bd = d2; best = [tx + dx, ty + dy]; }
    }
    if (best && !inBounds(wrapX(best[0]), best[1])) { tx = best[0] + Math.cos(a) * 1.2; ty = best[1] + Math.sin(a) * 1.2; }
    Object.assign(w, { tx, ty, lying: false, bedded: false, run: true, runT: 0, blocks: 0, wait: 0, eating: 0, grazing: false, grazeAt: null, fa: Math.atan2(ty - w.y, tx - w.x), side: Math.random() < 0.5 ? -1 : 1 });
  }
  // Are the chunks round (x, y) at hand already? (a flight may end 120 m away, in chunks nothing has asked for yet: making them
  // just to look for cover would be a hitch of up to 20 ms; what is drawn round a player is at hand)
  ready(x, y) {
    const M = this.world.merged, cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!M?.has(`${wrapIndex(cx + dx, CHUNK)},${cy + dy}`)) return false;
    return true;
  }
  // Lie down where it is (and stop): at the end of a run, after RUN_FOR, or blocked BLOCKS times in a row
  // (cornered: with no way out it stays down a moment, or it would get up and lie down every frame with someone on it)
  bed(w, cornered = false) { Object.assign(w, { lying: true, bedded: false, run: false, vx: 0, vy: 0, tx: w.x, ty: w.y, scared: 0, downTill: cornered ? this.game.time + WOUND.CORNERED : 0 }); }
  // A heavily wounded animal: running to its point, or lying until someone standing comes too close
  moveWounded(w, dt, walkers, k) {
    w.eating = 0; w.grazing = false;
    let q = null, d = Infinity;
    for (const o of walkers) { const od = distOf(o.x, o.y, w.x, w.y); if (od < d) { d = od; q = o; } }
    if (w.lying || !w.run) {
      w.vx = w.vy = 0;
      if (!w.lying) { this.bed(w); return; }
      if (q && !(w.downTill > this.game.time) && d < k.fear * WOUND.LIE_FEAR * (q.crouch ? CREEP : 1)) { w.runs = (w.runs || 0) + 1; this.bolt(w, [q.x, q.y], WOUND.GETUP); }
      return;
    }
    const dx = dxOf(w.tx, w.x), dy = w.ty - w.y, dist = Math.hypot(dx, dy);
    if (dist < 0.3 || (w.runT += dt) > WOUND.RUN_FOR) { this.bed(w); return; }
    const missing = 1 - (w.hp ?? w.hpMax ?? 1) / (w.hpMax || 1);
    const sp = k.flee * (1 - WOUND.SLOW * Math.max(0, Math.min(1, missing))) * WOUND.TIRE ** (w.runs || 0);
    const s = Math.min(dist, sp * dt), p = STEP;
    p.x = w.x + (dx / dist) * s; p.y = w.y + (dy / dist) * s;
    collide(p, this.world.collidersNear(p.x, p.y), k.r);
    // (blocked: by water, the village, something built, or a wall it only slides along. move() would cancel the target,
    // which froze a far flight at the first river or fence: it turns towards open ground at the distance left instead,
    // and beds down where it is only when no way out is open BLOCKS times in a row)
    if (this.offLimits(p, k) || Math.hypot(dxOf(p.x, w.x), p.y - w.y) < s * 0.2) {
      w.vx = w.vy = 0;
      if (++w.blocks >= WOUND.BLOCKS || !this.reaim(w, k, Math.max(s, 0.05), dist, q, d)) this.bed(w, true);
      return;
    }
    w.blocks = 0;
    w.faceTo(dx, dy);
    w.vx = (p.x - w.x) / dt; w.vy = (p.y - w.y) / dt;
    w.x = wrapX(p.x); w.y = p.y;
  }
  // A blocked run turns to the first open way from the heading it fled on (w.fa: 45°, 90°, then 135° off it, to the side it
  // turned last first, so it never swings back and forth), keeping the distance left. Open: its next step and 1.5 m
  // that way are free. Never back past whoever is near (q at d: within SHUN). false: no way out
  reaim(w, k, s, dist, q = null, d = Infinity) {
    const fa = w.fa ?? 0, side = w.side || 1, shun = !!q && d < SHUN, ax = shun ? dxOf(w.x, q.x) / (d || 1) : 0, ay = shun ? (w.y - q.y) / (d || 1) : 0;
    for (let n = 0; n < REAIM.length; n++) {
      const turn = REAIM[n] * side, c = Math.cos(fa + turn), sn = Math.sin(fa + turn);
      if (shun && c * ax + sn * ay < -0.2) continue;
      if (!this.open(w, k, c, sn, s) || !this.open(w, k, c, sn, PROBE_D)) continue;
      if (turn) w.side = Math.sign(turn);
      w.tx = w.x + c * Math.max(dist, 4); w.ty = w.y + sn * Math.max(dist, 4);
      return true;
    }
    return false;
  }
  // (is a step of length l in the direction (c, sn) free: not off limits, and not pushed back by what is there)
  open(w, k, c, sn, l) {
    const q = PROBE;
    q.x = w.x + c * l; q.y = w.y + sn * l;
    collide(q, this.world.collidersNear(q.x, q.y), k.r);
    return !this.offLimits(q, k) && Math.hypot(dxOf(q.x, w.x), q.y - w.y) >= l * 0.5;
  }
  // The clocks of every wound: a light one stops, a heavy one takes hp until it bleeds out (hunt.bledOut, after the loop)
  bleedAll(dt) {
    let dead = null;
    for (const w of this.list) {
      if (!(w.bleed > 0)) continue;
      w.bleedT = (w.bleedT || 0) + dt;
      if (w.bleed === 1) {
        if (w.bleedT >= WOUND.LIGHT_FOR) { w.bleed = 0; w.hitAt = Date.now(); }   // (it heals HEAL_AFTER from now: hunt.js)
        continue;
      }
      // (one this game got from another host, without its hp: about what its limp says)
      if (w.hp === undefined) { w.hpMax ||= 8; w.hp = Math.max(1, Math.round(w.hpMax * (1 - (w.limp || 0)))); }
      w.woundT = (w.woundT || 0) + dt;
      if ((w.tickT = (w.tickT || 0) + dt) >= WOUND.BLEED_TICK) { w.tickT -= WOUND.BLEED_TICK; w.hp = (w.hp ?? w.hpMax ?? 1) - 1; w.limp = this.limpOf(w); }
      if (!(w.hp > 0) || w.woundT >= WOUND.HARD_STOP) (dead ||= []).push(w);
    }
    if (dead) for (const w of dead) this.game.hunt?.bledOut(w);
  }
  // Al pararse: si le toca comer y tiene hierba delante del morro, se pone a pastar (si no, lo vuelve a mirar en la
  // próxima parada)
  tryGraze(w) {
    const k = GRAZE[w.type], g = this.game;
    if (w.herd && w.type === 'jabali') {   // (a boar of a herd roots about, its head down)
      if (w.herd.act === 'feed' && !(g.time < (w.grazeNext || 0))) { this.headDown(w, within(HERD.ROOT)); w.grazeNext = g.time + w.eating + within(BOUT.rest); }
      return;
    }
    if (!k || (!sensesOn() && (w.ate || 0) >= k.max) || g.time < (w.grazeNext || 0)) return;
    const [dx, dy] = w.dir || [1, 0], l = Math.hypot(dx, dy) || 1, tx = Math.floor(wrapX(w.x + (dx / l) * k.mouth)), ty = Math.floor(w.y + (dy / l) * k.mouth);
    if (!this.world.pasture(tx, ty, g.days.dayIndex)) {
      // (one of a herd browses where there is no grass: leaves, moss, what the snow hides)
      if (w.herd && !KINDS[w.type].water && Math.random() < 0.5) { this.headDown(w, within(BOUT.bout) * 0.6); w.grazeNext = g.time + w.eating + within(BOUT.rest); }
      return;
    }
    // (with the senses they graze most of the time, but eat of the field as seldom as ever)
    if (sensesOn()) {
      const eats = (w.ate || 0) < k.max && g.time >= (w.mowNext || 0);
      if (eats) w.mowNext = g.time + within(k.every);
      w.grazeAt = eats ? [tx, ty] : null; w.eating = within(BOUT.bout); w.headUp = false; w.headT = within(BOUT.down); w.grazing = true;
      w.grazeNext = g.time + w.eating + within(BOUT.rest);
      return;
    }
    w.grazeAt = [tx, ty]; w.eating = within(k.eat); w.grazing = true;
    w.grazeNext = g.time + within(k.every);
  }
  headDown(w, s) { Object.assign(w, { grazeAt: null, eating: s, headUp: false, headT: within(BOUT.down), grazing: true }); }
  // Se la ha comido: queda como segada (si nadie la ha segado mientras)
  ate(w) {
    if (w.grazeAt) {   // (null: only head down, see tryGraze)
      const [tx, ty] = w.grazeAt, today = this.game.days.dayIndex;
      const touched = !!this.world.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK));   // (sin crearlo: ver arriba)
      if (touched && this.world.pasture(tx, ty, today)) this.world.mow(tx, ty, today);
      w.ate = (w.ate || 0) + 1;
    }
    w.eating = 0; w.headUp = false; w.grazing = false; w.grazeAt = null;
    w.wait = 1 + Math.random() * 3;
  }
  // (invitado) Donde los tiene quien lleva el mundo: [[id, tipo, x, y, herido, pastando, bleed, lying, sx, sy, limp, f]] (the
  // last six optional: an old host sends six or eleven, and then the spawn point is where the animal was first seen, and
  // it is calm: f, senses.js)
  netList(arr) {
    const g = this.game, old = new Map(this.list.map(w => [w.id, w])), md = dayOfYear(g.days.now, g.days.here.y);
    this.list = arr.filter(e => Array.isArray(e) && KINDS[e[1]] && Number.isFinite(e[2]) && Number.isFinite(e[3])).map(([id, type, x, y, hurt, grazing, bleed, lying, sx, sy, limp, f]) => {
      const spawn = Number.isFinite(sx) && Number.isFinite(sy);
      let w = old.get(id);
      // (a reused id is another animal: the host restarted, or the world server after a publish)
      if (w && (w.type !== type || (spawn && w.sx !== undefined && (w.sx !== sx || w.sy !== sy)))) w = null;
      w ||= new Wild(type, x, y, id);
      w.netTo = [x, y]; w.grazing = !!grazing;
      if (hurt && !(w.hurt > 0)) w.hurt = 0.4;
      if (spawn) { w.sx = sx; w.sy = sy; } else if (w.sx === undefined) { w.sx = qs(x); w.sy = qs(y); }
      w.bleed = bleed === 1 || bleed === 2 ? bleed : 0;
      w.lying = !!lying;
      w.limp = Number.isFinite(limp) ? Math.max(0, Math.min(1, limp)) : 0;
      unpackF(f, w); w.flight = 0; w.herd = null;
      w.breed = w.traits ? breedOf(type, w.female, w.young, md) : undefined;   // (it is the host's to run it; if this game takes over, it starts calm)
      // (you hit it a moment ago and the host says it bleeds: its trail is locked for you, hunt.js)
      if (w.bleed > 0 && w.lockAsk !== undefined) { if (g.time - w.lockAsk < LOCK_WAIT) g.tracks?.lock(trailKey(w), 'blood'); w.lockAsk = undefined; }
      return w;
    });
  }
  follow(dt) {
    const k = 1 - Math.exp(-dt * 8);
    for (const w of this.list) {
      if (!w.netTo) continue;
      const dx = dxOf(w.netTo[0], w.x) * k, dy = (w.netTo[1] - w.y) * k, moving = Math.abs(dx) + Math.abs(dy) > 1e-3;
      if (moving) w.faceTo(dx, dy);
      w.vx = moving ? dx / dt : 0; w.vy = moving ? dy / dt : 0;
      w.x = wrapX(w.x + dx); w.y += dy;
    }
  }
  // ¿Hay algo construido (un tejado o un suelo) a menos de r de este punto? Asked for every animal on every step: what each
  // tile has is kept until something changes in the world (touches), or 2 s (the village's own houses change without it)
  built(x, y, r) {
    if (this.builtAt(Math.floor(x), Math.floor(y))) return true;
    return r > 0 && (this.builtAt(Math.floor(x + r), Math.floor(y)) || this.builtAt(Math.floor(x - r), Math.floor(y)) || this.builtAt(Math.floor(x), Math.floor(y + r)) || this.builtAt(Math.floor(x), Math.floor(y - r)));
  }
  builtAt(tx, ty) {
    const w = this.world, C = this.bCache, slot = Math.floor(this.game.time / 2);
    if (this.bWorld !== w || this.bTouch !== w.touches || this.bSlot !== slot || C.size > 2048) { C.clear(); this.bWorld = w; this.bTouch = w.touches; this.bSlot = slot; }
    const key = (tx + 65536) * 131072 + (ty + 65536);
    let v = C.get(key);
    if (v === undefined) C.set(key, v = w.roofAt(tx, ty) || !!w.at('floor', tx, ty));
    return v;
  }
  // The wild animals bleeding or lying wounded (a new array: for missions and tests, not for every frame)
  wounded() { return this.list.filter(w => w.bleed > 0 || w.lying); }
  // Uno nuevo (también con /summon: lo hace quien lleva el mundo). Its spawn point (sx, sy) keys its trail: trailKey
  summon(type, x, y) { const w = new Wild(type, wrapX(x), y, `w${++this.n}`); w.sx = qs(w.x); w.sy = qs(w.y); this.list.push(w); return w; }
  entities(scene) { return scene === this.world ? this.list : null; }
  // El salvaje más cercano a un punto (para que el perro le ladre)
  near(x, y, r) { return this.list.find(w => w.type !== 'cisne' && Math.hypot(w.x - x, w.y - y) < r) || null; }
}
