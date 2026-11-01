// Sprites del escenario dibujados por código: árboles, arbustos, rocas, valla, objetos del pueblo y la casa.
import { mk, rng, pickWith, ramp, lerp, poly, line, ellipse, blob, outlined } from '../util.js';
import { iso, boxCol } from '../iso.js';
import { placeSprite } from './stations.js';

// El arte usa su propia semilla: es igual en todas las partidas
const rand = rng(7);
const pick = pickWith(rand);
export const FLOWER_COLS = ['#ffffff', '#ffe04a', '#ff7aa8', '#b48aff', '#ff6a4a', '#7ac8ff'];

export function treeSprite(kind, seed) {
  const r = rng(seed);
  const c = mk(72, 96), g = c.getContext('2d');
  const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  if (kind === 'pine') {
    R(33, 70, 6, 22, '#6a4628'); R(37, 70, 2, 22, '#4e3220'); R(30, 90, 12, 2, '#4e3220');
    const shades = ramp(pick(['#2f7040', '#357a44', '#2a6838']));
    for (let i = 0; i < 4; i++) {
      const top = 8 + i * 15, w = 14 + i * 7, base = top + 26;
      poly(g, [[36, top], [36 + w, base], [36 - w, base]], shades.b);
      poly(g, [[36, top], [36 + w, base], [38, base]], shades.d);
      poly(g, [[36, top + 2], [36 - w + 4, base - 1], [34, base - 1]], shades.l);
      for (let k = 0; k < 6; k++) R(36 - w + 3 + Math.floor(r() * (w * 2 - 6)), base - 2 - Math.floor(r() * 6), 1, 2, shades.d2);
    }
    return outlined(c);
  }
  R(31, 54, 9, 38, '#7a5232'); R(37, 54, 3, 38, '#5a3a22'); R(32, 56, 1, 30, '#9a6c42');
  R(26, 88, 20, 4, '#5a3a22'); R(28, 86, 4, 3, '#7a5232'); R(40, 86, 4, 3, '#7a5232');
  line(g, 35, 62, 24, 50, '#7a5232'); line(g, 36, 60, 48, 48, '#5a3a22');
  const leaf = ramp(pick(['#4f9a3a', '#5aa842', '#468a34', '#63b04b']));
  const clumps = [[36, 34, 25], [19, 44, 14], [53, 44, 14], [26, 22, 15], [46, 22, 14], [36, 14, 12]];
  for (const [x, y, rr] of clumps) blob(g, x, y + 2, rr, leaf.d2);
  for (const [x, y, rr] of clumps) blob(g, x, y, rr - 1, leaf.d);
  for (const [x, y, rr] of clumps) blob(g, x - 2, y - 3, rr - 4, leaf.b);
  for (const [x, y, rr] of clumps) blob(g, x - 5, y - 6, Math.max(2, Math.floor(rr * 0.4)), leaf.l);
  for (let k = 0; k < 60; k++) {
    const [x, y, rr] = pick(clumps), a = r() * Math.PI * 2, d = r() * (rr - 3);
    R(Math.round(x + Math.cos(a) * d), Math.round(y + Math.sin(a) * d), 2, 1, r() < 0.5 ? leaf.d : leaf.l);
  }
  if (kind === 'fruit') for (let k = 0; k < 10; k++) {
    const [x, y, rr] = pick(clumps), a = r() * Math.PI * 2, d = r() * (rr - 4);
    const ax = Math.round(x + Math.cos(a) * d), ay = Math.round(y + Math.sin(a) * d);
    R(ax, ay, 3, 3, '#d8382a'); R(ax, ay, 1, 1, '#ff8a6a');
  }
  return outlined(c);
}
export function bushSprite(flower) {
  const c = mk(36, 26), g = c.getContext('2d'), leaf = ramp('#4a9638');
  for (const [x, y, r] of [[11, 15, 8], [24, 15, 8], [18, 10, 8]]) blob(g, x, y + 1, r, leaf.d);
  for (const [x, y, r] of [[11, 15, 8], [24, 15, 8], [18, 10, 8]]) blob(g, x - 1, y - 1, r - 2, leaf.b);
  for (const [x, y, r] of [[11, 15, 8], [24, 15, 8], [18, 10, 8]]) blob(g, x - 3, y - 3, 2, leaf.l);
  if (flower) for (let k = 0; k < 8; k++) { g.fillStyle = flower; g.fillRect(5 + Math.floor(rand() * 24), 5 + Math.floor(rand() * 14), 2, 2); }
  return outlined(c);
}
export function rockSprite(s) {
  const c = mk(26, 18), g = c.getContext('2d'), st = ramp('#9a958c');
  ellipse(g, 13, 11, 9 * s, 5 * s, st.d);
  ellipse(g, 12, 9, 8 * s, 4 * s, st.b);
  ellipse(g, 10, 8, 4 * s, 2 * s, st.l);
  return outlined(c);
}
// Tramo de valla de una casilla; dir 'x' (baja hacia la derecha) o 'y' (baja hacia la izquierda)
export function fenceSprite(dir) {
  const c = mk(24, 30), g = c.getContext('2d');
  const wood = ramp('#b8895a');
  const sx = dir === 'x' ? 3 : 19, ex = dir === 'x' ? 19 : 3, sy = 18, ey = 26;
  for (const z of [6, 12]) { line(g, sx, sy - z, ex, ey - z, wood.b); line(g, sx, sy - z + 1, ex, ey - z + 1, wood.d); }
  const post = (x, y) => { g.fillStyle = wood.b; g.fillRect(x - 1, y - 16, 3, 16); g.fillStyle = wood.d; g.fillRect(x + 1, y - 16, 1, 16); g.fillStyle = wood.l; g.fillRect(x - 1, y - 17, 3, 1); };
  post(sx, sy); post(ex, ey);
  return { img: outlined(c), ax: sx, ay: sy };
}
export function mailboxSprite() {
  const c = mk(20, 34), g = c.getContext('2d');
  g.fillStyle = '#7a5032'; g.fillRect(9, 12, 3, 20);
  const I = iso(g, 10, 14);
  I.box(-0.3, -0.25, 0.3, 0.25, 0, 9, boxCol('#d0402e'));
  g.fillStyle = '#e8c050'; g.fillRect(15, 4, 1, 6); g.fillRect(15, 4, 3, 2);
  return outlined(c);
}
export function lampSprite() {
  const c = mk(18, 60), g = c.getContext('2d');
  g.fillStyle = '#34343c'; g.fillRect(8, 16, 3, 42); g.fillRect(6, 56, 7, 3);
  g.fillStyle = '#4a4a54'; g.fillRect(8, 16, 1, 40);
  g.fillStyle = '#34343c'; g.fillRect(4, 4, 11, 3); g.fillRect(5, 15, 9, 2);
  g.fillStyle = '#ffe6a0'; g.fillRect(5, 7, 9, 8);
  g.fillStyle = '#fff6d8'; g.fillRect(6, 8, 3, 4);
  g.fillStyle = '#34343c'; g.fillRect(9, 7, 1, 8);
  return outlined(c);
}
export function signSprite() {
  const c = mk(30, 36), g = c.getContext('2d'), w = ramp('#b8895a');
  g.fillStyle = w.d; g.fillRect(14, 12, 3, 22);
  g.fillStyle = w.b; g.fillRect(3, 6, 24, 12); g.fillStyle = w.l; g.fillRect(3, 6, 24, 1); g.fillStyle = w.d; g.fillRect(3, 17, 24, 1);
  g.fillStyle = '#5a3a22'; g.fillRect(7, 9, 12, 1); g.fillRect(7, 12, 16, 1); g.fillRect(21, 9, 3, 1);
  return outlined(c);
}

// La casa: paredes de yeso con entramado, tejado de tejas, chimenea, ventanas con contraventanas
export function houseSprite(roofCol = '#c95a3c', wallCol = '#f2e2c0') {
  const Wd = 6, Dp = 5, WH = 66, RISE = 42, O = 0.45, FND = 7;
  const c = mk(250, 250), g = c.getContext('2d');
  const ox = 112, oy = 146;
  const I = iso(g, ox, oy), P = I.P;
  const plaster = ramp(wallCol), timber = ramp('#6a4428'), stone = ramp('#a59e92'), roof = ramp(roofCol);
  const eaveZ = WH - (RISE * O) / 2.5;

  // Cimientos de piedra
  I.box(-0.15, -0.15, Wd + 0.15, Dp + 0.15, 0, FND, { top: stone.l, left: stone.b, right: stone.d });
  for (let u = 0; u < Wd; u += 0.55) line(g, ...P(u, Dp + 0.15, 1), ...P(u, Dp + 0.15, FND - 1), stone.d);
  for (let u = 0.3; u < Dp; u += 0.55) line(g, ...P(Wd + 0.15, u, 1), ...P(Wd + 0.15, u, FND - 1), stone.d2);
  line(g, ...P(-0.15, Dp + 0.15, 4), ...P(Wd + 0.15, Dp + 0.15, 4), stone.d);

  // Paredes
  I.faceL(Dp, 0, Wd, FND, WH, plaster.b);
  I.faceR(Wd, 0, Dp, FND, WH, plaster.d);
  poly(g, [P(Wd, 0, WH), P(Wd, Dp, WH), P(Wd, Dp / 2, WH + RISE)], plaster.d);
  for (let k = 0; k < 40; k++) { const u = rand() * Wd, v = FND + 4 + rand() * (WH - FND - 8); const [x, y] = P(u, Dp, v); g.fillStyle = plaster.l; g.fillRect(x, y, 2, 1); }

  // Entramado de madera (cara izquierda)
  const tL = (u0, u1, v0, v1) => I.faceL(Dp, u0, u1, v0, v1, timber.b);
  tL(0, 0.16, FND, WH); tL(Wd - 0.16, Wd, FND, WH); tL(0, Wd, WH - 5, WH); tL(0, Wd, FND, FND + 4);
  tL(2.42, 2.58, FND, WH); tL(3.42, 3.58, FND, WH); tL(0, Wd, 50, 53);
  poly(g, [P(1.72, Dp, FND + 4), P(1.88, Dp, FND + 4), P(2.42, Dp, 50), P(2.26, Dp, 50)], timber.b);
  poly(g, [P(4.12, Dp, FND + 4), P(4.28, Dp, FND + 4), P(3.74, Dp, 50), P(3.58, Dp, 50)], timber.b);
  // Entramado (cara derecha y hastial)
  const tR = (u0, u1, v0, v1) => I.faceR(Wd, u0, u1, v0, v1, timber.d);
  tR(0, 0.16, FND, WH); tR(0, Dp, WH - 5, WH); tR(0, Dp, FND, FND + 4); tR(0, Dp, 50, 53);
  line(g, ...P(Wd, 0, WH), ...P(Wd, Dp / 2, WH + RISE), timber.d); line(g, ...P(Wd, Dp, WH), ...P(Wd, Dp / 2, WH + RISE), timber.d);
  tR(Dp / 2 - 0.08, Dp / 2 + 0.08, WH, WH + RISE - 4);
  // Ventanuco redondo del hastial
  const ring = (r, col) => poly(g, Array.from({ length: 12 }, (_, i) => P(Wd, Dp / 2 + Math.cos((i / 12) * Math.PI * 2) * r, WH + 18 + Math.sin((i / 12) * Math.PI * 2) * r * 16)), col);
  ring(0.42, timber.d); ring(0.3, '#3a5a74');

  // Ventanas con contraventanas y jardinera
  const glass = ramp('#8fc8e8'), shut = ramp('#4f8a4a');
  function windowL(u0, u1, v0, v1, flowers) {
    I.faceL(Dp, u0 - 0.1, u1 + 0.1, v0 - 3, v1 + 3, timber.b);
    I.faceL(Dp, u0, u1, v0, v1, glass.b);
    poly(g, [P(u0 + 0.1, Dp, v1 - 2), P(u0 + 0.3, Dp, v1 - 2), P(u0 + 0.12, Dp, v0 + 3), P(u0 + 0.05, Dp, v0 + 3)], glass.l2);
    I.faceL(Dp, (u0 + u1) / 2 - 0.04, (u0 + u1) / 2 + 0.04, v0, v1, timber.b);
    I.faceL(Dp, u0, u1, (v0 + v1) / 2 - 1, (v0 + v1) / 2 + 1, timber.b);
    for (const [a, b] of [[u0 - 0.5, u0 - 0.12], [u1 + 0.12, u1 + 0.5]]) {
      I.faceL(Dp, a, b, v0 - 2, v1 + 2, shut.b);
      for (let v = v0 + 2; v < v1; v += 4) I.faceL(Dp, a + 0.05, b - 0.05, v, v + 1, shut.d);
    }
    if (flowers) {
      I.faceL(Dp, u0 - 0.12, u1 + 0.12, v0 - 9, v0 - 3, '#7a4a2a');
      for (let u = u0; u < u1; u += 0.13) { const [x, y] = P(u, Dp, v0 - 2); g.fillStyle = '#3f8a32'; g.fillRect(x, y, 2, 2); g.fillStyle = pick(FLOWER_COLS); g.fillRect(x, y - 1, 2, 1); }
    }
  }
  function windowR(u0, u1, v0, v1) {
    I.faceR(Wd, u0 - 0.1, u1 + 0.1, v0 - 3, v1 + 3, timber.d);
    I.faceR(Wd, u0, u1, v0, v1, glass.d);
    I.faceR(Wd, (u0 + u1) / 2 - 0.04, (u0 + u1) / 2 + 0.04, v0, v1, timber.d);
    I.faceR(Wd, u0, u1, (v0 + v1) / 2 - 1, (v0 + v1) / 2 + 1, timber.d);
    for (const [a, b] of [[u0 - 0.5, u0 - 0.12], [u1 + 0.12, u1 + 0.5]]) I.faceR(Wd, a, b, v0 - 2, v1 + 2, shut.d);
  }
  windowL(0.6, 1.6, 26, 45, true);
  windowL(4.4, 5.4, 26, 45, true);
  windowR(1.9, 3.1, 26, 45);

  // Puerta, escalón y farol
  I.faceL(Dp, 2.58, 3.42, FND, 46, '#6e4224');
  for (const u of [2.79, 3.0, 3.21]) I.faceL(Dp, u, u + 0.03, FND, 46, '#55321a');
  I.faceL(Dp, 2.58, 3.42, 18, 20, '#55321a'); I.faceL(Dp, 2.58, 3.42, 36, 38, '#55321a');
  I.faceL(Dp, 2.42, 3.58, 46, 50, timber.b);
  { const [x, y] = P(3.3, Dp, 26); g.fillStyle = '#f0c858'; g.fillRect(x, y, 2, 2); }
  I.box(2.45, Dp + 0.15, 3.55, Dp + 0.55, 0, 4, { top: stone.l, left: stone.b, right: stone.d });
  { const [x, y] = P(3.75, Dp, 44); g.fillStyle = '#2e2e34'; g.fillRect(x, y - 1, 6, 2); g.fillRect(x + 1, y + 1, 5, 9); g.fillStyle = '#ffd77a'; g.fillRect(x + 2, y + 2, 3, 6); g.fillStyle = '#fff4c8'; g.fillRect(x + 2, y + 3, 1, 3); }

  // Tejado: faldón trasero, chimenea y faldón delantero con tejas
  I.quad([-O, -O, eaveZ], [Wd + O, -O, eaveZ], [Wd + O, Dp / 2, WH + RISE], [-O, Dp / 2, WH + RISE], roof.d2);
  // Vuelo del faldón trasero sobre el hastial: una franja pegada al muro, para que su borde no quede suelto
  poly(g, [P(Wd, 0, WH), P(Wd, Dp / 2, WH + RISE), P(Wd + O, Dp / 2, WH + RISE), P(Wd + O, -O, eaveZ)], roof.d);
  I.box(4.1, 0.9, 4.9, 1.7, WH + 10, WH + RISE + 28, { top: stone.l, left: stone.b, right: stone.d });
  I.box(4.0, 0.8, 5.0, 1.8, WH + RISE + 26, WH + RISE + 30, { top: stone.d, left: stone.d, right: stone.d2 });
  for (let z = WH + RISE; z < WH + RISE + 26; z += 5) { line(g, ...P(4.1, 1.7, z), ...P(4.9, 1.7, z), stone.d); line(g, ...P(4.9, 0.9, z), ...P(4.9, 1.7, z), stone.d2); }
  I.quad([-O, Dp / 2, WH + RISE], [Wd + O, Dp / 2, WH + RISE], [Wd + O, Dp + O, eaveZ], [-O, Dp + O, eaveZ], roof.b);
  const rows = 8;
  for (let k = 0; k <= rows; k++) {
    const t = k / rows, y = lerp(Dp / 2, Dp + O, t), z = lerp(WH + RISE, eaveZ, t);
    if (k > 0) {
      line(g, ...P(-O, y, z), ...P(Wd + O, y, z), roof.d);
      line(g, ...P(-O, y, z - 1), ...P(Wd + O, y, z - 1), roof.l);
    }
    if (k < rows) {
      const t2 = (k + 1) / rows, y2 = lerp(Dp / 2, Dp + O, t2), z2 = lerp(WH + RISE, eaveZ, t2);
      for (let u = -O + (k % 2 ? 0.25 : 0); u < Wd + O; u += 0.5) line(g, ...P(u, y, z - 1), ...P(u, y2, z2 + 1), roof.d);
    }
  }
  I.quad([-O, Dp + O, eaveZ], [Wd + O, Dp + O, eaveZ], [Wd + O, Dp + O, eaveZ - 4], [-O, Dp + O, eaveZ - 4], roof.d2);
  // Tablas del borde del tejado en el hastial, las dos del mismo color
  I.quad([Wd + O, Dp / 2, WH + RISE], [Wd + O, Dp + O, eaveZ], [Wd + O, Dp + O, eaveZ - 4], [Wd + O, Dp / 2, WH + RISE - 4], timber.d);
  I.quad([Wd + O, -O, eaveZ], [Wd + O, Dp / 2, WH + RISE], [Wd + O, Dp / 2, WH + RISE - 4], [Wd + O, -O, eaveZ - 4], timber.d);
  I.quad([-O, Dp / 2, WH + RISE + 2], [Wd + O, Dp / 2, WH + RISE + 2], [Wd + O, Dp / 2, WH + RISE - 1], [-O, Dp / 2, WH + RISE - 1], roof.d2);

  const chimneyTop = P(4.5, 1.3, WH + RISE + 30);
  return { img: outlined(c), ox, oy, chimney: [chimneyTop[0] - ox, chimneyTop[1] - oy] };
}

// ---------- cosas del pueblo que crece (fase 7) ----------
// Puesto del mercado: 2×1 casillas, toldo de rayas. Apoyo en la esquina de atrás (como la casa).
export function stallSprite(stripe = '#c83a3a', goods = ['#e83a4a', '#f08a2a', '#5aa842']) {
  const c = mk(110, 110), g = c.getContext('2d'), ox = 40, oy = 70, I = iso(g, ox, oy), wood = boxCol('#a8764a');
  for (const [x, y] of [[0, 0], [1.9, 0], [0, 0.9], [1.9, 0.9]]) I.box(x, y, x + 0.1, y + 0.1, 0, 40, wood);
  I.box(0, 0.1, 2, 1, 12, 16, boxCol('#c8925a'));
  goods.forEach((col, i) => { const [x, y] = I.P(0.35 + i * 0.6, 0.55, 18); ellipse(g, x, y, 6, 3, col); ellipse(g, x - 1, y - 1, 3, 1, '#ffffff'); });
  for (let k = 0; k < 5; k++) I.quad([k * 0.4, -0.2, 46], [k * 0.4 + 0.4, -0.2, 46], [k * 0.4 + 0.4, 1.2, 38], [k * 0.4, 1.2, 38], k % 2 ? '#f4ecd8' : stripe);
  return { img: outlined(c), ox, oy };
}
export function boardSprite() {
  const c = mk(40, 50), g = c.getContext('2d'), w = ramp('#a8764a');
  g.fillStyle = w.d; g.fillRect(8, 20, 3, 28); g.fillRect(29, 20, 3, 28);
  g.fillStyle = w.b; g.fillRect(4, 6, 32, 22); g.fillStyle = w.l; g.fillRect(4, 6, 32, 2); g.fillStyle = w.d; g.fillRect(4, 27, 32, 1);
  for (const [x, y, col] of [[7, 10, '#f4ecd8'], [17, 9, '#fff8c8'], [26, 11, '#f4ecd8'], [12, 17, '#e8f0ff']]) { g.fillStyle = col; g.fillRect(x, y, 8, 8); g.fillStyle = '#c83a3a'; g.fillRect(x + 3, y, 2, 1); g.fillStyle = '#8a8478'; g.fillRect(x + 1, y + 3, 6, 1); g.fillRect(x + 1, y + 5, 4, 1); }
  g.fillStyle = '#c95a3c'; g.fillRect(2, 3, 36, 4);
  return outlined(c);
}
export function fountainSprite() {
  const c = mk(100, 90), g = c.getContext('2d'), ox = 50, oy = 60, I = iso(g, ox, oy), st = boxCol('#b8b2a8');
  I.box(-1, -1, 1, 1, 0, 8, st);
  I.quad([-0.85, -0.85, 8], [0.85, -0.85, 8], [0.85, 0.85, 8], [-0.85, 0.85, 8], '#5aa6dc');
  I.box(-0.15, -0.15, 0.15, 0.15, 8, 26, st);
  I.box(-0.45, -0.45, 0.45, 0.45, 26, 29, st);
  I.quad([-0.38, -0.38, 29], [0.38, -0.38, 29], [0.38, 0.38, 29], [-0.38, 0.38, 29], '#7ac0ec');
  const [x, y] = I.P(0, 0, 34); g.fillStyle = '#d8f0ff'; g.fillRect(x - 1, y - 4, 2, 6);
  return { img: outlined(c), ox, oy };
}
export function dockSprite() {
  const c = mk(140, 90), g = c.getContext('2d'), ox = 40, oy = 30, I = iso(g, ox, oy), w = boxCol('#a8764a');
  for (const [x, y] of [[0, 0], [3.2, 0], [0, 0.9], [3.2, 0.9]]) I.box(x, y, x + 0.12, y + 0.12, -6, 5, boxCol('#7a5030'));
  I.box(0, 0, 3.3, 1, 3, 5, w);
  for (let u = 0.3; u < 3.3; u += 0.3) line(g, ...I.P(u, 0, 5), ...I.P(u, 1, 5), '#8a5a30');
  return { img: outlined(c), ox, oy };
}

// ---------- naturaleza de los biomas (mismo lienzo y apoyo que los árboles: 72×96, base en 36,91) ----------
function natureCanvas() { const c = mk(72, 96); return [c, c.getContext('2d')]; }

export function snowPineSprite(seed) {
  const r = rng(seed), [c, g] = natureCanvas();
  const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  R(33, 70, 6, 22, '#6a4628'); R(37, 70, 2, 22, '#4e3220'); R(28, 89, 16, 3, '#e8eef6');
  const shades = ramp(pick(['#2f6048', '#2a5a44', '#356a4e']));
  for (let i = 0; i < 4; i++) {
    const top = 8 + i * 15, w = 14 + i * 7, base = top + 26;
    poly(g, [[36, top], [36 + w, base], [36 - w, base]], shades.b);
    poly(g, [[36, top], [36 + w, base], [38, base]], shades.d);
    // Nieve sobre cada piso
    poly(g, [[36, top], [36 + w * 0.55, top + 14], [36 - w * 0.55, top + 14]], '#f4f8fc');
    poly(g, [[36, top], [36 + w * 0.55, top + 14], [38, top + 14]], '#c8d8ea');
    for (let k = 0; k < 4; k++) R(36 - w + 2 + Math.floor(r() * (w * 2 - 4)), base - 2, 3, 2, '#f4f8fc');
  }
  return outlined(c);
}
export function palmSprite(seed) {
  const r = rng(seed), [c, g] = natureCanvas();
  const lean = r() < 0.5 ? -1 : 1;
  for (let i = 0; i < 14; i++) {
    const y = 88 - i * 4.5, x = 34 + Math.round(lean * (i * i) * 0.05);
    g.fillStyle = i % 2 ? '#a07a4a' : '#b48a56'; g.fillRect(x, y - 4, 6, 5);
    g.fillStyle = '#7a5a34'; g.fillRect(x + 4, y - 4, 2, 5);
  }
  const tx = 37 + Math.round(lean * 169 * 0.05), ty = 26, leaf = ramp('#4a9a3a');
  for (let k = 0; k < 7; k++) {
    const a = -Math.PI / 2 + (k - 3) * 0.55, len = 18 + r() * 5;   // que las hojas quepan en el lienzo
    for (let s = 0; s < len; s++) {
      const x = tx + Math.cos(a) * s, y = ty + Math.sin(a) * s + (s * s) / 34;
      g.fillStyle = s < len * 0.6 ? leaf.b : leaf.d; g.fillRect(Math.round(x) - 1, Math.round(y), 3, 2);
      if (s % 3 === 0) { g.fillStyle = leaf.l; g.fillRect(Math.round(x), Math.round(y) - 1, 1, 1); }
    }
  }
  for (const [dx, dy] of [[-3, 2], [2, 3], [-1, 5]]) blob(g, tx + dx, ty + dy, 2, '#6a4a2a');
  return outlined(c);
}
export function cactusSprite(seed) {
  const r = rng(seed), [c, g] = natureCanvas(), cc = ramp('#4f9a52');
  const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  const h = 38 + Math.floor(r() * 18), top = 91 - h;
  const col = (x, y, w, hh) => { R(x, y + 2, w, hh - 2, cc.b); R(x + 1, y, w - 2, 2, cc.b); R(x + w - 3, y + 2, 2, hh - 2, cc.d); R(x + 2, y + 3, 1, hh - 5, cc.l); for (let k = y + 5; k < y + hh - 2; k += 5) R(x + 1, k, 1, 1, '#f4f0d0'); };
  col(31, top, 10, h);
  if (r() < 0.8) { const ay = top + 10 + Math.floor(r() * 10); R(24, ay + 10, 8, 6, cc.b); col(22, ay, 7, 16); }
  if (r() < 0.8) { const ay = top + 14 + Math.floor(r() * 10); R(40, ay + 9, 8, 6, cc.d); col(44, ay, 7, 15); }
  if (r() < 0.4) { R(33, top - 2, 3, 3, '#ff7aa8'); R(36, top - 1, 2, 2, '#ffd0e0'); }
  return outlined(c);
}
export function deadBushSprite(seed) {
  const r = rng(seed), [c, g] = natureCanvas();
  for (let k = 0; k < 9; k++) {
    let x = 36, y = 90;
    const a0 = -Math.PI / 2 + (r() - 0.5) * 2.2;
    for (let s = 0; s < 16 + r() * 8; s++) {
      x += Math.cos(a0 + Math.sin(s * 0.7 + k) * 0.4); y += Math.sin(a0) * 0.9;
      g.fillStyle = s < 8 ? '#8a6a44' : '#a8865a'; g.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
  }
  return outlined(c);
}
export function swampTreeSprite(seed) {
  const r = rng(seed), [c, g] = natureCanvas();
  const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  R(30, 50, 11, 42, '#4a3a2a'); R(37, 50, 4, 42, '#33281c'); R(24, 86, 24, 6, '#3a2e20'); R(26, 82, 5, 5, '#4a3a2a'); R(41, 82, 5, 5, '#4a3a2a');
  const leaf = ramp('#5a7034');
  const clumps = [[36, 30, 22], [20, 38, 13], [52, 38, 13], [36, 16, 13]];
  for (const [x, y, rr] of clumps) blob(g, x, y + 2, rr, leaf.d2);
  for (const [x, y, rr] of clumps) blob(g, x - 1, y, rr - 2, leaf.d);
  for (const [x, y, rr] of clumps) blob(g, x - 4, y - 4, Math.max(2, rr >> 1), leaf.b);
  // Ramas colgantes, como un sauce
  for (let k = 0; k < 16; k++) {
    const x = 14 + Math.floor(r() * 44), y0 = 34 + Math.floor(r() * 12), len = 10 + Math.floor(r() * 16);
    R(x, y0, 1, len, r() < 0.5 ? leaf.d : leaf.b);
  }
  return outlined(c);
}
export function boulderSprite(seed, snowy = false) {
  const r = rng(seed), [c, g] = natureCanvas(), st = ramp(pick(['#8e8a82', '#9a958c', '#857f78']));
  // Más arriba y algo más baja que antes: la parte de abajo se salía del lienzo y quedaba plana
  const w = 18 + Math.floor(r() * 8), h = 10 + Math.floor(r() * 5);
  ellipse(g, 36, 80, w, h, st.d);
  ellipse(g, 35, 77, w - 2, h - 2, st.b);
  ellipse(g, 31, 73, Math.floor(w * 0.5), Math.floor(h * 0.45), st.l);
  line(g, 30, 76, 38, 82, st.d2); line(g, 42, 74, 46, 80, st.d2);
  if (snowy) { ellipse(g, 34, 71, w - 6, Math.floor(h * 0.45), '#f4f8fc'); ellipse(g, 30, 70, Math.floor(w * 0.4), 2, '#ffffff'); }
  else if (r() < 0.5) { ellipse(g, 30, 70, 6, 2, '#5a7a3a'); }
  return outlined(c);
}

// Variantes compartidas: el mundo infinito reutiliza unas pocas imágenes en lugar de crear una por objeto
export function buildProps() {
  const seeds = n => Array.from({ length: n }, () => Math.floor(rand() * 1e6));
  return {
    oak: seeds(8).map(s => treeSprite('oak', s)),
    pine: seeds(6).map(s => treeSprite('pine', s)),
    fruit: seeds(2).map(s => treeSprite('fruit', s)),
    snowPine: seeds(5).map(snowPineSprite),
    palm: seeds(4).map(palmSprite),
    cactus: seeds(5).map(cactusSprite),
    deadBush: seeds(3).map(deadBushSprite),
    swampTree: seeds(4).map(swampTreeSprite),
    boulder: seeds(4).map(s => boulderSprite(s)),
    snowBoulder: seeds(3).map(s => boulderSprite(s, true)),
    bush: [null, '#ff7aa8', '#ffe04a', '#ffffff', '#b48aff'].map(f => bushSprite(f)),
    rock: [0.6, 0.75, 0.9, 1].map(s => rockSprite(s)),
    fenceX: fenceSprite('x'), fenceY: fenceSprite('y'),
    mailbox: mailboxSprite(), lamp: lampSprite(), sign: signSprite(), house: houseSprite(),
    houseBlue: houseSprite('#4a6aa8', '#efe6d4'), houseGrey: houseSprite('#6a6a74', '#e8dcc8'), houseGreen: houseSprite('#4a8a5a', '#f4e8d0'),
    stall: stallSprite(), stall2: stallSprite('#3a6ab8', ['#f0d040', '#e8822a', '#f4ecd8']), stall3: stallSprite('#3f8a4a', ['#a8c0d8', '#d8502a', '#e0806a']),
    board: boardSprite(), fountain: fountainSprite(), dock: dockSprite(), museum: placeSprite('vitrina'),
  };
}
