// The fruit trees by the calendar of the place: when each is in blossom, when its fruit hangs, and what it gives. Pure data
// and pure functions, no imports: farm.js (the rules), the trees' drawing and the tests read it.
// Design: docs/planes/realismo/PLAN-R2-huerto.md §3.10 (the numbers to tune after playing are here).
//   item, n         what a shake gives, and how many of it
//   bloom           the days of the local spring it is in blossom: a night of BLOSSOM_FROST or less then burns it, and there
//                   is no fruit that year
//   ripe            [[season, from, to]…] the local days its fruit hangs (a season 0 spring … 3 winter, its days from 1)
//   always          all the year round, frost or no frost (the palm's coconuts)
// Keys of the game's object kinds (gen.js, farm.js d.trees): 'fruit' is the apple tree, the one that grows wild
export const FRUIT = {
  fruit: { item: 'manzana', n: [2, 3], bloom: [22, 70], ripe: [[1, 45, 99], [2, 1, 75]] },
  pear: { item: 'pear', n: [2, 3], bloom: [14, 55], ripe: [[1, 60, 99], [2, 1, 60]] },
  cherry: { item: 'cherry', n: [4, 6], bloom: [8, 45], ripe: [[0, 60, 99], [1, 1, 30]] },
  palm: { item: 'coco', n: [1, 3], always: true },
};
export const ORCHARD = Object.keys(FRUIT).filter(k => !FRUIT[k].always);
export const TREE_DAYS = 3;          // days a planted sapling takes to be a tree
export const FIRST_FRUIT = 10;       // days until a planted fruit tree has its first fruit (those planted before, TREE_DAYS)
export const FRUIT_EVERY = 3;        // days between two pickings of one tree
export const BLOSSOM_FROST = -1;     // °C of the night's minimum, at or below: the blossom burns
export const SET_DAYS = 12;          // days after the blossom until the small green fruit is seen
export const FRUIT_GRACE = 10;       // days the fruit that hung when the calendar began to count still hangs (older worlds)

// How a fruit tree stands on a day of its place: 'bare' (winter), 'leaf', 'bloom', 'green' (its fruit grows), 'ripe'
export function phaseAt(kind, season, dos) {
  const f = FRUIT[kind];
  if (!f || f.always) return 'ripe';
  if (season === 3) return 'bare';
  if (f.ripe.some(([s, a, b]) => s === season && dos >= a && dos <= b)) return 'ripe';
  if (season === 0 && dos >= f.bloom[0] && dos <= f.bloom[1]) return 'bloom';
  const [s, from] = f.ripe[0], set = f.bloom[1] + SET_DAYS;
  return (season < s || (season === s && dos < from)) && (season > 0 || dos >= set) ? 'green' : 'leaf';
}
// The season its next fruit comes in, from a season and its day
export function nextFruit(kind, season, dos) {
  const r = FRUIT[kind].ripe;
  for (let i = 0; i < 5; i++) { const s = (season + i) % 4, w = r.find(x => x[0] === s); if (w && (i > 0 || dos < w[1])) return s; }
  return r[0][0];
}
// How big a young fruit tree is (a factor of its full size) a days after it was planted
export const youngK = a => 0.45 + 0.55 * Math.min(1, Math.max(0, a - TREE_DAYS) / (FIRST_FRUIT - TREE_DAYS));
