// Escena del mundo exterior: el planeta (ver planet.js), por trozos. Ofrece objetos, entidades y colisiones. Todo lo que hay en el mundo va en la cuadrícula de casillas: lo que construye
// el jugador (deltas) y lo fijo del pueblo y de las aldeas (la "capa base", que no se puede quitar). Los trozos se
// guardan con su número dentro del planeta; los de más allá de la costura (para verlos y chocar con ellos desde el
// otro lado) son los mismos, corridos una vuelta. Fuera del planeta no se construye.
import { clamp, ihash } from '../util.js';
import { groundSmooth, grassKeep } from './ground.js';
import { WorldGen, CHUNK, GRASS_REGROW, flowerShows } from './gen.js';
import { inYard, buildVillage, NILO, inBounds, isGrass, inOwnHouse, inVillageHouse } from './village.js';
import { B, BIOMES, WATER_Y } from './biomes.js';
import { ITEMS, CHESTS, modernSlots } from '../items.js';
import '../buildables.js';   // (LEGACY_ITEMS con los muebles: también en el servidor)
import { extraTiles, LONG, BED_BACK, HEARTH_BACK, GLOW, LIGHT, front, SIDE, rugRect, RUG_SIZES, TABLE_SIZES, TABLES, TUCK } from '../art/stations.js';
import { solidsOf, hull, placeBoxes, bounds, aabb, sat, hitsCircle, distTo, obb, dirOf, sideOf } from './fit.js';
import { wallRuns, WINDOW_Z, T } from '../art/build.js';
import { PIECES, layerOf, parsePlaced } from '../pieces.js';
import { Person } from '../entities.js';
import { wrapIndex, inPlanet, dxOf } from './planet.js';
import { roofShape } from './roof.js';

const WADE_MAX = 0.5;   // (ver blocked)

// Lo de un trozo visto desde el otro lado de la costura: lo mismo, corrido off casillas en x
const X_KEYS = new Set(['x', 'x0', 'x1', 'cx']);
const PAD_R = 7, NO_TILES = [];   // (el allanado alrededor de lo construido de antes: ver padK)
// La altura de lo construido (ver levelFor): a escalones de LV_STEP; una casilla se junta a la altura de las de al lado si
// no le sacan más de LV_JOIN (así una casa en cuesta queda a una sola altura, sobre su cimiento)
const LV_STEP = 0.25, LV_JOIN = 1.5;
// Lo cavado con la pala (ver digH): cada bloque mide DIG_H (dos escalones de lo construido, así lo que se ponga en un hoyo
// cae justo en su suelo), se cava hasta DIG_DOWN bloques y se apila hasta DIG_UP por encima del suelo de ahí
export const DIG_H = 0.5, DIG_DOWN = 16, DIG_UP = 3;
// El pozo va en una casilla cavada al menos WELL_DOWN bloques (ver fitWell). Su modelo, 'pozo:n', baja n escalones de
// LV_STEP desde su brocal hasta el fondo de lo cavado (wellModel)
export const WELL_DOWN = 5;
const wellModel = (lvl, dig) => (typeof lvl === 'number' && typeof dig === 'number' && lvl > dig ? `pozo:${Math.min(80, Math.round((lvl - dig) / LV_STEP))}` : 'pozo');
// Dónde se cava: en la tierra y la hierba (no en la arena, la roca, la nieve ni el agua), y no en las cuestas de roca
// (lo que sube la casilla de una esquina a otra: el suelo pinta roca desde una pendiente de 0,62)
const DIG_BIOMES = new Set([B.MEADOW, B.FOREST, B.PINES, B.SWAMP]), DIG_STEEP = 0.6;
// La firma de lo cavado de un trozo (para saber si ha cambiado, venga de aquí o de la red)
const digSigOf = dig => (dig ? Object.entries(dig).map(([k, h]) => k + ':' + h).join(';') : '');
function shifted(v, off) {
  if (Array.isArray(v)) return v.map(e => (e && typeof e === 'object' ? shifted(e, off) : e));
  const o = {};
  for (const [k, e] of Object.entries(v)) {
    if (typeof e === 'number' && X_KEYS.has(k)) o[k] = e + off;
    else if (k === 'tile' && Array.isArray(e)) o[k] = [e[0] + off, e[1]];
    else if (k === 'fx' && Array.isArray(e)) o[k] = e.map(v => v + off);
    else if (e && typeof e === 'object' && Object.getPrototypeOf(e) === Object.prototype || Array.isArray(e)) o[k] = shifted(e, off);
    else o[k] = e;
  }
  return o;
}

export const NILO_LOOK = { sex: 'chico', skin: '#8a5234', hair: '#c8c4cc', eyes: '#6a3a1e', cloth: '#4a9a4a', pants: '#3a4a6a', hairStyle: 'corto', outfit: 'tunica', beard: true };

// ¿Estorba este choque a lo que se ponga en el centro de la casilla (x, y), con este margen? Lo bajo de una valla o de una
// puerta de valla va en su casilla, y como mucho llega al borde (los postes de la puerta van justo ahí): solo se mira de cerca
const LOW_MARGIN = 0.3;
function clashes(c, x, y, margin) {
  if (c.dig) return false;   // (en lo cavado se puede poner lo que sea: va a su altura)
  const m = c.low ? LOW_MARGIN : margin;
  return c.r !== undefined ? Math.hypot(c.x - x, c.y - y) < c.r + m : !c.rx && x > c.x0 - m && x < c.x1 + m && y > c.y0 - m && y < c.y1 + m;
}
// Cómo se apunta en el trozo que algo de lo que venía puesto ya no está
const goneKey = (layer, k) => (layer === 'placed' ? k : `${layer}:${k}`);
const ROOF_MAX_TILES = 900;   // tope de casillas de una región de tejado (para calcular su forma)
const ROOF_MAX_LEVEL = 4;     // altura máxima de un tejado, en niveles

// De su centro a su parte de atrás, en lo que tiene espalda: si detrás hay un muro, se arrima a él
// (de la casilla a la parte de atrás de cada mueble, medido en su modelo: con un muro detrás, se pega a él)
const BACK = {
  cama: BED_BACK, cama_doble: BED_BACK, sofa: 0.42, cama_nino: 0.42, banera: 0.43, estanteria: 0.2, alacena: 0.28, encimera: 0.28, fregadero: 0.32, lavabo: 0.42, inodoro: 0.34, chimenea: HEARTH_BACK, lampara: 0.18,
  cocina: 0.38, horno: 0.44, banco: 0.32, cantero: 0.36, yunque: 0.3, telar: 0.3, quesera: 0.24, cofre: 0.28, armario: 0.33, mueble_bano: 0.24, mesita: 0.22, comoda: 0.26, sillon: 0.42, cuadro_valle: 0.05, cuadro_mar: 0.05, cuadro_flores: 0.05, cuadro_noche: 0.05, vitrina: 0.32, cuna: 0.3, mesa: 0.42, incubadora: 0.26, maceta: 0.28, silla: 0.22,
};

// Las encimeras se unen con lo que tengan al lado (otra encimera, la alacena, el fregadero o la cocina): se alargan
// hasta tocarlo (entre dos encimeras en fila, cada una la mitad del hueco). Lo puesto agachado no se une. En una esquina en L con el rincón vacío,
// una sigue por él hasta el fondo de la otra (queda esquinera) y la otra llega hasta su frente.
// list: [{ key, id, x, y, a }]; devuelve, por cada encimera, lo que se alarga por la izquierda y por la derecha
const COUNTER = [-0.48, -0.28, 0.48, 0.22];   // el tablero de la encimera, en planta: x0, z0, x1, z1 (de lado a lado; de atrás a delante)
const JOINS = new Set(['encimera', 'alacena', 'fregadero', 'cocina']);
const JOIN = 0.4, JOIN_TOL = 0.08, JOIN_ANG = 0.07;   // (el hueco más ancho que se rellena, el margen y el giro que se perdona: 4°)
function counterJoins(list) {
  const rect = c => (c.id === 'encimera' ? COUNTER : (h => [h[0], h[2], h[3], h[5]])(hull(solidsOf(c.id))));
  // N visto desde A (x: a lo ancho de A, hacia su derecha; z: hacia donde mira A), si están a escuadra (si no,
  // null): la caja de N (alargada lo que diga ext), si van en paralelo y hacia dónde mira N a lo ancho de A (±1)
  const rel = (A, N, ext) => {
    const d = N.a - A.a, q = Math.round(d / (Math.PI / 2));
    if (Math.abs(d - q * Math.PI / 2) > JOIN_ANG) return null;
    const [ux, uy] = sideOf(A.a), [vx, vy] = dirOf(A.a), [nux, nuy] = sideOf(N.a), [nvx, nvy] = dirOf(N.a);
    const [x0, z0, x1, z1] = rect(N), [l, r] = ext.get(N) || [0, 0], xs = [], zs = [];
    for (const p of [x0 - l, x1 + r]) for (const k of [z0, z1]) {
      const wx = N.x + nux * p + nvx * k - A.x, wy = N.y + nuy * p + nvy * k - A.y;
      xs.push(wx * ux + wy * uy); zs.push(wx * vx + wy * vy);
    }
    return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), par: q % 2 === 0, face: Math.round(nvx * ux + nvy * uy) };
  };
  const tops = list.filter(c => c.id === 'encimera').sort((a, b) => (a.key < b.key ? -1 : 1)), [, Z0, X1, Z1] = COUNTER;
  // 1. Las esquinas con el rincón vacío: la otra mira hacia esta y empieza en su frente; esta sigue hasta el fondo
  // de la otra (o, si la otra se mete un poco, hasta su frente). Solo una de las dos se queda el rincón
  const corner = new Map(), claimed = new Set(), none = new Map();
  for (const A of tops) for (const s of [-1, 1]) for (const N of tops) {
    if (N === A || claimed.has(`${N.key}|${A.key}`)) continue;
    const n = rel(A, N, none);
    if (!n || n.par || n.face !== -s) continue;
    const w0 = s > 0 ? n.x0 : -n.x1, w1 = s > 0 ? n.x1 : -n.x0;
    if (w0 - X1 < -JOIN_TOL || w0 - X1 > JOIN || n.z0 - Z1 < -JOIN_TOL || n.z0 - Z1 > JOIN) continue;
    const e = corner.get(A) || [0, 0];
    e[s > 0 ? 1 : 0] = Math.max(0, (n.z0 >= Z1 - 0.01 ? w1 : w0) - X1);
    corner.set(A, e); claimed.add(`${A.key}|${N.key}`);
  }
  // 2. Hasta lo que tenga al lado, si lo cubre de atrás a delante (el hueco más corto)
  const out = new Map();
  for (const A of tops) {
    const e = [...(corner.get(A) || [0, 0])];
    for (const s of [-1, 1]) {
      const i = s > 0 ? 1 : 0;
      if (e[i]) continue;
      let best = Infinity;
      for (const N of list) {
        const n = N !== A && rel(A, N, corner);
        if (!n || n.z0 > Z0 + JOIN_TOL || n.z1 < Z1 - JOIN_TOL) continue;
        const gap = (s > 0 ? n.x0 : -n.x1) - X1;
        if (gap < -JOIN_TOL || gap > JOIN || gap >= best) continue;
        best = gap; e[i] = Math.max(0, gap) / (n.par && N.id === 'encimera' ? 2 : 1);
      }
    }
    out.set(A, e.map(v => +v.toFixed(3)));
  }
  return out;
}

// Los muros, en tramos: los trozos de cada casilla que siguen en línea, juntos (si no, al arrimar algo a un muro se
// enganchaba en las juntas entre casillas y se corría hacia ellas)
function joinedWalls(list) {
  const rs = list.map(w => [w.x - w.hx, w.y - w.hy, w.x + w.hx, w.y + w.hy]), same = (a, b) => Math.abs(a - b) < 1e-3;
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < rs.length && !merged; i++) for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i], b = rs[j];
      const alongX = same(a[1], b[1]) && same(a[3], b[3]) && a[0] <= b[2] + 1e-3 && b[0] <= a[2] + 1e-3;
      const alongY = same(a[0], b[0]) && same(a[2], b[2]) && a[1] <= b[3] + 1e-3 && b[1] <= a[3] + 1e-3;
      if (!alongX && !alongY) continue;
      rs[i] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
      rs.splice(j, 1); merged = true; break;
    }
  }
  return rs.map(([x0, y0, x1, y1]) => aabb(x0, y0, x1, y1));
}

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
// Lo colocado libre: donde se puso y con su giro. Choca con la caja que envuelve su modelo (las personas) y, para
// colocar otra cosa al lado, con cada una de sus cajas, a su altura (solids). Devuelve true si es plano
const SNAP = 0.35, MAX_PUSH = 0.45, NUDGE = 0.12;   // (a menos de SNAP de un muro, se pega; si lo corta menos de MAX_PUSH, se saca; de un mueble, solo si lo roza: NUDGE)
const BIG_HOUSE = new Set(['gallinero', 'establo']);   // (con la puerta abierta o cerrada)
function freeObject(o, id, rot, [x, y, a], { colliders, lights, solids }) {
  Object.assign(o, { x, y, yaw: a, rot, free: true, glow: GLOW[id] });
  const [ux, uy] = sideOf(a), [vx, vy] = dirOf(a);
  if (LIGHT[id] && !o.off) { const [lx, ly, lz, lr] = LIGHT[id]; lights.push({ x: x + ux * lx + vx * ly, y: y + uy * lx + vy * ly, z: lz, r: lr }); }
  if (LONG[id] === 'table') o.model = `mesa_grande:${TABLE_SIZES[(rot || 0) % TABLE_SIZES.length].join('x')}`;
  if (ITEMS[id].place === 'flat') return true;
  const local = solidsOf(o.model || id), box = placeBoxes([hull(local)], x, y, a)[0];
  o.obb = box;
  // (en el establo con la puerta abierta se entra: chocan sus paredes, no todo él; lo alto no molesta)
  if (id === 'establo' && o.model !== 'establo:shut') for (const s of placeBoxes(local.filter(l => l[1] < 1), x, y, a)) colliders.push({ ...bounds(s), obb: s, free: true });
  // (el pozo: lo bajo, la losa y el brocal; el tejadillo vuela por encima de la cabeza y no quita sitio a la casilla de al
  // lado, que se puede cercar o labrar pegada)
  else if (id === 'pozo') { const s = placeBoxes([hull(local.filter(l => l[1] < 1))], x, y, a)[0]; colliders.push({ ...bounds(s), obb: s, free: true }); }
  else colliders.push({ ...bounds(box), obb: box, free: true });
  for (const s of placeBoxes(local, x, y, a)) solids.push(s);
  return false;
}
function itemObject(o, id, rot, colliders, lights, [sx, sy] = [0, 0]) {
  const [tx, ty] = o.tile;
  o.x += sx; o.y += sy;
  o.rot = rot; o.yaw = (rot % 4) * Math.PI / 2; o.glow = GLOW[id];
  if (LIGHT[id] && !o.off) { const [lx, ly, lz, lr] = LIGHT[id]; lights.push({ x: o.x + lx, y: o.y + ly, z: lz, r: lr }); }
  if (ITEMS[id].place === 'flat' || ITEMS[id].place === 'rug') return true;   // (la alfombra de antes, de una casilla)
  if (LONG[id]) {   // varias casillas: la suya y las de los pies (y, la cama doble, las de al lado)
    const ts = [[tx, ty], ...extraTiles(id, tx, ty, rot)], xs = ts.map(t => t[0]), ys = ts.map(t => t[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs) + 1, y0 = Math.min(...ys), y1 = Math.max(...ys) + 1;
    o.fx = [x0 + sx, x1 + sx]; o.fy = [y0 + sy, y1 + sy];
    colliders.push({ x0: x0 + 0.06 + sx, y0: y0 + 0.06 + sy, x1: x1 - 0.06 + sx, y1: y1 - 0.06 + sy });
    // (la mesa grande se dibuja de su tamaño, centrada en lo que ocupa y sin girar)
    if (LONG[id] === 'table') Object.assign(o, { x: (x0 + x1) / 2, y: (y0 + y1) / 2, yaw: 0, model: `mesa_grande:${x1 - x0}x${y1 - y0}` });
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
    this.wrapped = new Map();     // (los trozos de más allá de la costura, ya corridos)
    this.village = buildVillage();
    this.gen = new WorldGen(seed);
    this.nilo = new Person({ ...NILO, look: NILO_LOOK, flip: true });
    this.entities = [this.nilo];
    this.bounds = null;
    this.layers = [];             // otras capas de contenido por trozo (cultivos, lugares…): { add(cx, cy, delta, out), baseAt?(layer, tx, ty) }
    this.onTouch = null;          // avisa de cada trozo que cambia (para jugar juntos en directo)
    this.touches = 0;             // sube con cada cambio de cualquier trozo (lo lejano solo se vuelve a mirar entonces)
    // (las casas tenían un candelabro por su cuenta, que se apagaba aparte: "c:x,y" en d.off. Ya no lo hay; lo que quede
    // de entonces se olvida y se guarda así)
    for (const [k, d] of deltas) if (d?.off) for (const o of Object.keys(d.off)) if (o.startsWith('c:')) { delete d.off[o]; this.dirty.add(k); }
    // Lo cavado: los trozos que tienen algo (clave → su firma; ver digNote) y una cuenta que sube con cada cambio (la vista
    // rehace con ella los hoyos del suelo). Las alturas de las esquinas, guardadas mientras no cambie nada (ver cornerH)
    this.digChunks = new Map(); this.digV = 0; this.corners = new Map(); this.cornersT = -1;
    for (const [k, d] of deltas) { const sg = !k.startsWith('u:') && digSigOf(d?.dig); if (sg) this.digChunks.set(k, sg); }
  }

  // ---------- lo cavado con la pala ----------
  // Como en Minecraft: la pala saca un bloque de tierra de una casilla (el suelo baja DIG_H) y lo suelta en otra (sube). Va
  // en el trozo (d.dig: casilla → la altura de su suelo, en metros y a escalones de lo construido), así lo ven todos y se
  // guarda, y no se mueve aunque cambie el allanado de alrededor. La casilla tocada es llana, con paredes de tierra hasta
  // las de al lado: las dibuja la vista (three/dig3d.js). De la altura natural (digBase) se parte al tocarla por primera
  // vez; los bloques se cuentan desde ella (digDepth)
  // La altura de una casilla tocada, o null si está como era. Rápido: sin nada tocado en el mundo, ni mira; si no, solo los
  // trozos que tienen algo (también los de más allá de la costura, corridos una vuelta)
  digH(tx, ty) {
    if (!this.digChunks.size) return null;
    const cx = Math.floor(tx / CHUNK), own = wrapIndex(cx, CHUNK), k = `${own},${Math.floor(ty / CHUNK)}`;
    if (!this.digChunks.has(k)) return null;
    return this.deltas.get(k)?.dig?.[`${tx - (cx - own) * CHUNK},${ty}`] ?? null;
  }
  // La altura del suelo natural en una esquina (como la malla del suelo: el relieve allanado junto a lo de antes), guardada
  // hasta que cambie algún trozo (el allanado depende de lo construido)
  cornerH(x, y) {
    if (this.cornersT !== this.touches) { this.corners.clear(); this.cornersT = this.touches; }
    const k = `${x},${y}`;
    let h = this.corners.get(k);
    if (h === undefined) { h = this.groundRaw(x, y); if (this.corners.size > 4000) this.corners.clear(); this.corners.set(k, h); }
    return h;
  }
  // La altura del suelo natural en un punto, sin lo cavado: la de la malla (cada casilla, dos triángulos entre sus esquinas)
  naturalAt(x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y), fu = x - x0, fv = y - y0, b = this.cornerH(x0 + 1, y0), c = this.cornerH(x0, y0 + 1);
    if (fu + fv <= 1) { const a = this.cornerH(x0, y0); return a + (b - a) * fu + (c - a) * fv; }
    const d = this.cornerH(x0 + 1, y0 + 1); return d + (c - d) * (1 - fu) + (b - d) * (1 - fv);
  }
  // La altura natural de una casilla para la pala: la media de sus esquinas, a escalones de LV_STEP
  digBase(tx, ty) { return Math.round((this.cornerH(tx, ty) + this.cornerH(tx + 1, ty) + this.cornerH(tx, ty + 1) + this.cornerH(tx + 1, ty + 1)) / 4 / LV_STEP) * LV_STEP; }
  // Cuántos bloques está una casilla por debajo de su altura natural (por encima, negativo; 0 si está como era)
  digDepth(tx, ty) { const h = this.digH(tx, ty); return h === null ? 0 : (this.digBase(tx, ty) - h) / DIG_H; }
  // El suelo donde se pisa en (x, y): lo construido, lo cavado o el natural (para andar junto a los hoyos: entities.js)
  surfaceAt(x, y) {
    const L = this.levelAt(x, y);
    if (L !== null) return L;
    return this.digH(Math.floor(x), Math.floor(y)) ?? this.naturalAt(x, y);
  }
  // ¿Hay algo cavado a r casillas o menos de (x, y)?
  digNear(x, y, r = 2) {
    if (!this.digChunks.size) return false;
    const tx = Math.floor(x), ty = Math.floor(y);
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (this.digH(tx + i, ty + j) !== null) return true;
    return false;
  }
  // Lo que frena al andar junto a lo cavado: las casillas de alrededor de (x, y) cuyo suelo queda más de step por encima de
  // los pies (feet). Las naturales solo cuentan desde una casilla cavada (las paredes del hoyo); entre dos naturales, nada
  // cambia. De cada una, la altura del punto más cercano (en cuesta, la del borde)
  digWalls(x, y, feet, step) {
    const tx = Math.floor(x), ty = Math.floor(y), out = [], inPit = this.digH(tx, ty) !== null;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      if (!i && !j) continue;
      const ax = tx + i, ay = ty + j, D = this.digH(ax, ay);
      if (D === null && !inPit) continue;
      // (lo construido, a su altura: un suelo o una valla junto al hoyo también son pared)
      const h = this.levelAt(ax + 0.5, ay + 0.5) ?? D ?? this.naturalAt(Math.min(ax + 1, Math.max(ax, x)), Math.min(ay + 1, Math.max(ay, y)));
      if (h > feet + step) out.push({ x0: ax, y0: ay, x1: ax + 1, y1: ay + 1 });
    }
    return out;
  }
  // Lo tocado en un rectángulo de casillas [x0, x1) × [y0, y1): [[tx, ty, altura]] (para la vista)
  digList(x0, y0, x1, y1) {
    const list = [];
    if (!this.digChunks.size) return list;
    // (si el rectángulo cae más allá de la costura, los trozos van corridos una vuelta: off)
    const mid = Math.floor((x0 + x1) / 2 / CHUNK), off = (mid - wrapIndex(mid, CHUNK)) * CHUNK;
    for (const k of this.digChunks.keys()) {
      const [cx, cy] = k.split(',').map(Number);
      if ((cy + 1) * CHUNK <= y0 || cy * CHUNK >= y1) continue;
      const sx = cx * CHUNK + off;
      if (sx + CHUNK <= x0 || sx >= x1) continue;
      for (const [t, h] of Object.entries(this.deltas.get(k)?.dig || {})) {
        if (typeof h !== 'number') continue;
        const c = t.indexOf(','), tx = +t.slice(0, c) + off, ty = +t.slice(c + 1);
        if (tx >= x0 && tx < x1 && ty >= y0 && ty < y1) list.push([tx, ty, h]);
      }
    }
    return list;
  }
  // Al cambiar un trozo (aquí o por la red): si ha cambiado lo cavado, se apunta
  digNote(k) {
    if (k.startsWith('u:')) return;
    const sg = digSigOf(this.deltas.get(k)?.dig), was = this.digChunks.get(k) || '';
    if (sg === was) return;
    if (sg) this.digChunks.set(k, sg); else this.digChunks.delete(k);
    this.digV++;
  }
  // La altura que tendría una casilla al cavar (dn -1) o soltar tierra (dn 1), o null si vuelve a estar como era. Un bloque
  // más abajo o más arriba de lo que tiene; si una vecina tocada queda a un escalón de lo construido (LV_STEP) o menos, a la
  // suya: así un hoyo de varias casillas en cuesta tiene el fondo llano (y un montón, la cima). Rellenando un hoyo o
  // quitando un montón, al llegar a un escalón de su altura natural vuelve a estar como era
  digNext(tx, ty, dn) {
    const base = this.digBase(tx, ty), cur = this.digH(tx, ty), from = cur ?? base;
    let h = from + dn * DIG_H;
    if (cur !== null && (cur < base ? h >= base - LV_STEP - 1e-6 && dn > 0 : h <= base + LV_STEP + 1e-6 && dn < 0)) return null;
    let best = Infinity;
    for (const [nx, ny] of [[tx + 1, ty], [tx - 1, ty], [tx, ty + 1], [tx, ty - 1]]) {
      const o = this.digH(nx, ny);
      if (o !== null && Math.abs(o - h) <= LV_STEP + 1e-6 && Math.abs(o - h) < Math.abs(best - h)) best = o;
    }
    if (best !== Infinity) h = best;
    return Math.round(h / LV_STEP) * LV_STEP;
  }
  // ¿Se puede cavar (up: false) o soltar tierra (up: true) en esta casilla? '' si sí; si no, por qué
  digWhy(tx, ty, up) {
    const x = tx + 0.5, y = ty + 0.5, k = `${tx},${ty}`;
    if (!inPlanet(x, y)) return 'Ahí no se puede';
    if (inBounds(x, y)) return 'En el pueblo no se cava';
    const cur = this.digH(tx, ty);
    if (cur === null && !DIG_BIOMES.has(this.gen.biomeAt(x, y))) return 'Solo se cava en la tierra y la hierba';
    if (this.water(x, y)) return 'Ahí hay agua';
    const c = [this.cornerH(tx, ty), this.cornerH(tx + 1, ty), this.cornerH(tx, ty + 1), this.cornerH(tx + 1, ty + 1)];
    if (Math.min(...c) < 0.05) return 'Demasiado cerca del agua';
    if (cur === null && Math.max(...c) - Math.min(...c) > DIG_STEEP) return 'Ahí es roca';
    const d = this.deltas.get(`${wrapIndex(Math.floor(tx / CHUNK), CHUNK)},${Math.floor(ty / CHUNK)}`);
    if (this.wellAt(x, y)) return 'Ahí está el pozo';
    if (this.builtAt(d, k) || d?.lvl?.[k] !== undefined || d?.crops?.[k] || d?.trees?.[k]) return 'Hay algo encima';
    for (const layer of ['floor', 'placed', 'roof']) if (this.at(layer, tx, ty)) return 'Hay algo encima';
    if (this.layers.some(l => l.blocks?.(tx, ty))) return 'Ahí no se puede';
    if (this.collidersNear(x, y).some(c => !c.dig && clashes(c, x, y, 0.42))) return 'Hay algo encima';
    if (this.harvestablesNear(x, y).some(o => !o.flower && Math.floor(o.x) === tx && Math.floor(o.y) === ty)) return 'Hay algo encima';
    const h = this.digNext(tx, ty, up ? 1 : -1), base = this.digBase(tx, ty);
    if (h !== null && (up ? h > base + DIG_UP * DIG_H + 1e-6 : h < base - DIG_DOWN * DIG_H - 1e-6)) return up ? 'No se apila más alto' : 'No se cava más hondo';
    // Pegado al pozo: se rellena lo cavado para bajar a hacerlo (y se sube), pero no por encima de su losa, que enterraría el
    // brocal; y se cava, pero no por debajo de su fondo, hasta donde baja su forro de piedra (se ve desde el hoyo de al lado)
    if (h !== null) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      if (!(i || j) || !this.wellAt(x + i, y + j)) continue;
      const wk = `${tx + i},${ty + j}`, wd = this.deltas.get(`${wrapIndex(Math.floor((tx + i) / CHUNK), CHUNK)},${Math.floor((ty + j) / CHUNK)}`);
      const top = wd?.lvl?.[wk], bottom = wd?.dig?.[wk];
      if (up && typeof top === 'number' && h > top + 1e-6) return 'Taparía el pozo';
      if (!up && typeof bottom === 'number' && h < bottom - 1e-6) return 'Más hondo que el pozo, no';
    }
    return '';
  }
  // Cavar (dn -1) o soltar tierra (dn 1) en una casilla. Se queda sin hierba ni flores (la tierra, desnuda): la hierba vuelve
  // a salir sola, como lo segado, cuando la casilla vuelve a estar a su altura (today: el día del juego). Devuelve su altura
  // nueva (null: como era)
  digTile(tx, ty, dn, today) {
    const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK), h = this.digNext(tx, ty, dn), d = this.delta(cx, cy, true), k = `${tx},${ty}`;
    if (h !== null) (d.dig ||= {})[k] = h; else if (d.dig) { delete d.dig[k]; if (!Object.keys(d.dig).length) delete d.dig; }
    const m = (d.mown ||= {});
    for (const [q, v] of Object.entries(m)) if (today - v >= GRASS_REGROW) delete m[q];
    m[k] = today;
    for (const o of this.gen.content(cx, cy).objects) if (o.flower && Math.floor(o.x) === tx && Math.floor(o.y) === ty) d.removed[o.key] = this.clock;
    this.touchAround(tx, ty);
    return h;
  }

  // ---------- barcas amarradas ----------
  // La barca se construye (B) en el agua, junto a la orilla, y se queda amarrada donde se deja al bajar a tierra: van
  // en el trozo (d.boats: id → [x, y, giro]), así las ve todo el mundo. Al subir, se quita de aquí y va con quien rema
  moorBoat(x, y, yaw = 0) {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK), d = this.delta(cx, cy, true);
    (d.boats ||= {})[`${Math.round(x * 10)}_${Math.round(y * 10)}`] = [+x.toFixed(2), +y.toFixed(2), +(+yaw || 0).toFixed(2)];
    this.touch(cx, cy);
  }
  unmoorBoat(b) {
    const cx = Math.floor(b.x / CHUNK), cy = Math.floor(b.y / CHUNK), d = this.delta(cx, cy);
    if (!d?.boats?.[b.id]) return false;
    delete d.boats[b.id];
    this.touch(cx, cy);
    return true;
  }
  boatsNear(x, y, r) {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK), out = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const o of this.contentFor(cx + dx, cy + dy).objects) if (o.boat && Math.hypot(dxOf(o.x, x), o.y - y) <= r) out.push(o);
    return out.sort((a, b) => Math.hypot(dxOf(a.x, x), a.y - y) - Math.hypot(dxOf(b.x, x), b.y - y));
  }

  // ---------- la altura de lo construido ----------
  // Como los bloques de Minecraft: cada casilla construida tiene su altura (d.lvl, metros), la del suelo de ahí cuando se
  // puso lo primero, y todo lo de esa casilla se dibuja ahí. Las piezas de construcción (suelos, muros, puertas, vallas,
  // tejados) van a la altura más alta de las esquinas de la casilla, en escalones, con un cimiento de piedra debajo hasta
  // el suelo; lo demás (muebles sin suelo, lo labrado), a la del suelo en el centro. Lo construido antes de esto no tiene
  // altura: va a 0, y el suelo se allana a su alrededor (padK). En el pueblo todo es llano: sin altura.
  structAt(d, k) { const v = d?.placed?.[k]; return !!(d && (d.floor?.[k] || d.roof?.[k] || (v && PIECES[parsePlaced(v)[0]]))); }
  builtAt(d, k) { return !!(d && (d.floor?.[k] || d.placed?.[k] || d.roof?.[k] || d.hang?.[k] || d.rug?.[k] || d.tilled?.[k] !== undefined)); }
  // La altura de lo construido en (x, y), o null si ahí no hay nada construido
  levelAt(x, y) {
    const tx = Math.floor(x), ty = Math.floor(y), d = this.deltas.get(`${wrapIndex(Math.floor(tx / CHUNK), CHUNK)},${Math.floor(ty / CHUNK)}`);
    if (!d) return null;
    const k = `${tx},${ty}`, L = d.lvl?.[k];
    return L !== undefined ? L : this.builtAt(d, k) ? 0 : null;
  }
  groundRaw(x, y) { if (inBounds(x, y)) return 0; const h = Math.max(0, this.gen.groundAt(x, y)); return h > 0 ? h * this.padK(x, y) : 0; }   // (el suelo como se ve: allanado junto a lo de antes)
  // La altura que tendría id puesto en la casilla (para colocarlo y para la vista previa)
  levelFor(tx, ty, id) {
    if (inBounds(tx + 0.5, ty + 0.5)) return 0;
    const d = this.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK)), k = `${tx},${ty}`, have = d?.lvl?.[k];
    if (have === undefined && this.builtAt(d, k)) return 0;   // (lo de antes)
    // (el pozo: su losa, por encima de las cuatro esquinas de la casilla, como lo construido; el hoyo queda debajo)
    if (id === 'pozo') return Math.ceil(Math.max(this.cornerH(tx, ty), this.cornerH(tx + 1, ty), this.cornerH(tx, ty + 1), this.cornerH(tx + 1, ty + 1)) / LV_STEP - 0.05) * LV_STEP;
    const layer = layerOf(id), struct = layer === 'floor' || layer === 'roof' || !!PIECES[id];
    const D = this.digH(tx, ty);   // (en lo cavado o en la tierra apilada, a su altura: es llano)
    if (!struct) return have ?? D ?? this.groundRaw(tx + 0.5, ty + 0.5);
    let L = D ?? Math.ceil(Math.max(this.groundRaw(tx, ty), this.groundRaw(tx + 1, ty), this.groundRaw(tx, ty + 1), this.groundRaw(tx + 1, ty + 1)) / LV_STEP - 0.05) * LV_STEP;
    if (have !== undefined) L = Math.max(L, have);
    // (en lo cavado no se junta con lo de al lado, ni lo de al lado con lo cavado: el suelo de un hoyo se queda en su fondo)
    if (D !== null) return L;
    let join = L;
    for (const [nx, ny] of [[tx + 1, ty], [tx - 1, ty], [tx, ty + 1], [tx, ty - 1]]) {
      if (this.digH(nx, ny) !== null) continue;
      const nd = this.delta(Math.floor(nx / CHUNK), Math.floor(ny / CHUNK)), nk = `${nx},${ny}`, Ln = nd?.lvl?.[nk];
      if (Ln !== undefined && this.structAt(nd, nk) && Ln >= L && Ln - L <= LV_JOIN) join = Math.max(join, Ln);
    }
    return join;
  }
  // Apunta la altura de una casilla al poner algo; si es de construcción, sube a esa altura las de su casa que estén
  // algo más bajas (y se rehacen)
  setLevel(tx, ty, id) {
    if (inBounds(tx + 0.5, ty + 0.5)) return;
    const d = this.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK), true), k = `${tx},${ty}`;
    if (d.lvl?.[k] === undefined && this.builtAt(d, k)) return;   // (lo de antes sigue a 0)
    const L = this.levelFor(tx, ty, id);
    (d.lvl ||= {})[k] = L;
    const layer = layerOf(id);
    if (!(layer === 'floor' || layer === 'roof' || PIECES[id]) || this.digH(tx, ty) !== null) return;
    const todo = [[tx, ty]], seen = new Set([k]);
    while (todo.length) {
      const [x, y] = todo.pop();
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const nk = `${nx},${ny}`;
        if (seen.has(nk)) continue;
        seen.add(nk);
        if (this.digH(nx, ny) !== null) continue;   // (lo de dentro de un hoyo o encima de un montón se queda a su altura)
        const nd = this.delta(Math.floor(nx / CHUNK), Math.floor(ny / CHUNK)), Ln = nd?.lvl?.[nk];
        if (Ln === undefined || !this.structAt(nd, nk) || Ln >= L || L - Ln > LV_JOIN) continue;
        nd.lvl[nk] = L; this.touchAround(nx, ny); todo.push([nx, ny]);
      }
    }
  }
  // Si la casilla se ha quedado vacía, sin altura
  dropLevel(tx, ty) {
    const d = this.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK)), k = `${tx},${ty}`;
    if (d?.lvl?.[k] !== undefined && !this.builtAt(d, k)) delete d.lvl[k];
  }

  // ---------- el suelo, llano junto a lo construido de antes ----------
  // El relieve (biomes.js: reliefOf) se allana donde hay algo hecho: lo colocado, los suelos y lo labrado por los
  // jugadores, los lugares y las aldeas (las capas con pad). Lo construido se dibuja a ras de 0, así que el suelo baja a
  // 0 a su alrededor y vuelve a su altura en PAD_R casillas. padK: de 0 (llano) a 1 (el relieve entero)
  builtTiles(cx, cy) {
    const d = this.deltas.get(`${wrapIndex(cx, CHUNK)},${cy}`);
    if (!d) return NO_TILES;
    const cache = (this.builtCache ||= new Map()), k = `${wrapIndex(cx, CHUNK)},${cy}`, hit = cache.get(k);
    if (hit && hit.v === d.v) return hit.tiles;
    const tiles = [];
    for (const src of [d.placed, d.floor, d.tilled]) for (const t of Object.keys(src || {})) { const [a, b] = t.split(','); const tx = parseInt(a, 10), ty = parseInt(b, 10); if (Number.isFinite(tx) && Number.isFinite(ty) && d.lvl?.[`${tx},${ty}`] === undefined) tiles.push(tx, ty); }   // (solo lo de antes de las alturas: lo nuevo va a la suya)
    cache.set(k, { v: d.v, tiles });
    return tiles;
  }
  padDist(x, y) {
    let best = PAD_R;
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const t = this.builtTiles(cx + dx, cy + dy);
      for (let i = 0; i < t.length; i += 2) {
        const ex = Math.max(0, Math.abs(dxOf(x, t[i] + 0.5)) - 0.5), ey = Math.max(0, Math.abs(y - t[i + 1] - 0.5) - 0.5);
        if (ex < best && ey < best) best = Math.min(best, Math.hypot(ex, ey));
      }
    }
    for (const l of this.layers) if (l.pad) best = Math.min(best, l.pad(x, y));
    return best;
  }
  padK(x, y) { if (inBounds(x, y)) return 0; const d = this.padDist(x, y); return d >= PAD_R ? 1 : d <= 1.2 ? 0 : ((d - 1.2) / (PAD_R - 1.2)) ** 2 * (3 - 2 * (d - 1.2) / (PAD_R - 1.2)); }
  // ¿Hay algo que allanar cerca de este rectángulo? (para no mirar casilla a casilla donde no hay nada)
  padNear(x0, y0, x1, y1) {
    for (let cy = Math.floor((y0 - PAD_R) / CHUNK); cy <= Math.floor((y1 + PAD_R) / CHUNK); cy++) for (let cx = Math.floor((x0 - PAD_R) / CHUNK); cx <= Math.floor((x1 + PAD_R) / CHUNK); cx++) if (this.builtTiles(cx, cy).length) return true;
    return this.layers.some(l => l.padNear?.(x0 - PAD_R, y0 - PAD_R, x1 + PAD_R, y1 + PAD_R));
  }
  // Lo que cambia el allanado en un rectángulo (para rehacer el suelo y lo que va encima): las versiones de sus trozos
  padSig(x0, y0, x1, y1) {
    let s = '';
    for (let cy = Math.floor((y0 - PAD_R) / CHUNK); cy <= Math.floor((y1 + PAD_R) / CHUNK); cy++) for (let cx = Math.floor((x0 - PAD_R) / CHUNK); cx <= Math.floor((x1 + PAD_R) / CHUNK); cx++) s += (this.builtTiles(cx, cy).length || '') + ',';
    return s;
  }

  delta(cx, cy, create = false) {
    cx = wrapIndex(cx, CHUNK);
    const k = `${cx},${cy}`;
    let d = this.deltas.get(k);
    if (!d && create) { d = { removed: {}, tilled: {}, v: 0 }; this.deltas.set(k, d); }
    if (d && !d.placed) Object.assign(d, { placed: {}, floor: {}, roof: {}, chest: {} });   // partidas anteriores
    if (d && !d.floor) Object.assign(d, { floor: {}, roof: {}, chest: {} });
    return d;
  }
  touch(cx, cy) { cx = wrapIndex(cx, CHUNK); const d = this.delta(cx, cy), k = `${cx},${cy}`; d.v++; this.touches++; this.dirty.add(k); this.digNote(k); this.onTouch?.(k); }
  // Lo que ha puesto el jugador en una capa de una casilla (o undefined)
  ownAt(layer, tx, ty) { return this.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK))?.[layer]?.[`${tx},${ty}`]; }
  // Lo fijo del pueblo y de las aldeas en una casilla
  baseAt(layer, tx, ty) {
    if (this.fixedGone(tx, ty, layer)) return undefined;
    const v = this.village.built?.[`${Math.floor(tx / CHUNK)},${Math.floor(ty / CHUNK)}`]?.[layer]?.[`${tx},${ty}`];
    if (v) return v;
    for (const l of this.layers) { const b = l.baseAt?.(layer, tx, ty); if (b) return b; }
    return undefined;
  }
  // Las casas del pueblo y de las aldeas vienen puestas, pero se pueden deshacer: lo que se ha quitado se apunta en el
  // trozo (gone). La capa de objetos, con la casilla sola (las vallas del jardín ya se guardaban así); las demás, con su capa
  fixedGone(tx, ty, layer = 'placed') { return !!this.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK))?.gone?.[goneKey(layer, `${tx},${ty}`)]; }
  yardFenceAt(tx, ty) { return !this.ownAt('placed', tx, ty) && inYard(tx + 0.5, ty + 0.5, 0.6) && parsePlaced(this.baseAt('placed', tx, ty) || '')[0] === 'valla'; }
  // Lo que hay en una capa de una casilla, sea del jugador o fijo (o undefined)
  at(layer, tx, ty) { return this.ownAt(layer, tx, ty) ?? this.baseAt(layer, tx, ty); }
  pieceAt(tx, ty) { const v = this.at('placed', tx, ty); return v && PIECES[parsePlaced(v)[0]]; }

  // Contenido de un trozo con los cambios del jugador aplicados
  contentFor(cx, cy) {
    const own = wrapIndex(cx, CHUNK);
    if (own !== cx) {   // (más allá de la costura: el mismo trozo, una vuelta más allá)
      const src = this.contentFor(own, cy), k = `${cx},${cy}`, w = this.wrapped.get(k);
      if (w?.src === src) return w.data;
      const data = shifted(src, (cx - own) * CHUNK);
      this.wrapped.set(k, { src, data });
      if (this.wrapped.size > 80) this.wrapped.delete(this.wrapped.keys().next().value);
      return data;
    }
    const key = `${cx},${cy}`, d = this.delta(cx, cy), bucket = Math.floor(this.clock / 5);
    const m = this.merged.get(key);
    // (al acertar, la clave pasa al final: la caché echa lo que menos se ha usado, no lo primero que entró)
    if (m && m.v === (d?.v ?? -1) && m.bucket === bucket) { this.merged.delete(key); this.merged.set(key, m); return m.data; }
    const data = this.mergeContent(cx, cy, d, this.gen.content(cx, cy).objects, true);
    this.merged.set(key, { v: d?.v ?? -1, bucket, data });
    if (this.merged.size > 300) this.merged.delete(this.merged.keys().next().value);
    return data;
  }
  // Lo que hay en un trozo para la sombra de contacto (three/contact3d.js): lo mismo que contentFor, sin las flores y sin
  // meterlo en ninguna caché. Pide los 400 trozos de alrededor: en la de contentFor echarían a los cercanos (y world3d
  // rehace las firmas de un trozo cuando cambia su objeto), y en la del generador, a los que usa el resto del juego.
  // Tampoco usa delta(), que añade campos vacíos a los trozos de las partidas antiguas y engorda el guardado
  colliderShapes(cx, cy) {
    const own = wrapIndex(cx, CHUNK);
    if (own !== cx) return shifted(this.colliderShapes(own, cy), (cx - own) * CHUNK);
    const key = `${cx},${cy}`, d = this.deltas.get(key), m = this.merged.get(key);
    if (m && m.v === (d?.v ?? -1)) return m.data;   // (si ya lo tiene contentFor, eso: las flores no cuentan)
    return this.mergeContent(cx, cy, d, this.gen.content(cx, cy, false).objects, false);
  }
  // Lo natural del generador, menos lo quitado, con lo construido, lo fijo del pueblo y lo de las capas
  mergeContent(cx, cy, d, base, flowers) {
    const key = `${cx},${cy}`, objects = [], colliders = [], tilled = [], flats = [], floors = [], lights = [];
    for (const o of base) {
      if (o.flower && !flowers) continue;
      if (this.layers.some(l => l.hides?.(o))) continue;   // donde hay un lugar especial no crecen árboles
      if (d?.removed?.[o.key] !== undefined) continue;   // lo talado, picado o segado no vuelve: la casilla queda libre
      if (o.flower && !this.flowerHere(o, d)) continue;
      objects.push(o);
      if (o.col) colliders.push(o.col);
    }
    if (d?.tilled) for (const t of Object.keys(d.tilled)) tilled.push(t.split(',').map(Number));
    const out = { objects, colliders, flats, floors, lights, solids: [], roofMemo: new Map() };
    if (d) this.addBuilt(d, out);
    // (lo cavado y la tierra apilada: los animales y las criaturas no entran; los jugadores van aparte, por alturas: ver
    // digWalls. dig: no estorba al colocar nada)
    if (d?.dig) for (const t of Object.keys(d.dig)) { const c = t.indexOf(','), tx = +t.slice(0, c), ty = +t.slice(c + 1); colliders.push({ x0: tx, y0: ty, x1: tx + 1, y1: ty + 1, dig: true }); }
    if (d?.boats) for (const [id, b] of Object.entries(d.boats)) if (Array.isArray(b)) objects.push({ boat: true, id, x: b[0], y: b[1], yaw: b[2] || 0, key: `boat:${id}:${b[2] || 0}` });   // (las barcas amarradas)
    const vb = this.village.built?.[key];
    if (vb) this.addBuilt(vb, out, true);
    for (const layer of this.layers) layer.add(cx, cy, d, out);
    return { objects, colliders, tilled, flats, floors, lights, solids: out.solids };
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
  rugAt(tx, ty) { return !!this.rugAnchor(tx, ty); }
  // La casilla en la que está guardada la alfombra que pisa esta casilla (o null)
  rugAnchor(tx, ty) {
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const v = this.at('rug', tx + dx, ty + dy);
      if (!v) continue;
      const r = rugRect(tx + dx, ty + dy, parsePlaced(v)[1]);
      if (tx >= r.x0 && tx < r.x0 + r.w && ty >= r.y0 && ty < r.y0 + r.h) return [tx + dx, ty + dy];
    }
    return null;
  }
  // ¿Hay detrás (del lado contrario a su frente) un muro liso donde arrimar el hogar o colgar un cuadro? (en las
  // ventanas y en el muro que ya tiene cuadro, no)
  wallBehind(tx, ty, rot) {
    const [fx, fy] = front(rot), v = this.at('placed', tx - fx, ty - fy);
    return !!v && PIECES[parsePlaced(v)[0]]?.kind === 'wall' && !/^(ventana|muro_cuadro)/.test(v);
  }
  // La silla que mira a una mesa (o a una casilla de una mesa grande) se mete debajo
  tuckShift(id, tx, ty, rot) {
    if (id !== 'silla') return null;
    const [fx, fy] = front(rot), x = tx + fx, y = ty + fy, v = this.at('placed', x, y), a = v ? null : this.anchorOf(x, y);
    const table = v ? parsePlaced(v)[0] : a && parsePlaced(this.at('placed', ...a))[0];
    return TABLES.has(table) ? [fx * TUCK, fy * TUCK] : null;
  }
  // Cuánto se corre lo que se pone: bajo la mesa o arrimado al muro de detrás
  shiftFor(id, tx, ty, rot) { return this.tuckShift(id, tx, ty, rot) || this.wallShift(id, tx, ty, rot); }
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
      const solid = (x, y) => { const q = this.pieceAt(x, y); return q && q.kind !== 'fence' && q.kind !== 'gate'; };
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
  // src: { placed, floor, roof } por casilla. fixed: es del pueblo o de una aldea (viene puesto: lo quitado se apunta en gone).
  addBuilt(src, out, fixed = false) {
    const { objects, colliders, flats, floors, lights } = out;
    const base = (t, layer, id) => {
      const [tx, ty] = t.split(',').map(Number);
      const o = { x: tx + 0.5, y: ty + 0.5, key: `${layer}:${t}`, placed: id, layer, tile: [tx, ty] };
      if (fixed) { o.fixed = true; if (layer === 'placed' && id === 'valla' && inYard(tx + 0.5, ty + 0.5, 0.6)) o.yard = true; }   // (yard: la valla de tu jardín, que sí se recoge)
      return o;
    };
    // Lo fijo no pisa lo que haya puesto el jugador en la misma casilla y capa
    const taken = (layer, t) => { if (!fixed) return false; const [tx, ty] = t.split(',').map(Number); return this.ownAt(layer, tx, ty) || this.fixedGone(tx, ty, layer); };
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
        o.wall = true; o.window = id.startsWith('ventana') && !((mask & 3) && (mask & 12));   // (en una esquina o una T no hay hueco: es un muro)
        for (const [x0, x1, y0, y1] of wallRuns(mask)) colliders.push({ x0: o.x + x0, y0: o.y + y0, x1: o.x + x1, y1: o.y + y1, wall: true });
        if (o.window && !this.doorClosed(tx, ty)) lights.push({ x: o.x, y: o.y, z: WINDOW_Z, r: 34, window: true });   // (cerrada, no sale luz)
      } else if (piece?.kind === 'door') {
        const solid = (x, y) => { const p = this.pieceAt(x, y); return p && p.kind !== 'fence' && p.kind !== 'gate'; };
        const alongX = solid(tx - 1, ty) || solid(tx + 1, ty) || !(solid(tx, ty - 1) || solid(tx, ty + 1));
        const closed = this.doorClosed(tx, ty);
        o.wall = true; o.door = alongX ? 'x' : 'y';
        // (shut: la hoja cerrada. La sombra de contacto la ve siempre como las dos jambas: ver world/contact.js)
        if (closed) colliders.push(alongX ? { x0: tx, y0: ty + 0.38, x1: tx + 1, y1: ty + 0.62, wall: true, shut: true } : { x0: tx + 0.38, y0: ty, x1: tx + 0.62, y1: ty + 1, wall: true, shut: true });
        else if (alongX) colliders.push({ x0: tx, y0: ty + 0.38, x1: tx + 0.14, y1: ty + 0.62, wall: true }, { x0: tx + 0.86, y0: ty + 0.38, x1: tx + 1, y1: ty + 0.62, wall: true });
        else colliders.push({ x0: tx + 0.38, y0: ty, x1: tx + 0.62, y1: ty + 0.14, wall: true }, { x0: tx + 0.38, y0: ty + 0.86, x1: tx + 0.62, y1: ty + 1, wall: true });
      } else if (piece?.kind === 'gate') {
        // Puerta de valla: va en la línea de las vallas de los lados. Cerrada choca como una valla (a caballo se salta);
        // abierta solo chocan sus postes
        const f = (x, y) => ['fence', 'gate', 'wall'].includes(this.pieceAt(x, y)?.kind);
        const alongX = f(tx - 1, ty) || f(tx + 1, ty) || !(f(tx, ty - 1) || f(tx, ty + 1));
        o.door = alongX ? 'x' : 'y'; o.gate = true;
        for (const s of [-0.5, 0.5]) colliders.push(alongX ? { x: o.x + s, y: o.y, r: 0.12, low: true } : { x: o.x, y: o.y + s, r: 0.12, low: true });
        if (this.doorClosed(tx, ty)) colliders.push(alongX ? { x0: tx, y0: o.y - 0.08, x1: tx + 1, y1: o.y + 0.08, low: true, shut: true } : { x0: o.x - 0.08, y0: ty, x1: o.x + 0.08, y1: ty + 1, low: true, shut: true });
      } else if (piece?.kind === 'fence') {
        o.fence = true;
        const f = (x, y) => ['fence', 'gate', 'wall'].includes(this.pieceAt(x, y)?.kind);
        const mask = (f(tx + 1, ty) ? 1 : 0) | (f(tx - 1, ty) ? 2 : 0) | (f(tx, ty + 1) ? 4 : 0) | (f(tx, ty - 1) ? 8 : 0);
        o.mask = mask;
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
        colliders.push({ x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by), piece: true });
      } else if (src.pos?.[o.key] || BIG_HOUSE.has(id) || id === 'pozo') {   // (las casas grandes, aunque se pusieran por casillas antes de crecer, ocupan lo suyo; el pozo puesto con /setblock, sin sitio, va en el centro)
        o.off = this.lightOff(tx, ty);
        if (BIG_HOUSE.has(id) && src.door?.[`${tx},${ty}`] === 0) o.model = `${id}:shut`;
        if (id === 'encimera' && !fixed) o.model = this.counterModel(tx, ty);
        if (id === 'pozo') o.model = wellModel(src.lvl?.[t], src.dig?.[t]);   // (hasta el fondo del hoyo)
        if (freeObject(o, id, rot, src.pos?.[o.key] || [tx + 0.5, ty + 0.5, (rot % 4) * Math.PI / 2], out)) { flats.push(o); continue; }
      } else {
        o.off = this.lightOff(tx, ty);
        const tuck = this.tuckShift(id, tx, ty, rot);
        if (tuck) o.tuck = true;
        if (id === 'encimera' && !fixed) o.model = this.counterModel(tx, ty);
        if (itemObject(o, id, rot, colliders, lights, tuck || this.wallShift(id, tx, ty, rot))) { flats.push(o); continue; }
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
      const [id, k] = parsePlaced(raw), o = base(t, 'rug', id), r = rugRect(...o.tile, k), fp = src.pos?.[o.key];
      Object.assign(o, { x: r.x0 + r.w / 2, y: r.y0 + r.h / 2, rug: r, model: `rug:${id}:${r.w}x${r.h}`, fx: [r.x0, r.x0 + r.w], fy: [r.y0, r.y0 + r.h] });
      if (fp) { Object.assign(o, { x: fp[0], y: fp[1], yaw: fp[2], free: true, fx: null, fy: null }); o.obb = obb(fp[0], fp[1], r.w / 2 - 0.06, r.h / 2 - 0.06, fp[2]); }   // (libre: donde se puso, girada)
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
    const gable = roofShape(tiles, has);   // (las rectangulares van a dos aguas: ver roof.js)
    for (const [x, y] of tiles) {
      const D = gable.gable ? gable.H : (px, py) => roofDistance(px, py, edges);
      const h = { nw: D(x, y), ne: D(x + 1, y), se: D(x + 1, y + 1), sw: D(x, y + 1), c: D(x + 0.5, y + 0.5) };
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

  // Las flores silvestres salen según la estación (gen.js, flowerShows) y no donde se ha construido, labrado o sembrado
  flowerHere(o, d) {
    if (!flowerShows(o, this.gen.season)) return false;
    const tx = Math.floor(o.x), ty = Math.floor(o.y), k = `${tx},${ty}`;
    if (d && (d.tilled[k] !== undefined || d.crops?.[k] || d.dig?.[k] !== undefined)) return false;
    return !this.at('floor', tx, ty) && !this.at('placed', tx, ty);
  }

  // ---------- La hierba de las casillas (gen.grassAt) ----------
  // ¿Hay hierba en la casilla? La que da el mundo, si ahí no hay nada construido, labrado ni sembrado y no se ha segado
  // hace menos de GRASS_REGROW días (today: el día del juego)
  mownAt(tx, ty, today) { const v = this.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK))?.mown?.[`${tx},${ty}`]; return v !== undefined && today - v < GRASS_REGROW; }
  grassAt(tx, ty, today) {
    const x = tx + 0.5, y = ty + 0.5;
    if (!inPlanet(x, y) || !this.gen.grassAt(tx, ty) || !isGrass(x, y)) return false;
    if (this.at('floor', tx, ty) || this.at('placed', tx, ty)) return false;
    const d = this.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK)), k = `${tx},${ty}`;
    if (d && (d.tilled[k] !== undefined || d.crops?.[k])) return false;
    if (this.mownAt(tx, ty, today) || this.digH(tx, ty) !== null || this.layers.some(l => l.blocks?.(tx, ty))) return false;
    // (ni en las cuestas donde el suelo es roca, ni en las que no se pintan: la misma cuenta que las matas, nature3d.js)
    const g = this.gen, sx = groundSmooth(g, x + 0.5, y, this) - groundSmooth(g, x - 0.5, y, this), sz = groundSmooth(g, x, y + 0.5, this) - groundSmooth(g, x, y - 0.5, this);
    return ihash(tx, ty, g.seed + 24) <= grassKeep(Math.hypot(sx, sz));
  }
  // ¿Pueden pastar aquí los animales? Toda la hierba (la del pueblo también: los caminos, la plaza, el estanque y las casas
  // ya no la tienen) menos la de tu jardín, salvo para los que viven en él (yard: su casa está en el jardín). Lo que se
  // comen queda como segado (mow), para todos
  pasture(tx, ty, today, yard = false) { return (yard || !inYard(tx + 0.5, ty + 0.5, 0.5)) && this.grassAt(tx, ty, today); }
  // Segarla (con la guadaña: ver gather.js) o comérsela un animal: queda segada hasta que vuelve a salir (y lo segado hace
  // mucho se olvida)
  mow(tx, ty, today) {
    const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK), m = (this.delta(cx, cy, true).mown ||= {});
    for (const [k, v] of Object.entries(m)) if (today - v >= GRASS_REGROW) delete m[k];
    m[`${tx},${ty}`] = today;
    this.touch(cx, cy);
  }

  // ¿Se puede labrar esta casilla? Tierra con hierba, sin nada encima y fuera del camino del pueblo.
  canTill(tx, ty) {
    const x = tx + 0.5, y = ty + 0.5, b = this.gen.biomeAt(x, y);
    if (!inPlanet(x, y)) return false;
    if (![B.MEADOW, B.FOREST, B.PINES, B.SWAMP].includes(b)) return false;
    if (inBounds(x, y) && !isGrass(x, y)) return false;
    const d = this.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK));
    if (d && d.tilled[`${tx},${ty}`] !== undefined) return false;
    if (this.at('placed', tx, ty) || this.at('floor', tx, ty)) return false;
    return !this.collidersNear(x, y).some(c => clashes(c, x, y, 0.45));
  }
  till(tx, ty) {
    const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK);
    this.setLevel(tx, ty, 'tierra');   // (lo labrado, a la altura del suelo)
    this.delta(cx, cy, true).tilled[`${tx},${ty}`] = this.clock;
    this.touch(cx, cy);
  }

  // ¿Se puede colocar algo en esta casilla? Tierra firme, libre y sin pisar el camino del pueblo.
  // Cada capa tiene sus reglas: el suelo va debajo de todo y el tejado necesita un muro o un suelo debajo.
  // Dentro de tu casa se puede construir aunque sea terreno del pueblo.
  canPlace(tx, ty, id, player, rot = 0) {
    if (extraTiles(id, tx, ty, rot).some(t => !this.canPlace(...t, 'silla', player))) return false;   // las otras casillas también tienen que caber
    const x = tx + 0.5, y = ty + 0.5, layer = layerOf(id), k = `${tx},${ty}`;
    if (!inPlanet(x, y)) return false;   // (en la costura del planeta, desde el otro lado, o más allá de un polo)
    if (layer === 'rug') return this.rugFits(rugRect(tx, ty, rot));
    if (this.water(x, y)) return false;
    // (en el pueblo, en la hierba y en las casas; las vallas y sus puertas, además, en todo tu jardín, también en el hueco del camino; en modo admin, donde sea)
    if (inBounds(x, y) && !isGrass(x, y) && !inOwnHouse(x, y) && !inVillageHouse(x, y) && !this.buildAnywhere && !(['fence', 'gate'].includes(PIECES[id]?.kind) && inYard(x, y, 0.6))) return false;
    const d = this.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK));
    if (this.at(layer, tx, ty) || d?.tilled[k] !== undefined) return false;
    if (layer === 'placed' && this.reserved?.has(k) && id !== 'silla' && id !== 'taburete') return false;   // (el sitio de alguien de la taberna, aunque ahora no esté)
    if (layer === 'floor') return true;
    if (layer === 'roof') return !!(this.at('floor', tx, ty) || ['wall', 'door'].includes(this.pieceAt(tx, ty)?.kind));
    if (this.layers.some(l => l.blocks?.(tx, ty))) return false;
    if ((id === 'candelabro' || id === 'chimenea' || layer === 'hang') && !this.roofAt(tx, ty)) return false;   // (dentro de casa: el candelabro se cuelga del techo)
    if ((id === 'chimenea' || layer === 'hang') && !this.wallBehind(tx, ty, rot)) return false;
    if (layer === 'hang' || ITEMS[id]?.place === 'flat') return true;
    if (player && Math.abs(player.x - x) < 0.8 && Math.abs(player.y - y) < 0.8) return false;   // no encerrarse
    return !this.collidersNear(x, y).some(c => clashes(c, x, y, 0.4));
  }
  place(tx, ty, id, rot = 0) {
    const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK), layer = layerOf(id), d = this.delta(cx, cy, true);
    this.setLevel(tx, ty, id);   // (antes de ponerlo: lo de antes en la casilla, sin altura, se distingue así)
    (d[layer] ||= {})[`${tx},${ty}`] = rot ? `${id}@${rot}` : id;
    if (PIECES[id]?.kind === 'gate') (d.closed ||= {})[`${tx},${ty}`] = true;   // (la puerta de valla empieza cerrada: el cercado ya guarda)
    if (CHESTS[id]) d.chest[`${tx},${ty}`] = Array(CHESTS[id][0]).fill(null);   // (la mochila en el suelo es como un cofre; el armario, para la ropa)
    this.touchAround(tx, ty);
  }
  // Quita algo de una casilla: lo que puso alguien o, con o.fixed, lo que venía puesto (se apunta que ya no está)
  unplace(o) {
    const [tx, ty] = o.tile, layer = o.layer || 'placed', k = `${tx},${ty}`;
    if (o.fixed) {
      if (this.ownAt(layer, tx, ty) || !this.baseAt(layer, tx, ty)) return false;
      const d = this.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK), true);
      (d.gone ||= {})[goneKey(layer, k)] = true;
      if (layer === 'placed') for (const l of ['chest', 'closed', 'off']) if (d[l]) delete d[l][k];
      this.touchAround(tx, ty);
      return true;
    }
    if (!this.ownAt(layer, tx, ty)) return false;
    const d = this.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK));
    delete d[layer][k];
    if (d.pos) delete d.pos[`${layer}:${k}`];
    if (layer === 'placed' && CHESTS[o.placed]) delete d.chest[k];
    if (layer === 'placed' && d.closed) delete d.closed[k];
    if (layer === 'placed' && d.off) delete d.off[k];
    this.dropLevel(tx, ty);
    this.touchAround(tx, ty);
    return true;
  }
  // Lo que hacen /setblock y /fill: poner una pieza en su capa (sin mirar si cabe, como en Minecraft) o, con 'air',
  // quitar todo lo que haya en la casilla, también lo que venía puesto
  setTile(tx, ty, id) {
    const d = this.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK), true), k = `${tx},${ty}`;
    if (id === 'air') {
      for (const layer of ['floor', 'placed', 'roof', 'hang', 'rug']) { if (d[layer]) delete d[layer][k]; if (d.pos) delete d.pos[`${layer}:${k}`]; }
      for (const l of ['chest', 'closed', 'off', 'machine', 'tilled']) if (d[l]) delete d[l][k];
      for (const layer of ['floor', 'placed', 'roof', 'hang', 'rug']) if (this.baseAt(layer, tx, ty)) (d.gone ||= {})[goneKey(layer, k)] = true;
      this.dropLevel(tx, ty);
    } else {
      const layer = layerOf(id);
      this.setLevel(tx, ty, id);
      if (this.baseAt(layer, tx, ty)) (d.gone ||= {})[goneKey(layer, k)] = true;   // (lo que venía puesto ya no está: al quitar esto no vuelve)
      (d[layer] ||= {})[k] = id;
    }
    this.touchAround(tx, ty);
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
  // Luces apagadas (lámparas, antorchas, velas, hogares y candelabros): se guarda en el trozo, por su casilla ("x,y"),
  // como las puertas
  lightOff(tx, ty) { return !!this.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK))?.off?.[`${tx},${ty}`]; }
  toggleLight(tx, ty) {
    const d = this.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK), true), k = `${tx},${ty}`;
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
      if (dist < bd && ['door', 'gate'].includes(this.pieceAt(tx, ty)?.kind)) { best = [tx, ty]; bd = dist; }
    }
    return best;
  }
  // El modelo de la encimera de una casilla, unida a lo que tenga al lado ('encimera:izquierda:derecha'), o null
  counterModel(tx, ty) {
    const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK), me = `placed:${tx},${ty}`, list = [];
    let self = null;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const d = this.delta(cx + dx, cy + dy);
      for (const [t, raw] of Object.entries(d?.placed || {})) {
        const [id, rot] = parsePlaced(raw), key = `placed:${t}`, p = d.pos?.[key];
        if (!JOINS.has(id) || p?.[3]) continue;   // (lo puesto agachado va suelto)
        const [x, y] = t.split(',').map(Number), [sx, sy] = p ? [0, 0] : this.wallShift(id, x, y, rot);
        const c = p ? { key, id, x: p[0], y: p[1], a: p[2] } : { key, id, x: x + 0.5 + sx, y: y + 0.5 + sy, a: (rot % 4) * Math.PI / 2 };
        list.push(c);
        if (key === me) self = c;
      }
    }
    if (!self) return null;
    const [l, r] = counterJoins(list.filter(c => Math.hypot(c.x - self.x, c.y - self.y) < 4)).get(self);
    return l || r ? `encimera:${l}:${r}` : null;
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
      const v = this.at('placed', tx + dx, ty + dy), [id, rot] = v ? parsePlaced(v) : [];
      if (LONG[id] && extraTiles(id, tx + dx, ty + dy, rot).some(([x, y]) => x === tx && y === ty)) return [tx + dx, ty + dy];
    }
    return null;
  }
  chestAt(tx, ty) { const c = this.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK))?.chest?.[`${tx},${ty}`]; if (c && !c.modern) { for (const [id, n] of modernSlots(c)) c.push({ id, n }); Object.defineProperty(c, 'modern', { value: true, enumerable: false }); } return c; }   // (lo que ya no es un objeto, por sus materiales)
  chestTouched(tx, ty) { const k = `${Math.floor(tx / CHUNK)},${Math.floor(ty / CHUNK)}`; this.dirty.add(k); this.onTouch?.(k); }
  // ¿Está esta casilla bajo un tejado? (para ocultar el tejado cuando el jugador entra en casa)
  roofAt(tx, ty) { return !!this.at('roof', tx, ty); }
  // Lo colocado cerca de un punto (para usar estaciones y recoger muebles), lo más cercano primero
  placedNear(x, y, r) {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK), out = [];
    const dist = o => this.placedDist(o, x, y);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const c = this.contentFor(cx + dx, cy + dy);
      for (const o of c.objects) if (o.placed && !PIECES[o.placed] && dist(o) < r) out.push(o);
      for (const o of c.flats) if (dist(o) < r) out.push(o);
    }
    return out.sort((a, b) => dist(a) - dist(b));
  }
  // Distancia a lo colocado; a lo de varias casillas (la cama), a la más cercana; a lo libre, a su borde (más lo que
  // hay del borde al centro de algo pequeño)
  placedDist(o, x, y) {
    if (o.obb) return distTo(o.obb, x, y) + 0.4;
    if (o.fx) return Math.hypot(x - clamp(x, o.fx[0] + 0.5, o.fx[1] - 0.5), y - clamp(y, o.fy[0] + 0.5, o.fy[1] - 0.5));
    return Math.hypot(o.x - x, o.y - y);
  }

  // ---------- colocar libre ----------
  // Con qué puede chocar lo que se coloca cerca de (x, y): cajas con su altura. wall: un muro o una puerta (también
  // abierta: no se tapa). Las alfombras, solo con muros, vallas, el hogar y otras alfombras
  obstaclesNear(x, y, rug) {
    const out = [], cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK), near = b => Math.abs(b.x - x) < 5 && Math.abs(b.y - y) < 5;
    for (const c of this.collidersNear(x, y)) {
      // (lo cavado no es un obstáculo: es suelo a su altura, y lo que se pone ahí va a ella: levelFor)
      if (c.free || c.dig || (rug && !c.wall && !c.low && !c.piece)) continue;
      const b = c.r !== undefined ? aabb(c.x - c.r * 0.85, c.y - c.r * 0.85, c.x + c.r * 0.85, c.y + c.r * 0.85) : c.rx ? aabb(c.x - c.rx * 0.8, c.y - c.ry * 0.8, c.x + c.rx * 0.8, c.y + c.ry * 0.8) : aabb(c.x0, c.y0, c.x1, c.y1);
      if (near(b)) out.push({ ...b, y0: 0, y1: c.low ? 1 : 3, wall: !!c.wall });
    }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const c = this.contentFor(cx + dx, cy + dy);
      for (const o of c.objects) if (o.door && !o.gate) { const [tx, ty] = o.tile; out.push({ ...(o.door === 'x' ? aabb(tx, ty + 0.38, tx + 1, ty + 0.62) : aabb(tx + 0.38, ty, tx + 0.62, ty + 1)), y0: 0, y1: 3, wall: true }); }
      if (rug) { for (const o of c.flats) if (o.layer === 'rug') out.push({ ...(o.obb || aabb(o.fx[0], o.fy[0], o.fx[1], o.fy[1])), y0: 0, y1: 0.1 }); }
      else for (const s of c.solids) if (near(s)) out.push(s);
    }
    return out;
  }
  // Cómo quedaría lo que se coloca libre con el centro de lo que ocupa en (px, py) y girado a (k: su tamaño, la
  // alfombra y la mesa grande): si roza un muro (o le falta poco, estando recto) se arrima; si apenas roza un mueble,
  // se separa; si lo corta, no cabe (la silla sí entra bajo la mesa, mientras el respaldo no toque el tablero). Devuelve dónde (ox, oy:
  // el origen del modelo), si cabe (ok) y, si no, por qué (why); anchor: la casilla donde se apunta
  fitFree(id, px, py, a, k = 0, player = null) {
    if (id === 'pozo') return this.fitWell(px, py, a, player);
    const def = ITEMS[id], rug = def.place === 'rug', flat = def.place === 'flat';
    let local, model = id, anchor = null;
    if (rug) { const [w, h] = RUG_SIZES[k % RUG_SIZES.length]; local = [[-w / 2 + 0.06, 0, -h / 2 + 0.06, w / 2 - 0.06, 0.05, h / 2 - 0.06]]; model = `rug:${id}:${w}x${h}`; }
    else { if (id === 'mesa_grande') model = `mesa_grande:${TABLE_SIZES[k % TABLE_SIZES.length].join('x')}`; local = solidsOf(model); }
    const H = hull(local), lx = (H[0] + H[3]) / 2, lz = (H[2] + H[5]) / 2, [ux, uy] = sideOf(a), [vx, vy] = dirOf(a);
    let ox = px - (ux * lx + vx * lz), oy = py - (uy * lx + vy * lz);
    const obstacles = this.obstaclesNear(px, py, rug), whole = () => placeBoxes([H], ox, oy, a)[0];
    const res = (ok, why) => { const w = whole(); return { ok, why, ox, oy, a, k, model, cx: w.x, cy: w.y, box: w, anchor }; };
    if (!inPlanet(px - 1, py) || !inPlanet(px + 1, py)) return res(false, 'Aquí no: es la costura del planeta');
    // Arrimar a los muros (y a las esquinas): solo se pega si está casi recto (a menos de 8°)
    const q = ((a / (Math.PI / 2)) % 1 + 1) % 1, aligned = q < 0.09 || q > 0.91, walls = joinedWalls(obstacles.filter(w => w.wall));
    for (let pass = 0; pass < 3; pass++) for (const w of walls) {
      const m = aligned ? SNAP : 0, b = whole(), hit = sat({ ...b, hx: b.hx + m, hy: b.hy + m }, w);
      if (!hit || hit.depth - m > MAX_PUSH) continue;
      ox += hit.nx * (hit.depth - m); oy += hit.ny * (hit.depth - m);
    }
    // Separarlo de lo que apenas roce a su misma altura
    const cuts = (s, o) => o.y1 > s.y0 + 0.01 && o.y0 < s.y1 - 0.01 && sat(s, o);
    if (!flat) for (let pass = 0; pass < 4; pass++) {
      let worst = null;
      for (const s of placeBoxes(local, ox, oy, a)) for (const o of obstacles) { if (o.wall) continue; const hit = cuts(s, o); if (hit && (!worst || hit.depth > worst.depth)) worst = hit; }
      if (!worst || worst.depth > NUDGE) break;
      ox += worst.nx * (worst.depth + 0.004); oy += worst.ny * (worst.depth + 0.004);
    }
    // ¿Cabe?
    for (const s of placeBoxes(local, ox, oy, a)) for (const o of obstacles) { const hit = cuts(s, o); if (hit && hit.depth > 0.012) return res(false, o.wall ? 'Choca con la pared' : 'Choca con otra cosa'); }
    const w = whole(), b = bounds(w);
    if (!rug && !flat && player && hitsCircle(w, player.x, player.y, 0.2)) return res(false, 'Estás tú en medio');
    if (!rug && !flat && this.reserved) for (const t of this.reserved) { const [rx, ry] = t.split(',').map(Number); if (hitsCircle(w, rx + 0.5, ry + 0.5, 0.2) && id !== 'silla' && id !== 'taburete') return res(false, 'Ese es el sitio de alguien'); }
    // La noria, al revés que lo demás: la rueda (su eje, el origen del modelo) en el agua de un río, con la orilla cerca
    if (id === 'noria') {
      if (!this.riverAt(ox, oy)) return res(false, 'La noria va en un río');
      if (![...Array(8)].some((_, i) => !this.water(ox + Math.cos(i * Math.PI / 4) * 2.4, oy + Math.sin(i * Math.PI / 4) * 2.4))) return res(false, 'Ponla cerca de la orilla');
    }
    for (const [x, y] of [[w.x, w.y], [b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]]) {
      if (this.water(x, y) && id !== 'noria') return res(false, 'Ahí no se puede poner');
      if (inBounds(x, y) && !isGrass(x, y) && !inOwnHouse(x, y) && !inVillageHouse(x, y) && !this.buildAnywhere) return res(false, 'En el camino y en la plaza no se puede');
    }
    if (id === 'candelabro' && !this.roofAt(Math.floor(w.x), Math.floor(w.y))) return res(false, 'Se cuelga del techo: solo dentro de casa');
    const t0 = [Math.floor(w.x), Math.floor(w.y)], tilled = (x, y) => this.delta(Math.floor(x / CHUNK), Math.floor(y / CHUNK))?.tilled[`${x},${y}`] !== undefined;
    if (tilled(...t0)) return res(false, 'Ahí no: es tierra labrada');
    // La casilla donde se apunta: la suya o una de al lado libre (cada casilla guarda una cosa por capa)
    const layer = rug ? 'rug' : 'placed', tiles = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]].map(([dx, dy]) => [t0[0] + dx, t0[1] + dy]);
    tiles.sort((p, r) => Math.hypot(p[0] + 0.5 - w.x, p[1] + 0.5 - w.y) - Math.hypot(r[0] + 0.5 - w.x, r[1] + 0.5 - w.y));
    anchor = tiles.find(([x, y]) => !this.at(layer, x, y) && (rug || !this.pieceAt(x, y)) && !tilled(x, y)) || null;
    return anchor ? res(true, null) : res(false, 'Ahí no cabe');
  }
  // El pozo no va libre: ocupa justo la casilla apuntada, que tiene que estar cavada con la pala WELL_DOWN bloques o más
  // (el hoyo es el pozo: su forro de piedra baja hasta el fondo y su losa lo tapa por arriba). Se gira de cuarto en
  // cuarto (el tejadillo y la manivela), no se arrima a nada y no puede cortar lo de al lado. Lo mismo que fitFree
  fitWell(px, py, a, player) {
    const deepAt = (i, j) => this.digH(i, j) !== null && this.digDepth(i, j) >= WELL_DOWN - 1e-6, Q = Math.PI / 2;
    let tx = Math.floor(px), ty = Math.floor(py);
    // (el ratón sobre la pared o el borde de un hoyo hondo y estrecho cae justo en la raya: vale el hoyo de al lado)
    if (!deepAt(tx, ty)) {
      const fx = px - tx, fy = py - ty;
      for (const [e, dx, dy] of [[fx < 0.15, -1, 0], [fx > 0.85, 1, 0], [fy < 0.15, 0, -1], [fy > 0.85, 0, 1]]) if (e && deepAt(tx + dx, ty + dy)) { tx += dx; ty += dy; break; }
    }
    const x = tx + 0.5, y = ty + 0.5, deep = deepAt(tx, ty), k = `${tx},${ty}`;
    a = ((Math.round(a / Q) % 4) + 4) % 4 * Q;
    const model = deep ? wellModel(this.levelFor(tx, ty, 'pozo'), this.digH(tx, ty)) : 'pozo';
    const local = solidsOf(model), box = placeBoxes([hull(local)], x, y, a)[0];
    const res = (ok, why) => ({ ok, why, ox: x, oy: y, a, k: 0, model, cx: box.x, cy: box.y, box, anchor: ok ? [tx, ty] : null });
    if (!inPlanet(x - 1, y) || !inPlanet(x + 1, y)) return res(false, 'Aquí no: es la costura del planeta');
    if (!deep) return res(false, `Hace falta un hoyo de ${WELL_DOWN} bloques cavado con la pala`);
    if (this.at('placed', tx, ty) || this.at('floor', tx, ty) || this.at('roof', tx, ty)) return res(false, 'Ahí no cabe');
    const d = this.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK));
    if (d?.lvl?.[k] !== undefined) return res(false, 'Ahí no cabe');
    const cuts = (s, o) => o.y1 > s.y0 + 0.01 && o.y0 < s.y1 - 0.01 && sat(s, o), obstacles = this.obstaclesNear(x, y, false);
    for (const s of placeBoxes(local, x, y, a)) for (const o of obstacles) { const hit = cuts(s, o); if (hit && hit.depth > 0.012) return res(false, o.wall ? 'Choca con la pared' : 'Choca con otra cosa'); }
    if (player && hitsCircle(box, player.x, player.y, 0.2)) return res(false, 'Estás tú en medio');
    return res(true, null);
  }
  // ¿Hay un pozo en la casilla de (x, y)? (para llenar la regadera: farm.js)
  wellAt(x, y) { const v = this.at('placed', Math.floor(x), Math.floor(y)); return !!v && parsePlaced(v)[0] === 'pozo'; }
  // ¿Está (x, y) en la boca de un pozo, por donde se cae al agua? (las flechas: archery.js, ground; el hueco de sus cajas en
  // three/models.js, pozo)
  wellMouth(x, y) { const fx = x - Math.floor(x) - 0.5, fy = y - Math.floor(y) - 0.5; return Math.abs(fx) < 0.34 && Math.abs(fy) < 0.34 && this.wellAt(x, y); }
  // Ponerlo donde ha dicho fitFree (en su casilla, con su sitio y su giro de verdad)
  // loose: puesto agachado (no se une a lo de al lado)
  placeFree(id, f, loose = false) {
    const [tx, ty] = f.anchor, layer = layerOf(id), d = this.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK), true), r3 = v => Math.round(v * 1000) / 1000;
    const a = ((f.a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2), sized = layer === 'rug' || id === 'mesa_grande';
    (d.pos ||= {})[`${layer}:${tx},${ty}`] = loose ? [r3(f.ox), r3(f.oy), r3(a), 1] : [r3(f.ox), r3(f.oy), r3(a)];
    this.place(tx, ty, id, sized ? f.k : Math.round(a / (Math.PI / 2)) % 4);
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
  // recoger nada a través de ellos). low: tampoco una valla ni una puerta de valla cerrada (andando, para los animales;
  // sus postes, que van en círculo, no cortan: la valla de al lado sí. La que tiene uno debajo, no cuenta)
  reaches(x0, y0, x1, y1, low = false) {
    for (const c of this.collidersNear((x0 + x1) / 2, (y0 + y1) / 2)) {
      if (!c.wall && !(low && c.low && c.x0 !== undefined && !(x0 > c.x0 && x0 < c.x1 && y0 > c.y0 && y0 < c.y1))) continue;
      if (crosses(x0, y0, x1, y1, c)) return false;
    }
    return true;
  }
  // Rehacer el pueblo (se termina un proyecto)
  rebuildVillage() {
    this.village = buildVillage();
    this.gen.cache.clear();   // (los arbustos del jardín, que pone el mundo, dependen de dónde va tu casa)
    this.merged.clear();
  }
  // Agua: 'deep' (el mar y los lagos) o 'shallow' (ríos, charcas y la costa); lo hondo de verdad, en waterDepth
  water(x, y) { return inBounds(x, y) ? null : BIOMES[this.gen.biomeAt(x, y)].water || null; }
  // ¿Es agua de río (poco profunda y lejos del mar)? (la orilla de un lago o una charca también vale)
  riverAt(x, y) {
    if (inBounds(x, y) || this.gen.biomeAt(x, y) !== B.SHALLOW) return false;
    for (let r = 2; r <= 8; r += 3) for (let a = 0; a < 6; a++) if (this.gen.biomeAt(x + Math.cos(a) * r, y + Math.sin(a) * r) === B.OCEAN) return false;
    return true;
  }
  // Lo hondo que es el agua en (x, y), en metros: del agua (WATER_Y) al fondo, el de la malla del suelo (0 en tierra y
  // sobre lo construido). Con lo que cubre se anda, se nada (ver entities.js) o no se pasa
  waterDepth(x, y) {
    if (!this.water(x, y) || this.levelAt(x, y) !== null) return 0;
    const x0 = Math.floor(x), y0 = Math.floor(y), fu = x - x0, fv = y - y0, b = this.bedH(x0 + 1, y0), c = this.bedH(x0, y0 + 1);
    const h = fu + fv <= 1 ? (a => a + (b - a) * fu + (c - a) * fv)(this.bedH(x0, y0)) : (d => d + (c - d) * (1 - fu) + (b - d) * (1 - fv))(this.bedH(x0 + 1, y0 + 1));
    return Math.max(0, WATER_Y - h);
  }
  // El fondo del agua en una esquina (como la malla del suelo: gen.groundAt, que bajo el agua es negativo; groundRaw lo
  // deja en 0), guardado: no cambia con lo construido
  bedH(x, y) {
    const k = `${x},${y}`, m = (this.beds ||= new Map());
    let h = m.get(k);
    if (h === undefined) { h = Math.min(0, this.gen.groundAt(x, y)); if (m.size > 4000) m.clear(); m.set(k, h); }
    return h;
  }
  // Por donde no pasan los animales ni los monstruos (no nadan): el agua que ya les cubre las patas, WADE_MAX (lo que
  // tenían los ríos antes de que se pudiera nadar: hasta ahí se les dibuja bien, ver engine.js groundY). Los jugadores sí
  // nadan (ver entities.js)
  blocked(x, y) { return this.waterDepth(x, y) >= WADE_MAX; }
}
