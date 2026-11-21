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

// Where it goes, on the chest bone (fit: the body's measures, RealPerson.bagFit: back, front, top). The log, along the
// right shoulder, front to back, a little more of it behind; the carcass across both shoulders, behind the neck, its
// legs coming over the right shoulder
export function placeCarried(o, id, fit) {
  const B = BULKY[id], { back, top } = fit;
  if (B.hold === 'shoulder') {
    o.position.set(-0.2, top, back * 0.25 - 0.1);   // (the model's origin is its bottom: it rests on the shoulder, beside the head)
    o.rotation.set(-0.1, Math.PI / 2, 0, 'YXZ');
    o.scale.setScalar(0.85);
  } else {
    // (turned forward about its length: the belly on the neck, the legs hanging over the chest, held by the hands)
    o.position.set(-0.04, top - 0.08, -0.2);
    o.rotation.set(0.75, 0, 0);
    o.scale.setScalar(0.78);
  }
}
// The arms holding it (written after the walk and the tool, on the bones of persona.js: arms[0] is the right one; x
// negative raises the arm forward, the forearm's x negative bends the elbow, z opens the arm out)
export function holdPose(P, kind) {
  const [R, L] = P.arms, [fR, fL] = P.fore || [];
  if (kind === 'shoulder') {
    R.rotation.set(-0.95, 0, -0.18); if (fR) fR.rotation.x = -2.1;   // (the elbow down in front, the hand up on the log)
    L.rotation.x *= 0.6;   // (the left one swings less: the weight is on the right)
  } else {
    R.rotation.set(-1.1, 0, 0.25); L.rotation.set(-1.1, 0, -0.25);
    if (fR) fR.rotation.x = -1.4;
    if (fL) fL.rotation.x = -1.4;
  }
  P.dirty = true;
}
// In first person: what shows of it at the bottom of the screen (the log on the right shoulder, the carcass's legs)
export function carriedView(id) {
  const B = BULKY[id], g = new THREE.Group(), o = carriedModel(id);
  o.traverse(q => { if (q.isMesh) q.castShadow = false; });
  if (B.hold === 'shoulder') { o.rotation.set(0.08, Math.PI / 2 + 0.06, 0); o.position.set(0.42, -0.36, -0.2); }
  else { o.rotation.set(-1.1, Math.PI, 0); o.position.set(0.05, -0.62, -0.42); o.scale.setScalar(0.85); }
  g.add(o);
  return g;
}
