// The numbers of the players' own businesses (docs/planes/gta/PLAN-H-pueblo-vivo.md §3) and who buys what: everything here is a
// pure function of what it is given, so whoever decides the world settles the same sales whenever it does (business.js).
//
//   classOf(id)                 what kind of thing it is, for what each customer wants
//   worthOf(rec, npc, s)        what that customer thinks one of that stack is worth; fairOf(rec, s), what they all think
//   daysVisits(shops, day)      who goes to each business that day, and when: Map key → [{ npc, ms, meal, day }], by time
//   serve(rec, visit, o)        one visit: changes the record and gives what was sold [{ lot, id, n, coins }]
// The customers are the neighbours (routines.js says when they are free) and two travellers nobody sees
import { ITEMS, CROPS, FISH } from './items.js';
import { RECIPES } from './recipes.js';
import { SHOPS, priceOf, buyPrice, stackPrice } from './economy.js';
import { stateOf } from './catch.js';
import { freeSlots, mealSlots, dayKind, idNum } from './routines.js';
import { PEOPLE } from './neighbors.js';   // (a cycle, read only inside functions)
import { REP_LEVELS } from './reputation.js';
import { thirstOf } from './items.js';
import { ihash } from './util.js';

const HOUR = 36e5, DAY = 864e5;
export const KINDS = ['shop', 'tavern'];
export const HOURS = { morning: [8, 14], day: [9, 20], evening: [16, 23] };
export const HOUR_IDS = Object.keys(HOURS);
export const NIGHT = [7, 23];                    // nobody buys outside these hours
export const CATCH_UP = 7 * DAY;                 // what a world nobody played in catches up
export const PCT = { min: 50, max: 250, step: 10, start: 120 };   // % of what the thing is worth
export const CAP = { counter: 3, shelf: 6, crate: 3, max: 24 };   // kinds of goods
export const REACH = { shop: 6, tavern: 8 };     // tiles from the counter to what it uses
export const NEAR_NODE = 30, FAR_NODE = 200;     // tiles to the neighbours' paths: they come; only travellers do
const FAR_K = 0.25;
export const LEG = 16;                           // tiles of the last leg, off their paths, they are drawn walking
const VISIT = 0.5, SAT_K = 1.5, TRAVEL = 0.6;    // chance of a visit a day: a neighbour's, × on Saturdays, a traveller's
export const TRAVELLERS = ['traveller_1', 'traveller_2'];
const TOGETHER = 25 / 60;                        // hours: the same customer is not in two businesses closer than this
const SLOT_MARGIN = 0.1;                         // hours kept free at each end of their free time
// What each one spends in a visit, at most (a dearer thing, now and then: serve)
const PURSE = { rosa: 140, lia: 110, bruno: 170, dani: 160, anselmo: 220, eusebio: 90, ines: 120, marta: 130, paco: 90, nilo: 0 };
const TRAVEL_PURSE = 180, MEAL_PURSE = 130;

// ---------- what they want ----------
const ORE = new Set(['carbon', 'cobre', 'hierro', 'oro', 'lingote_cobre', 'lingote_hierro', 'lingote_oro', 'herraduras']);
const GEM = new Set(['amatista', 'esmeralda', 'rubi', 'diamante', 'fosil_concha', 'fosil_hueso', 'fosil_ambar', 'moneda_antigua', 'pearl']);
const CLOTH = new Set(['lana', 'lana_fina', 'angora', 'tela', 'cuerda', 'cuero', 'piel', 'plumas']);
const DAIRY = new Set(['huevo', 'huevo_pato', 'leche', 'leche_cabra', 'nata', 'miel', 'queso', 'queso_cabra', 'mantequilla']);
const BAIT = new Set(['worm', 'cut_bait', 'spoon', 'jig', 'rotten_fish', 'landing_net']);
// (how much anybody wants each kind)
const WANT = { dish: 1, drink: 0.8, dairy: 0.7, crop: 0.7, fruit: 0.7, fish: 0.6, meat: 0.5, wear: 0.35, flower: 0.3, cloth: 0.3, decor: 0.3, tool: 0.2, bait: 0.05, gem: 0.15, misc: 0.15, ore: 0.1 };
// (and what each neighbour is after, for their trade or by their taste)
export const DEMAND = {
  rosa: { dairy: 3, flower: 3, fruit: 1.5 }, lia: { fish: 3, bait: 3, drink: 0.4 }, bruno: { ore: 3, dish: 1.5, tool: 1 }, dani: { gem: 3, cloth: 3, decor: 1.5 },
  anselmo: { crop: 3, dairy: 2, fruit: 3, meat: 2, fish: 1.2, dish: 0.3, drink: 0.3 }, eusebio: { dish: 1.6, drink: 1.2 }, ines: { wear: 1, flower: 1.5, gem: 0.6 },
  marta: { cloth: 3, dish: 1.2 }, paco: { drink: 2, meat: 1.5, dish: 1.5 },
};
const classes = new Map();
export function classOf(id) {
  let c = classes.get(id);
  if (c) return c;
  const def = ITEMS[id];
  if (!def) return 'misc';
  const r = RECIPES.find(q => q.out === id);
  c = ORE.has(id) ? 'ore' : GEM.has(id) ? 'gem' : CLOTH.has(id) ? 'cloth' : DAIRY.has(id) ? 'dairy' : BAIT.has(id) ? 'bait' : FISH[id] || id === 'fillet' || id === 'salted_fish' ? 'fish'
    : CROPS[id] ? 'crop' : def.drink || def.potion ? 'drink' : id.startsWith('carne_') ? 'meat' : def.food ? (r?.station === 'cocina' ? 'dish' : 'fruit')
    : def.flower ? 'flower' : def.wear ? 'wear' : def.tool || def.weapon || def.bow ? 'tool' : def.place ? 'decor' : 'misc';
  classes.set(id, c);
  return c;
}
// What a tavern serves
export const served = id => !!(ITEMS[id]?.food || thirstOf(ITEMS[id]) > 0);
// What can be put on sale (and not what is worth nothing, or a stack this game does not know)
export const sellable = (s, kind) => !!s && !!ITEMS[s.id] && stateOf(s) !== 'rotten' && s.id !== 'rotten_fish' && stackPrice(s) > 0 && (kind !== 'tavern' || served(s.id));
export function wantOf(npc, s) {
  const P = PEOPLE[npc], c = classOf(s.id), w = DEMAND[npc]?.[c] ?? WANT[c] ?? 0.15;
  if (!P) return w;
  if (P.hates?.includes(s.id)) return 0;
  return w * (P.loves?.includes(s.id) ? 3 : P.likes?.includes(s.id) ? 2 : 1);
}
// What the village's own stalls sell, nobody pays as much for anywhere else: the first price nobody pays (a fifth less than the
// stall's, so what is bought there, with every discount, is never worth selling again; or over what Rosa would give)
const stalls = new Map();
export function stallPrice(id) {
  if (!stalls.size) for (const S of Object.values(SHOPS)) for (const e of S.stock) if (e.id) { const p = e.price ?? buyPrice(e.id); stalls.set(e.id, Math.min(stalls.get(e.id) ?? Infinity, p)); }
  const p = stalls.get(id);
  return p === undefined ? Infinity : Math.max(Math.floor(p * 0.8), priceOf(id) + 1);
}
const sellK = rec => REP_LEVELS[rec.rl]?.sell ?? 1;
const heartsOf = (rec, npc) => Math.max(0, Math.min(10, rec.hh?.[npc] || 0));
export const worthOf = (rec, npc, s) => stackPrice(s) * (1 + 0.15 * heartsOf(rec, npc) / 2) * sellK(rec);
export const unitPrice = s => Math.max(1, Math.round(stackPrice(s) * (s.m || PCT.start) / 100));
// The price most of them find fair: at it, half of those who want one take it at least
export function fairOf(rec, s) {
  const L = Object.keys(PEOPLE).filter(id => !PEOPLE[id].fixed), w = L.reduce((t, id) => t + worthOf(rec, id, s), 0) / L.length;
  return Math.max(1, Math.round(Math.min(w * 1.1, stallPrice(s.id) - 1)));
}
const MEAL_K = 1.3;   // (hungry and served at a table, a dish is worth more)
export const chanceAt = (worth, price, id) => (price >= stallPrice(id) ? 0 : Math.max(0, Math.min(1, 1.8 - price / worth)));
// How many of a kind a day, in one business
export const dayCap = price => Math.max(1, Math.ceil(9 / Math.sqrt(Math.max(1, price))));

// ---------- when they come ----------
export const isOpenAt = (rec, hour, kind) => { const H = HOURS[rec.hours] || HOURS.day; return hour >= H[0] && hour < H[1] && (kind !== 'sun' || !!rec.sun); };
const cut = (slots, a, b) => slots.map(([x, y]) => [Math.max(x, a), Math.min(y, b)]).filter(([x, y]) => y - x > 2 * SLOT_MARGIN + 0.02);
const dice = (day, npc, key, k) => ihash(day, idNum(npc) + 31 * k, idNum(key) + 5100);
// An hour inside some free time, or null
function pick(slots, u) {
  let L = 0;
  for (const [a, b] of slots) L += b - a - 2 * SLOT_MARGIN;
  if (!(L > 0)) return null;
  let t = u * L;
  for (const [a, b] of slots) { const l = b - a - 2 * SLOT_MARGIN; if (t <= l) return a + SLOT_MARGIN + t; t -= l; }
  return null;
}
// shops: [{ key, rec, d }] (d: tiles from its counter to the neighbours' paths). people: the neighbours there are
export function daysVisits(shops, day, people) {
  const kind = dayKind(day), out = new Map(), busy = new Map(), L = [...shops].sort((a, b) => (a.key < b.key ? -1 : 1));
  for (const { key, rec, d } of L) {
    const list = [];
    out.set(key, list);
    if ((kind === 'sun' && !rec.sun) || d > FAR_NODE) continue;
    const H = HOURS[rec.hours] || HOURS.day, a = Math.max(H[0], NIGHT[0]), b = Math.min(H[1], NIGHT[1]);
    const add = (npc, hour, meal, slots) => {
      if (hour === null) return;
      const B = busy.get(npc) || busy.set(npc, []).get(npc);
      // (already somewhere else then: a little later, if they are still free)
      for (let n = 0; n < 4 && B.some(h => Math.abs(h - hour) < TOGETHER); n++) hour += TOGETHER + 0.02;
      if (B.some(h => Math.abs(h - hour) < TOGETHER) || !slots.some(([x, y]) => hour >= x + SLOT_MARGIN / 2 && hour <= y - SLOT_MARGIN / 2)) return;
      B.push(hour);
      list.push({ npc, ms: Math.round(day * DAY + hour * HOUR), meal, day });
    };
    if (d <= NEAR_NODE) for (const npc of people) {
      const eats = rec.kind === 'tavern', out2 = PEOPLE[npc].eatOut ?? 0.1;
      if (eats) {
        mealSlots(npc, day).forEach(([x, y], i) => { const S = cut([[x, Math.min(y, x + 0.4)]], a, b); if (S.length && dice(day, npc, key, 10 + i) < Math.min(0.6, 0.15 + out2)) add(npc, pick(S, dice(day, npc, key, 20 + i)), 1 + i, cut([[x, y]], a, b)); });
        const S = cut(freeSlots(npc, day), a, b);
        if (S.length && dice(day, npc, key, 3) < 0.22) add(npc, pick(S, dice(day, npc, key, 4)), 0, S);
        continue;
      }
      const S = cut(freeSlots(npc, day), a, b);
      if (S.length && dice(day, npc, key, 1) < VISIT * (kind === 'sat' ? SAT_K : 1)) add(npc, pick(S, dice(day, npc, key, 2)), 0, S);
    }
    for (const npc of TRAVELLERS) if (dice(day, npc, key, 1) < TRAVEL * (d > NEAR_NODE ? FAR_K : 1)) add(npc, pick([[a, b]], dice(day, npc, key, 2)), 0, [[a, b]]);
    list.sort((p, q) => p.ms - q.ms || (p.npc < q.npc ? -1 : 1));
  }
  return out;
}

// ---------- a visit ----------
// The lots that are really on sale: the first ones its counter, shelves and crates hold
export const lotIds = rec => Object.keys(rec.goods || {}).sort((a, b) => a - b);
export const onSale = (rec, cap) => lotIds(rec).slice(0, cap);
// o: { cap: kinds it holds, seats (a tavern's), roll(k) → [0, 1) }
export function serve(rec, v, { cap, seats = Infinity, roll = k => dice(v.day, v.npc, rec.key || '', 100 + k + 40 * (v.meal || 0)) }) {
  // (once a day each, in a shop; once a meal, in a tavern)
  const mark = v.day * 4 + (v.meal || 0), last = (rec.last ||= {});
  if (last[v.npc] >= mark) return [];
  last[v.npc] = mark;
  if (rec.kind === 'tavern' && v.meal) {
    const M = rec.meal?.[0] === mark ? rec.meal : (rec.meal = [mark, 0]);
    if (M[1] >= seats) return [];
    M[1]++;
  }
  if (rec.sold?.d !== v.day) rec.sold = { d: v.day, c: {} };
  const traveller = TRAVELLERS.includes(v.npc), out = [];
  let purse = v.meal ? MEAL_PURSE : traveller ? TRAVEL_PURSE : PURSE[v.npc] ?? 100;
  // (at a tavern: something to eat and something to drink; in a shop, the two things they want most, more or less)
  const tries = rec.kind === 'tavern' ? [c => c !== 'drink', c => c === 'drink'] : [null, null];
  tries.forEach((ok, k) => {
    const L = [];
    for (const lot of onSale(rec, cap)) {
      const s = rec.goods[lot];
      if (!(s.n > 0) || !sellable(s, rec.kind) || out.some(x => x.id === s.id) || (ok && !ok(classOf(s.id)))) continue;
      const want = traveller ? (WANT[classOf(s.id)] ?? 0.15) : wantOf(v.npc, s), p = unitPrice(s);
      if (want > 0 && (rec.sold.c[s.id] || 0) < dayCap(priceOf(s.id))) L.push([lot, s, want, p]);
    }
    let t = roll(k * 4) * L.reduce((q, e) => q + e[2], 0), e = null;
    for (const x of L) { t -= x[2]; if (t < 0) { e = x; break; } }
    if (!e) return;
    const [lot, s, , p] = e;
    if (roll(k * 4 + 1) >= chanceAt(worthOf(rec, v.npc, s) * (v.meal ? MEAL_K : 1), p, s.id)) return;
    if (p > purse && roll(k * 4 + 2) >= purse / p) return;   // (they seldom spend as much)
    const most = Math.min(s.n, dayCap(priceOf(s.id)) - (rec.sold.c[s.id] || 0)), n = Math.max(1, Math.min(most, p * 2 <= purse && roll(k * 4 + 3) < 0.45 ? 2 : 1)), coins = p * n;
    purse = Math.max(0, purse - coins);
    s.n -= n;
    if (s.n <= 0) delete rec.goods[lot];
    rec.sold.c[s.id] = (rec.sold.c[s.id] || 0) + n;
    out.push({ lot, id: s.id, n, coins });
  });
  return out;
}
