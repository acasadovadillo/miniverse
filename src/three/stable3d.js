// The horse's things in the yard (Plan R4-2, docs/planes/realismo/PLAN-R4-caballo.md §3.7): the drinking trough with its water
// and the hitching post. Each draws in a model of models.js (m), in the materials shared by tints.js.
import * as THREE from 'three';

const rng = seed => { let s = seed >>> 0; return () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296); };
const GEO = new Map();
const made = (k, make) => { if (!GEO.has(k)) GEO.set(k, make()); return GEO.get(k); };
const boxG = (a, b, c) => made(`b${a},${b},${c}`, () => new THREE.BoxGeometry(a, b, c));
const torusG = (R, r, arc = Math.PI * 2) => made(`t${R},${r},${arc}`, () => new THREE.TorusGeometry(R, r, 6, 16, arc));
// What is drawn inside, or too small to bump: the model's boxes stay as they were
const inside = (m, draw) => { const n = m.solids.length; draw(); m.solids.length = n; };

// ---------- the trough ----------
// A long plank trough on two trestles, banded with iron. level 0 dry (the boards' stain shows how far the water comes), 1 to 3
// more water (none given: the icon and the preview, full)
const T = { L: 0.74, H0: 0.2, H1: 0.58, W0: 0.17, W1: 0.25, B: 0.028 };
export function trough(m, level) {
  const L = level === undefined ? 3 : +level || 0, R = rng(73), lean = Math.atan2(T.W1 - T.W0, T.H1 - T.H0), slant = Math.hypot(T.W1 - T.W0, T.H1 - T.H0);
  // the trestles: two splayed legs, a cross bar and a foot board
  for (const s of [-1, 1]) {
    const x = s * 0.52;
    for (const z of [-1, 1]) m.geo('dark', boxG(0.075, 0.215, 0.07), x, 0.1, z * 0.195, [z * -0.2, 0, 0]);
    m.box('dark', x - 0.035, 0.13, -0.2, x + 0.035, 0.2, 0.2);
  }
  // floor, long sides (two boards each, with their seam) and ends
  m.box('wood', -T.L, T.H0, -T.W0 - 0.01, T.L, T.H0 + 0.035, T.W0 + 0.01);
  inside(m, () => {
    for (const z of [-1, 1]) for (const [i, key] of [[0, 'wood'], [1, 'light']]) {
      const k = 0.25 + i * 0.5, y = T.H0 + (T.H1 - T.H0) * k, w = T.W0 + (T.W1 - T.W0) * k, h = slant / 2 - 0.006, j = (R() - 0.5) * 0.012;
      m.geo(z > 0 === !i ? key : 'wood', boxG(2 * T.L, h, 0.034), j, y, z * (w + 0.018), [z * lean, 0, 0]);
      // (worn and wet along the rim where they drink)
      if (i) m.geo('dark', boxG(2 * T.L - 0.02, 0.016, 0.044), 0, T.H1 - 0.004, z * (T.W1 + 0.016), [z * lean, 0, 0]);
    }
    for (const s of [-1, 1]) {
      m.geo('wood', boxG(0.04, T.H1 - T.H0 - 0.02, 2 * T.W0 + 0.08), s * (T.L - 0.06), (T.H0 + T.H1) / 2 - 0.01, 0);
      m.geo('dark', boxG(0.05, 0.05, 2 * T.W1 + 0.1), s * (T.L - 0.06), T.H1 - 0.04, 0);
      // the bands, with their nails
      for (const z of [-1, 1]) {
        m.geo('iron', boxG(0.045, slant + 0.02, 0.006), s * 0.34, (T.H0 + T.H1) / 2, z * ((T.W0 + T.W1) / 2 + 0.038), [z * lean, 0, 0]);
        for (const y of [0.3, 0.5]) m.geo('iron', made('nail', () => new THREE.SphereGeometry(0.011, 6, 4)), s * 0.34, y, z * (T.W0 + (T.W1 - T.W0) * (y - T.H0) / (T.H1 - T.H0) + 0.044));
      }
      m.geo('iron', boxG(0.045, 0.006, 2 * T.W0 + 0.08), s * 0.34, T.H0 - 0.004, 0);
    }
    // what is in it: the bottom boards, damp; or the water, a little below the rim, with a leaf or two afloat
    if (!L) {
      m.geo('dirtWet', boxG(2 * T.L - 0.2, 0.004, 2 * T.W0 - 0.03), 0, T.H0 + 0.038, 0);
      for (let i = 0; i < 5; i++) m.geo('leafc:#6d6238', made('leaf', () => new THREE.CircleGeometry(1, 6).rotateX(-Math.PI / 2)), (R() - 0.5) * 1.1, T.H0 + 0.045, (R() - 0.5) * 0.24, [0, R() * 6, 0], [0.028, 1, 0.014]);
      return;
    }
    const y = T.H0 + (T.H1 - T.H0) * [0, 0.28, 0.58, 0.86][L], w = T.W0 + (T.W1 - T.W0) * (y - T.H0) / (T.H1 - T.H0);
    m.geo('wellWater', boxG(2 * T.L - 0.17, 0.006, 2 * w + 0.004), 0, y, 0);
    for (let i = 0; i < 2; i++) m.geo('leafc:#7d7440', made('leaf', () => new THREE.CircleGeometry(1, 6).rotateX(-Math.PI / 2)), (R() - 0.5) * 0.9, y + 0.005, (R() - 0.5) * 0.2, [0, R() * 6, 0], [0.026, 1, 0.013]);
  });
  // (its box: all of it, so it is bumped into and aimed at as one)
  m.solids.push([-T.L, 0, -T.W1 - 0.04, T.L, T.H1, T.W1 + 0.04]);
}

// ---------- the hitching post ----------
// Two stout posts sunk in the ground with a round rail between them, an iron ring on each and a turn of old rope
const P = { X: 0.72, H: 1.12, RAIL: 0.94 };
export function hitchingPost(m) {
  const R = rng(19);
  for (const s of [-1, 1]) {
    const x = s * P.X;
    m.cyl('dark', x, 0, 0, 0.085, 0.072, P.H, 12);
    inside(m, () => {
      m.geo('dark', made('cap', () => new THREE.ConeGeometry(0.074, 0.05, 12)), x, P.H + 0.024, 0);
      m.geo('dungL', made('foot', () => new THREE.SphereGeometry(1, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2)), x, 0, 0, [0, R() * 3, 0], [0.17, 0.045, 0.16]);
      for (const y of [P.RAIL - 0.14, P.RAIL + 0.1]) m.geo('iron', made('hoop', () => new THREE.CylinderGeometry(0.081, 0.083, 0.028, 14, 1, true)), x, y, 0);
      m.geo('iron', boxG(0.02, 0.035, 0.03), x, 0.79, 0.085);
      m.geo('iron', torusG(0.052, 0.0085), x, 0.745, 0.098, [0.25, 0, 0]);
    });
  }
  m.geo('wood', made('rail', () => new THREE.CylinderGeometry(0.05, 0.054, 1, 12).rotateZ(Math.PI / 2)), 0, P.RAIL, 0, [0, 0, 0], [2 * P.X + 0.24, 1, 1]);
  inside(m, () => {
    // rope: a few tight turns where reins have been tied, and a loose end
    for (let i = 0; i < 5; i++) m.geo(i % 2 ? 'strawD' : 'rope', torusG(0.057, 0.011), 0.24 + i * 0.021, P.RAIL, 0, [0, Math.PI / 2, 0.06 * (R() - 0.5)]);
    const hang = [[0, 0.03, 0.02], [0.012, -0.05, 0.062], [0.03, -0.17, 0.05], [0.015, -0.27, 0.075], [0.03, -0.33, 0.06]].map(q => new THREE.Vector3(...q));
    m.geo('strawD', made('hang', () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hang), 14, 0.0095, 6)), 0.3, P.RAIL, 0);
    m.geo('strawD', made('knot', () => new THREE.SphereGeometry(1, 8, 6)), 0.318, P.RAIL - 0.27, 0.073, [0, 0, 0], [0.017, 0.02, 0.017]);
  });
}
