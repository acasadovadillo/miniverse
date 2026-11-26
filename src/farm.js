// Huerto: sembrar en tierra labrada, regar (o que llueva), abonar y cosechar. También se plantan árboles con bellotas, piñas,
// semillas de manzano o los plantones de Rosa; los frutales dan fruta en su época y las palmeras, cocos, cada pocos días (se
// cogen con E).
//
// What makes a crop grow is the weather of its field (fieldclimate.js) and the water in its soil, not the calendar: every
// morning (onDay, only in the game that runs the world) each crop grows by how good the day before was for it (cropdata.js),
// the soil dries with the sun, and frost and drought can kill. On a morning after a day nobody played in this world they
// only wilt, and what is ripe does not spoil. Design: docs/planes/realismo/PLAN-R2-huerto.md. What a chunk keeps:
//   d.tilled[k], d.wet[k]   the bed and the last day it was watered (as always: older games read them)
//   d.moist[k]              how much water the soil holds, 0..100 (missing: as if just watered, if it was; see moistOf)
//   d.mulch[k]              the day straw was spread on it
//   d.soil[k]               its fertility and what grew on it (soil.js: harvests take from it, manure and compost give back)
//   d.cover[k]              'cloche': the glass bell on it; and what has a glass roof over it: greenhouse.js
//   d.weeds[k], d.shoo, d.garb[k], d.pkt[key]   weeds and pests (pests.js); on a crop, pk, pd and pb
//   d.crops[k]              { id, grow, day, fert?, dead?: true | 'frost' | 'drought' | 'rot' | 'eaten', hs, hn (its health: the sum
//                           and how many days), dry (mornings in a row without water), wt (days a seed has waited), ripe
//                           (the day it ripened), bolt (the day it went to seed), fb (the day frost bit it), leg (the first
//                           morning of one planted before the weather decided), picks (how many times a plant that gives
//                           again has given), fert (from before the soil counted: it grows faster until its harvest) }
// The orchard (orchard.js, phase R2-E) follows the calendar of the place: blossom in spring, a window for the fruit, and a
// frost on the blossom costs that year's. d.trees[k] { kind, day, from? (the days until its first fruit; missing: planted
// before, it bears at once) }, d.picked[key] the day it was last shaken, d.frostYear[key] the year (its last spring's) the
// blossom of a planted tree burnt. A wild tree keeps no mark: its place and the weather of those days say it (blossomFrost).
// ranch.farm.pests, the same for the weeds and the pests (pests.js, PEST.grace).
// ranch.farm.orchard: the day the calendar began to count in this world (-99: always did), FRUIT_GRACE
import { CROPS, HARVEST, ITEMS, GRASS_DROPS, itemNoun, thingNoun } from './items.js';
import { Pests, WEEDS, PEST, weedStage, weedKind, weedYaw } from './pests.js';
import { THIRST_MAX } from './needs.js';
import { t, fmt, getLang } from './i18n.js';
import { CHUNK } from './world/gen.js';
import { B } from './world/biomes.js';
import { inBounds, isGrass, pondDist } from './world/village.js';
import { Audio } from './audio.js';
import { parsePlaced } from './pieces.js';
import { canopyOf, broadDims, palmDims, ageOf } from './world/treedims.js';
import { climate } from './world/biomes.js';
import { seasonOf, WEATHER } from './time.js';
import { fieldDay, seasonAt } from './fieldclimate.js';
import { FRUIT, ORCHARD, TREE_DAYS, FIRST_FRUIT, FRUIT_EVERY, BLOSSOM_FROST, FRUIT_GRACE, phaseAt, nextFruit, youngK } from './orchard.js';
import { GROW, WATER, DRY, SNOW_WATER, MULCH_DAYS, MULCH_FROST, SEED_WAIT, GRACE, OLD_RIPE, OLD_RATE, FROST_LOOK, BOLT_SEEDS, seedOf, rateAt, waterAt, dryingAt, yieldAt, qualityOf } from './cropdata.js';
import { GreenRooms, GLASS, BELL, CLOCHE, bellSize, GLASS_ROOF, NONE, OPEN, AIRED, SHUT, glassDay } from './greenhouse.js';
import { SOIL, FOOD, OLD_FERT, OLD_FERT_RATE, FAMILY_TIRED, TIRED_HEALTH, RICH_MORE, BEES, SOIL_MAX, soilStart, fertAt, takesFrom, clampSoil, soilWord, soilTone } from './soil.js';
import { dxOf, latOf } from './world/planet.js';
import { Profile } from './accounts.js';
import { hud } from './ui/hud.js';

export const CAN_MAX = 20;
const key = (tx, ty) => `${tx},${ty}`;
const TICK = 5;                   // s between two looks at the clock (who plays today, the frost warning)
const WARN_FROM = 17, WARN_TO = 23, WARN_R = 64;   // the frost warning: between these hours, for the tender crops this near
const NEWS_FROM = 6, NEWS_EVERY = 60, PULL = [0.6, 0.35];   // the garden's morning news: from this hour, looked for every so many s; s to pull the weeds of a tile, by hand or with the hoe
const MULCH = new Set(['straw', 'heno']);
// (the family a soil can be tired of, as it is said)
const FAMILIES = new Map([['brassica', 'farm.family.brassica'], ['root', 'farm.family.root'], ['nightshade', 'farm.family.nightshade'], ['grass', 'farm.family.grass'], ['cucurbit', 'farm.family.cucurbit'], ['allium', 'farm.family.allium'], ['legume', 'farm.family.legume'], ['berry', 'farm.family.berry']]);
const ALMANAC = { now: 0, glass_only: 1, wait: 2, no: 2, tonight: 2 };   // (the order of the crops in the diary)
const HARVEST_COLOR = { excellent: '#ffe08a', good: '#a8f0a0', poor: '#d8c3a0' };
const WATERS = { aspersor: 1, noria: 4 };   // lo que riega solo cada mañana: hasta cuántas casillas a cada lado

export class Farm {
  constructor(game) {
    this.game = game;
    this.can = 0;   // agua que queda en la regadera
    this.lands = new Map();   // chunk → { Tl, swamp } (they never change)
    this.day_ = {}; this.next_ = {}; this.under_ = {};   // (reused by fieldAt and climateAt)
    this.rooms = null;   // (the greenhouses of the world: greenhouse.js)
    this.cals = []; this.frosts = new Map();   // (the calendar of each hemisphere; the frosts on the wild blossom, by chunk)
    this.pests = new Pests(this); this.told = -1; this.tellT = 0;
    this.tickT = 0; this.warned = -1; this.said = {}; this.days = {}; this.line = { text: '', key: '' };
    this.layer = { add: (cx, cy, d, out) => this.addContent(cx, cy, d, out), blocks: (tx, ty) => !!this.cropAt(tx, ty) };
  }
  get world() { return this.game.world; }
  get today() { return this.game.days.dayIndex; }
  reset(save) {
    this.can = save.can ?? 0;
    this.told = Number.isFinite(save.gardenNews) ? save.gardenNews : -1; this.tellT = 0;
    this.warned = -1; this.forget(); this.lands.clear(); this.days = {}; this.cals = []; this.frosts.clear();
    if (!this.world.layers.includes(this.layer)) this.world.layers.push(this.layer);
  }
  save(out) { out.can = this.can; if (this.told >= 0) out.gardenNews = this.told; }

  d(tx, ty, create) { return this.world.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK), create); }
  cropAt(tx, ty) { return this.d(tx, ty)?.crops?.[key(tx, ty)]; }
  ready(c) { return !!c && !c.dead && !!CROPS[c.id] && c.grow >= CROPS[c.id].days; }   // (sin CROPS: de una versión más nueva, que este juego no conoce)
  stage(c) { return c.dead ? -1 : this.age(c); }
  age(c) {
    const days = CROPS[c.id].days;
    return c.grow >= days ? 3 : c.grow >= days / 2 ? 2 : c.grow >= 1 ? 1 : 0;
  }
  // Ripe and past its best (half the harvest), as seen today
  over(c) { return this.ready(c) && c.bolt === undefined && c.ripe !== undefined && this.today - c.ripe >= GROW[c.id].window; }
  // How it looks besides its age: w wilted, f frost-bitten, o past its best, b gone to seed, p pecked by birds, n nibbled by
  // rabbits, s eaten by slugs; dead: k frost, d drought, r rotten, e eaten
  look(c) {
    if (c.dead) return c.dead === 'frost' ? 'k' : c.dead === 'drought' ? 'd' : c.dead === 'rot' ? 'r' : c.dead === 'eaten' ? 'e' : '';
    if (c.bolt !== undefined) return 'b';
    if (c.fb !== undefined && this.today - c.fb < FROST_LOOK) return 'f';
    if (c.pk > 0 && this.age(c) === 3) return 'p';
    if (this.over(c)) return 'o';
    if (c.dry >= WATER.thirsty) return 'w';
    return this.hitBy(c) === 'r' ? 'n' : this.hitBy(c) === 's' ? 's' : '';
  }
  // What has got at it these days: 'b', 'r', 's' (pests.js) or ''
  hitBy(c) { return c.pb && this.today - c.pd < PEST.mark ? c.pb : ''; }
  // E (or the click) does something with it: ripe, gone to seed or dead
  takes(c) { return !!c && !!CROPS[c.id] && (!!c.dead || this.ready(c)); }
  // Its model ('crop:tomate:3', 'crop:tomate:2:w'…: three/models.js)
  model(c) {
    const a = this.age(c), l = this.look(c);
    if (c.dead) return `crop:${c.id}:${l && a ? `${a}:${l}` : -1}`;
    return l && a ? `crop:${c.id}:${a}:${l}` : `crop:${c.id}:${a}`;
  }
  // A crop's health, 0..1 (1: nothing has gone wrong). row: how many of its family in a row on its tile
  health(c, row = 0) { return Math.max(0, (c.hn ? Math.min(1, c.hs / c.hn) : 1) - (row >= FAMILY_TIRED ? TIRED_HEALTH : 0)); }

  // ---------- the weather of a field, the soil ----------
  weatherOn(day) {   // (a weather an op has set for good, instead of the day's)
    const L = this.game.weatherLock;
    return L && L.until === null && WEATHER[L.w] ? L.w : this.game.days.weatherFor(day);
  }
  land(tx, ty) {
    const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK), k = `${cx},${cy}`;
    let l = this.lands.get(k);
    if (!l) {
      const x = (cx + 0.5) * CHUNK, y = (cy + 0.5) * CHUNK;
      this.lands.set(k, l = { Tl: climate(x, y, this.world.seed).Tl, swamp: this.world.gen.biomeAt(x, y) === B.SWAMP, soil: soilStart(this.world.gen.biomeAt(x, y)) });
    }
    return l;
  }
  // The day of a field (fieldclimate.js): its mean, its maximum, and the minimum of the night after it
  fieldAt(day, tx, ty, out = this.day_) {
    const cal = seasonOf(day + this.game.days.base);
    return fieldDay(cal.season, day + this.game.days.base - cal.start + 1, ty, this.land(tx, ty).Tl, this.weatherOn(day), out);
  }
  // How well a tile is under glass (greenhouse.js: NONE, OPEN, AIRED, SHUT)
  glassAt(tx, ty) { if (this.rooms?.w !== this.world) this.rooms = new GreenRooms(this.world); return this.rooms.at(tx, ty); }
  // °C that cover a tile at night, and only then: its straw, its cloche
  coverAt(d, k) { return (d?.mulch?.[k] !== undefined ? MULCH_FROST : 0) + (d?.cover?.[k] ? BELL.min : 0); }
  // The day of a tile: its field's, under its glass (reused, like fieldAt's: read it before the next call)
  climateAt(day, tx, ty, level = this.glassAt(tx, ty)) {
    const F = this.fieldAt(day, tx, ty);
    return level > OPEN ? glassDay(F, level, this.under_) : F;
  }
  moistOf(d, k, day = this.today) {
    const m = d?.moist?.[k];
    if (m !== undefined) return m;
    return d?.wet?.[k] >= day - 1 || (WEATHER[this.weatherOn(day)].rain && d?.roof?.[k] !== GLASS_ROOF) ? 100 : WATER.unknown;
  }
  // The three looks of the soil: 0 damp, 1 wet, 2 dry (three/models.js tilled)
  soilLook(d, k) { const m = this.moistOf(d, k); return m >= WATER.wet ? 1 : m >= WATER.damp ? 0 : 2; }
  // The soil of a tile: its fertility, the family of the last crop sown and how many of it in a row. [f, fam, n], not to be
  // written on (soilFor gives the tile's own, to write)
  soilStartAt(tx, ty) { return this.land(tx, ty).soil ?? soilStart(); }
  soilOf(d, k, tx, ty) { return d?.soil?.[k] || this.bare(this.soilStartAt(tx, ty)); }
  bare(f) { const s = (this.bare_ ||= [0, '', 0]); s[0] = f; return s; }
  soilFor(d, k, tx, ty) { return ((d.soil ||= {})[k] ||= [this.soilStartAt(tx, ty), '', 0]); }
  // Its look: 0 ordinary, 1 rich, 2 poor (three/models.js tilled)
  soilTone(d, k) { const s = d?.soil?.[k]; return s ? soilTone(s[0]) : 0; }
  // Is there a hive near enough, with its bees out? (not in the winter of the place)
  beesAt(tx, ty) {
    if (this.fieldAt(this.today, tx, ty).season === 3) return false;
    const R = BEES.R, c0 = Math.floor((tx - R) / CHUNK), c1 = Math.floor((tx + R) / CHUNK), r0 = Math.floor((ty - R) / CHUNK), r1 = Math.floor((ty + R) / CHUNK);
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      const placed = this.world.delta(cx, cy)?.placed;
      for (const k in placed) {
        if (!placed[k].startsWith('colmena') || parsePlaced(placed[k])[0] !== 'colmena') continue;
        const [x, y] = k.split(',').map(Number);
        if (Math.hypot(dxOf(x, tx), y - ty) <= R) return true;
      }
    }
    return false;
  }
  // Days a crop would take at a place sown today, with ordinary weather (Infinity: it would not make it)
  // level: under glass (greenhouse.js); warm: °C more at night
  daysHere(id, tx, ty, level = this.glassAt(tx, ty), warm = 0) {
    const key = id + (level > OPEN ? level : '') + (warm ? `+${warm}` : ''), m = this.days[key], l = this.land(tx, ty), today = this.today;
    if (m && m.l === l && m.day === today) return m.n;
    const n = this.daysTo(id, ty, l.Tl, level, warm);
    this.days[key] = { l, day: today, n };
    return n;
  }
  daysTo(id, ty, Tl, level = NONE, warm = 0) {
    const crop = CROPS[id], g = GROW[id], base = this.game.days.base, out = this.next_;
    let grow = 0, idle = 0;
    for (let i = 0; i < 100; i++) {
      const cal = seasonOf(this.today + base + i);
      fieldDay(cal.season, this.today + base + i - cal.start + 1, ty, Tl, i % 2 ? 'nubes' : 'sol', out);
      if (level > OPEN) glassDay(out, level, out);
      const r = rateAt(id, out.mean);
      idle = r > 0 ? 0 : idle + 1;
      if (out.min + warm <= g.kill || (grow < 1 && idle > SEED_WAIT)) return Infinity;
      grow += r;
      if (grow >= crop.days) return i + 1;
    }
    return Infinity;
  }
  // Did somebody play in this world that day? (ranch.farm.seen: the last day somebody did; it travels with the world)
  playedOn(day) { const s = this.game.ranch?.farm?.seen; return Number.isFinite(s) && day <= s; }

  update(dt) {
    if ((this.tickT -= dt) > 0) return;
    this.tickT = TICK;
    const g = this.game, today = this.today;
    // (the first day of the orchard's calendar in this world: the fruit that hung that day is not lost, see grace)
    if (!g.live.guest && g.ranch.farm.orchard === undefined) g.ranch.farm.orchard = today > 0 ? today : -99;
    // (once the days missed have been lived: they were not played)
    if (!g.live.guest && g.days.day === g.days.realDay && (!Profile.server || g.live.othersPlaying) && g.ranch.farm.seen !== today) g.ranch.farm.seen = today;
    const h = g.days.localHour;
    // (the weeds and the pests: the day they begin to count here)
    if (!g.live.guest && g.ranch.farm.pests === undefined) g.ranch.farm.pests = today;
    if (this.told !== today && h >= NEWS_FROM && !Profile.server && g.player && g.scene === this.world && (this.tellT -= TICK) <= 0) { this.tellT = NEWS_EVERY; this.tellNews(); }
    if (this.warned !== today && h >= WARN_FROM && h < WARN_TO && !Profile.server && g.player && g.scene === this.world) { this.warned = today; this.warnFrost(); }
  }
  // Tonight's frost, in the evening: once, only if there are crops near that it may bite
  warnFrost() {
    const ids = this.frostTonight();
    if (ids.length) hud.toast(t('farm.frost.tonight', { crops: this.names(ids) }), 'warn');
  }
  frostTonight() {
    const p = this.game.player, out = new Set(), day = this.today, F = {};
    for (const [ck, d] of this.world.deltas) {
      if (!d.crops || ck.startsWith('u:')) continue;
      const [cx, cy] = ck.split(',').map(Number), x = (cx + 0.5) * CHUNK, y = (cy + 0.5) * CHUNK;
      if (Math.abs(dxOf(x, p.x)) > WARN_R || Math.abs(y - p.y) > WARN_R) continue;
      this.fieldAt(day, x, y, F);
      for (const [k, c] of Object.entries(d.crops)) if (GROW[c?.id] && !c.dead && c.bolt === undefined && F.min + this.coverAt(d, k) + this.glassNight(d, k) <= GROW[c.id].bite) out.add(c.id);
    }
    return [...out];
  }
  // °C the greenhouse over a tile adds to its night
  glassNight(d, k) {
    if (d.roof?.[k] !== GLASS_ROOF) return 0;
    const i = k.indexOf(','), level = this.glassAt(+k.slice(0, i), +k.slice(i + 1));
    return level === SHUT ? GLASS.min : level === AIRED ? GLASS.min * GLASS.aired : 0;
  }
  // The garden's news: what came last night to the beds near you, or near where you live; once a day
  tellNews() {
    const g = this.game, p = g.player, day = this.today, home = p.spawn || g.homeSpot?.(), places = [[p.x, p.y]];
    if (home && Number.isFinite(home[0])) places.push(home);
    const N = this.pests.news(places, WARN_R, day);
    if (!N.n) return;
    this.told = day;
    hud.toast(this.newsText(N), 'warn');
  }
  // «Garden: birds pecked wheat (3); rabbits ate carrot (2). A scarecrow and a closed fence would help.»
  newsText(N) {
    const list = m => fmt.list([...m].map(([id, n]) => t('farm.news.count', { n, crop: t('farm.name_low', { crop: itemNoun(id) }) }))), parts = [], help = [];
    if (N.b.size) { parts.push(t('farm.news.birds', { list: list(N.b) })); if (this.pests.scare(...N.at.b) > PEST.b.dressed) help.push(t('farm.news.hint.scarecrow')); }
    if (N.r.size) { parts.push(t('farm.news.rabbits', { list: list(N.r) })); help.push(t('farm.news.hint.fence')); if (!this.pests.dog(...N.at.r)) help.push(t('farm.news.hint.dog')); }
    if (N.s.size) { parts.push(t('farm.news.slugs', { list: list(N.s) })); help.push(t('farm.news.hint.ducks')); }
    const text = t('farm.news', { list: parts.join(t('farm.news.sep')) });
    return help.length ? t('farm.news.helped', { text, list: fmt.list(help) }) : text;
  }
  // «tomato and pumpkin»
  names(ids) { return fmt.list(ids.map(id => t('farm.name_low', { crop: itemNoun(id) }))); }

  // Cultivos y árboles plantados de un trozo; y, de los árboles con fruta, cómo están hoy (dress)
  addContent(cx, cy, d, out) {
    // (the wild ones are the generator's own objects, kept, with the blows they have taken: they are written on, not copied)
    for (const o of out.objects) if (FRUIT[o.kind]) this.dress(d, o);
    if (!d) return;
    // (un cultivo o un árbol de una versión más nueva que este juego no conoce no se ve ni se toca, pero sigue en el trozo:
    // la casilla queda ocupada)
    for (const [k, c] of Object.entries(d.crops || {})) {
      if (!CROPS[c?.id]) continue;
      const [tx, ty] = k.split(',').map(Number);
      out.objects.push({ x: tx + 0.5, y: ty + 0.5, key: 'crop:' + k, tile: [tx, ty], crop: c });
    }
    if (d.manure) this.game.ranch?.addHeaps(d, out);
    for (const [k, t] of Object.entries(d.trees || {})) {
      const [tx, ty] = k.split(',').map(Number), x = tx + 0.5, y = ty + 0.5;
      if (!HARVEST[t?.kind]) { out.colliders.push({ x, y, r: 0.15 }); continue; }
      if (this.today - t.day < TREE_DAYS) {
        out.objects.push({ x, y, key: 'sap:' + k, tile: [tx, ty], sapling: t.kind });
        out.colliders.push({ x, y, r: 0.15 });
      } else {
        const o = { kind: t.kind, x, y, key: 'tree:' + k, tile: [tx, ty], planted: this }, young = this.youngFor(t);
        if (young) o.age = ageOf(o) * youngK(this.today - t.day);   // (a young fruit tree: smaller, and growing)
        if (FRUIT[t.kind]) this.dress(d, o);
        out.objects.push(o);
        out.colliders.push({ x, y, r: young ? 0.22 : 0.35 });
      }
    }
  }
  // Talar un árbol plantado: desaparece (no vuelve a crecer solo)
  remove(o) {
    const [tx, ty] = o.tile, d = this.d(tx, ty);
    delete d.trees[key(tx, ty)];
    this.forgetTree(d, o.key);
    this.world.touchAround(tx, ty);
  }
  // (nothing of a tree that is no longer there is left for the next one planted on its tile)
  forgetTree(d, k) { if (d.pkt) delete d.pkt[k]; if (d.picked) delete d.picked[k]; if (d.frostYear) delete d.frostYear[k]; }
  // The trees planted in a chunk, for the far view (world3d.js): the ones that are trees already, off: how far round the planet
  farTrees(d, out, off = 0) {
    for (const k in d.trees) {
      const t = d.trees[k];
      if (!HARVEST[t?.kind] || this.today - t.day < TREE_DAYS) continue;
      const c = k.indexOf(','), o = { kind: t.kind, x: +k.slice(0, c) + 0.5 + off, y: +k.slice(c + 1) + 0.5, key: 'tree:' + k };
      if (this.youngFor(t)) o.age = ageOf(o) * youngK(this.today - t.day);
      out.push(this.farLook(o));
    }
    return out;
  }
  // (from afar, only whether it is in blossom by the calendar)
  farLook(o) { if (FRUIT[o.kind]?.bloom) o.look = this.lookNow(o.kind, o.y) === 'b' ? 'b' : ''; return o; }
  // What the far view depends on, besides what has been felled: a chunk's planted trees, and the blossom at a row of tiles
  farStamp(d) {
    let n = 0;
    for (const k in d.trees) { const t = d.trees[k], a = this.today - t?.day; if (a >= TREE_DAYS) n = (Math.imul(n, 31) + k.length * 7 + k.charCodeAt(0) + k.charCodeAt(k.length - 1) + (this.youngFor(t) ? a : 50)) | 0; }
    return n;
  }
  bloomStamp(ty) { let n = 0; for (const k of ORCHARD) n = n * 2 + (this.lookNow(k, ty) === 'b' ? 1 : 0); return n; }

  // Every morning (day): what happened to each bed on the day and the night before, and the water today brings. In this
  // order: the crop grows with the water it had, the frost of the night, the soil dries, the rain, the sprinklers and the
  // water wheels wet it. Only numbers from the place, the day and the world's seed: living a day again gives the same
  onDay(day) {
    if (this.game.live.guest) return;   // (en el mundo de otro, los cultivos los hace crecer su juego)
    const w = this.world, played = this.playedOn(day - 1), F = this.day_, N = this.next_, waters = [], weeds = played && this.pests.on(day), glass = new Array(SHUT + 1).fill(null);
    for (const [ck, d] of w.deltas) {
      if (ck.startsWith('u:') || (!d.crops && !d.placed && !d.trees && !d.soil)) continue;
      const [cx, cy] = ck.split(',').map(Number);
      if (d.weeds && !weeds) for (const k in d.weeds) d.weeds[k]++;   // (they wait too: nobody played, or there are none now)
      let changed = !!d.trees && Object.keys(d.trees).length > 0, any = false;   // (los arbolitos crecen)
      for (const k in d.tilled) { any = true; break; }
      if (any) {
        const tx = cx * CHUNK, ty = cy * CHUNK, swamp = this.land(tx, ty).swamp, start = this.soilStartAt(tx, ty);
        this.fieldAt(day - 1, tx, ty, F); this.fieldAt(day, tx, ty, N);
        const rain = !!WEATHER[N.weather].rain, snow = N.weather === 'nieve', dry = dryingAt(F.max, F.weather), rained = !!WEATHER[F.weather].rain;
        let back = null;
        d.wet ||= {}; d.moist ||= {};
        glass.fill(null);   // (this field's day under each kind of glass, made when a bed asks)
        for (const k in d.tilled) {
          const roofed = d.roof?.[k] === GLASS_ROOF, bell = !!d.cover?.[k];
          let m = d.moist[k] ?? (d.wet[k] >= day - 1 || (rained && !roofed) ? 100 : WATER.unknown), G = F;
          if (roofed) {
            const i = k.indexOf(','), level = this.glassAt(+k.slice(0, i), +k.slice(i + 1));
            G = glass[level] ||= glassDay(F, level, {});
          }
          if (d.mulch?.[k] !== undefined && day - d.mulch[k] >= MULCH_DAYS) delete d.mulch[k];
          const mulch = d.mulch?.[k] !== undefined, c = d.crops?.[k], alive = !!c && !c.dead, wd = d.weeds?.[k], weedy = wd !== undefined;
          if (c && !c.dead && CROPS[c.id] && GROW[c.id]) {
            const s = ((d.soil ||= {})[k] ||= [start, GROW[c.id].fam, 1]);   // (sown before the soil counted: what its land has)
            if (c.fert === true) { c.fert = 2; s[0] = clampSoil(s[0] + OLD_FERT); }
            this.growCrop(c, day, G, m, (mulch ? MULCH_FROST : 0) + (bell ? BELL.min : 0), played, s[0], weedy);
          } else if (!c || c.dead) this.restSoil(d, k, start);
          m = Math.max(swamp ? WATER.damp + 5 : 0, m - (roofed ? dryingAt(G.max, F.weather) * GLASS.dry : dry) * (mulch ? DRY.mulch : 1) * (bell ? BELL.dry : 1) * (weedy ? WEEDS.thirst : 1));
          if (roofed) { /* neither rain nor snow: by hand, or a sprinkler */ }
          else if (bell) { if (rain) m = Math.max(m, BELL.rain); else if (snow) m = Math.max(m, Math.min(BELL.rain, m + SNOW_WATER)); }
          else if (rain) { m = 100; d.wet[k] = day; } else if (snow) m = Math.min(100, m + SNOW_WATER);
          if (c?.dry && !c.dead) { if (m >= WATER.full) delete c.dry; else if (c.dry >= WATER.dryDays && played && !this.graced(c, day)) c.dead = 'drought'; }
          d.moist[k] = Math.round(m);
          if (!weeds) continue;
          if (weedy) { if (!c && !bell && day - wd >= WEEDS.grass) (back ||= []).push(k); }
          else if (!mulch) { const i = k.indexOf(','); if (this.pests.weedUp(day, +k.slice(0, i), +k.slice(i + 1), F.season, alive)) (d.weeds ||= {})[k] = day; }
        }
        if (back) for (const k of back) this.untill(d, k);
        changed = true;
      }
      // (what is not tilled any more rests too, until it is as it was and there is nothing to remember)
      if (d.soil) for (const k in d.soil) if (d.tilled?.[k] === undefined) this.restSoil(d, k, this.soilStartAt(cx * CHUNK, cy * CHUNK), true);
      for (const [k, raw] of Object.entries(d.placed || {})) {
        const id = parsePlaced(raw)[0], r = WATERS[id];
        if (!r) continue;
        const pos = d.pos?.[`placed:${k}`], [tx, ty] = pos ? [Math.floor(pos[0]), Math.floor(pos[1])] : k.split(',').map(Number);
        waters.push(tx, ty, r);
      }
      if (d.trees && played && day > this.orchardFrom(Infinity)) this.burnBlossom(d, cx, cy, day);
      if (changed) w.touch(cx, cy);
    }
    // (the sprinklers and the wheels, once every bed has dried: theirs may be in another chunk)
    for (let i = 0; i < waters.length; i += 3) {
      const [tx, ty, r] = [waters[i], waters[i + 1], waters[i + 2]];
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const nd = this.d(tx + dx, ty + dy), nk = key(tx + dx, ty + dy);
        if (nd?.tilled[nk] === undefined) continue;
        (nd.wet ||= {})[nk] = day; (nd.moist ||= {})[nk] = 100;
        const c = nd.crops?.[nk];
        if (c?.dry && !c.dead) delete c.dry;
      }
    }
    this.pests.dawn(day);
  }
  rained(weather) { return !!WEATHER[weather]?.rain; }
  // A bare bed goes back to grass (its soil is still remembered: restSoil)
  untill(d, k) {
    const i = k.indexOf(','), tx = +k.slice(0, i), ty = +k.slice(i + 1);
    delete d.tilled[k];
    for (const f of [d.wet, d.moist, d.mulch, d.weeds, d.cover]) if (f) delete f[k];
    this.world.dropLevel?.(tx, ty);
    this.world.touchAround(tx, ty);
  }
  // A morning's rest of a tile with nothing growing: a little back, up to what its land has (wild: not tilled, also back down to it)
  restSoil(d, k, start, wild = false) {
    const s = d.soil?.[k];
    if (!s) return;
    if (s[0] < start) s[0] = Math.min(start, s[0] + SOIL.rest);
    else if (wild && s[0] > start) s[0] = Math.max(start, s[0] - SOIL.rest);
    if (wild && s[0] === start) delete d.soil[k];
  }
  graced(c, day) { return c.leg !== undefined && day - c.leg < GRACE; }
  // One crop, one day: F: the day that ended, and its night; m: its soil's moisture; warm: °C that cover it at night; soil:
  // its soil's fertility
  growCrop(c, day, F, m, warm, played, soil = 60, weedy = false) {
    const g = GROW[c.id], crop = CROPS[c.id];
    // (planted before the weather decided: it keeps growing in what were its seasons, and what was ripe waits a few days more)
    if (c.hn === undefined) { c.hs = 0; c.hn = 0; c.leg = day; if (c.grow >= crop.days) c.ripe = day + OLD_RIPE; }
    if (c.bolt !== undefined) return;
    const min = F.min + warm, bitten = min <= g.bite;
    if (min <= g.kill && played && !this.graced(c, day)) { c.dead = 'frost'; return; }
    if (bitten) c.fb = day;
    if (c.grow < crop.days) {
      const wf = weedy ? WEEDS.slow : 1;
      let r = rateAt(c.id, F.mean);
      if (c.leg !== undefined && day - c.leg < OLD_RATE) r = Math.max(r, g.was.includes(F.season) ? 1 : 0.5);
      const w = waterAt(m, c.grow < crop.days / 2), fert = fertAt(soil), grew = r * w * wf * (c.fert ? Math.max(fert, OLD_FERT_RATE) : fert);
      if (w === 1) delete c.dry;
      else if (w === 0 && c.grow > 0) c.dry = played ? (c.dry || 0) + 1 : Math.max(c.dry || 0, Math.min(WATER.thirsty, (c.dry || 0) + 1));
      if (r > 0 && (c.grow > 0 || w > 0)) { c.hs = Math.round((c.hs + w * (weedy ? WEEDS.health : 1) * Math.min(1, c.fert ? 1 : fert) * (bitten ? 0.5 : 1)) * 100) / 100; c.hn++; }
      if (c.grow < 1 && !(grew > 0)) { if (played && (c.wt = (c.wt || 0) + 1) >= SEED_WAIT) c.dead = 'rot'; }
      c.grow = Math.round(Math.max(0, c.grow + grew - (bitten ? 1 : 0)) * 1000) / 1000;
      if (c.grow >= crop.days) { c.ripe = day; delete c.dry; delete c.wt; }
      return;
    }
    delete c.dry;
    if (c.ripe === undefined) c.ripe = day;
    else if (!played) c.ripe++;
    if (day - c.ripe < g.window + Math.ceil(g.window / 2)) return;
    if (g.end === 'bolt') c.bolt = day;
    else if (g.end === 'rot') c.dead = 'rot';
    else { c.grow = crop.days - crop.regrow; delete c.ripe; delete c.pk; }
  }

  // Qué hacer con lo que se lleva en la mano mirando a una casilla
  target(p, held, def) {
    const g = this.game;
    if (g.scene !== this.world) return null;
    const [tx, ty] = g.aimTile(), d = this.d(tx, ty), k = key(tx, ty);
    const crop = d?.crops?.[k], tilled = d?.tilled[k] !== undefined, tile = [tx, ty];
    if (def?.tool === 'guadana' && this.reapable(crop)) return { tile, ok: true, auto: true, label: t('farm.reap'), use: () => this.reap(tx, ty) };
    if (held?.id === CLOCHE && tilled && !d.cover?.[k] && !crop?.dead) {
      const tall = !!crop && BELL.big.has(crop.id);
      return { tile, ok: !tall, label: tall ? t('farm.cloche.tall', { crop: itemNoun(crop.id) }) : t('farm.cloche.put'), use: () => (tall ? this.no(t('farm.cloche.tall', { crop: itemNoun(crop.id) })) : this.putBell(tx, ty)) };
    }
    if (this.takes(crop) && !def?.place) return { tile, ok: true, label: this.cropText(crop), use: () => this.take(tx, ty) };
    // The scythe cuts down a crop that is not ready yet (to fix a mistake or clear the field); the seed comes back.
    // (Not one from a newer version this game doesn't know: it stays as it is.)
    if (crop && CROPS[crop.id] && def?.tool === 'guadana') return { tile, ok: true, label: t('farm.cut_crop'), use: () => this.cut(tx, ty) };
    if ((!held || def?.tool === 'azada') && this.weedy(d, k)) return { tile, ok: true, auto: true, label: t('farm.weed.pull'), use: () => this.pull(tx, ty) };
    if (def?.seed) {
      if (!tilled || crop) return null;
      this.sowText(def.seed, tx, ty);
      const { ok, text } = this.said.sow;
      return { tile, ok, label: text, use: () => (ok ? this.sow(tx, ty, def.seed) : this.no(text)) };
    }
    if (def?.tool === 'regadera') {
      // (or the well aimed at, measured to its middle: from a corner of the big one its far quarter is beyond reach)
      const wo = this.world.wellOf(tx, ty), water = this.waterAhead(p) || (wo && Math.hypot(wo.tx + wo.n / 2 - p.x, wo.ty + wo.n / 2 - p.y) < 2.4 + (wo.n - 1) * 0.75);
      if (water) return { tile: null, ok: true, label: t('farm.can.fill', { n: this.can, max: CAN_MAX }), use: () => this.refill() };
      if (tilled) return { tile, ok: true, auto: true, label: t('farm.can.water', { n: this.can, max: CAN_MAX, soil: this.soilText(d, k) }), use: () => this.water(tx, ty) };
      return null;
    }
    if (FOOD[held?.id] && tilled) {
      const f = this.soilOf(d, k, tx, ty)[0], to = clampSoil(f + FOOD[held.id]), item = itemNoun(held.id);
      if (f >= SOIL_MAX) return { tile, ok: false, label: t('farm.feed.full'), use: () => this.no(t('farm.feed.full')) };
      // (held down, one on each tile; click again on the same one to give it more)
      return { tile, ok: true, auto: this.lastFed !== k, label: t('farm.feed.spread', { item, f, to }), use: () => this.feedSoil(tx, ty, held.id) };
    }
    if (MULCH.has(held?.id) && tilled && d.mulch?.[k] === undefined) return { tile, ok: true, auto: true, label: t('farm.mulch.spread', { item: itemNoun(held.id) }), use: () => this.spread(tx, ty, held.id) };
    if (def?.sapling) {
      const ok = this.canPlant(tx, ty);
      return { tile, ok, label: ok ? this.plantText(def.sapling) : '', use: () => (ok ? this.plantTree(tx, ty, def.sapling) : Audio.error()) };
    }
    return null;
  }
  // E junto a un cultivo listo o a un manzano con fruta
  interact(p, scene) {
    if (scene !== this.world) return null;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const tx = Math.floor(p.x) + dx, ty = Math.floor(p.y) + dy, c = this.cropAt(tx, ty);
      if (this.ready(c) && Math.hypot(tx + 0.5 - p.x, ty + 0.5 - p.y) < 1.2) return this.cropAction(tx, ty);
    }
    const tree = this.fruitTreeNear(p);
    if (tree) return { text: this.pickText(tree), run: () => this.pickFruit(tree) };
    return null;
  }

  aimables(p, scene, box) {
    if (scene !== this.world) return null;
    const out = [], px = Math.floor(p.x), py = Math.floor(p.y);
    let d = null, lx = NaN, ly = NaN;   // (the chunk of the tile before)
    for (let ty = py - 2; ty <= py + 2; ty++) for (let tx = px - 2; tx <= px + 2; tx++) {
      const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK);
      if (cx !== lx || cy !== ly) { d = this.world.delta(cx, cy); lx = cx; ly = cy; }
      const k = d?.weeds && key(tx, ty);
      const at = [tx, ty], c = d?.cover && key(tx, ty);
      if (c && d.cover[c]) { out.push({ kind: 'sys', bell: at, exact: true, box: box(tx + 0.5, ty + 0.5, 0.42, 0.42, 0, 0.6), model: { name: this.bellModel(d, c), x: tx + 0.5, y: ty + 0.5, lift: this.world.levelAt?.(tx + 0.5, ty + 0.5, true) || 0 }, act: () => this.bellAction(tx, ty) }); continue; }
      if (!k || !this.weedy(d, k) || this.takes(d.crops?.[k])) continue;
      out.push({ kind: 'sys', weeds: at, box: box(tx + 0.5, ty + 0.5, 0.4, 0.4, 0, 0.35), model: { name: this.weedModel(d, k), x: tx + 0.5, y: ty + 0.5, yaw: weedYaw(tx, ty), lift: this.world.levelAt?.(tx + 0.5, ty + 0.5, true) || 0 }, act: () => ({ text: this.weedText(tx, ty), run: () => this.pull(tx, ty) }) });
    }
    for (const o of this.world.harvestablesNear(p.x, p.y)) {
      const f = FRUIT[o.kind];
      if (!f || Math.hypot(o.x - p.x, o.y - p.y) > 4 || !this.hasFruit(this.d(Math.floor(o.x), Math.floor(o.y)), o)) continue;
      // (tree: its outline and aim are the tree's own instances; the box, the whole tree, crown and coconuts too)
      const r = canopyOf(o) + 0.3, h = (o.kind === 'palm' ? palmDims(o).H : broadDims(o, 0).H) + 0.5;
      out.push({ kind: 'sys', tree: o, exact: true, box: box(o.x, o.y, r, r, 0, h), act: () => ({ text: this.pickText(o), run: () => this.pickFruit(o) }) });
    }
    return out;
  }
  // ¿Hay agua delante? (la de ríos, lagos y el mar, el estanque del pueblo o un pozo)
  waterAhead(p) {
    for (const r of [1, 1.6]) {
      const x = p.x + p.face.x * r, y = p.y + p.face.y * r;
      if (this.world.water(x, y) || (inBounds(x, y) && pondDist(x, y) < 1) || this.world.wellAt(x, y)) return true;
    }
    return false;
  }
  refill() { this.can = CAN_MAX; Audio.noiseHit(900, 0.3, 0.2); this.game.gather.float(t('farm.can.full'), '#9ad0ff'); }
  // Con E en el pozo (the big one too), in this order: a canteen or a jug in hand that is not full, fills it; a watering
  // can in hand, fills it; thirsty, you drink (needs.drinkAt: one press keeps drinking); a can in the bag (the water is
  // the can's, not the slot's), fills it; otherwise, it says what it is for. alt: X, take it down
  wellAction(o, alt) {
    const g = this.game, held = g.inv.held, hd = held && ITEMS[held.id], splash = () => g.gather.chips(o.x, o.y, 'water', 10);
    if (hd?.canteen && (held.sips || 0) < hd.canteen) return { text: t('needs.canteen.fill', { item: itemNoun(held.id), n: held.sips || 0, max: hd.canteen }), run: () => { splash(); g.gather.fillCanteen(); }, alt };
    const can = { text: t('farm.can.fill', { n: this.can, max: CAN_MAX }), run: () => { splash(); this.refill(); }, alt };
    if (held?.id === 'regadera') return can;
    if (g.needs && g.needs.thirst < THIRST_MAX) return { text: t('needs.well.drink'), run: () => g.needs.drinkAt(o.x, o.y), alt };
    if (g.inv.count('regadera') > 0) return can;
    return { text: t('needs.well.draw'), run: () => { splash(); g.gather.float(t('farm.well.hint'), '#9ad0ff'); Audio.noiseHit(700, 0.25, 0.15); }, alt };
  }
  water(tx, ty) {
    const g = this.game;
    if (this.can <= 0) { g.gather.float(t('farm.can.empty'), '#ffb0a0'); Audio.error(); return; }
    if (!g.gather.spend('regadera')) return;
    const d = this.d(tx, ty, true);
    d.wet ||= {};
    d.wet[key(tx, ty)] = this.today;
    (d.moist ||= {})[key(tx, ty)] = 100;
    const c = d.crops?.[key(tx, ty)];
    if (c?.dry && !c.dead) { delete c.dry; this.world.touchAround(tx, ty); }   // (a thirsty plant picks up)
    this.forget();
    this.can--;
    g.gather.cooldown = 0.3;
    this.world.chestTouched(tx, ty);
    g.gather.chips(tx + 0.5, ty + 0.5, 'water', 8);
    Audio.noiseHit(1400, 0.25, 0.15, 'highpass');
    g.skills?.gain('agricultura', 0.3);
  }
  // Caer de un salto sobre tierra labrada sin nada plantado la deshace, como en Minecraft (andar por encima, no; y
  // con algo plantado, aunque esté seco, tampoco). El espectador no pisa nada
  trample(p) {
    const g = this.game, tx = Math.floor(p.x), ty = Math.floor(p.y), k = key(tx, ty), d = this.d(tx, ty);
    if (g.scene !== this.world || g.gamemode === 'spectator' || d?.tilled?.[k] === undefined || this.cropAt(tx, ty) || d.cover?.[k]) return false;
    this.untill(d, k);
    g.gather.chips(tx + 0.5, ty + 0.5, 'dirt', 8);
    Audio.till();
    return true;
  }
  sow(tx, ty, id) {
    const g = this.game, d = this.d(tx, ty, true);
    d.crops ||= {};
    d.crops[key(tx, ty)] = { id, grow: 0, day: this.today, hs: 0, hn: 0 };
    const s = this.soilFor(d, key(tx, ty), tx, ty), fam = GROW[id]?.fam || '';   // (rotation: how many of its family in a row)
    s[2] = s[1] === fam ? (s[2] || 0) + 1 : 1; s[1] = fam;
    g.inv.remove(seedOf(id), 1);
    this.forget();
    g.stats?.add('sembrados', 1);
    g.gather.cooldown = 0.25;
    this.world.touchAround(tx, ty);
    Audio.till();
    g.skills?.gain('agricultura', 0.5);
  }
  // Manure or compost on a tilled tile, with a crop or without: it feeds the soil, and the soil the crops
  feedSoil(tx, ty, id) {
    const g = this.game, d = this.d(tx, ty, true), k = key(tx, ty);
    if (d.tilled?.[k] === undefined || g.inv.count(id) < 1) return;
    const s = this.soilFor(d, k, tx, ty);
    s[0] = clampSoil(s[0] + FOOD[id]);
    this.lastFed = k;
    g.inv.remove(id, 1);
    g.gather.cooldown = 0.25;
    this.forget();
    this.world.touchAround(tx, ty);
    g.gather.chips(tx + 0.5, ty + 0.5, 'dirt', 8);
    g.gather.float(t('farm.feed.done', { soil: this.soilFertText(s, tx, ty) }), '#a8f0a0');
    Audio.dump();
    g.skills?.gain('agricultura', 0.3);
  }
  // What E (or the click) does with a ripe crop, one gone to seed or a dead one
  cropText(c) { return c.dead ? t('farm.clear_dead') : c.bolt !== undefined ? t('farm.take_seeds') : t('farm.harvest'); }
  cropAction(tx, ty) {
    const c = this.cropAt(tx, ty);
    if (!this.takes(c)) return null;
    const more = this.status(tx, ty, 'take');
    return { text: more ? `${this.cropText(c)} · ${more}` : this.cropText(c), run: () => this.take(tx, ty), ...this.bellAlt(tx, ty) };
  }
  // ---------- the cloche ----------
  bellAlt(tx, ty) { return this.d(tx, ty)?.cover?.[key(tx, ty)] ? { alt: { text: t('farm.cloche.take'), run: () => this.takeBell(tx, ty) } } : null; }
  // A covered tile aimed at: what one can do to its plant first (and X takes the cloche), else E takes it
  bellAction(tx, ty) {
    const d = this.d(tx, ty), k = key(tx, ty), crop = this.cropAction(tx, ty);
    if (crop) return crop;
    if (this.weedy(d, k)) return { text: this.weedText(tx, ty), run: () => this.pull(tx, ty), ...this.bellAlt(tx, ty) };
    const more = this.status(tx, ty, 'under'), take = t('farm.cloche.take');
    return { text: more ? `${take} · ${more}` : take, run: () => this.takeBell(tx, ty) };
  }
  // Its model: the bell its plant takes ('cloche:2', three/glass3d.js)
  bellModel(d, k) { const c = d.crops?.[k]; return `cloche:${c && CROPS[c.id] ? bellSize(c.id, this.age(c)) : 1}`; }
  putBell(tx, ty) {
    const g = this.game, d = this.d(tx, ty, true), k = key(tx, ty);
    if (d.cover?.[k] || g.inv.count(CLOCHE) < 1) return;
    (d.cover ||= {})[k] = CLOCHE;
    g.inv.remove(CLOCHE, 1);
    g.gather.cooldown = 0.25;
    this.forget();
    this.world.touchAround(tx, ty);
    Audio.glass();
  }
  takeBell(tx, ty) {
    const g = this.game, d = this.d(tx, ty), k = key(tx, ty);
    if (!d?.cover?.[k]) return;   // (somebody else has just taken it)
    delete d.cover[k];
    g.gather.spawnDrops({ x: tx + 0.5, y: ty + 0.5 }, { drops: [[CLOCHE, 1, 1]] });
    g.gather.cooldown = 0.25;
    this.forget();
    this.world.touchAround(tx, ty);
    Audio.glass();
  }
  take(tx, ty) { const c = this.cropAt(tx, ty); if (c?.dead) this.clear(tx, ty); else if (this.ready(c)) this.harvest(tx, ty); }
  // straw: with the scythe, the wheat's straw too; quiet: without its word (the rest of a sweep)
  harvest(tx, ty, straw = 0, quiet = false) {
    const g = this.game, d = this.d(tx, ty), k = key(tx, ty), c = d?.crops?.[k], crop = CROPS[c?.id], at = { x: tx + 0.5, y: ty + 0.5 };
    if (!crop || !this.ready(c)) return 0;
    const s = this.soilFor(d, k, tx, ty);
    let n = 0;
    if (c.bolt !== undefined) g.gather.spawnDrops(at, { drops: [[seedOf(c.id), ...BOLT_SEEDS]] });
    else {
      const h = this.health(c, s[2]), word = qualityOf(h);
      n = yieldAt(c.id, h);
      if (this.over(c)) n = Math.max(1, Math.floor(n / 2));
      if (c.pk > 0) n = Math.max(1, n - c.pk);
      if (Math.random() < (g.skills?.bonus('agricultura') || 0)) n++;
      if (s[0] > SOIL.rich && Math.random() < RICH_MORE) n++;
      if (word && word !== 'poor' && Math.random() < (GROW[c.id].more || 0)) n++;
      if (GROW[c.id].bees && Math.random() < BEES.more && this.beesAt(tx, ty)) n++;
      g.gather.spawnDrops(at, { drops: straw ? [[c.id, n, n], ['straw', straw, straw]] : [[c.id, n, n]] });
      if (word && !quiet) g.gather.float(t('farm.harvest.quality.' + word), HARVEST_COLOR[word]);
      g.nature?.harvested(c.id);   // (harvested: Known in the nature book)
    }
    s[0] = clampSoil(s[0] - takesFrom(c.id, c.picks > 0));
    if (crop.regrow && c.bolt === undefined) { c.grow = crop.days - crop.regrow; c.picks = (c.picks || 0) + 1; delete c.ripe; delete c.fert; delete c.pk; }
    else delete d.crops[k];
    this.forget();
    this.world.touchAround(tx, ty);
    g.gather.chips(at.x, at.y, 'leaf', 8);
    Audio.pickup();
    g.skills?.gain('agricultura', 2);
    g.stats?.add('cosechas', 1);
    return n;
  }
  // Clear a dead plant: what it had time to make of seeds comes back (a seed that rotted in the soil, or one dead since
  // before the weather decided, none)
  clear(tx, ty) {
    const d = this.d(tx, ty), k = key(tx, ty), c = d?.crops?.[k];
    if (!c) return;
    const grown = this.age(c) >= 2, n = c.dead === 'rot' ? (c.grow < 1 ? [0, 0] : [1, 2]) : c.dead === 'frost' ? (grown ? [2, 2] : [1, 1]) : c.dead === 'drought' ? [1, 1] : c.dead === 'eaten' ? [0, 1] : [0, 0];
    if (n[1] && ITEMS[seedOf(c.id)]) this.game.gather.spawnDrops({ x: tx + 0.5, y: ty + 0.5 }, { drops: [[seedOf(c.id), ...n]] });
    delete d.crops[k];
    this.forget();
    this.world.touchAround(tx, ty);
    Audio.swish();
  }
  // The scythe on ripe wheat: the one aimed at and the ones at both its sides come down at once, with their straw
  reapable(c) { return c?.id === 'trigo' && this.ready(c); }
  reap(tx, ty) {
    const g = this.game, f = g.player.face, [sx, sy] = Math.abs(f.x) > Math.abs(f.y) ? [0, 1] : [1, 0];
    if (!g.gather.spend('guadana')) return;
    for (const i of [0, -1, 1]) if (this.reapable(this.cropAt(tx + i * sx, ty + i * sy))) this.harvest(tx + i * sx, ty + i * sy, 1, i !== 0);
    g.gather.cooldown = 0.35;
    Audio.swish();
  }
  // Straw (or hay) over the bed: it keeps the water in and the frost a little off
  spread(tx, ty, id) {
    const g = this.game, d = this.d(tx, ty, true);
    (d.mulch ||= {})[key(tx, ty)] = this.today;
    g.inv.remove(id, 1);
    g.gather.cooldown = 0.25;
    this.forget();
    this.world.touchAround(tx, ty);
    g.gather.chips(tx + 0.5, ty + 0.5, 'leaf', 6);
    Audio.swish();
    g.skills?.gain('agricultura', 0.3);
  }
  // ---------- weeds ----------
  weedy(d, k) { return d?.weeds?.[k] !== undefined && d.tilled?.[k] !== undefined; }
  // Their model: how big, and one of three kinds of tuft ('weeds:2:1', three/pests3d.js)
  weedModel(d, k) { const i = k.indexOf(','); return `weeds:${weedStage(this.today - d.weeds[k])}:${weedKind(+k.slice(0, i), +k.slice(i + 1))}`; }
  weedText(tx, ty) {
    if (this.fresh('weeds', '', tx, ty)) return this.said.weeds.text;
    const more = this.status(tx, ty, 'under');
    return this.say('weeds', '', tx, ty, more ? `${t('farm.weed.pull')} · ${more}` : t('farm.weed.pull'));
  }
  // Pull the weeds of a tile, by hand or with the hoe: a fiber and, now and then, some seeds
  pull(tx, ty) {
    const g = this.game, d = this.d(tx, ty), k = key(tx, ty), hoe = ITEMS[g.inv.held?.id]?.tool === 'azada';
    if (!this.weedy(d, k) || g.gather.cooldown > 0) return;
    if (hoe && !g.gather.spend('azada')) return;
    delete d.weeds[k];
    this.forget();
    g.gather.swing = 0.25; g.gather.swingItem = hoe ? g.inv.held.id : null; g.gather.cooldown = PULL[hoe ? 1 : 0];
    g.gather.spawnDrops({ x: tx + 0.5, y: ty + 0.5 }, { drops: GRASS_DROPS });
    g.gather.chips(tx + 0.5, ty + 0.5, 'leaf', 8);
    this.world.touchAround(tx, ty);
    Audio.swish();
    g.skills?.gain('agricultura', 0.3);
  }
  no(text) { this.game.gather.float(text, '#ffb0a0'); Audio.error(); }

  // ---------- what it says ----------
  // (what is under the cursor is asked every frame: a text is made again when the tile changes, and four times a second)
  // (slot: what is being sown, the tile aimed at, the crop E would take: each its own)
  fresh(slot, id, tx, ty) { const s = this.said[slot], now = this.game.time; return !!s && s.at >= 0 && s.id === id && s.tx === tx && s.ty === ty && s.lang === getLang() && now - s.at < 0.25 && now >= s.at; }
  say(slot, id, tx, ty, text, ok = true) { Object.assign(this.said[slot] ||= {}, { id, tx, ty, text, ok, at: this.game.time, lang: getLang() }); return text; }
  forget() { for (const k in this.said) this.said[k].at = -1; }
  soilText(d, k) { const l = this.soilLook(d, k); return t(l === 1 ? 'farm.soil.wet' : l === 0 ? 'farm.soil.damp' : 'farm.soil.dry'); }
  // «tired soil», «rich soil»…; and, from the third crop of a family in a row, what it is tired of
  soilFertText(s, tx, ty) {
    const w = soilWord(s[0], this.soilStartAt(tx, ty));
    return t(w === 'poor' ? 'farm.soil.poor' : w === 'tired' ? 'farm.soil.tired' : w === 'thin' ? 'farm.soil.thin' : w === 'rich' ? 'farm.soil.rich' : 'farm.soil.fertile');
  }
  tiredText(s, next = 0) { return s[1] && s[2] + next >= FAMILY_TIRED && FAMILIES.has(s[1]) ? t('farm.soil.tired_of', { family: t(FAMILIES.get(s[1])) }) : ''; }
  // Sowing this here today: fine (about how many days), too cold yet (the seed waits), or it would not live through tonight
  sowText(id, tx, ty) {
    if (this.fresh('sow', id, tx, ty)) return this.said.sow.text;
    const g = GROW[id], crop = itemNoun(id), level = this.glassAt(tx, ty), F = this.climateAt(this.today, tx, ty, level), c = Math.round(F.mean), warm = this.coverAt(this.d(tx, ty), key(tx, ty));
    if (BELL.big.has(id) && this.d(tx, ty)?.cover?.[key(tx, ty)]) return this.say('sow', id, tx, ty, t('farm.cloche.tall', { crop }), false);
    if (F.min + warm <= g.kill) return this.say('sow', id, tx, ty, t(level < AIRED && F.min + warm + GLASS.min > g.kill ? 'farm.sow.cold_glass' : 'farm.sow.cold_tonight', { crop }), false);
    if (F.mean <= g.base) return this.say('sow', id, tx, ty, t('farm.sow.cold_yet', { crop, c, need: g.base + 1 }));
    if (F.mean >= g.stop) return this.say('sow', id, tx, ty, t('farm.sow.hot', { crop, c }));
    const n = this.daysHere(id, tx, ty, level, warm), s = this.soilOf(this.d(tx, ty), key(tx, ty), tx, ty), tired = s[1] === g.fam ? this.tiredText(s, 1) : '';
    const text = n < Infinity ? t(level > OPEN ? 'farm.sow.glass' : 'farm.sow', { crop, days: n }) : t('farm.sow.wont', { crop });
    return this.say('sow', id, tx, ty, tired ? t('farm.sow.tired', { text, tired }) : text);
  }
  // The tile looked at: what grows there and how, and its soil ('' if it is not tilled)
  status(tx, ty, slot = 'tile') {
    if (this.fresh(slot, '', tx, ty)) return this.said[slot].text;
    const d = this.d(tx, ty), k = key(tx, ty);
    if (d?.tilled?.[k] === undefined) return '';
    const c = d.crops?.[k], known = c && CROPS[c.id], s = this.soilOf(d, k, tx, ty), water = d.mulch?.[k] !== undefined ? t('farm.soil.mulched', { soil: this.soilText(d, k) }) : this.soilText(d, k);
    const soil = this.glassText(t('farm.soil.both', { soil: water, food: this.tiredText(s) || this.soilFertText(s, tx, ty) }), d, k, tx, ty);
    if (c && !known) return this.say(slot, '', tx, ty, '');   // (from a newer version)
    if (!c) return this.say(slot, '', tx, ty, slot === 'under' ? '' : t('farm.state.bare', { soil: this.weedy(d, k) ? t('farm.state.weedy', { text: soil }) : soil }));
    const crop = itemNoun(c.id), state = this.stateText(c, tx, ty, this.moistOf(d, k));
    if (c.dead || c.bolt !== undefined || slot === 'take' || slot === 'under') return this.say(slot, '', tx, ty, t('farm.state.alone', { crop, state }));
    const text = t('farm.state.crop', { crop, state, soil: this.weedy(d, k) ? t('farm.state.weedy', { text: soil }) : soil });
    return this.say(slot, '', tx, ty, GROW[c.id].bees && this.beesAt(tx, ty) ? t('farm.state.bees', { text }) : text);
  }
  // (what covers it: the greenhouse, and how it is, or the cloche)
  glassText(text, d, k, tx, ty) {
    const level = this.glassAt(tx, ty);
    if (level) text = t(level === SHUT ? 'farm.state.under_glass' : level === AIRED ? 'farm.state.glass_aired' : 'farm.state.glass_open', { text, n: level === SHUT ? GLASS.mean : GLASS.mean * GLASS.aired });
    return d.cover?.[k] ? t('farm.state.cloche', { text }) : text;
  }
  stateText(c, tx, ty, m) {
    const by = c.dead || c.bolt !== undefined ? '' : c.pk > 0 ? 'b' : this.hitBy(c), text = this.growthText(c, tx, ty, m);
    return by ? t('farm.state.with', { state: text, more: t(by === 'b' ? 'farm.state.pecked' : by === 'r' ? 'farm.state.nibbled' : 'farm.state.slugs') }) : text;
  }
  growthText(c, tx, ty, m) {
    const g = GROW[c.id], days = CROPS[c.id].days;
    if (c.dead) return t(c.dead === 'frost' ? 'farm.state.dead_frost' : c.dead === 'drought' ? 'farm.state.dead_drought' : c.dead === 'rot' ? 'farm.state.dead_rot' : c.dead === 'eaten' ? 'farm.state.dead_eaten' : 'farm.state.dead');
    if (c.bolt !== undefined) return t('farm.state.bolting');
    if (c.grow >= days) return this.over(c) ? t('farm.state.overripe') : t('farm.state.ripe', { n: g.window - Math.max(0, this.today - (c.ripe ?? this.today)) });
    if (c.dry >= WATER.thirsty) return t('farm.state.wilted');
    if (waterAt(m, c.grow < days / 2) < 0.5) return t('farm.state.thirsty');
    if (c.fb !== undefined && this.today - c.fb < FROST_LOOK) return t('farm.state.frostbit');
    const F = this.climateAt(this.today, tx, ty);
    const free = c.leg !== undefined && this.today - c.leg < OLD_RATE;
    if (!free && F.mean <= g.base) return t('farm.state.waiting_cold', { c: Math.round(F.mean), need: g.base + 1 });
    if (!free && F.mean >= g.stop) return t('farm.state.waiting_heat', { c: Math.round(F.mean) });
    return t('farm.state.growing', { pct: Math.floor((c.grow / days) * 100) });
  }
  // The line of the bed aimed at, without a key (it does nothing), when what is held has nothing to do there (gather.hint)
  hint() {
    const g = this.game, p = g.player;
    if (g.scene !== this.world || !p || g.mode !== 'play' || g.busy || p.swim || p.pose || p.mount || g.build.on) return '';
    const held = g.inv.held, def = held && ITEMS[held.id], tg = g.gather.target;
    if (def && (def.food || def.heal || def.canteen || def.place)) return '';
    if (tg && (tg.label !== undefined || tg.ok || tg.free || tg.prey)) return '';
    const rule = tg?.obj && HARVEST[tg.obj.kind];
    if (rule && (def?.tool ? def.tool === rule.tool : rule.hand)) return '';   // (something that can be taken)
    // (a fruit tree: how it stands; an ordinary sapling too)
    const [tx, ty] = g.aimTile(), text = (tg?.obj && FRUIT[tg.obj.kind] ? this.treeText(tg.obj) : this.saplingText(tx, ty)) || this.status(tx, ty);
    if (!text) return '';
    this.line.text = text;
    return this.line;
  }

  // ---------- the almanac (the diary's Farm tab) ----------
  // Here and now: the day, the nights to come, and how each crop would do sown today
  almanac(x, y) {
    const tx = Math.floor(x), ty = Math.floor(y), level = this.glassAt(tx, ty), l = this.land(tx, ty), out = this.fieldAt(this.today, tx, ty, {}), T = level > OPEN ? glassDay(out, level, {}) : out, U = glassDay(out, SHUT, {});
    const nights = [];
    for (let i = 0; i < 7; i++) { const F = this.fieldAt(this.today + i, tx, ty, {}); nights.push({ min: F.min, icon: WEATHER[F.weather].icon }); }
    const crops = Object.keys(GROW).map(id => {
      const g = GROW[id], n = this.daysHere(id, tx, ty, level), now = T.min <= g.kill ? 'tonight' : n === Infinity ? 'no' : T.mean <= g.base || T.mean >= g.stop ? 'wait' : 'now';
      // (what does not grow in the open but would in a greenhouse)
      const m = now === 'now' || level === SHUT || T.mean >= g.stop || U.min <= g.kill || U.mean <= g.base || U.mean >= g.stop ? Infinity : this.daysTo(id, ty, l.Tl, SHUT);
      return m < Infinity ? { id, days: m, kill: g.kill, now: 'glass_only' } : { id, days: n, kill: g.kill, now };
    });
    return { mean: T.mean, min: T.min, max: T.max, level, nights, crops, soil: this.soilCount(x, y), pests: this.pests.count(x, y, WARN_R, this.today) };
  }
  // The beds around a place by how their soil is: { rich, fertile, tired, poor } (thin land counts as tired)
  soilCount(x, y, R = WARN_R) {
    const out = { rich: 0, fertile: 0, tired: 0, poor: 0 };
    for (const [ck, d] of this.world.deltas) {
      if (ck.startsWith('u:')) continue;
      const [cx, cy] = ck.split(',').map(Number);
      if (Math.abs(dxOf((cx + 0.5) * CHUNK, x)) > R || Math.abs((cy + 0.5) * CHUNK - y) > R) continue;
      const start = this.soilStartAt(cx * CHUNK, cy * CHUNK);
      for (const k in d.tilled) { const w = soilWord(d.soil?.[k]?.[0] ?? start, start); out[w === 'thin' ? 'tired' : w]++; }
    }
    return out;
  }
  journal() {
    const g = this.game, p = g.scene === this.world && g.player ? g.player : { x: 0, y: 30 }, a = this.almanac(p.x, p.y), r = Math.round;
    const rows = a.crops.slice().sort((x, y) => ALMANAC[x.now] - ALMANAC[y.now] || x.days - y.days).map(c => `<div class="j-row"><b>${t('farm.name', { crop: thingNoun(c.id) })}</b><span class="lvl">${t('farm.almanac.' + c.now, { n: c.days })}</span><small>${t('farm.almanac.frost', { c: c.kill })}</small></div>`).join('');
    const nights = a.nights.map(n => `${n.icon} ${r(n.min)}°`).join(' · '), beds = a.soil.rich + a.soil.fertile + a.soil.tired + a.soil.poor;
    return `<p class="j-note"><b>${t('farm.almanac.title')}</b><br>${t('farm.almanac.here', { mean: r(a.mean), min: r(a.min), max: r(a.max) })}${a.min <= 2 ? ' ' + t('farm.almanac.tonight_frost') : ''}${a.level > OPEN ? ' ' + t('farm.almanac.under') : ''}<br>${t('farm.almanac.nights', { list: nights })}${beds ? '<br>' + t('farm.almanac.soil', a.soil) + '<br>' + t('farm.almanac.pests', a.pests) : ''}<br>${t('farm.almanac.help')}<br>${t('farm.almanac.glass_help')}<br>${t('farm.almanac.soil_help')}<br>${t('farm.almanac.trees_help')}${this.pests.hard ? '<br>' + t('farm.almanac.pests_help') : ''}</p>${rows}`;
  }

  // Cut down a crop that is still growing: the tile stays tilled and its seed drops, to sow it again
  cut(tx, ty) {
    const g = this.game, d = this.d(tx, ty), k = key(tx, ty), c = d?.crops?.[k];
    if (!c || !g.gather.spend('guadana')) return;
    delete d.crops[k];
    this.forget();
    if (ITEMS[seedOf(c.id)]) g.gather.spawnDrops({ x: tx + 0.5, y: ty + 0.5 }, { drops: [[seedOf(c.id), 1, 1]] });
    this.world.touchAround(tx, ty);
    g.gather.chips(tx + 0.5, ty + 0.5, 'leaf', 8);
    Audio.swish();
  }

  canPlant(tx, ty) {
    const w = this.world, x = tx + 0.5, y = ty + 0.5, b = w.gen.biomeAt(x, y);
    if (![B.MEADOW, B.FOREST, B.PINES, B.SWAMP, B.SNOW].includes(b) || !isGrass(x, y)) return false;
    const d = this.d(tx, ty), k = key(tx, ty);
    if (d && (d.tilled[k] !== undefined || d.placed?.[k] || d.floor?.[k] || d.trees?.[k] || d.dig?.[k] !== undefined)) return false;
    if (w.towerOf(tx, ty)) return false;   // (a watchtower's base: scenes.js)
    return !w.collidersNear(x, y).some(c => !c.dig && (c.r !== undefined ? Math.hypot(c.x - x, c.y - y) < c.r + 0.8 : !c.rx && x > c.x0 - 0.6 && x < c.x1 + 0.6 && y > c.y0 - 0.6 && y < c.y1 + 0.6));
  }
  plantTree(tx, ty, kind) {
    const g = this.game, d = this.d(tx, ty, true);
    d.trees ||= {};
    d.trees[key(tx, ty)] = { kind, day: this.today, ...(FRUIT[kind]?.bloom ? { from: FIRST_FRUIT } : null) };
    this.forgetTree(d, 'tree:' + key(tx, ty));
    g.inv.take(g.inv.selected, 1);
    g.gather.cooldown = 0.3;
    this.world.touchAround(tx, ty);
    Audio.till();
    g.gather.float(FRUIT[kind]?.bloom ? t('farm.tree.grows_fruit', { d: TREE_DAYS, f: FIRST_FRUIT }) : t('farm.tree.grows', { d: TREE_DAYS }), '#a8f0a0');
    g.stats?.add('arboles', 1);
  }

  // ---------- the orchard ----------
  orchardFrom(none) { const o = this.game.ranch?.farm?.orchard; return Number.isFinite(o) ? o : none; }
  // The calendar of a row of tiles on a day: { season, dos (there), spring (the calendar day its last spring began), year }
  calAt(day, ty) {
    const base = this.game.days.base, i = latOf(ty) < 0 ? 1 : 0, m = this.cals[i];
    if (m && m.day === day && m.base === base) return m;
    const cal = seasonOf(day + base);
    let s = cal;
    while (seasonAt(s.season, ty) !== 0) s = seasonOf(s.start - 1);
    return (this.cals[i] = { day, base, season: seasonAt(cal.season, ty), dos: day + base - cal.start + 1, spring: s.start, year: new Date(s.start * 864e5).getUTCFullYear() });
  }
  // Planted under the calendar and not old enough to bear yet
  youngFor(t) { return !!t?.from && this.today - t.day < t.from; }
  plantedOf(d, o) { return o.key.startsWith('tree:') ? d?.trees?.[o.key.slice(5)] : null; }
  // How a fruit tree stands today: as phaseAt, or 'young' (no fruit yet) or 'frost' (its blossom burnt: no fruit this year)
  phaseOf(d, o) {
    const cal = this.calAt(this.today, o.y), p = phaseAt(o.kind, cal.season, cal.dos);
    if (p === 'bare' || FRUIT[o.kind].always) return p;
    if (this.youngFor(this.plantedOf(d, o))) return 'young';
    return p !== 'leaf' && this.frosted(d, o, cal) ? 'frost' : p;
  }
  // Did a frost burn this year's blossom? A planted tree: the mark of the morning after; a wild one: the nights of its place
  frosted(d, o, cal) {
    if (this.plantedOf(d, o)) return d.frostYear?.[o.key] === cal.year;
    return this.blossomFrost(o.kind, Math.floor(o.x), Math.floor(o.y), cal);
  }
  // Nights before the calendar counted in this world (and tonight's) do not count
  blossomFrost(kind, tx, ty, cal) {
    const ck = `${kind}:${Math.floor(tx / CHUNK)},${Math.floor(ty / CHUNK)}`, m = this.frosts.get(ck), [a, b] = FRUIT[kind].bloom, from = this.orchardFrom(this.today);
    const last = Math.min(b, cal.day + cal.base - cal.spring);   // (the last night of blossom that is over)
    if (m && m.spring === cal.spring && m.last === last && m.from === from) return m.v;
    const l = this.land(tx, ty), N = this.next_, north = seasonOf(cal.spring).season;
    let v = false;
    for (let dos = a; dos <= last && !v; dos++) {
      const day = cal.spring + dos - 1 - cal.base;
      if (day >= from) v = fieldDay(north, dos, ty, l.Tl, this.game.days.weatherFor(day), N).min <= BLOSSOM_FROST;
    }
    if (this.frosts.size > 4000) this.frosts.clear();
    this.frosts.set(ck, { spring: cal.spring, last, from, v });
    return v;
  }
  // The frost of the night that has ended on the blossom of the planted trees of a chunk
  burnBlossom(d, cx, cy, day) {
    const ty = (cy + 0.5) * CHUNK, cal = this.calAt(day - 1, ty);
    if (cal.season !== 0 || this.fieldAt(day - 1, cx * CHUNK, cy * CHUNK).min > BLOSSOM_FROST) return;
    for (const [k, t] of Object.entries(d.trees)) {
      const b = FRUIT[t?.kind]?.bloom;
      if (b && cal.dos >= b[0] && cal.dos <= b[1] && !(t.from && day - 1 - t.day < t.from)) (d.frostYear ||= {})['tree:' + k] = cal.year;
    }
  }
  // Is there fruit on it to pick now?
  hasFruit(d, o) {
    const picked = d?.picked?.[o.key] ?? -99;
    if (picked > this.today - FRUIT_EVERY) return false;
    const p = this.phaseOf(d, o);
    return p === 'ripe' || (p !== 'young' && p !== 'bare' && this.grace(picked));
  }
  // The fruit that hung on a tree on the day the calendar began to count, in an older world: it can still be picked, a few
  // days more and once
  grace(picked) {
    const from = this.orchardFrom(this.today);
    return from >= 0 && this.today - from < FRUIT_GRACE && picked <= from - FRUIT_EVERY;
  }
  // Has a planted fruit tree fruit to be pecked, on that day? (the same, for any day)
  fruitOn(d, t, tk, tx, ty, day) {
    if (day - t.day < TREE_DAYS || (t.from && day - t.day < t.from) || (d.picked?.[tk] ?? -99) > day - FRUIT_EVERY) return false;
    const cal = this.calAt(day, ty);
    return phaseAt(t.kind, cal.season, cal.dos) === 'ripe' && d.frostYear?.[tk] !== cal.year;
  }
  // How it is drawn: look 'b' in blossom, 'f' its blossom burnt, 'g' its small green fruit, 'r' its fruit, '' nothing; bare:
  // without fruit (felled, it gives none)
  dress(d, o) {
    const fruit = this.hasFruit(d, o);
    o.bare = !fruit;
    if (!FRUIT[o.kind].bloom) return;
    const p = fruit ? 'ripe' : this.phaseOf(d, o), cal = this.calAt(this.today, o.y);
    o.look = p === 'ripe' ? (fruit ? 'r' : '') : p === 'bloom' ? 'b' : p === 'green' ? 'g' : p === 'frost' && phaseAt(o.kind, cal.season, cal.dos) === 'bloom' ? 'f' : '';
  }
  // (a tree that nobody picks, in the village: only by the calendar)
  lookNow(kind, ty) { const cal = this.calAt(this.today, ty), p = phaseAt(kind, cal.season, cal.dos); return p === 'ripe' ? 'r' : p === 'bloom' ? 'b' : p === 'green' ? 'g' : ''; }
  fruitTreeNear(p) {
    for (const o of this.world.harvestablesNear(p.x, p.y)) {
      if (!FRUIT[o.kind] || Math.hypot(o.x - p.x, o.y - p.y) > 1.4) continue;
      if (this.hasFruit(this.d(Math.floor(o.x), Math.floor(o.y)), o)) return o;
    }
    return null;
  }
  // Sacudirlo: cae la fruta y, hasta que vuelva a salir, no se ve en el árbol. With a hive near, now and then one more
  pickFruit(o) {
    const tx = Math.floor(o.x), ty = Math.floor(o.y), d = this.d(tx, ty, true), f = FRUIT[o.kind], g = this.game;
    if (!this.hasFruit(d, o)) return;   // (somebody else has just picked it)
    const pecks = d.pkt?.[o.key] || 0;
    const more = f.bloom && this.beesAt(tx, ty) && Math.random() < BEES.more ? 1 : 0;
    (d.picked ||= {})[o.key] = this.today;
    this.world.touch(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK));
    o.shakeUntil = g.time + 0.3;
    this.forget();
    g.gather.spawnDrops(o, { drops: [[f.item, Math.max(1, f.n[0] + more - pecks), Math.max(1, f.n[1] + more - pecks)]] });
    if (d.pkt) delete d.pkt[o.key];
    g.nature?.harvested(o.kind);   // (its fruit picked: Known in the nature book)
    Audio.swish();
  }
  // What it says: what E does, how it stands (aimed at; '' if E says it), and planting it
  treeName(kind) { return t(kind === 'fruit' ? 'farm.tree.apple' : kind === 'pear' ? 'farm.tree.pear' : kind === 'cherry' ? 'farm.tree.cherry' : kind === 'palm' ? 'farm.tree.palm' : 'farm.tree.tree'); }
  pickText(o) {
    const tx = Math.floor(o.x), ty = Math.floor(o.y);
    if (this.fresh('pick', o.key, tx, ty)) return this.said.pick.text;
    const text = t(o.kind === 'fruit' ? 'farm.tree.pick.apples' : o.kind === 'pear' ? 'farm.tree.pick.pears' : o.kind === 'cherry' ? 'farm.tree.pick.cherries' : 'farm.tree.pick.coconuts');
    return this.say('pick', o.key, tx, ty, FRUIT[o.kind].bloom && this.beesAt(tx, ty) ? t('farm.state.bees', { text }) : text);
  }
  plantText(kind) {
    if (this.fresh('plant', kind, 0, 0)) return this.said.plant.text;
    return this.say('plant', kind, 0, 0, FRUIT[kind]?.bloom ? t('farm.tree.plant_fruit', { tree: this.treeName(kind) }) : t('farm.tree.plant'));
  }
  treeText(o) {
    if (o.kind === 'palm') return '';
    const tx = Math.floor(o.x), ty = Math.floor(o.y);
    if (this.fresh('tree', o.key, tx, ty)) return this.said.tree.text;
    const d = this.d(tx, ty), p = this.phaseOf(d, o), cal = this.calAt(this.today, o.y), tr = this.plantedOf(d, o), picked = d?.picked?.[o.key] ?? -99;
    if (this.hasFruit(d, o)) return this.say('tree', o.key, tx, ty, '');   // (E says it)
    const state = p === 'young' ? t('farm.tree.young', { d: tr.day + tr.from - this.today })
      : p === 'frost' ? t('farm.tree.frost_blossom')
      : p === 'bloom' ? t('farm.tree.blossom')
      : p === 'ripe' ? t('farm.tree.again', { d: picked + FRUIT_EVERY - this.today })
      : t(['farm.tree.until.spring', 'farm.tree.until.summer', 'farm.tree.until.autumn'][nextFruit(o.kind, cal.season, cal.dos)]);
    return this.say('tree', o.key, tx, ty, t('farm.state.alone', { crop: this.treeName(o.kind), state }));
  }
  saplingText(tx, ty) {
    const d = this.d(tx, ty), s = d?.trees && d.trees[key(tx, ty)];
    if (!s || !HARVEST[s.kind] || this.today - s.day >= TREE_DAYS) return '';
    if (this.fresh('sap', s.kind, tx, ty)) return this.said.sap.text;
    return this.say('sap', s.kind, tx, ty, t('farm.state.alone', { crop: this.treeName(s.kind), state: t('farm.tree.sapling', { d: s.day + TREE_DAYS - this.today }) }));
  }
}
