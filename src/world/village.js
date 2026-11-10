// Pueblo Brotes: la zona hecha a mano donde empieza la partida. Es igual en todos los mundos.
// Todo va en la cuadrícula: las casas y la taberna están hechas de piezas de construcción (muros, ventanas, puerta,
// tejado, hogar), la valla del jardín son piezas de valla, y los árboles, arbustos, farola, buzón,
// cartel, tablón, vitrina y puestos ocupan casillas enteras.
import { clamp } from '../util.js';
import { CHUNK } from './gen.js';
import { houseBlueprint, tavernBlueprint, byChunk } from './blueprints.js';

export const HOUSE = { x0: 15, y0: 7, x1: 27, y1: 17 };      // huella de tu casa (12×10 casillas)
export const HOUSE_BIG = { x0: 13, y0: 5, x1: 29, y1: 17 };   // la casa ampliada (16×12), con la puerta en el mismo sitio
export const HOUSE_FAMILY = { x0: 12, y0: 4, x1: 30, y1: 18 }; // la casa familiar (18×14), con sus cuartos: ocupa casi todo el jardín
export const DOOR = { x: 21.5, y: 17.5 };                      // casilla de delante de la puerta de tu casa
export const POND = { x: 31.5, y: 27, rx: 3.6, ry: 2.8 };
export const YARD = { x0: 11, y0: 3, x1: 31, y1: 20 };
const GATE = [20, 22];
const PATH = [[21.5, 17], [21.5, 20.5], [19.3, 23.5], [19, 29], [17.5, 34], [16.5, 46], [16, 60]];
export const SPAWN = { x: 18.6, y: 31 };
export const CENTER = { x: 21, y: 24 };
export const NILO = { x: 22.4, y: 24.2 };
// Casas de los vecinos (12×10 casillas, como la tuya). La de Dani aparece al terminar el proyecto "Casa nueva".
export const HOUSES = {
  rosa: { x0: 22, y0: 32, x1: 34, y1: 42, roof: 'tejado_azul', name: 'Rosa' },
  bruno: { x0: 2, y0: 44, x1: 14, y1: 54, roof: 'tejado_gris', name: 'Bruno' },
  dani: { x0: 21, y0: 46, x1: 33, y1: 56, roof: 'tejado_verde', name: 'Dani', project: 'casa' },
};
// Casilla de delante de la puerta de una casa de vecino (la puerta está en x0+6, en la fila de abajo)
export const doorOf = h => ({ x: h.x0 + 6.5, y: h.y1 + 0.5 });
// La taberna del pueblo (10×8), al oeste del camino: de Anselmo, con su barra, sus mesas y sus clientes
export const TAVERN = { x0: 1, y0: 32, x1: 11, y1: 40 };
export const inTavern = (x, y, m = 0) => x > TAVERN.x0 - m && x < TAVERN.x1 + m && y > TAVERN.y0 - m && y < TAVERN.y1 + m;
export const STALL = { x0: 25, y0: 23, x1: 27, y1: 24 };     // puesto de Rosa (2×1 casillas)
export const BOARD = { x: 16.5, y: 22.5 };                     // tablón de encargos
export const FOUNTAIN = { x: 21.5, y: 28.5 };                  // fuente (3×3 casillas)
export const DOCK = { x0: 26, y0: 30, x1: 30, y1: 31 };
// Proyectos del pueblo ya terminados (los pone el sistema de vecinos)
let projects = {};
export function setProjects(p) { projects = p || {}; changed(); }
export const getProjects = () => projects;
// Quien quiera enterarse de que cambia lo que hay en el pueblo (los proyectos o la casa familiar): el suelo en 3D, que
// pinta el camino, lo calcula en otro hilo y tiene que contárselo
const listeners = new Set();
export function onVillageChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const changed = () => { for (const fn of listeners) fn(); };
export const hasProject = id => !!projects[id];
// ¿Es ya tu casa la casa familiar? (entonces ocupa más jardín: los árboles y arbustos de ahí no están)
let family = false;
export function setFamilyHouse(on) { const was = family; family = !!on; if (was !== family) changed(); }
export const familyHouse = () => family;
const ownLot = () => (family ? HOUSE_FAMILY : HOUSE_BIG);
// Caminitos desde el camino principal hasta cada puerta
const SPURS = [
  [[16.8, 43], [28.5, 43]],
  [[17.0, 41], [6.5, 41]],   // (a la taberna)
  [[16.1, 55], [8.5, 55.2]],
  [[16.1, 57], [27.5, 57], 'casa'],
];
// Zona que ocupa el pueblo (para no calcular sus detalles en el resto del mundo)
export const BOUNDS = { x0: 0, y0: 1, x1: 40, y1: 62 };

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
export function distToPath(x, y) {
  let d = Infinity;
  for (let i = 0; i + 1 < PATH.length; i++) d = Math.min(d, distSeg(x, y, PATH[i][0], PATH[i][1], PATH[i + 1][0], PATH[i + 1][1]));
  for (const [a, b, need] of SPURS) if (!need || projects[need]) d = Math.min(d, distSeg(x, y, a[0], a[1], b[0], b[1]));
  return d;
}
const inHouse = (x, y, m = 0) => inTavern(x, y, m) || Object.values(HOUSES).some(h => (!h.project || projects[h.project]) && x > h.x0 - m && x < h.x1 + m && y > h.y0 - m && y < h.y1 + m);
// ¿Está dentro del solar de tu casa (el de la casa ampliada)? Ahí se puede construir aunque sea terreno del pueblo
export const inOwnHouse = (x, y) => { const H = ownLot(); return x > H.x0 && x < H.x1 && y > H.y0 && y < H.y1; };
export const pondDist = (x, y) => Math.hypot((x - POND.x) / POND.rx, (y - POND.y) / POND.ry);
export const inYard = (x, y, m = 0) => x > YARD.x0 - m && x < YARD.x1 + m && y > YARD.y0 - m && y < YARD.y1 + m;
export const inBounds = (x, y) => x > BOUNDS.x0 && x < BOUNDS.x1 && y > BOUNDS.y0 && y < BOUNDS.y1;
// ¿Dentro de una casa del pueblo o de la taberna? (ahí se puede quitar y poner de todo)
export const inVillageHouse = (x, y) => inHouse(x, y);
export const isGrass = (x, y) => !inBounds(x, y) || (pondDist(x, y) > 1.25 && distToPath(x, y) > 1.05 && !(x > ownLot().x0 - 0.5 && x < ownLot().x1 + 0.5 && y > ownLot().y0 - 0.5 && y < ownLot().y1 + 0.5) && !inHouse(x, y, 0.5));

// ¿Debe quedar libre de árboles y rocas esta casilla?
export function keepClear(x, y) {
  if (!inBounds(x, y)) return false;
  return distToPath(x, y) < 2.4 || inYard(x, y, 1.5) || pondDist(x, y) < 1.6 || Math.hypot(x - SPAWN.x, y - SPAWN.y) < 3 ||
    [...Object.values(HOUSES), TAVERN].some(h => x > h.x0 - 2 && x < h.x1 + 2 && y > h.y0 - 2 && y < h.y1 + 3) ||
    Math.hypot(x - FOUNTAIN.x, y - FOUNTAIN.y) < 2.5 || (x > 23 && x < 28 && y > 21 && y < 25);
}
// Claro alrededor del pueblo: 0 en el centro, 1 lejos
// Los arbustos del jardín del pueblo (menos los que caen donde va tu casa)
const GARDEN_BUSHES = [[17, 18], [25, 18], [12, 16], [29, 13], [27, 22], [22, 30], [13, 25]];
export function gardenBushes() { const lot = ownLot(); return GARDEN_BUSHES.filter(([tx, ty]) => !(tx >= lot.x0 && tx < lot.x1 && ty >= lot.y0 && ty < lot.y1)); }
export const clearing = (x, y) => clamp((Math.hypot(x - CENTER.x, y - CENTER.y) - 10) / 6, 0, 1);

// Objetos y colisiones del pueblo, más lo construido fijo (built: piezas por trozo)
export function buildVillage() {
  const objects = [], colliders = [];
  const add = (x, y, extra) => objects.push({ x, y, ...extra });
  // Piezas fijas del pueblo, por casilla (las casas de los vecinos y la valla del jardín)
  const fixed = { placed: {}, floor: {}, roof: {} };

  // Árboles y arbustos del jardín, cada uno en su casilla
  const lot = ownLot(), onLot = (tx, ty) => tx >= lot.x0 && tx < lot.x1 && ty >= lot.y0 && ty < lot.y1;
  for (const [tx, ty, kind] of [[12, 12, 'fruit'], [29, 8, 'oak']]) {
    if (onLot(tx, ty)) continue;
    const x = tx + 0.5, y = ty + 0.5;
    add(x, y, { nature: kind });
    colliders.push({ x, y, r: 0.35 });
  }
  // (los arbustos del jardín los pone el mundo, como los demás, para que se puedan segar: gen.js, gardenBushes)

  // Valla del jardín: piezas de valla en el anillo de casillas del jardín, con hueco para el camino
  for (let x = YARD.x0; x < YARD.x1; x++) for (let y = YARD.y0; y < YARD.y1; y++) {
    const edge = x === YARD.x0 || x === YARD.x1 - 1 || y === YARD.y0 || y === YARD.y1 - 1;
    if (!edge || (y === YARD.y1 - 1 && x >= GATE[0] && x < GATE[1])) continue;
    fixed.placed[`${x},${y}`] = 'valla';
  }

  // Casas de los vecinos: planos de piezas (muros de entramado, ventanas, puerta, tejado y muebles)
  for (const h of Object.values(HOUSES)) {
    if (h.project && !projects[h.project]) continue;
    const bp = houseBlueprint({ x0: h.x0, y0: h.y0, roof: h.roof, furnish: 'npc' });
    for (const layer of ['placed', 'floor', 'roof']) Object.assign(fixed[layer], bp[layer]);
  }

  // La taberna
  const ws = tavernBlueprint({ x0: TAVERN.x0, y0: TAVERN.y0 });
  for (const layer of ['placed', 'floor', 'roof']) Object.assign(fixed[layer], ws[layer]);

  // Puesto de Rosa, tablón de encargos y lo que se construye con los proyectos (todo en casillas enteras;
  // fx, fy: la huella de lo que ocupa más de una)
  add(STALL.x0, STALL.y0, { fx: [STALL.x0, STALL.x1], fy: [STALL.y0, STALL.y1], model: 'stall' });
  colliders.push({ x0: STALL.x0, y0: STALL.y0, x1: STALL.x1, y1: STALL.y1 });
  add(BOARD.x, BOARD.y, { model: 'board' }); colliders.push({ x: BOARD.x, y: BOARD.y, r: 0.3 });
  if (projects.fuente) {
    add(FOUNTAIN.x, FOUNTAIN.y, { fx: [FOUNTAIN.x - 1.5, FOUNTAIN.x + 1.5], fy: [FOUNTAIN.y - 1.5, FOUNTAIN.y + 1.5], model: 'fountain' });
    colliders.push({ x: FOUNTAIN.x, y: FOUNTAIN.y, r: 1.05 });
  }
  if (projects.mercado) {
    for (const [x, y, k] of [[24, 27, 'stall2'], [12, 31, 'stall3']]) {
      add(x, y, { fx: [x, x + 2], fy: [y, y + 1], model: k });
      colliders.push({ x0: x, y0: y, x1: x + 2, y1: y + 1 });
    }
  }
  if (projects.muelle) add(DOCK.x0, DOCK.y0, { fx: [DOCK.x0, DOCK.x1], fy: [DOCK.y0, DOCK.y1], model: 'dock' });

  // Buzón, farola y cartel, cada uno en su casilla
  add(22.5, 20.5, { model: 'mailbox' }); colliders.push({ x: 22.5, y: 20.5, r: 0.25 });
  add(19.5, 20.5, { model: 'lamp' }); colliders.push({ x: 19.5, y: 20.5, r: 0.2 });
  add(17.5, 26.5, { model: 'sign' }); colliders.push({ x: 17.5, y: 26.5, r: 0.25 });
  add(4.5, 40.6, { model: 'sign' }); colliders.push({ x: 4.5, y: 40.6, r: 0.25 });   // (el cartel de la taberna)

  // Estanque (la orilla y los nenúfares los pone la vista)
  colliders.push({ x: POND.x, y: POND.y, rx: POND.rx * 0.98, ry: POND.ry * 0.98 });
  return { objects, colliders, built: byChunk(fixed, CHUNK) };
}
