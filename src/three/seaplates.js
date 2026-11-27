// The sea-life plates of the nature book (Plan G-2): a model of each seabed find, drawn once for its page by three/plates.js
// and let go. The seabed itself (three/seabed3d.js) draws them as a few triangles each, as they are seen from a metre or more
// under the water; a plate is seen up close, so here they have their real shapes: a scallop with its ribs, growth bands and
// the two ears of its hinge; a clump of kelp, its blades wavy and twisted, on its holdfast; three mussels tied by their
// threads, one a little open; and two oysters, rough and layered, one opened on its mother-of-pearl with a pearl.
//
//   seaModel(kind) → THREE.Group (kind: 'seashell' | 'seaweed' | 'mussel' | 'oyster'; null for anything else). Each call
//     makes new geometries, listed in userData.made (the plates free them); the materials are shared and stay.
import * as THREE from 'three';

let MATS = null;
function mats() {
  if (MATS) return MATS;
  return (MATS = {
    // (both faces: a mirrored valve, the lower one or the left one, has its triangles the other way round)
    shell: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide }),
    weed: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide }),
    dark: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.05, side: THREE.DoubleSide }),
    nacre: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0.12, side: THREE.DoubleSide }),
    thread: new THREE.MeshStandardMaterial({ color: '#6b5a3c', roughness: 0.9 }),
    pearl: new THREE.MeshStandardMaterial({ color: '#efe9de', roughness: 0.18, metalness: 0.1 }),
  });
}
// (a fixed noise, so a plate is the same every time it is drawn)
const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
const smooth = (a, b) => { const x = Math.floor(a), y = Math.floor(b), fx = a - x, fy = b - y, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy); return (hash(x, y) * (1 - u) + hash(x + 1, y) * u) * (1 - v) + (hash(x, y + 1) * (1 - u) + hash(x + 1, y + 1) * u) * v; };
// A grid surface: f(i / nu, j / nv, out vec3, out color) for each point; two triangles per cell
function grid(nu, nv, f) {
  const pos = [], col = [], idx = [], p = new THREE.Vector3(), c = new THREE.Color();
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { f(i / nu, j / nv, p, c); pos.push(p.x, p.y, p.z); col.push(c.r, c.g, c.b); }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, d = a + nu + 1, e = d + 1; idx.push(a, d, b, b, d, e); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function add(group, geo, mat, made, at = [0, 0, 0], rot = [0, 0, 0], scale = 1) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...at); m.rotation.set(...rot); m.scale.setScalar(scale);
  made.push(geo); group.add(m);
  return m;
}

// ---------- a scallop ----------
// The fan: 2.5 rad wide, 18 ribs, the growth bands across them; cream with rose-brown bands. The lower valve, flatter, under it
function scallop(made) {
  const g = new THREE.Group(), M = mats(), W = 1.25, R = 0.055, base = new THREE.Color('#e7d9c3'), band = new THREE.Color('#b6866c'), rib = new THREE.Color('#f3e8d6');
  const valve = (dome, flip) => grid(64, 22, (u, v, p, c) => {
    const th = (u * 2 - 1) * W, r = 0.08 + 0.92 * v, ribs = Math.pow(Math.abs(Math.cos(th * 9)), 0.6), edge = 1 + 0.035 * ribs * r;
    // (convex, highest about the middle of the fan and down to the rim, where the two valves meet)
    const hump = Math.pow(Math.sin(Math.PI * Math.min(1, r * 0.98)), 0.75) * (1 - 0.25 * Math.abs(th / W));
    p.set(Math.sin(th) * r * R * edge, (dome * hump * R + ribs * 0.0022 * hump) * flip, Math.cos(th) * r * R * edge - R * 0.45);
    const bands = 0.5 + 0.5 * Math.sin(r * 34 + smooth(th * 3, r * 4) * 2);
    c.copy(base).lerp(band, (bands > 0.7 ? 0.55 : 0.1) * (0.6 + 0.4 * r)).lerp(rib, ribs * 0.35);
    if (flip < 0) c.multiplyScalar(0.86);
  });
  add(g, valve(0.3, 1), M.shell, made, [0, 0.003, 0]);
  add(g, valve(0.12, -1), M.shell, made, [0, 0.003, 0]);
  // (the two ears at the hinge: flat wings either side of the beak)
  for (const s of [-1, 1]) add(g, grid(6, 4, (u, v, p, c) => { p.set(s * (0.004 + u * 0.017), 0.0012 + 0.001 * v, -R * 0.45 + (v - 0.5) * 0.012 * (1 - 0.5 * u) - 0.004); c.set('#d9c7ab').multiplyScalar(0.92 + 0.08 * Math.sin(u * 20)); }), M.shell, made);
  g.rotation.y = -0.5;
  return g;
}

// ---------- kelp ----------
// Five blades from a stipe on a lumpy holdfast, each 0.5-0.95 m, wavy at the edges, twisting and bending as the current left
// them; olive brown, darker at the base and along the midrib, paler and thinner at the tip
function kelp(made) {
  const g = new THREE.Group(), M = mats(), dark = new THREE.Color('#3f3a1c'), mid = new THREE.Color('#6d6428'), tip = new THREE.Color('#a39448');
  add(g, grid(14, 8, (u, v, p, c) => { const a = u * Math.PI * 2, b = v * Math.PI / 2, k = 0.85 + 0.3 * smooth(u * 9, v * 4); p.set(Math.cos(a) * Math.cos(b) * 0.055 * k, Math.sin(b) * 0.04 * k, Math.sin(a) * Math.cos(b) * 0.055 * k); c.set('#4a4122').multiplyScalar(0.8 + 0.3 * smooth(u * 12, v * 6)); }), M.weed, made);
  const blades = [[0.95, 0.13, 0.22, 0.0], [0.8, 0.11, -0.4, 1.3], [0.72, 0.12, 0.5, 2.5], [0.6, 0.1, -0.2, 3.9], [0.52, 0.1, 0.35, 5.1]];
  for (const [L, w, bend, yaw] of blades) {
    add(g, grid(10, 30, (u, v, p, c) => {
      const s = u * 2 - 1, wv = w * Math.sin(Math.PI * Math.min(1, v * 1.15)) * (1 - 0.35 * v) * (1 + 0.18 * Math.sin(v * 38 + yaw * 3) * Math.abs(s));
      const tw = v * 1.4 + yaw * 0.2, x = s * wv, ry = 0.02 * Math.abs(s) * Math.sin(v * 30 + yaw);   // (the ruffles of the edges)
      const bx = bend * v * v * L, by = v * L * (1 - 0.18 * Math.abs(bend) * v);
      p.set(bx + x * Math.cos(tw), by + ry + 0.03, x * Math.sin(tw) + 0.06 * Math.sin(v * 3 + yaw) * v);
      c.copy(dark).lerp(mid, Math.min(1, v * 2.2)).lerp(tip, Math.max(0, v - 0.55) * 1.6).multiplyScalar(1 - 0.22 * (1 - Math.abs(s)));
    }), M.weed, made, [0, 0, 0], [0, yaw, 0]);
  }
  return g;
}

// ---------- mussels ----------
// A valve: long and pointed at the beak, rounded at the back, blue-black with a violet sheen and fine growth lines; open,
// the inside shows its pale blue mother-of-pearl
function musselValve(L, side, inside = false) {
  return grid(24, 12, (u, v, p, c) => {
    const a = v * Math.PI, prof = Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.92 + 0.04)), 0.7) * (0.35 + 0.65 * u), w = 0.21 * prof * L, k = inside ? 0.96 : 1;
    p.set(side * Math.sin(a) * w * 0.8 * k, Math.cos(a) * w * k, (u - 0.5) * L * k);
    if (inside) c.set('#b9c4cf').lerp(new THREE.Color('#e4e2ea'), 0.5 + 0.5 * Math.sin(u * 9 + v * 4));
    else c.set('#22232d').lerp(new THREE.Color('#4a3f5e'), 0.25 + 0.25 * Math.sin(u * 60) * Math.sin(v * 3)).multiplyScalar(0.9 + 0.2 * v);
  });
}
function mussels(made) {
  const g = new THREE.Group(), M = mats();
  // (each lying on one valve: the seam of the two flat; the open one with its upper valve lifted on the hinge, its back edge)
  const one = (L, at, yaw, open) => {
    const s = new THREE.Group(), top = 0.21 * L * 0.8;
    for (const side of [-1, 1]) {
      const h = new THREE.Group();
      h.position.y = top;
      add(h, musselValve(L, side), M.dark, made, [0, -top, 0]);
      if (open) add(h, musselValve(L, side, true), M.nacre, made, [0, -top, 0]);
      h.rotation.z = open && side > 0 ? -0.35 : 0;
      s.add(h);
    }
    const lie = new THREE.Group();
    lie.add(s); s.rotation.z = Math.PI / 2;
    lie.position.set(...at); lie.rotation.y = yaw;
    g.add(lie);
  };
  one(0.075, [0, 0.013, 0], 0.35, false);
  one(0.068, [0.028, 0.012, -0.03], 1.2, false);
  one(0.062, [-0.03, 0.011, -0.022], -0.7, true);
  // (the byssus: the threads that tie them to the stone)
  for (let i = 0; i < 9; i++) {
    const a = i * 0.7, curve = new THREE.CatmullRomCurve3([new THREE.Vector3(Math.cos(a) * 0.004, 0.006, Math.sin(a) * 0.004 - 0.012), new THREE.Vector3(Math.cos(a) * 0.01, 0.002, Math.sin(a) * 0.01 - 0.018), new THREE.Vector3(Math.cos(a) * 0.016, 0, Math.sin(a) * 0.016 - 0.022)]);
    const geo = new THREE.TubeGeometry(curve, 6, 0.0008, 3);
    made.push(geo); g.add(new THREE.Mesh(geo, M.thread));
  }
  return g;
}

// ---------- oysters ----------
// A rough, flattened shell with a wavy outline and layers lapped like roof tiles, grey-brown with a purple-brown lip; the open
// one shows its white mother-of-pearl and a pearl
function oysterValve(R, seed, cup, inside = false) {
  return grid(40, 12, (u, v, p, c) => {
    const a = u * Math.PI * 2, out = 0.78 + 0.28 * smooth(Math.cos(a) * 2 + seed, Math.sin(a) * 2) + 0.12 * Math.sin(a * 7 + seed);
    const r = v * R * out * (1 + 0.25 * Math.cos(a)), layer = inside ? 0 : 0.003 * Math.floor(v * 6) * (1 - v) + 0.0015 * smooth(u * 30, v * 8);
    p.set(Math.cos(a) * r, (cup * (1 - v * v) * R + layer) * (inside ? 0.85 : 1), Math.sin(a) * r * 0.78);
    if (inside) c.set('#ece9e4').lerp(new THREE.Color('#c9c6d6'), 0.5 + 0.5 * Math.sin(u * 13 + v * 7)).lerp(new THREE.Color('#6b5868'), v > 0.9 ? 0.5 : 0);
    else c.set('#7d766a').lerp(new THREE.Color('#5e4c55'), v > 0.82 ? 0.55 : 0).lerp(new THREE.Color('#a59c8a'), smooth(u * 24, v * 10) * 0.45).multiplyScalar(0.75 + 0.35 * (Math.floor(v * 6) % 2 ? 1 : 0.85));
  });
}
function oysters(made) {
  const g = new THREE.Group(), M = mats();
  // (a closed one, its cupped valve under and the flat one on it)
  const closed = new THREE.Group();
  add(closed, oysterValve(0.06, 3.1, -0.38), M.shell, made);
  add(closed, oysterValve(0.056, 5.7, 0.14), M.shell, made, [0, 0.004, 0]);
  closed.position.set(0.075, 0.018, -0.045); closed.rotation.set(0.05, 0.6, 0.12);
  g.add(closed);
  // (the open one: its cup with the mother-of-pearl and a pearl, the lid lifted back on its hinge)
  const open = new THREE.Group();
  add(open, oysterValve(0.065, 1.7, -0.42), M.shell, made);
  add(open, oysterValve(0.06, 1.7, -0.36, true), M.nacre, made, [0, 0.003, 0]);
  const lid = new THREE.Group();
  add(lid, oysterValve(0.06, 8.3, 0.12), M.shell, made, [0.055, 0, 0]);
  add(lid, oysterValve(0.056, 8.3, 0.1, true), M.nacre, made, [0.055, -0.002, 0]);
  lid.position.set(-0.058, 0.004); lid.rotation.z = 1.9;
  open.add(lid);
  const pearl = new THREE.SphereGeometry(0.0075, 16, 12);
  add(open, pearl, M.pearl, made, [0.008, 0.009, 0.004]);
  open.position.set(-0.03, 0.022, 0.02);
  g.add(open);
  return g;
}

const MAKERS = { seashell: scallop, seaweed: kelp, mussel: mussels, oyster: oysters };
export function seaModel(kind) {
  const f = MAKERS[kind];
  if (!f) return null;
  const made = [], g = f(made);
  g.userData.made = made;
  return g;
}
