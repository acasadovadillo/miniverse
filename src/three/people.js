// Personas en 3D: chibis de pocos polígonos a partir de los "look" del juego (sexo, peinado, colores de pelo,
// piel y ojos, y la forma de los ojos, las cejas, la nariz, las orejas, la barba y los mofletes) y de la ropa
// que llevan puesta (look.wear, por hueco del cuerpo; si no lo trae, la que corresponde a su tipo de ropa).
// Lo que no se cubre con ropa es piel: sin nada, un muñeco liso. Cabeza grande, cuerpo pequeño y animación de andar (piernas y brazos que se balancean, un leve
// bote) y de respirar en reposo. Mira hacia z+.
import * as THREE from 'three';
import { mat } from './geo.js';
import { fullLook, clothesFor } from '../looks.js';

// Una superficie abierta (un trozo de cilindro: delantal, peto) con las dos caras, para que se vea también por dentro
function twoSided(geo) {
  const g = geo.toNonIndexed(), p = g.attributes.position.array, n = g.attributes.normal.array;
  const P = new Float32Array(p.length * 2), N = new Float32Array(n.length * 2);
  P.set(p); N.set(n);
  for (let i = 0; i < p.length; i += 9) for (let v = 0; v < 3; v++) {
    const from = i + (2 - v) * 3, to = p.length + i + v * 3;   // el mismo triángulo al revés
    for (let k = 0; k < 3; k++) { P[to + k] = p[from + k]; N[to + k] = -n[from + k]; }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  return out;
}

export const G = {
  head: new THREE.SphereGeometry(0.29, 24, 18), eye: new THREE.SphereGeometry(1, 12, 8), ball: new THREE.SphereGeometry(1, 14, 10),
  limb: new THREE.CapsuleGeometry(0.055, 0.2, 4, 8), leg: new THREE.CapsuleGeometry(0.07, 0.16, 4, 8), boot: new THREE.SphereGeometry(1, 10, 8),
  cone: new THREE.ConeGeometry(1, 1, 10), cyl: new THREE.CylinderGeometry(1, 1, 1, 14), box: new THREE.BoxGeometry(1, 1, 1),
  skirt: new THREE.CylinderGeometry(1, 1.32, 1, 20),                                         // falda de túnica (cerrada)
  bib: twoSided(new THREE.CylinderGeometry(1, 1, 1, 12, 1, true, -0.75, 1.5)),              // peto del delantal
  apron: twoSided(new THREE.CylinderGeometry(1, 1.28, 1, 14, 1, true, -1, 2)),             // falda del delantal
  arch: new THREE.TorusGeometry(1, 0.17, 6, 14, Math.PI * 0.8).rotateZ(Math.PI * 0.1),      // ceja arqueada
};
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

// La cara de la cabeza (esfera de radio 0.29 algo achatada): z de la superficie en (x, y), para apoyar en ella
// ojos, cejas, nariz, mofletes y barba. F(x, y, d): ese punto, d por delante de la superficie.
const HR = [0.29, 0.29 * 0.96, 0.29 * 0.96];
const F = (x, y, d = 0) => [x, y, HR[2] * Math.sqrt(Math.max(0, 1 - (x / HR[0]) ** 2 - (y / HR[1]) ** 2)) + d];

export class Person3D {
  constructor(look, name = '') {
    this.look = look; this.name = name;
    this.root = new THREE.Group();
    this.body = new THREE.Group(); this.body.name = 'body'; this.root.add(this.body);
    this.phase = Math.random() * 6; this.speed = 0; this.targetYaw = 0;
    const L = fullLook(look), W = look.wear || clothesFor(L), skin = M(L.skin), hair = M(L.hair, { roughness: 0.6 });
    const shirt = W.torso ? M(W.torso.color) : null, under = W.interiorArriba ? M(W.interiorArriba.color) : null;
    const pants = W.piernas?.id === 'pantalon' ? M(W.piernas.color) : null;
    // Con la túnica larga las piernas se mueven menos (si no, asomarían por la falda)
    this.legSwing = W.torso?.id === 'tunica_larga' ? 0.5 : 1;
    // Piernas (con pantalón o piel) y pies (con botas o descalzos)
    this.legs = [-1, 1].map(s => {
      const hip = new THREE.Group(); hip.name = s < 0 ? 'legL' : 'legR'; hip.position.set(s * 0.085, 0.36, 0); this.body.add(hip);
      mesh(G.leg, pants || skin, { p: [0, -0.14, 0] }, hip);
      if (W.pies) mesh(G.boot, M(W.pies.color), { p: [0, -0.31, 0.03], s: [0.085, 0.06, 0.12] }, hip);
      else mesh(G.boot, skin, { p: [0, -0.315, 0.025], s: [0.062, 0.045, 0.095] }, hip);
      return hip;
    });
    // Tronco (con camisa o túnica, camiseta interior o piel) y lo que va encima
    const torso = new THREE.Group(); torso.name = 'torso'; torso.position.y = 0.36; this.body.add(torso); this.torso = torso;
    mesh(G.cyl, shirt || under || skin, { p: [0, 0.2, 0], s: [0.17, 0.4, 0.13] }, torso);
    mesh(G.ball, shirt || skin, { p: [0, 0.4, 0], s: [0.19, 0.08, 0.14] }, torso);                       // hombros
    this.outfit(torso, L, W);
    // Brazos, con manga (o piel) y mano
    this.arms = [-1, 1].map(s => {
      const sh = new THREE.Group(); sh.name = s < 0 ? 'armL' : 'armR'; sh.position.set(s * 0.21, 0.38, 0); torso.add(sh);
      mesh(G.limb, shirt || skin, { p: [0, -0.12, 0], r: [0, 0, s * 0.12] }, sh);
      mesh(G.ball, skin, { p: [s * 0.03, -0.27, 0], s: 0.058 }, sh);
      return sh;
    });
    // Cabeza: cara, ojos, cejas, nariz, boca, orejas, mofletes, barba y pelo
    const head = new THREE.Group(); head.name = 'head'; head.position.y = 0.43 + 0.28; torso.add(head); this.head = head;
    mesh(G.head, skin, { s: [1, 0.96, 0.96] }, head);
    this.face(head, L, skin, hair);
    this.hair(head, L, hair);
    this.headwear(head, W.cabeza);
    // Cada parte que se mueve junta (piernas, brazos, tronco y cabeza) en una sola malla con colores por vértice
    for (const grp of [...this.legs, ...this.arms, torso, head]) mergeInto(grp);
    this.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  }

  // Lo que se lleva en el tronco y las caderas: túnica (corta o larga, con cinturón), pantalón, falda o la
  // ropa interior que quede a la vista; encima, delantal o chaleco; y a la espalda, la mochila
  outfit(torso, L, W) {
    const top = W.torso?.id, legs = W.piernas?.id, tunic = top === 'tunica' || top === 'tunica_larga';
    if (tunic) {
      // Falda acampanada desde la cintura: por las caderas (corta) o casi hasta los tobillos (larga), con ribete
      const c = W.torso.color, [h, y] = top === 'tunica_larga' ? [0.42, -0.08] : [0.26, 0];
      mesh(G.skirt, M(c), { p: [0, y, 0], s: [0.178, h, 0.138] }, torso);
      mesh(G.cyl, M(shade(c, 0.7)), { p: [0, y - h / 2 + 0.012, 0], s: [0.178 * 1.32 + 0.004, 0.024, 0.138 * 1.32 + 0.004] }, torso);
      mesh(G.cyl, M('#5a3a22'), { p: [0, 0.12, 0], s: [0.184, 0.04, 0.144] }, torso);                                         // cinturón
      mesh(G.cyl, M('#e8c050', { metalness: 0.5, roughness: 0.4 }), { p: [0, 0.12, 0.146], s: [0.03, 0.045, 0.012], r: [Math.PI / 2, 0, 0] }, torso);
    }
    if (legs === 'pantalon' && top !== 'tunica_larga') mesh(G.cyl, M(W.piernas.color), { p: [0, 0.02, 0], s: [0.175, 0.08, 0.135] }, torso);   // la cintura del pantalón
    if (legs === 'falda' && top !== 'tunica_larga') {
      const c = W.piernas.color;
      mesh(G.skirt, M(c), { p: [0, -0.04, 0], s: [0.179, 0.24, 0.139] }, torso);
      mesh(G.cyl, M(shade(c, 0.75)), { p: [0, 0.075, 0], s: [0.184, 0.03, 0.144] }, torso);
    }
    // Sin nada por debajo de la cintura, se ve la ropa interior (o nada: piel)
    if (!legs && !tunic && W.interiorAbajo) {
      const c = M(W.interiorAbajo.color);
      mesh(G.cyl, c, { p: [0, 0.0, 0], s: [0.176, 0.09, 0.136] }, torso);
      mesh(G.cyl, M(shade(W.interiorAbajo.color, 0.85)), { p: [0, 0.045, 0], s: [0.178, 0.014, 0.138] }, torso);   // elástico
    }
    const over = W.encima?.id;
    if (over === 'delantal') {
      const apron = M(W.encima.color), tie = M(shade(W.encima.color, 0.88));
      mesh(G.bib, apron, { p: [0, 0.27, 0], s: [0.182, 0.17, 0.142] }, torso);                  // peto
      mesh(G.apron, apron, { p: [0, 0, 0], s: [0.182, 0.24, 0.142] }, torso);                   // falda
      mesh(G.cyl, tie, { p: [0, 0.125, 0], s: [0.186, 0.026, 0.146] }, torso);                  // cinta de la cintura
      for (const s of [-1, 1]) {
        strap(tie, [s * 0.12, 0.35, 0.115], [s * 0.075, 0.43, 0.01], 0.012, torso);              // tirantes al cuello
        mesh(G.ball, tie, { p: [s * 0.035, 0.125, -0.15], s: [0.038, 0.022, 0.014], r: [0, 0, s * 0.45] }, torso);   // lazo
        strap(tie, [s * 0.01, 0.12, -0.15], [s * 0.03, 0.03, -0.155], 0.009, torso);
      }
      mesh(G.ball, tie, { p: [0, 0.125, -0.152], s: 0.014 }, torso);
      mesh(G.ball, M(shade(W.encima.color, 0.88)), { p: [0.06, -0.035, 0.164], s: [0.05, 0.035, 0.01] }, torso);   // bolsillo
    }
    if (over === 'chaleco') {
      for (const s of [-1, 1]) mesh(G.cyl, M(W.encima.color), { p: [s * 0.08, 0.22, 0.1], s: [0.06, 0.36, 0.035] }, torso);
      if (!W.torso) mesh(G.cyl, M(L.skin), { p: [0, 0.22, 0.095], s: [0.04, 0.36, 0.03] }, torso);
      else mesh(G.cyl, M('#ece4d4'), { p: [0, 0.22, 0.095], s: [0.04, 0.36, 0.03] }, torso);
    }
    // Mochila: cuerpo, solapa, bolsillo y las dos correas por encima de los hombros
    if (W.espalda) {
      const bag = M(W.espalda.color, { roughness: 0.85 }), dark = M(shade(W.espalda.color, 0.68), { roughness: 0.85 });
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

  // Sombrero de paja (copa, cinta y ala ancha) o gorro de lana con vuelta y pompón
  headwear(head, it) {
    if (!it) return;
    const c = M(it.color, { roughness: 0.85 }), d = M(shade(it.color, 0.72), { roughness: 0.85 });
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
  }

  face(head, L, skin, hair) {
    const eye = M(L.eyes, { roughness: 0.3 }), white = M('#ffffff', { roughness: 0.2 }), ink = M('#2a1a1a'), lid = M(shade(L.skin, 0.95));
    const brow = M(shade(L.hair, 0.8)), noseM = M(shade(L.skin, 0.92));
    for (const s of [-1, 1]) {
      const x = s * 0.1;
      // Ojos
      const st = L.eyeStyle;
      if (st === 'pequenos') {
        mesh(G.eye, eye, { p: F(x, -0.005, 0.0), s: [0.03, 0.04, 0.02] }, head);
        mesh(G.eye, white, { p: F(x + 0.01, 0.01, 0.016), s: [0.009, 0.01, 0.005] }, head);
      } else if (st === 'almendrados') {
        mesh(G.eye, white, { p: F(x, 0, -0.008), s: [0.068, 0.044, 0.03], r: [0, 0, s * 0.18] }, head);
        mesh(G.eye, eye, { p: F(x, -0.002, 0.008), s: [0.034, 0.04, 0.02] }, head);
        mesh(G.eye, white, { p: F(x + 0.012, 0.014, 0.022), s: [0.011, 0.012, 0.005] }, head);
        mesh(G.cyl, ink, { p: F(x, 0.036, 0.006), s: [0.066, 0.008, 0.01], r: [Math.PI / 2 - 0.15, 0, s * 0.2] }, head);
      } else {
        mesh(G.eye, white, { p: F(x, 0, -0.01), s: [0.055, 0.068, 0.03] }, head);
        mesh(G.eye, eye, { p: F(x, -0.005, 0.007), s: [0.04, 0.054, 0.02] }, head);
        mesh(G.eye, white, { p: F(x + 0.014, 0.018, 0.022), s: [0.012, 0.014, 0.006] }, head);
        if (st === 'pestanas') {
          mesh(G.cyl, ink, { p: F(x, 0.07, 0.002), s: [0.05, 0.01, 0.012], r: [Math.PI / 2 - 0.2, 0, s * 0.15] }, head);
          strap(ink, F(x + s * 0.045, 0.06, 0.004), F(x + s * 0.068, 0.078, 0.004), 0.006, head);
        }
        if (st === 'entornados') {
          mesh(G.eye, lid, { p: F(x, 0.036, -0.012), s: [0.06, 0.042, 0.034] }, head);   // párpado a media asta
          mesh(G.cyl, ink, { p: F(x, -0.004, 0.018), s: [0.054, 0.006, 0.006], r: [Math.PI / 2 - 0.25, 0, 0] }, head);
        }
      }
      // Cejas
      const by = 0.108, b = L.brows;
      if (b === 'arqueadas') mesh(G.arch, brow, { p: F(x, by - 0.03, 0.01), s: [0.05, 0.036, 0.05] }, head);
      else if (b === 'pobladas') for (let k = -1; k <= 1; k++) mesh(G.ball, brow, { p: F(x + k * 0.03, by - k * s * 0.004, 0.004), s: [0.024, 0.018, 0.014] }, head);
      else {
        const [w, h, t, tilt] = { finas: [0.048, 0.008, 0.01, 0.12], rectas: [0.045, 0.013, 0.014, 0.1], gruesas: [0.05, 0.022, 0.018, 0.05] }[b] || [0.045, 0.013, 0.014, 0.1];
        mesh(G.cyl, brow, { p: F(x, by, 0.002), s: [w, t, h], r: [Math.PI / 2 - 0.3, 0, -s * tilt] }, head);
      }
      // Orejas
      const ear = { redondas: [0.035, 0.06, 0.045, 0.285], pequenas: [0.028, 0.045, 0.035, 0.282], grandes: [0.044, 0.084, 0.062, 0.29], elfo: [0.032, 0.055, 0.042, 0.285], soplillo: [0.018, 0.066, 0.056, 0.312] }[L.ears] || [0.035, 0.06, 0.045, 0.285];
      mesh(G.ball, skin, { p: [s * ear[3], -0.03, L.ears === 'soplillo' ? -0.01 : 0], s: ear.slice(0, 3), r: [0, L.ears === 'soplillo' ? s * 1.1 : 0, 0] }, head);
      if (L.ears === 'elfo') mesh(G.cone, skin, { p: [s * 0.325, 0.05, -0.02], s: [0.03, 0.16, 0.036], r: [-0.25, 0, -s * 0.6] }, head);
      // Mofletes: una sola pieza redondeada con colorete, que abulta un poco
      if (L.cheeks) mesh(G.eye, M(mix(L.skin, '#ff7a8a', 0.4)), { p: F(s * 0.145, -0.085, -0.004), s: [0.05, 0.032, 0.028] }, head);
    }
    // Nariz
    const n = L.nose;
    if (n === 'respingona') mesh(G.ball, noseM, { p: F(0, -0.055, 0.012), s: [0.024, 0.02, 0.03], r: [-0.6, 0, 0] }, head);
    else if (n === 'larga') mesh(G.ball, noseM, { p: F(0, -0.065, 0.02), s: [0.026, 0.026, 0.056], r: [0.35, 0, 0] }, head);
    else if (n === 'ancha') mesh(G.ball, noseM, { p: F(0, -0.065, 0.01), s: [0.048, 0.024, 0.024] }, head);
    else if (n === 'puntiaguda') mesh(G.cone, noseM, { p: F(0, -0.052, 0.028), s: [0.026, 0.075, 0.026], r: [Math.PI / 2 + 0.3, 0, 0] }, head);
    else mesh(G.ball, noseM, { p: F(0, -0.06, 0.013), s: [0.028, 0.022, 0.02] }, head);
    // Boca
    mesh(G.cyl, M(L.sex === 'chica' ? '#c8506a' : '#8a3a3a'), { p: F(0, -0.13, 0.016), s: [0.035, 0.008, 0.012], r: [Math.PI / 2, 0, 0] }, head);
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
    Object.assign(c, { look: this.look, name: this.name, root, body: by('body'), torso: by('torso'), head: by('head'), legs: [by('legL'), by('legR')], arms: [by('armL'), by('armR')], legSwing: this.legSwing, phase: Math.random() * 6, speed: 0, targetYaw: 0 });
    return c;
  }
  // Animación: speed en m/s (0 = quieto)
  update(dt, speed) {
    this.speed += (speed - this.speed) * Math.min(1, dt * 10);
    const k = Math.min(1, this.speed / 3);
    this.phase += dt * (2 + this.speed * 3.2);
    const sw = Math.sin(this.phase) * 0.75 * k;
    this.legs[0].rotation.x = sw * this.legSwing; this.legs[1].rotation.x = -sw * this.legSwing;
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
