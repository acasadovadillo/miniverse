// The things of the places of the world and of the hamlets (docs/planes/realismo/PLAN-R7-mundo.md §3.6; R7-3): the tent and
// the campfire, the beached boats, what a hamlet works with (nets, drying racks, logs, the charcoal burners' clamp, the ore
// cart…), the spring, the salt lick, what dresses a watchtower by how it is kept and by its land, the sanctuary's bell and
// the stone bridge. Models as in models.js (getModel calls KIT[name](m, a, b, c)): the ground at y = 0, the front to +z, the
// pieces by material key so that those of a chunk go together. Nothing here imports models.js: it gets its Model (m).
import * as THREE from 'three';
import { Builder, mat, rockGeo, snowCap } from './geo.js';
import { rng, rockFace, thatch, plaster } from './textures.js';
import { apagado } from '../arte.js';
import { TOWER } from '../world/tower.js';

const TAU = Math.PI * 2, UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _one = new THREE.Vector3(1, 1, 1), _d = new THREE.Vector3(), _a = new THREE.Vector3();
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- pieces ----------
// A round pole from a to b (the grain along it)
const RODS = new Map();
function rodGeo(r0, r1, len, seg) {
  const L = Math.round(len * 20) / 20 || 0.05, k = `${r0}:${r1}:${L}:${seg}`;
  if (!RODS.has(k)) {
    const g = new THREE.CylinderGeometry(r1, r0, 1, seg).translate(0, 0.5, 0), uv = g.attributes.uv, n = (seg + 1) * 2;
    for (let i = 0; i < n; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, v * L, u * Math.max(r0, r1) * 6.3); }
    for (let i = n; i < uv.count; i++) uv.setXY(i, uv.getX(i) * r0 * 2, uv.getY(i) * r0 * 2);
    RODS.set(k, g);
  }
  return RODS.get(k);
}
export function rod(m, key, a, b, r0, r1 = r0, seg = 7, solid = true) {
  _a.set(...a); _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _d.length();
  if (len < 1e-4) return m;
  _q.setFromUnitVectors(UP, _d.normalize());
  _m.compose(_a, _q, new THREE.Vector3(1, len, 1));
  m.B(key).addGeometry(rodGeo(r0, r1, len, seg), _m);
  if (solid) { const r = Math.max(r0, r1); m.solids.push([Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.min(a[2], b[2]) - r, Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r, Math.max(a[2], b[2]) + r]); }
  return m;
}
// A squared timber from a to b, w wide (across) and h along `hint`; bevel: worn edges
export function beam(m, key, a, b, w, h, hint = [0, 1, 0], bevel = 0.01, solid = true) {
  const A = new THREE.Vector3(...a), Z = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), len = Z.length();
  Z.normalize();
  const X = new THREE.Vector3().crossVectors(new THREE.Vector3(...hint), Z).normalize(), Y = new THREE.Vector3().crossVectors(Z, X);
  const M = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(A), bl = new Builder();
  // (laid along x while its texture is put on, so the grain goes along it)
  if (bevel) bl.roundBox(0, -h / 2, -w / 2, len, h / 2, w / 2, bevel, { s: 0.6 }); else bl.box(0, -h / 2, -w / 2, len, h / 2, w / 2, { s: 0.6 });
  M.multiply(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0)));
  addB(m, key, bl, M);
  if (solid) { const r = Math.max(w, h) / 2; m.solids.push([Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.min(a[2], b[2]) - r, Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r, Math.max(a[2], b[2]) + r]); }
  return m;
}
// A Builder moved by a matrix, into a material of the model
const _nm = new THREE.Matrix3(), _v = new THREE.Vector3();
export function addB(m, key, src, M4) {
  const b = new Builder();
  _nm.getNormalMatrix(M4);
  b.uv = src.uv.slice(); b.idx = src.idx.slice(); b.col = src.col && src.col.slice();
  for (let i = 0; i < src.pos.length; i += 3) { _v.set(src.pos[i], src.pos[i + 1], src.pos[i + 2]).applyMatrix4(M4); b.pos.push(_v.x, _v.y, _v.z); _v.set(src.nor[i], src.nor[i + 1], src.nor[i + 2]).applyMatrix3(_nm).normalize(); b.nor.push(_v.x, _v.y, _v.z); }
  m.B(key).add(b);
}
// A smooth surface by f(u, v) → [x, y, z], with nu × nv cells. uv(u, v): its texture's coordinates; s: shade by vertex
function sheet(B, f, nu, nv, { uv = (u, v) => [u, v], flip = false, shade = null } = {}) {
  const P = [];
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) P.push(f(i / nu, j / nv));
  const off = B.pos.length / 3, N = P.map(() => [0, 0, 0]);
  const add = (a, b, c) => {
    const A = P[a], Bq = P[b], C = P[c], u = [Bq[0] - A[0], Bq[1] - A[1], Bq[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    for (const k of [a, b, c]) { N[k][0] += n[0]; N[k][1] += n[1]; N[k][2] += n[2]; }
  };
  const idx = [];
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = i * (nv + 1) + j, b = a + nv + 1, c = b + 1, d = a + 1;
    for (const t of flip ? [[a, c, b], [a, d, c]] : [[a, b, c], [a, c, d]]) { idx.push(t); add(...t); }
  }
  for (let k = 0; k < P.length; k++) {
    const l = Math.hypot(...N[k]) || 1, u = Math.floor(k / (nv + 1)) / nu, v = (k % (nv + 1)) / nv;
    B.pos.push(...P[k]); B.nor.push(N[k][0] / l, N[k][1] / l, N[k][2] / l); B.uv.push(...uv(u, v));
    if (shade && !B.col) B.col = new Array(off * 3).fill(1);
    if (B.col) { const s = shade ? shade(u, v) : 1; B.col.push(s, s, s); }
  }
  for (const t of idx) B.idx.push(off + t[0], off + t[1], off + t[2]);
}
// A small stone: a ball of 80 facets, lumpy and a little flat below
const PEBBLES = [];
function pebbleGeo(i) {
  if (!PEBBLES[i]) {
    const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position, uv = g.attributes.uv, s = i * 2.7 + 1;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = p.getY(k), z = p.getZ(k), r = 1 + 0.16 * Math.sin(x * 2.3 + s) * Math.sin(z * 2.9 - s) + 0.1 * Math.sin(y * 4.1 + x * 3 + s * 2);
      p.setXYZ(k, x * r, Math.max(-0.75, y * r), z * r); uv.setXY(k, x * 0.4 + s, (y + z) * 0.4);
    }
    g.computeVertexNormals(); g.computeBoundingBox();
    PEBBLES[i] = g;
  }
  return PEBBLES[i];
}
export const pebble = (m, key, x, y, z, sx, sy, sz, i, rot = [0, 0, 0]) => m.geo(key, pebbleGeo(i % 4), x, y, z, rot, [sx, sy, sz]);
const ROCKS = [];
const boulder = (m, key, x, y, z, sx, sy, sz, i, yaw = 0) => m.geo(key, (ROCKS[i % 3] ||= rockGeo((i % 3) + 1)), x, y, z, [0, yaw, 0], [sx, sy, sz]);

// ---------- textures ----------
const canvas = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
let CLOTH, NET, IVY, SILLARES;
// Canvas cloth, 1 × 1 m: the weave, a seam down one edge, the water stains and the dirt of years
const clothTex = () => (CLOTH ||= canvas(256, 256, (g, w, h) => {
  const r = rng(17);
  g.fillStyle = '#d9d5cb'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 26; i++) { const x = r() * w, y = r() * h, s = 18 + r() * 46, q = g.createRadialGradient(x, y, 0, x, y, s), k = r() < 0.6 ? '140,128,106' : '244,240,230'; q.addColorStop(0, `rgba(${k},.09)`); q.addColorStop(0.8, `rgba(${k},.05)`); q.addColorStop(1, `rgba(${k},0)`); g.fillStyle = q; for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) { g.setTransform(1, 0, 0, 1, dx, dy); g.fillRect(x - s, y - s, s * 2, s * 2); } g.setTransform(1, 0, 0, 1, 0, 0); }
  for (let y = 0; y < h; y += 2) { g.fillStyle = `rgba(70,60,44,${0.05 + r() * 0.06})`; g.fillRect(0, y, w, 1); }
  for (let x = 0; x < w; x += 2) { g.fillStyle = `rgba(255,252,244,${0.03 + r() * 0.05})`; g.fillRect(x, 0, 1, h); }
  g.fillStyle = 'rgba(90,80,62,.38)'; g.fillRect(0, 0, 3, h); g.fillStyle = 'rgba(250,246,236,.4)'; g.fillRect(4, 0, 3, h);
  g.fillStyle = 'rgba(70,60,46,.6)'; for (let y = 2; y < h; y += 8) g.fillRect(9, y, 1.5, 4);
}));
// A fishing net, 0.5 × 0.5 m: a mesh of knotted twine on nothing
const netTex = () => (NET ||= canvas(128, 128, (g, w, h) => {
  const r = rng(5), n = 8, s = w / n;
  g.clearRect(0, 0, w, h); g.lineWidth = 2.6; g.lineCap = 'round';
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const k = 150 + r() * 70, x = i * s, y = j * s;
    g.strokeStyle = `rgb(${k},${k * 0.95},${k * 0.86})`;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + s * 0.5, y + s * 0.16, x + s, y + s); g.stroke();
    g.beginPath(); g.moveTo(x + s, y); g.quadraticCurveTo(x + s * 0.5, y + s * 0.16, x, y + s); g.stroke();
    g.fillStyle = g.strokeStyle; g.beginPath(); g.arc(x, y, 2.4, 0, TAU); g.fill();
  }
}));
// Ivy on a wall, as much as the wall of it (u along, v from the ground up): thick in the middle and low down, loose at its
// edges, where the tips climb
const ivyTex = () => (IVY ||= canvas(512, 512, (g, w, h) => {
  const r = rng(29), leaf = (x, y, s, a, k) => {
    g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = `rgb(${k * 0.96},${k},${k * 0.88})`;
    g.beginPath(); g.moveTo(0, s); g.bezierCurveTo(-s * 0.5, s * 0.75, -s * 1.15, s * 0.5, -s * 0.8, 0); g.quadraticCurveTo(-s * 0.75, -s * 0.5, -s * 0.25, -s * 0.4); g.lineTo(0, -s * 0.95); g.lineTo(s * 0.25, -s * 0.4); g.quadraticCurveTo(s * 0.75, -s * 0.5, s * 0.8, 0); g.bezierCurveTo(s * 1.15, s * 0.5, s * 0.5, s * 0.75, 0, s); g.fill();
    g.strokeStyle = 'rgba(255,255,235,.18)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(0, s * 0.8); g.lineTo(0, -s * 0.7); g.stroke();
    g.restore();
  };
  g.clearRect(0, 0, w, h);
  // (the stems, from the ground)
  const tips = [];
  for (let i = 0; i < 17; i++) {
    let x = w * (0.2 + 0.6 * r()), y = h, dir = -Math.PI / 2 + (x / w - 0.5) * 0.9; const len = h * (0.45 + 0.5 * r()) * (1 - Math.abs(x / w - 0.5) * 0.5);
    g.strokeStyle = '#5b5348'; g.lineWidth = 2.4; g.beginPath(); g.moveTo(x, y);
    for (let d = 0; d < len; d += 9) { dir += (r() - 0.5) * 0.42; x += Math.cos(dir) * 9; y += Math.sin(dir) * 9; g.lineTo(x, y); tips.push([x, y, d / len]); }
    g.stroke();
  }
  const L = [];
  for (const [x, y, t] of tips) for (let k = 0; k < (t < 0.7 ? 7 : 4); k++) { const a = r() * TAU, d = r() * 30 * (1.05 - t * 0.6); L.push([x + Math.cos(a) * d, y + Math.sin(a) * d, 5.5 + r() * 5, r() * TAU, 84 + r() * 74]); }
  L.sort((a, b) => a[4] - b[4]);
  for (const [x, y, s, a, k] of L) if (x > s && x < w - s && y > s) leaf(x, y, s, (a - Math.PI) * 0.4, k);
}));
// Dressed stone, 2.4 × 2.4 m: six courses of blocks, each with its drafted margin, its tooling and its tone, thin joints, the
// rain's streaks. Grey on white: the colour is the vertex's (tints.js, ashlarW…)
export const sillaresTex = () => (SILLARES ||= canvas(768, 768, (g, w, h) => {
  const r = rng(61), rows = 6, ch = h / rows;
  g.fillStyle = '#8f8a80'; g.fillRect(0, 0, w, h);
  for (let j = 0; j < rows; j++) {
    // (the blocks of a course, and of the next one, never joint over joint; the last one closes with the first)
    const cuts = []; let x = (j % 2) * ch * 0.8 + r() * 10; const x0 = x;
    while (x < x0 + w - ch * 0.9) { cuts.push(x); x += ch * (1.25 + r() * 0.75); }
    cuts.push(x0 + w);
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i], b = cuts[i + 1], k = 196 + r() * 40, warm = r() * 9, y = j * ch;
      for (const off of [0, -w]) {
        const X = a + off + 1.6, W = b - a - 3.2, Y = y + 1.6, H = ch - 3.2;
        if (X > w || X + W < 0) continue;
        g.save(); g.beginPath(); g.rect(X, Y, W, H); g.clip();
        g.fillStyle = `rgb(${k + warm},${k + warm * 0.4},${k - warm})`; g.fillRect(X, Y, W, H);
        // (the tooling of its face: short strokes of the point, slanting; and the pits)
        const q = rng(j * 31 + i * 7 + 3);
        for (let n = 0; n < W * H / 70; n++) { const px = X + q() * W, py = Y + q() * H, d = q() < 0.55 ? -1 : 1; g.strokeStyle = d < 0 ? `rgba(84,78,66,${0.05 + q() * 0.14})` : `rgba(255,252,244,${0.05 + q() * 0.14})`; g.lineWidth = 0.8 + q(); g.beginPath(); g.moveTo(px, py); g.lineTo(px + 3 + q() * 5, py - 4 - q() * 5); g.stroke(); }
        for (let n = 0; n < 4; n++) { const px = X + q() * W, py = Y + q() * H, s = 12 + q() * 34, G = g.createRadialGradient(px, py, 0, px, py, s), c = q() < 0.5 ? '96,88,72' : '250,246,236'; G.addColorStop(0, `rgba(${c},.2)`); G.addColorStop(1, `rgba(${c},0)`); g.fillStyle = G; g.fillRect(px - s, py - s, s * 2, s * 2); }
        // (the drafted margin: smoother and lighter, a light edge above and to the left, a dark one below)
        g.fillStyle = 'rgba(255,253,246,.17)'; g.fillRect(X, Y, W, 9); g.fillRect(X, Y, 9, H); g.fillRect(X + W - 9, Y, 9, H); g.fillRect(X, Y + H - 9, W, 9);
        g.fillStyle = 'rgba(255,253,246,.35)'; g.fillRect(X, Y, W, 2); g.fillRect(X, Y, 2, H); g.fillStyle = 'rgba(48,42,34,.3)'; g.fillRect(X, Y + H - 2.4, W, 2.4); g.fillRect(X + W - 2, Y, 2, H);
        // (a chipped corner)
        if (q() < 0.4) { g.fillStyle = 'rgba(70,64,54,.5)'; g.beginPath(); const cx = q() < 0.5 ? X : X + W, cy = q() < 0.5 ? Y : Y + H, s = 5 + q() * 9; g.moveTo(cx, cy - s); g.lineTo(cx + s * (cx > X ? -1 : 1), cy); g.lineTo(cx, cy + s); g.fill(); }
        g.restore();
      }
    }
  }
  for (let i = 0; i < 26; i++) { const x = r() * w, y = r() * h, l = 40 + r() * 170, G = g.createLinearGradient(0, y, 0, y + l); G.addColorStop(0, 'rgba(60,56,48,.16)'); G.addColorStop(1, 'rgba(60,56,48,0)'); g.fillStyle = G; g.fillRect(x, y, 2 + r() * 9, l); }
}));
const ASH_M = 1;   // (its coordinates are metres: the texture's repeat says how many it has)
const sillares = () => { const t = sillaresTex(); t.repeat.set(1 / 2.4, 1 / 2.4); return t; };

// ---------- materials ----------
const cloth = c => () => mat({ map: clothTex(), color: c, side: THREE.DoubleSide, shadowSide: THREE.DoubleSide, roughness: 1 });
export const PLACE_MATS = {
  canvasRaw: cloth('#b9ad92'), canvasGreen: cloth('#7f8468'), canvasGrey: cloth('#a3a098'), canvasRust: cloth('#a27a5c'),
  bankTurf: () => mat({ map: rockFace(apagado('#6b6c4c')), roughness: 1 }), snowBank: () => mat({ color: '#dfe4e6', roughness: 0.9 }),
  rockFaceD: () => mat({ map: rockFace(apagado('#4b463f')), roughness: 1 }),
  spoil: () => mat({ map: rockFace(apagado('#7d766c')), roughness: 1 }),
  net: () => mat({ map: netTex(), color: '#9a8f7c', alphaTest: 0.42, side: THREE.DoubleSide, roughness: 1 }),
  ivy: () => mat({ map: ivyTex(), color: '#a3b673', alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.95 }),
  ivyDry: () => mat({ map: ivyTex(), color: '#b09c78', alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1 }),
  ashlarT: () => mat({ map: sillares(), vertexColors: true, roughness: 0.9 }), ashlarG: () => mat({ map: sillares(), color: '#c8bfac', roughness: 0.9 }),
  limewash: () => mat({ map: plaster(), color: '#f1eee6', roughness: 0.95 }),
  hayStack: () => weathered(mat({ map: thatch(), color: '#c9bea8', roughness: 1 }), 0.16),
  turf: () => mat({ map: rockFace(apagado('#5e5644')), vertexColors: true, roughness: 1 }),
  boatHull: () => mat({ vertexColors: true, roughness: 0.85 }),
  stillWater: () => mat({ color: '#3f5c60', roughness: 0.06, metalness: 0.15, transparent: true, opacity: 0.82 }),
  fallWater: () => mat({ color: '#b9ced2', roughness: 0.1, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }),
  salt: () => mat({ map: rockFace(), color: '#e9e6df', roughness: 0.6 }),
};
// Straw gone grey with the sun and the rain (the thatch of the roofs, the ricks)
export function weathered(m, k = 0.27) { m.color.multiplyScalar(0.86).lerp(new THREE.Color().setRGB(0.42, 0.45, 0.5), k); return m; }
const MADE = new Map();
export const placeMat = key => MADE.get(key) || (PLACE_MATS[key] ? (MADE.set(key, PLACE_MATS[key]()), (MADE.get(key).userData.placeKey = key), MADE.get(key)) : null);

// ---------- the tent and the campfire ----------
// A canvas tent of two poles at each end, its mouth to +z. cloth: raw (undyed), green, grey or rust; state: open (its flaps
// tied back) or shut
function tent(m, dye = 'raw', state = 'open', snow) {
  const key = { raw: 'canvasRaw', green: 'canvasGreen', grey: 'canvasGrey', rust: 'canvasRust' }[dye] || 'canvasRaw', B = m.B(key);
  const W = 0.96, H = 1.52, Z = 0.95, E = 0.2, ridge = z => H - 0.05 * (1 - (z / Z) ** 2);
  // The poles, crossed over the ridge, and the ridge pole
  for (const z of [-Z - 0.04, Z + 0.04]) for (const s of [-1, 1]) rod(m, 'oldWood', [s * (W + 0.04), 0, z], [-s * 0.1, H + 0.2, z + s * 0.025], 0.03, 0.024, 7);
  rod(m, 'oldWood', [0, H - 0.005, -Z - 0.16], [0, H - 0.005, Z + 0.2], 0.026, 0.024, 7);
  for (const z of [-Z - 0.04, Z + 0.04]) m.geo('rope', new THREE.TorusGeometry(0.045, 0.012, 4, 8), 0, H + 0.02, z, [0.3, 0, 0]);
  // The two slopes, sagging between the ridge and the eave, with their short wall to the ground
  const side = s => (u, v) => {
    const z = lerp(-Z, Z, u), k = Math.min(1, v / 0.82), hang = 0.05 * Math.sin(Math.PI * u) * Math.sin(Math.PI * k) + 0.012 * Math.sin(u * 19 + s) * Math.sin(Math.PI * k);
    if (v > 0.82) { const q = (v - 0.82) / 0.18, fl = 0.02 * Math.sin(u * 23 + s * 2); return [s * (W + 0.02 * q + fl * q), lerp(E, 0, q), z]; }
    return [s * (lerp(0, W, k) - hang * 0.9), lerp(ridge(z), E, k) - hang * 0.75, z];
  };
  for (const s of [-1, 1]) sheet(B, side(s), 8, 7, { uv: (u, v) => [u * 2, v * 1.9 + s * 0.1], flip: s > 0 });
  // The back, closed
  sheet(B, (u, v) => { const h = lerp(H, 0, v), w = v < 0.86 ? W * (v / 0.86) : W; return [lerp(-w, w, u), h, -Z + 0.04 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v)]; }, 6, 5, { uv: (u, v) => [u * 1.9, v * 1.5], flip: true });
  // The mouth: its two flaps, shut with their ties, or thrown back against the poles
  for (const s of [-1, 1]) {
    if (state === 'shut') {
      sheet(B, (u, v) => { const h = lerp(H - 0.02, 0.02, v), w = (v < 0.86 ? W * (v / 0.86) : W), x = lerp(-0.05, w, u) * s; return [x, h, Z + 0.015 + (s > 0 ? 0.015 : 0) + 0.04 * Math.sin(u * 5) * v]; }, 4, 5, { uv: (u, v) => [u * 0.95, v * 1.5], flip: s < 0 });
    } else {
      sheet(B, (u, v) => {
        const h = lerp(H - 0.04, 0.05, v), w = v < 0.86 ? W * (v / 0.86) : W, tie = Math.max(0, 1 - ((v - 0.62) / 0.4) ** 2), wide = lerp(0.1, 0.36, v) * (1 - 0.7 * tie);
        const a = u * Math.PI * 1.15;
        return [s * (w - 0.03 - Math.sin(a * 0.75) * wide * 0.75), h, Z + 0.03 + Math.sin(a) * (0.06 + 0.1 * wide)];
      }, 5, 6, { uv: (u, v) => [u * 0.7, v * 1.5], flip: s < 0 });
      m.geo('rope', new THREE.TorusGeometry(0.06, 0.009, 4, 8), s * (W * 0.72 - 0.04), H * 0.39, Z + 0.06, [1.2, 0, s * 0.5]);
    }
  }
  if (state === 'shut') for (const y of [0.3, 0.62, 0.94]) m.box('rope', -0.07, y - 0.008, Z + 0.045, 0.07, y + 0.008, Z + 0.062);
  else {
    // Inside: the ground sheet, the bedding and a rolled blanket
    m.box('cloth', -0.82, 0.005, -0.9, 0.82, 0.02, 0.86).box('quilt', -0.62, 0.02, -0.8, 0.06, 0.1, 0.72).box('pillowK', -0.52, 0.09, -0.76, -0.06, 0.19, -0.5);
    rod(m, 'canvasGrey', [0.3, 0.12, -0.6], [0.3, 0.12, 0.1], 0.11, 0.11, 10);
  }
  // The guy ropes and their pegs
  for (const s of [-1, 1]) for (const z of [-0.62, 0.62]) { rod(m, 'rope', [s * W, E, z], [s * (W + 0.5), 0.02, z * 1.1], 0.007, 0.007, 4, false); rod(m, 'oldWood', [s * (W + 0.53), -0.05, z * 1.1], [s * (W + 0.47), 0.1, z * 1.1], 0.016, 0.012, 5, false); }
  for (const z of [-1, 1]) { rod(m, 'rope', [0, H - 0.02, z * (Z + 0.16)], [0, 0.02, z * (Z + 0.95)], 0.007, 0.007, 4, false); rod(m, 'oldWood', [0, -0.05, z * (Z + 0.98)], [0, 0.1, z * (Z + 0.92)], 0.016, 0.012, 5, false); }
  if (snow) for (const s of [-1, 1]) sheet(m.B('snow'), (u, v) => { const p = side(s)(0.02 + u * 0.96, v * 0.7); return [p[0] + s * 0.014, p[1] + 0.03 + 0.02 * Math.sin(u * 13), p[2]]; }, 8, 4, { flip: s < 0 });
  m.solids = [[-W, 0, -Z, W, 0.6, Z], [-W * 0.6, 0.6, -Z, W * 0.6, 1.1, Z], [-0.2, 1.1, -Z, 0.2, H + 0.1, Z]];
}
// A fire in a ring of stones: lit, cold (ash and charred ends) or laid (the wood ready). pot: over it, a kettle on a tripod
function campfire(m, state = 'lit', pot) {
  const R = rng(11);
  for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU + R() * 0.2, s = 0.085 + R() * 0.045, d = 0.39 + R() * 0.03; pebble(m, 'crag', Math.cos(a) * d, s * 0.55, Math.sin(a) * d, s * 1.2, s * 0.9, s, i, [R(), R() * 6, 0]); }
  // The bed: earth burnt black, and the ash heaped in the middle
  sheet(m.B('char'), (u, v) => { const a = u * TAU, r = v * 0.36 * (1 + 0.08 * Math.sin(a * 5)); return [Math.cos(a) * r, 0.012 + 0.012 * (1 - v), Math.sin(a) * r]; }, 12, 2);
  sheet(m.B('ash'), (u, v) => { const a = u * TAU, r = v * 0.25 * (1 + 0.13 * Math.sin(a * 3 + 1)); return [Math.cos(a) * r, 0.02 + 0.05 * (1 - v * v), Math.sin(a) * r]; }, 12, 3);
  const n = state === 'cold' ? 4 : 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + 0.3 + R() * 0.3, up = state === 'cold' ? 0.06 + R() * 0.05 : 0.3 + R() * 0.06, o = 0.27 + R() * 0.04, key = state === 'laid' ? 'logBark' : 'char';
    rod(m, key, [Math.cos(a) * o, 0.035, Math.sin(a) * o], [-Math.cos(a) * 0.03, up, -Math.sin(a) * 0.03], 0.04, 0.034, 7);
    if (state !== 'laid') rod(m, 'logBark', [Math.cos(a) * (o + 0.13), 0.02, Math.sin(a) * (o + 0.13)], [Math.cos(a) * o, 0.038, Math.sin(a) * o], 0.043, 0.041, 7);
  }
  if (state === 'lit') {
    for (let i = 0; i < 7; i++) { const a = i * 2.4, d = 0.05 + (i % 3) * 0.055; pebble(m, 'ember', Math.cos(a) * d, 0.06, Math.sin(a) * d, 0.04, 0.025, 0.04, i); }
    m.fire(0, 0.1, 0, 0.95).light(0, 0.6, 0, { color: '#ff9a40', intensity: 4, range: 10, flicker: true, pool: 3 });
    m.smoke.push([0, 1.3, 0]);
  }
  if (pot) {
    for (let i = 0; i < 3; i++) { const a = i * TAU / 3 + 0.5; rod(m, 'iron', [Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55], [-Math.cos(a) * 0.03, 1.22, -Math.sin(a) * 0.03], 0.014, 0.012, 6); }
    rod(m, 'iron', [0, 0.62, 0], [0, 1.18, 0], 0.005, 0.005, 4, false);
    const P = [[0, 0], [0.12, 0.01], [0.18, 0.07], [0.195, 0.15], [0.175, 0.22], [0.16, 0.24], [0.18, 0.265], [0.165, 0.265], [0.15, 0.24], [0.15, 0.2]].map(p => new THREE.Vector2(...p));
    m.geo('iron', new THREE.LatheGeometry(P, 14), 0, 0.36, 0).geo('iron', new THREE.TorusGeometry(0.165, 0.008, 4, 12, Math.PI), 0, 0.6, 0).cyl('pot', 0, 0.565, 0, 0.15, 0.15, 0.005, 12);
  }
}

// ---------- the boat ----------
// The hull of the rowing boat (as long and as wide as the moored one: actors.js boatModel), clinker-built: five strakes to a
// side with their laps, the frames, the thwarts, the gunwale, the keel, the stem and the transom. Into m, moved by M4.
// hole(strake, j): planks that are gone. old: how weathered
const HN = 11, STRAKES = 5;
const hullAt = {
  z: t => lerp(-0.98, 1.16, t),
  b: t => (t < 0.45 ? lerp(0.45, 0.6, Math.sin((t / 0.45) * Math.PI / 2)) : 0.6 * Math.max(0, 1 - ((t - 0.45) / 0.55) ** 2.3) ** 0.72 + 0.012),
  keel: t => 0.05 + 0.34 * Math.max(0, (t - 0.74) / 0.26) ** 2.2 + 0.05 * Math.max(0, (0.2 - t) / 0.2),
  top: t => 0.47 + 0.05 * (1 - t) + 0.17 * t ** 3,
};
function hullP(t, s, out = 0) {
  const a = s * Math.PI / 2, b = hullAt.b(t), k = hullAt.keel(t), h = hullAt.top(t) - k;
  const x = b * Math.sin(a) ** 0.78, y = k + h * (1 - Math.cos(a) ** 1.25);
  return [x + out * (0.35 + 0.65 * s), y - out * (1 - s) * 0.8, hullAt.z(t)];
}
const hullN = (t, s, sg) => { const e = 0.02, p = hullP(t - e, s), q = hullP(t + e, s), a = hullP(t, Math.max(0.02, s - 0.05)), b = hullP(t, Math.min(1, s + 0.05)), u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], v = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n) || 1, f = n[0] < 0 || (Math.abs(n[0]) < 1e-3 && n[1] > 0) ? -1 : 1; return [n[0] / l * f * sg, n[1] / l * f, n[2] / l * f]; };
function boat(m, M4, o) { addB(m, 'boatHull', hull(o), M4); }
function hull({ hole = () => false, paint = '#6f6a5e', inside = '#7b6f5e', rim = '#57504a', bench = true, seed = 3 } = {}) {
  const O = new Builder(), R = rng(seed), C = (hex, k) => { O.tint('#' + new THREE.Color(hex).multiplyScalar(k).getHexString()); };
  const lap = 0.016;
  for (const sg of [-1, 1]) for (let i = 0; i < STRAKES; i++) {
    const s0 = i / STRAKES, s1 = (i + 1) / STRAKES, tone = 0.9 + R() * 0.18;
    for (let j = 0; j < HN; j++) {
      if (hole(i, j, sg)) continue;
      const t0 = j / HN, t1 = (j + 1) / HN, F = (t, s, o) => { const p = hullP(t, s, o); return [p[0] * sg, p[1], p[2]]; };
      const a = F(t0, s0, lap), b = F(t1, s0, lap), c = F(t1, s1, 0), d = F(t0, s1, 0), sm = (s0 + s1) / 2, uv = [[t0, s0], [t1, s0], [t1, s1], [t0, s1]];
      const n0 = hullN(t0, sm, sg), n1 = hullN(t1, sm, sg), face = (ps, ns, k) => { const at = O.pos.length; O.quadN(...ps, [(n0[0] + n1[0]) * k, (n0[1] + n1[1]) * k, (n0[2] + n1[2]) * k], uv); for (let q = 0; q < 4; q++) { const z = O.pos[at + q * 3 + 2], w = (z - hullAt.z(t0)) / (hullAt.z(t1) - hullAt.z(t0)) > 0.5 ? n1 : n0; for (let e = 0; e < 3; e++) O.nor[at + q * 3 + e] = w[e] * k; } };
      C(paint, tone * (0.94 + R() * 0.1)); face([a, b, c, d], null, 1);
      // (the lap: the lower edge of the strake, over the one below)
      C(paint, 0.5); O.quadN(F(t0, s0, -0.004), F(t1, s0, -0.004), b, a, [n0[0] * 0.3, -0.9, n0[2] * 0.3], uv);
      C(inside, tone * (0.85 + R() * 0.12)); face([F(t0, s0, -0.012), F(t1, s0, -0.012), F(t1, s1, -0.02), F(t0, s1, -0.02)], null, -1);
    }
  }
  // Frames, inside
  for (const t of [0.14, 0.32, 0.5, 0.67, 0.81]) for (const sg of [-1, 1]) for (let k = 0; k < 5; k++) {
    const P = (s, o, dz) => { const p = hullP(t, s, o); return [p[0] * sg, p[1], p[2] + dz]; }, s0 = k / 5, s1 = (k + 1) / 5, w = 0.022;
    C(inside, 0.78);
    O.quadN(P(s0, -0.05, -w), P(s0, -0.05, w), P(s1, -0.05, w), P(s1, -0.05, -w), [-sg * 0.8, 0.6, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    for (const q of [-1, 1]) O.quadN(P(s0, -0.015, q * w), P(s0, -0.05, q * w), P(s1, -0.05, q * w), P(s1, -0.015, q * w), [0, 0, q], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  // Gunwale, transom, keel and stem
  for (const sg of [-1, 1]) for (let j = 0; j < HN; j++) {
    const P = (t, dx, dy) => { const p = hullP(t, 1, 0); return [(p[0] + dx) * sg, p[1] + dy, p[2]]; }, t0 = j / HN, t1 = (j + 1) / HN;
    C(rim, 0.95 + R() * 0.1);
    for (const [x0, y0, x1, y1, n] of [[-0.045, 0.02, 0.03, 0.02, [0, 1, 0]], [0.03, -0.03, 0.03, 0.02, [sg, 0, 0]], [-0.045, -0.03, -0.045, 0.02, [-sg, 0, 0]]]) O.quadN(P(t0, x0, y0), P(t1, x0, y0), P(t1, x1, y1), P(t0, x1, y1), n, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  const T = [], n = 8; for (let k = -n; k <= n; k++) { const p = hullP(0, Math.abs(k) / n, 0); T.push([p[0] * Math.sign(k), p[1], p[2]]); }
  const mid = [0, hullAt.top(0) - 0.02, hullAt.z(0)];
  for (let k = 0; k < T.length - 1; k++) { C(paint, 0.9); O.quadN(mid, T[k], T[k + 1], mid, [0, 0, -1], [[0, 0], [1, 0], [1, 1], [0, 1]]); C(inside, 0.8); const z = p => [p[0], p[1], p[2] + 0.025]; O.quadN(z(mid), z(T[k + 1]), z(T[k]), z(mid), [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]]); }
  C(rim, 0.95);
  for (let j = 0; j < 8; j++) { const t0 = j / 8, t1 = (j + 1) / 8, w = 0.028, y0 = hullAt.keel(t0), y1 = hullAt.keel(t1), z0 = hullAt.z(t0), z1 = hullAt.z(t1), d = 0.06;
    O.quadN([-w, y0 - d, z0], [w, y0 - d, z0], [w, y1 - d, z1], [-w, y1 - d, z1], [0, -1, 0.1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    for (const sg of [-1, 1]) O.quadN([sg * w, y0 - d, z0], [sg * w, y0 + 0.02, z0], [sg * w, y1 + 0.02, z1], [sg * w, y1 - d, z1], [sg, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]); }
  O.box(-0.03, hullAt.keel(1) - 0.07, 1.13, 0.03, hullAt.top(1) + 0.08, 1.19);
  if (bench) { C(inside, 1.05); for (const [z, w] of [[-0.1, 0.5], [-0.72, 0.42], [0.62, 0.38]]) O.box(-w, 0.36, z - 0.1, w, 0.395, z + 0.1); }
  return O;
}
// The rowing boat of the game (actors.js boatModel): that hull, a little deeper, as long and as wide as ever, with its bottom
// boards over the water line, its benches where one sits (z -0.1 and -0.75, at 0.475), the little deck at the bow a bundle goes on
// (0.335: carry3d.js), the tholes and the two oars. { hull, oar }: their geometries; the oar, from its thole down -y
const ROW = { k: 1.2, y: -0.13 };
let ROWB = null;
export function rowBoatGeo() {
  if (!ROWB) {
    const O = new Builder(), H = hull({ paint: '#75624a', inside: '#86735a', rim: '#57462f', bench: false, seed: 5 }), C = (c, k = 1) => O.tint('#' + new THREE.Color(c).multiplyScalar(k).getHexString());
    for (let i = 1; i < H.pos.length; i += 3) H.pos[i] = H.pos[i] * ROW.k + ROW.y;
    O.add(H);
    // (how wide the boat is inside at height y, at t: where its planks go past it)
    const wide = (t, y) => { let s = 1; for (let q = 0; q <= 20; q++) { const p = hullP(t, q / 20); if (p[1] * ROW.k + ROW.y >= y) { s = q / 20; break; } } return Math.max(0.02, hullP(t, s, -0.02)[0]); };
    const deck = (t0, t1, y, n, c, boards) => { for (let j = 0; j < n; j++) { const a = lerp(t0, t1, j / n), b = lerp(t0, t1, (j + 1) / n), wa = wide(a, y), wb = wide(b, y); for (let k = 0; k < boards; k++) { const u0 = -1 + (2 * k) / boards + 0.012, u1 = -1 + (2 * (k + 1)) / boards - 0.012; C(c, 0.92 + ((k * 7 + 3) % 5) * 0.035); O.quadN([u0 * wa, y, hullAt.z(a)], [u1 * wa, y, hullAt.z(a)], [u1 * wb, y, hullAt.z(b)], [u0 * wb, y, hullAt.z(b)], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]); } C(c, 0.5); O.quadN([-wa, y - 0.012, hullAt.z(a)], [wa, y - 0.012, hullAt.z(a)], [wb, y - 0.012, hullAt.z(b)], [-wb, y - 0.012, hullAt.z(b)], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]); } };
    deck(0.015, 0.8, 0.2, 9, '#7d6b50', 6);
    deck(0.76, 0.975, 0.335, 4, '#86735a', 4);
    { const z = hullAt.z(0.76), w = wide(0.76, 0.28); C('#6a573f'); O.quadN([-w, 0.2, z], [w, 0.2, z], [w, 0.335, z], [-w, 0.335, z], [0, 0, -1], [[0, 0], [1, 0], [1, 1], [0, 1]]); }
    C('#7a6548'); for (const [z, w] of [[-0.1, 0.545], [-0.75, 0.455]]) { O.box(-w, 0.425, z - 0.11, w, 0.475, z + 0.11); C('#5f4d36'); for (const s of [-1, 1]) O.box(s * w * 0.72 - 0.02, 0.2, z - 0.03, s * w * 0.72 + 0.02, 0.425, z + 0.03); C('#7a6548'); }
    C('#4d3f2c'); for (const s of [-1, 1]) for (const d of [-0.045, 0.045]) O.box(s * 0.575 - 0.012, 0.46, d - 0.012, s * 0.575 + 0.012, 0.565, d + 0.012);
    C(null); O.tint(null);
    const R = new Builder(); R.tint('#8a7555'); R.addGeometry(new THREE.CylinderGeometry(0.023, 0.021, 1.75, 7), new THREE.Matrix4().makeTranslation(0, -0.6, 0)); R.tint('#7c6849'); R.box(-0.012, -1.68, -0.07, 0.012, -1.24, 0.07); R.tint('#4d3f2c'); R.addGeometry(new THREE.CylinderGeometry(0.032, 0.032, 0.12, 7), new THREE.Matrix4().makeTranslation(0, -0.06, 0));
    ROWB = { hull: O, oar: R };
  }
  return { hull: ROWB.hull.geometry(), oar: ROWB.oar.geometry() };
}
const BAD_PLANKS = seed => { const R = rng(seed), set = new Set(); for (let k = 0; k < 4; k++) { const i = 1 + Math.floor(R() * 4), j = 2 + Math.floor(R() * 7), sg = R() < 0.5 ? -1 : 1; for (let q = 0; q < 2 + R() * 2; q++) set.add(`${i}:${j + q}:${sg}`); } return (i, j, sg) => set.has(`${i}:${j}:${sg}`); };
const PAINTS = ['#59666a', '#6f6a5e', '#6d5348', '#4f5e54'];
// A mound of sand heaped by the tide and the wind: a ring of heights that goes to nothing
function sandMound(m, x, z, rx, rz, h, seed = 1, key = 'dune') {
  sheet(m.B(key), (u, v) => { const a = u * TAU, k = 1 + 0.16 * Math.sin(a * 2 + seed) + 0.08 * Math.sin(a * 5 - seed); return [x + Math.cos(a) * rx * v * k, h * (1 - v * v) ** 1.6 * (1 + 0.25 * Math.sin(a * 3 + seed * 2) * v) - 0.03 * v, z + Math.sin(a) * rz * v * k]; }, 22, 6, { uv: (u, v) => [Math.cos(u * TAU) * rx * v * 0.6, Math.sin(u * TAU) * rz * v * 0.6] });
}
function oar(m, a, b, key = 'oldWood') {
  rod(m, key, a, b, 0.022, 0.02, 6, false);
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
  beam(m, key, b, [b[0] + d.x * 0.42, b[1] + d.y * 0.42, b[2] + d.z * 0.42], 0.13, 0.022, [0, 1, 0.01], 0, false);
}
// A net thrown over something: a sheet that follows f, with its floats along one edge
function netOver(m, f, nu, nv, w, h, floats = 0) {
  sheet(m.B('net'), f, nu, nv, { uv: (u, v) => [u * w * 2, v * h * 2] });
  for (let i = 0; i < floats; i++) { const p = f((i + 0.5) / floats, 0.985); m.ball('light', p[0], p[1] + 0.02, p[2], 0.045, 0.035, 0.045, 6); }
}
// A boat out of the water. pose: up (hauled up on its keel, its oars in it), trestle (keel up on two trestles, being tarred),
// side (on its side, the sand against it), keel (keel up on the beach), buried (its stern in the sand)
function beached(m, pose = 'up', seed = '1', snow) {
  const s = +seed || 1, paint = PAINTS[s % PAINTS.length], E = new THREE.Euler(), M = (p, r) => new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(E.set(...r, 'YXZ')), _one);
  if (pose === 'up') {
    boat(m, M([0, 0.05, 0], [0, 0, 0.17]), { paint, seed: s });
    oar(m, [0.24, 0.5, -0.95], [0.06, 0.56, 0.62]); oar(m, [-0.12, 0.45, -0.9], [0.16, 0.6, 0.7]);
    rod(m, 'rope', [0, 0.72, 1.14], [0.35, 0.04, 1.9], 0.011, 0.011, 5, false); rod(m, 'oldWood', [0.36, -0.05, 1.93], [0.32, 0.28, 1.86], 0.035, 0.03, 6);
    rod(m, 'oldWood', [-0.62, 0, -0.35], [-0.36, 0.24, -0.35], 0.04, 0.035, 6);   // (a prop under its bilge)
    m.geo('rope', new THREE.TorusGeometry(0.13, 0.02, 5, 12), 0.05, 0.43, 0.62, [Math.PI / 2, 0, 0]).geo('rope', new THREE.TorusGeometry(0.1, 0.02, 5, 12), 0.05, 0.46, 0.62, [Math.PI / 2, 0, 0.4]);
  } else if (pose === 'trestle') {
    boat(m, M([0, 1.14, 0], [0, 0, Math.PI]), { paint: '#37322e', inside: '#7b6f5e', seed: s });
    for (const z of [-0.5, 0.5]) { beam(m, 'oldWood', [-0.62, 0.64, z], [0.62, 0.64, z], 0.09, 0.09); for (const sx of [-1, 1]) for (const q of [-1, 1]) rod(m, 'oldWood', [sx * 0.6, 0, z + q * 0.2], [sx * 0.46, 0.62, z + q * 0.03], 0.034, 0.03, 6); }
    m.cyl('iron', 0.82, 0, 0.35, 0.13, 0.15, 0.24, 10).cyl('soot', 0.82, 0.2, 0.35, 0.135, 0.135, 0.02, 10); rod(m, 'oldWood', [0.82, 0.2, 0.35], [1.0, 0.52, 0.42], 0.013, 0.013, 5, false);   // (the tar, with its brush)
  } else if (pose === 'side') {
    boat(m, M([0.05, 0.4, 0], [0.03, 0, -1.28]), { paint, hole: BAD_PLANKS(s * 7), inside: '#80776a', bench: s % 2 === 1, seed: s });
    sandMound(m, -0.05, -0.1, 1.0, 1.6, 0.44, s); sandMound(m, 0.75, 0.4, 0.75, 1.0, 0.16, s + 2);
    netOver(m, (u, v) => { const x = lerp(0.55, 1.85, v), z = lerp(-0.85, 0.75, u) + 0.14 * Math.sin(v * 5); return [x + 0.08 * Math.sin(u * 9), 0.06 + 0.07 * Math.max(0, Math.sin(u * 7 + v * 4) * Math.sin(v * 8 + u * 3)) + Math.max(0, 0.34 - v * 1.3), z]; }, 14, 12, 1.5, 1.4, 6);
  } else if (pose === 'keel') {
    boat(m, M([0, 0.5, 0], [0.06, 0, Math.PI + 0.12]), { paint, hole: BAD_PLANKS(s * 5 + 1), bench: false, seed: s });
    sandMound(m, 0.35, -0.2, 0.95, 1.5, 0.3, s); sandMound(m, -0.35, 0.5, 0.8, 1.0, 0.17, s + 3);
    oar(m, [0.95, 0.03, -0.7], [1.15, 0.05, 0.7]);
  } else {
    boat(m, M([0, 0.02, 0.1], [-0.3, 0, 0.36]), { paint, hole: BAD_PLANKS(s * 3 + 2), inside: '#80776a', bench: s % 2 === 0, seed: s });
    sandMound(m, 0, -0.75, 1.15, 0.95, 0.5, s); sandMound(m, -0.45, 0.35, 0.8, 0.9, 0.24, s + 1);
    sheet(m.B('dune'), (u, v) => [lerp(-0.42, 0.42, u), 0.36 - 0.12 * v + 0.07 * Math.sin(u * Math.PI), lerp(-0.8, 0.25, v)], 6, 6, { flip: true });
    netOver(m, (u, v) => { const z = lerp(-0.3, 0.7, u), x = lerp(-0.1, -1.35, v); return [x, v < 0.42 ? 0.6 + 0.16 * Math.sin(v * 7) : Math.max(0.16 * (1 - v) + 0.05, 0.66 * (1 - (v - 0.42) / 0.25)), z + 0.1 * Math.sin(v * 6)]; }, 8, 10, 1, 1.5, 4);
  }
  if (snow) sandMound(m, 0.1, 0, 1.5, 1.7, 0.16, s + 5, 'snow');
  if (!m.solids.length || pose !== 'up') m.solids = [[-0.6, 0, -1, 0.6, 0.75, 1.1]];
}

// ---------- what a hamlet works with ----------
const FISH_C = ['fruit:#a5acae', 'fruit:#8f9a94', 'fruit:#b0a698'];
function fish(m, x, y, z, L, i, yaw = 0) {   // (hung by its tail)
  const k = FISH_C[i % 3];
  m.ball(k, x, y - L * 0.5, z, L * 0.11, L * 0.42, L * 0.2, 6);
  m.geo(k, new THREE.ConeGeometry(L * 0.15, L * 0.26, 4), x, y - L * 0.04, z, [Math.PI, yaw, 0], [0.4, 1, 1]);
}
const PROPS = {
  // A net hung to dry on a pole between two forked posts (2 × 1), with its floats, and what goes with it at its foot
  net_rack(m) {
    for (const x of [-0.95, 0.95]) { rod(m, 'oldWood', [x, -0.1, 0], [x * 1.01, 1.5, 0.02], 0.05, 0.04, 8); rod(m, 'oldWood', [x, 1.32, 0], [x + 0.03, 1.62, 0.13], 0.026, 0.02, 6); rod(m, 'oldWood', [x, 1.32, 0], [x - 0.02, 1.6, -0.12], 0.026, 0.02, 6); rod(m, 'oldWood', [x, 0.02, 0.55], [x, 0.95, 0.04], 0.03, 0.026, 6); }
    rod(m, 'oldWood', [-1.18, 1.46, 0.01], [1.18, 1.48, 0.01], 0.034, 0.03, 7);
    const fold = (u, v, k) => [lerp(-0.9, 0.9, u) + 0.02 * Math.sin(u * 30) * v, 1.47 - v * (1.12 + 0.12 * Math.sin(u * 8 + k)), k * (0.04 + v * 0.16) + 0.07 * Math.sin(u * 17 + k * 2) * v];
    netOver(m, (u, v) => fold(u, v, 1), 18, 6, 1.8, 1.3, 9); netOver(m, (u, v) => fold(u, v * 0.8, -1), 18, 5, 1.8, 1.0, 0);
    for (let i = 0; i < 4; i++) m.geo('rope', new THREE.TorusGeometry(0.2 - i * 0.012, 0.024, 5, 14), 0.62, 0.03 + i * 0.04, 0.62, [Math.PI / 2, 0, i]);
    for (let i = 0; i < 5; i++) m.ball('light', -0.55 + (i % 3) * 0.13, 0.06 + (i > 2 ? 0.08 : 0), 0.6 + (i % 2) * 0.1, 0.065, 0.055, 0.065, 7);
    m.solids = [[-1, 0, -0.15, 1, 1.5, 0.2]];
  },
  // Fish drying on two poles, between a pair of crossed legs at each end (2 × 1)
  fish_rack(m) {
    for (const x of [-0.92, 0.92]) for (const s of [-1, 1]) rod(m, 'oldWood', [x, -0.05, s * 0.42], [x, 1.62, -s * 0.06], 0.036, 0.028, 7);
    rod(m, 'oldWood', [-1.08, 1.5, 0], [1.08, 1.5, 0], 0.028, 0.026, 7);
    for (const [y, z] of [[1.12, 0.17], [1.12, -0.17]]) rod(m, 'oldWood', [-1.0, y, z], [1.0, y, z], 0.018, 0.016, 5);
    let i = 0;
    for (const [y, z, n] of [[1.46, 0, 11], [1.1, 0.17, 10], [1.1, -0.17, 10]]) for (let k = 0; k < n; k++, i++) { if ((i * 7) % 11 === 3) continue; const x = lerp(-0.8, 0.8, (k + 0.5) / n), L = 0.25 + ((i * 37) % 10) * 0.008; rod(m, 'rope', [x, y + 0.02, z], [x, y - 0.06, z], 0.005, 0.005, 3, false); fish(m, x, y - 0.05, z, L, i, i); }
    m.solids = [[-1, 0, -0.4, 1, 1.6, 0.4]];
  },
  // A hide laced on a frame, leaning on its two legs
  hide_rack(m, tone = 'deer') {
    const [out, flesh] = { deer: ['hide:#8d6846', 'hide:#c2a988'], goat: ['hide:#6b5b4d', 'hide:#b9a68a'], boar: ['hide:#4d423a', 'hide:#ad997e'] }[tone] || ['hide:#8d6846', 'hide:#c2a988'];
    const tilt = -0.22, P = (x, y, k = 0) => [x, y * Math.cos(tilt) + k * Math.sin(-tilt), y * Math.sin(tilt) + k * Math.cos(tilt) + 0.3];
    for (const s of [-1, 1]) { rod(m, 'oldWood', P(s * 0.72, -0.08), P(s * 0.66, 1.75), 0.034, 0.028, 7); rod(m, 'oldWood', [s * 0.5, -0.05, -0.55], P(s * 0.62, 1.45), 0.028, 0.024, 6); }
    for (const y of [0.28, 1.58]) rod(m, 'oldWood', P(-0.8, y), P(0.8, y + 0.01), 0.03, 0.028, 7);
    // (its outline: the body, the four legs and the neck)
    const edge = []; const N = 28;
    for (let i = 0; i < N; i++) { const a = (i / N) * TAU, leg = Math.max(0, Math.sin(a * 2 + 0.35)) ** 4 * 0 + Math.max(0, Math.cos((a - Math.PI / 4) * 4)) ** 3 * 0.17, neck = Math.max(0, Math.cos(a - Math.PI / 2)) ** 10 * 0.12; const r = 0.42 + leg + neck + 0.015 * Math.sin(a * 13); edge.push([Math.cos(a) * r * 0.93, 0.93 + Math.sin(a) * r * 1.12]); }
    const face = (key, k, sg, rim) => { const n = [0, sg * Math.sin(-tilt), sg * Math.cos(tilt)], at = (p, f) => P(p[0] * f, 0.93 + (p[1] - 0.93) * f, k + 0.035 * (1 - f * f) * 0.8), uv = [[0, 0], [1, 0], [1, 1], [0, 1]]; for (let i = 0; i < N; i++) { const p = edge[i], q = edge[(i + 1) % N], f = 0.8 + 0.05 * Math.sin(i * 2.1), g = 0.8 + 0.05 * Math.sin(((i + 1) % N) * 2.1); m.B(key).quadN(at(p, 0), at(p, f), at(q, g), at(p, 0), n, uv); m.B(rim).quadN(at(p, f), at(p, 1), at(q, 1), at(q, g), n, uv); } };
    face(flesh, 0.005, 1, 'hide:#a38a6c'); face(out, -0.005, -1, out);
    for (let i = 0; i < N; i += 1) { const [x, y] = edge[i], fx = Math.abs(x) > Math.abs(y - 0.93) * 0.75, to = fx ? [Math.sign(x) * 0.69, y] : [x * 1.05, y > 0.93 ? 1.58 : 0.28]; rod(m, 'rope', P(x * 0.98, 0.93 + (y - 0.93) * 0.98, 0.004), P(...to), 0.005, 0.005, 3, false); }
    m.solids = [[-0.8, 0, -0.4, 0.8, 1.7, 0.4]];
  },
  // Logs stacked between stakes (2 × 1)
  log_pile(m, n = '3', snow) {
    const R = rng(13), L = 1.9, rows = [0, 1, 2, 3].slice(0, +n || 3);
    for (const j of rows) for (let i = 0; i < 4 - j; i++) {
      const r = 0.125 + R() * 0.025, z = (i - (3 - j) / 2) * 0.285, y = 0.14 + j * 0.235, d = (R() - 0.5) * 0.14;
      rod(m, 'logBark', [-L / 2 + d, y, z], [L / 2 + d, y + (R() - 0.5) * 0.02, z], r, r * 0.92, 11);
      for (const s of [-1, 1]) m.geo('logEnd', LOG_END, s * (L / 2 + 0.003) + d, y, z, [0, s * Math.PI / 2, R() * 6], [r * (s < 0 ? 1 : 0.92) * 0.98, r * 0.98 * (s < 0 ? 1 : 0.92), 1]);
    }
    for (const x of [-0.62, 0.62]) for (const s of [-1, 1]) rod(m, 'oldWood', [x, -0.1, s * 0.64], [x, 0.82, s * 0.6], 0.035, 0.028, 6);
    if (snow) sheet(m.B('snow'), (u, v) => { const x = lerp(-0.95, 0.95, u), a = lerp(-0.62, 0.62, v); return [x, (rows.length * 0.235 + 0.12) - Math.abs(a) * 0.62 + 0.03 * Math.sin(x * 7) * Math.cos(a * 9), a]; }, 8, 8, { flip: true });
    m.solids = [[-1, 0, -0.65, 1, rows.length * 0.24 + 0.1, 0.65]];
  },
  // Split firewood stacked against two stakes (2 × 1, low)
  firewood(m, snow) {
    const R = rng(23), tri = [];
    for (let i = 0; i < 3; i++) { const g = new THREE.CylinderGeometry(0.085, 0.085, 0.5, 3 + (i % 2) * 2, 1); g.rotateX(Math.PI / 2); tri.push(g); }
    for (let j = 0; j < 6; j++) for (let i = 0; i < 10 - (j % 2); i++) m.geo(R() < 0.35 ? 'logBark' : 'splitWood', tri[Math.floor(R() * 3)], -0.765 + (j % 2) * 0.085 + i * 0.17 + (R() - 0.5) * 0.012, 0.08 + j * 0.142, (R() - 0.5) * 0.05, [0, 0, R() * 6], [1, 1, 0.94 + R() * 0.1]);
    for (const x of [-0.95, 0.95]) rod(m, 'oldWood', [x, -0.05, 0], [x * 1.02, 1.05, 0], 0.032, 0.026, 6);
    if (snow) sheet(m.B('snow'), (u, v) => [lerp(-0.92, 0.92, u), 0.97 + 0.03 * Math.sin(u * 14) * Math.sin(v * 3), lerp(-0.29, 0.29, v)], 8, 3, { flip: true });
    m.solids = [[-0.95, 0, -0.26, 0.95, 0.95, 0.26]];
  },
  // Sawn boards, stacked with laths between them to dry (2 × 1)
  plank_stack(m) {
    const R = rng(31);
    for (let j = 0; j < 6; j++) {
      const y = 0.1 + j * 0.085;
      for (const x of [-0.7, 0, 0.7]) m.box('oldWood', x - 0.03, y - 0.03, -0.42, x + 0.03, y, 0.42);
      for (let i = 0; i < 4; i++) { const d = (R() - 0.5) * 0.12; m.box(R() < 0.5 ? 'splitWood' : 'light', -0.92 + d, y, -0.4 + i * 0.2, 0.92 + d, y + 0.05, -0.4 + i * 0.2 + 0.185); }
    }
    m.solids = [[-0.95, 0, -0.42, 0.95, 0.62, 0.42]];
  },
  // The sawyers' trestles: a log squared and half cut into boards over the pit they stand in, with the long two-man saw (3 × 2)
  sawpit(m) {
    const H = 1.18;
    for (const x of [-1.05, 1.05]) {
      beam(m, 'oldWood', [x, H, -0.72], [x, H, 0.72], 0.16, 0.16);
      for (const s of [-1, 1]) for (const q of [-1, 1]) rod(m, 'oldWood', [x + q * 0.26, -0.05, s * 0.66], [x + q * 0.05, H - 0.04, s * 0.5], 0.055, 0.045, 7);
      for (const s of [-1, 1]) rod(m, 'oldWood', [x - 0.2, 0.38, s * 0.62], [x + 0.2, 0.38, s * 0.62], 0.024, 0.024, 5);
    }
    // (the log: the side still round, with its bark, and the boards already sawn, a little apart)
    const y0 = H + 0.08, L = 1.65;
    rod(m, 'logBark', [-L, y0 + 0.17, -0.17], [L, y0 + 0.17, -0.17], 0.19, 0.17, 12);
    for (const s of [-1, 1]) m.geo('logEnd', LOG_END, s * (L + 0.003), y0 + 0.17, -0.17, [0, s * Math.PI / 2, 0], [0.18, 0.18, 1]);
    for (let i = 0; i < 4; i++) m.box('splitWood', -L, y0, 0.05 + i * 0.065, L - (i < 2 ? 0 : 0.1), y0 + 0.34 - i * 0.02, 0.05 + i * 0.065 + 0.048);
    // (the saw, standing in its cut: the blade, broad above and narrow below, its teeth, and a handle across at each end)
    const sx = 0.42, B = m.B('steel'), sz = 0.03, T = 0.004;
    for (const q of [-1, 1]) B.quadN([sx - 0.1, y0 + 0.75, sz + q * T], [sx + 0.1, y0 + 0.75, sz + q * T], [sx + 0.06, y0 - 0.7, sz + q * T], [sx - 0.06, y0 - 0.7, sz + q * T], [0, 0, q], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    for (let i = 0; i < 15; i++) { const y = y0 + 0.7 - i * 0.095, x = sx + lerp(0.098, 0.062, i / 15); for (const q of [-1, 1]) B.quadN([x, y, sz + q * T], [x + 0.035, y - 0.04, sz + q * T], [x, y - 0.08, sz + q * T], [x, y - 0.08, sz + q * T], [0, 0, q], [[0, 0], [1, 0], [1, 1], [0, 1]]); }
    rod(m, 'iron', [sx, y0 + 0.75, sz], [sx, y0 + 0.86, sz], 0.016, 0.016, 5); rod(m, 'wood', [sx, y0 + 0.87, sz - 0.2], [sx, y0 + 0.87, sz + 0.2], 0.022, 0.022, 6); rod(m, 'wood', [sx, y0 - 0.74, sz - 0.18], [sx, y0 - 0.74, sz + 0.18], 0.022, 0.022, 6);
    sandMound(m, 0.4, 0.05, 0.85, 0.62, 0.2, 4, 'sawdust');
    m.solids = [[-1.35, 0, -0.72, -0.8, H, 0.72], [0.8, 0, -0.72, 1.35, H, 0.72], [-L, H, -0.36, L, H + 0.5, 0.32]];
  },
  // The block where wood is split, with the axe in it
  chop_block(m) {
    rod(m, 'logBark', [0, -0.03, 0], [0, 0.46, 0], 0.26, 0.24, 12); m.geo('logEnd', LOG_END, 0, 0.463, 0, [-Math.PI / 2, 0, 0.4], [0.235, 0.235, 1]);
    rod(m, 'wood', [0.1, 0.47, 0], [-0.42, 0.95, 0.06], 0.018, 0.016, 6, false); beam(m, 'steel', [0.15, 0.5, 0.035], [0.04, 0.47, -0.02], 0.03, 0.14, [0, 1, 0], 0);
    const R = rng(8); for (let i = 0; i < 8; i++) { const a = R() * TAU, d = 0.42 + R() * 0.3; rod(m, 'splitWood', [Math.cos(a) * d, 0.05, Math.sin(a) * d], [Math.cos(a) * d + Math.cos(a * 3) * 0.28, 0.06, Math.sin(a) * d + Math.sin(a * 3) * 0.28], 0.05, 0.045, 4, false); }
    m.solids = [[-0.26, 0, -0.26, 0.26, 0.47, 0.26]];
  },
  // The charcoal burners' clamp: the wood stacked in a dome under earth and turf, with its vents, smoking (3 × 3)
  charcoal_clamp(m, state = 'lit') {
    const Rr = 1.35, H = 1.35, n = (a, v) => 0.05 * Math.sin(a * 5 + v * 4) + 0.035 * Math.sin(a * 11 - v * 9) + 0.02 * Math.sin(a * 23 + v * 17);
    sheet(m.B('turf'), (u, v) => { const a = u * TAU, r = Rr * Math.sin(v * Math.PI / 2) ** 0.85 * (1 + n(a, v)) + 0.02; return [Math.cos(a) * r, H * Math.cos(v * Math.PI / 2) ** 0.75 * (1 + 0.3 * n(a + 1, v)) - 0.02, Math.sin(a) * r]; }, 30, 10,
      { uv: (u, v) => [u * 7, v * 2], shade: (u, v) => (v < 0.22 ? 0.35 + v * 2 : 0.92 + 0.18 * Math.sin(u * 40) * Math.sin(v * 13)) });
    // (the turfs round its foot, the stones that hold it, and the poles leant on it)
    const R = rng(19);
    for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU + R() * 0.2; m.geo(i % 3 ? 'moss' : 'leafD', pebbleGeo(i % 4), Math.cos(a) * 1.32, 0.12 + R() * 0.25, Math.sin(a) * 1.32, [R(), a, R()], [0.13, 0.045, 0.1]); }
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU + R() * 0.3; pebble(m, 'crag', Math.cos(a) * 1.46, 0.06, Math.sin(a) * 1.46, 0.13, 0.1, 0.11, i, [0, R() * 6, 0]); }
    for (let i = 0; i < 7; i++) { const a = i * 0.9 + 0.3; rod(m, i % 2 ? 'logBark' : 'oldWood', [Math.cos(a) * 1.55, 0, Math.sin(a) * 1.55], [Math.cos(a + 0.12) * 0.42, 1.22, Math.sin(a + 0.12) * 0.42], 0.035, 0.026, 6, false); }
    for (let i = 0; i < 5; i++) { const a = i * 1.26; m.cyl('char', Math.cos(a) * 1.3, 0.2, Math.sin(a) * 1.3, 0.07, 0.07, 0.1, 8, [Math.PI / 2, 0, a]); }
    m.geo('char', new THREE.TorusGeometry(0.17, 0.06, 5, 12), 0, H - 0.02, 0, [Math.PI / 2, 0, 0]).cyl('dark0', 0, H - 0.05, 0, 0.15, 0.15, 0.06, 10);
    // (the stepped log to climb it by)
    rod(m, 'logBark', [1.35, 0, 0.9], [0.36, 1.28, 0.24], 0.07, 0.06, 8);
    if (state === 'lit') { m.smoke.push([0, H + 0.3, 0], [0.5, 1.2, 0.4], [-0.6, 1.1, -0.2]); m.light(0, H, 0, { color: '#ff7a30', intensity: 0.8, range: 3, flicker: true }); }
    m.solids = [[-1.2, 0, -1.2, 1.2, 1.1, 1.2]];
  },
  // A heap of charcoal and its baskets
  charcoal_heap(m) {
    const R = rng(37);
    sandMound(m, 0, 0, 0.6, 0.55, 0.3, 2, 'char');
    for (let i = 0; i < 26; i++) { const a = R() * TAU, d = R() ** 0.6 * 0.52; pebble(m, 'char', Math.cos(a) * d, 0.3 * (1 - (d / 0.6) ** 2) + 0.01, Math.sin(a) * d, 0.06 + R() * 0.03, 0.05, 0.05, i, [R() * 3, R() * 6, 0]); }
    for (const [x, z] of [[0.75, 0.2], [0.55, 0.72]]) { m.cyl('straw', x, 0, z, 0.17, 0.24, 0.36, 12).cyl('char', x, 0.33, z, 0.21, 0.21, 0.04, 10); m.geo('straw', new THREE.TorusGeometry(0.24, 0.018, 5, 14), x, 0.36, z, [Math.PI / 2, 0, 0]); for (const y of [0.12, 0.22]) m.geo('straw', new THREE.TorusGeometry(0.19 + y * 0.15, 0.011, 4, 14), x, y, z, [Math.PI / 2, 0, 0]); }
  },
  // A hayrick round its pole (3 × 3)
  hayrick(m, snow) {
    const prof = [[1.34, 0], [1.3, 0.3], [1.27, 0.75], [1.2, 1.25], [1.02, 1.8], [0.72, 2.3], [0.36, 2.75], [0.1, 3.02]], N = 26;
    sheet(m.B('hayStack'), (u, v) => { const k = v * (prof.length - 1), i = Math.min(prof.length - 2, Math.floor(k)), f = k - i, a = u * TAU, r = lerp(prof[i][0], prof[i + 1][0], f) * (1 + 0.03 * Math.sin(a * 7 + v * 8) + 0.025 * Math.sin(a * 13 - v * 11)); return [Math.cos(a) * r, lerp(prof[i][1], prof[i + 1][1], f) - (v < 0.05 ? 0.05 : 0), Math.sin(a) * r]; }, N, 14, { flip: true, uv: (u, v) => [u * 8, v * 3] });
    rod(m, 'oldWood', [0, 2.8, 0], [0.02, 3.45, 0], 0.045, 0.035, 7);
    for (let i = 0; i < 4; i++) { const a = i * TAU / 4 + 0.4; rod(m, 'rope', [Math.cos(a) * 0.12, 3.0, Math.sin(a) * 0.12], [Math.cos(a) * 1.12, 1.78, Math.sin(a) * 1.12], 0.012, 0.012, 4, false); rod(m, 'rope', [Math.cos(a) * 1.12, 1.78, Math.sin(a) * 1.12], [Math.cos(a) * 1.34, 1.25, Math.sin(a) * 1.34], 0.012, 0.012, 4, false); pebble(m, 'crag', Math.cos(a) * 1.38, 1.16, Math.sin(a) * 1.38, 0.09, 0.09, 0.08, i); }
    for (let i = 0; i < 14; i++) { const a = i * 0.449 + 0.1, d = 1.28 + (i % 3) * 0.12; m.geo('hay', pebbleGeo(i % 4), Math.cos(a) * d, 0.03, Math.sin(a) * d, [0, a, 0], [0.22, 0.06, 0.16]); }
    rod(m, 'wood', [1.55, 0, 0.5], [1.05, 1.5, 0.32], 0.018, 0.016, 6, false);   // (the fork, leant on it)
    for (const d of [-0.07, 0, 0.07]) rod(m, 'wood', [1.05, 1.48, 0.32 + d * 0.3], [0.96, 1.75, 0.3 + d], 0.011, 0.007, 5, false);
    if (snow) sheet(m.B('snow'), (u, v) => { const a = u * TAU, k = lerp(4, 7, v), i = Math.min(6, Math.floor(k)), f = k - i, r = lerp(prof[i][0], prof[i + 1][0], f) + 0.04; return [Math.cos(a) * r, lerp(prof[i][1], prof[i + 1][1], f) + 0.03 - 0.1 * (1 - v) * Math.sin(a * 6), Math.sin(a) * r]; }, 20, 6, { flip: true });
    m.solids = [[-1.1, 0, -1.1, 1.1, 2.2, 1.1], [-0.5, 2.2, -0.5, 0.5, 3, 0.5]];
  },
  // Loose hay, forked in a heap under a roof (3 × 2)
  hay_pile(m) {
    sheet(m.B('hayStack'), (u, v) => { const a = u * TAU, r = v * (1 + 0.12 * Math.sin(a * 3 + 1) + 0.06 * Math.sin(a * 9)); return [Math.cos(a) * 1.35 * r, 1.25 * (1 - v ** 2.2) * (1 + 0.12 * Math.sin(a * 4 + v * 5)) + 0.02, Math.sin(a) * 0.95 * r]; }, 22, 7, { uv: (u, v) => [u * 5, v * 1.6] });
    m.solids = [[-1.2, 0, -0.8, 1.2, 0.8, 0.8]];
  },
  // A stone trough with its water (2 × 1)
  stone_trough(m) {
    const x = 0.85, z = 0.34, h = 0.5, t = 0.1;
    for (const s of [-1, 1]) m.box('ashlar', -x, 0, s * (z - t / 2) - t / 2, x, h, s * (z - t / 2) + t / 2).box('ashlar', s * (x - t / 2) - t / 2, 0, -z, s * (x - t / 2) + t / 2, h, z);
    m.box('stone', -x + t, 0, -z + t, x - t, 0.14, z - t);
    const g = new THREE.PlaneGeometry(2 * (x - t), 2 * (z - t)); g.rotateX(-Math.PI / 2); const w = new THREE.Mesh(g, placeMat('stillWater')); w.position.set(0, h - 0.08, 0); m.extra(w);
    for (const q of [-0.7, 0.7]) pebble(m, 'moss', q, 0.04, z + 0.04, 0.16, 0.05, 0.07, 1);
    m.solids = [[-x, 0, -z, x, h, z]];
  },
  // An iron-wheeled tub for the ore, on its rails; full: heaped
  ore_cart(m, load = 'full') {
    const B = (key, p) => { const [x0, y0, z0, x1, y1, z1] = p; m.box(key, x0, y0, z0, x1, y1, z1); };
    // (boards that flare out, iron straps, the frame and four wheels)
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) { const y = 0.36 + i * 0.125, o = 0.3 + i * 0.022; beam(m, 'wood', [s * o, y + 0.06, -0.5 - i * 0.018], [s * o, y + 0.06, 0.5 + i * 0.018], 0.03, 0.118, [0, 1, 0], 0.006, false); beam(m, 'wood', [-o, y + 0.06, s * (0.5 + i * 0.018)], [o, y + 0.06, s * (0.5 + i * 0.018)], 0.03, 0.118, [0, 1, 0], 0.006, false); }
    for (const s of [-1, 1]) for (const z of [-0.3, 0.3]) beam(m, 'iron', [s * 0.318, 0.34, z], [s * 0.39, 0.88, z], 0.05, 0.012, [s, 0, 0], 0, false);
    B('dark', [-0.3, 0.3, -0.55, 0.3, 0.36, 0.55]); for (const s of [-1, 1]) B('dark', [s * 0.24 - 0.04, 0.22, -0.62, s * 0.24 + 0.04, 0.31, 0.62]);
    for (const s of [-1, 1]) for (const z of [-0.34, 0.34]) m.cyl('iron', s * 0.31, 0.17, z, 0.15, 0.15, 0.05, 14, [0, 0, s * Math.PI / 2]).cyl('iron', s * 0.3, 0.17, z, 0.18, 0.18, 0.02, 14, [0, 0, s * Math.PI / 2]);
    for (const z of [-0.34, 0.34]) rod(m, 'iron', [-0.34, 0.17, z], [0.34, 0.17, z], 0.022, 0.022, 6);
    m.geo('iron', new THREE.TorusGeometry(0.06, 0.012, 5, 10), 0, 0.28, 0.65, [0, Math.PI / 2, 0]);
    if (load === 'full') { const R = rng(43); for (let i = 0; i < 24; i++) { const x = (R() - 0.5) * 0.54, z = (R() - 0.5) * 0.9; pebble(m, i % 5 === 2 ? 'oreVein' : 'crag', x, 0.78 + (0.2 - x * x - z * z * 0.4) * 0.55 + R() * 0.05, z, 0.1 + R() * 0.05, 0.08, 0.09, i, [R() * 3, R() * 6, 0]); } B('spoil', [-0.3, 0.4, -0.48, 0.3, 0.76, 0.48]); }
    m.solids = [[-0.4, 0, -0.62, 0.4, 0.95, 0.62]];
  },
  // A tile of rails, along z
  rail(m) {
    for (const z of [-0.33, 0.33]) m.box('oldWood', -0.48, 0, z - 0.07, 0.48, 0.05, z + 0.07);
    for (const s of [-1, 1]) m.box('iron', s * 0.31 - 0.025, 0.05, -0.5, s * 0.31 + 0.025, 0.085, 0.5);
  },
  // What comes out of a mine: a heap of broken rock
  spoil_heap(m) {
    const R = rng(51);
    sandMound(m, 0, 0, 1.7, 1.4, 0.85, 3, 'spoil');
    for (let i = 0; i < 46; i++) { const a = R() * TAU, d = R() ** 0.6 * 1.65, y = 0.85 * Math.max(0, 1 - (d / 1.7) ** 2) ** 1.6, s = 0.08 + R() * 0.12; pebble(m, i % 13 === 5 ? 'oreVein' : 'crag', Math.cos(a) * d, y + s * 0.3, Math.sin(a) * d * 0.85, s * 1.2, s * 0.85, s, i, [R() * 3, R() * 6, 0]); }
    m.solids = [[-1.2, 0, -1, 1.2, 0.6, 1]];
  },
  // The mouth of a mine: a timber set in the rock of the slope, dark inside, its lagging and its rails out to +z (3 × 3)
  mine_mouth(m, snow) {
    // (the foot of the slope: a bank of earth and grass, the rock showing through it, and the dry-stone walls of the cutting)
    const bank = (x, z) => { const d = Math.hypot(x / 4.6, (z + 3.6) / 3.3); return d < 1 ? 3.5 * (1 - d * d) ** 0.75 * (1 + 0.07 * Math.sin(x * 1.7 + z)) : 0; };
    sheet(m.B(snow ? 'snowBank' : 'bankTurf'), (u, v) => { const a = u * TAU, r = v * (1.0 + 0.03 * Math.sin(a * 5)), x = Math.cos(a) * 4.6 * r, z = -3.6 + Math.sin(a) * 3.3 * r; let y = bank(x, z); if (Math.abs(x) < 1.15 && z > -1.35) y = Math.min(y, 0); return [x, y - (v > 0.99 ? 0.08 : 0), z > -0.75 && Math.abs(x) < 1.25 && y > 0.1 ? -0.75 : z]; }, 34, 14, { uv: (u, v) => [u * 9, v * 4] });
    for (const [x, y, z, sx, sy, sz, i] of [[-2.4, 0.2, -1.3, 0.75, 0.9, 0.6, 1], [2.5, 0.1, -1.4, 0.9, 1.0, 0.7, 2], [0.5, 2.75, -1.7, 1.15, 0.5, 0.8, 1], [-1.5, 2.3, -2.0, 0.8, 0.6, 0.7, 0], [3.4, 0, -2.2, 0.7, 0.6, 0.6, 0], [-3.5, 0, -2.6, 0.6, 0.7, 0.6, 2], [1.9, 1.7, -2.1, 0.6, 0.5, 0.6, 2], [-1.75, 0, 0.75, 0.34, 0.28, 0.3, 0]]) { boulder(m, 'crag', x, y + sy * 0.2, z, sx, sy, sz, i, x + z); if (snow) boulder(m, 'snowcap', x, y + sy * 0.2 + 0.02, z, sx * 1.03, sy * 1.03, sz * 1.03, i, x + z); }
    for (const s of [-1, 1]) for (let j = 0; j < 5; j++) { const R = rng(j * 3 + s + 5), n = Math.max(1, 4 - Math.floor(j * 0.62)); for (let i = 0; i < n; i++) pebble(m, 'crag', s * (1.26 + R() * 0.08), 0.18 + j * 0.43, 0.55 - 0.16 * j - i * 0.5 - R() * 0.08, 0.24, 0.25, 0.3, i + j, [R() * 0.4, R() * 6, R() * 0.4]); }
    const W = 0.85, H = 2.15;
    // (three sets, one behind the other, leaning in a little; the lagging between them; and the dark)
    for (const [z, k] of [[0.42, 1], [-0.25, 0.985], [-0.95, 0.97]]) {
      for (const s of [-1, 1]) rod(m, 'logBark', [s * (W + 0.16), -0.1, z], [s * W * 0.94, H * k, z], 0.125, 0.11, 10);
      rod(m, 'logBark', [-W - 0.3, H * k + 0.1, z], [W + 0.3, H * k + 0.1, z], 0.13, 0.12, 10);
      if (k === 1) for (const s of [-1, 1]) m.geo('logEnd', LOG_END, s * (W + 0.304), H + 0.1, z, [0, s * Math.PI / 2, 0], [0.12, 0.12, 1]);
    }
    for (const s of [-1, 1]) for (let i = 0; i < 6; i++) beam(m, 'oldWood', [s * (W + 0.19 - i * 0.02), 0.2 + i * 0.36, 0.5], [s * (W + 0.17 - i * 0.02), 0.2 + i * 0.36, -1.2], 0.05, 0.26, [0, 1, 0], 0.008, false);
    for (let i = 0; i < 6; i++) beam(m, 'oldWood', [-W + 0.14 + i * 0.29, H + 0.24, 0.62], [-W + 0.14 + i * 0.29, H + 0.2, -1.2], 0.24, 0.05, [0, 1, 0], 0.008, false);
    const D = m.B('dark0'), z0 = -1.15;
    D.quad([-W - 0.1, 0, z0], [W + 0.1, 0, z0], [W + 0.1, H + 0.1, z0], [-W - 0.1, H + 0.1, z0], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    m.box('soot', -0.8, 0, -1.15, 0.8, 0.012, 0.1);
    for (const s of [-1, 1]) m.box('iron', s * 0.31 - 0.025, 0.05, -1.1, s * 0.31 + 0.025, 0.085, 1.5);
    for (let z = -0.35; z < 1.5; z += 0.45) m.box('oldWood', -0.48, 0, z - 0.07, 0.48, 0.05, z + 0.07);
    // (a lantern on a nail)
    rod(m, 'iron', [-0.83, 1.72, 0.5], [-0.83, 1.72, 0.72], 0.012, 0.012, 5); lantern(m, -0.83, 1.5, 0.7);
    m.solids = [[-3.2, 0, -5.5, -1.0, 2.2, 0.5], [1.0, 0, -5.5, 3.2, 2.2, 0.5], [-1.0, 0, -5.5, 1.0, 2.8, -1.1]];
  },
  // A rowing boat, its oars laid in it (tied to the hamlets' jetties)
  row_boat(m) {
    const G = rowBoatGeo();
    void G;
    addB(m, 'boatHull', ROWB.hull, new THREE.Matrix4());
    for (const s of [-1, 1]) addB(m, 'boatHull', ROWB.oar, new THREE.Matrix4().compose(new THREE.Vector3(s * 0.24, 0.56, 0.85), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 - 0.06, 0, s * 0.06)), _one));
    rod(m, 'rope', [0, 0.62, 1.12], [0.3, 0.3, 2.1], 0.011, 0.011, 5, false);
    m.solids = [[-0.6, 0, -1, 0.6, 0.5, 1.1]];
  },
  // A jetty out over the water to +z (its near end at z = -0.5), n tiles long: piles, stringers, boards and mooring posts
  jetty(m, n = '6') {
    const L = +n || 6, R = rng(71), Y = 0.2;
    for (let z = 0.1; z < L - 0.2; z += 1.6) for (const s of [-1, 1]) rod(m, 'oldWood', [s * 0.78, -1.9, z], [s * 0.76, z > 1 && Math.round(z / 1.6) % 2 === 0 ? 0.78 : Y - 0.02, z], 0.085, 0.075, 8);
    for (const s of [-1, 1]) for (const z of [L - 0.55]) { rod(m, 'oldWood', [s * 0.78, -1.9, z], [s * 0.76, 0.78, z], 0.085, 0.075, 8); for (let k = 0; k < 3; k++) m.geo('rope', new THREE.TorusGeometry(0.085, 0.016, 5, 10), s * 0.765, 0.5 + k * 0.035, z, [Math.PI / 2, 0, 0]); }
    for (const s of [-1, 1]) beam(m, 'oldWood', [s * 0.72, Y - 0.12, -0.5], [s * 0.72, Y - 0.12, L - 0.4], 0.1, 0.14);
    for (let z = -0.45, i = 0; z < L - 0.45; z += 0.205, i++) { const w = 0.92 + (R() - 0.5) * 0.07, d = (R() - 0.5) * 0.05; m.box(R() < 0.3 ? 'plankGrey' : 'oldWood', -w + d, Y - 0.05 + (R() - 0.5) * 0.008, z, w + d, Y, z + 0.185); }
    // (the ladder down to a boat)
    for (const x of [-0.2, 0.2]) rod(m, 'oldWood', [x, -1.0, L - 0.36], [x, 0.5, L - 0.4], 0.03, 0.03, 6); for (const y of [-0.5, -0.2, 0.08]) rod(m, 'oldWood', [-0.2, y, L - 0.37], [0.2, y, L - 0.37], 0.022, 0.022, 5);
    m.solids = [[-0.95, -0.2, -0.5, 0.95, Y, L - 0.4]];
  },
  // A stone bench, long along x (2 × 1)
  stone_bench(m) { m.box('ashlar', -0.9, 0.38, -0.22, 0.9, 0.5, 0.22).box('ashlar', -0.68, 0, -0.17, -0.42, 0.38, 0.17).box('ashlar', 0.42, 0, -0.17, 0.68, 0.38, 0.17); },
  // A fire basket on its stone foot (the beacon of a tower's terrace, the temple's door): lit, laid or cold
  brazier(m, state = 'cold') {
    m.cyl('ashlarW', 0, 0, 0, 0.34, 0.32, 0.12, 10).cyl('ashlarW', 0, 0.12, 0, 0.2, 0.18, 0.5, 10).cyl('ashlarW', 0, 0.62, 0, 0.24, 0.28, 0.1, 10);
    for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; rod(m, 'iron', [Math.cos(a) * 0.17, 0.72, Math.sin(a) * 0.17], [Math.cos(a) * 0.34, 1.02, Math.sin(a) * 0.34], 0.013, 0.012, 5, false); }
    for (const [y, r] of [[0.78, 0.205], [0.9, 0.27], [1.02, 0.34]]) m.geo('iron', new THREE.TorusGeometry(r, 0.014, 5, 18), 0, y, 0, [Math.PI / 2, 0, 0]);
    m.cyl('char', 0, 0.73, 0, 0.17, 0.2, 0.06, 10);
    for (let i = 0; i < 6; i++) { const a = i * 1.05; rod(m, state === 'cold' ? 'char' : 'logBark', [Math.cos(a) * 0.22, 0.84 + (i % 2) * 0.05, Math.sin(a) * 0.22], [-Math.cos(a) * 0.16, 1.02 + (i % 3) * 0.05, -Math.sin(a) * 0.16], 0.036, 0.032, 6, false); }
    if (state === 'lit') { m.fire(0, 0.95, 0, 0.9).light(0, 1.4, 0, { color: '#ff9a40', intensity: 5, range: 12, flicker: true, pool: 3 }); m.smoke.push([0, 2, 0]); }
    m.solids = [[-0.34, 0, -0.34, 0.34, 1.1, 0.34]];
  },
  // A hatch in a stone floor over a stair that goes down into the dark (2 × 2)
  crypt_hatch(m) {
    for (const s of [-1, 1]) m.box('ashlarW', -0.95, 0, s * 0.82 - 0.13, 0.95, 0.16, s * 0.82 + 0.13).box('ashlarW', s * 0.82 - 0.13, 0, -0.69, s * 0.82 + 0.13, 0.16, 0.69);
    m.box('dark0', -0.69, 0.005, -0.69, 0.69, 0.02, 0.69);
    // (the first steps, lit from above, each darker)
    m.box('ashlarD', -0.69, 0.02, 0.47, 0.69, 0.11, 0.69, 1).box('rockFaceD', -0.69, 0.02, 0.24, 0.69, 0.06, 0.47).box('soot', -0.69, 0.02, 0.02, 0.69, 0.035, 0.24);
    // (the slab, drawn half off, and its two rings)
    const M = new THREE.Matrix4().compose(new THREE.Vector3(0.05, 0.22, -0.72), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.06, 0)), _one), B = new Builder(); B.roundBox(-0.76, -0.06, -0.52, 0.76, 0.06, 0.52, 0.02, { s: ASH_M }); addB(m, 'ashlarW', B, M);
    for (const x of [-0.4, 0.45]) m.geo('iron', new THREE.TorusGeometry(0.09, 0.016, 5, 12), x, 0.3, -0.72, [Math.PI / 2 - 0.25, 0, 0]);
    m.solids = [[-0.95, 0, -0.95, 0.95, 0.25, 0.95]];
  },
  // A bell hung between two dressed pillars under a coping of slates (2 × 1)
  bell_frame(m) {
    const A = (x0, y0, z0, x1, y1, z1) => m.box('ashlarW', x0, y0, z0, x1, y1, z1, ASH_M);
    for (const s of [-1, 1]) { A(s * 0.78 - 0.27, 0, -0.32, s * 0.78 + 0.27, 0.3, 0.32); A(s * 0.78 - 0.21, 0.3, -0.25, s * 0.78 + 0.21, 2.55, 0.25); A(s * 0.78 - 0.26, 2.55, -0.3, s * 0.78 + 0.26, 2.7, 0.3); }
    // (the arch, of voussoirs)
    const N = 9; for (let i = 0; i < N; i++) { const a0 = Math.PI * (i / N) + 0.01, a1 = Math.PI * ((i + 1) / N) - 0.01, am = (a0 + a1) / 2, B = m.B('ashlarW'), P = (a, r, z) => [Math.cos(a) * r, 2.7 + Math.sin(a) * r, z], r0 = 0.56, r1 = 0.86; for (const z of [-0.23, 0.23]) B.quadN(P(a0, r0, z), P(a1, r0, z), P(a1, r1, z), P(a0, r1, z), [0, 0, Math.sign(z)], [[0.1, 0.02], [0.1, 0.1], [0.28, 0.1], [0.28, 0.02]]); B.quadN(P(a0, r0, -0.23), P(a1, r0, -0.23), P(a1, r0, 0.23), P(a0, r0, 0.23), [-Math.cos(am), -Math.sin(am), 0], [[0, 0], [0.1, 0], [0.1, 0.15], [0, 0.15]]); B.quadN(P(a0, r1, -0.23), P(a1, r1, -0.23), P(a1, r1, 0.23), P(a0, r1, 0.23), [Math.cos(am), Math.sin(am), 0], [[0, 0], [0.1, 0], [0.1, 0.15], [0, 0.15]]); for (const [a, sg] of [[a0, -1], [a1, 1]]) B.quadN(P(a, r0, -0.23), P(a, r1, -0.23), P(a, r1, 0.23), P(a, r0, 0.23), [-Math.sin(a) * sg, Math.cos(a) * sg, 0], [[0, 0], [0.1, 0], [0.1, 0.15], [0, 0.15]]); }
    // (the coping: two slopes of slate)
    for (const s of [-1, 1]) beam(m, 'slateCap', [s * 1.14, 3.22, 0], [s * 0.0, 3.82, 0], 0.64, 0.06, [0, 1, 0], 0.01);
    for (const s of [-1, 1]) A(s * 0.78 - 0.2, 2.7, -0.22, s * 0.78 + 0.2, 3.2, 0.22);
    m.geo('ashlarW', pebbleGeo(0), 0, 3.95, 0, [0, 0, 0], [0.12, 0.14, 0.12]);
    // (the bell, its yoke, the clapper and the rope)
    beam(m, 'dark', [-0.6, 2.86, 0], [0.6, 2.86, 0], 0.11, 0.12);
    const P = [[0.0, 0.44], [0.09, 0.43], [0.14, 0.38], [0.16, 0.25], [0.2, 0.12], [0.27, 0.02], [0.28, 0], [0.255, 0], [0.18, 0.12], [0.14, 0.25]].map(p => new THREE.Vector2(...p));
    m.geo('bronze', new THREE.LatheGeometry(P, 18), 0, 2.36, 0).ball('iron', 0, 2.36, 0, 0.05, 0.06, 0.05, 8); rod(m, 'iron', [0, 2.4, 0], [0, 2.7, 0], 0.012, 0.012, 5, false);
    for (const x of [-0.06, 0.06]) rod(m, 'iron', [x, 2.76, 0], [x, 2.93, 0], 0.012, 0.012, 5, false);
    rod(m, 'rope', [0, 2.32, 0], [0.03, 1.1, 0.04], 0.013, 0.013, 5, false); m.ball('rope', 0.03, 1.08, 0.04, 0.03, 0.05, 0.03, 7);
    m.solids = [[-1.05, 0, -0.32, -0.5, 3.2, 0.32], [0.5, 0, -0.32, 1.05, 3.2, 0.32], [-1.05, 2.6, -0.32, 1.05, 3.9, 0.32]];
  },
  // A signpost with nothing written: a post with up to three arms, each with its height and where it points (degrees from +z). With its
  // names: signs (roads3d.js)
  signpost(m, arms = '20-150-260') {
    rod(m, 'oldWood', [0, -0.15, 0], [0.02, 2.35, 0], 0.075, 0.062, 8); m.geo('oldWood', new THREE.ConeGeometry(0.085, 0.14, 8), 0.02, 2.41, 0);
    for (let i = 0; i < 4; i++) pebble(m, 'crag', Math.cos(i * 1.6) * 0.17, 0.05, Math.sin(i * 1.6) * 0.17, 0.12, 0.09, 0.1, i);
    String(arms).split('-').slice(0, 3).forEach((d, i) => {
      const a = (+d || 0) * Math.PI / 180, y = 2.12 - i * 0.27, M = new THREE.Matrix4().compose(new THREE.Vector3(0.018, y, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a - Math.PI / 2, 0)), _one);
      const B = new Builder(), sh = new THREE.Shape([[-0.12, -0.095], [0.74, -0.095], [0.88, 0], [0.74, 0.095], [-0.12, 0.095]].map(p => new THREE.Vector2(...p)));
      B.addGeometry(new THREE.ExtrudeGeometry(sh, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1 }), new THREE.Matrix4().makeTranslation(0, 0, 0.06));
      addB(m, i % 2 ? 'oldWood' : 'plankGrey', B, M);
      const N = new Builder(); for (const x of [-0.06, 0.06]) N.box(x - 0.012, -0.012, 0.1, x + 0.012, 0.012, 0.108); addB(m, 'iron', N, M);
    });
    m.solids = [[-0.1, 0, -0.1, 0.1, 2.4, 0.1]];
  },
  // ---------- what else the places have, for anyone to build ----------
  mine_front(m) { PROPS.mine_mouth(m); },   // (the mouth of a mine, with no mine behind)
  beached_up(m) { beached(m, 'up', '1'); }, beached_trestle(m) { beached(m, 'trestle', '1'); }, beached_side(m) { beached(m, 'side', '1'); }, beached_keel(m) { beached(m, 'keel', '2'); }, beached_buried(m) { beached(m, 'buried', '3'); },
  // A pole with its pennant, half furled
  pennant(m) {
    for (let i = 0; i < 5; i++) pebble(m, 'crag', Math.cos(i * 1.26) * 0.15, 0.05, Math.sin(i * 1.26) * 0.15, 0.12, 0.09, 0.1, i);
    rod(m, 'oldWood', [0, -0.15, 0], [0.01, 3.4, 0], 0.045, 0.028, 7); m.ball('brass', 0.01, 3.44, 0, 0.05, 0.05, 0.05, 8);
    sheet(m.B('canvasRust'), (u, v) => [0.02 + u * 1.05, 3.28 - v * 0.52 * (1 - u * 0.45) - u * u * 0.3, 0.13 * Math.sin(u * 5.2) * (0.3 + u)], 9, 3, { uv: (u, v) => [u, v * 0.5] });
    m.solids = [[-0.1, 0, -0.1, 0.1, 3.4, 0.1]];
  },
  // A lantern hung from an iron bracket on a post
  post_lantern(m) {
    rod(m, 'oldWood', [0, -0.15, 0], [0, 2.2, 0], 0.07, 0.06, 8); m.geo('oldWood', new THREE.ConeGeometry(0.08, 0.1, 8), 0, 2.25, 0);
    rod(m, 'iron', [0, 2.05, 0], [0, 2.1, 0.46], 0.016, 0.014, 6); rod(m, 'iron', [0, 1.75, 0.05], [0, 2.07, 0.32], 0.012, 0.012, 5); lantern(m, 0, 1.8, 0.44);
    m.solids = [[-0.09, 0, -0.09, 0.09, 2.3, 0.09]];
  },
  // Ivy up a wall (its back to -z: against one)
  ivy(m) {
    sheet(m.B('ivy'), (u, v) => [(u - 0.5) * 1.7, v * 2.6 - 0.05, 0.03 + 0.05 * Math.sin(u * 17 + v * 11) ** 2], 10, 8, { uv: (u, v) => [u, v] });
    const Q = rng(78), C = m.B('ivy');
    for (let i = 0; i < 26; i++) { const v = Q() ** 1.5, x = (Q() - 0.5) * 1.3 * (1 - v * 0.6), y = 0.1 + v * 2.1, s = 0.18 + Q() * 0.18, z = 0.1 + Q() * 0.08, r = (Q() - 0.5) * 1.1, u0 = 0.3 + Q() * 0.2, v0 = 0.02 + Q() * 0.25, ex = [s * Math.cos(r), 0, -s * Math.sin(r)], up = [0, s, s * 0.35], k = (p, q) => [x + ex[0] * p, y + up[1] * q, z + ex[2] * p + up[2] * q]; C.quad(k(-1, -1), k(1, -1), k(1, 1), k(-1, 1), [0, 0.35, 1], [[u0, v0], [u0 + 0.2, v0], [u0 + 0.2, v0 + 0.2], [u0, v0 + 0.2]]); }
    for (let i = 0; i < 5; i++) m.geo('moss', pebbleGeo(i % 4), -0.6 + i * 0.3, 0.03, 0.08 + Q() * 0.08, [0, i, 0], [0.22, 0.08, 0.14]);
    m.solids = [[-0.6, 0, 0, 0.6, 2.2, 0.12]];
  },
  // Sand heaped by the wind (against a wall, or anywhere)
  sand_drift(m) { sandMound(m, 0, 0, 1.4, 0.9, 0.6, 2); sandMound(m, 0.7, 0.25, 0.8, 0.6, 0.3, 4); m.solids = [[-0.9, 0, -0.55, 0.9, 0.4, 0.55]]; },
};
const LOG_END = new THREE.CircleGeometry(1, 14);
// A small lantern, hung by its ring at (x, y + 0.3, z)
function lantern(m, x, y, z, on = true) {
  m.cyl('iron', x, y - 0.02, z, 0.075, 0.075, 0.025, 8).cyl(on ? 'lamp' : 'glass', x, y + 0.005, z, 0.052, 0.052, 0.15, 8).cyl('iron', x, y + 0.155, z, 0.08, 0.025, 0.07, 8).geo('iron', new THREE.TorusGeometry(0.03, 0.006, 4, 8), x, y + 0.245, z);
  for (let i = 0; i < 4; i++) { const a = i * TAU / 4 + 0.4; rod(m, 'iron', [x + Math.cos(a) * 0.065, y, z + Math.sin(a) * 0.065], [x + Math.cos(a) * 0.065, y + 0.16, z + Math.sin(a) * 0.065], 0.006, 0.006, 4, false); }
  if (on) m.light(x, y + 0.08, z, { color: '#ffc070', intensity: 3.5, range: 8, pool: 2.4 });
}

// ---------- what dresses a watchtower ----------
// state: kept (the lantern by its door, a bench, the firewood, the pennant up on the terrace), empty (ivy up its side, moss,
// nothing else: nobody has taken anything down) or beacon (kept, with the fire basket on the terrace). land: snow, sand, green
function towerDress(m, state = 'kept', h = '9', land = 'green') {
  const H = +h || TOWER.H, R = TOWER.R, dm = (TOWER.door[0] + TOWER.door[1]) / 2, P = (a, r, y) => [Math.sin(a) * r, y, Math.cos(a) * r];
  if (state !== 'empty') {
    const a = TOWER.door[1] + 0.2, b = P(a, R, 2.32), e = P(a, R + 0.42, 2.36);
    rod(m, 'iron', b, e, 0.018, 0.016, 6); rod(m, 'iron', P(a, R, 2.02), P(a, R + 0.3, 2.34), 0.013, 0.013, 5); lantern(m, e[0], 2.06, e[2]);
    // (the bench and the wood against the wall, at the side of the door)
    const c = TOWER.door[0] - 0.5, at = P(c, R + 0.28, 0); beam(m, 'oldWood', [at[0] - Math.cos(c) * 0.75, 0.42, at[2] + Math.sin(c) * 0.75], [at[0] + Math.cos(c) * 0.75, 0.42, at[2] - Math.sin(c) * 0.75], 0.32, 0.06); for (const s of [-0.55, 0.55]) rod(m, 'oldWood', [at[0] + Math.cos(c) * s, 0, at[2] - Math.sin(c) * s], [at[0] + Math.cos(c) * s, 0.4, at[2] - Math.sin(c) * s], 0.05, 0.05, 6);
    const w = TOWER.door[1] + 0.75; for (let j = 0; j < 4; j++) for (let i = 0; i < 6 - (j % 2); i++) { const q = P(w + (i - 2.5) * 0.055 + (j % 2) * 0.03, R + 0.02, 0.09 + j * 0.14), o = P(w + (i - 2.5) * 0.055 + (j % 2) * 0.03, R + 0.46, 0.09 + j * 0.14); rod(m, (i + j) % 3 ? 'splitWood' : 'logBark', q, o, 0.075, 0.07, 6, false); }
    // (the pennant: a pole at the parapet, its cloth half furled)
    const f = dm + 2.6, p0 = P(f, R - 0.3, H), p1 = P(f, R - 0.32, H + 2.9); rod(m, 'oldWood', p0, p1, 0.035, 0.026, 7, false); m.ball('brass', p1[0], p1[1] + 0.04, p1[2], 0.05, 0.05, 0.05, 8);
    sheet(m.B('canvasRust'), (u, v) => [p1[0] + u * 1.05, p1[1] - 0.12 - v * 0.52 * (1 - u * 0.45) - u * u * 0.3, p1[2] + 0.13 * Math.sin(u * 5.2) * (0.3 + u)], 9, 3, { uv: (u, v) => [u, v * 0.5] });
    if (state === 'beacon') { const tmp = new m.constructor(); PROPS.brazier(tmp, 'lit'); const q = P(0, 0, H), S = 1.5, hb = H + 0.95; m.box('ashlarW', -0.55, H, -0.55, 0.55, H + 0.2, 0.55, 1).box('ashlarW', -0.42, H + 0.2, -0.42, 0.42, hb, 0.42, 1); for (const [k, B] of tmp.parts) addB(m, k, B, new THREE.Matrix4().compose(new THREE.Vector3(0, hb, 0), new THREE.Quaternion(), new THREE.Vector3(S, S, S))); m.fire(q[0], hb + 1.45, q[2], 1.9).light(q[0], hb + 2.2, q[2], { color: '#ff9a40', intensity: 6, range: 16, flicker: true, halo: 1.4 }); m.smoke.push([q[0], hb + 2.8, q[2]]); }
  } else if (land !== 'sand') {
    // Ivy, in three patches that hug the wall
    for (const [a0, w, y1] of [[dm + 1.5, 1.25, 4.6], [dm + 2.75, 0.85, 3.0], [dm - 1.6, 0.75, 2.5]]) sheet(m.B(land === 'snow' ? 'ivyDry' : 'ivy'), (u, v) => { const a = a0 + (u - 0.5) * w, r = R + 0.045 + 0.05 * Math.sin(u * 17 + v * 11) ** 2; return P(a, r, v * y1 - 0.05); }, 12, 8, { uv: (u, v) => [u, v] });
    // (and sprays of it that stand out of the wall, thicker low down)
    { const Q = rng(77), key = land === 'snow' ? 'ivyDry' : 'ivy', C = m.B(key); for (const [a0, w, y1, n] of [[dm + 1.5, 1.0, 3.9, 34], [dm + 2.75, 0.65, 2.5, 20], [dm - 1.6, 0.55, 2.1, 16]]) for (let i = 0; i < n; i++) { const v = Q() ** 1.5, a = a0 + (Q() - 0.5) * w * (1 - v * 0.6), y = 0.1 + v * y1, s = 0.2 + Q() * 0.2, r = R + 0.1 + Q() * 0.1, t = (Q() - 0.5) * 1.1, u0 = 0.3 + Q() * 0.2, v0 = 0.02 + Q() * 0.25, c = P(a, r, y), ex = [Math.cos(a) * s * Math.cos(t) + Math.sin(a) * s * Math.sin(t), 0, -Math.sin(a) * s * Math.cos(t) + Math.cos(a) * s * Math.sin(t)], up = [Math.sin(a) * s * 0.35, s, Math.cos(a) * s * 0.35], k = (p, q) => [c[0] + ex[0] * p + up[0] * q, c[1] + ex[1] * p + up[1] * q, c[2] + ex[2] * p + up[2] * q]; C.quad(k(-1, -1), k(1, -1), k(1, 1), k(-1, 1), [Math.sin(a), 0.35, Math.cos(a)], [[u0, v0], [u0 + 0.2, v0], [u0 + 0.2, v0 + 0.2], [u0, v0 + 0.2]]); } }
  }
  if (land !== 'sand' && land !== 'snow') { const Q = rng(9); for (let i = 0; i < 11; i++) { const a = dm + 0.9 + i * 0.44 + Q() * 0.2; m.geo('moss', pebbleGeo(i % 4), ...P(a, R + 0.02, 0.03), [0, a, 0], [0.3 + Q() * 0.2, 0.07 + Q() * 0.09, 0.14]); } }
  if (land === 'sand') sheet(m.B('dune'), (u, v) => { const a = dm + 1.4 + (u - 0.5) * 3.2, k = Math.cos((u - 0.5) * Math.PI) ** 0.8; return P(a, R - 0.05 + v * (0.35 + 1.9 * k), 0.95 * k * (1 - v) ** 1.7 - 0.04 * v); }, 18, 6, { flip: true });
  if (land === 'snow') {
    // (on the merlons, on the wall between them, on the terrace against the parapet, and the drift at its foot)
    const N = 56, top = H + TOWER.parapet, Ri = TOWER.inner, S = m.B('snow');
    for (let i = 0; i < N; i++) { const a0 = (i / N) * TAU, a1 = ((i + 1) / N) * TAU, y = i % 2 === 0 ? top : H + 0.5, t = 0.07 + 0.03 * Math.sin(i * 2.3), q = (a, r, yy) => P(a, r, yy); S.quadN(q(a0, Ri - 0.02, y + t * 0.6), q(a1, Ri - 0.02, y + t * 0.6), q(a1, (R + Ri) / 2, y + t), q(a0, (R + Ri) / 2, y + t), [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]); S.quadN(q(a0, (R + Ri) / 2, y + t), q(a1, (R + Ri) / 2, y + t), q(a1, R + 0.03, y - 0.02), q(a0, R + 0.03, y - 0.02), [Math.sin(a0) * 0.5, 0.85, Math.cos(a0) * 0.5], [[0, 0], [1, 0], [1, 1], [0, 1]]); }
    sheet(S, (u, v) => { const a = u * TAU, k = 0.35 + 0.3 * Math.max(0, Math.cos(a - dm - 2.4)) + 0.06 * Math.sin(a * 7), away = Math.min(1, Math.abs(Math.atan2(Math.sin(a - dm), Math.cos(a - dm))) / 0.6); return P(a, R - 0.03 + v * (0.5 + k * 1.6), k * 0.8 * away * (1 - v) ** 1.6 - 0.05 * v); }, 40, 5, { flip: true });
  }
  m.solids = [];
}

// ---------- springs, salt licks, the bridge ----------
// A spring: water that comes out between the rocks into a basin ringed with stones; trough: caught in a stone trough by a spout
function spring(m, kind = 'seep', snow) {
  const R = rng(5), rocks = [[0, -0.95, 0.8, 0.85, 0.5, 0, 0], [-0.85, -0.65, 0.55, 0.6, 0.5, 1, 1], [0.85, -0.7, 0.6, 0.5, 0.5, 2, 2], [0.35, -1.25, 0.6, 1.05, 0.5, 1, 0.5], [-0.45, -1.3, 0.55, 0.75, 0.45, 2, 3]];
  for (const [x, z, sx, sy, sz, i, yaw] of rocks) { boulder(m, 'crag', x, sy * 0.12, z, sx, sy, sz, i, yaw); if (snow) boulder(m, 'snowcap', x, sy * 0.12 + 0.02, z, sx * 1.03, sy * 1.03, sz * 1.03, i, yaw); }
  const pool = (cx, cz, rx, rz, y) => { const B = new Builder(); sheet(B, (u, v) => { const a = u * TAU; return [Math.cos(a) * rx * v * (1 + 0.07 * Math.sin(a * 3)), 0, Math.sin(a) * rz * v * (1 + 0.07 * Math.cos(a * 4))]; }, 20, 1); const w = B.mesh(placeMat('stillWater'), { cast: false }); w.position.set(cx, y, cz); m.extra(w); };
  // (the thread of water, falling from the cleft)
  const fall = (x, y0, z0, y1, z1, w) => sheet(m.B('fallWater'), (u, v) => [x + (u - 0.5) * w * (1 + 0.3 * Math.sin(v * 9)), lerp(y0, y1, v * v * 0.6 + v * 0.4), lerp(z0, z1, Math.sqrt(v))], 2, 8, { flip: false });
  if (kind === 'trough') {
    const tmp = new m.constructor(); PROPS.stone_trough(tmp); for (const w of tmp.extras) { w.position.z += 0.32; m.extra(w); } for (const [k, B] of tmp.parts) addB(m, k, B, new THREE.Matrix4().makeTranslation(0, 0, 0.32)); m.solids.push(...tmp.solids.map(([a, b, c, d, e, f]) => [a, b, c + 0.32, d, e, f + 0.32]));
    beam(m, 'oldWood', [0, 0.8, -0.65], [0, 0.72, 0.2], 0.16, 0.05); for (const s of [-1, 1]) beam(m, 'oldWood', [s * 0.07, 0.84, -0.65], [s * 0.07, 0.76, 0.2], 0.03, 0.07);
    m.box('fallWater', -0.04, 0.765, -0.6, 0.04, 0.775, 0.2); fall(0, 0.74, 0.2, 0.43, 0.32, 0.07); rod(m, 'oldWood', [0, 0, 0.0], [0, 0.72, 0.0], 0.04, 0.035, 6);
    for (let i = 0; i < 6; i++) pebble(m, 'crag', -0.7 + i * 0.28, 0.03, 0.82 + R() * 0.1, 0.16, 0.06, 0.12, i, [0, R() * 6, 0]);
  } else {
    sheet(m.B('springBed'), (u, v) => { const a = u * TAU; return [Math.cos(a) * 0.95 * v, 0.015, 0.1 + Math.sin(a) * 0.8 * v]; }, 18, 1);
    pool(0, 0.1, 0.78, 0.66, 0.1); fall(0.06, 0.62, -0.62, 0.1, -0.35, 0.13);
    for (let i = 0; i < 15; i++) { const a = (i / 15) * TAU + 0.2, s = 0.13 + R() * 0.07, x = Math.cos(a) * 0.9, z = 0.1 + Math.sin(a) * 0.78; pebble(m, 'crag', x, 0.06, z, s * 1.25, s, s, i, [R(), R() * 6, R()]); if (snow) m.geo('snow', pebbleGeo(i % 4), x, 0.06 + s * 0.62, z, [0, i, 0], [s * 0.95, s * 0.35, s * 0.75]); }
    // (its overflow, a thread among the stones)
    sheet(m.B('water'), (u, v) => [0.5 + v * 0.75 + (u - 0.5) * 0.17, 0.045 - v * 0.02, 0.62 + v * 0.8 + 0.12 * Math.sin(v * 6) + (u - 0.5) * 0.12], 1, 8, { flip: true });
  }
  // (moss and ferns where it is always wet)
  for (let i = 0; i < 10; i++) { const a = -0.3 - i * 0.28, d = 0.98 + R() * 0.2; m.geo('moss', pebbleGeo(i % 4), Math.cos(a) * d, 0.1 + R() * 0.3, -0.1 + Math.sin(a) * d * 0.72, [R(), R() * 6, 0], [0.22, 0.05, 0.16]); }
  if (!snow) for (const [x, z, k] of [[-1.05, 0.1, 1], [1.1, -0.1, 0.9], [-0.75, -0.25, 0.7], [0.8, -0.3, 0.75]]) for (let i = 0; i < 8; i++) { const a = i * 0.785 + x * 3; sheet(m.B('leafc:#5d7040'), (u, v) => [x + Math.cos(a) * (0.5 * v * k) - Math.sin(a) * (u - 0.5) * 0.13 * Math.sin(Math.PI * Math.min(1, v * 0.9 + 0.12)) * k, 0.06 + (0.42 * Math.sin(v * 2.1)) * k, z + Math.sin(a) * (0.5 * v * k) + Math.cos(a) * (u - 0.5) * 0.13 * Math.sin(Math.PI * Math.min(1, v * 0.9 + 0.12)) * k], 2, 5); }
  m.solids = [[-1.2, 0, -1.6, 1.2, 0.8, -0.5], ...m.solids.filter(b => b[5] > 0 && b[4] > 0.4 && b[4] < 0.6)].slice(0, 3);
}
// A salt lick: flat stones with the salt on them, licked hollow, on ground that hooves have trodden bare
function saltLick(m, snow) {
  const R = rng(15);
  sheet(m.B('bareSoil'), (u, v) => { const a = u * TAU, k = 1 + 0.18 * Math.sin(a * 3) + 0.1 * Math.sin(a * 7 + 1); return [Math.cos(a) * 1.75 * v * k, 0.022 - 0.03 * v * v, Math.sin(a) * 1.45 * v * k]; }, 26, 3);
  for (const [x, z, s, i] of [[-0.55, -0.3, 0.34, 0], [0.35, -0.45, 0.4, 1], [0.65, 0.4, 0.32, 2], [-0.25, 0.5, 0.36, 3], [-1.0, 0.45, 0.28, 1]]) { pebble(m, 'crag', x, 0.07, z, s * 1.15, 0.12, s * 0.9, i, [0, i * 1.7, 0]); pebble(m, 'salt', x, 0.2, z, s * 0.46, 0.11 + (i % 2) * 0.05, s * 0.4, i + 1, [0, i, 0]); for (let k = 0; k < 4; k++) pebble(m, 'salt', x + (R() - 0.5) * s * 1.7, 0.1, z + (R() - 0.5) * s * 1.5, 0.045, 0.025, 0.04, k); }
  // (a block set on a post, for the taller ones)
  rod(m, 'oldWood', [0.05, -0.1, -0.02], [0.03, 0.82, 0.0], 0.085, 0.075, 8); rod(m, 'iron', [0.03, 0.8, 0], [0.03, 1.2, 0], 0.012, 0.012, 5, false); m.geo('salt', pebbleGeo(2), 0.03, 0.96, 0, [0, 0.5, 0], [0.16, 0.2, 0.15]);
  for (let i = 0; i < 12; i++) { const a = R() * TAU, d = 0.5 + R() * 1.1; m.geo('soil', pebbleGeo(i % 4), Math.cos(a) * d, 0.012, Math.sin(a) * d * 0.8, [0, a, 0], [0.06, 0.012, 0.08]); }
  if (snow) sandMound(m, 0.9, -0.8, 0.8, 0.6, 0.12, 2, 'snow');
  m.solids = [[-0.12, 0, -0.12, 0.15, 1.1, 0.12]];
}
// A stone bridge along z, n tiles long and 3 wide: one arch of dressed stone (two, if long), its deck almost level, parapets
function stoneBridge(m, n = '9') {
  const L = +n || 9, W = 1.62, arches = L > 11 ? 2 : 1, foot = -2.2, pier = 0.9, span = (L - 1.6 - (arches - 1) * pier) / arches, base = -0.95;
  const deck = z => 0.1 + (arches > 1 ? 0.75 : 1.0) * Math.cos((z / (L / 2)) * Math.PI / 2) ** 0.9, crown = c => deck(c) - 0.36, Z0 = -L / 2, Z1 = L / 2, A = m.B('ashlarW'), U = v => v / ASH_M;
  const centres = arches === 1 ? [0] : [-(span + pier) / 2, (span + pier) / 2];
  const under = z => { for (const c of centres) { const d = Math.abs(z - c) / (span / 2); if (d < 1) return base + Math.sqrt(1 - d * d) * (crown(c) - base); } return foot; };
  // The two faces, cut by the arches; the barrel underneath
  const N = L * 4;
  for (const s of [-1, 1]) for (let i = 0; i < N; i++) {
    const z0 = lerp(Z0, Z1, i / N), z1 = lerp(Z0, Z1, (i + 1) / N), u0 = Math.min(under(z0), deck(z0) - 0.3), u1 = Math.min(under(z1), deck(z1) - 0.3), zm = (z0 + z1) / 2, um = under(zm);
    A.quadN([s * W, um === foot ? foot : u0, z0], [s * W, um === foot ? foot : u1, z1], [s * W, deck(z1), z1], [s * W, deck(z0), z0], [s, 0, 0], [[U(z0), U(um === foot ? foot : u0)], [U(z1), U(um === foot ? foot : u1)], [U(z1), U(deck(z1))], [U(z0), U(deck(z0))]]);
  }
  for (const c of centres) {
    const M = 18, P = a => [c + Math.cos(a) * span / 2, base + Math.sin(a) * (crown(c) - base)];
    for (let i = 0; i < M; i++) { const a0 = Math.PI * i / M, a1 = Math.PI * (i + 1) / M, p = P(a0), q = P(a1), n2 = [0, -Math.sin((a0 + a1) / 2), -Math.cos((a0 + a1) / 2)]; A.quadN([-W, p[1], p[0]], [W, p[1], p[0]], [W, q[1], q[0]], [-W, q[1], q[0]], n2, [[0, U(i * 0.4)], [U(2 * W), U(i * 0.4)], [U(2 * W), U(i * 0.4 + 0.4)], [0, U(i * 0.4 + 0.4)]]);
      // (its ring of voussoirs, standing out a little)
      for (const s of [-1, 1]) { const k = 0.27, o = (a, r) => [c + Math.cos(a) * (span / 2 + r), base + Math.sin(a) * (crown(c) - base + r)], g = 0.012, a = o(a0 + g, 0), b = o(a1 - g, 0), cc = o(a1 - g, k), d = o(a0 + g, k), x = s * (W + 0.035); m.B('ashlarV').quadN([x, a[1], a[0]], [x, b[1], b[0]], [x, cc[1], cc[0]], [x, d[1], d[0]], [s, 0, 0], [[0.12 + (i % 3) * 0.2, 0.03], [0.12 + (i % 3) * 0.2, 0.13], [0.24 + (i % 3) * 0.2, 0.13], [0.24 + (i % 3) * 0.2, 0.03]]); for (const [e, f, nn] of [[d, cc, 1], [a, b, -1]]) m.B('ashlarV').quadN([x, e[1], e[0]], [x, f[1], f[0]], [s * W, f[1], f[0]], [s * W, e[1], e[0]], [0, nn * Math.sin(a0), nn * Math.cos(a0)], [[0, 0], [0.1, 0], [0.1, 0.02], [0, 0.02]]); } }
  }
  for (const [z, d] of [[Z0, -1], [Z1, 1]]) A.quadN([-W, foot, z], [W, foot, z], [W, deck(z), z], [-W, deck(z), z], [0, 0, d], [[0, 0], [U(2 * W), 0], [U(2 * W), 1], [0, 1]]);
  // The way over it, and the parapets with their coping
  sheet(m.B('floor_piedra'), (u, v) => { const z = lerp(Z0, Z1, v); return [lerp(-W + 0.1, W - 0.1, u), deck(z) + 0.004, z]; }, 1, 16, { uv: (u, v) => [u * 3, v * L], flip: true });
  for (const s of [-1, 1]) for (let i = 0; i < L; i++) {
    const z0 = Z0 + i, z1 = z0 + 1, y0 = deck(z0), y1 = deck(z1), x0 = s * (W - 0.3), x1 = s * W, h = 0.62, C = m.B('ashlarV');
    A.quadN([x0, y0 - 0.02, z0], [x0, y1 - 0.02, z1], [x0, y1 + h, z1], [x0, y0 + h, z0], [-s, 0, 0], [[U(z0), 0], [U(z1), 0], [U(z1), U(h)], [U(z0), U(h)]]);
    A.quadN([x1, y0 - 0.1, z0], [x1, y1 - 0.1, z1], [x1, y1 + h, z1], [x1, y0 + h, z0], [s, 0, 0], [[U(z0), 0.2], [U(z1), 0.2], [U(z1), 0.2 + U(h)], [U(z0), 0.2 + U(h)]]);
    const a0 = s * (W - 0.36), a1 = s * (W + 0.06), g = 0.008, q = 0.13, b = (z, y) => [[a0, y + h, z], [a1, y + h, z], [a1, y + h + q, z], [a0, y + h + q, z]], p = b(z0 + g, y0), r = b(z1 - g, y1), uv = [[i * 0.21, 0.02], [i * 0.21 + 0.2, 0.02], [i * 0.21 + 0.2, 0.14], [i * 0.21, 0.14]];
    C.quadN(p[3], p[2], r[2], r[3], [0, 1, 0], uv); C.quadN(p[0], r[0], r[3], p[3], [-s, 0, 0], uv); C.quadN(p[1], r[1], r[2], p[2], [s, 0, 0], uv); C.quadN(p[0], p[1], p[2], p[3], [0, 0, -1], uv); C.quadN(r[0], r[1], r[2], r[3], [0, 0, 1], uv); C.quadN(p[0], p[1], r[1], r[0], [0, -1, 0], uv);
  }
  for (const s of [-1, 1]) for (const z of [Z0, Z1]) m.box('ashlarV', s * (W - 0.15) - 0.28, -0.6, z - 0.28, s * (W - 0.15) + 0.28, deck(z) + 0.86, z + 0.28, ASH_M).box('ashlarV', s * (W - 0.15) - 0.33, deck(z) + 0.86, z - 0.33, s * (W - 0.15) + 0.33, deck(z) + 0.98, z + 0.33, ASH_M);
  // (cutwaters on the pier between two arches)
  if (arches === 2) for (const s of [-1, 1]) { const x = s * (W + 0.75), y = 0.1; for (const q of [-1, 1]) A.quadN([s * W, foot, q * pier / 2], [x, foot, 0], [x, y - 0.25, 0], [s * W, y, q * pier / 2], [s * 0.5, 0, q * 0.85], [[0, 0], [0.4, 0], [0.4, 0.9], [0, 1]]); A.quadN([s * W, y, -pier / 2], [x, y - 0.25, 0], [s * W, y, pier / 2], [s * W, y + 0.25, 0], [0, 1, 0], [[0, 0], [0.3, 0], [0.3, 0.3], [0, 0.3]]); }
  m.solids = [[-W, 0, Z0, -W + 0.3, 1.3, Z1], [W - 0.3, 0, Z0, W, 1.3, Z1]];
}

// ---------- getModel's table ----------
export const KIT = {
  tent, campfire, beached, tower_dress: towerDress, spring, salt_lick: saltLick, stone_bridge: stoneBridge,
  ...PROPS,
};
