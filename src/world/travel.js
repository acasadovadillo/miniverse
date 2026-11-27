// Who walks the roads, where and when (docs/planes/realismo/PLAN-R7-mundo.md §3.9, phase R7-6). A schedule, not a simulation:
// each road has a few travellers a day (one for every SLOT_M of it, up to three), and where each one is comes from the world
// clock and the road's id alone. So two players, their world server and any worker see the same pedlar at the same spot
// without a word sent. Pure, like roads.js: nothing of the game, the page or the network.
//
// The clock is the real one (time.js: a game day is a day), so a traveller does not walk one road once: he works it. He sets out
// in the morning from one end, walks to the other at his own pace, stops there a while (selling, resting, a meal) and walks
// back, again and again, until no stretch would end before dusk. Then he sleeps at the camp by his road, if there is a kept
// one within CAMP_R and he is one who camps tonight (its fire lit and its tent shut; at WAKE he walks out to the road and
// away to its far end), or in the hamlet he is at (out of sight: tomorrow the road has other travellers).
//
//   plan.near(x, y, nowMs, r, out)   the travellers within r of a point now: out[] gets { slot, x, y, ux, uy, k, … }; how many
//   plan.where(slot, nowMs, o)       where one of them is now (o: reused), or o.vis false: out of sight
//   plan.slots(e, r, day)            the day of a road: its travellers, each with its timeline
//   plan.campNight(s, day)           who sleeps at a camp site the night of that day: [{ slot, t0, t1 }]
//   plan.campState(s, nowMs)         1: someone sleeps there now; 2: the morning after (cold ashes); 0: nothing
// Hours are local (the road's longitude, as time.js hourAt, at its first point) and absolute: day D starts at D × 24.
import { ihash } from '../util.js';
import { wrapX, nearX, dxOf, lonOf } from './planet.js';
import { stateOf } from './names.js';
import { MAX_EDGE } from './roads.js';

export const TYPES = ['pedlar', 'pilgrim', 'woodcutter', 'fisher'];
const SHARE = [0.32, 0.2, 0.26, 0.22];          // (how many of each, of every hundred)
export const SLOT_M = 500, MAX_SLOTS = 3;       // a traveller a day for this much road
export const SPEED = [1.55, 2.05];              // m/s: slower than the player's 3.2 walk
export const START = [6.5, 11];                 // the hour they set out
// Hours at each end (the pedlar sells in the hamlet, the pilgrim prays and rests; the woodcutter and the fisher come and go
// between their work and the hamlet), and how many stretches of road a day at most
export const PAUSE = { pedlar: [0.9, 2.2], pilgrim: [1.2, 2.8], woodcutter: [0.4, 1.0], fisher: [0.5, 1.3] };
const LEGS = { pedlar: 8, pilgrim: 4, woodcutter: 14, fisher: 12 };
export const STOP = [18.9, 20.2];               // no stretch is begun that would end after this
export const CAMP_R = 120;                      // a camp this near the road is his road's
export const CAMP_P = 0.5;                      // of those whose road has one, how many sleep there
export const WAKE = [7, 7.7];                   // they leave the camp
export const MORNING = 12;                      // until then, the ashes of last night
const OFF_K = 1.3;                              // (from the road to the camp is not straight: its time, by this)
const HOUR = 36e5;
const GRAPH = 16 + MAX_EDGE * 1.5 + 250;        // (roads.js GRAPH_R: the hamlets that make the graph round a point)
const HAMLET_R = 1500;                          // (how far a camp looks for its hamlet: explore.js hamletFar)
export const WALK = 0, PAUSE_AT = 1, OFF = 2, SLEEP = 3;   // what a stretch of the timeline is

// A whole number for a road's id (FNV-1a): the same in every thread
export function idHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h | 0; }
const lerp = ([a, b], k) => a + (b - a) * k;
// The local hour now at the longitude of x, from the world clock (ms), as a count from day 0
export const hoursAt = (nowMs, x) => nowMs / HOUR + lonOf(x) / 15;
function lruSet(m, k, v, max) { m.set(k, v); if (m.size > max) m.delete(m.keys().next().value); return v; }

// The point s metres along a road (its pts and at), into o: x (not wrapped, as the road's), y and the way it goes (ux, uy)
export function along(r, s, o) {
  const at = r.at, n = r.n, P = r.pts;
  if (!(s > 0)) s = 0; else if (s > r.len) s = r.len;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (at[m] <= s) lo = m; else hi = m; }
  const l = at[hi] - at[lo], k = l > 0 ? (s - at[lo]) / l : 0, ax = P[lo * 2], ay = P[lo * 2 + 1], dx = P[hi * 2] - ax, dy = P[hi * 2 + 1] - ay, d = Math.hypot(dx, dy) || 1;
  o.x = ax + dx * k; o.y = ay + dy * k; o.ux = dx / d; o.uy = dy / d; o.i = lo;
  return o;
}

export class TravelPlan {
  // roads: the world's (roads.js); line(e): its road if it is known already, else undefined (the main thread does not trace one
  // in a frame: it waits for the worker's). By default, roads.line (traced there and then: the tests, a worker)
  // lazy: the camps by a road are looked for only once the land along it is known (warm, a little at a time); meanwhile its
  // travellers are not out. Off: there and then, whatever it costs
  constructor(roads, { line = null, lazy = false } = {}) {
    this.roads = roads; this.lazy = lazy; this.warmed = new Set();
    this.sites = roads.sites;
    this.line = line || (e => roads.line(e));
    this.days = new Map();     // 'edge|day' → its slots
    this.campsOf = new Map();  // an edge's id → the camps by it [{ s, j, sj, d }]
    this.nights = new Map();   // a camp's key|day → who sleeps there
    this.tmp = { x: 0, y: 0, ux: 0, uy: 0, i: 0 };
  }

  // ---------- the camps by a road ----------
  // The kept camps within CAMP_R of a road: where on it is the nearest point (j, sj metres) and how far it is (d), the nearest first
  camps(e, r) {
    const had = this.campsOf.get(e.id);
    if (had) return had;
    const S = this.sites, b = r.box, mx = (b[0] + b[2]) / 2, my = (b[1] + b[3]) / 2, R = Math.hypot(b[2] - b[0], b[3] - b[1]) / 2 + CAMP_R, out = [];
    for (const s of S.near(wrapX(mx), my, R, ['campamento'], 'minor')) {
      const sx = nearX(s.x, mx);
      let bd = CAMP_R, bj = -1;
      for (let i = 0; i < r.n; i++) { const d = Math.hypot(r.pts[i * 2] - sx, r.pts[i * 2 + 1] - s.y); if (d < bd) { bd = d; bj = i; } }
      if (bj < 0 || stateOf(s, this.hamletOf(s)) === 'empty') continue;
      out.push({ s, j: bj, sj: r.at[bj], d: bd });
    }
    out.sort((p, q) => p.d - q.d || (p.s.key < q.s.key ? -1 : 1));
    return lruSet(this.campsOf, e.id, out, 400);
  }
  // Is the roads' graph round (x, y) known, so that asking for it works nothing out? (explore.js warms it ahead of the player.)
  // Nothing is computed here
  known(x, y, r) {
    const S = this.sites;
    let ok = true;
    S.eachCell('hamlet', x, y, r + GRAPH, (ix, iy) => { if (ok && !S.cells.has(`hamlet:${ix},${iy}`)) ok = false; });
    if (!ok) return false;
    for (const n of this.roads.nodesNear(x, y, MAX_EDGE / 2 + 250 + r)) if (!this.roads.links.has(n.id)) return false;
    return true;
  }
  // Is the land along a road known (the sites of its cells, and the hamlets round the camps by it: sites.js)? If not, a little
  // more of it, a cell at a time until `until` (performance.now()); true once it all is
  warm(e, r, until) {
    if (!this.lazy || this.warmed.has(e.id)) return true;
    const S = this.sites, now = () => globalThis.performance?.now?.() ?? 0, step = Math.max(1, Math.floor(r.n / 14));
    for (let i = 0; i < r.n; i += step) while (S.warm(wrapX(r.pts[i * 2]), r.pts[i * 2 + 1], CAMP_R + 70, ['minor'])) if (now() > until) return false;
    while (S.warm(wrapX(r.pts[r.n * 2 - 2]), r.pts[r.n * 2 - 1], CAMP_R + 70, ['minor'])) if (now() > until) return false;
    const b = r.box, mx = (b[0] + b[2]) / 2, my = (b[1] + b[3]) / 2;
    for (const s of S.near(wrapX(mx), my, Math.hypot(b[2] - b[0], b[3] - b[1]) / 2 + CAMP_R, ['campamento'], 'minor')) while (S.warm(s.x, s.y, HAMLET_R, ['hamlet'])) if (now() > until) return false;
    this.warmed.add(e.id);
    return true;
  }
  ready(e, r) { return !this.lazy || this.warmed.has(e.id); }
  // How far the first hamlet within 1500 m is, as explore.js hamletFar has it for a camp's state (names.js stateOf)
  hamletOf(s) { for (const h of this.sites.near(s.x, s.y, HAMLET_R, ['aldea'])) return Math.hypot(dxOf(h.x, s.x), h.y - s.y); return Infinity; }

  // ---------- the day of a road ----------
  // Its travellers that day: [{ id, e, r, day, i, n, type, sex, speed, from (0: the a end, 1: the b end), seed, legs: the timeline
  // [{ k, t0, t1, s0, s1, leg }], camp (or null), end }]. Made once for each road and day
  slots(e, r, day) {
    const key = `${e.id}|${day}`, had = this.days.get(key);
    if (had) return had;
    const eh = idHash(e.id), n = Math.max(1, Math.min(MAX_SLOTS, Math.round(r.len / SLOT_M))), out = [];
    for (let i = 0; i < n; i++) {
      const h = k => ihash(eh, day * 4 + i, 9100 + k);
      let type = TYPES[TYPES.length - 1];
      for (let k = 0, acc = 0, u = h(1); k < TYPES.length; k++) { acc += SHARE[k]; if (u < acc) { type = TYPES[k]; break; } }
      const v = SPEED[0] + (SPEED[1] - SPEED[0]) * h(4), from = h(2) < 0.5 ? 0 : 1, L = r.len, legH = L / v / 3600, base = day * 24, stop = base + lerp(STOP, h(5));
      const legs = [], lat = (i - (n - 1) / 2) * 0.9;
      let t = base + lerp(START, h(3)), at = from ? L : 0, leg = 0;
      while (leg < LEGS[type] && t + legH <= stop) {
        legs.push({ k: WALK, t0: t, t1: t + legH, s0: at, s1: L - at, leg });
        t += legH; at = L - at; leg++;
        const p = lerp(PAUSE[type], h(10 + leg));
        legs.push({ k: PAUSE_AT, t0: t, t1: t + p, s0: at, s1: at, leg, lat });
        t += p;
      }
      // (the night is worked out when it is wanted: night)
      out.push({ id: `${e.id}|${day}|${i}`, e, r, day, i, n, type, sex: h(9), speed: v, from, seed: ihash(eh, day * 4 + i, 9200), legs, camp: undefined, end: t, h, at, t, leg, stop,
        dusk: legs.length ? legs[legs.length - 1].t0 : Infinity });
    }
    return lruSet(this.days, key, out, 600);
  }
  // The night of one of them: at the camp of his road (one of them, by the day), or in the hamlet where he is (camp null). It needs
  // the camps by his road (camps): with a lazy plan, only once the land along it is known (warm). false: not yet
  night(slot) {
    if (slot.camp !== undefined) return true;
    const { e, r, h, legs, speed: v, stop, leg } = slot;
    if (!this.ready(e, r)) return false;
    const camps = h(6) < CAMP_P ? this.camps(e, r) : null, c = camps?.length ? camps[Math.floor(h(7) * camps.length) % camps.length] : null;
    slot.camp = c && legs.length ? c : null;
    if (!slot.camp) return true;
    const L = r.len, base = slot.day * 24, at = slot.at, off = c.d * OFF_K / v / 3600, wake = base + 24 + lerp(WAKE, h(8)), there = Math.abs(at - c.sj) / v / 3600, away = at === 0 ? L : 0;
    // (done with the road early, he waits at its end until it is time to go and get there by dusk)
    let t = Math.max(slot.t, stop - there - off);
    const last = legs[legs.length - 1];
    if (last.k === PAUSE_AT) last.t1 = t;
    legs.push({ k: WALK, t0: t, t1: t + there, s0: at, s1: c.sj, leg });
    t += there;
    legs.push({ k: OFF, t0: t, t1: t + off, s0: c.sj, s1: c.sj, out: true, leg });
    t += off;
    legs.push({ k: SLEEP, t0: t, t1: wake, s0: c.sj, s1: c.sj, leg });
    legs.push({ k: OFF, t0: wake, t1: wake + off, s0: c.sj, s1: c.sj, out: false, leg: leg + 1 });
    legs.push({ k: WALK, t0: wake + off, t1: slot.end = wake + off + Math.abs(away - c.sj) / v / 3600, s0: c.sj, s1: away, leg: leg + 1 });
    return true;
  }
  // The stretch of a timeline at hour T, or null; undefined: not known yet (its night, still to be worked out)
  legAt(slot, T) {
    if (T >= slot.dusk && !this.night(slot)) return undefined;
    for (const q of slot.legs) if (T >= q.t0 && T < q.t1) return q;
    return null;
  }

  // ---------- where they are ----------
  // Where one is at the world clock nowMs, into o: { vis, x (wrapped), y, ux, uy, moving, k (WALK…), leg, s, toward (the end he
  // walks to: 0 a, 1 b; -1 the camp), q (the stretch) }. Off the road (to and from the camp): along the straight line to the camp's
  // middle (what is drawn may follow its track instead: travellers.js)
  where(slot, nowMs, o) {
    const r = slot.r, T = hoursAt(nowMs, r.pts[0]), q = this.legAt(slot, T);
    o.q = q; o.vis = !!q && q.k !== SLEEP; o.k = q ? q.k : -1; o.moving = false;
    if (!o.vis) return o;
    const f = (T - q.t0) / (q.t1 - q.t0);
    o.leg = q.leg;
    if (q.k === OFF) {
      const c = slot.camp, p = along(r, c.sj, this.tmp), cx = nearX(c.s.x, p.x), cy = c.s.y + 0.4, k = q.out ? f : 1 - f, dx = cx - p.x, dy = cy - p.y, d = Math.hypot(dx, dy) || 1;
      o.x = wrapX(p.x + dx * k); o.y = p.y + dy * k; o.ux = (q.out ? dx : -dx) / d; o.uy = (q.out ? dy : -dy) / d; o.moving = true; o.s = c.sj; o.toward = q.out ? -1 : slot.from;
      return o;
    }
    const s = q.s0 + (q.s1 - q.s0) * f, p = along(r, s, this.tmp), dir = q.s1 >= q.s0 ? 1 : -1;
    o.s = s; o.toward = q.k === WALK ? (dir > 0 ? 1 : 0) : (s > 0 ? 0 : 1);
    if (q.k === PAUSE_AT) {
      // (standing at the end of the road, a little to one side if there are more of them; facing back along it)
      const back = s > 0 ? -1 : 1;
      o.x = wrapX(p.x - p.uy * q.lat); o.y = p.y + p.ux * q.lat; o.ux = p.ux * back; o.uy = p.uy * back;
      return o;
    }
    o.x = wrapX(p.x); o.y = p.y; o.ux = p.ux * dir; o.uy = p.uy * dir; o.moving = true;
    return o;
  }
  // The travellers within R of (x, y) at nowMs that are out (walking, resting at an end, going to or from a camp): written into
  // out (its objects are kept and reused: { slot, x, y, ux, uy, moving, k, d… }); how many. Only the roads whose line is known.
  // edges: roads.edgesBy of a point there, with a reach of R or more, if asked already
  near(x, y, nowMs, R, out, edges = null) {
    let n = 0;
    const px = wrapX(x);
    for (const [e] of edges || this.roads.edgesBy(px, y, R)) {
      const r = this.line(e);
      if (!r || r.n < 2) continue;
      const off = nearX((r.box[0] + r.box[2]) / 2, px) - (r.box[0] + r.box[2]) / 2;
      if (r.box[0] + off > px + R || r.box[2] + off < px - R || r.box[1] > y + R || r.box[3] < y - R) continue;
      const D = Math.floor(hoursAt(nowMs, r.pts[0]) / 24);
      for (let day = D - 1; day <= D; day++) for (const slot of this.slots(e, r, day)) {
        const o = out[n] || (out[n] = {});
        this.where(slot, nowMs, o);
        if (!o.vis) continue;
        const d = Math.hypot(dxOf(o.x, px), o.y - y);
        if (d > R) continue;
        o.slot = slot; o.d = d; n++;
      }
    }
    return n;
  }

  // ---------- the camps at night ----------
  // Who sleeps at a camp site (s: of sites.js) the night that starts on day D of their roads: [{ slot, t0 (he gets there), t1 (he leaves) }]
  campNight(s, D) {
    const key = `${s.key}|${D}`, had = this.nights.get(key);
    if (had) return had;
    const out = [];
    let unknown = false;
    for (const [e] of this.roads.edgesBy(s.x, s.y, CAMP_R)) {
      const r = this.line(e);
      if (r === undefined || (r && !this.ready(e, r))) { unknown = true; continue; }
      if (!r) continue;
      for (const slot of this.slots(e, r, D)) if (!this.night(slot)) unknown = true; else if (slot.camp?.s.key === s.key) { const q = slot.legs.find(l => l.k === SLEEP); if (q) out.push({ slot, t0: q.t0, t1: q.t1 }); }
    }
    // (with a road still to come from the worker it is not known yet: asked again later)
    return unknown ? out : lruSet(this.nights, key, out, 300);
  }
  // 1: someone sleeps there now (from when he gets there), 2: the morning after (until MORNING), 0: neither. Each by his road's
  // own hour, as where() has it
  campState(s, nowMs) {
    const D = Math.floor(hoursAt(nowMs, s.x) / 24);
    let st = 0;
    for (let day = D - 2; day <= D; day++) for (const q of this.campNight(s, day)) {
      const T = hoursAt(nowMs, q.slot.r.pts[0]);
      if (T >= q.t0 && T < q.t1) return 1;
      if (T >= q.t1 && T < Math.floor(q.t1 / 24) * 24 + MORNING) st = 2;
    }
    return st;
  }
}
