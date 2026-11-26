// How each player can be noticed by the wild animals (Plan R3 §3.2): how exposed and how loud they are and how strong
// their scent is, four times a second, from what every game already knows of them (posture, gait, horse, what they hold
// and carry, the dirt and blood on their body: entities.js, live.js RemotePlayer, body.js). Whoever runs the world keeps
// everybody's, for the animals (wildlife.js); a guest only keeps their own, for the ring on the minimap
// (ui/huntoverlay.js). And the loud things that happen somewhere (a tool, an arrow that lands, a door, a bark).
import { B } from './world/biomes.js';
import { inBounds } from './world/village.js';
import { BULKY } from './carry-items.js';
import { ITEMS } from './items.js';
import { dxOf, distOf } from './world/planet.js';
import { weatherAt } from './wind.js';
import { EXPO, NOISE, EVENT, EVENT_S, groundNoise, weatherNoise, weatherSight, woods, scentOf } from './senses.js';

const MOVING = 0.35, JUMP = 15;        // m/s: from this it moves; faster than this it was a jump (a teleport), not a run
const TOOL_HIT = new Set(['hacha', 'pico', 'pala', 'azada', 'guadana', 'hammer']);
const MSG_EVERY = 0.2, MSG_FAR = 70;   // seconds between two loud things a guest tells the host; how far from them it may be
const NO_SURFACE = null;

// Somebody with the bow in hand, or crouched, out of the village: hunting (held: the id of what they hold)
export const stalkingAs = (e, held) => !!e && !e.swim && !e.boat && !e.aboard && !e.pose && (held === 'arco' || (!!e.crouch && !e.mount)) && !inBounds(e.x, e.y);
// A carcass in their arms, or behind their saddle
const carcassOf = id => !!id && !!BULKY[id] && String(id).startsWith('carcass');

class Rec {
  constructor(key) { Object.assign(this, { key, e: null, me: false, x: 0, y: 0, vx: 0, vy: 0, speed: 0, crouch: false, expo: 0, noise: 0, scent: 1, hidden: 1, sky: 1, ws: 0.4, at: -9, sw: undefined, hit: 0, hitAt: -9, seen: 0 }); }
}

export class Presence {
  constructor(game) {
    this.game = game;
    this.list = [];                  // the players now (Rec), the same array always
    this.byKey = new Map();
    this.events = Array.from({ length: 12 }, () => ({ x: 0, y: 0, n: 0, r: Infinity, t: -9 }));
    this.next = 0; this.tick = 0; this.sent = -9;
    this.pulse = -9; this.pulseN = 0;   // your last loud thing (for the ring)
  }
  reset() { this.list.length = 0; this.byKey.clear(); for (const v of this.events) v.t = -9; }
  // players: mobs.players() (with e, the body), without the spectators. Only of the ones that are there: the rest go
  update(players) {
    const now = this.game.time;
    this.tick++;
    this.list.length = 0;
    for (const q of players) {
      const key = q.me ? 'me' : q.conn;
      let r = this.byKey.get(key);
      if (!r) this.byKey.set(key, r = new Rec(key));
      if (r.seen === this.tick) continue;
      r.seen = this.tick; r.me = !!q.me;
      this.measure(r, q, now);
      this.list.push(r);
    }
    if (this.byKey.size > this.list.length) for (const [k, r] of this.byKey) if (r.seen !== this.tick) this.byKey.delete(k);
  }
  measure(r, q, now) {
    const g = this.game, e = q.e || q, dt = now - r.at;
    // (the speed from where they were: the same for you and for the others, whose messages do not say it)
    if (dt > 0.01 && dt < 1.5) {
      r.vx = dxOf(q.x, r.x) / dt; r.vy = (q.y - r.y) / dt; r.speed = Math.hypot(r.vx, r.vy);
      if (r.speed > JUMP) r.vx = r.vy = r.speed = 0;
    } else r.vx = r.vy = r.speed = 0;
    r.x = q.x; r.y = q.y; r.at = now; r.e = e; r.crouch = !!e.crouch;
    const W = g.world, moving = r.speed > MOVING, held = r.me ? g.inv?.held?.id : e.held;
    // (an old game does not say its gait: by the speed)
    const gait = e.gait ?? (r.speed > 5.3 ? 2 : r.speed > 4 ? 1 : 0);
    let expo, noise = 0, hoof = false;
    if (e.pose) expo = EXPO.pose;
    else if (e.boat || e.aboard) { expo = EXPO.row; if (moving) noise = NOISE.row; }
    else if (e.mount) { expo = moving ? EXPO.ride[gait] ?? 0.45 : EXPO.rideStill; if (moving) noise = NOISE.ride[gait] ?? 0.5; hoof = true; }
    else if (e.swim) { expo = EXPO.swim; if (moving) noise = NOISE.swim; }
    else if (e.crouch) { expo = moving ? EXPO.crouch : EXPO.crouchStill; if (moving) noise = NOISE.crouch; }
    else if (!moving) expo = EXPO.still;
    else { expo = gait === 2 ? EXPO.sprint : gait === 1 ? EXPO.jog : EXPO.walk; noise = gait === 2 ? NOISE.sprint : gait === 1 ? NOISE.jog : NOISE.walk; }
    if (e.pushing && moving) noise += NOISE.push;
    if (held === 'arco' && (r.me ? e.drawing : e.bowPull > 0)) expo += EXPO.draw;
    r.expo = Math.min(1, expo);
    const tx = Math.floor(q.x), ty = Math.floor(q.y), biome = W.gen.biomeAt(tx + 0.5, ty + 0.5), sky = weatherAt(g.days, q.y);
    const hard = inBounds(q.x, q.y) || !!W.at('floor', tx, ty) || !!W.gen.roads?.onRoad(tx, ty), wading = !e.boat && !e.aboard && !e.swim && (e.depth || 0) > 0.05;
    noise *= (e.swim || e.boat || e.aboard ? 1 : groundNoise(sky === 'nieve' && !hard ? B.SNOW : biome, W.gen.season, hard, wading)) * weatherNoise(sky);
    // (the others' tool hits, from their swings, already in their messages; yours, from gather.spend: toolHit)
    if (!r.me) { const s = e.swing || 0; if (r.sw !== undefined && s > r.sw && TOOL_HIT.has(ITEMS[e.swingItem || e.held]?.tool)) { r.hit = EVENT.tool; r.hitAt = now; } r.sw = s; }
    const left = 1 - (now - r.hitAt) / EVENT_S;
    if (left > 0) noise += r.hit * left;
    r.noise = noise;
    // (tall grass hides somebody crouched; a wood hides everybody a little, less so a rider)
    r.hidden = (e.crouch && !hoof && W.grassAt?.(tx, ty, g.days.dayIndex) ? 0.5 : 1) * (woods(biome) ? 0.7 : 1);
    r.sky = weatherSight(sky);
    r.ws = g.wind?.sAt(q.y) ?? 0.4;
    // (the body: yours from body.js, another's from their st.bd, unpacked; fresh, the optional fr of their state. In
    // creative nothing sticks to it: body.surface is clean)
    const s = r.me ? g.body?.surface?.() : e.grime || NO_SURFACE, fresh = r.me ? !!g.body?.fresh : !!e.freshBath;
    r.scent = scentOf(s, fresh, carcassOf(r.me ? g.carry?.held : e.carrying));
  }
  // You hit something with a tool (gather.spend): heard from where you are
  toolHit() {
    const r = this.byKey.get('me'), t = this.game.time;
    if (r) { r.hit = EVENT.tool; r.hitAt = t; }
    this.pulse = t; this.pulseN = EVENT.tool;
  }
  // Something loud (n, senses.js EVENT) at (x, y), no further than r. Whoever runs the world hears it there; a guest tells
  // them (an old host ignores it)
  noise(x, y, n, r = Infinity, mine = true) {
    const g = this.game, t = g.time;
    if (mine && g.player && distOf(g.player.x, g.player.y, x, y) < 3) { this.pulse = t; this.pulseN = n; }
    if (g.live?.guest) {
      if (t - this.sent < MSG_EVERY) return;
      this.sent = t;
      g.live.net?.send({ t: 'noise', x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, n, ...(Number.isFinite(r) ? { r } : {}) }, g.live.hostConn);
      return;
    }
    const v = this.events[this.next]; this.next = (this.next + 1) % this.events.length;
    v.x = x; v.y = y; v.n = n; v.r = r; v.t = t;
    this.onLoud?.(x, y, n, r);   // (an arrow by a herd: its cell on edge, wildlife.js loud)
  }
  // (host) Another player's: near them, and no louder than a bark
  heard(peer, m) {
    if (this.game.live?.guest || ![m.x, m.y, m.n].every(Number.isFinite) || !peer?.entity || peer.sc !== 'world') return;
    if (distOf(peer.entity.x, peer.entity.y, m.x, m.y) > MSG_FAR) return;
    this.noise(m.x, m.y, Math.max(0, Math.min(EVENT.bark, m.n)), Number.isFinite(m.r) ? Math.max(0, m.r) : Infinity, false);
  }
}
