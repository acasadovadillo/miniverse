// Sprites de la exploración: cuevas (paredes, suelo, vetas, escaleras), criaturas, lugares del mundo
// (ruinas, campamentos, torres, barcos hundidos, templos, entradas de cueva y el faro) y mazmorras
// (palancas, rejas, bloques). Los lugares ocupan casillas enteras: el apoyo del sprite es el centro de
// la casilla del medio y las cajas van entre -1.5 y 1.5 (3×3) o entre -0.5 y 0.5 (1×1).
import { mk, ramp, ellipse, blob, line, poly, outlined, ihash } from '../util.js';
import { iso, boxCol } from '../iso.js';
import { PLACE_W, PLACE_H, PLACE_AX, PLACE_AY, drawChest } from './stations.js';
import { WALL_H, WALL_W, WALL_CH, WALL_AX, WALL_AY } from './build.js';

const cache = new Map();
const once = (k, f) => { if (!cache.has(k)) cache.set(k, f()); return cache.get(k); };
const tile = draw => { const c = mk(PLACE_W, PLACE_H), g = c.getContext('2d'); draw(iso(g, PLACE_AX, PLACE_AY), g); return c; };
export const T_AX = PLACE_AX, T_AY = PLACE_AY;
// Paredes y rejas: lienzo alto, como los muros de las casas
const tallTile = draw => { const c = mk(WALL_W, WALL_CH), g = c.getContext('2d'); draw(iso(g, WALL_AX, WALL_AY), g); return c; };
export const W_AX = WALL_AX, W_AY = WALL_AY;

// ---------- Cuevas y mazmorras: pared (bloque tan alto como los muros de las casas), suelo ----------
export const WALL_Z = WALL_H;
export function rockWall(style, seed) {
  return once(`rw:${style}:${seed % 4}`, () => outlined(tallTile((I, g) => {
    const col = style === 'temple' ? '#c8a870' : style === 'ice' ? '#a8c8e0' : '#6e6258';
    I.box(-0.5, -0.5, 0.5, 0.5, 0, WALL_Z, boxCol(col));
    const r = ramp(col);
    for (let k = 0; k < 18; k++) {
      const u = -0.4 + ihash(seed, k, 1) * 0.8, z = 4 + ihash(seed, k, 2) * (WALL_Z - 8);
      if (style === 'temple') { I.faceL(0.5, -0.5, 0.5, z | 0, (z | 0) + 1, r.d); I.faceR(0.5, -0.5, 0.5, z | 0, (z | 0) + 1, r.d2); }
      else { I.faceL(0.5, u, u + 0.12, z, z + 3, r.d); I.faceR(0.5, u, u + 0.1, z + 2, z + 4, r.d2); }
    }
  })));
}
export function floorTile(style, seed) {
  return once(`ft:${style}:${seed % 6}`, () => tile((I, g) => {
    const base = style === 'temple' ? ['#a89070', '#b09878'] : style === 'ice' ? ['#8aa8c0', '#98b4c8'] : ['#4a3e36', '#54463c'];
    I.quad([-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0], base[seed % 2]);
    for (let k = 0; k < 5; k++) { const [x, y] = I.P(ihash(seed, k, 4) - 0.5, ihash(seed, k, 5) - 0.5); g.fillStyle = k % 2 ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.06)'; g.fillRect(x, y, 2, 1); }
    if (style === 'temple') { line(g, ...I.P(-0.5, 0), ...I.P(0.5, 0), 'rgba(0,0,0,.2)'); line(g, ...I.P(0, -0.5), ...I.P(0, 0.5), 'rgba(0,0,0,.2)'); }
  }));
}
// Vetas: roca con puntos del color del mineral
const VEIN = { piedra: null, cobre: '#e08a4a', hierro: '#e0c4b0', oro: '#f8d040', amatista: '#b07ae8', esmeralda: '#4ae890', rubi: '#ff4a5a', diamante: '#d8f8ff', fosil: '#e8e0c8' };
export function veinSprite(kind) {
  return once('v:' + kind, () => {
    const c = mk(30, 26), g = c.getContext('2d'), r = ramp('#7e7268');
    blob(g, 15, 15, 10, r.d); blob(g, 13, 13, 9, r.b); blob(g, 10, 10, 3, r.l);
    const col = VEIN[kind];
    if (col) for (const [x, y] of [[9, 14], [16, 9], [19, 16], [13, 18], [21, 11]]) { g.fillStyle = col; g.fillRect(x, y, kind === 'fosil' ? 3 : 2, 2); if (kind !== 'fosil') { g.fillStyle = '#ffffff'; g.fillRect(x, y, 1, 1); } }
    return outlined(c);
  });
}
export function crystalSprite(col) {
  return once('cr:' + col, () => {
    const c = mk(24, 30), g = c.getContext('2d'), r = ramp(col);
    for (const [x, h, w] of [[8, 18, 4], [13, 24, 5], [17, 14, 4]]) { poly(g, [[x, 28], [x + w, 28], [x + w, 28 - h + 3], [x + w / 2, 28 - h], [x, 28 - h + 3]], r.b); g.fillStyle = r.l; g.fillRect(x + 1, 28 - h + 4, 1, h - 6); }
    return outlined(c);
  });
}
export function ladderSprite(down) {
  return once('l:' + down, () => tile((I, g) => {
    if (down) {
      I.quad([-0.38, -0.38, 0], [0.38, -0.38, 0], [0.38, 0.38, 0], [-0.38, 0.38, 0], '#140e0c');
      for (let k = 0; k < 4; k++) line(g, ...I.P(-0.2, -0.3 + k * 0.18, 0), ...I.P(0.2, -0.3 + k * 0.18, 0), '#8a5a30');
    } else {
      const wood = boxCol('#a8764a');
      I.box(-0.25, -0.05, -0.18, 0.05, 0, 50, wood); I.box(0.18, -0.05, 0.25, 0.05, 0, 50, wood);
      for (let z = 6; z < 50; z += 8) I.box(-0.18, -0.03, 0.18, 0.03, z, z + 2, wood);
    }
  }));
}

// ---------- Criaturas ----------
export const MONSTERS = {
  limo: { name: 'Limo', hp: 3, dmg: 1, speed: 1.1, w: 18, h: 14, drops: [['baba', 1, 1, 0.7]] },
  murcielago: { name: 'Murciélago', hp: 2, dmg: 1, speed: 2.4, w: 20, h: 12, fly: true, drops: [['fibra', 1, 1, 0.3]] },
  esqueleto: { name: 'Esqueleto', hp: 6, dmg: 2, speed: 1.4, w: 18, h: 32, drops: [['calavera', 1, 1, 0.3], ['moneda_antigua', 1, 1, 0.15]] },
};
export function monsterSprite(type, frame) {
  return once(`m:${type}:${frame}`, () => {
    // Un píxel de margen alrededor para que el contorno no se corte (en algún fotograma tocaban el borde)
    const M = MONSTERS[type], c = mk(M.w + 4, M.h + 4), g = c.getContext('2d');
    g.translate(1, 1);
    const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x + 1, y + 1, w, h); };
    if (type === 'limo') {
      const sq = frame ? 1 : 0;
      ellipse(g, 10, 9 + sq, 8 + sq, 5 - sq, '#4ab83a'); ellipse(g, 9, 7 + sq, 6, 3, '#6ad84a'); R(5, 6 + sq, 2, 1, '#ffffff');
      R(6, 8 + sq, 2, 2, '#1a2a1a'); R(11, 8 + sq, 2, 2, '#1a2a1a');
    } else if (type === 'murcielago') {
      const up = frame ? -3 : 2;
      poly(g, [[10, 7], [1, 3 + up], [4, 9], [8, 9]], '#3a2a4a'); poly(g, [[10, 7], [19, 3 + up], [16, 9], [12, 9]], '#3a2a4a');
      blob(g, 10, 7, 3, '#4a3a5a'); R(7, 5, 1, 1, '#ff4a4a'); R(11, 5, 1, 1, '#ff4a4a');
    } else {
      const l = frame ? 1 : 0;
      R(6, 1, 7, 7, '#f0ece0'); R(7, 3, 2, 2, '#1a1a1a'); R(10, 3, 2, 2, '#1a1a1a'); R(8, 7, 3, 1, '#1a1a1a');
      R(8, 8, 3, 2, '#e0dccc'); R(5, 10, 9, 2, '#e0dccc'); for (const y of [13, 16, 19]) R(6, y, 7, 1, '#e0dccc'); R(9, 10, 1, 12, '#e0dccc');
      R(3, 11, 2, 9, '#e0dccc'); R(14, 11, 2, 9, '#e0dccc'); R(15, 6, 1, 12, '#a8b0bc');
      R(6, 22, 2, 9 + l, '#e0dccc'); R(11, 22, 2, 9 - l, '#e0dccc');
    }
    return outlined(c);
  });
}

// ---------- Lugares del mundo (lienzo 120×170, apoyo en 60,140: el centro de la casilla del medio) ----------
// Cada lugar ocupa casillas enteras alrededor de esa casilla: 3×3 (de -1.5 a 1.5) o 1×1 (de -0.5 a 0.5).
// Nada se sale del lienzo: el 3×3 va de x 12 a 108 y de y 116 a 164, y queda sitio hasta 139 px de alto.
export const POI_AX = 60, POI_AY = 140;
const poiCanvas = draw => outlined((() => { const c = mk(120, 170), g = c.getContext('2d'); draw(iso(g, POI_AX, POI_AY), g); return c; })());
const STONE = '#a8a298', STONE_D = '#8e887e', DARK = '#2a2018';
// Juntas de las hiladas en las dos caras vistas de una caja de piedra (la cara y = y1 y la cara x = x1)
function courses(I, hex, x0, y0, x1, y1, z0, z1, step = 8) {
  const r = ramp(hex);
  for (let z = z0 + step; z < z1 - 2; z += step) { I.faceL(y1, x0, x1, z, z + 1, r.d); I.faceR(x1, y0, y1, z, z + 1, r.d2); }
}
export function poiSprite(kind) {
  return once('poi:' + kind, () => poiCanvas((I, g) => {
    const stone = boxCol(STONE), stoneD = boxCol(STONE_D), wood = boxCol('#a8764a');
    // Trozo de muro de piedra con sus hiladas y, si se pide, un bulto encima (el remate roto)
    const wall = (x0, y0, x1, y1, h, dark, bump) => {
      I.box(x0, y0, x1, y1, 0, h, dark ? stoneD : stone); courses(I, dark ? STONE_D : STONE, x0, y0, x1, y1, 0, h);
      if (bump) I.box(bump[0], bump[1], bump[2], bump[3], h, h + 4, dark ? stoneD : stone);
    };
    if (kind === 'ruinas') {
      // Lo que queda de una casa: suelo de losas de 3×3 y muros rotos sobre los bordes de las casillas.
      // Del muro norte (y = -1.5) y del oeste (x = -1.5) queda casi todo; del este y del sur, los arranques.
      I.box(-1.5, -1.5, 1.5, 1.5, 0, 2, boxCol('#9a9488'));
      for (const [x, y, dx, dy] of [[-0.9, -0.3, 0.6, 0.15], [0.3, 0.4, 0.5, -0.2], [-0.4, 0.9, 0.7, 0.1]]) line(g, ...I.P(x, y, 2), ...I.P(x + dx, y + dy, 2), '#7a746a');   // grietas
      wall(-1.5, -1.5, -0.6, -1.1, 36, false, [-1.4, -1.5, -1.0, -1.1]);
      I.faceL(-1.1, -1.0, -0.75, 12, 26, DARK);                                   // ventana
      wall(-0.6, -1.5, 0.2, -1.1, 18, true);
      wall(0.2, -1.5, 1.1, -1.1, 30, false, [0.7, -1.5, 1.1, -1.1]);
      wall(1.1, -1.5, 1.5, -1.1, 44, true);                                       // pilar de la esquina
      wall(-1.5, -1.1, -1.1, -0.3, 30, false, [-1.5, -1.0, -1.1, -0.6]);
      wall(-1.5, -0.3, -1.1, 0.5, 12, true);
      wall(-1.5, 0.5, -1.1, 1.5, 24, false, [-1.5, 1.1, -1.1, 1.5]);
      wall(1.1, -1.1, 1.5, -0.4, 20, true);
      wall(-1.1, 1.1, -0.5, 1.5, 10, true);
      // Sillares caídos por el suelo
      I.box(-0.7, -0.1, -0.3, 0.2, 2, 11, stoneD); I.box(0.1, 0.2, 0.5, 0.5, 2, 9, stoneD); I.box(0.6, 0.8, 1.0, 1.1, 2, 6, stone);
    } else if (kind === 'campamento') {
      // Tienda de 2×2 casillas atrás a la izquierda (x e y de -1.5 a 0.5), con la cumbrera a lo largo de y
      const R = -0.5, H = 36, cloth = ramp('#c8784a');
      poly(g, [I.P(R, -1.5, H), I.P(0.5, -1.5, 0), I.P(0.5, 0.5, 0), I.P(R, 0.5, H)], cloth.d);     // faldón derecho
      line(g, ...I.P(0, -1.5, H / 2), ...I.P(0, 0.5, H / 2), cloth.d2);                             // costura
      poly(g, [I.P(-1.5, 0.5, 0), I.P(0.5, 0.5, 0), I.P(R, 0.5, H)], cloth.l);                        // hastial de delante
      poly(g, [I.P(-0.75, 0.5, 0), I.P(-0.25, 0.5, 0), I.P(R, 0.5, 22)], '#3a2418');                  // puerta
      line(g, ...I.P(R, -1.5, H), ...I.P(R, 0.5, H), cloth.d2);                                       // cumbrera
      line(g, ...I.P(R, 0.5, H), ...I.P(R, 0.5, H + 5), '#7a5030');                                  // punta del palo
      // Vientos con sus estacas, en las casillas de la derecha
      for (const [y0, py] of [[-1.5, -1.1], [0.5, 0.3]]) { line(g, ...I.P(R, y0, H), ...I.P(0.9, py, 2), '#e8d8b0'); I.box(0.86, py - 0.04, 0.94, py + 0.04, 0, 5, wood); }
      // Caja de provisiones (casilla de la izquierda, delante) y tronco para sentarse (casilla de delante)
      I.box(-1.3, 0.7, -0.7, 1.3, 0, 10, boxCol('#b8895a')); I.faceL(1.3, -1.3, -0.7, 5, 6, '#7a5030'); I.faceR(-0.7, 0.7, 1.3, 5, 6, '#5a3a22');
      I.box(-0.4, 0.88, 0.4, 1.12, 0, 7, wood);
      // Hoguera en la casilla de delante a la derecha (1, 1): corona de piedras, leña cruzada y llama
      const F = [1, 1], ring = Array.from({ length: 8 }, (_, k) => [F[0] + Math.cos(k * Math.PI / 4) * 0.32, F[1] + Math.sin(k * Math.PI / 4) * 0.32]).sort((a, b) => a[0] + a[1] - b[0] - b[1]);
      const stones = xs => { for (const [x, y] of xs) I.box(x - 0.07, y - 0.07, x + 0.07, y + 0.07, 0, 3, stoneD); };
      stones(ring.filter(([x, y]) => x + y < 2));
      I.box(F[0] - 0.2, F[1] - 0.05, F[0] + 0.2, F[1] + 0.05, 0, 4, wood); I.box(F[0] - 0.05, F[1] - 0.2, F[0] + 0.05, F[1] + 0.2, 3, 7, wood);
      poly(g, [I.P(F[0] - 0.14, F[1], 5), I.P(F[0] + 0.14, F[1], 5), I.P(F[0], F[1], 18)], '#ff8a2a');
      poly(g, [I.P(F[0] - 0.07, F[1], 5), I.P(F[0] + 0.07, F[1], 5), I.P(F[0], F[1], 12)], '#ffd860');
      stones(ring.filter(([x, y]) => x + y >= 2));
    } else if (kind === 'torre') {
      // Zócalo de 3×3 y escalón de 2×2; encima, el cuerpo de una casilla que sube 110 px (más que los muros de
      // las casas, que miden el doble que una persona), con almenas
      I.box(-1.5, -1.5, 1.5, 1.5, 0, 6, stoneD);
      I.box(-1, -1, 1, 1, 6, 10, stone);
      const B = 10, T = B + 110;
      I.box(-0.5, -0.5, 0.5, 0.5, B, T, stone);
      for (let z = B + 10; z < T - 6; z += 14) { I.faceL(0.5, -0.5, 0.5, z, z + 1, '#8e887e'); I.faceR(0.5, -0.5, 0.5, z + 7, z + 8, '#7a746a'); }
      I.faceL(0.5, -0.2, 0.2, B, B + 22, DARK); blob(g, ...I.P(0, 0.5, B + 22), 3, DARK);           // puerta con arco
      I.faceR(0.5, -0.06, 0.06, B + 48, B + 62, DARK); I.faceL(0.5, -0.06, 0.06, B + 58, B + 72, DARK);   // saeteras
      for (const [x, y] of [[-0.5, -0.5], [0.15, -0.5], [-0.5, 0.15], [0.15, 0.15]]) I.box(x, y, x + 0.35, y + 0.35, T, T + 8, stone);
    } else if (kind === 'barco') {
      const hr = ramp('#7a5030'), hull = { top: hr.l, left: hr.b, right: hr.d };
      // Casco de tres casillas de largo (x) y una de ancho (y), con la proa en punta hacia +x
      I.box(-1.5, -0.5, 0.9, 0.5, 0, 16, hull);
      for (let v = -0.3; v < 0.5; v += 0.2) I.quad([-1.5, v, 16], [0.9, v, 16], [0.9, v + 0.03, 16], [-1.5, v + 0.03, 16], hr.d);   // tablas de cubierta
      for (let u = -1.3; u < 0.9; u += 0.3) I.faceL(0.5, u, u + 0.04, 0, 16, hr.d2);                                            // tablas del costado
      I.faceL(0.5, -0.7, -0.3, 2, 10, '#1a120c');                                                                                // boquete
      I.face([[0.9, -0.5, 0], [1.5, 0, 0], [1.5, 0, 16], [0.9, -0.5, 16]], hr.d);
      I.face([[0.9, 0.5, 0], [1.5, 0, 0], [1.5, 0, 16], [0.9, 0.5, 16]], hr.b);
      I.face([[0.9, -0.5, 16], [1.5, 0, 16], [0.9, 0.5, 16]], hr.l);
      I.box(-1.5, -0.5, -1.4, -0.4, 16, 24, hull); I.box(-1.5, 0.4, -1.4, 0.5, 16, 22, hull);   // popa rota: cuadernas al aire
      // Mástil con la vela hecha jirones
      I.box(-0.36, -0.06, -0.24, 0.06, 16, 62, hull);
      poly(g, [I.P(-0.3, 0, 60), I.P(0.55, 0, 50), I.P(0.35, 0, 32), I.P(-0.3, 0, 28)], '#d8ccb0');
      line(g, ...I.P(0.25, 0, 42), ...I.P(0.45, 0, 38), '#a89878');
      // Restos en la arena: un barril (casilla de la izquierda, delante) y tablas sueltas (delante a la derecha)
      I.box(-1.2, 0.8, -0.8, 1.2, 0, 12, boxCol('#8a6a3a'));
      for (const z of [3, 9]) { I.faceL(1.2, -1.2, -0.8, z, z + 1, '#5a5a66'); I.faceR(-0.8, 0.8, 1.2, z, z + 1, '#4a4a56'); }
      I.box(0.55, 0.75, 1.35, 0.85, 0, 2, hull); I.box(0.65, 1.05, 1.45, 1.15, 0, 2, hull);
    } else if (kind === 'templo') {
      const sd = ramp('#d8b878'), sand = { top: sd.l, left: sd.b, right: sd.d };
      // Gradas escalonadas (3×3, 2.2×2.2 y 1.4×1.4) con las juntas de los bloques, y el santuario arriba
      for (const [h, z0] of [[1.5, 0], [1.1, 12], [0.7, 24]]) {
        I.box(-h, -h, h, h, z0, z0 + 12, sand);
        I.faceL(h, -h, h, z0 + 6, z0 + 7, sd.d); I.faceR(h, -h, h, z0 + 6, z0 + 7, sd.d2);
        for (let u = -h + 0.3; u + 0.34 < h; u += 0.6) {
          I.faceL(h, u, u + 0.04, z0, z0 + 6, sd.d); I.faceL(h, u + 0.3, u + 0.34, z0 + 7, z0 + 12, sd.d);
          I.faceR(h, u, u + 0.04, z0, z0 + 6, sd.d2); I.faceR(h, u + 0.3, u + 0.34, z0 + 7, z0 + 12, sd.d2);
        }
      }
      I.box(-0.35, -0.35, 0.35, 0.35, 36, 48, boxCol('#e8c888')); I.faceL(0.35, -0.1, 0.1, 36, 44, DARK);
      I.box(-0.08, -0.08, 0.08, 0.08, 48, 56, boxCol('#f0c040'));                                   // remate dorado
      I.faceL(1.5, -0.3, 0.3, 0, 10, '#1a120c'); I.faceL(1.5, -0.4, 0.4, 10, 12, '#a8885a');       // la entrada, abajo, con su dintel
      for (const u of [-1.4, 1.1]) I.box(u, 1.1, u + 0.3, 1.4, 12, 34, boxCol('#c8a868'));           // columnas en las esquinas de delante
    } else if (kind === 'altar') {
      I.box(-0.5, -0.5, 0.5, 0.5, 0, 6, stoneD); I.box(-0.25, -0.25, 0.25, 0.25, 6, 20, stone);
      const [x, y] = I.P(0, 0, 26); blob(g, x, y, 5, '#7ad8ff'); blob(g, x - 1, y - 1, 2, '#ffffff');
    }
  }));
}
// Entrada de cueva: peñas de 3×3 con la boca oscura en el centro-abajo. Quedan libres la casilla de
// delante (0, 1), que es por donde se entra, y nada más.
export function caveEntranceSprite(snow) {
  return once('ce:' + snow, () => poiCanvas((I, g) => {
    const r = ramp(snow ? '#a8b8c8' : '#7e7268'), rock = { top: r.l, left: r.b, right: r.d }, dark = '#140e0c';
    // Una peña: caja con grietas en las caras vistas, nieve encima si toca, y unos bultos redondeados
    const crag = (x0, y0, x1, y1, h, seed, lumps) => {
      I.box(x0, y0, x1, y1, 0, h, rock);
      for (let k = 0; k < 4; k++) {
        const z = 3 + ihash(seed, k, 2) * (h - 8), a = x0 + 0.1 + ihash(seed, k, 1) * (x1 - x0 - 0.3), b = y0 + 0.1 + ihash(seed, k, 3) * (y1 - y0 - 0.3);
        I.faceL(y1, a, a + 0.1, z, z + 3, r.d); I.faceR(x1, b, b + 0.08, z + 2, z + 5, r.d2);
      }
      if (snow) I.quad([x0 + 0.15, y0 + 0.15, h], [x1 - 0.15, y0 + 0.15, h], [x1 - 0.15, y1 - 0.15, h], [x0 + 0.15, y1 - 0.15, h], '#f4f8fc');
      for (const [x, y, rr] of lumps) { const [sx, sy] = I.P(x, y, h); ellipse(g, sx, sy + 1, rr, rr >> 1, r.d); ellipse(g, sx - 1, sy - 1, rr - 1, (rr - 1) >> 1, r.b); ellipse(g, sx - 3, sy - 2, rr >> 1, rr >> 2, r.l); }
    };
    crag(-1.5, -1.5, 1.5, -0.5, 30, 1, [[-0.9, -1.0, 8], [0.7, -1.0, 7]]);     // peña de atrás (3×1)
    crag(-1.5, -0.5, -0.5, 1.5, 22, 2, [[-1.0, 0.5, 7]]);                       // peña de la izquierda (1×2)
    I.box(-0.5, -0.5, 0.5, 0.5, 16, 28, rock);                                  // dintel de roca sobre la boca
    I.faceL(0.5, -0.5, 0.5, 0, 16, dark); blob(g, ...I.P(0, 0.5, 16), 6, dark); // la boca, con el arco
    crag(0.5, -0.5, 1.5, 0.5, 18, 3, [[1.0, 0.0, 6]]);                          // peña de la derecha (1×1)
    crag(0.5, 0.5, 1.5, 1.5, 5, 4, [[1.0, 1.0, 5]]);                            // pedrisco bajo delante a la derecha
    poly(g, [I.P(-0.4, 0.5, 0), I.P(0.4, 0.5, 0), I.P(0.3, 1.0, 0), I.P(-0.3, 1.0, 0)], 'rgba(0,0,0,.25)');   // sombra de la boca
  }));
}
// El faro del confín: islote de arena de 3×3 y torre redonda a rayas de una casilla, unos 170 px de alto.
// Lienzo más alto que el de los demás lugares; el apoyo (60, 186) es el centro de la casilla del medio.
export const FARO_W = 120, FARO_H = 212, FARO_AX = 60, FARO_AY = 186;
export function faroSprite() {
  return once('faro', () => {
    const c = mk(FARO_W, FARO_H), g = c.getContext('2d'), I = iso(g, FARO_AX, FARO_AY), X = FARO_AX;
    const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    // Islote: arena más oscura en la orilla y más clara en el centro, con unas piedrecitas y un amarre
    const sq = (h, col) => I.quad([-h, -h, 0], [h, -h, 0], [h, h, 0], [-h, h, 0], col);
    sq(1.5, '#d4bc86'); sq(1.2, '#e4cf98'); sq(0.85, '#ecd9a6');
    for (const [x, y] of [[-1.1, 0.9], [1.0, -0.9], [0.9, 1.2], [-0.7, -1.2]]) blob(g, ...I.P(x, y, 0), 2, '#c8b07a');
    // Zócalo de piedra de una casilla y, encima, la torre: más ancha abajo (28 px) que arriba (18 px)
    I.box(-0.5, -0.5, 0.5, 0.5, 0, 6, boxCol('#a8a298'));
    const base = FARO_AY - 6, top = base - 126, w = y => Math.round(9 + 5 * (y - top) / (base - top)), band = y => (Math.floor((y - top) / 24) % 2 ? '#f4f0e8' : '#c83a3a');
    ellipse(g, X, base, w(base), 7, band(base - 1));
    for (let y = top; y < base; y += 2) {
      const hw = w(y);
      R(X - hw, y, hw * 2, 2, band(y));
      R(X - hw + 1, y, 2, 2, 'rgba(255,255,255,.18)');
      R(X + Math.round(hw * 0.35), y, hw - Math.round(hw * 0.35), 2, 'rgba(0,0,0,.14)');
    }
    R(X - 3, base - 12, 6, 13, DARK); blob(g, X, base - 12, 3, DARK);        // puerta con arco
    for (const y of [top + 30, top + 78]) { R(X - 3, y, 5, 7, '#3a3a42'); R(X - 2, y + 1, 3, 5, '#fff6c0'); }   // ventanucos
    // Balcón, lámpara acristalada, cúpula y pararrayos
    ellipse(g, X, top, 13, 6, '#2e2e36'); R(X - 13, top - 4, 26, 4, '#3a3a42'); ellipse(g, X, top - 4, 13, 6, '#4a4a54');
    for (const dx of [-11, -6, 0, 6, 11]) R(X + dx, top - 10, 1, Math.round(2 + 6 * Math.sqrt(1 - (dx / 13) ** 2)), '#3a3a42');
    R(X - 12, top - 10, 25, 1, '#3a3a42');
    R(X - 8, top - 22, 16, 18, '#fff6c0'); for (const dx of [-8, -1, 6]) R(X + dx, top - 22, 2, 18, '#3a3a42');
    ellipse(g, X, top - 22, 10, 5, '#3a3a42'); ellipse(g, X, top - 26, 8, 6, '#3a3a42'); ellipse(g, X, top - 28, 5, 3, '#4a4a54');
    R(X - 1, top - 39, 2, 8, '#3a3a42');
    // Poste de amarre en la casilla de delante a la derecha
    I.box(1.0, 0.95, 1.12, 1.07, 0, 12, boxCol('#a8764a'));
    return outlined(c);
  });
}
// Cofre de tesoro: el mismo baúl que el que se fabrica, de madera oscura con herrajes de oro.
// Abierto (ya saqueado) tiene la tapa echada hacia atrás y el interior vacío.
export function treasureSprite(open) {
  return once('tr:' + open, () => outlined(tile(I => drawChest(I, { wood: '#7a4628', metal: '#d4a032', lock: '#f4d860', open }))));
}
// ---------- Mazmorra: reja, palanca, placa y bloque ----------
// Reja en el hueco de una pared del templo: barrotes hasta la altura de una puerta y, encima, la pared
const GATE_H = 62;
export function gateSprite(open, alongX) {
  return once(`g:${open}:${alongX}`, () => outlined(tallTile(I => {
    const iron = boxCol('#5a5a66'), stone = ramp('#c8a870');
    if (open) { I.box(alongX ? -0.5 : -0.06, alongX ? -0.06 : -0.5, alongX ? -0.36 : 0.06, alongX ? 0.06 : -0.36, 0, GATE_H, iron); I.box(alongX ? 0.36 : -0.06, alongX ? -0.06 : 0.36, alongX ? 0.5 : 0.06, alongX ? 0.06 : 0.5, 0, GATE_H, iron); }
    else {
      for (let u = -0.45; u <= 0.45; u += 0.15) I.box(alongX ? u : -0.04, alongX ? -0.04 : u, alongX ? u + 0.05 : 0.04, alongX ? 0.04 : u + 0.05, 0, GATE_H, iron);
      I.box(alongX ? -0.5 : -0.06, alongX ? -0.06 : -0.5, alongX ? 0.5 : 0.06, alongX ? 0.06 : 0.5, GATE_H - 4, GATE_H, iron);
    }
    I.box(-0.5, -0.5, 0.5, 0.5, GATE_H, WALL_H, { top: stone.l, left: stone.b, right: stone.d });
    for (let z = GATE_H + 8; z < WALL_H - 2; z += 8) { I.faceL(0.5, -0.5, 0.5, z, z + 1, stone.d); I.faceR(0.5, -0.5, 0.5, z, z + 1, stone.d2); }
  })));
}
export function leverSprite(on) {
  return once('lv:' + on, () => outlined(tile((I, g) => {
    I.box(-0.15, -0.15, 0.15, 0.15, 0, 6, boxCol('#8e887e'));
    const [x0, y0] = I.P(0, 0, 6), [x1, y1] = I.P(on ? 0.25 : -0.25, on ? -0.1 : 0.1, 20);
    line(g, x0, y0, x1, y1, '#7a5030'); g.fillStyle = on ? '#4ae84a' : '#e83a3a'; g.fillRect(x1 - 1, y1 - 2, 3, 3);
  })));
}
export function plateSprite(down) {
  return once('pl:' + down, () => tile(I => { I.box(-0.38, -0.38, 0.38, 0.38, 0, down ? 1 : 3, boxCol(down ? '#6aa84a' : '#a89070')); }));
}
export function blockSprite() {
  return once('bk', () => outlined(tile(I => { I.box(-0.45, -0.45, 0.45, 0.45, 0, 24, boxCol('#b8a078')); I.faceL(0.45, -0.3, 0.3, 8, 16, '#8a7050'); })));
}

// ---------- Vehículos (debajo del jugador) ----------
export function boatSprite() {
  return once('boat', () => {
    const c = mk(46, 22), g = c.getContext('2d');
    poly(g, [[2, 6], [44, 6], [38, 18], [8, 18]], '#7a5030'); poly(g, [[4, 6], [42, 6], [38, 10], [8, 10]], '#a8764a');
    g.fillStyle = '#5a3a22'; for (let x = 10; x < 38; x += 7) g.fillRect(x, 10, 1, 7);
    return outlined(c);
  });
}
export function horseSprite(frame) {
  return once('horse:' + frame, () => {
    const c = mk(38, 32), g = c.getContext('2d'), R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x + 1, y + 1, w, h); }, l = frame ? 2 : 0;   // con margen: las orejas tocaban el borde
    for (const [x, d] of [[6, l], [10, -l], [22, -l], [26, l]]) R(x, 18, 3, 10 + (d > 0 ? 0 : -1), '#6a4428');
    R(4, 9, 26, 11, '#8a5a34'); R(4, 9, 26, 2, '#a8764a'); R(26, 2, 6, 12, '#8a5a34'); R(28, 0, 6, 6, '#8a5a34'); R(31, 3, 1, 1, '#1a1a1a');
    R(24, 2, 3, 10, '#3a2418'); R(1, 10, 4, 10, '#3a2418'); R(12, 8, 10, 3, '#c83a3a');
    return outlined(c);
  });
}
