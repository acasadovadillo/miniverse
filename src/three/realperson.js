// Las personas del juego: el cuerpo de la prueba de aspecto (real/persona.js, con sus peinados de real/pelo.js y las
// ayudas de real/base.js), con la ropa, el peinado y los colores de cada look del juego. Sus huesos se llaman como las
// piezas de los muñecos de antes (piernas, espinillas, brazos, antebrazos, tronco, cabeza), así que lo que hace el juego
// con ellas (mirar a quien pasa, agacharse, el gesto de la herramienta, sentarse, tumbarse, montar) las mueve igual.
import * as THREE from 'three';
import { fullLook, clothesFor } from '../looks.js';
import { Builder } from './geo.js';
// (se cargan con el juego, en este orden: base.js deja window.LOOK con sus ayudas, y pelo y persona solo se apuntan en
// LOOK.parts; THREE lo usan dentro de sus funciones, así que basta con dárselo antes de construir a nadie. Así entran
// también en la lista de archivos que index.html vuelve a pedir sin caché al cambiar de versión)
import './real/base.js';
import './real/pelo.js';
import './real/persona.js';

let P = null;
const KID = 0.68;   // la estatura de un niño, de la de un adulto
// El generador, la primera vez que hace falta (el servidor sin pantalla no construye a nadie)
const persona = () => (P ||= ((window.LOOK.THREE = THREE), window.LOOK.parts.persona(THREE, window.LOOK)));
// (las páginas de prueba lo esperan: docs/pruebas-arte/t10/hoja.html y medir.html)
export const loadReal = () => Promise.resolve(persona());

// Los peinados del juego, en los de la prueba (los que no tiene, el más parecido)
const HAIR = {
  corto: 'corto', largo: 'largo', coleta: 'coleta', rizado: 'rizado', mono: 'mono', rapado: 'corto', calvo: 'corto', pinchos: 'pinchos', melena: 'largo',
  coletas: 'coleta', trenza: 'trenza', cresta: 'cresta', tupe: 'tupe', afro: 'rizado', rastas: 'largo', coletaAlta: 'coleta', monos: 'mono', trenzas: 'trenza',
  ondas: 'largo', flequillo: 'corto', mullet: 'corto', tazon: 'corto', samurai: 'mono',
};
const hash = s => { let h = 7; for (const ch of s) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0; return h >>> 0; };
// El look del juego, en el de la persona realista: sexo, piel, pelo, cara y la ropa que lleva puesta
export function toReal(look, kid = false) {
  const L = fullLook(look), W = look.wear || clothesFor(L), girl = L.sex === 'chica', g = [];
  const col = it => it && it.color;
  const torso = W.torso?.id, top = W.encima?.id, legs = W.piernas?.id;
  if (torso === 'tunica' || torso === 'tunica_larga') g.push({ id: 'tunica', color: col(W.torso) });
  else if (torso) g.push({ id: 'camisa', color: col(W.torso) });
  else if (W.interiorArriba) g.push({ id: 'camisa', color: col(W.interiorArriba) });
  if (legs === 'pantalon' || legs?.startsWith('grebas_')) g.push({ id: 'pantalon', color: col(W.piernas) });
  if (top === 'chaleco') g.push({ id: 'chaleco', color: col(W.encima) });
  if (top === 'delantal') g.push({ id: 'delantal', color: col(W.encima) });
  if (!legs || legs === 'falda') g.push({ id: 'medias', color: col(W.calcetines) || '#5f5346' });
  g.push({ id: W.pies ? 'botas' : 'zapatos', color: col(W.pies) || '#5a4030' });
  const hat = W.cabeza?.id, seed = hash(JSON.stringify(look));
  const out = {
    sex: girl ? 'f' : 'm', build: 'medio', skin: L.skin, hair: L.hair, hairStyle: HAIR[L.hairStyle] || 'corto', ojos: L.eyes,
    eyeStyle: L.eyeStyle, brows: L.brows, nose: L.nose, semilla: seed % 97, garments: g,
  };
  if (L.beard && L.beard !== 'no' && !kid) out.barba = 'corta';
  // Un niño: la cabeza más grande para su cuerpo (5 cabezas de alto en vez de 6,8), más fino y a 1,17 m
  if (kid) Object.assign(out, { cabezas: 5, build: 'fino', escala: KID });
  if (hat === 'sombrero') out.sombrero = 'paja';
  else if (hat === 'gorro') out.sombrero = 'boina';
  else if (hat === 'hijab') { out.hairStyle = 'panuelo'; out.panuelo = col(W.cabeza); }
  return out;
}

// Una persona con lo que el juego espera de ella: root, body, torso, head, legs, shins, arms, fore (índice 0 a -x y
// 1 a +x), facing, update, clone…
export class RealPerson {
  constructor(look, { kid = false } = {}) {
    this.look = look; this.real = true; this.kid = kid;
    const r = (this.r = persona().build(toReal(look, kid))), k = kid ? KID : 1;   // (la escala va en su raíz: cadera y estatura, por ella)
    this.root = new THREE.Group();
    this.root.add(r.root);
    const b = r.bones;
    this.body = b.body; this.torso = b.torso; this.head = b.head; this.hand = b.handR; this.toolArm = 0;   // (lo que se lleva, en la mano derecha: arms[0])
    this.legs = [b.legR, b.legL]; this.shins = [b.shinR, b.shinL]; this.arms = [b.armR, b.armL]; this.fore = [b.foreR, b.foreL];
    // Para el juego: la cadera (lo que hay que bajar al sentarse: ver SEAT_HIP en actors.js) y la estatura
    this.hipY = b.body.position.y * k; this.height = (r.d?.alto || 1.7) * k;
    // La barriga del embarazo: del color de lo que se lleva encima (ver setBelly)
    const W = look.wear || clothesFor(fullLook(look)), top = W.encima?.id === 'delantal' ? W.encima : W.torso || W.interiorArriba;
    this.bellyColor = window.LOOK.sobrio(top?.color || fullLook(look).skin);
    this.targetYaw = 0; this.speed = 0;
    if (W.espalda) this.addBag(W.espalda);   // (la mochila, si la lleva puesta)
    r.root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }
  set facing(yaw) { this.targetYaw = yaw; }
  get facing() { return this.targetYaw; }
  update(dt, speed) {
    this.speed += (speed - this.speed) * Math.min(1, dt * 10);
    this.r.update(dt, this.speed);
    let d = this.targetYaw - this.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.root.rotation.y += d * Math.min(1, dt * 12);
  }
  clone() { return new RealPerson(this.look, { kid: this.kid }); }
  // La mochila a la espalda: cuerpo, solapa, bolsillo con su hebilla y las dos correas por encima de los hombros y bajo
  // los brazos. Cuelga del hueso del pecho y se ajusta a cada cuerpo: dónde le quedan la espalda, el pecho y los
  // hombros se mide en su malla
  addBag(item) {
    const b = this.r.bones, T = b.torso, v = new THREE.Vector3(), W = window.LOOK;
    this.r.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(T.matrixWorld).invert(), top = b.armL.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv).y;
    let back = -0.08, front = 0.08;
    this.r.root.traverse(o => {
      if (!o.isSkinnedMesh) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 3) {
        o.getVertexPosition(i, v); o.localToWorld(v); v.applyMatrix4(inv);
        if (v.y > -0.02 && v.y < top - 0.05 && Math.abs(v.x) < 0.1) { back = Math.min(back, v.z); front = Math.max(front, v.z); }
      }
    });
    const base = W.sobrio(item.color || '#8a5a34'), leather = new THREE.MeshStandardMaterial({ color: base, roughness: 0.82 }), dark = new THREE.MeshStandardMaterial({ color: W.mix(base, '#1a120c', 0.38), roughness: 0.85 });
    const g = new THREE.Group(), box = (m, x0, y0, z0, x1, y1, z1, r) => { const B = new Builder(); B.roundBox(x0, y0, z0, x1, y1, z1, r, { s: 1 }); g.add(B.mesh(m)); };
    const z = back + 0.012, y1 = top - 0.02, y0 = y1 - 0.36;
    box(leather, -0.135, y0, z - 0.14, 0.135, y1, z, 0.035);                 // el cuerpo
    box(dark, -0.14, y1 - 0.11, z - 0.15, 0.14, y1 + 0.012, z + 0.004, 0.03);   // la solapa
    box(dark, -0.09, y0 + 0.03, z - 0.165, 0.09, y0 + 0.15, z - 0.13, 0.012);   // el bolsillo
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.01), new THREE.MeshStandardMaterial({ color: '#b8964a', metalness: 0.5, roughness: 0.4 })); buckle.position.set(0, y1 - 0.11, z - 0.153); g.add(buckle);
    const strap = (a, c) => { const A = new THREE.Vector3(...a), d = new THREE.Vector3(...c).sub(A), len = d.length(), m = new THREE.Mesh(new THREE.BoxGeometry(0.034, len, 0.012), dark); m.position.copy(A).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); g.add(m); };
    for (const s of [-1, 1]) {
      const x = s * 0.095, sh = top + 0.062;
      strap([x, y1 - 0.02, z], [x, sh, back * 0.45]); strap([x, sh, back * 0.45], [x, sh - 0.012, front * 0.4]);       // sube por la espalda y pasa el hombro
      strap([x, sh - 0.012, front * 0.4], [x * 1.1, top - 0.1, front * 0.86]);                                       // baja por el pecho
      strap([x * 1.1, top - 0.1, front * 0.86], [x * 1.75, y0 + 0.14, front * 0.25]); strap([x * 1.75, y0 + 0.14, front * 0.25], [s * 0.13, y0 + 0.06, z - 0.03]);   // y bajo el brazo, a la mochila
    }
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    T.add(g); this.bag = g;
  }
  // La barriga, de 0 a 1: crece hacia delante más que a lo ancho, sobre el vientre (cuelga del hueso de la cintura)
  setBelly(k) {
    let made = null;
    if (k > 0 && !this.belly) {
      made = this.belly = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshStandardMaterial({ color: this.bellyColor, roughness: 0.9 }));
      made.castShadow = true;
      this.r.bones.spine.add(made);
    }
    if (this.belly) {
      this.belly.visible = k > 0;
      this.belly.position.set(0, -0.05 + 0.01 * k, 0.03 + 0.045 * k);
      this.belly.scale.set(0.14 + 0.03 * k, 0.13 + 0.04 * k, 0.07 + 0.11 * k);
    }
    return made;
  }
}

// El bebé de la cuna: el mismo cuerpo a escala de bebé (4 cabezas de alto y unos 57 cm), tumbado boca arriba con la
// cabeza hacia -z (como el de los muñecos) y envuelto hasta el cuello en su mantita
export function realBaby(look) {
  const L = fullLook(look), W = window.LOOK;
  const r = persona().build({ sex: L.sex === 'chica' ? 'f' : 'm', build: 'fino', cabezas: 4, escala: 0.33, skin: L.skin, hair: L.hair, hairStyle: 'corto', ojos: L.eyes,
    semilla: hash(JSON.stringify(look)) % 97, garments: [{ id: 'camisa', color: '#f4e6c8' }] });
  r.update(0.5, 0);
  const root = new THREE.Group(), body = new THREE.Group();
  body.add(r.root); body.rotation.x = -Math.PI / 2; body.position.set(0, 0.05, 0.3);
  root.add(body);
  const ball = new THREE.SphereGeometry(1, 20, 14), cloth = c => new THREE.MeshStandardMaterial({ color: W.sobrio(c), roughness: 0.95 });
  for (const [c, p, s] of [['#f4e6c8', [0, 0.065, 0.08], [0.12, 0.08, 0.23]], ['#e88aa8', [0, 0.075, 0.15], [0.125, 0.07, 0.15]]]) {
    const m = new THREE.Mesh(ball, cloth(c)); m.position.set(...p); m.scale.set(...s); m.castShadow = m.receiveShadow = true; root.add(m);
  }
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return root;
}
