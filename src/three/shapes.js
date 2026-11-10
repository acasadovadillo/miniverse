// Piezas de los modelos hechos a mano (animales, monstruos, herramientas, barca): geometrías unidad, materiales por
// color apagados con sobrio() y juntar mallas. (Venían de los muñecos de antes, people.js, que ya no están: son las
// mismas, con los mismos números, para que todo eso se vea igual.)
import * as THREE from 'three';
import { mat } from './geo.js';
import { sobrio } from '../arte.js';

// Las geometrías unidad: se escalan y se colocan en cada pieza
export const G = { ball: new THREE.SphereGeometry(1, 18, 14), cone: new THREE.ConeGeometry(1, 1, 10), cyl: new THREE.CylinderGeometry(1, 1, 1, 14), box: new THREE.BoxGeometry(1, 1, 1) };

const cache = new Map();
// (cada color se ve apagado con sobrio(), para que no chille sobre el mundo sobrio; la piel, con { piel: true })
export const M = (c, o = {}) => { const k = c + JSON.stringify(o); if (!cache.has(k)) { const { piel, ...rest } = o; cache.set(k, mat({ color: sobrio(c, piel ? 'piel' : undefined), roughness: 0.75, ...rest })); } return cache.get(k); };

export function mesh(geo, m, { p = [0, 0, 0], s = [1, 1, 1], r = [0, 0, 0] } = {}, parent) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(...p); o.scale.set(...(typeof s === 'number' ? [s, s, s] : s)); o.rotation.set(...r);
  o.castShadow = true;
  parent?.add(o);
  return o;
}

// Junta las mallas hijas directas de un grupo en una (posición, normal y color de su material). Lo que lleva
// dibujo de tela se junta aparte, una malla por tela y color, con sus coordenadas de textura. A todo, un poco
// de sombra en lo que mira hacia abajo (como la luz que rebota del suelo)
const SKIN = mat({ vertexColors: true, roughness: 0.7 }), SHADED = new Map(), WHITE_C = new THREE.Color(1, 1, 1);
export function mergeInto(group) {
  const parts = group.children.filter(o => o.isMesh && !o.userData.keep);   // (keep: se queda aparte, con su propio material)
  if (parts.length < 2) return;
  const sets = new Map();
  for (const o of parts) { const k = o.material.map ? o.material : SKIN; if (!sets.has(k)) sets.set(k, []); sets.get(k).push(o); }
  for (const [m, list] of sets) {
    const pos = [], nor = [], col = [], uv = [], tex = m !== SKIN;
    for (const o of list) {
      o.updateMatrix();
      const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrix), c = tex ? WHITE_C : o.material.color;
      pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array);
      if (tex) uv.push(...(g.attributes.uv?.array || new Float32Array(g.attributes.position.count * 2)));
      const n = g.attributes.normal, vc = g.attributes.color;   // (si la pieza trae su color por vértice, ese, por el del material)
      for (let i = 0; i < g.attributes.position.count; i++) { const k = 0.8 + 0.2 * (0.5 + 0.5 * n.getY(i)); col.push((vc ? vc.getX(i) : 1) * c.r * k, (vc ? vc.getY(i) : 1) * c.g * k, (vc ? vc.getZ(i) : 1) * c.b * k); }
      group.remove(o);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    if (tex) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeBoundingSphere();
    if (tex && !SHADED.has(m)) { const c = m.clone(); c.vertexColors = true; SHADED.set(m, c); }
    group.add(new THREE.Mesh(geo, tex ? SHADED.get(m) : SKIN));
  }
}
