// Personas en 3D: chibis de pocos polígonos a partir de los "look" del juego (sexo, peinado, colores de pelo,
// piel y ojos, y la forma de los ojos, las cejas, la nariz, las orejas, la barba y los mofletes) y de la ropa
// que llevan puesta (look.wear, por hueco del cuerpo; si no lo trae, la que corresponde a su tipo de ropa).
// Lo que no se cubre con ropa es piel: sin nada, un muñeco liso. Cabeza grande, cuerpo pequeño y animación de andar (piernas y brazos que se balancean, un leve
// bote) y de respirar en reposo. Mira hacia z+.
import * as THREE from 'three';
import { mat } from './geo.js';
import { fullLook, clothesFor } from '../looks.js';
import { faceMaterials, CLOSED } from './face.js';

// Una superficie abierta (un trozo de cilindro: delantal, peto) con las dos caras, para que se vea también por dentro
function twoSided(geo) {
  const g = geo.toNonIndexed(), p = g.attributes.position.array, n = g.attributes.normal.array, t = g.attributes.uv?.array;
  const P = new Float32Array(p.length * 2), N = new Float32Array(n.length * 2), U = t ? new Float32Array(t.length * 2) : null;
  P.set(p); N.set(n); if (U) U.set(t);
  for (let i = 0; i < p.length; i += 9) for (let v = 0; v < 3; v++) {
    const from = i + (2 - v) * 3, to = p.length + i + v * 3;   // el mismo triángulo al revés
    for (let k = 0; k < 3; k++) { P[to + k] = p[from + k]; N[to + k] = -n[from + k]; }
    if (U) { const f2 = (i / 3 + (2 - v)) * 2, t2 = t.length + (i / 3 + v) * 2; U[t2] = t[f2]; U[t2 + 1] = t[f2 + 1]; }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  if (U) out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  return out;
}

export const G = {
  head: headGeo(), eye: new THREE.SphereGeometry(1, 16, 12), ball: new THREE.SphereGeometry(1, 18, 14),
  limb: new THREE.CapsuleGeometry(0.055, 0.2, 4, 8), leg: new THREE.CapsuleGeometry(0.07, 0.16, 4, 8), boot: new THREE.SphereGeometry(1, 16, 12),
  // El cuerpo con forma: tronco (caderas, cintura, pecho y hombros), brazos y piernas en dos partes (codo y rodilla)
  torso: torsoGeo(), upper: new THREE.CapsuleGeometry(0.056, 0.08, 6, 12), fore: new THREE.CapsuleGeometry(0.05, 0.07, 6, 12),
  thigh: new THREE.CapsuleGeometry(0.072, 0.06, 6, 12), shin: new THREE.CapsuleGeometry(0.064, 0.06, 6, 12),
  smile: new THREE.TorusGeometry(1, 0.22, 6, 18, Math.PI * 0.7).rotateZ(Math.PI * 1.15),        // la boca: un arco que sonríe
  collar: new THREE.TorusGeometry(1, 0.28, 8, 24),
  pleats: pleated(new THREE.CylinderGeometry(1, 1.32, 1, 56, 4), 14, 0.05),                  // falda de pliegues
  vest: twoSided(vestGeo()),                                                               // chaleco: el tronco, abierto delante
  cone: new THREE.ConeGeometry(1, 1, 10), cyl: new THREE.CylinderGeometry(1, 1, 1, 14), box: new THREE.BoxGeometry(1, 1, 1),
  skirt: new THREE.CylinderGeometry(1, 1.32, 1, 20),                                         // falda de túnica (cerrada)
  bib: twoSided(new THREE.CylinderGeometry(1, 1, 1, 12, 1, true, -0.75, 1.5)),              // peto del delantal
  apron: twoSided(new THREE.CylinderGeometry(1, 1.28, 1, 14, 1, true, -1, 2)),             // falda del delantal
  arch: new THREE.TorusGeometry(1, 0.17, 6, 14, Math.PI * 0.8).rotateZ(Math.PI * 0.1),      // ceja arqueada
  ...hijabGeo(),                                                                             // el hiyab, su borde y lo que cae sobre los hombros
};
// Pliegues: el radio ondula alrededor (n ondas), más hacia abajo
function pleated(g, n, k) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x), t = 0.5 - y, r = 1 + k * Math.sin(a * n) * (0.25 + 0.75 * t);
    p.setXYZ(i, x * r, y, z * r);
  }
  g.computeVertexNormals();
  return g;
}
// El chaleco: el perfil del tronco algo más ancho, de las caderas a los hombros, con la abertura delante
function vestGeo() {
  const pts = [[0.174, 0.02], [0.178, 0.06], [0.169, 0.12], [0.16, 0.18], [0.166, 0.26], [0.176, 0.33], [0.174, 0.385], [0.15, 0.415]];
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 28, 0.42, Math.PI * 2 - 0.84);
  g.scale(1, 1, 0.8);
  return g;
}
// La cabeza: una esfera algo achatada, con la mandíbula un poco más estrecha que los mofletes y la barbilla
// redondeada hacia delante
function headGeo() {
  const g = new THREE.SphereGeometry(0.29, 40, 30), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), low = Math.max(0, -y / 0.29);
    p.setXYZ(i, x * (1 - 0.13 * low * low), y, z + (z > 0 ? 0.012 * low * low : 0));
  }
  g.computeVertexNormals();
  return g;
}
// El tronco: un perfil (caderas, cintura algo más estrecha, pecho y hombros redondeados) que se gira, aplastado
// de delante atrás. Ocupa lo mismo que el cilindro de antes (la ropa se apoya en él)
function torsoGeo() {
  const pts = [[0.001, 0], [0.166, 0.0], [0.172, 0.05], [0.163, 0.12], [0.154, 0.18], [0.16, 0.26], [0.17, 0.33], [0.168, 0.39], [0.135, 0.43], [0.07, 0.455], [0.001, 0.46]];
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 28);
  g.scale(1, 1, 0.765);
  return g;
}
// El hiyab: una esfera algo mayor que la cabeza con un agujero redondo delante, para la cara (el polo de la
// esfera mira hacia delante y un poco hacia abajo), y un dobladillo alrededor
function hijabGeo() {
  const R = 0.312, open = 0.72, down = 0.12;
  const hijab = new THREE.SphereGeometry(R, 40, 30, 0, Math.PI * 2, open, Math.PI - open).rotateX(Math.PI / 2 + down);
  const hem = new THREE.TorusGeometry(R * Math.sin(open), 0.014, 6, 40).translate(0, 0, R * Math.cos(open)).rotateX(down);
  return { hijab, hem, drape: pleated(new THREE.CylinderGeometry(0.62, 1, 1, 40, 2), 9, 0.035) };
}
const cache = new Map();
export const M = (c, o = {}) => { const k = c + JSON.stringify(o); if (!cache.has(k)) cache.set(k, mat({ color: c, roughness: 0.75, ...o })); return cache.get(k); };
const shade = (c, k) => '#' + new THREE.Color(c).multiplyScalar(k).getHexString();
const mix = (a, b, k) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();

export function mesh(geo, m, { p = [0, 0, 0], s = [1, 1, 1], r = [0, 0, 0] } = {}, parent) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(...p); o.scale.set(...(typeof s === 'number' ? [s, s, s] : s)); o.rotation.set(...r);
  o.castShadow = true;
  parent?.add(o);
  return o;
}
// Una tira (cilindro fino) de un punto a otro
const UP = new THREE.Vector3(0, 1, 0);
function strap(m, a, b, r, parent) {
  const A = new THREE.Vector3(...a), d = new THREE.Vector3(...b).sub(A), o = mesh(G.cyl, m, { p: A.addScaledVector(d, 0.5).toArray(), s: [r, d.length(), r] }, parent);
  o.quaternion.setFromUnitVectors(UP, d.normalize());
  return o;
}
// Un mechón de punta: un cono que sale de p hacia dir, de largo len y grueso r en la base
function spike(m, p, dir, len, r, parent) {
  const d = new THREE.Vector3(...dir).normalize(), o = mesh(G.cone, m, { p: new THREE.Vector3(...p).addScaledVector(d, len / 2).toArray(), s: [r, len, r] }, parent);
  o.quaternion.setFromUnitVectors(UP, d);
  return o;
}

// Junta las mallas hijas directas de un grupo en una (posición, normal y color de su material). Lo que lleva
// dibujo de tela se junta aparte, una malla por tela y color, con sus coordenadas de textura. A todo, un poco
// de sombra en lo que mira hacia abajo (como la luz que rebota del suelo)
const SKIN = mat({ vertexColors: true, roughness: 0.7 }), SHADED = new Map();
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
const WHITE_C = new THREE.Color(1, 1, 1);
const SKIRT = { tilt: 0.42, wide: 0.1, deep: 0.5 };   // lo que se adelanta y se abre una falda con los muslos en alto

// Telas: dibujos en gris que se tiñen con el color de la prenda. weave: tejido de algodón; knit: punto de lana;
// leather: cuero; straw: paja trenzada; denim: sarga de vaquero. FAB(tela, color): su material
const FABRICS = {}, FAB_MATS = new Map();
const fhash = (x, y) => { const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return h - Math.floor(h); };
function fabric(kind) {
  if (FABRICS[kind]) return FABRICS[kind];
  const S = 64, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = fhash(x, y);
    let v;
    if (kind === 'weave') v = 0.8 + 0.14 * (((x >> 1) + (y >> 1)) % 2) + 0.06 * n - (y % 16 === 0 ? 0.06 : 0);
    else if (kind === 'knit') { const u = x % 8, w = (y % 8) / 8, vshape = Math.abs(Math.abs(u - 3.5) - (1 - w) * 3.5); v = 0.62 + 0.34 * Math.max(0, 1 - vshape / 1.6) + 0.04 * n; }
    else if (kind === 'leather') v = 0.76 + 0.18 * fhash(x >> 2, y >> 2) + 0.06 * n - ((x % 32 === 0 || y % 32 === 31) ? 0.14 : 0);
    else if (kind === 'straw') { const band = ((x + ((y >> 2) % 2) * 3) % 6) < 4; v = (band ? 0.92 : 0.7) + 0.08 * n - (y % 4 === 0 ? 0.1 : 0); }
    else v = 0.72 + 0.2 * (((x + y) % 4) < 2 ? 1 : 0) + 0.08 * n;   // denim
    d.set([v * 255, v * 255, v * 255, 255], (y * S + x) * 4);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  t.repeat.set(...{ weave: [4, 4], knit: [4, 4], leather: [2, 2], straw: [5, 3], denim: [4, 4] }[kind]);
  return (FABRICS[kind] = t);
}
export const FAB = (kind, color) => { const k = kind + color; if (!FAB_MATS.has(k)) FAB_MATS.set(k, mat({ map: fabric(kind), color, roughness: kind === 'leather' ? 0.55 : 0.92 })); return FAB_MATS.get(k); };
// La tela de cada prenda
const CLOTH_OF = { camisa: 'weave', tunica: 'weave', tunica_larga: 'weave', chaleco: 'knit', delantal: 'weave', pantalon: 'denim', falda: 'weave', botas: 'leather', camiseta_interior: 'weave', calzoncillos: 'weave', bragas: 'weave', calcetines: 'knit', sombrero: 'straw', gorro: 'knit', hijab: 'weave', mochila: 'leather' };
// Las armaduras (casco, peto, grebas y botas de metal): con las formas de la ropa, pero de metal y con brillo
const ARMOR = /^(casco|peto|grebas|botas)_(cobre|hierro|oro)$/, isArmor = it => !!it && ARMOR.test(it.id);
const METAL = c => M(c, { metalness: 0.7, roughness: 0.32 });
const cloth = it => (it ? (isArmor(it) ? METAL(it.color) : CLOTH_OF[it.id] ? FAB(CLOTH_OF[it.id], it.color) : M(it.color)) : null);
const clothShade = (it, k) => (isArmor(it) ? METAL(shade(it.color, k)) : CLOTH_OF[it.id] ? FAB(CLOTH_OF[it.id], shade(it.color, k)) : M(shade(it.color, k)));

// La cara de la cabeza (esfera de radio 0.29 algo achatada): z de la superficie en (x, y), para apoyar en ella
// ojos, cejas, nariz, mofletes y barba. F(x, y, d): ese punto, d por delante de la superficie.
const HR = [0.29, 0.29 * 0.96, 0.29 * 0.96];
const F = (x, y, d = 0) => [x, y, HR[2] * Math.sqrt(Math.max(0, 1 - (x / HR[0]) ** 2 - (y / HR[1]) ** 2)) + d];

// Un bebé en su cuna: envuelto en una mantita, boca arriba, con los ojos cerrados y un mechón de pelo
export function babyModel(look) {
  const L = fullLook(look), root = new THREE.Group(), skin = M(L.skin), ink = M('#2a1a1a');
  mesh(G.ball, M('#f4e6c8', { roughness: 0.95 }), { p: [0, 0.06, 0.06], s: [0.12, 0.085, 0.19] }, root);
  mesh(G.ball, M('#e88aa8', { roughness: 0.95 }), { p: [0, 0.07, 0.13], s: [0.125, 0.07, 0.11] }, root);   // (la mantita)
  mesh(G.ball, skin, { p: [0, 0.09, -0.13], s: [0.105, 0.1, 0.105] }, root);
  for (const s of [-1, 1]) {
    mesh(G.box, ink, { p: [s * 0.036, 0.188, -0.135], s: [0.034, 0.007, 0.01], r: [0, 0, s * 0.15] }, root);   // ojos cerrados
    mesh(G.ball, M('#ff8a96'), { p: [s * 0.062, 0.17, -0.105], s: [0.022, 0.01, 0.018] }, root);                 // mofletes
  }
  mesh(G.ball, M(shade(L.skin, 0.88)), { p: [0, 0.188, -0.1], s: [0.014, 0.008, 0.01] }, root);                 // boca
  mesh(G.ball, M(L.hair, { roughness: 0.6 }), { p: [0, 0.15, -0.2], s: [0.07, 0.05, 0.045] }, root);             // mechón
  mergeInto(root);
  return root;
}

export class Person3D {
  constructor(look, name = '') {
    this.look = look; this.name = name;
    this.root = new THREE.Group();
    this.body = new THREE.Group(); this.body.name = 'body'; this.root.add(this.body);
    this.phase = Math.random() * 6; this.speed = 0; this.targetYaw = 0;
    const L = fullLook(look), W = look.wear || clothesFor(L), skin = M(L.skin), hair = M(L.hair, { roughness: 0.6 });
    const shirt = cloth(W.torso), under = cloth(W.interiorArriba);
    this.bellyMat = (W.encima?.id === 'delantal' && cloth(W.encima)) || shirt || under || skin;   // (la barriga va del color de lo que la cubre)
    const pants = W.piernas?.id === 'pantalon' || W.piernas?.id?.startsWith('grebas_') ? cloth(W.piernas) : null;   // (las grebas, como un pantalón de metal)
    // Con la túnica larga las piernas se mueven menos (si no, asomarían por la falda)
    this.legSwing = W.torso?.id === 'tunica_larga' ? 0.5 : 1;
    // Piernas (con pantalón o piel) y pies (con botas, con calcetines o descalzos). Sin pantalón, los
    // calcetines se ven subiendo por la pierna hasta media espinilla, con el puño algo más oscuro.
    const socks = W.calcetines && W.calcetines.color;
    this.shins = [];
    this.legs = [-1, 1].map(s => {
      const hip = new THREE.Group(); hip.name = s < 0 ? 'legL' : 'legR'; hip.position.set(s * 0.085, 0.36, 0); this.body.add(hip);
      mesh(G.thigh, pants || skin, { p: [0, -0.07, 0] }, hip);
      const knee = new THREE.Group(); knee.name = s < 0 ? 'shinL' : 'shinR'; knee.position.y = -0.15; hip.add(knee); this.shins.push(knee);
      mesh(G.shin, pants || skin, { p: [0, -0.055, 0] }, knee);
      if (pants) mesh(G.cyl, clothShade(W.piernas, 0.85), { p: [0, -0.13, 0], s: [0.068, 0.02, 0.068] }, knee);   // el bajo
      if (socks && !pants) {
        mesh(G.cyl, FAB('knit', socks), { p: [0, -0.07, 0], s: [0.068, 0.12, 0.068] }, knee);
        mesh(G.cyl, FAB('knit', shade(socks, 0.82)), { p: [0, -0.013, 0], s: [0.071, 0.022, 0.071] }, knee);
      }
      if (W.pies) {   // botas: caña, pie y suela, con la puntera algo más clara
        const c = W.pies.color, lace = M(shade(c, 0.55)), hide = isArmor(W.pies) ? METAL : col => FAB('leather', col);   // (las de armadura, de metal)
        mesh(G.cyl, hide(c), { p: [0, -0.1, 0], s: [0.07, 0.11, 0.07] }, knee);
        mesh(G.cyl, hide(shade(c, 0.8)), { p: [0, -0.045, 0], s: [0.073, 0.02, 0.073] }, knee);
        mesh(G.boot, hide(c), { p: [0, -0.16, 0.03], s: [0.08, 0.055, 0.12] }, knee);
        mesh(G.boot, hide(mix(c, '#ffffff', 0.12)), { p: [0, -0.158, 0.1], s: [0.06, 0.04, 0.05] }, knee);
        mesh(G.boot, M('#2a1c14'), { p: [0, -0.205, 0.028], s: [0.083, 0.018, 0.124] }, knee);
        for (const y of [-0.07, -0.1, -0.13]) mesh(G.box, lace, { p: [0, y, 0.068], s: [0.05, 0.007, 0.006], r: [0.2, 0, 0] }, knee);   // los cordones
      } else if (socks) mesh(G.boot, M(socks), { p: [0, -0.163, 0.025], s: [0.067, 0.049, 0.1] }, knee);
      else { mesh(G.boot, skin, { p: [0, -0.165, 0.025], s: [0.062, 0.045, 0.095] }, knee); for (let t = -1; t <= 1; t++) mesh(G.ball, skin, { p: [t * 0.022, -0.17, 0.112], s: 0.016 }, knee); }
      return hip;
    });
    // Tronco (con camisa o túnica, camiseta interior o piel) y lo que va encima
    const torso = new THREE.Group(); torso.name = 'torso'; torso.position.y = 0.36; this.body.add(torso); this.torso = torso;
    mesh(G.torso, shirt || under || skin, {}, torso);
    mesh(G.ball, shirt || under || skin, { p: [0, 0.39, 0], s: [0.186, 0.07, 0.13] }, torso);                // hombros
    mesh(G.cyl, skin, { p: [0, 0.47, 0], s: [0.055, 0.06, 0.052] }, torso);                                 // cuello
    if (W.torso) {
      mesh(G.collar, clothShade(W.torso, 0.82), { p: [0, 0.44, 0.004], s: [0.07, 0.065, 0.07], r: [Math.PI / 2 - 0.18, 0, 0] }, torso);   // el cuello de la ropa
      if (W.torso.id === 'camisa' && !W.encima) mesh(G.box, clothShade(W.torso, 0.9), { p: [-0.075, 0.3, 0.125], s: [0.055, 0.05, 0.012], r: [-0.12, 0, 0] }, torso);   // el bolsillo
      if (W.torso.id === 'camisa' && !W.encima) for (const y of [0.34, 0.25, 0.16]) mesh(G.ball, M(shade(W.torso.color, 0.6)), { p: [0, y, 0.123 + (y > 0.3 ? 0.004 : 0)], s: [0.012, 0.012, 0.008] }, torso);
    }
    this.outfit(torso, L, W);
    // Brazos, con manga (o piel) y mano
    this.fore = [];
    this.arms = [-1, 1].map(s => {
      const sh = new THREE.Group(); sh.name = s < 0 ? 'armL' : 'armR'; sh.position.set(s * 0.21, 0.38, 0); torso.add(sh);
      sh.rotation.z = 0;
      mesh(G.upper, shirt || skin, { p: [s * 0.006, -0.06, 0], r: [0, 0, s * 0.1] }, sh);
      const el = new THREE.Group(); el.name = s < 0 ? 'foreL' : 'foreR'; el.position.set(s * 0.014, -0.13, 0); sh.add(el); this.fore.push(el);
      mesh(G.fore, shirt || skin, { p: [s * 0.006, -0.06, 0], r: [0, 0, s * 0.06] }, el);
      if (shirt) mesh(G.cyl, clothShade(W.torso, 0.82), { p: [s * 0.011, -0.118, 0], s: [0.054, 0.02, 0.054] }, el);   // el puño
      mesh(G.ball, skin, { p: [s * 0.014, -0.155, 0], s: [0.05, 0.058, 0.045] }, el);                            // la mano
      mesh(G.ball, skin, { p: [s * 0.004, -0.14, 0.038], s: [0.019, 0.026, 0.019], r: [0.4, 0, 0] }, el);        // el pulgar
      return sh;
    });
    // Cabeza: cara, ojos, cejas, nariz, boca, orejas, mofletes, barba y pelo
    const head = new THREE.Group(); head.name = 'head'; head.position.y = 0.43 + 0.28; torso.add(head); this.head = head;
    // La cabeza, con la cara pintada (ojos, cejas, boca y colorete); aparte, porque lleva su dibujo
    this.faceOpen = faceMaterials(L);
    this.faceMesh = mesh(G.head, this.faceOpen, { s: [1, 0.96, 0.96] }, head);
    this.faceMesh.name = 'face'; this.faceMesh.userData.keep = true;
    const covered = W.cabeza?.id === 'hijab';   // (el hiyab tapa el pelo y las orejas)
    this.face(head, L, skin, hair, covered);
    if (!covered) this.hair(head, L, hair);
    this.headwear(head, W.cabeza, torso);
    if (W.pelo && !W.cabeza) this.hairAcc(head, W.pelo);
    // Cada parte que se mueve junta (piernas, rodillas, brazos, codos, tronco, cabeza y ojos) en una sola malla
    // con colores por vértice
    this.skirt = torso.getObjectByName('skirt') || null;
    for (const grp of [...this.legs, ...this.shins, ...this.arms, ...this.fore, torso, head, ...(this.skirt ? [this.skirt] : [])]) mergeInto(grp);
    this.blink = 2 + Math.random() * 3;
    this.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  }

  // Lo que se lleva en el tronco y las caderas: túnica (corta o larga, con cinturón), pantalón, falda o la
  // ropa interior que quede a la vista; encima, delantal o chaleco; y a la espalda, la mochila
  outfit(torso, L, W) {
    const top = W.torso?.id, legs = W.piernas?.id, tunic = top === 'tunica' || top === 'tunica_larga';
    // Lo que cuelga de la cintura va aparte, para que se abra cuando las piernas suben (ver fitSkirt)
    const skirt = new THREE.Group(); skirt.name = 'skirt';
    if (tunic) {
      // Falda acampanada desde la cintura: por las caderas (corta) o casi hasta los tobillos (larga), con ribete
      const c = W.torso.color, [h, y] = top === 'tunica_larga' ? [0.42, -0.08] : [0.26, 0];
      mesh(G.pleats, cloth(W.torso), { p: [0, y, 0], s: [0.178, h, 0.138] }, skirt);
      mesh(G.cyl, clothShade(W.torso, 0.7), { p: [0, y - h / 2 + 0.012, 0], s: [0.178 * 1.37 + 0.004, 0.024, 0.138 * 1.37 + 0.004] }, skirt);
      mesh(G.cyl, M('#5a3a22'), { p: [0, 0.12, 0], s: [0.184, 0.04, 0.144] }, torso);                                         // cinturón
      mesh(G.cyl, M('#e8c050', { metalness: 0.5, roughness: 0.4 }), { p: [0, 0.12, 0.146], s: [0.03, 0.045, 0.012], r: [Math.PI / 2, 0, 0] }, torso);
    }
    if ((legs === 'pantalon' || legs?.startsWith('grebas_')) && top !== 'tunica_larga') {   // la cintura del pantalón y, si no lo tapa una túnica, el cinturón con su hebilla
      mesh(G.cyl, cloth(W.piernas), { p: [0, 0.02, 0], s: [0.175, 0.08, 0.135] }, torso);
      if (!tunic) { mesh(G.cyl, FAB('leather', '#3a2618'), { p: [0, 0.055, 0], s: [0.178, 0.026, 0.138] }, torso); mesh(G.box, M('#d8b048', { metalness: 0.6, roughness: 0.35 }), { p: [0, 0.055, 0.138], s: [0.038, 0.03, 0.008] }, torso); }
    }
    if (legs === 'falda' && top !== 'tunica_larga') {
      mesh(G.pleats, cloth(W.piernas), { p: [0, -0.04, 0], s: [0.179, 0.24, 0.139] }, skirt);
      mesh(G.cyl, clothShade(W.piernas, 0.75), { p: [0, 0.075, 0], s: [0.184, 0.03, 0.144] }, torso);
    }
    // Sin nada por debajo de la cintura, se ve la ropa interior (o nada: piel)
    if (!legs && !tunic && W.interiorAbajo) {
      mesh(G.cyl, cloth(W.interiorAbajo), { p: [0, 0.0, 0], s: [0.176, 0.09, 0.136] }, torso);
      mesh(G.cyl, clothShade(W.interiorAbajo, 0.85), { p: [0, 0.045, 0], s: [0.178, 0.014, 0.138] }, torso);   // elástico
    }
    const over = W.encima?.id;
    if (over === 'delantal') {
      const apron = cloth(W.encima), tie = clothShade(W.encima, 0.88);
      mesh(G.bib, apron, { p: [0, 0.27, 0], s: [0.182, 0.17, 0.142] }, torso);                  // peto
      mesh(G.apron, apron, { p: [0, 0, 0], s: [0.182, 0.24, 0.142] }, skirt);                   // falda
      mesh(G.cyl, tie, { p: [0, 0.125, 0], s: [0.186, 0.026, 0.146] }, torso);                  // cinta de la cintura
      for (const s of [-1, 1]) {
        strap(tie, [s * 0.12, 0.35, 0.115], [s * 0.075, 0.43, 0.01], 0.012, torso);              // tirantes al cuello
        mesh(G.ball, tie, { p: [s * 0.035, 0.125, -0.15], s: [0.038, 0.022, 0.014], r: [0, 0, s * 0.45] }, torso);   // lazo
        strap(tie, [s * 0.01, 0.12, -0.15], [s * 0.03, 0.03, -0.155], 0.009, torso);
      }
      mesh(G.ball, tie, { p: [0, 0.125, -0.152], s: 0.014 }, torso);
      mesh(G.ball, M(shade(W.encima.color, 0.88)), { p: [0.06, -0.035, 0.164], s: [0.05, 0.035, 0.01] }, skirt);   // bolsillo
    }
    if (over?.startsWith('peto_')) {   // peto: cerrado, de metal, con una placa en el pecho y el borde de los hombros
      const plate = cloth(W.encima), edge = clothShade(W.encima, 0.75);
      mesh(G.vest, plate, {}, torso);
      mesh(G.box, plate, { p: [0, 0.23, 0.128], s: [0.17, 0.2, 0.02], r: [-0.1, 0, 0] }, torso);
      mesh(G.box, edge, { p: [0, 0.23, 0.14], s: [0.016, 0.19, 0.012], r: [-0.1, 0, 0] }, torso);
      for (const x of [-0.13, 0.13]) mesh(G.ball, edge, { p: [x, 0.37, 0], s: [0.07, 0.04, 0.09] }, torso);
    }
    if (over === 'chaleco') {   // ajustado al cuerpo y abierto delante, con botones a un lado y dos bolsillos
      const v = cloth(W.encima), dark = M(shade(W.encima.color, 0.55));
      mesh(G.vest, v, {}, torso);
      for (const y of [0.3, 0.22, 0.14]) mesh(G.ball, dark, { p: [-0.07, y, 0.131], s: [0.011, 0.011, 0.007] }, torso);
      for (const x of [-0.1, 0.1]) mesh(G.box, clothShade(W.encima, 0.8), { p: [x, 0.08, 0.13], s: [0.06, 0.012, 0.01], r: [-0.12, 0, 0] }, torso);
    }
    // Mochila: cuerpo, solapa, bolsillo y las dos correas por encima de los hombros
    if (skirt.children.length) torso.add(skirt);
    if (W.espalda) {
      const bag = FAB('leather', W.espalda.color), dark = FAB('leather', shade(W.espalda.color, 0.68));
      mesh(G.box, bag, { p: [0, 0.21, -0.195], s: [0.25, 0.3, 0.13] }, torso);
      mesh(G.box, dark, { p: [0, 0.32, -0.2], s: [0.26, 0.1, 0.14] }, torso);                   // solapa
      mesh(G.box, dark, { p: [0, 0.12, -0.265], s: [0.17, 0.11, 0.03] }, torso);                // bolsillo
      mesh(G.ball, M('#c8a048', { metalness: 0.5, roughness: 0.4 }), { p: [0, 0.29, -0.272], s: [0.018, 0.018, 0.01] }, torso);   // hebilla
      for (const s of [-1, 1]) {
        strap(dark, [s * 0.085, 0.36, -0.14], [s * 0.085, 0.43, 0.05], 0.016, torso);
        strap(dark, [s * 0.085, 0.43, 0.05], [s * 0.1, 0.2, 0.137], 0.016, torso);
      }
    }
  }

  // Accesorios del pelo: lazo, diadema, flor sobre la oreja, horquillas o corona de flores (encima del pelo)
  hairAcc(head, it) {
    const c = M(it.color, { roughness: 0.6 }), d = M(shade(it.color, 0.7)), l = M(mix(it.color, '#ffffff', 0.35)), gold = M('#f0c030');
    const flower = (x, y, z, r, rot = [0, 0, 0]) => {
      const f = new THREE.Group(); f.position.set(x, y, z); f.rotation.set(...rot); head.add(f);
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; mesh(G.ball, c, { p: [Math.cos(a) * r, Math.sin(a) * r, 0], s: [r * 0.75, r * 0.75, r * 0.4] }, f); }
      mesh(G.ball, gold, { s: [r * 0.55, r * 0.55, r * 0.5], p: [0, 0, r * 0.15] }, f);
      f.updateMatrixWorld(); for (const o of [...f.children]) { o.applyMatrix4(f.matrix); head.add(o); } head.remove(f);
    };
    if (it.id === 'lazo') {
      // (arriba, a un lado, algo adelantado: se ve de frente)
      for (const s of [-1, 1]) mesh(G.ball, c, { p: [0.17 + s * 0.065, 0.25, 0.02], s: [0.065, 0.05, 0.028], r: [0.2, 0.7, s * 0.5] }, head);
      mesh(G.ball, d, { p: [0.17, 0.25, 0.03], s: 0.028 }, head);
      for (const s of [-1, 1]) mesh(G.box, c, { p: [0.17 + s * 0.03, 0.19, 0.0], s: [0.02, 0.08, 0.008], r: [0.2, 0.7, s * 0.3] }, head);
    } else if (it.id === 'diadema') {
      mesh(new THREE.TorusGeometry(0.335, 0.02, 6, 30, Math.PI), c, { p: [0, 0.02, 0.0], r: [0.3, 0, 0] }, head);   // (por encima, algo hacia delante)
      mesh(new THREE.TorusGeometry(0.335, 0.008, 4, 30, Math.PI * 0.4), l, { p: [0, 0.02, 0.014], r: [0.3, 0, Math.PI * 0.3] }, head);
    } else if (it.id === 'flor_pelo') flower(0.25, 0.13, 0.1, 0.045, [0, 0.9, 0.3]);
    else if (it.id === 'horquillas') { for (const [y, a] of [[0.15, 0.4], [0.09, 0.25]]) { mesh(G.box, c, { p: [0.26, y, 0.12], s: [0.09, 0.016, 0.01], r: [0, 0.75, a] }, head); mesh(G.ball, l, { p: [0.285, y + 0.01, 0.09], s: 0.014 }, head); } }
    else if (it.id === 'corona_flores') {
      mesh(new THREE.TorusGeometry(0.27, 0.012, 5, 30), M('#4a9a3a'), { p: [0, 0.17, -0.02], r: [Math.PI / 2 + 0.2, 0, 0] }, head);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2, x = Math.sin(a) * 0.27, z = Math.cos(a) * 0.27 * 0.98 - 0.02, y = 0.17 + Math.cos(a) * 0.05; flower(x, y, z, 0.028, [0, a, 0]); }
    }
  }

  // Sombrero de paja (copa, cinta y ala ancha) o gorro de lana con vuelta y pompón
  headwear(head, it, torso) {
    if (!it) return;
    const c = cloth(it), d = clothShade(it, 0.72);
    if (it.id === 'sombrero') {
      mesh(G.cyl, c, { p: [0, 0.31, -0.02], s: [0.2, 0.13, 0.2], r: [-0.1, 0, 0] }, head);
      mesh(G.cyl, d, { p: [0, 0.265, -0.015], s: [0.205, 0.035, 0.205], r: [-0.1, 0, 0] }, head);
      mesh(G.cyl, c, { p: [0, 0.245, -0.01], s: [0.4, 0.016, 0.38], r: [-0.1, 0, 0] }, head);
    }
    if (it.id === 'gorro') {
      mesh(new THREE.SphereGeometry(0.29, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), c, { p: [0, 0.06, -0.02], s: 1.13, r: [-0.3, 0, 0] }, head);
      mesh(new THREE.TorusGeometry(0.33, 0.04, 6, 26), d, { p: [0, 0.06, -0.02], r: [Math.PI / 2 - 0.3, 0, 0] }, head);   // la vuelta, en el borde
      mesh(G.ball, M('#f4f0e8'), { p: [0, 0.4, -0.13], s: 0.065 }, head);
    }
    if (isArmor(it)) {   // casco: una cúpula de metal con su borde y la protección de la nariz
      mesh(new THREE.SphereGeometry(0.3, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), c, { p: [0, 0.05, -0.01], s: 1.1, r: [-0.25, 0, 0] }, head);
      mesh(new THREE.TorusGeometry(0.33, 0.03, 6, 26), d, { p: [0, 0.05, -0.01], r: [Math.PI / 2 - 0.25, 0, 0] }, head);
      mesh(G.box, d, { p: [0, 0.07, 0.3], s: [0.035, 0.13, 0.02] }, head);
    }
    if (it.id === 'hijab') {
      // Un pañuelo que envuelve la cabeza dejando un óvalo para la cara, y cae sobre el cuello y los hombros
      mesh(G.hijab, c, { p: [0, 0, 0.004] }, head);
      mesh(G.hem, d, { p: [0, 0, 0.004] }, head);
      mesh(G.drape, c, { p: [0, 0.49, -0.005], s: [0.27, 0.3, 0.22] }, torso);
      mesh(G.drape, d, { p: [0, 0.335, -0.005], s: [0.272, 0.012, 0.222] }, torso);   // el borde
    }
  }

  face(head, L, skin, hair, covered = false) {
    const eye = M(L.eyes, { roughness: 0.3 }), white = M('#ffffff', { roughness: 0.2 }), ink = M('#2a1a1a'), lid = M(shade(L.skin, 0.95));
    const noseM = M(shade(L.skin, 0.92));
    for (const s of [-1, 1]) {
      const x = s * 0.1;
      // Orejas
      const ear = { redondas: [0.035, 0.06, 0.045, 0.285], pequenas: [0.028, 0.045, 0.035, 0.282], grandes: [0.044, 0.084, 0.062, 0.29], elfo: [0.032, 0.055, 0.042, 0.285], soplillo: [0.018, 0.066, 0.056, 0.312] }[L.ears] || [0.035, 0.06, 0.045, 0.285];
      if (!covered) mesh(G.ball, skin, { p: [s * ear[3], -0.03, L.ears === 'soplillo' ? -0.01 : 0], s: ear.slice(0, 3), r: [0, L.ears === 'soplillo' ? s * 1.1 : 0, 0] }, head);
      if (!covered && L.ears !== 'soplillo') mesh(G.ball, M(shade(L.skin, 0.82)), { p: [s * (ear[3] + ear[0] * 0.72), -0.03, 0.006], s: [ear[0] * 0.4, ear[1] * 0.6, ear[2] * 0.55] }, head);
      if (L.ears === 'elfo' && !covered) mesh(G.cone, skin, { p: [s * 0.325, 0.05, -0.02], s: [0.03, 0.16, 0.036], r: [-0.25, 0, -s * 0.6] }, head);
      // Mofletes: una sola pieza redondeada con colorete, que abulta un poco
    }
    // Nariz
    const n = L.nose;
    if (n === 'respingona') mesh(G.ball, noseM, { p: F(0, -0.055, 0.012), s: [0.024, 0.02, 0.03], r: [-0.6, 0, 0] }, head);
    else if (n === 'larga') mesh(G.ball, noseM, { p: F(0, -0.065, 0.02), s: [0.026, 0.026, 0.056], r: [0.35, 0, 0] }, head);
    else if (n === 'ancha') mesh(G.ball, noseM, { p: F(0, -0.065, 0.01), s: [0.048, 0.024, 0.024] }, head);
    else if (n === 'puntiaguda') mesh(G.cone, noseM, { p: F(0, -0.052, 0.028), s: [0.026, 0.075, 0.026], r: [Math.PI / 2 + 0.3, 0, 0] }, head);
    else mesh(G.ball, noseM, { p: F(0, -0.06, 0.013), s: [0.028, 0.022, 0.02] }, head);
    // Boca
    // Barba
    const bd = L.beard, moustache = () => { for (const s of [-1, 1]) mesh(G.ball, hair, { p: F(s * 0.036, -0.098, 0.012), s: [0.046, 0.017, 0.02], r: [0, 0, -s * 0.25] }, head); };
    const goatee = () => { mesh(G.ball, hair, { p: F(0, -0.19, -0.012), s: [0.045, 0.05, 0.04] }, head); mesh(G.cone, hair, { p: F(0, -0.235, -0.025), s: [0.03, 0.05, 0.03], r: [Math.PI - 0.3, 0, 0] }, head); };
    if (bd === 'bigote') moustache();
    if (bd === 'perilla') goatee();
    if (bd === 'candado') { moustache(); goatee(); for (const s of [-1, 1]) strap(hair, F(s * 0.07, -0.11, 0.004), F(s * 0.035, -0.19, 0.008), 0.012, head); }
    if (bd === 'completa' || bd === 'larga') { mesh(G.ball, hair, { p: [0, -0.17, 0.12], s: [0.2, 0.13, 0.17] }, head); moustache(); }
    if (bd === 'larga') mesh(G.cone, hair, { p: [0, -0.36, 0.15], s: [0.15, 0.32, 0.1], r: [Math.PI + 0.12, 0, 0] }, head);
  }

  // Peinados: casquete y lo propio de cada uno
  hair(head, L, m) {
    const st = L.hairStyle;
    if (st === 'calvo') return;
    const shaved = st === 'cresta' || st === 'samurai';   // lados rapados: piel con un poco de sombra de pelo
    const cap = { rapado: 1.02, cresta: 1.02, tupe: 1.02, samurai: 1.02, pinchos: 1.06, mullet: 1.06, rastas: 1.07, afro: 1.12 }[st] || 1.08;
    // Casquete: media esfera inclinada hacia atrás, que deja la cara al aire (el tazón lleva el suyo)
    if (st !== 'tazon') {
      const capGeo = new THREE.SphereGeometry(0.29, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.55);
      mesh(capGeo, shaved ? M(mix(L.skin, '#2a1e18', 0.3)) : m, { p: [0, 0.03, -0.02], s: [cap, cap, cap], r: [-0.62, 0, 0] }, head);
    }
    // Un punto de la cabeza (az: 0 delante, en radianes alrededor; el: altura, 0 a la altura de los ojos) y
    // hacia fuera desde el centro
    const on = (az, el, R = 0.3) => [Math.sin(az) * Math.cos(el) * R, 0.03 + Math.sin(el) * R, Math.cos(az) * Math.cos(el) * R - 0.02];
    const out = (az, el, up = 0) => [Math.sin(az) * Math.cos(el), Math.sin(el) + up, Math.cos(az) * Math.cos(el)];
    const ribbon = M('#e86aa0'), gold = M('#e8c050');
    // Lo de casi todos: flequillo, volumen a los lados (por encima de las orejas) y detrás
    const fringe = () => { for (let i = -2; i <= 2; i++) mesh(G.ball, m, { p: [i * 0.065, 0.19 - Math.abs(i) * 0.015, 0.2 - Math.abs(i) * 0.025], s: [0.065, 0.05, 0.05], r: [0, 0, i * 0.2] }, head); };
    const sides = (k = 1) => { for (const s of [-1, 1]) mesh(G.ball, m, { p: [s * 0.255, 0.07, -0.04], s: [0.065, 0.13 * k, 0.17 * k] }, head); };
    const back = () => mesh(G.ball, m, { p: [0, 0.02, -0.17], s: [0.25, 0.22, 0.16] }, head);

    if (st === 'cresta') {
      // Cresta: una fila de mechones de punta, de la frente a la nuca
      for (let i = 0; i < 8; i++) {
        const a = 0.5 - i * 0.27, k = 1 - Math.abs(i - 2.5) * 0.08;
        mesh(G.cone, m, { p: [0, Math.cos(a) * 0.29, Math.sin(a) * 0.29 - 0.02], s: [0.045 * k, 0.24 * k, 0.11 * k], r: [a, 0, 0] }, head);
      }
      return;
    }
    if (st === 'tupe') {
      // Tupé: los lados cortos y un volumen grande sobre la frente, peinado hacia arriba y hacia delante
      mesh(G.ball, m, { p: [0, 0.2, 0.12], s: [0.22, 0.12, 0.18], r: [-0.3, 0, 0] }, head);
      mesh(G.ball, m, { p: [0, 0.26, 0.2], s: [0.19, 0.1, 0.1], r: [-0.55, 0, 0] }, head);
      mesh(G.ball, m, { p: [0.02, 0.25, 0.28], s: [0.13, 0.06, 0.05], r: [-0.9, 0, 0.1] }, head);
      return;
    }
    if (st === 'rapado') return;
    if (st === 'pinchos') {
      // Pinchos de verdad: una corona hacia arriba, otra hacia fuera por los lados y la nuca, y tres sobre la frente
      for (let i = 0; i < 6; i++) { const az = (i / 6) * Math.PI * 2 + 0.3; spike(m, on(az, 1.15, 0.27), out(az, 1.15, 0.7), 0.27, 0.075, head); }
      for (let i = 0; i < 7; i++) { const az = 1.0 + (i / 6) * (Math.PI * 2 - 2.0); spike(m, on(az, 0.6, 0.28), out(az, 0.6, 0.25), 0.25, 0.07, head); }
      for (const az of [Math.PI - 0.6, Math.PI, Math.PI + 0.6]) spike(m, on(az, 0.1, 0.28), out(az, 0.1, -0.15), 0.19, 0.062, head);
      for (const x of [-0.1, 0, 0.1]) spike(m, [x, 0.2, 0.2], [x * 1.6, -0.45, 1], 0.17, 0.055, head);
      return;
    }
    if (st === 'samurai') {
      // Samurái: los lados rapados, el pelo de arriba peinado hacia atrás y un moño alto atado
      mesh(new THREE.SphereGeometry(0.29, 20, 8, 0, Math.PI * 2, 0, Math.PI * 0.4), m, { p: [0, 0.035, -0.035], s: 1.06, r: [-0.22, 0, 0] }, head);
      mesh(G.ball, m, { p: [0, 0.3, -0.13], s: [0.075, 0.095, 0.075] }, head);
      mesh(G.ball, M('#c83a32'), { p: [0, 0.255, -0.13], s: [0.065, 0.022, 0.065] }, head);
      spike(m, [0, 0.33, -0.16], [0, 0.25, -1], 0.13, 0.045, head);
      return;
    }
    if (st === 'tazon') {
      // Tazón: un casquete redondo y recto, con el flequillo cortado justo por encima de los ojos
      const cut = Math.PI * 0.44;
      // (inclinado hacia atrás: por detrás baja hasta la nuca; por delante, el flequillo cuelga hasta las cejas)
      mesh(new THREE.SphereGeometry(0.29, 26, 12, 0, Math.PI * 2, 0, cut), m, { p: [0, 0.03, -0.01], s: 1.12, r: [-0.35, 0, 0] }, head);
      for (let a = -1.35; a <= 1.36; a += 0.27) mesh(G.ball, m, { p: on(a, 0.3, 0.31), s: [0.055, 0.09, 0.035], r: [0, a, 0] }, head);   // mechones del flequillo
      back();
      return;
    }
    if (st === 'afro') {
      // Afro: una nube de rizos alrededor de la cabeza (sin tapar la cara)
      for (const [el, n] of [[-0.25, 9], [0.25, 10], [0.7, 9], [1.15, 5]]) for (let i = 0; i < n; i++) {
        const az = (i / n) * Math.PI * 2 + el;
        if (Math.cos(az) > 0.35 && el < 0.6) continue;
        mesh(G.ball, m, { p: on(az, el, 0.34), s: 0.13 + ((i * 7 + n) % 3) * 0.012 }, head);
      }
      mesh(G.ball, m, { p: [0, 0.36, -0.04], s: 0.17 }, head);
      return;
    }
    if (st === 'rastas') {
      // Rastas: mechones gruesos que caen por los lados y la espalda, con alguna cuenta dorada
      sides(0.9); back();
      for (let i = 0; i < 16; i++) {
        const az = 0.85 + (i / 15) * (Math.PI * 2 - 1.7), a = on(az, 0.35, 0.29), len = 0.4 + (i % 3) * 0.05;
        const b = [a[0] + Math.sin(az) * 0.09, a[1] - len, a[2] + Math.cos(az) * 0.09];
        strap(m, a, b, 0.034, head);
        mesh(G.ball, m, { p: b, s: 0.036 }, head);
        if (i % 4 === 1) mesh(G.ball, gold, { p: [a[0] + (b[0] - a[0]) * 0.7, a[1] + (b[1] - a[1]) * 0.7, a[2] + (b[2] - a[2]) * 0.7], s: 0.042 }, head);
      }
      for (const s of [-1, 1]) strap(m, on(s * 0.6, 0.95, 0.28), [s * 0.29, -0.12, 0.1], 0.03, head);
      return;
    }
    if (st === 'flequillo') {
      // Flequillo largo de lado: barrido sobre la frente, tapando un poco un ojo
      sides(); back();
      mesh(G.ball, m, { p: [-0.04, 0.17, 0.215], s: [0.21, 0.075, 0.07], r: [0.2, 0, -0.35] }, head);
      mesh(G.ball, m, { p: [0.11, 0.09, 0.245], s: [0.12, 0.07, 0.05], r: [0.1, 0, -0.8] }, head);
      spike(m, [0.16, 0.05, 0.25], [0.35, -1, 0.12], 0.12, 0.045, head);
      mesh(G.ball, m, { p: [-0.17, 0.2, 0.14], s: [0.09, 0.07, 0.08] }, head);
      return;
    }
    if (st === 'mullet') {
      // Mullet: corto por delante y por arriba, largo por detrás, con las puntas hacia fuera
      for (let i = -1; i <= 1; i++) mesh(G.ball, m, { p: [i * 0.07, 0.19, 0.19], s: [0.06, 0.045, 0.045] }, head);
      sides(0.8);
      mesh(G.ball, m, { p: [0, -0.04, -0.19], s: [0.23, 0.2, 0.13] }, head);
      mesh(G.ball, m, { p: [0, -0.24, -0.19], s: [0.2, 0.16, 0.1] }, head);
      for (const x of [-0.12, 0, 0.12]) spike(m, [x, -0.34, -0.18], [x * 2.2, -1, -0.35], 0.11, 0.05, head);
      return;
    }

    fringe(); sides(); back();
    if (st === 'largo') {
      mesh(G.ball, m, { p: [0, -0.12, -0.12], s: [0.29, 0.34, 0.2] }, head);
      for (const s of [-1, 1]) mesh(G.ball, m, { p: [s * 0.25, -0.12, 0.02], s: [0.07, 0.24, 0.11] }, head);
    }
    if (st === 'ondas') {
      // Ondas largas: melena hasta los hombros con ondas a los lados y las puntas rizadas
      mesh(G.ball, m, { p: [0, -0.14, -0.12], s: [0.3, 0.36, 0.2] }, head);
      for (const s of [-1, 1]) {
        for (let k = 0; k < 4; k++) mesh(G.ball, m, { p: [s * (0.255 + (k % 2) * 0.035), -0.04 - k * 0.11, 0.03 - k * 0.015], s: [0.075, 0.085, 0.1] }, head);
        mesh(G.ball, m, { p: [s * 0.235, -0.48, 0.03], s: [0.07, 0.06, 0.08] }, head);
      }
      for (const x of [-0.14, 0, 0.14]) mesh(G.ball, m, { p: [x, -0.48, -0.12], s: [0.1, 0.07, 0.09] }, head);
    }
    if (st === 'melena') {
      // Melena corta: redondeada, hasta la mandíbula
      mesh(G.ball, m, { p: [0, -0.06, -0.12], s: [0.3, 0.24, 0.19] }, head);
      for (const s of [-1, 1]) mesh(G.ball, m, { p: [s * 0.26, -0.06, 0.0], s: [0.08, 0.19, 0.16] }, head);
    }
    if (st === 'coleta') {
      mesh(G.ball, m, { p: [0, 0.06, -0.3], s: [0.07, 0.07, 0.06] }, head);
      mesh(G.ball, gold, { p: [0, 0.06, -0.33], s: [0.05, 0.05, 0.03] }, head);
      mesh(G.ball, m, { p: [0, -0.06, -0.37], s: [0.075, 0.17, 0.075], r: [0.35, 0, 0] }, head);
      mesh(G.ball, m, { p: [0, -0.22, -0.4], s: [0.05, 0.08, 0.05] }, head);
    }
    if (st === 'coletaAlta') {
      // Coleta alta: atada en lo alto de la nuca, cae hacia atrás en curva
      mesh(G.ball, ribbon, { p: [0, 0.27, -0.215], s: [0.07, 0.035, 0.06], r: [0.6, 0, 0] }, head);
      for (const [y, z, sx, sy] of [[0.31, -0.27, 0.085, 0.085], [0.22, -0.37, 0.08, 0.1], [0.08, -0.42, 0.072, 0.11], [-0.07, -0.43, 0.062, 0.1]]) mesh(G.ball, m, { p: [0, y, z], s: [sx, sy, sx] }, head);
      spike(m, [0, -0.13, -0.42], [0, -1, 0.15], 0.12, 0.05, head);
    }
    if (st === 'coletas') {
      // Dos coletas a los lados, con su lazo
      for (const s of [-1, 1]) {
        mesh(G.ball, ribbon, { p: [s * 0.28, 0.1, -0.1], s: [0.035, 0.05, 0.05] }, head);
        mesh(G.ball, m, { p: [s * 0.33, 0.04, -0.12], s: [0.06, 0.07, 0.06] }, head);
        mesh(G.ball, m, { p: [s * 0.37, -0.12, -0.13], s: [0.065, 0.16, 0.065], r: [0, 0, s * 0.22] }, head);
        mesh(G.ball, m, { p: [s * 0.4, -0.27, -0.13], s: [0.04, 0.07, 0.04], r: [0, 0, s * 0.3] }, head);
      }
    }
    if (st === 'monos') {
      // Dos moños en lo alto, cada uno con su vuelta
      for (const s of [-1, 1]) {
        mesh(G.ball, m, { p: [s * 0.17, 0.29, -0.07], s: 0.105 }, head);
        mesh(G.ball, M(shade(L.hair, 0.78)), { p: [s * 0.165, 0.215, -0.07], s: [0.085, 0.028, 0.085] }, head);
      }
    }
    if (st === 'trenza') {
      // Trenza larga por la espalda: eslabones que se cruzan y un lazo al final
      mesh(G.ball, m, { p: [0, 0.0, -0.3], s: [0.075, 0.075, 0.06] }, head);
      for (let k = 0; k < 6; k++) mesh(G.ball, m, { p: [(k % 2 ? 1 : -1) * 0.012, -0.08 - k * 0.075, -0.31 - k * 0.006], s: [0.06 - k * 0.004, 0.052, 0.05], r: [0, 0, (k % 2 ? 1 : -1) * 0.5] }, head);
      mesh(G.ball, gold, { p: [0, -0.53, -0.34], s: [0.04, 0.025, 0.04] }, head);
      mesh(G.cone, m, { p: [0, -0.59, -0.34], s: [0.04, 0.08, 0.04], r: [Math.PI, 0, 0] }, head);
    }
    if (st === 'trenzas') {
      // Dos trenzas por delante de los hombros, con lazo
      for (const s of [-1, 1]) {
        for (let k = 0; k < 7; k++) mesh(G.ball, m, { p: [s * (0.255 + k * 0.004), -0.06 - k * 0.07, -0.04 + k * 0.018], s: [0.055 - k * 0.003, 0.047, 0.05], r: [0, 0, (k % 2 ? 1 : -1) * 0.5] }, head);
        mesh(G.ball, ribbon, { p: [s * 0.285, -0.55, 0.09], s: [0.045, 0.022, 0.04] }, head);
        spike(m, [s * 0.285, -0.56, 0.09], [0, -1, 0.1], 0.08, 0.035, head);
      }
    }
    if (st === 'mono') mesh(G.ball, m, { p: [0, 0.3, -0.06], s: 0.11 }, head);
    if (st === 'rizado') for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; mesh(G.ball, m, { p: [Math.cos(a) * 0.25, 0.1 + Math.sin(i * 1.7) * 0.06, Math.sin(a) * 0.23 - 0.04], s: 0.085 }, head); }
  }
  // Otra persona igual (comparte geometrías y materiales: hacer una desde cero cuesta)
  clone() {
    const c = Object.create(Person3D.prototype), root = this.root.clone(true), by = n => root.getObjectByName(n);
    Object.assign(c, { skirt: by('skirt') || null, bellyMat: this.bellyMat, look: this.look, name: this.name, root, body: by('body'), torso: by('torso'), head: by('head'), faceMesh: by('face'), faceOpen: this.faceOpen, legs: [by('legL'), by('legR')], arms: [by('armL'), by('armR')], shins: [by('shinL'), by('shinR')], fore: [by('foreL'), by('foreR')], legSwing: this.legSwing, phase: Math.random() * 6, speed: 0, targetYaw: 0, blink: 1 + Math.random() * 3 });
    return c;
  }
  // Lo que cuelga de la cintura (túnica, falda, delantal), según lo que suban las piernas: sigue colgando recto aunque
  // el cuerpo se incline y, con los muslos hacia delante, se adelanta y se abre para taparlos
  fitSkirt() {
    const s = this.skirt;
    if (!s) return;
    const up = -Math.min(this.legs[0].rotation.x, this.legs[1].rotation.x), k = Math.max(0, Math.min(1, (up - 0.3) / 0.8));
    s.rotation.x = -this.torso.rotation.x - SKIRT.tilt * k;
    s.scale.set(1 + SKIRT.wide * k, 1, 1 + SKIRT.deep * k);
  }
  // La barriga del embarazo (k: de 0 a 1), delante del tronco. Devuelve la malla la primera vez que se crea
  setBelly(k) {
    let made = null;
    if (k > 0 && !this.bellyMesh) {
      made = this.bellyMesh = new THREE.Mesh(G.ball, this.bellyMat);
      made.castShadow = true;
      this.torso.add(made);
    }
    if (this.bellyMesh) {
      this.bellyMesh.visible = k > 0;
      const d = 0.07 + 0.14 * k;   // (lo que sobresale crece más que lo que ensancha)
      this.bellyMesh.position.set(0, 0.135 - 0.02 * k, 0.05 + 0.03 * k);
      this.bellyMesh.scale.set(0.135 + 0.03 * k, 0.12 + 0.035 * k, d);
    }
    return made;
  }
  // Animación: speed en m/s (0 = quieto)
  update(dt, speed) {
    this.speed += (speed - this.speed) * Math.min(1, dt * 10);
    const k = Math.min(1, this.speed / 3);
    this.phase += dt * (2 + this.speed * 3.2);
    const sw = Math.sin(this.phase) * 0.75 * k;
    this.legs[0].rotation.x = sw * this.legSwing; this.legs[1].rotation.x = -sw * this.legSwing;
    this.arms[0].rotation.x = -sw * 0.9; this.arms[1].rotation.x = sw * 0.9;
    // Las rodillas se doblan al levantar el pie de atrás; los codos, un poco, más al ir el brazo adelante
    this.shins[0].rotation.x = (Math.max(0, sw) * 1.3 + 0.08 * k) * this.legSwing; this.shins[1].rotation.x = (Math.max(0, -sw) * 1.3 + 0.08 * k) * this.legSwing;
    this.fore[0].rotation.x = -0.12 - Math.max(0, sw) * 0.5; this.fore[1].rotation.x = -0.12 - Math.max(0, -sw) * 0.5;
    // Parpadea cada pocos segundos y, quieto, respira
    this.blink -= dt;
    if (this.blink < 0) { this.faceMesh.material = this.blink > -0.12 ? CLOSED.get(this.faceOpen) : this.faceOpen; if (this.blink <= -0.12) this.blink = 2 + Math.random() * 4; }
    this.torso.scale.y = 1 + Math.sin(this.phase * 0.5) * 0.012 * (1 - k);
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
