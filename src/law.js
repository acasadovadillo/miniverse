// The law (docs/planes/gta/PLAN-H-pueblo-vivo.md §4): what is a crime and who sees it, what each player owes, and Ramiro, the
// constable, who comes with the village project 'law_office' (board.js). Until it is built there is no law. The numbers: lawrules.js
//
// Crimes: taking something from a neighbour's house seen by somebody (reputation.js taken), taking something from a stall with nobody
// at it, seen by somebody (takeFrom, here), getting away from Ramiro and, only with ?shove=1, shoving somebody (social.js). Never what
// is yours or was put back, never against another player, a child or an animal, and never in creative, as a spectator, in peaceful,
// with /gamerule doLaw false or with ?law=0.
//
// The record of each player (v[id]) is the world's, one element each in the shared collection 'law' (livesync.js, hostOnly): only
// whoever decides writes it. Each game says only its own crimes ('crime'), and asks for what it wants to do about them ('lawdo': pay,
// serve, later, bail), which is answered ('lawok'); the money goes when the answer comes, so a lost message never costs anything.
//
// Ramiro: his day is his routine (routines.js). Whoever decides looks round for him ten times a second (constable) and, while he is
// after somebody, moves him (drive, instead of neighbors.js) and sends where he is four times a second ('law'). He never hurts
// anybody, never goes under a player's roof, and does not take anyone riding, in a boat, asleep or in a talk.
//
// The cell: 1 to 5 real minutes (until is real time, so being away counts). Whoever is in it is kept inside (leash), cannot build,
// sprint or use the wheel, and comes out at the door. Nothing of theirs is ever taken.
import { LAW_OFFICE, STALL, BOUNDS, WALK_NODES, hasBuilding, inOwnHouse, inLawOffice, onVillageChange } from './world/village.js';
import { lawOfficePlan } from './world/blueprints.js';
import { CHUNK } from './world/gen.js';
import { distOf, nearX, dxOf } from './world/planet.js';
import { wayTo } from './world/walkways.js';
import { collide } from './physics.js';
import { PIECES, parsePlaced } from './pieces.js';
import { ITEMS, itemNoun } from './items.js';
import { priceOf } from './economy.js';
import { PEOPLE } from './neighbors.js';   // (a cycle, read only inside functions)
import { nodesBetween } from './routines.js';
import { talkOptions } from './talk.js';
import { areCouple } from './social.js';
import { CLAIMS } from './claims.js';
import { madridMs } from './time.js';
import { ihash } from './util.js';
import { Profile } from './accounts.js';
import { Audio } from './audio.js';
import { reportFault } from './faults.js';
import { hud } from './ui/hud.js';
import { t, tList, formatMessage } from './i18n.js';
import { apagada } from './opciones.js';
import { FINES, REPORTED, WANTED, BOUNTY_MAX, CRIMES_KEPT, SIGHT, SPEEDS, levelOf, fineOf, minsOf, surrendered, evadeOf, decayed, cleanRecord, cleanName } from './lawrules.js';

const OFF = apagada('law');         // (?law=0: this game says nothing of its own crimes and shows no chip)
export const RAMIRO = 'ramiro';
// (the law office's plan where it stands in this world: villagesites.js; laid out again whenever the village changes)
export const OFFICE = {};
const C = {};
const placeOffice = () => { const P = lawOfficePlan(LAW_OFFICE); for (const k of Object.keys(OFFICE)) delete OFFICE[k]; Object.assign(OFFICE, P); Object.assign(C, P.cell); };
placeOffice();
onVillageChange(placeOffice);
const DAY = 864e5, THINK = 0.1, LOOK = 0.5, SEND = 0.25;
const CATCH_R = 1.1, CATCH_S = 1, LOST_S = 20, CHASE_S = 90, OUT_R = 40, ASK_R = 1.7, ASK_FAR = 10;
const HOLD_S = 40, ASK_S = 35, ANSWER_S = 30, REST_S = 60, ASK_AGAIN = 15 * 60, LATER_AGAIN = 30 * 60, MIN_CHASE = 6;   // s
const REMOTE_S = 1.5, SNAP = 8, RETURN_S = 60, WAY_S = 0.5, CRIME_GAP = 0.9, LEASH_S = 0.25, SEC = 1;
const STALL_R = 2.6, NEAR_R = 3, SAY_R = 24;
const me = () => Profile.id || 'me';
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => isMap(o) && Object.prototype.hasOwnProperty.call(o, k);
const r2 = v => Math.round(v * 100) / 100;
const any = list => list[Math.floor(Math.random() * list.length)] || '';
const chunkOf = (x, y) => `${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)}`;
// Is that collider near enough to be bumped into for a while?
const near = (c, x, y) => (c.r !== undefined ? Math.hypot(c.x - x, c.y - y) < c.r + 4 : c.x0 === undefined || (x > c.x0 - 4 && x < c.x1 + 4 && y > c.y0 - 4 && y < c.y1 + 4));
const inRect = (x, y, m = 0) => x > C.x0 - m && x < C.x1 + m && y > C.y0 - m && y < C.y1 + m;
// The stalls: where they are, whose, and what there is on them (one thing a day each, with nobody at it)
export const STALLS = {
  rosa: { x: STALL.x0 + 1, y: STALL.y0 + 0.5, owner: 'rosa', goods: ['tomate', 'zanahoria', 'manzana', 'nabo', 'fresa'] },
  market_a: { x: 25, y: 27.5, owner: 'bruno', need: 'market_a', node: 'market_a', goods: ['carbon', 'cobre', 'carbon', 'hierro'] },
  market_b: { x: 13, y: 31.5, owner: 'lia', need: 'market_b', node: 'market_b', goods: ['sardina', 'carpa', 'perca', 'sardina'] },
};
const stallNow = key => (own(STALLS, key) && (!STALLS[key].need || hasBuilding(STALLS[key].need)) ? STALLS[key] : null);

CLAIMS.stall_take = (g, c, d, k, extra) => {
  const S = stallNow(c.key), L = g.law;
  if (!S || !L?.active || chunkOf(S.x, S.y) !== k || L.attended(c.key)) return false;
  const peer = c.by !== me() && g.live?.joined ? [...g.live.peers.values()].find(q => q.id === c.by) : null;
  if (peer?.at && distOf(peer.at[0], peer.at[1], S.x, S.y) > 8) return false;
  const day = L.today();
  if (d.pilfer?.[c.key] === day) return false;
  (d.pilfer ||= {})[c.key] = day;
  extra.got = L.stallThing(c.key, day);
  return true;
};

export class Law {
  constructor(game) {
    this.game = game;
    this.now = () => Date.now();                         // (the tests put other ones)
    this.today = () => Math.floor(madridMs() / DAY);
    this.v = {};
    this.clear();
  }
  clear() {
    this.con = { st: 'routine' };     // Ramiro, while he is not at his routine: { st: ask | chase | hold | return, tg, x, y … }
    this.remote = null;               // (a guest) where he is, as whoever decides says: { x, y, yaw, run, tg, st, until }
    this.asked = new Map();           // player → when he may ask them again (game s)
    this.rest = new Map();            // player → when he may chase them again
    this.lastCrime = new Map();       // player → when they last said one
    this.returned = new Map();        // 'layer:tx,ty' → what you put back there
    this.cell = false; this.fresh = true;
    this.thinkT = 0; this.lookT = 0; this.sendT = 0; this.secT = 0; this.leashT = 0; this.decayT = 0;
    this.waiting = null; this.settling = false; this.saidSt = '';
    this.n = null;
  }
  get world() { return this.game.world; }
  decides() { const b = this.game.barrow; return !b || b.decides(); }
  // Is there law in this world? Not before the office is built, nor in peaceful, nor if an op turned it off
  get active() { const g = this.game; return hasBuilding('law_office') && g.rules?.doLaw !== false && g.difficulty !== 'peaceful'; }
  // Does what this player does count?
  get counts() { return this.active && !OFF && !Profile.server && !!this.game.rep?.counts && !this.jailed; }
  reset(save) {
    this.clear();
    this.v = {};
    for (const [id, r] of Object.entries(isMap(save?.law) ? save.law : {})) { const q = cleanRecord(r, this.now()); if (q) this.v[id] = q; }
  }
  save(out) { out.law = this.v; }
  onEnd() { this.clear(); }

  // ---------- the records ----------
  record(id = me()) { return own(this.v, id) ? this.v[id] : null; }
  bounty(id = me()) { return this.record(id)?.bounty || 0; }
  level(id = me()) { return this.active ? levelOf(this.bounty(id)) : null; }
  // Hunted: nobody sells them anything nor buys from them (talk.js, business.js)
  refuses(id = me()) { const r = this.record(id); return this.active && !!r && !r.jail && levelOf(r.bounty) === 'hunted'; }
  get jailed() { return this.jailedId(me()); }
  jailedId(id) { const r = this.record(id); return this.active && !!r?.jail; }
  anyJailed() { for (const id in this.v) if (this.v[id].jail) return true; return false; }
  left() { const r = this.record(); return r?.jail ? Math.max(0, r.jail.until - this.now()) : 0; }
  // Whose poster is up, the most wanted first
  posters() { return !this.active ? [] : Object.entries(this.v).filter(([, r]) => !r.jail && r.bounty >= WANTED).sort((a, b) => b[1].bounty - a[1].bounty || (a[0] < b[0] ? -1 : 1)).map(([id, r]) => ({ id, ...r })); }
  changed() { this.game.onSave?.(); }
  // (whoever decides) A crime of a player
  add(id, { name, look, kind, n, key = null }) {
    const fine = fineOf(kind, n);
    if (!this.decides() || !this.active || typeof id !== 'string' || !id || !(fine > 0) || this.jailedId(id)) return 0;
    const r = this.v[id] ||= { name: '', look: null, bounty: 0, crimes: [], since: this.now(), clean: 0, jail: null, chases: 0 }, was = r.bounty;
    r.name = cleanName(name) || r.name || '?';
    if (isMap(look) && !r.look) r.look = structuredClone(look);   // (as they looked the first time)
    r.bounty = Math.min(BOUNTY_MAX, r.bounty + fine);
    r.crimes = [...r.crimes, key ? [this.now(), kind, r.bounty - was, String(key).slice(0, 40)] : [this.now(), kind, r.bounty - was]].slice(-CRIMES_KEPT);
    r.clean = this.today(); delete r.cut;
    this.asked.delete(id);
    this.changed();
    return r.bounty - was;
  }
  // (whoever decides) What was taken is back in its place: that crime is forgotten
  undo(id, key) {
    const r = this.record(id);
    if (!r || r.jail || (this.con.st === 'hold' && this.con.tg === id)) return false;
    const i = r.crimes.findIndex(c => c[3] === key && key);
    if (i < 0) return false;
    r.bounty -= r.crimes[i][2];
    r.crimes.splice(i, 1);
    if (r.bounty <= 0) delete this.v[id];
    this.changed();
    return true;
  }
  clearRecord(id) { const was = this.v[id]?.jail; delete this.v[id]; if (was && !this.anyJailed()) this.openCell(); this.changed(); }
  // (whoever decides) Each second: the sentences that are over; each minute: the bounties go down by themselves
  tick(dt) {
    const now = this.now();
    for (const id of Object.keys(this.v)) if (this.v[id].jail && (this.v[id].jail.until <= now || !this.active)) this.clearRecord(id);
    if ((this.decayT -= dt) > 0) return;
    this.decayT = 60;
    const day = this.today();
    for (const id of Object.keys(this.v)) {
      const r = this.v[id], q = decayed(r, day);
      r.clean = q.clean;
      if (!q.changed) continue;
      if (q.bounty <= 0) { this.clearRecord(id); continue; }
      r.bounty = q.bounty; r.cut = q.cut;
      this.changed();
    }
  }

  // ---------- one's own crimes ----------
  // What this player has just done, seen by somebody. key: what it was, to undo it. Returns whether it counts
  crime(kind, { x = 0, y = 0, n = 0, key = null } = {}) {
    const g = this.game;
    if (!this.counts || !REPORTED.includes(kind)) return false;
    const fine = fineOf(kind, n);
    if (this.decides()) this.add(me(), { name: g.player.name, look: g.appearance(), kind, n: fine, key });
    else if (g.live?.hostConn !== null && g.live?.hostConn !== undefined) g.live.net?.send({ t: 'crime', kind, x: r2(x), y: r2(y), n: fine, k: key || undefined }, g.live.hostConn);
    return true;
  }
  uncrime(key) {
    const g = this.game;
    if (!this.active || OFF) return;
    if (this.decides()) this.undo(me(), key);
    else if (g.live?.hostConn !== null && g.live?.hostConn !== undefined) g.live.net?.send({ t: 'crime', kind: 'return', k: key }, g.live.hostConn);
  }
  // (reputation.js taken / placed) Something of a neighbour's house taken with a witness; put back; taken again after that
  tookFromHouse(layer, tx, ty, what) {
    const cost = ITEMS[what] ? priceOf(what) : (PIECES[what]?.cost || []).reduce((s, [m, n]) => s + priceOf(m) * n, 0);
    return this.crime('theft_house', { x: tx + 0.5, y: ty + 0.5, n: FINES.theft_house + Math.round(cost || 0), key: `${layer}:${tx},${ty}|${what}` });
  }
  putBack(layer, tx, ty) {
    const raw = this.world.ownAt?.(layer, tx, ty), what = raw && parsePlaced(raw)[0];
    if (!what) return;
    this.returned.set(`${layer}:${tx},${ty}`, what);
    this.uncrime(`${layer}:${tx},${ty}|${what}`);
  }
  // (only the very thing that was put back: anything else there is yours)
  wasReturned(layer, tx, ty, what) { const k = `${layer}:${tx},${ty}`, yes = this.returned.get(k) === what; if (yes) this.returned.delete(k); return yes; }
  // (social.js, ?shove=1) Somebody was shoved: they are the witness
  shoved(id, e) { return this.crime(id === RAMIRO ? 'shove_constable' : 'shove', { x: e.x, y: e.y }); }
  // What who saw it says: 'Thief! Ramiro will hear about this'
  witnessLine(id) { const temper = PEOPLE[id]?.temper, l = [...tList(`law.witness.${temper}`), ...tList('law.witness')]; return l.length ? any(l) : ''; }

  // ---------- the stalls ----------
  attended(key) {
    const S = stallNow(key), N = this.game.neighbors;
    if (!S) return true;
    if (key === 'rosa' && N.isOpen('rosa')) return true;
    return N.people.some(n => n.id === S.owner && !n.hidden && Math.hypot(n.x - S.x, n.y - S.y) < STALL_R);
  }
  stallThing(key, day) { const L = STALLS[key].goods.filter(id => ITEMS[id]); return L.length ? L[Math.floor(ihash(day, key.length * 31 + key.charCodeAt(key.length - 1), 6301) * L.length)] : null; }
  // Is something left on it today?
  leftOn(key) { const S = STALLS[key], d = this.world.delta(...chunkOf(S.x, S.y).split(',').map(Number)); return d?.pilfer?.[key] !== this.today(); }
  // X held on a stall with nobody at it: taking something from it (neighbors.js, for Rosa's; aimables, the market's)
  stallAlt(key) {
    if (OFF || !this.counts || !stallNow(key) || this.attended(key) || this.waiting?.stall) return null;
    if (!this.leftOn(key)) return null;
    return { text: t('law.stall.take'), hold: 1, run: () => this.takeFrom(key) };
  }
  takeFrom(key) {
    const g = this.game, S = stallNow(key);
    if (!S || !this.counts || this.attended(key)) return;
    const k = chunkOf(S.x, S.y), got = v => { this.waiting = null; if (v?.ok) this.tookFrom(key, v.got); else { g.gather.float(t('law.stall.none'), '#ffb0a0'); Audio.error(); } };
    if (this.decides()) {
      const d = this.world.delta(...k.split(',').map(Number), true), extra = {};
      let ok = false;
      try { ok = CLAIMS.stall_take(g, { by: me(), k: 'stall_take', key }, d, k, extra); } catch (e) { reportFault(e, 'Law.takeFrom'); }
      if (ok) this.world.note(...k.split(',').map(Number));
      got({ ok, ...extra });
      return;
    }
    this.waiting = { stall: key };
    g.barrow.claim('stall_take', k, { key }, v => got(v));
  }
  tookFrom(key, id) {
    const g = this.game, S = STALLS[key], R = g.rep;
    if (!own(ITEMS, id)) return;
    const left = g.inv.add(id, 1);
    if (left) g.gather.throwOut(id, left);
    g.gather.float(`+1 ${ITEMS[id].name}`, '#fff3c0');
    Audio.pickup();
    const p = g.player, seen = R.witness(p.x, p.y, null);
    R.change(seen ? -10 : -5, 'stall');
    g.onSave?.();
    if (!seen) return;
    const who = seen.n === this.world.nilo ? 'nilo' : seen.n.id;
    g.neighbors.addPoints(who, -10);
    g.gossip?.news('stall_seen', who, id);
    this.crime('theft_stall', { x: S.x, y: S.y, n: FINES.theft_stall });
    g.social?.say(seen.n, this.witnessLine(who), { name: PEOPLE[who]?.name || '' });
  }

  // ---------- Ramiro (whoever decides) ----------
  get man() { const N = this.game.neighbors; if (!this.n || !N.people.includes(this.n)) this.n = N.people.find(q => q.id === RAMIRO) || null; return this.n; }
  // The players in the world, as whoever decides knows them
  targets() {
    const g = this.game, p = g.player, out = [];
    if (p && !Profile.server && g.scene === g.world && g.mode === 'play' && !g.dying) out.push({ id: me(), self: true, name: p.name, x: p.x, y: p.y, ok: g.gamemode === 'survival', ride: !!p.mount || !!p.boat || !!p.aboard, sleeping: !!p.sleeping || p.pose?.kind === 'lie', talking: !!(g.busy || hud.dialogOpen || g.talk?.on || g.jumping), swim: !!p.swim });
    if (g.live?.joined) for (const [conn, q] of g.live.peers) {
      const e = q.entity;
      if (!q.playing || q.server || !e?.to || q.sc !== 'world') continue;
      out.push({ id: q.id, conn, peer: q, name: q.name, x: e.to[0], y: e.to[1], ok: e.gm === 0 && !!q.law, ride: !!e.mount || !!e.boat || !!e.aboard, sleeping: !!e.sleeping || e.pose?.kind === 'lie', talking: !!g.talk?.peers.get(conn) || (q.lawBusy || 0) > g.time, swim: !!e.swim });
    }
    return out;
  }
  // Under a roof a player built, or in the player's house of the village: he does not go in
  sheltered(x, y) { const w = this.world; return !!w.ownAt('roof', Math.floor(x), Math.floor(y)) || inOwnHouse(x, y); }
  free(T) { return T.ok && !T.ride && !T.sleeping && !T.talking && !this.jailedId(T.id) && !this.sheltered(T.x, T.y); }
  sees(n, T, range) {
    const x = nearX(T.x, n.x), d = Math.hypot(x - n.x, T.y - n.y);
    return d <= range && this.world.reaches(n.x, n.y, x, T.y);
  }
  // Ten times a second
  constable(dt) {
    const g = this.game, n = this.man, K = this.con;
    if (!n || !this.active) { if (K.st !== 'routine') this.con = { st: 'routine' }; return; }
    const L = this.targets(), T = K.tg ? L.find(q => q.id === K.tg) : null, lvl = K.tg ? levelOf(this.bounty(K.tg)) : null;
    K.t = (K.t || 0) + dt;
    if (K.st === 'routine' || K.st === 'return') {
      if ((this.lookT -= dt) > 0) { if (K.st === 'return') this.returning(n, K); return; }
      this.lookT = LOOK;
      if (!(K.st === 'routine' && (n.asleep || n.spot?.kind === 'away'))) {
        let best = null, bd = Infinity;
        for (const q of L) {
          const lv = levelOf(this.bounty(q.id));
          if (!lv || !this.free(q) || (q.self && OFF)) continue;
          if (lv === 'fined' ? K.st === 'return' || (this.asked.get(q.id) ?? -1) > g.time : (this.rest.get(q.id) ?? -1) > g.time) continue;
          if (!this.sees(n, q, SIGHT[lv])) continue;
          const d = distOf(n.x, n.y, q.x, q.y) + (lv === 'fined' ? 100 : 0);
          if (d < bd) { bd = d; best = { q, lv }; }
        }
        if (best) { this.start(n, best.lv === 'fined' ? 'ask' : 'chase', best.q.id); return; }
      }
      if (K.st === 'return') this.returning(n, K);
      return;
    }
    // (paid, out of the world, the record gone: he goes back)
    if (!T || !lvl || (K.st !== 'hold' && !T.ok) || this.jailedId(K.tg)) { this.back(n); return; }
    const d = distOf(n.x, n.y, T.x, T.y);
    if (K.st === 'ask') {
      if (lvl !== 'fined') { this.start(n, 'chase', K.tg); return; }
      if (!this.free(T) || d > ASK_FAR || K.t > 25) { this.asked.set(K.tg, g.time + 120); this.back(n); return; }
      K.goal = [T.x, T.y]; K.speed = SPEEDS.walk;
      if (d < ASK_R && this.sees(n, T, 3)) { Object.assign(K, { st: 'hold', kind: 'ask', t: 0, goal: null }); this.asked.set(K.tg, g.time + ASK_AGAIN); this.order(T, { t: 'arrest', ask: 1, n: this.bounty(K.tg), mins: minsOf(this.bounty(K.tg)) }); }
      return;
    }
    if (K.st === 'chase') {
      const seen = !T.ride && !T.sleeping && !this.sheltered(T.x, T.y) && this.sees(n, T, SIGHT.hunted + 8);
      K.lost = seen && !(T.swim && d > 3) ? 0 : (K.lost || 0) + dt;
      K.near = d < CATCH_R && this.free(T) && seen ? (K.near || 0) + dt : Math.max(0, (K.near || 0) - dt * 0.5);
      K.goal = [T.x, T.y]; K.speed = SPEEDS[lvl] || SPEEDS.wanted;
      if (K.near >= CATCH_S) { Object.assign(K, { st: 'hold', kind: 'arrest', t: 0, goal: null }); this.order(T, { t: 'arrest', n: this.bounty(K.tg), mins: minsOf(this.bounty(K.tg)) }); return; }
      const out = Math.max(BOUNDS.x0 - T.x, T.x - BOUNDS.x1, BOUNDS.y0 - T.y, T.y - BOUNDS.y1);
      if (K.lost > LOST_S || out > OUT_R || K.t > CHASE_S) { this.giveUp(n, T); return; }
      return;
    }
    if (K.st === 'hold') {
      K.face = [T.x, T.y];
      if (K.kind === 'arrest' && d > 4) { Object.assign(K, { st: 'chase', t: 0, near: 0, lost: 0 }); return; }
      if (K.kind === 'ask' && d > 6) { this.back(n); return; }
      if (K.t > (K.kind === 'ask' ? ASK_S : HOLD_S)) { if (K.kind === 'arrest') this.act(K.tg, 'serve', {}); this.back(n); }
    }
  }
  start(n, st, tg) {
    const was = this.con;
    this.con = { st, tg, t: 0, near: 0, lost: 0, x: n.x, y: n.y, goal: null, way: null, wayT: 0, stuck: 0 };
    if (was.st === 'routine') this.sendT = 0;
    this.spoke(st, tg);
  }
  back(n) { this.con = { st: 'return', tg: null, t: 0, x: n.x, y: n.y, goal: null, way: null, wayT: 0, stuck: 0 }; this.spoke('return', null); }
  giveUp(n, T) {
    const K = this.con, id = K.tg, r = this.record(id);
    if (r && K.t >= MIN_CHASE && T.ok) {
      const was = r.bounty;
      r.bounty = Math.min(BOUNTY_MAX, r.bounty + evadeOf(r.bounty));
      r.crimes = [...r.crimes, [this.now(), 'evade', r.bounty - was]].slice(-CRIMES_KEPT);
      r.clean = this.today(); delete r.cut; r.chases = (r.chases || 0) + 1;
      this.changed();
    }
    this.rest.set(id, this.game.time + REST_S);
    this.back(n);
  }
  // Going back to where his day has him
  returning(n, K) {
    const a = n.whereAt(n.ms(this.game.neighbors.clock())), s = a.spot;
    K.speed = SPEEDS.walk;
    K.goal = [a.x, a.y];
    if (Math.hypot(a.x - n.x, a.y - n.y) < 0.7 || K.t > RETURN_S || (s.hidden && Math.hypot(a.x - n.x, a.y - n.y) < 3)) this.con = { st: 'routine' };
  }
  // A message to one player (or done here, if it is this one)
  order(T, m) {
    if (T.self) this.onArrest(m);
    else if (T.conn !== undefined) this.game.live.net?.send(m, T.conn);
  }
  // What a player answers or asks (whoever decides): { ok, n }
  act(id, a, { sur = 0, max = Infinity, of = null } = {}) {
    const K = this.con, n = this.man, over = who => { if (K.tg === who && n) this.back(n); };
    if (!this.active) return { ok: false };
    if (a === 'later') { if (K.st === 'hold' && K.kind === 'ask' && K.tg === id) { this.asked.set(id, this.game.time + LATER_AGAIN); this.back(n); } return { ok: true, n: 0 }; }
    if (a === 'busy') { if (K.st === 'hold' && K.tg === id) { if (K.kind === 'ask') { this.asked.set(id, this.game.time + 120); this.back(n); } else Object.assign(K, { st: 'chase', near: 0, lost: 0 }); } return { ok: true, n: 0 }; }
    if (a === 'bail') {
      const r = typeof of === 'string' && areCouple(this.game.family?.v, id, of) ? this.record(of) : null;
      if (!r) return { ok: false };
      if (r.bounty > max) return { ok: false, n: r.bounty };
      const cost = r.bounty;
      this.clearRecord(of); over(of);
      return { ok: true, n: cost };
    }
    const r = this.record(id);
    if (!r || r.jail) return { ok: false };
    const n0 = sur ? surrendered(r.bounty) : r.bounty;
    if (a === 'pay') {
      if (n0 > max) return { ok: false, n: n0 };
      this.clearRecord(id); over(id);
      return { ok: true, n: n0 };
    }
    if (a === 'serve') {
      const mins = minsOf(n0);
      r.jail = { until: this.now() + mins * 6e4, mins };
      this.shutCell();
      this.changed(); over(id);
      return { ok: true, n: mins };
    }
    return { ok: false };
  }
  shutCell() { const w = this.world, [tx, ty] = OFFICE.cellDoor; if (w.pieceAt(tx, ty)?.kind === 'door' && !w.doorClosed(tx, ty)) w.toggleDoor(tx, ty); }
  openCell() { const w = this.world, [tx, ty] = OFFICE.cellDoor; if (w.pieceAt(tx, ty)?.kind === 'door' && w.doorClosed(tx, ty)) w.toggleDoor(tx, ty); }

  // ---------- moving him (neighbors.js update) ----------
  // Is he the law's now? Then he is put where he goes, and true
  drive(n, dt) {
    if (n.id !== RAMIRO) return false;
    if (!this.decides()) {
      const R = this.remote;
      if (!R || this.game.time > R.until || R.st === 'routine') { if (this.driven) this.loose(n); return false; }
      this.take(n);
      if (Math.hypot(R.x - n.x, R.y - n.y) > SNAP) { n.x = R.x; n.y = R.y; }
      const k = 1 - Math.exp(-dt * 10), dx = (R.x - n.x) * k, dy = (R.y - n.y) * k, m = Math.hypot(dx, dy);
      n.vx = dt > 0 ? dx / dt : 0; n.vy = dt > 0 ? dy / dt : 0; n.x += dx; n.y += dy; n.step += m * 3.2;
      n.gait = R.run ? 2 : 0;
      n.faceTo(Math.sin(R.yaw), Math.cos(R.yaw));
      return true;
    }
    const K = this.con;
    if (K.st === 'routine' || !this.active) { if (this.driven) this.loose(n); return false; }
    this.take(n);
    this.move(n, K, dt);
    return true;
  }
  take(n) {
    this.driven = true;
    n.pose = null; delete n.yaw; n.hidden = n.atHome = n.asleep = n.meal = n.still = false; n.spot = null; n.path = ['patrol']; n.node = 'patrol'; n.lag = 0; n.hold = 0;
  }
  loose(n) { this.driven = false; delete n.gait; n.vx = n.vy = 0; n.path = []; n.now = null; n.wayOf = null; }
  // Towards his goal: straight if there is a way, round what is in between if not; sliding along the walls, never into deep water, a
  // hole or a player's house
  move(n, K, dt) {
    const w = this.world;
    if (K.st === 'hold' || !K.goal || !(dt > 0)) {
      n.vx = n.vy = 0; n.gait = 0;
      if (K.face) n.faceTo(nearX(K.face[0], n.x) - n.x, K.face[1] - n.y);
      return;
    }
    const gx = nearX(K.goal[0], n.x), gy = K.goal[1];
    if ((K.wayT -= dt) <= 0) {
      K.wayT = WAY_S;
      const direct = w.reaches(n.x, n.y, gx, gy) && !(K.stuck > 0.6);
      if (direct) K.way = null;
      else if (!K.way?.length || distOf(K.way.to[0], K.way.to[1], gx, gy) > 1.5 || K.stuck > 0.6) {
        K.stuck = 0; K.wayT = 1;
        const L = wayTo(w, [n.x, n.y], [gx, gy]) || this.byNodes(n, gx, gy);
        K.way = L ? Object.assign(L, { to: [gx, gy] }) : null;
      }
    }
    while (K.way?.length && Math.hypot(K.way[0][0] - n.x, K.way[0][1] - n.y) < 0.3) K.way.shift();
    const [tx, ty] = K.way?.length ? K.way[0] : [gx, gy], dx = tx - n.x, dy = ty - n.y, d = Math.hypot(dx, dy), stop = K.st === 'return' || K.way?.length ? 0.05 : K.st === 'ask' ? ASK_R - 0.3 : 0.8;
    if (d < stop) { n.vx = n.vy = 0; n.gait = 0; n.faceTo(gx - n.x, gy - n.y); return; }
    const sp = Math.min(K.speed || SPEEDS.walk, d / dt), p = { x: n.x + dx / d * sp * dt, y: n.y + dy / d * sp * dt };
    // (the doors open for him, as for every neighbour; the others standing in the way he goes past)
    if (!K.cols || (K.colsT -= dt) <= 0 || Math.abs(K.cx - n.x) > 1.5 || Math.abs(K.cy - n.y) > 1.5) { K.colsT = 0.4; K.cx = n.x; K.cy = n.y; K.cols = w.collidersNear(n.x, n.y).filter(c => !c.shut && !c.pond && !c.dig && c.npc === undefined && c.top === undefined && near(c, n.x, n.y)); }
    collide(p, K.cols, 0.28);
    const bad = (x, y) => w.blocked(x, y) || this.sheltered(x, y);
    if (bad(p.x, p.y) && !bad(n.x, n.y)) { if (!bad(p.x, n.y)) p.y = n.y; else if (!bad(n.x, p.y)) p.x = n.x; else { p.x = n.x; p.y = n.y; } }
    const mx = p.x - n.x, my = p.y - n.y, m = Math.hypot(mx, my);
    K.stuck = m < sp * dt * 0.35 ? (K.stuck || 0) + dt : Math.max(0, (K.stuck || 0) - dt * 2);
    n.vx = mx / dt; n.vy = my / dt; n.x = p.x; n.y = p.y; n.step += m * 3.2;
    n.gait = K.st === 'chase' && m > 2 * dt ? 2 : 0;
    n.faceTo(m > 0.2 * dt ? mx : dx, m > 0.2 * dt ? my : dy);
  }
  // By the neighbours' points of the village, when there is no nearer way
  byNodes(n, gx, gy) {
    const near = (x, y) => Object.entries(WALK_NODES).map(([k, q]) => [Math.hypot(q[0] - x, q[1] - y), k]).sort((a, b) => a[0] - b[0])[0], a = near(n.x, n.y), b = near(gx, gy), L = a && b && nodesBetween(a[1], b[1]);
    return L && L.length > 1 && b[0] < 14 ? [...L.map(k => [...WALK_NODES[k]]), [gx, gy]] : null;
  }

  // ---------- what is seen and heard of it, in every game ----------
  // Who he is after now: the player's id, or null; and is it you?
  get after() { const K = this.decides() ? this.con : this.remote && this.game.time <= this.remote.until ? this.remote : null; return K && (K.st === 'chase' || (K.st === 'hold' && K.kind !== 'ask')) ? K.tg : null; }
  get chased() { return this.active && this.after === me(); }
  get state() { return this.decides() ? this.con.st : this.remote && this.game.time <= this.remote.until ? this.remote.st : 'routine'; }
  get prey() { return this.decides() ? this.con.tg : this.remote?.tg ?? null; }
  // His words when he starts after you, or gives up
  spoke(st, tg) {
    const n = this.man, p = this.game.player, was = this.saidSt, K = this.con, key = `${st}|${tg}`;
    this.saidSt = key;
    if (!n || !p || Profile.server || was === key || this.game.scene !== this.world || distOf(n.x, n.y, p.x, p.y) > SAY_R) return;
    const mine = tg === me(), kind = st === 'chase' ? 'chase' : st === 'ask' && mine ? 'ask' : st === 'return' && was.startsWith('chase|') ? 'lost' : null;
    if (!kind) return;
    const L = tList(`law.say.${kind}`), name = mine ? p.name : this.record(tg)?.name || '';
    if (L.length) this.game.social?.say(n, formatMessage(any(L), { name }), { name: PEOPLE[RAMIRO].name });
    if (kind === 'chase') { this.game.social?.emote(n, 'point', { local: true }); if (mine) Audio.error(); }
  }

  // ---------- the network ----------
  // (whoever decides) Where he is, to the others
  send() {
    const g = this.game, n = this.man, K = this.con;
    if (!n || !g.live?.joined || !g.live.net) return;
    const yaw = Math.atan2(n.dir?.[0] ?? 0, n.dir?.[1] ?? 1), m = { t: 'law', x: r2(n.x), y: r2(n.y), yaw: r2(yaw), run: n.gait === 2 ? 1 : 0, tg: K.tg || null, st: K.st, k: K.kind === 'ask' ? 1 : undefined };
    for (const [conn, q] of g.live.peers) if (q.playing && !q.server && q.law) g.live.net.send(m, conn);
  }
  netAt(m) {
    if (this.decides() || ![m.x, m.y, m.yaw].every(Number.isFinite) || !['ask', 'chase', 'hold', 'return', 'routine'].includes(m.st)) return;
    const tg = typeof m.tg === 'string' ? m.tg.slice(0, 80) : null;
    this.remote = { x: m.x, y: m.y, yaw: m.yaw, run: !!m.run, st: m.st, tg, kind: m.k ? 'ask' : 'arrest', until: this.game.time + REMOTE_S };
    this.spoke(m.st, tg);
  }
  // (whoever decides) A guest says what they did: only of themselves, one a second, within what it can cost
  heardCrime(peer, m) {
    const g = this.game, e = peer?.entity, id = peer?.id;
    if (!this.decides() || typeof id !== 'string' || !id) return false;
    if (m.kind === 'return') { if (typeof m.k === 'string') this.undo(id, m.k.slice(0, 40)); return false; }
    if (!REPORTED.includes(m.kind) || !e || e.gm !== 0 || ![m.x, m.y].every(Number.isFinite)) return false;
    if (peer.at && distOf(peer.at[0], peer.at[1], m.x, m.y) > 24) return false;
    if (g.time - (this.lastCrime.get(id) ?? -Infinity) < CRIME_GAP) return false;
    this.lastCrime.set(id, g.time);
    return this.add(id, { name: peer.name, look: peer.look, kind: m.kind, n: m.n, key: typeof m.k === 'string' ? m.k : null }) > 0;
  }
  heardDo(conn, peer, m) {
    const g = this.game;
    if (!this.decides() || typeof peer?.id !== 'string' || !['pay', 'serve', 'later', 'busy', 'bail', 'free'].includes(m.a)) return;
    if (m.a === 'busy') peer.lawBusy = g.time + 4;
    // (an op's /tp took them out of the cell: pardoned)
    const r = m.a === 'free' ? { ok: g.live.isOp(peer.id) === true && this.jailedId(peer.id) && (this.clearRecord(peer.id), true) } : this.act(peer.id, m.a, { sur: m.sur ? 1 : 0, max: Number.isFinite(m.max) ? m.max : 0, of: m.of });
    if (m.a !== 'later' && m.a !== 'busy') g.live.net?.send({ t: 'lawok', a: m.a, ok: r.ok ? 1 : 0, n: r.n || 0, of: m.of }, conn);
  }
  // What this player asks for; the answer comes to done()
  ask(a, { sur = 0, of = null } = {}) {
    const g = this.game, L = g.live;
    if (this.decides()) { const r = this.act(me(), a, { sur, max: g.money, of }); this.done({ a, ok: r.ok, n: r.n, of }); return; }
    if (L?.hostConn === null || L?.hostConn === undefined) return;
    L.net?.send({ t: 'lawdo', a, sur: sur ? 1 : undefined, max: g.money, of: of || undefined }, L.hostConn);
    if (a === 'pay' || a === 'bail') this.waiting = { a, until: g.time + 8 };
  }
  netOk(m) {
    if (this.decides() || !this.waiting || this.waiting.a !== m.a) return;   // (only what was asked for)
    this.waiting = null;
    this.done({ a: m.a, ok: !!m.ok, n: Number.isFinite(m.n) ? Math.max(0, Math.min(BOUNTY_MAX, m.n)) : 0, of: typeof m.of === 'string' ? m.of : null });
  }
  done({ a, ok, n, of }) {
    const g = this.game;
    if (a === 'pay' || a === 'bail') {
      if (!ok) { if (n > 0) hud.toast(t('law.poor', { n }), 'warn'); Audio.error(); return; }
      g.addMoney(-n);
      Audio.coins ? Audio.coins() : Audio.pickup();
      if (a === 'pay') g.rep?.change(5, 'fine_paid');
      hud.toast(a === 'pay' ? t('law.paid', { n }) : t('law.bailed', { n, name: g.live?.nameOf?.(of) || '' }), 'money');
      g.onSave?.();
    }
  }

  // ---------- being caught, giving oneself up ----------
  get freeToAnswer() { const g = this.game; return !!g.player && g.mode === 'play' && !g.busy && !hud.dialogOpen && !g.talk?.on && !g.jumping && g.scene === g.world && !g.mobs?.near?.(g.player.x, g.player.y, 8); }
  async onArrest(m) {
    const g = this.game;
    if (Profile.server || !g.player || this.settling || !Number.isFinite(m.n)) return;
    if (!this.freeToAnswer || (m.ask && (g.windowsOpen || g.build?.on || g.fishing?.state))) { this.ask('busy'); return; }
    const n = Math.max(1, Math.round(m.n)), mins = Math.max(1, Math.min(5, Math.round(m.mins) || 1)), list = [];
    if (g.money >= n) list.push(['pay', t('law.pay', { n })]);
    list.push(m.ask ? ['later', t('law.later')] : ['serve', t('law.serve', { mins })]);
    const last = list.length - 1;
    this.settling = true;
    try {
      g.social?.cancel?.(); g.archery?.cancel?.();
      if (g.build?.on) g.build.toggle(false);
      if (!m.ask) g.closeWindows?.();
      g.busy = true; g.player.stop();
      if (!m.ask && this.man) g.social?.emote(this.man, 'arrest', { local: true });
      const pick = await hud.ask(PEOPLE[RAMIRO].name, m.ask ? any(tList('law.ask.q').map(l => formatMessage(l, { n, name: g.player.name }))) : t('law.arrest.q', { n, mins }), list.map(q => q[1]), { timeout: ANSWER_S, pick: last });
      if (!g.player) return;
      this.ask(list[pick]?.[0] || list[last][0]);
    } finally { this.settling = false; g.busy = false; }
  }
  // At his desk, or to him (talk.js): a fifth less, then pay or the cell
  async surrender(busy = true) {
    const g = this.game, b = this.bounty();
    if (!b || this.jailed || this.settling) { if (!b) hud.toast(t('law.clean')); return; }
    if (busy && !this.freeToAnswer) return;
    const n = surrendered(b), mins = minsOf(n), list = [];
    if (g.money >= n) list.push(['pay', t('law.pay', { n })]);
    list.push(['serve', t('law.serve', { mins })], [null, t('law.not_now')]);
    this.settling = true;
    try {
      if (busy) { g.busy = true; g.player.stop(); }
      const pick = await hud.ask(PEOPLE[RAMIRO].name, t('law.surrender.q', { b, n, mins }), list.map(q => q[1]));
      if (g.player && list[pick]?.[0]) this.ask(list[pick][0], { sur: 1 });
    } finally { this.settling = false; if (busy) g.busy = false; }
  }
  async bail(id, name) {
    const n = this.bounty(id), g = this.game;
    if (!n) return;
    if (g.money < n) { Audio.error(); await hud.say(PEOPLE[RAMIRO].name, [t('law.poor', { n })]); return; }
    const pick = await hud.ask(PEOPLE[RAMIRO].name, t(this.jailedId(id) ? 'law.bail.q_cell' : 'law.bail.q', { name, n }), [t('law.pay', { n }), t('law.not_now')]);
    if (g.player && pick === 0) this.ask('bail', { of: id });
  }
  // Whom of your couple you can pay for: [{ id, name, n }]
  bailable() { const F = this.game.family?.v; return this.active ? Object.keys(this.v).filter(id => id !== me() && areCouple(F, me(), id)).map(id => ({ id, name: this.v[id].name, n: this.v[id].bounty })) : []; }

  // ---------- the cell ----------
  enterCell(first) {
    const g = this.game, p = g.player;
    this.cell = true;
    if (g.barrow?.pushing) g.barrow.park(true);
    if (p.mount) g.ranch.dismount();
    if (g.build?.on) g.build.toggle(false);
    g.talk?.stop();
    const go = () => { if (!g.player || !this.cell) return; g.teleport(...OFFICE.inCell); p.stop(); p.face = { x: 0, y: 1 }; p.dir = [0, 1]; };
    if (first || !this.fade(go)) go();
    if (!first) { hud.toast(t('law.jailed', { mins: this.record()?.jail?.mins || 1 }), 'warn'); g.gossip?.news('jailed', RAMIRO); }
    g.onSave?.();
  }
  leaveCell() {
    const g = this.game;
    this.cell = false;
    const go = () => { if (!g.player) return; if (g.player.pose) g.rest.stand(); g.teleport(...OFFICE.out); };
    if (!this.fade(go)) go();
    hud.toast(t('law.released'), 'good');
    g.rep?.change(3, 'jail');
    g.onSave?.();
  }
  // In the dark (a moment): false if there is no screen for it
  fade(go) {
    const el = typeof document !== 'undefined' && !Profile.server ? document.getElementById('fade') : null;
    if (!el || this.game.jumping) return false;
    el.classList.add('on');
    setTimeout(() => { try { go(); } finally { setTimeout(() => el.classList.remove('on'), 250); } }, 350);
    return true;
  }
  // (game.js teleport: an op's /tp) Taken out of the cell by an op: pardoned
  freed() {
    if (!this.cell) return;
    this.cell = false;
    if (this.decides()) this.clearRecord(me());
    else this.game.live?.net?.send({ t: 'lawdo', a: 'free' }, this.game.live.hostConn);
    this.pardon = this.game.time + 10;
  }
  // Is that tile of the law office, while somebody is in the cell? Then it is not taken apart
  protects(tile) { return this.active && this.anyJailed() && Array.isArray(tile) && inLawOffice(+tile[0] + 0.5, +tile[1] + 0.5); }
  locked(tile) { return this.active && this.anyJailed() && tile[0] === OFFICE.cellDoor[0] && tile[1] === OFFICE.cellDoor[1]; }
  // (live.js 'w') A guest's changes of a chunk: what is the host's, and the office while somebody is in the cell, go back as they were
  arbitrate(k, ops) {
    const d = this.world?.deltas.get(k), shut = this.active && this.anyJailed();
    let ok = null, back = null;
    for (let i = 0; i < ops.length; i++) {
      const [f, c] = ops[i], tile = typeof c === 'string' ? c.replace(/^[a-z]+:/, '').split(',').map(Number) : null;
      const no = f === 'pilfer' || (shut && ['placed', 'floor', 'roof', 'gone', 'closed', 'pos', 'dig'].includes(f) && tile?.length === 2 && tile.every(Number.isFinite) && this.protects(tile));
      if (!no) { ok?.push(ops[i]); continue; }
      ok ||= ops.slice(0, i);
      (back ||= []).push(tile === null ? (d?.[f] !== undefined ? [f, null, structuredClone(d[f])] : [f]) : d?.[f]?.[c] === undefined ? [f, c] : [f, c, structuredClone(d[f][c])]);
    }
    return back ? { ok, back } : null;
  }

  // ---------- each frame ----------
  update(dt) {
    const g = this.game;
    if (!this.world) return;
    const dec = this.decides();
    if (dec) {
      if ((this.secT -= dt) <= 0) { this.secT = SEC; this.tick(SEC); }
      this.thinkT += dt;
      if (this.thinkT >= THINK) { const d = Math.min(0.5, this.thinkT); this.thinkT = 0; try { if (this.hasWork()) this.constable(d); } catch (e) { reportFault(e, 'Law.constable'); this.con = { st: 'routine' }; } }
      if (this.con.st !== 'routine' || this.sent) {
        if ((this.sendT -= dt) <= 0) { this.sendT = SEND; this.sent = this.con.st !== 'routine'; this.send(); }
      }
    } else if (this.con.st !== 'routine') this.con = { st: 'routine' };
    if (this.waiting?.until && g.time > this.waiting.until) this.waiting = null;
    if (!g.player || Profile.server) return;
    // The cell
    const jailed = this.jailed && g.gamemode === 'survival' && !(this.pardon > g.time);
    if (jailed && !this.cell) this.enterCell(this.fresh);
    else if (!jailed && this.cell) this.leaveCell();
    else if (this.fresh && this.active && g.scene === g.world && inRect(g.player.x, g.player.y) && !jailed) { if (g.player.pose) g.rest.stand(); g.teleport(...OFFICE.out); }   // (their time was up while they were away)
    this.fresh = false;
    if (this.cell && (this.leashT -= dt) <= 0) {
      this.leashT = LEASH_S;
      const p = g.player;
      if (g.mode === 'play' && !g.jumping && !g.dying && (g.scene !== g.world || !inRect(p.x, p.y, 0.35))) { if (!document.getElementById('fade')?.classList.contains('on')) g.teleport(...OFFICE.inCell); }
    }
  }
  hasWork() { if (this.con.st !== 'routine') return true; for (const id in this.v) return true; return false; }

  // ---------- what is aimed at ----------
  interact(p, scene) {
    if (scene !== this.world || !this.active || Math.hypot(p.x - OFFICE.desk[0], p.y - OFFICE.desk[1]) > 1.6) return null;
    return this.deskAction();
  }
  deskAction() {
    const n = this.bounty();
    return n && !this.jailed ? { text: t('law.surrender.at', { n: surrendered(n) }), run: () => this.surrender() } : { text: t('law.desk'), run: () => { Audio.blip(); hud.toast(t(this.jailed ? 'law.desk.jailed' : 'law.clean')); } };
  }
  aimables(p, scene, box) {
    if (scene !== this.world || !this.active || Profile.server) return null;
    const out = [];
    if (Math.abs(p.x - OFFICE.desk[0]) < 6 && Math.abs(p.y - OFFICE.desk[1]) < 8) {
      if (this.world.at('placed', ...OFFICE.deskTile)?.startsWith('desk')) out.push({ kind: 'sys', box: box(OFFICE.desk[0], OFFICE.desk[1], 0.95, 0.36, 0, 0.95), act: () => this.deskAction() });
      // (the bunk, for who is in there: a bed like any other, but it is not their home)
      if (this.cell) { const o = this.bunk(); if (o) out.push({ kind: 'sys', box: box(OFFICE.bunk[0] + 0.5, OFFICE.bunk[1] + 1, 0.45, 0.95, 0, 0.7), act: () => ({ text: t('bed.use'), run: () => this.useBunk(o) }) }); }
    }
    for (const key of ['market_a', 'market_b']) {
      const S = stallNow(key);
      if (!S || Math.abs(p.x - S.x) > 6 || Math.abs(p.y - S.y) > 6) continue;
      const alt = this.stallAlt(key);
      if (alt) out.push({ kind: 'sys', box: box(S.x, S.y, 0.95, 0.5, 0, 1.2), act: () => ({ text: t('law.stall.of', { name: PEOPLE[S.owner].name }), run: () => { Audio.blip(); hud.toast(t('law.stall.nobody', { name: PEOPLE[S.owner].name })); }, alt: this.stallAlt(key) }) });
    }
    return out.length ? out : null;
  }
  bunk() { const [tx, ty] = OFFICE.bunk; return this.world.placedNear?.(tx + 0.5, ty + 0.5, 1.2).find(q => q.placed === 'cama' && q.tile && q.tile[0] === tx && q.tile[1] === ty) || null; }
  async useBunk(o) {
    const g = this.game;
    if (g.busy || g.carry?.refuse?.()) return;
    g.busy = true;
    const pick = await hud.ask(g.player.name, t('bed.q'), [t('bed.lie'), t('bed.sleep'), t('bed.nothing')]);
    g.busy = false;
    if (!g.player || !this.cell) return;
    if (pick === 0) g.rest.lie(o);
    if (pick === 1) g.sleep(o);
  }
  // E on Ramiro while he is at it (neighbors.js): null, a talk as always
  ramiroAction() {
    const st = this.state;
    if (st === 'routine' || st === 'return' || !this.active) return null;
    if (this.prey === me() && this.bounty() && !this.jailed) return { text: t('law.surrender.at', { n: surrendered(this.bounty()) }), run: () => this.surrender() };
    return { text: t('law.busy'), run: () => { Audio.blip(); const n = this.man; if (n) this.game.social?.say(n, any(tList('law.say.busy')), { name: PEOPLE[RAMIRO].name }); } };
  }
  // ---------- the shared collection (livesync.js) ----------
  netItems() { return new Map(Object.entries(this.v)); }
  netApply(ops) {
    const now = this.now();
    for (const [kind, id, f, val] of ops) {
      if (kind === 'drop') { delete this.v[id]; continue; }
      if (kind === 'put') { const q = cleanRecord(f, now); if (q) this.v[id] = q; else delete this.v[id]; continue; }
      if (!own(this.v, id)) continue;
      const o = { ...this.v[id] };
      if (kind === 'del') delete o[f]; else if (kind === 'set') o[f] = val;
      const q = cleanRecord(o, now);
      if (q) this.v[id] = q;
    }
  }
  share(v) { this.v = {}; for (const [id, r] of Object.entries(isMap(v) ? v : {})) { const q = cleanRecord(r, this.now()); if (q) this.v[id] = q; } }
}

// ---------- talking with him (talk.js) ----------
const about = c => c.id === RAMIRO && c.game.law?.active;
talkOptions.add({ id: 'law_settle', order: 12, when: c => about(c) && c.game.law.bounty() > 0 && !c.game.law.jailed, label: c => t('law.opt.settle', { n: surrendered(c.game.law.bounty()) }), run: c => ({ modal: true, open: () => c.game.law.surrender(false) }) });
talkOptions.add({ id: 'law_bail', order: 13, when: c => about(c) && c.game.law.bailable().length > 0, label: c => t('law.opt.bail', { name: c.game.law.bailable()[0].name, n: c.game.law.bailable()[0].n }), run: c => { const q = c.game.law.bailable()[0]; return { modal: true, open: () => c.game.law.bail(q.id, q.name) }; } });
