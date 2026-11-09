// Iconos hechos desde los modelos 3D: lo que se coloca (muebles, estaciones, cosas del rancho) y las
// herramientas y armas se dibujan una vez con el mismo modelo que en el mundo, de tres cuartos, en un lienzo
// pequeño (ICON3D píxeles, con contorno, como los iconos de píxel), y se guardan. Los materiales, la comida, las
// semillas, los peces, los bichos, la ropa, las alfombras y los cuadros siguen a píxel (art/items.js): a 16
// píxeles se leen mejor dibujados a mano. También da el modelo en miniatura de lo que se tira al suelo.
import { foodModel } from './food3d.js';
import * as THREE from 'three';
import { getModel, modelMat } from './models.js';
import { toolModel } from './actors.js';
import { ITEMS } from '../items.js';
import { mk, outlined } from '../util.js';

export const ICON3D = 36;   // píxeles del icono (la interfaz los escala, como a los de píxel)
const SS = 4;               // se dibuja a SS veces el tamaño y se reduce, para suavizar los bordes
const VIEW = { placed: [-1, 0.95, 1.2], tool: [0.25, 0.5, 1] };   // desde dónde se mira (el frente del modelo mira a +z)
const PIXEL = new Set(['cana', 'cana_fibra', 'red']);   // (largos y finos: a 36 píxeles no se leen; siguen a píxel)
const FLAME = new THREE.MeshBasicMaterial({ color: '#ffb040' }), FLAME_GEO = new THREE.SphereGeometry(0.08, 8, 6);
const cache = new Map();
let R = null;

function setup() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(ICON3D * SS, ICON3D * SS, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setClearColor(0, 0);
  const scene = new THREE.Scene();
  const key = new THREE.DirectionalLight('#fff2dc', 2.4); key.position.set(-2, 3, 2.5);
  const rim = new THREE.DirectionalLight('#cfe0ff', 0.9); rim.position.set(2.5, 1.5, -1.5);
  scene.add(key, rim, new THREE.HemisphereLight('#eef2ff', '#7a5a3a', 1.45));
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  return (R = { renderer, scene, camera });
}

// De qué clase es el modelo de un objeto: 'tool' (herramienta o arma), 'placed' (lo que se coloca) o nada (va a píxel)
export function modelKind(id) {
  const def = ITEMS[id];
  if (!def || def.wear || PIXEL.has(id)) return null;
  if (def.tool || def.weapon || def.bow) return 'tool';
  if (def.place && def.place !== 'wall' && !def.rug && getModel(id)) return 'placed';
  return null;
}

// El modelo de un objeto como grupo de mallas (made: las geometrías hechas aquí, para poder soltarlas)
function build(id, kind, made) {
  const g = new THREE.Group();
  if (kind === 'tool') { const t = toolModel(id); t.rotation.set(0, 0, 0); g.add(t); return g; }
  const m = getModel(id);
  for (const [key, B] of m.parts) if (!B.empty) { const mesh = B.mesh(modelMat(key), { cast: false, receive: false }); made?.push(mesh.geometry); g.add(mesh); }
  for (const e of m.extras) g.add(e.clone());
  for (const [x, y, z, s] of m.fires) { const f = new THREE.Mesh(FLAME_GEO, FLAME); f.position.set(x, y + 0.06 * s, z); f.scale.setScalar(s); g.add(f); }
  return g;
}

// El icono de un objeto con modelo 3D (lienzo de ICON3D × ICON3D con contorno), o null si va a píxel
export function modelIcon(id) {
  if (cache.has(id)) return cache.get(id);
  const kind = modelKind(id);
  if (!kind) return null;
  const { renderer, scene, camera } = R || setup(), made = [];
  const g = build(id, kind, made);
  if (kind === 'tool') g.rotation.z = -0.75;   // (el mango abajo a la izquierda y la cabeza arriba a la derecha)
  scene.add(g);
  g.updateMatrixWorld(true);
  // La cámara, mirando al centro del modelo desde su lado; el encuadre, justo el que ocupan sus esquinas
  const box = new THREE.Box3().setFromObject(g), c = box.getCenter(new THREE.Vector3()), dir = new THREE.Vector3(...VIEW[kind]).normalize();
  camera.position.copy(c).addScaledVector(dir, 10);
  camera.lookAt(c);
  camera.updateMatrixWorld(true);
  const v = new THREE.Vector3(); let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(camera.matrixWorldInverse);
    x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
  }
  const half = Math.max(x1 - x0, y1 - y0) / 2 * 1.08, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  Object.assign(camera, { left: cx - half, right: cx + half, top: cy + half, bottom: cy - half, near: 0.1, far: 30 });
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  scene.remove(g);
  for (const geo of made) geo.dispose();
  const out = mk(ICON3D, ICON3D), ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(renderer.domElement, 0, 0, ICON3D, ICON3D);
  const icon = outlined(out);
  cache.set(id, icon);
  return icon;
}

// El modelo en miniatura de un objeto tirado al suelo (centrado, de unos 0,45 m de alto como mucho), o null
export function dropModel(id) {
  const kind = modelKind(id), food = !kind && foodModel(id);   // (la comida y la bebida, con su modelo de food3d.js)
  if (!kind && !food) return null;
  const g = food ? Object.assign(new THREE.Group(), {}).add(food) : build(id, kind);
  if (kind === 'tool') g.rotation.z = -0.75;
  g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const k = (food ? 0.25 : 0.45) / Math.max(size.x, size.y, size.z, 0.01);
  const root = new THREE.Group();
  g.position.copy(c).multiplyScalar(-k);
  g.scale.setScalar(k);
  root.add(g);
  root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return root;
}
