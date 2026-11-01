// Todo lo que se mueve: el jugador, Nilo, los vecinos y los mercaderes (personas chibi con su "look"), los
// animales del rancho (gallinas, vacas y ovejas), los monstruos de las cuevas (limos, murciélagos y
// esqueletos), el caballo y la barca. Cada entidad del juego tiene su modelo, que se crea al verla por
// primera vez y se quita cuando deja de estar. Miran hacia donde van, andan y respiran; el jugador lleva en
// la mano la herramienta elegida y la balancea al golpear.
import * as THREE from 'three';
import { Person3D, mesh, mergeInto, G, M } from './people.js';
import { Builder, mat } from './geo.js';
import { ANIMALS } from '../art/farm.js';
import { MONSTERS } from '../art/explore.js';
import { screenDirOf } from '../art/people3.js';
import { screenToWorld } from '../camera.js';
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
  playerMaterials() { return this.player?.mats || []; }

  update(game, scene, dt, t) {
    const seen = new Set(), p = game.player && game.scene ? game.player : null;
    const list = [...(scene.entities || [])];
    if (game.player && game.scene === scene) for (const s of game.systems) { const more = s.entities?.(scene); if (more) list.push(...more); }
    if (p) list.push(p);
    for (const e of list) {
      if (!e || seen.has(e)) continue;
      seen.add(e);
      let m = this.models.get(e);
      if (!m) { m = this.make(e, e === p); if (!m) continue; this.models.set(e, m); this.group.add(m.root); }
      this.pose(m, e, scene, dt, t, e === p ? game : null);
    }
    for (const [e, m] of this.models) if (!seen.has(e)) { this.group.remove(m.root); this.models.delete(e); if (m === this.player) this.player = null; }
    // En cuevas y mazmorras el jugador lleva un farol
    this.lights.length = 0;
    if (p && scene.kind === 'grid') this.lights.push({ x: p.x, y: 1.8, z: p.y, intensity: 8, range: 14, color: '#ffc880', always: true, flicker: true });
  }

  make(e, isPlayer) {
    if (e.look) {
      // (las personas con el mismo aspecto se copian de la primera: hacer una desde cero cuesta)
      const key = JSON.stringify(e.look);
      if (!PEOPLE.has(key)) PEOPLE.set(key, new Person3D(e.look, ''));
      const person = PEOPLE.get(key).clone();
      const root = new THREE.Group();
      root.add(person.root);
      const m = { kind: 'person', root, person, prev: null, speed: 0 };
      if (isPlayer) {
        // El jugador tiene sus propios materiales (para dibujar su silueta) y va en la capa 2
        m.mats = [];
        person.root.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); m.mats.push(o.material); o.layers.set(2); } });
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
        this.hold(m, game);
      }
      P.update(dt, e.mount || e.boat ? 0 : m.speed);
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

  // La herramienta (o el arma) en la mano del jugador, y el golpe
  hold(m, game) {
    const held = game.inv.held, id = held?.id || null, g = game.gather;
    const show = game.gather.swing > 0 ? g.swingItem : id;
    if (m.holding !== show) {
      m.hand.clear();
      const tool = show && toolModel(show);
      if (tool) { tool.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); m.mats.push(o.material); o.layers.set(2); } }); m.hand.add(tool); }
      m.holding = show;
    }
    const arm = m.person.arms[1];
    if (g.swing > 0 && g.swingItem) { const k = 1 - g.swing / 0.25; arm.rotation.x = -2.4 + k * 3.0; arm.rotation.z = 0.15; }
    else { arm.rotation.z = 0; }
  }
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
export function toolModel(id) {
  const def = ITEMS[id];
  if (!def || !(def.tool || def.weapon)) return null;
  const head = mat({ color: TIERS[def.tier]?.head || '#b8c2ce', metalness: def.tier >= 3 ? 0.6 : 0.1, roughness: def.tier >= 3 ? 0.35 : 0.8 });
  const handle = M('#8a5a34'), g = new THREE.Group();
  const stick = (len, r = 0.022) => mesh(G.cyl, handle, { p: [0, len / 2 - 0.08, 0], s: [r, len, r] }, g);
  const kind = def.weapon ? 'espada' : def.tool;
  if (kind === 'hacha') { stick(0.55); mesh(G.cyl, head, { p: [0.07, 0.4, 0], s: [0.1, 0.03, 0.14], r: [Math.PI / 2, 0, 0] }, g); }
  else if (kind === 'pico') { stick(0.55); mesh(G.cyl, head, { p: [0, 0.44, 0], s: [0.025, 0.42, 0.025], r: [0, 0, Math.PI / 2] }, g); for (const s of [-1, 1]) mesh(G.cone, head, { p: [s * 0.23, 0.42, 0], s: [0.025, 0.08, 0.025], r: [0, 0, -s * 1.9] }, g); }
  else if (kind === 'guadana') { stick(0.7); const bl = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.02, 4, 12, 2), head); bl.position.set(-0.2, 0.6, 0); bl.castShadow = true; g.add(bl); }
  else if (kind === 'azada') { stick(0.6); mesh(G.cyl, head, { p: [0, 0.5, 0.06], s: [0.1, 0.02, 0.1] }, g); }
  else if (kind === 'regadera') { mesh(G.cyl, M('#7a9ab0', { metalness: 0.5, roughness: 0.4 }), { p: [0, 0.08, 0.1], s: [0.09, 0.18, 0.09] }, g); mesh(G.cyl, M('#7a9ab0', { metalness: 0.5 }), { p: [0, 0.12, 0.25], s: [0.015, 0.22, 0.015], r: [1.1, 0, 0] }, g); }
  else if (kind === 'cana') { mesh(G.cyl, handle, { p: [0, 0.6, 0.1], s: [0.012, 1.4, 0.012], r: [0.5, 0, 0] }, g); }
  else if (kind === 'red') { stick(0.7); const ring = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.012, 4, 14), M('#d8d0b8')); ring.position.set(0, 0.68, 0); ring.rotation.x = Math.PI / 2; g.add(ring); }
  else if (kind === 'espada') { mesh(G.cyl, handle, { p: [0, 0.02, 0], s: [0.025, 0.14, 0.025] }, g); mesh(G.cyl, M('#8a6a3a'), { p: [0, 0.1, 0], s: [0.12, 0.025, 0.03] }, g); mesh(G.cyl, def.weapon > 3 ? M('#f0c840', { metalness: 0.7, roughness: 0.3 }) : M('#c8d0d8', { metalness: 0.7, roughness: 0.3 }), { p: [0, 0.4, 0], s: [0.035, 0.55, 0.012] }, g); }
  else stick(0.5);
  g.rotation.x = Math.PI / 2 - 0.3;   // en la mano, hacia delante
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
