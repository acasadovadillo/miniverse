// Retratos de los diálogos: la cara en 3D de quien habla (el mismo muñeco que en el juego, con su peinado,
// sus ojos, su barba…), de tres cuartos, con los hombros y una luz de estudio. Un solo renderizador para
// todos; cada retrato se pinta la primera vez que hace falta y se guarda.
import * as THREE from 'three';
import { Person3D, G } from './people.js';
import { ARTE } from '../arte.js';
import { loadReal, realReady, RealPerson } from './realperson.js';

// (?arte=2, en revisión: el retrato de la persona realista, encuadrado en su cabeza; mientras carga, el del muñeco)
const REAL = ARTE === 2;
if (REAL) loadReal();

export const PORTRAIT_SIZE = 192;
const cache = new Map();
let R = null;

function setup() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(PORTRAIT_SIZE, PORTRAIT_SIZE, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const key = new THREE.DirectionalLight('#fff2dc', 2.5); key.position.set(-1.4, 2.4, 3);
  const rim = new THREE.DirectionalLight('#cfe0ff', 1.3); rim.position.set(2.2, 1.6, -2);
  scene.add(key, rim, new THREE.HemisphereLight('#eef2ff', '#7a5a3a', 1.15));
  // La cabeza está a 1,07 m del suelo: se encuadran la cabeza (con el pelo y la barba) y los hombros
  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 20);
  camera.position.set(0, 1.12, 2.05);
  camera.lookAt(0, 1.02, 0);
  return (R = { renderer, scene, camera });
}

const shared = new Set(Object.values(G));
// El retrato de un look, como lienzo de PORTRAIT_SIZE × PORTRAIT_SIZE (fondo transparente)
export function portrait3D(look) {
  const real = REAL && realReady(), k = (real ? 'R' : '') + JSON.stringify(look);
  if (cache.has(k)) return cache.get(k);
  const { renderer, scene, camera } = R || setup();
  const p = real ? new RealPerson(look) : new Person3D(look);
  p.facing = 0.32;
  p.update(real ? 0.5 : 0, 0);
  p.root.rotation.y = 0.32;   // de tres cuartos, mirando un poco hacia la derecha
  scene.add(p.root);
  if (real) {
    // (la cabeza de la persona realista va más alta: la cámara se pone a su altura, con los hombros)
    p.root.updateMatrixWorld(true);
    const head = p.head.getWorldPosition(new THREE.Vector3());
    camera.position.set(0, head.y + 0.1, 1.15); camera.lookAt(0, head.y + 0.02, 0);
  } else { camera.position.set(0, 1.12, 2.05); camera.lookAt(0, 1.02, 0); }
  renderer.render(scene, camera);
  scene.remove(p.root);
  p.root.traverse(o => { if (o.isMesh && !shared.has(o.geometry)) { o.geometry.dispose(); if (real) o.material.map?.dispose(); } });
  const out = document.createElement('canvas');
  out.width = out.height = PORTRAIT_SIZE;
  out.getContext('2d').drawImage(renderer.domElement, 0, 0);
  cache.set(k, out);
  return out;
}
