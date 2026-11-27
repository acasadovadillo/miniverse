// Todo lo que se mueve: el jugador, Nilo, los vecinos y los mercaderes (personas con su "look"), los
// animales del rancho (gallinas, vacas y ovejas), los monstruos de las cuevas (limos, murciélagos y
// esqueletos), el caballo y la barca. Cada entidad del juego tiene su modelo, que se crea al verla por
// primera vez y se quita cuando deja de estar. Miran hacia donde van, andan y respiran; el jugador lleva en
// la mano la herramienta elegida y la balancea al golpear. Los demás jugadores (en directo) son como él,
// con su nombre encima.
import { foodModel } from './food3d.js';
import * as THREE from 'three';
import { mesh, mergeInto, G, M } from './shapes.js';
import { mat } from './geo.js';
import { ANIMALS } from '../art/farm.js';
import { MONSTERS } from '../combat.js';
import { CAM, screenToWorld, screenDirOf } from '../camera.js';
import { ITEMS, TIERS } from '../items.js';
import { WATER_Y } from './terrain.js';
import { animalModel, animalKey, animateAnimal, horseModel, animateHorse, SEAT, setHorseDirt, setHorseCare, disposeAnimal, prewarmHorse, HORSE_ACTS } from './animals.js';
import { nearX } from '../world/planet.js';
import { scaleOf } from '../herds.js';
import { raceKey } from '../horsebreeds.js';
import { RealPerson, realBaby, prebuildReal, realReady, realStats } from './realperson.js';
import { armband } from './law3d.js';
import { apagada } from '../opciones.js';
import { smoothstep } from '../util.js';
import { Audio } from '../audio.js';
import { reportFault } from '../faults.js';
import { kindOf, placeKit, shownOf, splitKit, poseClass } from '../kit.js';
import { bakeStowed, buildKit, brushModel } from './kit3d.js';
import { carriedModel, placeCarried, holdPose, pushedModel, placePushed, pushPose, pushedReach, loadModel, placeLoad } from './carry3d.js';
import { barrowName, barrowSize, TUB, bathFoam } from './models.js';
import { rowBoatGeo } from './places3d.js';
import { unpackBd } from '../body.js';
import { BULKY } from '../carry-items.js';
import { inBounds, distToPath } from '../world/village.js';
// (saddlebags.js fillOf, read lazily as needs.js reads the gestures: a static import would pull the game's modules,
// barrow.js and entities.js, into the drawing's)
let fillOfKg = null;
import('../saddlebags.js').then(m => { fillOfKg = m.fillOf || null; }, () => {});

// Agachado: cuánto se adelantan los muslos y se doblan las rodillas (rad), cuánto baja el cuerpo (m: lo que suben
// los pies al doblar las piernas, para que sigan en el suelo) y se echa hacia delante (rad; la cabeza lo compensa
// para seguir mirando al frente)
const HERD_SHADOW = 26;   // m: a wild animal of a herd further than this casts only its trunk's shadow
const CROUCH = { hip: 1.5, knee: 2.5, drop: 0.11, lean: 0.4 };
// (asientos, camas y barca se calibraron con los muñecos de antes: la persona realista se ajusta a esas medidas. La
// cadera de aquel muñeco sentado, lo que medía tumbado y la escala de sus niños; no cambiarlas sin recolocar muebles)
const SIT_IN = 0.24;   // (how far under the saddle's seat the rider's feet are, with the hips at SEAT_HIP)
const SEAT_HIP = 0.36, LIE_LEN = 1.36, KID_REF = 0.66;
// In the tub (pose kind 'bath', body.js bathe; another player's: 'sit' with st.ba): the hip this high over the tub's
// ground plus the pose's h, on the tub's floor (models.js TUB) with the legs straight forward
const BATH_HIP = 0.26;
// Shivering (body.js cold ≥ 0.6: surface().shiver, or another player's bd bit) while standing still: how fast it comes in
// and goes (1/s) and the tremble (Hz)
export const SHIVER = { in: 3, out: 2, hz: 8, ax: -0.3, az: 0.5, ay: 0, fx: -1.9 };   // (and the hug: shoulder forward, shoulder in, elbow; see shiverBones)
const LOOK_R = 2.6;      // a qué distancia se mira a quien se tiene al lado
// Nadar a braza: claves de una brazada (momento de 0 a 1, valor; ver keys). Tira con los brazos abiertos y la cabeza
// arriba para respirar (0-0,44; los codos bajan y las manos barren por debajo, sin pasar nunca de la horizontal, o salen
// del agua y parece que saluda), las manos se juntan bajo la barbilla y salen hacia delante mientras se recogen las piernas
// (0,44-0,56), patada de rana, abriendo y cerrando (0,52-0,74), y se desliza estirado. pitch: lo que se tumba el cuerpo
// hacia delante desde la cadera (π/2, del todo); rise: lo que sube la cadera al respirar (m); arm y fore, el hombro y
// el codo (x: hacia delante, negativo; z: hacia fuera); leg, shin y foot, la cadera, la rodilla y el tobillo (z: abrir)
const BRAZA = {
  pitch: [[0, 1.42], [0.25, 1.3], [0.4, 1.17], [0.55, 1.3], [0.72, 1.46], [1, 1.42]],
  rise: [[0, 0], [0.3, 0.03], [0.42, 0.06], [0.6, -0.01], [0.8, 0], [1, 0]],
  spine: [[0, 0], [0.4, -0.14], [0.6, 0], [1, 0]],
  neck: [[0, -0.42], [0.35, -0.6], [0.45, -0.64], [0.62, -0.38], [1, -0.42]],
  head: [[0, -0.32], [0.35, -0.5], [0.62, -0.28], [1, -0.32]],
  armX: [[0, -3.0], [0.18, -2.78], [0.34, -2.1], [0.44, -1.55], [0.56, -3.0], [1, -3.0]],
  armZ: [[0, 0.18], [0.18, 0.78], [0.34, 0.95], [0.44, 0.3], [0.56, 0.18], [1, 0.18]],
  foreX: [[0, -0.05], [0.18, -0.2], [0.34, -0.5], [0.44, -1.15], [0.56, -0.1], [1, -0.05]],
  legX: [[0, 0.1], [0.38, 0.1], [0.52, -0.95], [0.6, -0.5], [0.72, 0.12], [1, 0.1]],
  legZ: [[0, 0.03], [0.4, 0.06], [0.52, 0.3], [0.6, 0.55], [0.72, 0.04], [1, 0.03]],
  shinX: [[0, 0.05], [0.38, 0.1], [0.52, 2.0], [0.6, 1.1], [0.72, 0.04], [1, 0.05]],
  footX: [[0, 0.9], [0.4, 0.6], [0.52, -0.25], [0.62, -0.2], [0.74, 0.9], [1, 0.9]],
};
// Nadando, la cadera bajo el agua (m): deslizándose, casi en la superficie; quieto, flotando de pie (con los hombros
// dentro y la cabeza fuera); y lo que queda, como poco, sobre el fondo (tumbado o de pie)
const SWIM_HIP = { stroke: 0.14, tread: 0.46 }, SWIM_BED = { stroke: 0.38, tread: 0.75 };
// Diving (entities.js dive, st.dv for the others): from DIVE_POSE[0] m of dive the body goes horizontal (all of it at
// DIVE_POSE[1]), arms stretched forward and the legs kicking; stroking forwards it is the breaststroke, under water too.
// Going down tilts the body and the head down; coming up, the body up. Past QUIET m under (sink + dive) no splashes, no
// rings on the water and no stroke sound
const DIVE_POSE = [0.3, 1.2], QUIET = 0.35;
const DIVE = { pitch: 1.35, down: 0.3, up: 0.6, head: 0.44, neck: -0.55, headX: -0.3, armX: -2.9, armZ: 0.25, foreX: -0.15, legX: -0.1, kick: 0.35, shinX: 0.35, footX: 0.9 };
const BUILD_MS = 6;      // lo que se puede ir en hacer modelos nuevos en un fotograma
const WAIT_NEAR = 30;    // m: las personas por hacer más cerca que esto se esperan a oscuras al entrar o en un salto
// Las personas, según lo que miden en pantalla (px de alto, en píxeles CSS: no le afecta la resolución automática). Con la
// cámara de siempre (fov 30, 22 m) una persona mide unos 2 260/d px: a todo hasta unos 25 m, a 30 Hz hasta unos 56 m y a
// 15 Hz más allá; de lejos (LOD1, sin dedos ni ojos) desde unos 38 m, y vuelve a cerca por debajo de unos 31 m. Las
// cifras de subir son un 10 % más que las de bajar, para que no cambie a cada momento en el borde
const TIER_PX = [[90, 81], [40, 36]];      // [para subir, para seguir]: a todo; a 30 Hz; si no, a 15 Hz
// The rider (Plan F §5.3). At the gallop: the trunk forward (rad; the head up by most of it, to look ahead) and a small
// rise out of the saddle (m) with the stride, late on the horse's own bob (bouncePh, rad). While the horse rears: the
// rider turns back with it, but only rearTilt of its pitch, and leans in at the waist (rearLean), both hands on its neck
// (the grip: the arm forward and in, the elbow bent)
// Turning at speed the horse and its rider lean into the turn (bank: by how hard they turn, at most so many rad). On the
// sliding stop the rider sits back (back), and is thrown forward onto the neck when it stumbles (fall)
const RIDE = { astride: 1.15, bank: 0.012, bankMax: 0.2, back: 0.42, fall: 0.6, lean: 0.25, bounce: 0.025, bouncePh: 2.2, rearTilt: 0.55, rearLean: 0.5, gripArm: -0.75, gripIn: -0.12, gripFore: -0.85 };
// (leading one: the arm with the rope, and how much of the walk's swing it keeps, a quarter)
const LEAD_ARM = { x: 0.3, out: 0.2, fore: -0.5 };
// Holding the reins in the saddle: the arms down by the ribs, the forearms forward, the hands together over the withers
const REIN_ARM = { x: -0.3, in: 0.16, fore: -1.15 };
// Horses heard (m): the hooves, the snort and the neigh of another player's horse, or of your own nobody rides, fade out
// to nothing at this distance; yours under you, always at full
const HEAR_M = 20;
// A start another game names otherwise: a spook is a rear here
const ACT_ALIAS = { spook: 'rear', scared: 'rear' };
// When an act with no start time was first seen (a game that sends none): kept by the act, never on it
const ACT_T = new WeakMap();
const SHAKE_SNORT = 0.45;   // (s into a shake: it blows out through its nose)
// Hard ground under hooves (louder, a clop with a ring): a cave, inside, anything built, the village's path and plaza
function hardGround(scene, e) {
  if (!scene || scene.kind !== 'world' || e.inside) return true;
  if (scene.levelAt && scene.levelAt(e.x, e.y) !== null) return true;
  return (inBounds(e.x, e.y) && distToPath(e.x, e.y) < 1.1) || !!scene.gen?.roads?.onRoad(Math.floor(e.x), Math.floor(e.y));
}
// What a brushing hand holds (no item: hold() shows brushModel while the 'brush' gesture lasts)
const BRUSH = '\u0001brush';
const BONE_DT = [0, 1 / 30, 1 / 15, Infinity];   // cada cuánto se posan los huesos en cada nivel (3: fuera de la vista)
const LOD_PX = [60, 72];                   // de lejos por debajo de 60 px; de cerca otra vez por encima de 72
const LOD_GAP = 0.6;                       // segundos, como poco, entre dos cambios de detalle de la misma persona
// ?personas=0 (o =todas): todas a todo (sin dormidas, sin LOD1 y animadas en cada fotograma), para comparar (opciones.js)
const ALL = apagada('personas');
const FR = new THREE.Frustum(), PV = new THREE.Matrix4(), SPH = new THREE.Sphere(), V3 = new THREE.Vector3(), V2 = new THREE.Vector2(), CAMDIR = new THREE.Vector3();

// Una malla del jugador: con su propio material (para dibujar su silueta) y en la capa 2. En la primera pasada del
// dibujo no escribe ni color ni fondo (solo deja su sombra): esa vez se salta, sin dejar de dar sombra (el mapa de
// sombras se pinta aparte), y se ahorra una llamada por pieza en cada fotograma
function ownMesh(o, m, body = false) {
  const base = o.material;
  o.material = base.clone();
  // (clone() no copia el parche del shader: las personas realistas lo llevan para la piel y el pelo)
  if (base.onBeforeCompile) { o.material.onBeforeCompile = base.onBeforeCompile; o.material.customProgramCacheKey = base.customProgramCacheKey; }
  m.mats.push(o.material);
  if (body) m.body.push(o.material);
  o.layers.set(2);
  let count = null;
  o.onBeforeRender = (r, s, c, geo, mat) => { if (!mat.colorWrite && !mat.depthWrite) { count = geo.drawRange.count; geo.drawRange.count = -1; } };
  o.onAfterRender = (r, s, c, geo) => { if (count !== null) { geo.drawRange.count = count; count = null; } };
}

export class Actors {
  constructor(view) {
    this.view = view;
    this.group = new THREE.Group();
    view.scene.add(this.group);
    this.models = new Map();      // entidad → { obj, kind, prev, … }
    this.lights = [];
    this.player = null;
    this.time = 0; this.stats = null;
    this.warm = []; this.warmKey = null;   // las personas por hacer de antemano (ver prewarm)
    this.built = new WeakSet();   // (the looks made that way: later)
    this.rushing = 0;
  }
  // Los materiales del jugador (para su silueta); body: solo los de su cuerpo y lo que lleva en la mano
  // Un jugador espectador se ve como un fantasma (solo lo ven los otros espectadores, y él mismo)
  ghost(m, on) {
    if (!!m.ghosted === on) return;
    m.ghosted = on;
    if (m.mats) { for (const mat of m.mats) Object.assign(mat, { transparent: on, opacity: on ? 0.35 : 1, needsUpdate: true }); return; }   // (los del tuyo ya son solo suyos)
    m.root.traverse(o => {
      if (!o.isMesh) return;
      if (on && !o.userData.solid) {
        const base = o.material;
        o.userData.solid = base; o.material = base.clone(); Object.assign(o.material, { transparent: true, opacity: 0.35, depthWrite: false });
        // (clone() no copia el parche del shader: sin él, la piel de la persona realista saldría sin su sombreado)
        if (base.onBeforeCompile) { o.material.onBeforeCompile = base.onBeforeCompile; o.material.customProgramCacheKey = base.customProgramCacheKey; }
      }
      else if (!on && o.userData.solid) { o.material.dispose(); o.material = o.userData.solid; delete o.userData.solid; }
    });
  }
  own(o, m) { ownMesh(o, m); }   // (something drawn with the player that is not theirs to make: reins3d.js)
  playerMaterials(body = false) { return (body ? this.player?.body : this.player?.mats) || []; }

  update(game, scene, dt, t) {
    const seen = new Set(), p = game.player && game.scene ? game.player : null;
    this.time += dt;
    this.prepView(scene);
    this.prewarm(game);
    if (!this.horseWarm && this.view.drawn) { this.horseWarm = true; prewarmHorse(this.view.renderer, this.view.camera, this.view.scene); }   // (the horse's mud program: animals.js)
    const list = [...(scene.entities || [])];
    if (game.player && game.scene === scene) for (const s of game.systems) { let more; try { more = s.entities?.(scene); } catch (e) { reportFault(e, `${s.constructor.name}.entities`); } if (more) list.push(...more); }   // (aislado: ver game.js, hook)
    if (p) list.unshift(p);
    this.around = list; this.me = p; this.game = game;   // (para mirar a quien se tiene al lado)
    const wait = [];   // personas y bebés por hacer, si no caben en este fotograma (ver BUILD_MS)
    for (const e of list) {
      if (!e || seen.has(e)) continue;
      seen.add(e);
      let m = this.models.get(e);
      // (el jugador y los demás jugadores, con la ropa que llevan: si se ponen o se quitan algo, se rehace su persona; si solo
      // cambia la mochila, no: se pone o se quita en la que hay, ver pose)
      const look = e === p ? game.appearance() : e.look;
      if (m && (e === p || e.remote) && m.look !== look) { if (m.kind === 'person' && look && m.look && bodyKey(m.look) === bodyKey(look)) { m.look = look; m.nextLook = null; } else if (this.later(m, e, look)) { /* (the one there is stays meanwhile) */ } else { this.drop(e, m); m = null; } }
      else if (m?.nextLook) m.nextLook = null;
      if (m?.kind === 'animal' && !this.sameAnimal(m, e)) { this.drop(e, m); m = null; }
      if (!m) {
        // (hacer una persona cuesta mucho, 100-250 ms: los vecinos van después, por cercanía. El jugador y los demás
        // jugadores, al momento, para que no desaparezcan al cambiarse de ropa; animales y monstruos son baratos)
        if ((e.baby || look) && e !== p && !e.remote) { wait.push(e); continue; }
        m = this.add(e, e === p, look);
        if (!m) continue;
      }
      this.place(m, e, scene, dt, t, p, game);
    }
    // Las personas que faltan: de cerca a lejos, sin pasar de BUILD_MS por fotograma (al menos una cada vez). Así, al
    // llegar a un sitio con mucha gente, no se para todo de golpe y la de al lado sale la primera
    // (waitNear: las que quedan por hacer cerca del jugador; al entrar o en un salto, whenReady espera a que estén, para no
    // destapar con un tirón por persona justo después: ver engine.js)
    this.waitNear = 0;
    if (wait.length) {
      const d = p ? e => Math.hypot((scene.kind === 'world' ? nearX(e.x, p.x) : e.x) - p.x, e.y - p.y) : () => 0;
      if (p) wait.sort((a, b) => d(a) - d(b));
      const t0 = performance.now();
      for (const e of wait) {
        if (e !== wait[0] && performance.now() - t0 > BUILD_MS) { if (d(e) < WAIT_NEAR) this.waitNear++; continue; }
        const m = this.add(e, false, e.look);
        if (m) this.place(m, e, scene, dt, t, p, game);
      }
    }
    for (const [e, m] of this.models) if (!seen.has(e)) this.drop(e, m);
    if (this.rushing > 0) this.rushing--;
    this.count();
    // En cuevas y mazmorras el jugador lleva un farol
    this.lights.length = 0;
    if (p && scene.kind === 'grid') this.lights.push({ x: p.x, y: 1.8, z: p.y, intensity: 8, range: 14, color: '#ffc880', always: true, flicker: true });
  }

  // Quitar un modelo: fuera de la escena y suelta lo que es suyo. La malla y el lienzo de una persona son de todas las
  // de su look (release, en persona.js); los materiales propios (los del jugador, los del espectador, el nombre) y la
  // barca, sí se liberan. Las herramientas no: sus geometrías se comparten (SHAPES)
  drop(e, m) {
    this.group.remove(m.root); this.models.delete(e);
    if (m === this.player) this.player = null;
    try {
      m.person?.dispose?.(); m.release?.();
      for (const x of m.mats || []) x.dispose();
      if (m.kind === 'animal') disposeAnimal(m.root);   // (its merged geometries and a horse's mud material)
      if (m.horse) disposeAnimal(m.horse);
      m.root.traverse(o => {
        if (o.userData.solid) o.material.dispose();
        if (o.isSprite) { o.material.map?.dispose(); o.material.dispose(); }
      });
      // (de espectador, la barca lleva clones, ya soltados arriba: los suyos de verdad están en userData.solid)
      m.boat?.traverse(o => { if (o.isMesh && !o.userData.shared) { o.geometry.dispose(); if (o.userData.solid) o.userData.solid.dispose(); else if (!m.mats) o.material.dispose(); } });   // (a big thing in its bow: shared, carry3d.js)
    } catch (err) { console.warn('Miniverse: no se pudo soltar un modelo', err); }
  }

  // Lo que hace falta para saber cómo se ve cada persona en este fotograma: el cono de la cámara, cuántos px mide en
  // pantalla un metro a un metro de ella, hacia dónde y cuánto se alarga una sombra por metro de alto (con el sol bajo,
  // alguien fuera de la vista puede dar sombra dentro), hasta dónde llega la niebla y en qué casa está el jugador
  prepView(scene) {
    const v = this.view, cam = v.camera;
    cam.updateMatrixWorld();
    FR.setFromProjectionMatrix(PV.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    cam.getWorldDirection(CAMDIR);
    // (el alto en px CSS que guarda Three al cambiar de tamaño: leer el del lienzo podría obligar a rehacer la maquetación)
    this.pxK = (v.renderer.getSize(V2).y || innerHeight) / (2 * Math.tan(cam.fov * Math.PI / 360));
    // (la dirección del sol con la que se pinta el mapa de sombras: si las sombras la guardan, esa. El sol más bajo tiene
    // y = 0,12: una persona da entonces unos 14 m de sombra)
    const s = v.shadows?.dir || v.sunDir, up = scene.kind !== 'grid' && s && s.y > 0.05;
    this.shK = up ? Math.hypot(s.x, s.z) / Math.max(0.1, s.y) : 0;
    const h = up ? Math.hypot(s.x, s.z) || 1 : 1;
    this.shDir = up ? [-s.x / h, -s.z / h] : [0, 0];
    this.fogFar = v.scene.fog?.far ?? 1e9;
    this.regionOf = scene.kind === 'world' ? v.world?.regionOf : null;
    this.inRegion = v.world?.insideRegion ?? null;
  }
  // Cómo se ve esta persona (que no es el jugador): 3 fuera de la vista (ni se dibuja, ni da sombra, ni se anima), 0 a
  // todo, 1 a 30 Hz y 2 a 15 Hz; y su detalle (P.lod). y: la altura de sus pies, con lo que ha subido (saltando, en una
  // torre, a caballo o en barca). La esfera crece hacia donde cae su sombra, para que una sombra larga al atardecer no
  // aparezca de golpe en el borde de la pantalla; tumbada, cubre el cuerpo a lo largo; a caballo o en barca, también eso
  grade(m, e, x, y, z, lying) {
    if (ALL || m === this.player || !m.person) return (m.tier = 0);
    const P = m.person, h = P.height, cy = lying ? y + 0.3 : y + h * 0.5, cam = this.view.camera, me = this.me;
    const shLen = Math.min(16, h * this.shK);
    SPH.center.set(x + this.shDir[0] * shLen * 0.5, cy, z + this.shDir[1] * shLen * 0.5);
    // (tumbada, de la raíz a la cabeza y a los pies hay menos de lo que mide: ver LIE_LEN)
    SPH.radius = (lying ? h : h * 0.75) + shLen * 0.5 + (m.horse?.visible || m.boat?.visible ? 1.3 : 0) + (m.carriedWhere === 'push' ? 1.2 : 0);   // (pushing a wheelbarrow, it reaches 1.7 m ahead)
    const d = cam.position.distanceTo(V3.set(x, cy, z));
    const near = me ? Math.hypot(x - me.x, z - me.y) : Infinity, cerca = near < 4 || (e.remote && near < 12);
    // (más allá de la niebla ya es de su color; los demás jugadores no, que llevan su nombre encima. La niebla de Three va
    // por la profundidad en la vista, no por la distancia: en los lados de la pantalla, alguien más lejos aún se ve)
    const fogged = !e.remote && V3.sub(cam.position).dot(CAMDIR) > this.fogFar + 4;
    if (!cerca && (fogged || !FR.intersectsSphere(SPH))) return (m.tier = 3);
    const px = h * this.pxK / Math.max(0.1, d);
    const reg = this.regionOf?.get(`${Math.floor(e.x)},${Math.floor(e.y)}`);
    const tapada = !!reg && reg !== this.inRegion && !this.view.world?.regions.get(reg)?.glass;   // bajo un tejado que no es el tuyo: se ve por ventanas y puertas
    const was = m.tier ?? 0, up = (i, k) => px >= TIER_PX[i][was <= k ? 1 : 0];
    let t = up(0, 0) ? 0 : up(1, 1) ? 1 : 2;
    // (tapada, a 15 Hz; si se ve grande, desde la puerta o una ventana, a 30: a 15 se notarían los saltos de la cabeza)
    if (tapada) t = t === 0 ? 1 : 2;
    // (andando, los pies apoyados se moverían con el cuerpo entre pose y pose: a 30 Hz como mucho, y solo ya pequeña)
    if (m.speed > 0.3) t = up(1, 1) ? 0 : 1;
    if (cerca) t = 0;
    m.tier = t;
    const now = P.lod | 0, want = cerca ? 0 : px < LOD_PX[0] ? 1 : px > LOD_PX[1] ? 0 : now;
    if (want !== now && this.time - (m.lodAt ?? -9) > LOD_GAP) { P.lod = want; m.lodAt = this.time; }
    return t;
  }
  // Las cifras para F3 y el banco
  count() {
    const s = { modelos: 0, vistas: 0, dormidas: 0, t0: 0, t1: 0, t2: 0, lod1: 0, tris: 0 };
    for (const m of this.models.values()) {
      if (m.kind !== 'person' && m.kind !== 'baby') continue;
      s.modelos++;
      if (!m.root.visible) { s.dormidas++; continue; }
      s.vistas++;
      if (m.kind === 'person') { s['t' + Math.min(2, m.tier ?? 0)]++; if (m.person.lodNow) s.lod1++; s.tris += m.person.lodNow ? m.person.r.trisL : m.person.r.tris; }
    }
    const r = realStats();
    if (r) { s.protos = r.protos; s.protosLibres = r.libres; s.lienzos = r.lienzos; }
    this.stats = s;
  }
  // Hacer de antemano las personas que van a salir (los vecinos, también los que están en casa, Nilo y los niños): un
  // vecino que sale por su puerta aparece sin el tirón de hacerlo entero (100-250 ms, solo el procesador). Se hacen
  // mientras la pantalla está a oscuras (al entrar en la partida o al cambiar de escena), una por fotograma, y si no, solo
  // en un rato libre de verdad (más de 40 ms sin nada que hacer: en pausa, en un menú). Nunca a la fuerza en plena partida,
  // que sería el mismo tirón. La lista se rehace si cambia el mundo o cuántos vecinos o niños hay (los niños llegan poco a poco)
  prewarm(game) {
    const world = game.world, people = game.neighbors?.people;
    if (!world || !people) return;
    const kids = game.family?.ents, key = [world, people, people.length, kids?.size ?? 0, world.nilo?.look ? 1 : 0];
    if (!this.warmKey || key.some((v, i) => v !== this.warmKey[i])) {
      this.warmKey = key;
      const list = [];
      for (const n of people) if (n.look) list.push([n.look, false]);
      if (world.nilo?.look) list.push([world.nilo.look, false]);
      for (const k of kids?.values?.() || []) if (k.look && !k.baby) list.push([k.look, !!k.kid]);
      this.warm = list;
    }
    if (!this.warm.length) return;
    // (una que haya que hacer de verdad: las que ya están hechas no cuestan nada)
    const one = () => { for (let it; (it = this.warm.shift());) { this.built.add(it[0]); try { if (prebuildReal(it[0], it[1])) return; } catch (err) { /* (la hará al verla) */ } } };
    // (a oscuras, solo en un rato libre: mientras se espera a algo que no es este hilo; ver engine.js, coverSpare. Si no, cada
    // persona alargaba lo que se está a oscuras al entrar 0,3-0,4 s)
    if (covered()) { if (this.view.coverSpare?.() ?? true) one(); return; }
    if (this.warmIdle || typeof requestIdleCallback !== 'function') return;
    this.warmIdle = true;
    requestIdleCallback(dl => { this.warmIdle = false; if (dl.timeRemaining() > 40) one(); });
  }

  // A look to make in idle time, first in line (the player's grown hair: body.js growthTick; a swap that waits: later)
  warmUp(look) {
    for (const w of this.warm) if (w[0] === look) return;
    this.warm.unshift([look, false]);
    if (this.warm.length > 40) this.warm.length = 40;
  }
  // The player's next change shows at once (a hidden moment, a haircut, /body): for a couple of frames, later() does not wait
  rush() { this.rushing = 3; }
  // Can the change from this model's look to `look` wait? Only when the hair or beard growth or the wear of the clothes is
  // all that changed (calmKey): the model there is stays while the new one is made in idle time (prewarm), so the change
  // costs no hitch, neither yours nor another player's. At once when it is made already, when the screen is dark and,
  // for a game that never rests, after a while (out of sight or standing still; or anyway, later)
  later(m, e, look) {
    if (m.kind !== 'person' || !look || !m.look || calmKey(m.look) !== calmKey(look)) return false;
    if (this.rushing > 0 && m === this.player) return false;
    if (m.nextLook !== look) {
      m.nextLook = look; m.nextAt = this.time;
      if (realReady(look) || covered()) return false;
      this.warmUp(look);
      return true;
    }
    if (this.built.has(look) || covered()) return false;
    const t = this.time - m.nextAt;
    if (t > LATER_MAX || (t > LATER_STILL && (m.tier === 3 || (m.speed || 0) < 0.1))) return false;
    this.warmUp(look);   // (the list is made again when the village changes)
    return true;
  }

  add(e, isPlayer, look) {
    const m = this.make(e, isPlayer, look);
    // (a la escena cuando sus programas de sombreado están: un animal o un monstruo que no se había visto aún no para el
    // juego al aparecer; ver engine.js, gate. Mientras, se mueve igual, sin pintarse. El jugador y los demás jugadores, no:
    // al cambiarse de ropa desaparecerían, y lo que se lee de sus huesos, la mano o la herramienta, se quedaría atrás.
    // Lo que aparece cerca, tampoco: ver gateNear)
    if (m) {
      m.look = look; this.models.set(e, m);
      const v = this.view, x = this.me ? nearX(e.x, this.me.x) : e.x;
      if (v.gate && !isPlayer && !e.remote) v.gate(m.root, () => { if (this.models.get(e) === m) this.group.add(m.root); }, [x - 1, e.y - 1, x + 1, e.y + 1]);
      else this.group.add(m.root);
    }
    return m;
  }
  place(m, e, scene, dt, t, p, game) {
    if (m.kind === 'none') return;   // (sin modelo: ver make)
    this.pose(m, e, scene, dt, t, e === p ? game : null);
    if (m === this.player || e.remote) this.ghost(m, e === p ? game.gamemode === 'spectator' : e.gm === 3);   // (de espectador, medio transparente)
  }

  // Mirar a quien se tiene al lado: quieto, sentado o tumbado, la cabeza (y un poco los hombros) se gira hacia la
  // persona más cercana, hasta unos 66° a cada lado; tumbado, hacia el lado donde está. Andando, al frente
  lookAt(m, e, dt, lying) {
    const P = m.person;
    let want = 0;
    if (m.speed < 0.6 && !e.mount && !e.boat && !e.aboard && !e.pushing) {   // (pushing, the hands stay on the grips)
      let best = e.lookTarget || null, bd = best ? Math.max(0.05, Math.hypot(best.x - e.x, best.y - e.y)) : LOOK_R;   // (in a talk, whoever they talk with: talk.js)
      if (!best) for (const o of this.around || []) {
        if (o === e || !(o === this.me || o.look)) continue;
        const d = Math.hypot(o.x - e.x, o.y - e.y);
        if (d > 0.05 && d < bd) { bd = d; best = o; }
      }
      if (best) {
        const dx = best.x - e.x, dy = best.y - e.y;
        if (lying) { const yaw = m.root.rotation.y, s = (dx * Math.cos(yaw) - dy * Math.sin(yaw)) / bd; if (Math.abs(s) > 0.3) want = Math.sign(s) * 1.0; }
        else {
          const body = P.root.rotation.y + m.root.rotation.y, a = Math.atan2(dx, dy) - body, rel = Math.atan2(Math.sin(a), Math.cos(a));
          if (Math.abs(rel) < 2.1) want = Math.max(-1.15, Math.min(1.15, rel));
        }
      }
    }
    P.lookYaw = (P.lookYaw || 0) + (want - (P.lookYaw || 0)) * Math.min(1, dt * 4);
    P.head.rotation.y = P.lookYaw * 0.8;
    P.torso.rotation.y += P.lookYaw * 0.2;
  }

  make(e, isPlayer, look = e.look) {
    if (!e.baby && !look) return this.makeThing(e);
    // (si la persona no se puede hacer, la entidad se queda sin modelo y el juego sigue: se avisa una vez)
    try { return this.makePerson(e, isPlayer, look); }
    catch (err) {
      if (!this.warned) { this.warned = true; console.warn('Miniverse: no se pudo hacer una persona', err); }
      return { kind: 'none', root: new THREE.Group(), prev: null, speed: 0 };
    }
  }
  makePerson(e, isPlayer, look) {
    if (e.baby) { const root = new THREE.Group(), b = realBaby(look); root.add(b); return { kind: 'baby', root, prev: null, speed: 0, release: b.userData.release }; }
    {
      const person = new RealPerson(look, { kid: !!e.kid }), root = new THREE.Group();
      root.add(person.root);
      const m = { kind: 'person', root, person, prev: null, speed: 0 };
      if (look?.armband) armband(person);   // (the constable's: law3d.js)
      if (typeof e.gear === 'function') e.gear(person, m);   // (what a traveller of the roads carries: three/travellers3d.js)
      if (e.kid) root.rotation.order = 'YXZ';   // (la persona ya es de niño: ver realperson.js)
      if (isPlayer || e.remote) {
        // Con algo en la mano, caballo y barca (el jugador, además, con sus propios materiales para dibujar
        // su silueta, y en la capa 2; los demás jugadores, con su nombre encima)
        m.hand = new THREE.Group();
        m.hand.position.set(0, -0.07, 0.03); person.hand.add(m.hand);   // (en el hueso de la mano derecha)
        // (las herramientas se hicieron para la mano izquierda: en la derecha, reflejadas, para que apunten hacia fuera)
        m.hand.scale.x = -1;
        m.horse = horseModel(); m.horse.visible = false; root.add(m.horse);
        person.root.rotation.order = 'YXZ';   // (the rider tilts with a rearing horse about their own side axis: rideHorse)
        m.boat = boatModel(); m.boat.visible = false; root.add(m.boat);
        if (e.remote) root.add(m.tag = nameTag(e.name));   // (m.tag: fx.js keeps the speech bubbles clear of it)
      }
      if (isPlayer) {
        m.mats = []; m.body = [];
        person.root.traverse(o => { if (o.isMesh) ownMesh(o, m, true); });
        for (const o of [m.horse, m.boat]) o.traverse(q => { if (q.isMesh) ownMesh(q, m); });
        this.player = m;
      }
      return m;
    }
  }
  makeThing(e) {
    if (ANIMALS[e.type]) {
      const fill = this.bagFill(null, e);
      return { kind: 'animal', root: animalModel(e.type, e.breed, e.bags, fill, e.type === 'caballo' && !!e.shod, e.type === 'caballo' ? raceKey(e) : ''), key: animalKey(e, fill), aShod: e.type === 'caballo' && !!e.shod, aRace: e.type === 'caballo' ? raceKey(e) : '', aType: e.type, aBreed: e.breed || '', aBags: e.bags ? 1 + fill : 0, prev: null, speed: 0, phase: Math.random() * 6 };
    }
    if (MONSTERS[e.type]) return { kind: 'monster', root: monsterModel(e.type), prev: null, speed: 0, phase: Math.random() * 6 };
    return null;
  }

  pose(m, e, scene, dt, t, game) {
    const view = this.view, x = this.me && scene.kind === 'world' ? nearX(e.x, this.me.x) : e.x, z = e.y;   // (lo del otro lado de la costura del planeta, a este lado)
    // Velocidad (para animar) a partir de lo que se ha movido
    const d = m.prev ? Math.hypot(x - m.prev[0], z - m.prev[1]) : 0;
    m.prev = [x, z];
    const v = dt > 0 ? Math.min(e.mount ? 12 : 8, d / dt) : 0;   // (a cap against jumps; on a horse higher: its gallop, 9.5, is not drawn at its trot)
    m.speed += (v - m.speed) * Math.min(1, dt * 10);
    const yaw = e.yaw ?? facing(e);
    let y = view.groundY(scene, x, z);
    if (m.kind === 'baby') {
      m.root.position.set(x, y + (e.h || 0), z); m.root.rotation.y = e.yaw || 0;
      SPH.center.set(x, y + 0.3, z); SPH.radius = 0.6;
      m.root.visible = ALL || FR.intersectsSphere(SPH);
      return;
    }
    let pz = e.pose;
    // (another player in a tub: their state says 'sit' with ba, so an older game sees them sitting; here, the bath pose.
    // The pose object is new with each message: the bath one is made again only then)
    if (pz?.kind === 'sit' && e.remote && e.bathing) pz = m.bathPz?.src === pz ? m.bathPz : (m.bathPz = { kind: 'bath', yaw: pz.yaw, h: pz.h, src: pz });
    // (sentado en una silla que aquí no está: otro jugador que la ve donde aquí no hay ninguna; mejor en el suelo que en el
    // aire. El asiento se busca por lo que ocupa, no por su casilla: en el sofá, la otra plaza está a una casilla de la suya,
    // y con la distancia al centro el otro jugador salía sentado en el suelo, hundido en el sofá. Se mira donde dicen sus
    // mensajes que está, no por donde va llegando, y cada medio segundo por si quitan el asiento)
    if (pz?.kind === 'sit' && e.remote && scene.placedNear) {
      const sx = e.to ? (this.me && scene.kind === 'world' ? nearX(e.to[0], this.me.x) : e.to[0]) : x, sz = e.to ? e.to[1] : z;
      if (!m.seatAt || m.seatAt.t < t - 0.5 || m.seatAt.x !== sx || m.seatAt.z !== sz) m.seatAt = { t, x: sx, z: sz, ok: scene.placedNear(sx, sz, 1.5).some(o => SEATS.has(o.placed) && (scene.placedDist ? scene.placedDist(o, sx, sz) : Math.hypot(o.x - sx, o.y - sz)) < 0.7) };
      if (!m.seatAt.ok) pz = { kind: 'floorSit', yaw: pz.yaw, h: -0.28 };
    }
    const lying = pz ? pz.kind === 'lie' || pz.kind === 'floorLie' : e.lying;
    if (pz) m.speed = 0;   // (sentado o tumbado, quieto)
    if (e.kid || m.kind === 'person') {   // (tumbados, boca arriba, con la cabeza hacia la almohada; sentados, más abajo)
      m.root.rotation.order = 'YXZ';
      m.root.rotation.x = lying ? -Math.PI / 2 : 0;
      m.root.rotation.y = lying ? (pz ? pz.yaw : e.yaw || 0) : 0;
      y += pz ? pz.h : lying ? e.h || 0 : 0;
      if (pz && !lying && m.person) y += (pz.kind === 'bath' ? BATH_HIP : SEAT_HIP) * (m.person.kid ? KID_REF : 1) - m.person.hipY;   // (con la cadera en el asiento; in the tub, on its floor)
    }
    if (m.kind === 'person') {
      const P = m.person;
      // (what the world has left on the body, drawn by the shader: three/grime.js. Kept on the model for the bones and fx.js.
      // The player's changes all the time: written every frame. Anyone else's only when their packed bd (or their fixed
      // surface) or the material changes: §6, no uniform writes per frame for unchanged values)
      m.surf = this.surfaceOf(m, e);
      if (P.setGrime) {
        const gk = e.bd !== undefined ? e.bd : e.grime, mat = P.r?.mesh?.material;
        if (m === this.player || gk !== m.grimeKey || mat !== m.grimeMat || P !== m.grimeP) {
          P.setGrime(m.surf);
          m.grimeKey = gk; m.grimeMat = P.r?.mesh?.material; m.grimeP = P;
        }
      }
      if ((e.kid && e.lying) || (pz && lying)) { P.facing = 0; P.root.rotation.y = 0; }
      // (tumbada, se corre hacia los pies lo que mide de más que la cama pensada: la cabeza, en la almohada)
      P.r.root.position.y = lying ? -(P.height - LIE_LEN * (P.kid ? KID_REF : 1)) : 0;
      if ((e.kid && e.lying) || (pz && lying)) {}
      else if (pz) { P.facing = pz.yaw; P.root.rotation.y = pz.yaw; }
      else if (yaw !== null) P.facing = yaw;
      if (m.horse) {   // (el caballo del jinete, con el pelaje del suyo; and its saddlebags, as full as they look: horseFill 0..2)
        const coat = e.horseCoat || 'castano', f = e.horseFill, bagK = e.horseBags ? 1 + (f === 0 || f === 1 || f === 2 ? f : 1) : 0;
        // (its shoes and its breed travel with the Animal; not found, as it was)
        const under = e.mount ? this.riddenBy(m, e) : null, shod = e.mount ? !!under?.shod : m.horseShod, race = under ? raceKey(under) : m.horseRace || '';
        if (m.horseCoat !== coat || m.horseBagK !== bagK || !!m.horseShod !== !!shod || (m.horseRace || '') !== race) this.newHorse(m, coat, bagK, shod, race);
      }
      if (m.boat) {
        // Barca y caballo
        m.boat.visible = !!e.boat; m.horse.visible = !!e.mount;
        const seat = SEAT_HIP * (P.kid ? KID_REF : 1) - P.hipY;   // (con la cadera en el asiento)
        if (e.aboard) { y = WATER_Y - 0.12 + Math.sin(t * 2.5) * 0.04; P.root.position.y = 0.3 + seat; }   // (de pasajero: la barca es la del que rema)
        else if (e.boat) {
          y = WATER_Y - 0.12 + Math.sin(t * 2.5) * 0.04; m.boat.rotation.y = P.root.rotation.y; m.boat.rotation.z = Math.sin(t * 1.7) * 0.03; P.root.position.y = 0.3 + seat;
          const row = Math.min(1, m.speed / 1.5);
          for (const o of m.boat.userData.oars) { const a = t * 5, sd = o.userData.side; o.rotation.y = sd * Math.sin(a) * 0.5 * row; o.rotation.z = sd * (Math.PI / 2 - OAR_DIP + Math.cos(a) * 0.15 * row); }   // (los dos a la vez; al volver, la pala sale del agua)
        }
        else if (e.mount) this.rideHorse(m, e, P, seat, x, z, scene, dt, t);
        else P.root.position.y = 0;
        if (!e.mount && (m.reared || m.bankYaw !== undefined)) { this.unrear(m, P); P.root.rotation.z = 0; m.bankYaw = undefined; m.bankK = 0; m.banked = false; }
      }
      // Los huesos se posan en cada fotograma de cerca, y de lejos cada 1/30 o 1/15 s con el tiempo que haya pasado (ver
      // grade; desfasadas, para que no les toque a todas en el mismo fotograma). Girar, siempre: crew.js lee hacia dónde
      // mira. Todo lo que escribe en los huesos va dentro de este bloque: lo que suma (+= y -=) parte de la pose de
      // animate(), y fuera se acumularía en los fotogramas sin pose (el tronco giraría sin parar o el cuerpo se hundiría)
      P.turn(dt);
      if (e.z) y += e.z;   // (saltando o encima de una roca; por debajo de 0, subiendo un escalón de lo cavado: ver entities.js)
      // En el agua, a pie (ver entities.js): vadeando, con los pies en el fondo (groundY no baja de 30 cm bajo el agua, que
      // es lo que vale para lo demás); nadando, flota (swimY). De andar a nadar y al revés se pasa poco a poco (swimK)
      if (!pz && !e.mount && !e.boat && !e.aboard) {
        const bed = e.depth > 0 ? WATER_Y - e.depth : null;
        if (bed !== null) y = bed + (e.z || 0);
        m.swimK = (m.swimK || 0) + ((e.swim ? 1 : 0) - (m.swimK || 0)) * Math.min(1, dt * 5);
        if (m.swimK < 0.003 && !e.swim) m.swimK = 0;
        // (saliendo, no se tira hacia abajo: andando o saltando a la orilla, la altura de verdad manda si es más alta)
        if (m.swimK) { const sy = this.swimY(m, e, P, dt, bed); y += ((e.swim ? sy : Math.max(sy, y)) - y) * m.swimK; }
        // (vadeando, las piernas abren ondas al andar)
        else if (e.depth > 0.08 && m.speed > 0.4 && !(e.z > 0.05) && (m.wadeT = (m.wadeT || 0) + dt) > 0.42) { m.wadeT = 0; view.fx.rippleAt(x, z, 0.75, 0.32); }
      } else {
        m.swimK = 0;
        // (a caballo, en el agua: el caballo pisa el fondo; en lo más hondo de un río, con el agua al cuello)
        if (e.mount && !pz && e.depth > 0) y = WATER_Y - e.depth + (e.z || 0);
      }
      const bath = pz?.kind === 'bath';
      if (m.hand) m.hand.visible = m.swimK < 0.5 && !lying && (pz?.kind !== 'floorSit' || ITEMS[m.holding]?.tool === 'cana') && !bath && !m.fishHeld;   // (nadando, lo de la mano se guarda; lying in bed or on the floor, too: no axe by the pillow; sitting on the floor, no shovel through the legs; nor in the tub)
      if (bath || m.foam) this.foam(m, P, bath ? pz : null);
      // (cómo se ve, con la altura ya puesta: alguien en lo alto de una torre, mirado allí arriba, tiene los pies a 12 m del suelo)
      const tier = this.grade(m, e, x, y + P.root.position.y, z, lying);
      m.root.visible = tier !== 3;
      m.acc = (m.acc ?? Math.random() / 15) + dt;
      const bones = m.acc >= BONE_DT[tier], bdt = bones ? Math.min(0.5, m.acc) : 0;
      if (bones) m.acc = 0;
      if (bones) this.poseBones(m, e, P, pz, lying, bdt, game);
      if (m.hand) {   // (los jugadores: la barriga, si espera un bebé, y la mochila, si la lleva; no son huesos)
        const made = P.setBelly(this.game.family.bellyOf(e));
        if (made && m === this.player) ownMesh(made, m, true);
        const old = P.bag, bag = P.setBag((m.nextLook || m.look)?.wear?.espalda || null);
        // (la que se quita se lleva sus materiales propios: los del jugador, para su silueta, y los de un espectador)
        if (old && old !== P.bag) old.traverse(o => {
          if (!o.isMesh) return;
          if (o.userData.solid) o.material.dispose();
          else if (m.mats?.includes(o.material)) { o.material.dispose(); for (const list of [m.mats, m.body]) { const i = list.indexOf(o.material); if (i >= 0) list.splice(i, 1); } }
        });
        if (bag && m === this.player) bag.traverse(o => { if (o.isMesh) ownMesh(o, m, true); });
        if (bag && m.ghosted) { m.ghosted = false; this.ghost(m, true); }   // (de espectador, también medio transparente)
        // (in the tub, the backpack and the tools on the body are left aside: hidden while the bath lasts)
        if (P.bag) P.bag.visible = !bath;
        if (bath !== !!m.kitBath) { m.kitBath = bath; m.kitNear = undefined; }
        this.kit(m, e, P, pz, lying);
        this.carried(m, e, P, scene);
      }
    } else if (m.kind === 'animal') {
      if (yaw !== null) turnTo(m.root, yaw, dt);
      m.root.scale.setScalar(scaleOf(e));
      // (one of a herd, far off: only its trunk's shadow; a herd is many meshes)
      if (e.traits && this.me) {
        const far = Math.hypot(x - this.me.x, z - this.me.y) > HERD_SHADOW + (m.farShade ? -2 : 2);
        if (far !== !!m.farShade) { m.farShade = far; const u = m.root.userData; m.root.traverse(o => { if (o.isMesh) o.castShadow = !far || o.parent === u.body; }); }
      }
      if (ANIMALS[e.type].swims) y = WATER_Y - 0.06 + Math.sin(t * 1.5 + x) * 0.015;
      // (el caballo vadea más hondo que lo que da groundY: pisa el fondo, como montado)
      else if (e.drove && scene.waterDepth) { const dd = scene.waterDepth(e.x, e.y); if (dd > 0.2) y = WATER_Y - Math.min(dd, COW_SWIM); }   // (a job's cow crossing a river: its back out of the water)
      else if (e.type === 'caballo' && scene.waterDepth) { const dd = scene.waterDepth(e.x, e.y); if (dd > 0.3) y = WATER_Y - dd; }
      if (m.root.userData.horse) {
        // (a horse: its mud, the shake after a brushing (a.act, local) and, if it is yours or your partner's and comes at a
        // trot or a gallop, its hooves)
        const vol = this.hearing(m, x, z);
        // (the mud comes off over the strokes of the brush, not at once)
        const dirt = e.dirt || 0;
        m.dirtK = m.dirtK > dirt ? Math.max(dirt, m.dirtK - dt * 0.55) : dirt;
        setHorseDirt(m.root, m.dirtK);
        this.careLook(m, m.root, e, dirt);
        animateAnimal(m, dt, t, e, this.horseState(m, e, e.act, false, dt, vol));
        if (m.root.userData.hits && m.speed > 1.5 && this.game?.horse?.ours?.(e)) this.hooves(m, e, m.speed > 4.5 ? 2 : 1, scene, vol);
      } else animateAnimal(m, dt, t, e);
      m.root.visible = !(e.hurt > 0 && Math.floor(e.hurt * 20) % 2);   // (herido: parpadea)
    } else if (m.kind === 'monster') {
      if (yaw !== null && (e.dir?.[0] || e.dir?.[1])) turnTo(m.root, yaw, dt);
      animateMonster(m, e, dt, t);
      if (MONSTERS[e.type].fly) y += 1.1 + Math.sin(t * 6 + x) * 0.15;
      // Herido: parpadea
      m.root.visible = !(e.hurt > 0 && Math.floor(e.hurt * 20) % 2);
    }
    m.root.position.set(x, y, z);
  }

  // The tools they carry and do not hold, on their body (kit.js says which and where; kit3d.js draws them): the player's
  // from their inventory, another player's from what their messages say (kt). Rebuilt only when what shows changes
  // (picking up, dropping or moving a tool, the backpack, sitting, lying, riding or crouching, swimming, or the hand going
  // from one kind of tool to another: its gap moves); the two meshes stay the same, so their own materials (the player's, for the
  // outline; a spectator's) are made once. Far away (15 Hz or the far detail) they are hidden, and at 30 Hz with no shadow
  kit(m, e, P, pz, lying) {
    const ids = m === this.player ? this.game.kitIds() : splitKit(e.kitKey), bag = !!P.bag;
    if (ids !== m.kitIds || bag !== m.kitBag) { m.kitIds = ids; m.kitBag = bag; m.kitPlaced = placeKit(ids, { bag }); }
    // (arms busy with something big: carry.js, the weight inventory; see kit.js shownOf)
    const hk = kindOf(m.holding), swim = m.swimK > 0.5, ride = !!(e.mount || e.boat || e.aboard), arms = e.armsBusy || null, S = (m.kitSig ||= {});
    const pc = poseClass(pz?.kind === 'bath' ? 'sit' : pz?.kind || (lying ? 'lie' : ''), { ride, crouch: !!e.crouch && !pz && !swim });   // (in the tub, as sitting)
    if (S.p !== m.kitPlaced || S.h !== hk || S.s !== swim || S.c !== pc || S.a !== arms) {
      Object.assign(S, { p: m.kitPlaced, h: hk, s: swim, c: pc, a: arms });
      // (the backpack and the pose go in the key too: the same places, but somewhere else on the body)
      const shown = shownOf(m.kitPlaced, m.holding, { swimming: swim, pose: pc, arms }), key = (bag ? 'B|' : '|') + pc + '|' + shown.map(o => o.spot + ':' + o.id).join();
      if (key !== m.kitShown) {
        m.kitShown = key;
        const made = P.setKit(shown.length ? buildKit(shown, P.bagFit(), P.beltFit(), stowedGeo, { bag, pose: pc }) : {});
        for (const o of made) if (m === this.player) ownMesh(o, m, true);
        if (made.length && m.ghosted) { m.ghosted = false; this.ghost(m, true); }   // (de espectador, también medio transparente)
        m.kitNear = undefined;
      }
    }
    if (!P.kit) return;
    const near = !(m.tier >= 2 || P.lod === 1), shadow = m.tier === 0;
    if (near !== m.kitNear || shadow !== m.kitShadow) {
      m.kitNear = near; m.kitShadow = shadow;
      for (const [k, o] of Object.entries(P.kit)) { o.visible = near && o.userData.has && !m.kitBath; if (k === 'back') o.castShadow = shadow; }
    }
  }

  // What the arms carry (the weight inventory: carry.js; e.carrying, the player's or what another player's messages say),
  // hung from the chest bone; or, riding or rowing, that big thing on the horse (in its body) or in the bow of the boat;
  // or the wheelbarrow being pushed (e.pushing, its model key), from the root of the person, which faces as it does.
  // Made again only when it changes (or the horse is made again, with another coat); the geometry is shared
  // (carry3d.js), the player's copy takes its own materials (for the outline), and they go with it. In first person the
  // wheelbarrow is hidden with the body (engine.js draws its own); on the horse and in the boat it shows, as they do
  carried(m, e, P, scene) {
    const id = e.carrying && BULKY[e.carrying] ? e.carrying : null;
    const where = e.pushing ? 'push' : id ? (e.mount ? 'horse' : e.boat ? 'bow' : 'arms') : null;
    const host = where === 'horse' ? m.horse : where === 'bow' ? m.boat : P;
    const key = where && where + '|' + (where === 'push' ? barrowName(e.pushing) : id);
    if (key === m.carriedKey && host === m.carriedHost && m.carriedId !== undefined) { if (where === 'push') this.pushTilt(m, e, scene); return; }
    const old = m.carriedObj;
    if (old) {
      old.parent?.remove(old);
      old.traverse(o => {
        if (!o.isMesh) return;
        if (m.mats?.includes(o.material)) { o.material.dispose(); for (const list of [m.mats, m.body]) { const i = list.indexOf(o.material); if (i >= 0) list.splice(i, 1); } }
        else if (o.userData.solid) o.material.dispose();   // (a spectator's see-through copy)
      });
    }
    m.carriedId = id; m.carriedKey = key; m.carriedHost = host; m.carriedWhere = where; m.carriedObj = null; m.pushAt = null;
    if (!where || (where === 'arms' && !P.bagFit)) return;
    let o;
    if (where === 'push') { o = pushedModel(e.pushing); P.root.add(o); }
    else if (where === 'arms') { o = carriedModel(id); placeCarried(o, id, P.bagFit()); P.torso.add(o); }
    else {
      o = loadModel(id, where); placeLoad(o, id, where);
      if (where === 'horse') { const U = m.horse.userData; o.position.y += U.dy || 0; o.scale.divideScalar(U.size || 1); }   // (on its breed's back, and its own size)
      (where === 'horse' ? m.horse.userData.body || m.horse : m.boat).add(o);
    }
    if (m === this.player) o.traverse(q => { if (q.isMesh) ownMesh(q, m, where === 'arms' || where === 'push'); });
    m.carriedObj = o;
    if (where === 'push') this.pushTilt(m, e, scene);
    if (m.ghosted) { m.ghosted = false; this.ghost(m, true); }   // (de espectador, también medio transparente)
  }
  // The pushed wheelbarrow follows the ground: its wheel as high as the ground under it (from where the feet are). Again
  // only when it has moved 10 cm or turned, or after a quarter of a second
  pushTilt(m, e, scene) {
    const o = m.carriedObj, yaw = e.yaw ?? facing(e), A = m.pushAt, now = this.time;
    if (!o || !scene || (A && Math.abs(A[0] - e.x) + Math.abs(A[1] - e.y) < 0.1 && Math.abs(A[2] - yaw) < 0.05 && now - A[3] < 0.25)) return;
    m.pushAt = [e.x, e.y, yaw, now];
    const ahead = pushedReach(), grip = barrowSize().GRIP_AHEAD, v = this.view;
    const dh = v.groundY(scene, e.x + Math.sin(yaw) * ahead, e.y + Math.cos(yaw) * ahead) - v.groundY(scene, e.x, e.y);
    placePushed(o, Math.max(-0.3, Math.min(0.3, Math.atan2(dh, ahead - grip))));
  }

  // ---------- the horse (Plan F phase 1: docs/planes/gta/PLAN-F-caballo.md §5) ----------
  // Does an animal's model still fit it (type, breed, and a horse's saddlebags with how full they look)? Compared field by
  // field: no key string made for every animal in every frame
  sameAnimal(m, e) {
    return m.aType === e.type && m.aBreed === (e.breed || '') && m.aBags === (e.bags ? 1 + this.bagFill(m, e) : 0) && (e.type !== 'caballo' || (m.aShod === !!e.shod && m.aRace === raceKey(e)));
  }
  // The Animal a player rides, looked for at most twice a second (its shoes and how it is looked after: those travel with it)
  riddenBy(m, e) {
    const g = this.game;
    if (m === this.player && g?.horse?.ridden) return g.horse.ridden;
    if (this.time - (m.rideT ?? -1) < 0.5) return m.rideA || null;
    m.rideT = this.time; m.rideA = null;
    for (const a of g?.ranch?.animals || []) if (a.rider && a.rider === e.id) { m.rideA = a; break; }
    return m.rideA;
  }
  // Thin or shiny (horsecare.js looks): asked twice a second, eased in the uniforms
  careLook(m, root, a, dirt) {
    const C = this.game?.horsecare, L = (m.look2 ||= { thin: 0, shine: 0, t: -1 });
    if (!C) return;
    if (this.time - L.t > 0.5) { L.t = this.time; C.looks(a, dirt, L); }
    setHorseCare(root, L.thin, L.shine);
  }
  // How full a horse's saddlebags look, 0..2 (saddlebags.js: by what they weigh), asked at most twice a second per horse.
  // Until that module is read, or with no saddlebags system, half full: the look closest to the bags of before
  bagFill(m, e) {
    if (e.type !== 'caballo' || !e.bags) return 0;
    if (m && this.time - (m.fillT ?? -1) < 0.5) return m.fill;
    const sb = this.game?.saddlebags, f = fillOfKg && typeof sb?.kg === 'function' ? fillOfKg(sb.kg(e) || 0) : 1;
    if (m) { m.fillT = this.time; m.fill = f; }
    return f;
  }
  // The rider's horse made again (another coat or breed, or bags that look fuller or emptier: bagK 0 none, else 1 + fill). The old
  // one takes its own materials with it: the player's copies (for the outline), a spectator's see-through ones and its mud
  // material; the big thing on its back is moved by carried(), which sees another host
  newHorse(m, coat, bagK, shod = false, race = '') {
    const old = m.horse, h = horseModel(coat, bagK > 0, false, Math.max(0, bagK - 1), !!shod, race);
    h.scale.setScalar(h.userData.size);
    if (m === this.player) h.traverse(q => { if (q.isMesh) ownMesh(q, m); });
    h.visible = old.visible;
    m.root.remove(old); m.root.add(h);
    m.horse = h; m.horseCoat = coat; m.horseBagK = bagK; m.horseShod = !!shod; m.horseRace = race;
    old.traverse(o => {
      if (!o.isMesh || o.userData.shared) return;
      if (o.userData.solid) o.material.dispose();
      else if (m.mats?.includes(o.material)) { o.material.dispose(); for (const list of [m.mats, m.body]) { const i = list.indexOf(o.material); if (i >= 0) list.splice(i, 1); } }
    });
    disposeAnimal(old);
    if (m.ghosted) { m.ghosted = false; this.ghost(m, true); }   // (de espectador, también medio transparente)
  }
  // The ridden horse under a player (pose, every frame): its mud, its gait with the trick or start it plays and how winded
  // it is (from horse.js for yours, from their messages for another player's: e.horseDirt, horseAct, horseWinded), the
  // rider on its seat (rising a little at the gallop, carried up and back while it rears) and its sounds
  rideHorse(m, e, P, seat, x, z, scene, dt, t) {
    const H = m.horse.userData, vol = this.hearing(m, x, z);
    const yaw = (m.horse.rotation.y = P.root.rotation.y);
    this.bank(m, yaw, dt);
    setHorseDirt(m.horse, e.horseDirt || 0);
    this.careLook(m, m.horse, this.riddenBy(m, e), e.horseDirt || 0);
    animateHorse(m.horse, m.speed, t, null, dt, e.gait, this.horseState(m, e, e.horseAct, !!e.horseWinded, dt, vol));
    m.gallopK = (m.gallopK || 0) + ((m.speed > 3 ? (e.gait === 2 ? 1 : e.gait === 3 ? 0.35 : 0) : 0) - (m.gallopK || 0)) * Math.min(1, dt * 4);
    if (m.gallopK < 1e-3) m.gallopK = 0;
    // (where the seat is: 0.92 on an Español)
    const size = H.size || 1, sits = (SEAT[0] + (H.dy || 0)) * size - SIT_IN + seat;
    let y = sits + (H.bob || 0) * size + RIDE.bounce * m.gallopK * (0.5 + 0.5 * Math.sin((H.phase || 0) + RIDE.bouncePh));
    const rk = Math.max(H.rear || 0, H.slide || 0, H.stumble || 0);
    if (rk > 0.001) {
      // (the hips go where the seat goes; the body turns back about them by part of the horse's pitch: the root turns
      // about its feet, so it is moved back by what that turn moves the hips)
      const phi = (H.seatPitch || 0) * RIDE.rearTilt, hip = P.hipY, dz = (H.seatDz || 0) * size - hip * Math.sin(phi);
      P.root.rotation.x = phi;
      y = sits + (H.seatDy || 0) * size - hip * (Math.cos(phi) - 1);
      P.root.position.x = Math.sin(yaw) * dz; P.root.position.z = Math.cos(yaw) * dz;
      m.reared = true;
    } else if (m.reared) this.unrear(m, P);
    // (leaning into the turn: the horse about its feet, the rider with it about the same point on the ground)
    const bk = m.bankK || 0;
    m.horse.rotation.z = bk;
    if (bk || m.banked) {
      const s = -Math.sin(bk) * y;   // (to the horse's left)
      if (!m.reared) P.root.position.x = P.root.position.z = 0;
      P.root.rotation.z = bk;
      P.root.position.x += Math.cos(yaw) * s; P.root.position.z -= Math.sin(yaw) * s;
      m.banked = !!bk;
    }
    P.root.position.y = y;
    if (H.hits) this.hooves(m, e, e.gait, scene, vol);
  }
  unrear(m, P) { m.reared = false; P.root.rotation.x = 0; P.root.position.x = P.root.position.z = 0; }
  // How much a ridden horse leans now (rad, + to its right), eased: by its turning rate and its speed
  bank(m, yaw, dt) {
    if (m.bankYaw === undefined || !(dt > 0)) { m.bankYaw = yaw; return; }
    let d = yaw - m.bankYaw;
    m.bankYaw = yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const want = Math.max(-RIDE.bankMax, Math.min(RIDE.bankMax, -(d / dt) * m.speed * RIDE.bank));
    m.bankK = (m.bankK || 0) + (want - (m.bankK || 0)) * Math.min(1, dt * 5);
    if (Math.abs(m.bankK) < 1e-3) m.bankK = 0;
  }
  // On a horse (poseBones, after the gestures): leaning into the gallop with the head up to look ahead; and while it rears,
  // forward against its neck with both hands on it, whatever the gesture was
  riderBones(m, P) {
    const g = m.gallopK || 0, U = m.horse?.userData, rk = Math.max(U?.rear || 0, U?.stumble || 0), sl = U?.slide || 0;
    if (g > 0.01) { P.torso.rotation.x += RIDE.lean * g; P.head.rotation.x -= RIDE.lean * 0.7 * g; }
    if (sl > 0.01) { P.torso.rotation.x -= RIDE.back * sl; P.head.rotation.x += RIDE.back * 0.6 * sl; }
    if (rk < 0.01) return;
    const lean = U.stumble > 0.01 ? RIDE.fall : RIDE.rearLean;
    P.torso.rotation.x += lean * rk; P.head.rotation.x -= lean * 0.6 * rk;
    // (the body turns back by only part of the horse's pitch: the legs make up the rest, astride as at rest, not inside it)
    const legK = (m.horse.userData.seatPitch || 0) * (1 - RIDE.rearTilt);
    P.legs[0].rotation.x += legK; P.legs[1].rotation.x += legK;
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1, A = P.arms[i], F = P.fore?.[i];
      A.rotation.x += (RIDE.gripArm - A.rotation.x) * rk;
      A.rotation.z += (s * RIDE.gripIn - A.rotation.z) * rk;
      if (F) F.rotation.x += (RIDE.gripFore - F.rotation.x) * rk;
    }
  }
  // Riding, before the gestures: the hands on the reins, the free one; the other too with nothing in it
  reinArms(m, P) {
    if (!m.horse?.userData.bits || m.fishOn) return;
    for (let i = 0; i < 2; i++) {
      if (i === P.toolArm && (m.holding || m.anim)) continue;
      const s = i === 0 ? -1 : 1, A = P.arms[i], F = P.fore?.[i];
      A.rotation.x = REIN_ARM.x; A.rotation.z = -s * REIN_ARM.in;
      if (F) F.rotation.x = REIN_ARM.fore;
    }
  }
  // Leading a horse (horselead.js): the free arm a little back and bent, with the rope in its hand, whatever the walk does with it
  leadBones(m, e, P, dt, pz) {
    const on = e.leads && !pz && !e.mount && !(m.swimK > 0.3) && !(e.bowPull > 0) && !m.fishOn;
    m.leadK = (m.leadK || 0) + ((on ? 1 : 0) - (m.leadK || 0)) * Math.min(1, dt * 6);
    if (m.leadK < 0.01) { m.leadK = 0; return; }
    const i = 1 - P.toolArm, s = i === 0 ? -1 : 1, A = P.arms[i], F = P.fore?.[i], k = m.leadK;
    A.rotation.x += (LEAD_ARM.x - A.rotation.x * 0.75) * k;
    A.rotation.z += (s * LEAD_ARM.out - A.rotation.z) * k;
    if (F) F.rotation.x += (LEAD_ARM.fore - F.rotation.x) * k;
  }
  // What a horse plays, for animateHorse ({ act, at, winded }, kept on its model m). act: { kind, t } from horse.js (yours:
  // p.horseAct; a brushed horse's shake: a.act) or from another player's messages (live.js RemotePlayer.horseAct), t the
  // game's clock when it starts (the shake after a brushing starts when the strokes end: in the future). So it plays from
  // the clock, never twice, and a model made again in the middle of it goes on where it was. Its sounds: horse.js plays
  // yours when they happen (the neigh of a rear, the snort of getting winded); here, another player's, the snort that
  // ends a shake, and the snorts of a winded horse now and then
  horseState(m, e, act, winded, dt, vol) {
    const S = (m.hs ||= { act: null, at: 0, winded: 0, on: false, nextSnort: 0 }), now = this.game?.time ?? 0, mine = m === this.player;
    const was = S.act, wasAt = S.at;
    S.act = null; S.deep = e.depth || 0; S.fp = mine && CAM.first;   // (from its rider's own eyes: the rear's head and neck stay out of the view)
    if (act?.kind) {
      const A = ACT_ALIAS[act.kind] || act.kind, D = HORSE_ACTS[A];
      // (no start time from a game that sends none: from when it was first seen)
      let t0 = act.t;
      if (typeof t0 !== 'number') { t0 = ACT_T.get(act); if (t0 === undefined) ACT_T.set(act, (t0 = now)); }
      const at = now - t0;
      if (D && at >= 0 && at < D) { S.act = A; S.at = at; }
    }
    if (S.act && vol > 0.3) {
      if (S.act !== was && !mine) { if (S.act === 'rear') Audio.neigh(vol); else if (S.act === 'toss' || S.act === 'stumble') Audio.snort(vol * 0.7); else if (S.act === 'slide') Audio.skid(vol); }
      if (S.act === 'shake' && (was !== 'shake' || wasAt < SHAKE_SNORT) && S.at >= SHAKE_SNORT) Audio.snort(vol);   // (shaking off the dust)
    }
    const on = S.on;
    S.on = winded;
    S.winded += ((winded ? 1 : 0) - S.winded) * Math.min(1, dt * (winded ? 2.5 : 0.7));
    if (!winded && S.winded < 0.01) S.winded = 0;
    if (winded && !on) S.nextSnort = this.time + (mine ? 2.8 : 0);   // (yours: horse.js snorted as it happened)
    if (winded && vol > 0.3 && this.time >= S.nextSnort) { Audio.snort(vol); S.nextSnort = this.time + 2.6 + Math.random() * 1.2; }
    return S;
  }
  // How loud this one's horse sounds here (0..1): yours under you, all of it; another's fades out at HEAR_M
  hearing(m, x, z) {
    if (m === this.player) return 1;
    const me = this.me;
    if (!me) return 0;
    const d = Math.hypot(x - me.x, z - me.y);
    return d < HEAR_M ? 1 - d / HEAR_M : 0;
  }
  // The hooves that landed this frame (animateHorse counts them: u.hits), as one strike (the trot's pair lands at once; the
  // gallop's strike sounds its pair: Audio.hooves); on hard ground a ringing clop, on grass a thud, in water a splash
  hooves(m, e, gait, scene, vol) {
    if (vol <= 0.02 || this.time - (m.hoofT || 0) < 0.045) return;
    m.hoofT = this.time;
    if (this.time - (m.hardT ?? -9) > 0.3) {
      m.hardT = this.time; m.hard = hardGround(scene, e);
      m.wet = e.remote || e === this.me ? e.depth > 0.15 : !!(scene?.waterDepth && scene.waterDepth(e.x, e.y) > 0.15);
    }
    if (m.wet) { if (vol > 0.4 && this.time - (m.wadeT2 || 0) > 0.3) { m.wadeT2 = this.time; Audio.wade(); } return; }
    Audio.hooves(gait, m.hard, vol);
  }

  // La pose de los huesos de una persona: andar (animate), en el aire, lo que lleva en la mano, agachada, sentada, a
  // caballo o en barca, y mirar a quien tiene al lado. dt: el tiempo desde la última pose (ver pose)
  poseBones(m, e, P, pz, lying, dt, game) {
    P.animate(dt, e.mount || e.boat || e.aboard || m.swimK > 0.5 ? 0 : m.speed, e.gait);   // (saliendo del agua, ya andando: las piernas, a andar; gait: the player's three speeds, entities.js)
    if (e.z - (e.floor || 0) > 0.03) {   // en el aire: con las piernas recogidas
      if (!e.mount) { const k = Math.min(1, (e.z - (e.floor || 0)) / 0.25); P.legs[0].rotation.x = -0.7 * k; P.legs[1].rotation.x = 0.35 * k; }
    }
    // (running with a tool in the hand, its arm swings less: how much, easing with the gait; see hold)
    m.runArm = (m.runArm || 0) + ((e.mount || e.boat || e.aboard || m.swimK > 0.5 ? 0 : e.gait === 2 ? 1 : e.gait === 1 ? 0.5 : 0) - (m.runArm || 0)) * Math.min(1, dt * 6);
    // (después de andar: el golpe manda sobre el balanceo del brazo)
    if (game) this.hold(m, { held: (game.plans?.handId() ?? game.inv.held?.id) || null, swing: game.gather.swing, swingItem: game.gather.swingItem, cooldown: game.gather.cooldown, fishPose: game.fishing?.pose() || null, bowPull: game.archery?.k || 0, brush: e.emote?.k === 'brush' }, dt);
    else if (e.remote) this.hold(m, e, dt);
    const casting = m.anim?.kind === 'lanzar' ? P.arms[P.toolArm].rotation.x : null;
    // (the arms busy: something big in them, or the wheelbarrow's grips; riding or rowing with a big thing, the hands are free. carry3d.js)
    const busy = e.pushing ? 'push' : e.mount || e.boat || e.aboard ? null : e.armsBusy || (e.carrying && BULKY[e.carrying] ? BULKY[e.carrying].hold : null);
    if (busy === 'push') pushPose(P); else if (busy) holdPose(P, busy);
    // Agachado (Shift): las rodillas dobladas, el cuerpo más bajo y un poco echado hacia delante; andando, a pasitos
    const C = CROUCH;
    P.crouch = (P.crouch || 0) + ((e.crouch && !pz && !e.mount && !e.boat && !e.aboard && !(m.swimK > 0.5) ? 1 : 0) - (P.crouch || 0)) * Math.min(1, dt * 12);
    if (P.crouch > 0.01) {
      const c = P.crouch;
      for (const l of P.legs) l.rotation.x = l.rotation.x * (1 - c * 0.5) - C.hip * c;
      for (const k of P.shins || []) k.rotation.x = k.rotation.x * (1 - c) + C.knee * c;
      // (lo que de verdad se acortan las piernas dobladas, con sus medidas; el pie que queda más abajo es el que apoya)
      const k = P.kid ? KID_REF : 1, Lt = P.shins[0].position.length(), Ls = P.hipY / k - Lt;
      let reach = 0;
      for (let i = 0; i < 2; i++) { const a = P.legs[i].rotation.x, b = a + P.shins[i].rotation.x; reach = Math.max(reach, Lt * Math.cos(a) + Ls * Math.cos(b)); }
      P.body.position.y -= Math.max(0, Lt + Ls - reach);
      P.torso.rotation.x += C.lean * c;
      P.head.rotation.x = -C.lean * 0.8 * c;
      if (m.holdTool && m.toolIdle && !busy && m.hand) { P.arms[P.toolArm].rotation.x += 0.2 * c; m.hand.rotation.x = -1.1 * c; }   // (a tool held crouching: upright beside the knee, not across the legs)
    } else P.head.rotation.x = busy === 'push' ? -(P.pushFit?.lean ?? 0.22) * 0.7 : 0;   // (leaning on the wheelbarrow, the head up: it looks ahead)
    if (pz?.kind === 'bath') bathBones(P);
    else if (pz && !lying) {   // sentado: los muslos hacia delante; en la silla, las piernas colgando; en el suelo, estiradas
      for (const l of P.legs) l.rotation.x = -Math.PI / 2;
      for (const k of P.shins || []) k.rotation.x = pz.kind === 'sit' ? Math.PI / 2 : 0.1;
      if (pz.kind === 'floorSit') { for (const a of P.arms) a.rotation.x = 0.45; P.torso.rotation.x = -0.12; }
      else for (const a of P.arms) a.rotation.x = -0.35;
      // (at a table game, the forearms resting on its edge: tablegames.js)
      if (pz.kind === 'sit' && e.tableHands > (this.game?.time ?? 0)) { for (let i = 0; i < 2; i++) { P.arms[i].rotation.x = -0.62; P.arms[i].rotation.z = (i === 0 ? 1 : -1) * 0.12; if (P.fore?.[i]) P.fore[i].rotation.x = -0.72; } P.torso.rotation.x = 0.07; }
    }
    if (e.mount || e.boat || e.aboard) { P.legs[0].rotation.x = P.legs[1].rotation.x = e.mount ? -1.1 : -1.4; P.legs[0].rotation.z = 0.5; P.legs[1].rotation.z = -0.5; for (const k of P.shins || []) k.rotation.x = e.mount ? 1.0 : 1.3; }
    else P.legs[0].rotation.z = P.legs[1].rotation.z = 0;
    // (seated or in a boat, the arm with the rod is the rod's: its cast, the line out, the fish held)
    if (casting !== null && pz && !lying) P.arms[P.toolArm].rotation.x = casting;
    else if (m.fishOn && (pz || e.boat || e.aboard) && !lying) fishArms(P, m.fishOn);
    if (m.swimK) this.swimBones(m, P);
    if (e.mount) this.reinArms(m, P);
    if (!busy && (m.leadK > 0 || e.leads)) this.leadBones(m, e, P, dt, pz);   // (the reins of the horse it leads)
    if (e.emote && !busy) this.emote(m, e, P, dt, !!(game || e.remote));   // (with the arms busy, no gesture)
    if (e.mount) {
      // (astride a broader back)
      const U = m.horse?.userData, w = ((U?.wk || 1) * (U?.size || 1) - 1) * RIDE.astride;
      if (w > 0.01) { P.legs[0].rotation.z += w; P.legs[1].rotation.z -= w; }
      this.riderBones(m, P);
    }
    // Shivering with cold, standing still and with nothing else to do: shoulders up, arms hugging the chest, a small
    // tremble (an idle layer over the pose, eased in and out)
    const shiver = !!m.surf?.shiver && !pz && !lying && !busy && !m.anim && !e.emote && m.speed < 0.3 && !(m.swimK > 0.05) && !e.mount && !e.boat && !e.aboard && !(P.crouch > 0.1);
    m.shivK = (m.shivK || 0) + ((shiver ? 1 : 0) - (m.shivK || 0)) * Math.min(1, dt * (shiver ? SHIVER.in : SHIVER.out));
    if (m.shivK > 0.01) { shiverBones(m, P, m.shivK, this.time, !!(game || e.remote)); m.shivTw = true; }
    else if (m.shivTw) { m.shivTw = false; for (const A of P.arms) A.rotation.y = 0; }
    else m.shivK = 0;
    this.lookAt(m, e, dt, lying);
  }
  // What the world has left on this person's body (body.surface()'s shape, 0..1), or null: the player's from their Body;
  // another player's from their messages (RemotePlayer.grime: the unpacked st.bd, or the packed int); a neighbour's, a
  // fixed one by trade if they have it (PEOPLE grime)
  surfaceOf(m, e) {
    if (m === this.player) return this.game?.body?.surface?.() || null;
    const g = e.grime;
    if (typeof g === 'number') { if (g !== m.grimeN) { m.grimeN = g; if (g > 0) unpackBd(g, (m.grimeS ||= {})); } return g > 0 ? m.grimeS : null; }
    return g && typeof g === 'object' ? g : null;
  }
  // The foam over the tub's water while this person bathes (pz: the bath pose, or null to hide it): made the first time,
  // on the person's root, so it turns with them and goes where their bath goes (models.js bathFoam, shared)
  foam(m, P, pz) {
    if (pz && !m.foam) P.root.add((m.foam = bathFoam()));
    if (!m.foam) return;
    m.foam.visible = !!pz;
    // (at the water: the root is BATH_HIP + h over the tub's ground, minus the hip; the water is TUB.water over it)
    if (pz) m.foam.position.set(0, TUB.water - (pz.h || 0) - BATH_HIP * (P.kid ? KID_REF : 1) + P.hipY, 0);
  }

  // A gesture to say something with the body (social.js: greeting, nodding, a shrug, provoking…), on top of the pose: it
  // eases in and out, and ends by itself (then animate() puts the arms back). e.emote = { k, t }. A player (player: true)
  // uses the free arm, the left one (the right holds the tool, or the reins on a horse), and the two-arm ones only with an
  // empty hand; the neighbors, the right one. Swimming, none
  emote(m, e, P, dt, player) {
    const a = e.emote, E = EMOTES[a.k];
    if (!E || m.swimK > 0.5) { delete e.emote; if (m.emTw) { m.emTw = false; for (const A of P.arms) A.rotation.y = 0; } return; }
    a.t += dt;
    const k = Math.min(1, a.t / E.dur), w = Math.max(0, Math.min(1, k / 0.18, (1 - k) / 0.22)), sm = w * w * (3 - 2 * w);
    // (tool: the hand with the tool in it, the right one, as the brush is held there: see hold)
    const one = E.tool ? P.toolArm : player ? 1 - P.toolArm : P.toolArm, arms = E.both && !(player && m.holding) ? [0, 1] : [one], ride = !!e.mount;
    for (const i of arms) {
      const q = E.pose(k, i === 0 ? -1 : 1, ride, a.amp), A = P.arms[i], F = P.fore?.[i];
      if (q.ax !== undefined) A.rotation.x += (q.ax - A.rotation.x) * sm;
      if (q.az !== undefined) A.rotation.z += (q.az - A.rotation.z) * sm;
      if (q.ay !== undefined) { A.rotation.y = q.ay * sm; m.emTw = true; }   // (animate() never writes it: put back below)
      if (F && q.fx !== undefined) F.rotation.x += (q.fx - F.rotation.x) * sm;
    }
    const q = E.pose(k, 1, ride, a.amp);
    if (m.emTw && (q.ay === undefined || k >= 1)) { m.emTw = false; for (const A of P.arms) A.rotation.y = 0; }
    if (q.hx) P.head.rotation.x += q.hx * sm;
    if (q.tx) P.torso.rotation.x += q.tx * sm;
    P.head.rotation.z = (q.hz || 0) * sm;
    if (k >= 1) { delete e.emote; P.head.rotation.z = 0; }
  }

  // Nadando: dónde va la raíz de la persona (la altura de sus pies de pie), con la brazada que lleva (m.swimS: su momento
  // p, de 0 a 1, y s, lo que nada de 0, quieto, a 1). La brazada sigue a lo que avanza (una cada 1,6 m) y, quieto, va
  // despacio. bed: el fondo, del que no baja. De paso, las gotas y el sonido de cada brazada
  swimY(m, e, P, dt, bed) {
    const S = (m.swimS ||= { p: Math.random(), s: 0 }), was = S.p;
    S.s += (Math.min(1, m.speed / 1.0) - S.s) * Math.min(1, dt * 3);
    S.p = (S.p + dt * Math.max(0.45, m.speed / 1.6)) % 1;
    // (diving: how much of the dive pose (k), the vertical speed eased (v, + down) and the kick's phase (ph))
    const under = (e.sink || 0) + (e.dive || 0), D = (m.diveS ||= { k: 0, v: 0, ph: 0, last: under });
    if (m.swimK < 0.05) D.v = 0;   // (just in the water: what it was diving before is not a speed)
    else if (dt > 0) { const v = Math.max(-2, Math.min(2, (under - D.last) / dt)); D.v += (v - D.v) * Math.min(1, dt * 4); }
    D.last = under; D.k = smoothstep(DIVE_POSE[0], DIVE_POSE[1], e.dive || 0);
    D.ph = (D.ph + dt * (0.9 + 1.6 * Math.min(1, Math.abs(D.v)))) % 1;
    const loud = under <= QUIET;   // (under water: no drops, no rings and no sound of strokes)
    if (loud && m.swimK > 0.9 && S.s > 0.3 && this.game?.gather) {
      const yaw = P.root.rotation.y, fx = Math.sin(yaw), fz = Math.cos(yaw);
      // (al sacar las manos por delante y al cerrar las piernas, por detrás; el jugador, además, lo oye)
      if (passed(was, S.p, 0.5)) { this.game.gather.splash(e.x + fx * 0.75, e.y + fz * 0.75, 3, 0.6); this.view.fx.rippleAt(m.root.position.x + fx * 0.55, m.root.position.z + fz * 0.55, 1.3, 0.5); }
      if (passed(was, S.p, 0.66)) { this.game.gather.splash(e.x - fx * 0.95, e.y - fz * 0.95, 4, 0.7); if (m === this.player) Audio.swim(); }
    } else if (loud && m.swimK > 0.9 && passed(was, S.p, 0.25)) this.view.fx.rippleAt(m.root.position.x, m.root.position.z, 1.0, 0.35);   // (flotando: una onda suave a cada vaivén)
    // (diving, the hip goes from where it floats to where it strokes, so stopping or stroking does not lift it or drop it)
    const s = S.s, float = SWIM_HIP.tread + 0.025 * Math.sin(S.p * Math.PI * 2) + (SWIM_HIP.stroke - keys(BRAZA.rise, S.p) - SWIM_HIP.tread) * s;
    const hip = float + (SWIM_HIP.stroke - float) * D.k + under, flat = Math.max(s, D.k);
    let y = WATER_Y - hip - P.hipY;
    if (bed !== null) y = Math.max(y, bed + SWIM_BED.tread + (SWIM_BED.stroke - SWIM_BED.tread) * flat - P.hipY);
    return y;
  }
  // La pose de nadar, sobre la de ahora con lo que se nade (m.swimK): quieto, flotando de pie (las piernas a destiempo,
  // como un batidor, y las manos abiertas, remando); nadando, a braza (BRAZA). Lo que se escribe es el valor entero, no se
  // suma: animate() lo vuelve a poner todo en cada pose
  swimBones(m, P) {
    const b = P.r.bones, S = m.swimS || { p: 0, s: 0 }, K = m.swimK, s = S.s, p = S.p, TAU = Math.PI * 2, w = Math.sin(p * TAU);
    const L = (v0, tread, stroke) => v0 + (tread + (stroke - tread) * s - v0) * K;
    b.body.rotation.set(L(b.body.rotation.x, 0.32 + 0.03 * w, keys(BRAZA.pitch, p)), L(b.body.rotation.y, 0, 0), L(b.body.rotation.z, 0, 0));
    b.spine.rotation.x = L(b.spine.rotation.x, 0.04, keys(BRAZA.spine, p));
    b.torso.rotation.x = L(b.torso.rotation.x, 0, 0);
    b.neck.rotation.x = L(b.neck.rotation.x, -0.2, keys(BRAZA.neck, p));
    b.head.rotation.x = L(b.head.rotation.x, -0.12, keys(BRAZA.head, p));
    for (const [side, sg, off] of [['L', 1, 0], ['R', -1, 0.5]]) {
      const A = b['arm' + side], F = b['fore' + side], G = b['leg' + side], K2 = b['shin' + side], Ft = b['foot' + side], q = (p + off) * TAU;
      A.rotation.set(L(A.rotation.x, -0.7 + 0.12 * w, keys(BRAZA.armX, p)), L(A.rotation.y, 0, 0), L(A.rotation.z, sg * (0.95 + 0.3 * w), sg * keys(BRAZA.armZ, p)));
      F.rotation.x = L(F.rotation.x, -0.7 + 0.25 * Math.sin(p * TAU + 1), keys(BRAZA.foreX, p));
      G.rotation.x = L(G.rotation.x, -0.75 + 0.3 * Math.sin(q), keys(BRAZA.legX, p));
      G.rotation.z = L(G.rotation.z, sg * (0.35 + 0.1 * Math.sin(q)), sg * keys(BRAZA.legZ, p));
      K2.rotation.x = L(K2.rotation.x, 1.3 + 0.5 * Math.sin(q + 1.2), keys(BRAZA.shinX, p));
      if (Ft) Ft.rotation.x = L(Ft.rotation.x, 0.1, keys(BRAZA.footX, p));
    }
    this.diveBones(m, P);
  }
  // Diving, over the swimming pose: still or going up and down, horizontal with the arms forward and the legs kicking (a
  // flutter kick, faster while it moves up or down); stroking forwards, the breaststroke stays. Going down, the body and
  // the head tilt down; coming up, the body tilts up (m.diveS, from swimY)
  diveBones(m, P) {
    const D = m.diveS, K = m.swimK;
    if (!D || !(D.k > 0.001)) return;
    const b = P.r.bones, s = (m.swimS || { s: 0 }).s, k = D.k * (1 - s) * K, tk = D.k * K, TAU = Math.PI * 2;
    const down = Math.max(0, Math.min(1, D.v / 1.5)), up = Math.max(0, Math.min(1, -D.v / 1.8));
    const amp = DIVE.kick * (0.45 + 0.55 * Math.min(1, Math.abs(D.v) + 0.2 * (1 - s)));
    const mix = (o, v) => o + (v - o) * k;
    if (k > 0.001) {
      b.body.rotation.x = mix(b.body.rotation.x, DIVE.pitch);
      b.body.rotation.y = mix(b.body.rotation.y, 0); b.body.rotation.z = mix(b.body.rotation.z, 0);
      b.spine.rotation.x = mix(b.spine.rotation.x, 0.05);
      b.neck.rotation.x = mix(b.neck.rotation.x, DIVE.neck);
      b.head.rotation.x = mix(b.head.rotation.x, DIVE.headX);
      for (const [side, sg, off] of [['L', 1, 0], ['R', -1, 0.5]]) {
        const A = b['arm' + side], F = b['fore' + side], G = b['leg' + side], S2 = b['shin' + side], Ft = b['foot' + side], q = (D.ph + off) * TAU;
        A.rotation.x = mix(A.rotation.x, DIVE.armX + 0.06 * Math.sin(q));
        A.rotation.y = mix(A.rotation.y, 0);
        A.rotation.z = mix(A.rotation.z, sg * (DIVE.armZ + 0.08 * Math.sin(D.ph * TAU)));
        F.rotation.x = mix(F.rotation.x, DIVE.foreX);
        G.rotation.x = mix(G.rotation.x, DIVE.legX + amp * Math.sin(q));
        G.rotation.z = mix(G.rotation.z, sg * 0.06);
        S2.rotation.x = mix(S2.rotation.x, DIVE.shinX + amp * 0.7 * (0.5 + 0.5 * Math.sin(q + 1.1)));
        if (Ft) Ft.rotation.x = mix(Ft.rotation.x, DIVE.footX);
      }
    }
    b.body.rotation.x += tk * (DIVE.down * down - DIVE.up * up);
    b.head.rotation.x += tk * DIVE.head * down;
  }

  // La herramienta (o el arma) en la mano, y el gesto al usarla. Cada golpe nuevo (el temporizador swing de
  // la recolección vuelve a subir; en los demás jugadores, su cuenta de golpes) empieza una animación de su
  // herramienta, que dura como mucho lo que tarda en poder volver a golpear (así, con el clic pulsado, los
  // golpes se encadenan). g: { held, swing, swingItem, cooldown }
  hold(m, g, dt) {
    const id = g.held, P = m.person;
    if (g.swing > (m.lastSwing || 0) + 1e-4) {
      const kind = gestureOf(g.swingItem), base = GESTURES[kind].dur;
      m.anim = { t: 0, item: g.swingItem, kind, dur: g.cooldown > 0 ? Math.max(0.22, Math.min(base, g.cooldown)) : base };
    }
    m.lastSwing = g.swing;
    // (brushing a horse, the brush in the hand while the gesture lasts: g.brush for yours, another player's from their gesture)
    const a = m.anim, show = a ? a.item : (g.brush ?? g.emote?.k === 'brush') ? BRUSH : id;
    if (m.holding !== show) {
      // (what was in the hand takes its own materials with it: the player's, for the outline, and a spectator's; they
      // piled up in m.mats with each switch)
      for (const c of m.hand.children) c.traverse(o => {
        if (!o.isMesh) return;
        if (o.userData.solid) o.material.dispose();
        else if (m.mats?.includes(o.material)) { o.material.dispose(); for (const list of [m.mats, m.body]) { const i = list.indexOf(o.material); if (i >= 0) list.splice(i, 1); } }
      });
      m.hand.clear();
      const tm = show && show !== BRUSH && toolModel(show), tool = show === BRUSH ? brushModel() : tm || (show && foodInHand(show));
      m.holdTool = !!tm;   // (a tool or a weapon: long, it would swing up into the face running)
      if (tool && m.mats) tool.traverse(o => { if (o.isMesh) ownMesh(o, m, true); });
      if (tool) m.hand.add(tool);
      if (tool && m.ghosted) { m.ghosted = false; this.ghost(m, true); }   // (de espectador, también lo de la mano)
      m.holding = show;
    }
    // (el brazo de la mano que lleva la herramienta, la derecha; los gestos se pensaron para la izquierda: de lado y
    // el giro del tronco, al revés)
    const T = P.toolArm, arm = P.arms[T], mir = T === 0 ? -1 : 1;
    arm.rotation.z = 0; m.hand.rotation.x = 0; P.torso.rotation.x = 0;
    m.fishOn = !a && g.fishPose ? g.fishPose : null; m.fishHeld = !!m.fishOn?.both;   // (fishing.js pose; another's, live.js st.fb)
    m.toolIdle = !a && !g.fishPose && !(g.bowPull > 0);   // (held, not in use: poseBones may carry it otherwise, crouching)
    pullBow(m.hand, g.bowPull || 0);
    // (tensando el arco: el brazo estirado y el arco de pie)
    if (g.bowPull > 0 && !a) { arm.rotation.x = -1.5; m.hand.rotation.x = 1.5; if (P.fore) P.fore[T].rotation.x = -0.1; return; }
    if ((a || g.fishPose) && P.fore) P.fore[T].rotation.x = -0.1;   // (usando algo, el brazo casi estirado)
    // (una postura fija: pescando. fishPose, no pose: pose es sentarse o tumbarse, y los demás jugadores la traen)
    if (!a) {
      if (g.fishPose) fishArms(P, g.fishPose);
      else if (m.holdTool && m.runArm > 0.01) {   // (jogging or sprinting with a tool: its arm swings less forward, a little lower, the elbow straighter)
        const k = m.runArm, x = arm.rotation.x;
        arm.rotation.x = (x < 0 ? x * (1 - 0.65 * k) : x * (1 - 0.3 * k)) + 0.1 * k;
        if (P.fore) P.fore[T].rotation.x *= 1 - 0.45 * k;
      }
      return;
    }
    a.t += dt;
    const k = Math.min(1, a.t / a.dur), ge = GESTURES[a.kind];
    arm.rotation.x = keys(ge.arm, k);
    if (ge.side) arm.rotation.z = keys(ge.side, k) * mir;
    if (ge.twist) P.torso.rotation.y += keys(ge.twist, k) * mir;
    if (ge.lean) P.torso.rotation.x = keys(ge.lean, k);
    if (ge.tilt) m.hand.rotation.x = keys(ge.tilt, k);
    if (k >= 1) m.anim = null;
  }
}

// The arms fishing (fishing.js pose): the rod's arm out, or both forearms up with the catch across them
function fishArms(P, fp) {
  P.torso.rotation.x = fp.lean;
  if (!fp.both) { P.arms[P.toolArm].rotation.x = fp.arm; if (P.fore) P.fore[P.toolArm].rotation.x = -0.1; return; }
  for (let i = 0; i < 2; i++) { const A = P.arms[i]; A.rotation.x = -0.62; A.rotation.z = (i ? 1 : -1) * 0.12; if (P.fore) P.fore[i].rotation.x = -0.75; }
}

// Gestos al usar lo que se lleva en la mano: claves [momento (0 a 1), valor] del giro del brazo hacia delante
// (arm, negativo = levantarlo), hacia el lado (side), del tronco (twist, lean) y de la mano (tilt), y lo que
// dura en segundos. Los golpes cogen impulso por encima de la cabeza y bajan deprisa.
const GESTURES = {
  golpe: { dur: 0.42, arm: [[0, 0], [0.38, -2.7], [0.62, 0.5], [1, 0]], twist: [[0, 0], [0.38, -0.25], [0.62, 0.15], [1, 0]], lean: [[0, 0], [0.38, -0.08], [0.62, 0.18], [1, 0]], side: [[0, 0], [0.38, 0.12], [1, 0]] },
  cavar: { dur: 0.45, arm: [[0, 0], [0.4, -2.6], [0.65, 0.85], [1, 0]], twist: [[0, 0], [0.4, -0.15], [1, 0]], lean: [[0, 0], [0.4, -0.1], [0.65, 0.3], [1, 0]] },
  palear: { dur: 0.5, arm: [[0, 0], [0.3, -1.1], [0.55, 0.45], [0.8, -0.7], [1, 0]], twist: [[0, 0], [0.3, -0.12], [0.8, 0.2], [1, 0]], lean: [[0, 0], [0.3, 0.05], [0.55, 0.32], [0.8, 0.05], [1, 0]], tilt: [[0, 0], [0.55, 0.35], [0.8, -0.25], [1, 0]] },
  barrer: { dur: 0.4, arm: [[0, 0], [0.25, -1.2], [0.75, -1.15], [1, 0]], twist: [[0, 0], [0.25, 0.9], [0.72, -0.9], [1, 0]], side: [[0, 0], [0.25, -0.25], [0.72, 0.2], [1, 0]] },
  tajo: { dur: 0.36, arm: [[0, 0], [0.32, -2.4], [0.62, 0.3], [1, 0]], side: [[0, 0], [0.32, 0.5], [0.62, -0.5], [1, 0]], twist: [[0, 0], [0.32, -0.4], [0.62, 0.4], [1, 0]] },
  regar: { dur: 0.7, arm: [[0, 0], [0.25, -0.9], [0.75, -0.9], [1, 0]], tilt: [[0, 0], [0.25, 1.5], [0.75, 1.5], [1, 0]] },
  lanzar: { dur: 0.6, arm: [[0, 0], [0.3, -2.6], [0.55, -0.6], [1, 0]], twist: [[0, 0], [0.3, -0.2], [0.55, 0.1], [1, 0]] },
  // (the hammer: up beside the head and down in front of the chest, from the elbow)
  nail: { dur: 0.55, arm: [[0, 0], [0.34, -2.05], [0.55, -0.62], [0.68, -0.75], [1, 0]], twist: [[0, 0], [0.34, -0.14], [0.55, 0.08], [1, 0]], lean: [[0, 0], [0.34, -0.04], [0.55, 0.1], [1, 0]], side: [[0, 0], [0.34, 0.1], [0.55, -0.06], [1, 0]], tilt: [[0, 0], [0.34, -0.45], [0.55, 0.12], [1, 0]] },
  mano: { dur: 0.3, arm: [[0, 0], [0.4, -1.5], [1, 0]], twist: [[0, 0], [0.4, -0.25], [1, 0]] },
};
// The gestures of social.js: what each one does, at its moment k (0 to 1), with s the side of the arm (-1 the right, 1 the
// left: + raises it outwards). ax: the arm forward (negative raises it), az: sideways, fx: the elbow (negative bends it),
// ay: the arm's turn about its length (- turns the forearm in), hx: the head (positive, down), hz: its tilt, tx: the trunk (positive, forward). How long it lasts, in seconds
const COW_SWIM = 0.92;
export const EMOTES = {
  wave: { dur: 1.1, pose: (k, s) => ({ ax: -2.55, az: s * (0.3 + 0.3 * Math.sin(k * Math.PI * 6)), fx: -0.5 }) },
  nod: { dur: 0.8, pose: k => ({ hx: 0.34 * Math.sin(k * Math.PI * 2) ** 2 }) },
  shrug: { dur: 1.0, both: true, pose: (k, s) => ({ ax: -0.25, az: s * 0.35, fx: -1.5, hz: 0.16 }) },
  hips: { dur: 1.4, both: true, pose: (k, s) => ({ ax: 0.35, az: s * 0.55, fx: -1.3, hx: -0.06 }) },
  // (a fist shaken at shoulder height, the elbow bent and pumping, the trunk and the head leaning in: never the arm
  // straight up of wave)
  fist: { dur: 0.9, pose: (k, s) => { const p = Math.sin(k * Math.PI * 6) ** 2; return { ax: -1.35 + 0.15 * p, az: s * 0.3, fx: -1.15 - 0.4 * p, tx: 0.12, hx: -0.1 }; } },
  flinch: { dur: 0.8, both: true, pose: (k, s) => ({ ax: -1.05, az: s * 0.18, fx: -1.75, tx: -0.16, hx: -0.18 }) },
  point: { dur: 1.0, pose: (k, s) => ({ ax: -1.5, az: s * 0.06, fx: -0.05 }) },
  dismiss: { dur: 0.75, pose: (k, s) => ({ ax: -0.95 + 0.65 * k, az: s * (0.12 + 1.05 * k), fx: -0.65 }) },
  // (drinking from a river or a lake, crouched: needs.js sets the crouch and plays it again for each sip. The cupped hands
  // go down to the water, up to the mouth with the head tipped back, and down again)
  drink: { dur: 1.5, both: true, pose: (k, s) => ({ ax: keys(DRINK.ax, k), az: s * keys(DRINK.az, k), fx: keys(DRINK.fx, k), hx: keys(DRINK.hx, k), tx: keys(DRINK.tx, k) }) },
  // (scrubbing at a river or a lake, crouched in the shallows or at the bank: body.js sets the crouch and plays it again
  // while the scrub lasts, as needs.js does with drink. Both forearms rub low over the water, out of step, the head down)
  scrub: { dur: 2.4, both: true, pose: (k, s) => { const r = Math.sin(k * Math.PI * 12 + (s > 0 ? 0 : Math.PI)); return { ax: -0.95 + 0.08 * r, az: -s * 0.18, fx: -0.75 + 0.3 * r, hx: 0.25, tx: 0.22 }; } },
  // At table, a neighbour (routine3d.js): the spoon to the mouth and back, twice
  eat: { dur: 2.2, pose: (k, s) => { const p = Math.max(0, Math.sin(k * Math.PI * 4)); return { ax: -0.5 - 0.62 * p, az: -s * (0.05 + 0.2 * p), fx: -0.9 - 0.95 * p, hx: 0.16 - 0.1 * p, tx: 0.05 }; } },
  // (shivering on purpose, as a gesture: the same as the idle layer of the cold, see shiverBones)
  shiver: { dur: 2.0, both: true, pose: (k, s) => ({ ax: SHIVER.ax, az: -s * SHIVER.az + 0.02 * Math.sin(k * Math.PI * 2 * 16), fx: SHIVER.fx, hx: 0.08, tx: 0.07 }) },
  // The horse (Plan F §5.3; the third argument: riding). brush: with the tool hand (tool: the brush is in it, see hold),
  // three strokes along the flank at the height of its ribs, out and back with the lay of the coat, the trunk leaning in
  brush: { dur: 2.0, tool: true, pose: (k, s) => { const r = Math.sin(k * Math.PI * 6); return { ax: -0.98 + 0.12 * r, az: s * (0.06 + 0.22 * r), fx: -0.45 - 0.25 * r, tx: 0.14, hx: 0.12 }; } },
  // pat: on foot, the hand on its neck at shoulder height, three light pats; riding, a lean forward and the hand down on
  // its neck in front of the saddle
  pat: { dur: 1.3, pose: (k, s, ride) => { const p = Math.max(0, Math.sin(k * Math.PI * 6)); return ride ? { ax: -0.74 + 0.08 * p, az: -s * 0.12, fx: -0.36 - 0.2 * p, tx: 0.46, hx: 0.06 } : { ax: -1.38 + 0.1 * p, az: s * 0.04, fx: -0.35 - 0.25 * p, tx: 0.04 }; } },
  // A talk's (talk.js), drawn by each game and never sent. talk: both forearms up in front, opening and closing softly as one
  // speaks, the head going along; amp, how big (by their character; the shy, with the head down). think: the hand to the chin
  talk: { dur: 2.0, both: true, pose: (k, s, ride, amp = 1) => { const p = Math.sin(k * Math.PI * 2 - 0.6 * (s > 0 ? 1 : 0)), o = Math.sin(k * Math.PI * 4); return { ax: -0.28 - 0.3 * amp - 0.14 * amp * p, az: s * (0.02 + (0.12 + 0.14 * p) * amp), fx: -0.75 - 0.35 * amp + 0.2 * amp * o, hx: amp < 0.35 ? 0.2 : 0.05 * amp * o, hz: 0.04 * amp * p }; } },
  think: { dur: 0.95, pose: (k, s) => ({ ax: -0.84, az: -s * 0.15, ay: -s * 0.6, fx: -2.02, hx: 0.12, hz: 0.07 }) },
  // A customer at a player's counter (business.js), drawn by each game: inspect, leaning over the goods, the hand going from one
  // to another; pay, the hand out with the coins and back
  inspect: { dur: 3.4, pose: (k, s) => { const e = Math.min(1, k * 6, (1 - k) * 6), p = Math.sin(k * Math.PI * 4); return { ax: e * (-0.72 + 0.1 * p), az: e * s * (0.05 + 0.22 * p), fx: e * -0.62, hx: e * 0.36, hz: e * 0.06 * p, tx: e * 0.24 }; } },
  arrest: { dur: 2.2, pose: (k, s) => { const e = Math.min(1, k * 5, (1 - k) * 4), q = e * e * (3 - 2 * e); return { ax: -1.28 * q, az: s * 0.1 * q, ay: -s * 0.25 * q, fx: -0.18 * q, tx: 0.16 * q, hx: 0.04 * q }; } },
  stagger: { dur: 1.1, both: true, pose: (k, s) => { const e = Math.min(1, k * 8) * (1 - k); return { ax: -0.7 * e * 1.6, az: s * 0.9 * e, fx: -0.9 * e, tx: -0.5 * e, hx: -0.35 * e }; } },
  pay: { dur: 1.7, pose: (k, s) => { const e = Math.min(1, k * 4, (1 - k) * 4), q = e * e * (3 - 2 * e); return { ax: -1.02 * q, az: -s * 0.06 * q, ay: s * 0.7 * q, fx: -0.5 * q, hx: 0.12 * q, tx: 0.08 * q }; } },
  // The table games (tablegames.js), drawn by each game and never sent. roll: a short throw of the forearm over the table; place:
  // leaning in, the arm out to the table and back; cheer: both fists up
  roll: { dur: 0.75, pose: (k, s) => { const a = Math.min(1, k * 5, (1 - k) * 3.2), f = k < 0.45 ? Math.sin(k / 0.45 * Math.PI) : -0.5 * Math.sin((k - 0.45) / 0.55 * Math.PI); return { ax: -0.95 * a - 0.3 * f * a, az: -s * 0.08 * a, fx: -0.75 * a - 0.5 * f * a, tx: 0.16 * a, hx: 0.14 * a }; } },
  place: { dur: 0.95, pose: (k, s) => { const a = Math.min(1, k * 3.4, (1 - k) * 2.8), q = a * a * (3 - 2 * a); return { ax: -1.12 * q, az: -s * 0.1 * q, fx: -0.22 * q, tx: 0.3 * q, hx: 0.2 * q }; } },
  cheer: { dur: 1.1, both: true, pose: (k, s) => { const a = Math.min(1, k * 5, (1 - k) * 4), p = Math.sin(k * Math.PI * 6) ** 2; return { ax: (-2.3 - 0.2 * p) * a, az: s * 0.3 * a, fx: -0.6 * a, hx: -0.14 * a }; } },
  // A door or a gate by hand (doorwalk.js; the leaf swings at CONTACT): push, the forearm up bent and then out straight at chest
  // height, the trunk leaning in, held while it swings and back; riding, lower, leaning down to a gate. pull: the arm out to
  // the handle, then drawn back with the elbow bent, the trunk leaning back a touch
  push: { dur: 0.9, pose: (k, s, ride) => ride ? { ax: keys(PUSH.ax, k) + 0.3, az: s * 0.1, fx: keys(PUSH.fx, k), tx: keys(PUSH.tx, k) + 0.28, hx: 0.12 } : { ax: keys(PUSH.ax, k), az: s * 0.08, fx: keys(PUSH.fx, k), tx: keys(PUSH.tx, k), hx: 0.06 } },
  pull: { dur: 1.0, pose: (k, s) => ({ ax: keys(PULL.ax, k), az: s * 0.1, fx: keys(PULL.fx, k), tx: keys(PULL.tx, k), hx: 0.05 }) },
  // whistle: the fingers to the mouth, the head up a touch, held for about half a second
  whistle: { dur: 0.9, pose: (k, s) => ({ ax: -1.2, az: -s * 0.1, ay: -s * 0.85, fx: -2.25, hx: -0.06 }) },
};
// In the tub: sitting on its floor with the legs straight forward under the water, the back leaning on its end, the head
// up to look ahead and the arms resting on the rims (after animate() and the crouch: written whole, not added)
function bathBones(P) {
  for (const l of P.legs) { l.rotation.x = -1.42; l.rotation.z = 0; }
  for (const k of P.shins || []) k.rotation.x = 0.18;
  P.torso.rotation.x = -0.3;
  P.head.rotation.x = 0.24;
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? -1 : 1;   // (arms[0], the right one, goes out to -x: see EMOTES)
    P.arms[i].rotation.x = 0.2; P.arms[i].rotation.z = s * 0.62;
    if (P.fore?.[i]) P.fore[i].rotation.x = -0.35;
  }
}
// Shivering (k 0..1 eases it in and out; t the time, for the tremble): the shoulders up, the arms hugging the chest (only
// the free one when the hand holds something: a player's tool hand is P.toolArm), and the trunk trembling
function shiverBones(m, P, k, t, player) {
  const b = P.r.bones, tr = Math.sin(t * Math.PI * 2 * SHIVER.hz) * 0.02 * k;
  if (b.clavL && b.clavR) { b.clavL.rotation.z += 0.13 * k; b.clavR.rotation.z -= 0.13 * k; }
  const arms = player && m.holding ? [1 - P.toolArm] : [0, 1];
  for (const i of arms) {
    const s = i === 0 ? -1 : 1, A = P.arms[i], F = P.fore?.[i];
    // (the upper arm close to the side and in towards the chest, the forearm folded across it: a hug, the hand on the
    // other side's ribs. Raised higher, the hand came up by the face, palm out, and read as a wave)
    A.rotation.x += (SHIVER.ax - A.rotation.x) * k;
    A.rotation.z += (-s * SHIVER.az - A.rotation.z) * k + s * tr;
    A.rotation.y = s * SHIVER.ay * k;   // (nothing else turns the arm about its length: put back to 0 when it ends)
    if (F) F.rotation.x += (SHIVER.fx - F.rotation.x) * k;
  }
  P.torso.rotation.x += 0.07 * k; P.torso.rotation.z += tr * 0.5;
  P.head.rotation.x += 0.08 * k;
}
const PUSH = {
  ax: [[0, -0.3], [0.22, -1.1], [0.38, -1.32], [0.75, -1.3], [1, -0.3]],
  fx: [[0, -0.4], [0.22, -1.45], [0.38, -0.12], [0.75, -0.2], [1, -0.4]],
  tx: [[0, 0], [0.22, 0.04], [0.38, 0.16], [0.75, 0.12], [1, 0]],
};
const PULL = {
  ax: [[0, -0.3], [0.3, -1.35], [0.42, -1.35], [0.78, -0.8], [1, -0.3]],
  fx: [[0, -0.4], [0.3, -0.12], [0.42, -0.15], [0.78, -1.45], [1, -0.4]],
  tx: [[0, 0], [0.3, 0.14], [0.42, 0.12], [0.78, -0.08], [1, 0]],
};
const DRINK = {
  ax: [[0, -0.2], [0.25, -0.55], [0.5, -1.05], [0.7, -1.05], [1, -0.2]],
  az: [[0, 0.1], [0.25, -0.12], [0.5, -0.22], [0.7, -0.22], [1, 0.1]],
  fx: [[0, -0.3], [0.25, -0.25], [0.5, -2.15], [0.7, -2.15], [1, -0.3]],
  hx: [[0, 0.2], [0.25, 0.32], [0.5, -0.12], [0.7, -0.2], [1, 0.2]],
  tx: [[0, 0.2], [0.25, 0.38], [0.5, 0.06], [0.7, 0.04], [1, 0.2]],
};
// Cuánto levanta el brazo ahora el gesto del jugador (0 si no está usando nada)
export function swingArm(m) { const a = m?.anim; return a ? keys(GESTURES[a.kind].arm, Math.min(1, a.t / a.dur)) : 0; }
function gestureOf(id) {
  const d = id && ITEMS[id];
  if (!d) return 'mano';
  if (d.weapon) return 'tajo';
  return { hacha: 'golpe', pico: 'golpe', azada: 'cavar', pala: 'palear', guadana: 'barrer', red: 'barrer', regadera: 'regar', cana: 'lanzar', hammer: 'nail' }[d.tool] || 'golpe';
}
// ¿Ha pasado un ciclo (de 0 a 1, que vuelve a empezar) por at, de a a b?
const passed = (a, b, at) => (a <= b ? a < at && b >= at : a < at || b >= at);
// El valor en el momento k, suavizado entre clave y clave
function keys(list, k) {
  for (let i = 1; i < list.length; i++) {
    const [k1, v1] = list[i];
    if (k <= k1) { const [k0, v0] = list[i - 1], t = (k - k0) / (k1 - k0 || 1); return v0 + (v1 - v0) * t * t * (3 - 2 * t); }
  }
  return list[list.length - 1][1];
}

// El nombre encima de la cabeza (de los demás jugadores): se ve siempre, también a través de las paredes.
// The label is painted once into a texture: if the game's font is not in yet, it is painted again (with its own width)
// as soon as it arrives, so it never stays in the fallback font
const TAG_FONT = '600 30px Barlow, system-ui, sans-serif';
function nameTag(name) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
  const paint = () => {
    const c = document.createElement('canvas'), x = c.getContext('2d');
    x.font = TAG_FONT;
    const w = Math.ceil(x.measureText(name).width) + 26;
    c.width = w; c.height = 46;
    x.fillStyle = 'rgba(30, 20, 14, 0.72)';
    x.beginPath(); x.roundRect(0, 0, w, 46, 12); x.fill();
    x.font = TAG_FONT; x.fillStyle = '#ffe7b0'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(name, w / 2, 24);
    const t = new THREE.CanvasTexture(c), old = s.material.map;
    t.colorSpace = THREE.SRGBColorSpace;
    s.material.map = t; s.material.needsUpdate = true;
    old?.dispose();
    s.scale.set(0.3 * w / 46, 0.3, 1);
  };
  paint();
  if (document.fonts && !document.fonts.check(TAG_FONT, name)) document.fonts.load(TAG_FONT, name).then(paint, () => {});
  s.position.y = 1.8;
  s.renderOrder = 10;
  return s;
}

// Hacia dónde mira una entidad (ángulo en el plano), o null si no se sabe
function facing(e) {
  if (e.dir && (e.dir[0] || e.dir[1])) return Math.atan2(e.dir[0], e.dir[1]);
  if (e.view) { const [sx, sy] = screenDirOf(e.view, e.flip); const [wx, wy] = screenToWorld(sx, sy); return Math.atan2(wx, wy); }
  if (e.vx || e.vy) return Math.atan2(e.vx, e.vy);
  return null;
}
function turnTo(o, yaw, dt) {
  let d = yaw - o.rotation.y;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  o.rotation.y += d * Math.min(1, dt * 10);
}

// ---------- monstruos ----------
function monsterModel(type) {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  if (type === 'limo') {
    const goo = new THREE.MeshStandardMaterial({ color: '#6ad04a', roughness: 0.2, metalness: 0, transparent: true, opacity: 0.85, emissive: '#1a5010', emissiveIntensity: 0.4 });
    mesh(G.ball, goo, { p: [0, 0.25, 0], s: [0.36, 0.28, 0.36] }, body);
    mesh(G.ball, M('#3a8a2a'), { p: [0, 0.18, 0], s: [0.2, 0.15, 0.2] }, body);
    for (const s of [-1, 1]) { mesh(G.ball, M('#ffffff'), { p: [s * 0.11, 0.33, 0.27], s: 0.06 }, body); mesh(G.ball, M('#141414'), { p: [s * 0.11, 0.33, 0.32], s: 0.03 }, body); }
  } else if (type === 'murcielago') {
    const fur = M('#4a3a5a'), wing = new THREE.MeshStandardMaterial({ color: '#2e2438', roughness: 0.8, side: THREE.DoubleSide });
    mesh(G.ball, fur, { p: [0, 0, 0], s: [0.13, 0.15, 0.13] }, body);
    for (const s of [-1, 1]) { mesh(G.cone, fur, { p: [s * 0.07, 0.16, 0.02], s: [0.04, 0.1, 0.04] }, body); mesh(G.ball, M('#ff4a3a', { emissive: '#ff2010', emissiveIntensity: 0.8 }), { p: [s * 0.05, 0.04, 0.11], s: 0.025 }, body); }
    const wings = [-1, 1].map(s => {
      const g = new THREE.Group(); g.position.set(s * 0.1, 0.02, 0); body.add(g);
      const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.lineTo(0.45, 0.12); shape.lineTo(0.38, -0.05); shape.lineTo(0.28, 0.02); shape.lineTo(0.2, -0.1); shape.lineTo(0.1, 0); shape.lineTo(0, -0.08);
      const w = new THREE.Mesh(new THREE.ShapeGeometry(shape), wing); w.scale.x = s; w.rotation.x = -Math.PI / 2; w.castShadow = true; g.add(w);
      return g;
    });
    root.userData.wings = wings;
  } else {   // esqueleto
    const bone = M('#e8e2d0'), dark = M('#2a2420');
    mesh(G.ball, bone, { p: [0, 1.0, 0], s: [0.2, 0.22, 0.2] }, body);
    for (const s of [-1, 1]) mesh(G.ball, dark, { p: [s * 0.07, 1.02, 0.16], s: 0.045 }, body);
    mesh(G.cyl, bone, { p: [0, 0.68, 0], s: [0.03, 0.4, 0.03] }, body);
    for (let i = 0; i < 4; i++) mesh(G.cyl, bone, { p: [0, 0.8 - i * 0.08, 0.02], s: [0.13 - i * 0.012, 0.025, 0.08], r: [0, 0, 0] }, body);
    mesh(G.ball, bone, { p: [0, 0.46, 0], s: [0.13, 0.06, 0.09] }, body);
    const legs = [-1, 1].map(s => { const g = new THREE.Group(); g.position.set(s * 0.08, 0.46, 0); mesh(G.cyl, bone, { p: [0, -0.22, 0], s: [0.025, 0.44, 0.025] }, g); body.add(g); return g; });
    const arms = [-1, 1].map(s => { const g = new THREE.Group(); g.position.set(s * 0.17, 0.86, 0); mesh(G.cyl, bone, { p: [0, -0.2, 0], s: [0.02, 0.4, 0.02] }, g); body.add(g); return g; });
    root.userData.limbs = { legs, arms };
  }
  root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  root.userData.body = body;
  return root;
}
function animateMonster(m, e, dt, t) {
  const u = m.root.userData;
  m.phase += dt * (4 + m.speed * 5);
  // (a job's guard asleep, missions/strongbox.js: the slime flattened and breathing slowly, the skeleton sitting slumped on
  // the ground; k eases into it and out of it)
  const k = u.sleepK = (u.sleepK || 0) + ((e.sleep ? 1 : 0) - (u.sleepK || 0)) * Math.min(1, dt * 2.5);
  if (k > 0.02 && e.type !== 'murcielago') {
    const b = Math.sin(t * 1.3 + m.phase * 0.01) * 0.025;
    if (e.type === 'limo') { u.body.scale.set(1 + 0.2 * k, 1 - 0.36 * k + b, 1 + 0.2 * k); u.body.position.y = 0; }
    else {
      u.body.position.y = -0.43 * k; u.body.rotation.x = 0.32 * k + b;
      for (const L of u.limbs.legs) L.rotation.x = -1.45 * k;
      u.limbs.arms[0].rotation.x = u.limbs.arms[1].rotation.x = -0.35 * k; u.limbs.arms[0].rotation.z = 0.15 * k; u.limbs.arms[1].rotation.z = -0.15 * k;
    }
    if (k > 0.5) return;
  } else if (u.sleepK !== undefined && e.type === 'esqueleto') { u.body.position.y = 0; u.body.rotation.x = 0; u.limbs.arms[0].rotation.z = u.limbs.arms[1].rotation.z = 0; }
  if (e.type === 'limo') { const s = Math.sin(m.phase * 1.5); u.body.scale.set(1 + s * 0.08, 1 - s * 0.12, 1 + s * 0.08); u.body.position.y = Math.max(0, s) * 0.12 * Math.min(1, m.speed); }
  else if (e.type === 'murcielago') { const f = Math.sin(t * 22 + m.phase) * 0.9; u.wings[0].rotation.z = f; u.wings[1].rotation.z = -f; }
  else { const k = Math.min(1, m.speed), s = Math.sin(m.phase) * 0.7 * k; u.limbs.legs[0].rotation.x = s; u.limbs.legs[1].rotation.x = -s; u.limbs.arms[0].rotation.x = -s - 0.3; u.limbs.arms[1].rotation.x = s - 0.3; }
}

// ---------- caballo y barca ----------
const OAR_DIP = 0.4;   // lo que bajan los remos hacia el agua desde el horizontal (rad): la pala queda dentro
export function boatModel() {
  // The rowing boat: the clinker hull of places3d.js (rowBoatGeo), its bow to +z, and its two oars, that the rower moves. Its
  // geometry and material are its own (they go with it)
  const root = new THREE.Group(), G = rowBoatGeo(), M = mat({ vertexColors: true, roughness: 0.85 });
  root.add(new THREE.Mesh(G.hull, M));
  for (const s of [-1, 1]) {
    const oar = new THREE.Group();
    oar.add(new THREE.Mesh(s < 0 ? G.oar : G.oar.clone(), M));
    oar.position.set(s * 0.5, 0.5, 0); oar.rotation.z = s * (Math.PI / 2 - OAR_DIP); oar.userData.side = s;
    root.add(oar); (root.userData.oars ||= []).push(oar);
  }
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return root;
}

// ---------- herramientas ----------
// Las herramientas en la mano: el mango va a lo largo de +y desde el puño y las cabezas son perfiles
// extruidos (hoja del hacha, media luna del pico, hoja de la guadaña, pala de la azada, hoja de la espada),
// con el filo de un tono más claro (un poco más grueso que la cabeza, para que asome por las dos caras). Las de metal brillan.
const SHAPES = new Map();
// Un perfil (lista de órdenes de THREE.Shape) extruido con su grosor, centrado en z
function profile(key, draw, depth, bevel = 0.004) {
  if (!SHAPES.has(key)) {
    const sh = new THREE.Shape();
    draw(sh);
    const geo = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 10 });
    geo.translate(0, 0, -depth / 2);
    geo.computeVertexNormals();
    SHAPES.set(key, geo);
  }
  return SHAPES.get(key);
}
const AXE = sh => { sh.moveTo(-0.04, -0.045); sh.lineTo(0.03, -0.035); sh.quadraticCurveTo(0.08, -0.06, 0.125, -0.115); sh.quadraticCurveTo(0.175, 0, 0.125, 0.115); sh.quadraticCurveTo(0.08, 0.06, 0.03, 0.035); sh.lineTo(-0.04, 0.045); sh.lineTo(-0.04, -0.045); };
const AXE_EDGE = sh => { sh.moveTo(0.125, -0.115); sh.quadraticCurveTo(0.175, 0, 0.125, 0.115); sh.quadraticCurveTo(0.152, 0, 0.11, -0.1); };
const PICK = sh => { sh.moveTo(-0.27, -0.07); sh.quadraticCurveTo(-0.13, 0.06, 0, 0.05); sh.quadraticCurveTo(0.13, 0.06, 0.27, -0.07); sh.quadraticCurveTo(0.12, -0.005, 0, -0.025); sh.quadraticCurveTo(-0.12, -0.005, -0.27, -0.07); };
const SCYTHE = sh => { sh.moveTo(-0.01, 0.025); sh.quadraticCurveTo(0.24, 0.07, 0.5, -0.09); sh.quadraticCurveTo(0.27, -0.005, -0.01, -0.03); sh.lineTo(-0.01, 0.025); };
const SCYTHE_EDGE = sh => { sh.moveTo(0.5, -0.09); sh.quadraticCurveTo(0.27, -0.005, -0.01, -0.03); sh.lineTo(-0.01, -0.018); sh.quadraticCurveTo(0.27, 0.01, 0.5, -0.09); };
// The claw hammer, seen from its side (its face to x+, as an axe's edge): the cheek with the neck of its face, and one prong
// of the claw (two, side by side, with a gap between)
const HAMMER_CHEEK = sh => { sh.moveTo(-0.03, -0.021); sh.lineTo(0.026, -0.021); sh.quadraticCurveTo(0.04, -0.014, 0.058, -0.014); sh.lineTo(0.058, 0.014); sh.quadraticCurveTo(0.04, 0.014, 0.026, 0.023); sh.lineTo(-0.03, 0.025); sh.lineTo(-0.03, -0.021); };
const HAMMER_CLAW = sh => { sh.moveTo(-0.026, 0.025); sh.quadraticCurveTo(-0.08, 0.03, -0.122, -0.026); sh.lineTo(-0.114, -0.031); sh.quadraticCurveTo(-0.076, 0.004, -0.026, -0.016); sh.lineTo(-0.026, 0.025); };
const HOE = sh => { sh.moveTo(-0.075, 0); sh.lineTo(0.075, 0); sh.lineTo(0.06, 0.13); sh.lineTo(-0.06, 0.13); sh.lineTo(-0.075, 0); };
const BLADE = sh => { sh.moveTo(-0.028, 0); sh.lineTo(0.028, 0); sh.lineTo(0.028, 0.47); sh.lineTo(0, 0.56); sh.lineTo(-0.028, 0.47); sh.lineTo(-0.028, 0); };
// La pala: la hoja con los hombros rectos (donde se pisa) y la punta redondeada, y su filo, una franja a lo largo de la punta
const SPADE = sh => { sh.moveTo(-0.03, -0.035); sh.lineTo(0.03, -0.035); sh.lineTo(0.105, 0.012); sh.lineTo(0.115, 0.19); sh.quadraticCurveTo(0.105, 0.285, 0, 0.31); sh.quadraticCurveTo(-0.105, 0.285, -0.115, 0.19); sh.lineTo(-0.105, 0.012); sh.lineTo(-0.03, -0.035); };
const SPADE_EDGE = sh => { sh.moveTo(0.115, 0.19); sh.quadraticCurveTo(0.105, 0.285, 0, 0.31); sh.quadraticCurveTo(-0.105, 0.285, -0.115, 0.19); sh.lineTo(-0.1, 0.19); sh.quadraticCurveTo(-0.09, 0.27, 0, 0.292); sh.quadraticCurveTo(0.09, 0.27, 0.1, 0.19); sh.lineTo(0.115, 0.19); };
// El montón de tierra de la pala llena: una bola de caras deformada (terrones), aplastada sobre la hoja. Una vez
let DIRT_GEO = null;
function dirtGeo() {
  if (DIRT_GEO) return DIRT_GEO;
  const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + 0.18 * Math.sin(v.x * 7.1 + v.y * 3.3) * Math.sin(v.z * 5.7 - v.y * 2.1);
    p.setXYZ(i, v.x * k, v.y * k, Math.max(-0.35, v.z) * k);
  }
  g.computeVertexNormals();
  return (DIRT_GEO = g);
}

// El arco: dos palas curvas, con la empuñadura en la mano, y la cuerda en dos tramos, que se tiran hacia atrás al tensar
// (pullBow). La flecha, solo tensándolo. Mira hacia z+
const BOW_END = [0.46, -0.13];   // (la punta de arriba: y, z)
function bowModel() {
  const g = new THREE.Group(), wood = M('#7a4e2c'), grip = M('#3a2416'), line = M('#efe6d4');
  const curve = new THREE.CatmullRomCurve3([[0, -0.46, -0.13], [0, -0.3, 0.02], [0, 0, 0.08], [0, 0.3, 0.02], [0, 0.46, -0.13]].map(v => new THREE.Vector3(...v)));
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 18, 0.018, 6), wood));
  mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.13, 8), grip, { p: [0, 0, 0.08] }, g);
  const seg = () => mesh(new THREE.CylinderGeometry(0.005, 0.005, 1, 4), line, { p: [0, 0, 0] }, g), arrow = new THREE.Group();
  mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.62, 6), M('#b08a58'), { p: [0, 0, 0.31], r: [Math.PI / 2, 0, 0] }, arrow);
  mesh(new THREE.ConeGeometry(0.022, 0.07, 6), M('#8a9098'), { p: [0, 0, 0.65], r: [Math.PI / 2, 0, 0] }, arrow);
  g.add(arrow);
  g.userData.bow = { up: seg(), down: seg(), arrow };
  pullBow(g, 0);
  return g;
}
// Tensar el arco que haya en este grupo: k de 0 (suelto) a 1
export function pullBow(root, k) {
  let bow = null;
  root.traverse(o => { if (o.userData.bow) bow = o.userData.bow; });
  if (!bow || bow.k === k) return;
  bow.k = k;
  const [y, z] = BOW_END, back = z - 0.3 * k, len = Math.hypot(y, back - z), ang = Math.atan2(back - z, y);
  // (cada tramo, del extremo al punto del que se tira)
  bow.up.position.set(0, y / 2, (z + back) / 2); bow.up.rotation.x = ang; bow.up.scale.y = len;
  bow.down.position.set(0, -y / 2, (z + back) / 2); bow.down.rotation.x = -ang; bow.down.scale.y = len;
  bow.arrow.visible = k > 0.01; bow.arrow.position.set(0, 0, back);
}

// La comida o la bebida que se lleva en la mano: el modelo de food3d.js, en la palma y algo más grande que de verdad
function foodInHand(id) {
  const f = foodModel(id);
  if (!f) return null;
  const g = new THREE.Group(); f.scale.setScalar(1.25); f.position.set(0, -0.03, 0.03); g.add(f);
  return g;
}
const SEATS = new Set(['silla', 'taburete', 'sofa', 'sillon', 'barber_chair', 'pew']);
// Is the screen dark (a door, a jump, sleeping)?
let FADE = null;
const covered = () => typeof document !== 'undefined' && !!(FADE ||= document.getElementById('fade'))?.classList.contains('on');
// The swap that waits for an idle moment (Actors.later): s before it is done anyway, standing still or out of sight, and at most
const LATER_STILL = 45, LATER_MAX = 600;
// The look without what may wait: the backpack (as bodyKey), the growth steps and the wear of the clothes; once per look
const CALM_KEYS = new WeakMap();
function calmKey(look) {
  let k = CALM_KEYS.get(look);
  if (k === undefined) {
    const { hairGrow, beardGrow, wear, ...rest } = look, w = wear && {};
    if (wear) for (const s in wear) if (s !== 'espalda') { const it = wear[s]; w[s] = it && it.r !== undefined ? { ...it, r: undefined } : it; }
    CALM_KEYS.set(look, (k = JSON.stringify([rest, w])));
  }
  return k;
}
// El aspecto sin la mochila (para no rehacer la persona si solo cambia eso), una vez por look
const BODY_KEYS = new WeakMap();
function bodyKey(look) {
  let k = BODY_KEYS.get(look);
  if (k === undefined) BODY_KEYS.set(look, (k = JSON.stringify(look.wear?.espalda ? { ...look, wear: { ...look.wear, espalda: undefined } } : look)));
  return k;
}
// The tools as they go on the body (kit3d.js bakeStowed), one geometry per id, made the first time: never released
// (about a dozen small ones), so whoever places them clones them first (buildKit)
const STOWED = new Map();
export function stowedGeo(id) {
  if (!STOWED.has(id)) { const model = toolModel(ITEMS[id]?.empty || id); STOWED.set(id, model ? bakeStowed(model, kindOf(id)) : null); }
  return STOWED.get(id);
}
// The same on any person (the inventory's preview, which has no hand: everything shows)
export function kitOn(P, ids) {
  const shown = shownOf(placeKit(ids, { bag: !!P.bag }), null);
  P.setKit(shown.length ? buildKit(shown, P.bagFit(), P.beltFit(), stowedGeo, { bag: !!P.bag }) : {});
}
export function toolModel(id) {
  const def = ITEMS[id];
  if (!def || !(def.tool || def.weapon || def.bow)) return null;
  if (def.bow) return bowModel();
  const tier = def.tier || 4, base = def.weapon ? (def.weapon > 3 ? '#f0c840' : '#c8d0d8') : TIERS[tier]?.head || '#b8c2ce';
  const metal = def.weapon || tier >= 3, flat = !metal;
  const head = mat({ color: base, metalness: metal ? 0.65 : 0, roughness: metal ? 0.32 : 0.85, flatShading: flat });
  const edge = mat({ color: '#' + new THREE.Color(base).lerp(new THREE.Color('#ffffff'), metal ? 0.45 : 0.25).getHexString(), metalness: metal ? 0.8 : 0, roughness: metal ? 0.2 : 0.7, flatShading: flat });
  const wood = M('#7a4e2c'), grip = M('#4a2e1c'), g = new THREE.Group();
  const at = (geo, m, p, r = [0, 0, 0], s = [1, 1, 1]) => mesh(geo, m, { p, r, s }, g);
  // Mango: algo más grueso abajo, con la empuñadura forrada y un remate
  const haft = (len, r = 0.022) => {
    at(new THREE.CylinderGeometry(r * 0.9, r * 1.1, len, 8), wood, [0, len / 2 - 0.1, 0]);
    at(new THREE.CylinderGeometry(r * 1.25, r * 1.25, 0.13, 8), grip, [0, -0.03, 0]);
    at(G.ball, grip, [0, -0.1, 0], [0, 0, 0], [r * 1.4, r * 1.1, r * 1.4]);
    return len - 0.1;   // dónde acaba
  };
  const kind = def.weapon ? 'espada' : def.tool;
  if (kind === 'hacha') {
    const top = haft(0.62), y = top - 0.07;
    at(profile('axe', AXE, 0.034), head, [0.012, y, 0]);
    at(profile('axeEdge', AXE_EDGE, 0.04, 0.003), edge, [0.012, y, 0]);
  } else if (kind === 'pico') {
    const top = haft(0.62), y = top - 0.04;
    at(profile('pick', PICK, 0.036), head, [0, y, 0]);
    at(new THREE.CylinderGeometry(0.034, 0.034, 0.09, 8), head, [0, y, 0]);
    for (const sx of [-1, 1]) at(G.cone, edge, [sx * 0.262, y - 0.068, 0], [0, 0, sx * 2.25], [0.018, 0.05, 0.018]);
  } else if (kind === 'hammer') {
    // A carpenter's hammer: the ash handle, swelling at the grip, through the eye of the head; the round face and the claw
    const top = haft(0.4, 0.02), y = top - 0.03;
    at(new THREE.CylinderGeometry(0.0135, 0.018, 0.1, 8), wood, [0, top - 0.08, 0]);
    at(profile('hammerCheek', HAMMER_CHEEK, 0.034), head, [0, y, 0], [0, 0, 0], [1.2, 1.2, 1.1]);
    at(new THREE.CylinderGeometry(0.024, 0.019, 0.032, 14), head, [0.084, y, 0], [0, 0, -Math.PI / 2]);
    at(new THREE.CylinderGeometry(0.0255, 0.025, 0.013, 14), edge, [0.105, y, 0], [0, 0, -Math.PI / 2]);
    for (const sz of [-1, 1]) at(profile('hammerClaw', HAMMER_CLAW, 0.011, 0.003), head, [0, y, sz * 0.0125], [0, sz * -0.07, 0], [1.2, 1.2, 1.1]);
    at(new THREE.BoxGeometry(0.026, 0.012, 0.02), wood, [0, top + 0.004, 0]);   // (the end of the handle, showing through the eye)
  } else if (kind === 'guadana') {
    const top = haft(0.9, 0.02);
    at(new THREE.CylinderGeometry(0.016, 0.016, 0.12, 6), wood, [0, 0.32, 0.06], [Math.PI / 2, 0, 0]);   // asidero
    at(G.ball, grip, [0, 0.32, 0.125], [0, 0, 0], 0.022);
    at(profile('scythe', SCYTHE, 0.012, 0.003), head, [0, top - 0.02, 0]);
    at(profile('scytheEdge', SCYTHE_EDGE, 0.016, 0.002), edge, [0, top - 0.02, 0]);
    at(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 8), head, [0, top - 0.02, 0]);
  } else if (kind === 'azada') {
    const top = haft(0.66);
    at(new THREE.CylinderGeometry(0.03, 0.03, 0.07, 8), head, [0, top - 0.02, 0]);
    at(new THREE.CylinderGeometry(0.012, 0.012, 0.09, 6), head, [0, top - 0.01, 0.04], [Math.PI / 2, 0, 0]);
    const plate = at(profile('hoe', HOE, 0.016), head, [0, top - 0.02, 0.09], [Math.PI - 0.35, 0, 0]);
    at(profile('hoeEdge', sh => { sh.moveTo(-0.075, 0); sh.lineTo(0.075, 0); sh.lineTo(0.073, 0.018); sh.lineTo(-0.073, 0.018); sh.lineTo(-0.075, 0); }, 0.022, 0.002), edge, plate.position.toArray(), [Math.PI - 0.35, 0, 0]);
  } else if (kind === 'pala') {
    // Mango largo con el puño en T, el cuello de hierro y la hoja, algo cóncava; llena, con su montón de tierra encima (en la
    // cara +z, la que queda arriba en la mano: ver el giro de abajo)
    const top = haft(0.8, 0.02);
    at(new THREE.CylinderGeometry(0.018, 0.018, 0.13, 8), grip, [0, -0.1, 0], [0, 0, Math.PI / 2]);   // (el travesaño del puño)
    at(new THREE.CylinderGeometry(0.024, 0.03, 0.12, 8), head, [0, top - 0.02, 0]);
    at(profile('spade', SPADE, 0.01, 0.003), head, [0, top + 0.07, 0], [0.12, 0, 0]);
    at(profile('spadeEdge', SPADE_EDGE, 0.014, 0.002), edge, [0, top + 0.07, 0], [0.12, 0, 0]);
    if (def.empty) {
      const soilM = mat({ color: '#5a4532', roughness: 1, flatShading: true }), crumb = mat({ color: '#6e5740', roughness: 1, flatShading: true });
      at(dirtGeo(), soilM, [0, top + 0.2, 0.06], [0.25, 0.4, 0], [0.125, 0.14, 0.1]);
      at(dirtGeo(), soilM, [0.02, top + 0.27, 0.1], [1.1, 0.3, 0.5], [0.07, 0.065, 0.06]);
      for (const [x, y, s] of [[0.08, 0.12, 0.032], [-0.085, 0.16, 0.028], [0.035, 0.31, 0.024], [-0.04, 0.09, 0.022]]) at(dirtGeo(), crumb, [x, top + y, (y - 0.07) * 0.12 + 0.012 + s * 0.4], [x * 9, y * 7, 0], s);
    }
  } else if (kind === 'espada') {
    const gold = def.weapon > 3, brass = M(gold ? '#c8962a' : '#8a6a3a', { metalness: 0.6, roughness: 0.35 });
    at(new THREE.CylinderGeometry(0.02, 0.022, 0.13, 8), grip, [0, 0.0, 0]);
    at(G.ball, brass, [0, -0.08, 0], [0, 0, 0], 0.03);
    at(G.cyl, brass, [0, 0.075, 0], [0, 0, 0], [0.1, 0.022, 0.028]);
    for (const sx of [-1, 1]) at(G.ball, brass, [sx * 0.1, 0.075, 0], [0, 0, 0], 0.02);
    at(profile('blade', BLADE, 0.008, 0.006), head, [0, 0.085, 0]);
  } else if (kind === 'regadera') {
    // Se lleva colgando del asa: el cuerpo, el caño con su alcachofa y el asa
    const tin = M('#7a9ab0', { metalness: 0.55, roughness: 0.35 }), dark = M('#5a7a8e', { metalness: 0.5, roughness: 0.4 });
    at(new THREE.CylinderGeometry(0.085, 0.095, 0.17, 14), tin, [0, -0.17, 0.02]);
    at(new THREE.TorusGeometry(0.085, 0.008, 4, 16), dark, [0, -0.085, 0.02], [Math.PI / 2, 0, 0]);
    at(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, -0.21, 0.1), new THREE.Vector3(0, -0.16, 0.22), new THREE.Vector3(0, -0.07, 0.29)), 8, 0.012, 6), tin, [0, 0, 0]);
    at(new THREE.CylinderGeometry(0.03, 0.012, 0.04, 10), dark, [0, -0.06, 0.305], [0.7, 0, 0]);
    at(new THREE.TorusGeometry(0.07, 0.01, 4, 12, Math.PI), dark, [0, -0.085, 0.02], [0, Math.PI / 2, 0]);
    g.rotation.x = -0.15;
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  } else if (kind === 'cana') {
    // Caña: empuñadura de corcho, carrete y una vara que se afina hasta la punta (de ahí sale el sedal)
    at(new THREE.CylinderGeometry(0.02, 0.022, 0.16, 8), M('#c8a070'), [0, 0, 0]);
    at(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 12), M('#3a3a40', { metalness: 0.5, roughness: 0.4 }), [0.035, 0.1, 0], [0, 0, Math.PI / 2]);
    const fiber = (def.tier || 1) > 1;   // la de fibra: vara azul oscura con anillas doradas
    // (the shaft in ten rings of its own, so that it bends: fishing3d.js moves them, the guides and the tip)
    const shaft = at(new THREE.CylinderGeometry(0.004, 0.014, 1.3, 6, 10), M(fiber ? '#22344e' : '#5a3a24', fiber ? { roughness: 0.35 } : undefined), [0, 0.73, 0]), tip = new THREE.Object3D();
    const guides = [0.4, 0.75, 1.1].map(y => at(new THREE.TorusGeometry(0.012, 0.003, 4, 8), M(fiber ? '#e8c050' : '#d8d8d8', { metalness: 0.6 }), [0, y, 0.012], [0, Math.PI / 2, 0]));
    shaft.name = 'rodShaft'; tip.name = 'tip'; tip.position.set(0, 1.38, 0); g.add(tip);
    guides.forEach((o, i) => { o.name = 'guide' + i; });
    g.rotation.x = 0.5;
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  } else if (kind === 'red') {
    const top = haft(0.72, 0.018), ring = M('#b8a888', { metalness: 0.3 });
    at(new THREE.TorusGeometry(0.13, 0.009, 4, 18), ring, [0, top + 0.13, 0]);
    const net = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.24, 14, 1, true), mat({ color: '#f4f0e4', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    net.position.set(0, top + 0.13, -0.12); net.rotation.x = -Math.PI / 2; g.add(net);
  } else haft(0.5);
  g.rotation.x = Math.PI / 2 - 0.3;   // en la mano, hacia delante
  if (kind === 'pala') g.rotation.y = Math.PI;   // (la pala, con la cara de la tierra hacia arriba)
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
