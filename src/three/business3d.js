// What is drawn of the players' businesses besides their furniture (shop3d.js): the goods on the counters, shelves and crates near
// the player and the slate that says whose it is and whether it is open. Each piece of furniture is one mesh (its goods, merged,
// with their colours in the vertices) made again only when what it shows changes; at most MAX of them, within FAR
import * as THREE from 'three';
import { SLOTS, SLATE, CRATE_TILT } from './shop3d.js';
import { dropModel } from './icons.js';
import { paint, mergeParts, mat } from './geo.js';
import { foodModel, hasFood } from './food3d.js';
import { apagado } from '../arte.js';
import { itemIcon } from '../art/items.js';
import { ITEMS } from '../items.js';
import { COUNTER, CRATE } from '../business.js';
import { CHUNK } from '../world/gen.js';
import { apagada } from '../opciones.js';
import { t, getLang } from '../i18n.js';

const FAR = 26, MAX = 14, SLOW = 0.4;   // tiles; pieces of furniture; s between two looks
const TRIS = 4600;                       // triangles a lot takes, at most (its copies)
const seenOf = n => (n >= 20 ? 8 : n >= 10 ? 7 : n >= 6 ? 5 : n >= 3 ? 3 : n);
let GOODS = null, CARD = null;
const goodsMat = () => (GOODS ||= mat({ vertexColors: true, roughness: 0.7 }));
const cardGeo = () => (CARD ||= new THREE.PlaneGeometry(1, 1));

// The mean colour of a texture (its picture drawn in one pixel), kept
const MEAN = new WeakMap();
function meanOf(map) {
  let c = MEAN.get(map);
  if (c) return c;
  c = new THREE.Color(0.55, 0.42, 0.3);
  try {
    const cv = document.createElement('canvas'); cv.width = cv.height = 4;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(map.image, 0, 0, 4, 4);
    const d = g.getImageData(0, 0, 4, 4).data; let r = 0, v = 0, b = 0;
    for (let i = 0; i < 64; i += 4) { r += d[i]; v += d[i + 1]; b += d[i + 2]; }
    c.setRGB(r / 4080, v / 4080, b / 4080, THREE.SRGBColorSpace);
  } catch { /* (not drawn yet: wood) */ }
  MEAN.set(map, c);
  return c;
}
// What has no model of its own (ore, cloth, clothes, seeds…), in its colour: lumps, bars, a ball of wool, a folded piece; the rest, a
// little sack with the thing's picture in front
const ROUGH = { carbon: '#2b2a2c', cobre: '#a8683c', hierro: '#8f8378', oro: '#cfa640', amatista: '#8850b8', esmeralda: '#2f8f58', rubi: '#a52c3c', diamante: '#c8dde4', piedra: '#8f8a82', sal: '#e6e2d8', salt: '#e6e2d8' };
const BARS = { lingote_cobre: '#b0703e', lingote_hierro: '#8d8f92', lingote_oro: '#d2aa44' }, WOOL = { lana: '#e6e0d2', lana_fina: '#f0ece2', angora: '#e9dfd6', plumas: '#e8e6e0' }, FOLDED = { tela: '#d8cdb8', cuero: '#8a5c38', piel: '#a07a52' };
const tone = c => new THREE.Color(apagado(c));
function made(id) {
  const parts = [], put = (g, c, x = 0, y = 0, z = 0) => parts.push(paint(g.translate(x, y, z), c));
  if (ROUGH[id]) { const c = tone(ROUGH[id]); [[0, 0, 0.05], [-0.09, 0.02, 0.04], [0.09, -0.04, 0.045], [0.01, 0.1, 0.035], [0.02, -0.1, 0.032]].forEach(([x, z, r], i) => put(new THREE.IcosahedronGeometry(r, 0).rotateX(i * 1.3).rotateY(i * 2.1), c.clone().multiplyScalar(0.9 + 0.05 * i), x, r * 0.8, z)); }
  else if (BARS[id]) { const c = tone(BARS[id]); [[0, 0], [1, 0], [0.5, 1]].forEach(([k, l]) => { const g = new THREE.CylinderGeometry(0.034, 0.05, 0.05, 4, 1).rotateY(Math.PI / 4).scale(3, 1, 1); put(g, c, 0, 0.026 + l * 0.052, (k - 0.5) * 0.085); }); }
  else if (WOOL[id]) { const c = tone(WOOL[id]); for (let i = 0; i < 9; i++) { const a = i * 2.4, r = i ? 0.07 : 0; put(new THREE.IcosahedronGeometry(0.062, 1), c.clone().multiplyScalar(0.93 + (i % 3) * 0.035), Math.cos(a) * r, 0.062 + (i % 3) * 0.045, Math.sin(a) * r); } }
  else if (FOLDED[id] || ITEMS[id].wear) { const c = tone(FOLDED[id] || ITEMS[id].dye || '#8a6a4a'); for (let i = 0; i < 3; i++) put(new THREE.BoxGeometry(0.25 - i * 0.008, 0.035, 0.18 - i * 0.006), c.clone().multiplyScalar(1 - i * 0.07), 0, 0.018 + i * 0.037, 0); }
  else return null;
  return mergeParts(parts);
}
const sack = () => mergeParts([
  paint(new THREE.LatheGeometry([[0, 0], [0.075, 0.005], [0.095, 0.035], [0.09, 0.09], [0.055, 0.13], [0.028, 0.145], [0.045, 0.172], [0.036, 0.18]].map(([x, y]) => new THREE.Vector2(x, y)), 14), tone('#8c7b5a')),
  paint(new THREE.TorusGeometry(0.03, 0.006, 6, 14).rotateX(Math.PI / 2).translate(0, 0.146, 0), tone('#5e4a30'))]);
// One of an item as a single geometry with its colours, at its size, resting on y = 0: { geo, w, h, d, long, card, tris }. Kept
const ONE = new Map();
function oneOf(id) {
  let e = ONE.get(id);
  if (e) return e;
  let geo = made(id), card = false;
  if (!geo) {
    const food = hasFood(id), g = food ? foodModel(id) : dropModel(id), parts = [];
    if (g) {
      g.updateMatrixWorld(true);
      g.traverse(o => {
        if (!o.isMesh || !o.geometry?.attributes.position || Array.isArray(o.material)) return;
        const q = o.geometry.clone().applyMatrix4(o.matrixWorld), m = o.material, c = m.color ? m.color.clone() : new THREE.Color(1, 1, 1);
        if (!q.attributes.normal) q.computeVertexNormals();
        if (m.map) c.multiply(meanOf(m.map));
        if (m.transparent && m.opacity < 0.6) c.lerp(new THREE.Color(0.75, 0.8, 0.8), 0.4);
        parts.push(paint(q, c));
      });
    }
    if (parts.length) geo = mergeParts(parts); else { geo = sack(); card = true; }
  }
  geo.computeBoundingBox();
  let b = geo.boundingBox;
  // (a fish, a carrot: lying along x)
  if (b.max.z - b.min.z > (b.max.x - b.min.x) * 1.4) { geo.rotateY(Math.PI / 2); geo.computeBoundingBox(); b = geo.boundingBox; }
  if (b.max.y - b.min.y > Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * 2.2 && !ITEMS[id].drink && !card) { geo.rotateZ(Math.PI / 2); geo.computeBoundingBox(); b = geo.boundingBox; }
  const w = b.max.x - b.min.x, h = b.max.y - b.min.y, d = b.max.z - b.min.z;
  geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  ONE.set(id, e = { geo, w, h, d, card, tris: geo.index.count / 3, heap: !card && !ROUGH[id] && !BARS[id] && !WOOL[id] });
  return e;
}
// Copies of them, [geometry, matrix, scale], in one geometry
const V3 = new THREE.Vector3(), TILT = new THREE.Matrix4();
function bake(parts) {
  let nv = 0, ni = 0;
  for (const [g] of parts) { nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), idx = new Uint32Array(ni);
  let v = 0, q = 0;
  for (const [g, m, k] of parts) {
    const P = g.attributes.position.array, N = g.attributes.normal.array, I = g.index.array, e = m.elements, n = P.length;
    for (let i = 0, o = v * 3; i < n; i += 3, o += 3) {
      const x = P[i], y = P[i + 1], z = P[i + 2], a = N[i], b = N[i + 1], c = N[i + 2];
      pos[o] = e[0] * x + e[4] * y + e[8] * z + e[12]; pos[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; pos[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      nor[o] = (e[0] * a + e[4] * b + e[8] * c) / k; nor[o + 1] = (e[1] * a + e[5] * b + e[9] * c) / k; nor[o + 2] = (e[2] * a + e[6] * b + e[10] * c) / k;
    }
    col.set(g.attributes.color.array, v * 3);
    for (let i = 0; i < I.length; i++) idx[q + i] = I[i] + v;
    v += n / 3; q += I.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1)); out.computeBoundingSphere();
  return out;
}
// Where n of them lie in a place of that size: [x, y, z, turn], in rows and then one on another (the round ones in the gaps)
function heap(E, n, size, k) {
  const out = [], w = E.w * k * 1.04, d = E.d * k * 1.04, cols = Math.max(1, Math.min(3, Math.floor(size / w))), rows = Math.max(1, Math.min(3, Math.floor(size / d))), base = Math.min(n, cols * rows);
  for (let i = 0; i < base; i++) {
    const r = Math.floor(i / cols), inRow = Math.min(cols, base - r * cols), c = i % cols;
    out.push([(c - (inRow - 1) / 2) * w, 0, ((Math.ceil(base / cols) - 1) / 2 - r) * d, ((i * 37) % 11 - 5) * 0.035]);
  }
  const round = Math.abs(E.w - E.d) < E.w * 0.35 && E.h > E.w * 0.6;
  for (let i = base; i < n && i < base + Math.max(1, (cols - 1) * Math.max(1, rows - 1)) && base > 1; i++) { const j = i - base; out.push([((j % Math.max(1, cols - 1)) - (Math.max(1, cols - 1) - 1) / 2) * w, E.h * k * (round ? 0.8 : 0.98), rows > 1 ? (Math.floor(j / Math.max(1, cols - 1)) - (rows - 2) / 2) * -d : 0, ((i * 53) % 11 - 5) * 0.05]); }
  return out;
}

export class BusinessView {
  constructor(view) {
    this.view = view;
    this.group = new THREE.Group();
    view.scene.add(this.group);
    this.on = !apagada('shops');
    this.pieces = new Map();   // tile → { group, sig, mesh, cards, slate }
    this.slow = 0;
    this.slates = [];          // those not in use now
    this.icons = new Map();    // item → its card's material
  }
  clear() { for (const k of [...this.pieces.keys()]) this.drop(k); }
  drop(k) {
    const e = this.pieces.get(k);
    if (!e) return;
    this.group.remove(e.group);
    e.mesh?.geometry.dispose();
    if (e.slate) { e.group.remove(e.slate.mesh); this.slates.push(e.slate); }   // (kept for another: its material may be being compiled)
    this.pieces.delete(k);
  }
  update(game, scene, dt) {
    const B = game.business, p = game.player;
    if (!this.on || !B?.shops.size || !p || scene !== game.world) { if (this.pieces.size) this.clear(); return; }
    if ((this.slow -= dt) > 0) return;
    this.slow = SLOW;
    const want = new Map();
    for (const { key, rec } of B.list()) {
      const C = B.counter(key);
      if (!C || Math.hypot(C.x - p.x, C.y - p.y) > FAR + 8) continue;
      for (const e of B.shown(key)) {
        const o = this.object(scene, e.tile);
        if (o && Math.hypot(o.x - p.x, o.y - p.y) < FAR) want.set(e.tile, { o, lots: e.lots, key: e.tile === key ? key : null, rec });
      }
      if (want.size > MAX) break;
    }
    for (const k of [...this.pieces.keys()]) if (!want.has(k)) this.drop(k);
    // (one made a frame)
    for (const [tile, w] of want) if (this.piece(game, scene, tile, w, B)) { this.slow = 0.02; break; }
  }
  // What stands on a tile, as the world draws it
  object(scene, tile) {
    const [tx, ty] = tile.split(',').map(Number), c = scene.contentFor(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK));
    return c.objects.find(o => o.tile && o.tile[0] === tx && o.tile[1] === ty && SLOTS[o.placed]) || null;
  }
  piece(game, scene, tile, { o, lots, key, rec }, B) {
    const sig = `${o.placed}|${o.x.toFixed(2)},${o.y.toFixed(2)},${(o.yaw || 0).toFixed(2)}|${lots.map(s => s.id + seenOf(s.n) + (s.color || '')).join()}`;
    let e = this.pieces.get(tile);
    const fresh = !e || e.sig !== sig;
    if (fresh) {
      this.drop(tile);
      e = { group: new THREE.Group(), sig, mesh: null, slate: null };
      e.group.position.set(o.x, this.view.groundY(scene, o.x, o.y) + (o.lift || 0), o.y);
      e.group.rotation.y = o.yaw || 0;
      this.fill(e, o.placed, lots);
      this.group.add(e.group);
      this.pieces.set(tile, e);
    }
    if (key && o.placed === COUNTER) this.slate(e, B, key, rec);
    return fresh;
  }
  fill(e, id, lots) {
    const parts = [], tilt = id === CRATE ? CRATE_TILT : 0;
    lots.forEach((s, i) => {
      const slot = SLOTS[id][i];
      if (!slot || !ITEMS[s.id]) return;
      const [x, y, z, size] = slot, E = oneOf(s.id), k = Math.min(1.12, size * 0.98 / Math.max(E.w, E.d), 0.32 / E.h), n = E.heap ? Math.max(Math.min(3, seenOf(s.n)), Math.min(seenOf(s.n), Math.floor(TRIS / E.tris))) : 1;
      for (const [hx, hy, hz, turn] of heap(E, n, size, k)) {
        const m = new THREE.Matrix4().makeRotationY(turn).scale(V3.set(k, k, k)).setPosition(hx, hy, hz);
        if (tilt) m.premultiply(TILT.makeRotationX(tilt));
        m.elements[12] += x; m.elements[13] += y; m.elements[14] += z;
        parts.push([E.geo, m, k]);
      }
      if (E.card) { const c = new THREE.Mesh(cardGeo(), this.cardMat(s.id)); c.position.set(x, y + E.h * k * 0.45, z + E.d * k * 0.56); c.scale.setScalar(E.h * k * 0.62); if (tilt) c.position.y += 0.02; e.group.add(c); }
    });
    if (!parts.length) return;
    e.mesh = new THREE.Mesh(bake(parts), goodsMat());
    e.mesh.castShadow = false; e.mesh.receiveShadow = true;
    e.group.add(e.mesh);
  }
  cardMat(id) {
    let m = this.icons.get(id);
    if (!m) { const tex = new THREE.CanvasTexture(itemIcon(id)); tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = THREE.NearestFilter; this.icons.set(id, m = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.4, roughness: 0.9, side: THREE.DoubleSide })); }
    return m;
  }
  // The slate on the counter: whose it is, and open or closed with its hours
  slate(e, B, key, rec) {
    const open = B.isOpen(rec), name = B.nameOf(rec), text = `${name}|${open}|${rec.hours}|${getLang()}`;
    const S = (e.slate ||= this.slates.pop() || this.makeSlate());
    if (S.mesh.parent !== e.group) e.group.add(S.mesh);
    if (S.text === text) return;
    S.text = text;
    const g = S.g, w = 256, h = 176;
    g.fillStyle = '#2b302f'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.035)'; for (let i = 0; i < 26; i++) g.fillRect((i * 97) % w, (i * 53) % h, 40 + (i * 31) % 70, 2);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#e9e4d8'; g.font = '600 30px Georgia, serif'; g.fillText(name, w / 2, 44, w - 26);
    g.strokeStyle = 'rgba(233,228,216,.5)'; g.lineWidth = 2; g.beginPath(); g.moveTo(34, 72); g.lineTo(w - 34, 72); g.stroke();
    g.fillStyle = open ? '#b9dba2' : '#e0a58c'; g.font = 'bold 46px Georgia, serif'; g.fillText(t(open ? 'biz.slate.open' : 'biz.slate.closed'), w / 2, 108, w - 26);
    g.fillStyle = '#cfc9bb'; g.font = 'italic 24px Georgia, serif'; g.fillText(t(`biz.slate.${rec.hours}`), w / 2, 150, w - 26);
    S.tex.needsUpdate = true;
  }
  makeSlate() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 176;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const wood = mat({ color: '#7a5a3a', roughness: 0.8 }), face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.018), [wood, wood, wood, wood, face, wood]);
    mesh.position.set(SLATE[0], SLATE[1] + 0.115, SLATE[2]); mesh.rotation.x = -0.24; mesh.castShadow = true;
    return { g: c.getContext('2d'), tex, mesh, text: '' };
  }
}
