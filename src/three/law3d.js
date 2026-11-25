// The law's art (docs/planes/gta/PLAN-H-pueblo-vivo.md §7): the iron bars and the cell's door (pieces iron_bars and cell_door), the
// constable's desk and his armband (the posters: poster3d.js). The stone and timber are the houses' (build3d.js)
import * as THREE from 'three';
import { Builder, mat } from './geo.js';
import { WALL_H, DOOR, outward, wallMask } from './build3d.js';   // (a cycle, read only inside functions)
import { ihash } from '../util.js';

// ---------- the bars ----------
const STEP = 0.125, R = 0.0135, SILL = 0.14, HEAD = 0.18, HALF = 0.075;
const UV4 = [[0, 0], [1, 0], [1, 1], [0, 1]];
// A round bar from y0 to y1
function bar(B, x, z, y0, y1, r = R, n = 6) {
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2, b = (i + 1) / n * Math.PI * 2, m = (a + b) / 2, P = (q, y) => [x + Math.cos(q) * r, y, z + Math.sin(q) * r];
    B.quadN(P(a, y0), P(b, y0), P(b, y1), P(a, y1), [Math.cos(m), 0, Math.sin(m)], UV4);
  }
}
// A length of bars along an axis (X or not), from a to b, on the line c: a stone sill, a beam over it, two flat irons and the bars
function grille(emit, side, X, c, a, b, { y0 = SILL, sill = true } = {}) {
  const box = (key, u0, u1, v0, v1, k, o) => { const B = emit(key, side); if (X) B.box(u0, v0, c - k, u1, v1, c + k, o); else B.box(c - k, v0, u0, c + k, v1, u1, o); };
  const I = emit('iron', side), top = WALL_H - HEAD;
  if (sill) box('stone', a, b, 0, SILL, HALF + 0.035);
  box('timber', a, b, top, WALL_H, HALF + 0.02);
  const flats = [y0 + 0.16, 1.18, 2.12, top - 0.14].filter(y => y > y0);
  for (const y of flats) box('iron', a, b, y, y + 0.032, 0.022);
  for (let k = Math.ceil((a + 0.02) / STEP); k * STEP < b - 0.005; k++) { const u = (k + 0.5) * STEP; if (u > b - 0.01) continue; bar(I, X ? u : c, X ? c : u, y0, top); for (const y of flats) box('iron', u - 0.021, u + 0.021, y - 0.006, y + 0.038, 0.03); }
}
// The piece iron_bars: a wall that can be seen through
export function barsTile(scene, tx, ty, emit) {
  const mask = wallMask(scene, tx, ty), cx = tx + 0.5, cz = ty + 0.5, xs = [mask & 1 ? 1 : 0, mask & 2 ? -1 : 0].filter(Boolean), zs = [mask & 4 ? 1 : 0, mask & 8 ? -1 : 0].filter(Boolean);
  const post = side => { emit('timber', side).box(cx - 0.085, 0, cz - 0.085, cx + 0.085, WALL_H, cz + 0.085); };
  if (!zs.length || !xs.length) {
    const X = !zs.length, side = outward(scene, tx, ty, X), u0 = X ? tx : ty;
    grille(emit, side, X, X ? cz : cx, u0, u0 + 1);
    // (an end with nothing to hold it: a post)
    for (const [bit, u] of X ? [[2, tx + 0.085], [1, tx + 0.915]] : [[8, ty + 0.085], [4, ty + 0.915]]) if (!(mask & bit)) emit('timber', side).box(X ? u - 0.085 : cx - 0.085, 0, X ? cz - 0.085 : u - 0.085, X ? u + 0.085 : cx + 0.085, WALL_H, X ? cz + 0.085 : u + 0.085);
    return;
  }
  const sx = outward(scene, tx, ty, true), sz = outward(scene, tx, ty, false);
  for (const s of xs) grille(emit, sx, true, cz, s > 0 ? cx + 0.085 : tx, s > 0 ? tx + 1 : cx - 0.085);
  for (const s of zs) grille(emit, sz, false, cx, s > 0 ? cz + 0.085 : ty, s > 0 ? ty + 1 : cz - 0.085);
  post(sz !== 'in' && sz !== 'free' ? sz : sx);
}
// The piece cell_door: its jambs, the bars over it, and what its leaf needs (as build3d.js doorTile)
export function cellDoorTile(scene, tx, ty, emit) {
  const solid = (x, y) => { const p = scene.pieceAt(x, y); return p && p.kind !== 'fence' && p.kind !== 'gate'; };
  const X = solid(tx - 1, ty) || solid(tx + 1, ty) || !(solid(tx, ty - 1) || solid(tx, ty + 1));
  const side = outward(scene, tx, ty, X), u0 = X ? tx : ty, c = X ? ty + 0.5 : tx + 0.5, h0 = u0 + 0.5 - DOOR.half, h1 = u0 + 0.5 + DOOR.half, I = emit('iron', side);
  const box = (key, a, b, v0, v1, k) => { const B = emit(key, side); if (X) B.box(a, v0, c - k, b, v1, c + k); else B.box(c - k, v0, a, c + k, v1, b); };
  for (const [a, b] of [[h0 - 0.05, h0], [h1, h1 + 0.05]]) box('iron', a, b, 0, WALL_H - HEAD, 0.035);
  box('iron', h0 - 0.05, h1 + 0.05, DOOR.y1, DOOR.y1 + 0.06, 0.035);
  box('timber', u0, u0 + 1, WALL_H - HEAD, WALL_H, HALF + 0.02);
  box('stone', u0, u0 + 1, 0, 0.035, HALF + 0.035);
  for (let i = 1; i < 7; i++) { const u = h0 + (h1 - h0) * i / 7; bar(I, X ? u : c, X ? c : u, DOOR.y1 + 0.06, WALL_H - HEAD); }
  for (const [a, b] of [[u0, h0 - 0.05], [h1 + 0.05, u0 + 1]]) if (b - a > 0.01) { box('stone', a, b, 0, SILL, HALF + 0.035); box('iron', a, b, 1.18, 1.212, 0.022); box('iron', a, b, 2.12, 2.152, 0.022); }
  const outSign = side === 's' || side === 'e' ? 1 : side === 'n' || side === 'w' ? -1 : 1, swing = side === 'in' || side === 'free' ? outSign : -outSign;
  const hinge = X ? [h0 + 0.02, 0, c + swing * 0.06] : [c + swing * 0.06, 0, h0 + 0.02];
  return { tile: [tx, ty], X, outSign, swing, side, hinge, width: DOOR.half * 2 - 0.03, bars: true };
}
// Its leaf: a frame, the bars, the box of the lock and its ring
export function cellDoorLeaf(d, mats) {
  const B = new Builder(), lw = d.width, H = DOOR.y1 - 0.03, f = 0.034, k = 0.018;
  for (const [x0, x1] of [[0, f], [lw - f, lw]]) B.box(x0, 0.06, -k, x1, H, k);
  for (const y of [0.06, 0.66, 1.02, 1.5, H - f]) B.box(f, y, -k, lw - f, y + f, k);
  for (let i = 1; i < 6; i++) bar(B, f + (lw - 2 * f) * i / 6, 0, 0.09, H - 0.02);
  B.box(lw - 0.2, 1.0, -0.045, lw - 0.01, 1.2, 0.045); B.box(lw - 0.115, 1.07, -0.05, lw - 0.095, 1.12, 0.05);
  for (const y of [0.25, 1.75]) B.box(-0.03, y, -0.026, 0.06, y + 0.09, 0.026);
  const g = new THREE.Group();
  g.position.set(...d.hinge);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.008, 6, 16), mats.iron); ring.position.set(lw - 0.105, 0.98, d.swing * 0.05); ring.userData.own = true;
  g.add(B.mesh(mats.iron), ring);
  const along = d.X ? [1, 0] : [0, 1], out = d.X ? [0, d.swing] : [d.swing, 0], beta = 1.75;
  g.userData.setAngle = a => { const b = beta * a, dx = along[0] * Math.cos(b) + out[0] * Math.sin(b), dz = along[1] * Math.cos(b) + out[1] * Math.sin(b); g.rotation.y = Math.atan2(-dz, dx); };
  return g;
}

// ---------- the desk ----------
// Two tiles (its own and the one on its right, +x), its panelled front to +z; who sits at it, on the other side. On top: the
// ledger open with its pen, the inkwell, papers, a candle and the keys of the cell
const cyl = (r, h, n = 12) => new THREE.CylinderGeometry(r, r, h, n);
export function desk(m) {
  const x0 = -0.42, x1 = 1.42, zb = -0.3, zf = 0.3, H = 0.74;
  for (const [a, b] of [[x0, x0 + 0.5], [x1 - 0.5, x1]]) {   // two pedestals with their drawers, behind
    m.box('wood', a, 0.07, zb, b, H, zf - 0.02).box('dark', a + 0.02, 0, zb + 0.02, b - 0.02, 0.07, zf - 0.04);
    for (let i = 0; i < 3; i++) { const y = 0.12 + i * 0.205; m.box('light', a + 0.035, y, zb - 0.014, b - 0.035, y + 0.18, zb).ball('brass', (a + b) / 2, y + 0.09, zb - 0.024, 0.016); }
  }
  m.box('wood', x0 + 0.5, 0.16, zf - 0.06, x1 - 0.5, H, zf - 0.03);                 // the modesty board between them
  for (let i = 0; i < 3; i++) {   // the front: three raised panels
    const w = (x1 - x0 - 0.06) / 3, a = x0 + 0.03 + w * i + 0.05, b = x0 + 0.03 + w * (i + 1) - 0.05;
    m.box('light', a, 0.16, zf - 0.025, b, H - 0.1, zf - 0.005).box('wood', a + 0.06, 0.22, zf - 0.015, b - 0.06, H - 0.16, zf + 0.006);
  }
  m.box('dark', x0, 0, zf - 0.03, x1, 0.1, zf);
  m.box('dark', x0 - 0.03, H, zb - 0.04, x1 + 0.03, H + 0.015, zf + 0.04).box('wood', x0 - 0.05, H + 0.015, zb - 0.06, x1 + 0.05, H + 0.05, zf + 0.06);
  const T = H + 0.05;
  m.box('leatherD', 0.1, T, -0.2, 0.98, T + 0.004, 0.2);                              // the writing leather
  m.box('leather', 0.33, T + 0.004, -0.16, 0.75, T + 0.016, 0.14).box('sheet', 0.345, T + 0.016, -0.15, 0.535, T + 0.034, 0.13).box('sheet', 0.545, T + 0.016, -0.15, 0.735, T + 0.03, 0.13);   // the ledger
  for (let i = 0; i < 6; i++) m.box('soot', 0.365, T + 0.0345, -0.12 + i * 0.037, 0.45 + ihash(i, 3, 7) * 0.06, T + 0.0355, -0.117 + i * 0.037);
  m.geo('white', cyl(0.004, 0.2, 5), 0.64, T + 0.05, 0.0, [Math.PI / 2 - 0.15, 0, 0.6]);
  m.geo('dark0', cyl(0.028, 0.05, 14), 0.86, T + 0.025, -0.1).geo('brass', cyl(0.018, 0.012, 12), 0.86, T + 0.056, -0.1);
  m.box('sheet', -0.2, T, -0.12, 0.02, T + 0.012, 0.16).box('sheet', -0.185, T + 0.012, -0.1, 0.03, T + 0.02, 0.17).geo('stone', new THREE.SphereGeometry(0.035, 10, 8), -0.08, T + 0.04, 0.04);
  m.box('books1', 1.06, T, -0.2, 1.24, T + 0.04, 0.02).box('books4', 1.07, T + 0.04, -0.19, 1.25, T + 0.075, 0.03).box('books3', 1.08, T + 0.075, -0.18, 1.22, T + 0.11, 0.0);
  m.geo('brass', cyl(0.055, 0.012, 16), -0.3, T + 0.006, -0.16).geo('brass', cyl(0.012, 0.05, 10), -0.3, T + 0.035, -0.16).geo('candle', cyl(0.018, 0.11, 10), -0.3, T + 0.11, -0.16);
  m.geo('iron', new THREE.TorusGeometry(0.05, 0.006, 6, 18), 0.98, T + 0.008, 0.12, [Math.PI / 2, 0, 0]);             // the keys, on their ring
  for (const [a, l] of [[0.4, 0.1], [0.9, 0.085], [1.5, 0.095]]) m.box('iron', 0.98 + Math.cos(a) * 0.05, T + 0.002, 0.12 + Math.sin(a) * 0.05, 0.99 + Math.cos(a) * 0.05 + 0.012, T + 0.01, 0.12 + Math.sin(a) * 0.05 + l);
}

// ---------- the constable's armband ----------
const CLOTH = mat({ color: '#7c2a26', roughness: 0.95, side: THREE.DoubleSide }), PLATE = mat({ color: '#b98f3e', metalness: 0.75, roughness: 0.34 });
// Round the left sleeve (P: a RealPerson): a band of red cloth with its brass plate, plain and oval
export function armband(P) {
  const b = P.r?.bones?.armL, v = new THREE.Vector3(), M = new THREE.Matrix4();
  if (!b || P.band) return null;
  const y0 = -0.17, y1 = -0.11;   // (down the upper arm, from the shoulder)
  let n = 0, mx = 0, mz = 0; const pts = [];
  P.r.root.traverse(o => {
    if (!o.isSkinnedMesh) return;
    const sk = o.skeleton, i = sk.bones.indexOf(b), si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight, pos = o.geometry.attributes.position;
    if (i < 0 || !si) return;
    M.multiplyMatrices(sk.boneInverses[i], o.bindMatrix);
    for (let j = 0; j < pos.count; j += 2) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (si.getComponent(j, k) === i) w += sw.getComponent(j, k);
      if (w < 0.5) continue;
      v.fromBufferAttribute(pos, j).applyMatrix4(M);
      if (v.y > y0 - 0.05 && v.y < y1 + 0.05) { pts.push([v.x, v.z]); mx += v.x; mz += v.z; n++; }
    }
  });
  if (n < 8) return null;
  mx /= n; mz /= n;
  const rad = Math.max(0.045, Math.min(0.1, pts.map(p => Math.hypot(p[0] - mx, p[1] - mz)).sort((a, c) => a - c)[Math.floor(pts.length * 0.96)])) + 0.004;
  const g = new THREE.Group(), band = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad * 0.985, y1 - y0, 20, 1, true), CLOTH);
  const plate = new THREE.Mesh(new THREE.SphereGeometry(0.024, 16, 10), PLATE); plate.scale.set(0.2, 1, 0.78); plate.position.set(rad * (b.position.x < 0 ? -1 : 1), 0, 0);
  g.add(band, plate);
  g.position.set(mx, (y0 + y1) / 2, mz);
  g.traverse(o => { if (o.isMesh) o.receiveShadow = true; });
  b.add(g);
  P.band = g;
  return g;
}
