// What the soil holds and what feeds it: fertility, families (rotation), manure, compost, fodder and bees. Pure data and pure
// functions (imports only cropdata.js and biomes.js): farm.js, ranch.js, the world's content (scenes.js) and the tests read
// it. Design: docs/planes/realismo/PLAN-R2-huerto.md §3.4 and §3.8 (the numbers to tune after playing are here). What a chunk
// keeps, all of it decided in the game that runs the world and synced tile by tile like the rest of the chunk:
//   d.soil[k]     [fertility 0..100, family of the last crop sown, how many of that family in a row]. Missing: the one its
//                 biome has (soilStart): nothing is written until something takes from it or gives to it
//   d.manure[k]   the pile of an animal house (k: the house's tile), in heaps and quarters of one
//   d.compost[k]  a compost bin: [units, the day it was filled, 1 once ready (the morning of whoever runs the world)]
//   d.feed[k], d.fodder[k]   a trough: its rations and what was last put in it (what is seen in it)
import { GROW } from './cropdata.js';
import { B } from './world/biomes.js';

export const SOIL_MAX = 100;
export const SOIL_START = { [B.MEADOW]: 60, [B.FOREST]: 70, [B.PINES]: 45, [B.SWAMP]: 65 }, SOIL_ELSE = 60;
export const soilStart = biome => SOIL_START[biome] ?? SOIL_ELSE;
// poor below POOR, tired below TIRED (or only thin, where the place was born so), rich above RICH
export const SOIL = { poor: 20, tired: 50, rich: 70, rest: 1 };   // (rest: what bare or resting soil gets back a day, up to its biome's)
export const FOOD = { manure: 25, abono: 20 };                    // what each gives to a tile
export const OLD_FERT = 20, OLD_FERT_RATE = 1.5;                  // a crop fertilised before the soil counted: what its soil gets, and its speed until it is harvested
export const PICK_SHARE = 1 / 3;                                  // what a later pick of a plant that gives again takes (the first one, all of it)
export const FAMILY_TIRED = 3, TIRED_HEALTH = 0.1;                // the third crop of a family in a row: less health
export const RICH_MORE = 0.25;                                    // chance of one more from rich soil
export const BEES = { R: 12, more: 0.5 };                         // a hive this near: chance of one more, of what insects pollinate

// How a crop grows with this fertility (1: as always)
export function fertAt(f) {
  return f < SOIL.poor ? 0.7 : f < SOIL.tired ? 0.85 + 0.15 * (f - SOIL.poor) / (SOIL.tired - SOIL.poor) : f <= SOIL.rich ? 1 : 1.15;
}
// What a harvest of this crop takes from the soil (again: a later pick of a plant that gives more)
export const takesFrom = (id, again) => Math.round((GROW[id]?.feeds || 0) * (again ? PICK_SHARE : 1));
export const clampSoil = f => Math.max(0, Math.min(SOIL_MAX, Math.round(f)));
// The word for it: 'poor' | 'tired' | 'thin' | 'fertile' | 'rich' (start: its biome's)
export const soilWord = (f, start = SOIL_ELSE) => (f < SOIL.poor ? 'poor' : f < SOIL.tired ? (f < start ? 'tired' : 'thin') : f <= SOIL.rich ? 'fertile' : 'rich');
// Its look on the tilled tile (three/models.js tilled): 0 ordinary, 1 rich (dark, crumbly), 2 poor (stony)
export const soilTone = f => (f > SOIL.rich ? 1 : f < SOIL.poor ? 2 : 0);

// ---------- manure ----------
// What each animal that lives in a house and has eaten leaves in it every morning; what a house's pile holds at most
export const DUNG = { vaca: 1, caballo: 1, cerdo: 1, oveja: 0.5, cabra: 0.5, gallina: 0.25, pato: 0.25, conejo: 0.25 };
export const PILE_MAX = 12, DIRTY_EVERY = 2;   // (a full one: its animals lose a little love every second morning)
export const heapSize = n => (n >= 10 ? 3 : n >= 5 ? 2 : n >= 1 ? 1 : 0);
// Where the pile of each house is: from its middle, to its right and to its front (m)
export const HEAP_AT = { establo: [-1.42, 1.98], gallinero: [-0.86, 1.5], cuadra: [-0.95, 0.12], conejera: [-0.9, 0.06] };

// ---------- compost ----------
export const COMPOST = { need: 10, days: 7, gives: 4 };
// What goes in the bin, and how much each counts (any crop, fruit and herb besides)
const ORGANIC = { fibra: 1, straw: 1, heno: 1, manure: 2, seaweed: 1, manzana: 1, bayas: 1, coco: 1, pulpa: 1, bellota: 1, pina: 1 };
export const organic = id => (id && (GROW[id] ? 1 : ORGANIC[id])) || 0;
// The state of a bin: { units, left (days to go), ready }
export function compostAt(v, today) {
  const units = v?.[0] || 0, full = units >= COMPOST.need;
  const left = full ? Math.max(0, COMPOST.days - (today - v[1])) : 0;
  return { units, full, left, ready: full && (!!v[2] || left <= 0) };
}
// Its model: 0 empty, 1 and 2 filling, 3 full and rotting, 4 ready
export const compostModel = v => { const n = v?.[0] || 0; return `compost_bin:${v?.[2] ? 4 : n >= COMPOST.need ? 3 : n >= 5 ? 2 : n ? 1 : 0}`; };

// ---------- fodder ----------
// What a trough takes and the rations of each. Hay, fiber and wheat go in from the bag; what is also food, only from the hand
export const FEED = { heno: 1, fibra: 1, trigo: 1, nabo: 2, zanahoria: 1, maiz: 2, calabaza: 4, cabbage: 2 };
export const FEED_BAG = ['heno', 'fibra', 'trigo'], FEED_MOST = 10;   // (items put in at a time)
export const fodderKind = id => (id === 'trigo' || id === 'maiz' ? 'g' : id === 'heno' || id === 'fibra' || !id ? 'h' : 'r');   // grain, hay or roots
// Its model: how full and of what
export const feedModel = (n, id) => (n >= 1 ? `comedero:${n >= 8 ? 2 : 1}:${fodderKind(id)}` : 'comedero:0');
