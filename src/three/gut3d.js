// The gut piles that gutting a carcass leaves (Plan R3-3; carry.js gut: d.gut["x,y"] = when, in the chunk, or a cave's state):
// the paunch and some loops, dark and wet, that dry and sink in a day. At most SHOWN of them, the nearest; looked for once a
// second. With Settings › blood off there is none (and the gutted carcasses look whole: quality.js Gore).
import * as THREE from 'three';
import { CHUNK } from '../world/gen.js';
import { wrapIndex, nearX } from '../world/planet.js';
import { Settings } from '../settings.js';
import { Gore, GUT_TTL } from '../quality.js';
import { getModel } from './models.js';

const SHOWN = 4, NEAR = 26, EVERY = 1;
let GEO = null, MAT = null;
const BLOOD = new THREE.Color('#4a1511');
const rnd = i => { const v = Math.sin(i * 91.7 + 3.1) * 43758.5453; return v - Math.floor(v); };
// One mesh: the paunch (a sagging bag, grey green), three lumps of it and loops of gut on the ground round it, in vertex colours
function geometry() {
  if (GEO) return GEO;
  const pos = [], nor = [], col = [], idx = [], c = new THREE.Color(), v = new THREE.Vector3(), n = new THREE.Vector3();
  const add = (g, paint) => {
    const P = g.attributes.position, N = g.attributes.normal, off = pos.length / 3, I = g.index;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i); n.fromBufferAttribute(N, i);
      if (v.y < 0.004) v.y = 0.004;
      paint(v, n, c);
      pos.push(v.x, v.y, v.z); nor.push(n.x, n.y, n.z); col.push(c.r, c.g, c.b);
    }
    for (let i = 0; i < I.count; i++) idx.push(I.getX(i) + off);
    g.dispose();
  };
  // (a bag that sags on the ground: folds and bulges, darker in its creases)
  const bag = (x, z, r, sy, tint, seed, long = 1) => add(new THREE.SphereGeometry(r, 18, 12), (p, q, k) => {
    const a = Math.atan2(p.z, p.x), top = p.y / r, fold = Math.sin(a * 3 + seed) * Math.cos(top * 5 + seed * 1.7), wr = Math.sin(a * 9 + top * 7 + seed) * 0.5 + Math.sin(p.x * 90 + seed * 3) * Math.sin(p.z * 84) * 0.5;
    const w = 1 + 0.17 * fold + 0.05 * wr, flat = 1 + 0.35 * Math.max(0, -top);
    p.set(p.x * w * flat * long, Math.max(0.004, (p.y * w + r * 0.62) * sy), p.z * w * flat); p.x += x; p.z += z;
    k.set(tint).multiplyScalar(0.62 + 0.28 * Math.max(0, top) + 0.16 * fold + 0.1 * wr).lerp(BLOOD, Math.max(0, Math.min(0.75, 0.42 - top * 0.45 - fold * 0.3)));
  });
  bag(0, 0.01, 0.115, 0.62, '#6f6a52', 1, 1.25); bag(0.13, 0.08, 0.075, 0.6, '#57241d', 4); bag(-0.13, 0.05, 0.07, 0.62, '#3a1210', 7); bag(0.05, -0.12, 0.065, 0.55, '#6e4034', 9); bag(-0.07, -0.11, 0.05, 0.6, '#8a7a66', 12);
  // (loops: tubes along winding curves over and round it)
  for (let k = 0; k < 5; k++) {
    const pts = [], a0 = k * 1.31 + 0.4;
    for (let i = 0; i < 10; i++) { const a = a0 + i * 0.4 + 0.5 * Math.sin(i * 2.1 + k), r = 0.14 + 0.06 * Math.sin(i * 1.7 + k * 2) + 0.018 * k; pts.push(new THREE.Vector3(Math.cos(a) * r, 0.02 + (k > 2 ? 0.03 : 0.006) * (1 + Math.sin(i * 1.3 + k)), Math.sin(a) * r)); }
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.017 + 0.003 * rnd(k), 6), (p, q, c2) => { const w = Math.sin(p.x * 70 + k) * Math.sin(p.z * 63); c2.set(k % 2 ? '#8a5548' : '#7a5f55').multiplyScalar(0.62 + 0.3 * Math.max(0, q.y)).lerp(BLOOD, 0.34 + 0.22 * w); });
  }
  // (and what has run out of it, on the grass)
  add(new THREE.CircleGeometry(0.3, 26).rotateX(-Math.PI / 2), (p, q, c2) => { const a = Math.atan2(p.z, p.x), r = Math.hypot(p.x, p.z); if (r > 0.01) { const k = 0.72 + 0.16 * Math.sin(a * 3 + 1) + 0.12 * Math.sin(a * 7 + 2); p.x *= k; p.z *= k; } p.y = 0.012; c2.set('#33110c'); });
  GEO = new THREE.BufferGeometry();
  GEO.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); GEO.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); GEO.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  GEO.setIndex(idx); GEO.computeVertexNormals();
  return GEO;
}
// (dry: 0 fresh, 1 a day old: duller and darker)
const matOf = () => (MAT ||= Array.from({ length: 3 }, (_, i) => new THREE.MeshStandardMaterial({ vertexColors: true, color: new THREE.Color('#ffffff').lerp(new THREE.Color('#57463a'), i * 0.5), roughness: 0.46 + i * 0.22 })));

export class GutView {
  constructor(view) { this.group = new THREE.Group(); view.scene.add(this.group); this.pool = []; this.list = []; this.t = 0; this.view = view; this.at = null; }
  update(game, scene) {
    const now = performance.now() / 1000, on = Settings.v.blood !== false;
    if (Gore.on !== on) { Gore.on = on; this.redraw(game.world); this.at = null; }
    if (scene !== this.at || now - this.t > EVERY) { this.at = scene; this.t = now; this.look(game, scene, on); }
    // (while one is being gutted, its gutted model is made, when there is time: no hitch at the end)
    const G = game.carry?.gutting;
    if (G && G !== this.warm && on) { this.warm = G; const id = G.o.placed + ':gutted', f = () => getModel(id); if (globalThis.requestIdleCallback) requestIdleCallback(f, { timeout: 3000 }); else setTimeout(f, 500); }
    const me = game.player;
    for (let i = 0; i < this.pool.length; i++) {
      const g = this.list[i], m = this.pool[i];
      m.visible = !!g;
      if (g) m.position.x = nearX(g.x, me?.x ?? g.x);
    }
  }
  // (the gutted ones drawn again, as they look with the new setting: only here, nothing is sent)
  redraw(w) {
    if (!w?.deltas) return;
    for (const [k, d] of w.deltas) if (d?.cq && !k.startsWith('u:') && Object.values(d.cq).some(q => q?.[1] > 0)) { d.v = (d.v || 0) + 1; w.merged?.delete(k); }
    w.touches++;
  }
  look(game, scene, on) {
    const L = this.list, p = game.player;
    L.length = 0;
    if (!on || !p || !scene) return;
    const ms = game.days?.now ?? 0, see = M => { for (const k in M) { const age = ms - M[k]; if (!(age < GUT_TTL)) continue; const i = k.indexOf(','), x = +k.slice(0, i) + 0.5, y = +k.slice(i + 1) + 0.5, d = Math.hypot(nearX(x, p.x) - p.x, y - p.y); if (d < NEAR) L.push({ x, y, d, age: Math.max(0, age) }); } };
    if (scene === game.world) {
      const cx = Math.floor(p.x / CHUNK), cy = Math.floor(p.y / CHUNK), r = Math.ceil(NEAR / CHUNK);
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) { const d = game.world.deltas.get(`${wrapIndex(cx + i, CHUNK)},${cy + j}`); if (d?.gut) see(d.gut); }
    } else if (scene.state?.gut) see(scene.state.gut);
    L.sort((a, b) => a.d - b.d);
    if (L.length > SHOWN) L.length = SHOWN;
    L.forEach((g, i) => {
      const m = this.pool[i] ||= this.make(), k = g.age / GUT_TTL, s = 1 - 0.35 * k;
      m.material = matOf()[Math.min(2, Math.floor(k * 3))];
      m.position.set(g.x, this.view.groundY(scene, g.x, g.y), g.y);
      m.rotation.y = (g.x * 7.3 + g.y * 3.1) % 6.28;
      m.scale.set(s, s * (1 - 0.45 * k), s);
    });
  }
  make() { const m = new THREE.Mesh(geometry(), matOf()[0]); m.receiveShadow = true; this.group.add(m); return m; }
}
