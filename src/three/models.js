// Modelos en 3D de lo que se coloca y de lo que hay en el mundo: estaciones de trabajo (banco, horno, yunque,
// telar, cocina), muebles (cama, mesa, sillas, estanterías, lámparas, cofres, alfombras, macetas, vitrinas),
// cosas del rancho y del huerto (gallinero, establo, colmena, comedero, aspersor, cultivos en cada fase), el
// hogar con chimenea, las cosas del pueblo (puestos, tablón, fuente, muelle, buzón, farola
// y cartel), los lugares que se descubren (campamento, torre, barco hundido, templo, altar, cueva,
// faro) y los cofres del tesoro.
//
// Cada modelo se hace una vez, en coordenadas locales (el suelo en y = 0, el centro de su casilla en el origen
// y el frente mirando a +z), con sus piezas agrupadas por material para juntarlas luego con las del resto del
// trozo en unas pocas mallas. Lo que no se junta (fuego, cristal, agua) va aparte, igual que sus luces.
import * as THREE from 'three';
import { flowerBunch } from './flowers3d.js';
import { Builder, mat, rockGeo, snowCap } from './geo.js';
import { wood as wood0, stone as stone0, rockFace, rng, rug, rugDesign, notes, awning, planks, furrows, artwork, bark } from './textures.js';
import { animalModel } from './animals.js';
import { apagado } from '../arte.js';
import { fountain, FOUNT_MATS } from './fountain3d.js';
import { mailbox, MAIL_MATS } from './mailbox3d.js';
import { pew } from './chapel3d.js';
import { tintOf } from './tints.js';
import { compostBin, manureHeap, troughFill, soilBits } from './soil3d.js';

// Las cajas de los modelos con los cantos biselados, según su material: redondeadas en lo blando (mantas, sábanas,
// cojines, cuero), con el canto gastado en la madera y un poco en la piedra
const BEVEL = Object.assign(
  Object.fromEntries(['quilt', 'quiltB', 'quiltK', 'quiltK2', 'pillowK', 'sheet', 'cloth', 'sofa', 'sofaB', 'leather', 'leatherD', 'baby'].map(k => [k, 0.04])),
  Object.fromEntries(['wood', 'dark', 'light', 'plank', 'hull'].map(k => [k, 0.012])),
  Object.fromEntries(['stone', 'brick', 'temple', 'templeD', 'rock', 'marble', 'marbleD'].map(k => [k, 0.018])),
  { ashlar: 0.035 },
);
import { CROPS, ITEMS } from '../items.js';
import { BULKY } from '../carry-items.js';
import * as CARRY from '../carry-items.js';   // (BARROW: read as a namespace, so this file loads before the logic has it)
import { WALL_H, FLOOR_H } from './build3d.js';
import { SOLIDS, hull } from '../world/fit.js';
import { TOWER, inHole, GALLERY, WATCHTOWERS, SIDE } from '../world/tower.js';

// ---------- materiales ----------
let MATS;
export function modelMats() {
  if (MATS) return MATS;
  // (todos los colores apagados, para que no chillen sobre el mundo sobrio: ver apagado() en arte.js; lo que brilla, no)
  const c = (color, o = {}) => mat({ color: apagado(color), ...o }), wood = b => wood0(apagado(b)), stone = (b, photo) => stone0(apagado(b), photo);
  MATS = {
    wood: mat({ map: wood('#8a5a34'), roughness: 0.7 }), dark: mat({ map: wood('#5e3b22'), roughness: 0.7 }), light: mat({ map: wood('#b88454'), roughness: 0.7 }),
    plank: mat({ map: planks(), roughness: 0.75, color: '#d2c6b6' }), stone: mat({ map: stone('#9a948a') }), brick: mat({ map: stone('#b0705a') }), soot: c('#2a2220', { roughness: 1 }),
    sheet: c('#f4efe6', { roughness: 0.95 }), quilt: c('#d0574a', { roughness: 0.95 }), quiltB: c('#f0c25a', { roughness: 0.95 }), cloth: c('#e8e0d0', { roughness: 0.95 }),
    pot: c('#b8643c', { roughness: 0.8 }), soil: c('#4a3020'), leaf: c('#4f9a3a', { flatShading: true }), leafD: c('#3f7a2e', { flatShading: true }),
    rug: mat({ map: rug(), roughness: 1 }), brass: c('#c89a48', { metalness: 0.7, roughness: 0.35 }), iron: c('#3a3634', { metalness: 0.55, roughness: 0.45 }), steel: c('#8a929a', { metalness: 0.7, roughness: 0.3 }),
    gold: c('#f0c840', { metalness: 0.8, roughness: 0.25 }), copper: c('#c8743a', { metalness: 0.6, roughness: 0.4 }),
    candle: c('#fff4dc', { roughness: 0.8 }), shade: c('#f4dca0', { emissive: '#ffb860', emissiveIntensity: 0.6, roughness: 0.9, side: THREE.DoubleSide }),
    books: ['#a83a32', '#3a5aa0', '#3f8a44', '#d8a83a', '#7a4aa0', '#e0e0d0'].map(x => c(x, { roughness: 0.8 })),
    red: c('#c83a32'), white: c('#f0ece4'), straw: c('#e0c060', { roughness: 1 }), hay: c('#d8b860', { roughness: 1 }), rope: c('#c8a870'),
    notes: mat({ map: notes() }), awning: mat({ map: awning('#a8483e', '#e0d8c8'), side: THREE.DoubleSide }), awningB: c('#3a6ab8', { side: THREE.DoubleSide }), awningG: c('#4a9a4a', { side: THREE.DoubleSide }),
    water: new THREE.MeshStandardMaterial({ color: '#47666a', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.8 }),
    glass: new THREE.MeshStandardMaterial({ color: '#8a9aa0', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.3, depthWrite: false }),
    glow: new THREE.MeshBasicMaterial({ color: '#ff9a3a' }), ember: c('#ff6a20', { emissive: '#ff4a10', emissiveIntensity: 1.2 }),
    sand: c('#d8c08a', { roughness: 1 }), moss: c('#5a7a3a', { flatShading: true }), dirt: mat({ map: furrows(), roughness: 1 }),
    canvas: c('#d8c8a0', { side: THREE.DoubleSide, roughness: 1 }), tentStripe: c('#a8442a', { side: THREE.DoubleSide }), lamp: c('#fff2c0', { emissive: '#ffd070', emissiveIntensity: 1.5 }),
    hull: mat({ map: wood('#6a4a30'), roughness: 0.9 }), temple: mat({ map: stone('#c8bca0') }), templeD: mat({ map: stone('#8a8070') }), crystal: c('#7ae0ff', { emissive: '#3ab0ff', emissiveIntensity: 0.8, roughness: 0.1 }), amethyst: c('#a860e8', { emissive: '#6a20c0', emissiveIntensity: 0.7, roughness: 0.15 }),
    snow: c('#f4f8fc', { roughness: 0.85 }), rock: mat({ map: stone('#8a857c', 'roca'), flatShading: true }), dark0: c('#0a0806', { roughness: 1 }), stripeR: c('#c83a32'), lens: c('#fff6c8', { emissive: '#ffe080', emissiveIntensity: 2 }),
    bee: c('#e8c040'), sofa: c('#3f6a5a', { roughness: 0.95 }), sofaB: c('#5a8a74', { roughness: 0.95 }), leather: c('#8a5a34', { roughness: 0.85 }), leatherD: c('#5e3b22', { roughness: 0.85 }),
    porcelain: c('#f4f2ee', { roughness: 0.22 }), quiltK: c('#5a9ad8', { roughness: 0.95 }), quiltK2: c('#e88aa8', { roughness: 0.95 }), pillowK: c('#f4d86a', { roughness: 0.95 }),
    rug_persa: mat({ map: rugDesign('persa'), roughness: 1 }), rug_rayas: mat({ map: rugDesign('rayas'), roughness: 1 }), rug_rombos: mat({ map: rugDesign('rombos'), roughness: 1 }),
    rug_trenzada: mat({ map: rugDesign('trenzada'), roughness: 1, alphaTest: 0.5 }),
    art_valle: mat({ map: artwork('valle'), roughness: 0.9 }), art_mar: mat({ map: artwork('mar'), roughness: 0.9 }), art_flores: mat({ map: artwork('flores'), roughness: 0.9 }), art_noche: mat({ map: artwork('noche'), roughness: 0.9 }),
    // La piedra de los lugares, sin sillares pintados: cada sillar es una pieza
    ashlar: mat({ map: rockFace(apagado('#b4ab9a')), roughness: 0.92 }), marble: mat({ map: rockFace(apagado('#d2c8b0')), roughness: 0.75 }), marbleD: mat({ map: rockFace(apagado('#9a907e')), roughness: 0.85 }),
    crag: mat({ map: rockFace(apagado('#8e887e')), flatShading: true, roughness: 0.95 }), snowcap: snowCap({ flatShading: true }),
    towerWall: towerCut(mat({ map: stone('#a8a090'), roughness: 0.92 })), towerStone: towerCut(mat({ map: rockFace(apagado('#9a907e')), roughness: 0.9 })),
    towerDark: towerCut(mat({ color: '#1c1714', roughness: 1 })),
    // (lo de dentro de la boca de la cueva: roca oscura, que se ve hacia el fondo)
    cavein: mat({ map: rockFace(apagado('#5a524a')), color: '#4a4440', flatShading: true, roughness: 1, side: THREE.BackSide }),
    // (el pozo: su forro de piedra, más oscuro hacia el fondo con el color por vértice, y el agua quieta de abajo, oscura y
    // lisa como un espejo: lo que se ve en ella es el cielo de la boca, apagado, que de noche se apaga con él)
    wellShaft: mat({ map: rockFace(apagado('#8e867a')), vertexColors: true, roughness: 0.95 }), wellWater: c('#b4c6cc', { metalness: 1, roughness: 0.08 }),
    baby: c('#f4e6c8', { roughness: 0.95 }), mirror: c('#d8eef4', { metalness: 0.6, roughness: 0.08 }), plate: c('#f0ece0', { roughness: 0.4 }), plateB: c('#5a7ab8', { roughness: 0.4 }),
  };
  return MATS;
}

// La torre por dentro: mientras el jugador está dentro (y no en primera persona), lo que le taparía no se pinta: lo que
// queda por encima de su cabeza y la pared del lado de la cámara (lo pone engine.js cada fotograma)
export const TOWER_CUT = { player: { value: new THREE.Vector3() }, toCam: { value: new THREE.Vector2(0, 1) }, inside: { value: 0 } };
function towerCut(m) {
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { tcPlayer: TOWER_CUT.player, tcCam: TOWER_CUT.toCam, tcIn: TOWER_CUT.inside });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTcW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTcW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 tcPlayer;\nuniform vec2 tcCam;\nuniform float tcIn;\nvarying vec3 vTcW;').replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      if (tcIn > 0.5) {
        vec2 d = vTcW.xz - tcPlayer.xz;
        float ahead = dot(d, tcCam);
        if (length(d) < 6.0 && (vTcW.y > tcPlayer.y + 2.3 || (ahead > 0.3 && vTcW.y > tcPlayer.y + 0.25))) discard;
      }`);
  };
  m.customProgramCacheKey = () => 'torre-recorte';
  return m;
}

// ---------- un modelo en construcción ----------
// (cada pieza apunta también su caja en solids: lo que ocupa el modelo, para no ponerlo cortando otra cosa)
class Model {
  constructor() { this.parts = new Map(); this.extras = []; this.lights = []; this.fires = []; this.smoke = []; this.solids = []; }
  B(key) { let b = this.parts.get(key); if (!b) this.parts.set(key, (b = new Builder())); return b; }
  box(key, x0, y0, z0, x1, y1, z1, s = 0.5) {
    const b = [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)];
    const r = BEVEL[key];
    if (r) this.B(key).roundBox(...b, r, { s }); else this.B(key).box(...b, { s });
    this.solids.push(b); return this;
  }
  geo(key, g, x, y, z, rot = [0, 0, 0], scale = [1, 1, 1]) {
    const m4 = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...(typeof scale === 'number' ? [scale, scale, scale] : scale)));
    this.B(key).addGeometry(g, m4);
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox.clone().applyMatrix4(m4);
    this.solids.push([bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z]);
    return this;
  }
  // Cilindro con la base en y (r0 abajo, r1 arriba)
  cyl(key, x, y, z, r0, r1, h, seg = 10, rot) { return this.geo(key, cylGeo(r0, r1, h, seg), x, y, z, rot); }
  ball(key, x, y, z, sx, sy = sx, sz = sx, seg = 10) { return this.geo(key, SPHERE[seg] ||= new THREE.SphereGeometry(1, seg, Math.max(4, seg - 2)), x, y, z, [0, 0, 0], [sx, sy, sz]); }
  extra(o) { this.extras.push(o); return this; }
  light(x, y, z, o = {}) { this.lights.push({ x, y, z, color: '#ffb870', intensity: 3, range: 8, flicker: false, ...o }); return this; }
  fire(x, y, z, s = 1) { this.fires.push([x, y, z, s]); return this; }
}
const SPHERE = {}, CYL = new Map();
function cylGeo(r0, r1, h, seg) {
  const k = `${r0}:${r1}:${h}:${seg}`;
  if (!CYL.has(k)) { const g = new THREE.CylinderGeometry(r1, r0, h, seg); g.translate(0, h / 2, 0); CYL.set(k, g); }
  return CYL.get(k);
}
// Un barril de duelas: torno de dieciséis caras con la panza en medio, sombreado plano para que cada duela se vea
let BARREL;
function barrelGeo() {
  if (BARREL) return BARREL;
  const pts = [];
  for (let i = 0; i <= 8; i++) { const y = (i / 8) * 0.84; pts.push(new THREE.Vector2(0.27 + 0.05 * Math.sin(Math.PI * y / 0.84), y)); }
  const g = new THREE.LatheGeometry(pts, 16).toNonIndexed();
  g.computeVertexNormals();
  return (BARREL = g);
}
const CONE = new THREE.ConeGeometry(1, 1, 10), ICO = new THREE.IcosahedronGeometry(1, 0), ICO1 = new THREE.IcosahedronGeometry(1, 1), TORUS = new THREE.TorusGeometry(1, 0.08, 6, 20), DODECA = new THREE.DodecahedronGeometry(1, 0);

// ---------- piezas de revolución (el pozo) ----------
// Un cuadrilátero con una normal por vértice (y, si va con color por vértice, su tono), girado si hace falta para que
// mire hacia donde dicen sus normales
function quad4(B, ps, ns, uvs, cs) {
  const [a, b, c] = ps, u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], n = [0, 1, 2].map(k => ns[0][k] + ns[1][k] + ns[2][k] + ns[3][k]);
  const i = B.pos.length / 3, flip = cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] < 0;
  if (cs && !B.col) B.col = new Array(B.pos.length).fill(1);
  for (let j = 0; j < 4; j++) {
    B.pos.push(...ps[j]); B.nor.push(...ns[j]); B.uv.push(...uvs[j]);
    if (B.col) { const c = cs?.[j] ?? 1; B.col.push(c, c, c); }
  }
  B.idx.push(...(flip ? [i, i + 2, i + 1, i, i + 3, i + 2] : [i, i + 1, i + 2, i, i + 2, i + 3]));
}
// Una pieza de revolución: el perfil (puntos [r, y], en orden, cerrado) barrido de a0 a a1 alrededor del eje y, con cada
// lado del perfil liso a lo largo del giro y las dos caras de los extremos planas (una piedra del brocal, la albardilla).
// s: metros por repetición de la textura
function sweep(B, prof, a0, a1, s = 0.6) {
  const seg = Math.max(2, Math.ceil((a1 - a0) / 0.2)), n = prof.length;
  let cr = 0, cy = 0;
  for (const [r, y] of prof) { cr += r / n; cy += y / n; }
  for (let e = 0; e < n; e++) {
    const [r0, y0] = prof[e], [r1, y1] = prof[(e + 1) % n];
    let nr = y1 - y0, ny = r0 - r1, l = Math.hypot(nr, ny) || 1;
    nr /= l; ny /= l;
    if (nr * ((r0 + r1) / 2 - cr) + ny * ((y0 + y1) / 2 - cy) < 0) { nr = -nr; ny = -ny; }   // (hacia fuera del perfil)
    for (let i = 0; i < seg; i++) {
      const aa = a0 + ((a1 - a0) * i) / seg, ab = a0 + ((a1 - a0) * (i + 1)) / seg, P = (r, y, a) => [Math.cos(a) * r, y, Math.sin(a) * r], N = a => [Math.cos(a) * nr, ny, Math.sin(a) * nr];
      const U = (a, r) => (a * (r0 + r1)) / 2 / s, V = (r, y) => (Math.abs(ny) > 0.7 ? r : y) / s;
      quad4(B, [P(r0, y0, aa), P(r0, y0, ab), P(r1, y1, ab), P(r1, y1, aa)], [N(aa), N(ab), N(ab), N(aa)], [[U(aa), V(r0, y0)], [U(ab), V(r0, y0)], [U(ab), V(r1, y1)], [U(aa), V(r1, y1)]]);
    }
  }
  // (los extremos: el perfil en abanico desde su centro)
  for (const [a, sg] of [[a0, -1], [a1, 1]]) {
    const nn = [-Math.sin(a) * sg, 0, Math.cos(a) * sg], P = (r, y) => [Math.cos(a) * r, y, Math.sin(a) * r], c = P(cr, cy);
    for (let e = 0; e < n; e++) {
      const p = prof[e], q = prof[(e + 1) % n];
      quad4(B, [c, P(...p), P(...q), c], [nn, nn, nn, nn], [[cr / s, cy / s], [p[0] / s, p[1] / s], [q[0] / s, q[1] / s], [cr / s, cy / s]]);
    }
  }
}
// Un tubo (la cara de dentro o de fuera de un cilindro), liso, por las alturas ys; inward: mirando hacia el eje. tone(y):
// el tono por vértice a cada altura (para lo que va con color por vértice)
function tube(B, r, ys, inward, { seg = 28, s = 0.6, tone = null } = {}) {
  const sg = inward ? -1 : 1;
  for (let i = 0; i < seg; i++) for (let j = 0; j < ys.length - 1; j++) {
    const a = (i / seg) * Math.PI * 2, b = ((i + 1) / seg) * Math.PI * 2, y0 = ys[j], y1 = ys[j + 1], P = (q, y) => [Math.cos(q) * r, y, Math.sin(q) * r], N = q => [Math.cos(q) * sg, 0, Math.sin(q) * sg];
    const t0 = tone?.(y0), t1 = tone?.(y1);
    quad4(B, [P(a, y0), P(b, y0), P(b, y1), P(a, y1)], [N(a), N(b), N(b), N(a)], [[(a * r) / s, y0 / s], [(b * r) / s, y0 / s], [(b * r) / s, y1 / s], [(a * r) / s, y1 / s]], tone ? [t0, t0, t1, t1] : null);
  }
}
const BAIL = new THREE.TorusGeometry(0.128, 0.007, 4, 12, Math.PI);   // (el asa del cubo: medio aro)

// ---------- muebles y estaciones ----------
let DOME;
// El «?» de lo que este juego no conoce (de una versión más nueva): cinco por siete cuadritos, de arriba abajo
const QUESTION = ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'];
// The tub's measures (BUILD.banera), in its local frame: the outside from z0 to z1 (two tiles along +z), half-width x,
// wall thickness t, the floor inside at `floor` and the water at `water`. actors.js puts the bather and the foam by them
export const TUB = { z0: -0.4, z1: 1.38, x: 0.42, t: 0.07, floor: 0.3, water: 0.52 };
const BUILD = {
  // Lo de una versión más nueva del juego que este no conoce (ver unknownObject en world/scenes.js): una caja de madera
  // con un «?» dorado en cada lado, para que se vea que ahí hay algo que hay que recargar la página para ver
  unknown(m) {
    const H = 0.7, R = 0.35, P = 0.07, E = 0.012;
    m.box('wood', -R, 0, -R, R, H, R);
    for (const y of [0, H - 0.06]) { m.box('dark', -R - 0.01, y, -R - 0.01, R + 0.01, y + 0.06, -R + 0.05); m.box('dark', -R - 0.01, y, R - 0.05, R + 0.01, y + 0.06, R + 0.01); }
    // (cada cuadrito, en las cuatro caras: u a lo ancho de la cara, v hacia abajo desde arriba)
    QUESTION.forEach((row, v) => [...row].forEach((ch, u) => {
      if (ch !== '#') return;
      const a = -2.5 * P + u * P, y1 = H - 0.1 - v * P, y0 = y1 - P;
      m.box('gold', a, y0, R, a + P, y1, R + E).box('gold', -a - P, y0, -R - E, -a, y1, -R);
      m.box('gold', R, y0, -a - P, R + E, y1, -a).box('gold', -R - E, y0, a, -R, y1, a + P);
    }));
  },
  // (un cuadro o una alfombra de una versión más nueva: un tablón con el «?», colgado del muro o plano en el suelo)
  unknown_hang(m) {
    const R = 0.3, y1 = 1.78, P = 0.07, z = -0.02;
    m.box('wood', -R, y1 - 0.62, -0.05, R, y1, z);
    QUESTION.forEach((row, v) => [...row].forEach((ch, u) => { if (ch === '#') m.box('gold', -2.5 * P + u * P, y1 - 0.07 - (v + 1) * P, z, -2.5 * P + (u + 1) * P, y1 - 0.07 - v * P, z + 0.012); }));
  },
  unknown_rug(m) {
    const R = 0.42, P = 0.07, y = FLOOR_H + 0.03;
    m.box('wood', -R, FLOOR_H, -R, R, y, R);
    QUESTION.forEach((row, v) => [...row].forEach((ch, u) => { if (ch === '#') m.box('gold', -2.5 * P + u * P, y, -3.5 * P + v * P, -2.5 * P + (u + 1) * P, y + 0.006, -3.5 * P + (v + 1) * P); }));
  },
  cama(m) {
    const L = 1.9, W = 0.98, z0 = -0.46, z1 = z0 + L;
    m.box('dark', -W / 2, 0, z0, -W / 2 + 0.08, 1.0, z0 + 0.08).box('dark', W / 2 - 0.08, 0, z0, W / 2, 1.0, z0 + 0.08).box('wood', -W / 2 + 0.08, 0.35, z0 + 0.01, W / 2 - 0.08, 0.92, z0 + 0.07);
    m.box('dark', -W / 2, 0, z1 - 0.08, -W / 2 + 0.08, 0.62, z1).box('dark', W / 2 - 0.08, 0, z1 - 0.08, W / 2, 0.62, z1).box('wood', -W / 2 + 0.08, 0.3, z1 - 0.07, W / 2 - 0.08, 0.55, z1 - 0.01);
    m.box('wood', -W / 2, 0.22, z0 + 0.08, W / 2, 0.34, z1 - 0.08).box('sheet', -W / 2 + 0.03, 0.34, z0 + 0.09, W / 2 - 0.03, 0.5, z1 - 0.09);
    m.box('quilt', -W / 2 + 0.01, 0.42, z0 + 0.62, W / 2 - 0.01, 0.53, z1 - 0.1).box('quilt', -W / 2 - 0.005, 0.2, z0 + 0.62, -W / 2 + 0.01, 0.53, z1 - 0.1).box('quilt', W / 2 - 0.01, 0.2, z0 + 0.62, W / 2 + 0.005, 0.53, z1 - 0.1);
    m.box('quiltB', -W / 2 + 0.005, 0.425, z0 + 0.62, W / 2 - 0.005, 0.535, z0 + 0.74).box('sheet', -0.34, 0.5, z0 + 0.14, 0.34, 0.64, z0 + 0.46);
  },
  // Cama de matrimonio: dos casillas de ancho (hacia +x) y dos de largo, con dos almohadas
  sofa(m) {   // de dos plazas (la casilla y la de su derecha, +x): patas, asiento con dos cojines, respaldo y brazos
    const x0 = -0.46, x1 = 1.46, z0 = -0.42, z1 = 0.4;
    for (const x of [x0 + 0.04, x1 - 0.1]) for (const z of [z0 + 0.04, z1 - 0.1]) m.box('dark', x, 0, z, x + 0.06, 0.12, z + 0.06);
    m.box('sofa', x0, 0.12, z0, x1, 0.3, z1);                                                       // la base
    m.box('sofaB', x0 + 0.14, 0.3, z0 + 0.16, 0.47, 0.44, z1 - 0.01).box('sofaB', 0.53, 0.3, z0 + 0.16, x1 - 0.14, 0.44, z1 - 0.01);   // los cojines del asiento
    m.box('sofa', x0, 0.3, z0, x1, 0.86, z0 + 0.18);                                                 // el respaldo
    for (const x of [x0, x1 - 0.14]) m.box('sofa', x, 0.3, z0, x + 0.14, 0.6, z1);                // los brazos
    m.box('sofaB', 0.15, 0.44, z0 + 0.16, 0.42, 0.7, z0 + 0.26, 0.5).box('quiltB', 0.7, 0.44, z0 + 0.17, 0.92, 0.66, z0 + 0.26);   // dos cojines de respaldo
  },
  // Sillón de cuero, de una plaza: patas, base, cojín del asiento, respaldo alto con orejas, brazos y un cojín
  sillon(m) {
    const X = 0.42, z0 = -0.4, z1 = 0.38, a = 0.13;
    for (const x of [-X + 0.04, X - 0.1]) for (const z of [z0 + 0.04, z1 - 0.1]) m.box('dark', x, 0, z, x + 0.06, 0.1, z + 0.06);
    m.box('leather', -X, 0.1, z0, X, 0.3, z1);                                                       // la base
    m.box('leather', -X + a, 0.3, z0 + 0.18, X - a, 0.43, z1 - 0.01, 0.6);                          // el cojín del asiento
    m.box('leather', -X, 0.3, z0, X, 1.02, z0 + 0.18);                                               // el respaldo
    for (const s of [-1, 1]) {
      const x0 = s < 0 ? -X : X - a, x1 = x0 + a;
      m.box('leather', x0, 0.3, z0 + 0.18, x1, 0.6, z1);                                             // los brazos
      m.box('leatherD', x0 - 0.01, 0.6, z0 + 0.18, x1 + 0.01, 0.64, z1 + 0.01);                       // con su remate
      m.box('leather', x0, 0.64, z0 + 0.18, x1, 0.96, z0 + 0.34);                                    // las orejas
    }
    m.box('leatherD', -X, 0.98, z0 - 0.01, X, 1.04, z0 + 0.19);
    m.box('quiltB', -0.17, 0.43, z0 + 0.19, 0.17, 0.74, z0 + 0.3, 0.5);                              // el cojín
  },
  // Mesa baja de centro: tablero, patas, un estante abajo con dos libros y, encima, una taza y un libro
  mesa_baja(m) {
    const X = 0.46, Z = 0.3;
    m.box('light', -X, 0.38, -Z, X, 0.44, Z);
    for (const [a, b] of [[-X + 0.03, -Z + 0.03], [X - 0.09, -Z + 0.03], [-X + 0.03, Z - 0.09], [X - 0.09, Z - 0.09]]) m.box('wood', a, 0, b, a + 0.06, 0.38, b + 0.06);
    m.box('wood', -X + 0.04, 0.1, -Z + 0.04, X - 0.04, 0.13, Z - 0.04);                              // el estante
    m.B('books1').box(-0.3, 0.13, -0.12, -0.02, 0.17, 0.1, { s: 0.5 }); m.B('books3').box(-0.27, 0.17, -0.1, -0.05, 0.2, 0.08, { s: 0.5 });
    m.cyl('plate', 0.22, 0.44, 0.04, 0.045, 0.05, 0.08, 10).cyl('soot', 0.22, 0.52, 0.04, 0.04, 0.04, 0.002, 10);   // una taza
    m.geo('plate', new THREE.TorusGeometry(0.025, 0.008, 4, 8), 0.275, 0.48, 0.04);
    m.B('books4').box(-0.22, 0.44, -0.14, 0.04, 0.47, 0.06, { s: 0.5 });
  },
  // Mesita de noche: patas, cuerpo, un cajón con tirador y, debajo, un hueco con un libro
  mesita(m) {
    const X = 0.25, z0 = -0.2, z1 = 0.18;
    for (const x of [-X, X - 0.05]) for (const z of [z0, z1 - 0.05]) m.box('dark', x, 0, z, x + 0.05, 0.08, z + 0.05);
    m.box('wood', -X, 0.08, z0, X, 0.12, z1).box('wood', -X, 0.12, z0, -X + 0.03, 0.58, z1).box('wood', X - 0.03, 0.12, z0, X, 0.58, z1).box('wood', -X, 0.12, z0, X, 0.58, z0 + 0.03);
    m.box('wood', -X + 0.03, 0.36, z0 + 0.03, X - 0.03, 0.39, z1);                                  // el suelo del cajón
    m.box('dark', -X + 0.03, 0.39, z1 - 0.03, X - 0.03, 0.56, z1 + 0.01).ball('brass', 0, 0.475, z1 + 0.025, 0.022);   // el cajón
    m.box('light', -X - 0.02, 0.58, z0 - 0.02, X + 0.02, 0.62, z1 + 0.02);
    m.B('books0').box(-0.16, 0.12, -0.1, -0.12, 0.32, 0.1, { s: 0.5 }); m.B('books5').box(-0.11, 0.12, -0.1, -0.07, 0.3, 0.1, { s: 0.5 });
  },
  // Cómoda: tres cajones grandes con dos tiradores cada uno, encimera y zócalo
  comoda(m) {
    const X = 0.46, z0 = -0.24, z1 = 0.2;
    for (const x of [-X + 0.02, X - 0.08]) for (const z of [z0 + 0.02, z1 - 0.06]) m.box('dark', x, 0, z, x + 0.06, 0.08, z + 0.06);
    m.box('wood', -X, 0.08, z0, X, 0.9, z1).box('dark', -X - 0.01, 0.08, z0 - 0.01, X + 0.01, 0.14, z1 + 0.01);
    m.box('light', -X - 0.03, 0.9, z0 - 0.03, X + 0.03, 0.95, z1 + 0.03);
    for (const y of [0.17, 0.42, 0.66]) {
      m.box('light', -X + 0.05, y, z1, X - 0.05, y + 0.21, z1 + 0.02);
      for (const x of [-0.22, 0.22]) m.box('brass', x - 0.06, y + 0.095, z1 + 0.02, x + 0.06, y + 0.115, z1 + 0.04);
    }
  },
  cama_doble(m) {
    const L = 1.9, x0 = -0.47, x1 = 1.47, z0 = -0.46, z1 = z0 + L;
    m.box('dark', x0, 0, z0, x0 + 0.09, 1.1, z0 + 0.09).box('dark', x1 - 0.09, 0, z0, x1, 1.1, z0 + 0.09).box('wood', x0 + 0.09, 0.35, z0 + 0.01, x1 - 0.09, 1.0, z0 + 0.07);
    m.box('light', x0 + 0.3, 0.72, z0 + 0.075, x1 - 0.3, 0.9, z0 + 0.085);   // (un panel más claro en el cabecero)
    m.box('dark', x0, 0, z1 - 0.09, x0 + 0.09, 0.62, z1).box('dark', x1 - 0.09, 0, z1 - 0.09, x1, 0.62, z1).box('wood', x0 + 0.09, 0.3, z1 - 0.07, x1 - 0.09, 0.55, z1 - 0.01);
    m.box('wood', x0, 0.22, z0 + 0.09, x1, 0.34, z1 - 0.09).box('sheet', x0 + 0.03, 0.34, z0 + 0.1, x1 - 0.03, 0.5, z1 - 0.1);
    m.box('quilt', x0 + 0.01, 0.42, z0 + 0.66, x1 - 0.01, 0.53, z1 - 0.1).box('quilt', x0 - 0.005, 0.2, z0 + 0.66, x0 + 0.01, 0.53, z1 - 0.1).box('quilt', x1 - 0.01, 0.2, z0 + 0.66, x1 + 0.005, 0.53, z1 - 0.1);
    m.box('quiltB', x0 + 0.005, 0.425, z0 + 0.66, x1 - 0.005, 0.535, z0 + 0.78);
    m.box('sheet', x0 + 0.12, 0.5, z0 + 0.14, 0.42, 0.64, z0 + 0.46).box('sheet', 0.58, 0.5, z0 + 0.14, x1 - 0.12, 0.64, z0 + 0.46);
  },
  // Cama de niño: como la tuya, pero más corta y baja, con edredón azul
  cama_nino(m) {
    const L = 1.62, W = 0.86, z0 = -0.42, z1 = z0 + L;
    m.box('light', -W / 2, 0, z0, -W / 2 + 0.07, 0.8, z0 + 0.07).box('light', W / 2 - 0.07, 0, z0, W / 2, 0.8, z0 + 0.07).box('wood', -W / 2 + 0.07, 0.3, z0 + 0.01, W / 2 - 0.07, 0.72, z0 + 0.06);
    m.geo('pillowK', ICO, 0, 0.62, z0 + 0.04, [0, 0, 0], [0.09, 0.09, 0.02]);   // (una estrella en el cabecero)
    m.box('light', -W / 2, 0, z1 - 0.07, -W / 2 + 0.07, 0.5, z1).box('light', W / 2 - 0.07, 0, z1 - 0.07, W / 2, 0.5, z1).box('wood', -W / 2 + 0.07, 0.26, z1 - 0.06, W / 2 - 0.07, 0.44, z1 - 0.01);
    m.box('wood', -W / 2, 0.18, z0 + 0.07, W / 2, 0.28, z1 - 0.07).box('sheet', -W / 2 + 0.03, 0.28, z0 + 0.08, W / 2 - 0.03, 0.42, z1 - 0.08);
    m.box('quiltK', -W / 2 + 0.01, 0.35, z0 + 0.5, W / 2 - 0.01, 0.45, z1 - 0.08).box('quiltK', -W / 2 - 0.005, 0.17, z0 + 0.5, -W / 2 + 0.01, 0.45, z1 - 0.08).box('quiltK', W / 2 - 0.01, 0.17, z0 + 0.5, W / 2 + 0.005, 0.45, z1 - 0.08);
    m.box('pillowK', -0.28, 0.42, z0 + 0.12, 0.28, 0.54, z0 + 0.38);
  },
  // Cuna: de barrotes, con colchón y una mantita
  cuna(m) {
    const x = 0.4, z = 0.3, h = 0.78;
    for (const [a, b] of [[-x, -z], [x - 0.06, -z], [-x, z - 0.06], [x - 0.06, z - 0.06]]) m.box('light', a, 0, b, a + 0.06, h, b + 0.06);
    m.box('wood', -x, 0.24, -z, x, 0.3, z).box('sheet', -x + 0.05, 0.3, -z + 0.05, x - 0.05, 0.38, z - 0.05).box('quiltK2', -x + 0.06, 0.36, 0, x - 0.06, 0.41, z - 0.06);
    for (const y of [0.3, h - 0.05]) m.box('light', -x, y, -z, x, y + 0.05, -z + 0.04).box('light', -x, y, z - 0.04, x, y + 0.05, z).box('light', -x, y, -z, -x + 0.04, y + 0.05, z).box('light', x - 0.04, y, -z, x, y + 0.05, z);
    for (let i = 1; i < 8; i++) { const u = -x + i * (2 * x / 8); m.box('light', u - 0.012, 0.33, -z + 0.005, u + 0.012, h - 0.05, -z + 0.03).box('light', u - 0.012, 0.33, z - 0.03, u + 0.012, h - 0.05, z - 0.005); }
    for (let i = 1; i < 5; i++) { const v = -z + i * (2 * z / 5); m.box('light', -x + 0.005, 0.33, v - 0.012, -x + 0.03, h - 0.05, v + 0.012).box('light', x - 0.03, 0.33, v - 0.012, x - 0.005, h - 0.05, v + 0.012); }
  },
  // Cocina: fregadero de piedra sobre un mueble, con su grifo
  fregadero(m) {
    m.box('wood', -0.45, 0, -0.3, 0.45, 0.82, 0.24).box('dark', -0.4, 0.08, 0.24, -0.02, 0.74, 0.26).box('dark', 0.02, 0.08, 0.24, 0.4, 0.74, 0.26);
    m.ball('brass', -0.06, 0.44, 0.27, 0.02).ball('brass', 0.06, 0.44, 0.27, 0.02);
    m.box('stone', -0.47, 0.82, -0.32, 0.47, 0.9, 0.27).box('soot', -0.3, 0.9, -0.18, 0.3, 0.902, 0.16).box('water', -0.27, 0.902, -0.15, 0.27, 0.905, 0.13);
    m.cyl('brass', 0, 0.9, -0.26, 0.025, 0.025, 0.22, 8).box('brass', -0.016, 1.08, -0.26, 0.016, 1.11, -0.1).ball('brass', 0, 1.13, -0.27, 0.035);
  },
  // Alacena: armario bajo con puertas y, encima, estantes con platos y tarros
  alacena(m) {
    m.box('wood', -0.46, 0, -0.26, 0.46, 0.86, 0.2).box('light', -0.48, 0.86, -0.28, 0.48, 0.92, 0.22);
    m.box('dark', -0.42, 0.08, 0.2, -0.02, 0.78, 0.22).box('dark', 0.02, 0.08, 0.2, 0.42, 0.78, 0.22).ball('brass', -0.07, 0.46, 0.235, 0.022).ball('brass', 0.07, 0.46, 0.235, 0.022);
    m.box('wood', -0.46, 0.92, -0.26, 0.46, 1.95, -0.2).box('dark', -0.46, 0.92, -0.26, -0.41, 1.95, 0.0).box('dark', 0.41, 0.92, -0.26, 0.46, 1.95, 0.0).box('light', -0.48, 1.92, -0.28, 0.48, 1.98, 0.03);
    for (const y of [1.3, 1.62]) m.box('light', -0.41, y, -0.2, 0.41, y + 0.035, 0.0);
    for (let i = 0; i < 4; i++) { const u = -0.3 + i * 0.2; m.cyl(i % 2 ? 'plateB' : 'plate', u, 1.335, -0.12, 0.1, 0.1, 0.018, 14, [Math.PI / 2 - 0.25, 0, 0]); }
    for (const [u, k, h] of [[-0.28, 'pot', 0.16], [-0.08, 'glass', 0.2], [0.12, 'pot', 0.13], [0.3, 'copper', 0.18]]) m.cyl(k, u, 1.655, -0.1, 0.06, 0.055, h, 10);
  },
  // Armario: alto, de dos puertas con cuarterones, con cornisa y patas
  armario(m) {
    m.box('wood', -0.46, 0.08, -0.3, 0.46, 2.0, 0.22).box('light', -0.5, 2.0, -0.33, 0.5, 2.08, 0.26).box('dark', -0.48, 0.08, -0.31, 0.48, 0.14, 0.24);
    for (const x of [-0.44, 0.39]) for (const z of [-0.28, 0.17]) m.box('dark', x, 0, z, x + 0.05, 0.08, z + 0.05);
    m.box('dark', -0.42, 0.2, 0.22, -0.012, 1.92, 0.245).box('dark', 0.012, 0.2, 0.22, 0.42, 1.92, 0.245);
    for (const [x0, x1] of [[-0.36, -0.07], [0.07, 0.36]]) m.box('wood', x0, 0.34, 0.245, x1, 0.92, 0.256).box('wood', x0, 1.1, 0.245, x1, 1.78, 0.256);
    m.ball('brass', -0.045, 1.02, 0.26, 0.022).ball('brass', 0.045, 1.02, 0.26, 0.022);
  },
  // Mueble de baño: bajo y blanco, con un cajón y dos puertas, patas y, encima, dos toallas dobladas y una pastilla de jabón
  mueble_bano(m) {
    m.box('white', -0.42, 0.08, -0.22, 0.42, 0.7, 0.14).box('porcelain', -0.45, 0.7, -0.24, 0.45, 0.74, 0.17);
    for (const x of [-0.39, 0.34]) for (const z of [-0.19, 0.08]) m.box('steel', x, 0, z, x + 0.05, 0.08, z + 0.05);
    m.box('cloth', -0.38, 0.54, 0.14, 0.38, 0.66, 0.155).box('brass', -0.07, 0.59, 0.155, 0.07, 0.61, 0.17);
    m.box('cloth', -0.38, 0.13, 0.14, -0.012, 0.5, 0.155).box('cloth', 0.012, 0.13, 0.14, 0.38, 0.5, 0.155);
    m.ball('brass', -0.05, 0.36, 0.165, 0.018).ball('brass', 0.05, 0.36, 0.165, 0.018);
    m.box('quiltK', -0.34, 0.74, -0.18, -0.04, 0.8, 0.06).box('sheet', -0.32, 0.8, -0.16, -0.06, 0.85, 0.04);
    m.box('quiltK2', 0.18, 0.74, -0.06, 0.28, 0.77, 0.02);
  },
  // Encimera con cajones: la parte de abajo de la alacena, con dos cajones encima de las puertas. a y b: lo que se
  // alarga por la izquierda y por la derecha para unirse a lo de al lado (el tablero y, hasta su borde, el cuerpo)
  encimera(m, a, b) {
    const l = +a || 0, r = +b || 0, bl = l ? l + 0.02 : 0, br = r ? r + 0.02 : 0;
    m.box('wood', -0.46 - bl, 0, -0.26, 0.46 + br, 0.86, 0.2).box('light', -0.48 - l, 0.86, -0.28, 0.48 + r, 0.92, 0.22);
    m.box('dark', -0.42, 0.62, 0.2, -0.02, 0.8, 0.22).box('dark', 0.02, 0.62, 0.2, 0.42, 0.8, 0.22).box('brass', -0.28, 0.7, 0.22, -0.16, 0.725, 0.24).box('brass', 0.16, 0.7, 0.22, 0.28, 0.725, 0.24);
    m.box('dark', -0.42, 0.08, 0.2, -0.02, 0.56, 0.22).box('dark', 0.02, 0.08, 0.2, 0.42, 0.56, 0.22).ball('brass', -0.07, 0.32, 0.235, 0.022).ball('brass', 0.07, 0.32, 0.235, 0.022);
  },
  // Baño: bañera de porcelana con patas de latón (dos casillas de largo), retrete y lavabo con espejo
  banera(m) {
    const { z0, z1, x, t } = TUB;
    m.box('porcelain', -x, 0.14, z0, x, 0.3, z1);   // el fondo y, alrededor, las paredes con su borde
    m.box('porcelain', -x, 0.3, z0, -x + t, 0.62, z1).box('porcelain', x - t, 0.3, z0, x, 0.62, z1).box('porcelain', -x, 0.3, z0, x, 0.62, z0 + t).box('porcelain', -x, 0.3, z1 - t, x, 0.62, z1);
    m.box('porcelain', -x - 0.03, 0.62, z0 - 0.03, x + 0.03, 0.66, z0 + t).box('porcelain', -x - 0.03, 0.62, z1 - t, x + 0.03, 0.66, z1 + 0.03);
    m.box('porcelain', -x - 0.03, 0.62, z0 + t, -x + t, 0.66, z1 - t).box('porcelain', x - t, 0.62, z0 + t, x + 0.03, 0.66, z1 - t);
    m.box('water', -x + t, 0.3, z0 + t, x - t, TUB.water, z1 - t);
    for (const [a, b] of [[-x + 0.06, z0 + 0.08], [x - 0.06, z0 + 0.08], [-x + 0.06, z1 - 0.08], [x - 0.06, z1 - 0.08]]) m.ball('brass', a, 0.09, b, 0.07, 0.09, 0.07);
    m.cyl('brass', 0, 0.66, z0 + 0.04, 0.025, 0.025, 0.2, 8).box('brass', -0.015, 0.84, z0 + 0.04, 0.015, 0.87, z0 + 0.18).ball('brass', -0.08, 0.72, z0 + 0.04, 0.03).ball('brass', 0.08, 0.72, z0 + 0.04, 0.03);
  },
  inodoro(m) {
    m.cyl('porcelain', 0, 0, 0.06, 0.14, 0.18, 0.3, 14).cyl('porcelain', 0, 0.28, 0.08, 0.21, 0.22, 0.12, 16).cyl('soot', 0, 0.399, 0.08, 0.15, 0.15, 0.002, 16);
    m.cyl('wood', 0, 0.4, 0.08, 0.22, 0.22, 0.03, 16).box('porcelain', -0.22, 0.3, -0.32, 0.22, 0.9, -0.12).box('porcelain', -0.24, 0.88, -0.34, 0.24, 0.94, -0.1);
    m.box('brass', 0.14, 0.78, -0.12, 0.2, 0.81, -0.08);
  },
  lavabo(m) {
    m.cyl('porcelain', 0, 0, -0.06, 0.1, 0.07, 0.72, 12).cyl('porcelain', 0, 0.7, -0.06, 0.16, 0.3, 0.16, 16).cyl('soot', 0, 0.86, -0.06, 0.24, 0.24, 0.002, 16).cyl('water', 0, 0.862, -0.06, 0.2, 0.2, 0.002, 16);
    m.cyl('brass', 0, 0.86, -0.3, 0.02, 0.02, 0.16, 8).box('brass', -0.014, 1.0, -0.3, 0.014, 1.03, -0.18);
    m.box('dark', -0.3, 1.12, -0.42, 0.3, 1.74, -0.36).box('mirror', -0.25, 1.17, -0.37, 0.25, 1.69, -0.355);
  },
  estanteria(m) {
    m.box('dark', -0.46, 0, -0.2, -0.42, 1.9, 0.15).box('dark', 0.42, 0, -0.2, 0.46, 1.9, 0.15).box('wood', -0.46, 1.86, -0.2, 0.46, 1.92, 0.17).box('wood', -0.42, 0, -0.2, 0.42, 1.86, -0.17);
    let r = 7;
    const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
    for (const y of [0.06, 0.5, 0.94, 1.38]) {
      m.box('wood', -0.42, y, -0.17, 0.42, y + 0.04, 0.15);
      let u = -0.4;
      while (u < 0.36) {
        const bw = 0.04 + rnd() * 0.04, bh = 0.24 + rnd() * 0.14;
        if (rnd() < 0.14) { u += 0.08; continue; }
        m.B('books' + Math.floor(rnd() * 6)).box(u, y + 0.04, -0.15 + rnd() * 0.03, u + bw, y + 0.04 + bh, 0.1, { s: 0.5 });
        u += bw + 0.005;
      }
    }
  },
  mesa(m) {
    m.box('light', -0.5, 0.72, -0.42, 0.5, 0.8, 0.42);
    for (const [a, b] of [[-0.44, -0.36], [0.38, -0.36], [-0.44, 0.3], [0.38, 0.3]]) m.box('wood', a, 0, b, a + 0.06, 0.72, b + 0.06);
    m.box('wood', -0.42, 0.62, -0.34, 0.42, 0.7, -0.3).box('wood', -0.42, 0.62, 0.3, 0.42, 0.7, 0.34).box('sheet', -0.18, 0.8, -0.18, 0.18, 0.81, 0.18);
    m.cyl('pot', 0, 0.81, 0, 0.06, 0.05, 0.15).geo('books0', ICO, 0, 1.02, 0, [0, 0, 0], 0.06);
  },
  // Mesa grande, de w × h casillas: tablero, patas en las esquinas (las sillas caben entre ellas), faldón, un camino
  // de mesa a lo largo, un jarrón con flores en medio y, a los lados, dos velas
  mesa_grande(m, size = '2x1') {
    const [w, h] = size.split('x').map(Number), X = w / 2 - 0.04, Z = h / 2 - 0.04, along = w >= h;
    m.box('light', -X, 0.72, -Z, X, 0.8, Z);
    for (const [a, b] of [[-X + 0.04, -Z + 0.04], [X - 0.1, -Z + 0.04], [-X + 0.04, Z - 0.1], [X - 0.1, Z - 0.1]]) m.box('wood', a, 0, b, a + 0.06, 0.72, b + 0.06);
    m.box('wood', -X + 0.1, 0.62, -Z + 0.06, X - 0.1, 0.7, -Z + 0.1).box('wood', -X + 0.1, 0.62, Z - 0.1, X - 0.1, 0.7, Z - 0.06);
    m.box('wood', -X + 0.06, 0.62, -Z + 0.1, -X + 0.1, 0.7, Z - 0.1).box('wood', X - 0.1, 0.62, -Z + 0.1, X - 0.06, 0.7, Z - 0.1);
    if (along) m.box('sheet', -X + 0.18, 0.8, -0.17, X - 0.18, 0.806, 0.17); else m.box('sheet', -0.17, 0.8, -Z + 0.18, 0.17, 0.806, Z - 0.18);
    m.cyl('pot', 0, 0.806, 0, 0.07, 0.055, 0.17);
    for (const [x, y, z, k] of [[0, 1.02, 0, 'red'], [0.05, 0.99, 0.03, 'white'], [-0.05, 0.99, -0.02, 'quiltB'], [0.02, 1.0, -0.05, 'red']]) m.ball(k, x, y, z, 0.045);
    m.ball('leaf', 0, 0.96, 0, 0.07, 0.04, 0.07);
    const L = (along ? X : Z) - 0.42;
    if (L > 0.2) for (const s of [-1, 1]) { const [cx, cz] = along ? [s * L, 0] : [0, s * L]; m.cyl('brass', cx, 0.806, cz, 0.05, 0.035, 0.03).cyl('candle', cx, 0.836, cz, 0.022, 0.022, 0.14); }
  },
  valla(m) {   // (para su icono, su vista previa y tirada en el suelo; puesta en el mundo la dibuja build3d, unida a sus vecinas)
    m.box('wood', -0.055, 0, -0.055, 0.055, 0.92, 0.055).box('dark', -0.07, 0.92, -0.07, 0.07, 0.96, 0.07);
    for (const y of [0.36, 0.72]) m.box('wood', -0.5, y, 0.055, 0.5, y + 0.1, 0.09).box('wood', -0.5, y, -0.09, 0.5, y + 0.1, -0.055);
  },
  puerta_valla(m) {   // (para su icono, su vista previa y tirada en el suelo; puesta en el mundo, build3d)
    for (const x of [-0.5, 0.5]) m.box('wood', x - 0.07, 0, -0.07, x + 0.07, 1.02, 0.07).box('dark', x - 0.09, 1.02, -0.09, x + 0.09, 1.07, 0.09);
    for (const y of [0.26, 0.5, 0.74]) m.box('wood', -0.43, y, -0.035, 0.43, y + 0.09, 0.035);
    for (const x of [-0.41, 0.34]) m.box('wood', x, 0.18, -0.045, x + 0.07, 0.92, 0.045);
  },
  silla(m) {
    m.box('wood', -0.22, 0.42, -0.22, 0.22, 0.47, 0.22);
    for (const [a, b] of [[-0.21, -0.21], [0.16, -0.21], [-0.21, 0.16], [0.16, 0.16]]) m.box('dark', a, 0, b, a + 0.05, 0.42, b + 0.05);
    m.box('dark', -0.21, 0.47, -0.22, -0.16, 1.0, -0.17).box('dark', 0.16, 0.47, -0.22, 0.21, 1.0, -0.17).box('wood', -0.18, 0.62, -0.215, 0.18, 0.7, -0.175).box('wood', -0.18, 0.84, -0.215, 0.18, 0.96, -0.175);
  },
  lampara(m) {
    m.cyl('iron', 0, 0, 0, 0.15, 0.13, 0.04).cyl('iron', 0, 0.04, 0, 0.02, 0.02, 1.36, 6);
    m.cyl('shade', 0, 1.32, 0, 0.22, 0.13, 0.26, 12);
    m.light(0, 1.35, 0, { color: '#ffcf8a', intensity: 1.6, range: 5 });
  },
  maceta(m) {
    m.cyl('pot', 0, 0, 0, 0.15, 0.2, 0.34, 10).cyl('pot', 0, 0.31, 0, 0.22, 0.22, 0.06, 10).cyl('soil', 0, 0.36, 0, 0.18, 0.18, 0.01, 10);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; m.geo(i % 2 ? 'leaf' : 'leafD', ICO, Math.cos(a) * 0.12, 0.5 + (i % 3) * 0.12, Math.sin(a) * 0.12, [i, i * 2, 0], 0.16 + (i % 2) * 0.04); }
    m.geo('leaf', ICO, 0, 0.78, 0, [0, 0, 0], 0.17);
    for (let i = 0; i < 4; i++) { const a = i * 1.7; m.geo(['red', 'quiltB', 'white', 'books4'][i], ICO, Math.cos(a) * 0.14, 0.72 + (i % 2) * 0.1, Math.sin(a) * 0.14, [0, 0, 0], 0.05); }
  },
  alfombra(m) { m.B('rug').quad([-0.9, RUG_Y, 0.6], [0.9, RUG_Y, 0.6], [0.9, RUG_Y, -0.6], [-0.9, RUG_Y, -0.6], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]); },
  cofre(m) {
    m.box('wood', -0.38, 0, -0.26, 0.38, 0.42, 0.26).box('dark', -0.4, 0.42, -0.28, 0.4, 0.58, 0.28);
    m.box('iron', -0.4, 0.05, -0.27, -0.34, 0.58, 0.27).box('iron', 0.34, 0.05, -0.27, 0.4, 0.58, 0.27).box('brass', -0.06, 0.32, 0.26, 0.06, 0.46, 0.29);
  },
  vela(m) {   // una vela en su palmatoria
    m.cyl('brass', 0, 0, 0, 0.09, 0.08, 0.025, 12).cyl('brass', 0, 0.025, 0, 0.03, 0.035, 0.03, 10);
    m.geo('brass', new THREE.TorusGeometry(0.035, 0.008, 4, 10, Math.PI), 0.085, 0.05, 0, [0, 0, -Math.PI / 2]);
    m.cyl('candle', 0, 0.05, 0, 0.022, 0.022, 0.14, 10).cyl('soot', 0, 0.19, 0, 0.003, 0.003, 0.02, 4);
    m.fire(0, 0.22, 0, 0.22).light(0, 0.26, 0, { color: '#ffc070', intensity: 1.2, range: 4, flicker: true });
  },
  mochila(m) {   // una mochila en el suelo, de pie: cuerpo, solapa con hebilla, bolsillo y correas
    const bag = 'leather', dark = 'leatherD';
    m.box(bag, -0.17, 0, -0.1, 0.17, 0.42, 0.12).box(dark, -0.18, 0.3, -0.11, 0.18, 0.44, 0.135).box(dark, -0.12, 0.08, 0.12, 0.12, 0.22, 0.16);
    m.ball('brass', 0, 0.33, 0.14, 0.022, 0.022, 0.012);
    for (const x of [-0.09, 0.09]) m.box(dark, x - 0.02, 0.02, -0.13, x + 0.02, 0.42, -0.1);
  },
  antorcha(m) {
    m.cyl('dark', 0, 0, 0, 0.04, 0.03, 1.05, 6).cyl('rope', 0, 0.92, 0, 0.055, 0.06, 0.14, 8);
    m.fire(0, 1.08, 0, 0.7).light(0, 1.25, 0, { color: '#ffa850', intensity: 3.2, range: 9, flicker: true, pool: 2.2 });
  },
  // Las flores que se cogen: un ramillete de tres (lo que se lleva y se tira al suelo; ver flowers3d.js)
  margarita(m) { flowerBunch(m, 'margarita'); },
  diente_leon(m) { flowerBunch(m, 'diente_leon'); },
  banco(m) {
    m.box('light', -0.55, 0.78, -0.32, 0.55, 0.86, 0.32);
    for (const [a, b] of [[-0.52, -0.29], [0.46, -0.29], [-0.52, 0.23], [0.46, 0.23]]) m.box('wood', a, 0, b, a + 0.06, 0.78, b + 0.06);
    m.box('wood', -0.5, 0.18, -0.28, 0.5, 0.22, 0.28).box('plank', -0.45, 0.22, -0.2, 0.4, 0.3, 0.15);
    m.box('iron', 0.38, 0.86, 0.12, 0.52, 0.98, 0.3).box('iron', 0.43, 0.98, 0.18, 0.47, 1.06, 0.24);   // tornillo de banco
    m.box('steel', -0.4, 0.865, -0.1, -0.05, 0.875, 0.04).box('dark', -0.48, 0.86, -0.08, -0.38, 0.9, 0.02);   // sierra
    m.box('dark', 0.05, 0.86, -0.2, 0.3, 0.89, -0.17).box('iron', 0.24, 0.86, -0.24, 0.32, 0.92, -0.12);       // martillo
  },
  // La mesa de cantero: dos caballetes recios con su bastidor, una losa gruesa encima y, sobre ella, un sillar a medio
  // labrar (con el escalón de lo que falta por quitar), la maza, dos cinceles y la escuadra; debajo, un sillar ya
  // hecho y cascotes
  cantero(m) {
    for (const x of [-0.5, 0.38]) m.box('wood', x, 0, -0.3, x + 0.12, 0.62, -0.19).box('wood', x, 0, 0.19, x + 0.12, 0.62, 0.3).box('dark', x + 0.02, 0.2, -0.19, x + 0.1, 0.28, 0.19);
    m.box('wood', -0.5, 0.62, -0.32, 0.5, 0.7, 0.32);
    m.box('marbleD', -0.56, 0.7, -0.36, 0.56, 0.8, 0.36, 0.6);
    m.box('ashlar', -0.42, 0.8, -0.22, -0.06, 1.02, 0.14, 0.6).box('ashlar', -0.06, 0.8, -0.22, 0.04, 0.92, 0.14, 0.6);
    m.box('wood', 0.24, 0.8, -0.06, 0.37, 0.91, 0.08).box('dark', 0.285, 0.835, 0.08, 0.325, 0.875, 0.32);   // la maza
    m.box('steel', 0.1, 0.8, -0.3, 0.13, 0.825, -0.08).box('steel', 0.17, 0.8, -0.31, 0.2, 0.825, -0.12);    // los cinceles
    m.box('iron', 0.26, 0.8, -0.32, 0.5, 0.81, -0.29).box('iron', 0.47, 0.8, -0.29, 0.5, 0.81, -0.14);        // la escuadra
    m.box('ashlar', -0.3, 0, -0.14, 0.06, 0.2, 0.14, 0.6);
    for (const [x, z, s] of [[0.2, 0.06, 0.07], [0.28, -0.1, 0.05], [0.12, -0.08, 0.04], [-0.08, 0.38, 0.05], [0.3, 0.4, 0.04]]) m.ball('ashlar', x, s * 0.4, z, s, s * 0.5, s * 0.8, 6);
  },
  horno(m) {
    m.box('stone', -0.48, 0, -0.42, 0.48, 0.7, 0.38, 0.6);
    m.ball('stone', 0, 0.7, -0.02, 0.48, 0.42, 0.42, 12);
    m.box('soot', -0.22, 0.14, 0.3, 0.22, 0.52, 0.39).box('stone', -0.28, 0.52, 0.3, 0.28, 0.6, 0.42, 0.6);
    m.cyl('brick', 0.12, 0.9, -0.2, 0.12, 0.1, 0.75, 8);
    m.geo('ember', ICO, 0, 0.2, 0.32, [0, 0, 0], [0.16, 0.06, 0.06]);
    m.fire(0, 0.18, 0.3, 0.55).light(0, 0.4, 0.55, { color: '#ff8a3a', intensity: 2.2, range: 6, flicker: true });
    m.smoke.push([0.12, 1.7, -0.2]);
  },
  yunque(m) {
    m.cyl('dark', 0, 0, 0, 0.3, 0.27, 0.5, 10);
    m.box('iron', -0.26, 0.5, -0.12, 0.2, 0.58, 0.12).box('iron', -0.14, 0.58, -0.08, 0.1, 0.68, 0.08).box('iron', -0.32, 0.68, -0.14, 0.26, 0.82, 0.14);
    m.geo('iron', CONE, 0.38, 0.75, 0, [0, 0, -Math.PI / 2], [0.09, 0.26, 0.09]);
    m.box('dark', 0.08, 0.82, 0.04, 0.3, 0.84, 0.08).box('iron', 0.24, 0.82, 0.0, 0.32, 0.88, 0.12);
  },
  telar(m) {
    for (const x of [-0.45, 0.39]) { m.box('wood', x, 0, -0.3, x + 0.06, 1.4, -0.24).box('wood', x, 0, 0.2, x + 0.06, 1.0, 0.26).box('wood', x, 0.9, -0.3, x + 0.06, 0.96, 0.26); }
    m.box('dark', -0.45, 1.3, -0.3, 0.45, 1.36, -0.24).box('dark', -0.45, 0.8, 0.2, 0.45, 0.86, 0.26).box('wood', -0.4, 0.42, 0.24, 0.4, 0.46, 0.4);
    for (let i = 0; i < 14; i++) { const x = -0.36 + i * 0.055; m.box(['red', 'quiltB', 'white'][i % 3], x, 0.86, -0.27 + (0.47 * 0), x + 0.012, 1.3, -0.26); }
    m.box('quilt', -0.36, 0.86, -0.28, 0.4, 1.0, -0.265).box('cloth', -0.4, 0.78, 0.18, 0.4, 0.84, 0.3);
  },
  cocina(m) {
    m.box('brick', -0.5, 0, -0.36, 0.5, 0.82, 0.34, 0.6).box('iron', -0.52, 0.82, -0.38, 0.52, 0.86, 0.36);
    m.box('soot', -0.2, 0.12, 0.28, 0.2, 0.42, 0.35).box('iron', -0.24, 0.42, 0.33, 0.24, 0.46, 0.37);
    m.cyl('iron', -0.2, 0.86, 0, 0.16, 0.18, 0.2, 12).cyl('copper', 0.22, 0.86, -0.05, 0.12, 0.1, 0.12, 10).box('dark', 0.3, 0.92, -0.05, 0.5, 0.94, -0.02);
    m.cyl('brick', 0.3, 0.86, -0.25, 0.1, 0.09, 1.0, 8);
    m.geo('ember', ICO, 0, 0.18, 0.3, [0, 0, 0], [0.13, 0.05, 0.05]);
    m.fire(0, 0.16, 0.3, 0.45).light(0, 0.4, 0.5, { color: '#ff8a3a', intensity: 1.8, range: 5, flicker: true });
    m.smoke.push([0.3, 1.9, -0.25]);
  },
  // Noria: dos caballetes con el eje, la rueda de paletas (que gira, aparte: spin) y, a su derecha, la canaleta que
  // lleva el agua que sube hasta la orilla
  noria(m) {
    const H = 0.74, R = 0.95, M = modelMats();   // (el eje, algo más bajo que el radio: la rueda entra en el agua)
    for (const x of [-0.34, 0.34]) {
      m.box('dark', x - 0.05, 0, -0.56, x + 0.05, 0.08, 0.56);                                        // la zapata
      m.cyl('dark', x, 0, -0.48, 0.04, 0.04, 1.02, 6, [0.45, 0, 0]).cyl('dark', x, 0, 0.48, 0.04, 0.04, 1.02, 6, [-0.45, 0, 0]);   // el caballete
      m.box('iron', x - 0.06, H - 0.07, -0.07, x + 0.06, H + 0.07, 0.07);                             // el cojinete
    }
    m.cyl('iron', -0.42, H, 0, 0.045, 0.045, 0.84, 8, [0, 0, -Math.PI / 2]);                         // el eje
    const y = H + R - 0.1;
    m.box('wood', 0.26, y, -0.13, 1.5, y + 0.04, 0.13).box('wood', 0.26, y + 0.04, -0.13, 1.5, y + 0.14, -0.1).box('wood', 0.26, y + 0.04, 0.1, 1.5, y + 0.14, 0.13);
    m.box('water', 0.26, y + 0.04, -0.1, 1.5, y + 0.09, 0.1);
    m.box('dark', 1.34, 0, -0.05, 1.44, y, 0.05);
    const wheel = new THREE.Group(), add = (geo, mt, x, yy, z, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, mt); o.position.set(x, yy, z); o.rotation.set(rx, ry, rz); wheel.add(o); };
    add(new THREE.CylinderGeometry(0.12, 0.12, 0.46, 10), M.dark, 0, 0, 0, 0, 0, Math.PI / 2);      // el cubo
    const rim = new THREE.TorusGeometry(R, 0.035, 6, 32), spoke = new THREE.BoxGeometry(0.05, R * 2, 0.05), paddle = new THREE.BoxGeometry(0.44, 0.24, 0.035);
    for (const x of [-0.18, 0.18]) {
      add(rim, M.wood, x, 0, 0, 0, Math.PI / 2, 0);
      for (let i = 0; i < 4; i++) add(spoke, M.dark, x, 0, 0, (i / 4) * Math.PI);
    }
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; add(paddle, M.wood, 0, Math.cos(a) * (R - 0.08), Math.sin(a) * (R - 0.08), a); }
    wheel.position.set(0, H, 0); wheel.rotation.order = 'YXZ'; wheel.userData.spin = -0.7;
    m.extra(wheel);
    m.solids.push([-0.24, 0, -R, 0.24, H + R, R]);   // (lo que ocupa la rueda: no se le pone nada encima)
  },
  // El pozo (n: los escalones de LV_STEP, 0,25 m, que baja hasta el fondo de su hoyo; sin n, para el icono y la vista
  // previa, poco): una losa cuadrada que tapa el hoyo (y, por fuera, su forro de piedra hasta abajo: se ve desde un hoyo de
  // al lado), el brocal redondo de sillares hasta la cintura con su albardilla, dentro el forro cada vez más oscuro y el
  // agua quieta al fondo; dos postes de madera metidos en el brocal con el tejadillo de tablillas a dos aguas, el torno
  // con la cuerda enrollada y su manivela, y el cubo colgando sobre la boca, lleno de agua
  pozo(m, n) { wellBody(m, wellDepth(n)); },
  // The big well (big_well): the same well over 2 × 2 tiles (see wellStretch)
  big_well(m, n) { wellStretch(m, wellDepth(n)); },
  aspersor(m) {
    m.cyl('copper', 0, 0, 0, 0.12, 0.1, 0.06, 10).cyl('copper', 0, 0.06, 0, 0.025, 0.025, 0.3, 6).box('copper', -0.16, 0.34, -0.02, 0.16, 0.38, 0.02).box('copper', -0.02, 0.34, -0.16, 0.02, 0.38, 0.16);
    for (const [x, z] of [[0.16, 0], [-0.16, 0], [0, 0.16], [0, -0.16]]) m.ball('steel', x, 0.36, z, 0.03);
  },
  // Las casas con puerta se dibujan abiertas o cerradas ('shut'). Lo que asoma por delante (las hojas de la puerta, la
  // rampa) no choca: se pasa por ahí
  gallinero(m, shut) {
    const W = 1.2, D = 1, F = 0.36, H = 1.42, soft = (key, ...b) => m.B(key).box(...b, { s: 0.5 });
    for (const x of [-W, W - 0.1]) for (const z of [-D, D - 0.1]) m.box('dark', x, 0, z, x + 0.1, H, z + 0.1);   // las patas y las esquinas
    m.box('wood', -W + 0.03, F, -D + 0.03, W - 0.03, H, D - 0.03);
    soft('dark', -W, F - 0.05, D - 0.02, W, F + 0.04, D + 0.01); soft('dark', -W, H - 0.08, D - 0.02, W, H, D + 0.01);
    roofPrism(m, 'red', -W - 0.16, W + 0.16, -D - 0.2, D + 0.2, H, 0.72);
    soft('straw', -W + 0.1, 0, -D + 0.1, W - 0.1, 0.05, D - 0.1);   // (paja debajo)
    // La puerta, con su marco, y la rampa con sus listones hasta el suelo
    soft('dark', -0.33, F, D - 0.02, 0.33, F + 0.72, D + 0.015);
    soft('soot', -0.27, F + 0.04, D, 0.27, F + 0.66, D + 0.025);
    if (shut) soft('wood', -0.26, F + 0.05, D + 0.01, 0.26, F + 0.65, D + 0.045), soft('dark', -0.26, F + 0.32, D + 0.04, 0.26, F + 0.38, D + 0.06), soft('iron', 0.14, F + 0.32, D + 0.05, 0.2, F + 0.38, D + 0.075);
    else soft('wood', 0.27, F + 0.05, D + 0.01, 0.31, F + 0.65, D + 0.52);
    for (let i = 0; i < 4; i++) soft('plank', -0.26, F - 0.08 - i * 0.09, D + i * 0.22, 0.26, F - 0.04 - i * 0.09, D + 0.24 + i * 0.22);
    // Un ventanuco a cada lado de la puerta y un nido por fuera
    for (const x of [-0.8, 0.8]) { soft('dark', x - 0.2, 0.82, D - 0.02, x + 0.2, 1.2, D + 0.012); soft('soot', x - 0.15, 0.87, D, x + 0.15, 1.15, D + 0.02); soft('iron', x - 0.012, 0.87, D, x + 0.012, 1.15, D + 0.03); soft('iron', x - 0.15, 1, D, x + 0.15, 1.02, D + 0.03); }
    m.box('wood', W - 0.04, 0.5, -0.5, W + 0.34, 0.92, 0.5);
    soft('straw', W + 0.02, 0.92, -0.46, W + 0.3, 0.95, 0.46);
    soft('red', W - 0.04, 0.98, -0.56, W + 0.42, 1.04, 0.56);
  },
  // (arg: 'shut', con la puerta cerrada; 'in', sin tejado y con las paredes bajas, para ver dentro cuando se está en él)
  establo(m, arg) {
    const shut = arg === 'shut', cut = arg === 'in', W = 2, D = 1.5, H = cut ? 0.8 : 1.95, DW = 0.85, DH = cut ? 0.8 : 1.55, soft = (key, ...b) => m.B(key).box(...b, { s: 0.5 });
    // Las paredes dejan el hueco de la puerta: abierta, se ve la paja, los cercados y el heno de dentro
    m.box('red', -W, 0, -D, W, H, -D + 0.1).box('red', -W, 0, -D, -W + 0.1, H, D).box('red', W - 0.1, 0, -D, W, H, D);
    m.box('red', -W, 0, D - 0.1, -DW, H, D).box('red', DW, 0, D - 0.1, W, H, D);
    if (!cut) { m.box('red', -DW, DH, D - 0.1, DW, H, D); soft('dark', -W + 0.05, H - 0.04, -D + 0.05, W - 0.05, H, D - 0.05); }   // (el dintel y el techo, por dentro)
    soft('straw', -W + 0.1, 0, -D + 0.1, W - 0.1, 0.04, D - 0.1);
    for (const x of [-1.05, 1.05]) soft('white', x - 0.04, 0.05, -D + 0.1, x + 0.04, 0.72, -0.25);   // los cercados
    soft('hay', -W + 0.14, 0.04, -D + 0.14, -1.15, 0.62, -0.5); soft('hay', 1.15, 0.04, -D + 0.14, W - 0.14, 0.42, -0.5);
    // Las esquinas y las vigas, en blanco
    for (const x of [-W - 0.03, W - 0.07]) for (const z of [-D - 0.03, D - 0.07]) m.box('white', x, 0, z, x + 0.1, H, z + 0.1);
    if (!cut) { soft('white', -W, H - 0.1, D, W, H, D + 0.02); soft('white', -W - 0.02, H - 0.1, -D, -W, H, D); soft('white', W, H - 0.1, -D, W + 0.02, H, D); roofPrism(m, 'dark', -W - 0.2, W + 0.2, -D - 0.25, D + 0.25, H, 1.1); }
    // El marco de la puerta y sus dos hojas: juntas si está cerrada; abiertas hacia los lados si no
    soft('white', -DW - 0.08, 0, D, -DW, DH + 0.08, D + 0.03); soft('white', DW, 0, D, DW + 0.08, DH + 0.08, D + 0.03); soft('white', -DW - 0.08, DH, D, DW + 0.08, DH + 0.08, D + 0.03);
    const leaf = (x0, x1, z0, z1) => {
      soft('dark', x0, 0.02, z0, x1, DH - 0.02, z1);
      const out = [[0.02, 0.12], [DH / 2 - 0.05, DH / 2 + 0.05], [DH - 0.12, DH - 0.02]];
      for (const [y0, y1] of out) soft('white', x0 - 0.005, y0, z0 - 0.005, x1 + 0.005, y1, z1 + 0.005);
    };
    if (shut) { leaf(-DW, -0.01, D, D + 0.05); leaf(0.01, DW, D, D + 0.05); }
    else { leaf(-DW - 0.05, -DW, D, D + DW); leaf(DW, DW + 0.05, D, D + DW); }
    // Las ventanas de los lados y una bala de heno a la puerta
    if (!cut) for (const x of [-1.42, 1.42]) { soft('white', x - 0.3, 0.9, D, x + 0.3, 1.42, D + 0.015); soft('soot', x - 0.24, 0.96, D + 0.01, x + 0.24, 1.36, D + 0.02); soft('white', x - 0.02, 0.96, D + 0.01, x + 0.02, 1.36, D + 0.03); }
    soft('hay', 1.05, 0, D + 0.02, 1.75, 0.48, D + 0.5);
  },
  barra(m) {   // la barra de la taberna: se une a la de al lado
    m.box('wood', -0.5, 0, -0.26, 0.5, 0.86, 0.26).box('light', -0.5, 0.86, -0.34, 0.5, 0.93, 0.34).box('dark', -0.5, 0, 0.26, 0.5, 0.1, 0.3);
    for (const x of [-0.32, 0.32]) m.box('dark', x - 0.03, 0.1, 0.26, x + 0.03, 0.86, 0.28);
    m.cyl('iron', 0.18, 0.93, 0.08, 0.055, 0.055, 0.13, 8).cyl('hay', 0.18, 1.06, 0.08, 0.05, 0.05, 0.015, 8);   // una jarra
  },
  barril(m) {
    // Panzudo, de dieciséis duelas que se ven una a una, tres aros de hierro y la tapa de tablas
    m.geo('wood', barrelGeo(), 0, 0, 0);
    for (const y of [0.1, 0.42, 0.74]) { const r = 0.272 + 0.05 * Math.sin(Math.PI * (y + 0.02) / 0.84); m.cyl('iron', 0, y, 0, r, r, 0.045, 16); }
    for (let i = -2; i <= 2; i++) m.box('light', i * 0.1 - 0.048, 0.81, -0.24, i * 0.1 + 0.048, 0.83, 0.24);
    m.box('dark', -0.03, 0.2, 0.3, 0.03, 0.26, 0.38);   // la espita
  },
  taburete(m) {
    for (const [a, b] of [[-0.14, -0.14], [0.1, -0.14], [-0.14, 0.1], [0.1, 0.1]]) m.box('dark', a, 0, b, a + 0.04, 0.6, b + 0.04);
    m.box('dark', -0.14, 0.24, -0.14, 0.14, 0.27, 0.14);
    m.cyl('wood', 0, 0.6, 0, 0.2, 0.2, 0.05, 10);
  },
  // The barber's chair: an iron foot and column, a wooden seat and arms with leather, a leaning back with its headrest and a
  // footrest in front (Plan E §4.3). The seat's top, at 0.53 (rest.js BARBER)
  barber_chair(m) {
    m.cyl('iron', 0, 0, 0, 0.27, 0.25, 0.035, 14).cyl('iron', 0, 0.035, 0, 0.11, 0.06, 0.06, 10).cyl('iron', 0, 0.09, 0, 0.05, 0.05, 0.28, 8);
    m.box('dark', -0.25, 0.37, -0.25, 0.25, 0.44, 0.24);                                             // the seat's frame
    m.box('leather', -0.23, 0.44, -0.22, 0.23, 0.53, 0.23, 0.6);                                     // its cushion
    m.geo('dark', new THREE.BoxGeometry(0.46, 0.66, 0.04), 0, 0.8, -0.285, [-0.14, 0, 0]);           // the back, leaning
    for (const [y, h] of [[0.665, 0.2], [0.885, 0.2]]) m.geo('leather', new THREE.BoxGeometry(0.4, h, 0.07), 0, y, -0.222 - (y - 0.6) * 0.141, [-0.14, 0, 0]);
    m.geo('iron', new THREE.BoxGeometry(0.03, 0.22, 0.02), 0, 1.16, -0.335, [-0.14, 0, 0]).geo('leatherD', new THREE.BoxGeometry(0.2, 0.11, 0.07), 0, 1.23, -0.315, [-0.14, 0, 0]);   // the headrest
    for (const s of [-1, 1]) {
      const x0 = s < 0 ? -0.31 : 0.25;
      m.box('iron', s * 0.28 - 0.015, 0.42, 0.15, s * 0.28 + 0.015, 0.68, 0.18).box('iron', s * 0.28 - 0.015, 0.42, -0.2, s * 0.28 + 0.015, 0.68, -0.17);
      m.box('wood', x0, 0.68, -0.25, x0 + 0.06, 0.715, 0.22).box('leatherD', x0 + 0.005, 0.715, -0.12, x0 + 0.055, 0.735, 0.19);   // the arms
      m.geo('iron', new THREE.BoxGeometry(0.025, 0.025, 0.36), s * 0.15, 0.275, 0.34, [0.82, 0, 0]);   // the footrest's bars
    }
    m.box('dark', -0.2, 0.13, 0.36, 0.2, 0.155, 0.48).box('iron', -0.18, 0.155, 0.38, 0.18, 0.16, 0.395).box('iron', -0.18, 0.155, 0.43, 0.18, 0.16, 0.445);
  },
  pew(m) { pew(m); },   // (chapel3d.js)
  colmena(m) {
    for (const [x, z] of [[-0.25, -0.2], [0.21, -0.2], [-0.25, 0.16], [0.21, 0.16]]) m.box('dark', x, 0, z, x + 0.04, 0.3, z + 0.04);
    m.box('wood', -0.3, 0.3, -0.25, 0.3, 0.34, 0.25);
    for (let i = 0; i < 3; i++) m.box(i % 2 ? 'quiltB' : 'white', -0.26, 0.34 + i * 0.2, -0.22, 0.26, 0.52 + i * 0.2, 0.22);
    m.box('wood', -0.3, 0.94, -0.26, 0.3, 1.0, 0.26).box('soot', -0.08, 0.36, 0.22, 0.08, 0.39, 0.23);
    for (let i = 0; i < 5; i++) m.ball('bee', Math.sin(i * 2.1) * 0.35, 0.6 + (i % 3) * 0.15, 0.3 + Math.cos(i * 1.3) * 0.15, 0.025, 0.02, 0.03, 6);
  },
  comedero(m, level, kind) {
    m.box('wood', -0.48, 0.12, -0.25, 0.48, 0.16, 0.25).box('wood', -0.48, 0.16, -0.25, 0.48, 0.42, -0.21).box('wood', -0.48, 0.16, 0.21, 0.48, 0.42, 0.25).box('wood', -0.48, 0.16, -0.21, -0.44, 0.42, 0.21).box('wood', 0.44, 0.16, -0.21, 0.48, 0.42, 0.21);
    for (const x of [-0.42, 0.36]) m.box('dark', x, 0, -0.2, x + 0.06, 0.12, 0.2);
    troughFill(m, level, kind);   // (soil3d.js)
  },
  compost_bin(m, level) { compostBin(m, level); },
  manure_heap(m, size) { manureHeap(m, +size || 2); },
  // Granja, segunda parte
  silo(m) {
    m.cyl('stone', 0, 0, 0, 0.42, 0.42, 0.25, 16).cyl('white', 0, 0.25, 0, 0.4, 0.4, 1.9, 16);
    for (const y of [0.7, 1.2, 1.7]) m.cyl('iron', 0, y, 0, 0.41, 0.41, 0.04, 16);
    m.geo('red', DOME ||= new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0, 2.15, 0, [0, 0, 0], [0.43, 0.32, 0.43]);
    m.box('dark', -0.12, 0.25, 0.38, 0.12, 0.75, 0.42).box('dark', 0.34, 0.25, 0.2, 0.38, 2.1, 0.24);
    for (let y = 0.4; y < 2.1; y += 0.22) m.box('dark', 0.3, y, 0.2, 0.42, y + 0.03, 0.24);
  },
  cuadra(m) {
    m.box('wood', -0.48, 0, -0.45, 0.48, 1.15, 0.45, 0.5);
    for (const x of [-0.5, 0.42]) for (const z of [-0.47, 0.39]) m.box('dark', x, 0, z, x + 0.08, 1.15, z + 0.08);
    roofPrism(m, 'dark', -0.6, 0.6, -0.55, 0.55, 1.15, 0.45);
    m.box('soot', -0.3, 0, 0.45, 0.3, 0.95, 0.46).box('light', -0.3, 0, 0.46, 0.3, 0.5, 0.5).box('dark', -0.3, 0.5, 0.46, 0.3, 0.54, 0.5);
    m.box('dark', -0.3, 0, 0.47, -0.26, 0.95, 0.5).box('dark', 0.26, 0, 0.47, 0.3, 0.95, 0.5).box('dark', -0.3, 0.92, 0.47, 0.3, 0.96, 0.5);
    m.box('hay', 0.32, 0, 0.5, 0.5, 0.22, 0.75).box('hay', 0.3, 0.22, 0.52, 0.46, 0.36, 0.72);
    m.geo('steel', new THREE.TorusGeometry(0.05, 0.012, 4, 10), 0, 0.82, 0.48);
  },
  conejera(m) {
    for (const [x, z] of [[-0.4, -0.25], [0.36, -0.25], [-0.4, 0.21], [0.36, 0.21]]) m.box('dark', x, 0, z, x + 0.04, 0.3, z + 0.04);
    m.box('light', -0.44, 0.3, -0.3, 0.44, 0.34, 0.3).box('light', -0.44, 0.34, -0.3, 0.44, 0.74, -0.26).box('light', -0.44, 0.34, -0.26, -0.4, 0.74, 0.3).box('light', 0.4, 0.34, -0.26, 0.44, 0.74, 0.3);
    m.box('light', 0.08, 0.34, 0.26, 0.44, 0.74, 0.3).box('straw', -0.4, 0.34, -0.26, 0.4, 0.38, 0.26);
    for (let x = -0.38; x < 0.08; x += 0.07) m.box('steel', x, 0.34, 0.27, x + 0.012, 0.74, 0.285);
    m.box('steel', -0.4, 0.53, 0.27, 0.08, 0.542, 0.285);
    roofPrism(m, 'red', -0.5, 0.5, -0.36, 0.36, 0.74, 0.2);
  },
  caseta(m) {
    m.box('light', -0.34, 0, -0.32, 0.34, 0.5, 0.3);
    roofPrism(m, 'red', -0.42, 0.42, -0.38, 0.36, 0.5, 0.3);
    m.box('soot', -0.14, 0, 0.3, 0.14, 0.34, 0.31).box('dark', -0.17, 0.34, 0.3, 0.17, 0.38, 0.33);
    m.cyl('steel', 0.3, 0, 0.48, 0.1, 0.09, 0.06, 12).cyl('soil', 0.3, 0.04, 0.48, 0.08, 0.08, 0.02, 10);
    m.box('white', -0.2, 0.01, 0.4, -0.02, 0.04, 0.46).ball('white', -0.22, 0.03, 0.43, 0.03).ball('white', 0, 0.03, 0.43, 0.03);   // un hueso
  },
  cojin(m) {
    m.cyl('quiltK', 0, 0, 0, 0.3, 0.28, 0.1, 16).cyl('cloth', 0, 0.1, 0, 0.22, 0.2, 0.02, 14);
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; m.ball('quiltB', Math.cos(a) * 0.29, 0.06, Math.sin(a) * 0.29, 0.035); }
  },
  palomar(m) {
    m.box('dark', -0.05, 0, -0.05, 0.05, 1.3, 0.05).box('dark', -0.22, 0, -0.03, 0.22, 0.04, 0.03);
    m.box('white', -0.3, 1.3, -0.24, 0.3, 1.72, 0.24).box('light', -0.34, 1.26, -0.28, 0.34, 1.3, 0.32);
    roofPrism(m, 'red', -0.38, 0.38, -0.3, 0.3, 1.72, 0.22);
    for (const x of [-0.15, 0.15]) { m.box('soot', x - 0.07, 1.42, 0.24, x + 0.07, 1.58, 0.25); m.box('light', x - 0.1, 1.38, 0.25, x + 0.1, 1.4, 0.32); }
    m.ball('white', 0.16, 1.47, 0.29, 0.05, 0.045, 0.06).ball('steel', 0.16, 1.53, 0.31, 0.03);   // una paloma asomada
  },
  incubadora(m) {
    m.box('copper', -0.3, 0, -0.24, 0.3, 0.42, 0.24).box('wood', -0.32, 0.42, -0.26, 0.32, 0.46, 0.26);
    m.box('glass', -0.26, 0.46, -0.2, 0.26, 0.64, 0.2).box('dark', -0.3, 0.64, -0.24, 0.3, 0.68, 0.24);
    m.box('straw', -0.24, 0.46, -0.18, 0.24, 0.5, 0.18);
    for (const [x, z] of [[-0.1, -0.05], [0.08, 0.04], [0.0, -0.08]]) m.ball('white', x, 0.55, z, 0.045, 0.06, 0.045);
    m.box('lamp', -0.04, 0.6, -0.04, 0.04, 0.64, 0.04).ball('ember', 0.2, 0.28, 0.25, 0.025);
    m.light(0, 0.7, 0, { color: '#ffc070', intensity: 0.8, range: 2.5 });
  },
  // Alambique: base de piedra, el quemador encendido, el soporte y tres frascos de colores
  alambique(m) {
    m.cyl('stone', 0, 0, 0, 0.36, 0.34, 0.12, 12).cyl('dark', 0, 0.12, 0, 0.05, 0.05, 0.8, 8);
    m.cyl('iron', 0, 0.12, 0, 0.12, 0.1, 0.1, 10).ball('ember', 0, 0.26, 0, 0.05, 0.04, 0.05);
    m.box('dark', -0.3, 0.5, -0.02, 0.3, 0.53, 0.02).box('dark', -0.02, 0.5, -0.3, 0.02, 0.53, 0.3);
    for (const [x, z] of [[-0.24, 0], [0.24, 0], [0, 0.24]]) { m.cyl('glass', x, 0.3, z, 0.07, 0.05, 0.2, 10).cyl('wood', x, 0.5, z, 0.025, 0.025, 0.05, 6); }
    m.ball('red', -0.24, 0.36, 0, 0.055, 0.05, 0.055).ball('quiltB', 0.24, 0.36, 0, 0.055, 0.05, 0.055).ball('lamp', 0, 0.36, 0.24, 0.055, 0.05, 0.055);
    m.light(0, 0.35, 0, { color: '#ff9a4a', intensity: 0.6, range: 2 });
  },
  quesera(m) {
    for (const x of [-0.36, 0.3]) m.box('dark', x, 0, -0.2, x + 0.06, 1.05, -0.14).box('dark', x, 0, 0.14, x + 0.06, 1.05, 0.2);
    m.box('wood', -0.4, 0.3, -0.24, 0.4, 0.36, 0.24).box('wood', -0.4, 0.95, -0.2, 0.4, 1.05, 0.2);
    m.cyl('quiltB', 0, 0.36, 0, 0.2, 0.2, 0.16, 16).cyl('wood', 0, 0.52, 0, 0.22, 0.22, 0.05, 16);
    m.cyl('iron', 0, 0.57, 0, 0.03, 0.03, 0.38, 8).box('iron', -0.18, 0.86, -0.015, 0.18, 0.89, 0.015);
    m.cyl('quiltB', -0.25, 0, 0.32, 0.12, 0.12, 0.1, 14).cyl('quiltB', 0.22, 0, 0.34, 0.1, 0.1, 0.08, 14);
  },
  vitrina(m) {
    m.box('dark', -0.4, 0, -0.3, 0.4, 0.7, 0.3).box('wood', -0.42, 0.7, -0.32, 0.42, 0.74, 0.32).box('dark', -0.42, 1.36, -0.32, 0.42, 1.4, 0.32);
    for (const [x, z] of [[-0.42, -0.32], [0.38, -0.32], [-0.42, 0.28], [0.38, 0.28]]) m.box('dark', x, 0.74, z, x + 0.04, 1.36, z + 0.04);
    m.box('glass', -0.38, 0.74, -0.28, 0.38, 1.36, 0.28);
    m.geo('crystal', ICO, -0.12, 0.85, 0, [0.3, 0.2, 0], 0.08).geo('gold', ICO, 0.14, 0.82, 0.05, [0, 0, 0], 0.06).ball('white', 0.02, 0.8, -0.1, 0.06, 0.04, 0.05);
  },
  chimenea(m) {
    m.box('stone', -0.48, 0, -0.34, -0.26, 1.25, 0.26, 0.6).box('stone', 0.26, 0, -0.34, 0.48, 1.25, 0.26, 0.6).box('stone', -0.48, 0.95, -0.34, 0.48, 1.25, 0.26, 0.6);
    m.box('dark', -0.56, 1.25, -0.34, 0.56, 1.33, 0.34).box('stone', -0.26, 0, -0.34, 0.26, 0.95, -0.26, 0.6).box('soot', -0.26, 0, -0.26, 0.26, 0.95, -0.24);
    m.box('stone', -0.54, 0, 0.26, 0.54, 0.07, 0.5, 0.6).box('stone', -0.4, 1.33, -0.34, 0.4, 2.8, 0.14, 0.6);
    for (const s of [1, -1]) m.box('dark', -0.2, 0.04, -0.06 + s * 0.04, 0.2, 0.12, 0.04 + s * 0.04);
    m.fire(0, 0.12, 0, 0.75).light(0, 0.5, 0.45, { color: '#ff9a4a', intensity: 2.6, range: 7, flicker: true, always: true });
  },
};

// How far a well goes down (n: the LV_STEP steps, 0.25 m, from its rim to the bottom of its hole; without n, for the icon
// and the preview, very little)
const wellDepth = n => (n ? Math.max(1, +n * 0.25) : 0.15);
// The well itself, going down D metres (see BUILD.pozo). k: how many times wider it will be drawn (the gaps between the
// roof's boards stay as thin)
function wellBody(m, D, k = 1) {
  const R = rng2(41), TAU = Math.PI * 2, M = new THREE.Matrix4(), Qt = new THREE.Quaternion(), E = new THREE.Euler();
  const RI = 0.345, RO = 0.47, SQ = 0.52, TOP = 0.04, CAP = 0.77, H = 0.86;   // (el hueco, el brocal por fuera, media losa, su cara de arriba, la albardilla y su remate)
  const WY = D > 1.2 ? Math.max(-D + 0.45, -1.1) : -D + 0.12;   // (el agua: a un metro largo bajo el suelo, como la del freático; en un hoyo justo, algo por encima de su fondo)
  // (sin cajas de choque: las piezas menudas no cuentan; las grandes van al final)
  const put = (key, g, x, y, z, rot = [0, 0, 0], sc = [1, 1, 1]) => m.B(key).addGeometry(g, M.compose(new THREE.Vector3(x, y, z), Qt.setFromEuler(E.set(...rot)), new THREE.Vector3(...sc)));
  // La losa: por los lados, el forro de piedra hasta el fondo; por arriba, de su borde cuadrado a la boca redonda
  const S = m.B('stone');
  S.box(-SQ, -D, -SQ, SQ, TOP, SQ, { s: 0.6, skip: 'py ny' });
  const NQ = 32, sq = a => { const c = Math.cos(a), sn = Math.sin(a), k = SQ / Math.max(Math.abs(c), Math.abs(sn)); return [c * k, sn * k]; };
  for (let i = 0; i < NQ; i++) {
    const a = (i / NQ) * TAU, b = ((i + 1) / NQ) * TAU, [x0, z0] = sq(a), [x1, z1] = sq(b), up = [0, 1, 0];
    quad4(S, [[Math.cos(a) * RI, TOP, Math.sin(a) * RI], [Math.cos(b) * RI, TOP, Math.sin(b) * RI], [x1, TOP, z1], [x0, TOP, z0]], [up, up, up, up], [[Math.cos(a) * RI / 0.6, Math.sin(a) * RI / 0.6], [Math.cos(b) * RI / 0.6, Math.sin(b) * RI / 0.6], [x1 / 0.6, z1 / 0.6], [x0 / 0.6, z0 / 0.6]]);
  }
  // El forro de dentro, de la boca al agua: más oscuro cuanto más hondo (lo que le llega de luz)
  const ys = [TOP, -0.25, -0.6, -1.1, -1.7, -2.5, -3.5, -5, -7, -10, -14, -20].filter(y => y > WY - 0.02).concat([WY - 0.02]);
  tube(m.B('wellShaft'), RI, ys, true, { tone: y => (y > 0 ? 0.92 : 0.16 + 0.72 * Math.exp(y / 0.55)) });
  // El agua, quieta
  put('wellWater', CIRCLE, 0, WY, 0, [-Math.PI / 2, 0, 0], [RI + 0.01, RI + 0.01, 1]);
  // El brocal: tres hiladas de sillares a matajunta (cada uno de su largo y algo salido o metido) sobre un núcleo de
  // argamasa que asoma en las juntas, y encima la albardilla de losas que vuelan un poco por los dos lados
  const A = m.B('ashlar'), ch = 0.018;
  tube(m.B('sand'), RO - 0.012, [TOP, CAP], false, { seg: 24 });
  tube(m.B('sand'), RI + 0.015, [TOP, CAP], true, { seg: 24 });
  for (let k = 0; k < 3; k++) {
    const y0 = TOP + k * 0.245, y1 = y0 + 0.235, nS = 10, lens = Array.from({ length: nS }, () => 0.82 + R() * 0.36), sum = lens.reduce((t, v) => t + v, 0);
    let a = ((k % 2 ? 0.5 : 0) + R() * 0.2) * (TAU / nS);
    for (const l of lens) {
      const b = a + (l / sum) * TAU, out = RO + (R() - 0.5) * 0.016, inn = RI + 0.003 + R() * 0.006, gap = 0.012 / out;
      sweep(R() < 0.28 ? m.B('marbleD') : A, [[inn, y0], [out, y0], [out, y1 - ch], [out - ch, y1], [inn + ch, y1], [inn, y1 - ch]], a + gap / 2, b - gap / 2, 0.55);   // (alguno, de otra cantera)
      a = b;
    }
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.2, b = ((i + 1) / 8) * TAU + 0.2, gap = 0.01 / 0.5, y1 = H - R() * 0.008;
    sweep(A, [[RI - 0.025, CAP], [RO + 0.04, CAP], [RO + 0.04, y1 - 0.02], [RO + 0.02, y1], [RI - 0.005, y1], [RI - 0.025, y1 - 0.02]], a + gap / 2, b - gap / 2, 0.55);
  }
  // Los postes, metidos en el brocal, la cumbrera encima y el tejadillo de tablillas a dos aguas (las de arriba montan
  // sobre las de abajo), con sus cabios y los remates de los lados
  const PX = 0.405, YR = 2.36, TH = 0.6, ZE = 0.68, L = ZE / Math.cos(TH);
  for (const sx of [-1, 1]) m.box('wood', sx * PX - 0.055, 0.5, -0.055, sx * PX + 0.055, YR - 0.1, 0.055);
  m.box('dark', -0.66, YR - 0.12, -0.05, 0.66, YR - 0.02, 0.05);
  const slope = (sz, sAt, h) => [YR - sAt * Math.sin(TH) + h * Math.cos(TH), sz * (sAt * Math.cos(TH) + h * Math.sin(TH))];
  for (const sz of [-1, 1]) {
    for (const x of [-0.62, -PX, PX, 0.62]) { const [y, z] = slope(sz, L / 2, -0.04); put('dark', BOXG, x, y, z, [sz * TH, 0, 0], [0.05, 0.06, L]); }
    for (let r = 0; r < 4; r++) {
      const s0 = 0.03 + r * 0.205, len = r === 3 ? L + 0.07 - s0 : 0.27;
      for (let i = 0; i < 8; i++) {
        const w = 1.36 / 8, x = -0.68 + (i + 0.5) * w + (R() - 0.5) * 0.01, l = len + (R() - 0.5) * 0.03, [y, z] = slope(sz, s0 + l / 2, 0.012 + (3 - r) * 0.011 + R() * 0.004);
        put(R() < 0.3 ? 'dark' : 'hull', BOXG, x, y, z, [sz * TH + (R() - 0.5) * 0.03, 0, (R() - 0.5) * 0.02], [w - 0.008 / k, 0.022, l]);
      }
    }
  }
  put('dark', BOXG, 0, YR + 0.045, 0, [0, 0, 0], [1.38, 0.05, 0.13]);   // (el caballete de arriba)
  m.solids.push([-0.69, YR - 0.5, -ZE - 0.05, 0.69, YR + 0.08, ZE + 0.05]);
  // El torno: el rollo con la cuerda enrollada, los pernos por los postes y la manivela por fuera, a la derecha
  const AY = 1.52;
  m.cyl('light', -0.35, AY, 0, 0.07, 0.07, 0.7, 12, [0, 0, -Math.PI / 2]);
  put('iron', cylGeo(0.022, 0.022, 1.02, 6), -0.51, AY, 0, [0, 0, -Math.PI / 2]);
  for (let i = 0; i < 13; i++) put('rope', cylGeo(0.084, 0.084, 0.02, 10), -0.16 + i * 0.025, AY, 0, [0, 0, -Math.PI / 2]);
  put('iron', BOXG, 0.5, AY - 0.1, 0, [0, 0, 0], [0.03, 0.24, 0.035]);
  put('dark', cylGeo(0.022, 0.022, 0.13, 8), 0.5, AY - 0.2, 0, [0, 0, -Math.PI / 2]);
  // El cubo, colgado sobre la boca y lleno de agua: duelas, dos aros, el asa y la cuerda que baja del torno
  const BX = 0.05, BZ = 0.084, BY = 0.66, BH = 0.24;
  m.cyl('wood', BX, BY, BZ, 0.105, 0.13, BH, 14);
  for (const t of [0.04, 0.19]) put('iron', cylGeo(0.106 + t * 0.105 + 0.004, 0.106 + (t + 0.02) * 0.105 + 0.004, 0.02, 14), BX, BY + t, BZ);
  put('wellWater', CIRCLE, BX, BY + BH + 0.004, BZ, [-Math.PI / 2, 0, 0], [0.122, 0.122, 1]);
  put('iron', BAIL, BX, BY + BH, BZ);
  put('rope', cylGeo(0.011, 0.011, AY - (BY + BH + 0.128), 6), BX, BY + BH + 0.128, BZ);
  // (la losa con su forro y el brocal, cada uno un anillo de cuatro cajas alrededor de la boca, que queda hueca: una
  // flecha que entra por ella cae al agua, y la que da en la piedra se clava en la piedra, no en el aire de encima; y
  // los postes. Al andar choca la caja que envuelve lo bajo: ver world/scenes.js, freeObject)
  const ring = (y0, y1, o) => { const i = RI - 0.005; m.solids.push([-o, y0, -o, o, y1, -i], [-o, y0, i, o, y1, o], [-o, y0, -i, -i, y1, i], [i, y0, -i, o, y1, i]); };
  ring(-D, TOP + 0.002, SQ); ring(TOP, H, RO + 0.04);   // (la losa, un pelo más alta: lo que no sube de 0,04 no cuenta, ver SOLIDS.of)
  for (const sx of [-1, 1]) m.solids.push([sx * PX - 0.055, H, -0.055, sx * PX + 0.055, YR - 0.1, 0.055]);
}
// The big well: the small one twice as wide (x and z), and taller by less, so its rim stays at the waist (KNEE, the top of
// the rim, goes up LOW times) and, above it, the posts and the roof go up HIGH times: the roof keeps most of its slope and
// does not look squashed. Its lining goes down to the bottom of the hole all the same (the body is built for D / LOW).
// Keep LOW in step with WELLS.big_well in world/scenes.js (its water and what you bump into)
const BIG_WELL = { XZ: 2, LOW: 1.2, HIGH: 1.6, KNEE: 0.86 };
function wellStretch(m, D) {
  const { XZ, LOW, HIGH, KNEE } = BIG_WELL, src = new Model(), fy = y => (y <= KNEE ? y * LOW : KNEE * LOW + (y - KNEE) * HIGH);
  wellBody(src, D / LOW, XZ);
  for (const [key, B] of src.parts) {
    const b = new Builder();
    b.uv = B.uv.slice(); b.idx = B.idx.slice(); b.col = B.col && B.col.slice();
    for (let i = 0; i < B.pos.length; i += 3) {
      const y = B.pos[i + 1], sy = y <= KNEE ? LOW : HIGH, nx = B.nor[i] / XZ, ny = B.nor[i + 1] / sy, nz = B.nor[i + 2] / XZ, l = Math.hypot(nx, ny, nz) || 1;
      b.pos.push(B.pos[i] * XZ, fy(y), B.pos[i + 2] * XZ); b.nor.push(nx / l, ny / l, nz / l);
    }
    m.B(key).add(b);
  }
  for (const s of src.solids) m.solids.push([s[0] * XZ, fy(s[1]), s[2] * XZ, s[3] * XZ, fy(s[4]), s[5] * XZ]);
}
function roofPrism(m, key, x0, x1, z0, z1, y0, h) {
  const B = m.B(key), A = [x0, y0, z0], Bp = [x1, y0, z0], C = [x1, y0, z1], D = [x0, y0, z1], E = [x0, y0 + h, (z0 + z1) / 2], F = [x1, y0 + h, (z0 + z1) / 2];
  B.quadN(D, C, F, E, [0, 0.6, 0.8], [[x0, 0], [x1, 0], [x1, 1], [x0, 1]]);
  B.quadN(Bp, A, E, F, [0, 0.6, -0.8], [[x1, 0], [x0, 0], [x0, 1], [x1, 1]]);
  B.tri(A, D, E, [-1, 0, 0], [[z0, 0], [z1, 0], [(z0 + z1) / 2, h]]);
  B.tri(C, Bp, F, [1, 0, 0], [[z1, 0], [z0, 0], [(z0 + z1) / 2, h]]);
}

// ---------- cultivos ----------
// st: how it is besides its age (farm.js look): '' well, w wilted, f frost-bitten, o past its best, b gone to seed; dead: k of
// frost, d of drought, r rotten
const BED = 0.06;   // (they stand on the bed, not on the ground under it)
function crop(M, id, stage, st = '') {
  const m = { geo: (k, g, x, y, ...r) => M.geo(k, g, x, y + BED, ...r), cyl: (k, x, y, ...r) => M.cyl(k, x, y + BED, ...r), ball: (k, x, y, ...r) => M.ball(k, x, y + BED, ...r) };
  if (stage > 0) return crop2(m, id, stage, st);   // (con hojas de verdad: ver crop2)
  m.geo('crumb', ICO1, 0, 0.005, 0, [0, 0, 0], [0.13, 0.045, 0.13]);
  if (stage < 0) { for (let i = 0; i < 4; i++) m.cyl('dry', Math.cos(i * 1.6) * 0.06, 0.02, Math.sin(i * 1.6) * 0.06, 0.01, 0.006, 0.18, 4, [Math.sin(i) * 0.6, 0, Math.cos(i) * 0.6]); return; }
  if (stage === 0) { for (let i = 0; i < 3; i++) m.ball('crumb', Math.cos(i * 2.1) * 0.08, 0.06, Math.sin(i * 2.1) * 0.08, 0.03, 0.02, 0.03, 6); }
}
// Cultivos con hojas de verdad: alargadas, con su nervio, curvadas hacia abajo y con algo de azar en cada
// planta (fijo por especie y fase); trigo de muchas cañas con espiga, maíz de hojas largas con mazorcas, tomatera con
// tutor y racimos, calabaza acostillada y raíces que asoman. Sin tope de piezas: van al mismo material por color
// Its states (CROP_LOOK): the colour the leaves and the fruit tend to and how much, how far the leaves hang (rad) and how tall
// it stands. The same shapes and the same shared materials (the colour goes per vertex)
const CROP_LOOK = {
  '': {},
  w: { leaf: ['#8a8a52', 0.55], hang: 0.75, tall: 0.82 },
  f: { leaf: ['#1f2a22', 0.72], tips: '#5a4a30', hang: 0.3, tall: 0.95 },
  o: { leaf: ['#a89a4a', 0.5], fruit: ['#5e3a22', 0.38], hang: 0.3, tall: 0.95 },
  b: { leaf: ['#9a9a4a', 0.4], hang: 0.35, tall: 0.9 },
  k: { leaf: ['#1c1a16', 0.92], fruit: ['#241a14', 0.7], hang: 1.1, tall: 0.55 },
  d: { leaf: ['#9a7a48', 0.95], fruit: ['#6a4c2c', 0.7], hang: 0.95, tall: 0.75 },
  r: { leaf: ['#6a5834', 0.85], fruit: ['#3a2a1c', 0.82], hang: 0.8, tall: 0.75, fallen: true },
};
const mixHex = (a, [b, k]) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();
function crop2(m, id, stage, st) {
  const c = CROPS[id], L = CROP_LOOK[st] || CROP_LOOK[''], hang = L.hang || 0, TALL = L.tall || 1, ink = L.leaf ? mixHex(c.leaf, L.leaf) : c.leaf;
  const fruitKey = 'fruit:' + (L.fruit ? mixHex(c.color, L.fruit) : c.color), leafKey = 'leafc:' + ink, tipKey = L.tips ? 'leafc:' + L.tips : leafKey, R = rng2(id.length * 31 + stage * 7);
  // (a leaf: it comes out at its angle over the ground, rot[0], to its side, rot[1], and hangs if the plant is ill; low: how far
  // it can hang, so the ones by the soil lie on it. The order is YXZ: with XYZ the whole rosette tipped, half under the soil)
  const leaf = (key, x, y, z, rot, scale, low = 1.3) => m.geo(key, LEAF2, x, y, z, [Math.min(Math.max(low, rot[0]), rot[0] + hang), rot[1], rot[2], 'YXZ'], scale);
  m.geo('crumb', ICO1, 0, 0, 0, [0, 0, 0], [0.13, 0.04, 0.13]);
  const big = stage === 3 ? 1 : stage === 2 ? 0.75 : 0.45;
  // Una mata de hojas en roseta: n hojas de largo len, saliendo con la inclinación rise (cuanto más negativa, más tumbadas)
  const rosette = (n, len, rise, y = 0.03, wide = 0.28, key = leafKey, from = 0.015) => {   // (from: how far from the middle they come out)
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + R() * 0.6, l = len * (0.75 + R() * 0.45);
      leaf(i % 3 === 1 ? (key === leafKey ? tipKey : key) : key, Math.sin(a) * from, y, Math.cos(a) * from, [rise + (R() - 0.5) * 0.35, a, (R() - 0.5) * 0.3], [l * wide, l, l], -0.36 + R() * 0.14);
    }
  };
  if (id === 'trigo' || id === 'maiz') {
    const tall = (id === 'maiz' ? 1.75 : 0.85) * big * TALL, n = id === 'maiz' ? 3 : 26;
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, r = id === 'maiz' ? 0.09 * Math.sqrt(R()) : 0.17 * Math.sqrt(R()), x = Math.cos(a) * r, z = Math.sin(a) * r, h = tall * (0.85 + R() * 0.25);
      const sway = hang ? 0.15 + hang * 0.45 : 0.15, lean = [(R() - 0.5) * sway, 0, (R() - 0.5) * sway], ripe = stage === 3 && id === 'trigo';
      m.cyl(ripe ? fruitKey : leafKey, x, 0.02, z, id === 'maiz' ? 0.022 : 0.006, id === 'maiz' ? 0.014 : 0.004, h, 5, lean);
      if (id === 'trigo') { if (stage >= 2) m.geo(ripe ? fruitKey : leafKey, SPIKE, x + lean[2] * h, h, z - lean[0] * h, lean, [0.016, 0.075, 0.016]); }
      else {
        for (let k = 0; k < 6; k++) leaf(k % 3 === 1 ? tipKey : leafKey, x, 0.25 + k * h * 0.13, z, [-0.35 - R() * 0.4, a + k * 2.4, 0], [0.09, 0.55 * big, 0.55 * big]);
        if (stage === 3) for (const s of [0.45, 0.6]) m.geo(fruitKey, SPIKE, x + 0.05, h * s, z, [0.35, a, 0], [0.04, 0.2, 0.04]);
        m.geo(L.fruit ? fruitKey : 'fruit:#c9a36a', SPIKE, x, h, z, [0, 0, 0], [0.02, 0.14, 0.02]);   // (el penacho)
      }
    }
    return;
  }
  if (id === 'tomate') {
    const h = 1.1 * big * TALL;
    m.cyl('wood', 0.1, 0, 0, 0.012, 0.012, h + 0.15, 5);   // (el tutor)
    m.cyl(leafKey, 0.02, 0.02, 0, 0.012, 0.008, h, 5, [0, 0, -0.05]);
    for (let k = 0; k < Math.round(9 * big); k++) {
      const y = 0.15 + (k / 9) * h, a = k * 2.4 + R();
      for (let j = 0; j < 3; j++) leaf(j === 1 ? tipKey : leafKey, 0.02, y, 0, [-0.5 - R() * 0.5, a + (j - 1) * 0.5, 0], [0.11, 0.24, 0.24]);
    }
    if (stage === 3) for (let k = 0; k < 9; k++) { const a = k * 2.1, y = L.fallen ? 0.03 : (0.25 + (k % 4) * 0.2) * TALL, q = L.fallen ? 0.1 + (k % 3) * 0.06 : 0.12; m.ball(fruitKey, Math.cos(a) * q, y, Math.sin(a) * q, 0.045, L.fallen ? 0.025 : 0.04, 0.045, 10); }
    return;
  }
  if (id === 'calabaza') {
    if (stage === 3) rosette(8, 0.3, -0.5, 0.02, 0.9, leafKey, 0.2); else rosette(9, 0.36 * big, -0.7, 0.03, 0.85);
    if (stage === 3) { m.geo(fruitKey, PUMPKIN, 0.06, L.fallen ? 0.12 : 0.19, 0.06, [L.fallen ? 0.25 : 0, 0.4, 0], [0.26, L.fallen ? 0.12 : 0.19, 0.26]); m.cyl(leafKey, 0.06, L.fallen ? 0.13 : 0.21, 0.06, 0.018, 0.012, 0.07, 5); }
    return;
  }
  if (id === 'fresa') {
    rosette(13, 0.22 * big, -0.6, 0.02, 0.9);
    if (stage === 3) for (let k = 0; k < 7; k++) m.geo(fruitKey, CONE, Math.cos(k * 0.9) * 0.19, 0.04, Math.sin(k * 0.9) * 0.19, [Math.PI, 0, 0], [0.028, 0.05, 0.028]);
    return;
  }
  // Raíces: la zanahoria con hojas finas y altas; el nabo, más anchas. Maduras, asoma la raíz
  rosette(id === 'zanahoria' ? 18 : 10, (id === 'zanahoria' ? 0.44 : 0.36) * big, id === 'zanahoria' ? -1.05 : -0.85, 0.02, id === 'zanahoria' ? 0.2 : 0.42);
  if (st === 'b') {   // (gone to seed: a tall stalk with its branches and their heads, yellow of the turnip, white umbels of the carrot)
    const H = id === 'zanahoria' ? 0.95 : 0.85, head = id === 'zanahoria' ? 'fruit:#e4e0d0' : 'fruit:#d8c23c';
    m.cyl(leafKey, 0, 0.03, 0, 0.016, 0.009, H, 6);
    for (let i = 0; i < 7; i++) {
      const a = i * 2.4 + R() * 0.5, y = H * (0.4 + i * 0.08), l = 0.22 - i * 0.012, x = Math.cos(a), z = Math.sin(a);
      m.cyl(leafKey, 0, y, 0, 0.006, 0.004, l * 1.25, 4, [z * 0.75, 0, -x * 0.75]);
      const tx = x * l * 0.85, tz = z * l * 0.85, ty = y + l * 0.92;
      if (id === 'zanahoria') for (let k = 0; k < 6; k++) m.ball(head, tx + Math.cos(k * 1.05) * 0.035, ty, tz + Math.sin(k * 1.05) * 0.035, 0.016, 0.008, 0.016, 5);
      else for (let k = 0; k < 5; k++) m.ball(head, tx + Math.cos(k * 2.4) * 0.02, ty - 0.035 + k * 0.018, tz + Math.sin(k * 2.4) * 0.02, 0.013, 0.013, 0.013, 5);
    }
    for (let k = 0; k < 8; k++) m.ball(head, Math.cos(k * 0.8) * 0.04, H + 0.03 + (k % 3) * 0.015, Math.sin(k * 0.8) * 0.04, 0.016, 0.01, 0.016, 5);
    return;
  }
  if (stage === 3) m.ball(fruitKey, 0, 0.04, 0, 0.07, id === 'nabo' ? 0.06 : 0.04, 0.07, 10);
}
const rng2 = s => () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
// Hoja: lanceolada (ancha en el primer tercio, en punta), con el nervio marcado y curvada hacia abajo; sale hacia +z
const LEAF2 = (() => {
  const pos = [], N = 7;
  for (let i = 0; i <= N; i++) {
    const t = i / N, w = 0.5 * Math.sin(Math.PI * Math.pow(t, 0.7)) * (1 - t * 0.2), y = 0.12 * t - 0.3 * t * t, z = t;
    pos.push([-w, y - 0.02 * w, z], [0, y + 0.015, z], [w, y - 0.02 * w, z]);
  }
  const p = [];
  for (let i = 0; i < N; i++) for (const [a, b, c] of [[0, 1, 4], [0, 4, 3], [1, 2, 5], [1, 5, 4]]) { const q = k => pos[i * 3 + (k % 3) + (k >= 3 ? 3 : 0)]; p.push(...q(a), ...q(b), ...q(c)); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.computeVertexNormals();
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((p.length / 3) * 2).fill(0), 2));
  return g;
})();
// Espiga o mazorca: un huso alargado
const SPIKE = (() => { const pts = []; for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(new THREE.Vector2(Math.sin(Math.PI * t) * (0.8 + 0.2 * t), t * 2 - 1)); } return new THREE.LatheGeometry(pts, 8); })();
// Calabaza: aplastada, con ocho costillas y el hueco del rabo
const PUMPKIN = (() => {
  const g = new THREE.SphereGeometry(1, 32, 16), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x), r = 1 + 0.07 * Math.cos(a * 8), dip = 1 - 0.25 * Math.max(0, y) ** 6; p.setXYZ(i, x * r, y * dip, z * r); }
  g.computeVertexNormals(); return g;
})();


// Toldo de tela que cede entre los postes y con faldón ondulado en el borde de delante
let AWNING;
function awningGeo() {
  if (AWNING) return AWNING;
  const g = new THREE.PlaneGeometry(2.3, 1.3, 16, 8), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), u = x / 1.15, v = (y + 0.65) / 1.3;   // (v = 0: el borde de delante, el que cuelga)
    let z = -0.07 * (1 - u * u) * Math.sin(Math.PI * v) - 0.025 * (1 - u * u);
    if (v < 0.12) z -= (0.12 - v) * 1.4 * (0.8 + 0.2 * Math.cos(u * Math.PI * 4));   // el faldón, con sus ondas
    p.setZ(i, z);
  }
  g.computeVertexNormals();
  return (AWNING = g);
}

// ---------- cosas del pueblo ----------
const VILLAGE = {
  // Puesto de 2×1 casillas (el origen en su centro): mostrador, postes, toldo y cajas de fruta
  stall(m, colors = ['#d8352a', '#f0a020', '#7ac040'], awn = 'awning') {
    m.box('wood', -0.9, 0, -0.1, 0.9, 0.9, 0.4).box('dark', -0.95, 0.9, -0.15, 0.95, 0.98, 0.45);
    for (const x of [-0.88, 0.88]) for (const z of [-0.42, 0.42]) m.box('dark', x - 0.05, 0, z - 0.05, x + 0.05, 2.2, z + 0.05);
    const aw = new THREE.Mesh(awningGeo(), modelMats()[awn]); aw.position.set(0, 2.15, 0.05); aw.rotation.x = -Math.PI / 2 + 0.38; aw.castShadow = aw.receiveShadow = true; m.extra(aw);
    colors.forEach((col, i) => {
      const x = -0.6 + i * 0.6; m.box('dark', x - 0.24, 0.98, -0.05, x + 0.24, 1.12, 0.32);
      for (let k = 0; k < 8; k++) m.ball('fruit:' + col, x - 0.15 + (k % 4) * 0.1, 1.15 + (k > 3 ? 0.03 : 0), 0.05 + (k > 3 ? 0.15 : 0), 0.06, 0.06, 0.06, 8);
    });
  },
  board(m) {
    for (const dx of [-0.55, 0.5]) m.box('dark', dx, 0, -0.04, dx + 0.08, 1.9, 0.04);
    m.box('dark', -0.62, 1.86, -0.2, 0.65, 1.92, 0.2).box('wood', -0.5, 0.93, -0.03, 0.52, 1.68, 0.02);
    m.B('notes').quad([-0.48, 0.95, 0.025], [0.5, 0.95, 0.025], [0.5, 1.66, 0.025], [-0.48, 1.66, 0.025], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  },
  // The rural mailbox by the plaza: painted sheet metal on a wooden post, door in front, flag raised (mailbox3d.js)
  mailbox(m) { mailbox(m); },
  lamp(m) {
    m.cyl('stone', 0, 0, 0, 0.2, 0.16, 0.3, 10).cyl('iron', 0, 0.3, 0, 0.06, 0.045, 2.6, 8);
    m.cyl('lamp', 0, 2.84, 0, 0.1, 0.13, 0.32, 6).geo('iron', CONE, 0, 3.25, 0, [0, 0, 0], [0.2, 0.18, 0.2]);
    m.light(0, 2.9, 0, { color: '#ffc070', intensity: 6, range: 12, pool: 3.5 });   // (pool: su charco de luz en el suelo, ver glow.js)
  },
  sign(m) {
    m.box('dark', -0.05, 0, -0.05, 0.05, 1.5, 0.05);
    const s = new THREE.Shape([[-0.42, -0.14], [0.3, -0.14], [0.44, 0], [0.3, 0.14], [-0.42, 0.14]].map(([a, c]) => new THREE.Vector2(a, c)));
    m.geo('wood', new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: false }), 0.05, 1.25, -0.025);
  },
  // The 3×3 plaza fountain: stone basin, baluster and bowl, real water, the jet, the falling sheet and the spray (fountain3d.js)
  fountain(m) { fountain(m, modelMats().water); },
  // Muelle de 4×1 casillas sobre el agua
  dock(m) {
    for (let i = 0; i < 9; i++) m.box('plank', -2 + i * 0.44, 0.0, -0.5, -2 + i * 0.44 + 0.4, 0.08, 0.5);
    for (const x of [-1.9, 0, 1.9]) for (const z of [-0.45, 0.45]) m.cyl('dark', x, -1, z, 0.07, 0.07, 1.25, 8);
  },
};

// ---------- lugares ----------
// A la escala de las personas (puertas de 2 m y pico), con cada sillar y cada roca de verdad
const ROCKG = [];
const rockG = i => (ROCKG[i] ||= rockGeo(i + 1));
// Un tejado a dos aguas con la cumbrera a lo largo de z (los frontones, delante y detrás)
function roofPrismZ(m, key, x0, x1, z0, z1, y0, h) {
  const B = m.B(key), xm = (x0 + x1) / 2, A = [x0, y0, z1], Bp = [x1, y0, z1], C = [x1, y0, z0], D = [x0, y0, z0], E = [xm, y0 + h, z1], F = [xm, y0 + h, z0];
  B.quadN(D, A, E, F, [-0.6, 0.8, 0], [[z0, 0], [z1, 0], [z1, 1], [z0, 1]]);
  B.quadN(Bp, C, F, E, [0.6, 0.8, 0], [[z1, 0], [z0, 0], [z0, 1], [z1, 1]]);
  B.tri(A, Bp, E, [0, 0, 1], [[x0, 0], [x1, 0], [xm, h]]);
  B.tri(C, D, F, [0, 0, -1], [[x1, 0], [x0, 0], [xm, h]]);
}
// Una columna de tambores (con su basa y, si está entera, su capitel), de h metros; si no, rota a esa altura
function column(m, key, x, z, h, whole, R, r = 0.24) {
  m.box(key, x - r * 1.25, 0, z - r * 1.25, x + r * 1.25, 0.18, z + r * 1.25, 0.6);
  for (let y = 0.18; y < h - 0.05; y += 0.55) { const top = Math.min(h, y + 0.55); m.cyl(key, x, y, z, r, r * 0.97, top - y - 0.012, 16, [0, R() * 6, 0]); }
  if (whole) m.box(key, x - r * 1.35, h, z - r * 1.35, x + r * 1.35, h + 0.2, z + r * 1.35, 0.6);
}
// La torre vieja, por dentro y por fuera (las medidas, de world/tower.js): el muro redondo con la puerta, las saeteras, el
// pilar, la escalera de caracol, la terraza con su hueco y las almenas
// (h: how tall; rock: of what stone: biomes.js, stoneOf. foot: how far down the base goes of one that is built, on ground that is
// not level)
function bigTower(m, h = TOWER.H, rock = 'limestone', foot = 0) {
  const tone = rock === 'granite' || rock === 'slate' ? '_' + rock : '', WALL = 'towerWall' + tone, STONE = 'towerStone' + tone;
  const T = TOWER, B = m.B(WALL), S = m.B(STONE), N = 56, TAU = Math.PI * 2, R = T.R, Ri = T.inner, H = h, DOOR = 2.2, TOPW = H + 0.5;
  const P = (a, r, y) => [Math.sin(a) * r, y, Math.cos(a) * r];
  // El muro: por fuera y por dentro (junto a la puerta, desde lo alto de ella), y su remate con las almenas
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * TAU, a1 = ((i + 1) / N) * TAU, am = (a0 + a1) / 2, door = am > T.door[0] && am < T.door[1], u0 = a0 * R, u1 = a1 * R, y0 = door ? DOOR : 0;
    B.quadN(P(a0, R, y0), P(a1, R, y0), P(a1, R, TOPW), P(a0, R, TOPW), [Math.sin(am), 0, Math.cos(am)], [[u0 / 2, y0 / 2], [u1 / 2, y0 / 2], [u1 / 2, TOPW / 2], [u0 / 2, TOPW / 2]]);
    B.quadN(P(a1, Ri, y0), P(a0, Ri, y0), P(a0, Ri, TOPW), P(a1, Ri, TOPW), [-Math.sin(am), 0, -Math.cos(am)], [[u1 / 2, y0 / 2], [u0 / 2, y0 / 2], [u0 / 2, TOPW / 2], [u1 / 2, TOPW / 2]]);
    if (door) B.quadN(P(a0, Ri, DOOR), P(a1, Ri, DOOR), P(a1, R, DOOR), P(a0, R, DOOR), [0, -1, 0], [[0, 0], [1, 0], [1, 0.25], [0, 0.25]]);   // (el dintel por debajo)
    B.quadN(P(a0, Ri, TOPW), P(a1, Ri, TOPW), P(a1, R, TOPW), P(a0, R, TOPW), [0, 1, 0], [[0, 0], [1, 0], [1, 0.25], [0, 0.25]]);
    if (i % 2 === 0) {   // (una almena de cada dos tramos)
      const b0 = a0 + 0.015, b1 = a1 - 0.015, z1 = H + T.parapet;
      B.quadN(P(b0, R, TOPW), P(b1, R, TOPW), P(b1, R, z1), P(b0, R, z1), [Math.sin(am), 0, Math.cos(am)], [[0, 0], [0.4, 0], [0.4, 0.3], [0, 0.3]]);
      B.quadN(P(b1, Ri, TOPW), P(b0, Ri, TOPW), P(b0, Ri, z1), P(b1, Ri, z1), [-Math.sin(am), 0, -Math.cos(am)], [[0, 0], [0.4, 0], [0.4, 0.3], [0, 0.3]]);
      for (const [b, sg] of [[b0, -1], [b1, 1]]) B.quadN(P(b, Ri, TOPW), P(b, R, TOPW), P(b, R, z1), P(b, Ri, z1), [sg * Math.cos(b), 0, -sg * Math.sin(b)], [[0, 0], [0.25, 0], [0.25, 0.3], [0, 0.3]]);
      B.quadN(P(b0, Ri, z1), P(b1, Ri, z1), P(b1, R, z1), P(b0, R, z1), [0, 1, 0], [[0, 0], [0.4, 0], [0.4, 0.25], [0, 0.25]]);
    }
  }
  // Las jambas de la puerta (lo grueso del muro, a los lados)
  for (const [a, sg] of [[T.door[0], 1], [T.door[1], -1]]) B.quadN(P(a, Ri, 0), P(a, R, 0), P(a, R, DOOR), P(a, Ri, DOOR), [sg * Math.cos(a), 0, -sg * Math.sin(a)], [[0, 0], [0.25, 0], [0.25, 1.1], [0, 1.1]]);
  // Saeteras: unas rendijas oscuras por fuera, a distintas alturas
  for (let k = 0, y; (y = 3 + k * 1.3) < H - 1; k++) { const a = 1.2 + k * 0.85; m.geo('towerDark', BOXG, Math.sin(a) * (R + 0.01), y, Math.cos(a) * (R + 0.01), [0, a, 0], [0.16, 0.9, 0.04]); }
  // El pilar y el suelo de dentro
  m.cyl(STONE, 0, 0, 0, T.r0, T.r0, H, 14);
  m.geo(STONE, CIRCLE, 0, foot ? 0.045 : 0.02, 0, [-Math.PI / 2, 0, 0], [Ri, Ri, 1]);
  // La escalera: peldaños del pilar al muro, cada uno a la altura de la rampa que se anda
  const n = Math.round(H / T.pitch * T.stepsPerTurn), da = TAU / T.stepsPerTurn, rm = (T.r0 + Ri) / 2, len = Ri - T.r0 + 0.06;
  for (let k = 0; k < n; k++) {
    const a = (k + 0.5) * da, top = ((k + 0.75) / T.stepsPerTurn) * T.pitch;
    m.geo(STONE, BOXG, Math.sin(a) * rm, top - 0.14, Math.cos(a) * rm, [0, a, 0], [rm * da * 1.15, 0.28, len]);
  }
  // La terraza: el suelo de arriba (y por debajo), menos el hueco por donde llega la escalera
  const W = 40;
  for (let i = 0; i < W; i++) {
    const a0 = (i / W) * TAU, a1 = ((i + 1) / W) * TAU;
    if (inHole((a0 + a1) / 2, H)) continue;
    S.quadN(P(a0, T.r0 - 0.1, H), P(a1, T.r0 - 0.1, H), P(a1, Ri + 0.02, H), P(a0, Ri + 0.02, H), [0, 1, 0], [[0, 0], [0.5, 0], [0.5, 1.4], [0, 1.4]]);
    S.quadN(P(a1, T.r0 - 0.1, H - 0.3), P(a0, T.r0 - 0.1, H - 0.3), P(a0, Ri + 0.02, H - 0.3), P(a1, Ri + 0.02, H - 0.3), [0, -1, 0], [[0, 0], [0.5, 0], [0.5, 1.4], [0, 1.4]]);
  }
  m.solids.push([-R, 0, -R, R, H + T.parapet, R]);
  if (!foot) return;
  // The base of one that is built: its square of masonry down into the ground, with a course of slabs round the edge
  const E = SIDE / 2, C = 0.5;
  m.box(WALL, -E, -foot, -E, E, 0.03, E, 0.5);
  for (const s of [-1, 1]) {
    m.box(STONE, -E - 0.05, -0.16, s * E - (s > 0 ? C : 0.05), E + 0.05, 0.04, s * E + (s > 0 ? 0.05 : C), 0.6);
    m.box(STONE, s * E - (s > 0 ? C : 0.05), -0.16, -E + C, s * E + (s > 0 ? 0.05 : C), 0.04, E - C, 0.6);
  }
  m.solids = [[-E, -foot, -E, E, H + T.parapet, E]];
}
const BOXG = new THREE.BoxGeometry(1, 1, 1), CIRCLE = new THREE.CircleGeometry(1, 28), RAIL_RING = {};
let HATCH_RING, CAP;   // (of the lighthouse: made with the first one)
// Los lugares del mundo (poi:…): la torre grande, el templo y la cueva, y el campamento, el barco varado, el
// altar y el faro
const PLACES = {
  torre(m, snow, h, rock) { bigTower(m, +h || TOWER.H, rock); },
  templo(m) {
    const R = rng(7);
    // Tres gradas, columnas alrededor de la cella (cuatro delante), arquitrabe y el frontón; la puerta, de 2,05 m, mira a +z
    for (let i = 0; i < 3; i++) { const e = 1.65 - i * 0.14; m.box('marbleD', -e, i * 0.15, -e, e, (i + 1) * 0.15, e, 0.6); }
    const y0 = 0.45, H = 2.6;
    const g = new Model();   // (las columnas, sobre las gradas)
    for (const [x, z] of [[-1.28, 1.28], [-0.43, 1.28], [0.43, 1.28], [1.28, 1.28], [-1.28, 0.2], [1.28, 0.2], [-1.28, -1.28], [1.28, -1.28], [-0.43, -1.28], [0.43, -1.28]]) column(g, 'marble', x, z, H, true, R, 0.19);
    for (const [k, B] of g.parts) m.B(k).addGeometry(B.geometry(), new THREE.Matrix4().makeTranslation(0, y0, 0));
    m.solids.push([-1.5, y0, -1.5, 1.5, y0 + H, 1.5]);
    const top = y0 + H + 0.2;
    m.box('marble', -1.5, top, -1.5, 1.5, top + 0.32, 1.5, 0.6);
    m.box('marbleD', -1.56, top + 0.32, -1.56, 1.56, top + 0.4, 1.56, 0.6);
    roofPrismZ(m, 'marbleD', -1.56, 1.56, -1.56, 1.56, top + 0.4, 0.85);
    // La cella, con la puerta oscura
    m.box('marble', -0.85, y0, -1.0, 0.85, top, 0.3, 0.6).box('dark0', -0.45, y0, 0.3, 0.45, y0 + 2.05, 0.33);
    m.box('marbleD', -0.55, y0 + 2.05, 0.3, 0.55, y0 + 2.25, 0.36, 0.6);   // el dintel
    for (const [x, z] of [[-1.5, 1.4], [1.45, -1.3], [1.5, 0.9]]) m.geo('moss', ICO1, x, 0.05, z, [0, x, 0], [0.35, 0.08, 0.25]);
    m.geo('crystal', ICO, 0, top + 1.55, 0, [0, 0.5, 0], 0.2).light(0, top + 1.5, 0, { color: '#7ad8ff', intensity: 2, range: 6, always: true });
  },
  cueva(m, snow) {
    // Un risco de rocas grandes con la boca (2,2 m de alto) mirando a +z, enmarcada por dos jambas y un dintel de roca
    for (const [x, y, z, sx, sy, sz, i] of [[0, 0, -1.25, 2.2, 2.6, 1.1, 0], [-1.55, 0, -0.3, 0.8, 2.0, 1.0, 1], [1.55, 0, -0.35, 0.85, 1.8, 1.0, 2], [-1.2, 0, 0.35, 0.42, 2.0, 0.5, 2], [1.2, 0, 0.35, 0.45, 1.95, 0.5, 0], [0, 2.1, 0.15, 1.5, 0.5, 0.65, 1], [-1.85, 0, 0.9, 0.45, 0.4, 0.45, 0], [1.75, 0, 1.0, 0.38, 0.32, 0.4, 1]])
    { m.geo('crag', rockG(i), x, y + sy * 0.2, z, [0, x + z, 0], [sx, sy, sz]); if (snow) m.geo('snowcap', rockG(i), x, y + sy * 0.2 + 0.02, z, [0, x + z, 0], [sx * 1.03, sy * 1.03, sz * 1.03]); }   // (la nieve, pegada a la roca)
    // La boca: por dentro, una bóveda de roca oscura que se ve hacia el fondo (no un hueco negro), y el suelo que entra
    m.geo('cavein', ICO1, 0, 0.0, -0.35, [0, 0, 0], [0.85, 2.15, 1.05]);
    m.box('soot', -0.62, 0, -1.2, 0.62, 0.012, 0.5);
  },
  campamento(m) {
    // Tienda de lona, hoguera con piedras y troncos para sentarse
    const B = m.B('canvas'), A = [-1.3, 0, -1.2], Bp = [0.2, 0, -1.2], C = [0.2, 0, 0.3], D = [-1.3, 0, 0.3], E = [-0.55, 1.3, -1.2], F = [-0.55, 1.3, 0.3];
    B.quadN(A, D, F, E, [-0.8, 0.6, 0], [[0, 0], [1.5, 0], [1.5, 1.5], [0, 1.5]]); B.quadN(C, Bp, E, F, [0.8, 0.6, 0], [[0, 0], [1.5, 0], [1.5, 1.5], [0, 1.5]]);
    m.B('tentStripe').tri(A, E, Bp, [0, 0, -1], [[0, 0], [0.5, 1], [1, 0]]);
    m.box('soot', -0.65, 0, 0.29, -0.45, 1.0, 0.31);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; m.geo('rock', DODECA, 1 + Math.cos(a) * 0.35, 0.06, 1 + Math.sin(a) * 0.35, [i, i, 0], [0.1, 0.07, 0.09]); }
    for (let i = 0; i < 3; i++) m.cyl('dark', 1 + Math.cos(i * 2.1) * 0.12, 0.05, 1 + Math.sin(i * 2.1) * 0.12, 0.04, 0.04, 0.35, 6, [Math.cos(i * 2.1) * 1.2, 0, Math.sin(i * 2.1) * 1.2]);
    m.fire(1, 0.08, 1, 0.9).light(1, 0.6, 1, { color: '#ff9a40', intensity: 4, range: 10, flicker: true, pool: 3 });
    m.smoke.push([1, 1.2, 1]);
    for (const [x, z, r] of [[1.9, 0.6, 0.3], [0.3, 1.9, 1.9]]) m.cyl('wood', x, 0.15, z, 0.14, 0.14, 0.7, 8, [0, r, Math.PI / 2]);
  },
  barco(m) {
    // Casco tumbado y medio enterrado en la arena, con el mástil roto
    const g = new THREE.Group();
    const hull = new Builder();
    for (let i = 0; i < 7; i++) { const z = -1.6 + i * 0.5, w = 0.9 - Math.abs(i - 3) * 0.15; hull.box(-w, 0, z, w, 0.12, z + 0.45); hull.box(-w - 0.1, 0.1, z, -w, 0.9 - Math.abs(i - 3) * 0.08, z + 0.45); hull.box(w, 0.1, z, w + 0.1, 0.9 - Math.abs(i - 3) * 0.08, z + 0.45); }
    const hm = hull.mesh(modelMats().hull); hm.rotation.z = 0.35; hm.position.y = -0.1; hm.castShadow = true; g.add(hm);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.8, 8), modelMats().dark); mast.position.set(-0.2, 0.9, 0.3); mast.rotation.set(0.5, 0, 0.6); mast.castShadow = true; g.add(mast);
    m.extra(g);
    m.geo('sand', ICO1, 0, -0.1, 0, [0, 0, 0], [1.6, 0.3, 2.0]);
  },
  altar(m) {
    m.box('templeD', -1, 0, -0.7, 1, 0.2, 0.7).box('temple', -0.6, 0.2, -0.4, 0.6, 0.95, 0.4).box('templeD', -0.7, 0.95, -0.5, 0.7, 1.05, 0.5);
    m.geo('crystal', ICO, 0, 1.3, 0, [0.3, 0.6, 0], 0.18).light(0, 1.4, 0, { color: '#9ae0ff', intensity: 2.5, range: 7, always: true });
    for (const x of [-1.2, 1.2]) { m.cyl('stone', x, 0, 0, 0.12, 0.1, 1.2, 8); m.fire(x, 1.22, 0, 0.5); }
  },
  // The lighthouse, with the gallery one stands on (its measures: world/tower.js, GALLERY). dark: left behind, not lit
  faro(m, snow, dark) {
    const G = GALLERY, H = G.H, N = 28, TAU = Math.PI * 2, B0 = 0.7, B1 = 7.75, at = y => 1.36 - (y - B0) / (B1 - B0) * 0.36;
    const around = (n, fn, from = 0) => { for (let i = 0; i < n; i++) { const a = from + (i / n) * TAU; fn(Math.sin(a), Math.cos(a), a); } };
    // The base, of stone, and the shaft in bands
    m.cyl('stone', 0, 0, 0, G.base, G.base - 0.04, 0.35, N).cyl('stone', 0, 0.35, 0, 1.44, 1.4, 0.35, N);
    for (let i = 0; i < 6; i++) { const y = B0 + i * (B1 - B0) / 6, y1 = B0 + (i + 1) * (B1 - B0) / 6; m.cyl(i % 2 ? 'stripeR' : 'white', 0, y, 0, at(y), at(y1), y1 - y, N); }
    // The door (to +z, in its stone frame) and the small windows up the stairs
    m.box('stone', -0.6, 0, 1.14, 0.6, 2.2, 1.46, 0.6).box('wood', -0.4, 0.06, 1.4, 0.4, 1.98, 1.475, 0.8).box('iron', -0.36, 0.5, 1.47, 0.36, 0.56, 1.49).box('iron', -0.36, 1.5, 1.47, 0.36, 1.56, 1.49).ball('brass', 0.28, 1.0, 1.5, 0.045);
    m.box('stone', -0.75, 0, 1.4, 0.75, 0.06, 1.95, 0.6);
    for (const [a, y] of [[2.4, 3.1], [4.6, 4.7], [0.5, 6.2]]) { const r = at(y) - 0.02, s = Math.sin(a), c = Math.cos(a); m.geo('stone', BOXG, s * r, y, c * r, [0, a, 0], [0.5, 0.78, 0.1]).geo('dark0', BOXG, s * (r + 0.04), y, c * (r + 0.04), [0, a, 0], [0.3, 0.56, 0.06]); }
    // The cornice, the corbels and the gallery's deck
    m.cyl('stone', 0, B1, 0, 1.0, 1.1, 0.14, N);
    around(14, (s, c, a) => m.geo('stone', BOXG, s * 1.28, H - 0.36, c * 1.28, [0, a, 0], [0.16, 0.36, 0.68]));
    m.cyl('white', 0, B1 + 0.14, 0, 1.0, 1.04, H - B1 - 0.3, N).cyl('stone', 0, H - 0.16, 0, G.deck - 0.03, G.deck, 0.16, 40);
    // The rail: posts, bars and a handrail
    around(16, (s, c, a) => m.cyl('iron', s * G.rail, H, c * G.rail, 0.028, 0.024, 1.04, 6).ball('iron', s * G.rail, H + 1.06, c * G.rail, 0.042, 0.042, 0.042, 6));
    for (const [y, t] of [[0.35, 0.014], [0.68, 0.014], [1.02, 0.024]]) m.geo('iron', RAIL_RING[t] ||= new THREE.TorusGeometry(G.rail, t, 5, 48), 0, H + y, 0, [Math.PI / 2, 0, 0]);
    // The hatch down, in the deck
    m.box('wood', -0.36, H - 0.02, 0.82, 0.36, H + 0.035, 1.46, 0.8).box('iron', -0.36, H + 0.03, 0.9, 0.36, H + 0.045, 0.95).box('iron', -0.36, H + 0.03, 1.33, 0.36, H + 0.045, 1.38);
    m.geo('iron', HATCH_RING ||= new THREE.TorusGeometry(0.07, 0.014, 5, 14), 0.2, H + 0.05, 1.14, [Math.PI / 2, 0, 0]);
    // The lantern: its low wall, the panes between the mullions, the lens, and the dome with its vent and its rod
    const L = G.lantern - 0.04, w = 0.5, g = 1.15, top = H + w + g;
    m.cyl('white', 0, H, 0, L, L, w, 24).cyl('iron', 0, H + w, 0, L + 0.04, L + 0.04, 0.06, 24).box('iron', -0.2, H + 0.03, L - 0.05, 0.2, H + w, L + 0.015);
    m.cyl('glass', 0, H + w + 0.06, 0, L - 0.05, L - 0.05, g - 0.06, 16);
    around(8, (s, c) => m.cyl('iron', s * (L - 0.03), H + w, c * (L - 0.03), 0.022, 0.022, g, 5), TAU / 16);
    m.cyl('brass', 0, H + w, 0, 0.1, 0.07, 0.25, 10).ball(dark ? 'glass' : 'lens', 0, H + w + 0.55, 0, 0.26, 0.32, 0.26, 16).cyl('brass', 0, H + w + 0.28, 0, 0.17, 0.2, 0.03, 16).cyl('brass', 0, H + w + 0.8, 0, 0.2, 0.17, 0.03, 16);
    m.cyl('iron', 0, top, 0, L + 0.12, L + 0.12, 0.07, 24).geo('stripeR', CAP ||= new THREE.SphereGeometry(1, 24, 8, 0, TAU, 0, Math.PI / 2), 0, top + 0.07, 0, [0, 0, 0], [L + 0.07, 0.48, L + 0.07]);
    m.cyl('iron', 0, top + 0.5, 0, 0.1, 0.09, 0.16, 12).ball('iron', 0, top + 0.72, 0, 0.1, 0.1, 0.1, 10).cyl('iron', 0, top + 0.75, 0, 0.014, 0.008, 0.6, 5);
    if (dark) return;
    m.light(0, H + w + 0.58, 0, { color: '#fff0b0', intensity: 12, range: 30, halo: 3 });   // (se enciende de noche, con su haz y su lente: de día, un sol en lo alto)
    m.beacon = [0, H + w + 0.55, 0];
  },
};

// Cofre del tesoro: cerrado o, ya saqueado, abierto y vacío (por dentro, a oscuras)
function treasure(m, open) {
  m.box('wood', -0.38, 0, -0.26, 0.38, 0.42, 0.26).box('iron', -0.4, 0.05, -0.27, -0.34, 0.45, 0.27).box('iron', 0.34, 0.05, -0.27, 0.4, 0.45, 0.27);
  if (open) { m.B('dark').orientedBox(0, -0.38, 0.8, 0.12, 0.42, 0.95, 0, {}); m.box('dark', -0.31, 0.4, -0.2, 0.31, 0.426, 0.2); }
  else m.box('dark', -0.4, 0.42, -0.28, 0.4, 0.62, 0.28).box('gold', -0.06, 0.3, 0.26, 0.06, 0.46, 0.29);
}

// Tierra labrada de una casilla (seca o mojada). mask: which neighbours are tilled too (1 +x, 2 -x, 4 +z, 8 -z), like
// fences: towards them the bed and its furrows reach the tile edge, so a field is one piece of soil with long rows.
// The rows run along x, or along z in a strip that only has neighbours along z. Three ridges per tile, a third of a
// tile apart, so they keep the same spacing from one tile to the next
// look: 0 damp, 1 wet, 2 dry (farm.js soilLook: paler, with fine cracks). more: m straw spread over it, r rich soil, p poor
// soil (soil3d.js soilBits)
function tilled(m, look, mask = 0, more = '') {
  const mulch = more.includes('m');
  const mat = look === 1 ? 'dirtWet' : more.includes('r') ? (look === 2 ? 'dirt' : 'dirtRich') : look === 2 ? 'dirtDry' : 'dirt', e = bit => (mask & bit ? 0.5 : 0.46);
  m.box(mat, -e(2), 0, -e(8), e(1), 0.06, e(4), 1);
  const alongZ = !(mask & 3) && (mask & 12), r = bit => (mask & bit ? 0.5 : 0.42);
  for (let i = -1; i <= 1; i++) {
    const c = i / 3;
    if (alongZ) m.box(mat, c - 0.06, 0.06, -r(8), c + 0.06, 0.1, r(4), 1);
    else m.box(mat, -r(2), 0.06, c - 0.06, r(1), 0.1, c + 0.06, 1);
  }
  const R = rng2(71 + mask);
  if (look === 2) for (let i = 0; i < 11; i++) {   // (cracks: thin dark lines, some over the ridges)
    const x = (R() - 0.5) * 0.8, z = (R() - 0.5) * 0.8, l = 0.08 + R() * 0.14, a = R() * Math.PI, over = Math.abs(((alongZ ? x : z) * 3) - Math.round((alongZ ? x : z) * 3)) < 0.18;
    m.geo('crack', CRACK, x, (over ? 0.1 : 0.06) + 0.003, z, [0, a, 0], [l, 1, 0.007 + R() * 0.006]);
    m.geo('crack', CRACK, x + Math.cos(a) * l * 0.5, (over ? 0.1 : 0.06) + 0.003, z - Math.sin(a) * l * 0.5, [0, a + 0.9, 0], [l * 0.7, 1, 0.006]);
  }
  soilBits(m, more, alongZ, R);
  if (mulch) for (let i = 0; i < 46; i++) {
    const l = 0.12 + R() * 0.2, w = 0.45 - l / 2;
    m.geo(i % 4 ? 'straw' : 'hay', CRACK, (R() - 0.5) * 2 * w, 0.075 + R() * 0.05, (R() - 0.5) * 2 * w, [(R() - 0.5) * 0.3, R() * Math.PI, (R() - 0.5) * 0.3], [l, 1, 0.014 + R() * 0.012]);
  }
}
// (paler than the texture: its colour goes over 1; the same program as the other two)
const dirtDry = () => { const M = mat({ map: furrows(), roughness: 1 }); M.color.setRGB(1.5, 1.4, 1.22); return M; };
const dirtRich = () => { const M = mat({ map: furrows(), roughness: 1 }); M.color.setRGB(0.52, 0.47, 0.44); return M; };
const CRACK = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);   // (a flat strip lying on the soil)

// Cuadros: marco con su fondo y el lienzo un poco hundido, a media altura, con la espalda contra el muro (z = -0.05)
function painting(m, art, frame) {
  const z0 = -0.05, z1 = -0.015, x = 0.42, y0 = 1.1, y1 = 1.8, b = 0.06, z = -0.032;
  m.box(frame, -x, y0, z0, x, y1, z0 + 0.01);
  m.box(frame, -x, y0, z0, -x + b, y1, z1).box(frame, x - b, y0, z0, x, y1, z1).box(frame, -x + b, y0, z0, x - b, y0 + b, z1).box(frame, -x + b, y1 - b, z0, x - b, y1, z1);
  m.B(art).quadN([-x + b, y0 + b, z], [x - b, y0 + b, z], [x - b, y1 - b, z], [-x + b, y1 - b, z], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
}
Object.assign(BUILD, {
  cuadro_valle: m => painting(m, 'art_valle', 'dark'), cuadro_mar: m => painting(m, 'art_mar', 'light'),
  cuadro_flores: m => painting(m, 'art_flores', 'gold'), cuadro_noche: m => painting(m, 'art_noche', 'dark'),
});

// (las alfombras, 1 cm por encima del suelo: más pegadas, de lejos parpadeaban con él)
const RUG_Y = FLOOR_H + 0.01;
// Alfombra de w × h casillas, un poco más pequeña que ellas, con el dibujo a lo largo (si es más ancha que
// larga, girado)
const RUG_MAT = { alfombra: 'rug', alfombra_persa: 'rug_persa', alfombra_rayas: 'rug_rayas', alfombra_rombos: 'rug_rombos', alfombra_trenzada: 'rug_trenzada' };
function rugModel(m, id, size) {
  const [w, h] = size.split('x').map(Number), x = w / 2 - 0.06, z = h / 2 - 0.06, y = RUG_Y;
  m.B(RUG_MAT[ITEMS[id]?.rug || id] || 'rug').quad([-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z], [0, 1, 0], w > h ? [[0, 1], [0, 0], [1, 0], [1, 1]] : [[0, 0], [1, 0], [1, 1], [0, 1]]);
}

// ---------- caché ----------
const CACHE = new Map();
// Modelo de algo, por su nombre: 'banco', 'crop:tomate:3', 'poi:templo', 'village:stall', 'treasure:1', 'tilled:0'…
export function getModel(name) {
  if (CACHE.has(name)) return CACHE.get(name);
  const m = new Model(), [kind, a, b, d] = name.split(':');
  if (BUILD[kind]) BUILD[kind](m, a, b);
  else if (kind === 'crop') crop(m, a, +b, d);
  else if (kind === 'village') { if (a === 'stall2') VILLAGE.stall(m, ['#e0b850', '#f08a2a', '#e83a4a'], 'awningB'); else if (a === 'stall3') VILLAGE.stall(m, ['#9ad0ff', '#c8a870', '#f0e8f0'], 'awningG'); else VILLAGE[a](m); }
  else if (kind === 'poi') PLACES[a](m, b === 'snow', a === 'faro' ? b === 'dark' : b, d);
  else if (WATCHTOWERS[kind]) bigTower(m, WATCHTOWERS[kind].h, a, +b || 0.4);   // (the ones one builds: id:stone:how far down its base goes)
  else if (kind === 'treasure') treasure(m, a === '1');
  else if (kind === 'tilled') tilled(m, +a, +b || 0, d);
  else if (kind === 'rug') rugModel(m, a, b);
  else return null;
  CACHE.set(name, m);
  return m;
}
// Las cajas que ocupa un modelo (sin las que no levantan del suelo, como una alfombra); si es muy menudo, la que
// las envuelve a todas
SOLIDS.of = name => {
  const m = getModel(name);
  if (!m) return null;
  if (!m.boxesFor) { const list = m.solids.filter(b => b[4] > 0.04); m.boxesFor = list.length > 60 ? [hull(list)] : list; }
  return m.boxesFor.length ? m.boxesFor : null;
};
SOLIDS.all = name => {
  const m = getModel(name);
  if (!m) return null;
  m.allBoxes ||= m.solids.filter(b => b[4] > 0.04);
  return m.allBoxes.length ? m.allBoxes : null;
};
// Material de una pieza de modelo por su clave ('wood', 'books3', 'fruit:#e04a2a', 'leafc:#3f8a32'…)
const DYN = new Map();
// (the big things carried in the arms: made the first time one is drawn)
const OWN = {
  logBark: () => mat({ map: bark(), roughness: 0.95 }), logEnd: () => mat({ map: ringsTex(), roughness: 0.85 }),
  carcass: () => mat({ vertexColors: true, roughness: 0.85 }),
  // (the wheelbarrow's heap of sacks: the burlap of the tarp over them and of the sacks)
  tarp: () => mat({ color: apagado('#8c7b5a'), roughness: 1, side: THREE.DoubleSide }),
  // (the towers' other stones: the same textures, another tone)
  towerWall_granite: () => towerCut(mat({ map: modelMats().towerWall.map, color: '#ccd2d8', roughness: 0.92 })), towerStone_granite: () => towerCut(mat({ map: modelMats().towerStone.map, color: '#cfd5da', roughness: 0.9 })),
  towerWall_slate: () => towerCut(mat({ map: modelMats().towerWall.map, color: '#c2cad0', roughness: 0.88 })), towerStone_slate: () => towerCut(mat({ map: modelMats().towerStone.map, color: '#c0c8ce', roughness: 0.86 })),
  // (the village mailbox's paints and wood: mailbox3d.js; the fountain's stone: fountain3d.js)
  ...MAIL_MATS, ...FOUNT_MATS,
};
export function modelMat(key) {
  const M = modelMats();
  if (M[key]) return M[key];
  if (key.startsWith('books')) return M.books[+key.slice(5)];
  if (OWN[key]) return DYN.get(key) || (DYN.set(key, OWN[key]()), DYN.get(key));
  if (!DYN.has(key)) {
    const [k, c] = key.split(':');
    DYN.set(key, k === 'fruit' ? mat({ color: c, roughness: 0.45 }) : k === 'hide' ? mat({ color: apagado(c), roughness: 0.95 }) : k === 'leafc' ? mat({ color: c, flatShading: true, side: THREE.DoubleSide }) : key === 'dry' ? mat({ color: '#8a6a3a' }) : key === 'dirtWet' ? mat({ map: furrows(), color: '#7a6a60', roughness: 0.7 }) : key === 'dirtDry' ? dirtDry() : key === 'dirtRich' ? dirtRich() : mat({ color: tintOf(key)?.[1] || '#ff00ff' }));   // (what only has its paint, as the garden's soil: tints.js)
  }
  return DYN.get(key);
}
// Candelabro: cadena, aro de hierro, seis velas con su llama, colgado a la altura y0 (el techo)
function chandelier(m, y0) {
  m.cyl('iron', 0, y0 - 0.7, 0, 0.012, 0.012, 0.7, 4).geo('iron', TORUS, 0, y0 - 0.75, 0, [Math.PI / 2, 0, 0], [0.38, 0.38, 0.38 / 0.38]).ball('brass', 0, y0 - 0.75, 0, 0.06);
  m.cyl('iron', 0, y0 - 0.04, 0, 0.07, 0.05, 0.04, 10);   // el florón del techo
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2, x = Math.cos(a) * 0.38, z = Math.sin(a) * 0.38;
    m.cyl('brass', x, y0 - 0.75, z, 0.04, 0.03, 0.03, 8).cyl('candle', x, y0 - 0.72, z, 0.022, 0.022, 0.14, 8);
    m.fire(x, y0 - 0.58, z, 0.12);
  }
  return m;
}
// ---------- the big things carried in the arms (carry-items.js; carry.js) ----------
// A log lying along x: the trees' own bark round it, a little lumpy and thicker at the butt (+x), the cut ends showing
// their rings and two broken branch stubs. Short enough to lie inside its tile (0.95 m, some 19 cm thick: what 25 kg of
// wood is); on the shoulder it is drawn longer, 1.2 m (carry3d.js HOLD.shoulder: the person is 1.7 m tall). Its geometry
// is made once (the stubs, pointed: a flat cut would look like a hole)
export const LOG = { L: 0.95, r: 0.095 };
let LOG_GEO;
function logGeos() {
  if (LOG_GEO) return LOG_GEO;
  const { L, r } = LOG, g = new THREE.CylinderGeometry(r * 0.9, r, L, 18, 6, true), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x), t = y / L;
    // (lumps that run along it, and a slight bend: no log is a perfect cylinder)
    const k = 1 + 0.045 * Math.sin(a * 3 + t * 4) + 0.03 * Math.sin(a * 7 + 1.3 + t * 9) + 0.02 * Math.cos(a * 11 - t * 6);
    p.setXYZ(i, x * k + 0.012 * Math.sin((t + 0.5) * Math.PI), y, z * k);
  }
  g.computeVertexNormals();
  g.rotateZ(Math.PI / 2);   // (the top, thinner, to -x; the butt to +x)
  const end = (rad, side) => { const c = new THREE.CircleGeometry(rad, 18); c.rotateY(side * Math.PI / 2); c.translate(side * (L / 2 - 0.004), 0, 0); return c; };
  return (LOG_GEO = { bark: g, butt: end(r * 0.97, 1), top: end(r * 0.87, -1) });
}
BUILD.log = m => {
  const { r } = LOG, G = logGeos();
  m.geo('logBark', G.bark, 0, r, 0).geo('logEnd', G.butt, 0, r, 0).geo('logEnd', G.top, 0, r, 0);
  m.cyl('logBark', 0.16, r * 1.75, 0.02, 0.026, 0.004, 0.1, 6, [0.5, 0, 0.35]).cyl('logBark', -0.26, r * 1.7, -0.03, 0.022, 0.004, 0.08, 6, [-0.6, 0, -0.3]);
};
// The cut end of a log: the rings round a pith a little off centre, the heartwood darker, the bark round it and two
// cracks out from the middle
let RINGS;
function ringsTex() {
  if (RINGS) return RINGS;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), R = rng(41), cx = 66, cy = 62;
  g.fillStyle = apagado('#5a4030'); g.fillRect(0, 0, 128, 128);
  const grad = g.createRadialGradient(cx, cy, 2, 64, 64, 58);
  grad.addColorStop(0, apagado('#9a6a42')); grad.addColorStop(0.55, apagado('#b8875a')); grad.addColorStop(1, apagado('#d2aa78'));
  g.fillStyle = grad; g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill();
  for (let i = 1; i <= 16; i++) {
    const k = i / 16, rr = 3 + k * 54;
    g.strokeStyle = `rgba(80,48,26,${0.18 + R() * 0.22})`; g.lineWidth = 0.8 + R() * 1.2;
    g.beginPath(); g.ellipse(cx + (64 - cx) * k, cy + (64 - cy) * k, rr, rr * (0.96 + R() * 0.06), R(), 0, Math.PI * 2); g.stroke();
  }
  g.strokeStyle = 'rgba(50,30,16,.55)'; g.lineWidth = 1.2;
  for (const a of [0.6, 3.9]) { g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * 30, cy + Math.sin(a) * 30); g.stroke(); }
  g.fillStyle = 'rgba(60,36,20,.8)'; g.beginPath(); g.arc(cx, cy, 2.2, 0, Math.PI * 2); g.fill();
  g.strokeStyle = apagado('#3e2a1c'); g.lineWidth = 6; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return (RINGS = t);
}

// A carcass: the living animal (animals.js, the same body, coat and head) posed dead and baked into one geometry with
// its colours per vertex (one material, 'carcass': one draw call for all the carcasses of a chunk). Smaller than the
// living one (CARCASS_SIZE: what one person can carry). Two poses: on the ground (its name), lying on its left side, the
// head at +x resting on the ground, the spine to -z and the legs to +z, loose; and carried (`<id>:held`, carry3d.js),
// draped across the back of someone's shoulders, in the chest bone's frame (x: their left, z: their front), as hunters
// carry a deer: the middle of it on the nape and both halves bending down over the shoulders (DRAPE), the spine up and
// back, so that from behind it is an arch with the neck and the head hanging at their right and the rump and the tail at
// their left; the legs come forward over both shoulders and hang in front of the chest, where the hands hold them
const CARCASS_SIZE = { carcass_deer: 0.66, carcass_cow: 0.6, carcass_boar: 0.68, carcass_goat: 0.72, carcass_sheep: 0.64, carcass_pig: 0.66 };
const CARCASS_BREED = { vaca: 'pinta', oveja: 'blanca', cabra: 'parda', cerdo: 'rosa' };
const V3 = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
// Where the parts point, in the final frame: per leg (f: front, u: the side up when lying / the leg further up when
// carried), the upper and the lower half; the neck; the head (its nose and the top of its head). Carried, as they end up
// after the drape (the head and the front legs turn with the front half, the hind legs with the hind one: see unbend)
const POSE = {
  ground: {
    basis: [[0, -1, 0], [0, 0, -1], [1, 0, 0]],   // (the animal's x, y, z: its left side down, its back to -z, its head to +x)
    leg: (f, u) => f ? [V3(u ? 0.55 : 0.35, u ? -0.3 : -0.12, 1), V3(u ? 0.3 : 0.1, u ? -0.22 : -0.06, 1)] : [V3(u ? -0.3 : -0.55, u ? -0.3 : -0.1, 1), V3(u ? -0.05 : -0.22, u ? -0.25 : -0.05, 1)],
    neck: V3(1, 0, -0.22), nose: V3(1, -0.1, -0.12), top: V3(0, 0, -1),
  },
  held: {
    basis: null,   // (made below: the head to -x, the back up and behind)
    leg: (f, u) => f ? [V3(0.12, u ? -0.05 : -0.18, 1), V3(0.03, -1, u ? 0.45 : 0.3)] : [V3(-0.12, u ? -0.05 : -0.18, 1), V3(-0.03, -1, u ? 0.45 : 0.3)],   // (forward over the shoulder, then down in front of it, to the hand)
    neck: V3(-0.3, -1, -0.12), nose: V3(-0.12, -1, 0.3), top: V3(-1, 0.1, -0.35),
  },
};
{ const z = new THREE.Vector3(-1, 0, 0), y = V3(0, 0.72, -0.7), x = new THREE.Vector3().crossVectors(y, z); POSE.held.basis = [x.toArray(), y.toArray(), z.toArray()]; }
const qOf = (x, y, z) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...x), new THREE.Vector3(...y), new THREE.Vector3(...z)));
// Turn o (in its parent, whose orientation in the final frame is Qp) so that its own direction `rest` points to `dir`
function aimPart(o, rest, dir, Qp) {
  o.quaternion.setFromUnitVectors(rest.clone().normalize(), dir.clone().applyQuaternion(Qp.clone().invert()));
}
// A head (or anything) turned so that its +z points along nose and its +y as near to top as it can
function faceTo(o, nose, top, Qp) {
  const z = nose.clone().normalize(), x = new THREE.Vector3().crossVectors(top, z).normalize(), y = new THREE.Vector3().crossVectors(z, x);
  o.quaternion.copy(Qp.clone().invert().multiply(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z))));
}
// The drape of a carried carcass: its body bent down round a centre R below its middle, as far as X0 each way (beyond,
// the head and the rump only turn with it: by phi = X0 / R). bend: a point or a direction (w = 0) of the pose before it
// to after it; unbend: a direction after it to before it, at one end (phi < 0: the head's)
const DRAPE = { R: 0.3, k: 0.62 };
function bend(x, y, phi0, w = 1) {
  const R = DRAPE.R, X0 = phi0 * R, xc = w ? Math.max(-X0, Math.min(X0, x)) : 0, f = w ? xc / R : phi0, u = x - xc, v = y + R * w, c = Math.cos(f), s = Math.sin(f);
  return [u * c + v * s, -u * s + v * c - R * w];
}
const unbend = (d, f) => new THREE.Vector3(d.x * Math.cos(f) - d.y * Math.sin(f), d.x * Math.sin(f) + d.y * Math.cos(f), d.z);
// (pose: again on the same animal, with the head lower by drop; phi: the drape's turn at its ends, carried)
function poseCarcass(root, id, held, drop = 0, phi = 0) {
  const P = POSE[held ? 'held' : 'ground'], u = root.userData, Q = qOf(...P.basis), head0 = u.head0 ||= u.head?.position.clone();
  const pre = (d, f) => held && phi ? unbend(d, f).normalize() : d;
  root.quaternion.copy(Q); root.scale.setScalar(CARCASS_SIZE[id] || 0.8);
  u.body.quaternion.identity(); u.body.position.set(0, 0, 0); u.body.scale.set(1, 1, 1);
  for (const l of u.legs) {
    const front = l.hip.position.z > 0, up = held ? l.hip.position.x > 0 : l.hip.position.x < 0, f = front ? -phi : phi, [d0, d1] = P.leg(front, up).map(d => pre(d, f));
    aimPart(l.hip, l.knee.position, d0, Q);
    aimPart(l.knee, new THREE.Vector3(0, -1, front ? 0 : 0.25), d1, Q.clone().multiply(l.hip.quaternion));
  }
  if (u.head) {
    if (u.rig) {   // (the neck from its base, then the head at its tip)
      const r = u.rig, dir = pre(P.neck, -phi);
      if (drop) { dir.y -= drop / r.L; dir.normalize(); }
      u.neck.position.set(0, r.by, r.bz); u.neck.scale.set(1, 1, 1);
      aimPart(u.neck, new THREE.Vector3(0, 1, 0), dir, Q);
      u.head.position.set(0, r.by, r.bz).add(new THREE.Vector3(0, r.L, 0).applyQuaternion(u.neck.quaternion));
    } else if (drop) u.head.position.copy(head0).add(new THREE.Vector3(0, -drop, 0).applyQuaternion(Q.clone().invert()));
    faceTo(u.head, pre(P.nose, -phi), pre(P.top, -phi), Q);
  }
  if (u.tail) u.tail.rotation.set(held ? 0.4 : 0.9, 0, 0);
  root.updateMatrixWorld(true);
  return root;
}
// The animal posed. Carried, the drape measured on its body (the biggest of the body's own meshes) and the pose made
// again for it. On the ground, the head down to it (the neck lower, or the head of the short-necked ones): measured with
// the parts' boxes, one try more if it is still off
const _b = new THREE.Box3();
function posedCarcass(id, held) {
  const type = BULKY[id].prey, root = poseCarcass(animalModel(type, CARCASS_BREED[type]), id, held), u = root.userData;
  if (held) {
    let len = 0;
    for (const o of u.body.children) if (o.isMesh) { _b.setFromObject(o, true); len = Math.max(len, _b.max.x - _b.min.x); }
    u.phi = DRAPE.k * len / 2 / DRAPE.R;
    return poseCarcass(root, id, held, 0, u.phi);
  }
  if (!u.head) return root;
  const low = f => { let y = Infinity; root.traverse(o => { if (o.isMesh && f(isIn(o, u.head))) y = Math.min(y, _b.setFromObject(o, true).min.y); }); return y; };
  for (let k = 0, drop = 0; k < 2; k++) {
    const gap = low(h => h) - low(h => !h) - 0.01;
    if (gap < 0.02) break;
    drop += gap / (CARCASS_SIZE[id] || 0.8);
    poseCarcass(root, id, held, drop);
  }
  return root;
}
// The meshes of a posed animal in one list of triangles, in the final frame: positions, normals and colours
function bakeCarcass(root) {
  const out = [], nm = new THREE.Matrix3(), v = new THREE.Vector3();
  root.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry, pos = g.attributes.position, nor = g.attributes.normal, col = g.attributes.color, mc = o.material.color, idx = g.index;
    nm.getNormalMatrix(o.matrixWorld);
    // (the animals' meshes come unindexed, three corners per triangle: the same corners are joined again, about a sixth
    // of them. The corner, in whole numbers, by a hash; the same hash is checked)
    const P = [], N = [], C = [], I = [], box = new THREE.Box3(), seen = new Map(), at = [], K = [], q = new Int32Array(9);
    for (let i = 0; i < pos.count; i++) {
      const r = (col ? col.getX(i) : 1) * mc.r, gg = (col ? col.getY(i) : 1) * mc.g, b = (col ? col.getZ(i) : 1) * mc.b;
      q[0] = Math.round(pos.getX(i) * 1e4); q[1] = Math.round(pos.getY(i) * 1e4); q[2] = Math.round(pos.getZ(i) * 1e4);
      q[3] = Math.round(nor.getX(i) * 50); q[4] = Math.round(nor.getY(i) * 50); q[5] = Math.round(nor.getZ(i) * 50);
      q[6] = Math.round(r * 60); q[7] = Math.round(gg * 60); q[8] = Math.round(b * 60);
      let h = 0;
      for (let k = 0; k < 9; k++) h = Math.imul(h ^ q[k], 0x9e3779b1) >>> 0;
      let j, list = seen.get(h);
      if (list) for (const c of list) { let same = true; for (let k = 0; k < 9 && same; k++) same = K[c * 9 + k] === q[k]; if (same) { j = c; break; } }
      if (j === undefined) {
        j = P.length / 3;
        if (list) list.push(j); else seen.set(h, [j]);
        K.push(...q);
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); P.push(v.x, v.y, v.z); box.expandByPoint(v);
        v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); N.push(v.x, v.y, v.z);
        C.push(r, gg, b);
      }
      at.push(j);
    }
    if (idx) for (let i = 0; i < idx.count; i++) I.push(at[idx.getX(i)]); else for (let i = 0; i < pos.count; i++) I.push(at[i]);
    out.push({ P, N, C, I, box, body: o.parent === root.userData.body, leg: root.userData.legs.some(l => isIn(o, l.hip)) });
  });
  out.phi = root.userData.phi || 0;
  return out;
}
const isIn = (o, g) => { for (let q = o; q; q = q.parent) if (q === g) return true; return false; };
function carcassModel(m, id, held = false) {
  const parts = bakeCarcass(posedCarcass(id, held));
  // Where it goes: on the ground, standing on y = 0 and centred; carried, draped (bend) and its ends a little forward,
  // round the neck (z += WRAP x²), and the origin where it rests on the nape (HOLD.across): in the middle of it, the
  // front of its belly (so a fat one, the sheep, the pig, sits further back and does not go into the head) and its
  // lowest point there
  const all = new THREE.Box3(), trunk = new THREE.Box3();
  for (const p of parts) { all.union(p.box); if (p.body) trunk.union(p.box); }
  const c = (held ? trunk : all).getCenter(new THREE.Vector3()), dy = held ? -c.y : -all.min.y, WRAP = 0.3, phi = parts.phi, o = [0, 0, 0];
  const at = (p, i) => {
    let x = p.P[i] - c.x, y = p.P[i + 1] + dy, z = p.P[i + 2] - c.z, nx = p.N[i], ny = p.N[i + 1], nz = p.N[i + 2];
    if (held) {
      const f = Math.max(-phi, Math.min(phi, x / DRAPE.R));
      [nx, ny] = bend(nx, ny, f, 0); [x, y] = bend(x, y, phi);
      z += WRAP * x * x; nx -= 2 * WRAP * x * nz; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    }
    return [x - o[0], y - o[1], z - o[2], nx, ny, nz];
  };
  if (held) {
    let y0 = Infinity, z0 = -Infinity;
    for (const p of parts) if (p.body) for (let i = 0; i < p.P.length; i += 3) { const [x, y, z] = at(p, i); if (Math.abs(x) < 0.1) { y0 = Math.min(y0, y); z0 = Math.max(z0, z); } }
    if (y0 < Infinity) o[1] = y0, o[2] = z0;
  }
  const B = m.B('carcass'), body = [], legs = [];
  B.col ||= new Array(B.pos.length).fill(1);
  let tipY = Infinity, tipZ = 0;
  for (const p of parts) {
    const off = B.pos.length / 3, box = new THREE.Box3();
    for (let i = 0; i < p.P.length; i += 3) {
      const [x, y, z, nx, ny, nz] = at(p, i);
      if (held && p.leg && z > 0 && y < tipY) { tipY = y; tipZ = z; }
      B.pos.push(x, y, z); B.nor.push(nx, ny, nz); B.uv.push(0, 0); B.col.push(p.C[i], p.C[i + 1], p.C[i + 2]);
      box.expandByPoint(v3.set(x, y, z));
    }
    for (const i of p.I) B.idx.push(i + off);
    m.solids.push([box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z]);
    if (held && !p.leg) for (let i = 0, n = Math.ceil(p.P.length / 3 / (p.body ? 500 : 40)); i < p.P.length; i += 3 * n) body.push(...at(p, i).slice(0, 3));   // (the neck and the head too: the sheep's, of wool, is thick)
    if (held && p.leg) for (let i = 0, n = Math.ceil(p.P.length / 3 / 40); i < p.P.length; i += 3 * n) { const q = at(p, i); if (q[2] > 0) legs.push(q[0], q[1], q[2]); }
  }
  // (carried, for the first person view, carry3d.js carriedView: where the hooves hang in front, the lowest of the legs,
  // and some points of the rest of it, to keep it out of sight, and of its legs in front, to keep them low)
  if (held) { m.tip = [tipY, tipZ]; m.trunk = body; m.legs = legs; }
}
const v3 = new THREE.Vector3();
// (the carried pose, made when there is time after the one on the ground: it is the next thing one does with it)
const later = f => (globalThis.requestIdleCallback ? requestIdleCallback(f, { timeout: 3000 }) : setTimeout(f, 500));
for (const id of Object.keys(BULKY)) if (BULKY[id].prey) BUILD[id] = (m, pose) => { carcassModel(m, id, pose === 'held'); if (pose !== 'held') later(() => getModel(id + ':held')); };

// ---------- the wheelbarrow (carry-items.js BARROW; barrow.js) ----------
// An old wooden one: a tray of boards with flared sides and a sloping front over the wheel, on two shafts that run from
// the grips to the axle; one wheel of eight spokes with an iron tyre; two legs with a stretcher. Its measures are the
// logic's (BARROW): the origin in the middle of its footprint, on the ground, the wheel to +z and the grips to -z; parked,
// it rests on the wheel and the legs with the grips at GRIP_Y. What it carries goes in the tray, in the tray's own frame
// (TRAY: tipped a little, front up, so that pushed, with the grips lifted, it is nearly level): up to three big things
// (the logs along it, two side by side and one on top; the carcasses lying along it, one on another) and, with stacks
// in it ('f'), a heap of sacks under a tarp. Its solids are always those of the empty one (the logic, freeObject and
// fitFree, needs them not to change with what it carries), inside its footprint. One model per key, cached as any other
const BARROW0 = { ID: 'wheelbarrow', STACKS: 12, LOADS: 3, SLOW: 0.85, DEEP: 0.5, TURN: 3.0, LEN: 1.45, WIDTH: 0.62, WHEEL_Z: 0.55, WHEEL_R: 0.17, GRIP_Z: -0.725, GRIP_X: 0.27, GRIP_Y: 0.42, GRIP_AHEAD: 0.35, GRIP_H: 0.8 };
// (the logic's measures, or these same ones until carry-items.js has them)
export const barrowSize = () => CARRY.BARROW || BARROW0;
// What a model key says ('wheelbarrow', 'wheelbarrow:log,carcass_deer', 'wheelbarrow:log:f', 'wheelbarrow::f'): the big
// things (only those of BULKY, at most three, sorted) and whether there are stacks in it. Whatever comes from the network
// gives one of the keys this game makes (so a bad one cannot fill the cache)
export function barrowOf(key) {
  const [, a = '', b = ''] = String(key || '').split(':');
  const ids = a.split(',').filter(id => BULKY[id]).slice(0, 3).sort();
  return { ids, full: b === 'f' };
}
export const barrowName = key => { const { ids, full } = barrowOf(key); return 'wheelbarrow' + (ids.length || full ? ':' + ids.join(',') : '') + (full ? ':f' : ''); };
// The tray: its floor (x ±HW, z from Z0 to Z1, BOARD thick), the sides H high, flared out by FLARE, the back leaning back
// by BACK and the front leaning forward, FRONT from the ground; tipped up at the front by TIP and placed with the back of
// its floor on the shafts (its floor's middle at z = AT)
export const TRAY = { HW: 0.22, Z0: -0.34, Z1: 0.3, BOARD: 0.025, H: 0.24, T: 0.022, FLARE: 0.25, BACK: 0.24, FRONT: 0.96, TIP: 0.07, AT: -0.04 };
const AXLE_X = 0.075;   // (the shafts at the axle, either side of the hub)
// Where a shaft's middle line is at z (x, y), from the grip end to the axle
function shaftAt(S, z) { const s = (z - S.GRIP_Z) / (S.WHEEL_Z - S.GRIP_Z); return [S.GRIP_X + (AXLE_X - S.GRIP_X) * s, S.GRIP_Y + (S.WHEEL_R - S.GRIP_Y) * s]; }
// The tray's frame in the model's: its origin under the middle of its floor, tipped by TIP; the back of its floor on the shafts
function trayFrame(S) {
  const t = TRAY, back = shaftAt(S, t.AT + t.Z0)[1] + 0.026, y = back - t.Z0 * Math.sin(t.TIP);
  return new THREE.Matrix4().makeRotationX(-t.TIP).setPosition(0, y, t.AT);
}
// (the tray's floor at a z of the model, its height there: for the bearers)
function trayFloorY(S, F, z) { const v = new THREE.Vector3(0, 0, (z - TRAY.AT) / Math.cos(TRAY.TIP)).applyMatrix4(F); return v.y; }

// A builder's triangles, moved by m4, into another builder (with their colours, if they have them: the carcasses)
const NM3 = new THREE.Matrix3(), PV = new THREE.Vector3();
function addBuilder(dst, src, m4) {
  const off = dst.pos.length / 3, n = src.pos.length / 3;
  NM3.getNormalMatrix(m4);
  if (src.col && !dst.col) dst.col = new Array(off * 3).fill(1);
  for (let i = 0; i < n * 3; i += 3) {
    PV.set(src.pos[i], src.pos[i + 1], src.pos[i + 2]).applyMatrix4(m4); dst.pos.push(PV.x, PV.y, PV.z);
    PV.set(src.nor[i], src.nor[i + 1], src.nor[i + 2]).applyMatrix3(NM3).normalize(); dst.nor.push(PV.x, PV.y, PV.z);
  }
  for (let i = 0; i < src.uv.length; i++) dst.uv.push(src.uv[i]);
  if (dst.col) { if (src.col) for (let i = 0; i < src.col.length; i++) dst.col.push(src.col[i]); else dst.pushCol(n); }
  for (let i = 0; i < src.idx.length; i++) dst.idx.push(src.idx[i] + off);
}
// Every part of a model into this one, moved by m4 (its solids are not added)
function addModel(m, src, m4) { for (const [key, B] of src.parts) addBuilder(m.B(key), B, m4); }
const M4 = (p, r = [0, 0, 0], s = 1) => new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s));
// The frame of a piece that runs from p0 to p1: its z along it, its x across as square to hint as it can be
function along(p0, p1, hint = [0, 1, 0]) {
  const a = new THREE.Vector3(...p0), b = new THREE.Vector3(...p1), z = b.clone().sub(a), L = z.length();
  z.normalize();
  const x = new THREE.Vector3().crossVectors(new THREE.Vector3(...hint), z).normalize(), y = new THREE.Vector3().crossVectors(z, x);
  return { m4: new THREE.Matrix4().makeBasis(x, y, z).setPosition(a.add(b).multiplyScalar(0.5)), L };
}
// A beam of w × h from p0 to p1, its edges worn, the grain along it
function beam(m, key, p0, p1, w, h, hint, frame) {
  const { m4, L } = along(p0, p1, hint), b = new Builder();
  b.roundBox(-w / 2, -h / 2, -L / 2, w / 2, h / 2, L / 2, Math.min(0.006, w * 0.3, h * 0.3), { s: 0.5 });
  addBuilder(m.B(key), b, frame ? frame.clone().multiply(m4) : m4);
}
// A round stick of radius r from p0 to p1
function stick(m, key, p0, p1, r, seg = 8, frame) {
  const { m4, L } = along(p0, p1, Math.abs(p1[1] - p0[1]) > 0.9 * Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) ? [0, 0, 1] : [0, 1, 0]);
  const g = new THREE.CylinderGeometry(r, r, L, seg, 1); g.rotateX(Math.PI / 2);
  m.B(key).addGeometry(g, frame ? frame.clone().multiply(m4) : m4); g.dispose();
}
// A board cut to a four-sided outline (in its own plane: u across, v up it), T thick, put with the frame of basis (u, v,
// and its thickness along u × v) at o. The wood's grain repeats every half metre, as in the boxes
function board(m, key, pts, u, v, o, frame, T = TRAY.T) {
  const sh = new THREE.Shape(); sh.moveTo(...pts[0]); for (let i = 1; i < pts.length; i++) sh.lineTo(...pts[i]); sh.lineTo(...pts[0]);
  const g = new THREE.ExtrudeGeometry(sh, { depth: T - 0.006, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1, curveSegments: 1 });
  g.translate(0, 0, 0.003);   // (with its bevel, from 0 to T)
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 2);
  const U = new THREE.Vector3(...u).normalize(), V = new THREE.Vector3(...v).normalize(), W = new THREE.Vector3().crossVectors(U, V);
  m.B(key).addGeometry(g, frame.clone().multiply(new THREE.Matrix4().makeBasis(U, V, W).setPosition(...o))); g.dispose();
}

function barrowBody(m, S) {
  const R = S.WHEEL_R, WZ = S.WHEEL_Z, t = TRAY, F = trayFrame(S);
  // The shafts: square, from the grips to past the axle, the grips rounded
  for (const sd of [-1, 1]) {
    const g0 = [sd * S.GRIP_X, S.GRIP_Y, S.GRIP_Z], a = [sd * AXLE_X, R, WZ], d = [a[0] - g0[0], a[1] - g0[1], a[2] - g0[2]], L = Math.hypot(...d), u = d.map(x => x / L);
    const at = (p, k) => p.map((x, i) => x + u[i] * k);
    stick(m, 'dark', at(g0, 0.004), at(g0, 0.16), 0.019, 10);
    beam(m, 'dark', at(g0, 0.15), at(a, 0.07), 0.042, 0.052);
    // (the legs, from under the shaft to the ground, a little splayed, with an iron shoe; and an iron plate where the axle goes through)
    const z = -0.31, [x, y] = shaftAt(S, z);
    beam(m, 'dark', [sd * x, y - 0.012, z], [sd * (x + 0.035), 0.02, z - 0.025], 0.04, 0.042, [0, 0, 1]);
    m.B('iron').roundBox(sd * (x + 0.035) - 0.024, 0, z - 0.049, sd * (x + 0.035) + 0.024, 0.025, z - 0.001, 0.004);
    m.B('iron').roundBox(sd * AXLE_X - 0.024, R - 0.035, WZ - 0.04, sd * AXLE_X + 0.024, R + 0.035, WZ + 0.04, 0.004);
  }
  { const z = -0.32, [x] = shaftAt(S, z); stick(m, 'dark', [-(x + 0.03), 0.14, z - 0.02], [x + 0.03, 0.14, z - 0.02], 0.013); }
  // The wheel: hub, eight spokes, the wooden rim and the iron tyre round it, on an iron axle
  { const W = new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(0, R, WZ), sc = (k) => W.clone().multiply(new THREE.Matrix4().makeScale(1, 1, k));
    const tyre = new THREE.TorusGeometry(R - 0.013, 0.013, 6, 32), rim = new THREE.TorusGeometry(R - 0.036, 0.019, 6, 28);
    m.B('iron').addGeometry(tyre, sc(1.9)); m.B('dark').addGeometry(rim, sc(1.15)); tyre.dispose(); rim.dispose();
    stick(m, 'dark', [-0.05, R, WZ], [0.05, R, WZ], 0.04, 12);
    stick(m, 'iron', [-AXLE_X - 0.03, R, WZ], [AXLE_X + 0.03, R, WZ], 0.012, 6);
    for (let i = 0; i < 8; i++) { const q = (i / 8) * Math.PI * 2 + 0.2, c = Math.cos(q), s = Math.sin(q); stick(m, 'dark', [0, R + s * 0.035, WZ + c * 0.035], [0, R + s * (R - 0.045), WZ + c * (R - 0.045)], 0.0095, 6); }
  }
  // The bearers: cross pieces on the shafts that hold the floor of the tray
  for (const z of [t.AT + t.Z0 + 0.05, t.AT - 0.02, t.AT + t.Z1 - 0.06]) {
    const [x, y] = shaftAt(S, z), top = trayFloorY(S, F, z);
    m.B('dark').roundBox(-x - 0.035, y + 0.015, z - 0.025, x + 0.035, top + 0.004, z + 0.025, 0.006, { s: 0.5 });
  }
  // The tray: three boards for its floor, the two sides (wider at the top and longer forward, where the front leans out),
  // the back and the front; the sides capped along their top and held by iron straps
  const H = t.H, out = Math.tan(t.FLARE) * H, hw = t.HW, zf = t.Z1 + H / Math.tan(t.FRONT), zb = t.Z0 - H * Math.tan(t.BACK);
  for (const x of [-0.149, 0, 0.149]) { const b = new Builder(); b.roundBox(x - 0.071, 0, t.Z0, x + 0.071, t.BOARD, t.Z1, 0.004, { s: 0.5 }); addBuilder(m.B('wood'), b, F); }
  for (const sd of [-1, 1]) {
    const u = [0, 0, 1], v = [sd * Math.sin(t.FLARE), Math.cos(t.FLARE), 0], L = H / Math.cos(t.FLARE);
    // (its thickness goes along u × v: inwards on the right side, outwards on the left; so it starts at its outer face or its inner one)
    board(m, 'wood', [[t.Z0 - 0.022, 0], [t.Z1 + 0.024, 0], [zf + 0.026, L], [zb - 0.02, L]], u, v, [sd > 0 ? hw + t.T : -hw, 0, 0], F);
    const top = [sd * (hw + out + t.T * 0.5), H + 0.006];
    beam(m, 'dark', [top[0], top[1], zb - 0.02], [top[0], top[1], zf + 0.03], 0.034, 0.02, [0, 1, 0], F);
    for (const z of [t.Z0 + 0.06, t.Z1 - 0.02]) beam(m, 'iron', [sd * (hw + t.T + 0.002), 0.01, z], [sd * (hw + t.T + out + 0.002), H - 0.004, z], 0.005, 0.03, [0, 0, 1], F);
  }
  { const L = H / Math.cos(t.BACK); board(m, 'wood', [[-hw, 0], [hw, 0], [hw + out, L], [-hw - out, L]], [1, 0, 0], [0, Math.cos(t.BACK), -Math.sin(t.BACK)], [0, 0, t.Z0 - t.T], F); }
  { const L = H / Math.sin(t.FRONT); board(m, 'wood', [[-hw, 0], [hw, 0], [hw + out, L], [-hw - out, L]], [1, 0, 0], [0, Math.sin(t.FRONT), Math.cos(t.FRONT)], [0, 0, t.Z1], F); }
  return F;
}
// The heap of sacks under a tarp, h high, on the floor of the tray (F): the tarp over them, lumpy, a strap across it and
// the corner of a sack showing at the back
function barrowSacks(m, F, h) {
  const t = TRAY, rx = t.HW - 0.01, rz = (t.Z1 - t.Z0) / 2 - 0.01, cz = (t.Z0 + t.Z1) / 2, y0 = t.BOARD;
  const g = new THREE.SphereGeometry(1, 16, 7, 0, Math.PI * 2, 0, Math.PI / 2), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + 0.07 * Math.sin(x * 9 + z * 5) * Math.sin(z * 7 - x * 3) * y;
    p.setXYZ(i, x * rx * (1 + 0.12 * y), y0 + y * h * k, cz + z * rz * (1 + 0.12 * y));   // (fuller at the top: it fills the flared tray)
  }
  g.computeVertexNormals();
  m.B('tarp').addGeometry(g, F); g.dispose();
  const pts = []; for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI; pts.push(new THREE.Vector3(Math.cos(a) * (rx + 0.008) * (1 + 0.12 * Math.sin(a)), y0 + Math.sin(a) * h + 0.008, cz)); }
  const rope = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.008, 5); m.B('dark').addGeometry(rope, F); rope.dispose();   // (a dark strap: one draw call fewer)
  const sack = new THREE.SphereGeometry(1, 10, 7); m.B('tarp').addGeometry(sack, F.clone().multiply(M4([rx * 0.55, y0 + h * 0.55, t.Z0 + 0.1], [0.3, 0.4, 0.2], [0.08, Math.max(0.06, h * 0.55), 0.07]))); sack.dispose();
}
// (how big a thing lies: the box round its model's solids)
function lieBox(id) { const m = getModel(id), b = new THREE.Box3(); for (const s of m?.solids || []) { b.expandByPoint(PV.set(s[0], s[1], s[2])); b.expandByPoint(PV.set(s[3], s[4], s[5])); } return b; }
// What it carries, in the tray (F): the logs along it (thinner than on the ground: 0.7 of their length, so they fit
// between the front and the back), two side by side and the third on them; then the carcasses on them, lying across
// it on their side as on the ground (a little smaller), their legs towards the wheel, over the sloping front, and never
// lower than the top of the sides (they are longer than the tray is wide: their head and rump lie over the sides); the
// next one on it, turned round (its legs to the grips)
export const LOAD_IN = { log: { len: 0.68, thick: 0.85, side: 0.088 }, carcass: { k: 0.74, rise: 0.62 } };
function barrowLoads(m, F, ids, y) {
  const logs = ids.filter(id => !BULKY[id].prey), meat = ids.filter(id => BULKY[id].prey), L = LOAD_IN.log, cz = (TRAY.Z0 + TRAY.Z1) / 2;
  if (logs.length) {
    const at = logs.length === 1 ? [[0, y, cz]] : [[-L.side, y, cz - 0.01], [L.side, y, cz + 0.01]];
    if (logs.length === 3) at.push([0, y + 0.135, cz]);
    for (const p of at) addModel(m, getModel('log'), F.clone().multiply(M4(p, [0, Math.PI / 2, 0], [L.len, L.thick, L.thick])));
    y += logs.length === 3 ? 0.27 : 2 * LOG.r * L.thick - 0.01;
  }
  const C = LOAD_IN.carcass;
  y = Math.max(y, TRAY.H + 0.02);   // (longer than the tray is wide: across its top, its head and its rump over the sides)
  meat.forEach((id, i) => {
    const b = lieBox(id);
    addModel(m, getModel(id), F.clone().multiply(M4([0, y - 0.01, cz + (i % 2 ? 0.05 : -0.05)], [0, i % 2 ? Math.PI : 0, 0], C.k)));
    y += (b.max.y - b.min.y) * C.k * C.rise;
  });
}
BUILD.wheelbarrow = (m, a, b) => {
  // (loaded, the empty one's parts copied: made once)
  const S = barrowSize(), { ids, full } = barrowOf(`wheelbarrow:${a || ''}:${b || ''}`), loaded = ids.length || full;
  const F = loaded ? trayFrame(S) : barrowBody(m, S);
  if (loaded) addModel(m, getModel('wheelbarrow'), new THREE.Matrix4());
  let y = TRAY.BOARD;
  if (full) { barrowSacks(m, F, ids.length ? 0.09 : 0.2); y += ids.length ? 0.06 : 0; }
  if (ids.length) barrowLoads(m, F, ids, y);
  // (the solids, always the empty one's, inside the footprint: the tray, the grips, the legs, the shafts under the front and the wheel)
  const hx = S.WIDTH / 2, gz = S.GRIP_Z, [lx] = shaftAt(S, -0.31);
  m.solids = [[-hx, 0.24, -0.42, hx, 0.7, 0.47], [-S.GRIP_X - 0.02, 0.33, gz, S.GRIP_X + 0.02, 0.47, -0.42], [-lx - 0.06, 0, -0.37, lx + 0.06, 0.36, -0.28],
    [-0.14, 0.15, 0.3, 0.14, 0.3, 0.6], [-0.06, 0, 0.38, 0.06, 2 * S.WHEEL_R, Math.min(S.LEN / 2, S.WHEEL_Z + S.WHEEL_R)]];
};

// El que se cuelga (origen en el suelo, colgado del techo, con su luz)
BUILD.candelabro = m => chandelier(m, WALL_H).light(0, WALL_H - 0.6, 0, { color: '#ffd08a', intensity: 4.5, range: 11, halo: 0 });   // (sin halo: lo llevan sus velas)

// ---------- the bath (Plan E §5.4) ----------
// The foam over the water while someone bathes (actors.js shows it with the bather, so another player's bath shows too):
// a soft sheet a little smaller than the inside of the tub, around the body, with a few heaps of bubbles. Its origin is at
// the water level, under the bather's hip, and it reaches forward over the legs (+z). One shared geometry and material,
// made the first time (vertex colours, as most models: a program the game already has)
let FOAM = null;
export function bathFoam() {
  if (!FOAM) {
    const parts = [], white = '#f3f0e8', shade = '#dcd8ce';
    const sheet = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2);
    sheet.scale(TUB.x - TUB.t - 0.035, 1, 0.6).translate(0, 0.004, 0.32);
    parts.push(paintGeo(sheet, white));
    let q = 1234567;
    const rnd = () => ((q = (Math.imul(q, 1103515245) + 12345) >>> 0) / 4294967296);
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()), r = 0.03 + rnd() * 0.05;
      const bx = Math.cos(a) * rr * (TUB.x - TUB.t - 0.09), bz = 0.32 + Math.sin(a) * rr * 0.5;
      const b = new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(r, r * 0.6, r).translate(bx, 0, bz);
      parts.push(paintGeo(b, i % 3 ? white : shade));
    }
    let n = 0;
    for (const g of parts) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), idx = [];
    let o = 0;
    for (const g of parts) {
      pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3);
      for (const k of g.index.array) idx.push(k + o);
      o += g.attributes.position.count; g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeBoundingSphere();
    FOAM = { geo, mat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.84 }) };
  }
  const m = new THREE.Mesh(FOAM.geo, FOAM.mat);
  m.receiveShadow = true; m.userData.shared = true;   // (never disposed with the person: shared by every bath)
  return m;
}
function paintGeo(g, c) {
  const k = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = k.r; a[i * 3 + 1] = k.g; a[i * 3 + 2] = k.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
