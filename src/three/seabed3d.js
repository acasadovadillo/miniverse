// The seabed decor near the player: seaweed, shells, oysters, mussels and sunken chests from gen.seabed, the
// world.seabed layer of World3D. Design: docs/planes/gta/PLAN-D-barras-buceo.md §4.6 (drawing part).
//
// No bubble columns and no other hint over sunken chests (user decision, 2026-11-22): they are found by diving.
//
//   view3d.world.seabed = new Seabed(world3d); its group goes under the world3d group (it casts no shadow)
//   frame(g, time): draws the 3×3 chunks round the player, only while p.swim || p.wading || the camera is under the
//     water (view3d.under), else drops them: from above the water, behind 0.85-0.92 of it, it would cost draw calls for
//     nothing. Signature per chunk (which finds are taken: d.dived with takenNow and REGROW from src/dive.js, and the
//     chests opened, d.opened), checked every 0.5 s: a pick by another player (livesync) shows within half a second. Regrow
//     is seen there too, never from a day tick
//   hide(key): a local pick hides that find at once (a zero-scale instance matrix, no rebuild); dive.js calls
//     game.view3d.world?.seabed?.hide?.(key). A sunken chest is never hidden: hide(its key) redraws it open next frame
//   clear(): drops everything (a scene change, the world reset)
//   proxies(): copies of its meshes for engine.js prepare (their programs compiled before the first dive)
//   ?fondo=0 (apagada('fondo')) hides all seabed decor: drawing only, gen stays the same for every peer
//
// Not part of nature3d (NATURE, natSig): a pick or the daily regrow never rebuilds the nature blocks. Everything is
// drawn at the bed of the drawn mesh (terrain.heightAt), not at the gen bed (o.bed), which differs on steep lake sides
// and next to builds; o.bed is for reach only (dive.js). One instanced mesh per kind for the whole 3×3 (a few hundred
// instances refilled at once), and the chests merged into the shared tinted materials (no new program)
import * as THREE from 'three';
import { CHUNK } from '../world/gen.js';
import { wrapIndex } from '../world/planet.js';
import { takenNow } from '../dive.js';
import { getModel } from './models.js';
import { tintMats } from './tints.js';
import { Builder } from './geo.js';
import { apagada } from '../opciones.js';

const R = 1;              // chunks round the player's (3×3)
const CHECK_MS = 500;     // how often the signature is looked at
const OFF = apagada('fondo');
// How many of each at most (seaweed: 32 per chunk, gen.js; the others are rare) and how they look: the geometry's size
// (x, y, z in metres, for the unit shapes below) and the colours they take, one per find (from its key)
const CAP = { seaweed: 9 * 32, seashell: 128, oyster: 160, mussel: 64 };
const LOOK = {
  seashell: { size: [0.065, 0.028, 0.055], colors: ['#e9dfcf', '#dcc6b2', '#efe7da', '#e2cdbf', '#d8cfc0'] },
  oyster: { size: [0.11, 0.035, 0.08], colors: ['#7f786b', '#8b8374', '#736d63'] },
  mussel: { size: [0.06, 0.024, 0.03], colors: ['#2b2e38', '#353541', '#2f3333'] },
  seaweed: { colors: ['#ffffff', '#e9eed8', '#d9dcc4', '#f2e6cc'] },   // (over its vertex colours: green-brown variety)
};
// The sunken chest: the treasure chest of models.js (open once looted), in the shared tinted materials with the dark wet
// wood and tarnished metal of something long under the sea
const CHEST_TINT = { wood: ['woodT', '#4b4a37'], dark: ['woodT', '#3b3d2d'], light: ['woodT', '#57543d'], iron: ['metal', '#3d3f37'], gold: ['metal', '#7a6c3e'], brass: ['metal', '#6e6440'] };
const NEW_PER_FRAME = 3;   // chunks of finds worked out (gen.seabed, not yet cached) in one frame at most
// The slow current that sways the seaweed (no wind under the water), its time set every frame
const SEA = { time: { value: 0 } };

let MATS = null, GEOS = null;
function materials() {
  if (MATS) return MATS;
  // (the seaweed: opaque ribbons with vertex colours, no texture and no alphaTest, both faces; the sway in the vertex shader)
  const weed = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  weed.customProgramCacheKey = () => 'alga-v1';
  weed.onBeforeCompile = sh => {
    sh.uniforms.uSea = SEA.time;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uSea;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 iP = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #else
          vec3 iP = vec3(0.0);
        #endif
        float ph = iP.x * 0.37 + iP.z * 0.53, sk = position.y * position.y;
        transformed.x += sin(uSea * 0.7 + ph) * 0.2 * sk;
        transformed.z += cos(uSea * 0.53 + ph * 1.3) * 0.14 * sk;`);
  };
  // (the shells, oysters and mussels: one plain material, its colour per instance; a faint glint, so a pale shell catches
  // the eye in the murk)
  const shell = new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.04 });
  return (MATS = { weed, shell });
}
function geometries() {
  if (GEOS) return GEOS;
  // The seaweed ribbon: two crossed strips of three segments, 1 m tall (scaled per find), narrower and paler at the tip,
  // a little bent; 12 triangles
  const pos = [], col = [], idx = [], base = new THREE.Color('#33482f'), tip = new THREE.Color('#6b7a45'), c = new THREE.Color();
  for (let s = 0; s < 2; s++) {
    const a = s * Math.PI / 2, dx = Math.cos(a), dz = Math.sin(a), o = pos.length / 3;
    for (let r = 0; r <= 3; r++) {
      const t = r / 3, w = 0.08 - 0.045 * t, bend = 0.06 * t * t;
      c.copy(base).lerp(tip, t);
      for (const side of [-1, 1]) { pos.push(dx * w * side + bend * dz, t, dz * w * side - bend * dx); col.push(c.r, c.g, c.b); }
    }
    for (let r = 0; r < 3; r++) { const i = o + r * 2; idx.push(i, i + 1, i + 3, i, i + 3, i + 2); }
  }
  const weed = new THREE.BufferGeometry();
  weed.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  weed.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  weed.setIndex(idx);
  weed.computeVertexNormals();
  const dome = new THREE.SphereGeometry(1, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2);   // (a shell: a low dome on the sand)
  return (GEOS = { weed, seashell: dome, oyster: new THREE.DodecahedronGeometry(1, 0), mussel: new THREE.SphereGeometry(1, 6, 4) });
}
const pick = (list, key) => { let h = 2166136261; for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619); return list[(h >>> 0) % list.length]; };
const O = new THREE.Object3D(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0), COL = new THREE.Color();

export class Seabed {
  constructor(world3d) {
    this.world3d = world3d; this.view = world3d.view;
    this.group = null;
    this.meshes = null;         // kind → its InstancedMesh (made with the group)
    this.chests = [];           // the chests' merged meshes (made again with each build)
    this.owner = new Map();     // find key → [mesh, instance], for hide
    this.sig = ''; this.next = 0;
  }
  // The group and its instanced meshes, once (kept while the game runs; clear() empties them)
  make() {
    if (this.group) return;
    const M = materials(), G = geometries();
    this.group = new THREE.Group();
    this.group.name = 'seabed';
    this.meshes = {};
    for (const kind of ['seaweed', 'seashell', 'oyster', 'mussel']) {
      const m = new THREE.InstancedMesh(kind === 'seaweed' ? G.weed : G[kind], kind === 'seaweed' ? M.weed : M.shell, CAP[kind]);
      m.setColorAt(0, COL.set('#ffffff'));   // (the colour per instance exists from the start: the program is the same always)
      m.count = 0; m.visible = false; m.castShadow = false; m.receiveShadow = kind !== 'seaweed';
      this.meshes[kind] = m; this.group.add(m);
    }
    this.world3d.group.add(this.group);
  }
  frame(g, time) {
    SEA.time.value = time;
    if (OFF) return;
    const p = g.player, sc = g.scene;
    const want = !!p && !!sc && sc === g.world && !!sc.gen?.seabed && (p.swim || p.wading || !!this.view.under);
    if (!want) { if (this.sig) this.clear(); return; }
    const ccx = Math.floor(p.x / CHUNK), ccy = Math.floor(p.y / CHUNK), at = `${ccx},${ccy}`, now = performance.now();
    if (this.sig && this.at === at && now < this.next) return;
    this.next = now + CHECK_MS;
    const day = g.days?.realDay ?? 0, list = [];
    let sig = at, fresh = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const cx = ccx + dx, cy = ccy + dy, own = wrapIndex(cx, CHUNK);
      // (at most NEW_PER_FRAME chunks' finds worked out per frame, 25-70 climate calls each: the first wade into the sea
      // would make all nine at once; the rest on the next frames, and the drawing once they are all there)
      if (!sc.gen.beds?.has(`${own},${cy}`) && ++fresh > NEW_PER_FRAME) { this.next = 0; return; }
      const finds = sc.gen.seabed(cx, cy).finds;
      if (!finds.length) continue;
      const d = sc.deltas?.get(`${own},${cy}`) || null, gone = [], open = [];
      for (let i = 0; i < finds.length; i++) {
        const o = finds[i];
        if (o.kind === 'sunken_chest') { if (d?.opened?.[o.key] !== undefined) open.push(i); }
        else if (takenNow(d, o, day)) gone.push(i);
      }
      sig += `|${own},${cy}:${gone.join('.')}/${open.join('.')}`;
      list.push({ finds, off: (cx - own) * CHUNK, gone: new Set(gone), open: new Set(open) });
    }
    if (sig === this.sig) return;
    this.sig = sig; this.at = at;
    this.build(list);
  }
  // Fills the instanced meshes and makes the chests, for what is in sight now (list: per chunk, its finds, its offset
  // beyond the planet's seam and which are gone or open)
  build(list) {
    this.make();
    this.dropChests();
    this.owner.clear();
    const M = this.meshes, n = { seaweed: 0, seashell: 0, oyster: 0, mussel: 0 }, T = this.view.terrain, chests = new Map();
    for (const c of list) for (let i = 0; i < c.finds.length; i++) {
      const o = c.finds[i], x = o.x + c.off, z = o.y, kind = o.kind;
      if (c.gone.has(i)) continue;
      const h = T.heightAt(x, z);
      if (kind === 'sunken_chest') {
        // (a little sunk in the sand: it has been there a long time)
        const m = getModel(`treasure:${c.open.has(i) ? 1 : 0}`);
        if (!m) continue;
        for (const [key, B] of m.parts) {
          const [shared, color] = CHEST_TINT[key] || ['woodT', '#4b4a37'];
          let b = chests.get(shared);
          if (!b) chests.set(shared, (b = new Builder()));
          b.tint(color).add(B.transformed(x, h - 0.08, z, o.yaw || 0));
        }
        continue;
      }
      const mesh = M[kind], k = n[kind];
      if (!mesh || k >= CAP[kind]) continue;
      if (kind === 'seaweed') { O.position.set(x, h - 0.05, z); O.rotation.set(0, o.yaw || 0, 0); O.scale.set(1, o.tall || 1, 1); }
      else { const s = LOOK[kind].size; O.position.set(x, h + 0.005, z); O.rotation.set(0.12 * Math.sin(o.yaw || 0), o.yaw || 0, 0.1 * Math.cos(o.yaw || 0)); O.scale.set(s[0], s[1], s[2]); }
      O.updateMatrix();
      mesh.setMatrixAt(k, O.matrix);
      mesh.setColorAt(k, COL.set(pick(LOOK[kind].colors, o.key)));
      this.owner.set(o.key, [mesh, k]);
      n[kind] = k + 1;
    }
    for (const kind in M) {
      const m = M[kind];
      m.count = n[kind]; m.visible = n[kind] > 0;   // (none of a kind: not even an empty draw call)
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
    }
    const T2 = tintMats();
    for (const [shared, b] of chests) {
      if (b.empty) continue;
      const mesh = b.mesh(T2[shared], { cast: false, receive: true });
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh); this.chests.push(mesh);
    }
    this.group.visible = true;
  }
  dropChests() {
    for (const m of this.chests) { this.group?.remove(m); m.geometry.dispose(); }
    this.chests.length = 0;
  }
  // A local pick: hidden at once. A chest is drawn open again on the next frame (dive.js has written d.opened)
  hide(key) {
    const own = this.owner.get(key);
    if (!own) {
      // (a chest: built again on the next frame, whatever the signature says)
      if (String(key).startsWith('sunken_chest:') && this.sig) { this.next = 0; this.sig = '!'; }
      return;
    }
    const [mesh, i] = own;
    mesh.setMatrixAt(i, ZERO);
    mesh.instanceMatrix.needsUpdate = true;
    this.owner.delete(key);
  }
  // The drawn instance of find key, [instancedMesh, index], or null (a chest, or not drawn): outline.js outlines it alone
  instanceOf(key) { return this.owner.get(key) || null; }
  clear() {
    this.dropChests();
    this.owner.clear();
    if (this.meshes) for (const kind in this.meshes) { this.meshes[kind].count = 0; this.meshes[kind].visible = false; }
    if (this.group) this.group.visible = false;
    this.sig = ''; this.at = null; this.next = 0;
  }
  // Copies for engine.js prepare: visible, one instance each, with the real materials (the chests use tintMats, which the
  // world already compiles)
  proxies() {
    if (this.proxyGroup) return this.proxyGroup;
    const M = materials(), G = geometries(), g = new THREE.Group();
    for (const [geo, m] of [[G.weed, M.weed], [G.seashell, M.shell]]) {
      const p = new THREE.InstancedMesh(geo, m, 1);
      p.setColorAt(0, COL.set('#ffffff')); p.castShadow = false; p.receiveShadow = m === M.shell; p.frustumCulled = false;
      g.add(p);
    }
    return (this.proxyGroup = g);
  }
}
