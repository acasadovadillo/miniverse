// Naturaleza en 3D: los árboles, arbustos, rocas, cactus, palmeras y matojos que el generador pone en cada
// trozo (y los árboles y arbolitos que planta el jugador), con los colores de la estación (flores en los
// frutales en primavera, hojas naranjas en otoño, nieve en invierno). Cada pieza (troncos, copas, conos…)
// es una malla instanciada por trozo; de cada objeto se recuerda qué instancias son suyas para hacerlo
// temblar cuando se golpea. También las matas de hierba, flores, setas, juncos y piedrecitas del suelo, y
// los árboles lejanos (más sencillos y sin sombra) para el horizonte.
import * as THREE from 'three';
import { mat, rockGeo, snowCap } from './geo.js';
import { bark, rockFace } from './textures.js';
import { ihash, vnoise } from '../util.js';
import { tonos } from '../arte.js';
import { FLOWER_GEO, FLOWER_COLORS } from './flowers3d.js';

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
  twig: new THREE.CylinderGeometry(0.02, 0.03, 1, 4),
  // Un piso de pino: un cono abierto con el borde en estrella y caído en las puntas
  tier: (() => {
    const g = new THREE.ConeGeometry(1, 1, 14, 3, true), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), t = (0.5 - y), a = Math.atan2(p.getZ(i), p.getX(i)), tip = Math.cos(a * 7) > 0 ? 1 : 0.6, fz = 1 + (Math.sin(a * 11 + y * 7) * 0.5) * 0.12 * t, ring = (t > 0.99 ? tip : 1 - 0.08 * t * Math.cos(a * 5)) * fz;
      p.setXYZ(i, p.getX(i) * ring, y - (t > 0.99 && tip === 1 ? 0.3 : 0) - 0.08 * Math.sin(a * 3) * t, p.getZ(i) * ring);
    }
    g.computeVertexNormals(); return g;
  })(),
  // Una tarjeta de hojas (de cara a +z)
  card: new THREE.PlaneGeometry(1, 1),
  palmSeg: new THREE.CylinderGeometry(0.94, 1.04, 1, 9),   // un tramo de palmera, más ancho abajo (los anillos)
  frond2: frondGeo(),
  rib: (() => { const g = new THREE.CylinderGeometry(1, 1, 1, 24, 1), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)), f = 1 + 0.1 * Math.cos(a * 10); p.setX(i, p.getX(i) * f); p.setZ(i, p.getZ(i) * f); } g.computeVertexNormals(); return g; })(),
  ribTop: (() => { const g = new THREE.SphereGeometry(1, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)), f = 1 + 0.1 * Math.cos(a * 10); p.setX(i, p.getX(i) * f); p.setZ(i, p.getZ(i) * f); } g.computeVertexNormals(); return g; })(),
  rock0: rockGeo(1), rock1: rockGeo(2), rock2: rockGeo(3),
};
// Una hoja de palmera: el nervio, que se arquea hacia abajo, con sus foliolos largos a los dos lados (a lo largo de +z)
function frondGeo() {
  const pos = [], N = 14, rib = z => [0, 0.32 * z - 0.62 * z * z, z];
  for (let i = 0; i < N; i++) {
    const z0 = (i + 0.5) / N, w = 0.26 * Math.sin(Math.PI * Math.min(1, z0 * 1.1)) ** 0.6 + 0.03, a = rib(z0), b = rib(z0 + 0.7 / N);
    for (const sd of [-1, 1]) { const t = [sd * w, a[1] - 0.1 * w - 0.05, a[2] + w * 0.55]; pos.push(...a, ...b, ...t); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  return g;
}
// Las tarjetas de hojas se ven por las dos caras con la luz de la de fuera (si no, las de espaldas salen negras)
function oneSided(m) {
  const before = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => { before?.(sh, r); sh.fragmentShader = sh.fragmentShader.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;'); };
  const key = m.customProgramCacheKey; m.customProgramCacheKey = () => key() + ':una';
  return m;
}
// Los atlas de hojas, en gris claro sobre transparente (el color va por tarjeta): 'roble', un manojo de hojas
// anchas con sus ramitas; 'fina', muchas hojas menudas y apretadas (los arbustos); 'sauce', ramillas que cuelgan con
// hojas largas y estrechas a los dos lados (el sauce llorón)
function leafAtlas(kind = 'roble') {
  const W = 256, H = kind === 'sauce' ? 512 : 256, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); let seed = kind === 'fina' ? 11 : kind === 'sauce' ? 23 : 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const leaf = (px, py, ang, L, w, v) => {
    x.save(); x.translate(px, py); x.rotate(ang);
    x.fillStyle = `rgb(${v},${v},${v})`; x.beginPath(); x.ellipse(0, 0, L, w, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = 'rgba(0,0,0,0.22)'; x.lineWidth = 1; x.beginPath(); x.moveTo(-L, 0); x.lineTo(L * 0.9, 0); x.stroke();
    x.restore();
  };
  if (kind === 'sauce') {
    for (let i = 0; i < 15; i++) {
      let px = 12 + rnd() * (W - 24), py = 0; const len = H * (0.65 + rnd() * 0.35), bend = (rnd() - 0.5) * 0.6;
      x.strokeStyle = 'rgb(120,110,90)'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(px, py);
      const pts = [];
      for (let t = 0; t <= len; t += 6) { const q = t / len, nx = px + Math.sin(q * 2.2 + i) * 6 + bend * t * 0.15; pts.push([nx, t]); x.lineTo(nx, t); }
      x.stroke();
      pts.forEach(([qx, qy], j) => { if (j % 1 === 0 && j > 1) { const sd = j % 2 ? 1 : -1, ang = Math.PI / 2 + sd * (0.35 + rnd() * 0.35); leaf(qx + sd * 5, qy + 4, ang, 9 + rnd() * 6, 2.2 + rnd() * 1.2, 150 + Math.floor(rnd() * 100)); } });
    }
  } else {
    const fina = kind === 'fina', n = fina ? 260 : 90;
    x.strokeStyle = 'rgb(90,80,70)'; x.lineWidth = fina ? 1.2 : 2;
    for (let i = 0; i < (fina ? 9 : 5); i++) { x.beginPath(); x.moveTo(W / 2, H / 2); x.lineTo(W / 2 + (rnd() - 0.5) * W * 0.8, H / 2 + (rnd() - 0.5) * H * 0.8); x.stroke(); }
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * W * (fina ? 0.42 + 0.06 * Math.sin(a * 5) : 0.4), L = fina ? 6 + rnd() * 5 : 16 + rnd() * 14;
      leaf(W / 2 + Math.cos(a) * d, H / 2 + Math.sin(a) * d, rnd() * Math.PI * 2, L, L * (fina ? 0.55 : 0.42), (fina ? 130 : 150) + Math.floor(rnd() * (fina ? 125 : 105)));
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
let MATS;
const mats = () => (MATS ||= {
  bark: (() => { const t = bark(); t.repeat.set(2, 1); return mat({ map: t }); })(),
  leaf: sway(mat({ flatShading: true, roughness: 0.95 }), 0.035, 0.7),
  solid: mat({ roughness: 0.6 }), rock: mat({ flatShading: true, roughness: 0.9 }), cactus: mat({ color: '#56704c', roughness: 0.7, flatShading: true }),
  palmTrunk: mat({ color: '#8f7a5c', roughness: 0.9 }), dry: mat({ color: '#7f6a4c', roughness: 1 }),
  snow: mat({ color: '#dfe4e6', roughness: 0.85 }),
  card: oneSided(sway(mat({ map: leafAtlas(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 }), 0.035, 0.7)),
  cardS: oneSided(sway(mat({ map: leafAtlas('fina'), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 }), 0.03, 0.8)),
  cardW: oneSided(sway(mat({ map: leafAtlas('sauce'), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85 }), 0.06, 0.6)),
  tier: sway(mat({ roughness: 0.95, side: THREE.DoubleSide, shadowSide: THREE.BackSide, flatShading: true }), 0.02, 0.6),
  rock2: mat({ map: rockFace(), flatShading: true, roughness: 0.92 }),
  frond2: sway(mat({ color: '#ffffff', side: THREE.DoubleSide, shadowSide: THREE.DoubleSide, roughness: 0.85 }), 0.05, 1.2),
  cactus2: mat({ color: '#ffffff', roughness: 0.75 }), snowRock: snowCap({ flatShading: true }),
  petal: mat({ roughness: 0.8, side: THREE.DoubleSide }), puff: mat({ roughness: 1, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false }),
});
// Colores de las hojas según la estación (0 primavera … 3 invierno), de la paleta sobria (las flores y la fruta, vivas)
const LEAF = [tonos('#6f8050'), tonos('#59683f'), ['#94703a', '#a07c42', '#7f4e2e', '#8c6438'], tonos('#858c84')];
const SWAMP = [['#5d6a45', '#65724b'], ['#525f3d', '#5a6743'], ['#86683a', '#93733f'], ['#7a8076', '#868c82']];
const PINE = tonos('#3f5240');
const FRUIT_LEAF = tonos('#66784a').slice(0, 3);
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
const XV = new THREE.Vector3(1, 0, 0), UP = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), turn = new THREE.Quaternion(), euler = new THREE.Euler();
function branch(push, a, b, w) {
  dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = dir.length();
  euler.setFromQuaternion(turn.setFromUnitVectors(UP, dir.normalize()));
  push('trunk', { p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], s: [w, len, w], r: [euler.x, euler.y, euler.z] });
}

function pieces(o, season, out, owner, y = 0) {
  const x = o.x, z = o.y, h = ihash(Math.floor(x * 7), Math.floor(z * 7), 11), r = (k) => ihash(Math.floor(x * 13) + k, Math.floor(z * 13), 31 + k);
  const rot = r(1) * Math.PI * 2, push = (type, it) => { it.owner = owner; (out[type] ||= []).push(it); };
  const kind = o.kind;
  if (kind === 'swampTree') willow2(o, season, push, x, z, y, r, rot);
  else if (kind === 'oak' || kind === 'fruit') broadleaf2(o, season, push, x, z, y, r, rot);
  else if (kind === 'pine' || kind === 'snowPine') pine2(o, season, push, x, z, y, r, rot);
  else if (kind === 'palm') palm2(o, season, push, x, z, y, r, rot);
  else if (kind === 'cactus') cactus2(o, season, push, x, z, y, r, rot);
  else if (kind === 'margarita' || kind === 'diente_leon') flower2(o, season, push, x, z, y, r);
  else if (kind === 'bush') bush2(o, season, push, x, z, y, r, rot, h);
  else if (kind === 'rock' || kind === 'boulder' || kind === 'snowBoulder') rock2(o, season, push, x, z, y, r, rot, h);
  else if (kind === 'deadBush') {
    for (let i = 0; i < 6; i++) { const a = rot + i * 1.05, t = 0.5 + r(i) * 0.4; push('twig', { p: [x + Math.cos(a) * 0.12, y + 0.22, z + Math.sin(a) * 0.12], s: [1, 0.5 + r(10 + i) * 0.2, 1], r: [Math.sin(a) * t, 0, -Math.cos(a) * t] }); }
  } else if (kind === 'sapling') {
    const tree = o.tree || 'oak';
    push('twig', { p: [x, y + 0.25, z], s: [1.2, 0.5, 1.2] });
    if (tree === 'pine') push('cone', { p: [x, y + 0.55, z], s: [0.22, 0.32, 0.22], c: PINE[0] });
    else for (let i = 0; i < 3; i++) push('lump', { p: [x + (i - 1) * 0.08, y + 0.5 + (i % 2) * 0.08, z], s: 0.12, c: LEAF[season === 3 ? 1 : season][i] });
  }
}

// La edad del árbol, por su sitio (igual en todas las pantallas): 15 % maduro, 55 % medio, 30 % joven
const ageOf = (o) => o.age ?? (h => (h < 0.15 ? 1.25 : h < 0.7 ? 1 : 0.75))(ihash(Math.floor(o.x * 5), Math.floor(o.y * 5), 77));
// Las medidas de un árbol de hoja: altura, radio de la copa y altura de su centro (las usan el de cerca y el lejano)
function broadDims(o, y) {
  const k = (0.9 + ihash(Math.floor(o.x * 7), Math.floor(o.y * 7), 11) * 0.2) * ageOf(o), kind = o.kind;
  const H = (kind === 'fruit' ? 3.6 : kind === 'swampTree' ? 4.6 : 4.8) * k, R = (kind === 'fruit' ? 1.45 : kind === 'swampTree' ? 1.75 : 1.85) * k;
  return { k, H, R, Ry: R * 0.82, cy: y + H - R * 0.82, th: H * (kind === 'fruit' ? 0.3 : 0.36) };
}
const darker = (c, f) => col.set(c).multiplyScalar(f).getHex();
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), ZV = new THREE.Vector3(0, 0, 1), dv = new THREE.Vector3();
// Roble, frutal y sauce del pantano: tronco con su pie, ramas que se abren y una copa de varias matas, con un núcleo oscuro
// y tarjetas de hojas por fuera (en invierno, los de hoja caduca se quedan en ramas)
function broadleaf2(o, season, push, x, z, y, r, rot) {
  const kind = o.kind, swamp = kind === 'swampTree', fruit = kind === 'fruit', { k, R, Ry, cy, th } = broadDims(o, y);
  const bare = season === 3 && !swamp, pal = swamp ? SWAMP[season] : fruit && season < 2 ? FRUIT_LEAF : LEAF[season];
  push('trunk', { p: [x, y + 0.15, z], s: [2.3 * k, 0.3, 2.3 * k], r: [0, rot, 0] });   // el pie, más ancho
  // El tronco hasta donde se abren las ramas y, de ahí, la guía, más fina, hasta lo alto de la copa
  const fork = y + th + (cy - y - th) * 0.5;
  push('trunk', { p: [x, (y + fork) / 2, z], s: [1.55 * k, fork - y, 1.55 * k], r: [0, rot, 0] });
  branch(push, [x, fork - 0.05, z], [x + Math.cos(rot) * R * 0.1, cy + Ry * 0.55, z + Math.sin(rot) * R * 0.1], 1.05 * k);
  // Las ramas: 4 o 5 que salen del tronco y suben hacia la copa, con sus ramitas (más, sin hojas)
  const n = 4 + Math.floor(r(2) * 2), clumps = [[x, cy + Ry * 0.25, z, R * 0.62]];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2 + r(110 + i) * 0.5, d = R * (0.5 + r(120 + i) * 0.15), by = th + (cy - y - th) * r(130 + i) * 0.6;
    const end = [x + Math.cos(a) * d, cy + Ry * (r(140 + i) * 0.5 - 0.1), z + Math.sin(a) * d];
    branch(push, [x, y + by, z], end, 0.75 * k);
    clumps.push([...end, R * (0.45 + r(150 + i) * 0.12)]);
    for (let j = 0; j < (bare ? 3 : 2); j++) {
      const b = a + (j - 1) * 0.7 + r(160 + i * 3 + j) * 0.3, f = bare ? 0.38 : 0.22, e = [end[0] + Math.cos(b) * R * f, end[1] + R * (0.15 + r(170 + i * 3 + j) * 0.3) * f / 0.38, end[2] + Math.sin(b) * R * f];
      branch(push, end, e, 0.36 * k);
      if (bare) for (let m = 0; m < 2; m++) { const c = b + (m - 0.5) * 0.9; branch(push, e, [e[0] + Math.cos(c) * R * 0.22, e[1] + R * 0.2, e[2] + Math.sin(c) * R * 0.22], 0.16 * k); }
    }
  }
  if (bare) return;
  // La copa: el núcleo (oscuro, el que da sombra) y las tarjetas de hojas alrededor de cada mata
  for (const [cx, cY, cz, cr] of clumps) push('lump', { p: [cx, cY, cz], s: [cr * 0.5, cr * 0.45, cr * 0.5], r: [r(3), r(4), r(5)], c: darker(pal[0], 0.5) });
  const cards = Math.round((fruit ? 60 : 50) * ageOf(o) + 8);
  for (let i = 0; i < cards; i++) {
    const [cx, cY, cz, cr] = clumps[i % clumps.length], u = r(200 + i) * 1.5 - 0.5, f = r(300 + i) * Math.PI * 2, sq = Math.sqrt(1 - u * u);
    dv.set(sq * Math.cos(f), u, sq * Math.sin(f));
    const dist = cr * (0.5 + r(400 + i) * 0.45);
    qa.setFromUnitVectors(ZV, dv); qb.setFromAxisAngle(ZV, r(500 + i) * 6.28); qa.multiply(qb); euler.setFromQuaternion(qa);
    const sz = cr * (1.1 + r(600 + i) * 0.6);
    push('card', { p: [cx + dv.x * dist, cY + dv.y * dist * 0.85, cz + dv.z * dist], s: [sz, sz, sz], r: [euler.x, euler.y, euler.z], c: darker(pal[Math.floor(r(700 + i) * pal.length)], 0.85 + r(800 + i) * 0.3) });
  }
  // El sauce: cortinas de hojas que cuelgan del borde de la copa, de cara a fuera
  if (swamp) for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + rot + r(900 + i) * 0.3, d = R * (0.82 + r(910 + i) * 0.12), L = Ry * (0.7 + r(920 + i) * 0.4); push('card', { p: [x + Math.cos(a) * d, cy - Ry * 0.25 - L * 0.4, z + Math.sin(a) * d], s: [R * 0.55, L, 1], r: [0, Math.PI / 2 - a, 0], c: darker(pal[i % pal.length], 0.9) }); }
  if (fruit && season < 3 && !(o.bare && season > 0)) for (let i = 0; i < (season === 0 ? 16 : 10); i++) {
    const a = r(60 + i) * Math.PI * 2, e = r(70 + i) * 0.9 - 0.25, d = R * 0.95;
    push(season === 0 ? 'bloom' : 'apple', { p: [x + Math.cos(a) * Math.cos(e) * d, cy + Ry * 0.25 + Math.sin(e) * Ry, z + Math.sin(a) * Math.cos(e) * d], s: season === 0 ? 0.08 : 0.09, c: season === 0 ? BLOSSOM[i % 3] : '#b8382a' });
  }
  if (season === 3) push('snow', { p: [x, cy + Ry * 0.8, z], s: [R * 0.55, R * 0.12, R * 0.55] });
}
// Las medidas de un pino
function pineDims(o, y) { const k = (0.9 + ihash(Math.floor(o.x * 7), Math.floor(o.y * 7), 11) * 0.2) * ageOf(o); return { k, H: 5.6 * k, th: 0.8 * k }; }
// Pino: tronco recto hasta arriba y siete pisos de ramas que se estrechan, con las puntas caídas (y nieve encima)
function pine2(o, season, push, x, z, y, r, rot) {
  const { k, H, th } = pineDims(o, y), snowy = o.kind === 'snowPine' || season === 3, n = 11;
  push('trunk', { p: [x, y + H * 0.37, z], s: [1.15 * k, H * 0.74, 1.15 * k], r: [0, rot, 0] });
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), cy = y + th + (H - th - 0.5 * k) * t + 0.3 * k, w = (1.05 * (1 - t) ** 1.1 + 0.2) * k, h = (0.75 - t * 0.3) * k;
    push('tier', { p: [x, cy, z], s: [w, h, w], r: [(r(95 + i) - 0.5) * 0.15, rot + i * 0.9, (r(97 + i) - 0.5) * 0.15], c: darker(PINE[Math.floor(r(80 + i) * PINE.length)], 0.85 + r(90 + i) * 0.25) });
    if (snowy) push('snowTier', { p: [x, cy + h * 0.16, z], s: [w * 0.82, h * 0.72, w * 0.82], r: [0, rot + i * 0.9, 0] });
  }
}

// Palmera: el tronco curvo de ocho tramos anillados y, arriba, doce hojas largas arqueadas (las de dentro, más derechas),
// con cocos debajo (si no se acaban de coger)
function palmDims(o, y) { const k = (0.9 + ihash(Math.floor(o.x * 7), Math.floor(o.y * 7), 11) * 0.2) * ageOf(o); return { k, H: 4.6 * k }; }
function palm2(o, season, push, x, z, y, r, rot) {
  const { k, H } = palmDims(o, y), segs = 8, len = H / segs;
  let px = x, py = y, pz = z;
  for (let i = 0; i < segs; i++) {
    const tilt = 0.04 + i * 0.045, nx = px + Math.cos(rot) * Math.sin(tilt) * len, nz = pz + Math.sin(rot) * Math.sin(tilt) * len, ny = py + Math.cos(tilt) * len, w = (0.2 - i * 0.008) * Math.sqrt(k);
    push('palmSeg', { p: [(px + nx) / 2, (py + ny) / 2, (pz + nz) / 2], s: [w, len + 0.03, w], r: [Math.sin(rot) * tilt, 0, -Math.cos(rot) * tilt] });
    px = nx; py = ny; pz = nz;
  }
  push('palmSeg', { p: [px, py + 0.05, pz], s: [0.2 * Math.sqrt(k), 0.25, 0.2 * Math.sqrt(k)] });   // la cabeza, de donde salen las hojas
  const green = tonos('#5d7044');
  for (let i = 0; i < 12; i++) {
    const inner = i < 4, a = rot + (i / (inner ? 4 : 8)) * Math.PI * 2 + (inner ? 0.4 : 0) + r(210 + i) * 0.3, pitch = inner ? -0.55 + r(220 + i) * 0.2 : -0.15 + r(230 + i) * 0.35, L = (inner ? 1.6 : 2.3) * k * (0.9 + r(240 + i) * 0.2);
    qa.setFromAxisAngle(UP, a); qb.setFromAxisAngle(XV, pitch); qa.multiply(qb); euler.setFromQuaternion(qa);
    push('frond2', { p: [px, py + 0.1, pz], s: [L, L, L], r: [euler.x, euler.y, euler.z], c: darker(green[i % green.length], season === 2 ? 0.95 : 1 + r(250 + i) * 0.15) });
  }
  if (!o.bare) for (let i = 0; i < 4; i++) { const a = rot + i * 1.6; push('coconut', { p: [px + Math.cos(a) * 0.16, py - 0.12 - (i % 2) * 0.06, pz + Math.sin(a) * 0.16], s: 0.1, c: '#5a4228' }); }
}
// Cactus: un tronco acanalado con la punta redonda y uno o dos brazos que salen de lado y suben, del mismo grosor
function cactus2(o, season, push, x, z, y, r, rot) {
  const k = (0.9 + ihash(Math.floor(x * 7), Math.floor(z * 7), 11) * 0.2) * ageOf(o), th = 2.2 * k, w = 0.2 * Math.sqrt(k), c = tonos('#6a8058')[0];
  push('rib', { p: [x, y + th / 2, z], s: [w, th, w], r: [0, rot, 0], c });
  push('ribTop', { p: [x, y + th, z], s: [w, w * 0.8, w], r: [0, rot, 0], c });
  for (const sd of [1, -1]) {
    if (r(90 + sd) < 0.25) continue;
    const hy = y + th * (sd > 0 ? 0.38 : 0.5), out = 0.32 * k, up = th * (0.25 + r(95 + sd) * 0.15), aw = w * 0.75, cx = Math.cos(rot) * sd, cz = Math.sin(rot) * sd;
    push('rib', { p: [x + cx * out / 2, hy, z + cz * out / 2], s: [aw, out, aw], r: [Math.sin(rot) * 1.57 * sd, 0, -Math.cos(rot) * 1.57 * sd], c });
    push('cactusTop', { p: [x + cx * out, hy, z + cz * out], s: aw, c });   // el codo
    push('rib', { p: [x + cx * out, hy + up / 2, z + cz * out], s: [aw, up, aw], c });
    push('ribTop', { p: [x + cx * out, hy + up, z + cz * out], s: [aw, aw * 0.8, aw], c });
  }
  if (season === 0) for (let i = 0; i < 3; i++) push('bloom', { p: [x + (i - 1) * w * 0.5, y + th + w * 0.7, z], s: 0.07, c: ['#e8607a', '#f0d040', '#e8607a'][i] });
}
// Sauce llorón: tronco corto y grueso que se abre pronto en tres o cuatro brazos que suben y se arquean hacia fuera; la copa,
// una cúpula de ramillas colgantes, y alrededor, cortinas de ramillas que caen casi hasta el suelo (verde amarillento)
const WILLOW = [tonos('#7a8a46'), tonos('#6f7f40'), ['#a08a44', '#94803e'], tonos('#7a8070')];
function willow2(o, season, push, x, z, y, r, rot) {
  const { k, Ry, cy } = broadDims(o, y), R = 2.1 * k, pal = WILLOW[season], fork = y + 1.25 * k;
  push('trunk', { p: [x, y + 0.15, z], s: [2.7 * k, 0.3, 2.7 * k], r: [0, rot, 0] });
  push('trunk', { p: [x, (y + fork) / 2, z], s: [2.1 * k, fork - y, 2.1 * k], r: [0.06, rot, 0.04] });
  const n = 3 + Math.floor(r(2) * 2), heads = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2 + r(110 + i) * 0.6, mid = [x + Math.cos(a) * R * 0.45, cy + Ry * 0.35, z + Math.sin(a) * R * 0.45], end = [x + Math.cos(a) * R * 0.8, cy + Ry * 0.2, z + Math.sin(a) * R * 0.8];
    branch(push, [x, fork - 0.1, z], mid, 1.2 * k); branch(push, mid, end, 0.65 * k);
    heads.push(mid, end);
  }
  push('lump', { p: [x, cy - Ry * 0.05, z], s: [R * 0.42, Ry * 0.38, R * 0.42], c: darker(pal[0], 0.5) });   // (el núcleo: la sombra)
  // La cúpula: ramillas que cuelgan de lo alto, de cara a fuera
  const cards = Math.round(40 * ageOf(o) + 10), yaw = (dx, dz) => Math.atan2(dx, dz);
  for (let i = 0; i < cards; i++) {
    const u = 0.15 + r(200 + i) * 0.85, f = r(300 + i) * Math.PI * 2, ring = Math.sqrt(1 - u * u), d = R * (0.35 + 0.6 * ring) * (0.85 + r(400 + i) * 0.2);
    const px = x + Math.cos(f) * d, pz = z + Math.sin(f) * d, top = cy + Ry * (0.15 + 0.85 * Math.sqrt(Math.max(0, 1 - (d / R) ** 2))), h = Ry * (0.7 + r(600 + i) * 0.5), w = R * (0.32 + r(650 + i) * 0.15);
    push('cardW', { p: [px, top - h * 0.45, pz], s: [w, h, 1], r: [-0.15, yaw(Math.cos(f), Math.sin(f)) + (r(500 + i) - 0.5) * 0.6, 0], c: darker(pal[Math.floor(r(700 + i) * pal.length)], 0.95 + r(800 + i) * 0.3) });
  }
  // Las cortinas: por todo el borde, desde la copa hasta medio metro del suelo
  // (a distintas distancias, la de fuera más baja de arriba, como sigue la cúpula, y de largos distintos: unas casi hasta
  // el suelo y otras más cortas; abajo, algo abiertas hacia fuera)
  if (season !== 3) for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + rot + r(900 + i) * 0.3, q = 0.7 + r(910 + i) * 0.35, d = R * q, top = cy + Ry * (0.1 + 0.55 * Math.sqrt(Math.max(0, 1 - q * q * 0.8))), bottom = y + 0.4 + r(930 + i) * (r(935 + i) < 0.4 ? 1.4 : 0.5), L = top - bottom;
    push('cardW', { p: [x + Math.cos(a) * d, top - L / 2, z + Math.sin(a) * d], s: [R * (0.3 + r(940 + i) * 0.14), L, 1], r: [0.1, yaw(Math.cos(a), Math.sin(a)) + (r(950 + i) - 0.5) * 0.7, 0], c: darker(pal[i % pal.length], 0.9 + r(960 + i) * 0.25) });
  }
  if (season === 3) push('snow', { p: [x, cy + Ry * 0.9, z], s: [R * 0.45, R * 0.08, R * 0.45] });
}
// Arbusto: unas matas pequeñas con su núcleo y tarjetas de hojas, de algo más de un metro (con bayas en verano o flores en
// primavera, y nieve en invierno)
function bush2(o, season, push, x, z, y, r, rot, h) {
  // Un monte bajo de cinco matas (una en medio, más alta, y cuatro alrededor), con el núcleo oscuro, muchas hojas menudas
  // y unas ramitas al pie; con bayas en verano o flores en primavera, y nieve en invierno
  const k = 1.1 + h * 0.35, pal = LEAF[season], clumps = [[x, y + 0.5 * k, z, 0.4 * k]];
  for (let i = 0; i < 4; i++) { const a = rot + i * 1.57 + r(10 + i) * 0.5, d = (0.3 + r(15 + i) * 0.1) * k; clumps.push([x + Math.cos(a) * d, y + (0.28 + r(20 + i) * 0.14) * k, z + Math.sin(a) * d, (0.28 + r(25 + i) * 0.08) * k]); }
  for (const [cx, cY, cz, cr] of clumps) push('lump', { p: [cx, cY, cz], s: [cr * 0.45, cr * 0.38, cr * 0.45], r: [r(3), r(4), 0], c: darker(pal[0], 0.6) });
  for (let i = 0; i < 4; i++) { const a = rot + i * 1.6 + 0.4; push('twig', { p: [x + Math.cos(a) * 0.12 * k, y + 0.12, z + Math.sin(a) * 0.12 * k], s: [1.4, 0.3, 1.4], r: [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5] }); }
  for (let i = 0; i < 36; i++) {
    const [cx, cY, cz, cr] = clumps[i % clumps.length], u = r(200 + i) * 1.5 - 0.5, f = r(300 + i) * Math.PI * 2, sq = Math.sqrt(1 - u * u);
    dv.set(sq * Math.cos(f), u, sq * Math.sin(f)); qa.setFromUnitVectors(ZV, dv); qb.setFromAxisAngle(ZV, r(500 + i) * 6.28); qa.multiply(qb); euler.setFromQuaternion(qa);
    const dist = cr * (0.45 + r(400 + i) * 0.5), sz = cr * (0.95 + r(600 + i) * 0.45);
    push('cardS', { p: [cx + dv.x * dist, Math.max(y + 0.08, cY + dv.y * dist * 0.85), cz + dv.z * dist], s: [sz, sz, sz], r: [euler.x, euler.y, euler.z], c: darker(pal[Math.floor(r(700 + i) * pal.length)], 1.1 + r(800 + i) * 0.35) });
  }
  if (season === 1 && h < 0.5) for (let i = 0; i < 12; i++) { const a = r(60 + i) * 6.28, d = (0.3 + r(90 + i) * 0.1) * k; push('apple', { p: [x + Math.cos(a) * d, y + (0.3 + r(80 + i) * 0.45) * k, z + Math.sin(a) * d], s: 0.03, c: '#2e2e6a' }); }
  if (season === 0 && h > 0.5) for (let i = 0; i < 14; i++) { const a = r(60 + i) * 6.28, d = (0.32 + r(90 + i) * 0.1) * k; push('bloom', { p: [x + Math.cos(a) * d, y + (0.32 + r(80 + i) * 0.5) * k, z + Math.sin(a) * d], s: 0.04, c: ['#e87aa0', '#f0d84a', '#f4f0e8', '#a888e8'][i % 4] }); }
  if (season === 3) push('snow', { p: [x, y + 0.85 * k, z], s: [0.4 * k, 0.08, 0.4 * k] });
}
// Roca y peñasco: rocas de caras irregulares, medio enterradas, con la textura de la piedra; los peñascos, con otra al lado
// y las vetas de mineral asomando
const ROCK_C = ['#aca69c', '#a09a90', '#b4aea4'];
function rock2(o, season, push, x, z, y, r, rot, h) {
  const big = o.kind !== 'rock', s = big ? 0.8 + h * 0.2 : 0.3 + h * 0.14, v = 'rock' + Math.floor(r(7) * 3);
  push(v, { p: [x, y + s * 0.12, z], s: [s * (1.05 + r(1) * 0.35), s * (big ? 0.95 : 0.8), s * (0.95 + r(8) * 0.2)], r: [(r(9) - 0.5) * 0.2, rot, (r(10) - 0.5) * 0.2], c: ROCK_C[Math.floor(r(2) * 3)] });
  if (big) {
    push('rock' + ((Math.floor(r(7) * 3) + 1) % 3), { p: [x + Math.cos(rot) * s * 0.75, y + s * 0.05, z + Math.sin(rot) * s * 0.75], s: [s * 0.55, s * 0.5, s * 0.5], r: [0, rot * 2, 0], c: ROCK_C[(Math.floor(r(2) * 3) + 1) % 3] });
    for (let i = 0; i < 4; i++) { const a = rot + 0.8 + i * 1.6, e = r(5 + i) * 0.4; push('gem', { p: [x + Math.cos(a) * s * 0.95, y + s * (0.25 + e * 0.3), z + Math.sin(a) * s * 0.92], s: 0.085, r: [r(i), r(i + 1), 0], c: ['#d8844a', '#b8c2ce', '#f0c840', '#d8844a'][i] }); }
  }
  // (la nieve, pegada a la roca: la misma forma algo mayor, solo lo de arriba)
  if (o.kind === 'snowBoulder' || season === 3) push('snow' + v, { p: [x, y + s * 0.12 + 0.015, z], s: [s * (1.05 + r(1) * 0.35) * 1.04, s * (big ? 0.95 : 0.8) * 1.04, s * (0.95 + r(8) * 0.2) * 1.04], r: [(r(9) - 0.5) * 0.2, rot, (r(10) - 0.5) * 0.2] });
}

// Margarita y diente de león (flowers3d.js): una roseta de hojas tumbadas y de tres a cinco flores, cada una en su tallo
// algo inclinado, con la cabeza mirando hacia donde se inclina. En verano y otoño, parte de los dientes de león son ya
// vilanos (la bola blanca), y en otoño quedan menos flores. (En invierno no salen: gen.js, flowerShows)
const FLOWER_PART = new Set(['petals', 'disc', 'dandelion', 'dome', 'cup', 'puff', 'leafD', 'leafT', 'stem']);
const qf = new THREE.Quaternion(), ef = new THREE.Euler(), vf = new THREE.Vector3(), FLOWER_K = 1.7;   // (las cabezas, algo más grandes, para que se vean)
function flower2(o, season, push, x, z, y, r) {
  const daisy = o.kind === 'margarita', C = FLOWER_COLORS, n = (season === 2 ? 2 : 3) + Math.floor(r(1) * 3);
  for (let i = 0, nl = daisy ? 8 : 6; i < nl; i++) push(daisy ? 'leafD' : 'leafT', { p: [x, y + 0.003, z], s: (0.85 + r(20 + i) * 0.45) * 1.4, r: [0, r(2) * 6.28 + i * 2.4, 0.1 + r(30 + i) * 0.3], c: C[daisy ? 'leafD' : 'leafT'] });
  for (let i = 0; i < n; i++) {
    const a = r(40 + i) * 6.28, d = 0.02 + r(50 + i) * 0.14, bx = x + Math.cos(a) * d, bz = z + Math.sin(a) * d;
    const h = (daisy ? 0.2 : 0.22) + r(60 + i) * (daisy ? 0.12 : 0.16), la = r(70 + i) * 6.28, lean = 0.06 + r(80 + i) * 0.2, k = FLOWER_K;
    vf.set(Math.cos(la) * Math.sin(lean), Math.cos(lean), Math.sin(la) * Math.sin(lean));
    ef.setFromQuaternion(qf.setFromUnitVectors(UP, vf));
    const R = [ef.x, ef.y, ef.z], top = [bx + vf.x * h, y + vf.y * h, bz + vf.z * h];
    push('stem', { p: [bx + vf.x * h / 2, y + vf.y * h / 2, bz + vf.z * h / 2], s: [0.008, h, 0.008], r: R, c: C.stem });
    if (daisy) { push('petals', { p: top, s: k, r: R, c: C.petals }); push('disc', { p: top, s: k, r: R, c: C.disc }); continue; }
    push('cup', { p: top, s: k, r: R, c: C.cup });
    const puff = season > 0 && r(90 + i) < (season === 1 ? 0.35 : 0.7);
    push(puff ? 'puff' : 'dandelion', { p: puff ? [top[0], top[1] + 0.022 * k, top[2]] : top, s: k, r: R, c: C[puff ? 'puff' : 'dandelion'] });
    if (!puff) push('dome', { p: top, s: k, r: R, c: C.dome });
  }
}

const CARD_DEPTH = {};
// Mallas de un trozo a partir de sus objetos de la naturaleza. shadows: si dan sombra (lo cercano)
export function buildNatureChunk(objs, season, groundY, shadows = true) {
  const M = mats(), out = {}, owners = new Map(), group = new THREE.Group();
  for (const o of objs) { const owner = o.key; pieces(o, season, out, owner, groundY(o.x, o.y)); }
  const spec = {
    trunk: [GEO.trunk, M.bark], lump: [GEO.lump, M.leaf], cone: [GEO.cone, M.leaf], snow: [GEO.lump, M.snow],
    apple: [GEO.ball, M.solid], bloom: [GEO.gem, M.solid], coconut: [GEO.ball, M.solid], gem: [GEO.gem, M.solid],
    cactusTop: [GEO.ball, M.cactus], twig: [GEO.twig, M.dry],
    card: [GEO.card, M.card], cardS: [GEO.card, M.cardS], cardW: [GEO.card, M.cardW], tier: [GEO.tier, M.tier], snowTier: [GEO.tier, M.snow],
    palmSeg: [GEO.palmSeg, M.palmTrunk], frond2: [GEO.frond2, M.frond2], rib: [GEO.rib, M.cactus2], ribTop: [GEO.ribTop, M.cactus2],
    rock0: [GEO.rock0, M.rock2], rock1: [GEO.rock1, M.rock2], rock2: [GEO.rock2, M.rock2],
    ...Object.fromEntries([...FLOWER_PART].map(k => [k, [FLOWER_GEO()[k], k === 'puff' ? M.puff : M.petal]])),
    snowrock0: [GEO.rock0, M.snowRock], snowrock1: [GEO.rock1, M.snowRock], snowrock2: [GEO.rock2, M.snowRock],
  };
  for (const [type, list] of Object.entries(out)) {
    const [geo, m] = spec[type];
    const small = type === 'bloom' || type === 'apple' || type === 'gem' || type === 'coconut' || type.startsWith('card') || FLOWER_PART.has(type);   // (las tarjetas de hojas, sin sombra: la da el núcleo)
    const card = type.startsWith('card'), im = instanced(geo, m, list, { cast: shadows && (!small || card), receive: !card });   // (sin recibir: si no, la copa se oscurece entera con su propia sombra)
    // (las tarjetas de hojas dan sombra moteada: su silueta, con el corte de la textura)
    if (card) im.customDepthMaterial = (CARD_DEPTH[type] ||= new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: m.map, alphaTest: 0.5 }));
    im.userData.cast = !small || card;
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

// La hierba, las setas, los juncos, las conchas y las piedrecitas del suelo de unos trozos (de cx0, cy0, n × n), según
// el bioma de cada casilla. La hierba va por casillas, como en Minecraft (gen.grassAt): cada casilla con hierba lleva
// una mata que la llena entera, de muchas hojas finas (TUFT), en instancias inclinadas como la cuesta. Lo demás va en
// una sola malla con colores por vértice (y cuánto se mece cada vértice), que lleva las matas como hija.
// free(x, y): si ahí puede haber algo (sin construir, labrar, sembrar ni segar)
const B_ = { BEACH: 2, MEADOW: 3, FOREST: 4, PINES: 5, SWAMP: 6, DESERT: 7, SNOW: 8, ROCKY: 9 };
let GROUND;
// (se hace por pasos, un trozo cada vez: yield entre trozo y trozo; al acabar devuelve la malla)
export function* buildGround(cx0, cy0, n, CHUNK, gen, season, free, groundY) {
  const s = gen.seed, out = { pos: [], col: [], sway: [] }, tufts = [];
  const GRASS = [['#5f7a3a', '#6a8442', '#56703a'], ['#56692f', '#5f7336', '#4d6130'], ['#8f7d42', '#9c8a4a', '#86743c'], ['#a4ac9e', '#b2b8ae', '#98a094']][season];
  const A = (GROUND ||= groundShapes());
  for (let cj = 0; cj < n; cj++) for (let ci = 0; ci < n; ci++, yield) for (let ty = (cy0 + cj) * CHUNK; ty < (cy0 + cj + 1) * CHUNK; ty++) for (let tx = (cx0 + ci) * CHUNK; tx < (cx0 + ci + 1) * CHUNK; tx++) {
    const b = gen.biomeAt(tx + 0.5, ty + 0.5), cx = tx + 0.5, cy = ty + 0.5;
    const tall = gen.grassAt(tx, ty);
    if (tall && free(cx, cy)) {
      const gy = groundY(cx, cy);
      if (gy > -0.05) {
        // (la mata, a la altura del centro y con la cuesta de la casilla: las hojas siguen de pie)
        const sx = (groundY(cx + 0.5, cy) - groundY(cx - 0.5, cy)), sz = (groundY(cx, cy + 0.5) - groundY(cx, cy - 0.5));
        tufts.push([cx, gy, cy, ihash(tx, ty, s + 21) * Math.PI * 2, tall * (season === 3 ? 0.6 : 1), sx, sz, GRASS[Math.floor(ihash(tx, ty, s + 22) * 3)], 0.9 + ihash(tx, ty, s + 23) * 0.2]);
      }
      continue;
    }
    const x = tx + ihash(tx, ty, s + 20), y = ty + ihash(tx, ty, s + 30), roll = ihash(tx, ty, s + 10);
    if (!free(x, y)) continue;
    const gy = groundY(x, y);
    if (gy < -0.05) continue;
    if (b === B_.SWAMP && roll < 0.9) put(out, A.reed, x, gy, y, roll * 9, 0.6 + roll * 0.5, '#5e6f44', true);
    else if (b === B_.DESERT && roll < 0.08) put(out, A.blade, x, gy, y, roll * 9, 0.7, '#a08a62', true);
    else if (b === B_.BEACH && roll < 0.04) put(out, A.pebble, x, gy, y, roll * 9, 0.5, '#ffffff');
    else if (b === B_.ROCKY && roll < 0.3) put(out, A.pebble, x, gy, y, roll * 9, 0.8 + roll, '#8a867e');
    else if (b === B_.SNOW && roll < 0.05) put(out, A.pebble, x, gy, y, roll * 9, 1.2, '#ffffff');
    else if (b === B_.FOREST && season !== 3 && ihash(tx, ty, s + 43) < 0.05 && free(cx, cy)) { const g2 = groundY(cx, cy); put(out, A.shroomStem, cx, g2, cy, 0, 1, '#f2ecd8'); put(out, A.shroomCap, cx, g2, cy, 0, 1, '#c83a2a'); }
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
  if (tufts.length) {
    const im = new THREE.InstancedMesh(A.tuft, A.tuftMat, tufts.length), M = new THREE.Matrix4(), c = new THREE.Color();
    tufts.forEach(([x, y, z, rot, h, sx, sz, color, light], i) => {
      // girada, con su altura y su anchura, y con la cuesta: cada punto sube lo que sube el suelo bajo él (las hojas, de pie)
      const co = Math.cos(rot), sn = Math.sin(rot), w = 1;
      M.set(co * w, 0, sn * w, x, sx * co * w - sz * sn * w, h, sx * sn * w + sz * co * w, y, -sn * w, 0, co * w, z, 0, 0, 0, 1);
      im.setMatrixAt(i, M);
      im.setColorAt(i, c.set(color).multiplyScalar(light));
    });
    im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    mesh.add(im);
  }
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
// La mata de hierba de una casilla: TUFT_N hojas finas y largas repartidas por toda la casilla (algo más, para que las
// de al lado se junten), cada una de tres tramos que se estrechan hasta la punta y se doblan hacia fuera; oscuras
// abajo, claras arriba y cada una de un tono algo distinto. Con la normal hacia arriba, como el suelo
const TUFT_N = 72;
function tuftGeometry() {
  let a = 9001;
  const rnd = () => ((a = (a * 16807) % 2147483647) / 2147483647);
  const pos = [], col = [], sway = [];
  for (let i = 0; i < TUFT_N; i++) {
    const bx = (rnd() - 0.5) * 1.12, bz = (rnd() - 0.5) * 1.12;
    const h = 0.08 + rnd() * 0.08 + rnd() * rnd() * 0.14, w = 0.01 + rnd() * 0.008, yaw = rnd() * Math.PI, lean = 0.25 + rnd() * 0.45, ld = rnd() * Math.PI * 2;
    const tone = 0.82 + rnd() * 0.3, ux = Math.cos(yaw), uz = Math.sin(yaw), dx = Math.cos(ld), dz = Math.sin(ld);
    // los puntos de la hoja a lo alto (t de 0 a 1): la anchura baja y se dobla cada vez más
    const at = (t, side) => { const bend = lean * h * t * t, ww = w * (1 - t) * side; return [bx + dx * bend + ux * ww, h * t, bz + dz * bend + uz * ww]; };
    const shade = t => (0.38 + 0.72 * t) * tone;
    const T = [0, 0.55, 1];
    for (let k = 0; k < 2; k++) {
      const t0 = T[k], t1 = T[k + 1], a0 = at(t0, -1), b0 = at(t0, 1), a1 = at(t1, -1), b1 = at(t1, 1);
      const tri = k === 1 ? [a0, b0, a1] : [a0, b0, b1, a0, b1, a1];
      const ts = k === 1 ? [t0, t0, t1] : [t0, t0, t1, t0, t1, t1];
      tri.forEach((p, j) => { pos.push(...p); const c = shade(ts[j]); col.push(c, c, c); sway.push(p[1]); });
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('sway', new THREE.Float32BufferAttribute(sway, 1));
  const nor = new Float32Array(pos.length); for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.computeBoundingSphere();
  return g;
}
function groundShapes() {
  const flat = g => { const n = g.index ? g.toNonIndexed() : g; return Array.from(n.attributes.position.array); };
  // Una matita seca (la del desierto): tres hojas finas cruzadas, más oscuras abajo (cada hoja, con sus dos caras: así
  // las dos se iluminan como el suelo, con la normal hacia arriba)
  const blade = [], shade = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI, w = 0.045, h = 0.17 + (i % 2) * 0.06, dx = Math.cos(a) * w, dz = Math.sin(a) * w, lean = 0.04 * (i - 1);
    blade.push(-dx, 0, -dz, dx, 0, dz, lean, h, lean, dx, 0, dz, -dx, 0, -dz, lean, h, lean);
    shade.push(0.72, 0.72, 1.12, 0.72, 0.72, 1.12);
  }
  const reed = flat(new THREE.CylinderGeometry(0.008, 0.014, 1, 3).translate(0, 0.5, 0));
  const pebble = flat(new THREE.OctahedronGeometry(0.07, 0).scale(1, 0.5, 0.8));
  const shroomStem = flat(new THREE.CylinderGeometry(0.025, 0.03, 0.1, 5).translate(0, 0.05, 0));
  const shroomCap = flat(new THREE.SphereGeometry(0.08, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.09, 0));
  const wind = (m, key, inst) => {
    m.onBeforeCompile = sh => {
      sh.uniforms.windTime = WIND;
      // (con instancias, la fase del viento sale del sitio de cada mata)
      const at = inst ? 'vec3 wp = (instanceMatrix * vec4(position, 1.0)).xyz;' : 'vec3 wp = position;';
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float windTime;\nattribute float sway;').replace('#include <begin_vertex>', `#include <begin_vertex>
        ${at}
        float s = sin(windTime * 1.6 + wp.x * 0.35 + wp.z * 0.25) * 0.6 + sin(windTime * 2.9 + wp.x * 0.9 - wp.z * 0.4) * 0.3;
        transformed.xz += vec2(s, s * 0.5) * ${inst ? '0.35' : '0.3'} * sway;`);
      // (las matas, por las dos caras con la luz de arriba: la cara de atrás no da la vuelta a la normal)
      if (inst) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;'));
    };
    m.customProgramCacheKey = () => key;
    return m;
  };
  const m = wind(mat({ vertexColors: true, roughness: 0.95 }), 'groundcover', false);
  const tuftMat = wind(mat({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }), 'grasstuft', true);
  return { blade: { pos: blade, shade }, reed: { pos: reed }, pebble: { pos: pebble }, shroomStem: { pos: shroomStem }, shroomCap: { pos: shroomCap }, mat: m, tuft: tuftGeometry(), tuftMat };
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
      const { k, R, Ry, cy } = broadDims(o, y), pal = o.kind === 'swampTree' ? SWAMP[season] : LEAF[season];
      trunks.push({ p: [x, (y + cy) / 2, z], s: [1.5 * k, cy - y, 1.5 * k] });
      if (season < 3 || o.kind === 'swampTree') {
        lumps.push({ p: [x, cy + Ry * 0.2, z], s: [R * 0.95, Ry * 0.9, R * 0.95], r: [h, h * 2, 0], c: pal[Math.floor(h * pal.length)] });
        lumps.push({ p: [x + Math.cos(rot) * R * 0.45, cy - Ry * 0.1, z + Math.sin(rot) * R * 0.45], s: R * 0.6, c: pal[(Math.floor(h * 9)) % pal.length] });
      }
    } else if (o.kind === 'pine' || o.kind === 'snowPine') {
      const { k, H } = pineDims(o, y);
      trunks.push({ p: [x, y + H * 0.3, z], s: [k, H * 0.6, k] });
      for (let i = 0; i < 3; i++) cones.push({ p: [x, y + (0.25 + i * 0.25) * H, z], s: [(1.35 - i * 0.4) * k, H * 0.32, (1.35 - i * 0.4) * k], r: [0, rot, 0], c: PINE[i % PINE.length] });
      if (o.kind === 'snowPine' || season === 3) snow.push({ p: [x, y + H * 0.85, z], s: [0.35 * k, 0.5 * k, 0.35 * k] });
    } else if (o.kind === 'palm') {
      const { k, H } = palmDims(o, y);
      trunks.push({ p: [x + Math.cos(rot) * 0.4 * k, y + H / 2, z + Math.sin(rot) * 0.4 * k], s: [0.9, H, 0.9] });
      lumps.push({ p: [x + Math.cos(rot) * 0.9 * k, y + H - 0.1, z + Math.sin(rot) * 0.9 * k], s: [1.8 * k, 0.35 * k, 1.8 * k], c: '#5d7044' });
    } else if (o.kind === 'cactus') {
      const k = (0.9 + h * 0.2) * ageOf(o);
      trunks.push({ p: [x, y + 1.1 * k, z], s: [1.2, 2.2 * k, 1.2] });
    } else if (o.kind === 'boulder' || o.kind === 'snowBoulder') rocks.push({ p: [x, y + 0.25, z], s: [0.9 * s, 0.55 * s, 0.75 * s], r: [0, rot, 0], c: '#9a958c' });
  }
  const group = new THREE.Group();
  for (const [geo, m, list] of [[GEO.trunk, M.bark, trunks], [GEO.lump, M.leaf, lumps], [GEO.cone, M.leaf, cones], [GEO.rock, M.rock, rocks], [GEO.cone, M.snow, snow]]) if (list.length) group.add(instanced(geo, m, list, { cast: false, receive: false }));
  return group;
}
