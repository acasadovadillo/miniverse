// The garden's and the stables' art of Plan R2-C (docs/planes/realismo/PLAN-R2-huerto.md §5): the compost bin with what is in
// it, the pile of manure by an animal house, the trough with its fodder and what rich or poor soil shows on a tilled tile.
// Each function draws in a model of models.js (m), all in paints shared by vertex colour (tints.js): no material of their own.
import * as THREE from 'three';

const rng = seed => { let s = seed >>> 0; return () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296); };
// Clods: a few lumps of earth (made once, each a little different). detail: 1 the big ones, 0 the small ones (20 faces)
const CLODS = [];
let STRAND, PATCH;
function clods(detail = 1) {
  if (CLODS[detail]) return CLODS[detail];
  const R = rng(911);
  return (CLODS[detail] = [0, 1, 2, 3].map(() => {
    const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position, seen = new Map();
    for (let i = 0; i < p.count; i++) {
      const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
      if (!seen.has(k)) seen.set(k, 0.74 + R() * 0.42);
      const f = seen.get(k); p.setXYZ(i, p.getX(i) * f, p.getY(i) * f, p.getZ(i) * f);
    }
    const nor = g.attributes.normal;   // (smooth: it has no shared vertices)
    for (let i = 0; i < p.count; i++) { const l = Math.hypot(p.getX(i), p.getY(i), p.getZ(i)) || 1; nor.setXYZ(i, p.getX(i) / l, p.getY(i) / l, p.getZ(i) / l); }
    return g;
  }));
}
const bit = () => (BIT ||= (() => { const g = new THREE.OctahedronGeometry(1, 0), p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * 1.15, p.getY(i), p.getZ(i) * 0.85); g.computeVertexNormals(); return g; })());
let BIT;
const strand = () => (STRAND ||= new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
const patch = () => (PATCH ||= (() => { const g = new THREE.CircleGeometry(1, 9).rotateX(-Math.PI / 2), p = g.attributes.position, R = rng(53); for (let i = 1; i < p.count - 1; i++) { const f = 0.7 + R() * 0.45; p.setXYZ(i, p.getX(i) * f, 0, p.getZ(i) * f); } p.setXYZ(p.count - 1, p.getX(1), 0, p.getZ(1)); return g; })());
// A mound: a lumpy half-ball (r across, h tall), from the same noise whatever its size
const MOUNDS = new Map();
function mound(seed, rough = 0.16) {
  const key = `${seed}:${rough}`;
  if (MOUNDS.has(key)) return MOUNDS.get(key);
  const g = new THREE.SphereGeometry(1, 20, 7, 0, Math.PI * 2, 0, Math.PI / 2), p = g.attributes.position, R = rng(seed), a = [R() * 6, R() * 6, R() * 6, R() * 6];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), t = Math.atan2(z, x);
    const f = 1 + rough * (Math.sin(t * 3 + a[0] + y * 2) * 0.5 + Math.sin(t * 5 + a[1] - y * 5) * 0.35 + Math.sin(t * 9 + a[2] + y * 9) * 0.2), sag = y < 0.35 ? 1 + (0.35 - y) * 0.35 : 1;
    p.setXYZ(i, x * f * sag, Math.max(0, y * (0.92 + 0.1 * Math.sin(t * 4 + a[3]))), z * f * sag);
  }
  g.computeVertexNormals();
  MOUNDS.set(key, g);
  return g;
}
// What is drawn inside does not bump or take room: the boxes of the model stay the ones it had
const inside = (m, draw) => { const n = m.solids.length; draw(); m.solids.length = n; };

// ---------- the pile of manure ----------
// size 1 to 3: a dark, wet mound with clods and the straw of the bedding
export function manureHeap(m, size) {
  const r = [0, 0.26, 0.36, 0.44][size], h = [0, 0.13, 0.22, 0.33][size], R = rng(17 + size), C = clods(), S = clods(0);
  m.geo('dungD', patch(), 0, 0.006, 0, [0, 0.4, 0], [r * 1.35, 1, r * 1.25]);
  m.geo('dung', mound(31 + size, 0.2), 0, -0.004, 0, [0, size, 0], [r, h, r * 0.92]);
  if (size > 1) m.geo('dungL', mound(57, 0.22), r * 0.5, -0.004, r * 0.35, [0, 1, 0], [r * 0.55, h * 0.55, r * 0.5]);
  const top = (x, z) => h * Math.sqrt(Math.max(0, 1 - (x * x) / (r * r) - (z * z) / (r * r * 0.85)));
  for (let i = 0, n = 10 + size * 8; i < n; i++) {
    const a = R() * Math.PI * 2, d = Math.sqrt(R()) * r * 1.08, x = Math.cos(a) * d, z = Math.sin(a) * d * 0.92, s = 0.024 + R() * 0.036 + size * 0.004;
    m.geo(['dung', 'dungD', 'dungL', 'dungD'][i % 4], (i % 3 ? S : C)[i % 4], x, top(x, z) + s * 0.1, z, [R() * 3, R() * 3, R() * 3], [s * 1.25, s * 0.75, s]);
  }
  for (let i = 0, n = 14 + size * 12; i < n; i++) {
    const a = R() * Math.PI * 2, d = Math.sqrt(R()) * r * 1.2, x = Math.cos(a) * d, z = Math.sin(a) * d * 0.92, l = 0.06 + R() * 0.13;
    m.geo(i % 3 ? 'strawD' : 'straw', strand(), x, top(x, z) + 0.008, z, [(R() - 0.5) * 0.9, R() * Math.PI, (R() - 0.5) * 0.9], [l, 1, 0.009 + R() * 0.008]);
  }
}

// ---------- the compost bin ----------
// Four posts and slats with air between them, the front ones lower to fork it out. level: 0 empty, 1 and 2 filling, 3 full,
// 4 turned to compost (without one, as the icon and the preview: half full)
export function compostBin(m, level) {
  const L = level === undefined ? 2 : +level, W = 0.46, H = 0.82, R = rng(5);
  for (const [x, z] of [[-W, -W], [W, -W], [-W, W], [W, W]]) {
    const h = H + (R() - 0.5) * 0.05, f = z > 0 ? -0.1 : 0;
    m.box('dark', x - 0.04, 0, z - 0.04, x + 0.04, h + f, z + 0.04);
    m.box('dark', x - 0.028, h + f, z - 0.028, x + 0.028, h + f + 0.02, z + 0.028);
  }
  const slat = (side, i, n) => {
    const y = 0.07 + i * 0.148, hh = 0.104 + (R() - 0.5) * 0.012, tilt = (R() - 0.5) * 0.022, key = ['wood', 'plank', 'wood', 'light'][(i + side * 2 + n) % 4], o = W + 0.045;
    if (side < 2) { const z = side ? o - 0.02 : -o + 0.02; m.geo(key, boxGeo(2 * W + 0.1, hh, 0.026), 0, y + hh / 2, z, [0, 0, tilt]); }
    else { const x = side === 2 ? -o + 0.02 : o - 0.02; m.geo(key, boxGeo(0.026, hh, 2 * W + 0.02), x, y + hh / 2, 0, [tilt, 0, 0]); }
    for (const s of [-1, 1]) if (side < 2) m.geo('iron', boxGeo(0.012, 0.012, 0.008), s * W, y + hh / 2 + s * 0.01, side ? o - 0.005 : -o + 0.005);
  };
  for (const [side, n] of [[0, 5], [1, 4], [2, 5], [3, 5]]) for (let i = 0; i < n; i++) slat(side, i, n);
  inside(m, () => {
    const C = clods(0), w = W - 0.03, y = [0.03, 0.2, 0.4, 0.62, 0.56][L], rot = ['dungD', 'dungD', 'dungD', 'dung', 'humus'][L];
    m.geo('dungD', patch(), 0, 0.02, 0, [0, 0, 0], [0.42, 1, 0.42]);
    if (!L) { for (let i = 0; i < 8; i++) m.geo('straw', strand(), (R() - 0.5) * 0.7, 0.03, (R() - 0.5) * 0.7, [0, R() * 3, 0], [0.1 + R() * 0.1, 1, 0.01]); return; }
    const h = 0.1 + L * 0.012;
    m.B(rot).box(-w, 0.03, -w, w, y - 0.02, w, { s: 0.5 });
    // the top: a low dome, with what it is made of showing
    m.geo(L === 4 ? 'humus' : L === 3 ? 'dung' : 'dungL', mound(71 + L, 0.1), 0, y - 0.03, 0, [0, L, 0], [w * 1.02, h, w * 1.02]);
    const top = (x, q) => y - 0.024 + h * 0.95 * Math.sqrt(Math.max(0.02, 1 - (x * x + q * q) / (w * w)));
    const at = (k, s, z = 1) => { const x = (R() - 0.5) * 2 * (w - 0.05), q = (R() - 0.5) * 2 * (w - 0.05); m.geo(k, C[Math.floor(R() * 4)], x, top(x, q), q, [R() * 3, R() * 3, R() * 3], [s * 1.3, s * 0.7 * z, s]); };
    if (L === 4) { for (let i = 0; i < 70; i++) at(['humus', 'humusL', 'dungD', 'humusL'][i % 4], 0.016 + R() * 0.026); for (let i = 0, x, q; i < 8; i++) m.geo('strawD', strand(), x = (R() - 0.5) * 0.6, top(x, q = (R() - 0.5) * 0.6) + 0.015, q, [R() - 0.5, R() * 3, R() - 0.5], [0.05 + R() * 0.04, 1, 0.008]); return; }
    for (let i = 0, n = 14 + L * 5; i < n; i++) at(['dung', 'dungL', 'dungD'][i % 3], 0.028 + R() * 0.03);
    for (let i = 0, n = 26 + L * 8; i < n; i++) { const x = (R() - 0.5) * 1.7 * w, q = (R() - 0.5) * 1.7 * w; m.geo(i % 3 ? 'straw' : 'strawD', strand(), x, top(x, q) + 0.012 + R() * 0.02, q, [(R() - 0.5) * 0.5, R() * Math.PI, (R() - 0.5) * 0.7], [0.1 + R() * 0.16, 1, 0.009 + R() * 0.008]); }
    // scraps: outer leaves, a carrot end, peel, eggshell (older, under the straw, when it is full)
    for (let i = 0, n = L === 3 ? 5 : 12; i < n; i++) { const x = (R() - 0.5) * 1.5 * w, q = (R() - 0.5) * 1.5 * w; m.geo(['leafc:#6a7a44', 'leafc:#8a8a4a', 'leafc:#7a6a3a'][i % 3], patch(), x, top(x, q) + 0.022, q, [(R() - 0.5) * 0.7, R() * 6, (R() - 0.5) * 0.7], [0.05 + R() * 0.04, 1, 0.032 + R() * 0.02]); }
    if (L < 3) { for (let i = 0; i < 4; i++) at('fruit:#c8742a', 0.02 + R() * 0.012); for (let i = 0; i < 3; i++) at('white', 0.017); for (let i = 0; i < 3; i++) at('fruit:#a84a32', 0.02); }
  });
}
const BOXES = new Map();
function boxGeo(a, b, c) { const k = `${a},${b},${c}`; if (!BOXES.has(k)) BOXES.set(k, new THREE.BoxGeometry(a, b, c)); return BOXES.get(k); }

// ---------- the trough's fodder ----------
// level 0 empty, 1 some, 2 full (without one, full of hay: the icon and the preview); kind h hay, g grain, r roots
export function troughFill(m, level, kind = 'h') {
  const L = level === undefined ? 2 : +level, R = rng(23), C = clods(0), y = L === 2 ? 0.33 : 0.23;
  inside(m, () => {
    if (!L) { for (let i = 0; i < 9; i++) m.geo('hay', strand(), (R() - 0.5) * 0.76, 0.168, (R() - 0.5) * 0.3, [0, R() * 3, 0], [0.06 + R() * 0.08, 1, 0.01]); return; }
    if (kind === 'g') {
      m.B('grain').box(-0.43, 0.16, -0.2, 0.43, y - 0.03, 0.2, { s: 0.5 });
      m.geo('grain', mound(91, 0.06), -0.08, y - 0.035, 0.01, [0, 0.3, 0], [0.36, 0.085, 0.19]); m.geo('grain', mound(92, 0.06), 0.22, y - 0.035, -0.02, [0, 1, 0], [0.22, 0.06, 0.17]);
      const hill = (x, z, cx, cz, rx, rz, h) => h * Math.sqrt(Math.max(0, 1 - ((x - cx) / rx) ** 2 - ((z - cz) / rz) ** 2));
      for (let i = 0; i < 130; i++) { const x = (R() - 0.5) * 0.82, z = (R() - 0.5) * 0.36; m.geo(['grainL', 'grainD', 'grainL', 'grain'][i % 4], bit(), x, y - 0.028 + Math.max(hill(x, z, -0.08, 0.01, 0.36, 0.19, 0.08), hill(x, z, 0.22, -0.02, 0.22, 0.17, 0.057)), z, [R() * 3, R() * 3, R()], [0.016, 0.009, 0.01]); }
      return;
    }
    m.B('hay').box(-0.43, 0.16, -0.2, 0.43, y - 0.04, 0.2, { s: 0.5 });
    for (let i = 0, n = kind === 'r' ? 34 : 84; i < n; i++) { const x = (R() - 0.5) * 0.74, z = (R() - 0.5) * 0.32; m.geo(['hay', 'straw', 'grainL', 'strawD'][i % 4], strand(), x, y - 0.03 + R() * 0.07 - z * z * 0.4, z, [(R() - 0.5) * 0.45, R() * Math.PI, (R() - 0.5) * 0.4], [0.12 + R() * 0.16, 1, 0.011 + R() * 0.008]); }
    if (kind !== 'r') return;
    // roots: turnips with their tops cut, carrots, half a pumpkin
    for (let i = 0; i < 7; i++) { const x = -0.34 + i * 0.1 + (R() - 0.5) * 0.04, z = (R() - 0.5) * 0.24, s = 0.052 + R() * 0.014; m.ball('turnip', x, y + s * 0.2, z, s, s * 0.82, s, 10).ball('turnipTop', x, y + s * 0.52, z, s * 0.8, s * 0.55, s * 0.8, 8); }
    for (let i = 0; i < 6; i++) m.geo('fruit:#c8742a', CARROT ||= new THREE.CylinderGeometry(0.5, 0.12, 1, 8).rotateZ(Math.PI / 2), (R() - 0.5) * 0.6, y + 0.03, (R() - 0.5) * 0.26, [0, R() * Math.PI * 2, (R() - 0.5) * 0.5], [0.17, 0.05, 0.05]);
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; m.ball('fruit:#b8682a', 0.3 + Math.cos(a) * 0.045, y + 0.035, 0.02 + Math.sin(a) * 0.045, 0.046, 0.066, 0.046, 8); }
    for (let i = 0; i < 4; i++) m.geo('dungL', C[i], (R() - 0.5) * 0.7, y, (R() - 0.5) * 0.3, [0, 0, 0], 0.012);
  });
}
let CARROT;

// ---------- the soil of a tilled tile ----------
// more: r rich (dark crumbs and bits of straw in the furrows), p poor (stones and pale dust). alongZ: which way the rows run
// (models.js tilled, whose bed is darker too when it is rich)
export function soilBits(m, more, alongZ, R) {
  // (over a ridge, higher than in a furrow)
  const floor = (x, z) => (Math.abs(((alongZ ? x : z) * 3) - Math.round((alongZ ? x : z) * 3)) < 0.18 ? 0.1 : 0.06);
  if (more.includes('r')) {
    for (let i = 0; i < 20; i++) { const s = 0.011 + R() * 0.017, x = (R() - 0.5) * 0.86, z = (R() - 0.5) * 0.86; m.geo(i % 3 ? 'dungD' : 'humusL', bit(), x, floor(x, z) + s * 0.3, z, [R() * 3, R() * 3, R()], [s * 1.3, s * 0.8, s]); }
    for (let i = 0; i < 7; i++) m.geo('strawD', strand(), (R() - 0.5) * 0.7, 0.104, (R() - 0.5) * 0.7, [0, R() * 3, 0], [0.04 + R() * 0.05, 1, 0.007]);
  } else if (more.includes('p')) {
    for (let i = 0; i < 6; i++) { const x = (R() - 0.5) * 0.78, z = (R() - 0.5) * 0.78; m.geo('dust', patch(), x, floor(x, z) + 0.002, z, [0, R() * 6, 0], [0.03 + R() * 0.03, 1, 0.02 + R() * 0.015]); }
    for (let i = 0; i < 18; i++) { const s = 0.01 + R() * 0.018, x = (R() - 0.5) * 0.84, z = (R() - 0.5) * 0.84; m.geo(i % 3 ? 'pebble' : 'pebbleD', bit(), x, floor(x, z) + s * 0.4, z, [R() * 3, R() * 3, R()], [s * 1.2, s * 0.8, s]); }
  }
}
