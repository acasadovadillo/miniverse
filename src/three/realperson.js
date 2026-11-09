// Las personas realistas (en revisión, detrás de ?arte=2): el cuerpo de la prueba de aspecto (real/persona.js, con sus
// peinados de real/pelo.js y las ayudas de real/base.js), con la ropa, el peinado y los colores de cada look del juego.
// Fase 1: andar y estar de pie. Sus huesos se llaman como las piezas de los muñecos de siempre (piernas, espinillas,
// brazos, antebrazos, tronco, cabeza), así que lo que hace el juego con ellas (mirar a quien pasa, agacharse, el
// gesto de la herramienta, sentarse) mueve también a estas; sentarse, tumbarse, montar y la barriga se afinan después.
import * as THREE from 'three';
import { fullLook, clothesFor } from '../looks.js';

let P = null, loading = null;
// Carga el generador (una vez); cuando acaba, realReady() es true
export function loadReal() {
  return (loading ||= (async () => {
    await import('./real/base.js');
    window.LOOK.THREE = THREE;
    await import('./real/pelo.js');
    await import('./real/persona.js');
    P = window.LOOK.parts.persona(THREE, window.LOOK);
    return P;
  })().catch(e => { console.warn('No se han podido cargar las personas realistas: se quedan los muñecos', e); return null; }));
}
export const realReady = () => !!P;

// Los peinados del juego, en los de la prueba (los que no tiene, el más parecido)
const HAIR = {
  corto: 'corto', largo: 'largo', coleta: 'coleta', rizado: 'rizado', mono: 'mono', rapado: 'corto', calvo: 'corto', pinchos: 'pinchos', melena: 'largo',
  coletas: 'coleta', trenza: 'trenza', cresta: 'cresta', tupe: 'tupe', afro: 'rizado', rastas: 'largo', coletaAlta: 'coleta', monos: 'mono', trenzas: 'trenza',
  ondas: 'largo', flequillo: 'corto', mullet: 'corto', tazon: 'corto', samurai: 'mono',
};
const hash = s => { let h = 7; for (const ch of s) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0; return h >>> 0; };
// El look del juego, en el de la persona realista: sexo, piel, pelo, cara y la ropa que lleva puesta
export function toReal(look) {
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
  if (L.beard && L.beard !== 'no') out.barba = 'corta';
  if (hat === 'sombrero') out.sombrero = 'paja';
  else if (hat === 'gorro') out.sombrero = 'boina';
  else if (hat === 'hijab') { out.hairStyle = 'panuelo'; out.panuelo = col(W.cabeza); }
  return out;
}

// Una persona realista con lo que el juego espera de un muñeco (Person3D): root, body, torso, head, legs, shins,
// arms, fore (índice 0 a -x y 1 a +x, como en los muñecos), facing, update, clone…
export class RealPerson {
  constructor(look) {
    this.look = look; this.real = true;
    const r = (this.r = P.build(toReal(look)));
    this.root = new THREE.Group();
    this.root.add(r.root);
    const b = r.bones;
    this.body = b.body; this.torso = b.torso; this.head = b.head; this.hand = b.handL;
    this.legs = [b.legR, b.legL]; this.shins = [b.shinR, b.shinL]; this.arms = [b.armR, b.armL]; this.fore = [b.foreR, b.foreL];
    this.skirt = null;
    // Para el juego: la cadera (lo que hay que bajar al sentarse, comparado con los muñecos) y cuánto se agacha
    this.hipY = b.body.position.y; this.dropK = this.hipY / 0.36; this.height = r.d?.alto || 1.7;
    this.targetYaw = 0; this.speed = 0;
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
  clone() { return new RealPerson(this.look); }
  fitSkirt() {}
  setBelly() { return false; }
}
