// The nature book's drawings (docs/planes/gta/PLAN-G-caza.md §4.3, step 1 for phase G-1): each species' own 3D model
// (nature.js SPECIES model()) rendered in the shared icon renderer (icons.js offscreenJob: no second WebGL context),
// toned sepia on cream paper on a 2D canvas, and its level-0 silhouette from the same render. Insects: their pixel icon
// scaled up as a pinned specimen. Kept as JPEG data URLs in a Map for the session, never saved. The ink filter
// (posterize, wash, Sobel lines) is step 2, phase G-2.
//
// Contract:
//   plateUrl(id, level) → data URL | null   level 0: the silhouette; 1–3: the drawing. null: not drawn yet (it is queued,
//                                           the last asked first) or no view (the world server) or it could not be drawn
//   pumpPlates()                            one short step of the species being drawn (its model, its programs, the drawing,
//                                           its pixels, the toning, its two plates): the book calls it every other frame
//                                           while the Nature tab is visible, so no step holds the game up
//   onPlate(fn) → off()                     fn(id, level) when a plate is ready, once for level 0 and once for level 1
//                                           (the page swaps its placeholder: ask plateUrl again)
import * as THREE from 'three';
import { offscreenJob } from './icons.js';
import { STUDIO } from './preview.js';
import { SPECIES } from '../nature.js';
import { itemIcon } from '../art/items.js';
import { mk, rng } from '../util.js';
import { opcion } from '../opciones.js';

export const PLATE_W = 288, PLATE_H = 208;
const SS = 2;                        // rendered at twice the size and reduced, for soft edges
const QUALITY = 0.85;
const PAPER = [0xef, 0xe3, 0xc8], INK = [0x3a, 0x2a, 0x1a], LIGHT = [0xf6, 0xea, 0xcf], SIL = [0x8a, 0x7a, 0x62];
const INK_K = 0.92, SIL_K = 0.35, MARGIN = 1.14;
// (the world server has a document but no view: it never draws)
const NO_VIEW = typeof document === 'undefined' || opcion('modo') === 'servidor';

// (every canvas here is read back: on the CPU from the start, or each read waits for the card, 0.1-0.7 s on this Mac)
const ctx = c => c.getContext('2d', { willReadFrequently: true });

const listeners = new Set();
const urls = new Map();     // id → [silhouette, drawing]
const queue = [];
const failed = new Set(), again = new Set();
let job = null;             // the species being drawn: { id, gen (its steps), tries }

export function plateUrl(id, level) {
  if (NO_VIEW || !SPECIES[id]) return null;
  const u = urls.get(id);
  if (u) return u[level > 0 ? 1 : 0];
  if (failed.has(id)) return null;
  if (job?.id === id) return null;   // (being drawn)
  const i = queue.indexOf(id);
  if (i > 0) queue.splice(i, 1);
  if (i !== 0) queue.unshift(id);   // (the page just asked for comes first)
  return null;
}
export function pumpPlates() {
  if (NO_VIEW) return;
  if (!job) {
    if (!queue.length) return;
    const id = queue.shift();
    job = { id, gen: draw(id) };
  }
  const { id, gen } = job;
  let r = null;
  try { r = gen.next(); } catch (e) { console.warn('Plates: could not draw', id, e); r = { done: true, value: null }; }
  if (!r.done) return;
  job = null;
  if (!r.value) { if (again.has(id)) failed.add(id); else { again.add(id); queue.push(id); } return; }   // (the renderer may have been let go halfway: once more)
  urls.set(id, r.value);
  for (const fn of [...listeners]) for (const lvl of [0, 1]) try { fn(id, lvl); } catch (e) { console.warn('Plates: a listener failed', e); }
}
export function onPlate(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// ---------- drawing ----------
// (generators: a yield ends a step, the next one goes on in another frame. → [silhouette, drawing] or null)
function* draw(id) {
  const sp = SPECIES[id];
  return yield* (sp.group === 'bug' ? bugPlate(id) : modelPlate(sp));
}

// The studio: the light of the character creator (preview.js STUDIO), a key from the front left and above, the sky, and a
// soft fill from behind so the far side does not go black
let STAGE = null;
function stage() {
  if (STAGE) return STAGE;
  const scene = new THREE.Scene();
  const key = new THREE.DirectionalLight('#fff2dc', 2.6 * STUDIO); key.position.set(-2.5, 3, 1.5);
  const fill = new THREE.DirectionalLight('#dfe8ff', 0.9 * STUDIO); fill.position.set(2, 1.5, -2);
  scene.add(key, fill, new THREE.HemisphereLight('#e4eeff', '#7a5a3a', 1.3 * STUDIO));
  return (STAGE = { scene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 60) });
}
// The box of what is drawn, instances included (an InstancedMesh's own box is only its geometry's)
const BOX = new THREE.Box3(), B1 = new THREE.Box3(), M4 = new THREE.Matrix4();
function boxOf(root) {
  BOX.makeEmpty();
  root.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    if (o.isInstancedMesh) for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, M4); BOX.union(B1.copy(o.geometry.boundingBox).applyMatrix4(M4.premultiply(o.matrixWorld))); }
    else BOX.union(B1.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld));
  });
  return BOX;
}
function* modelPlate(sp) {
  const obj = sp.model();
  if (!obj) return null;
  yield;
  const { scene, camera } = stage(), root = new THREE.Group(), made = [...(obj.userData?.made || [])];
  root.add(obj);
  obj.traverse(o => { if (o.isInstancedMesh) made.push(o); });
  scene.add(root);
  let px = null, drawing = null;
  try {
    root.updateMatrixWorld(true);
    const box = boxOf(root);
    if (box.isEmpty()) { for (const o of made) o.dispose?.(); return null; }
    const c = box.getCenter(new THREE.Vector3()), dir = new THREE.Vector3(...sp.view).normalize();
    camera.position.copy(c).addScaledVector(dir, 25);
    camera.lookAt(c);
    camera.updateMatrixWorld(true);
    // (framed to the box's corners as the camera sees them, with the plate's proportions and some margin)
    const v = new THREE.Vector3(); let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(camera.matrixWorldInverse);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    const aspect = PLATE_W / PLATE_H, hw = Math.max((x1 - x0) / 2, (y1 - y0) / 2 * aspect) * MARGIN, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    Object.assign(camera, { left: cx - hw, right: cx + hw, top: cy + hw / aspect, bottom: cy - hw / aspect, near: 0.1, far: 60 });
    camera.updateProjectionMatrix();
    drawing = offscreenJob(scene, camera, PLATE_W * SS, PLATE_H * SS, made);
    while ((px = drawing.step()) === undefined) yield;
  } finally { drawing?.cancel(); scene.remove(root); }
  if (!px) return null;
  yield;
  return yield* compose(reduce(px), { ground: sp.group !== 'fish' });
}
// The pixels of the drawing (SS times the plate, premultiplied, bottom row first) reduced to the plate, as ImageData has them
function reduce(px) {
  const W = PLATE_W * SS, n = SS * SS, out = new Uint8ClampedArray(PLATE_W * PLATE_H * 4);
  for (let y = 0, o = 0; y < PLATE_H; y++) for (let x = 0; x < PLATE_W; x++, o += 4) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let j = 0; j < SS; j++) for (let i = 0, q = ((PLATE_H * SS - 1 - y * SS - j) * W + x * SS) * 4; i < SS; i++, q += 4) { r += px[q]; g += px[q + 1]; b += px[q + 2]; a += px[q + 3]; }
    if (!a) continue;
    out[o] = r * 255 / a; out[o + 1] = g * 255 / a; out[o + 2] = b * 255 / a; out[o + 3] = a / n;
  }
  return out;
}
// An insect: its pixel icon (art/items.js, 16 px with a 1 px edge) at ×6, sharp, a little tilted, and a pin through it
function* bugPlate(id) {
  const icon = itemIcon(id);
  if (!icon) return null;
  const src = mk(PLATE_W, PLATE_H), g = ctx(src), k = 6, w = icon.width * k, h = icon.height * k;
  g.imageSmoothingEnabled = false;
  g.translate(PLATE_W / 2, PLATE_H / 2 + 6); g.rotate(-0.12);
  g.drawImage(icon, -w / 2, -h / 2, w, h);
  return yield* compose(g.getImageData(0, 0, PLATE_W, PLATE_H).data, { ground: false, pin: true });
}

// The paper: cream, with grain and fibres and a faint darker edge. Made once (seeded: the same every time)
let PAPER_PX = null;
function paper() {
  if (PAPER_PX) return PAPER_PX;
  const c = mk(PLATE_W, PLATE_H), g = ctx(c), r = rng(7177);
  g.fillStyle = `rgb(${PAPER})`; g.fillRect(0, 0, PLATE_W, PLATE_H);
  const img = g.getImageData(0, 0, PLATE_W, PLATE_H), d = img.data;
  for (let y = 0, i = 0; y < PLATE_H; y++) for (let x = 0; x < PLATE_W; x++, i += 4) {
    const ex = Math.min(x, PLATE_W - 1 - x) / PLATE_W, ey = Math.min(y, PLATE_H - 1 - y) / PLATE_H, edge = Math.max(0, 0.12 - Math.min(ex, ey)) * 0.6;
    const n = (r() - 0.5) * 10, f = 1 - edge;
    d[i] = (d[i] + n) * f; d[i + 1] = (d[i + 1] + n) * f; d[i + 2] = (d[i + 2] + n * 0.8) * f;
  }
  g.putImageData(img, 0, 0);
  // (fibres: short faint strokes, some darker, some lighter)
  g.lineWidth = 0.7;
  for (let i = 0; i < 170; i++) {
    const x = r() * PLATE_W, y = r() * PLATE_H, a = r() * Math.PI, l = 4 + r() * 12;
    g.strokeStyle = r() < 0.6 ? 'rgba(120,96,60,0.10)' : 'rgba(255,250,235,0.22)';
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (r() - 0.5) * 3, y + Math.sin(a) * l * 0.5 + (r() - 0.5) * 3, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  return (PAPER_PX = c);
}
// The drawing's pixels S, toned: its light read as ink on the paper (auto levels, so a white swan and a black boar both
// read), multiplied over the paper; and the silhouette (the alpha only, a faint brown) from the same pixels.
// → [silhouette, drawing] as JPEG data URLs
function* compose(S, { ground, pin }) {
  // Levels and where the drawing stands (for its ground shadow)
  let lo = 255, hi = 0, minX = PLATE_W, maxX = -1, maxY = -1;
  for (let y = 0, i = 0; y < PLATE_H; y++) for (let x = 0; x < PLATE_W; x++, i += 4) {
    if (S[i + 3] < 128) continue;
    const l = 0.299 * S[i] + 0.587 * S[i + 1] + 0.114 * S[i + 2];
    if (l < lo) lo = l; if (l > hi) hi = l;
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  if (maxX < 0) return null;   // (nothing drawn)
  const span = Math.max(40, hi - lo);
  const bg = ctx(mk(PLATE_W, PLATE_H));
  bg.drawImage(paper(), 0, 0);
  if (ground) {   // (a soft wash of shadow under its feet)
    const cx = (minX + maxX) / 2, rx = (maxX - minX) * 0.42, ry = Math.max(4, rx * 0.12), grd = bg.createRadialGradient(cx, maxY, 0, cx, maxY, rx);
    grd.addColorStop(0, 'rgba(110,86,52,0.32)'); grd.addColorStop(1, 'rgba(110,86,52,0)');
    bg.save(); bg.translate(cx, maxY); bg.scale(1, ry / rx); bg.translate(-cx, -maxY);
    bg.fillStyle = grd; bg.beginPath(); bg.arc(cx, maxY, rx, 0, Math.PI * 2); bg.fill(); bg.restore();
  }
  const P = bg.getImageData(0, 0, PLATE_W, PLATE_H), tone = bg.createImageData(PLATE_W, PLATE_H), sil = bg.createImageData(PLATE_W, PLATE_H);
  const p = P.data, T = tone.data, L = sil.data;
  for (let i = 0; i < p.length; i += 4) {
    const a = S[i + 3] / 255;
    let l = ((0.299 * S[i] + 0.587 * S[i + 1] + 0.114 * S[i + 2]) - lo) / span;
    l = Math.max(0, Math.min(1, l)) ** 0.85;
    const ink = INK_K * a, s = SIL_K * a;
    for (let c = 0; c < 3; c++) {
      const tc = (INK[c] + (LIGHT[c] - INK[c]) * l) / 255;   // (the tone, multiplied over the paper)
      T[i + c] = p[i + c] * (1 - ink + ink * tc);
      L[i + c] = p[i + c] * (1 - s) + SIL[c] * s;
    }
    T[i + 3] = L[i + 3] = 255;
  }
  const out = [];
  for (const img of [sil, tone]) {
    yield;
    const c = mk(PLATE_W, PLATE_H), g = ctx(c);
    g.putImageData(img, 0, 0);
    // (a thin ruled frame, like a plate in an old book)
    g.strokeStyle = 'rgba(58,42,26,0.35)'; g.lineWidth = 1; g.strokeRect(7.5, 7.5, PLATE_W - 15, PLATE_H - 15);
    if (pin && img === tone) drawPin(g, PLATE_W / 2 + 2, PLATE_H / 2 - 4);
    out.push(c.toDataURL('image/jpeg', QUALITY));
  }
  return out;
}
// The specimen pin: a steel shaft into the body and a round dark head with a glint, and its shadow on the paper
function drawPin(g, x, y) {
  const hx = x - 10, hy = y - 26;
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(90,70,45,0.25)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x + 4, y + 3); g.lineTo(hx + 9, hy + 5); g.stroke();
  g.strokeStyle = '#7a7468'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x, y); g.lineTo(hx, hy); g.stroke();
  const grd = g.createRadialGradient(hx - 1.5, hy - 1.5, 0.5, hx, hy, 5);
  grd.addColorStop(0, '#c8a070'); grd.addColorStop(0.4, '#6a3a22'); grd.addColorStop(1, '#2a1610');
  g.fillStyle = grd; g.beginPath(); g.arc(hx, hy, 4.5, 0, Math.PI * 2); g.fill();
}
