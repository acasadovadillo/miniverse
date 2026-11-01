// Granja: animales que viven en su gallinero o establo, pasean cerca, comen del comedero (o pastan
// de primavera a otoño) y cada mañana tienen huevos, leche o lana. Acariciarlos les hace felices.
// También las colmenas (miel cada pocos días) y los comederos (se llenan con fibra o trigo).
import { ITEMS } from './items.js';
import { ANIMALS } from './art/farm.js';
import { collide } from './physics.js';
import { toView, fromView } from './iso.js';
import { Audio } from './audio.js';

const HOME = { gallina: 'gallinero', vaca: 'establo', oveja: 'establo' };
const PER_HOME = 4, ROAM = 4.5, HONEY_EVERY = 3;
const FEED = ['fibra', 'trigo'];

class Animal {
  constructor(data) {
    Object.assign(this, { love: 0, ready: false, days: 0, petDay: -1, fedDay: -1, flip: false, step: 0, vx: 0, vy: 0, wait: Math.random() * 3 }, data);
    this.tx = this.x; this.ty = this.y;
  }
  get def() { return ANIMALS[this.type]; }
  footprint() { return { x0: this.x - 0.2, x1: this.x + 0.2, y0: this.y - 0.2, y1: this.y + 0.2, c: this.x + this.y }; }
  toSave() { const { type, name, home, x, y, love, ready, days, petDay, fedDay } = this; return { type, name, home, x: +x.toFixed(2), y: +y.toFixed(2), love, ready, days, petDay, fedDay }; }
  update(dt, world) {
    this.wait -= dt;
    const dx = this.tx - this.x, dy = this.ty - this.y, d = Math.hypot(dx, dy);
    if (d < 0.1 || this.wait > 0) {
      this.vx = this.vy = 0;
      if (this.wait <= 0) {   // nuevo paseo cerca de casa
        const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * ROAM;
        this.tx = this.home[0] + 0.5 + Math.cos(a) * r; this.ty = this.home[1] + 1.5 + Math.sin(a) * r;
        this.wait = 2 + Math.random() * 5;
      }
      return;
    }
    const sp = this.type === 'gallina' ? 1.1 : 0.7;
    const p = { x: this.x + (dx / d) * sp * dt, y: this.y + (dy / d) * sp * dt };
    collide(p, world.collidersNear(p.x, p.y), 0.25);
    if (world.water(p.x, p.y) === 'deep' || Math.hypot(p.x - this.x, p.y - this.y) < sp * dt * 0.3) { this.tx = this.x; this.ty = this.y; this.wait = 1; return; }
    this.faceTo(dx, dy);
    this.x = p.x; this.y = p.y;
    this.step += dt * 6;
  }
  // Hacia dónde mira en el mundo (de lado: a la derecha o a la izquierda de la pantalla); al girar la cámara, igual
  worldDir() { return this.dir || fromView(this.flip ? -0.5 : 0.5, this.flip ? 0.5 : -0.5); }
  faceTo(dx, dy) {
    const [vx, vy] = toView(dx, dy);   // hacia dónde, visto desde la cámara
    if (Math.abs(vx - vy) > 0.05) { this.flip = vx - vy < 0; this.dir = [dx, dy]; }
  }
}

export class Ranch {
  constructor(game) {
    this.game = game;
    this.animals = [];
  }
  get world() { return this.game.world; }
  get today() { return this.game.days.dayIndex; }
  reset(save) { this.animals = (save.animals || []).map(a => new Animal(a)); }
  save(out) { out.animals = this.animals.map(a => a.toSave()); }

  // Casetas colocadas en el mundo de un tipo, con su sitio libre
  homes(kind) {
    const out = [];
    for (const [ck, d] of this.world.deltas) {
      for (const [k, raw] of Object.entries(d.placed || {})) {
        if (raw.split('@')[0] !== kind) continue;
        const tile = k.split(',').map(Number), used = this.animals.filter(a => a.home[0] === tile[0] && a.home[1] === tile[1]).length;
        out.push({ tile, free: PER_HOME - used });
      }
    }
    return out;
  }
  // Traer un animal nuevo (de la tienda). Devuelve el motivo si no se puede.
  add(type, name) {
    const kind = HOME[type], home = this.homes(kind).find(h => h.free > 0);
    if (!home) return `Necesitas ${ITEMS[kind].name.toLowerCase()} con sitio libre`;
    const def = ANIMALS[type], used = new Set(this.animals.map(a => a.name));
    name ||= def.names.find(n => !used.has(n)) || `${def.name} ${this.animals.length + 1}`;
    this.animals.push(new Animal({ type, name, home: home.tile, x: home.tile[0] + 0.5, y: home.tile[1] + 1.5 }));
    return null;
  }

  update(dt) {
    const p = this.game.player;
    if (this.game.scene !== this.world) return;
    for (const a of this.animals) if (Math.abs(a.x - p.x) + Math.abs(a.y - p.y) < 60) a.update(dt, this.world);
  }
  entities(scene) {
    if (scene !== this.world) return null;
    const p = this.game.player;
    return this.animals.filter(a => Math.abs(a.x - p.x) + Math.abs(a.y - p.y) < 30);
  }

  // Cada mañana: comen (del comedero o pastando), dan su producto y, si nadie les hace caso, se ponen tristes
  onDay(day) {
    const winter = this.game.days.season === 3;
    for (const a of this.animals) {
      const fed = !winter || this.eatFromFeeder(a);
      if (a.petDay < day - 2) a.love = Math.max(0, a.love - 1);
      if (!fed) continue;
      a.fedDay = day;
      a.days++;
      if (a.days % a.def.every === 0) a.ready = true;
    }
  }
  eatFromFeeder(a) {
    for (const [, d] of this.world.deltas) {
      for (const [k, n] of Object.entries(d.feed || {})) {
        const [tx, ty] = k.split(',').map(Number);
        if (n > 0 && Math.hypot(tx - a.home[0], ty - a.home[1]) < 12) { d.feed[k]--; return true; }
      }
    }
    return false;
  }

  interact(p, scene) {
    if (scene !== this.world) return null;
    let best = null, bd = 1.3;
    for (const a of this.animals) { const d = Math.hypot(a.x - p.x, a.y - p.y); if (d < bd) { bd = d; best = a; } }
    if (best) {
      if (best.ready) return { text: `${best.def.verb} (${best.name})`, run: () => this.collect(best) };
      if (best.petDay !== this.today) return { text: `Acariciar a ${best.name}`, run: () => this.pet(best) };
      return { text: `${best.name} ${'♥'.repeat(Math.ceil(best.love / 2)) || '·'} (${best.fedDay === this.today ? 'ha comido' : 'tiene hambre'})`, run: () => this.pet(best) };
    }
    // Colmenas y comederos
    const o = this.world.placedNear(p.x, p.y, 1.3).find(o => !o.fixed);
    if (o?.placed === 'colmena') {
      const d = this.world.delta(Math.floor(o.tile[0] / 16), Math.floor(o.tile[1] / 16), true), k = `${o.tile[0]},${o.tile[1]}`;
      d.hive ||= {};
      d.hive[k] ??= this.today;
      if (this.today - d.hive[k] >= HONEY_EVERY && this.game.days.season !== 3) return { text: 'Recoger miel', run: () => { d.hive[k] = this.today; this.world.chestTouched(...o.tile); this.game.gather.spawnDrops(o, { drops: [['miel', 1, 2]] }); Audio.pickup(); } };
      return null;
    }
    if (o?.placed === 'comedero') {
      const d = this.world.delta(Math.floor(o.tile[0] / 16), Math.floor(o.tile[1] / 16), true), k = `${o.tile[0]},${o.tile[1]}`;
      d.feed ||= {};
      const food = FEED.find(id => this.game.inv.count(id) > 0), n = d.feed[k] || 0;
      if (!food) return { text: `Comedero: ${n} raciones (pon fibra o trigo)`, run: () => Audio.error() };
      return { text: `Llenar el comedero (${n} raciones)`, run: () => { const k2 = Math.min(10, this.game.inv.count(food)); this.game.inv.remove(food, k2); d.feed[k] = n + k2; this.world.chestTouched(...o.tile); Audio.place(); } };
    }
    return null;
  }
  pet(a) {
    if (a.petDay !== this.today) { a.petDay = this.today; a.love = Math.min(10, a.love + 1); this.game.skills?.gain('granja', 1); }
    a.hearts = this.game.time + 1.2;
    a.wait = 1.5;
    Audio.blip();
  }
  collect(a) {
    a.ready = false;
    const extra = a.love >= 6 && Math.random() < 0.5 ? 1 : 0;   // los animales felices dan más
    this.game.gather.spawnDrops(a, { drops: [[a.def.product, 1 + extra, 1 + extra]] });
    Audio.pickup();
    this.game.skills?.gain('granja', 2);
    this.game.stats?.add('productos', 1);
  }
}
