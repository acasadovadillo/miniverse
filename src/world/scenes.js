// Escena del mundo exterior (infinito, por trozos). Ofrece objetos, entidades y colisiones. Todo lo que hay en el mundo va en la cuadrícula de casillas: lo que construye
// el jugador (deltas) y lo fijo del pueblo y de las aldeas (la "capa base", que no se puede quitar).
import { clamp } from '../util.js';
import { WorldGen, CHUNK } from './gen.js';
import { buildVillage, NILO, inBounds, isGrass, inOwnHouse } from './village.js';
import { B, BIOMES } from './biomes.js';
import { ITEMS } from '../items.js';
import { extraTiles, LONG, BED_BACK, HEARTH_BACK, GLOW, LIGHT, front, SIDE, rugRect } from '../art/stations.js';
import { wallRuns, WINDOW_Z, T } from '../art/build.js';
import { PIECES, layerOf, parsePlaced } from '../pieces.js';
import { Person } from '../entities.js';

export const NILO_LOOK = { sex: 'chico', skin: '#8a5234', hair: '#c8c4cc', eyes: '#6a3a1e', cloth: '#4a9a4a', pants: '#3a4a6a', hairStyle: 'corto', outfit: 'tunica', beard: true };

const ROOF_MAX_TILES = 900;   // tope de casillas de una región de tejado (para calcular su forma)
const ROOF_MAX_LEVEL = 4;     // altura máxima de un tejado, en niveles

// De su centro a su parte de atrás, en lo que tiene espalda: si detrás hay un muro, se arrima a él
// (de la casilla a la parte de atrás de cada mueble, medido en su modelo: con un muro detrás, se pega a él)
const BACK = {
  cama: BED_BACK, cama_doble: BED_BACK, sofa: 0.42, cama_nino: 0.42, banera: 0.43, estanteria: 0.2, alacena: 0.28, encimera: 0.28, fregadero: 0.32, lavabo: 0.42, inodoro: 0.34, chimenea: HEARTH_BACK, lampara: 0.18,
  cocina: 0.38, horno: 0.44, banco: 0.32, yunque: 0.3, telar: 0.3, quesera: 0.24, cofre: 0.28, armario: 0.33, mueble_bano: 0.24, cuadro_valle: 0.05, cuadro_mar: 0.05, cuadro_flores: 0.05, cuadro_noche: 0.05, vitrina: 0.32, cuna: 0.3, mesa: 0.42, incubadora: 0.26, maceta: 0.28, silla: 0.22,
};

// Completa un objeto de la mochila puesto en el mundo (estación o mueble): colisión y luz.
// [sx, sy]: lo que se corre para arrimarse a un muro. Devuelve true si es plano (alfombra) y va en el suelo.
// ¿Cruza el segmento (x0, y0)-(x1, y1) la caja b?
function crosses(x0, y0, x1, y1, b) {
  let t0 = 0, t1 = 1;
  for (const [p, d, lo, hi] of [[x0, x1 - x0, b.x0, b.x1], [y0, y1 - y0, b.y0, b.y1]]) {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return false; continue; }
    let a = (lo - p) / d, c = (hi - p) / d;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    if (t0 > t1) return false;
  }
  return true;
}
function itemObject(o, id, rot, colliders, lights, [sx, sy] = [0, 0]) {
  const [tx, ty] = o.tile;
  o.x += sx; o.y += sy;
  o.rot = rot; o.glow = GLOW[id];
  if (LIGHT[id] && !o.off) { const [lx, ly, lz, lr] = LIGHT[id]; lights.push({ x: o.x + lx, y: o.y + ly, z: lz, r: lr }); }
  if (ITEMS[id].place === 'flat' || ITEMS[id].place === 'rug') return true;   // (la alfombra de antes, de una casilla)
  if (LONG[id]) {   // varias casillas: la suya y las de los pies (y, la cama doble, las de al lado)
    const ts = [[tx, ty], ...extraTiles(id, tx, ty, rot)], xs = ts.map(t => t[0]), ys = ts.map(t => t[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs) + 1, y0 = Math.min(...ys), y1 = Math.max(...ys) + 1;
    o.fx = [x0 + sx, x1 + sx]; o.fy = [y0 + sy, y1 + sy];
    colliders.push({ x0: x0 + 0.06 + sx, y0: y0 + 0.06 + sy, x1: x1 - 0.06 + sx, y1: y1 - 0.06 + sy });
    return false;
  }
  if (id === 'silla' || id === 'antorcha' || id === 'maceta' || id === 'lampara' || id === 'cojin' || id === 'palomar') colliders.push({ x: o.x, y: o.y, r: id === 'silla' || id === 'cojin' ? 0.3 : 0.2 });
  else colliders.push({ x0: tx + 0.06 + sx, y0: ty + 0.06 + sy, x1: tx + 0.94 + sx, y1: ty + 0.94 + sy });
  return false;
}

// Distancia (en casillas, métrica del máximo) de un punto al borde de una región de tejado: así el
// tejado sube a cuatro aguas desde el alero, con las limas a 45° y la cumbrera en medio
function roofDistance(px, py, edges) {
  let best = Infinity;
  for (const e of edges) {
    const dx = Math.max(e[0] - px, 0, px - e[2]), dy = Math.max(e[1] - py, 0, py - e[3]), d = Math.max(dx, dy);
    if (d < best) best = d;
  }
  return Math.min(best, ROOF_MAX_LEVEL);
}

export class Overworld {
  constructor(seed, deltas = new Map()) {
    this.kind = 'world';
    this.seed = seed;
    this.clock = 0;               // segundos de juego
    this.deltas = deltas;         // cambios del jugador por trozo: { removed: {clave: hora}, tilled: {casilla: hora}, placed: {casilla: id}, v }; lo quitado no vuelve
    this.dirty = new Set();       // trozos con cambios sin guardar
    this.merged = new Map();
    this.village = buildVillage();
    this.gen = new WorldGen(seed);
    this.nilo = new Person({ ...NILO, look: NILO_LOOK, flip: true });
    this.entities = [this.nilo];
    this.bounds = null;
    this.layers = [];             // otras capas de contenido por trozo (cultivos, lugares…): { add(cx, cy, delta, out), baseAt?(layer, tx, ty) }
    this.onTouch = null;          // avisa de cada trozo que cambia (para jugar juntos en directo)
  }

  delta(cx, cy, create = false) {
    const k = `${cx},${cy}`;
    let d = this.deltas.get(k);
    if (!d && create) { d = { removed: {}, tilled: {}, v: 0 }; this.deltas.set(k, d); }
    if (d && !d.placed) Object.assign(d, { placed: {}, floor: {}, roof: {}, chest: {} });   // partidas anteriores
    if (d && !d.floor) Object.assign(d, { floor: {}, roof: {}, chest: {} });
    return d;
  }
  touch(cx, cy) { const d = this.delta(cx, cy), k = `${cx},${cy}`; d.v++; this.dirty.add(k); this.onTouch?.(k); }
  // Lo que ha puesto el jugador en una capa de una casilla (o undefined)
  ownAt(layer, tx, ty) { return this.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK))?.[layer]?.[`${tx},${ty}`]; }
  // Lo fijo del pueblo y de las aldeas en una casilla
  baseAt(layer, tx, ty) {
    const v = this.village.built?.[`${Math.floor(tx / CHUNK)},${Math.floor(ty / CHUNK)}`]?.[layer]?.[`${tx},${ty}`];
    if (v) return v;
    for (const l of this.layers) { const b = l.baseAt?.(layer, tx, ty); if (b) return b; }
    return undefined;
  }
  // Lo que hay en una capa de una casilla, sea del jugador o fijo (o undefined)
  at(layer, tx, ty) { return this.ownAt(layer, tx, ty) ?? this.baseAt(layer, tx, ty); }
  pieceAt(tx, ty) { const v = this.at('placed', tx, ty); return v && PIECES[parsePlaced(v)[0]]; }

  // Contenido de un trozo con los cambios del jugador aplicados
  contentFor(cx, cy) {
    const key = `${cx},${cy}`, d = this.delta(cx, cy), bucket = Math.floor(this.clock / 5);
    const m = this.merged.get(key);
    if (m && m.v === (d?.v ?? -1) && m.bucket === bucket) return m.data;
    const base = this.gen.content(cx, cy).objects, objects = [], colliders = [], tilled = [], flats = [], floors = [], lights = [];
    for (const o of base) {
      if (this.layers.some(l => l.hides?.(o))) continue;   // donde hay un lugar especial no crecen árboles
      if (d?.removed[o.key] !== undefined) continue;   // lo talado, picado o segado no vuelve: la casilla queda libre
      objects.push(o);
      if (o.col) colliders.push(o.col);
    }
    if (d) for (const t of Object.keys(d.tilled)) tilled.push(t.split(',').map(Number));
    const out = { objects, colliders, flats, floors, lights, roofMemo: new Map() };
    if (d) this.addBuilt(d, out);
    const vb = this.village.built?.[key];
    if (vb) this.addBuilt(vb, out, true);
    for (const layer of this.layers) layer.add(cx, cy, d, out);
    const data = { objects, colliders, tilled, flats, floors, lights };
    this.merged.set(key, { v: d?.v ?? -1, bucket, data });
    if (this.merged.size > 300) this.merged.delete(this.merged.keys().next().value);
    return data;
  }

  // Una alfombra cabe donde no haya agua, muros, puertas, vallas, tierra labrada ni otra alfombra (y, en el
  // pueblo, dentro de tu casa)
  rugFits({ x0, y0, w, h }) {
    for (let ty = y0; ty < y0 + h; ty++) for (let tx = x0; tx < x0 + w; tx++) {
      const x = tx + 0.5, y = ty + 0.5;
      if (this.water(x, y) || this.pieceAt(tx, ty) || this.rugAt(tx, ty)) return false;
      if (this.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK))?.tilled[`${tx},${ty}`] !== undefined) return false;
      if (inBounds(x, y) && !isGrass(x, y) && !inOwnHouse(x, y) && !this.buildAnywhere) return false;
    }
    return true;
  }
  // ¿Pisa esta casilla alguna alfombra? (las más grandes miden 4: se miran las de alrededor)
  rugAt(tx, ty) {
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const v = this.at('rug', tx + dx, ty + dy);
      if (!v) continue;
      const r = rugRect(tx + dx, ty + dy, parsePlaced(v)[1]);
      if (tx >= r.x0 && tx < r.x0 + r.w && ty >= r.y0 && ty < r.y0 + r.h) return true;
    }
    return false;
  }
  // ¿Hay detrás (del lado contrario a su frente) un muro liso donde arrimar el hogar o colgar un cuadro? (en las
  // ventanas y en el muro que ya tiene cuadro, no)
  wallBehind(tx, ty, rot) {
    const [fx, fy] = front(rot), v = this.at('placed', tx - fx, ty - fy);
    return !!v && PIECES[parsePlaced(v)[0]]?.kind === 'wall' && !/^(ventana|muro_cuadro)/.test(v);
  }
  // Lo que tiene espalda (cama, estantería, hogar) se arrima al muro que tenga detrás (el lado contrario a su frente):
  // los muros son finos y van por el medio de su casilla, así que sin esto quedaría un hueco
  wallShift(id, tx, ty, rot) {
    const back = BACK[id];
    const [fx, fy] = front(rot);
    if (!back || this.pieceAt(tx - fx, ty - fy)?.kind !== 'wall') return [0, 0];
    const d = back - (1 - T - 0.01);
    return [fx * d, fy * d];
  }

  // Bajo un muro o una puerta, el suelo solo cubre el lado que tiene suelo al lado (el de dentro de la casa),
  // así la casa termina en la pared. Devuelve [x0, x1, y0, y1] relativo al centro, o nada si va entero.
  floorClip(tx, ty) {
    const p = this.pieceAt(tx, ty);
    if (p?.kind !== 'wall' && p?.kind !== 'door') return;
    let alongX, alongY;
    if (p.kind === 'door') {
      const solid = (x, y) => { const q = this.pieceAt(x, y); return q && q.kind !== 'fence'; };
      alongX = solid(tx - 1, ty) || solid(tx + 1, ty) || !(solid(tx, ty - 1) || solid(tx, ty + 1)); alongY = !alongX;
    } else {
      const joins = (x, y) => ['wall', 'door'].includes(this.pieceAt(x, y)?.kind);
      alongX = joins(tx - 1, ty) || joins(tx + 1, ty); alongY = joins(tx, ty - 1) || joins(tx, ty + 1);
      if (!alongX && !alongY) alongX = true;
    }
    const fl = (x, y) => !!this.at('floor', x, y);
    const span = (lo, hi) => lo === hi ? [-0.5, 0.5] : lo ? [-0.5, 0] : [0, 0.5];
    const [y0, y1] = alongX ? span(fl(tx, ty - 1), fl(tx, ty + 1)) : [-0.5, 0.5];
    const [x0, x1] = alongY ? span(fl(tx - 1, ty), fl(tx + 1, ty)) : [-0.5, 0.5];
    if (x1 - x0 < 1 || y1 - y0 < 1) return [x0, x1, y0, y1];
  }

  // Lo construido en un trozo: suelos, muros, puertas, vallas, hogares, tejados, estaciones y muebles.
  // src: { placed, floor, roof } por casilla. fixed: es del pueblo o de una aldea (no se puede quitar).
  addBuilt(src, out, fixed = false) {
    const { objects, colliders, flats, floors, lights } = out;
    const base = (t, layer, id) => {
      const [tx, ty] = t.split(',').map(Number);
      const o = { x: tx + 0.5, y: ty + 0.5, key: `${layer}:${t}`, placed: id, layer, tile: [tx, ty] };
      if (fixed) o.fixed = true;
      return o;
    };
    // Lo fijo no pisa lo que haya puesto el jugador en la misma casilla y capa
    const taken = (layer, t) => fixed && this.ownAt(layer, ...t.split(',').map(Number));
    for (const [t, id] of Object.entries(src.floor || {})) {
      if (taken('floor', t)) continue;
      floors.push(base(t, 'floor', id));
    }
    for (const [t, raw] of Object.entries(src.placed || {})) {
      if (taken('placed', t)) continue;
      const [id, rot] = parsePlaced(raw), piece = PIECES[id], o = base(t, 'placed', id), [tx, ty] = o.tile;
      if (piece?.kind === 'wall') {
        // Tabique fino que se une con los muros y puertas de al lado; choca solo con su grosor
        const joins = (x, y) => ['wall', 'door'].includes(this.pieceAt(x, y)?.kind);
        const mask = (joins(tx + 1, ty) ? 1 : 0) | (joins(tx - 1, ty) ? 2 : 0) | (joins(tx, ty + 1) ? 4 : 0) | (joins(tx, ty - 1) ? 8 : 0);
        o.wallId = id; o.mask = mask;
        o.wall = true; o.window = id.startsWith('ventana');
        for (const [x0, x1, y0, y1] of wallRuns(mask)) colliders.push({ x0: o.x + x0, y0: o.y + y0, x1: o.x + x1, y1: o.y + y1, wall: true });
        if (o.window && !this.doorClosed(tx, ty)) lights.push({ x: o.x, y: o.y, z: WINDOW_Z, r: 34, window: true });   // (cerrada, no sale luz)
      } else if (piece?.kind === 'door') {
        const solid = (x, y) => { const p = this.pieceAt(x, y); return p && p.kind !== 'fence'; };
        const alongX = solid(tx - 1, ty) || solid(tx + 1, ty) || !(solid(tx, ty - 1) || solid(tx, ty + 1));
        const closed = this.doorClosed(tx, ty);
        o.wall = true; o.door = alongX ? 'x' : 'y';
        if (closed) colliders.push(alongX ? { x0: tx, y0: ty + 0.38, x1: tx + 1, y1: ty + 0.62, wall: true } : { x0: tx + 0.38, y0: ty, x1: tx + 0.62, y1: ty + 1, wall: true });
        else if (alongX) colliders.push({ x0: tx, y0: ty + 0.38, x1: tx + 0.14, y1: ty + 0.62, wall: true }, { x0: tx + 0.86, y0: ty + 0.38, x1: tx + 1, y1: ty + 0.62, wall: true });
        else colliders.push({ x0: tx + 0.38, y0: ty, x1: tx + 0.62, y1: ty + 0.14, wall: true }, { x0: tx + 0.38, y0: ty + 0.86, x1: tx + 0.62, y1: ty + 1, wall: true });
      } else if (piece?.kind === 'fence') {
        const f = (x, y) => this.pieceAt(x, y)?.kind === 'fence' || this.pieceAt(x, y)?.kind === 'wall';
        const mask = (f(tx + 1, ty) ? 1 : 0) | (f(tx - 1, ty) ? 2 : 0) | (f(tx, ty + 1) ? 4 : 0) | (f(tx, ty - 1) ? 8 : 0);
        // (low: es baja; a caballo, saltando, se pasa por encima)
        colliders.push({ x: o.x, y: o.y, r: 0.12, low: true });
        if (mask & 1) colliders.push({ x0: o.x, y0: o.y - 0.08, x1: tx + 1, y1: o.y + 0.08, low: true });
        if (mask & 2) colliders.push({ x0: tx, y0: o.y - 0.08, x1: o.x, y1: o.y + 0.08, low: true });
        if (mask & 4) colliders.push({ x0: o.x - 0.08, y0: o.y, x1: o.x + 0.08, y1: ty + 1, low: true });
        if (mask & 8) colliders.push({ x0: o.x - 0.08, y0: ty, x1: o.x + 0.08, y1: o.y, low: true });
      } else if (piece?.kind === 'hearth') {
        // Hogar con chimenea, de espaldas al muro que tenga detrás: da luz y calor; el fuego lo dibuja el juego en la
        // boca del hogar
        const [sx, sy] = this.wallShift(id, tx, ty, rot), [fx, fy] = front(rot), [ux, uy] = SIDE[(rot || 0) % 4];
        o.x += sx; o.y += sy; o.rot = rot;
        const at = (a, b) => [o.x + ux * a + fx * b, o.y + uy * a + fy * b];   // (a: a lo ancho; b: hacia delante)
        o.off = this.lightOff(tx, ty);   // (apagado: sin fuego ni luz)
        o.glow = o.off ? null : GLOW[id]; o.fire = o.off ? null : [...at(0, 0.2), 3, 5]; o.hearth = true;
        if (LIGHT[id] && !o.off) { const [lx, ly, lz, lr] = LIGHT[id], [x, y] = at(lx, ly); lights.push({ x, y, z: lz, r: lr }); }
        const [[ax, ay], [bx, by]] = [at(-0.46, -0.44), at(0.46, 0.32)];
        colliders.push({ x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) });
      } else {
        o.off = this.lightOff(tx, ty);
        if (itemObject(o, id, rot, colliders, lights, this.wallShift(id, tx, ty, rot))) { flats.push(o); continue; }
      }
      objects.push(o);
    }
    // Los cuadros: colgados del muro de detrás; no chocan (debajo puede haber un mueble)
    for (const [t, raw] of Object.entries(src.hang || {})) {
      if (taken('hang', t)) continue;
      const [id, rot] = parsePlaced(raw), o = base(t, 'hang', id), [sx, sy] = this.wallShift(id, ...o.tile, rot);
      o.x += sx; o.y += sy; o.rot = rot;
      flats.push(o);
    }
    // Las alfombras, del tamaño elegido (su "giro") alrededor de su casilla; tampoco chocan (encima van los muebles)
    for (const [t, raw] of Object.entries(src.rug || {})) {
      if (taken('rug', t)) continue;
      const [id, k] = parsePlaced(raw), o = base(t, 'rug', id), r = rugRect(...o.tile, k);
      Object.assign(o, { x: r.x0 + r.w / 2, y: r.y0 + r.h / 2, rug: r, model: `rug:${id}:${r.w}x${r.h}`, fx: [r.x0, r.x0 + r.w], fy: [r.y0, r.y0 + r.h] });
      flats.push(o);
    }
    for (const [t, id] of Object.entries(src.roof || {})) {
      if (taken('roof', t)) continue;
      const o = base(t, 'roof', id), [tx, ty] = o.tile;
      const under = this.at('placed', tx, ty), chimney = !!under && parsePlaced(under)[0] === 'chimenea';
      o.roof = true;
      if (chimney) o.chimneyTop = [o.x, o.y];
      objects.push(o);
    }
  }

  // Forma del tejado en una casilla: alturas de sus esquinas y su centro (en niveles) y por qué lados
  // termina (aleros). Se calcula para toda la región de tejado unida a la casilla (también si sigue en
  // otro trozo) y se recuerda en memo para no repetirlo casilla a casilla.
  roofGeometry(tx, ty, memo) {
    const key = `${tx},${ty}`;
    if (memo.has(key)) return memo.get(key);
    // Región 4-conexa de casillas con tejado
    const region = new Set([key]), todo = [[tx, ty]], tiles = [];
    while (todo.length && region.size <= ROOF_MAX_TILES) {
      const [x, y] = todo.pop();
      tiles.push([x, y]);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const k = `${nx},${ny}`;
        if (!region.has(k) && this.roofAt(nx, ny)) { region.add(k); todo.push([nx, ny]); }
      }
    }
    // Bordes de la región (lados de casilla sin tejado al otro lado), como segmentos [x0, y0, x1, y1]
    const edges = [];
    const has = (x, y) => region.has(`${x},${y}`);
    for (const [x, y] of tiles) {
      if (!has(x, y - 1)) edges.push([x, y, x + 1, y]);
      if (!has(x, y + 1)) edges.push([x, y + 1, x + 1, y + 1]);
      if (!has(x - 1, y)) edges.push([x, y, x, y + 1]);
      if (!has(x + 1, y)) edges.push([x + 1, y, x + 1, y + 1]);
    }
    for (const [x, y] of tiles) {
      const h = { nw: roofDistance(x, y, edges), ne: roofDistance(x + 1, y, edges), se: roofDistance(x + 1, y + 1, edges), sw: roofDistance(x, y + 1, edges), c: roofDistance(x + 0.5, y + 0.5, edges) };
      const eaves = { n: !has(x, y - 1), e: !has(x + 1, y), s: !has(x, y + 1), w: !has(x - 1, y) };
      memo.set(`${x},${y}`, { h, eaves });
    }
    return memo.get(key);
  }

  // Quita un objeto recolectado
  remove(o) {
    if (o.planted) return o.planted.remove(o);   // árboles plantados por el jugador
    const cx = Math.floor(o.x / CHUNK), cy = Math.floor(o.y / CHUNK);
    this.delta(cx, cy, true).removed[o.key] = this.clock;
    this.touch(cx, cy);
  }

  // ¿Se puede labrar esta casilla? Tierra con hierba, sin nada encima y fuera del camino del pueblo.
  canTill(tx, ty) {
    const x = tx + 0.5, y = ty + 0.5, b = this.gen.biomeAt(x, y);
    if (![B.MEADOW, B.FOREST, B.PINES, B.SWAMP].includes(b)) return false;
    if (inBounds(x, y) && !isGrass(x, y)) return false;
    const d = this.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK));
    if (d && d.tilled[`${tx},${ty}`] !== undefined) return false;
    if (this.at('placed', tx, ty) || this.at('floor', tx, ty)) return false;
    return !this.collidersNear(x, y).some(c => (c.r !== undefined ? Math.hypot(c.x - x, c.y - y) < c.r + 0.45 : !c.rx && x > c.x0 - 0.45 && x < c.x1 + 0.45 && y > c.y0 - 0.45 && y < c.y1 + 0.45));
  }
  till(tx, ty) {
    const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK);
    this.delta(cx, cy, true).tilled[`${tx},${ty}`] = this.clock;
    this.touch(cx, cy);
  }

  // ¿Se puede colocar algo en esta casilla? Tierra firme, libre y sin pisar el camino del pueblo.
  // Cada capa tiene sus reglas: el suelo va debajo de todo y el tejado necesita un muro o un suelo debajo.
  // Dentro de tu casa se puede construir aunque sea terreno del pueblo.
  canPlace(tx, ty, id, player, rot = 0) {
    if (extraTiles(id, tx, ty, rot).some(t => !this.canPlace(...t, 'silla', player))) return false;   // las otras casillas también tienen que caber
    const x = tx + 0.5, y = ty + 0.5, layer = layerOf(id), k = `${tx},${ty}`;
    if (layer === 'rug') return this.rugFits(rugRect(tx, ty, rot));
    if (this.water(x, y)) return false;
    if (inBounds(x, y) && !isGrass(x, y) && !inOwnHouse(x, y) && !this.buildAnywhere) return false;   // en modo admin, también en el pueblo
    const d = this.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK));
    if (this.at(layer, tx, ty) || d?.tilled[k] !== undefined) return false;
    if (layer === 'floor') return true;
    if (layer === 'roof') return !!(this.at('floor', tx, ty) || ['wall', 'door'].includes(this.pieceAt(tx, ty)?.kind));
    if (this.layers.some(l => l.blocks?.(tx, ty))) return false;
    if ((id === 'candelabro' || id === 'chimenea' || layer === 'hang') && !this.roofAt(tx, ty)) return false;   // (dentro de casa: el candelabro se cuelga del techo)
    if ((id === 'chimenea' || layer === 'hang') && !this.wallBehind(tx, ty, rot)) return false;
    if (layer === 'hang' || ITEMS[id]?.place === 'flat') return true;
    if (player && Math.abs(player.x - x) < 0.8 && Math.abs(player.y - y) < 0.8) return false;   // no encerrarse
    return !this.collidersNear(x, y).some(c => (c.r !== undefined ? Math.hypot(c.x - x, c.y - y) < c.r + 0.4 : !c.rx && x > c.x0 - 0.4 && x < c.x1 + 0.4 && y > c.y0 - 0.4 && y < c.y1 + 0.4));
  }
  place(tx, ty, id, rot = 0) {
    const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK), layer = layerOf(id), d = this.delta(cx, cy, true);
    (d[layer] ||= {})[`${tx},${ty}`] = rot ? `${id}@${rot}` : id;
    if (id === 'cofre') d.chest[`${tx},${ty}`] = Array(18).fill(null);
    if (id === 'mochila' || id === 'armario') d.chest[`${tx},${ty}`] = Array(27).fill(null);   // (la mochila en el suelo es como un cofre; el armario, para la ropa)
    this.touchAround(tx, ty);
  }
  // Quita lo que puso el jugador en una casilla. Lo fijo del pueblo no se quita: devuelve false.
  unplace(o) {
    const [tx, ty] = o.tile, layer = o.layer || 'placed', k = `${tx},${ty}`;
    if (o.fixed || !this.ownAt(layer, tx, ty)) return false;
    const d = this.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK));
    delete d[layer][k];
    if (layer === 'placed' && (o.placed === 'cofre' || o.placed === 'mochila' || o.placed === 'armario')) delete d.chest[k];
    if (layer === 'placed' && d.closed) delete d.closed[k];
    if (layer === 'placed' && d.off) delete d.off[k];
    this.touchAround(tx, ty);
    return true;
  }
  // Puertas: abiertas salvo que se hayan cerrado (se guarda en el trozo, también las del pueblo y las aldeas)
  doorClosed(tx, ty) { return !!this.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK))?.closed?.[`${tx},${ty}`]; }
  toggleDoor(tx, ty) {
    const d = this.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK), true), k = `${tx},${ty}`;
    d.closed ||= {};
    if (d.closed[k]) delete d.closed[k]; else d.closed[k] = true;
    this.touchAround(tx, ty);
    return !!d.closed[k];
  }
  // Luces apagadas (lámparas, antorchas, velas, hogares y candelabros): se guarda en el trozo, como las puertas.
  // k: la casilla ("x,y") o, el candelabro de una casa, "c:x,y" (la casilla del centro de la casa)
  lightOff(tx, ty, k = `${tx},${ty}`) { return !!this.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK))?.off?.[k]; }
  toggleLight(tx, ty, k = `${tx},${ty}`) {
    const d = this.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK), true);
    d.off ||= {};
    if (d.off[k]) delete d.off[k]; else d.off[k] = 1;
    this.touchAround(tx, ty);
    return !d.off[k];
  }
  // El hogar más cercano (pieza de construcción), o null
  hearthNear(x, y, r = 1.5) {
    for (let ty = Math.floor(y) - 1; ty <= Math.floor(y) + 1; ty++) for (let tx = Math.floor(x) - 1; tx <= Math.floor(x) + 1; tx++) if (Math.hypot(tx + 0.5 - x, ty + 0.5 - y) < r && this.pieceAt(tx, ty)?.kind === 'hearth') return [tx, ty];
    return null;
  }
  // La ventana más cercana a un punto (se abre y se cierra como una puerta: se guarda igual), o null
  windowNear(x, y, r = 1.3) {
    let best = null, bd = r;
    for (let ty = Math.floor(y) - 1; ty <= Math.floor(y) + 1; ty++) for (let tx = Math.floor(x) - 1; tx <= Math.floor(x) + 1; tx++) {
      const dist = Math.hypot(tx + 0.5 - x, ty + 0.5 - y), v = this.at('placed', tx, ty);
      if (dist < bd && v && parsePlaced(v)[0].startsWith('ventana')) { best = [tx, ty]; bd = dist; }
    }
    return best;
  }
  // La puerta más cercana a un punto (a menos de r de su centro), o null
  doorNear(x, y, r = 1.5) {
    let best = null, bd = r;
    for (let ty = Math.floor(y) - 1; ty <= Math.floor(y) + 1; ty++) for (let tx = Math.floor(x) - 1; tx <= Math.floor(x) + 1; tx++) {
      const dist = Math.hypot(tx + 0.5 - x, ty + 0.5 - y);
      if (dist < bd && this.pieceAt(tx, ty)?.kind === 'door') { best = [tx, ty]; bd = dist; }
    }
    return best;
  }
  // Las vallas, las puertas y los tejados miran a sus vecinas: si están en otro trozo, también hay que rehacerlo
  touchAround(tx, ty) {
    const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK);
    this.touch(cx, cy);
    for (const [x, y] of [[tx + 1, ty], [tx - 1, ty], [tx, ty + 1], [tx, ty - 1]]) {
      const nx = Math.floor(x / CHUNK), ny = Math.floor(y / CHUNK);
      if ((nx !== cx || ny !== cy) && this.delta(nx, ny)) this.touch(nx, ny);
    }
    // Un tejado cambia la forma de toda su región: que se rehagan los trozos de alrededor
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) this.merged.delete(`${cx + dx},${cy + dy}`);
  }
  // ¿Están aquí los pies de una cama (o de otra cosa de dos casillas)?
  footAt(tx, ty) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const v = this.at('placed', tx + dx, ty + dy), [id, rot] = v ? parsePlaced(v) : [];
      if (LONG[id] && extraTiles(id, tx + dx, ty + dy, rot).some(([x, y]) => x === tx && y === ty)) return true;
    }
    return false;
  }
  // La casilla de lo de varias casillas que ocupa también esta (o null)
  anchorOf(tx, ty) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const v = this.ownAt('placed', tx + dx, ty + dy), [id, rot] = v ? parsePlaced(v) : [];
      if (LONG[id] && extraTiles(id, tx + dx, ty + dy, rot).some(([x, y]) => x === tx && y === ty)) return [tx + dx, ty + dy];
    }
    return null;
  }
  chestAt(tx, ty) { return this.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK))?.chest?.[`${tx},${ty}`]; }
  chestTouched(tx, ty) { const k = `${Math.floor(tx / CHUNK)},${Math.floor(ty / CHUNK)}`; this.dirty.add(k); this.onTouch?.(k); }
  // ¿Está esta casilla bajo un tejado? (para ocultar el tejado cuando el jugador entra en casa)
  roofAt(tx, ty) { return !!this.at('roof', tx, ty); }
  // Lo colocado cerca de un punto (para usar estaciones y recoger muebles), lo más cercano primero
  placedNear(x, y, r) {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK), out = [];
    // Distancia a lo colocado; a lo de dos casillas (la cama), a la más cercana de las dos
    const dist = o => (o.fx ? Math.hypot(x - clamp(x, o.fx[0] + 0.5, o.fx[1] - 0.5), y - clamp(y, o.fy[0] + 0.5, o.fy[1] - 0.5)) : Math.hypot(o.x - x, o.y - y));
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const c = this.contentFor(cx + dx, cy + dy);
      for (const o of c.objects) if (o.placed && !PIECES[o.placed] && dist(o) < r) out.push(o);
      for (const o of c.flats) if (dist(o) < r) out.push(o);
    }
    return out.sort((a, b) => dist(a) - dist(b));
  }
  // Un objeto colocado (mueble, estación o pieza) en una casilla, con sus datos, o null
  placedObjectAt(tx, ty) {
    const c = this.contentFor(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK));
    return c.objects.concat(c.flats).find(o => o.tile && o.tile[0] === tx && o.tile[1] === ty && o.layer === 'placed') || null;
  }

  // Objetos recolectables cerca de un punto
  harvestablesNear(x, y) {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK), out = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const o of this.contentFor(cx + dx, cy + dy).objects) if (o.kind) out.push(o);
    return out;
  }
  // Colisiones cerca de una posición (el pueblo, Nilo y lo del trozo actual y sus vecinos)
  collidersNear(x, y) {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK), out = [...this.village.colliders, { x: this.nilo.x, y: this.nilo.y, r: 0.35 }, ...(this.extraColliders || [])];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const c of this.contentFor(cx + dx, cy + dy).colliders) out.push(c);
    return out;
  }
  // ¿Se llega de un punto a otro sin un muro o una puerta cerrada por medio? (para no acariciar, hablar ni
  // recoger nada a través de ellos)
  reaches(x0, y0, x1, y1) {
    for (const c of this.collidersNear((x0 + x1) / 2, (y0 + y1) / 2)) if (c.wall && crosses(x0, y0, x1, y1, c)) return false;
    return true;
  }
  // Rehacer el pueblo (se termina un proyecto)
  rebuildVillage() {
    this.village = buildVillage();
    this.merged.clear();
  }
  // Agua: la profunda no se puede pisar; la poco profunda se cruza despacio
  water(x, y) { return inBounds(x, y) ? null : BIOMES[this.gen.biomeAt(x, y)].water || null; }
  blocked(x, y) { return this.water(x, y) === 'deep'; }
}
