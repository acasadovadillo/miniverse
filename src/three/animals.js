// Animales en 3D: los de la granja (con sus razas o pelajes), el caballo (que también se usa bajo el jinete),
// las mascotas y los salvajes, y cómo se mueven. Miran hacia z+, con las patas apoyadas en y = 0.
//
// Los cuerpos son de una pieza: una esfera deformada (pecho, barriga, grupa, lomo) con el color por vértice,
// así las manchas, la tripa más clara o el lomo más oscuro van pintados en la propia piel. Las patas tienen
// rodilla (se doblan al andar), la cabeza va unida por el cuello y se mueve (pastan, miran), y la cola se agita.
//
// The horse (Plan F phase 1, docs/planes/gta/PLAN-F-caballo.md §5): its leather saddlebags with a blanket roll, drawn
// flat, half full or bulging (the fill is part of animalKey, so the model is made again only when it changes); the mud
// of its lower legs and belly, drawn by its own copy of the material with one uniform (uDirt: setHorseDirt, never a
// rebuild); the ridden gaits with the gallop's lean, the head and neck pumping and the tail streaming; the rear, the
// shake and the toss (st.act) and the heaving flanks of a winded horse (st.winded); and the hoof strikes it counts for
// the sound (u.hits, read by actors.js).
import * as THREE from 'three';
import { mesh, mergeInto, G, M } from './shapes.js';
import { Builder } from './geo.js';
import { sobrio } from '../arte.js';

// (menos de dibujos animados: pelaje apagado y con variación de tono, ojos pequeños sin punto de brillo, patas más finas
// por debajo de la rodilla y, en los cabezones, la cabeza algo más pequeña)
const SMALL_HEAD = { perro: 0.84, gato: 0.84, cerdo: 0.88, oveja: 0.88, conejo: 0.86, gallina: 0.9, pato: 0.92 };
const tone = c => (typeof c === 'string' ? sobrio(c) : c);

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
// (fill: how full a horse's saddlebags look, 0 flat, 1 half, 2 bulging: saddlebags.js fillOf. With bags the key says
// 1 + fill, so the model is made again only when the fill level changes)
export const animalKey = (e, fill = 1) => `${e.type}:${e.breed || ''}:${e.bags ? 1 + fill : 0}`;
function coatOf(type, breed) { const c = COATS[type]; return c ? c[breed] || Object.values(c)[0] : []; }

// ---------- herramientas ----------
const C = new THREE.Color(), C2 = new THREE.Color(), WHITE = M('#ffffff'), EYE = M('#120e0e', { roughness: 0.12 });
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
// Con anatomía: la cruz y la cadera marcadas, el lomo que cae un poco entre ellas, el pecho hondo delante, los
// ijares recogidos hacia atrás y el costillar más ancho que la cintura
const trunk = ({ L, W, H, belly = 0.05, chest = 0.04, flat = 0.1, withers = 0.14, hips = 0.09 }) => (v, n) => {
  const t = n.z, up = Math.max(0, n.y), down = Math.max(0, -n.y), taper = 1 - 0.22 * t ** 4;
  v.x = n.x * W * taper * (1 + 0.07 * Gs(t - 0.15, 0.35) - 0.07 * Gs(t + 0.45, 0.16) + 0.04 * Gs(t + 0.75, 0.12));
  v.y = n.y * H * taper * (n.y > 0 ? 1 - flat * n.y : 1);
  v.y += H * up * (withers * Gs(t - 0.5, 0.17) + hips * Gs(t + 0.6, 0.17) - 0.05 * Gs(t + 0.05, 0.25));
  v.y -= H * down * (0.1 * Gs(t - 0.4, 0.22) + belly * 2.2 * Gs(t - 0.05, 0.4)) - H * down * 0.2 * sm(-0.2, -0.85, t);
  v.z = n.z * L + (t > 0.2 ? chest * (t - 0.2) * Math.max(0, 0.5 - n.y * 0.5) : 0);
};
// El color de una piel: el base, más oscuro en el lomo y más claro en la tripa; spots(n): manchas (0 a 1)
const coat = (base, { back = 0.12, belly = null, spot = null, spots = null } = {}) => n => {
  C.set(tone(base));
  if (belly && n.y < -0.25) C.lerp(C2.set(tone(belly)), Math.min(1, (-n.y - 0.25) * 2.2));
  if (n.y > 0) C.multiplyScalar(1 - back * n.y);
  if (spots && spot) { const k = spots(n); if (k > 0) C.lerp(C2.set(tone(spot)), k); }
  C.multiplyScalar(0.9 + noise(n.x * 7 + 3, n.y * 7, n.z * 7) * 0.12 + noise(n.x * 23, n.y * 23 + 5, n.z * 23) * 0.06);   // (el pelo, con su variación)
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
// El cuello de los que pastan, aparte del cuerpo, para que baje: un grupo en su base (girado para que su y vaya de la base
// a la punta) con el tubo dentro, y la cabeza en la punta (se recoloca al moverlo: neckPose). graze, cómo queda pastando:
// beta, cuánto baja el cuello por debajo de la horizontal, y S, el morro visto desde la cabeza [y, z]. Con eso (y el
// tamaño de la cabeza, que se pone después: settleNeck) sale cuánto se estira y cuánto se inclina la cabeza para que el
// morro quede entre la hierba. pts: lo que va pegado al cuello (la crin), en coordenadas del cuerpo
function neckRig(body, u, m, base, tip, r0, r1, seg, graze, pts = []) {
  const vy = tip[1] - base[1], vz = tip[2] - base[2], L = Math.hypot(vy, vz), a0 = Math.atan2(vz, vy);
  const neck = new THREE.Group(); neck.position.set(0, base[1], base[2]); neck.rotation.x = a0; body.add(neck); u.neck = neck;
  tube(m, [0, 0, 0], [0, L, 0], r0, r1, neck, seg);
  // (la unión con el cuerpo, redonda y con el cuello, que engorda con él: al bajarlo, la boca plana del tubo no asoma por
  // encima de la cruz)
  mesh(G.ball, m, { s: [r0 * 1.03, r0 * 1.03, r0 * 1.03] }, neck);
  const c = Math.cos(a0), s = Math.sin(a0);
  for (const [mm, p, o] of pts) { const dy = p[1] - base[1], dz = p[2] - base[2]; mesh(G.ball, mm, { ...o, p: [p[0], dy * c + dz * s, -dy * s + dz * c], r: o.r && [o.r[0] - a0, o.r[1], o.r[2]] }, neck); }
  u.rig = { by: base[1], bz: base[2], L, a0, ...graze };
}
// (con la cabeza ya de su tamaño) El morro, inclinado SNOUT por debajo de la horizontal (la cabeza casi de pie, como
// pastan) y a YT del suelo, entre las hojas: primero baja el cuello lo suyo (beta); si no llega, se estira, como mucho
// STRETCH (más, parece de llama), y si aun así no llega, baja más empinado, hasta BETA; lo que falte se queda en las
// hojas, que son más altas que eso. Si llega sin estirarlo, baja menos. Y lo que se inclina la cabeza
const SNOUT = 1.45, YT = 0.13, STRETCH = 1.3, BETA = 1.3;
function settleNeck(u) {
  const r = u.rig, k = u.head.scale.x, S = Math.hypot(...r.S) * k, need = r.by - YT - S * Math.sin(SNOUT);
  r.hr = Math.atan2(r.S[0], r.S[1]) + SNOUT;
  let beta = r.beta, st = need / (r.L * Math.sin(beta));
  if (st < 1) { st = 1; beta = Math.asin(Math.max(0.2, Math.min(1, need / r.L))); }
  else if (st > STRETCH) { st = STRETCH; beta = Math.max(beta, Math.min(BETA, Math.asin(Math.min(1, need / (r.L * STRETCH))))); }
  r.s = st; r.ag = Math.PI / 2 + beta;
}
// El cuello y la cabeza, de levantados (g = 0) a pastando (g = 1). Al estirarse engorda algo (si no, se ve fino)
// (da: an extra turn of the neck, + down: the horse's gallop pumps it, a rear lifts it)
function neckPose(u, g, da = 0) {
  const r = u.rig, a = r.a0 + (r.ag - r.a0) * g + da, s = 1 + (r.s - 1) * g, w = 1 + (s - 1) * 0.6;
  u.neck.rotation.x = a; u.neck.scale.set(w, s, w);
  u.head.position.set(0, r.by + Math.cos(a) * r.L * s, r.bz + Math.sin(a) * r.L * s);
}
// Ojos: negros y pequeños (sin punto de luz, que los hacía de dibujos animados)
function eyes(parent, x, y, z, r, tilt = 0) {
  r *= 0.72;
  for (const s of [-1, 1]) {
    mesh(G.ball, EYE, { p: [s * x, y, z], s: r }, parent);
    if (tilt) mesh(G.ball, M('#000000'), { p: [s * x, y + r * 0.75, z + r * 0.15], s: [r * 1.15, r * 0.35, r * 0.9], r: [0, 0, s * tilt] }, parent);   // párpado
  }
}
// Una pata con rodilla: su músculo arriba (paletilla o muslo), fina abajo y, en las de atrás (z < 0), con el corvejón hacia
// atrás: el muslo baja hacia atrás y la caña vuelve hacia delante, con el pie debajo de la cadera
function leg(body, legs, { x, y, z, up, low, r0, r1, r2, color, foot, footColor, paw = false, phase = 0 }) {
  const hind = z < 0, kz = hind ? -up * 0.24 : up * 0.05, fz = hind ? up * 0.24 : -up * 0.03, c = M(color);
  r1 *= paw ? 0.95 : 0.8; r2 *= paw ? 0.9 : 0.7;
  const hip = new THREE.Group(); hip.position.set(x, y, z); body.add(hip);
  if (up >= (paw ? 0.08 : 0.2)) mesh(G.ball, c, paw ? { p: [-Math.sign(x) * r0 * 0.25, up * 0.15, 0], s: [r0 * 0.7, up * 0.5, r0 * (hind ? 1.15 : 0.9)] } : { p: [-Math.sign(x) * r0 * 0.35, up * 0.1, hind ? -0.01 : 0.01], s: [r0 * (hind ? 0.9 : 0.75), up * 0.55, r0 * (hind ? 1.4 : 0.95)] }, hip);   // (el músculo, metido en el cuerpo)
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
// (u.geos: the geometries the merge made, this model's own: disposeAnimal releases them. What was not merged, a group with
// a single piece, keeps a shared one: the cached blobs, G.ball)
function finish(root, u) {
  const before = new Set();
  root.traverse(o => { if (o.isMesh) before.add(o.geometry); });
  mergeInto(u.body);
  for (const k of ['head', 'tail', 'neck']) if (u[k]) mergeInto(u[k]);
  for (const l of u.legs) { mergeInto(l.hip); mergeInto(l.knee); }
  u.geos = [];
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; if (!before.has(o.geometry)) u.geos.push(o.geometry); } });
  root.userData = u;
  return root;
}
// Release what is this model's own (actors.js, when it goes): the merged geometries and the horse's mud material. Never
// the shared materials or geometries
export function disposeAnimal(root) {
  const u = root?.userData;
  if (!u?.geos) return;
  for (const g of u.geos) g.dispose();
  u.geos = [];
  u.dirtMat?.dispose(); u.dirtMat = null;
}
const TROT = [0, Math.PI, Math.PI, 0];   // patas: delante izquierda y detrás derecha a la vez, y al revés

// ---------- los animales ----------
export function animalModel(type, breed, bags, fill = 1) {
  if (type === 'caballo') return horseModel(breed, bags, true, fill);
  const root = new THREE.Group(), body = new THREE.Group(), legs = [], u = { body, legs, type, seed: Math.random() * 10 };
  root.add(body);
  const [cb, cd, cl] = coatOf(type, breed), k = `${type}:${breed}`;
  const B = BUILD[type];
  if (B) B({ root, body, legs, u, cb, cd, cl, k: 'a2:' + k, breed, bags });
  if (u.head && SMALL_HEAD[type]) u.head.scale.setScalar(SMALL_HEAD[type]);
  if (u.rig) settleNeck(u);
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
    neckRig(body, u, M(cb), [0, 0.86, 0.42], [0, 1.0, 0.66], 0.24, 0.17, 14, { beta: 1.0, S: [-0.14, 0.34] });
    mesh(blob(k + ':h', 28, (v, n) => { const f = Math.max(0, n.z); v.set(n.x * 0.14 * (1 - 0.3 * f + 0.15 * f ** 4), n.y * 0.15 * (1 - 0.22 * f) - 0.06 * f * f, n.z * 0.31); }, n => coat(cb, { back: 0.05, spot: cd, spots: pinta ? n2 => (n2.x > 0.3 && n2.y > -0.2 ? 0.9 : 0) : null })(n)), WHITE, { p: [0, 0.02, 0.06] }, head);
    mesh(G.ball, M('#b8908a'), { p: [0, -0.12, 0.29], s: [0.105, 0.075, 0.08] }, head);                   // hocico
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
    neckRig(body, u, M(cb), [0, 0.66, 0.3], [0, 0.8, 0.44], 0.13, 0.1, 12, { beta: 1.15, S: [-0.07, 0.26] });   // (de lana: casi todo dentro del cuerpo hasta que baja)
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
    neckRig(body, u, M(cb), [0, 0.7, 0.3], [0, 0.98, 0.46], 0.13, 0.08, 12, { beta: 1.0, S: [-0.07, 0.27] });
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
    mesh(blob(k + ':b', breed === 'manchado' ? 56 : 36, trunk({ L: 0.47, W: 0.24, H: 0.24, belly: 0.06, flat: 0.12, withers: 0.04, hips: 0.06 }), coat(cb, { back: 0.05, spot: cd, spots: breed === 'manchado' ? patches(2.4, 7.7, 0.6) : null })), WHITE, { p: [0, 0.44, 0] }, body);
    const head = new THREE.Group(); head.position.set(0, 0.5, 0.42); body.add(head); u.head = head;
    mesh(blob(k + ':h', 24, (v, n) => { const f = Math.max(0, n.z); v.set(n.x * 0.15 * (1 - 0.35 * f), n.y * 0.15 * (1 - 0.3 * f), n.z * 0.2 * (n.z > 0 ? 1.25 : 1)); }, () => C.set(cb)), WHITE, { p: [0, 0, 0.04] }, head);
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
    neckRig(body, u, M(fur), [0, 1.05, 0.38], [0, 1.45, 0.62], 0.14, 0.08, 12, { beta: 1.1, S: [-0.05, 0.29] });
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
    // (un huevo con la grupa ancha y alta, y las orejas largas y finas)
    mesh(blob(k + ':b', 28, (v, n) => { const r = Math.max(0, -n.z); v.set(n.x * 0.115 * (1 + 0.18 * r), n.y * 0.12 * (1 + 0.15 * r) + 0.03 * r * Math.max(0, n.y), n.z * 0.19); }, coat(cb, { back: 0.08, belly: '#ffffff' })), WHITE, { p: [0, 0.17, -0.02] }, body);
    const head = new THREE.Group(); head.position.set(0, 0.3, 0.13); body.add(head); u.head = head;
    mesh(blob(k + ':h', 24, (v, n) => v.set(n.x * 0.085, n.y * 0.08, n.z * 0.09 * (n.z > 0 ? 1.1 : 1)), () => C.set(cb)), WHITE, {}, head);
    for (const s of [-1, 1]) {
      const ey = 0.17, eh = 1.15, ew = 0.8;
      mesh(G.ball, M(cb), { p: [s * 0.035, ey, -0.02], s: [0.026 * ew, 0.11 * eh, 0.035], r: [-0.25, 0, s * 0.18] }, head);
      mesh(G.ball, M(mixc(cd, cb, 0.4).getStyle()), { p: [s * 0.035, ey, -0.002], s: [0.014 * ew, 0.085 * eh, 0.02], r: [-0.25, 0, s * 0.18] }, head);
      mesh(G.ball, M('#ffffff'), { p: [s * 0.03, -0.035, 0.075], s: [0.03, 0.025, 0.025] }, head);   // mofletes
    }
    eyes(head, 0.05, 0.02, 0.06, 0.016);
    mesh(G.ball, M('#d88a92'), { p: [0, -0.015, 0.092], s: 0.013 }, head);
    const tail = new THREE.Group(); tail.position.set(0, 0.2, -0.19); body.add(tail); u.tail = tail;
    mesh(G.ball, M('#ffffff'), { s: 0.045 }, tail);
    for (const s of [-1, 1]) mesh(G.ball, M(cb), { p: [s * 0.085, 0.08, -0.08], s: [0.05, 0.075, 0.11] }, body);   // las patas de atrás, recogidas
    [[-0.05, 0.08], [0.05, 0.08]].forEach(([x, z], i) => leg(body, legs, { x, y: 0.09, z, up: 0.05, low: 0.04, r0: 0.025, r1: 0.02, r2: 0.018, color: cb, paw: true, phase: i ? 0 : 0 }));
  },
  gallina: o => bird(o, false),
  pato: o => bird(o, true),
  cisne({ body, u, k }) {
    mesh(blob(k + ':b', 28, (v, n) => v.set(n.x * 0.22, n.y * 0.13 * (n.y > 0 ? 1.2 : 1), n.z * 0.34 + (n.z < 0 && n.y > 0 ? -0.08 * n.y : 0)), () => C.set('#f8f6f2')), WHITE, { p: [0, 0.1, 0] }, body);
    for (const s of [-1, 1]) mesh(blob('a2:ala-cisne', 16, (v, n) => v.set(n.x * 0.035, n.y * 0.085, n.z * 0.27), () => C.set(tone('#f2f0ea'))), WHITE, { p: [s * 0.18, 0.2, -0.05], r: [0.2, 0, s * 0.15] }, body);
    const neck = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.16, 0.24), new THREE.Vector3(0, 0.42, 0.3), new THREE.Vector3(0, 0.62, 0.2), new THREE.Vector3(0, 0.68, 0.3)]);
    body.add(new THREE.Mesh(new THREE.TubeGeometry(neck, 16, 0.034, 8), M('#f8f6f2')));
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
  // Más de verdad: patas más largas (todo lo de encima sube dy), el cuerpo más estrecho y con cruz y cadera, el
  // cráneo más pequeño y, en el perro, el hocico más largo
  const lh = dog ? 1.45 : 1.25, dy = (lh - 1) * 0.21 * L;
  const paint = n => { const c = coat(cb, { back: 0.12, belly: dog && breed === 'negro' ? cd : '#f4f0e8', spot: third, spots })(n); if (breed === 'tricolor' && patches(2.2, 8.8, 0.62)(n) > 0.5) c.set(cd); return c; };
  mesh(blob(k + ':b', spots ? 56 : 32, trunk({ L: 0.26 * L, W: (dog ? 0.1 : 0.095) * L, H: (dog ? 0.12 : 0.105) * L, belly: 0, chest: dog ? 0.05 : 0.02, withers: dog ? 0.08 : 0.03, hips: dog ? 0.04 : 0.1 }), paint), WHITE, { p: [0, 0.32 * L + dy, 0] }, body);
  const hy = 0.5 * L + dy, hz = (dog ? 0.3 : 0.27) * L;
  const head = new THREE.Group(); head.position.set(0, hy, hz); body.add(head); u.head = head;
  tube(M(cb), [0, 0.34 * L + dy, 0.16 * L], [0, hy, hz], 0.075 * L, 0.055 * L, body, 10);
  mesh(blob(k + ':h', 24, (v, n) => v.set(n.x * (dog ? 0.095 : 0.09) * L, n.y * (dog ? 0.09 : 0.08) * L, n.z * (dog ? 0.105 : 0.088) * L), n => coat(cb, { back: 0.08, spot: third, spots: breed === 'manchado' ? (m => (m.x > 0.4 ? 0.9 : 0)) : null })(n)), WHITE, {}, head);
  const muzzle = M(dog ? (breed === 'negro' ? cd : mixc(cb, '#000000', 0.12).getStyle()) : mixc(cb, '#ffffff', 0.45).getStyle());
  if (dog) {   // el hocico largo, que se estrecha hacia la nariz, con la boca debajo
    mesh(blob('a2:hocico-perro', 16, (v, n) => { const f = Math.max(0, n.z); v.set(n.x * 0.05 * (1 - 0.25 * f) * L, n.y * 0.045 * (1 - 0.2 * f) * L, n.z * 0.1 * L); }, () => C.set('#ffffff')), muzzle, { p: [0, -0.03 * L, 0.1 * L] }, head);
    mesh(G.ball, M('#1a1010', { roughness: 0.25 }), { p: [0, -0.012 * L, 0.2 * L], s: [0.022 * L, 0.017 * L, 0.015 * L] }, head);
  } else {
    mesh(blob('a2:hocico-gato', 16, (v, n) => v.set(n.x * 0.042 * L, n.y * 0.03 * L, n.z * 0.045 * L), () => C.set('#ffffff')), muzzle, { p: [0, -0.035 * L, 0.075 * L] }, head);
    mesh(G.ball, M('#c88a8a', { roughness: 0.25 }), { p: [0, -0.012 * L, 0.115 * L], s: [0.016 * L, 0.012 * L, 0.016 * L] }, head);   // la nariz
  }
  eyes(head, 0.045 * L, 0.025 * L, (dog ? 0.085 : 0.08) * L, (dog ? 0.02 : 0.024) * L);
  for (const s of [-1, 1]) {
    if (dog) mesh(blob('a2:oreja-perro', 12, (v, n) => v.set(n.x * 0.018, n.y * 0.07, n.z * 0.045), () => C.set('#ffffff')), M(breed === 'manchado' ? cd : mixc(cb, '#000000', 0.25).getStyle()), { p: [s * 0.088, 0.02, -0.02], r: [0, 0, s * 0.22] }, head);
    else {
      const ex = 0.055, ey = 0.085;
      mesh(G.cone, M(cb), { p: [s * ex, ey, -0.005], s: [0.04, 0.07, 0.025], r: [0, 0, -s * 0.3] }, head);
      mesh(G.cone, M('#c89890'), { p: [s * ex, ey - 0.005, 0.008], s: [0.024, 0.045, 0.01], r: [0, 0, -s * 0.3] }, head);
      for (const d of [-0.01, 0.006]) tube(M('#f4f0ea'), [s * 0.035, -0.04 + d, 0.1], [s * 0.12, -0.03 + d * 2, 0.09], 0.0025, 0.0015, head, 4);   // bigotes
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
  mesh(blob(k + ':b', 28, (v, n) => { const r = n.z < 0 ? 1 : 1 - 0.25 * n.z; v.set(n.x * (duck ? 0.17 : 0.14) * r, n.y * (duck ? 0.12 : 0.14) * (n.y < 0 ? 1.05 : 1), n.z * (duck ? 0.26 : 0.22) + (n.z < 0 ? 0.03 * Math.max(0, n.y) * -n.z : 0)); }, n => { C.set(tone(col)); if (real && n.z > 0.2) C.lerp(C2.set(tone(cl)), Math.min(1, (n.z - 0.2) * 2)); if (n.y > 0) C.multiplyScalar(1 - 0.08 * n.y); C.multiplyScalar(0.9 + noise(n.x * 9, n.y * 9 + 2, n.z * 9) * 0.14); return C; }), WHITE, { p: [0, duck ? 0.24 : 0.32, 0] }, body);
  // Alas
  // (pegadas al cuerpo, finas)
  for (const s of [-1, 1]) mesh(blob(k + ':ala', 14, (v, n) => v.set(n.x * 0.022, n.y * 0.08, n.z * 0.15 + (n.z < 0 ? -0.03 : 0)), n => C.set(tone(cd || col)).lerp(C2.set(tone(col)), 0.4 + n.y * 0.3)), WHITE, { p: [s * (duck ? 0.15 : 0.125), duck ? 0.27 : 0.34, -0.03], r: [0.15, 0, s * 0.05] }, body);
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
  if (duck) tube(M(hc), [0, -0.2, -0.02], [0, -0.03, 0], 0.06, 0.045, head, 10);
  // La cabeza pequeña, con su cuello (la gallina), el pico más fino y la cresta y la barbilla más pequeñas
  const hk = 0.7;
  if (!duck) tube(M(hc), [0, 0.4, 0.06], [0, 0.53, 0.13], 0.08, 0.045, body, 10);
  mesh(G.ball, M(hc), { s: duck ? [0.075 * hk * 1.1, 0.075 * hk * 1.1, 0.09 * hk * 1.1] : [0.085 * hk, 0.09 * hk, 0.085 * hk * 1.1] }, head);
  if (duck) {
    mesh(blob('a2:pico-pato', 14, (v, n) => v.set(n.x * 0.032 * (1 + 0.15 * n.z), n.y * 0.014, n.z * 0.07), () => C.set('#ffffff')), M('#e0a030'), { p: [0, -0.018, 0.09] }, head);
    if (real) mesh(G.cyl, M('#f4f0e8'), { p: [0, -0.1, -0.01], s: [0.058, 0.018, 0.058] }, head);
  } else {
    mesh(G.cone, M('#d8a848'), { p: [0, -0.01 * hk, 0.1 * hk], s: [0.028 * hk, 0.06 * hk, 0.028 * hk], r: [Math.PI / 2 + 0.2, 0, 0] }, head);
    for (let i = 0; i < 3; i++) mesh(G.ball, M('#d8352a'), { p: [0, (0.09 + (i === 1 ? 0.02 : 0)) * hk, (-0.03 + i * 0.035) * hk], s: (rooster ? [0.022, 0.045, 0.025] : [0.016, 0.03, 0.018]).map(x => x * hk) }, head);   // cresta
    mesh(G.ball, M('#d8352a'), { p: [0, -0.07 * hk, 0.07 * hk], s: [0.018 * hk, (rooster ? 0.045 : 0.03) * hk, 0.015 * hk] }, head);                                                      // barbilla
  }
  eyes(head, duck ? 0.045 : 0.05, 0.015, duck ? 0.025 : 0.03, 0.016);
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
// (st: a horse's trick or shake and how winded it is, from actors.js: see animateHorse)
export function animateAnimal(m, dt, t, e, st = null) {
  const u = m.root.userData;
  if (u.horse) { animateHorse(m.root, m.speed, t, e, dt, undefined, st); return; }
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
  // Pastando (ranch.js y wildlife.js, e.grazing): bajan el cuello y la cabeza hasta la hierba y mordisquean; si no, miran a
  // un lado y a otro
  if (head) {
    const g = graze(u, e, k, dt), bite = g * (Math.sin(t * 7 + u.seed) * 0.05 + Math.max(0, Math.sin(t * 0.8 + u.seed)) * 0.04);
    if (u.rig) neckPose(u, g);
    head.rotation.x += ((u.rig ? u.rig.hr * g : g * 0.6) + bite - head.rotation.x) * Math.min(1, dt * 3);
    head.rotation.y = Math.sin(t * 0.6 + u.seed * 2) * 0.25 * (1 - k) * (1 - g * 0.7);
  }
  if (type === 'gallina' || type === 'pato') body.rotation.x = k ? Math.sin(m.phase * 2) * 0.08 : Math.max(0, Math.sin(t * 1.3 + m.phase) - 0.7) * 1.2;   // picotea
  else if (type === 'cerdo' && e?.digging) body.rotation.x = 0.25 + Math.sin(t * 9) * 0.06;   // hoza
  else body.rotation.x = Math.sin(t * 0.8 + m.phase) * 0.01;
  body.scale.x = body.scale.z = 1 + Math.sin(t * 2 + u.seed) * 0.01 * (1 - k);   // respira
}

// ---------- el caballo ----------
// También el del jinete: con su pelaje, la silla con su manta y los estribos y, si las tiene, las alforjas
// (fill: how full the saddlebags look, 0 flat, 1 half, 2 bulging; see saddlebags)
export function horseModel(breed = 'castano', bags = false, alone = false, fill = 1) {
  const root = new THREE.Group(), body = new THREE.Group(), legs = [], u = { body, legs, type: 'caballo', horse: alone, seed: Math.random() * 10 };
  root.add(body);
  const [cb, cd, cl] = coatOf('caballo', breed), k = `caballo:${breed}`, mane = M(cl || cd), pio = breed === 'pio';
  mesh(blob(k + ':b', pio || breed === 'tordo' ? 64 : 40, trunk({ L: 0.56, W: 0.26, H: 0.29, belly: 0.03, chest: 0.06 }), coat(cb, { back: 0.12, spot: cd, spots: pio ? patches(2, 5.5, 0.55) : breed === 'tordo' ? (n => noise(n.x * 9, n.y * 9, n.z * 9) > 0.62 ? 0.45 : 0) : null })), WHITE, { p: [0, 0.88, 0] }, body);
  // Cuello y cabeza, con la crin
  const head = new THREE.Group(); head.position.set(0, 1.38, 0.76); body.add(head); u.head = head;
  neckRig(body, u, M(cb), [0, 0.9, 0.34], [0, 1.38, 0.76], 0.15, 0.075, 14, { beta: 0.95, S: [-0.24, 0.36] },
    Array.from({ length: 6 }, (_, i) => [mane, [0, 1.06 + i * 0.065, 0.4 + i * 0.055], { s: [0.045, 0.08, 0.07], r: [0.6, 0, 0] }]));   // (la crin, con el cuello)
  const morro = M(cl && breed === 'palomino' ? cb : breed === 'blanco' ? '#d8cfc4' : mixc(cb, '#000000', 0.25).getStyle());
  // La cabeza larga, en cuña: ancha en la frente y las quijadas y estrecha hacia el morro, con los ojos a los lados
  mesh(blob(k + ':h', 28, (v, n) => { const f = (n.z + 1) / 2, jaw = Gs(n.z + 0.45, 0.3) * Math.max(0, -n.y); v.set(n.x * (0.085 - 0.03 * f + 0.02 * jaw), n.y * (0.105 - 0.04 * f) - 0.03 * jaw, n.z * 0.3); }, n => coat(cb, { back: 0.06 })(n)), WHITE, { p: [0, -0.06, 0.12], r: [0.6, 0, 0] }, head);
  mesh(G.ball, morro, { p: [0, -0.2, 0.31], s: [0.052, 0.05, 0.07], r: [0.6, 0, 0] }, head);   // el morro
  if (breed === 'blanco' || breed === 'tordo' || breed === 'palomino' || pio) mesh(G.ball, M('#f8f4ee'), { p: [0, -0.057, 0.243], s: [0.028, 0.012, 0.085], r: [0.76, 0, 0] }, head);   // the blaze, lying on the face
  for (const s of [-1, 1]) {
    mesh(G.cone, M(cb), { p: [s * 0.045, 0.1, -0.06], s: [0.025, 0.08, 0.02], r: [-0.25, 0, -s * 0.12] }, head);
    mesh(G.ball, M('#2a1a14'), { p: [s * 0.026, -0.205, 0.345], s: [0.012, 0.015, 0.012], r: [0.6, 0, 0] }, head);   // ollares
  }
  mesh(G.ball, mane, { p: [0, 0.08, 0.02], s: [0.035, 0.045, 0.055] }, head);   // el flequillo
  eyes(head, 0.075, 0.0, 0.07, 0.024);
  // Silla: manta, asiento con borrén, estribos; alforjas a los lados
  const saddle = M('#6a2a1e'), blanket = M('#3a5a8a'), steel = M('#b8c0c8', { metalness: 0.6, roughness: 0.35 });
  mesh(G.cyl, blanket, { p: [0, 1.13, -0.02], s: [0.3, 0.025, 0.34] }, body);
  mesh(blob('silla', 20, (v, n) => v.set(n.x * 0.2, n.y * 0.05 + (Math.abs(n.z) > 0.6 && n.y > 0 ? 0.04 * (Math.abs(n.z) - 0.6) * 4 : 0), n.z * 0.24), () => C.set('#ffffff')), saddle, { p: [0, 1.16, -0.02] }, body);
  for (const s of [-1, 1]) { tube(M('#4a2a1a'), [s * 0.2, 1.15, 0.02], [s * 0.26, 0.86, 0.04], 0.008, 0.008, body, 4); mesh(new THREE.TorusGeometry(0.035, 0.008, 4, 10), steel, { p: [s * 0.26, 0.84, 0.04], r: [0, Math.PI / 2, 0] }, body); }
  if (bags) saddlebags(body, fill);
  // La cola, larga
  const tail = new THREE.Group(); tail.position.set(0, 1.04, -0.56); body.add(tail); u.tail = tail;
  const tc = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.1, -0.12), new THREE.Vector3(0, -0.4, -0.18), new THREE.Vector3(0, -0.62, -0.14)]);
  tail.add(new THREE.Mesh(new THREE.TubeGeometry(tc, 12, 0.05, 8), mane));
  mesh(G.ball, mane, { p: [0, -0.6, -0.14], s: [0.06, 0.08, 0.06] }, tail);
  [[-0.16, 0.38], [0.16, 0.38], [-0.16, -0.38], [0.16, -0.38]].forEach(([x, z], i) => leg(body, legs, { x, y: 0.72, z, up: 0.36, low: 0.29, r0: 0.085, r1: 0.05, r2: 0.04, color: cb, foot: 0.07, footColor: breed === 'blanco' ? '#5a5048' : '#2a2420', phase: TROT[i] }));
  settleNeck(u);
  u.hipRest = legs.map(l => l.hip.position.y);
  finish(root, u);
  dirtify(root, u);
  return root;
}
// ---------- the saddlebags ----------
// Two leather bags behind the cantle, one on each flank, each with its flap, a strap down the flap and a brass buckle,
// hung by a strap over the loins; and a blanket rolled across the croup, tied with two straps. fill (0 flat, 1 half,
// 2 bulging) makes them thin and limp, or fat and round with the flap riding over what is inside. About 430 triangles.
// Placed against the trunk as horseModel makes it (at z -0.27 its flank is about 0.21 m out at mid height and 0.18 at
// y 1.02, and it narrows towards the tail, so each bag leans out at the bottom and toes in at the back). Clear of the big
// thing behind the saddle (carry3d.js HORSE_LOAD: the log across the croup at z -0.46, r 0.095, from y 1.07): the roll
// ends at z -0.35 and the bags' tops stay under y 1.05. The seat behind the saddle stays free when there are no bags
const BAG = {
  pivot: [0.188, 1.026, -0.27], lean: 0.14, toeIn: 0.25,   // (the top inner edge of the right-hand bag, +x; its tilts)
  depth: [0.035, 0.068, 0.095], height: [0.175, 0.2, 0.215], half: [0.112, 0.118, 0.126], round: [0.01, 0.022, 0.032], bulge: [0, 0.012, 0.03],
};
const ROLL = { y: 1.164, z: -0.305, r: 0.046, len: 0.4, ties: 0.12 };
const BAG_COLORS = { leather: '#7a4a2a', flap: '#5e3820', strap: '#3a2416', brass: '#b8913e', wool: '#7a3a30', woolEnd: '#5e2c26' };
const BAG_GEO = new Map();
const rbox = (x0, y0, z0, x1, y1, z1, r) => { const B = new Builder(); B.roundBox(x0, y0, z0, x1, y1, z1, r); return B.geometry(); };   // (Builder's shapes return nothing: no chaining)
const sbox = (x0, y0, z0, x1, y1, z1) => { const B = new Builder(); B.box(x0, y0, z0, x1, y1, z1); return B.geometry(); };
// The other side's piece: x mirrored, and its triangles turned round so they still face out
function mirrorX(g) {
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) { p.setX(i, -p.getX(i)); n.setX(i, -n.getX(i)); }
  const I = g.index;
  if (I) for (let i = 0; i < I.count; i += 3) { const a = I.getX(i + 1); I.setX(i + 1, I.getX(i + 2)); I.setX(i + 2, a); }
  return g;
}
// The pieces of one bag (side s, fill f) as [geometry, colour], in the horse's body: made once each, shared (mergeInto
// copies them into each horse's body)
function bagParts(s, f) {
  const key = s + ':' + f;
  if (BAG_GEO.has(key)) return BAG_GEO.get(key);
  const d = BAG.depth[f], h = BAG.half[f], H = BAG.height[f], b = BAG.bulge[f], C = BAG_COLORS;
  // (in the bag's own frame: x out from its inner face, y down from its top, z along the horse; the pivot at 0)
  const parts = [
    [rbox(0, -H, -h, d, 0, h, BAG.round[f]), C.leather],
    [rbox(-0.008, -0.006, -h - 0.005, d + 0.012, 0.014, h + 0.005, 0.006), C.flap],             // the flap over the top
    [rbox(d - 0.002, -H * 0.55, -h + 0.006, d + 0.009, 0.004, h - 0.006, 0.005), C.flap],        // and down the outside
    [sbox(d + 0.008, -H * 0.72, -0.011, d + 0.014, 0.002, 0.011), C.strap],
    [rbox(d + 0.011, -H * 0.6, -0.02, d + 0.019, -H * 0.6 + 0.026, 0.02, 0.003), C.brass],         // the buckle
  ];
  // (what is inside pushes the outside out, most in the middle: every piece out there follows the same swell)
  const M4 = new THREE.Matrix4().compose(new THREE.Vector3(...BAG.pivot), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, BAG.toeIn, BAG.lean, 'YXZ')), new THREE.Vector3(1, 1, 1));
  for (const [g] of parts) {
    const p = g.attributes.position;
    if (b) for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      if (x < d * 0.5) continue;
      const qy = (p.getY(i) + H / 2) / (H / 2), qz = p.getZ(i) / h, w = Math.max(0, 1 - qy * qy) * Math.max(0, 1 - qz * qz);
      p.setX(i, x + b * w);
    }
    g.applyMatrix4(M4);
    if (s < 0) mirrorX(g);
  }
  // (the strap that hangs it, from the top of the bag over the loins to under the roll, lying on the trunk)
  for (const [a, c] of [[[0.196, 1.02], [0.148, 1.074]], [[0.148, 1.074], [0.055, 1.122]]]) parts.push([strap([s * a[0], a[1], ROLL.z], [s * c[0], c[1], ROLL.z], 0.034, 0.006, s), C.strap]);
  BAG_GEO.set(key, parts);
  return parts;
}
// A flat strap from a to b (its width along z, its thickness out from the trunk)
function strap(a, b, w, t, s) {
  const A = new THREE.Vector3(...a), dv = new THREE.Vector3(...b).sub(A), len = dv.length(), g = new THREE.BoxGeometry(t, len, w);
  g.deleteAttribute('uv');
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dv.normalize());
  return g.applyMatrix4(new THREE.Matrix4().compose(A.addScaledVector(dv, len * 0.5), q, new THREE.Vector3(1, 1, 1)));
}
let ROLL_GEO = null;
function rollParts() {
  if (ROLL_GEO) return ROLL_GEO;
  const R = ROLL, C = BAG_COLORS, across = new THREE.Matrix4().makeRotationZ(Math.PI / 2), at = (x, g) => g.applyMatrix4(across).translate(x, R.y, R.z);
  ROLL_GEO = [[at(0, new THREE.CylinderGeometry(R.r, R.r, R.len, 12, 1, true)), C.wool]];
  for (const s of [-1, 1]) {
    ROLL_GEO.push([at(s * R.len / 2, new THREE.CircleGeometry(R.r, 12).rotateY(s * Math.PI / 2).rotateZ(-Math.PI / 2)), C.woolEnd]);   // (the rolled end)
    ROLL_GEO.push([at(s * R.ties, new THREE.CylinderGeometry(R.r + 0.004, R.r + 0.004, 0.022, 12, 1, true)), C.strap]);
  }
  for (const [g] of ROLL_GEO) g.deleteAttribute('uv');
  return ROLL_GEO;
}
function saddlebags(body, fill) {
  const f = Math.max(0, Math.min(2, fill | 0));
  for (const s of [-1, 1]) for (const [g, c] of bagParts(s, f)) mesh(g, M(c, { roughness: 0.8 }), {}, body);
  for (const [g, c] of rollParts()) mesh(g, M(c, { roughness: 0.9 }), {}, body);
}

// ---------- the horse's mud ----------
// Ridden, the horse gets muddy (horse.js: a.dirt, or the rider's p.horseDirt, 0..1): darker and speckled on the lower
// legs, under the belly and in the elbows, as if splashed from below. How muddy each part can get is baked into the
// geometry when the model is made (aDirt, from where each vertex is at rest, so it never slides on a moving leg; its
// whole part is a seed for the speckle, so the four legs do not get the same spots); how muddy the horse is now is one
// uniform, uDirt, on the horse's own copy of the merged vertex-colour material. One program for every horse (a fixed
// customProgramCacheKey; Three runs onBeforeCompile once per material, each with its own uniform). With uDirt at 0 the
// branch is skipped: a clean horse costs a uniform test per fragment
const DIRT_VERT_DECL = 'attribute float aDirt;\nvarying float vDirt;\nvarying vec3 vDirtP;';
const DIRT_VERT = 'float dSeed = floor(aDirt * 0.5); vDirt = aDirt - 2.0 * dSeed; vDirtP = position + dSeed * vec3(3.7, 1.9, 5.3);';
const DIRT_FRAG_DECL = `uniform float uDirt;
varying float vDirt;
varying vec3 vDirtP;
float hdHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float hdNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hdHash(i), hdHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(hdHash(i + vec3(0.0, 1.0, 0.0)), hdHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(hdHash(i + vec3(0.0, 0.0, 1.0)), hdHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(hdHash(i + vec3(0.0, 1.0, 1.0)), hdHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}`;
// (a film that climbs with the mud, its edge broken into splashes, and spots above it; the colours are LINEAR, as
// diffuseColor is: dark wet earth where it is thickest, dry grey-brown dust around it, so it reads on a bay or black coat
// too, not only on a white one. Every smoothstep has edge0 < edge1)
const DIRT_FRAG = `if (uDirt > 0.0 && vDirt > 0.002) {
  float n = hdNoise(vDirtP * 34.0), m = vDirt * uDirt;
  float film = smoothstep(0.16, 0.5, m * (0.55 + 0.9 * n));
  float spots = smoothstep(0.62, 0.78, n) * smoothstep(0.03, 0.25, m);
  float k = clamp(max(film * (0.72 + 0.25 * n), spots * 0.75), 0.0, 0.9);
  vec3 dry = vec3(0.2, 0.158, 0.108) * (0.85 + 0.3 * n), wet = vec3(0.062, 0.045, 0.028) * (0.8 + 0.4 * n);
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(dry, wet, smoothstep(0.45, 0.85, n + 0.35 * m)), k);
}`;
const DIRT_KEY = () => 'horse-dirt';
let dirtWarned = false;
// The horse's copy of base (its merged material), reading U.value as uDirt
function dirtMaterial(base, U) {
  const m = base.clone();
  m.onBeforeCompile = sh => {
    sh.uniforms.uDirt = U;
    const v = sh.vertexShader.replace('#include <common>', `#include <common>\n${DIRT_VERT_DECL}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${DIRT_VERT}`);
    const f = sh.fragmentShader.replace('#include <common>', `#include <common>\n${DIRT_FRAG_DECL}`).replace('#include <color_fragment>', `#include <color_fragment>\n${DIRT_FRAG}`);
    // (all or nothing: a half-patched shader would not compile)
    if (v === sh.vertexShader || !f.includes('uDirt > 0.0') || !f.includes('varying float vDirt')) { if (!dirtWarned) { dirtWarned = true; console.warn('Miniverse: the horse mud could not hook the shader (drawn clean)'); } return; }
    sh.vertexShader = v; sh.fragmentShader = f;
  };
  m.customProgramCacheKey = DIRT_KEY;
  return m;
}
// How muddy a vertex can get, from where it is on the horse at rest (x, y, z) and where it faces (ny, its normal's y)
function dirtMask(x, y, z, ny) {
  let k = 1 - sm(0.16, 0.54, y);                                                                 // up the legs, to the knees
  if (y > 0.45 && Math.abs(x) < 0.2) k = Math.max(k, 0.85 * sm(-0.3, -0.85, ny) * (1 - sm(0.64, 0.76, y)));   // under the belly
  if (z < -0.2 && y < 0.75) k = Math.min(1, k * 1.15 + 0.06 * (1 - sm(0.5, 0.75, y)));         // (the hind legs: what the front ones throw)
  return k;
}
const DV = new THREE.Vector3(), DN = new THREE.Vector3(), DM3 = new THREE.Matrix3();
function dirtify(root, u) {
  root.updateMatrixWorld(true);
  let base = null, seed = 0;
  root.traverse(o => {
    if (!o.isMesh || !o.material.vertexColors || o.material.map || !u.geos.includes(o.geometry)) return;
    base ||= o.material;
    const g = o.geometry, P = g.attributes.position, N = g.attributes.normal, a = new Float32Array(P.count), s = 2 * (seed++ % 16);
    DM3.getNormalMatrix(o.matrixWorld);
    for (let i = 0; i < P.count; i++) {
      DV.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld); DN.fromBufferAttribute(N, i).applyMatrix3(DM3).normalize();
      a[i] = s + Math.min(1, dirtMask(DV.x, DV.y, DV.z, DN.y));
    }
    g.setAttribute('aDirt', new THREE.BufferAttribute(a, 1));
  });
  if (!base) return;
  u.dirtU = { value: 0 };
  u.dirtMat = dirtMaterial(base, u.dirtU);
  root.traverse(o => { if (o.isMesh && o.material === base) o.material = u.dirtMat; });
}
// How muddy the horse looks now (0..1): a uniform, never a rebuild
export function setHorseDirt(root, v) {
  const U = root?.userData?.dirtU;
  if (!U) return;
  v = v > 0 ? (v < 1 ? v : 1) : 0;
  if (Math.abs(U.value - v) > 0.004 || (v === 0 && U.value !== 0)) U.value = v;
}
// Its program (and the shadow pass's, the common one), compiled without stopping the game when the world first shows
// (actors.js): otherwise the first horse in view, or the first time you mount, would compile it mid-game. A one-triangle
// mesh with the same attributes; the material is kept for good, so the program stays while no horse is in view
let DIRT_PROTO = null;
export function prewarmHorse(renderer, camera, scene) {
  if (!renderer?.compileAsync) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
  g.setAttribute('aDirt', new THREE.Float32BufferAttribute([0, 1, 0], 1));
  DIRT_PROTO ||= dirtMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 }), { value: 0 });
  const o = new THREE.Mesh(g, DIRT_PROTO);
  o.frustumCulled = false; o.castShadow = true;
  renderer.compileAsync(o, camera, scene).catch(() => {}).finally(() => g.dispose());
}

// Cuánto está pastando (de 0 a 1, poco a poco: baja la cabeza en algo más de un segundo); andando, nada
function graze(u, e, k, dt) {
  const want = e?.grazing && k < 0.15 ? 1 : 0;
  u.g = (u.g || 0) + (want - (u.g || 0)) * Math.min(1, dt * 2.2);
  if (u.g < 1e-3) u.g = 0;
  return u.g;
}
// The ridden horse's four gaits (horseride.js GT: 0 walk, 1 trot, 2 gallop, 3 canter): the phase of each leg (the
// order of horseModel's legs: front -x, front +x, back -x, back +x), how far they swing and bend, the stride (metres a
// leg cycle covers: the cadence is speed / stride, so the legs never paddle in place) and the body's rocking and bob. With
// 3.4, 5.6, 7.6 and 10.4 m/s that is about 1.4 cycles a second walking, 2.0 trotting, 2.3 cantering and 2.5 galloping (the free horse's
// cycle, by the time, is 2.6 to 3.4). The walk goes one leg at a time (back, front on the same side, then the other side),
// the trot by diagonal pairs (TROT), the gallop with the back legs together a little apart, then the front (a transverse
// gallop: four beats, the hind pair a tenth of a cycle apart and the front pair a tenth too), and the canter in three beats:
// a back leg, the other back one with its diagonal, the leading front one, and then all four in the air
const TAU = Math.PI * 2;
const HORSE_GAITS = [
  { legs: [0, 0.5, 0.75, 0.25].map(f => f * TAU), hip: 0.42, knee: 0.75, stride: 2.4, pitch: 0, bob: 0.015 },
  { legs: TROT, hip: 0.55, knee: 0.95, stride: 2.8, pitch: 0.01, bob: 0.045 },
  { legs: [0.6, 0.5, 0.09, 0].map(f => f * TAU), hip: 0.85, knee: 1.1, stride: 4.2, pitch: 0.07, bob: 0.07 },
  { legs: [0.35, 0, 0.7, 0.35].map(f => f * TAU), hip: 0.66, knee: 1, stride: 3.3, pitch: 0.045, bob: 0.06 },
];
// At the gallop (GALLOP, by how much it is galloping, eased over about 0.3 s): the hind legs reach further back under
// the push and the front ones further forward, the front knees fold higher, the neck and head pump with the stride and
// the tail streams out behind
const GALLOP = { hindBack: 0.1, foreFwd: 0.06, foreFold: 0.15, neck: 0.1, head: 0.08, tail: 0.42, ease: 3.3 };
const CANTER_K = 0.35;   // (how much of it the canter has)
// The tricks and starts (st.act, how long each lasts in seconds): the rear (1.2 s: the body up about 38° on the hind hips,
// the hind legs bent under it, the forelegs pawing, the head up and the tail hanging), the shake after a brushing (0.8 s:
// the body rolls fast from side to side, the head with it) and the toss of the head (0.6 s: a trick it does not know yet)
export const HORSE_ACTS = { rear: 1.2, shake: 0.8, toss: 0.6, slide: 0.85, stumble: 0.8 };
const REAR = { pitch: 0.66, py: 0.72, pz: -0.38, crouch: 0.035, hindHip: 0.35, hindKnee: 0.55, foreHip: 1.1, foreKnee: 1.7, paw: 0.3, pawHz: 1.5, neck: -0.45, head: -0.35 };
const REAR_FP = { pitch: 0.6, neck: 0.5, head: 0.25 };   // (from the rider's own eyes: less of the pitch, the neck stretched forward and down)
// The sliding stop (Plan R4 §5): the trunk sits back about the shoulders (pz), the hind legs under it and the forelegs braced
// ahead, the head up. The stumble: the trunk goes down in front about the hind hips, the fore knees give way, the head drops
// and it sways until it finds its feet
const SLIDE = { pitch: -0.27, py: 0.72, pz: 0.38, down: 0.025, hindHip: 1.05, foreHip: 0.32, neck: -0.28, head: 0.22 };
const STUMBLE = { pitch: 0.24, py: 0.72, pz: -0.38, foreHip: 0.5, down: 0, neck: 0.34, head: 0.12, roll: 0.07, hz: 2.2 };
const SHAKE = { roll: 0.12, hz: 5.6, head: 0.35 };
const SEAT = [1.16, -0.02];   // (the saddle's seat on the body, y and z: where the rider sits, for the rider's rear)
// (winded: the flanks heave at 1.6 breaths a second and the head hangs low)
const WINDED = { hz: 1.6, flank: 0.035, low: 0.4, head: 0.28 };
export const horseCadence = (gait, speed) => speed / HORSE_GAITS[gait].stride;   // (cycles a second)
// A hoof lands when its leg is furthest forward (the hip's swing at its lowest, sin = -1): did the phase a0 → a1 pass it?
const FOOT = Math.PI * 1.5, wrapT = a => a - TAU * Math.floor(a / TAU);
const struck = (a0, a1) => { const d = wrapT(a1 - a0); return d > 0 && d < Math.PI && wrapT(a1 - FOOT) < d; };
// h: the horse (horseModel); speed in m/s; t the time; e what it is doing (e.grazing), or null; gait: the rider's gait, or
// undefined for a horse nobody rides (its cycle by the time, as always). st: { act, at, winded, fp } or null, from actors.js:
// the trick or start it is playing (HORSE_ACTS) and the seconds since it began, and how winded it is (0..1). Writes
// u.bob (the trunk's bob, for the rider), u.rear (0..1) with u.seatDy, u.seatDz and u.seatPitch (where the seat goes while
// it rears) and u.hits (hooves that landed this frame, for the sound)
export function animateHorse(h, speed, t, e, dt = 1 / 60, gait, st = null) {
  const u = h.userData, k = Math.min(1, speed / 3), ridden = gait === 0 || gait === 1 || gait === 2 || gait === 3;
  u.gk = (u.gk || 0) + ((gait === 2 ? 1 : gait === 3 ? CANTER_K : 0) - (u.gk || 0)) * Math.min(1, dt * GALLOP.ease);
  if (u.gk < 1e-3) u.gk = 0;
  const gk = u.gk * k;
  u.hits = 0;
  if (ridden) {
    // (ridden by a player: by its gait, the legs easing from one gait's phases to the next; the phase is its own, so a change
    // of speed never jumps it)
    const G = HORSE_GAITS[gait], ease = Math.min(1, dt * 5);
    if (!u.lp) { u.lp = G.legs.slice(); u.amp = [G.hip, G.knee, G.pitch, G.bob, G.stride]; u.gaitPhase = u.gaitPhase || 0; u.hipY = u.legs.map(l => l.hip.position.y); }
    for (let i = 0; i < 4; i++) { let d = G.legs[i] - u.lp[i]; d = Math.atan2(Math.sin(d), Math.cos(d)); u.lp[i] += d * ease; }
    u.amp[0] += (G.hip - u.amp[0]) * ease; u.amp[1] += (G.knee - u.amp[1]) * ease; u.amp[2] += (G.pitch - u.amp[2]) * ease; u.amp[3] += (G.bob - u.amp[3]) * ease; u.amp[4] += (G.stride - u.amp[4]) * ease;
    const prev = u.gaitPhase;
    u.gaitPhase = (u.gaitPhase + dt * TAU * speed / u.amp[4]) % TAU;
    const ph = u.phase = u.gaitPhase;
    // (the gallop rocks the body, nose down as the front legs land; the trot bounces twice a cycle, the gallop and the canter once)
    const pitch = u.body.rotation.x = Math.sin(ph + 0.9) * u.amp[2] * k;
    u.bob = (gait >= 2 ? 0.5 + 0.5 * Math.sin(ph) : Math.abs(Math.sin(ph))) * u.amp[3] * k;
    u.body.position.y = u.bob;
    // (the legs hang from the body: each hip is moved back by what the bob and the rocking move it, so only the trunk rides
    // and the hooves stay on the ground)
    const c = Math.cos(pitch), sn = Math.sin(pitch);
    for (let i = 0; i < 4; i++) {
      const l = u.legs[i], hind = i >= 2;
      l.hip.rotation.x = Math.sin(ph + u.lp[i]) * u.amp[0] * k + (hind ? GALLOP.hindBack : -GALLOP.foreFwd) * gk;
      l.knee.rotation.x = Math.max(0, Math.sin(ph + u.lp[i] + 1.2)) * u.amp[1] * k * (hind ? 1 : 1 + GALLOP.foreFold * u.gk);
      const y0 = u.hipY[i], z = l.hip.position.z;
      l.hip.position.y = y0 + (y0 - y0 * c + z * sn - u.bob) / c;
      if (k > 0.2 && struck(prev + u.lp[i], ph + u.lp[i])) u.hits++;
    }
  } else {
    const prev = u.phase;
    u.phase = t * (4 + speed * 2.2);
    for (const l of u.legs) {
      l.hip.rotation.x = Math.sin(u.phase + l.phase) * 0.6 * k;
      l.knee.rotation.x = Math.max(0, Math.sin(u.phase + l.phase + 1.2)) * 0.9 * k;
      if (k > 0.3 && prev !== undefined && struck(prev + l.phase, u.phase + l.phase)) u.hits++;
    }
    if (u.lp) { for (let i = 0; i < 4; i++) u.legs[i].hip.position.y = u.hipY[i]; u.lp = null; u.body.rotation.x = 0; u.body.position.y = 0; u.bob = 0; }
  }
  // (what it is playing now: each a 0..1 weight that eases in and out over its time)
  const act = st?.act || null, ak = act ? Math.min(1, (st.at || 0) / (HORSE_ACTS[act] || 1)) : 0;
  const rear = act === 'rear' ? sm(0, 0.28, ak) * (1 - sm(0.7, 1, ak)) : 0;
  const shake = act === 'shake' ? sm(0, 0.12, ak) * (1 - sm(0.72, 1, ak)) : 0;
  const toss = act === 'toss' ? Math.sin(Math.PI * ak) : 0;
  const slide = act === 'slide' ? sm(0, 0.16, ak) * (1 - sm(0.72, 1, ak)) : 0, stumble = act === 'stumble' ? sm(0, 0.14, ak) * (1 - sm(0.5, 1, ak)) : 0;
  const w = st?.winded > 0 ? Math.min(1, st.winded) : 0, breath = Math.sin(t * TAU * WINDED.hz);
  if (u.tail) u.tail.rotation.set(0.25 * k + gk * (GALLOP.tail + 0.07 * Math.sin(2 * u.phase + 1)), 0, Math.sin(t * 1.8 + u.seed) * 0.25 * (1 - k * 0.6) + gk * 0.06 * Math.sin(u.phase));
  // (pastando, baja el cuello hasta la hierba; si no, de vez en cuando, parado, agacha un poco la cabeza. Winded, low; at
  // the gallop it pumps; rearing or tossing it, up)
  const g = graze(u, e, k, dt), low = Math.max(g, WINDED.low * w);
  if (u.rig) neckPose(u, low, gk * GALLOP.neck * Math.sin(u.phase + 0.9) + (st?.fp ? REAR_FP.neck : REAR.neck) * rear - 0.3 * toss + SLIDE.neck * slide + STUMBLE.neck * stumble + 0.08 * shake * Math.sin(ak * TAU * SHAKE.hz * HORSE_ACTS.shake));
  if (u.head) {
    u.head.rotation.x = Math.sin(u.phase) * 0.05 * k + (u.horse && !g && speed < 0.2 && Math.sin(t * 0.3 + u.seed) > 0.4 ? 0.5 : 0) * 0.6 + g * (u.rig.hr + Math.sin(t * 7 + u.seed) * 0.05)
      + gk * GALLOP.head * Math.sin(u.phase + 0.4) + w * (WINDED.head + 0.05 * breath) + (st?.fp ? REAR_FP.head : REAR.head) * rear - 0.4 * toss + SLIDE.head * slide + STUMBLE.head * stumble;
    u.head.rotation.z = shake * SHAKE.head * Math.sin(ak * TAU * SHAKE.hz * HORSE_ACTS.shake + 0.9) + 0.2 * toss * Math.sin(ak * TAU * 2);
  }
  // (winded: the flanks heave; the trunk's own scale, so the legs barely notice)
  u.body.scale.set(1 + WINDED.flank * w * breath, 1, 1 + 0.01 * w * breath);
  posedAct(u, rear, shake, ak, t, st?.fp ? REAR_FP.pitch : 1, slide, stumble);
}
// The rear and the shake over the gait (rear, shake: their weights; ak: how far through it is). The channels nothing else
// writes (the trunk's sideways and forward offsets, its roll, the legs' roll) are put back when it ends
function posedAct(u, rear, shake, ak, t, pk = 1, slide = 0, stumble = 0) {   // (pk: how much of the rear's pitch)
  const B = u.body;
  u.slide = slide; u.stumble = stumble;
  if (!rear && !shake && !slide && !stumble) {
    if (u.posed) {
      u.posed = false; B.position.x = B.position.z = 0; B.rotation.z = 0;
      for (const l of u.legs) l.hip.rotation.z = 0;
      if (!u.lp) { B.rotation.x = 0; B.position.y = 0; for (let i = 0; i < 4; i++) u.legs[i].hip.position.y = u.hipRest[i]; }
    }
    u.rear = 0;
    return;
  }
  u.posed = true;
  if (!u.lp) { B.position.y = 0; B.rotation.x = 0; }   // (a horse nobody rides has no bob or rocking of its own: from rest)
  const bob = B.position.y;
  if (rear) {
    // (the whole trunk turns about the hind hips: it goes up and back, and the hind legs, counter-turned, stay under it)
    const R = REAR, rx = B.rotation.x * (1 - rear) - R.pitch * pk * rear, c = Math.cos(rx), s = Math.sin(rx);
    B.rotation.x = rx;
    B.position.y = R.py - (R.py * c - R.pz * s) + bob * (1 - rear) - R.crouch * rear;
    B.position.z = R.pz - (R.py * s + R.pz * c);
    for (let i = 0; i < 4; i++) {
      const l = u.legs[i], hind = i >= 2, paw = Math.sin(t * TAU * R.pawHz + i * Math.PI);
      l.hip.position.y += (u.hipRest[i] - l.hip.position.y) * rear;
      const hx = hind ? -rx - R.hindHip * rear : -rx * 0.4 - R.foreHip * rear + R.paw * paw * rear, kx = hind ? R.hindKnee : R.foreKnee + 0.4 * paw;
      l.hip.rotation.x += (hx - l.hip.rotation.x) * rear;
      l.knee.rotation.x += (kx - l.knee.rotation.x) * rear;
    }
    if (u.tail) u.tail.rotation.x += (-rx * 0.95 - u.tail.rotation.x) * rear;
    // (where the seat goes, for the rider: actors.js)
    u.seatDy = B.position.y + SEAT[0] * c - SEAT[1] * s - SEAT[0];
    u.seatDz = B.position.z + SEAT[0] * s + SEAT[1] * c - SEAT[1];
    u.seatPitch = rx;
  }
  u.rear = rear;
  if (slide || stumble) {
    // (the trunk turns about the shoulders, or about the hind hips; the legs are counter-turned and take their own pose)
    const S = slide ? SLIDE : STUMBLE, w = slide || stumble, rx = B.rotation.x * (1 - w) + S.pitch * pk * w, c = Math.cos(rx), s = Math.sin(rx);
    B.rotation.x = rx;
    B.position.y = S.py - (S.py * c - S.pz * s) + bob * (1 - w) - S.down * w;
    B.position.z = S.pz - (S.py * s + S.pz * c);
    for (let i = 0; i < 4; i++) {
      const l = u.legs[i], hind = i >= 2;
      l.hip.position.y += (u.hipRest[i] - l.hip.position.y) * w;
      // (the legs that fold do it as much as it takes for the hoof to stay on the ground: leg, above)
      const aim = slide ? (hind ? SLIDE.hindHip : SLIDE.foreHip - (i ? 0.08 : 0)) : hind ? 0 : STUMBLE.foreHip * (i ? 1 : 0.6);
      const hx = l.hip.rotation.x + (-rx - aim - l.hip.rotation.x) * w, at = hx + rx, up = -l.knee.position.y, kz = l.knee.position.z, L = u.hipRest[i] - up, fz = hind ? up * 0.24 : -up * 0.03;
      const hipY = B.position.y + l.hip.position.y * c - l.hip.position.z * s, D = hipY - up * Math.cos(at) - kz * Math.sin(at), A = Math.hypot(L, fz);
      l.hip.rotation.x = hx;
      l.knee.rotation.x += (Math.max(0, Math.atan2(fz, L) + Math.acos(Math.max(-1, Math.min(1, D / A))) - at) - l.knee.rotation.x) * Math.min(1, w * 2);
    }
    if (stumble) B.rotation.z = STUMBLE.roll * w * Math.sin(ak * TAU * STUMBLE.hz);
    else if (B.rotation.z) B.rotation.z = 0;
    u.seatDy = B.position.y + SEAT[0] * c - SEAT[1] * s - SEAT[0];
    u.seatDz = B.position.z + SEAT[0] * s + SEAT[1] * c - SEAT[1];
    u.seatPitch = rx;
  }
  if (shake) {
    // (a roll about the hips' height, the legs counter-rolled so the hooves stay put)
    const r = SHAKE.roll * shake * Math.sin(ak * TAU * SHAKE.hz * HORSE_ACTS.shake), py = REAR.py;
    B.rotation.z = r; B.position.x = py * Math.sin(r); B.position.y += py * (1 - Math.cos(r));
    for (const l of u.legs) l.hip.rotation.z = -r;
  } else if (B.rotation.z && !stumble) { B.rotation.z = 0; B.position.x = 0; for (const l of u.legs) l.hip.rotation.z = 0; }
}
