// The big things carried in the arms, drawn (the weight inventory: ../carry.js). The log is the same model as on the
// ground; a carcass, its carried pose (models.js `<id>:held`: draped over the shoulders, already in the chest bone's
// frame). Made into meshes once per thing and shared by everybody who carries one (the player's own copy only clones
// the materials, for the outline: see actors.js). Where each goes on the body (hung from the chest bone, like the
// backpack) and how the arms hold it.
import * as THREE from 'three';
import { getModel, modelMat, barrowSize, barrowName } from './models.js';
import { BULKY } from '../carry-items.js';

// model name → [[material key, geometry]]: never released (the carried things, a few small ones, < 100 KB in all; and
// each wheelbarrow with a load that has been pushed, some tens of KB each, a handful in a game)
const GEO = new Map();
function partsOf(name) {
  let list = GEO.get(name);
  if (!list) {
    const m = getModel(name);
    list = m ? [...m.parts].map(([key, B]) => [key, B.geometry()]) : [];
    GEO.set(name, list);
  }
  return list;
}
const parts = id => partsOf(BULKY[id]?.prey ? id + ':held' : id);
function meshes(list) {
  const g = new THREE.Group();
  for (const [key, geo] of list) { const o = new THREE.Mesh(geo, modelMat(key)); o.castShadow = true; o.receiveShadow = true; o.userData.shared = true; g.add(o); }
  return g;
}
// The thing as a group of meshes (the models are made with the ground at y = 0 and the centre in the origin)
export function carriedModel(id) { return meshes(parts(id)); }
// Any model of models.js as a group of meshes, its geometries shared (the driven cart: cart3d.js)
export const modelMeshes = name => meshes(partsOf(name));

// Where it goes, on the chest bone (x: + is the body's left; y: from the shoulder joints, fit.top; z: + is the front).
// The log: along the right shoulder, front to back, resting on it beside the neck, a little more of it behind than in
// front (the model lies along x, its centre at y = LOG.r; longer than on the ground: 1.2 m, about 19 cm thick). The
// carcass: the front of its belly (the origin of its carried pose, models.js) on the nape, behind the neck; it drapes
// down over both shoulders and its legs come forward over them to the hands
export const HOLD = {
  shoulder: { pos: [-0.19, -0.08, -0.1], rot: [-0.07, Math.PI / 2, 0], scale: [1.26, 1.05, 1.05] },
  across: { pos: [0, -0.1, -0.06], rot: [0, 0, 0], scale: [1, 1, 1] },
  // (the strongbox: hugged in front, its foot about the hips, its lid under the chin)
  front: { pos: [0, -0.76, 0.33], rot: [0.08, 0, 0], scale: [1, 1, 1] },
};
// The arms (persona.js bones: arms[0] is the right one; x negative raises the arm forward, z opens it out, the
// forearm's x negative bends the elbow). shoulder: the right hand up on the log in front of the shoulder, the left one
// swinging less; across: both elbows out and bent up, the hands on the legs where they come over the shoulders
export const ARMS = {
  shoulder: { R: [-0.7, 0, -0.45], fR: -2.1, swingL: 0.6 },
  across: { R: [-0.28, 0, 0.25], L: [-0.28, 0, -0.25], fR: -1.85, fL: -1.85 },
  front: { R: [-0.42, 0, -0.18], L: [-0.42, 0, 0.18], fR: -0.95, fL: -0.95 },
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
  front: { pos: [0, -0.62, -0.72], rot: [0.18, 0, 0], scale: [1, 1, 1] },   // (the box's lid at the bottom of the screen)
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

// ---------- the wheelbarrow pushed (barrow.js; its model: models.js BUILD.wheelbarrow) ----------
// Pushed, it hangs from the person's root (it turns with the body, which faces as the wheelbarrow does): the ends of the
// grips GRIP_AHEAD ahead of the pusher and lifted to GRIP_H (carry-items.js BARROW), the height of the hands, turned round
// the axle with the wheel on the ground. Lifted, it is shorter than parked: its wheel comes to pushedReach(), which is the
// logic's WHEEL_AHEAD (carry-items.js does the same turn for the footprint). pitch: the slope ahead (up, positive), turned
// round the grips: the wheel goes up or down with the ground
export const GRIP_H = barrowSize().GRIP_H ?? 0.8;
function lift() {
  const S = barrowSize(), dy = S.GRIP_Y - S.WHEEL_R, dz = S.WHEEL_Z - S.GRIP_Z, r = Math.hypot(dy, dz);
  const a = Math.asin(Math.min(1, (GRIP_H - S.WHEEL_R) / r)) - Math.atan2(dy, dz);   // (the turn round the axle that puts the grips at GRIP_H)
  return { S, a, reach: S.GRIP_AHEAD + r * Math.cos(a + Math.atan2(dy, dz)) };
}
// How far ahead of the pusher the wheel is, pushed (for the slope under it)
export const pushedReach = () => lift().reach;
// The wheelbarrow to push, with what it carries (key: as in st.ca and o.model, 'wheelbarrow:log:f'). Three groups: the
// outer one is the pivot at the grips (placePushed puts it and tips it with the slope), the middle one turns round the
// axle (the lift), the inner one is the model as it is parked
export function pushedModel(key) {
  const { S, a } = lift(), o = new THREE.Group(), turn = new THREE.Group(), body = meshes(partsOf(barrowName(key)));
  body.position.set(0, -S.WHEEL_R, -S.WHEEL_Z);   // (the axle at the middle group's origin)
  turn.rotation.x = a;
  const g = new THREE.Vector3(0, S.GRIP_Y - S.WHEEL_R, S.GRIP_Z - S.WHEEL_Z).applyEuler(turn.rotation);
  turn.position.copy(g).negate();                  // (and the lifted grips at the outer one's)
  turn.add(body); o.add(turn);
  placePushed(o);
  return o;
}
export function placePushed(o, pitch = 0) {
  o.position.set(0, GRIP_H, barrowSize().GRIP_AHEAD);
  o.rotation.set(-pitch, 0, 0);
}
// The arms on the grips, the body leaning into it. Each body is measured once (pushFit): the angles of each arm (persona.js
// bones: x negative raises the arm forward, z opens it out, the forearm's x negative bends the elbow) that put the
// hand's grip (where the tools are held, actors.js m.hand) on the grip of its side, a little in from its end, found by
// trying (a few dozen tries, once); if they do not reach, it leans a little more. Written after the walk: the arms stay
// on the grips while the legs walk
export const PUSH = { R: [-0.45, 0, 0.15], L: [-0.45, 0, -0.15], fR: -0.3, fL: -0.3, lean: 0.22, maxLean: 0.6 };
const GRASP = new THREE.Vector3(0, -0.07, 0.03), HOLD_IN = 0.05;   // (the hand's grip in the hand bone; how far in from the end it holds)
// The grips, held, in the pusher's frame (pitch 0): the point of each shaft HOLD_IN from its end, lifted round the axle
function gripsHeld() {
  const { S, a } = lift(), X = new THREE.Vector3(1, 0, 0), A = new THREE.Vector3(0, S.WHEEL_R, S.WHEEL_Z), G = new THREE.Vector3(0, S.GRIP_Y, S.GRIP_Z);
  const up = p => p.sub(A).applyAxisAngle(X, a), g0 = up(G.clone()), out = [];
  for (const sd of [-1, 1]) {
    const g = new THREE.Vector3(sd * S.GRIP_X, S.GRIP_Y, S.GRIP_Z), ax = new THREE.Vector3(sd * 0.075, S.WHEEL_R, S.WHEEL_Z);
    g.addScaledVector(ax.sub(g).normalize(), HOLD_IN);
    out.push(up(g).sub(g0).add(new THREE.Vector3(0, GRIP_H, S.GRIP_AHEAD)));
  }
  return out;   // ([right (-x), left (+x)])
}
function pushFit(P) {
  if (P.pushFit) return P.pushFit;
  const hands = [P.hand, P.r?.bones?.handL], target = gripsHeld(), fit = { lean: PUSH.lean, arms: [] }, w = new THREE.Vector3(), t = new THREE.Vector3();
  if (!hands[0] || !hands[1]) return (P.pushFit = null);
  const spine = P.r?.bones?.spine, torso0 = P.torso.rotation.x, spine0 = spine?.rotation.x;
  for (let tries = 0; tries < 6; tries++) {
    lean(P, fit.lean, spine, torso0, spine0);
    P.root.updateMatrixWorld(true);
    let worst = 0;
    fit.arms = [0, 1].map(i => {
      const A = P.arms[i], F = P.fore?.[i], start = i ? [...PUSH.L] : [...PUSH.R];
      const p = [start[0], start[2], i ? PUSH.fL : PUSH.fR], lo = [-1.6, -0.9, -1.4], hi = [0.4, 0.9, 0];
      P.root.localToWorld(t.copy(target[i]));
      const cost = q => { A.rotation.set(q[0], 0, q[1]); if (F) F.rotation.x = q[2]; A.updateMatrixWorld(true); return hands[i].localToWorld(w.copy(GRASP)).distanceToSquared(t); };
      let best = cost(p);
      for (let step = 0.3; step > 0.008;) {
        let better = false;
        for (let k = 0; k < 3; k++) for (const sg of [1, -1]) {
          const q = p.slice(); q[k] = Math.max(lo[k], Math.min(hi[k], q[k] + sg * step));
          const c = cost(q); if (c < best - 1e-7) { best = c; p.splice(0, 3, ...q); better = true; }
        }
        if (!better) step /= 2;
      }
      worst = Math.max(worst, Math.sqrt(best));
      return p;
    });
    fit.miss = worst;
    if (worst < 0.025 || fit.lean >= PUSH.maxLean) break;
    fit.lean = Math.min(PUSH.maxLean, fit.lean + 0.08);
  }
  P.torso.rotation.x = torso0; if (spine) spine.rotation.x = spine0;
  return (P.pushFit = fit);
}
// (leaning from the waist, the spine bone, and a little more at the chest; without a spine bone, all at the chest)
function lean(P, k, spine = P.r?.bones?.spine, torso0 = P.torso.rotation.x, spine0 = spine?.rotation.x) {
  if (spine) { spine.rotation.x = spine0 + k * 0.75; P.torso.rotation.x = torso0 + k * 0.25; } else P.torso.rotation.x = torso0 + k;
}
export function pushPose(P) {
  const f = pushFit(P), A = PUSH;
  lean(P, f ? f.lean : A.lean);
  for (let i = 0; i < 2; i++) {
    const q = f ? f.arms[i] : i ? [A.L[0], A.L[2], A.fL] : [A.R[0], A.R[2], A.fR];
    P.arms[i].rotation.set(q[0], 0, q[1]);
    if (P.fore?.[i]) P.fore[i].rotation.x = q[2];
  }
  P.dirty = true;
}
// In first person: the same wheelbarrow, on the ground ahead (engine.js puts this group at the player's feet, turned as
// the camera looks; turn: the wheelbarrow's lag behind the camera, which turns faster, rad), VIEW_AHEAD further on than
// it is: where it is, right under the eyes, its grips only show looking straight down; so they come up from the bottom
// of the screen looking a little down, as one looks pushing it. It does not cast a shadow (the body's one does)
const VIEW_AHEAD = 0.28;
export function pushedView(key, turn = 0) {
  const g = new THREE.Group(), o = pushedModel(key);
  o.traverse(q => { if (q.isMesh) q.castShadow = false; });
  o.position.z += VIEW_AHEAD;
  g.add(o); g.rotation.y = turn;
  return g;
}

// ---------- a big thing on a horse or in a boat ----------
// On the horse (animals.js horseModel, in its body: it follows the gait; +z its head, the saddle at z -0.02 and y 1.16,
// its back falling towards the tail at -0.56): behind the saddle, on the croup. The log lies across it; the carcass as
// it lies on the ground (models.js, the wheelbarrow's size), slung over the croup: along the horse, its back up towards
// the far side, its legs hanging down the near flank and its head drooping behind the rump (the angles: its head to the
// tail, 0.45 rad down; its legs to the horse's left, 0.9 rad down; as YXZ).
// In the boat (actors.js boatModel: the floor at y 0.335, flat at its +z end, z 0.82, the rower's bench at z -0.1 and their
// feet up to about z 0.45): at the +z end, on the floor. The log across it (shorter), inside the gunwale and clear of the
// rower's feet; the carcass lying on its side (as on the ground), its head to the bow and its legs over the gunwale
export const HORSE_LOAD = {
  shoulder: { pos: [0, 1.07, -0.46], rot: [0, 0, 0.04], scale: [1, 1, 1] },
  across: { pos: [0.03, 1.03, -0.55], rot: [0.742, 1.112, -0.631], scale: [0.74, 0.74, 0.74] },
  front: { pos: [0, 1.0, -0.52], rot: [0, Math.PI / 2, 0.06], scale: [0.85, 0.85, 0.85] },   // (the strongbox, lashed across the croup)
};
export const BOW_LOAD = {
  shoulder: { pos: [0, 0.335, 0.64], rot: [0, 0, 0], scale: [0.85, 0.9, 0.9] },
  across: { pos: [0, 0.33, 0.6], rot: [0, -Math.PI / 2, 0], scale: [0.72, 0.72, 0.72] },
  front: { pos: [0, 0.335, 0.58], rot: [0, 0, 0], scale: [0.8, 0.8, 0.8] },
};
// The thing to put there: as it lies on the ground (also the carcass)
export function loadModel(id) { return meshes(partsOf(id)); }
export function placeLoad(o, id, where) {
  const T = where === 'horse' ? HORSE_LOAD : BOW_LOAD, H = T[BULKY[id]?.hold] || T.across;
  o.position.set(...H.pos); o.rotation.set(...H.rot, 'YXZ'); o.scale.set(...H.scale);
}
