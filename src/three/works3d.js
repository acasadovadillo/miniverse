// The village crew's sites, drawn (works.js; docs/planes/realismo/PLAN-R5-construccion.md §5.4): round a crew site, a fence of
// rough planks on posts with its way in, a stack of boards and a heap of stone; round your house while it is being reformed, the
// scaffolding along its walls (poles, a walk of planks at 1.4 m, a rail) and the same two piles by the door. And, in B › Plans
// and with Copy (houseplans.js), the footprint under the cursor: blue where the plan goes, red where something is in the way.
//
// All of it is built once when a site appears or changes (works.v) and merged by material: two or three draw calls for every
// site in sight. The footprint is one instanced mesh of the blueprint's material (site3d.js PLAN_MAT), written again only when
// the cursor changes of tile, the plan turns or the world changes. Nothing is done in a frame without changes.
import * as THREE from 'three';
import { Builder } from './geo.js';
import { PLAN_MAT } from './site3d.js';
import { WALL_H } from './build3d.js';
import { PIECES } from '../pieces.js';
import { nearX } from '../world/planet.js';
import { CHUNK } from '../world/gen.js';

const SHOW_R = 90;                 // tiles: the sites drawn
const FENCE_M = 2.5;               // tiles from the rect to the fence
const BLUE = new THREE.Color('#7fb8ff'), RED = new THREE.Color('#ff6a5a'), DIM = new THREE.Color('#bfe0ff');
const M4 = new THREE.Matrix4(), UNIT = new THREE.BoxGeometry(1, 1, 1);
// (always the same jitter for the same site and the same post)
const jit = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

export class Works3D {
  constructor(world3d) {
    this.w3 = world3d;
    this.group = new THREE.Group(); this.group.name = 'works';
    world3d.group.add(this.group);
    this.meshes = [];
    this.sig = ''; this.v = -1; this.cx = NaN; this.cy = NaN;
    this.foot = null; this.footKey = '';
  }
  clear() { this.drop(); this.sig = ''; this.v = -1; if (this.foot) this.foot.visible = false; this.footKey = ''; }
  drop() { for (const m of this.meshes) { this.group.remove(m); m.geometry.dispose(); } this.meshes.length = 0; }

  frame(game, scene) {
    const W = game.works, p = game.player;
    if (!W || game.world !== scene || !p) { if (this.sig || this.footKey) { this.clear(); this.w3.stale(); } return; }
    const cx = Math.floor(p.x / CHUNK), cy = Math.floor(p.y / CHUNK);
    if (W.v !== this.v || cx !== this.cx || cy !== this.cy) {
      this.v = W.v; this.cx = cx; this.cy = cy;
      const near = W.sites.size ? W.list().filter(({ s }) => s.kind !== 'upkeep' && W.dist(s.rect, p) < SHOW_R) : [];
      const sig = near.map(({ id, s }) => `${id}:${s.rect}:${Math.round(nearX(s.rect[0], p.x) - s.rect[0])}`).join('|');
      if (sig !== this.sig) {
        this.sig = sig; this.drop();
        if (near.length) this.build(near, scene, p);
        this.w3.stale();
      }
    }
    this.footprint(game, scene, p);
  }

  // ---------- the sites ----------
  build(near, scene, p) {
    const wood = new Builder(), stone = new Builder(), boards = new Builder(), H = this.w3.view.terrain;
    for (const { id, s } of near) {
      const sh = nearX(s.rect[0], p.x) - s.rect[0], R = [s.rect[0] + sh, s.rect[1], s.rect[2] + 1 + sh, s.rect[3] + 1], seed = id.charCodeAt(1) * 7 + id.charCodeAt(2);
      const gy = (x, z) => H.heightAt(x, z);
      if (s.kind === 'crew') this.fence(wood, R, gy, seed);
      else this.scaffold(wood, boards, R, gy, scene.levelAt?.(R[0] + 1.5, R[1] + 1.5) ?? gy(R[0] + 1.5, R[1] + 1.5), seed);
      // (the piles: beside the way in, inside the fence; by a reformed house, to one side of its door)
      const px = s.kind === 'crew' ? R[2] + FENCE_M - 1.3 : (R[0] + R[2]) / 2 - 3.4, pz = R[3] + (s.kind === 'crew' ? FENCE_M - 1.4 : 1.9);
      this.planks(boards, px, pz, gy(px, pz), seed);
      this.stones(stone, px - 2.4, pz + 0.1, gy(px - 2.4, pz + 0.1), seed);
    }
    for (const [B, key] of [[wood, 'fence'], [boards, 'timber'], [stone, 'stone']]) {
      if (!B.pos.length) continue;
      const m = B.mesh(this.w3.mat(key));
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m); this.meshes.push(m);
    }
  }
  // A plank fence on posts round the site, with a way in in the middle of its south side
  fence(B, R, gy, seed) {
    const x0 = R[0] - FENCE_M, z0 = R[1] - FENCE_M, x1 = R[2] + FENCE_M, z1 = R[3] + FENCE_M, mid = (x0 + x1) / 2;
    const side = (ax, az, bx, bz, gapAt) => {
      const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 1.6)), ux = (bx - ax) / L, uz = (bz - az) / L;
      for (let i = 0; i < n; i++) {
        const a = i / n, b = (i + 1) / n, xa = ax + (bx - ax) * a, za = az + (bz - az) * a, xb = ax + (bx - ax) * b, zb = az + (bz - az) * b, cxm = (xa + xb) / 2, czm = (za + zb) / 2;
        if (gapAt && Math.abs(cxm - gapAt) < 1.6) continue;
        const y0 = gy(xa, za), y1 = gy(xb, zb), lean = (jit(seed + i, xa) - 0.5) * 0.06;
        B.box(xa - 0.05, y0 - 0.15, za - 0.05, xa + 0.05, y0 + 1.12 + lean, za + 0.05, { s: 0.6 });
        if (i === n - 1) B.box(xb - 0.05, y1 - 0.15, zb - 0.05, xb + 0.05, y1 + 1.12, zb + 0.05, { s: 0.6 });
        // (two boards, nailed on the outside, a little out of true)
        for (const [h, k] of [[0.38, 0.2], [0.82, 0.18]]) {
          const ym = (y0 + y1) / 2 + h + (jit(i, seed + h) - 0.5) * 0.05, yaw = Math.atan2(uz, ux);
          B.orientedBox(cxm - uz * 0.07, czm + ux * 0.07, Math.hypot(xb - xa, zb - za) + 0.12, 0.025, ym, ym + k, -yaw, { s: 0.6 });
        }
      }
    };
    side(x0, z0, x1, z0); side(x1, z0, x1, z1); side(x1, z1, x0, z1, mid); side(x0, z1, x0, z0);
  }
  // Round a house: poles from the ground, a walk of three planks at 1.4 m on its ledgers, a rail, a brace now and then
  scaffold(B, P, R, gy, base, seed) {
    const deck = base + 1.4, top = base + WALL_H + 0.55;
    const run = (ax, az, bx, bz, ox, oz) => {
      const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 1.8)), ux = (bx - ax) / L, uz = (bz - az) / L, yaw = -Math.atan2(uz, ux);
      for (let i = 0; i <= n; i++) {
        const x = ax + (bx - ax) * i / n, z = az + (bz - az) * i / n, fx = x + ox * 0.95, fz = z + oz * 0.95, g = gy(fx, fz);
        B.box(fx - 0.04, g - 0.1, fz - 0.04, fx + 0.04, top, fz + 0.04, { s: 0.6 });                        // the pole
        B.orientedBox(x + ox * 0.5, z + oz * 0.5, 1.05, 0.06, deck - 0.12, deck - 0.05, -Math.atan2(oz, ox), { s: 0.6 });   // its ledger to the wall
        if (i < n && (i + seed) % 3 === 0) { const nx = ax + (bx - ax) * (i + 1) / n + ox * 0.95, nz = az + (bz - az) * (i + 1) / n + oz * 0.95, gx = gy(nx, nz); B.orientedBox((fx + nx) / 2, (fz + nz) / 2, Math.hypot(nx - fx, nz - fz), 0.05, (g + gx) / 2 + 0.2, (g + gx) / 2 + 0.26, yaw, { s: 0.6 }); }
      }
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      for (let k = 0; k < 3; k++) { const o = 0.25 + k * 0.24; P.orientedBox(mx + ox * o, mz + oz * o, L + 0.5, 0.22, deck - 0.05 + k * 0.004, deck + k * 0.004, yaw, { s: 0.6 }); }
      B.orientedBox(mx + ox * 0.95, mz + oz * 0.95, L + 0.3, 0.05, deck + 0.86, deck + 0.93, yaw, { s: 0.6 });   // the rail
    };
    const [x0, z0, x1, z1] = R;
    run(x0, z0 - 0.15, x1, z0 - 0.15, 0, -1); run(x1 + 0.15, z0, x1 + 0.15, z1, 1, 0); run(x0 - 0.15, z0, x0 - 0.15, z1, -1, 0);
    // (in front, both sides of the door: the way in stays clear)
    const door = (x0 + x1) / 2;
    run(x0, z1 + 0.15, door - 1.6, z1 + 0.15, 0, 1); run(door + 1.6, z1 + 0.15, x1, z1 + 0.15, 0, 1);
  }
  // A stack of boards on two bearers, each course across the one below
  planks(B, x, z, g, seed) {
    B.box(x - 1.1, g, z - 0.5, x - 0.95, g + 0.12, z + 0.5, { s: 0.6 }); B.box(x + 0.95, g, z - 0.5, x + 1.1, g + 0.12, z + 0.5, { s: 0.6 });
    for (let c = 0; c < 5; c++) for (let i = 0; i < 4; i++) {
      const y = g + 0.12 + c * 0.055, off = (jit(seed + c, i) - 0.5) * 0.12;
      B.box(x - 1.15 + off, y, z - 0.42 + i * 0.22, x + 1.15 + off, y + 0.05, z - 0.24 + i * 0.22, { s: 0.6 });
    }
  }
  // A heap of rough stone, the big ones at the bottom
  stones(B, x, z, g, seed) {
    for (let i = 0; i < 16; i++) {
      const a = jit(seed, i) * Math.PI * 2, r = Math.sqrt(jit(i, seed)) * 0.75 * (1 - i / 22), s = 0.13 + jit(i + 3, seed) * 0.13 - i * 0.003, h = i < 9 ? 0 : i < 14 ? 0.2 : 0.36;
      const sx = x + Math.cos(a) * r, sz = z + Math.sin(a) * r;
      B.roundBox(sx - s, g + h - 0.04, sz - s * 0.8, sx + s, g + h + s * 1.1, sz + s * 0.8, s * 0.35, { s: 0.6 });
    }
  }

  // ---------- the footprint of a plan ----------
  footprint(game, scene, p) {
    const HP = game.houseplans, b = game.build, mt = b.on && HP?.tool ? game.mouseTile() : null;
    let list = null, key = '';
    if (mt && b.tool === 'stamp' && HP.chosen) { list = HP.tiles(HP.chosen, mt); key = `s|${HP.memo.key}`; }
    else if (b.on && b.tool === 'copy') { const R = HP.copyRect(); if (R) { key = `c|${R}|${scene.touches}`; list = R; } else if (mt) { key = `c|${mt}`; list = [mt[0], mt[1], mt[0], mt[1]]; } }
    if (key === this.footKey) return;
    this.footKey = key;
    if (!list) { if (this.foot) this.foot.visible = false; return; }
    const boxes = [];
    const H = this.w3.view.terrain, sh = x => nearX(x, p.x) - x;
    if (Array.isArray(list) && typeof list[0] === 'number') {
      const [x0, y0, x1, y1] = list;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const X = x + sh(x), g = H.heightAt(X + 0.5, y + 0.5), own = !!(scene.ownAt('placed', x, y) || scene.ownAt('floor', x, y) || scene.ownAt('roof', x, y)); boxes.push([X + 0.04, g + 0.02, y + 0.04, X + 0.96, g + (own ? 0.12 : 0.06), y + 0.96, own ? DIM : BLUE]); }
    } else {
      const ground = new Map();
      for (const e of list) { const k = `${e.x},${e.y}`; ground.set(k, (ground.get(k) ?? true) && e.ok); }
      for (const [k, ok] of ground) { const [x, y] = k.split(',').map(Number), X = x + sh(x), g = H.heightAt(X + 0.5, y + 0.5); boxes.push([X + 0.04, g + 0.02, y + 0.04, X + 0.96, g + 0.07, y + 0.96, ok ? BLUE : RED]); }
      for (const e of list) {
        if (e.layer !== 'placed') continue;
        const X = e.x + sh(e.x), g = H.heightAt(X + 0.5, e.y + 0.5), kind = PIECES[e.id]?.kind, c = e.ok ? BLUE : RED, hgt = kind === 'door' ? 0.5 : e.id.startsWith('ventana') ? 0.9 : 1.2;
        if (kind === 'post') boxes.push([X + 0.38, g, e.y + 0.38, X + 0.62, g + hgt, e.y + 0.62, c]);
        else boxes.push([X + 0.12, g, e.y + 0.12, X + 0.88, g + hgt, e.y + 0.88, c]);
      }
    }
    if (!this.foot || boxes.length > this.foot.count0) {
      if (this.foot) { this.group.remove(this.foot); this.foot.dispose(); }
      const n = Math.max(256, Math.ceil(boxes.length * 1.3)), o = (this.foot = new THREE.InstancedMesh(UNIT, PLAN_MAT, n));
      o.count0 = n; o.frustumCulled = false; o.castShadow = o.receiveShadow = false; o.renderOrder = 3;
      o.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(o);
    }
    const o = this.foot;
    boxes.forEach((q, i) => { M4.makeScale(q[3] - q[0], q[4] - q[1], q[5] - q[2]).setPosition((q[0] + q[3]) / 2, (q[1] + q[4]) / 2, (q[2] + q[5]) / 2); o.setMatrixAt(i, M4); o.setColorAt(i, q[6]); });
    o.count = boxes.length; o.visible = true;
    o.instanceMatrix.needsUpdate = true; if (o.instanceColor) o.instanceColor.needsUpdate = true;
  }
}
