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
import { tonos, SUELO_V2, HOJAS, SAUCE } from '../arte.js';
import { macroOf, MAC_K, grassKeep } from '../world/ground.js';
import { climate, wetness } from '../world/biomes.js';
import { FLOWER_GEO, FLOWER_COLORS } from './flowers3d.js';
import { ageOf, broadDims, pineDims, palmDims, cactusK } from '../world/treedims.js';
import { injectContact, contactKey } from './contact3d.js';
import { opcion, apagada } from '../opciones.js';

const tmp = new THREE.Object3D(), col = new THREE.Color();
// Viento: el tiempo que mueve la hierba y las copas (lo avanza el dibujo)
export const WIND = { value: 0 };
// hang: lo que cuelga (las ramillas del sauce): se mece más cuanto más abajo, en vez de cuanto más arriba
function sway(material, amount, speed = 1, hang = false) {
  material.onBeforeCompile = sh => {
    sh.uniforms.windTime = WIND;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float windTime;').replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float t = windTime * ${speed.toFixed(2)};
      float s = sin(t * 1.6 + wp.x * 0.35 + wp.z * 0.25) * 0.6 + sin(t * 2.9 + wp.x * 0.9 - wp.z * 0.4) * 0.3;
      transformed.xz += vec2(s, s * 0.5) * ${amount.toFixed(3)} * max(${hang ? '-' : ''}position.y, 0.0);`);
  };
  material.customProgramCacheKey = () => `sway${amount}:${speed}${hang ? ':cuelga' : ''}`;
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
  strand: strandGeo(),
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
// Una ramilla colgante del sauce: una tira que sale de lo alto de la copa (el origen) hacia fuera (+z), se arquea sobre la
// cúpula (hasta z = 1, bajando ARCH) y cae a plomo hasta y = -1, algo abierta al final. Por instancia se escala con su
// ancho (x), lo que cae (y) y lo que se aparta (z). Así, desde la cámara alta se ve la parte de arriba, tumbada sobre la
// copa como las ramillas de un sauce de verdad, y de lado, lo que cuelga: nunca una tarjeta de canto. Más estrecha en el
// arranque (ahí se juntan todas) y algo doblada a lo largo; v: 1 arriba. Las normales, hacia fuera (arriba en lo alto, de
// lado en lo que cuelga) y apenas abiertas hacia los bordes (más, y cada tira parecía la hoja de una palmera); y el color
// de cada vértice, la luz del cielo que le llega: entera en lo alto y menos hacia abajo, donde la tapan las de encima (lo
// mismo de cerca que en el impostor: va en el color). Cuatro filas (tres en el arco y la del final de la caída, que es
// casi recta): 12 vértices y 12 triángulos, que un pantano lleva cientos de sauces de unas 40 ramillas
function strandGeo() {
  const ARCH = 0.24, rows = [];
  for (let k = 0; k <= 2; k++) { const f = (k / 2) * Math.PI / 2; rows.push([Math.sin(f), -(1 - Math.cos(f)) * ARCH]); }
  rows.push([1.08, -1]);
  // (lo largo de la tira con unas medidas de sauce, 1,5 m hacia fuera y 3,5 m de caída: para que la textura no se estire)
  const len = [0];
  for (let i = 1; i < rows.length; i++) len.push(len[i - 1] + Math.hypot((rows[i][0] - rows[i - 1][0]) * 1.5, (rows[i][1] - rows[i - 1][1]) * 3.5));
  const L = len[len.length - 1], pos = [], nor = [], uv = [], cl = [], idx = [], FOLD = 0.16;
  rows.forEach(([zz, yy], i) => {
    const a = rows[Math.max(0, i - 1)], b = rows[Math.min(rows.length - 1, i + 1)], tz = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tz, ty);
    const ny = tz / tl, nz = -ty / tl, half = 0.5 * (0.5 + 0.5 * Math.min(1, len[i] / len[2])), q = len[i] / L, sky = 1 - 0.4 * q ** 1.3;
    // (tres vértices por fila: la tira va doblada a lo largo, con el lomo hacia fuera, como un tejado; así, vista de canto,
    // cada mitad se sigue viendo algo y no es una raya)
    for (const sd of [-1, 0, 1]) {
      const lift = sd ? -FOLD * half : 0, n = new THREE.Vector3(sd * 0.22, ny, nz).normalize();
      pos.push(sd * half, yy + ny * lift, zz + nz * lift); nor.push(n.x, n.y, n.z); uv.push((sd + 1) / 2, 1 - q); cl.push(sky, sky, sky);
    }
    if (i) { const o = (i - 1) * 3; idx.push(o, o + 3, o + 1, o + 1, o + 3, o + 4, o + 1, o + 4, o + 2, o + 2, o + 4, o + 5); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
  g.setIndex(idx);
  return g;
}
// Las tarjetas de hojas se ven por las dos caras con la luz de la de fuera (si no, las de espaldas salen negras)
function oneSided(m) {
  const before = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => { before?.(sh, r); sh.fragmentShader = sh.fragmentShader.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;'); };
  const key = m.customProgramCacheKey; m.customProgramCacheKey = () => key() + ':una';
  return m;
}
// Los atlas de hojas, en gris sobre transparente (el color va por tarjeta): 'roble', un manojo de hojas anchas con sus
// ramitas; 'fina', muchas hojas menudas y apretadas (los arbustos); 'sauce', ramillas que cuelgan con hojas largas y
// estrechas a los dos lados (el sauce llorón); 'ramillas', las del sauce en invierno, peladas. Cada hoja tiene forma de
// hoja (ovalada, con la base más ancha y la punta más fina), con su nervio, la mitad que da a la luz más clara que la otra y la base en
// sombra; en el manojo, las de dentro más oscuras y las del borde, encima y claras: así la copa tiene hondura, con el
// borde iluminado, y no un gris parejo (que, teñido de ocre, parecía paja)
function leafAtlas(kind = 'roble') {
  const W = 256, tall = kind === 'sauce' || kind === 'ramillas', H = tall ? 512 : 256, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); let seed = kind === 'fina' ? 11 : tall ? 23 : 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const g = v => { const k = Math.max(0, Math.min(255, Math.round(v))); return `rgb(${k},${k},${k})`; };
  const leaf = (px, py, ang, L, w, v) => {
    x.save(); x.translate(px, py); x.rotate(ang);
    for (const sd of [-1, 1]) {
      const k = sd < 0 ? 1.06 : 0.86, gr = x.createLinearGradient(-L, 0, L, 0);
      gr.addColorStop(0, g(v * k * 0.8)); gr.addColorStop(0.45, g(v * k)); gr.addColorStop(1, g(v * k * 1.04));
      x.fillStyle = gr; x.beginPath(); x.moveTo(-L, 0); x.bezierCurveTo(-L * 0.95, sd * w * 1.3, L * 0.55, sd * w * 1.35, L, 0); x.closePath(); x.fill();
    }
    x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 1; x.beginPath(); x.moveTo(-L, 0); x.lineTo(L * 0.85, 0); x.stroke();
    x.restore();
  };
  if (tall) {
    const bare = kind === 'ramillas';
    // (las peladas, más y más gruesas: si no, de lejos los mips las borran y el sauce de invierno se queda en una neblina)
    for (let i = 0; i < (bare ? 38 : 22); i++) {
      // (las de los lados, más cortas: la tira acaba en punta deshilachada, no en un borde recto)
      const u = rnd(), px = 12 + u * (W - 24), len = H * (0.5 + rnd() * 0.5) * (0.55 + 0.45 * (1 - Math.abs(2 * u - 1))), bend = (rnd() - 0.5) * 0.6, sv = (bare ? 175 : 150) + rnd() * 70;
      x.strokeStyle = bare ? g(sv) : 'rgb(120,110,90)'; x.lineWidth = bare ? 2.8 : 1.2; x.beginPath(); x.moveTo(px, 0);
      const pts = [];
      for (let t = 0; t <= len; t += 6) { const q = t / len, nx = px + Math.sin(q * 2.2 + i) * 9 + bend * t * 0.15; pts.push([nx, t]); x.lineTo(nx, t); }
      x.stroke();
      if (bare) { x.fillStyle = g(sv * 1.1); pts.forEach(([qx, qy], j) => { if (j > 1 && rnd() < 0.3) { x.beginPath(); x.ellipse(qx + (rnd() < 0.5 ? 2 : -2), qy, 1.8, 2.8, 0, 0, Math.PI * 2); x.fill(); } }); continue; }
      pts.forEach(([qx, qy], j) => { if (j > 1) { const sd = j % 2 ? 1 : -1, ang = Math.PI / 2 + sd * (0.35 + rnd() * 0.35); leaf(qx + sd * 5, qy + 4, ang, 9 + rnd() * 6, 2.2 + rnd() * 1.2, sv * (0.82 + rnd() * 0.3)); } });
    }
  } else {
    const fina = kind === 'fina', n = fina ? 260 : 90, Rm = W * (fina ? 0.45 : 0.4), list = [];
    x.strokeStyle = 'rgb(70,62,54)'; x.lineWidth = fina ? 1.2 : 2;
    for (let i = 0; i < (fina ? 9 : 5); i++) { x.beginPath(); x.moveTo(W / 2, H / 2); x.lineTo(W / 2 + (rnd() - 0.5) * W * 0.8, H / 2 + (rnd() - 0.5) * H * 0.8); x.stroke(); }
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, L = fina ? 6 + rnd() * 5 : 16 + rnd() * 14, d = Math.min(W / 2 - L - 2, Math.sqrt(rnd()) * Rm * (fina ? 1 + 0.13 * Math.sin(a * 5) : 1)), f = Math.min(1, d / Rm);   // (las del borde, dentro del lienzo: si no, se cortaban en recto)
      // (giradas de cualquier manera, que si miran todas hacia fuera el manojo parece una estrella; de dentro, más oscuras)
      list.push([d, W / 2 + Math.cos(a) * d, H / 2 + Math.sin(a) * d, rnd() * Math.PI * 2, L, L * (fina ? 0.5 : 0.42), 100 + 135 * f ** 0.8 + (rnd() - 0.5) * 44]);
    }
    list.sort((p, q) => p[0] - q[0]);
    for (const [, px, py, ang, L, w, v] of list) leaf(px, py, ang, L, w, v);
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
  strand: oneSided(sway(mat({ map: leafAtlas('sauce'), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85, vertexColors: true }), 0.035, 0.6, true)),
  strandB: oneSided(sway(mat({ map: leafAtlas('ramillas'), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9, vertexColors: true }), 0.035, 0.6, true)),
  tier: sway(mat({ roughness: 0.95, side: THREE.DoubleSide, shadowSide: THREE.BackSide, flatShading: true }), 0.02, 0.6),
  rock2: mat({ map: rockFace(), flatShading: true, roughness: 0.92 }),
  frond2: sway(mat({ color: '#ffffff', side: THREE.DoubleSide, shadowSide: THREE.DoubleSide, roughness: 0.85 }), 0.05, 1.2),
  cactus2: mat({ color: '#ffffff', roughness: 0.75 }), snowRock: snowCap({ flatShading: true }),
  petal: mat({ roughness: 0.8, side: THREE.DoubleSide }), puff: mat({ roughness: 1, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false }),
});
// Colores de las hojas según la estación (0 primavera … 3 invierno): los de la paleta (arte.js: HOJAS y SAUCE), por matas.
// pickW: uno de ellos, según lo que se da cada uno (u, de 0 a 1)
function pickW(P, u, w = P.w) {
  let sum = 0;
  for (const v of w) sum += v;
  let t = u * sum;
  for (let i = 0; i < w.length; i++) if ((t -= w[i]) < 0) return P.c[i];
  return P.c[P.c.length - 1];
}
// El tinte de cada árbol de hoja, por su sitio: lo que se aparta su copa del color de la estación, para que no salgan todos
// iguales. En primavera, algo más claro u oscuro y más o menos amarillo; en verano, de verde azulado a amarillento; en
// otoño, de los que aún verdean a los que ya están rojizos, y algunos pardos, apagados. Lo usan el árbol de cerca (en el
// color de todas sus hojas, sobre el de cada mata) y el lejano (impostor.js: el color de su tarjeta), así que casan; los de
// muestra del atlas van sin él (o.neutral). Es un factor por canal, en el espacio lineal, como el color de las instancias
const TINT = new THREE.Color();
export function leafTint(o, season, out = TINT) {
  if (o.neutral || season === 3) return out.setRGB(1, 1, 1);
  const a = ihash(Math.floor(o.x * 5) + 3, Math.floor(o.y * 5), 57), b = ihash(Math.floor(o.x * 5), Math.floor(o.y * 5) + 5, 59);
  let R = 1, G = 1, B = 1, v;
  if (season === 0) { v = 0.94 + 0.12 * b; R = 0.94 + 0.12 * a; B = 1.06 - 0.14 * a; }
  else if (season === 1) { v = 0.86 + 0.2 * b; R = 0.82 + 0.32 * a; G = 0.96 + 0.08 * a; B = 1.16 - 0.38 * a; }
  else {
    v = 0.9 + 0.16 * b;
    if (b < 0.16) { R = 0.9; G = 0.8; B = 0.78; }                                                  // pardo
    else if (a < 0.35) { const t = a / 0.35; R = 0.78 + 0.22 * t; G = 1.03 - 0.03 * t; B = 0.72 + 0.28 * t; }   // aún verdea
    else if (a > 0.68) { const t = (a - 0.68) / 0.32; R = 1 + 0.08 * t; G = 1 - 0.26 * t; B = 1 - 0.22 * t; }   // rojizo
  }
  return out.setRGB(R * v, G * v, B * v);
}
// Cuál de los dos robles adultos del atlas de lejos es (impostor.js, pick: la misma cuenta): en otoño, cada uno con su mezcla
const variantOf = o => o.variant ?? (ihash(Math.floor(o.x * 3), Math.floor(o.y * 3), 91) < 0.5 ? 0 : 1);
// Un color de hoja (hex) por f, teñido
const leafC = (c, f, tint) => col.set(c).multiplyScalar(f).multiply(tint).getHex();
// El de un núcleo de copa: oscuro y algo apagado, que lo que asoma entre las hojas se lea como la sombra de dentro de la
// copa (le da el sol de lleno, y las hojas, con el atlas, salen a poco más de la mitad de su color: con 0,42 asomaban bolas
// naranjas o rojizas, y más apagado, grises, como piedras)
const coreC = (c, f, tint) => { col.set(c).multiplyScalar(f).multiply(tint); const l = (col.r + col.g + col.b) / 3; return col.lerp(TINT2.setRGB(l, l, l), 0.25).getHex(); };
const TINT2 = new THREE.Color();
const PINE = tonos('#3f5240');
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
    else for (let i = 0; i < 3; i++) push('lump', { p: [x + (i - 1) * 0.08, y + 0.5 + (i % 2) * 0.08, z], s: 0.12, c: HOJAS[season === 3 ? 1 : season].c[i] });
  }
}

// (la edad y las medidas de cada árbol: world/treedims.js, las mismas para el de cerca y el lejano)
const darker = (c, f) => col.set(c).multiplyScalar(f).getHex();
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), ZV = new THREE.Vector3(0, 0, 1), dv = new THREE.Vector3();
// Roble y frutal: tronco con su pie, ramas que se abren y una copa de varias matas, con un núcleo oscuro y tarjetas de hojas
// por fuera (en invierno se quedan en ramas). (El sauce del pantano va aparte: willow2)
function broadleaf2(o, season, push, x, z, y, r, rot) {
  const kind = o.kind, fruit = kind === 'fruit', { k, R, Ry, cy, th } = broadDims(o, y);
  const bare = season === 3, P = HOJAS[season], tint = leafTint(o, season).clone();
  // (en otoño, los robles adultos con la mezcla de su roble del atlas de lejos; los jóvenes y los demás, con la de siempre)
  const wts = season === 2 && kind === 'oak' && ageOf(o) > 0.75 ? P.otono[variantOf(o)] : P.w;
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
  // La copa: cada mata con su color (casi todas sus hojas de él y alguna de otro: manchas, como en un árbol de verdad), con
  // su núcleo oscuro (el que da sombra) y las tarjetas de hojas alrededor. Cada tarjeta, más oscura cuanto más dentro de su
  // mata, más mirando abajo y más baja en la copa (la luz del cielo que le llega), y algo distinta de la de al lado: la copa
  // tiene hondura, con el borde y lo alto iluminados. Los colores de las matas de un árbol son los de la paleta repartidos
  // por lo que se da cada uno (por cuantiles: con cinco o seis matas, a suertes salía la mezcla que fuera, y la de un árbol
  // lejano, del atlas, no casaba con la del de cerca, que al acercarse cambiaba de color), y cada árbol los gira: a cuál
  // mata le toca cada uno. Así la mezcla es la misma de cerca y de lejos y de un árbol a otro, y lo que cambia es dónde
  // cae cada color, y el tinte (leafTint), que el lejano también lleva
  const nc = clumps.length, turnC = Math.floor(r(990) * nc), cc = clumps.map((_, i) => pickW(P, (((i + turnC) % nc) + 0.5) / nc, wts));
  // (el núcleo, algo subido y aplastado: por debajo de la mata casi no hay hojas, y de cerca, mirando hacia arriba, asomaba
  // como una bola oscura; por arriba no pasa de donde llegaba. Y pequeño, bien dentro de las hojas; el de los frutales, más,
  // que tienen menos)
  const kl = fruit ? 0.75 : 0.88;
  clumps.forEach(([cx, cY, cz, cr], i) => push('lump', { p: [cx, cY + cr * 0.06, cz], s: [cr * 0.48 * kl, cr * 0.36 * kl, cr * 0.48 * kl], r: [r(3) * 0.4, r(4), r(5) * 0.4], c: coreC(cc[i], 0.28, tint) }));
  const cards = Math.round((fruit ? 70 : 50) * ageOf(o) + (fruit ? 10 : 8));
  for (let i = 0; i < cards; i++) {
    const ci = i % clumps.length, [cx, cY, cz, cr] = clumps[ci], u = r(200 + i) * 1.5 - 0.5, f = r(300 + i) * Math.PI * 2, sq = Math.sqrt(1 - u * u);
    dv.set(sq * Math.cos(f), u, sq * Math.sin(f));
    const depth = r(400 + i), dist = cr * (0.5 + depth * 0.45);
    qa.setFromUnitVectors(ZV, dv); qb.setFromAxisAngle(ZV, r(500 + i) * 6.28); qa.multiply(qb); euler.setFromQuaternion(qa);
    const sz = cr * (1.1 + r(600 + i) * 0.6), hi = Math.max(0, Math.min(1, (cY - cy) / Ry + 0.5));
    // (la hondura, de 0,82 a 1,08: con más, las tarjetas vistas de canto salían como tajos casi negros; el resto lo da el atlas)
    const light = (0.82 + 0.26 * depth) * (0.86 + 0.18 * (u + 0.5) / 1.5) * (0.9 + 0.14 * hi) * (0.93 + 0.14 * r(800 + i));
    push('card', { p: [cx + dv.x * dist, cY + dv.y * dist * 0.85, cz + dv.z * dist], s: [sz, sz, sz], r: [euler.x, euler.y, euler.z], c: leafC(r(700 + i) < 0.75 ? cc[ci] : pickW(P, r(750 + i), wts), light, tint) });
  }
  if (fruit && season < 3 && !(o.bare && season > 0)) for (let i = 0; i < (season === 0 ? 16 : 10); i++) {
    const a = r(60 + i) * Math.PI * 2, e = r(70 + i) * 0.9 - 0.25, d = R * 0.95;
    push(season === 0 ? 'bloom' : 'apple', { p: [x + Math.cos(a) * Math.cos(e) * d, cy + Ry * 0.25 + Math.sin(e) * Ry, z + Math.sin(a) * Math.cos(e) * d], s: season === 0 ? 0.08 : 0.09, c: season === 0 ? BLOSSOM[i % 3] : '#b8382a' });
  }
}
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
  const k = cactusK(o), th = 2.2 * k, w = 0.2 * Math.sqrt(k), c = tonos('#6a8058')[0];
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
// Sauce llorón: tronco corto y grueso que se abre pronto en tres o cuatro brazos que suben y se arquean hacia fuera, con un
// núcleo oscuro (la sombra de dentro) y, encima, la copa hecha de ramillas colgantes (GEO.strand): salen de lo alto, se
// tumban sobre la cúpula y caen, en tres capas: las de la coronilla, cortas, que la cubren desde arriba; las de en medio, y
// las de fuera, la cortina, que caen casi hasta el suelo (unas más que otras), con unas matas de hojas menudas tapando la
// coronilla. Vista desde arriba es una cúpula de lóbulos, de ramillas que se abren hacia fuera; de lado, una cortina. Cada
// ramilla, de uno de los colores de SAUCE, con el tinte del árbol; en invierno, peladas: solo las ramillas doradas, sin
// núcleo ni matas
function willow2(o, season, push, x, z, y, r, rot) {
  const { k, H, Ry, cy } = broadDims(o, y), R = 2.1 * k, fork = y + 1.25 * k, bare = season === 3, P = SAUCE[season], tint = leafTint(o, season).clone();
  push('trunk', { p: [x, y + 0.15, z], s: [2.7 * k, 0.3, 2.7 * k], r: [0, rot, 0] });
  push('trunk', { p: [x, (y + fork) / 2, z], s: [2.1 * k, fork - y, 2.1 * k], r: [0.06, rot, 0.04] });
  const n = 3 + Math.floor(r(2) * 2), arms = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2 + r(110 + i) * 0.6, mid = [x + Math.cos(a) * R * 0.45, cy + Ry * 0.35, z + Math.sin(a) * R * 0.45], end = [x + Math.cos(a) * R * 0.8, cy + Ry * 0.2, z + Math.sin(a) * R * 0.8];
    branch(push, [x, fork - 0.1, z], mid, 1.2 * k); branch(push, mid, end, 0.65 * k);
    arms.push(a);
  }
  if (!bare) push('lump', { p: [x, cy + Ry * 0.02, z], s: [R * 0.58, Ry * 0.46, R * 0.58], r: [0, rot, 0], c: leafC(P.c[0], 0.5, tint) });   // (del color de las ramillas, algo oscuro: lo que asoma entre ellas, desde arriba, no hace rayas oscuras, como en una palmera)
  // Encima de cada brazo, la copa se abomba (más alta y más ancha): vista desde arriba no es un círculo liso sino de
  // lóbulos, uno por brazo, como los de un sauce de verdad. lobe(f): de 0 (entre dos brazos) a 1 (encima de uno)
  const lobe = f => { let m = 0; for (const a of arms) m = Math.max(m, Math.cos(Math.atan2(Math.sin(f - a), Math.cos(f - a)) * n / 2)); return m * m; };
  // El color, por lóbulos: cada brazo con uno de la paleta (repartidos por lo que se da cada uno, en el orden que le toca a
  // este sauce, como las matas de los robles) y sus ramillas casi todas de él. Ramilla a ramilla, salían rayas de colores
  // desde el centro y, desde arriba, el sauce parecía una palmera
  const turnC = Math.floor(r(990) * n), armC = arms.map((_, j) => pickW(P, (((j + turnC) % n) + 0.5) / n));
  const colorAt = (f, u, u2) => { let best = 0, bd = 9; arms.forEach((a, j) => { const dd = Math.abs(Math.atan2(Math.sin(f - a), Math.cos(f - a))); if (dd < bd) { bd = dd; best = j; } }); return u < 0.72 ? armC[best] : pickW(P, u2); };
  // Las ramillas. Cada capa: cuántas, a qué distancia del centro y a qué altura (de H) salen, cuánto se apartan (de R),
  // hasta qué altura sobre el suelo caen (de H; la de fuera, ver abajo), su ancho (de R) y cuánta luz les llega. Las de la
  // coronilla salen de cualquier sitio de lo alto (no todas del centro: desde arriba, eso parecía una palmera) y hacia
  // fuera más o menos; las de las otras dos capas, en corro, hacia fuera
  const age = ageOf(o), top = y + H, type = bare ? 'cardStrandB' : 'cardStrand', yaw = (dx, dz) => Math.atan2(dx, dz);
  // (las alturas de las capas se solapan: escalonadas, el codo de la cortina caía por debajo de la cúpula y algunos sauces,
  // desde arriba, parecían una pagoda de dos tejados)
  const layers = [
    { n: Math.round(11 + 5 * age), d: [0, 0.34], h: [0.95, 1.01], reach: [0.32, 0.48], low: [0.5, 0.66], w: [0.4, 0.54], light: 1.08, crown: true },
    { n: bare ? 0 : Math.round(9 + 4 * age), d: [0.2, 0.3], h: [0.86, 0.97], reach: [0.44, 0.58], low: [0.3, 0.48], w: [0.42, 0.54], light: 0.97 },
    { n: Math.round(14 + 5 * age), d: [0.34, 0.46], h: [0.84, 0.94], reach: [0.46, 0.62], low: null, w: [0.36, 0.5], light: 1 },
  ];
  let s = 0;
  layers.forEach((L, li) => {
    for (let i = 0; i < L.n; i++, s++) {
      // (cada ramilla con sus propios números: b, de 16 en 16; seguidos, la de al lado reusaba los de esta para otra cosa)
      const b = 2000 + s * 16, q = (u, [a, c]) => a + (c - a) * u, ring = rot + ((i + (li % 2) * 0.5) / L.n) * Math.PI * 2 + (r(b) - 0.5) * (5 / L.n);
      // (la de la coronilla: un sitio cualquiera de lo alto, por área, y hacia fuera de él con hasta ±40°)
      const at = L.crown ? r(b + 1) * Math.PI * 2 : ring, rd = L.crown ? Math.sqrt(r(b + 2)) : r(b + 2), f = L.crown ? at + (r(b + 3) - 0.5) * 1.4 : ring, lb = lobe(at);
      const d = R * q(rd, L.d) * (0.85 + 0.25 * lb), dh = L.crown ? 0.1 * rd * rd : 0, ay = Math.min(top, y + H * (q(r(b + 4), L.h) - dh - 0.06 * (1 - lb))), reach = R * q(r(b + 5), L.reach) * (0.88 + 0.2 * lb);
      // (la cortina: unas casi hasta el suelo y otras a media altura, para que su borde no sea una falda pareja)
      const bottom = L.low ? y + H * q(r(b + 6), L.low) : y + 0.3 + (r(b + 7) < 0.45 ? r(b + 6) * 0.5 : 0.5 + r(b + 6) * 1.5);
      // (la luz, de 0,9 a 1,1 entre una y otra: pareja, la copa parecía un tejado de paja, y con más, desde arriba, salían
      // rayos, como en una palmera; y más clara encima de los lóbulos)
      const light = L.light * (0.9 + 0.2 * r(b + 8)) * (0.93 + 0.12 * lb);
      // (vuelta hacia fuera, algo cabeceada arriba o abajo, que así el codo de cada una cae a otra altura y el borde de la
      // cúpula no es una arista, y algo ladeada)
      qa.setFromAxisAngle(UP, yaw(Math.cos(f), Math.sin(f))); qb.setFromAxisAngle(XV, (r(b + 10) - 0.5) * 0.16); qa.multiply(qb); qb.setFromAxisAngle(ZV, (r(b + 11) - 0.5) * 0.35); qa.multiply(qb); euler.setFromQuaternion(qa);
      push(type, { p: [x + Math.cos(at) * d, ay, z + Math.sin(at) * d], s: [R * q(r(b + 9), L.w), Math.max(0.6, ay - bottom), reach], r: [euler.x, euler.y, euler.z], c: leafC(colorAt(at, r(b + 12), r(b + 13)), light, tint) });
    }
  });
  // La coronilla, tapada: unas matas de hojas menudas tumbadas en lo alto, donde arrancan las ramillas (si no, desde arriba
  // se veía el núcleo por el centro, como un agujero, y todas las tiras saliendo de él)
  if (!bare) for (let i = 0, n = Math.round(6 + 5 * age); i < n; i++) {
    const b = 3000 + i * 10, a = r(b) * Math.PI * 2, d = R * 0.34 * Math.sqrt(r(b + 1)), u = 0.55 + r(b + 2) * 0.45, f = r(b + 3) * Math.PI * 2, sq = Math.sqrt(1 - u * u);
    dv.set(sq * Math.cos(f), u, sq * Math.sin(f)); qa.setFromUnitVectors(ZV, dv); qb.setFromAxisAngle(ZV, r(b + 4) * 6.28); qa.multiply(qb); euler.setFromQuaternion(qa);
    const sz = R * (0.36 + r(b + 5) * 0.16);
    push('cardS', { p: [x + Math.cos(a) * d, top - 0.3 - 0.3 * (d / R) - r(b + 6) * 0.15, z + Math.sin(a) * d], s: [sz, sz, sz], r: [euler.x, euler.y, euler.z], c: leafC(colorAt(a, r(b + 7), r(b + 9)), 1.05 + 0.1 * r(b + 8), tint) });
  }
}
// Arbusto: unas matas pequeñas con su núcleo y tarjetas de hojas, de algo más de un metro (con bayas en verano o flores en
// primavera, y nieve en invierno)
function bush2(o, season, push, x, z, y, r, rot, h) {
  // Un monte bajo de cinco matas (una en medio, más alta, y cuatro alrededor), con el núcleo oscuro, muchas hojas menudas
  // y unas ramitas al pie; con bayas en verano o flores en primavera, y nieve en invierno
  const k = 1.1 + h * 0.35, P = HOJAS[season], tint = leafTint(o, season).clone(), clumps = [[x, y + 0.5 * k, z, 0.4 * k]];
  for (let i = 0; i < 4; i++) { const a = rot + i * 1.57 + r(10 + i) * 0.5, d = (0.3 + r(15 + i) * 0.1) * k; clumps.push([x + Math.cos(a) * d, y + (0.28 + r(20 + i) * 0.14) * k, z + Math.sin(a) * d, (0.28 + r(25 + i) * 0.08) * k]); }
  // (cada mata, de un color, como en los árboles)
  const cc = clumps.map((_, i) => pickW(P, r(1000 + i)));
  clumps.forEach(([cx, cY, cz, cr], i) => push('lump', { p: [cx, cY + cr * 0.06, cz], s: [cr * 0.36, cr * 0.28, cr * 0.36], r: [r(3) * 0.4, r(4), 0], c: leafC(cc[i], 0.6, tint) }));   // (pequeño: asomaba como una bola lisa)
  for (let i = 0; i < 4; i++) { const a = rot + i * 1.6 + 0.4; push('twig', { p: [x + Math.cos(a) * 0.12 * k, y + 0.12, z + Math.sin(a) * 0.12 * k], s: [1.4, 0.3, 1.4], r: [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5] }); }
  for (let i = 0; i < 36; i++) {
    const ci = i % clumps.length, [cx, cY, cz, cr] = clumps[ci], u = r(200 + i) * 1.5 - 0.5, f = r(300 + i) * Math.PI * 2, sq = Math.sqrt(1 - u * u);
    dv.set(sq * Math.cos(f), u, sq * Math.sin(f)); qa.setFromUnitVectors(ZV, dv); qb.setFromAxisAngle(ZV, r(500 + i) * 6.28); qa.multiply(qb); euler.setFromQuaternion(qa);
    const depth = r(400 + i), dist = cr * (0.45 + depth * 0.5), sz = cr * (0.95 + r(600 + i) * 0.45), light = (0.92 + 0.36 * depth) * (0.9 + 0.2 * (u + 0.5) / 1.5) * (1.02 + r(800 + i) * 0.18);
    push('cardS', { p: [cx + dv.x * dist, Math.max(y + 0.08, cY + dv.y * dist * 0.85), cz + dv.z * dist], s: [sz, sz, sz], r: [euler.x, euler.y, euler.z], c: leafC(r(700 + i) < 0.75 ? cc[ci] : pickW(P, r(750 + i)), light, tint) });
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
    card: [GEO.card, M.card], cardS: [GEO.card, M.cardS], cardStrand: [GEO.strand, M.strand], cardStrandB: [GEO.strand, M.strandB], tier: [GEO.tier, M.tier], snowTier: [GEO.tier, M.snow],
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
    im.userData.mat = m;   // (su material de siempre: el fundido lo cambia un momento por una copia, ver nearFadeSet)
    im.userData.base = list.map((it, i) => { const mm = new THREE.Matrix4(); im.getMatrixAt(i, mm); return mm; });
    list.forEach((it, i) => { if (!owners.has(it.owner)) owners.set(it.owner, []); owners.get(it.owner).push([im, i, type]); });   // (the type: the outline skips the flat leaf cards)
    group.add(im);
  }
  return { group, owners };
}
// El fundido entre el árbol de cerca y el lejano (World3D): mientras un bloque de naturaleza aparece o se va, sus mallas
// usan copias de los materiales que dejan sin pintar parte de los píxeles, con un tramado fijo en la pantalla (DITHER,
// ruido de gradiente entrelazado): se ve el de cerca donde DITHER < fundido. El lejano (impostor.js) se salta justo los
// otros, así que entre los dos cubren cada píxel una sola vez: ni doble ni hueco. Las copias van aparte porque un
// discard en el material de siempre le quitaría a la gráfica el descarte temprano de lo tapado en todos los árboles; así
// solo lo pagan los bloques que se están fundiendo, durante FADE_MS. Los juegos de copias no se tiran: vuelven a una
// reserva, con sus programas ya compilados (las copias con la misma clave comparten programa; cada una, su uniforme)
export const DITHER = 'fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))))';
const FADE_POOL = [];
function makeFadeSet() {
  const u = { value: 1 }, map = new Map();
  for (const m of Object.values(mats())) {
    if (!m) continue;
    // (clone() no copia onBeforeCompile ni la clave: van a mano; la clave, antes de envolver, porque la de por defecto es
    // el texto de onBeforeCompile y todas las copias acabarían compartiendo un programa)
    const c = m.clone(), prevKey = m.customProgramCacheKey(), prev = m.onBeforeCompile;
    c.onBeforeCompile = (sh, r) => {
      prev.call(m, sh, r);
      sh.uniforms.uNearFade = u;
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNearFade;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n  if (${DITHER} >= uNearFade) discard;`);
    };
    c.customProgramCacheKey = () => prevKey + ':nf';
    map.set(m, c);
  }
  return { u, mats: map };
}
export const nearFadeSet = () => FADE_POOL.pop() || makeFadeSet();
export const releaseFadeSet = s => { FADE_POOL.push(s); };
// Pone (on) o quita el juego de fundido en las mallas de un bloque de naturaleza
export function fadeMeshes(group, set, on) {
  for (const im of group.children) {
    const base = im.userData.mat;
    if (!base) continue;
    const c = on && set.mats.get(base);
    if (c) { c.envMapIntensity = base.envMapIntensity; im.material = c; } else im.material = base;
  }
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

// La hierba, las setas, los juncos, las conchas y las piedrecitas del suelo de unos trozos, según el bioma de cada
// casilla. La hierba va por casillas, como en Minecraft (gen.grassAt): cada casilla con hierba lleva una mata que la llena
// entera, de muchas hojas finas (TUFT), en instancias inclinadas como la cuesta; las matas de cada trozo van en su propia
// malla de instancias (se recorta mejor, lleva su nivel de detalle y, al segar, solo se rehace la de ese trozo). Lo
// demás (la cubierta) va en una sola malla para todos los trozos, con colores por vértice (y cuánto se mece cada vértice).
// free(x, y): si ahí puede haber algo (sin construir, labrar, sembrar ni segar)
const B_ = { BEACH: 2, MEADOW: 3, FOREST: 4, PINES: 5, SWAMP: 6, DESERT: 7, SNOW: 8, ROCKY: 9 };
let GROUND;
// Las matas siguen las manchas grandes del suelo (ground.js, macroOf): hacia qué color van en lo seco y en lo jugoso, por
// estación (en invierno, nada: solo el valor)
const TUFT_DRY = ['#7d7a3e', '#9a8a44', '#9c7a3a'].map(c => new THREE.Color(c)), TUFT_LUSH = ['#4f7034', '#4a6630', '#6a6c34'].map(c => new THREE.Color(c)), TM = {};
// El rastrojo de lo segado o comido: lo alta que queda la mata y hacia qué color va
const STUB_H = 0.3, STUB_C = new THREE.Color('#a39a5c');
// Lo mojado (wetness) para la franja jugosa de las orillas, como la pinta el suelo: el clima de cada trozo en una rejilla de
// 5 × 5 (cada 4 m) y, entre medias, interpolado, como hace gen.js (computeField) por casilla. Por casilla costaría 1-2 ms
// por trozo; así, 25 cuentas de clima, y solo en los trozos que tienen hierba
const WK = ['T', 'C', 'R', 'f', 'L', 'M', 'P', 'Q'], WG = WK.map(() => new Float32Array(25)), WC = {}, WV = {};
function wetGrid(X0, Y0, seed) {
  for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) { climate(X0 + i * 4, Y0 + j * 4, seed, WC); for (let q = 0; q < WK.length; q++) WG[q][j * 5 + i] = WC[WK[q]]; }
}
function wetAt(x, y, X0, Y0) {
  const fx = (x - X0) / 4, fy = (y - Y0) / 4, i0 = Math.min(3, fx | 0), j0 = Math.min(3, fy | 0), u = fx - i0, v = fy - j0, b = j0 * 5 + i0;
  for (let q = 0; q < WK.length; q++) { const a = WG[q]; WV[WK[q]] = a[b] + (a[b + 1] - a[b]) * u + (a[b + 5] - a[b]) * v + (a[b] - a[b + 1] - a[b + 5] + a[b + 6]) * u * v; }
  return wetness(WV);
}
// chunks: [[cx, cy, i, matas]], los trozos que se recorren y si se hacen sus matas; cover: si se hace la cubierta (al
// segar no hace falta: una casilla con hierba solo lleva su mata, así que lo segado no cambia la cubierta). Se hace por
// pasos: un yield por trozo, con { i, tufts (la malla de sus matas o null), box y bounds (sus cajas, para el nivel de
// detalle y para recortar) }; al acabar devuelve la cubierta (o null). stub(x, y): si la casilla está segada o comida:
// lleva rastrojo, la misma mata muy corta y más pajiza (así se ve lo segado y lo que han pastado los animales)
export function* buildGround(chunks, CHUNK, gen, season, free, groundY, cover = true, stub = null) {
  const s = gen.seed, out = { pos: [], col: [], sway: [] };
  const GRASS = [['#5f7a3a', '#6a8442', '#56703a'], ['#56692f', '#5f7336', '#4d6130'], ['#8f7d42', '#9c8a4a', '#86743c'], ['#a4ac9e', '#b2b8ae', '#98a094']][season];
  const A = (GROUND ||= groundShapes()), K = MAC_K[season], M = new THREE.Matrix4(), c = new THREE.Color();
  const REACH = A.tuft[0].userData.reach, TOP = A.tuft[0].userData.top;
  for (const [kx, ky, idx, want] of chunks) {
    const X0 = kx * CHUNK, Y0 = ky * CHUNK, tufts = [];
    let wet = false, y0 = Infinity, y1 = -Infinity, lo = Infinity, hi = -Infinity;
    for (let ty = Y0; ty < Y0 + CHUNK; ty++) for (let tx = X0; tx < X0 + CHUNK; tx++) {
      const cx = tx + 0.5, cy = ty + 0.5, tall = gen.grassAt(tx, ty);
      if (tall) {
        // (una casilla con hierba solo lleva su mata: nada de la cubierta)
        if (!want) continue;
        const cut = !free(cx, cy);
        if (cut && !stub?.(cx, cy)) continue;
        const gy = groundY(cx, cy);
        if (gy <= -0.05) continue;
        // (la mata, a la altura del centro y con la cuesta de la casilla: las hojas siguen de pie)
        const sx = (groundY(cx + 0.5, cy) - groundY(cx - 0.5, cy)), sz = (groundY(cx, cy + 0.5) - groundY(cx, cy - 0.5));
        // (en las cuestas fuertes, donde el suelo es roca, no hay; en las medias, menos: grassKeep, como el sombreador)
        if (ihash(tx, ty, s + 24) > grassKeep(Math.hypot(sx, sz))) continue;
        // (las manchas, con la franja de la orilla)
        if (!SUELO_V2 && !wet) { wet = true; wetGrid(X0, Y0, s); }
        const mac = SUELO_V2 ? null : macroOf(cx, cy, s, wetAt(cx, cy, X0, Y0), TM);
        tufts.push([cx, gy, cy, ihash(tx, ty, s + 21) * Math.PI * 2, tall * (season === 3 ? 0.6 : 1) * (cut ? STUB_H : 1), sx, sz, GRASS[Math.floor(ihash(tx, ty, s + 22) * 3)], 0.9 + ihash(tx, ty, s + 23) * 0.2, mac ? mac.dry : 0, mac ? mac.lush : 0, mac ? mac.v : 1, cut]);
        // (lo que ocupa: las hojas salen hasta REACH del centro, con lo que se doblan, el viento y lo que se ensanchan de
        // lejos, y con la cuesta suben o bajan hasta su pendiente por REACH: la fila Y de la matriz de abajo es la cuesta
        // girada, que mide lo mismo)
        const S = Math.hypot(sx, sz) * REACH;
        if (gy < y0) y0 = gy;
        if (gy > y1) y1 = gy;
        if (gy - S < lo) lo = gy - S;
        if (gy + S + tall * TOP > hi) hi = gy + S + tall * TOP;
        continue;
      }
      if (!cover) continue;
      const b = gen.biomeAt(cx, cy), x = tx + ihash(tx, ty, s + 20), y = ty + ihash(tx, ty, s + 30), roll = ihash(tx, ty, s + 10);
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
    let im = null;
    if (tufts.length) {
      im = new THREE.InstancedMesh(A.tuft[0], A.tuftMat, tufts.length);
      tufts.forEach(([x, y, z, rot, h, sx, sz, color, light, dry, lush, v, cut], i) => {
        // girada, con su altura y su anchura, y con la cuesta: cada punto sube lo que sube el suelo bajo él (las hojas, de pie)
        const co = Math.cos(rot), sn = Math.sin(rot), w = 1;
        M.set(co * w, 0, sn * w, x, sx * co * w - sz * sn * w, h, sx * sn * w + sz * co * w, y, -sn * w, 0, co * w, z, 0, 0, 0, 1);
        im.setMatrixAt(i, M);
        c.set(color);
        if (season < 3) c.lerp(TUFT_DRY[season], dry * K[0] * 0.7).lerp(TUFT_LUSH[season], lush * K[1] * 0.6);
        if (cut) c.lerp(STUB_C, 0.55).multiplyScalar(0.92);   // (el rastrojo, pajizo: lo cortado se seca)
        im.setColorAt(i, c.multiplyScalar(light * (1 + (v - 1) * K[2])));
      });
      im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      im.frustumCulled = false;   // (lo recorta World3D.updateGrass con su caja, más ajustada que la esfera)
    }
    // (box, la de los centros de las matas, que es lo que mira el sombreador para el nivel de detalle; bounds, la de todo
    // lo que se dibuja, para recortar)
    yield {
      i: idx, tufts: im,
      box: { x0: X0 + 0.5, x1: X0 + CHUNK - 0.5, z0: Y0 + 0.5, z1: Y0 + CHUNK - 0.5, y0: im ? y0 : 0, y1: im ? y1 : 0 },
      bounds: im ? new THREE.Box3(new THREE.Vector3(X0 + 0.5 - REACH, lo - 0.05, Y0 + 0.5 - REACH), new THREE.Vector3(X0 + CHUNK - 0.5 + REACH, hi + 0.05, Y0 + CHUNK - 0.5 + REACH)) : null,
    };
  }
  if (!cover || !out.pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(out.col, 3));
  geo.setAttribute('sway', new THREE.Float32BufferAttribute(out.sway, 1));
  // (todas hacia arriba: la cubierta se ilumina como el suelo, sin brillos raros en las hojas finas)
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
// La mata de hierba de una casilla: TUFT_N hojas finas y largas repartidas por toda la casilla (algo más, para que las
// de al lado se junten), cada una de tres tramos que se estrechan hasta la punta y se doblan hacia fuera; oscuras
// abajo, claras arriba y cada una de un tono algo distinto. Con la normal hacia arriba, como el suelo
const TUFT_N = 72;
// Niveles de detalle de las matas. De lejos, una hoja mide menos de un píxel de ancho: parpadea y cuesta sin que se vea.
// Por eso las hojas van ordenadas por importancia (las primeras, bien repartidas por la casilla y las más altas) y, con
// la distancia, el sombreador hunde las últimas en su raíz y ensancha las que quedan (la misma cobertura con menos
// hojas): N, cuántas quedan en cada nivel; G0, G1 y G2, a qué distancia (la de una cámara de FOV 30: con más FOV se ve
// más pequeño y cuenta como más lejos) empieza a aclarar, quedan N[1] y quedan N[2]. Cuando el sombreador ya ha hundido
// las hojas que sobran, la malla del trozo pasa a dibujar solo las primeras (drawRange): la imagen es la misma, así que
// el cambio no se ve. JMIN: el ruido por mata (para que no se vea un anillo), que solo acerca: de JMIN a 1. SW: desde
// qué distancia (en JS, con la caja del trozo) se cambia de malla; sale de lo mismo para que no haya saltos.
// ?q=low aclara antes; ?hierba=0 (o =sinlod) las deja todas siempre (para comparar en el mismo código; el final suave
// sigue. Ver opciones.js)
export const TUFT_LOD = (() => {
  const k = opcion('q') === 'low' ? 0.75 : 1, G = apagada('hierba') ? [1e9, 1e9, 1e9] : [30 * k, 44 * k, 60 * k], JMIN = 0.92;
  return { N: [TUFT_N, 28, 10], G0: G[0], G1: G[1], G2: G[2], JMIN, WMAX: 3.2, SW: [G[1] / JMIN + 0.5, G[2] / JMIN + 0.5] };
})();
// Lo que mueve el sombreador de las matas desde fuera (World3D.updateGrass, cada fotograma): lodK, cuánto más pequeño se ve
// todo que con FOV 30; center y fade, el círculo (centro y de dónde a dónde) en el que la hierba se acaba poco a poco
export const GRASS = { lodK: { value: 1 }, center: { value: new THREE.Vector2() }, fade: { value: new THREE.Vector2(38, 47) } };
// Las mallas de la mata por nivel de detalle (las tres comparten los mismos búferes)
export const tuftLods = () => (GROUND ||= groundShapes()).tuft;
function tuftGeometry() {
  let a = 9001;
  const rnd = () => ((a = (a * 16807) % 2147483647) / 2147483647);
  const blades = [];
  for (let i = 0; i < TUFT_N; i++) {
    const bx = (rnd() - 0.5) * 1.12, bz = (rnd() - 0.5) * 1.12;
    const h = 0.08 + rnd() * 0.08 + rnd() * rnd() * 0.14, w = 0.01 + rnd() * 0.008, yaw = rnd() * Math.PI, lean = 0.25 + rnd() * 0.45, ld = rnd() * Math.PI * 2;
    const tone = 0.82 + rnd() * 0.3, ux = Math.cos(yaw), uz = Math.sin(yaw), dx = Math.cos(ld), dz = Math.sin(ld);
    // los puntos de la hoja a lo alto (t de 0 a 1): la anchura baja y se dobla cada vez más; aparte, lo que se aparta
    // de lado (side, lo que se ensancha de lejos)
    const at = (t, side) => { const bend = lean * h * t * t, ww = w * (1 - t) * side; return [bx + dx * bend + ux * ww, h * t, bz + dz * bend + uz * ww, ux * ww, uz * ww]; };
    const shade = t => (0.38 + 0.72 * t) * tone;
    const T = [0, 0.55, 1], B = { pos: [], col: [], sway: [], side: [], bx, bz, h };
    for (let k = 0; k < 2; k++) {
      const t0 = T[k], t1 = T[k + 1], a0 = at(t0, -1), b0 = at(t0, 1), a1 = at(t1, -1), b1 = at(t1, 1);
      const tri = k === 1 ? [a0, b0, a1] : [a0, b0, b1, a0, b1, a1];
      const ts = k === 1 ? [t0, t0, t1] : [t0, t0, t1, t0, t1, t1];
      tri.forEach((p, j) => { B.pos.push(p[0], p[1], p[2]); const c = shade(ts[j]); B.col.push(c, c, c); B.sway.push(p[1]); B.side.push(p[3], p[4]); });
    }
    blades.push(B);
  }
  // El orden: cada vez, la hoja más lejos de las ya puestas (las de dentro de la casilla y las altas valen más), así que
  // cualquier principio de la lista queda bien repartido por la casilla
  const order = [], used = new Array(TUFT_N).fill(false), dmin = new Array(TUFT_N).fill(Infinity);
  for (let r = 0; r < TUFT_N; r++) {
    let best = -1, bs = -1;
    for (let i = 0; i < TUFT_N; i++) if (!used[i]) {
      const B = blades[i], inside = Math.max(Math.abs(B.bx), Math.abs(B.bz)) < 0.5 ? 1 : 0.55;
      const sc = (r ? Math.min(dmin[i], 0.5) : 1) * inside * (0.75 + B.h / 0.6);
      if (sc > bs) { bs = sc; best = i; }
    }
    used[best] = true; order.push(best);
    for (let i = 0; i < TUFT_N; i++) dmin[i] = Math.min(dmin[i], Math.hypot(blades[i].bx - blades[best].bx, blades[i].bz - blades[best].bz));
  }
  const pos = [], col = [], sway = [], side = [], blade = [];
  order.forEach((bi, rank) => {
    const B = blades[bi];
    pos.push(...B.pos); col.push(...B.col); sway.push(...B.sway); side.push(...B.side);
    for (let v = 0; v < 9; v++) blade.push(rank, B.bx, B.bz, B.h);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('sway', new THREE.Float32BufferAttribute(sway, 1));
  g.setAttribute('blade', new THREE.Float32BufferAttribute(blade, 4));   // (su puesto en la lista y su raíz: x, z y alto)
  g.setAttribute('bside', new THREE.Float32BufferAttribute(side, 2));    // (lo que se aparta de lado cada punto)
  const nor = new Float32Array(pos.length); for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.computeBoundingSphere(); g.computeBoundingBox();
  // (hasta dónde llega la mata, para la caja de cada trozo: lo más apartado de su centro, con lo que se ensancha de lejos
  // y lo que la mueve el viento, como en el sombreador; y lo más alto, antes de su altura)
  let far = 0, sd = 0, top = 0, sw = 0;
  for (let i = 0; i < pos.length; i += 3) { far = Math.max(far, Math.hypot(pos[i], pos[i + 2])); top = Math.max(top, pos[i + 1]); }
  for (let i = 0; i < side.length; i += 2) sd = Math.max(sd, Math.hypot(side[i], side[i + 1]));
  for (const v of sway) sw = Math.max(sw, v);
  g.userData.reach = far + sd * (TUFT_LOD.WMAX - 1) + 0.9 * 0.35 * Math.hypot(1, 0.5) * sw;
  g.userData.top = top;
  // (los otros niveles, con los mismos atributos: no se copia nada ni se sube otra vez a la gráfica; solo dibujan menos)
  return TUFT_LOD.N.map((n, k) => {
    if (!k) return g;
    const l = new THREE.BufferGeometry();
    for (const [name, at] of Object.entries(g.attributes)) l.setAttribute(name, at);
    l.setDrawRange(0, n * 9);
    l.boundingSphere = g.boundingSphere; l.boundingBox = g.boundingBox;
    return l;
  });
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
  const L = TUFT_LOD, f1 = (L.N[1] / L.N[0]).toFixed(5), f2 = (L.N[2] / L.N[0]).toFixed(5), F = v => v.toFixed(2);
  const inv = v => (1 / Math.max(v, 1e-3)).toFixed(5);   // (con ?hierba=0 los tramos miden 0: sin dividir por 0)
  // Las matas, antes del viento: cuántas hojas quedan a esta distancia (f, de 1 a N[2]/N[0]) y el final suave (fo, de 1 a
  // 0 en el círculo de GRASS.fade); cada hoja se hunde en su raíz cuando le toca (gk, una rampa de 2,5 puestos que acaba
  // en gn) y las que quedan se ensanchan (wmul). De cerca (de < G0), gn pasa de N[0] en lo que mide la rampa, así que
  // salen todas enteras, y wmul = 1: la mata de siempre. Ese margen se va hasta G1, donde gn es justo N[1] (y luego N[2]):
  // ahí se cambia de malla y las que se dejan de dibujar ya están hundidas. jit, un ruido estable por mata, solo acerca
  const LOD = `
        vec3 ip = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec3 hq = fract(ip.xzx * 0.1031); hq += dot(hq, hq.yzx + 33.33);
        float jit = fract((hq.x + hq.y) * hq.z);
        float de = distance(cameraPosition, ip) * grassLodK * (${F(L.JMIN)} + ${F(1 - L.JMIN)} * jit);
        float f = de < ${F(L.G0)} ? 1.0 : de < ${F(L.G1)} ? mix(1.0, ${f1}, (de - ${F(L.G0)}) * ${inv(L.G1 - L.G0)}) : mix(${f1}, ${f2}, clamp((de - ${F(L.G1)}) * ${inv(L.G2 - L.G1)}, 0.0, 1.0));
        float fo = 1.0 - smoothstep(grassFade.x, grassFade.y, length(ip.xz - grassCenter));
        float gn = fo * (f * ${L.N[0].toFixed(1)} + 2.5 * (1.0 - clamp((de - ${F(L.G0)}) * ${inv(L.G1 - L.G0)}, 0.0, 1.0)));
        float gk = clamp((gn - blade.x) / 2.5, 0.0, 1.0) * mix(0.4, 1.0, fo);
        float wmul = min(${F(L.WMAX)}, 1.0 / max(f, 0.05));
        vec3 sv = vec3(bside.x, 0.0, bside.y), root = vec3(blade.y, 0.0, blade.z);
        transformed = root + (transformed - sv - root) * gk + sv * (gk * wmul);`;
  const wind = (m, key, inst) => {
    m.onBeforeCompile = (sh, r) => {
      sh.uniforms.windTime = WIND;
      if (inst) { sh.uniforms.grassLodK = GRASS.lodK; sh.uniforms.grassCenter = GRASS.center; sh.uniforms.grassFade = GRASS.fade; }
      // (con instancias, la fase del viento sale del sitio de cada mata)
      const at = inst ? 'vec3 wp = (instanceMatrix * vec4(position, 1.0)).xyz;' : 'vec3 wp = position;';
      const head = '#include <common>\nuniform float windTime;\nattribute float sway;' + (inst ? '\nattribute vec4 blade;\nattribute vec2 bside;\nuniform float grassLodK;\nuniform vec2 grassCenter;\nuniform vec2 grassFade;' : '');
      sh.vertexShader = sh.vertexShader.replace('#include <common>', head).replace('#include <begin_vertex>', `#include <begin_vertex>
        ${inst ? LOD : ''}
        ${at}
        float s = sin(windTime * 1.6 + wp.x * 0.35 + wp.z * 0.25) * 0.6 + sin(windTime * 2.9 + wp.x * 0.9 - wp.z * 0.4) * 0.3;
        transformed.xz += vec2(s, s * 0.5) * ${inst ? '0.35' : '0.3'} * sway${inst ? ' * gk' : ''};`);
      // (las matas, por las dos caras con la luz de arriba: la cara de atrás no da la vuelta a la normal)
      if (inst) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;'));
      // (la misma sombra de contacto que el suelo de debajo, leída en el vértice: ver contact3d.js)
      injectContact(sh, r, inst ? 'vertInst' : 'vert');
    };
    m.customProgramCacheKey = () => contactKey(key);
    return m;
  };
  const m = wind(mat({ vertexColors: true, roughness: 0.95 }), 'groundcover', false);
  const tuftMat = wind(mat({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }), 'grasstuft-lod', true);
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
      const { k, R, Ry, cy } = broadDims(o, y), P = o.kind === 'swampTree' ? SAUCE[season] : HOJAS[season], tint = leafTint(o, season), pal = P.c.map(c => leafC(c, 0.85, tint));
      trunks.push({ p: [x, (y + cy) / 2, z], s: [1.5 * k, cy - y, 1.5 * k] });
      if (season < 3) {   // (en invierno, en ramas: también el sauce, que de cerca y en el impostor son ramillas peladas)
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
      const k = cactusK(o);
      trunks.push({ p: [x, y + 1.1 * k, z], s: [1.2, 2.2 * k, 1.2] });
    } else if (o.kind === 'boulder' || o.kind === 'snowBoulder') rocks.push({ p: [x, y + 0.25, z], s: [0.9 * s, 0.55 * s, 0.75 * s], r: [0, rot, 0], c: '#9a958c' });
  }
  const group = new THREE.Group();
  for (const [geo, m, list] of [[GEO.trunk, M.bark, trunks], [GEO.lump, M.leaf, lumps], [GEO.cone, M.leaf, cones], [GEO.rock, M.rock, rocks], [GEO.cone, M.snow, snow]]) if (list.length) group.add(instanced(geo, m, list, { cast: false, receive: false }));
  return group;
}
