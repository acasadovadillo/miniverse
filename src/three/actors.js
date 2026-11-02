// Todo lo que se mueve: el jugador, Nilo, los vecinos y los mercaderes (personas chibi con su "look"), los
// animales del rancho (gallinas, vacas y ovejas), los monstruos de las cuevas (limos, murciélagos y
// esqueletos), el caballo y la barca. Cada entidad del juego tiene su modelo, que se crea al verla por
// primera vez y se quita cuando deja de estar. Miran hacia donde van, andan y respiran; el jugador lleva en
// la mano la herramienta elegida y la balancea al golpear. Los demás jugadores (en directo) son como él,
// con su nombre encima.
import * as THREE from 'three';
import { Person3D, babyModel, mesh, mergeInto, G, M } from './people.js';
import { mat } from './geo.js';
import { ANIMALS } from '../art/farm.js';
import { MONSTERS } from '../combat.js';
import { screenToWorld, screenDirOf } from '../camera.js';
import { ITEMS, TIERS } from '../items.js';
import { WATER_Y } from './terrain.js';

const PEOPLE = new Map();
const KID_SCALE = 0.66;   // los niños, más pequeños

export class Actors {
  constructor(view) {
    this.view = view;
    this.group = new THREE.Group();
    view.scene.add(this.group);
    this.models = new Map();      // entidad → { obj, kind, prev, … }
    this.lights = [];
    this.player = null;
  }
  // Los materiales del jugador (para su silueta); body: solo los de su cuerpo y lo que lleva en la mano
  playerMaterials(body = false) { return (body ? this.player?.body : this.player?.mats) || []; }

  update(game, scene, dt, t) {
    const seen = new Set(), p = game.player && game.scene ? game.player : null;
    const list = [...(scene.entities || [])];
    if (game.player && game.scene === scene) for (const s of game.systems) { const more = s.entities?.(scene); if (more) list.push(...more); }
    if (p) list.push(p);
    for (const e of list) {
      if (!e || seen.has(e)) continue;
      seen.add(e);
      let m = this.models.get(e);
      // (el jugador y los demás jugadores, con la ropa que llevan: si se ponen o se quitan algo, se rehace su muñeco)
      const look = e === p ? game.appearance() : e.look;
      if (m && (e === p || e.remote) && m.look !== look) { this.group.remove(m.root); this.models.delete(e); if (m === this.player) this.player = null; m = null; }
      if (m?.kind === 'animal' && m.key !== animalKey(e)) { this.group.remove(m.root); this.models.delete(e); m = null; }
      if (!m) { m = this.make(e, e === p, look); if (!m) continue; m.look = look; this.models.set(e, m); this.group.add(m.root); }
      this.pose(m, e, scene, dt, t, e === p ? game : null);
    }
    for (const [e, m] of this.models) if (!seen.has(e)) { this.group.remove(m.root); this.models.delete(e); if (m === this.player) this.player = null; }
    // En cuevas y mazmorras el jugador lleva un farol
    this.lights.length = 0;
    if (p && scene.kind === 'grid') this.lights.push({ x: p.x, y: 1.8, z: p.y, intensity: 8, range: 14, color: '#ffc880', always: true, flicker: true });
  }

  make(e, isPlayer, look = e.look) {
    if (e.baby) { const root = new THREE.Group(); root.add(babyModel(look)); return { kind: 'baby', root, prev: null, speed: 0 }; }
    if (look) {
      // (las personas con el mismo aspecto se copian de la primera: hacer una desde cero cuesta)
      const key = JSON.stringify(look);
      if (!PEOPLE.has(key)) PEOPLE.set(key, new Person3D(look, ''));
      const person = PEOPLE.get(key).clone();
      const root = new THREE.Group();
      root.add(person.root);
      const m = { kind: 'person', root, person, prev: null, speed: 0 };
      if (e.kid) { root.scale.setScalar(KID_SCALE); root.rotation.order = 'YXZ'; }
      if (isPlayer || e.remote) {
        // Con algo en la mano, caballo y barca (el jugador, además, con sus propios materiales para dibujar
        // su silueta, y en la capa 2; los demás jugadores, con su nombre encima)
        m.hand = new THREE.Group();
        m.hand.position.set(0.03, -0.27, 0.02);
        person.arms[1].add(m.hand);
        m.horse = horseModel(); m.horse.visible = false; root.add(m.horse);
        m.boat = boatModel(); m.boat.visible = false; root.add(m.boat);
        if (e.remote) root.add(nameTag(e.name));
      }
      if (isPlayer) {
        m.mats = []; m.body = [];
        person.root.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); m.mats.push(o.material); m.body.push(o.material); o.layers.set(2); } });
        for (const o of [m.horse, m.boat]) o.traverse(q => { if (q.isMesh) { q.material = q.material.clone(); m.mats.push(q.material); q.layers.set(2); } });
        this.player = m;
      }
      return m;
    }
    if (ANIMALS[e.type]) return { kind: 'animal', root: animalModel(e.type, e.breed, e.bags), key: animalKey(e), prev: null, speed: 0, phase: Math.random() * 6 };
    if (MONSTERS[e.type]) return { kind: 'monster', root: monsterModel(e.type), prev: null, speed: 0, phase: Math.random() * 6 };
    return null;
  }

  pose(m, e, scene, dt, t, game) {
    const view = this.view, x = e.x, z = e.y;
    // Velocidad (para animar) a partir de lo que se ha movido
    const d = m.prev ? Math.hypot(x - m.prev[0], z - m.prev[1]) : 0;
    m.prev = [x, z];
    const v = dt > 0 ? Math.min(8, d / dt) : 0;
    m.speed += (v - m.speed) * Math.min(1, dt * 10);
    const yaw = e.yaw ?? facing(e);
    let y = view.groundY(scene, x, z);
    if (m.kind === 'baby') { m.root.position.set(x, y + (e.h || 0), z); m.root.rotation.y = e.yaw || 0; return; }
    if (e.kid) {   // (los niños, tumbados en su cama de noche: boca arriba, con la cabeza hacia la almohada)
      m.root.rotation.x = e.lying ? -Math.PI / 2 : 0;
      m.root.rotation.y = e.lying ? e.yaw || 0 : 0;
      y += e.lying ? e.h || 0 : 0;
    }
    if (m.kind === 'person') {
      const P = m.person;
      if (e.kid && e.lying) P.facing = 0;
      else if (yaw !== null) P.facing = yaw;
      if (m.horse && m.horseCoat !== (e.horseCoat || 'castano')) {   // (el caballo del jinete, con el pelaje del suyo)
        const h = horseModel(e.horseCoat, e.horseBags);
        if (m === this.player) h.traverse(q => { if (q.isMesh) { q.material = q.material.clone(); m.mats.push(q.material); q.layers.set(2); } });
        m.root.remove(m.horse); m.root.add(h); m.horse = h; m.horseCoat = e.horseCoat || 'castano';
      }
      if (m.boat) {
        // Barca y caballo
        m.boat.visible = !!e.boat; m.horse.visible = !!e.mount;
        if (e.boat) {
          y = WATER_Y - 0.12 + Math.sin(t * 2.5) * 0.04; m.boat.rotation.y = P.root.rotation.y; m.boat.rotation.z = Math.sin(t * 1.7) * 0.03; P.root.position.y = 0.3;
          const row = Math.min(1, m.speed / 1.5);
          for (const o of m.boat.userData.oars) { const a = t * 5; o.rotation.y = Math.sin(a) * 0.5 * row; o.rotation.z = o.userData.side * (Math.PI / 2 + 0.45 + Math.cos(a) * 0.15 * row); }
        }
        else if (e.mount) { m.horse.rotation.y = P.root.rotation.y; animateHorse(m.horse, m.speed, t); P.root.position.y = 0.92; }
        else P.root.position.y = 0;
      }
      P.update(dt, e.mount || e.boat ? 0 : m.speed);
      if (e.z > 0) {   // en el aire: un poco más arriba y con las piernas recogidas
        y += e.z;
        if (!e.mount) { const k = Math.min(1, e.z / 0.25); P.legs[0].rotation.x = -0.7 * k; P.legs[1].rotation.x = 0.35 * k; }
      }
      // (después de andar: el golpe manda sobre el balanceo del brazo)
      if (game) this.hold(m, { held: game.inv.held?.id || null, swing: game.gather.swing, swingItem: game.gather.swingItem, cooldown: game.gather.cooldown, pose: game.fishing?.pose(t) }, dt);
      else if (e.remote) this.hold(m, e, dt);
      if (e.mount || e.boat) { P.legs[0].rotation.x = P.legs[1].rotation.x = e.mount ? -1.1 : -1.4; P.legs[0].rotation.z = 0.5; P.legs[1].rotation.z = -0.5; }
      else P.legs[0].rotation.z = P.legs[1].rotation.z = 0;
    } else if (m.kind === 'animal') {
      if (yaw !== null) turnTo(m.root, yaw, dt);
      m.root.scale.setScalar(e.young ? 0.55 : 1);
      if (ANIMALS[e.type].swims) y = WATER_Y - 0.06 + Math.sin(t * 1.5 + x) * 0.015;
      animateAnimal(m, dt, t, e);
    } else if (m.kind === 'monster') {
      if (yaw !== null && (e.dir?.[0] || e.dir?.[1])) turnTo(m.root, yaw, dt);
      animateMonster(m, e, dt, t);
      if (MONSTERS[e.type].fly) y += 1.1 + Math.sin(t * 6 + x) * 0.15;
      // Herido: parpadea
      m.root.visible = !(e.hurt > 0 && Math.floor(e.hurt * 20) % 2);
    }
    m.root.position.set(x, y, z);
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
      const tool = show && toolModel(show);
      if (tool && m.mats) tool.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); m.mats.push(o.material); m.body.push(o.material); o.layers.set(2); } });
      if (tool) m.hand.add(tool);
      m.holding = show;
    }
    const arm = P.arms[1];
    arm.rotation.z = 0; m.hand.rotation.x = 0; P.torso.rotation.x = 0;
    if (!a) { if (g.pose) { arm.rotation.x = g.pose.arm; P.torso.rotation.x = g.pose.lean; } return; }   // (una postura fija: pescando)
    a.t += dt;
    const k = Math.min(1, a.t / a.dur), ge = GESTURES[a.kind];
    arm.rotation.x = keys(ge.arm, k);
    if (ge.side) arm.rotation.z = keys(ge.side, k);
    if (ge.twist) P.torso.rotation.y += keys(ge.twist, k);
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

// ---------- animales ----------
// Colores de cada raza o pelaje: b, el cuerpo; d, lo oscuro (manchas, crin, patas); l, lo claro (o la cara)
const COATS = {
  gallina: { blanca: ['#f6f2ea', '#e8dcc8'], parda: ['#b8743a', '#7a4422'], negra: ['#2e2a30', '#1a1a22'], dorada: ['#e8b830', '#c88a18'], gallo: ['#c0582a', '#2a4a3a'] },
  pato: { blanco: ['#f6f4ee', '#e8e2d4'], real: ['#b8b4a8', '#2a6a3a', '#8a5a3a'] },
  vaca: { pinta: ['#f4f0e8', '#2a2624'], parda: ['#a8703a', '#6a4422'] },
  oveja: { blanca: ['#f2eee4', '#3a3230'], negra: ['#3a3438', '#1e1a1c'] },
  cabra: { blanca: ['#ece6da', '#a89878'], parda: ['#9a6a3a', '#5a3a22'], negra: ['#2e2a2a', '#5a5048'] },
  cerdo: { rosa: ['#f2aaa6', '#e08a86'], manchado: ['#f2aaa6', '#2a2224'] },
  conejo: { blanco: ['#f4f0ea', '#f0b0b8'], gris: ['#9a9690', '#d8b0b8'], marron: ['#8a6444', '#d8a8a8'] },
  caballo: { castano: ['#8a5a34', '#2a1e16'], negro: ['#2a2624', '#141210'], blanco: ['#ece8e0', '#d8d0c4'], tordo: ['#a8a8a8', '#5a5a5a'], pio: ['#f0ece4', '#8a5a34', '#2a1e16'], palomino: ['#d8a858', '#f4ecd8'] },
  perro: { canela: ['#c88a4a', '#8a5a30'], negro: ['#2a2624', '#c88a4a'], manchado: ['#f0ece4', '#2a2624'], gris: ['#8a8a90', '#5a5a60'] },
  gato: { naranja: ['#e8903a', '#b8602a'], gris: ['#8a8a92', '#5a5a62'], negro: ['#2a2628', '#1a1618'], blanco: ['#f4f2ee', '#e0dcd6'], tricolor: ['#f4f2ee', '#e8903a', '#2a2628'] },
};
const animalKey = e => `${e.type}:${e.breed || ''}:${e.bags ? 1 : 0}`;
function coatOf(type, breed) { const c = COATS[type]; return c ? c[breed] || Object.values(c)[0] : []; }

function animalModel(type, breed, bags) {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const legs = [], [cb, cd, cl] = coatOf(type, breed), eye = M('#141414');
  const leg = (x, z, h, r, m) => { const g = new THREE.Group(); g.position.set(x, h, z); mesh(G.cyl, m, { p: [0, -h / 2, 0], s: [r, h, r] }, g); body.add(g); legs.push(g); };
  const eyes = (g, x, y, z, r = 0.025) => { for (const s of [-1, 1]) mesh(G.ball, eye, { p: [s * x, y, z], s: r }, g); };
  if (type === 'caballo') return horseModel(breed, bags, true);
  if (type === 'gallina') {
    const col = M(cb), dark = M(cd), red = M('#d8352a'), beak = M('#f0b030'), rooster = breed === 'gallo';
    mesh(G.ball, col, { p: [0, 0.32, 0], s: [0.17, 0.16, 0.22] }, body);
    mesh(G.ball, rooster ? dark : col, { p: [0, rooster ? 0.44 : 0.36, -0.2], s: rooster ? [0.06, 0.22, 0.12] : [0.1, 0.14, 0.08], r: [-0.5, 0, 0] }, body);     // cola
    mesh(G.ball, col, { p: [0, 0.52, 0.13], s: 0.1 }, body);                                      // cabeza
    mesh(G.cone, beak, { p: [0, 0.5, 0.25], s: [0.035, 0.08, 0.035], r: [Math.PI / 2, 0, 0] }, body);
    mesh(G.ball, red, { p: [0, 0.63, 0.13], s: rooster ? [0.03, 0.08, 0.1] : [0.025, 0.045, 0.06] }, body);   // cresta
    mesh(G.ball, red, { p: [0, 0.43, 0.22], s: [0.022, rooster ? 0.06 : 0.04, 0.02] }, body);
    eyes(body, 0.07, 0.55, 0.2, 0.016);
    for (const s of [-1, 1]) mesh(G.ball, dark, { p: [s * 0.15, 0.33, -0.02], s: [0.04, 0.1, 0.14] }, body);   // alas
    leg(-0.06, 0, 0.18, 0.018, beak); leg(0.06, 0, 0.18, 0.018, beak);
  } else if (type === 'pato') {
    const col = M(cb), head = M(breed === 'real' ? cd : cb), chest = M(cl || cb), beak = M('#f09a20');
    mesh(G.ball, col, { p: [0, 0.26, 0], s: [0.17, 0.14, 0.26] }, body);
    mesh(G.ball, chest, { p: [0, 0.28, 0.14], s: [0.15, 0.13, 0.12] }, body);
    mesh(G.ball, col, { p: [0, 0.32, -0.26], s: [0.08, 0.06, 0.1], r: [0.5, 0, 0] }, body);   // cola
    mesh(G.cyl, head, { p: [0, 0.42, 0.2], s: [0.06, 0.18, 0.06] }, body);
    mesh(G.ball, head, { p: [0, 0.53, 0.22], s: [0.09, 0.09, 0.11] }, body);
    mesh(G.ball, beak, { p: [0, 0.5, 0.34], s: [0.05, 0.022, 0.08] }, body);
    if (breed === 'real') mesh(G.cyl, M('#f4f0e8'), { p: [0, 0.38, 0.2], s: [0.065, 0.02, 0.065] }, body);   // el collar blanco
    eyes(body, 0.07, 0.56, 0.27, 0.014);
    for (const s of [-1, 1]) mesh(G.ball, col, { p: [s * 0.15, 0.3, -0.03], s: [0.04, 0.09, 0.18] }, body);
    leg(-0.06, 0, 0.14, 0.018, beak); leg(0.06, 0, 0.14, 0.018, beak);
    for (const s of [-1, 1]) mesh(G.ball, beak, { p: [s * 0.06, 0.01, 0.05], s: [0.04, 0.01, 0.06] }, body);
  } else if (type === 'vaca') {
    const white = M(cb), black = M(cd), pink = M('#f0b0b0'), horn = M('#e8dcc0');
    mesh(G.cyl, white, { p: [0, 0.78, 0], s: [0.36, 1.1, 0.36], r: [Math.PI / 2, 0, 0] }, body);
    mesh(G.ball, white, { p: [0, 0.78, 0.55], s: [0.36, 0.36, 0.2] }, body);
    mesh(G.ball, white, { p: [0, 0.78, -0.55], s: [0.36, 0.36, 0.2] }, body);
    if (breed !== 'parda') for (const [x, y, z, s] of [[0.2, 0.9, 0.1, 0.18], [-0.25, 0.7, -0.3, 0.2], [0.1, 1.0, -0.4, 0.14]]) mesh(G.ball, black, { p: [x * 1.02, y, z], s: [s, s * 0.9, s] }, body);
    const head = new THREE.Group(); head.position.set(0, 1.0, 0.75); body.add(head);
    mesh(G.ball, white, { p: [0, 0, 0.1], s: [0.22, 0.24, 0.3] }, head);
    mesh(G.ball, pink, { p: [0, -0.1, 0.36], s: [0.16, 0.12, 0.1] }, head);
    for (const s of [-1, 1]) { mesh(G.ball, eye, { p: [s * 0.12, 0.08, 0.3], s: 0.03 }, head); mesh(G.cone, horn, { p: [s * 0.14, 0.24, 0.02], s: [0.035, 0.14, 0.035], r: [0, 0, -s * 0.5] }, head); mesh(G.ball, white, { p: [s * 0.25, 0.1, 0], s: [0.1, 0.05, 0.06] }, head); }
    for (const [x, z] of [[-0.2, 0.42], [0.2, 0.42], [-0.2, -0.42], [0.2, -0.42]]) leg(x, z, 0.55, 0.07, white);
    mesh(G.ball, pink, { p: [0, 0.48, -0.25], s: [0.12, 0.08, 0.1] }, body);   // ubre
    mergeHead(head);
  } else if (type === 'oveja') {
    const wool = M(cb, { roughness: 1 }), face = M(cd), white = M('#f0f0f0');
    for (const [x, y, z, s] of [[0, 0.62, 0, 0.36], [0.16, 0.66, 0.2, 0.24], [-0.16, 0.66, 0.2, 0.24], [0.16, 0.66, -0.22, 0.24], [-0.16, 0.66, -0.22, 0.24], [0, 0.8, 0, 0.26], [0, 0.6, -0.34, 0.2], [0, 0.62, 0.32, 0.22]]) mesh(G.ball, wool, { p: [x, y, z], s }, body);
    const head = new THREE.Group(); head.position.set(0, 0.78, 0.5); body.add(head);
    mesh(G.ball, face, { p: [0, 0, 0.06], s: [0.13, 0.15, 0.2] }, head);
    mesh(G.ball, wool, { p: [0, 0.12, 0], s: [0.15, 0.09, 0.13] }, head);
    for (const s of [-1, 1]) { mesh(G.ball, white, { p: [s * 0.08, 0.04, 0.18], s: 0.025 }, head); mesh(G.ball, face, { p: [s * 0.16, 0.02, 0], s: [0.08, 0.035, 0.05] }, head); }
    for (const [x, z] of [[-0.15, 0.25], [0.15, 0.25], [-0.15, -0.25], [0.15, -0.25]]) leg(x, z, 0.36, 0.045, face);
    mergeHead(head);
  } else if (type === 'cabra') {
    const col = M(cb), horn = M(breed === 'blanca' ? cd : '#a89878'), dark = M('#3a3230'), hoof = M('#4a4038');
    mesh(G.cyl, col, { p: [0, 0.62, 0], s: [0.22, 0.7, 0.24], r: [Math.PI / 2, 0, 0] }, body);
    for (const z of [0.35, -0.35]) mesh(G.ball, col, { p: [0, 0.62, z], s: [0.22, 0.24, 0.14] }, body);
    mesh(G.cone, col, { p: [0, 0.78, -0.42], s: [0.05, 0.14, 0.05], r: [-0.8, 0, 0] }, body);   // rabito
    const head = new THREE.Group(); head.position.set(0, 0.9, 0.48); body.add(head);
    mesh(G.cyl, col, { p: [0, -0.1, -0.04], s: [0.1, 0.25, 0.12], r: [0.5, 0, 0] }, head);
    mesh(G.ball, col, { p: [0, 0.04, 0.08], s: [0.12, 0.12, 0.18] }, head);
    mesh(G.cone, col, { p: [0, -0.1, 0.16], s: [0.035, 0.12, 0.035], r: [Math.PI, 0, 0] }, head);   // barba
    for (const s of [-1, 1]) { mesh(G.cone, horn, { p: [s * 0.06, 0.2, -0.02], s: [0.025, 0.16, 0.025], r: [-0.6, 0, -s * 0.2] }, head); mesh(G.ball, col, { p: [s * 0.14, 0.06, 0], s: [0.08, 0.03, 0.04] }, head); mesh(G.ball, dark, { p: [s * 0.07, 0.08, 0.2], s: 0.02 }, head); }
    for (const [x, z] of [[-0.12, 0.3], [0.12, 0.3], [-0.12, -0.3], [0.12, -0.3]]) { leg(x, z, 0.42, 0.04, col); mesh(G.cyl, hoof, { p: [0, -0.42, 0], s: [0.045, 0.06, 0.045] }, legs[legs.length - 1]); }
    mergeHead(head);
  } else if (type === 'cerdo') {
    const pink = M(cb), dark = M(cd), snout = M('#e08a86');
    mesh(G.ball, pink, { p: [0, 0.42, 0], s: [0.3, 0.27, 0.42] }, body);
    if (breed === 'manchado') for (const [x, y, z, r] of [[0.2, 0.5, 0.1, 0.13], [-0.18, 0.45, -0.2, 0.14], [0.05, 0.62, -0.1, 0.1]]) mesh(G.ball, dark, { p: [x, y, z], s: r }, body);
    const head = new THREE.Group(); head.position.set(0, 0.48, 0.42); body.add(head);
    mesh(G.ball, pink, { p: [0, 0, 0], s: [0.2, 0.18, 0.16] }, head);
    mesh(G.cyl, snout, { p: [0, -0.03, 0.15], s: [0.08, 0.06, 0.08], r: [Math.PI / 2, 0, 0] }, head);
    for (const s of [-1, 1]) { mesh(G.ball, eye, { p: [s * 0.08, 0.06, 0.13], s: 0.02 }, head); mesh(G.cone, pink, { p: [s * 0.11, 0.17, 0], s: [0.05, 0.08, 0.03], r: [0.4, 0, -s * 0.3] }, head); mesh(G.ball, M('#8a4a48'), { p: [s * 0.025, -0.03, 0.19], s: 0.012 }, head); }
    mesh(G.ball, pink, { p: [0, 0.5, -0.42], s: [0.03, 0.03, 0.06] }, body);   // rabito
    for (const [x, z] of [[-0.15, 0.22], [0.15, 0.22], [-0.15, -0.22], [0.15, -0.22]]) leg(x, z, 0.22, 0.05, pink);
    mergeHead(head);
  } else if (type === 'conejo') {
    const fur = M(cb), inner = M(cd);
    mesh(G.ball, fur, { p: [0, 0.18, -0.02], s: [0.14, 0.13, 0.18] }, body);
    mesh(G.ball, M('#ffffff'), { p: [0, 0.2, -0.19], s: 0.05 }, body);   // la colita
    mesh(G.ball, fur, { p: [0, 0.3, 0.13], s: [0.09, 0.09, 0.1] }, body);
    for (const s of [-1, 1]) { mesh(G.ball, fur, { p: [s * 0.04, 0.46, 0.1], s: [0.025, 0.11, 0.035], r: [-0.2, 0, s * 0.15] }, body); mesh(G.ball, inner, { p: [s * 0.04, 0.46, 0.115], s: [0.012, 0.08, 0.02], r: [-0.2, 0, s * 0.15] }, body); }
    eyes(body, 0.05, 0.32, 0.2, 0.014);
    mesh(G.ball, M('#d88a92'), { p: [0, 0.29, 0.225], s: 0.012 }, body);
    for (const [x, z] of [[-0.06, 0.08], [0.06, 0.08]]) leg(x, z, 0.08, 0.025, fur);
    for (const s of [-1, 1]) mesh(G.ball, fur, { p: [s * 0.08, 0.06, -0.06], s: [0.04, 0.05, 0.09] }, body);
  } else if (type === 'perro' || type === 'gato') {
    const dog = type === 'perro', fur = M(cb), spot = M(cd), third = cl ? M(cl) : spot, nose = M('#2a1c1c');
    const L = dog ? 1 : 0.75;   // el gato, más pequeño
    mesh(G.cyl, fur, { p: [0, 0.32 * L, 0], s: [0.13 * L, 0.42 * L, 0.14 * L], r: [Math.PI / 2, 0, 0] }, body);
    for (const z of [0.21, -0.21]) mesh(G.ball, fur, { p: [0, 0.32 * L, z * L], s: [0.13 * L, 0.14 * L, 0.1 * L] }, body);
    if (breed === 'manchado' || breed === 'tricolor') { mesh(G.ball, spot, { p: [0.08 * L, 0.38 * L, -0.08 * L], s: 0.08 * L }, body); mesh(G.ball, third, { p: [-0.07 * L, 0.36 * L, 0.12 * L], s: 0.07 * L }, body); }
    if (!dog && (breed === 'naranja' || breed === 'gris')) for (const z of [-0.1, 0.02, 0.14]) mesh(G.cyl, spot, { p: [0, 0.42 * L, z * L], s: [0.135 * L, 0.025 * L, 0.035 * L], r: [0, 0, Math.PI / 2] }, body);   // rayas
    const head = new THREE.Group(); head.position.set(0, 0.5 * L, 0.3 * L); body.add(head);
    mesh(G.ball, fur, { p: [0, 0, 0], s: [0.13 * L, 0.12 * L, 0.12 * L] }, head);
    mesh(G.ball, dog ? spot : fur, { p: [0, -0.03 * L, 0.11 * L], s: dog ? [0.07, 0.06, 0.08] : [0.06 * L, 0.045 * L, 0.04 * L] }, head);   // hocico
    mesh(G.ball, nose, { p: [0, -0.005 * L, dog ? 0.19 : 0.15 * L], s: 0.022 * L }, head);
    for (const s of [-1, 1]) {
      mesh(G.ball, eye, { p: [s * 0.055 * L, 0.035 * L, 0.1 * L], s: 0.022 * L }, head);
      if (dog) mesh(G.ball, spot, { p: [s * 0.12, -0.02, -0.01], s: [0.035, 0.1, 0.06], r: [0, 0, s * 0.25] }, head);   // orejas caídas
      else mesh(G.cone, fur, { p: [s * 0.07 * L, 0.13 * L, -0.01], s: [0.045 * L, 0.08 * L, 0.03 * L], r: [0, 0, -s * 0.25] }, head);
    }
    mesh(G.cone, dog ? spot : fur, { p: [0, (dog ? 0.42 : 0.5) * L, -0.32 * L], s: dog ? [0.03, 0.22, 0.03] : [0.025, 0.32 * L, 0.025], r: [dog ? -0.9 : -0.4, 0, 0] }, body);   // cola
    for (const [x, z] of [[-0.07, 0.17], [0.07, 0.17], [-0.07, -0.17], [0.07, -0.17]]) leg(x * L, z * L, 0.22 * L, 0.03 * L, breed === 'negro' && dog ? third : fur);
    mergeHead(head);
  } else if (type === 'ciervo') {
    const fur = M('#9a6a3a'), light = M('#e8dcc0'), antler = M('#d8c8a0'), hoof = M('#2a2420');
    mesh(G.cyl, fur, { p: [0, 0.95, 0], s: [0.24, 0.9, 0.26], r: [Math.PI / 2, 0, 0] }, body);
    for (const z of [0.42, -0.42]) mesh(G.ball, fur, { p: [0, 0.95, z], s: [0.24, 0.26, 0.15] }, body);
    mesh(G.ball, light, { p: [0, 1.0, -0.56], s: [0.08, 0.1, 0.05] }, body);
    const head = new THREE.Group(); head.position.set(0, 1.35, 0.55); body.add(head);
    mesh(G.cyl, fur, { p: [0, -0.18, -0.05], s: [0.09, 0.4, 0.1], r: [0.5, 0, 0] }, head);
    mesh(G.ball, fur, { p: [0, 0.05, 0.08], s: [0.11, 0.11, 0.2] }, head);
    mesh(G.ball, M('#1a1414'), { p: [0, 0.02, 0.27], s: 0.03 }, head);
    for (const s of [-1, 1]) {
      mesh(G.ball, eye, { p: [s * 0.08, 0.09, 0.14], s: 0.02 }, head);
      mesh(G.ball, fur, { p: [s * 0.13, 0.12, -0.02], s: [0.07, 0.03, 0.04], r: [0, 0, s * 0.4] }, head);
      mesh(G.cyl, antler, { p: [s * 0.08, 0.3, -0.04], s: [0.015, 0.36, 0.015], r: [-0.3, 0, -s * 0.35] }, head);
      mesh(G.cyl, antler, { p: [s * 0.16, 0.36, 0.04], s: [0.012, 0.18, 0.012], r: [0.5, 0, -s * 0.6] }, head);
    }
    for (const [x, z] of [[-0.13, 0.36], [0.13, 0.36], [-0.13, -0.36], [0.13, -0.36]]) { leg(x, z, 0.75, 0.035, fur); mesh(G.cyl, hoof, { p: [0, -0.75, 0], s: [0.04, 0.06, 0.04] }, legs[legs.length - 1]); }
    mergeHead(head);
  } else if (type === 'jabali') {
    const fur = M('#4a3a2e'), dark = M('#2e241c'), tusk = M('#f0ead8');
    mesh(G.ball, fur, { p: [0, 0.48, 0], s: [0.3, 0.32, 0.48] }, body);
    mesh(G.cyl, dark, { p: [0, 0.78, 0.05], s: [0.05, 0.6, 0.1], r: [Math.PI / 2, 0, 0] }, body);   // crin del lomo
    const head = new THREE.Group(); head.position.set(0, 0.5, 0.5); body.add(head);
    mesh(G.cone, fur, { p: [0, 0, 0.05], s: [0.2, 0.36, 0.2], r: [Math.PI / 2, 0, 0] }, head);
    mesh(G.cyl, dark, { p: [0, -0.02, 0.24], s: [0.07, 0.05, 0.07], r: [Math.PI / 2, 0, 0] }, head);
    for (const s of [-1, 1]) { mesh(G.cone, tusk, { p: [s * 0.08, -0.02, 0.2], s: [0.018, 0.09, 0.018], r: [-0.4, 0, s * 0.3] }, head); mesh(G.ball, eye, { p: [s * 0.08, 0.08, 0.06], s: 0.02 }, head); mesh(G.cone, dark, { p: [s * 0.1, 0.17, -0.06], s: [0.04, 0.08, 0.03] }, head); }
    for (const [x, z] of [[-0.15, 0.26], [0.15, 0.26], [-0.15, -0.26], [0.15, -0.26]]) leg(x, z, 0.24, 0.05, dark);
    mergeHead(head);
  } else if (type === 'cisne') {
    const white = M('#f8f6f2'), beak = M('#f07a20'), black = M('#1a1a1a');
    mesh(G.ball, white, { p: [0, 0.12, 0], s: [0.22, 0.14, 0.36] }, body);
    mesh(G.ball, white, { p: [0, 0.22, -0.26], s: [0.12, 0.1, 0.14], r: [0.6, 0, 0] }, body);
    for (const s of [-1, 1]) mesh(G.ball, white, { p: [s * 0.14, 0.2, -0.04], s: [0.08, 0.1, 0.28], r: [0.15, 0, 0] }, body);
    const neck = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.16, 0.24), new THREE.Vector3(0, 0.42, 0.3), new THREE.Vector3(0, 0.62, 0.2), new THREE.Vector3(0, 0.66, 0.3)]);
    body.add(new THREE.Mesh(new THREE.TubeGeometry(neck, 12, 0.045, 6), white));
    mesh(G.ball, white, { p: [0, 0.66, 0.31], s: [0.06, 0.06, 0.08] }, body);
    mesh(G.cone, beak, { p: [0, 0.64, 0.42], s: [0.025, 0.1, 0.025], r: [Math.PI / 2 + 0.3, 0, 0] }, body);
    mesh(G.ball, black, { p: [0, 0.66, 0.37], s: [0.03, 0.03, 0.02] }, body);
    eyes(body, 0.045, 0.68, 0.33, 0.012);
  }
  mergeInto(body);
  for (const l of legs) mergeInto(l);
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  root.userData = { body, legs, type };
  return root;
}
function mergeHead(head) { mergeInto(head); head.userData.head = true; }
function animateAnimal(m, dt, t, e) {
  const u = m.root.userData;
  if (u.horse) { animateHorse(m.root, m.speed, t); return; }
  const { body, legs, type } = u, k = Math.min(1, m.speed / 0.8);
  m.phase += dt * (3 + m.speed * 6);
  legs.forEach((l, i) => { l.rotation.x = Math.sin(m.phase + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * 0.6 * k; });
  body.position.y = Math.abs(Math.sin(m.phase)) * (type === 'conejo' ? 0.12 : 0.03) * k;
  body.rotation.z = type === 'pato' ? Math.sin(m.phase) * 0.12 * k : 0;   // el pato se bambolea
  body.scale.y = e?.sleep ? 0.6 : 1;   // durmiendo, hecho una bola
  if (e?.sleep) { body.position.y = 0; body.rotation.x = 0; return; }
  if (type === 'gallina' || type === 'pato') body.rotation.x = k ? Math.sin(m.phase * 2) * 0.08 : Math.max(0, Math.sin(t * 1.3 + m.phase) - 0.7) * 1.2;   // picotea
  else if (type === 'cerdo' && e?.digging) body.rotation.x = 0.25 + Math.sin(t * 9) * 0.06;   // hoza
  else body.rotation.x = Math.sin(t * 0.8 + m.phase) * 0.015;
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
function horseModel(breed = 'castano', bags = false, alone = false) {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const [cb, cd, cl] = coatOf('caballo', breed), coat = M(cb), mane = M(cl || cd), hoof = M('#2a2420'), saddle = M('#6a2a1e');
  mesh(G.cyl, coat, { p: [0, 0.82, 0], s: [0.3, 1.05, 0.3], r: [Math.PI / 2, 0, 0] }, body);
  mesh(G.ball, coat, { p: [0, 0.82, 0.5], s: [0.3, 0.3, 0.2] }, body);
  mesh(G.ball, coat, { p: [0, 0.82, -0.5], s: [0.3, 0.3, 0.2] }, body);
  if (breed === 'pio') for (const [x, y, z, r] of [[0.2, 0.9, 0.2, 0.16], [-0.22, 0.75, -0.25, 0.18], [0.12, 1.0, -0.45, 0.12]]) mesh(G.ball, M(cd), { p: [x, y, z], s: r }, body);
  mesh(G.cyl, coat, { p: [0, 1.1, 0.62], s: [0.14, 0.55, 0.16], r: [0.6, 0, 0] }, body);
  mesh(G.ball, coat, { p: [0, 1.32, 0.86], s: [0.14, 0.14, 0.28], r: [0.35, 0, 0] }, body);
  if (breed === 'blanco' || breed === 'tordo' || breed === 'palomino') mesh(G.ball, M('#f4f0ea'), { p: [0, 1.4, 1.0], s: [0.05, 0.04, 0.06] }, body);   // lucero en la frente
  mesh(G.cyl, mane, { p: [0, 1.18, 0.56], s: [0.04, 0.55, 0.1], r: [0.6, 0, 0] }, body);
  mesh(G.cone, mane, { p: [0, 0.78, -0.72], s: [0.08, 0.5, 0.08], r: [-2.6, 0, 0] }, body);
  for (const s of [-1, 1]) { mesh(G.cone, coat, { p: [s * 0.07, 1.48, 0.76], s: [0.035, 0.1, 0.035] }, body); mesh(G.ball, M('#141414'), { p: [s * 0.1, 1.38, 0.92], s: 0.025 }, body); }
  mesh(G.cyl, saddle, { p: [0, 1.1, -0.02], s: [0.32, 0.08, 0.36] }, body);
  if (bags) for (const s of [-1, 1]) mesh(G.ball, M('#8a5a34'), { p: [s * 0.32, 0.88, -0.28], s: [0.08, 0.14, 0.16] }, body);   // alforjas
  const legs = [];
  for (const [x, z] of [[-0.17, 0.4], [0.17, 0.4], [-0.17, -0.4], [0.17, -0.4]]) {
    const g = new THREE.Group(); g.position.set(x, 0.7, z);
    mesh(G.cyl, coat, { p: [0, -0.33, 0], s: [0.06, 0.66, 0.06] }, g); mesh(G.cyl, hoof, { p: [0, -0.66, 0], s: [0.07, 0.08, 0.07] }, g);
    mergeInto(g); body.add(g); legs.push(g);
  }
  mergeInto(body);
  root.userData = { legs, phase: 0, horse: alone };
  root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return root;
}
function animateHorse(h, speed, t) {
  const u = h.userData, k = Math.min(1, speed / 3);
  u.phase = t * (4 + speed * 2.2);
  u.legs.forEach((l, i) => { l.rotation.x = Math.sin(u.phase + [0, Math.PI, Math.PI * 0.5, Math.PI * 1.5][i]) * 0.7 * k; });
}
function boatModel() {
  // Barca de remos: casco con la proa en punta (mirando a +z), borda, fondo, banco y dos remos
  const root = new THREE.Group(), wood = mat({ color: '#8a5a34', roughness: 0.8 }), dark = mat({ color: '#5e3b22', roughness: 0.8 }), inside = mat({ color: '#6a4428', roughness: 0.9 });
  const outline = (k) => { const s = new THREE.Shape(); s.moveTo(-0.55 * k, -0.95 * k); s.lineTo(0.55 * k, -0.95 * k); s.quadraticCurveTo(0.62 * k, 0.4 * k, 0, 1.15 * k); s.quadraticCurveTo(-0.62 * k, 0.4 * k, -0.55 * k, -0.95 * k); return s; };
  const hullGeo = new THREE.ExtrudeGeometry(outline(1), { depth: 0.42, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2, curveSegments: 10 });
  hullGeo.rotateX(-Math.PI / 2);   // la silueta en planta, y la altura hacia arriba
  const hull = new THREE.Mesh(hullGeo, wood); hull.position.y = -0.1; root.add(hull);
  const floorGeo = new THREE.ShapeGeometry(outline(0.86), 10); floorGeo.rotateX(-Math.PI / 2);
  const floor = new THREE.Mesh(floorGeo, inside); floor.position.y = 0.335; root.add(floor);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.035, 4, 24), dark); rim.scale.set(0.95, 1.75, 1); rim.rotation.x = Math.PI / 2; rim.position.set(0, 0.36, 0.08); root.add(rim);
  const bench = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 0.22), dark); bench.position.set(0, 0.45, -0.1); root.add(bench);
  for (const s of [-1, 1]) {
    const oar = new THREE.Group(), stick = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.5, 6), wood), blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.4, 0.14), wood);
    stick.position.y = -0.75; blade.position.y = -1.45; oar.add(stick, blade);
    oar.position.set(s * 0.5, 0.5, 0); oar.rotation.z = s * (Math.PI / 2 + 0.45); oar.userData.side = s;
    root.add(oar); (root.userData.oars ||= []).push(oar);
  }
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return root;
}

// ---------- herramientas ----------
// Las herramientas en la mano: el mango va a lo largo de +y desde el puño y las cabezas son perfiles
// extruidos (hoja del hacha, media luna del pico, hoja de la guadaña, pala de la azada, hoja de la espada),
// con el filo de un tono más claro (un poco más grueso que la cabeza, para que asome por las dos caras). Las de madera y piedra van atadas con cuerda; las de metal brillan.
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

export function toolModel(id) {
  const def = ITEMS[id];
  if (!def || !(def.tool || def.weapon)) return null;
  const tier = def.tier || 4, base = def.weapon ? (def.weapon > 3 ? '#f0c840' : '#c8d0d8') : TIERS[tier]?.head || '#b8c2ce';
  const metal = def.weapon || tier >= 3, flat = !metal;
  const head = mat({ color: base, metalness: metal ? 0.65 : 0, roughness: metal ? 0.32 : 0.85, flatShading: flat });
  const edge = mat({ color: '#' + new THREE.Color(base).lerp(new THREE.Color('#ffffff'), metal ? 0.45 : 0.25).getHexString(), metalness: metal ? 0.8 : 0, roughness: metal ? 0.2 : 0.7, flatShading: flat });
  const wood = M('#7a4e2c'), grip = M('#4a2e1c'), rope = M('#d8c8a0'), g = new THREE.Group();
  const at = (geo, m, p, r = [0, 0, 0], s = [1, 1, 1]) => mesh(geo, m, { p, r, s }, g);
  // Mango: algo más grueso abajo, con la empuñadura forrada y un remate
  const haft = (len, r = 0.022) => {
    at(new THREE.CylinderGeometry(r * 0.9, r * 1.1, len, 8), wood, [0, len / 2 - 0.1, 0]);
    at(new THREE.CylinderGeometry(r * 1.25, r * 1.25, 0.13, 8), grip, [0, -0.03, 0]);
    at(G.ball, grip, [0, -0.1, 0], [0, 0, 0], [r * 1.4, r * 1.1, r * 1.4]);
    return len - 0.1;   // dónde acaba
  };
  const lash = y => { if (!metal) for (const dy of [-0.05, 0.05]) at(new THREE.TorusGeometry(0.027, 0.007, 4, 10), rope, [0, y + dy, 0], [Math.PI / 2, 0, 0]); };
  const kind = def.weapon ? 'espada' : def.tool;
  if (kind === 'hacha') {
    const top = haft(0.62), y = top - 0.07;
    at(profile('axe', AXE, 0.034), head, [0.012, y, 0]);
    at(profile('axeEdge', AXE_EDGE, 0.04, 0.003), edge, [0.012, y, 0]);
    lash(y);
  } else if (kind === 'pico') {
    const top = haft(0.62), y = top - 0.04;
    at(profile('pick', PICK, 0.036), head, [0, y, 0]);
    at(new THREE.CylinderGeometry(0.034, 0.034, 0.09, 8), head, [0, y, 0]);
    for (const sx of [-1, 1]) at(G.cone, edge, [sx * 0.262, y - 0.068, 0], [0, 0, sx * 2.25], [0.018, 0.05, 0.018]);
    lash(y);
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
    lash(top - 0.02);
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
