// The horse from the ground: led by the reins and tied to a post, a fence or a tree (Plan R4-4,
// docs/planes/realismo/PLAN-R4-caballo.md §1.6 and §3.7). What travels is only two fields of the horse (KEEP, ranch.js):
//   lead   the id of the player who has its reins. Never survives a reload (ranch.reset)
//   tie    [x, y] of the knot. A tied horse stays there, also in the save
// A led horse is moved by every game on its own, behind the leader it sees (Trail: where they walked); the leader's game writes
// where it was left (at), as getting off does. A tied one is moved by whoever runs the world (tied(), from ranch.moveHorse). The
// host's guard (saddlebags.js horseGuard) says who may write them: the owner or the couple, and nobody while another leads or rides
//
//   game.horselead = game.addSystem(new HorseLead(game)), after horsecare.
//   lead.mine (the Animal this player leads, or null), lead.leads (how many times: the tip), player.leads (its id: the
//     network, st.lh, and the art)
//   lead.take(a), lead.letGo(why?), lead.canLead(a)     the reins; heldBy(a): who has them now, in this world, or null
//   lead.tie(a, knot?), lead.untie(a), lead.knotNear(x, y, r, gates?), lead.knotAt(x, y)   knot: { kind, x, y, h, r, yaw }
//   lead.freed(a)           mounted, or put in its stable: neither led nor tied (nothing is said)
//   lead.follows(a)         this game moves it now, behind its leader (live.js: the host's positions are not for it)
//   lead.tied(a, dt, day)   whoever runs the world: its step while tied
//   lead.postAction(o)      E on a hitching post; aimables(): fences and trees while leading; action(): E with nothing aimed
//   lead.knotOf(a)          the knot of a tied horse, looked for again now and then (the art), or null
import { Profile } from './accounts.js';
import { apagada } from './opciones.js';
import { t } from './i18n.js';
import { Audio } from './audio.js';
import { collide } from './physics.js';
import { CHUNK } from './world/gen.js';
import { sideOf } from './world/fit.js';
import { distOf, nearX, wrapX } from './world/planet.js';
import { CLIFF, STEEP_WALK, VERY } from './horseride.js';
import { sizeOf, statsOf } from './horsebreeds.js';
import { inYard } from './world/village.js';

// ---------- the numbers ----------
// BACK: how far behind it comes (m, along the leader's way); SLIP: farther than this the reins slip out of the hand (leading
// never pulls the player); JUMP: a leap of the leader (home, /tp) leaves it; CLIMB: the leader this high above it, too
export const LEAD = { BACK: 1.9, SLIP: 5, JUMP: 4, CLIMB: 2.2, NEAR: 1.25, MAX: 7, ACCEL: 5, BRAKE: 14, TURN: 3.6, R: 0.3, STEP: 0.25, REACH: 0.9, DEEP: 1.25 };
export const TRAIL_MAX = 64;         // points kept, one every STEP: 16 m
// AIM: how near the post, the fence or the tree must be to aim at it, MENU: to the horse, from its menu; ROPE: from the bridle
// to the knot at most; BIT: from the middle of an Español to its bit; STAND: from the bit to the knot, standing
export const TIE = { AIM: 2.5, MENU: 3, ROPE: 0.9, BIT: 1.0, STAND: 0.5, CHECK: 2, FAR: 60, SHIFT: [14, 34], SLOW: 0.35, WALK: 1.3, WALK_OFF: 0.7 };
const YOUNG = 0.55, EAT = [6, 10], REST = [40, 80], SAID = 2.5, SLOPE_T = 0.1, SLOPE_M = 0.8, STUCK = 0.25, HELD = 0.6, PROMPT = 4, FREE_T = 0.5, NO_LH = 5;
const POST_RAIL = 0.94, POST_X = 0.55, KNOT_GAP = 0.45, BODY = 0.95;
const TREES = new Set(['oak', 'fruit', 'pear', 'cherry', 'pine', 'snowPine', 'swampTree', 'palm']);
const me = () => Profile.id || 'yo';
const r2 = v => Math.round(v * 100) / 100;
const within = ([a, b]) => a + Math.random() * (b - a);
const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
const Q = { x: 0, y: 0 }, Q2 = { x: 0, y: 0 };
// What stops a horse on the ground: not the digging (its slope does), nor what is over its head
const stops = c => !c.dig && !c.pond && !(c.zmin > 1.6) && !(c.zmax < 0.3);

// What is solid within LIST_R of (x, y), into out (asked a few times a second: the world's list is of nine chunks)
const LIST_T = 0.2, LIST_R = 8;
function around(w, x, y, out) {
  out.length = 0;
  for (const c of w.collidersNear(x, y)) {
    if (!stops(c)) continue;
    const o = c.obb || c, box = o.x0 !== undefined && !c.obb, dx = box ? Math.max(o.x0 - x, 0, x - o.x1) : Math.abs(o.x - x) - (c.obb ? o.hx + o.hy : o.rx || o.r || 0), dy = box ? Math.max(o.y0 - y, 0, y - o.y1) : Math.abs(o.y - y) - (c.obb ? o.hx + o.hy : o.ry || o.r || 0);
    if (dx < LIST_R && dy < LIST_R) out.push(c);
  }
}
// ---------- the leader's way ----------
// The last points where the leader walked, the oldest (the next for the horse) first. A ring: nothing is allocated
export class Trail {
  constructor() { this.b = new Float32Array(TRAIL_MAX * 2); this.o = 0; this.n = 0; }
  clear() { this.n = 0; }
  x(i) { return this.b[((this.o + i) % TRAIL_MAX) * 2]; }
  y(i) { return this.b[((this.o + i) % TRAIL_MAX) * 2 + 1]; }
  push(x, y) {
    if (this.n === TRAIL_MAX) this.shift();
    const k = ((this.o + this.n++) % TRAIL_MAX) * 2;
    this.b[k] = x; this.b[k + 1] = y;
  }
  shift() { if (this.n) { this.o = (this.o + 1) % TRAIL_MAX; this.n--; } }
  // How far the leader (px, py) is from (x, y), along it
  length(x, y, px, py) {
    let s = 0;
    for (let i = 0; i < this.n; i++) { const a = this.x(i), b = this.y(i); s += Math.hypot(a - x, b - y); x = a; y = b; }
    return s + Math.hypot(px - x, py - y);
  }
}
// A led horse as this game moves it: x, y where it is (in the leader's side of the seam), px, py the leader's last place, v its
// speed, yaw, held: what stops it ('door', 'deep', 'up', 'down', 'way') or null
const makeLed = (a, x, y) => ({ a, trail: new Trail(), x, y, px: NaN, py: NaN, lvx: 0, lvy: 0, v: 0, yaw: Math.atan2(a.worldDir()[0], a.worldDir()[1]), held: null, heldT: 0, stuck: 0, slopeT: 0, list: [], listT: 0, cap: LEAD.MAX, cutT: 0, saidAt: -Infinity, turning: false });

// Would it go into (x, y)? A house door, or a gap one tile wide between two walls, no (a gate in a fence, yes)
export function refusesTile(w, x, y) {
  const tx = Math.floor(x), ty = Math.floor(y), p = w.pieceAt?.(tx, ty);
  if (p?.kind === 'door') return true;
  if (p || !w.pieceAt) return false;
  const wall = (ax, ay) => { const k = w.pieceAt(ax, ay)?.kind; return k === 'wall' || k === 'door'; };
  return (wall(tx - 1, ty) && wall(tx + 1, ty)) || (wall(tx, ty - 1) && wall(tx, ty + 1));
}

export class HorseLead {
  constructor(game) {
    this.game = game;
    this.off = apagada('riendas');   // (?riendas=0: nobody leads nor ties, what was tied is loose, no bridle is drawn)
    this.trails = new Map();         // horse id → its Led
    this.leads = 0;                  // (every time this player takes some reins: smarthud.js shows the tip on the first one)
    this.reset();
  }
  reset() {
    this.mine = null; this.trails.clear();
    this.freeT = 0; this.takenAt = -Infinity; this.stillT = 0; this.cache = null; this.knots = null; this.knotT = -Infinity;
    if (this.game.player) this.game.player.leads = null;
  }
  left() { this.reset(); }
  get world() { return this.game.world; }
  ours(a) { return !!this.game.horse?.ours(a); }
  nameOf(id) { return (id && this.game.live?.nameOf?.(id)) || t('horse.someone'); }
  say(key, v, color = '#fff3c0') { this.game.gather?.float(t(key, v), color); }
  // Who has its reins now, and is in this world (or null)
  heldBy(a) { return !this.off && a?.lead && (a.lead === me() ? (this.game.player ? a.lead : null) : this.game.ranch.player(a.lead) ? a.lead : null) || null; }
  follows(a) { return !!a.lead && this.trails.has(a.id); }

  // ---------- the reins ----------
  // Why the reins cannot be held now ('' if they can): riding, rowing, swimming, sitting, both hands busy…
  handsFull() {
    const g = this.game, p = g.player;
    if (!p) return 'gone';
    if (g.scene !== g.world || p.inside) return 'inside';
    if (g.dying || p.ghost || g.gamemode === 'spectator') return 'gone';
    if (p.mount || p.boat || p.aboard) return 'ride';
    if (p.swim) return 'swim';
    if (p.pose) return 'sit';
    if (p.armsBusy || p.carrying || p.pushing) return 'hands';
    if (g.archery && g.archery.drawT !== null && g.archery.drawT !== undefined) return 'bow';
    return '';
  }
  canLead(a) { return !this.off && !!a?.def?.ride && this.ours(a) && !a.rider; }
  take(a) {
    const g = this.game, p = g.player;
    if (!this.canLead(a) || this.mine === a) return false;
    const by = this.heldBy(a);
    if (by && by !== me()) { this.say('horse.lead.other', { who: this.nameOf(by), name: a.name }); Audio.error(); return false; }
    const why = this.handsFull();
    if (why) { if (why === 'hands') this.say('horse.lead.hands', undefined, '#ffb0a0'); Audio.error(); return false; }
    if (this.mine) this.letGo();
    if (a.tie) delete a.tie;
    delete a.stay; delete a.callBy; delete a.callAt; delete a.halt; a.bolt = null; a.calling = false;
    a.lead = me();
    a.inside = false;
    g.ranch.stopGrazing(a);
    this.mine = a; p.leads = a.id; this.leads++;
    this.takenAt = g.time; this.stillT = 0;
    Audio.snort?.(0.5);
    this.say('horse.lead.taken', { name: a.name });
    g.onSave?.();
    return true;
  }
  // The horse stays where it is. why: 'slip' (too far behind), else as asked or because the hands are needed
  letGo(why = '') {
    const g = this.game, a = this.mine;
    this.stop();
    if (!a || a.lead !== me()) return;
    const L = this.trails.get(a.id);
    if (L) { a.x = wrapX(L.x); a.y = L.y; }
    a.tx = a.x; a.ty = a.y; a.vx = a.vy = 0;
    delete a.lead;
    a.at = [r2(a.x), r2(a.y)]; a.wait = 4; a.grazeHome = null;
    this.drop(a);
    this.say(why === 'slip' ? 'horse.lead.slip' : 'horse.lead.let_go', { name: a.name });
    g.onSave?.();
  }
  stop() { this.mine = null; if (this.game.player) this.game.player.leads = null; }
  drop(a) {
    this.trails.delete(a.id);
    a.netTo = null; a.leadGait = undefined;   // (a guest: the host's next word of where it is, not the one from before)
  }
  // Mounted, or put in its stable: neither led nor tied
  freed(a) {
    if (a.tie) delete a.tie;
    if (a.lead) delete a.lead;
    if (this.mine === a) this.stop();
    this.trails.delete(a.id);
  }

  // ---------- each step ----------
  update(dt) {
    const g = this.game, r = g.ranch, p = g.player;
    if (!r || this.off) return;
    if (p) p.leads = this.mine?.id || null;
    if (this.mine) this.mineNow(dt, p);
    for (const a of r.animals) {
      if (!a.def.ride) continue;
      if (a.lead && !a.rider) this.trail(a, dt);
      else {
        if (this.trails.size && this.trails.has(a.id)) this.drop(a);
        if (a.tie) this.faceKnot(a, dt);
      }
    }
    if ((this.freeT += dt) >= FREE_T) { this.freeT = 0; this.freeOld(); }
  }
  // The horse this player leads: gone, given to another by the host, or the hands are needed for something else
  mineNow(dt, p) {
    const g = this.game, a = this.mine;
    this.stillT = p?.moving ? 0 : this.stillT + dt;
    if (!g.ranch.animals.includes(a)) { this.stop(); return; }
    if (a.lead !== me()) {
      const by = this.heldBy(a) || a.rider;
      this.stop();
      if (by) this.say(a.rider ? 'horse.whistle.ridden' : 'horse.lead.other', { who: this.nameOf(by), name: a.name }); else this.say('horse.lead.let_go', { name: a.name });
      return;
    }
    if (this.handsFull()) this.letGo();
  }
  // Your id on a horse you are not leading (a game cut off, the world entered again): loose where it is
  freeOld() {
    const g = this.game, S = g.live?.guest ? g.live.items?.animals : null;
    if (!g.player || Profile.server) return;
    for (const a of g.ranch.animals) if (a.def.ride && a.lead === me() && a !== this.mine && !S?.pending?.(a.id, 'lead')) { delete a.lead; a.at = [r2(a.x), r2(a.y)]; }
  }
  // (whoever runs the world, from ranch.moveHorse) Is its leader still here, with it in the hand? Their game says which one
  // they lead (st.lh): gone, or leading none for a while, and it is loose where it is
  leaderHere(a, dt) {
    if (a.lead === me()) return true;   // (yours, or an old mark of yours: freeOld)
    const e = this.game.ranch.player(a.lead);
    if (!e) return false;
    a.noLh = e.leads === a.id ? 0 : (a.noLh || 0) + dt;
    return a.noLh < NO_LH;
  }
  release(a) { delete a.lead; a.noLh = 0; a.at = [r2(a.x), r2(a.y)]; a.tx = a.x; a.ty = a.y; a.vx = a.vy = 0; a.wait = 4; a.grazeHome = null; this.drop(a); }
  // One step of a led horse behind its leader, as this game sees them (its own player, or the messages of another's)
  trail(a, dt) {
    const g = this.game, p = g.ranch.player(a.lead), w = this.world, mine = this.mine === a;
    if (!p || !(dt > 0)) return;
    let L = this.trails.get(a.id);
    if (!L || L.a !== a) this.trails.set(a.id, (L = makeLed(a, nearX(a.x, p.x), a.y)));
    if (a.x !== wrapX(L.x) || a.y !== L.y) { L.x = nearX(a.x, p.x); L.y = a.y; L.trail.clear(); }   // (moved from elsewhere: at, a command)
    const off = nearX(L.x, p.x) - L.x;
    if (off) { L.x += off; L.trail.clear(); L.px = NaN; }   // (across the planet's seam)
    this.leaderStep(L, p, dt, mine);
    if (mine && !this.mine) return;   // (they leapt away, or it slipped: let go)
    followStep(L, w, p, dt, statsOf(a).slope || 0, (a.young ? YOUNG : 1) * sizeOf(a));
    a.x = wrapX(L.x); a.y = L.y; a.tx = a.x; a.ty = a.y;
    a.vx = L.vx; a.vy = L.vy;
    (a.dir ||= [0, 1])[0] = Math.sin(L.yaw); a.dir[1] = Math.cos(L.yaw);
    a.leadGait = L.v > 5.8 ? 3 : L.v > 3.9 ? 1 : 0;
    const d = Math.hypot(p.x - L.x, p.y - L.y);
    if (L.held && L.heldT >= (L.held === 'way' ? HELD : 0.15) && g.time - L.saidAt > SAID && !L.said) {
      L.said = true; L.saidAt = g.time;
      a.act = { kind: 'toss', t: g.time };   // (it plants its feet)
      if (mine) { this.say(WONT[L.held], { name: a.name }); Audio.snort?.(0.7); }
    }
    if (!L.held) L.said = false;
    if (d > LEAD.SLIP || (p.floor || 0) + Math.max(0, p.z || 0) > LEAD.CLIMB) {
      if (mine) this.letGo('slip');
      else if (L.heldT > 1 && d > LEAD.SLIP + 1) { L.x = p.x; L.y = p.y; L.trail.clear(); const k = LEAD.BACK / (d || 1); L.x -= (p.x - a.x) * k; L.y -= (p.y - a.y) * k; a.x = wrapX(L.x); a.y = L.y; L.held = null; }   // (another's, stuck only here: with them)
    }
  }
  // Where the leader goes: their speed, and the points of their way
  leaderStep(L, p, dt, mine) {
    if (Number.isNaN(L.px)) { L.px = p.x; L.py = p.y; return; }
    const dx = p.x - L.px, dy = p.y - L.py, s = Math.hypot(dx, dy);
    L.px = p.x; L.py = p.y;
    if (s > LEAD.JUMP) { if (mine) this.letGo('slip'); else L.trail.clear(); return; }
    const k = Math.min(1, dt * 14);
    L.lvx += (dx / dt - L.lvx) * k; L.lvy += (dy / dt - L.lvy) * k;
    const T = L.trail, lx = T.n ? T.x(T.n - 1) : L.x, ly = T.n ? T.y(T.n - 1) : L.y;
    if ((p.floor || 0) < 0.7 && Math.hypot(p.x - lx, p.y - ly) >= LEAD.STEP && Math.hypot(p.x - L.x, p.y - L.y) > 0.6) T.push(p.x, p.y);
  }

  // ---------- tying ----------
  // What a horse can be tied to nearest to (x, y), r m away at most: { kind, x, y, h, r, yaw, o }, or null. gates: also the
  // posts of a fence's gate (from the menu only: aimed at, E opens it)
  knotNear(x, y, r, gates = false) {
    let best = null, bd = r;
    this.eachKnot(x, y, r, k => { if (k.kind === 'gate' && !gates) return; const d = Math.hypot(k.x - x, k.y - y); if (d <= bd && this.world.reaches(x, y, k.x, k.y)) { bd = d; best = k; } });
    return best;
  }
  // The knot that is at (x, y), or null: what it was tied to is gone
  knotAt(x, y) {
    let best = null, bd = 0.35;
    this.eachKnot(x, y, 1.6, k => { const d = Math.hypot(k.x - x, k.y - y); if (d < bd) { bd = d; best = k; } }, true);
    return best;
  }
  eachKnot(x, y, r, fn, all = false) {
    const w = this.world, cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      // (a chunk that cannot hold any: not looked at)
      if (x + r + 1 < (cx + dx) * CHUNK || x - r - 1 > (cx + dx + 1) * CHUNK || y + r + 1 < (cy + dy) * CHUNK || y - r - 1 > (cy + dy + 1) * CHUNK) continue;
      for (const o of w.contentFor(cx + dx, cy + dy).objects) {
        if (Math.abs(o.x - x) > r + 1 || Math.abs(o.y - y) > r + 1) continue;
        const k = this.knotOn(o, x, y, all);
        if (k) fn(k);
      }
    }
  }
  // The knot on one object, for something at (x, y): on the rail of a post right in front, the post of a fence, a trunk
  knotOn(o, x, y, all = false) {
    if (o.placed === 'hitching_post') {
      const yaw = o.yaw ?? ((o.rot || 0) % 4) * Math.PI / 2, [ux, uy] = sideOf(yaw);
      let s = Math.max(-POST_X, Math.min(POST_X, (x - o.x) * ux + (y - o.y) * uy));
      if (!all) for (const q of [s, s + KNOT_GAP, s - KNOT_GAP, -s]) if (Math.abs(q) <= POST_X + 1e-6 && !this.taken(o.x + ux * q, o.y + uy * q)) { s = q; break; }
      return { kind: 'post', x: o.x + ux * s, y: o.y + uy * s, h: POST_RAIL, r: 0.055, yaw, o };
    }
    if (o.fence) return { kind: 'fence', x: o.x, y: o.y, h: o.placed === 'valla_piedra' ? 0.7 : 0.62, r: o.placed === 'valla_piedra' ? 0.25 : 0.078, yaw: 0, o };
    if (o.gate) {
      const ax = o.door === 'x' ? 0.5 : 0, ay = o.door === 'x' ? 0 : 0.5, s = (x - o.x) * ax + (y - o.y) * ay < 0 ? -1 : 1;
      return { kind: 'gate', x: o.x + s * ax, y: o.y + s * ay, h: 0.62, r: 0.078, yaw: 0, o };
    }
    if (TREES.has(o.kind) && !o.sapling && o.col?.r >= 0.14) return { kind: 'tree', x: o.x, y: o.y, h: 1.12, r: Math.min(o.col.r, 0.35) * 0.72, yaw: 0, o };
    return null;
  }
  taken(x, y) { for (const a of this.game.ranch.animals) if (a.tie && distOf(a.tie[0], a.tie[1], x, y) < KNOT_GAP * 0.8) return true; return false; }
  // Tied to a knot (or to the nearest one to it)
  tie(a, k = this.knotNear(a.x, a.y, TIE.MENU, true)) {
    const g = this.game;
    if (this.off || !k || a.rider || !this.ours(a)) return false;
    const by = this.heldBy(a);
    if (by && by !== me()) { this.say('horse.lead.other', { who: this.nameOf(by), name: a.name }); Audio.error(); return false; }
    if (this.mine === a) this.stop();
    delete a.lead; delete a.callBy; delete a.callAt; delete a.halt; delete a.stay; a.bolt = null; a.calling = false;
    this.drop(a);
    g.ranch.stopGrazing(a);
    a.tie = [r2(wrapX(k.x)), r2(k.y)];
    a.at = [r2(a.x), r2(a.y)]; a.wait = 0; a.tiedS = null;
    Audio.place();
    this.say('horse.tied', { name: a.name });
    g.onSave?.();
    return true;
  }
  untie(a, quiet = false) {
    if (!a?.tie) return false;
    delete a.tie;
    a.at = [r2(a.x), r2(a.y)]; a.tx = a.x; a.ty = a.y; a.vx = a.vy = 0; a.wait = 4; a.grazeHome = null; a.tiedS = null;
    this.game.ranch.stopGrazing(a);
    if (!quiet) { Audio.place(); this.say('horse.untied', { name: a.name }); this.game.onSave?.(); }
    return true;
  }
  // The knot of a tied horse, as the art needs it: looked for again every CHECK s (kept on the horse, never saved)
  knotOf(a) {
    if (!a.tie) return null;
    const now = this.game.time, K = (a.knot ||= { key: null, t: -Infinity, v: null });
    if (K.key !== a.tie || now - K.t > TIE.CHECK) { K.key = a.tie; K.t = now; K.v = this.knotAt(nearX(a.tie[0], a.x), a.tie[1]); }
    return K.v;
  }
  // (whoever runs the world) A tied horse: near its knot and facing it, shifting a little now and then, or grazing what it
  // reaches. What it was tied to is gone (a fence taken away, a tree cut down): it is loose
  tied(a, dt, day) {
    const g = this.game, w = this.world, r = g.ranch;
    if (this.off || !Array.isArray(a.tie) || !Number.isFinite(a.tie[0]) || !Number.isFinite(a.tie[1])) return false;
    const kx = nearX(a.tie[0], a.x), ky = a.tie[1], key = String(a.tie), size = (a.young ? YOUNG : 1) * sizeOf(a);
    let S = a.tiedS;
    if (!S || S.key !== key) S = a.tiedS = { key, x: a.x, y: a.y, ang: Math.atan2(a.y - ky, a.x - kx), wait: 0, stuck: 0, check: 0, far: false, placed: false };
    if ((S.check -= dt) <= 0) {
      S.check = TIE.CHECK;
      S.far = !g.mobs.players().some(q => distOf(q.x, q.y, a.x, a.y) < TIE.FAR);
      if (!S.far && !this.knotAt(kx, ky)) { this.untie(a, true); return false; }
    }
    if (a.halt !== undefined) {   // (its menu is open, or it is being looked after)
      const left = a.halt - (w.clock || 0);
      if (left > 0 && left < 60) { r.stopGrazing(a); S.x = a.x; S.y = a.y; a.vx = a.vy = 0; return true; }
      delete a.halt;
    }
    if (S.far) { if (a.grazing || a.grazeAt) r.stopGrazing(a); a.vx = a.vy = 0; if (day) r.grazeFar(a, dt); return true; }   // (nobody near: it stands, and grazes as the others far away)
    if (!S.placed) { S.placed = true; const at = this.standBy(a, kx, ky, S.ang, size, 2.2); if (at) { S.x = at[0]; S.y = at[1]; S.ang = at[2]; } else { S.x = a.x; S.y = a.y; } }
    if (a.eating > 0) {
      a.vx = a.vy = 0;
      if ((a.eating -= dt) > 0) return true;
      const [tx, ty] = a.grazeAt, yard = this.yardOf(a);
      if (w.pasture(tx, ty, r.today, yard)) r.ate(a, tx, ty);
      r.stopGrazing(a); a.grazeNext = g.time + within(REST); S.wait = 3 + Math.random() * 4;
      return true;
    }
    if (!this.slide(a, S, dt)) return true;
    if (a.grazeAt) {
      const [tx, ty] = a.grazeAt;
      if (!day || Math.hypot(a.x - S.x, a.y - S.y) > 0.4 || !w.pasture(tx, ty, r.today, this.yardOf(a))) { r.stopGrazing(a); a.grazeNext = g.time + 5; return true; }
      a.eating = within(EAT); a.grazing = true;
      return true;
    }
    if ((S.wait -= dt) > 0) return true;
    S.wait = within(TIE.SHIFT);
    if (day && g.time >= (a.grazeNext || 0) && r.grazedOn(a) < r.needOf(a) && this.grassBy(a, S, kx, ky, size)) { S.wait = 1; return true; }
    a.grazeNext = Math.max(a.grazeNext || 0, g.time + 4);
    const at = this.standBy(a, kx, ky, S.ang + (Math.random() - 0.5) * 0.7, size, 0.2);
    if (at) { S.x = at[0]; S.y = at[1]; S.ang = at[2]; }
    return true;
  }
  yardOf(a) { const h = a.home2; return !!h && inYard(h[0], h[1]); }
  // It moves to its place, slowly and still facing the knot (from far, when it has just been tied, it walks there). There?
  slide(a, S, dt) {
    const dx = S.x - a.x, dy = S.y - a.y, d = Math.hypot(dx, dy);
    if (d < 0.05) { a.vx = a.vy = 0; return true; }
    const sp = d > TIE.WALK_OFF || S.going ? TIE.WALK : TIE.SLOW, s = Math.min(d, sp * dt);
    S.going = d > 0.3 && sp === TIE.WALK;
    Q.x = a.x + dx / d * s; Q.y = a.y + dy / d * s;
    collide(Q, this.world.collidersNear(Q.x, Q.y).filter(stops), 0.22);
    const go = Math.hypot(Q.x - a.x, Q.y - a.y);
    if (go < s * 0.3 || a.deep(this.world, Q.x, Q.y)) { a.vx = a.vy = 0; if ((S.stuck += dt) > 1.2) { S.stuck = 0; S.x = a.x; S.y = a.y; S.going = false; } return false; }
    S.stuck = 0;
    a.vx = (Q.x - a.x) / dt; a.vy = (Q.y - a.y) / dt;
    a.x = wrapX(Q.x); a.y = Q.y;
    if (a.x !== Q.x) { const o = a.x - Q.x; S.x += o; }
    a.tx = a.x; a.ty = a.y;
    return false;
  }
  // Where it can stand by the knot, from the side ang: [x, y, the side], the nearest free one (spread: how far round it looks)
  standBy(a, kx, ky, ang, size, spread) {
    const bit = TIE.BIT * size, R = bit + TIE.STAND - 0.15 + Math.random() * 0.35;
    for (let i = 0; i < 9; i++) {
      const off = ((i + 1) >> 1) * (i & 1 ? 1 : -1) * spread / 4, q = ang + off, x = kx + Math.cos(q) * R, y = ky + Math.sin(q) * R;
      if (this.freeAt(a, x, y, Math.cos(q), Math.sin(q), size)) return [x, y, q];
      if (!spread) break;
    }
    return null;
  }
  // Is there room for its body at (x, y), its tail towards (ux, uy)? (its middle and its quarters, and no other tied horse)
  freeAt(a, x, y, ux, uy, size) {
    const w = this.world;
    if (a.deep(w, x, y)) return false;
    for (const b of this.game.ranch.animals) if (b !== a && b.tie && Math.hypot(nearX(b.x, x) - x, b.y - y) < BODY * size) return false;
    const list = w.collidersNear(x, y).filter(stops);
    for (const k of [0, 0.6 * size]) {
      Q2.x = x + ux * k; Q2.y = y + uy * k;
      const bx = Q2.x, by = Q2.y;
      collide(Q2, list, 0.27);
      if (Math.abs(Q2.x - bx) + Math.abs(Q2.y - by) > 0.04) return false;
    }
    return !(w.pieceAt && refusesTile(w, x, y));
  }
  // A tile with grass its mouth reaches with the rope: it moves so that its muzzle is over it
  grassBy(a, S, kx, ky, size) {
    const w = this.world, today = this.game.ranch.today, yard = this.yardOf(a), ux = Math.cos(S.ang), uy = Math.sin(S.ang);
    const n = Math.floor(Math.random() * 9);
    for (let i = 0; i < 9; i++) {
      const j = (i + n) % 9, tx = Math.floor(kx) + (j % 3) - 1, ty = Math.floor(ky) + Math.floor(j / 3) - 1, mx = tx + 0.5, my = ty + 0.5;
      if (Math.hypot(mx - kx, my - ky) > TIE.ROPE + 0.1 || !w.pasture(tx, ty, today, yard)) continue;
      const x = mx + ux * 0.85 * size, y = my + uy * 0.85 * size;
      if (!this.freeAt(a, x, y, ux, uy, size) || !w.reaches(a.x, a.y, x, y, true)) continue;
      S.x = x; S.y = y; a.grazeAt = [tx, ty];
      return true;
    }
    return false;
  }
  // (every game) A tied horse standing looks at its knot, a little to one side; walking to it, the way it goes
  faceKnot(a, dt) {
    const kx = nearX(a.tie[0], a.x) - a.x, ky = a.tie[1] - a.y, v = Math.hypot(a.vx || 0, a.vy || 0);
    let want = Math.atan2(kx, ky);
    if (v > 0.75) want = Math.atan2(a.vx, a.vy);
    else if (a.grazing && a.grazeAt) want = Math.atan2(a.grazeAt[0] + 0.5 - a.x, a.grazeAt[1] + 0.5 - a.y);
    else want += (a.tieLean ??= (hash(a.id) - 0.5) * 0.5);
    const d = (a.dir ||= [0, 1]), now = Math.atan2(d[0], d[1]), off = wrapA(want - now), yaw = now + Math.max(-2 * dt, Math.min(2 * dt, off));
    d[0] = Math.sin(yaw); d[1] = Math.cos(yaw);
  }

  // ---------- E ----------
  // E with nothing aimed, leading: let go (and the same object while nothing changes: it is asked every frame)
  action() {
    const a = this.mine;
    if (!a) return null;
    const text = t('horse.menu.letgo', { name: a.name });
    if (this.cache?.text !== text || this.cache.a !== a) this.cache = { a, text, run: () => this.letGo(), leading: true };
    return this.cache;
  }
  // In the minimal HUD: just after taking them, standing still, or with Tab (E works all the same)
  promptShown() { const g = this.game, sh = g.smartHud; return !sh || sh.held || this.stillT >= 1 || g.time - this.takenAt < PROMPT; }
  tieAct(k) { const a = this.mine; return a ? { text: t('horse.menu.tie', { name: a.name }), run: () => this.tie(a, k) } : null; }
  // E on a hitching post: tie the one you lead; else untie one of yours tied to it, or tie one standing by it. Else null: as any
  // other piece
  postAction(o, pick = null) {
    if (this.off || o.placed !== 'hitching_post') return null;
    const g = this.game, p = g.player;
    if (this.mine) { const k = this.knotOn(o, p.x, p.y); return k && Math.hypot(k.x - p.x, k.y - p.y) <= TIE.AIM ? this.tieAct(k) : null; }
    let best = null, bd = 1.2;
    for (const a of g.ranch.animals) {
      if (!a.tie || !a.def.ride || !this.ours(a)) continue;
      if (this.knotOf(a)?.o?.tile?.join() !== o.tile?.join()) continue;
      const d = distOf(a.tie[0], a.tie[1], p.x, p.y);
      if (!best || d < bd) { best = a; bd = d; }
    }
    if (best) return { text: t('horse.menu.untie_name', { name: best.name }), run: () => this.untie(best), alt: pick?.() || null };
    // (one of yours standing by it: tied, as from its menu. Never the post taken down with the same key, just after)
    let near = null, nd = TIE.MENU;
    for (const a of g.ranch.animals) {
      if (!this.canLead(a) || a.tie || a.calling || this.heldBy(a)) continue;
      const d = distOf(a.x, a.y, o.x, o.y);
      if (d < nd) { nd = d; near = a; }
    }
    if (!near) return null;
    return { text: t('horse.menu.tie', { name: near.name }), run: () => this.tie(near, this.knotOn(o, nearX(near.x, o.x), near.y)), alt: pick?.() || null };
  }
  // Leading, the fences and the trees within reach (the posts are aimed at as pieces: postAction)
  aimables(p, sc, box) {
    if (!this.mine || sc !== this.world) return null;
    if (this.game.time - this.knotT > 0.2) {
      this.knotT = this.game.time; const list = (this.knots = []);
      this.eachKnot(p.x, p.y, TIE.AIM, k => { if ((k.kind === 'fence' || k.kind === 'tree') && Math.hypot(k.x - p.x, k.y - p.y) <= TIE.AIM && sc.reaches(p.x, p.y, k.x, k.y)) list.push(k); });
    }
    const out = [];
    for (const k of this.knots || []) {
      if (k.kind === 'tree') { const r = k.r + 0.22; out.push({ kind: 'sys', tie: k, tree: k.o, box: box(k.x, k.y, r, r, 0, 2.4), act: () => this.tieAct(k) }); }
      else { const m = k.o.mask || 0, hx = m & 3 ? 0.5 : 0.16, hy = m & 12 ? 0.5 : 0.16; out.push({ kind: 'sys', tie: k, box: box(k.x, k.y, hx, hy, 0, 0.98), act: () => this.tieAct(k) }); }
    }
    return out;
  }
}
const WONT = { door: 'horse.lead.wont_in', deep: 'horse.lead.wont_water', up: 'horse.refuse.slope', down: 'horse.refuse.down', way: 'horse.lead.no_way' };
function hash(s) { let h = 2166136261; for (let i = 0; i < (s || '').length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return ((h >>> 0) % 1000) / 1000; }

// ---------- how it follows (pure: the tests call it with a stub world) ----------
// L: makeLed; w: the world (collidersNear, surfaceAt, waterDepth, pieceAt); p: the leader; sure: its breed's on slopes
export function followStep(L, w, p, dt, sure = 0, size = 1) {
  const T = L.trail, d = Math.hypot(p.x - L.x, p.y - L.y), rem = T.length(L.x, L.y, p.x, p.y), back = LEAD.BACK + Math.max(0, size - 1) * 0.9;
  if ((L.listT -= dt) <= 0) { L.listT = LIST_T; around(w, L.x, L.y, L.list); }
  // (across open ground it cuts the corner, as anything pulled by a rope; also when what it follows is cut off)
  if ((L.cutT -= dt) <= 0) {
    L.cutT = 0.25;
    if (T.n && rem > d + 0.6 && (d < 0.8 || clearWay(L, w, p))) T.clear();
  }
  const ux = d > 1e-6 ? (p.x - L.x) / d : 0, uy = d > 1e-6 ? (p.y - L.y) / d : 0, want = rem - back;
  let goal = want > 0.05 && d > LEAD.NEAR ? Math.max(0, L.lvx * ux + L.lvy * uy) + want * 2.2 : want > -0.35 && d > LEAD.NEAR ? Math.max(0, L.lvx * ux + L.lvy * uy + want * 4) : 0;
  goal = Math.min(goal, L.cap);
  L.v += Math.max(-LEAD.BRAKE * dt, Math.min(LEAD.ACCEL * dt, goal - L.v));
  if (L.v < 0.05 && goal < 0.05) L.v = 0;
  L.vx = L.vy = 0;
  // Which way: the next point of the trail, or the leader
  let left = L.v * dt, x = L.x, y = L.y;
  while (T.n && Math.hypot(T.x(0) - x, T.y(0) - y) < 0.12) T.shift();
  const gx = T.n ? T.x(0) : p.x, gy = T.n ? T.y(0) : p.y, gd = Math.hypot(gx - x, gy - y), fx = gd > 1e-6 ? (gx - x) / gd : Math.sin(L.yaw), fy = gd > 1e-6 ? (gy - y) / gd : Math.cos(L.yaw);
  const pull = want > 0.05;   // (it would go on: what is ahead of it is looked at, and it says no)
  if ((L.slopeT -= dt) <= 0) { L.slopeT = SLOPE_T; L.no = pull ? ahead(L, w, x, y, fx, fy, sure) : null; }
  if (L.no && pull) {
    L.v = 0; L.stuck = 0;
    if (L.held !== L.no) { L.held = L.no; L.heldT = 0; }
    L.heldT += dt;
    if (T.n && L.heldT > 0.5 && d > back) { const gone = clearWay(L, w, p); if (gone) T.clear(); }
    turn(L, fx, fy, dt, 1.6);
    return;
  }
  if (left > 1e-5) {
    while (left > 1e-5 && T.n) {
      const dx = T.x(0) - x, dy = T.y(0) - y, s = Math.hypot(dx, dy);
      if (s <= left) { x += dx; y += dy; left -= s; T.shift(); } else { x += dx / s * left; y += dy / s * left; left = 0; }
    }
    if (left > 1e-5) { const dx = p.x - x, dy = p.y - y, s = Math.hypot(dx, dy), go = Math.min(left, Math.max(0, s - LEAD.NEAR)); if (s > 1e-6) { x += dx / s * go; y += dy / s * go; } }
    Q.x = x; Q.y = y;
    collide(Q, L.list, LEAD.R);
    const asked = Math.hypot(x - L.x, y - L.y), got = Math.hypot(Q.x - L.x, Q.y - L.y);
    if (asked > 1e-5 && got < asked * 0.3) {
      L.stuck += dt;
      if (L.stuck > STUCK) T.clear();   // (straight to the leader, sliding along whatever it is)
    } else L.stuck = Math.max(0, L.stuck - dt * 2);
    if (got > 1e-6) { L.vx = (Q.x - L.x) / dt; L.vy = (Q.y - L.y) / dt; }
    const mx = Q.x - L.x, my = Q.y - L.y;
    L.x = Q.x; L.y = Q.y;
    if (got > 1e-4) turn(L, mx, my, dt, LEAD.TURN);
  } else {
    // (standing, it turns to whoever leads it once they are well to one side)
    const off = Math.abs(wrapA(Math.atan2(ux, uy) - L.yaw));
    if (off > 1) L.turning = true; else if (off < 0.25) L.turning = false;
    if (L.turning) turn(L, ux, uy, dt, 1.5);
  }
  if (L.stuck > HELD) { if (L.held !== 'way') { L.held = 'way'; L.heldT = HELD; } L.heldT += dt; } else if (!L.no || !pull) { L.held = null; L.heldT = 0; }
}
function turn(L, fx, fy, dt, rate) { const d = wrapA(Math.atan2(fx, fy) - L.yaw); L.yaw = wrapA(L.yaw + Math.max(-rate * dt, Math.min(rate * dt, d))); }
// What it will not walk into, a step ahead: 'door', 'deep', 'up', 'down', or null. Sets how fast it goes here (L.cap)
function ahead(L, w, x, y, fx, fy, sure) {
  const reach = LEAD.REACH + L.v * SLOPE_T, ax = x + fx * reach, ay = y + fy * reach;
  L.cap = LEAD.MAX;
  if (refusesTile(w, ax, ay) && !refusesTile(w, x, y)) return 'door';
  const wet = w.waterDepth?.(ax, ay) || 0, here = w.waterDepth?.(x, y) || 0;
  if (wet >= LEAD.DEEP && wet >= here) return 'deep';
  if (here > 0.6) L.cap = 2.4; else if (here > 0.3) L.cap = 4;
  if (w.surfaceAt && here < 0.15 && wet < 0.15) {
    const g = (w.surfaceAt(x + fx * SLOPE_M, y + fy * SLOPE_M) - w.surfaceAt(x, y)) / SLOPE_M, cliff = CLIFF + sure;
    if (Math.abs(g) >= cliff) return g > 0 ? 'up' : 'down';
    if (Math.abs(g) >= VERY + sure) L.cap = Math.min(L.cap, STEEP_WALK);
  }
  return null;
}
// Straight to the leader with nothing in the way (solid, deep, a door, a cliff)?
function clearWay(L, w, p) {
  const dx = p.x - L.x, dy = p.y - L.y, d = Math.hypot(dx, dy);
  if (d < 1e-6) return true;
  const ux = dx / d, uy = dy / d;
  let h = w.surfaceAt?.(L.x, L.y) ?? 0;
  for (let s = 0.4; s < d - 0.4; s += 0.4) {
    const x = Q2.x = L.x + ux * s, y = Q2.y = L.y + uy * s;
    collide(Q2, L.list, LEAD.R);
    if (Math.abs(Q2.x - x) + Math.abs(Q2.y - y) > 0.06 || (w.waterDepth?.(x, y) || 0) >= LEAD.DEEP || refusesTile(w, x, y)) return false;
    const n = w.surfaceAt?.(x, y) ?? 0;
    if (Math.abs(n - h) / 0.4 >= CLIFF) return false;
    h = n;
  }
  return true;
}
export const led = (a, x, y) => makeLed(a, x, y);   // (tests)
