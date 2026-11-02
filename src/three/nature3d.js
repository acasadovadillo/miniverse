// Naturaleza en 3D: los árboles, arbustos, rocas, cactus, palmeras y matojos que el generador pone en cada
// trozo (y los árboles y arbolitos que planta el jugador), con los colores de la estación (flores en los
// frutales en primavera, hojas naranjas en otoño, nieve en invierno). Cada pieza (troncos, copas, conos…)
// es una malla instanciada por trozo; de cada objeto se recuerda qué instancias son suyas para hacerlo
// temblar cuando se golpea. También las matas de hierba, flores, setas, juncos y piedrecitas del suelo, y
// los árboles lejanos (más sencillos y sin sombra) para el horizonte.
import * as THREE from 'three';
import { mat } from './geo.js';
import { bark } from './textures.js';
import { ihash, vnoise } from '../util.js';

const tmp = new THREE.Object3D(), col = new THREE.Color();
// Viento: el tiempo que mueve la hierba y las copas (lo avanza el dibujo)
export const WIND = { value: 0 };
function sway(material, amount, speed = 1) {
  material.onBeforeCompile = sh => {
    sh.uniforms.windTime = WIND;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float windTime;').replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float t = windTime * ${speed.toFixed(2)};
      float s = sin(t * 1.6 + wp.x * 0.35 + wp.z * 0.25) * 0.6 + sin(t * 2.9 + wp.x * 0.9 - wp.z * 0.4) * 0.3;
      transformed.xz += vec2(s, s * 0.5) * ${amount.toFixed(3)} * max(position.y, 0.0);`);
  };
  material.customProgramCacheKey = () => `sway${amount}:${speed}`;
  return material;
}

// Geometrías y materiales compartidos
const GEO = {
  trunk: new THREE.CylinderGeometry(0.13, 0.2, 1, 7), lump: new THREE.IcosahedronGeometry(1, 1), cone: new THREE.ConeGeometry(1, 1.4, 8),
  ball: new THREE.SphereGeometry(1, 8, 6), gem: new THREE.IcosahedronGeometry(1, 0), rock: new THREE.DodecahedronGeometry(1, 0),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 8), frond: (() => { const g = new THREE.ConeGeometry(0.18, 1.3, 4, 1, true); g.translate(0, 0.65, 0); g.rotateX(Math.PI / 2); g.scale(1, 0.25, 1); return g; })(),
  twig: new THREE.CylinderGeometry(0.02, 0.03, 1, 4),
};
let MATS;
const mats = () => (MATS ||= {
  bark: (() => { const t = bark(); t.repeat.set(2, 1); return mat({ map: t }); })(),
  leaf: sway(mat({ flatShading: true, roughness: 0.95 }), 0.035, 0.7),
  solid: mat({ roughness: 0.6 }), rock: mat({ flatShading: true, roughness: 0.9 }), cactus: mat({ color: '#4f9a4a', roughness: 0.7, flatShading: true }),
  palmTrunk: mat({ color: '#a8885a', roughness: 0.9 }), frond: sway(mat({ color: '#4fa040', side: THREE.DoubleSide, flatShading: true }), 0.05, 1.2), dry: mat({ color: '#8a6a40', roughness: 1 }),
  snow: mat({ color: '#f4f8fc', roughness: 0.85 }),
});
// Colores de las hojas según la estación (0 primavera … 3 invierno)
const LEAF = [['#5aa642', '#62ad48', '#4f9a3a', '#6cb850'], ['#468c34', '#4f9a3a', '#3f8030', '#56a03e'], ['#d8782e', '#e8a838', '#c44c2c', '#d89a3a'], ['#8a9a8a', '#9aa69a', '#7e8c80', '#a8b2a8']];
const SWAMP = [['#5a7a3a', '#64843e'], ['#4e6e34', '#587838'], ['#8a6a2e', '#a07a34'], ['#7e8678', '#8a9286']];
const PINE = ['#2f6a3c', '#357444', '#2a5e36', '#3c7c48'];
const BLOSSOM = ['#ffb8d0', '#ffd0e0', '#ffffff'];

// Instancias de una pieza: list = [{ p, s, r, c }]
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
  m.computeBoundingSphere();
  return m;
}

// Piezas de un objeto de la naturaleza, en el sitio (x, z) con el suelo a altura y. Devuelve las piezas por
// tipo en `out` ({ trunk: [], lump: [], … }), apuntando de quién es cada una (owner) para poder sacudirlo.
// Una rama: un tronco fino que va del punto a al b
const UP = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), turn = new THREE.Quaternion(), euler = new THREE.Euler();
function branch(push, a, b, w) {
  dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = dir.length();
  euler.setFromQuaternion(turn.setFromUnitVectors(UP, dir.normalize()));
  push('trunk', { p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], s: [w, len, w], r: [euler.x, euler.y, euler.z] });
}

function pieces(o, season, out, owner, y = 0) {
  const x = o.x, z = o.y, h = ihash(Math.floor(x * 7), Math.floor(z * 7), 11), r = (k) => ihash(Math.floor(x * 13) + k, Math.floor(z * 13), 31 + k);
  const k = 0.85 + h * 0.35, rot = r(1) * Math.PI * 2, push = (type, it) => { it.owner = owner; (out[type] ||= []).push(it); };
  const kind = o.kind;
  if (kind === 'oak' || kind === 'fruit' || kind === 'swampTree') {
    const tall = kind === 'swampTree' ? 1.25 : 1, th = 1.5 * k * tall;
    const pal = kind === 'swampTree' ? SWAMP[season] : kind === 'fruit' && season < 2 ? ['#62ad48', '#6cb850', '#58a040'] : LEAF[season];
    const cy = y + th + 1.0 * k, n = 4 + Math.floor(r(2) * 2), droop = kind === 'swampTree' ? 0.35 : 0;
    // El tronco sube hasta dentro de la copa (si no, desde abajo se vería un hueco y las hojas flotarían)
    const top = cy - y - 0.1 * k;
    push('trunk', { p: [x, y + top / 2, z], s: [k, top, k], r: [0, rot, 0] });
    push('lump', { p: [x, cy + 0.25 * k - droop, z], s: [1.05 * k, (1.05 - droop * 0.6) * k, 1.05 * k], r: [r(3), r(4), r(5)], c: pal[Math.floor(r(6) * pal.length)] });
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2, d = (0.55 + droop * 0.3) * k, ly = cy - 0.15 * k + r(10 + i) * 0.3 - droop;
      push('lump', { p: [x + Math.cos(a) * d, ly, z + Math.sin(a) * d], s: (0.65 + r(20 + i) * 0.2) * k, r: [r(30 + i), r(40 + i), 0], c: pal[Math.floor(r(50 + i) * pal.length)] });
      // Ramas del tronco a las matas de abajo, que se ven al mirar la copa desde el suelo
      if (i < 3) branch(push, [x, y + th * 0.82, z], [x + Math.cos(a) * d * 0.85, ly - 0.2 * k, z + Math.sin(a) * d * 0.85], 0.42 * k);
    }
    // Sauce del pantano: ramas colgando
    if (kind === 'swampTree') for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + rot, d = 1.0 * k; push('frond', { p: [x + Math.cos(a) * d, cy - 0.2, z + Math.sin(a) * d], s: [0.8, 1, 1.2], r: [-1.35, -a + Math.PI / 2, 0] }); }
    // Frutales: manzanas en verano y otoño, flores en primavera
    if (kind === 'fruit' && season < 3) for (let i = 0; i < (season === 0 ? 14 : 9); i++) {
      const a = r(60 + i) * Math.PI * 2, e = r(70 + i) * 0.9 - 0.2, d = 1.05 * k;
      push(season === 0 ? 'bloom' : 'apple', { p: [x + Math.cos(a) * Math.cos(e) * d, cy + Math.sin(e) * d * 0.8, z + Math.sin(a) * Math.cos(e) * d], s: season === 0 ? 0.09 : 0.12, c: season === 0 ? BLOSSOM[i % 3] : '#d8352a' });
    }
    if (season === 3) push('snow', { p: [x, cy + 0.6 * k, z], s: [0.85 * k, 0.4 * k, 0.85 * k], r: [r(3), 0, 0] });
  } else if (kind === 'pine' || kind === 'snowPine') {
    const th = 0.9 * k;
    push('trunk', { p: [x, y + th / 2, z], s: [0.75 * k, th, 0.75 * k], r: [0, rot, 0] });
    const snowy = kind === 'snowPine' || season === 3;
    for (let i = 0; i < 3; i++) {
      const cy = y + th + 0.55 * k + i * 0.75 * k, w = (1.25 - i * 0.3) * k;
      push('cone', { p: [x, cy, z], s: [w, 1.1 * k, w], r: [0, rot + i, 0], c: PINE[Math.floor(r(80 + i) * PINE.length)] });
      if (snowy) push('snowCone', { p: [x, cy + 0.32 * k, z], s: [w * 0.72, 0.55 * k, w * 0.72], r: [0, rot + i, 0] });
    }
  } else if (kind === 'palm') {
    // Tronco curvado (cinco tramos) y penachos de hojas, con cocos
    let px = x, py = y, pz = z;
    const lean = rot, segs = 5;
    for (let i = 0; i < segs; i++) {
      const len = 0.75 * k, tilt = 0.12 + i * 0.07, nx = px + Math.cos(lean) * Math.sin(tilt) * len, nz = pz + Math.sin(lean) * Math.sin(tilt) * len, ny = py + Math.cos(tilt) * len;
      push('palm', { p: [(px + nx) / 2, (py + ny) / 2, (pz + nz) / 2], s: [0.16 - i * 0.015, len + 0.05, 0.16 - i * 0.015], r: [Math.sin(lean) * tilt, 0, -Math.cos(lean) * tilt] });
      px = nx; py = ny; pz = nz;
    }
    for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2 + rot; push('frond', { p: [px, py, pz], s: [1.2, 1, 1.4 * k], r: [-0.35 - (i % 2) * 0.25, -a + Math.PI / 2, 0] }); }
    for (let i = 0; i < 3; i++) { const a = rot + i * 2.1; push('coconut', { p: [px + Math.cos(a) * 0.15, py - 0.15, pz + Math.sin(a) * 0.15], s: 0.11, c: '#6a4a2a' }); }
  } else if (kind === 'cactus') {
    const th = 1.5 * k;
    push('cactus', { p: [x, y + th / 2, z], s: [0.2, th, 0.2] });
    push('cactusTop', { p: [x, y + th, z], s: 0.2 });
    for (const [s, hgt] of [[1, 0.7], [-1, 0.95]]) {
      if (r(90 + s) < 0.25) continue;
      const ax = x + Math.cos(rot) * 0.32 * s, az = z + Math.sin(rot) * 0.32 * s;
      push('cactus', { p: [(x + ax) / 2, y + hgt * k, (z + az) / 2], s: [0.12, 0.34, 0.12], r: [Math.sin(rot) * 1.57 * s, 0, -Math.cos(rot) * 1.57 * s] });
      push('cactus', { p: [ax, y + hgt * k + 0.3, az], s: [0.13, 0.6, 0.13] });
      push('cactusTop', { p: [ax, y + hgt * k + 0.6, az], s: 0.13 });
    }
    if (season === 0) push('bloom', { p: [x, y + th + 0.18, z], s: 0.09, c: '#ff6a9a' });
  } else if (kind === 'bush') {
    const n = 3 + Math.floor(r(2) * 2), pal = LEAF[season];
    for (let i = 0; i < n; i++) { const a = rot + (i / n) * Math.PI * 2, d = 0.22; push('lump', { p: [x + Math.cos(a) * d, y + 0.3 + r(10 + i) * 0.1, z + Math.sin(a) * d], s: 0.32 + r(20 + i) * 0.1, r: [r(30 + i), r(40 + i), 0], c: pal[Math.floor(r(50 + i) * pal.length)] }); }
    if (season === 1 && h < 0.5) for (let i = 0; i < 7; i++) { const a = r(60 + i) * 6.28, d = 0.28 + r(70 + i) * 0.1; push('apple', { p: [x + Math.cos(a) * d, y + 0.42 + r(80 + i) * 0.18, z + Math.sin(a) * d], s: 0.045, c: '#3a3aa8' }); }
    if (season === 0 && h > 0.5) for (let i = 0; i < 8; i++) { const a = r(60 + i) * 6.28, d = 0.28 + r(70 + i) * 0.12; push('bloom', { p: [x + Math.cos(a) * d, y + 0.45 + r(80 + i) * 0.2, z + Math.sin(a) * d], s: 0.06, c: ['#ff7aa8', '#ffe04a', '#ffffff', '#b48aff'][i % 4] }); }
    if (season === 3) push('snow', { p: [x, y + 0.55, z], s: [0.4, 0.18, 0.4] });
  } else if (kind === 'deadBush') {
    for (let i = 0; i < 6; i++) { const a = rot + i * 1.05, t = 0.5 + r(i) * 0.4; push('twig', { p: [x + Math.cos(a) * 0.12, y + 0.22, z + Math.sin(a) * 0.12], s: [1, 0.5 + r(10 + i) * 0.2, 1], r: [Math.sin(a) * t, 0, -Math.cos(a) * t] }); }
  } else if (kind === 'rock' || kind === 'boulder' || kind === 'snowBoulder') {
    const big = kind !== 'rock', s = big ? 0.72 + h * 0.15 : 0.28 + h * 0.12;
    push('rock', { p: [x, y + s * 0.35, z], s: [s * (1 + r(1) * 0.3), s * 0.72, s], r: [0, rot, 0], c: ['#9a958c', '#8c877e', '#a8a39a'][Math.floor(r(2) * 3)] });
    if (big) push('rock', { p: [x + Math.cos(rot) * s * 0.55, y + s * 0.25, z + Math.sin(rot) * s * 0.55], s: [s * 0.55, s * 0.5, s * 0.5], r: [0, rot * 2, 0], c: '#8e8a82' });
    // Los peñascos dejan ver vetas de mineral
    if (big) for (let i = 0; i < 4; i++) { const a = rot + i * 1.6, e = 0.2 + r(5 + i) * 0.5; push('gem', { p: [x + Math.cos(a) * s * 0.85, y + s * (0.35 + e * 0.3), z + Math.sin(a) * s * 0.8], s: 0.07, r: [r(i), r(i + 1), 0], c: ['#d8844a', '#b8c2ce', '#f0c840', '#d8844a'][i] }); }
    if (kind === 'snowBoulder' || (season === 3 && big)) push('snow', { p: [x, y + s * 0.62, z], s: [s * 0.9, s * 0.28, s * 0.85], r: [0, rot, 0] });
  } else if (kind === 'sapling') {
    const tree = o.tree || 'oak';
    push('twig', { p: [x, y + 0.25, z], s: [1.2, 0.5, 1.2] });
    if (tree === 'pine') push('cone', { p: [x, y + 0.55, z], s: [0.22, 0.32, 0.22], c: PINE[0] });
    else for (let i = 0; i < 3; i++) push('lump', { p: [x + (i - 1) * 0.08, y + 0.5 + (i % 2) * 0.08, z], s: 0.12, c: LEAF[season === 3 ? 1 : season][i] });
  }
}

// Mallas de un trozo a partir de sus objetos de la naturaleza. shadows: si dan sombra (lo cercano)
export function buildNatureChunk(objs, season, groundY, shadows = true) {
  const M = mats(), out = {}, owners = new Map(), group = new THREE.Group();
  for (const o of objs) { const owner = o.key; pieces(o, season, out, owner, groundY(o.x, o.y)); }
  const spec = {
    trunk: [GEO.trunk, M.bark], lump: [GEO.lump, M.leaf], cone: [GEO.cone, M.leaf], snowCone: [GEO.cone, M.snow], snow: [GEO.lump, M.snow],
    apple: [GEO.ball, M.solid], bloom: [GEO.gem, M.solid], coconut: [GEO.ball, M.solid], gem: [GEO.gem, M.solid], rock: [GEO.rock, M.rock],
    palm: [GEO.cyl, M.palmTrunk], frond: [GEO.frond, M.frond], cactus: [GEO.cyl, M.cactus], cactusTop: [GEO.ball, M.cactus], twig: [GEO.twig, M.dry],
  };
  for (const [type, list] of Object.entries(out)) {
    const [geo, m] = spec[type];
    const small = type === 'bloom' || type === 'apple' || type === 'gem' || type === 'coconut';
    const im = instanced(geo, m, list, { cast: shadows && !small });
    im.userData.cast = !small;
    im.userData.base = list.map((it, i) => { const mm = new THREE.Matrix4(); im.getMatrixAt(i, mm); return mm; });
    list.forEach((it, i) => { if (!owners.has(it.owner)) owners.set(it.owner, []); owners.get(it.owner).push([im, i]); });
    group.add(im);
  }
  return { group, owners };
}
// Sacude lo que se está golpeando (un poco de lado a lado) y deja quieto lo demás
const shakeM = new THREE.Matrix4();
export function shake(chunk, key, amount) {
  for (const [im, i] of chunk.owners.get(key) || []) {
    const base = im.userData.base[i];
    if (!amount) im.setMatrixAt(i, base);
    else { shakeM.makeTranslation(amount, 0, amount * 0.5).multiply(base); im.setMatrixAt(i, shakeM); }
    im.instanceMatrix.needsUpdate = true;
  }
}

// Matas, flores, setas, juncos, conchas y piedrecitas del suelo de unos trozos (de cx0, cy0, n × n), según el
// bioma de cada casilla, todo en una sola malla con colores por vértice (y cuánto se mece cada vértice).
// free(x, y): si ahí puede haber algo (hierba sin construir ni labrar)
const B_ = { BEACH: 2, MEADOW: 3, FOREST: 4, PINES: 5, SWAMP: 6, DESERT: 7, SNOW: 8, ROCKY: 9 };
let GROUND;
// (se hace por pasos, un trozo cada vez: yield entre trozo y trozo; al acabar devuelve la malla)
export function* buildGround(cx0, cy0, n, CHUNK, gen, season, free, groundY) {
  const s = gen.seed, out = { pos: [], col: [], sway: [] };
  const FLOWERS = ['#ffffff', '#ffe04a', '#ff7aa8', '#b48aff', '#ff6a4a', '#7ac8ff'];
  const GRASS = [['#6aae4a', '#76b854', '#62a444'], ['#5e9e40', '#68a848', '#56963a'], ['#a8963e', '#b8a048', '#98883a'], ['#c8d4d0', '#d8e0dc', '#b8c6c2']][season];
  const A = (GROUND ||= groundShapes());
  for (let cj = 0; cj < n; cj++) for (let ci = 0; ci < n; ci++, yield) for (let ty = (cy0 + cj) * CHUNK; ty < (cy0 + cj + 1) * CHUNK; ty++) for (let tx = (cx0 + ci) * CHUNK; tx < (cx0 + ci + 1) * CHUNK; tx++) {
    const b = gen.biomeAt(tx + 0.5, ty + 0.5), lush = b === B_.MEADOW || b === B_.FOREST || b === B_.PINES || b === B_.SWAMP;
    for (let k = 0; k < 1; k++) {
      const x = tx + ihash(tx, ty, s + 20 + k), y = ty + ihash(tx, ty, s + 30 + k), roll = ihash(tx, ty, s + 10 + k);
      if (!free(x, y)) continue;
      const gy = groundY(x, y);
      if (gy < -0.05) continue;
      if (lush && roll < (season === 3 ? 0.08 : b === B_.MEADOW ? 0.9 : 0.7)) put(out, A.blade, x, gy, y, roll * 9, 1.0 + ihash(tx, ty, s + 40 + k) * 0.7, GRASS[Math.floor(roll * 30) % 3], true);
      else if (b === B_.SWAMP && roll < 0.9) put(out, A.reed, x, gy, y, roll * 9, 0.6 + roll * 0.5, '#5a8a3a', true);
      else if (b === B_.DESERT && roll < 0.08) put(out, A.blade, x, gy, y, roll * 9, 0.7, '#b8955a', true);
      else if (b === B_.BEACH && roll < 0.04) put(out, A.pebble, x, gy, y, roll * 9, 0.5, k ? '#ffd8e0' : '#ffffff');
      else if (b === B_.ROCKY && roll < 0.3) put(out, A.pebble, x, gy, y, roll * 9, 0.8 + roll, '#8a867e');
      else if (b === B_.SNOW && roll < 0.05) put(out, A.pebble, x, gy, y, roll * 9, 1.2, '#ffffff');
    }
    if (season === 3) continue;
    if (b === B_.MEADOW && vnoise(tx * 0.25, ty * 0.25, s + 7) > 0.66 && ihash(tx, ty, s + 40) < (season === 0 ? 0.9 : season === 2 ? 0.35 : 0.7)) {
      for (let k = 0; k < (season === 0 ? 2 : 1); k++) {
        const x = tx + ihash(tx, ty, s + 41 + k), y = ty + ihash(tx, ty, s + 42 + k);
        if (!free(x, y)) continue;
        const h = 0.8 + ihash(tx, ty, s + 43 + k) * 0.6, gy = groundY(x, y);
        put(out, A.stem, x, gy, y, k, h, '#4f8a38', true);
        put(out, A.head, x, gy + 0.2 * h, y, k * 2, 1, FLOWERS[Math.floor(vnoise(tx * 0.2 + k, ty * 0.2, s + 8) * FLOWERS.length) % FLOWERS.length], true, 0.2 * h);
      }
    } else if (b === B_.FOREST && ihash(tx, ty, s + 43) < 0.05) {
      const x = tx + 0.5, y = ty + 0.5;
      if (free(x, y)) { const gy = groundY(x, y); put(out, A.shroomStem, x, gy, y, 0, 1, '#f2ecd8'); put(out, A.shroomCap, x, gy, y, 0, 1, '#c83a2a'); }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(out.col, 3));
  geo.setAttribute('sway', new THREE.Float32BufferAttribute(out.sway, 1));
  // (todas hacia arriba: la hierba se ilumina como el suelo, sin brillos raros en las hojas finas)
  const nor = new Float32Array(out.pos.length); for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, A.mat);
  mesh.receiveShadow = true;
  mesh.userData.own = true;
  return mesh;
}
// Copia una forma (posiciones sin índices) girada, escalada y movida, con su color; bends: si se mece con el
// viento (más cuanto más alta); lift: altura que ya tiene al ponerla (para la cabeza de las flores)
const _c = new THREE.Color();
function put(out, shape, x, y, z, rot, s, color, bends = false, lift = 0) {
  const c = Math.cos(rot), sn = Math.sin(rot), p = shape.pos, sh = shape.shade;
  _c.set(color);
  for (let i = 0; i < p.length; i += 3) {
    const px = p[i] * s, py = p[i + 1] * s, pz = p[i + 2] * s;
    out.pos.push(x + px * c + pz * sn, y + py, z - px * sn + pz * c);
    const k = sh ? sh[i / 3] : 1;
    out.col.push(_c.r * k, _c.g * k, _c.b * k);
    out.sway.push(bends ? (py + lift) : 0);
  }
}
function groundShapes() {
  const flat = g => { const n = g.index ? g.toNonIndexed() : g; return Array.from(n.attributes.position.array); };
  // Una mata: tres hojas finas cruzadas, más oscuras abajo (cada hoja, con sus dos caras: así las dos se
  // iluminan como el suelo, con la normal hacia arriba)
  const blade = [], shade = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI, w = 0.045, h = 0.17 + (i % 2) * 0.06, dx = Math.cos(a) * w, dz = Math.sin(a) * w, lean = 0.04 * (i - 1);
    blade.push(-dx, 0, -dz, dx, 0, dz, lean, h, lean, dx, 0, dz, -dx, 0, -dz, lean, h, lean);
    shade.push(0.72, 0.72, 1.12, 0.72, 0.72, 1.12);
  }
  const reed = flat(new THREE.CylinderGeometry(0.008, 0.014, 1, 3).translate(0, 0.5, 0));
  const stem = flat(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 3).translate(0, 0.1, 0));
  const head = flat(new THREE.OctahedronGeometry(0.05, 0));
  const pebble = flat(new THREE.OctahedronGeometry(0.07, 0).scale(1, 0.5, 0.8));
  const shroomStem = flat(new THREE.CylinderGeometry(0.025, 0.03, 0.1, 5).translate(0, 0.05, 0));
  const shroomCap = flat(new THREE.SphereGeometry(0.08, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.09, 0));
  const m = mat({ vertexColors: true, roughness: 0.95 });
  m.onBeforeCompile = sh => {
    sh.uniforms.windTime = WIND;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float windTime;\nattribute float sway;').replace('#include <begin_vertex>', `#include <begin_vertex>
      float s = sin(windTime * 1.6 + position.x * 0.35 + position.z * 0.25) * 0.6 + sin(windTime * 2.9 + position.x * 0.9 - position.z * 0.4) * 0.3;
      transformed.xz += vec2(s, s * 0.5) * 0.3 * sway;`);
  };
  m.customProgramCacheKey = () => 'groundcover';
  return { blade: { pos: blade, shade }, reed: { pos: reed }, stem: { pos: stem }, head: { pos: head }, pebble: { pos: pebble }, shroomStem: { pos: shroomStem }, shroomCap: { pos: shroomCap }, mat: m };
}
// Junta geometrías sin índices pintando cada una de un color (multiplica el de la instancia)
export function mergeColored(list) {
  const pos = [], nor = [], c = [];
  for (const [g, rgb] of list) {
    pos.push(...g.attributes.position.array);
    if (!g.attributes.normal) g.computeVertexNormals();
    nor.push(...g.attributes.normal.array);
    for (let i = 0; i < g.attributes.position.count; i++) c.push(...rgb);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  return out;
}

// Árboles y rocas lejanos de un bloque: un tronco y una o dos bolas (o dos conos), sin sombras
let FAR_MATS;
export function buildFarNature(objs, season, groundY) {
  const M = (FAR_MATS ||= { bark: mats().bark.clone(), leaf: mat({ flatShading: true, roughness: 0.95 }), rock: mats().rock.clone(), snow: mats().snow.clone() }), trunks = [], lumps = [], cones = [], rocks = [], snow = [];
  for (const o of objs) {
    const x = o.x, z = o.y, y = groundY(x, z), h = ihash(Math.floor(x * 7), Math.floor(z * 7), 11), s = 0.85 + h * 0.35, rot = h * 6.28;
    if (o.kind === 'oak' || o.kind === 'fruit' || o.kind === 'swampTree') {
      const pal = o.kind === 'swampTree' ? SWAMP[season] : LEAF[season];
      trunks.push({ p: [x, y + 0.95 * s, z], s: [s, 1.9 * s, s] });
      lumps.push({ p: [x, y + 2.6 * s, z], s: 1.15 * s, r: [h, h * 2, 0], c: pal[Math.floor(h * pal.length)] });
      lumps.push({ p: [x + Math.cos(rot) * 0.5 * s, y + 2.2 * s, z + Math.sin(rot) * 0.5 * s], s: 0.8 * s, c: pal[(Math.floor(h * 9)) % pal.length] });
    } else if (o.kind === 'pine' || o.kind === 'snowPine') {
      trunks.push({ p: [x, y + 0.45 * s, z], s: [0.75 * s, 0.9 * s, 0.75 * s] });
      for (let i = 0; i < 2; i++) cones.push({ p: [x, y + (1.5 + i * 1.0) * s, z], s: [(1.25 - i * 0.35) * s, 1.4 * s, (1.25 - i * 0.35) * s], r: [0, rot, 0], c: PINE[i] });
      if (o.kind === 'snowPine' || season === 3) snow.push({ p: [x, y + 2.9 * s, z], s: [0.5 * s, 0.6 * s, 0.5 * s] });
    } else if (o.kind === 'palm' || o.kind === 'cactus') {
      trunks.push({ p: [x, y + 1 * s, z], s: [0.8 * s, 2 * s, 0.8 * s] });
      lumps.push({ p: [x, y + 2.2 * s, z], s: [0.8 * s, 0.3 * s, 0.8 * s], c: o.kind === 'palm' ? '#4fa040' : '#4f9a4a' });
    } else if (o.kind === 'boulder' || o.kind === 'snowBoulder') rocks.push({ p: [x, y + 0.25, z], s: [0.9 * s, 0.55 * s, 0.75 * s], r: [0, rot, 0], c: '#9a958c' });
  }
  const group = new THREE.Group();
  for (const [geo, m, list] of [[GEO.trunk, M.bark, trunks], [GEO.lump, M.leaf, lumps], [GEO.cone, M.leaf, cones], [GEO.rock, M.rock, rocks], [GEO.cone, M.snow, snow]]) if (list.length) group.add(instanced(geo, m, list, { cast: false, receive: false }));
  return group;
}
