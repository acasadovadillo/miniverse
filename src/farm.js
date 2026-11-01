// Huerto: sembrar en tierra labrada, regar (o que llueva), abonar y cosechar. Los cultivos crecen un paso
// cada mañana si la tierra estuvo mojada el día anterior. También se plantan árboles con bellotas, piñas
// o semillas de manzano, y los manzanos dan manzanas cada pocos días.
import { CROPS } from './items.js';
import { CHUNK } from './world/gen.js';
import { B } from './world/biomes.js';
import { inBounds, isGrass, pondDist } from './world/village.js';
import { cropSprite, saplingSprite, CROP_AX, CROP_AY } from './art/farm.js';
import { tilledSprite, TILL_AX, TILL_AY } from './art/items.js';
import { VIEW } from './iso.js';
import { ihash, mk } from './util.js';
import { Audio } from './audio.js';

export const CAN_MAX = 20;
const TREE_DAYS = 3;              // días que tarda un arbolito en hacerse árbol
const FRUIT_EVERY = 3;            // un manzano da manzanas cada tantos días
const key = (tx, ty) => `${tx},${ty}`;

// Tierra mojada: la misma casilla labrada, más oscura (q: girada con la cámara)
const wet = new Map();
function wetSprite(q) {
  if (wet.has(q)) return wet.get(q);
  const src = tilledSprite(q), c = mk(src.width, src.height), g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(30,18,10,.38)';
  g.fillRect(0, 0, c.width, c.height);
  wet.set(q, c);
  return c;
}

export class Farm {
  constructor(game) {
    this.game = game;
    this.can = 0;   // agua que queda en la regadera
    this.layer = { add: (cx, cy, d, out) => this.addContent(cx, cy, d, out), blocks: (tx, ty) => !!this.cropAt(tx, ty) };
  }
  get world() { return this.game.world; }
  get today() { return this.game.days.dayIndex; }
  reset(save) {
    this.can = save.can ?? 0;
    if (!this.world.layers.includes(this.layer)) this.world.layers.push(this.layer);
  }
  save(out) { out.can = this.can; }

  d(tx, ty, create) { return this.world.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK), create); }
  cropAt(tx, ty) { return this.d(tx, ty)?.crops?.[key(tx, ty)]; }
  ready(c) { return c && !c.dead && c.grow >= CROPS[c.id].days; }
  stage(c) {
    if (c.dead) return -1;
    const days = CROPS[c.id].days;
    return c.grow >= days ? 3 : c.grow >= days / 2 ? 2 : c.grow >= 1 ? 1 : 0;
  }

  // Cultivos y árboles plantados de un trozo
  addContent(cx, cy, d, out) {
    if (!d) return;
    for (const [k, c] of Object.entries(d.crops || {})) {
      const [tx, ty] = k.split(',').map(Number);
      out.objects.push({ img: cropSprite(c.id, this.stage(c)), x: tx + 0.5, y: ty + 0.5, ax: CROP_AX, ay: CROP_AY, key: 'crop:' + k, tile: [tx, ty], crop: c });
    }
    for (const [k, t] of Object.entries(d.trees || {})) {
      const [tx, ty] = k.split(',').map(Number), x = tx + 0.5, y = ty + 0.5;
      if (this.today - t.day < TREE_DAYS) {
        out.objects.push({ img: saplingSprite(t.kind), x, y, ax: 36, ay: 91, key: 'sap:' + k, tile: [tx, ty] });
        out.colliders.push({ x, y, r: 0.15 });
      } else {
        const list = this.world.gen.props[t.kind];
        const o = { kind: t.kind, img: list[Math.floor(ihash(tx, ty, 3) * list.length)], x, y, ax: 36, ay: 91, key: 'tree:' + k, tile: [tx, ty], planted: this };
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

  // Cada mañana: crecen los cultivos regados, los de fuera de temporada se secan, la lluvia y los aspersores riegan
  onDay(day) {
    const w = this.world, season = this.game.days.season, rain = !!this.game.days.info.rain;
    for (const [ck, d] of w.deltas) {
      if (!d.crops && !d.placed) continue;
      let changed = false;
      d.wet ||= {};
      for (const [k, c] of Object.entries(d.crops || {})) {
        if (c.dead) continue;
        const crop = CROPS[c.id];
        if (!crop.seasons.includes(season)) { c.dead = true; changed = true; continue; }
        if (d.wet[k] === day - 1 && c.grow < crop.days) { c.grow += c.fert ? 1.5 : 1; changed = true; }
      }
      // Hoy riegan la lluvia y los aspersores
      if (rain) for (const k of Object.keys(d.tilled)) d.wet[k] = day;
      for (const [k, raw] of Object.entries(d.placed || {})) {
        if (raw !== 'aspersor') continue;
        const [tx, ty] = k.split(',').map(Number);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nd = this.d(tx + dx, ty + dy), nk = key(tx + dx, ty + dy);
          if (nd?.tilled[nk] !== undefined) { nd.wet ||= {}; nd.wet[nk] = day; }
        }
      }
      if (d.trees && Object.keys(d.trees).length) changed = true;   // los arbolitos crecen
      if (changed) { const [cx, cy] = ck.split(',').map(Number); w.touch(cx, cy); }
    }
  }

  // Qué hacer con lo que se lleva en la mano mirando a una casilla
  target(p, held, def) {
    const g = this.game;
    if (g.scene !== this.world) return null;
    const tx = Math.floor(p.x + p.face.x * 0.9), ty = Math.floor(p.y + p.face.y * 0.9), d = this.d(tx, ty), k = key(tx, ty);
    const crop = d?.crops?.[k], tilled = d?.tilled[k] !== undefined, tile = [tx, ty];
    if (crop && this.ready(crop) && !def?.place) return { tile, ok: true, label: 'Cosechar', use: () => this.harvest(tx, ty) };
    if (crop?.dead && !def?.place) return { tile, ok: true, label: 'Quitar la planta seca', use: () => { delete d.crops[k]; this.world.touchAround(tx, ty); Audio.swish(); } };
    if (def?.seed) {
      if (!tilled || crop) return null;
      const c = CROPS[def.seed];
      if (!c.seasons.includes(g.days.season)) return { tile, ok: false, label: `No es temporada de ${c.name.toLowerCase()}` };
      return { tile, ok: true, label: `Sembrar ${c.name.toLowerCase()}`, use: () => this.sow(tx, ty, def.seed) };
    }
    if (def?.tool === 'regadera') {
      const water = this.waterAhead(p);
      if (water) return { tile: null, ok: true, label: `Llenar la regadera (${this.can}/${CAN_MAX})`, use: () => this.refill() };
      if (tilled) return { tile, ok: true, auto: true, label: `Regar (${this.can}/${CAN_MAX})`, use: () => this.water(tx, ty) };
      return null;
    }
    if (held?.id === 'abono' && crop && !crop.dead && !crop.fert && !this.ready(crop)) return { tile, ok: true, label: 'Abonar', use: () => this.fertilize(crop, tx, ty) };
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
      if (this.ready(c) && Math.hypot(tx + 0.5 - p.x, ty + 0.5 - p.y) < 1.2) return { text: 'Cosechar', run: () => this.harvest(tx, ty) };
    }
    const tree = this.fruitTreeNear(p);
    if (tree) return { text: 'Coger manzanas', run: () => this.pickApples(tree) };
    return null;
  }

  waterAhead(p) {
    for (const r of [1, 1.6]) {
      const x = p.x + p.face.x * r, y = p.y + p.face.y * r;
      if (this.world.water(x, y) || (inBounds(x, y) && pondDist(x, y) < 1)) return true;
    }
    return false;
  }
  refill() { this.can = CAN_MAX; Audio.noiseHit(900, 0.3, 0.2); this.game.gather.float('Regadera llena', '#9ad0ff'); }
  water(tx, ty) {
    const g = this.game;
    if (this.can <= 0) { g.gather.float('La regadera está vacía: llénala en el agua', '#ffb0a0'); Audio.error(); return; }
    if (!g.gather.spend('regadera')) return;
    const d = this.d(tx, ty, true);
    d.wet ||= {};
    d.wet[key(tx, ty)] = this.today;
    this.can--;
    g.gather.cooldown = 0.3;
    this.world.chestTouched(tx, ty);
    g.gather.chips(tx + 0.5, ty + 0.5, 'water', 8);
    Audio.noiseHit(1400, 0.25, 0.15, 'highpass');
    g.skills?.gain('agricultura', 0.3);
  }
  sow(tx, ty, id) {
    const g = this.game, d = this.d(tx, ty, true);
    d.crops ||= {};
    d.crops[key(tx, ty)] = { id, grow: 0, day: this.today };
    g.inv.remove('semilla_' + id, 1);
    g.gather.cooldown = 0.25;
    this.world.touchAround(tx, ty);
    Audio.till();
    g.skills?.gain('agricultura', 0.5);
  }
  fertilize(crop, tx, ty) {
    crop.fert = true;
    this.game.inv.remove('abono', 1);
    this.world.touchAround(tx, ty);
    this.game.gather.float('Abonado: crecerá más deprisa', '#a8f0a0');
  }
  harvest(tx, ty) {
    const g = this.game, d = this.d(tx, ty), k = key(tx, ty), c = d.crops[k], crop = CROPS[c.id];
    const n = c.id === 'fresa' ? 2 + Math.floor(Math.random() * 2) : c.id === 'trigo' ? 2 : 1 + (Math.random() < 0.25 + (g.skills?.bonus('agricultura') || 0) ? 1 : 0);
    g.gather.spawnDrops({ x: tx + 0.5, y: ty + 0.5 }, { drops: [[c.id, n, n], ['semilla_' + c.id, 1, 1, 0.12]] });
    if (crop.regrow) c.grow = crop.days - crop.regrow;
    else delete d.crops[k];
    this.world.touchAround(tx, ty);
    g.gather.chips(tx + 0.5, ty + 0.5, 'leaf', 8);
    Audio.pickup();
    g.skills?.gain('agricultura', 2);
    g.stats?.add('cosechas', 1);
  }

  canPlant(tx, ty) {
    const w = this.world, x = tx + 0.5, y = ty + 0.5, b = w.gen.biomeAt(x, y);
    if (![B.MEADOW, B.FOREST, B.PINES, B.SWAMP, B.SNOW].includes(b) || !isGrass(x, y)) return false;
    const d = this.d(tx, ty), k = key(tx, ty);
    if (d && (d.tilled[k] !== undefined || d.placed?.[k] || d.floor?.[k] || d.trees?.[k])) return false;
    return !w.collidersNear(x, y).some(c => (c.r !== undefined ? Math.hypot(c.x - x, c.y - y) < c.r + 0.8 : !c.rx && x > c.x0 - 0.6 && x < c.x1 + 0.6 && y > c.y0 - 0.6 && y < c.y1 + 0.6));
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

  // Manzanos (del mundo o plantados) con fruta madura cerca
  fruitTreeNear(p) {
    if (this.game.days.season === 3) return null;
    for (const o of this.world.harvestablesNear(p.x, p.y)) {
      if (o.kind !== 'fruit' || Math.hypot(o.x - p.x, o.y - p.y) > 1.4) continue;
      const d = this.d(Math.floor(o.x), Math.floor(o.y), true);
      d.picked ||= {};
      if ((d.picked[o.key] ?? -99) <= this.today - FRUIT_EVERY) return o;
    }
    return null;
  }
  pickApples(o) {
    const d = this.d(Math.floor(o.x), Math.floor(o.y), true);
    d.picked[o.key] = this.today;
    this.world.chestTouched(Math.floor(o.x), Math.floor(o.y));
    o.shakeUntil = this.game.time + 0.3;
    this.game.gather.spawnDrops(o, { drops: [['manzana', 2, 3]] });
    Audio.swish();
  }

  // Tierra mojada (encima de la labrada)
  drawGround(ctx, cam, scene) {
    if (scene !== this.world) return;
    const today = this.today;
    for (const ch of scene.visible) {
      const d = scene.delta(ch.cx, ch.cy);
      if (!d?.wet) continue;
      for (const [k, day] of Object.entries(d.wet)) {
        if (day !== today || d.tilled[k] === undefined) continue;
        const [tx, ty] = k.split(',').map(Number), [sx, sy] = scene.P(tx + 0.5, ty + 0.5);   // desde el centro (la esquina de arriba depende de la cámara)
        ctx.drawImage(wetSprite(VIEW.r), sx - TILL_AX - cam.x, sy - TILL_AY - cam.y);
      }
    }
  }
}
