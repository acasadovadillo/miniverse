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
//
// The horse's breeds (Plan R4-3, horsebreeds.js): the same horse with other proportions (HORSE_BUILD), blended for a mestizo; its
// race is part of animalKey, and its size, the root's scale. The six coats are the same for every breed.
// The wild ones' breeds (Plan R3-2, herds.js breedOf): a deer with none is the stag (its antlers); 'hind' (no antlers, slimmer)
// and 'calf' (white spots on the back); a boar with none is the male (tusks and mane); 'sow', 'piglet' (striped) and 'reddish'
// (the older young). Their size is the root's scale (herds.js scaleOf).
import * as THREE from 'three';
import { mesh, mergeInto, G, M } from './shapes.js';
import { Builder } from './geo.js';
import { sobrio } from '../arte.js';
import { apagada } from '../opciones.js';
import { bridle } from './tack3d.js';
import { raceKey, buildOfKey, sizeOfBuild } from '../horsebreeds.js';

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
export const animalKey = (e, fill = 1) => `${e.type}:${e.breed || ''}:${e.bags ? 1 + fill : 0}${e.type === 'caballo' && e.shod ? ':s' : ''}${e.type === 'caballo' && e.race ? ':' + raceKey(e) : ''}`;
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
// The white spots of a calf, in rows along its back and flanks
const dapples = n => {
  if (n.y < -0.25) return 0;
  const row = Math.atan2(n.x, n.y) * 2.5, col = n.z * 4.6 + Math.floor(row + 0.5) * 0.5, i = Math.floor(row + 0.5), j = Math.round(col);
  const dx = row - i + (hash(i, j, 3) - 0.5) * 0.35, dz = col - j + (hash(j, i, 7) - 0.5) * 0.35;
  return Math.max(0, Math.min(1, (0.34 - Math.hypot(dx, dz)) * 6));
};
// The stripes of a piglet, along the body
const bands = n => (n.y < -0.35 ? 0 : Math.max(0, Math.min(1, (Math.cos(Math.atan2(n.x, n.y) * 5.2 + noise(n.z * 3, 2, 5) * 0.8) - 0.15) * 2.2)) * (1 - sm(0.7, 0.98, Math.abs(n.z))));
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
  for (const [mm, p, o, geo] of pts) { const dy = p[1] - base[1], dz = p[2] - base[2]; mesh(geo || G.ball, mm, { ...o, p: [p[0], dy * c + dz * s, -dy * s + dz * c], r: o.r && [o.r[0] - a0, o.r[1], o.r[2]] }, neck); }
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
// A horseshoe under the hoof (of a leg whose pastern is r2): a flat iron arc, open at the heel, a little wider than the wall
const SHOES = new Map();
function shoeGeo(r2) {
  if (!SHOES.has(r2)) SHOES.set(r2, new THREE.TorusGeometry(r2 * 1.16, r2 * 0.24, 6, 18, Math.PI * 1.56).rotateZ(Math.PI / 2 - Math.PI * 0.78).rotateX(Math.PI / 2).scale(1, 0.62, 1.1));
  return SHOES.get(r2);
}
// The long hair of the fetlocks (the draft horse's; a little, the pony's): a skirt of locks from the cannon over the hoof,
// longer behind. k: how much of it
const FEATHERS = new Map();
function featherGeo(k, r2) {
  const key = k.toFixed(2) + ':' + r2.toFixed(4);
  if (!FEATHERS.has(key)) FEATHERS.set(key, blob(null, 18, (v, n) => {
    const a = Math.atan2(n.x, n.z), back = 0.5 - 0.5 * Math.cos(a), d = (1 - n.y) / 2, lock = 0.86 + 0.28 * noise(Math.cos(a) * 2.6 + 4, Math.sin(a) * 2.6, 3);
    // (from half way up the cannon, close to it, opening over the hoof; the lower edge in points)
    const r = (r2 * 1.06 + r2 * (0.5 + 0.75 * back) * k * d * d * lock) * Math.min(1, Math.sqrt(Math.max(0, 1 - n.y * n.y)) * 2.2);
    v.set(Math.sin(a) * r, 0.12 * k + 0.01 - d * (0.05 + 0.09 * k + 0.04 * k * (0.35 + 0.65 * back) * lock), Math.cos(a) * r - r2 * 0.25 * k * d * back);
  }, n => C.set('#ffffff').multiplyScalar((0.78 + 0.22 * noise(n.x * 6, n.y * 1.5, n.z * 6)) * (0.62 + 0.38 * sm(0.95, 0.1, n.y)))));
  return FEATHERS.get(key);
}
// Una pata con rodilla: su músculo arriba (paletilla o muslo), fina abajo y, en las de atrás (z < 0), con el corvejón hacia
// atrás: el muslo baja hacia atrás y la caña vuelve hacia delante, con el pie debajo de la cadera
function leg(body, legs, { x, y, z, up, low, r0, r1, r2, color, foot, footColor, paw = false, phase = 0, shoe = false, feather = 0, hair = null }) {
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
    if (feather > 0.05) mesh(featherGeo(feather, r2), hair, { p: [0, -low - foot * 0.1, fz] }, knee);
    if (shoe) mesh(shoeGeo(r2), M('#767c83'), { p: [0, -low - foot + 0.0045, fz + r2 * 0.25] }, knee);
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
export function animalModel(type, breed, bags, fill = 1, shod = false, race = '') {
  if (type === 'caballo') return horseModel(breed, bags, true, fill, shod, race);
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
  jabali({ body, legs, u, k, breed }) {
    const baby = breed === 'piglet' || breed === 'reddish', sow = breed === 'sow', fur = breed === 'piglet' ? '#7a5a3c' : breed === 'reddish' ? '#7d5436' : sow ? '#52443a' : '#4a3a2e', dark = breed === 'piglet' ? '#4e3826' : breed === 'reddish' ? '#553a26' : '#2e241c';
    const W = baby ? 0.23 : sow ? 0.26 : 0.27, hump = baby ? 0.01 : sow ? 0.03 : 0.06;
    mesh(blob(k + ':b', 36, (v, n) => { trunk({ L: baby ? 0.44 : 0.48, W, H: baby ? 0.26 : sow ? 0.285 : 0.3, belly: sow ? 0.05 : 0.03, flat: 0 })(v, n); if (n.z > 0) v.y += hump * n.z * Math.max(0, n.y); }, n => {
      C.set(fur).multiplyScalar(0.85 + noise(n.x * 9, n.y * 9, n.z * 9) * 0.3);
      if (breed === 'piglet') C.lerp(C2.set('#d9c096'), bands(n) * 0.85);
      return C;
    }), WHITE, { p: [0, 0.48, 0] }, body);
    if (baby) mesh(G.ball, M(dark), { p: [0, 0.71, 0], s: [0.035, 0.03, 0.26] }, body);   // (the dark line of the back)
    if (!baby) for (let i = 0; i < (sow ? 5 : 7); i++) mesh(G.cone, M(dark), { p: [0, 0.8 - i * 0.015, 0.25 - i * 0.09], s: sow ? [0.03, 0.065, 0.05] : [0.035, 0.1, 0.05], r: [-0.3, 0, 0] }, body);   // crin del lomo
    const head = new THREE.Group(); head.position.set(0, 0.5, baby ? 0.4 : 0.46); if (baby) head.scale.setScalar(1.12); body.add(head); u.head = head;
    mesh(blob(k + ':h', 24, (v, n) => v.set(n.x * 0.16 * (1 - 0.45 * Math.max(0, n.z)), n.y * 0.16 * (1 - 0.35 * Math.max(0, n.z)), n.z * 0.28), n => C.set(fur).multiplyScalar(0.9 + noise(n.x * 8, n.y * 8, n.z * 8) * 0.2)), WHITE, { p: [0, -0.02, 0.1] }, head);
    mesh(G.cyl, M(dark), { p: [0, -0.04, 0.37], s: [0.055, 0.04, 0.05], r: [Math.PI / 2, 0, 0] }, head);
    for (const s of [-1, 1]) { if (!baby) tube(M('#f0ead8'), [s * 0.06, -0.06, 0.3], sow ? [s * 0.075, -0.03, 0.325] : [s * 0.1, 0.02, 0.36], sow ? 0.009 : 0.014, 0.004, head, 6); mesh(G.cone, M(dark), { p: [s * 0.1, 0.15, -0.02], s: [0.045, 0.09, 0.03], r: [0, 0, s * -0.2] }, head); }
    eyes(head, 0.085, 0.06, 0.13, 0.016);
    const tail = new THREE.Group(); tail.position.set(0, 0.56, -0.48); body.add(tail); u.tail = tail;
    tube(M(dark), [0, 0, 0], [0, -0.16, -0.03], 0.015, 0.008, tail, 6);
    [[-0.15, 0.27], [0.15, 0.27], [-0.15, -0.27], [0.15, -0.27]].forEach(([x, z], i) => leg(body, legs, { x, y: 0.3, z, up: 0.15, low: 0.12, r0: 0.065, r1: 0.045, r2: 0.035, color: dark, foot: 0.04, phase: TROT[i] }));
  },
  ciervo({ body, legs, u, k, breed }) {
    const calf = breed === 'calf', hind = breed === 'hind', fur = calf ? '#a5713e' : hind ? '#94683e' : '#9a6a3a';
    mesh(blob(k + ':b', calf ? 64 : 36, trunk({ L: calf ? 0.44 : 0.48, W: calf ? 0.205 : hind ? 0.22 : 0.24, H: calf ? 0.22 : hind ? 0.24 : 0.26, belly: hind ? 0.045 : 0.03 }), coat(fur, { back: 0.18, belly: '#e8dcc0', ...(calf ? { spot: '#efe4cc', spots: dapples } : {}) })), WHITE, { p: [0, 0.98, 0] }, body);
    mesh(G.ball, M('#f4ecdc'), { p: [0, 1.0, -0.47], s: [0.12, 0.14, 0.06] }, body);   // el culo blanco
    const head = new THREE.Group(); head.position.set(0, 1.45, 0.62); body.add(head); u.head = head;
    neckRig(body, u, M(fur), [0, 1.05, 0.38], [0, 1.45, 0.62], calf ? 0.1 : hind ? 0.115 : 0.14, calf ? 0.07 : hind ? 0.072 : 0.08, 12, { beta: 1.1, S: [-0.05, 0.29] });
    if (calf) head.scale.setScalar(1.15);
    mesh(blob(k + ':h', 24, (v, n) => v.set(n.x * 0.1 * (1 - 0.35 * Math.max(0, n.z)), n.y * 0.11 * (1 - 0.2 * Math.max(0, n.z)), n.z * 0.2), n => coat(fur, { back: 0.1 })(n)), WHITE, { p: [0, 0, 0.08] }, head);
    mesh(G.ball, M('#1a1414'), { p: [0, -0.03, 0.28], s: [0.03, 0.025, 0.02] }, head);
    for (const s of [-1, 1]) {
      mesh(G.ball, M(fur), { p: [s * 0.13, 0.08, -0.02], s: calf || hind ? [0.095, 0.034, 0.05] : [0.08, 0.03, 0.045], r: [0, 0, s * 0.4] }, head);
      if (calf || hind) continue;
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
// A wounded wild animal (Plan G §8.2; wildlife.js sets e.lying and e.limp, 0..1, and sends them). Bedded: the belly on the
// ground, the front legs folded with the knees forward and the hooves tucked back, the hind ones folded under the belly
// (how far the body goes down and [hip, knee] angles, front and hind, worked out from each build's leg lengths so that
// knees and shins lie on the ground); head up, slow deep breaths, a look around now and then, and the head lower as its hp
// falls (limp grows with the missing hp). Limping: the back right leg swings less and the body dips and rolls on that
// step. Only the existing rig moves: no new meshes
const BED = { ciervo: [0.69, [-1.34, 2.87], [-1.6, 3.42]], jabali: [0.15, [-0.83, 2.37], [-1.05, 2.91]] };
const LIMP_SWING = 0.6, LIMP_DIP = 0.05, LIMP_ROLL = 0.07;
// (st: a horse's trick or shake and how winded it is, from actors.js: see animateHorse)
// On its guard (Plan R3 §5; wildlife.js: e.alert 1 alert, 3 tense, 2 alarm, e.staring, e.stareYaw, e.flag, e.stamp): the head
// high and turned to whoever it is, the neck up, the tail up and white as it runs (flag), in bounds; tense, a deer stamps a
// forefoot (e.stamp 0..1). And a dog's point (e.pointing: stiff, the head level, the tail straight out, a paw lifted) and its
// heel (e.dogK -1: the head low, the tail still). Only the existing rig: no new meshes
const NECK_UP = -0.22, HEAD_TURN = 1.25, FLAG_UP = 2.4, POINT_TAIL = -0.95;
function onGuard(m, u, e, k, t, dt) {
  const { head, tail, legs, body, type } = u, want = e.staring || e.alert ? 1 : 0;
  if (want || u.al > 0) {
    const al = u.al = (u.al || 0) + (want - (u.al || 0)) * Math.min(1, dt * 7);
    if (al < 1e-3) { u.al = 0; if (tail) tail.scale.setScalar(1); return; }
    if (head) {
      let turn = 0;
      if (e.staring) { turn = (e.stareYaw || 0) - m.root.rotation.y; turn = Math.max(-HEAD_TURN, Math.min(HEAD_TURN, Math.atan2(Math.sin(turn), Math.cos(turn)))); }
      u.ty = (u.ty ?? head.rotation.y) + (turn - (u.ty ?? head.rotation.y)) * Math.min(1, dt * 6);
      head.rotation.y = head.rotation.y * (1 - al) + u.ty * al;
      head.rotation.x += (-0.1 - head.rotation.x) * al;
      if (u.rig) neckPose(u, u.g || 0, NECK_UP * al);
    }
    if (tail) {
      const f = u.fl = (u.fl || 0) + ((e.flag ? 1 : 0) - (u.fl || 0)) * Math.min(1, dt * 8);
      if (type === 'ciervo') { tail.rotation.x += (FLAG_UP - tail.rotation.x) * f; tail.rotation.z *= 1 - al * (1 - f); tail.scale.setScalar(1 + 0.8 * f); }
      else tail.rotation.z *= 1 - al;
    }
    // (bounding: higher and rocking, one long leap after another)
    if (u.fl > 0.2 && k > 0.9 && type === 'ciervo') { const b = Math.sin(m.phase * 0.5); body.position.y += Math.abs(b) * 0.22 * u.fl; body.rotation.x = Math.cos(m.phase * 0.5) * Math.sign(b) * -0.12 * u.fl; }
    if (e.stamp > 0 && e.stamp < 1 && k < 0.2 && legs.length === 4) {
      const s = e.stamp, up = s < 0.65 ? Math.sin(s / 0.65 * Math.PI / 2) : Math.max(0, 1 - (s - 0.65) / 0.12);
      legs[1].hip.rotation.x -= 0.75 * up; legs[1].knee.rotation.x += 1.25 * up;
    }
  } else u.ty = undefined;
}
function dogOut(u, e, dt) {
  const { head, tail, legs, body } = u, want = e.pointing ? 1 : 0, heel = e.dogK === -1 ? 1 : 0;
  if (!(want || heel || u.po > 0 || u.he > 0)) return;
  const p = u.po = (u.po || 0) + (want - (u.po || 0)) * Math.min(1, dt * 6), h = u.he = (u.he || 0) + (heel - (u.he || 0)) * Math.min(1, dt * 5);
  if (p < 1e-3) u.po = 0;
  if (h < 1e-3) u.he = 0;
  const s = Math.max(p, h);
  if (tail) { tail.rotation.z *= 1 - s; tail.rotation.x = tail.rotation.x * (1 - s) + POINT_TAIL * p - 1.6 * h * (1 - p); }
  if (head) { head.rotation.y *= 1 - p; head.rotation.x += (0.06 * p + 0.3 * h * (1 - p) - head.rotation.x) * s; }
  if (p && legs.length === 4) { legs[1].hip.rotation.x += (-0.95 - legs[1].hip.rotation.x) * p; legs[1].knee.rotation.x += (1.7 - legs[1].knee.rotation.x) * p; body.rotation.x += 0.05 * p; }
}
export function animateAnimal(m, dt, t, e, st = null) {
  const u = m.root.userData;
  if (u.horse) { animateHorse(m.root, m.speed, t, e, dt, e?.lead ? e.leadGait : undefined, st); return; }   // (led by the reins, its gait: horselead.js)
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
  // (limping: the bad leg barely swings; while it bears the weight, the body sinks and rolls towards it)
  const limp = e?.limp > 0 && legs.length === 4 ? Math.min(1, e.limp) * k : 0, bear = limp ? Math.max(0, -Math.sin(m.phase + legs[3].phase)) * limp : 0;
  if (limp) { legs[3].hip.rotation.x *= 1 - LIMP_SWING * limp; legs[3].knee.rotation.x *= 1 - LIMP_SWING * 0.6 * limp; }
  body.position.y = Math.abs(Math.sin(m.phase)) * (type === 'conejo' ? 0.1 : 0.025) * k - bear * LIMP_DIP;
  body.rotation.z = type === 'pato' ? Math.sin(m.phase) * 0.12 * k : -bear * LIMP_ROLL;   // el pato se bambolea
  body.scale.set(1, e?.sleep ? 0.62 : 1, 1);   // durmiendo, hecho una bola
  if (tail) tail.rotation.set(type === 'perro' ? -0.3 : 0, 0, Math.sin(t * (type === 'perro' ? 12 : 2.2) + u.seed) * (type === 'perro' ? 0.5 : type === 'vaca' || type === 'ciervo' ? 0.35 : 0.15));
  if (e?.sleep) { body.position.y = 0; body.rotation.x = 0; if (head) head.rotation.x = 0.3; return; }
  // Pastando (ranch.js y wildlife.js, e.grazing): bajan el cuello y la cabeza hasta la hierba y mordisquean; si no, miran a
  // un lado y a otro
  if (head) {
    const g = graze(u, e, k, dt), bite = g * (Math.sin(t * 7 + u.seed) * 0.05 + Math.max(0, Math.sin(t * 0.8 + u.seed)) * 0.04);
    if (u.rig) neckPose(u, g);
    head.rotation.x += ((u.rig ? u.rig.hr * g : g * 0.6) + bite - head.rotation.x) * Math.min(1, dt * 3);
    if (!u.al) head.rotation.y = Math.sin(t * 0.6 + u.seed * 2) * 0.25 * (1 - k) * (1 - g * 0.7);
  }
  if (type === 'gallina' || type === 'pato') body.rotation.x = k ? Math.sin(m.phase * 2) * 0.08 : Math.max(0, Math.sin(t * 1.3 + m.phase) - 0.7) * 1.2;   // picotea
  else if (type === 'cerdo' && e?.digging) body.rotation.x = 0.25 + Math.sin(t * 9) * 0.06;   // hoza
  else body.rotation.x = Math.sin(t * 0.8 + m.phase) * 0.01;
  body.scale.x = body.scale.z = 1 + Math.sin(t * 2 + u.seed) * 0.01 * (1 - k);   // respira
  if (e?.alert || e?.staring || u.al > 0) onGuard(m, u, e, k, t, dt);
  if (type === 'perro' && e) dogOut(u, e, dt);
  // (bedded: eased in and out over about a second, so getting up and lying down are seen)
  const bed = BED[type], want = (e?.lying || e?.bedded) && bed ? 1 : 0;
  if (want || u.lie > 0) {
    const lie = u.lie = (u.lie || 0) + (want - (u.lie || 0)) * Math.min(1, dt * 1.6);
    if (lie < 1e-3) { u.lie = 0; return; }
    for (const l of legs) { const b = bed[l.hip.position.z < 0 ? 2 : 1]; l.hip.rotation.x += (b[0] - l.hip.rotation.x) * lie; l.knee.rotation.x += (b[1] - l.knee.rotation.x) * lie; }
    body.position.y = body.position.y * (1 - lie) - bed[0] * lie;
    body.rotation.x *= 1 - lie; body.rotation.z *= 1 - lie;
    body.scale.x = body.scale.z = 1 + Math.sin(t * 1.3 + u.seed) * 0.025 * lie;   // (slow, deep breaths)
    if (head && !(u.al > 0.05)) {   // (on its guard, it looks at whoever it is: onGuard)
      const up = -0.12 + Math.min(1, e?.limp || 0) * 0.8, look = Math.sin(t * 0.45 + u.seed * 3) > 0.85 ? Math.sin(t * 0.9 + u.seed) * 0.6 : 0;
      head.rotation.x += (up - head.rotation.x) * lie;
      head.rotation.y += (look - head.rotation.y) * lie;
    }
  }
}

// ---------- el caballo ----------
// What each breed is like, by an Español's (the base: the horse of always, to the last vertex). L, W, H: the trunk's half length,
// width and height, by its middle; belly, chest, hips as trunk() has them; neck: where it starts and ends (y, z) and its two
// radii; head: how big; dish: the profile (hollow, or Roman under 0); muzzle, ear, eye, brow (the forelock); bone: how thick the legs are, muscle:
// their upper part; legX, how far apart; mane: how much of it hangs on both sides; lock: how long it is; tail: how thick, dock: how
// high it is carried, tlen: how long; feather: the hair of the fetlocks. The legs are as long in all of them (their hips are
// where the gaits and the tricks turn about): how tall it is, the whole model's size (horsebreeds.js)
const HORSE_BASE = { L: 0.56, W: 0.26, H: 0.29, by: 0.88, belly: 0.03, chest: 0.06, hips: 0.09, withers: 0.14, n0y: 0.9, n0z: 0.34, n1y: 1.38, n1z: 0.76, r0: 0.15, r1: 0.075, head: 1, dish: 0, muzzle: 1, ear: 1, eye: 1, brow: 1, bone: 1, muscle: 1, legX: 0.16, mane: 0, lock: 1, tail: 1, dock: 0, tlen: 1, feather: 0 };
const HORSE_BUILD = {
  arabe: { L: 0.535, W: 0.235, H: 0.268, by: 0.895, belly: -0.005, chest: 0.045, hips: 0.08, n1y: 1.45, n1z: 0.755, r0: 0.128, r1: 0.062, head: 0.92, dish: 1, muzzle: 0.8, ear: 0.9, eye: 1.25, bone: 0.86, muscle: 0.92, legX: 0.145, mane: 0.35, lock: 1.25, tail: 0.95, dock: 1, tlen: 1.06 },
  breton: { L: 0.6, W: 0.325, H: 0.37, by: 0.825, belly: 0.05, chest: 0.1, hips: 0.17, withers: 0.1, n0y: 0.905, n0z: 0.36, n1y: 1.345, n1z: 0.775, r0: 0.2, r1: 0.115, head: 1.17, dish: -0.7, muzzle: 1.25, ear: 0.95, brow: 1.2, bone: 1.42, muscle: 1.4, legX: 0.19, mane: 0.8, lock: 1.05, tail: 1.5, tlen: 0.8, feather: 1 },
  asturcon: { L: 0.55, W: 0.3, H: 0.325, by: 0.845, belly: 0.085, chest: 0.055, hips: 0.11, withers: 0.1, n1y: 1.31, n1z: 0.71, r0: 0.16, r1: 0.092, head: 1.1, dish: 0.15, muzzle: 1.05, ear: 0.8, brow: 1.7, bone: 1.08, muscle: 1.1, legX: 0.165, mane: 1, lock: 1.1, tail: 1.35, dock: -0.15, tlen: 1.08, feather: 0.28 },
};
const SHAPES = new Map();
function horseShape(race) {
  if (!SHAPES.has(race)) {
    const w = buildOfKey(race), P = { ...HORSE_BASE };
    for (const r in HORSE_BUILD) if (w[r]) for (const k in HORSE_BUILD[r]) P[k] += w[r] * (HORSE_BUILD[r][k] - HORSE_BASE[k]);
    P.wk = P.W / HORSE_BASE.W; P.dy = P.by + P.H * 0.9 - (HORSE_BASE.by + HORSE_BASE.H * 0.9); P.size = sizeOfBuild(w);
    SHAPES.set(race, P);
  }
  return SHAPES.get(race);
}
// The mane: the horse of always', on the crest; a breed's, a sheet of hair from the crest down both sides of the neck (mane: how
// far round; to one side, longer), its edge in locks. In the neck's own space (y along it, -z its crest)
const MANES = new Map();
function maneGeo(P, race) {
  if (MANES.has(race)) return MANES.get(race);
  const L = Math.hypot(P.n1y - P.n0y, P.n1z - P.n0z), NS = 34, NA = 16, pos = [], col = [], idx = [], m = P.mane;
  for (let i = 0; i <= NS; i++) {
    const t = i / NS, s = 0.1 + 0.93 * t, r = P.r0 + (P.r1 - P.r0) * Math.min(1, s), end = sm(0, 0.08, t) * (1 - sm(0.95, 1, t) * 0.6);
    for (let j = 0; j <= NA; j++) {
      const q = j / NA * 2 - 1, sd = q < 0 ? -1 : 1, lock = 0.74 + 0.42 * noise(t * 13 + sd * 7, sd * 2.5, 1.5), side = sd > 0 ? 1 : 0.55 + 0.45 * m;
      const far = (0.5 + 1.35 * m) * P.lock * side * lock * (0.8 + 0.2 * (1 - t)), phi = q * far * (0.25 + 0.75 * end);
      const qa = Math.abs(q), strand = 0.72 + 0.38 * noise(t * 24 + qa * 2.5, sd * 3 + qa, 8) + 0.26 * noise(t * 57 + qa * 4, sd * 5, 3), thick = ((0.02 + 0.024 * m) * (1 - 0.8 * qa ** 1.8) + 0.004) * strand * (0.25 + 0.75 * end);
      const R = qa > 0.99 ? r * 0.95 : r * 0.985 + thick + 0.012 * Math.max(0, 1 - qa * 4);   // (its edge, into the neck)
      pos.push(Math.sin(phi) * R, L * (s - 0.09 * qa * qa * m), -Math.cos(phi) * R);
      const k = 0.8 + 0.28 * noise(t * 46 + qa * 3, sd * 3 + 5, 2); col.push(k, k, k);
    }
  }
  for (let i = 0; i < NS; i++) for (let j = 0; j < NA; j++) { const n = i * (NA + 1) + j; idx.push(n, n + NA + 1, n + 1, n + 1, n + NA + 1, n + NA + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  MANES.set(race, g);
  return g;
}
function maneOf(P, race, mane) {
  if (!race) return Array.from({ length: 6 }, (_, i) => [mane, [0, 1.06 + i * 0.065, 0.4 + i * 0.055], { s: [0.045, 0.08, 0.07], r: [0.6, 0, 0] }]);
  return [[mane, [0, P.n0y, P.n0z], { r: [Math.atan2(P.n1z - P.n0z, P.n1y - P.n0y), 0, 0] }, maneGeo(P, race)]];
}
// A breed's tail: the dock thin, the hair full in the middle and thin at its end, in strands; carried high, it rises before it falls
const TAILS = new Map();
function tailGeo(P, race) {
  if (TAILS.has(race)) return TAILS.get(race);
  const hi = Math.max(0, P.dock), lo = Math.min(0, P.dock), tl = P.tlen, V = (y, z) => new THREE.Vector3(0, y, z);
  const tc = new THREE.CatmullRomCurve3([V(0, 0.02), V(-0.05 + 0.1 * hi, -0.075 - 0.02 * hi), V((-0.2 + 0.2 * hi) * tl, -0.14 - 0.09 * hi + 0.04 * lo), V((-0.44 + 0.14 * hi) * tl, -0.165 - 0.15 * hi + 0.06 * lo), V((-0.68 + 0.05 * hi) * tl, -0.15 - 0.14 * hi + 0.06 * lo)]);
  const N = 26, M = 12, g = new THREE.TubeGeometry(tc, N, 1, M), p = g.attributes.position, col = new Float32Array(p.count * 3), v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    const t = i / N, rad = (0.034 + 0.03 * sm(0.05, 0.5, t) * P.tail) * (1 - 0.86 * sm(0.6, 1, t) ** 1.4) * (0.6 + 0.4 * Math.min(1, P.tail));
    tc.getPointAt(t, c);
    for (let j = 0; j <= M; j++) {
      const n = i * (M + 1) + j, a = (j % M) / M * Math.PI * 2, st = noise(Math.cos(a) * 3 + 2, Math.sin(a) * 3, t * 2.2 + 6);
      v.fromBufferAttribute(p, n).sub(c).multiplyScalar(rad * (0.78 + 0.5 * st)).add(c); p.setXYZ(n, v.x, v.y - 0.05 * tl * st * sm(0.7, 1, t), v.z);
      col.fill(0.74 + 0.36 * st, n * 3, n * 3 + 3);
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.deleteAttribute('uv'); g.computeVertexNormals();
  TAILS.set(race, g);
  return g;
}
// The bridle (tack3d.js), on the head; u.bits (its rings, the horse's left first) and u.chin (where the lead rope goes), in the head,
// and u.neckR, how thick the neck is half way: what the reins and the rope need (reins3d.js)
const NO_REINS = apagada('riendas'), HEAD_AT = new THREE.Matrix4().makeRotationX(0.6).setPosition(0, -0.06, 0.12);
function bridleOn(head, u, shape, race, P) {
  const B = bridle(shape, race);
  for (const [g, c] of B.parts) mesh(g, M(c, { roughness: 0.7 }), { p: [0, -0.06, 0.12], r: [0.6, 0, 0] }, head);
  u.bits = B.bits.map(q => q.clone().applyMatrix4(HEAD_AT)); u.chin = B.chin.clone().applyMatrix4(HEAD_AT);
  u.neckR = (P.r0 + P.r1) / 2;
}
// También el del jinete: con su pelaje, la silla con su manta y los estribos y, si las tiene, las alforjas
// (fill: how full the saddlebags look, 0 flat, 1 half, 2 bulging; see saddlebags. shod: with its shoes on, iron under the hooves.
// race: its breed's key, horsebreeds.js raceKey). u.size: how big the whole is by an Español's (whoever shows it scales it); u.dy and
// u.wk: how much higher its back is, and how much wider it is (the rider, the bags and the load)
export function horseModel(breed = 'castano', bags = false, alone = false, fill = 1, shod = false, race = '') {
  const P = horseShape(race);
  const root = new THREE.Group(), body = new THREE.Group(), legs = [], u = { body, legs, type: 'caballo', horse: alone, seed: Math.random() * 10, size: P.size, dy: P.dy, wk: P.wk, tailUp: 0.3 * Math.max(0, P.dock) };
  root.add(body);
  const [cb, cd, cl] = coatOf('caballo', breed), k = `caballo:${breed}${race && ':' + race}`, mane = M(cl || cd), pio = breed === 'pio', { dy, wk } = P;
  mesh(blob(k + ':b', pio || breed === 'tordo' ? 64 : 40, trunk({ L: P.L, W: P.W, H: P.H, belly: P.belly, chest: P.chest, hips: P.hips, withers: P.withers }), coat(cb, { back: 0.12, spot: cd, spots: pio ? patches(2, 5.5, 0.55) : breed === 'tordo' ? (n => noise(n.x * 9, n.y * 9, n.z * 9) > 0.62 ? 0.45 : 0) : null })), WHITE, { p: [0, P.by, 0] }, body);
  // Cuello y cabeza, con la crin
  const head = new THREE.Group(); head.position.set(0, P.n1y, P.n1z); body.add(head); u.head = head;
  neckRig(body, u, M(cb), [0, P.n0y, P.n0z], [0, P.n1y, P.n1z], P.r0, P.r1, 14, { beta: 0.95, S: [-0.24, 0.36] }, maneOf(P, race, mane));   // (la crin, con el cuello)
  const morro = M(cl && breed === 'palomino' ? cb : breed === 'blanco' ? '#d8cfc4' : mixc(cb, '#000000', 0.25).getStyle()), mz = P.muzzle;
  // La cabeza larga, en cuña: ancha en la frente y las quijadas y estrecha hacia el morro, con los ojos a los lados
  // (its profile, hollow under the eyes or rounded: dish)
  const headShape = (v, n) => { const f = (n.z + 1) / 2, jaw = Gs(n.z + 0.45, 0.3) * Math.max(0, -n.y); v.set(n.x * (0.085 - (0.03 + 0.008 * Math.max(0, P.dish) - 0.055 * Math.max(0, mz - 1)) * f + 0.02 * jaw), n.y * (0.105 - (0.04 - 0.06 * Math.max(0, mz - 1)) * f) - 0.03 * jaw + P.dish * Math.max(0, n.y) * (0.012 * Gs(n.z + 0.45, 0.25) - 0.022 * Gs(n.z - 0.2, 0.28)), n.z * 0.3); };
  mesh(blob(k + ':h', 28, headShape, n => coat(cb, { back: 0.06 })(n)), WHITE, { p: [0, -0.06, 0.12], r: [0.6, 0, 0] }, head);
  if (!NO_REINS) bridleOn(head, u, headShape, race, P);
  mesh(G.ball, morro, { p: [0, -0.2, 0.31], s: [0.052 * Math.min(mz, 1.1), 0.05 * Math.min(mz, 1.1), 0.07 * (0.6 + 0.4 * mz)], r: [0.6, 0, 0] }, head);   // el morro
  if (breed === 'blanco' || breed === 'tordo' || breed === 'palomino' || pio) mesh(G.ball, M('#f8f4ee'), { p: [0, -0.057 - 0.02 * P.dish, 0.243 - 0.014 * P.dish], s: [0.028, 0.012, 0.085], r: [0.76, 0, 0] }, head);   // the blaze, lying on the face
  for (const s of [-1, 1]) {
    mesh(G.cone, M(cb), { p: [s * 0.045, 0.1, -0.06], s: [0.025, 0.08 * P.ear, 0.02], r: [-0.25, 0, -s * 0.12] }, head);
    mesh(G.ball, M('#2a1a14'), { p: [s * 0.026 * mz, -0.205, 0.345], s: [0.012, 0.015, 0.012], r: [0.6, 0, 0] }, head);   // ollares
  }
  mesh(G.ball, mane, race ? { p: [0, 0.07, 0.02], s: [0.032, 0.03, 0.05] } : { p: [0, 0.08, 0.02], s: [0.035, 0.045, 0.055] }, head);   // el flequillo
  if (race) mesh(G.ball, mane, { p: [0, 0.04 - 0.012 * (P.brow - 1), 0.075 + 0.02 * (P.brow - 1)], s: [0.026 * P.brow, 0.02, 0.05 + 0.035 * (P.brow - 1)], r: [0.66, 0, 0] }, head);   // (and down the forehead, as long as the breed has it)
  eyes(head, 0.075, 0.0, 0.07, 0.024 * P.eye);
  if (P.head !== 1) head.scale.setScalar(P.head);
  // Silla: manta, asiento con borrén, estribos; alforjas a los lados
  const saddle = M('#6a2a1e'), blanket = M('#3a5a8a'), steel = M('#b8c0c8', { metalness: 0.6, roughness: 0.35 });
  mesh(G.cyl, blanket, { p: [0, 1.13 + dy, -0.02], s: [0.3 * wk, 0.025, 0.34] }, body);
  mesh(blob('silla', 20, (v, n) => v.set(n.x * 0.2, n.y * 0.05 + (Math.abs(n.z) > 0.6 && n.y > 0 ? 0.04 * (Math.abs(n.z) - 0.6) * 4 : 0), n.z * 0.24), () => C.set('#ffffff')), saddle, { p: [0, 1.16 + dy, -0.02], s: [(1 + wk) / 2, 1, 1] }, body);
  for (const s of [-1, 1]) { const x = race ? s * (P.W * 1.06 + 0.02) : s * 0.26; tube(M('#4a2a1a'), [s * 0.2 * wk, 1.15 + dy, 0.02], [x, 0.86 + dy, 0.04], 0.008, 0.008, body, 4); mesh(new THREE.TorusGeometry(0.035, 0.008, 4, 10), steel, { p: [x, 0.84 + dy, 0.04], r: [0, Math.PI / 2, 0] }, body); }
  if (bags) saddlebags(body, fill, 0.2 * (wk - 1), dy);
  // La cola, larga (carried high, its breed's: it rises before it falls)
  const tail = new THREE.Group(); if (race) tail.position.set(0, P.by + P.H * 0.44, -P.L * 0.89); else tail.position.set(0, 1.04, -0.56); body.add(tail); u.tail = tail;
  if (race) { mesh(tailGeo(P, race), mane, {}, tail); mesh(G.ball, M(cb), { p: [0, 0.005, 0], s: [0.055, 0.05, 0.065] }, tail); }
  else {
    const tc = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.1, -0.12), new THREE.Vector3(0, -0.4, -0.18), new THREE.Vector3(0, -0.62, -0.14)]);
    tail.add(new THREE.Mesh(new THREE.TubeGeometry(tc, 12, 0.05, 8), mane));
    mesh(G.ball, mane, { p: [0, -0.6, -0.14], s: [0.06, 0.08, 0.06] }, tail);
  }
  const hair = P.feather > 0.05 ? M(mixc(cb, '#e2d4b8', breed === 'negro' ? 0.16 : 0.42).getStyle(), { roughness: 0.95 }) : null;
  [[-1, 0.38], [1, 0.38], [-1, -0.38], [1, -0.38]].forEach(([x, z], i) => leg(body, legs, { x: x * P.legX, y: 0.72, z, up: 0.36, low: 0.29, r0: 0.085 * P.muscle, r1: 0.05 * P.bone, r2: 0.04 * P.bone, color: cb, shoe: shod, foot: 0.07, footColor: breed === 'blanco' ? '#5a5048' : '#2a2420', phase: TROT[i], feather: P.feather, hair }));
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
// (dx, dy: how much further out its flanks are and how much higher its back, its breed's)
function saddlebags(body, fill, dx = 0, dy = 0) {
  const f = Math.max(0, Math.min(2, fill | 0));
  for (const s of [-1, 1]) for (const [g, c] of bagParts(s, f)) mesh(g, M(c, { roughness: 0.8 }), { p: [s * dx, dy, 0] }, body);
  for (const [g, c] of rollParts()) mesh(g, M(c, { roughness: 0.9 }), { p: [0, dy, 0] }, body);
}

// ---------- the horse's mud ----------
// Ridden, the horse gets muddy (horse.js: a.dirt, or the rider's p.horseDirt, 0..1): darker and speckled on the lower
// legs, under the belly and in the elbows, as if splashed from below. How muddy each part can get is baked into the
// geometry when the model is made (aDirt, from where each vertex is at rest, so it never slides on a moving leg; its
// whole part is a seed for the speckle, so the four legs do not get the same spots); how muddy the horse is now is one
// uniform, uDirt, on the horse's own copy of the merged vertex-colour material. One program for every horse (a fixed
// customProgramCacheKey; Three runs onBeforeCompile once per material, each with its own uniform). With uDirt at 0 the
// branch is skipped: a clean horse costs a uniform test per fragment
// How it is looked after shows the same way (Plan R4-2, horsecare.js looks): uThin, hungry (the flanks hollow, the belly drawn
// up and the ribs marked, by aThin: how far each vertex of the trunk moves in and up, and how much of a rib it is; a duller
// coat), and uShine, clean, fed and brushed (a glossy coat)
const DIRT_VERT_DECL = 'attribute float aDirt;\nattribute vec3 aThin;\nuniform float uThin;\nvarying float vDirt;\nvarying vec3 vDirtP;\nvarying vec2 vThin;';
const DIRT_VERT = 'float dSeed = floor(aDirt * 0.5); vDirt = aDirt - 2.0 * dSeed; vDirtP = position + dSeed * vec3(3.7, 1.9, 5.3); vThin = vec2(abs(aThin.x) * 22.0, aThin.z); transformed.xy += aThin.xy * uThin;';
const DIRT_FRAG_DECL = `uniform float uDirt;
uniform float uThin;
uniform float uShine;
varying vec2 vThin;
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
const CARE_FRAG = `if (uShine > 0.0) diffuseColor.rgb = max(vec3(0.0), mix(vec3(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11))), diffuseColor.rgb, 1.0 + 0.16 * uShine)) * (1.0 - 0.06 * uShine);
if (uThin > 0.0) {
  float rib = vThin.y * (0.5 + 0.5 * sin(vDirtP.z * 74.0 + vDirtP.y * 9.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11))), 0.22 * uThin) * (1.0 - uThin * (0.26 * vThin.x + 0.34 * rib));
}
`;
// (the gloss is broken up by the lie of the hair)
const CARE_ROUGH = `if (uShine > 0.0) roughnessFactor *= 1.0 - uShine * (0.16 + 0.26 * hdNoise(vDirtP * vec3(22.0, 60.0, 22.0)));
roughnessFactor = min(1.0, roughnessFactor + 0.2 * uThin);`;
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
// The horse's copy of base (its merged material), reading U.value as uDirt and care (thin, shine) as how it is looked after
function dirtMaterial(base, U, care = { thin: { value: 0 }, shine: { value: 0 } }) {
  const m = base.clone();
  m.onBeforeCompile = sh => {
    sh.uniforms.uDirt = U; sh.uniforms.uThin = care.thin; sh.uniforms.uShine = care.shine;
    const v = sh.vertexShader.replace('#include <common>', `#include <common>\n${DIRT_VERT_DECL}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${DIRT_VERT}`);
    const f = sh.fragmentShader.replace('#include <common>', `#include <common>\n${DIRT_FRAG_DECL}`).replace('#include <color_fragment>', `#include <color_fragment>\n${CARE_FRAG}${DIRT_FRAG}`).replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${CARE_ROUGH}`);
    // (all or nothing: a half-patched shader would not compile)
    if (v === sh.vertexShader || !f.includes('uDirt > 0.0') || !f.includes('varying float vDirt') || !f.includes(CARE_ROUGH)) { if (!dirtWarned) { dirtWarned = true; console.warn('Miniverse: the horse mud could not hook the shader (drawn clean)'); } return; }
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
// How far a vertex of the trunk goes in and up when it is thin, and how much of a rib it is (where it is at rest)
function thinOf(x, y, z, out, i) {
  const side = sm(0.06, 0.15, Math.abs(x)), hollow = side * Gs(z + 0.24, 0.11) * sm(0.7, 0.8, y) * (1 - sm(0.94, 1.08, y)), tuck = (1 - sm(0.66, 0.84, y)) * Gs(z + 0.2, 0.2);
  out[i] = -Math.sign(x) * 0.045 * hollow; out[i + 1] = 0.075 * tuck;
  out[i + 2] = side * Gs(z - 0.02, 0.17) * sm(0.7, 0.8, y) * (1 - sm(0.94, 1.04, y));
}
const DV = new THREE.Vector3(), DN = new THREE.Vector3(), DM3 = new THREE.Matrix3();
function dirtify(root, u) {
  root.updateMatrixWorld(true);
  let base = null, seed = 0;
  root.traverse(o => {
    if (!o.isMesh || !o.material.vertexColors || o.material.map || !u.geos.includes(o.geometry)) return;
    base ||= o.material;
    const g = o.geometry, P = g.attributes.position, N = g.attributes.normal, a = new Float32Array(P.count), s = 2 * (seed++ % 16), thin = new Float32Array(P.count * 3), trunk = o.parent === u.body;
    DM3.getNormalMatrix(o.matrixWorld);
    for (let i = 0; i < P.count; i++) {
      DV.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld); DN.fromBufferAttribute(N, i).applyMatrix3(DM3).normalize();
      a[i] = s + Math.min(1, dirtMask(DV.x, DV.y, DV.z, DN.y));
      if (trunk) thinOf(DV.x, DV.y, DV.z, thin, i * 3);
    }
    g.setAttribute('aDirt', new THREE.BufferAttribute(a, 1));
    g.setAttribute('aThin', new THREE.BufferAttribute(thin, 3));
  });
  if (!base) return;
  u.dirtU = { value: 0 };
  u.careU = { thin: { value: 0 }, shine: { value: 0 } };
  u.dirtMat = dirtMaterial(base, u.dirtU, u.careU);
  root.traverse(o => { if (o.isMesh && o.material === base) o.material = u.dirtMat; });
}
// How muddy the horse looks now (0..1): a uniform, never a rebuild
export function setHorseDirt(root, v) {
  const U = root?.userData?.dirtU;
  if (!U) return;
  v = v > 0 ? (v < 1 ? v : 1) : 0;
  if (Math.abs(U.value - v) > 0.004 || (v === 0 && U.value !== 0)) U.value = v;
}
// How it is looked after, as it shows (horsecare.js looks: 0..1 each): two uniforms, eased
export function setHorseCare(root, thin, shine) {
  const U = root?.userData?.careU;
  if (!U) return;
  if (Math.abs(U.thin.value - thin) > 0.004) U.thin.value += (thin - U.thin.value) * 0.06; else U.thin.value = thin;
  if (Math.abs(U.shine.value - shine) > 0.004) U.shine.value += (shine - U.shine.value) * 0.06; else U.shine.value = shine;
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
  g.setAttribute('aThin', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
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
// (drink and graze: ridden, or let to drink from its menu: horsecare.js; the head goes down while it lasts and stands still)
export const HORSE_ACTS = { rear: 1.2, shake: 0.8, toss: 0.6, slide: 0.85, stumble: 0.8, drink: 4, graze: 6 };
const EATING = { drink: 0.9, graze: 1 }, EAT_EASE = 2.4;   // (how far down the head goes)
const REAR = { pitch: 0.66, py: 0.72, pz: -0.38, crouch: 0.035, hindHip: 0.35, hindKnee: 0.55, foreHip: 1.1, foreKnee: 1.7, paw: 0.3, pawHz: 1.5, neck: -0.45, head: -0.35 };
const REAR_FP = { pitch: 0.6, neck: 0.5, head: 0.25 };   // (from the rider's own eyes: less of the pitch, the neck stretched forward and down)
// The sliding stop (Plan R4 §5): the trunk sits back about the shoulders (pz), the hind legs under it and the forelegs braced
// ahead, the head up. The stumble: the trunk goes down in front about the hind hips, the fore knees give way, the head drops
// and it sways until it finds its feet
const SLIDE = { pitch: -0.27, py: 0.72, pz: 0.38, down: 0.025, hindHip: 1.05, foreHip: 0.32, neck: -0.28, head: 0.22 };
const STUMBLE = { pitch: 0.24, py: 0.72, pz: -0.38, foreHip: 0.5, down: 0, neck: 0.34, head: 0.12, roll: 0.07, hz: 2.2 };
const SHAKE = { roll: 0.12, hz: 5.6, head: 0.35 };
export const SEAT = [1.16, -0.02];   // (the saddle's seat on the body, y and z: where the rider sits, for the rider's rear; u.dy higher, by its breed)
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
  const u = h.userData;
  speed /= u.size || 1;   // (a smaller horse takes shorter strides, so more of them)
  const k = Math.min(1, speed / 3), ridden = gait === 0 || gait === 1 || gait === 2 || gait === 3;
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
  if (u.tail) u.tail.rotation.set((0.25 + (u.tailUp || 0)) * k + gk * (GALLOP.tail + 0.07 * Math.sin(2 * u.phase + 1)), 0, Math.sin(t * 1.8 + u.seed) * 0.25 * (1 - k * 0.6) + gk * 0.06 * Math.sin(u.phase));
  // (pastando, baja el cuello hasta la hierba; si no, de vez en cuando, parado, agacha un poco la cabeza. Winded, low; at
  // the gallop it pumps; rearing or tossing it, up)
  const eats = EATING[act] && speed < 0.6 && (st.at || 0) < HORSE_ACTS[act] - 0.4 ? EATING[act] * (act === 'drink' ? 1 - 0.2 * Math.min(1, (st.deep || 0) / 0.6) : 1) : 0;   // (standing in the water, it is that much nearer)
  u.eat = (u.eat || 0) + (eats - (u.eat || 0)) * Math.min(1, dt * EAT_EASE);
  if (u.eat < 1e-3) u.eat = 0;
  const g = Math.max(graze(u, e, k, dt), u.eat), low = Math.max(g, WINDED.low * w);
  if (u.rig) neckPose(u, low, gk * GALLOP.neck * Math.sin(u.phase + 0.9) - (act === 'drink' ? 0.03 * u.eat * Math.max(0, Math.sin(t * 3.4)) : 0) + (st?.fp ? REAR_FP.neck : REAR.neck) * rear - 0.3 * toss + SLIDE.neck * slide + STUMBLE.neck * stumble + 0.08 * shake * Math.sin(ak * TAU * SHAKE.hz * HORSE_ACTS.shake));
  if (u.head) {
    u.head.rotation.x = Math.sin(u.phase) * 0.05 * k + (u.horse && !g && speed < 0.2 && Math.sin(t * 0.3 + u.seed) > 0.4 ? 0.5 : 0) * 0.6 + g * (u.rig.hr + Math.sin(t * (act === 'drink' ? 11 : 7) + u.seed) * (act === 'drink' ? 0.025 : 0.05))
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
    const sy = SEAT[0] + (u.dy || 0);
    u.seatDy = B.position.y + sy * c - SEAT[1] * s - sy;
    u.seatDz = B.position.z + sy * s + SEAT[1] * c - SEAT[1];
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
    const sy = SEAT[0] + (u.dy || 0);
    u.seatDy = B.position.y + sy * c - SEAT[1] * s - sy;
    u.seatDz = B.position.z + sy * s + SEAT[1] * c - SEAT[1];
    u.seatPitch = rx;
  }
  if (shake) {
    // (a roll about the hips' height, the legs counter-rolled so the hooves stay put)
    const r = SHAKE.roll * shake * Math.sin(ak * TAU * SHAKE.hz * HORSE_ACTS.shake), py = REAR.py;
    B.rotation.z = r; B.position.x = py * Math.sin(r); B.position.y += py * (1 - Math.cos(r));
    for (const l of u.legs) l.hip.rotation.z = -r;
  } else if (B.rotation.z && !stumble) { B.rotation.z = 0; B.position.x = 0; for (const l of u.legs) l.hip.rotation.z = 0; }
}
