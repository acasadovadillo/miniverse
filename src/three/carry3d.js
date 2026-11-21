// The big things carried in the arms, drawn (the weight prototype: ../carry.js). The same models as on the ground
// (models.js: log, carcass_*), made into meshes once per thing and shared by everybody who carries one (the player's own
// copy only clones the materials, for the outline: see actors.js). Where each goes on the body (hung from the chest
// bone, like the backpack) and how the arms hold it.
import * as THREE from 'three';
import { getModel, modelMat } from './models.js';
import { BULKY } from '../carry-items.js';

const GEO = new Map();   // id → [[material key, geometry]]: never released (a few small ones, < 100 KB in all)
function parts(id) {
  let list = GEO.get(id);
  if (!list) {
    const m = getModel(id);
    list = m ? [...m.parts].map(([key, B]) => [key, B.geometry()]) : [];
    GEO.set(id, list);
  }
  return list;
}
// The thing as a group of meshes (the models are made with the ground at y = 0 and the centre in the origin)
export function carriedModel(id) {
  const g = new THREE.Group();
  for (const [key, geo] of parts(id)) { const o = new THREE.Mesh(geo, modelMat(key)); o.castShadow = true; o.receiveShadow = true; o.userData.shared = true; g.add(o); }
  return g;
}

// Where it goes, on the chest bone (x: + is the body's left; y: from the shoulder joints, fit.top; z: + is the front).
// The log: along the right shoulder, front to back, out past the neck and resting on the shoulder (not at the mouth),
// drawn longer than on the ground (scale x: the model lies along x). The carcass: across the back of the shoulders,
// behind the neck, its legs coming forward over both shoulders to the hands (the model lies on its side with the legs
// to +z: turned about x, they hang forward and down)
export const HOLD = {
  shoulder: { pos: [-0.27, -0.07, -0.08], rot: [-0.08, Math.PI / 2, 0], scale: [1.35, 0.8, 0.8] },
  across: { pos: [0, -0.06, -0.31], rot: [0.2, 0, 0], scale: [0.85, 0.85, 0.85] },
};
// The arms (persona.js bones: arms[0] is the right one; x negative raises the arm forward, z opens it out, the
// forearm's x negative bends the elbow). shoulder: the right hand up on the log in front of the shoulder, the left one
// swinging less; across: both elbows out and bent up, the hands on the legs where they come over the shoulders
export const ARMS = {
  shoulder: { R: [-0.9, 0, -0.5], fR: -2.0, swingL: 0.6 },
  across: { R: [-0.5, 0, -0.6], L: [-0.5, 0, 0.6], fR: -1.85, fL: -1.85 },
};
export function placeCarried(o, id, fit) {
  const H = HOLD[BULKY[id].hold] || HOLD.across, [x, y, z] = H.pos;
  o.position.set(x, fit.top + y, z);
  o.rotation.set(...H.rot, 'YXZ');
  o.scale.set(...H.scale);
}
// The arms holding it (written after the walk and the tool)
export function holdPose(P, kind) {
  const [R, L] = P.arms, [fR, fL] = P.fore || [], A = ARMS[kind] || ARMS.across;
  R.rotation.set(...A.R); if (fR) fR.rotation.x = A.fR;
  if (A.L) { L.rotation.set(...A.L); if (fL) fL.rotation.x = A.fL; } else L.rotation.x *= A.swingL;
  P.dirty = true;
}
// In first person: what shows of it at the bottom of the screen (the log on the right shoulder, the carcass's legs)
export function carriedView(id) {
  const B = BULKY[id], g = new THREE.Group(), o = carriedModel(id);
  o.traverse(q => { if (q.isMesh) q.castShadow = false; });
  if (B.hold === 'shoulder') { o.rotation.set(0.08, Math.PI / 2 + 0.06, 0); o.position.set(0.42, -0.36, -0.2); o.scale.set(1.35, 1, 1); }
  else { o.rotation.set(-1.1, Math.PI, 0); o.position.set(0.05, -0.62, -0.42); o.scale.setScalar(0.85); }
  g.add(o);
  return g;
}
