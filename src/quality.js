// The quality of a hunted carcass (Plan R3-3, docs/planes/realismo/PLAN-R3-caza.md §3.6): how good it is (one to three
// stars), what it weighs, what it gives and what Anselmo pays for it. Only data and pure functions; who writes it: hunt.js
// (the host, when a wild animal dies) and carry.js (placing, carrying, gutting and butchering it).
//
// The record of a carcass, an array (d.cq["x,y"] in its chunk, beside d.carcass; the third of a load of the wheelbarrow;
// the seventh of a boat's; `cq` of what the arms carry, in the save):
//   [Q0, gut, sex, arrows, killed, size, flags]
//   Q0      0..100: the animal, the shot and the season, without the time
//   gut     0, or when it was gutted (ms, TimeSystem.now: the clock of the carcasses' days)
//   sex     0 male, 1 female
//   arrows  the arrows stuck in it: whoever cuts it up, or sells it, gets them back
//   killed  when it died (ms)
//   size    the animal's size (herds.js: 0.85 to 1.2; its weight)
//   flags   F below
// A carcass without one (an old game's, a farm animal's, or with ?calidad=0) is two stars, with the weight and the yields
// of always, and has nothing to gut. An older game carries the record along with the chunk (it never reads it) and loses
// it when it picks the carcass up.
// The time is counted by how warm it was when it died (and, once gutted, when it was gutted), noted then in the flags: it
// never gets better because the night came, and every game agrees without asking the weather of a far place.
import { BULKY, BULKY_PARTS } from './carry-items.js';
import { feelOf, TEMP } from './clothing.js';
import { climate } from './world/biomes.js';
import { latOf } from './world/planet.js';
import { AGE, dayOfYear, rutOn } from './herds.js';
import { apagada } from './opciones.js';

export const Quality = { force: null };   // (the tests: on or off without the URL)
export const qualityOn = () => Quality.force ?? !apagada('calidad');

export const Gore = { on: true };          // (Settings › blood, for whoever must not import the settings: three/gut3d.js keeps it)
const MIN = 60e3, HOUR = 3600e3, DAY = 864e5;
export const F = { TAINTED: 1, WARM: 2, WARM_GUT: 4, ANTLERS: 8, MANY: 16, THIN: 32, MELEE: 64, CLEAN: 128 };   // (CLEAN: a clean kill, Plan R3-4: huntcode.js)
export const STAR3 = 70, STAR2 = 45;                 // Q from which
export const BASE_Q = [35, 55, 70, 80];              // by age (herds.js AGE); one nobody knows the age of (a summoned one) is an adult
export const Q_SIZE = 20, Q_ARROW = 12, Q_GUT = 20, Q_MELEE = 8, Q_LATE = 25, Q_RUT = 10, Q_FAT = 5, Q_THIN = 5;
export const WARM_C = 12;                            // °C: the air from which it spoils sooner
export const FRESH_FOR = { warm: 45 * MIN, cold: 2 * HOUR }, SPOIL = { warm: 12 * HOUR, cold: 24 * HOUR };   // ungutted, this long before it loses anything; then again every SPOIL (gutted, every SPOIL from then on)
export const GUT_KG = 0.75;                          // what is left of its weight
export const GUT_TTL = DAY;                          // a gut pile is gone by then

// Is it warm where a carcass lies? (the weather is the same all over but at the poles: the player's, or the host's)
const clim = {}, feel = {}, ENV = { Tl: TEMP.tlRef, season: 0, hour: 12, weather: 'sol', W: 0, fireD: Infinity };
export function warmAt(g, x, y) {
  const D = g.days, w = g.world;
  ENV.Tl = w?.gen ? climate(x, y, w.gen.seed, clim).Tl : TEMP.tlRef;
  ENV.season = latOf(y) < 0 ? (D.season + 2) % 4 : D.season;
  ENV.hour = D.hourAt(x); ENV.weather = D.weatherHere || 'sol';
  return feelOf(ENV, feel).airC >= WARM_C;
}

// (host) The record of a wild animal that has just died: e.shot = { n: arrows that hit it, gut, melee: blows }
export function recordOf(e, g) {
  const ms = Math.round(g.days.now), md = dayOfYear(ms, e.y), s = e.shot || {}, n = s.n || 0, melee = s.melee || 0;
  const size = e.traits ? e.size || 1 : 1, age = e.young ? AGE.young : e.traits ? e.age ?? AGE.adult : AGE.adult;
  const stag = e.type === 'ciervo' && !e.female && !e.young, antlers = stag && antlersOn(md), thin = md >= 201 && md <= 331, warm = warmAt(g, e.x, e.y);
  const Q = BASE_Q[age] + Q_SIZE * (size - 1) + (antlers && rutOn(md) ? Q_RUT : 0)
    - Q_ARROW * Math.max(0, n - 1) - (s.gut ? Q_GUT : 0) - Q_MELEE * melee
    + (md >= 922 && md <= 1220 ? Q_FAT : 0) - (thin ? Q_THIN : 0);
  const flags = (s.gut ? F.TAINTED : 0) | (warm ? F.WARM : 0) | (antlers ? F.ANTLERS : 0) | (n > 1 ? F.MANY : 0) | (thin ? F.THIN : 0) | (melee ? F.MELEE : 0);
  return [Math.max(0, Math.min(100, Math.round(Q))), 0, e.female ? 1 : 0, Math.min(99, e.arrows || 0), ms, Math.round(size * 100) / 100, flags];
}
// The antlers: cast in March, hard again in August
export const antlersOn = md => md >= 801 || md < 301;   // (hard: the same as herds.js antlersIn)

// What comes from a save or the network: a record, or null
const num = (v, lo, hi) => typeof v === 'number' && v >= lo && v <= hi;
export function cleanCq(q) {
  if (!Array.isArray(q) || !num(q[0], 0, 100) || !num(q[1], 0, 1e14) || !num(q[4], 1, 1e14)) return null;
  return [q[0], q[1], q[2] ? 1 : 0, num(q[3], 0, 99) ? Math.floor(q[3]) : 0, q[4], num(q[5], 0.3, 2) ? q[5] : 1, num(q[6], 0, 255) ? Math.floor(q[6]) : 0];
}
export const dayOfCq = q => Math.floor(q[4] / DAY);   // (the same as its d.carcass: one left by what lay there before is not its own)

// ---------- how good it is now ----------
function lateOf(q, now) {
  const late = (age, warm) => { const k = warm ? 'warm' : 'cold'; return age < FRESH_FOR[k] ? 0 : Q_LATE * (1 + Math.floor((age - FRESH_FOR[k]) / SPOIL[k])); };
  if (!q[1]) return late(Math.max(0, now - q[4]), q[6] & F.WARM);
  return late(Math.max(0, q[1] - q[4]), q[6] & F.WARM) + Q_LATE * Math.floor(Math.max(0, now - q[1]) / SPOIL[q[6] & F.WARM_GUT ? 'warm' : 'cold']);
}
export const scoreOf = (q, now) => q[0] - lateOf(q, now);
export function starsOf(q, now) {
  if (!q) return 2;
  const s = scoreOf(q, now);
  return s >= STAR3 ? 3 : s >= STAR2 ? 2 : 1;
}
export const starText = n => '★'.repeat(n) + '☆'.repeat(3 - n);
// Why it is not better (a key of the languages, hunt.quality.why.*), the worst first; '' if nothing
export function whyOf(q, now) {
  if (!q) return '';
  const f = q[6];
  if (lateOf(q, now) > 0) return 'late';
  return f & F.TAINTED ? 'gut' : f & F.MELEE ? 'melee' : f & F.MANY ? 'arrows' : f & F.THIN ? 'thin' : '';
}

// ---------- what it weighs and gives ----------
export const isGame = id => BULKY[id]?.prey === 'ciervo' || BULKY[id]?.prey === 'jabali';   // (a hunted one: the farm's have no record)
export function kgOf(id, q) {
  const B = BULKY[id];
  return !B ? 0 : !q || !B.prey ? B.kg : Math.round(B.kg * q[5] * (q[1] ? GUT_KG : 1));
}
// How it slows you, the same share lighter once gutted
export const slowOf = (id, q) => { const B = BULKY[id]; return !B ? 1 : q?.[1] ? 1 - (1 - B.slow) * GUT_KG : B.slow; };
// Cut up in the field: the drops ([id, min, max, chance], as PREY's)
export function fieldDrops(id, q, now) {
  const B = BULKY[id], s = starsOf(q, now);
  return B.drops.flatMap(([m, min, , chance], i) => {
    if (!q) return [[m, min, min, chance]];
    if (i === 0) { const n = meatOf(min, q, s); return [[m, n, n]]; }
    if (m === 'asta') return q[6] & F.ANTLERS && s > 1 ? [[m, 1, 1, s > 2 ? 1 : chance]] : [];
    return [[m, min, min, chance]];
  }).concat(q?.[3] ? [['flecha', q[3], q[3]]] : []);
}
const meatOf = (n, q, s) => Math.max(1, n + (s > 2 ? 1 : s < 2 ? -1 : 0) - (q[6] & F.TAINTED ? 1 : 0));
// At the kitchen: [[id, n]…]. roll: 0..1 (the antlers of a two-star one)
export function kitchenList(id, q, now, roll = Math.random()) {
  const B = BULKY[id], s = starsOf(q, now);
  if (!q) return [...B.drops.map(([m, , max]) => [m, max]), [B.extra, 1]];
  const out = [];
  B.drops.forEach(([m, , max, chance], i) => {
    if (i === 0) out.push([m, meatOf(max, q, s)]);
    else if (m === 'asta') { if (q[6] & F.ANTLERS && s > 1 && (s > 2 || roll < chance)) out.push([m, 1]); }
    else out.push([m, max + (m === 'piel' && s > 2 ? 1 : 0)]);
  });
  if (s > 1) out.push([B.extra, 1]);
  if (q[3]) out.push(['flecha', q[3]]);
  return out;
}
// As things of the backpack, where there is no carrying (the slot inventory, creative): the kitchen's, without the extra
export function partsList(id, q, now) {
  if (!q) return BULKY_PARTS[id] || [];
  return kitchenList(id, q, now).filter(([m]) => m !== BULKY[id].extra || BULKY[id].drops.some(d => d[0] === m));
}
// The random drops of a kill with no carcass (the slot inventory, creative): PREY's, with the meat of its stars
export function killDrops(drops, q, now) {
  if (!q) return drops;
  const s = starsOf(q, now);
  return drops.flatMap(([m, min, max, chance], i) => (i === 0 ? [[m, meatOf(min, q, s), meatOf(max, q, s)]] : m === 'asta' ? (q[6] & F.ANTLERS && s > 1 ? [[m, 1, 1, s > 2 ? 1 : chance]] : []) : [[m, min, max, chance]]));
}

// ---------- what Anselmo pays for a whole one ----------
export const PRICE = { carcass_deer: 180, carcass_hind: 150, carcass_boar: 160 }, STAR_K = [0.55, 1, 1.5], WHOLE_K = 0.8;
export const buysCarcass = id => PRICE[id] !== undefined;
export function carcassPrice(id, q, now, factor = 1) {
  return !buysCarcass(id) ? 0 : Math.max(1, Math.round(PRICE[id] * STAR_K[starsOf(q, now) - 1] * (q && !q[1] ? WHOLE_K : 1) * factor));
}
// What he would give now for what the arms carry (0: nothing he buys), by what the village thinks of you
// (and what Paco vouching for you adds: huntcode.js)
export const carcassOffer = g => (g.carry?.held && g.carry.bigNow ? carcassPrice(g.carry.held, g.carry.cq, g.days.now, (g.rep?.sellFactor() ?? 1) * (g.huntcode?.priceK() ?? 1)) : 0);
