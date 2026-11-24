// Exploring: the places the world has (cave mouths, camps, watchtowers, beached boats, temples, lighthouses on some coasts
// and far hamlets), their chests, the caves and dungeons they lead to, and the vehicles (boat and horse). Where each one
// goes and what it is called is decided elsewhere: world/sites.js (few, each on its spot), world/names.js (its name, its
// state and its history) and world/frozenplaces.js (what an old world keeps as it was).
import { ihash } from './util.js';
import { CHUNK } from './world/gen.js';
import { towerColliders, lighthouseColliders, chestSpot, poiModel, TOWER, GALLERY } from './world/tower.js';
import { wrapIndex } from './world/planet.js';
import { Lookout } from './lookout.js';
import { houseBlueprint, houseSize, byChunk } from './world/blueprints.js';
import { makeCave, makeDungeon } from './world/underground.js';
import { sitesFor, LegacyPlaces, hamletSlots, READY, SITE_SIZE as SIZE } from './world/sites.js';
import { nameOf, stateOf, storyOf } from './world/names.js';
import { freeze, freezeMore, readPlaces, nearFrozen, kindOf, boxOf, gap, NEAR_FROZEN } from './world/frozenplaces.js';
import { Person } from './entities.js';
import { SHOPS } from './economy.js';
import { countOf } from './talktopics.js';
import { Audio } from './audio.js';
import { apagada } from './opciones.js';
import { hud } from './ui/hud.js';
import { t, fmt } from './i18n.js';

const AROUND = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
const BIG_PLACES = new Set(['aldea', 'torre', 'cueva', 'templo', 'faro']);
const WARM_R = 520, WARM_EVERY = 0.12;   // the sites are worked out this far ahead, a cell at a time (and how often)
const FOUND_MAX = 1500;                  // (how many places found before a guest tells its host)
const OLD = apagada('sitios');           // (?sitios=1: the places of before, to compare)
SHOPS.viajero = { get title() { return t('shop.title.viajero'); }, hours: [7, 21], stock: [{ id: 'semilla_manzano', price: 90 }, { id: 'pocion', price: 120 }, { id: 'espada', price: 380 }, { plan: 'barca', price: 500 }, { id: 'caballo', price: 2600 }, { id: 'lingote_oro', price: 300 }, { id: 'semilla_calabaza', price: 60 }] };
// What a kind of place is called, whichever it is («Cave»)
export const placeKind = kind => t(`place.kind.${kind}`);

export class Explore {
  constructor(game) {
    this.game = game;
    this.cache = new Map();      // "cx,cy" → the place there, a bare clearing ({ pad: true }) or null
    this.layer = { add: (cx, cy, d, out) => this.addContent(cx, cy, d, out), hides: o => this.hides(o), pad: (x, y) => this.padDist(x, y), padTo: (x, y, h, curve) => this.padTo(x, y, h, curve), padSig: () => this.version, padNear: (x0, y0, x1, y1) => this.padNear(x0, y0, x1, y1), blocks: (tx, ty) => this.blocks(tx, ty), baseAt: (layer, tx, ty) => this.baseAt(layer, tx, ty) };
    this.traders = new Map();
    this.aldeas = new Map();     // planos de piezas de las casas de cada aldea
    this.found = new Set();      // lugares descubiertos (para el mapa y los logros)
    this.oldFound = new Set();   // those of them found when the places were others (a place of now in that chunk is another)
    this.foundAt = {};           // key → the real day it was found
    this.places1 = null;         // what an old world keeps (frozenplaces.js), or null: not known yet (the places of before, meanwhile)
    this.marks = {};
    this.version = 0; this.warmAt = 0;
    this.look = new Lookout(this);   // (looking from above, and what is spotted: lookout.js)
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
    if (!this.places1 && save.places1 !== 0) this.settle();
    if (!this.world.layers.includes(this.layer)) this.world.layers.push(this.layer);
  }
  save(out) {
    out.found = [...this.found]; out.placesV = 2; out.foundAt = this.foundAt;
    if (this.oldFound.size) out.oldFound = [...this.oldFound];
    if (this.places1) out.places1 = this.places1;
    this.look.save(out);
  }

  // ---------- what the world keeps of before ----------
  setPlaces(v) {
    this.places1 = v; this.marks = v?.k || {};
    this.version++;
    this.cache.clear(); this.aldeas.clear(); this.traders.clear(); this.described?.clear();
    this.found = new Set(this.found);   // (so that the maps make their list again: ui/blips.js)
    this.foundN = -1;
    const w = this.world;
    if (w?.merged) { w.merged.clear(); w.touches++; }   // (what is drawn of each chunk, and the ground round the places)
  }
  // Whoever runs the world (or plays alone) writes the list of an old world, once. A guest waits for the host's
  settle() {
    if (OLD || this.places1) return;
    const { x, y, spawn, animals } = this.start || {}, at = Array.isArray(spawn) ? spawn : [spawn?.x, spawn?.y];
    const points = [[x, y], at, ...(Array.isArray(animals) ? animals : []).map(a => [a?.x, a?.y])];
    this.setPlaces(freeze({ sites: this.sites, legacy: this.legacy, deltas: this.world.deltas, found: this.oldFound, points }));
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
      else if (kind !== '-') { const s = this.sites.at(cx, cy); if (s && READY.has(s.kind) && !nearFrozen(s, this.marks, this.legacy)) p = s; }
    }
    if (p?.kind === 'ruinas') p = { ...p, pad: true };
    // (a lighthouse left behind is not lit; those of before, always, as they were)
    if (p?.kind === 'faro' && !p.legacy) p = { ...p, lit: stateOf(p) !== 'empty' };
    if (this.cache.size > 30000) this.cache.clear();
    this.cache.set(k, p);
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
    const s = this.sites.nearest(x, y, kinds.filter(q => READY.has(q)), bd, skip, q => { const p = this.poiOf(q.key); return !!p && !p.legacy && p.kind === q.kind; });
    return s || best;
  }
  // ---------- who they are ----------
  nameOf(p) { return nameOf(p); }
  title(p) { return t(`place.title.${p.kind}`, { name: nameOf(p) }); }
  // { title, kind, state (its name, or null), story, at (the real day, or undefined) }: for the journal and the maps
  describe(p) {
    const C = (this.described ||= new Map());
    let q = C.get(p.key);
    if (!q) {
      const h = p.kind === 'aldea' ? null : this.nearest(p.x, p.y, ['aldea'], 1500), d = h ? Math.hypot(h.x - p.x, h.y - p.y) : Infinity;
      C.set(p.key, (q = { state: stateOf(p, d), ...storyOf(p, h && nameOf(h)) }));
    }
    const story = t(`place.story.${p.kind}.${q.line}`, { year: String(q.year), name: nameOf(p), builder: t(`place.builder.${q.builder}`, { name: q.hamlet || '' }) });
    return { title: this.title(p), kind: placeKind(p.kind), state: q.state && t(`place.state.${q.state}`), story, at: this.foundAt[p.key] };
  }
  aldeaSlots(cx, cy) { return hamletSlots(cx, cy, (x, y) => !!this.world.natWater(x, y)); }   // (la del mundo: los lugares no cambian con lo cavado)
  // La aldea cuyas casas llegan a este trozo (la del propio trozo o la de uno de al lado)
  aldeasAround(cx, cy) {
    const out = [];
    for (const [dx, dy] of [[0, 0], ...AROUND]) { const p = this.poi(cx + dx, cy + dy); if (p?.kind === 'aldea') out.push(p); }
    return out;
  }
  // ¿Cae esta casilla en la zona de una aldea (sus casas y un margen)?
  inAldea(x, y, m) {
    return this.aldeasAround(Math.floor(x / CHUNK), Math.floor(y / CHUNK)).some(p => { const [x0, y0, x1, y1] = this.aldea(p).box; return x > x0 - m && x < x1 + m && y > y0 - m && y < y1 + m; });
  }
  // Lugar cerca de un punto del mundo
  poiNear(x, y, r) {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const p = this.poi(cx + dx, cy + dy); if (p && Math.hypot(p.x - x, p.y - y) < r + SIZE[p.kind]) return p; }
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
      else { const r = SIZE[p.kind] || 2; if (Math.max(0, x0 - p.x, p.x - x1) <= r && Math.max(0, y0 - p.y, p.y - y1) <= r) return true; }
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
      else if (!p.z) best = Math.min(best, Math.max(0, Math.hypot(x - p.x, y - p.y) - (SIZE[p.kind] || 2)));
    }
    return best;
  }
  // The ground (h, as it is) next to the places that stand at their own height (p.z): flat there, and back to its own
  // height round them. curve(d): from 0 (flat) to 1 (as it is), at d from the place (scenes.js)
  padTo(x, y, h, curve) {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const p = this.entry(cx + dx, cy + dy);
      if (p && p.z) { const k = curve(Math.max(0, Math.hypot(x - p.x, y - p.y) - (SIZE[p.kind] || 2))); if (k < 1) h = p.z + (h - p.z) * k; }
    }
    return h;
  }
  hides(o) {
    if (!o.kind) return false;
    if (this.inAldea(o.x, o.y, 1.5)) return true;
    const p = this.entry(Math.floor(o.x / CHUNK), Math.floor(o.y / CHUNK));
    // (entry: the clearing where ruins were has no trees either: something is built there)
    return !!p && p.kind !== 'aldea' && Math.hypot(o.x - p.x, o.y - p.y) < SIZE[p.kind] + 1.5;
  }
  blocks(tx, ty) {
    const p = this.poi(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK));
    return !!p && p.kind !== 'aldea' && Math.hypot(tx + 0.5 - p.x, ty + 0.5 - p.y) < SIZE[p.kind] + 1;   // (en las aldeas se puede construir: sus casas también se deshacen)
  }
  // Las casas de una aldea: dos o tres planos de piezas (como las del pueblo) alrededor de una plaza, donde está
  // el mercader. Llegan a los trozos de al lado. box: lo que ocupan [x0, y0, x1, y1].
  aldea(p) {
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
        if (p.kind !== 'aldea') { const r = SIZE[p.kind] + 1.5; this.foundBoxes.push([p.x - r, p.y - r, p.x + r, p.y + r]); continue; }
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
    for (const p of this.aldeasAround(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK))) { const v = this.aldea(p).all[layer]?.[`${tx},${ty}`]; if (v) return v; }
    return undefined;
  }

  addContent(cx, cy, d, out) {
    // Las casas de las aldeas que llegan a este trozo; sus ventanas dan luz por sí mismas
    for (const q of this.aldeasAround(cx, cy)) { const a = this.aldea(q).chunks[`${cx},${cy}`]; if (a) this.world.addBuilt(a, out, true); }
    const p = this.poi(cx, cy);
    if (!p || p.kind === 'aldea') return;
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

  update() {
    const g = this.game, p = g.player, L = g.live;
    if (!this.places1 && !OLD && (!L?.joined || L.role === 'host')) this.settle();
    if (L?.joined && L.guest) this.tellHost();
    if (g.scene !== this.world) return;
    // (the cells ahead, one at a time, so that none has to be worked out when the land is made)
    if (this.places1 && !(g.time - this.warmAt < WARM_EVERY)) { this.warmAt = g.time; if (!this.sites.warm(p.x, p.y, WARM_R)) this.warmAt = g.time + 1; }
    this.look.update();
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
  entities(scene) {
    if (scene !== this.world) return null;
    const p = this.game.player, poi = this.poiNear(p.x, p.y, 25);
    if (poi?.kind !== 'aldea') return null;
    if (!this.traders.has(poi.key)) {
      const r = k => ihash(poi.id, k, 1);
      const look = { sex: r(1) < 0.5 ? 'chico' : 'chica', skin: ['#f6c9a0', '#c98a5a', '#8a5234', '#e8b07a'][Math.floor(r(2) * 4)], hair: ['#2a1e1e', '#a8442a', '#e8c060', '#f0e6c8'][Math.floor(r(3) * 4)], eyes: '#3a2a1e', cloth: ['#b84a8a', '#2e8a8a', '#d8742a'][Math.floor(r(4) * 3)], pants: '#3a3a3a', hairStyle: ['corto', 'largo', 'mono'][Math.floor(r(5) * 3)], outfit: 'larga' };
      this.traders.set(poi.key, new Person({ x: poi.x, y: poi.y, look }));
    }
    return [this.traders.get(poi.key)];
  }

  interact(p, scene) {
    const g = this.game;
    if (scene === this.world) {
      const poi = this.poiNear(p.x, p.y, 2.2);
      if (!poi) return null;
      if (poi.kind === 'cueva' && Math.hypot(p.x - poi.x, p.y - poi.y) < 2.2) return { text: t('place.cave.enter'), run: () => this.enterCave(poi, 1) };
      if (poi.kind === 'templo' && p.y > poi.y + 1.2 && Math.abs(p.x - poi.x) < 1.6) return { text: t('place.temple.enter'), run: () => this.enterDungeon(poi) };
      if (poi.kind === 'faro') return this.lighthouseAction(poi);
      if (poi.kind === 'aldea') {
        const who = this.traders.get(poi.key);
        if (who && Math.hypot(p.x - who.x, p.y - who.y) < 1.6) return { text: t('place.trader.talk'), run: () => g.onShop?.('viajero') };
        return null;
      }
      const c = this.world.contentFor(Math.floor(poi.x / CHUNK), Math.floor(poi.y / CHUNK)).objects.find(o => o.treasure);
      if (c && this.level(c, p) && Math.hypot(p.x - c.x, p.y - c.y) < 1.4) {
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
      const poi = this.poiNear(p.x, p.y, 4);
      if (!poi) return null;
      // (shape: the model it draws, for the outline and, with exact, for the aim; see game.js aimTargets)
      const add = (x, y, hx, hy, h, act, e, shape) => out.push({ kind: 'sys', e, box: box(x, y, hx, hy, 0, h), act, ...shape });
      const model = { name: poiModel(poi), x: poi.x, y: poi.y, yaw: poi.yaw || 0, lift: poi.z || 0 };
      if (poi.kind === 'cueva') add(poi.x, poi.y, 1.1, 1.1, 1.5, () => ({ text: t('place.cave.enter'), run: () => this.enterCave(poi, 1) }), null, { model, exact: true });
      // (the temple is entered by its door: that is what is aimed at, and the outline is the temple)
      else if (poi.kind === 'templo') add(poi.x, poi.y + 1.2, 0.9, 0.25, 2, () => ({ text: t('place.temple.enter'), run: () => this.enterDungeon(poi) }), null, { model, keepBox: true });
      else if (poi.kind === 'faro') {
        // (from below, its door and its walls; on the gallery, the hatch)
        if (p.tower?.gallery && p.floor > 4) out.push({ kind: 'sys', e: null, box: box(poi.x, poi.y + 1.14, 0.42, 0.4, GALLERY.H - 0.06, GALLERY.H + 0.16), act: () => this.lighthouseAction(poi) });
        else add(poi.x, poi.y, 1, 1, 4, () => this.lighthouseAction(poi), null, { model, exact: true });
      }
      else if (poi.kind === 'aldea') { const who = this.traders.get(poi.key); if (who) add(who.x, who.y, 0.35, 0.35, g.view3d?.personHeight?.(who, 1.5) ?? 1.5, () => ({ text: t('place.trader.talk'), run: () => g.onShop?.('viajero') }), who); }
      else {
        const c = this.world.contentFor(Math.floor(poi.x / CHUNK), Math.floor(poi.y / CHUNK)).objects.find(o => o.treasure);
        if (c && this.level(c, p)) out.push({ kind: 'sys', e: null, box: box(c.x, c.y, 0.45, 0.45, c.up || 0, (c.up || 0) + 0.7), model: { name: `treasure:${c.open ? 1 : 0}`, x: c.x, y: c.y, yaw: c.yaw || 0, lift: (poi.z || 0) + (c.up || 0) }, exact: true, act: () => {
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
    sc.exitTo = { x: poi.x, y: poi.y + 2.2 };
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
    sc.exitTo = { x: poi.x, y: poi.y + 2.4 };
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
