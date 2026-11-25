// Las flechas en vuelo y clavadas: un astil, una punta y unas plumas, apuntando hacia donde van.
// One that has been in an animal (a.b: archery.js, anatomy.js READING) is stained by what it went through (Plan R3-3): bright
// and frothy, the lungs; dark, the liver; greenish brown, the gut; a few smears, the rest. With Settings › blood off, clean.
import * as THREE from 'three';
import { nearX } from '../world/planet.js';
import { Settings } from '../settings.js';
import { ZONE } from '../anatomy.js';

const WOOD = new THREE.MeshStandardMaterial({ color: '#b08a58', roughness: 0.8 });
const TIP = new THREE.MeshStandardMaterial({ color: '#8a9098', roughness: 0.4, metalness: 0.6 });
const VANE = new THREE.MeshStandardMaterial({ color: '#f4f0e8', roughness: 0.9, side: THREE.DoubleSide });
const SHAFT = new THREE.CylinderGeometry(0.014, 0.014, 0.66, 6).rotateX(Math.PI / 2);
const HEAD = new THREE.ConeGeometry(0.035, 0.1, 6).rotateX(Math.PI / 2).translate(0, 0, 0.38);
const FLETCH = new THREE.PlaneGeometry(0.07, 0.14).rotateX(Math.PI / 2).translate(0, 0, -0.25);   // (along the shaft, at its tail)
// The stained ones: the same shaft with its colours per vertex (patches from the point back, more of it where it went all
// the way through), the vanes tinted. Made the first time one is seen
const WOOD_C = new THREE.Color('#b08a58'), VANE_C = new THREE.Color('#f4f0e8');
const STAIN = {
  [ZONE.vital]: { c: '#96201a', spots: '#d89a90', k: 0.95, back: 1, vane: 0.55 },
  [ZONE.liver]: { c: '#3c0d0c', spots: '#2a0808', k: 0.95, back: 1, vane: 0.45 },
  [ZONE.gut]: { c: '#5a5526', spots: '#4a1c12', k: 0.85, back: 0.75, vane: 0.2 },
  [ZONE.spine]: { c: '#6a1612', spots: '#c8b8a0', k: 0.7, back: 0.4, vane: 0 },
  [ZONE.body]: { c: '#6e1511', spots: '#4a0f0c', k: 0.85, back: 0.5, vane: 0.05 },
  [ZONE.leg]: { c: '#6e1511', spots: '#8a6a4a', k: 0.6, back: 0.42, vane: 0 },
  [ZONE.graze]: { c: '#7a201a', spots: '#8a6a4a', k: 0.5, back: 0.28, vane: 0 },
};
const STAINED = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 });
const kits = new Map();
const noise = (i, j) => { const v = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return v - Math.floor(v); };
function kitOf(b) {
  if (kits.has(b)) return kits.get(b);
  const S = STAIN[b] || STAIN[ZONE.body], c = new THREE.Color(S.c), sp = new THREE.Color(S.spots), q = new THREE.Color();
  const shaft = new THREE.CylinderGeometry(0.0155, 0.0155, 0.66, 7, 26).rotateX(Math.PI / 2), P = shaft.attributes.position, col = new Float32Array(P.count * 3);
  for (let i = 0; i < P.count; i++) {
    const z = P.getZ(i), back = (0.33 - z) / 0.66, j = Math.round(z * 40), side = Math.round(Math.atan2(P.getY(i), P.getX(i)) * 1.12);   // (0 at the point)
    const wet = Math.max(0, Math.min(1, (S.back + 0.1 - back) / 0.16)) * S.k, n = noise(j, side + 7), run = noise(3, side);
    q.copy(WOOD_C).lerp(c, wet * (n < 0.16 ? 0.25 : 0.72 + 0.28 * run)).lerp(sp, wet * (n > 0.78 ? 0.6 : 0));
    q.toArray(col, i * 3);
  }
  shaft.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const vane = new THREE.MeshStandardMaterial({ color: VANE_C.clone().lerp(c, S.vane), roughness: 0.9, side: THREE.DoubleSide });
  const head = new THREE.MeshStandardMaterial({ color: new THREE.Color('#8a9098').lerp(c, Math.min(0.75, S.k)), roughness: 0.45, metalness: 0.35 });
  const kit = { shaft, mat: STAINED, vane, head };
  kits.set(b, kit);
  return kit;
}
const CLEAN = { shaft: SHAFT, mat: WOOD, vane: VANE, head: TIP };
const Z = new THREE.Vector3(0, 0, 1), D = new THREE.Vector3();

export class ArrowsView {
  constructor(view) {
    this.group = new THREE.Group();
    view.scene.add(this.group);
    this.pool = [];
  }
  make() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(SHAFT, WOOD), new THREE.Mesh(HEAD, TIP));
    for (const r of [0, Math.PI / 2]) { const f = new THREE.Mesh(FLETCH, VANE); f.rotation.z = r; g.add(f); }
    g.userData.b = undefined;
    this.group.add(g);
    return g;
  }
  update(game, scene) {
    const list = game.archery?.list || [], me = game.player;
    const red = Settings.v.blood !== false;
    let n = 0;
    for (const a of list) {
      if (a.scene !== scene) continue;
      const g = this.pool[n] ||= this.make();
      n++;
      g.visible = true;
      const b = red ? a.b : undefined;
      if (g.userData.b !== b) {
        const k = b === undefined ? CLEAN : kitOf(b), [s, h, f, e] = g.children;
        g.userData.b = b;
        s.geometry = k.shaft; s.material = k.mat; h.material = k.head; f.material = e.material = k.vane;
      }
      // (clavada, ya está donde queda con la punta dentro: ver archery.js, stick)
      D.set(a.vx, a.vh, a.vy).normalize();
      g.position.set(nearX(a.x, me?.x ?? a.x), a.h, a.y);
      g.quaternion.setFromUnitVectors(Z, D);
    }
    for (let i = n; i < this.pool.length; i++) this.pool[i].visible = false;
  }
}
