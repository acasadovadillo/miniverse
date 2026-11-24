// The nature book (docs/planes/gta/PLAN-G-caza.md §4 and §6): every animal, fish, insect and plant the player has
// studied, with three levels (1 Seen, 2 Studied, 3 Known), a drawing (src/three/plates.js) and facts read from the game's
// own tables. A system (game.nature), made after collection (its backfill reads Collections). Private to each player,
// like Collections: nothing travels.
//
// Phase G-1: 55 species (animals, fish, insects, plants). The 4 sea-life pages (seaweed, seashell, mussel, oyster) come
// in G-2, with the 'sea' group. With ?naturebook=0 nothing here runs and the save's `nature` is carried through untouched.
//
// How a page fills (§4.2): looking at a species for 1.5 s (a ring at the cursor while it fills, only for wild things
// outside the village) gives Seen; 6 s of looking in all (twice as fast while it grazes, flees, swims or lies; plants:
// or seen in two seasons), owning one (farm animals and pets) or studying its tracks gives Studied; hunting, picking,
// felling, harvesting, collecting its product or petting it on 5 days gives Known. Fish and insects are only met when
// caught: the first catch gives Studied, 5 fish (3 insects) Known.
//
// Contract (Plan G §12; other tracks rely on these names):
//   nature.level(id) → 0..3            nature.knowsTracks(id) → bool (its tracks can be named: tracks.label.<id>)
//   nature.saw(id, secs, busy)         looking at one for secs (busy: seen doing something, grazing, fleeing, lying:
//                                      it counts double). Called by the book's own study ray; other tracks need not.
//   nature.harvested(id, n = 1, quiet) hunted, picked, felled, caught, netted, milked… (the "Known" hooks: GW calls it
//                                      from hunt.reward, killed and bledOut; GN from fishing, gather, farm, ranch).
//                                      quiet: another toast already said it (Collections' "new" wins), no message here
//   nature.petted(id)                  a farm animal or pet petted (once a day per animal, ranch.js): 5 give Known
//   nature.learnTracks(id)             E on a print of that species (tracks.js, GP): Studied, quietly (GP floats its own)
//   nature.study → { id, k, done } | null   the study ring for the HUD (fieldhud.js reads it): k 0..1 while a level-0
//                                      wild species is under the cursor; done true for 0.3 s after it fills (the flash).
//                                      One object, reused: read it, never keep it
//   nature.count() → { n, total, byGroup: { animal: [n, total], … } }   (cached: never change what it returns)
//   nature.facts(id) → [[key, params]]  the facts unlocked so far, in page order (from SPECIES[id].facts)
//   SPECIES[id] → { group, model() → THREE.Object3D | null, view: [x, y, z], facts(g) → [[key, params, level]],
//                   how (the "how to find it" key), tracks? (the print kind) }
//   GROUPS (the list order), SPECIES_IDS, REWARDS (Decision 3a: [species, coins, item, count])
//   Texts: nature.name.<id> (es with .g for noun()), nature.note.<id>, nature.group.<group>, nature.level.<1..3>.
import * as THREE from 'three';
import { apagada } from './opciones.js';
import { FISH, BUGS, CROPS, HARVEST, ITEMS, itemNoun } from './items.js';
import { seedOf } from './cropdata.js';
import { ANIMALS } from './art/farm.js';
import { PREY, bodyBox } from './hunt.js';
import * as WILD from './wildlife.js';
import * as TRACKS from './tracks.js';
import { B } from './world/biomes.js';
import { inBounds } from './world/village.js';
import { rayHits } from './world/fit.js';
import { broadDims, pineDims, palmDims, cactusK } from './world/treedims.js';
import { hud } from './ui/hud.js';
import { Audio } from './audio.js';
import { t, noun, formatMessage } from './i18n.js';
import { animalModel } from './three/animals.js';
import { foodModel } from './three/food3d.js';
import { buildNatureChunk } from './three/nature3d.js';
import { getModel, modelMat } from './three/models.js';

export const GROUPS = ['animal', 'fish', 'bug', 'plant'];

// [id, group, track kind (tracks.js PRINT_OF) or null]. The ids are the game's own: wild and farm types (wildlife.js,
// art/farm.js ANIMALS), FISH and BUGS keys (items.js), gen object kinds (gen.js) and CROPS ids
const LIST = [
  ['ciervo', 'animal', 'deer'], ['jabali', 'animal', 'boar'], ['cisne', 'animal', null], ['gallina', 'animal', null],
  ['pato', 'animal', null], ['vaca', 'animal', null], ['oveja', 'animal', null], ['cabra', 'animal', null],
  ['cerdo', 'animal', null], ['conejo', 'animal', null], ['caballo', 'animal', null], ['perro', 'animal', null],
  ['gato', 'animal', null],
  ...['carpa', 'perca', 'trucha', 'salmon', 'lucio', 'anguila', 'sardina', 'lubina', 'pez_globo', 'cangrejo', 'pez_hielo',
    'siluro', 'pulpo', 'atun', 'esturion', 'pez_dorado'].map(id => [id, 'fish', null]),
  ...['mariposa', 'mariquita', 'saltamontes', 'libelula', 'luciernaga', 'escarabajo', 'grillo', 'polilla'].map(id => [id, 'bug', null]),
  ...['oak', 'fruit', 'pine', 'snowPine', 'swampTree', 'palm', 'cactus', 'bush', 'deadBush', 'margarita', 'diente_leon',
    'nabo', 'fresa', 'zanahoria', 'tomate', 'maiz', 'trigo', 'calabaza'].map(id => [id, 'plant', null]),
];
export const SPECIES_IDS = LIST.map(([id]) => id);
// Decision 3a: 15 species → 500 coins and 2 apple seeds; 35 → 1500 and 2 potions; all → 5000 and a display cabinet
// (with its plan, as Collections gives furniture)
export const REWARDS = [[15, 500, 'semilla_manzano', 2], [35, 1500, 'pocion', 2], [SPECIES_IDS.length, 5000, 'vitrina', 1]];

// ---------- the facts ----------
const WILD_IDS = new Set(['ciervo', 'jabali', 'cisne']);
const FARM_IDS = new Set(['gallina', 'pato', 'vaca', 'oveja', 'cabra', 'cerdo', 'conejo', 'caballo', 'perro', 'gato']);
const TREE_IDS = new Set(['oak', 'fruit', 'pine', 'snowPine', 'swampTree', 'palm', 'cactus']);
const FLOWER_IDS = new Set(['margarita', 'diente_leon']);
// (the wild kinds live in wildlife.js, which exports KINDS, GRAZE and CREEP; this copy is only a fallback)
const WILD_COPY = {
  ciervo: { biomes: [B.FOREST, B.PINES, B.MEADOW], hours: [6, 20], fear: 7 },
  jabali: { biomes: [B.FOREST, B.PINES], hours: [5, 23], fear: 4.5 },
  cisne: { water: true, biomes: [B.LAKE], hours: [6, 21], fear: 4 },
};
const wildKind = id => WILD.KINDS?.[id] ?? WILD_COPY[id];
const creep = () => WILD.CREEP ?? 0.3;
const grazes = id => !!(WILD.GRAZE ?? { ciervo: 1 })[id];
// (the farm animals that graze the grass: ranch.js, its journal note)
const FARM_GRAZERS = new Set(['vaca', 'oveja', 'cabra', 'conejo', 'caballo']);
// The stride of each print kind, walking and running (m): tracks.js STRIDE when it exports it, else the plan's numbers
const STRIDE_COPY = { deer: [0.9, 1.6], boar: [0.6, 1.1] };
function strideOf(kind) {
  const s = TRACKS.STRIDE?.[kind] ?? TRACKS.STRIDE?.[TRACKS.SPECIES_OF?.[kind]];   // (tracks.js keys it by species id)
  if (Array.isArray(s)) return s;
  if (s && typeof s === 'object') return [s.walk ?? s[0], s.flee ?? s[1]];
  return STRIDE_COPY[kind];
}
// Where each plant grows: a mirror of gen.js (the tree and shrub rolls of WorldGen.objects). If gen changes where something
// grows, change it here too
const PLANT_BIOMES = {
  oak: [B.MEADOW, B.FOREST], fruit: [B.MEADOW, B.FOREST], pine: [B.MEADOW, B.FOREST, B.PINES, B.ROCKY], snowPine: [B.SNOW],
  swampTree: [B.SWAMP], palm: [B.BEACH], cactus: [B.DESERT], bush: [B.MEADOW, B.FOREST, B.PINES, B.SWAMP], deadBush: [B.DESERT],
  margarita: [B.MEADOW, B.FOREST], diente_leon: [B.MEADOW, B.FOREST],
};
const FLOWER_SEASONS = [0, 1, 2];   // (gen.js flowerShows: none in winter)

const biomeNames = list => list.map(b => t('nature.biome.' + b));
const seasonNames = list => list.map(s => t('nature.season.' + s));
const lower = id => formatMessage('{x, lower}', { x: itemNoun(id) });
const givesOf = ids => { const u = [...new Set(ids.filter(id => ITEMS[id]))]; return u.length ? [['nature.fact.gives', { list: u.map(lower) }, 3]] : []; };
const hoursFact = (h, lvl) => (h && !(h[0] === 0 && h[1] === 24) ? [['nature.fact.hours', { a: h[0], b: h[1] }, lvl]] : []);

function animalFacts(id, g) {
  const out = [];
  if (WILD_IDS.has(id)) {
    const k = wildKind(id);
    if (k) {
      out.push(['nature.fact.habitat', { list: biomeNames(k.biomes) }, 1], ...hoursFact(k.hours, 2));
      out.push(['nature.fact.shy', { m: k.fear, c: Math.round(k.fear * creep() * 10) / 10 }, 2]);
    }
    if (grazes(id)) out.push(['nature.fact.grazes', null, 2]);
    const kind = SPECIES[id].tracks;
    if (kind) {
      const [a, b] = strideOf(kind) || [];
      out.push(['nature.fact.tracks', { kind }, 'tracks']);
      if (a) out.push(['nature.fact.stride', { a, b }, 'tracks']);
    }
    return [...out, ...givesOf((PREY[id]?.drops || []).map(d => d[0]))];
  }
  const A = ANIMALS[id] || {};
  if (FARM_GRAZERS.has(id)) out.push(['nature.fact.grazes', null, 2]);
  return [...out, ...givesOf([A.product, A.also?.[0], A.special].filter(Boolean))];
}
function fishFacts(id, g) {
  const f = FISH[id], rec = g?.fishing?.records?.[id];
  const out = [['nature.fact.waters', { list: f.water.map(w => t('nature.water.' + w)) }, 2]];
  if (f.seasons) out.push(['nature.fact.seasons', { list: seasonNames(f.seasons) }, 2]);
  out.push(...hoursFact(f.hours, 2));
  if (f.weather === 'lluvia') out.push(['nature.fact.rain', null, 2]);
  out.push(rec ? ['nature.fact.size', { a: f.cm[0], b: f.cm[1], r: rec }, 3] : ['nature.fact.size_none', { a: f.cm[0], b: f.cm[1] }, 3]);
  return out;
}
function bugFacts(id) {
  const b = BUGS[id], out = [['nature.fact.seasons', { list: seasonNames(b.seasons) }, 2]];
  if (b.water) out.push(['nature.fact.near_water', null, 2]);
  if (b.forest) out.push(['nature.fact.in_forest', null, 2]);
  return [...out, ...hoursFact(b.hours, 3)];
}
function plantFacts(id) {
  const c = CROPS[id];
  if (c) {
    const out = [['nature.fact.crop_seasons', { list: seasonNames(c.seasons) }, 1], ['nature.fact.grows', { days: c.days }, 2]];   // (the village's best season and its days in good weather: what it really does is the field's, farm.js)
    if (c.regrow) out.push(['nature.fact.regrows', { days: c.regrow }, 2]);
    return [...out, ...givesOf([id, seedOf(id)])];
  }
  const out = [['nature.fact.habitat', { list: biomeNames(PLANT_BIOMES[id] || []) }, 1]];
  if (FLOWER_IDS.has(id)) out.push(['nature.fact.seasons', { list: seasonNames(FLOWER_SEASONS) }, 2]);
  return [...out, ...givesOf((HARVEST[id]?.drops || []).map(d => d[0]))];
}

// ---------- the models (for the plates: three/plates.js draws them once and lets them go) ----------
// Each call makes a new object. What only it owns and must be freed after drawing is listed in userData.made (geometries
// made here; the plates also free the InstancedMeshes of the nature pieces). Shared geometries and materials stay
const PLANT_SEASON = { snowPine: 3, margarita: 0, diente_leon: 0 };
function plantModel(id) {
  if (CROPS[id]) {
    const m = getModel(`crop:${id}:3`);   // (ready to harvest: farm.js stage 3)
    if (!m) return null;
    const g = new THREE.Group(), made = [];
    for (const [key, Bld] of m.parts) if (!Bld.empty) { const mesh = Bld.mesh(modelMat(key), { cast: false, receive: false }); made.push(mesh.geometry); g.add(mesh); }
    for (const e of m.extras) g.add(e.clone());
    g.userData.made = made;
    return g;
  }
  // (one object of gen, at a fixed spot: a grown tree of medium age, its leaves without the per-spot tint)
  const o = { kind: id, x: 0.5, y: 0.5, key: 'plate:' + id, age: 1, neutral: true };
  return buildNatureChunk([o], PLANT_SEASON[id] ?? 1, () => 0, false).group;
}
function modelOf(id, group) {
  if (group === 'animal') return animalModel(id);   // (its first coat or breed: the deer's default coat, a chestnut horse)
  if (group === 'fish') return foodModel(id);
  if (group === 'plant') return plantModel(id);
  return null;   // (insects have no 3D model: the plate pins their pixel icon)
}
// From where the camera looks (the models face +z: from −x the head is on the right of the plate)
const VIEW = { animal: [-1, 0.32, 0.5], fish: [-1, 0.2, 0.06], tree: [-1, 0.22, 0.55], low: [-1, 0.6, 0.8], bug: [0, 0, 1] };
const VIEW_OF = { cisne: [-1, 0.45, 0.6], cangrejo: [-0.5, 1.4, 0.8], pulpo: [-1, 0.7, 0.6], pez_globo: [-1, 0.3, 0.3] };
const HOW = { animal: 'nature.how.look', fish: 'nature.how.catch', bug: 'nature.how.net', plant: 'nature.how.look' };

export const SPECIES = Object.fromEntries(LIST.map(([id, group, tracks]) => {
  const facts = group === 'animal' ? g => animalFacts(id, g) : group === 'fish' ? g => fishFacts(id, g) : group === 'bug' ? () => bugFacts(id) : () => plantFacts(id);
  const view = VIEW_OF[id] || (group === 'plant' ? VIEW[TREE_IDS.has(id) ? 'tree' : 'low'] : VIEW[group]);
  return [id, { group, model: () => modelOf(id, group), view, facts, how: HOW[group], ...(tracks ? { tracks } : {}) }];
}));

// ---------- the book ----------
const LOOK = 1.5, STUDY = 6, FISH_KNOWN = 5, BUG_KNOWN = 3, PET_KNOWN = 5;
const TOAST_GAP = 20, FLOAT_GAP = 10, TICK = 0.1, SLOW = 5, LOST = 0.3, FLASH = 0.3;
const R_ANIMAL = 30, R_PLANT = 12, R_CROP = 6;
// (village species reach Seen quietly: a new game has them all in sight from the first second)
const SILENT = new Set([...FARM_IDS, ...Object.keys(CROPS), ...FLOWER_IDS]);
const WINDOWS = ['s-inv', 's-craft', 's-chest'];
const TRUNK_R = 0.4, LOW_TOP = 1.4, FLOWER_TOP = 0.5;
const today = () => Math.floor(Date.now() / 86400000);
const int = (v, lo, hi) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, Math.round(+v))) : lo);
// How tall a tree is drawn, where its crown starts and how wide it is (world/treedims.js, the sizes nature3d draws): the
// ray hits its trunk below and its crown above, so what is seen over or under a crown is not taken for the tree
const TREE = { top: 0, crown: 0, r: 0 };
function treeShape(o) {
  const T = TREE, k = o.kind;
  if (k === 'pine' || k === 'snowPine') { const d = pineDims(o); T.top = d.H; T.crown = d.th; T.r = Math.min(0.9, d.k); }
  else if (k === 'palm') { const d = palmDims(o); T.top = d.H + 0.4; T.crown = d.H - 0.9; T.r = 0.9; }
  else if (k === 'cactus') { T.top = 2.3 * cactusK(o); T.crown = 0; T.r = 0.45; }
  else { const d = broadDims(o, 0); T.top = d.H; T.crown = d.cy - d.Ry; T.r = 0.9; }
  return T;
}
// Old saves: what they already had fills the book quietly (§6): [what, species, level]
const SEEN_ITEMS = [['carne_venado', 'ciervo', 3], ['carne_jabali', 'jabali', 3], ['bellota', 'oak', 1], ['pina', 'pine', 1], ['manzana', 'fruit', 1], ['coco', 'palm', 1]];

export class NatureBook {
  constructor(game) {
    this.game = game;
    this.off = apagada('naturebook');
    this.study = null;
    this.ring = { id: null, k: 0, done: false };   // (the one object study points to)
    this.clear();
  }
  clear() {
    this.s = new Map();          // id → [level, lookSecs, harvests, firstRealDay, seasons (plants: a bit per season seen)]
    this.tr = new Set();         // species whose tracks can be named
    this.paid = 0;
    this.extra = {}; this.extraTr = [];   // (what a newer version wrote that this one does not know: kept for its save)
    this.raw = null;
    this.study = null; this.cur = null; this.k = 0; this.lostT = 0; this.doneT = 0;
    this.clock = 0; this.tick = 0; this.slow = 0; this.lastToast = -Infinity; this.lastFloat = -Infinity; this.pend = [];
    this.cnt = null;
    this.hit = { id: null, t: 0, x: 0, y: 0, busy: false };
  }
  reset(save) {
    this.clear();
    if (this.off) { this.raw = save.nature ?? null; return; }   // (?naturebook=0: the save's book as it came)
    const N = save.nature;
    if (N && typeof N === 'object' && N.s && typeof N.s === 'object') {
      for (const [id, e] of Object.entries(N.s)) {
        if (!Array.isArray(e)) continue;
        const row = [int(e[0], 0, 3), Math.max(0, Number.isFinite(+e[1]) ? +e[1] : 0), int(e[2], 0, 1e6), int(e[3], 0, 1e7), int(e[4], 0, 15)];
        if (SPECIES[id]) this.s.set(id, row); else this.extra[id] = e;
      }
      for (const id of Array.isArray(N.tr) ? N.tr : []) if (typeof id === 'string') { if (SPECIES[id]?.tracks) this.tr.add(id); else if (!SPECIES[id]) this.extraTr.push(id); }
      this.paid = int(N.paid, 0, REWARDS.length);
    } else this.backfill();
    this.cnt = null;
  }
  save(out) {
    if (this.off) { if (this.raw) out.nature = this.raw; return; }
    const s = { ...this.extra };
    for (const [id, e] of this.s) s[id] = [e[0], Math.round(e[1]), e[2], e[3], ...(e[4] ? [e[4]] : [])];
    out.nature = { v: 1, s, tr: [...this.tr, ...this.extraTr], paid: this.paid };
  }
  // An old save (no `nature` yet): what it already has, as levels, without a word
  backfill() {
    const g = this.game, day = today(), set = (id, lvl) => { if (SPECIES[id] && this.level(id) < lvl) { const e = this.entry(id); e[0] = lvl; e[3] ||= day; } };
    for (const id of g.collection?.got || []) set(id, 2);   // (fish, insects and flowers collected)
    for (const id of Object.keys(g.fishing?.records || {})) set(id, 2);
    for (const a of g.ranch?.animals || []) if (FARM_IDS.has(a.type) && g.ranch.mine(a.type).length) set(a.type, 2);
    const seen = g.craft?.seen;
    if (seen) {
      for (const [item, id, lvl] of SEEN_ITEMS) if (seen.has(item)) set(id, lvl);
      for (const id of Object.keys(CROPS)) if (seen.has(id)) set(id, 3);
    }
  }

  entry(id) {
    let e = this.s.get(id);
    if (!e) { e = [0, 0, 0, 0, 0]; this.s.set(id, e); }
    return e;
  }
  level(id) { return this.s.get(id)?.[0] || 0; }
  knowsTracks(id) { return this.tr.has(id); }
  count() {
    if (this.cnt) return this.cnt;
    const byGroup = Object.fromEntries(GROUPS.map(gr => [gr, [0, 0]]));
    let n = 0;
    for (const [id, gr] of LIST) { byGroup[gr][1]++; if (this.level(id) > 0) { byGroup[gr][0]++; n++; } }
    return (this.cnt = { n, total: SPECIES_IDS.length, byGroup });
  }
  // The facts of a page unlocked so far, in order: [[key, params]] (the tracks drawing and stride once its tracks are known
  // or it is Studied)
  facts(id) {
    const sp = SPECIES[id], lvl = this.level(id);
    if (!sp || !lvl) return [];
    let list;
    try { list = sp.facts(this.game); } catch (e) { console.warn('Nature book: facts of', id, e); return []; }
    return list.filter(([, , need]) => (need === 'tracks' ? lvl >= 2 || this.knowsTracks(id) : lvl >= need)).map(([k, p]) => [k, p]);
  }

  // ---------- levels ----------
  // Up to lvl (never down). Messages: a new wild species toasts (merged, one per 20 s); a later level floats quietly (one
  // per 10 s). quiet: say nothing (another message said it, or the backfill); silent: a village species, Seen quietly
  promote(id, lvl, quiet = false, silent = SILENT.has(id)) {
    const e = this.entry(id), was = e[0];
    if (lvl <= was) return false;
    e[0] = lvl;
    if (!e[3]) e[3] = today();
    this.cnt = null;
    if (quiet || !this.game.player) return true;
    if (was === 0) {
      if (silent) return true;
      this.game.skills?.gain('tracking', 1);
      this.pend.push(id); this.flush();
    } else if (this.clock - this.lastFloat >= FLOAT_GAP) {
      this.lastFloat = this.clock;
      this.game.gather?.float(t('nature.more', { name: noun('nature.name', id) }), '#d8c89a');
    }
    return true;
  }
  flush() {
    if (!this.pend.length || this.clock - this.lastToast < TOAST_GAP) return;
    const [first] = this.pend, more = this.pend.length - 1, name = noun('nature.name', first);
    this.pend.length = 0; this.lastToast = this.clock;
    hud.toast(more ? t('nature.new_more', { name, n: more }) : t('nature.new', { name }), 'good');
    pageTurn();
  }
  // Looking at one for secs (busy: doing something, counts double). The ring (level 0) is the study ray's; this adds the
  // time: 1.5 s gives Seen, 6 s in all Studied (not for farm animals and pets: owning one; not for fish and insects)
  saw(id, secs, busy = false, silent) {
    if (this.off || !SPECIES[id]) return;
    const e = this.entry(id), sp = SPECIES[id];
    if (sp.group === 'fish' || sp.group === 'bug') return;
    e[1] += secs * (busy ? 2 : 1);
    if (sp.group === 'plant') e[4] |= 1 << (this.game.days?.season ?? 0);
    if (e[0] === 0 && e[1] >= LOOK) this.promote(id, 1, false, silent ?? SILENT.has(id));
    const twoSeasons = sp.group === 'plant' && (e[4] & (e[4] - 1)) !== 0;
    if (e[0] === 1 && !FARM_IDS.has(id) && (e[1] >= STUDY || twoSeasons)) this.promote(id, 2);
  }
  // Hunted, picked, felled, harvested, caught, netted, a product collected… Fish: the first catch Studied, 5 Known; insects:
  // the first Studied, 3 Known; anything else Known at once (the drawing comes with it)
  harvested(id, n = 1, quiet = false) {
    if (this.off || !SPECIES[id]) return;
    const e = this.entry(id), gr = SPECIES[id].group;
    e[2] += Math.max(1, n | 0);
    const lvl = gr === 'fish' ? (e[2] >= FISH_KNOWN ? 3 : 2) : gr === 'bug' ? (e[2] >= BUG_KNOWN ? 3 : 2) : 3;
    this.promote(id, lvl, quiet);
  }
  petted(id) {
    if (this.off || !FARM_IDS.has(id)) return;
    const e = this.entry(id);
    if (++e[2] >= PET_KNOWN) this.promote(id, 3); else this.promote(id, 1);
  }
  learnTracks(id) {
    if (this.off || !SPECIES[id]?.tracks) return;
    this.tr.add(id);
    this.promote(id, 2, true);   // (quietly: tracks.js floats "Tracks added to your nature book")
  }

  // ---------- each frame ----------
  update(dt) {
    if (this.off) return;
    const g = this.game;
    if (!g.player || !g.world) return;
    this.clock += dt;
    if (this.doneT > 0 && (this.doneT -= dt) <= 0 && this.study?.done) this.study = null;
    if ((this.tick += dt) >= TICK) { const s = Math.min(this.tick, 0.5); this.tick = 0; this.studyTick(s); }
    if ((this.slow += dt) >= SLOW) { this.slow = 0; this.scanOwned(); this.payRewards(); }
    if (this.pend.length) this.flush();
  }
  // Owning a farm animal or a pet: Studied (quietly when it was never seen: a village species)
  scanOwned() {
    const R = this.game.ranch;
    if (!R?.animals?.length) return;
    for (const id of FARM_IDS) if (this.level(id) < 2 && R.mine(id).length) this.promote(id, 2);
  }
  payRewards() {
    const g = this.game;
    if (!g.inv) return;
    while (this.paid < REWARDS.length && this.count().n >= REWARDS[this.paid][0]) {
      const [n, money, item, k] = REWARDS[this.paid++];
      g.addMoney(money);
      const left = g.inv.add(item, k); if (left) g.gather.throwOut(item, left);
      if (ITEMS[item]?.place) g.craft?.learnPlan(item);   // (furniture: with its plan, to build more in B)
      Audio.unlock();
      hud.toast(t('nature.reward', { n, money, k, item: itemNoun(item) }), 'good');
    }
  }

  // ---------- the study ray (10 Hz) ----------
  // Is an animal under the cursor right now? (then the tracks' tag keeps quiet: tracks.js hoverTick)
  get onAnimal() { return !!this.cur && !(this.lostT > 0) && SPECIES[this.cur]?.group === 'animal'; }
  canStudy() {
    const g = this.game, W = g.windows;
    return g.mode === 'play' && !g.busy && g.gamemode !== 'spectator' && !g.player.ghost && g.scene === g.world && !!g.view3d?.world
      && !g.build?.on && !g.wheel?.open && !(W && WINDOWS.some(id => W.isOpen(id)));
  }
  studyTick(dt) {
    const id = this.canStudy() ? this.pick() : null;
    if (!id) {
      if ((this.lostT += dt) > LOST) { this.cur = null; this.k = 0; if (!(this.doneT > 0)) this.study = null; }
      return;
    }
    this.lostT = 0;
    if (id !== this.cur) { this.cur = id; this.k = 0; }
    const h = this.hit, silent = SILENT.has(id) || inBounds(h.x, h.y);
    if (this.level(id) > 0) { this.saw(id, dt, h.busy); if (!(this.doneT > 0)) this.study = null; return; }
    this.k += dt * (h.busy ? 2 : 1) / LOOK;
    if (this.k < 1) {
      if (!silent && !(this.doneT > 0)) { const r = this.ring; r.id = id; r.k = this.k; r.done = false; this.study = r; }
      return;
    }
    this.k = 0;
    this.saw(id, LOOK, false, silent);
    if (!silent) { const r = this.ring; r.id = id; r.k = 1; r.done = true; this.study = r; this.doneT = FLASH; }
  }
  // The species under the cursor (the crosshair in first person): the nearest hit of wild and farm animals (their body
  // boxes, up to 30 m, in sight), plants (as columns, up to 12 m: a distance reject first, there are hundreds in a
  // forest) and ripening crops (up to 6 m). → id, with this.hit filled; or null
  pick() {
    const g = this.game, p = g.player, sc = g.scene, V = g.view3d, ray = g.rayNow?.();
    if (!ray) return null;
    const h = this.hit;
    h.id = null; h.t = Infinity;
    const o0 = ray.o, d = ray.d, take = (id, tt, x, y, busy) => { h.id = id; h.t = tt; h.x = x; h.y = y; h.busy = busy; };
    const body = (e, id, busy) => {
      const dx = e.x - p.x, dy = e.y - p.y;
      if (dx * dx + dy * dy > R_ANIMAL * R_ANIMAL) return;
      const box = bodyBox(e), gy = V.groundY(sc, box.x, box.y);
      box.y0 += gy; box.y1 += gy;
      const tt = rayHits(o0, d, box);
      if (tt !== null && tt < h.t) take(id, tt, e.x, e.y, busy);
    };
    for (const w of g.wildlife?.list || []) if (SPECIES[w.type]) body(w, w.type, !!(w.grazing || w.lying || w.scared > g.time || w.type === 'cisne'));
    for (const a of g.ranch?.animals || []) if (SPECIES[a.type] && (!a.inside || g.ranch.stall(a)) && !a.rider) body(a, a.type, false);
    const l2 = d[0] * d[0] + d[2] * d[2] || 1e-9;
    for (const o of sc.harvestablesNear?.(p.x, p.y) || []) {
      const dx = o.x - p.x, dy = o.y - p.y;
      if (dx * dx + dy * dy > R_PLANT * R_PLANT || !SPECIES[o.kind]) continue;
      const ox = o.x - o0[0], oy = o.y - o0[2], tt = Math.max(0, (ox * d[0] + oy * d[2]) / l2);
      if (tt >= h.t) continue;
      const tree = TREE_IDS.has(o.kind) ? treeShape(o) : null, gap = Math.hypot(ox - d[0] * tt, oy - d[2] * tt);
      if (gap > (tree ? tree.r : 0.45)) continue;
      const y = o0[1] + d[1] * tt - V.groundY(sc, o.x, o.y);
      if (tree && y < tree.crown && gap > TRUNK_R) continue;
      if (y > -0.2 && y < (tree ? tree.top : FLOWER_IDS.has(o.kind) ? FLOWER_TOP : LOW_TOP)) take(o.kind, tt, o.x, o.y, false);
    }
    // (crops: where the ray meets the ground at about the crop's middle height, near the player)
    if (g.farm && Math.abs(d[1]) > 1e-4) {
      const gy = V.groundY(sc, p.x, p.y) + 0.25, tt = (gy - o0[1]) / d[1];
      if (tt > 0 && tt < h.t) {
        const x = o0[0] + d[0] * tt, y = o0[2] + d[2] * tt, c = (x - p.x) ** 2 + (y - p.y) ** 2 <= R_CROP * R_CROP ? g.farm.cropAt(Math.floor(x), Math.floor(y)) : null;
        if (c && !c.dead && SPECIES[c.id] && g.farm.stage(c) >= 2) take(c.id, tt, x, y, false);
      }
    }
    if (h.id && sc.reaches && !sc.reaches(p.x, p.y, h.x, h.y)) return null;   // (behind a wall)
    return h.id;
  }
}

// A page turned: a soft rustle, two quick strokes of paper
function pageTurn() {
  Audio.noiseHit(3200, 0.12, 0.07, 'highpass');
  setTimeout(() => Audio.noiseHit(2100, 0.1, 0.05, 'highpass'), 90);
}
