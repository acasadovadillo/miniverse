// The players' own businesses (docs/planes/gta/PLAN-H-pueblo-vivo.md §3): a shop (a counter, with shelves and crates near it) or
// a tavern (with a barrel, seats, a table and a roof). The stock, the prices and the till are in the world, in the chunk of the
// counter (d.shop["tx,ty"]), so the neighbours buy with the owner away. Who buys what and for how much: bizrules.js.
//
// The record, written only by whoever decides the world (alone, the host or the world server); a guest's changes of it are sent
// back (arbitrate):
//   { v, by (the owner's Profile.id), nm (their name), kind, goods: { lot: { id, n, m (price, % of what it is worth), …the stack's
//     own } }, q (the next lot), pr: { id: % }, till, settled (Madrid ms: sales made up to then), hours, sun (1: Sundays too), rl, hh
//     (the owner's reputation and hearts, as they were the last time they were here), log: [[ms, who, id, n, coins]], tot: [n,
//     coins], hist: { day: [n, coins] }, best: { id: [n, coins] }, fr: { neighbour: days they have bought }, ack: [[q, result]] }
//
// Everything the players do with it is a request (claims.js, through barrow.js): open, close, put, take, price, hours, collect,
// buy. Alone, as the host or on the world server it is done at once. What is handed over waits in the asker's escrow (saved)
// until the answer: each request carries its own id (q), which the record remembers (ack), so a lost answer, a reload or a new
// host never makes anything twice nor loses it.
//
// The sales: each visit is made when its minute comes (settle), with up to 7 days behind on loading, on the real clock
// (madridMs), so /time set neither sells more nor stops it. On a guest the customers seen are only drawn.
import { CHUNK } from './world/gen.js';
import { wrapIndex, distOf } from './world/planet.js';
import { ITEMS, itemNoun } from './items.js';
import { PIECES, parsePlaced } from './pieces.js';
import { WALK_NODES, hasBuilding } from './world/village.js';
import { wayRound, canWalk } from './world/walkways.js';
import { ROUTINES, SPEED, dayKind, slotAt, roadBetween, roadOf, makeSpot, along, nodesBetween } from './routines.js';
import { PEOPLE } from './neighbors.js';   // (a cycle, read only inside functions)
import { KINDS, HOURS, HOUR_IDS, CATCH_UP, PCT, CAP, REACH, NEAR_NODE, LEG, TRAVELLERS, sellable, unitPrice, isOpenAt, daysVisits, serve, onSale, lotIds } from './bizrules.js';
import { areCouple } from './social.js';
import { CLAIMS } from './claims.js';
import { extraOf } from './inventory.js';
import { sameStack, blend, perishes, FIELDS, ROT_DAYS, hooks } from './catch.js';
import { madridMs } from './time.js';
import { randomId, BULKY } from './carry-items.js';
import { ihash } from './util.js';
import { Profile } from './accounts.js';
import { Audio } from './audio.js';
import { reportFault } from './faults.js';
import { hud } from './ui/hud.js';
import { t, tList, formatMessage } from './i18n.js';
import { apagada } from './opciones.js';

const HOUR = 36e5, DAY = 864e5;
export const COUNTER = 'shop_counter', SHELF = 'display_shelf', CRATE = 'goods_crate';
const ON = !apagada('shops');   // (?shops=0: nothing of it is seen or used here; the sales go on, if this game runs the world)
export const BIZ_THINGS = new Set([COUNTER, SHELF, CRATE]);
const SEATS = { silla: 0.14, taburete: 0.27, barber_chair: 0.14 }, TABLES = new Set(['mesa', 'mesa_grande', 'barra', 'mesa_baja']);
const LOG = 20, ACKS = 24, HIST = 7, BEST = 24, LOTS = 60, MAX_N = 999;
const SCAN = 20, RESCUE = 15, LIMBO = 2, LIMBO_WAIT = 10;   // s: the whole world looked through; an owner's lost counter; answers looked for; the least to wait for one
const FLOAT_R = 40, SAY_R = 12;                              // tiles
const ARRIVE = 8, PAY_AFTER = 9, SIT_MS = 12 * 6e4;         // s before paying they are there; s after it they go; how long they sit
const OWN_FIELDS = ['color', 'dur', 'sips', 'tear', 'donned', ...FIELDS];
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const me = () => Profile.id || 'me';
const sound = r => isMap(r) && isMap(r.goods) && KINDS.includes(r.kind) && typeof r.by === 'string';   // (a kind from a newer game: left as it is)
const xyOf = k => k.split(',').map(Number);
const chunkKey = (tx, ty) => `${wrapIndex(Math.floor(tx / CHUNK), CHUNK)},${Math.floor(ty / CHUNK)}`;
const int = (v, a, b, d) => (Number.isFinite(v) ? Math.max(a, Math.min(b, Math.round(v))) : d);
const own = (o, k) => isMap(o) && Object.prototype.hasOwnProperty.call(o, k);
const cleanName = s => String(typeof s === 'string' ? s : '').replace(/[\u0000-\u001f<>]/g, '').slice(0, 24);

// ---------- the requests (whoever decides) ----------
// The record a request is about, whose chunk it must be in. Its ack says what was already answered
const recIn = (c, d, k) => (typeof c.key === 'string' && /^-?\d+,-?\d+$/.test(c.key) && chunkKey(...xyOf(c.key)) === k && own(d.shop, c.key) && sound(d.shop[c.key]) ? d.shop[c.key] : null);
const qOf = c => (typeof c.q === 'string' && c.q.length < 40 ? c.q : null);
function acked(rec, c, extra) {
  const a = Array.isArray(rec.ack) && rec.ack.find(e => e[0] === qOf(c));
  if (!a) return false;
  if (isMap(a[1])) Object.assign(extra, structuredClone(a[1]));
  return true;
}
function ack(rec, c, res = 1) { if (qOf(c)) rec.ack = [...(Array.isArray(rec.ack) ? rec.ack : []), [c.q, res]].slice(-ACKS); }
// (a stack from outside, whole and in its limits; null if it is not one)
function cleanStack(s) {
  if (!isMap(s) || !own(ITEMS, s.id) || BULKY[s.id] || !(s.n >= 1) || s.map) return null;
  const out = { id: s.id, n: int(s.n, 1, MAX_N, 1) };
  for (const f of OWN_FIELDS) if (s[f] !== undefined && (typeof s[f] === 'number' ? Number.isFinite(s[f]) : typeof s[f] === 'string' && s[f].length < 20)) out[f] = s[f];
  return out;
}
const bare = s => { const { m, ...x } = s; return x; };
// A request about a record the asker may manage (any: anybody's): fn(rec, res) → false, or what is remembered of it
const asked = (fn, any = false) => (g, c, d, k, extra) => {
  const rec = recIn(c, d, k), B = g.business;
  if (!rec || !B) return false;
  if (acked(rec, c, extra)) return true;
  if (!any && !B.mayManage(rec, c.by)) return false;
  const res = fn(g, c, rec, d, k);
  if (res === false || res === undefined) return false;
  ack(rec, c, res);
  if (isMap(res)) Object.assign(extra, structuredClone(res));
  B.touched(c.key);
  return true;
};
// (the owner's reputation and hearts come with what they do)
function snap(rec, c) {
  if (c.by !== rec.by || !isMap(c.sn)) return;
  rec.rl = int(c.sn.rl, 0, 5, 2);
  rec.hh = {};
  for (const id of Object.keys(PEOPLE)) { const h = int(c.sn.hh?.[id], 0, 10, 0); if (h) rec.hh[id] = h; }
  if (cleanName(c.nm)) rec.nm = cleanName(c.nm);
}
CLAIMS.shop_open = (g, c, d, k, extra) => {
  const B = g.business;
  if (!B || typeof c.key !== 'string' || !/^-?\d+,-?\d+$/.test(c.key) || chunkKey(...xyOf(c.key)) !== k || !KINDS.includes(c.kind)) return false;
  const was = recIn(c, d, k);
  if (was) return acked(was, c, extra);
  if (parsePlaced(d.placed?.[c.key] || '')[0] !== COUNTER || typeof c.by !== 'string' || !c.by) return false;
  if (B.list().some(e => e.rec.by === c.by && e.rec.kind === c.kind) || !B.premises(c.key, c.kind).ok) return false;
  const rec = { v: 1, by: c.by, nm: cleanName(c.nm), kind: c.kind, goods: {}, q: 1, pr: {}, till: 0, settled: B.now(), hours: 'day', sun: 0, rl: 2, hh: {}, log: [], tot: [0, 0], hist: {}, best: {}, fr: {}, ack: [] };
  snap(rec, c);
  ack(rec, c);
  (d.shop ||= {})[c.key] = rec;
  B.scan();
  return true;
};
CLAIMS.shop_close = (g, c, d, k) => {
  const rec = recIn(c, d, k), B = g.business;
  if (!rec || !B?.mayManage(rec, c.by) || Object.keys(rec.goods).length || rec.till > 0) return false;
  delete d.shop[c.key];
  B.scan();
  return true;
};
CLAIMS.shop_put = asked((g, c, rec) => {
  const s = cleanStack(c.s), B = g.business;
  if (!s || !sellable(s, rec.kind)) return false;
  for (const lot of lotIds(rec)) if (sameStack(rec.goods[lot], s) && sameLot(rec.goods[lot], s) && rec.goods[lot].n + s.n <= MAX_N) { blend(rec.goods[lot], s, s.n); snap(rec, c); return 1; }
  if (Object.keys(rec.goods).length >= Math.min(LOTS, B.premises(c.key, rec.kind).cap)) return false;
  rec.goods[rec.q = int(rec.q, 1, 1e9, 1)] = { ...s, m: own(rec.pr, s.id) ? int(rec.pr[s.id], PCT.min, PCT.max, PCT.start) : PCT.start };
  rec.q++;
  snap(rec, c);
  return 1;
});
// (a garment or a tool with its own colour or wear is another lot)
const sameLot = (a, b) => JSON.stringify({ ...extraOf(a), g: 0, day: 0, val: 0 }) === JSON.stringify({ ...extraOf(b), g: 0, day: 0, val: 0 });
function out(rec, c, n) {
  const s = own(rec.goods, c.lot) ? rec.goods[c.lot] : null;
  if (!s || s.id !== c.id || !(n >= 1) || s.n < n) return null;
  const got = { ...bare(s), n };
  s.n -= n;
  if (s.n <= 0) delete rec.goods[c.lot];
  return got;
}
CLAIMS.shop_take = asked((g, c, rec) => { const s = out(rec, c, int(c.n, 0, MAX_N, 0)); return s ? { got: s } : false; });
CLAIMS.shop_price = asked((g, c, rec) => {
  if (!own(ITEMS, c.id) || !Number.isFinite(c.m)) return false;
  const m = int(c.m, PCT.min, PCT.max, PCT.start);
  if (Object.keys(rec.pr).length > 80) rec.pr = {};
  rec.pr[c.id] = m;
  for (const s of Object.values(rec.goods)) if (s.id === c.id) s.m = m;
  snap(rec, c);
  return 1;
});
CLAIMS.shop_hours = asked((g, c, rec) => { if (!HOUR_IDS.includes(c.hours)) return false; rec.hours = c.hours; rec.sun = c.sun ? 1 : 0; snap(rec, c); return 1; });
CLAIMS.shop_collect = asked((g, c, rec) => { if (!(rec.till > 0)) return false; const coins = Math.round(rec.till); rec.till = 0; snap(rec, c); return { pay: coins }; });
CLAIMS.shop_snap = asked((g, c, rec) => { if (c.by !== rec.by) return false; snap(rec, c); return 1; });
CLAIMS.shop_buy = asked((g, c, rec) => {
  const n = int(c.n, 0, 99, 0), B = g.business;
  if (g.law?.refuses(c.by)) return false;   // (hunted: nobody sells them anything, law.js)
  if (B.mayManage(rec, c.by) || !onSale(rec, B.premises(c.key, rec.kind).cap).includes(String(c.lot)) || !own(rec.goods, c.lot) || unitPrice(rec.goods[c.lot]) !== c.p) return false;
  const s = out(rec, c, n);
  if (!s) return false;
  B.record(rec, [B.now(), '@' + (cleanName(c.nm) || '?'), s.id, n, c.p * n]);
  return { got: s };
}, true);

export class Business {
  constructor(game) {
    this.game = game;
    this.now = () => madridMs();   // (the tests put another one)
    this.clear();
  }
  clear() {
    this.shops = new Map();     // "tx,ty" → { key, k }
    this.day = new Map();       // day → { sig, by: Map key → visits }
    this.trips = new Map();     // neighbour → their trips today
    this.esc = [];              // what is handed over and not answered yet
    this.seen = {};             // (the owner) key → [n, coins] last told
    this.fr = {};               // (the owner) key → { neighbour: days counted }
    this.logged = new Map();    // key → ms of the last sale seen here
    this.scanT = 0; this.secT = 0; this.limboT = 0; this.rescueT = RESCUE; this.snapAt = new Map();
    this.said = new Set(); this.told = false; this.v = 0;
    this.memo = new Map();
  }
  get world() { return this.game.world; }
  decides() { const b = this.game.barrow; return !b || b.decides(); }
  reset(save) {
    this.clear();
    const B = isMap(save?.biz) ? save.biz : {};
    if (isMap(B.seen)) this.seen = B.seen;
    if (isMap(B.fr)) this.fr = B.fr;
    if (Array.isArray(B.esc)) this.esc = B.esc.filter(e => isMap(e) && typeof e.q === 'string' && typeof e.key === 'string').map(e => ({ ...e, at: this.game.time, live: false }));
    this.scan();
  }
  save(o) {
    const out = {};
    if (Object.keys(this.seen).length) out.seen = this.seen;
    if (Object.keys(this.fr).length) out.fr = this.fr;
    if (this.esc.length) out.esc = this.esc.map(({ live, done, at, ...e }) => e);
    if (Object.keys(out).length) o.biz = out;
  }
  // ---------- the records ----------
  scan() {
    this.scanT = SCAN;
    const w = this.world, was = this.shops;
    this.shops = new Map();
    if (w?.deltas) for (const [k, d] of w.deltas) if (d?.shop && !k.startsWith('u:')) for (const key of Object.keys(d.shop)) if (sound(d.shop[key]) && chunkKey(...xyOf(key)) === k) this.shops.set(key, { key, k });
    for (const key of this.shops.keys()) if (!this.logged.has(key)) this.logged.set(key, this.at(key).log?.at(-1)?.[0] || 0);   // (what was sold before is not news)
    if (was.size !== this.shops.size || [...this.shops.keys()].some(k => !was.has(k))) { this.v++; this.day.clear(); this.trips.clear(); }
  }
  at(key) { const e = this.shops.get(key), r = e && this.world.deltas.get(e.k)?.shop?.[key]; return sound(r) ? r : null; }
  list() { const out = []; for (const { key } of this.shops.values()) { const rec = this.at(key); if (rec) out.push({ key, rec }); } return out; }
  mayManage(rec, id) { return !!rec && typeof id === 'string' && (rec.by === id || areCouple(this.game.family?.v, rec.by, id)); }
  mine(rec) { return this.mayManage(rec, me()); }
  has(kind) { return this.list().some(e => e.rec.by === me() && e.rec.kind === kind); }
  nameOf(rec) { return t(`biz.name.${rec.kind}`, { name: rec.by === me() ? this.game.player?.name || rec.nm : rec.nm || '?' }); }
  theOf(rec) { return t(`biz.the.${rec.kind}`, { name: rec.by === me() ? this.game.player?.name || rec.nm : rec.nm || '?' }); }   // (the same, within a sentence)
  whoName(who) { return who?.[0] === '@' ? who.slice(1) : PEOPLE[who]?.name || t('biz.traveller'); }
  // Something of a record changed here (whoever decides): saved and sent, nothing to draw again in the chunk
  touched(key) { this.v++; this.memo.delete(key); const [x, y] = xyOf(key); this.world.note(Math.floor(x / CHUNK), Math.floor(y / CHUNK)); this.notice(key); }
  // (live.js applyChunk) Changes of a chunk have come
  onOps(k, ops) {
    let any = false;
    for (const [f, c, v] of ops) {
      if (f === 'shop') { any = true; if (typeof c === 'string' && v !== undefined) this.later = (this.later || new Set()).add(c); }
      else if (f === 'placed' || f === 'pos') this.memo.clear();
    }
    if (any) { this.scan(); this.v++; this.memo.clear(); for (const c of this.later || []) this.notice(c); this.later = null; }
  }
  // (whoever decides) A guest's changes of a chunk, before applying them: the records are not theirs to write, nor what stands in
  // somebody else's business theirs to take away. → { ok, back }
  arbitrate(peer, k, ops) {
    const d = this.world?.deltas.get(k);
    let ok = null, back = null;
    const no = (i, op) => { ok ||= ops.slice(0, i); (back ||= []).push(op); };
    for (let i = 0; i < ops.length; i++) {
      const [f, c, v] = ops[i], tile = typeof c === 'string' ? (f === 'pos' ? c.replace(/^placed:/, '') : c) : null;
      if (f === 'shop') { no(i, tile === null ? (d?.shop ? ['shop', null, structuredClone(d.shop)] : ['shop']) : d?.shop?.[c] === undefined ? ['shop', c] : ['shop', c, structuredClone(d.shop[c])]); continue; }
      if ((f === 'placed' || f === 'pos') && this.shops.size && d && (tile !== null ? d.placed?.[tile] && d.placed[tile] !== v && BIZ_THINGS.has(parsePlaced(d.placed[tile])[0]) && (f === 'placed' || c.startsWith('placed:')) && this.heldBy(tile, peer?.id) : f === 'placed' && Object.keys(d.placed || {}).some(q => BIZ_THINGS.has(parsePlaced(d.placed[q])[0]) && this.heldBy(q, peer?.id)))) {
        no(i, d[f]?.[c] === undefined ? (tile === null ? [f, null, structuredClone(d[f])] : [f, c]) : [f, c, structuredClone(d[f][c])]);
        continue;
      }
      ok?.push(ops[i]);
    }
    return { ok: ok || ops, back: back || [] };
  }
  // The business a counter, a shelf or a crate belongs to, if id may not take it away: its record, or null. A counter in use is
  // nobody's to take away until its business is closed
  heldBy(tile, id) {
    for (const { key, rec } of this.list()) {
      if (key === tile) return rec;
      if (this.mayManage(rec, id)) continue;
      if (this.premises(key, rec.kind).shelves.some(s => s.tile === tile)) return rec;
    }
    return null;
  }
  // (game.js pickUp) Why that cannot be taken away, or ''
  protects(o) {
    if (!this.shops.size || this.game.scene !== this.world || !BIZ_THINGS.has(o?.placed) || (o.layer || 'placed') !== 'placed' || !o.tile) return '';
    const rec = this.heldBy(String(o.tile), me());
    return rec ? t(this.mine(rec) ? 'biz.why.close_first' : 'biz.why.not_yours', { place: this.theOf(rec) }) : '';
  }
  // ---------- the premises ----------
  // A counter's place: { x, y (its middle), yaw, fx, fy (where a customer stands) }, or null if there is none
  counter(key) {
    const [tx, ty] = xyOf(key), d = this.world?.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK)), raw = d?.placed?.[key];
    if (!raw || parsePlaced(raw)[0] !== COUNTER) return null;
    const [x0, y0, yaw] = d.pos?.[`placed:${key}`] || [tx + 0.5, ty + 0.5, (parsePlaced(raw)[1] || 0) % 4 * Math.PI / 2];
    const s = [Math.cos(yaw), -Math.sin(yaw)], f = [Math.sin(yaw), Math.cos(yaw)], x = x0 + s[0] * 0.5, y = y0 + s[1] * 0.5;
    return { x, y, yaw, fx: x + f[0] * 0.95, fy: y + f[1] * 0.95 };
  }
  // What it has near: { ok, why (biz.why.*), cap (kinds), shelves: [{ tile, id, cap, x, y }], seats, tables, barrels, roof }
  premises(key, kind = this.at(key)?.kind || 'shop') {
    const w = this.world, M = this.memo.get(key), now = this.game.time;
    if (M && M.kind === kind && M.touches === w.touches && now - M.at < 5) return M.v;
    const C = this.counter(key), v = { ok: false, why: '', cap: CAP.counter, shelves: [], seats: [], tables: 0, barrels: 0, roof: false };
    if (!C) v.why = 'no_counter';
    else {
      const R = REACH[kind] || REACH.shop, cx = Math.floor(C.x / CHUNK), cy = Math.floor(C.y / CHUNK);
      const n = Math.ceil(R / CHUNK);
      for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
        const d = w.deltas.get(`${wrapIndex(cx + i, CHUNK)},${cy + j}`);
        if (!d?.placed) continue;
        for (const [tile, raw] of Object.entries(d.placed)) {
          const [id, rot] = parsePlaced(raw);
          const what = id === SHELF || id === CRATE ? 'shelf' : SEATS[id] !== undefined ? 'seat' : TABLES.has(id) ? 'table' : id === 'barril' ? 'barrel' : null;
          if (!what) continue;
          const [tx, ty] = xyOf(tile), p = d.pos?.[`placed:${tile}`] || [tx + 0.5, ty + 0.5, (rot || 0) % 4 * Math.PI / 2];
          if (distOf(p[0], p[1], C.x, C.y) > R) continue;
          if (what === 'shelf') v.shelves.push({ tile, id, cap: id === SHELF ? CAP.shelf : CAP.crate, x: p[0], y: p[1], yaw: p[2] });
          else if (what === 'seat') v.seats.push({ tile, id, x: p[0], y: p[1], yaw: p[2] });
          else if (what === 'table') v.tables++;
          else v.barrels++;
        }
      }
      // (a shelf between two counters serves the nearer one)
      if (this.shops.size > 1) v.shelves = v.shelves.filter(s => ![...this.shops.keys()].some(q => { if (q === key) return false; const O = this.counter(q), a = O && distOf(O.x, O.y, s.x, s.y), b = distOf(C.x, C.y, s.x, s.y); return O && (a < b || (a === b && q < key)); }));
      const order = (a, b) => (a.tile < b.tile ? -1 : 1);
      v.shelves.sort(order); v.seats.sort(order);
      v.cap = Math.min(CAP.max, v.shelves.reduce((q, s) => q + s.cap, CAP.counter));
      v.roof = !!w.at('roof', Math.floor(C.x), Math.floor(C.y));
      v.why = kind !== 'tavern' ? '' : !v.roof ? 'roof' : !v.barrels ? 'barrel' : v.seats.length < 2 ? 'seats' : !v.tables ? 'table' : '';
      v.ok = !v.why;
    }
    this.memo.set(key, { kind, touches: w.touches, at: now, v });
    return v;
  }
  // Which lots each piece shows: [{ tile, lots: [stack…] }], the counter's first
  shown(key) {
    const rec = this.at(key), P = rec && this.premises(key, rec.kind);
    if (!P) return [];
    const L = onSale(rec, P.cap), out = [{ tile: key, lots: L.splice(0, CAP.counter) }];
    for (const s of P.shelves) out.push({ tile: s.tile, lots: L.splice(0, s.cap) });
    return out.map(e => ({ tile: e.tile, lots: e.lots.map(l => rec.goods[l]) }));
  }
  isOpen(rec) { const now = this.now(), day = Math.floor(now / DAY); return isOpenAt(rec, (now - day * DAY) / HOUR, dayKind(day)); }
  // How far its counter is from the neighbours' paths
  far(key) {
    const C = this.counter(key);
    if (!C) return Infinity;
    let b = Infinity;
    for (const [x, y] of Object.values(WALK_NODES)) b = Math.min(b, distOf(x, y, C.x, C.y));
    return b;
  }
  // ---------- the visits ----------
  people() { return Object.keys(PEOPLE).filter(id => !PEOPLE[id].fixed && !PEOPLE[id].law && (!PEOPLE[id].site || hasBuilding(PEOPLE[id].site))); }
  visitsOf(day) {
    const L = this.list().map(e => ({ ...e, d: this.far(e.key) })), T = this.game.days;
    const sig = L.map(e => `${e.key}${e.rec.kind}${e.rec.hours}${e.rec.sun}${Math.round(e.d)}`).sort().join('|') + `|${T?.base}|${this.people().length}`;
    const M = this.day.get(day);
    if (M?.sig === sig) return M.by;
    if (this.day.size > 12) this.day.clear();
    const by = daysVisits(L, day, this.people());
    this.day.set(day, { sig, by });
    return by;
  }
  visitOf(npc, day, key) { return (this.visitsOf(day).get(key) || []).filter(v => v.npc === npc); }
  // (whoever decides) The sales of a business up to a moment; one day at most each time. Returns whether it is up to date
  settle(key, to = this.now()) {
    const rec = this.at(key);
    if (!rec || !this.decides()) return true;
    if (!Number.isFinite(rec.settled) || rec.settled > to + DAY) rec.settled = to;   // (a clock that was wrong)
    let from = Math.max(rec.settled, to - CATCH_UP);
    if (from >= to) return true;
    const day = Math.floor(from / DAY), end = Math.min(to, (day + 1) * DAY);
    const P = this.premises(key, rec.kind), due = (this.visitsOf(day).get(key) || []).filter(v => v.ms > from && v.ms <= end);
    let sold = false;
    if (P.ok && !this.game.law?.refuses(rec.by)) for (const v of due) {
      const got = serve(rec, v, { cap: P.cap, seats: P.seats.length, roll: n => ihash(v.day * 5 + (v.meal || 0), n + 1, this.hash(v.npc + key)) });
      for (const s of got) { this.record(rec, [v.ms, v.npc, s.id, s.n, s.coins]); sold = true; }
      if (got.length && PEOPLE[v.npc]) { const F = (rec.fr ||= {}); if (F['@' + v.npc] !== v.day) { F['@' + v.npc] = v.day; F[v.npc] = (F[v.npc] || 0) + 1; } }
    }
    // (what is on sale never goes off entirely: after some days it is only worth less)
    for (const s of Object.values(rec.goods)) if (perishes(s.id) && Number.isFinite(s.day) && hooks.today() - s.day >= ROT_DAYS) s.day = hooks.today() - ROT_DAYS + 1;
    rec.settled = end;
    // (with nothing sold the moment is only written now and then: it is sent to everybody)
    if (sold || due.length || to - (this.noted?.get(key) || 0) > HOUR) { (this.noted ||= new Map()).set(key, to); this.touched(key); }
    return end >= to;
  }
  hash(s) { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) % 999983; return h; }
  // A sale, in the till, the log and the totals
  record(rec, [ms, who, id, n, coins]) {
    const day = Math.floor(ms / DAY);
    rec.till = (Number.isFinite(rec.till) ? rec.till : 0) + coins;
    rec.log = [...(Array.isArray(rec.log) ? rec.log : []), [Math.round(ms), who, id, n, coins]].slice(-LOG);
    rec.tot = [(rec.tot?.[0] || 0) + n, (rec.tot?.[1] || 0) + coins];
    const H = (rec.hist ||= {}), h = H[day] || [0, 0];
    H[day] = [h[0] + n, h[1] + coins];
    for (const q of Object.keys(H).sort((a, b) => a - b).slice(0, -HIST)) delete H[q];
    const B = (rec.best ||= {}), b = B[id] || [0, 0];
    B[id] = [b[0] + n, b[1] + coins];
    const ids = Object.keys(B);
    if (ids.length > BEST) delete B[ids.sort((p, q) => B[p][1] - B[q][1])[0]];
  }
  // ---------- asking ----------
  snapshot() {
    const g = this.game, hh = {};
    for (const id of Object.keys(PEOPLE)) { const f = g.neighbors?.friends?.[id]; if (f && g.neighbors.hearts(id)) hh[id] = g.neighbors.hearts(id); }
    return { sn: { rl: g.rep?.counts === false ? 2 : g.rep?.index ?? 2, hh }, nm: g.player?.name || '' };
  }
  // esc: what is handed over: { give: a stack, coins }. done(ok, answer)
  ask(kind, key, data, esc, done) {
    const g = this.game, w = this.world, q = randomId(), k = chunkKey(...xyOf(key)), c = { key, q, ...this.snapshot(), ...data };
    if (this.decides()) {
      const d = w.delta(...xyOf(k), true), extra = {};
      let ok = false;
      try { ok = !!CLAIMS[kind](g, { by: me(), k: kind, ...c }, d, k, extra); } catch (e) { reportFault(e, 'Business.ask'); }
      if (ok) w.note(...xyOf(k));
      this.finish({ q, kind, key, ...esc, done }, { ok, ...extra });
      return;
    }
    const e = { q, kind, key, ...esc, done, at: g.time, live: true };
    this.esc.push(e);
    e.n = g.barrow.claim(kind, k, c, v => { if (v) this.finish(e, v); else { e.live = false; e.at = g.time; } });
    g.onSave?.();
  }
  waiting(kind = null) { return this.esc.some(e => e.live && (!kind || e.kind === kind)); }
  finish(e, v) {
    const g = this.game, i = this.esc.indexOf(e);
    if (i >= 0) this.esc.splice(i, 1);
    if (v.ok) {
      // (the answer comes with the request's own fields, so what it gives has its own names: got, pay)
      const s = isMap(v.got) && (e.kind === 'shop_take' || e.kind === 'shop_buy') ? cleanStack(v.got) : null;
      if (s && e.eat) this.eatNow(s); else if (s) this.hand(s);
      if (e.kind === 'shop_collect' && v.pay > 0) g.addMoney(v.pay);
    } else {
      if (e.give) this.hand(e.give);
      if (e.coins > 0) g.addMoney(e.coins);
    }
    this.v++;
    g.onSave?.();
    try { e.done?.(!!v.ok, v); } catch (err) { reportFault(err, 'Business.finish'); }
  }
  // Requests whose answer did not come: what the record says of them; with nothing, given back (the request is gone)
  limbo() {
    const g = this.game, L = g.live;
    if (!this.esc.length || (L?.joined && !this.decides() && !L.hostConn)) return;
    for (const e of [...this.esc]) {
      if (e.live || g.time - e.at < LIMBO_WAIT) continue;
      const d = this.world.deltas.get(chunkKey(...xyOf(e.key))), rec = this.at(e.key), a = Array.isArray(rec?.ack) && rec.ack.find(x => x[0] === e.q), c = e.n && d?.claim?.[e.n];
      if (a) this.finish(e, { ok: true, ...(isMap(a[1]) ? a[1] : {}) });
      else if (c && c.ok === undefined && !this.decides()) continue;   // (whoever decides will still answer it)
      else this.finish(e, { ok: !!c?.ok, ...(c?.ok ? c : {}) });
    }
  }
  hand(s) { const g = this.game, { id, n, ...x } = s, left = g.inv.add(id, n, Object.keys(x).length ? x : undefined); if (left > 0) g.gather?.throwOut(id, left, Object.keys(x).length ? x : undefined); }
  // Eaten (or drunk) at the counter: bought, never through the backpack
  eatNow(s) {
    const g = this.game, I = g.inv, slots = I.slots;
    // (as from the hand: the slots are put back as they were)
    const keep = slots[I.selected], inf = I.infinite;
    slots[I.selected] = { ...s, n: 2 };
    I.infinite = false;
    try { g.gather.eat(I.selected); } finally {
      const left = slots[I.selected]?.n;
      slots[I.selected] = keep; I.infinite = inf; I.changed();
      if (left >= 2) this.hand({ ...s, n: 1 });   // (it would have done nothing: kept)
    }
  }
  // What the window does
  open(key, kind, done) { this.ask('shop_open', key, { kind }, {}, done); }
  close(key, done) { this.ask('shop_close', key, {}, {}, done); }
  // (n of a slot of the backpack)
  put(key, i, n, done) {
    const I = this.game.inv, s = I.slots[i], rec = this.at(key);
    if (!s || !rec || s.map || !sellable(s, rec.kind)) return done?.(false);
    const got = I.take(i, Math.min(n, s.n, MAX_N), true);
    if (!got) return done?.(false);
    this.ask('shop_put', key, { s: { ...got } }, { give: got }, done);
  }
  take(key, lot, n, done) {
    const s = this.at(key)?.goods?.[lot];
    if (!s) return done?.(false);
    n = Math.min(n, s.n, Math.max(0, this.game.inv.room(s.id)));
    if (n < 1) return done?.(false, { full: true });
    this.ask('shop_take', key, { lot: String(lot), id: s.id, n }, {}, done);
  }
  price(key, id, m, done) { this.ask('shop_price', key, { id, m: int(m, PCT.min, PCT.max, PCT.start) }, {}, done); }
  hours(key, hours, sun, done) { this.ask('shop_hours', key, { hours, sun: sun ? 1 : 0 }, {}, done); }
  collect(key, done) { this.ask('shop_collect', key, {}, {}, done); }
  buy(key, lot, n, done, eat = false) {
    const g = this.game, s = this.at(key)?.goods?.[lot];
    if (!s || n < 1) return done?.(false);
    if (g.law?.refuses()) { hud.toast(t('law.refused_shop'), 'warn'); return done?.(false); }
    const p = unitPrice(s), coins = p * n;
    if (g.money < coins) return done?.(false, { poor: true });
    if (!eat && g.inv.room(s.id) < n) return done?.(false, { full: true });
    g.addMoney(-coins);
    this.ask('shop_buy', key, { lot: String(lot), id: s.id, n, p }, { coins, ...(eat && { eat: 1 }) }, done);
  }
  // ---------- the counter, the shelves and the crates (game.js placedAction) ----------
  // The business that piece is of: its key, or null (a counter with none yet is its own)
  keyFor(o) {
    if (!o?.tile) return null;
    const tile = String(o.tile);
    if (o.placed === COUNTER) return tile;
    for (const key of this.shops.keys()) if (this.premises(key).shelves.some(s => s.tile === tile)) return key;
    return null;
  }
  action(o, pick) {
    const key = this.keyFor(o), rec = key && this.at(key), g = this.game, go = () => g.onBiz?.(key);
    if (!ON || g.scene !== this.world) return pick;
    if (!key) return { text: t('biz.why.no_counter_near'), run: () => { Audio.blip(); g.gather.float(t('biz.why.no_counter_near'), '#ffd9a0'); }, alt: pick };
    if (!rec) return { text: t('biz.action.open'), run: go, alt: pick };
    const held = this.protects(o);
    return this.mine(rec) ? { text: t('biz.action.manage', { place: this.theOf(rec) }), run: go, alt: held ? null : pick } : { text: t('biz.action.buy', { place: this.theOf(rec) }), run: go };
  }
  // ---------- each frame ----------
  update(dt) {
    const g = this.game;
    if (!this.world || !g.player) return;
    if ((this.scanT -= dt) <= 0) this.scan();
    if ((this.limboT -= dt) <= 0) { this.limboT = LIMBO; this.limbo(); }
    if (!this.shops.size) return;
    if ((this.secT -= dt) <= 0) {
      // (a business a frame while there are days behind; then once a second)
      let done = true;
      if (this.decides()) for (const key of this.shops.keys()) if (!this.settle(key)) { done = false; break; }
      this.secT = done ? 1 : 0;
      if (done && !Profile.server) this.ownerTick();
    }
    if (!Profile.server) try { this.drawn(); } catch (e) { reportFault(e, 'Business.drawn'); }
  }
  // The owner's: what was sold while away, the friendship of who bought, what the neighbours think of you now, a lost counter
  ownerTick() {
    const g = this.game, id = me();
    for (const { key, rec } of this.list()) {
      if (rec.by !== id) continue;
      const was = this.seen[key], now = rec.tot || [0, 0];
      if (!was) this.seen[key] = [now[0], now[1]];
      else if (!this.told && now[0] > was[0]) hud.toast(t('biz.away_summary', { place: this.theOf(rec), n: now[0] - was[0], coins: now[1] - was[1], till: rec.till }), 'money');
      if (was) this.seen[key] = [now[0], now[1]];
      const F = (this.fr[key] ||= {});
      for (const [npc, n] of Object.entries(rec.fr || {})) {
        if (npc[0] === '@' || !PEOPLE[npc]) continue;
        const more = Math.min(7, n - (F[npc] || 0));
        if (more > 0) g.neighbors?.addPoints(npc, 2 * more);
        F[npc] = n;
      }
      const day = Math.floor(this.now() / DAY);
      if (this.snapAt.get(key) !== day && !this.waiting()) { this.snapAt.set(key, day); this.ask('shop_snap', key, {}, {}); }
      if (!this.counter(key) && (this.rescueT -= 1) <= 0) { this.rescueT = RESCUE; this.rescue(key, rec); }
    }
    this.told = true;
    for (const key of Object.keys(this.seen)) if (!this.shops.has(key)) { delete this.seen[key]; delete this.fr[key]; }
  }
  // The counter is gone (an op, an older game): what was in it comes back to its owner, as it fits
  rescue(key, rec) {
    if (this.waiting()) return;
    if (rec.till > 0) { hud.toast(t('biz.rescue'), 'warn'); this.collect(key); return; }
    const lot = lotIds(rec)[0];
    if (lot === undefined) this.close(key);
    else this.take(key, lot, rec.goods[lot].n);
  }
  // A sale just made, seen by who runs it: a float over the counter
  notice(key) {
    const g = this.game, rec = this.at(key);
    if (!ON || !rec || !Array.isArray(rec.log) || Profile.server) return;
    const last = this.logged.get(key), top = rec.log[rec.log.length - 1]?.[0] || 0;
    this.logged.set(key, Math.max(top, last || 0));
    if (last === undefined || !this.mine(rec) || !g.player || g.scene !== this.world) return;
    const C = this.counter(key), now = this.now();
    if (!C || distOf(C.x, C.y, g.player.x, g.player.y) > FLOAT_R) return;
    let row = 0;
    for (const [ms, who, id, n, coins] of rec.log) if (ms > last && now - ms < 2e4 && ITEMS[id]) g.gather?.floaters.push({ text: t('biz.sold', { coins, name: this.whoName(who), n, item: itemNoun(id) }), color: '#ffe08a', x: C.x, y: C.y, row: row++, t: -1.1 });
    if (row) Audio.coins ? Audio.coins() : Audio.pickup();
  }
  // ---------- the customers, drawn ----------
  // Where a neighbour who goes shopping is (routines.js placeAt's shape), or null. Only when the village's clock is the real one
  errandAt(npc, ms) {
    if (!ON || !this.shops.size || !ROUTINES || !PEOPLE[npc]) return null;
    const g = this.game, now = this.now(), T = this.today;
    if (Math.abs((g.days?.now ?? now) - now) > 6e4) return null;
    const day = Math.floor(ms / DAY);
    // (the day's visits, looked at again once a second)
    if (!T || T.day !== day || Math.abs(T.at - g.time) > 1) { const by = this.visitsOf(day); if (T?.by !== by) this.trips.clear(); this.today = { day, at: g.time, by }; }
    let L = this.trips.get(npc);
    if (!L) { L = []; for (const [key, list] of this.today.by) for (const v of list) if (v.npc === npc) L.push({ v, key, from: 0, to: 0, made: 0 }); this.trips.set(npc, L); }
    for (const e of L) {
      // (made ahead, one a frame: looking for a way round takes some ms)
      if (!e.made && ms > e.v.ms - 20 * 6e4 && ms < e.v.ms + 20 * 6e4 && (ms > e.v.ms - 10 * 6e4 || this.madeAt !== g.frameNo)) { this.madeAt = g.frameNo; this.makeTrip(e); }
      if (e.made === 1 && ms >= e.from && ms < e.to) return this.along(e, ms);
    }
    return null;
  }
  // Their way there and back, made once (a little before they go): e.made 1, or 2 if they are not drawn
  makeTrip(e) {
    const w = this.world, { v, key } = e, C = this.counter(key), rec = this.at(key);
    e.made = 2;
    if (!C || !rec || this.far(key) > NEAR_NODE || !onSale(rec, this.premises(key, rec.kind).cap).length) return;
    const S = slotAt(v.npc, v.ms);
    const home = S.spot, meal = !!v.meal && !home.seat, A = meal ? S.prev : home;
    // (the last leg, off their paths: from the nearest of their points with a way on foot)
    const node = Object.entries(WALK_NODES).map(([n, [x, y]]) => [Math.hypot(x - C.fx, y - C.fy), n]).filter(q => q[0] < LEG && nodesBetween(A.node, q[1]) && nodesBetween(q[1], home.node)).sort((a, b) => a[0] - b[0]).slice(0, 2).find(q => canWalk(w, WALK_NODES[q[1]], [C.fx, C.fy]))?.[1];
    if (!node) return;
    const spot = makeSpot({ key: `biz:${key}`, kind: 'shopping', goal: 'shopping', node, via: [[C.fx, C.fy]], yaw: C.yaw + Math.PI, biz: key });
    const way = (a, b, i, j) => { const R = roadBetween(a, b); return wayRound(w, R.out ? { ...R, out: [R.out[0] + i, R.out[1] + j] } : R); }, Rin = way(A, spot, 0, 1), Rout = way(spot, home, -1, 0), tIn = Rin.len / SPEED * 1000, tOut = Rout.len / SPEED * 1000;
    const first = roadOf(S), start = meal ? S.start : S.start + (first ? first.len / SPEED * 1000 : 0), leave = v.ms - ARRIVE * 1000 - tIn;
    if (leave < start) return;
    let go = v.ms + PAY_AFTER * 1000, seat = null;
    if (rec.kind === 'tavern' && v.meal) {
      const free = this.premises(key, rec.kind).seats.filter(s => w.reaches(C.fx, C.fy, s.x, s.y) && Math.hypot(s.x - C.fx, s.y - C.fy) < REACH.tavern);
      const s = free.length ? free[(Math.floor(ihash(v.day, this.hash(v.npc), 5300) * free.length) + (v.meal || 0)) % free.length] : null;
      if (s) {
        const tSeat = Math.hypot(s.x - C.fx, s.y - C.fy) / SPEED * 1000, end = Math.min(go + SIT_MS, S.until - tOut - tSeat - 6e4);
        if (end > go + tSeat + 6e4) {
          const tx = Math.floor(s.x + Math.sin(s.yaw) * 0.8), ty = Math.floor(s.y + Math.cos(s.yaw) * 0.8), table = TABLES.has(parsePlaced(w.at('placed', tx, ty) || '')[0]);
          seat = { tSeat, until: end, spot: makeSpot({ key: `bizseat:${s.tile}`, kind: 'shopping', goal: 'shopping', node, via: [[s.x - Math.sin(s.yaw) * 0.04, s.y - Math.cos(s.yaw) * 0.04]], yaw: s.yaw, pose: { kind: 'sit', yaw: s.yaw, h: SEATS[s.id] }, tile: xyOf(s.tile), meal: table, biz: key }) };
          go = end + tSeat;
        }
      }
    }
    const to = go + tOut;
    if (to > S.until - 2000) return;
    Object.assign(e, { made: 1, from: meal ? S.start : leave, leave, arrive: leave + tIn, go, to, Rin, Rout, spot, home, A, seat, paid: v.ms + PAY_AFTER * 1000 });
  }
  along(e, ms) {
    const still = s => ({ x: s.x, y: s.y, dx: 0, dy: 0, spot: s, moving: false, yaw: s.yaw, trip: e });
    const walk = (R, d, s) => { const [x, y, dx, dy] = along(R, d); return { x, y, dx, dy, spot: s, moving: true, yaw: null, trip: e }; };
    if (ms < e.leave) return still(e.A);
    if (ms < e.arrive) return walk(e.Rin, (ms - e.leave) / 1000 * SPEED, e.spot);
    const Q = e.seat;
    if (ms < (Q ? e.paid : e.go)) return still(e.spot);
    if (Q && ms < e.go) {
      const line = (a, b, d) => { const L = Math.hypot(b.x - a.x, b.y - a.y) || 1, k = Math.min(1, d / L); return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, dx: (b.x - a.x) / L, dy: (b.y - a.y) / L, spot: e.seat.spot, moving: true, yaw: null, trip: e }; };
      if (ms < e.paid + Q.tSeat) return line(e.spot, Q.spot, (ms - e.paid) / 1000 * SPEED);
      if (ms < Q.until) return still(Q.spot);
      return line(Q.spot, e.spot, (ms - Q.until) / 1000 * SPEED);
    }
    return walk(e.Rout, (ms - e.go) / 1000 * SPEED, e.home);
  }
  // The gestures and the lines of the customers near the player
  drawn() {
    const g = this.game, p = g.player, now = this.now();
    if (!ON || !ROUTINES || g.scene !== this.world) return;
    for (const n of g.neighbors?.people || []) {
      const T = this.trips.get(n.id);
      if (!T) continue;
      for (const e of T) {
        if (e.made !== 1 || now < e.arrive || now > e.paid + 3000 || n.hidden || distOf(n.x, n.y, p.x, p.y) > SAY_R + 14) continue;
        const ph = now < e.v.ms ? 'look' : 'pay', mark = `${e.v.npc}${e.v.ms}${ph}`;
        if (this.said.has(mark) || Math.hypot(n.x - e.spot.x, n.y - e.spot.y) > 1 || n.talkWith) continue;
        if (ph === 'pay' && now < e.v.ms + 900) continue;   // (the sale has come by then, also to a guest)
        if (this.said.size > 60) this.said.clear();
        this.said.add(mark);
        if (ph === 'look') { g.social?.emote(n, 'inspect', { local: true }); continue; }
        const rec = this.at(e.key), got = (rec?.log || []).filter(x => x[1] === n.id && x[0] === e.v.ms);
        g.social?.emote(n, got.length ? 'pay' : 'shrug', { local: true });
        if (distOf(n.x, n.y, p.x, p.y) > SAY_R) continue;
        const L = tList(got.length ? 'biz.say.buy' : Object.keys(rec?.goods || {}).length ? 'biz.say.dear' : 'biz.say.empty');
        if (L.length) g.social?.say(n, formatMessage(L[Math.floor(ihash(e.v.day, this.hash(n.id), 5301) * L.length)], { item: got.length ? itemNoun(got[0][2]) : '', name: p.name }), { name: PEOPLE[n.id].name });
      }
    }
  }
  onEnd() { this.trips.clear(); }
}
