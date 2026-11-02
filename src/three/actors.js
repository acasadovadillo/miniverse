// Todo lo que se mueve: el jugador, Nilo, los vecinos y los mercaderes (personas chibi con su "look"), los
// animales del rancho (gallinas, vacas y ovejas), los monstruos de las cuevas (limos, murciélagos y
// esqueletos), el caballo y la barca. Cada entidad del juego tiene su modelo, que se crea al verla por
// primera vez y se quita cuando deja de estar. Miran hacia donde van, andan y respiran; el jugador lleva en
// la mano la herramienta elegida y la balancea al golpear.
import * as THREE from 'three';
import { Person3D, mesh, mergeInto, G, M } from './people.js';
import { mat } from './geo.js';
import { ANIMALS } from '../art/farm.js';
import { MONSTERS } from '../combat.js';
import { screenToWorld, screenDirOf } from '../camera.js';
import { ITEMS, TIERS } from '../items.js';
import { WATER_Y } from './terrain.js';

const PEOPLE = new Map();

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
      // (el jugador, con la ropa que lleva: si se pone o se quita algo, se rehace su muñeco)
      const look = e === p ? game.appearance() : e.look;
      if (m && e === p && m.look !== look) { this.group.remove(m.root); this.models.delete(e); this.player = null; m = null; }
      if (!m) { m = this.make(e, e === p, look); if (!m) continue; m.look = look; this.models.set(e, m); this.group.add(m.root); }
      this.pose(m, e, scene, dt, t, e === p ? game : null);
    }
    for (const [e, m] of this.models) if (!seen.has(e)) { this.group.remove(m.root); this.models.delete(e); if (m === this.player) this.player = null; }
    // En cuevas y mazmorras el jugador lleva un farol
    this.lights.length = 0;
    if (p && scene.kind === 'grid') this.lights.push({ x: p.x, y: 1.8, z: p.y, intensity: 8, range: 14, color: '#ffc880', always: true, flicker: true });
  }

  make(e, isPlayer, look = e.look) {
    if (look) {
      // (las personas con el mismo aspecto se copian de la primera: hacer una desde cero cuesta)
      const key = JSON.stringify(look);
      if (!PEOPLE.has(key)) PEOPLE.set(key, new Person3D(look, ''));
      const person = PEOPLE.get(key).clone();
      const root = new THREE.Group();
      root.add(person.root);
      const m = { kind: 'person', root, person, prev: null, speed: 0 };
      if (isPlayer) {
        // El jugador tiene sus propios materiales (para dibujar su silueta) y va en la capa 2
        m.mats = []; m.body = [];
        person.root.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); m.mats.push(o.material); m.body.push(o.material); o.layers.set(2); } });
        m.hand = new THREE.Group();
        m.hand.position.set(0.03, -0.27, 0.02);
        person.arms[1].add(m.hand);
        m.horse = horseModel(); m.horse.visible = false; root.add(m.horse);
        m.boat = boatModel(); m.boat.visible = false; root.add(m.boat);
        for (const o of [m.horse, m.boat]) o.traverse(q => { if (q.isMesh) { q.material = q.material.clone(); m.mats.push(q.material); q.layers.set(2); } });
        this.player = m;
      }
      return m;
    }
    if (ANIMALS[e.type]) return { kind: 'animal', root: animalModel(e.type), prev: null, speed: 0, phase: Math.random() * 6 };
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
    const yaw = facing(e);
    let y = view.groundY(scene, x, z);
    if (m.kind === 'person') {
      const P = m.person;
      if (yaw !== null) P.facing = yaw;
      if (game) {
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
      if (game) this.hold(m, game, dt);   // (después de andar: el golpe manda sobre el balanceo del brazo)
      if (e.mount || e.boat) { P.legs[0].rotation.x = P.legs[1].rotation.x = e.mount ? -1.1 : -1.4; P.legs[0].rotation.z = 0.5; P.legs[1].rotation.z = -0.5; }
      else P.legs[0].rotation.z = P.legs[1].rotation.z = 0;
    } else if (m.kind === 'animal') {
      if (yaw !== null) turnTo(m.root, yaw, dt);
      animateAnimal(m, dt, t);
    } else if (m.kind === 'monster') {
      if (yaw !== null && (e.dir?.[0] || e.dir?.[1])) turnTo(m.root, yaw, dt);
      animateMonster(m, e, dt, t);
      if (MONSTERS[e.type].fly) y += 1.1 + Math.sin(t * 6 + x) * 0.15;
      // Herido: parpadea
      m.root.visible = !(e.hurt > 0 && Math.floor(e.hurt * 20) % 2);
    }
    m.root.position.set(x, y, z);
  }

  // La herramienta (o el arma) en la mano del jugador, y el gesto al usarla. Cada golpe nuevo (el temporizador
  // swing de la recolección vuelve a subir) empieza una animación de su herramienta, que dura como mucho lo
  // que tarda en poder volver a golpear (así, con el clic pulsado, los golpes se encadenan).
  hold(m, game, dt) {
    const g = game.gather, id = game.inv.held?.id || null, P = m.person;
    if (g.swing > (m.lastSwing || 0) + 1e-4) {
      const kind = gestureOf(g.swingItem), base = GESTURES[kind].dur;
      m.anim = { t: 0, item: g.swingItem, kind, dur: g.cooldown > 0 ? Math.max(0.22, Math.min(base, g.cooldown)) : base };
    }
    m.lastSwing = g.swing;
    const a = m.anim, show = a ? a.item : id;
    if (m.holding !== show) {
      m.hand.clear();
      const tool = show && toolModel(show);
      if (tool) { tool.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); m.mats.push(o.material); m.body.push(o.material); o.layers.set(2); } }); m.hand.add(tool); }
      m.holding = show;
    }
    const arm = P.arms[1];
    arm.rotation.z = 0; m.hand.rotation.x = 0; P.torso.rotation.x = 0;
    if (!a) return;
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
function animalModel(type) {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const legs = [];
  const leg = (x, z, h, r, m) => { const g = new THREE.Group(); g.position.set(x, h, z); mesh(G.cyl, m, { p: [0, -h / 2, 0], s: [r, h, r] }, g); body.add(g); legs.push(g); };
  if (type === 'gallina') {
    const white = M('#f6f2ea'), red = M('#d8352a'), beak = M('#f0b030'), eye = M('#1a1a1a');
    mesh(G.ball, white, { p: [0, 0.32, 0], s: [0.17, 0.16, 0.22] }, body);
    mesh(G.ball, white, { p: [0, 0.36, -0.2], s: [0.1, 0.14, 0.08], r: [-0.5, 0, 0] }, body);     // cola
    mesh(G.ball, white, { p: [0, 0.52, 0.13], s: 0.1 }, body);                                      // cabeza
    mesh(G.cone, beak, { p: [0, 0.5, 0.25], s: [0.035, 0.08, 0.035], r: [Math.PI / 2, 0, 0] }, body);
    mesh(G.ball, red, { p: [0, 0.63, 0.13], s: [0.025, 0.045, 0.06] }, body);                     // cresta
    mesh(G.ball, red, { p: [0, 0.43, 0.22], s: [0.022, 0.04, 0.02] }, body);
    for (const s of [-1, 1]) mesh(G.ball, eye, { p: [s * 0.07, 0.55, 0.2], s: 0.016 }, body);
    for (const s of [-1, 1]) mesh(G.ball, M('#ece6da'), { p: [s * 0.15, 0.33, -0.02], s: [0.04, 0.1, 0.14] }, body);   // alas
    leg(-0.06, 0, 0.18, 0.018, beak); leg(0.06, 0, 0.18, 0.018, beak);
  } else if (type === 'vaca') {
    const white = M('#f4f0e8'), black = M('#2a2624'), pink = M('#f0b0b0'), horn = M('#e8dcc0');
    mesh(G.cyl, white, { p: [0, 0.78, 0], s: [0.36, 1.1, 0.36], r: [Math.PI / 2, 0, 0] }, body);
    mesh(G.ball, white, { p: [0, 0.78, 0.55], s: [0.36, 0.36, 0.2] }, body);
    mesh(G.ball, white, { p: [0, 0.78, -0.55], s: [0.36, 0.36, 0.2] }, body);
    for (const [x, y, z, s] of [[0.2, 0.9, 0.1, 0.18], [-0.25, 0.7, -0.3, 0.2], [0.1, 1.0, -0.4, 0.14]]) mesh(G.ball, black, { p: [x * 1.02, y, z], s: [s, s * 0.9, s], r: [0, 0, 0] }, body);
    const head = new THREE.Group(); head.position.set(0, 1.0, 0.75); body.add(head);
    mesh(G.ball, white, { p: [0, 0, 0.1], s: [0.22, 0.24, 0.3] }, head);
    mesh(G.ball, pink, { p: [0, -0.1, 0.36], s: [0.16, 0.12, 0.1] }, head);
    for (const s of [-1, 1]) { mesh(G.ball, black, { p: [s * 0.12, 0.08, 0.3], s: 0.03 }, head); mesh(G.cone, horn, { p: [s * 0.14, 0.24, 0.02], s: [0.035, 0.14, 0.035], r: [0, 0, -s * 0.5] }, head); mesh(G.ball, white, { p: [s * 0.25, 0.1, 0], s: [0.1, 0.05, 0.06] }, head); }
    for (const [x, z] of [[-0.2, 0.42], [0.2, 0.42], [-0.2, -0.42], [0.2, -0.42]]) leg(x, z, 0.55, 0.07, white);
    mesh(G.ball, pink, { p: [0, 0.48, -0.25], s: [0.12, 0.08, 0.1] }, body);   // ubre
    mergeHead(head);
  } else {   // oveja
    const wool = M('#f2eee4', { roughness: 1 }), face = M('#3a3230'), eye = M('#f0f0f0');
    for (const [x, y, z, s] of [[0, 0.62, 0, 0.36], [0.16, 0.66, 0.2, 0.24], [-0.16, 0.66, 0.2, 0.24], [0.16, 0.66, -0.22, 0.24], [-0.16, 0.66, -0.22, 0.24], [0, 0.8, 0, 0.26], [0, 0.6, -0.34, 0.2], [0, 0.62, 0.32, 0.22]]) mesh(G.ball, wool, { p: [x, y, z], s }, body);
    const head = new THREE.Group(); head.position.set(0, 0.78, 0.5); body.add(head);
    mesh(G.ball, face, { p: [0, 0, 0.06], s: [0.13, 0.15, 0.2] }, head);
    mesh(G.ball, wool, { p: [0, 0.12, 0], s: [0.15, 0.09, 0.13] }, head);
    for (const s of [-1, 1]) { mesh(G.ball, eye, { p: [s * 0.08, 0.04, 0.18], s: 0.025 }, head); mesh(G.ball, face, { p: [s * 0.16, 0.02, 0], s: [0.08, 0.035, 0.05] }, head); }
    for (const [x, z] of [[-0.15, 0.25], [0.15, 0.25], [-0.15, -0.25], [0.15, -0.25]]) leg(x, z, 0.36, 0.045, face);
    mergeHead(head);
  }
  mergeInto(body);
  for (const l of legs) mergeInto(l);
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  root.userData = { body, legs, type };
  return root;
}
function mergeHead(head) { mergeInto(head); head.userData.head = true; }
function animateAnimal(m, dt, t) {
  const { body, legs, type } = m.root.userData, k = Math.min(1, m.speed / 0.8);
  m.phase += dt * (3 + m.speed * 6);
  legs.forEach((l, i) => { l.rotation.x = Math.sin(m.phase + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * 0.6 * k; });
  body.position.y = Math.abs(Math.sin(m.phase)) * 0.03 * k;
  if (type === 'gallina') body.rotation.x = k ? Math.sin(m.phase * 2) * 0.08 : Math.max(0, Math.sin(t * 1.3 + m.phase) - 0.7) * 1.2;   // picotea
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
function horseModel() {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const coat = M('#8a5a34'), mane = M('#2a1e16'), hoof = M('#2a2420'), saddle = M('#6a2a1e');
  mesh(G.cyl, coat, { p: [0, 0.82, 0], s: [0.3, 1.05, 0.3], r: [Math.PI / 2, 0, 0] }, body);
  mesh(G.ball, coat, { p: [0, 0.82, 0.5], s: [0.3, 0.3, 0.2] }, body);
  mesh(G.ball, coat, { p: [0, 0.82, -0.5], s: [0.3, 0.3, 0.2] }, body);
  mesh(G.cyl, coat, { p: [0, 1.1, 0.62], s: [0.14, 0.55, 0.16], r: [0.6, 0, 0] }, body);
  mesh(G.ball, coat, { p: [0, 1.32, 0.86], s: [0.14, 0.14, 0.28], r: [0.35, 0, 0] }, body);
  mesh(G.cyl, mane, { p: [0, 1.18, 0.56], s: [0.04, 0.55, 0.1], r: [0.6, 0, 0] }, body);
  mesh(G.cone, mane, { p: [0, 0.78, -0.72], s: [0.08, 0.5, 0.08], r: [-2.6, 0, 0] }, body);
  for (const s of [-1, 1]) { mesh(G.cone, coat, { p: [s * 0.07, 1.48, 0.76], s: [0.035, 0.1, 0.035] }, body); mesh(G.ball, M('#141414'), { p: [s * 0.1, 1.38, 0.92], s: 0.025 }, body); }
  mesh(G.cyl, saddle, { p: [0, 1.1, -0.02], s: [0.32, 0.08, 0.36] }, body);
  const legs = [];
  for (const [x, z] of [[-0.17, 0.4], [0.17, 0.4], [-0.17, -0.4], [0.17, -0.4]]) {
    const g = new THREE.Group(); g.position.set(x, 0.7, z);
    mesh(G.cyl, coat, { p: [0, -0.33, 0], s: [0.06, 0.66, 0.06] }, g); mesh(G.cyl, hoof, { p: [0, -0.66, 0], s: [0.07, 0.08, 0.07] }, g);
    mergeInto(g); body.add(g); legs.push(g);
  }
  mergeInto(body);
  root.userData = { legs, phase: 0 };
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
    at(new THREE.CylinderGeometry(0.004, 0.014, 1.3, 6), M('#5a3a24'), [0, 0.73, 0]);
    for (const y of [0.4, 0.75, 1.1]) at(new THREE.TorusGeometry(0.012, 0.003, 4, 8), M('#d8d8d8', { metalness: 0.6 }), [0, y, 0.012], [0, Math.PI / 2, 0]);
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
