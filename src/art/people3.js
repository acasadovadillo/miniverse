// Personajes, diseño propio al estilo de los avatares isométricos clásicos: contorno negro, colores planos
// con una sola sombra, cabeza pequeña y cuerpo alto, ojos de raya y nariz que asoma. Se ven desde 8 lados:
// 'down' (de frente), 'front' (de frente en diagonal, mirando abajo a la derecha), 'side' (de perfil, a la
// derecha), 'back' (de espaldas en diagonal, mirando arriba a la derecha) y 'up' (de espaldas); para las
// diagonales y el perfil de la izquierda el juego da la vuelta al dibujo.
// Mismas funciones que people.js, para poder cambiar uno por otro sin tocar nada más.
import { mk, ramp, mixHex } from '../util.js';
import { LOOK_OPTIONS as BASE_OPTIONS, DEFAULT_LOOK } from './people.js';

export const SW = 34, SH = 54, OX = 0, OY = 0, FEET_X = 17, FEET_Y = 50;
export const LOOK_OPTIONS = { ...BASE_OPTIONS, hairStyle: [...BASE_OPTIONS.hairStyle, ['pinchos', 'Pinchos']] };
export { DEFAULT_LOOK };

const INK = '#17110f';

// Contorno negro alrededor de todo lo pintado
function ink(src) {
  const w = src.width, h = src.height, g = src.getContext('2d'), img = g.getImageData(0, 0, w, h), d = img.data, out = new Uint8ClampedArray(d);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (d[i + 3]) continue;
    const near = [[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dx, dy]) => {
      const xx = x + dx, yy = y + dy;
      return xx >= 0 && yy >= 0 && xx < w && yy < h && d[(yy * w + xx) * 4 + 3] > 200;
    });
    if (near) { out[i] = 0x17; out[i + 1] = 0x11; out[i + 2] = 0x0f; out[i + 3] = 255; }
  }
  img.data.set(out);
  g.putImageData(img, 0, 0);
  return src;
}

function palette(o) {
  const skin = ramp(o.skin), hair = ramp(o.hair), girl = o.sex === 'chica';
  return {
    skin, hair, girl, main: ramp(o.cloth), pants: ramp(o.pants || '#3a3a4a'), shoes: ramp('#4a3226'), shirt: ramp('#ece6da'), apron: ramp('#efe8da'),
    eye: mixHex(ramp(o.eyes || '#3a2a1e').d2, '#000000', 0.45), mouth: girl ? mixHex(skin.d2, '#d0405a', 0.55) : skin.d2,
    buzz: mixHex(o.skin, o.hair, 0.6), belt: '#4a3020', gold: '#e8c050', tie: '#d04848',
  };
}

// Cabezas: filas [y, x0, x1]
const HEAD_F = [[5, 13, 20], [6, 11, 22], ...Array.from({ length: 10 }, (_, i) => [7 + i, 10, 23]), [17, 11, 23], [18, 12, 22], [19, 14, 21]];
const HEAD_S = [[5, 14, 20], [6, 12, 22], ...Array.from({ length: 10 }, (_, i) => [7 + i, 11, 23]), [17, 12, 23], [18, 13, 22], [19, 15, 21]];
// De frente y de espaldas rectos: cabeza centrada en x = 17 (el centro de los pies)
const HEAD_D = [[5, 14, 20], [6, 12, 22], ...Array.from({ length: 10 }, (_, i) => [7 + i, 11, 23]), [17, 12, 22], [18, 13, 21], [19, 15, 19]];
const CAP_D = [[3, 14, 20], [4, 12, 22], [5, 11, 23], [6, 10, 24], [7, 10, 24]];
// Casquete de pelo (de frente y de espaldas) y de perfil
const CAP = [[3, 13, 20], [4, 11, 22], [5, 10, 23], [6, 9, 24], [7, 9, 24]];
const CAP_S = [[3, 14, 20], [4, 12, 22], [5, 11, 23], [6, 10, 24], [7, 10, 24]];

export function paintPerson(o, view, frame) {
  const c = mk(SW, SH), g = c.getContext('2d'), C = palette(o);
  const { skin, hair, girl, pants, shoes } = C;
  const R = (x, y, w, h, col) => { if (w > 0 && h > 0) { g.fillStyle = col; g.fillRect(x, y, w, h); } };
  const P = (x, y, col) => R(x, y, 1, 1, col);
  const rows = (spec, col) => { for (const [y, x0, x1] of spec) R(x0, y, x1 - x0 + 1, 1, col); };
  const style = o.hairStyle, outfit = o.outfit, top = outfit === 'chaleco' ? C.shirt : C.main, dress = outfit === 'larga';
  const lift = frame === 1 ? [0, 2] : frame === 3 ? [2, 0] : [0, 0];
  const hand = frame === 1 ? [1, -1] : frame === 3 ? [-1, 1] : [0, 0];

  if (view === 'side') paintSide();
  else if (view === 'down' || view === 'up') paintStraight(view === 'down');
  else paintFrontBack(view === 'front');

  if (frame === 1 || frame === 3) {   // al apoyar el pie, el cuerpo baja un píxel
    const b = mk(SW, SH), bg = b.getContext('2d'), y = 36;
    bg.drawImage(c, 0, y, SW, SH - y, 0, y, SW, SH - y);
    bg.drawImage(c, 0, 0, SW, y, 0, 1, SW, y);
    return ink(b);
  }
  return ink(c);

  // ---------- pelo: piezas comunes ----------
  // Pinchos: triángulos que salen del casquete, inclinados hacia fuera
  function spikes(list, base = 6) {
    for (const [cx, topY, lean] of list) for (let y = topY; y <= base; y++) {
      const half = Math.floor((y - topY) / 2), sx = cx + Math.floor((base - y) / 2) * lean;
      R(sx - half, y, half * 2 + 1, 1, hair.b);
      P(sx - half, y, y < base - 1 ? hair.l : hair.b);
      if (half) P(sx + half, y, hair.d);
    }
  }
  function bun(cx, cy) {
    for (let y = -3; y <= 3; y++) { const w = Math.round(Math.sqrt(10 - y * y)); R(cx - w, cy + y, w * 2 + 1, 1, hair.b); P(cx + w, cy + y, hair.d); }
    R(cx - 1, cy - 2, 2, 1, hair.l); P(cx - 2, cy - 1, hair.l);
    R(cx - 2, cy + 3, 5, 1, C.tie);
  }
  // Rizos: masa redonda con borde ondulado y rizos marcados; keep(x, y) dice qué parte se ve
  function curls(cx, cy, rx, ry, keep) {
    for (let y = 1; y < 22; y++) for (let x = 1; x < SW - 1; x++) {
      const a = Math.atan2(y - cy, x - cx), k = 1 + 0.09 * Math.sin(a * 9);
      if (((x - cx) / (rx * k)) ** 2 + ((y - cy) / (ry * k)) ** 2 > 1 || !keep(x, y)) continue;
      // Cada rizo es una celda de 4×4 (filas desplazadas) con luz arriba a la izquierda y una curva oscura abajo
      const row = Math.floor(y / 4), u = (x + (row % 2) * 2) % 4, v = y % 4;
      const dark = (v === 3 && u > 0) || (u === 3 && v === 2), light = (u === 1 && v === 0) || (u === 0 && v === 1);
      P(x, y, dark ? hair.d : light && x < cx + 3 ? hair.l : x > cx + rx - 3 ? hair.d : hair.b);
    }
  }

  // ---------- de frente y de espaldas ----------
  function paintFrontBack(front) {
    // Pelo que queda detrás del cuerpo
    if (style === 'largo') {
      if (front) { R(7, 10, 6, 21, hair.b); R(7, 10, 2, 21, hair.d); for (const x of [7, 10]) P(x, 31, hair.d); }
    }
    if (style === 'coleta' && front) { R(5, 10, 4, 12, hair.b); R(5, 10, 1, 12, hair.d); R(6, 22, 2, 2, hair.d); }
    legsFB(front);
    torsoFB(front);
    if (front) { headFront(); hairFront(); } else { headBack(); hairBack(); }
  }

  function legsFB(front) {
    // Zapatos (de frente asoma la punta hacia la derecha; de espaldas, solo el talón)
    for (const [x, i] of [[11, 0], [19, 1]]) {
      const y = 46 - lift[i], col = front ? shoes : { b: shoes.d, l: shoes.b, d: shoes.d2 }, sx = front ? x : x + 1, w = front ? 7 : 5;
      R(sx, y, w, 4, col.b); R(sx, y, w, 1, col.l); R(sx, y + 3, w, 1, col.d);
    }
    if (dress) return;
    const near = front ? pants.b : pants.d, far = front ? pants.d : pants.b;
    R(12, 36, 12, 1, pants.d);
    R(12, 37, 6, 9 - lift[0], far); R(19, 37, 5, 9 - lift[1], near);
    if (front) { R(12, 37, 2, 9 - lift[0], pants.d2); R(23, 37, 1, 9 - lift[1], pants.d); }
    else { R(12, 37, 1, 9 - lift[0], pants.l); R(22, 37, 2, 9 - lift[1], pants.d2); }
    R(18, 37, 1, 9 - Math.max(...lift), INK);
  }

  function torsoFB(front) {
    const t = top, side = front ? t.d : t.b, far = front ? t.b : t.d;
    // Hombros, cuerpo y brazos (con un hueco entre brazo y cuerpo que se llena de contorno)
    rows([[21, 12, 23], [22, 10, 25], [23, 8, 27]], t.b);
    R(12, 24, 12, 12, t.b);
    if (front) { R(12, 22, 3, 14, t.d); R(10, 22, 2, 2, t.d); R(15, 22, 4, 1, t.l); }
    else { R(21, 22, 3, 14, t.d); R(24, 22, 2, 2, t.d); R(12, 22, 4, 1, t.l); }
    R(12, 35, 12, 1, t.d);
    R(8, 24, 3, 10 + hand[0], side); R(25, 24, 3, 10 + hand[1], far);
    // Manos
    R(8, 34 + hand[0], 3, 3, front ? skin.d : skin.b); R(25, 34 + hand[1], 3, 3, front ? skin.b : skin.d);
    R(8, 36 + hand[0], 3, 1, skin.d); R(25, 36 + hand[1], 3, 1, skin.d);
    // Ropa
    if (outfit === 'chaleco') {
      const v = C.main;
      R(12, 22, 12, 14, v.b); R(front ? 12 : 21, 22, 3, 14, v.d);
      if (front) { R(17, 22, 2, 14, C.shirt.b); R(17, 22, 1, 14, C.shirt.d); for (const y of [26, 30]) P(19, y, C.gold); }
      else R(17, 24, 1, 11, v.d);
      R(12, 35, 12, 1, v.d);
    } else if (outfit === 'delantal') {
      const a = C.apron;
      if (front) { R(16, 22, 1, 6, a.d); R(21, 22, 1, 6, a.d); R(15, 27, 8, 13, a.b); R(15, 27, 8, 1, a.d); R(15, 27, 1, 13, a.d); R(17, 31, 4, 3, a.d); R(18, 31, 2, 1, a.b); }
      else { R(12, 31, 12, 1, a.b); R(16, 30, 4, 3, a.b); R(17, 31, 2, 1, a.d); R(16, 33, 1, 3, a.b); R(19, 33, 1, 3, a.b); }
    } else if (outfit === 'tunica') {
      R(11, 36, 14, 4, t.b); R(front ? 11 : 21, 36, 3, 4, t.d); R(11, 39, 14, 1, t.d);
      R(12, 33, 12, 2, C.belt); if (front) R(18, 33, 2, 2, C.gold);
    } else if (dress) {
      for (let y = 36; y <= 45; y++) { const w = Math.floor((y - 36) / 3), sway = y > 42 ? hand[0] : 0; R(12 - w + sway, y, 12 + 2 * w, 1, t.b); R((front ? 12 : 21 + w) - (front ? w : 0) + sway, y, 3, 1, t.d); }
      R(12, 33, 12, 2, C.gold); R(12, 34, 12, 1, mixHex(C.gold, '#000000', 0.25));
    }
    // Cuello en pico (de frente)
    if (front && outfit !== 'chaleco') { rows([[21, 16, 19], [22, 17, 18]], skin.b); }
  }

  function headFront() {
    R(14, 19, 6, 3, skin.d);                                             // cuello
    rows(HEAD_F, skin.b);
    R(10, 8, 2, 9, skin.d); R(11, 17, 3, 1, skin.d); R(12, 18, 3, 1, skin.d);   // lado en sombra
    R(8, 11, 2, 4, skin.b); R(9, 12, 1, 2, skin.d);                       // oreja
    R(24, 12, 1, 2, skin.b); P(24, 13, skin.d);                           // nariz
    for (const ex of [17, 21]) { P(ex - 1, 11, '#ffffff'); R(ex, 11, 1, 2, C.eye); if (girl) R(ex - 1, 10, 3, 1, INK); }
    if (o.beard) {
      rows([[15, 12, 13], [16, 12, 23], [17, 12, 23], [18, 13, 22], [19, 14, 21], [20, 15, 20]], hair.b);
      R(12, 15, 2, 4, hair.d); R(15, 20, 6, 1, hair.d); P(16, 17, hair.l); P(20, 18, hair.l);
      R(19, 16, 3, 1, mixHex(hair.d2, '#000000', 0.3));
    } else R(19, 16, girl ? 2 : 3, 1, C.mouth);
  }

  // Casquete con flequillo dentado; toLeft = hasta dónde baja el pelo por detrás de la oreja
  function capFront(toLeft = 11) {
    rows(CAP, hair.b);
    [9, 8, 8, 9, 8, 8, 8, 9, 8, 8].forEach((b, i) => { R(15 + i, 8, 1, b - 7, hair.b); P(15 + i, b, hair.d); });
    R(9, 8, 6, 2, hair.b); R(10, 10, 3, toLeft - 9, hair.b); R(13, 10, 1, 3, hair.b);
    R(9, 6, 2, 4, hair.d); R(10, 10, 1, toLeft - 9, hair.d);
    R(14, 4, 5, 1, hair.l); R(12, 5, 3, 1, hair.l); P(15, 3, hair.l2);
    for (const x of [17, 21]) R(x, 5, 1, 3, hair.d);
  }
  function hairFront() {
    if (style === 'corto') capFront();
    else if (style === 'pinchos') { capFront(); spikes([[9, 3, -1], [12, 1, -1], [15, 1, 0], [18, 1, 0], [21, 2, 1], [24, 4, 1]]); }
    else if (style === 'largo') { capFront(18); R(9, 8, 4, 11, hair.b); R(9, 8, 1, 11, hair.d); R(23, 8, 2, 8, hair.b); P(24, 15, hair.d); P(12, 18, hair.d); }
    else if (style === 'coleta') { capFront(); R(8, 8, 2, 2, C.tie); }
    else if (style === 'mono') { capFront(); bun(12, 4); }
    else if (style === 'rizado') curls(16, 8, 9.5, 7.5, (x, y) => y < 9 || x < 14);
    else if (style === 'rapado') {
      rows([[4, 12, 21], [5, 10, 23], [6, 10, 23], [7, 10, 23]], C.buzz); R(10, 8, 3, 3, C.buzz);
      for (let y = 4; y < 11; y++) for (let x = 10; x < 24; x++) if ((x * 2 + y * 3) % 5 === 0 && (y < 8 || x < 13)) P(x, y, hair.b);
    } else if (style === 'calvo') { R(10, 9, 3, 4, hair.b); R(10, 9, 1, 4, hair.d); R(14, 6, 3, 1, skin.l); }
  }

  function headBack() {
    R(14, 18, 6, 4, skin.d);
    rows(HEAD_F, skin.b);
    R(10, 7, 3, 11, skin.d);
    R(23, 11, 2, 4, skin.b); P(23, 12, skin.d);                           // oreja
  }
  function capBack(to = 14) {
    rows([...CAP, ...Array.from({ length: to - 7 }, (_, i) => [8 + i, 9, i < 3 ? 23 : 20]), [to + 1, 11, 19]], hair.b);
    for (const [y, , x1] of CAP) R(x1 - 4, y, 4, 1, hair.d);
    R(9, 6, 2, to - 5, hair.d);
    for (const x of [13, 17]) R(x, 6, 1, to - 6, hair.d);
    R(12, 4, 4, 1, hair.l); R(11, 5, 2, 1, hair.l); P(14, 3, hair.l2);
  }
  function hairBack() {
    if (style === 'corto') capBack();
    else if (style === 'pinchos') { capBack(); spikes([[9, 4, -1], [12, 1, -1], [15, 1, 0], [18, 1, 0], [21, 2, 1], [24, 4, 1]]); }
    else if (style === 'largo') { capBack(); R(10, 15, 13, 15, hair.b); R(10, 15, 2, 15, hair.d); R(20, 15, 3, 15, hair.d); for (const x of [11, 14, 17, 20]) P(x, 30, hair.b); R(16, 16, 1, 12, hair.d); }
    else if (style === 'coleta') { capBack(); R(15, 7, 3, 2, C.tie); R(15, 9, 3, 15, hair.b); R(17, 9, 1, 15, hair.d); P(16, 24, hair.d); }
    else if (style === 'mono') { capBack(); bun(16, 4); }
    else if (style === 'rizado') curls(16, 9, 9.5, 8, (x, y) => !(x > 21 && y > 10));
    else if (style === 'rapado') {
      rows([[4, 12, 21], [5, 10, 23], [6, 10, 23], ...Array.from({ length: 8 }, (_, i) => [7 + i, 10, 22])], C.buzz);
      for (let y = 4; y < 15; y++) for (let x = 10; x < 23; x++) if ((x * 2 + y * 3) % 5 === 0) P(x, y, hair.b);
    } else if (style === 'calvo') { rows([[12, 10, 22], [13, 10, 22], [14, 10, 22], [15, 10, 21], [16, 11, 21], [17, 12, 20]], hair.b); R(10, 12, 2, 4, hair.d); R(13, 6, 3, 1, skin.l); }
  }

  // ---------- de frente y de espaldas rectos (simétricos, centrados en x = 17) ----------
  function paintStraight(front) {
    // Pelo que queda detrás del cuerpo
    if (style === 'largo' && front) { R(9, 10, 3, 20, hair.d); R(23, 10, 3, 20, hair.d2); }
    if (style === 'coleta' && front) { R(25, 8, 3, 9, hair.d); R(25, 17, 2, 2, hair.d2); }
    legsStraight(front);
    torsoStraight(front);
    if (front) { headDown(); hairDown(); } else { headUp(); hairUp(); }
  }
  function legsStraight(front) {
    for (const [x, i] of [[11, 0], [18, 1]]) {
      const y = 46 - lift[i], col = front ? shoes : { b: shoes.d, l: shoes.b, d: shoes.d2 }, sx = front ? x : x + 1, w = front ? 6 : 5;
      R(sx, y, w, 4, col.b); R(sx, y, w, 1, col.l); R(sx, y + 3, w, 1, col.d);
    }
    if (dress) return;
    R(12, 36, 11, 1, pants.d);
    R(12, 37, 5, 9 - lift[0], front ? pants.b : pants.d); R(18, 37, 5, 9 - lift[1], front ? pants.d : pants.b);
    R(12, 37, 1, 9 - lift[0], front ? pants.l : pants.d2); R(22, 37, 1, 9 - lift[1], pants.d2);
    R(17, 37, 1, 9 - Math.max(...lift), INK);
  }
  function torsoStraight(front) {
    const t = top;
    // Hombros, cuerpo y los dos brazos a los lados (luz desde la izquierda)
    rows([[21, 13, 21], [22, 11, 23], [23, 7, 27]], t.b);
    R(11, 24, 13, 12, t.b); R(21, 22, 3, 14, t.d); R(12, 22, 3, 1, t.l); R(11, 35, 13, 1, t.d);
    R(7, 24, 3, 10 + hand[0], t.b); R(7, 24, 1, 10 + hand[0], t.l); R(25, 24, 3, 10 + hand[1], t.d);
    R(7, 34 + hand[0], 3, 3, skin.b); R(25, 34 + hand[1], 3, 3, skin.d);
    R(7, 36 + hand[0], 3, 1, skin.d); R(25, 36 + hand[1], 3, 1, skin.d);
    if (outfit === 'chaleco') {
      const v = C.main;
      R(11, 22, 13, 14, v.b); R(21, 22, 3, 14, v.d); R(11, 35, 13, 1, v.d);
      if (front) { R(16, 22, 3, 14, C.shirt.b); R(18, 22, 1, 14, C.shirt.d); for (const y of [26, 30]) P(15, y, C.gold); }
      else R(17, 24, 1, 11, v.d);
      R(7, 31 + hand[0], 3, 1, C.shirt.d); R(25, 31 + hand[1], 3, 1, C.shirt.d2);
    } else if (outfit === 'delantal') {
      const a = C.apron;
      if (front) { R(14, 22, 1, 6, a.d); R(20, 22, 1, 6, a.d); R(13, 27, 9, 13, a.b); R(13, 27, 9, 1, a.d); R(21, 27, 1, 13, a.d); R(15, 31, 5, 3, a.d); R(16, 31, 3, 1, a.b); }
      else { R(11, 31, 13, 1, a.b); R(15, 30, 5, 3, a.b); R(16, 31, 3, 1, a.d); R(15, 33, 1, 3, a.b); R(19, 33, 1, 3, a.b); }
    } else if (outfit === 'tunica') {
      R(10, 36, 15, 4, t.b); R(22, 36, 3, 4, t.d); R(10, 39, 15, 1, t.d);
      R(11, 33, 13, 2, C.belt); if (front) R(16, 33, 3, 2, C.gold);
    } else if (dress) {
      for (let y = 36; y <= 45; y++) { const w = Math.floor((y - 36) / 3), sway = y > 42 ? hand[0] : 0; R(11 - w + sway, y, 13 + 2 * w, 1, t.b); R(21 + w + sway, y, 3, 1, t.d); }
      R(11, 33, 13, 2, C.gold); R(11, 34, 13, 1, mixHex(C.gold, '#000000', 0.25));
    }
    if (front && outfit !== 'chaleco') rows([[21, 15, 19], [22, 16, 18]], skin.b);   // cuello en pico
  }
  function headDown() {
    R(15, 19, 5, 3, skin.d);                                              // cuello
    R(10, 11, 1, 4, skin.b); R(24, 11, 1, 4, skin.d);                     // orejas
    rows(HEAD_D, skin.b);
    R(22, 8, 2, 9, skin.d); R(20, 17, 3, 1, skin.d); R(19, 18, 3, 1, skin.d);   // lado en sombra
    P(17, 14, skin.d); P(18, 14, skin.d);                                 // nariz
    for (const ex of [14, 20]) { P(ex - 1, 11, '#ffffff'); R(ex, 11, 1, 2, C.eye); if (girl) R(ex - 1, 10, 3, 1, INK); }
    if (o.beard) {
      rows([[15, 11, 12], [15, 22, 23], [16, 11, 23], [17, 12, 22], [18, 13, 21], [19, 14, 20], [20, 15, 19]], hair.b);
      R(21, 15, 3, 4, hair.d); R(15, 20, 5, 1, hair.d); P(14, 17, hair.l); P(19, 18, hair.l);
      R(16, 16, 3, 1, mixHex(hair.d2, '#000000', 0.3));
    } else R(girl ? 16 : 15, 16, girl ? 3 : 5, 1, C.mouth);
  }
  // Casquete con flequillo dentado, simétrico; toSide = hasta dónde baja el pelo a los lados
  function capDown(toSide = 10) {
    rows(CAP_D, hair.b);
    [8, 9, 8, 8, 9, 8, 8, 9, 8, 8, 9].forEach((b, i) => { R(12 + i, 8, 1, b - 7, hair.b); P(12 + i, b, hair.d); });
    R(10, 8, 2, toSide - 7, hair.b); R(23, 8, 2, toSide - 7, hair.d);
    R(21, 4, 3, 4, hair.d);
    R(13, 4, 5, 1, hair.l); R(12, 5, 3, 1, hair.l); P(15, 3, hair.l2);
    for (const x of [14, 19]) R(x, 5, 1, 3, hair.d);
  }
  function hairDown() {
    if (style === 'corto') capDown();
    else if (style === 'pinchos') { capDown(); spikes([[10, 4, -1], [13, 1, -1], [17, 1, 0], [21, 1, 1], [24, 4, 1]]); }
    else if (style === 'largo') { capDown(18); R(10, 8, 2, 13, hair.b); R(23, 8, 2, 13, hair.d); P(10, 20, hair.d); P(24, 20, hair.d2); }
    else if (style === 'coleta') { capDown(); R(24, 7, 2, 2, C.tie); }
    else if (style === 'mono') { capDown(); bun(17, 4); }
    else if (style === 'rizado') curls(17, 8, 9.5, 7.5, (x, y) => y < 9 || x < 12 || x > 22);
    else if (style === 'rapado') {
      rows([[4, 13, 21], [5, 11, 23], [6, 11, 23], [7, 11, 23]], C.buzz);
      for (let y = 4; y < 8; y++) for (let x = 11; x < 24; x++) if ((x * 2 + y * 3) % 5 === 0) P(x, y, hair.b);
      R(21, 5, 3, 3, mixHex(C.buzz, hair.d, 0.5));
    } else if (style === 'calvo') { R(10, 9, 2, 4, hair.b); R(23, 9, 2, 4, hair.d); R(14, 6, 3, 1, skin.l); }
  }
  function headUp() {
    R(14, 18, 7, 4, skin.d);
    R(10, 11, 1, 3, skin.b); R(24, 11, 1, 3, skin.d);                     // orejas
    rows(HEAD_D, skin.b);
    R(21, 7, 3, 11, skin.d);
  }
  function capUp(to = 14) {
    rows([...CAP_D, ...Array.from({ length: to - 7 }, (_, i) => [8 + i, 10, 24]), [to + 1, 12, 22]], hair.b);
    R(21, 4, 4, to - 3, hair.d);
    for (const x of [14, 19]) R(x, 6, 1, to - 6, hair.d);
    R(13, 4, 4, 1, hair.l); R(11, 6, 2, 3, hair.l); P(15, 3, hair.l2);
  }
  function hairUp() {
    if (style === 'corto') capUp();
    else if (style === 'pinchos') { capUp(); spikes([[10, 4, -1], [13, 1, -1], [17, 1, 0], [21, 1, 1], [24, 4, 1]]); }
    else if (style === 'largo') { capUp(); R(10, 15, 15, 15, hair.b); R(21, 15, 4, 15, hair.d); R(12, 15, 2, 13, hair.l); R(17, 16, 1, 12, hair.d); for (const x of [11, 15, 19, 23]) P(x, 30, hair.b); }
    else if (style === 'coleta') { capUp(); R(16, 7, 3, 2, C.tie); R(16, 9, 3, 15, hair.b); R(18, 9, 1, 15, hair.d); P(17, 24, hair.d); }
    else if (style === 'mono') { capUp(); bun(17, 4); }
    else if (style === 'rizado') curls(17, 9, 9.5, 8, () => true);
    else if (style === 'rapado') {
      rows([[4, 13, 21], [5, 11, 23], [6, 11, 23], ...Array.from({ length: 8 }, (_, i) => [7 + i, 11, 23])], C.buzz);
      for (let y = 4; y < 15; y++) for (let x = 11; x < 24; x++) if ((x * 2 + y * 3) % 5 === 0) P(x, y, hair.b);
      R(21, 5, 3, 10, mixHex(C.buzz, hair.d, 0.5));
    } else if (style === 'calvo') { rows([[12, 11, 23], [13, 11, 23], [14, 11, 23], [15, 12, 22], [16, 12, 22], [17, 13, 21]], hair.b); R(21, 12, 3, 6, hair.d); R(14, 6, 3, 1, skin.l); }
  }

  // ---------- de perfil (mirando a la derecha) ----------
  function paintSide() {
    const sw = frame === 1 ? 2 : frame === 3 ? -2 : 0, arm = Math.sign(sw);
    if (style === 'largo') { R(9, 9, 6, 22, hair.b); R(9, 9, 2, 22, hair.d); }
    if (style === 'coleta') { R(6, 10, 4, 12, hair.b); R(6, 10, 1, 12, hair.d); R(7, 22, 2, 2, hair.d); }
    // Piernas: la de atrás más oscura; al andar se separan
    const leg = (x, col, shoe) => {
      if (!dress) { R(x, 36, 5, 10, col.b); R(x, 36, 1, 10, col.d); }
      R(x, 46, 7, 4, shoe.b); R(x, 46, 7, 1, shoe.l); R(x, 49, 7, 1, shoe.d);
    };
    leg(15 - sw, { b: pants.d, d: pants.d2 }, { b: shoes.d, l: shoes.b, d: shoes.d2 });
    leg(15 + sw, pants, shoes);
    if (sw && !dress) R(14 + sw, 37, 1, 9, INK);
    // Cuerpo
    const t = top;
    rows([[21, 14, 20], [22, 13, 21]], t.b);
    R(13, 23, 9, 13, t.b); R(13, 22, 2, 14, t.d); R(13, 35, 9, 1, t.d);
    if (outfit === 'chaleco') { R(13, 22, 7, 14, C.main.b); R(13, 22, 2, 14, C.main.d); P(20, 26, C.gold); P(20, 30, C.gold); }
    else if (outfit === 'delantal') { R(20, 25, 2, 15, C.apron.b); R(20, 25, 1, 15, C.apron.d); R(13, 31, 7, 1, C.apron.d); }
    else if (outfit === 'tunica') { R(12, 36, 11, 4, t.b); R(12, 36, 2, 4, t.d); R(12, 39, 11, 1, t.d); R(13, 33, 9, 2, C.belt); P(21, 33, C.gold); }
    else if (dress) { for (let y = 36; y <= 45; y++) { const w = Math.floor((y - 36) / 3); R(13 - w, y, 9 + 2 * w, 1, t.b); R(13 - w, y, 2, 1, t.d); } R(13, 33, 9, 2, C.gold); }
    // Brazo de delante, con su contorno sobre el cuerpo
    const ax = 15 + arm, sleeve = outfit === 'chaleco' ? C.shirt : t;
    R(ax, 23, 4, 11, sleeve.b); R(ax, 23, 1, 11, sleeve.l); R(ax + 3, 23, 1, 11, sleeve.d);
    R(ax, 34, 4, 3, skin.b); R(ax, 36, 4, 1, skin.d);
    R(ax - 1, 24, 1, 13, INK); R(ax + 4, 24, 1, 13, INK); R(ax, 37, 4, 1, INK);
    // Cabeza
    R(15, 19, 5, 3, skin.d);
    rows(HEAD_S, skin.b);
    R(11, 8, 2, 9, skin.d);
    R(15, 11, 2, 4, skin.d); R(15, 12, 1, 2, skin.d2);                    // oreja
    R(24, 12, 1, 2, skin.b); P(24, 13, skin.d);                           // nariz
    P(20, 11, '#ffffff'); R(21, 11, 1, 2, C.eye); if (girl) R(20, 10, 3, 1, INK);
    if (girl) R(22, 16, 2, 1, C.mouth);
    if (o.beard) { rows([[14, 15, 16], [15, 15, 16], [16, 16, 23], [17, 15, 23], [18, 15, 22], [19, 16, 21], [20, 17, 20]], hair.b); R(15, 14, 2, 5, hair.d); }
    hairSide();
  }
  function capSide(toBack = 13) {
    rows(CAP_S, hair.b);
    [8, 9, 8, 8, 9, 8].forEach((b, i) => { R(19 + i, 8, 1, b - 7, hair.b); P(19 + i, b, hair.d); });
    R(10, 8, 9, 3, hair.b); R(10, 11, 5, toBack - 10, hair.b); R(11, toBack, 3, 1, hair.b);
    R(10, 6, 2, toBack - 5, hair.d);
    R(14, 4, 5, 1, hair.l); R(13, 5, 3, 1, hair.l); P(16, 3, hair.l2);
    for (const x of [15, 19]) R(x, 5, 1, 3, hair.d);
  }
  function hairSide() {
    if (style === 'corto') capSide();
    else if (style === 'pinchos') { capSide(); spikes([[11, 3, -1], [14, 1, -1], [17, 1, -1], [20, 2, 0], [23, 4, 1]]); }
    else if (style === 'largo') { capSide(17); R(10, 11, 5, 8, hair.b); R(10, 11, 1, 8, hair.d); }
    else if (style === 'coleta') { capSide(); R(9, 8, 2, 2, C.tie); }
    else if (style === 'mono') { capSide(); bun(12, 4); }
    else if (style === 'rizado') curls(16, 8, 9, 7.5, (x, y) => y < 9 || x < 17);
    else if (style === 'rapado') {
      rows([[4, 13, 21], [5, 11, 23], [6, 11, 23], [7, 11, 23]], C.buzz); R(11, 8, 4, 5, C.buzz);
      for (let y = 4; y < 13; y++) for (let x = 11; x < 24; x++) if ((x * 2 + y * 3) % 5 === 0 && (y < 8 || x < 15)) P(x, y, hair.b);
    } else if (style === 'calvo') { R(11, 9, 4, 4, hair.b); R(11, 9, 1, 4, hair.d); R(16, 6, 3, 1, skin.l); }
  }
}

export const VIEWS = ['down', 'front', 'side', 'back', 'up'];
// Vista y volteo según hacia dónde se mueve en pantalla (sx, sy): 8 direcciones
const VIEW8 = [['side', false], ['front', false], ['down', false], ['front', true], ['side', true], ['back', true], ['up', false], ['back', false]];
export function viewFor(sx, sy) {
  const k = ((Math.round(Math.atan2(sy, sx) / (Math.PI / 4)) % 8) + 8) % 8;   // 0 derecha, 2 abajo, 4 izquierda, 6 arriba
  return VIEW8[k];
}
// Al revés: hacia dónde en pantalla (sx, sy) mira una vista
export function screenDirOf(view, flip) {
  const k = Math.max(0, VIEW8.findIndex(([v, f]) => v === view && f === !!flip)), a = (k * Math.PI) / 4;
  return [Math.cos(a), Math.sin(a)];
}
export function personSprites(o) {
  const s = {};
  for (const view of VIEWS) s[view] = [0, 1, 2, 3, 4].map(fr => paintPerson(o, view, fr));
  return s;
}

// Retrato para los diálogos: la cabeza del propio muñeco, ampliada al doble
export function portrait(o) {
  const s = paintPerson(o, 'front', 0), c = mk(48, 48), g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(s, 5, 0, 24, 24, 0, 0, 48, 48);
  return c;
}
