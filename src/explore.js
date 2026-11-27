// Exploring: the places the world has (cave mouths, camps, watchtowers, beached boats, temples, lighthouses on some coasts
// and far hamlets), their chests, the caves and dungeons they lead to, and the vehicles (boat and horse). Where each one
// goes and what it is called is decided elsewhere: world/sites.js (few, each on its spot), world/names.js (its name, its
// state and its history) and world/frozenplaces.js (what an old world keeps as it was).
import { ihash } from './util.js';
import { CHUNK } from './world/gen.js';
import { towerColliders, lighthouseColliders, chestSpot, poiModel, TOWER, GALLERY } from './world/tower.js';
import { wrapIndex, dxOf } from './world/planet.js';
import { Lookout } from './lookout.js';
import { houseBlueprint, houseSize, byChunk } from './world/blueprints.js';
import { hamletPlan, campPlan, campOf, wreckPlan, templePlan, keeperPlan, landmarkPlan, liveryOf, deckHeight, deckBox, deckColliders } from './world/hamlets.js';
import { placeBoxes, bounds, solidsOf, hull } from './world/fit.js';
import { torParts, greatR } from './world/treedims.js';
import { B, WATER_Y } from './world/biomes.js';
import { residentsOf, updateResidents, talkTo } from './hamletfolk.js';
import { makeCave, makeDungeon } from './world/underground.js';
import { sitesFor, LegacyPlaces, hamletSlots, READY, LATER, SITE_SIZE as SIZE } from './world/sites.js';
import { nameOf, stateOf, storyOf } from './world/names.js';
import { roadsFor } from './world/roads.js';
import { Roadside } from './roadside.js';
import { freeze, freezeMore, extend, bridgeRoom, roadCells, readPlaces, nearFrozen, kindOf, boxOf, gap, NEAR_FROZEN, FORM } from './world/frozenplaces.js';
import { Person } from './entities.js';
import { SHOPS } from './economy.js';
import { countOf } from './talktopics.js';
import { Audio } from './audio.js';
import { apagada } from './opciones.js';
import { ITEMS, PLACE_ITEMS, FIRE_MS, FIRE_FUEL } from './items.js';
import { hud } from './ui/hud.js';
import { t, fmt, getLang } from './i18n.js';

const NINE = [[0, 0], [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
const AROUND = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
const BIG_PLACES = new Set(['aldea', 'torre', 'cueva', 'templo', 'faro', 'hito']);
// What a place of now takes up, as a circle (its ground is level and no tree grows in it)
const SIZE3 = { campamento: 5.6, barco: 4.6, manantial: 2.4, arbol: 4.2, risco: 3.2, salegar: 2.4, mina: 6, hito: 12 };
const HITO_R = { roble: 6, majada: 12.5, santuario: 9, puente: 6.5 };
const NATURAL = new Set(['arbol', 'risco']);   // (they stand on the land as it is)
export const sizeOf = p => p.size ?? SIZE[p.kind];
const ROADS_R = 420;                     // …and the roads
const WARM_R = 520, WARM_EVERY = 0.12;   // the sites are worked out this far ahead, a cell at a time (and how often)
const SOLID3 = new Set(['torre', 'faro', 'cueva']);   // (the places of now that still are one model with its own ways: climbed, entered)
const FIRE_GLOW = 1;
const FOUND_MAX = 1500;                  // (how many places found before a guest tells its host)
const OLD = apagada('sitios');           // (?sitios=1: the places of before, to compare)
const byTile = t => { const c = t.indexOf(','); return `${Math.floor(+t.slice(0, c) / CHUNK)},${Math.floor(+t.slice(c + 1) / CHUNK)}`; };
const NO_ROADS = apagada('caminos');     // (?caminos=0: no roads)
const ART_OLD = apagada('lugares');      // (?lugares=1: the sites with the shapes they had before R7-3, to compare; nothing is saved of it)
SHOPS.viajero = { get title() { return t('shop.title.viajero'); }, hours: [7, 21], stock: [{ id: 'semilla_manzano', price: 90 }, { id: 'pocion', price: 120 }, { id: 'espada', price: 380 }, { plan: 'barca', price: 500 }, { id: 'caballo', price: 2600 }, { id: 'lingote_oro', price: 300 }, { id: 'semilla_calabaza', price: 60 }] };
// What a kind of place is called, whichever it is («Cave»)
export const placeKind = kind => t(`place.kind.${kind}`);

// The tiles of a place no tree grows on (and nobody builds on): a little map of them, 64 to a side
class Clear {
  constructor(box, p) { const ok = Number.isFinite(box[0]); this.x0 = Math.floor(ok ? (box[0] + box[2]) / 2 : p.x) - 32; this.y0 = Math.floor(ok ? (box[1] + box[3]) / 2 : p.y) - 32; this.a = new Uint8Array(4096); }
  add(x0, y0, x1, y1) { const a = Math.max(0, Math.floor(x0) - this.x0), b = Math.max(0, Math.floor(y0) - this.y0), c = Math.min(63, Math.floor(x1) - this.x0), d = Math.min(63, Math.floor(y1) - this.y0); for (let y = b; y <= d; y++) if (c >= a) this.a.fill(1, y * 64 + a, y * 64 + c + 1); }
  has(x, y) { const i = x - this.x0, j = y - this.y0; return i >= 0 && j >= 0 && i < 64 && j < 64 && this.a[j * 64 + i] === 1; }
}

export class Explore {
  constructor(game) {
    this.game = game;
    this.cache = new Map();      // "cx,cy" → the place there, a bare clearing ({ pad: true }) or null
    this.layer = { add: (cx, cy, d, out) => this.addContent(cx, cy, d, out), hides: o => this.hides(o), far: (cx, cy) => this.farTree(cx, cy), farV: () => this.version, pad: (x, y) => this.padDist(x, y), padTo: (x, y, h, curve) => this.padTo(x, y, h, curve), padSig: () => this.version, padNear: (x0, y0, x1, y1) => this.padNear(x0, y0, x1, y1), blocks: (tx, ty) => this.blocks(tx, ty), baseAt: (layer, tx, ty) => this.baseAt(layer, tx, ty), lvlAt: (x, y, tx, ty) => this.lvlAt(x, y, tx, ty), deckAt: (x, y) => this.deckAt(x, y) };
    this.plans = new Map();      // what each place of now is laid out like (hamlets.js), by its key
    this.marks2 = {};
    this.traders = new Map();
    this.aldeas = new Map();     // planos de piezas de las casas de cada aldea
    this.found = new Set();      // lugares descubiertos (para el mapa y los logros)
    this.oldFound = new Set();   // those of them found when the places were others (a place of now in that chunk is another)
    this.foundAt = {};           // key → the real day it was found
    this.places1 = null;         // what an old world keeps (frozenplaces.js), or null: not known yet (the places of before, meanwhile)
    this.marks = {};
    this.version = 0; this.warmAt = 0;
    this.look = new Lookout(this);   // (looking from above, and what is spotted: lookout.js)
    this.roadside = new Roadside(this);   // (the signposts and the bridges of the roads)
  }
  get world() { return this.game.world; }
  reset(save) {
    this.sites = sitesFor(this.world.seed);
    const gen = this.world.gen;
    this.legacy = new LegacyPlaces(this.world.seed, (x, y) => gen.biomeAt(x, y));
    this.found = new Set(save.found || []);
    this.oldFound = new Set(Array.isArray(save.oldFound) ? save.oldFound : save.placesV === 2 ? [] : save.found || []);
    this.foundAt = save.foundAt && typeof save.foundAt === 'object' ? { ...save.foundAt } : {};
    this.start = { x: save.player?.x, y: save.player?.y, spawn: save.worldSpawn, animals: save.animals };
    this.toldHost = null; this.warmAt = 0;
    this.look.reset(save);
    this.setPlaces(readPlaces(save.places1));
    // (your own world, or the server's: its list is made now, before any land is. A shared world that came without one, 0
    // (live.js, enter): in update, if it is your game that runs it; if not, the places of before, as its host sees them)
    if (save.places1 !== 0 && !save.sharedWorld) { if (!this.places1) this.settle(); else this.resettle(); }
    if (!this.world.layers.includes(this.layer)) this.world.layers.push(this.layer);
    this.roadside.join(this.world);
  }
  save(out) {
    out.found = [...this.found]; out.placesV = 2; out.foundAt = this.foundAt;
    if (this.oldFound.size) out.oldFound = [...this.oldFound];
    if (this.places1) out.places1 = this.places1;
    this.look.save(out);
  }

  // ---------- what the world keeps of before ----------
  setPlaces(v) {
    this.places1 = v; this.marks = v?.k || {}; this.marks2 = v?.s || {};
    this.version++;
    this.cache.clear(); this.aldeas.clear(); this.traders.clear(); this.described?.clear(); this.plans.clear(); this.lvls?.clear(); this.folk?.clear();
    this.found = new Set(this.found);   // (so that the maps make their list again: ui/blips.js)
    this.foundN = -1;
    const w = this.world;
    this.useRoads();
    if (w?.merged) { w.merged.clear(); w.touches++; }   // (what is drawn of each chunk, and the ground round the places)
  }
  // The roads of this world: none until it is known what was built in their way (places1.c)
  useRoads() {
    const w = this.world, c = !NO_ROADS && !OLD && this.places1?.r === FORM ? this.places1.c : null, R = Array.isArray(c) && w?.gen ? roadsFor(w.seed) : null;
    const changed = R?.setKept(c);
    if (w?.gen && (w.gen.roads !== R || changed)) { w.gen.setRoads(R); this.roadside?.clear(); this.posts?.clear(); }
  }
  // (whoever runs the world) …and the first time, that is worked out
  withRoads(list) {
    if (NO_ROADS || OLD || ART_OLD || list.r !== FORM || Array.isArray(list.c)) return list;
    const boxes = [];
    for (const [k, mark] of Object.entries(list.k)) { const kind = kindOf(mark); if (kind && kind !== '-') { const [cx, cy] = k.split(',').map(Number); boxes.push(boxOf(this.legacy.place(cx, cy, kind))); } }
    return { ...list, c: roadCells({ deltas: this.world.deltas, boxes }) };
  }
  // Whoever runs the world (or plays alone) writes the list of an old world, once. A guest waits for the host's
  settle() {
    if (OLD || this.places1) return;
    const points = this.points(), list = freeze({ sites: this.sites, legacy: this.legacy, deltas: this.world.deltas, found: this.oldFound, points });
    this.setPlaces(ART_OLD ? list : this.withRoads(extend(list, { sites: this.sites, deltas: this.world.deltas, points })));
  }
  // …and a list of before R7-3 is looked at once more (frozenplaces.js, extend)
  resettle() {
    if (OLD || ART_OLD || !this.places1 || !this.unsettled) return;
    this.setPlaces(this.withRoads(this.places1.r === FORM ? this.places1 : extend(this.places1, { sites: this.sites, deltas: this.world.deltas, points: this.points() })));
  }
  // Is there anything of the list to look at yet? (what came with R7-3, or the roads)
  get unsettled() { return this.places1.r !== FORM || (!NO_ROADS && !Array.isArray(this.places1.c)); }
  points() {
    const { x, y, spawn, animals } = this.start || {}, at = Array.isArray(spawn) ? spawn : [spawn?.x, spawn?.y];
    return [[x, y], at, ...(Array.isArray(animals) ? animals : []).map(a => [a?.x, a?.y])];
  }
  // (whoever runs the world) The stone bridge, once it is known where it would go: is there room for it? Once and for ever
  bridgeSettle() {
    const h = this.sites.hitos && [...this.sites.hitos.values()].find(q => q.id === 'puente');
    if (!h || this.places1?.r !== FORM || this.places1.b !== undefined) return;
    this.setPlaces({ ...this.places1, b: bridgeRoom(h.site, this.world.deltas) ? 1 : 0 });
  }
  // (guest) The list of the world, from its host
  share(v) { const r = readPlaces(v); if (r && JSON.stringify(r) !== JSON.stringify(this.places1)) this.setPlaces(r); }
  // (guest, on joining) The places this player had found before, for the host to keep them (frozenplaces.js). Once per host
  tellHost() {
    const L = this.game.live;
    if (!L?.joined || !L.guest || L.hostConn === null || L.hostConn === undefined || this.toldHost === L.hostConn || !this.places1) return;
    this.toldHost = L.hostConn;
    const keys = [...this.oldFound].filter(k => !this.marks[k] || this.marks[k] === '-').slice(0, FOUND_MAX);
    if (keys.length) L.net?.send({ t: 'places', k: keys }, L.hostConn);
  }
  // (host) …and here they come
  keepFound(keys) {
    if (!this.places1 || OLD || !Array.isArray(keys)) return;
    const siteNear = p => { const b = boxOf(p); return this.sites.near(p.x, p.y, NEAR_FROZEN + 64, READY).some(s => this.poiOf(s.key)?.kind === s.kind && gap(boxOf(s), b) < NEAR_FROZEN); };
    const v = freezeMore(this.places1, { legacy: this.legacy, deltas: this.world.deltas, found: keys.slice(0, FOUND_MAX), siteNear });
    if (v) this.setPlaces(v);
  }

  // ---------- the places ----------
  // What there is in this chunk (the same for the same seed and the same list): the place that stays from before, or the
  // site of now. A clearing ({ pad: true }) is the flat ground where ruins were
  entry(cx, cy) {
    cx = wrapIndex(cx, CHUNK);   // (el trozo, dentro del planeta)
    const k = `${cx},${cy}`, hit = this.cache.get(k);
    if (hit !== undefined) return hit;
    let p = null;
    if (!this.places1) p = this.legacy.at(cx, cy);
    else {
      const kind = kindOf(this.marks[k]);
      if (kind && kind !== '-') p = this.legacy.place(cx, cy, kind);
      else if (kind !== '-') {
        const s = this.sites.at(cx, cy), now = this.places1.r === FORM, mark = this.marks2[k];
        if (s && (READY.has(s.kind) || (now && LATER.has(s.kind) && mark !== '-')) && !nearFrozen(s, this.marks, this.legacy)) p = now && mark !== 'o' ? this.formed(s) : s;
        // (the bridge has no site of its own)
        else if (now && this.places1.b === 1) { const h = this.sites.hitos?.get(k); if (h?.site && !nearFrozen({ ...h.site, kind: 'barco' }, this.marks, this.legacy)) p = { ...h.site, hito: 'puente', form: FORM, size: HITO_R.puente }; }
      }
    }
    if (p?.kind === 'ruinas') p = { ...p, pad: true };
    // (a lighthouse left behind is not lit; those of before, always, as they were)
    if (p?.kind === 'faro' && !p.legacy) { p = { ...p, lit: p.hito === 'faro' || stateOf(p) !== 'empty' }; if (p.form) p.lived = p.hito === 'faro' || stateOf(p) === 'lived'; }
    if (this.cache.size > 30000) this.cache.clear();
    this.cache.set(k, p);
    return p;
  }
  // A site with what it has been since R7-3: form, how much it takes up (size) and what tells it from the others. A landmark that
  // was the spot of a small place (the oak, the fold, the sanctuary) is of its own kind: 'hito'
  formed(s) {
    const hito = this.sites.hitos?.get(s.key)?.id || null, p = { ...s, form: FORM };
    if (hito === 'roble' || hito === 'majada' || hito === 'santuario') return Object.assign(p, { kind: 'hito', hito, was: s.kind, size: HITO_R[hito] });
    if (hito) p.hito = hito;
    if (SIZE3[s.kind]) p.size = SIZE3[s.kind];
    if (s.kind === 'faro') p.livery = hito ? 'red' : liveryOf(s);
    if (s.kind === 'templo') p.size = [7, 8, 9.5][[4, 6, 8].indexOf(this.planOf(p).columns)];
    return p;
  }
  // The place in this chunk, or null
  poi(cx, cy) { const p = this.entry(cx, cy); return p && !p.pad ? p : null; }
  poiOf(key) { const [cx, cy] = key.split(',').map(Number); return Number.isFinite(cx) && Number.isFinite(cy) ? this.poi(cx, cy) : null; }
  // Does this player know this place? (an old key may be of a place that is no more, with another one in its chunk now)
  known(p) { return this.found.has(p.key) && (!!p.legacy || !this.oldFound.has(p.key)); }
  // The places this player knows
  knownPlaces() { const out = []; for (const k of this.found) { const p = this.poiOf(k); if (p && this.known(p)) out.push(p); } return out; }
  // The nearest place of a kind within r that is not in skip (a Set of keys), or null: for /locate, rumours… Those that stay
  // from before count too
  nearest(x, y, kinds, r = 4000, skip = null) {
    let best = null, bd = r;
    const try1 = p => { const d = Math.hypot(p.x - x, p.y - y); if (d < bd && kinds.includes(p.kind) && !skip?.has(p.key)) { bd = d; best = p; } };
    if (!this.places1) {
      const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
      for (let q = 0; q <= 150 && (q - 1) * CHUNK <= bd; q++) for (let j = -q; j <= q; j++) for (let i = -q; i <= q; i += Math.abs(j) === q ? 1 : Math.max(1, 2 * q)) { const p = this.poi(cx + i, cy + j); if (p) try1(p); }
      return best;
    }
    for (const [k, mark] of Object.entries(this.marks)) if (mark !== '-') { const p = this.poiOf(k); if (p?.legacy) try1(p); }
    const s = this.sites.nearest(x, y, kinds.filter(q => READY.has(q) || LATER.has(q)), bd, skip, q => { const p = this.poiOf(q.key); return !!p && !p.legacy && p.kind === q.kind; });
    return s ? this.poiOf(s.key) : best;
  }
  // ---------- who they are ----------
  nameOf(p) { return nameOf(p); }
  title(p) { return p.hito ? t(`landmark.${p.hito}`) : t(`place.title.${p.kind}`, { name: nameOf(p) }); }
  // { title, kind, state (its name, or null), story, at (the real day, or undefined) }: for the journal and the maps
  describe(p) {
    const C = (this.described ||= new Map());
    let q = C.get(p.key);
    if (!q) {
      const h = p.kind === 'aldea' ? null : this.nearest(p.x, p.y, ['aldea'], 1500), d = h ? Math.hypot(h.x - p.x, h.y - p.y) : Infinity;
      C.set(p.key, (q = { state: p.hito === 'faro' ? 'lived' : stateOf(p, d), ...storyOf(p, h && nameOf(h)) }));
    }
    const story = p.hito ? t(`landmark.${p.hito}.story`) : t(`place.story.${p.kind}.${q.line}`, { year: String(q.year), name: nameOf(p), builder: t(`place.builder.${q.builder}`, { name: q.hamlet || '' }) });
    return { title: this.title(p), kind: placeKind(p.kind), state: q.state && t(`place.state.${q.state}`), story, at: this.foundAt[p.key] };
  }
  // What a place of now is laid out like (hamlets.js), worked out once: { …its plan, chunks, objs: "cx,cy" → [things], clear (a Set of
  // the tiles no tree grows on) }, or null
  planOf(p) {
    if (!p.form) return null;
    let L = this.plans.get(p.key);
    if (L !== undefined) return L;
    const S = this.sites, wet = (x, y) => !!this.world.natWater(x, y), gen = this.world.gen, land = { wet, height: (x, y) => Math.max(0, gen.groundAt(x, y)), probe: (x, y) => { S.probe(x, y); return S.u > 0 ? -1 : Math.max(0, S.h); } };
    L = null;
    if (p.kind === 'aldea') {
      const cx = Math.floor(p.x / CHUNK), cy = Math.floor(p.y / CHUNK);
      L = hamletPlan(p, land, { mine: this.sites.near(p.x, p.y, 420, ['mina']).length > 0, scattered: hamletSlots(cx, cy, wet) });
    }
    else if (p.kind === 'campamento') { L = campPlan(p, this.stateOfCamp(p)); L.lvl = p.z || null; }
    else if (p.kind === 'barco') { L = wreckPlan(p); L.lvl = p.z || null; }
    else if (p.kind === 'templo') L = templePlan(p, wet);
    else if (p.kind === 'hito') L = landmarkPlan(p, p.hito);
    else if (p.kind === 'faro') { L = (p.lived && keeperPlan(p, land)) || this.empty(p); L.chest = [p.x - 1.9, p.y + 1.6, 0.4]; }   // (the keeper's locker, by the door)
    else if (p.kind === 'torre') L = this.single(p, `tower_dress:${p.hito ? 'beacon' : this.stateOfTower(p)}:${p.h}:${p.snow ? 'snow' : p.biome === B.DESERT ? 'sand' : 'green'}`, p.yaw);
    else if (p.kind === 'manantial') L = this.single(p, `spring:${this.sites.near(p.x, p.y, 700, ['aldea']).length ? 'trough' : 'seep'}${p.snow ? ':snow' : ''}`, ihash(p.id, 37, 7177) * 6.28);
    else if (p.kind === 'salegar') L = this.single(p, `salt_lick${p.snow ? ':snow' : ''}`, ihash(p.id, 37, 7177) * 6.28);
    else if (p.kind === 'mina') { const yaw = this.downhill(p, wet); L = this.single(p, `mine_mouth${p.snow ? ':snow' : ''}`, yaw); L.mine = [p.x + Math.sin(yaw) * 0.9, p.y + Math.cos(yaw) * 0.9]; }
    if (p.kind === 'hito' && p.hito === 'roble' || p.kind === 'arbol') {
      const wild = p.hito ? L.nature[0].kind : p.biome === B.PINES ? 'greatPine' : p.biome === B.FOREST && ihash(p.id, 38, 7177) < 0.5 ? 'greatChestnut' : 'greatOak', k = p.hito ? 1.3 : p.kind === 'arbol' && p.biome === B.PINES ? 1 : 0.9 + ihash(p.id, 39, 7177) * 0.2;
      L ||= this.empty(p);
      L.nature = [{ wild, x: p.x, y: p.y, k }];
    } else if (p.kind === 'risco') { L = this.empty(p); L.nature = [{ wild: p.snow ? 'snowTor' : 'tor', x: p.x, y: p.y, k: 1.05 + ihash(p.id, 39, 7177) * 0.2 }]; }
    if (L) this.finish(p, L);
    this.plans.set(p.key, L);
    return L;
  }
  empty(p) { return { placed: {}, floor: {}, roof: {}, props: [], nature: [], crops: [], decks: [], work: [], homes: [], boats: [], box: [p.x - 2, p.y - 2, p.x + 2, p.y + 2], lvl: null }; }
  single(p, m, yaw = 0) { const L = this.empty(p); L.props.push({ m, x: p.x, y: p.y, yaw, z: 0 }); return L; }
  // The side the land goes down to (wet: and with as little water before it as can be)
  downhill(p, wet) {
    let low = Infinity, yaw = 0;
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2, s = Math.sin(a), c = Math.cos(a);
      let h = Math.max(0, this.sites.height(p.x + s * 6, p.y + c * 6));
      for (let z = 1; z <= 6; z++) for (let u = -1; u <= 1; u++) if (wet(p.x + s * z + c * u, p.y + c * z - s * u)) h += 2;
      if (h < low - 0.05) { low = h; yaw = a; }
    }
    return yaw;
  }
  hamletFar(p, r) { for (const s of this.sites.near(p.x, p.y, r, ['aldea'])) if (this.poiOf(s.key)?.kind === 'aldea') return Math.hypot(s.x - p.x, s.y - p.y); return Infinity; }
  stateOfTower(p) { return stateOf(p, this.hamletFar(p, 1000)); }
  stateOfCamp(p) { return stateOf(p, this.hamletFar(p, 1500)); }
  // The plan in its chunks: its pieces, and its things as objects of the world with what one bumps into. z: the ground they stand on
  finish(p, L) {
    const z = p.kind === 'aldea' ? 0 : L.lvl ?? p.z ?? 0, objs = (L.objs = new Map()), clear = (L.clear = new Clear(L.box, p));
    const put = o => { const k = `${wrapIndex(Math.floor(o.x / CHUNK), CHUNK)},${Math.floor(o.y / CHUNK)}`; let l = objs.get(k); if (!l) objs.set(k, (l = [])); l.push(o); };
    const tiles = (x0, y0, x1, y1, m = 1.5) => clear.add(x0 - m, y0 - m, x1 + m, y1 + m);
    L.z = z;
    const apart = this.takeApart(p, L);   // (the things of an empty place that are put as anyone's: they come apart)
    L.chunks = byChunk(L, CHUNK);
    for (const [t, pos, m] of apart.values()) { const c = L.chunks[byTile(t)]; (c.pos ||= {})[`placed:${t}`] = pos; (c.models ||= {})[`placed:${t}`] = m; }
    for (const l of ['placed', 'floor', 'roof']) for (const k of Object.keys(L[l])) { const c = k.indexOf(','), x = +k.slice(0, c), y = +k.slice(c + 1); if (l !== 'roof' || !L.placed[k]) tiles(x, y, x, y, l === 'floor' ? 2.2 : 3); }
    L.props.forEach((o, i) => {
      if (apart.has(i)) { const q = bounds(placeBoxes([hull(solidsOf(o.m))], o.x, o.y, o.yaw)[0]); tiles(q.x0, q.y0, q.x1, q.y1, 2.5); return; }
      const local = solidsOf(o.m), box = placeBoxes([hull(local)], o.x, o.y, o.yaw)[0], q = bounds(box), low = local.every(b => b[4] < 0.14), fire = /^(campfire|brazier):/.test(o.m);
      // (a fire that can be lit: its place's, by its number; fireOf)
      put({ x: o.x, y: o.y, yaw: o.yaw, z: z + (o.z || 0), decor: o.m, key: `pl:${p.key}:${i}`, fireId: fire ? `${p.key}#${i}` : null, fx: [q.x0, q.x1], fy: [q.y0, q.y1], walk: low || /^(jetty|stone_bridge|tower_dress)/.test(o.m), box });
      if (!/^(jetty|stone_bridge)/.test(o.m)) tiles(q.x0, q.y0, q.x1, q.y1, o.m === 'rail' ? 1.5 : 2.5);
      if (o.m.startsWith('mine_mouth')) tiles(o.x + Math.sin(o.yaw) * 3 - 2, o.y + Math.cos(o.yaw) * 3 - 2, o.x + Math.sin(o.yaw) * 3 + 2, o.y + Math.cos(o.yaw) * 3 + 2, 1.5);
      L.props[i].boxes = low ? null : local;
    });
    L.crops.forEach(([x, y, id, st]) => { put({ x: x + 0.5, y: y + 0.5, z, yaw: 0, decor: 'tilled:0', key: `pt:${x},${y}`, fx: [x, x + 1], fy: [y, y + 1], walk: true }); put({ x: x + 0.5, y: y + 0.5, z, yaw: ((x * 7 + y * 3) % 4) * 1.57, decor: `crop:${id}:${st}`, key: `pc:${x},${y}`, fx: [x, x + 1], fy: [y, y + 1], walk: true }); tiles(x, y, x, y); });
    for (const [i, [x, y, a]] of (L.boats || []).entries()) put({ x, y, yaw: a, z: WATER_Y - 0.12, decor: 'row_boat', key: `pb:${p.key}:${i}`, fx: [x - 1, x + 1], fy: [y - 1, y + 1], walk: true });
    for (const [i, o] of L.nature.entries()) put({ x: o.x, y: o.y, wild: o.wild, k: o.k, key: `pn:${p.key}:${i}` });
    if (L.chest) { const [x, y, a] = L.chest; put({ x, y, yaw: a, z, treasure: p, tile: [Math.floor(x), Math.floor(y)], key: `pch:${p.key}` }); tiles(x, y, x, y, 1); }
    if (p.kind === 'aldea') { L.all = { placed: L.placed, floor: L.floor, roof: L.roof }; }
  }
  // The things of an empty camp, or of a wreck, that anyone can build too (items.js, PLACE_ITEMS): put as theirs, so they come apart with
  // B › Remove, and give back what they cost. i (of L.props) → [tile, [x, y, yaw], how it is]; they are added to L.placed
  deserted(p) { return p.kind === 'barco' || (p.kind === 'campamento' && this.stateOfCamp(p) === 'empty'); }
  takeApart(p, L) {
    const out = new Map();
    if (!this.deserted(p)) return out;
    L.props.forEach((o, i) => {
      const [kind, how] = o.m.split(':'), id = kind === 'beached' ? `beached_${how}` : kind, t = `${Math.floor(o.x)},${Math.floor(o.y)}`;
      if (!Object.hasOwn(PLACE_ITEMS, id) || L.placed[t] || o.z) return;
      L.placed[t] = id; out.set(i, [t, [o.x, o.y, o.yaw || 0], o.m]);
    });
    return out;
  }
  // The places of now whose things reach this chunk
  formedAround(cx, cy) {
    const out = [];
    for (const [dx, dy] of [[0, 0], ...AROUND]) { const p = this.poi(cx + dx, cy + dy); if (p?.form) out.push(p); }
    return out;
  }
  // What the pieces of a place stand at, and the decks: by chunk, worked out once
  levelsOf(cx, cy) {
    const C = (this.lvls ||= new Map()), k = (wrapIndex(cx, CHUNK) + 100000) * 200003 + cy, hit = C.get(k);
    if (hit !== undefined) return hit;
    let out = null;
    for (const p of this.formedAround(cx, cy)) {
      const L = this.planOf(p);
      if (!L) continue;
      for (const d of L.decks) { const b = deckBox(d); if (b[2] >= cx * CHUNK && b[0] < (cx + 1) * CHUNK && b[3] >= cy * CHUNK && b[1] < (cy + 1) * CHUNK) ((out ||= { decks: [], lvl: null }).decks).push(d); }
      const c = L.lvl ? L.chunks[`${wrapIndex(cx, CHUNK)},${cy}`] : null;
      if (c) { out ||= { decks: [], lvl: null }; out.lvl ||= new Map(); for (const l of ['floor', 'placed', 'roof']) for (const t of Object.keys(c[l])) if (l !== 'roof' || !out.lvl.has(t)) out.lvl.set(t, l === 'roof' && !c.floor[t] && !c.placed[t] ? -L.lvl : L.lvl); }
    }
    if (C.size > 6000) C.clear();
    C.set(k, out);
    return out;
  }
  lvlAt(x, y, tx, ty) {
    const q = this.levelsOf(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK));
    if (!q) return null;
    for (const d of q.decks) { const h = deckHeight(d, x, y); if (h !== null) return h; }
    const v = q.lvl?.get(`${tx},${ty}`);
    return v === undefined || v < 0 ? null : v;
  }
  deckAt(x, y) {
    const q = this.levelsOf(Math.floor(x / CHUNK), Math.floor(y / CHUNK));
    if (q) for (const d of q.decks) { const h = deckHeight(d, x, y); if (h !== null) return h; }
    return null;
  }
  // Is this tile part of something where somebody lives ('lived'), or of a place that is everybody's, a temple or a landmark ('kept')?
  // It is not taken apart (build.js). The empty houses of a hamlet can be, and the hamlets of before, as always
  livedAt(tx, ty) {
    for (const p of this.formedAround(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK))) {
      const L = this.planOf(p), k = `${tx},${ty}`;
      if (!L || !(L.placed[k] || L.floor[k] || L.roof[k]) || this.deserted(p)) continue;
      if (p.kind === 'aldea' && L.homes.some(h => h.empty && tx >= h.x && tx < h.x + h.w && ty >= h.y && ty < h.y + h.h)) continue;
      return p.kind === 'aldea' || p.kind === 'faro' || p.hito === 'majada' ? 'lived' : 'kept';
    }
    return null;
  }
  aldeaSlots(cx, cy) { return hamletSlots(cx, cy, (x, y) => !!this.world.natWater(x, y)); }   // (la del mundo: los lugares no cambian con lo cavado)
  // La aldea cuyas casas llegan a este trozo (la del propio trozo o la de uno de al lado)
  aldeasAround(cx, cy) {
    const out = [];
    for (const [dx, dy] of [[0, 0], ...AROUND]) { const p = this.poi(cx + dx, cy + dy); if (p?.kind === 'aldea') out.push(p); }
    return out;
  }
  // (of those of before, for which trees keep off the whole of its box)
  oldAldeasAround(x, y, m) { return this.aldeasAround(Math.floor(x / CHUNK), Math.floor(y / CHUNK)).some(p => { if (p.form) return false; const [x0, y0, x1, y1] = this.aldea(p).box; return x > x0 - m && x < x1 + m && y > y0 - m && y < y1 + m; }); }
  // ¿Cae esta casilla en la zona de una aldea (sus casas y un margen)?
  inAldea(x, y, m) {
    return this.aldeasAround(Math.floor(x / CHUNK), Math.floor(y / CHUNK)).some(p => { const [x0, y0, x1, y1] = this.aldea(p).box; return x > x0 - m && x < x1 + m && y > y0 - m && y < y1 + m; });
  }
  // Lugar cerca de un punto del mundo
  poiNear(x, y, r) {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const p = this.poi(cx + dx, cy + dy); if (p && Math.hypot(p.x - x, p.y - y) < r + sizeOf(p)) return p; }
    return null;
  }
  // ¿Hay un lugar o una aldea que llegue a este rectángulo? (scenes.js ya lo agranda con lo que alcanza el allanado: aquí,
  // si lo toca lo que ocupa el lugar, su caja o su tamaño, por cada eje para no quedarse corto). Los mismos lugares que
  // mira padDist, los de los trozos de al lado
  padNear(x0, y0, x1, y1) {
    for (let cy = Math.floor(y0 / CHUNK) - 1; cy <= Math.floor(y1 / CHUNK) + 1; cy++) for (let cx = Math.floor(x0 / CHUNK) - 1; cx <= Math.floor(x1 / CHUNK) + 1; cx++) {
      const p = this.entry(cx, cy);
      if (!p) continue;
      if (p.kind === 'aldea') { const [a0, b0, a1, b1] = this.aldea(p).box; if (a0 <= x1 && a1 >= x0 && b0 <= y1 && b1 >= y0) return true; }
      else if (!NATURAL.has(p.kind)) { const r = sizeOf(p) || 2; if (Math.max(0, x0 - p.x, p.x - x1) <= r && Math.max(0, y0 - p.y, p.y - y1) <= r) return true; }
    }
    return false;
  }
  // Lo lejos que está (x, y) de un lugar o de las casas de una aldea (para allanar el suelo a 0: ver scenes.js, padK). Only
  // those whose ground is at 0: the hamlets and the places of before
  padDist(x, y) {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
    let best = 99;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const p = this.entry(cx + dx, cy + dy);
      if (!p) continue;
      if (p.kind === 'aldea') { const [x0, y0, x1, y1] = this.aldea(p).box, ex = Math.max(0, x0 - x, x - x1), ey = Math.max(0, y0 - y, y - y1); best = Math.min(best, Math.hypot(ex, ey)); }
      else if (!p.z && !NATURAL.has(p.kind) && p.hito !== 'puente') best = Math.min(best, Math.max(0, Math.hypot(x - p.x, y - p.y) - (sizeOf(p) || 2)));
    }
    return best;
  }
  // The ground (h, as it is) next to the places that stand at their own height (p.z): flat there, and back to its own
  // height round them. curve(d): from 0 (flat) to 1 (as it is), at d from the place (scenes.js)
  padTo(x, y, h, curve) {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const p = this.entry(cx + dx, cy + dy);
      if (p && p.z && !NATURAL.has(p.kind) && p.hito !== 'roble') { const k = curve(Math.max(0, Math.hypot(x - p.x, y - p.y) - (sizeOf(p) || 2))); if (k < 1) h = p.z + (h - p.z) * k; }
    }
    return h;
  }
  // The great tree of that chunk, for far off (world3d.js: the card of a tree of its kind, as big as it is), or null
  farTree(cx, cy) {
    const p = this.poi(cx, cy);
    if (!p?.form || (p.kind !== 'arbol' && p.hito !== 'roble')) return null;
    const o = this.planOf(p)?.nature[0];
    if (!o) return null;
    return o.far ||= { kind: o.wild === 'greatPine' ? 'pine' : 'oak', x: o.x, y: o.y, age: 1, key: `pf:${p.key}`, farK: (o.wild === 'greatPine' ? 1.5 : 1.75) * o.k, farW: o.wild === 'greatPine' ? 1.8 : 1.35 };
  }
  hides(o) {
    if (!o.kind) return false;
    if (this.oldAldeasAround(o.x, o.y, 1.5)) return true;
    // (a place of now: no tree on its tiles; and none round what is small)
    const F = this.formedAround(Math.floor(o.x / CHUNK), Math.floor(o.y / CHUNK));
    for (const q of F) { if (this.planOf(q)?.clear.has(Math.floor(o.x), Math.floor(o.y)) || (q.kind !== 'aldea' && Math.hypot(o.x - q.x, o.y - q.y) < sizeOf(q) + 0.5)) return true; }
    const p = this.entry(Math.floor(o.x / CHUNK), Math.floor(o.y / CHUNK));
    // (entry: the clearing where ruins were has no trees either: something is built there)
    return !!p && !p.form && p.kind !== 'aldea' && Math.hypot(o.x - p.x, o.y - p.y) < SIZE[p.kind] + 1.5;
  }
  blocks(tx, ty) {
    const p = this.poi(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK));
    if (p?.form && p.kind !== 'aldea') return p.hito === 'puente' ? this.deckAt(tx + 0.5, ty + 0.5) !== null : Math.hypot(tx + 0.5 - p.x, ty + 0.5 - p.y) < Math.min(8, sizeOf(p)) + 0.5 || !!this.planOf(p)?.clear.has(tx, ty);
    return !!p && p.kind !== 'aldea' && Math.hypot(tx + 0.5 - p.x, ty + 0.5 - p.y) < SIZE[p.kind] + 1;   // (en las aldeas se puede construir: sus casas también se deshacen)
  }
  // Las casas de una aldea: dos o tres planos de piezas (como las del pueblo) alrededor de una plaza, donde está
  // el mercader. Llegan a los trozos de al lado. box: lo que ocupan [x0, y0, x1, y1].
  aldea(p) {
    if (p.form) return this.planOf(p);
    let a = this.aldeas.get(p.key);
    if (!a) {
      const all = { placed: {}, floor: {}, roof: {} }, cx = Math.floor(p.x), cy = Math.floor(p.y), box = [Infinity, Infinity, -Infinity, -Infinity];
      const roofs = ['tejado_azul', 'tejado_gris', 'tejado_verde'];
      for (const [i, [dx, dy]] of this.aldeaSlots(Math.floor(p.x / CHUNK), Math.floor(p.y / CHUNK)).entries()) {
        const roof = roofs[i];
        const x0 = cx + dx, y0 = cy + dy, { w, h } = houseSize(false), bp = houseBlueprint({ x0, y0, roof, furnish: 'npc' });
        for (const layer of ['placed', 'floor', 'roof']) Object.assign(all[layer], bp[layer]);
        box[0] = Math.min(box[0], x0); box[1] = Math.min(box[1], y0); box[2] = Math.max(box[2], x0 + w); box[3] = Math.max(box[3], y0 + h);
      }
      a = { all, box, chunks: byChunk(all, CHUNK) };
      this.aldeas.set(p.key, a);
    }
    return a;
  }
  // Pieza fija de una aldea en una casilla (para puertas, vallas, tejados y colocar cosas)
  // For the maps (ui/mapoverlay.js, ui/sattiles.js), of the discovered places only: the pieces of the hamlets in the chunk of
  // key k ("cx,cy"), or undefined; and the boxes [x0, y0, x1, y1] round a chunk where places keep the trees away (hides)
  builtIn(k) {
    if (this.foundN !== this.found.size) {
      this.foundN = this.found.size;
      this.foundBuilt = new Map(); this.foundBoxes = [];
      for (const p of this.knownPlaces()) {
        if (p.kind !== 'aldea') { const r = Math.min(9, sizeOf(p)) + (p.form ? 0.5 : 1.5), L = this.planOf(p); this.foundBoxes.push([p.x - r, p.y - r, p.x + r, p.y + r]); if (L) for (const [c, v] of Object.entries(L.chunks)) this.foundBuilt.set(c, v); continue; }
        const a = this.aldea(p), [x0, y0, x1, y1] = a.box;
        this.foundBoxes.push([x0 - 1.5, y0 - 1.5, x1 + 1.5, y1 + 1.5]);
        for (const [c, v] of Object.entries(a.chunks)) this.foundBuilt.set(c, v);
      }
    }
    return this.foundBuilt.get(k);
  }
  clearings(cx, cy) {
    this.builtIn('');
    const x0 = (cx - 1) * CHUNK, y0 = (cy - 1) * CHUNK, d = CHUNK * 3;
    return this.foundBoxes.filter(b => b[2] > x0 && b[0] < x0 + d && b[3] > y0 && b[1] < y0 + d);
  }
  baseAt(layer, tx, ty) {
    const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK);
    for (const [dx, dy] of NINE) {
      const p = this.poi(cx + dx, cy + dy);
      if (!p || (!p.form && p.kind !== 'aldea')) continue;
      const v = p.form ? this.planOf(p)?.[layer]?.[`${tx},${ty}`] : this.aldea(p).all[layer]?.[`${tx},${ty}`];
      if (v) return v;
    }
    return undefined;
  }

  addContent(cx, cy, d, out) {
    // Las casas de las aldeas que llegan a este trozo; sus ventanas dan luz por sí mismas
    for (const q of this.aldeasAround(cx, cy)) if (!q.form) { const a = this.aldea(q).chunks[`${cx},${cy}`]; if (a) this.world.addBuilt(a, out, true); }
    for (const q of this.formedAround(cx, cy)) this.addFormed(q, cx, cy, d, out);
    const p = this.poi(cx, cy);
    if (!p || p.kind === 'aldea' || (p.form && !SOLID3.has(p.kind))) return;
    const opened = d?.opened?.[p.key];
    // Todos los lugares ocupan 3×3 casillas enteras alrededor de la suya (el centro es una casilla)
    if (p.kind === 'cueva') {
      out.objects.push({ x: p.x, y: p.y, poi: p, fx: [p.x - 1.5, p.x + 1.5], fy: [p.y - 1.5, p.y + 1.5] });
      out.colliders.push({ x0: p.x - 1.5, y0: p.y - 1.5, x1: p.x + 1.5, y1: p.y + 0.5 });
      return;
    }
    if (p.kind === 'faro') {
      out.objects.push({ x: p.x, y: p.y, poi: p, fx: [p.x - 1.5, p.x + 1.5], fy: [p.y - 1.5, p.y + 1.5] });
      out.colliders.push(...lighthouseColliders(p.x, p.y, p.key));
      if (p.lit !== false) out.lights.push({ x: p.x, y: p.y, z: 160, r: 120 });
      return;
    }
    // Campamento, torre, barco y templo: el sitio y un cofre al lado (menos el templo, que guarda su tesoro dentro)
    const half = p.kind === 'torre' ? TOWER.R : 1.5;
    out.objects.push({ x: p.x, y: p.y, poi: p, fx: [p.x - half, p.x + half], fy: [p.y - half, p.y + half] });
    if (p.kind === 'torre') out.colliders.push(...towerColliders(p.x, p.y, { h: p.h, yaw: p.yaw, key: p.key }));   // (se entra y se sube por dentro: ver world/tower.js)
    else if (p.kind === 'campamento') { out.colliders.push({ x0: p.x - 1.5, y0: p.y - 1.5, x1: p.x + 0.5, y1: p.y + 0.5 }); out.colliders.push({ x: p.x + 1, y: p.y + 1, r: 0.4 }); }
    else out.colliders.push({ x0: p.x - 1.4, y0: p.y - 1.4, x1: p.x + 1.4, y1: p.y + 1.4 });
    if (p.kind === 'campamento') out.lights.push({ x: p.x + 1, y: p.y + 1, z: 6, r: 60 });
    // (the watchman's chest, up on the terrace; that of a tower of before, where it was)
    if (p.kind === 'torre' && p.h) {
      const c = chestSpot(p);
      out.objects.push({ x: c.x, y: c.y, yaw: c.yaw, up: c.z, treasure: p, tile: [Math.floor(c.x), Math.floor(c.y)], open: !!opened });
      out.colliders.push({ x: c.x, y: c.y, r: 0.35, zmin: c.z - 1 });
    } else if (p.kind !== 'templo') {
      const at = [Math.floor(p.x) + (p.kind === 'torre' ? 5 : 2), Math.floor(p.y)];   // la casilla de al lado, a la derecha del lugar (de la torre, fuera)
      out.objects.push({ x: at[0] + 0.5, y: at[1] + 0.5, treasure: p, tile: at, open: !!opened });
      out.colliders.push({ x: at[0] + 0.5, y: at[1] + 0.5, r: 0.35 });
    }
  }

  // The pieces and the things of a place of now that fall in this chunk
  addFormed(p, cx, cy, d, out) {
    const L = this.planOf(p);
    if (!L) return;
    const k = `${cx},${cy}`, a = L.chunks[k], list = L.objs.get(k);
    // (a camp where a traveller of the roads sleeps tonight: its fire lit and its tent shut; in the morning, cold ashes: travellers.js)
    const camp = p.kind === 'campamento' && !this.deserted(p) ? this.game.travellers?.campState(p) || 0 : 0;
    if (a) this.world.addBuilt(a, out, true);
    for (const o of list || []) {
      if (o.treasure) { out.objects.push({ ...o, treasure: p, open: !!this.world.delta(Math.floor(p.x / CHUNK), Math.floor(p.y / CHUNK))?.opened?.[p.key] }); out.colliders.push({ x: o.x, y: o.y, r: 0.35 }); continue; }
      if (o.wild) {
        out.objects.push(o);
        if (o.wild === 'tor' || o.wild === 'snowTor') for (const q of torParts(o)) { const top = q.h + q.sy * 0.82; if (q.sx > 0.7 * (o.k || 1)) out.colliders.push({ x: o.x + q.x, y: o.y + q.y, r: Math.min(q.sx, q.sz) * 0.86, top }); else out.colliders.push({ x: o.x + q.x, y: o.y + q.y, r: Math.min(q.sx, q.sz) * 0.7, top: q.h + q.sy * 0.7 }); }
        else out.colliders.push({ x: o.x, y: o.y, r: greatR({ kind: o.wild, k: o.k }) });
        continue;
      }
      // (a fire that somebody has lit; and what a lit fire is for the cold: body.js)
      if (o.fireId) {
        const lit = this.fireLit(o.fireId, p) || o.decor.includes(':lit') || camp === 1, m = lit ? o.decor.replace(/:(laid|cold)/, ':lit') : camp === 2 ? o.decor.replace(':laid', ':cold') : o.decor;
        out.objects.push({ ...o, decor: m, key: `${o.key}:${lit ? 1 : camp === 2 ? 2 : 0}`, glow: lit ? FIRE_GLOW : null });
        if (lit) out.lights.push({ x: o.x, y: o.y, z: 6, r: 60 });
      } else if (o.decor.startsWith('signpost')) { const m = this.postOf(p, o); out.objects.push(m ? { ...o, decor: m } : o); }
      else if (camp === 1 && o.decor.startsWith('tent:')) out.objects.push({ ...o, decor: o.decor.replace(':open', ':shut'), key: `${o.key}:shut` });
      else out.objects.push(o);
      if (o.walk) continue;
      const m = o.decor, local = solidsOf(m);
      // (a house of rock is not one box: its parts)
      const parts = /^(mine_mouth|sawpit|spring|bell_frame)/.test(m) ? placeBoxes(local.filter(b => b[1] < 1.2), o.x, o.y, o.yaw) : [o.box];
      for (const s of parts) { out.colliders.push({ ...bounds(s), obb: s, free: true }); out.solids.push({ ...s, y0: s.y0 ?? 0, y1: s.y1 ?? 2 }); }
    }
    for (const q of L.decks) if (Math.floor(q.x / CHUNK) === cx && Math.floor(q.y / CHUNK) === cy) for (const c of deckColliders(q)) out.colliders.push({ ...c, free: true });
  }
  // The signpost of a hamlet (or of the council's oak), with the names of where its roads go: its model, or null (no road comes)
  postOf(p, o) {
    if (!this.world.gen.roads || (p.kind !== 'aldea' && p.hito !== 'roble') || o.decor === 'signpost:180') return null;
    const C = (this.posts ||= new Map()), k = `${o.key}:${getLang()}`;
    let m = C.get(k);
    if (m === undefined) { const a = this.roadside.placePost(p); C.set(k, (m = a ? this.roadside.model(a, o.yaw) : null)); }
    return m;
  }
  // Is this fire of a place (its key, '#' and its number) burning? Lit by somebody, for a while: d.fire of the place's chunk
  fireLit(id, p) { const v = this.world.delta(Math.floor(p.x / CHUNK), Math.floor(p.y / CHUNK))?.fire?.[id]; return typeof v === 'number' && v > Date.now(); }
  lightFire(o, p) {
    const g = this.game, cx = Math.floor(p.x / CHUNK), cy = Math.floor(p.y / CHUNK);
    g.lightFire(() => { const d = this.world.delta(cx, cy, true); (d.fire ||= {})[o.fireId] = Date.now() + FIRE_MS.campfire; this.world.touch(Math.floor(o.x / CHUNK), Math.floor(o.y / CHUNK)); this.world.touch(cx, cy); });
  }

  update(dt) {
    const g = this.game, p = g.player, L = g.live;
    if (!OLD && (!L?.joined || L.role === 'host')) { if (!this.places1) this.settle(); else if (!ART_OLD && this.unsettled) this.resettle(); else if (this.places1.b === undefined) this.bridgeSettle(); }
    if (L?.joined && L.guest) this.tellHost();
    if (g.scene !== this.world) return;
    // (the cells ahead, one at a time, so that none has to be worked out when the land is made)
    this.warmRoads(p);
    if (this.places1 && !(g.time - this.warmAt < WARM_EVERY)) { this.warmAt = g.time; if (!this.sites.warm(p.x, p.y, WARM_R) && !this.warmMore(p)) this.warmAt = g.time + 1; }
    this.look.update();
    updateResidents(this, Math.min(0.1, dt || 0));
    const near = this.poiNear(p.x, p.y, 12);
    if (near && !this.known(near)) {
      const again = this.oldFound.delete(near.key);
      this.found.add(near.key);
      if (again) this.found = new Set(this.found);   // (the maps count them: ui/blips.js)
      this.foundAt[near.key] = g.days?.realDay ?? Math.floor(Date.now() / 86400000);
      this.foundN = -1;
      // (the big places, a message in the middle; the rest, a line of the feed)
      const title = this.title(near), line = t('feed.discovered', { place: title });
      if (BIG_PLACES.has(near.kind)) hud.big({ title, sub: t('big.discovered'), kind: 'place', line }); else hud.toast(line, 'place');
      g.stats?.add('lugares', 1);
      this.look.visited(near);
      g.skills?.gain('explore', near.kind === 'aldea' ? 60 : 25);
    }
  }
  // The roads ahead: worked out in the ground worker (terrain.js askMap) and handed over; here, only their graph, a node at a time
  warmRoads(p) {
    const g = this.game, R = this.world.gen.roads, W = (this.roadsWarm ||= { at: 0, x: 1e9, y: 0, asked: false });
    if (!R || g.time - W.at < WARM_EVERY) return;
    W.at = g.time;
    if (W.asked) return;
    if (W.roads === R && Math.hypot(dxOf(p.x, W.x), p.y - W.y) < 90) { if (!W.done) W.done = !R.warm(W.x, W.y, ROADS_R, false); return; }
    const T = g.view3d?.terrain, x = p.x, y = p.y, done = () => { W.asked = W.done = false; W.roads = R; W.x = x; W.y = y; };
    if (!T?.workers?.length || T.gen !== this.world.gen) { if (!R.warm(x, y, ROADS_R)) done(); return; }
    W.asked = !!T.askMap('lines', this.world.gen, Math.floor(x / CHUNK), Math.floor(y / CHUNK), -1e6 + 8, { x, y, r: ROADS_R, have: [...R.lines.keys()] }, m => { W.asked = false; if (this.world?.gen.roads !== R || !m?.list) return; R.adopt(m.list, m.cells); done(); });
  }
  // (and then the landmarks, and what the hamlets ahead are laid out like: one thing at a time) false: nothing left to do
  warmMore(p) {
    if (this.places1?.r !== FORM) return false;
    if (!this.sites.hitos) { if (this.sites.hunt()) { this.version++; this.roadside.clear(); this.posts?.clear(); this.cache.clear(); this.plans.clear(); this.lvls?.clear(); this.described?.clear(); this.foundN = -1; const w = this.world; if (w?.merged) { w.merged.clear(); w.touches++; } } return true; }
    for (const s of this.sites.near(p.x, p.y, 420, ['aldea', 'templo', 'faro'])) { const q = this.poiOf(s.key); if (q?.form && q.kind === s.kind && !this.plans.has(q.key)) { this.planOf(q); return true; } }
    return false;
  }
  entities(scene) {
    if (scene !== this.world) return null;
    const p = this.game.player, poi = this.hamletNear(p.x, p.y, 25);
    if (poi?.form && (poi.kind === 'faro' || poi.hito === 'majada')) { const F = residentsOf(this, poi); return F ? F.filter(q => q.here) : null; }
    if (poi?.kind !== 'aldea') return null;
    if (!this.traders.has(poi.key)) {
      const r = k => ihash(poi.id, k, 1);
      const look = { sex: r(1) < 0.5 ? 'chico' : 'chica', skin: ['#f6c9a0', '#c98a5a', '#8a5234', '#e8b07a'][Math.floor(r(2) * 4)], hair: ['#2a1e1e', '#a8442a', '#e8c060', '#f0e6c8'][Math.floor(r(3) * 4)], eyes: '#3a2a1e', cloth: ['#b84a8a', '#2e8a8a', '#d8742a'][Math.floor(r(4) * 3)], pants: '#3a3a3a', hairStyle: ['corto', 'largo', 'mono'][Math.floor(r(5) * 3)], outfit: 'larga' };
      const L = this.planOf(poi), at = L ? L.trader : [poi.x, poi.y];
      this.traders.set(poi.key, new Person({ x: at[0], y: at[1], look }));
    }
    const who = this.traders.get(poi.key), folk = poi.form ? residentsOf(this, poi) : null;
    return folk ? [who, ...folk.filter(q => q.here)] : [who];
  }
  // What a hamlet's trader sells: by its trade (the farmers', what the trader always had)
  shopOf(poi) { const sp = poi.form && this.planOf(poi)?.specialty; return sp && sp !== 'farmers' ? `hamlet_${sp}` : 'viajero'; }
  openShop(poi) {
    // (each hamlet has its own prices, 15 % up or down)
    this.shopK = { id: this.shopOf(poi), k: poi.form ? 0.85 + ihash(poi.id, 41, 7177) * 0.3 : 1 };
    this.game.onShop?.(this.shopK.id);
  }
  // The price factor of the shop that is open (ui/shop.js)
  shopFactor(id) { return this.shopK?.id === id ? this.shopK.k : 1; }

  // The lighthouses people have built near (x, y): up to the gallery (or down), and the lamp
  ownLights(p, r) {
    const out = [], w = this.world;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const q of w.towersIn(Math.floor(p.x / CHUNK) + dx, Math.floor(p.y / CHUNK) + dy)) if (q.light && Math.hypot(p.x - q.x, p.y - q.y) < r) out.push(q);
    return out;
  }
  ownLightAction(q) {
    const act = this.lighthouseAction(q), w = this.world, [m, n] = FIRE_FUEL.lighthouse;
    if (!w.fireAt(q.tx, q.ty)) act.alt = { text: t('lighthouse.lamp', { n, item: ITEMS[m].name.toLowerCase() }), run: () => this.game.lightFire(() => { const d = w.delta(Math.floor(q.tx / CHUNK), Math.floor(q.ty / CHUNK), true); (d.fire ||= {})[`${q.tx},${q.ty}`] = Date.now() + FIRE_MS.lighthouse; w.touchAround(q.tx, q.ty); }, m, n) };
    return act;
  }
  // The hamlet (or any other place with people) near (x, y), or whatever place there is
  hamletNear(x, y, r) {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
    let other = null;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const p = this.poi(cx + dx, cy + dy); if (!p || Math.hypot(p.x - x, p.y - y) >= r + (p.form && p.kind === 'aldea' ? 24 : sizeOf(p))) continue; if (p.kind === 'aldea') return p; other ||= p; }
    return other;
  }
  // What there is to do with what a place of now has near (x, y): its fires, its mine, its hatch, its people
  formedAct(p, poi) {
    const L = this.planOf(poi), out = [];
    if (!L) return out;
    const near = (x, y, r) => Math.hypot(p.x - x, p.y - y) < r;
    if (L.mine && near(...L.mine, 2.4)) out.push({ x: L.mine[0], y: L.mine[1], hx: 0.9, hy: 0.9, h: 2, act: () => ({ text: t('place.mine.enter'), run: () => this.enterCave({ ...poi, kind: 'mina', x: L.mine[0], y: L.mine[1], mouth: L.props.find(o => o.m.startsWith('mine_mouth')) }, 1) }) });
    if (L.hatch && near(L.hatch[0], L.hatch[1], 2.6)) out.push({ x: L.hatch[0], y: L.hatch[1], hx: 0.85, hy: 0.85, h: 0.4, lift: L.lvl || 0, act: () => ({ text: t('place.temple.enter'), run: () => this.enterDungeon(poi) }) });
    if (poi.kind === 'faro' && L.chest && near(...L.chest, 1.6)) { const d = this.world.delta(Math.floor(poi.x / CHUNK), Math.floor(poi.y / CHUNK)), open = !!d?.opened?.[poi.key]; out.push({ x: L.chest[0], y: L.chest[1], hx: 0.45, hy: 0.45, h: 0.7, act: () => (open ? { text: t('place.chest.empty'), run: () => Audio.error() } : { text: t('place.chest.open'), run: () => this.openPoiChest(poi, this.world.delta(Math.floor(poi.x / CHUNK), Math.floor(poi.y / CHUNK), true)) }) }); }
    for (const list of L.objs.values()) for (const o of list) if (o.fireId && near(o.x, o.y, 2.6) && !o.decor.includes(':lit') && !this.fireLit(o.fireId, poi)) out.push({ x: o.x, y: o.y, hx: 0.5, hy: 0.5, h: o.decor.startsWith('brazier') ? 1.2 : 0.5, act: () => ({ text: t('fire.light'), run: () => this.lightFire(o, poi) }) });
    for (const who of residentsOf(this, poi) || []) if (who.here && near(who.x, who.y, 2.2)) out.push({ x: who.x, y: who.y, hx: 0.35, hy: 0.35, h: 1.6, who, act: () => ({ text: t('place.resident.talk', { name: who.name }), run: () => talkTo(this, poi, who) }) });
    return out;
  }
  interact(p, scene) {
    const g = this.game;
    if (scene === this.world) {
      for (const q of this.formedAround(Math.floor(p.x / CHUNK), Math.floor(p.y / CHUNK))) { const list = this.formedAct(p, q), who = this.traders.get(q.key); if (who && Math.hypot(p.x - who.x, p.y - who.y) < 1.6) list.push({ x: who.x, y: who.y, act: () => ({ text: t('place.trader.talk'), run: () => this.openShop(q) }) }); if (list.length) { list.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y)); return list[0].act(); } }
      for (const q of this.ownLights(p, 2.6)) return this.ownLightAction(q);
      const H = this.hamletNear(p.x, p.y, 2.2), poi = H?.kind === 'aldea' ? H : this.poiNear(p.x, p.y, 2.2);
      if (!poi) return null;
      if (poi.kind === 'cueva' && Math.hypot(p.x - poi.x, p.y - poi.y) < 2.2) return { text: t('place.cave.enter'), run: () => this.enterCave(poi, 1) };
      if (poi.kind === 'templo' && !poi.form && p.y > poi.y + 1.2 && Math.abs(p.x - poi.x) < 1.6) return { text: t('place.temple.enter'), run: () => this.enterDungeon(poi) };
      if (poi.kind === 'faro') return this.lighthouseAction(poi);
      if (poi.kind === 'aldea') {
        const who = this.traders.get(poi.key);
        if (who && Math.hypot(p.x - who.x, p.y - who.y) < 1.6) return { text: t('place.trader.talk'), run: () => this.openShop(poi) };
        return null;
      }
      const c = this.chestOf(poi);
      if (c && this.level(c, p) && Math.hypot(p.x - c.x, p.y - c.y) < 1.4) {
        const job = g.missions?.chestAct?.(poi);   // (a half of the strongbox's map in it: missions/strongbox.js)
        if (job) return job;
        const d = this.world.delta(Math.floor(poi.x / CHUNK), Math.floor(poi.y / CHUNK), true);
        if (d.opened?.[poi.key]) return { text: t('place.chest.empty'), run: () => Audio.error() };
        return { text: t('place.chest.open'), run: () => this.openPoiChest(poi, d) };
      }
      return null;
    }
    if (scene.kind !== 'grid') return null;
    for (const o of scene.live()) {
      if (!o.tile || Math.hypot(p.x - o.x, p.y - o.y) > 1.3) continue;
      const act = this.gridAction(scene, o, p);
      if (act) return act;
    }
    return null;
  }
  // Its chest, as it is in the world (it may be in the chunk beside), or undefined
  chestOf(poi) {
    const L = this.planOf(poi), [x, y] = L?.chest || [poi.x, poi.y];
    return this.world.contentFor(Math.floor(x / CHUNK), Math.floor(y / CHUNK)).objects.find(o => o.treasure && o.treasure.key === poi.key) || this.world.contentFor(Math.floor(poi.x / CHUNK), Math.floor(poi.y / CHUNK)).objects.find(o => o.treasure);
  }
  // Lo que se hace con algo de una cueva o de un templo (o null)
  gridAction(scene, o, p) {
    if (o.ladder === 'up') return { text: scene.depth > 1 ? t('cave.up', { n: scene.depth - 1 }) : t('cave.out'), run: () => this.climb(scene, -1) };
    if (o.ladder === 'down') return { text: t('cave.down', { n: scene.depth + 1 }), run: () => this.climb(scene, 1) };
    if (o.chest) return scene.state.opened[o.key] ? null : { text: t('place.chest.open'), run: () => this.openGridChest(scene, o) };
    if (o.lever !== undefined) return { text: t('temple.lever'), run: () => { scene.state.flags['g' + o.lever] = true; scene.touched(); Audio.clink(); hud.toast(t('temple.gate_heard')); } };
    if (o.gate !== undefined && !o.open && o.lock) {
      if (scene.state.flags['k' + o.gate]) return { text: t('temple.gate_key'), run: () => { scene.state.flags['g' + o.gate] = true; scene.touched(); Audio.unlock(); } };
      return { text: t('temple.gate_locked'), run: () => Audio.error() };
    }
    if (o.gate !== undefined && !o.open) return { text: t('temple.gate_shut'), run: () => Audio.error() };
    if (o.block) {
      const dx = o.x - p.x, dy = o.y - p.y, [mx, my] = Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)];
      return { text: t('temple.block'), run: () => { if (scene.push(o, mx, my)) { Audio.place(); if (scene.state.flags['g' + o.block.room]) hud.toast(t('temple.gate_click')); } else Audio.error(); } };
    }
    return null;
  }
  // Lo que se puede apuntar con el cursor: la entrada de lo que haya cerca, y lo de dentro
  aimables(p, scene, box) {
    const g = this.game, out = [];
    if (scene === this.world) {
      for (const q of this.formedAround(Math.floor(p.x / CHUNK), Math.floor(p.y / CHUNK))) for (const a of this.formedAct(p, q)) out.push({ kind: 'sys', e: a.who || null, box: box(a.x, a.y, a.hx, a.hy, 0, a.who ? g.view3d?.personHeight?.(a.who, 1.6) ?? 1.6 : a.h), act: a.act });
      for (const q of this.ownLights(p, 4)) { if (p.tower?.gallery && p.floor > 4) out.push({ kind: 'sys', e: null, box: box(q.x, q.y + 1.14, 0.42, 0.4, GALLERY.H - 0.06, GALLERY.H + 0.16), act: () => this.ownLightAction(q) }); else out.push({ kind: 'sys', e: null, box: box(q.x, q.y, 1.2, 1.2, 0, 4), act: () => this.ownLightAction(q) }); }
      const H = this.hamletNear(p.x, p.y, 4), poi = H?.kind === 'aldea' ? H : this.poiNear(p.x, p.y, 4);
      if (!poi) return out.length ? out : null;
      // (shape: the model it draws, for the outline and, with exact, for the aim; see game.js aimTargets)
      const add = (x, y, hx, hy, h, act, e, shape) => out.push({ kind: 'sys', e, box: box(x, y, hx, hy, 0, h), act, ...shape });
      const model = { name: poiModel(poi), x: poi.x, y: poi.y, yaw: poi.yaw || 0, lift: poi.z || 0 };
      if (poi.kind === 'cueva') add(poi.x, poi.y, 1.1, 1.1, 1.5, () => ({ text: t('place.cave.enter'), run: () => this.enterCave(poi, 1) }), null, { model, exact: true });
      // (the temple is entered by its door: that is what is aimed at, and the outline is the temple)
      else if (poi.kind === 'templo') { if (!poi.form) add(poi.x, poi.y + 1.2, 0.9, 0.25, 2, () => ({ text: t('place.temple.enter'), run: () => this.enterDungeon(poi) }), null, { model, keepBox: true }); }
      else if (poi.kind === 'faro') {
        // (from below, its door and its walls; on the gallery, the hatch)
        if (p.tower?.gallery && p.floor > 4) out.push({ kind: 'sys', e: null, box: box(poi.x, poi.y + 1.14, 0.42, 0.4, GALLERY.H - 0.06, GALLERY.H + 0.16), act: () => this.lighthouseAction(poi) });
        else add(poi.x, poi.y, 1, 1, 4, () => this.lighthouseAction(poi), null, { model, exact: true });
      }
      else if (poi.kind === 'aldea') { const who = this.traders.get(poi.key); if (who) add(who.x, who.y, 0.35, 0.35, g.view3d?.personHeight?.(who, 1.5) ?? 1.5, () => ({ text: t('place.trader.talk'), run: () => this.openShop(poi) }), who); }
      else {
        const c = this.chestOf(poi);
        if (c && this.level(c, p)) out.push({ kind: 'sys', e: null, box: box(c.x, c.y, 0.45, 0.45, c.up || 0, (c.up || 0) + 0.7), model: { name: `treasure:${c.open ? 1 : 0}`, x: c.x, y: c.y, yaw: c.yaw || 0, lift: (poi.z || 0) + (c.up || 0) }, exact: true, act: () => {
          const job = g.missions?.chestAct?.(poi);   // (a half of the strongbox's map in it: missions/strongbox.js)
          if (job) return job;
          const d = this.world.delta(Math.floor(poi.x / CHUNK), Math.floor(poi.y / CHUNK), true);
          return d.opened?.[poi.key] ? { text: t('place.chest.empty'), run: () => Audio.error() } : { text: t('place.chest.open'), run: () => this.openPoiChest(poi, d) };
        } });
      }
      return out;
    }
    if (scene.kind !== 'grid') return null;
    for (const o of scene.live()) {
      if (!o.tile || Math.abs(o.x - p.x) > 4 || Math.abs(o.y - p.y) > 4 || !this.gridAction(scene, o, p)) continue;
      out.push({ kind: 'sys', grid: o.tile, box: box(o.x, o.y, 0.48, 0.48, 0, o.ladder ? 2 : o.gate !== undefined ? 1.8 : 1), act: () => this.gridAction(scene, o, g.player) });   // (grid: its outline is what the cave draws on that tile)
    }
    return out;
  }

  // (pushing the wheelbarrow, no: park it first. A big thing in the arms goes down with you, as before: carry.js refuse)
  async enterCave(poi, depth) {
    if (this.game.carry?.refuse('cave')) return;
    const g = this.game, sc = makeCave(g, poi.id, depth, poi.snow);
    const M = poi.mouth, a = M?.yaw || 0;
    sc.exitTo = M ? { x: M.x + Math.sin(a) * 2.2, y: M.y + Math.cos(a) * 2.2 } : { x: poi.x, y: poi.y + 2.2 };
    g.combat.spawn(sc);
    this.current = poi;
    await g.goTo(sc, sc.entry.x, sc.entry.y);
    this.deeper(depth);
  }
  // (a level never reached before is exploring)
  deeper(depth) {
    const g = this.game;
    if (depth > (g.stats?.get('profundidad') || 0)) g.skills?.gain('explore', 15);
    g.stats?.max('profundidad', depth);
  }
  async enterDungeon(poi) {
    if (this.game.carry?.refuse('cave')) return;
    const g = this.game, sc = makeDungeon(g, poi.id);
    const H = this.planOf(poi)?.hatch;
    sc.exitTo = H ? { x: H[0], y: H[1] + 1.7 } : { x: poi.x, y: poi.y + 2.4 };
    sc.depth = 1;
    g.combat.spawn(sc);
    this.current = poi;
    await g.goTo(sc, sc.entry.x, sc.entry.y);
  }
  // Las escaleras de mano de una cueva (dir 1, bajar un nivel; -1, subir) y la salida del templo (su nivel es el 1).
  // (el del faro es climbLighthouse: con el mismo nombre, el de abajo tapaba a este y no se bajaba ni se salía)
  async climb(scene, dir) {
    const g = this.game;
    if (g.carry?.refuse('cave')) return;
    if (dir < 0 && scene.depth <= 1) { await g.goTo(this.world, scene.exitTo.x, scene.exitTo.y, { inside: false }); g.onSave?.(); return; }
    const sc = makeCave(g, scene.caveId, scene.depth + dir, scene.style === 'ice');
    sc.exitTo = scene.exitTo;
    g.combat.spawn(sc);
    const at = dir > 0 ? sc.entry : sc.fromBelow;
    await g.goTo(sc, at.x, at.y);
    this.deeper(sc.depth);
    hud.toast(t('cave.level', { title: this.current?.kind === 'cueva' ? this.title(this.current) : placeKind('cueva'), n: sc.depth }));
  }

  // Botín de los cofres
  loot(table) {
    const g = this.game, r = Math.random, out = [];
    if (table === 'templo') {
      out.push(['lingote_oro', 3], ['rubi', 1], ['esmeralda', 1], ['moneda_antigua', 3]);
      if (r() < 0.35) out.push(['espada_oro', 1]);
      g.addMoney(500);
    } else if (table === 'campamento') {
      // (what travellers leave for the next one)
      out.push(['pan', 1 + Math.floor(r() * 2)], ['cuerda', 1 + Math.floor(r() * 2)], ['antorcha', 2 + Math.floor(r() * 3)]);
      g.addMoney(30 + Math.floor(r() * 60));
    } else if (table === 'barco') {
      out.push(['tela', 1 + Math.floor(r() * 2)], ['cuerda', 2 + Math.floor(r() * 2)], ...(r() < 0.5 ? [['moneda_antigua', 1]] : []));
      g.addMoney(40 + Math.floor(r() * 100));
    } else if (table === 'faro') {
      out.push(['cuerda', 2], ['sardina', 1 + Math.floor(r() * 2)], ['carbon', 2 + Math.floor(r() * 3)]);
      g.addMoney(40 + Math.floor(r() * 80));
    } else if (table === 'torre') {
      // (what a watchman keeps: light, coal and what he was paid)
      out.push(['antorcha', 4 + Math.floor(r() * 4)], ['carbon', 3 + Math.floor(r() * 4)], ['moneda_antigua', 1 + Math.floor(r() * 2)]);
      g.addMoney(60 + Math.floor(r() * 140));
    } else if (typeof table === 'number') {
      const pool = [['carbon', 4], ['lingote_cobre', 2], ['pocion', 1], ['moneda_antigua', 1], ['antorcha', 5], ...(table >= 3 ? [['lingote_hierro', 2], ['amatista', 1]] : []), ...(table >= 6 ? [['lingote_oro', 1], ['rubi', 1]] : [])];
      for (let i = 0; i < 3; i++) out.push(pool[Math.floor(r() * pool.length)]);
      g.addMoney(20 + table * 15);
    } else {
      const pool = [['moneda_antigua', 1], ['pocion', 1], ['semilla_manzano', 1], ['lingote_hierro', 1], ['antorcha', 4], ['tela', 2], ['fosil_concha', 1]];
      for (let i = 0; i < 2; i++) out.push(pool[Math.floor(r() * pool.length)]);
      g.addMoney(60 + Math.floor(r() * 140));
    }
    for (const [id, n] of out) { const left = g.inv.add(id, n); if (left) g.gather.throwOut(id, left); }
    Audio.unlock();
    g.stats?.add('cofres', 1);
    return out;
  }
  async openPoiChest(poi, d) {
    d.opened ||= {};
    d.opened[poi.key] = true;
    this.world.touchAround(Math.floor(poi.x), Math.floor(poi.y));
    this.world.touch(Math.floor(poi.x / CHUNK), Math.floor(poi.y / CHUNK));
    const got = this.loot(poi.kind);
    await this.showLoot(got);
    await this.game.story?.found(poi.kind);
  }
  async openGridChest(scene, o) {
    scene.state.opened[o.key] = true;
    scene.touched();
    if (o.keyFor !== undefined) { scene.state.flags['k' + o.keyFor] = true; hud.toast(t('temple.key')); Audio.unlock(); return; }
    const got = this.loot(o.loot);
    await this.showLoot(got);
    if (o.loot === 'templo') await this.game.story?.found('templo');
  }
  async showLoot(got) {
    const g = this.game;
    g.busy = true;
    await hud.say(t('place.chest.title'), [t('place.chest.in', { list: fmt.list(got.map(([id, n]) => countOf(id, n))) })]);
    g.busy = false;
  }

  // ---------- Vehículos ----------
  target(p, held, def) {
    const g = this.game;
    if (g.scene !== this.world) return null;
    if (def?.vehicle === 'barca') {
      // (ya no se lleva en la mano: construyéndola con B, dónde se amarra: en el agua, cerca, donde apunta el ratón)
      if (!g.build.on) return null;
      const mp = g.mousePoint?.(), pt = mp || [p.x + p.face.x * 1.6, p.y + p.face.y * 1.6];
      // (en un canal cavado, solo si cabe: ver scenes.js, boatFits)
      const wet = !!this.world.water(pt[0], pt[1]), fits = !wet || this.world.boatFits(pt[0], pt[1]), far = Math.hypot(pt[0] - p.x, pt[1] - p.y) > 5, taken = this.world.boatsNear(pt[0], pt[1], 1.8).length > 0;
      return { tile: [Math.floor(pt[0]), Math.floor(pt[1])], moor: [pt[0], pt[1], g.gather.angle || 0], place: 'barca', ok: wet && fits && !far && !taken && !p.boat && !p.aboard, far, why: !wet ? t('place.boat.water') : !fits ? t('place.boat.fits') : taken ? t('place.boat.taken') : '' };
    }
    if (def?.vehicle === 'caballo' && !p.boat && !p.aboard) return g.ranch.whistle(p);   // (el caballo es un animal de verdad: ver la granja)
    return null;
  }
  // Is the chest c at the height of p? (that of a tower is up on its terrace)
  level(c, p) { return Math.abs((p.z || 0) - (c.up || 0)) < 1.5; }
  // A lighthouse: up to the gallery, or down from it (the stairs inside are too narrow to walk: a fade). What one sees from up
  // there, lookout.js
  lighthouseAction(poi) {
    const p = this.game.player, up = !!p.tower?.gallery && p.floor > 4;
    return up ? { text: t('place.lighthouse.down'), run: () => this.climbLighthouse(poi, false) } : { text: t('place.lighthouse.up'), run: () => this.climbLighthouse(poi) };
  }
  async climbLighthouse(poi, up = true) {
    const g = this.game, p = g.player;
    if (g.carry?.refuse('cave')) return;
    if (p.mount) { hud.toast(t('place.lighthouse.afoot')); Audio.error(); return; }
    g.busy = true;
    p.stop?.();
    Audio.door();
    await hud.fade(true);
    Object.assign(p, { x: poi.x, y: poi.y + (up ? 1.16 : 2.3), z: up ? GALLERY.H : 0, floor: up ? GALLERY.H : 0, vz: 0, vx: 0, vy: 0 });
    g.view3d?.snap?.();
    await hud.fade(false);
    g.busy = false;
  }
  // Marcas para el mapa: lugares descubiertos
  markers() { return this.knownPlaces().map(p => ({ x: p.x, y: p.y, kind: p.kind, key: p.key, name: this.title(p), legend: placeKind(p.kind) })); }
}
