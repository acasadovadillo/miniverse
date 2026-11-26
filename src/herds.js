// Where the wild animals live (Plan R3 §3.3, docs/planes/realismo/PLAN-R3-caza.md): herds with home ranges. The world is cut
// in cells of CELL tiles; by its land and the world's seed each has a group of deer (hinds with their calves, or stags), a
// sounder of boar (or a lone male), a pair of swans, or nothing. A group has its places (a bed in cover, a feeding place and
// water to drink) and its hours, so where its middle is at any time (where) is worked out, never stored, and the same herd is
// in the same meadow tomorrow at dawn. Here only the numbers, pure: the cells, the members, the hours; and what whoever runs
// the world remembers of a group (a disturbed one, which is not saved). wildlife.js makes the group a
// player comes near real, moves it, and lets it go when nobody is near.
import { ihash } from './util.js';
import { B, BIOMES, climate, classify, wetness } from './world/biomes.js';
import { BOUNDS } from './world/village.js';
import { wrapX, wrapIndex, dxOf, inPlanet, latOf } from './world/planet.js';
import { sizeOf as raceSize } from './horsebreeds.js';

export const CELL = 64;
// The balance, all together (metres, game seconds, hours): to be tuned by playing
export const HERD = {
  CHANCE: { deerWoods: 0.6, deerMeadow: 0.5, boar: 0.45, swan: 0.7 },   // of a cell having each, by its land
  SHARE: 0.25,                 // of the cell's land being wood (or meadow) for it to count as one
  LAKE: 5,                     // points of the cell's 64 in a lake, for a pair of swans (not on a puddle)
  VILLAGE: 80,                 // no place of theirs nearer the village than this
  FEED_R: [16, 64], WATER_R: 48, BED_R: 64,   // how far the feeding place is from the bed, the water from it, and a meadow's bed
  HINDS: [3, 6], CALVES: [1, 2], STAGS: [1, 3], STAG_GROUP: 0.35,
  SOWS: [2, 5], PIGLETS: [1, 3], SOUNDER_MAX: 7, LONE_BOAR: 0.3,
  DRIFT: [6, 14], DRIFT_S: 2400,   // how far round its feeding place its middle wanders, by day and by night, and how slowly
  NEAR: 70, GONE: 100,         // a group whose middle is this near a player becomes real; with all of it past GONE, it goes
  WARM: 30,                    // the ground of one this much further than NEAR is made ready
  MIN: 40,                     // none appears nearer a player than this
  SWAP: 78,                    // a calm one all of it further than this goes if a nearer one needs its room
  REACH: 2,                    // the cells looked at round a player's (each side)
  GROUPS: 3, MAX: 12,          // real ones at once round each player, and animals
  EVERY: 1, RETRY: 8,          // seconds between two looks, and before trying again a group with no room where it is
  QUIET: [8, 16],              // nothing built at its place nor this far round it
  SPREAD: 30, ROUSE: 15, WARN: 0.8,   // an alarm goes through the group this far (awareness WARN); one on its guard, this far
  SPOOKED: 360, WARY: 0.3,     // a group that fled stays where it fled for this long, and is uneasy when it is met again
  BACK_DAYS: 4, LAST_H: 12,    // one taken comes back in so many real days; the last of a group, in so many hours
  WARY_DAYS: 3, WARY_K: 1.25,  // a cell somebody hunted in: on edge for so long, and its animals notice from this much further
  WINTER_MAX: 8, WINTER_R: [20, 36, 52],   // the animals of two herds gone together, at most; where their winter feeding place may be
  SHED: 0.6, SHED_R: [4, 22],  // of the herds in woods, the ones with a cast antler to find in spring, and how far from their bed
  AROUND: [3, 8], NIGHT: [4, 11], YOUNG: [1.2, 3],   // how far from its leader (its mother) each one wanders
  BED: [1.8, 5], STRAY: 14, HURRY: 2.2,   // round the bed; further than STRAY from its leader it hurries back
  DRINK: [8, 18], ROOT: [10, 30],          // seconds of a drink, and of a boar's rooting
};
export const AGE = { young: 0, adult: 1, prime: 2, old: 3 };
const SIZE0 = 0.85, SIZE_STEP = 0.05;
export const HIND_K = 0.9, YOUNG = 0.55;     // (how big a hind or a sow is by a stag's or a male's; a young one, by a grown one)
// How big an animal's body is, by its species' (a farm one, a horse by its breed, a wild one of a herd, or on its own)
export const scaleOf = e => (e.young ? YOUNG : 1) * (e.type === 'caballo' ? raceSize(e) : 1) * (e.traits ? (e.size || 1) * (e.female && !e.young && e.type !== 'cisne' ? HIND_K : 1) : 1);
const TYPE = { deer: 'ciervo', boar: 'jabali', swan: 'cisne' };
const KINDS = ['deer', 'boar', 'swan'];
const NONE = Object.freeze([]), DAY = 864e5;
export const MERGED = 40;   // (what is added to the member index of a herd that has come to another in winter)
// The ones taken of a group, from its record (d.game): a Map with its step, or null
function readLost(rec) {
  if (!Array.isArray(rec) || !Number.isFinite(rec[0]) || rec.length < 3) return null;
  const M = new Map();
  M.step = rec[0];
  for (let n = 1; n + 1 < rec.length && M.size < 60; n += 2) if (Number.isInteger(rec[n]) && Number.isFinite(rec[n + 1])) M.set(rec[n], rec[n + 1]);
  return M.size ? M : null;
}
const GRID = 8, STEP = CELL / GRID, TAU = Math.PI * 2;
const DIRS = Array.from({ length: 12 }, (_, i) => [Math.cos(i * TAU / 12), Math.sin(i * TAU / 12)]);
const green = b => b === B.MEADOW || b === B.FOREST || b === B.PINES, wood = b => b === B.FOREST || b === B.PINES;
const lerp = (a, b, k) => a + (b - a) * k;
const ease = k => { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); };
// How near the village (0 inside its bounds)
const villageD = (x, y) => Math.hypot(Math.max(0, BOUNDS.x0 - wrapX(x), wrapX(x) - BOUNDS.x1), Math.max(0, BOUNDS.y0 - y, y - BOUNDS.y1));

// The day of the year as month × 100 + day, where y is (south of the equator half a year on). ms: the game's clock
export function dayOfYear(ms, y = 0) {
  const d = new Date(ms + (latOf(y) < 0 ? 182.5 * 864e5 : 0));
  return (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}
export const calvesOn = md => md >= 501 || md < 301;                 // (with their mothers until the next spring's)
export const rutOn = md => md >= 915 && md <= 1020;
export const winterOn = md => md >= 1201 || md < 301;
export const shedsOn = md => md >= 301 && md <= 531;
// The antlers of a stag: none (cast), buds (short, in velvet), velvet or hard
export const ANTLERS = ['none', 'bud', 'velvet', 'hard'];
export const antlersIn = md => (md >= 801 || md < 301 ? 'hard' : md < 415 ? 'none' : md < 601 ? 'bud' : 'velvet');
// Does one this big, and of this age, carry five tines a side (the others, three)?
export const fiveTines = (size, age) => age >= AGE.prime && size >= 1.05;
export const stripedOn = md => md >= 301 && md < 901;                // (the piglets' stripes; then, reddish)
// How a wild animal looks, for its model (three/animals.js breeds): undefined, the stag with its three tines and the male boar
export function breedOf(type, female, young, md, size = 1, age = AGE.adult) {
  if (type === 'ciervo') return young ? 'calf' : female ? 'hind' : stagBreed(antlersIn(md), fiveTines(size, age));
  if (type === 'jabali') return young ? (stripedOn(md) ? 'piglet' : 'reddish') : female ? 'sow' : undefined;
  return undefined;
}
const stagBreed = (a, five) => (a === 'none' || a === 'bud' ? a : a === 'velvet' ? (five ? 'velvet5' : 'velvet') : five ? 'hard5' : undefined);
// Its name (lang wild.*), or null: the species' own (a summoned one, or an old host's)
export function nameKey(e) {
  if (!e.traits) return null;
  if (e.type === 'ciervo') return e.young ? 'calf' : e.female ? 'hind' : 'stag';
  if (e.type === 'jabali') return e.young ? 'piglet' : e.female ? 'sow' : null;
  return null;
}
export const sizeStep = s => Math.max(0, Math.min(7, Math.round((s - SIZE0) / SIZE_STEP)));
export const sizeOf = n => SIZE0 + SIZE_STEP * (n & 7);

// ---------- the hours ----------
// What a group does at an hour (0..24): out.act ('feed', 'walk', 'bed', 'drink', 'lake') and where between its places:
// out.from, out.to (the names of the two) and out.k (0..1)
const set = (o, act, from, to = from, k = 0) => { o.act = act; o.from = from; o.to = to; o.k = k; return o; };
export function hours(kind, h, water, out) {
  if (kind === 'swan') return set(out, 'lake', 'bed', 'feed', 0.5 - 0.5 * Math.cos(h / 24 * TAU * 3));
  if (kind === 'boar') {
    if (h >= 7 && h < 20) return set(out, 'bed', 'bed');
    if (h >= 6 && h < 7) return set(out, 'walk', 'bed');
    return set(out, 'feed', 'bed', 'feed', 0.5 - 0.5 * Math.cos(((h + 4) % 24) / 10 * TAU * 2));   // (twice out and back, from 20 to 6)
  }
  if (h >= 8 && h < 9) return set(out, 'walk', 'feed', 'bed', h - 8);
  if (h >= 9 && h < 16) return set(out, 'bed', 'bed');
  if (h >= 16 && h < 17) return set(out, 'walk', 'bed', 'feed', h - 16);
  if (water && h >= 18 && h < 19) {
    if (h < 18.3) return set(out, 'walk', 'feed', 'water', (h - 18) / 0.3);
    if (h < 18.7) return set(out, 'drink', 'water');
    return set(out, 'walk', 'water', 'feed', (h - 18.7) / 0.3);
  }
  return set(out, 'feed', 'feed');
}
// ---------- the roar of the rut ----------
// A stag roars every 20 to 60 s, from 6 to 10 and from 18 to 24: how far into a roar it is now (0..1), or -1. h: the hour
// there; ms: the game's clock
export const ROAR = { SLOT: 40, JIT: 20, FOR: 2.4, R: 250 };
export const roarHour = h => (h >= 6 && h < 10) || h >= 18;
export function roarPhase(id, ms, h) {
  if (!roarHour(h)) return -1;
  let k = 7;
  for (let i = 0; i < id.length; i++) k = (k * 31 + id.charCodeAt(i)) % 9973;
  const s = ms / 1000, n = Math.floor(s / ROAR.SLOT), t = s - (n * ROAR.SLOT + ihash(n, k, 977) * ROAR.JIT);
  return t >= 0 && t < ROAR.FOR ? t / ROAR.FOR : -1;
}
// (0 by day, 1 by night: they spread out more)
const nightK = h => Math.max(ease((h - 21) / 1.5), 1 - ease((h - 4) / 1.5));

// ---------- the cells ----------
export class Herds {
  // gen: the world's generator (grassAt, seed). ready: sites of R7 not used yet (lick: see place of a deer group). store: where
  // the ones somebody took are kept, { read(cx, cy) → d.game or null, write(cx, cy, key, value) (null on a guest) }
  constructor(gen, { lick = null, store = null } = {}) {
    this.gen = gen; this.seed = gen.seed; this.lick = lick; this.store = store;
    this.cells = new Map();      // 'cx,cy' → its groups (an LRU)
    this.c = {};
    this.spooked = new Map();    // id → { till, dx, dy }: where a disturbed group is, off its hours' place
    this.gone = new Map();       // id → Map(member index → when, ms; step: when the last one came back)
    this.drawn = new Map();      // id → { x, y, dx, dy, t, s, till }: a group that comes to a call, off its hours' place
    this.H = { act: '', from: '', to: '', k: 0 };
    this.stats = { cells: 0, ms: 0, worst: 0 };
  }
  roll(cx, cy, n) { return ihash(cx + n * 911, cy - n * 367, this.seed + 9600); }
  land(x, y) {
    const c = climate(x, y, this.seed, this.c);
    return classify(c.T, c.M, c.C, c.R, c.L, c.K, c.P, c.f, 0, c.Q, c.Tl, c.Ml);
  }
  // Fresh water (a river, a lake) at a point
  fresh(x, y) { const c = climate(x, y, this.seed, this.c); return c.C > 0.41 && c.Q <= 0.5 && wetness(c) > 0; }
  // Dry green land, away from the village, at a point (and a step round it)
  goodLand(x, y, test = green) {
    if (!inPlanet(wrapX(x), y) || villageD(x, y) < HERD.VILLAGE) return false;
    for (let i = 0; i < 5; i++) { const px = x + (i === 1 ? 2.5 : i === 2 ? -2.5 : 0), py = y + (i === 3 ? 2.5 : i === 4 ? -2.5 : 0); if (!(i ? green : test)(this.land(px, py)) || wetness(this.c) > -0.05) return false; }
    return true;
  }
  // The groups of a cell: [{ id, kind, type, cx, cy, x, y, bed, feed, water, n… }]
  cell(cx, cy) {
    cx = wrapIndex(cx, CELL);
    const k = cx + ',' + cy;
    let c = this.cells.get(k);
    if (c) return c;
    const t0 = performance.now();
    c = this.make(cx, cy);
    const ms = performance.now() - t0;
    this.stats.cells++; this.stats.ms += ms; this.stats.worst = Math.max(this.stats.worst, ms);
    this.cells.set(k, c);
    if (this.cells.size > 260) this.cells.delete(this.cells.keys().next().value);
    return c;
  }
  has(cx, cy) { return this.cells.has(wrapIndex(cx, CELL) + ',' + cy); }
  make(cx, cy) {
    const x0 = cx * CELL, y0 = cy * CELL, woods = [], meadow = [], lakes = [];
    // (the land on a grid of 8 × 8 points: what the cell is, and where its places may be)
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
      const x = x0 + (i + 0.5) * STEP + 0.3, y = y0 + (j + 0.5) * STEP + 0.3;
      if (!inPlanet(x, y)) continue;
      const b = this.land(x, y);
      if (b === B.LAKE) lakes.push([x, y]);
      else if (wetness(this.c) > -0.05) continue;
      else if (wood(b)) woods.push([x, y]);
      else if (b === B.MEADOW) meadow.push([x, y]);
    }
    const out = [], N = GRID * GRID, isWood = woods.length >= N * HERD.SHARE, isMeadow = meadow.length >= N * HERD.SHARE, C = HERD.CHANCE;
    if (isWood || isMeadow) {
      if (this.roll(cx, cy, 1) < (isWood ? C.deerWoods : C.deerMeadow)) { const g = this.deer(cx, cy, woods, meadow, isWood); if (g) out.push(g); }
      if (isWood && this.roll(cx, cy, 2) < C.boar) { const g = this.boar(cx, cy, woods, meadow); if (g) out.push(g); }
    }
    if (lakes.length >= HERD.LAKE && this.roll(cx, cy, 3) < C.swan) { const g = this.swans(cx, cy, lakes); if (g) out.push(g); }
    return out.length ? out : NONE;
  }
  // One of a list of points, by the seed: the first (of up to 8) that will do
  pick(cx, cy, n, list, ok) {
    if (!list.length) return null;
    for (let t = 0; t < Math.min(8, list.length * 2); t++) {
      const p = list[Math.floor(this.roll(cx, cy, n + t) * list.length)], x = p[0] + (this.roll(cx, cy, n + t + 20) - 0.5) * STEP, y = p[1] + (this.roll(cx, cy, n + t + 40) - 0.5) * STEP;
      if (ok(x, y)) return [x, y];
    }
    return null;
  }
  group(kind, cx, cy, bed, feed, water) {
    const k = KINDS.indexOf(kind);
    return { id: `g${cx}.${cy}.${k}`, kind, type: TYPE[kind], cx, cy, bed, feed, water, s: k * 1000 + 100 };
  }
  deer(cx, cy, woods, meadow, isWood) {
    let feed = null, bed = null;
    const inWood = (x, y) => this.goodLand(x, y, wood), land = (x, y) => this.goodLand(x, y);
    // (on the same side of the water: they do not cross it)
    const apart = p => (x, y) => { const d = Math.hypot(x - p[0], y - p[1]); return d >= HERD.FEED_R[0] && d <= HERD.FEED_R[1] && land(x, y) && this.dryWay(p, x, y); };
    if (isWood) {
      bed = this.pick(cx, cy, 100, woods, inWood);
      if (!bed) return null;
      feed = this.pick(cx, cy, 200, meadow, apart(bed)) || this.ring(bed, HERD.FEED_R, b => b === B.MEADOW, apart(bed)) || this.pick(cx, cy, 300, woods, apart(bed)) || this.ring(bed, HERD.FEED_R, green, apart(bed));
    } else {
      feed = this.pick(cx, cy, 100, meadow, land);
      if (!feed) return null;
      const there = (x, y) => inWood(x, y) && this.dryWay(feed, x, y);
      bed = this.pick(cx, cy, 200, woods, there) || this.ring(feed, [8, HERD.BED_R], wood, there) || this.tallGrass(cx, cy, feed, meadow);
    }
    if (!bed || !feed) return null;
    const salt = this.lick?.(cx, cy);   // (a salt lick of the cell, once R7 puts them in the world: where they feed)
    if (salt && Math.hypot(dxOf(salt[0], bed[0]), salt[1] - bed[1]) < HERD.FEED_R[1] && land(salt[0], salt[1]) && this.dryWay(bed, salt[0], salt[1])) feed = salt;
    const g = this.group('deer', cx, cy, bed, feed, this.shore(feed));
    g.stags = this.roll(cx, cy, 10) < HERD.STAG_GROUP;
    return g;
  }
  boar(cx, cy, woods, meadow) {
    const inWood = (x, y) => this.goodLand(x, y, wood), bed = this.pick(cx, cy, 400, woods, inWood);
    if (!bed) return null;
    const apart = (x, y) => { const d = Math.hypot(x - bed[0], y - bed[1]); return d >= HERD.FEED_R[0] && d <= HERD.FEED_R[1] && this.goodLand(x, y) && this.dryWay(bed, x, y); };
    const feed = this.pick(cx, cy, 500, woods.concat(meadow), apart) || this.ring(bed, HERD.FEED_R, green, apart);
    if (!feed) return null;
    const g = this.group('boar', cx, cy, bed, feed, null);
    g.lone = this.roll(cx, cy, 11) < HERD.LONE_BOAR;
    return g;
  }
  swans(cx, cy, lakes) {
    const wet = (x, y) => { for (let i = 0; i < 5; i++) if (this.land(x + (i === 1 ? 2 : i === 2 ? -2 : 0), y + (i === 3 ? 2 : i === 4 ? -2 : 0)) !== B.LAKE) return false; return true; };
    const bed = this.pick(cx, cy, 600, lakes, wet) || this.pick(cx, cy, 640, lakes, (x, y) => this.land(x, y) === B.LAKE);
    if (!bed) return null;
    const feed = this.pick(cx, cy, 700, lakes, (x, y) => wet(x, y) && Math.hypot(x - bed[0], y - bed[1]) < 30 && this.sameLake(bed, [x, y])) || bed;
    return this.group('swan', cx, cy, bed, feed, null);
  }
  sameLake(a, b) { for (let i = 1; i < 8; i++) if (wetness(climate(lerp(a[0], b[0], i / 8), lerp(a[1], b[1], i / 8), this.seed, this.c)) <= 0.1) return false; return true; }
  // No water on the straight way from p to (x, y)
  dryWay(p, x, y) { const n = Math.ceil(Math.hypot(x - p[0], y - p[1]) / 2); for (let i = 1; i < n; i++) if (wetness(climate(lerp(p[0], x, i / n), lerp(p[1], y, i / n), this.seed, this.c)) > 0) return false; return true; }
  // The nearest point round p where the land is of a kind and will do
  ring(p, [r0, r1], kind, ok) {
    for (let r = r0; r <= r1; r += 8) for (const [c, s] of DIRS) { const x = p[0] + c * r, y = p[1] + s * r; if (kind(this.land(x, y)) && ok(x, y)) return [x, y]; }
    return null;
  }
  tallGrass(cx, cy, feed, meadow) {
    const tall = (x, y) => { const d = Math.hypot(x - feed[0], y - feed[1]); return d >= HERD.FEED_R[0] && d <= HERD.BED_R && this.goodLand(x, y) && this.dryWay(feed, x, y) && (this.gen.grassAt?.(Math.floor(wrapX(x)), Math.floor(y)) || 0) > 0; };
    return this.pick(cx, cy, 800, meadow, tall) || this.pick(cx, cy, 860, meadow, (x, y) => this.goodLand(x, y) && Math.hypot(x - feed[0], y - feed[1]) >= HERD.FEED_R[0] && this.dryWay(feed, x, y));
  }
  // The nearest shore of fresh water to p: [x, y (dry), wx, wy (the water)], or null
  shore(p) {
    for (let r = 4; r <= HERD.WATER_R; r += 4) for (const [c, s] of DIRS) {
      const wx = p[0] + c * r, wy = p[1] + s * r;
      if (!this.fresh(wx, wy)) continue;
      for (let d = r - 0.5; d > 0; d -= 0.5) {
        const x = p[0] + c * d, y = p[1] + s * d;
        if (wetness(climate(x, y, this.seed, this.c)) <= 0) return villageD(x, y) < HERD.VILLAGE ? null : [p[0] + c * (d - 1), p[1] + s * (d - 1), p[0] + c * (d + 1), p[1] + s * (d + 1)];
      }
    }
    return null;
  }

  // ---------- the members ----------
  // The animals of a group, the first one its leader: [{ i, female, young, age, size, mother }], by the seed and the day of the
  // year (md), so they are the same ones every day: without the ones somebody took (now: ms). In winter, with the ones of the
  // herd that has come to it (their i + MERGED), and none of one that has gone to another
  members(g, md, now = 0) {
    const P = winterOn(md) ? this.pairOf(g) : null;
    if (P?.to) return [];
    const out = this.own(g, md, now);
    if (P?.from) for (const m of this.own(P.from, md, now)) out.push({ ...m, i: m.i + MERGED, mother: m.mother >= 0 ? m.mother + MERGED : -1 });
    return out;
  }
  // As seeded, all of them (full), or the ones that are left
  seeded(g, md) {
    const out = [], R = n => this.roll(g.cx, g.cy, g.s + n), many = ([a, b], n) => a + Math.floor(R(n) * (b - a + 1));
    const add = (i, female, age, mother = -1) => out.push({ i, female, young: age === 0, age, size: sizeOf(age ? 1 + Math.floor(R(400 + i) * 7) : md >= 1101 || md < 301 ? 5 : md >= 801 ? 3 : 1), mother });   // (the young grow through the year)
    const grown = i => { const v = R(300 + i); return v < 0.4 ? AGE.adult : v < 0.8 ? AGE.prime : AGE.old; };
    if (g.kind === 'swan') { add(0, true, AGE.prime); add(1, false, AGE.prime); for (const m of out) m.size = sizeOf(3); }
    else if (g.kind === 'deer' && g.stags) { const n = many(HERD.STAGS, 1); for (let i = 0; i < n; i++) add(i, false, i ? grown(i) : AGE.prime); }
    else if (g.kind === 'deer') {
      const n = many(HERD.HINDS, 1), born = j => !(md >= 501 && md < 601) || md - 501 >= Math.floor(R(340 + j) * 31);   // (each on its day of May)
      for (let i = 0; i < n; i++) add(i, true, i ? grown(i) : AGE.old);
      if (calvesOn(md)) for (let j = 0, m = many(HERD.CALVES, 2); j < m; j++) if (born(j)) add(10 + j, R(320 + j) < 0.5, AGE.young, j + (n > 1 ? 1 : 0) < n ? j + (n > 1 ? 1 : 0) : 0);
      if (rutOn(md)) add(20, false, AGE.prime);
    } else if (g.lone) add(0, false, AGE.old);
    else {
      const n = many(HERD.SOWS, 1), born = j => !(md >= 301 && md < 401) || md - 301 >= Math.floor(R(340 + j) * 31);   // (from the first of March, each on its day)
      for (let i = 0; i < n; i++) add(i, true, i ? grown(i) : AGE.old);
      for (let j = 0, m = Math.min(many(HERD.PIGLETS, 2), HERD.SOUNDER_MAX - n); j < m; j++) if (born(j)) add(10 + j, R(320 + j) < 0.5, AGE.young, j % n);
    }
    return out;
  }
  own(g, md, now) {
    const out = this.seeded(g, md), lost = this.lostOf(g);
    if (!lost) return out;
    this.regrow(g, lost, now);
    let left = out.filter(m => !lost.has(m.i));
    // (never all of it: the last one's place is taken by another soon after)
    if (!left.length && out.length) { let last = out[0], at = Infinity; for (const m of out) { const t = lost.get(m.i) ?? 0; if (t < at) { at = t; last = m; } } left = now - Math.max(...lost.values()) > HERD.LAST_H * 36e5 ? [last] : left; }
    return left;
  }
  // The ones of a group that somebody took, as they are written now (store): Map(i → when), or undefined
  lostOf(g) {
    const rec = this.store?.read(g.cx, g.cy)?.[g.kind];
    if (this.store && rec !== g.rec) {
      g.rec = rec;
      const M = readLost(rec);
      if (M) this.gone.set(g.id, M); else this.gone.delete(g.id);
    }
    return this.gone.get(g.id);
  }
  // One of them died (now: ms)
  take(id, i, now) {
    const p = parseId(id + '.0'), g = p && this.cell(p.cx, p.cy).find(o => o.id === id);
    if (!g) return;
    if (i >= MERGED) { const from = this.pairOf(g)?.from; if (from) this.take(from.id, i - MERGED, now); return; }
    let m = this.lostOf(g);
    if (m) this.regrow(g, m, now);
    if (!m || !m.size) { this.gone.set(id, m = new Map()); m.step = now; }
    m.delete(i); m.set(i, now);
    this.write(g, m);
  }
  write(g, m) {
    if (!this.store?.write) return;
    const rec = m && m.size ? [Math.round(m.step), ...[...m].flatMap(([i, at]) => [i, Math.round(at)])] : undefined;
    g.rec = rec;
    this.store.write(g.cx, g.cy, g.kind, rec);
  }
  // (one comes back every BACK_DAYS, the one that has been missing longest; twice as fast from May to August. By the time gone
  // by, at the pace of each moment: the same whoever works it out, and whenever)
  regrow(g, lost, now) {
    if (now < lost.step) lost.step = now;   // (the clock was put back)
    for (;;) {
      const md = dayOfYear(lost.step, g.bed[1]), ms = HERD.BACK_DAYS * (md >= 501 && md < 901 ? 0.5 : 1) * DAY;
      if (!lost.size || now - lost.step <= ms) break;
      lost.delete(lost.keys().next().value); lost.step += ms;
    }
    if (lost.size) return;
    this.gone.delete(g.id);
    if (g.rec) { if (this.store?.write) this.write(g, null); }
  }
  // How many of a group are missing
  missing(g, now) { const m = this.lostOf(g); if (!m) return 0; this.regrow(g, m, now); return m.size; }
  // Until when a cell is on edge (ms; 0: it is not), and putting it so
  waryTill(cx, cy) { const v = this.store?.read(cx, cy)?.wary; return Number.isFinite(v) ? v : 0; }
  isWary(g, now) { const t = this.waryTill(g.cx, g.cy); return t > now && t - now <= HERD.WARY_DAYS * DAY + 36e5; }
  alarm(g, now) {
    const till = Math.round(now + HERD.WARY_DAYS * DAY), was = this.waryTill(g.cx, g.cy);
    if (this.store?.write && !(was > till - 36e5 && was <= till + 36e5)) this.store.write(g.cx, g.cy, 'wary', till);   // (not at every arrow)
  }

  // ---------- the year ----------
  // In winter: the herd that comes to this one (from), or the one it has gone to (to); null, on its own. The deer of the cell
  // by it, if they are not too many together; the bigger herd keeps its places (the stags go to the hinds)
  pairOf(g) {
    if (g.pair !== undefined) return g.pair;
    const o = g.kind === 'deer' ? this.cell(g.cx ^ 1, g.cy).find(x => x.kind === 'deer') : null, a = o && this.seeded(g, 1215).length, b = o && this.seeded(o, 1215).length;
    const host = o && (a !== b ? a > b : (g.cx & 1) === 0);
    return (g.pair = o && a + b <= HERD.WINTER_MAX ? (host ? { from: o, to: null } : { from: null, to: o }) : null);
  }
  // Its places in winter: the lowest feeding place there is (out of the wind and the deep snow), and its water if it can be walked to
  winterOf(g) {
    if (g.win || g.kind !== 'deer') return g.win || g;
    const H = (x, y) => this.gen.groundAt?.(wrapX(x), y) ?? 0, d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    let best = g.feed, h = H(...g.feed);
    for (const r of HERD.WINTER_R) for (let i = 0; i < DIRS.length; i += 2) {
      const x = g.bed[0] + DIRS[i][0] * r, y = g.bed[1] + DIRS[i][1] * r, k = H(x, y);
      if (k < h - 1 && this.goodLand(x, y) && this.dryWay(g.bed, x, y)) { h = k; best = [x, y]; }
    }
    const water = g.water && d(g.water, best) <= HERD.FEED_R[1] && this.dryWay(best, g.water[0], g.water[1]) ? g.water : null;
    return (g.win = best === g.feed ? g : { bed: g.bed, feed: best, water });
  }
  // Its cast antler, the spring of a year: { key, x, y, yaw, five } or null (in woods near its bed)
  shedOf(g, year) {
    if (g.kind !== 'deer') return null;
    const S = g.sheds ||= new Map();
    if (S.has(year)) return S.get(year);
    const R = n => this.roll(g.cx + (year % 97) * 13, g.cy, g.s + 700 + n);
    let out = null;
    if (wood(this.land(...g.bed)) && R(0) < HERD.SHED) for (let i = 0; i < 8 && !out; i++) {
      const a = R(1 + i) * TAU, r = lerp(HERD.SHED_R[0], HERD.SHED_R[1], R(20 + i)), x = g.bed[0] + Math.cos(a) * r, y = g.bed[1] + Math.sin(a) * r;
      if (this.goodLand(x, y, wood)) out = { key: `${g.cx}.${g.cy}`, x: wrapX(x), y, yaw: R(40) * TAU, five: R(41) < 0.4 };
    }
    S.set(year, out);
    return out;
  }
  // The member of a group that roars in the rut (its stag's i), or -1
  roarer(g, md, now) {
    if (g.kind !== 'deer' || !rutOn(md)) return -1;
    const i = g.stags ? 0 : 20;
    return this.lostOf(g)?.has(i) && this.own(g, md, now).every(m => m.i !== i) ? -1 : i;
  }

  // ---------- where ----------
  // Where a group's middle is at an hour (the one where it lives; ms: the game's clock, for its slow wander), into out:
  // x, y, act, night (0..1). shift: where a disturbed one is (now: game seconds)
  where(g, h, ms, now, out) {
    const P = g.kind === 'deer' && winterOn(dayOfYear(ms, g.bed[1])) ? this.winterOf(g) : g;
    const H = hours(g.kind, h, P.water, this.H), a = P[H.from], b = P[H.to];
    out.act = H.act; out.night = nightK(h);
    out.x = lerp(a[0], b[0], H.k); out.y = lerp(a[1], b[1], H.k);
    if (H.act === 'feed') {
      const R = lerp(HERD.DRIFT[0], HERD.DRIFT[1], out.night), p = this.roll(g.cx, g.cy, g.s + 60) * TAU + (ms / 1000 / HERD.DRIFT_S) * TAU;
      out.x += Math.cos(p) * R; out.y += Math.sin(p * 0.7 + 1) * R * 0.8;
    }
    const s = this.spooked.get(g.id);
    if (s) { if (now > s.till || now < s.till - HERD.SPOOKED - 1) this.spooked.delete(g.id); else { out.x += s.dx; out.y += s.dy; } }
    const c = this.drawn.size ? this.drawn.get(g.id) : null;
    if (c) {   // (a stag comes to a call: that far so far, and back to its own places in a while)
      if (now > c.till || now < c.t) this.drawn.delete(g.id);
      else { const k = Math.min(1, (now - c.t) / c.s, Math.max(0, c.till - now) / c.s); out.x += c.dx * k; out.y += c.dy * k; }
    }
    out.x = wrapX(out.x);
    return out;
  }
  // It fled: off its hours' place by (dx, dy) until `till` (game seconds)
  spook(id, dx, dy, till) { this.spooked.set(id, { till, dx, dy }); }

  // ---------- looking ----------
  // Every group of the cells round (x, y), fn(g). New cells are worked out at most `fresh` at a time (the rest next time):
  // true, all were there
  around(x, y, fresh, fn, reach = HERD.REACH) {
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    let all = true;
    for (let r = 0; r <= reach; r++) for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
      if (!this.has(cx + i, cy + j)) { if (fresh <= 0) { all = false; continue; } fresh--; }
      for (const g of this.cell(cx + i, cy + j)) fn(g);
    }
    return all;
  }
}
// The id of a member of a group, and back: 'g3.-2.0.4' → { id: 'g3.-2.0', cx, cy, k, i } (null: not one of a herd)
export const memberId = (g, i) => `${g.id}.${i}`;
export function parseId(id) {
  const m = /^(g(-?\d+)\.(-?\d+)\.(\d))\.(\d+)$/.exec(String(id));
  return m && { id: m[1], cx: +m[2], cy: +m[3], k: +m[4], i: +m[5] };
}
