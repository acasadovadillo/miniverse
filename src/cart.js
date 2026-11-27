// The horse cart (Plan R4-5, docs/planes/realismo/PLAN-R4-caballo.md §1.7 and §3.8). Built with B (Outdoors, at the bench;
// its plan is sold by Dani), it is a second kind of the wheelbarrow's machinery (barrow.js), not a copy:
//   - Parked, a free piece of furniture 'cart': a chest of 24 stacks (CHESTS.cart, d.chest) with up to 4 big things on its
//     bed, its owner and the horse hitched to it (d.barrow[tile] = { id, l, o, h }). The horse in its shafts stays there
//     (a.cart = the cart's id), as if tied: whoever runs the world holds it (holdHorse, from ranch.js moveHorse).
//   - Driven, a record of the world (d.pushed[id] = { by, x, y, c, l, t, k: 'cart', h, o }), never part of the player's save:
//     taking it, parking it and what a guest asks are the wheelbarrow's (barrow.js arbitrate, putDown, sweep), so whoever
//     runs the world decides who drives, and a player who goes away leaves it parked where it was, with its horse.
//   - The driver rides the horse (p.mount, so every mounted rule applies) and sits on the bench: p.driving (the model key,
//     st.ck) and p.cartPose (its axle, st.cv). horseride.js cartStep moves the horse (walk, trot, canter; S backs it up);
//     the cart follows it like a trailer (cartFollow) and its body is checked like the wheelbarrow's box (entities.js
//     cartPen): never into a house, never through a gap narrower than itself; no water over CART.DEEP, no grade over
//     CART.UP up or CART.DOWN down.
//   - One passenger beside the driver: p.aboard = the driver's id, as in a boat (crew.js seats them on the bench: seat).
//   - The couple share it (ours, as boats and horses): driving, hitching, opening it. Anyone may sit beside the driver.
//   - What it carries never weighs on the driver; above FREE_KG (DRAFT_KG for a draft horse) the horse goes slower.
// ?carro=0 (opciones.js): no cart can be built here; parked ones stay, as chests, and none is driven.
import { CART, cartKey, parseCartKey, BULKY, stackKg, randomId } from './carry-items.js';
import { padStacks, cleanLoads } from './barrow.js';
import { cartFollow, cartBehind, SPEED_CART } from './horseride.js';
import { statsOf } from './horsebreeds.js';
import { apagada } from './opciones.js';
import { CHUNK } from './world/gen.js';
import { wrapIndex, nearX } from './world/planet.js';
import { dirOf, sideOf, obb, distTo } from './world/fit.js';
import { Profile } from './accounts.js';
import { t, noun } from './i18n.js';
import { hud } from './ui/hud.js';
import { Audio } from './audio.js';
import { CLAIMS } from './claims.js';
import { reportFault } from './faults.js';

const ID = CART.ID;
const SEND_EVERY = 4, SEND_MOVED = 3;   // the record's x, y: as the wheelbarrow's
const CONFIRM_WAIT = 8;                 // (a guest) seconds to wait for the host's word on taking it
const REACH = 3.2;                      // m from the hitch (where the horse goes) to the horse that is put to it
const SEAT_REACH = 3;                   // m to the bench, to sit beside a driver
const HOLD_EVERY = 2;                   // s between two looks at a hitched horse's cart (whoever runs the world)
const SAY_EVERY = 3;
const HULL_Z = (CART.BED_Z0 + CART.BED_Z1) / 2;   // (the middle of its footprint, ahead of the axle: what fitFree centres)
const me = () => Profile.id || 'me';
const r2 = v => Math.round(v * 100) / 100;
const chunkOf = (x, y) => [Math.floor(x / CHUNK), Math.floor(y / CHUNK)];
const keyOf = (cx, cy) => `${wrapIndex(cx, CHUNK)},${cy}`;
const xyOf = k => k.split(',').map(Number);
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
export const isCart = raw => typeof raw === 'string' && raw.split('@')[0] === ID;

// What a load weighs (kg): its stacks and its big things
export const loadKg = (c, l) => (Array.isArray(c) ? c.reduce((n, s) => n + stackKg(s), 0) : 0) + cleanLoads(l, CART.LOADS).reduce((n, e) => n + (BULKY[e[0]]?.kg || 0), 0);
// The speed it is pulled at (a factor of horseride.js SPEED_CART): a horse that is not a draft one goes 15 % slower loaded
// (statsOf pull); over FREE_KG (DRAFT_KG for the draft horse) 8 % less each 100 kg; never under the walk
export function pullK(kg, stats) {
  const draft = (stats?.pull ?? 1) >= 1, free = draft ? CART.DRAFT_KG : CART.FREE_KG;
  const k = (kg >= 25 && !draft ? stats.pull : 1) * (1 - CART.SLOW_100 * Math.max(0, kg - free) / 100);
  return Math.max(SPEED_CART.walk / SPEED_CART.canter, k);
}
// Where things are on a cart whose axle is at (x, y) heading yaw: the hitch (the horse's middle), a seat (side: +1 the
// driver's, -1 the passenger's), and the ground beside a seat to get down to
export const hitchOf = (x, y, yaw) => { const [fx, fy] = dirOf(yaw); return [x + fx * CART.HITCH, y + fy * CART.HITCH]; };
export function seatOf(x, y, yaw, side = 1, out = 0) {
  const [fx, fy] = dirOf(yaw), [ux, uy] = sideOf(yaw), s = side * (CART.SEAT_X + out);
  return [x + fx * CART.SEAT_Z + ux * s, y + fy * CART.SEAT_Z + uy * s];
}

export class Cart {
  constructor(game) {
    this.game = game;
    this.off = apagada('carro');
    this.rec = null;          // the cart this player drives: { id, k (its record's chunk), key, horse, confirmed, since, sentAt, sx, sy }
    this.kg = 0; this.k = 1;  // what it carries, and the speed factor that gives (pullK)
    this.saidAt = -1e9; this.said = ''; this.started = false; this.mate = null;
    this.holdAt = new Map();  // (whoever runs the world) horse id → { t, ok, at: [x, y, yaw] }: its cart, looked at every HOLD_EVERY
  }
  get driving() { return this.rec?.key || null; }
  decides() { return this.game.barrow?.decides?.() ?? true; }
  guest() { return !!this.game.barrow?.guest?.(); }
  say(text, warn = true) {
    const g = this.game;
    if (this.said === text && g.time - this.saidAt < SAY_EVERY) return;
    this.said = text; this.saidAt = g.time;
    hud.toast(text, warn ? 'warn' : undefined);
    if (warn) Audio.error();
  }
  reset() {
    this.rec = null; this.started = false; this.holdAt.clear(); this.mate = null;
    const p = this.game.player;
    if (p) { p.driving = null; p.cartPose = null; }
  }
  // ---------- who may ----------
  // The couple's (as boats and horses): its owner, or their partner; one from before owners, anyone's
  ours(owner, pid = me()) { return !owner || owner === pid || !!this.game.social?.areCouple?.(owner, pid); }
  ownerName(owner) { return this.game.live?.nameOf?.(owner) || t('horse.someone'); }
  // A parked one's data: { d, k, B } (B its d.barrow entry, made if asked)
  dataAt(tile, make = false) {
    const w = this.game.world, [tx, ty] = tile, d = w.delta(...chunkOf(tx, ty), make), k = `${tx},${ty}`;
    if (make && d && !d.barrow?.[k]) (d.barrow ||= {})[k] = { id: 't' + k, l: [] };
    return { d, k, B: d?.barrow?.[k] || null };
  }
  isAt(tile) { return !!tile && isCart(this.game.world?.ownAt('placed', tile[0], tile[1])); }
  horse(id) { return id ? this.game.ranch?.animals.find(a => a.id === id) || null : null; }
  // The horse this player could put to it now: the one they ride, or lead by the reins; ours, grown, not hitched elsewhere
  horseAtHand() {
    const g = this.game, p = g.player, a = p?.mount ? this.horse(p.horseId) : g.horselead?.mine || null;
    return a && a.def?.ride && !g.ranch.young(a) && g.horse?.ours?.(a) !== false ? a : null;
  }

  // ---------- parked: E (the menu, or the one thing there is to do), X opens it ----------
  options(o) {
    const g = this.game, p = g.player, { B } = this.dataAt(o.tile), out = [];
    if (!B || !p) return out;
    const ours = this.ours(B.o), hitched = B.h ? this.horse(B.h) : null, [hx, hy] = hitchOf(o.x, o.y, o.yaw ?? 0);
    if (!ours) return out;
    if (hitched && !p.mount && !p.boat && !p.aboard) out.push({ k: 'drive', text: t('cart.drive'), run: () => this.drive(o) });
    if (!B.h) {
      const a = this.horseAtHand();
      if (a && Math.hypot(nearX(a.x, hx) - hx, a.y - hy) <= REACH + (p.mount ? 0.6 : 0)) out.push({ k: 'hitch', text: t('cart.hitch', { name: a.name }), run: () => this.hitch(o, a) });
    }
    if (B.h) out.push({ k: 'unhitch', text: t('cart.unhitch', { name: hitched?.name || t('horse.your') }), run: () => this.unhitch(o) });
    out.push({ k: 'open', text: t('cart.open'), run: () => this.open(o) });
    return out;
  }
  parkedAction(o) {
    const g = this.game, C = g.carry, { B } = this.dataAt(o.tile);
    if (!B) return null;
    if (!this.ours(B.o)) return { text: t('cart.not_yours', { who: this.ownerName(B.o) }), run: () => this.say(t('cart.not_yours', { who: this.ownerName(B.o) })) };
    const open = { text: t('cart.open'), run: () => this.open(o) };
    // (a big thing in the arms, on foot or riding: onto its bed, as onto the wheelbarrow)
    if (C?.held) {
      if (cleanLoads(B.l, CART.LOADS).length >= CART.LOADS) return { text: t('cart.full'), run: () => this.say(t('cart.full')), alt: open };
      if (g.barrow.waiting('put')) return { text: t('barrow.wait'), run: () => {}, alt: open };
      return { text: t('barrow.load', { item: noun('item', C.held) }), run: () => g.barrow.loadParked(o), alt: open };
    }
    if (this.off && !B.h) return { text: t('cart.open'), run: () => this.open(o) };
    const opts = this.options(o).filter(q => !this.off || q.k === 'open' || q.k === 'unhitch');
    const main = opts.find(q => q.k === 'hitch') || opts.find(q => q.k === 'drive');
    if (opts.length <= 1 || (main && opts.length === 2)) return { ...(main || opts[0] || open), alt: open };
    return { text: main ? main.text : t('cart.use'), run: () => this.menu(o, opts), alt: open };
  }
  async menu(o, opts) {
    const g = this.game;
    g.busy = true;
    let i = -1;
    try { i = await hud.ask(t('cart.title'), t('cart.menu_q'), [...opts.map(q => q.text), t('horse.nothing')]); } finally { g.busy = false; }
    if (opts[i] && this.isAt(o.tile)) opts[i].run();
  }
  // Its window: 24 stacks and the row of its big things (ui/chest.js, as the wheelbarrow's); its title says what it weighs
  open(o) {
    const g = this.game, w = g.world;
    if (!this.isAt(o.tile)) return;
    const tile = [...o.tile];
    g.onChest?.(w.chestAt(...tile), tile, null, { title: () => t('cart.load_kg', { kg: Math.round(loadKg(w.chestAt(...tile), this.dataAt(tile).B?.l)) }) });
  }
  // Why it cannot be taken from here now ('' if it can)
  cantTake(o, a) {
    const g = this.game, p = g.player, w = g.world, L = g.live;
    if (this.off) return t('cart.off');
    if (!p || g.gamemode === 'spectator' || g.scene !== w || !o?.tile || o.fixed || o.unknown || !this.isAt(o.tile)) return t('cart.cant_here');
    if (this.rec || g.barrow?.pushing) return t('carry.hands_full');
    if (p.boat || p.aboard || p.swim || p.pose) return t('carry.cant_take_here');
    if (!a) return t('cart.no_horse');
    if (a.rider && a.rider !== me()) return t('horse.whistle.ridden', { who: L?.nameOf?.(a.rider) || t('horse.someone'), name: a.name });
    if (a.cart && a.cart !== this.dataAt(o.tile).B?.id) return t('cart.hitched_elsewhere', { name: a.name });
    if (L?.joined && L.guest && !L.host?.barrows) return t('barrow.server_old');
    return '';
  }
  // Put a horse to it (ridden or led): you sit on the bench and drive
  hitch(o, a) {
    const g = this.game, p = g.player, why = this.cantTake(o, a);
    if (why) { this.say(why); return false; }
    if (g.horselead?.mine === a) g.horselead.letGo();
    if (!p.mount || p.horseId !== a.id) {
      if (p.mount) g.ranch.dismount();
      g.ranch.mount(a);
      if (!p.mount || p.horseId !== a.id) return false;
    }
    return this.take(o, a);
  }
  // On foot, a hitched one: up to the bench (you ride its horse, which stays in the shafts)
  drive(o) {
    const g = this.game, p = g.player, { B } = this.dataAt(o.tile), a = this.horse(B?.h);
    const why = this.cantTake(o, a) || (p.mount ? t('cart.get_off_first') : '');
    if (why) { this.say(why); return false; }
    g.ranch.mount(a);
    if (!p.mount || p.horseId !== a.id) return false;
    return this.take(o, a);
  }
  // It leaves its tile and becomes a record of the world (as the wheelbarrow when it is pushed); the horse goes to the
  // shafts, straight ahead of the cart, and the player is on it
  take(o, a) {
    const g = this.game, p = g.player, w = g.world, [tx, ty] = o.tile, k = `${tx},${ty}`, [cx, cy] = chunkOf(tx, ty), d = w.delta(cx, cy, true);
    const B = d.barrow?.[k] || {}, id = B.id || 't' + k, c = padStacks(w.chestAt(tx, ty), CART.STACKS), l = cleanLoads(B.l, CART.LOADS), owner = B.o;
    const yaw = o.yaw ?? 0, x = o.x, y = o.y;
    if (w.unplace({ tile: o.tile, layer: 'placed', placed: ID }) === false) { Audio.error(); return false; }
    const [fx, fy] = dirOf(yaw), [hx, hy] = hitchOf(x, y, yaw);
    (d.pushed ||= {})[id] = { by: me(), x: r2(x), y: r2(y), c, l, t: Math.round(w.clock || 0), k: ID, h: a.id, ...(owner && { o: owner }) };
    w.note(cx, cy);
    if (this.decides() && g.live?.joined) g.barrow.recent.set(k, { id, k: keyOf(cx, cy), until: g.time + 10 });
    a.cart = id; a.x = a.tx = hx; a.y = a.ty = hy;
    this.holdAt.delete(a.id);
    Object.assign(p, { x: hx, y: hy, vx: 0, vy: 0, face: { x: fx, y: fy }, dir: [fx, fy], crouch: false });
    p.ride.on = false;   // (it starts standing, facing as the cart does: entities.js riding)
    p.cartPose = { x, y, yaw, roll: 0 };
    this.rec = { id, k: keyOf(cx, cy), key: ID, horse: a.id, confirmed: !this.guest(), since: g.time, sentAt: g.time, sx: p.x, sy: p.y };
    this.setKey(l, c);
    g.carry?.syncArms();
    Audio.door?.();
    g.onSave?.();
    return true;
  }
  record() { const r = this.rec; return r ? this.game.world?.deltas.get(r.k)?.pushed?.[r.id] || null : null; }
  setKey(l, c) {
    const p = this.game.player;
    if (!this.rec) return;
    const L = cleanLoads(l, CART.LOADS);
    this.rec.key = cartKey(L.map(e => e[0]), !!c?.some?.(Boolean), 'd');
    this.kg = loadKg(c, L);
    this.k = pullK(this.kg, statsOf(this.horse(this.rec.horse)));
    if (p) p.driving = this.rec.key;
  }
  // The speed factor now (horse.js prepRide → p.ride.cartK)
  speedK() { return this.rec ? this.k : 1; }
  // Let go of it (it is parked, or it was taken from us): nothing behind the horse any more
  drop() {
    const p = this.game.player;
    this.rec = null;
    if (p) { p.driving = null; p.cartPose = null; }
  }

  // ---------- driving: E ----------
  // A door or a gate aimed at (or near, without a mouse) opens; whoever you talk to, you talk to; anything else, or nothing:
  // you get down, and the cart stays parked where it is, its horse in the shafts
  driveAction() {
    const g = this.game, p = g.player, sc = g.scene;
    const down = { text: t('cart.get_down'), run: () => this.getDown(), alt: g.horse?.action?.()?.alt || null, riding: true };
    if (g.mouse) {
      const a = g.aimed();
      if (a?.kind === 'door') return g.doorAction(a.tile) || down;
      if (a && (a.kind === 'npc' || a.kind === 'kid')) return g.actionFor(a);
      return down;
    }
    const door = sc.doorNear?.(p.x, p.y), da = door && g.doorAction(door);
    return da || down;
  }
  // Where it would be parked as it is drawn (fitFree: as near as it can), or null. Anywhere a horse can be: the paths,
  // the roads and the village's square too, not only grass
  spot(pose = this.game.player?.cartPose) {
    const B = this.game.barrow, w = this.game.world;
    if (!pose || !B) return null;
    const [fx, fy] = dirOf(pose.yaw), C = { x: pose.x + fx * HULL_Z, y: pose.y + fy * HULL_Z }, was = w.buildAnywhere;
    try { w.buildAnywhere = true; return B.spot(C, pose.yaw, { kind: ID }); } finally { w.buildAnywhere = was; }
  }
  // Getting down from the bench: the cart is parked where it is, the horse stays in its shafts (as if tied), and you are
  // beside the bench (or the other side, or by the horse). force: dying, a teleport, leaving: never fails
  getDown(force = false) {
    const g = this.game, p = g.player, w = g.world, rec = this.rec, r = this.record();
    if (!rec) return false;
    if (!p || !r) { this.drop(); return false; }
    const pose = p.cartPose || cartBehind(p.x, p.y, p.face.x, p.face.y), spot = g.scene === w ? this.spot(pose) : null;
    if (!spot && !force) { this.say(t('cart.no_room')); return false; }
    const a = this.horse(rec.horse), seated = !!p.mount;   // (not seated any more: thrown, or somewhere else; the player stays where they are)
    // (off the horse, which stays where it is: ranch.js dismount with stay)
    if (p.mount) g.ranch.dismount({ stay: true });
    if (p.mount && !force) return false;   // (it refused: a big thing in the arms over deep water)
    if (p.mount) { p.mount = false; g.ranch.leave?.(a, true); }
    const yaw = spot ? spot.a : pose.yaw, ox = spot ? (spot.anchor ? spot.ox : spot.tile[0] + 0.5) : pose.x, oy = spot ? (spot.anchor ? spot.oy : spot.tile[1] + 0.5) : pose.y;
    const free = (x, y) => !w.blocked?.(x, y) && !(w.waterDepth?.(x, y) >= 0.9) && w.reaches?.(p.x, p.y, x, y) !== false;
    const at = [seatOf(ox, oy, yaw, 1, 0.95), seatOf(ox, oy, yaw, -1, 0.95), seatOf(ox, oy, yaw, 1, 1.6)].find(([x, y]) => free(x, y));
    if (this.guest()) {
      // (a guest asks for it: whoever runs the world parks it there, with its horse, and it shows in a moment)
      r.park = spot ? (spot.anchor ? [r2(spot.cx), r2(spot.cy), r2(spot.a)] : [spot.tile[0] + 0.5, spot.tile[1] + 0.5, r2(spot.a)]) : [r2(pose.x), r2(pose.y), r2(pose.yaw)];
      r.x = r2(pose.x); r.y = r2(pose.y);
      w.note(...xyOf(rec.k));
      if (a) { const [hx, hy] = hitchOf(ox, oy, yaw); a.x = a.tx = hx; a.y = a.ty = hy; a.at = [r2(hx), r2(hy)]; }
      g.live?.flush?.();
    } else if (spot) g.barrow.putDown(rec.id, rec.k, r, spot);
    else g.barrow.parkRecord(rec.id, rec.k, [pose.x, pose.y, pose.yaw]);
    if (at && seated && g.scene === w) { p.x = at[0]; p.y = at[1]; }
    p.vx = p.vy = 0;
    this.drop();
    g.carry?.syncArms();
    if (force) hud.toast(t('cart.parked_auto'));
    Audio.place?.();
    g.onSave?.();
    return true;
  }
  // (whoever runs the world, barrow.js putDown) A cart record put down at tile: its horse, if it is still hitched, stands in
  // its shafts now
  onPutDown(r, tile, x, y, yaw) {
    const a = this.horse(r?.h);
    if (!a) return;
    if (a.cart !== undefined && a.cart !== null && a.cart !== this.dataAt(tile).B?.id) return;
    const [hx, hy] = hitchOf(x, y, yaw);
    if (a.rider && a.rider === r.by) a.rider = null;   // (its driver left it: getDown, dying, quitting)
    if (!a.rider) { a.x = a.tx = hx; a.y = a.ty = hy; a.vx = a.vy = 0; a.at = [r2(hx), r2(hy)]; }
    a.cart = this.dataAt(tile).B?.id;
    this.holdAt.delete(a.id);
  }
  // Unhitched: the horse is free (it grazes where it is, as when told to stay), and the cart rests on its shafts
  unhitch(o) {
    const g = this.game, { B } = this.dataAt(o.tile);
    if (!B?.h) return;
    if (this.guest()) { g.barrow.claim('cart_unhitch', keyOf(...chunkOf(...o.tile)), { tile: [...o.tile] }, v => { if (v && !v.ok) this.say(t('barrow.missed')); }); return; }
    unhitchAt(g, o.tile);
    Audio.door?.();
    g.onSave?.();
  }
  // Just built: it is this player's (and their partner's)
  placed(tile) {
    const w = this.game.world, { d, k, B } = this.dataAt(tile, true);
    if (!B || !isCart(d.placed?.[k])) return;
    B.o = me();
    w.touch(...chunkOf(...tile));
  }
  // Is a parked one hitched? (B › Remove and Move: unhitch it first)
  hitched(tile) { return !!this.dataAt(tile).B?.h; }

  // ---------- each step ----------
  update(dt) {
    const g = this.game, p = g.player, w = g.world;
    if (!w) return;
    this.peers();
    if (!this.started) { this.started = true; this.resume(); }
    this.passengerNote();
    const rec = this.rec;
    if (!rec) return;
    // (belt and braces: what may not be done driving it, if some other way led there: parked where it is)
    if (!p || g.scene !== w || !p.mount || p.horseId !== rec.horse || p.boat || p.aboard || p.swim || g.gamemode === 'spectator') { this.getDown(true); return; }
    const r = this.record();
    if (!r || r.by !== me()) { this.drop(); this.say(t('cart.taken')); return; }
    if (this.guest() && !rec.confirmed && g.time - rec.since > CONFIRM_WAIT) { this.drop(); this.say(t('cart.taken')); return; }
    if (g.time - rec.sentAt >= SEND_EVERY && Math.hypot(p.cartPose.x - rec.sx, p.cartPose.y - rec.sy) >= SEND_MOVED) {
      rec.sentAt = g.time; rec.sx = p.cartPose.x; rec.sy = p.cartPose.y; r.x = r2(p.cartPose.x); r.y = r2(p.cartPose.y);
      w.note(...xyOf(rec.k));
    }
    // (its sound: the tyres each half metre, harder on stone and paths; the shafts creaking in a sharp turn)
    const C = p.cartPose, rolled = Math.abs((C.roll || 0) - (rec.rollAt ?? C.roll)) * CART.WHEEL_R;
    if (rec.rollAt === undefined || rolled > 0.5) { rec.rollAt = C.roll || 0; if (rolled > 0.5) Audio.rumble?.(p.ride.ground?.kShod !== undefined, Math.min(1, 0.4 + Math.abs(p.ride.v) / 6)); }
    const bend = Math.abs(Math.atan2(Math.sin(p.ride.a - C.yaw), Math.cos(p.ride.a - C.yaw)));
    if (bend > CART.MAXH * 0.8 && Math.abs(p.ride.v) > 0.5 && g.time - (rec.creakAt || -9) > 1.6) { rec.creakAt = g.time; Audio.creak?.(); }
    // (why it does not go on: a gap narrower than the cart, or water too deep for it ahead)
    if (p.cartHit && p.ride.going) this.say(t('cart.too_narrow'), false);
    else if (p.ride.going && w.waterDepth) { const f = p.face, x = p.x + f.x * 1.4, y = p.y + f.y * 1.4; if (w.waterDepth(x, y) >= CART.DEEP && Math.abs(p.ride.v) < 0.3) this.say(t('cart.too_deep'), false); }
  }
  // (the first update) Still on the horse of a cart we drove when the game was closed: we go on driving it. barrow.js parkOwn
  // leaves that record for us; any other is parked by it
  resume() {
    const g = this.game, p = g.player, w = g.world;
    if (!p?.mount || this.off || g.scene !== w) return;
    for (const [k, d] of w.deltas) for (const [id, r] of Object.entries(d?.pushed || {})) {
      if (!isMap(r) || r.k !== ID || r.by !== me() || r.h !== p.horseId) continue;
      const a = this.horse(r.h), [fx, fy] = [p.face.x, p.face.y];
      p.cartPose = cartBehind(p.x, p.y, fx, fy);
      this.rec = { id, k, key: ID, horse: r.h, confirmed: true, since: g.time, sentAt: g.time, sx: p.x, sy: p.y };
      if (a) a.cart = id;
      this.setKey(r.l, r.c);
      return;
    }
  }
  // Its record in the world is about to be saved (the player's save has nothing of it): where it goes now
  save() {
    const p = this.game.player, r = this.record();
    if (!r || !p?.cartPose || !this.decides()) return;
    r.x = r2(p.cartPose.x); r.y = r2(p.cartPose.y);
    this.game.world.note(...xyOf(this.rec.k));
  }
  onMode(gm) { if (this.rec && gm === 'spectator') this.getDown(true); }
  onDeath() { if (this.rec) this.getDown(true); }
  onEnd() { if (this.rec) this.getDown(true); }
  // (a guest) What the host applied: is the cart still ours to drive?
  onHostOps(k, ops) {
    const rec = this.rec;
    if (!rec || rec.k !== k) return;
    for (const [f, c, v] of ops) {
      if (f !== 'pushed' || (c !== rec.id && c !== null && c !== undefined)) continue;
      const r = c === rec.id ? v : isMap(v) ? v[rec.id] : undefined;
      if (isMap(r) && r.by === me()) { rec.confirmed = true; this.setKey(r.l, r.c); }
      else { this.drop(); this.say(t('cart.taken')); }
    }
  }
  // The other players' carts: where each one is, from where their horse is (the same trailer as here, so it does not jump
  // between their messages), put right by their st.cv when it has gone apart
  peers() {
    const L = this.game.live;
    if (!L?.joined) return;
    for (const peer of L.others) {
      const e = peer.entity;
      if (!e) continue;
      if (!e.driving) { e.cartPose = null; continue; }
      const cv = e.cv, yaw = e.yaw ?? 0;
      if (!e.cartPose) e.cartPose = cv ? { x: cv[0], y: cv[1], yaw: cv[2], roll: 0 } : cartBehind(e.x, e.y, Math.sin(yaw), Math.cos(yaw));
      else cartFollow(e.cartPose, e.x, e.y);
      if (cv && Math.hypot(nearX(cv[0], e.cartPose.x) - e.cartPose.x, cv[1] - e.cartPose.y) > 2) Object.assign(e.cartPose, { x: cv[0], y: cv[1], yaw: cv[2] });
    }
  }
  // Is a door's centre within 0.45 m of a driven cart's body (this player's or another's)? (no door closes on it: game.js)
  onDoor(tile) {
    const g = this.game, x = tile[0] + 0.5, y = tile[1] + 0.5, box = C => { const [fx, fy] = dirOf(C.yaw); return obb(C.x + fx * HULL_Z, C.y + fy * HULL_Z, CART.HUB, (CART.BED_Z1 - CART.BED_Z0) / 2 + 0.6, C.yaw); };
    const p = g.player;
    if (p?.cartPose && distTo(box(p.cartPose), x, y) < 0.45) return true;
    if (g.live?.joined) for (const peer of g.live.others) { const C = peer.entity?.cartPose; if (C && peer.sc === 'world' && Math.hypot(C.x - x, C.y - y) < 4 && distTo(box(C), x, y) < 0.45) return true; }
    return false;
  }

  // ---------- the hitched horse (whoever runs the world: ranch.js moveHorse) ----------
  // It stays in its cart's shafts: true while it is hitched (then it does not graze nor go home); a link whose cart is
  // gone, or is far from it (a game closed in the saddle), is undone (on the cart too)
  holdHorse(a) {
    const g = this.game, w = g.world;
    if (!a.cart || a.rider) return false;
    let H = this.holdAt.get(a.id);
    if (!H || g.time - H.t > HOLD_EVERY) {
      H = { t: g.time, ok: false, at: null };
      const found = findCart(w, a.cart, a.at || [a.x, a.y]);
      if (found?.parked && found.B.h === a.id) {
        const o = w.placedObjectAt?.(...found.tile), yaw = o?.yaw ?? 0, x = o?.x ?? found.tile[0] + 0.5, y = o?.y ?? found.tile[1] + 0.5, [hx, hy] = hitchOf(x, y, yaw);
        if (Math.hypot(nearX(a.x, hx) - hx, a.y - hy) < 4) H = { t: g.time, ok: true, at: [hx, hy, yaw] };
        else { delete found.B.h; w.touch(...chunkOf(...found.tile)); }
      } else if (found && !found.parked && found.r.h === a.id) H = { t: g.time, ok: true, at: null };   // (driven: its driver moves it)
      this.holdAt.set(a.id, H);
      if (!H.ok) { delete a.cart; this.holdAt.delete(a.id); return false; }
    }
    if (H.at) {
      a.x = a.tx = H.at[0]; a.y = a.ty = H.at[1]; a.vx = a.vy = 0;
      a.dir = [Math.sin(H.at[2]), Math.cos(H.at[2])];
      a.at = [r2(H.at[0]), r2(H.at[1])];
    }
    return true;
  }

  // ---------- the passenger (crew.js: p.aboard is the driver's id) ----------
  // Where a passenger sits on a driver's bench (d: the driver's entity, here or another player's)
  seat(e, d) {
    const C = d.cartPose;
    if (!C) return false;
    const [x, y] = seatOf(nearX(C.x, e.x), C.y, C.yaw, -1), sx = Math.sin(C.yaw), sy = Math.cos(C.yaw);
    e.x = x; e.y = y; e.cartSeat = true;
    if (e.remote) { e.yaw = C.yaw; e.to = [x, y, 0]; }
    else { e.faceTo(sx, sy); e.face = { x: sx, y: sy }; e.vx = e.vy = 0; }
    return true;
  }
  // On foot near another player's cart: sit beside them (one passenger)
  canSit(p, scene) { const g = this.game; return !this.off && scene === g.world && g.live?.joined && !p.boat && !p.mount && !p.aboard && !p.inside && !p.swim && !this.rec; }
  sitAction(peer) {
    const g = this.game, who = peer.name;
    if (g.live.others.some(q => q.entity?.aboard === peer.id) ) return { text: t('cart.seat_full', { who }), run: () => this.say(t('cart.seat_full', { who })) };
    return { text: g.carry?.dropFirst() || t('cart.seat', { who }), run: () => this.sit(peer) };
  }
  sit(peer) {
    const g = this.game, p = g.player;
    if (g.carry?.refuse()) return;
    Object.assign(p, { aboard: peer.id, vx: 0, vy: 0, z: 0, vz: 0, crouch: false, wading: false });
    if (peer.entity) this.seat(p, peer.entity);
    Audio.door?.();
  }
  aimables(p, scene, box) {
    if (!this.canSit(p, scene)) return null;
    const out = [];
    for (const peer of this.game.live.others) {
      const C = peer.entity?.cartPose;
      if (!C || !peer.entity.driving || peer.sc !== 'world') continue;
      const [x, y] = seatOf(nearX(C.x, p.x), C.y, C.yaw, -1);
      if (Math.hypot(x - p.x, y - p.y) > SEAT_REACH + 2) continue;
      out.push({ kind: 'sys', e: peer.entity, box: box(x, y, 0.45, 0.45, 0.4, 1.3), act: () => this.sitAction(peer) });
    }
    return out.length ? out : null;
  }
  interact(p, scene) {
    if (!this.canSit(p, scene)) return null;
    for (const peer of this.game.live.others) {
      const C = peer.entity?.cartPose;
      if (!C || !peer.entity.driving || peer.sc !== 'world') continue;
      const [x, y] = seatOf(nearX(C.x, p.x), C.y, C.yaw, -1);
      if (Math.hypot(x - p.x, y - p.y) <= SEAT_REACH) return this.sitAction(peer);
    }
    return null;
  }
  // (the driver) Someone sat down beside you, or got down
  passengerNote() {
    const g = this.game;
    if (!this.rec || !g.live?.joined) { this.mate = null; return; }
    const q = g.live.others.find(o => o.entity?.aboard === Profile.id);
    const name = q ? q.name : null;
    if (name !== this.mate) { if (name) { hud.toast(t('cart.mate_on', { name })); Audio.door?.(); } this.mate = name; }
  }
  // HUD hint while driving (the GTA-style one shows it on its own: smarthud.js)
  hint() {
    if (!this.rec || this.game.build?.on) return '';
    return { text: t('cart.get_down'), key: 'E' };
  }
}

// ---------- pure helpers (the tests call them) ----------
// A cart by its id near a point: { parked, tile, B, d, k } or { parked: false, r, k } (its record), or null. near: where to
// look first (the chunks around it), then everywhere
export function findCart(w, id, near = null) {
  if (!id || !w) return null;
  const look = (k, d) => {
    if (d?.pushed?.[id]) return { parked: false, r: d.pushed[id], k };
    for (const [tp, B] of Object.entries(d?.barrow || {})) if (B?.id === id && isCart(d.placed?.[tp])) return { parked: true, tile: xyOf(tp), B, d, k };
    return null;
  };
  if (Array.isArray(near) && Number.isFinite(near[0]) && Number.isFinite(near[1])) {
    const [cx, cy] = chunkOf(near[0], near[1]);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const k = keyOf(cx + i, cy + j), f = look(k, w.deltas.get(k)); if (f) return f; }
  }
  for (const [k, d] of w.deltas) { const f = look(k, d); if (f) return f; }
  return null;
}
// (whoever runs the world) Unhitch the cart at tile: its horse is free where it stands
export function unhitchAt(g, tile) {
  const w = g.world, [tx, ty] = tile, k = `${tx},${ty}`, d = w.delta(...chunkOf(tx, ty));
  const B = d?.barrow?.[k];
  if (!B?.h || !isCart(d.placed?.[k])) return false;
  const a = g.ranch?.animals.find(q => q.id === B.h);
  delete B.h;
  if (a && a.cart === B.id) {
    delete a.cart;
    a.at = [r2(a.x), r2(a.y)];
    a.stay = true;   // (it stays where it is, grazing round it, as when it is told to: ranch.js)
    g.cart?.holdAt.delete(a.id);
  }
  w.touch(...chunkOf(tx, ty));
  return true;
}
// A guest's «Unhitch» (claims.js): only the couple's, only a hitched one
CLAIMS.cart_unhitch = (g, c) => {
  const tile = Array.isArray(c.tile) ? c.tile.map(Number) : null;
  if (!tile || !tile.every(Number.isFinite)) return false;
  const w = g.world, d = w.delta(...chunkOf(...tile)), B = d?.barrow?.[`${tile[0]},${tile[1]}`];
  if (!B || !g.cart?.ours(B.o, c.by)) return false;
  return unhitchAt(g, tile);
};
