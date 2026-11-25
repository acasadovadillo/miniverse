// What weeds and pests look like on the beds (phase R2-F, docs/planes/realismo/PLAN-R2-huerto.md §5; the rules in src/pests.js):
// the weeds by stage, what is left of an eaten seedling, the slugs on a bitten plant, leaves with holes, and the scarecrow with
// what it wears. Everything goes into the shared, colour-per-vertex paints (tints.js): no material nor draw call of their own.
import * as THREE from 'three';
import { blade, soup, points } from './wintercrops.js';

const rng = seed => { let s = seed >>> 0; return () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296); };
const TAU = Math.PI * 2, BED = 0.06;

// ---------- leaves with holes (slugs) ----------
// The same leaf without some of its triangles, never the first ones (where it holds on). Made once for each
const HOLED = new WeakMap();
export function holed(g) {
  if (HOLED.has(g)) return HOLED.get(g);
  const p = points(g), out = [], R = rng(p.length + 7), n = p.length / 9;
  for (let i = 0; i < n; i++) if (i < n * 0.22 || R() > 0.34) out.push(...p.slice(i * 9, i * 9 + 9));
  const h = soup(out);
  HOLED.set(g, h);
  return h;
}

// ---------- weeds ----------
const GRASS = blade([0.5, 0.4, 0], z => 0.5 * z * z * z - 0.1 * z, 0.5);              // 6 triangles: a stiff blade, folded
const BROAD = blade([0.14, 0.36, 0], z => 0.05 * z - 0.24 * z * z, 0.25);              // 6: plantain, dock
const TOOTH = blade([0.05, 0.2, 0.1, 0.24, 0], z => 0.12 * z - 0.3 * z * z, 0.2); // 16: dandelion, its toothed edge
const NETTLE = blade([0, 0.36, 0], z => -0.3 * z * z, 0.2);                      // 4
const STEM = new THREE.CylinderGeometry(0.6, 1, 1, 4, 1, true).translate(0, 0.5, 0).toNonIndexed();
const DISC = new THREE.CircleGeometry(1, 9).rotateX(-Math.PI / 2).toNonIndexed(), PUFF = new THREE.IcosahedronGeometry(1, 1), NUB = new THREE.IcosahedronGeometry(1, 0);
// stage 1 (just up), 2 (grown), 3 (tall, in flower); kind 0 grass and dandelions, 1 nettles and goosefoot, 2 plantain, dock and
// bindweed on the soil. Over the whole tile, thinner in its middle (the crop's)
export function weeds(m, stage, kind) {
  const R = rng(31 + stage * 7 + kind * 101), g = (key, geo, x, y, z, rot, s) => m.geo(key, geo, x, y + BED, z, rot, s);
  const green = ['leafc:#5f7a3c', 'leafc:#6f8444', 'leafc:#4f6a36'], pale = 'leafc:#8a9a5a';
  const spot = (i, n, r0 = 0.2, r1 = 0.43) => { const a = (i / n) * TAU + R() * 0.9, d = r0 + (r1 - r0) * Math.sqrt(R()); return [Math.sin(a) * d, Math.cos(a) * d]; };
  const tuft = (x, z, n, h) => { for (let i = 0; i < n; i++) { const a = R() * TAU, l = h * (0.65 + R() * 0.5); g(i % 4 === 3 ? pale : green[i % 3], GRASS, x + Math.sin(a) * 0.015, 0, z + Math.cos(a) * 0.015, [-1.15 + R() * 0.5, a, 0, 'YXZ'], [0.014, l, l]); } };
  const rosette = (x, z, n, l, geo, wide, rise = -0.35) => { for (let i = 0; i < n; i++) { const a = (i / n) * TAU + R() * 0.6, s = l * (0.75 + R() * 0.4); g(i % 3 === 1 ? pale : green[(i + 2) % 3], geo, x, 0.006, z, [rise + (R() - 0.5) * 0.3, a, (R() - 0.5) * 0.2, 'YXZ'], [s * wide, s, s]); } };
  const size = [0, 0.4, 0.75, 1][stage];
  if (kind === 0) {
    for (let i = 0, n = [0, 4, 6, 8][stage]; i < n; i++) { const [x, z] = spot(i, n, 0.16); tuft(x, z, [0, 4, 6, 8][stage], 0.09 + 0.23 * size); }
    for (let i = 0, n = [0, 1, 2, 3][stage]; i < n; i++) {
      const [x, z] = spot(i + 0.5, n, 0.24, 0.36);
      rosette(x, z, 7, 0.1 + 0.11 * size, TOOTH, 0.75);
      if (stage > 1) for (let q = 0; q < stage - 1; q++) {
        const h = 0.13 + R() * 0.1, lx = x + (R() - 0.5) * 0.06, lz = z + (R() - 0.5) * 0.06;
        g('leafc:#93a06a', STEM, lx, 0, lz, [0.12 * (R() - 0.5), 0, 0.12 * (R() - 0.5)], [0.005, h, 0.005]);
        if (stage === 3 && (i + q) % 2) g('white', PUFF, lx, h + 0.01, lz, [0, 0, 0], 0.023);
        else { g('leafc:#5f7a3c', NUB, lx, h - 0.006, lz, [0, 0, 0], 0.011); g('fruit:#d8b428', DISC, lx, h + 0.008, lz, [0.2, R() * 6, 0], 0.022); }
      }
    }
  } else if (kind === 1) {
    for (let i = 0, n = [0, 5, 7, 8][stage]; i < n; i++) {
      const [x, z] = spot(i, n, 0.2), h = (0.07 + 0.36 * size) * (0.7 + R() * 0.45), lean = (R() - 0.5) * 0.25, a = R() * TAU, nettle = i % 3 !== 2, pairs = Math.round(2 + 3 * size);
      g('leafc:#6a7a46', STEM, x, 0, z, [lean, a, 0, 'YXZ'], [0.007, h, 0.007]);
      for (let k = 0; k < pairs; k++) {
        const t = 0.25 + 0.75 * (k / Math.max(1, pairs - 1)), s = (nettle ? 0.1 : 0.085) * (0.5 + 0.5 * size) * (1.2 - t * 0.55), y = h * t, off = Math.sin(lean) * y, b = a + k * 1.57;
        for (const q of [0, Math.PI]) g(nettle ? ['leafc:#4c6a38', 'leafc:#587640'][k % 2] : ['leafc:#8a9a74', 'leafc:#7c8f62'][k % 2], NETTLE, x + Math.sin(a) * off, y, z + Math.cos(a) * off, [-0.3 + t * -0.25, b + q, 0, 'YXZ'], [s * 0.95, s, s]);
      }
      if (stage === 3) for (let k = 0; k < 4; k++) g(nettle ? 'leafc:#8f9a68' : 'leafc:#a8ac8a', NUB, x + Math.sin(a + k) * 0.02, h * (0.82 + k * 0.06), z + Math.cos(a + k) * 0.02, [0, 0, 0], [0.008, 0.022, 0.008]);
    }
    for (let i = 0, n = 2 + stage; i < n; i++) { const [x, z] = spot(i + 0.4, n, 0.14, 0.4); tuft(x, z, 3 + stage, 0.07 + 0.12 * size); }
  } else {
    for (let i = 0, n = [0, 3, 4, 5][stage]; i < n; i++) {
      const [x, z] = spot(i, n, 0.24, 0.38), l = 0.09 + 0.14 * size;
      rosette(x, z, stage + 5, l, BROAD, i % 2 ? 0.95 : 0.65, i % 2 ? -0.25 : -0.6);
      if (stage > 1) for (let q = 0; q < (i % 2 ? 2 : 3); q++) {   // (plantain spikes, the reddish heads of the dock)
        const a = R() * TAU, h = (i % 2 ? 0.16 : 0.26) * size * (0.8 + R() * 0.4), lx = x + Math.sin(a) * 0.02, lz = z + Math.cos(a) * 0.02, tilt = 0.15 + R() * 0.2;
        g('leafc:#7f8a52', STEM, lx, 0, lz, [tilt, a, 0, 'YXZ'], [0.004, h, 0.004]);
        g(i % 2 ? 'leafc:#6a5c3e' : 'leafc:#8a5238', NUB, lx + Math.sin(a) * Math.sin(tilt) * h, Math.cos(tilt) * h, lz + Math.cos(a) * Math.sin(tilt) * h, [tilt, a, 0, 'YXZ'], [0.009, i % 2 ? 0.03 : 0.045, 0.009]);
      }
    }
    for (let i = 0, n = 1 + stage; i < n; i++) {   // (bindweed: a runner along the soil with its arrow leaves, and a white bell)
      let [x, z] = spot(i, n, 0.36, 0.43), a = Math.atan2(-x, -z) + (R() - 0.5) * 1.6;
      const steps = 3 + stage * 2;
      for (let k = 0; k < steps; k++) {
        const l = 0.06 + 0.02 * size, nx = x + Math.sin(a) * l, nz = z + Math.cos(a) * l;
        if (Math.abs(nx) > 0.46 || Math.abs(nz) > 0.46) { a += 1.5; continue; }
        g('leafc:#6f7a4a', STEM, x, 0.03, z, [Math.PI / 2, a, 0, 'YXZ'], [0.004, l * 1.1, 0.004]);
        g(green[k % 3], BROAD, nx, 0.03, nz, [-0.35, a + (k % 2 ? 1.1 : -1.1), 0, 'YXZ'], [0.07, 0.075, 0.075]);
        if (stage === 3 && k % 4 === 2) g('fruit:#e6dfe2', NUB, nx, 0.075, nz, [0, a, 0], [0.018, 0.013, 0.018]);
        x = nx; z = nz; a += (R() - 0.5) * 1.3;
      }
    }
  }
}

// ---------- what the pests leave ----------
// A slug, its horns out and the slime behind it. s: its length (m)
export function slug(m, x, y, z, yaw, s = 0.055, tilt = 0) {
  const c = Math.cos(yaw), q = Math.sin(yaw), at = (u, v) => [x + q * u * Math.cos(tilt) + c * v, y + u * Math.sin(-tilt), z + c * u * Math.cos(tilt) - q * v];
  const put = (key, geo, u, v, up, sc) => { const [ax, ay, az] = at(u, v); m.geo(key, geo, ax, ay + up, az, [tilt, yaw, 0, 'YXZ'], sc); };
  put('hide:#4a3626', PUFF, 0, 0, s * 0.14, [s * 0.17, s * 0.15, s * 0.56]);
  put('hide:#5e4632', PUFF, s * 0.2, 0, s * 0.2, [s * 0.14, s * 0.12, s * 0.26]);
  put('hide:#6a5440', PUFF, s * 0.5, 0, s * 0.12, [s * 0.09, s * 0.09, s * 0.12]);
  for (const e of [-1, 1]) put('hide:#3a2a1e', STEM, s * 0.56, e * s * 0.06, s * 0.16, [s * 0.02, s * 0.2, s * 0.02]);
  if (!tilt) for (let i = 0; i < 4; i++) put('slime', DISC, -s * (0.6 + i * 0.4), Math.sin(i * 1.3) * s * 0.14, 0.0035, [s * 0.09, 1, s * 0.24]);
}
// The slugs on a plant and by it
export function slugs(m, id, stage) {
  const R = rng(id.length * 17 + stage), n = 2;
  for (let i = 0; i < n; i++) { const a = R() * TAU, d = 0.17 + R() * 0.12; slug(m, Math.sin(a) * d, BED + 0.004, Math.cos(a) * d, a + 2.4 + R(), 0.06 + R() * 0.015); }
  slug(m, 0.05, BED + (stage > 1 ? 0.1 : 0.05), 0.04, 0.7, 0.05, -0.45);
}
// What is left of a seedling a rabbit ate: the stubs bitten off, some bits and its droppings
export function eaten(m, leaf) {
  const R = rng(59), stub = 'leafc:' + leaf;
  m.geo('crumb', PUFF, 0, BED, 0, [0, 0.4, 0], [0.13, 0.05, 0.13]);
  for (let i = 0; i < 7; i++) { const a = i * 0.9 + R() * 0.4, d = 0.015 + R() * 0.035, h = 0.035 + R() * 0.045, t = 0.25 + R() * 0.3; m.geo(stub, STEM, Math.sin(a) * d, BED + 0.03, Math.cos(a) * d, [t, a, 0, 'YXZ'], [0.012, h, 0.012]); m.geo('leafc:#b9c48a', DISC, Math.sin(a) * (d + Math.sin(t) * h), BED + 0.031 + Math.cos(t) * h, Math.cos(a) * (d + Math.sin(t) * h), [t, a, 0, 'YXZ'], 0.0085); }
  for (let i = 0; i < 5; i++) { const a = i * 1.35, d = 0.12 + R() * 0.1; m.geo(stub, NETTLE, Math.sin(a) * d, BED + 0.05, Math.cos(a) * d, [0.1, R() * 6, 0, 'YXZ'], [0.045, 0.03, 0.07]); }
  for (let i = 0; i < 12; i++) { const a = R() * TAU, d = 0.17 + R() * 0.16, z = Math.cos(a) * d; m.geo('dungD', NUB, Math.sin(a) * d, BED + (Math.abs(z * 3 - Math.round(z * 3)) < 0.18 ? 0.048 : 0.01), z, [R() * 3, R() * 3, 0], [0.014, 0.011, 0.012]); }
}

// ---------- the scarecrow ----------
const strand = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const TUBES = new Map();
// Cloth hanging: rings (y, half width x, half depth z, how much it waves), closed at the top; the waves go round it, so it
// falls in folds. ragged: the last ring ends in teeth
function cloth(key, rings, folds, ragged) {
  if (TUBES.has(key)) return TUBES.get(key);
  const N = 22, p = [], R = rng(key.length * 13 + 5), tooth = Array.from({ length: N }, () => R());
  const at = (i, j) => { const [y, rx, rz, w] = rings[i], a = (j / N) * TAU, f = 1 + w * Math.sin(a * folds + i * 0.35) + w * 0.5 * Math.sin(a * (folds + 2) + 1.7), last = i === rings.length - 1; return [Math.sin(a) * rx * f, y - (last && ragged ? tooth[j % N] * 0.14 : 0), Math.cos(a) * rz * f]; };
  const idx = [], M = rings.length;
  for (let i = 0; i < M; i++) for (let j = 0; j < N; j++) p.push(...at(i, j));
  for (let i = 0; i + 1 < M; i++) for (let j = 0; j < N; j++) { const a = i * N + j, b = i * N + (j + 1) % N, c = a + N, d = b + N; idx.push(a, c, d, a, d, b); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setIndex(idx); g.computeVertexNormals();
  // (its inside: seen under the hem, and through its teeth)
  const n = p.length / 3, pos = [...p], nor = [...g.attributes.normal.array];
  for (let i = 0; i < n; i++) { for (let q = 0; q < 3; q++) pos.push(p[i * 3 + q] - nor[i * 3 + q] * 0.004); }
  for (let i = 0; i < n * 3; i++) nor.push(-nor[i]);
  for (let i = 0; i < M * N * 6 - N * 6; i += 3) idx.push(idx[i] + n, idx[i + 2] + n, idx[i + 1] + n);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(n * 4).fill(0), 2)); g.setIndex(idx);
  TUBES.set(key, g);
  return g;
}
// kind: 's' a shirt or a jacket, 'l' a long one (a coat, a tunic), 'v' without sleeves; '0' nothing on (without one, as the icon
// and the preview: an old shirt). torn: '1' its hem and cuffs in rags, with a patch
export function scarecrow(m, kind = 's', color = '#7a6a4a', torn = '1') {
  const R = rng(23), rag = torn === '1', dress = kind !== '0', cloth1 = 'hide:' + color, dark = 'hide:' + shade(color, 0.72);
  const n0 = m.solids.length;
  m.cyl('wood', 0, -0.2, 0, 0.042, 0.034, 1.98, 7, [0.015, 0, 0.02]);
  m.geo('dark', new THREE.CylinderGeometry(0.028, 0.033, 1.36, 7).rotateZ(Math.PI / 2), 0, 1.37, 0.03, [0, 0.06, 0.035]);
  for (let i = 0; i < 5; i++) m.geo('rope', new THREE.TorusGeometry(0.052, 0.009, 4, 10), 0, 1.345 + i * 0.013, 0.014, [Math.PI / 2 + (i % 2 ? 0.35 : -0.35), 0, 0]);
  for (let i = 0; i < 7; i++) { const a = R() * TAU, d = 0.05 + R() * 0.05, s = 0.03 + R() * 0.03; m.geo(i % 2 ? 'dungL' : 'dung', NUB, Math.sin(a) * d, 0.01, Math.cos(a) * d, [R(), R(), 0], [s * 1.2, s * 0.7, s]); }
  const straw = (x, y, z, dir, n, l, spread) => {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(dir[0] + (R() - 0.5) * spread, dir[1] + (R() - 0.5) * spread, dir[2] + (R() - 0.5) * spread).normalize(), q = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), v)), k = l * (0.6 + R() * 0.6);
      m.geo(['straw', 'hay', 'strawD'][i % 3], strand, x + v.x * k * 0.5, y + v.y * k * 0.5, z + v.z * k * 0.5, [q.x + R() * 2, q.y, q.z], [k, 1, 0.007 + R() * 0.006]);
    }
  };
  // the head: a stuffed sack tied at the neck, its eyes and mouth sewn
  const HY = 1.66;
  m.geo('burlap', cloth('head', [[0.17, 0.02, 0.02, 0], [0.155, 0.075, 0.07, 0.03], [0.1, 0.122, 0.112, 0.03], [0.02, 0.135, 0.122, 0.02], [-0.06, 0.118, 0.11, 0.03], [-0.115, 0.07, 0.066, 0.1], [-0.15, 0.045, 0.045, 0.18], [-0.2, 0.085, 0.085, 0.25]], 9, true), 0, HY, 0.012, [0.06, 0, 0.05]);
  m.geo('rope', new THREE.TorusGeometry(0.052, 0.011, 5, 12), 0.006, HY - 0.135, 0.014, [Math.PI / 2, 0, 0]);
  straw(0.005, HY - 0.17, 0.02, [0, -0.6, 0.2], 12, 0.12, 1.7);
  const stitch = (x, y, w, a) => m.geo('soot', new THREE.BoxGeometry(1, 1, 1), x, HY + y, 0.012 + 0.118 - (x * x) * 2.3 - y * 0.02, [0, 0, a], [w, 0.009, 0.008]);
  for (const s of [-1, 1]) { stitch(s * 0.047, 0.035, 0.044, 0.78); stitch(s * 0.047, 0.035, 0.044, -0.78); }
  for (let i = -3; i <= 3; i++) { stitch(i * 0.019, -0.052 + i * i * 0.0025, 0.02, i * 0.1); stitch(i * 0.019, -0.052 + i * i * 0.0025, 0.022, 1.57); }
  // the hat, of straw, its brim bent and frayed
  m.geo('straw', brim(), 0.005, HY + 0.105, 0.005, [-0.12, 0.4, 0.07], [0.27, 0.27, 0.27]);
  m.geo('hay', cloth('crown', [[0.17, 0.02, 0.02, 0], [0.168, 0.085, 0.08, 0.04], [0.1, 0.118, 0.11, 0.03], [0, 0.132, 0.124, 0.02]], 5, false), 0.01, HY + 0.1, 0, [-0.12, 0.4, 0.07]);
  m.geo('hide:#5a3a30', cloth('band', [[0.045, 0.129, 0.121, 0.01], [0.005, 0.137, 0.129, 0.01]], 5, false), 0.01, HY + 0.102, 0, [-0.12, 0.4, 0.07]);
  straw(0.1, HY + 0.18, 0.06, [0.6, 0.7, 0.3], 5, 0.09, 0.9);
  // the hands: straw out of the cuffs
  for (const s of [-1, 1]) { const y = 1.37 + s * 0.035 * 0.62; straw(s * 0.62, y, 0.03 - s * 0.04, [s, -0.35, 0], dress ? 16 : 22, dress ? 0.2 : 0.3, 0.75); m.geo('rope', new THREE.TorusGeometry(0.036, 0.008, 4, 9), s * 0.6, y, 0.03 - s * 0.036, [0, Math.PI / 2, 0]); }
  if (!dress) { straw(0, 1.2, 0.02, [0, -1, 0.1], 34, 0.42, 0.55); m.geo('rope', new THREE.TorusGeometry(0.07, 0.01, 5, 12), 0, 1.17, 0.015, [Math.PI / 2, 0, 0]); straw(0, 1.28, 0.03, [0, 0.4, 0.3], 14, 0.16, 1.6); }
  else {
    const end = kind === 'l' ? 0.42 : kind === 'v' ? 0.86 : 0.78, k = `${kind}${rag ? 1 : 0}`;
    m.geo(cloth1, cloth('body' + k, [[1.475, 0.06, 0.055, 0.02], [1.45, 0.14, 0.09, 0.02], [1.4, 0.235, 0.115, 0.03], [1.25, 0.215, 0.135, 0.05], [1.05, 0.19, 0.14, 0.07], [end + 0.16, 0.2 + (1 - end) * 0.06, 0.155, 0.1], [end, 0.215 + (1 - end) * 0.12, 0.17 + (1 - end) * 0.06, 0.13]], 6, rag), 0, 0, 0.015, [0.02, 0, 0.02]);
    if (kind !== 'v') for (const s of [-1, 1]) {
      const g = cloth('sleeve' + (rag ? 1 : 0), [[0, 0.105, 0.085, 0.03], [-0.1, 0.1, 0.082, 0.05], [-0.27, 0.085, 0.075, 0.08], [-0.42, 0.08, 0.078, 0.1]], 5, rag);
      m.geo(cloth1, g, s * 0.15, 1.356 + s * 0.005, 0.03 - s * 0.009, [0, 0.06, s * Math.PI / 2 + 0.035], [1, 1, 1]);
      m.geo(dark, cloth('cuff', [[0, 0.086, 0.084, 0.1], [-0.035, 0.087, 0.085, 0.1]], 5, false), s * 0.5, 1.356 + s * 0.0175, 0.03 - s * 0.03, [0, 0.06, s * Math.PI / 2 + 0.035], [1, 1, 1]);
    }
    // the neck, the buttons down the front, a rope for a belt and, if it is worn out, a patch
    m.geo(dark, cloth('neck', [[1.495, 0.085, 0.08, 0.06], [1.45, 0.115, 0.1, 0.05]], 6, false), 0, 0, 0.015, [0.02, 0, 0.02]);
    if (kind !== 'l') for (let i = 0; i < 4; i++) m.geo(dark, NUB, 0.01, 1.36 - i * 0.11, 0.142 + i * 0.011, [0, 0, 0], [0.013, 0.013, 0.006]);
    m.geo('rope', cloth('belt', [[0.012, 0.2, 0.152, 0.06], [0, 0.205, 0.157, 0.06], [-0.014, 0.2, 0.154, 0.06]], 6, false), 0, 1.02, 0.015, [0.02, 0, 0.02]);
    m.geo('rope', NUB, 0.03, 1.02, 0.172, [0, 0, 0.3], [0.02, 0.016, 0.014]);
    for (const s of [0.2, -0.25]) m.geo('rope', STEM, 0.03, 1.02, 0.176, [Math.PI - 0.12, 0, s], [0.008, 0.15, 0.008]);
    if (rag) for (const [x, y, z, a, c] of [[-0.11, 1.2, 0.135, 0.5, 'hide:#8a5a42'], [0.12, 0.95, 0.155, -0.4, 'hide:#4e5a66']]) {
      m.geo(c, new THREE.PlaneGeometry(0.085, 0.085), x, y, z + 0.018, [0, x * 2.2, a]);
      for (let i = 0; i < 4; i++) m.geo('soot', strand, x + Math.cos(a + i * 1.57) * 0.043, y + Math.sin(a + i * 1.57) * 0.043, z + 0.021, [Math.PI / 2, x * 2.2, a + i * 1.57], [0.02, 1, 0.004]);
    }
    straw(0, end + 0.02, 0.02, [0, -1, 0], 26, 0.2, 0.9); straw(0, 1.47, 0.06, [0, 0.5, 0.8], 8, 0.1, 1.2);
  }
  m.solids.length = n0;
  m.solids.push([-0.13, 0, -0.1, 0.13, 1.85, 0.12]);   // (what one bumps into and what takes room: the pole; under its arms one can work)
}
const shade = (c, k) => '#' + [1, 3, 5].map(i => Math.round(parseInt(c.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');
let BRIM;
function brim() {
  if (BRIM) return BRIM;
  const N = 26, R = rng(77), p = [], out = Array.from({ length: N }, (_, j) => [0.86 + R() * 0.2, Math.sin((j / N) * TAU * 2 + 0.6) * 0.12 - 0.1 - R() * 0.03]);
  const at = (j, t) => { const a = (j / N) * TAU, [r, y] = out[j % N], q = 0.44 + (r - 0.44) * t; return [Math.sin(a) * q, y * t * t, Math.cos(a) * q]; };
  for (let j = 0; j < N; j++) for (let i = 0; i < 3; i++) { const a = at(j, i / 3), b = at(j + 1, i / 3), c = at(j, (i + 1) / 3), d = at(j + 1, (i + 1) / 3); p.push(...a, ...c, ...d, ...a, ...d, ...b); for (const q of [[a, d, c], [a, b, d]]) p.push(...q.flatMap(v => [v[0], v[1] - 0.012, v[2]])); }
  return (BRIM = soup(p));
}
