// Modelos en 3D de lo que se coloca y de lo que hay en el mundo: estaciones de trabajo (banco, horno, yunque,
// telar, cocina), muebles (cama, mesa, sillas, estanterías, lámparas, cofres, alfombras, macetas, vitrinas),
// cosas del rancho y del huerto (gallinero, establo, colmena, comedero, aspersor, cultivos en cada fase), el
// hogar con chimenea, las cosas del pueblo (puestos, tablón, vitrina del museo, fuente, muelle, buzón, farola
// y cartel), los lugares que se descubren (ruinas, campamento, torre, barco hundido, templo, altar, cueva,
// faro) y los cofres del tesoro.
//
// Cada modelo se hace una vez, en coordenadas locales (el suelo en y = 0, el centro de su casilla en el origen
// y el frente mirando a +z), con sus piezas agrupadas por material para juntarlas luego con las del resto del
// trozo en unas pocas mallas. Lo que no se junta (fuego, cristal, agua) va aparte, igual que sus luces.
import * as THREE from 'three';
import { Builder, mat } from './geo.js';
import { wood, stone, rug, notes, awning, planks, furrows, artwork } from './textures.js';
import { CROPS } from '../items.js';
import { WALL_H } from './build3d.js';

// ---------- materiales ----------
let MATS;
export function modelMats() {
  if (MATS) return MATS;
  const c = (color, o = {}) => mat({ color, ...o });
  MATS = {
    wood: mat({ map: wood('#8a5a34'), roughness: 0.7 }), dark: mat({ map: wood('#5e3b22'), roughness: 0.7 }), light: mat({ map: wood('#b88454'), roughness: 0.7 }),
    plank: mat({ map: planks(), roughness: 0.75 }), stone: mat({ map: stone('#9a948a') }), brick: mat({ map: stone('#b0705a') }), soot: c('#2a2220', { roughness: 1 }),
    sheet: c('#f4efe6', { roughness: 0.95 }), quilt: c('#d0574a', { roughness: 0.95 }), quiltB: c('#f0c25a', { roughness: 0.95 }), cloth: c('#e8e0d0', { roughness: 0.95 }),
    pot: c('#b8643c', { roughness: 0.8 }), soil: c('#4a3020'), leaf: c('#4f9a3a', { flatShading: true }), leafD: c('#3f7a2e', { flatShading: true }),
    rug: mat({ map: rug(), roughness: 1 }), brass: c('#c89a48', { metalness: 0.7, roughness: 0.35 }), iron: c('#3a3634', { metalness: 0.55, roughness: 0.45 }), steel: c('#8a929a', { metalness: 0.7, roughness: 0.3 }),
    gold: c('#f0c840', { metalness: 0.8, roughness: 0.25 }), copper: c('#c8743a', { metalness: 0.6, roughness: 0.4 }),
    candle: c('#fff4dc', { roughness: 0.8 }), shade: c('#f4dca0', { emissive: '#ffb860', emissiveIntensity: 0.6, roughness: 0.9, side: THREE.DoubleSide }),
    books: ['#a83a32', '#3a5aa0', '#3f8a44', '#d8a83a', '#7a4aa0', '#e0e0d0'].map(x => c(x, { roughness: 0.8 })),
    red: c('#c83a32'), white: c('#f0ece4'), straw: c('#e0c060', { roughness: 1 }), hay: c('#d8b860', { roughness: 1 }), rope: c('#c8a870'),
    notes: mat({ map: notes() }), awning: mat({ map: awning(), side: THREE.DoubleSide }), awningB: c('#3a6ab8', { side: THREE.DoubleSide }), awningG: c('#4a9a4a', { side: THREE.DoubleSide }),
    water: new THREE.MeshStandardMaterial({ color: '#4a9ad8', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.8 }),
    glass: new THREE.MeshStandardMaterial({ color: '#cfe8f4', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.3, depthWrite: false }),
    glow: new THREE.MeshBasicMaterial({ color: '#ff9a3a' }), ember: c('#ff6a20', { emissive: '#ff4a10', emissiveIntensity: 1.2 }),
    sand: c('#d8c08a', { roughness: 1 }), moss: c('#5a7a3a', { flatShading: true }), ruin: mat({ map: stone('#b8b0a0'), flatShading: true }), dirt: mat({ map: furrows(), roughness: 1 }),
    canvas: c('#d8c8a0', { side: THREE.DoubleSide, roughness: 1 }), tentStripe: c('#a8442a', { side: THREE.DoubleSide }), lamp: c('#fff2c0', { emissive: '#ffd070', emissiveIntensity: 1.5 }),
    hull: mat({ map: wood('#6a4a30'), roughness: 0.9 }), temple: mat({ map: stone('#c8bca0') }), templeD: mat({ map: stone('#8a8070') }), crystal: c('#7ae0ff', { emissive: '#3ab0ff', emissiveIntensity: 0.8, roughness: 0.1 }),
    snow: c('#f4f8fc', { roughness: 0.85 }), rock: mat({ map: stone('#8a857c'), flatShading: true }), dark0: c('#0a0806', { roughness: 1 }), stripeR: c('#c83a32'), lens: c('#fff6c8', { emissive: '#ffe080', emissiveIntensity: 2 }),
    bee: c('#e8c040'), sofa: c('#3f6a5a', { roughness: 0.95 }), sofaB: c('#5a8a74', { roughness: 0.95 }), leather: c('#8a5a34', { roughness: 0.85 }), leatherD: c('#5e3b22', { roughness: 0.85 }),
    porcelain: c('#f4f2ee', { roughness: 0.22 }), quiltK: c('#5a9ad8', { roughness: 0.95 }), quiltK2: c('#e88aa8', { roughness: 0.95 }), pillowK: c('#f4d86a', { roughness: 0.95 }),
    art_valle: mat({ map: artwork('valle'), roughness: 0.9 }), art_mar: mat({ map: artwork('mar'), roughness: 0.9 }), art_flores: mat({ map: artwork('flores'), roughness: 0.9 }), art_noche: mat({ map: artwork('noche'), roughness: 0.9 }),
    baby: c('#f4e6c8', { roughness: 0.95 }), mirror: c('#d8eef4', { metalness: 0.6, roughness: 0.08 }), plate: c('#f0ece0', { roughness: 0.4 }), plateB: c('#5a7ab8', { roughness: 0.4 }),
  };
  return MATS;
}

// ---------- un modelo en construcción ----------
class Model {
  constructor() { this.parts = new Map(); this.extras = []; this.lights = []; this.fires = []; this.smoke = []; }
  B(key) { let b = this.parts.get(key); if (!b) this.parts.set(key, (b = new Builder())); return b; }
  box(key, x0, y0, z0, x1, y1, z1, s = 0.5) { this.B(key).box(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1), { s }); return this; }
  geo(key, g, x, y, z, rot = [0, 0, 0], scale = [1, 1, 1]) {
    const m4 = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...(typeof scale === 'number' ? [scale, scale, scale] : scale)));
    this.B(key).addGeometry(g, m4); return this;
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
  // Encimera con cajones: la parte de abajo de la alacena, con dos cajones encima de las puertas
  encimera(m) {
    m.box('wood', -0.46, 0, -0.26, 0.46, 0.86, 0.2).box('light', -0.48, 0.86, -0.28, 0.48, 0.92, 0.22);
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
  alfombra(m) { m.B('rug').quad([-0.9, 0.035, 0.6], [0.9, 0.035, 0.6], [0.9, 0.035, -0.6], [-0.9, 0.035, -0.6], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]); },
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
  banco(m) {
    m.box('light', -0.55, 0.78, -0.32, 0.55, 0.86, 0.32);
    for (const [a, b] of [[-0.52, -0.29], [0.46, -0.29], [-0.52, 0.23], [0.46, 0.23]]) m.box('wood', a, 0, b, a + 0.06, 0.78, b + 0.06);
    m.box('wood', -0.5, 0.18, -0.28, 0.5, 0.22, 0.28).box('plank', -0.45, 0.22, -0.2, 0.4, 0.3, 0.15);
    m.box('iron', 0.38, 0.86, 0.12, 0.52, 0.98, 0.3).box('iron', 0.43, 0.98, 0.18, 0.47, 1.06, 0.24);   // tornillo de banco
    m.box('steel', -0.4, 0.865, -0.1, -0.05, 0.875, 0.04).box('dark', -0.48, 0.86, -0.08, -0.38, 0.9, 0.02);   // sierra
    m.box('dark', 0.05, 0.86, -0.2, 0.3, 0.89, -0.17).box('iron', 0.24, 0.86, -0.24, 0.32, 0.92, -0.12);       // martillo
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
  aspersor(m) {
    m.cyl('copper', 0, 0, 0, 0.12, 0.1, 0.06, 10).cyl('copper', 0, 0.06, 0, 0.025, 0.025, 0.3, 6).box('copper', -0.16, 0.34, -0.02, 0.16, 0.38, 0.02).box('copper', -0.02, 0.34, -0.16, 0.02, 0.38, 0.16);
    for (const [x, z] of [[0.16, 0], [-0.16, 0], [0, 0.16], [0, -0.16]]) m.ball('steel', x, 0.36, z, 0.03);
  },
  gallinero(m) {
    m.box('wood', -0.45, 0.25, -0.4, 0.45, 0.95, 0.4).box('dark', -0.48, 0, -0.43, -0.4, 0.95, -0.35).box('dark', 0.4, 0, -0.43, 0.48, 0.95, -0.35).box('dark', -0.48, 0, 0.35, -0.4, 0.95, 0.43).box('dark', 0.4, 0, 0.35, 0.48, 0.95, 0.43);
    roofPrism(m, 'red', -0.55, 0.55, -0.5, 0.5, 0.95, 0.4);
    m.box('soot', -0.12, 0.3, 0.4, 0.12, 0.6, 0.41).box('plank', -0.1, 0, 0.4, 0.1, 0.03, 0.85);   // puerta y rampa
    for (let i = 0; i < 4; i++) m.box('dark', -0.1, 0.03 + 0.0, 0.48 + i * 0.1, 0.1, 0.05, 0.5 + i * 0.1);
    m.box('straw', -0.4, 0.25, -0.35, 0.4, 0.3, 0.35);
  },
  establo(m) {
    m.box('red', -0.48, 0, -0.45, 0.48, 1.1, 0.45, 0.5);
    for (const x of [-0.5, 0.42]) for (const z of [-0.47, 0.39]) m.box('white', x, 0, z, x + 0.08, 1.1, z + 0.08);
    roofPrism(m, 'dark', -0.6, 0.6, -0.55, 0.55, 1.1, 0.5);
    m.box('dark', -0.26, 0, 0.45, 0.26, 0.85, 0.47);
    m.box('white', -0.26, 0.0, 0.47, 0.26, 0.05, 0.49).box('white', -0.26, 0.8, 0.47, 0.26, 0.85, 0.49);
    m.box('white', -0.03, 0.05, 0.47, 0.03, 0.8, 0.49);
    m.box('hay', -0.42, 1.1, -0.3, -0.1, 1.25, 0.1);
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
  const c = CROPS[id], fruitKey = 'fruit:' + c.color, leafKey = 'leafc:' + c.leaf;
  m.geo('soil', ICO1, 0, 0.02, 0, [0, 0, 0], [0.22, 0.06, 0.22]);
  if (stage < 0) { for (let i = 0; i < 4; i++) m.cyl('dry', Math.cos(i * 1.6) * 0.06, 0.02, Math.sin(i * 1.6) * 0.06, 0.01, 0.006, 0.18, 4, [Math.sin(i) * 0.6, 0, Math.cos(i) * 0.6]); return; }
  if (stage === 0) { for (let i = 0; i < 3; i++) m.ball('soil', Math.cos(i * 2.1) * 0.08, 0.06, Math.sin(i * 2.1) * 0.08, 0.03, 0.02, 0.03, 6); return; }
  const leaves = (n, len, rise, spread = 0.6) => { for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; m.geo(leafKey, LEAFG, 0, 0.04, 0, [rise, a, 0], [len * spread, 1, len]); } };
  if (stage === 1) { leaves(3, 0.14, -0.9); return; }
  if (id === 'maiz' || id === 'trigo') {
    const tall = id === 'maiz' ? (stage === 3 ? 1.6 : 0.9) : stage === 3 ? 0.75 : 0.45, n = id === 'maiz' ? 2 : 9;
    for (let i = 0; i < n; i++) {
      const a = i * 2.4, r = id === 'maiz' ? 0.08 : 0.1, x = Math.cos(a) * r * (i ? 1 : 0), z = Math.sin(a) * r * (i ? 1 : 0);
      m.cyl(stage === 3 && id === 'trigo' ? fruitKey : leafKey, x, 0.02, z, 0.02, 0.012, tall, 5);
      if (id === 'maiz') { for (let k = 0; k < 4; k++) m.geo(leafKey, LEAFG, x, 0.3 + k * 0.3 * (tall / 1.6), z, [-0.6, a + k * 1.7, 0], [0.18, 1, 0.42]); if (stage === 3) m.geo(fruitKey, CONE, x + 0.06, tall * 0.6, z, [0, 0, 0.3], [0.05, 0.22, 0.05]); }
      else if (stage === 3) m.ball(fruitKey, x, tall + 0.04, z, 0.025, 0.07, 0.025, 6);
    }
    return;
  }
  if (id === 'tomate') {
    m.cyl('wood', 0.08, 0, 0, 0.012, 0.012, stage === 3 ? 0.9 : 0.6, 4);
    for (let k = 0; k < (stage === 3 ? 5 : 3); k++) m.geo(leafKey, ICO, Math.cos(k * 2.3) * 0.12, 0.2 + k * 0.14, Math.sin(k * 2.3) * 0.12, [k, k, 0], 0.11);
    if (stage === 3) for (let k = 0; k < 6; k++) m.ball(fruitKey, Math.cos(k * 1.9) * 0.15, 0.25 + (k % 3) * 0.18, Math.sin(k * 1.9) * 0.15, 0.06);
    return;
  }
  if (id === 'calabaza') {
    leaves(5, stage === 3 ? 0.3 : 0.22, -1.3, 1);
    if (stage === 3) { m.ball(fruitKey, 0.05, 0.16, 0.05, 0.24, 0.17, 0.22, 12); m.cyl('leafc:' + c.leaf, 0.05, 0.3, 0.05, 0.02, 0.015, 0.08, 5); }
    return;
  }
  if (id === 'fresa') {
    leaves(6, 0.16, -1.2, 1); m.geo(leafKey, ICO, 0, 0.1, 0, [0, 0, 0], [0.16, 0.08, 0.16]);
    if (stage === 3) for (let k = 0; k < 6; k++) m.geo(fruitKey, CONE, Math.cos(k) * 0.16, 0.06, Math.sin(k) * 0.16, [Math.PI, 0, 0], [0.035, 0.06, 0.035]);
    return;
  }
  // Raíces (nabo, zanahoria): hojas y, maduras, asoma la raíz
  leaves(id === 'zanahoria' ? 7 : 5, stage === 3 ? 0.26 : 0.18, -0.5, id === 'zanahoria' ? 0.35 : 0.6);
  if (stage === 3) m.ball(fruitKey, 0, 0.05, 0, 0.08, id === 'nabo' ? 0.07 : 0.05, 0.08, 8);
}
// Una hoja: un rombo doblado, que sale del centro hacia +z
const LEAFG = (() => {
  const g = new THREE.BufferGeometry(), p = [0, 0, 0, 0.5, 0.05, 0.5, 0, 0.1, 1, 0, 0, 0, 0, 0.1, 1, -0.5, 0.05, 0.5];
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.computeVertexNormals();
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(12).fill(0), 2));
  return g;
})();

// ---------- cosas del pueblo ----------
const VILLAGE = {
  // Puesto de 2×1 casillas (el origen en su centro): mostrador, postes, toldo y cajas de fruta
  stall(m, colors = ['#d8352a', '#f0a020', '#7ac040'], awn = 'awning') {
    m.box('wood', -0.9, 0, -0.1, 0.9, 0.9, 0.4).box('dark', -0.95, 0.9, -0.15, 0.95, 0.98, 0.45);
    for (const x of [-0.88, 0.88]) for (const z of [-0.42, 0.42]) m.box('dark', x - 0.05, 0, z - 0.05, x + 0.05, 2.2, z + 0.05);
    const aw = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.3), modelMats()[awn]); aw.position.set(0, 2.15, 0.05); aw.rotation.x = -Math.PI / 2 + 0.38; aw.castShadow = aw.receiveShadow = true; m.extra(aw);
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
  museum(m) { m.box('stone', -0.36, 0, -0.3, 0.36, 0.85, 0.3, 0.6).box('glass', -0.33, 0.85, -0.27, 0.33, 1.35, 0.27).geo('white', CONE, 0, 0.98, 0, [0, 0, 1.2], [0.12, 0.26, 0.12]); },
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
const PLACES = {
  ruinas(m) {
    for (const [x, z, h] of [[-1, -1, 2.2], [1, -1, 1.2], [-1, 1, 0.8], [1.1, 0.9, 1.7]]) { m.cyl('ruin', x, 0, z, 0.24, 0.22, h, 10); m.box('ruin', x - 0.3, h, z - 0.3, x + 0.3, h + 0.15, z + 0.3); }
    m.box('ruin', -1.3, 0, -1.3, 0.3, 1.1, -1.0).box('ruin', -1.3, 0, -1.0, -1.0, 0.7, 0.2);
    for (let i = 0; i < 6; i++) m.geo('ruin', DODECA, Math.cos(i * 1.7) * 1.2, 0.12, Math.sin(i * 1.7) * 1.1, [i, i, 0], [0.2, 0.15, 0.18]);
    m.geo('moss', ICO1, -0.6, 0, 0.4, [0, 0, 0], [0.4, 0.15, 0.3]);
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
  torre(m) {
    m.cyl('ruin', 0, 0, 0, 0.75, 0.62, 4.2, 14).cyl('ruin', 0, 4.2, 0, 0.82, 0.82, 0.35, 14);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; m.box('ruin', Math.cos(a) * 0.68 - 0.12, 4.55, Math.sin(a) * 0.68 - 0.12, Math.cos(a) * 0.68 + 0.12, 4.85, Math.sin(a) * 0.68 + 0.12); }
    m.box('soot', -0.25, 0, 0.6, 0.25, 1.4, 0.72).box('soot', -0.1, 2.6, 0.6, 0.1, 3.0, 0.68);
    m.geo('moss', ICO1, 0.5, 0.1, 0.5, [0, 0, 0], [0.35, 0.3, 0.3]);
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
  templo(m) {
    m.box('templeD', -1.5, 0, -1.5, 1.5, 0.3, 1.5, 0.8).box('templeD', -1.3, 0.3, -1.3, 1.3, 0.55, 1.3, 0.8);
    for (const [x, z] of [[-1.05, -1.05], [1.05, -1.05], [-1.05, 1.05], [1.05, 1.05], [-0.35, 1.05], [0.35, 1.05]]) m.cyl('temple', x, 0.55, z, 0.14, 0.12, 1.8, 10);
    m.box('temple', -1.3, 2.35, -1.3, 1.3, 2.6, 1.3, 0.8);
    roofPrism(m, 'templeD', -1.35, 1.35, -1.35, 1.35, 2.6, 0.7);
    m.box('temple', -0.9, 0.55, -0.9, 0.9, 2.35, -0.6, 0.8).box('dark0', -0.3, 0.55, -0.62, 0.3, 1.6, -0.58);
    m.geo('crystal', ICO, 0, 3.45, 0, [0, 0.5, 0], 0.18).light(0, 3.4, 0, { color: '#7ad8ff', intensity: 2, range: 6, always: true });
  },
  altar(m) {
    m.box('templeD', -1, 0, -0.7, 1, 0.2, 0.7).box('temple', -0.6, 0.2, -0.4, 0.6, 0.95, 0.4).box('templeD', -0.7, 0.95, -0.5, 0.7, 1.05, 0.5);
    m.geo('crystal', ICO, 0, 1.3, 0, [0.3, 0.6, 0], 0.18).light(0, 1.4, 0, { color: '#9ae0ff', intensity: 2.5, range: 7, always: true });
    for (const x of [-1.2, 1.2]) { m.cyl('stone', x, 0, 0, 0.12, 0.1, 1.2, 8); m.fire(x, 1.22, 0, 0.5); }
  },
  cueva(m, snow) {
    // Montículo de roca con una boca oscura que mira hacia +z
    for (const [x, y, z, s] of [[0, 0.6, -0.5, 1.6], [-1.1, 0.3, 0, 0.9], [1.1, 0.35, 0, 1.0], [-0.6, 1.2, -0.3, 0.9], [0.7, 1.1, -0.4, 0.9]]) m.geo('rock', DODECA, x, y, z, [x, y, 0], [s, s * 0.85, s]);
    m.geo('dark0', ICO1, 0, 0.45, 0.62, [0, 0, 0], [0.7, 0.6, 0.25]);
    m.box('rock', -0.7, 0, 0.55, -0.45, 1.0, 0.95).box('rock', 0.45, 0, 0.55, 0.7, 1.0, 0.95).box('rock', -0.75, 0.95, 0.45, 0.75, 1.25, 0.95);
    if (snow) for (const [x, y, z, s] of [[0, 1.75, -0.5, 1.0], [-0.6, 1.85, -0.3, 0.6], [0.7, 1.75, -0.4, 0.6]]) m.geo('snow', ICO1, x, y, z, [0, 0, 0], [s, s * 0.35, s]);
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

// ---------- caché ----------
const CACHE = new Map();
// Modelo de algo, por su nombre: 'banco', 'crop:tomate:3', 'poi:templo', 'village:stall', 'treasure:1', 'tilled:0'…
export function getModel(name) {
  if (CACHE.has(name)) return CACHE.get(name);
  const m = new Model(), [kind, a, b] = name.split(':');
  if (BUILD[kind]) BUILD[kind](m);
  else if (kind === 'crop') crop(m, a, +b);
  else if (kind === 'village') { if (a === 'stall2') VILLAGE.stall(m, ['#e0b850', '#f08a2a', '#e83a4a'], 'awningB'); else if (a === 'stall3') VILLAGE.stall(m, ['#9ad0ff', '#c8a870', '#f0e8f0'], 'awningG'); else VILLAGE[a](m); }
  else if (kind === 'poi') PLACES[a](m, b === 'snow');
  else if (kind === 'treasure') treasure(m, a === '1');
  else if (kind === 'tilled') tilled(m, a === '1');
  else return null;
  CACHE.set(name, m);
  return m;
}
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
