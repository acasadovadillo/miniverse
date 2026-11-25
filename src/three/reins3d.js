// The reins and the lead rope (Plan R4-4, docs/planes/realismo/PLAN-R4-caballo.md §5): drawn only while they are used. Leading, a
// rope from the horse's noseband to the leader's free hand (three/actors.js poses it); tied, from the noseband to the knot, with its
// turns round the rail, the post or the trunk; riding, the two reins from the bit to the rider's hands, over the sides of the neck.
// Thin tubes whose points are written each frame (nothing is allocated), one draw each; none, and nothing is done
import * as THREE from 'three';
import { nearX } from '../world/planet.js';

const FAR = 45, MAX = 10;                     // m from the player, and how many at once
const ROPE = { r: 0.0115, n: 22, sides: 5, lead: 1.5, tie: 1.25 }, REIN = { r: 0.0075, n: 12, sides: 4, slack: 0.05 };
const PTS = new Float64Array((ROPE.n + 1) * 3), A = new THREE.Vector3(), B = new THREE.Vector3(), P0 = new THREE.Vector3(), P1 = new THREE.Vector3();
const MID = new THREE.Vector3(), PALM = new THREE.Vector3(0, -0.075, 0.015);

// strands tubes of n segments in one geometry. tint(i): the brightness of ring i (the twist of a rope)
class Cord {
  constructor(mat, strands, { r, n, sides }, tint) {
    const vn = strands * (n + 1) * sides, pos = new Float32Array(vn * 3), nor = new Float32Array(vn * 3), col = new Float32Array(vn * 3), idx = [];
    for (let k = 0, m = 0; k < strands; k++) for (let i = 0; i <= n; i++) for (let j = 0; j < sides; j++, m++) {
      const c = tint(i, j); col[m * 3] = col[m * 3 + 1] = col[m * 3 + 2] = c;
      if (i < n) { const a = (k * (n + 1) + i) * sides + j, b = (k * (n + 1) + i) * sides + (j + 1) % sides; idx.push(a, b, a + sides, b, b + sides, a + sides); }
    }
    const g = this.geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage); this.nor = new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos); g.setAttribute('normal', this.nor); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere();
    this.mesh = new THREE.Mesh(g, mat); this.mesh.visible = false; this.mesh.userData.shared = true;
    this.r = r; this.n = n; this.sides = sides;
    this.cos = Float64Array.from({ length: sides }, (_, j) => Math.cos(j / sides * Math.PI * 2)); this.sin = Float64Array.from({ length: sides }, (_, j) => Math.sin(j / sides * Math.PI * 2));
  }
  // Strand k from a to b: hanging, if it is longer than that (len m), and never under floor; or a curve by mid
  lay(k, a, b, len, floor, mid = null) {
    const { n, sides, r } = this, d = a.distanceTo(b), sag = mid ? 0 : len > d ? Math.sqrt(0.375 * d * (len - d)) : 0, p = this.pos.array, q = this.nor.array;
    // (the points first; the direction at each, from its two neighbours)
    for (let i = 0, o = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      let y;
      if (mid) { const w = u * u, v = 2 * u * t, z = t * t; PTS[o++] = a.x * w + mid.x * v + b.x * z; y = a.y * w + mid.y * v + b.y * z; PTS[o++] = y < floor ? floor : y; PTS[o++] = a.z * w + mid.z * v + b.z * z; }
      else { PTS[o++] = a.x * u + b.x * t; y = a.y * u + b.y * t - 4 * sag * t * u; PTS[o++] = y < floor ? floor : y; PTS[o++] = a.z * u + b.z * t; }
    }
    let m = k * (n + 1) * sides * 3;
    for (let i = 0; i <= n; i++) {
      const c = i * 3, d0 = i ? c - 3 : c, d1 = i < n ? c + 3 : c;
      let tx = PTS[d1] - PTS[d0], ty = PTS[d1 + 1] - PTS[d0 + 1], tz = PTS[d1 + 2] - PTS[d0 + 2];
      const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      let sx = tz, sz = -tx;
      const sl = Math.sqrt(sx * sx + sz * sz);
      if (sl < 1e-3) { sx = 1; sz = 0; } else { sx /= sl; sz /= sl; }
      const ux = ty * sz, uy = tz * sx - tx * sz, uz = -ty * sx;   // (T x S)
      for (let j = 0; j < sides; j++, m += 3) {
        const cs = this.cos[j], sn = this.sin[j];
        q[m] = sx * cs + ux * sn; q[m + 1] = uy * sn; q[m + 2] = sz * cs + uz * sn;
        p[m] = PTS[c] + q[m] * r; p[m + 1] = PTS[c + 1] + q[m + 1] * r; p[m + 2] = PTS[c + 2] + q[m + 2] * r;
      }
    }
    const sp = this.geo.boundingSphere;
    sp.center.lerpVectors(a, b, 0.5); sp.radius = d * 0.5 + sag + 0.4;
  }
  done() { this.pos.needsUpdate = this.nor.needsUpdate = true; this.mesh.visible = true; }
}

// The knot: the turns of the rope and its hanging end, round a rail (along x) or a post or a trunk of radius r (upright)
const KNOTS = new Map();
function knotGeo(kind, r) {
  const key = `${kind}:${r.toFixed(2)}`;
  if (KNOTS.has(key)) return KNOTS.get(key);
  const list = [], t = 0.0125, seg = r > 0.15 ? 26 : 14, rail = kind === 'post', R = r + t * 0.75;
  for (let i = 0; i < 3; i++) {
    const g = new THREE.TorusGeometry(R, t, 5, seg);
    if (rail) g.rotateY(Math.PI / 2).rotateZ(0.1 * (i - 1)).translate((i - 1) * t * 1.95, 0, 0); else g.rotateX(Math.PI / 2 + 0.06 * (i - 1)).translate(0, (i - 1) * t * 1.9, 0);
    list.push(g);
  }
  // (the hitch, on the horse's side: a turn across the others, the bight and the end)
  const z = R + t * 0.5, curve = pts => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(q => new THREE.Vector3(...q))), 14, t * 0.85, 5);
  const hitch = new THREE.TorusGeometry(0.026, t * 0.95, 5, 10); if (rail) hitch.rotateX(0.35); hitch.translate(0.004, -0.004, z); list.push(hitch);
  list.push(curve([[0, 0.01, z + 0.004], [0.03, -0.04, z + 0.02], [0.016, -0.1, z + 0.014], [-0.006, -0.05, z + 0.016], [0.004, 0.0, z]]));
  list.push(curve([[-0.01, -0.01, z], [-0.03, -0.1, z + 0.014], [-0.022, -0.22, z + 0.004], [-0.036, -0.33, z + 0.01]]));
  const end = new THREE.SphereGeometry(0.018, 7, 5).translate(-0.036, -0.335, z + 0.01); list.push(end);
  const flat = list.map(q => (q.index ? q.toNonIndexed() : q)), count = flat.reduce((s, q) => s + q.attributes.position.count, 0), g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal']) { const all = new Float32Array(count * 3); let o = 0; for (const q of flat) { all.set(q.attributes[name].array, o); o += q.attributes[name].array.length; } g.setAttribute(name, new THREE.BufferAttribute(all, 3)); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(count * 3).fill(0.92), 3));
  g.computeBoundingSphere();
  KNOTS.set(key, g);
  return g;
}

export class ReinsView {
  constructor(fx) {
    this.fx = fx; this.view = fx.view;
    this.ropes = []; this.reins = []; this.knots = [];
    this.own = { rope: null, reins: null, m: null };   // (the player's own: drawn with the player, see mine)
    this.n = this.k = this.m = 0;
  }
  mats() {
    if (!this.rope) {
      this.rope = new THREE.MeshStandardMaterial({ color: '#a98a5c', roughness: 0.95, vertexColors: true });
      this.leather = new THREE.MeshStandardMaterial({ color: '#3b2012', roughness: 0.7, vertexColors: true });
    }
  }
  ropeAt(i) {
    if (!this.ropes[i]) { this.mats(); this.ropes[i] = this.newRope(); }
    return this.ropes[i];
  }
  reinsAt(i) {
    if (!this.reins[i]) { this.mats(); this.reins[i] = this.newReins(); }
    return this.reins[i];
  }
  // The player's own rope or reins, over what they hold it in front of: in the passes of the player (engine.js draw), else their
  // silhouette would show through it. Their materials are the model's: made again with it
  mine(kind, X) {
    const O = this.own, m = X.player;
    if (!O[kind]) { this.mats(); O[kind] = kind === 'rope' ? this.newRope() : this.newReins(); O.m = null; }
    if (O.m !== m) { O.m = m; for (const k of ['rope', 'reins']) if (O[k] && m?.mats) { O[k].mesh.material = k === 'rope' ? this.rope : this.leather; X.own(O[k].mesh, m); } }
    return O[kind];
  }
  newRope() { const c = new Cord(this.rope, 1, ROPE, (q, j) => 0.78 + 0.3 * (((q + j * 2) % 5) / 4)); this.fx.group.add(c.mesh); return c; }
  newReins() { const c = new Cord(this.leather, 2, REIN, (q, j) => 0.85 + 0.15 * (j & 1)); this.fx.group.add(c.mesh); return c; }
  knotAt(i) {
    if (!this.knots[i]) { this.mats(); const m = new THREE.Mesh(undefined, this.rope); m.visible = false; m.castShadow = false; m.userData.shared = true; this.fx.group.add(m); this.knots[i] = m; }
    return this.knots[i];
  }

  update(game, scene, playing) {
    const was = this.n + this.k + this.m, LD = game.horselead, p = game.player;
    this.n = this.k = this.m = 0;
    const O = this.own, had = !!(O.rope?.mesh.visible || O.reins?.mesh.visible);
    if (O.rope) O.rope.mesh.visible = false;
    if (O.reins) O.reins.mesh.visible = false;
    if (playing && scene === game.world && !this.view.cave && LD && !LD.off && p) {
      const X = this.view.actors, list = game.ranch?.animals || [];
      for (const a of list) {
        if (!a.lead && !a.tie) continue;
        if (a.rider || this.n >= MAX || Math.abs(nearX(a.x, p.x) - p.x) > FAR || Math.abs(a.y - p.y) > FAR) continue;
        const m = X.models.get(a);
        if (!m?.root.visible || !m.root.userData.chin) continue;
        if (a.lead) this.led(game, a, m, X); else this.tied(game, scene, a, m);
      }
      if (p.mount) this.ridden(X.player, X);
      if (game.live?.joined) for (const peer of game.live.peers.values()) {
        const e = peer.entity;
        if (e?.mount && peer.sc === 'world' && this.k < 4 && Math.abs(nearX(e.x, p.x) - p.x) < FAR / 2 && Math.abs(e.y - p.y) < FAR / 2) this.ridden(X.models.get(e));
      }
    } else if (!was && !had) return;
    for (let i = this.n; i < this.ropes.length; i++) this.ropes[i].mesh.visible = false;
    for (let i = this.k; i < this.reins.length; i++) this.reins[i].mesh.visible = false;
    for (let i = this.m; i < this.knots.length; i++) this.knots[i].visible = false;
  }
  chin(m, out) {
    const u = m.root.userData;
    u.head.updateWorldMatrix(true, false);
    return out.copy(u.chin).applyMatrix4(u.head.matrixWorld);
  }
  hand(P, i, out) {
    const b = P?.r?.bones, h = b && (i ? b.handL : b.handR);
    if (!h) return false;
    h.updateWorldMatrix(true, false);
    out.copy(PALM).applyMatrix4(h.matrixWorld);
    return true;
  }
  led(game, a, m, X) {
    const e = game.ranch.player(a.lead), mm = e && X.models.get(e);
    if (!mm?.person || !this.hand(mm.person, 1 - mm.person.toolArm, A)) return;
    this.chin(m, B);
    const c = mm === X.player ? this.mine('rope', X) : this.ropeAt(this.n++);
    c.lay(0, A, B, ROPE.lead, Math.min(m.root.position.y, mm.root.position.y) + 0.03);
    c.done();
  }
  tied(game, scene, a, m) {
    const k = game.horselead.knotOf(a);
    if (!k) return;
    this.chin(m, B);
    const y = this.view.groundY(scene, k.x, k.y) + k.h, dx = B.x - k.x, dz = B.z - k.y, d = Math.hypot(dx, dz) || 1;
    const o = this.knotAt(this.m++), g = knotGeo(k.kind, k.r);
    if (o.geometry !== g) o.geometry = g;
    o.visible = true;
    o.position.set(k.x, y, k.y);
    // (on a rail, along it and its end on the horse's side; on a post or a trunk, towards the horse)
    let yaw = Math.atan2(dx, dz);
    if (k.kind === 'post') { const front = dx * Math.sin(k.yaw) + dz * Math.cos(k.yaw) >= 0; yaw = k.yaw + (front ? 0 : Math.PI); }
    o.rotation.y = yaw;
    const R = k.r + 0.02;
    if (k.kind === 'post') A.set(k.x + Math.sin(yaw) * R, y - 0.01, k.y + Math.cos(yaw) * R); else A.set(k.x + dx / d * R, y, k.y + dz / d * R);
    const c = this.ropeAt(this.n++);
    c.lay(0, A, B, ROPE.tie, Math.min(m.root.position.y, y - k.h) + 0.02);
    c.done();
  }
  // The two reins of a rider (m: their model): from the bit, along the side of the neck, to each hand (with a tool in the right
  // one, both to the left)
  ridden(m, X = null) {
    const h = m?.horse, u = h?.userData;
    if (!h?.visible || !m.root.visible || !u.bits || !m.person) return;
    const one = !!m.holding && !!m.hand?.visible, c = X ? this.mine('reins', X) : this.reinsAt(this.k++);
    u.head.updateWorldMatrix(true, false); u.neck.updateWorldMatrix(true, false);
    for (let s = 0; s < 2; s++) {   // (0: the horse's left, +x: the rider's left hand)
      if (!this.hand(m.person, one || s === 0 ? 1 : 0, A)) { c.mesh.visible = false; if (!X) this.k--; return; }
      B.copy(u.bits[s]).applyMatrix4(u.head.matrixWorld);
      // (the point of the neck it passes by, as the control of the curve: twice its way past the middle)
      P0.set((s ? -1 : 1) * (u.neckR + 0.018), u.rig.L * 0.5, 0.01).applyMatrix4(u.neck.matrixWorld);
      P1.addVectors(A, B).multiplyScalar(0.5);
      MID.copy(P0).multiplyScalar(2).sub(P1); MID.y -= REIN.slack;
      c.lay(s, B, A, 0, -1e9, MID);
    }
    c.done();
  }
}
