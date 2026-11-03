// Exploración: lugares que el mundo genera solo (entradas de cueva, ruinas, campamentos, torres, barcos
// hundidos, templos, faros en algunas costas y aldeas lejanas), sus cofres, las cuevas y mazmorras a las que
// llevan, y los vehículos (barca y caballo).
import { ITEMS } from './items.js';
import { ihash } from './util.js';
import { CHUNK } from './world/gen.js';
import { B } from './world/biomes.js';
import { CENTER } from './world/village.js';
import { wrapIndex } from './world/planet.js';
import { houseBlueprint, houseSize, byChunk } from './world/blueprints.js';
import { makeCave, makeDungeon } from './world/underground.js';
import { Person } from './entities.js';
import { SHOPS } from './economy.js';
import { Audio } from './audio.js';
import { hud } from './ui/hud.js';

const SIZE = { ruinas: 2.2, campamento: 1.8, torre: 1.3, barco: 2.2, templo: 2.2, cueva: 1.4, aldea: 16, faro: 3 };
const AROUND = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
const NAMES = { ruinas: 'Ruinas', campamento: 'Campamento abandonado', torre: 'Torre vieja', barco: 'Barco hundido', templo: 'Templo antiguo', cueva: 'Cueva', aldea: 'Aldea', faro: 'Faro' };
SHOPS.viajero = { title: 'Mercader de la aldea', hours: [7, 21], stock: [{ id: 'semilla_manzano', price: 90 }, { id: 'pocion', price: 120 }, { id: 'espada', price: 380 }, { id: 'barca', price: 1500 }, { id: 'caballo', price: 2600 }, { id: 'lingote_oro', price: 300 }, { id: 'semilla_calabaza', price: 60 }] };

export class Explore {
  constructor(game) {
    this.game = game;
    this.cache = new Map();
    this.layer = { add: (cx, cy, d, out) => this.addContent(cx, cy, d, out), hides: o => this.hides(o), blocks: (tx, ty) => this.blocks(tx, ty), baseAt: (layer, tx, ty) => this.baseAt(layer, tx, ty) };
    this.traders = new Map();
    this.aldeas = new Map();     // planos de piezas de las casas de cada aldea
    this.raw = new Map();        // lugar que tocaría en cada trozo, sin mirar a los de al lado
    this.found = new Set();      // lugares descubiertos (para el mapa y los logros)
  }
  get world() { return this.game.world; }
  reset(save) {
    this.cache.clear();
    this.traders.clear();
    this.aldeas.clear();
    this.raw.clear();
    this.found = new Set(save.found || []);
    if (!this.world.layers.includes(this.layer)) this.world.layers.push(this.layer);
  }
  save(out) { out.found = [...this.found]; }

  // ¿Hay un lugar en este trozo? (siempre lo mismo para la misma semilla). Una aldea se sale de su trozo
  // hacia los de alrededor, así que en esos no hay otro lugar (y de dos aldeas juntas queda una).
  poi(cx, cy) {
    cx = wrapIndex(cx, CHUNK);   // (el trozo, dentro del planeta)
    const k = `${cx},${cy}`;
    if (this.cache.has(k)) return this.cache.get(k);
    const w = this.world, s = w.seed, x = cx * CHUNK + 8.5, y = cy * CHUNK + 8.5;
    let kind = this.rawKind(cx, cy);
    if (kind === 'aldea' ? !this.isAldea(cx, cy) : kind && AROUND.some(([dx, dy]) => this.isAldea(cx + dx, cy + dy))) kind = null;
    const p = kind && { kind, x, y, key: k, id: Math.floor(ihash(cx, cy, s + 701) * 1e6), snow: w.gen.biomeAt(x, y) === B.SNOW };
    this.cache.set(k, p);
    return p;
  }
  // Una aldea de verdad: no tiene al lado un faro ni otra aldea que gane (la de número más bajo)
  isAldea(cx, cy) {
    cx = wrapIndex(cx, CHUNK);
    if (this.rawKind(cx, cy) !== 'aldea') return false;
    const r = ihash(cx, cy, this.world.seed + 700);
    return !AROUND.some(([dx, dy]) => { const k = this.rawKind(cx + dx, cy + dy); return k === 'faro' || (k === 'aldea' && ihash(cx + dx, cy + dy, this.world.seed + 700) < r); });
  }
  // El lugar que tocaría en el trozo sin mirar a los de al lado
  rawKind(cx, cy) {
    cx = wrapIndex(cx, CHUNK);
    const k = `${cx},${cy}`;
    if (this.raw.has(k)) return this.raw.get(k);
    const w = this.world, s = w.seed, x = cx * CHUNK + 8.5, y = cy * CHUNK + 8.5;
    let kind = null;
    if (Math.hypot(x - CENTER.x, y - CENTER.y) > 45) {
      const b = w.gen.biomeAt(x, y), r = ihash(cx, cy, s + 700), far = Math.hypot(x - CENTER.x, y - CENTER.y) > 110;
      if (b === B.ROCKY) kind = r < 0.25 ? 'cueva' : null;
      else if (b === B.SNOW) kind = r < 0.1 ? 'cueva' : r < 0.18 ? 'torre' : null;
      else if (b === B.DESERT) kind = r < 0.1 ? 'templo' : r < 0.14 ? 'ruinas' : null;
      else if (b === B.BEACH) kind = r < 0.1 ? 'barco' : far && r < 0.13 ? 'faro' : null;   // (algunas costas tienen faro)
      else if (b === B.MEADOW || b === B.FOREST || b === B.PINES) kind = r < 0.03 ? 'ruinas' : r < 0.055 ? 'campamento' : r < 0.075 ? 'torre' : far && r < 0.125 ? 'aldea' : null;
      // Una aldea necesita la plaza y al menos dos casas en tierra firme
      if (kind === 'aldea' && (w.water(x, y) || this.aldeaSlots(cx, cy).length < 2)) kind = null;
    }
    this.raw.set(k, kind);
    return kind;
  }
  // Dónde van las casas de una aldea (origen de cada una, relativo a la plaza): de los cuatro sitios
  // alrededor de la plaza, los tres primeros sin agua debajo
  aldeaSlots(cx, cy) {
    const w = this.world, px = cx * CHUNK + 8, py = cy * CHUNK + 8, { w: hw, h: hh } = houseSize(false), out = [];
    for (const [dx, dy] of [[-14, -12], [2, -13], [-15, 2], [2, 2]]) {
      let dry = true;
      for (let y = 0; y < hh && dry; y++) for (let x = 0; x < hw; x++) if (w.water(px + dx + x + 0.5, py + dy + y + 0.5)) { dry = false; break; }
      if (dry) out.push([dx, dy]);
      if (out.length === 3) break;
    }
    return out;
  }
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
  hides(o) {
    if (!o.kind) return false;
    if (this.inAldea(o.x, o.y, 1.5)) return true;
    const p = this.poi(Math.floor(o.x / CHUNK), Math.floor(o.y / CHUNK));
    return !!p && p.kind !== 'aldea' && Math.hypot(o.x - p.x, o.y - p.y) < SIZE[p.kind] + 1.5;
  }
  blocks(tx, ty) {
    const p = this.poi(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK));
    if (p && p.kind !== 'aldea' && Math.hypot(tx + 0.5 - p.x, ty + 0.5 - p.y) < SIZE[p.kind] + 1) return true;
    return this.inAldea(tx + 0.5, ty + 0.5, 1);
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
  baseAt(layer, tx, ty) {
    for (const p of this.aldeasAround(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK))) { const v = this.aldea(p).all[layer][`${tx},${ty}`]; if (v) return v; }
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
      out.colliders.push({ x0: p.x - 0.5, y0: p.y - 0.5, x1: p.x + 0.5, y1: p.y + 0.5 });
      out.lights.push({ x: p.x, y: p.y, z: 160, r: 120 });
      return;
    }
    // Ruinas, campamento, torre, barco y templo: el sitio y un cofre al lado (menos el templo, que guarda su tesoro dentro)
    out.objects.push({ x: p.x, y: p.y, poi: p, fx: [p.x - 1.5, p.x + 1.5], fy: [p.y - 1.5, p.y + 1.5] });
    if (p.kind === 'torre') out.colliders.push({ x0: p.x - 0.5, y0: p.y - 0.5, x1: p.x + 0.5, y1: p.y + 0.5 });
    else if (p.kind === 'campamento') { out.colliders.push({ x0: p.x - 1.5, y0: p.y - 1.5, x1: p.x + 0.5, y1: p.y + 0.5 }); out.colliders.push({ x: p.x + 1, y: p.y + 1, r: 0.4 }); }
    else out.colliders.push({ x0: p.x - 1.4, y0: p.y - 1.4, x1: p.x + 1.4, y1: p.y + 1.4 });
    if (p.kind === 'campamento') out.lights.push({ x: p.x + 1, y: p.y + 1, z: 6, r: 60 });
    if (p.kind !== 'templo') {
      const t = [Math.floor(p.x) + 2, Math.floor(p.y)];   // la casilla de al lado, a la derecha del lugar
      out.objects.push({ x: t[0] + 0.5, y: t[1] + 0.5, treasure: p, tile: t, open: !!opened });
      out.colliders.push({ x: t[0] + 0.5, y: t[1] + 0.5, r: 0.35 });
    }
  }

  update() {
    const p = this.game.player;
    if (this.game.scene !== this.world) return;
    const near = this.poiNear(p.x, p.y, 12);
    if (near && !this.found.has(near.key)) {
      this.found.add(near.key);
      hud.toast(`Has encontrado: ${NAMES[near.kind]}`, 'good');
      this.game.stats?.add('lugares', 1);
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
      if (poi.kind === 'cueva' && Math.hypot(p.x - poi.x, p.y - poi.y) < 2.2) return { text: 'Entrar en la cueva', run: () => this.enterCave(poi, 1) };
      if (poi.kind === 'templo' && p.y > poi.y + 1.2 && Math.abs(p.x - poi.x) < 1.6) return { text: 'Entrar en el templo', run: () => this.enterDungeon(poi) };
      if (poi.kind === 'faro') return { text: 'Subir al faro', run: () => this.climb(poi) };
      if (poi.kind === 'aldea') {
        const t = this.traders.get(poi.key);
        if (t && Math.hypot(p.x - t.x, p.y - t.y) < 1.6) return { text: 'Hablar con el mercader', run: () => g.onShop?.('viajero') };
        return null;
      }
      const c = this.world.contentFor(Math.floor(poi.x / CHUNK), Math.floor(poi.y / CHUNK)).objects.find(o => o.treasure);
      if (c && Math.hypot(p.x - c.x, p.y - c.y) < 1.4) {
        const d = this.world.delta(Math.floor(poi.x / CHUNK), Math.floor(poi.y / CHUNK), true);
        if (d.opened?.[poi.key]) return { text: 'Cofre vacío', run: () => Audio.error() };
        return { text: 'Abrir el cofre', run: () => this.openPoiChest(poi, d) };
      }
      return null;
    }
    if (scene.kind !== 'grid') return null;
    for (const o of scene.live()) {
      if (!o.tile || Math.hypot(p.x - o.x, p.y - o.y) > 1.3) continue;
      if (o.ladder === 'up') return { text: scene.depth > 1 ? `Subir al nivel ${scene.depth - 1}` : 'Salir', run: () => this.climb(scene, -1) };
      if (o.ladder === 'down') return { text: `Bajar al nivel ${scene.depth + 1}`, run: () => this.climb(scene, 1) };
      if (o.chest) {
        if (scene.state.opened[o.key]) continue;
        return { text: 'Abrir el cofre', run: () => this.openGridChest(scene, o) };
      }
      if (o.lever !== undefined) return { text: 'Tirar de la palanca', run: () => { scene.state.flags['g' + o.lever] = true; scene.touched(); Audio.clink(); hud.toast('Se oye una reja que se abre…'); } };
      if (o.gate !== undefined && !o.open && o.lock) {
        if (scene.state.flags['k' + o.gate]) return { text: 'Abrir la reja con la llave', run: () => { scene.state.flags['g' + o.gate] = true; scene.touched(); Audio.unlock(); } };
        return { text: 'Reja cerrada con llave', run: () => Audio.error() };
      }
      if (o.gate !== undefined && !o.open) return { text: 'Reja cerrada', run: () => Audio.error() };
      if (o.block) {
        const dx = o.x - p.x, dy = o.y - p.y, [mx, my] = Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)];
        return { text: 'Empujar el bloque', run: () => { if (scene.push(o, mx, my)) { Audio.place(); if (scene.state.flags['g' + o.block.room]) hud.toast('¡Click! La reja se ha abierto'); } else Audio.error(); } };
      }
    }
    return null;
  }

  async enterCave(poi, depth) {
    const g = this.game, sc = makeCave(g, poi.id, depth, poi.snow);
    sc.exitTo = { x: poi.x, y: poi.y + 2.2 };
    g.combat.spawn(sc);
    this.current = poi;
    await g.goTo(sc, sc.entry.x, sc.entry.y);
    g.stats?.max('profundidad', depth);
  }
  async enterDungeon(poi) {
    const g = this.game, sc = makeDungeon(g, poi.id);
    sc.exitTo = { x: poi.x, y: poi.y + 2.4 };
    sc.depth = 1;
    g.combat.spawn(sc);
    this.current = poi;
    await g.goTo(sc, sc.entry.x, sc.entry.y);
  }
  async climb(scene, dir) {
    const g = this.game;
    if (dir < 0 && scene.depth <= 1) { await g.goTo(this.world, scene.exitTo.x, scene.exitTo.y, { inside: false }); g.onSave?.(); return; }
    const sc = makeCave(g, scene.caveId, scene.depth + dir, scene.style === 'ice');
    sc.exitTo = scene.exitTo;
    g.combat.spawn(sc);
    const at = dir > 0 ? sc.entry : sc.fromBelow;
    await g.goTo(sc, at.x, at.y);
    g.stats?.max('profundidad', sc.depth);
    hud.toast(`Cueva · nivel ${sc.depth}`);
  }

  // Botín de los cofres
  loot(table) {
    const g = this.game, r = Math.random, out = [];
    if (table === 'templo') {
      out.push(['lingote_oro', 3], ['rubi', 1], ['esmeralda', 1], ['moneda_antigua', 3]);
      if (r() < 0.35) out.push(['espada_oro', 1]);
      g.addMoney(500);
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
    if (o.keyFor !== undefined) { scene.state.flags['k' + o.keyFor] = true; hud.toast('Has encontrado una llave'); Audio.unlock(); return; }
    const got = this.loot(o.loot);
    await this.showLoot(got);
    if (o.loot === 'templo') await this.game.story?.found('templo');
  }
  async showLoot(got) {
    const g = this.game;
    g.busy = true;
    await hud.say('Cofre', [`Dentro hay: ${got.map(([id, n]) => `${n} × ${ITEMS[id].name.toLowerCase()}`).join(', ')} y unas monedas.`]);
    g.busy = false;
  }

  // ---------- Vehículos ----------
  target(p, held, def) {
    const g = this.game;
    if (g.scene !== this.world) return null;
    if (def?.vehicle === 'barca') {
      const ax = p.x + p.face.x * 1.1, ay = p.y + p.face.y * 1.1, water = !!this.world.water(ax, ay);
      if (!p.boat && water && !p.mount) return { tile: null, ok: true, label: 'Subir a la barca', use: () => { p.boat = true; p.x = ax; p.y = ay; Audio.door(); } };
      if (p.boat && !water && !this.world.blocked(ax, ay) && !this.world.collidersNear(ax, ay).some(c => c.r !== undefined && Math.hypot(c.x - ax, c.y - ay) < c.r + 0.3)) return { tile: null, ok: true, label: 'Bajar a tierra', use: () => { p.boat = false; p.x = ax; p.y = ay; Audio.door(); } };
      return null;
    }
    if (def?.vehicle === 'caballo' && !p.boat) return g.ranch.whistle(p);   // (el caballo es un animal de verdad: ver la granja)
    return null;
  }
  // Subir a un faro: desde arriba se ve la costa (se descubre lo de alrededor en el mapa)
  async climb(poi) {
    const g = this.game, cx = Math.floor(poi.x / CHUNK), cy = Math.floor(poi.y / CHUNK);
    g.busy = true;
    await hud.fade(true);
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) g.explored.add(`${wrapIndex(cx + dx, CHUNK)},${cy + dy}`);
    g.stats?.add('faros', 1);
    await hud.fade(false);
    g.busy = false;
    await hud.say('Faro', ['Subes los escalones hasta la lámpara. Desde aquí arriba se ve toda la costa (ahora está en tu mapa).']);
    g.busy = false;
  }
  // Marcas para el mapa: lugares descubiertos
  markers() {
    const out = [];
    for (const k of this.found) { const [cx, cy] = k.split(',').map(Number), p = this.poi(cx, cy); if (p) out.push({ x: p.x, y: p.y, kind: p.kind }); }
    return out;
  }
}
export { NAMES as POI_NAMES };
