// The models of a player's business (docs/planes/gta/PLAN-H-pueblo-vivo.md §7): the counter (two tiles, its customers at +z), the
// shelf (its back to the wall) and the crate. Their goods and the slate are drawn apart, by business3d.js: SLOTS says where
import * as THREE from 'three';

const cyl = (r, h, n = 14) => new THREE.CylinderGeometry(r, r, h, n);
// Where each lot goes: [x, y, z (its base), the size of the heap], in the model's axes
export const SLOTS = {
  shop_counter: [[0.02, 0.985, 0.02, 0.3], [0.45, 0.985, 0.02, 0.3], [0.88, 0.985, 0.02, 0.3]],
  display_shelf: [0.35, 0.83, 1.31].flatMap(y => [[-0.205, y, 0, 0.36], [0.205, y, 0, 0.36]]),
  goods_crate: [[-0.293, 0.505, 0, 0.27], [0, 0.505, 0, 0.27], [0.293, 0.505, 0, 0.27]],
};
export const SLATE = [1.2, 0.985, 0.1];   // (the counter's slate: its foot)
export const CRATE_TILT = 0.36;            // rad its trays lean towards who looks

// Planked panels between stiles, a thick top with its moulding, a bell, a cash drawer and a pair of scales behind
export function shopCounter(m) {
  const x0 = -0.44, x1 = 1.44, z0 = -0.26, z1 = 0.26, H = 0.92;
  m.box('dark', x0 + 0.03, 0, z0 + 0.04, x1 - 0.03, 0.1, z1 - 0.03);                              // the plinth
  m.box('wood', x0, 0.1, z0 + 0.02, x1, 0.15, z1 + 0.012);
  for (const [a, b] of [[x0, x0 + 0.03], [x1 - 0.03, x1]]) m.box('plank', a, 0.1, z0, b, H, z1 - 0.01);   // its sides
  m.box('plank', x0, 0.15, z1 - 0.05, x1, H, z1 - 0.028);                                         // the boards of the front
  const n = 3, w = (x1 - x0) / n;
  for (let i = 0; i <= n; i++) { const x = x0 + w * i; m.box('wood', Math.max(x0, x - 0.04), 0.15, z1 - 0.03, Math.min(x1, x + 0.04), H, z1); }
  m.box('wood', x0, H - 0.11, z1 - 0.03, x1, H, z1).box('wood', x0, 0.15, z1 - 0.03, x1, 0.25, z1);
  for (let i = 0; i < n; i++) {   // (each panel: a raised field with its bevelled frame)
    const a = x0 + w * i + 0.075, b = x0 + w * (i + 1) - 0.075;
    m.box('light', a, 0.3, z1 - 0.032, b, H - 0.16, z1 - 0.012).box('wood', a + 0.06, 0.36, z1 - 0.02, b - 0.06, H - 0.22, z1 - 0.004);
  }
  m.box('wood', x0 + 0.03, 0.46, z0 + 0.03, x1 - 0.03, 0.49, z1 - 0.05);                          // the shelf behind, and what it keeps
  m.box('light', -0.28, 0.49, -0.16, -0.02, 0.56, 0.12).box('light', -0.27, 0.56, -0.15, -0.04, 0.61, 0.11).geo('straw', cyl(0.085, 0.2), 0.3, 0.6, -0.02).geo('rope', new THREE.TorusGeometry(0.085, 0.012, 6, 16), 0.3, 0.6, -0.02, [Math.PI / 2, 0, 0]);
  m.box('books2', 0.6, 0.49, -0.12, 0.64, 0.74, 0.08).box('books3', 0.65, 0.49, -0.12, 0.7, 0.71, 0.08).box('books0', 0.71, 0.49, -0.12, 0.74, 0.73, 0.08);
  m.box('dark', x0 - 0.03, H, z0 - 0.06, x1 + 0.03, H + 0.018, z1 + 0.07).box('light', x0 - 0.05, H + 0.018, z0 - 0.08, x1 + 0.05, H + 0.065, z1 + 0.09);   // the top and its moulding
  const T = H + 0.065;
  // (the cash drawer, under the top, on the seller's side)
  m.box('wood', 1.02, 0.74, z0 - 0.005, 1.36, 0.88, z0 + 0.03).box('dark', 1.04, 0.755, z0 - 0.02, 1.34, 0.865, z0 - 0.003).ball('brass', 1.19, 0.81, z0 - 0.03, 0.02);
  // The bell, on its little base
  m.geo('dark', cyl(0.06, 0.018, 18), -0.3, T + 0.009, 0.16).geo('brass', new THREE.SphereGeometry(0.05, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), -0.3, T + 0.022, 0.16).geo('brass', cyl(0.052, 0.008, 18), -0.3, T + 0.022, 0.16).geo('brass', cyl(0.007, 0.02, 8), -0.3, T + 0.08, 0.16).ball('brass', -0.3, T + 0.092, 0.16, 0.013);
  // The scales: foot, column, beam, the two pans hung from it and their weights
  const sx = 1.2, sz = -0.16;
  m.geo('dark', new THREE.BoxGeometry(0.24, 0.025, 0.13), sx, T + 0.012, sz).geo('brass', cyl(0.04, 0.012, 16), sx, T + 0.03, sz).geo('brass', cyl(0.011, 0.3, 10), sx, T + 0.18, sz).ball('brass', sx, T + 0.335, sz, 0.02);
  m.geo('brass', new THREE.BoxGeometry(0.34, 0.014, 0.014), sx, T + 0.31, sz, [0, 0, 0.05]);
  for (const s of [-1, 1]) {
    const px = sx + s * 0.165, py = T + 0.12 + s * 0.008;
    m.geo('brass', new THREE.CylinderGeometry(0.075, 0.05, 0.018, 18), px, py, sz);
    for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2 + 0.4, dx = Math.cos(a) * 0.07, dz = Math.sin(a) * 0.07, L = Math.hypot(0.185, 0.07); m.geo('iron', cyl(0.0025, L, 4), px + dx / 2, py + 0.1, sz + dz / 2, [Math.atan2(-dz, 0.185), 0, Math.atan2(dx, 0.185)]); }
  }
  for (const [x, r] of [[-0.02, 0.022], [0.03, 0.017]]) m.geo('brass', cyl(r, r * 1.6, 12), sx + 0.165 + x, T + 0.13 + r * 0.8, sz);
}

// Two uprights, a boarded back, three shelves with a lip and a cornice
export function displayShelf(m) {
  const X = 0.45, zb = -0.23, zf = 0.2, top = 1.82;
  for (const s of [-1, 1]) {
    m.box('wood', s * X - (s > 0 ? 0.04 : 0), 0, zb, s * X + (s > 0 ? 0 : 0.04), top, zf - 0.06);
    m.box('dark', s * X - (s > 0 ? 0.045 : -0.005), 0, zb - 0.005, s * X + (s > 0 ? 0.005 : 0.045), 0.1, zf);
  }
  for (let i = 0; i < 6; i++) { const w = 0.82 / 6, x = -0.41 + w * i; m.box('wood', x + 0.004, 0.08, zb, x + w - 0.003, top - 0.02, zb + 0.018); }
  for (const y of [0.32, 0.8, 1.28]) m.box('light', -0.41, y, zb + 0.015, 0.41, y + 0.03, zf).box('wood', -0.41, y - 0.005, zf - 0.005, 0.41, y + 0.06, zf + 0.015);
  m.box('wood', -0.41, 0.1, zf - 0.05, 0.41, 0.3, zf - 0.03).box('dark', -0.13, 0.14, zf - 0.035, -0.11, 0.26, zf - 0.02).box('dark', 0.11, 0.14, zf - 0.035, 0.13, 0.26, zf - 0.02);
  m.box('dark', -X - 0.02, top, zb - 0.005, X + 0.02, top + 0.035, zf - 0.02).box('wood', -X - 0.045, top + 0.035, zb - 0.005, X + 0.045, top + 0.075, zf + 0.01);
  // (the braces at the top of the opening)
  for (const s of [-1, 1]) m.geo('wood', new THREE.BoxGeometry(0.16, 0.025, 0.02), s * 0.36, top - 0.07, zf - 0.07, [0, 0, -s * 0.78]);
}

// A slatted crate leaning on two trestles, with three trays of straw
export function goodsCrate(m) {
  const X = 0.44, a = CRATE_TILT, c = Math.cos(a), s = Math.sin(a), y0 = 0.44, at = (y, z) => [y0 + y * c - z * s, z * c + y * s];
  const P = (key, x, y, z, w, h, d) => { const [py, pz] = at(y, z); m.geo(key, new THREE.BoxGeometry(w, h, d), x, py, pz, [a, 0, 0]); };
  for (const sx of [-1, 1]) {   // the trestles
    for (const [z, h] of [[0.2, 0.36], [-0.2, 0.52]]) m.box('dark', sx * 0.36 - 0.028, 0, z - 0.03, sx * 0.36 + 0.028, h, z + 0.03);
    m.box('dark', sx * 0.36 - 0.02, 0.14, -0.2, sx * 0.36 + 0.02, 0.18, 0.2);
  }
  m.box('dark', -0.36, 0.15, -0.02, 0.36, 0.19, 0.02);
  for (let i = 0; i < 4; i++) P('light', 0, 0, -0.195 + i * 0.13, X * 2, 0.018, 0.118);                       // the bottom's slats
  for (const z of [-0.27, 0.27]) for (const y of [0.05, 0.135]) P('plank', 0, y, z, X * 2, 0.07, 0.016);      // front and back
  for (const x of [-X, X]) for (const y of [0.05, 0.135]) P('plank', x, y, 0, 0.016, 0.07, 0.55);
  for (const x of [-0.147, 0.147]) P('wood', x, 0.07, 0, 0.014, 0.12, 0.53);
  for (const x of [-X, X]) for (const z of [-0.265, 0.265]) P('dark', x * 0.985, 0.085, z * 0.975, 0.03, 0.18, 0.03);
  // (the straw: a bed, and loose stalks over it)
  for (const x of [-0.293, 0, 0.293]) P('rope', x, 0.03, 0, 0.27, 0.04, 0.51);
  for (let i = 0; i < 66; i++) { const u = (i * 0.618) % 1, q = (i * 0.381 + 0.2) % 1, [py, pz] = at(0.054 + (i % 3) * 0.005, (q - 0.5) * 0.46), x = -0.43 + u * 0.86; if (Math.abs(Math.abs(x) - 0.147) > 0.03) m.geo(i % 4 ? 'hay' : 'straw', new THREE.BoxGeometry(0.1 + u * 0.06, 0.006, 0.008), x, py, pz, [a, (i * 2.4) % 3.1, 0]); }
}
