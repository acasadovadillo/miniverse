// The neighbours' routines (docs/planes/gta/PLAN-H-pueblo-vivo.md §2): where each one is at any moment, as a pure function of
// the village's clock (the host's: time.js now), the weekday, the weather of the day and the village's projects. So every game
// and the world server agree with nothing sent. What is only drawn (a chair taken away, someone stopped to talk, a detour
// round what a player built) is neighbors.js's and never goes into it.
//
//   planFor(id, realDay)      their day: [{ h, at, spot }], by hour (h: the nominal hour; at: with the minutes of that day)
//   placeAt(id, nowMs)        { x, y, spot, moving, yaw, slot, until, from, goal } (until: ms the slot ends)
//   slotAt(id, nowMs)         the slot, without the walk: { spot, prev, start, until, i }
//   shopHours(shop, realDay)  [from, to] that day; openAt(id, shop, nowMs): its keeper at the counter, within those hours
//   dayKind(realDay)          'work' | 'sat' | 'sun' (the national holidays count as Sunday)
//
// A day is a list of [hour, place] in PEOPLE[id].routine (work, sat, sun). A place is a point of the village (world/village.js
// WALK_NODES: 'stall', 'pond_w'…) or a token made into one for that day:
//   @home     their chair, and from the hour they go to bed (bed, 23 by default) to half an hour before they leave, their bed
//   @lunch, @dinner, @lunch_long   at home, or in the tavern that day (eatOut)
//   @market   the stall they sell at on Saturdays (the project 'mercado'); @browse, from stall to stall, looking
//   @chapel   a pew (the project 'chapel'); the square until there is one
//   @evening  a stroll, a visit to another neighbour or receiving one; @errand, something to see to
//   @patrol   the constable's round, from point to point; @desk, at his desk in the law office (the project 'law_office')
//   @away     out of the village (those of the tavern: they come and go down the road); seat, their place in the tavern
// A neighbour with only `schedule` (or only `seat` and `hours`) gets a day out of it: nothing else has to be written
import { HOUSES, TAVERN, FOUNTAIN, CHAPEL, LAW_OFFICE, WALK_NODES, WALK_EDGES, hasBuilding, onVillageChange } from './world/village.js';
import { chapelPews, lawOfficePlan } from './world/blueprints.js';
import { SHOPS } from './economy.js';
import { PEOPLE } from './neighbors.js';   // (a cycle, read only inside functions)
import { ihash } from './util.js';
import { apagada } from './opciones.js';

export const ROUTINES = !apagada('routines');
const HOUR = 36e5, DAY = 864e5;
export const SPEED = 2.2;            // tiles a second, walking
const BED_HOUR = 23, WAKE = 0.5, JITTER = 0.08;   // hours
export const BELL_HOUR = 11 + 5 / 6;              // 11:50, Sundays: the bell calls
const CALL = BELL_HOUR + 1 / 60;
// Month and day of the national holidays (they count as Sundays)
const HOLIDAYS = new Set(['1-1', '1-6', '5-1', '8-15', '10-12', '11-1', '12-6', '12-8', '12-25']);
// Their Sunday hours (the rest of the week, economy.js): shorter, never closed the whole day. The tavern's do not change
export const SUNDAY_HOURS = { rosa: [10, 14], bruno: [10, 14], lia: [8, 13], dani: [10, 14] };
const MARKET_OF = { bruno: 'market_a', lia: 'market_b' };
const WET = new Set(['lluvia', 'tormenta', 'nieve']);

// ---------- the calendar ----------
export const weekdayOf = realDay => (((realDay + 4) % 7) + 7) % 7;   // 0 Sunday … 6 Saturday
export function isHoliday(realDay) { const d = new Date(realDay * DAY); return HOLIDAYS.has(`${d.getUTCMonth() + 1}-${d.getUTCDate()}`); }
export const testDay = { kind: null };   // (the tests: the kind of every day)
export function dayKind(realDay) {
  if (testDay.kind) return testDay.kind;
  const w = weekdayOf(realDay);
  return w === 0 || isHoliday(realDay) ? 'sun' : w === 6 ? 'sat' : 'work';
}
export const isBellDay = realDay => dayKind(realDay) === 'sun';
export function shopHours(shop, realDay) {
  const S = SHOPS[shop];
  return S ? (ROUTINES && dayKind(realDay) === 'sun' && SUNDAY_HOURS[shop]) || S.hours : null;
}

// ---------- the world they read ----------
// weather(realDay): that day's weather, as time.js has it for this world; key: when it changes, the plans are made again
const env = { key: '', weather: null };
const plans = new Map(), roads = new Map(), spots = new Map();
const states = new Map(), now = new Map();   // (now: the slot each one is in, until it ends)
export function forget() { now.clear(); states.clear(); plans.clear(); roads.clear(); spots.clear(); graph = null; }
export function setEnv(key, weather) { if (env.key !== key) { env.key = key; plans.clear(); states.clear(); now.clear(); } env.weather = weather; }
onVillageChange(forget);
export const idNum = id => { let h = 7; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 9973; return h; };
const roll = (id, realDay, k) => ihash(realDay, idNum(id), 2600 + k);
const wetDay = (id, realDay) => { const w = env.weather?.(realDay); return WET.has(w) && !PEOPLE[id]?.weather?.likes?.includes(w); };
const here = id => { const d = PEOPLE[id]; return !!d && (!d.site || hasBuilding(d.site)); };
const housed = () => Object.keys(PEOPLE).filter(id => PEOPLE[id].home && here(id));

// ---------- the walk ----------
let graph = null;
function links() {
  if (graph) return graph;
  graph = {};
  for (const [a, b, need] of WALK_EDGES) if ((!need || hasBuilding(need)) && WALK_NODES[a] && WALK_NODES[b]) { (graph[a] ||= []).push(b); (graph[b] ||= []).push(a); }
  return graph;
}
const gap = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
// The shortest way between two nodes: their names, both ends in, or null
export function nodesBetween(from, to) {
  const G = links(), best = { [from]: 0 }, prev = {}, open = new Set([from]);
  while (open.size) {
    let n = null;
    for (const o of open) if (n === null || best[o] < best[n]) n = o;
    if (n === to) { const out = [n]; while (prev[n]) out.unshift(n = prev[n]); return out; }
    open.delete(n);
    for (const m of G[n] || []) { const d = best[n] + gap(WALK_NODES[n], WALK_NODES[m]); if (!(m in best) || d < best[m]) { best[m] = d; prev[m] = n; open.add(m); } }
  }
  return null;
}
// The way from a spot to another: { pts, at: [distance to each], len }
function road(a, b) {
  const k = `${a.key}>${b.key}`;
  let r = roads.get(k);
  if (r) return r;
  const nodes = nodesBetween(a.node, b.node), raw = [];
  // (from a seat or a bed: they stand where they walk to it from)
  for (const p of [...a.via].reverse()) raw.push(p);
  for (const n of nodes || [a.node, b.node]) raw.push(WALK_NODES[n]);
  for (const p of b.via) raw.push(p);
  // (a spot whose node is passed in both directions would be walked to and back: not when they stay under the same roof)
  const same = !!a.room && a.room === b.room, pts = same ? [...[...a.via].reverse().slice(0, -2), ...b.via.slice(2)] : raw;
  const at = [0];
  for (let i = 1; i < pts.length; i++) at.push(at[i - 1] + gap(pts[i - 1], pts[i]));
  roads.set(k, r = { pts, at, len: at[at.length - 1] || 0, from: a, to: b, out: same ? null : [a.via.length, raw.length - 1 - b.via.length] });
  return r;
}
export const roadBetween = (a, b) => road(a, b);
// The point of a road at a distance, and which way it goes: [x, y, dx, dy]
export function along(R, d) {
  const { pts, at } = R;
  if (pts.length < 2) return [pts[0]?.[0] ?? 0, pts[0]?.[1] ?? 0, 0, 1];
  let i = 1;
  while (i < pts.length - 1 && at[i] < d) i++;
  const [a, b] = [pts[i - 1], pts[i]], L = at[i] - at[i - 1] || 1, k = Math.max(0, Math.min(1, (d - at[i - 1]) / L));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, (b[0] - a[0]) / L, (b[1] - a[1]) / L];
}

// ---------- the spots ----------
// A spot: { key, kind (what it is called: npc.where.<kind>), goal (npc.goal.<goal>), node (where it hangs from), via (the points
// from the node to it), x, y, yaw, pose, tile (the piece of furniture it needs, or null), room (indoors: whose), home, work
// (their counter), meal, hidden }
const N = Math.PI, E = Math.PI / 2, W = -Math.PI / 2, S = 0;
const CHAIR = 0.14, STOOL = 0.27, BED = 0.6, PEW = 0.1;
const sit = (yaw, h = CHAIR) => ({ kind: 'sit', yaw, h });
function make(o) {
  const last = o.via[o.via.length - 1] || WALK_NODES[o.node];
  const s = { x: last[0], y: last[1], yaw: null, pose: null, tile: null, room: null, home: null, work: false, meal: false, hidden: false, ...o };
  s.goal ||= s.kind;
  return s;
}
export const makeSpot = make;   // (business.js: before a counter, at a table of a player's tavern)
const spot = (key, fn) => { let s = spots.get(key); if (!s) spots.set(key, s = make({ key, ...fn() })); return s; };
const residents = house => Object.keys(PEOPLE).filter(id => PEOPLE[id].home === house);
// Inside a house: from its door to the room (the same for the whole house: road() takes the first two off indoors)
const enter = H => [[H.x0 + 6.5, H.y1 - 0.5], [H.x0 + 6.5, H.y1 - 1.9]];
// The law office: at the desk, and the bed of the back room (world/blueprints.js lawOfficePlan)
// (where the law office stands in this world: villagesites.js; again whenever the village changes)
let LAW, LX, LY, LAW_IN;
const placeLaw = () => { LAW = lawOfficePlan(LAW_OFFICE); LX = LAW_OFFICE.x0; LY = LAW_OFFICE.y0; LAW_IN = [[LX + 4.5, LY + 8.5], [LX + 4.5, LY + 7.3], [LX + 4.6, LY + 5.6]]; };
placeLaw();
onVillageChange(placeLaw);
const deskSpot = (kind = 'home') => spot(`law:${kind}`, () => ({ kind, goal: kind, node: 'door_law', via: [...LAW_IN, [LX + 5.7, LY + 5.4], [LAW.chair[0] + 0.5, LAW.chair[1] + 0.44]], yaw: S, pose: sit(S, STOOL), tile: LAW.chair, room: 'law_office', home: 'law_office', work: kind === 'law_desk' }));
const lawBed = () => spot('bed:law', () => ({ kind: 'asleep', goal: 'home', node: 'door_law', via: [...LAW_IN, [LX + 5.5, LY + 4.5], [LX + 5.5, LY + 3.2], [LX + 5.9, LY + 2.6]], pose: { kind: 'lie', yaw: S, h: BED }, tile: LAW.bed, room: 'law_office', home: 'law_office' }));
const ROUNDS = ['plaza', 'board', 'p29', 'p34', 'p37', 'p41', 'p43', 'p46', 'p52', 'p55', 'p57', 'p46', 'p37', 'p29', 'easel'];
// A stop of the round: a step aside of the point, where nobody else stands
const roundSpot = node => spot(`round:${node}`, () => { const [x, y] = WALK_NODES[node]; return { kind: 'patrol', node, via: [[x + 0.62, y + 0.72]] }; });
function chairOf(house, i, who, kind = 'home') {
  if (house === 'law_office') return deskSpot();
  const H = HOUSES[house], left = i % 2 === 0, x = H.x0 + (left ? 7.62 : 9.38), y = H.y0 + 4.5;
  return spot(`${kind}:${house}:${i % 2}:${kind === 'visit' ? who : ''}`, () => ({ kind, goal: kind, node: `door_${house}`, via: [...enter(H), [H.x0 + (left ? 6.9 : 9.4), H.y0 + 5.9], [x, y]],
    yaw: left ? E : W, pose: sit(left ? E : W), tile: [H.x0 + (left ? 7 : 9), H.y0 + 4], room: house, home: kind === 'home' ? house : null, who }));
}
// The bed (the second one of a house with two, along the west wall; world/blueprints.js)
function bedOf(house, i) {
  if (house === 'law_office') return lawBed();
  const H = HOUSES[house], second = i > 0;
  return spot(`bed:${house}:${i}`, () => ({ kind: 'asleep', goal: 'home', node: `door_${house}`, via: [...enter(H), [H.x0 + 3.2, H.y0 + (second ? 6.6 : 3.9)], second ? [H.x0 + 2.4, H.y0 + 6.5] : [H.x0 + 2.3, H.y0 + 2.6]],
    pose: { kind: 'lie', yaw: second ? E : S, h: BED }, tile: [H.x0 + 1, H.y0 + (second ? 5 : 1)], room: house, home: house }));
}
const TD = [[TAVERN.x0 + 5.5, TAVERN.y1 - 0.5], [TAVERN.x0 + 5.5, TAVERN.y1 - 1.7]], TX = TAVERN.x0, TY = TAVERN.y0;
// The free places of the tavern: the stool in the middle, the chairs nobody has and three places standing at the bar
const tavernSeats = () => [
  { via: [[TX + 4.5, TY + 4.4], [TX + 4.5, TY + 3.5]], yaw: N, pose: sit(N, STOOL), tile: [TX + 4, TY + 3] },
  { via: [[TX + 4.6, TY + 5.5], [TX + 3.38, TY + 5.5]], yaw: W, pose: sit(W), tile: [TX + 3, TY + 5] },
  { via: [[TX + 5.5, TY + 4.5], [TX + 8.4, TY + 4.5], [TX + 8.38, TY + 5.5]], yaw: W, pose: sit(W), tile: [TX + 8, TY + 5] },
  { via: [[TX + 5.2, TY + 4.5], [TX + 5.5, TY + 3.35]], yaw: N },
  { via: [[TX + 4.5, TY + 4.5], [TX + 3.5, TY + 3.4]], yaw: N },
  { via: [[TX + 4.5, TY + 4.5], [TX + 1.5, TY + 3.5]], yaw: N },
];
export const SEATS = 6, BAR_FROM = 3;   // (how many, and from which one on they are standing at the bar)
export const tavernSpot = (i, meal = true) => spot(`tavern:${i}:${meal ? 1 : 0}`, () => { const q = tavernSeats()[i]; return { kind: 'taberna', goal: 'taberna', node: 'tavern_door', room: 'taberna', meal, ...q, via: [...TD, ...q.via] }; });
// Their own place there (PEOPLE seat): the way to it
const SEAT_VIA = { anselmo: [[6.5, 36.6], [8.5, 36.3], [8.5, 33.45]], eusebio: [[5.4, 36.4], [3.5, 36.3]], ines: [[6.5, 36.5], [7.5, 36.3]], marta: [[5.4, 36.4], [2.6, 36.5]], paco: [[6.6, 37.6]] };
const seatSpot = id => spot(`seat:${id}`, () => {
  const d = PEOPLE[id], [x, y, yaw] = d.seat, keeper = !!d.shop && !d.sits;
  return { kind: 'taberna', goal: 'taberna', node: 'tavern_door', via: [...TD, ...(SEAT_VIA[id] || []), [x, y]], yaw, pose: d.sits ? sit(yaw, d.sits) : null, tile: d.sits ? [Math.floor(x), Math.floor(y)] : null, room: 'taberna', work: d.work === 'taberna', meal: !keeper && !d.mends, seat: true, keeper };
});
// Who eats out takes the same place all day, and nobody else has it
function seatIndex(id, realDay) { const i = housed().indexOf(id); return (Math.max(0, i) + Math.floor(ihash(realDay, 5, 2611) * SEATS)) % SEATS; }
// The pews, or a place by the fountain, in the order of PEOPLE
function chapelSpot(id) {
  const i = Object.keys(PEOPLE).filter(q => !PEOPLE[q].fixed).indexOf(id);
  if (!hasBuilding('chapel')) return spot(`fountain:${i}`, () => {
    const a = (100 + (i % 5) * 40) * Math.PI / 180, r = i < 5 ? 2.3 : 3.1, x = FOUNTAIN.x + Math.cos(a) * r, y = FOUNTAIN.y + Math.sin(a) * r;
    return { kind: 'plaza', goal: 'plaza', node: 'p29', via: [[x, y]], yaw: Math.atan2(FOUNTAIN.x - x, FOUNTAIN.y - y), gather: true };
  });
  const L = chapelPews(CHAPEL.x0, CHAPEL.y0), q = L[i % L.length], [tx, ty] = q.seat, x = tx + 0.5, y = ty + 0.5, cx = CHAPEL.x0 + 3.5;
  return spot(`pew:${i}`, () => ({ kind: 'chapel', goal: 'chapel', node: 'chapel_door', via: [[cx, CHAPEL.y1 - 0.5], [cx, CHAPEL.y1 - 1.6], [cx, y - 0.62], [x, y - 0.62], [x, y]], yaw: N, pose: sit(N, PEW), tile: q.tile, room: 'chapel', gather: true }));
}
const awaySpot = () => spot('away', () => ({ kind: 'away', goal: 'away', node: 'road_s', via: [], hidden: true }));
// A point of the village. Two people on a stroll at the same one do not stand in each other (aside: by who they are)
const FACE = { stall: S, forge: S, easel: W, market_a: S, market_b: S, pond_w: E, pond_s: N, board: W, shop_front: N, browse_a: N, browse_b: N };
function nodeSpot(id, node, { work = false, kind, aside = !work } = {}) {
  const k = kind || (node.startsWith('pond') ? 'pond' : node.startsWith('market') ? 'market' : node.startsWith('browse') || node === 'shop_front' ? 'shopping' : node.startsWith('door') ? 'home' : node);
  if (node.startsWith('door')) return spot(node, () => ({ kind: 'home', goal: 'home', node, via: [], hidden: true, home: node.slice(5), room: null, door: true }));
  return spot(`${node}:${work ? 'w' : ''}:${aside ? id : ''}`, () => {
    const [x, y] = WALK_NODES[node], a = idNum(id) * 2.4, r = 0.42;
    return { kind: k, node, via: aside ? [[x + Math.sin(a) * r, y + Math.cos(a) * r]] : [], yaw: FACE[node] ?? null, work };
  });
}

// ---------- the day ----------
const eatsOut = (id, realDay, meal) => {
  const base = PEOPLE[id].eatOut ?? 0, w = weekdayOf(realDay), p = meal === 'lunch_long' ? 0.6 : meal === 'dinner' && (w === 5 || w === 6) ? base * 2 : base;
  return roll(id, realDay, meal === 'dinner' ? 2 : 1) < p;
};
// Some evenings, somebody visits somebody: { who, host } or null
export function visitOf(realDay) {
  const L = housed().filter(q => !PEOPLE[q].law);
  if (L.length < 2 || ihash(realDay, 31, 2671) > 0.4 || WET.has(env.weather?.(realDay))) return null;
  const who = L[Math.floor(ihash(realDay, 32, 2671) * L.length)], to = L.filter(q => PEOPLE[q].home !== PEOPLE[who].home);
  return to.length ? { who, host: to[Math.floor(ihash(realDay, 33, 2671) * to.length)] } : null;
}
const ERRANDS = { bruno: ['shop_front', 'pond_s', 'plaza'], dani: ['shop_front', 'board', 'pond_s'], rosa: ['board', 'plaza'], lia: ['shop_front', 'board'] };
const shelter = (id, realDay, k) => (roll(id, realDay, 40 + k) < 0.45 && PEOPLE[id].home ? tavernSpot(seatIndex(id, realDay), false) : null);
const chairAt = id => { const h = PEOPLE[id].home; return chairOf(h, residents(h).indexOf(id), null); };
function resolve(id, token, realDay, i) {
  const d = PEOPLE[id];
  switch (token) {
    case 'seat': return seatSpot(id);
    case '@away': return awaySpot();
    case '@home': return d.home ? chairAt(id) : awaySpot();
    case '@lunch': case '@dinner': case '@lunch_long': {
      if (!d.home) return d.seat ? seatSpot(id) : awaySpot();
      return eatsOut(id, realDay, token.slice(1)) ? tavernSpot(seatIndex(id, realDay)) : mealAt(id);
    }
    case '@market': return MARKET_OF[id] && hasBuilding(MARKET_OF[id]) ? nodeSpot(id, MARKET_OF[id], { work: true }) : d.work && WALK_NODES[d.work] ? nodeSpot(id, d.work, { work: true }) : nodeSpot(id, 'plaza');
    case '@browse': return nodeSpot(id, ((q => (q !== 'shop_front' && !hasBuilding(q === 'browse_a' ? 'market_a' : 'market_b') ? 'shop_front' : q))(['browse_a', 'shop_front', 'browse_b'][(i + idNum(id)) % 3])));
    case '@chapel': return chapelSpot(id);
    case '@desk': return deskSpot('law_desk');
    case '@patrol': return roundSpot(ROUNDS[(i + Math.floor(roll(id, realDay, 9) * ROUNDS.length)) % ROUNDS.length]);
    case '@evening': {
      const v = visitOf(realDay);
      if (v?.who === id) { const H = PEOPLE[v.host].home; return chairOf(H, 1, v.host, 'visit'); }
      if (v?.host === id) { const h = d.home; return chairOf(h, 0, null); }
      token = d.evening || 'plaza';
      break;
    }
    case '@errand': { const L = ERRANDS[id] || ['plaza', 'board']; token = L[Math.floor(roll(id, realDay, 7) * L.length)]; break; }
  }
  if (token === d.work) return nodeSpot(id, token, { work: true });
  if (token.startsWith('door')) return nodeSpot(id, token);
  // (what is for pleasure, not with rain or snow: home, or the tavern)
  if (wetDay(id, realDay) && d.home) return shelter(id, realDay, i) || chairAt(id);
  return nodeSpot(id, token);
}
const mealAt = id => { const c = chairAt(id); return spot(`meal:${c.key}`, () => ({ ...c, key: `meal:${c.key}`, meal: true })); };
// The template of their day, as [hour, place]
function template(id, realDay) {
  const d = PEOPLE[id], kind = dayKind(realDay), R = d.routine || {};
  if (R[kind]) return R[kind];
  if (R.work) return R.work;
  if (d.seat) {
    const [a, b] = d.hours;
    return b > 24 ? [[0, 'seat'], [b - 24, '@away'], [a, 'seat']] : [[0, '@away'], [a, 'seat'], [b, '@away']];
  }
  return d.schedule || [[0, '@away']];
}
export function planFor(id, realDay) {
  const k = `${id}:${realDay}`;
  let P = plans.get(k);
  if (P) return P;
  if (plans.size > 400) { plans.clear(); now.clear(); }
  const d = PEOPLE[id], T = template(id, realDay), out = [], bed = d.bed ?? BED_HOUR, own = d.home ? residents(d.home).indexOf(id) : -1;
  T.forEach(([h, token], i) => {
    const sp = resolve(id, token, realDay, i), end = T[i + 1]?.[0] ?? 24;
    // (a walk for pleasure starts some minutes later or earlier each day; work, meals and the call, at their hour)
    const free = !sp.work && !sp.meal && !sp.gather && h > 0 && token !== '@home' && token !== 'seat' && token !== '@away';
    const at = h + (free ? roll(id, realDay, 60 + i) * JITTER : 0);
    if (token === '@home' && d.home) {
      // (the night's sleep: at 0 h until half an hour before they go out, and from their bed hour on; they get up at their chair)
      const asleep = bedOf(d.home, own), wake = Math.max(0, end - WAKE);
      if (h < 6) { out.push({ h, at, spot: asleep }); if (wake < end) out.push({ h: wake, at: wake, spot: sp, wake: true }); return; }
      if (h >= bed) { out.push({ h, at, spot: asleep }); return; }
      out.push({ h, at, spot: sp });
      if (bed < end) out.push({ h: bed, at: bed, spot: asleep });
      return;
    }
    out.push({ h, at, spot: sp });
    // (the round: a stop every twelve minutes)
    if (token === '@patrol') for (let q = 1; h + q * 0.2 < end - 0.1; q++) out.push({ h, at: at + q * 0.2, spot: resolve(id, token, realDay, i + q) });
    // (round the market: from stall to stall)
    if (token === '@browse') for (let q = 1; h + q * 0.35 < end - 0.1; q++) out.push({ h, at: h + q * 0.35, spot: resolve(id, token, realDay, i + q) });
  });
  plans.set(k, P = out);
  return P;
}
const lastOf = (id, realDay) => { const P = planFor(id, realDay); return P[P.length - 1]; };
export function slotAt(id, nowMs) {
  const was = now.get(id);
  if (was && nowMs >= was.start && nowMs < was.end) return was;
  const day = Math.floor(nowMs / DAY), hour = (nowMs - day * DAY) / HOUR, P = planFor(id, day);
  let i = 0;
  while (i + 1 < P.length && P[i + 1].at <= hour) i++;
  const prev = i > 0 ? P[i - 1].spot : lastOf(id, day - 1).spot;
  // (the end: the next slot that is somewhere else, tomorrow's if there is none today)
  let next = null;
  for (let j = i + 1; j < P.length && !next; j++) if (P[j].spot !== P[i].spot) next = { ms: day * DAY + P[j].at * HOUR, h: P[j].h, spot: P[j].spot };
  if (!next) for (const s of planFor(id, day + 1)) if (s.spot !== P[i].spot) { next = { ms: (day + 1) * DAY + s.at * HOUR, h: s.h, spot: s.spot }; break; }
  const out = { spot: P[i].spot, prev, start: day * DAY + P[i].at * HOUR, end: day * DAY + (P[i + 1]?.at ?? 24) * HOUR, until: next?.ms ?? (day + 2) * DAY, untilHour: next?.h ?? null, next: next?.spot || null, i, day };
  now.set(id, out);
  return out;
}
// At home: the (nominal) hour they go out, today or tomorrow, or null
export function leavesHome(id, nowMs) {
  const s = slotAt(id, nowMs);
  for (const [day, from] of [[s.day, s.i + 1], [s.day + 1, 0], [s.day + 2, 0]]) { const P = planFor(id, day); for (let j = from; j < P.length; j++) if (!P[j].spot.home) return P[j].h; }
  return null;
}
// Their free time that day: [[from, to]…], hours (business.js: when they may go shopping). Not at work, at a meal, at the chapel or
// asleep; of their time out of the village, the last two hours before they come
export function freeSlots(id, realDay) {
  const P = planFor(id, realDay), out = [];
  P.forEach((e, i) => {
    const s = e.spot, end = P[i + 1]?.at ?? 24, seated = s.seat && !s.keeper;
    if (s.work || s.gather || s.door || s.kind === 'asleep' || (s.meal && !seated)) return;
    const from = s.kind === 'away' ? Math.max(e.at, end - 2) : e.at;
    if (s.kind === 'away' && !P[i + 1]) return;
    // (those who spend the day at the tavern, not while they eat there)
    for (const [a, b] of seated ? [[from, Math.min(end, 13.5)], [Math.max(from, 15.5), Math.min(end, 20.5)], [Math.max(from, 22.5), end]] : [[from, end]]) {
      if (b <= a) continue;
      const q = out[out.length - 1];
      if (q && a - q[1] < 0.01) q[1] = b; else out.push([a, b]);
    }
  });
  return out;
}
// And the time of their meals
export function mealSlots(id, realDay) {
  const P = planFor(id, realDay), out = [];
  P.forEach((e, i) => {
    const s = e.spot, end = P[i + 1]?.at ?? 24;
    if (!s.meal) return;
    if (!s.seat) out.push([e.at, end]);
    else for (const [a, b] of [[13.5, 15], [20.5, 22]]) if (Math.min(end, b) - Math.max(e.at, a) > 0.5) out.push([Math.max(e.at, a), Math.min(end, b)]);
  });
  return out;
}
// The way they have to walk in a slot (what neighbors.js draws may go round a wall: detour(R, slot))
export const roadOf = s => (s.prev === s.spot || (s.prev.room === s.spot.room && Math.hypot(s.prev.x - s.spot.x, s.prev.y - s.spot.y) < 0.02) ? null : road(s.prev, s.spot));
export function placeAt(id, nowMs, detour = null) {
  const s = slotAt(id, nowMs);
  let R = roadOf(s);
  if (R && detour) R = detour(R, s);
  const d = R ? Math.max(0, (nowMs - s.start) / 1000) * SPEED : 0;
  if (R && d < R.len) {
    const [x, y, dx, dy] = along(R, d);
    return { x, y, dx, dy, spot: s.spot, moving: true, yaw: null, slot: s };
  }
  return { x: s.spot.x, y: s.spot.y, dx: 0, dy: 0, spot: s.spot, moving: false, yaw: s.spot.yaw, slot: s };
}
// Is their shop open: them at the counter (not walking to it) within the day's hours
export function openAt(id, shop, nowMs) {
  const day = Math.floor(nowMs / DAY), hour = (nowMs - day * DAY) / HOUR;
  const H = shopHours(shop, day), h = H && H[1] > 24 && hour < 6 ? hour + 24 : hour;
  if (!H || h < H[0] || h >= H[1]) return false;
  if (PEOPLE[id]?.fixed) return true;
  const a = placeAt(id, nowMs);
  return a.spot.work && !a.moving;
}
// When it opens next: { hour, day (days from now) } or null (within a week)
export function opensNext(id, shop, nowMs) {
  const step = 5 * 6e4;
  for (let t = Math.ceil(nowMs / step) * step, n = 0; n < 7 * 288; n++, t += step) if (openAt(id, shop, t)) { const ms = opening(id, shop, t, step, nowMs); return { hour: (ms % DAY) / HOUR, day: Math.floor(ms / DAY) - Math.floor(nowMs / DAY), ms }; }
  return null;
}
// (the hour they set off for the counter or the shop's hour, not the minute they get there)
function opening(id, shop, t, step, nowMs) {
  const s = slotAt(id, t).start, day = Math.floor(t / DAY), h = day * DAY + shopHours(shop, day)[0] * HOUR, ms = Math.max(s, h > t ? -Infinity : h);
  return ms > t - step - 6e4 && ms > nowMs - 6e4 ? ms : t;
}
// A shop for the map: { open, at: [x, y] where its keeper sells (or will), change: ms it opens or closes } (kept until then)
export function shopState(id, shop, nowMs) {
  let s = states.get(id);
  if (s && nowMs >= s.from && nowMs < s.change) return s;
  const open = openAt(id, shop, nowMs), step = 6e4;
  let t = Math.floor(nowMs / step) * step + step;
  // (by the minute within the hour, then every five)
  for (let n = 0; n < 2100 && openAt(id, shop, t) === open; n++) t += n < 60 ? step : step * 5;
  for (let n = 0; n < 4 && openAt(id, shop, t - step) !== open; n++) t -= step;
  if (!open) t = Math.max(nowMs + 1, opening(id, shop, t, step, nowMs));
  const sp = slotAt(id, open ? nowMs : t).spot, def = PEOPLE[id];
  states.set(id, s = { from: nowMs, open, change: t, at: sp.work ? [sp.x, sp.y] : WALK_NODES[def.work] || [sp.x, sp.y] });
  return s;
}
// Is the bell calling: from 11:50 on a Sunday or a holiday, for BELL_S seconds. Seconds into it, or -1
export const BELL_S = 26;
export function bellAt(nowMs) {
  const day = Math.floor(nowMs / DAY);
  if (!ROUTINES || !hasBuilding('chapel') || !isBellDay(day)) return -1;
  const s = (nowMs - day * DAY - BELL_HOUR * HOUR) / 1000;
  return s >= 0 && s < BELL_S ? s : -1;
}
// «14:45»
export const hhmm = h => { const m = Math.round(((h % 24) + 24) % 24 * 60) % 1440; return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
