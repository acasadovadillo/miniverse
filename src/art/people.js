// Personajes en pixel art (34×54): vista de frente, de espaldas y de perfil (mirando a la derecha),
// con ciclo de paso de 4 fotogramas.
import { mk, ramp, mixHex, outlined } from '../util.js';

export const SW = 34, SH = 54, OX = 1, OY = 3, FEET_X = 17, FEET_Y = 50;

export const LOOK_OPTIONS = {
  sex: [['chico', 'Chico'], ['chica', 'Chica']],
  hairStyle: [['corto', 'Corto'], ['largo', 'Largo'], ['coleta', 'Coleta'], ['rizado', 'Rizado'], ['mono', 'Moño'], ['rapado', 'Rapado'], ['calvo', 'Calvo']],
  hair: ['#2a1e1e', '#4a2c1c', '#7a4a2a', '#a8442a', '#d8742a', '#e8c060', '#f0e6c8', '#a8a4ac', '#e86aa0', '#4a7ae8', '#3aa86a', '#8a4ac8'],
  skin: ['#ffe0c4', '#f6c9a0', '#e8b07a', '#c98a5a', '#a86a42', '#8a5234', '#6a3c26', '#4a2a1c', '#9ec67a', '#a8b8e8'],
  outfit: [['delantal', 'Camisa y delantal'], ['tunica', 'Túnica con cinturón'], ['chaleco', 'Camisa y chaleco'], ['larga', 'Túnica larga']],
  cloth: ['#c83a3a', '#d8742a', '#e8c050', '#4a9a4a', '#2e8a8a', '#3a5ab8', '#6a4ab8', '#b84a8a', '#6a4a2e', '#4a4a5a', '#e8e0d0'],
};
export const DEFAULT_LOOK = { sex: 'chica', hairStyle: 'coleta', hair: '#a8442a', skin: '#e8b07a', outfit: 'delantal', cloth: '#3a5ab8', pants: '#4a3a2a', eyes: '#3a8a4a' };

const HEAD_FRONT = [[4, 11, 20], [5, 9, 22], ...Array.from({ length: 12 }, (_, i) => [6 + i, 8, 23]), [18, 9, 22], [19, 11, 20]];
const HEAD_SIDE = [[4, 11, 19], [5, 9, 21], ...Array.from({ length: 12 }, (_, i) => [6 + i, 8, 22]), [18, 9, 21], [19, 11, 19]];

export function paintPerson(o, view, frame) {
  const c = mk(SW, SH), g = c.getContext('2d');
  const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x + OX, y + OY, w, h); };
  const cut = (x, y, w, h) => g.clearRect(x + OX, y + OY, w, h);
  const rows = (spec, col) => { for (const [y, x0, x1] of spec) R(x0, y, x1 - x0 + 1, 1, col); };
  const skin = ramp(o.skin), hair = ramp(o.hair), eye = ramp(o.eyes || '#6a3a1e'), main = ramp(o.cloth);
  const pants = ramp(o.pants || '#4a3a2a'), boots = ramp('#5a3a24'), shirt = ramp('#ece4d4');
  const girl = o.sex === 'chica', style = o.hairStyle, outfit = o.outfit;
  const lash = '#2a1a1a', apron = '#efe6d4', apronD = '#d8ccb4', belt = '#5a3a22', gold = '#e8c050', tie = '#c83a3a';
  const mouth = mixHex(skin.d, girl ? '#c83a5a' : '#a83a3a', girl ? 0.55 : 0.45);
  const blush = mixHex(skin.b, '#ff6a6a', girl ? 0.38 : 0.28);
  const buzz = mixHex(o.skin, o.hair, 0.6);
  const top = outfit === 'chaleco' ? shirt : main;      // color de mangas y torso base

  if (view === 'side') paintSide(); else paintFrontBack(view === 'front');

  // En los pasos de apoyo, el cuerpo baja un píxel
  if (frame === 1 || frame === 3) {
    const b = mk(SW, SH), bg = b.getContext('2d'), y = 34 + OY;
    bg.drawImage(c, 0, y, SW, SH - y, 0, y, SW, SH - y);
    bg.drawImage(c, 0, 0, SW, y, 0, 1, SW, y);
    return outlined(b);
  }
  return outlined(c);

  // ---------- de frente / de espaldas ----------
  function paintFrontBack(front) {
    const lift = frame === 1 ? [0, 2] : frame === 3 ? [2, 0] : [0, 0];
    const hand = frame === 1 ? [1, -1] : frame === 3 ? [-1, 1] : [0, 0];
    const f = front ? 1 : 0;   // de frente la cara mira un poco hacia la derecha (3/4)

    // Pelo que queda detrás del cuerpo
    if (front && style === 'largo') { R(6, 8, 20, 22, hair.d); R(6, 28, 20, 2, hair.d2); }
    if (front && style === 'coleta') { R(24, 7, 4, 5, hair.b); R(25, 12, 3, 9, hair.b); R(25, 12, 1, 9, hair.l); R(26, 21, 2, 3, hair.d); }

    // Piernas
    R(11, 34, 4, 8 - lift[0], pants.b); R(11, 34, 1, 8 - lift[0], pants.l);
    R(17, 34, 4, 8 - lift[1], pants.d); R(15, 34, 2, 3, pants.d);
    R(10, 42 - lift[0], 5, 4, boots.b); R(10, 42 - lift[0], 5, 1, boots.l); R(10, 46 - lift[0], 5, 1, boots.d2);
    R(17, 42 - lift[1], 5, 4, boots.d); R(17, 42 - lift[1], 5, 1, boots.b); R(17, 46 - lift[1], 5, 1, boots.d2);

    // Torso y brazos
    if (outfit === 'larga') {
      R(10, 22, 12, 1, main.b);
      for (let y = 23; y <= 44; y++) {
        const w = Math.floor((y - 23) / 8), sway = y > 40 ? (frame === 1 ? 1 : frame === 3 ? -1 : 0) : 0;
        R(9 - w + sway, y, 14 + 2 * w, 1, main.b); R(20 + w + sway, y, 3, 1, main.d); R(9 - w + sway, y, 1, 1, main.l);
      }
      R(7, 44, 18, 1, main.d2);
      if (front) R(15, 22, 2, 22, main.l);
      R(9, 30, 14, 2, gold); R(9, 31, 14, 1, '#b8902a');
      R(5, 23, 4, 10 + hand[0], main.b); R(5, 23, 1, 9, main.l); R(23, 23, 4, 10 + hand[1], main.d);
      R(10 - lift[0], 45, 5, 2, boots.b); R(17 + lift[1], 45, 5, 2, boots.d);
    } else {
      R(10, 22, 12, 1, top.b); R(9, 23, 14, 11, top.b); R(20, 23, 3, 11, top.d); R(9, 24, 1, 8, top.l);
      R(7, 22, 2, 1, top.b); R(6, 23, 3, 9 + hand[0], top.b); R(6, 23, 1, 8, top.l);
      R(23, 22, 2, 1, top.d); R(23, 23, 3, 9 + hand[1], top.d);
      if (girl && front) { cut(9, 27, 1, 4); cut(22, 27, 1, 4); }
      if (outfit === 'delantal') {
        if (front) {
          R(13, 22, 6, 1, main.d);
          R(11, 25, 10, 13, apron); R(11, 25, 10, 1, apronD); R(19, 26, 2, 12, apronD);
          R(13, 31, 6, 3, apronD); R(14, 31, 4, 1, apron);
        } else {
          R(9, 30, 14, 1, apron); R(14, 29, 4, 3, apron); R(15, 30, 2, 1, apronD); R(14, 32, 1, 3, apron); R(17, 32, 1, 3, apron);
        }
      } else if (outfit === 'tunica') {
        R(9, 34, 14, 4, main.b); R(20, 34, 3, 4, main.d); R(9, 37, 14, 1, main.d);
        R(9, 31, 14, 2, belt);
        if (front) { R(14, 22, 4, 2, skin.b); R(15, 24, 2, 1, skin.b); R(15, 31, 2, 2, gold); R(12, 26, 1, 4, main.d); R(18, 26, 1, 4, main.d); }
        else R(15, 25, 1, 5, main.d);
      } else if (outfit === 'chaleco') {
        R(6, 31 + hand[0], 3, 1, shirt.d); R(23, 31 + hand[1], 3, 1, shirt.d2);
        if (front) {
          R(9, 23, 5, 11, main.b); R(18, 23, 5, 11, main.d); R(10, 22, 3, 1, main.b); R(19, 22, 3, 1, main.d);
          R(9, 24, 1, 9, main.l); R(14, 22, 4, 2, shirt.l);
          for (const y of [25, 28, 31]) R(13, y, 1, 1, gold);
        } else {
          R(9, 23, 14, 11, main.b); R(20, 23, 3, 11, main.d); R(9, 24, 1, 9, main.l); R(15, 24, 2, 9, main.d);
        }
      }
    }
    R(6, 32 + hand[0], 3, 3, skin.b); R(6, 34 + hand[0], 3, 1, skin.d); R(23, 32 + hand[1], 3, 3, skin.d);
    if (outfit === 'larga') { R(5, 33 + hand[0], 3, 2, skin.b); R(24, 33 + hand[1], 3, 2, skin.d); }

    // Cabeza
    R(14, 20, 4, 2, skin.d);
    rows(HEAD_FRONT, skin.b);
    if (girl) { cut(9, 18, 1, 1); cut(22, 18, 1, 1); }
    R(22, 6, 2, 12, skin.d); R(20, 18, 3, 1, skin.d); R(19, 19, 2, 1, skin.d);
    R(7, 11, 1, 3, skin.b); R(24, 11, 1, 3, skin.d);

    if (front) {
      R(9, 7, 1, 4, skin.l);
      for (const ex of [11 + f, 19 + f]) { R(ex, 11, 2, 1, lash); R(ex, 12, 2, 1, eye.b); R(ex, 12, 1, 1, '#ffffff'); R(ex, 13, 2, 1, eye.d); }
      R(10 + f, 11, 1, 1, lash); R(21 + f, 11, 1, 1, lash);
      if (girl) { R(9 + f, 10, 1, 1, lash); R(22 + f, 10, 1, 1, lash); }
      R(10 + f, 9, 3, 1, hair.d); R(19 + f, 9, 3, 1, hair.d);
      R(16, 13, 1, 1, skin.l); R(16, 14, 2, 1, skin.d);
      R(15, 16, 4, 1, mouth); R(14, 15, 1, 1, mouth); R(19, 15, 1, 1, mouth);
      R(10 + f, 15, 2, 1, blush); R(20 + f, 15, 2, 1, blush);
      if (o.beard) {
        R(8, 13, 2, 5, hair.b); R(22, 13, 2, 5, hair.d); R(9, 17, 14, 3, hair.b); R(20, 17, 3, 3, hair.d);
        R(11, 20, 10, 1, hair.b); R(13, 21, 6, 1, hair.d); R(15, 16, 4, 1, mouth);
        R(12, 15, 9, 1, hair.b); R(13, 15, 3, 1, hair.l);
      }
      hairFront();
    } else {
      hairBack();
    }
  }

  function capFront() {
    rows([[2, 12, 19], [3, 10, 21], [4, 8, 23], [5, 7, 24], [6, 7, 24], [7, 7, 24]], hair.b);
    R(20, 4, 4, 4, hair.d); R(11, 3, 4, 1, hair.l); R(9, 4, 3, 1, hair.l); R(8, 5, 2, 1, hair.l);
  }
  function fringeFront() {
    R(10, 9, 10, 1, skin.d);
    R(7, 8, 6, 1, hair.b); R(7, 9, 3, 1, hair.b); R(16, 8, 9, 1, hair.d); R(20, 9, 5, 1, hair.d); R(12, 8, 1, 1, hair.d);
  }
  function hairFront() {
    const sides = to => { R(7, 10, 2, to - 9, hair.b); R(23, 10, 2, to - 9, hair.d); };
    if (style === 'corto') { capFront(); fringeFront(); sides(12); }
    else if (style === 'largo') { capFront(); fringeFront(); R(6, 9, 3, 19, hair.b); R(23, 9, 3, 19, hair.d); R(7, 12, 1, 10, hair.l); R(6, 26, 3, 2, hair.d); }
    else if (style === 'coleta') { capFront(); fringeFront(); sides(11); R(23, 8, 2, 2, tie); }
    else if (style === 'rizado') {
      rows([[0, 11, 20], [1, 9, 22], [2, 7, 24], [3, 6, 25], [4, 5, 26], [5, 5, 26], [6, 5, 26], [7, 5, 26]], hair.b);
      rows([[8, 5, 9], [8, 22, 26], [9, 5, 8], [9, 23, 26], [10, 5, 8], [10, 23, 26], [11, 6, 7], [11, 24, 25]], hair.b);
      R(21, 2, 5, 9, hair.d);
      for (let y = 1; y < 9; y += 2) for (let x = 7 + (y % 4 === 1 ? 0 : 1); x < 24; x += 3) { R(x, y, 1, 1, hair.l); R(x + 1, y + 1, 1, 1, hair.d); }
      R(10, 9, 12, 1, skin.d); R(9, 8, 13, 1, hair.b); R(10, 9, 2, 1, hair.b); R(14, 9, 2, 1, hair.b); R(18, 9, 2, 1, hair.d);
    } else if (style === 'mono') {
      rows([[-2, 13, 18], [-1, 12, 19], [0, 12, 19], [1, 13, 18]], hair.b);
      R(13, -1, 2, 1, hair.l); R(17, -1, 2, 2, hair.d);
      capFront(); fringeFront(); sides(11); R(13, 2, 6, 1, tie);
    } else if (style === 'rapado') {
      rows([[3, 10, 21], [4, 8, 23], [5, 8, 23], [6, 8, 23], [7, 8, 9], [7, 22, 23]], buzz);
      for (let y = 3; y < 7; y++) for (let x = 9 + (y % 2); x < 23; x += 2) R(x, y, 1, 1, hair.b);
      R(8, 8, 1, 4, buzz); R(23, 8, 1, 4, buzz);
    } else if (style === 'calvo') {
      R(7, 9, 2, 4, hair.b); R(23, 9, 2, 4, hair.d);
      R(12, 5, 3, 1, '#ffffff'); R(11, 6, 1, 1, '#fff6e8');
    }
  }
  function hairBack() {
    const full = () => {
      rows([[2, 12, 19], [3, 10, 21], [4, 8, 23], [5, 7, 24], ...Array.from({ length: 10 }, (_, i) => [6 + i, 7, 24]), [16, 8, 23]], hair.b);
      R(20, 4, 5, 12, hair.d); R(11, 3, 4, 1, hair.l); R(9, 5, 2, 6, hair.l);
      for (let y = 7; y < 15; y += 3) { R(12, y, 1, 2, hair.d); R(17, y + 1, 1, 2, hair.d); }
    };
    if (style === 'corto') full();
    else if (style === 'largo') { full(); R(6, 14, 20, 15, hair.b); R(20, 14, 6, 15, hair.d); R(8, 14, 2, 12, hair.l); R(6, 29, 20, 1, hair.d2); }
    else if (style === 'coleta') { full(); R(13, 4, 6, 2, tie); R(14, 6, 4, 14, hair.b); R(14, 6, 1, 14, hair.l); R(17, 6, 1, 14, hair.d); R(15, 20, 2, 3, hair.d); }
    else if (style === 'mono') { full(); rows([[-2, 13, 18], [-1, 12, 19], [0, 12, 19], [1, 13, 18]], hair.b); R(17, -1, 2, 2, hair.d); R(13, 2, 6, 1, tie); }
    else if (style === 'rizado') {
      rows([[0, 11, 20], [1, 9, 22], [2, 7, 24], [3, 6, 25], ...Array.from({ length: 12 }, (_, i) => [4 + i, 5, 26]), [16, 6, 25], [17, 8, 23]], hair.b);
      R(21, 2, 5, 14, hair.d);
      for (let y = 1; y < 16; y += 2) for (let x = 6 + (y % 4 === 1 ? 0 : 1); x < 25; x += 3) { R(x, y, 1, 1, hair.l); R(x + 1, y + 1, 1, 1, hair.d); }
    } else if (style === 'rapado') {
      rows([[3, 10, 21], [4, 8, 23], ...Array.from({ length: 10 }, (_, i) => [5 + i, 8, 23])], buzz);
      for (let y = 3; y < 15; y++) for (let x = 9 + (y % 2); x < 23; x += 2) R(x, y, 1, 1, hair.b);
    } else if (style === 'calvo') {
      R(8, 10, 16, 5, hair.b); R(20, 10, 4, 5, hair.d); R(12, 5, 3, 1, '#ffffff');
    }
  }

  // ---------- de perfil (mirando a la derecha) ----------
  function paintSide() {
    const sw = frame === 1 ? 2 : frame === 3 ? -2 : 0;

    // Pelo de detrás
    if (style === 'largo') { R(5, 8, 8, 21, hair.b); R(5, 8, 2, 21, hair.d); R(8, 10, 1, 14, hair.l); R(5, 28, 7, 1, hair.d2); }
    if (style === 'coleta') { R(4, 7, 4, 4, hair.b); R(3, 11, 3, 10, hair.b); R(3, 11, 1, 10, hair.l); R(3, 21, 2, 3, hair.d); }

    // Brazo del fondo y pierna del fondo
    R(14 + sw, 23, 3, 9, outfit === 'larga' ? main.d2 : top.d2); R(14 + sw, 32, 3, 3, skin.d);
    if (outfit !== 'larga') {
      R(13 - sw, 34, 4, 8, pants.d); R(13 - sw, 42, 6, 4, boots.d); R(13 - sw, 46, 6, 1, boots.d2);
      R(15 + sw, 34, 4, 8, pants.b); R(15 + sw, 34, 1, 8, pants.l);
      R(15 + sw, 42, 6, 4, boots.b); R(15 + sw, 42, 6, 1, boots.l); R(15 + sw, 46, 6, 1, boots.d2);
    }

    // Torso
    if (outfit === 'larga') {
      R(11, 22, 9, 1, main.b);
      for (let y = 23; y <= 44; y++) {
        const w = Math.floor((y - 23) / 8), sway = y > 40 ? Math.sign(sw) : 0;
        R(10 - w + sway, y, 11 + 2 * w, 1, main.b); R(18 + w + sway, y, 3, 1, main.d); R(10 - w + sway, y, 1, 1, main.l);
      }
      R(8, 44, 15, 1, main.d2);
      R(10, 30, 11, 2, gold);
      R(12 - sw, 45, 5, 2, boots.d); R(16 + sw, 45, 6, 2, boots.b);
    } else {
      R(11, 22, 9, 1, top.b); R(10, 23, 11, 11, top.b); R(18, 23, 3, 11, top.d); R(10, 24, 1, 8, top.l);
      if (girl) cut(20, 27, 1, 4);
      if (outfit === 'delantal') { R(19, 24, 2, 14, apron); R(20, 26, 1, 12, apronD); R(10, 28, 9, 1, apronD); R(8, 27, 2, 3, apron); }
      else if (outfit === 'tunica') { R(10, 34, 11, 4, main.b); R(18, 34, 3, 4, main.d); R(10, 37, 11, 1, main.d); R(10, 31, 11, 2, belt); R(19, 31, 2, 2, gold); }
      else if (outfit === 'chaleco') { R(10, 23, 7, 11, main.b); R(10, 24, 1, 9, main.l); R(16, 23, 1, 11, main.d); R(17, 26, 1, 1, gold); R(17, 30, 1, 1, gold); }
    }

    // Brazo de delante
    R(14 - sw, 23, 3, 9, outfit === 'larga' ? main.b : top.b); R(14 - sw, 23, 1, 9, outfit === 'larga' ? main.l : top.l);
    if (outfit === 'chaleco') R(14 - sw, 31, 3, 1, shirt.d);
    R(14 - sw, 32, 3, 3, skin.b); R(14 - sw, 34, 3, 1, skin.d);

    // Cabeza de perfil
    R(13, 20, 5, 2, skin.d);
    rows(HEAD_SIDE, skin.b);
    R(23, 12, 1, 3, skin.b); R(23, 14, 1, 1, skin.d);
    R(9, 18, 4, 1, skin.d); R(20, 18, 2, 1, skin.d);
    R(13, 11, 2, 3, skin.d); R(14, 12, 1, 1, skin.d2);
    R(18, 11, 3, 1, lash); R(19, 12, 2, 1, eye.b); R(19, 12, 1, 1, '#ffffff'); R(19, 13, 2, 1, eye.d);
    if (girl) R(21, 10, 1, 1, lash);
    R(18, 9, 3, 1, hair.d);
    R(20, 16, 2, 1, mouth); R(21, 15, 1, 1, mouth);
    R(17, 15, 2, 1, blush);
    if (o.beard) { R(15, 14, 7, 6, hair.b); R(17, 20, 5, 2, hair.b); R(19, 15, 4, 1, hair.b); R(20, 16, 2, 1, mouth); }

    // Pelo de perfil
    const cap = () => {
      rows([[2, 11, 18], [3, 9, 20], [4, 8, 21], [5, 7, 22], [6, 7, 22], [7, 7, 21]], hair.b);
      R(11, 3, 5, 1, hair.l); R(9, 4, 4, 1, hair.l); R(7, 5, 2, 3, hair.d);
      R(17, 8, 5, 1, hair.b); R(19, 9, 2, 1, hair.b); R(15, 9, 2, 3, hair.b);
    };
    const back = to => { R(7, 8, 6, to - 7, hair.b); R(7, 8, 2, to - 7, hair.d); };
    if (style === 'corto') { cap(); back(15); }
    else if (style === 'largo') { cap(); back(17); }
    else if (style === 'coleta') { cap(); back(14); R(6, 8, 2, 2, tie); }
    else if (style === 'mono') { rows([[0, 5, 9], [1, 4, 10], [2, 4, 10], [3, 5, 9]], hair.b); R(5, 1, 2, 1, hair.l); cap(); back(14); R(8, 4, 2, 2, tie); }
    else if (style === 'rizado') {
      rows([[0, 9, 19], [1, 7, 21], [2, 6, 22], [3, 5, 23], ...Array.from({ length: 6 }, (_, i) => [4 + i, 4, 23]), ...Array.from({ length: 7 }, (_, i) => [10 + i, 4, 13])], hair.b);
      R(4, 4, 3, 13, hair.d);
      for (let y = 1; y < 16; y += 2) for (let x = 6 + (y % 4 === 1 ? 0 : 1); x < (y < 10 ? 22 : 13); x += 3) { R(x, y, 1, 1, hair.l); R(x + 1, y + 1, 1, 1, hair.d); }
      R(16, 9, 2, 3, hair.b);
    } else if (style === 'rapado') {
      rows([[3, 10, 19], [4, 8, 20], [5, 8, 21], [6, 8, 21], [7, 8, 18]], buzz);
      R(8, 8, 5, 7, buzz);
      for (let y = 3; y < 14; y++) for (let x = 9 + (y % 2); x < (y < 8 ? 20 : 13); x += 2) R(x, y, 1, 1, hair.b);
    } else if (style === 'calvo') {
      R(8, 10, 5, 5, hair.b); R(8, 10, 2, 5, hair.d); R(14, 5, 3, 1, '#ffffff');
    }
  }
}

export function personSprites(o) {
  const s = {};
  for (const view of ['front', 'back', 'side']) s[view] = [0, 1, 2, 3, 4].map(fr => paintPerson(o, view, fr));
  return s;
}
