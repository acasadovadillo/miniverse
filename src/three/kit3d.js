// The tools you carry, drawn on the body (which ones and where: ../kit.js). Each tool is the same model as in the hand
// (toolModel in actors.js, which hands it over: this file does not import actors.js, which imports it), baked once into a
// single geometry with its colour per vertex and a 'metal' attribute per vertex (1 iron, 0 wood and leather). One shared
// material for everybody reads it, so the iron shines as the tool in the hand does without a second material: the back
// is one mesh (on the chest bone) and the hip another (on the hip bone), two draw calls per person at most. Each place
// has its matrix, fitted to each body with what RealPerson measures of it (bagFit for the back, beltFit for the waist).
import * as THREE from 'three';
import { Builder, paint, mergeParts } from './geo.js';
import { G } from './shapes.js';
import { BACK_SPOTS, SCABBARD } from '../kit.js';

// One material for all: iron with metalness 0.7 and roughness 0.3, wood and leather with 0 and 0.8, as in the hand
export const KIT_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
KIT_MAT.onBeforeCompile = sh => {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float metal;\nvarying float vMetal;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMetal = metal;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vMetal;')
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.7, vMetal);')
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.3, vMetal);');
};
KIT_MAT.customProgramCacheKey = () => 'kit-metal';
// Its programs (as it is and see-through, for a spectator: actors.js ghost), compiled without stopping the game when the
// world first shows (engine.js): otherwise the first tool picked up, or the first player coming in with tools, would
// compile them in the middle of the game. A one-triangle mesh, released after; the see-through material is kept for good
// (Three destroys a program when the last material using it goes, and the first spectator would compile it again)
let KIT_GHOST = null;
export function prewarmKit(renderer, camera, scene) {
  if (!renderer?.compileAsync) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
  g.setAttribute('metal', new THREE.Float32BufferAttribute([0, 1, 0], 1));
  if (!KIT_GHOST) {
    KIT_GHOST = KIT_MAT.clone();
    Object.assign(KIT_GHOST, { transparent: true, opacity: 0.35, depthWrite: false });
    KIT_GHOST.onBeforeCompile = KIT_MAT.onBeforeCompile; KIT_GHOST.customProgramCacheKey = KIT_MAT.customProgramCacheKey;
  }
  const tmp = new THREE.Group();
  for (const mat of [KIT_MAT, KIT_GHOST]) { const o = new THREE.Mesh(g, mat); o.frustumCulled = false; tmp.add(o); }
  renderer.compileAsync(tmp, camera, scene).catch(() => {}).finally(() => g.dispose());
}

const LOW_BALL = new THREE.SphereGeometry(1, 8, 6);
const LEATHER = '#6a4428', LEATHER_DARK = '#4a2e1c', BRASS = '#a8843a';
const withMetal = (geo, v) => { geo.setAttribute('metal', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count).fill(v), 1)); return geo; };
// A piece made with the Builder (rounded boxes), in one colour
function box(c, x0, y0, z0, x1, y1, z1, r = 0.006, metal = 0) { const B = new Builder(); B.tint(c); B.roundBox(x0, y0, z0, x1, y1, z1, r, { s: 1 }); return withMetal(B.geometry(), metal); }
// A cylinder along y (THREE's), painted, with its matrix
function cyl(c, r0, r1, h, seg, m4, metal = 0) { const g = new THREE.CylinderGeometry(r1, r0, h, seg); g.deleteAttribute('uv'); g.applyMatrix4(m4); return withMetal(paint(g, c), metal); }
const M4 = (p = [0, 0, 0], r = [0, 0, 0]) => new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(1, 1, 1));

// A tool of toolModel, without the turn it has in the hand (along +y from the grip, its flat side facing z), as one
// geometry with its colours and its 'metal'. Left out: what is see-through (the net's mesh) and hidden (the bow's arrow).
// kind: the sword gets its leather scabbard (it covers the blade); the long ones go smaller (LONG: in the hand's size
// they stood over the head and reached the knees). userData: lo and hi, where it starts and ends in y
const LONG = new Set(['pala', 'azada', 'cana', 'red', 'arco', 'guadana']), LONG_SCALE = 0.8;
// The sword's scabbard (on its own: what stays at the hip with the sword drawn)
function scabbardParts() {
  return [
    box(LEATHER, -0.036, 0.09, -0.017, 0.036, 0.6, 0.017, 0.012),        // the scabbard, over the blade
    box(BRASS, -0.03, 0.6, -0.014, 0.03, 0.66, 0.014, 0.01, 1),           // its tip
    box(BRASS, -0.04, 0.09, -0.02, 0.04, 0.115, 0.02, 0.005, 1),          // its mouth
  ];
}
let SCABBARD_GEO = null;
function scabbardGeo() {
  if (SCABBARD_GEO) return SCABBARD_GEO;
  const geo = SCABBARD_GEO = mergeParts(scabbardParts());
  geo.computeBoundingBox();
  geo.userData.lo = geo.boundingBox.min.y; geo.userData.hi = geo.boundingBox.max.y;
  return geo;
}
export function bakeStowed(model, kind) {
  const parts = [];
  model.rotation.set(0, 0, 0);
  model.updateMatrixWorld(true);
  model.traverse(o => {
    if (!o.isMesh || !o.visible || o.material.transparent) return;
    let hidden = false;
    for (let q = o.parent; q && q !== model; q = q.parent) if (!q.visible) hidden = true;
    if (hidden) return;
    // (the round knobs, in fewer faces: on the back nobody sees them up close, and the kit is rebuilt often)
    const g = (o.geometry === G.ball ? LOW_BALL : o.geometry).clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    g.applyMatrix4(o.matrixWorld);
    paint(g, o.material.color);
    parts.push(withMetal(g, o.material.metalness > 0.3 ? 1 : 0));
  });
  if (kind === 'espada') parts.push(...scabbardParts());
  const geo = mergeParts(parts);
  if (LONG.has(kind)) geo.scale(LONG_SCALE, LONG_SCALE, LONG_SCALE);
  geo.computeBoundingBox();
  geo.userData.lo = geo.boundingBox.min.y; geo.userData.hi = geo.boundingBox.max.y;
  return geo;
}

// The grooming brush in the hand while brushing a horse (actors.js hold, the 'brush' gesture; Plan F §5.1.4): a wooden back
// with a leather strap over it for the hand, and the stiff bristles under it on the side a tool's edge faces (+x: what
// faces the work as the arm strokes, as an axe's edge does). Along +y from the grip, as the tools; about 15 cm long. One
// geometry, made once and never released (shared by every hand: hold() releases only materials), with KIT_MAT
let BRUSH_GEO = null;
export function brushModel() {
  if (!BRUSH_GEO) BRUSH_GEO = mergeParts([
    box('#8a5a32', -0.012, -0.05, -0.032, 0.012, 0.1, 0.032, 0.01),           // the wooden back
    box('#2e2620', 0.012, -0.044, -0.028, 0.036, 0.094, 0.028, 0.004),       // the bristles
    box(LEATHER_DARK, -0.017, -0.008, -0.036, 0.004, 0.032, 0.036, 0.004),    // the strap over the back
  ]);
  const g = new THREE.Group(), o = new THREE.Mesh(BRUSH_GEO, KIT_MAT);
  o.castShadow = true; o.userData.shared = true;
  g.add(o);
  return g;
}

// The quiver: a leather tube with its rim, and the arrows showing at the top (three feathers, or six with ten or more).
// Along +y from its bottom
const QUIVER = new Map();
export function quiverGeo(many) {
  if (QUIVER.has(many)) return QUIVER.get(many);
  const parts = [], L = 0.44;
  parts.push(cyl(LEATHER, 0.042, 0.052, L, 12, M4([0, L / 2, 0])));
  parts.push(cyl(LEATHER_DARK, 0.055, 0.055, 0.03, 12, M4([0, L - 0.012, 0])));
  parts.push(cyl(LEATHER_DARK, 0.045, 0.045, 0.025, 12, M4([0, 0.012, 0])));
  const n = many ? 6 : 3;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.4, r = n > 3 ? 0.026 : 0.018, x = Math.cos(a) * r, z = Math.sin(a) * r, tip = L + 0.1 + (i % 2) * 0.025;
    parts.push(cyl('#b08a58', 0.0045, 0.0045, tip - L + 0.06, 5, M4([x, L - 0.03 + (tip - L + 0.06) / 2, z])));
    // (the feathers: two crossed fins)
    for (const turn of [0, Math.PI / 2]) parts.push(box(i % 3 === 1 ? '#a83a2a' : '#efe6d4', -0.0015, tip - 0.075, -0.012, 0.0015, tip, 0.012, 0.001).applyMatrix4(M4([x, 0, z], [0, turn + a, 0])));
  }
  const geo = mergeParts(parts);
  geo.userData.lo = 0; geo.userData.hi = L + 0.15;
  QUIVER.set(many, geo);
  return geo;
}

// The leather strap across the body (no backpack and something on the back): from the right shoulder, over the back, to
// the left hip, and back up across the chest. On the chest bone, fitted to this body (fit: bagFit)
function slingGeo(fit) {
  const { back, front, top } = fit, parts = [], W = 0.04, T = 0.008;
  const strap = (a, b) => {
    const A = new THREE.Vector3(...a), d = new THREE.Vector3(...b).sub(A), len = d.length(), g = new THREE.BoxGeometry(W, len + 0.006, T);
    g.deleteAttribute('uv');
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    g.applyMatrix4(new THREE.Matrix4().compose(A.clone().addScaledVector(d, 0.5), q, new THREE.Vector3(1, 1, 1)));
    parts.push(withMetal(paint(g, LEATHER_DARK), 0));
  };
  const sh = [-0.1, top + 0.06], low = [0.15, top - 0.5];
  const B = [[sh[0], sh[1], back * 0.4], [sh[0] + 0.01, top - 0.04, back - 0.006], [0.02, top - 0.27, back - 0.01], [low[0], low[1], back * 0.7]];
  const F = [[sh[0], sh[1] - 0.004, front * 0.35], [sh[0] + 0.02, top - 0.06, front + 0.008], [0.05, top - 0.3, front + 0.004], [low[0] + 0.01, low[1], front * 0.75]];
  for (const L of [B, F]) for (let i = 1; i < L.length; i++) strap(L[i - 1], L[i]);
  strap(B[0], F[0]);
  strap([low[0], low[1], back * 0.7], [low[0] + 0.03, low[1] + 0.0, 0]);
  strap([low[0] + 0.03, low[1], 0], [low[0] + 0.01, low[1], front * 0.75]);
  return mergeParts(parts);
}

// The matrix of each place, for a piece along +y between lo and hi (its middle goes to the place, or its anchor at the
// hip). fit: bagFit (chest bone: back, front, top); belt: beltFit (hip bone: w, half the width at the belt, back, front).
// bag: on the backpack's outer face instead of on the body. pose: 'ride' (the back ones higher, over the saddle) or
// 'crouch' (the back ones a little higher and the hip ones tilted further back: the lower ends went into the ground);
// see kit.js poseClass
const T = new THREE.Matrix4(), R = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), ONE = new THREE.Vector3(1, 1, 1), P3 = new THREE.Vector3();
export const SPOT = {   // (the numbers to fit with the captures: docs/pruebas-arte/t10/rueda.js)
  diag: 0.5, down: 0.24, rideUp: 0.22, crouchUp: 0.14, back: 0.035, crossGap: 0.04, quiverOut: 0.085, bagOut: 0.13, bagUp: 0.04,
};
function spotMatrix(s, geo, fit, belt, bag, pose) {
  const { lo, hi } = geo.userData, mid = (lo + hi) / 2, S = SPOT, crouch = pose === 'crouch';
  let pos, rot, anchor = mid, order = 'YXZ';
  const bz = fit.back - S.back - (bag ? S.bagOut : 0), by = fit.top - S.down + (bag ? S.bagUp : 0) + (pose === 'ride' ? S.rideUp : crouch ? S.crouchUp : 0);
  switch (s.spot) {
    case 'backA': pos = [0, by, bz]; rot = [0, Math.PI, S.diag]; break;   // (the head over the left shoulder, the edge outwards)
    case 'backB': pos = [0, by, bz - S.crossGap]; rot = [0, Math.PI, -S.diag]; break;
    case 'quiver': pos = [-0.07, fit.top - 0.36 + (bag ? S.bagUp : 0), bz - S.quiverOut]; rot = [0, 0, 0.32]; anchor = 0; break;
    case 'bagSide': pos = [-0.19, fit.top - 0.1, fit.back - 0.08]; rot = [0, Math.PI / 2, 0]; anchor = hi; break;   // (hanging from the backpack's side by its handle)
    // (the sword, hilt up, the tip well back: upright it crossed the leg behind when running)
    case 'hipL': order = 'XYZ'; pos = [belt.w + 0.06, 0.03, 0.01]; rot = [crouch ? 1.25 : 0.75, Math.PI / 2, Math.PI]; anchor = 0.1; break;
    case 'hipR':
      order = 'XYZ';
      // (the watering can behind the right hip, the spout back: at the side it was where the right hand hangs)
      if (s.kind === 'regadera') { pos = [-(belt.w - 0.02), 0.04, belt.back - 0.09]; rot = [0, Math.PI / 2, 0]; anchor = hi; }
      // (the axe through the belt, the head just over it and the edge back, the handle tilted back: clear of the thigh)
      else { pos = [-(belt.w + 0.05), 0.02, 0.0]; rot = [crouch ? 1.25 : 0.65, Math.PI / 2, 0]; anchor = hi - 0.02; }
      break;
    default: pos = [0, 0, 0]; rot = [0, 0, 0];
  }
  T.makeTranslation(0, -anchor, 0);
  R.compose(P3.set(...pos), Q.setFromEuler(E.set(rot[0], rot[1], rot[2], order)), ONE);
  return R.multiply(T).clone();
}

// What is shown ([{ id, kind, spot }]: kit.js shownOf), in one geometry per bone: { back, hip } (null where nothing goes).
// geoOf(id): the baked tool (cached by the caller, never released: here it is only read). Rebuilt when the hand goes from
// one kind of tool to another, so it is written straight into typed arrays, each piece moved by its matrix on the way
// (no clones, no arrays that grow): well under a millisecond
const SLINGS = new WeakMap();
const KIT_SPHERE = new THREE.Sphere(new THREE.Vector3(0, 0, -0.1), 1.1);   // (the strap of each body, by its fit: made once)
export function buildKit(shown, fit, belt, geoOf, { bag = false, pose = '' } = {}) {
  const back = [], hip = [];
  let onBack = false;
  for (const s of shown) {
    const src = s.kind === 'flecha' ? quiverGeo(s.id !== 'flecha') : s.id === SCABBARD ? scabbardGeo() : geoOf(s.id);
    if (!src) continue;
    (BACK_SPOTS.has(s.spot) ? back : hip).push([src, spotMatrix(s, src, fit, belt, bag, pose)]);
    if (s.spot === 'backA' || s.spot === 'backB' || s.spot === 'quiver') onBack = true;
  }
  if (onBack && !bag) {
    if (!SLINGS.has(fit)) SLINGS.set(fit, slingGeo(fit));
    back.push([SLINGS.get(fit), null]);
  }
  return { back: back.length ? packKit(back) : null, hip: hip.length ? packKit(hip) : null };
}
// Pieces ([geometry, matrix or null]: indexed, with position, normal, color and metal) into one new geometry
function packKit(pieces) {
  let nv = 0, ni = 0;
  for (const [g] of pieces) { nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), met = new Float32Array(nv), idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let v = 0, k = 0;
  for (const [g, m4] of pieces) {
    const P = g.attributes.position.array, N = g.attributes.normal.array, I = g.index.array, n = g.attributes.position.count, e = m4?.elements;
    if (e) {
      for (let i = 0, j = v * 3; i < n * 3; i += 3, j += 3) {
        const x = P[i], y = P[i + 1], z = P[i + 2], a = N[i], b = N[i + 1], c = N[i + 2];
        pos[j] = e[0] * x + e[4] * y + e[8] * z + e[12]; pos[j + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; pos[j + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        nor[j] = e[0] * a + e[4] * b + e[8] * c; nor[j + 1] = e[1] * a + e[5] * b + e[9] * c; nor[j + 2] = e[2] * a + e[6] * b + e[10] * c;   // (the matrices only turn and move)
      }
    } else { pos.set(P, v * 3); nor.set(N, v * 3); }
    col.set(g.attributes.color.array, v * 3);
    if (g.attributes.metal) met.set(g.attributes.metal.array, v);
    for (let i = 0; i < I.length; i++) idx[k++] = I[i] + v;
    v += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('metal', new THREE.BufferAttribute(met, 1));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.boundingSphere = KIT_SPHERE.clone();   // (what any kit can reach from its bone, without going through all of it)
  return out;
}
