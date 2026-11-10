// Modelos en 3D de lo que se coloca y de lo que hay en el mundo: estaciones de trabajo (banco, horno, yunque,
// telar, cocina), muebles (cama, mesa, sillas, estanterías, lámparas, cofres, alfombras, macetas, vitrinas),
// cosas del rancho y del huerto (gallinero, establo, colmena, comedero, aspersor, cultivos en cada fase), el
// hogar con chimenea, las cosas del pueblo (puestos, tablón, fuente, muelle, buzón, farola
// y cartel), los lugares que se descubren (ruinas, campamento, torre, barco hundido, templo, altar, cueva,
// faro) y los cofres del tesoro.
//
// Cada modelo se hace una vez, en coordenadas locales (el suelo en y = 0, el centro de su casilla en el origen
// y el frente mirando a +z), con sus piezas agrupadas por material para juntarlas luego con las del resto del
// trozo en unas pocas mallas. Lo que no se junta (fuego, cristal, agua) va aparte, igual que sus luces.
import * as THREE from 'three';
import { flowerBunch } from './flowers3d.js';
import { Builder, mat, rockGeo, snowCap } from './geo.js';
import { wood as wood0, stone as stone0, rockFace, rng, rug, rugDesign, notes, awning, planks, furrows, artwork } from './textures.js';
import { apagado } from '../arte.js';

// Las cajas de los modelos con los cantos biselados, según su material: redondeadas en lo blando (mantas, sábanas,
// cojines, cuero), con el canto gastado en la madera y un poco en la piedra
const BEVEL = Object.assign(
  Object.fromEntries(['quilt', 'quiltB', 'quiltK', 'quiltK2', 'pillowK', 'sheet', 'cloth', 'sofa', 'sofaB', 'leather', 'leatherD', 'baby'].map(k => [k, 0.04])),
  Object.fromEntries(['wood', 'dark', 'light', 'plank', 'hull'].map(k => [k, 0.012])),
  Object.fromEntries(['stone', 'brick', 'temple', 'templeD', 'rock', 'marble', 'marbleD'].map(k => [k, 0.018])),
  { ashlar: 0.035 },
);
import { CROPS, ITEMS } from '../items.js';
import { WALL_H, FLOOR_H } from './build3d.js';
import { SOLIDS, hull } from '../world/fit.js';
import { TOWER, inHole } from '../world/tower.js';

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

// ---------- muebles y estaciones ----------
let DOME;
const BUILD = {
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
    const z0 = -0.4, z1 = 1.38, x = 0.42, t = 0.07;
    m.box('porcelain', -x, 0.14, z0, x, 0.3, z1);   // el fondo y, alrededor, las paredes con su borde
    m.box('porcelain', -x, 0.3, z0, -x + t, 0.62, z1).box('porcelain', x - t, 0.3, z0, x, 0.62, z1).box('porcelain', -x, 0.3, z0, x, 0.62, z0 + t).box('porcelain', -x, 0.3, z1 - t, x, 0.62, z1);
    m.box('porcelain', -x - 0.03, 0.62, z0 - 0.03, x + 0.03, 0.66, z0 + t).box('porcelain', -x - 0.03, 0.62, z1 - t, x + 0.03, 0.66, z1 + 0.03);
    m.box('porcelain', -x - 0.03, 0.62, z0 + t, -x + t, 0.66, z1 - t).box('porcelain', x - t, 0.62, z0 + t, x + 0.03, 0.66, z1 - t);
    m.box('water', -x + t, 0.3, z0 + t, x - t, 0.52, z1 - t);
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
    m.fire(0, 1.08, 0, 0.7).light(0, 1.25, 0, { color: '#ffa850', intensity: 3.2, range: 9, flicker: true });
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
  colmena(m) {
    for (const [x, z] of [[-0.25, -0.2], [0.21, -0.2], [-0.25, 0.16], [0.21, 0.16]]) m.box('dark', x, 0, z, x + 0.04, 0.3, z + 0.04);
    m.box('wood', -0.3, 0.3, -0.25, 0.3, 0.34, 0.25);
    for (let i = 0; i < 3; i++) m.box(i % 2 ? 'quiltB' : 'white', -0.26, 0.34 + i * 0.2, -0.22, 0.26, 0.52 + i * 0.2, 0.22);
    m.box('wood', -0.3, 0.94, -0.26, 0.3, 1.0, 0.26).box('soot', -0.08, 0.36, 0.22, 0.08, 0.39, 0.23);
    for (let i = 0; i < 5; i++) m.ball('bee', Math.sin(i * 2.1) * 0.35, 0.6 + (i % 3) * 0.15, 0.3 + Math.cos(i * 1.3) * 0.15, 0.025, 0.02, 0.03, 6);
  },
  comedero(m) {
    m.box('wood', -0.48, 0.12, -0.25, 0.48, 0.16, 0.25).box('wood', -0.48, 0.16, -0.25, 0.48, 0.42, -0.21).box('wood', -0.48, 0.16, 0.21, 0.48, 0.42, 0.25).box('wood', -0.48, 0.16, -0.21, -0.44, 0.42, 0.21).box('wood', 0.44, 0.16, -0.21, 0.48, 0.42, 0.21);
    for (const x of [-0.42, 0.36]) m.box('dark', x, 0, -0.2, x + 0.06, 0.12, 0.2);
    m.box('hay', -0.43, 0.16, -0.2, 0.43, 0.34, 0.2);
  },
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
function roofPrism(m, key, x0, x1, z0, z1, y0, h) {
  const B = m.B(key), A = [x0, y0, z0], Bp = [x1, y0, z0], C = [x1, y0, z1], D = [x0, y0, z1], E = [x0, y0 + h, (z0 + z1) / 2], F = [x1, y0 + h, (z0 + z1) / 2];
  B.quadN(D, C, F, E, [0, 0.6, 0.8], [[x0, 0], [x1, 0], [x1, 1], [x0, 1]]);
  B.quadN(Bp, A, E, F, [0, 0.6, -0.8], [[x1, 0], [x0, 0], [x0, 1], [x1, 1]]);
  B.tri(A, D, E, [-1, 0, 0], [[z0, 0], [z1, 0], [(z0 + z1) / 2, h]]);
  B.tri(C, Bp, F, [1, 0, 0], [[z1, 0], [z0, 0], [(z0 + z1) / 2, h]]);
}

// ---------- cultivos ----------
function crop(m, id, stage) {
  if (stage > 0) return crop2(m, id, stage);   // (con hojas de verdad: ver crop2)
  m.geo('soil', ICO1, 0, 0.02, 0, [0, 0, 0], [0.22, 0.06, 0.22]);
  if (stage < 0) { for (let i = 0; i < 4; i++) m.cyl('dry', Math.cos(i * 1.6) * 0.06, 0.02, Math.sin(i * 1.6) * 0.06, 0.01, 0.006, 0.18, 4, [Math.sin(i) * 0.6, 0, Math.cos(i) * 0.6]); return; }
  if (stage === 0) { for (let i = 0; i < 3; i++) m.ball('soil', Math.cos(i * 2.1) * 0.08, 0.06, Math.sin(i * 2.1) * 0.08, 0.03, 0.02, 0.03, 6); }
}
// Cultivos con hojas de verdad: alargadas, con su nervio, curvadas hacia abajo y con algo de azar en cada
// planta (fijo por especie y fase); trigo de muchas cañas con espiga, maíz de hojas largas con mazorcas, tomatera con
// tutor y racimos, calabaza acostillada y raíces que asoman. Sin tope de piezas: van al mismo material por color
function crop2(m, id, stage) {
  const c = CROPS[id], fruitKey = 'fruit:' + c.color, leafKey = 'leafc:' + c.leaf, R = rng2(id.length * 31 + stage * 7);
  m.geo('soil', ICO1, 0, 0.015, 0, [0, 0, 0], [0.24, 0.05, 0.24]);
  const big = stage === 3 ? 1 : stage === 2 ? 0.75 : 0.45;
  // Una mata de hojas en roseta: n hojas de largo len, saliendo con la inclinación rise (cuanto más negativa, más tumbadas)
  const rosette = (n, len, rise, y = 0.03, wide = 0.28, key = leafKey) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + R() * 0.6, l = len * (0.75 + R() * 0.45);
      m.geo(key, LEAF2, Math.cos(a) * 0.015, y, Math.sin(a) * 0.015, [rise + (R() - 0.5) * 0.35, a, (R() - 0.5) * 0.3], [l * wide, l, l]);
    }
  };
  if (id === 'trigo' || id === 'maiz') {
    const tall = (id === 'maiz' ? 1.75 : 0.85) * big, n = id === 'maiz' ? 3 : 26;
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, r = id === 'maiz' ? 0.09 * Math.sqrt(R()) : 0.17 * Math.sqrt(R()), x = Math.cos(a) * r, z = Math.sin(a) * r, h = tall * (0.85 + R() * 0.25);
      const lean = [(R() - 0.5) * 0.15, 0, (R() - 0.5) * 0.15], ripe = stage === 3 && id === 'trigo';
      m.cyl(ripe ? fruitKey : leafKey, x, 0.02, z, id === 'maiz' ? 0.022 : 0.006, id === 'maiz' ? 0.014 : 0.004, h, 5, lean);
      if (id === 'trigo') { if (stage >= 2) m.geo(ripe ? fruitKey : leafKey, SPIKE, x + lean[2] * h, h, z - lean[0] * h, lean, [0.016, 0.075, 0.016]); }
      else {
        for (let k = 0; k < 6; k++) m.geo(leafKey, LEAF2, x, 0.25 + k * h * 0.13, z, [-0.35 - R() * 0.4, a + k * 2.4, 0], [0.09, 0.55 * big, 0.55 * big]);
        if (stage === 3) for (const s of [0.45, 0.6]) m.geo(fruitKey, SPIKE, x + 0.05, h * s, z, [0.35, a, 0], [0.04, 0.2, 0.04]);
        m.geo('fruit:#c9a36a', SPIKE, x, h, z, [0, 0, 0], [0.02, 0.14, 0.02]);   // (el penacho)
      }
    }
    return;
  }
  if (id === 'tomate') {
    const h = 1.1 * big;
    m.cyl('wood', 0.1, 0, 0, 0.012, 0.012, h + 0.15, 5);   // (el tutor)
    m.cyl(leafKey, 0.02, 0.02, 0, 0.012, 0.008, h, 5, [0, 0, -0.05]);
    for (let k = 0; k < Math.round(9 * big); k++) {
      const y = 0.15 + (k / 9) * h, a = k * 2.4 + R();
      for (let j = 0; j < 3; j++) m.geo(leafKey, LEAF2, 0.02, y, 0, [-0.5 - R() * 0.5, a + (j - 1) * 0.5, 0], [0.11, 0.24, 0.24]);
    }
    if (stage === 3) for (let k = 0; k < 9; k++) { const a = k * 2.1, y = 0.25 + (k % 4) * 0.2; m.ball(fruitKey, Math.cos(a) * 0.12, y, Math.sin(a) * 0.12, 0.045, 0.04, 0.045, 10); }
    return;
  }
  if (id === 'calabaza') {
    rosette(7, 0.34 * big, -1.25, 0.05, 0.85);
    if (stage === 3) { m.geo(fruitKey, PUMPKIN, 0.06, 0.19, 0.06, [0, 0.4, 0], [0.26, 0.19, 0.26]); m.cyl('leafc:' + c.leaf, 0.06, 0.21, 0.06, 0.018, 0.012, 0.07, 5); }
    return;
  }
  if (id === 'fresa') {
    rosette(12, 0.24 * big, -0.9, 0.03, 0.9);
    if (stage === 3) for (let k = 0; k < 7; k++) m.geo(fruitKey, CONE, Math.cos(k * 0.9) * 0.15, 0.04, Math.sin(k * 0.9) * 0.15, [Math.PI, 0, 0], [0.028, 0.05, 0.028]);
    return;
  }
  // Raíces: la zanahoria con hojas finas y altas; el nabo, más anchas. Maduras, asoma la raíz
  rosette(id === 'zanahoria' ? 18 : 10, (id === 'zanahoria' ? 0.44 : 0.36) * big, id === 'zanahoria' ? -0.3 : -0.55, 0.04, id === 'zanahoria' ? 0.26 : 0.6);
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
  mailbox(m) {
    m.box('dark', -0.05, 0, -0.05, 0.05, 1.0, 0.05).box('awningB', -0.15, 0.98, -0.21, 0.15, 1.0, 0.21);
    m.geo('awningB', new THREE.CylinderGeometry(0.15, 0.15, 0.42, 12, 1, false, 0, Math.PI), 0, 1.0, 0, [Math.PI / 2, 0, Math.PI / 2]);
    m.box('red', 0.15, 1.0, -0.02, 0.17, 1.32, 0.02).box('red', 0.15, 1.2, 0.02, 0.17, 1.32, 0.16);
  },
  lamp(m) {
    m.cyl('stone', 0, 0, 0, 0.2, 0.16, 0.3, 10).cyl('iron', 0, 0.3, 0, 0.06, 0.045, 2.6, 8);
    m.cyl('lamp', 0, 2.84, 0, 0.1, 0.13, 0.32, 6).geo('iron', CONE, 0, 3.25, 0, [0, 0, 0], [0.2, 0.18, 0.2]);
    m.light(0, 2.9, 0, { color: '#ffc070', intensity: 6, range: 12 });
  },
  sign(m) {
    m.box('dark', -0.05, 0, -0.05, 0.05, 1.5, 0.05);
    const s = new THREE.Shape([[-0.42, -0.14], [0.3, -0.14], [0.44, 0], [0.3, 0.14], [-0.42, 0.14]].map(([a, c]) => new THREE.Vector2(a, c)));
    m.geo('wood', new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: false }), 0.05, 1.25, -0.025);
  },
  // Fuente de 3×3 casillas: pilón redondo de piedra, columna y chorro
  fountain(m) {
    m.cyl('stone', 0, 0, 0, 1.4, 1.4, 0.5, 24).cyl('stone', 0, 0.5, 0, 1.45, 1.45, 0.08, 24).cyl('stone', 0, 0, 0, 0.25, 0.2, 1.3, 12).cyl('stone', 0, 1.3, 0, 0.5, 0.45, 0.12, 16);
    const w = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.04, 24), modelMats().water); w.position.y = 0.45; m.extra(w);
    const w2 = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.03, 16), modelMats().water); w2.position.y = 1.4; m.extra(w2);
    m.fountain = [0, 1.45, 0];
  },
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
// Un muro de sillares de x0,z0 hacia (dx, dz), con la altura que queda en pie en cada tramo (heights, en metros)
function ashlarWall(m, R, x0, z0, dx, dz, heights, t = 0.36) {
  const L = 0.44, H = 0.3;
  heights.forEach((hm, i) => {
    const rows = Math.round(hm / H);
    for (let k = 0; k < rows; k++) {
      if (k === rows - 1 && R() < 0.35) continue;   // (arriba, alguno caído)
      const off = k % 2 ? L / 2 : 0, a = i * L + off, b = Math.min(heights.length * L, a + L) - 0.012, y = k * H, j = (R() - 0.5) * 0.03;
      const p0 = [x0 + dx * a, z0 + dz * a], p1 = [x0 + dx * b, z0 + dz * b];
      const xa = Math.min(p0[0], p1[0]) - (dz ? t / 2 : 0) + j, xb = Math.max(p0[0], p1[0]) + (dz ? t / 2 : 0) + j, za = Math.min(p0[1], p1[1]) - (dx ? t / 2 : 0) + j, zb = Math.max(p0[1], p1[1]) + (dx ? t / 2 : 0) + j;
      m.box('ashlar', xa, y, za, xb, y + H - 0.015, zb, 0.6);
    }
  });
}
// Una columna de tambores (con su basa y, si está entera, su capitel), de h metros; si no, rota a esa altura
function column(m, key, x, z, h, whole, R, r = 0.24) {
  m.box(key, x - r * 1.25, 0, z - r * 1.25, x + r * 1.25, 0.18, z + r * 1.25, 0.6);
  for (let y = 0.18; y < h - 0.05; y += 0.55) { const top = Math.min(h, y + 0.55); m.cyl(key, x, y, z, r, r * 0.97, top - y - 0.012, 16, [0, R() * 6, 0]); }
  if (whole) m.box(key, x - r * 1.35, h, z - r * 1.35, x + r * 1.35, h + 0.2, z + r * 1.35, 0.6);
}
// La torre vieja, por dentro y por fuera (las medidas, de world/tower.js): el muro redondo con la puerta, las saeteras, el
// pilar, la escalera de caracol, la terraza con su hueco y las almenas
function bigTower(m) {
  const T = TOWER, B = m.B('towerWall'), S = m.B('towerStone'), N = 56, TAU = Math.PI * 2, R = T.R, Ri = T.inner, H = T.H, DOOR = 2.2, TOPW = H + 0.5;
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
  for (let k = 0; k < 7; k++) { const a = 1.2 + k * 0.85, y = 3 + k * 1.3; m.geo('towerDark', BOXG, Math.sin(a) * (R + 0.01), y, Math.cos(a) * (R + 0.01), [0, a, 0], [0.16, 0.9, 0.04]); }
  // El pilar y el suelo de dentro
  m.cyl('towerStone', 0, 0, 0, T.r0, T.r0, H, 14);
  m.geo('towerStone', CIRCLE, 0, 0.02, 0, [-Math.PI / 2, 0, 0], [Ri, Ri, 1]);
  // La escalera: peldaños del pilar al muro, cada uno a la altura de la rampa que se anda
  const n = Math.round(T.turns * T.stepsPerTurn), da = TAU / T.stepsPerTurn, rm = (T.r0 + Ri) / 2, len = Ri - T.r0 + 0.06;
  for (let k = 0; k < n; k++) {
    const a = (k + 0.5) * da, top = ((k + 0.75) / T.stepsPerTurn) * T.pitch;
    m.geo('towerStone', BOXG, Math.sin(a) * rm, top - 0.14, Math.cos(a) * rm, [0, a, 0], [rm * da * 1.15, 0.28, len]);
  }
  // La terraza: el suelo de arriba (y por debajo), menos el hueco por donde llega la escalera
  const W = 40;
  for (let i = 0; i < W; i++) {
    const a0 = (i / W) * TAU, a1 = ((i + 1) / W) * TAU;
    if (inHole((a0 + a1) / 2)) continue;
    S.quadN(P(a0, T.r0 - 0.1, H), P(a1, T.r0 - 0.1, H), P(a1, Ri + 0.02, H), P(a0, Ri + 0.02, H), [0, 1, 0], [[0, 0], [0.5, 0], [0.5, 1.4], [0, 1.4]]);
    S.quadN(P(a1, T.r0 - 0.1, H - 0.3), P(a0, T.r0 - 0.1, H - 0.3), P(a0, Ri + 0.02, H - 0.3), P(a1, Ri + 0.02, H - 0.3), [0, -1, 0], [[0, 0], [0.5, 0], [0.5, 1.4], [0, 1.4]]);
  }
  m.solids.push([-R, 0, -R, R, H + T.parapet, R]);
}
const BOXG = new THREE.BoxGeometry(1, 1, 1), CIRCLE = new THREE.CircleGeometry(1, 28);
// Los lugares del mundo (poi:…): la torre grande, las ruinas, el templo y la cueva, y el campamento, el barco varado, el
// altar y el faro
const PLACES = {
  torre: bigTower,
  ruinas(m) {
    const R = rng(31);
    // Las losas del suelo, algunas levantadas y otras que faltan
    for (let i = 0; i < 16; i++) { if (R() < 0.3) continue; const x = -1.35 + (i % 4) * 0.72, z = -1.35 + Math.floor(i / 4) * 0.72, h = 0.05 + R() * 0.04; m.box('marbleD', x - 0.34, 0, z - 0.34, x + 0.34, h, z + 0.34, 0.6); }
    // Un muro en esquina, roto en escalera, y tres columnas: una entera, dos partidas
    ashlarWall(m, R, -1.55, -1.45, 1, 0, [2.4, 2.1, 1.8, 1.2, 0.9, 0.6]);
    ashlarWall(m, R, -1.55, -1.45, 0, 1, [2.4, 1.8, 1.5, 0.9, 0.6, 0.3]);
    column(m, 'ashlar', 1.05, -0.95, 3.0, true, R);
    column(m, 'ashlar', 1.05, 0.55, 1.4, false, R);
    column(m, 'ashlar', -0.15, 1.15, 0.75, false, R);
    // Tambores caídos y cascotes
    m.cyl('ashlar', 0.15, 0.24, -0.15, 0.24, 0.24, 0.54, 16, [0, 0.6, Math.PI / 2]);
    m.cyl('ashlar', 1.5, 0.24, 1.25, 0.24, 0.24, 0.54, 16, [0, -0.9, Math.PI / 2]);
    for (let i = 0; i < 9; i++) { const a = R() * 6.28, d = 0.5 + R() * 1.0, sc = 0.08 + R() * 0.12; m.geo('ashlar', rockG(i % 3), Math.cos(a) * d, sc * 0.2, Math.sin(a) * d, [0, R() * 6, 0], [sc * 1.3, sc, sc]); }
    // Musgo por encima del muro y al pie
    for (const [x, y, z, sx] of [[-1.3, 2.4, -1.45, 0.3], [-0.7, 1.8, -1.45, 0.25], [-1.55, 1.5, -0.7, 0.25], [-1.0, 0.04, -1.1, 0.5], [1.05, 1.4, 0.55, 0.22]]) m.geo('moss', ICO1, x, y, z, [0, x, 0], [sx, 0.06, sx * 0.8]);
  },
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
    m.fire(1, 0.08, 1, 0.9).light(1, 0.6, 1, { color: '#ff9a40', intensity: 4, range: 10, flicker: true });
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
  faro(m) {
    m.cyl('stone', 0, 0, 0, 1.4, 1.3, 0.6, 16);
    for (let i = 0; i < 6; i++) m.cyl(i % 2 ? 'stripeR' : 'white', 0, 0.6 + i * 1.3, 0, 0.95 - i * 0.07, 0.95 - (i + 1) * 0.07, 1.3, 16);
    m.cyl('iron', 0, 8.4, 0, 0.75, 0.75, 0.12, 16).cyl('glass', 0, 8.52, 0, 0.5, 0.5, 0.9, 12).geo('lens', ICO1, 0, 8.97, 0, [0, 0, 0], 0.3).geo('red', CONE, 0, 9.65, 0, [0, 0, 0], [0.62, 0.55, 0.62]);
    m.light(0, 9, 0, { color: '#fff0b0', intensity: 12, range: 30, always: true });
    m.beacon = [0, 8.97, 0];
  },
};

// Cofre del tesoro: cerrado o, ya saqueado, abierto y vacío (por dentro, a oscuras)
function treasure(m, open) {
  m.box('wood', -0.38, 0, -0.26, 0.38, 0.42, 0.26).box('iron', -0.4, 0.05, -0.27, -0.34, 0.45, 0.27).box('iron', 0.34, 0.05, -0.27, 0.4, 0.45, 0.27);
  if (open) { m.B('dark').orientedBox(0, -0.38, 0.8, 0.12, 0.42, 0.95, 0, {}); m.box('dark', -0.31, 0.4, -0.2, 0.31, 0.426, 0.2); }
  else m.box('dark', -0.4, 0.42, -0.28, 0.4, 0.62, 0.28).box('gold', -0.06, 0.3, 0.26, 0.06, 0.46, 0.29);
}

// Tierra labrada de una casilla (seca o mojada)
function tilled(m, wet) {
  m.box(wet ? 'dirtWet' : 'dirt', -0.46, 0, -0.46, 0.46, 0.06, 0.46, 1);
  for (let i = 0; i < 3; i++) m.box(wet ? 'dirtWet' : 'dirt', -0.42, 0.06, -0.36 + i * 0.3, 0.42, 0.1, -0.24 + i * 0.3, 1);
}

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
  const m = new Model(), [kind, a, b] = name.split(':');
  if (BUILD[kind]) BUILD[kind](m, a, b);
  else if (kind === 'crop') crop(m, a, +b);
  else if (kind === 'village') { if (a === 'stall2') VILLAGE.stall(m, ['#e0b850', '#f08a2a', '#e83a4a'], 'awningB'); else if (a === 'stall3') VILLAGE.stall(m, ['#9ad0ff', '#c8a870', '#f0e8f0'], 'awningG'); else VILLAGE[a](m); }
  else if (kind === 'poi') PLACES[a](m, b === 'snow');
  else if (kind === 'treasure') treasure(m, a === '1');
  else if (kind === 'tilled') tilled(m, a === '1');
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
// Material de una pieza de modelo por su clave ('wood', 'books3', 'fruit:#e04a2a', 'leafc:#3f8a32'…)
const DYN = new Map();
export function modelMat(key) {
  const M = modelMats();
  if (M[key]) return M[key];
  if (key.startsWith('books')) return M.books[+key.slice(5)];
  if (!DYN.has(key)) {
    const [k, c] = key.split(':');
    DYN.set(key, k === 'fruit' ? mat({ color: c, roughness: 0.45 }) : k === 'leafc' ? mat({ color: c, flatShading: true, side: THREE.DoubleSide }) : key === 'dry' ? mat({ color: '#8a6a3a' }) : key === 'dirtWet' ? mat({ map: furrows(), color: '#7a6a60', roughness: 0.7 }) : mat({ color: '#ff00ff' }));
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
// El de cada casa (el origen arriba) y el que se coloca (origen en el suelo, colgado del techo, con su luz)
export const CHANDELIER = chandelier(new Model(), 0);
BUILD.candelabro = m => chandelier(m, WALL_H).light(0, WALL_H - 0.6, 0, { color: '#ffd08a', intensity: 4.5, range: 11 });
