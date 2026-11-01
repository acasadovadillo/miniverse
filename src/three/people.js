// Personas en 3D: chibis de pocos polígonos a partir de los mismos "look" del juego (sexo, peinado,
// colores de pelo, piel, ojos y ropa, tipo de ropa y barba). Cabeza grande, cuerpo pequeño y animación de
// andar (piernas y brazos que se balancean, un leve bote) y de respirar en reposo. Mira hacia z+.
import * as THREE from 'three';
import { mat } from './geo.js';

export const G = {
  head: new THREE.SphereGeometry(0.29, 24, 18), eye: new THREE.SphereGeometry(1, 12, 8), ball: new THREE.SphereGeometry(1, 14, 10),
  limb: new THREE.CapsuleGeometry(0.055, 0.2, 4, 8), leg: new THREE.CapsuleGeometry(0.07, 0.16, 4, 8), boot: new THREE.SphereGeometry(1, 10, 8),
  cone: new THREE.ConeGeometry(1, 1, 10), cyl: new THREE.CylinderGeometry(1, 1, 1, 14),
};
const cache = new Map();
export const M = (c, o = {}) => { const k = c + JSON.stringify(o); if (!cache.has(k)) cache.set(k, mat({ color: c, roughness: 0.75, ...o })); return cache.get(k); };
const shade = (c, k) => '#' + new THREE.Color(c).multiplyScalar(k).getHexString();

export function mesh(geo, m, { p = [0, 0, 0], s = [1, 1, 1], r = [0, 0, 0] } = {}, parent) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(...p); o.scale.set(...(typeof s === 'number' ? [s, s, s] : s)); o.rotation.set(...r);
  o.castShadow = true;
  parent?.add(o);
  return o;
}

// Junta las mallas hijas directas de un grupo en una (posición, normal y color de su material)
const SKIN = mat({ vertexColors: true, roughness: 0.7 });
export function mergeInto(group) {
  const parts = group.children.filter(o => o.isMesh);
  if (parts.length < 2) return;
  const pos = [], nor = [], col = [];
  for (const o of parts) {
    o.updateMatrix();
    const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrix), c = o.material.color;
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array);
    for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b);
    group.remove(o);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  group.add(new THREE.Mesh(geo, SKIN));
}

export class Person3D {
  constructor(look, name = '') {
    this.look = look; this.name = name;
    this.root = new THREE.Group();
    this.body = new THREE.Group(); this.body.name = 'body'; this.root.add(this.body);
    this.phase = Math.random() * 6; this.speed = 0; this.targetYaw = 0;
    const L = look, skin = M(L.skin), cloth = M(L.cloth), pants = M(L.pants || '#4a3a2a'), hair = M(L.hair, { roughness: 0.6 });
    const girl = L.sex === 'chica', boots = M('#5a3a24');
    // Piernas (con bota) y caderas
    this.legs = [-1, 1].map(s => {
      const hip = new THREE.Group(); hip.name = s < 0 ? 'legL' : 'legR'; hip.position.set(s * 0.085, 0.36, 0); this.body.add(hip);
      mesh(G.leg, pants, { p: [0, -0.14, 0] }, hip);
      mesh(G.boot, boots, { p: [0, -0.31, 0.03], s: [0.085, 0.06, 0.12] }, hip);
      return hip;
    });
    // Tronco y ropa
    const torso = new THREE.Group(); torso.name = 'torso'; torso.position.y = 0.36; this.body.add(torso); this.torso = torso;
    const long = L.outfit === 'larga' || L.outfit === 'tunica';
    mesh(G.cyl, cloth, { p: [0, 0.2, 0], s: [0.17, 0.4, 0.13] }, torso);
    mesh(G.ball, cloth, { p: [0, 0.4, 0], s: [0.19, 0.08, 0.14] }, torso);                       // hombros
    if (long) mesh(G.cone, cloth, { p: [0, L.outfit === 'larga' ? -0.02 : 0.06, 0], s: [0.22, L.outfit === 'larga' ? 0.36 : 0.22, 0.17], r: [0, 0, 0] }, torso);
    else mesh(G.cyl, pants, { p: [0, 0.02, 0], s: [0.175, 0.08, 0.135] }, torso);
    if (L.outfit === 'delantal') { mesh(G.cyl, M('#efe6d4'), { p: [0, 0.1, 0.1], s: [0.13, 0.42, 0.04] }, torso); mesh(G.cyl, M('#d8ccb4'), { p: [0, 0.32, 0.115], s: [0.16, 0.02, 0.03], r: [Math.PI / 2, 0, Math.PI / 2] }, torso); }
    if (L.outfit === 'tunica' || L.outfit === 'larga') mesh(G.cyl, M('#5a3a22'), { p: [0, 0.1, 0], s: [0.18, 0.04, 0.14] }, torso);
    if (L.outfit === 'tunica' || L.outfit === 'larga') mesh(G.cyl, M('#e8c050', { metalness: 0.5, roughness: 0.4 }), { p: [0, 0.1, 0.13], s: [0.03, 0.045, 0.012], r: [Math.PI / 2, 0, 0] }, torso);
    if (L.outfit === 'chaleco') { for (const s of [-1, 1]) mesh(G.cyl, M(shade(L.cloth, 0.6)), { p: [s * 0.08, 0.22, 0.1], s: [0.06, 0.36, 0.035] }, torso); mesh(G.cyl, M('#ece4d4'), { p: [0, 0.22, 0.095], s: [0.04, 0.36, 0.03] }, torso); }
    // Brazos, con manga y mano
    this.arms = [-1, 1].map(s => {
      const sh = new THREE.Group(); sh.name = s < 0 ? 'armL' : 'armR'; sh.position.set(s * 0.21, 0.38, 0); torso.add(sh);
      mesh(G.limb, cloth, { p: [0, -0.12, 0], r: [0, 0, s * 0.12] }, sh);
      mesh(G.ball, skin, { p: [s * 0.03, -0.27, 0], s: 0.058 }, sh);
      return sh;
    });
    // Cabeza: cara, ojos con brillo, mejillas, boca, nariz y orejas
    const head = new THREE.Group(); head.name = 'head'; head.position.y = 0.43 + 0.28; torso.add(head); this.head = head;
    mesh(G.head, skin, { s: [1, 0.96, 0.96] }, head);
    const eye = M(L.eyes || '#3a2a1e', { roughness: 0.3 }), white = M('#ffffff', { roughness: 0.2 }), lash = M('#2a1a1a');
    for (const s of [-1, 1]) {
      mesh(G.eye, white, { p: [s * 0.1, 0.0, 0.252], s: [0.055, 0.068, 0.03] }, head);
      mesh(G.eye, eye, { p: [s * 0.1, -0.005, 0.27], s: [0.04, 0.054, 0.02] }, head);
      mesh(G.eye, white, { p: [s * 0.1 + 0.014, 0.018, 0.285], s: [0.012, 0.014, 0.006] }, head);
      if (girl) mesh(G.cyl, lash, { p: [s * 0.1, 0.07, 0.262], s: [0.05, 0.01, 0.012], r: [Math.PI / 2 - 0.2, 0, s * 0.15] }, head);
      else mesh(G.cyl, M(shade(L.hair, 0.8)), { p: [s * 0.1, 0.1, 0.258], s: [0.045, 0.012, 0.014], r: [Math.PI / 2 - 0.3, 0, -s * 0.1] }, head);
      mesh(G.eye, M('#' + new THREE.Color(L.skin).lerp(new THREE.Color('#ff7a8a'), 0.45).getHexString()), { p: [s * 0.16, -0.08, 0.235], s: [0.045, 0.025, 0.02] }, head);
      mesh(G.ball, skin, { p: [s * 0.285, -0.02, 0], s: [0.035, 0.06, 0.045] }, head);
    }
    mesh(G.ball, M(shade(L.skin, 0.92)), { p: [0, -0.06, 0.285], s: [0.028, 0.022, 0.02] }, head);
    mesh(G.cyl, M(girl ? '#c8506a' : '#8a3a3a'), { p: [0, -0.13, 0.262], s: [0.035, 0.008, 0.012], r: [Math.PI / 2, 0, 0] }, head);
    if (L.beard) mesh(G.ball, hair, { p: [0, -0.17, 0.12], s: [0.2, 0.13, 0.17] }, head);
    this.hair(head, L, hair);
    // Cada parte que se mueve junta (piernas, brazos, tronco y cabeza) en una sola malla con colores por vértice
    for (const grp of [...this.legs, ...this.arms, torso, head]) mergeInto(grp);
    this.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  }
  // Peinados: casquete y lo propio de cada uno
  hair(head, L, m) {
    const st = L.hairStyle;
    if (st === 'calvo') return;
    const cap = st === 'rapado' ? 1.02 : 1.08;
    // Casquete: media esfera inclinada hacia atrás, que deja la cara al aire
    const capGeo = new THREE.SphereGeometry(0.29, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.55);
    mesh(capGeo, m, { p: [0, 0.03, -0.02], s: [cap, cap, cap], r: [-0.62, 0, 0] }, head);
    if (st === 'rapado') return;
    // Flequillo
    for (let i = -2; i <= 2; i++) mesh(G.ball, m, { p: [i * 0.065, 0.19 - Math.abs(i) * 0.015, 0.2 - Math.abs(i) * 0.025], s: [0.065, 0.05, 0.05], r: [0, 0, i * 0.2] }, head);
    // Volumen a los lados (por encima de las orejas) y detrás
    for (const s of [-1, 1]) mesh(G.ball, m, { p: [s * 0.255, 0.07, -0.04], s: [0.065, 0.13, 0.17] }, head);
    mesh(G.ball, m, { p: [0, 0.02, -0.17], s: [0.25, 0.22, 0.16] }, head);
    if (st === 'largo') {
      mesh(G.ball, m, { p: [0, -0.12, -0.12], s: [0.29, 0.34, 0.2] }, head);
      for (const s of [-1, 1]) mesh(G.ball, m, { p: [s * 0.25, -0.12, 0.02], s: [0.07, 0.24, 0.11] }, head);
    }
    if (st === 'coleta') {
      mesh(G.ball, m, { p: [0, 0.06, -0.3], s: [0.07, 0.07, 0.06] }, head);
      mesh(G.ball, M('#e8c050'), { p: [0, 0.06, -0.33], s: [0.05, 0.05, 0.03] }, head);
      mesh(G.ball, m, { p: [0, -0.06, -0.37], s: [0.075, 0.17, 0.075], r: [0.35, 0, 0] }, head);
      mesh(G.ball, m, { p: [0, -0.22, -0.4], s: [0.05, 0.08, 0.05] }, head);
    }
    if (st === 'mono') mesh(G.ball, m, { p: [0, 0.3, -0.06], s: 0.11 }, head);
    if (st === 'rizado') for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; mesh(G.ball, m, { p: [Math.cos(a) * 0.25, 0.1 + Math.sin(i * 1.7) * 0.06, Math.sin(a) * 0.23 - 0.04], s: 0.085 }, head); }
    if (st === 'pinchos') for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; mesh(G.cone, m, { p: [Math.cos(a) * 0.14, 0.28, Math.sin(a) * 0.14 - 0.03], s: [0.06, 0.16, 0.06], r: [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5] }, head); }
  }
  // Otra persona igual (comparte geometrías y materiales: hacer una desde cero cuesta)
  clone() {
    const c = Object.create(Person3D.prototype), root = this.root.clone(true), by = n => root.getObjectByName(n);
    Object.assign(c, { look: this.look, name: this.name, root, body: by('body'), torso: by('torso'), head: by('head'), legs: [by('legL'), by('legR')], arms: [by('armL'), by('armR')], phase: Math.random() * 6, speed: 0, targetYaw: 0 });
    return c;
  }
  // Animación: speed en m/s (0 = quieto)
  update(dt, speed) {
    this.speed += (speed - this.speed) * Math.min(1, dt * 10);
    const k = Math.min(1, this.speed / 3);
    this.phase += dt * (2 + this.speed * 3.2);
    const sw = Math.sin(this.phase) * 0.75 * k;
    this.legs[0].rotation.x = sw; this.legs[1].rotation.x = -sw;
    this.arms[0].rotation.x = -sw * 0.9; this.arms[1].rotation.x = sw * 0.9;
    this.body.position.y = Math.abs(Math.cos(this.phase)) * 0.05 * k + Math.sin(this.phase * 0.5) * 0.004 * (1 - k);
    this.torso.rotation.y = sw * 0.12;
    this.head.rotation.z = Math.sin(this.phase * 0.5) * 0.02 * (1 - k);
    // Gira hacia donde va, sin brusquedad
    let d = this.targetYaw - this.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.root.rotation.y += d * Math.min(1, dt * 12);
  }
  set facing(yaw) { this.targetYaw = yaw; }
  get facing() { return this.targetYaw ?? 0; }
}
