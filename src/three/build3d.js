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
import { Builder, mat } from './geo.js';
import { plaster, planks, roofTiles, stone, wood, siding, flagstone, gravel, thatch, artwork } from './textures.js';
import { PIECES, parsePlaced } from '../pieces.js';
import { front } from '../art/stations.js';

export const WALL_H = 2.8;
export const T = 0.12;
const PLINTH = 0.42;
const WIN = { half: 0.3, y0: 1.0, y1: 1.95 };
const DOOR = { half: 0.42, y1: 2.05 };
const BEAM = { post: 0.04, rail: 0.034, brace: 0.028 };
export const ROOF = { level: 0.62, cap: 6, thick: 0.14, over: 0.32 };
export const ROOF_COLORS = { tejado_rojo: '#c95a3c', tejado_azul: '#4a6aa8', tejado_gris: '#6a6e78', tejado_verde: '#4a8a5a' };

// Materiales base (los muros de una casa los clonan para poder desvanecerlos)
let BASE;
export function baseMaterials() {
  if (BASE) return BASE;
  const roofs = {};
  for (const [id, c] of Object.entries(ROOF_COLORS)) roofs[id] = mat({ map: roofTiles(c), roughness: 0.75 });
  roofs.tejado_paja = mat({ map: thatch(), roughness: 1 });
  BASE = {
    plaster: mat({ map: plaster() }), stone: mat({ map: stone() }), wallStone: mat({ map: stone('#b0a898') }), siding: mat({ map: siding() }),
    timber: mat({ map: wood('#5e3b22'), roughness: 0.8 }), frame: mat({ map: wood('#4a2e1a'), roughness: 0.7 }), shutter: mat({ map: wood('#3f7a44') }), door: mat({ map: wood('#9a6438') }),
    glass: new THREE.MeshStandardMaterial({ color: '#a8d4f0', roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.4, depthWrite: false, emissive: '#ffb050', emissiveIntensity: 0 }),
    box: mat({ color: '#7a4a2a' }), soil: mat({ color: '#4a3020' }), leaves: mat({ color: '#3f8a32', flatShading: true }), bloom: mat({ roughness: 0.6 }),
    painting: mat({ map: artwork('valle') }), floor_madera: mat({ map: planks(), roughness: 0.6 }), floor_piedra: mat({ map: flagstone(), roughness: 0.85 }), floor_camino: mat({ map: gravel(), roughness: 1 }),
    fence: mat({ map: wood('#9a6a40') }), fenceStone: mat({ map: stone('#9a948a') }), roofs, roofEdge: mat({ map: wood('#4a2e1a') }), soffit: mat({ map: planks(), color: '#d8c8b0' }),
  };
  return BASE;
}
const FLOWER = new THREE.IcosahedronGeometry(1, 0), BLOOMS = ['#ff6a8a', '#ffe04a', '#ffffff', '#ff9ab8', '#b48aff'];

// ---------- muros ----------
const isWall = p => p?.kind === 'wall' || p?.kind === 'door';
// Lado de fuera de un tramo de muro en la casilla (tx, ty) que va a lo largo de x (X) o de y: n, s, e, w; 'in'
// si hay casa a los dos lados (tabique) y 'free' si a ninguno (un muro suelto)
export function outward(scene, tx, ty, X) {
  const inside = (x, y) => !!scene.at('floor', x, y) || (scene.roofAt(x, y) && !isWall(scene.pieceAt(x, y)));
  const a = X ? inside(tx, ty - 1) : inside(tx - 1, ty), b = X ? inside(tx, ty + 1) : inside(tx + 1, ty);
  if (a && b) return 'in';
  if (!a && !b) return 'free';
  return X ? (a ? 's' : 'n') : (a ? 'e' : 'w');
}
// Juntas con los vecinos: 1 +x, 2 -x, 4 +y, 8 -y
export const wallMask = (scene, tx, ty) => (isWall(scene.pieceAt(tx + 1, ty)) ? 1 : 0) | (isWall(scene.pieceAt(tx - 1, ty)) ? 2 : 0) | (isWall(scene.pieceAt(tx, ty + 1)) ? 4 : 0) | (isWall(scene.pieceAt(tx, ty - 1)) ? 8 : 0);
const EXTERIOR = { muro_madera: 'siding', muro_piedra: 'wallStone' };   // los demás son de yeso con entramado
const framed = id => !EXTERIOR[id];

// emit(materialKey, side) → Builder en el que añadir esa parte
export function wallTile(scene, tx, ty, id, emit, extras) {
  const mask = wallMask(scene, tx, ty), cx = tx + 0.5, cz = ty + 0.5;
  const xArms = [mask & 1 ? 1 : 0, mask & 2 ? -1 : 0].filter(Boolean), zArms = [mask & 4 ? 1 : 0, mask & 8 ? -1 : 0].filter(Boolean);
  // Sin vecinos: un tramo entero a lo largo de x. Recto: un tramo entero, con su hueco si es ventana
  const straightX = !zArms.length, straightZ = !xArms.length && zArms.length;
  const window = id.startsWith('ventana') && (straightX || straightZ) ? { half: WIN.half, y0: WIN.y0, y1: WIN.y1, shutters: id === 'ventana_contraventanas', closed: !!scene.doorClosed?.(tx, ty) } : null;
  if (straightX || straightZ) {
    const X = !!straightX, side = outward(scene, tx, ty, X), c = X ? cz : cx, u0 = X ? tx : ty;
    const ends = X ? [!(mask & 2), !(mask & 1)] : [!(mask & 8), !(mask & 4)];
    run(emit, extras, { id, X, c, side, a: u0, b: u0 + 1, holes: window ? [{ u: u0 + 0.5, ...window }] : [], ends, painting: id === 'muro_cuadro' ? u0 + 0.5 : null, tile: [tx, ty] });
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
  const ext = EXTERIOR[id] || 'plaster', faceMat = dir => {
    const outX = sideX === 'n' ? -1 : sideX === 's' ? 1 : 0, outZ = sideZ === 'w' ? -1 : sideZ === 'e' ? 1 : 0;
    if (dir === 'pz' || dir === 'nz') return (dir === 'pz' ? 1 : -1) === outX || (sideX === 'free') ? ext : 'plaster';
    return (dir === 'px' ? 1 : -1) === outZ || sideZ === 'free' ? ext : 'plaster';
  };
  for (const f of ['px', 'nx', 'pz', 'nz']) emit(faceMat(f), side).box(cx - T, 0, cz - T, cx + T, WALL_H, cz + T, { skip: ['px', 'nx', 'py', 'ny', 'pz', 'nz'].filter(k => k !== f).join(' ') });
  emit('frame', side).box(cx - T, WALL_H - 0.02, cz - T, cx + T, WALL_H, cz + T, { skip: 'ny px nx pz nz' });
  // Rodapié en las caras del poste que dan a la casa sin brazo delante: el lado liso de un muro en T (si no,
  // queda cortado) y, en un rincón saliente, las dos (la de lo largo de x tapa la esquina)
  const open = { px: !(mask & 1), nx: !(mask & 2), pz: !(mask & 4), nz: !(mask & 8) }, R = 0.02;
  const skirt = f => open[f] && faceMat(f) === 'plaster', sk = emit('frame', side);
  for (const [f, z0, z1] of [['pz', cz + T, cz + T + R], ['nz', cz - T - R, cz - T]]) if (skirt(f)) sk.box(cx - T - (skirt('nx') ? R : 0), 0, z0, cx + T + (skirt('px') ? R : 0), 0.12, z1);
  for (const [f, x0, x1] of [['px', cx + T, cx + T + R], ['nx', cx - T - R, cx - T]]) if (skirt(f)) sk.box(x0, 0, cz - T, x1, 0.12, cz + T);
  // Poste de esquina y zócalo por fuera, en la esquina de fuera de un muro en L
  if (xArms.length === 1 && zArms.length === 1 && sideX !== 'in' && sideZ !== 'in') {
    const ox = -xArms[0], oz = -zArms[0];   // la esquina de fuera queda hacia donde no van los brazos
    const xr = ox > 0 ? [cx - T, cx + T + 0.05] : [cx - T - 0.05, cx + T], zr = oz > 0 ? [cz - T, cz + T + 0.05] : [cz - T - 0.05, cz + T];
    emit('stone', side).box(xr[0], 0, zr[0], xr[1], PLINTH, zr[1]);
    if (framed(id)) emit('timber', side).box(ox > 0 ? cx - T : cx - T - BEAM.post, PLINTH, oz > 0 ? cz - T : cz - T - BEAM.post, ox > 0 ? cx + T + BEAM.post : cx + T, WALL_H, oz > 0 ? cz + T + BEAM.post : cz + T);
  }
}

// Un tramo recto de muro dentro de una casilla, de a hasta b a lo largo de su eje, con sus huecos
function run(emit, extras, { id, X, c, side, a, b, holes, ends, painting, half }) {
  // Punto y caja en coordenadas del tramo: u a lo largo, k hacia el lado "más" (+z si X, +x si no)
  const P = (u, y, k = 0) => (X ? [u, y, c + k] : [c + k, y, u]);
  const box = (key, u0, u1, y0, y1, k0, k1, skip = '') => { const B = emit(key, side), a0 = Math.min(u0, u1), a1 = Math.max(u0, u1), c0 = c + Math.min(k0, k1), c1 = c + Math.max(k0, k1); if (X) B.box(a0, y0, c0, a1, y1, c1, { skip }); else B.box(c0, y0, a0, c1, y1, a1, { skip: swapSkip(skip) }); };
  const outSign = side === 's' || side === 'e' ? 1 : side === 'n' || side === 'w' ? -1 : 0;
  const ext = EXTERIOR[id] || 'plaster';
  const matPlus = side === 'in' ? 'plaster' : side === 'free' ? ext : outSign > 0 ? ext : 'plaster';
  const matMinus = side === 'in' ? 'plaster' : side === 'free' ? ext : outSign < 0 ? ext : 'plaster';
  // El muro: tramos enteros entre huecos y encima y debajo de cada hueco. Cada cara de su material
  const slab = (u0, u1, y0, y1, endA, endB) => {
    box(matPlus, u0, u1, y0, y1, -T, T, 'px nx py ny nz');
    box(matMinus, u0, u1, y0, y1, -T, T, 'px nx py ny pz');
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
    const inner = side === 'in' || (side !== 'free' && s !== outSign);
    const k0 = s * T, dir = s;
    if (inner) { cutRun(a, b, holes.filter(h => h.door), (u0, u1) => box('frame', u0, u1, 0, 0.12, k0, k0 + dir * 0.02)); continue; }
    if (side === 'in') continue;
    cutRun(a, b, holes.filter(h => h.door), (u0, u1) => box('stone', u0, u1, 0, PLINTH, k0, k0 + dir * 0.05));
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
      box('frame', h0 - 0.07, h0, h.y0, h.y1 + 0.07, k, k + o * 0.05);
      box('frame', h1, h1 + 0.07, h.y0, h.y1 + 0.07, k, k + o * 0.05);
      box('frame', h0, h1, h.y1, h.y1 + 0.07, k, k + o * 0.05);
    }
    box('glass', h0, h1, h.y0, h.y1, -0.008, 0.008);
    box('frame', h.u - 0.022, h.u + 0.022, h.y0, h.y1, -0.03, 0.03);
    box('frame', h0, h1, (h.y0 + h.y1) / 2 - 0.022, (h.y0 + h.y1) / 2 + 0.022, -0.03, 0.03);
    box('frame', h0 - 0.1, h1 + 0.1, h.y0 - 0.06, h.y0, -T - 0.08, T + 0.08);
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
        box('shutter', a0, a1, h.y0 - 0.02, h.y1 + 0.04, k + outSign * 0.05, k + outSign * 0.085);
        for (let y = h.y0 + 0.1; y < h.y1; y += 0.19) box('frame', a0 + 0.03, a1 - 0.03, y, y + 0.035, k + outSign * 0.085, k + outSign * 0.1);
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
  const solid = (x, y) => { const p = scene.pieceAt(x, y); return p && p.kind !== 'fence' && p.kind !== 'gate'; };
  const X = solid(tx - 1, ty) || solid(tx + 1, ty) || !(solid(tx, ty - 1) || solid(tx, ty + 1));
  const sideIds = X ? [scene.at('placed', tx - 1, ty), scene.at('placed', tx + 1, ty)] : [scene.at('placed', tx, ty - 1), scene.at('placed', tx, ty + 1)];
  const next = sideIds.map(v => v && parsePlaced(v)[0]).find(n => PIECES[n]?.kind === 'wall') || 'muro_madera';
  const id = next.startsWith('ventana') || next === 'muro_cuadro' ? 'muro_entramado' : next;
  const side = outward(scene, tx, ty, X), cx = tx + 0.5, cz = ty + 0.5, u0 = X ? tx : ty, c = X ? cz : cx;
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
  const lw = d.width, leaf = new Builder(), bars = new Builder();
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
  const f = (x, y) => ['fence', 'gate', 'wall'].includes(scene.pieceAt(x, y)?.kind);
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
  const w = d.width, B = new Builder(), g = new THREE.Group();
  for (const y of [0.26, 0.5, 0.74]) B.box(0, y, -0.035, w, y + 0.09, 0.035, { s: 0.5 });
  for (const x of [0.02, w - 0.09]) B.box(x, 0.18, -0.045, x + 0.07, 0.92, 0.045, { s: 0.5 });
  g.position.set(...d.hinge);
  g.add(B.mesh(mats.fence));
  const along = d.X ? [1, 0] : [0, 1], out = d.X ? [0, d.swing] : [d.swing, 0], beta = 1.75;
  g.userData.setAngle = a => { const b = beta * a, dx = along[0] * Math.cos(b) + out[0] * Math.sin(b), dz = along[1] * Math.cos(b) + out[1] * Math.sin(b); g.rotation.y = Math.atan2(-dz, dx); };
  return g;
}
export function fenceTile(scene, tx, ty, id, emit) {
  const f = (x, y) => ['fence', 'gate', 'wall'].includes(scene.pieceAt(x, y)?.kind);
  const cx = tx + 0.5, cz = ty + 0.5, arms = [[f(tx + 1, ty), 1, 0], [f(tx - 1, ty), -1, 0], [f(tx, ty + 1), 0, 1], [f(tx, ty - 1), 0, -1]].filter(a => a[0]);
  const seg = (dx, dz, fn) => { const x0 = Math.min(cx, cx + dx * 0.5), x1 = Math.max(cx, cx + dx * 0.5), z0 = Math.min(cz, cz + dz * 0.5), z1 = Math.max(cz, cz + dz * 0.5); fn(x0, x1, z0, z1); };
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
  const byMat = new Map(), soffit = new Builder(), fascia = new Builder();
  const top = (x, z, lvl) => WALL_H + ROOF.thick + lvl * ROOF.level;
  const V = (vx, vy, lvl) => { const [ox, oy] = lvl === 0 ? off(vx, vy) : [0, 0], drop = lvl === 0 && (ox || oy) ? ROOF.over * ROOF.level : 0; return [vx + ox, top(0, 0, lvl) - drop, vy + oy]; };
  const chimneys = [];
  for (const [x, y] of tiles) {
    const raw = scene.at('roof', x, y), id = M.roofs[raw] ? raw : 'tejado_rojo', B = byMat.get(id) || byMat.set(id, new Builder()).get(id);
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
  g.add(soffit.mesh(M.soffit), fascia.mesh(M.roofEdge));
  // Chimeneas de piedra con su remate, hacia la espalda del hogar (el muro que tiene detrás)
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
