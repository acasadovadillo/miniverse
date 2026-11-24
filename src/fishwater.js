// The water a fishing line is in, and what bites there: pure functions, worked out once per cast (never per frame), with no
// state of their own. fishing.js uses them for the player's line; talktopics.js for what Lía says bites now; the test for
// the pace and the income. Everything here is a curve (a pike at noon is rare, not impossible); the only gates are the kind
// of water and the depth of the bed under the bobber.
//
//   waterType(w, x, y)          'mar' | 'rio' | 'lago' | 'estanque' | 'pantano' | 'hielo' | null (land)
//   bedDepth(w, x, y)           metres of water over the bed there
//   structure(w, x, y, type)    0.6-1.6: how good a spot it is (drop-offs, the margin, inlets, cover)
//   waterC(w, x, y, days, ...)  °C of the water there now
//   here(game, x, y)            all of it: the ctx below, or null on land
//   rateOf(f, ctx), rates(ctx)  bites of a species, of all (W0 / rate = mean seconds between bites)
//   waitFor(rate, rnd)          the seconds until the next bite
//   pickFish(ctx, rnd)          which one
//   stockOf, takeFrom           how fished-out the 8 × 8 cell is (chunk delta d.fished)
import { FISH, HARVEST } from './items.js';
import { CHUNK } from './world/gen.js';
import { B, climate } from './world/biomes.js';
import { inBounds, pondDist, POND } from './world/village.js';
import { wrapIndex } from './world/planet.js';

export const W0 = 28;                     // s: the mean wait where the rates add up to 1
export const WAIT = [6, 150];             // s: the shortest and the longest wait
export const SUNRISE = 6.5, SUNSET = 19.5;   // (the sky's own: engine.js updateSky; the same all the year round)
// (each water has its own number of kinds: so that an average spot of any of them gives a bite every 35-50 s)
const WATER_K = { mar: 0.95, rio: 1, lago: 0.85, estanque: 1.35, pantano: 1.9, hielo: 1.5 };
const SEASON_WATER = [12, 21, 15, 6];      // °C of the water in the village's climate, by local season
const TL_REF = 0.52;                       // (the village's large-scale temperature: clothing.js TEMP.tlRef)
const WEATHER_K = { sol: 1, nubes: 1.15, niebla: 1.1, lluvia: 1.25, tormenta: 0.5, nieve: 0.8, ventisca: 0.4 };
const WET = new Set(['lluvia', 'tormenta']);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- the place ----------
export function waterType(w, x, y) {
  // (in a dug hole that has filled, the water it came from: a canal off a river gives river fish; scenes.js floodSrc. If
  // that tile only has water at its edge, river. Also the canal that reaches the village)
  const src = w.floodSrc?.(x, y);
  if (src) return waterType(w, src[0], src[1]) || 'rio';
  if (inBounds(x, y)) return pondDist(x, y) < 0.95 ? 'estanque' : null;
  if (!w.water(x, y)) return null;
  const b = w.gen.biomeAt(x, y);
  if (b === B.OCEAN) return 'mar';
  if (b === B.LAKE) return 'lago';
  if (b === B.ICE) return 'hielo';
  if (b === B.SWAMP) return 'pantano';
  for (let r = 2; r <= 8; r += 3) for (let a = 0; a < 6; a++) if (w.gen.biomeAt(x + Math.cos(a) * r, y + Math.sin(a) * r) === B.OCEAN) return 'mar';
  return 'rio';
}
export function bedDepth(w, x, y) {
  const d = w.waterDepth?.(x, y) || 0;
  return d > 0 ? d : Math.max(0, -w.gen.depthAt(x, y));
}
// Nine samples, the middle and eight 2.5 m round it: fish gather where the bottom drops, along the margin, where two waters
// meet, in a narrow run of river and under cover; not in the shallowest water nor in the open far from all of that
const RING = Array.from({ length: 8 }, (_, i) => [Math.cos(i * Math.PI / 4) * 2.5, Math.sin(i * Math.PI / 4) * 2.5]);
export function structure(w, x, y, type = waterType(w, x, y), depth = bedDepth(w, x, y)) {
  let step = 0, land = 0, other = false, narrow = false;
  const dry = [];
  for (let i = 0; i < 8; i++) {
    const sx = x + RING[i][0], sy = y + RING[i][1], d = w.waterDepth?.(sx, sy) || 0;
    dry.push(!(d > 0));
    if (dry[i]) { land++; continue; }
    step = Math.max(step, Math.abs(d - depth));
    if (!(i & 1) && !other) { const q = waterType(w, sx, sy); other = !!q && q !== type; }
  }
  if (type === 'rio') for (let i = 0; i < 4; i++) if (dry[i] && dry[i + 4]) narrow = true;
  let k = 1, any = false;
  if (step >= 1) { k += 0.3; any = true; }
  if (land && depth >= 0.6) { k += 0.15; any = true; }
  if (other || narrow) { k += 0.3; any = true; }
  if (covered(w, x, y)) { k += 0.2; any = true; }
  if (depth < 0.4) k *= 0.6;
  else if (!any) k *= 0.8;
  return clamp(k, 0.6, 1.6);
}
function covered(w, x, y) {
  for (const o of w.harvestablesNear?.(x, y) || []) if (!o.flower && (o.kind === 'bush' || HARVEST[o.kind]?.tool === 'hacha') && Math.abs(o.x - x) < 2 && Math.abs(o.y - y) < 2 && Math.hypot(o.x - x, o.y - y) < 2) return true;
  for (let i = 0; i < 8; i += 2) if (w.levelAt?.(x + RING[i][0] * 0.6, y + RING[i][1] * 0.6) != null) return true;   // (a jetty or a built floor over it)
  return false;
}
export function waterC(w, x, y, season, type, depth) {
  if (type === 'hielo') return 2;
  let base = SEASON_WATER[season] ?? 12;
  if (type === 'mar') base = 13.5 + (base - 13.5) * 0.6;   // (the sea changes slower)
  let c = base + (climate(x, y, w.gen.seed, CLIM).Tl - TL_REF) * 16;
  if (season === 1) c -= Math.min(4, depth * 0.4);
  else if (season === 3) c += Math.min(3, depth * 0.3);
  return clamp(c, 1, 28);
}
const CLIM = {};

// ---------- the moment ----------
// 0 by night, 1 by day, easing at sunrise and sunset
const dayK = h => clamp((h - SUNRISE) / 1.5 + 0.5, 0, 1) * clamp((SUNSET - h) / 1.5 + 0.5, 0, 1);
const twilight = h => clamp(1 - Math.min(Math.abs(h - SUNRISE), Math.abs(h - SUNSET)) / 1.5, 0, 1);
export function activity(h, night = false, season = 0) {
  const d = dayK(h);
  if (night) return 1.3 - 0.8 * d;
  let k = 0.5 + 0.5 * d;
  if (season === 1 && h >= 12 && h < 16) k = 0.75;
  return k + (1.5 - k) * twilight(h);
}
export const weatherK = w => WEATHER_K[w] ?? 1;
const inHours = (hours, h) => (hours[0] < hours[1] ? h >= hours[0] && h < hours[1] : h >= hours[0] || h < hours[1]);
// How the moment suits a species (1: as usual; the light, its hours, its season, rain if it likes it, the water's °C)
export function momentK(f, c) {
  let k = activity(c.hour, !!f.night, c.season);
  if (f.hours && inHours(f.hours, c.hour)) k *= 1.4;
  if (f.seasons) k *= f.seasons.includes(c.season) ? f.run || 1 : 0.15;
  if (f.weather === 'lluvia') k *= WET.has(c.weather) ? 1.6 : 0.6;
  if (f.temp && Number.isFinite(c.tempC)) k *= tempK(f.temp, c.tempC);
  return k;
}
export const tempK = (temp, c) => { const off = c < temp[0] ? temp[0] - c : c > temp[1] ? c - temp[1] : 0; return Math.max(0.1, 1 - off * 0.18); };
// (the bed: whole inside its depths, down to nothing 0.3 m short of them, half as deep in the shallows, or 1 m past)
export const depthK = (depth, d) => (!depth ? 1 : d < depth[0] ? clamp(1 - (depth[0] - d) / Math.min(0.3, depth[0] / 2), 0, 1) : d > depth[1] ? clamp(1 - (d - depth[1]), 0, 1) : 1);

// ---------- what bites ----------
// ctx: { water, depth, tempC, hour, season, weather, k } (k: the spot, the stock, the rod, the weather)
export function rateOf(f, c) {
  if (f.rare || !f.water.includes(c.water)) return 0;
  return (f.base || 0) * depthK(f.depth, c.depth) * momentK(f, c);
}
export function rates(c) {
  let sum = 0;
  for (const id in FISH) sum += rateOf(FISH[id], c);
  const r = sum * (WATER_K[c.water] ?? 1) * (c.k ?? 1);
  return r > 1 ? r ** 0.7 : r;   // (everything at its best at once is not four times as good)
}
// (the mean of two draws: the same mean as one, but fewer waits of minutes and fewer at once)
export function waitFor(rate, rnd = Math.random) {
  if (!(rate > 0)) return Infinity;
  const u = -Math.log(1 - rnd()) - Math.log(1 - rnd());
  return clamp((W0 / rate) * u / 2, WAIT[0], WAIT[1]);
}
// null where nothing lives (a puddle)
export function pickFish(c, rnd = Math.random) {
  let sum = 0, last = null;
  for (const id in FISH) sum += rateOf(FISH[id], c);
  if (!(sum > 0)) return null;
  let r = rnd() * sum;
  for (const id in FISH) {
    const v = rateOf(FISH[id], c);
    if (!(v > 0)) continue;
    last = id;
    if ((r -= v) <= 0) return id;
  }
  return last;
}
// The length (cm) of one: u = rnd^(2 − 0.05 × level); a bare hook brings the small ones; 1 in 200 is past the range
export function sizeOf(f, level = 0, bare = false, rnd = Math.random) {
  if (!bare && rnd() < 0.005) return { cm: f.cm[1] * (1 + 0.15 * rnd()), trophy: true };
  const u = rnd() ** (bare ? 2.6 : 2 - 0.05 * Math.min(10, level));
  return { cm: f.cm[0] + (f.cm[1] - f.cm[0]) * u, trophy: u >= 0.9 };
}
export const kgOf = (f, cm) => (f.k || 12) * (cm / 100) ** 3;

// ---------- the spots ----------
export const STOCK = { estanque: 5, pantano: 8, rio: 10, lago: 12, mar: 20, hielo: 8 };   // (catches a cell holds)
export const REFILL = 0.3;                 // of it that comes back each real day
const CELL = 8;
// The cell of a point: [chunk x, chunk y, its key in d.fished]. The village pond, small, is a single one
export function cellOf(x, y, type) {
  if (type === 'estanque' && inBounds(x, y)) { x = POND.x; y = POND.y; }
  const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
  return [cx, cy, Math.floor((x - cx * CHUNK) / CELL) + 2 * Math.floor((y - cy * CHUNK) / CELL)];
}
const left = (e, S, day) => (Array.isArray(e) && Number.isFinite(e[0]) && e[1] > 0 ? Math.max(0, e[1] - REFILL * S * Math.max(0, day - e[0])) : 0);
export function caughtAt(w, x, y, type, day) {
  const [cx, cy, i] = cellOf(x, y, type);
  return left(w.delta(cx, cy)?.fished?.[i], STOCK[type] || 10, day);
}
export const stockK = (n, type) => Math.max(0.25, 1 - n / (STOCK[type] || 10));
// n more taken from there (1 a fish kept, less one let go). First come, as the shells of the sea bed (dive.js): written by
// whoever fishes and sent as any change of the chunk; cells that are full again are dropped
export function takeFrom(w, x, y, type, day, n) {
  const [cx, cy, i] = cellOf(x, y, type), d = w.delta(cx, cy, true), m = (d.fished ||= {});
  const was = left(m[i], STOCK[type] || 10, day);
  for (const k of Object.keys(m)) if (+k !== i && !(left(m[k], 20, day) > 0)) delete m[k];
  m[i] = [day, Math.round((was + n) * 100) / 100];
  w.note(wrapIndex(cx, CHUNK), cy);
}

// All of it at a point of the world, for whoever is there now (local hour, season and weather: time.js), or null on land.
// rod: the rod's own factor
export function here(g, x, y, rod = 1) {
  const w = g.world, T = g.days, water = waterType(w, x, y);
  if (!water) return null;
  const depth = bedDepth(w, x, y), season = T.localSeason, hour = T.localHour, weather = T.weatherHere;
  const c = { x, y, water, depth, tempC: waterC(w, x, y, season, water, depth), hour, season, weather, spot: structure(w, x, y, water, depth), stock: stockK(caughtAt(w, x, y, water, T.realDay), water) };
  c.k = c.spot * c.stock * rod * skyK(c, hour >= 15 && T.weatherFor(T.dayIndex + 1) === 'tormenta');
  return c;
}
// The sky over all of them: the weather, the pressure falling on the evening before a storm, the glare of a summer noon
export const skyK = (c, eve) => weatherK(c.weather) * (eve && c.weather !== 'tormenta' ? 1.3 : 1) * (c.weather === 'sol' && c.season === 1 && c.hour >= 12 && c.hour < 16 ? 0.8 : 1);
