// Table games with coin bets, at the tavern and at home (docs/planes/gta/PLAN-I-juntos.md §1.1, §2, §3; the rules: tg/*.js).
//
// Where: a chair or a stool at a table (mesa, game_table), or on a bar stool of the tavern (only Crows). In the tavern Anselmo lends
// the dice and the tiles; elsewhere they are put on the table (d.tgkit["tx,ty"] = ['dice', 'tile_box'], the items of that name).
//
// A game is in the world, in the chunk of its table, written only by whoever decides the world (alone, the host or the world server:
// barrow.decides(); a guest's changes of it are sent back, arbitrate):
//   d.tg["tx,ty"] = { id, game, ph, seats: [{ who, name, npc?, at: [x, y, yaw], in?, out? }], stake, st, n, pot, at, res?, past }
//     ph: 'open' (an invitation to the players of that table) → 'ante' (each player puts their coins) → 'play' → 'end'
//     st: the state of the rules, hands included (each game draws only its own); n: how many moves; at: ms of the last change
//     past: { gid: { pay: { player: coins }, stake: { player: coins }, at } }: what each one is due, until they have taken it
// What the players do is a request (CLAIMS.tg_*, claims.js): at once for whoever decides, else through barrow.claim.
//
// The coins never travel nor are made or lost: each player's game takes its own stake once (ante), keeps it in its saved escrow, and
// says so; the pot only counts the stakes that were said. The result says what each one is due; their game takes it once (paid) and
// says it was taken. A stake whose game never was (nor its result) comes back after LOST_MS. A neighbour's stake comes from nowhere
// and what they win goes nowhere: their daily caps (tg.rivals) keep that small.
import { CHUNK } from './world/gen.js';
import { wrapIndex, nearX } from './world/planet.js';
import { inTavern } from './world/village.js';
import { parsePlaced } from './pieces.js';
import { PEOPLE } from './neighbors.js';   // (a cycle, read only inside functions)
import { crows } from './tg/crows.js';
import { tiles } from './tg/tiles.js';
import { AI } from './tg/ai.js';
import { CLAIMS } from './claims.js';
import { Profile } from './accounts.js';
import { randomId } from './carry-items.js';
import { ITEMS } from './items.js';
import { Audio } from './audio.js';
import { reportFault } from './faults.js';
import { hud } from './ui/hud.js';
import { t, tList, formatMessage } from './i18n.js';
import { apagada } from './opciones.js';

export const RULES = { crows, tiles };
export const STAKES = [0, 5, 10, 25, 50, 100];
// What each neighbour plays for at most (the others, LIMIT)
export const LIMITS = { ines: 10, marta: 25, paco: 25, eusebio: 50, anselmo: 100 }, LIMIT = 25;
export const GAMES_A_DAY = 3, LOST_A_DAY = 150;      // with each neighbour: games, and coins they lose to you
export const KIT = { dice: 'crows', tile_box: 'tiles' };
const ON = !apagada('juegos');                        // (?juegos=0: no window, no offers and no new games with neighbours; what there is in the world goes on)
const TOPS = { mesa: 0.8, game_table: 0.8, barra: 0.93 }, REACH = 0.75, FRONT = 0.8, MAX_SEATS = 4;
const ANTE_S = 12, OPEN_S = 600, END_S = 14, TURN_S = 60, STAND_S = 2, GONE_S = 120;   // s: to put the coins; an invitation; the end in sight; a turn; off the seat; cut off
const THINK = [0.8, 1.6];
const LOST_MS = 30 * 6e4, ACK_AFTER = 12, RETRY = 3, KEEP_MS = 60 * 864e5, PAID = 80;
const SCAN = 20;
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const me = () => Profile.id || 'me';
const xyOf = k => k.split(',').map(Number);
const chunkKey = (tx, ty) => `${wrapIndex(Math.floor(tx / CHUNK), CHUNK)},${Math.floor(ty / CHUNK)}`;
const tileOk = s => typeof s === 'string' && /^-?\d+,-?\d+$/.test(s);
const own = (o, k) => isMap(o) && Object.prototype.hasOwnProperty.call(o, k);
const cleanName = s => String(typeof s === 'string' ? s : '').replace(/[\u0000-\u001f<>]/g, '').slice(0, 24);
const coins = v => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
// (a record of a game this version knows; what a newer one left is kept as it is and never touched)
const sound = r => isMap(r) && typeof r.id === 'string' && own(RULES, r.game) && Array.isArray(r.seats) && r.seats.every(s => isMap(s) && typeof s.who === 'string');
export const liveRec = r => sound(r) && (r.ph === 'open' || r.ph === 'ante' || r.ph === 'play');
const random = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; };

// ---------- the requests (whoever decides) ----------
const asked = fn => (g, c, d, k, extra) => {
  const T = g.tables;
  if (!T || !tileOk(c.tile) || chunkKey(...xyOf(c.tile)) !== k || typeof c.by !== 'string' || !c.by) return false;
  const ok = fn(T, g, c, d, d.tg?.[c.tile], extra);
  if (ok) T.touched(c.tile);
  return !!ok;
};
const mineIn = (r, c) => (sound(r) && r.id === c.gid ? r.seats.findIndex(s => s.who === c.by && !s.npc && !s.out) : -1);
// A game at a table: { tile, game, stake, npcs: [ids], nm }. With only neighbours it starts; with players, they are waited for
CLAIMS.tg_open = asked((T, g, c, d, rec) => {
  const R = RULES[own(RULES, c.game) ? c.game : ''], table = T.tableAt(c.tile);
  if (!R || !table || !STAKES.includes(c.stake) || liveRec(rec) || (rec && rec.id && !own(RULES, rec.game)) || !T.kitAt(table).includes(c.game)) return false;
  const here = T.peopleAt(table), mine = here.find(q => !q.npc && q.id === c.by);
  if (!mine || T.gameOf(c.by)) return false;
  const npcs = [];
  for (const id of Array.isArray(c.npcs) ? [...new Set(c.npcs)].slice(0, 3) : []) {
    const q = here.find(x => x.npc && x.id === id);
    if (!q || c.stake > (LIMITS[id] ?? LIMIT) || T.gameOf(id)) return false;
    npcs.push(q);
  }
  const seat = q => ({ who: q.id, name: q.npc ? '' : q.name, at: q.at, ...(q.npc && { npc: 1, in: 1 }) });
  const past = isMap(rec?.past) ? rec.past : {};
  (d.tg ||= {})[c.tile] = { id: randomId() + randomId(), game: c.game, ph: 'open', seats: [{ ...seat(mine), name: cleanName(c.nm) || mine.name }, ...npcs.map(seat)], stake: c.stake, n: 0, pot: 0, at: Date.now(), past };
  if (c.wait !== 1 && npcs.length) T.ante(d.tg[c.tile]);
  T.index.set(c.tile, k2(c.tile));
  return true;
});
const k2 = tile => chunkKey(...xyOf(tile));
// Joining an invitation: { tile, gid, nm }. With everybody who sits there in, it starts
CLAIMS.tg_sit = asked((T, g, c, d, rec) => {
  if (!sound(rec) || rec.id !== c.gid || rec.ph !== 'open' || rec.seats.length >= MAX_SEATS || rec.seats.some(s => s.who === c.by)) return false;
  const table = T.tableAt(c.tile), here = table ? T.peopleAt(table) : [], q = here.find(x => !x.npc && x.id === c.by);
  if (!q || T.gameOf(c.by)) return false;
  rec.seats.push({ who: c.by, name: cleanName(c.nm) || q.name, at: q.at });
  rec.at = Date.now();
  if (rec.seats.length >= MAX_SEATS || here.every(x => x.npc || rec.seats.some(s => s.who === x.id))) T.ante(rec);
  return true;
});
// Starting with those who are in: { tile, gid }
CLAIMS.tg_go = asked((T, g, c, d, rec) => {
  if (mineIn(rec, c) < 0 || rec.ph !== 'open' || rec.seats.length < 2) return false;
  T.ante(rec);
  return true;
});
// Their stake is in their escrow: { tile, gid }
CLAIMS.tg_ante = asked((T, g, c, d, rec) => {
  const i = mineIn(rec, c);
  if (i < 0 || (rec.ph !== 'ante' && rec.ph !== 'play')) return false;
  if (rec.seats[i].in) return true;
  if (rec.ph !== 'ante') return false;
  rec.seats[i].in = 1;
  if (rec.seats.every(s => s.in || s.out)) T.deal(rec);
  return true;
});
// A move: { tile, gid, n (the moves there were), mv }
CLAIMS.tg_move = asked((T, g, c, d, rec) => {
  const i = mineIn(rec, c);
  if (i < 0 || rec.ph !== 'play' || rec.n !== c.n || rec.st.turn !== i) return false;
  return T.play(rec, c.mv);
});
// Standing up, or not being able to pay (unpaid): { tile, gid }
CLAIMS.tg_leave = asked((T, g, c, d, rec) => {
  const i = mineIn(rec, c);
  if (i < 0 || !liveRec(rec)) return false;
  T.leaveSeat(rec, i, d, c.tile);
  return true;
});
// What they were due is taken: { tile, gid }
CLAIMS.tg_ack = asked((T, g, c, d, rec) => {
  const p = rec?.past?.[c.gid];
  if (!isMap(p?.pay) || !own(p.pay, c.by)) return true;
  delete p.pay[c.by];
  if (isMap(p.stake)) delete p.stake[c.by];
  if (!Object.keys(p.pay).length) delete rec.past[c.gid];
  return true;
});
// The dice or the box on a table, or off it: { tile, id, on }
CLAIMS.tg_kit = asked((T, g, c, d, rec) => {
  const table = T.tableAt(c.tile), have = Array.isArray(d.tgkit?.[c.tile]) ? d.tgkit[c.tile] : [];
  if (!own(KIT, c.id)) return false;
  if (c.on) {
    if (!table || table.kind !== 'table' || table.tavern || have.includes(c.id)) return false;
    (d.tgkit ||= {})[c.tile] = [...have, c.id];
  } else {
    if (!have.includes(c.id) || liveRec(rec)) return false;
    const left = have.filter(x => x !== c.id);
    if (left.length) d.tgkit[c.tile] = left; else delete d.tgkit[c.tile];
  }
  T.index.set(c.tile, k2(c.tile));
  return true;
});

export class TableGames {
  constructor(game) {
    this.game = game;
    this.on = ON;
    this.rng = random;         // (the tests put a seeded one; only whoever decides rolls)
    this.clear();
  }
  clear() {
    this.index = new Map();    // tile → its chunk's key (tables with a game, a result still due, or something on them)
    this.escrow = {}; this.paid = []; this.rivals = {}; this.day = { f: {} };
    this.seen = new Map();     // gid → { n, ph } last seen here (what to tell)
    this.mine = null;          // the table you are sitting at: { table, at }
    this.wait = null;          // a request of yours going
    this.timers = new Map();   // (whoever decides) gid → { turn, think, gone: { seat: s }, t }
    this.acks = new Map();     // gid → when it is said to have been taken
    this.kitWait = []; this.kitOwed = [];   // items handed over to a table, unanswered: { id, key }; and those of the last session
    this.scanT = 0; this.lookT = 0; this.v = 0; this.asked = new Set();
    this.memo = new Map();
  }
  // (who this game is: the tests give a fake game its own id)
  who() { return this.game.selfId || me(); }
  get world() { return this.game.world; }
  decides() { const b = this.game.barrow; return !b || b.decides(); }
  reset(save) {
    this.clear();
    const S = isMap(save?.tg) ? save.tg : {};
    if (isMap(S.escrow)) for (const [id, e] of Object.entries(S.escrow)) if (isMap(e) && Number.isFinite(e.stake) && tileOk(e.tile)) this.escrow[id] = e;
    if (Array.isArray(S.paid)) this.paid = S.paid.filter(x => typeof x === 'string').slice(-PAID);
    if (isMap(S.rivals)) for (const [id, r] of Object.entries(S.rivals)) if (isMap(r)) this.rivals[id] = { day: r.day, n: r.n || 0, lost: r.lost || 0 };
    if (Array.isArray(S.kit)) this.kitOwed = S.kit.filter(q => Array.isArray(q) && own(KIT, q[0]) && tileOk(q[1]));
    if (isMap(S.day)) this.day = { d: S.day.d, f: isMap(S.day.f) ? S.day.f : {}, rep: S.day.rep || 0 };
    this.scan();
  }
  save(o) {
    const kit = this.kitWait.map(q => [q.id, q.key]);   // (on its way to a table, unanswered)
    if (Object.keys(this.escrow).length || this.paid.length || Object.keys(this.rivals).length || kit.length) o.tg = { escrow: this.escrow, paid: this.paid, rivals: this.rivals, day: this.day, ...(kit.length && { kit }) };
  }

  // ---------- the records ----------
  scan() {
    this.scanT = SCAN;
    this.index.clear();
    const w = this.world;
    if (w?.deltas) for (const [k, d] of w.deltas) {
      if (k.startsWith('u:')) continue;
      for (const f of ['tg', 'tgkit']) if (isMap(d?.[f])) for (const tile of Object.keys(d[f])) if (tileOk(tile) && chunkKey(...xyOf(tile)) === k) this.index.set(tile, k);
    }
  }
  rec(tile) { const k = this.index.get(tile), r = k && this.world.deltas.get(k)?.tg?.[tile]; return isMap(r) ? r : null; }
  // The game at a table (a tile), as the contract of the plan says, or null
  at(tile) { const r = this.rec(String(tile)); return sound(r) && r.ph && r.ph !== 'idle' ? r : null; }
  // The live game somebody (a player's id or a neighbour's) is in: { tile, rec, seat }, or null
  gameOf(who) {
    for (const tile of this.index.keys()) { const r = this.rec(tile); if (!liveRec(r)) continue; const i = r.seats.findIndex(s => s.who === who && !s.out); if (i >= 0) return { tile, rec: r, seat: i }; }
    return null;
  }
  get mySeat() { const m = this.mine && this.at(this.mine.table.key); return m && liveRec(m) ? m.seats.findIndex(s => s.who === this.who() && !s.npc && !s.out) : -1; }
  // Something of a record changed here (whoever decides): saved and sent; nothing to draw again in the chunk
  touched(tile) { this.v++; const [x, y] = xyOf(tile); if (this.world.deltas.has(chunkKey(x, y))) this.world.note(Math.floor(x / CHUNK), Math.floor(y / CHUNK)); this.notice(tile); }
  // (live.js applyChunk) Changes of a chunk have come
  onOps(k, ops) {
    let any = null;
    for (const [f, c] of ops) if (f === 'tg' || f === 'tgkit') { any ||= new Set(); if (typeof c === 'string' && tileOk(c)) any.add(c); }
    if (!any) { if (this.index.size) for (const [f] of ops) if (f === 'placed' || f === 'pos') { this.memo.clear(); break; } return; }
    this.scan(); this.v++;
    for (const tile of any) this.notice(tile);
  }
  // (whoever decides) A guest's changes of a chunk: the games are not theirs to write. → { ok, back } or null: nothing of it
  arbitrate(k, ops) {
    if (!ops.some(([f]) => f === 'tg' || f === 'tgkit')) return null;
    const d = this.world?.deltas.get(k), ok = [], back = [];
    for (const op of ops) {
      const [f, c] = op;
      if (f !== 'tg' && f !== 'tgkit') { ok.push(op); continue; }
      if (typeof c !== 'string') back.push(d?.[f] ? [f, null, structuredClone(d[f])] : [f]);
      else back.push(d?.[f]?.[c] === undefined ? [f, c] : [f, c, structuredClone(d[f][c])]);
    }
    return { ok, back };
  }

  // ---------- the tables ----------
  // The table at a tile: { key, kind: 'table' | 'bar', x, y, yaw, h (its top), tavern }, or null
  tableAt(tile) {
    const w = this.world, M = this.memo.get(tile), now = this.game.time;
    if (M && now - M.at < 1 && M.touches === w.touches) return M.v;
    const [tx, ty] = xyOf(tile), raw = w.at('placed', tx, ty), [id, rot] = raw ? parsePlaced(raw) : [], d = w.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK));
    let v = null;
    if (id === 'barra') { const R = inTavern(tx + 0.5, ty + 0.5) && this.barRun(tx, ty); if (R && R.key === tile) v = { key: tile, id, kind: 'bar', x: (R.x0 + R.x1 + 1) / 2, y: (R.y0 + R.y1 + 1) / 2, x0: R.x0, x1: R.x1 + 1, y0: R.y0, y1: R.y1 + 1, yaw: 0, h: TOPS.barra, tavern: true }; }
    else if (id === 'mesa' || id === 'game_table') { const p = d?.pos?.[`placed:${tile}`] || [tx + 0.5, ty + 0.5, ((rot || 0) % 4) * Math.PI / 2]; v = { key: tile, id, kind: 'table', x: p[0], y: p[1], yaw: p[2], h: TOPS[id], tavern: inTavern(tx + 0.5, ty + 0.5) }; }
    this.memo.set(tile, { at: now, touches: w.touches, v });
    return v;
  }
  // The straight run of counter a tile of it is in
  barRun(tx, ty) {
    const w = this.world, is = (x, y) => { const r = w.at('placed', x, y); return !!r && parsePlaced(r)[0] === 'barra'; };
    let x0 = tx, x1 = tx, y0 = ty, y1 = ty;
    while (x1 - x0 < 12 && is(x0 - 1, ty)) x0--;
    while (x1 - x0 < 12 && is(x1 + 1, ty)) x1++;
    if (x0 === x1) { while (y1 - y0 < 12 && is(tx, y0 - 1)) y0--; while (y1 - y0 < 12 && is(tx, y1 + 1)) y1++; }
    return { key: `${x0},${y0}`, x0, x1, y0, y1 };
  }
  // The table somebody seated at (x, y) looks at, or null
  tableFrom(x, y, yaw) {
    const w = this.world, fx = x + Math.sin(yaw) * FRONT, fy = y + Math.cos(yaw) * FRONT;
    let best = null, bd = REACH;
    for (const o of w.placedNear?.(x, y, 1.9) || []) {
      if (TOPS[o.placed] === undefined || (o.layer || 'placed') !== 'placed' || !o.tile) continue;
      const d = Math.hypot(nearX(o.x, fx) - fx, o.y - fy);
      if (d < bd) { bd = d; best = o; }
    }
    if (!best) return null;
    if (best.placed !== 'barra') return this.tableAt(String(best.tile));
    if (!inTavern(best.x, best.y)) return null;
    return this.tableAt(this.barRun(...best.tile).key);
  }
  kitAt(table) {
    if (!table) return [];
    if (table.kind === 'bar') return ['crows'];
    if (table.tavern) return ['crows', 'tiles'];
    const L = this.world.deltas.get(k2(table.key))?.tgkit?.[table.key];
    return Array.isArray(L) ? L.filter(id => own(KIT, id)).map(id => KIT[id]) : [];
  }
  kitAtRaw(tile) { const L = this.world.deltas.get(k2(tile))?.tgkit?.[tile]; return Array.isArray(L) ? L : []; }
  // Where an entity is seated: its table, or null
  tableOfEntity(e) {
    const p = e?.pose;
    if (!p || p.kind !== 'sit') return null;
    const [x, y] = Array.isArray(e.to) ? e.to : [e.x, e.y];
    return this.tableFrom(x, y, p.yaw);
  }
  // Who sits at a table: [{ id, npc?, e, name, at: [x, y, yaw] }]
  peopleAt(table) {
    const g = this.game, out = [], at = (e, yaw) => [Math.round((Array.isArray(e.to) ? e.to[0] : e.x) * 100) / 100, Math.round((Array.isArray(e.to) ? e.to[1] : e.y) * 100) / 100, Math.round(yaw * 100) / 100];
    if (!table) return out;
    const near = e => Math.abs(nearX(e.x, table.x) - table.x) < 6 && Math.abs(e.y - table.y) < 6;
    const put = (e, id, name, npc) => { if (near(e) && this.tableOfEntity(e)?.key === table.key) out.push({ id, name, e, at: at(e, e.pose.yaw), ...(npc && { npc: true }) }); };
    if (g.player && g.scene === g.world) put(g.player, this.who(), g.player.name || '', false);
    if (g.live?.joined) for (const q of g.live.peers.values()) if (q.playing && q.sc === 'world' && q.entity && q.id) put(q.entity, q.id, q.name || '', false);
    for (const n of g.neighbors?.people || []) {
      if (n.hidden || n.asleep) continue;
      if (n.pose?.kind === 'sit') put(n, n.id, n.def.name, true);
      // (Anselmo plays too, from behind his bar, once the night is quiet: from 22:00)
      else if (n.id === 'anselmo' && table.kind === 'bar' && g.neighbors.isWorking('anselmo') && this.late()) out.push({ id: n.id, name: n.def.name, e: n, at: at(n, 0), npc: true });
    }
    return out;
  }
  late() { const h = this.game.days.hour; return h >= 22 || h < 6; }
  // Their face looks at whom they play with (neighbors.js): somebody of the game a neighbour is in, or null
  holder(n) {
    if (!this.index.size) return null;
    const G = this.gameOf(n.id);
    if (!G || G.rec.ph === 'open') return null;
    const g = this.game, q = G.rec.seats.find(s => !s.npc && !s.out);
    if (!q) return null;
    if (q.who === this.who()) return g.player || null;
    for (const p of g.live?.peers?.values() || []) if (p.id === q.who) return p.entity || null;
    return null;
  }

  // ---------- deciding ----------
  ante(rec) { rec.ph = 'ante'; rec.at = Date.now(); if (rec.seats.every(s => s.in)) this.deal(rec); }
  // The coins are down: the game starts (whoever did not put them is out)
  deal(rec) {
    rec.seats = rec.seats.filter(s => s.in);
    if (rec.seats.length < 2 || rec.seats.every(s => s.npc)) { this.finish(rec, { abort: true }); return; }
    // (a place of the turn's order by lot)
    rec.ph = 'play'; rec.at = Date.now(); rec.n = 0;
    rec.pot = rec.stake * rec.seats.length;
    rec.st = RULES[rec.game].start(rec.seats.length, this.rng);
  }
  play(rec, mv) {
    let next = null;
    try { next = RULES[rec.game].apply(rec.st, mv, this.rng); } catch (e) { reportFault(e, 'TableGames.play'); }
    if (!next) return false;
    rec.st = next; rec.n++; rec.at = Date.now();
    const T = this.timers.get(rec.id);
    if (T) { T.turn = 0; T.think = null; }
    const res = RULES[rec.game].result(next);
    if (res) this.finish(rec, res);
    return true;
  }
  // The end: what each player is due, to the coin
  finish(rec, res) {
    const pay = {}, stake = {}, inIn = rec.seats.map((s, i) => [s, i]).filter(([s]) => s.in), win = res.abort ? [] : res.win;
    for (const [s] of inIn) if (!s.npc) { pay[s.who] = res.abort ? rec.stake : 0; stake[s.who] = rec.stake; }
    if (!res.abort) {
      const each = Math.floor(rec.pot / win.length);
      let rest = rec.pot - each * win.length;
      for (const i of win) { const s = rec.seats[i], n = each + (rest > 0 ? 1 : 0); if (rest > 0) rest--; if (!s.npc) pay[s.who] = (pay[s.who] || 0) + n; }
    }
    rec.ph = 'end'; rec.at = Date.now();
    rec.res = { ...(res.abort ? { abort: 1 } : { win, ...(res.draw && { draw: 1 }), ...(res.blocked && { blocked: 1 }), ...(res.left && { left: 1 }) }) };
    if (Object.keys(pay).length) (rec.past ||= {})[rec.id] = { pay, stake, at: Date.now(), npc: rec.seats.filter(s => s.npc && s.in).map(s => s.who), win: win.map(i => rec.seats[i].who) };
    this.timers.delete(rec.id);
  }
  // A seat leaves. Before the coins are down it is only freed. After, it forfeits: the others go on if they are two or more; if
  // only neighbours are left they win; if one player is left, it is called off and everybody gets their stake back
  leaveSeat(rec, i, d, tile) {
    if (rec.ph === 'open' || rec.ph === 'ante') {
      const s = rec.seats[i];
      if (rec.ph === 'ante' && s.in) { this.finish(rec, { abort: true }); return; }
      rec.seats.splice(i, 1);
      if (!rec.seats.some(q => !q.npc) || rec.seats.length < (rec.ph === 'ante' ? 2 : 1)) { if (rec.seats.some(q => q.in && !q.npc)) this.finish(rec, { abort: true }); else this.drop(d, tile); }
      else if (rec.ph === 'ante' && rec.seats.every(q => q.in)) this.deal(rec);
      return;
    }
    rec.seats[i].out = 1;
    rec.n++; rec.at = Date.now();
    const left = rec.seats.map((s, j) => j).filter(j => !rec.seats[j].out), people = left.filter(j => !rec.seats[j].npc);
    if (!people.length) { this.finish(rec, left.length ? { win: [left[0]], left: true } : { abort: true }); return; }
    if (left.length < 2) { this.finish(rec, { abort: true }); return; }
    rec.st = RULES[rec.game].drop(rec.st, i);
    const res = RULES[rec.game].result(rec.st);
    if (res) this.finish(rec, res);
  }
  drop(d, tile) { const p = d?.tg?.[tile]?.past; if (isMap(p) && Object.keys(p).length) d.tg[tile] = { past: p }; else if (d?.tg) { delete d.tg[tile]; if (!d.tgkit?.[tile]) this.index.delete(tile); } }
  // Each step, whoever decides: the neighbours' moves, who has left, what is over
  run(dt) {
    const now = Date.now(), g = this.game;
    for (const [tile, k] of [...this.index]) {
      const d = this.world.deltas.get(k), rec = d?.tg?.[tile];
      if (!isMap(rec) || (rec.id && !sound(rec))) continue;
      if (!rec.id || rec.ph === 'end') {
        if (rec.id && !(now - rec.at < END_S * 1000)) { this.drop(d, tile); this.touched(tile); }
        continue;
      }
      const T = this.timers.get(rec.id) || { turn: 0, think: null, gone: {}, t: 0 };
      this.timers.set(rec.id, T);
      if (rec.ph === 'open' && !(now - rec.at < OPEN_S * 1000)) { this.drop(d, tile); this.touched(tile); continue; }
      if (rec.ph === 'ante' && !(now - rec.at < ANTE_S * 1000)) { this.deal(rec); this.touched(tile); continue; }
      // (4 times a second: who is still there, and the table)
      if ((T.t -= dt) <= 0) {
        T.t = 0.25;
        if (!this.tableAt(tile)) { this.abortGame(rec, d, tile); this.touched(tile); continue; }
        let done = false;
        rec.seats.forEach((s, i) => {
          if (done || s.npc || s.out) return;
          const there = this.seated(s, tile);
          if (there === true) { delete T.gone[s.who]; return; }
          T.gone[s.who] = (T.gone[s.who] || 0) + 0.25;
          if (T.gone[s.who] >= (there === null ? GONE_S : STAND_S)) { delete T.gone[s.who]; this.leaveSeat(rec, i, d, tile); done = true; }
        });
        if (done) { this.touched(tile); continue; }
      }
      if (rec.ph !== 'play') continue;
      const s = rec.seats[rec.st.turn];
      if (s?.npc) {
        if (T.think === null) T.think = THINK[0] + (THINK[1] - THINK[0]) * Math.random() + (rec.n === 0 ? 0.8 : 0);
        if ((T.think -= dt) > 0) continue;
        this.play(rec, AI[rec.game](rec.st, rec.st.turn, PEOPLE[s.who]?.temper, this.rng));
        this.touched(tile);
      } else if ((T.turn += dt) >= TURN_S) {
        // (nobody waits for ever: a turn that takes too long is played for them, safely)
        const L = RULES[rec.game].legal(rec.st, rec.st.turn);
        this.play(rec, L.includes('bank') ? 'bank' : L[0]);
        this.touched(tile);
      }
    }
    for (const gid of this.timers.keys()) if (![...this.index.keys()].some(q => this.rec(q)?.id === gid)) this.timers.delete(gid);
  }
  abortGame(rec, d, tile) { if (rec.seats.some(s => s.in && !s.npc)) this.finish(rec, { abort: true }); else this.drop(d, tile); }
  // Is a player of a game at their seat? true, false (they are here, and not there) or null (cut off, or out of the world)
  seated(s, tile) {
    const g = this.game, L = g.live;
    if (s.who === this.who() && !Profile.server) { if (!g.player) return null; return g.scene === g.world && this.tableOfEntity(g.player)?.key === tile; }
    if (!L?.joined) return null;
    for (const q of L.peers.values()) if (q.id === s.who && q.playing) return q.sc === 'world' && q.entity ? this.tableOfEntity(q.entity)?.key === tile : null;
    return null;
  }

  // ---------- asking ----------
  ask(kind, tile, data, done) {
    const g = this.game, w = this.world, k = k2(tile), c = { tile, ...data };
    if (this.decides()) {
      const [cx, cy] = xyOf(k), d = w.delta(cx, cy, true), extra = {};
      let ok = false;
      try { ok = !!CLAIMS[kind](g, { by: this.who(), k: kind, ...c }, d, k, extra); } catch (e) { reportFault(e, 'TableGames.ask'); }
      if (ok) w.note(cx, cy);
      done?.(ok);
      return ok;
    }
    const W = { kind, at: g.time };
    if (kind !== 'tg_ack' && kind !== 'tg_ante' && kind !== 'tg_kit') this.wait = W;
    g.barrow.claim(kind, k, c, v => { if (this.wait === W) this.wait = null; this.v++; done?.(v ? !!v.ok : null); });
    this.v++;
    return undefined;
  }
  get waiting() { return !!this.wait && this.game.time - this.wait.at < 10; }
  // (contract of the plan)
  open(game, stake, npcs = [], wait = false) {
    const m = this.mine;
    if (!m || !this.on || this.waiting) return;
    if (this.game.money < stake) { this.refuse('tg.poor'); return; }
    this.ask('tg_open', m.table.key, { game, stake, npcs, nm: this.game.player?.name || '', ...(wait && { wait: 1 }) }, ok => { if (!ok) this.refuse('tg.refused'); });
  }
  join() {
    const m = this.mine, r = m && this.at(m.table.key);
    if (!r || r.ph !== 'open' || this.waiting) return;
    if (this.game.money < r.stake) { this.refuse('tg.poor'); return; }
    this.ask('tg_sit', m.table.key, { gid: r.id, nm: this.game.player?.name || '' }, ok => { if (!ok) this.refuse('tg.refused'); });
  }
  go() { const m = this.mine, r = m && this.at(m.table.key); if (r && r.ph === 'open' && !this.waiting) this.ask('tg_go', m.table.key, { gid: r.id }); }
  move(mv) {
    const m = this.mine, r = m && this.at(m.table.key), i = this.mySeat;
    if (!r || r.ph !== 'play' || i < 0 || r.st.turn !== i || this.waiting) return;
    this.ask('tg_move', m.table.key, { gid: r.id, n: r.n, mv }, ok => { if (!ok) { Audio.error(); this.v++; } });
  }
  stand() { const m = this.mine, r = m && this.at(m.table.key); if (r && this.mySeat >= 0) this.ask('tg_leave', m.table.key, { gid: r.id }); }
  refuse(key) { Audio.error(); this.note = { text: t(key), at: this.game.time }; this.v++; }
  get hand() { const m = this.mine, r = m && this.at(m.table.key), i = this.mySeat; return r?.game === 'tiles' && r.st && i >= 0 ? r.st.hands[i] : []; }

  // ---------- the neighbours ----------
  rival(id) { const day = this.game.days.realDay, r = this.rivals[id]; return r && r.day === day ? r : { day, n: 0, lost: 0 }; }
  // How much a neighbour would play for with you now
  limitOf(id) { return Math.max(0, Math.min(LIMITS[id] ?? LIMIT, LOST_A_DAY - this.rival(id).lost)); }
  // Why a neighbour would not play with you for that: 'today', 'rep', 'money', or null
  why(id, stake = 0) {
    const g = this.game, r = this.rival(id);
    if (r.n >= GAMES_A_DAY) return 'today';
    if (g.rep && !g.rep.canTalk(id)) return 'rep';
    if (stake > this.limitOf(id)) return 'money';
    return null;
  }
  // A line of theirs at the table, over their head
  say(id, what) {
    const g = this.game, n = g.neighbors?.people.find(x => x.id === id), temper = PEOPLE[id]?.temper, list = tList(`tg.npc.${what}.${temper}`);
    const all = list.length ? list : tList(`tg.npc.${what}`);
    if (!n || n.hidden || !all.length || !g.player || Math.hypot(n.x - g.player.x, n.y - g.player.y) > 9) return '';
    const text = formatMessage(all[Math.floor(Math.random() * all.length)], g.neighbors.params());
    g.social?.say(n, text, { name: n.def.name });
    return text;
  }

  // ---------- the coins of this player ----------
  // What is seen of a table changed: your stake, what you are due, what to tell
  notice(tile) {
    const r = this.rec(tile);
    if (!r || Profile.server || !this.game.player) return;
    if (sound(r)) this.stake(tile, r);
    this.settle(tile, r);
    if (sound(r)) this.tell(tile, r);
    this.onChange?.();
  }
  where() { return this.game.live?.joined ? 's' : 'l'; }   // (which world: the shared one or your own)
  stake(tile, r) {
    const g = this.game, i = r.seats.findIndex(s => s.who === this.who() && !s.npc && !s.out);
    if (i < 0 || this.paid.includes(r.id) || (r.ph !== 'ante' && r.ph !== 'play')) return;
    const E = this.escrow[r.id];
    if (!E) {
      // (a game that was already going, and this player's save from before it: the stake is taken now)
      if (r.ph === 'play' && !r.seats[i].in) return;
      if (g.money < r.stake && r.ph === 'ante') { if (!this.asked.has(r.id)) { this.asked.add(r.id); this.ask('tg_leave', tile, { gid: r.id, unpaid: 1 }); } return; }
      const n = Math.min(r.stake, Math.max(0, g.money));
      if (n) g.addMoney(-n);
      this.escrow[r.id] = { stake: n, tile, at: Date.now(), w: this.where() };
      for (const s of r.seats) if (s.npc) { const R = this.rival(s.who); this.rivals[s.who] = { ...R, n: R.n + 1 }; this.company(s.who); }
      g.stats?.add('games_played', 1);
      if (n) Audio.coin?.() ?? Audio.blip();
      g.onSave?.();
    }
    if (r.ph === 'ante' && !r.seats[i].in) this.anteSay(tile, r);
  }
  anteSay(tile, r) {
    const T = this.game.time;
    if (this.anteAt?.id === r.id && T - this.anteAt.at < RETRY) return;
    this.anteAt = { id: r.id, at: T };
    this.ask('tg_ante', tile, { gid: r.id });
  }
  // A game with a neighbour: once a day, a little friendship and reputation (winning or losing makes no difference)
  company(id) {
    const g = this.game, day = g.days.realDay;
    if (this.day.d !== day) this.day = { d: day, f: {}, rep: 0 };
    if (!this.day.f[id]) { this.day.f[id] = 1; g.neighbors?.addPoints(id, 5); }
    if (this.day.rep < 3) { this.day.rep++; g.rep?.change(1, 'play'); }
  }
  settle(tile, r) {
    if (!isMap(r.past)) return;
    const g = this.game, who = this.who();
    for (const [gid, p] of Object.entries(r.past)) {
      if (!isMap(p) || !own(p.pay, who)) { if (this.escrow[gid] && isMap(p)) this.close(gid, this.escrow[gid].stake, 'back'); continue; }   // (it went on without your stake: it was never in the pot)
      if (!this.paid.includes(gid)) {
        // (not in the escrow: this save is from before the game; the stake it never took goes off what it is due)
        const E = this.escrow[gid], put = E ? E.stake : 0, owed = coins(p.stake?.[who]) - put, due = coins(p.pay[who]);
        const take = Math.min(Math.max(0, owed), Math.max(0, g.money + due));
        if (due - take) g.addMoney(due - take);
        if (due > coins(p.stake?.[who]) && Array.isArray(p.npc) && Array.isArray(p.win) && p.win.length === 1) for (const id of p.npc) { const R = this.rival(id); this.rivals[id] = { ...R, lost: R.lost + coins(p.stake?.[who]) }; }
        if (Array.isArray(p.win) && p.win.includes(who)) { g.stats?.add('games_won', 1); const gain = due - coins(p.stake?.[who]); if (gain > 0) g.stats?.add('games_coins', gain); }
        this.close(gid, 0);
        this.acks.set(gid, { tile, at: g.time + ACK_AFTER });
        if (due) this.won = { gid, n: due };
        g.onSave?.();
      } else if (!this.acks.has(gid)) this.acks.set(gid, { tile, at: g.time + ACK_AFTER });
    }
  }
  close(gid, back = 0, why) {
    delete this.escrow[gid];
    this.paid = [...this.paid.filter(x => x !== gid), gid].slice(-PAID);
    if (back > 0) { this.game.addMoney(back); hud.toast(t('tg.refund_load', { n: back }), 'money'); }
    if (why) this.game.onSave?.();
  }
  // Stakes of games that are nowhere: given back once it is sure
  lost() {
    const g = this.game, L = g.live, now = Date.now();
    if (L?.joined && !this.decides() && L.hostConn === null) return;
    for (const [gid, E] of Object.entries(this.escrow)) {
      if (E.w && E.w !== this.where()) continue;
      const r = this.rec(E.tile);
      if ((sound(r) && r.id === gid && r.ph !== 'end') || own(r?.past, gid)) continue;
      if ([...this.index.keys()].some(q => own(this.rec(q)?.past, gid) || this.rec(q)?.id === gid)) continue;
      if (now - (E.at || 0) < LOST_MS) continue;
      this.close(gid, E.stake, 'lost');
    }
  }
  // What happens at the tables near, told: gestures, sounds and lines (nothing of it changes anything)
  tell(tile, r) {
    const g = this.game, was = this.seen.get(r.id);
    this.seen.set(r.id, { n: r.n, ph: r.ph });
    if (this.seen.size > 40) this.seen.delete(this.seen.keys().next().value);
    const mineI = r.seats.findIndex(s => s.who === this.who() && !s.npc);
    // An invitation of your partner's, wherever you are
    if (r.ph === 'open' && !was && mineI < 0) { const q = r.seats[0]; if (q && !q.npc && g.social?.isPartnerId?.(q.who)) hud.toast(t('tg.invite_toast', { name: q.name, game: t(`tg.${r.game}`) }), 'social'); }
    if (!was || !g.player) return;
    const T = this.tableAt(tile), near = T && g.scene === g.world && Math.hypot(nearX(T.x, g.player.x) - g.player.x, T.y - g.player.y) < 14;
    if (!near) return;
    if (r.ph === 'play' && was.ph !== 'play') { if (r.game === 'crows') Audio.clink?.(); else Audio.place?.(); }
    const L = r.st?.last;
    if (r.n !== was.n && L && r.n > was.n) {
      const e = this.entityOf(r.seats[L.seat]);
      const roll = r.game === 'crows' && L.k !== 'bank';
      if (roll) { if (e) this.gesture(e, 'roll'); Audio.dice?.(); }
      else if (r.game === 'tiles' && L.k === 'play') { if (e) this.gesture(e, 'place'); Audio.tile?.(); }
      else Audio.blip();
      const npc = r.seats.filter(s => s.npc).map(s => s.who), mate = npc[Math.floor(Math.random() * npc.length)];
      if (mate && (L.k === 'bust' || L.k === 'murder') && Math.random() < 0.7) g.social?.later(() => this.say(mate, r.seats[L.seat]?.who === mate ? 'bust_mine' : 'bust_yours'), 0.9);
      else if (mate && L.k === 'roll' && r.st.crows === 2 && r.seats[L.seat]?.who !== mate && Math.random() < 0.3) g.social?.later(() => this.say(mate, 'again'), 0.9);
    }
    if (r.ph === 'end' && was.ph !== 'end') {
      const win = r.res?.win || [];
      for (const i of win) { const e = this.entityOf(r.seats[i]); if (e && r.stake) this.gesture(e, 'cheer'); }
      if (mineI >= 0) {
        if (r.res?.abort) hud.toast(t('tg.aborted'), 'warn');
        else if (r.res?.draw && win.includes(mineI)) hud.toast(t('tg.draw_game'), 'money');
        else if (win.includes(mineI)) { Audio.unlock(); if (r.pot) { hud.toast(t('tg.win', { n: r.pot }), 'money'); g.gather?.float?.(`+${r.pot}`, '#ffd77a'); } }
        for (const s of r.seats) if (s.npc) { const i = r.seats.indexOf(s); g.social?.later(() => this.say(s.who, r.res?.left ? 'left' : win.includes(i) ? 'won' : 'lost'), 1); }
      }
    }
  }
  gesture(e, k) { const g = this.game; if (!e.emote || e.emote.k !== k) g.social?.emote(e, k, { local: true }); }
  entityOf(s) {
    const g = this.game;
    if (!s) return null;
    if (s.npc) return g.neighbors?.people.find(n => n.id === s.who && !n.hidden) || null;
    if (s.who === this.who()) return g.player;
    for (const q of g.live?.peers?.values() || []) if (q.id === s.who) return q.entity || null;
    return null;
  }
  nameOf(s) { return s.npc ? PEOPLE[s.who]?.name || '?' : s.who === this.who() ? this.game.player?.name || s.name : s.name || '?'; }

  // ---------- each step ----------
  update(dt) {
    const g = this.game;
    if (!this.world) return;
    if (this.index.size) {
      if ((this.scanT -= dt) <= 0) this.scan();
      if (this.decides()) this.run(dt);
    }
    if (Profile.server || !g.player) return;
    // The table you sit at (4 times a second)
    if ((this.lookT -= dt) <= 0) {
      this.lookT = 0.25;
      this.look();
      if (this.index.size || this.acks.size || this.kitOwed.length || Object.keys(this.escrow).length) this.books();
    }
  }
  look() {
    const g = this.game, p = g.player, was = this.mine?.table.key || null;
    let T = null;
    if (p.pose?.kind === 'sit' && g.scene === g.world && !p.sleeping) T = this.tableOfEntity(p);
    if (T && !this.kitAt(T).length && !this.at(T.key)) T = null;
    this.mine = T ? { table: T } : null;
    const now = T?.key || null;
    if (now !== was) {
      // (off the seat with a game going: it is left at once)
      if (was) { const r = this.at(was); if (liveRec(r) && r.seats.some(s => s.who === this.who() && !s.npc && !s.out)) this.ask('tg_leave', was, { gid: r.id }); }
      this.v++;
      this.onSeat?.(now);
    }
    // (those in a game near rest their hands on the table: actors.js)
    for (const tile of this.index.keys()) {
      const r = this.rec(tile);
      if (!sound(r) || (r.ph !== 'play' && r.ph !== 'ante')) continue;
      const q = this.tableAt(tile);
      if (q && Math.hypot(nearX(q.x, p.x) - p.x, q.y - p.y) < 20) for (const s of r.seats) { const e = s.out ? null : this.entityOf(s); if (e?.pose) e.tableHands = g.time + 0.6; }
    }
  }
  books() {
    const g = this.game;
    for (const [gid, E] of Object.entries(this.escrow)) { const r = this.rec(E.tile); if (sound(r) && r.id === gid && r.ph === 'ante') this.stake(E.tile, r); }
    for (const [gid, A] of this.acks) if (g.time >= A.at) { this.acks.delete(gid); if (own(this.rec(A.tile)?.past, gid)) { this.ask('tg_ack', A.tile, { gid }); if (!this.decides()) this.acks.set(gid, { ...A, at: g.time + 60 }); } }
    if ((this.lostT = (this.lostT ?? 8) - 0.25) <= 0) { this.lostT = 20; for (const tile of this.index.keys()) { const r = this.rec(tile); if (r) { this.settle(tile, r); if (sound(r)) this.stake(tile, r); } } this.lost(); }
    if (this.kitOwed.length && (this.decides() || g.live?.hostConn !== null)) for (const [id, key] of this.kitOwed.splice(0)) if (!(this.world.deltas.get(k2(key))?.tgkit?.[key] || []).includes(id)) this.give(id);
  }

  // ---------- the dice and the box ----------
  // With them in the hand, at a table: they are put on it (the left button, gather.js target)
  target(p, held, def) {
    if (!def?.tableKit || !this.on || this.game.scene !== this.world) return null;
    const mt = this.game.mouseTile?.() || [Math.floor(p.x + p.face.x), Math.floor(p.y + p.face.y)];
    for (const tile of [mt, [Math.floor(p.x + p.face.x), Math.floor(p.y + p.face.y)]]) {
      const key = String(tile), T = this.tableAt(key);
      if (!T || T.kind !== 'table' || T.tavern || Math.hypot(nearX(T.x, p.x) - p.x, T.y - p.y) > 2.6) continue;
      if ((this.world.deltas.get(k2(key))?.tgkit?.[key] || []).includes(held.id)) continue;
      return { tile, ok: true, label: t('tg.kit.put', { item: ITEMS[held.id].name }), use: () => this.putKit(key, held.id) };
    }
    return null;
  }
  putKit(key, id) {
    const g = this.game;
    if (g.inv.count(id) < 1) return;
    g.inv.remove(id, 1);
    const q = { id, key };
    this.kitWait.push(q);
    Audio.place();
    this.ask('tg_kit', key, { id, on: 1 }, ok => { this.kitWait = this.kitWait.filter(x => x !== q); if (!ok && !(ok === null && this.world.deltas.get(k2(key))?.tgkit?.[key]?.includes(id))) this.give(id); g.onSave?.(); });
  }
  give(id) { const g = this.game, left = g.inv.add(id, 1); if (left) g.gather.throwOut(id, left); }
  takeKit(key, id) { this.ask('tg_kit', key, { id }, ok => { if (ok) { this.give(id); Audio.pickup(); this.game.onSave?.(); } }); }
  // (game.js placedAction) E on a table with something on it: it is picked up; the table itself cannot be taken away meanwhile
  tableAction(o) {
    if ((o.placed !== 'mesa' && o.placed !== 'game_table') || !this.index.size || this.game.scene !== this.world || !o.tile) return null;
    const key = String(o.tile), L = this.world.deltas.get(k2(key))?.tgkit?.[key], r = this.at(key);
    if (liveRec(r)) return { text: t('tg.busy'), run: () => Audio.error() };
    if (!Array.isArray(L) || !L.length) return null;
    const id = L.find(q => own(KIT, q));
    return id ? { text: t('tg.kit.take', { item: ITEMS[id].name }), run: () => this.takeKit(key, id) } : null;
  }
  // (build.js, game.js pickUp) Why that table cannot be taken away now, or ''
  protects(o) {
    if (!this.index.size || !o?.tile || (o.placed !== 'mesa' && o.placed !== 'game_table')) return '';
    const key = String(o.tile), L = this.world.deltas.get(k2(key))?.tgkit?.[key];
    if (liveRec(this.at(key))) return t('tg.busy');
    return Array.isArray(L) && L.length ? t('tg.kit.first') : '';
  }
}
