// The wolves' kill sites (Plan R3-5, predators.js kills: today's and yesterday's round you). A fresh one is a hind on her
// side, opened and part eaten: the gutted carcass of the game's own carcasses (models.js), its ribs bare and red over the
// open flank, the ground dark round it and tufts of her hair torn out about it. Yesterday's is only bones: the skull, the
// ribs of a spine, two long bones and the hair. At most SHOWN, made again only when the list changes (killsV).
import * as THREE from 'three';
import { getModel, modelMat } from './models.js';
import { nearX } from '../world/planet.js';

const SHOWN = 3;
const rnd = (i, s) => { const v = Math.sin(i * 91.7 + s * 13.3 + 3.1) * 43758.5453; return v - Math.floor(v); };
let MATS = null;
const mats = () => (MATS ||= {
  bone: new THREE.MeshStandardMaterial({ color: '#d8cdb4', roughness: 0.75 }),
  raw: new THREE.MeshStandardMaterial({ color: '#7a2a22', roughness: 0.45 }),
  ribs: new THREE.MeshStandardMaterial({ color: '#c9a898', roughness: 0.55 }),
  blood: new THREE.MeshStandardMaterial({ color: '#3a1410', roughness: 0.9, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  hair: new THREE.MeshStandardMaterial({ color: '#8a6a4c', roughness: 1 }),
});
const GEO = {};
const geo = (k, make) => (GEO[k] ||= make());
// (a curved rib, standing out of the open side)
const ribGeo = (len, i) => geo('rib' + i, () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.05 * len, 0.45 * len, 0), new THREE.Vector3(0.22 * len, 0.85 * len, 0.02), new THREE.Vector3(0.42 * len, 1 * len, 0.03)]), 10, 0.011, 5));
// (the stain: an uneven disc, darker in the middle)
const stainGeo = () => geo('stain', () => { const g = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2), p = g.attributes.position; for (let i = 1; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)), k = 0.7 + 0.18 * Math.sin(a * 3 + 1) + 0.12 * Math.sin(a * 7 + 2); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); } return g; });
function modelGroup(name) {
  const m = getModel(name), out = new THREE.Group();
  if (!m) return out;
  for (const [key, B] of m.parts) { const o = B.mesh(modelMat(key)); o.castShadow = true; o.receiveShadow = true; out.add(o); }
  for (const e of m.extras) out.add(e.clone());
  return out;
}
// One kill site: fresh (a part-eaten hind) or bones
export function killModel(bones, seed = 1) {
  const root = new THREE.Group(), T = mats(), add = (g, mat, p, r = [0, 0, 0], s = [1, 1, 1]) => { const o = new THREE.Mesh(g, mat); o.position.set(...p); o.rotation.set(...r); o.scale.set(...s); o.castShadow = mat !== T.blood; o.receiveShadow = true; root.add(o); return o; };
  add(stainGeo(), T.blood, [0.05, 0.012, 0], [0, seed * 2, 0], bones ? [0.75, 1, 0.6] : [1.05, 1, 0.8]);
  if (!bones) {
    root.add(modelGroup('carcass_hind:gutted'));
    // (the open flank: raw meat, and the ribs bare over it)
    // (the carcass lies along x with its opened side to +z: models.js carcassModel)
    add(geo('flank', () => new THREE.SphereGeometry(1, 16, 10)), T.raw, [-0.02, 0.1, 0.1], [0, 0, 0], [0.2, 0.06, 0.05]);
    for (let i = 0; i < 6; i++) add(ribGeo(0.2 + 0.03 * Math.sin(i * 1.3), i % 3), T.ribs, [-0.2 + i * 0.07, 0.1, 0.06], [0, -Math.PI / 2 + (rnd(i, seed) - 0.5) * 0.25, 0], [1, 1, 1]);
  } else {
    // (the skull, the spine with its ribs, two long bones: what the wolves and the birds left)
    add(geo('skull', () => new THREE.SphereGeometry(1, 14, 10)), T.bone, [0.05, 0.07, 0.62], [0.2, 0.3, 0], [0.07, 0.065, 0.14]);
    add(geo('jaw', () => new THREE.CylinderGeometry(0.012, 0.02, 0.22, 6)), T.bone, [0.0, 0.03, 0.74], [Math.PI / 2, 0, 0.3]);
    add(geo('spine', () => new THREE.CylinderGeometry(0.022, 0.026, 0.8, 8)), T.bone, [0.03, 0.035, 0.1], [Math.PI / 2, 0, 0.06]);
    for (let i = 0; i < 7; i++) add(ribGeo(0.26, i % 3), T.bone, [0.03, 0.04, -0.16 + i * 0.07], [Math.PI / 2 - 0.15, Math.PI / 2 * (i % 2 ? 1 : -1) + (rnd(i, seed) - 0.5) * 0.4, 0], [1, 1, 1]);
    for (let i = 0; i < 2; i++) add(geo('long', () => new THREE.CylinderGeometry(0.018, 0.016, 0.42, 7)), T.bone, [0.5 - i * 1.0, 0.02, -0.35 + i * 0.2], [Math.PI / 2, 0, 0.9 + i * 1.7]);
  }
  // (tufts of hair torn out round it)
  for (let i = 0; i < 9; i++) { const a = rnd(i, seed + 4) * Math.PI * 2, d = 0.5 + rnd(i, seed + 5) * 0.9; add(geo('tuft', () => new THREE.SphereGeometry(1, 6, 4)), T.hair, [Math.cos(a) * d, 0.012, Math.sin(a) * d], [0, a, 0], [0.05, 0.012, 0.035]); }
  return root;
}
export class KillView {
  constructor(view) { this.view = view; this.pool = []; this.v = -1; }
  update(game, scene) {
    const P = game.predators, list = scene === game.world && P ? P.kills : [], me = game.player;
    if (P && P.killsV !== this.v) {
      this.v = P.killsV;
      list.slice(0, SHOWN).forEach((K, i) => {
        let o = this.pool[i];
        if (!o || o.userData.bones !== K.bones) { if (o) this.view.scene.remove(o); o = this.pool[i] = killModel(K.bones, (K.day % 7) + 1); o.userData.bones = K.bones; this.view.scene.add(o); }
        o.position.set(K.x, this.view.groundY(scene, K.x, K.y), K.y); o.rotation.y = K.yaw;
      });
    }
    for (let i = 0; i < this.pool.length; i++) {
      const o = this.pool[i], K = list[i];
      o.visible = !!K && i < SHOWN;
      if (K) o.position.x = nearX(K.x, me?.x ?? K.x);
    }
  }
}
