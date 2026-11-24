// What each crop needs and gives: temperatures, frost, the ripe window, the harvest and the seeds. Pure data and pure
// functions, no imports: items.js, farm.js, fieldclimate.js and the tests read it (names, colours and prices: CROPS, in
// items.js). Design: docs/planes/realismo/PLAN-R2-huerto.md §3.2, §3.5, §3.6 (the numbers to tune after playing are here).
//   base, lo, hi, stop  °C of the day's mean: no growth at or below base, full between lo and hi, none from stop up
//   bite, kill          °C of the night's minimum: at or below bite it loses a day of growth; at or below kill it dies
//   window              days it stays at its best once ripe; half as long again it gives half; then see end
//   end                 'bolt': it goes to seed (roots and leaves); 'rot': the fruit rots or the grain falls; 'drop': the
//                       fruit falls and the plant gives more later (it comes back: CROPS[id].regrow)
//   poor, best          what a neglected plant and a well-kept one give
//   seeds               [how many are used, how many seeds come out] by hand (recipes.js), or null: only from going to seed
//   was                 the seasons it used to grow in, before the weather decided: crops from then keep growing in them
export const GROW = {
  nabo:      { base: 4,  lo: 10, hi: 20, stop: 28, bite: -4,  kill: -8,  window: 6,  end: 'bolt', poor: 1, best: 2, seeds: null,   was: [0] },
  fresa:     { base: 6,  lo: 14, hi: 24, stop: 32, bite: -1,  kill: -12, window: 3,  end: 'drop', poor: 2, best: 3, seeds: [2, 1], was: [0] },
  zanahoria: { base: 5,  lo: 12, hi: 22, stop: 30, bite: -3,  kill: -6,  window: 8,  end: 'bolt', poor: 1, best: 2, seeds: null,   was: [0, 2] },
  tomate:    { base: 10, lo: 20, hi: 29, stop: 35, bite: 2,   kill: 0,   window: 4,  end: 'rot',  poor: 2, best: 4, seeds: [1, 3], was: [1] },
  maiz:      { base: 10, lo: 20, hi: 30, stop: 38, bite: 2,   kill: 0,   window: 6,  end: 'rot',  poor: 2, best: 3, seeds: [1, 4], was: [1, 2] },
  trigo:     { base: 3,  lo: 12, hi: 24, stop: 32, bite: -10, kill: -15, window: 6,  end: 'rot',  poor: 2, best: 3, seeds: [1, 3], was: [1, 2] },
  calabaza:  { base: 12, lo: 20, hi: 30, stop: 36, bite: 2,   kill: 0,   window: 12, end: 'rot',  poor: 1, best: 2, seeds: [1, 5], was: [2] },
};
// The soil's moisture (0..100): enough (full growth) and too little (none), for a plant and for a seedling (its roots are
// short: it wants water daily in summer). dryDays: mornings in a row without any water until it dies; thirsty: until it
// looks wilted. A tile with nothing written down: 100 if it was watered yesterday or today, else 30
export const WATER = { full: 35, none: 15, seedFull: 70, seedNone: 35, wet: 70, damp: 35, thirsty: 2, dryDays: 4, unknown: 30 };
// What a day takes from the soil, °C of the day's maximum over 7 twice, between etMin and etMax, less with less sun
export const DRY = { per: 2, from: 7, min: 6, max: 60, sky: { sol: 1, nubes: 0.6, niebla: 0.5, lluvia: 0, tormenta: 0, nieve: 0, ventisca: 0 }, mulch: 0.5 };
export const SNOW_WATER = 30, MULCH_DAYS = 30, MULCH_FROST = 1;   // snow melts into the soil; straw on it: how long it lasts and °C less of frost
export const SEED_WAIT = 14;     // days a seed waits for the warmth or the water before it rots
export const GRACE = 10;         // mornings nothing from before the weather decided can die of frost or drought
export const OLD_RATE = 30;      // days a crop from then keeps growing whatever the weather, if it is watered
export const OLD_RIPE = 7;       // days more a crop that was already ripe then stays at its best
export const FROST_LOOK = 2;     // days a bitten plant keeps its dark leaves
export const BOLT_SEEDS = [3, 5];

// The seed item of a crop: the first seven have Spanish ids (older saves have them); new ones, seed_<id>
const OLD_SEEDS = new Set(['nabo', 'fresa', 'zanahoria', 'tomate', 'maiz', 'trigo', 'calabaza']);
export const seedOf = id => (OLD_SEEDS.has(id) ? 'semilla_' : 'seed_') + id;

// How much of a good day a day of mean temperature T is for a crop: 0..1
export function rateAt(id, T) {
  const g = GROW[id];
  if (!g) return 0;
  if (T <= g.base || T >= g.stop) return 0;
  return T < g.lo ? (T - g.base) / (g.lo - g.base) : T <= g.hi ? 1 : (g.stop - T) / (g.stop - g.hi);
}
// How much of the water it wants a plant (or a seedling) has with this moisture: 0..1
export function waterAt(moist, seedling) {
  const full = seedling ? WATER.seedFull : WATER.full, none = seedling ? WATER.seedNone : WATER.none;
  return moist >= full ? 1 : moist <= none ? 0 : (moist - none) / (full - none);
}
// How much the soil dries in a day with this maximum and weather
export const dryingAt = (max, weather) => Math.min(DRY.max, Math.max(DRY.min, DRY.per * (max - DRY.from))) * (DRY.sky[weather] ?? 1);
// What a plant kept like h (0..1: its health) gives, before luck
export const yieldAt = (id, h) => { const g = GROW[id]; return Math.max(1, Math.round(g.poor + (g.best - g.poor) * h * h)); };
export const qualityOf = h => (h >= 0.9 ? 'excellent' : h >= 0.7 ? 'good' : h >= 0.45 ? '' : 'poor');
