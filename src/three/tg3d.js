// The table games in the world (docs/planes/gta/PLAN-I-juntos.md §5): the dice and their throw, the crows that are down, the tiles of
// the bridge, the pile and the hands (yours with its pips; the others', only their backs), the coins of the pot, and the cup and
// the box on a table at home. The models of the table, the cup and the box: tgmodels.js.
// Each table near with something on it has its own group, made again only when its game changes; nothing else per frame but a throw.
import * as THREE from 'three';
import { mat, paint, mergeParts } from './geo.js';
import { getModel, modelMat } from './models.js';
import { Profile } from '../accounts.js';
import { nearX } from '../world/planet.js';
import { apagado } from '../arte.js';
import { ihash } from '../util.js';

const FAR = 22, SLOW = 0.3;                 // tiles; s between two looks
const DIE = 0.052, TL = 0.086, TW = 0.043, TH = 0.015, GAP = 0.004;   // m: a die; a tile's length, width and height
const THROW = 0.62;                         // s a throw lasts
const RING = [0.335, 0.262];                // m: the half sides of the bridge's path, round the middle of the table
const CELL = 64;
let ATLAS = null, M = null, GEO = null;

// ---------- the pictures: pips and crow (one canvas, 8 × 2 cells) ----------
const SPOTS = { 1: [[0.5, 0.5]], 2: [[0.26, 0.26], [0.74, 0.74]], 3: [[0.24, 0.24], [0.5, 0.5], [0.76, 0.76]], 4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]], 5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]], 6: [[0.28, 0.22], [0.28, 0.5], [0.28, 0.78], [0.72, 0.22], [0.72, 0.5], [0.72, 0.78]] };
// (our own crow, as in the window, ui/tablewin.js: in a box of 24)
function crowPath(g) {
  g.beginPath(); g.moveTo(3, 13.5); g.lineTo(8.2, 11); g.bezierCurveTo(9, 8.4, 11, 6.5, 13.800, 6.100); g.bezierCurveTo(15.300, 5.900, 16.600, 6.200, 17.600, 7); g.lineTo(21.500, 8); g.lineTo(18, 9.200);
  g.bezierCurveTo(17.900, 12.200, 16.300, 14.900, 13.500, 16.200); g.lineTo(12.900, 19.500); g.lineTo(11.700, 19.500); g.lineTo(11.900, 16.600); g.bezierCurveTo(11.400, 16.700, 10.900, 16.700, 10.400, 16.700); g.lineTo(9.500, 19.500); g.lineTo(8.300, 19.500); g.lineTo(9.100, 16.500); g.bezierCurveTo(6.600, 16.200, 4.700, 15.100, 3, 13.500); g.closePath();
}
function atlas() {
  if (ATLAS) return ATLAS;
  const cv = document.createElement('canvas'); cv.width = CELL * 8; cv.height = CELL * 2;
  const g = cv.getContext('2d');
  // (row 0: the dice's faces, bone with their pips sunk in, the 1 a crow; row 1: the halves of the tiles, 0 to 5, and their back)
  for (let i = 0; i < 8; i++) {
    const x = i * CELL, gr = g.createRadialGradient(x + CELL * 0.45, CELL * 0.4, 4, x + CELL / 2, CELL / 2, CELL * 0.75);
    gr.addColorStop(0, '#f1e8d6'); gr.addColorStop(0.75, '#e2d5bb'); gr.addColorStop(1, '#c3ae88');
    g.fillStyle = gr; g.fillRect(x, 0, CELL, CELL);
    for (let k = 0; k < 26; k++) { g.fillStyle = `rgba(120, 92, 52, ${0.03 + ihash(i, k, 7001) * 0.07})`; g.fillRect(x + ihash(i, k, 7003) * CELL, ihash(i, k, 7005) * CELL, 1 + ihash(i, k, 7007) * 7, 0.8); }
    if (i === 1) { g.save(); g.translate(x + CELL * 0.11, CELL * 0.1); g.scale(CELL * 0.78 / 24, CELL * 0.78 / 24); crowPath(g); g.fillStyle = '#15110d'; g.fill(); g.fillStyle = '#e8ddc6'; g.beginPath(); g.arc(17, 8.4, 0.5, 0, 7); g.fill(); g.restore(); }
    else for (const [a, b] of SPOTS[i] || []) pip(g, x + a * CELL, b * CELL, CELL * 0.095, '#241a12', 'rgba(255, 248, 230, .55)');
    const y = CELL;
    g.fillStyle = '#3a2516'; g.fillRect(x, y, CELL, CELL);
    for (let k = 0; k < 30; k++) { g.fillStyle = `rgba(${ihash(i, k, 7011) > 0.5 ? '120, 78, 44' : '18, 10, 5'}, ${0.08 + ihash(i, k, 7013) * 0.16})`; g.fillRect(x + ihash(i, k, 7015) * CELL * 0.6, y + ihash(i, k, 7017) * CELL, CELL * (0.25 + ihash(i, k, 7019) * 0.75), 1 + ihash(i, k, 7021) * 1.6); }
    if (i < 6) for (const [a, b] of SPOTS[i] || []) pip(g, x + a * CELL, y + b * CELL, CELL * 0.09, '#efe3c9', 'rgba(0, 0, 0, .6)');
    if (i === 7) { g.strokeStyle = 'rgba(205, 160, 100, .5)'; g.lineWidth = 2; g.strokeRect(x + 8, y + 8, CELL - 16, CELL - 16); g.save(); g.translate(x + CELL * 0.2, y + CELL * 0.2); g.scale(CELL * 0.6 / 24, CELL * 0.6 / 24); crowPath(g); g.fillStyle = 'rgba(205, 160, 100, .5)'; g.fill(); g.restore(); }
  }
  ATLAS = new THREE.CanvasTexture(cv);
  ATLAS.colorSpace = THREE.SRGBColorSpace; ATLAS.anisotropy = 4;
  return ATLAS;
}
function pip(g, x, y, r, ink, rim) { g.fillStyle = rim; g.beginPath(); g.arc(x + r * 0.14, y + r * 0.2, r * 1.08, 0, 7); g.fill(); g.fillStyle = ink; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
const cellUv = (i, row, inset = 0.03) => [(i + inset) / 8, 1 - (row + 1 - inset) / 2, (i + 1 - inset) / 8, 1 - (row + inset) / 2];

// ---------- the pieces ----------
// A die: a cube with its edges and corners worn round, each face with its picture. Faces: +y 1, -y 6, +x 2, -x 5, +z 3, -z 4
const FACE_N = [2, 5, 1, 6, 3, 4];
function dieGeo() {
  const g = new THREE.BoxGeometry(DIE, DIE, DIE, 5, 5, 5), P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, r = DIE * 0.2, h = DIE / 2 - r, v = new THREE.Vector3(), q = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i); q.set(Math.max(-h, Math.min(h, v.x)), Math.max(-h, Math.min(h, v.y)), Math.max(-h, Math.min(h, v.z)));
    v.sub(q); if (v.lengthSq() > 1e-12) { v.normalize(); N.setXYZ(i, v.x, v.y, v.z); P.setXYZ(i, q.x + v.x * r, q.y + v.y * r, q.z + v.z * r); }
    const [u0, v0, u1, v1] = cellUv(FACE_N[Math.floor(i / 36)], 0);
    U.setXY(i, u0 + (u1 - u0) * U.getX(i), v0 + (v1 - v0) * U.getY(i));
  }
  return g;
}
// (the turn that leaves each face up)
const UP = (() => { const e = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)), H = Math.PI / 2; return { 1: e(0, 0, 0), 6: e(Math.PI, 0, 0), 2: e(0, 0, H), 5: e(0, 0, -H), 3: e(-H, 0, 0), 4: e(H, 0, 0) }; })();
const COIN = [0.021, 0.0046];
function geos() {
  if (GEO) return GEO;
  const s = new THREE.Shape(); crowPath({ beginPath() {}, closePath() { s.closePath(); }, moveTo: (x, y) => s.moveTo(x - 12, 19.5 - y), lineTo: (x, y) => s.lineTo(x - 12, 19.5 - y), bezierCurveTo: (a, b, c, d, x, y) => s.bezierCurveTo(a - 12, 19.5 - b, c - 12, 19.5 - d, x - 12, 19.5 - y) });
  const crow = mergeParts([paint(new THREE.ExtrudeGeometry(s, { depth: 2.6, bevelEnabled: true, bevelThickness: 0.7, bevelSize: 0.55, bevelSegments: 2, curveSegments: 6 }).translate(0, 1.6, -1.3).scale(0.0039, 0.0039, 0.0039).toNonIndexed(), new THREE.Color('#1b1815')), paint(new THREE.CylinderGeometry(0.021, 0.024, 0.008, 20).translate(0, 0.004, 0).toNonIndexed(), new THREE.Color('#4a3018'))].map(index));
  const coin = new THREE.CylinderGeometry(COIN[0], COIN[0], COIN[1], 20);
  const blob = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  return (GEO = { die: dieGeo(), crow, coin, blob });
}
// (mergeParts wants them all with an index)
function index(g) { if (!g.index) { const n = g.attributes.position.count, I = new Uint32Array(n); for (let i = 0; i < n; i++) I[i] = i; g.setIndex(new THREE.BufferAttribute(I, 1)); } return g; }
function mats() {
  if (M) return M;
  const cv = document.createElement('canvas'); cv.width = cv.height = 32;
  const g = cv.getContext('2d'), gr = g.createRadialGradient(16, 16, 2, 16, 16, 16);
  gr.addColorStop(0, 'rgba(0,0,0,.62)'); gr.addColorStop(0.5, 'rgba(0,0,0,.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  const soft = new THREE.CanvasTexture(cv);
  return (M = {
    piece: mat({ map: atlas(), roughness: 0.5 }), wood: mat({ map: atlas(), roughness: 0.55, color: '#ffffff' }),
    crow: mat({ vertexColors: true, roughness: 0.42 }), coin: mat({ color: apagado('#d9b04a'), metalness: 0.75, roughness: 0.32 }),
    blob: new THREE.MeshBasicMaterial({ map: soft, transparent: true, depthWrite: false, opacity: 0.75, polygonOffset: true, polygonOffsetFactor: -1 }),
  });
}

// ---------- the bridge's path ----------
// A rectangle with round corners, walked from the middle of its near side: [x, z, angle] at a length s (it goes round)
const PATH = (() => {
  const [a, b] = RING, r = 0.09, out = [], step = 0.006, arc = (cx, cz, t0) => { const n = Math.ceil(r * Math.PI / 2 / step); for (let i = 0; i < n; i++) { const q = t0 - (i / n) * Math.PI / 2; out.push([cx + Math.cos(q) * r, cz + Math.sin(q) * r]); } };
  const line = (x0, z0, x1, z1) => { const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step); for (let i = 0; i < n; i++) out.push([x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n]); };
  line(0, b, a - r, b); arc(a - r, b - r, Math.PI / 2); line(a, b - r, a, -b + r); arc(a - r, -b + r, 0); line(a - r, -b, -a + r, -b); arc(-a + r, -b + r, -Math.PI / 2); line(-a, -b + r, -a, b - r); arc(-a + r, b - r, Math.PI); line(-a + r, b, 0, b);
  let len = 0; const at = out.map((p, i) => { const q = out[(i + 1) % out.length], d = Math.hypot(q[0] - p[0], q[1] - p[1]), e = [len, p[0], p[1], Math.atan2(-(q[1] - p[1]), q[0] - p[0])]; len += d; return e; });
  return { at, len };
})();
export function pathAt(s) {
  const L = PATH.len, q = ((s % L) + L) % L; let lo = 0, hi = PATH.at.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (PATH.at[m][0] <= q) lo = m; else hi = m - 1; }
  const e = PATH.at[lo], o = q - e[0];
  return [e[1] + Math.cos(e[3]) * o, e[2] - Math.sin(e[3]) * o, e[3]];
}
// Where the bridge's tile i lies (the first one played stays where it was put)
export const bridgeAt = (i, start) => pathAt((i - start) * (TL + GAP));

// Many tiles in one mesh: put(pips or null (its back up), matrix)
class Tiles {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.idx = []; this.v = new THREE.Vector3(); this.n = new THREE.Vector3(); this.nm = new THREE.Matrix3(); }
  quad(m, p, n, uvs) {
    const i = this.pos.length / 3;
    this.nm.getNormalMatrix(m); this.n.set(...n).applyMatrix3(this.nm).normalize();
    p.forEach((q, k) => { this.v.set(...q).applyMatrix4(m); this.pos.push(this.v.x, this.v.y, this.v.z); this.nor.push(this.n.x, this.n.y, this.n.z); this.uv.push(...uvs[k]); });
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  put(q, m) {
    const X = TL / 2, Z = TW / 2, Y = TH, e = 0.0016, plain = cellUv(6, 1, 0.1), face = (c, u) => [[u[0], u[1]], [u[2], u[1]], [u[2], u[3]], [u[0], u[3]]];
    const half = (x0, x1, c) => this.quad(m, [[x0, Y, Z - e], [x1, Y, Z - e], [x1, Y, -Z + e], [x0, Y, -Z + e]], [0, 1, 0], face(0, cellUv(c, 1)));
    if (q) { half(-X + e, -0.0007, q[0]); half(0.0007, X - e, q[1]); } else { const u = cellUv(7, 1); this.quad(m, [[-X + e, Y, Z - e], [X - e, Y, Z - e], [X - e, Y, -Z + e], [-X + e, Y, -Z + e]], [0, 1, 0], face(0, u)); }
    const B = face(0, plain), y = Y - e;
    // (the sides, with a bevel up to the face, and the underside)
    for (const [ax, az, n] of [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, z]) => [x, z, [x, 0, z]])) {
      const p = ax ? [[ax * X, 0, ax * Z], [ax * X, 0, -ax * Z], [ax * X, y, -ax * Z], [ax * X, y, ax * Z]] : [[-az * X, 0, az * Z], [az * X, 0, az * Z], [az * X, y, az * Z], [-az * X, y, az * Z]];
      this.quad(m, p, n, B);
      const i = v => [v[0] - Math.sign(v[0]) * e, Y, v[2] - Math.sign(v[2]) * e];
      this.quad(m, [p[3], p[2], i(p[2]), i(p[3])], [ax * 0.7, 0.7, az * 0.7], B);
    }
    this.quad(m, [[-X, 0, -Z], [X, 0, -Z], [X, 0, Z], [-X, 0, Z]], [0, -1, 0], face(0, q ? cellUv(7, 1) : plain));
  }
  mesh() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mats().wood);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
}
const T4 = (x, y, z, yaw, rx = 0) => new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeRotationX(rx)).setPosition(x, y, z);

// ---------- what is drawn ----------
export class TableView {
  constructor(view) { this.view = view; this.group = new THREE.Group(); this.group.name = 'tables'; view.scene.add(this.group); this.list = new Map(); this.slow = 0; this.q = new THREE.Quaternion(); this.m4 = new THREE.Matrix4(); this.one = new THREE.Vector3(1, 1, 1); this.v = new THREE.Vector3(); }
  clear() { for (const k of [...this.list.keys()]) this.gone(k); }
  gone(k) { const e = this.list.get(k); if (!e) return; this.group.remove(e.group); for (const g of e.own) g.dispose(); for (const i of e.inst) i.dispose(); this.list.delete(k); }
  update(game, scene, dt) {
    const T = game.tables;
    if (!T || !T.index.size || scene !== game.world || !game.player) { if (this.list.size) this.clear(); return; }
    if ((this.slow -= dt) <= 0) { this.slow = SLOW; this.look(game, T); }
    for (const e of this.list.values()) {
      const r = e.key && T.rec(e.tile);
      if (r && e.sig !== this.sig(T, e.tile, r)) this.make(game, T, e.tile, r);
      if (e.anim) this.anim(e, dt);
    }
  }
  look(game, T) {
    const p = game.player, live = new Set();
    for (const tile of T.index.keys()) {
      const r = T.rec(tile), kit = T.kitAtRaw(tile), on = (r?.id && r.ph && r.ph !== 'open') || kit.length;
      if (!on) continue;
      const t = T.tableAt(tile);
      if (!t || Math.hypot(nearX(t.x, p.x) - p.x, t.y - p.y) > FAR) continue;
      live.add(tile);
      const e = this.list.get(tile);
      if (!e || e.sig !== this.sig(T, tile, r)) this.make(game, T, tile, r);
    }
    for (const k of [...this.list.keys()]) if (!live.has(k)) this.gone(k);
  }
  sig(T, tile, r) { const t = T.tableAt(tile); return `${r?.id || ''}|${r?.ph || ''}|${r?.n ?? ''}|${T.kitAtRaw(tile)}|${t ? `${t.x},${t.y},${t.yaw},${t.h}` : ''}`; }
  // A table's things, made again (a throw goes on from the one before)
  make(game, T, tile, r) {
    const t = T.tableAt(tile), was = this.list.get(tile), thrown = was?.thrown;
    this.gone(tile);
    if (!t) return;
    const W = this.view, e = { tile, key: tile, sig: this.sig(T, tile, r), group: new THREE.Group(), own: [], inst: [], anim: null, thrown };
    const on = r?.id && r.ph !== 'open' && Array.isArray(r.seats), bar = t.kind === 'bar';
    let cx = t.x, cz = t.y;
    if (bar) { const s = on ? r.seats.filter(q => Array.isArray(q.at)) : [], mx = s.length ? s.reduce((a, q) => a + q.at[0], 0) / s.length : t.x; cx = Math.floor(Math.max(t.x0 + 0.4, Math.min(t.x1 - 0.4, mx))) + 0.36; cz = t.y + 0.02; }
    e.group.position.set(cx, W.groundY(game.world, t.x, t.y) + t.h + 0.001, cz);
    e.group.rotation.y = bar ? 0 : t.yaw;
    e.mini = bar ? 0.62 : 1;   // (on the counter, between the jugs)
    this.group.add(e.group);
    this.list.set(tile, e);
    if (on) { if (r.game === 'crows') this.crows(e, r, thrown, t); else this.tiles(e, r, t); this.coins(e, r); }
    const kit = T.kitAtRaw(tile), busy = on && r.ph !== 'end';
    if (t.tavern ? on && r.game === 'crows' : kit.includes('dice')) this.thing(e, on && r.game === 'crows' ? 'tg_cup' : 'dice', bar ? -0.2 : -0.31, bar ? -0.13 : -0.27, 0.5);
    if (!bar && !t.tavern && kit.includes('tile_box') && !(busy && r.game === 'tiles')) this.thing(e, 'tile_box', 0.12, on ? 0.02 : 0.04, -0.3);
    e.group.updateMatrixWorld(true);
  }
  thing(e, what, x, z, yaw) {
    const m = getModel(what);
    if (!m) return;
    const p = new THREE.Group();
    for (const [k, B] of m.parts) if (!B.empty) { const q = B.mesh(modelMat(k)); e.own.push(q.geometry); p.add(q); }
    p.position.set(x, 0, z); p.rotation.y = yaw;
    e.group.add(p);
  }
  seatDir(e, s, t) {
    const a = e.group.rotation.y, dx = s.at[0] - t.x, dz = s.at[1] - t.y, c = Math.cos(a), n = Math.sin(a);
    return [dx * c - dz * n, dx * n + dz * c];   // (in the group's axes)
  }
  inst(e, geo, m, n) { const q = new THREE.InstancedMesh(geo, m, n); q.castShadow = true; q.receiveShadow = true; q.frustumCulled = false; e.inst.push(q); e.group.add(q); return q; }
  crows(e, r, thrown, t) {
    const st = r.st, G = geos(), X = mats();
    if (!st) return;
    const L = st.last, roll = L && (L.k === 'roll' || L.k === 'bust' || L.k === 'murder') ? L : null, faces = roll ? roll.dice || st.dice : st.dice || [2, 4, 6];
    const dice = this.inst(e, G.die, X.piece, 3), blob = new THREE.InstancedMesh(G.blob, X.blob, 3);
    blob.frustumCulled = false; e.inst.push(blob); e.group.add(blob);
    const k = e.mini, seat = roll && r.seats[roll.seat], from = seat?.at && t.kind !== 'bar' ? this.seatDir(e, seat, t) : seat?.at ? [seat.at[0] - e.group.position.x, 0.6] : [0.5, 0];
    const fl = Math.hypot(...from) || 1, ends = [0, 1, 2].map(i => {
      const h = q => ihash(r.n * 3 + i, q, 9100 + (r.id.charCodeAt(0) || 1));
      return { x: (-0.1 + i * 0.1 + (h(1) - 0.5) * 0.04) * (k < 1 ? 0.85 : 1), z: (k < 1 ? 0.12 : 0.24) + (h(2) - 0.5) * 0.06 * k, q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), h(3) * 6.283).multiply(UP[faces[i]] || UP[2]), spin: new THREE.Vector3(h(4) - 0.5, h(5) - 0.5, h(6) - 0.5).normalize(), turns: 7 + h(7) * 6 };
    });
    const id = `${r.id}:${r.n}`, fresh = roll && thrown !== id && thrown !== undefined;
    e.dice = { dice, blob, ends, from: [from[0] / fl * Math.min(fl, 0.5), from[1] / fl * Math.min(fl, 0.42)] };
    e.thrown = roll ? id : thrown || id;
    e.anim = fresh ? { t: 0 } : null;
    this.setDice(e, fresh ? 0 : 1);
    // The crows that are down
    const n = L?.k === 'bust' || L?.k === 'murder' ? 3 : st.crows;
    if (n > 0) {
      const C = this.inst(e, G.crow, X.crow, n);
      for (let i = 0; i < n; i++) C.setMatrixAt(i, T4((k < 1 ? 0.02 : -0.02) + i * 0.075 * (k < 1 ? 0.9 : 1), 0, k < 1 ? -0.14 : -0.27, 0.35 + i * 0.5));
      C.instanceMatrix.needsUpdate = true;
    }
  }
  // The dice, k of the way of their throw: a hop from the hand with two bounces, tumbling, to where they end
  setDice(e, k) {
    const D = e.dice, up = k >= 1 ? 0 : bounce(k), run = 1 - (1 - k) ** 2;
    D.ends.forEach((o, i) => {
      const x = D.from[0] + (o.x - D.from[0]) * run, z = D.from[1] + (o.z - D.from[1]) * run, y = DIE / 2 + up * 0.2;
      this.q.setFromAxisAngle(o.spin, (1 - run) * o.turns).multiply(o.q);
      D.dice.setMatrixAt(i, this.m4.compose(this.v.set(x, y, z), this.q, this.one));
      const s = DIE * (1.9 - up * 0.6);
      D.blob.setMatrixAt(i, new THREE.Matrix4().makeScale(s, 1, s).setPosition(x, 0.0012, z));
    });
    D.dice.instanceMatrix.needsUpdate = true; D.blob.instanceMatrix.needsUpdate = true;
  }
  anim(e, dt) { e.anim.t += dt; const k = Math.min(1, e.anim.t / THROW); this.setDice(e, k); if (k >= 1) e.anim = null; }
  tiles(e, r, t) {
    const st = r.st;
    if (!st) return;
    const B = new Tiles(), mine = r.seats.findIndex(s => s.who === (Profile.id || 'me') && !s.npc), open = r.ph === 'end';
    st.bridge.forEach((q, i) => { const [x, z, a] = bridgeAt(i, st.start || 0); B.put(q, T4(x, 0, z, a)); });
    // (the pile, in stacks beside the middle)
    st.pile.forEach((q, i) => { const c = Math.floor(i / 4), y = (i % 4) * (TH + 0.0005); B.put(null, T4(-0.185 + (c % 2) * 0.05, y, -0.075 + Math.floor(c / 2) * 0.1 + ihash(i, 3, 9301) * 0.004, Math.PI / 2 + (ihash(i, 5, 9303) - 0.5) * 0.08)); });
    // (the hands, standing on the edge before each one, their faces towards them; at the end, face up)
    r.seats.forEach((s, i) => {
      if (s.out || !Array.isArray(s.at)) return;
      const [dx, dz] = this.seatDir(e, s, t), side = Math.abs(dx) > Math.abs(dz), sg = Math.sign(side ? dx : dz) || 1, h = st.hands[i], reach = side ? (t.id === 'game_table' ? 0.385 : 0.45) : t.id === 'game_table' ? 0.385 : 0.375;
      h.forEach((q, j) => {
        const o = (j - (h.length - 1) / 2) * (TW + 0.006), see = open || i === mine;
        const x = side ? sg * reach : o, z = side ? o : sg * reach, yaw = Math.atan2(side ? sg : 0, side ? 0 : sg);
        const m = new THREE.Matrix4().makeRotationY(yaw);
        if (open) m.multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)).setPosition(x, 0, z);
        // (standing: its length up, leaning back a little)
        else m.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2 - 0.24)).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)).setPosition(x, TL / 2 * Math.cos(0.24), z);
        B.put(see ? q : null, m);
      });
    });
    if (!B.idx.length) return;
    const m = B.mesh();
    e.own.push(m.geometry); e.group.add(m);
  }
  // The pot, in little piles
  coins(e, r) {
    const pot = r.pot || (r.ph === 'ante' ? r.stake * r.seats.filter(s => s.in).length : 0);
    if (!pot || r.ph === 'end') return;
    const n = Math.max(1, Math.min(12, Math.round(pot / (pot <= 20 ? 5 : pot <= 60 ? 8 : 18)) + 1)), C = this.inst(e, geos().coin, mats().coin, n), k = e.mini;
    for (let i = 0; i < n; i++) {
      const p = i % 3, y = Math.floor(i / 3), j = q => (ihash(i, q, 9401) - 0.5) * 0.006;
      C.setMatrixAt(i, T4((k < 1 ? 0.21 : r.game === 'crows' ? 0.27 : 0.16) + (p % 2) * 0.05 + j(1), COIN[1] * (y + 0.5), (k < 1 ? -0.04 : r.game === 'crows' ? -0.24 : -0.02) + Math.floor(p / 2) * 0.046 + j(2), i));
    }
    C.instanceMatrix.needsUpdate = true;
  }
}
// (its height, 0 to 1: the hop and two lower bounces)
const bounce = k => (k < 0.5 ? Math.sin(Math.PI * (0.35 + k * 1.3)) : k < 0.78 ? Math.sin(Math.PI * (k - 0.5) / 0.28) * 0.32 : Math.sin(Math.PI * (k - 0.78) / 0.22) * 0.1);
