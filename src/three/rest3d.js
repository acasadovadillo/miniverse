// The rod rest's two forked sticks, with their bark, a turn of cord and the earth at their foot (Plan R1-4, src/rodrest.js): a
// model of models.js (m). +z is the water's side.
import * as THREE from 'three';

export const BACK = [0, 0.235, -0.33], FRONT = [0, 0.53, 0.2];   // where the rod lies on each

const GEO = new Map();
const made = (k, f) => { if (!GEO.has(k)) GEO.set(k, f()); return GEO.get(k); };
const stick = (k, pts, r0, r1) => made(k, () => {
  const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), n = 10, g = new THREE.TubeGeometry(curve, n, 1, 7), P = g.attributes.position, q = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= n; i++) { curve.getPointAt(i / n, q); const r = r0 + (r1 - r0) * (i / n) + 0.0012 * Math.sin(i * 2.7); for (let j = 0; j <= 7; j++) { const a = i * 8 + j; v.fromBufferAttribute(P, a).sub(q).multiplyScalar(r).add(q); P.setXYZ(a, v.x, v.y, v.z); } }
  g.computeVertexNormals();
  return g;
});
export function rodRest(m) {
  const one = (k, z, h, lean) => {
    const f = h - 0.085;   // (the fork)
    m.geo('wood', stick(`${k}s`, [[0, -0.06, z - lean], [0.008, f * 0.45, z - lean * 0.5], [0, f, z]], 0.0165, 0.013), 0, 0, 0);
    m.geo('wood', stick(`${k}l`, [[0, f - 0.012, z], [-0.028, f + 0.04, z + 0.002], [-0.047, h + 0.03, z]], 0.0115, 0.0085), 0, 0, 0);
    m.geo('wood', stick(`${k}r`, [[0, f - 0.012, z], [0.026, f + 0.045, z - 0.002], [0.04, h + 0.045, z + 0.003]], 0.0125, 0.0085), 0, 0, 0);
    for (const [x, y] of [[-0.047, h + 0.03], [0.04, h + 0.045]]) m.geo('light', made('cut', () => new THREE.SphereGeometry(0.0088, 7, 5)), x, y, z, [0, 0, 0], [1, 0.45, 1]);
    // (a few turns of cord under the fork, and the earth trodden round its foot)
    for (let i = 0; i < 3; i++) m.geo('rope', made('turn', () => new THREE.TorusGeometry(0.0165, 0.0028, 5, 12)), 0, f - 0.018 - i * 0.0058, z - 0.001, [Math.PI / 2 + 0.06 * (i - 1), 0, 0]);
    m.geo('soil', made('mound', () => new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2)), 0, -0.004, z - lean, [0, k === 'f' ? 0.4 : 1.3, 0], [0.055, 0.02, 0.05]);
  };
  one('f', FRONT[2], FRONT[1], 0.03);
  one('b', BACK[2], BACK[1], 0.012);
  m.solids.length = 0;
  m.solids.push([-0.05, 0, BACK[2] - 0.03, 0.05, FRONT[1] + 0.05, FRONT[2] + 0.03]);
}
