// The fish of Plan R1-2 (tench, barbel, crayfish, mackerel, gilt-head bream, squid) and the angler's things (worm, cut bait,
// spoon, feather jig, landing net), and what the catch becomes (Plan R1-3: fillet, salted and rotten fish, salt): the shapes food3d.js shows in the hand, on the ground and in the icons, and nature's plates
// draw. Each is a single mesh with its colours in the vertices and one of two shared materials (wet, dry), so a model is
// one draw call. Real proportions, nose towards +z, up +y; a fish is 0.28 m long like food3d's (the catch is scaled to its
// length). Made the first time they are asked for and kept.
import * as THREE from 'three';
import { mat } from './geo.js';
import { apagado } from '../arte.js';

const clamp01 = v => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => { const k = clamp01((v - a) / (b - a)); return k * k * (3 - 2 * k); };
const C = c => new THREE.Color(apagado(c));
const mixTo = (out, a, b, k) => out.copy(a).lerp(b, clamp01(k));
const noise = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
const blot = (x, y) => { const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, f = t => t * t * (3 - 2 * t); return (noise(i, j) * (1 - f(u)) + noise(i + 1, j) * f(u)) * (1 - f(v)) + (noise(i, j + 1) * (1 - f(u)) + noise(i + 1, j + 1) * f(u)) * f(v); };
let WET = null, DRY = null, SHINY = null;
const wet = () => (WET ||= mat({ vertexColors: true, roughness: 0.34, metalness: 0.12, side: THREE.DoubleSide }));
const shiny = () => (SHINY ||= mat({ vertexColors: true, roughness: 0.26, metalness: 0.45, side: THREE.DoubleSide }));
const dry = () => (DRY ||= mat({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide }));

// ---------- putting it together ----------
// The pieces of a model, all in one geometry: put(geo, color, position, scale, rotation) takes any geometry; color is a
// Color or fn(x, y, z, out) in the geometry's own space
class Kit {
  constructor() { this.pos = []; this.nor = []; this.col = []; }
  put(geo, color, p = [0, 0, 0], s = 1, r = [0, 0, 0]) {
    const g = geo.index ? geo.toNonIndexed() : geo, P = g.attributes.position, N = g.attributes.normal, c = new THREE.Color(), m = new THREE.Matrix4(), v = new THREE.Vector3();
    m.compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s));
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i);
      if (typeof color === 'function') color(v.x, v.y, v.z, c); else c.copy(color);
      this.col.push(c.r, c.g, c.b);
      v.applyMatrix4(m); this.pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); this.nor.push(v.x, v.y, v.z);
    }
    if (g !== geo) g.dispose();
    return this;
  }
  mesh(material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const o = new THREE.Mesh(g, material);
    o.castShadow = true;
    return o;
  }
}
const DISC = new THREE.CylinderGeometry(1, 1, 1, 22);
const BALL = new THREE.SphereGeometry(1, 12, 8), TUBE = new THREE.CylinderGeometry(1, 1, 1, 10);
const tube = (pts, r, n = 14, k = 6) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), n, r, k);
// A tube that thins to its end (an arm, a leg, an antenna)
function taper(pts, r0, r1, n = 14, k = 6) {
  const g = tube(pts, 1, n, k), P = g.attributes.position, curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), q = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= n; i++) { const R = r0 + (r1 - r0) * (i / n); curve.getPointAt(i / n, q); for (let j = 0; j <= k; j++) { const a = i * (k + 1) + j; v.fromBufferAttribute(P, a).sub(q).multiplyScalar(R).add(q); P.setXYZ(a, v.x, v.y, v.z); } }
  g.computeVertexNormals();
  return g;
}
// A body along z from a profile: rows [z, up, down, half the width] (m). color(u: 0 the nose … 1 the tail, h: −1 the belly …
// 1 the back, z, out)
function body(rows, color, rings = 30, sides = 18) {
  const at = (u, k) => { const f = u * (rows.length - 1), i = Math.min(rows.length - 2, Math.floor(f)), t = f - i, p0 = rows[Math.max(0, i - 1)][k], p1 = rows[i][k], p2 = rows[i + 1][k], p3 = rows[Math.min(rows.length - 1, i + 2)][k]; return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t); };
  const pos = [], col = [], idx = [], c = new THREE.Color();
  for (let i = 0; i <= rings; i++) {
    const u = i / rings, z = at(u, 0), up = Math.max(0.0004, at(u, 1)), dn = Math.max(0.0004, at(u, 2)), w = Math.max(0.0004, at(u, 3));
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2, sy = Math.cos(a), sx = Math.sin(a);
      pos.push(w * Math.sign(sx) * Math.abs(sx) ** 0.9, sy > 0 ? up * sy : dn * sy, z);
      color(u, sy, z, c); col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < sides; j++) { const a = i * (sides + 1) + j, b = a + sides + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const colors = col;
  return { geo: g, colors };
}
function putBody(kit, rows, color, rings, sides) {
  const { geo, colors } = body(rows, color, rings, sides), idx = geo.index.array;
  let i = 0;
  // (its colours go by vertex, in the order of the non-indexed copy)
  kit.put(geo, (x, y, z, out) => { const k = idx[i++] * 3; out.setRGB(colors[k], colors[k + 1], colors[k + 2]); });
  geo.dispose();
}
// A fin: an outline [[along z, y]…] in the fish's own plane (x = 0), thin, with rays that darken towards the edge. rot leans it
// out (a paired fin), at: where its root is
function fin(kit, pts, base, tip, { at = [0, 0, 0], rot = [0, 0, 0], rays = 9 } = {}) {
  const sh = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y))), g = new THREE.ShapeGeometry(sh, 6);
  g.rotateY(-Math.PI / 2);   // (x → z)
  g.computeBoundingBox();
  const b = g.boundingBox, H = Math.max(Math.abs(b.max.y), Math.abs(b.min.y)) || 1;
  kit.put(g, (x, y, z, out) => { mixTo(out, base, tip, Math.abs(y) / H); out.multiplyScalar(0.88 + 0.12 * Math.cos(((z - b.min.z) / (b.max.z - b.min.z || 1)) * rays * 6.283)); }, at, 1, rot);
  g.dispose();
}
// The outline of a fin with a soft, rayed edge, root on y = 0 from z0 to z1; heights along it
const edge = (z0, z1, hs) => { const n = hs.length - 1, top = hs.map((h, i) => [z0 + ((z1 - z0) * i) / n, h]); return [[z0, -0.004], ...top, [z1, -0.004]]; };
// The tail: from the wrist (z, half its height) to two lobes; fork 0 a fan, 1 a deep fork
function tail(kit, z, half, L, H, fork, base, tip) {
  const N = 10, pts = [[z + 0.012, half * 0.8]];
  for (let i = 0; i <= N; i++) { const q = 1 - (2 * i) / N; pts.push([z - L * (1 - fork * 0.62 * (1 - Math.abs(q) ** 1.3)), H * q * (fork > 0.5 ? 1 : 1 - 0.06 * q * q)]); }
  pts.push([z + 0.012, -half * 0.8]);
  fin(kit, pts, base, tip, { rays: 1 });
}
function eyes(kit, x, y, z, r, iris = '#c8a850') {
  for (const s of [-1, 1]) {
    kit.put(BALL, C(iris), [s * x, y, z], [r * 0.5, r, r]);
    kit.put(BALL, new THREE.Color('#060708'), [s * (x + r * 0.22), y, z], [r * 0.4, r * 0.56, r * 0.56]);
  }
}
// The mouth's line and the gill cover, dark creases on the side
function face(kit, { gill, gillW, gillY, mouth, mouthY, dark }) {
  for (const s of [-1, 1]) {
    kit.put(tube([[s * gillW * 0.8, gillY * 0.95, gill + 0.006], [s * gillW * 1.02, gillY * 0.3, gill - 0.005], [s * gillW * 0.98, -gillY * 0.4, gill - 0.002], [s * gillW * 0.5, -gillY * 0.85, gill + 0.012]], 0.0011, 10, 4), dark);
    kit.put(tube([[0, mouthY, mouth + 0.001], [s * 0.0055, mouthY - 0.0012, mouth - 0.006], [s * 0.0085, mouthY - 0.0035, mouth - 0.014]], 0.0009, 6, 4), dark);
  }
}
// Back, flank and belly, blended by how high up the side
const shade = (out, h, back, flank, belly, hi = 0.45, lo = -0.35) => { mixTo(out, flank, back, smooth(hi - 0.35, hi + 0.3, h)); if (h < lo + 0.4) out.lerp(belly, smooth(lo + 0.35, lo - 0.2, h)); return out; };
const scales = (z, h, n = 190, k = 0.1) => 1 - k * (0.5 + 0.5 * Math.cos(z * n + Math.floor((h + 1) * 9) * 3.14)) * (0.5 + 0.5 * Math.cos((h + 1) * 56));

// ---------- the fish ----------
const FISHES = {
  // Olive gold, thick and short, all its fins rounded, a tiny red eye and slime for scales
  tench(kit) {
    const back = C('#58602c'), flank = C('#a09a44'), belly = C('#d8b860'), f0 = C('#6a6a36'), f1 = C('#454826');
    putBody(kit, [[0.14, 0.004, 0.004, 0.004], [0.128, 0.018, 0.014, 0.013], [0.1, 0.031, 0.024, 0.02], [0.055, 0.041, 0.034, 0.025], [0.005, 0.041, 0.036, 0.025], [-0.045, 0.031, 0.028, 0.018], [-0.085, 0.0225, 0.021, 0.0105], [-0.108, 0.02, 0.019, 0.006]],
      (u, h, z, o) => { shade(o, h, back, flank, belly, 0.5, -0.5); o.multiplyScalar(scales(z, h, 330, 0.07) * (0.94 + 0.12 * blot(z * 60, h * 3))); });
    fin(kit, edge(0.015, -0.035, [0.004, 0.024, 0.03, 0.029, 0.022, 0.008]), f0, f1, { at: [0, 0.037, 0] });
    fin(kit, edge(-0.035, -0.07, [0.004, 0.019, 0.023, 0.018, 0.006]).map(([z, y]) => [z, -y]), f0, f1, { at: [0, -0.024, 0] });
    for (const s of [-1, 1]) {
      fin(kit, edge(0.062, 0.028, [0.003, 0.02, 0.026, 0.022, 0.008]).map(([z, y]) => [z - y * 0.7, -y]), f0, f1, { at: [s * 0.018, -0.017, 0.005], rot: [0, 0, s * 0.85] });
      fin(kit, edge(0.008, -0.02, [0.003, 0.02, 0.026, 0.02, 0.006]).map(([z, y]) => [z - y * 0.5, -y]), f0, f1, { at: [s * 0.013, -0.03, 0], rot: [0, 0, s * 0.45] });
      kit.put(taper([[s * 0.008, -0.009, 0.13], [s * 0.013, -0.015, 0.132], [s * 0.015, -0.02, 0.128]], 0.0011, 0.0005, 6, 4), f0);
    }
    tail(kit, -0.105, 0.0195, 0.036, 0.031, 0.06, f0, f1);
    eyes(kit, 0.0165, 0.013, 0.112, 0.0046, '#c8502a');
    face(kit, { gill: 0.073, gillW: 0.0225, gillY: 0.026, mouth: 0.139, mouthY: -0.002, dark: C('#33371c') });
  },
  // Long and round, flat underneath, a snout over a mouth that looks down with four barbels, scales edged in bronze
  barbel(kit) {
    const back = C('#7a6638'), flank = C('#c4a560'), belly = C('#f0e4c0'), f0 = C('#c8875a'), f1 = C('#a86844'), d0 = C('#86724a');
    putBody(kit, [[0.14, 0.0035, 0.004, 0.004], [0.13, 0.01, 0.009, 0.01], [0.108, 0.018, 0.013, 0.0145], [0.075, 0.025, 0.018, 0.0175], [0.03, 0.028, 0.02, 0.0185], [-0.02, 0.0245, 0.019, 0.0165], [-0.065, 0.017, 0.015, 0.011], [-0.1, 0.0125, 0.0125, 0.0058]],
      (u, h, z, o) => { shade(o, h, back, flank, belly, 0.45, -0.45); if (u > 0.2) o.multiplyScalar(scales(z, h, 260, 0.2)); o.multiplyScalar(0.93 + 0.14 * blot(z * 80, h * 4)); });
    fin(kit, edge(0.028, -0.01, [0.004, 0.032, 0.026, 0.019, 0.014, 0.008]).map(([z, y]) => [z - y * 0.45, y]), d0, C('#4a3c22'), { at: [0, 0.024, 0] });
    fin(kit, edge(-0.045, -0.067, [0.004, 0.026, 0.022, 0.008]).map(([z, y]) => [z - y * 0.45, -y]), f0, f1, { at: [0, -0.015, 0] });
    for (const s of [-1, 1]) {
      fin(kit, edge(0.072, 0.05, [0.003, 0.024, 0.026, 0.016, 0.004]).map(([z, y]) => [z - y * 0.8, -y]), f0, f1, { at: [s * 0.013, -0.013, 0], rot: [0, 0, s * 1.05] });
      fin(kit, edge(0.005, -0.016, [0.003, 0.02, 0.02, 0.005]).map(([z, y]) => [z - y * 0.6, -y]), f0, f1, { at: [s * 0.009, -0.018, 0], rot: [0, 0, s * 0.5] });
      for (const [z, y, L] of [[0.131, -0.005, 0.018], [0.119, -0.01, 0.024]]) kit.put(taper([[s * 0.0065, y, z], [s * 0.0125, y - L * 0.5, z + 0.004], [s * 0.015, y - L, z - 0.003]], 0.0014, 0.0005, 8, 4), C('#c89468'));
    }
    tail(kit, -0.097, 0.0125, 0.045, 0.031, 0.72, d0, f1);
    eyes(kit, 0.0125, 0.0085, 0.112, 0.0038, '#c0a050');
    face(kit, { gill: 0.083, gillW: 0.0165, gillY: 0.016, mouth: 0.134, mouthY: -0.0075, dark: C('#54452a') });
  },
  // A torpedo: blue-green above with black waving bars, silver below, finlets and a deeply forked tail
  mackerel(kit) {
    const back = C('#23606e'), bar = C('#0e2a34'), flank = C('#bfcdd2'), belly = C('#f2f1ec'), sheen = C('#c9a8c0'), f0 = C('#4a6a74'), f1 = C('#2e444c');
    putBody(kit, [[0.14, 0.003, 0.003, 0.003], [0.126, 0.0125, 0.011, 0.0095], [0.1, 0.0205, 0.018, 0.0145], [0.06, 0.0265, 0.0245, 0.0185], [0.01, 0.0265, 0.026, 0.0185], [-0.04, 0.019, 0.019, 0.013], [-0.08, 0.0095, 0.0095, 0.0068], [-0.106, 0.0042, 0.0042, 0.0036]],
      (u, h, z, o) => {
        shade(o, h, back, flank, belly, 0.3, -0.4);
        if (h > -0.1 && h < 0.35) o.lerp(sheen, 0.22 * smooth(-0.1, 0.1, h) * smooth(0.35, 0.15, h));
        const w = Math.sin(z * 250 + Math.sin(h * 9 + z * 40) * 1.6 + blot(z * 45, h * 5) * 2.2);
        if (u > 0.16 && h > 0.05) o.lerp(bar, smooth(0.05, 0.55, w) * smooth(0.08, 0.28, h) * 0.95);
        else if (u <= 0.16) o.lerp(bar, 0.25 * smooth(0.2, 0.7, h));
      }, 46, 20);
    fin(kit, edge(0.05, 0.012, [0.004, 0.022, 0.015, 0.009, 0.004]).map(([z, y]) => [z - y * 0.3, y]), f0, f1, { at: [0, 0.0235, 0] });
    fin(kit, edge(-0.03, -0.055, [0.003, 0.0125, 0.007, 0.004]).map(([z, y]) => [z - y * 0.4, y]), f0, f1, { at: [0, 0.0185, 0] });
    fin(kit, edge(-0.034, -0.058, [0.003, 0.0125, 0.007, 0.004]).map(([z, y]) => [z - y * 0.4, -y]), f0, f1, { at: [0, -0.0185, 0] });
    for (let i = 0; i < 5; i++) for (const s of [-1, 1]) { const z = -0.064 - i * 0.0085, y = 0.0135 - i * 0.0018; fin(kit, [[z, 0], [z - 0.007, s * 0.0055], [z - 0.0055, 0]], f0, f1, { at: [0, s * y, 0] }); }
    for (const s of [-1, 1]) {
      fin(kit, edge(0.076, 0.066, [0.002, 0.02, 0.012, 0.002]).map(([z, y]) => [z - y * 1.2, -y]), f0, f1, { at: [s * 0.0165, 0.003, 0], rot: [0, 0, s * 1.2] });
      fin(kit, edge(0.05, 0.04, [0.002, 0.014, 0.01, 0.002]).map(([z, y]) => [z - y * 0.7, -y]), C('#c8ccca'), f0, { at: [s * 0.008, -0.022, 0], rot: [0, 0, s * 0.5] });
    }
    tail(kit, -0.104, 0.005, 0.04, 0.034, 1, f0, f1);
    eyes(kit, 0.0118, 0.0045, 0.114, 0.0046, '#d8d8c8');
    face(kit, { gill: 0.08, gillW: 0.0168, gillY: 0.019, mouth: 0.1385, mouthY: -0.001, dark: C('#5a7078') });
  },
  // Deep and flat, silver with fine dark lines, a gold band between the eyes, a black spot at the gill, a spiny back fin
  sea_bream(kit) {
    const back = C('#5e6b74'), flank = C('#c3cacd'), belly = C('#eceae4'), gold = C('#e2b840'), spot = C('#20262c'), f0 = C('#8a949a'), f1 = C('#5c676e'), rose = C('#c88a74');
    putBody(kit, [[0.14, 0.004, 0.005, 0.004], [0.13, 0.022, 0.016, 0.0115], [0.108, 0.042, 0.029, 0.0185], [0.07, 0.058, 0.041, 0.022], [0.02, 0.058, 0.043, 0.0215], [-0.03, 0.043, 0.034, 0.016], [-0.072, 0.02, 0.018, 0.0085], [-0.1, 0.0125, 0.012, 0.005]],
      (u, h, z, o) => {
        shade(o, h, back, flank, belly, 0.55, -0.35);
        if (u > 0.24) o.multiplyScalar(1 - 0.16 * (0.5 + 0.5 * Math.cos((h + 1) * 62)) * smooth(-0.5, 0.2, h));
        if (u > 0.2) o.multiplyScalar(scales(z, h, 300, 0.07));
        o.lerp(gold, smooth(0.016, 0.004, Math.abs(z - 0.117)) * smooth(0.2, 0.55, h) * 0.95);
        o.lerp(gold, 0.5 * smooth(0.02, 0.006, Math.abs(z - 0.085)) * smooth(0.45, 0.1, Math.abs(h + 0.05)));
        o.lerp(spot, smooth(0.016, 0.007, Math.hypot((z - 0.058) * 1, (h - 0.42) * 0.045)));
      }, 34, 22);
    const top = z => 0.055 - 4.2 * Math.max(0, 0.03 - z) ** 2 - 4 * Math.max(0, z - 0.04) ** 2, low = z => -0.034 + 0.42 * Math.max(0, -0.018 - z);   // (the body's outline, for the long fins to follow)
    const ray = (z0, z1, hs) => { const n = 20; return [...Array.from({ length: n + 1 }, (_, i) => [z0 + ((z1 - z0) * i) / n, -0.004]).reverse(), ...Array.from({ length: n + 1 }, (_, i) => { const f = (i / n) * (hs.length - 1), k = Math.min(hs.length - 2, Math.floor(f)); return [z0 + ((z1 - z0) * i) / n, hs[k] + (hs[k + 1] - hs[k]) * (f - k) - 0.0016 * (i & 1)]; })]; };
    fin(kit, ray(0.068, -0.056, [0.003, 0.016, 0.022, 0.022, 0.02, 0.018, 0.017, 0.016, 0.012, 0.004]).map(([z, y]) => [z, y + top(z)]), f0, f1, { rays: 12 });
    fin(kit, ray(-0.018, -0.06, [0.003, 0.014, 0.016, 0.013, 0.004]).map(([z, y]) => [z, low(z) - y]), f0, f1);
    for (const s of [-1, 1]) {
      fin(kit, edge(0.062, 0.048, [0.002, 0.034, 0.036, 0.016, 0.002]).map(([z, y]) => [z - y * 1.35, -y * 0.75]), rose, f0, { at: [s * 0.0205, -0.004, 0], rot: [0, 0, s * 0.55] });
      fin(kit, edge(0.05, 0.034, [0.002, 0.026, 0.022, 0.004]).map(([z, y]) => [z - y * 0.8, -y]), f0, f1, { at: [s * 0.009, -0.036, 0], rot: [0, 0, s * 0.3] });
    }
    tail(kit, -0.098, 0.012, 0.042, 0.036, 0.85, f0, C('#3a444a'));
    eyes(kit, 0.0165, 0.0175, 0.108, 0.0072, '#d8d2b8');
    face(kit, { gill: 0.07, gillW: 0.0228, gillY: 0.032, mouth: 0.1385, mouthY: -0.004, dark: C('#6a7276') });
  },
  // An armoured little river lobster: the claws ahead, a segmented tail with its fan, eight legs and long feelers
  crayfish(kit) {
    const shell = C('#6e4128'), dark = C('#432819'), pale = C('#a5703f'), tipC = C('#c08a58');
    const armor = (x, y, z, o) => { mixTo(o, pale, shell, smooth(-0.5, 0.35, y)); o.multiplyScalar(0.8 + 0.4 * blot(x * 6 + z * 5, z * 7)); };
    kit.put(BALL, armor, [0, 0.016, 0.018], [0.0155, 0.0145, 0.036]);               // (the carapace)
    kit.put(new THREE.ConeGeometry(1, 1, 8), shell, [0, 0.022, 0.058], [0.0055, 0.02, 0.004], [Math.PI / 2, 0, 0]);   // (the rostrum)
    kit.put(tube([[-0.0135, 0.024, 0.012], [0, 0.031, 0.006], [0.0135, 0.024, 0.012]], 0.0011, 10, 4), dark);          // (the groove across it)
    for (let i = 0; i < 6; i++) { const k = 1 - i * 0.085; kit.put(BALL, armor, [0, 0.0145 - i * 0.0012, -0.02 - i * 0.0108], [0.0135 * k, 0.0115 * k, 0.0082]); kit.put(new THREE.TorusGeometry(1, 0.1, 5, 16), dark, [0, 0.0145 - i * 0.0012, -0.0255 - i * 0.0108], [0.0122 * k, 0.0102 * k, 0.006]); }
    for (const [a, w] of [[0, 1], [0.6, 1], [-0.6, 1], [1.15, 0.9], [-1.15, 0.9]]) kit.put(BALL, armor, [Math.sin(a) * 0.0115, 0.007, -0.086 - Math.cos(a) * 0.0095], [0.0062 * w, 0.0017, 0.0125], [0, a, 0]);
    for (const s of [-1, 1]) {
      kit.put(taper([[s * 0.011, 0.012, 0.042], [s * 0.026, 0.014, 0.052], [s * 0.031, 0.013, 0.07]], 0.0036, 0.0046, 8, 7), shell);
      kit.put(BALL, armor, [s * 0.033, 0.013, 0.086], [0.0105, 0.007, 0.0185], [0, s * -0.12, 0]);                      // (the claw: hand, finger, thumb)
      kit.put(taper([[s * 0.037, 0.013, 0.098], [s * 0.039, 0.0135, 0.112], [s * 0.033, 0.013, 0.126]], 0.0054, 0.0012, 8, 6), tipC);
      kit.put(taper([[s * 0.026, 0.013, 0.098], [s * 0.0235, 0.0135, 0.11], [s * 0.028, 0.013, 0.122]], 0.004, 0.001, 8, 6), tipC);
      for (let i = 0; i < 4; i++) { const z = 0.03 - i * 0.0125, a = 0.35 - i * 0.28; kit.put(taper([[s * 0.011, 0.011, z], [s * 0.027, 0.0185, z + a * 0.02], [s * 0.04, 0.003, z + a * 0.045]], 0.0022, 0.0009, 8, 5), pale); }
      kit.put(taper([[s * 0.005, 0.0185, 0.054], [s * 0.016, 0.03, 0.09], [s * 0.034, 0.03, 0.12], [s * 0.055, 0.018, 0.115]], 0.0011, 0.0003, 16, 4), tipC);
      kit.put(taper([[s * 0.0035, 0.0175, 0.057], [s * 0.007, 0.0215, 0.072], [s * 0.011, 0.021, 0.083]], 0.0009, 0.0004, 6, 4), tipC);
      kit.put(TUBE, pale, [s * 0.0065, 0.025, 0.047], [0.0016, 0.006, 0.0016], [0.5, 0, s * -0.5]);
      kit.put(BALL, new THREE.Color('#08090a'), [s * 0.0085, 0.0275, 0.05], 0.0026);
    }
  },
  // Rosy and speckled, see-through at the edges: the mantle and its two fins behind, big eyes, eight arms and two tentacles
  squid(kit) {
    const pale = C('#e2cfc6'), rose = C('#b57f78'), speck = C('#7e3c42'), arm = C('#d0a89e');
    const skin = (x, y, z, o) => { mixTo(o, pale, rose, smooth(-0.4, 0.9, y) * 0.75); const q = blot(x * 11 + 40, z * 26) * blot(z * 31, y * 9 + x * 7); if (q > 0.36) o.lerp(speck, 0.75 * smooth(0.36, 0.48, q)); };
    putBody(kit, [[0.03, 0.0185, 0.0185, 0.0185], [0.026, 0.0215, 0.021, 0.0215], [-0.01, 0.0225, 0.0215, 0.023], [-0.05, 0.0195, 0.0185, 0.02], [-0.09, 0.0125, 0.012, 0.013], [-0.122, 0.0055, 0.005, 0.0055], [-0.142, 0.0005, 0.0005, 0.0005]],
      (u, h, z, o) => skin(Math.cos(h * 2.4) * 0.8, h, z * 8, o), 34, 18);
    for (const s of [-1, 1]) {
      const g = new THREE.ShapeGeometry(new THREE.Shape([[0, -0.14], [0.022, -0.122], [0.0475, -0.092], [0.04, -0.072], [0.012, -0.058], [0, -0.052]].map(([x, z]) => new THREE.Vector2(s * x, z))), 6);
      g.rotateX(Math.PI / 2);
      kit.put(g, (x, y, z, o) => { mixTo(o, rose, pale, Math.abs(x) / 0.045); if (blot(x * 190, z * 190) > 0.72) o.lerp(speck, 0.6); }, [0, 0.006, 0], 1, [0, 0, s * 0.1]);
    }
    kit.put(BALL, (x, y, z, o) => skin(x, y, z, o), [0, 0.001, 0.042], [0.0165, 0.015, 0.0175]);
    for (const s of [-1, 1]) {
      kit.put(BALL, C('#d8dcd0'), [s * 0.0145, 0.003, 0.043], [0.0045, 0.0078, 0.0078]);
      kit.put(BALL, new THREE.Color('#060708'), [s * 0.0172, 0.003, 0.0435], [0.0028, 0.0048, 0.0056]);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.39, x = Math.cos(a), y = Math.sin(a), L = 0.056 + 0.01 * noise(i, 3), w = 0.012 + 0.008 * noise(i, 7);
      kit.put(taper([[x * 0.0085, y * 0.0085, 0.053], [x * 0.014, y * 0.012, 0.053 + L * 0.4], [x * (0.014 + w), y * 0.013 - 0.002, 0.053 + L * 0.8], [x * (0.012 + w * 1.5), y * 0.016 - 0.004, 0.053 + L]], 0.0046, 0.0009, 12, 6), (X, Y, Z, o) => mixTo(o, arm, speck, 0.35 * blot(X * 300, Z * 300)));
    }
    for (const s of [-1, 1]) {
      kit.put(taper([[s * 0.005, -0.004, 0.056], [s * 0.012, -0.009, 0.094], [s * 0.008, -0.012, 0.128]], 0.0022, 0.0016, 12, 5), pale);
      kit.put(BALL, arm, [s * 0.0085, -0.012, 0.1345], [0.0042, 0.0026, 0.0115], [0, s * -0.2, 0]);
    }
  },
};

// ---------- the angler's things ----------
const METAL = { copper: '#c07a42', brass: '#c9a24a', steel: '#8f969c', lead: '#6a6e72' };
// A hook: its shank from p down, the bend and the point (in the plane x–y, turned by yaw)
function hook(kit, p, L, yaw = 0, r = 0.0011) {
  const R = L * 0.36, g = taper([[0, 0, 0], [0, -L * 0.6, 0], [R * 0.12, -L * 0.9, 0], [R, -L, 0], [R * 1.75, -L * 0.8, 0], [R * 1.8, -L * 0.5, 0]], r, r * 0.45, 18, 5);
  kit.put(g, C(METAL.steel), p, 1, [0, yaw, 0]);
  kit.put(new THREE.ConeGeometry(r * 1.4, r * 5, 4), C(METAL.steel), [p[0] + Math.cos(yaw) * R * 1.65, p[1] - L * 0.56, p[2] - Math.sin(yaw) * R * 1.65], 1, [0, yaw, 0.6]);
}
const THINGS = {
  // Two earthworms, ringed, with the pale band
  worm(kit) {
    const one = (pts, k) => { const n = 46, g = taper(pts, 0.0062, 0.0062, n, 8), P = g.attributes.position, N = g.attributes.normal, body = C('#a5605a'), dark = C('#7d423f'), band = C('#cf9a88');
      let i = 0; const idx = g.index.array;
      for (let a = 0; a <= n; a++) { const u = a / n, f = smooth(-0.005, 0.05, u) * (0.65 + 0.35 * smooth(0, 0.14, u)) * smooth(1.005, 0.95, u) * (0.45 + 0.55 * smooth(1, 0.8, u)) * (1 + 0.07 * Math.cos(u * 150)) * (u > 0.24 && u < 0.34 ? 1.14 : 1) - 1; for (let b = 0; b <= 8; b++) { const v = a * 9 + b; P.setXYZ(v, P.getX(v) + N.getX(v) * 0.0062 * f, P.getY(v) + N.getY(v) * 0.0062 * f, P.getZ(v) + N.getZ(v) * 0.0062 * f); } }
      g.computeVertexNormals();
      kit.put(g, (x, y, z, o) => { const u = Math.floor(idx[i++] / 9) / n; mixTo(o, body, dark, 0.35 + 0.35 * Math.cos(u * 150) + (u < 0.2 ? 0.3 : 0)); if (u > 0.24 && u < 0.34) o.copy(band); }, [0, 0, 0], k); };
    one([[-0.055, 0, 0.012], [-0.035, 0.004, -0.018], [-0.008, 0.002, -0.012], [0.004, 0.008, 0.016], [0.028, 0.003, 0.02], [0.05, 0, -0.008], [0.062, 0.002, -0.026]], 1);
    one([[-0.03, 0.004, 0.034], [-0.012, 0.012, 0.022], [0.01, 0.016, -0.004], [0.004, 0.012, -0.03], [-0.018, 0.004, -0.036]], 0.9);
  },
  // Three steaks of a small fish: the skin silver and blue, the flesh pale with its red line and the bone
  cut_bait(kit) {
    const skin = C('#9fb2bd'), back = C('#3d5c6c'), flesh = C('#dfb3a2'), red = C('#9a3b38'), bone = C('#f0e8d8');
    const steak = (p, r, k) => {
      const g = new THREE.CylinderGeometry(1, 1, 1, 22, 1);
      kit.put(g, (x, y, z, o) => { if (Math.abs(y) > 0.49 && Math.hypot(x, z) < 0.94) { mixTo(o, flesh, red, smooth(0.5, 0.05, Math.abs(x)) * 0.55 * smooth(0.95, 0.4, Math.abs(z))); } else mixTo(o, skin, back, smooth(0.1, 0.6, z)); }, p, [0.022 * k, 0.022, 0.031 * k], r);
      const e = new THREE.Euler(...r), q = new THREE.Vector3(0, 0.0112, 0.002).applyEuler(e);
      kit.put(DISC, flesh, [p[0] + q.x * 0.98, p[1] + q.y * 0.98, p[2] + q.z], [0.0185 * k, 0.0008, 0.0265 * k], r);
      kit.put(DISC, red, [p[0] + q.x, p[1] + q.y, p[2] + q.z], [0.0062 * k, 0.0016, 0.011 * k], r);
      kit.put(BALL, bone, [p[0] + q.x * 1.02, p[1] + q.y * 1.02, p[2] + q.z], 0.0038 * k);
    };
    steak([-0.03, 0, 0.006], [0.12, 0.3, 0.1], 1);
    steak([0.026, 0.001, -0.02], [-0.1, -0.5, -0.12], 0.92);
    steak([0.016, 0.005, 0.034], [0.95, 0.5, 0.2], 0.82);
  },
  // A copper blade, dished and beaten, with a red line down it, its rings and a treble hook
  spoon(kit) {
    const copper = C(METAL.copper), shine = C('#f0c08a'), red = C('#a82a22');
    const g = new THREE.SphereGeometry(1, 26, 18), P = g.attributes.position;
    for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i), w = 0.62 + 0.38 * (1 - y) * 0.5; P.setXYZ(i, x * w, y, z * 0.1 - 0.42 * (1 - x * x) * (1 - y * y) * 0.6); }
    g.computeVertexNormals();
    kit.put(g, (x, y, z, o) => { mixTo(o, copper, shine, 0.6 * blot(x * 7 + 9, y * 9)); o.lerp(red, smooth(0.3, 0.16, Math.abs(x)) * smooth(0.8, 0.65, Math.abs(y))); }, [0, 0, 0], [0.0165, 0.034, 0.013]);
    kit.put(new THREE.TorusGeometry(1, 0.2, 6, 18), C(METAL.steel), [0, 0.037, -0.001], 0.0052);
    kit.put(new THREE.TorusGeometry(1, 0.2, 6, 18), C(METAL.steel), [0, -0.0365, -0.001], 0.0046, [0, 1.2, 0]);
    for (let i = 0; i < 3; i++) hook(kit, [0, -0.04, -0.001], 0.025, i * 2.094 + 0.5, 0.0012);
    kit.put(BALL, C(METAL.steel), [0, -0.044, -0.001], [0.0026, 0.004, 0.0026]);
  },
  // A lead head with its eye, a collar of red thread and a skirt of duck feathers over the hook
  jig(kit) {
    const white = C('#f0ebe0'), teal = C('#2f6a66'), red = C('#b23028');
    kit.put(BALL, (x, y, z, o) => mixTo(o, C('#e8dcc0'), teal, smooth(-0.25, 0.25, x + 0.2 * y)), [0, 0.022, 0], [0.0098, 0.0115, 0.0098]);
    for (const s of [-1, 1]) { kit.put(BALL, C('#e0c050'), [0.002, 0.024, s * 0.0088], [0.0036, 0.0036, 0.0016]); kit.put(BALL, new THREE.Color('#080808'), [0.002, 0.024, s * 0.0098], [0.0019, 0.0019, 0.0012]); }
    kit.put(new THREE.TorusGeometry(1, 0.28, 6, 16), C(METAL.steel), [0, 0.0355, 0], 0.0036);
    kit.put(TUBE, red, [0, 0.0105, 0], [0.0058, 0.0062, 0.0058]);
    for (let i = 0; i < 12; i++) {
      const a = i * 2.4, L = 0.052 + 0.016 * noise(i, 1), w = 0.0045, lean = 0.1 + 0.22 * noise(i, 2), sh = new THREE.Shape();
      sh.moveTo(0, 0); sh.quadraticCurveTo(w * 1.2, -L * 0.4, w * 0.35, -L); sh.lineTo(0, -L * 1.04); sh.quadraticCurveTo(-w * 1.2, -L * 0.5, 0, 0);
      const g = new THREE.ShapeGeometry(sh, 5);
      kit.put(g, (x, y, z, o) => { mixTo(o, i % 3 === 0 ? teal : white, i % 3 === 1 ? red : C('#8a8478'), clamp01(-y / L) * 0.45); if (Math.abs(x) < 0.0006) o.multiplyScalar(0.7); }, [Math.cos(a) * 0.0035, 0.01, Math.sin(a) * 0.0035], 1, [Math.sin(a) * lean, a, Math.cos(a) * lean]);
    }
    hook(kit, [0, 0.008, 0], 0.052, 0.2, 0.0013);
  },
  // A turned handle, an ash hoop and a knotted cord bag
  landing_net(kit) {
    const wood = (x, y, z, o) => mixTo(o, C('#c69a62'), C('#94683a'), blot(x * 3 + z * 3, y * 22)), cord = C('#e4d4ac'), grip = C('#6a4a2c');
    kit.put(new THREE.CylinderGeometry(0.0105, 0.013, 0.3, 10, 6), wood, [0, -0.17, 0]);
    kit.put(new THREE.CylinderGeometry(0.0142, 0.0148, 0.075, 10), grip, [0, -0.285, 0]);
    for (let i = 0; i < 5; i++) kit.put(new THREE.TorusGeometry(0.0147, 0.0014, 4, 14), cord, [0, -0.255 - i * 0.0145, 0], 1, [Math.PI / 2, 0, 0]);
    kit.put(BALL, grip, [0, -0.326, 0], 0.014);
    const hoop = []; for (let i = 0; i <= 24; i++) { const a = -Math.PI / 2 + (i / 24) * Math.PI * 2; hoop.push([Math.cos(a) * 0.12, 0.135 + Math.sin(a) * 0.155, 0]); }
    kit.put(tube(hoop, 0.0075, 48, 7), wood);
    kit.put(BALL, grip, [0, -0.02, 0], [0.02, 0.02, 0.014]);
    // (the bag: meridians from the hoop to the bottom and rings round it)
    const at = (a, k) => { const r = Math.cos(k * Math.PI / 2) ** 0.75; return [Math.cos(a) * 0.117 * r, 0.135 + Math.sin(a) * 0.15 * r - 0.03 * k, -0.15 * Math.sin(k * Math.PI / 2) ** 0.9]; };
    for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2, p = []; for (let k = 0; k <= 6; k++) p.push(at(a + (k & 1 ? 0.11 : 0), k / 6)); kit.put(tube(p, 0.0021, 12, 3), cord); }
    for (let k = 1; k < 6; k++) { const p = []; for (let i = 0; i <= 20; i++) { const q = at((i / 20) * Math.PI * 2, k / 6); q[2] += 0.003 * (i & 1 ? 1 : -1); p.push(q); } kit.put(tube(p, 0.002, 40, 3), cord); }
  },
};

// ---------- the catch, later (Plan R1-3) ----------
// The flesh of a fillet: chevrons that open towards the tail, the pale lines between them, the dark line along the middle
const FAT = new THREE.Color('#fff4ea'), flakes = (x, z, o, pale, deep, red) => { const w = Math.abs(x) / 0.03, v = Math.cos((z - w * 0.024) * 420); mixTo(o, deep, pale, 0.35 * blot(x * 90 + 4, z * 60)); o.lerp(FAT, 0.8 * smooth(0.72, 0.98, v)); o.lerp(red, 0.55 * smooth(0.0045, 0.001, Math.abs(x))); };
const KEPT = {
  // A side of fish on its skin: thick at the shoulder, thin at the belly and the tail, with a second one behind
  fillet(kit) {
    const pale = C('#eab8a0'), deep = C('#cf7f66'), red = C('#8e3b36'), skin = C('#8f9ba0'), back = C('#4c5c62');
    const one = (p, r, k) => {
      const rows = [[0.118, 0.002, 0.003, 0.012], [0.108, 0.009, 0.004, 0.027], [0.08, 0.0145, 0.005, 0.036], [0.03, 0.015, 0.005, 0.0365], [-0.03, 0.0125, 0.005, 0.031], [-0.08, 0.009, 0.004, 0.022], [-0.112, 0.006, 0.0035, 0.0135], [-0.126, 0.001, 0.002, 0.006]];
      const { geo, colors } = body(rows, (u, h, z, o) => o.setRGB(0, 0, 0), 44, 22); colors.length = 0;
      const P = geo.attributes.position;
      for (let i = 0; i < P.count; i++) { const x = P.getX(i), z = P.getZ(i), y = P.getY(i); P.setY(i, y + (y > 0 ? 0.0007 * Math.cos((z - Math.abs(x) * 0.8) * 420) : 0) + 0.004 * Math.sin(z * 22) + (x > 0 ? -0.1 : 0.05) * Math.abs(x)); }
      geo.computeVertexNormals();
      kit.put(geo, (x, y, z, o) => { const top = y - (0.004 * Math.sin(z * 22) + (x > 0 ? -0.1 : 0.05) * Math.abs(x)); if (top > 0.0006) { flakes(x, z, o, pale, deep, red); o.lerp(FAT, 0.5 * smooth(0.024, 0.037, Math.abs(x))); } else mixTo(o, skin, back, smooth(-0.01, 0.02, x) * 0.8 + 0.2 * blot(x * 120, z * 70)); }, p, k, r);
      geo.dispose();
    };
    one([-0.012, 0.018, -0.006], [0.1, 0.16, 0.14], 0.96);
    one([0.018, 0.002, 0.012], [0, -0.22, -0.04], 1);
  },
  // Split and dried flat: the kite shape, ribs showing in the flesh, the backbone, the skin's yellow edge, the tail, and salt
  salted_fish(kit) {
    const flesh = C('#e6d8b4'), dark = C('#c2a878'), edgeC = C('#a98e5a'), tailC = C('#9a8a64'), white = new THREE.Color('#fbfaf4');
    const N = 40, M = 18, pos = [], idx = [], half = u => 0.062 * Math.sin(Math.PI * Math.min(1, 0.16 + u * 0.95)) ** 0.8 * (1 - 0.82 * smooth(0.3, 1, u)) + 0.006;
    for (let side = 0; side < 2; side++) for (let i = 0; i <= N; i++) for (let j = 0; j <= M; j++) {
      const u = i / N, q = (j / M) * 2 - 1, w = half(u) * (1 + 0.05 * Math.sin(u * 31 + q * 2) * Math.abs(q)), z = 0.125 - u * 0.235;
      const rib = side ? 0 : 0.0016 * Math.cos((u * 46) + Math.abs(q) * 5.2) * (1 - Math.abs(q)) * smooth(0.03, 0.12, u);
      pos.push(q * w, (side ? -0.0035 : 0.0042 + 0.004 * (1 - q * q)) + rib + 0.009 * q * q * Math.sin(u * 7 + 0.6) + 0.004 * Math.sin(u * 9), z);
    }
    const V = (N + 1) * (M + 1);
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) { const a = i * (M + 1) + j, b = a + M + 1; idx.push(a, b, a + 1, b, b + 1, a + 1, a + V, a + V + 1, b + V, b + V, a + V + 1, b + V + 1); }
    const rim = []; for (let i = 0; i <= N; i++) rim.push(i * (M + 1)); for (let j = 1; j <= M; j++) rim.push(N * (M + 1) + j); for (let i = N - 1; i >= 0; i--) rim.push(i * (M + 1) + M); for (let j = M - 1; j >= 0; j--) rim.push(j);
    for (let i = 0; i + 1 < rim.length; i++) { const a = rim[i], b = rim[i + 1]; idx.push(a, a + V, b, b, a + V, b + V); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    kit.put(g, (x, y, z, o) => {
      const u = (0.125 - z) / 0.235, q = Math.abs(x) / half(Math.max(0, Math.min(1, u)));
      mixTo(o, flesh, dark, 0.2 + 0.35 * blot(x * 130 + 9, z * 90) + 0.3 * (0.5 + 0.5 * Math.cos(u * 46 + q * 5.2)) * (1 - q));
      o.lerp(edgeC, 0.75 * smooth(0.82, 0.97, q)); if (y < 0.0015 - 0.02 * q) o.lerp(edgeC, 0.4);
      if (blot(x * 520, z * 520) > 0.7) o.lerp(white, 0.75);
    });
    g.dispose();
    kit.put(tube([[0, 0.0085, 0.115], [0.0015, 0.0105, 0.05], [-0.001, 0.0095, -0.02], [0, 0.006, -0.09]], 0.0024, 24, 6), dark);
    for (let i = 0; i < 12; i++) for (const s of [-1, 1]) { const z = 0.1 - i * 0.0125, L = half((0.125 - z) / 0.235) * 0.72; kit.put(taper([[0, 0.0098, z], [s * L * 0.5, 0.0085, z - 0.006], [s * L, 0.0062, z - 0.016]], 0.0011, 0.0004, 5, 4), flesh); }
    const sh = new THREE.Shape([[0.005, -0.104], [0.03, -0.142], [0.012, -0.134], [0, -0.13], [-0.012, -0.134], [-0.03, -0.142], [-0.005, -0.104]].map(([x, z]) => new THREE.Vector2(x, -z))), T = new THREE.ShapeGeometry(sh, 4);
    T.rotateX(-Math.PI / 2); kit.put(T, (x, y, z, o) => { mixTo(o, tailC, edgeC, 0.5 + 0.5 * Math.cos(x * 700)); }, [0, 0.0035, 0]);
    for (let i = 0; i < 70; i++) { const u = 0.04 + 0.86 * noise(i, 1), q = (noise(i, 2) * 2 - 1) * 0.85, z = 0.125 - u * 0.235; kit.put(new THREE.BoxGeometry(1, 1, 1), white, [q * half(u), 0.008 + 0.004 * (1 - q * q) + 0.009 * q * q * Math.sin(u * 7 + 0.6) + 0.004 * Math.sin(u * 9) - 0.003, z], 0.0016 + 0.0018 * noise(i, 3), [noise(i, 4) * 3, noise(i, 5) * 3, 0]); }
  },
  // A dead fish past its time: sunk, grey and slimy green, a clouded eye, the belly burst on the ribs, rags for fins and flies
  rotten_fish(kit) {
    const back = C('#5c6146'), flank = C('#9c9a78'), belly = C('#c4b48c'), slime = C('#5f7a3a'), rot = C('#3a2a22'), gut = C('#5c2f2c'), f0 = C('#8a8668'), f1 = C('#66624a'), bone = C('#d8cca8');
    putBody(kit, [[0.14, 0.004, 0.0045, 0.004], [0.126, 0.015, 0.015, 0.011], [0.1, 0.025, 0.026, 0.016], [0.06, 0.026, 0.034, 0.0175], [0.02, 0.0215, 0.03, 0.0155], [-0.03, 0.019, 0.02, 0.0115], [-0.072, 0.0135, 0.0125, 0.0075], [-0.1, 0.0095, 0.009, 0.005], [-0.112, 0.009, 0.0085, 0.004]],
      (u, h, z, o) => {
        shade(o, h, back, flank, belly, 0.45, -0.4); o.multiplyScalar(scales(z, h, 240, 0.12));
        const q = blot(z * 55 + 3, h * 2.6), r = blot(z * 38 + 11, h * 3.4 + 5);
        o.lerp(slime, 0.7 * smooth(0.5, 0.78, q)); o.lerp(rot, 0.85 * smooth(0.6, 0.82, r));
        const hole = smooth(0.03, 0.012, Math.hypot(z - 0.038, (h + 0.42) * 0.05)); o.lerp(gut, hole); o.lerp(rot, 0.6 * hole * blot(z * 200, h * 12));
      }, 36, 20);
    for (let i = 0; i < 5; i++) for (const s of [-1, 1]) { const z = 0.056 - i * 0.0085; kit.put(taper([[s * 0.0155, -0.004, z], [s * 0.018, -0.014, z - 0.003], [s * 0.0115, -0.026, z - 0.006]], 0.0012, 0.0006, 6, 4), bone); }
    fin(kit, edge(0.04, -0.03, [0.003, 0.016, 0.004, 0.014, 0.006, 0.011, 0.002]), f0, f1, { at: [0, 0.0205, 0] });
    fin(kit, edge(-0.03, -0.062, [0.003, 0.012, 0.004, 0.009, 0.002]).map(([z, y]) => [z, -y]), f0, f1, { at: [0, -0.016, 0] });
    for (const s of [-1, 1]) fin(kit, edge(0.07, 0.054, [0.002, 0.018, 0.006, 0.014, 0.002]).map(([z, y]) => [z - y * 0.9, -y]), f0, f1, { at: [s * 0.015, -0.012, 0], rot: [0, 0, s * 0.8] });
    fin(kit, [[-0.104, 0.008], [-0.132, 0.026], [-0.126, 0.014], [-0.139, 0.012], [-0.128, 0.003], [-0.137, -0.004], [-0.126, -0.009], [-0.134, -0.022], [-0.104, -0.008]], f0, f1, { rays: 1 });
    for (const s of [-1, 1]) { kit.put(BALL, rot, [s * 0.0115, 0.0055, 0.112], [0.0032, 0.0062, 0.0062]); kit.put(BALL, C('#c9cbb8'), [s * 0.0132, 0.0052, 0.1118], [0.0028, 0.0046, 0.0046]); }
    face(kit, { gill: 0.08, gillW: 0.0165, gillY: 0.022, mouth: 0.1385, mouthY: -0.0015, dark: rot });
    for (const [x, y, z] of [[0.0135, 0.016, 0.03], [-0.011, 0.019, -0.012], [0.0165, -0.008, 0.078], [0.006, 0.0235, 0.07]]) {
      kit.put(BALL, new THREE.Color('#15181c'), [x, y + 0.0022, z], [0.0019, 0.0019, 0.0034]); kit.put(BALL, C('#5a1f1c'), [x, y + 0.0026, z + 0.0034], 0.0013);
      for (const s of [-1, 1]) kit.put(new THREE.CircleGeometry(1, 6), C('#aab0b4'), [x + s * 0.002, y + 0.0042, z - 0.0012], [0.0015, 0.0034, 1], [-1.2, s * 0.5, 0]);
    }
  },
  // A little sack, its mouth rolled down, heaped with coarse salt
  salt(kit) {
    const cloth = C('#c8b58c'), seam = C('#8f7a52'), white = new THREE.Color('#f7f6f1'), grey = C('#cfd2d2');
    const pts = [[0.001, -0.05], [0.04, -0.05], [0.0505, -0.038], [0.052, -0.012], [0.047, 0.012], [0.0405, 0.026], [0.0425, 0.031], [0.0465, 0.033], [0.048, 0.029], [0.0455, 0.024]].map(p => new THREE.Vector2(...p)), g = new THREE.LatheGeometry(pts, 36), P = g.attributes.position;
    for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i), a = Math.atan2(z, x), k = 1 + 0.035 * Math.sin(a * 5 + y * 40) + 0.02 * Math.sin(a * 11) + 0.05 * Math.sin(a * 2 + 1); P.setXYZ(i, x * k, y, z * k); }
    g.computeVertexNormals();
    kit.put(g, (x, y, z, o) => { o.copy(cloth).multiplyScalar(0.82 + 0.1 * Math.cos(y * 1500) + 0.1 * Math.cos(Math.atan2(z, x) * 90) + 0.1 * blot(x * 60, z * 60 + y * 40)); if (y > 0.027) o.lerp(seam, 0.25); });
    g.dispose();
    const heap = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), H = heap.attributes.position;
    for (let i = 0; i < H.count; i++) { const x = H.getX(i), y = H.getY(i), z = H.getZ(i), k = 1 + 0.06 * (blot(x * 9 + 4, z * 9 + y * 5) - 0.5); H.setXYZ(i, x * k, y * k, z * k); }
    heap.computeVertexNormals();
    kit.put(heap, (x, y, z, o) => mixTo(o, white, grey, 0.8 * blot(x * 14 + 30, z * 14 + y * 9)), [0, 0.016, 0], [0.041, 0.028, 0.041]);
    for (let i = 0; i < 90; i++) { const a = noise(i, 1) * 6.283, r = Math.sqrt(noise(i, 2)) * 0.038; kit.put(new THREE.BoxGeometry(1, 1, 1), i % 4 ? white : grey, [Math.cos(a) * r, 0.016 + 0.028 * Math.sqrt(Math.max(0, 1 - (r / 0.041) ** 2)), Math.sin(a) * r], 0.0028 + 0.0026 * noise(i, 3), [noise(i, 4) * 3, noise(i, 5) * 3, noise(i, 6) * 3]); }
    kit.put(tube([[0.049, 0.004, 0.012], [0.056, -0.004, 0.018], [0.05, -0.02, 0.022], [0.057, -0.032, 0.016]], 0.0016, 12, 5), seam);
  },
};

// (the long things are drawn upright; laid along z, their broad side to the side, as a fish is seen)
const LAID = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)), LONG = new Set(['spoon', 'jig', 'landing_net']);
const make = (f, material, laid) => g => { const k = new Kit(); f(k); const m = k.mesh(material()); if (laid) m.geometry.applyMatrix4(LAID); g.add(m); };
export const FISH_MODELS = Object.fromEntries(Object.entries(FISHES).map(([id, f]) => [id, make(f, wet)]));
export const KEPT_MODELS = Object.fromEntries(Object.entries(KEPT).map(([id, f]) => [id, make(f, id === 'fillet' || id === 'rotten_fish' ? wet : dry)]));
export const TACKLE_MODELS = Object.fromEntries(Object.entries(THINGS).map(([id, f]) => [id, make(f, id === 'landing_net' ? dry : id === 'spoon' ? shiny : wet, LONG.has(id))]));
