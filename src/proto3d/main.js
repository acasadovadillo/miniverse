// Prototipo 3D de Pixelverse: Pueblo Brotes en 3D de verdad, con la cámara girando suave alrededor del
// muñeco (flechas izquierda y derecha), zoom con la rueda, sol con sombras suaves, cielo, niebla y agua.
// Dentro de una casa se quitan el tejado y las paredes que tapan la vista; fuera, si una casa tapa al
// muñeco, este se ve en silueta (también detrás de los árboles).
import * as THREE from 'three';
import { buildVillage3D, heightAt, WATER_Y } from './village3d.js';
import { Person3D } from './people3d.js';
import { WIND } from './nature.js';
import * as V from '../world/village.js';

const Q = new URLSearchParams(location.search);
const LOW = Q.get('q') === 'low';
const $ = id => document.getElementById(id);

// ---------- Render ----------
const renderer = new THREE.WebGLRenderer({ antialias: !LOW, powerPreference: 'high-performance' });
let pixelRatio = Math.min(devicePixelRatio, LOW ? 1 : 2);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.5, 400);

// Cielo: degradado del horizonte al cénit, con un halo alrededor del sol
const SKY = { day: { top: '#5ea4e2', horizon: '#cfe6f4', fog: '#c6e0ee' }, night: { top: '#0c1430', horizon: '#2a3a5e', fog: '#1e2a46' } };
const skyU = { top: { value: new THREE.Color(SKY.day.top) }, horizon: { value: new THREE.Color(SKY.day.horizon) }, sunDir: { value: new THREE.Vector3() }, glow: { value: 1 } };
const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), new THREE.ShaderMaterial({
  uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }',
  fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform float glow; varying vec3 vDir;
    void main(){ float h = clamp(vDir.y, 0.0, 1.0); vec3 c = mix(horizon, top, pow(h, 0.55));
      float s = max(dot(normalize(vDir), sunDir), 0.0); c += vec3(1.0, 0.85, 0.6) * (pow(s, 24.0) * 0.35 + pow(s, 600.0) * 1.5) * glow;
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
}));
sky.renderOrder = -1;
sky.frustumCulled = false;
scene.add(sky);
scene.fog = new THREE.Fog(SKY.day.fog, 55, 135);

// Luz: sol (con sombras que siguen al muñeco), luz del cielo y del suelo, y el reflejo del cielo
const sun = new THREE.DirectionalLight('#fff0d8', 2.7);
sun.castShadow = true;
sun.shadow.mapSize.set(LOW ? 1024 : 2048, LOW ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 90 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.025;
scene.add(sun, sun.target);
const SUN_DIR = new THREE.Vector3(-0.55, 0.78, 0.32).normalize();
const hemi = new THREE.HemisphereLight('#d4e8ff', '#5f7a40', 0.75);
scene.add(hemi);
{
  const pm = new THREE.PMREMGenerator(renderer), envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 16, 8), new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: false, color: '#9cc4e4' })));
  const ground = new THREE.Mesh(new THREE.CircleGeometry(9, 16), new THREE.MeshBasicMaterial({ color: '#5a7a44' })); ground.rotation.x = -Math.PI / 2; ground.position.y = -1; envScene.add(ground);
  scene.environment = pm.fromScene(envScene, 0.04).texture;
}
// Cuánto alumbra el reflejo del cielo (en esta versión de three va en cada material)
let envMats = null, envNow = -1;
function setEnv(v) {
  if (Math.abs(v - envNow) < 0.005) return;
  envMats ||= (() => { const l = new Set(); scene.traverse(o => [].concat(o.material || []).forEach(m => m.isMeshStandardMaterial && l.add(m))); return [...l]; })();
  for (const m of envMats) m.envMapIntensity = v;
  envNow = v;
}

// ---------- Mundo ----------
$('loading').textContent = 'Construyendo el pueblo…';
await new Promise(r => setTimeout(r, 30));
const world = buildVillage3D();
scene.add(world.group);
// Las paredes y los tejados se desvanecen con tramado (sin ordenar transparencias) y, ocultos, siguen dando sombra
const fadeables = [];
for (const h of world.houses) {
  h.fade = { roof: 1, n: 1, s: 1, e: 1, w: 1 };
  const prep = obj => { const list = []; obj.traverse(o => { if (o.material && !list.includes(o.material)) list.push(o.material); }); for (const m of list) { if (!m.transparent) m.alphaHash = true; m.userData.base = m.opacity; } return list; };
  h.mats = { roof: prep(h.roof) };
  for (const k of ['n', 's', 'e', 'w']) h.mats[k] = prep(h.sides[k]);
  fadeables.push(h);
}

// Las casas sin luces propias toman prestadas estas dos mientras estás dentro (así el número de luces no cambia)
const borrowed = { room: new THREE.PointLight('#ffd08a', 0, 12, 1.3), hearth: new THREE.PointLight('#ff9a4a', 0, 6, 1.6) };
scene.add(borrowed.room, borrowed.hearth);

// Personajes: tú y los vecinos
const LOOKS = {
  player: { sex: 'chica', hairStyle: 'coleta', hair: '#a8442a', skin: '#e8b07a', outfit: 'delantal', cloth: '#3a5ab8', pants: '#4a3a2a', eyes: '#3a8a4a' },
  Nilo: { sex: 'chico', skin: '#8a5234', hair: '#c8c4cc', eyes: '#6a3a1e', cloth: '#4a9a4a', pants: '#3a4a6a', hairStyle: 'corto', outfit: 'tunica', beard: true },
  Rosa: { sex: 'chica', skin: '#f6c9a0', hair: '#4a2c1c', eyes: '#6a3a1e', cloth: '#c83a3a', pants: '#4a3a2a', hairStyle: 'mono', outfit: 'delantal' },
  'Lía': { sex: 'chica', skin: '#e8b07a', hair: '#e8c060', eyes: '#3a6ab8', cloth: '#2e8a8a', pants: '#3a4a6a', hairStyle: 'largo', outfit: 'chaleco' },
  Bruno: { sex: 'chico', skin: '#8a5234', hair: '#2a1e1e', eyes: '#3a2a1e', cloth: '#4a4a5a', pants: '#3a3a3a', hairStyle: 'rapado', outfit: 'delantal', beard: true },
};
const player = new Person3D(LOOKS.player, 'Tú');
player.pos = new THREE.Vector3(21.5, 0, 22.5);
player.facing = Math.PI; player.root.rotation.y = Math.PI;
player.root.traverse(o => { if (o.material) o.material = o.material.clone(); });
scene.add(player.root);
const playerMats = []; player.root.traverse(o => { if (o.material) { playerMats.push(o.material); o.layers.set(2); } });
// Las luces alumbran también la capa del muñeco (la de sus dos pasadas)
scene.traverse(o => { if (o.isLight) o.layers.enable(2); });
camera.layers.enable(2);
const npcs = [
  ['Nilo', V.NILO.x, V.NILO.y], ['Rosa', V.STALL.x0 + 1, V.STALL.y1 + 0.8], ['Lía', V.doorOf(V.HOUSES.rosa).x + 2, V.doorOf(V.HOUSES.rosa).y + 1.5], ['Bruno', V.doorOf(V.HOUSES.bruno).x + 1.5, V.doorOf(V.HOUSES.bruno).y + 1.6],
].map(([name, x, z]) => {
  const p = new Person3D(LOOKS[name], name);
  p.home = new THREE.Vector2(x, z); p.pos = new THREE.Vector3(x, 0, z); p.wait = 1 + Math.random() * 3; p.goal = null;
  p.facing = Math.random() * 6; p.root.rotation.y = p.facing;
  scene.add(p.root);
  return p;
});

// ---------- Choques ----------
// Rejilla de 4 m con los obstáculos (círculos, elipses y cajas) para mirar solo los de alrededor
const GRID = 4, grid = new Map();
const cellsOf = c => {
  const [x0, x1, z0, z1] = c.r !== undefined ? [c.x - c.r, c.x + c.r, c.z - c.r, c.z + c.r] : c.rx !== undefined ? [c.x - c.rx, c.x + c.rx, c.z - c.rz, c.z + c.rz] : [c.x0, c.x1, c.z0, c.z1];
  const out = [];
  for (let j = Math.floor(z0 / GRID); j <= Math.floor(z1 / GRID); j++) for (let i = Math.floor(x0 / GRID); i <= Math.floor(x1 / GRID); i++) out.push(`${i},${j}`);
  return out;
};
const addCol = c => { for (const k of cellsOf(c)) { if (!grid.has(k)) grid.set(k, []); grid.get(k).push(c); } };
world.colliders.forEach(addCol);
const doors = world.houses.flatMap(h => h.doors);
const R = 0.28;
// Empuja (x, z) fuera de los obstáculos
function resolve(p, self = player) {
  for (let it = 0; it < 3; it++) {
    const list = new Set([...(grid.get(`${Math.floor(p.x / GRID)},${Math.floor(p.z / GRID)}`) || []), ...doors.filter(d => d.amount < 0.5).map(d => d.col)]);
    for (const n of [player, ...npcs]) if (n !== self && Math.abs(n.pos.x - p.x) < 1 && Math.abs(n.pos.z - p.z) < 1) list.add({ x: n.pos.x, z: n.pos.z, r: 0.22 });
    for (const k of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const c of grid.get(`${Math.floor((p.x + k[0] * R) / GRID)},${Math.floor((p.z + k[1] * R) / GRID)}`) || []) list.add(c);
    for (const c of list) {
      if (c.r !== undefined) {
        const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), m = c.r + R;
        if (d < m && d > 1e-6) { p.x = c.x + (dx / d) * m; p.z = c.z + (dz / d) * m; }
      } else if (c.rx !== undefined) {
        const dx = (p.x - c.x) / (c.rx + R), dz = (p.z - c.z) / (c.rz + R), d = Math.hypot(dx, dz);
        if (d < 1 && d > 1e-6) { p.x = c.x + (dx / d) * (c.rx + R); p.z = c.z + (dz / d) * (c.rz + R); }
      } else {
        const qx = Math.max(c.x0, Math.min(p.x, c.x1)), qz = Math.max(c.z0, Math.min(p.z, c.z1)), dx = p.x - qx, dz = p.z - qz, d = Math.hypot(dx, dz);
        if (d < R) {
          if (d > 1e-6) { p.x = qx + (dx / d) * R; p.z = qz + (dz / d) * R; }
          else { const o = [[c.x0 - R - p.x, 0], [c.x1 + R - p.x, 0], [0, c.z0 - R - p.z], [0, c.z1 + R - p.z]].sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]))[0]; p.x += o[0]; p.z += o[1]; }
        }
      }
    }
  }
}
const houseAt = (x, z, m = 0) => world.houses.find(h => x > h.inside.x0 - m && x < h.inside.x1 + m && z > h.inside.z0 - m && z < h.inside.z1 + m);
const groundY = (x, z) => (houseAt(x, z, 0.12) ? 0.02 : Math.max(heightAt(x, z), WATER_Y - 0.3));
const walkable = (x, z) => houseAt(x, z, 0.12) || heightAt(x, z) > WATER_Y + 0.04;

// ---------- Controles ----------
const keys = new Set();
addEventListener('keydown', e => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.repeat) return;
  if (e.code === 'KeyE') toggleNearestDoor();
  if (e.code === 'KeyN') night = !night;
  if (e.code === 'KeyF') $('stats').classList.toggle('hide');
  if (e.code === 'KeyH') $('help').classList.toggle('hide');
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
const cam = { yaw: Math.PI / 4, vel: 0, pitch: 0.84, dist: 26, distGoal: 26, target: new THREE.Vector3() };
addEventListener('wheel', e => { cam.distGoal = Math.max(9, Math.min(48, cam.distGoal * (1 + Math.sign(e.deltaY) * 0.1))); e.preventDefault(); }, { passive: false });
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
let night = Q.get('noche') !== null;

function nearestDoor() {
  let best = null, bd = 1.7;
  for (const d of doors) { const dd = Math.hypot(player.pos.x - d.x, player.pos.z - d.z); if (dd < bd) { bd = dd; best = d; } }
  return best;
}
function toggleNearestDoor() { const d = nearestDoor(); if (d) d.open = !d.open; }

// ---------- Desvanecer casas ----------
const toCam = new THREE.Vector3(), debug = { solid: false };   // solid: casas siempre enteras (para revisarlas)
function updateHouses(dt) {
  toCam.set(Math.sin(cam.yaw), 0, Math.cos(cam.yaw));
  const inside = debug.solid ? null : houseAt(player.pos.x, player.pos.z, 0.05);
  for (const h of fadeables) {
    const goal = { roof: 1, n: 1, s: 1, e: 1, w: 1 };
    // Dentro: fuera el tejado y las paredes que miran a la cámara (fuera de casa, si una casa tapa al muñeco,
    // se ve su silueta)
    if (h === inside) {
      goal.roof = 0;
      for (const k of ['n', 's', 'e', 'w']) { const n = h.sides[k].userData.normal; if (n[0] * toCam.x + n[2] * toCam.z > 0.12) goal[k] = 0; }
    }
    for (const k of Object.keys(goal)) {
      const v = h.fade[k], g = goal[k];
      if (v === g) continue;
      h.fade[k] = v < g ? Math.min(g, v + dt * 4) : Math.max(g, v - dt * 4);
      const o = h.fade[k];
      // Del todo oculta: no se pinta pero sigue opaca para el mapa de sombras (el tejado sigue dando sombra dentro)
      const on = o > 0.01;
      for (const m of h.mats[k]) { m.opacity = m.userData.base * (on ? o : 1); if (m.colorWrite !== on) { m.colorWrite = on; m.depthWrite = on && !m.transparent; } }
    }
  }
  return inside;
}

// ---------- Silueta del muñeco detrás de las cosas ----------
const silMat = new THREE.MeshBasicMaterial({ color: '#ffe8b0', transparent: true, opacity: 0.45, depthFunc: THREE.GreaterDepth, depthWrite: false, fog: false });

// ---------- Día y noche ----------
let nightK = night ? 1 : 0;
function updateSky(dt) {
  nightK += ((night ? 1 : 0) - nightK) * Math.min(1, dt * 2.5);
  const k = nightK, col = (a, b) => new THREE.Color(a).lerp(new THREE.Color(b), k);
  skyU.top.value.copy(col(SKY.day.top, SKY.night.top)); skyU.horizon.value.copy(col(SKY.day.horizon, SKY.night.horizon)); skyU.glow.value = 1 - k;
  scene.fog.color.copy(col(SKY.day.fog, SKY.night.fog));
  sun.intensity = 2.8 * (1 - k) + 0.3 * k; sun.color.copy(col('#fff0d8', '#9ab4ff'));
  hemi.intensity = 0.9 * (1 - k) + 0.14 * k; hemi.color.copy(col('#dcebff', '#4a5a8a')); hemi.groundColor.copy(col('#6a7f48', '#1a2030'));
  setEnv(0.45 * (1 - k) + 0.05 * k);
  for (const l of world.lamps) { l.light.intensity = 9 * k; l.glass.material.emissiveIntensity = 0.15 + 2.6 * k; }
  const now = performance.now(), inside = houseAt(player.pos.x, player.pos.z, 0.05), borrow = inside && !inside.lights.length;
  if (borrow) { borrowed.room.position.copy(inside.anchors.room); borrowed.hearth.position.copy(inside.anchors.hearth); }
  borrowed.room.intensity = borrow ? 6 * (0.55 + 0.45 * k) : 0;
  borrowed.hearth.intensity = borrow ? 2.2 * (0.85 + Math.sin(now * 0.013) * 0.08) : 0;
  for (const h of world.houses) for (const f of h.lights) f.light.intensity = f.base * (0.55 + 0.45 * k) * (f.fire ? 0.85 + Math.sin(now * 0.013) * 0.08 + Math.sin(now * 0.031) * 0.07 : 1);
  // Las llamas bailan
  for (const h of world.houses) for (const fire of h.fires) fire.children.forEach((c, i) => { c.scale.y = (0.22 + (i % 3) * 0.06) * (1 + Math.sin(now * 0.012 + i * 1.7) * 0.18 + Math.sin(now * 0.029 + i) * 0.1); c.rotation.y = now * 0.002 + i; });
  for (const h of world.houses) for (const m of h.glass) m.emissiveIntensity = 1.4 * k;
}

// ---------- Bucle ----------
const clock = new THREE.Clock();
let frames = 0, acc = 0, slow = 0;
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3();
let snapNext = false;   // el siguiente fotograma pone cámara y casas en su sitio sin transición
function frame() {
  const dt = Math.min(0.05, clock.getDelta()), t = clock.elapsedTime, ease = rate => (snapNext ? 1 : Math.min(1, dt * rate));
  // Giro de la cámara: acelera y frena suave
  const turn = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
  cam.vel += (turn * 2.1 - cam.vel) * Math.min(1, dt * (turn ? 5 : 7));
  cam.yaw += cam.vel * dt;
  cam.dist += (cam.distGoal - cam.dist) * Math.min(1, dt * 6);
  // Andar en la dirección de la pantalla
  fwd.set(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw)); right.set(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
  const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0), s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  move.copy(fwd).multiplyScalar(f).addScaledVector(right, s);
  let speed = 0;
  if (move.lengthSq() > 0) {
    move.normalize();
    speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 5.6 : 3.2;
    const p = { x: player.pos.x + move.x * speed * dt, z: player.pos.z + move.z * speed * dt };
    resolve(p);
    if (walkable(p.x, p.z)) { player.pos.x = p.x; player.pos.z = p.z; }
    player.facing = Math.atan2(move.x, move.z);
  }
  player.pos.y += (groundY(player.pos.x, player.pos.z) - player.pos.y) * Math.min(1, dt * 14);
  player.root.position.copy(player.pos);
  player.update(dt, speed);
  // Vecinos: pasean un poco alrededor de su sitio
  for (const n of npcs) {
    if (n.goal) {
      const dx = n.goal.x - n.pos.x, dz = n.goal.y - n.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.1) { n.goal = null; n.wait = 2 + Math.random() * 4; }
      else { const v = Math.min(1.1, d * 2); const p = { x: n.pos.x + (dx / d) * v * dt, z: n.pos.z + (dz / d) * v * dt }; resolve(p, n); n.pos.x = p.x; n.pos.z = p.z; n.facing = Math.atan2(dx, dz); n.update(dt, v); }
      if (n.goal && (n.stuck = (n.stuck || 0) + dt) > 6) n.goal = null;
    } else {
      n.update(dt, 0);
      if ((n.wait -= dt) < 0) { const a = Math.random() * 6.28, r = Math.random() * 2.2; n.goal = new THREE.Vector2(n.home.x + Math.cos(a) * r, n.home.y + Math.sin(a) * r); n.stuck = 0; if (!walkable(n.goal.x, n.goal.y)) n.goal = null; }
      if (Math.hypot(player.pos.x - n.pos.x, player.pos.z - n.pos.z) < 3) n.facing = Math.atan2(player.pos.x - n.pos.x, player.pos.z - n.pos.z);
    }
    n.pos.y = groundY(n.pos.x, n.pos.z);
    n.root.position.copy(n.pos);
  }
  // Puertas: giran hasta abiertas o cerradas
  for (const d of doors) {
    d.amount += ((d.open ? 1 : 0) - d.amount) * Math.min(1, dt * 7);
    d.setAngle(d.amount);
  }
  // Cámara: sigue al muñeco; dentro de casa, más cerca y más desde arriba
  const inside = debug.solid ? null : houseAt(player.pos.x, player.pos.z, 0.05);
  const want = inside ? { pitch: 0.98, dist: Math.min(cam.distGoal, 19) } : { pitch: debug.pitch ?? 0.84, dist: cam.dist };
  cam.pitchNow = (cam.pitchNow ?? want.pitch) + (want.pitch - (cam.pitchNow ?? want.pitch)) * ease(4);
  cam.distNow = (cam.distNow ?? want.dist) + (want.dist - (cam.distNow ?? want.dist)) * ease(4);
  cam.target.lerp(new THREE.Vector3(player.pos.x, player.pos.y + 0.9, player.pos.z), ease(8));
  const cp = Math.cos(cam.pitchNow), sp = Math.sin(cam.pitchNow);
  camera.position.set(cam.target.x + Math.sin(cam.yaw) * cp * cam.distNow, cam.target.y + sp * cam.distNow, cam.target.z + Math.cos(cam.yaw) * cp * cam.distNow);
  camera.lookAt(cam.target);
  // Sol: sombras alrededor del muñeco (ajustadas a la rejilla del mapa de sombras para que no tiemblen)
  const texel = (sun.shadow.camera.right - sun.shadow.camera.left) / sun.shadow.mapSize.x;
  const c = new THREE.Vector3(Math.round(player.pos.x / texel) * texel, 0, Math.round(player.pos.z / texel) * texel);
  sun.position.copy(c).addScaledVector(SUN_DIR, 45); sun.target.position.copy(c);
  skyU.sunDir.value.copy(SUN_DIR);
  sky.position.copy(camera.position);
  world.water.uniforms.time.value = t;
  WIND.value = t;
  updateHouses(snapNext ? 10 : dt);
  updateSky(snapNext ? 10 : dt);
  snapNext = false;
  // Aviso de la puerta
  const d = nearestDoor();
  $('prompt').classList.toggle('show', !!d);
  if (d) $('prompt').innerHTML = `<kbd>E</kbd> ${d.open ? 'Cerrar' : 'Abrir'} la puerta`;
  $('where').textContent = inside ? inside.name : 'Pueblo Brotes';
  // Tres pasadas: el mundo (el muñeco solo deja su sombra), su silueta donde algo lo tapa, y el muñeco
  renderer.autoClear = true;
  for (const m of playerMats) { m.colorWrite = false; m.depthWrite = false; }
  renderer.render(scene, camera);
  renderer.autoClear = false;
  renderer.shadowMap.autoUpdate = false;
  camera.layers.set(2);
  scene.overrideMaterial = silMat;
  renderer.render(scene, camera);
  scene.overrideMaterial = null;
  for (const m of playerMats) { m.colorWrite = true; m.depthWrite = true; }
  renderer.render(scene, camera);
  camera.layers.enableAll(); camera.layers.disable(1);
  renderer.shadowMap.autoUpdate = true;
  // Fotogramas por segundo; si va lento mucho rato, se baja la resolución
  frames++; acc += dt;
  if (acc > 0.5) {
    const fps = frames / acc, info = renderer.info.render;
    $('stats').textContent = `${fps.toFixed(0)} FPS · ${info.calls} llamadas · ${(info.triangles / 1000).toFixed(0)}k triángulos · resolución ×${pixelRatio.toFixed(2)}`;
    slow = fps < 40 ? slow + acc : 0;
    if (slow > 3 && pixelRatio > 1) { pixelRatio = Math.max(1, pixelRatio - 0.25); renderer.setPixelRatio(pixelRatio); slow = 0; }
    frames = 0; acc = 0;
  }
  renderer.info.reset();
}
renderer.info.autoReset = false;
$('loading').remove();
renderer.setAnimationLoop(frame);
// Para probar desde la consola
window.proto = {
  THREE, scene, camera, renderer, cam, player, world, keys, npcs, doors, debug, frame, setNight: v => (night = v),
  // Poner al muñeco y la cámara en un sitio al instante: proto.place(x, z, giro, distancia)
  place(x, z, yaw = cam.yaw, dist) {
    player.pos.set(x, groundY(x, z), z); cam.yaw = yaw; cam.vel = 0;
    if (dist) cam.dist = cam.distGoal = dist;
    cam.distNow = cam.pitchNow = undefined; snapNext = true;
  },
};
