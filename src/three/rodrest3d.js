// The rods laid on their rests (Plan R1-4, src/rodrest.js; the sticks, rest3d.js): the player's and up to two others' (st.rr): the line into the water, the tip that nods and the little bell on it.
import * as THREE from 'three';
import { toolModel } from './actors.js';
import { bellModel } from './traps3d.js';
import { BACK, FRONT } from './rest3d.js';
import { WATER_Y } from '../world/biomes.js';
import { nearX } from '../world/planet.js';

const PEERS = 2, PEER_R = 60, POINTS = 16;
const TILT = Math.atan2(FRONT[2] - BACK[2], FRONT[1] - BACK[1]);         // (of the rod, from upright)
const LEN = 1.3, BUTT = 0.08, GUIDES = [0, 1, 2];
const tip = new THREE.Vector3(), end = new THREE.Vector3(), pull = new THREE.Vector3();

// ---------- the rods ----------
export class RodRestView {
  constructor(fx) {
    this.fx = fx; this.view = fx.view;
    this.rods = Array.from({ length: 1 + PEERS }, () => null);
  }
  rod(i) {
    let q = this.rods[i];
    if (q) return q;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((POINTS + 1) * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const line = new THREE.Line(geo, this.fx.fishing.rigs[0].line.material), root = new THREE.Group(), hold = new THREE.Group(), bell = bellModel();
    line.frustumCulled = false; hold.position.set(...BACK); hold.rotation.x = TILT; root.add(hold);
    bell.scale.setScalar(1.5);
    this.fx.group.add(line, root);
    return (this.rods[i] = { line, root, hold, bell, tier: 0, parts: null, seen: { at: 0, phase: 0 } });
  }
  off(i) { const q = this.rods[i]; if (q) { q.line.visible = q.root.visible = false; } }
  update(game, scene, playing, t) {
    const me = playing && scene === game.world && !this.view.cave, s = me ? game.rodrest?.s : null;
    if (s) this.draw(this.rod(0), scene, s.x, s.y, s.yaw, s.bx, s.by, s.phase === 'bite', s.nib > 0 ? Math.sin((s.nib / 0.3) * Math.PI) : 0, s.fly, s.tier, t); else this.off(0);
    let k = 1;
    if (me && game.live?.peers) for (const peer of game.live.peers.values()) {
      const e = peer.entity, r = e?.rr;
      if (!r || k > PEERS) continue;
      const x = nearX(r[0], game.player.x), off = x - r[0];
      if (Math.abs(x - game.player.x) > PEER_R || Math.abs(r[1] - game.player.y) > PEER_R) continue;
      this.draw(this.rod(k), scene, x, r[1], r[2], r[3] + off, r[4], r[5] === 1, 0, 1, r[6], t);
      k++;
    }
    for (; k <= PEERS; k++) this.off(k);
  }
  draw(q, scene, x, z, yaw, bx, bz, biting, nib, fly, tier, t) {
    if (q.tier !== tier) {
      // (the rod itself: the one of the hand, its pieces found once)
      if (q.tool) { q.hold.remove(q.tool); }
      q.tier = tier; q.tool = toolModel(tier > 1 ? 'cana_fibra' : 'cana'); q.tool.rotation.set(0, 0, 0); q.hold.add(q.tool);
      const shaft = q.tool.getObjectByName('rodShaft'), end_ = q.tool.getObjectByName('tip');
      q.parts = { shaft, tip: end_, guides: GUIDES.map(i => q.tool.getObjectByName('guide' + i)), base: Float32Array.from(shaft.geometry.attributes.position.array), k: 0, x: 0, z: 0 };
      end_.add(q.bell); q.bell.rotation.x = -TILT;
    }
    q.root.visible = q.line.visible = true;
    q.root.position.set(x, this.view.groundY(scene, x, z), z); q.root.rotation.y = yaw;
    q.root.updateMatrixWorld(true);
    end.set(bx, WATER_Y - 0.35, bz);
    q.parts.tip.getWorldPosition(tip);
    const bend = biting ? 0.3 + 0.16 * Math.abs(Math.sin(t * 5.3)) + 0.1 * Math.max(0, Math.sin(t * 13)) : 0.08 + 0.15 * nib + 0.006 * Math.sin(t * 2);
    this.fx.fishing.point(q.parts, pull.copy(end).sub(tip), bend);
    q.bell.rotation.z = biting ? 0.7 * Math.sin(t * 31) : 0.08 * Math.sin(t * 2.1) + 0.4 * nib;
    q.parts.tip.updateWorldMatrix(true, false);
    q.parts.tip.getWorldPosition(tip);
    if (fly < 1) { end.lerpVectors(tip, end, fly); end.y += Math.sin(fly * Math.PI) * 1.2; }
    const P = q.line.geometry.attributes.position, sag = biting ? 0 : 0.05;
    for (let i = 0; i <= POINTS; i++) { const k = i / POINTS; P.setXYZ(i, tip.x + (end.x - tip.x) * k, tip.y + (end.y - tip.y) * k - Math.sin(k * Math.PI) * sag, tip.z + (end.z - tip.z) * k); }
    P.needsUpdate = true;
  }
}
