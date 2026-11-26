// The models of the table games (docs/planes/gta/PLAN-I-juntos.md §5): the cup with its dice, the box of tiles and the game table.
// What is drawn on the tables: tg3d.js
import * as THREE from 'three';

const lathe = pts => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 24);
// The leather cup with its three dice (big: the icon and the hand)
export function cupModel(m, k = 1) {
  m.geo('leather', lathe([[0, 0], [0.042, 0], [0.045, 0.006], [0.051, 0.1], [0.055, 0.104], [0.052, 0.108], [0.046, 0.104], [0.04, 0.012], [0, 0.01]].map(([a, b]) => [a * k, b * k])), 0, 0, 0);
  for (const y of [0.02, 0.085]) m.geo('leatherD', new THREE.TorusGeometry((y > 0.05 ? 0.051 : 0.0465) * k, 0.0026 * k, 6, 24), 0, y * k, 0, [Math.PI / 2, 0, 0]);
  m.geo('leatherD', new THREE.BoxGeometry(0.004 * k, 0.1 * k, 0.012 * k), 0.049 * k, 0.052 * k, 0, [0, 0, -0.06]);
}
export function diceModel(m, k = 1) {
  cupModel(m, k);
  const d = (x, z, yaw, dots) => { const s = 0.04 * k, y = s / 2; m.geo('candle', new THREE.BoxGeometry(s, s, s, 1, 1, 1), x * k, y, z * k, [0, yaw, 0]); const c = Math.cos(yaw), n = Math.sin(yaw); for (const [a, b] of dots) m.geo('dark', new THREE.CylinderGeometry(0.0046 * k, 0.0046 * k, 0.002 * k, 10), x * k + (a * c + b * n) * s, s + 0.0004, z * k + (-a * n + b * c) * s); for (const [a, b] of dots.slice(0, 2)) m.geo('dark', new THREE.CylinderGeometry(0.0046 * k, 0.0046 * k, 0.002 * k, 10), x * k + (a * c + 0.5 * n) * s, y + b * s, z * k + (-a * n + 0.5 * c) * s, [Math.PI / 2, 0, -yaw]); };
  d(0.075, 0.05, 0.4, [[-0.25, -0.25], [0.25, 0.25], [0, 0]]); d(-0.012, 0.085, -0.3, [[-0.25, -0.25], [0.25, 0.25], [0.25, -0.25], [-0.25, 0.25], [0, 0]]); d(-0.07, 0.04, 0.9, [[-0.22, 0.22], [0.22, -0.22]]);
}
// The box of tiles, open, its lid leaning on it
export function tileBox(m, k = 1) {
  const B = (key, x0, y0, z0, x1, y1, z1) => m.box(key, x0 * k, y0 * k, z0 * k, x1 * k, y1 * k, z1 * k);
  const X = 0.105, Z = 0.075, H = 0.06, w = 0.008;
  B('wood', -X, 0, -Z, X, 0.008, Z); B('wood', -X, 0.008, -Z, X, H, -Z + w); B('wood', -X, 0.008, Z - w, X, H, Z); B('wood', -X, 0.008, -Z + w, -X + w, H, Z - w); B('wood', X - w, 0.008, -Z + w, X, H, Z - w);
  for (const x of [-X - 0.002, X - 0.006]) for (const z of [-Z - 0.002, Z - 0.006]) B('brass', x, 0, z, x + 0.008, 0.014, z + 0.008);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) B('dark', -X + w + 0.004 + i * 0.0465, 0.01, -Z + w + 0.003 + j * 0.063, -X + w + 0.046 + i * 0.0465, 0.05, -Z + w + 0.061 + j * 0.063);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) for (const q of [-0.014, 0.014]) m.geo('candle', new THREE.CylinderGeometry(0.0034 * k, 0.0034 * k, 0.0012 * k, 8), (-X + w + 0.025 + i * 0.0465) * k, 0.0504 * k, (-Z + w + 0.032 + j * 0.063 + q) * k);
  m.geo('wood', new THREE.BoxGeometry(0.212 * k, 0.15 * k, 0.009 * k), 0, 0.07 * k, (-Z - 0.034) * k, [-0.32, 0, 0]);
  m.geo('brass', new THREE.BoxGeometry(0.05 * k, 0.022 * k, 0.003 * k), 0, 0.085 * k, (-Z - 0.022) * k, [-0.32, 0, 0]);
}
// The game table: baize within a raised rim, turned legs and a drawer on two sides. 1 × 1 tile, a chair on each side
export function gameTable(m) {
  const A = 0.47, R = 0.055, H = 0.8;
  m.box('wood', -A, H - 0.075, -A, A, H - 0.012, A);
  m.box('baize', -A + R, H - 0.012, -A + R, A - R, H, A - R);
  for (const s of [-1, 1]) { m.box('dark', s > 0 ? A - R : -A - 0.012, H - 0.03, -A - 0.012, s > 0 ? A + 0.012 : -A + R, H + 0.016, A + 0.012, 0.5); m.box('dark', -A + R - 0.002, H - 0.03, s > 0 ? A - R : -A - 0.012, A - R + 0.002, H + 0.016, s > 0 ? A + 0.012 : -A + R, 0.5); }
  for (const x of [-0.4, 0.4]) for (const z of [-0.4, 0.4]) { m.box('wood', x - 0.035, 0.56, z - 0.035, x + 0.035, H - 0.075, z + 0.035); m.geo('wood', lathe([[0, 0], [0.022, 0], [0.03, 0.03], [0.02, 0.06], [0.028, 0.24], [0.034, 0.36], [0.024, 0.42], [0.036, 0.46], [0.03, 0.5], [0.034, 0.56], [0, 0.56]]), x, 0, z); }
  for (const s of [-1, 1]) { m.box('wood', -0.365, 0.64, s * 0.41 - 0.012, 0.365, H - 0.07, s * 0.41 + 0.012); m.box('wood', s * 0.41 - 0.012, 0.64, -0.365, s * 0.41 + 0.012, H - 0.07, 0.365); m.box('light', -0.15, 0.655, s * 0.424 - 0.004, 0.15, 0.715, s * 0.424 + 0.004); m.ball('brass', 0, 0.685, s * 0.436, 0.014); }
  for (const x of [-A + 0.03, A - 0.03]) for (const z of [-A + 0.03, A - 0.03]) m.geo('brass', new THREE.CylinderGeometry(0.02, 0.02, 0.004, 16), x, H + 0.017, z);
}

