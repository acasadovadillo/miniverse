// Huerto: sembrar en tierra labrada, regar (o que llueva), abonar y cosechar. También se plantan árboles con bellotas, piñas
// o semillas de manzano; los manzanos dan manzanas y las palmeras, cocos, cada pocos días (se cogen con E).
//
// What makes a crop grow is the weather of its field (fieldclimate.js) and the water in its soil, not the calendar: every
// morning (onDay, only in the game that runs the world) each crop grows by how good the day before was for it (cropdata.js),
// the soil dries with the sun, and frost and drought can kill. On a morning after a day nobody played in this world they
// only wilt, and what is ripe does not spoil. Design: docs/planes/realismo/PLAN-R2-huerto.md. What a chunk keeps:
//   d.tilled[k], d.wet[k]   the bed and the last day it was watered (as always: older games read them)
//   d.moist[k]              how much water the soil holds, 0..100 (missing: as if just watered, if it was; see moistOf)
//   d.mulch[k]              the day straw was spread on it
//   d.soil[k]               its fertility and what grew on it (soil.js: harvests take from it, manure and compost give back)
//   d.crops[k]              { id, grow, day, fert?, dead?: true | 'frost' | 'drought' | 'rot', hs, hn (its health: the sum
//                           and how many days), dry (mornings in a row without water), wt (days a seed has waited), ripe
//                           (the day it ripened), bolt (the day it went to seed), fb (the day frost bit it), leg (the first
//                           morning of one planted before the weather decided), picks (how many times a plant that gives
//                           again has given), fert (from before the soil counted: it grows faster until its harvest) }
import { CROPS, HARVEST, ITEMS, itemNoun, thingNoun } from './items.js';
import { THIRST_MAX } from './needs.js';
import { t, fmt, getLang } from './i18n.js';
import { CHUNK } from './world/gen.js';
import { B } from './world/biomes.js';
import { inBounds, isGrass, pondDist } from './world/village.js';
import { Audio } from './audio.js';
import { parsePlaced } from './pieces.js';
import { canopyOf, broadDims, palmDims } from './world/treedims.js';
import { climate } from './world/biomes.js';
import { seasonOf, WEATHER } from './time.js';
import { fieldDay } from './fieldclimate.js';
import { GROW, WATER, DRY, SNOW_WATER, MULCH_DAYS, MULCH_FROST, SEED_WAIT, GRACE, OLD_RIPE, OLD_RATE, FROST_LOOK, BOLT_SEEDS, seedOf, rateAt, waterAt, dryingAt, yieldAt, qualityOf } from './cropdata.js';
import { SOIL, FOOD, OLD_FERT, OLD_FERT_RATE, FAMILY_TIRED, TIRED_HEALTH, RICH_MORE, BEES, SOIL_MAX, soilStart, fertAt, takesFrom, clampSoil, soilWord, soilTone } from './soil.js';
import { dxOf } from './world/planet.js';
import { Profile } from './accounts.js';
import { hud } from './ui/hud.js';

export const CAN_MAX = 20;
const TREE_DAYS = 3;              // días que tarda un arbolito en hacerse árbol
const FRUIT_EVERY = 3;            // un manzano da manzanas (y una palmera, cocos) cada tantos días
// Lo que da cada árbol con fruta al cogerla, cómo se dice y si en invierno no tiene
const FRUIT = { fruit: { drops: [['manzana', 2, 3]], text: 'Coger manzanas', winter: false }, palm: { drops: [['coco', 1, 3]], text: 'Coger cocos', winter: true } };
const key = (tx, ty) => `${tx},${ty}`;
const TICK = 5;                   // s between two looks at the clock (who plays today, the frost warning)
const WARN_FROM = 17, WARN_TO = 23, WARN_R = 64;   // the frost warning: between these hours, for the tender crops this near
const MULCH = new Set(['straw', 'heno']);
// (the family a soil can be tired of, as it is said)
const FAMILIES = new Map([['brassica', 'farm.family.brassica'], ['root', 'farm.family.root'], ['nightshade', 'farm.family.nightshade'], ['grass', 'farm.family.grass'], ['cucurbit', 'farm.family.cucurbit'], ['allium', 'farm.family.allium'], ['legume', 'farm.family.legume'], ['berry', 'farm.family.berry']]);
const HARVEST_COLOR = { excellent: '#ffe08a', good: '#a8f0a0', poor: '#d8c3a0' };
const WATERS = { aspersor: 1, noria: 4 };   // lo que riega solo cada mañana: hasta cuántas casillas a cada lado

export class Farm {
  constructor(game) {
    this.game = game;
    this.can = 0;   // agua que queda en la regadera
    this.lands = new Map();   // chunk → { Tl, swamp } (they never change)
    this.day_ = {}; this.next_ = {};   // (reused by fieldAt)
    this.tickT = 0; this.warned = -1; this.said = {}; this.days = {}; this.line = { text: '', key: '' };
    this.layer = { add: (cx, cy, d, out) => this.addContent(cx, cy, d, out), blocks: (tx, ty) => !!this.cropAt(tx, ty) };
  }
  get world() { return this.game.world; }
  get today() { return this.game.days.dayIndex; }
  reset(save) {
    this.can = save.can ?? 0;
    this.warned = -1; this.forget(); this.lands.clear(); this.days = {};
    if (!this.world.layers.includes(this.layer)) this.world.layers.push(this.layer);
  }
  save(out) { out.can = this.can; }

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
  // How it looks besides its age: w wilted, f frost-bitten, o past its best, b gone to seed; dead: k frost, d drought, r rotten
  look(c) {
    if (c.dead) return c.dead === 'frost' ? 'k' : c.dead === 'drought' ? 'd' : c.dead === 'rot' ? 'r' : '';
    if (c.bolt !== undefined) return 'b';
    if (c.fb !== undefined && this.today - c.fb < FROST_LOOK) return 'f';
    if (this.over(c)) return 'o';
    return c.dry >= WATER.thirsty ? 'w' : '';
  }
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
  moistOf(d, k, day = this.today) {
    const m = d?.moist?.[k];
    if (m !== undefined) return m;
    return d?.wet?.[k] >= day - 1 || WEATHER[this.weatherOn(day)].rain ? 100 : WATER.unknown;
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
  daysHere(id, tx, ty) {
    const m = this.days[id], l = this.land(tx, ty), today = this.today;
    if (m && m.l === l && m.day === today) return m.n;
    const n = this.daysTo(id, ty, l.Tl);
    this.days[id] = { l, day: today, n };
    return n;
  }
  daysTo(id, ty, Tl) {
    const crop = CROPS[id], g = GROW[id], base = this.game.days.base, out = this.next_;
    let grow = 0, idle = 0;
    for (let i = 0; i < 100; i++) {
      const cal = seasonOf(this.today + base + i);
      fieldDay(cal.season, this.today + base + i - cal.start + 1, ty, Tl, i % 2 ? 'nubes' : 'sol', out);
      const r = rateAt(id, out.mean);
      idle = r > 0 ? 0 : idle + 1;
      if (out.min <= g.kill || (grow < 1 && idle > SEED_WAIT)) return Infinity;
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
    // (once the days missed have been lived: they were not played)
    if (!g.live.guest && g.days.day === g.days.realDay && (!Profile.server || g.live.othersPlaying) && g.ranch.farm.seen !== today) g.ranch.farm.seen = today;
    const h = g.days.localHour;
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
      for (const [k, c] of Object.entries(d.crops)) if (GROW[c?.id] && !c.dead && c.bolt === undefined && F.min + (d.mulch?.[k] !== undefined ? MULCH_FROST : 0) <= GROW[c.id].bite) out.add(c.id);
    }
    return [...out];
  }
  // «tomato and pumpkin»
  names(ids) { return fmt.list(ids.map(id => t('farm.name_low', { crop: itemNoun(id) }))); }

  // Cultivos y árboles plantados de un trozo (y, en los árboles con fruta recién cogida, que no se vea: bare)
  addContent(cx, cy, d, out) {
    if (!d) return;
    if (d.picked) out.objects.forEach((o, i) => { if (FRUIT[o.kind] && !this.hasFruit(d, o)) out.objects[i] = { ...o, bare: true }; });
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
        const o = { kind: t.kind, x, y, key: 'tree:' + k, tile: [tx, ty], planted: this };
        out.objects.push(o);
        out.colliders.push({ x, y, r: 0.35 });
      }
    }
  }
  // Talar un árbol plantado: desaparece (no vuelve a crecer solo)
  remove(o) {
    const [tx, ty] = o.tile, d = this.d(tx, ty);
    delete d.trees[key(tx, ty)];
    this.world.touchAround(tx, ty);
  }

  // Every morning (day): what happened to each bed on the day and the night before, and the water today brings. In this
  // order: the crop grows with the water it had, the frost of the night, the soil dries, the rain, the sprinklers and the
  // water wheels wet it. Only numbers from the place, the day and the world's seed: living a day again gives the same
  onDay(day) {
    if (this.game.live.guest) return;   // (en el mundo de otro, los cultivos los hace crecer su juego)
    const w = this.world, played = this.playedOn(day - 1), F = this.day_, N = this.next_, waters = [];
    for (const [ck, d] of w.deltas) {
      if (ck.startsWith('u:') || (!d.crops && !d.placed && !d.trees && !d.soil)) continue;
      const [cx, cy] = ck.split(',').map(Number);
      let changed = !!d.trees && Object.keys(d.trees).length > 0, any = false;   // (los arbolitos crecen)
      for (const k in d.tilled) { any = true; break; }
      if (any) {
        const tx = cx * CHUNK, ty = cy * CHUNK, swamp = this.land(tx, ty).swamp, start = this.soilStartAt(tx, ty);
        this.fieldAt(day - 1, tx, ty, F); this.fieldAt(day, tx, ty, N);
        const rain = !!WEATHER[N.weather].rain, snow = N.weather === 'nieve', dry = dryingAt(F.max, F.weather), rained = !!WEATHER[F.weather].rain;
        d.wet ||= {}; d.moist ||= {};
        for (const k in d.tilled) {
          let m = d.moist[k] ?? (d.wet[k] >= day - 1 || rained ? 100 : WATER.unknown);
          if (d.mulch?.[k] !== undefined && day - d.mulch[k] >= MULCH_DAYS) delete d.mulch[k];
          const mulch = d.mulch?.[k] !== undefined, c = d.crops?.[k];
          if (c && !c.dead && CROPS[c.id] && GROW[c.id]) {
            const s = ((d.soil ||= {})[k] ||= [start, GROW[c.id].fam, 1]);   // (sown before the soil counted: what its land has)
            if (c.fert === true) { c.fert = 2; s[0] = clampSoil(s[0] + OLD_FERT); }
            this.growCrop(c, day, F, m, mulch ? MULCH_FROST : 0, played, s[0]);
          } else if (!c || c.dead) this.restSoil(d, k, start);
          m = Math.max(swamp ? WATER.damp + 5 : 0, m - dry * (mulch ? DRY.mulch : 1));
          if (rain) { m = 100; d.wet[k] = day; } else if (snow) m = Math.min(100, m + SNOW_WATER);
          if (c?.dry && !c.dead) { if (m >= WATER.full) delete c.dry; else if (c.dry >= WATER.dryDays && played && !this.graced(c, day)) c.dead = 'drought'; }
          d.moist[k] = Math.round(m);
        }
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
  growCrop(c, day, F, m, warm, played, soil = 60) {
    const g = GROW[c.id], crop = CROPS[c.id];
    // (planted before the weather decided: it keeps growing in what were its seasons, and what was ripe waits a few days more)
    if (c.hn === undefined) { c.hs = 0; c.hn = 0; c.leg = day; if (c.grow >= crop.days) c.ripe = day + OLD_RIPE; }
    if (c.bolt !== undefined) return;
    const min = F.min + warm, bitten = min <= g.bite;
    if (min <= g.kill && played && !this.graced(c, day)) { c.dead = 'frost'; return; }
    if (bitten) c.fb = day;
    if (c.grow < crop.days) {
      let r = rateAt(c.id, F.mean);
      if (c.leg !== undefined && day - c.leg < OLD_RATE) r = Math.max(r, g.was.includes(F.season) ? 1 : 0.5);
      const w = waterAt(m, c.grow < crop.days / 2), fert = fertAt(soil), grew = r * w * (c.fert ? Math.max(fert, OLD_FERT_RATE) : fert);
      if (w === 1) delete c.dry;
      else if (w === 0 && c.grow > 0) c.dry = played ? (c.dry || 0) + 1 : Math.max(c.dry || 0, Math.min(WATER.thirsty, (c.dry || 0) + 1));
      if (r > 0 && (c.grow > 0 || w > 0)) { c.hs = Math.round((c.hs + w * Math.min(1, c.fert ? 1 : fert) * (bitten ? 0.5 : 1)) * 100) / 100; c.hn++; }
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
    else { c.grow = crop.days - crop.regrow; delete c.ripe; }
  }

  // Qué hacer con lo que se lleva en la mano mirando a una casilla
  target(p, held, def) {
    const g = this.game;
    if (g.scene !== this.world) return null;
    const [tx, ty] = g.aimTile(), d = this.d(tx, ty), k = key(tx, ty);
    const crop = d?.crops?.[k], tilled = d?.tilled[k] !== undefined, tile = [tx, ty];
    if (def?.tool === 'guadana' && this.reapable(crop)) return { tile, ok: true, auto: true, label: t('farm.reap'), use: () => this.reap(tx, ty) };
    if (this.takes(crop) && !def?.place) return { tile, ok: true, label: this.cropText(crop), use: () => this.take(tx, ty) };
    // The scythe cuts down a crop that is not ready yet (to fix a mistake or clear the field); the seed comes back.
    // (Not one from a newer version this game doesn't know: it stays as it is.)
    if (crop && CROPS[crop.id] && def?.tool === 'guadana') return { tile, ok: true, label: t('farm.cut_crop'), use: () => this.cut(tx, ty) };
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
      return { tile, ok, label: ok ? 'Plantar un árbol' : '', use: () => (ok ? this.plantTree(tx, ty, def.sapling) : Audio.error()) };
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
    if (tree) return { text: FRUIT[tree.kind].text, run: () => this.pickFruit(tree) };
    return null;
  }

  aimables(p, scene, box) {
    if (scene !== this.world) return null;
    const out = [], winter = this.game.days.season === 3;
    for (const o of this.world.harvestablesNear(p.x, p.y)) {
      const f = FRUIT[o.kind];
      if (!f || (winter && !f.winter) || Math.hypot(o.x - p.x, o.y - p.y) > 4 || !this.hasFruit(this.d(Math.floor(o.x), Math.floor(o.y)), o)) continue;
      // (tree: its outline and aim are the tree's own instances; the box, the whole tree, crown and coconuts too)
      const r = canopyOf(o) + 0.3, h = (o.kind === 'palm' ? palmDims(o).H : broadDims(o, 0).H) + 0.5;
      out.push({ kind: 'sys', tree: o, exact: true, box: box(o.x, o.y, r, r, 0, h), act: () => ({ text: f.text, run: () => this.pickFruit(o) }) });
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
    if (g.scene !== this.world || g.gamemode === 'spectator' || d?.tilled?.[k] === undefined || this.cropAt(tx, ty)) return false;
    delete d.tilled[k];
    for (const f of [d.wet, d.moist, d.mulch]) if (f) delete f[k];
    this.world.dropLevel?.(tx, ty);
    this.world.touchAround(tx, ty);
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
    return { text: more ? `${this.cropText(c)} · ${more}` : this.cropText(c), run: () => this.take(tx, ty) };
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
      if (Math.random() < (g.skills?.bonus('agricultura') || 0)) n++;
      if (s[0] > SOIL.rich && Math.random() < RICH_MORE) n++;
      if (GROW[c.id].bees && Math.random() < BEES.more && this.beesAt(tx, ty)) n++;
      g.gather.spawnDrops(at, { drops: straw ? [[c.id, n, n], ['straw', straw, straw]] : [[c.id, n, n]] });
      if (word && !quiet) g.gather.float(t('farm.harvest.quality.' + word), HARVEST_COLOR[word]);
      g.nature?.harvested(c.id);   // (harvested: Known in the nature book)
    }
    s[0] = clampSoil(s[0] - takesFrom(c.id, c.picks > 0));
    if (crop.regrow && c.bolt === undefined) { c.grow = crop.days - crop.regrow; c.picks = (c.picks || 0) + 1; delete c.ripe; delete c.fert; }
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
    const grown = this.age(c) >= 2, n = c.dead === 'rot' ? (c.grow < 1 ? [0, 0] : [1, 2]) : c.dead === 'frost' ? (grown ? [2, 2] : [1, 1]) : c.dead === 'drought' ? [1, 1] : [0, 0];
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
    const g = GROW[id], crop = itemNoun(id), F = this.fieldAt(this.today, tx, ty), c = Math.round(F.mean), warm = this.d(tx, ty)?.mulch?.[key(tx, ty)] !== undefined ? MULCH_FROST : 0;
    if (F.min + warm <= g.kill) return this.say('sow', id, tx, ty, t('farm.sow.cold_tonight', { crop }), false);
    if (F.mean <= g.base) return this.say('sow', id, tx, ty, t('farm.sow.cold_yet', { crop, c, need: g.base + 1 }));
    if (F.mean >= g.stop) return this.say('sow', id, tx, ty, t('farm.sow.hot', { crop, c }));
    const n = this.daysHere(id, tx, ty), s = this.soilOf(this.d(tx, ty), key(tx, ty), tx, ty), tired = s[1] === g.fam ? this.tiredText(s, 1) : '';
    const text = n < Infinity ? t('farm.sow', { crop, days: n }) : t('farm.sow.wont', { crop });
    return this.say('sow', id, tx, ty, tired ? t('farm.sow.tired', { text, tired }) : text);
  }
  // The tile looked at: what grows there and how, and its soil ('' if it is not tilled)
  status(tx, ty, slot = 'tile') {
    if (this.fresh(slot, '', tx, ty)) return this.said[slot].text;
    const d = this.d(tx, ty), k = key(tx, ty);
    if (d?.tilled?.[k] === undefined) return '';
    const c = d.crops?.[k], known = c && CROPS[c.id], s = this.soilOf(d, k, tx, ty), water = d.mulch?.[k] !== undefined ? t('farm.soil.mulched', { soil: this.soilText(d, k) }) : this.soilText(d, k);
    const soil = t('farm.soil.both', { soil: water, food: this.tiredText(s) || this.soilFertText(s, tx, ty) });
    if (c && !known) return this.say(slot, '', tx, ty, '');   // (from a newer version)
    if (!c) return this.say(slot, '', tx, ty, t('farm.state.bare', { soil }));
    const crop = itemNoun(c.id), state = this.stateText(c, tx, ty, this.moistOf(d, k));
    if (c.dead || c.bolt !== undefined || slot === 'take') return this.say(slot, '', tx, ty, t('farm.state.alone', { crop, state }));
    const text = t('farm.state.crop', { crop, state, soil });
    return this.say(slot, '', tx, ty, GROW[c.id].bees && this.beesAt(tx, ty) ? t('farm.state.bees', { text }) : text);
  }
  stateText(c, tx, ty, m) {
    const g = GROW[c.id], days = CROPS[c.id].days;
    if (c.dead) return t(c.dead === 'frost' ? 'farm.state.dead_frost' : c.dead === 'drought' ? 'farm.state.dead_drought' : c.dead === 'rot' ? 'farm.state.dead_rot' : 'farm.state.dead');
    if (c.bolt !== undefined) return t('farm.state.bolting');
    if (c.grow >= days) return this.over(c) ? t('farm.state.overripe') : t('farm.state.ripe', { n: g.window - Math.max(0, this.today - (c.ripe ?? this.today)) });
    if (c.dry >= WATER.thirsty) return t('farm.state.wilted');
    if (waterAt(m, c.grow < days / 2) < 0.5) return t('farm.state.thirsty');
    if (c.fb !== undefined && this.today - c.fb < FROST_LOOK) return t('farm.state.frostbit');
    const F = this.fieldAt(this.today, tx, ty);
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
    const [tx, ty] = g.aimTile(), text = this.status(tx, ty);
    if (!text) return '';
    this.line.text = text;
    return this.line;
  }

  // ---------- the almanac (the diary's Farm tab) ----------
  // Here and now: the day, the nights to come, and how each crop would do sown today
  almanac(x, y) {
    const tx = Math.floor(x), ty = Math.floor(y), T = {};
    this.fieldAt(this.today, tx, ty, T);
    const nights = [];
    for (let i = 0; i < 7; i++) { const F = this.fieldAt(this.today + i, tx, ty, {}); nights.push({ min: F.min, icon: WEATHER[F.weather].icon }); }
    const crops = Object.keys(GROW).map(id => {
      const g = GROW[id], n = this.daysHere(id, tx, ty);
      return { id, days: n, kill: g.kill, now: T.min <= g.kill ? 'tonight' : n === Infinity ? 'no' : T.mean <= g.base || T.mean >= g.stop ? 'wait' : 'now' };
    });
    return { mean: T.mean, min: T.min, max: T.max, nights, crops, soil: this.soilCount(x, y) };
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
    const rows = a.crops.slice().sort((x, y) => (x.now === 'now' ? 0 : 1) - (y.now === 'now' ? 0 : 1) || x.days - y.days).map(c => `<div class="j-row"><b>${t('farm.name', { crop: thingNoun(c.id) })}</b><span class="lvl">${t('farm.almanac.' + c.now, { n: c.days })}</span><small>${t('farm.almanac.frost', { c: c.kill })}</small></div>`).join('');
    const nights = a.nights.map(n => `${n.icon} ${r(n.min)}°`).join(' · '), beds = a.soil.rich + a.soil.fertile + a.soil.tired + a.soil.poor;
    return `<p class="j-note"><b>${t('farm.almanac.title')}</b><br>${t('farm.almanac.here', { mean: r(a.mean), min: r(a.min), max: r(a.max) })}${a.min <= 2 ? ' ' + t('farm.almanac.tonight_frost') : ''}<br>${t('farm.almanac.nights', { list: nights })}${beds ? '<br>' + t('farm.almanac.soil', a.soil) : ''}<br>${t('farm.almanac.help')}<br>${t('farm.almanac.soil_help')}</p>${rows}`;
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
    d.trees[key(tx, ty)] = { kind, day: this.today };
    g.inv.take(g.inv.selected, 1);
    g.gather.cooldown = 0.3;
    this.world.touchAround(tx, ty);
    Audio.till();
    g.gather.float(`Crecerá en ${TREE_DAYS} días`, '#a8f0a0');
    g.stats?.add('arboles', 1);
  }

  // Árboles con fruta (manzanos y palmeras, del mundo o plantados) con la fruta madura cerca
  hasFruit(d, o) { return (d?.picked?.[o.key] ?? -99) <= this.today - FRUIT_EVERY; }
  fruitTreeNear(p) {
    const winter = this.game.days.season === 3;
    for (const o of this.world.harvestablesNear(p.x, p.y)) {
      const f = FRUIT[o.kind];
      if (!f || (winter && !f.winter) || Math.hypot(o.x - p.x, o.y - p.y) > 1.4) continue;
      if (this.hasFruit(this.d(Math.floor(o.x), Math.floor(o.y)), o)) return o;
    }
    return null;
  }
  // Sacudirlo: cae la fruta y, hasta que vuelva a salir, no se ve en el árbol
  pickFruit(o) {
    const tx = Math.floor(o.x), ty = Math.floor(o.y), d = this.d(tx, ty, true);
    (d.picked ||= {})[o.key] = this.today;
    this.world.touch(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK));
    o.shakeUntil = this.game.time + 0.3;
    this.game.gather.spawnDrops(o, { drops: FRUIT[o.kind].drops });
    this.game.nature?.harvested(o.kind);   // (its fruit picked: Known in the nature book)
    Audio.swish();
  }

}
