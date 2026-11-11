// Huerto: sembrar en tierra labrada, regar (o que llueva), abonar y cosechar. Los cultivos crecen un paso
// cada mañana si la tierra estuvo mojada el día anterior. También se plantan árboles con bellotas, piñas
// o semillas de manzano; los manzanos dan manzanas y las palmeras, cocos, cada pocos días (se cogen con E).
import { CROPS } from './items.js';
import { CHUNK } from './world/gen.js';
import { B } from './world/biomes.js';
import { inBounds, isGrass, pondDist } from './world/village.js';
import { Audio } from './audio.js';
import { parsePlaced } from './pieces.js';

export const CAN_MAX = 20;
const TREE_DAYS = 3;              // días que tarda un arbolito en hacerse árbol
const FRUIT_EVERY = 3;            // un manzano da manzanas (y una palmera, cocos) cada tantos días
// Lo que da cada árbol con fruta al cogerla, cómo se dice y si en invierno no tiene
const FRUIT = { fruit: { drops: [['manzana', 2, 3]], text: 'Coger manzanas', winter: false }, palm: { drops: [['coco', 1, 3]], text: 'Coger cocos', winter: true } };
const key = (tx, ty) => `${tx},${ty}`;
const WATERS = { aspersor: 1, noria: 4 };   // lo que riega solo cada mañana: hasta cuántas casillas a cada lado

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

  // Cultivos y árboles plantados de un trozo (y, en los árboles con fruta recién cogida, que no se vea: bare)
  addContent(cx, cy, d, out) {
    if (!d) return;
    if (d.picked) out.objects.forEach((o, i) => { if (FRUIT[o.kind] && !this.hasFruit(d, o)) out.objects[i] = { ...o, bare: true }; });
    for (const [k, c] of Object.entries(d.crops || {})) {
      const [tx, ty] = k.split(',').map(Number);
      out.objects.push({ x: tx + 0.5, y: ty + 0.5, key: 'crop:' + k, tile: [tx, ty], crop: c });
    }
    for (const [k, t] of Object.entries(d.trees || {})) {
      const [tx, ty] = k.split(',').map(Number), x = tx + 0.5, y = ty + 0.5;
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

  // Cada mañana: crecen los cultivos regados, los de fuera de temporada se secan, la lluvia, los aspersores y las
  // norias riegan
  onDay(day) {
    if (this.game.live.guest) return;   // (en el mundo de otro, los cultivos los hace crecer su juego)
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
      // Hoy riegan la lluvia, los aspersores y las norias
      if (rain) for (const k of Object.keys(d.tilled)) d.wet[k] = day;
      for (const [k, raw] of Object.entries(d.placed || {})) {
        const id = parsePlaced(raw)[0], r = WATERS[id];
        if (!r) continue;
        const pos = d.pos?.[`placed:${k}`], [tx, ty] = pos ? [Math.floor(pos[0]), Math.floor(pos[1])] : k.split(',').map(Number);
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
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
    const [tx, ty] = g.aimTile(), d = this.d(tx, ty), k = key(tx, ty);
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
    if (tree) return { text: FRUIT[tree.kind].text, run: () => this.pickFruit(tree) };
    return null;
  }

  aimables(p, scene, box) {
    if (scene !== this.world) return null;
    const out = [], winter = this.game.days.season === 3;
    for (const o of this.world.harvestablesNear(p.x, p.y)) {
      const f = FRUIT[o.kind];
      if (!f || (winter && !f.winter) || Math.hypot(o.x - p.x, o.y - p.y) > 4 || !this.hasFruit(this.d(Math.floor(o.x), Math.floor(o.y)), o)) continue;
      out.push({ kind: 'sys', ring: true, box: box(o.x, o.y, 0.8, 0.8, 0, 3), act: () => ({ text: f.text, run: () => this.pickFruit(o) }) });
    }
    return out;
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
  // Caer de un salto sobre tierra labrada sin nada plantado la deshace, como en Minecraft (andar por encima, no; y
  // con algo plantado, aunque esté seco, tampoco). El espectador no pisa nada
  trample(p) {
    const g = this.game, tx = Math.floor(p.x), ty = Math.floor(p.y), k = key(tx, ty), d = this.d(tx, ty);
    if (g.scene !== this.world || g.gamemode === 'spectator' || d?.tilled?.[k] === undefined || this.cropAt(tx, ty)) return false;
    delete d.tilled[k];
    if (d.wet) delete d.wet[k];
    this.world.dropLevel?.(tx, ty);
    this.world.touchAround(tx, ty);
    g.gather.chips(tx + 0.5, ty + 0.5, 'dirt', 8);
    Audio.till();
    return true;
  }
  sow(tx, ty, id) {
    const g = this.game, d = this.d(tx, ty, true);
    d.crops ||= {};
    d.crops[key(tx, ty)] = { id, grow: 0, day: this.today };
    g.inv.remove('semilla_' + id, 1);
    g.stats?.add('sembrados', 1);
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
    if (d && (d.tilled[k] !== undefined || d.placed?.[k] || d.floor?.[k] || d.trees?.[k] || d.dig?.[k] !== undefined)) return false;
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
    Audio.swish();
  }

}
