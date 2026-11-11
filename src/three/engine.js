// Dibujo del juego en 3D. Cada fotograma copia el estado del juego (el mundo por trozos, lo construido, las
// personas, los animales, los efectos) a una escena de Three.js y la pinta desde una cámara que orbita
// alrededor del jugador: gira (← →), se inclina de ras de suelo a casi cenital (↑ ↓) y se acerca o aleja
// (+ −), siempre con aceleración y frenado suaves. No atraviesa el suelo y, si una casa se pone entre ella y
// el jugador, sube lo justo para verlo por encima del tejado. El sol sigue la hora del juego (y la luna de
// noche), el cielo tiene nubes, y hay lluvia, nieve, tormentas y niebla según el tiempo.
import { TOWER_CUT, modelMats } from './models.js';
import { baseMaterials } from './build3d.js';
import { tintMats } from './tints.js';
import { photoBases } from './textures.js';
import { TOWER } from '../world/tower.js';
import * as THREE from 'three';
import { Outline } from './outline.js';
import { CAM, PITCH, DIST, LOOK } from '../camera.js';
import { setViewAngle } from '../iso.js';
import { CENTER } from '../world/village.js';
import { latOf } from '../world/planet.js';
import { Settings } from '../settings.js';
import { Terrain, WATER_Y, WET, RAIN, groundDetail } from './terrain.js';
import { World3D } from './world3d.js';
import { Actors, toolModel, swingArm, pullBow } from './actors.js';
import { ITEMS } from '../items.js';
import { Fx } from './fx.js';
import { ArrowsView } from './arrows.js';
import { Glow } from './glow.js';
import { Cave3D } from './cave3d.js';
import { SunShadow } from './sunshadow.js';
import { setRenderer as contactRenderer, contactOn, contactSun, contactRestored } from './contact3d.js';
import { TONE_MAPPING, CURVA, lightAt, toneOut } from './look.js';
import { preloadPhotos, photosSettled } from './photos.js';
import { trackVram, vramLost } from './vram.js';

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

const SWIM_EYE = 0.7;   // (ver feetY)

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
    r.shadowMap.autoUpdate = false;   // lo fijo, solo cuando hace falta; lo que se mueve, en cada fotograma (ver sunshadow.js)
    r.info.autoReset = false;
    trackVram(r.getContext());   // (lo que ocupa en la gráfica, para F3 y el banco: ver vram.js)
    // (las fotos de las texturas, desde ya: llegan mientras se entra con la cuenta, antes de hacer ningún material)
    preloadPhotos();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.3, 420);
    this.camera.layers.enable(2);
    this.clock = new THREE.Clock();
    this.makeSky();
    this.makeLights();
    this.terrain = new Terrain(this.scene);
    contactRenderer(r);   // (la sombra de contacto, solo en este renderer: ver contact3d.js)
    this.world = new World3D(this);
    this.actors = new Actors(this);
    // En primera persona, lo que se lleva en la mano se ve abajo a la derecha
    this.viewmodel = new THREE.Group(); this.viewmodel.visible = false; this.scene.add(this.viewmodel);
    this.fx = new Fx(this);
    this.arrows = new ArrowsView(this);
    this.glow = new Glow(this);   // (los halos, las ventanas y los charcos de luz de noche)
    this.shadows = new SunShadow(this);   // (después de todo lo que se mueve: son sus grupos)
    this.terrain.onReshape = box => this.shadows.stale(false, box);   // (un hoyo nuevo: sus paredes dan sombra)
    this.caves = new Map();       // escena de cueva → su vista
    this.cave = null;
    this.cam = { target: new THREE.Vector3(CENTER.x, 0, CENTER.y), vel: 0, pvel: 0, zvel: 0, pitchNow: null, distNow: null, low: 0 };
    this.ray = new THREE.Vector3(); this.probe = new THREE.Vector3(); this.probe2 = new THREE.Vector3(); this.from = new THREE.Vector3();
    this.raycaster = new THREE.Raycaster();
    this.frames = 0; this.acc = 0;
    this.drawn = 0;   // fotogramas del mundo pintados (antes del primero, nada espera a sus programas: ver gate)
    // (para F3: lo que ha esperado a sus programas y cuánto, lo que se pintó en el acto por estar cerca, lo que cuesta
    // pedirlos después de entrar y el último programa que llegó al tope sin estar)
    this.gateStats = { held: 0, ms: 0, prep: 0, prepMs: 0, near: 0, askMs: 0, asked: 0, known: 0, top: '' };
    // (si la gráfica pierde el contexto: ver restored)
    canvas.addEventListener('webglcontextrestored', () => this.restored());
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
    this.skyU = { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, glow: { value: 1 }, time: { value: 0 }, night: { value: 0 }, moon: { value: 0 }, cloudy: { value: 0.3 }, cloudK: { value: 1 } };
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), new THREE.ShaderMaterial({
      uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }',
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform float glow; uniform float time; uniform float night; uniform float moon; uniform float cloudy; uniform float cloudK; varying vec3 vDir;
        float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }
        float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * n2(p); p *= 2.03; a *= 0.5; } return v; }
        void main(){ vec3 d = normalize(vDir); float h = clamp(d.y, 0.0, 1.0); vec3 c = mix(horizon, top, pow(h, 0.55));
          float s = max(dot(d, sunDir), 0.0); c += vec3(1.0, 0.85, 0.6) * (pow(s, 24.0) * 0.35 + pow(s, 600.0) * 1.5) * glow;
          // Estrellas de noche y la luna (moon: sunDir es ya la dirección de la luna, no la del sol poniéndose): el disco y un
          // halo frío alrededor. Antes de las nubes, que la tapan
          if (night > 0.0) {
            if (d.y > 0.0) { vec2 st = floor(d.xz / (d.y + 0.3) * 160.0); float star = step(0.9975, h2(st)); c += vec3(star) * night * 0.9 * smoothstep(0.05, 0.3, d.y); }
            float mo = dot(d, sunDir);
            c += vec3(0.82, 0.87, 1.0) * (smoothstep(0.99935, 0.99965, mo) * 1.4 + pow(max(mo, 0.0), 60.0) * 0.10) * night * moon;
          }
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
    this.makeEnv();
    this.envNow = -1;
    this.scene.traverse(o => { if (o.isLight) o.layers.enable(2); });
  }
  // Reflejo del cielo (se pinta en la gráfica: si se pierde el contexto, se vuelve a hacer)
  makeEnv() {
    const pm = new THREE.PMREMGenerator(this.renderer), env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.SphereGeometry(10, 16, 8), new THREE.MeshBasicMaterial({ side: THREE.BackSide, color: '#b9c6cf' })));
    const ground = new THREE.Mesh(new THREE.CircleGeometry(9, 16), new THREE.MeshBasicMaterial({ color: '#6b5f4e' }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -1; env.add(ground);
    const old = this.scene.environment;
    this.scene.environment = pm.fromScene(env, 0.04).texture;
    old?.dispose();
    // (el reflejo se queda; lo de hacerlo, no: el generador guarda un lienzo de trabajo de 768×1024 en coma flotante, 6 MB
    // de la gráfica que no vuelven a servir)
    pm.dispose();
    env.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  }
  // La gráfica ha perdido el contexto (el controlador se ha reiniciado, falta memoria…) y ha vuelto. Three vuelve a subir
  // solo lo que tiene en memoria (geometrías, texturas con su imagen, programas al pintar); lo que se pintó en la gráfica
  // se ha perdido y se rehace aquí: el reflejo del cielo, la caché de las sombras de lo fijo, el atlas de los impostores
  // (se hornea otra vez) y el de la sombra de contacto (de su copia en memoria). Lo que esperaba a sus programas se
  // enseña ya (esos programas ya no existen) y los que se compilaban antes de tiempo se vuelven a pedir
  restored() {
    console.warn('Gráfica: contexto recuperado; se rehace lo pintado en ella');
    vramLost(this.renderer.getContext());
    try { this.makeEnv(); } catch (e) { console.warn(e); }
    this.envNow = -1;
    this.shadows.restored();
    // (lo que se estaba compilando antes de tiempo para los impostores no acabará: esos programas ya no existen. Se vuelve
    // a pedir cuando el atlas esté horneado otra vez)
    this.world.stopWarm();
    this.world.impostorsLost();
    contactRestored();
    for (const g of this.gated?.splice(0) || []) { try { g.show(); } catch (e) { console.warn(e); } }
    this.known = null;   // (lo que se había visto listo ya no lo está)
    if (this.prep) { this.prep.busy = null; this.prep.seen = null; this.prep.warm = false; }
    if (this.glow) this.glow.warm = false;
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
    // (la luna sale poco a poco al cambiar de dirección: a las 20:30 ya es casi de noche y su disco no salta de golpe, ni en el
    // cielo ni en el agua; al amanecer se va igual)
    const ssH = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    this.skyU.moon.value = day ? 0 : hour >= 12 ? ssH(20.5, 21.3, hour) : 1 - ssH(4.7, 5.5, hour);
    this.night = night;
    this.weather = { rain: indoors ? 0 : rain, snow: !indoors && snow };
    this.fogNow = fog && !indoors;
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
    else { tx = p.x; tz = p.y; ty = this.feetY(scene, p); }
    // Dentro de una torre (y no en primera persona): lo que tape se recorta (ver models.js, TOWER_CUT)
    { const tw = !menu && !cave && game.places?.poiNear?.(p.x, p.y, 0), inT = !!tw && tw.kind === 'torre' && Math.hypot(p.x - tw.x, p.y - tw.y) < TOWER.inner + 0.4 && !CAM.first;
      TOWER_CUT.inside.value = inT ? 1 : 0;
      if (inT) { TOWER_CUT.player.value.set(p.x, ty + (p.z || 0) - (p.floor || 0), p.y); TOWER_CUT.toCam.value.set(Math.sin(CAM.yaw), Math.cos(CAM.yaw)); } }
    this.camScene = cave ? null : scene;   // (para camGround: lo cavado de ahí)
    const inside = !menu && !cave && this.world.insideHouse;
    // En cuevas, la cámara va más alta y cerca; dentro de casa, algo más alta
    const wantPitch = cave ? Math.max(0.95, CAM.pitch) : inside ? Math.min(PITCH.max, CAM.pitch + 0.14) : CAM.pitch;
    const wantDist = cave ? Math.min(CAM.dist, 18) : inside ? Math.min(CAM.dist, 19) : CAM.dist;
    c.target.lerp(this.from.set(tx, ty + 0.9 + c.low * 0.5, tz), ease(8));
    // Si una casa tapa al jugador, se sube lo justo para verlo por encima del tejado (comprobado desde la cintura). Dentro de
    // un hoyo, igual con sus paredes: la cámara se levanta hasta verlo desde arriba (si no, se pegaba a él a ras del borde y
    // el suelo de alrededor lo tapaba)
    const pit = !menu && !cave && scene.digH?.(Math.floor(p.x), Math.floor(p.y)) != null;
    const goal = menu || cave ? wantPitch : this.pitchOver(this.probe2.set(tx, ty + 0.5, tz), wantPitch, wantDist, inside, pit);
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
    if (!cave) this.camera.position.y = Math.max(this.camera.position.y, this.camGround(this.camera.position.x, this.camera.position.z) + 0.35);
    this.camera.lookAt(c.target);
    setViewAngle(CAM.yaw - Math.PI / 4);   // el mapa gira con la cámara
  }
  // Primera persona: la cámara en los ojos del jugador (sube y baja un poco al andar, con su cabeza);
  // ← → giran la mirada, ↑ ↓ miran arriba y abajo. El resto (mundo, luces, sombras) sigue al jugador.
  firstPerson(game, scene, c, dt) {
    CAM.look = Math.max(LOOK.min, Math.min(LOOK.max, CAM.look + c.pvel * dt * 1.6));
    if (CAM.look === LOOK.min || CAM.look === LOOK.max) c.pvel = 0;
    const p = game.player, ground = this.feetY(scene, p), head = this.actors.player?.person.head;
    const eye = head ? head.getWorldPosition(this.probe) : this.probe.set(p.x, ground + 1.55, p.y);   // (sin cabeza aún: los ojos de una persona de pie)
    // (en el agua, los ojos nunca por debajo de ella: buceando, la cámara se queda asomada; bajo el agua no se dibuja)
    if (p.swim || p.depth > 0) eye.y = Math.max(eye.y, WATER_Y + 0.1);
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
    const id = first && !game.player?.swim ? (m?.anim ? m.anim.item : game.inv?.held?.id) || null : null;   // (nadando, se guarda)
    if (this.vmItem !== id) {
      this.vmItem = id;
      vm.clear();
      const tool = id && toolModel(id);
      if (tool) {
        // (la herramienta, girada sobre su mango para que el filo del hacha o de la guadaña mire al centro de
        // la pantalla; inclinada hacia delante y hacia dentro)
        const kind = ITEMS[id]?.tool;
        tool.rotation.set(0, ITEMS[id]?.bow ? Math.PI + 0.42 : kind === 'hacha' || kind === 'guadana' ? Math.PI + 0.35 : 0.25, 0);
        if (kind === 'pala') tool.rotation.set(-1.05, 0.15, 0);   // (la pala, tumbada hacia delante con la hoja arriba: se ve si lleva tierra)
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
      if (q.y < this.camGround(q.x, q.z) + 0.3) return { reach: Math.max(1.5, d * 0.92), blocked: false, ground: true };
      if (boxes) for (const h of boxes) if (h !== inside && q.x > h.x0 && q.x < h.x1 && q.z > h.z0 && q.z < h.z1 && q.y < h.top(q.x, q.z) + 0.35) return { reach: d, blocked: true };
    }
    return { reach: max, blocked: false };
  }
  // El suelo para la cámara: el natural (el de la malla) o, en lo cavado y en la tierra apilada, el de esa casilla (llano). Con
  // el natural, en un hoyo el aire de encima contaba como tierra: la cámara se pegaba al jugador o se subía al borde
  camGround(x, z) {
    const D = this.camScene?.digH?.(Math.floor(x), Math.floor(z));
    return D ?? Math.max(this.terrain.heightAt(x, z), WATER_Y);   // (el agua, como el suelo: la cámara no se mete bajo ella)
  }
  // (pit: el jugador está en un hoyo, y el suelo también tapa; ahí se sube hasta 1,45 aunque sea más de 0,8: un hoyo hondo y
  // estrecho solo se ve desde muy arriba)
  pitchOver(from, pitch, dist, inside, pit = false) {
    const dir = this.probe2.clone(), shut = q => { const r = this.clearance(from, dirOf(CAM.yaw, q, dir), dist, inside); return r.blocked || (pit && r.ground); };
    if (!shut(pitch)) return pitch;
    const top = pit ? Math.max(pitch, 1.45) : Math.min(1.4, pitch + 0.8);
    for (let q = pitch + 0.05; q <= top; q += 0.05) if (!shut(q)) return q;
    return pit ? top : pitch;
  }
  // Dónde tiene los pies el jugador (para la cámara): en el agua, en el fondo (como lo dibuja actors.js) o, nadando, donde
  // la cámara mira a su cabeza, a ras del agua (con los pies de verdad, a un metro largo, miraba bajo el agua y se pegaba a
  // él). Andando por lo hondo o saltando de ahí a la orilla, no más abajo que nadando: la cámara no se hunde de golpe
  feetY(scene, p) {
    if (p.swim) return WATER_Y - SWIM_EYE;
    if (p.depth > 0 && !p.boat && !p.aboard) return WATER_Y - Math.min(p.depth, SWIM_EYE);
    return this.groundY(scene, p.x, p.y) + (p.floor || 0);   // (subido a algo: a una roca, a la torre)
  }
  // Altura del suelo donde pisa algo (en cuevas, el suelo es plano)
  groundY(scene, x, y) {
    if (scene?.kind === 'grid') return 0;
    const L = scene?.levelAt?.(x, y);   // (sobre lo construido: a su altura; ver scenes.js)
    if (L !== null && L !== undefined) return L + (this.world.floorAt(x, y) ? 0.03 : 0);
    if (this.world.floorAt(x, y)) return 0.03;
    const D = scene?.digH?.(Math.floor(x), Math.floor(y));   // (lo cavado con la pala, llano a su altura: ver scenes.js)
    if (D !== null && D !== undefined) return D;
    return Math.max(this.terrain.heightAt(x, y), WATER_Y - 0.3);
  }

  // ---------- fotograma ----------
  render(game) {
    const dt = Math.min(0.05, this.clock.getDelta()), t = game.time;
    // Las fotos de las texturas, antes del primer fotograma del mundo (como mucho 2,5 s; casi siempre ya han llegado en
    // la pantalla de entrada): así los materiales se hacen ya con la foto compartida (ver textures.js, photoTex). Si no
    // llegan a tiempo, se sigue con los lienzos pintados y la foto encima cuando llegue: igual de bien, con más memoria.
    // Una sola espera: si el menú ya ha esperado y adelantado los materiales (idle), no se vuelve a esperar; si empezó a
    // esperar, el plazo cuenta desde entonces. (antes de leer snapNext: el salto de cámara al empezar no se pierde)
    if (!this.photosOk) {
      this.photoT0 ||= this.idleT0 || performance.now();
      if (!this.warm && !photosSettled() && performance.now() - this.photoT0 < 2500) { this.renderer.setClearColor('#000000'); this.renderer.clear(); return; }
      this.photosOk = true;
    }
    const snap = this.snapNext; this.snapNext = false;
    const ease = rate => (snap ? 1 : Math.min(1, dt * rate));
    const scene = game.scene || game.menuWorld, cave = scene.kind === 'grid';
    this.shown = scene;
    // La vista de la cueva en la que se está (o ninguna). Las de las que ya no se pisan se sueltan al final del fotograma
    // (después de dibujar la nueva, que así hereda sus programas sin compilarlos otra vez): cada vez que se entra o se
    // cambia de nivel la escena es otra, y nunca se vuelve a la misma. La última se guarda, escondida, al salir al mundo
    // (unos 3 MB): si no, sus programas (el recorte, el techo, el hielo…) se soltarían con ella y entrar en la próxima
    // cueva sería compilarlos otra vez, con un tirón
    if (cave && !this.caves.has(scene)) this.caves.set(scene, new Cave3D(this, scene));
    if (cave) this.lastCave = scene;
    for (const [s, v] of this.caves) v.group.visible = s === scene;
    this.cave = cave ? this.caves.get(scene) : null;
    this.terrain.group.visible = this.terrain.water.group.visible = this.world.group.visible = this.world.spin.visible = this.sky.visible = !cave;
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
    { const p = game.player; this.wet = !!p && !!game.scene && !p.boat && !p.aboard && (p.swim || p.depth > 0.05); }   // (ver draw)
    this.updateViewmodel(game, this.first);
    this.fx.update(game, scene, dt, t);
    this.arrows.update(game, scene);
    this.updateWater(t);
    // El suelo se moja con la lluvia (en un minuto) y se seca despacio (unos cinco); el agua, con sus gotas
    { const r = game.days?.info?.rain || 0, k = r ? 1 : 0; this.wetNow = (this.wetNow || 0) + (k - (this.wetNow || 0)) * Math.min(1, dt * (k > (this.wetNow || 0) ? 0.05 : 0.01)); WET.value = this.wetNow; RAIN.value = r ? (r === 2 ? 1 : 0.6) : 0; }
    this.skyU.time.value = t;
    this.sky.position.copy(this.camera.position);
    { const L = this.updateLights(game, scene, target); this.glow.update(game, scene, L.src, L.lit, this.cave ? this.cave.flames() : this.world.flames(), t); }
    // Sombras alrededor de lo que se ve (con la cámara baja se ve más lejos: la zona crece y se adelanta), alineadas a los
    // texels del mapa para que no tiemblen; el sol, quieto entre repintado y repintado de lo fijo (ver sunshadow.js)
    this.shadows.place(target, CAM.yaw, this.cam.low, cave, this.sunDir, 24 + 6 * this.cam.low);
    contactSun(this.shadows.dir);   // (la sombra lejana de las copas cae hacia donde está pintado el sol de las sombras)
    if (cave) { this.sun.intensity = 0; this.hemi.intensity = 0.4; this.hemi.color.set('#8a9ac0'); this.hemi.groundColor.set('#2a2018'); this.setEnv(0.1); }
    // (lo que esperaba a sus programas y ya los tiene, a la vista; y al entrar, a oscuras hasta que lo de alrededor está
    // compilado: ver prepare)
    this.openGates();
    if (this.prepare()) { this.renderer.setClearColor('#000000'); this.renderer.clear(); return; }
    this.draw();
    this.drawn++;
    for (const [s, v] of this.caves) if (s !== scene && s !== this.lastCave) { v.dispose(); this.caves.delete(s); }
    this.stats(dt);
  }
  // En el menú y al entrar (el mundo no se dibuja: ver Game.render), se hornean los árboles lejanos de la estación de
  // donde se va a jugar, para que al empezar ya estén
  idle(game) {
    // (con las fotos ya aquí: la corteza de los árboles va en el horneado; como mucho 2,5 s, como el primer fotograma)
    if (!photosSettled() && performance.now() - (this.idleT0 ||= performance.now()) < 2500) return;
    // Los materiales de lo construido, de los modelos y de los tintes, el detalle del suelo y las fotos subidas a la gráfica,
    // uno por fotograma: así no se hacen todos de golpe en el primer fotograma del mundo (pintar la media de cada variante
    // y subir cada foto es casi un segundo en un portátil)
    if (!this.warm) this.warm = (function* (r) { baseMaterials(); yield; modelMats(); yield; tintMats(); yield; groundDetail(); yield; for (const t of photoBases()) { r.initTexture(t); yield; } })(this.renderer);
    if (!this.warm.done && !this.warm.next().done) return;
    this.warm.done = true;
    let season = 0;
    try {
      // (la del sitio: con jugador, la de donde está; en el menú, la de donde está la partida guardada; si no, la del pueblo)
      const d = game.days, y = game.player ? null : game.savedY?.();
      season = d.season;
      season = y != null ? (latOf(y) < 0 ? (season + 2) % 4 : season) : d.localSeason;
    } catch {}
    this.world.prebake(season, game);
  }
  // El cielo que refleja el agua (el mismo que se ve: horizonte y cenit, el sol o la luna, su halo, la noche y las nubes) y
  // la ribera que se refleja junto a la orilla: el color de la hierba (o de la nieve) de la estación con la luz de ahora,
  // algo más oscuro (lo que sube en la orilla, hierba alta y árboles, se ve más en sombra que el suelo)
  updateWater(t) {
    const U = this.terrain.water.uniforms, S = this.skyU;
    U.time.value = t;
    U.sky.value.copy(S.horizon.value); U.skyTop.value.copy(S.top.value); U.sunDir.value.copy(S.sunDir.value);
    U.glow.value = S.glow.value; U.night.value = S.night.value; U.moon.value = S.moon.value; U.cloudy.value = S.cloudy.value; U.cloudK.value = S.cloudK.value;
    const a = BANK[this.terrain.season] || BANK[0], k = Math.max(0.15, this.sunDir?.y || 0) * this.sun.intensity;
    U.bank.value.copy(this.hemi.color).multiplyScalar(this.hemi.intensity).add(TMP_C.copy(this.sun.color).multiplyScalar(k)).multiply(a).multiplyScalar(0.6 / Math.PI);
  }
  // Reparte las luces de cerca entre las fuentes más próximas al jugador (o a lo que mira la cámara). Devuelve las fuentes
  // del mundo o de la cueva (src, sin el farol del jugador) y las que tienen ahora luz de verdad (lit), para los halos y los
  // charcos de luz (glow.js)
  updateLights(game, scene, target) {
    const src = this.cave ? this.cave.lights() : this.world.lights(), lit = this.litNow ||= new Set();
    const near = src.concat(this.actors.lights).map(s => [s, (s.x - target.x) ** 2 + (s.z - target.z) ** 2]).sort((a, b) => a[1] - b[1]);
    const t = game.time;
    lit.clear();
    this.pool.forEach((l, i) => {
      const s = near[i]?.[0];
      if (!s || near[i][1] > 30 * 30) { l.intensity = 0; return; }
      lit.add(s);
      l.position.set(s.x, s.y, s.z);
      l.color.set(s.color || '#ffb870');
      l.distance = s.range || 8;
      const flick = s.flicker ? 0.86 + Math.sin(t * 13 + i) * 0.07 + Math.sin(t * 29 + i * 2) * 0.06 : 1;
      l.intensity = (s.intensity ?? 3) * flick * (s.always ? 1 : 0.35 + 0.65 * Math.max(this.night, this.cave ? 1 : 0, game.indoors ? 0.8 : 0));
    });
    return { src, lit };
  }
  // Tres pasadas: el mundo (el jugador solo deja su sombra), su silueta donde algo lo tapa y el jugador.
  // En primera persona, solo la primera: el cuerpo no se ve, pero sigue dando sombra (y la barca o el
  // caballo se ven con el mundo). En el agua (wet), solo la primera y con el jugador dentro: lo que queda bajo el agua se
  // ve a través de ella, como los demás (con la silueta, el agua lo tapaba y salía blanco, como un fantasma)
  draw() {
    const r = this.renderer, mats = this.actors.playerMaterials(this.first), wet = this.wet && !this.first;
    r.autoClear = true;
    if (!wet) for (const m of mats) { m.colorWrite = false; m.depthWrite = false; }
    this.camera.layers.enableAll(); this.camera.layers.disable(1);
    r.shadowMap.needsUpdate = true;   // (en cada fotograma: sunshadow.js decide qué se rehace)
    // (la sombra de contacto, solo en la pasada del mundo y fuera de las cuevas: fuera de draw, quien dibuje con los mismos
    // materiales no la lee)
    contactOn(!this.cave);
    r.render(this.scene, this.camera);
    contactOn(false);
    if (this.first || wet) { for (const m of mats) { m.colorWrite = true; m.depthWrite = true; } this.drawOutline(); return; }
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
  snap() { this.snapNext = true; this.snapT = performance.now(); this.cam.pitchNow = this.cam.distNow = null; }
  // Espera (como mucho ms) a que el suelo de alrededor de la cámara esté hecho y sus programas de sombreado compilados:
  // para no destapar la vista sobre el vacío ni con el juego parado compilando (ver prepare). Siempre acaba: si la vista
  // no llega a pintar (un error en cada fotograma) o otra espera ocupa su sitio, por tiempo (WAIT_MAX de más)
  whenReady(ms = 1500) {
    const T0 = performance.now(), target = this.cam.target, P = { t0: T0, ms, busy: null };
    let frames = 0, t0 = T0;   // (dos fotogramas de margen: que la vista haya pasado ya al mundo nuevo)
    this.prep = P;
    // (mientras render espera a las fotos, no se pide suelo: el plazo empieza al acabar esa espera, que dura 2,5 s como mucho)
    return new Promise(res => {
      const look = () => {
        const now = performance.now();
        if (!this.photosOk && now - T0 < ms + 2600) { frames = 0; t0 = now; }
        const mine = this.prep === P, ground = this.cave || this.terrain.ready(target.x, target.z) || now - t0 > ms;
        // (con el suelo listo y lo de alrededor compilado, aún dos fotogramas pintados a oscuras: los programas de la pasada
        // de sombras que no se pueden prever salen ahí, y no al destapar. Compilar puede alargar la espera hasta PREP_MAX)
        if (ground && (P.done || !mine || now - T0 > ms + PREP_MAX)) { P.end = true; P.d0 ??= this.drawn; }
        const done = ++frames > 2 && P.end && this.drawn - P.d0 >= 2;
        if (done || now - T0 > ms + 2600 + PREP_MAX + WAIT_MAX) {
          if (!done) console.warn('Gráfica: la entrada no ha acabado de prepararse a tiempo; se destapa igual');
          if (this.prep === P) this.prep = null;
          res();
        } else requestAnimationFrame(look);
      };
      look();
    });
  }

  // ---------- programas de sombreado ----------
  // Compilar un programa (en una Iris Plus, de decenas a cientos de ms cada uno) al pintar para el juego entero: la gráfica
  // lo necesita ya. Con KHR_parallel_shader_compile se puede pedir antes y seguir a lo nuestro mientras la gráfica lo hace
  // aparte. Así:
  // - al entrar a jugar o en una cueva (whenReady), a oscuras, se compila todo lo de alrededor antes de pintar nada
  //   (prepare), y el fundido no se queda parado;
  // - después, lo nuevo que montan world3d.js y actors.js pasa por gate: si trae un programa que la gráfica no tiene, se
  //   esconde hasta que está (unos cientos de ms, en el borde de lo que se ve) en vez de parar todo al pintarlo. Lo de
  //   cerca no: mejor un parón que un hueco junto al jugador (ver gateNear).
  // Cada vez, también los programas de la pasada de sombras que se pueden prever (depthProxies).
  // Lo que ya está compilado se reconoce en el acto (la caché de programas de Three): no cuesta más que preguntar.
  // Devuelve los programas que aún no están: los nuevos y los que ya pidió otro y se están compilando
  compileFor(root) {
    const r = this.renderer, P = r.info.programs, n0 = P ? P.length : 0, wait = new Set();
    const rt = r.getRenderTarget(), face = r.getActiveCubeFace(), mip = r.getActiveMipmapLevel();
    try {
      // (sin destino: con la curva de tono y el sRGB de la pantalla, como al pintar el mundo)
      r.setRenderTarget(null);
      // (en las dos pasadas, también los que ya había pedido otro y aún no están: Three reutiliza el pendiente)
      const add = mats => { for (const m of mats) { const p = r.properties.get(m).currentProgram; if (p && !ready(p)) wait.add(p); } };
      add(r.compile(root, this.camera, this.scene));
      // (la sombra se pinta en su mapa: sin curva y en lineal, y sin escena, así que sin niebla, con las mismas luces. El
      // destino da igual mientras sea uno: el mapa aún no existe antes del primer fotograma)
      const D = this.depthProxies(root), fog = this.scene.fog;
      if (D.children.length) { r.setRenderTarget(this.depthRT ||= new THREE.WebGLRenderTarget(1, 1)); this.scene.fog = null; try { add(r.compile(D, this.camera, this.scene)); } finally { this.scene.fog = fog; } }
    } catch (e) { console.warn('Programas: no se han podido pedir antes', e); }
    finally {
      r.setRenderTarget(rt, face, mip);
      // (las copias, fuera aunque algo falle: retienen los objetos de verdad; y las de profundidad no se quedan con las
      // texturas: las de una persona que ya no está no se soltarían)
      if (this.depthRoot) this.depthRoot.children.length = 0;
      for (const d of this.depthMats?.values() || []) d.map = d.alphaMap = d.displacementMap = null;
    }
    if (P) for (let i = n0; i < P.length; i++) if (!ready(P[i])) wait.add(P[i]);
    return [...wait];
  }
  // Lo que da sombra, con el material con el que lo pinta en el mapa la pasada de sombras de Three (getDepthMaterial):
  // el suyo propio (customDepthMaterial) o uno de profundidad con lo que Three le copia del material (la cara, la textura,
  // el recorte). El común lo comparten todos y su programa depende del orden en que se pintan: así salen todas las
  // variantes que pueden tocar (alguna de más, en paralelo; mejor que una de menos al pintar). Son copias vacías del objeto
  // (Object.create), solo para compilar
  depthProxies(root) {
    const D = (this.depthRoot ||= new THREE.Group()), C = (this.depthMats ||= new Map());
    root.traverse(o => {
      if (!o.castShadow || !o.material || !(o.isMesh || o.isLine || o.isPoints)) return;
      for (const m of [].concat(o.material)) {
        if (!m || !m.visible) continue;
        let d = o.customDepthMaterial;
        if (!d) {
          const k = `${m.side}|${m.shadowSide}|${!!m.map}|${!!m.alphaMap}|${m.alphaTest > 0}|${!!m.displacementMap}`;
          if (!(d = C.get(k))) C.set(k, (d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })));
        }
        // (con lo que le pone Three a ese material justo antes de pintar)
        d.side = m.shadowSide !== null ? m.shadowSide : SHADOW_SIDE[m.side];
        d.map = m.map; d.alphaMap = m.alphaMap; d.alphaTest = m.alphaTest; d.displacementMap = m.displacementMap; d.displacementScale = m.displacementScale;
        const p = Object.create(o);
        p.children = []; p.material = d;
        D.children.push(p);
      }
    });
    return D;
  }
  // Lo nuevo que entra en la escena (un trozo, un bloque lejano, un tejado, una persona o un animal): si sus programas ya
  // están, show() en el acto; si no, se piden y show() cuando estén. Sin show, se esconde (visible) y se enseña luego: solo
  // para grupos cuya visibilidad no toca nadie más. box ([x0, z0, x1, z1] del mundo, lo que ocupa): si queda cerca, en el
  // acto (ver gateNear); al enseñarlo, solo se repintan las sombras de lo fijo si cae en su zona. Antes del primer
  // fotograma, y mientras prepare, todo pasa sin esperar
  gate(obj, show = null, box = null) {
    if (!this.drawn || this.prep || !this.renderer.extensions.has('KHR_parallel_shader_compile')) { show?.(); return; }
    if (this.gateNear(box)) { this.gateStats.near++; show?.(); return; }
    // (preguntar a Three cuesta: recorre la escena entera para las luces y calcula la clave de cada malla, unos 0,4 ms
    // por malla en una Iris Plus. Lo que ya se ha visto listo, sin preguntar: ver unknown)
    const t = performance.now(), fresh = this.unknown(obj), progs = fresh.length ? this.compileFor(obj) : [];
    this.gateStats.askMs += performance.now() - t; this.gateStats[fresh.length ? 'asked' : 'known']++;
    if (!progs.length) { this.remember(fresh); show?.(); return; }
    // (al enseñarlo, lo fijo del mapa de sombras se repinta: mientras estaba escondido no daba sombra)
    if (!show) { obj.visible = false; show = () => { obj.visible = true; this.shadows?.stale(false, box); }; }
    (this.gated ||= []).push({ progs, show, fresh, t0: performance.now() });
    this.gateStats.held++;
  }
  // Las mallas de obj cuyo programa no se ha visto aún listo: material (y su versión), clase de malla (instanciada, con
  // color por pieza, con esqueleto…), si recibe y da sombra y qué datos trae la geometría; con lo que de la escena cambia
  // el programa (las luces son siempre las mismas: el sol, el cielo y PointLights fijas). Si algo se escapa, se compila
  // al pintar, como antes de gate
  unknown(obj) {
    const r = this.renderer, fog = this.scene.fog, ctx = `${r.shadowMap.enabled}|${r.toneMapping}|${r.outputColorSpace}|${fog ? fog.isFogExp2 ? 2 : 1 : 0}`;
    if (this.known?.ctx !== ctx) this.known = { ctx, m: new WeakMap() };
    const K = this.known.m, out = [];
    obj.traverse(o => {
      if (!o.material || !(o.isMesh || o.isLine || o.isPoints)) return;
      const g = o.geometry, a = g?.attributes, mo = g?.morphAttributes;
      const sig = `${o.isInstancedMesh ? 'i' : ''}${o.instanceColor ? 'c' : ''}${o.isSkinnedMesh ? 's' : ''}${o.isBatchedMesh ? 'b' : ''}${o.receiveShadow ? 'r' : ''}${o.castShadow ? 'd' + (o.customDepthMaterial?.id ?? '') : ''}${o.isPoints ? 'p' : o.isLine ? 'l' : ''}|${a ? Object.keys(a).join() : ''}|${a?.color?.itemSize || 0}|${mo ? Object.keys(mo).join() : ''}`;
      for (const m of [].concat(o.material)) if (m && !K.get(m)?.has(sig + '|' + m.version)) out.push([m, sig + '|' + m.version]);
    });
    return out;
  }
  remember(list) {
    const K = this.known?.m;
    if (K) for (const [m, k] of list) { let s = K.get(m); if (!s) K.set(m, (s = new Set())); s.add(k); }
  }
  // ¿Cerca de la cámara? Lo que queda a menos de GATE_NEAR no espera escondido a sus programas: un hueco junto al jugador
  // (el trozo que pisa, la casa que edita, un monstruo que se le acerca) se ve mucho más que un parón. Tras un salto
  // (snap: /tp, cruzar el polo, volver a casa al morir) lo de alrededor llega en varios fotogramas, todo nuevo: durante
  // un par de segundos, también lo de un poco más lejos. Lo del borde de lo que se ve sí espera
  gateNear(box) {
    if (!box) return false;
    const t = this.cam.target, dx = Math.max(box[0] - t.x, 0, t.x - box[2]), dz = Math.max(box[1] - t.z, 0, t.z - box[3]);
    const R = performance.now() - (this.snapT ?? -1e9) < 2000 ? GATE_NEAR_SNAP : GATE_NEAR;
    return dx * dx + dz * dz < R * R;
  }
  // Cada fotograma, antes de pintar: lo que ya tiene sus programas (o lleva demasiado esperando) se enseña
  openGates() {
    const G = this.gated;
    if (!G?.length) return;
    const now = performance.now();
    for (let i = G.length - 1; i >= 0; i--) {
      const g = G[i];
      const ok = g.progs.every(ready);
      if (now - g.t0 < GATE_MAX && !ok) continue;
      G.splice(i, 1);
      this.gateStats.ms = Math.max(this.gateStats.ms, now - g.t0);
      // (para F3: qué programa no ha llegado a tiempo, para saber por qué)
      if (ok) this.remember(g.fresh); else this.gateStats.top = g.progs.filter(p => !ready(p)).map(p => p.name).join(', ');
      try { g.show(); } catch (e) { console.warn(e); }
    }
  }
  // Al entrar (whenReady), hasta destapar: cada vez que hay algo nuevo en la escena se compila todo lo que falte, en
  // paralelo, y no se pinta hasta que está. Devuelve true si este fotograma no se pinta
  prepare() {
    const P = this.prep;
    if (!P || P.end) return false;
    const now = performance.now();
    if (P.busy) { const ok = P.busy.every(ready); if (now - P.busyT < PREP_MAX && !ok) return true; if (!ok) P.late = true; P.busy = null; }
    // (lo de alrededor llega en varios fotogramas, del otro hilo y por tandas: cada vez, solo lo que no se ha mirado aún,
    // con copias vacías de cada objeto; la primera, también el suelo y el agua, que llegan los últimos)
    const seen = (P.seen ||= new WeakSet()), N = (this.prepRoot ||= new THREE.Group());
    if (!P.warm) { P.warm = true; N.children.push(...this.terrain.proxies().children); }
    this.scene.traverse(o => { if (o.material && !seen.has(o)) { seen.add(o); const q = Object.create(o); q.children = []; N.children.push(q); } });
    let progs = [];
    if (N.children.length) {
      const t = performance.now();
      (P.fresh ||= []).push(...this.unknown(N));
      progs = this.compileFor(N);
      N.children.length = 0;
      this.gateStats.prepMs += performance.now() - t; this.gateStats.prep += progs.length;
    }
    P.done = !progs.length || !this.renderer.extensions.has('KHR_parallel_shader_compile');
    // (todo lo de la entrada, listo: gate no lo vuelve a preguntar. Si algo llegó al tope sin estar, no se apunta nada)
    if (P.done && !progs.length && !P.late) this.remember(P.fresh || []);
    if (P.done) P.fresh = null;
    if (!P.done) { P.busy = progs; P.busyT = now; return true; }
    return false;
  }
}
// (el color de la ribera reflejada en el agua, por estación: hierba de primavera, de verano, parda de otoño y nieve)
const BANK = ['#4f6a3a', '#5c6a38', '#6e5a36', '#c9ced2'].map(c => new THREE.Color(c)), TMP_C = new THREE.Color();
const PREP_MAX = 6000;   // ms que compilar puede alargar la espera al entrar (a oscuras, pero sin parar el juego)
const GATE_MAX = 4000;   // ms que algo nuevo puede quedar escondido esperando a sus programas (luego se pinta igual)
const WAIT_MAX = 3000;   // ms de más que whenReady espera, como mucho, a que la vista pinte a oscuras (luego se destapa igual)
const GATE_NEAR = 28;        // m alrededor de la cámara en los que lo nuevo se pinta en el acto (ver gateNear)
const GATE_NEAR_SNAP = 56;   // y justo después de un salto (lo de alrededor que se hace con todo, NEAR trozos)
// Un programa listo, o soltado mientras se esperaba (WebGLProgram.destroy deja program sin nada: no estará nunca, y
// preguntarle da error en cada fotograma)
const ready = p => p.program === undefined || p.isReady();
// (la cara que pinta la pasada de sombras de Three según la del material: ver depthProxies)
const SHADOW_SIDE = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };
const SILHOUETTE = new THREE.MeshBasicMaterial({ color: '#ffe8b0', transparent: true, opacity: 0.45, depthFunc: THREE.GreaterDepth, depthWrite: false, fog: false });
const dirOf = (yaw, pitch, out) => out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
