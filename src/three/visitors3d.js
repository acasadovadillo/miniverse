// The birds that come down to the garden (src/visitors.js): sparrows, blackbirds and crows. One shape each (body, head and
// wing, merged and painted by vertex: the shared paint of tints.js, no program of their own), made the first time one is seen;
// folded on the ground, where they peck and hop, and beating in the air. At most a handful, near the player only.
import * as THREE from 'three';
import { tintMats } from './tints.js';
import { mergeParts, paint } from './geo.js';
import { nearX } from '../world/planet.js';

// size: from bill to tail (m); back, wing, belly, head, cap, bill, legs: its colours; tail: how long; stout: how round
const KINDS = {
  sparrow: { size: 0.2, back: '#6e5238', wing: '#54402c', belly: '#a89a86', head: '#7a6a58', cap: '#5c4430', bill: '#4a4238', legs: '#8a6a52', tail: 0.34, stout: 1.08, bar: '#c8bca4' },
  blackbird: { size: 0.28, back: '#1c1a1a', wing: '#161414', belly: '#242120', head: '#1c1a1a', cap: '#1c1a1a', bill: '#c8842a', legs: '#4a3a2c', tail: 0.46, stout: 0.95 },
  crow: { size: 0.5, back: '#17171b', wing: '#111115', belly: '#1c1c20', head: '#17171b', cap: '#17171b', bill: '#1a1a1c', legs: '#1c1a1a', tail: 0.4, stout: 0.88, beak: 1.6 },
};
const GEOS = new Map(), C = new THREE.Color();
const at = (g, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz)));
const ball = (c, ...p) => paint(at(new THREE.SphereGeometry(1, 12, 9), ...p), c);
// A drop: round in front, drawn out to the tail; its back and its belly of two colours
function drop(K) {
  const g = new THREE.SphereGeometry(1, 16, 12), p = g.attributes.position, col = new Float32Array(p.count * 3), a = new THREE.Color(K.back), b = new THREE.Color(K.belly);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), r = z < 0 ? 1 - 0.55 * z * z : 1;
    p.setXYZ(i, x * 0.2 * K.stout * r, y * 0.2 * K.stout * r + (z < 0 ? -z * 0.02 : -z * 0.015), z * 0.34);
    C.copy(a).lerp(b, THREE.MathUtils.smoothstep(-y, -0.15, 0.45)); col.set([C.r, C.g, C.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
  return g;
}
// A feather fan lying flat, from its root (0) to +z, w wide at the end
function fan(c, len, w0, w1, n = 5, lift = 0) {
  const pos = [];
  for (let i = 0; i < n; i++) { const u0 = i / n * 2 - 1, u1 = (i + 1) / n * 2 - 1, e = v => [v * w1, lift * (1 - v * v), len * (1 - 0.18 * v * v)], s = v => [v * w0, 0, 0]; for (const q of [[s(u0), e(u0), e(u1)], [s(u0), e(u1), s(u1)]]) { pos.push(...q.flat()); pos.push(...[q[0], q[2], q[1]].flatMap(v => [v[0], v[1] - 0.008, v[2]])); } }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(pos.length / 3 * 2).fill(0), 2)); g.computeVertexNormals();
  return paint(g, c);
}
function geos(kind) {
  if (GEOS.has(kind)) return GEOS.get(kind);
  const K = KINDS[kind], body = [drop(K), at(fan(K.wing, K.tail, 0.05, 0.1), 0, 0.02, -0.26, 0.1, Math.PI, 0)], legs = [];
  for (const s of [-1, 1]) {
    legs.push(paint(at(new THREE.CylinderGeometry(0.014, 0.012, 0.22, 5), s * 0.07, -0.25, 0.02, 0.12), K.legs));
    for (const a of [-0.5, 0, 0.5]) legs.push(paint(at(new THREE.CylinderGeometry(0.006, 0.011, 0.11, 4), s * 0.07 + Math.sin(a) * 0.05, -0.355, 0.035 + Math.cos(a) * 0.05, Math.PI / 2, a * -1, 0), K.legs));
  }
  // (the folded wings, along its sides)
  const folded = [];
  for (const s of [-1, 1]) {
    folded.push(ball(K.wing, s * 0.175 * K.stout, 0.03, -0.06, 0.1, s * -0.1, s * 0.2, 0.035, 0.12, 0.27), at(fan(K.wing, 0.24, 0.05, 0.02, 3), s * 0.13, 0.03, -0.24, 0.06, Math.PI + s * 0.12, 0));
    if (K.bar) folded.push(ball(K.bar, s * 0.2 * K.stout, 0.06, 0.02, 0.1, s * -0.1, s * 0.2, 0.014, 0.03, 0.1));
  }
  const head = [ball(K.head, 0, 0, 0, 0, 0, 0, 0.115, 0.11, 0.125), ball(K.cap, 0, 0.035, -0.012, 0, 0, 0, 0.1, 0.085, 0.11), ball(K.head, 0, -0.07, -0.06, 0.6, 0, 0, 0.11, 0.12, 0.11)];
  head.push(paint(at(new THREE.ConeGeometry(0.038 * (K.beak ? 1.2 : 1), 0.13 * (K.beak || 1), 7), 0, -0.012, 0.11 + 0.055 * (K.beak || 1), Math.PI / 2 + 0.1), K.bill));
  for (const s of [-1, 1]) head.push(ball('#0c0a0a', s * 0.088, 0.022, 0.058, 0, 0, 0, 0.018));
  // (a wing open to +x, its root at the shoulder)
  const wing = [at(fan(K.wing, 0.5, 0.13, 0.17, 6, 0.03), 0, 0, 0, 0, Math.PI / 2, 0), at(fan(K.back, 0.3, 0.1, 0.13, 4, 0.05), 0, 0.012, 0.03, 0, Math.PI / 2, 0)];
  const m = list => mergeParts(list), g = { K, body: m(body), legs: m(legs), folded: m(folded), head: m(head), wing: m(wing) };
  GEOS.set(kind, g);
  return g;
}

export function birdModel(kind) {
  const G = geos(kind), mat = tintMats().paint, root = new THREE.Group(), tilt = new THREE.Group(), mesh = (g, parent) => { const o = new THREE.Mesh(g, mat); o.userData.shared = true; parent.add(o); return o; };
  root.add(tilt); tilt.position.y = 0.36;
  mesh(G.body, tilt);
  const legs = mesh(G.legs, root); legs.position.y = 0.36;
  const folded = mesh(G.folded, tilt), head = new THREE.Group(), wings = [1, -1].map(s => { const w = new THREE.Group(); w.position.set(s * 0.1, 0.08, 0.06); if (s < 0) w.rotation.y = Math.PI; mesh(G.wing, w); tilt.add(w); return w; });
  head.position.set(0, 0.17, 0.24); tilt.add(head); mesh(G.head, head);
  root.scale.setScalar(G.K.size / 0.78);
  root.userData = { tilt, legs, folded, head, wings };
  return root;
}
// How it stands or flies: st 'down' | 'hop' | 'in' | 'out'; peck: seconds on the ground; wing: the beat's phase
export function poseBird(root, st, peck, wing, glide = 0) {
  const u = root.userData, fly = st === 'in' || st === 'out';
  for (const w of u.wings) w.visible = fly;
  u.folded.visible = u.legs.visible = !fly;
  if (fly) {
    const a = Math.sin(wing) * 0.95 * (1 - glide * 0.7) + 0.15;
    u.wings[0].rotation.z = a; u.wings[1].rotation.z = a;
    u.tilt.rotation.x = st === 'out' ? -0.35 : 0.1 - glide * 0.5; u.head.rotation.x = 0.1;
    return;
  }
  // (three or four quick pecks, then up, looking round)
  const c = peck % 3.4, down = st === 'hop' ? 0 : c < 1.5 ? Math.max(0, Math.sin(c * Math.PI * 4.2)) * 0.85 + 0.15 : 0;
  u.tilt.rotation.x = 0.12 + down * 0.75; u.head.rotation.x = down * 0.7 - 0.1; u.head.rotation.y = down > 0.1 ? 0 : Math.sin(Math.floor(peck * 1.6) * 2.4) * 0.8;
}

export class VisitorsView {
  constructor(view) { this.view = view; this.group = new THREE.Group(); view.scene.add(this.group); this.models = new Map(); }
  update(game, scene) {
    const V = game.visitors, list = V && scene === game.world ? V.birds : null;
    if (!list?.length) { if (this.models.size) { for (const m of this.models.values()) this.group.remove(m); this.models.clear(); } return; }
    for (const [id, m] of this.models) if (!list.some(b => b.id === id)) { this.group.remove(m); this.models.delete(id); }
    for (const b of list) {
      let m = this.models.get(b.id);
      if (!m) { m = birdModel(b.kind); this.models.set(b.id, m); this.group.add(m); }
      const x = game.player ? nearX(b.x, game.player.x) : b.x;
      m.visible = b.st !== 'in' || b.t > 0;
      m.position.set(x, this.view.groundY(scene, x, b.y) + b.z + 0.05 * (b.st === 'down' ? 1 : 0), b.y);
      m.rotation.y = b.yaw;
      poseBird(m, b.st, b.peck, b.wing, b.st === 'in' ? Math.max(0, Math.min(1, b.t / 1.9)) : 0);
    }
  }
}
