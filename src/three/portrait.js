// Retratos de los diálogos: la cara en 3D de quien habla (la misma persona que en el juego, con su peinado,
// sus ojos, su barba…), de tres cuartos, con los hombros y una luz de estudio. Un solo renderizador para
// todos; cada retrato se pinta la primera vez que hace falta y se guarda.
import * as THREE from 'three';
import { RealPerson } from './realperson.js';
import { TONE_MAPPING, CURVA } from './look.js';
import { STUDIO } from './preview.js';

export const PORTRAIT_SIZE = 192;
const FOV = 24;
const cache = new Map();
let R = null, size = PORTRAIT_SIZE + 'x' + PORTRAIT_SIZE;

function setup() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(PORTRAIT_SIZE, PORTRAIT_SIZE, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = TONE_MAPPING; renderer.toneMappingExposure = CURVA.exp;   // (como en el juego: ver STUDIO)
  const scene = new THREE.Scene();
  const key = new THREE.DirectionalLight('#fff2dc', 2.5 * STUDIO); key.position.set(-1.4, 2.4, 3);
  const rim = new THREE.DirectionalLight('#cfe0ff', 1.3 * STUDIO); rim.position.set(2.2, 1.6, -2);
  scene.add(key, rim, new THREE.HemisphereLight('#eef2ff', '#7a5a3a', 1.15 * STUDIO));
  // (la cámara se pone a la altura de cada cabeza, con los hombros: ver portrait3D)
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 20);
  return (R = { renderer, scene, camera });
}

// (este renderizador es otro contexto de la gráfica, que vive siempre: la malla, el material y el lienzo del prototipo,
// que son de todas las personas con este look, se quedarían subidos aquí mientras viva el vecino. Se pinta con copias
// que solo conoce él, y se sueltan al acabar: la textura copiada comparte la imagen, y soltarla solo la borra de aquí)
function ownCopies(p) {
  if (p.mhb) return mhCopies(p);
  const mesh = p.r.mesh, own = [mesh.geometry.clone(), mesh.material.clone()];
  const base = mesh.material;
  own[1].onBeforeCompile = base.onBeforeCompile; own[1].customProgramCacheKey = base.customProgramCacheKey;   // (clone() no copia el parche de la piel)
  if (base.map) own.push((own[1].map = base.map.clone()));
  [mesh.geometry, mesh.material] = own;
  return own;
}
// A MakeHuman body (plan CR P5, ?creador=nuevo: three/mh/ingame.js), drawn whole: the same, for each of its near parts
// (the first three are a geometry, a material and a map, as the ring person's, for Figure.dispose)
function mhCopies(p) {
  p.mhLevel = 0;
  const own = [];
  for (const o of p.mhb.parts) {
    const g = o.geometry.clone(), one = m => {
      const c = m.clone();
      if (m.onBeforeCompile) { c.onBeforeCompile = m.onBeforeCompile; c.customProgramCacheKey = m.customProgramCacheKey; }
      for (const k of ['map', 'alphaMap', 'bumpMap']) if (m[k]) own.push((c[k] = m[k].clone()));
      own.push(c);
      return c;
    };
    o.geometry = g; o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
    own.push(g);
  }
  const first = own.findIndex(x => x.isBufferGeometry), mat = own.find(x => x.isMaterial);
  return [own[first], mat, null, ...own.filter((x, i) => i !== first && x !== mat)];
}
// The size of what this renderer paints: a portrait's, or the figure's (Figure). Only touched when it changes
function sized(w, h) {
  const k = `${w}x${h}`;
  if (k !== size) { size = k; R.renderer.setSize(w, h, false); }
}
// Is the portrait of this look painted already? (then portrait3D is at once)
export const portraitReady = look => cache.has(JSON.stringify(look));

// El retrato de un look, como lienzo de PORTRAIT_SIZE × PORTRAIT_SIZE (fondo transparente)
export function portrait3D(look) {
  const k = JSON.stringify(look);
  if (cache.has(k)) return cache.get(k);
  const { renderer, scene, camera } = R || setup();
  let p;
  try { p = new RealPerson(look, { now: true }); }
  catch (err) {   // (si no se puede hacer, un retrato vacío: el juego sigue)
    console.warn('Miniverse: no se pudo hacer el retrato', err);
    const out = document.createElement('canvas');
    out.width = out.height = PORTRAIT_SIZE;
    cache.set(k, out);
    return out;
  }
  const own = ownCopies(p);
  p.facing = 0.32;
  p.update(0.5, 0);
  p.root.rotation.y = 0.32;   // de tres cuartos, mirando un poco hacia la derecha
  scene.add(p.root);
  p.root.updateMatrixWorld(true);
  const head = p.head.getWorldPosition(new THREE.Vector3());
  if (camera.fov !== FOV || camera.aspect !== 1) { camera.fov = FOV; camera.aspect = 1; camera.updateProjectionMatrix(); }
  camera.position.set(0, head.y + 0.1, 1.15); camera.lookAt(0, head.y + 0.02, 0);
  sized(PORTRAIT_SIZE, PORTRAIT_SIZE);
  renderer.render(scene, camera);
  scene.remove(p.root);
  // (se sueltan las copias y la persona, no su malla ni su lienzo de verdad: son los mismos que los de quien tenga este look
  // en el mundo, y geometry.dispose los borraría también de la gráfica del juego. Se liberan juntos cuando ya no los usa
  // nadie: persona.js trim)
  for (const x of own) x?.dispose();
  p.r.mesh.skeleton?.dispose();
  p.mhb?.skel.dispose();   // (its bones' texture: one for each person painted would stay here)
  p.dispose();
  const out = document.createElement('canvas');
  out.width = out.height = PORTRAIT_SIZE;
  out.getContext('2d').drawImage(renderer.domElement, 0, 0);
  cache.set(k, out);
  return out;
}

// The whole body, standing, in a 2D canvas: the pause's Character page (src/ui/charpage.js). It is painted with the
// portraits' renderer (no other context) and only when asked: on opening, on turning and on new clothes. Its person is
// made in look() and let go, with its copies in the graphics card, in dispose() (the page calls it when it is left)
export class Figure {
  static held = null;
  constructor(canvas) { this.canvas = canvas; this.angle = 0.3; this.person = null; this.own = null; this.lookNow = null; }
  look(look, surface = null) {
    if (look !== this.lookNow || !this.person) {
      this.dispose();
      if (!R) setup();
      try { this.person = new RealPerson({ ...look }, { now: true }); } catch (err) { console.warn('Miniverse: no se pudo hacer la figura', err); return; }
      this.own = ownCopies(this.person);
      this.lookNow = look;
      this.person.update(0.5, 0);
    }
    try { this.person.setGrime?.(surface); } catch { /* (drawn clean) */ }
  }
  // w × h: the canvas, in its own pixels
  draw(w, h) {
    const p = this.person, cv = this.canvas;
    if (!p || !(w > 0) || !(h > 0)) return;
    const { renderer, scene, camera } = R;
    cv.width = w; cv.height = h;
    p.facing = this.angle; p.root.rotation.y = this.angle; p.root.position.y = 0;
    scene.add(p.root);
    const tall = p.height * 1.16, a = w / h, half = Math.tan(FOV / 2 * Math.PI / 180), d = Math.max(tall / 2 / half, 1.15 / 2 / (half * a));
    camera.fov = FOV; camera.aspect = a; camera.updateProjectionMatrix();
    camera.position.set(0, p.height * 0.58, d); camera.lookAt(0, p.height * 0.5, 0);
    sized(w, h);
    renderer.render(scene, camera);
    scene.remove(p.root);
    const g = cv.getContext('2d'), foot = new THREE.Vector3(0, 0, 0).project(camera), fy = (1 - foot.y) / 2 * h, r = 0.4 / (2 * half * d) * h;
    // (its shadow on the floor)
    const sh = g.createRadialGradient(0, 0, 0, 0, 0, r);
    sh.addColorStop(0, 'rgba(0, 0, 0, .5)'); sh.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.save(); g.translate(w / 2, fy); g.scale(1, 0.22); g.fillStyle = sh; g.fillRect(-r, -r, r * 2, r * 2); g.restore();
    g.drawImage(renderer.domElement, 0, 0);
  }
  dispose() {
    if (this.person) {
      // (its program stays, with the last material that used it, without its map: compiling it again would be a stumble of a
      // tenth of a second each time the page opens)
      const [geo, mat, map, ...more] = this.own;
      geo.dispose(); map?.dispose(); mat.map = null;
      for (const x of more) x.dispose();   // (a MakeHuman body's other parts)
      this.person.mhb?.skel.dispose();
      Figure.held?.dispose();
      Figure.held = mat;
      this.person.r.mesh.skeleton?.dispose();
      this.person.dispose();
      this.person = this.own = null;
      sized(PORTRAIT_SIZE, PORTRAIT_SIZE);   // (and its bigger buffer)
    }
    this.lookNow = null;
  }
}
// (for the tests: what the portraits' renderer keeps in the graphics card)
export const portraitMemory = () => (R ? { ...R.renderer.info.memory } : null);
