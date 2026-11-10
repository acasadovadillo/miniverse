// Dibujo del juego en 3D. Cada fotograma copia el estado del juego (el mundo por trozos, lo construido, las
// personas, los animales, los efectos) a una escena de Three.js y la pinta desde una cámara que orbita
// alrededor del jugador: gira (← →), se inclina de ras de suelo a casi cenital (↑ ↓) y se acerca o aleja
// (+ −), siempre con aceleración y frenado suaves. No atraviesa el suelo y, si una casa se pone entre ella y
// el jugador, sube lo justo para verlo por encima del tejado. El sol sigue la hora del juego (y la luna de
// noche), el cielo tiene nubes, y hay lluvia, nieve, tormentas y niebla según el tiempo.
import { TOWER_CUT } from './models.js';
import { TOWER } from '../world/tower.js';
import * as THREE from 'three';
import { Outline } from './outline.js';
import { CAM, PITCH, DIST, LOOK } from '../camera.js';
import { setViewAngle } from '../iso.js';
import { CENTER } from '../world/village.js';
import { Settings } from '../settings.js';
import { Terrain, WATER_Y, WET, RAIN } from './terrain.js';
import { World3D } from './world3d.js';
import { Actors, toolModel, swingArm, pullBow } from './actors.js';
import { ITEMS } from '../items.js';
import { Fx } from './fx.js';
import { ArrowsView } from './arrows.js';
import { Cave3D } from './cave3d.js';
import { TONE_MAPPING, CURVA, lightAt, toneOut } from './look.js';

const LOW_Q = new URLSearchParams(location.search).get('q') === 'low';
const SKY_LAST = 1e6;   // orden de dibujo del cielo (ver makeSky)

// Las luces de cerca (hogares, antorchas…) son siempre las mismas seis (ver makeLights), y Three las calcula en cada
// píxel aunque estén apagadas (de día) o el píxel quede fuera de su alcance: buena parte del trabajo de la
// gráfica. Aquí, cada una se salta donde no da luz (su color, ya con la distancia, es cero): sale lo mismo, porque
// lo que se saltaba sumaba cero. (Antes de que se compile ningún material: el trozo es común a todos.)
{
  const C = THREE.ShaderChunk, from = C.lights_fragment_begin.indexOf('for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {'), call = '\t\tRE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
  const at = C.lights_fragment_begin.indexOf(call, from);
  if (from >= 0 && at > from) C.lights_fragment_begin = C.lights_fragment_begin.slice(0, at) + '\t\tif ( directLight.visible ) ' + call.trimStart() + C.lights_fragment_begin.slice(at + call.length);
  else console.warn('Luces de cerca: el trozo de Three ha cambiado y no se ahorran');
}

export class View3D {
  constructor(canvas) {
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !LOW_Q, stencil: true, powerPreference: 'high-performance' }));
    this.pixelRatio = Math.min(devicePixelRatio, LOW_Q ? 1 : 2);
    r.setPixelRatio(this.pixelRatio);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = TONE_MAPPING;   // (la curva y la exposición de look.js)
    r.toneMappingExposure = CURVA.exp;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.shadowMap.autoUpdate = false;   // se rehace cada dos fotogramas o cuando se mueve su zona (ver draw)
    r.info.autoReset = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.3, 420);
    this.camera.layers.enable(2);
    this.clock = new THREE.Clock();
    this.makeSky();
    this.makeLights();
    this.terrain = new Terrain(this.scene);
    this.world = new World3D(this);
    this.actors = new Actors(this);
    // En primera persona, lo que se lleva en la mano se ve abajo a la derecha
    this.viewmodel = new THREE.Group(); this.viewmodel.visible = false; this.scene.add(this.viewmodel);
    this.fx = new Fx(this);
    this.arrows = new ArrowsView(this);
    this.caves = new Map();       // escena de cueva → su vista
    this.cave = null;
    this.cam = { target: new THREE.Vector3(CENTER.x, 0, CENTER.y), vel: 0, pvel: 0, zvel: 0, pitchNow: null, distNow: null, low: 0 };
    this.ray = new THREE.Vector3(); this.probe = new THREE.Vector3(); this.probe2 = new THREE.Vector3(); this.from = new THREE.Vector3();
    this.raycaster = new THREE.Raycaster();
    this.frames = 0; this.acc = 0;
    // (si la gráfica pierde el contexto, al volver los atlas están vacíos: los impostores se hornean otra vez)
    canvas.addEventListener('webglcontextrestored', () => this.world.impostors?.invalidate());
    this.resize();
    addEventListener('resize', () => this.resize());
  }
  // Resolución: en Auto empieza al máximo y baja sola si va lento; si no, la que se elija en los ajustes
  resize() {
    const q = Settings.v.scale, fixed = { 1: Math.min(devicePixelRatio, 2), 2: 1, 3: 0.75, 4: 0.5 }[q];
    const auto = !fixed && !LOW_Q;
    if (auto && this.auto === false) { this.scaling = null; this.pixelRatio = Math.min(devicePixelRatio, 2); this.renderer.setPixelRatio(this.pixelRatio); }   // (vuelta a Auto: desde el máximo)
    this.auto = auto;
    if (fixed && fixed !== this.pixelRatio) { this.pixelRatio = fixed; this.renderer.setPixelRatio(fixed); }
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.renderer.domElement.style.width = innerWidth + 'px';
    this.renderer.domElement.style.height = innerHeight + 'px';
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  // ---------- cielo y luz ----------
  makeSky() {
    this.skyU = { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, glow: { value: 1 }, time: { value: 0 }, night: { value: 0 }, cloudy: { value: 0.3 }, cloudK: { value: 1 } };
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), new THREE.ShaderMaterial({
      uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }',
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform float glow; uniform float time; uniform float night; uniform float cloudy; uniform float cloudK; varying vec3 vDir;
        float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }
        float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * n2(p); p *= 2.03; a *= 0.5; } return v; }
        void main(){ vec3 d = normalize(vDir); float h = clamp(d.y, 0.0, 1.0); vec3 c = mix(horizon, top, pow(h, 0.55));
          float s = max(dot(d, sunDir), 0.0); c += vec3(1.0, 0.85, 0.6) * (pow(s, 24.0) * 0.35 + pow(s, 600.0) * 1.5) * glow;
          // Estrellas de noche
          if (night > 0.0 && d.y > 0.0) { vec2 st = floor(d.xz / (d.y + 0.3) * 160.0); float star = step(0.9975, h2(st)); c += vec3(star) * night * 0.9 * smoothstep(0.05, 0.3, d.y); }
          if (d.y > 0.0) {
            vec2 uv = d.xz / (d.y + 0.12) * 1.3 + vec2(time * 0.006, time * 0.003);
            float cl = smoothstep(0.62 - cloudy * 0.3, 0.86 - cloudy * 0.2, fbm(uv)), shade = smoothstep(0.55, 0.95, fbm(uv * 1.3 + 4.0));
            vec3 cc = mix(vec3(1.0, 0.98, 0.95), vec3(0.62, 0.66, 0.74), shade * (0.6 + cloudy * 0.4)) * mix(1.0, 0.2, night) * cloudK;
            c = mix(c, cc, cl * smoothstep(0.0, 0.22, d.y) * 0.9);
          }
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    // (después de todo lo opaco y en el fondo de verdad: así la gráfica solo pinta las nubes donde se ve cielo, en vez
    // de en toda la pantalla para que luego lo tape el suelo; antes de lo transparente, que se mezcla con él)
    this.sky.renderOrder = SKY_LAST;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    this.scene.fog = new THREE.Fog('#c9d2d0', 60, 150);
  }
  makeLights() {
    const sun = (this.sun = new THREE.DirectionalLight('#fff0d8', 2.8));
    sun.castShadow = true;
    sun.shadow.mapSize.set(LOW_Q ? 1024 : 2048, LOW_Q ? 1024 : 2048);
    // (de profundidad, lo justo alrededor de lo que se ve: lo que está más lejos hacia el sol no da sombra aquí)
    Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 18, far: 84 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.025;
    this.scene.add(sun, sun.target);
    this.hemi = new THREE.HemisphereLight('#dcebff', '#6a7f48', 0.9);
    this.scene.add(this.hemi);
    // Luces de cerca (hogares, antorchas, lámparas, candelabros, cristales): siempre las mismas, que se
    // reparten cada fotograma entre las fuentes más cercanas (así el número de luces no cambia nunca)
    this.pool = Array.from({ length: 6 }, () => { const l = new THREE.PointLight('#ffb870', 0, 9, 1.4); this.scene.add(l); return l; });
    // Reflejo del cielo
    const pm = new THREE.PMREMGenerator(this.renderer), env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.SphereGeometry(10, 16, 8), new THREE.MeshBasicMaterial({ side: THREE.BackSide, color: '#b9c6cf' })));
    const ground = new THREE.Mesh(new THREE.CircleGeometry(9, 16), new THREE.MeshBasicMaterial({ color: '#6b5f4e' }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -1; env.add(ground);
    this.scene.environment = pm.fromScene(env, 0.04).texture;
    this.envNow = -1;
    this.scene.traverse(o => { if (o.isLight) o.layers.enable(2); });
  }
  // Cuánto alumbra el reflejo del cielo (en esta versión de Three va en cada material: se recorre cuando cambia mucho)
  setEnv(v) {
    if (Math.abs(v - this.envNow) < 0.02 && this.frames % 120) return;
    this.scene.traverse(o => { const m = o.material; if (m) for (const x of [].concat(m)) if (x.isMeshStandardMaterial) x.envMapIntensity = v; });
    this.envNow = v;
  }

  // Sol, luna, cielo, niebla y tiempo según la hora. hour: 0–24; dark: oscuridad del juego (0–0.85)
  updateSky(game, dt) {
    const days = game.player ? game.days : null, hour = days ? days.localHour : 16.5, info = days?.info || {};   // (la hora de donde estás en el planeta)
    const dark = days ? days.darkness() : 0, rain = info.rain || 0, snow = !!info.snow, fog = !!info.fog || game.days?.weatherHere === 'niebla';
    const indoors = !!game.indoors;
    // El sol sale por el este (+x) y se pone por el oeste, pasando por el sur
    const a = ((hour - 6) / 14) * Math.PI, day = hour > 5.5 && hour < 20.5;
    const sunDir = new THREE.Vector3(Math.cos(a), Math.max(0.12, Math.sin(a)) * 1.1, 0.45).normalize();
    const moonDir = new THREE.Vector3(-Math.cos(a + Math.PI) * 0.6, 0.85, -0.4).normalize();
    const night = Math.min(1, dark / 0.72), dusk = Math.max(0, 1 - Math.abs(hour - (hour < 12 ? 6.5 : 19)) / 1.6) * (1 - night * 0.6);
    const flash = days?.flash || 0;
    this.sunDir = day && night < 0.9 ? sunDir : moonDir;
    this.skyU.night.value = night;
    this.skyU.cloudy.value = rain ? 1 : info.name === 'Nubes' || game.days?.weather === 'nubes' ? 0.75 : 0.3;
    this.skyU.sunDir.value.copy(day ? sunDir : moonDir);
    this.night = night;
    this.weather = { rain: indoors ? 0 : rain, snow: !indoors && snow };
    // La luz de la tabla de look.js, mezclada según la hora y el tiempo. Dentro de casa, la luz del cielo
    // y su reflejo a la mitad: mandan las luces cálidas
    const L = lightAt(night, dusk, rain || fog ? 1 : 0);
    this.skyU.top.value.copy(L.top); this.skyU.horizon.value.copy(L.horizon);
    this.skyU.glow.value = (1 - night) * (rain ? 0.1 : 0.45); this.skyU.cloudK.value = L.cloud;
    toneOut(L.horizon, CURVA.exp, this.scene.fog.color);
    this.scene.fog.near = fog ? 12 : L.near; this.scene.fog.far = fog ? 70 : L.far;
    this.sun.color.copy(L.sun); this.sun.intensity = (day ? 1 : night) + flash * 3;   // (entre la puesta y la noche cerrada, el sol ya no está)
    this.hemi.color.copy(L.hemiC); this.hemi.groundColor.copy(L.hemiS); this.hemi.intensity = (indoors ? 0.5 : 1) + flash;
    this.setEnv((0.08 * (1 - night) + 0.02 * night) * (indoors ? 0.5 : 1));   // (poco: aclaraba y apagaba el contraste)
  }

  // ---------- cámara ----------
  updateCamera(game, scene, dt, ease) {
    const c = this.cam;
    // Giro, inclinación y zoom: aceleran y frenan suave
    c.vel += (CAM.turn * 2.1 - c.vel) * Math.min(1, dt * (CAM.turn ? 5 : 7));
    c.pvel += (CAM.tilt * 0.75 - c.pvel) * Math.min(1, dt * (CAM.tilt ? 5 : 7));
    c.zvel += (CAM.zoom * 0.85 - c.zvel) * Math.min(1, dt * (CAM.zoom ? 6 : 8));
    const cave = scene.kind === 'grid';
    CAM.yaw += c.vel * dt;
    const p = game.player, menu = !p || !game.scene;
    if (CAM.first && !menu) return this.firstPerson(game, scene, c, dt);
    if (this.camera.near !== 0.3) { this.camera.near = 0.3; this.camera.updateProjectionMatrix(); }
    CAM.pitch = Math.max(PITCH.min, Math.min(PITCH.max, CAM.pitch + c.pvel * dt));
    if (CAM.pitch === PITCH.min || CAM.pitch === PITCH.max) c.pvel = 0;
    CAM.dist = Math.max(DIST.min, Math.min(DIST.max, CAM.dist * Math.exp(c.zvel * dt)));
    // A quién sigue: al jugador, o (en el menú) una vuelta lenta por el pueblo
    let tx, ty, tz;
    if (menu) { const t = game.time; tx = CENTER.x + Math.sin(t * 0.07) * 6; tz = CENTER.y + Math.cos(t * 0.05) * 5; ty = 0; CAM.yaw += dt * 0.05; }
    else { tx = p.x; tz = p.y; ty = this.groundY(scene, p.x, p.y) + (p.floor || 0); }   // (subido a algo: a una roca, a la torre)
    // Dentro de una torre (y no en primera persona): lo que tape se recorta (ver models.js, TOWER_CUT)
    { const tw = !menu && !cave && game.places?.poiNear?.(p.x, p.y, 0), inT = !!tw && tw.kind === 'torre' && Math.hypot(p.x - tw.x, p.y - tw.y) < TOWER.inner + 0.4 && !CAM.first;
      TOWER_CUT.inside.value = inT ? 1 : 0;
      if (inT) { TOWER_CUT.player.value.set(p.x, ty + (p.z || 0) - (p.floor || 0), p.y); TOWER_CUT.toCam.value.set(Math.sin(CAM.yaw), Math.cos(CAM.yaw)); } }
    const inside = !menu && !cave && this.world.insideHouse;
    // En cuevas, la cámara va más alta y cerca; dentro de casa, algo más alta
    const wantPitch = cave ? Math.max(0.95, CAM.pitch) : inside ? Math.min(PITCH.max, CAM.pitch + 0.14) : CAM.pitch;
    const wantDist = cave ? Math.min(CAM.dist, 18) : inside ? Math.min(CAM.dist, 19) : CAM.dist;
    c.target.lerp(this.from.set(tx, ty + 0.9 + c.low * 0.5, tz), ease(8));
    // Si una casa tapa al jugador, se sube lo justo para verlo por encima del tejado (comprobado desde la cintura)
    const goal = menu || cave ? wantPitch : this.pitchOver(this.probe2.set(tx, ty + 0.5, tz), wantPitch, wantDist, inside);
    c.pitchNow ??= goal;
    c.pitchNow += (goal - c.pitchNow) * (Math.abs(c.pvel) > 0.01 && goal === wantPitch ? 1 : ease(4));
    c.low = 1 - Math.max(0, Math.min(1, (c.pitchNow - PITCH.min) / 0.75));
    const fov = 30 + c.low * c.low * 12;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    dirOf(CAM.yaw, c.pitchNow, this.ray);
    const reach = cave ? wantDist : this.clearance(c.target, this.ray, wantDist, inside, false).reach;
    c.distNow ??= reach;
    c.distNow += (reach - c.distNow) * (reach < c.distNow ? ease(14) : ease(3));
    this.camera.position.copy(c.target).addScaledVector(this.ray, c.distNow);
    if (!cave) this.camera.position.y = Math.max(this.camera.position.y, this.terrain.heightAt(this.camera.position.x, this.camera.position.z) + 0.35);
    this.camera.lookAt(c.target);
    setViewAngle(CAM.yaw - Math.PI / 4);   // el mapa gira con la cámara
  }
  // Primera persona: la cámara en los ojos del jugador (sube y baja un poco al andar, con su cabeza);
  // ← → giran la mirada, ↑ ↓ miran arriba y abajo. El resto (mundo, luces, sombras) sigue al jugador.
  firstPerson(game, scene, c, dt) {
    CAM.look = Math.max(LOOK.min, Math.min(LOOK.max, CAM.look + c.pvel * dt * 1.6));
    if (CAM.look === LOOK.min || CAM.look === LOOK.max) c.pvel = 0;
    const p = game.player, ground = this.groundY(scene, p.x, p.y), head = this.actors.player?.person.head;
    const eye = head ? head.getWorldPosition(this.probe) : this.probe.set(p.x, ground + 1.55, p.y);   // (sin cabeza aún: los ojos de una persona de pie)
    dirOf(CAM.yaw, 0, this.ray).negate();   // hacia delante, en horizontal
    c.target.set(p.x, ground + 0.9, p.y);
    c.low = 1;
    this.camera.position.copy(eye).addScaledVector(this.ray, 0.14);
    const look = this.from.copy(this.ray).multiplyScalar(Math.cos(CAM.look));
    look.y = Math.sin(CAM.look);
    this.camera.lookAt(look.add(this.camera.position));
    const fov = 70 - 12 * (game.archery?.k || 0);   // (al tensar el arco, se acerca un poco)
    if (this.camera.fov !== fov || this.camera.near !== 0.05) { this.camera.fov = fov; this.camera.near = 0.05; this.camera.updateProjectionMatrix(); }
    setViewAngle(CAM.yaw - Math.PI / 4);
  }
  // Lo que se lleva en la mano, en primera persona: abajo a la derecha, con el vaivén de andar y el gesto al usarlo
  updateViewmodel(game, first) {
    const vm = this.viewmodel, m = this.actors.player;
    const id = first ? (m?.anim ? m.anim.item : game.inv?.held?.id) || null : null;
    if (this.vmItem !== id) {
      this.vmItem = id;
      vm.clear();
      const tool = id && toolModel(id);
      if (tool) {
        // (la herramienta, girada sobre su mango para que el filo del hacha o de la guadaña mire al centro de
        // la pantalla; inclinada hacia delante y hacia dentro)
        const kind = ITEMS[id]?.tool;
        tool.rotation.set(0, ITEMS[id]?.bow ? Math.PI + 0.42 : kind === 'hacha' || kind === 'guadana' ? Math.PI + 0.35 : 0.25, 0);
        tool.traverse(o => { if (o.isMesh) o.castShadow = false; });
        const tilt = new THREE.Group(), hold = new THREE.Group();
        tilt.rotation.set(ITEMS[id]?.bow ? 0 : -0.35, 0, ITEMS[id]?.bow ? 0.3 : 0.32);
        tilt.add(tool);
        hold.scale.setScalar(0.85);
        hold.add(tilt);
        vm.add(hold);
      }
    }
    vm.visible = !!vm.children.length;
    if (!vm.visible) return;
    vm.position.copy(this.camera.position);
    vm.quaternion.copy(this.camera.quaternion);
    const hold = vm.children[0], arm = swingArm(m), walk = Math.min(1, (m?.speed || 0) / 3);
    // (el arco: al tensarlo, al centro y con la cuerda hacia atrás)
    const pull = game.archery?.k || 0;
    pullBow(vm, pull);
    if (ITEMS[this.vmItem]?.bow) { const k = Math.min(1, pull * 3); hold.position.set(0.42 - 0.12 * k, -0.2 + 0.03 * k, -0.86); hold.rotation.set(0, 0, 0); return; }
    hold.rotation.z = 0;
    hold.position.set(0.38 + Math.cos(game.time * 4.5) * 0.01 * walk, -0.44 + Math.abs(Math.sin(game.time * 4.5)) * 0.015 * walk - Math.min(0, arm) * 0.025, -0.72);
    hold.rotation.x = -arm * 0.38;
  }
  // Hasta dónde puede alejarse la cámara sin meterse en el suelo; con houses, también sin cruzar una casa
  clearance(from, dir, max, inside, houses = true) {
    const step = 0.4, boxes = houses ? this.world.houseBoxes() : null;
    for (let d = step; d <= max; d += step) {
      const q = this.probe.copy(from).addScaledVector(dir, d);
      if (q.y < this.terrain.heightAt(q.x, q.z) + 0.3) return { reach: Math.max(1.5, d * 0.92), blocked: false };
      if (boxes) for (const h of boxes) if (h !== inside && q.x > h.x0 && q.x < h.x1 && q.z > h.z0 && q.z < h.z1 && q.y < h.top(q.x, q.z) + 0.35) return { reach: d, blocked: true };
    }
    return { reach: max, blocked: false };
  }
  pitchOver(from, pitch, dist, inside) {
    const dir = this.probe2.clone();
    if (!this.clearance(from, dirOf(CAM.yaw, pitch, dir), dist, inside).blocked) return pitch;
    for (let q = pitch + 0.05; q <= Math.min(1.4, pitch + 0.8); q += 0.05) if (!this.clearance(from, dirOf(CAM.yaw, q, dir), dist, inside).blocked) return q;
    return pitch;
  }
  // Altura del suelo donde pisa algo (en cuevas, el suelo es plano)
  groundY(scene, x, y) {
    if (scene?.kind === 'grid') return 0;
    const L = scene?.levelAt?.(x, y);   // (sobre lo construido: a su altura; ver scenes.js)
    if (L !== null && L !== undefined) return L + (this.world.floorAt(x, y) ? 0.03 : 0);
    if (this.world.floorAt(x, y)) return 0.03;
    return Math.max(this.terrain.heightAt(x, y), WATER_Y - 0.3);
  }

  // ---------- fotograma ----------
  render(game) {
    const dt = Math.min(0.05, this.clock.getDelta()), t = game.time;
    const snap = this.snapNext; this.snapNext = false;
    const ease = rate => (snap ? 1 : Math.min(1, dt * rate));
    const scene = game.scene || game.menuWorld, cave = scene.kind === 'grid';
    this.shown = scene;
    // La vista de la cueva en la que se está (o ninguna)
    if (cave && !this.caves.has(scene)) this.caves.set(scene, new Cave3D(this, scene));
    for (const [s, v] of this.caves) v.group.visible = s === scene;
    this.cave = cave ? this.caves.get(scene) : null;
    this.terrain.group.visible = this.terrain.water.group.visible = this.world.group.visible = this.sky.visible = !cave;
    this.updateSky(game, dt);
    // (el fondo, con el color de borrar: un fondo de escena borraría la imagen en cada una de las tres pasadas)
    if (cave) { this.scene.fog.color.set('#05050a'); this.scene.fog.near = 14; this.scene.fog.far = 40; this.renderer.setClearColor('#05050a'); }
    else this.renderer.setClearColor('#000000');
    this.updateCamera(game, scene, dt, ease);
    const target = this.cam.target;
    if (!cave) {
      this.terrain.world = scene.padK ? scene : null;   // (el suelo, llano junto a lo construido)
      this.terrain.update(scene.gen, target.x, target.z, snap ? 1e9 : 8);
      this.world.update(game, scene, target, dt, snap);
    } else this.cave.update(game, dt);
    // (lo que tardan los actores, de media cada medio segundo: para F3 y el banco)
    { const t0 = performance.now(); this.actors.update(game, scene, dt, t); const ms = performance.now() - t0; this.actorsAcc = (this.actorsAcc || 0) + ms; this.actorsN = (this.actorsN || 0) + 1; this.actorsT = (this.actorsT || 0) + dt; if (this.actorsT >= 0.5) { this.actorsMs = this.actorsAcc / this.actorsN; this.actorsAcc = this.actorsN = this.actorsT = 0; } }
    this.first = CAM.first && !!game.player && !!game.scene;
    this.updateViewmodel(game, this.first);
    this.fx.update(game, scene, dt, t);
    this.arrows.update(game, scene);
    this.terrain.water.uniforms.time.value = t;
    this.terrain.water.uniforms.sky.value.copy(this.skyU.horizon.value);
    // El suelo se moja con la lluvia (en un minuto) y se seca despacio (unos cinco); el agua, con sus gotas
    { const r = game.days?.info?.rain || 0, k = r ? 1 : 0; this.wetNow = (this.wetNow || 0) + (k - (this.wetNow || 0)) * Math.min(1, dt * (k > (this.wetNow || 0) ? 0.05 : 0.01)); WET.value = this.wetNow; RAIN.value = r ? (r === 2 ? 1 : 0.6) : 0; }
    this.skyU.time.value = t;
    this.sky.position.copy(this.camera.position);
    this.updateLights(game, scene, target);
    // Sombras alrededor de lo que se ve (con la cámara baja se ve más lejos: la zona crece y se adelanta),
    // ajustadas a la rejilla del mapa de sombras para que no tiemblen
    const low = this.cam.low, half = Math.round((cave ? 16 : 24) + 6 * low), sc = this.sun.shadow.camera;
    if (sc.right !== half) { Object.assign(sc, { left: -half, right: half, top: half, bottom: -half }); sc.updateProjectionMatrix(); }
    // (la zona se mueve a saltos de 2 m: entre salto y salto, el mapa de sombras solo se rehace cada dos fotogramas)
    const ahead = 12 * low, grid = 2;
    const cx = Math.round((target.x - Math.sin(CAM.yaw) * ahead) / grid) * grid, cz = Math.round((target.z - Math.cos(CAM.yaw) * ahead) / grid) * grid;
    const dir = cave ? CAVE_SUN : this.sunDir, key = `${cx},${cz},${dir.x.toFixed(3)},${dir.y.toFixed(3)},${half}`;
    if (key !== this.shadowKey) { this.shadowKey = key; this.shadowDirty = true; }
    this.sun.target.position.set(cx, 0, cz);
    this.sun.position.set(cx, 0, cz).addScaledVector(dir, 50);
    if (cave) { this.sun.intensity = 0; this.hemi.intensity = 0.4; this.hemi.color.set('#8a9ac0'); this.hemi.groundColor.set('#2a2018'); this.setEnv(0.1); }
    this.draw();
    this.stats(dt);
  }
  // En el menú y al entrar (el mundo no se dibuja: ver Game.render), se hornean los árboles lejanos de la estación de
  // donde se va a jugar, para que al empezar ya estén
  idle(game) {
    let season = 0;
    try { season = game.days.season; season = game.days.localSeason; } catch {}   // (la del sitio, si ya se sabe)
    this.world.prebake(season, game);
  }
  // Reparte las luces de cerca entre las fuentes más próximas al jugador (o a lo que mira la cámara)
  updateLights(game, scene, target) {
    const src = this.cave ? this.cave.lights() : this.world.lights();
    for (const s of this.actors.lights) src.push(s);
    const near = src.map(s => [s, (s.x - target.x) ** 2 + (s.z - target.z) ** 2]).sort((a, b) => a[1] - b[1]);
    const t = game.time;
    this.pool.forEach((l, i) => {
      const s = near[i]?.[0];
      if (!s || near[i][1] > 30 * 30) { l.intensity = 0; return; }
      l.position.set(s.x, s.y, s.z);
      l.color.set(s.color || '#ffb870');
      l.distance = s.range || 8;
      const flick = s.flicker ? 0.86 + Math.sin(t * 13 + i) * 0.07 + Math.sin(t * 29 + i * 2) * 0.06 : 1;
      l.intensity = (s.intensity ?? 3) * flick * (s.always ? 1 : 0.35 + 0.65 * Math.max(this.night, this.cave ? 1 : 0, game.indoors ? 0.8 : 0));
    });
  }
  // Tres pasadas: el mundo (el jugador solo deja su sombra), su silueta donde algo lo tapa y el jugador.
  // En primera persona, solo la primera: el cuerpo no se ve, pero sigue dando sombra (y la barca o el
  // caballo se ven con el mundo).
  draw() {
    const r = this.renderer, mats = this.actors.playerMaterials(this.first);
    r.autoClear = true;
    for (const m of mats) { m.colorWrite = false; m.depthWrite = false; }
    this.camera.layers.enableAll(); this.camera.layers.disable(1);
    if (this.shadowDirty || this.frames % 2 === 0) { r.shadowMap.needsUpdate = true; this.shadowDirty = false; }
    r.render(this.scene, this.camera);
    if (this.first) { for (const m of mats) { m.colorWrite = true; m.depthWrite = true; } this.drawOutline(); return; }
    r.autoClear = false;
    this.camera.layers.set(2);
    this.scene.overrideMaterial = SILHOUETTE;
    if (mats.length) r.render(this.scene, this.camera);
    this.scene.overrideMaterial = null;
    for (const m of mats) { m.colorWrite = true; m.depthWrite = true; }
    if (mats.length) r.render(this.scene, this.camera);
    this.camera.layers.enableAll(); this.camera.layers.disable(1);
    this.drawOutline();
  }
  // El borde amarillo de lo que se apunta con el cursor (game.highlight)
  drawOutline() {
    const g = this.game;
    if (g?.highlight && this.shown === g.scene) (this.outline ||= new Outline(this)).draw(this.renderer, this.camera, g.highlight, g.scene, g.player, g.time);
  }
  // Fotogramas por segundo, con el tiempo de verdad (dt viene recortado: con él nunca bajaría de 20). En Auto, si va
  // lento un rato, se prueba un escalón de resolución menos (ver autoScale)
  stats(dt) {
    const now = performance.now(), real = (now - (this.lastFrame ?? now)) / 1000;
    this.lastFrame = now;
    if (real > 0 && real < 0.25) { this.frames++; this.acc += real; }   // (un parón o la pestaña oculta no cuentan)
    if (this.acc > 0.5) {
      this.fps = this.frames / this.acc;
      if (this.auto) this.autoScale(this.fps, this.acc);
      this.frames = 0; this.acc = 0;
    }
    const info = this.renderer.info.render;
    this.lastInfo = { calls: info.calls, triangles: info.triangles };   // (lo del último fotograma, para el panel de F3)
    this.renderer.info.reset();
  }

  // Resolución automática: empieza al máximo (×2 en una pantalla Retina) y, si va lento unos segundos, baja un
  // escalón. Luego mira si ha servido: si no va al menos un 10 % mejor, vuelve al de antes y ya no baja más. Por
  // debajo de cierto punto lo que frena no es la gráfica (en un MacBook Air, de ×1 a ×0,75 se ganan 1-3 ms y la
  // imagen se emborrona), y perder nitidez sin ganar fotogramas no compensa.
  autoScale(fps, span) {
    const a = (this.scaling ||= { slow: 0, sum: 0, floor: 0.75, trial: null });
    if (a.trial) {
      if ((a.trial.wait -= span) > 0) return;   // (un momento para que se asiente el cambio)
      a.trial.t += span; a.trial.sum += fps * span;
      if (a.trial.t < 2) return;
      if (a.trial.sum / a.trial.t < a.trial.before * 1.1) { a.floor = a.trial.from; this.setScale(a.trial.from); }
      a.trial = null; a.slow = a.sum = 0;
      return;
    }
    if (fps < 40) { a.slow += span; a.sum += fps * span; } else a.slow = a.sum = 0;
    const next = Math.round((this.pixelRatio - 0.25) * 4) / 4;
    if (a.slow >= 2 && next >= a.floor) { a.trial = { from: this.pixelRatio, before: a.sum / a.slow, t: 0, sum: 0, wait: 1 }; this.setScale(next); }
  }
  setScale(x) { this.pixelRatio = x; this.renderer.setPixelRatio(x); this.resize(); }

  // Casilla bajo un punto de la pantalla: el rayo desde la cámara hasta el suelo
  // (se avanza por el rayo, a pasos que crecen con la distancia, hasta que baja del suelo: así acierta
  // también con el terreno en cuesta y con la cámara en primera persona)
  tileAt(clientX, clientY) { const p = this.pointAt(clientX, clientY); return p && [Math.floor(p[0]), Math.floor(p[1])]; }
  // El punto del suelo bajo el ratón (x, y de la rejilla, con decimales)
  // El rayo que sale de la cámara por un punto de la pantalla: origen y dirección, [x, altura, y] del mundo
  rayAt(clientX, clientY) {
    if (!this.shown) return null;
    this.raycaster.setFromCamera(new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1), this.camera);
    const { origin: o, direction: d } = this.raycaster.ray;
    return { o: [o.x, o.y, o.z], d: [d.x, d.y, d.z] };
  }
  pointAt(clientX, clientY) {
    const scene = this.shown;
    if (!scene) return null;
    const ndc = new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const o = this.raycaster.ray.origin, d = this.raycaster.ray.direction;
    if (d.y > -1e-3) return null;
    let prev = 0;
    for (let t = 0.05; t < 160; t += 0.08 + t * 0.015) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y <= this.groundY(scene, x, z)) {
        // Afinar entre el paso anterior y este
        let a = prev, b = t;
        for (let i = 0; i < 6; i++) { const m = (a + b) / 2; if (o.y + d.y * m <= this.groundY(scene, o.x + d.x * m, o.z + d.z * m)) b = m; else a = m; }
        return [o.x + d.x * b, o.z + d.z * b];
      }
      prev = t;
    }
    return null;
  }
  // Sin transiciones en el próximo fotograma (al empezar, al cambiar de escena)
  snap() { this.snapNext = true; this.cam.pitchNow = this.cam.distNow = null; }
  // Espera (como mucho ms) a que el suelo de alrededor de la cámara esté hecho: para no destapar la vista sobre el vacío
  whenReady(ms = 1500) {
    const t0 = performance.now(), target = this.cam.target;
    let frames = 0;   // (dos fotogramas de margen: que la vista haya pasado ya al mundo nuevo)
    return new Promise(res => { const look = () => { if (++frames > 2 && (this.cave || this.terrain.ready(target.x, target.z) || performance.now() - t0 > ms)) res(); else requestAnimationFrame(look); }; look(); });
  }
}
const CAVE_SUN = new THREE.Vector3(0.2, 1, 0.3).normalize();
const SILHOUETTE = new THREE.MeshBasicMaterial({ color: '#ffe8b0', transparent: true, opacity: 0.45, depthFunc: THREE.GreaterDepth, depthWrite: false, fog: false });
const dirOf = (yaw, pitch, out) => out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
