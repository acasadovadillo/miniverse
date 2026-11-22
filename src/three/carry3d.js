// The big things carried in the arms, drawn (the weight inventory: ../carry.js). The log is the same model as on the
// ground; a carcass, its carried pose (models.js `<id>:held`: draped over the shoulders, already in the chest bone's
// frame). Made into meshes once per thing and shared by everybody who carries one (the player's own copy only clones
// the materials, for the outline: see actors.js). Where each goes on the body (hung from the chest bone, like the
// backpack) and how the arms hold it.
import * as THREE from 'three';
import { getModel, modelMat } from './models.js';
import { BULKY } from '../carry-items.js';

const GEO = new Map();   // id → [[material key, geometry]]: never released (a few small ones, < 100 KB in all)
function parts(id) {
  let list = GEO.get(id);
  if (!list) {
    const m = getModel(BULKY[id]?.prey ? id + ':held' : id);
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
// The log: along the right shoulder, front to back, resting on it beside the neck, a little more of it behind than in
// front (the model lies along x, its centre at y = LOG.r; longer than on the ground: 1.2 m, about 19 cm thick). The
// carcass: the front of its belly (the origin of its carried pose, models.js) on the nape, behind the neck; it drapes
// down over both shoulders and its legs come forward over them to the hands
export const HOLD = {
  shoulder: { pos: [-0.19, -0.08, -0.1], rot: [-0.07, Math.PI / 2, 0], scale: [1.26, 1.05, 1.05] },
  across: { pos: [0, -0.1, -0.06], rot: [0, 0, 0], scale: [1, 1, 1] },
};
// The arms (persona.js bones: arms[0] is the right one; x negative raises the arm forward, z opens it out, the
// forearm's x negative bends the elbow). shoulder: the right hand up on the log in front of the shoulder, the left one
// swinging less; across: both elbows out and bent up, the hands on the legs where they come over the shoulders
export const ARMS = {
  shoulder: { R: [-0.7, 0, -0.45], fR: -2.1, swingL: 0.6 },
  across: { R: [-0.28, 0, 0.25], L: [-0.28, 0, -0.25], fR: -1.85, fL: -1.85 },
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
// In first person: what shows of it at the bottom of the screen, in the camera's frame (-z ahead): the log on the right
// shoulder; the carcass as it is on the shoulders (turned to face ahead) and tipped back, so that what shows is its legs
// coming forward over the shoulders from the bottom of the screen, the hooves (the highest of its legs: legs, some of
// their points, models.js) in the lower half, above the hotbar and the hint (TIP_AT), never higher. The rest of it (trunk:
// some points of its body, neck and head) is kept lower, so that no more than the edge of its back shows at the bottom, behind the hotbar (EDGE).
// A short-legged one needs to be tipped back more for its trotters to rise above its body: the least tilt, from tilt[0]
// to tilt[1], that does it (the hooves of the tip, the lowest, go first at z)
export const VIEW = {
  shoulder: { pos: [0.3, -0.27, -0.16], rot: [0.06, Math.PI / 2 + 0.05, 0], scale: [1.26, 1.05, 1.05] },
  across: { z: -0.5, rot: [-0.45, Math.PI, 0], tilt: [-0.45, -1.25], scale: [1, 1, 1] },
};
const TAN = Math.tan(35 * Math.PI / 180);   // (half the first person field of view, 70°)
const TIP_AT = -0.45, EDGE = -0.8;           // (how high the hooves and the top of its body go: fractions of half the screen, down)
export function carriedView(id) {
  const V = VIEW[BULKY[id].hold] || VIEW.across, g = new THREE.Group(), o = carriedModel(id);
  o.traverse(q => { if (q.isMesh) q.castShadow = false; });
  o.rotation.set(...V.rot, 'YXZ'); o.scale.set(...V.scale);
  const M = BULKY[id].prey && getModel(id + ':held'), tip = M?.tip, T = M?.trunk || [], L = M?.legs || [];
  if (tip) {
    const e = new THREE.Euler(0, 0, 0, 'YXZ'), p = q => new THREE.Vector3(...q).multiply(o.scale).applyEuler(e), c = new THREE.Vector3();
    // (how far down it must go so that every point of a list is below a line of the screen: k, a fraction of half of it)
    const below = (list, pos, k) => { let d = -Infinity; for (let i = 0; i < list.length; i += 3) { c.set(list[i], list[i + 1], list[i + 2]).multiply(o.scale).applyEuler(e).add(pos); if (c.z < -0.05) d = Math.max(d, c.y - k * TAN * -c.z); else if (c.z < 0.03) d = Math.max(d, c.y + 0.03); } return d; };   // (right before the eye, below it)
    let best = null;
    for (let rx = V.tilt[0]; rx >= V.tilt[1] - 1e-6; rx -= 0.08) {
      e.set(rx, V.rot[1], V.rot[2], 'YXZ');
      const t = p([0, ...tip]), pos = new THREE.Vector3(-t.x, 0, V.z - t.z);
      const up = below(L, pos, TIP_AT); pos.y -= Number.isFinite(up) ? up : t.y - TIP_AT * TAN * -V.z;   // (the legs: their highest point on the line)
      const push = Math.max(0, below(T, pos, EDGE));                                                    // (and the body lower, if it shows more)
      pos.y -= push;
      if (!best || push < best.push - 1e-4) best = { rx, pos, push };
      if (push < 0.01) break;
    }
    o.rotation.x = best.rx; o.position.copy(best.pos);
  } else o.position.set(...V.pos);
  g.add(o);
  return g;
}
