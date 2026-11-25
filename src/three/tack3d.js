// The bridle (Plan R4-4, taken from Plan F phase 2 §5.1): a headstall with its browband, noseband, throatlatch, cheekpieces and
// two bit rings, laid on the head of any breed. It is made from the same shape the head is (animals.js horseModel: shape(v, n), a
// point n of the unit sphere to where it is on the head), so it lies on its skin whatever the breed; its pieces are merged with the
// head, so it costs no draw call. About 430 triangles. In the head mesh's own space (z along the face, +z the muzzle)
import * as THREE from 'three';

export const TACK = { leather: '#3b2012', dark: '#2c180d', steel: '#aab1b8', brass: '#b28b3e' };
const CACHE = new Map();
const v = new THREE.Vector3(), n = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();

// Where the skin is: z (-1 the poll, 1 the muzzle), th round the head (0 its left, +x; 90° the face, -90° the jaw)
function skin(shape, z, th, out) {
  const s = Math.sqrt(Math.max(0, 1 - z * z));
  n.set(Math.cos(th) * s, Math.sin(th) * s, z); v.copy(n);
  shape(v, n);
  return out.copy(v);
}
const E = 0.02;
function frame(shape, z, th) {
  const p = skin(shape, z, th, new THREE.Vector3());
  a.subVectors(skin(shape, z, th + E, b), skin(shape, z, th - E, c));
  const dz = new THREE.Vector3().subVectors(skin(shape, Math.min(0.985, z + E), th, b), skin(shape, Math.max(-0.985, z - E), th, c));
  return { p, n: new THREE.Vector3().crossVectors(a, dz).normalize() };
}
// A strap through the points path [[z, th]…] (in steps): w wide, t thick, lift off the skin. Four points a section: its two edges
// on the skin and its face
function strap(shape, path, steps, w, t, lift = 0.001, closed = false) {
  const P = [], total = path.length - 1;
  for (let i = 0; i <= steps; i++) {
    const k = i / steps * total, j = Math.min(total - 1, Math.floor(k)), f = k - j, q = path[j], r = path[j + 1];
    P.push(frame(shape, q[0] + (r[0] - q[0]) * f, q[1] + (r[1] - q[1]) * f));
  }
  const pos = [], idx = [], tan = new THREE.Vector3(), side = new THREE.Vector3();
  for (let i = 0; i <= steps; i++) {
    const A = P[closed ? (i + steps - 1) % steps : Math.max(0, i - 1)], B = P[closed ? (i + 1) % steps : Math.min(steps, i + 1)], S = P[i];
    tan.subVectors(B.p, A.p).normalize();
    side.crossVectors(S.n, tan).normalize();
    for (const [x, h] of [[-0.5, -0.004], [-0.42, t], [0.42, t], [0.5, -0.004]]) pos.push(S.p.x + side.x * w * x + S.n.x * (h + lift), S.p.y + side.y * w * x + S.n.y * (h + lift), S.p.z + side.z * w * x + S.n.z * (h + lift));
  }
  for (let i = 0; i < steps; i++) for (let j = 0; j < 3; j++) { const m = i * 4 + j; idx.push(m, m + 4, m + 1, m + 1, m + 4, m + 5); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function ring(shape, z, th, r, t, out, a = 4, b = 9) {
  const { p, n: nn } = frame(shape, z, th), g = new THREE.TorusGeometry(r, t, a, b);
  g.deleteAttribute('uv');
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), nn);
  const at = p.clone().addScaledVector(nn, 0.006);
  g.applyMatrix4(new THREE.Matrix4().compose(at, q, new THREE.Vector3(1, 1, 1)));
  out?.copy(at);
  return g;
}
const D = Math.PI / 180;
// Where the straps go: crown behind the ears, brow in front of them, nose under the cheekbone, the bit at the corner of the mouth
const Z = { crown: -0.9, brow: -0.64, throat: -0.6, cheek: -0.5, nose: 0.3, bit: 0.66 };

// { parts: [[geometry, colour]…], bits: [left, right], chin }, all in the head mesh's space; made once for each key, shared
export function bridle(shape, key) {
  if (CACHE.has(key)) return CACHE.get(key);
  const parts = [], bits = [new THREE.Vector3(), new THREE.Vector3()], chin = new THREE.Vector3();
  const L = TACK.leather;
  parts.push([strap(shape, [[Z.nose, 0], [Z.nose, 360 * D]], 14, 0.022, 0.006, 0.0015, true), L]);
  parts.push([strap(shape, [[-0.8, 4 * D], [Z.brow, 40 * D], [Z.brow + 0.02, 90 * D], [Z.brow, 140 * D], [-0.8, 176 * D]], 8, 0.018, 0.006, 0.0025), L]);
  parts.push([strap(shape, [[-0.8, 0], [Z.crown, 45 * D], [Z.crown, 135 * D], [-0.8, 180 * D]], 6, 0.022, 0.006, 0.002), L]);
  parts.push([strap(shape, [[-0.8, 0], [Z.throat, -40 * D], [Z.throat + 0.04, -90 * D], [Z.throat, -140 * D], [-0.8, -180 * D]], 7, 0.013, 0.006, 0.006), TACK.dark]);
  for (const s of [0, 1]) {
    const m = th => (s ? Math.PI - th : th);
    parts.push([strap(shape, s ? [[Z.bit - 0.06, m(-14 * D)], [Z.nose, m(-3 * D)], [-0.2, m(4 * D)], [-0.8, m(2 * D)]] : [[-0.8, 2 * D], [-0.2, 4 * D], [Z.nose, -3 * D], [Z.bit - 0.06, -14 * D]], 9, 0.015, 0.006, 0.003), L]);
    parts.push([ring(shape, Z.bit, m(-16 * D), 0.024, 0.0048, bits[s], 3, 8), TACK.steel]);
    const { p, n: nn } = frame(shape, -0.36, m(3 * D)), bk = new THREE.BoxGeometry(0.022, 0.02, 0.006);
    bk.deleteAttribute('uv');
    parts.push([bk.applyMatrix4(new THREE.Matrix4().compose(p.addScaledVector(nn, 0.01), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), nn), new THREE.Vector3(1, 1, 1))), TACK.brass]);
  }
  parts.push([ring(shape, Z.nose, -90 * D, 0.018, 0.004, chin, 3, 7), TACK.steel]);
  const out = { parts, bits, chin };
  CACHE.set(key, out);
  return out;
}
