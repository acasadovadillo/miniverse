// Predators (Plan R3-5, docs/planes/realismo/PLAN-R3-caza.md §3.11): shy Iberian wolves in packs far from the village, and
// foxes near the farms at night. What a player meets of them:
//   - Howls: a pack within HOWL.R howls at night every 3 to 8 minutes. Every game works them out from the world's seed and
//     the clock (howlPhase), so everybody hears the same howl at the same moment and nothing travels; panned by direction.
//   - The pack itself: by day it rests at its den (sitting, w.bedded), at night it roams round it. Whoever runs the world makes
//     a pack real when a player comes within NEAR of it (never nearer anybody than MIN) and moves it (move, from wildlife.js);
//     the wolves are 'lobo' entries of wildlife.list, so they travel in the 'wild' message like the deer. They avoid people:
//     once they notice you (awareness AWAY, the senses of senses.js) they trot off to WATCH m, stand looking at you for a few
//     seconds and leave; that pack is not met again for AWAY_FOR seconds.
//   - Kill sites: once a real day each pack kills a deer near its den (killOf, by the seed and the day: the same for all).
//     Fresh for a day (part eaten: E takes a little meat, once each), then only bones for another day; wolf prints round it.
//   - Scavengers: a gut pile or an ungutted carcass left in a pack's territory over a night (by 03:00 there) is visited:
//     the gut pile is gone by morning and the carcass loses one star (its Q, quality.js). Inside a building, by a placed table
//     or bench, or in the village, it is safe. Whoever runs the world does it, and writes d.wolf["x,y"] = when (the prints
//     every game lays round it). This is the payback of gutting and carrying promptly.
//   - Danger: only on hard, in winter, at night: a pack within NIP.R of a player carrying a carcass or bloody (blood over
//     0.5) follows them and one wolf nips once (NIP.DMG, through wildlife.hurtPlayer: never under the difficulty's floor).
//     A torch in hand, a hit or an arrow makes them leave. On easy and normal they never come near.
//   - The horse shies at a wolf within SPOOK m (horseacts.js, horse.js); your dog growls, no bark, at a wolf within GROWL m
//     upwind of it (an early warning).
//   - Foxes: one to a meadow territory, out at night (FOX_NIGHT), alone and quick to run; huntable (a hide). A coop or a
//     hutch with its door open at night and no dog is visited: a real fox comes to it if somebody is near (coop), and in the
//     morning there are prints at its door; ranch.js nightVisits says so (no animal is taken: it only frightens them).
// The wolf hide (wolf_hide) makes a warm rug and the lining of a winter coat at the loom (recipes.js).
// Saves: out.pred = { taken: [kill keys] } (the kills you took meat from). Nothing else is saved (wild animals are not).
// ?depredadores=0 (opciones.js PARTES): none of it (no wolves, foxes, howls, kills or scavengers; old nightVisits).
import { ihash } from './util.js';
import { B, wetness } from './world/biomes.js';
import { BOUNDS, inBounds } from './world/village.js';
import { CHUNK } from './world/gen.js';
import { wrapX, wrapIndex, dxOf, distOf, inPlanet } from './world/planet.js';
import { apagada } from './opciones.js';
import { Audio } from './audio.js';
import { Profile } from './accounts.js';
import { t } from './i18n.js';
import { dayOfYear, winterOn } from './herds.js';
import { SENSES, perceive, advance, DIFF_K, lightAt, FAR, A_CALM, A_ALERT, downwind } from './senses.js';
import { cleanCq } from './quality.js';

export const PCELL = 256, FCELL = 128;   // a pack's territory and a fox's, m
const DAY = 864e5, HOUR = 36e5, TAU = Math.PI * 2;
// The balance, all together (m, game seconds, hours)
export const PRED = {
  CHANCE: 0.25, FOX: 0.4,       // of an eligible territory having a pack (pines, woods or snow), or a fox (meadow)
  SHARE: 7, FOX_SHARE: 6,       // of its 16 points of land being that, for it to count
  VILLAGE: 400, FOX_VILLAGE: 60,   // no den nearer the village than this
  PACK: [2, 5],
  NIGHT: [19, 8], FOX_NIGHT: [20, 6],   // out from the first hour to the second (the hour there)
  ROAM: [40, 90], FOX_ROAM: [12, 35], ROAM_S: 1800,   // how far round its den the middle wanders at night, and how slowly
  NEAR: 110, GONE: 170, MIN: 50, LEAVE_FOR: 40, HIDDEN: 40, FOX_NEAR: 70, FOX_MIN: 35,
  AWAY: 0.5, FOX_AWAY: 0.4, WATCH: 60, LEAVE: [6, 10], AWAY_FOR: 1200,
  WALK: 1.1, TROT: 2.6, RUN: 6.5, FOX_RUN: 6,
  HOWL: { SLOT: 330, JIT: 150, FOR: 6, R: 600 },
  KILL: { R: [40, 120], REACH: 2.6, SEE: 150, MEAT: 1, FOUND: 14, AT: 5 },   // (AT: the hour of the night it happens, there)
  NIP: { R: 30, NEAR: 1.6, DMG: 2, FOLLOW: 12, BLOOD: 0.5, FOR: 90 },
  SPOOK: 15, GROWL: 60, LOUD: 15, GROWL_EVERY: 20,
  COOP: { R: 40, CHANCE: 0.35, AWAY: 26, FOR: [25, 45], NIGHT: [22, 5], ALONE: 0.1 },
  FRESH: 14,
  PRINT_AGE: 150, RELAY: 420,  // (the prints round a kill or a visited gut pile: how old they look, s, and how often they are laid again)                    // territories worked out at most each second (each looks at 16 points of land)
  SCAV_AT: 3, SCAV_EVERY: 20, SCAV_Q: 25, SCAV_DAYS: 3, NOTE_DAYS: 2,
  SAFE: new Set(['mesa', 'mesa_grande', 'mesa_baja', 'banco']),
};
export const predatorsOn = () => Predators.force ?? !apagada('depredadores');
export const isPredator = type => type === 'lobo' || type === 'zorro';
const lerp = (a, b, k) => a + (b - a) * k;
const within = ([a, b]) => a + Math.random() * (b - a);
const villageD = (x, y) => Math.hypot(Math.max(0, BOUNDS.x0 - wrapX(x), wrapX(x) - BOUNDS.x1), Math.max(0, BOUNDS.y0 - y, y - BOUNDS.y1));
export const nightIn = ([a, b], h) => (a > b ? h >= a || h < b : h >= a && h < b);
const wolfLand = b => b === B.FOREST || b === B.PINES || b === B.SNOW;
const foxLand = b => b === B.MEADOW;

// ---------- the territories (pure: H is herds.js Herds, for its land and its seed) ----------
// A pack's territory (pcx, pcy: in PCELL): { id, kind: 'wolf', pcx, pcy, den: [x, y], n } or null
export function packOf(H, pcx, pcy) { return territory(H, pcx, pcy, PCELL, wolfLand, PRED.SHARE, PRED.VILLAGE, PRED.CHANCE, 'wolf'); }
export function foxOf(H, fcx, fcy) { return territory(H, fcx, fcy, FCELL, foxLand, PRED.FOX_SHARE, PRED.FOX_VILLAGE, PRED.FOX, 'fox'); }
function territory(H, cx, cy, S, good, share, village, chance, kind) {
  const roll = n => ihash(cx * 13 + n * 911, cy * 7 - n * 367, H.seed + (kind === 'wolf' ? 9700 : 9800));
  if (roll(0) >= chance) return null;
  const x0 = cx * S, y0 = cy * S, pts = [];
  let n = 0;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const x = x0 + (i + 0.5) * S / 4, y = y0 + (j + 0.5) * S / 4;
    if (!inPlanet(wrapX(x), y)) continue;
    const b = H.land(x, y);
    if (good(b) && wetness(H.c) <= -0.05) { n++; pts.push([x, y]); }
  }
  if (n < share) return null;
  for (let k = 0; k < pts.length; k++) {
    const p = pts[(Math.floor(roll(1) * pts.length) + k) % pts.length], x = wrapX(p[0] + (roll(2 + k) - 0.5) * S / 8), y = p[1] + (roll(20 + k) - 0.5) * S / 8;
    if (villageD(x, y) < village || !good(H.land(x, y)) || wetness(H.c) > -0.05) continue;
    const [a, b] = kind === 'wolf' ? PRED.PACK : [1, 1];
    return { id: `${kind === 'wolf' ? 'p' : 'f'}${wrapIndex(cx, S)}.${cy}`, kind, cx: wrapIndex(cx, S), cy, den: [x, y], n: a + Math.floor(roll(40) * (b - a + 1)), s: roll(41) };
  }
  return null;
}
// Where its middle is at an hour (h, there) and a moment (ms, the game's clock), into out: { x, y, out (roaming or not) }
export function whereOf(T, h, ms, out) {
  const fox = T.kind === 'fox', night = nightIn(fox ? PRED.FOX_NIGHT : PRED.NIGHT, h);
  out.x = T.den[0]; out.y = T.den[1]; out.out = night;
  if (night) {
    const R = lerp(...(fox ? PRED.FOX_ROAM : PRED.ROAM), T.s), p = T.s * TAU + (ms / 1000 / PRED.ROAM_S) * TAU;
    out.x = wrapX(out.x + Math.cos(p) * R); out.y += Math.sin(p * 0.7 + 1) * R * 0.8;
  }
  return out;
}
// How far into a howl a pack is now (0..1), or -1: at night, one every 3 to 8 minutes, by its id and the clock
export function howlPhase(id, ms, h) {
  if (!nightIn([20, 6], h)) return -1;
  let k = 11;
  for (let i = 0; i < id.length; i++) k = (k * 31 + id.charCodeAt(i)) % 9973;
  const s = ms / 1000, n = Math.floor(s / PRED.HOWL.SLOT), d = s - (n * PRED.HOWL.SLOT + ihash(n, k, 1277) * PRED.HOWL.JIT);
  return d >= 0 && d < PRED.HOWL.FOR ? d / PRED.HOWL.FOR : -1;
}
// The pack's kill of a day (its "day" starts at KILL.AT there): { key, x, y, yaw, day } or null. H: for the land
export function killOf(H, T, day) {
  const r = n => ihash(day * 7 + n * 131, T.cx * 17 + T.cy * 29, H.seed + 9900);
  for (let i = 0; i < 6; i++) {
    const a = r(i) * TAU, d = lerp(...PRED.KILL.R, r(10 + i)), x = wrapX(T.den[0] + Math.cos(a) * d), y = T.den[1] + Math.sin(a) * d;
    if (!inPlanet(x, y) || villageD(x, y) < PRED.VILLAGE * 0.8) continue;
    const b = H.land(x, y);
    if (b === B.LAKE || b === B.OCEAN || b === B.SHALLOW || wetness(H.c) > -0.05) continue;
    return { key: `${T.id}:${day}`, x, y, yaw: r(30) * TAU, day };
  }
  return null;
}
// The day of the kills at a moment (ms) where the local hour is h: a day starts at KILL.AT
export const killDay = (ms, h) => Math.floor((ms - (((h - PRED.KILL.AT) % 24 + 24) % 24) * HOUR + 12 * HOUR) / DAY);
// Has a night (its SCAV_AT hour there) gone by since t0? now: ms, h: the hour there now
export function nightPassed(t0, now, h) {
  if (!Number.isFinite(t0) || now - t0 > PRED.SCAV_DAYS * DAY) return false;
  const last = now - (((h - PRED.SCAV_AT) % 24 + 24) % 24) * HOUR;
  return t0 < last;
}
// May wolves come at a player now? Only on hard, in winter, at night
export const mayNip = (diff, md, h) => diff === 'hard' && winterOn(md) && nightIn(PRED.NIGHT, h);

const WHERE = { x: 0, y: 0, out: false }, SEEN = {}, ENV = { light: 1, sky: 1, diff: 1, wx: 1, wy: 0, ws: 0.4 }, ANIMAL = { fx: 0, fy: 1, down: false, staring: false, bedded: false };

export class Predators {
  static force = null;
  constructor(game) {
    this.game = game;
    this.terr = new Map();      // 'kind:cx,cy' → territory or null (an LRU)
    this.real = new Map();      // territory id → { T, list, mode, aw, ... } (whoever runs the world)
    this.away = new Map();      // territory id → game time until which it is not met again
    this.taken = [];            // the kills you took meat from (saved)
    this.kills = []; this.killsV = 0; this.killSig = '';
    this.howled = new Map(); this.t = 0; this.hT = 0; this.sT = 0; this.gT = 0; this.n = 0;
    this.printed = new Set();   // (the kill sites this game has said it found)
    this.laid = new Map();      // (the prints this game has laid: src → game time)
    this.coops = new Map();     // 'tx,ty' → the night a fox came to it (the night's day number)
    this.stats = { ms: 0 }; this.budget = Infinity;
  }
  get on() { return predatorsOn(); }
  reset(save) {
    const v = save?.pred;
    this.taken = Array.isArray(v?.taken) ? v.taken.filter(k => typeof k === 'string').slice(-40) : [];
    this.real.clear(); this.away.clear(); this.kills = []; this.killsV++; this.killSig = ''; this.printed.clear(); this.laid.clear(); this.howled.clear();
  }
  save(out) { if (this.taken.length) out.pred = { taken: this.taken.slice(-40) }; }
  herds() { return this.game.wildlife?.herdsOf?.() || null; }
  ms() { return this.game.days.now; }   // (the game's clock, ms: the tests hold it)
  // The territory of a kind at a cell (cached)
  at(H, kind, cx, cy) {
    const S = kind === 'wolf' ? PCELL : FCELL, k = kind[0] + wrapIndex(cx, S) + ',' + cy;
    if (this.terr.has(k)) return this.terr.get(k);
    if (this.budget <= 0) return null;   // (new ones worked out a few a second: the rest next time)
    this.budget--;
    const T = kind === 'wolf' ? packOf(H, cx, cy) : foxOf(H, cx, cy);
    this.terr.set(k, T);
    if (this.terr.size > 400) this.terr.delete(this.terr.keys().next().value);
    return T;
  }
  // Every territory of a kind round (x, y), fn(T) (reach: cells each side)
  around(H, kind, x, y, reach, fn) {
    const S = kind === 'wolf' ? PCELL : FCELL, cx = Math.floor(wrapX(x) / S), cy = Math.floor(y / S);
    for (let j = -reach; j <= reach; j++) for (let i = -reach; i <= reach; i++) { const T = this.at(H, kind, cx + i, cy + j); if (T) fn(T); }
  }
  // The pack whose territory (x, y) is in, or null
  packAt(H, x, y) { return this.at(H, 'wolf', Math.floor(wrapX(x) / PCELL), Math.floor(y / PCELL)); }
  decides() { const L = this.game.live; return !L?.guest; }

  update(dt) {
    const g = this.game;
    if (!g.world) return;
    if (!this.on) { if (this.real.size) this.clear(); return; }
    const t0 = performance.now();
    const H = this.herds();
    if (H && (this.t += dt) >= 1) {
      this.t = 0; this.budget = PRED.FRESH;
      if (this.decides()) { this.spawnTick(H); this.coopTick(H); }
      else if (this.real.size) this.real.clear();
      this.listen(H); this.findKills(H); this.dogs();
      this.budget = Infinity;
    }
    if (H && this.decides() && (this.sT += dt) >= PRED.SCAV_EVERY) { this.sT = 0; this.scavenge(H); }
    this.howlPoses();
    this.stats.ms = performance.now() - t0;
  }
  clear() { const W = this.game.wildlife; if (W) W.list = W.list.filter(w => !isPredator(w.type)); this.real.clear(); }

  // ---------- the real ones (whoever runs the world) ----------
  spawnTick(H) {
    const g = this.game, W = g.wildlife, walkers = g.mobs.players().filter(q => q.gm !== 'spectator'), ms = this.ms(), now = g.time;
    // (ones of a territory with no pack here: another game ran the world until now. They go; the pack comes back as its own)
    if (W.list.some(w => isPredator(w.type) && !w.pack && /^[pfc]-?\d/.test(String(w.id)))) W.list = W.list.filter(w => !(isPredator(w.type) && !w.pack && /^[pfc]-?\d/.test(String(w.id))));
    // (who is left of each; a pack nobody is near any more goes)
    for (const [id, G] of this.real) {
      G.list = G.list.filter(w => W.list.includes(w));
      if (!G.list.length || !G.list.some(w => walkers.some(q => distOf(q.x, q.y, w.x, w.y) < PRED.GONE))) { this.vanish(G); continue; }
      // (gone off: once out of everybody's way, or a while after, out of sight in the trees)
      if ((G.mode === 'leave' || G.mode === 'flee') && !G.list.some(w => walkers.some(q => distOf(q.x, q.y, w.x, w.y) < (now - G.leaveT > PRED.LEAVE_FOR ? PRED.HIDDEN : PRED.WATCH + 30)))) { this.away.set(id, now + PRED.AWAY_FOR); this.vanish(G); }
    }
    for (const q of walkers) {
      if (inBounds(q.x, q.y)) continue;
      this.around(H, 'wolf', q.x, q.y, 1, T => this.tryAppear(T, H, walkers, ms, now));
      this.around(H, 'fox', q.x, q.y, 1, T => this.tryAppear(T, H, walkers, ms, now));
    }
  }
  tryAppear(T, H, walkers, ms, now) {
    if (this.real.has(T.id) || this.away.get(T.id) > now) return;
    const g = this.game, h = g.days.hourAt(T.den[0]), fox = T.kind === 'fox';
    whereOf(T, h, ms, WHERE);
    if (fox && !WHERE.out) return;   // (a fox by day is in its earth)
    const d = Math.min(...walkers.map(q => distOf(q.x, q.y, WHERE.x, WHERE.y)));
    if (d > (fox ? PRED.FOX_NEAR : PRED.NEAR) || d < (fox ? PRED.FOX_MIN : PRED.MIN)) return;
    if (!this.ready(WHERE.x, WHERE.y)) { this.game.wildlife.warm(WHERE.x, WHERE.y); return; }
    this.make(T, WHERE.x, WHERE.y, walkers, WHERE.out ? 'roam' : 'rest');
  }
  ready(x, y) { return this.game.wildlife.ready(x, y); }
  loaded(x, y) { return !!this.game.world.merged?.has(`${wrapIndex(Math.floor(wrapX(x) / CHUNK), CHUNK)},${Math.floor(y / CHUNK)}`); }
  // A territory's animals come into being round (x, y)
  make(T, x, y, walkers, mode, extra = null) {
    const g = this.game, W = g.wildlife, type = T.kind === 'wolf' ? 'lobo' : 'zorro', k = W.kindOf(type), fox = T.kind === 'fox';
    const G = { T, id: T.id, list: [], mode, aw: 0, quiet: 9, watchT: 0, from: null, nip: false, senseT: 0, ...extra };
    for (let i = 0; i < T.n; i++) {
      const a = (i / T.n) * TAU + Math.random() * 0.6, p = W.placeNear(x, y, [fox ? 0 : 2, fox ? 1 : 7], a, k, walkers);
      if (!p) continue;
      const w = W.summon(type, p[0], p[1]);
      w.id = `${T.id}.${i}`; w.pack = G; w.slot = a; w.dir = [Math.cos(a), Math.sin(a)];
      if (mode === 'rest') w.bedded = true;
      G.list.push(w);
    }
    if (!G.list.length) return null;
    this.real.set(T.id, G);
    return G;
  }
  vanish(G) {
    const W = this.game.wildlife;
    this.real.delete(G.id);
    W.list = W.list.filter(w => w.pack !== G || W.leave(w));
  }
  // (wildlife.js move, for 'lobo' and 'zorro': whoever runs the world) One of them, this frame
  move(w, dt, walkers) {
    const g = this.game, W = g.wildlife, k = W.kindOf(w.type), G = w.pack, now = g.time;
    if (!G || !this.real.has(G.id) || !this.on) { W.wander(w, dt, k, PRED.WALK); return; }   // (a summoned one: on its own)
    if (w === G.list[0]) this.think(G, dt, walkers);
    const fox = G.T.kind === 'fox', i = G.list.indexOf(w);
    let tx = G.cx ?? w.x, ty = G.cy ?? w.y, sp = PRED.WALK, flee = false;
    w.alert = A_CALM; w.staring = false;
    if (G.mode === 'rest') {
      const a = w.slot, r = 1.5 + i * 1.2;
      tx = G.T.den[0] + Math.cos(a) * r; ty = G.T.den[1] + Math.sin(a) * r; sp = PRED.WALK;
    } else if (G.mode === 'roam' || G.mode === 'coop') {
      const a = w.slot + now * 0.05, r = fox ? 0 : 3 + i * 2.5;
      tx += Math.cos(a) * r; ty += Math.sin(a) * r; sp = fox ? PRED.WALK * 1.3 : PRED.TROT * 0.6;
    } else if (G.mode === 'watch' || G.mode === 'follow') {
      const a = w.slot, r = 2 + i * 2;
      tx += Math.cos(a) * r; ty += Math.sin(a) * r; sp = PRED.TROT;
      if (G.from) { w.staring = true; w.alert = A_ALERT; w.stareYaw = Math.atan2(dxOf(G.from.x, w.x), G.from.y - w.y); }
      if (G.mode === 'follow' && G.bold === w && G.q && !G.nip) {
        tx = G.q.x; ty = G.q.y; sp = PRED.RUN * 0.8;
      }
    } else { sp = G.mode === 'flee' ? (fox ? PRED.FOX_RUN : PRED.RUN) : PRED.TROT; flee = true; const a = w.slot; tx += Math.cos(a) * (2 + i * 2); ty += Math.sin(a) * (2 + i * 2); }
    const d = Math.hypot(dxOf(tx, w.x), ty - w.y);
    if (d < 0.6) {
      w.vx = w.vy = 0; w.tx = w.x; w.ty = w.y;
      w.bedded = G.mode === 'rest';
      if (w.staring) w.dir = [Math.sin(w.stareYaw), Math.cos(w.stareYaw)];
      return;
    }
    w.bedded = false;
    // (held up by a trunk, a rock or a fence on its way: round it, to one side for a moment)
    if (d > 2) {
      if (d < (w.bd ?? Infinity) - 0.3 || Math.abs(d - (w.bd ?? d)) > 8) { w.bd = d; w.bdT = now; }
      else if (now - (w.bdT ?? now) > 1.5) { w.bdT = now; w.bd = d; w.side = now + 1.2; w.sideK = -(w.sideK || 1); }
      if (w.side > now) { const ax = dxOf(tx, w.x), ay = ty - w.y, l = Math.hypot(ax, ay) || 1; tx = w.x + (ax - ay * 1.5 * w.sideK) / l * 3; ty = w.y + (ay + ax * 1.5 * w.sideK) / l * 3; }
    }
    w.tx = w.x + dxOf(tx, w.x); w.ty = ty;   // (the short way round the planet: wander steers by tx - x)
    W.wander(w, dt, k, d < 3 && sp > PRED.WALK ? PRED.WALK : sp, flee);
    // (the bold one of a following pack, at the player: one nip, then they all leave)
    if (G.mode === 'follow' && G.bold === w && G.q && !G.nip && distOf(w.x, w.y, G.q.x, G.q.y) < PRED.NIP.NEAR) {
      G.nip = true; G.T.nipDay = Math.floor(this.ms() / DAY);
      W.hurtPlayer(G.q, PRED.NIP.DMG, w);
      if (G.q.me && !Profile.server) Audio.snarl?.(1);
      this.leave(G, G.q.x, G.q.y);
    }
  }
  // Once per pack and frame: its middle, what it notices, what it does
  think(G, dt, walkers) {
    const g = this.game, ms = this.ms(), now = g.time, T = G.T, fox = T.kind === 'fox', h = g.days.hourAt(T.den[0]);
    if (G.mode === 'rest' || G.mode === 'roam') {
      whereOf(T, h, ms, WHERE);
      G.cx = WHERE.x; G.cy = WHERE.y;
      const want = WHERE.out ? 'roam' : 'rest';
      if (G.mode !== want) { G.mode = want; if (fox && want === 'rest') this.leave(G, G.cx, G.cy); }
    } else if (G.mode === 'coop') {
      const C = G.coop;
      G.cx = C.x + Math.cos(now * 0.25) * 2.5; G.cy = C.y + Math.sin(now * 0.25) * 2.5;
      if (now > C.till) this.leave(G, C.x, C.y);
    }
    // (a hit or an arrow, a torch held near: off they go)
    for (const w of G.list) if (w.scared > now && G.mode !== 'flee') { this.flee(G, w.scareAt?.[0] ?? w.x, w.scareAt?.[1] ?? w.y); return; }
    if ((G.senseT += dt) < 0.25) return;
    const sdt = G.senseT; G.senseT = 0;
    if (G.mode === 'leave' || G.mode === 'flee') {
      // (held up by water or a slope on its way: another way out)
      const L0 = G.list[0];
      if (Math.hypot(dxOf(L0.x, G.lx ?? L0.x + 9), L0.y - (G.ly ?? L0.y)) < 0.4) { if ((G.stuck = (G.stuck || 0) + sdt) > 2) { G.stuck = 0; this.leave(G, wrapX(L0.x + (Math.random() - 0.5) * 40), L0.y + (Math.random() - 0.5) * 40, G.mode); } } else G.stuck = 0;
      G.lx = L0.x; G.ly = L0.y;
      return;
    }
    const lead = G.list[0], K = SENSES[lead.type], P = g.wildlife.presence;
    let sure = 0, heard = 0, best = 0, by = null, torch = null;
    ENV.light = lightAt(h, K.night); ENV.diff = DIFF_K[g.difficulty] ?? 1;
    const V = g.wind; ENV.wx = V?.x ?? 1; ENV.wy = V?.y ?? 0;
    for (const w of G.list) {
      const f = w.dir, fl = f ? Math.hypot(f[0], f[1]) || 1 : 1;
      ANIMAL.fx = f ? f[0] / fl : 0; ANIMAL.fy = f ? f[1] / fl : 1; ANIMAL.bedded = !!w.bedded;
      for (const r of P.list) {
        const dx = dxOf(r.x, w.x), dy = r.y - w.y, d = Math.hypot(dx, dy);
        if (d > FAR) continue;
        ENV.sky = r.sky; ENV.ws = r.ws;
        perceive(K, ANIMAL, r, ENV, dx, dy, d, SEEN);
        const rate = SEEN.see + SEEN.smell + (SEEN.loud ? SEEN.hear : 0);
        sure += rate; if (!SEEN.loud) heard += SEEN.hear;
        if (rate + SEEN.hear > best) { best = rate + SEEN.hear; by = r; }
        if (d < PRED.NIP.R && this.torchOf(r)) torch = r;
      }
    }
    // (a loud thing close by, an arrow landing or a tool: they are off at once)
    for (const v of P.events) if (now - v.t >= 0 && now - v.t < 1 && v.n >= 0.8 && distOf(v.x, v.y, lead.x, lead.y) < PRED.LOUD) { this.flee(G, v.x, v.y); return; }
    G.quiet = best > 0 ? 0 : G.quiet + sdt;
    G.aw = advance(G.aw, sure / G.list.length, heard / G.list.length, G.quiet, sdt);
    if (torch) { this.flee(G, torch.x, torch.y); return; }
    // (hard, winter, night: a pack after somebody with meat or blood on them)
    if (!fox && !G.nip && T.nipDay !== Math.floor(ms / DAY) && mayNip(g.difficulty, dayOfYear(ms, T.den[1]), h)) {
      const q = walkers.find(q => q.gm === 'survival' && this.meatOn(q) && G.list.some(w => distOf(w.x, w.y, q.x, q.y) < PRED.NIP.R));
      if (q) {
        if (G.mode !== 'follow') { G.mode = 'follow'; G.bold = G.list[G.list.length - 1]; G.followTill = now + PRED.NIP.FOR; }
        G.q = q; G.from = q;
        const a = Math.atan2(G.list[0].y - q.y, dxOf(G.list[0].x, q.x));
        G.cx = wrapX(q.x + Math.cos(a) * PRED.NIP.FOLLOW); G.cy = q.y + Math.sin(a) * PRED.NIP.FOLLOW;
        if (now > G.followTill) this.leave(G, q.x, q.y);
        return;
      }
    }
    if (G.mode === 'follow') { this.leave(G, G.q?.x ?? G.cx, G.q?.y ?? G.cy); return; }
    if (G.mode === 'watch') {
      if (G.from) G.stareTo = G.from;
      if (now > G.watchT) this.leave(G, G.from?.x ?? G.cx, G.from?.y ?? G.cy);
      return;
    }
    if (G.aw >= (fox ? PRED.FOX_AWAY : PRED.AWAY) && by) {
      if (fox) { this.flee(G, by.x, by.y); return; }
      // (wolves: off to WATCH m from whoever it is, a look back, then away)
      const a = Math.atan2(G.list[0].y - by.y, dxOf(G.list[0].x, by.x));
      G.mode = 'watch'; G.from = { x: by.x, y: by.y }; G.watchT = now + within(PRED.LEAVE) + 6;
      G.cx = wrapX(by.x + Math.cos(a) * PRED.WATCH); G.cy = by.y + Math.sin(a) * PRED.WATCH;
    }
  }
  // Away from (x, y), trotting (leave) or running (flee), out of everybody's way
  leave(G, x, y, mode = 'leave') {
    const L = G.list[0];
    if (!L) return;
    const a = Math.atan2(L.y - y, dxOf(L.x, x)) + (Math.random() - 0.5) * 0.5;
    if (G.mode !== mode) G.leaveT = this.game.time;
    G.mode = mode; G.cx = wrapX(L.x + Math.cos(a) * PRED.GONE); G.cy = L.y + Math.sin(a) * PRED.GONE;
    for (const w of G.list) { w.staring = false; w.alert = A_CALM; w.bedded = false; }
  }
  flee(G, x, y) { this.leave(G, x, y, 'flee'); }
  torchOf(r) { return (r.me ? this.game.inv?.held?.id : r.e?.held) === 'antorcha'; }
  // Somebody carrying a carcass (arms, or behind the saddle), or bloody
  meatOn(q) {
    const g = this.game, e = q.e || q, held = q.me ? g.carry?.held : e.carrying, s = q.me ? g.body?.surface?.() : e.grime;
    return (!!held && String(held).startsWith('carcass')) || (s?.blood || 0) > PRED.NIP.BLOOD;
  }

  // ---------- a fox at a coop (whoever runs the world) ----------
  // At night, a coop or a hutch with its door open, with animals and no dog: once a night, by the seed, a fox comes to it
  // when somebody is near enough to see it
  coopTick(H) {
    const g = this.game, R = g.ranch, W = g.wildlife;
    if (!R?.placed || g.difficulty === 'peaceful') return;
    const walkers = g.mobs.players().filter(q => q.gm !== 'spectator');
    if (!walkers.length) return;
    for (const kind of ['gallinero', 'conejera']) for (const h of R.placed(kind)) {
      const [tx, ty] = h.tile, x = tx + 0.5, y = ty + 0.5, hr = g.days.hourAt(x), night = this.nightOf(this.ms(), hr), key = `${tx},${ty}`;
      if (!nightIn(PRED.COOP.NIGHT, hr) || this.coops.get(key) === night || !this.coopOpen(h)) continue;
      if (!walkers.some(q => distOf(q.x, q.y, x, y) < PRED.COOP.R)) continue;
      if (ihash(tx * 3 + night, ty * 5, 4411) >= PRED.COOP.CHANCE) { this.coops.set(key, night); continue; }
      const a = ihash(tx, ty + night, 4412) * TAU, fx = wrapX(x + Math.cos(a) * PRED.COOP.AWAY), fy = y + Math.sin(a) * PRED.COOP.AWAY;
      if (!this.ready(fx, fy)) { W.warm(fx, fy); continue; }   // (its ground first: it comes a second later)
      this.coops.set(key, night);
      if (W.offLimits({ x: fx, y: fy }, W.kindOf('zorro'))) continue;
      const T = { id: `c${tx}.${ty}`, kind: 'fox', cx: tx, cy: ty, den: [fx, fy], n: 1, s: 0.5 };
      this.make(T, fx, fy, walkers, 'coop', { coop: { x, y, till: g.time + within(PRED.COOP.FOR) } });
    }
  }
  coopOpen(h) {
    const R = this.game.ranch;
    if (R.animals.some(a => a.type === 'perro' && !a.stray)) return false;
    if (h.d.door?.[h.k] === 0) return false;
    return R.animals.some(a => a.home && a.home[0] === h.tile[0] && a.home[1] === h.tile[1]);
  }
  // (the night a moment belongs to: from noon to noon, by its morning's day)
  nightOf(ms, h) { return Math.floor((ms - ((h - 12 + 24) % 24) * HOUR) / DAY) + 1; }
  // (ranch.js nightVisits, on the morning) Did a fox come to this coop last night? Really (somebody saw it come), or, with
  // nobody about, by the seed (PRED.COOP.ALONE). Its prints at the door either way
  foxCame(tile, day) {
    const g = this.game, [tx, ty] = tile, key = `${tx},${ty}`, night = this.nightOf(this.ms(), g.days.hourAt(tx + 0.5));
    const came = this.coops.get(key) === night ? ihash(tx * 3 + night, ty * 5, 4411) < PRED.COOP.CHANCE : ihash(tx * 7 + (day | 0), ty * 11, 4413) < PRED.COOP.ALONE;
    if (came) this.lay(`fox:${key}:${night}`, tx + 0.5, ty + 0.5, 'zorro', 10, 4, PRED.PRINT_AGE);
    return came;
  }

  // ---------- the night's scavengers (whoever runs the world) ----------
  scavenge(H) {
    const g = this.game, w = g.world, now = this.ms();
    if (!w?.deltas) return;
    for (const [key, d] of w.deltas) {
      if (!d || key.startsWith('u:') || !(d.gut || d.carcass || d.wolf)) continue;
      const [cx, cy] = key.split(',').map(Number);
      let touched = false;
      for (const [k, at] of Object.entries(d.wolf || {})) if (!(now - at < PRED.NOTE_DAYS * DAY)) { delete d.wolf[k]; touched = true; }
      if (d.wolf && !Object.keys(d.wolf).length) delete d.wolf;
      const tiles = [...Object.keys(d.gut || {}), ...Object.keys(d.carcass || {})];
      for (const k of tiles) {
        const i = k.indexOf(','), tx = +k.slice(0, i), ty = +k.slice(i + 1), x = tx + 0.5, y = ty + 0.5;
        if (!this.packAt(H, x, y) || this.safe(tx, ty)) continue;
        const h = g.days.hourAt(x);
        if (d.gut && k in d.gut) {
          if (nightPassed(d.gut[k], now, h)) { delete d.gut[k]; (d.wolf ||= {})[k] = Math.round(now); touched = true; }
          continue;
        }
        const q = cleanCq(d.cq?.[k]);
        if (!q || q[1] || d.wolf?.[k] || !nightPassed(q[4], now, h)) continue;   // (gutted, already visited, or not yet)
        q[0] = Math.max(0, q[0] - PRED.SCAV_Q);
        d.cq[k] = q; (d.wolf ||= {})[k] = Math.round(now); touched = true;
      }
      if (d.gut && !Object.keys(d.gut).length) delete d.gut;
      if (touched) w.note(cx, cy);
    }
  }
  // A tile wolves leave alone: in the village, under a roof, or by a placed table or bench
  safe(tx, ty) {
    const w = this.game.world;
    if (inBounds(tx + 0.5, ty + 0.5) || w.roofAt(tx, ty)) return true;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const id = String(w.ownAt?.('placed', tx + i, ty + j) ?? w.at('placed', tx + i, ty + j) ?? '').split('@')[0]; if (PRED.SAFE.has(id)) return true; }
    return false;
  }

  // ---------- what every game hears and sees ----------
  // Once a second: the howls of the packs round you
  listen(H) {
    const g = this.game, p = g.player;
    if (Profile.server || !p || g.scene !== g.world) return;
    const ms = this.ms();
    this.around(H, 'wolf', p.x, p.y, 3, T => {
      const k = howlPhase(T.id, ms, g.days.hourAt(T.den[0]));
      if (k < 0) { this.howled.delete(T.id); return; }
      if (this.howled.has(T.id)) return;
      this.howled.set(T.id, ms);
      const G = this.real.get(T.id), at = G?.list[0] || WHERE;
      if (!G) whereOf(T, g.days.hourAt(T.den[0]), ms, WHERE);
      const d = distOf(p.x, p.y, at.x, at.y);
      if (d < PRED.HOWL.R) { Audio.howl?.(g.wildlife.panOf(p, at.x, at.y), 1 - d / PRED.HOWL.R, T.n); this.heard = { x: at.x, y: at.y, t: g.time }; }
    });
  }
  // (every frame, the few wolves in the list) A howling wolf sits with its head up: every game, by its pack's id
  howlPoses() {
    const g = this.game, L = g.wildlife?.list;
    if (!L) return;
    const ms = this.ms();
    for (const w of L) {
      if (w.type !== 'lobo') continue;
      const id = typeof w.id === 'string' ? w.id.slice(0, w.id.lastIndexOf('.')) : '';
      const k = id && id[0] === 'p' && !(Math.hypot(w.vx || 0, w.vy || 0) > 0.3) ? howlPhase(id, ms, g.days.hourAt(w.x)) : -1;
      w.howl = k >= 0 && (w.id.charCodeAt(w.id.length - 1) % 3 !== 2 || k > 0.3) ? k : -1;   // (not all at once)
    }
  }
  // Once a second: the kill sites round you, today's and yesterday's (bones), and their prints
  findKills(H) {
    const g = this.game, p = g.player, out = [];
    if (p && g.scene === g.world && !Profile.server) {
      const ms = this.ms();
      this.around(H, 'wolf', p.x, p.y, 1, T => {
        const today = killDay(ms, g.days.hourAt(T.den[0]));
        for (const day of [today, today - 1]) {
          const K = killOf(H, T, day);
          if (!K || distOf(K.x, K.y, p.x, p.y) > PRED.KILL.SEE || !this.loaded(K.x, K.y) || g.wildlife.built(K.x, K.y, 0.6) || g.world.blocked?.(K.x, K.y)) continue;   // (only where the ground is made: nothing is made for it)
          out.push({ ...K, bones: day < today, taken: this.taken.includes(K.key) });
        }
      });
      for (const K of out) {
        const d = distOf(K.x, K.y, p.x, p.y);   // (prints only near: tracks.js keeps marks for minutes)
        if (d < 40) this.lay('kill:' + K.key, K.x, K.y, 'lobo', 16, 5, PRED.PRINT_AGE * (K.bones ? 1.5 : 1));
        if (d < PRED.KILL.FOUND && !K.bones && !this.printed.has('found:' + K.key)) { this.printed.add('found:' + K.key); g.gather?.float(t('pred.kill.found'), '#e8d6a8'); g.nature?.saw?.('lobo', 20, true); }
      }
      this.notes(p);
    }
    const sig = out.map(K => K.key + (K.bones ? 'b' : '') + (K.taken ? 't' : '')).join();
    if (sig !== this.killSig) { this.killSig = sig; this.kills = out; this.killsV++; }
  }
  // The prints of the wolves that came at night to a gut pile or a carcass (d.wolf) near you
  notes(p) {
    const g = this.game, W = g.world, cx = Math.floor(p.x / CHUNK), cy = Math.floor(p.y / CHUNK), now = this.ms();
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const d = W.deltas.get(`${wrapIndex(cx + i, CHUNK)},${cy + j}`);
      if (d?.wolf) for (const [k, at] of Object.entries(d.wolf)) { const c = k.indexOf(','); this.lay(`note:${k}:${at}`, +k.slice(0, c) + 0.5, +k.slice(c + 1) + 0.5, 'lobo', 12, 3.5, PRED.PRINT_AGE); }
    }
  }
  // Prints of wolves (or a fox) round a point, laid again when the last ones have faded (src: the key; n prints, r m round
  // it, age s: they look old, and a mark lasts minutes, tracks.js TTL)
  lay(src, x, y, type, n, r, age) {
    const T = this.game.tracks, now = this.game.time, at = this.laid.get(src);
    if (!T || (at !== undefined && now - at >= 0 && now - at < PRED.RELAY)) return;
    this.laid.set(src, now);
    if (this.laid.size > 300) this.laid.clear();
    let s = 0; for (let i = 0; i < src.length; i++) s = (s * 31 + src.charCodeAt(i)) % 9973;
    for (let i = 0; i < n; i++) {
      const a = ihash(i, s, 51) * TAU, d = 0.8 + ihash(i, s, 52) * r, px = x + Math.cos(a) * d, py = y + Math.sin(a) * d, yaw = a + Math.PI / 2 + (ihash(i, s, 53) - 0.5);
      T.print(src, 'dog', px, py, yaw, { type, scale: type === 'lobo' ? 1.45 : 0.8, left: i % 2 === 0, age: Math.min(age, 20 * 3600) });
    }
  }
  // Your dogs out with you: a growl at a wolf upwind of them (the wind brings its smell)
  dogs() {
    const g = this.game, p = g.player, V = g.wind, L = g.wildlife?.list;
    if (!p || !V || !L?.length || Profile.server || g.scene !== g.world) return;
    for (const a of g.ranch?.animals || []) {
      if (a.type !== 'perro' || a.inside || a.sleep || distOf(a.x, a.y, p.x, p.y) > 30) continue;
      let wolf = null;
      for (const w of L) {
        if (w.type !== 'lobo') continue;
        const dx = dxOf(a.x, w.x), dy = a.y - w.y, d = Math.hypot(dx, dy);
        if (d < PRED.GROWL && (d < 12 || downwind(V.x, V.y, dx, dy, d))) { wolf = w; break; }
      }
      if (!wolf) continue;
      a.growlAt = g.time;
      a.faceTo?.(dxOf(wolf.x, a.x), wolf.y - a.y);
      if (!(g.time - (a.growled ?? -99) < PRED.GROWL_EVERY)) { a.growled = g.time; Audio.growl?.(1); }
    }
  }

  // ---------- the kill: E on it ----------
  aimables(p, sc, box) {
    const g = this.game;
    if (!this.kills.length || !p || sc !== g.world || g.gamemode === 'spectator') return null;
    const out = [];
    for (const K of this.kills) {
      if (K.bones || K.taken || distOf(K.x, K.y, p.x, p.y) > PRED.KILL.REACH + 3) continue;
      out.push({ kind: 'sys', kill: K.key, box: box(K.x, K.y, 0.7, 0.5, K.yaw, 0.45), act: () => (distOf(K.x, K.y, p.x, p.y) <= PRED.KILL.REACH ? { text: t('pred.kill.take'), run: () => this.take(K) } : null) });
    }
    return out.length ? out : null;
  }
  take(K) {
    const g = this.game;
    if (this.taken.includes(K.key)) return;
    const left = g.inv.add('carne_venado', PRED.KILL.MEAT);
    if (left) { Audio.error?.(); g.gather.float(t('hunt.bag_full'), '#ffb0a0'); return; }
    this.taken.push(K.key);
    if (this.taken.length > 40) this.taken.shift();
    K.taken = true; this.killSig = ''; this.killsV++;
    g.gather.float(t('pred.kill.took'), '#fff3c0');
    g.nature?.saw?.('lobo', 10, true);
    Audio.pickup?.();
    g.onSave?.();
  }
}
