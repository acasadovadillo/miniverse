// A building site, drawn (plans.js has what is planned; docs/planes/realismo/PLAN-R5-construccion.md §5.2–5.4): the blueprint
// of what is drawn, what is half built, and the scaffolding along the walls going up.
//
// The blueprint is one instanced mesh for every plan in sight: boxes (plans.js, shapes), each with its matrix, pale blue, see
// through, with their edges drawn in the shader; a slope is the box sheared. Drawing, erasing or beginning a piece writes the
// matrices again (some thousand numbers), it builds no geometry. What is half built is made of the same pieces as the world
// (build3d.js), cut at the height it has reached; a roof, its rafters and battens. Nothing is done in a frame without changes.
import * as THREE from 'three';
import { Builder } from './geo.js';
import { wallTile, doorTile, gateTile, fenceTile, postTile, floorTile, outward, WALL_H, ROOF, T as THICK } from './build3d.js';
import { PIECES } from '../pieces.js';
import { tintOf } from './tints.js';

const BLUE = new THREE.Color('#7fb8ff'), AIMED = new THREE.Color('#e6f4ff'), CHALK = new THREE.Color('#ffffff');
const SCAFF_MS = 500;         // ms between two looks at where the scaffolding goes
const SCAFF_R = 2;            // blocks of 3 × 3 tiles from a wall or a roof still to be built
const M4 = new THREE.Matrix4(), UNIT = new THREE.BoxGeometry(1, 1, 1);
export const PLAN_MAT = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, toneMapped: true });
const DIM = { value: 1 };
PLAN_MAT.onBeforeCompile = sh => {
  sh.uniforms.planDim = DIM;
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBox; varying vec3 vBoxN;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBox = position; vBoxN = normal;');
  // (the edges: how many pixels this one is from the nearest border of its face)
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vBox; varying vec3 vBoxN; uniform float planDim;')
    .replace('#include <color_fragment>', `#include <color_fragment>
      vec3 pq = (0.5 - abs(vBox)) / max(fwidth(vBox), vec3(1e-5)) + step(0.5, abs(vBoxN)) * 1e4;
      float pl = 1.0 - smoothstep(0.35, 1.25, min(pq.x, min(pq.y, pq.z)));
      float hot = smoothstep(0.7, 0.85, vColor.r);
      diffuseColor.rgb *= planDim * mix(0.85, 1.12, pl);
      diffuseColor.a = mix(0.17 + 0.2 * hot, 0.5 + 0.4 * hot, pl);`);
};
PLAN_MAT.customProgramCacheKey = () => 'plan-blueprint';
// Its program, compiled without stopping the game (engine.js, once the world shows): else the first piece drawn would wait for it
export function prewarmSite(renderer, camera, scene) {
  if (!renderer?.compileAsync) return;
  const o = new THREE.InstancedMesh(UNIT, PLAN_MAT, 1);
  o.setColorAt(0, BLUE); o.frustumCulled = false;
  renderer.compileAsync(o, camera, scene).catch(() => {}).finally(() => o.dispose());
}

export class Site3D {
  constructor(world3d) {
    this.w3 = world3d;
    this.group = new THREE.Group(); this.group.name = 'site';
    world3d.group.add(this.group);
    this.mesh = null; this.cap = 0;       // the blueprint
    this.part = new THREE.Group();        // what is half built
    this.scaff = null;                    // the scaffolding
    this.group.add(this.part);
    this.listV = -1; this.workV = -1; this.aimed = null; this.spans = new Map();
    this.due = false; this.scaffAt = -1e9; this.scaffSig = '';   // (whether the scaffolding has to be looked at, when it was, and where it goes)
  }
  clear() {
    if (this.mesh) this.mesh.visible = false;
    this.empty(this.part); this.dropScaff();
    this.listV = this.workV = -1; this.aimed = null; this.spans.clear(); this.due = false;
  }
  empty(group) { for (const o of [...group.children]) { group.remove(o); o.geometry.dispose(); } }
  dropScaff() { this.scaffSig = ''; if (this.scaff) { this.group.remove(this.scaff); this.scaff.geometry.dispose(); this.scaff = null; } }

  // Each frame (world3d.js update): a few comparisons unless something has changed
  frame(game, scene) {
    const P = game.plans;
    if (!P || game.world !== scene || !game.player) { if (this.listV !== -1) { this.clear(); this.w3.stale(); } return; }
    P.refresh();
    const now = performance.now();
    if (P.listV !== this.listV || P.workV !== this.workV) {
      const had = this.part.children.length;
      this.listV = P.listV; this.workV = P.workV;
      this.ghosts(P); this.half(P, scene);
      if (had || this.part.children.length) this.w3.stale(false, this.boxOf(P));
      this.due = true;
    } else if (this.due && (now - this.scaffAt > SCAFF_MS || !P.list.length)) {   // (the scaffolding, in another frame, now and then)
      this.due = false; this.scaffAt = now;
      if (this.scaffold(P, scene)) this.w3.stale(false, this.boxOf(P));
    }
    if (!P.list.length) return;
    DIM.value = 1 - 0.45 * (this.w3.view.night || 0);
    // (the one the hammer is on, brighter)
    const row = game.gather?.target === P.tg ? P.tg.plan : P.holding ? P.focus() : null;
    if (row !== this.aimed) { this.paint(this.aimed, BLUE); this.aimed = row; this.paint(row, AIMED); if (this.mesh?.instanceColor) this.mesh.instanceColor.needsUpdate = true; }
  }
  boxOf(P) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const e of P.list) { x0 = Math.min(x0, e.x - 2); z0 = Math.min(z0, e.ty - 2); x1 = Math.max(x1, e.x + 3); z1 = Math.max(z1, e.ty + 3); }
    return x1 > x0 ? [x0, z0, x1, z1] : null;
  }
  paint(e, color) {
    const at = e && this.spans.get(e.key);
    if (at) for (let i = at[0]; i < at[0] + at[1]; i++) this.mesh.setColorAt(i, color);
  }

  // ---------- the blueprint ----------
  ghosts(P) {
    let n = 0;
    for (const e of P.list) if (!(e.rec.w > 0)) n += e.boxes.length;
    this.spans.clear(); this.aimed = null;
    if (!n) { if (this.mesh) this.mesh.visible = false; return; }
    if (n > this.cap) {
      if (this.mesh) { this.group.remove(this.mesh); this.mesh.dispose(); }
      this.cap = Math.max(128, Math.ceil(n * 1.5));
      const o = this.mesh = new THREE.InstancedMesh(UNIT, PLAN_MAT, this.cap);
      o.frustumCulled = false; o.castShadow = o.receiveShadow = false; o.renderOrder = 3;
      o.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(o);
    }
    const o = this.mesh, m = M4.elements;
    let i = 0;
    for (const e of P.list) {
      if (e.rec.w > 0) continue;
      this.spans.set(e.key, [i, e.chalk ?? e.boxes.length]);
      for (let k = 0; k < e.boxes.length; k++) {
        const b = e.boxes[k], sx = b[3] - b[0], sy = b[4] - b[1], sz = b[5] - b[2];
        // (column by column: x, with its slope in y; y; z, with its own; and the middle of the box)
        m[0] = sx; m[1] = (b[6] || 0) * sx; m[2] = 0; m[3] = 0;
        m[4] = 0; m[5] = sy; m[6] = 0; m[7] = 0;
        m[8] = 0; m[9] = (b[7] || 0) * sz; m[10] = sz; m[11] = 0;
        m[12] = (b[0] + b[3]) / 2; m[13] = (b[1] + b[4]) / 2; m[14] = (b[2] + b[5]) / 2; m[15] = 1;
        o.setMatrixAt(i, M4);
        o.setColorAt(i, e.chalk !== undefined && k >= e.chalk ? CHALK : BLUE);
        i++;
      }
    }
    o.count = i; o.visible = true;
    o.instanceMatrix.needsUpdate = true; o.instanceColor.needsUpdate = true;
  }

  // ---------- half built ----------
  half(P, scene) {
    this.empty(this.part);
    const sinks = new Map(), V = P.view;
    let lift = 0, cut = Infinity, cutX = 0;
    const open = new Map();   // (what each material had before this piece: only what it adds is cut and lifted)
    const emit = key => {
      if (key === 'glass') return new Builder();   // (its panes come last)
      const tint = tintOf(key), bucket = tint ? tint[0] : key;
      let B = sinks.get(bucket);
      if (!B) sinks.set(bucket, (B = new Builder()));
      if (!open.has(B)) open.set(B, [B.pos.length, B.idx.length]);
      return B.tint(tint ? tint[1] : null);
    };
    const close = () => {
      for (const [B, [from, tri]] of open) {
        // (what is all above the cut is not there yet: the cornice, the top)
        if (cut < Infinity) {
          let n = tri;
          const Y = k => B.pos[B.idx[k] * 3 + 1];
          for (let k = tri; k < B.idx.length; k += 3) if (Math.min(Y(k), Y(k + 1), Y(k + 2)) <= cut + 1e-6) { B.idx[n] = B.idx[k]; B.idx[n + 1] = B.idx[k + 1]; B.idx[n + 2] = B.idx[k + 2]; n += 3; }
          B.idx.length = n;
        }
        for (let i = from; i < B.pos.length; i += 3) {
          if (B.pos[i + 1] > cut) {
            const u = (i / 3) * 2 + 1, y = B.pos[i + 1];
            if (Math.abs(B.uv[u] - y) < 1e-4) B.uv[u] = cut;
            B.pos[i + 1] = cut;
          }
          if (cutX) B.pos[i] = Math.min(B.pos[i], cutX);
          B.pos[i + 1] += lift; B.pos[i] += shift;
        }
      }
      open.clear();
    };
    const ex = () => ({ blooms: [], leaves: [], windows: [] });
    let shift = 0;
    for (const e of P.list) {
      const w = P.done(e);
      if (!(e.rec.w > 0) || !(w > 0)) continue;
      const k = Math.min(0.95, w / e.hits), kind = PIECES[e.id].kind;
      lift = e.y; shift = e.x - e.tx; cut = Infinity; cutX = 0;
      if (e.layer === 'floor') { cutX = e.tx + k; floorTile(V, e.tx, e.ty, e.id, emit); }
      else if (e.layer === 'roof') { lift = 0; this.battens(e, k, emit); }
      else {
        const high = kind === 'wall' || kind === 'door' || kind === 'post' ? WALL_H : 1.05;
        cut = high * k;
        if (kind === 'wall') wallTile(V, e.tx, e.ty, e.id, emit, ex());
        else if (kind === 'door') doorTile(V, e.tx, e.ty, emit, ex());
        else if (kind === 'gate') gateTile(V, e.tx, e.ty, emit);
        else if (kind === 'post') postTile(V, e.tx, e.ty, e.id, emit, 0);
        else fenceTile(V, e.tx, e.ty, e.id, emit);
      }
      // (where a wall has got to: in wood, the plank that closes the cut, and the studs that wait for the next ones)
      // (the rest, the face of the cut)
      const top = cut;
      if (cut < Infinity && kind !== 'wall' && kind !== 'door') {
        const key = e.id === 'stone_pillar' ? 'wallStone' : e.id === 'stone_column' ? 'ashlarW' : e.id === 'valla_piedra' ? 'fenceStone' : e.id === 'post' ? 'timber' : 'fence';
        for (const b of e.boxes) if (b[1] - e.y < top && b[4] - e.y > top) emit(key).box(b[0] - shift + 0.005, top - 0.02, b[2] + 0.005, b[3] - shift - 0.005, top, b[5] - 0.005, { s: 0.6, skip: 'ny px nx pz nz' });
      }
      close();
      // (over the cut, not cut)
      cut = Infinity;
      if (kind === 'wall' || kind === 'door') { this.studs(e, top, emit); close(); }
    }
    for (const [key, B] of sinks) {
      if (B.empty) continue;
      const mesh = B.mesh(this.w3.mat(key));
      mesh.castShadow = key !== 'glass'; mesh.receiveShadow = true;
      this.part.add(mesh);
    }
  }
  // Over the cut of a wall half built: the top plank, and the uprights of its frame that stand out of it (in stone, the last
  // course, uneven)
  studs(e, cut, emit) {
    const stone = e.id === 'muro_piedra' || e.id === 'ashlar_wall' || e.id === 'limewash_wall', B = emit(e.id === 'ashlar_wall' ? 'ashlarW' : stone ? 'stone' : 'timber'), h = cut;
    for (const q of e.pick) {
      const x0 = q[0] - e.x + e.tx, x1 = q[3] - e.x + e.tx, z0 = q[2], z1 = q[5], X = x1 - x0 > z1 - z0;
      if (stone) B.box(x0, h - 0.02, z0, x1, h, z1, { s: 0.6, skip: 'ny px nx pz nz' });
      if (stone) { for (let i = 0; i < 3; i++) { const a = i / 3 + 0.02, b = (i + 1) / 3 - 0.03, s = 0.03 + ((i * 7 + e.tx * 3 + e.ty * 5) % 4) * 0.03; if (X) B.box(x0 + a, h - 0.02, z0 + 0.02, x0 + b, h + s, z1 - 0.02, { s: 0.6 }); else B.box(x0 + 0.02, h - 0.02, z0 + a, x1 - 0.02, h + s, z0 + b, { s: 0.6 }); } continue; }
      B.box(x0 - 0.01, h - 0.04, z0 - 0.01, x1 + 0.01, h + 0.02, z1 + 0.01, { s: 0.5 });
    }

  }
  // A roof half built: two rafters with the slope and, across them, the battens laid so far (bare: the tiles come last)
  battens(e, k, emit) {
    const B = emit('timber');
    for (const b of e.boxes) {
      const sx = b[6] || 0, sz = b[7] || 0, x0 = b[0] - e.x + e.tx, x1 = b[3] - e.x + e.tx, cx = (x0 + x1) / 2, cz = (b[2] + b[5]) / 2, cy = (b[1] + b[4]) / 2;
      const Y = (x, z) => cy + (x - cx) * sx + (z - cz) * sz;
      const bar = (ax, az, bx, bz, w, lo, hi) => {
        // (a bar from (ax, az) to (bx, bz), following the slope: its eight corners)
        const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1, nx = -dz / L * w, nz = dx / L * w;
        const p = (x, z, h) => [x, Y(x, z) + h, z], A = [p(ax + nx, az + nz, lo), p(ax - nx, az - nz, lo), p(bx - nx, bz - nz, lo), p(bx + nx, bz + nz, lo)], C = [p(ax + nx, az + nz, hi), p(ax - nx, az - nz, hi), p(bx - nx, bz - nz, hi), p(bx + nx, bz + nz, hi)];
        const uv = [[0, 0], [L, 0], [L, w * 2], [0, w * 2]];
        B.quadN(C[0], C[3], C[2], C[1], [0, 1, 0], uv); B.quadN(A[0], A[1], A[2], A[3], [0, -1, 0], uv);
        B.quadN(A[0], A[3], C[3], C[0], [nx / w, 0, nz / w], uv); B.quadN(A[1], A[2], C[2], C[1], [-nx / w, 0, -nz / w], uv);
        B.quadN(A[0], A[1], C[1], C[0], [-dx / L, 0, -dz / L], uv); B.quadN(A[3], A[2], C[2], C[3], [dx / L, 0, dz / L], uv);
      };
      const alongX = Math.abs(sx) > Math.abs(sz);   // (which way it climbs: the rafters go that way, the battens across)
      const wide = alongX ? b[5] - b[2] : x1 - x0, run = alongX ? x1 - x0 : b[5] - b[2];
      for (let i = 0; i < Math.max(2, Math.round(wide * 2)); i++) { const q = (alongX ? b[2] : x0) + wide * ((i + 0.5) / Math.max(2, Math.round(wide * 2))); if (alongX) bar(x0, q, x1, q, 0.045, -0.16, -0.02); else bar(q, b[2], q, b[5], 0.045, -0.16, -0.02); }
      const n = Math.max(2, Math.round(run * 5)), done = Math.max(1, Math.round(n * k));
      for (let i = 0; i < done; i++) { const q = (alongX ? x0 : b[2]) + run * ((i + 0.5) / n); if (alongX) bar(q, b[2], q, b[5], 0.025, -0.02, 0.02); else bar(x0, q, x1, q, 0.025, -0.02, 0.02); }
    }
  }

  // ---------- the scaffolding ----------
  // Along the outside of the walls that stand (or are going up), near a wall or a roof still to be built: poles from the
  // ground, a walk of planks at 1.4 m on its ledgers, a rail over it, and a brace now and then. It goes with the last plan
  // Returns whether it has changed
  scaffold(P, scene) {
    const was = this.scaffSig, none = () => { this.dropScaff(); return was !== ''; };
    const tiles = new Map(), started = [], blocks = new Map();
    for (const e of P.list) {
      const kind = PIECES[e.id].kind;
      if (e.layer !== 'roof' && kind !== 'wall' && kind !== 'door') continue;
      if (e.layer === 'placed' && e.rec.w > 0 && kind === 'wall') started.push([e.tx, e.ty]);
      const bx = Math.floor(e.tx / 3), by = Math.floor(e.ty / 3);
      blocks.set(by * 1e6 + bx, [bx, by, e.x - e.tx]);
    }
    for (const [bx, by, sh] of blocks.values()) for (let j = -SCAFF_R; j <= SCAFF_R; j++) for (let i = -SCAFF_R; i <= SCAFF_R; i++) tiles.set((by + j) * 1e6 + bx + i, [bx + i, by + j, sh]);
    if (!tiles.size) return none();
    const V = P.view, B = new Builder(), view = this.w3.view, live = new Set(started.map(String)), out = new Map();
    // (the walls near, in blocks of 3 × 3 tiles: standing, of the players' own making, or begun)
    for (const [bx, by, sh] of tiles.values()) for (let ty = by * 3; ty < by * 3 + 3; ty++) for (let tx = bx * 3; tx < bx * 3 + 3; tx++) {
      if (!(scene.ownAt('placed', tx, ty) && PIECES[scene.ownAt('placed', tx, ty)]?.kind === 'wall') && !live.has(`${tx},${ty}`)) continue;
      const isW = (i, j) => { const k = V.pieceAt(tx + i, ty + j)?.kind; return k === 'wall' || k === 'door'; };
      const mx = isW(1, 0) || isW(-1, 0), mz = isW(0, 1) || isW(0, -1);
      for (const X of mx && mz ? [true, false] : [mx || !mz]) {
        const side = outward(V, tx, ty, X);
        if (side === 'in' || side === 'free') continue;
        const dx = side === 'e' ? 1 : side === 'w' ? -1 : 0, dz = side === 's' ? 1 : side === 'n' ? -1 : 0, ox = tx + dx, oz = ty + dz;
        // (room for it: nothing there, dry and more or less level with the wall)
        if (scene.at('placed', ox, oz) || V.at('placed', ox, oz) || scene.at('floor', ox, oz) || scene.water?.(ox + 0.5, oz + 0.5)) continue;
        const base = scene.levelAt(tx + 0.5, ty + 0.5) ?? P.byKey.get(`placed:${tx},${ty}`)?.y ?? 0, g = view.terrain.heightAt(ox + 0.5, oz + 0.5);
        if (Math.abs(base - g) > 1.2) continue;
        out.set(`${tx},${ty},${side}`, { tx: tx + sh, ty, dx, dz, X: !!dz, base, g });
      }
    }
    if (!out.size) return none();
    let sig = '';
    for (const [k, s] of out) sig += `${k},${s.base.toFixed(2)},${s.g.toFixed(2)};`;
    if (sig === was) return false;
    this.dropScaff(); this.scaffSig = sig;
    const has = (s, d) => out.has(`${s.tx + (s.X ? d : 0)},${s.ty + (s.X ? 0 : d)},${s.dx > 0 ? 'e' : s.dx < 0 ? 'w' : s.dz > 0 ? 's' : 'n'}`);
    for (const s of out.values()) {
      const c0 = s.X ? s.tx : s.ty, wall = s.X ? s.ty + 0.5 : s.tx + 0.5, o = s.X ? s.dz : s.dx, near = wall + o * (THICK + 0.1), far = wall + o * 0.92, top = s.base + WALL_H - 0.08, deck = s.base + 1.4;
      // (u along the wall, k out from it)
      const box = (u0, u1, y0, y1, k0, k1) => { const a = Math.min(k0, k1), b = Math.max(k0, k1); if (s.X) B.box(u0, y0, a, u1, y1, b, { s: 0.6 }); else B.box(a, y0, u0, b, y1, u1, { s: 0.6 }); };
      const pole = u => {
        box(u - 0.035, u + 0.035, s.g - 0.1, top, far - 0.035, far + 0.035);
        box(u - 0.03, u + 0.03, deck - 0.12, deck - 0.05, near, far + o * 0.1);                 // the ledger, from the wall to past the pole
        box(u - 0.05, u + 0.05, deck - 0.14, deck - 0.1, far - 0.05, far + 0.05);                // its lashing
      };
      pole(c0 + 0.06);
      if (!has(s, 1)) pole(c0 + 0.94);
      const a = has(s, -1) ? c0 : c0 - 0.06, b = has(s, 1) ? c0 + 1 : c0 + 1.06, jit = ((s.tx * 7 + s.ty * 13) % 5) * 0.012;
      for (let i = 0; i < 3; i++) { const k = near + o * (0.04 + i * 0.22); box(a - (i === 1 ? jit : 0), b + (i === 2 ? jit : 0), deck - 0.05 + i * 0.003, deck - 0.005 + i * 0.003, k, k + o * 0.2); }
      box(a, b, deck + 0.86, deck + 0.93, far - 0.025, far + 0.025);                              // the rail
      box(a, b, s.g + 0.5 + (s.base - s.g) * 0.5, s.g + 0.56 + (s.base - s.g) * 0.5, far - 0.02, far + 0.02);   // and a low one
      if ((s.tx + s.ty) % 3 === 0) {   // (a brace, from the foot of its pole up to the deck)
        const y0 = s.g + 0.1, y1 = deck - 0.1, q = (u, y, k) => (s.X ? [u, y, k] : [k, y, u]), w = 0.03, u0 = c0 + 0.1, u1 = c0 + 0.95, kf = far + o * 0.05;
        for (const kk of [kf, kf - o * 0.03]) B.quadN(q(u0, y0 - w, kk), q(u1, y1 - w, kk), q(u1, y1 + w, kk), q(u0, y0 + w, kk), s.X ? [0, 0, kk === kf ? o : -o] : [kk === kf ? o : -o, 0, 0], [[0, 0], [1, 0], [1, 0.1], [0, 0.1]]);
      }
    }
    this.group.add((this.scaff = B.mesh(this.w3.mat('fence'))));
    return true;
  }
}
