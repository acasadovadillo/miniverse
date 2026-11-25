// The winter crops' plants (phase R2-D): potato, broad bean, cabbage and garlic, from the sprout (stage 1) to ripe (3) in
// every state of models.js CROP_LOOK. Like the other crops they go into the model's shared, colour-per-vertex materials
// ('leafc:', 'fruit:', 'crumb'): no draw call of their own. Each plant stays under 800 triangles (pruebas.js, «winter crops
// (english): the plants»): the leaves are few-sided cut-outs with their fold, made once.
import * as THREE from 'three';

// A surface from rows of points, each row across the leaf (the same number in every row); folded onto itself where a row is
// a single point repeated (no triangle there)
function sheet(rows) {
  const p = [], key = v => v.join();
  for (let i = 0; i + 1 < rows.length; i++) for (let j = 0; j + 1 < rows[i].length; j++) {
    const a = rows[i][j], b = rows[i][j + 1], c = rows[i + 1][j], d = rows[i + 1][j + 1];
    for (const tri of [[a, b, d], [a, d, c]]) if (key(tri[0]) !== key(tri[1]) && key(tri[1]) !== key(tri[2]) && key(tri[0]) !== key(tri[2])) for (const v of tri) p.push(...v);
  }
  return soup(p);
}
export function soup(p) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((p.length / 3) * 2).fill(0), 2));
  return g;
}
export const points = g => Array.from((g.index ? g.toNonIndexed() : g).attributes.position.array);
// Several pieces in one: [geometry, position, euler (YXZ), scale]
function join(list) {
  const p = [], v = new THREE.Vector3(), m4 = new THREE.Matrix4(), e = new THREE.Euler();
  for (const [g, at, rot, s] of list) {
    m4.compose(new THREE.Vector3(...at), new THREE.Quaternion().setFromEuler(e.set(...rot, 'YXZ')), new THREE.Vector3(...s));
    const a = points(g);
    for (let i = 0; i < a.length; i += 3) { v.set(a[i], a[i + 1], a[i + 2]).applyMatrix4(m4); p.push(v.x, v.y, v.z); }
  }
  return soup(p);
}
// One leaf towards +z, folded along its midrib: widths along it (the first and the last 0: a point), how it bends (y of z)
export const blade = (widths, bend, fold = 0.12) => sheet(widths.map((w, i) => {
  const z = i / (widths.length - 1), y = bend(z);
  return [[-w, y + w * fold, z], [0, y, z], [w, y + w * fold, z]];
}));
const LEAFLET = blade([0, 0.34, 0.26, 0], z => 0.1 * z - 0.22 * z * z, 0.35);              // 8 triangles
const STRAP = blade([0.5, 0.5, 0.44, 0.3, 0], z => 0.1 * z - 0.5 * z * z * z, 0.7);        // 14
const SMALL = blade([0, 0.36, 0], z => 0.08 * z - 0.2 * z * z, 0.35), TWIG = blade([0.024, 0], z => 0.02 * z, 0.2);   // 4 and 2
// A potato leaf: its stalk, the leaflet at the end and two pairs behind it, the ones nearer the stem smaller
const POTATO_LEAF = join([
  [TWIG, [0, 0, 0], [0, 0, 0], [1, 1, 0.7]],
  [LEAFLET, [0, -0.012, 0.6], [0.16, 0, 0], [0.52, 0.5, 0.52]],
  ...[[0.55, 0.4], [0.3, 0.3]].flatMap(([z, l]) => [-1, 1].map(s => [SMALL, [0, 0.005, z], [0.1, s * 1.15, 0], [l * 0.95, l, l]])),
]);
// A bean leaf: two pairs of broad oval leaflets on a short stalk
const OVAL = blade([0, 0.36, 0.16], z => 0.06 * z - 0.14 * z * z, 0.3);   // 6
const BEAN_LEAF = join([
  [TWIG, [0, 0, 0], [0, 0, 0], [1, 1, 0.7]],
  ...[[0.62, 0.55, 0.7], [0.3, 0.5, 1.15]].flatMap(([z, l, a]) => [-1, 1].map(s => [OVAL, [0, 0.004, z], [0, s * a, 0], [l * 0.9, l, l]])),
]);
// A cabbage leaf: broad and round, its edge waving up and down, cupped; towards +z
const CABBAGE_LEAF = sheet(Array.from({ length: 5 }, (_, i) => {
  const z = i / 4, w = [0.07, 0.36, 0.52, 0.42, 0.14][i];
  return [-1, -0.5, 0, 0.5, 1].map((u, j) => [u * w, 0.1 * z - 0.2 * z * z + 0.24 * u * u * w + (Math.abs(u) === 1 ? (i % 2 ? 0.045 : -0.02) : 0) + (j === 2 ? -0.02 : 0), z + (Math.abs(u) === 1 ? -0.04 : 0)]);
}));
const RIB = blade([0.05, 0.034, 0.012, 0], z => 0.1 * z - 0.2 * z * z + 0.004, -0.25);
// A leaf wrapped round the head (radius 1), from its foot at the side up over the top: its edge stands a little off it
const WRAP = sheet(Array.from({ length: 5 }, (_, i) => {
  const t = i / 4, ph = -0.9 + t * 2.6, half = [0.35, 0.85, 1.0, 0.95, 0.6][i];
  return [-1, -0.5, 0, 0.5, 1].map(u => {
    const r = 1.04 + (Math.abs(u) === 1 ? 0.1 : 0.02) + (i === 4 ? 0.06 : 0), a = u * half, c = Math.cos(ph);
    return [Math.sin(a) * c * r + (c < 0.35 ? Math.sin(a) * 0.35 * (0.35 - c) : 0), Math.sin(ph) * r, Math.cos(a) * c * r];
  });
}));
const RIBW = sheet(Array.from({ length: 5 }, (_, i) => { const ph = -0.9 + (i / 4) * 2.2, w = 0.07 * (1 - i / 4.4), r = 1.09; return [-1, 1].map(u => [u * w, Math.sin(ph) * r, Math.cos(ph) * r]); }));
const open = (r0, r1, n) => new THREE.CylinderGeometry(r1, r0, 1, n, 1, true).translate(0, 0.5, 0).toNonIndexed();
const STEM = open(1, 0.6, 4), NECK = open(1, 0.75, 6);                                    // 8 and 12
const BULB = new THREE.LatheGeometry([[0, -0.4], [0.75, -0.25], [1, 0.15], [0.62, 0.6], [0.2, 0.95]].map(([x, y]) => new THREE.Vector2(x, y)), 8).toNonIndexed();
const KNOB = new THREE.IcosahedronGeometry(1, 0), HEAD = new THREE.SphereGeometry(1, 9, 6).toNonIndexed();
const MOUND = new THREE.IcosahedronGeometry(1, 1);
// A bean pod: long, a little flat, with its beans showing; from its stalk (0) towards +z
const POD = sheet(Array.from({ length: 6 }, (_, i) => {
  const z = i / 5, r = [0, 0.75, 1, 0.92, 1, 0][i];
  return Array.from({ length: 4 }, (_, j) => { const a = (j / 3) * Math.PI * 2 + 0.5; return [Math.cos(a) * r * 0.17, Math.sin(a) * r * 0.13 + 0.12 * z * z, z]; });
}));
// A five-petal flower facing +y (a shallow cup), and its point
const STAR = soup(Array.from({ length: 5 }, (_, i) => { const a = (k => (k / 5) * Math.PI * 2), q = k => [Math.cos(a(k)), 0.25, Math.sin(a(k))]; return [0, 0, 0, ...q(i + 0.95), ...q(i + 0.05)]; }).flat());
const POINT = new THREE.ConeGeometry(1, 1, 3, 1, true).translate(0, 0.5, 0).toNonIndexed();
// A bean's flower: the standard standing up behind and two wings with their black spot
const WINGED = blade([0, 0.5, 0.42, 0], z => 0.5 * z * z, 0.6);

// m: the model's geo (over the bed); L: its state's look (models.js CROP_LOOK); mix(hex, [to, how much]); R: its own dice
// (cut(g): the same leaf with holes, for a plant slugs have been at: pests3d.js)
export function winterCrop(m, id, stage, st, L, c, mix, R, cut = null) {
  const hang = L.hang || 0, tall = L.tall || 1, big = stage === 3 ? 1 : stage === 2 ? 0.72 : 0.42, ripe = stage === 3, dead = st === 'k' || st === 'd' || st === 'r';
  const leaf = (hex, k = 1) => 'leafc:' + (L.leaf ? mix(hex, [L.leaf[0], L.leaf[1] * k]) : hex), fruit = hex => 'fruit:' + (L.fruit ? mix(hex, L.fruit) : hex);
  // (a piece that comes out at its rise over the ground, negative up, and hangs when the plant is ill, down to low at most and
  // never with its tip under the bed)
  const put = (key, g, x, y, z, rise, yaw, roll, s, low = 1.2, k = 1) => { if (cut && key.startsWith('leafc:')) g = cut(g); const len = s.length ? s[2] : s; low = Math.min(low, Math.asin(Math.min(1, (y + 0.06) / len)) - 0.14); m.geo(key, g, x, y, z, [Math.min(Math.max(low, rise), rise + hang * k), yaw, roll, 'YXZ'], s); };
  const main = leaf(c.leaf), pale = leaf(mix(c.leaf, ['#b9c48a', 0.3])), deep = leaf(mix(c.leaf, ['#2c4a2c', 0.3])), tips = L.tips ? 'leafc:' + L.tips : pale;
  const tone = i => (i % 5 === 1 ? tips : i % 3 === 2 ? deep : main);
  // (a stem from the ground: where a point of it is, and itself)
  const stalk = (key, x, z, lean, az, h, r, g = STEM) => {
    const l = lean + hang * 0.45, s = Math.sin(l), q = Math.cos(l);
    m.geo(key, g, x, 0, z, [l, az, 0, 'YXZ'], [r, h, r]);
    return t => [x + Math.sin(az) * s * h * t, q * h * t, z + Math.cos(az) * s * h * t];
  };

  if (id === 'potato') {   // (earthed up on its ridge; ripe, it has flowered, its low leaves turn and the soil cracks over its tubers)
    m.geo('crumb', MOUND, 0, -0.01, 0, [0, 0.4, 0], [0.16 + 0.1 * big, 0.04 + 0.05 * big, 0.16 + 0.1 * big]);
    const n = stage === 1 ? 3 : 5, per = stage === 1 ? 2 : 3, h = (stage === 1 ? 0.06 : 0.42 * big) * tall, size = 0.38 * (0.5 + 0.5 * big);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + R() * 0.7, at = stalk(main, Math.sin(a) * 0.05, Math.cos(a) * 0.05, 0.35 + R() * 0.25, a, h + 0.06, 0.012);
      for (let j = 0; j < per; j++) {
        const t = 0.3 + (j / Math.max(1, per - 1)) * 0.7, [x, y, z] = at(t), low = y < 0.2 ? 0.25 : 0.95, old = ripe && j === 0 && i % 2 === 0 && !dead;
        put(old ? leaf(mix(c.leaf, ['#b8a840', 0.55])) : tone(i * 3 + j), POTATO_LEAF, x, y, z, (j === per - 1 ? -0.62 : -0.22) + (R() - 0.5) * 0.3 + (old ? 0.3 : 0), a + (j - 1) * 2.1 + (R() - 0.5) * 0.6, (R() - 0.5) * 0.3, size * (0.85 + R() * 0.3) * (old ? 0.85 : 1), low);
      }
      if (ripe && !dead && st !== 'o' && i < 3) {
        const [x, y, z] = at(1);
        m.geo(main, STEM, x, y, z, [0.1, a, 0, 'YXZ'], [0.006, 0.11, 0.006]);
        for (let k = 0; k < 3; k++) { const b = a + k * 2.1, fx = x + Math.sin(b) * 0.035, fz = z + Math.cos(b) * 0.035, fy = y + 0.1 + (k % 2) * 0.018; m.geo('fruit:#e8e6e2', STAR, fx, fy, fz, [0.35, b, 0, 'YXZ'], 0.028); m.geo('fruit:#d8a828', POINT, fx, fy, fz, [0.35, b, 0, 'YXZ'], [0.007, 0.022, 0.007]); }
      }
    }
    if (ripe) for (let k = 0; k < 3; k++) { const a = 0.5 + k * 2.2; m.geo(fruit(c.color), KNOB, Math.sin(a) * 0.25, 0.045, Math.cos(a) * 0.25, [0.4 + k, a, k], [0.065 + 0.012 * (k % 2), 0.044, 0.05]); }
    return;
  }

  if (id === 'broad_bean') {   // (square stems; half grown, white flowers with their black spot; ripe, fat pods that stand out from the stem)
    m.geo('crumb', KNOB, 0, 0, 0, [0, 0, 0], [0.19, 0.045, 0.19]);
    const n = stage === 1 ? 2 : 3, h = 0.98 * (stage === 1 ? 0.28 : stage === 2 ? 0.66 : 1) * tall, per = stage === 1 ? 3 : 5, body = leaf(mix(c.leaf, ['#8fae62', 0.5]));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.4 + R() * 0.4, at = stalk(body, Math.sin(a) * 0.07, Math.cos(a) * 0.07, 0.08 + R() * 0.07, a, h, 0.015);
      for (let j = 0; j < per; j++) {
        const t = 0.2 + (j / per) * 0.82, [x, y, z] = at(t), yaw = a + (j % 2 ? 1.57 : -1.57) + (R() - 0.5) * 0.5, s = 0.27 * (0.6 + 0.4 * big) * (1 - 0.4 * Math.max(0, t - 0.6));
        put(tone(i + j), BEAN_LEAF, x, y, z, -0.5 - t * 0.35 + (R() - 0.5) * 0.3, yaw, (R() - 0.5) * 0.4, s, y < 0.2 ? 0.2 : 1.15);
        if (ripe && j > 0 && j < 4) put(fruit(j % 2 ? c.color : mix(c.color, ['#5f8a3a', 0.4])), POD, x, y + 0.01, z, dead ? 0.9 : -0.55 + R() * 0.25, a + (R() - 0.5) * 1.6 + (j === 2 ? 1 : -0.4), 0, [0.19, 0.2, 0.24], 0.9, 0.3);
        if (stage === 2 && j >= 2 && !dead) for (const sd of [-1, 1]) {
          const b = yaw + sd * 0.8, fx = x + Math.sin(b) * 0.02, fz = z + Math.cos(b) * 0.02;
          m.geo('leafc:#e6e4e0', WINGED, fx, y + 0.02, fz, [-0.5, b, 0, 'YXZ'], [0.045, 0.05, 0.06]);
          m.geo('leafc:#2a2428', SMALL, fx, y + 0.026, fz, [-0.62, b, 0, 'YXZ'], [0.02, 0.03, 0.035]);
        }
      }
      const [x, y, z] = at(1);
      for (let k = 0; k < 2; k++) put(pale, OVAL, x, y - 0.01, z, -1.1, a + k * 3, 0, 0.1 * (0.6 + big * 0.4));
    }
    return;
  }

  if (id === 'cabbage') {
    m.geo('crumb', MOUND, 0, 0, 0, [0, 0, 0], [0.15, 0.04, 0.15]);
    const rib = leaf('#c3cf9c', 0.8), bolt = st === 'b', n = stage === 1 ? 5 : 9, len = [0, 0.15, 0.3, 0.4][stage];
    const ring = (count, l, rise, y, from, shift) => {
      for (let i = 0; i < count; i++) {
        const a = shift + (i / count) * Math.PI * 2 + (R() - 0.5) * 0.3, s = l * (0.88 + R() * 0.2), r = rise + (R() - 0.5) * 0.16, x = Math.sin(a) * from, z = Math.cos(a) * from, roll = (R() - 0.5) * 0.25;
        put(tone(i), CABBAGE_LEAF, x, y, z, r, a, roll, s, -0.12);
        if (stage > 1) put(rib, RIB, x, y + 0.004, z, r, a, roll, s, -0.12);
      }
    };
    if (!ripe) { ring(stage === 1 ? n : 6, len, -0.62, 0.03, 0.02, 0); if (stage === 2) { ring(4, len * 0.72, -1.0, 0.05, 0.015, 0.5); m.geo(pale, HEAD, 0, 0.08, 0, [0, 0, 0], [0.055, 0.06 * tall, 0.055]); } return; }
    const q = dead ? 0.8 : 1, hy = 0.155 * q * (dead ? 0.7 : 1), heart = fruit(c.color);
    ring(8, len, dead ? -0.2 : -0.5, 0.025, 0.05, 0.2);
    if (bolt) {   // (the head has burst: its leaves open round a tall stalk of yellow flowers)
      for (let i = 0; i < 4; i++) put(i % 2 ? pale : main, CABBAGE_LEAF, 0, 0.09, 0, -0.95 + (i % 2) * 0.15, i * 1.57 + 0.4, 0, 0.26, -0.3, 0.5);
      const H = 0.92, yellow = 'fruit:#d8c23c';
      m.geo(pale, STEM, 0, 0.04, 0, [0, 0, 0], [0.02, H, 0.02]);
      for (let i = 0; i < 6; i++) {
        const a = i * 2.4 + R() * 0.5, y = H * (0.42 + i * 0.09), l = 0.22 - i * 0.015, lean = 0.75;
        m.geo(pale, STEM, 0, y, 0, [lean, a, 0, 'YXZ'], [0.008, l, 0.008]);
        if (i < 3) put(main, OVAL, 0, y - 0.03, 0, -0.5, a + 0.8, 0, 0.15);
        for (let k = 0; k < 4; k++) { const t = 0.75 + k * 0.13, b = k * 2.2; m.geo(yellow, STAR, Math.sin(a) * Math.sin(lean) * l * t + Math.sin(b) * 0.022, y + Math.cos(lean) * l * t, Math.cos(a) * Math.sin(lean) * l * t + Math.cos(b) * 0.022, [0.3, b, 0, 'YXZ'], 0.02); }
      }
      for (let k = 0; k < 6; k++) m.geo(yellow, STAR, Math.sin(k * 1.05) * 0.03, H + 0.03 + (k % 2) * 0.03, Math.cos(k * 1.05) * 0.03, [0.4, k * 1.05, 0, 'YXZ'], 0.02);
      return;
    }
    const rx = 0.15 * q, ry = 0.135 * q * (dead ? 0.72 : 1);
    m.geo(heart, HEAD, 0, hy, 0, [0, 0, 0], [rx, ry, rx]);
    for (let i = 0; i < 4; i++) {
      const a = i * 1.62 + 0.3, s = 1 + i * 0.015, key = i === 3 ? pale : leaf(mix(c.color, [c.leaf, 0.3 + 0.12 * (i % 3)]));
      m.geo(key, WRAP, 0, hy, 0, [-0.1 + hang * 0.06, a, 0, 'YXZ'], [rx * s, ry * s, rx * s]);
      m.geo(rib, RIBW, 0, hy, 0, [-0.1 + hang * 0.06, a, 0, 'YXZ'], [rx * s, ry * s, rx * s]);
    }
    return;
  }

  // garlic: four of them, flat leaves folded like a keel coming out of each other to both sides; ripe, the low ones have dried
  // and the bulbs show
  const paper = fruit(c.color), dry = leaf('#b8a262');
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.7 + R() * 0.3, d = 0.2 + R() * 0.03, x = Math.sin(a) * d, z = Math.cos(a) * d, side = R() * 3, h = (stage === 1 ? 0.05 : stage === 2 ? 0.15 : 0.24) * tall, lean = hang * 0.35;
    m.geo('crumb', KNOB, x, 0, z, [0, a, 0], [0.075, 0.03, 0.075]);
    if (ripe) m.geo(paper, BULB, x, 0.028, z, [0.1 * (i - 1.5), a, 0], dead ? [0.036, 0.034, 0.036] : [0.046, 0.05, 0.046]);
    m.geo(ripe ? leaf('#c9cf9e') : pale, NECK, x, 0.01, z, [lean, a, 0, 'YXZ'], [0.016 * (0.6 + 0.4 * big), h + 0.02, 0.016 * (0.6 + 0.4 * big)]);
    const n = stage === 1 ? 3 : stage === 2 ? 5 : 6, l = (stage === 1 ? 0.2 : stage === 2 ? 0.36 : 0.46);
    for (let j = 0; j < n; j++) {
      const t = 0.35 + 0.65 * ((j + 1) / n), y = 0.01 + Math.cos(lean) * (h + 0.02) * t, off = Math.sin(lean) * (h + 0.02) * t, old = ripe && j < 2, yaw = side + (j % 2) * Math.PI + (R() - 0.5) * 0.35;
      put(old ? dry : tone(j), STRAP, x + Math.sin(a) * off, y, z + Math.cos(a) * off, old ? -0.12 : -0.85 - 0.5 * t + (R() - 0.5) * 0.2, yaw, (R() - 0.5) * 0.25, [0.021 * (0.6 + 0.4 * big), l * 0.55, l * (old ? 0.6 : 0.8 + R() * 0.3) * tall], y < 0.16 ? -0.05 : 0.75);
    }
  }
}
