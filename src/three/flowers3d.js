// Las flores silvestres que se cogen (la margarita y el diente de león): sus formas, que usan el campo (nature3d.js,
// en instancias) y el modelo de lo que se lleva y se tira al suelo (models.js). Están algo más grandes que de verdad
// (unas dos veces), para que se vean desde la cámara del juego.
import * as THREE from 'three';

const geo = (pos) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g; };

// Una tira plana que sale del centro en la dirección a, subiendo up (radianes sobre el plano), de la anchura que dice
// wAt(t) a lo largo (t de 0 a 1) y con la punta caída droop: la base de los pétalos y de las hojas
function strip(pos, a, r0, r1, up, wAt, steps = 4, droop = 0) {
  const ca = Math.cos(a), sa = Math.sin(a), px = -sa, pz = ca;
  const at = (t, side) => {
    const r = r0 + (r1 - r0) * t, w = wAt(t) * side, y = Math.sin(up) * (r - r0) - droop * t * t;
    const h = Math.cos(up) * r;
    return [ca * h + px * w, y, sa * h + pz * w];
  };
  for (let k = 0; k < steps; k++) {
    const t0 = k / steps, t1 = (k + 1) / steps, a0 = at(t0, -1), b0 = at(t0, 1), a1 = at(t1, -1), b1 = at(t1, 1);
    pos.push(...a0, ...b0, ...b1, ...a0, ...b1, ...a1);
  }
}

// Margarita: 21 lígulas blancas, estrechas y largas, abiertas en plano con la punta algo caída (la cabeza mira hacia +y)
export function daisyPetals() {
  const pos = [];
  for (let i = 0; i < 21; i++) {
    const a = (i / 21) * Math.PI * 2 + (i % 2) * 0.05;
    // (estrecha en el arranque, ancha a lo largo y con la punta redonda)
    strip(pos, a, 0.006, 0.034 + (i % 3) * 0.002, 0.08, t => 0.0046 * (t < 0.15 ? 0.45 + t / 0.15 * 0.55 : t < 0.78 ? 1 : Math.sqrt(Math.max(0, 1 - ((t - 0.78) / 0.22) ** 2))), 6, 0.004);
  }
  return geo(pos);
}
// El botón amarillo del centro: una cúpula baja
export const daisyDisc = () => new THREE.SphereGeometry(0.0095, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1);

// Diente de león: una borla de lígulas amarillas en cuatro coronas, las de fuera casi planas y las de dentro de pie
export function dandelionHead() {
  const pos = [];
  // (cada corona, un poco más arriba que la de fuera: la borla queda abombada y llena)
  for (const [r, n, up, y0] of [[0.032, 34, 0.12, 0], [0.028, 30, 0.42, 0.002], [0.023, 26, 0.7, 0.003]]) {
    const ring = [];
    for (let i = 0; i < n; i++) strip(ring, (i / n) * Math.PI * 2 + up * 3, 0.001, r, up, t => 0.0027 * (t < 0.85 ? 1 : (1 - t) / 0.15 * 0.7 + 0.3), 2, 0.0015);
    for (let k = 1; k < ring.length; k += 3) ring[k] += y0;
    pos.push(...ring);
  }
  return geo(pos);
}
// El centro de la borla, abombado y lleno (las lígulas de dentro, apretadas)
export const dandelionDome = () => new THREE.SphereGeometry(0.02, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.72, 1);
// El cáliz verde de debajo, con las brácteas vueltas hacia abajo
export const dandelionCup = () => new THREE.ConeGeometry(0.0105, 0.016, 8, 1, false).rotateX(Math.PI).translate(0, -0.0085, 0);
// El vilano: la bola de semillas en que se vuelve al madurar. Cada semilla, un pelo fino que sale del centro con su
// paracaídas (una estrellita) en la punta, repartidas por la esfera (menos abajo, donde está el tallo)
export function dandelionPuff() {
  const pos = [], N = 90, R = 0.026, w = 0.00045, golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 1.7, r = Math.sqrt(Math.max(0, 1 - y * y)), f = i * golden;
    const d = [Math.cos(f) * r, y, Math.sin(f) * r], p = Math.abs(d[1]) < 0.9 ? [-d[2], 0, d[0]] : [1, 0, 0];
    const pl = Math.hypot(...p), px = p.map(v => (v / pl) * w), tip = d.map(v => v * R);
    pos.push(-px[0], -px[1], -px[2], px[0], px[1], px[2], ...tip);
    // (el paracaídas: tres puntas finas alrededor de la del pelo)
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2, q = [px[0] * Math.cos(a) * 9, px[1] * 9 + Math.sin(a) * 0.004, px[2] * Math.cos(a) * 9];
      pos.push(...tip, tip[0] + q[0] + d[0] * 0.002, tip[1] + q[1] + d[1] * 0.002, tip[2] + q[2] + d[2] * 0.002, tip[0] + d[0] * 0.003, tip[1] + d[1] * 0.003, tip[2] + d[2] * 0.003);
    }
  }
  const g = geo(pos);
  g.translate(0, 0, 0);
  return g;
}

// Hojas de la roseta, tumbadas a lo largo de +x desde la base. La de la margarita, en cuchara (rabillo y lámina redonda)
export function daisyLeaf() {
  const pos = [];
  strip(pos, 0, 0, 0.075, 0.18, t => (t < 0.35 ? 0.0035 : 0.011 * Math.sin(((t - 0.35) / 0.65) * Math.PI * 0.95 + 0.15)), 6, 0.012);
  return geo(pos);
}
// La del diente de león, larga y con dientes que miran hacia la base
export function dandelionLeaf() {
  const pos = [];
  strip(pos, 0, 0, 0.13, 0.12, t => { const tooth = (t * 5) % 1; return (0.006 + 0.012 * Math.sin(t * Math.PI)) * (0.55 + 0.45 * tooth); }, 14, 0.02);
  return geo(pos);
}
// El tallo: un cilindro fino de 1 de largo, centrado (se escala a lo largo que haga falta)
export const stemGeo = () => new THREE.CylinderGeometry(0.5, 0.65, 1, 5);

let G;
export const FLOWER_GEO = () => (G ||= {
  petals: daisyPetals(), disc: daisyDisc(), dandelion: dandelionHead(), dome: dandelionDome(), cup: dandelionCup(), puff: dandelionPuff(),
  leafD: daisyLeaf(), leafT: dandelionLeaf(), stem: stemGeo(),
});
export const FLOWER_COLORS = { petals: '#f2efe6', disc: '#e0ad22', dandelion: '#efbd1c', dome: '#e8b41a', cup: '#4f6a2c', puff: '#f4f2ee', leafD: '#4c6a32', leafT: '#557030', stem: '#5f7c3a' };

// Un ramillete de tres, de pie, para el modelo (lo que se lleva y se tira): las piezas en un Builder de models.js
export function flowerBunch(m, kind) {
  const F = FLOWER_GEO(), C = FLOWER_COLORS, key = k => 'leafc:' + C[k], daisy = kind === 'margarita';
  [[-0.012, 0.0, 0.2, 0.14], [0.014, 0.008, -0.15, 0.17], [0.0, -0.014, 0.05, 0.12]].forEach(([x, z, lean, h]) => {
    const tx = x + Math.sin(lean) * h, ty = Math.cos(lean) * h;
    m.geo(key('stem'), F.stem, x + Math.sin(lean) * h / 2, ty / 2, z, [0, 0, -lean], [0.006, h, 0.006]);
    if (daisy) { m.geo(key('petals'), F.petals, tx, ty, z, [0.5, 0, -lean]); m.geo(key('disc'), F.disc, tx, ty + 0.001, z, [0.5, 0, -lean]); }
    else { m.geo(key('cup'), F.cup, tx, ty, z, [0.4, 0, -lean]); m.geo(key('dandelion'), F.dandelion, tx, ty, z, [0.4, 0, -lean]); m.geo(key('dome'), F.dome, tx, ty, z, [0.4, 0, -lean]); }
  });
  m.geo(key(daisy ? 'leafD' : 'leafT'), daisy ? F.leafD : F.leafT, 0, 0.03, 0, [0, 0.6, 1.0]);
}
