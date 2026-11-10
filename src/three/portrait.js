// Retratos de los diálogos: la cara en 3D de quien habla (la misma persona que en el juego, con su peinado,
// sus ojos, su barba…), de tres cuartos, con los hombros y una luz de estudio. Un solo renderizador para
// todos; cada retrato se pinta la primera vez que hace falta y se guarda.
import * as THREE from 'three';
import { RealPerson } from './realperson.js';
import { TONE_MAPPING, CURVA } from './look.js';
import { STUDIO } from './preview.js';

export const PORTRAIT_SIZE = 192;
const cache = new Map();
let R = null;

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
  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 20);
  return (R = { renderer, scene, camera });
}

// El retrato de un look, como lienzo de PORTRAIT_SIZE × PORTRAIT_SIZE (fondo transparente)
export function portrait3D(look) {
  const k = JSON.stringify(look);
  if (cache.has(k)) return cache.get(k);
  const { renderer, scene, camera } = R || setup();
  const p = new RealPerson(look);
  p.facing = 0.32;
  p.update(0.5, 0);
  p.root.rotation.y = 0.32;   // de tres cuartos, mirando un poco hacia la derecha
  scene.add(p.root);
  p.root.updateMatrixWorld(true);
  const head = p.head.getWorldPosition(new THREE.Vector3());
  camera.position.set(0, head.y + 0.1, 1.15); camera.lookAt(0, head.y + 0.02, 0);
  renderer.render(scene, camera);
  scene.remove(p.root);
  // (la persona es solo de este retrato: se suelta lo que ha subido a este renderizador)
  p.root.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.map?.dispose(); } });
  const out = document.createElement('canvas');
  out.width = out.height = PORTRAIT_SIZE;
  out.getContext('2d').drawImage(renderer.domElement, 0, 0);
  cache.set(k, out);
  return out;
}
