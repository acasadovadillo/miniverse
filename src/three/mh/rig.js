// The game's skeleton on a MakeHuman person (plan CR P5, ?creador=nuevo): the 23 bones with the names actors.js writes
// (real/persona.js), placed on MakeHuman's joint helpers, which move with the shape, and the CC0 game-engine weights folded
// onto them (tools/mh_pack.py, body.skin). The person is built in the rest pose those bones expect: standing, arms hanging
// straight by the sides and the legs under the hips (MakeHuman's base stands in an A, the legs apart), so the poses of
// today (sit, ride, swim, tools, gestures) move it unchanged. A bound mesh (clothes, hair, eyes…) takes the weights of its
// three base vertices, so whatever is bound to the body comes along.
import * as THREE from 'three';
import { joint, fit } from './shape.js';
import { proxy } from './data.js';

export const BONES = ['body', 'spine', 'torso', 'neck', 'head', 'clavL', 'armL', 'foreL', 'handL', 'legL', 'shinL', 'footL', 'toeL',
  'clavR', 'armR', 'foreR', 'handR', 'legR', 'shinR', 'footR', 'toeR'];
export const PARENT = { body: null, spine: 'body', torso: 'spine', neck: 'torso', head: 'neck' };
const JOINT_OF = { spine: 'joint-spine-3', torso: 'joint-spine-2', neck: 'joint-neck', head: 'joint-head' };
for (const [S, s] of [['L', 'l'], ['R', 'r']]) {
  Object.assign(PARENT, { ['clav' + S]: 'torso', ['arm' + S]: 'clav' + S, ['fore' + S]: 'arm' + S, ['hand' + S]: 'fore' + S, ['leg' + S]: 'body', ['shin' + S]: 'leg' + S, ['foot' + S]: 'shin' + S, ['toe' + S]: 'foot' + S });
  Object.assign(JOINT_OF, { ['clav' + S]: `joint-${s}-clavicle`, ['arm' + S]: `joint-${s}-shoulder`, ['fore' + S]: `joint-${s}-elbow`, ['hand' + S]: `joint-${s}-hand`,
    ['leg' + S]: `joint-${s}-upper-leg`, ['shin' + S]: `joint-${s}-knee`, ['foot' + S]: `joint-${s}-ankle`, ['toe' + S]: `joint-${s}-foot-1` });
}
// Where the rest pose points each limb (as real/persona.js: the arm a touch out from the side, the forearm a touch forward;
// the thigh and the shin straight down). L is +x, as MakeHuman's l
const ARM = [0.05, -1, 0], FORE = [0.06, -1, 0.05], LEG = [-0.01, -1, 0.01], SHIN = [0, -1, -0.01];
// The low body of the middle distance (LOD1): MakeHuman's own, about 3,100 triangles
export const lodOf = sex => (sex === 'chico' ? 'male1591' : 'female1605');

// The pack's skin weights (four bones and weights per kept vertex; bone k of the pack's list, which is BONES)
const SKIN = new WeakMap();
function bodySkin(D) {
  let s = SKIN.get(D);
  if (!s) SKIN.set(D, (s = D.view('body.skin', Uint8Array)));
  return s;
}
export const hasRig = D => !!D.head.bones && !!bodySkin(D);

// The weights of a bound mesh's vertices: its three base vertices' weights by their barycentric weights (top four)
export function partSkin(D, d, nv) {
  const W = bodySkin(D), idx = new Uint8Array(nv * 4), w = new Float32Array(nv * 4), acc = new Float32Array(BONES.length);
  for (let i = 0; i < nv; i++) {
    acc.fill(0);
    for (let k = 0; k < 3; k++) {
      const r = d.refs[i * 3 + k], bw = Math.abs(d.w[i * 3 + k]);
      if (bw < 1e-4) continue;
      for (let j = 0; j < 4; j++) acc[W[r * 8 + j]] += bw * W[r * 8 + 4 + j] / 255;
    }
    top4(acc, idx, w, i);
  }
  return { idx, w };
}
function top4(acc, idx, w, i) {
  let sum = 0;
  for (let j = 0; j < 4; j++) {
    let best = 0;
    for (let b = 1; b < acc.length; b++) if (acc[b] > acc[best]) best = b;
    idx[i * 4 + j] = best; w[i * 4 + j] = acc[best]; sum += acc[best]; acc[best] = -1;
  }
  if (sum <= 0) { idx[i * 4] = 0; w[i * 4] = 1; return; }
  for (let j = 0; j < 4; j++) w[i * 4 + j] = Math.max(0, w[i * 4 + j]) / sum;
}
// The body's own (base vertex i)
export function baseSkin(D, i, idx, w, o) {
  const W = bodySkin(D);
  for (let j = 0; j < 4; j++) { idx[o * 4 + j] = W[i * 8 + j]; w[o * 4 + j] = W[i * 8 + 4 + j] / 255; }
}

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
// The rest pose, as MhPerson's restPose hook (person.js): the joints of the blended base, a turn for each limb to point as
// the game's skeleton expects (the foot kept level), every vertex of the base and of the bound meshes moved by its
// weights, and the joints with them. Leaves person.rig: the joints (decimetres, before the feet go to the ground), the
// weights of each bound mesh and the low body (LOD1), fitted and posed too
// (spread 0..1: a heavier or stronger body, or a wide skirt, holds the arms a little out, as person.js's arms down)
export function* restPose(person, D, v, fitted, sex, spread = 0, late = () => false) {
  const J = {};
  const hl = joint(D, v, 'joint-l-upper-leg'), hr = joint(D, v, 'joint-r-upper-leg');
  J.body = new THREE.Vector3(0, (hl[1] + hr[1]) / 2, (hl[2] + hr[2]) / 2);
  for (const b of BONES) if (b !== 'body') J[b] = V(joint(D, v, JOINT_OF[b]));
  const Q = {};
  for (const b of BONES) Q[b] = new THREE.Quaternion();
  const dir = (a, b) => J[b].clone().sub(J[a]).normalize(), inv = q => q.clone().invert();
  for (const [S, sg] of [['L', 1], ['R', -1]]) {
    const want = a => new THREE.Vector3(sg * a[0], a[1], a[2]).normalize();
    Q['arm' + S].setFromUnitVectors(dir('arm' + S, 'fore' + S), want([ARM[0] + 0.16 * spread, ARM[1], ARM[2]]));
    Q['fore' + S].setFromUnitVectors(dir('fore' + S, 'hand' + S), want(FORE).applyQuaternion(inv(Q['arm' + S])));
    Q['leg' + S].setFromUnitVectors(dir('leg' + S, 'shin' + S), want(LEG));
    Q['shin' + S].setFromUnitVectors(dir('shin' + S, 'foot' + S), want(SHIN).applyQuaternion(inv(Q['leg' + S])));
    Q['foot' + S].copy(inv(Q['leg' + S].clone().multiply(Q['shin' + S])));   // (the sole stays flat on the ground)
  }
  // Each bone's world turn and where its head goes; its matrix moves a rest point to its posed place
  const W = {}, P = {}, M = {};
  for (const b of BONES) {
    const pa = PARENT[b];
    W[b] = pa ? W[pa].clone().multiply(Q[b]) : Q[b].clone();
    P[b] = pa ? J[b].clone().sub(J[pa]).applyQuaternion(W[pa]).add(P[pa]) : J[b].clone();
    const t = P[b].clone().sub(J[b].clone().applyQuaternion(W[b]));
    M[b] = new THREE.Matrix4().compose(t, W[b], new THREE.Vector3(1, 1, 1)).elements;
  }
  const Ms = BONES.map(b => M[b]);
  const move = (a, i, idx, w, o) => {
    const x = a[i * 3], y = a[i * 3 + 1], z = a[i * 3 + 2];
    let X = 0, Y = 0, Z = 0;
    for (let j = 0; j < 4; j++) {
      const k = w[o * 4 + j];
      if (k <= 0) continue;
      const e = Ms[idx[o * 4 + j]];
      X += k * (e[0] * x + e[4] * y + e[8] * z + e[12]); Y += k * (e[1] * x + e[5] * y + e[9] * z + e[13]); Z += k * (e[2] * x + e[6] * y + e[10] * z + e[14]);
    }
    a[i * 3] = X; a[i * 3 + 1] = Y; a[i * 3 + 2] = Z;
  };
  // The low body first, on the base before it moves
  const lod = lodOf(sex), lodV = D.proxies.has(lod) ? fit(D, v, lod) : null;
  const parts = new Map();
  for (const f of fitted) {
    if (late()) yield;
    if (!f.d) continue;   // (our hair and beards, hair.js: on the head, which does not move at rest; ingame.js puts them on the head bone)
    const s = partSkin(D, f.d, f.P.nv);
    parts.set(f.name, s);
    for (let i = 0; i < f.P.nv; i++) move(f.v, i, s.idx, s.w, i);
  }
  let lodPart = null;
  if (lodV) {
    const d = proxy(D, lod), n = D.proxies.get(lod).nv, s = partSkin(D, d, n);
    for (let i = 0; i < n; i++) move(lodV, i, s.idx, s.w, i);
    lodPart = { name: lod, v: lodV, skin: s, d };
  }
  const bi = new Uint8Array(4), bw = new Float32Array(4);
  for (let i = 0; i < D.nv; i++) { baseSkin(D, i, bi, bw, 0); move(v, i, bi, bw, 0); if ((i & 2047) === 0 && late()) yield; }
  const jf = new Float32Array(BONES.length * 3);
  BONES.forEach((b, k) => { jf[k * 3] = P[b].x; jf[k * 3 + 1] = P[b].y; jf[k * 3 + 2] = P[b].z; });
  person.rig = { joints: jf, parts, lod: lodPart, squeeze: lodV ? [jf, lodV] : [jf] };
}
