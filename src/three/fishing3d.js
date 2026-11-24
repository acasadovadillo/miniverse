// What is seen of fishing (src/fishing.js has the game of it): the line and the float of the player and of up to two others
// (st.fb), each bite its own way, the rod that bends (actors.js: rodShaft, its guides and tip), the line
// weaving in the fight, the fish held up after it and the one that jumps now and then. Everything is made once and reused,
// with the materials the line and the float always had: nothing is made while fishing but the model of the fish in the hands.
import * as THREE from 'three';
import { FISH, ITEMS } from '../items.js';
import { CAM } from '../camera.js';
import { nearX } from '../world/planet.js';
import { WATER_Y } from './terrain.js';
import { foodModel } from './food3d.js';
import { BITES, BITE_IDS } from '../fishing.js';

const POINTS = 20, PEERS = 2, PEER_R = 60;            // how many of the others' lines, and how near (m)
const SETTLE = 0.02, SLIDE = 0.4;                     // m: the float's own bob, and how far a run takes it
const MODEL_M = 0.28, HOLD_AHEAD = 0.46, HOLD_UP = 1.12;   // the length of food3d's fish, and where the catch is held
const LEAP_S = 0.55;
const from = new THREE.Vector3(), to = new THREE.Vector3(), dir = new THREE.Vector3(), Q = new THREE.Quaternion();
const smooth = k => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const N = 10, LEN = 1.3, BUTT = 0.08, GUIDE_Y = [0.4, 0.75, 1.1], CURVE = new Float32Array((N + 1) * 2), AT = { up: 0 };   // (the rod: actors.js toolModel)
const OUT = { x: 0, z: 0, y: 0, tilt: 0, bend: 0, sunk: false };   // (what bobAt says: reused)

// The float, b seconds into a bite: how far it has moved (x, z along and across), up or down (y), tipped, whether it is
// under, and how much the rod's tip nods. Pure: the sheet of docs/pruebas-arte/pesca draws it frame by frame
export function bobAt(bite, b, taps, pre, t) {
  const o = OUT;
  o.x = o.z = o.tilt = o.bend = 0; o.y = 0; o.sunk = false;
  if (bite === 'dip') {
    if (b < 0.6) { const q = b % 0.3; o.y = q < 0.17 ? -0.085 * Math.sin((q / 0.17) * Math.PI) : 0; o.bend = -o.y * 1.2; }
    else { o.y = -0.06 - Math.min(0.4, (b - 0.6) * 1.6); o.bend = 0.22 + 0.05 * Math.sin(t * 17); }
  } else if (bite === 'run') {
    o.x = SLIDE * smooth(b / 0.8) + Math.max(0, b - 0.8) * 0.12; o.y = -Math.max(0, b - 0.8) * 0.2; o.tilt = 0.75 * smooth(b / 0.4); o.bend = 0.18 * smooth(b / 1.2);
  } else if (bite === 'lift') {
    const k = smooth(b / 0.4); o.y = 0.035 * k; o.tilt = 1.45 * k;
  } else if (bite === 'slam') {
    o.y = -Math.min(0.6, b * 6); o.bend = 0.45 * Math.max(0.5, 1 - b);
  } else {
    const n = Math.floor(b / 0.4), q = b - n * 0.4;
    if (n < taps) { o.y = q < 0.16 ? -0.05 * Math.sin((q / 0.16) * Math.PI) : 0; o.tilt = -o.y * 5; o.bend = -o.y * 2.5; }
    else { const k = b - pre; o.y = -0.05 - Math.min(0.35, k * 0.3); o.x = Math.min(0.3, k * 0.22); o.tilt = 0.6 * smooth(k / 0.3); o.bend = 0.25; }
  }
  o.sunk = o.y < -0.2;
  return o;
}

export class FishingView {
  constructor(fx) {
    this.fx = fx; this.view = fx.view;
    const lineMat = new THREE.LineBasicMaterial({ color: '#f0f0f0', transparent: true, opacity: 0.8 });
    const white = new THREE.MeshStandardMaterial({ color: '#ffffff' }), red = new THREE.MeshStandardMaterial({ color: '#e83a3a' });
    const top = new THREE.SphereGeometry(0.07, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), bot = new THREE.SphereGeometry(0.07, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), stem = new THREE.CylinderGeometry(0.009, 0.012, 0.15, 6).translate(0, 0.13, 0);
    this.rigs = Array.from({ length: 1 + PEERS }, () => {
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((POINTS + 1) * 3), 3).setUsage(THREE.DynamicDrawUsage));
      const line = new THREE.Line(geo, lineMat), bobber = new THREE.Group(), ball = new THREE.Group();
      line.frustumCulled = false;
      ball.add(new THREE.Mesh(top, white), new THREE.Mesh(bot, red), new THREE.Mesh(stem, red));
      bobber.add(ball);
      line.visible = bobber.visible = false;
      fx.group.add(line, bobber);
      return { line, bobber, ball, e: null, rod: null, seen: { phase: -1, at: 0, bite: 0, x: 0, y: 0 }, bendAt: 0 };
    });
    this.ripple = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.19, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#e0f4ff', transparent: true, opacity: 0.7, depthWrite: false }));
    this.ripple.visible = false;
    this.held = null; this.heldId = null;
    this.jumper = null; this.jump = { t: -1, x: 0, y: 0, a: 0 };
    fx.group.add(this.ripple);
  }

  update(game, scene, playing, t) {
    const me = playing && scene === game.world && !this.view.cave, F = game.fishing, s = me ? F?.state : null;
    let n = 0;
    if (s) { this.own(this.rigs[0], game, s, t); n = 1; } else this.off(this.rigs[0]);
    let k = 1;
    if (me && game.live?.peers) {
      for (const peer of game.live.peers.values()) {
        const e = peer.entity;
        if (!e?.fb || e.fb[2] > 3 || k > PEERS) continue;
        const x = nearX(e.x, game.player.x);
        if (Math.abs(x - game.player.x) > PEER_R || Math.abs(e.y - game.player.y) > PEER_R) continue;
        if (this.peer(this.rigs[k], e, x - e.x, t)) k++;
      }
    }
    for (; k <= PEERS; k++) this.off(this.rigs[k]);
    if (!n && this.ripple.visible) this.ripple.visible = false;
    this.catch(game, me ? F?.card : null);
    this.leaping(t, me);
  }
  off(rig) {
    if (rig.rod) this.bend(rig.rod, 0);
    rig.rod = null; rig.e = null; rig.seen.phase = -1;
    rig.line.visible = rig.bobber.visible = false;
  }

  // The player's: from their rod (in first person, the one in view)
  own(rig, game, s, t) {
    const A = this.view.actors.player, host = CAM.first && this.view.viewmodel?.visible ? this.view.viewmodel : A?.hand;
    const L = Math.hypot(s.bx - s.px, s.by - s.py) || 1, fight = s.phase === 'fight', o = OUT;
    let x = s.bx, z = s.by, sag = Math.min(0.5, L * 0.07), bend = 0.03;
    o.x = o.z = o.tilt = 0; o.y = Math.sin(t * 3) * SETTLE * 0.7; o.sunk = false;
    if (fight) { x = s.ex; z = s.ey; o.y = -0.1; o.sunk = true; sag = 0; bend = 0.28 + s.load * (0.4 + 0.4 * s.run) + 0.03 * Math.sin(t * 23); }
    else if (s.phase === 'bite') { bobAt(s.bite, s.bt, s.taps, s.pre, t); bend = o.bend; sag *= 0.7; }
    else if (s.nib > 0) { o.y -= 0.035 * Math.sin((s.nib / 0.3) * Math.PI); o.tilt = 0.12 * Math.sin(s.nib * 40); bend = 0.06; }
    const side = s.side || 1, dx = (s.bx - s.px) / L, dz = (s.by - s.py) / L;
    x += (-dz * side) * o.x; z += dx * side * o.x;   // (a run goes off to the side)
    const tip = this.rodOf(rig, host);
    this.tipOf(host, tip, s.px, s.py);
    if (rig.rod) { this.point(rig.rod, dir.set(x, WATER_Y, z).sub(from), bend); this.tipOf(host, tip, s.px, s.py); }
    this.draw(rig, x, z, o, sag, s.fly, Math.atan2(-dz * side, dx * side));
    const busy = s.phase === 'bite' || s.nib > 0, r = this.ripple;
    r.visible = busy && s.fly === 1;
    if (r.visible) {
      const w = (t * 2) % 1, small = s.phase !== 'bite';
      r.position.set(x, WATER_Y + 0.012, z); r.scale.setScalar((small ? 0.7 : 1) + w * 1.5); r.material.opacity = (small ? 0.4 : 0.7) * (1 - w);
    }
  }
  // Another player's, from what they send: the times of the bite are counted here
  peer(rig, e, off, t) {
    const m = this.view.actors.models.get(e), fb = e.fb, S = rig.seen;
    if (!m?.root.visible) return false;
    const phase = fb[2], fresh = rig.e !== e || S.phase === -1;
    if (rig.e !== e) { if (rig.rod) this.bend(rig.rod, 0); rig.rod = null; rig.e = e; }
    if (fresh || S.phase !== phase) { S.phase = phase; S.at = t; }
    const tx = fb[0] + off, tz = fb[1];
    if (fresh || Math.hypot(tx - S.x, tz - S.y) > 4) { S.x = tx; S.y = tz; } else { S.x += (tx - S.x) * 0.2; S.y += (tz - S.y) * 0.2; }
    const px = m.root.position.x, pz = m.root.position.z, L = Math.hypot(S.x - px, S.y - pz) || 1, b = t - S.at, o = OUT;
    let sag = Math.min(0.5, L * 0.07), bend = 0.03;
    o.x = o.z = o.tilt = 0; o.y = Math.sin(t * 3 + 1) * SETTLE * 0.7; o.sunk = false;
    if (phase === 3) { o.y = -0.1; o.sunk = true; sag = 0; bend = 0.3 + 0.2 * fb[4] + 0.1 * Math.sin(t * 3.4); }
    else if (phase === 2) { const bite = BITE_IDS[fb[3]] || 'dip'; bobAt(bite, b, 4, bite === 'taps' ? 1.6 : BITES[bite].pre, t); bend = o.bend; }
    const dx = (S.x - px) / L, dz = (S.y - pz) / L, x = S.x - dz * o.x, z = S.y + dx * o.x, tip = this.rodOf(rig, m.hand);
    this.tipOf(m.hand, tip, px, pz);
    if (rig.rod) { this.point(rig.rod, dir.set(x, WATER_Y, z).sub(from), bend); this.tipOf(m.hand, tip, px, pz); }
    this.draw(rig, x, z, o, sag, phase === 0 ? Math.min(0.95, b / 0.4) : 1, Math.atan2(-dz, dx));
    return true;
  }

  // The rod in a hand: its pieces, found again only when what it holds changes
  rodOf(rig, host) {
    const tool = host?.children[0] || null;
    if (rig.host !== host || rig.tool !== tool) {
      if (rig.rod) this.bend(rig.rod, 0);
      rig.host = host; rig.tool = tool; rig.tip = tool?.getObjectByName('tip') || null;
      const shaft = tool?.getObjectByName('rodShaft') || null;
      rig.parts = shaft && rig.tip ? { shaft, tip: rig.tip, guides: [0, 1, 2].map(i => tool.getObjectByName('guide' + i)), base: Float32Array.from(shaft.geometry.attributes.position.array), k: 0, x: 0, z: 0 } : null;
    }
    return (rig.rod = rig.parts), rig.tip;
  }
  // (from the tip of the rod; if it is not to be seen, from a little over the hand)
  tipOf(host, tip, x, z) {
    if (tip) tip.getWorldPosition(from);
    else if (host) { host.getWorldPosition(from); from.y += 0.9; }
    else from.set(x, WATER_Y + 1.3, z);
  }
  // The rod bent (0-1) towards where the line pulls: a curve, sharper towards the tip. The shaft (its geometry is its own) is
  // rewritten only when the bend changes
  point(rod, pull, k) {
    rod.shaft.parent.getWorldQuaternion(Q).invert();
    pull.applyQuaternion(Q);
    const L = Math.hypot(pull.x, pull.z);
    if (L > 1e-4) this.bend(rod, Math.min(1.1, k), pull.x / L, pull.z / L);
  }
  bend(rod, k, x = 0, z = 0) {
    if (Math.abs(k - rod.k) < 0.004 && Math.hypot(x - rod.x, z - rod.z) * k < 0.01) return;
    rod.k = k; rod.x = x; rod.z = z;
    // the curve, once: at each of N points up the shaft, how far it goes over and up
    let over = 0, up = 0;
    CURVE[0] = 0; CURVE[1] = 0;
    for (let i = 1; i <= N; i++) { const a = k * 1.8 * ((i - 0.5) / N) ** 1.6, st = LEN / N; over += Math.sin(a) * st; up += Math.cos(a) * st; CURVE[i * 2] = over; CURVE[i * 2 + 1] = up; }
    const P = rod.shaft.geometry.attributes.position, B = rod.base;
    for (let i = 0; i < P.count; i++) {
      const s = this.along((B[i * 3 + 1] + LEN / 2) / LEN);
      P.setXYZ(i, B[i * 3] + x * s, AT.up - LEN / 2, B[i * 3 + 2] + z * s);
    }
    P.needsUpdate = true;
    for (let i = 0; i < 3; i++) { const o = rod.guides[i], s = this.along((GUIDE_Y[i] - BUTT) / LEN); o?.position.set(x * s, BUTT + AT.up, 0.012 + z * s); }
    const s = this.along(1);
    rod.tip.position.set(x * s, BUTT + AT.up, z * s);
  }
  // At a share of the shaft: how far over (returned) and up (AT.up) the curve is
  along(q) {
    const f = Math.max(0, Math.min(N, q * N)), i = Math.min(N - 1, Math.floor(f)), k = f - i;
    AT.up = CURVE[i * 2 + 1] + (CURVE[i * 2 + 3] - CURVE[i * 2 + 1]) * k;
    return CURVE[i * 2] + (CURVE[i * 2 + 2] - CURVE[i * 2]) * k;
  }

  draw(rig, x, z, o, sag, fly, yaw) {
    to.set(x, WATER_Y + 0.03 + o.y, z);
    if (fly < 1) { to.lerpVectors(from, to, fly); to.y += Math.sin(fly * Math.PI) * 1.2; sag = 0.1; }
    const b = rig.bobber;
    b.visible = fly < 1 || !o.sunk;
    b.position.copy(to); b.rotation.y = yaw; rig.ball.rotation.x = o.tilt;
    const pts = rig.line.geometry.attributes.position;
    for (let i = 0; i <= POINTS; i++) { const k = i / POINTS; pts.setXYZ(i, from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k - Math.sin(k * Math.PI) * sag, from.z + (to.z - from.z) * k); }
    pts.needsUpdate = true;
    rig.line.visible = true;
  }

  // The catch, held up across in both hands, at its size
  catch(game, card) {
    const id = card ? card.id : null;
    if (id !== this.heldId) {
      if (this.held) { this.fx.group.remove(this.held); this.held = null; }
      this.heldId = id;
      if (id) { const g = new THREE.Group(), m = foodModel(id); if (m) { m.rotation.y = Math.PI / 2; g.add(m); } this.held = g; this.fx.group.add(g); }
    }
    if (!card || !this.held) return;
    const A = this.view.actors.player, p = game.player, root = A?.root, f = FISH[id] || {};
    const long = !(f.crab || f.octo || f.round), k = Math.min(CAM.first ? 2.2 : 5.6, Math.max(0.6, card.cm / 100 / (long ? MODEL_M : 0.2)));
    this.held.scale.setScalar(k);
    if (CAM.first) {
      const c = this.view.camera;
      c.getWorldDirection(dir);
      this.held.position.copy(c.position).addScaledVector(dir, 0.75); this.held.position.y -= 0.28;
      this.held.rotation.y = Math.atan2(dir.x, dir.z);
      return;
    }
    const yaw = A?.person?.facing ?? Math.atan2(p.face.x, p.face.y), x = root ? root.position.x : p.x, z = root ? root.position.z : p.y;
    const low = p.pose ? (A?.person?.root?.position.y ?? 0) - 0.35 : p.boat || p.aboard ? -0.2 : 0;
    this.held.position.set(x + Math.sin(yaw) * HOLD_AHEAD, (root ? root.position.y : 0) + HOLD_UP + Math.min(0, low), z + Math.cos(yaw) * HOLD_AHEAD);
    this.held.rotation.y = yaw;
  }

  // A fish that jumps out of the water and back (fishing.js rises)
  leap(x, y) {
    if (!this.jumper) { this.jumper = foodModel('perca') || new THREE.Group(); this.jumper.scale.setScalar(1.3); this.jumper.visible = false; this.fx.group.add(this.jumper); }
    Object.assign(this.jump, { t: this.view.clock.elapsedTime, x, y, a: Math.random() * 6.28 });
  }
  leaping(t, on) {
    const J = this.jump;
    if (J.t < 0) return;
    const k = (this.view.clock.elapsedTime - J.t) / LEAP_S, o = this.jumper;
    if (k >= 1 || !on) { J.t = -1; o.visible = false; if (on) this.fx.rippleAt(J.x + Math.sin(J.a) * 0.5, J.y + Math.cos(J.a) * 0.5, 0.9, 0.5); return; }
    o.visible = true;
    o.position.set(J.x + Math.sin(J.a) * 0.5 * k, WATER_Y - 0.1 + Math.sin(k * Math.PI) * 0.55, J.y + Math.cos(J.a) * 0.5 * k);
    o.rotation.set((k - 0.5) * 2.2, J.a, 0, 'YXZ');
  }
}
