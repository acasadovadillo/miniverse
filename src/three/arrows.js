// Las flechas en vuelo y clavadas: un astil, una punta y unas plumas, apuntando hacia donde van.
import * as THREE from 'three';
import { nearX } from '../world/planet.js';

const WOOD = new THREE.MeshStandardMaterial({ color: '#b08a58', roughness: 0.8 });
const TIP = new THREE.MeshStandardMaterial({ color: '#8a9098', roughness: 0.4, metalness: 0.6 });
const VANE = new THREE.MeshStandardMaterial({ color: '#f4f0e8', roughness: 0.9, side: THREE.DoubleSide });
const SHAFT = new THREE.CylinderGeometry(0.014, 0.014, 0.66, 6).rotateX(Math.PI / 2);
const HEAD = new THREE.ConeGeometry(0.035, 0.1, 6).rotateX(Math.PI / 2).translate(0, 0, 0.38);
const FLETCH = new THREE.PlaneGeometry(0.07, 0.14).translate(0, 0, -0.27).rotateZ(0).rotateY(Math.PI / 2);
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
    this.group.add(g);
    return g;
  }
  update(game, scene) {
    const list = game.archery?.list || [], me = game.player;
    let n = 0;
    for (const a of list) {
      if (a.scene !== scene) continue;
      const g = this.pool[n] ||= this.make();
      n++;
      g.visible = true;
      // (clavada, ya está donde queda con la punta dentro: ver archery.js, stick)
      D.set(a.vx, a.vh, a.vy).normalize();
      g.position.set(nearX(a.x, me?.x ?? a.x), a.h, a.y);
      g.quaternion.setFromUnitVectors(Z, D);
    }
    for (let i = n; i < this.pool.length; i++) this.pool[i].visible = false;
  }
}
