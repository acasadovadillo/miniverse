// The wheelbarrow: phase 2 of the weight inventory (docs/planes/gta/PLAN-C2-fase2.md). Built with B (Outdoors, at the
// bench; its plan is sold by Dani), it is placed like any piece of furniture, always free (fitFree, d.pos): a chest of 12
// stacks (CHESTS.wheelbarrow, d.chest) with up to 3 big things on it (d.barrow[tile] = { id, l: [[id, day, cq?]…] }: cq, a hunted carcass's record, quality.js), drawn on it.
// E pushes it with both hands: it leaves its tile and becomes a record of the world in the chunk where it was taken
// (d.pushed[id] = { by, x, y, c, l, t, park }), never part of the player's save; Q parks it again where it is drawn, with
// the same things and the same id.
//   - Why a record of the world and not the player's save: what it holds has one owner, the world, and every step (take
//     it, load it, park it) is one change of one chunk, which the network and the saves already do well. Quitting, dying,
//     a guest that goes away: whoever decides the world parks it where it was (sweep, peerGone, the first update).
//   - Playing together, whoever runs the world decides (decides(): alone, your game; together, the host's or the world
//     server's). Taking and parking are checked by arbitrate (live.js calls it with a guest's changes); loading, taking
//     off and putting on a big thing, and a boat's, are requests (d.claim[n]) it resolves in order and answers with ok.
//   - A guest's request is finished only by its answer in the world (d.claim[n].ok, by the host's ops or, once this game
//     decides, by its own sweep), never by a timer: what it puts on a parked one leaves the arms when it is asked for
//     (held in the request, never in two places), and comes back only if the answer is no, or if the request is gone from
//     the world unanswered (it never reached whoever decides). Quitting meanwhile, the request is trusted to the host.
//   - Moving with it: entities.js (barrowPen, turnPushed: never into a wall, never stuck); its speed and the hands:
//     carry.js (speedMul, noRun, handsBusy, syncArms). What it carries does not weigh on you.
// Only the game imports this file (and the tests); it never imports src/three (the drawing reads e.pushing, o.model).
import { BARROW, CENTER_AHEAD, WHEEL_AHEAD, BULKY, CARCASS_DAYS, barrowKey, parseBarrowKey, randomId, CART, VEHICLES, vehicleOf, parseCartKey } from './carry-items.js';
import { cleanCq, dayOfCq, isGame } from './quality.js';
import { CHUNK } from './world/gen.js';
import { wrapIndex, inPlanet } from './world/planet.js';
import { dirOf, hitsCircle, obb, distTo } from './world/fit.js';
import { collide } from './physics.js';
import { barrowColliders, barrowPen } from './entities.js';
import { Profile } from './accounts.js';
import { reportFault } from './faults.js';
import { t, noun } from './i18n.js';
import { hud } from './ui/hud.js';
import { Audio } from './audio.js';
import { CLAIMS } from './claims.js';

const ID = BARROW.ID, LOADS = BARROW.LOADS, Q = Math.PI / 2;
const GRACE = 8;           // seconds a record whose pusher is not pushing it any more waits before it is parked (by whoever decides)
const CONFIRM_WAIT = 8;    // (a guest) seconds to wait for the host's word on taking it, or on a request
const CLAIM_KEEP = 20;     // seconds (of the world's clock) a request stays in its chunk
const SEND_EVERY = 4, SEND_MOVED = 3;   // the record's x, y: every 4 s at most, and only if it moved 3 m
const STUCK_FORCE = 2;     // seconds with its box inside something (a door closed on it, a wall built on it): then Q parks it by force
const RETRY = 30;          // seconds between two tries of a record that found no room at all (in the middle of the sea)
const RECENT = 10;         // (the host) seconds a chest that was just taken away still takes a late change (into its record)
const RING = 8, SET_RING = 16;   // tiles around: forced parking, and the last resort (as /setblock)
const PEER_NEAR = 8, PARK_NEAR = 4;   // (the host) a guest's record and its parking place stay this close to where the guest is
const BODY = 0.28;         // (the body's radius, as entities.js)
const me = () => Profile.id || 'me';
const r2 = v => Math.round(v * 100) / 100;
const r3 = v => Math.round(v * 1000) / 1000;
const chunkOf = (x, y) => [Math.floor(x / CHUNK), Math.floor(y / CHUNK)];
const keyOf = (cx, cy) => `${wrapIndex(cx, CHUNK)},${cy}`;
const xyOf = k => k.split(',').map(Number);
const copy = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const isBarrow = raw => typeof raw === 'string' && raw.split('@')[0] === ID;
// (the wheelbarrow or the horse cart, cart.js: the same machinery, each with its own sizes, VEHICLES)
const isVehicle = raw => !!vehicleOf(raw);
const kindOfRec = r => (r?.k === CART.ID ? CART.ID : ID);
const sizes = kind => VEHICLES[kind] || VEHICLES[ID];
// Its 12 stacks (n: the cart's 24), copied (what a chest holds: the same objects, never shared between two places)
export const padStacks = (c, n = BARROW.STACKS) => { const out = Array.isArray(c) ? c.map(s => (s ? { ...s } : null)) : []; while (out.length < n) out.push(null); return out; };
// Its big things, checked: [[id, day|null, cq?]…], LOADS at most (max: the cart's 4)
export const cleanLoads = (l, max = LOADS) => (Array.isArray(l) ? l : []).filter(e => Array.isArray(e) && BULKY[e[0]]).slice(0, max).map(([id, day, cq]) => { const q = cleanCq(cq), n = Number.isFinite(day) ? day : null; return q && isGame(id) ? [id, n, q] : [id, n]; });
// (a vehicle's chest and big things at a tile, by its kind)
const stacksAt = (kind, c) => padStacks(c, sizes(kind).STACKS), loadsFor = (kind, l) => cleanLoads(l, sizes(kind).LOADS);
const num = (v, d) => (Number.isFinite(v) ? v : Number.isFinite(d) ? d : 0);

// The host, with the changes of a guest's chunk (k), before applying them (live.js 'w'). Only the fields of the
// wheelbarrow are looked at here (pushed, claim, and chest for a late change); the rest pass as always (rest: live.js
// checks them with mayEdit). edit: whether the guest may touch this chunk (mayEdit). Pure: nothing is changed here.
// → { ok: the wheelbarrow's ops to apply, rest, back: ops to send back to the guest, park: the record ids to park,
//     claims: the requests to resolve, late: [{ id, k, v }] stacks that go into a record }
// ours(owner, by): may by drive a cart of owner's (the couple's, cart.js)
export function arbitrate(world, peer, k, ops, { edit = true, recent = new Map(), now = 0, clock = 0, ours = () => true } = {}) {
  const out = { ok: [], rest: [], back: [], park: [], claims: [], late: [] };
  const d = world.deltas.get(k) || {}, by = peer?.id, at = Array.isArray(peer?.at) ? peer.at : null;
  // (the tiles whose placed thing this message takes away: a take of a wheelbarrow removes its tile in the same message)
  const gone = new Set(), set = new Set();
  for (const [f, c, v] of ops) if (f === 'placed' && typeof c === 'string') (v === undefined ? gone : set).add(c);
  for (const c of set) recent.delete(c);   // (something else is placed on a tile a wheelbarrow left: its changes are its own)
  const refused = new Set();
  const close = (x, y, r) => (at && !(Math.hypot(x - at[0], y - at[1]) <= r) ? [at[0], at[1]] : [x, y]);
  for (const op of ops) {
    const [f, c, v] = op;
    if (f === 'pushed') {
      // (the whole field, or deleting a record: never from a guest; parking and freeing them is the host's)
      if (typeof c !== 'string') { out.back.push(['pushed', null, copy(d.pushed || {})]); continue; }
      const cur = d.pushed?.[c];
      if (!isMap(v)) { out.back.push(cur ? ['pushed', c, copy(cur)] : ['pushed', c]); continue; }
      if (!cur) {
        // Taking it: only if the same message takes its tile away, and here that tile has a wheelbarrow with this id. The
        // record is made from what is here (what was put in it a moment before is not lost; nobody makes up its contents)
        // (a cart: only by its couple, cart.js; and its horse and its owner go in its record)
        const kp = edit && by ? [...gone].find(tp => isVehicle(d.placed?.[tp]) && (d.barrow?.[tp]?.id || 't' + tp) === c && (vehicleOf(d.placed[tp]) !== CART.ID || ours(d.barrow?.[tp]?.o, by))) : undefined;
        if (kp === undefined) {
          out.back.push(['pushed', c]);
          for (const tp of gone) if (isVehicle(d.placed?.[tp])) refused.add(tp);
          continue;
        }
        const [x, y] = close(num(v.x, at?.[0]), num(v.y, at?.[1]), PEER_NEAR), kind = vehicleOf(d.placed[kp]), B = d.barrow?.[kp];
        const extra = kind === CART.ID ? { k: CART.ID, ...(typeof v.h === 'string' && v.h.length < 80 && { h: v.h }), ...(B?.o && { o: B.o }) } : {};
        out.ok.push(['pushed', c, { by, x: r2(x), y: r2(y), c: stacksAt(kind, d.chest?.[kp]), l: loadsFor(kind, B?.l), t: Math.round(clock), ...extra }]);
        recent.set(kp, { id: c, k, until: now + RECENT });
        continue;
      }
      if (cur.by !== by) { out.back.push(['pushed', c, copy(cur)]); continue; }
      // Its own: only where it is (x, y) and where to park it; its stacks and its big things are always the ones here
      const [x, y] = close(num(v.x, cur.x), num(v.y, cur.y), PEER_NEAR), next = { ...copy(cur), x: r2(x), y: r2(y) };
      if (Array.isArray(v.park) && v.park.length >= 2) {
        const [px, py] = close(num(v.park[0], x), num(v.park[1], y), PARK_NEAR);
        next.park = [r2(px), r2(py), r2(num(v.park[2], 0))];
        out.park.push(c);
      }
      out.ok.push(['pushed', c, next]);
      continue;
    }
    if (f === 'claim') {
      const cur = typeof c === 'string' ? d.claim?.[c] : undefined;
      if (typeof c === 'string' && !cur && isMap(v) && v.by === by && by && v.ok === undefined && typeof v.k === 'string') { out.ok.push(op); out.claims.push(c); }
      else out.back.push(typeof c !== 'string' ? ['claim', null, copy(d.claim || {})] : cur ? ['claim', c, copy(cur)] : ['claim', c]);
      continue;
    }
    // (a late change of a wheelbarrow's stacks: the window was open, or B or C paid from it, while another took it. It goes
    // into its record, not to an orphan chest on its old tile; only while nothing else stands there)
    if (f === 'chest' && typeof c === 'string' && v !== undefined && !d.placed?.[c] && !set.has(c)) {
      const R = recent.get(c);
      if (R && R.until > now) { out.late.push({ id: R.id, k: R.k, v: copy(v) }); continue; }
    }
    out.rest.push(op);
  }
  // A refused take: its tile goes back to the guest as it is here (and nothing of it is applied)
  if (refused.size) {
    const tileOf = (f, c) => (f === 'pos' ? String(c).replace(/^placed:/, '') : c);
    out.rest = out.rest.filter(([f, c]) => !(['placed', 'chest', 'barrow', 'pos'].includes(f) && refused.has(tileOf(f, c))));
    for (const tp of refused) for (const [f, c] of [['placed', tp], ['chest', tp], ['barrow', tp], ['pos', 'placed:' + tp]]) out.back.push(d[f]?.[c] === undefined ? [f, c] : [f, c, copy(d[f][c])]);
  }
  return out;
}

export class Barrow {
  constructor(game) {
    this.game = game;
    this.rec = null;           // what this game's player pushes: { id, k (its record's chunk), key, confirmed, since, sentAt, sx, sy, stuck }
    this.pending = new Map();  // (a guest) its requests waiting for the host's word: n → { k, kind, tile, i, at, done }
    this.recent = new Map();   // (the host) tile → { id, k, until }: wheelbarrows just taken (see arbitrate, late)
    this.idle = new Map();     // (whoever decides) record id → when it was first seen without its pusher pushing it
    this.failedAt = new Map(); // record id → when it found no room at all (tried again every RETRY)
    this.grip = null; this.started = false; this.saidAt = -1e9; this.warned = false;
  }
  // The model key of what is pushed (also st.ca and p.pushing), or null
  get pushing() { return this.rec?.key || null; }
  decides() { const L = this.game.live; return !L?.joined || L.role === 'host'; }
  guest() { const L = this.game.live; return !!L?.joined && L.role === 'guest'; }
  say(text) { hud.toast(text, 'warn'); Audio.error(); }
  reset() {
    this.rec = null; this.grip = null; this.started = false;
    this.pending.clear(); this.recent.clear(); this.idle.clear(); this.failedAt.clear();
    if (this.game.player) this.game.player.pushing = null;
  }
  // The pushed one's record, in its chunk (or null)
  record() { const r = this.rec; return r ? this.game.world?.deltas.get(r.k)?.pushed?.[r.id] || null : null; }
  // A parked one: its chunk's data for its tile
  dataAt(tile) { const [tx, ty] = tile, d = this.game.world.delta(...chunkOf(tx, ty)); return { d, k: `${tx},${ty}` }; }
  // (a parked wheelbarrow or cart, cart.js: the same chest and big things, each with its sizes)
  kindAt(tile) { return vehicleOf(this.game.world?.ownAt('placed', tile[0], tile[1])); }
  loadsAt(tile) { const { d, k } = this.dataAt(tile); return loadsFor(this.kindAt(tile) || ID, d?.barrow?.[k]?.l); }
  maxLoads(tile) { return sizes(this.kindAt(tile) || ID).LOADS; }
  idAt(tile) { const { d, k } = this.dataAt(tile); return d?.barrow?.[k]?.id || 't' + k; }
  isAt(tile) { return isVehicle(this.game.world?.ownAt('placed', tile[0], tile[1])); }
  // Has it stacks or big things? (then B › Remove, B › Move and enlarging the house treat it as full)
  loaded(tile) { return !!this.game.world.chestAt(...tile)?.some(Boolean) || this.loadsAt(tile).length > 0; }
  // (the key of what is pushed, from its record: its big things and whether it has stacks)
  setKey(l, c) {
    const g = this.game, p = g.player;
    if (!this.rec) return;
    this.rec.key = barrowKey(cleanLoads(l).map(e => e[0]), !!c?.some?.(Boolean));
    if (p) p.pushing = this.rec.key;
    g.carry?.syncArms();
  }
  // Let go of it here (it is parked, or another has it): the hands are free
  drop() {
    const g = this.game;
    this.rec = null; this.grip = null;
    if (g.player) g.player.pushing = null;
    g.carry?.syncArms();
  }

  // ---------- parked: E pushes it, X opens it ----------
  parkedAction(o) {
    const g = this.game, p = g.player, C = g.carry;
    const open = { text: t('barrow.open'), run: () => g.onChest?.(g.scene.chestAt(...o.tile), o.tile) };
    if (C?.held) {
      if (this.loadsAt(o.tile).length >= LOADS) return { text: t('barrow.full'), run: () => this.say(t('barrow.full')), alt: open };
      if (this.waiting('put')) return { text: t('barrow.wait'), run: () => {}, alt: open };
      return { text: t('barrow.load', { item: noun('item', C.held) }), run: () => this.loadParked(o), alt: open };
    }
    if (p?.mount) return { text: t('barrow.not_riding'), run: () => this.say(t('barrow.not_riding')), alt: open };
    return { text: t('barrow.push'), run: () => this.push(o), alt: open };
  }
  // Why it cannot be pushed from here ('' if it can; then this.grip says where to stand)
  cantPush(o) {
    const g = this.game, p = g.player, w = g.world, L = g.live;
    this.grip = null;
    if (!p || g.gamemode === 'spectator') return t('barrow.cant_here');
    if (this.rec || g.carry?.held) return t('carry.hands_full');
    if (p.mount) return t('barrow.not_riding');
    if (p.boat || p.aboard) return t('carry.not_riding');
    if (p.swim || p.pose) return t('carry.cant_take_here');
    if (g.scene !== w || !o?.tile || o.fixed || o.unknown || !this.isAt(o.tile)) return t('barrow.cant_here');
    // (on a rock, in the air or in a tower's stairs: once pushing, those are walls, and collide would throw you off at once)
    const near = w.collidersNear(o.x, o.y);
    if (p.floor > 0.02 || p.airborne || near.some(c => c.spiral && Math.hypot(c.x - p.x, c.y - p.y) < c.r + BODY)) return t('barrow.cant_here');
    if (L?.joined && L.guest && !L.host?.barrows) return t('barrow.server_old');
    this.grip = this.gripFor(o, near);
    return this.grip ? '' : t('barrow.no_grip');
  }
  // Where to stand to push it: behind its grips, facing as it does (it does not move at all); or, if there is no room
  // there, where you are, turned to it (it comes to your hands), if its box fits there. null: neither
  gripFor(o, near) {
    const g = this.game, p = g.player, w = g.world, yaw = o.yaw ?? 0, [fx, fy] = dirOf(yaw);
    const dug = !!w.digNear?.(o.x, o.y, 3), feetAt = (x, y, z = 0) => (dug ? w.surfaceAt(x, y) + z : null);
    const fits = (x, y, f, feet) => barrowPen(w, barrowColliders(near, x, y, o.obb), x, y, f.x, f.y, feet) < 0.02;
    const gx = o.x - fx * CENTER_AHEAD, gy = o.y - fy * CENTER_AHEAD, f0 = { x: fx, y: fy };
    if (Math.hypot(gx - p.x, gy - p.y) < 2.4 && this.standable(gx, gy, barrowColliders(near, gx, gy, o.obb)) && (!w.reaches || w.reaches(p.x, p.y, gx, gy)) && fits(gx, gy, f0, feetAt(gx, gy))) return { x: gx, y: gy, face: f0 };
    const dx = o.x - p.x, dy = o.y - p.y, l = Math.hypot(dx, dy) || 1, f1 = { x: dx / l, y: dy / l };
    if (fits(p.x, p.y, f1, feetAt(p.x, p.y, p.z || 0))) return { x: p.x, y: p.y, face: f1 };
    return null;
  }
  standable(x, y, B) {
    const w = this.game.world, q = { x, y };
    collide(q, B, BODY);
    if (Math.hypot(q.x - x, q.y - y) > 0.03 || !inPlanet(x, y)) return false;
    if (w.waterDepth?.(x, y) >= BARROW.DEEP) return false;
    const p = this.game.player, feet = w.digNear?.(x, y, 1) ? w.surfaceAt(p.x, p.y) + (p.z || 0) : null;
    return feet === null || Math.abs(w.surfaceAt(x, y) - feet) <= 0.3;
  }
  push(o) {
    const g = this.game, p = g.player, w = g.world, why = this.cantPush(o);
    if (why) { this.say(why); return false; }
    const grip = this.grip, [tx, ty] = o.tile, k = `${tx},${ty}`, [cx, cy] = chunkOf(tx, ty), d = w.delta(cx, cy, true);
    const id = d.barrow?.[k]?.id || 't' + k, c = padStacks(w.chestAt(tx, ty)), l = cleanLoads(d.barrow?.[k]?.l);
    if (w.unplace({ tile: o.tile, layer: 'placed', placed: ID }) === false) { Audio.error(); return false; }
    Object.assign(p, { x: grip.x, y: grip.y, vx: 0, vy: 0, face: grip.face, dir: [grip.face.x, grip.face.y], crouch: false });
    (d.pushed ||= {})[id] = { by: me(), x: r2(p.x), y: r2(p.y), c, l, t: Math.round(w.clock || 0) };
    w.note(cx, cy);
    // (the host taking it: a guest's change of its stacks on the way, the window open or B or C paying from it, goes into the
    // record, as when a guest takes it: see arbitrate)
    if (this.decides() && g.live?.joined) this.recent.set(k, { id, k: keyOf(cx, cy), until: g.time + RECENT });
    this.rec = { id, k: keyOf(cx, cy), key: ID, confirmed: !this.guest(), since: g.time, sentAt: g.time, sx: p.x, sy: p.y, stuck: 0 };
    this.setKey(l, c);
    Audio.pickup();
    g.onSave?.();
    return true;
  }

  // ---------- pushing it ----------
  // What E does: a big thing on the ground (pointed at or, without a mouse, within 1.7 m) is loaded on it; a door opens or
  // closes; whoever you talk to, you talk to; pointing at nothing (or the ground) parks it; anything else: your hands are
  // on the wheelbarrow (it never parks by surprise)
  pushAction() {
    const g = this.game, p = g.player, sc = g.scene;
    if (g.mouse) {
      const a = g.aimed();
      if (!a) return this.parkAction();
      if (a.kind === 'placed' && BULKY[a.o.placed]) return this.loadAction(a.o);
      if (a.kind === 'door') return g.doorAction(a.tile);
      if (a.kind === 'npc' || a.kind === 'kid') return g.actionFor(a);
      return { text: t('barrow.hands_full'), run: () => this.say(t('barrow.hands_full')) };
    }
    const o = (sc.placedNear?.(p.x, p.y, 1.7) || []).find(q => BULKY[q.placed]);
    if (o) return this.loadAction(o);
    const door = sc.doorNear?.(p.x, p.y), da = door && g.doorAction(door);
    return da || this.parkAction();
  }
  parkAction() { return { text: t('barrow.park'), run: () => this.park(this.rec?.stuck > STUCK_FORCE ? 'q' : false) }; }
  loadAction(o) {
    const g = this.game, r = this.record();
    if (!r) return null;
    if (cleanLoads(r.l).length >= LOADS) return { text: t('barrow.full'), run: () => this.say(t('barrow.full')) };
    if ((this.guest() && !this.rec.confirmed) || this.waiting('load')) return { text: t('barrow.wait'), run: () => {} };
    const wait = g.carry?.notYours(o);
    if (wait) return { text: wait, run: () => this.say(wait) };
    return { text: t('barrow.load', { item: noun('item', o.placed) }), run: () => this.loadGround(o) };
  }
  // E on a log or a carcass on the ground while pushing: onto it
  loadGround(o) {
    const g = this.game, w = g.world, r = this.record(), C = g.carry;
    if (!r || !BULKY[o.placed] || g.scene !== w) return;
    if (cleanLoads(r.l).length >= LOADS) { this.say(t('barrow.full')); return; }
    if (this.guest()) {
      if (!this.rec.confirmed) { this.say(t('barrow.wait')); return; }
      if (this.hostOld()) { this.say(t('barrow.server_old')); return; }
      this.claim('load', this.rec.k, { rec: this.rec.id, tile: [...o.tile], id: o.placed }, v => { if (v && !v.ok) this.say(t('barrow.missed')); });
      return;
    }
    const why = C?.notYours(o);
    if (why) { this.say(why); return; }
    const day = this.dayAt(o.tile), cq = this.cqAt(o.tile);
    if (w.unplace(o) === false) { Audio.error(); return; }
    this.forget(o.tile);
    r.l = cleanLoads([...cleanLoads(r.l), [o.placed, this.dayFix(o.placed, day), cq]]);
    w.note(...xyOf(this.rec.k));
    this.setKey(r.l, r.c);
    Audio.pickup();
    g.onSave?.();
  }
  // With a big thing in the arms (on foot or riding), E on the parked one puts it on top
  loadParked(o) {
    const g = this.game, w = g.world, C = g.carry, id = C?.held;
    if (!id || !this.isAt(o.tile)) return;
    if (this.loadsAt(o.tile).length >= this.maxLoads(o.tile)) { this.say(t('barrow.full')); return; }
    const day = C.day ?? null, cq = C.cq;
    if (this.guest()) {
      if (this.hostOld()) { this.say(t('barrow.server_old')); return; }
      // (out of the arms now, into the request: dropping it, dying, a station or the save meanwhile do not see it twice)
      const tile = [...o.tile];
      C.set(null);
      this.claim('put', keyOf(...chunkOf(...tile)), { tile, id, day, ...(cq && { cq }) }, v => {
        if (v?.ok) { Audio.place(); g.onSave?.(); return; }
        this.say(t(v ? 'barrow.full' : 'barrow.missed'));
        this.giveBack(id, day, tile, cq);
      });
      return;
    }
    const { d, k } = this.dataAt(o.tile), B = (d.barrow ||= {})[k] ||= { id: 't' + k, l: [] }, max = this.maxLoads(o.tile);
    B.l = cleanLoads([...cleanLoads(B.l, max), [id, day, cq]], max);
    C.set(null);
    w.touch(...chunkOf(...o.tile));
    Audio.place();
    g.onSave?.();
  }
  // The window's «Take» (ui/chest.js): the big thing i of a parked one, to the arms (creative or the slot inventory: its parts)
  takeLoad(tile, i) {
    const g = this.game, w = g.world, C = g.carry, l = this.loadsAt(tile), it = l[i];
    if (!it || !this.isAt(tile)) return;
    if (C?.held || this.rec) { this.say(t(this.rec ? 'barrow.hands_full' : 'carry.hands_full')); return; }
    const give = (id, day, cq = it[2]) => { if (C.bigNow) C.set(id, this.dayFix(id, day), cq); else C.giveParts(id, cleanCq(cq)); Audio.pickup(); g.onSave?.(); };
    if (this.guest()) {
      if (this.waiting('take')) return;
      if (this.hostOld()) { this.say(t('barrow.server_old')); return; }
      this.claim('take', keyOf(...chunkOf(...tile)), { tile: [...tile], i, id: it[0] }, v => { if (!v) return; if (v.ok) { if (C.held || this.rec) this.dropNear(v.id || it[0], v.day ?? null, tile, it[2]); else give(v.id || it[0], v.day ?? null); } else this.say(t('barrow.missed')); });
      return;
    }
    const { d, k } = this.dataAt(tile);
    d.barrow[k].l = l.filter((_, j) => j !== i);
    w.touch(...chunkOf(...tile));
    give(it[0], it[1]);
  }
  // (a big thing that arrived for hands that are full meanwhile: on the ground beside it, never lost; with no room, its
  // parts to the backpack)
  dropNear(id, day, tile, cq = null) { this.game.carry?.toShore([id, me(), day, tile[0] + 0.5, tile[1] + 0.5, 0, cq], tile[0] + 0.5, tile[1] + 0.5, true); }
  // (a request's big thing back to whoever asked: to the arms if they are free, if not beside the wheelbarrow)
  giveBack(id, day, tile, cq = null) {
    const C = this.game.carry;
    if (!C || !BULKY[id]) return;
    if (!C.bigNow) C.giveParts(id, cq);
    else if (!C.held && !this.rec) C.set(id, day, cq);
    else this.dropNear(id, day, tile, cq);
    this.game.onSave?.();
  }
  // (playing as a guest of a game or a world server too old to answer the wheelbarrow's requests)
  hostOld() { const L = this.game.live; return !!(L?.joined && L.guest && !L.host?.barrows); }
  // Its stacks went from empty to not empty, or back (ui/chest.js, Carry.spend): the chunk is made again for the heap
  stacksChanged(tile) {
    const w = this.game.world;
    if (!w || this.game.scene !== w || !this.isAt(tile)) return;
    const o = w.placedObjectAt(...tile), full = !!w.chestAt(...tile)?.some(Boolean), m = o?.model || this.kindAt(tile) || ID;
    if (!!(parseBarrowKey(m) || parseCartKey(m))?.full !== full) w.touch(...chunkOf(...tile));
  }

  // ---------- parking ----------
  // Q (or E at nothing): where it is drawn, its centre CENTER_AHEAD in front with its heading. force: never fails (dying,
  // the spectator, a teleport, leaving the game). force 'q': Q after STUCK_FORCE stuck (a door closed on it, a wall built
  // on it): further away, but still where a normal park could go (reached from you, the village's rule), never by surprise
  park(force = false) {
    const g = this.game, p = g.player, w = g.world, rec = this.rec;
    if (!rec) return false;
    const r = this.record();
    if (!p || !r) { this.drop(); return false; }
    const f = p.face, yaw = Math.atan2(f.x, f.y), C = { x: p.x + f.x * CENTER_AHEAD, y: p.y + f.y * CENTER_AHEAD };
    const spot = g.scene !== w ? null : force === 'q' ? this.forcedSpot(C, yaw, { player: p, avoid: [p.x, p.y], strict: true }) : this.spot(C, yaw, { player: p, reach: true });
    if (!spot && force !== true) { this.say(t('barrow.no_room')); return false; }
    if (this.guest()) {
      // (a guest asks for it: whoever runs the world parks it there, or as near as it can; it shows in a moment)
      r.park = spot ? (spot.anchor ? [r2(spot.cx), r2(spot.cy), r2(spot.a)] : [spot.tile[0] + 0.5, spot.tile[1] + 0.5, r2(spot.a)]) : [r2(C.x), r2(C.y), r2(yaw)];
      r.x = r2(p.x); r.y = r2(p.y);
      w.note(...xyOf(rec.k));
      g.live?.flush?.();
    } else this.putDown(rec.id, rec.k, r, spot || this.forcedSpot(C, yaw, { player: p, avoid: [p.x, p.y] }));
    this.drop();
    if (force) hud.toast(t('barrow.parked_auto'));
    Audio.place();
    g.onSave?.();
    return true;
  }
  // Where it fits with its centre at C and heading yaw (fitFree: it snaps to walls and keeps off furniture), never behind a
  // wall or a closed door from the player (reach), in a doorway or right next to one; if not there, centred on its tile
  // and the ones ahead and to the sides, at the heading on the axes nearest to yaw. avoid: a point to keep clear (a player)
  // kind: the cart's (cart.js) is parked the same way, with its own footprint
  spot(C, yaw, { player = null, reach = false, avoid = null, kind = ID } = {}) {
    const w = this.game.world, cr = this.game.carry;
    const ok = f => !!f?.ok && !!f.anchor && (!reach || !player || !cr || cr.reached(player, f.cx, f.cy)) && this.clearOfDoors(f, kind) && !(avoid && hitsCircle(f.box, avoid[0], avoid[1], 0.35));
    if (!Number.isFinite(C.x) || !Number.isFinite(C.y)) return null;
    let f = w.fitFree(kind, C.x, C.y, yaw, 0, player);
    if (ok(f)) return f;
    const q = Math.round(yaw / Q) * Q, [ax, ay] = dirOf(q).map(Math.round), tx = Math.floor(C.x), ty = Math.floor(C.y);
    for (const [i, j] of [[0, 0], [ax, ay], [ay, -ax], [-ay, ax]]) { f = w.fitFree(kind, tx + i + 0.5, ty + j + 0.5, q, 0, player); if (ok(f)) return f; }
    return null;
  }
  clearOfDoors(f, kind = ID) {
    const w = this.game.world, [fx, fy] = dirOf(f.a);
    if (!w.doorNear) return true;
    if (kind === CART.ID) { const e = (CART.BED_Z1 - CART.BED_Z0) / 2; return !w.doorNear(f.cx, f.cy, 1.3) && !w.doorNear(f.cx + fx * e, f.cy + fy * e, 0.8) && !w.doorNear(f.cx - fx * e, f.cy - fy * e, 0.8); }
    return !w.doorNear(f.cx, f.cy, 1.05) && !w.doorNear(f.cx + fx * BARROW.WHEEL_Z, f.cy + fy * BARROW.WHEEL_Z, 0.6) && !w.doorNear(f.cx - fx * 0.7, f.cy - fy * 0.7, 0.6);
  }
  // By force: the spot above; then rings of tiles up to RING around, four headings each; the same rings skipping the
  // village's rule (the square and the path take only grass); at last, like /setblock, on the nearest land tile with
  // nothing placed (with all it holds). Never as drops: those are not saved with the world, they would be lost on closing.
  // null only in the middle of the sea (the record stays, saved, and is tried again). strict (Q, stuck): only the spot and
  // the rings with the village's rule, reached from the player (a wall built on it on purpose takes it nowhere else)
  forcedSpot(C, yaw, { player = null, avoid = null, strict = false, kind = ID } = {}) {
    const w = this.game.world, cr = this.game.carry;
    if (!Number.isFinite(C.x) || !Number.isFinite(C.y)) return null;
    let s = this.spot(C, yaw, { player, reach: !!player, avoid, kind });
    if (s) return s;
    const tx0 = Math.floor(C.x), ty0 = Math.floor(C.y), q0 = ((Math.round(yaw / Q) % 4) + 4) % 4;
    const ring = () => {
      for (let r = 0; r <= RING; r++) for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
        for (let k = 0; k < 4; k++) {
          const f = w.fitFree(kind, tx0 + i + 0.5, ty0 + j + 0.5, ((q0 + k) % 4) * Q, 0, null);
          if (f?.ok && f.anchor && this.clearOfDoors(f, kind) && !(avoid && hitsCircle(f.box, avoid[0], avoid[1], 0.35)) && (!strict || !player || !cr || cr.reached(player, f.cx, f.cy))) return f;
        }
      }
      return null;
    };
    if ((s = ring()) || strict) return s;
    const was = w.buildAnywhere;
    try { w.buildAnywhere = true; s = ring(); } finally { w.buildAnywhere = was; }
    if (s) return s;
    for (let r = 0; r <= SET_RING; r++) for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
      const x = tx0 + i, y = ty0 + j;
      if (inPlanet(x + 0.5, y + 0.5) && !w.water(x + 0.5, y + 0.5) && !w.at('placed', x, y) && !w.wellAt?.(x + 0.5, y + 0.5) && !(avoid && Math.hypot(x + 0.5 - avoid[0], y + 0.5 - avoid[1]) < 0.6)) return { tile: [x, y], a: q0 * Q };
    }
    return null;
  }
  // (whoever decides) Put a record down at a spot (fitFree's, or the last resort's { tile, a }): its chest, its id and its
  // big things go with it, and the record goes. false: no spot (the record stays)
  putDown(id, k, r, spot) {
    const w = this.game.world, kind = kindOfRec(r);
    if (!spot) { this.noRoom(id); return false; }
    let tile, at;
    if (spot.anchor) { w.placeFree(kind, spot, false); tile = spot.anchor; at = [spot.ox, spot.oy, spot.a]; }
    else { tile = spot.tile; at = [tile[0] + 0.5, tile[1] + 0.5, spot.a]; w.place(tile[0], tile[1], kind, Math.round(spot.a / Q) % 4); (w.delta(...chunkOf(...tile), true).pos ||= {})[`placed:${tile[0]},${tile[1]}`] = [tile[0] + 0.5, tile[1] + 0.5, r3(spot.a)]; }
    const [tx, ty] = tile, kk = `${tx},${ty}`, d = w.delta(...chunkOf(tx, ty), true);
    d.chest[kk] = stacksAt(kind, r.c);
    (d.barrow ||= {})[kk] = { id, l: loadsFor(kind, r.l), ...(kind === CART.ID && r.o && { o: r.o }), ...(kind === CART.ID && typeof r.h === 'string' && { h: r.h }) };
    if (kind === CART.ID) try { this.game.cart?.onPutDown(r, tile, ...at); } catch (e) { reportFault(e, 'Cart.onPutDown'); }
    const dr = w.deltas.get(k);
    if (dr?.pushed) delete dr.pushed[id];
    w.touch(...chunkOf(tx, ty));
    const [rcx, rcy] = xyOf(k);
    w.touch(rcx, rcy);
    this.idle.delete(id); this.failedAt.delete(id);
    return true;
  }
  noRoom(id) {
    this.failedAt.set(id, this.game.time);
    if (!this.warned) { this.warned = true; reportFault(new Error(`wheelbarrow ${id}: no room to park it`), 'Barrow.park'); }
  }
  // (whoever decides) Park a record by force: at (x, y, heading), at where it asked to be parked, or where it went
  parkRecord(id, k, at = null, avoid = null) {
    const w = this.game.world, r = w.deltas.get(k)?.pushed?.[id];
    if (!r) return false;
    const P = Array.isArray(at) ? at : Array.isArray(r.park) ? r.park : [r.x, r.y, 0], kind = kindOfRec(r);
    if (this.rec?.id === id) this.drop();
    if (kind === CART.ID && this.game.cart?.rec?.id === id) this.game.cart.drop();
    // (a cart: anywhere a horse can be, the paths and the square too, as cart.js spot; its record's x, y is its axle)
    if (kind === CART.ID) { const w = this.game.world, was = w.buildAnywhere; try { w.buildAnywhere = true; return this.putDown(id, k, r, this.forcedSpot({ x: +P[0], y: +P[1] }, +P[2] || 0, { avoid, kind })); } finally { w.buildAnywhere = was; } }
    return this.putDown(id, k, r, this.forcedSpot({ x: +P[0], y: +P[1] }, +P[2] || 0, { avoid }));
  }
  // (whoever decides, the first update) This player's records from before (the game was closed while pushing it): parked
  // where it went. Not at reset: playing together, the game starts before joining, and a change then would never be sent
  parkOwn() {
    const g = this.game, w = g.world, p = g.player, mine = me();
    // (not a cart whose horse this player still rides: cart.js resume goes on driving it)
    for (const [k, d] of w.deltas) for (const [id, r] of Object.entries(d?.pushed || {})) if (r?.by === mine && this.rec?.id !== id && !(r.k === CART.ID && p?.mount && r.h === p.horseId && !g.cart?.off)) this.parkRecord(id, k, [r.x, r.y, 0], p ? [p.x, p.y] : null);
  }

  // ---------- each step ----------
  update(dt) {
    const g = this.game, p = g.player, w = g.world;
    if (!w) return;
    if (!this.started) { this.started = true; if (this.decides()) this.parkOwn(); }
    // (a guest's requests: answered in the world, also by an answer that went by unseen or by this game's own sweep once it
    // decides; gone from the world unanswered, they never reached whoever decides. Unanswered, they wait)
    for (const [n, c] of this.pending) {
      if (g.time - c.at < 0.5) continue;
      const v = w.deltas.get(c.k)?.claim?.[n];
      if (isMap(v) && v.ok !== undefined) this.settle(n, v);
      else if (!v && g.time - c.at > CONFIRM_WAIT) this.settle(n, null);
    }
    const rec = this.rec;
    if (!rec) return;
    // (belt and braces: what may not be done pushing it, if some other way led there)
    if (!p || g.scene !== w || p.mount || p.boat || p.aboard || p.swim || p.pose || g.gamemode === 'spectator') { this.park(true); return; }
    const r = this.record();
    if (!r || (r.by !== me())) { this.drop(); if (r) this.taken(r.by); return; }
    if (this.guest() && !rec.confirmed && g.time - rec.since > CONFIRM_WAIT) { this.drop(); this.say(t('barrow.taken_anon')); return; }
    rec.stuck = p.pushPen > 0.02 ? rec.stuck + dt : 0;
    if (g.time - rec.sentAt >= SEND_EVERY && Math.hypot(p.x - rec.sx, p.y - rec.sy) >= SEND_MOVED) {
      rec.sentAt = g.time; rec.sx = p.x; rec.sy = p.y; r.x = r2(p.x); r.y = r2(p.y);
      w.note(...xyOf(rec.k));
    }
  }
  // Saving while pushing it: where it goes (the player's save has nothing of it)
  save() {
    const p = this.game.player, r = this.record();
    if (!r || !p || !this.decides()) return;
    r.x = r2(p.x); r.y = r2(p.y);
    this.game.world.note(...xyOf(this.rec.k));
  }
  hint() {
    const g = this.game, p = g.player, sc = g.scene;
    if (!this.rec || g.build?.on || !p) return '';
    if (sc?.waterDepth && [WHEEL_TIP, WHEEL_TIP + 0.6].some(d => sc.waterDepth(p.x + p.face.x * d, p.y + p.face.y * d) >= BARROW.DEEP)) return { text: t('barrow.no_water'), key: '' };
    return { text: t('barrow.park'), key: 'Q' };
  }
  stuckFor() { return this.rec?.stuck || 0; }
  onMode(gm) { if (this.rec && gm === 'spectator') this.park(true); }
  onDeath() { if (this.rec) this.park(true); }
  onEnd() { if (this.rec) this.park(true); }
  taken(by) {
    const name = by && by !== me() ? this.game.live?.nameOf?.(by) : null;
    this.say(name ? t('barrow.taken', { name }) : t('barrow.taken_anon'));
  }

  // ---------- requests (a guest) ----------
  claim(kind, k, data, done) {
    const w = this.game.world, n = randomId(), [cx, cy] = xyOf(k), d = w.delta(cx, cy, true);
    (d.claim ||= {})[n] = { by: me(), k: kind, ...data, at: Math.round((w.clock || 0) * 10) / 10 };
    w.note(cx, cy);
    this.pending.set(n, { k, kind, tile: data.tile, i: data.i, at: this.game.time, done });
    this.game.live?.flush?.();
    return n;
  }
  // (a request answered: v, or null if it never reached whoever decides)
  settle(n, v) {
    const P = this.pending.get(n);
    if (!P) return;
    this.pending.delete(n);
    try { P.done?.(v); } catch (e) { reportFault(e, 'Barrow.claim'); }
  }
  waiting(kind, tile = null, i = null) {
    for (const c of this.pending.values()) if (c.kind === kind && (!tile || String(c.tile) === String(tile)) && (i === null || c.i === i)) return true;
    return false;
  }
  // (a guest) What the host applied, also its own changes coming back: is the pushed one still this player's? A request answered
  onHostOps(k, ops) {
    const mine = me();
    for (const [f, c, v] of ops) {
      if (f === 'pushed' && this.rec && this.rec.k === k && (c === this.rec.id || c === null || c === undefined)) {
        const r = c === this.rec.id ? v : isMap(v) ? v[this.rec.id] : undefined;
        if (isMap(r) && r.by === mine) { this.rec.confirmed = true; this.setKey(r.l, r.c); }
        else { const by = isMap(r) ? r.by : null; this.drop(); this.taken(by); }
      }
      if (f === 'claim' && typeof c === 'string' && this.pending.has(c) && isMap(v) && v.ok !== undefined) this.settle(c, v);
    }
  }

  // ---------- deciding the world ----------
  // live.js, with a guest's changes of chunk k: see arbitrate above
  arbitrate(peer, k, ops, edit = true) {
    const w = this.game.world;
    return arbitrate(w, peer, k, ops, { edit, recent: this.recent, now: this.game.time, clock: w.clock || 0, ours: (o, by) => this.game.cart ? this.game.cart.ours(o, by) : true });
  }
  // And once they are applied: late stacks into their records, the parkings asked for, the requests in order
  afterArbitrate(k, A, peer) {
    const w = this.game.world;
    for (const { id, k: rk, v } of A.late) { const r = w.deltas.get(rk)?.pushed?.[id]; if (r) { r.c = padStacks(v); w.note(...xyOf(rk)); if (this.rec?.id === id) this.setKey(r.l, r.c); } }
    for (const id of A.park) this.parkRecord(id, k, null, Array.isArray(peer?.at) ? peer.at : null);
    for (const n of A.claims) this.resolve(k, n);
  }
  // A request, answered by whoever decides (the first one that arrives wins): it does the change and writes ok
  resolve(k, n) {
    const g = this.game, w = g.world, [cx, cy] = xyOf(k), d = w.deltas.get(k), c = d?.claim?.[n];
    if (!c || c.ok !== undefined) return;
    let ok = false;
    const extra = {};
    try {
      if (c.k === 'load') {
        const R = this.findRecord(c.rec, k), tile = Array.isArray(c.tile) ? c.tile.map(Number) : null;
        const raw = tile && w.ownAt('placed', tile[0], tile[1]);
        if (R && R.r.by === c.by && cleanLoads(R.r.l).length < LOADS && raw && raw.split('@')[0] === c.id && BULKY[c.id] && !g.carry?.reservedFor(tile, c.by)) {
          const day = this.dayAt(tile), cq = this.cqAt(tile);
          if (w.unplace({ tile, layer: 'placed', placed: c.id }) !== false) {
            this.forget(tile);
            R.r.l = cleanLoads([...cleanLoads(R.r.l), [c.id, this.dayFix(c.id, day), cq]]);
            w.note(...xyOf(R.k));
            ok = true;
          }
        }
      } else if (c.k === 'take' || c.k === 'put') {
        const tile = Array.isArray(c.tile) ? c.tile.map(Number) : null;
        if (tile && this.isAt(tile)) {
          const { d: dt, k: kt } = this.dataAt(tile), B = ((dt.barrow ||= {})[kt] ||= { id: 't' + kt, l: [] }), max = this.maxLoads(tile), l = cleanLoads(B.l, max);
          if (c.k === 'take' && l[c.i]?.[0] === c.id) { extra.id = l[c.i][0]; extra.day = l[c.i][1]; B.l = l.filter((_, j) => j !== c.i); ok = true; }
          if (c.k === 'put' && l.length < max && BULKY[c.id]) { B.l = cleanLoads([...l, [c.id, Number.isFinite(c.day) ? c.day : null, c.cq]], max); ok = true; }
          if (ok) w.touch(...chunkOf(...tile));
        }
      } else if (c.k === 'boat') {
        const L = d.boatLoad?.[c.boat];
        if (Array.isArray(L) && L[5] === c.n && (c.to !== 'arms' || L[1] === c.by)) {
          delete d.boatLoad[c.boat];
          extra.id = L[0]; extra.day = L[2] ?? null;
          // (on the shore near the boat; with no land near, out at sea, its parts to whoever asked, as alone: never drops at sea)
          if (c.to !== 'arms' && !g.carry?.toLand(L, L[3], L[4])) extra.parts = 1;
          w.touch(cx, cy);
          ok = true;
        }
      } else if (typeof c.k === 'string' && Object.prototype.hasOwnProperty.call(CLAIMS, c.k)) ok = !!CLAIMS[c.k](g, c, d, k, extra);   // (other systems' requests: claims.js, e.g. dive.js)
    } catch (e) { reportFault(e, 'Barrow.resolve'); ok = false; }
    d.claim[n] = { ...c, ok, ...extra, at: Math.round((w.clock || 0) * 10) / 10 };
    w.note(cx, cy);
  }
  findRecord(id, k) {
    const w = this.game.world, here = w.deltas.get(k)?.pushed?.[id];
    if (here) return { r: here, k };
    for (const [kk, d] of w.deltas) if (d?.pushed?.[id]) return { r: d.pushed[id], k: kk };
    return null;
  }
  // A player gone (bye, cut off, out to the menu, or into a cave): their records parked now where they were
  peerGone(id, at = null) {
    if (!id || !this.decides()) return;
    const w = this.game.world;
    if (!w) return;
    for (const [k, d] of w.deltas) for (const [rid, r] of Object.entries(d?.pushed || {})) if (r?.by === id) this.parkRecord(rid, k, Array.isArray(at) ? [at[0], at[1], 0] : null, Array.isArray(at) ? at : null);
  }
  // Every 2 s, in the game that decides the world (Carry.rot: the chunks with something of the wheelbarrow or of a boat's
  // big thing): the carcasses on parked ones rot, the records nobody pushes any more are parked, a boat's big thing left
  // without its boat goes to the shore, old requests go and unanswered ones are answered, and the big things of a tile that
  // is no longer a wheelbarrow (/setblock) go to the ground
  sweep(keys) {
    const g = this.game, w = g.world, L = g.live, now = g.time, clock = w.clock || 0, today = g.carry?.today?.() ?? 0;
    for (const [tp, R] of this.recent) if (!(R.until > now)) this.recent.delete(tp);
    // (who is pushing now, by the network: their newest record is alive)
    const pushers = new Set();
    if (L?.joined) for (const peer of L.peers.values()) if (peer.playing && peer.sc === 'world' && (peer.entity?.pushing || peer.entity?.driving) && peer.id) pushers.add(peer.id);
    const newest = new Map(), seen = new Set();
    for (const k of keys) for (const [id, r] of Object.entries(w.deltas.get(k)?.pushed || {})) { seen.add(id); if (r && (!newest.has(r.by) || (r.t || 0) > newest.get(r.by).t)) newest.set(r.by, { id, t: r.t || 0 }); }
    for (const id of this.idle.keys()) if (!seen.has(id)) this.idle.delete(id);
    for (const id of this.failedAt.keys()) if (!seen.has(id)) this.failedAt.delete(id);
    for (const k of keys) {
      const d = w.deltas.get(k);
      if (!d) continue;
      const [cx, cy] = xyOf(k);
      let touched = false;
      // (a) the carcasses on a parked one: bones into its stacks (what does not fit, on the ground beside it)
      for (const [tp, B] of Object.entries(d.barrow || {})) {
        const [tx, ty] = xyOf(tp);
        if (!isVehicle(d.placed?.[tp])) {
          // (e) its tile is something else now: its big things to the ground near it
          for (const [id, day, cq] of cleanLoads(B?.l, CART.LOADS)) g.carry?.toShore([id, null, day, tx + 0.5, ty + 0.5, 0, cq], tx + 0.5, ty + 0.5, false);
          delete d.barrow[tp]; touched = true;
          continue;
        }
        const kind = vehicleOf(d.placed[tp]), l = loadsFor(kind, B?.l), keep = l.filter(([id, day]) => !(BULKY[id].prey && Number.isFinite(day) && today - g.carry.dayOf(day) >= CARCASS_DAYS));
        if (keep.length === l.length) continue;
        B.l = keep; touched = true;
        const chest = d.chest[tp] ||= stacksAt(kind, null);
        const lost = l.filter(e => !keep.includes(e)).reduce((n, e) => n + (e[2]?.[3] || 0), 0);   // (the arrows that were in them)
        for (let i = 0; i < lost; i++) if (!addTo(chest, 'flecha', 1)) g.gather?.addDrop({ id: 'flecha', x: tx + 0.5, y: ty + 0.5, z: 4, vz: 30, t: 0, scene: w });
        for (let i = 0; i < l.length - keep.length; i++) { const n = 1 + (Math.random() < 0.5 ? 1 : 0); if (!addTo(chest, 'hueso', n)) g.carry?.bones(tx, ty, w); }
      }
      // (b) records: alive only if they are this game's own, or their pusher is here and says they push (their newest one)
      for (const [id, r] of Object.entries(d.pushed || {})) {
        if (!isMap(r)) { delete d.pushed[id]; touched = true; continue; }
        const own = (this.rec?.id === id || g.cart?.rec?.id === id) && r.by === me(), alive = own || (pushers.has(r.by) && newest.get(r.by)?.id === id);
        if (alive && !Array.isArray(r.park)) { this.idle.delete(id); continue; }
        if (this.failedAt.has(id) && now - this.failedAt.get(id) < RETRY) continue;
        if (!this.idle.has(id)) this.idle.set(id, now);
        if (Array.isArray(r.park) || now - this.idle.get(id) >= GRACE) this.parkRecord(id, k);
      }
      // (c) a boat's big thing without its boat (an older game took the boat, or another was moored there since): to the shore
      for (const [bid, Ld] of Object.entries(d.boatLoad || {})) {
        if (Array.isArray(Ld) && d.boats?.[bid]?.[3] === Ld[5] && Ld[5]) continue;
        delete d.boatLoad[bid]; touched = true;
        if (Array.isArray(Ld) && BULKY[Ld[0]]) g.carry?.toShore(Ld, Ld[3], Ld[4], false);
      }
      // (d) requests: unanswered ones are answered (a new host); old ones go
      for (const [n, c] of Object.entries(d.claim || {})) {
        if (!isMap(c)) { delete d.claim[n]; touched = true; continue; }
        if (c.ok === undefined && clock - (c.at || 0) < CLAIM_KEEP) { this.resolve(k, n); continue; }
        if (!(clock - (c.at || 0) < CLAIM_KEEP)) { delete d.claim[n]; w.note(cx, cy); }
      }
      if (touched) w.touch(cx, cy);
    }
  }

  // ---------- the days of a carcass, by the world's chunks (the host may be in a cave meanwhile: Carry.dayAt asks the scene) ----------
  dayAt(tile) { const d = this.game.world.delta(...chunkOf(...tile)); const v = d?.carcass?.[String(tile)]; return Number.isFinite(v) ? v : null; }
  cqAt(tile) { const d = this.game.world.delta(...chunkOf(...tile)), q = cleanCq(d?.cq?.[String(tile)]); return q && dayOfCq(q) >= (this.dayAt(tile) ?? 0) ? q : null; }
  forget(tile) {
    const w = this.game.world, d = w.delta(...chunkOf(...tile)), k = String(tile);
    if (d?.carcass) delete d.carcass[k];
    if (d?.cq) delete d.cq[k];
    if (d?.firstPick) delete d.firstPick[k];
    this.game.carry?.splits?.delete(k);
  }
  dayFix(id, day) { const C = this.game.carry; return Number.isFinite(day) ? C.dayOf(day) : BULKY[id]?.prey ? C.today() : null; }

  // ---------- doors (game.doorAction): no door closes on a wheelbarrow, also another player's ----------
  // Is a door's centre within 0.45 m of a pushed wheelbarrow's box (this player's or a remote one's)?
  onDoor(tile) {
    const g = this.game, x = tile[0] + 0.5, y = tile[1] + 0.5, box = (e, a) => { const [fx, fy] = dirOf(a); return obb(e.x + fx * CENTER_AHEAD, e.y + fy * CENTER_AHEAD, BARROW.WIDTH / 2, BARROW.LEN / 2, a); };
    const p = g.player;
    if (this.rec && p && distTo(box(p, Math.atan2(p.face.x, p.face.y)), x, y) < 0.45) return true;
    if (g.live?.joined) for (const peer of g.live.others) { const e = peer.entity; if (e?.pushing && peer.sc === 'world' && Math.hypot(e.x - x, e.y - y) < 3 && distTo(box(e, e.yaw ?? 0), x, y) < 0.45) return true; }
    return !!g.cart?.onDoor(tile);   // (nor on a cart, cart.js)
  }
}
// (where the hint looks for deep water ahead: the wheel)
const WHEEL_TIP = WHEEL_AHEAD + BARROW.WHEEL_R;
// Into a chest's stacks (bones of a rotted carcass): true if all of it fitted
function addTo(chest, id, n) {
  for (const s of chest) if (n > 0 && s?.id === id && s.n < 99) { const k = Math.min(n, 99 - s.n); s.n += k; n -= k; }
  for (let i = 0; i < chest.length && n > 0; i++) if (!chest[i]) { chest[i] = { id, n }; n = 0; }
  return n <= 0;
}
