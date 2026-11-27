// The wedding's art (docs/planes/gta/PLAN-I-juntos.md §5; missions/wedding.js): the arch of woven branches with its flowers, the
// ring (its icon, and dropped), and the petals that fall at the kiss (fx.js). The cake is food: food3d.js
//
// The arch is two tiles wide, as the sofa (the tile and the one at its right, +x): its middle at local x 0.5, the posts at x −0.3
// and 1.3 (world/scenes.js archPosts: only they are solid), its front to +z. Leaves and flowers go straight into their builders
// (Model.B), so the hundreds of small pieces add no boxes: the model gives only a few, those of its posts and its top.
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const rnd = s => () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
const m4 = (x, y, z, rx = 0, ry = 0, rz = 0, s = 1) => new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), typeof s === 'number' ? V(s, s, s) : V(...s));
// A curve through points (a branch)
const tube = (pts, r, seg = 40, rs = 6) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, r, rs, false);
let G = null;
function geos() {
  if (G) return G;
  // A leaf: a pointed oval, a little folded along its rib
  const leaf = new THREE.BufferGeometry(), P = [], I = [];
  const N = 6;
  for (let i = 0; i <= N; i++) { const v = i / N, w = Math.sin(Math.PI * v) * 0.45 * (1 - 0.25 * v); P.push(-w, v, 0.12 * w, 0, v, 0, w, v, 0.12 * w); }
  for (let i = 0; i < N; i++) { const a = i * 3; I.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5); }
  leaf.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); leaf.setIndex(I); leaf.computeVertexNormals();
  leaf.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(P.length / 3 * 2).fill(0), 2));
  // A daisy's ring of petals: a star of 12 rounded rays, a touch cupped
  const daisy = new THREE.Shape(), K = 12;
  for (let i = 0; i <= K * 4; i++) { const a = (i / (K * 4)) * Math.PI * 2, r = 0.25 + 0.75 * Math.abs(Math.sin(a * K / 2)) ** 0.6; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (i) daisy.lineTo(x, y); else daisy.moveTo(x, y); }
  const star = new THREE.ShapeGeometry(daisy, 2).rotateX(-Math.PI / 2);
  const pos = star.attributes.position; for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i); pos.setY(i, 0.12 * (x * x + z * z)); } star.computeVertexNormals();
  // A rose: a few cupped petals round a bud (a half sphere squashed, turned)
  const petal = new THREE.SphereGeometry(1, 8, 5, 0, Math.PI * 1.1, 0, Math.PI / 2);
  const ball = new THREE.SphereGeometry(1, 8, 6), disc = new THREE.SphereGeometry(1, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  return (G = { leaf, star, petal, ball, disc });
}
const add = (m, key, g, M) => m.B(key).addGeometry(g, M);

// The arch: posts of rough poles (bark on), the top bent of three green branches woven together, ivy and wild roses climbing
// the posts, daisies and roses thick along the top, a white ribbon tied at the crown
export function archModel(m) {
  const R = rnd(7), Q = geos(), cx = 0.5, H = 2.05, A = 0.8, posts = [-0.3, 1.3];
  // (the poles: a little crooked, thicker at the foot, set in a mound of earth and a few stones)
  for (const [i, x] of posts.entries()) {
    const lean = (i ? -1 : 1) * 0.012;
    m.B('logBark').addGeometry(tube([V(x, -0.05, 0), V(x + lean, 0.8, 0.012), V(x - lean, 1.6, -0.01), V(x, H + 0.06, 0)], 0.072, 12, 9), new THREE.Matrix4());
    m.geo('dirt', new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), x, 0, 0, [0, 0, 0], [0.24, 0.07, 0.22]);
    for (let k = 0; k < 4; k++) { const a = k * 1.7 + i; m.ball('rock', x + Math.cos(a) * 0.2, 0.02, Math.sin(a) * 0.17, 0.06 + R() * 0.03, 0.035, 0.05, 6); }
    m.solids.push([x - 0.08, 0, -0.08, x + 0.08, H, 0.08]);
  }
  // (the top: the thick bent branch and two thin ones wound round it)
  const arc = (t, r = A, dz = 0) => { const a = Math.PI * (1 - t); return V(cx + Math.cos(a) * r, H + Math.sin(a) * r * 0.92, dz); };
  const pts = (fn, n = 24) => Array.from({ length: n + 1 }, (_, i) => fn(i / n));
  add(m, 'logBark', tube(pts(t => arc(t)), 0.05, 48, 8), new THREE.Matrix4());
  for (const ph of [0, Math.PI]) add(m, 'leafc:#6a5a3e', tube(pts(t => { const w = t * Math.PI * 9 + ph, p = arc(t, A + Math.cos(w) * 0.06); p.z = Math.sin(w) * 0.06; return p; }, 72), 0.016, 144, 5), new THREE.Matrix4());
  for (const [i, x] of posts.entries()) add(m, 'leafc:#6a5a3e', tube(pts(t => V(x + Math.cos(t * Math.PI * 7 + i) * 0.085, 0.15 + t * (H - 0.1), Math.sin(t * Math.PI * 7 + i) * 0.085), 56), 0.013, 112, 5), new THREE.Matrix4());
  m.solids.push([-0.35, H, -0.12, 1.35, H + A + 0.08, 0.12]);
  // (leaves along it all: denser on the top, thinning down the posts)
  const GREEN = ['leafc:#4f6a32', 'leafc:#5f7a3c', 'leafc:#46602e', 'leafc:#6a8244'];
  const leafAt = (p, out, s) => { const a = R() * 6.28, M = m4(p.x + out.x * 0.05, p.y + out.y * 0.05, p.z + (R() - 0.5) * 0.14, (R() - 0.5) * 1.6, a, Math.atan2(out.x, out.y) + (R() - 0.5) * 1.2, s); add(m, GREEN[Math.floor(R() * GREEN.length)], Q.leaf, M); };
  for (let i = 0; i < 150; i++) { const t = R(), p = arc(t), a = Math.PI * (1 - t); leafAt(p, V(Math.cos(a), Math.sin(a), 0), 0.07 + R() * 0.05); }
  for (const x of posts) for (let i = 0; i < 46; i++) { const y = 0.25 + (1 - R() ** 1.6) * (H - 0.25), a = R() * 6.28; leafAt(V(x + Math.cos(a) * 0.08, y, Math.sin(a) * 0.08), V(Math.cos(a), 0.4, 0), 0.06 + R() * 0.04); }
  // (the flowers: daisies, wild roses white and pink, a few yellow; each one facing out and to the front a little)
  const flower = (p, out, kind) => {
    const fz = 0.75 + R() * 0.2, rx = -Math.PI / 2 + Math.atan2(out.y, fz) * 0.6 + (R() - 0.5) * 0.4, rz = -Math.atan2(out.x, 1) * 0.7;
    const at = V(p.x + out.x * 0.07, p.y + out.y * 0.07, p.z + 0.06 + (R() - 0.5) * 0.1);
    if (kind === 'daisy') { const s = 0.045 + R() * 0.015; add(m, 'leafc:#f3efe4', Q.star, m4(at.x, at.y, at.z, rx, 0, rz, s)); add(m, 'leafc:#e0ad22', Q.disc, m4(at.x, at.y, at.z, rx, 0, rz, [s * 0.32, s * 0.2, s * 0.32])); return; }
    const c = kind === 'pink' ? ['fruit:#e9a6b4', 'fruit:#d98898'] : kind === 'yellow' ? ['fruit:#f2d47a', 'fruit:#e2b850'] : ['fruit:#f6efe6', 'fruit:#e8ddd0'], s = 0.034 + R() * 0.012;
    for (let k = 0; k < 5; k++) add(m, c[k % 2], Q.petal, m4(at.x, at.y, at.z, rx + 0.5, (k / 5) * 6.28, rz, [s, s * 0.9, s]));
    add(m, c[1], Q.ball, m4(at.x, at.y + 0.004, at.z, 0, 0, 0, s * 0.45));
  };
  const KINDS = ['daisy', 'white', 'pink', 'daisy', 'pink', 'yellow', 'daisy', 'white'];
  for (let i = 0; i < 46; i++) { const t = 0.02 + (i / 45) * 0.96 + (R() - 0.5) * 0.02, a = Math.PI * (1 - t); flower(arc(t, A + (R() - 0.5) * 0.06), V(Math.cos(a), Math.sin(a), 0), KINDS[i % KINDS.length]); }
  for (const x of posts) for (let i = 0; i < 9; i++) { const y = H - (i / 9) ** 1.3 * 1.5, a = R() * 3 - 1.5; flower(V(x + Math.sin(a) * 0.08, y, Math.cos(a) * 0.08), V(Math.sin(a), 0.3, 0), KINDS[(i + 3) % KINDS.length]); }
  // (the ribbon at the crown: a bow and its two tails hanging)
  const top = arc(0.5);
  for (const s of [-1, 1]) {
    m.geo('cloth', new THREE.TorusGeometry(0.06, 0.016, 6, 12), cx + s * 0.06, top.y - 0.02, 0.07, [0, 0, s * 0.5], [1, 0.6, 0.5]);
    m.geo('cloth', new THREE.BoxGeometry(0.035, 0.24, 0.004), cx + s * 0.035, top.y - 0.15, 0.08, [0.08, 0, s * 0.22]);   // (the two tails, short and flat)
  }
  m.ball('cloth', cx, top.y - 0.02, 0.075, 0.022, 0.02, 0.016, 8);
}

// The ring: plain gold, with one small stone (on its edge, as one finds it)
export function ringModel(m) {
  m.geo('gold', new THREE.TorusGeometry(0.075, 0.016, 12, 40), 0, 0.091, 0);
  m.geo('gold', new THREE.CylinderGeometry(0.02, 0.014, 0.022, 8), 0, 0.182, 0);
  m.geo('fruit:#eef6ff', new THREE.OctahedronGeometry(0.02, 0), 0, 0.2, 0, [0, 0.4, 0], [1, 0.8, 1]);
}

// ---------- the petals (fx.js): an instanced mesh of small curled petals, lit, falling and swaying ----------
const CAP = 200;
export class Petals {
  constructor(group) {
    const g = new THREE.SphereGeometry(1, 5, 3, 0, Math.PI, 0, Math.PI / 2.4).scale(0.035, 0.012, 0.026);
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7, side: THREE.DoubleSide }), CAP);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.castShadow = false; group.add(this.mesh);
    this.tmp = new THREE.Object3D(); this.col = new THREE.Color();
  }
  // list: missions/wedding.js petals; gy(x, y): the ground; near(x): the x by the player (the world wraps round)
  update(list, dt, gy, near) {
    if (!list.length) { if (this.mesh.count) this.mesh.count = 0; return; }
    const M = this.mesh, o = this.tmp;
    let n = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const q = list[i];
      q.t += dt;
      if (q.t >= q.life) { list.splice(i, 1); continue; }
      q.g ??= gy(q.x, q.y);
      const sway = Math.sin(q.t * 2.6 + q.ph);
      q.x += (q.vx + sway * 0.25) * dt; q.y += (q.vy + Math.cos(q.t * 2.1 + q.ph) * 0.2) * dt;
      q.z = Math.max(0.02, q.z - (0.42 + 0.15 * Math.sin(q.ph)) * dt);
      if (n >= CAP) continue;
      o.position.set(near(q.x), q.g + q.z, q.y);
      o.rotation.set(sway * 0.9 + q.ph, q.t * 1.7 + q.ph, Math.cos(q.t * 2.3 + q.ph) * 0.7);
      const k = Math.min(1, (q.life - q.t) * 1.5);
      o.scale.setScalar(Math.max(0.001, k));
      o.updateMatrix(); M.setMatrixAt(n, o.matrix); M.setColorAt(n, this.col.set(q.c)); n++;
    }
    M.count = n;
    M.instanceMatrix.needsUpdate = true;
    if (M.instanceColor) M.instanceColor.needsUpdate = true;
  }
}
