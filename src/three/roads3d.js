// What the roads have that is built (docs/planes/realismo/PLAN-R7-mundo.md §3.7): the timber bridge and the arms of the signposts. The
// roads themselves are only painted on the ground (world/ground.js).
//   timber_bridge:L        a plank bridge L tiles long (5, 7, 9 or 11), along z, on trestles of logs
//   signs:deg=name=km|…    a post with up to four arms: where each points (degrees from +z) and what it says
import * as THREE from 'three';
import { rod, beam, pebble, addB } from './places3d.js';
import { Builder, mat } from './geo.js';
import { rng } from './textures.js';
import { timberY, TIMBER_W } from '../world/hamlets.js';

function timberBridge(m, n = '7') {
  const L = +n || 7, W = TIMBER_W, R = rng(90 + L), Z0 = -L / 2, Z1 = L / 2, deck = z => timberY(z, L), flat = deck(0);
  // The trestles: two piles leaning in a little, their cap, and the braces crossed between them
  const bents = L <= 5 ? [0] : L <= 7 ? [-1.2, 1.2] : L <= 9 ? [-2.2, 0, 2.2] : [-3.3, -1.1, 1.1, 3.3];
  for (const z of bents) {
    for (const s of [-1, 1]) rod(m, 'logBark', [s * 1.18, -2.3, z], [s * 1.02, flat - 0.3, z], 0.125, 0.115, 9);
    rod(m, 'logBark', [-W - 0.12, flat - 0.28, z], [W + 0.12, flat - 0.27, z], 0.115, 0.105, 9);
    for (const s of [-1, 1]) m.geo('logEnd', END, s * (W + 0.122), flat - 0.275, z, [0, s * Math.PI / 2, 0], [0.108, 0.108, 1]);
    for (const s of [-1, 1]) beam(m, 'oldWood', [s * 1.06, flat - 0.42, z + s * 0.13], [-s * 1.1, -0.75, z + s * 0.13], 0.1, 0.045, [0, 0, 1], 0.006, false);
  }
  // The sills on the banks, the three stringers (logs) and the boards across, no two alike
  for (const s of [-1, 1]) { rod(m, 'logBark', [-W - 0.05, -0.02, s * (Z1 - 0.95)], [W + 0.05, -0.02, s * (Z1 - 0.95)], 0.14, 0.13, 9); for (let i = 0; i < 7; i++) pebble(m, 'crag', (i - 3) * 0.46 + (R() - 0.5) * 0.2, -0.03, s * (Z1 - 0.62 + R() * 0.25), 0.2 + R() * 0.12, 0.11, 0.16, i, [0, R() * 6, 0]); }
  for (const x of [-0.95, 0, 0.95]) rod(m, 'logBark', [x, flat - 0.16, -Z1 + 0.7], [x, flat - 0.16, Z1 - 0.7], 0.11, 0.1, 8);
  for (let z = Z0 + 0.1, i = 0; z < Z1 - 0.16; i++) {
    const w = 0.17 + R() * 0.07, z1 = Math.min(z + w, Z1 - 0.06), x0 = -W + (R() - 0.5) * 0.09, x1 = W + (R() - 0.5) * 0.09, zm = (z + z1) / 2, y = deck(zm) + (R() - 0.5) * 0.008, tilt = (deck(z1) - deck(z)) / (z1 - z || 1);
    beam(m, R() < 0.35 ? 'plankGrey' : 'oldWood', [x0, y - 0.03, zm], [x1, y - 0.03 + (R() - 0.5) * 0.006, zm], z1 - z, 0.06, [0, -tilt, 1], 0.006, false);
    z = z1 + 0.012 + R() * 0.012;
  }
  // The kerbs, the posts of the rail and its two poles
  const posts = []; for (let z = -(L / 2 - 1.0); z <= L / 2 - 0.95; z += (L - 2) / Math.max(2, Math.round((L - 2) / 1.7))) posts.push(z);
  for (const s of [-1, 1]) {
    beam(m, 'oldWood', [s * (W - 0.09), flat + 0.05, -Z1 + 1.0], [s * (W - 0.09), flat + 0.05, Z1 - 1.0], 0.13, 0.11, [0, 1, 0], 0.01, false);
    for (const z of posts) { rod(m, 'oldWood', [s * (W - 0.02), flat - 0.42, z], [s * (W + 0.02), flat + 0.98, z], 0.062, 0.052, 7); beam(m, 'oldWood', [s * (W + 0.02), flat + 0.52, z], [s * (W + 0.34), flat - 0.2, z], 0.06, 0.05, [0, 0, 1], 0.006, false); }
    for (const [y, r] of [[0.92, 0.046], [0.48, 0.038]]) for (let i = 0; i + 1 < posts.length; i++) rod(m, 'oldWood', [s * (W - 0.0), flat + y + (R() - 0.5) * 0.04, posts[i] - 0.16], [s * (W + 0.0), flat + y + (R() - 0.5) * 0.04, posts[i + 1] + 0.16], r, r * 0.9, 7);
  }
  m.solids = [[-W - 0.06, 0, Z0 + 0.9, -W + 0.06, flat + 1, Z1 - 0.9], [W - 0.06, 0, Z0 + 0.9, W + 0.06, flat + 1, Z1 - 0.9], [-W, -0.1, Z0, W, flat, Z1]];
}
const END = new THREE.CircleGeometry(1, 12);

// ---------- the writing on the signposts ----------
// Burnt into the boards: each distinct arm has a slot of a sheet (2 × 12 of them in 1024 × 1024 px), made as they are wanted
const COLS = 2, ROWS = 12, SW = 512, SH = 80, PAGES = 5, SLOTS = new Map(), pages = [];
function page(i) {
  if (pages[i]) return pages[i];
  const c = document.createElement('canvas'); c.width = COLS * SW; c.height = 1024;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  pages[i] = { c, tex, list: [] };
  // (the letters again, once the interface's font is there)
  document.fonts?.load?.('600 40px Barlow').then(() => { for (const q of pages[i].list) write(pages[i], q); }).catch(() => {});
  return pages[i];
}
function write(P, [k, name, km]) {
  const g = P.c.getContext('2d'), x = (k % COLS) * SW, y = Math.floor(k / COLS) * SH, F = s => `600 ${s}px Barlow, "Helvetica Neue", sans-serif`;
  g.save(); g.beginPath(); g.rect(x, y, SW, SH); g.clip(); g.clearRect(x, y, SW, SH);
  // (round the letters, the same colour with no alpha: the mipmaps do not bleed another one)
  g.textBaseline = 'middle'; g.fillStyle = 'rgba(38,26,16,.94)';
  let kw = 0;
  if (km) { g.font = F(38); kw = g.measureText(km).width; g.fillText(km, x + SW - 10 - kw, y + SH / 2 + 2); }
  let s = 48;
  const room = SW - 20 - (kw ? kw + 24 : 0);
  do { g.font = F(s); s -= 2; } while (s > 24 && g.measureText(name).width > room);
  g.fillText(name, x + 8, y + SH / 2 + 2, room);
  g.restore();
  P.tex.needsUpdate = true;
}
// Where an arm's writing is: [its material, u0, v0, u1, v1], or null (no more room: a blank board)
function slotOf(name, km) {
  const key = `${name}|${km}`;
  if (SLOTS.has(key)) return SLOTS.get(key);
  const n = SLOTS.size, i = Math.floor(n / (COLS * ROWS)), k = n % (COLS * ROWS);
  if (i >= PAGES) return null;
  const P = page(i), q = [k, name, km], u0 = (k % COLS) / COLS, y = Math.floor(k / COLS) * SH;
  P.list.push(q); write(P, q);
  const out = [`signText${i}`, u0 + 2 / 1024, 1 - (y + SH - 2) / 1024, u0 + 1 / COLS - 2 / 1024, 1 - (y + 2) / 1024];
  SLOTS.set(key, out);
  return out;
}
export const signSlots = () => ({ used: SLOTS.size, pages: pages.filter(Boolean).length });
export const ROAD_MATS = Object.fromEntries(Array.from({ length: PAGES }, (_, i) => [`signText${i}`, () => mat({ map: page(i).tex, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })]));

function signs(m, spec = '') {
  const arms = spec ? spec.split('|').slice(0, 4).map(q => q.split('=')) : [], H = 1.72 + Math.max(2, arms.length) * 0.29;
  rod(m, 'oldWood', [0, -0.2, 0], [0.02, H, 0], 0.082, 0.066, 8); m.geo('oldWood', new THREE.ConeGeometry(0.09, 0.15, 8), 0.02, H + 0.07, 0);
  for (let i = 0; i < 5; i++) pebble(m, 'crag', Math.cos(i * 1.3) * 0.18, 0.04, Math.sin(i * 1.3) * 0.18, 0.13, 0.1, 0.11, i);
  arms.forEach(([deg, name, km], i) => {
    const a = (+deg || 0) * Math.PI / 180, y = H - 0.17 - i * 0.29, M = new THREE.Matrix4().compose(new THREE.Vector3(0.018, y, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a - Math.PI / 2, ((i * 7) % 3 - 1) * 0.012)), ONE);
    const B = new Builder(), sh = new THREE.Shape([[-0.16, -0.118], [1.16, -0.118], [1.32, 0], [1.16, 0.118], [-0.16, 0.112]].map(p => new THREE.Vector2(...p)));
    B.addGeometry(new THREE.ExtrudeGeometry(sh, { depth: 0.036, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1 }), new THREE.Matrix4().makeTranslation(0, 0, 0.066));
    addB(m, i % 2 ? 'oldWood' : 'plankGrey', B, M);
    const N = new Builder(); for (const [x, yy] of [[-0.06, 0.05], [0.06, -0.05], [0.06, 0.05], [-0.06, -0.05]]) N.box(x - 0.011, yy - 0.011, 0.104, x + 0.011, yy + 0.011, 0.114); addB(m, 'iron', N, M);
    const s = name ? slotOf(name, km) : null;
    if (!s) return;
    const [key, u0, v0, u1, v1] = s, C = new Builder(), x0 = 0.1, x1 = 1.17, h = (x1 - x0) * SH / SW / 2;
    C.quad([x0, -h, 0.1105], [x1, -h, 0.1105], [x1, h, 0.1105], [x0, h, 0.1105], [0, 0, 1], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
    C.quad([x1, -h, 0.0575], [x0, -h, 0.0575], [x0, h, 0.0575], [x1, h, 0.0575], [0, 0, -1], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
    addB(m, key, C, M);
  });
  m.solids = [[-0.1, 0, -0.1, 0.1, H, 0.1]];
}
const ONE = new THREE.Vector3(1, 1, 1);

export const ROAD_KIT = { timber_bridge: timberBridge, signs };
