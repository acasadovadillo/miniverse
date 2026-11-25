// The chapel's art (docs/planes/gta/PLAN-H-pueblo-vivo.md §7): the pew and the stone doorway with its bell (piece bell_gable,
// a door like any other under it). Stone and timber are those of the houses (build3d.js baseMaterials, through emit)
import * as THREE from 'three';
import { WALL_H, T, DOOR, ROOF } from './build3d.js';
import { mat } from './geo.js';

// ---------- the bell gable ----------
const W = 0.66, D = 0.2;                    // half its width along the wall and half its depth
const ARCH = { half: 0.31, rise: 0.78 };    // the opening of the bell: half its width, and its height up to where the arch starts
const BELL = { r: 0.215, h: 0.4 };
let MATS = null;
const mats = () => (MATS ||= { bronze: mat({ color: '#6f5a34', metalness: 0.75, roughness: 0.42 }), yoke: mat({ color: '#4a3b2c', roughness: 0.9 }), iron: mat({ color: '#2e2c2a', metalness: 0.5, roughness: 0.6 }) });

// Over the door of a bell_gable (d: what doorTile gave): the doorway's dressed stones, the pillar that climbs through the
// roof and the arch on top. Gives the bell's place: { x, y, z, X } (lift not counted)
export function bellGable(scene, tx, ty, d, emit) {
  const X = d.X, c = (X ? ty : tx) + 0.5, u0 = (X ? tx : ty) + 0.5, out = d.outSign || 1, side = d.side;
  const roof = scene.roofAt?.(tx, ty), lvl = roof ? scene.roofGeometry?.(tx, ty, new Map())?.h.c ?? 0 : 0;
  const top = Math.max(WALL_H + 0.5, WALL_H + (roof ? ROOF.thick + lvl * ROOF.level : 0) + 0.12);
  const P = (u, y, k) => (X ? [u0 + u, y, c + k] : [c + k, y, u0 + u]), N = (u, y, k) => (X ? [u, y, k] : [k, y, u]);
  const S = emit('wallStone', side), K = emit('ashlar', side);
  const box = (B, a0, a1, y0, y1, k0, k1, o = { s: 0.9 }) => { const p = P(a0, y0, k0), q = P(a1, y1, k1); B.roundBox(Math.min(p[0], q[0]), y0, Math.min(p[2], q[2]), Math.max(p[0], q[0]), y1, Math.max(p[2], q[2]), 0.018, o); };
  // The doorway: dressed stones up the jambs, uneven, and a lintel with its keystone, on the outside
  const f0 = out * (T - 0.02), f1 = out * (T + 0.075);
  for (const s of [-1, 1]) for (let i = 0, y = 0; i < 6; i++) { const h = 0.345, w = i % 2 ? 0.2 : 0.28, a = s * (DOOR.half + 0.06), b = s * (DOOR.half + 0.06 + w); box(K, Math.min(a, b), Math.max(a, b), y + 0.004, y + h - 0.004, f0, f1); y += h; }
  box(K, -0.78, -0.13, DOOR.y1 + 0.06, DOOR.y1 + 0.4, f0, f1); box(K, 0.13, 0.78, DOOR.y1 + 0.06, DOOR.y1 + 0.4, f0, f1); box(K, -0.125, 0.125, DOOR.y1 + 0.03, DOOR.y1 + 0.46, f0, out * (T + 0.1));
  // The pillar, from over the lintel to above the roof, and its two cornices
  const yw = WALL_H - 0.34;
  { const p = P(-W, yw, -D), q = P(W, top, D); S.box(Math.min(p[0], q[0]), yw, Math.min(p[2], q[2]), Math.max(p[0], q[0]), top, Math.max(p[2], q[2]), { s: 1 }); }
  box(K, -W - 0.05, W + 0.05, yw - 0.1, yw, -D - 0.03, D + 0.03);
  box(K, -W - 0.07, W + 0.07, top, top + 0.11, -D - 0.06, D + 0.06);
  // The arch: two piers with their imposts, the ring and what is over it, up to the two slopes
  const y0 = top + 0.11, ys = y0 + ARCH.rise, ya = ys + ARCH.half, yc = ya + 0.12, yt = yc + 0.5;
  for (const s of [-1, 1]) {
    const a = s * ARCH.half, b = s * W, p = P(Math.min(a, b), y0, -D), q = P(Math.max(a, b), ys, D);
    S.box(Math.min(p[0], q[0]), y0, Math.min(p[2], q[2]), Math.max(p[0], q[0]), ys, Math.max(p[2], q[2]), { s: 1 });
    box(K, Math.min(a - s * 0.03, b + s * 0.03), Math.max(a - s * 0.03, b + s * 0.03), ys - 0.09, ys, -D - 0.025, D + 0.025);
  }
  const roofY = u => yc + (yt - yc) * (1 - Math.abs(u) / (W + 0.02)), n = 14;
  for (const k of [-D, D]) {
    const nn = N(0, 0, Math.sign(k));
    const quad = (B, p) => B.quadN(...p.map(q => P(q[0], q[1], k)), nn, p.map(q => [q[0], q[1]]));
    for (const s of [-1, 1]) quad(S, [[s * ARCH.half, ys], [s * W, ys], [s * W, roofY(W)], [s * ARCH.half, roofY(ARCH.half)]]);
    for (let i = 0; i < n; i++) {
      const a = Math.PI * i / n, b = Math.PI * (i + 1) / n, pa = [Math.cos(a) * ARCH.half, ys + Math.sin(a) * ARCH.half], pb = [Math.cos(b) * ARCH.half, ys + Math.sin(b) * ARCH.half];
      quad(S, [pa, pb, [pb[0], roofY(pb[0])], [pa[0], roofY(pa[0])]]);
    }
  }
  // (the inside of the arch, and its voussoirs, a little proud)
  for (let i = 0; i < n; i++) {
    const a = Math.PI * i / n, b = Math.PI * (i + 1) / n, m = (a + b) / 2, r = ARCH.half;
    S.quadN(P(Math.cos(a) * r, ys + Math.sin(a) * r, -D), P(Math.cos(b) * r, ys + Math.sin(b) * r, -D), P(Math.cos(b) * r, ys + Math.sin(b) * r, D), P(Math.cos(a) * r, ys + Math.sin(a) * r, D), N(-Math.cos(m), -Math.sin(m), 0), [[0, 0], [0.08, 0], [0.08, 0.4], [0, 0.4]]);
  }
  const V = 7;
  for (let i = 0; i < V; i++) {
    const a = Math.PI * (i + 0.05) / V, b = Math.PI * (i + 0.95) / V, r0 = ARCH.half - 0.004, r1 = ARCH.half + (i === 3 ? 0.2 : 0.15), e = D + 0.03;
    const q = (t, r) => [Math.cos(t) * r, ys + Math.sin(t) * r], [A, B2, C2, D2] = [q(a, r0), q(b, r0), q(b, r1), q(a, r1)];
    for (const k of [-e, e]) K.quadN(P(...A, k), P(...B2, k), P(...C2, k), P(...D2, k), N(0, 0, Math.sign(k)), [[0, 0], [0.14, 0], [0.16, 0.15], [0, 0.15]]);
    for (const [p, r] of [[A, B2], [B2, C2], [C2, D2], [D2, A]]) { const mx = (p[0] + r[0]) / 2 - (A[0] + C2[0]) / 2, my = (p[1] + r[1]) / 2 - (A[1] + C2[1]) / 2; for (const s of [-1, 1]) K.quadN(P(...p, s * D), P(...r, s * D), P(...r, s * e), P(...p, s * e), N(mx, my, 0), [[0, 0], [0.15, 0], [0.15, 0.03], [0, 0.03]]); }
  }
  // (the outer sides over the piers)
  for (const s of [-1, 1]) S.quadN(P(s * W, ys, -D), P(s * W, ys, D), P(s * W, roofY(W), D), P(s * W, roofY(W), -D), N(s, 0, 0), [[0, ys], [2 * D, ys], [2 * D, roofY(W)], [0, roofY(W)]]);
  // The two slopes of its top, in slabs, and the finial
  const e = D + 0.09, th = 0.09;
  for (const s of [-1, 1]) {
    const u1 = s * (W + 0.1), y1 = roofY(W + 0.1), p = (u, y, k) => P(u, y, k), a = [0, yt + 0.01], b = [u1, y1], nn = N(s * (yt - y1), W + 0.1, 0);
    K.quadN(p(a[0], a[1] + th, -e), p(a[0], a[1] + th, e), p(b[0], b[1] + th, e), p(b[0], b[1] + th, -e), nn, [[0, 0], [0.4, 0], [0.4, 0.8], [0, 0.8]]);
    K.quadN(p(a[0], a[1], -e), p(a[0], a[1], e), p(b[0], b[1], e), p(b[0], b[1], -e), nn.map(v => -v), [[0, 0], [0.4, 0], [0.4, 0.8], [0, 0.8]]);
    for (const k of [-e, e]) K.quadN(p(a[0], a[1], k), p(b[0], b[1], k), p(b[0], b[1] + th, k), p(a[0], a[1] + th, k), N(0, 0, Math.sign(k)), [[0, 0], [0.8, 0], [0.8, 0.09], [0, 0.09]]);
    K.quadN(p(b[0], b[1], -e), p(b[0], b[1], e), p(b[0], b[1] + th, e), p(b[0], b[1] + th, -e), N(s, 0, 0), [[0, 0], [0.4, 0], [0.4, 0.09], [0, 0.09]]);
  }
  box(K, -0.1, 0.1, yt + 0.02, yt + 0.26, -0.1, 0.1); box(K, -0.14, 0.14, yt + 0.26, yt + 0.31, -0.14, 0.14);
  const bc = P(0, ya - 0.02, 0);
  return { x: bc[0], y: bc[1], z: bc[2], X };
}
// The bell: hung from its wooden yoke at (0, 0, 0), it swings round it. A lathe of the profile of a bell, with its lip, and
// its iron straps
export function bellMesh(X) {
  const g = new THREE.Group(), M = mats(), { r, h } = BELL;
  const pts = [[0.02, -0.1], [0.075, -0.105], [0.1, -0.13], [0.115, -0.19], [0.13, -0.27], [0.155, -0.36], [0.19, -0.43], [r, -0.1 - h + 0.015], [r + 0.004, -0.1 - h], [r - 0.028, -0.1 - h], [0.15, -0.4], [0.11, -0.28]];
  const bell = new THREE.Mesh(new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), 24), M.bronze);
  bell.material.side = THREE.DoubleSide;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.008, 6, 24), M.bronze); ring.rotation.x = Math.PI / 2; ring.position.y = -0.29;
  const yoke = new THREE.Mesh(new THREE.BoxGeometry(ARCH.half * 2 + 0.04, 0.13, 0.13), M.yoke); yoke.position.y = -0.035;
  const clap = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), M.iron); clap.position.y = -0.47;
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 6), M.iron); rod.position.y = -0.31;
  const tongue = new THREE.Group(); tongue.add(clap, rod);
  g.add(bell, ring, yoke, tongue);
  for (const x of [-0.06, 0.06]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.2, 0.145), M.iron); st.position.set(x, -0.045, 0); g.add(st); }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.own = true; } });
  const hang = new THREE.Group(); hang.add(g); if (!X) hang.rotation.y = Math.PI / 2;
  hang.userData = { swing: g, tongue };
  return hang;
}

// ---------- the pew ----------
// Two places (its tile and the one on its right, +x), facing +z: plank seat, a back that leans a little with its book ledge
// behind, two shaped ends and a foot rail
export function pew(m) {
  const x0 = -0.46, x1 = 1.46, zb = -0.26, zf = 0.2;
  for (const [a, b] of [[x0, x0 + 0.06], [x1 - 0.06, x1]]) {   // the ends: a board with a rounded shoulder
    m.box('dark', a, 0, zb - 0.06, b, 0.1, zf + 0.06).box('wood', a + 0.005, 0.1, zb - 0.04, b - 0.005, 0.62, zf + 0.02).box('wood', a + 0.005, 0.62, zb - 0.05, b - 0.005, 0.86, zb + 0.14);
    m.geo('wood', new THREE.CylinderGeometry(0.1, 0.1, b - a - 0.01, 14), (a + b) / 2, 0.86, zb + 0.045, [0, 0, Math.PI / 2]);
    m.geo('dark', new THREE.CylinderGeometry(0.055, 0.055, b - a + 0.016, 12), (a + b) / 2, 0.86, zb + 0.045, [0, 0, Math.PI / 2]);
  }
  for (let i = 0; i < 3; i++) m.box(i === 1 ? 'wood' : 'plank', x0 + 0.06, 0.41, zb + 0.06 + i * 0.135, x1 - 0.06, 0.45, zb + 0.185 + i * 0.135);   // the seat's boards
  m.box('dark', x0 + 0.06, 0.33, zf - 0.03, x1 - 0.06, 0.41, zf).box('dark', 0.47, 0, zb + 0.08, 0.53, 0.41, zf - 0.05);
  for (const [y, h, z] of [[0.6, 0.15, zb + 0.035], [0.77, 0.14, zb + 0.005]]) m.geo('wood', new THREE.BoxGeometry(x1 - x0 - 0.12, h, 0.032), 0.5, y, z, [-0.17, 0, 0]);
  m.geo('dark', new THREE.BoxGeometry(x1 - x0 - 0.1, 0.045, 0.06), 0.5, 0.87, zb - 0.015, [-0.17, 0, 0]);
  m.box('wood', x0 + 0.06, 0.64, zb - 0.16, x1 - 0.06, 0.665, zb - 0.02).box('dark', x0 + 0.06, 0.1, zb - 0.1, x1 - 0.06, 0.14, zb - 0.02);   // the ledge and the rail behind
}
