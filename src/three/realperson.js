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
  // (la semilla, sin la mochila: ponérsela o quitársela no cambia la cara ni la postura, y se hace sin rehacer la persona)
  const hat = W.cabeza?.id, seed = hash(JSON.stringify(look.wear?.espalda ? { ...look, wear: { ...look.wear, espalda: undefined } } : look));
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

// La mochila: el cuero (con su color por vértice, el de cada mochila) y la hebilla, compartidos por todas
const BAG = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.84 });
const BUCKLE = new THREE.MeshStandardMaterial({ color: '#b8964a', metalness: 0.5, roughness: 0.4 }), BUCKLE_GEO = new THREE.BoxGeometry(0.03, 0.03, 0.01);
// Un color en todos los vértices de una pieza
function paint(geo, c) {
  const k = new THREE.Color(c), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = k.r; a[i * 3 + 1] = k.g; a[i * 3 + 2] = k.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
// Varias piezas (posición, normal y color) en una sola geometría con índice
function mergeParts(list) {
  const pos = [], nor = [], col = [], idx = [];
  for (const g of list) {
    const off = pos.length / 3, P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color;
    for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(N.getX(i), N.getY(i), N.getZ(i)); col.push(C.getX(i), C.getY(i), C.getZ(i)); }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + off);
    else for (let i = 0; i < P.count; i++) idx.push(i + off);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx); out.computeBoundingSphere();
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
    this.bag = null; this.bagKey = null;
    if (W.espalda) this.setBag(W.espalda);   // (la mochila, si la lleva puesta)
    r.root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    // El esqueleto solo se recalcula (y se sube a la gráfica) si algo ha cambiado: Three lo hace en cada fotograma con
    // cada persona que se ve, aunque esté quieta o se anime a menos fotogramas (ver Actors.pose). Ha cambiado si se ha
    // animado (dirty, de animate) o si se ha movido algo de lo que cuelga, que se ve en el hueso de la cadera en el mundo
    // (las matrices de los huesos van en coordenadas del mundo: con la raíz movida y sin rehacerlas, se dibujaría donde estaba)
    const sk = r.mesh.skeleton, up = sk.update.bind(sk), hip = sk.bones[0], last = new Float64Array(16);
    this.dirty = true; this.lodNow = 0;
    sk.update = () => {
      const e = hip.matrixWorld.elements;
      let go = this.dirty;
      if (!go) for (let i = 0; i < 16; i++) if (e[i] !== last[i]) { go = true; break; }
      if (go) { up(); last.set(e); this.dirty = false; }
    };
  }
  set facing(yaw) { this.targetYaw = yaw; }
  get facing() { return this.targetYaw; }
  // Andar y posar (los huesos) y girar hacia donde mira, por separado: el juego gira a todos en cada fotograma (crew.js lee
  // hacia dónde mira) y anima a los de lejos a menos fotogramas, con el tiempo que haya pasado desde la última vez
  update(dt, speed) { this.animate(dt, speed); this.turn(dt); }
  animate(dt, speed) {
    this.speed += (speed - this.speed) * Math.min(1, dt * 10);
    this.r.update(dt, this.speed);
    this.dirty = true;
  }
  turn(dt) {
    let d = this.targetYaw - this.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.root.rotation.y += d * Math.min(1, dt * 12);
  }
  // El detalle: 0 de cerca, 1 de lejos (ver persona.js setLod)
  set lod(n) { if (n !== this.lodNow) { this.lodNow = n; this.r.setLod(n); } }
  get lod() { return this.lodNow; }
  // Ya no se usa: suelta su malla compartida (persona.js release) y lo que es solo suyo (la barriga). La mochila es de
  // geometría propia con materiales compartidos
  dispose() {
    this.r.release();
    if (this.bag) for (const o of this.bag.children) if (o.geometry !== BUCKLE_GEO) o.geometry.dispose();   // (la hebilla es de todas)
    if (this.belly) { this.belly.geometry.dispose(); this.belly.material.dispose(); }
  }
  clone() { return new RealPerson(this.look, { kid: this.kid }); }
  // La mochila a la espalda (item: { id, color }) o ninguna (null): se pone y se quita sin rehacer la persona (rehacerla son
  // 100-250 ms de tirón). Devuelve la nueva, si la hay, para que quien la dibuja le ponga sus materiales (ver actors.js)
  setBag(item) {
    const k = item ? item.color || '#8a5a34' : null;
    if (k === this.bagKey) return null;
    this.bagKey = k;
    if (this.bag) { this.bag.parent?.remove(this.bag); for (const o of this.bag.children) if (o.geometry !== BUCKLE_GEO) o.geometry.dispose(); this.bag = null; }
    return item ? this.addBag(item) : null;
  }
  // Dónde le quedan a este cuerpo la espalda, el pecho y los hombros, en el hueso del pecho y en reposo (con el esqueleto
  // de cuando se hizo: así sale igual se ponga quieta, andando, sentada o agachada). Se mide una vez en su malla
  bagFit() {
    if (this.fit) return this.fit;
    const b = this.r.bones, v = new THREE.Vector3(), M = new THREE.Matrix4(), A = new THREE.Matrix4();
    let back = -0.08, front = 0.08, top = null;
    this.r.root.traverse(o => {
      if (!o.isSkinnedMesh) return;
      const sk = o.skeleton, iT = sk.bones.indexOf(b.torso), iA = sk.bones.indexOf(b.armL);
      if (iT < 0) return;
      M.multiplyMatrices(sk.boneInverses[iT], o.bindMatrix);   // (de la malla en reposo al hueso del pecho en reposo)
      if (top === null && iA >= 0) top = v.setFromMatrixPosition(A.copy(sk.boneInverses[iA]).invert()).applyMatrix4(sk.boneInverses[iT]).y;
      if (top === null) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 3) {
        v.fromBufferAttribute(pos, i).applyMatrix4(M);
        if (v.y > -0.02 && v.y < top - 0.05 && Math.abs(v.x) < 0.1) { back = Math.min(back, v.z); front = Math.max(front, v.z); }
      }
    });
    return (this.fit = { back, front, top: top ?? 0.3 });
  }
  // La mochila: cuerpo, solapa, bolsillo con su hebilla y las dos correas por encima de los hombros y bajo los brazos.
  // Cuelga del hueso del pecho y se ajusta a cada cuerpo (bagFit)
  addBag(item) {
    const T = this.r.bones.torso, W = window.LOOK, { back, front, top } = this.bagFit();
    // (todo el cuero en una sola malla con su color por vértice, y la hebilla aparte: 2 llamadas en vez de 14)
    const base = W.sobrio(item.color || '#8a5a34'), leather = base, dark = W.mix(base, '#1a120c', 0.38), parts = [];
    const g = new THREE.Group(), box = (c, x0, y0, z0, x1, y1, z1, r) => { const B = new Builder(); B.tint(c); B.roundBox(x0, y0, z0, x1, y1, z1, r, { s: 1 }); parts.push(B.geometry()); };
    const z = back + 0.012, y1 = top - 0.02, y0 = y1 - 0.36;
    box(leather, -0.135, y0, z - 0.14, 0.135, y1, z, 0.035);                 // el cuerpo
    box(dark, -0.14, y1 - 0.11, z - 0.15, 0.14, y1 + 0.012, z + 0.004, 0.03);   // la solapa
    box(dark, -0.09, y0 + 0.03, z - 0.165, 0.09, y0 + 0.15, z - 0.13, 0.012);   // el bolsillo
    const buckle = new THREE.Mesh(BUCKLE_GEO, BUCKLE); buckle.position.set(0, y1 - 0.11, z - 0.153); g.add(buckle);
    const strap = (a, c) => {
      const A = new THREE.Vector3(...a), d = new THREE.Vector3(...c).sub(A), len = d.length(), B = new THREE.BoxGeometry(0.034, len, 0.012);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
      B.applyMatrix4(new THREE.Matrix4().compose(A.clone().addScaledVector(d, 0.5), q, new THREE.Vector3(1, 1, 1)));
      parts.push(paint(B, dark));
    };
    for (const s of [-1, 1]) {
      const x = s * 0.095, sh = top + 0.062;
      strap([x, y1 - 0.02, z], [x, sh, back * 0.45]); strap([x, sh, back * 0.45], [x, sh - 0.012, front * 0.4]);       // sube por la espalda y pasa el hombro
      strap([x, sh - 0.012, front * 0.4], [x * 1.1, top - 0.1, front * 0.86]);                                       // baja por el pecho
      strap([x * 1.1, top - 0.1, front * 0.86], [x * 1.75, y0 + 0.14, front * 0.25]); strap([x * 1.75, y0 + 0.14, front * 0.25], [s * 0.13, y0 + 0.06, z - 0.03]);   // y bajo el brazo, a la mochila
    }
    g.add(new THREE.Mesh(mergeParts(parts), BAG));
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    T.add(g); this.bag = g;
    return g;
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
  const ball = BLANKET_BALL, cloth = c => BLANKET.get(c) || BLANKET.set(c, new THREE.MeshStandardMaterial({ color: W.sobrio(c), roughness: 0.95 })).get(c);
  for (const [c, p, s] of [['#f4e6c8', [0, 0.065, 0.08], [0.12, 0.08, 0.23]], ['#e88aa8', [0, 0.075, 0.15], [0.125, 0.07, 0.15]]]) {
    const m = new THREE.Mesh(ball, cloth(c)); m.position.set(...p); m.scale.set(...s); m.castShadow = m.receiveShadow = true; root.add(m);
  }
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  root.userData.release = r.release;   // (al quitarlo: ver Actors.drop; la manta es compartida)
  return root;
}
// La manta del bebé: dos colores fijos, compartidos por todos
const BLANKET_BALL = new THREE.SphereGeometry(1, 20, 14), BLANKET = new Map();
// Deja hecho el prototipo de una persona (persona.js prebuild), para que salga sin tirón cuando haga falta
export const prebuildReal = (look, kid = false) => persona().prebuild(toReal(look, kid));
// Cuántos prototipos hay, cuántos sin usar y cuántos lienzos
export const realStats = () => (P ? P.stats() : null);
