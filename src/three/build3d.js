// Piezas de construcción en 3D, casilla a casilla, igual que en el juego: suelos, muros (de madera, de
// piedra, de entramado, con ventana, con contraventanas o con cuadro) que se unen con los de al lado, puertas
// que se abren y cierran, vallas y muretes, y los tejados por regiones (toda la superficie de tejado unida),
// a cuatro aguas con la forma que sale de la distancia al alero, con alero, canto y chimenea encima del hogar.
//
// Los muros van por el centro de su casilla, con 24 cm de grueso. De cada tramo se sabe qué lado da a la casa
// (el que tiene suelo, o si no, tejado): por ahí es de yeso con rodapié; por fuera, del material del muro, con
// zócalo de piedra y, en los de entramado, postes, vigas y riostras. Cada tramo va en el grupo de su lado de
// fuera (n, s, e, o w), para poder quitar las paredes que tapan la vista cuando el jugador está dentro.
import * as THREE from 'three';
import { Builder, mat, sameClamp } from './geo.js';
import { plaster, planks, roofTiles, stone, wood, siding, flagstone, gravel, thatch, artwork } from './textures.js';
import { PIECES, parsePlaced, fenceReach, fenceJoins, POST_HALF } from '../pieces.js';
import { front } from '../art/stations.js';
import { PAL } from '../arte.js';
import { roofShape, roofPitch, SLAB, ROOF_CAP } from '../world/roof.js';
import { injectContact, contactKey } from './contact3d.js';
import { LOOK, INSIDE } from './wear3d.js';
import { placeMat, weathered } from './places3d.js';
import { barsTile, cellDoorTile, cellDoorLeaf } from './law3d.js';   // (a cycle, read only inside functions)
import { paneMaterial, ironMaterial, glassWall, glassDoorway, glassLeaf, GlassRoof, isGlass } from './glass3d.js';

// Puertas y contraventanas de tablas pintadas con uno de cinco colores minerales por casa, dintel y alféizar en las
// ventanas, cornisa, esquinas de sillería o de tablas y tapajuntas en los muros, y tejados a dos aguas (ver roof.js)
const PAINTS = Object.values(PAL.pintura);
// La pintura de una casa (por su región: siempre la misma), como clave de material: paint0 … paint4
export function paintKey(region) { let h = 7; for (const ch of String(region || '')) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0; return 'paint' + ((h >>> 0) % PAINTS.length); }

export const WALL_H = 2.8;
export const T = 0.12;
const PLINTH = 0.42;
const WIN = { half: 0.3, y0: 1.0, y1: 1.95 };
export const DOOR = { half: 0.42, y1: 2.05 };
const BEAM = { post: 0.04, rail: 0.034, brace: 0.028 };
export const ROOF = { level: 0.62, cap: 6, thick: 0.14, over: 0.32 };
// Colores de la paleta sobria: cal, piedra y madera gastadas, teja de barro, pizarra y cristal oscuro (los que van sobre
// una textura clara la tiñen: color del material). Los tejados, por su id (rojo es la teja de barro)
export const ROOF_COLORS = { tejado_rojo: '#7a5544', tejado_azul: '#44505c', tejado_gris: '#525558', tejado_verde: '#4c6250' };
const C = { thatch: '#c9bea8', slab: '#b9b3a6', plaster: '#d4d1c8', stone: '#8a857a', wallStone: '#948e82', siding: '#c9c2b6', timber: '#5f4e3e', frame: '#4f4438', shutter: '#3f7f5a', door: '#7d5e46',
  glass: '#5a6870', box: '#76604a', soil: '#4f4538', leaves: '#55663f', planks: '#d2c6b6', flag: '#d6d2c8', fence: '#857058', fenceStone: '#857f75', soffit: '#b8ab98' };

// Materiales base (los muros de una casa los clonan para poder desvanecerlos)
let BASE;
export function baseMaterials() {
  if (BASE) return BASE;
  const roofs = {};
  for (const [id, c] of Object.entries(ROOF_COLORS)) roofs[id] = mat({ map: roofTiles(c, id === 'tejado_azul' || id === 'tejado_gris' ? 'pizarra' : 'teja'), roughness: 0.88 });
  roofs.tejado_paja = weathered(mat({ map: thatch(), roughness: 1, color: C.thatch }));
  roofs[SLAB] = mat({ map: flagstone(), roughness: 0.92, color: C.slab });
  BASE = {
    plaster: mat({ map: plaster(), color: C.plaster }), stone: mat({ map: stone(C.stone) }), wallStone: mat({ map: stone(C.wallStone) }), siding: mat({ map: siding(), color: C.siding }),
    timber: mat({ map: wood(C.timber), roughness: 0.8 }), frame: mat({ map: wood(C.frame), roughness: 0.7 }), shutter: mat({ map: wood(C.shutter) }), door: mat({ map: wood(C.door) }),
    glass: new THREE.MeshStandardMaterial({ color: PAL.detalle.cristal, roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.4, depthWrite: false, emissive: '#ffb050', emissiveIntensity: 0 }),
    pane: paneMaterial(), paneIron: ironMaterial(),   // (the greenhouse's and the cloches': glass3d.js)
    box: mat({ color: C.box }), soil: mat({ color: C.soil }), leaves: mat({ color: C.leaves, flatShading: true }), bloom: mat({ roughness: 0.6 }),
    painting: mat({ map: artwork('valle') }), floor_madera: mat({ map: planks(), roughness: 0.6, color: C.planks }), floor_piedra: mat({ map: flagstone(), roughness: 0.85, color: C.flag }), floor_camino: mat({ map: gravel(), roughness: 1, color: C.flag }),
    fence: mat({ map: wood(C.fence) }), fenceStone: mat({ map: stone(C.fenceStone) }), roofs, roofEdge: mat({ map: wood(C.frame) }), soffit: mat({ map: planks(), color: C.soffit }),
    iron: mat({ color: PAL.detalle.hierro, metalness: 0.5, roughness: 0.55 }),
  };
  PAINTS.forEach((c, i) => { BASE['paint' + i] = mat({ map: wood(c), roughness: 0.85 }); });
  // Los suelos de las casas, con la sombra de contacto del mundo (contact3d.js): el pie de las paredes, los rincones y lo
  // de debajo de los muebles se asientan, sin un triángulo más. Solo en el renderer del juego (los iconos y la vista previa
  // tienen el suyo, y ahí no hay nada que leer). Los tres, con la misma clave: el código que se añade es el mismo, así que
  // comparten programa (uno que compilar, no tres); cada material sigue con sus uniformes, porque Three llama a
  // onBeforeCompile para cada uno. Y con clave propia, para no compartirlo con los materiales de sin ella. (si alguno
  // recorta su foto, los tres con el recorte: si no, el que recorta tendría otro programa; ver geo.js, sameClamp)
  sameClamp([BASE.floor_madera, BASE.floor_piedra, BASE.floor_camino]);
  for (const key of ['floor_madera', 'floor_piedra', 'floor_camino']) {
    const m = BASE[key];
    m.onBeforeCompile = (sh, r) => injectContact(sh, r, 'frag');
    m.customProgramCacheKey = () => contactKey('suelo-casa');
  }
  return BASE;
}
const FLOWER = new THREE.IcosahedronGeometry(1, 0), BLOOMS = ['#ff6a8a', '#ffe04a', '#ffffff', '#ff9ab8', '#b48aff'];

// ---------- muros ----------
const isWall = p => p?.kind === 'wall' || p?.kind === 'door';
// Going out from a wall this way, does the roof end in the open within a few tiles, with no wall on the way?
const PORCH = 4;
function porch(scene, tx, ty, dx, dy) {
  for (let i = 1; i <= PORCH; i++) {
    const x = tx + dx * i, y = ty + dy * i;
    if (isWall(scene.pieceAt(x, y))) return false;
    if (!scene.roofAt(x, y)) return i > 1;
  }
  return false;
}
// Lado de fuera de un tramo de muro en la casilla (tx, ty) que va a lo largo de x (X) o de y: n, s, e, w; 'in'
// si hay casa a los dos lados (tabique) y 'free' si a ninguno (un muro suelto)
export function outward(scene, tx, ty, X) {
  const inside = (x, y) => !!scene.at('floor', x, y) || (scene.roofAt(x, y) && !isWall(scene.pieceAt(x, y)));
  const a = X ? inside(tx, ty - 1) : inside(tx - 1, ty), b = X ? inside(tx, ty + 1) : inside(tx + 1, ty);
  if (a && b) {
    // (a porch against the house: both sides have a roof, but one of them is open. The wall is the house's, seen from the porch)
    const pa = X ? porch(scene, tx, ty, 0, -1) : porch(scene, tx, ty, -1, 0), pb = X ? porch(scene, tx, ty, 0, 1) : porch(scene, tx, ty, 1, 0);
    return pa === pb ? 'in' : X ? (pa ? 'n' : 's') : (pa ? 'w' : 'e');
  }
  if (!a && !b) return 'free';
  return X ? (a ? 's' : 'n') : (a ? 'e' : 'w');
}
// Juntas con los vecinos: 1 +x, 2 -x, 4 +y, 8 -y
export const wallMask = (scene, tx, ty) => (isWall(scene.pieceAt(tx + 1, ty)) ? 1 : 0) | (isWall(scene.pieceAt(tx - 1, ty)) ? 2 : 0) | (isWall(scene.pieceAt(tx, ty + 1)) ? 4 : 0) | (isWall(scene.pieceAt(tx, ty - 1)) ? 8 : 0);
// (dressed stone, ashlar_wall, is stone inside too; a limewashed wall has neither timbers nor quoins)
const EXTERIOR = { muro_madera: 'siding', muro_piedra: 'wallStone', bell_gable: 'wallStone', ashlar_wall: 'ashlarW', limewash_wall: 'limewash' };   // los demás son de yeso con entramado
const TRIM = { muro_piedra: 'stone', ashlar_wall: 'ashlarV', limewash_wall: 'limewash' }, PLINTHS = { ashlar_wall: 'ashlarD' };   // (the cornice and the quoins; the plinth)
const INNER = { ashlar_wall: 'ashlarW' };   // (the others, plaster)
const framed = id => !EXTERIOR[id];

// (the side of a wall that gives on to the house, worn, shows it less: wear3d.js)
const inside = (B, yes) => { if (yes && B.wearNow) B.wearNow *= INSIDE; return B; };
// emit(materialKey, side) → Builder en el que añadir esa parte
export function wallTile(scene, tx, ty, id, emit, extras) {
  if (PIECES[id]?.bars) return barsTile(scene, tx, ty, emit);   // (law3d.js)
  if (isGlass(id)) return glassWall(emit, tx, ty, wallMask(scene, tx, ty), WALL_H);
  const mask = wallMask(scene, tx, ty), cx = tx + 0.5, cz = ty + 0.5;
  const xArms = [mask & 1 ? 1 : 0, mask & 2 ? -1 : 0].filter(Boolean), zArms = [mask & 4 ? 1 : 0, mask & 8 ? -1 : 0].filter(Boolean);
  // Sin vecinos: un tramo entero a lo largo de x. Recto: un tramo entero, con su hueco si es ventana
  const straightX = !zArms.length, straightZ = !xArms.length && zArms.length;
  const window = id.startsWith('ventana') && (straightX || straightZ) ? { half: WIN.half, y0: WIN.y0, y1: WIN.y1, shutters: id === 'ventana_contraventanas', closed: !!scene.doorClosed?.(tx, ty) } : null;
  if (straightX || straightZ) {
    const X = !!straightX, side = outward(scene, tx, ty, X), c = X ? cz : cx, u0 = X ? tx : ty;
    const ends = X ? [!(mask & 2), !(mask & 1)] : [!(mask & 8), !(mask & 4)];
    // (una ventana en un muro de tablas o de piedra es de ese muro, no de yeso: el primero que no sea ventana a los lados)
    const fam = window ? familyOf(scene, tx, ty, X) || id : id;
    run(emit, extras, { id: fam, X, c, side, a: u0, b: u0 + 1, holes: window ? [{ u: u0 + 0.5, ...window }] : [], ends, painting: id === 'muro_cuadro' ? u0 + 0.5 : null, tile: [tx, ty] });
    return;
  }
  const sideX = outward(scene, tx, ty, true), sideZ = outward(scene, tx, ty, false);
  // En T (un tabique que llega a un muro): el muro sigue entero, con sus vigas, sus riostras y su zócalo, y el tabique sale de él
  if (xArms.length + zArms.length === 3) {
    const X = xArms.length === 2, s = X ? zArms[0] : xArms[0], mid = X ? cz : cx, u0 = X ? ty : tx;
    // (el lado del muro: la casilla del tabique es de la casa si tiene tejado o suelo, aunque ella sea muro; y el tabique, de dentro)
    const room = (x, y) => !!scene.roofAt(x, y) || !!scene.at('floor', x, y), arm = X ? room(tx, ty + s) : room(tx + s, ty), far = X ? room(tx, ty - s) : room(tx - s, ty);
    const out = X ? (s > 0 ? 'n' : 's') : (s > 0 ? 'w' : 'e'), side = arm && far ? 'in' : arm ? out : far ? (X ? (s > 0 ? 's' : 'n') : (s > 0 ? 'e' : 'w')) : 'free';
    run(emit, extras, { id, X, c: X ? cz : cx, side, a: X ? tx : ty, b: (X ? tx : ty) + 1, holes: [], ends: [false, false], tile: [tx, ty] });
    run(emit, extras, { id, X: !X, c: X ? cx : cz, side: arm ? 'in' : X ? sideZ : sideX, a: s > 0 ? mid + T : u0, b: s > 0 ? u0 + 1 : mid - T, holes: [], ends: [s > 0, s < 0], tile: [tx, ty], half: true });
    return;
  }
  // Esquina o cruce: un poste en el centro y un brazo hacia cada vecino
  for (const s of xArms) run(emit, extras, { id, X: true, c: cz, side: sideX, a: s > 0 ? cx + T : tx, b: s > 0 ? tx + 1 : cx - T, holes: [], ends: [false, false], tile: [tx, ty], half: true });
  for (const s of zArms) run(emit, extras, { id, X: false, c: cx, side: sideZ, a: s > 0 ? cz + T : ty, b: s > 0 ? ty + 1 : cz - T, holes: [], ends: [false, false], tile: [tx, ty], half: true });
  // El centro, con lo de cada lado según dé fuera o dentro
  const side = sideZ !== 'in' && sideZ !== 'free' ? sideZ : sideX;
  const ext = EXTERIOR[id] || 'plaster', ins = INNER[id] || 'plaster', faceIn = dir => {
    const outX = sideX === 'n' ? -1 : sideX === 's' ? 1 : 0, outZ = sideZ === 'w' ? -1 : sideZ === 'e' ? 1 : 0;
    if (dir === 'pz' || dir === 'nz') return !((dir === 'pz' ? 1 : -1) === outX || sideX === 'free');
    return !((dir === 'px' ? 1 : -1) === outZ || sideZ === 'free');
  };
  for (const f of ['px', 'nx', 'pz', 'nz']) inside(emit(faceIn(f) ? ins : ext, side), faceIn(f)).box(cx - T, 0, cz - T, cx + T, WALL_H, cz + T, { skip: ['px', 'nx', 'py', 'ny', 'pz', 'nz'].filter(k => k !== f).join(' ') });
  emit('frame', side).box(cx - T, WALL_H - 0.02, cz - T, cx + T, WALL_H, cz + T, { skip: 'ny px nx pz nz' });
  // Rodapié en las caras del poste que dan a la casa sin brazo delante: el lado liso de un muro en T (si no,
  // queda cortado) y, en un rincón saliente, las dos (la de lo largo de x tapa la esquina)
  const open = { px: !(mask & 1), nx: !(mask & 2), pz: !(mask & 4), nz: !(mask & 8) }, R = 0.02;
  const skirt = f => open[f] && (faceIn(f) ? ins : ext) === 'plaster', sk = emit('frame', side);
  for (const [f, z0, z1] of [['pz', cz + T, cz + T + R], ['nz', cz - T - R, cz - T]]) if (skirt(f)) sk.box(cx - T - (skirt('nx') ? R : 0), 0, z0, cx + T + (skirt('px') ? R : 0), 0.12, z1);
  for (const [f, x0, x1] of [['px', cx + T, cx + T + R], ['nx', cx - T - R, cx - T]]) if (skirt(f)) sk.box(x0, 0, cz - T, x1, 0.12, cz + T);
  // Poste de esquina y zócalo por fuera, en la esquina de fuera de un muro en L
  if (xArms.length === 1 && zArms.length === 1 && sideX !== 'in' && sideZ !== 'in') {
    const ox = -xArms[0], oz = -zArms[0];   // la esquina de fuera queda hacia donde no van los brazos
    const xr = ox > 0 ? [cx - T, cx + T + 0.05] : [cx - T - 0.05, cx + T], zr = oz > 0 ? [cz - T, cz + T + 0.05] : [cz - T - 0.05, cz + T];
    emit(PLINTHS[id] || 'stone', side).box(xr[0], 0, zr[0], xr[1], PLINTH, zr[1]);
    if (!framed(id) && id !== 'limewash_wall') {
      // Esquina de sillería (bloques que alternan el lado largo, uno en cada cara) o, en los de tablas, tablas de esquina
      const masonry = !!TRIM[id], B = emit(TRIM[id] || 'timber', side), P2 = masonry ? 0.025 : 0.02;
      const xo = cx + ox * T, zo = cz + oz * T, span = (a0, a1) => [Math.min(a0, a1), Math.max(a0, a1)];
      const faces = (y0, y1, lx, lz) => {
        const [x0, x1] = span(xo + ox * P2, xo - ox * lx), [z0, z1] = span(zo, zo + oz * P2);   // la cara a lo largo de x
        B.box(x0, y0, z0, x1, y1, z1);
        const [u0, u1] = span(xo, xo + ox * P2), [w0, w1] = span(zo + oz * P2, zo - oz * lz);   // la de a lo largo de z
        B.box(u0, y0, w0, u1, y1, w1);
      };
      if (masonry) for (let y = PLINTH, i = 0; y < WALL_H - 0.05; y += 0.3, i++) faces(y + 0.01, Math.min(WALL_H - 0.16, y + 0.29), i % 2 ? 0.36 : 0.2, i % 2 ? 0.2 : 0.36);
      else faces(PLINTH, WALL_H - 0.16, 0.12, 0.12);
    }
    if (framed(id)) emit('timber', side).box(ox > 0 ? cx - T : cx - T - BEAM.post, PLINTH, oz > 0 ? cz - T : cz - T - BEAM.post, ox > 0 ? cx + T + BEAM.post : cx + T, WALL_H, oz > 0 ? cz + T + BEAM.post : cz + T);
  }
}

// El muro de tablas o de piedra que sigue a una ventana por alguno de sus lados (hasta 4 casillas, saltando ventanas), o null
function familyOf(scene, tx, ty, X) {
  for (const s of [-1, 1]) for (let i = 1; i <= 4; i++) {
    const v = X ? scene.at('placed', tx + s * i, ty) : scene.at('placed', tx, ty + s * i), k = v && parsePlaced(v)[0];
    if (EXTERIOR[k]) return k;
    if (!k || !k.startsWith('ventana')) break;
  }
  return null;
}

// Un tramo recto de muro dentro de una casilla, de a hasta b a lo largo de su eje, con sus huecos
function run(emit, extras, { id, X, c, side, a, b, holes, ends, painting, half, tile }) {
  // Punto y caja en coordenadas del tramo: u a lo largo, k hacia el lado "más" (+z si X, +x si no)
  const P = (u, y, k = 0) => (X ? [u, y, c + k] : [c + k, y, u]);
  let house = false;   // (what is being added is on the side of the house: worn, less; wear3d.js)
  const box = (key, u0, u1, y0, y1, k0, k1, skip = '') => { const B = inside(emit(key, side), house), a0 = Math.min(u0, u1), a1 = Math.max(u0, u1), c0 = c + Math.min(k0, k1), c1 = c + Math.max(k0, k1); if (X) B.box(a0, y0, c0, a1, y1, c1, { skip }); else B.box(c0, y0, a0, c1, y1, a1, { skip: swapSkip(skip) }); };
  const outSign = side === 's' || side === 'e' ? 1 : side === 'n' || side === 'w' ? -1 : 0;
  const ext = EXTERIOR[id] || 'plaster', ins = INNER[id] || 'plaster';
  const matPlus = side === 'in' ? ins : side === 'free' ? ext : outSign > 0 ? ext : ins;
  const matMinus = side === 'in' ? ins : side === 'free' ? ext : outSign < 0 ? ext : ins;
  // El muro: tramos enteros entre huecos y encima y debajo de cada hueco. Cada cara de su material
  const isIn = s => side === 'in' || (side !== 'free' && s !== outSign);
  const slab = (u0, u1, y0, y1, endA, endB) => {
    house = isIn(1); box(matPlus, u0, u1, y0, y1, -T, T, 'px nx py ny nz');
    house = isIn(-1); box(matMinus, u0, u1, y0, y1, -T, T, 'px nx py ny pz');
    house = false;
    box('frame', u0, u1, y0, y1, -T, T, 'px nx ny pz nz');                      // canto de arriba
    if (endA) box(ext, u0, u1, y0, y1, -T, T, 'px py ny pz nz');
    if (endB) box(ext, u0, u1, y0, y1, -T, T, 'nx py ny pz nz');
  };
  let u = a;
  for (const h of holes) {
    const h0 = h.u - h.half, h1 = h.u + h.half;
    if (h0 > u) slab(u, h0, 0, WALL_H, u === a && ends[0], false);
    if (h.y0 > 0) slab(h0, h1, 0, h.y0);
    slab(h0, h1, h.y1, WALL_H);
    // Canto del hueco (el yeso de dentro del muro)
    box('plaster', h0 - 0.001, h0, h.y0, h.y1, -T, T, 'nx py ny pz nz');
    box('plaster', h1, h1 + 0.001, h.y0, h.y1, -T, T, 'px py ny pz nz');
    box('plaster', h0, h1, h.y1 - 0.001, h.y1, -T, T, 'px nx py pz nz');
    if (h.y0 > 0) box('plaster', h0, h1, h.y0, h.y0 + 0.001, -T, T, 'px nx ny pz nz');
    u = h1;
  }
  if (u < b) slab(u, b, 0, WALL_H, u === a && ends[0], ends[1]);
  // Por dentro: rodapié. Por fuera: zócalo de piedra y, en los de entramado, postes, vigas y riostras
  for (const s of [1, -1]) {
    const inner = isIn(s);
    const k0 = s * T, dir = s;
    if (inner && ins !== 'plaster') continue;
    if (inner) { house = true; cutRun(a, b, holes.filter(h => h.door), (u0, u1) => box('frame', u0, u1, 0, 0.12, k0, k0 + dir * 0.02)); house = false; continue; }
    if (side === 'in') continue;
    cutRun(a, b, holes.filter(h => h.door), (u0, u1) => box(PLINTHS[id] || 'stone', u0, u1, 0, PLINTH, k0, k0 + dir * 0.05));
    if (!framed(id)) {
      // Cornisa arriba (de piedra o de madera) y, en los de tablas, tapajuntas cada 25 cm, salvo sobre los huecos
      box(TRIM[id] || 'timber', a, b, WALL_H - 0.16, WALL_H, k0, k0 + dir * 0.045);
      if (id === 'muro_madera') for (let u = Math.ceil(a * 4 - 0.01) / 4 + 0.125; u < b - 0.02; u += 0.25)
        if (!holes.some(h => u > h.u - h.half - 0.05 && u < h.u + h.half + 0.05)) box('timber', u - 0.018, u + 0.018, PLINTH, WALL_H - 0.16, k0, k0 + dir * 0.022);
    }
    if (!framed(id)) continue;
    const beam = (p0, p1, along, w, d) => beamGeo(emit('timber', side), P(p0[0], p0[1], k0), P(p1[0], p1[1], k0), along, X ? [0, 0, dir] : [dir, 0, 0], w, d);
    const ALONG = X ? [1, 0, 0] : [0, 0, 1], UP = [0, 1, 0];
    const blocked = (u0, u1, y) => holes.some(h => u1 > h.u - h.half - 0.07 && u0 < h.u + h.half + 0.07 && y > h.y0 - 0.07 && y < h.y1 + 0.07);
    // Postes en los bordes de casilla (el de inicio siempre; el del final si el muro acaba ahí)
    if (!half) {
      if (!blocked(a - 0.07, a + 0.07, 1.2)) beam([a, PLINTH], [a, WALL_H], ALONG, 0.14, BEAM.post);
      if (ends[1]) beam([b - 0.07, PLINTH], [b - 0.07, WALL_H], ALONG, 0.14, BEAM.post);
    }
    for (const y of [PLINTH + 0.06, 1.46, WALL_H - 0.07]) cutRun(a, b, holes.filter(h => y > h.y0 - 0.07 && y < h.y1 + 0.07).map(h => ({ ...h, half: h.half + 0.07 })), (u0, u1) => { if (u1 - u0 > 0.08) beam([u0, y], [u1, y], UP, 0.12, BEAM.rail); });
    // Riostras en diagonal en las casillas lisas (alternando el sentido)
    if (!half && !holes.length) {
      const flip = Math.floor(a) % 2 === 0, u0 = a + 0.12, u1 = b - 0.12;
      beam([flip ? u1 : u0, PLINTH + 0.12], [flip ? u0 : u1, 1.40], UP, 0.1, BEAM.brace);
      beam([flip ? u0 : u1, 1.52], [flip ? u1 : u0, WALL_H - 0.13], UP, 0.1, BEAM.brace);
    }
  }
  // Ventanas: marco por fuera y por dentro, cristal con cruceta, alféizar y, si toca, contraventanas y jardinera
  for (const h of holes) {
    if (h.door) continue;
    const h0 = h.u - h.half, h1 = h.u + h.half;
    for (const k of [T, -T]) {
      const o = Math.sign(k);
      house = isIn(o);
      box('frame', h0 - 0.07, h0, h.y0, h.y1 + 0.07, k, k + o * 0.05);
      box('frame', h1, h1 + 0.07, h.y0, h.y1 + 0.07, k, k + o * 0.05);
      box('frame', h0, h1, h.y1, h.y1 + 0.07, k, k + o * 0.05);
    }
    house = false;
    box('glass', h0, h1, h.y0, h.y1, -0.008, 0.008);
    // (abierta y en una pared que da fuera: su luz de noche, pegada a la fachada; ver glow.js. Las cerradas rehacen su trozo.
    // Un centímetro por delante del alféizar y las contraventanas abiertas, lo que más sale: en el plano del marco o detrás
    // de algo de la fachada, parpadearía con él al mover la cámara)
    if (outSign && !h.closed && extras.windows && tile) {
      const k = outSign * (T + 0.1), y = (h.y0 + h.y1) / 2 + (extras.lift || 0), p = P(h.u, y, k);
      extras.windows.push({ p, n: X ? [0, outSign] : [outSign, 0], tile, side, gy: 0 });   // (gy: el suelo de delante, lo pone world3d.js)
    }
    box('frame', h.u - 0.022, h.u + 0.022, h.y0, h.y1, -0.03, 0.03);
    box('frame', h0, h1, (h.y0 + h.y1) / 2 - 0.022, (h.y0 + h.y1) / 2 + 0.022, -0.03, 0.03);
    box('frame', h0 - 0.1, h1 + 0.1, h.y0 - 0.06, h.y0, -T - 0.08, T + 0.08);
    if (outSign) {   // dintel encima y alféizar debajo, por fuera (de piedra; en los de madera, de madera)
      const k = outSign * T, m = framed(id) || id === 'muro_madera' || id === 'limewash_wall' ? 'timber' : TRIM[id] || 'stone';
      box(m, h0 - 0.14, h1 + 0.14, h.y1 + 0.07, h.y1 + 0.21, k, k + outSign * 0.04);
      box(id === 'muro_madera' ? 'timber' : 'stone', h0 - 0.12, h1 + 0.12, h.y0 - 0.12, h.y0 - 0.05, k, k + outSign * 0.09);
    }
    // Cerrada: los postigos por dentro y, si tiene contraventanas, también juntas por fuera delante del cristal
    if (h.closed) for (const o of outSign ? [-outSign] : [1, -1]) {
      const k = o * T;
      for (const [a0, a1] of [[h0, h.u - 0.004], [h.u + 0.004, h1]]) {
        box('door', a0, a1, h.y0, h.y1, k + o * 0.005, k + o * 0.04);
        for (const y of [h.y0 + 0.08, h.y1 - 0.11]) box('frame', a0 + 0.02, a1 - 0.02, y, y + 0.03, k + o * 0.04, k + o * 0.055);
      }
    }
    if (h.shutters && outSign) {
      const k = outSign * T;
      for (const [a0, a1] of h.closed ? [[h0 - 0.02, h.u - 0.003], [h.u + 0.003, h1 + 0.02]] : [[h0 - 0.38, h0 - 0.08], [h1 + 0.08, h1 + 0.38]]) {
        {
          // Tres tablas con su junta, dos travesaños y la riostra en Z, del color de la casa
          const paint = extras.paint || 'paint0', w = (a1 - a0) / 3, z0 = k + outSign * 0.05, z1 = k + outSign * 0.08;
          for (let i = 0; i < 3; i++) box(paint, a0 + i * w + 0.004, a0 + (i + 1) * w - 0.004, h.y0 - 0.02, h.y1 + 0.04, z0, z1);
          for (const y of [h.y0 + 0.08, h.y1 - 0.08]) box(paint, a0 + 0.03, a1 - 0.03, y, y + 0.08, z1, z1 + outSign * 0.02);
          beamGeo(emit(paint, side), P(a0 + 0.06, h.y0 + 0.16, z1), P(a1 - 0.06, h.y1 - 0.08, z1), [0, 1, 0], X ? [0, 0, outSign] : [outSign, 0, 0], 0.07, 0.02);
        }
      }
      box('box', h0 - 0.12, h1 + 0.12, h.y0 - 0.3, h.y0 - 0.08, k + outSign * 0.1, k + outSign * 0.3);
      box('soil', h0 - 0.09, h1 + 0.09, h.y0 - 0.1, h.y0 - 0.075, k + outSign * 0.125, k + outSign * 0.275);
      const seed = Math.abs(Math.sin(h.u * 12.9898 + c * 78.233) * 43758.5453);
      for (let i = 0; i < 7; i++) {
        const fu = h0 - 0.05 + (i / 6) * (h1 - h0 + 0.1);
        extras.blooms.push({ side, p: P(fu, h.y0 - 0.02 + (i % 2) * 0.05, k + outSign * 0.2), s: 0.055, c: BLOOMS[Math.floor(seed + i * 3) % 5] });
        extras.leaves.push({ side, p: P(fu + 0.04, h.y0 - 0.06, k + outSign * 0.18), s: [0.075, 0.05, 0.075] });
      }
    }
  }
  // Cuadro colgado por dentro
  if (painting != null && side !== 'free') {
    const s = side === 'in' ? 1 : -outSign, k = s * (T + 0.001);
    box('frame', painting - 0.4, painting + 0.4, 1.12, 1.78, k, k + s * 0.035);
    // (la derecha de quien lo mira, para que el paisaje no salga del revés)
    const nIn = X ? [0, 0, s] : [s, 0, 0], right = X ? [s > 0 ? 1 : -1, 0, 0] : [0, 0, s > 0 ? -1 : 1];
    const q = P(painting, 1.45, k + s * 0.037), at = (a2, b2) => [q[0] + right[0] * a2 * 0.33, q[1] + b2 * 0.26, q[2] + right[2] * a2 * 0.33];
    emit('painting', side).quadN(at(-1, -1), at(1, -1), at(1, 1), at(-1, 1), nIn, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
}
const swapSkip = skip => skip.replace(/px/g, '#A').replace(/pz/g, 'px').replace(/#A/g, 'pz').replace(/nx/g, '#B').replace(/nz/g, 'nx').replace(/#B/g, 'nz');
// Recorre [a, b] saltándose los huecos (para el zócalo, el rodapié y las vigas)
function cutRun(a, b, holes, f) {
  let u = a;
  for (const h of [...holes].sort((p, q) => p.u - q.u)) { const h0 = h.u - h.half, h1 = h.u + h.half; if (h0 > u) f(u, Math.min(h0, b)); u = Math.max(u, h1); }
  if (u < b) f(u, b);
}
// Madera plana sobre una pared, de p0 a p1: w de ancho a lo largo de b, saliendo d hacia n
function beamGeo(B, p0, p1, b, n, w, d) {
  const V = (p, k1, k2) => [p[0] + b[0] * k1 + n[0] * k2, p[1] + b[1] * k1 + n[1] * k2, p[2] + b[2] * k1 + n[2] * k2];
  const a = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], L = Math.hypot(...a), h = w / 2;
  if (L < 1e-4) return;
  const an = a.map(v => v / L);
  const A0 = V(p0, -h, d), A1 = V(p0, h, d), B0 = V(p1, -h, d), B1 = V(p1, h, d), C0 = V(p0, -h, 0), C1 = V(p0, h, 0), D0 = V(p1, -h, 0), D1 = V(p1, h, 0);
  B.quadN(A0, B0, B1, A1, n, [[0, 0], [L, 0], [L, w], [0, w]]);
  B.quadN(C1, A1, B1, D1, b, [[0, 0], [0, d], [L, d], [L, 0]]);
  B.quadN(D0, B0, A0, C0, b.map(v => -v), [[L, 0], [L, d], [0, d], [0, 0]]);
  B.quadN(D1, B1, B0, D0, an, [[0, 0], [0, d], [w, d], [w, 0]]);
  B.quadN(C0, A0, A1, C1, an.map(v => -v), [[0, 0], [0, d], [w, d], [w, 0]]);
}

// ---------- puertas ----------
// El hueco con su marco y el trozo de muro de encima (del muro de al lado), y la hoja, que se devuelve aparte
// para animarla: { tile, hinge (posición), X, outSign (hacia fuera), swing (hacia dónde se abre), side }
export function doorTile(scene, tx, ty, emit, extras) {
  if (scene.pieceAt(tx, ty)?.bars) return cellDoorTile(scene, tx, ty, emit);   // (law3d.js)
  const solid = (x, y) => { const p = scene.pieceAt(x, y); return p && p.kind !== 'fence' && p.kind !== 'gate'; };
  const X = solid(tx - 1, ty) || solid(tx + 1, ty) || !(solid(tx, ty - 1) || solid(tx, ty + 1));
  const sideIds = X ? [scene.at('placed', tx - 1, ty), scene.at('placed', tx + 1, ty)] : [scene.at('placed', tx, ty - 1), scene.at('placed', tx, ty + 1)];
  const next = sideIds.map(v => v && parsePlaced(v)[0]).find(n => PIECES[n]?.kind === 'wall' && !PIECES[n].bars) || 'muro_madera';
  const id = next.startsWith('ventana') || next === 'muro_cuadro' ? 'muro_entramado' : next;
  const side = outward(scene, tx, ty, X), cx = tx + 0.5, cz = ty + 0.5, u0 = X ? tx : ty, c = X ? cz : cx;
  if (isGlass(id)) {
    // (in a glass wall: an iron frame, a glazed leaf and a stone step; it opens as it would in any other)
    glassDoorway(emit, X, c, u0, DOOR.half, DOOR.y1, WALL_H);
    const out = side === 's' || side === 'e' ? 1 : side === 'n' || side === 'w' ? -1 : 1, swing = side === 'in' || side === 'free' ? out : -out, B = emit('stone', 'free'), m = u0 + 0.5, k0 = side === 'in' ? -0.14 : Math.min(out * 0.5, -out * 0.14), k1 = side === 'in' ? 0.14 : Math.max(out * 0.5, -out * 0.14);
    if (X) B.box(m - DOOR.half, 0, c + k0, m + DOOR.half, FLOOR_H + 0.015, c + k1); else B.box(c + k0, 0, m - DOOR.half, c + k1, FLOOR_H + 0.015, m + DOOR.half);
    return { tile: [tx, ty], X, outSign: out, swing, side: 'free', glass: true, hinge: X ? [m - DOOR.half + 0.02, 0, c + swing * 0.05] : [c + swing * 0.05, 0, m - DOOR.half + 0.02], width: DOOR.half * 2 - 0.03 };
  }
  const mask = wallMask(scene, tx, ty), ends = X ? [!(mask & 2), !(mask & 1)] : [!(mask & 8), !(mask & 4)];
  run(emit, extras, { id, X, c, side, a: u0, b: u0 + 1, holes: [{ u: u0 + 0.5, half: DOOR.half, y0: 0, y1: DOOR.y1, door: true }], ends, tile: [tx, ty] });
  // Marco por los dos lados y escalón de piedra por fuera
  const outSign = side === 's' || side === 'e' ? 1 : side === 'n' || side === 'w' ? -1 : 1;
  const box = (key, a0, a1, y0, y1, k0, k1) => { const B = emit(key, side), lo = Math.min(k0, k1), hi = Math.max(k0, k1); if (X) B.box(a0, y0, c + lo, a1, y1, c + hi); else B.box(c + lo, y0, a0, c + hi, y1, a1); };
  const h0 = u0 + 0.5 - DOOR.half, h1 = u0 + 0.5 + DOOR.half;
  for (const k of [T, -T]) {
    const o = Math.sign(k);
    box('frame', h0 - 0.07, h0, 0, DOOR.y1 + 0.07, k, k + o * 0.05);
    box('frame', h1, h1 + 0.07, 0, DOOR.y1 + 0.07, k, k + o * 0.05);
    box('frame', h0, h1, DOOR.y1, DOOR.y1 + 0.07, k, k + o * 0.05);
  }
  box('frame', h0, h1, 0, FLOOR_H + 0.015, -T, T);   // umbral (un poco más alto que el suelo: a la misma altura, los dos parpadeaban)
  if (side !== 'in') box('stone', h0 - 0.1, h1 + 0.1, 0, 0.1, outSign * (T + 0.05), outSign * (T + 0.5));
  // La hoja se abre hacia dentro de la casa (las de entre dos cuartos, y las sueltas, hacia +x o +y): la bisagra va
  // en la cara de ese lado
  const swing = side === 'in' || side === 'free' ? outSign : -outSign;
  const hinge = X ? [h0 + 0.02, 0, c + swing * (T + 0.04)] : [c + swing * (T + 0.04), 0, h0 + 0.02];
  return { tile: [tx, ty], X, outSign, swing, side, hinge, width: DOOR.half * 2 - 0.03 };
}
// La hoja de una puerta: tablas con sus refuerzos y el tirador. Gira sobre la bisagra: a = 0 cerrada, 1 abierta
export function doorLeaf(d, mats) {
  if (d.bars) return cellDoorLeaf(d, mats);
  const lw = d.width, leaf = new Builder().wear(d.wear || 0), bars = new Builder().wear(d.wear || 0);
  if (d.glass) {
    const g = glassLeaf(d, mats, DOOR.y1 - 0.04), along = d.X ? [1, 0] : [0, 1], out = d.X ? [0, d.swing] : [d.swing, 0], beta = 1.95;
    g.position.set(...d.hinge);
    g.userData.setAngle = a => { const b = beta * a, dx = along[0] * Math.cos(b) + out[0] * Math.sin(b), dz = along[1] * Math.cos(b) + out[1] * Math.sin(b); g.rotation.y = Math.atan2(-dz, dx); };
    return g;
  }
  if (mats.paint) {
    // Cinco tablas con su junta, tres travesaños y dos riostras en Z, del color de la casa; pernios de hierro que
    // cruzan la hoja desde la bisagra, y tirador de anilla
    const iron = new Builder(), w = lw / 5, H = DOOR.y1 - 0.04;
    for (let i = 0; i < 5; i++) leaf.box(i * w + 0.004, 0.03, -0.03, (i + 1) * w - 0.004, H, 0.03);
    // (los travesaños por la cara +z, como los refuerzos de siempre; los herrajes y el tirador, por la otra)
    for (const y of [0.22, 1.0, 1.78]) bars.box(0.05, y, 0.03, lw - 0.05, y + 0.11, 0.05);
    beamGeo(bars, [lw - 0.08, 0.33, 0.03], [0.08, 1.0, 0.03], [0, 1, 0], [0, 0, 1], 0.1, 0.018);
    beamGeo(bars, [lw - 0.08, 1.11, 0.03], [0.08, 1.78, 0.03], [0, 1, 0], [0, 0, 1], 0.1, 0.018);
    for (const y of [0.4, 1.6]) { iron.box(0, y, -0.038, lw * 0.62, y + 0.045, -0.03); iron.box(lw * 0.62 - 0.03, y - 0.015, -0.04, lw * 0.62 + 0.01, y + 0.06, -0.03); }
    iron.box(lw - 0.15, 1.02, -0.045, lw - 0.11, 1.08, -0.03); iron.box(lw - 0.16, 0.93, -0.052, lw - 0.1, 1.02, -0.045);
    const g = new THREE.Group();
    g.position.set(...d.hinge);
    g.add(leaf.mesh(mats.paint), bars.mesh(mats.paint), iron.mesh(mats.iron));
    const along = d.X ? [1, 0] : [0, 1], out = d.X ? [0, d.swing] : [d.swing, 0], beta = 1.95;
    g.userData.setAngle = a => { const b = beta * a, dx = along[0] * Math.cos(b) + out[0] * Math.sin(b), dz = along[1] * Math.cos(b) + out[1] * Math.sin(b); g.rotation.y = Math.atan2(-dz, dx); };
    return g;
  }
  leaf.box(0, 0.03, -0.03, lw, DOOR.y1 - 0.04, 0.03);
  for (const y of [0.3, 1.0, 1.7]) bars.box(0.05, y, 0.03, lw - 0.05, y + 0.1, 0.05);
  bars.box(lw - 0.14, 1.0, -0.06, lw - 0.1, 1.1, -0.03);
  const g = new THREE.Group();
  g.position.set(...d.hinge);
  g.add(leaf.mesh(mats.door), bars.mesh(mats.frame));
  const along = d.X ? [1, 0] : [0, 1], out = d.X ? [0, d.swing] : [d.swing, 0], beta = 1.95;
  g.userData.setAngle = a => { const b = beta * a, dx = along[0] * Math.cos(b) + out[0] * Math.sin(b), dz = along[1] * Math.cos(b) + out[1] * Math.sin(b); g.rotation.y = Math.atan2(-dz, dx); };
  return g;
}

// ---------- vallas ----------
// La puerta de una valla: dos postes en la línea de las vecinas y lo que necesita la hoja para animarla (la dibuja gateLeaf)
export function gateTile(scene, tx, ty, emit) {
  const f = (x, y) => fenceJoins(scene, x, y);
  const X = f(tx - 1, ty) || f(tx + 1, ty) || !(f(tx, ty - 1) || f(tx, ty + 1)), cx = tx + 0.5, cz = ty + 0.5, B = emit('fence', 'free');
  for (const s of [-0.5, 0.5]) {
    const px = X ? cx + s : cx, pz = X ? cz : cz + s;
    B.box(px - 0.07, 0, pz - 0.07, px + 0.07, 1.02, pz + 0.07, { s: 0.5 });
    B.box(px - 0.09, 1.02, pz - 0.09, px + 0.09, 1.07, pz + 0.09, { s: 0.5 });
  }
  return { tile: [tx, ty], X, gate: true, swing: 1, hinge: X ? [tx + 0.05, 0, cz] : [cx, 0, ty + 0.05], width: 0.9 };
}
// La hoja: tres barras entre dos largueros, de lado a lado. Gira sobre la bisagra: a = 0 cerrada, 1 abierta
export function gateLeaf(d, mats) {
  const w = d.width, B = new Builder().wear(d.wear || 0), g = new THREE.Group();
  for (const y of [0.26, 0.5, 0.74]) B.box(0, y, -0.035, w, y + 0.09, 0.035, { s: 0.5 });
  for (const x of [0.02, w - 0.09]) B.box(x, 0.18, -0.045, x + 0.07, 0.92, 0.045, { s: 0.5 });
  g.position.set(...d.hinge);
  g.add(B.mesh(mats.fence));
  const along = d.X ? [1, 0] : [0, 1], out = d.X ? [0, d.swing] : [d.swing, 0], beta = 1.75;
  g.userData.setAngle = a => { const b = beta * a, dx = along[0] * Math.cos(b) + out[0] * Math.sin(b), dz = along[1] * Math.cos(b) + out[1] * Math.sin(b); g.rotation.y = Math.atan2(-dz, dx); };
  return g;
}
export function fenceTile(scene, tx, ty, id, emit) {
  const f = (x, y) => fenceJoins(scene, x, y);
  const cx = tx + 0.5, cz = ty + 0.5, arms = [[f(tx + 1, ty), 1, 0], [f(tx - 1, ty), -1, 0], [f(tx, ty + 1), 0, 1], [f(tx, ty - 1), 0, -1]].filter(a => a[0]);
  // (towards a wall the rails go on to its face: walls run through the middle of their tile, not along its edge)
  const seg = (dx, dz, fn) => { const r = fenceReach(scene, tx + dx, ty + dz), x0 = Math.min(cx, cx + dx * r), x1 = Math.max(cx, cx + dx * r), z0 = Math.min(cz, cz + dz * r), z1 = Math.max(cz, cz + dz * r); fn(x0, x1, z0, z1); };
  if (id === 'valla_piedra') {
    const B = emit('fenceStone', 'free'), w = 0.17;
    B.box(cx - w, 0, cz - w, cx + w, 0.72, cz + w);
    for (const [, dx, dz] of arms) seg(dx, dz, (x0, x1, z0, z1) => B.box(dx ? x0 : cx - w + 0.02, 0, dz ? z0 : cz - w + 0.02, dx ? x1 : cx + w - 0.02, 0.62, dz ? z1 : cz + w - 0.02));
    emit('fenceStone', 'free').box(cx - w - 0.03, 0.72, cz - w - 0.03, cx + w + 0.03, 0.8, cz + w + 0.03);
    return;
  }
  const B = emit('fence', 'free'), s = (ihash2(tx, ty) - 0.5) * 0.06;
  B.box(cx - 0.055, 0, cz - 0.055, cx + 0.055, 0.92 + s, cz + 0.055, { s: 0.5 });
  B.box(cx - 0.07, 0.92 + s, cz - 0.07, cx + 0.07, 0.96 + s, cz + 0.07, { s: 0.5 });
  for (const [, dx, dz] of arms) for (const y of [0.36, 0.72]) seg(dx, dz, (x0, x1, z0, z1) => {
    if (dx) { B.box(x0, y, cz + 0.055, x1, y + 0.1, cz + 0.09, { s: 0.5 }); B.box(x0, y, cz - 0.09, x1, y + 0.1, cz - 0.055, { s: 0.5 }); }
    else { B.box(cx + 0.055, y, z0, cx + 0.09, y + 0.1, z1, { s: 0.5 }); B.box(cx - 0.09, y, z0, cx - 0.055, y + 0.1, z1, { s: 0.5 }); }
  });
}
const ihash2 = (x, y) => { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

// ---------- posts ----------
// What holds a roof where there is no wall. Wood: a square timber on a stone foot, with a bolster under the roof and a knee
// brace towards each side the roof goes on to. Stone: a pillar of dressed blocks, base and capital. more: what its roof is
// above its own level (a house on a slope is level, the porch's post starts lower). Under a slope it goes up to the tiles
// (the row of the eave); further in, to the height of the walls, as they do
const POST_RISE = 0.5;
export function postTile(scene, tx, ty, id, emit, more = 0) {
  const cx = tx + 0.5, cz = ty + 0.5, roof = !!scene.roofAt(tx, ty), up = roof ? scene.roofGeometry?.(tx, ty, new Map())?.h.c ?? 0 : 0;
  const H = WALL_H + more + (id !== 'stone_column' && up <= POST_RISE ? Math.max(0, up * ROOF.level - 0.04) : 0), foot = -0.32;   // (foot: down into the ground, which may slope)
  const arms = roof ? [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([x, y]) => scene.roofAt(tx + x, ty + y)) : [];
  if (id === 'stone_column') {
    // A round column of dressed drums, with its base and its capital; and the entablature towards the next one (a column or
    // a wall, three tiles away at most), each half of it
    const A = emit('ashlarW', 'free'), V = emit('ashlarV', 'free'), N = 16, drum = (B, r0, y0, r1, y1, turn = 0) => {
      for (let i = 0; i < N; i++) { const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2, P = (a, r, y) => [cx + Math.sin(a) * r, y, cz + Math.cos(a) * r], am = (a0 + a1) / 2; B.quadN(P(a0, r0, y0), P(a1, r0, y0), P(a1, r1, y1), P(a0, r1, y1), [Math.sin(am), 0, Math.cos(am)], [[a0 * r0 + turn, y0], [a1 * r0 + turn, y0], [a1 * r1 + turn, y1], [a0 * r1 + turn, y1]]); }
    };
    const ring = (B, r0, r1, y, up) => { for (let i = 0; i < N; i++) { const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2, P = (a, r) => [cx + Math.sin(a) * r, y, cz + Math.cos(a) * r]; B.quadN(P(a0, r0), P(a1, r0), P(a1, r1), P(a0, r1), [0, up, 0], [[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1]]); } };
    const top = H - 0.52, n = 5, h0 = 0.34, dh = (top - 0.24 - h0) / n, rad = y => 0.235 - 0.035 * ((y - h0) / (top - h0));
    V.roundBox(cx - 0.36, foot, cz - 0.36, cx + 0.36, 0.14, cz + 0.36, 0.02, { s: 1 });
    drum(V, 0.33, 0.14, 0.33, 0.2); ring(V, 0.24, 0.33, 0.2, 1); drum(V, 0.28, 0.2, 0.27, 0.28); ring(V, 0.2, 0.28, 0.28, 1); drum(V, 0.255, 0.28, 0.24, h0);
    for (let i = 0; i < n; i++) { const y = h0 + i * dh; drum(A, rad(y), y + 0.008, rad(y + dh), y + dh - 0.008, ihash2(tx + i, ty) * 2); ring(A, rad(y) - 0.03, rad(y), y + 0.008, 1); drum(A, rad(y) - 0.022, y - 0.01, rad(y) - 0.022, y + 0.012); }
    drum(V, 0.215, top - 0.24, 0.22, top - 0.2); drum(V, 0.215, top - 0.2, 0.3, top - 0.1); drum(V, 0.3, top - 0.1, 0.31, top - 0.07);
    V.roundBox(cx - 0.36, top - 0.07, cz - 0.36, cx + 0.36, top, cz + 0.36, 0.012, { s: 1 });
    const holds = (x, y) => { const p = scene.at('placed', x, y); return p && (parsePlaced(p)[0] === 'stone_column' || PIECES[parsePlaced(p)[0]]?.kind === 'wall' || PIECES[parsePlaced(p)[0]]?.kind === 'door'); };
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let k = 0; for (let i = 1; i <= 3 && !k; i++) if (holds(tx + dx * i, ty + dz * i)) k = i;
      if (!k || !roof) continue;
      const wall = parsePlaced(scene.at('placed', tx + dx * k, ty + dz * k))[0] !== 'stone_column', L = wall ? k - T : k / 2;
      for (const [w, y0, y1, B] of [[0.25, top, H - 0.22, A], [0.29, H - 0.22, H - 0.14, V], [0.27, H - 0.14, H, A]]) { const x0 = dx ? Math.min(cx, cx + dx * L) : cx - w, x1 = dx ? Math.max(cx, cx + dx * L) : cx + w, z0 = dz ? Math.min(cz, cz + dz * L) : cz - w, z1 = dz ? Math.max(cz, cz + dz * L) : cz + w; B.box(x0, y0, z0, x1, y1, z1, { s: 1 }); }
    }
    V.box(cx - 0.25, top, cz - 0.25, cx + 0.25, H, cz + 0.25, { s: 1 });
    return;
  }
  if (id === 'stone_pillar') {
    const B = emit('wallStone', 'free'), K = emit('stone', 'free'), r = POST_HALF.stone_pillar, n = Math.round((H - 0.62) / 0.36), h = (H - 0.62) / n;
    K.roundBox(cx - 0.29, foot, cz - 0.29, cx + 0.29, 0.2, cz + 0.29, 0.03, { s: 0.9 });
    K.roundBox(cx - 0.245, 0.2, cz - 0.245, cx + 0.245, 0.34, cz + 0.245, 0.035, { s: 0.9 });
    // (courses: each block a little different, by its place, with its worn edges)
    for (let i = 0; i < n; i++) { const w = r - 0.008 + (ihash2(tx * 31 + i, ty * 17 - i) - 0.5) * 0.012, y = 0.34 + i * h; B.roundBox(cx - w, y, cz - w, cx + w, y + h - 0.006, cz + w, 0.016, { s: 0.8 + ihash2(tx - i, ty + i) * 0.3 }); }
    K.roundBox(cx - 0.235, H - 0.28, cz - 0.235, cx + 0.235, H - 0.14, cz + 0.235, 0.03, { s: 0.9 });
    K.roundBox(cx - 0.29, H - 0.14, cz - 0.29, cx + 0.29, H, cz + 0.29, 0.022, { s: 0.9 });
    return;
  }
  const B = emit('timber', 'free'), S = emit('stone', 'free'), F = emit('frame', 'free'), r = POST_HALF.post, top = arms.length ? H - 0.16 : H;
  S.roundBox(cx - 0.19, foot, cz - 0.19, cx + 0.19, 0.14, cz + 0.19, 0.03, { s: 0.8 });
  B.roundBox(cx - r, 0.14, cz - r, cx + r, top, cz + r, 0.014, { s: 0.7 });
  // (the bolster: along x and along z they cross, half over half, so one is a little lower)
  const ax = arms.filter(a => a[0]), az = arms.filter(a => a[1]), L = 0.5;
  if (ax.length) B.roundBox(ax.some(a => a[0] < 0) ? cx - L : cx - r - 0.06, H - 0.16, cz - 0.085, ax.some(a => a[0] > 0) ? cx + L : cx + r + 0.06, H, cz + 0.085, 0.012, { s: 0.7 });
  if (az.length) B.roundBox(cx - 0.083, H - 0.164, az.some(a => a[1] < 0) ? cz - L : cz - r - 0.06, cx + 0.083, H - 0.004, az.some(a => a[1] > 0) ? cz + L : cz + r + 0.06, 0.012, { s: 0.7 });
  // (the knee braces, pegged, at 45 degrees)
  for (const [dx, dz] of arms) {
    const b = [dz ? 1 : 0, 0, dx ? 1 : 0], n = [dx * Math.SQRT1_2, -Math.SQRT1_2, dz * Math.SQRT1_2], P = (u, y) => [cx + dx * u, y, cz + dz * u];
    const half = 0.045, at = (p, k) => [p[0] + n[0] * k, p[1] + n[1] * k, p[2] + n[2] * k];
    beamGeo(B, at(P(r - 0.02, H - 0.16 - 0.36), -half), at(P(0.44, H - 0.16 + 0.02), -half), b, n, 0.085, half * 2);
    const q = P(r + 0.001, H - 0.16 - 0.3), w = 0.016;
    F.box(q[0] - (dx ? 0.006 : w), q[1] - w, q[2] - (dz ? 0.006 : w), q[0] + (dx ? 0.006 : w), q[1] + w, q[2] + (dz ? 0.006 : w));
  }
  if (!arms.length) B.roundBox(cx - r - 0.025, H - 0.1, cz - r - 0.025, cx + r + 0.025, H, cz + r + 0.025, 0.02, { s: 0.7 });
}

// ---------- suelos ----------
// Bajo un muro o una puerta, el suelo solo cubre el lado de dentro (clip: [x0, x1, y0, y1] desde el centro)
export const FLOOR_H = 0.03;   // lo que levanta el suelo de tablas o de piedra (el camino, menos)
export function floorTile(scene, tx, ty, id, emit) {
  const clip = scene.floorClip?.(tx, ty) || [-0.5, 0.5, -0.5, 0.5], cx = tx + 0.5, cz = ty + 0.5;
  const key = id === 'suelo_piedra' ? 'floor_piedra' : id === 'camino' ? 'floor_camino' : 'floor_madera', h = id === 'camino' ? 0.02 : FLOOR_H;
  const B = emit(key, 'floor'), x0 = cx + clip[0], x1 = cx + clip[1], z0 = cz + clip[2], z1 = cz + clip[3];
  // (el suelo de tablas se mira con su textura a 2 m: doce hileras)
  const u = id === 'suelo_madera' ? 0.5 : 1;
  B.quad([x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0], [0, 1, 0], [[x0 * u, -z1 * u], [x1 * u, -z1 * u], [x1 * u, -z0 * u], [x0 * u, -z0 * u]]);
  // Cantos (por si se ve el borde)
  const E = emit(key, 'floor');
  E.box(x0, 0, z0, x1, h, z1, { skip: 'py ny' });
}

// ---------- tejados ----------
// Una región de tejado: casillas unidas con tejado. Altura de cada esquina según su distancia (métrica del
// máximo) al borde de la región, como en el juego: así sube a cuatro aguas desde el alero con las limas a 45°
export function roofRegion(scene, tiles, regionKey) {
  const pitch = roofPitch(scene, tiles), shape = roofShape(tiles, null, pitch), LV = ROOF.level * pitch, slab = pitch < 1;
  if (shape.gable) return gableRoof(scene, tiles, regionKey, shape);
  const M = baseMaterials(), set = new Set(tiles.map(([x, y]) => `${x},${y}`)), has = (x, y) => set.has(`${x},${y}`);
  const edges = [];
  for (const [x, y] of tiles) {
    if (!has(x, y - 1)) edges.push([x, y, x + 1, y]);
    if (!has(x, y + 1)) edges.push([x, y + 1, x + 1, y + 1]);
    if (!has(x - 1, y)) edges.push([x, y, x, y + 1]);
    if (!has(x + 1, y)) edges.push([x + 1, y, x + 1, y + 1]);
  }
  const dist = (px, py) => { let best = Infinity; for (const e of edges) { const d = Math.max(Math.max(e[0] - px, 0, px - e[2]), Math.max(e[1] - py, 0, py - e[3])); if (d < best) best = d; } return Math.min(best, ROOF.cap); };
  const memo = new Map(), H = (x, y) => { const k = `${x},${y}`; if (!memo.has(k)) memo.set(k, dist(x, y)); return memo.get(k); };
  // Las esquinas del borde salen hacia fuera (alero) y bajan con la pendiente
  const off = (vx, vy) => {
    let sx = 0, sy = 0;
    for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) if (!has(vx + dx, vy + dy)) { sx += dx + 0.5; sy += dy + 0.5; }
    const m = Math.max(Math.abs(sx), Math.abs(sy));
    return m ? [(sx / m) * ROOF.over, (sy / m) * ROOF.over] : [0, 0];
  };
  const byMat = new Map(), soffit = new Builder(), fascia = new Builder(), GR = glassRoof(scene, shape);
  const top = (x, z, lvl) => WALL_H + ROOF.thick + lvl * LV;
  const V = (vx, vy, lvl) => { const [ox, oy] = lvl === 0 ? off(vx, vy) : [0, 0], drop = lvl === 0 && (ox || oy) ? ROOF.over * LV : 0; return [vx + ox, top(0, 0, lvl) - drop, vy + oy]; };
  const chimneys = [];
  for (const [x, y] of tiles) {
    const raw = scene.at('roof', x, y);
    GR.infill(x, y, false);
    if (GlassRoof.is(raw)) { hipGlass(GR, x, y, V, H, top, has); continue; }
    const id = M.roofs[raw] ? raw : 'tejado_rojo', B = byMat.get(id) || byMat.set(id, new Builder()).get(id);
    wornTile(scene, x, y, B, soffit, fascia);
    const nw = V(x, y, H(x, y)), ne = V(x + 1, y, H(x + 1, y)), se = V(x + 1, y + 1, H(x + 1, y + 1)), sw = V(x, y + 1, H(x, y + 1)), c = [x + 0.5, top(0, 0, H(x + 0.5, y + 0.5)), y + 0.5];
    for (const tri of [[nw, ne, c], [ne, se, c], [se, sw, c], [sw, nw, c]]) {
      addRoofTri(B, tri);
      addRoofTri(soffit, tri.map(p => [p[0], p[1] - ROOF.thick, p[2]]), true);
    }
    // Canto del alero en los lados sin vecino
    for (const [a, b, open] of [[nw, ne, !has(x, y - 1)], [ne, se, !has(x + 1, y)], [se, sw, !has(x, y + 1)], [sw, nw, !has(x - 1, y)]]) {
      if (!open) continue;
      const a2 = [a[0], a[1] - ROOF.thick, a[2]], b2 = [b[0], b[1] - ROOF.thick, b[2]], mid = [(a[0] + b[0]) / 2 - (x + 0.5), 0, (a[2] + b[2]) / 2 - (y + 0.5)], l = Math.hypot(mid[0], mid[2]) || 1;
      fascia.quadN(a2, b2, b, a, [mid[0] / l, 0, mid[2] / l], [[0, 0], [1, 0], [1, 0.14], [0, 0.14]]);
    }
    const [under, rot] = parsePlaced(scene.at('placed', x, y) || '');
    if (under === 'chimenea') chimneys.push([x + 0.5, y + 0.5, top(0, 0, H(x + 0.5, y + 0.5)), rot]);
  }
  const g = new THREE.Group();
  for (const [id, B] of byMat) g.add(B.mesh(M.roofs[id]));
  if (!soffit.empty) g.add(soffit.mesh(slab ? placeMat('ashlarG') : M.soffit));
  if (!fascia.empty) g.add(fascia.mesh(slab ? placeMat('ashlarG') : M.roofEdge));
  GR.addTo(g, M.pane, M.paneIron);
  return addChimneys(g, chimneys, regionKey);
}
// The roof of a room of glass: its panes lie a little lower than tiles do
const GLASS_DROP = 0.1;
const glassRoof = (scene, shape, sink = 0) => new GlassRoof(scene, shape, ROOF.level, { wall: WALL_H, drop: ROOF.thick - GLASS_DROP + sink });
// A tile of it in a hipped roof: its four panes, a bar along each side and, where two slopes meet, along the hip
function hipGlass(GR, x, y, V, H, top, has) {
  const lo = p => [p[0], p[1] - GLASS_DROP, p[2]], c = lo([x + 0.5, top(0, 0, H(x + 0.5, y + 0.5)), y + 0.5]);
  const [nw, ne, se, sw] = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]].map(([i, j]) => lo(V(i, j, H(i, j))));
  const flat = Math.abs((nw[1] + se[1]) / 2 - c[1]) < 0.01 && Math.abs((ne[1] + sw[1]) / 2 - c[1]) < 0.01;
  if (flat) GR.face([nw, ne, se, sw]);
  else {
    for (const t of [[nw, ne, c], [ne, se, c], [se, sw, c], [sw, nw, c]]) GR.face(t);
    for (const [a, b] of [[nw, se], [ne, sw]]) if (Math.abs((a[1] + b[1]) / 2 - c[1]) < Math.abs((a === nw ? ne[1] + sw[1] : nw[1] + se[1]) / 2 - c[1]) || Math.abs(a[1] - b[1]) > 0.05) { GR.bar(a, c); GR.bar(c, b); }
  }
  GR.bar(nw, ne); GR.bar(nw, sw);
  if (!has(x + 1, y)) GR.bar(ne, se, 0.05, 0.06);
  if (!has(x, y + 1)) GR.bar(sw, se, 0.05, 0.06);
  if (!has(x - 1, y)) GR.bar(nw, sw, 0.05, 0.06);
  if (!has(x, y - 1)) GR.bar(nw, ne, 0.05, 0.06);
}
// How worn a tile of a roof is, in what is added of it from now on: its cover, its boards below and those of its edge
function wornTile(scene, x, y, B, soffit, fascia) {
  const w = LOOK[scene.wearAt ? scene.wearAt('roof', x, y) : 0];
  B.wear(w); soffit.wear(w); fascia.wear(w);
  return w;
}
// Chimeneas de piedra con su remate, hacia la espalda del hogar (el muro que tiene detrás)
function addChimneys(g, chimneys, regionKey) {
  const M = baseMaterials();
  const stacks = chimneys.map(([x, z, y, rot]) => { const [fx, fz] = front(rot); return [x - fx * 0.26, z - fz * 0.26, y, fx !== 0]; });
  for (const [x, z, y, across] of stacks) {
    // (a lo ancho del hogar w, hacia atrás d)
    const box = (B, w, d, y0, y1) => { const [hx, hz] = across ? [d, w] : [w, d]; B.box(x - hx, y0, z - hz, x + hx, y1, z + hz, { s: 0.6 }); };
    const B = new Builder(), S = new Builder();
    box(B, 0.36, 0.3, WALL_H, y + 1.0); box(B, 0.42, 0.36, y + 1.0, y + 1.12); box(S, 0.26, 0.22, y + 1.12, y + 1.13);
    g.add(B.mesh(M.stone), S.mesh(mat({ color: '#1e1a18' })));
  }
  g.userData = { regionKey, chimneys: stacks.map(([x, z, y]) => [x, y + 1.15, z]) };
  return g;
}
const G_EXT = { ashlarW: 'ashlarG' };   // (the gable is not tinted by vertex: the same stone, in its own material)
// A dos aguas (regiones rectangulares: ver world/roof.js). Todo se piensa en (u, v): u a lo largo de la
// cumbrera y v de alero a alero. Faldones con la teja en filas paralelas al alero; en los lados largos, alero que baja
// con la pendiente y su tabla; en los cortos, vuelo con su tabla; caballete en la cumbrera; y los hastiales (el muro
// triangular encima de cada muro corto), del material de ese muro y, en los de entramado, con su viga y su pendolón
export function gableRoof(scene, tiles, regionKey, S) {
  const M = baseMaterials(), byMat = new Map(), soffit = new Builder(), fascia = new Builder(), walls = new Map(), o = ROOF.over, pure = tiles.every(([x, y]) => GlassRoof.is(scene.at('roof', x, y))), GR = glassRoof(scene, S, pure ? -0.5 * ROOF.level * S.k : 0);
  const X = S.alongX, u0 = X ? S.x0 : S.y0, u1 = X ? S.x1 : S.y1, v0 = X ? S.y0 : S.x0, v1 = X ? S.y1 : S.x1;
  // (of stone slabs: low, thicker, and of stone under the eaves too, with its cornice)
  const slab = S.k < 1, LV = ROOF.level * S.k, TH = slab ? 0.2 : ROOF.thick, OV = slab ? 0.4 : o;
  const lvl = v => Math.max(0, Math.min(v - v0, v1 - v, ROOF_CAP)), top = v => WALL_H + TH + lvl(v) * LV;
  const P = (u, y, v) => (X ? [u, y, v] : [v, y, u]), N = (nu, nv) => (X ? [nu, 0, nv] : [nv, 0, nu]);
  const V = (u, v) => { const eu = u === u0 ? -OV : u === u1 ? OV : 0, ev = v === v0 ? -OV : v === v1 ? OV : 0; return P(u + eu, top(v) - (ev ? OV * LV : 0), v + ev); };
  const down = p => [p[0], p[1] - TH, p[2]];
  // (the glass: all of glass, from wall to wall, its eaves on them; else as the tiles, with their eaves)
  const GB = pure ? [u0 + 0.5, u1 - 0.5, v0 + 0.5, v1 - 0.5] : [u0, u1, v0, v1], sink = pure ? 0.5 * LV : 0;
  const GA = (u, v) => { if (!pure) { const p = V(u, v); p[1] -= GLASS_DROP; return p; } return P(u, top(v) - sink - GLASS_DROP, v); };
  const chimneys = [], count = new Map();
  const gables = [];   // (the wall each stands on, and how worn it is drawn)
  let all = 0;   // (how worn its tiles are, all together: the ridge, like most of them)
  for (const [x, y] of tiles) {
    const raw = scene.at('roof', x, y), tu = X ? x : y, tv = X ? y : x;
    if (GlassRoof.is(raw)) { count.set(raw, (count.get(raw) || 0) + 1); gableGlass(GR, GA, tu, tv, ...GB, (v0 + v1) / 2); GR.infill(x, y, false); continue; }
    const id = M.roofs[raw] ? raw : 'tejado_rojo', B = byMat.get(id) || byMat.set(id, new Builder()).get(id);
    GR.infill(x, y, false);
    all += wornTile(scene, x, y, B, soffit, fascia);
    count.set(id, (count.get(id) || 0) + 1);
    for (const va of [tv, tv + 0.5]) {
      const vb = va + 0.5, a = V(tu, va), b = V(tu + 1, va), c = V(tu + 1, vb), d = V(tu, vb);
      for (const tri of [[a, b, c], [a, c, d]]) { addRoofTri(B, tri); addRoofTri(soffit, tri.map(down), true); }
      // Tabla del vuelo en los lados cortos
      for (const [u, s] of [[u0, -1], [u1, 1]]) if ((s < 0 ? tu : tu + 1) === u) { const p = V(u, va), q = V(u, vb); fascia.quadN(down(p), down(q), q, p, N(s, 0), [[0, 0], [0.5, 0], [0.5, 0.14], [0, 0.14]]); }
    }
    // Tabla del alero en los lados largos
    for (const [v, s] of [[v0, -1], [v1, 1]]) if ((s < 0 ? tv : tv + 1) === v) { const p = V(tu, v), q = V(tu + 1, v); fascia.quadN(down(p), down(q), q, p, N(0, s), [[0, 0], [1, 0], [1, 0.14], [0, 0.14]]); }
    const [under, rot] = parsePlaced(scene.at('placed', x, y) || '');
    if (under === 'chimenea') chimneys.push([x + 0.5, y + 0.5, top(tv + 0.5), rot]);
  }
  // Caballete: una hilera de tejas a lo largo de la cumbrera (si no la corta lo plano de las casas muy anchas)
  const mid = (v0 + v1) / 2, main = [...count].sort((p, q) => q[1] - p[1])[0][0];
  if (lvl(mid) < ROOF_CAP && GlassRoof.is(main)) GR.bar(GA(GB[0] - (pure ? 0 : OV), mid).map((q, i) => q + (i === 1 ? 0.05 : 0)), GA(GB[1] + (pure ? 0 : OV), mid).map((q, i) => q + (i === 1 ? 0.05 : 0)), 0.1, 0.06);
  else if (lvl(mid) < ROOF_CAP) { const ridge = byMat.get(main).wear(all / tiles.length), y = top(mid), [a, b] = [P(u0 - OV, y - 0.03, mid - 0.13), P(u1 + OV, y + (slab ? 0.06 : 0.09), mid + 0.13)]; ridge.box(Math.min(a[0], b[0]), a[1], Math.min(a[2], b[2]), Math.max(a[0], b[0]), b[1], Math.max(a[2], b[2]), { skip: 'ny' }); }
  // Hastiales, encima de los muros cortos (a media casilla del borde, por su centro), de alero a alero
  const wall = key => walls.get(key) || walls.set(key, new Builder()).get(key);
  for (const [uc, s] of [[u0 + 0.5, -1], [u1 - 0.5, 1]]) {
    let at = X ? scene.at('placed', Math.floor(uc), Math.floor(mid)) : scene.at('placed', Math.floor(mid), Math.floor(uc)), wx = Math.floor(X ? uc : mid), wy = Math.floor(X ? mid : uc);
    if (!at) for (let k = 1; k < 4 && !at; k++) { const v = Math.floor(mid) - k, q = X ? scene.at('placed', Math.floor(uc), v) : scene.at('placed', v, Math.floor(uc)); if (q === 'stone_column') { at = q; if (X) wy = v; else wx = v; } }   // (a portico: over its columns)
    let id = at === 'stone_column' ? 'ashlar_wall' : at && parsePlaced(at)[0];
    if (at && !EXTERIOR[id]) for (const d of [1, -1, 2, -2]) { const v = Math.floor(mid) + d, q = X ? scene.at('placed', Math.floor(uc), v) : scene.at('placed', v, Math.floor(uc)); if (q === 'ashlar_wall' || q === 'limewash_wall') { id = q; break; } }   // (a door or a window in the middle of one of those walls)
    // (over a glass wall, panes: every piece of that end, its doors too; a glass roof that goes out past its walls has no gable)
    if (!at && GlassRoof.is(X ? scene.at('roof', Math.floor(uc), Math.floor(mid)) : scene.at('roof', Math.floor(mid), Math.floor(uc)))) continue;
    if (isGlass(id)) { for (let v = v0; v < v1; v++) { const gx = X ? Math.floor(uc) : v, gy = X ? v : Math.floor(uc); if (scene.at('placed', gx, gy) !== 'glass_wall') GR.infill(gx, gy, true); } continue; }
    const ext = G_EXT[EXTERIOR[id]] || EXTERIOR[id] || 'plaster', inner = G_EXT[INNER[id]] || 'plaster', a = v0 + 0.5, b = v1 - 0.5, stage = scene.wearAt ? scene.wearAt('placed', wx, wy) : 0, W = LOOK[stage];
    gables.push([wx, wy, stage]);
    const under = v => top(v) - TH, face = (key, uf, n) => { const B = wall(key); for (let v = a; v < b - 1e-6; v += 0.5) { const w = Math.min(b, v + 0.5); B.quadN(P(uf, WALL_H, v), P(uf, WALL_H, w), P(uf, under(w), w), P(uf, under(v), v), N(n, 0), [[v, WALL_H], [w, WALL_H], [w, under(w)], [v, under(v)]]); } };
    wall(ext).wear(W); face(ext, uc + s * T, s); wall(inner).wear(W * INSIDE); face(inner, uc - s * T, -s); wall(ext).wear(W);
    // (los cantos de los extremos, junto al alero)
    for (const [v, n] of [[a, -1], [b, 1]]) wall(ext).quadN(P(uc - T, WALL_H, v), P(uc + T, WALL_H, v), P(uc + T, under(v), v), P(uc - T, under(v), v), N(0, n), [[0, 0], [0.24, 0], [0.24, under(v) - WALL_H], [0, under(v) - WALL_H]]);
    if (framed(id || 'muro_entramado') && ext === 'plaster') {
      // Viga de atado abajo y pendolón hasta la cumbrera, por fuera
      const k = uc + s * (T + 0.04), B = wall('timber').wear(W), lo = Math.min(uc + s * T, k), hi = Math.max(uc + s * T, k);
      const box3 = (pa, pb) => B.box(Math.min(pa[0], pb[0]), Math.min(pa[1], pb[1]), Math.min(pa[2], pb[2]), Math.max(pa[0], pb[0]), Math.max(pa[1], pb[1]), Math.max(pa[2], pb[2]));
      box3(P(lo, WALL_H, a), P(hi, WALL_H + 0.14, b));
      box3(P(lo, WALL_H + 0.14, mid - 0.07), P(hi, under(mid) - 0.02, mid + 0.07));
    }
  }
  const g = new THREE.Group();
  for (const [id, B] of byMat) g.add(B.mesh(M.roofs[id]));
  if (slab) {
    // The cornice: a moulding under the eaves, all along the long sides, over the wall or the columns' entablature
    for (const [v, s] of [[v0, 1], [v1, -1]]) { const a = P(u0 - 0.06, WALL_H - 0.02, v - s * OV * 0.45), b = P(u1 + 0.06, WALL_H + 0.16, v + s * 0.62); fascia.box(Math.min(a[0], b[0]), a[1], Math.min(a[2], b[2]), Math.max(a[0], b[0]), b[1], Math.max(a[2], b[2])); }
  }
  if (!soffit.empty) g.add(soffit.mesh(slab ? placeMat('ashlarG') : M.soffit));
  if (!fascia.empty) g.add(fascia.mesh(slab ? placeMat('ashlarG') : M.roofEdge));
  GR.addTo(g, M.pane, M.paneIron);
  for (const [key, B] of walls) if (!B.empty) g.add(B.mesh(M[key] || placeMat(key)));
  addChimneys(g, chimneys, regionKey).userData.gables = gables;
  return g;
}

// A tile of a glass roof of two slopes: its panes (half a tile wide), the bars between them up the slope, a purlin across and,
// at its edges, the gutter and the last bar. Where the ridge runs through the middle of the tile, half and half. at(u, v): the
// point of the glass; [U0, U1] × [V0, V1]: how far it goes (a roof all of glass ends on its walls, half a tile in: no eaves)
function gableGlass(GR, at, tu, tv, U0, U1, V0, V1, ridge) {
  const ua = Math.max(tu, U0), ub = Math.min(tu + 1, U1), va = Math.max(tv, V0), vb = Math.min(tv + 1, V1);
  if (ua >= ub - 1e-6 || va >= vb - 1e-6) return;
  const vs = ridge > va + 1e-6 && ridge < vb - 1e-6 ? [va, ridge, vb] : [va, vb], um = (ua + ub) / 2;
  for (let i = 0; i + 1 < vs.length; i++) {
    const a = at(ua, vs[i]), b = at(ub, vs[i]), c = at(ub, vs[i + 1]), d = at(ua, vs[i + 1]), m0 = at(um, vs[i]), m1 = at(um, vs[i + 1]);
    GR.face([a, m0, m1, d]); GR.face([m0, b, c, m1]);
    GR.bar(a, d); GR.bar(m0, m1, 0.016, 0.03);
    if (ub === U1) GR.bar(b, c, 0.04, 0.05);
    if (ua === U0) GR.bar(a, d, 0.04, 0.05);
    if (vs[i] === V0) GR.bar(a, b, 0.07, 0.07); else if (vs[i] === tv) GR.bar(a, b, 0.016, 0.03);
    if (vs[i + 1] === V1) GR.bar(d, c, 0.07, 0.07);
  }
}

// Un triángulo del tejado, con las tejas en filas paralelas al alero (u a lo largo, v cuesta arriba). Por
// encima mira hacia arriba; la cara de abajo (under), hacia abajo
function addRoofTri(B, [a, b, c], under = false) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  const nl = Math.hypot(...n) || 1; n = n.map(v => v / nl);
  // Con este orden la cara mira hacia n: si no es hacia donde toca, se da la vuelta
  if ((n[1] >= 0) === under) { [b, c] = [c, b]; n = n.map(v => -v); }
  // Cuesta arriba: la dirección en planta en la que sube la cara de arriba
  const up = under ? n.map(v => -v) : n;
  let gx = -up[0], gz = -up[2];
  const gl = Math.hypot(gx, gz);
  if (gl < 1e-4) { gx = 0; gz = 1; } else { gx /= gl; gz /= gl; }
  const slope = Math.hypot(1, ROOF.level);
  const uv = p => [p[0] * -gz + p[2] * gx, (p[0] * gx + p[2] * gz) * slope];
  B.tri(a, b, c, n, [uv(a), uv(b), uv(c)]);
}

// Paisaje para los cuadros
export { FLOWER };
