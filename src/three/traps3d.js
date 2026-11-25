// The fish traps (Plan R1-4, src/traps.js): the cork buoy of each one, bobbing, its line, and the wicker creel on the bed
// (seen under the water or wading). Hauled, the creel comes up beside the buoy with what went in, dripping, and goes back.
//
//   view3d.world.traps = new TrapsView(world3d)   frame(g, t)   instanceOf(key): its buoy's [mesh, i], for outline.js
//   haul(key, list, gone)   the player has just hauled it: list, what was in (traps.js catchOf); gone: it does not go back
//   creelModel(g)           the creel as a thing in the hand, on the ground and in the icons (food3d.js)
// One instanced mesh each for the buoys, the lines and the creels, filled again only when the traps near change; the buoys
// bob by their matrices, those within BOB_R
import * as THREE from 'three';
import { Kit, tube, taper, blot, C, mixTo, dry, shiny } from './fish3d.js';
import { foodModel } from './food3d.js';
import { WATER_Y } from '../world/biomes.js';
import { nearX } from '../world/planet.js';

const MAX = 48, BOB_R = 45, CREEL_R = 26, REST_EVERY = 1.5;   // instances; m; s between looks at the bed under them (the terrain arrives late)
const L = 0.31, R0 = 0.165;                       // the creel: half its length, its radius
const UP_S = 0.7, HOLD_S = 1.5, DOWN_S = 0.8;     // a haul: up, held, down
const O = new THREE.Object3D(), A = new THREE.Vector3(), B = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
let GEO = null;

// ---------- shapes ----------
const prof = z => R0 * (1 - 0.2 * (z / L) ** 2);   // (a barrel, flatter below)
const round = (a, r, z, flat = 0.82) => [Math.cos(a) * r, Math.sin(a) * r * (Math.sin(a) < 0 ? flat : 1), z];
function creel(kit) {
  const pale = C('#a98c5c'), brown = C('#6f5334'), wet = C('#4c3b27'), rope = C('#b7a37c'), stone = C('#77736a'), moss = C('#5d6a3c');
  const withy = (k = 0) => (x, y, z, o) => { mixTo(o, pale, brown, blot(x * 40 + k * 3, z * 22 + y * 30)); o.lerp(wet, 0.45 * Math.max(0, -y / R0)); };
  // the ribs, along it, and three more on the floor
  const N = 20;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, pts = [];
    for (let k = 0; k <= 5; k++) { const z = -L + (2 * L * k) / 5; pts.push(round(a + 0.03 * Math.sin(k * 2 + i), prof(z) - 0.004, z)); }
    kit.put(tube(pts, 0.0046, 8, 4), withy(i));
  }
  // the hoops, of ash, and the woven bands beside them
  for (const z of [-L, -0.11, 0.11, L]) {
    const pts = []; for (let i = 0; i <= 20; i++) pts.push(round((i / 20) * Math.PI * 2, prof(z) + 0.004, z));
    kit.put(tube(pts, 0.0085, 22, 5), (x, y, zz, o) => mixTo(o, C('#8a6a40'), brown, blot(x * 20, y * 20 + z * 9)));
  }
  for (const z0 of [-L + 0.03, -0.14, 0.08, L - 0.055]) for (let j = 0; j < 3; j++) {
    const z = z0 + j * 0.013, pts = [];
    for (let i = 0; i <= N * 2; i++) { const a = (i / (N * 2)) * Math.PI * 2; pts.push(round(a, prof(z) + ((i + j) & 1 ? 0.007 : -0.009), z)); }
    kit.put(tube(pts, 0.0042, N * 2, 3), withy(j + 7));
  }
  // the closed end: a little door of ribs, tied shut
  for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2, q = round(a, prof(L) - 0.006, -L); kit.put(tube([q, [q[0] * 0.5, q[1] * 0.5, -L - 0.02], [0, 0, -L - 0.028]], 0.0042, 4, 3), withy(i)); }
  for (const r of [0.05, 0.1]) { const p = []; for (let i = 0; i <= 18; i++) p.push(round((i / 18) * Math.PI * 2, r, -L - 0.024 + r * 0.14)); kit.put(tube(p, 0.005, 18, 4), withy(3)); }
  kit.put(tube([[0.03, 0.1, -L - 0.012], [0.015, 0.125, -L - 0.03], [-0.02, 0.12, -L - 0.02], [-0.03, 0.15, -L]], 0.005, 8, 4), rope);
  // the mouth: a funnel of withies inwards, their points free
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2, o = round(a, prof(L) - 0.004, L), q = round(a, 0.062, L - 0.13), e = round(a + 0.1, 0.042, L - 0.2);
    kit.put(tube([o, round(a, 0.11, L - 0.06), q, e], 0.004, 6, 3), withy(i + 2));
  }
  { const p = []; for (let i = 0; i <= 16; i++) p.push(round((i / 16) * Math.PI * 2, 0.085, L - 0.088)); kit.put(tube(p, 0.005, 16, 4), withy(1)); }
  // two flat stones tied to its floor, and the weed it has picked up
  for (const [x, z, s] of [[0.04, -0.14, 1], [-0.05, 0.02, 0.85]]) kit.put(new THREE.DodecahedronGeometry(1, 1), (px, py, pz, o) => mixTo(o, stone, C('#4f4c46'), blot(px * 3 + z * 9, pz * 3)), [x, -R0 * 0.66, z], [0.062 * s, 0.024, 0.05 * s], [0, z * 8, 0]);
  for (let i = 0; i < 7; i++) { const a = -0.5 - i * 0.37, z = -0.28 + ((i * 0.41) % 1) * 0.54, q = round(a, prof(z) + 0.004, z); kit.put(taper([q, [q[0] * 1.06, q[1] - 0.03, z + 0.01], [q[0] * 1.02, q[1] - 0.06, z + 0.03]], 0.006, 0.0015, 4, 3), moss); }
  // the bridle, to a knot over it
  for (const z of [-0.16, 0.16]) kit.put(tube([round(1.2, prof(z) + 0.005, z), [0.02, 0.24, z * 0.5], [0, 0.31, 0]], 0.0055, 8, 4), rope);
  for (const z of [-0.16, 0.16]) kit.put(tube([round(1.94, prof(z) + 0.005, z), [-0.02, 0.24, z * 0.5], [0, 0.31, 0]], 0.0055, 8, 4), rope);
  kit.put(new THREE.SphereGeometry(1, 8, 6), rope, [0, 0.315, 0], [0.014, 0.018, 0.014]);
}
// Two corks on a hazel stick with a faded rag, and a turn of the line floating by it. 0: where the water is
function buoy(kit) {
  const cork = C('#9c8260'), dark = C('#54432f'), red = C('#9a4a38'), pole = C('#8d714c'), rope = C('#c3b086'), wet = C('#53402c');
  for (const [y, h, r] of [[-0.058, 0.05, 0.1], [-0.004, 0.05, 0.096], [0.048, 0.046, 0.086]]) {
    const pts = [[0.012, -h / 2], [r * 0.94, -h / 2], [r, -h * 0.38], [r * 1.005, 0], [r * 0.99, h * 0.36], [r * 0.92, h / 2], [0.012, h / 2]].map(p => new THREE.Vector2(...p));
    kit.put(new THREE.LatheGeometry(pts, 22), (x, py, z, o) => {
      const a = Math.atan2(z, x);
      mixTo(o, cork, dark, 0.15 + 0.85 * blot(a * 9 + y * 90, py * 130 + y * 50) ** 2);
      o.lerp(dark, 0.5 * blot(x * 130 + 4, z * 130 + py * 90) ** 3);
      if (y > 0.04 && Math.hypot(x, z) > r * 0.5) o.lerp(red, 0.75 * (1 - blot(a * 5, py * 60 + 3) ** 1.6));
      if (y + py < -0.006) o.lerp(wet, 0.6);
    }, [0, y, 0]);
  }
  kit.put(taper([[0, -0.16, 0], [0.004, 0.1, 0.002], [0, 0.34, 0]], 0.0105, 0.007, 8, 6), (x, y, z, o) => mixTo(o, pole, C('#5c4730'), blot(x * 90, y * 24)));
  // (the rag: two faces, a little creased)
  const rag = new THREE.PlaneGeometry(0.13, 0.075, 6, 2), P = rag.attributes.position;
  for (let i = 0; i < P.count; i++) { const x = P.getX(i) + 0.065; P.setXYZ(i, x, P.getY(i) - 0.12 * x * (0.5 + x * 3), Math.sin(x * 48) * 0.012 * (0.3 + x * 6)); }
  rag.computeVertexNormals();
  kit.put(rag, (x, y, z, o) => mixTo(o, red, C('#c89a78'), 0.25 + 0.5 * blot(x * 60, y * 60)), [0.004, 0.295, 0]);
  for (let i = 0; i < 3; i++) kit.put(new THREE.TorusGeometry(0.012, 0.0032, 4, 10), rope, [0, 0.074 + i * 0.006, 0], 1, [Math.PI / 2, 0, 0]);
  kit.put(tube([[0, -0.004, 0.09], [0.07, 0.004, 0.14], [0.16, 0.004, 0.11], [0.2, 0.003, 0.01], [0.13, 0.004, -0.06], [0.04, -0.02, -0.07], [0, -0.1, -0.01]], 0.0048, 24, 4), rope);
}
const baked = f => { const k = new Kit(); f(k); return k.mesh(dry()).geometry; };
const geos = () => (GEO ||= { creel: baked(creel), buoy: baked(buoy), line: new THREE.CylinderGeometry(0.0055, 0.0055, 1, 5, 1).translate(0, 0.5, 0) });
let LINE = null;
const lineMat = () => (LINE ||= new THREE.MeshStandardMaterial({ color: '#a59471', roughness: 0.95 }));
export function creelModel(g) {
  const m = new THREE.Mesh(geos().creel, dry());
  m.scale.setScalar(0.62); m.position.y = -0.19; m.castShadow = true;
  g.add(m);
}
// A small brass bell with its clapper, hanging from its ring (the rod rest's)
export function bellModel() {
  const k = new Kit(), brass = C('#c9a046'), dull = C('#8a6a2c'), iron = C('#4a443c');
  const pts = [[0.0015, -0.004], [0.0105, -0.018], [0.016, -0.0285], [0.0185, -0.029], [0.0165, -0.026], [0.0128, -0.018], [0.0115, -0.009], [0.0085, -0.003], [0.0015, 0]].map(p => new THREE.Vector2(...p));
  k.put(new THREE.LatheGeometry(pts, 18), (x, y, z, o) => mixTo(o, brass, dull, 0.7 * blot(x * 160, y * 120 + z * 90)), [0, -0.016, 0]);
  k.put(new THREE.TorusGeometry(0.007, 0.0018, 4, 10), brass, [0, -0.01, 0]);
  k.put(new THREE.SphereGeometry(0.0048, 8, 6), iron, [0, -0.045, 0]);
  return k.mesh(shiny());
}

// One of what went in, on the creel's floor, at its size (the long ones along it, cut down to fit: they lie curled)
export function inCreel(c, i) {
  const f = foodModel(c.id);
  if (!f) return null;
  f.scale.setScalar(Math.min(1.3, Math.max(0.35, c.cm / 100 / 0.28)));
  f.position.set((i - 1) * 0.06, -R0 * 0.5 + i * 0.018, -0.1 + i * 0.075);
  f.rotation.set(0.05, (i & 1 ? Math.PI : 0) + (i - 1) * 0.22, 0.12 * (i - 1));
  return f;
}

export class TrapsView {
  constructor(world3d) {
    this.world3d = world3d; this.view = world3d.view;
    this.group = null; this.v = -1; this.px = 0; this.next = 0; this.list = []; this.at = new Map(); this.bed = new Map(); this.h = null;   // (bed: the creels drawn, key → instance)
  }
  make() {
    if (this.group) return;
    const G = geos();
    this.group = new THREE.Group(); this.group.name = 'traps';
    const im = (geo, m) => { const q = new THREE.InstancedMesh(geo, m, MAX); q.count = 0; q.visible = false; q.castShadow = false; q.receiveShadow = true; q.frustumCulled = false; this.group.add(q); return q; };
    this.buoys = im(G.buoy, dry()); this.lines = im(G.line, lineMat()); this.creels = im(G.creel, dry());
    this.world3d.group.add(this.group);
  }
  clear() { this.drop(); this.v = -1; this.list.length = 0; this.at.clear(); this.bed.clear(); if (this.group) this.group.visible = false; }
  instanceOf(key, creel = false) { const i = (creel ? this.bed : this.at).get(key); return i === undefined ? null : [creel ? this.creels : this.buoys, i]; }
  frame(g, t) {
    const T = g.traps, p = g.player;
    if (!T || !p || g.scene !== g.world || (!T.near.length && !this.h)) { if (this.group?.visible) this.clear(); return; }
    this.make();
    this.group.visible = true;
    if (T.v !== this.v || Math.abs(p.x - this.px) > 2000 || t > this.next || t < this.next - REST_EVERY * 2) { this.v = T.v; this.px = p.x; this.next = t + REST_EVERY; this.fill(T.near, p); }
    this.buoys.visible = this.list.length > 0;
    this.creels.visible = this.lines.visible = this.bed.size > 0;
    // the bob: up and down a little and leaning, each at its own time
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (Math.abs(e.x - p.x) > BOB_R || Math.abs(e.y - p.y) > BOB_R) continue;
      const q = t * 1.35 + e.ph, up = this.h?.key === e.key ? this.h.pull : 0;
      O.position.set(e.x, (e.dry ?? WATER_Y) + (e.dry === undefined ? 0.014 * Math.sin(q) + 0.008 * Math.sin(q * 2.3) : 0.06) + 0.05 * up, e.y);
      O.rotation.set(0.09 * Math.sin(q * 0.8) + 0.25 * up, e.yaw, (e.dry === undefined ? 0.07 * Math.sin(q * 1.1 + 1) : 1.2), 'YXZ');
      O.scale.setScalar(1); O.updateMatrix();
      this.buoys.setMatrixAt(i, O.matrix);
    }
    this.buoys.instanceMatrix.needsUpdate = true;
    if (this.h) this.hauling(g, t);
  }
  fill(near, p) {
    const V = this.view, n = Math.min(MAX, near.length);
    let c = 0;
    this.list.length = 0; this.at.clear(); this.bed.clear();
    for (let i = 0; i < n; i++) {
      const e = near[i], x = nearX(e.x, p.x), bed = V.bedY?.(x + e.cx, e.y + e.cy), b = Number.isFinite(bed) ? Math.min(bed, WATER_Y - 0.05) : WATER_Y - e.depth, dry_ = e.wet ? undefined : V.groundY(this.view.game?.world, x, e.y);
      const y = dry_ ?? b;
      this.list.push({ key: e.key, x, y: e.y, ph: e.yaw * 3, yaw: e.yaw, dry: dry_ });
      this.at.set(e.key, i);
      O.position.set(x, WATER_Y, e.y); O.rotation.set(0, e.yaw, 0); O.scale.setScalar(1); O.updateMatrix();
      this.buoys.setMatrixAt(i, O.matrix);
      if (Math.abs(x - p.x) > CREEL_R || Math.abs(e.y - p.y) > CREEL_R) continue;   // (the creel and its line, only near: from above, the water hides them)
      this.bed.set(e.key, c);
      O.position.set(x + e.cx, y + R0 * 0.8, e.y + e.cy); O.rotation.set(0.05, e.yaw + 0.7, 0.04); O.updateMatrix();
      this.creels.setMatrixAt(c, O.matrix);
      // (the line, from the bridle to the corks)
      A.set(x + e.cx, y + R0 * 0.8 + 0.31, e.y + e.cy); B.set(x, (dry_ ?? WATER_Y) - 0.1, e.y).sub(A);
      const len = Math.max(0.05, B.length());
      O.position.copy(A); O.quaternion.setFromUnitVectors(Y, B.normalize()); O.scale.set(1, len, 1); O.updateMatrix();
      this.lines.setMatrixAt(c++, O.matrix);
    }
    O.scale.setScalar(1); O.rotation.set(0, 0, 0);
    this.buoys.count = n; this.lines.count = this.creels.count = c;
    for (const m of [this.buoys, this.lines, this.creels]) m.instanceMatrix.needsUpdate = true;
  }

  // ---------- a haul ----------
  haul(key, list, gone = false) {
    const g = this.view.game, e = this.list.find(q => q.key === key);
    if (!g?.player || !e) return;
    this.make(); this.drop();
    const o = new THREE.Group(), m = new THREE.Mesh(geos().creel, dry());
    m.castShadow = true; o.add(m);
    // (what is in it, on its floor, at its size)
    list.forEach((c, i) => { const f = inCreel(c, i); if (f) o.add(f); });
    this.group.add(o);
    this.h = { key, o, t0: g.time, gone, x: e.x, y: e.y, pull: 0, drip: 0 };
  }
  drop() { if (this.h) { this.group?.remove(this.h.o); this.h = null; } }
  hauling(g) {
    const H = this.h, k = g.time - H.t0, i = this.bed.get(H.key), end = UP_S + HOLD_S + (H.gone ? 0 : DOWN_S);
    if (k > end || k < 0) { this.drop(); this.next = 0; return; }
    const up = k < UP_S ? k / UP_S : k < UP_S + HOLD_S ? 1 : 1 - (k - UP_S - HOLD_S) / DOWN_S, s = up * up * (3 - 2 * up);
    H.pull = s;
    const p = g.player, dx = p.x - H.x, dy = p.y - H.y, l = Math.hypot(dx, dy) || 1;
    H.o.position.set(H.x + (dx / l) * 0.35 * s, WATER_Y - 0.75 + 1.02 * s, H.y + (dy / l) * 0.35 * s);
    H.o.rotation.set(0.1 * Math.sin(k * 5) * s, Math.atan2(dx, dy) + 0.9, 0.08 * Math.sin(k * 4.1 + 1));
    if (i !== undefined) { O.position.set(0, -500, 0); O.scale.setScalar(0.0001); O.updateMatrix(); this.creels.setMatrixAt(i, O.matrix); this.creels.instanceMatrix.needsUpdate = true; O.scale.setScalar(1); }
    if (s > 0.6 && k > H.drip) { H.drip = k + 0.22; g.gather.chips(H.o.position.x, H.o.position.z, 'water', 2); if (Math.random() < 0.5) g.view3d.fx?.rippleAt?.(H.o.position.x, H.o.position.z, 0.35, 0.35); }
  }
  // Copies for engine.js prepare, so their programs are ready before the first trap
  proxies() {
    if (this.proxyGroup) return this.proxyGroup;
    const G = geos(), g = new THREE.Group();
    for (const [geo, m] of [[G.buoy, dry()], [G.line, lineMat()]]) { const q = new THREE.InstancedMesh(geo, m, 1); q.castShadow = false; q.receiveShadow = true; q.frustumCulled = false; g.add(q); }
    g.add(bellModel());
    return (this.proxyGroup = g);
  }
}
