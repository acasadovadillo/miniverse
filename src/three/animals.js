// Animales en 3D: los de la granja (con sus razas o pelajes), el caballo (que también se usa bajo el jinete),
// las mascotas y los salvajes, y cómo se mueven. Miran hacia z+, con las patas apoyadas en y = 0.
//
// Los cuerpos son de una pieza: una esfera deformada (pecho, barriga, grupa, lomo) con el color por vértice,
// así las manchas, la tripa más clara o el lomo más oscuro van pintados en la propia piel. Las patas tienen
// rodilla (se doblan al andar), la cabeza va unida por el cuello y se mueve (pastan, miran), y la cola se agita.
import * as THREE from 'three';
import { mesh, mergeInto, G, M } from './people.js';
import { ARTE, sobrio } from '../arte.js';

// (?arte=2, en revisión: menos de dibujos animados. Pelaje apagado y con variación de tono, ojos pequeños sin punto de
// brillo, patas más finas por debajo de la rodilla y, en los cabezones, la cabeza algo más pequeña)
const A2 = ARTE === 2, SMALL_HEAD = { perro: 0.84, gato: 0.84, cerdo: 0.88, oveja: 0.88, conejo: 0.86, gallina: 0.9, pato: 0.92 };
const tone = c => (A2 && typeof c === 'string' ? sobrio(c) : c);

// Colores de cada raza o pelaje: b, el cuerpo; d, lo oscuro (manchas, crin, patas); l, lo claro (o la cara)
const COATS = {
  gallina: { blanca: ['#f6f2ea', '#e8dcc8'], parda: ['#b8743a', '#7a4422'], negra: ['#2e2a30', '#1a1a22'], dorada: ['#e8b830', '#c88a18'], gallo: ['#c0582a', '#2a4a3a'] },
  pato: { blanco: ['#f6f4ee', '#e8e2d4'], real: ['#b8b4a8', '#2a6a3a', '#8a5a3a'] },
  vaca: { pinta: ['#f4f0e8', '#2a2624'], parda: ['#a8703a', '#6a4422'] },
  oveja: { blanca: ['#f2eee4', '#3a3230'], negra: ['#3a3438', '#1e1a1c'] },
  cabra: { blanca: ['#ece6da', '#a89878'], parda: ['#9a6a3a', '#5a3a22'], negra: ['#2e2a2a', '#5a5048'] },
  cerdo: { rosa: ['#f2aaa6', '#e08a86'], manchado: ['#f2aaa6', '#2a2224'] },
  conejo: { blanco: ['#f4f0ea', '#f0b0b8'], gris: ['#9a9690', '#d8b0b8'], marron: ['#8a6444', '#d8a8a8'] },
  caballo: { castano: ['#8a5a34', '#2a1e16'], negro: ['#2a2624', '#141210'], blanco: ['#ece8e0', '#d8d0c4'], tordo: ['#a8a8a8', '#5a5a5a'], pio: ['#f0ece4', '#8a5a34', '#2a1e16'], palomino: ['#d8a858', '#f4ecd8'] },
  perro: { canela: ['#c88a4a', '#8a5a30'], negro: ['#2a2624', '#c88a4a'], manchado: ['#f0ece4', '#2a2624'], gris: ['#8a8a90', '#5a5a60'] },
  gato: { naranja: ['#e8903a', '#b8602a'], gris: ['#8a8a92', '#5a5a62'], negro: ['#2a2628', '#1a1618'], blanco: ['#f4f2ee', '#e0dcd6'], tricolor: ['#f4f2ee', '#e8903a', '#2a2628'] },
};
export const animalKey = e => `${e.type}:${e.breed || ''}:${e.bags ? 1 : 0}`;
function coatOf(type, breed) { const c = COATS[type]; return c ? c[breed] || Object.values(c)[0] : []; }

// ---------- herramientas ----------
const C = new THREE.Color(), C2 = new THREE.Color(), WHITE = M('#ffffff'), EYE = M('#120e0e', { roughness: 0.12 }), SHINE = M('#ffffff', { roughness: 0.1 });
const mixc = (a, b, k) => C.set(a).lerp(C2.set(b), k);
// Ruido suave en 3D (manchas, rayas, lana)
const hash = (x, y, z) => { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); };
function noise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const s = t => t * t * (3 - 2 * t), u = s(xf), v = s(yf), w = s(zf);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash(xi + dx, yi + dy, zi + dz);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v), L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
// Una forma de una pieza: una esfera de radio 1 que shape(v, n) deforma (n: el punto de la esfera; v: dónde
// queda) y paint(n, v) colorea (devuelve un THREE.Color)
const BLOBS = new Map();
function blob(key, seg, shape, paint) {
  if (key && BLOBS.has(key)) return BLOBS.get(key);
  const g = new THREE.SphereGeometry(1, seg, Math.round(seg * 0.75)), p = g.attributes.position, col = new Float32Array(p.count * 3);
  const n = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    n.fromBufferAttribute(p, i); v.copy(n);
    shape(v, n);
    p.setXYZ(i, v.x, v.y, v.z);
    const c = paint(n, v);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  if (key) BLOBS.set(key, g);
  return g;
}
// Un cuerpo de cuadrúpedo: medio largo L (z), medio ancho W y medio alto H, más estrecho en los extremos,
// con barriga (belly), pecho adelantado (chest) y el lomo algo plano
const Gs = (x, s) => Math.exp(-x * x / (2 * s * s)), sm = (a, b, x) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
const trunk = (o) => (A2 ? trunk2(o) : trunk1(o));
// (?arte=2) Con anatomía: la cruz y la cadera marcadas, el lomo que cae un poco entre ellas, el pecho hondo delante, los
// ijares recogidos hacia atrás y el costillar más ancho que la cintura
const trunk2 = ({ L, W, H, belly = 0.05, chest = 0.04, flat = 0.1, withers = 0.14, hips = 0.09 }) => (v, n) => {
  const t = n.z, up = Math.max(0, n.y), down = Math.max(0, -n.y), taper = 1 - 0.22 * t ** 4;
  v.x = n.x * W * taper * (1 + 0.07 * Gs(t - 0.15, 0.35) - 0.07 * Gs(t + 0.45, 0.16) + 0.04 * Gs(t + 0.75, 0.12));
  v.y = n.y * H * taper * (n.y > 0 ? 1 - flat * n.y : 1);
  v.y += H * up * (withers * Gs(t - 0.5, 0.17) + hips * Gs(t + 0.6, 0.17) - 0.05 * Gs(t + 0.05, 0.25));
  v.y -= H * down * (0.1 * Gs(t - 0.4, 0.22) + belly * 2.2 * Gs(t - 0.05, 0.4)) - H * down * 0.2 * sm(-0.2, -0.85, t);
  v.z = n.z * L + (t > 0.2 ? chest * (t - 0.2) * Math.max(0, 0.5 - n.y * 0.5) : 0);
};
const trunk1 = ({ L, W, H, belly = 0.05, chest = 0.04, flat = 0.1 }) => (v, n) => {
  const t = n.z, taper = 1 - 0.2 * t ** 4;
  v.x = n.x * W * taper;
  v.y = n.y * H * taper * (n.y > 0 ? 1 - flat * n.y : 1) - (n.y < 0 ? belly * (1 - t * t) * -n.y : 0);
  v.z = n.z * L + (t > 0.2 ? chest * (t - 0.2) * Math.max(0, 0.5 - n.y * 0.5) : 0);
};
// El color de una piel: el base, más oscuro en el lomo y más claro en la tripa; spots(n): manchas (0 a 1)
const coat = (base, { back = 0.12, belly = null, spot = null, spots = null } = {}) => n => {
  C.set(tone(base));
  if (belly && n.y < -0.25) C.lerp(C2.set(tone(belly)), Math.min(1, (-n.y - 0.25) * 2.2));
  if (n.y > 0) C.multiplyScalar(1 - back * n.y);
  if (spots && spot) { const k = spots(n); if (k > 0) C.lerp(C2.set(tone(spot)), k); }
  if (A2) C.multiplyScalar(0.9 + noise(n.x * 7 + 3, n.y * 7, n.z * 7) * 0.12 + noise(n.x * 23, n.y * 23 + 5, n.z * 23) * 0.06);   // (el pelo, con su variación)
  return C;
};
// Manchas grandes (vaca, caballo pío, perro manchado): umbral de un ruido
const patches = (freq, seed, thr = 0.58) => n => { const v = noise(n.x * freq + seed, n.y * freq + seed * 2, n.z * freq * 0.8 + seed * 3); return Math.max(0, Math.min(1, (v - thr) * 7)); };
// Rayas (gato atigrado): bandas de ruido a lo largo del cuerpo
const stripes = n => { const v = Math.sin(n.z * 9 + noise(n.x * 3, n.y * 3, n.z * 3) * 3); return n.y > -0.2 && v > 0.55 ? 0.7 : 0; };
// Un tubo que se estrecha entre dos puntos (cuello, cola, cuernos)
const UP = new THREE.Vector3(0, 1, 0);
function tube(m, a, b, r0, r1, parent, seg = 10) {
  const A = new THREE.Vector3(...a), d = new THREE.Vector3(...b).sub(A), len = d.length();
  const o = mesh(new THREE.CylinderGeometry(r1, r0, len, seg), m, { p: A.clone().addScaledVector(d, 0.5).toArray() }, parent);
  o.quaternion.setFromUnitVectors(UP, d.normalize());
  return o;
}
// Ojos brillantes: negros, con un punto de luz
function eyes(parent, x, y, z, r, tilt = 0) {
  if (A2) r *= 0.72;
  for (const s of [-1, 1]) {
    mesh(G.ball, EYE, { p: [s * x, y, z], s: r }, parent);
    if (!A2) mesh(G.ball, SHINE, { p: [s * x + s * r * 0.25 * 0, y + r * 0.45, z + r * 0.6], s: r * 0.32 }, parent);
    if (tilt) mesh(G.ball, M('#000000'), { p: [s * x, y + r * 0.75, z + r * 0.15], s: [r * 1.15, r * 0.35, r * 0.9], r: [0, 0, s * tilt] }, parent);   // párpado
  }
}
// Una pata con rodilla: muslo (de hip hacia abajo) y, en la rodilla, la caña con el casco o la pata
function leg(body, legs, o) {
  if (A2) return leg2(body, legs, o);
  const { x, y, z, up, low, r0, r1, r2, color, foot, footColor, paw = false, phase = 0 } = o;
  const hip = new THREE.Group(); hip.position.set(x, y, z); body.add(hip);
  mesh(new THREE.CylinderGeometry(r1, r0, up + r0 * 0.6, 12).translate(0, -up / 2 + r0 * 0.3, 0), M(color), {}, hip);   // (arranca dentro del cuerpo)
  const knee = new THREE.Group(); knee.position.y = -up; hip.add(knee);
  mesh(G.ball, M(color), { s: [r1, r1 * 0.9, r1] }, knee);   // (la rodilla, lisa: del mismo grueso que la pata)
  mesh(new THREE.CylinderGeometry(r2, r1, low, 10).translate(0, -low / 2, 0), M(color), {}, knee);
  if (paw) mesh(G.ball, M(footColor || color), { p: [0, -low, r2 * 0.6], s: [r2 * 1.35, r2 * 0.8, r2 * 1.7] }, knee);
  else if (foot) mesh(new THREE.CylinderGeometry(r2 * 1.05, r2 * 1.25, foot, 10).translate(0, -low - foot / 2, 0), M(footColor || '#2a2420', { roughness: 0.5 }), {}, knee);
  legs.push({ hip, knee, phase });
  return knee;
}
// (?arte=2) Una pata con su músculo arriba (paletilla o muslo), fina abajo y, en las de atrás (z < 0), con el corvejón hacia
// atrás: el muslo baja hacia atrás y la caña vuelve hacia delante, con el pie debajo de la cadera
function leg2(body, legs, { x, y, z, up, low, r0, r1, r2, color, foot, footColor, paw = false, phase = 0 }) {
  const hind = z < 0, kz = hind ? -up * 0.24 : up * 0.05, fz = hind ? up * 0.24 : -up * 0.03, c = M(color);
  r1 *= paw ? 0.95 : 0.8; r2 *= paw ? 0.9 : 0.7;
  const hip = new THREE.Group(); hip.position.set(x, y, z); body.add(hip);
  if (up >= (paw ? 0.08 : 0.2)) mesh(G.ball, c, paw ? { p: [-Math.sign(x) * r0 * 0.25, up * 0.15, 0], s: [r0 * 0.7, up * 0.5, r0 * (hind ? 1.15 : 0.9)] } : { p: [0, up * 0.08, hind ? -0.01 : 0.01], s: [r0 * (hind ? 0.95 : 0.8), up * 0.62, r0 * (hind ? 1.45 : 1.0)] }, hip);   // (el músculo, metido en el cuerpo)
  tube(c, [0, up * 0.1, 0], [0, -up, kz], r0 * (paw ? 0.85 : 0.7), r1, hip, 10);
  const knee = new THREE.Group(); knee.position.set(0, -up, kz); hip.add(knee);
  mesh(G.ball, c, { s: [r1 * 0.95, r1 * 0.9, r1 * 0.95] }, knee);
  tube(c, [0, 0, 0], [0, -low, fz], r1 * 0.95, r2, knee, 10);
  if (paw) mesh(G.ball, M(footColor || color), { p: [0, -low, fz + r2 * 0.6], s: [r2 * 1.35, r2 * 0.8, r2 * 1.7] }, knee);
  else if (foot) {
    mesh(G.ball, M(footColor || color), { p: [0, -low + foot * 0.2, fz], s: [r2 * 1.2, r2 * 1.1, r2 * 1.2] }, knee);   // (la cuartilla)
    mesh(new THREE.CylinderGeometry(r2 * 1.05, r2 * 1.35, foot, 10).translate(0, -low - foot / 2, fz + r2 * 0.25), M(footColor || '#2a2420', { roughness: 0.5 }), {}, knee);
  }
  legs.push({ hip, knee, phase });
  return knee;
}
// Juntar cada parte (cuerpo, cabeza, cola, patas) en una malla
function finish(root, u) {
  mergeInto(u.body);
  for (const k of ['head', 'tail', 'neck']) if (u[k]) mergeInto(u[k]);
  for (const l of u.legs) { mergeInto(l.hip); mergeInto(l.knee); }
  root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  root.userData = u;
  return root;
}
const TROT = [0, Math.PI, Math.PI, 0];   // patas: delante izquierda y detrás derecha a la vez, y al revés

// ---------- los animales ----------
export function animalModel(type, breed, bags) {
  if (type === 'caballo') return horseModel(breed, bags, true);
  const root = new THREE.Group(), body = new THREE.Group(), legs = [], u = { body, legs, type, seed: Math.random() * 10 };
  root.add(body);
  const [cb, cd, cl] = coatOf(type, breed), k = `${type}:${breed}`;
  const B = BUILD[type];
  if (B) B({ root, body, legs, u, cb, cd, cl, k: (A2 ? 'a2:' : '') + k, breed, bags });
  if (A2 && u.head && SMALL_HEAD[type]) u.head.scale.setScalar(SMALL_HEAD[type]);
  return finish(root, u);
}

const BUILD = {
  vaca({ body, legs, u, cb, cd, k, breed }) {
    const pinta = breed !== 'parda';
    mesh(blob(k + ':b', pinta ? 64 : 40, trunk({ L: 0.62, W: 0.34, H: 0.32, belly: 0.06 }), coat(cb, { back: 0.06, belly: '#f8f4ee', spot: cd, spots: pinta ? patches(2.2, 3.1) : null })), WHITE, { p: [0, 0.82, 0] }, body);
    // La ubre, con sus pezones
    mesh(G.ball, M('#f0b0b0'), { p: [0, 0.5, -0.22], s: [0.13, 0.08, 0.12] }, body);
    for (const [x, z] of [[-0.05, -0.18], [0.05, -0.18], [-0.05, -0.27], [0.05, -0.27]]) mesh(G.cyl, M('#e89a9a'), { p: [x, 0.43, z], s: [0.014, 0.05, 0.014] }, body);
    // Cuello y cabeza
    const head = new THREE.Group(); head.position.set(0, 1.0, 0.66); body.add(head); u.head = head;
    tube(M(cb), [0, 0.86, 0.42], [0, 1.0, 0.66], 0.24, 0.17, body, 14);
    mesh(blob(k + ':h', 28, A2 ? (v, n) => { const f = Math.max(0, n.z); v.set(n.x * 0.14 * (1 - 0.3 * f + 0.15 * f ** 4), n.y * 0.15 * (1 - 0.22 * f) - 0.06 * f * f, n.z * 0.31); } : (v, n) => { v.set(n.x * 0.19 * (1 - 0.15 * Math.max(0, n.z)), n.y * 0.2, n.z * 0.24); }, n => coat(cb, { back: 0.05, spot: cd, spots: pinta ? n2 => (n2.x > 0.3 && n2.y > -0.2 ? 0.9 : 0) : null })(n)), WHITE, { p: [0, 0.02, 0.06] }, head);
    mesh(G.ball, M(A2 ? '#b8908a' : '#f0b8b0'), A2 ? { p: [0, -0.12, 0.29], s: [0.105, 0.075, 0.08] } : { p: [0, -0.1, 0.27], s: [0.15, 0.11, 0.1] }, head);                   // hocico
    for (const s of [-1, 1]) {
      mesh(G.ball, M('#5a2a2a'), { p: [s * 0.05, -0.08, 0.36], s: [0.02, 0.014, 0.01] }, head);         // ollares
      mesh(G.ball, M(cb), { p: [s * 0.2, 0.08, 0.02], s: [0.1, 0.035, 0.055], r: [0, s * 0.3, s * 0.35] }, head);   // orejas
      mesh(G.ball, M('#e8a8a0'), { p: [s * 0.21, 0.075, 0.035], s: [0.07, 0.02, 0.035], r: [0, s * 0.3, s * 0.35] }, head);
      tube(M('#ece2c8'), [s * 0.1, 0.16, 0.0], [s * 0.2, 0.25, 0.04], 0.03, 0.012, head, 8);           // cuernos
    }
    eyes(head, 0.13, 0.06, 0.2, 0.028);
    // La cola, con su borla
    const tail = new THREE.Group(); tail.position.set(0, 0.98, -0.6); body.add(tail); u.tail = tail;
    tube(M(cb), [0, 0, 0], [0, -0.42, -0.05], 0.025, 0.018, tail, 6);
    mesh(G.ball, M(cd), { p: [0, -0.46, -0.05], s: [0.045, 0.08, 0.045] }, tail);
    for (const [i, [x, z]] of [[-0.19, 0.4], [0.19, 0.4], [-0.19, -0.4], [0.19, -0.4]].entries()) leg(body, legs, { x, y: 0.62, z, up: 0.3, low: 0.26, r0: 0.085, r1: 0.06, r2: 0.05, color: i < 2 && pinta ? cb : cb, foot: 0.06, phase: TROT[i] });
  },
  oveja({ body, legs, u, cb, cd, k }) {
    const lumpy = (v, n) => { const r = 1 + (noise(n.x * 4, n.y * 4, n.z * 4) - 0.5) * 0.22; v.set(n.x * 0.34 * r, n.y * 0.3 * r, n.z * 0.42 * r); };
    mesh(blob(k + ':b', 40, lumpy, n => C.set(cb).multiplyScalar(0.9 + noise(n.x * 6, n.y * 6, n.z * 6) * 0.15)), WHITE, { p: [0, 0.64, 0] }, body);
    const head = new THREE.Group(); head.position.set(0, 0.82, 0.46); body.add(head); u.head = head;
    mesh(blob(k + ':h', 24, (v, n) => v.set(n.x * 0.12 * (1 - 0.25 * Math.max(0, n.z)), n.y * 0.14, n.z * 0.19), () => C.set(cd)), WHITE, { p: [0, -0.02, 0.06] }, head);
    mesh(blob(k + ':c', 24, (v, n) => { const r = 1 + (noise(n.x * 5, n.y * 5, n.z * 5) - 0.5) * 0.3; v.set(n.x * 0.14 * r, n.y * 0.08 * r, n.z * 0.12 * r); }, () => C.set(cb)), WHITE, { p: [0, 0.1, 0.0] }, head);
    for (const s of [-1, 1]) mesh(G.ball, M(cd), { p: [s * 0.15, 0.03, 0.0], s: [0.08, 0.03, 0.045], r: [0, 0, s * -0.3] }, head);
    eyes(head, 0.075, 0.03, 0.17, 0.022);
    mesh(G.ball, M('#1a1414'), { p: [0, -0.06, 0.25], s: [0.03, 0.02, 0.015] }, head);
    const tail = new THREE.Group(); tail.position.set(0, 0.7, -0.42); body.add(tail); u.tail = tail;
    mesh(G.ball, M(cb), { p: [0, -0.04, -0.02], s: [0.07, 0.09, 0.06] }, tail);
    [[-0.14, 0.24], [0.14, 0.24], [-0.14, -0.24], [0.14, -0.24]].forEach(([x, z], i) => leg(body, legs, { x, y: 0.42, z, up: 0.21, low: 0.19, r0: 0.05, r1: 0.035, r2: 0.03, color: cd, foot: 0.03, phase: TROT[i] }));
  },
  cabra({ body, legs, u, cb, cd, k, breed }) {
    mesh(blob(k + ':b', 36, trunk({ L: 0.4, W: 0.22, H: 0.22, belly: 0.04 }), coat(cb, { back: 0.15, belly: breed === 'negra' ? '#5a5048' : null })), WHITE, { p: [0, 0.64, 0] }, body);
    const head = new THREE.Group(); head.position.set(0, 0.98, 0.46); body.add(head); u.head = head;
    tube(M(cb), [0, 0.7, 0.3], [0, 0.98, 0.46], 0.13, 0.08, body, 12);
    mesh(blob(k + ':h', 24, (v, n) => v.set(n.x * 0.1 * (1 - 0.3 * Math.max(0, n.z)), n.y * 0.11, n.z * 0.18), () => C.set(cb)), WHITE, { p: [0, 0, 0.08] }, head);
    tube(M(cb), [0, -0.09, 0.14], [0, -0.22, 0.12], 0.035, 0.006, head, 6);                             // barba
    for (const s of [-1, 1]) {
      tube(M('#a89878'), [s * 0.05, 0.1, 0.0], [s * 0.08, 0.2, -0.1], 0.025, 0.008, head, 6);             // cuernos hacia atrás
      mesh(G.ball, M(cb), { p: [s * 0.13, 0.04, 0.0], s: [0.08, 0.025, 0.04], r: [0, 0, s * -0.4] }, head);
    }
    eyes(head, 0.075, 0.04, 0.15, 0.02);
    mesh(G.ball, M('#3a2a2a'), { p: [0, -0.04, 0.26], s: [0.025, 0.018, 0.012] }, head);
    const tail = new THREE.Group(); tail.position.set(0, 0.78, -0.4); body.add(tail); u.tail = tail;
    tube(M(cb), [0, 0, 0], [0, 0.1, -0.05], 0.03, 0.01, tail, 6);
    [[-0.11, 0.27], [0.11, 0.27], [-0.11, -0.27], [0.11, -0.27]].forEach(([x, z], i) => leg(body, legs, { x, y: 0.48, z, up: 0.25, low: 0.2, r0: 0.05, r1: 0.032, r2: 0.028, color: cb, foot: 0.04, footColor: '#4a4038', phase: TROT[i] }));
  },
  cerdo({ body, legs, u, cb, cd, k, breed }) {
    mesh(blob(k + ':b', breed === 'manchado' ? 56 : 36, trunk(A2 ? { L: 0.47, W: 0.24, H: 0.24, belly: 0.06, flat: 0.12, withers: 0.04, hips: 0.06 } : { L: 0.42, W: 0.29, H: 0.27, belly: 0.05, flat: 0.05 }), coat(cb, { back: 0.05, spot: cd, spots: breed === 'manchado' ? patches(2.4, 7.7, 0.6) : null })), WHITE, { p: [0, 0.44, 0] }, body);
    const head = new THREE.Group(); head.position.set(0, 0.5, 0.42); body.add(head); u.head = head;
    mesh(blob(k + ':h', 24, A2 ? (v, n) => { const f = Math.max(0, n.z); v.set(n.x * 0.15 * (1 - 0.35 * f), n.y * 0.15 * (1 - 0.3 * f), n.z * 0.2 * (n.z > 0 ? 1.25 : 1)); } : (v, n) => v.set(n.x * 0.19, n.y * 0.17, n.z * 0.16 * (n.z > 0 ? 1.15 : 1)), () => C.set(cb)), WHITE, { p: [0, 0, 0.04] }, head);
    mesh(G.cyl, M('#e88a86'), { p: [0, -0.03, 0.22], s: [0.075, 0.06, 0.06], r: [Math.PI / 2, 0, 0] }, head);   // el morro
    for (const s of [-1, 1]) {
      mesh(G.ball, M('#8a4a48'), { p: [s * 0.025, -0.03, 0.252], s: [0.013, 0.017, 0.006] }, head);
      mesh(blob('oreja-cerdo', 12, (v, n) => v.set(n.x * 0.07, n.y * 0.09 + (n.y > 0 ? 0.03 * n.y : 0), n.z * 0.02), () => C.set('#ffffff')), M(cb), { p: [s * 0.12, 0.14, 0.04], r: [0.7, 0, s * -0.4] }, head);   // orejas caídas
    }
    eyes(head, 0.08, 0.06, 0.14, 0.018);
    const tail = new THREE.Group(); tail.position.set(0, 0.52, -0.42); body.add(tail); u.tail = tail;
    mesh(new THREE.TorusGeometry(0.03, 0.01, 6, 12, Math.PI * 1.6), M(cb), { p: [0, 0, -0.03], r: [0, Math.PI / 2, 0] }, tail);   // el rabo en tirabuzón
    [[-0.16, 0.22], [0.16, 0.22], [-0.16, -0.22], [0.16, -0.22]].forEach(([x, z], i) => leg(body, legs, { x, y: 0.26, z, up: 0.12, low: 0.1, r0: 0.07, r1: 0.05, r2: 0.045, color: cb, foot: 0.04, footColor: '#6a4a48', phase: TROT[i] }));
  },
  jabali({ body, legs, u, k }) {
    const fur = '#4a3a2e', dark = '#2e241c';
    mesh(blob(k + ':b', 36, (v, n) => { trunk({ L: 0.48, W: 0.27, H: 0.3, belly: 0.03, flat: 0 })(v, n); if (n.z > 0) v.y += 0.06 * n.z * Math.max(0, n.y); }, n => C.set(fur).multiplyScalar(0.85 + noise(n.x * 9, n.y * 9, n.z * 9) * 0.3)), WHITE, { p: [0, 0.48, 0] }, body);
    for (let i = 0; i < 7; i++) mesh(G.cone, M(dark), { p: [0, 0.8 - i * 0.015, 0.25 - i * 0.09], s: [0.035, 0.1, 0.05], r: [-0.3, 0, 0] }, body);   // crin del lomo
    const head = new THREE.Group(); head.position.set(0, 0.5, 0.46); body.add(head); u.head = head;
    mesh(blob(k + ':h', 24, (v, n) => v.set(n.x * 0.16 * (1 - 0.45 * Math.max(0, n.z)), n.y * 0.16 * (1 - 0.35 * Math.max(0, n.z)), n.z * 0.28), n => C.set(fur).multiplyScalar(0.9 + noise(n.x * 8, n.y * 8, n.z * 8) * 0.2)), WHITE, { p: [0, -0.02, 0.1] }, head);
    mesh(G.cyl, M(dark), { p: [0, -0.04, 0.37], s: [0.055, 0.04, 0.05], r: [Math.PI / 2, 0, 0] }, head);
    for (const s of [-1, 1]) { tube(M('#f0ead8'), [s * 0.06, -0.06, 0.3], [s * 0.1, 0.02, 0.36], 0.014, 0.004, head, 6); mesh(G.cone, M(dark), { p: [s * 0.1, 0.15, -0.02], s: [0.045, 0.09, 0.03], r: [0, 0, s * -0.2] }, head); }
    eyes(head, 0.085, 0.06, 0.13, 0.016);
    const tail = new THREE.Group(); tail.position.set(0, 0.56, -0.48); body.add(tail); u.tail = tail;
    tube(M(dark), [0, 0, 0], [0, -0.16, -0.03], 0.015, 0.008, tail, 6);
    [[-0.15, 0.27], [0.15, 0.27], [-0.15, -0.27], [0.15, -0.27]].forEach(([x, z], i) => leg(body, legs, { x, y: 0.3, z, up: 0.15, low: 0.12, r0: 0.065, r1: 0.045, r2: 0.035, color: dark, foot: 0.04, phase: TROT[i] }));
  },
  ciervo({ body, legs, u, k }) {
    const fur = '#9a6a3a';
    mesh(blob(k + ':b', 36, trunk({ L: 0.48, W: 0.24, H: 0.26, belly: 0.03 }), coat(fur, { back: 0.18, belly: '#e8dcc0' })), WHITE, { p: [0, 0.98, 0] }, body);
    mesh(G.ball, M('#f4ecdc'), { p: [0, 1.0, -0.47], s: [0.12, 0.14, 0.06] }, body);   // el culo blanco
    const head = new THREE.Group(); head.position.set(0, 1.45, 0.62); body.add(head); u.head = head;
    tube(M(fur), [0, 1.05, 0.38], [0, 1.45, 0.62], 0.14, 0.08, body, 12);
    mesh(blob(k + ':h', 24, (v, n) => v.set(n.x * 0.1 * (1 - 0.35 * Math.max(0, n.z)), n.y * 0.11 * (1 - 0.2 * Math.max(0, n.z)), n.z * 0.2), n => coat(fur, { back: 0.1 })(n)), WHITE, { p: [0, 0, 0.08] }, head);
    mesh(G.ball, M('#1a1414'), { p: [0, -0.03, 0.28], s: [0.03, 0.025, 0.02] }, head);
    for (const s of [-1, 1]) {
      mesh(G.ball, M(fur), { p: [s * 0.13, 0.08, -0.02], s: [0.08, 0.03, 0.045], r: [0, 0, s * 0.4] }, head);
      tube(M('#d8c8a0'), [s * 0.04, 0.1, -0.02], [s * 0.14, 0.42, -0.1], 0.02, 0.012, head, 6);       // cuernas, con sus puntas
      tube(M('#d8c8a0'), [s * 0.09, 0.26, -0.06], [s * 0.2, 0.36, 0.04], 0.012, 0.005, head, 5);
      tube(M('#d8c8a0'), [s * 0.12, 0.36, -0.08], [s * 0.06, 0.48, -0.02], 0.01, 0.004, head, 5);
    }
    eyes(head, 0.08, 0.05, 0.14, 0.02);
    const tail = new THREE.Group(); tail.position.set(0, 1.12, -0.48); body.add(tail); u.tail = tail;
    mesh(G.ball, M('#f4ecdc'), { p: [0, -0.05, -0.02], s: [0.04, 0.08, 0.03] }, tail);
    [[-0.13, 0.33], [0.13, 0.33], [-0.13, -0.33], [0.13, -0.33]].forEach(([x, z], i) => leg(body, legs, { x, y: 0.8, z, up: 0.42, low: 0.34, r0: 0.07, r1: 0.035, r2: 0.028, color: fur, foot: 0.04, phase: TROT[i] }));
  },
  perro: (o) => pet(o, true),
  gato: (o) => pet(o, false),
  conejo({ body, legs, u, cb, cd, k }) {
    // (?arte=2: un huevo con la grupa ancha y alta, y las orejas largas y finas)
    mesh(blob(k + ':b', 28, A2 ? (v, n) => { const r = Math.max(0, -n.z); v.set(n.x * 0.115 * (1 + 0.18 * r), n.y * 0.12 * (1 + 0.15 * r) + 0.03 * r * Math.max(0, n.y), n.z * 0.19); } : (v, n) => v.set(n.x * 0.13, n.y * 0.13 + (n.z < 0 ? 0.02 * -n.z : 0), n.z * 0.17), coat(cb, { back: 0.08, belly: '#ffffff' })), WHITE, { p: [0, 0.17, -0.02] }, body);
    const head = new THREE.Group(); head.position.set(0, 0.3, 0.13); body.add(head); u.head = head;
    mesh(blob(k + ':h', 24, (v, n) => v.set(n.x * 0.085, n.y * 0.08, n.z * 0.09 * (n.z > 0 ? 1.1 : 1)), () => C.set(cb)), WHITE, {}, head);
    for (const s of [-1, 1]) {
      const ey = A2 ? 0.17 : 0.15, eh = A2 ? 1.15 : 1, ew = A2 ? 0.8 : 1;
      mesh(G.ball, M(cb), { p: [s * 0.035, ey, -0.02], s: [0.026 * ew, 0.11 * eh, 0.035], r: [-0.25, 0, s * 0.18] }, head);
      mesh(G.ball, M(A2 ? mixc(cd, cb, 0.4).getStyle() : cd), { p: [s * 0.035, ey, -0.002], s: [0.014 * ew, 0.085 * eh, 0.02], r: [-0.25, 0, s * 0.18] }, head);
      mesh(G.ball, M('#ffffff'), { p: [s * 0.03, -0.035, 0.075], s: [0.03, 0.025, 0.025] }, head);   // mofletes
    }
    eyes(head, 0.05, 0.02, 0.06, 0.016);
    mesh(G.ball, M('#d88a92'), { p: [0, -0.015, 0.092], s: 0.013 }, head);
    const tail = new THREE.Group(); tail.position.set(0, 0.2, -0.19); body.add(tail); u.tail = tail;
    mesh(G.ball, M('#ffffff'), { s: 0.045 }, tail);
    for (const s of [-1, 1]) mesh(G.ball, M(cb), A2 ? { p: [s * 0.085, 0.08, -0.08], s: [0.05, 0.075, 0.11] } : { p: [s * 0.08, 0.07, -0.07], s: [0.045, 0.06, 0.1] }, body);   // las patas de atrás, recogidas
    [[-0.05, 0.08], [0.05, 0.08]].forEach(([x, z], i) => leg(body, legs, { x, y: 0.09, z, up: 0.05, low: 0.04, r0: 0.025, r1: 0.02, r2: 0.018, color: cb, paw: true, phase: i ? 0 : 0 }));
  },
  gallina: o => bird(o, false),
  pato: o => bird(o, true),
  cisne({ body, u, k }) {
    mesh(blob(k + ':b', 28, (v, n) => v.set(n.x * 0.22, n.y * 0.13 * (n.y > 0 ? 1.2 : 1), n.z * 0.34 + (n.z < 0 && n.y > 0 ? -0.08 * n.y : 0)), () => C.set('#f8f6f2')), WHITE, { p: [0, 0.1, 0] }, body);
    for (const s of [-1, 1]) mesh(blob('ala-cisne', 16, (v, n) => v.set(n.x * 0.07, n.y * 0.1, n.z * 0.27), () => C.set('#f2f0ea')), WHITE, { p: [s * 0.15, 0.2, -0.05], r: [0.2, 0, s * 0.3] }, body);
    const neck = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.16, 0.24), new THREE.Vector3(0, 0.42, 0.3), new THREE.Vector3(0, 0.62, 0.2), new THREE.Vector3(0, 0.68, 0.3)]);
    body.add(new THREE.Mesh(new THREE.TubeGeometry(neck, 16, 0.042, 8), M('#f8f6f2')));
    const head = new THREE.Group(); head.position.set(0, 0.68, 0.32); body.add(head); u.head = head;
    mesh(G.ball, M('#f8f6f2'), { s: [0.055, 0.055, 0.075] }, head);
    mesh(G.cone, M('#f07a20'), { p: [0, -0.015, 0.11], s: [0.025, 0.1, 0.022], r: [Math.PI / 2 + 0.25, 0, 0] }, head);
    mesh(G.ball, M('#1a1a1a'), { p: [0, 0, 0.06], s: [0.03, 0.03, 0.025] }, head);
    eyes(head, 0.04, 0.012, 0.035, 0.011);
  },
};

// Perro (más grande, orejas caídas, hocico) o gato (más pequeño, orejas de punta, cola larga, bigotes)
function pet({ body, legs, u, cb, cd, cl, k, breed }, dog) {
  const L = dog ? 1 : 0.78, spots = breed === 'manchado' ? patches(2.6, 4.4, 0.55) : breed === 'tricolor' ? n => Math.max(patches(2.4, 1.3, 0.6)(n) * 1, 0) : (!dog && (breed === 'naranja' || breed === 'gris')) ? stripes : null;
  const third = breed === 'tricolor' ? cl : cd;
  // (?arte=2) Más de verdad: patas más largas (todo lo de encima sube dy), el cuerpo más estrecho y con cruz y cadera, el
  // cráneo más pequeño y, en el perro, el hocico más largo
  const lh = A2 ? (dog ? 1.45 : 1.25) : 1, dy = (lh - 1) * 0.21 * L;
  const paint = n => { const c = coat(cb, { back: 0.12, belly: dog && breed === 'negro' ? cd : '#f4f0e8', spot: third, spots })(n); if (breed === 'tricolor' && patches(2.2, 8.8, 0.62)(n) > 0.5) c.set(cd); return c; };
  mesh(blob(k + ':b', spots ? 56 : 32, trunk(A2 ? { L: 0.26 * L, W: (dog ? 0.1 : 0.095) * L, H: (dog ? 0.12 : 0.105) * L, belly: 0, chest: dog ? 0.05 : 0.02, withers: dog ? 0.08 : 0.03, hips: dog ? 0.04 : 0.1 } : { L: 0.24 * L, W: 0.13 * L, H: 0.13 * L, belly: 0.02 * L, chest: dog ? 0.03 : 0.01 }), paint), WHITE, { p: [0, 0.32 * L + dy, 0] }, body);
  const hy = (A2 ? 0.5 : 0.47) * L + dy, hz = (A2 && dog ? 0.3 : 0.27) * L;
  const head = new THREE.Group(); head.position.set(0, hy, hz); body.add(head); u.head = head;
  tube(M(cb), [0, 0.34 * L + dy, 0.16 * L], [0, hy, hz], (A2 ? 0.075 : 0.09) * L, (A2 ? 0.055 : 0.07) * L, body, 10);
  mesh(blob(k + ':h', 24, A2 ? (v, n) => v.set(n.x * (dog ? 0.095 : 0.09) * L, n.y * (dog ? 0.09 : 0.08) * L, n.z * (dog ? 0.105 : 0.088) * L) : (v, n) => v.set(n.x * 0.12 * L, n.y * 0.115 * L, n.z * 0.115 * L), n => coat(cb, { back: 0.08, spot: third, spots: breed === 'manchado' ? (m => (m.x > 0.4 ? 0.9 : 0)) : null })(n)), WHITE, {}, head);
  const muzzle = M(dog ? (breed === 'negro' ? cd : A2 ? mixc(cb, '#000000', 0.12).getStyle() : mixc(cb, '#ffffff', 0.35).getStyle()) : A2 ? mixc(cb, '#ffffff', 0.45).getStyle() : '#f8f0ec');
  if (A2 && dog) {   // el hocico largo, que se estrecha hacia la nariz, con la boca debajo
    mesh(blob('a2:hocico-perro', 16, (v, n) => { const f = Math.max(0, n.z); v.set(n.x * 0.05 * (1 - 0.25 * f) * L, n.y * 0.045 * (1 - 0.2 * f) * L, n.z * 0.1 * L); }, () => C.set('#ffffff')), muzzle, { p: [0, -0.03 * L, 0.1 * L] }, head);
    mesh(G.ball, M('#1a1010', { roughness: 0.25 }), { p: [0, -0.012 * L, 0.2 * L], s: [0.022 * L, 0.017 * L, 0.015 * L] }, head);
  } else {
    mesh(blob(dog ? 'hocico-perro' : A2 ? 'a2:hocico-gato' : 'hocico-gato', 16, (v, n) => v.set(n.x * (dog ? 0.065 : A2 ? 0.042 : 0.05) * L, n.y * (dog ? 0.05 : A2 ? 0.03 : 0.035) * L, n.z * (dog ? 0.08 : A2 ? 0.045 : 0.04) * L), () => C.set('#ffffff')), muzzle, { p: [0, -0.035 * L, (A2 ? 0.075 : 0.1) * L] }, head);
    mesh(G.ball, M(A2 && !dog ? '#c88a8a' : '#1a1010', { roughness: 0.25 }), { p: [0, -0.012 * L, (dog ? 0.175 : A2 ? 0.115 : 0.14) * L], s: [(A2 ? 0.016 : 0.024) * L, (A2 ? 0.012 : 0.018) * L, 0.016 * L] }, head);   // la nariz
  }
  if (A2) eyes(head, (dog ? 0.045 : 0.045) * L, 0.025 * L, (dog ? 0.085 : 0.08) * L, (dog ? 0.02 : 0.024) * L);
  else eyes(head, 0.055 * L, 0.03 * L, 0.095 * L, 0.02 * L);
  for (const s of [-1, 1]) {
    if (dog) mesh(blob(A2 ? 'a2:oreja-perro' : 'oreja-perro', 12, A2 ? (v, n) => v.set(n.x * 0.018, n.y * 0.07, n.z * 0.045) : (v, n) => v.set(n.x * 0.03, n.y * 0.08, n.z * 0.05), () => C.set('#ffffff')), M(breed === 'manchado' ? cd : mixc(cb, '#000000', 0.25).getStyle()), A2 ? { p: [s * 0.088, 0.02, -0.02], r: [0, 0, s * 0.22] } : { p: [s * 0.11, 0.0, -0.01], r: [0, 0, s * 0.3] }, head);
    else {
      const ex = A2 ? 0.055 : 0.06, ey = A2 ? 0.085 : 0.1;
      mesh(G.cone, M(cb), { p: [s * ex, ey, -0.005], s: [0.04, 0.07, 0.025], r: [0, 0, -s * 0.3] }, head);
      mesh(G.cone, M(A2 ? '#c89890' : '#f0a8b0'), { p: [s * ex, ey - 0.005, 0.008], s: [0.024, 0.045, 0.01], r: [0, 0, -s * 0.3] }, head);
      for (const d of [-0.01, 0.006]) tube(M('#f4f0ea'), [s * 0.035, -0.04 + d, A2 ? 0.1 : 0.13], [s * 0.12, -0.03 + d * 2, A2 ? 0.09 : 0.12], 0.0025, 0.0015, head, 4);   // bigotes
    }
  }
  const tail = new THREE.Group(); tail.position.set(0, 0.38 * L + dy, -0.24 * L); body.add(tail); u.tail = tail;
  if (dog) tube(M(breed === 'manchado' ? cb : cd), [0, 0, 0], [0, 0.14, -0.1], 0.025, 0.012, tail, 6);
  else { const c = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.08, -0.12), new THREE.Vector3(0, 0.22, -0.16), new THREE.Vector3(0, 0.3, -0.1)]); tail.add(new THREE.Mesh(new THREE.TubeGeometry(c, 12, 0.018, 6), M(cb))); }
  [[-0.07, 0.16], [0.07, 0.16], [-0.07, -0.16], [0.07, -0.16]].forEach(([x, z], i) => leg(body, legs, { x: x * L, y: 0.22 * L + dy, z: z * L, up: 0.11 * L * lh, low: 0.1 * L * lh, r0: 0.04 * L, r1: 0.028 * L, r2: 0.025 * L, color: breed === 'negro' && dog ? cd : cb, paw: true, footColor: breed === 'negro' && dog ? cd : (breed === 'manchado' || breed === 'tricolor' ? '#f4f0e8' : cb), phase: TROT[i] }));
}

// Gallina (o gallo) y pato: cuerpo de gota, alas, cola, cabeza con cresta o pico plano, patas finas con dedos
function bird({ body, legs, u, cb, cd, cl, k, breed }, duck) {
  const rooster = breed === 'gallo', real = breed === 'real', col = cb;
  mesh(blob(k + ':b', 28, (v, n) => { const r = n.z < 0 ? 1 : 1 - 0.25 * n.z; v.set(n.x * (duck ? 0.17 : 0.16) * r, n.y * (duck ? 0.12 : 0.15) * (n.y < 0 ? 1.05 : 1), n.z * (duck ? 0.26 : 0.2) + (n.z < 0 ? 0.03 * Math.max(0, n.y) * -n.z : 0)); }, n => { C.set(col); if (real && n.z > 0.2) C.lerp(C2.set(cl), Math.min(1, (n.z - 0.2) * 2)); if (n.y > 0) C.multiplyScalar(1 - 0.08 * n.y); return C; }), WHITE, { p: [0, duck ? 0.24 : 0.32, 0] }, body);
  // Alas
  for (const s of [-1, 1]) mesh(blob(k + ':ala', 14, (v, n) => v.set(n.x * 0.04, n.y * 0.09, n.z * 0.15 + (n.z < 0 ? -0.03 : 0)), n => C.set(cd || col).lerp(C2.set(col), 0.4 + n.y * 0.3)), WHITE, { p: [s * (duck ? 0.155 : 0.145), duck ? 0.27 : 0.34, -0.03], r: [0.15, 0, s * 0.12] }, body);
  // Cola: abanico de plumas (el gallo, largas y curvas)
  const tail = new THREE.Group(); tail.position.set(0, duck ? 0.3 : 0.4, duck ? -0.24 : -0.17); body.add(tail); u.tail = tail;
  const n = rooster ? 5 : duck ? 2 : 4;
  for (let i = 0; i < n; i++) {
    const a = (i / Math.max(1, n - 1) - 0.5) * (duck ? 0.6 : 0.9), len = rooster ? 0.3 - Math.abs(a) * 0.1 : duck ? 0.08 : 0.13;
    if (rooster) { const c = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.sin(a) * 0.05, len * 0.7, -len * 0.3), new THREE.Vector3(Math.sin(a) * 0.08, len * 0.6, -len * 0.9)]); tail.add(new THREE.Mesh(new THREE.TubeGeometry(c, 10, 0.018, 5), M(i % 2 ? cd : '#1a3a2a'))); }
    else mesh(G.ball, M(i % 2 ? (cd || col) : col), { p: [Math.sin(a) * 0.05, len * 0.6, -len * 0.4], s: [0.02, len * 0.6, 0.05], r: [-0.7, 0, a] }, tail);
  }
  // Cabeza (con el cuello del pato)
  const head = new THREE.Group(); head.position.set(0, duck ? 0.5 : 0.53, duck ? 0.2 : 0.13); body.add(head); u.head = head;
  const hc = duck && real ? cd : col;
  if (duck) tube(M(hc), [0, -0.2, -0.02], [0, -0.03, 0], 0.06, 0.05, head, 10);
  mesh(G.ball, M(hc), { s: duck ? [0.075, 0.075, 0.09] : [0.085, 0.09, 0.085] }, head);
  if (duck) {
    mesh(blob('pico-pato', 14, (v, n) => v.set(n.x * 0.045, n.y * 0.016, n.z * 0.075), () => C.set('#ffffff')), M('#f09a20'), { p: [0, -0.02, 0.1] }, head);
    if (real) mesh(G.cyl, M('#f4f0e8'), { p: [0, -0.1, -0.01], s: [0.058, 0.018, 0.058] }, head);
  } else {
    mesh(G.cone, M('#f0b030'), { p: [0, -0.01, 0.1], s: [0.028, 0.06, 0.028], r: [Math.PI / 2 + 0.2, 0, 0] }, head);
    for (let i = 0; i < 3; i++) mesh(G.ball, M('#d8352a'), { p: [0, 0.09 + (i === 1 ? 0.02 : 0), -0.03 + i * 0.035], s: rooster ? [0.022, 0.045, 0.025] : [0.016, 0.03, 0.018] }, head);   // cresta
    mesh(G.ball, M('#d8352a'), { p: [0, -0.07, 0.07], s: [0.018, rooster ? 0.045 : 0.03, 0.015] }, head);                                                      // barbilla
  }
  eyes(head, duck ? 0.055 : 0.06, 0.02, duck ? 0.03 : 0.04, 0.013);
  // Patas finas, con dedos (el pato, con la pata palmeada)
  const feet = M(duck ? '#f09a20' : '#e8a020');
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(s * 0.06, duck ? 0.14 : 0.2, 0.01); body.add(hip);
    mesh(G.cyl, feet, { p: [0, -(duck ? 0.07 : 0.1), 0], s: [0.016, duck ? 0.14 : 0.2, 0.016] }, hip);
    const knee = new THREE.Group(); knee.position.y = -(duck ? 0.14 : 0.2); hip.add(knee);
    if (duck) mesh(blob('pie-pato', 10, (v, n) => v.set(n.x * 0.04, n.y * 0.008, n.z * 0.05), () => C.set('#ffffff')), feet, { p: [0, 0.004, 0.03] }, knee);
    else for (const a of [-0.5, 0, 0.5]) tube(feet, [0, 0, 0], [Math.sin(a) * 0.05, -0.004, Math.cos(a) * 0.05], 0.009, 0.006, knee, 4);
    legs.push({ hip, knee, phase: s < 0 ? 0 : Math.PI, bird: true });
  }
}

// ---------- cómo se mueven ----------
const SIT_LEAN = { perro: -0.62, gato: -0.7 };
export function animateAnimal(m, dt, t, e) {
  const u = m.root.userData;
  if (u.horse) { animateHorse(m.root, m.speed, t, e); return; }
  const { body, legs, type, head, tail } = u, k = Math.min(1, m.speed / 0.8);
  // Sentado (el perro y el gato): la grupa en el suelo, el cuerpo inclinado hacia arriba, las patas de atrás
  // dobladas y las de delante rectas; la cabeza derecha, mirando alrededor, y la cola barriendo el suelo
  if (e?.sit && legs.length === 4) {
    const lean = SIT_LEAN[type] ?? -0.6;
    body.rotation.set(lean, 0, 0); body.position.y = 0; body.scale.set(1, 1, 1);
    for (const l of legs) { const hind = l.hip.position.z < 0; l.hip.rotation.x = hind ? -1.0 : -lean; l.knee.rotation.x = hind ? 1.9 : 0; }
    if (head) { head.rotation.x = -lean * 0.85; head.rotation.y = Math.sin(t * 0.6 + u.seed * 2) * 0.35; }
    if (tail) tail.rotation.set(type === 'perro' ? -0.2 : -1.1, 0, Math.sin(t * (type === 'perro' ? 9 : 1.5) + u.seed) * (type === 'perro' ? 0.5 : 0.25));
    return;
  }
  m.phase += dt * (3 + m.speed * 6);
  for (const l of legs) {
    const s = Math.sin(m.phase + l.phase);
    l.hip.rotation.x = s * (l.bird ? 0.5 : 0.55) * k;
    l.knee.rotation.x = l.bird ? 0 : Math.max(0, Math.sin(m.phase + l.phase + 1.2)) * 0.8 * k;   // la rodilla se dobla al levantar la pata
  }
  body.position.y = Math.abs(Math.sin(m.phase)) * (type === 'conejo' ? 0.1 : 0.025) * k;
  body.rotation.z = type === 'pato' ? Math.sin(m.phase) * 0.12 * k : 0;   // el pato se bambolea
  body.scale.set(1, e?.sleep ? 0.62 : 1, 1);   // durmiendo, hecho una bola
  if (tail) tail.rotation.set(type === 'perro' ? -0.3 : 0, 0, Math.sin(t * (type === 'perro' ? 12 : 2.2) + u.seed) * (type === 'perro' ? 0.5 : type === 'vaca' || type === 'ciervo' ? 0.35 : 0.15));
  if (e?.sleep) { body.position.y = 0; body.rotation.x = 0; if (head) head.rotation.x = 0.3; return; }
  // Los que pastan bajan la cabeza de vez en cuando, parados; los demás miran a un lado y a otro
  if (head) {
    const graze = (type === 'vaca' || type === 'oveja' || type === 'cabra' || type === 'ciervo') && k < 0.1 && Math.sin(t * 0.35 + u.seed) > 0.2;
    head.rotation.x += ((graze ? 0.75 : 0) - head.rotation.x) * Math.min(1, dt * 3);
    head.rotation.y = Math.sin(t * 0.6 + u.seed * 2) * 0.25 * (1 - k);
  }
  if (type === 'gallina' || type === 'pato') body.rotation.x = k ? Math.sin(m.phase * 2) * 0.08 : Math.max(0, Math.sin(t * 1.3 + m.phase) - 0.7) * 1.2;   // picotea
  else if (type === 'cerdo' && e?.digging) body.rotation.x = 0.25 + Math.sin(t * 9) * 0.06;   // hoza
  else body.rotation.x = Math.sin(t * 0.8 + m.phase) * 0.01;
  body.scale.x = body.scale.z = 1 + Math.sin(t * 2 + u.seed) * 0.01 * (1 - k);   // respira
}

// ---------- el caballo ----------
// También el del jinete: con su pelaje, la silla con su manta y los estribos y, si las tiene, las alforjas
export function horseModel(breed = 'castano', bags = false, alone = false) {
  const root = new THREE.Group(), body = new THREE.Group(), legs = [], u = { body, legs, type: 'caballo', horse: alone, seed: Math.random() * 10 };
  root.add(body);
  const [cb, cd, cl] = coatOf('caballo', breed), k = `caballo:${breed}`, mane = M(cl || cd), pio = breed === 'pio';
  mesh(blob(k + ':b', pio || breed === 'tordo' ? 64 : 40, trunk({ L: 0.56, W: 0.26, H: 0.29, belly: 0.03, chest: 0.06 }), coat(cb, { back: 0.12, spot: cd, spots: pio ? patches(2, 5.5, 0.55) : breed === 'tordo' ? (n => noise(n.x * 9, n.y * 9, n.z * 9) > 0.62 ? 0.45 : 0) : null })), WHITE, { p: [0, 0.88, 0] }, body);
  // Cuello y cabeza, con la crin
  tube(M(cb), [0, 0.9, 0.34], [0, 1.36, 0.72], 0.16, 0.1, body, 14);
  for (let i = 0; i < 6; i++) mesh(G.ball, mane, { p: [0, 1.06 + i * 0.065, 0.4 + i * 0.055], s: [0.045, 0.08, 0.07], r: [0.6, 0, 0] }, body);
  const head = new THREE.Group(); head.position.set(0, 1.38, 0.76); body.add(head); u.head = head;
  mesh(blob(k + ':h', 24, (v, n) => v.set(n.x * 0.1 * (1 - 0.2 * Math.max(0, n.z)), n.y * 0.11 * (1 - 0.15 * Math.max(0, n.z)), n.z * 0.24), n => coat(cb, { back: 0.06 })(n)), WHITE, { p: [0, -0.04, 0.12], r: [0.55, 0, 0] }, head);
  mesh(G.ball, M(cl && breed === 'palomino' ? cb : breed === 'blanco' ? '#d8cfc4' : mixc(cb, '#000000', 0.25).getStyle()), { p: [0, -0.18, 0.28], s: [0.085, 0.07, 0.08] }, head);   // el morro
  if (breed === 'blanco' || breed === 'tordo' || breed === 'palomino' || pio) mesh(G.ball, M('#f8f4ee'), { p: [0, 0.04, 0.17], s: [0.035, 0.07, 0.02], r: [0.5, 0, 0] }, head);   // lucero
  for (const s of [-1, 1]) {
    mesh(G.cone, M(cb), { p: [s * 0.05, 0.13, -0.02], s: [0.03, 0.09, 0.025], r: [-0.2, 0, -s * 0.15] }, head);
    mesh(G.ball, M('#2a1a14'), { p: [s * 0.035, -0.19, 0.35], s: [0.015, 0.012, 0.008] }, head);   // ollares
  }
  mesh(G.ball, mane, { p: [0, 0.1, 0.06], s: [0.04, 0.05, 0.06] }, head);   // el flequillo
  eyes(head, 0.085, 0.02, 0.1, 0.022);
  // Silla: manta, asiento con borrén, estribos; alforjas a los lados
  const saddle = M('#6a2a1e'), blanket = M('#3a5a8a'), steel = M('#b8c0c8', { metalness: 0.6, roughness: 0.35 });
  mesh(G.cyl, blanket, { p: [0, 1.13, -0.02], s: [0.3, 0.025, 0.34] }, body);
  mesh(blob('silla', 20, (v, n) => v.set(n.x * 0.2, n.y * 0.05 + (Math.abs(n.z) > 0.6 && n.y > 0 ? 0.04 * (Math.abs(n.z) - 0.6) * 4 : 0), n.z * 0.24), () => C.set('#ffffff')), saddle, { p: [0, 1.16, -0.02] }, body);
  for (const s of [-1, 1]) { tube(M('#4a2a1a'), [s * 0.2, 1.15, 0.02], [s * 0.26, 0.86, 0.04], 0.008, 0.008, body, 4); mesh(new THREE.TorusGeometry(0.035, 0.008, 4, 10), steel, { p: [s * 0.26, 0.84, 0.04], r: [0, Math.PI / 2, 0] }, body); }
  if (bags) for (const s of [-1, 1]) { mesh(G.box, M('#8a5a34'), { p: [s * 0.3, 0.92, -0.3], s: [0.08, 0.2, 0.24] }, body); mesh(G.box, M('#6a4422'), { p: [s * 0.31, 1.0, -0.3], s: [0.085, 0.06, 0.25] }, body); mesh(G.ball, M('#c89a48', { metalness: 0.5 }), { p: [s * 0.345, 0.97, -0.3], s: 0.015 }, body); }
  // La cola, larga
  const tail = new THREE.Group(); tail.position.set(0, 1.04, -0.56); body.add(tail); u.tail = tail;
  const tc = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.1, -0.12), new THREE.Vector3(0, -0.4, -0.18), new THREE.Vector3(0, -0.62, -0.14)]);
  tail.add(new THREE.Mesh(new THREE.TubeGeometry(tc, 12, 0.05, 8), mane));
  mesh(G.ball, mane, { p: [0, -0.6, -0.14], s: [0.06, 0.08, 0.06] }, tail);
  [[-0.16, 0.38], [0.16, 0.38], [-0.16, -0.38], [0.16, -0.38]].forEach(([x, z], i) => leg(body, legs, { x, y: 0.72, z, up: 0.36, low: 0.29, r0: 0.085, r1: 0.05, r2: 0.04, color: cb, foot: 0.07, footColor: breed === 'blanco' ? '#5a5048' : '#2a2420', phase: TROT[i] }));
  return finish(root, u);
}
export function animateHorse(h, speed, t, e) {
  const u = h.userData, k = Math.min(1, speed / 3);
  u.phase = t * (4 + speed * 2.2);
  for (const l of u.legs) {
    l.hip.rotation.x = Math.sin(u.phase + l.phase) * 0.6 * k;
    l.knee.rotation.x = Math.max(0, Math.sin(u.phase + l.phase + 1.2)) * 0.9 * k;
  }
  if (u.tail) u.tail.rotation.set(0.25 * k, 0, Math.sin(t * 1.8 + u.seed) * 0.25 * (1 - k * 0.6));
  if (u.head) { u.head.rotation.x = Math.sin(u.phase) * 0.05 * k + (u.horse && speed < 0.2 && Math.sin(t * 0.3 + u.seed) > 0.4 ? 0.5 : 0) * 0.6; }
}
