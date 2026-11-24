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
// carries [id, type, x, y, hurt, grazing, bleed, lying, sx, sy, limp]: the last five are optional (old peers send six).
// sx, sy: the spawn point, quantised, which keys the animal's trail (trailKey; tracks.js lays the backtrail to it).
// ?wounds=0 (opciones.js) keeps the old behaviour: no bleeding, heal after 30 s, gone beyond GONE.
import { B } from './world/biomes.js';
import { inBounds } from './world/village.js';
import { CHUNK } from './world/gen.js';
import { collide } from './physics.js';
import { wrapX, dxOf, distOf } from './world/planet.js';
import { apagada } from './opciones.js';

const MAX = 6, SPAWN_EVERY = 4, NEAR = [14, 26], GONE = 42, CREEP = 0.3, SEND_EVERY = 0.15, RESEND = 2;
const ESCAPE_FOR = 0.6;   // seconds a fleeing animal keeps the way it turned to when something was in its way
const LOCK_WAIT = 5;   // seconds a guest's hit waits for the host to say the animal bleeds (then no auto lock)
const KINDS = {
  ciervo: { biomes: [B.FOREST, B.PINES, B.MEADOW], hours: [6, 20], speed: 0.8, flee: 5.5, fear: 7, r: 0.55 },
  jabali: { biomes: [B.FOREST, B.PINES], hours: [5, 23], speed: 0.9, flee: 4.8, fear: 4.5, r: 0.45 },
  cisne: { water: true, biomes: [B.LAKE], hours: [6, 21], speed: 0.4, flee: 1.2, fear: 4, r: 0.35 },
};

// Los que pastan: hasta dónde llega el morro, cuántas casillas se comen como mucho, cada cuánto (segundos) y cuánto tardan
const GRAZE = { ciervo: { mouth: 0.75, max: 5, every: [25, 60], eat: [6, 11] } };

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
// On unless ?wounds=0. Wildlife.wounds: the tests turn it on and off without the URL
export const woundsOn = () => Wildlife.wounds ?? !apagada('wounds');

// The src of a wild animal's trail (tracks.js, Plan G §3.1): wild ids restart with the host, so the id alone could join two
// animals' trails; the spawn point (w.sx, w.sy: set by the host at spawn, quantised, and sent in 'wild') tells them apart
export const trailKey = w => `${w.id}@${w.sx ?? '?'},${w.sy ?? '?'}`;

class Wild {
  constructor(type, x, y, id) { Object.assign(this, { id, type, x, y, tx: x, ty: y, wait: Math.random() * 3, vx: 0, vy: 0, scared: 0, bleed: 0, lying: false, limp: 0 }); }
  faceTo(dx, dy) { this.dir = [dx, dy]; }
}

export class Wildlife {
  static wounds = null;
  constructor(game) { this.game = game; this.list = []; this.t = 0; this.n = 0; this.sendT = 0; this.resend = 0; this.lastSent = ''; this.bCache = new Map(); this.bWorld = null; this.bTouch = -1; this.bSlot = -1; }
  reset() { this.list = []; this.lastSent = ''; }
  get world() { return this.game.world; }

  update(dt) {
    const g = this.game;
    if (!g.world) return;
    if (g.live.guest) { this.follow(dt); return; }   // (en el mundo de otro, donde dice su juego)
    const players = g.mobs.players(), walkers = players.filter(q => q.gm !== 'spectator');
    // (el que se queda lejos de todos, o dentro de algo construido, se va; a wounded one only beyond LEASH, so its trail
    // leads somewhere, and a badly wounded one not while whoever wounded it is in a cave: they come back to its trail)
    this.list = this.list.filter(w => (players.some(q => distOf(q.x, q.y, w.x, w.y) < (w.bleed > 0 || w.lying ? WOUND.LEASH : GONE)) || (w.bleed === 2 && this.wounderAway(w))) && (KINDS[w.type].water || !this.built(w.x, w.y, 0)));
    if ((this.t += dt) > SPAWN_EVERY) {
      this.t = 0;
      // (a wounded animal beyond GONE still counts for whoever wounded it, or every wound would let one more spawn)
      for (const q of walkers) {
        let n = 0;
        for (const w of this.list) if (distOf(q.x, q.y, w.x, w.y) < GONE || (w.bleed > 0 && this.woundedBy(w, q))) n++;
        if (n < MAX) this.spawn(q, walkers);
      }
    }
    for (const w of this.list) this.move(w, dt, walkers);
    this.bleedAll(dt);
    if (g.live.joined && (this.sendT += dt) >= SEND_EVERY) {
      const m = this.list.map(w => [w.id, w.type, r2(w.x), r2(w.y), w.hurt > 0 ? 1 : 0, w.grazing ? 1 : 0, w.bleed || 0, w.lying ? 1 : 0, w.sx ?? r2(w.x), w.sy ?? r2(w.y), w.limp || 0]), s = JSON.stringify(m);
      this.resend += this.sendT; this.sendT = 0;
      if (s !== this.lastSent || this.resend >= RESEND) { this.lastSent = s; this.resend = 0; g.live.net?.send({ t: 'wild', w: m }); }   // (de vez en cuando, aunque no cambie: por quien acaba de entrar)
    }
  }
  // Uno nuevo en un sitio que le vaya, a cierta distancia de quien juega (y de los demás) y fuera del pueblo
  spawn(q, walkers) {
    const a = Math.random() * Math.PI * 2, r = NEAR[0] + Math.random() * (NEAR[1] - NEAR[0]);
    const x = wrapX(q.x + Math.cos(a) * r), y = q.y + Math.sin(a) * r, h = this.game.days.hourAt(x);
    if (inBounds(x, y) || walkers.some(o => distOf(o.x, o.y, x, y) < NEAR[0])) return;
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
    if (w.bleed === 2) { this.moveWounded(w, dt, walkers, k); return; }
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
    const dx = w.tx - w.x, dy = w.ty - w.y, dist = Math.hypot(dx, dy);
    if (dist < 0.2) { const a = Math.random() * Math.PI * 2; w.tx = w.x + Math.cos(a) * 3; w.ty = w.y + Math.sin(a) * 3; w.wait = 2 + Math.random() * 6; w.vx = w.vy = 0; this.tryGraze(w); return; }
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
      return;
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
  bolt(w, from, range) {
    let a = from && Number.isFinite(from[0]) && Number.isFinite(from[1]) ? Math.atan2(w.y - from[1], dxOf(w.x, from[0])) : Math.random() * Math.PI * 2;   // (away from the hitter; a guest's message may say nowhere)
    const dist = within(range);
    // (not into the village: up to four turns of 60°, alternating sides)
    for (let i = 0; i < 4 && inBounds(wrapX(w.x + Math.cos(a) * dist), w.y + Math.sin(a) * dist); i++) a += (i % 2 ? -1 : 1) * (i + 1) * Math.PI / 3;
    let tx = w.x + Math.cos(a) * dist, ty = w.y + Math.sin(a) * dist;
    // (the cover nearest that point, within COVER_R of it: it ends just past it, on the far side from the hitter; never
    // cover that would cut the run short, back towards where it was hit)
    let best = null, bd = WOUND.COVER_R * WOUND.COVER_R;
    const ca = Math.cos(a), sa = Math.sin(a), keep = dist * 0.8;
    for (const o of this.world.harvestablesNear?.(wrapX(tx), ty) || []) {
      if (!COVER.has(o.kind)) continue;
      const dx = dxOf(o.x, tx), dy = o.y - ty, d2 = dx * dx + dy * dy;
      if (d2 < bd && (dist + dx * ca + dy * sa) >= keep) { bd = d2; best = [tx + dx, ty + dy]; }
    }
    if (best && !inBounds(wrapX(best[0]), best[1])) { tx = best[0] + Math.cos(a) * 1.2; ty = best[1] + Math.sin(a) * 1.2; }
    Object.assign(w, { tx, ty, lying: false, run: true, runT: 0, blocks: 0, wait: 0, eating: 0, grazing: false, grazeAt: null, fa: Math.atan2(ty - w.y, tx - w.x), side: Math.random() < 0.5 ? -1 : 1 });
  }
  // Lie down where it is (and stop): at the end of a run, after RUN_FOR, or blocked BLOCKS times in a row
  // (cornered: with no way out it stays down a moment, or it would get up and lie down every frame with someone on it)
  bed(w, cornered = false) { Object.assign(w, { lying: true, run: false, vx: 0, vy: 0, tx: w.x, ty: w.y, scared: 0, downTill: cornered ? this.game.time + WOUND.CORNERED : 0 }); }
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
    if (!k || (w.ate || 0) >= k.max || g.time < (w.grazeNext || 0)) return;
    const [dx, dy] = w.dir || [1, 0], l = Math.hypot(dx, dy) || 1, tx = Math.floor(wrapX(w.x + (dx / l) * k.mouth)), ty = Math.floor(w.y + (dy / l) * k.mouth);
    if (!this.world.pasture(tx, ty, g.days.dayIndex)) return;
    w.grazeAt = [tx, ty]; w.eating = within(k.eat); w.grazing = true;
    w.grazeNext = g.time + within(k.every);
  }
  // Se la ha comido: queda como segada (si nadie la ha segado mientras)
  ate(w) {
    const [tx, ty] = w.grazeAt, today = this.game.days.dayIndex;
    const touched = !!this.world.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK));   // (sin crearlo: ver arriba)
    if (touched && this.world.pasture(tx, ty, today)) this.world.mow(tx, ty, today);
    w.ate = (w.ate || 0) + 1;
    w.eating = 0; w.grazing = false; w.grazeAt = null;
    w.wait = 1 + Math.random() * 3;
  }
  // (invitado) Donde los tiene quien lleva el mundo: [[id, tipo, x, y, herido, pastando, bleed, lying, sx, sy, limp]] (the
  // last five optional: an old host sends six, and then the spawn point is where the animal was first seen)
  netList(arr) {
    const g = this.game, old = new Map(this.list.map(w => [w.id, w]));
    this.list = arr.filter(e => Array.isArray(e) && KINDS[e[1]] && Number.isFinite(e[2]) && Number.isFinite(e[3])).map(([id, type, x, y, hurt, grazing, bleed, lying, sx, sy, limp]) => {
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
