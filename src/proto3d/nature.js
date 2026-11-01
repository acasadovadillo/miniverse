// Prototipo 3D: árboles, arbustos, rocas, matas de hierba y flores. Cada pieza (tronco, bolas de la copa,
// manzanas…) es una sola malla instanciada para todos los árboles: miles de piezas en pocas llamadas de dibujo.
import * as THREE from 'three';
import { rng, bark } from './textures.js';
import { mat } from './geo.js';

const tmp = new THREE.Object3D(), col = new THREE.Color();
// Viento: el tiempo que mueve la hierba y las copas (lo avanza el bucle del juego)
export const WIND = { value: 0 };
// Mece los vértices según su altura (amount: cuánto, en unidades de la pieza) y dónde está cada instancia
function sway(material, amount, speed = 1) {
  material.onBeforeCompile = sh => {
    sh.uniforms.windTime = WIND;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float windTime;').replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float t = windTime * ${speed.toFixed(2)};
      float s = sin(t * 1.6 + wp.x * 0.35 + wp.z * 0.25) * 0.6 + sin(t * 2.9 + wp.x * 0.9 - wp.z * 0.4) * 0.3;
      transformed.xz += vec2(s, s * 0.5) * ${amount.toFixed(3)} * max(position.y, 0.0);`);
  };
  return material;
}

// Juntar instancias de una misma geometría: list = [{ p: [x, y, z], s: [sx, sy, sz] | escala, r: [rx, ry, rz], c: '#hex' }]
function instanced(geo, material, list, { cast = true, receive = true } = {}) {
  const m = new THREE.InstancedMesh(geo, material, Math.max(1, list.length));
  m.count = list.length;
  list.forEach((it, i) => {
    tmp.position.set(...it.p);
    const s = typeof it.s === 'number' ? [it.s, it.s, it.s] : it.s || [1, 1, 1];
    tmp.scale.set(...s);
    tmp.rotation.set(...(it.r || [0, 0, 0]));
    tmp.updateMatrix();
    m.setMatrixAt(i, tmp.matrix);
    if (it.c) m.setColorAt(i, col.set(it.c));
  });
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.castShadow = cast; m.receiveShadow = receive;
  return m;
}

const LEAF = ['#4f9a3a', '#5aa642', '#468c34', '#62ad48', '#3f8030'], PINE = ['#2f6a3c', '#357444', '#2a5e36', '#3c7c48'];
const FRUIT_LEAF = ['#62ad48', '#6cb850', '#58a040'];

// Vegetación a partir de una lista de { kind, x, z, y } (y: altura del suelo). kinds: oak, fruit, pine, bush, rock, boulder
export function buildNature(items, seed = 1) {
  const r = rng(seed), group = new THREE.Group();
  const trunks = [], lumps = [], apples = [], cones = [], bushes = [], blossoms = [], rocks = [], colliders = [];
  for (const it of items) {
    const { x, z, y = 0 } = it, k = 0.85 + r() * 0.35, rot = r() * Math.PI * 2;
    if (it.kind === 'oak' || it.kind === 'fruit') {
      const h = 1.5 * k;
      trunks.push({ p: [x, y + h / 2, z], s: [k, h, k], r: [0, rot, 0] });
      // Copa: una bola grande y cuatro o cinco alrededor, un poco al azar
      const cy = y + h + 1.0 * k, n = 4 + Math.floor(r() * 2), pal = it.kind === 'fruit' ? FRUIT_LEAF : LEAF;
      lumps.push({ p: [x, cy + 0.25 * k, z], s: 1.05 * k, r: [r(), r(), r()], c: pal[Math.floor(r() * pal.length)] });
      for (let i = 0; i < n; i++) {
        const a = rot + (i / n) * Math.PI * 2, d = 0.55 * k;
        lumps.push({ p: [x + Math.cos(a) * d, cy - 0.15 * k + r() * 0.3, z + Math.sin(a) * d], s: (0.65 + r() * 0.2) * k, r: [r(), r(), r()], c: pal[Math.floor(r() * pal.length)] });
      }
      if (it.kind === 'fruit') for (let i = 0; i < 9; i++) {
        const a = r() * Math.PI * 2, e = r() * 0.9 - 0.2, d = 1.05 * k;
        apples.push({ p: [x + Math.cos(a) * Math.cos(e) * d, cy + Math.sin(e) * d * 0.8, z + Math.sin(a) * Math.cos(e) * d], s: 0.12 });
      }
      colliders.push({ x, z, r: 0.38 });
    } else if (it.kind === 'pine') {
      const h = 0.9 * k;
      trunks.push({ p: [x, y + h / 2, z], s: [0.75 * k, h, 0.75 * k], r: [0, rot, 0] });
      for (let i = 0; i < 3; i++) cones.push({ p: [x, y + h + 0.55 * k + i * 0.75 * k, z], s: [(1.25 - i * 0.3) * k, 1.1 * k, (1.25 - i * 0.3) * k], r: [0, rot + i, 0], c: PINE[Math.floor(r() * PINE.length)] });
      colliders.push({ x, z, r: 0.35 });
    } else if (it.kind === 'bush') {
      const n = 3 + Math.floor(r() * 2), pal = LEAF;
      for (let i = 0; i < n; i++) {
        const a = rot + (i / n) * Math.PI * 2, d = 0.22;
        bushes.push({ p: [x + Math.cos(a) * d, y + 0.3 + r() * 0.1, z + Math.sin(a) * d], s: 0.32 + r() * 0.1, r: [r(), r(), r()], c: pal[Math.floor(r() * pal.length)] });
      }
      if (it.flowers) for (let i = 0; i < 8; i++) { const a = r() * Math.PI * 2, d = 0.25 + r() * 0.15; blossoms.push({ p: [x + Math.cos(a) * d, y + 0.45 + r() * 0.2, z + Math.sin(a) * d], s: 0.06, c: it.flowers }); }
      colliders.push({ x, z, r: 0.42 });
    } else if (it.kind === 'rock' || it.kind === 'boulder') {
      const s = it.kind === 'boulder' ? 0.75 : 0.28 + r() * 0.12;
      rocks.push({ p: [x, y + s * 0.35, z], s: [s * (1 + r() * 0.3), s * 0.7, s], r: [0, rot, 0], c: ['#9a958c', '#8c877e', '#a8a39a'][Math.floor(r() * 3)] });
      colliders.push({ x, z, r: s * 0.9 });
    }
  }
  const trunkGeo = new THREE.CylinderGeometry(0.13, 0.2, 1, 7); trunkGeo.translate(0, 0, 0);
  const barkTex = bark(); barkTex.repeat.set(2, 1);
  const leafMat = sway(mat({ flatShading: true, roughness: 0.95 }), 0.035, 0.7);
  group.add(instanced(trunkGeo, mat({ map: barkTex }), trunks));
  group.add(instanced(new THREE.IcosahedronGeometry(1, 1), leafMat, lumps));
  group.add(instanced(new THREE.SphereGeometry(1, 8, 6), mat({ color: '#d8352a', roughness: 0.5 }), apples));
  group.add(instanced(new THREE.ConeGeometry(1, 1.4, 8), leafMat, cones));
  group.add(instanced(new THREE.IcosahedronGeometry(1, 1), leafMat, bushes));
  group.add(instanced(new THREE.IcosahedronGeometry(1, 0), mat({ roughness: 0.6 }), blossoms, { cast: false }));
  group.add(instanced(new THREE.DodecahedronGeometry(1, 0), mat({ flatShading: true, roughness: 0.9 }), rocks));
  return { group, colliders };
}

// Matas de hierba (tres hojas cruzadas) y flores pequeñas sobre la hierba. spots: [{ x, z, y }]
export function buildGround(spots, flowerSpots, seed = 2) {
  const r = rng(seed), group = new THREE.Group();
  // Una mata: tres hojas finas, cruzadas, más claras en la punta
  const blade = new THREE.BufferGeometry(), pos = [], cols = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI, w = 0.045, h = 0.17 + (i % 2) * 0.06, dx = Math.cos(a) * w, dz = Math.sin(a) * w, lean = 0.04 * (i - 1);
    pos.push(-dx, 0, -dz, dx, 0, dz, lean, h, lean);
    cols.push(0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 1.12, 1.12, 1.12);
  }
  blade.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  blade.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  blade.computeVertexNormals();
  const grassMat = sway(mat({ vertexColors: true, side: THREE.DoubleSide, roughness: 1 }), 0.3);
  group.add(instanced(blade, grassMat, spots.map(s => ({ p: [s.x, s.y, s.z], s: 0.8 + r() * 0.7, r: [0, r() * Math.PI, 0], c: ['#6aae4a', '#76b854', '#62a444', '#82c25e'][Math.floor(r() * 4)] })), { cast: false }));
  // Flores: tallo y cabeza
  const stems = [], heads = [];
  for (const s of flowerSpots) {
    const h = 0.16 + r() * 0.1;
    stems.push({ p: [s.x, s.y + h / 2, s.z], s: [1, h, 1] });
    heads.push({ p: [s.x, s.y + h, s.z], s: 0.055, c: s.c });
  }
  group.add(instanced(new THREE.CylinderGeometry(0.012, 0.012, 1, 4), mat({ color: '#4f8a38' }), stems, { cast: false }));
  group.add(instanced(new THREE.IcosahedronGeometry(1, 0), mat({ roughness: 0.6 }), heads, { cast: false }));
  return group;
}
