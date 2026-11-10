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
import { screenToWorld, screenDirOf } from '../camera.js';
import { ITEMS, TIERS } from '../items.js';
import { WATER_Y } from './terrain.js';
import { animalModel, animalKey, animateAnimal, horseModel, animateHorse } from './animals.js';
import { nearX } from '../world/planet.js';
import { RealPerson, realBaby, prebuildReal, realStats } from './realperson.js';

// Agachado: cuánto se adelantan los muslos y se doblan las rodillas (rad), cuánto baja el cuerpo (m: lo que suben
// los pies al doblar las piernas, para que sigan en el suelo) y se echa hacia delante (rad; la cabeza lo compensa
// para seguir mirando al frente)
const CROUCH = { hip: 1.5, knee: 2.5, drop: 0.11, lean: 0.4 };
// (asientos, camas y barca se calibraron con los muñecos de antes: la persona realista se ajusta a esas medidas. La
// cadera de aquel muñeco sentado, lo que medía tumbado y la escala de sus niños; no cambiarlas sin recolocar muebles)
const SEAT_HIP = 0.36, LIE_LEN = 1.36, KID_REF = 0.66;
const LOOK_R = 2.6;      // a qué distancia se mira a quien se tiene al lado
const BUILD_MS = 6;      // lo que se puede ir en hacer modelos nuevos en un fotograma
// Las personas, según lo que miden en pantalla (px de alto, en píxeles CSS: no le afecta la resolución automática). Con la
// cámara de siempre (fov 30, 22 m) una persona mide unos 2 260/d px: a todo hasta unos 25 m, a 30 Hz hasta unos 56 m y a
// 15 Hz más allá; de lejos (LOD1, sin dedos ni ojos) desde unos 38 m, y vuelve a cerca por debajo de unos 31 m. Las
// cifras de subir son un 10 % más que las de bajar, para que no cambie a cada momento en el borde
const TIER_PX = [[90, 81], [40, 36]];      // [para subir, para seguir]: a todo; a 30 Hz; si no, a 15 Hz
const BONE_DT = [0, 1 / 30, 1 / 15, Infinity];   // cada cuánto se posan los huesos en cada nivel (3: fuera de la vista)
const LOD_PX = [60, 72];                   // de lejos por debajo de 60 px; de cerca otra vez por encima de 72
const LOD_GAP = 0.6;                       // segundos, como poco, entre dos cambios de detalle de la misma persona
// ?personas=todas: todas a todo (sin dormidas, sin LOD1 y animadas en cada fotograma), para comparar
const ALL = typeof location !== 'undefined' && new URLSearchParams(location.search).get('personas') === 'todas';
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
  playerMaterials(body = false) { return (body ? this.player?.body : this.player?.mats) || []; }

  update(game, scene, dt, t) {
    const seen = new Set(), p = game.player && game.scene ? game.player : null;
    this.time += dt;
    this.prepView(scene);
    this.prewarm(game);
    const list = [...(scene.entities || [])];
    if (game.player && game.scene === scene) for (const s of game.systems) { const more = s.entities?.(scene); if (more) list.push(...more); }
    if (p) list.unshift(p);
    this.around = list; this.me = p; this.game = game;   // (para mirar a quien se tiene al lado)
    const wait = [];   // personas y bebés por hacer, si no caben en este fotograma (ver BUILD_MS)
    for (const e of list) {
      if (!e || seen.has(e)) continue;
      seen.add(e);
      let m = this.models.get(e);
      // (el jugador y los demás jugadores, con la ropa que llevan: si se ponen o se quitan algo, se rehace su persona)
      const look = e === p ? game.appearance() : e.look;
      if (m && (e === p || e.remote) && m.look !== look) { this.drop(e, m); m = null; }
      if (m?.kind === 'animal' && m.key !== animalKey(e)) { this.drop(e, m); m = null; }
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
    if (wait.length) {
      if (p) { const d = e => Math.hypot((scene.kind === 'world' ? nearX(e.x, p.x) : e.x) - p.x, e.y - p.y); wait.sort((a, b) => d(a) - d(b)); }
      const t0 = performance.now();
      for (const e of wait) {
        if (e !== wait[0] && performance.now() - t0 > BUILD_MS) break;
        const m = this.add(e, false, e.look);
        if (m) this.place(m, e, scene, dt, t, p, game);
      }
    }
    for (const [e, m] of this.models) if (!seen.has(e)) this.drop(e, m);
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
      m.root.traverse(o => {
        if (o.userData.solid) o.material.dispose();
        if (o.isSprite) { o.material.map?.dispose(); o.material.dispose(); }
      });
      // (de espectador, la barca lleva clones, ya soltados arriba: los suyos de verdad están en userData.solid)
      m.boat?.traverse(o => { if (o.isMesh) { o.geometry.dispose(); if (o.userData.solid) o.userData.solid.dispose(); else if (!m.mats) o.material.dispose(); } });
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
    SPH.radius = (lying ? h : h * 0.75) + shLen * 0.5 + (m.horse?.visible || m.boat?.visible ? 1.3 : 0);
    const d = cam.position.distanceTo(V3.set(x, cy, z));
    const near = me ? Math.hypot(x - me.x, z - me.y) : Infinity, cerca = near < 4 || (e.remote && near < 12);
    // (más allá de la niebla ya es de su color; los demás jugadores no, que llevan su nombre encima. La niebla de Three va
    // por la profundidad en la vista, no por la distancia: en los lados de la pantalla, alguien más lejos aún se ve)
    const fogged = !e.remote && V3.sub(cam.position).dot(CAMDIR) > this.fogFar + 4;
    if (!cerca && (fogged || !FR.intersectsSphere(SPH))) return (m.tier = 3);
    const px = h * this.pxK / Math.max(0.1, d);
    const reg = this.regionOf?.get(`${Math.floor(e.x)},${Math.floor(e.y)}`);
    const tapada = !!reg && reg !== this.inRegion;   // bajo un tejado que no es el tuyo: se ve por ventanas y puertas
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
    const one = () => { for (let it; (it = this.warm.shift());) { try { if (prebuildReal(it[0], it[1])) return; } catch (err) { /* (la hará al verla) */ } } };
    if (typeof document !== 'undefined' && document.getElementById('fade')?.classList.contains('on')) { one(); return; }
    if (this.warmIdle || typeof requestIdleCallback !== 'function') return;
    this.warmIdle = true;
    requestIdleCallback(dl => { this.warmIdle = false; if (dl.timeRemaining() > 40) one(); });
  }

  add(e, isPlayer, look) {
    const m = this.make(e, isPlayer, look);
    if (m) { m.look = look; this.models.set(e, m); this.group.add(m.root); }
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
    if (m.speed < 0.6 && !e.mount && !e.boat && !e.aboard) {
      let best = null, bd = LOOK_R;
      for (const o of this.around || []) {
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
      if (e.kid) root.rotation.order = 'YXZ';   // (la persona ya es de niño: ver realperson.js)
      if (isPlayer || e.remote) {
        // Con algo en la mano, caballo y barca (el jugador, además, con sus propios materiales para dibujar
        // su silueta, y en la capa 2; los demás jugadores, con su nombre encima)
        m.hand = new THREE.Group();
        m.hand.position.set(0, -0.07, 0.03); person.hand.add(m.hand);   // (en el hueso de la mano derecha)
        // (las herramientas se hicieron para la mano izquierda: en la derecha, reflejadas, para que apunten hacia fuera)
        m.hand.scale.x = -1;
        m.horse = horseModel(); m.horse.visible = false; root.add(m.horse);
        m.boat = boatModel(); m.boat.visible = false; root.add(m.boat);
        if (e.remote) root.add(nameTag(e.name));
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
    if (ANIMALS[e.type]) return { kind: 'animal', root: animalModel(e.type, e.breed, e.bags), key: animalKey(e), prev: null, speed: 0, phase: Math.random() * 6 };
    if (MONSTERS[e.type]) return { kind: 'monster', root: monsterModel(e.type), prev: null, speed: 0, phase: Math.random() * 6 };
    return null;
  }

  pose(m, e, scene, dt, t, game) {
    const view = this.view, x = this.me && scene.kind === 'world' ? nearX(e.x, this.me.x) : e.x, z = e.y;   // (lo del otro lado de la costura del planeta, a este lado)
    // Velocidad (para animar) a partir de lo que se ha movido
    const d = m.prev ? Math.hypot(x - m.prev[0], z - m.prev[1]) : 0;
    m.prev = [x, z];
    const v = dt > 0 ? Math.min(8, d / dt) : 0;
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
    // (sentado en una silla que aquí no está: otro jugador que la ve donde aquí no hay ninguna; mejor en el suelo que en el aire)
    if (pz?.kind === 'sit' && e.remote && scene.placedNear) {
      if (!m.seatAt || m.seatAt.t < t - 0.5 || m.seatAt.x !== x || m.seatAt.z !== z) m.seatAt = { t, x, z, ok: scene.placedNear(x, z, 1).some(o => SEATS.has(o.placed) && Math.hypot(o.x - x, o.y - z) < 0.7) };
      if (!m.seatAt.ok) pz = { kind: 'floorSit', yaw: pz.yaw, h: -0.28 };
    }
    const lying = pz ? pz.kind === 'lie' || pz.kind === 'floorLie' : e.lying;
    if (pz) m.speed = 0;   // (sentado o tumbado, quieto)
    if (e.kid || m.kind === 'person') {   // (tumbados, boca arriba, con la cabeza hacia la almohada; sentados, más abajo)
      m.root.rotation.order = 'YXZ';
      m.root.rotation.x = lying ? -Math.PI / 2 : 0;
      m.root.rotation.y = lying ? (pz ? pz.yaw : e.yaw || 0) : 0;
      y += pz ? pz.h : lying ? e.h || 0 : 0;
      if (pz && !lying && m.person) y += SEAT_HIP * (m.person.kid ? KID_REF : 1) - m.person.hipY;   // (con la cadera en el asiento)
    }
    if (m.kind === 'person') {
      const P = m.person;
      if ((e.kid && e.lying) || (pz && lying)) { P.facing = 0; P.root.rotation.y = 0; }
      // (tumbada, se corre hacia los pies lo que mide de más que la cama pensada: la cabeza, en la almohada)
      P.r.root.position.y = lying ? -(P.height - LIE_LEN * (P.kid ? KID_REF : 1)) : 0;
      if ((e.kid && e.lying) || (pz && lying)) {}
      else if (pz) { P.facing = pz.yaw; P.root.rotation.y = pz.yaw; }
      else if (yaw !== null) P.facing = yaw;
      if (m.horse && m.horseCoat !== (e.horseCoat || 'castano')) {   // (el caballo del jinete, con el pelaje del suyo)
        const h = horseModel(e.horseCoat, e.horseBags);
        if (m === this.player) h.traverse(q => { if (q.isMesh) ownMesh(q, m); });
        m.root.remove(m.horse); m.root.add(h); m.horse = h; m.horseCoat = e.horseCoat || 'castano';
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
        else if (e.mount) { m.horse.rotation.y = P.root.rotation.y; animateHorse(m.horse, m.speed, t); P.root.position.y = 0.92 + seat; }
        else P.root.position.y = 0;
      }
      // Los huesos se posan en cada fotograma de cerca, y de lejos cada 1/30 o 1/15 s con el tiempo que haya pasado (ver
      // grade; desfasadas, para que no les toque a todas en el mismo fotograma). Girar, siempre: crew.js lee hacia dónde
      // mira. Todo lo que escribe en los huesos va dentro de este bloque: lo que suma (+= y -=) parte de la pose de
      // animate(), y fuera se acumularía en los fotogramas sin pose (el tronco giraría sin parar o el cuerpo se hundiría)
      P.turn(dt);
      if (e.z > 0) y += e.z;   // (saltando o encima de una roca)
      // (cómo se ve, con la altura ya puesta: alguien en lo alto de una torre, mirado allí arriba, tiene los pies a 12 m del suelo)
      const tier = this.grade(m, e, x, y + P.root.position.y, z, lying);
      m.root.visible = tier !== 3;
      m.acc = (m.acc ?? Math.random() / 15) + dt;
      const bones = m.acc >= BONE_DT[tier], bdt = bones ? Math.min(0.5, m.acc) : 0;
      if (bones) m.acc = 0;
      if (bones) this.poseBones(m, e, P, pz, lying, bdt, game);
      if (m.hand) {   // (los jugadores: la barriga, si espera un bebé; no es un hueso)
        const made = P.setBelly(this.game.family.bellyOf(e));
        if (made && m === this.player) ownMesh(made, m, true);
      }
    } else if (m.kind === 'animal') {
      if (yaw !== null) turnTo(m.root, yaw, dt);
      m.root.scale.setScalar(e.young ? 0.55 : 1);
      if (ANIMALS[e.type].swims) y = WATER_Y - 0.06 + Math.sin(t * 1.5 + x) * 0.015;
      animateAnimal(m, dt, t, e);
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

  // La pose de los huesos de una persona: andar (animate), en el aire, lo que lleva en la mano, agachada, sentada, a
  // caballo o en barca, y mirar a quien tiene al lado. dt: el tiempo desde la última pose (ver pose)
  poseBones(m, e, P, pz, lying, dt, game) {
    P.animate(dt, e.mount || e.boat || e.aboard ? 0 : m.speed);
    if (e.z - (e.floor || 0) > 0.03) {   // en el aire: con las piernas recogidas
      if (!e.mount) { const k = Math.min(1, (e.z - (e.floor || 0)) / 0.25); P.legs[0].rotation.x = -0.7 * k; P.legs[1].rotation.x = 0.35 * k; }
    }
    // (después de andar: el golpe manda sobre el balanceo del brazo)
    if (game) this.hold(m, { held: game.inv.held?.id || null, swing: game.gather.swing, swingItem: game.gather.swingItem, cooldown: game.gather.cooldown, fishPose: game.fishing?.pose(game.time), bowPull: game.archery?.k || 0 }, dt);
    else if (e.remote) this.hold(m, e, dt);
    // Agachado (Shift): las rodillas dobladas, el cuerpo más bajo y un poco echado hacia delante; andando, a pasitos
    const C = CROUCH;
    P.crouch = (P.crouch || 0) + ((e.crouch && !pz && !e.mount && !e.boat && !e.aboard ? 1 : 0) - (P.crouch || 0)) * Math.min(1, dt * 12);
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
    } else P.head.rotation.x = 0;
    if (pz && !lying) {   // sentado: los muslos hacia delante; en la silla, las piernas colgando; en el suelo, estiradas
      for (const l of P.legs) l.rotation.x = -Math.PI / 2;
      for (const k of P.shins || []) k.rotation.x = pz.kind === 'sit' ? Math.PI / 2 : 0.1;
      if (pz.kind === 'floorSit') { for (const a of P.arms) a.rotation.x = 0.45; P.torso.rotation.x = -0.12; }
      else for (const a of P.arms) a.rotation.x = -0.35;
    }
    if (e.mount || e.boat || e.aboard) { P.legs[0].rotation.x = P.legs[1].rotation.x = e.mount ? -1.1 : -1.4; P.legs[0].rotation.z = 0.5; P.legs[1].rotation.z = -0.5; for (const k of P.shins || []) k.rotation.x = e.mount ? 1.0 : 1.3; }
    else P.legs[0].rotation.z = P.legs[1].rotation.z = 0;
    this.lookAt(m, e, dt, lying);
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
    const a = m.anim, show = a ? a.item : id;
    if (m.holding !== show) {
      m.hand.clear();
      const tool = show && (toolModel(show) || foodInHand(show));
      if (tool && m.mats) tool.traverse(o => { if (o.isMesh) ownMesh(o, m, true); });
      if (tool) m.hand.add(tool);
      m.holding = show;
    }
    // (el brazo de la mano que lleva la herramienta, la derecha; los gestos se pensaron para la izquierda: de lado y
    // el giro del tronco, al revés)
    const T = P.toolArm, arm = P.arms[T], mir = T === 0 ? -1 : 1;
    arm.rotation.z = 0; m.hand.rotation.x = 0; P.torso.rotation.x = 0;
    pullBow(m.hand, g.bowPull || 0);
    // (tensando el arco: el brazo estirado y el arco de pie)
    if (g.bowPull > 0 && !a) { arm.rotation.x = -1.5; m.hand.rotation.x = 1.5; if (P.fore) P.fore[T].rotation.x = -0.1; return; }
    if ((a || g.fishPose) && P.fore) P.fore[T].rotation.x = -0.1;   // (usando algo, el brazo casi estirado)
    // (una postura fija: pescando. fishPose, no pose: pose es sentarse o tumbarse, y los demás jugadores la traen)
    if (!a) { if (g.fishPose) { arm.rotation.x = g.fishPose.arm; P.torso.rotation.x = g.fishPose.lean; } return; }
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

// Gestos al usar lo que se lleva en la mano: claves [momento (0 a 1), valor] del giro del brazo hacia delante
// (arm, negativo = levantarlo), hacia el lado (side), del tronco (twist, lean) y de la mano (tilt), y lo que
// dura en segundos. Los golpes cogen impulso por encima de la cabeza y bajan deprisa.
const GESTURES = {
  golpe: { dur: 0.42, arm: [[0, 0], [0.38, -2.7], [0.62, 0.5], [1, 0]], twist: [[0, 0], [0.38, -0.25], [0.62, 0.15], [1, 0]], lean: [[0, 0], [0.38, -0.08], [0.62, 0.18], [1, 0]], side: [[0, 0], [0.38, 0.12], [1, 0]] },
  cavar: { dur: 0.45, arm: [[0, 0], [0.4, -2.6], [0.65, 0.85], [1, 0]], twist: [[0, 0], [0.4, -0.15], [1, 0]], lean: [[0, 0], [0.4, -0.1], [0.65, 0.3], [1, 0]] },
  barrer: { dur: 0.4, arm: [[0, 0], [0.25, -1.2], [0.75, -1.15], [1, 0]], twist: [[0, 0], [0.25, 0.9], [0.72, -0.9], [1, 0]], side: [[0, 0], [0.25, -0.25], [0.72, 0.2], [1, 0]] },
  tajo: { dur: 0.36, arm: [[0, 0], [0.32, -2.4], [0.62, 0.3], [1, 0]], side: [[0, 0], [0.32, 0.5], [0.62, -0.5], [1, 0]], twist: [[0, 0], [0.32, -0.4], [0.62, 0.4], [1, 0]] },
  regar: { dur: 0.7, arm: [[0, 0], [0.25, -0.9], [0.75, -0.9], [1, 0]], tilt: [[0, 0], [0.25, 1.5], [0.75, 1.5], [1, 0]] },
  lanzar: { dur: 0.6, arm: [[0, 0], [0.3, -2.6], [0.55, -0.6], [1, 0]], twist: [[0, 0], [0.3, -0.2], [0.55, 0.1], [1, 0]] },
  mano: { dur: 0.3, arm: [[0, 0], [0.4, -1.5], [1, 0]], twist: [[0, 0], [0.4, -0.25], [1, 0]] },
};
// Cuánto levanta el brazo ahora el gesto del jugador (0 si no está usando nada)
export function swingArm(m) { const a = m?.anim; return a ? keys(GESTURES[a.kind].arm, Math.min(1, a.t / a.dur)) : 0; }
function gestureOf(id) {
  const d = id && ITEMS[id];
  if (!d) return 'mano';
  if (d.weapon) return 'tajo';
  return { hacha: 'golpe', pico: 'golpe', azada: 'cavar', guadana: 'barrer', red: 'barrer', regadera: 'regar', cana: 'lanzar' }[d.tool] || 'golpe';
}
// El valor en el momento k, suavizado entre clave y clave
function keys(list, k) {
  for (let i = 1; i < list.length; i++) {
    const [k1, v1] = list[i];
    if (k <= k1) { const [k0, v0] = list[i - 1], t = (k - k0) / (k1 - k0 || 1); return v0 + (v1 - v0) * t * t * (3 - 2 * t); }
  }
  return list[list.length - 1][1];
}

// El nombre encima de la cabeza (de los demás jugadores): se ve siempre, también a través de las paredes
function nameTag(name) {
  const c = document.createElement('canvas'), x = c.getContext('2d'), font = '600 30px "Pixelify Sans", sans-serif';
  x.font = font;
  const w = Math.ceil(x.measureText(name).width) + 26;
  c.width = w; c.height = 46;
  x.fillStyle = 'rgba(30, 20, 14, 0.72)';
  x.beginPath(); x.roundRect(0, 0, w, 46, 12); x.fill();
  x.font = font; x.fillStyle = '#ffe7b0'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(name, w / 2, 24);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
  s.scale.set(0.3 * w / 46, 0.3, 1);
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
  if (e.type === 'limo') { const s = Math.sin(m.phase * 1.5); u.body.scale.set(1 + s * 0.08, 1 - s * 0.12, 1 + s * 0.08); u.body.position.y = Math.max(0, s) * 0.12 * Math.min(1, m.speed); }
  else if (e.type === 'murcielago') { const f = Math.sin(t * 22 + m.phase) * 0.9; u.wings[0].rotation.z = f; u.wings[1].rotation.z = -f; }
  else { const k = Math.min(1, m.speed), s = Math.sin(m.phase) * 0.7 * k; u.limbs.legs[0].rotation.x = s; u.limbs.legs[1].rotation.x = -s; u.limbs.arms[0].rotation.x = -s - 0.3; u.limbs.arms[1].rotation.x = s - 0.3; }
}

// ---------- caballo y barca ----------
const OAR_DIP = 0.4;   // lo que bajan los remos hacia el agua desde el horizontal (rad): la pala queda dentro
export function boatModel() {
  // Barca de remos: casco con la proa en punta (mirando a +z), borda, fondo, dos bancos y dos remos
  const root = new THREE.Group(), wood = mat({ color: '#8a5a34', roughness: 0.8 }), dark = mat({ color: '#5e3b22', roughness: 0.8 }), inside = mat({ color: '#6a4428', roughness: 0.9 });
  const outline = (k) => { const s = new THREE.Shape(); s.moveTo(-0.55 * k, -0.95 * k); s.lineTo(0.55 * k, -0.95 * k); s.quadraticCurveTo(0.62 * k, 0.4 * k, 0, 1.15 * k); s.quadraticCurveTo(-0.62 * k, 0.4 * k, -0.55 * k, -0.95 * k); return s; };
  const hullGeo = new THREE.ExtrudeGeometry(outline(1), { depth: 0.42, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2, curveSegments: 10 });
  hullGeo.rotateX(-Math.PI / 2);   // la silueta en planta, y la altura hacia arriba
  const hull = new THREE.Mesh(hullGeo, wood); hull.position.y = -0.1; root.add(hull);
  const floorGeo = new THREE.ShapeGeometry(outline(0.86), 10); floorGeo.rotateX(-Math.PI / 2);
  const floor = new THREE.Mesh(floorGeo, inside); floor.position.y = 0.335; root.add(floor);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.035, 4, 24), dark); rim.scale.set(0.95, 1.75, 1); rim.rotation.x = Math.PI / 2; rim.position.set(0, 0.36, 0.08); root.add(rim);
  const bench = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 0.22), dark); bench.position.set(0, 0.45, -0.1); root.add(bench);
  const stern = bench.clone(); stern.position.z = -0.75; root.add(stern);   // (el del pasajero)
  for (const s of [-1, 1]) {
    const oar = new THREE.Group(), stick = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.5, 6), wood), blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.4, 0.14), wood);
    stick.position.y = -0.75; blade.position.y = -1.45; oar.add(stick, blade);
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
const HOE = sh => { sh.moveTo(-0.075, 0); sh.lineTo(0.075, 0); sh.lineTo(0.06, 0.13); sh.lineTo(-0.06, 0.13); sh.lineTo(-0.075, 0); };
const BLADE = sh => { sh.moveTo(-0.028, 0); sh.lineTo(0.028, 0); sh.lineTo(0.028, 0.47); sh.lineTo(0, 0.56); sh.lineTo(-0.028, 0.47); sh.lineTo(-0.028, 0); };

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
const SEATS = new Set(['silla', 'taburete', 'sofa', 'sillon']);
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
    at(new THREE.CylinderGeometry(0.004, 0.014, 1.3, 6), M(fiber ? '#22344e' : '#5a3a24', fiber ? { roughness: 0.35 } : undefined), [0, 0.73, 0]);
    for (const y of [0.4, 0.75, 1.1]) at(new THREE.TorusGeometry(0.012, 0.003, 4, 8), M(fiber ? '#e8c050' : '#d8d8d8', { metalness: 0.6 }), [0, y, 0.012], [0, Math.PI / 2, 0]);
    const tip = new THREE.Object3D(); tip.name = 'tip'; tip.position.set(0, 1.38, 0); g.add(tip);
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
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
