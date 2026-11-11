// Iconos hechos desde los modelos 3D: lo que se coloca (muebles, estaciones, cosas del rancho), las herramientas y
// armas, y la comida, la bebida, los peces y las pociones (los modelos de food3d.js, los mismos que se ven en la mano y en
// el suelo) se dibujan una vez con el mismo modelo que en el mundo, de tres cuartos, en un lienzo pequeño (ICON3D
// píxeles, con contorno, como los iconos de píxel), y se guardan. Los materiales, las semillas, los cultivos que no se
// comen, los bichos, la ropa, las alfombras y los cuadros siguen a píxel (art/items.js): a 16 píxeles se leen mejor
// dibujados a mano. También da el modelo en miniatura de lo que se tira al suelo.
// Se hacen cuando se piden (la primera vez que se ven); al empezar la partida, prewarmIcons adelanta en ratos libres los
// programas de la comida y los iconos de lo que se lleva, para que abrir la mochila o una tienda no dé un tirón.
import { foodModel, hasFood, foodView } from './food3d.js';
import * as THREE from 'three';
import { getModel, modelMat } from './models.js';
import { toolModel } from './actors.js';
import { ITEMS } from '../items.js';
import { mk, outlined } from '../util.js';

export const ICON3D = 36;   // píxeles del icono (la interfaz los escala, como a los de píxel)
const SS = 4;               // se dibuja a SS veces el tamaño y se reduce, para suavizar los bordes
// Desde dónde se mira (el frente del modelo mira a +z). La comida, según su familia (food3d.js, foodView): de tres cuartos,
// más desde arriba lo plano (platos, cuencos, carnes), más de lado lo alto (jarras, vasos, botellas, frascos) y el pez
// tumbado en diagonal, de lado, como los de píxel
const VIEW = { placed: [-1, 0.95, 1.2], tool: [0.25, 0.5, 1], food: [-1, 1.15, 1.2], flat: [-0.6, 1.8, 1.0], drink: [-1, 0.7, 1.3], fish: [0.15, 0.55, 1] };
const PIXEL = new Set(['cana', 'cana_fibra', 'red']);   // (largos y finos: a 36 píxeles no se leen; siguen a píxel)
const FLAME = new THREE.MeshBasicMaterial({ color: '#ffb040' }), FLAME_GEO = new THREE.SphereGeometry(0.08, 8, 6);
const cache = new Map();
let R = null, idle = 0;
// Este renderizador es otro contexto de la gráfica, con su propia copia de cada textura y cada programa que usa. Solo hace
// falta mientras se piden iconos (al abrir la mochila o el inventario creativo): medio minuto después del último se suelta
// entero, y se vuelve a crear si hace falta otro. (no menos: al pasar por el inventario creativo los iconos se piden poco
// a poco, y recrearlo cada rato sería compilar otra vez)
const IDLE_MS = 30000;
// (al soltarlo, también los oyentes de 'dispose' que puso en los materiales, texturas y geometrías que comparte con el
// juego: Three no los quita, y cada uno retendría entero el renderizador ya muerto, uno más cada vez que se vuelve a crear.
// Se apuntan mientras dibuja: en ese rato, lo que se añade es suyo)
const OWN = [];
function release() {
  if (!R) return;
  for (const [o, f] of OWN) o.removeEventListener('dispose', f);
  OWN.length = 0;
  R.renderer.dispose(); R.renderer.forceContextLoss();
  R = null;
}
function drawOwn(renderer, scene, camera, compile = false) {
  const ED = THREE.EventDispatcher.prototype, add = ED.addEventListener;
  ED.addEventListener = function (type, f) { if (type === 'dispose' && !this.hasEventListener(type, f)) OWN.push([this, f]); return add.call(this, type, f); };
  try { if (compile) renderer.compile(scene, camera); else renderer.render(scene, camera); } finally { ED.addEventListener = add; }
}

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

// De qué clase es el modelo de un objeto: 'tool' (herramienta o arma), 'placed' (lo que se coloca), 'food' (la comida, la
// bebida, los peces y las pociones) o nada (va a píxel)
export function modelKind(id) {
  const def = ITEMS[id];
  if (!def || def.wear || PIXEL.has(id)) return null;
  if (def.tool || def.weapon || def.bow) return 'tool';
  if (((def.place && def.place !== 'wall' && !def.rug) || def.flower) && getModel(id)) return 'placed';
  if (hasFood(id)) return 'food';
  return null;
}

// El modelo de un objeto como grupo de mallas (made: las geometrías hechas aquí, para poder soltarlas)
function build(id, kind, made) {
  const g = new THREE.Group();
  if (kind === 'tool') { const t = toolModel(id); t.rotation.set(0, 0, 0); g.add(t); return g; }
  if (kind === 'food') { g.add(foodModel(id)); return g; }
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
  let g = build(id, kind, made);
  const view = kind === 'food' ? foodView(id) : kind;
  if (kind === 'tool') g.rotation.z = -0.75;   // (el mango abajo a la izquierda y la cabeza arriba a la derecha)
  if (kind === 'food') g = forIcon(g, view);
  scene.add(g);
  g.updateMatrixWorld(true);
  // La cámara, mirando al centro del modelo desde su lado; el encuadre, justo el que ocupan sus esquinas (la comida, con
  // algo más de margen: es redondeada y el contorno no debe tocar el borde)
  const box = new THREE.Box3().setFromObject(g), c = box.getCenter(new THREE.Vector3()), dir = new THREE.Vector3(...VIEW[view]).normalize();
  camera.position.copy(c).addScaledVector(dir, 10);
  camera.lookAt(c);
  camera.updateMatrixWorld(true);
  const v = new THREE.Vector3(); let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(camera.matrixWorldInverse);
    x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
  }
  const half = Math.max(x1 - x0, y1 - y0) / 2 * (kind === 'food' ? 1.12 : 1.08), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  Object.assign(camera, { left: cx - half, right: cx + half, top: cy + half, bottom: cy - half, near: 0.1, far: 30 });
  camera.updateProjectionMatrix();
  // (la comida, algo más expuesta: sus colores, apagados para el mundo, con esta curva salían oscuros a este tamaño)
  renderer.toneMappingExposure = kind === 'food' ? 1.15 : 1;
  drawOwn(renderer, scene, camera);
  renderer.toneMappingExposure = 1;
  scene.remove(g);
  for (const geo of made) geo.dispose();
  if (made.length) { const gone = new Set(made); for (let i = OWN.length; i--;) if (gone.has(OWN[i][0])) OWN.splice(i, 1); }   // (ya soltadas: Three ha quitado su oyente)
  const out = mk(ICON3D, ICON3D), ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(renderer.domElement, 0, 0, ICON3D, ICON3D);
  const icon = outlined(out);
  cache.set(id, icon);
  clearTimeout(idle); idle = setTimeout(release, IDLE_MS);
  return icon;
}

// La comida para su icono: el pez, tumbado en diagonal con la cabeza arriba a la izquierda; el vidrio, menos transparente
// (en la ranura oscura, el vaso o el tarro casi no se verían; lo de dentro se sigue viendo). Los frascos de las pociones
// (userData.clear) se quedan finos: lo que se lee es su color. Es un clon: los materiales de la mano no cambian
const ICON_GLASS = new Map();
function forIcon(g, view) {
  g.traverse(o => {
    if (!o.isMesh || !o.material.transparent || o.material.opacity > 0.5 || o.material.userData.clear) return;
    let m = ICON_GLASS.get(o.material);
    if (!m) { m = o.material.clone(); m.opacity = 0.5; ICON_GLASS.set(o.material, m); }
    o.material = m;
  });
  if (view !== 'fish') return g;
  const roll = new THREE.Group();
  g.rotation.y = -Math.PI / 2; roll.rotation.z = -0.35;
  roll.add(g);
  return roll;
}

// El modelo en miniatura de un objeto tirado al suelo (centrado, de unos 0,45 m de alto como mucho), o null
export function dropModel(id) {
  const kind = modelKind(id), food = kind === 'food';   // (la comida y la bebida, con su modelo de food3d.js)
  if (!kind) return null;
  const g = build(id, kind);
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

// Adelantar los iconos en ratos libres, al empezar la partida: primero se compilan sin parar el juego los programas de la
// comida (con su vidrio, sus dos caras y su metal: el primer icono de comida los compilaría de golpe, de 50 a 200 ms), y
// luego se dibujan, en trozos de pocos milisegundos, los de lo que se lleva (first) y los de toda la comida, la bebida y
// los peces. draw: el que hace el icono y lo guarda (art/items.js, itemIcon). Nada se guarda en el navegador: en memoria
// ocupan poco y así no se llena el almacenamiento, que comparte el sitio con otros juegos
let warmT = 0;
export function prewarmIcons(first, draw) {
  if (typeof document === 'undefined') return;
  const run = ++warmT, later = f => (typeof requestIdleCallback === 'function' ? requestIdleCallback(f, { timeout: 3000 }) : setTimeout(() => f({ timeRemaining: () => 6, didTimeout: true }), 50));
  const food = Object.keys(ITEMS).filter(id => modelKind(id) === 'food');
  const list = [...new Set([...first().filter(id => ITEMS[id]), ...food])].filter(id => !cache.has(id));
  if (!list.length) return;
  later(async () => {
    if (run !== warmT) return;
    // (una malla de cada material distinto de la comida, para compilar sus programas en paralelo)
    try {
      const { renderer, scene, camera } = R || setup(), g = new THREE.Group(), seen = new Set();
      for (const id of food) forIcon(build(id, 'food'), foodView(id)).traverse(o => { if (o.isMesh && !seen.has(o.material)) { seen.add(o.material); g.add(new THREE.Mesh(o.geometry, o.material)); } });
      scene.add(g);
      // (compile pide los programas sin esperar a que estén y apunta sus oyentes como suyos; compileAsync espera, sin parar
      // el juego, a que la gráfica los acabe: ya no añade nada)
      drawOwn(renderer, scene, camera, true);
      if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
      scene.remove(g);
      clearTimeout(idle); idle = setTimeout(release, IDLE_MS);
    } catch (e) { console.warn('Iconos: no se han podido adelantar los programas', e); }
    const step = deadline => {
      if (run !== warmT) return;
      const t0 = performance.now();
      // (en cada rato libre, mientras queden más de 4 ms; si el rato llega por plazo vencido, uno solo)
      while (list.length && (deadline.didTimeout ? performance.now() - t0 < 4 : deadline.timeRemaining() > 4)) { try { draw(list.shift()); } catch { /* (se hará cuando se pida) */ } }
      if (list.length) later(step);
    };
    later(step);
  });
}
