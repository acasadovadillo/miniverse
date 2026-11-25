// The catch as a thing you carry (Plan R1-3, docs/planes/realismo/PLAN-R1-pesca.md §3.7): what a stack of fish says of itself,
// when two of them are one, how fresh it is, what it weighs, feeds and gives at the kitchen. Only data and pure functions:
// it imports items.js and i18n.js and nothing else (inventory.js and carry-items.js import it). Who makes it rot, and the
// kitchen's work: freshness.js. What it is worth: economy.js stackPrice.
//
// The fields of a stack ({ id, n, … }), besides the usual ones:
//   g     grams of EACH of them (the mean of the stack), so taking some out, dropping them one by one or an older game's
//         copy of the stack never makes weight out of nothing; putting two stacks together works the mean out (pour)
//   day   the real day it was caught (TimeSystem.realDay, the clock of the carcasses): raw fish and fillets only
//   tr, cm   a trophy (1) and its length: it never stacks and nothing takes it by itself (count and remove skip it)
//   val   coins for each, for what is made of a fish (fillets, grilled, salted): what the fish was worth goes along
// A stack without them (from an older game, the shop, /give, a present) is a typical fish of today: what it was always
// worth. An older game keeps them when it moves the stack, and loses them when it merges it (a typical fish again)
import { ITEMS, FISH } from './items.js';
import { defineNames, t } from './i18n.js';

// What others know and this file must not import: the real day (game.js sets it) and an item's price (economy.js)
export const hooks = { today: () => 0, price: () => 0 };

export const FRESH_DAYS = 2, ROT_DAYS = 4;            // whole days it stays fresh; from which it is rotten
export const OLD_PRICE = 0.6, OLD_FOOD = 0.7;         // a few days old
export const GRILL_G = 2000, CLEAN_G = 600;           // g up to which one is grilled whole; from which it is worth cleaning
export const FILLET_G = 600, SCRAP_G = 1500, FILLET_YIELD = 0.55;   // g of fish for each fillet and each piece of bait; what of it is flesh
export const SALT_KEEP = 0.45, SALT_PRICE = 1.3, SALT_FOOD = 1.3;   // what is left of its weight dried; its price and its food
export const GRILL_PRICE = 1.5, GRILL_MORE = 8;       // (as any dish: economy.js priceOf)

// ---------- the new things (names and descriptions from the language files) ----------
const NEW = { fillet: { food: 10 }, salted_fish: { food: 6 }, rotten_fish: {}, salt: {} };
for (const id of Object.keys(NEW)) ITEMS[id] = NEW[id] = { name: id, desc: '', stack: 99, ...NEW[id] };
defineNames(NEW, 'item');
// (the fish whose description was still in items.js: how it is sold and what the kitchen does with it)
for (const [id, f] of Object.entries(FISH)) if (!f.rare && Object.getOwnPropertyDescriptor(ITEMS[id], 'desc')?.writable) Object.defineProperty(ITEMS[id], 'desc', { configurable: true, enumerable: true, get: () => t('fish.desc') });

// ---------- which ones ----------
const fin = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
export const isFish = id => !!FISH[id];
export const perishes = id => !!FISH[id] || id === 'fillet';                 // (has its day)
const VALUED = new Set(['fillet', 'salted_fish', 'pescado_asado']);          // (carries its val)
const WEIGHED = new Set(['fillet', 'salted_fish', 'rotten_fish']);           // (and its g, with the fish)
export const tracked = id => !!FISH[id] || VALUED.has(id) || WEIGHED.has(id);
// (nothing that picks by itself takes a trophy)
export const plain = s => !s.tr;
// Grams of a typical one: the mean of those that bite (fishwater.js sizeOf: u²), so fishing pays the same per hour by the
// kilo as by the fish, and a fish of an older save is worth what it was
const typical = new Map();
export function typicalG(id) {
  let g = typical.get(id);
  if (g !== undefined) return g;
  const f = FISH[id];
  if (f) { const a = f.cm[0], s = f.cm[1] - a; g = Math.round((f.k || 12) * (a ** 3 + a * a * s + 3 * a * s * s / 5 + s ** 3 / 7) / 1000); }
  else g = id === 'salted_fish' ? 400 : id === 'rotten_fish' ? 500 : id === 'fillet' ? 300 : 0;
  typical.set(id, Math.max(1, g));
  return typical.get(id);
}
export const unitG = s => (fin(s?.g, 0.01, 1e6) ? s.g : typicalG(s?.id));

// ---------- its freshness ----------
export const dayOf = s => (fin(s?.day, 0, 1e7) ? Math.min(Math.floor(s.day), hooks.today()) : hooks.today());
export const ageOf = s => (perishes(s?.id) ? Math.max(0, hooks.today() - dayOf(s)) : 0);
// 'fresh', 'old' or 'rotten' ('' what does not go off). A trophy dries whole: never rotten
export function stateOf(s) {
  if (!s || !perishes(s.id)) return '';
  const age = ageOf(s);
  return age < FRESH_DAYS ? 'fresh' : age < ROT_DAYS || s.tr ? 'old' : 'rotten';
}
export const freshK = s => (stateOf(s) === 'old' ? OLD_PRICE : 1);
// A stack settled on today, in place: what it lacks is given (a typical fish of today), a day to come is today, and what
// has gone off is rotten fish, as many and as heavy. Returns 0 (as it was), 1 (completed) or 2 (gone off)
export function settle(s, canRot = true) {
  if (!s || !perishes(s.id)) return 0;
  let out = 0;
  const today = hooks.today();
  if (!fin(s.day, 0, 1e7) || s.day > today) { s.day = today; out = 1; }
  if (isFish(s.id) && !fin(s.g, 0.01, 1e6)) { s.g = typicalG(s.id); out = 1; }
  if (!canRot || stateOf(s) !== 'rotten') return out;
  s.g = unitG(s); s.id = 'rotten_fish';
  for (const k of ['day', 'val', 'tr', 'cm']) delete s[k];
  return 2;
}

// ---------- two stacks ----------
// The fields of something that comes in (extra: what it says of itself, or nothing), whole and in their limits
export function stamp(id, extra) {
  const e = {};
  if (isFish(id)) {
    e.g = fin(extra?.g, 0.01, 1e6) ? extra.g : typicalG(id);
    if (extra?.tr) { e.tr = 1; if (fin(extra.cm, 1, 1000)) e.cm = extra.cm; }
  } else if (WEIGHED.has(id) && fin(extra?.g, 0.01, 1e6)) e.g = extra.g;
  if (perishes(id)) e.day = dayOf(extra);
  if (VALUED.has(id) && fin(extra?.val, 0.01, 1e6)) e.val = extra.val;
  return e;
}
// Does e (a stack, or its fields) go into s, of the same id?
export const joins = (s, e) => !s.color && !s.tr && !e.tr && (!perishes(s.id) || dayOf(s) === dayOf(e));
export const sameStack = (a, b) => a.id === b.id && (tracked(a.id) ? joins(a, b) : !a.color && !b.color);
// k of them, with e's fields, into s: each field the mean of all
const r2 = v => Math.round(v * 100) / 100;
export function blend(s, e, k) {
  if (tracked(s.id)) {
    const was = k + s.n;
    if (perishes(s.id)) s.day = dayOf(s);
    if (s.g !== undefined || e.g !== undefined) s.g = r2((unitG(s) * s.n + unitG({ id: s.id, g: e.g }) * k) / was);
    if (s.val !== undefined || e.val !== undefined) { const d = hooks.price(s.id); s.val = r2(((s.val ?? d) * s.n + (e.val ?? d) * k) / was); }
  }
  s.n += k;
}
// What a stack says of itself beyond its id and n, to go along with it (inventory.js extraOf)
export const FIELDS = ['g', 'day', 'tr', 'cm', 'val'];
// The slots of list that hold id and pass ok, in the order they are taken by themselves: of fish, the oldest first; the
// rest, from the end (the backpack before the hotbar)
export function takeOrder(list, id, ok = plain) {
  const out = [];
  for (let i = list.length - 1; i >= 0; i--) if (list[i]?.id === id && ok(list[i])) out.push(i);
  if (perishes(id) && out.length > 1) out.sort((a, b) => dayOf(list[a]) - dayOf(list[b]) || b - a);
  return out;
}

// ---------- what it feeds and what it gives ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// A raw fish by its weight (of each), less when it is a few days old; salted, what the fish it was would, and more
export function foodOf(s) {
  const def = ITEMS[s?.id];
  if (!def?.food) return 0;
  const raw = g => clamp(Math.round(g / 1000 * 8), 2, 20);
  if (isFish(s.id)) return raw(unitG(s)) * (stateOf(s) === 'old' ? OLD_FOOD : 1);
  if (s.id === 'salted_fish') return raw(unitG(s) / SALT_KEEP) * SALT_FOOD;
  return def.food * (stateOf(s) === 'old' ? OLD_FOOD : 1);
}
// Its definition with what this one feeds (the same object when there is nothing to say)
export function foodDef(s) {
  const def = ITEMS[s?.id];
  return def?.food && tracked(s.id) ? { ...def, food: foodOf(s) } : def;
}
export const small = s => plain(s) && unitG(s) <= GRILL_G && stateOf(s) !== 'rotten';   // (grilled whole)
// What cleaning or salting one gives: [[id, n, fields]…], and what salting takes. price: what one is worth (economy.js)
export const filletsOf = g => Math.ceil(g / FILLET_G), scrapsOf = g => Math.ceil(g / SCRAP_G), saltFor = g => Math.ceil(g / 1000);
export const canClean = s => !!s && isFish(s.id) && stateOf(s) !== 'rotten' && unitG(s) > CLEAN_G;
export const canSalt = s => !!s && isFish(s.id) && stateOf(s) !== 'rotten';
export function cleaned(s, price) {
  const g = unitG(s), n = filletsOf(g), k = freshK(s);   // (the price as fresh: the fillets carry its day, and lose theirs by it)
  return [['fillet', n, { g: r2(g * FILLET_YIELD / n), day: dayOf(s), val: r2(price / k / n) }], ['cut_bait', scrapsOf(g)]];
}
export const salted = (s, price) => [['salted_fish', 1, { g: r2(unitG(s) * SALT_KEEP), val: r2(price * SALT_PRICE) }]];
export const grilledVal = price => r2(price * GRILL_PRICE + GRILL_MORE);
// For the windows: 'a few days old', 'rotten' or nothing
export const stateText = s => { const st = stateOf(s); return st === 'old' ? t('fish.fresh.old') : st === 'rotten' ? t('fish.fresh.rotten') : ''; };
