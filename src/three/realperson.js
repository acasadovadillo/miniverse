// Las personas del juego: el cuerpo de la prueba de aspecto (real/persona.js, con sus peinados de real/pelo.js y las
// ayudas de real/base.js), con la ropa, el peinado y los colores de cada look del juego. Sus huesos se llaman como las
// piezas de los muñecos de antes (piernas, espinillas, brazos, antebrazos, tronco, cabeza), así que lo que hace el juego
// con ellas (mirar a quien pasa, agacharse, el gesto de la herramienta, sentarse, tumbarse, montar) las mueve igual.
import * as THREE from 'three';
import { fullLook, clothesFor } from '../looks.js';
import { Builder, paint, mergeParts } from './geo.js';
import { KIT_MAT } from './kit3d.js';
import { injectGrime, grimeMaterial, writeGrime, clearGrime, hasGrime } from './grime.js';
import { apagada } from '../opciones.js';
import { mhOfLook } from './mh/folk.js';
import { mhData, shapeReady, MhBody, prebuildMh } from './mh/ingame.js';
// (se cargan con el juego, en este orden: base.js deja window.LOOK con sus ayudas, y pelo y persona solo se apuntan en
// LOOK.parts; THREE lo usan dentro de sus funciones, así que basta con dárselo antes de construir a nadie. Así entran
// también en la lista de archivos que index.html vuelve a pedir sin caché al cambiar de versión)
import './real/base.js';
import './real/pelo.js';
import './real/persona.js';

let P = null;
const KID = 0.68;   // la estatura de un niño, de la de un adulto
// The surface overlay (three/grime.js: dirt, mud, wet, snow, blood, sweat), installed for every persona material before
// the first person is built, so the one persona program carries it. ?cuerpo=0: not installed, the program of before
const GRIME = !apagada('cuerpo');
const grimeHook = (sh, mat) => injectGrime(sh, mat, { skin: 'vPiel.y', hair: 'vPiel.z', rough: 'float roughnessFactor = vPiel.x;' });
// El generador, la primera vez que hace falta (el servidor sin pantalla no construye a nadie)
const persona = () => (P ||= ((window.LOOK.THREE = THREE), GRIME && (window.LOOK.grime = grimeHook), window.LOOK.parts.persona(THREE, window.LOOK)));
// (las páginas de prueba lo esperan: docs/pruebas-arte/t10/hoja.html y medir.html)
export const loadReal = () => Promise.resolve(persona());

// Los peinados del juego, en los de la prueba (los que no tiene, el más parecido)
const HAIR = {
  corto: 'corto', largo: 'largo', coleta: 'coleta', rizado: 'rizado', mono: 'mono', rapado: 'rapado', calvo: 'calvo', pinchos: 'pinchos', melena: 'largo',
  coletas: 'coleta', trenza: 'trenza', cresta: 'cresta', tupe: 'tupe', afro: 'rizado', rastas: 'largo', coletaAlta: 'coleta', monos: 'mono', trenzas: 'trenza',
  ondas: 'largo', flequillo: 'corto', mullet: 'corto', tazon: 'corto', samurai: 'mono',
};
// The real style a hairstyle of the game is drawn with: two that share one look the same (the barber charges nothing for
// going from one to the other: barber.js)
export const realHair = style => HAIR[style] || 'corto';
const hash = s => { let h = 7; for (const ch of s) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0; return h >>> 0; };
// The new garments of Plan E (docs/planes/gta/PLAN-E-cuerpo-aspecto.md §3.1) in the shapes of E3 (§5.3, real/persona.js
// GARMENTS): the wool coat is `abrigo` (to the knee; over a tunic it takes the tunic's place and the tunic shows under its
// hem), the sheepskin jacket `zamarra` (over the waistcoat, which it covers), the linen shirt a shirt with short sleeves,
// the lined boots have a fleece cuff, the leather apron is a hide. A torn piece (wear[slot].r, 1 worn or 2 torn, §3.2)
// carries `rota`. (Only the fields a garment needs are set, so the looks of before keep their prototype keys.)
const FLEECE = '#d9cbae';      // the sheepskin's fleece, undyed
const COAT_HEM = 0.42;         // m from the ground: the hem of a knee-length coat
// El look del juego, en el de la persona realista: sexo, piel, pelo, cara y la ropa que lleva puesta
export function toReal(look, kid = false) {
  const L = fullLook(look), W = look.wear || clothesFor(L), girl = L.sex === 'chica', g = [];
  const col = it => it && it.color, torn = (o, it) => { if (it && it.r > 0) o.rota = Math.min(2, it.r | 0); return o; };
  const torso = W.torso?.id, top = W.encima?.id, legs = W.piernas?.id, outer = W.outer?.id;
  const tunic = torso === 'tunica' || torso === 'tunica_larga', coat = outer === 'wool_coat' || outer === 'wolf_lined_coat', jacket = outer === 'sheepskin_jacket';
  if (tunic) g.push(torn({ id: 'tunica', color: col(W.torso) }, W.torso));
  else if (torso) {
    const shirt = torso === 'linen_shirt' ? { id: 'camisa', color: col(W.torso), fino: true, manga: 'corta' } : { id: 'camisa', color: col(W.torso) };
    if (W.torso.r > 0 && W.interiorArriba) shirt.debajo = col(W.interiorArriba);   // (what a hole shows)
    g.push(torn(shirt, W.torso));
  } else if (W.interiorArriba) g.push({ id: 'camisa', color: col(W.interiorArriba) });
  let coatHem = 0;
  if (coat) {
    // (first in the list; what it covers shows at the neck and through a torn elbow)
    const c = torn({ id: 'abrigo', color: col(W.outer), camisola: col(W.torso || W.interiorArriba) || '#d3c9b4' }, W.outer);
    if (tunic) { c.bajo = COAT_HEM; c.debajo = torn({ color: col(W.torso) }, W.torso); g[0] = c; } else { g.unshift(c); coatHem = COAT_HEM; }
  }
  if (legs === 'pantalon') g.push(torn({ id: 'pantalon', color: col(W.piernas) }, W.piernas));
  else if (legs?.startsWith('grebas_')) g.push({ id: 'pantalon', color: col(W.piernas) });
  if (jacket) g.push({ id: 'zamarra', color: col(W.outer), vellon: FLEECE });
  else if (top === 'chaleco' && !coat) g.push({ id: 'chaleco', color: col(W.encima) });   // (the coat and the jacket cover it)
  // (an apron goes under the wool coat, which covers it to the knee)
  if (coat) { /* covered */ }
  else if (top === 'delantal') g.push({ id: 'delantal', color: col(W.encima) });
  else if (top === 'leather_apron') g.push({ id: 'delantal', color: col(W.encima), cuero: true });
  if (!legs || legs === 'falda') g.push(W.calcetines?.id === 'wool_socks' ? { id: 'medias', color: col(W.calcetines), lana: true } : { id: 'medias', color: col(W.calcetines) || '#5f5346' });
  g.push(W.pies?.id === 'lined_boots' ? { id: 'botas', color: col(W.pies) || '#5a4030', forro: FLEECE } : { id: W.pies ? 'botas' : 'zapatos', color: col(W.pies) || '#5a4030' });
  // (la semilla, sin la mochila ni el abrigo: ponérselos o quitárselos no cambia la cara ni la postura; la mochila se pone
  // sin rehacer la persona)
  // (and without the growth steps, hairGrow and beardGrow, that game.appearance() adds, nor the tear stage of a piece,
  // wear[slot].r: hair that grows and a shirt that tears keep the face and the posture; a look without them hashes as it
  // always did). Nor the new creator's shapes (look.mh, plan CR): this person does not draw them yet
  const hat = W.cabeza?.id, lw = look.wear, grown = look.hairGrow !== undefined || look.beardGrow !== undefined || look.mh !== undefined;
  const bare = grown ? { ...look, hairGrow: undefined, beardGrow: undefined, mh: undefined } : look, tears = lw && Object.values(lw).some(it => it && it.r !== undefined);
  let wearH = null;
  if (lw?.espalda || lw?.outer || tears) {
    wearH = { ...lw, espalda: undefined, outer: undefined };
    if (tears) for (const k in wearH) if (wearH[k] && wearH[k].r !== undefined) { const { r, ...rest } = wearH[k]; wearH[k] = rest; }
  }
  const seed = hash(JSON.stringify(wearH ? { ...bare, wear: wearH } : bare));
  const out = {
    sex: girl ? 'f' : 'm', build: 'medio', skin: L.skin, hair: L.hair, hairStyle: HAIR[L.hairStyle] || 'corto', ojos: L.eyes,
    eyeStyle: L.eyeStyle, brows: L.brows, nose: L.nose, semilla: seed % 97, garments: g,
  };
  // The beard: the shape chosen (bigote, perilla, candado, completa, larga; an old `beard: true` is completa, fullLook) and
  // how far it has grown (Plan E §2.5: beardGrow 0..4), and the hair's growth (hairGrow 0..3: real/pelo.js crece)
  if (L.beard && L.beard !== 'no' && !kid) out.barba = L.beard;
  if (look.beardGrow > 0 && !kid && !girl) out.barbaLargo = Math.min(4, look.beardGrow | 0);
  if (look.hairGrow > 0) out.crece = Math.min(3, look.hairGrow | 0);
  // Un niño: la cabeza más grande para su cuerpo (5 cabezas de alto en vez de 6,8), más fino y a 1,17 m
  if (kid) Object.assign(out, { cabezas: 5, build: 'fino', escala: KID });
  if (coatHem) out.largoFalda = coatHem;
  // (an apron hangs as a 3D plate over the trousers: persona.js delantalPlancha. Over a skirt, it always had it)
  if (!coat && (top === 'leather_apron' || (top === 'delantal' && legs && legs !== 'falda'))) out.delantalPlancha = true;
  if (hat === 'sombrero') out.sombrero = 'paja';
  else if (hat === 'gorro') out.sombrero = 'boina';
  else if (hat === 'hijab') { out.hairStyle = 'panuelo'; out.panuelo = col(W.cabeza); }
  return out;
}

const EMPTY_GEO = new THREE.BufferGeometry();   // (a kit mesh with nothing to show keeps this, never released)
const BELT_Y = [0.02, 0.12];                     // (where the belt is measured, over the hip bone)
// La mochila: el cuero (con su color por vértice, el de cada mochila) y la hebilla, compartidos por todas
const BAG = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.84 });
const BUCKLE = new THREE.MeshStandardMaterial({ color: '#b8964a', metalness: 0.5, roughness: 0.4 }), BUCKLE_GEO = new THREE.BoxGeometry(0.03, 0.03, 0.01);
// Una persona con lo que el juego espera de ella: root, body, torso, head, legs, shins, arms, fore (índice 0 a -x y
// 1 a +x), facing, update, clone…
export class RealPerson {
  // (folk: not a player, who wears a MakeHuman body with ?creador=nuevo even without look.mh; now: the player's, made at
  // once: see wearMh)
  constructor(look, { kid = false, folk = false, now = false } = {}) {
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
    const W = look.wear || clothesFor(fullLook(look)), top = W.outer || (W.encima?.id === 'delantal' || W.encima?.id === 'leather_apron' ? W.encima : W.torso || W.interiorArriba);
    this.bellyColor = window.LOOK.sobrio(top?.color || fullLook(look).skin);
    this.targetYaw = 0; this.speed = 0;
    this.bag = null; this.bagKey = null;
    // (the surface overlay: the shared material of its look, the own one while it has a surface, and its height at rest)
    this.shared = r.mesh.material; this.grimeMat = null; this.grimeOn = false; this.grimeTall = r.d?.alto || 1.7;
    // The new creator's body (plan CR P5, ?creador=nuevo: three/mh/ingame.js), on these same bones; until it is made (the
    // pack still on its way, or another one made this frame), today's person
    this.mhb = null; this.mhWant = kid ? null : mhOfLook(look, folk); this.mhNow = now;
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
    if (this.mhWant && (now || shapeReady(look, this.mhWant))) this.wearMh();   // (else when actors.js says: buildNext)
  }
  // Puts the MakeHuman body on (false while it cannot be made yet: the pack on its way). Its hips, height and fits are its
  // own from then on; mhFresh tells actors.js to place the tools on the body again
  wearMh() {
    if (this.mhb || !this.mhWant || !mhData()) return false;
    try { this.mhb = new MhBody(this.look, this.mhWant, this.r); }
    catch (err) { console.warn('Miniverse: no MakeHuman body', err); this.mhWant = null; return false; }
    this.mhb.attach(this.r.root);
    this.mhb.near.traverse(o => { if (o.isMesh) o.receiveShadow = true; });
    this.hipY = this.mhb.hipY; this.height = this.grimeTall = this.mhb.height;
    this.fit = this.belt = null;
    if (this.bag) { const k = this.bagKey; this.bagKey = undefined; this.setBag(k ? { color: k } : null); }
    this.mhFresh = true; this.dirty = true;
    return true;
  }
  // The level of detail of a MakeHuman body (0 near, 1 middle, 2 far: ingame.js), chosen by actors.js
  set mhLevel(n) { this.mhb?.setLevel(n); }
  get mhLevel() { return this.mhb ? this.mhb.level : -1; }
  set facing(yaw) { this.targetYaw = yaw; }
  get facing() { return this.targetYaw; }
  // Andar y posar (los huesos) y girar hacia donde mira, por separado: el juego gira a todos en cada fotograma (crew.js lee
  // hacia dónde mira) y anima a los de lejos a menos fotogramas, con el tiempo que haya pasado desde la última vez
  // (gait: 0 walk, 1 jog, 2 sprint, or undefined to go by the speed alone: real/persona.js update)
  update(dt, speed, gait) { this.animate(dt, speed, gait); this.turn(dt); }
  animate(dt, speed, gait) {
    this.speed += (speed - this.speed) * Math.min(1, dt * 10);
    this.r.update(dt, this.speed, gait);
    this.dirty = true;
    if (this.mhb) { this.mhb.afterPose(); this.mhb.face(dt, !!this.say); }   // (say: talking, actors.js)
  }
  turn(dt) {
    let d = this.targetYaw - this.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.root.rotation.y += d * Math.min(1, dt * 12);
  }
  // El detalle: 0 de cerca, 1 de lejos (ver persona.js setLod)
  set lod(n) { if (this.mhb) return; if (n !== this.lodNow) { this.lodNow = n; this.r.setLod(n); } }   // (a MakeHuman body: mhLevel)
  get lod() { return this.mhb ? (this.mhb.level === 2 ? 1 : 0) : this.lodNow; }
  // Triangles drawn now (F3 and the bench)
  get tris() { return this.mhb ? this.mhb.tris : this.lodNow ? this.r.trisL : this.r.tris; }
  // Ya no se usa: suelta su malla compartida (persona.js release) y lo que es solo suyo (la barriga). La mochila es de
  // geometría propia con materiales compartidos
  dispose() {
    this.mhb?.dispose();
    this.r.release();
    for (const o of Object.values(this.kit || {})) if (o.geometry !== EMPTY_GEO) o.geometry.dispose();   // (the tools on the body: their geometry is only theirs)
    if (this.bag) for (const o of this.bag.children) if (o.geometry !== BUCKLE_GEO) o.geometry.dispose();   // (la hebilla es de todas)
    if (this.belly) { this.belly.geometry.dispose(); this.belly.material.dispose(); }
    if (this.grimeMat) { this.grimeMat.dispose(); this.grimeMat = null; }   // (never its map: the look's, shared)
  }
  // What the world has left on this body (body.surface()'s shape, each 0..1: dirt, mud, wet, wetLegs, snow, blood, sweat,
  // shiver), or null for clean: drawn by the shader overlay (three/grime.js), never repainted, so it costs no rebuild.
  // Someone on the shared material of their look gets a material of their own while they have a surface (same program:
  // nothing is compiled) and goes back to the shared one when clean; a copy someone else made (the player's, for the
  // outline; a spectator's see-through one) just gets the values. Cheap enough to call every frame
  setGrime(s) {
    if (!GRIME) return;
    const mesh = this.r.mesh, on = hasGrime(s);
    if (!on) {
      if (!this.grimeOn) return;
      this.grimeOn = false;
      const cur = mesh.material;
      if (cur !== this.shared && cur !== this.grimeMat) clearGrime(cur);
      if (this.grimeMat) {
        if (mesh.material === this.grimeMat) mesh.material = this.shared;
        if (mesh.userData.solid === this.grimeMat) mesh.userData.solid = this.shared;   // (a spectator's: actors.js ghost)
        this.grimeMat.dispose(); this.grimeMat = null;
      }
      return;
    }
    this.grimeOn = true;
    const cur = mesh.material;
    if (cur === this.shared || mesh.userData.solid === this.shared) {
      this.grimeMat = grimeMaterial(this.shared);
      if (cur === this.shared) mesh.material = this.grimeMat; else mesh.userData.solid = this.grimeMat;
    }
    if (this.grimeMat) writeGrime(this.grimeMat, s, this.grimeTall);
    if (mesh.material !== this.grimeMat) writeGrime(mesh.material, s, this.grimeTall);
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
    (this.mhb?.near || this.r.root).traverse(o => {
      if (!o.isSkinnedMesh || !this.fits(o)) return;
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
  // (a MakeHuman body's skin is measured, not its hair; nor the clothes, which only add a few mm)
  fits(o) { return !this.mhb || o.name === 'body'; }
  // Where the belt goes on this body, in the hip bone and at rest (as bagFit, measured once): w, half the width of the
  // waist; back and front, how far it goes behind and in front (for the tools hanging at the hip: kit3d.js)
  beltFit() {
    if (this.belt) return this.belt;
    const b = this.r.bones, v = new THREE.Vector3(), M = new THREE.Matrix4();
    let w = 0.15, back = -0.1, front = 0.1, found = false;
    (this.mhb?.near || this.r.root).traverse(o => {
      if (!o.isSkinnedMesh || found || !this.fits(o)) return;
      const sk = o.skeleton, i = sk.bones.indexOf(b.body);
      if (i < 0) return;
      found = true; w = 0; back = 0; front = 0;
      M.multiplyMatrices(sk.boneInverses[i], o.bindMatrix);
      // (the arms hang by the waist at rest: their vertices do not count)
      const arm = new Set(['armL', 'armR', 'foreL', 'foreR', 'handL', 'handR'].map(n => sk.bones.indexOf(b[n])).filter(j => j >= 0));
      const pos = o.geometry.attributes.position, si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight;
      for (let k = 0; k < pos.count; k += 2) {
        if (si && sw && ((sw.getX(k) > 0.2 && arm.has(si.getX(k))) || (sw.getY(k) > 0.2 && arm.has(si.getY(k))) || (sw.getZ(k) > 0.2 && arm.has(si.getZ(k))) || (sw.getW(k) > 0.2 && arm.has(si.getW(k))))) continue;
        v.fromBufferAttribute(pos, k).applyMatrix4(M);
        if (v.y < BELT_Y[0] || v.y > BELT_Y[1]) continue;
        if (Math.abs(v.z) < 0.08) w = Math.max(w, Math.abs(v.x));
        if (Math.abs(v.x) < 0.08) { back = Math.min(back, v.z); front = Math.max(front, v.z); }
      }
    });
    return (this.belt = { w: w || 0.15, back: back || -0.1, front: front || 0.1 });
  }
  // The tools on the body ({ back, hip }: geometries from kit3d.js buildKit, or null): two meshes at most, made the first
  // time and kept (on the chest bone and the hip bone), so only their geometry changes (the one before is released).
  // Returns the meshes made this time, for whoever draws them to give them their materials (as setBag; see actors.js)
  setKit({ back = null, hip = null } = {}) {
    const made = [], kit = (this.kit ||= {});
    for (const [k, bone, geo] of [['back', this.r.bones.torso, back], ['hip', this.r.bones.body, hip]]) {
      let o = kit[k];
      if (!geo) { if (o) { o.geometry.dispose(); o.geometry = EMPTY_GEO; o.userData.has = false; o.visible = false; } continue; }
      if (!o) {
        o = kit[k] = new THREE.Mesh(geo, KIT_MAT);
        o.castShadow = k === 'back'; o.receiveShadow = true;   // (the hip ones give no shadow: it would not be seen, and costs)
        bone.add(o); made.push(o);
      } else { if (o.geometry !== EMPTY_GEO) o.geometry.dispose(); o.geometry = geo; }
      o.userData.has = true; o.visible = true;
    }
    return made;
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
      this.belly.position.set(0, -0.05 + 0.01 * k, 0.03 + 0.045 * k + (this.mhb ? this.mhb.bellyFront - 0.1 : 0));   // (a MakeHuman belly, as far out as its waist)
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
// And its MakeHuman body (plan CR P5, ?creador=nuevo), for someone who is not a player: folk.js; false if made already
export const prebuildBody = (look, kid = false) => !kid && mhData() !== null && prebuildMh(look, mhOfLook(look, true));
// Is it made already (so putting it on screen costs nothing)?
export const realReady = (look, kid = false) => persona().ready(toReal(look, kid));
// Cuántos prototipos hay, cuántos sin usar y cuántos lienzos
export const realStats = () => (P ? P.stats() : null);
