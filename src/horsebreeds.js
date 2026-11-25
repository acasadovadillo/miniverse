// The horses' breeds (Plan R4-3, docs/planes/realismo/PLAN-R4-caballo.md §1.5 and §3.6). Pure: it reads an Animal's fields and
// keeps nothing of its own but a cache.
//
//   Fields of the Animal, all optional (`breed` is its coat, since before): race (RACES, or 'mestizo'; none: an Español, as every
//     horse of before), gene ([speed, stamina, courage], -4..4; none: from its id, see geneOf) and, of a mestizo, mix (the
//     average of its parents: [speed, stamina, courage, kg, slope, graze]). They are fixed at birth.
//   statsOf(a)  what it is like (one object a horse, made again only when those fields change; never write to it):
//     speed   the gallop's, by an Español's; the canter takes half of the difference (canterOf), the trot and the walk none
//     stamina how long the gallop lasts; courage, how easily it takes fright (1.5: half as much again); kg, what the saddlebags
//     weigh for nothing; slope, how much steeper it goes (added to horseride.js's limits); graze, the grass it eats a day;
//     pull, the cart's (R4-5)
//   foalOf(mom, dad, rand)  { race, gene, mix? } of their foal; freshOf(race, rand), of one that is bought
//   barsOf(stats)  the four bars of the card, 0..1
//   buildOf(a), raceKey(a), sizeOf(a)  how it is drawn: { arabe, breton, asturcon } 0..1, its name in the model's key, its size
//   ?razas=0: every horse is an average Español and Rosa sells none; the fields stay
import { apagada } from './opciones.js';

const OFF = apagada('razas');
export const racesOff = () => OFF;
export const RACES = {
  espanol: { speed: 1, stamina: 1, courage: 1, kg: 30, slope: 0, graze: 5, size: 1, price: 3000 },
  arabe: { speed: 1.07, stamina: 1.3, courage: 1.5, kg: 25, slope: 0, graze: 4, size: 0.97, price: 4800 },
  breton: { speed: 0.84, stamina: 0.85, courage: 0.6, kg: 60, slope: 0, graze: 7, size: 1.06, price: 3600 },
  asturcon: { speed: 0.86, stamina: 1.15, courage: 0.8, kg: 20, slope: 0.15, graze: 3, size: 0.86, price: 1800 },
};
export const RACE_IDS = Object.keys(RACES);
const BASE = ['speed', 'stamina', 'courage', 'kg', 'slope', 'graze'];
// (a mestizo's numbers can only lie between those of the breeds: nothing else is believed)
const LIMITS = BASE.map(k => [Math.min(...RACE_IDS.map(r => RACES[r][k])), Math.max(...RACE_IDS.map(r => RACES[r][k]))]);
export const GENE_MAX = 4, GENE_STEP = [0.01, 0.01, 0.025];
const PULL_KG = 45;   // (from here on it pulls a loaded cart at its own pace: the Breton, and half of one)

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), round3 = v => Math.round(v * 1000) / 1000;
function hash(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13; return h >>> 0; }

export const raceOf = a => (a?.race === 'mestizo' && mixOk(a.mix) ? 'mestizo' : RACES[a?.race] ? a.race : 'espanol');
const mixOk = m => Array.isArray(m) && m.length === BASE.length && m.every(Number.isFinite);
// Its own variation. A horse from before the breeds has none written: from its id, always the same, and never for the worse
// (0..4): nobody's horse is slower, sooner tired or more easily scared than it was
export function geneOf(a) {
  const g = a?.gene;
  if (Array.isArray(g) && g.length === 3 && g.every(Number.isFinite)) return g.map(v => clamp(Math.round(v), -GENE_MAX, GENE_MAX));
  const h = hash(a?.id ?? '');
  return [h % 5, (h >>> 8) % 5, (h >>> 16) % 5];
}
// Its breed's six numbers (a mestizo's, its own)
const baseOf = a => { const r = raceOf(a); return r === 'mestizo' ? a.mix.map((v, i) => clamp(v, ...LIMITS[i])) : BASE.map(k => RACES[r][k]); };

const statsFrom = (race, b, g) => {
  const speed = b[0] * (1 + g[0] * GENE_STEP[0]);
  return Object.freeze({ race, speed, canter: canterOf(speed), stamina: b[1] * (1 + g[1] * GENE_STEP[1]), courage: b[2] * (1 - g[2] * GENE_STEP[2]), kg: b[3], slope: b[4], graze: Math.max(1, Math.round(b[5])), pull: b[3] >= PULL_KG ? 1 : 0.85 });
};
// (half of the difference: a draft horse's gallop is 16 % slower, its canter 8 %)
export const canterOf = speed => (1 + speed) / 2;
export const PLAIN = statsFrom('espanol', BASE.map(k => RACES.espanol[k]), [0, 0, 0]);
const CACHE = new WeakMap();
export function statsOf(a) {
  if (!a || OFF) return PLAIN;
  return recOf(a).v;
}
function recOf(a) {
  let c = CACHE.get(a);
  if (c && c.race === a.race && c.gene === a.gene && c.mix === a.mix && c.id === a.id) return c;
  const build = buildNow(a);
  CACHE.set(a, (c = { race: a.race, gene: a.gene, mix: a.mix, id: a.id, v: statsFrom(raceOf(a), baseOf(a), geneOf(a)), build, key: keyOfBuild(a, build), size: sizeOfBuild(build) }));
  return c;
}
// What a breed is like on average (Rosa's list)
export const raceStats = race => statsFrom(race, BASE.map(k => RACES[race][k]), [0, 0, 0]);

const step = rand => Math.floor(rand() * 3) - 1;
// A foal: its parents' breed, or a mestizo with the average of both; its variation, the middle of theirs and one step at most
export function foalOf(mom, dad, rand = Math.random) {
  dad ||= mom;
  const a = raceOf(mom), b = raceOf(dad), ga = geneOf(mom), gb = geneOf(dad);
  const gene = ga.map((v, i) => clamp(Math.round((v + gb[i]) / 2) + step(rand), -GENE_MAX, GENE_MAX));
  if (a === b && a !== 'mestizo') return { race: a, gene };
  const B = baseOf(dad);
  return { race: 'mestizo', gene, mix: baseOf(mom).map((v, i) => round3((v + B[i]) / 2)) };
}
export const freshOf = (race, rand = Math.random) => ({ race: RACES[race] ? race : 'espanol', gene: [0, 1, 2].map(() => Math.floor(rand() * (2 * GENE_MAX + 1)) - GENE_MAX) });

// The card's four bars (0..1), between a little under the least and a little over the most a horse can have
const SPAN = { speed: [0.74, 1.13], stamina: [0.6, 1.36], courage: [1.75, 0.42], strength: [5, 62] };
export const STATS = ['speed', 'stamina', 'courage', 'strength'];
export const barsOf = s => STATS.map(k => { const [a, b] = SPAN[k], v = k === 'strength' ? s.kg : s[k]; return clamp((v - a) / (b - a), 0.04, 1); });
export const SEGMENTS = 10;
export const segOf = v => clamp(Math.round(v * SEGMENTS), 1, SEGMENTS);

// ---------- how it is drawn ----------
// How much of each breed there is in it, 0..1 (what is left of 1 is Español). A mestizo's average says it: its slope is the
// pony's, and its weight and grass, the draft horse's and the Árabe's (three equations; the rounding, put right by eighths)
const NONE = Object.freeze({ arabe: 0, breton: 0, asturcon: 0 });
const ONE = Object.fromEntries(RACE_IDS.map(r => [r, Object.freeze({ ...NONE, ...(r === 'espanol' ? null : { [r]: 1 }) })]));
const eighth = v => clamp(Math.round(v * 8) / 8, 0, 1);
export const buildOf = a => (OFF || !a ? NONE : recOf(a).build);
function buildNow(a) {
  const r = raceOf(a);
  if (r !== 'mestizo') return ONE[r];
  const [, , , kg, slope, graze] = baseOf(a), p = slope / RACES.asturcon.slope, h = (kg - 30 - 5 * (graze - 5)) / 20, f = 2 * h - 2 * p - (graze - 5);
  return { arabe: eighth(f), breton: eighth(h), asturcon: eighth(p) };
}
// (its name in the model's key: '' is an Español, the horse of always)
export const raceKey = a => (OFF || !a?.race ? '' : recOf(a).key);
function keyOfBuild(a, b) {
  const r = raceOf(a), n = v => Math.round(v * 8);
  if (r !== 'mestizo') return r === 'espanol' ? '' : r;
  return b.arabe || b.breton || b.asturcon ? `x${n(b.arabe)}${n(b.breton)}${n(b.asturcon)}` : '';
}
// (and back: the model is made from its key alone)
export function buildOfKey(key) {
  if (!key) return NONE;
  if (ONE[key]) return ONE[key];
  const m = /^x(\d)(\d)(\d)$/.exec(key);
  return m ? { arabe: m[1] / 8, breton: m[2] / 8, asturcon: m[3] / 8 } : NONE;
}
export const sizeOfBuild = b => 1 + b.arabe * (RACES.arabe.size - 1) + b.breton * (RACES.breton.size - 1) + b.asturcon * (RACES.asturcon.size - 1);
export const sizeOf = a => (OFF || !a?.race ? 1 : recOf(a).size);
