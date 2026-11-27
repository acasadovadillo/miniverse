// What the travellers of the roads carry (src/travellers.js; docs/planes/realismo/PLAN-R7-mundo.md §3.9, §5): the pedlar's pack on
// a frame, with a rolled blanket over it and a pot at its side; the pilgrim's staff with its gourd; the woodcutter's log on the
// shoulder (the carried log of carry3d.js) and his axe at the belt; the fisher's rod across the back (the kit of kit3d.js) and
// his creel. Made on their body when it is made (actors.js calls e.gear), from the bones of the real person; the geometries are
// made once and shared by all of them (never released: a few small ones), in one material with its colour per vertex.
import * as THREE from 'three';
import { Builder, paint, mergeParts } from './geo.js';
import { carriedModel, placeCarried } from './carry3d.js';
import { kitOn } from './actors.js';

export const STAFF = [0.45, 0];   // (how the staff sits in the fist: about x and z; the numbers to fit with the captures)
const GEAR_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86 });
const GEO = new Map();
const once = (k, make) => { let g = GEO.get(k); if (!g) GEO.set(k, (g = make())); return g; };
const box = (parts, c, x0, y0, z0, x1, y1, z1, r = 0.02) => { const B = new Builder(); B.tint(c); B.roundBox(x0, y0, z0, x1, y1, z1, r, { s: 1 }); parts.push(B.geometry()); };
// A cylinder from a to b (radius r0 at a, r1 at b)
function rod(parts, c, a, b, r0, r1 = r0, seg = 7) {
  const A = new THREE.Vector3(...a), d = new THREE.Vector3(...b).sub(A), len = d.length(), g = new THREE.CylinderGeometry(r1, r0, len, seg);
  g.applyMatrix4(new THREE.Matrix4().compose(A.clone().addScaledVector(d, 0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()), new THREE.Vector3(1, 1, 1)));
  parts.push(paint(g, c));
}
function ball(parts, c, p, s) { const g = new THREE.SphereGeometry(1, 10, 8); g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion(), new THREE.Vector3(...s))); parts.push(paint(g, c)); }
const mesh = geo => { const o = new THREE.Mesh(geo, GEAR_MAT); o.castShadow = true; o.receiveShadow = true; o.userData.shared = true; return o; };

// The pedlar's pack, in the chest bone's frame (as the backpack: realperson.js addBag; z: + the front, x: + the body's left), from
// the body's fit: a frame of two ash uprights with a crossbar, the bale in sacking roped twice round, a rolled blanket on top, a
// tin pot and a bundle of rope at the side, and the two shoulder straps
function packGeo(fit) {
  const { back, top, front } = fit, z = back - 0.01, y1 = top + 0.12, y0 = top - 0.56, parts = [];
  const wood = '#5e4630', sack = '#7a6a4e', sack2 = '#685a42', rope = '#a08c64', blanket = '#6a3a2e', tin = '#7d8086', strap = '#4a3424';
  for (const s of [-1, 1]) rod(parts, wood, [s * 0.17, y0 - 0.06, z - 0.03], [s * 0.17, y1 + 0.12, z - 0.07], 0.016, 0.014);
  rod(parts, wood, [-0.19, y0 + 0.02, z - 0.035], [0.19, y0 + 0.02, z - 0.035], 0.013);
  box(parts, sack, -0.18, y0 + 0.03, z - 0.29, 0.18, y1 - 0.02, z - 0.04, 0.06);
  box(parts, sack2, -0.15, y0 + 0.2, z - 0.31, 0.15, y0 + 0.38, z - 0.27, 0.03);
  for (const y of [y0 + 0.14, y1 - 0.13]) box(parts, rope, -0.185, y - 0.012, z - 0.3, 0.185, y + 0.012, z - 0.035, 0.008);
  rod(parts, blanket, [-0.2, y1 + 0.05, z - 0.16], [0.2, y1 + 0.05, z - 0.16], 0.065, 0.065, 12);
  for (const x of [-0.13, 0.13]) rod(parts, rope, [x, y1 + 0.05 - 0.07, z - 0.16], [x, y1 + 0.05 + 0.068, z - 0.16], 0.07, 0.07, 12);
  rod(parts, tin, [0.2, y0 + 0.12, z - 0.17], [0.2, y0 + 0.26, z - 0.17], 0.065, 0.06, 12);
  rod(parts, '#3a3a3e', [0.2, y0 + 0.26, z - 0.17], [0.2, y0 + 0.272, z - 0.17], 0.062, 0.03, 12);
  rod(parts, rope, [-0.205, y0 + 0.2, z - 0.2], [-0.205, y0 + 0.2, z - 0.1], 0.05, 0.05, 10);
  for (const s of [-1, 1]) {
    const x = s * 0.09, sh = top + 0.065;
    rod(parts, strap, [x, y1 - 0.05, z - 0.03], [x, sh, back * 0.4], 0.012);
    rod(parts, strap, [x, sh, back * 0.4], [x * 1.05, sh - 0.015, front * 0.45], 0.012);
    rod(parts, strap, [x * 1.05, sh - 0.015, front * 0.45], [x * 1.6, top - 0.2, front * 0.75], 0.012);
    rod(parts, strap, [x * 1.6, top - 0.2, front * 0.75], [s * 0.16, y0 + 0.1, z - 0.05], 0.012);
  }
  return mergeParts(parts);
}
// The pilgrim's staff, in the right hand bone (the hand closed round it a little above its middle; the bone's +y goes up from the
// fist): as tall as she is, knobbed at the head, with a gourd hanging from it on a cord
function staffGeo() {
  return once('staff', () => {
    const parts = [], wood = '#7a5a3a';
    rod(parts, wood, [0, -0.86, 0], [0, 0.56, 0], 0.016, 0.018);
    ball(parts, '#6a4a2e', [0, 0.58, 0], [0.027, 0.03, 0.027]);
    rod(parts, '#d8c8a0', [0, 0.47, 0], [0.035, 0.38, 0.02], 0.004);
    ball(parts, '#b8904e', [0.04, 0.33, 0.025], [0.036, 0.045, 0.036]);
    ball(parts, '#b8904e', [0.04, 0.4, 0.025], [0.025, 0.028, 0.025]);
    return mergeParts(parts);
  });
}
// The fisher's creel at the left hip (wicker, a strap over the right shoulder), in the chest bone's frame
function creelGeo(fit) {
  const { top, front, back } = fit, parts = [], y = top - 0.62, wicker = '#a48a5a';
  box(parts, wicker, 0.15, y - 0.1, -0.08, 0.27, y + 0.08, 0.08, 0.03);
  box(parts, '#8a7046', 0.145, y + 0.07, -0.085, 0.275, y + 0.095, 0.085, 0.012);
  rod(parts, '#4a3424', [0.21, y + 0.09, back * 0.5], [-0.09, top + 0.06, back * 0.3], 0.01);
  rod(parts, '#4a3424', [-0.09, top + 0.06, back * 0.3], [-0.08, top + 0.04, front * 0.5], 0.01);
  rod(parts, '#4a3424', [-0.08, top + 0.04, front * 0.5], [0.21, y + 0.09, front * 0.55], 0.01);
  return mergeParts(parts);
}

// Dress a traveller's body (P: its RealPerson) for their trade. e: the traveller (travellers.js), its type; what is put on is kept
// on P (P.tvLoad: the woodcutter's log, shown while he carries it)
export function dress(P, e) {
  const fit = P.bagFit();
  if (e.type === 'pedlar') { const o = mesh(once(`pack:${fit.back.toFixed(3)}:${fit.top.toFixed(3)}`, () => packGeo(fit))); P.torso.add(o); P.tvPack = o; }
  else if (e.type === 'pilgrim') { const o = mesh(staffGeo()); o.position.set(0, -0.05, 0.03); o.rotation.set(STAFF[0], 0, STAFF[1]); P.hand.add(o); P.tvStaff = o; }
  else if (e.type === 'woodcutter') {
    const o = carriedModel('log'); placeCarried(o, 'log', fit); P.torso.add(o); P.tvLoad = o;
    kitOn(P, ['hacha_hierro']);
  } else if (e.type === 'fisher') {
    kitOn(P, ['cana']);
    const o = mesh(once(`creel:${fit.back.toFixed(3)}:${fit.top.toFixed(3)}`, () => creelGeo(fit))); P.torso.add(o); P.tvCreel = o;
  }
}
