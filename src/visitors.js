// The birds and the rabbits one sees coming to the garden (phase R2-F, docs/planes/realismo/PLAN-R2-huerto.md §3.7). They are
// what may come at night, shown: what they eat is decided in the morning, in the game that runs the world (pests.js), and only
// where they could (ripe wheat, maize or strawberries without a scarecrow by day; seedlings and roots a rabbit can reach at
// dusk and at dawn, in through the gap of a fence if there is one). Each game sees its own, near its player only; nothing is
// sent nor saved but one thing: scared off by somebody who walks up to them, fewer come the next morning (d.shoo, a mark in the
// chunk). The rabbits are drawn as the others (actors.js, entities), the birds in three/visitors3d.js.
import { CROPS } from './items.js';
import { CHUNK } from './world/gen.js';
import { distOf, dxOf, wrapX } from './world/planet.js';
import { Profile } from './accounts.js';
import { Audio } from './audio.js';
import { t } from './i18n.js';
import { Enclosure, birdsLike, rabbitsLike } from './pests.js';

// Looked for every SCAN s within NEAR tiles of the player; gone beyond FAR. Their hours (of the place); how many at most (less
// with wild animals about: they count together, ROOM); s between two visits; how near one scares them, up and crouched
const SCAN = 3, NEAR = 22, FAR = 34, ROOM = 14;
const BIRDS = { hours: [7, 19.5], max: 6, least: 2, every: [22, 45], stay: [35, 80], fear: 4.6, creep: 2.2, fly: 1.9 };
const RABBITS = { hours: [[4.5, 7.5], [19, 23.5]], max: 2, least: 1, every: [30, 70], eat: [18, 40], fear: 6, creep: 2.8, far: 16, from: 11, hop: 1.5, run: 5.2 };
const DOG = 6;   // (an awake dog this near scares them too)
const within = ([a, b]) => a + Math.random() * (b - a);
// What bird comes for what: sparrows for the wheat, crows for the maize, blackbirds for the strawberries (three/visitors3d.js)
export const BIRD_OF = { trigo: 'sparrow', maiz: 'crow', fresa: 'blackbird' };

export class Visitors {
  constructor(game) { this.game = game; this.birds = []; this.rabbits = []; this.scanT = 0; this.birdT = 8; this.rabbitT = 8; this.n = 0; this.active = false; this.wheat = []; this.greens = []; }
  get farm() { return this.game.farm; }
  get world() { return this.game.world; }
  reset() { this.birds.length = this.rabbits.length = this.wheat.length = this.greens.length = 0; this.birdT = 8; this.rabbitT = 8; this.scanT = 0; this.active = false; }
  entities(scene) { return scene === this.world && this.rabbits.length ? this.rabbits : null; }
  // Could anything come tomorrow? (pests.js on)
  on() { const f = this.farm; return !Profile.server && !!f && f.pests.on(f.today + 1); }

  update(dt) {
    const g = this.game, p = g.player;
    if (!p || Profile.server) return;
    if ((this.scanT -= dt) <= 0) { this.scanT = SCAN; this.active = this.on(); if (this.active && g.scene === this.world) this.scan(p); }
    if (!this.active || g.scene !== this.world) { if (this.birds.length || this.rabbits.length) { this.birds.length = this.rabbits.length = 0; } return; }
    const h = g.days.localHour;
    if ((this.birdT -= dt) <= 0) { this.birdT = within(BIRDS.every); if (h >= BIRDS.hours[0] && h < BIRDS.hours[1] && !g.days.info.rain && !g.days.info.snow) this.flock(); }
    if ((this.rabbitT -= dt) <= 0) { this.rabbitT = within(RABBITS.every); if (RABBITS.hours.some(([a, b]) => h >= a && h < b)) this.rabbit(); }
    if (!this.birds.length && !this.rabbits.length) return;
    const who = this.walkers();
    for (let i = this.birds.length - 1; i >= 0; i--) if (!this.bird(this.birds[i], dt, p, who)) this.birds.splice(i, 1);
    for (let i = this.rabbits.length - 1; i >= 0; i--) if (!this.hop(this.rabbits[i], dt, p, who)) this.rabbits.splice(i, 1);
  }
  // Who may scare them: everybody on foot or riding round here (not a spectator), and the dogs that are awake
  walkers() {
    const out = [];
    for (const q of this.game.mobs.players()) if (q.gm !== 'spectator') out.push(q);
    for (const a of this.game.ranch.animals) if (a.type === 'perro' && !a.inside && !a.sleep) out.push({ x: a.x, y: a.y, dog: true });
    return out;
  }
  // The crops near that they would come for
  scan(p) {
    const cx0 = Math.floor(p.x / CHUNK), cy0 = Math.floor(p.y / CHUNK), P = this.farm.pests, today = this.farm.today, R = Math.ceil(NEAR / CHUNK);
    this.wheat.length = this.greens.length = 0;
    for (let cy = cy0 - R; cy <= cy0 + R; cy++) for (let cx = cx0 - R; cx <= cx0 + R; cx++) {
      const d = this.world.delta(cx, cy);
      if (!d?.crops) continue;
      for (const k in d.crops) {
        const c = d.crops[k];
        if (!c || !CROPS[c.id] || d.cover?.[k]) continue;
        const b = birdsLike(c) && d.shoo?.b !== today, r = rabbitsLike(c) && d.shoo?.r !== today;
        if (!b && !r) continue;
        const i = k.indexOf(','), tx = +k.slice(0, i), ty = +k.slice(i + 1);
        if (distOf(tx + 0.5, ty + 0.5, p.x, p.y) > NEAR) continue;
        if (b && !P.roofed(tx, ty)) this.wheat.push([tx, ty, c.id]);
        if (r) this.greens.push([tx, ty]);
      }
    }
  }
  // Room for more, with the wild animals about (a herd near leaves room for least)
  room(K, n) {
    const p = this.game.player;
    let near = 0;
    for (const w of this.game.wildlife.list) if (distOf(w.x, w.y, p.x, p.y) < 75) near++;
    return Math.max(0, Math.min(K.max, Math.max(K.least, ROOM - near)) - n);
  }

  // ---------- the birds ----------
  // A few of them come down to the same crop, from the same side. n: how many (the tests)
  flock(n = 0) {
    if (!this.wheat.length) return 0;
    const at = this.wheat[Math.floor(Math.random() * this.wheat.length)], room = this.room(BIRDS, this.birds.length);
    if (!room || Math.random() >= this.farm.pests.scare(at[0], at[1])) return 0;   // (the scarecrow)
    const p = this.game.player, kind = BIRD_OF[at[2]] || 'sparrow', same = this.wheat.filter(s => s[2] === at[2] && Math.abs(dxOf(s[0], at[0])) < 5 && Math.abs(s[1] - at[1]) < 5);
    if (this.walkers().some(q => distOf(q.x, q.y, at[0] + 0.5, at[1] + 0.5) < BIRDS.fear + 1)) return 0;
    n = Math.min(room, n || Math.min(kind === 'crow' ? 3 : 5, 1 + Math.floor(Math.random() * Math.min(5, same.length))));
    const a = Math.atan2(at[1] - p.y, dxOf(at[0], p.x)) + (Math.random() - 0.5) * 1.6, till = this.game.time + within(BIRDS.stay);
    for (let i = 0; i < n; i++) {
      const s = same[Math.floor(Math.random() * same.length)], [x, y] = this.perch(s);
      this.birds.push({ id: ++this.n, kind, st: 'in', t: -i * 0.25 - Math.random() * 0.3, x, y, z: 0, fx: wrapX(x + Math.cos(a) * 16 + Math.random() * 3), fy: y + Math.sin(a) * 16 + Math.random() * 3, tx: x, ty: y, spots: same, yaw: 0, peck: Math.random() * 3, till: till + Math.random() * 12, next: 0, wing: Math.random() * 6 });
    }
    return n;
  }
  perch([tx, ty]) { const a = Math.random() * Math.PI * 2; return [tx + 0.5 + Math.cos(a) * 0.38, ty + 0.5 + Math.sin(a) * 0.38]; }
  bird(b, dt, p, who) {
    b.t += dt; b.wing += dt * 26;
    const g = this.game;
    if (b.st === 'in') {   // (a glide down, slower at the end)
      const k = Math.max(0, Math.min(1, b.t / BIRDS.fly)), e = 1 - (1 - k) * (1 - k), dx = dxOf(b.tx, b.fx), dy = b.ty - b.fy;
      b.x = wrapX(b.fx + dx * e); b.y = b.fy + dy * e; b.z = 7 * (1 - e) * (1 - 0.3 * e); b.yaw = Math.atan2(dx, dy);
      if (k >= 1) { b.st = 'down'; b.z = 0; b.next = g.time + 1 + Math.random() * 3; }
    } else if (b.st === 'hop') {
      const k = Math.min(1, b.t / 0.35);
      b.x = wrapX(b.fx + dxOf(b.tx, b.fx) * k); b.y = b.fy + (b.ty - b.fy) * k; b.z = Math.sin(k * Math.PI) * 0.22;
      if (k >= 1) { b.st = 'down'; b.z = 0; b.next = g.time + 1.5 + Math.random() * 4; }
    } else if (b.st === 'out') {
      const k = b.t / 2.4;
      if (k > 0) { b.x = wrapX(b.x + b.vx * dt * (0.6 + k)); b.y += b.vy * dt * (0.6 + k); b.z += dt * (3.4 + k * 2); }
      return k < 1.6 && distOf(b.x, b.y, p.x, p.y) < FAR;
    } else {
      b.peck += dt;
      if (g.time > b.next) {
        const s = b.spots[Math.floor(Math.random() * b.spots.length)], [x, y] = Math.random() < 0.6 ? [b.x + (Math.random() - 0.5) * 0.5, b.y + (Math.random() - 0.5) * 0.5] : this.perch(s);
        if (distOf(x, y, b.x, b.y) < 2.5) { Object.assign(b, { st: 'hop', t: 0, fx: b.x, fy: b.y, tx: x, ty: y, yaw: Math.atan2(dxOf(x, b.x), y - b.y) }); }
        else b.next = g.time + 1.5;
      }
      if (g.time > b.till) this.flush(b, null);
    }
    if (b.st !== 'out' && b.t > 0) for (const q of who) {
      const d = distOf(q.x, q.y, b.x, b.y);
      if (d >= (q.dog ? DOG : q.crouch ? BIRDS.creep : BIRDS.fear) || (b.st === 'in' && d > 2)) continue;
      for (const o of this.birds) if (o.st !== 'out' && distOf(o.x, o.y, b.x, b.y) < 7) this.flush(o, q, 0.12);
      if (q.me) this.shooed('b', b.tx, b.ty);
      this.flap(b);
      break;
    }
    return distOf(b.x, b.y, p.x, p.y) < FAR;
  }
  // Off it goes, away from whoever scares it (all of them in a moment, not at once)
  flush(b, q, lag = 0) {
    const a = q ? Math.atan2(b.y - q.y, dxOf(b.x, q.x)) + (Math.random() - 0.5) * 0.9 : Math.random() * Math.PI * 2, v = b.kind === 'crow' ? 5 : 6;
    Object.assign(b, { st: 'out', t: -Math.random() * lag * 3, vx: Math.cos(a) * v, vy: Math.sin(a) * v, yaw: Math.atan2(Math.cos(a), Math.sin(a)) });
  }
  flap(b) {
    const p = this.game.player, d = distOf(b.x, b.y, p.x, p.y), v = Math.max(0, 0.16 - d * 0.01);
    if (!v || this.flapAt > this.game.time) return;
    this.flapAt = this.game.time + 0.4;
    for (let i = 0; i < 4; i++) setTimeout(() => Audio.noiseHit(900 + i * 120, 0.06, v * (1 - i * 0.15), 'highpass'), i * 70);
  }
  // They were scared off this chunk by this player: fewer tomorrow
  shooed(which, x, y) {
    const tx = Math.floor(x), ty = Math.floor(y), d = this.farm.d(tx, ty), g = this.game, today = this.farm.today;
    if (!d || d.shoo?.[which] === today) return;
    (d.shoo ||= {})[which] = today;
    this.world.chestTouched(tx, ty);
    this.scanT = 0;
    g.gather.float(t(which === 'b' ? 'farm.scare.birds' : 'farm.scare.rabbits'), '#a8f0a0');
  }

  // ---------- the rabbits ----------
  free(tx, ty) {
    const x = tx + 0.5, y = ty + 0.5, w = this.world;
    return !w.blocked?.(x, y) && !w.collidersNear(x, y).some(c => !c.dig && (c.r !== undefined ? Math.hypot(c.x - x, c.y - y) < c.r + 0.2 : !c.rx && x > c.x0 - 0.15 && x < c.x1 + 0.15 && y > c.y0 - 0.15 && y < c.y1 + 0.15));
  }
  // One comes for a crop it can reach, by a way that starts out of sight
  rabbit() {
    if (!this.greens.length || !this.room(RABBITS, this.rabbits.length)) return null;
    const p = this.game.player, at = this.greens[Math.floor(Math.random() * this.greens.length)], fence = new Enclosure(this.world);
    if (fence.enclosed(at[0], at[1]) || (this.farm.pests.dog(at[0], at[1]) && Math.random() > 0.3)) return null;
    let best = null, bd = RABBITS.from;
    const way = Math.floor(Math.random() * 8);
    for (let i = 0; i < 3; i++) {
      const path = fence.path(at[0], at[1], RABBITS.far, (way + i * 3) % 8, (x, y) => this.free(x, y));
      if (!path) continue;
      const d = distOf(path[0][0] + 0.5, path[0][1] + 0.5, p.x, p.y);
      if (d > bd && d < FAR - 6) { bd = d; best = path; }
    }
    if (!best) return null;
    const [x, y] = best[0], r = { id: `garden${++this.n}`, type: 'conejo', breed: 'marron', x: x + 0.5, y: y + 0.5, dir: [0, 1], vx: 0, vy: 0, path: best, i: 1, st: 'in', grazing: false, wait: 0, till: 0, crop: at, scared: 0 };
    this.rabbits.push(r);
    return r;
  }
  hop(r, dt, p, who) {
    const g = this.game, far = distOf(r.x, r.y, p.x, p.y);
    if (far > FAR) return false;
    for (const q of who) {
      const d = distOf(q.x, q.y, r.x, r.y);
      if (r.st === 'run' || d >= (q.dog ? DOG + 1 : q.crouch ? RABBITS.creep : RABBITS.fear)) continue;
      if (q.me && r.st !== 'in') this.shooed('r', ...r.crop);
      r.st = 'run'; r.grazing = false;
      // (back the way it came)
      r.i = Math.max(0, Math.min(r.i, r.path.length) - 1);
      break;
    }
    if (r.st === 'eat') {
      r.vx = r.vy = 0;
      if (g.time > r.till) { r.st = 'back'; r.grazing = false; r.i = r.path.length - 2; }
      return true;
    }
    if (r.wait > 0 && r.st !== 'run') { r.wait -= dt; r.vx = r.vy = 0; return true; }
    const last = r.path.length - 1, stop = r.st === 'in' ? 0.55 : 0.15, at = r.path[r.i];
    if (!at) return false;
    const dx = dxOf(at[0] + 0.5, r.x), dy = at[1] + 0.5 - r.y, d = Math.hypot(dx, dy);
    if (d < (r.i === last ? stop : 0.15)) {
      if (r.st === 'in') {
        if (r.i === last) { r.st = 'eat'; r.grazing = true; r.till = g.time + within(RABBITS.eat); return true; }
        r.i++;
        if (Math.random() < 0.3) r.wait = 0.3 + Math.random() * 1.4;   // (a few hops, it stops and listens)
      } else if (--r.i < 0) return false;
      return true;
    }
    const v = r.st === 'run' ? RABBITS.run : RABBITS.hop, k = Math.min(1, v * dt / d);
    r.x = wrapX(r.x + dx * k); r.y += dy * k; r.vx = dx / d * v; r.vy = dy / d * v; r.dir = [dx / d, dy / d];
    return true;
  }
}
