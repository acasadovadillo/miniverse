// Sprites de construcción: suelos, muros, ventanas, puertas, tejados y vallas.
// Todos ocupan una casilla. Suelos y vallas usan el lienzo de lo colocable (40×70, apoyo en 20,58);
// muros, puertas y el hogar, uno alto (40×130, apoyo en 20,118); los tejados, otro más alto todavía
// (40×210, apoyo en 20,198), porque van encima de los muros y suben con la pendiente.
import { mk, ramp, line, outlined, mixHex, ellipse } from '../util.js';
import { iso, boxCol, SEAM } from '../iso.js';
import { PLACE_W, PLACE_H, PLACE_AX, PLACE_AY, drawHearth } from './stations.js';

// Alto de los muros: el doble de lo que mide una persona (unos 48 px), como en una casa de verdad
export const WALL_H = 96;
const DOOR_H = 62;                                // hueco de la puerta: algo más alto que una persona
const WIN0 = 36, WIN1 = 64;                       // ventanas: del alféizar (a media altura de una persona) al dintel
export const WALL_W = 40, WALL_CH = 130, WALL_AX = 20, WALL_AY = 118;
const OUTLINE = '#2a1c22';
const STONE = '#a59e92';
const TIMBER = '#6a4428';
const cache = new Map();
const cached = (key, draw) => {
  if (!cache.has(key)) cache.set(key, draw());
  return cache.get(key);
};
// q: girado (en pasos de la cámara); now: pintar al momento aunque esté girado (lo que no se tapa a sí mismo)
// (lo que forma superficies seguidas casilla a casilla se ensancha un poco con la cámara entre dos cuartos de vuelta)
const canvas = (q = 0, now = false) => { const c = mk(PLACE_W, PLACE_H), g = c.getContext('2d'); return [c, g, iso(g, PLACE_AX, PLACE_AY, 1, q, now, SEAM(q))]; };
const tallCanvas = (q = 0) => { const c = mk(WALL_W, WALL_CH), g = c.getContext('2d'); return [c, g, iso(g, WALL_AX, WALL_AY, 1, q, false, SEAM(q))]; };

// ---------- Suelos (rombo plano de 32×17) ----------
const FLOOR = {
  suelo_madera(I, g) {
    const cols = ['#b4825a', '#a87650', '#bc8c62'];
    for (let k = 0; k < 4; k++) I.quad([-0.5, -0.5 + k / 4, 0], [0.5, -0.5 + k / 4, 0], [0.5, -0.25 + k / 4, 0], [-0.5, -0.25 + k / 4, 0], cols[k % 3]);
    for (let k = 1; k < 4; k++) line(g, ...I.P(-0.5, -0.5 + k / 4), ...I.P(0.5, -0.5 + k / 4), '#8a5a38');
    line(g, ...I.P(0.1, -0.5), ...I.P(0.1, -0.25), '#8a5a38'); line(g, ...I.P(-0.2, 0), ...I.P(-0.2, 0.25), '#8a5a38');
  },
  suelo_piedra(I) {
    const cols = ['#a8a298', '#9a948a', '#b4aea4', '#8e887e'];
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      I.quad([-0.5 + i / 2, -0.5 + j / 2, 0], [i / 2, -0.5 + j / 2, 0], [i / 2, j / 2, 0], [-0.5 + i / 2, j / 2, 0], '#6e6860');
      I.quad([-0.46 + i / 2, -0.46 + j / 2, 0], [-0.04 + i / 2, -0.46 + j / 2, 0], [-0.04 + i / 2, -0.04 + j / 2, 0], [-0.46 + i / 2, -0.04 + j / 2, 0], cols[i + j * 2]);
    }
  },
  camino(I, g) {
    I.quad([-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0], '#b8a888');
    for (let k = 0; k < 14; k++) {
      const [x, y] = I.P(((k * 37) % 9) / 9 - 0.45, ((k * 53) % 9) / 9 - 0.45);
      g.fillStyle = k % 3 ? '#988a70' : '#d8ccb0'; g.fillRect(x, y, 2, 1);
    }
  },
};
// clip [x0, x1, y0, y1]: solo esa parte de la casilla (bajo un muro, el suelo llega hasta el muro y no sale fuera).
// q: girado con la cámara
export function floorSprite(id, clip, q = 0) {
  return cached('f:' + id + (clip ? ':' + clip : '') + ':' + q, () => {
    const [c, g, I] = canvas(q, true);
    if (clip) {
      const [x0, x1, y0, y1] = clip;
      g.beginPath();
      for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) g.lineTo(...I.P(x, y, 0));
      g.clip();
    }
    FLOOR[id](I, g);
    return c;
  });
}

// ---------- Muros ----------
// window: true es la ventana sencilla; 'shutters', la de contraventanas y jardinera
const WALLS = {
  muro_madera: { col: '#a8764a', kind: 'wood' },
  muro_piedra: { col: '#a09a90', kind: 'stone' },
  muro_entramado: { col: '#efe0c0', kind: 'timber' },
  ventana: { col: '#a8764a', kind: 'wood', window: true },
  ventana_contraventanas: { col: '#efe0c0', kind: 'timber', window: 'shutters' },
  muro_cuadro: { col: '#a8764a', kind: 'wood', painting: true },
};
// Los muros son tabiques finos (T es medio grueso: el muro mide 0.24 casillas) que se unen con los muros,
// puertas y ventanas de al lado, como las vallas. mask: 1 sigue hacia +x, 2 hacia -x, 4 hacia +y, 8 hacia -y.
export const T = 0.12;
const MID = Math.round(WALL_H / 2);   // viga del medio del entramado (como un muro de dos alturas)
// Tramos de muro de una casilla, como cajas [x0, x1, y0, y1] relativas a su centro (también son sus colisiones).
// Si solo sigue en un eje (o en ninguno), cruza la casilla entera; en una esquina, una T o una cruz, cada
// tramo va del centro hacia cada vecino.
export function wallRuns(mask) {
  let hasX = mask & 3, hasY = mask & 12;
  if (!hasX && !hasY) hasX = 3;   // muro suelto: a lo largo de x
  const both = hasX && hasY, out = [];
  if (hasX) out.push([both && !(mask & 2) ? -T : -0.5, both && !(mask & 1) ? T : 0.5, -T, T]);
  if (hasY) out.push([-T, T, both && !(mask & 8) ? -T : -0.5, both && !(mask & 4) ? T : 0.5]);
  return out;
}
// Textura de una cara de muro: la cara f ('faceL', el plano y = at; 'faceR', el plano x = at; con n = -1, la de
// atrás de ese plano) entre u0 y u1, de z0 hasta lo alto (z0 > 0: el trozo de encima de una puerta).
// `brace`: con riostras en diagonal. Si la cara no mira a la cámara no se pinta.
function faceTexture(I, f, at, n, u0, u1, w, brace, z0 = 0) {
  const nv = f === 'faceL' ? [0, n] : [n, 0];
  if (!I.shows(nv)) return;
  const r = ramp(w.col), L = I.side(nv) === 'left', dk = L ? r.d : r.d2, len = u1 - u0;
  const F = (a, b, v0, v1, col) => I[f](at, a, b, v0, v1, col, n), Q = (u, z) => (f === 'faceL' ? [u, at, z] : [at, u, z]);
  if (w.kind === 'wood') {
    for (let u = Math.ceil(u0 * 4) / 4; u < u1; u += 0.25) F(u, Math.min(u + 0.02, u1), z0, WALL_H, dk);
    for (const z of [z0, MID]) if (z >= z0) F(u0, u1, z, z + 3, dk);
  } else if (w.kind === 'stone') {
    for (let z = 0; z < WALL_H; z += 8) {
      if (z + 8 <= z0) continue;
      const off = (z / 8) % 2 ? 0.17 : 0, lo = Math.max(z, z0);
      F(u0, u1, lo, lo + 1, dk);
      for (let u = -0.5 + off; u < u1; u += 0.34) if (u >= u0) F(u, Math.min(u + 0.03, u1), lo, z + 8, dk);
    }
  } else if (w.kind === 'timber') {
    // Yeso claro con entramado de madera oscura: zócalo de piedra, postes en los extremos, viga abajo,
    // en medio y arriba, y una riostra en diagonal en cada mitad
    const t = ramp(TIMBER), st = ramp(STONE), tc = L ? t.b : t.d, from = Math.max(6, z0), post = Math.min(0.1, len / 2);
    if (!z0) { F(u0, u1, 0, 6, L ? st.b : st.d); F(u0, u1, 3, 4, L ? st.d : st.d2); }
    F(u0, u0 + post, from, WALL_H, tc); F(u1 - post, u1, from, WALL_H, tc);
    F(u0, u1, from, from + 3, tc); F(u0, u1, WALL_H - 4, WALL_H, tc);
    if (MID > from + 3) F(u0, u1, MID, MID + 3, tc);
    for (const [k, z] of [[0.25, 20], [0.65, 30], [0.8, 14], [0.4, MID + 18], [0.75, MID + 30]]) if (z > from + 3 && len > 0.3) I.px(Q(u0 + k * len, z), 0, 0, 2, 1, r.l2);
    if (brace && !z0 && len > 0.6) for (const [a, b] of [[9, MID], [MID + 3, WALL_H - 4]]) I.face([Q(u0 + 0.1, a), Q(u0 + 0.2, a), Q(u1 - 0.1, b), Q(u1 - 0.2, b)], tc);
  }
}
// Ventana sencilla: cristal con cruz y marco de madera, en la cara f (plano at, normal n), centrada en la casilla
function plainWindow(I, f, at, n = 1) {
  const nv = f === 'faceL' ? [0, n] : [n, 0];
  if (!I.shows(nv)) return;
  const mid = (WIN0 + WIN1) / 2, F = (u0, u1, v0, v1, col) => I[f](at, u0, u1, v0, v1, col, n);
  F(-0.24, 0.24, WIN0 - 2, WIN1 + 2, TIMBER);
  F(-0.19, 0.19, WIN0, WIN1, I.side(nv) === 'left' ? '#7ab8e0' : '#5a98c8');
  F(-0.19, 0.19, WIN1 - 4, WIN1, '#c8ecfa');
  F(-0.02, 0.02, WIN0, WIN1, TIMBER); F(-0.19, 0.19, mid - 1, mid + 1, TIMBER);
}
// Ventana con cristal y cruz, contraventanas verdes a los lados y jardinera con flores debajo
function shutterWindow(I, face, at, n = 1) {
  const nv = face === 'faceL' ? [0, n] : [n, 0];
  if (!I.shows(nv)) return;
  const L = I.side(nv) === 'left', t = ramp(TIMBER), gl = ramp('#8fc8e8'), sh = ramp('#4f8a4a');
  const F = (u0, u1, v0, v1, col) => I[face](at, u0, u1, v0, v1, col, n);
  const tim = L ? t.b : t.d;
  const mid = (WIN0 + WIN1) / 2;
  F(-0.26, 0.26, WIN0 - 2, WIN1 + 2, tim);
  F(-0.21, 0.21, WIN0, WIN1, L ? gl.b : gl.d);
  if (L) F(-0.19, -0.1, mid + 3, WIN1 - 2, gl.l2);
  F(-0.02, 0.02, WIN0, WIN1, tim); F(-0.21, 0.21, mid - 1, mid + 1, tim);
  for (const [a, b] of [[-0.42, -0.28], [0.28, 0.42]]) {
    F(a, b, WIN0 - 3, WIN1 + 3, L ? sh.b : sh.d);
    for (let v = WIN0; v < WIN1; v += 4) F(a + 0.03, b - 0.03, v, v + 1, L ? sh.d : sh.d2);
  }
  F(-0.28, 0.28, WIN0 - 8, WIN0 - 3, L ? '#7a4a2a' : '#5e3820');
  F(-0.28, 0.28, WIN0 - 4, WIN0 - 3, L ? '#8e5a34' : '#6a4226');
  const cols = ['#ff6a8a', '#ffe04a', '#ffffff', '#ff9ab8'];
  for (let i = 0, u = -0.24; u < 0.26; i++, u += 0.12) {
    const p = face === 'faceL' ? [u, at, WIN0 - 1] : [at, u, WIN0 - 1];
    I.px(p, 0, 0, 2, 2, '#3f8a32'); I.px(p, 0, -1, 2, 1, cols[i % cols.length]);
  }
}
// Por dentro de casa todos los muros son de yeso blanco liso (sin entramado, zócalo ni tablas)
const PLASTER = { col: '#f4ecdc', kind: 'plaster' };
// Un tramo de muro [x0, x1, y0, y1] con la textura de sus caras (las dos largas y los dos extremos: según
// hacia dónde mire la cámara se ven unas u otras)
function wallRun(I, [x0, x1, y0, y1], w, brace, z0 = 0) {
  I.box(x0, y0, x1, y1, z0, WALL_H, boxCol(w.col));
  if (w.kind === 'plaster') return;
  const alongX = x1 - x0 >= y1 - y0;
  for (const n of [1, -1]) {
    faceTexture(I, 'faceL', n > 0 ? y1 : y0, n, x0, x1, w, alongX && brace, z0);
    faceTexture(I, 'faceR', n > 0 ? x1 : x0, n, y0, y1, w, !alongX && brace, z0);
  }
}
// only: 'x' o 'y' dibuja solo el tramo de ese eje (dentro de casa, en una esquina se ve solo la pared de atrás).
// inner: visto desde dentro de casa: yeso blanco liso y la ventana sin contraventanas ni jardinera.
// q: girado con la cámara (las ventanas y el cuadro van por las dos caras: se ve la que mire a la cámara)
export function wallSprite(id, mask = 3, only, inner = false, q = 0) {
  return cached(`w:${id}:${mask}:${only || ''}:${+inner}:${q}`, () => {
    const isX = r => r[2] === -T && r[3] === T && !(r[0] === -T && r[1] === T);
    const [c, , I] = tallCanvas(q), def = WALLS[id], w = inner ? { ...def, ...PLASTER } : def, plain = !w.window && !w.painting;
    const runs = wallRuns(mask).filter(r => !only || isX(r) === (only === 'x'));
    const [xr, yr] = [runs.find(r => r[2] === -T && r[3] === T && r[1] - r[0] > 2 * T), runs.find(r => r[0] === -T && r[1] === T && r[3] - r[2] > 2 * T)];
    // De atrás adelante: lo del tramo en y que queda detrás del centro, el tramo en x y el resto del tramo en y
    if (xr && yr && yr[2] < -T) wallRun(I, [-T, T, yr[2], -T], w, false);
    if (xr) wallRun(I, xr, w, plain && !yr);
    if (yr) wallRun(I, xr ? [-T, T, -T, yr[3]] : yr, w, plain && !xr);
    if (!xr && !yr) wallRun(I, runs[0], w, false);
    // Ventana o cuadro en la cara larga, solo en un tramo recto que cruza la casilla
    const straight = xr && !yr && xr[0] === -0.5 && xr[1] === 0.5 ? ['faceL', T] : yr && !xr && yr[2] === -0.5 && yr[3] === 0.5 ? ['faceR', T] : null;
    if (straight) for (const n of [1, -1]) {
      const [f, at0] = straight, at = at0 * n;
      if (w.window === true || (w.window && inner)) plainWindow(I, f, at, n);
      else if (w.window === 'shutters') shutterWindow(I, f, at, n);
      if (w.painting) {
        const F = (u0, u1, v0, v1, col) => I[f](at, u0, u1, v0, v1, col, n);
        F(-0.26, 0.26, WIN0, WIN1 - 4, TIMBER); F(-0.21, 0.21, WIN0 + 2, WIN1 - 6, '#7ec2e8');
        F(-0.21, 0.21, WIN0 + 2, WIN0 + 8, '#5aa842'); F(0.05, 0.12, WIN1 - 13, WIN1 - 10, '#ffe08a');
      }
    }
    // Remate de lo alto, un poco más ancho que el muro
    const cap = boxCol(ramp(w.col).d);
    for (const [x0, x1, y0, y1] of runs) I.box(x0 - (x0 > -0.5 ? 0.02 : 0), y0 - (y0 > -0.5 ? 0.02 : 0), x1 + (x1 < 0.5 ? 0.02 : 0), y1 + (y1 < 0.5 ? 0.02 : 0), WALL_H, WALL_H + 2, cap);
    I.flush();
    return inner ? c : outlined(c);   // por dentro sin contorno: si no, cada casilla de muro dejaría una raya
  });
}
// Dónde brillan las ventanas de noche (relativo al apoyo de la casilla): a la altura del cristal
export const WINDOW_Z = (WIN0 + WIN1) / 2;
export const WINDOW_GLOW = [[T, 0, WINDOW_Z], [0, T, WINDOW_Z]];

// Puerta: marco con la hoja abierta y, encima del hueco, un trozo de muro fino hasta lo alto (del mismo tipo
// que el muro de al lado, `wall`). `alongX`: el muro sigue el eje x (se pasa en dirección y)
// closed: la hoja cerrada dentro del marco (con tablas y tirador); abierta, echada hacia dentro de la casa.
// bare: vista desde dentro de casa, donde la pared de delante no se dibuja: la puerta entera (marco, dintel,
// hoja y el escalón de piedra) sin el trozo de muro de encima
export function doorSprite(alongX, wall = 'muro_madera', closed = false, bare = false, q = 0) {
  const w = WALLS[wall] || WALLS.muro_madera;
  return cached(`d:${alongX}:${wall}:${+closed}:${+bare}:${q}`, () => {
    const [c, , I] = tallCanvas(q), fr = boxCol('#7a5030'), leaf = boxCol('#b07a44');
    if (bare) I.box(...(alongX ? [-0.36, -T, 0.36, T + 0.06] : [-T, -0.36, T + 0.06, 0.36]), 0, 2, boxCol(STONE));
    if (alongX) {
      I.box(-0.5, -T, -0.36, T, 0, DOOR_H, fr);
      if (closed) {
        I.box(-0.36, -0.05, 0.36, 0.05, 0, DOOR_H - 4, leaf);
        for (const u of [-0.18, 0, 0.18]) I.faceL(0.05, u, u + 0.02, 0, DOOR_H - 4, '#8a5a30');
        for (const z of [12, DOOR_H - 16]) I.faceL(0.05, -0.36, 0.36, z, z + 2, '#8a5a30');
        I.faceL(0.05, 0.22, 0.28, 28, 31, '#3a2a1a');
      } else I.box(-0.36, -0.1, -0.3, 0.45, 0, DOOR_H - 6, leaf);
      I.box(0.36, -T, 0.5, T, 0, DOOR_H, fr);
    } else {
      I.box(-T, -0.5, T, -0.36, 0, DOOR_H, fr);
      if (closed) {
        I.box(-0.05, -0.36, 0.05, 0.36, 0, DOOR_H - 4, leaf);
        for (const u of [-0.18, 0, 0.18]) I.faceR(0.05, u, u + 0.02, 0, DOOR_H - 4, '#7a4a28');
        for (const z of [12, DOOR_H - 16]) I.faceR(0.05, -0.36, 0.36, z, z + 2, '#7a4a28');
        I.faceR(0.05, 0.22, 0.28, 28, 31, '#3a2a1a');
      } else I.box(-0.1, -0.36, 0.45, -0.3, 0, DOOR_H - 6, leaf);
      I.box(-T, 0.36, T, 0.5, 0, DOOR_H, fr);
    }
    // Muro de encima de la puerta, con el dintel de madera debajo
    const run = alongX ? [-0.5, 0.5, -T, T] : [-T, T, -0.5, 0.5];
    if (bare) { I.box(run[0], run[2], run[1], run[3], DOOR_H - 4, DOOR_H, fr); I.flush(); return outlined(c); }
    wallRun(I, run, w, false, DOOR_H);
    I.box(run[0], run[2], run[1], run[3], DOOR_H - 4, DOOR_H, fr);
    const cap = alongX ? [-0.5, 0.5, -T - 0.02, T + 0.02] : [-T - 0.02, T + 0.02, -0.5, 0.5];
    I.box(cap[0], cap[2], cap[1], cap[3], WALL_H, WALL_H + 2, boxCol(ramp(w.col).d));
    I.flush();
    return outlined(c);
  });
}

// Candelabro de latón que cuelga del techo en el centro de cada casa (se ve al entrar, sin el tejado):
// una cadena desde lo alto de los muros, un vástago con remates y un aro con ocho velas sobre sus platillos.
// Las llamas las pinta el juego encima (parpadean), en CANDLES: [x, y, z] relativos al suelo bajo el candelabro.
export const LAMP_W = 48, LAMP_H = 120, LAMP_AX = 24, LAMP_AY = 112, LAMP_Z = 52;
const LAMP_R = 0.56;
export const CANDLES = Array.from({ length: 8 }, (_, i) => { const a = (i / 8) * Math.PI * 2 + 0.2; return [Math.cos(a) * LAMP_R, Math.sin(a) * LAMP_R, LAMP_Z + 7]; });
export function chandelierSprite() {
  return cached('candelabro', () => {
    const c = mk(LAMP_W, LAMP_H), g = c.getContext('2d'), I = iso(g, LAMP_AX, LAMP_AY);
    const br = ramp('#c8963a'), chain = '#4a3a30', Y = z => Math.round(I.P(0, 0, z)[1]);
    // Aro de latón, en dos mitades (la de atrás antes que el vástago y las velas de delante después);
    // grueso de dos píxeles: arriba más claro
    const ring = front => {
      for (let i = 0; i < 48; i++) {
        const a0 = (i / 48) * Math.PI * 2, a1 = ((i + 1) / 48) * Math.PI * 2;
        if ((Math.cos(a0) + Math.sin(a0) > 0) !== front) continue;
        const p = a => [Math.cos(a) * LAMP_R, Math.sin(a) * LAMP_R];
        line(g, ...I.P(...p(a0), LAMP_Z - 1), ...I.P(...p(a1), LAMP_Z - 1), front ? br.d : br.d2);
        line(g, ...I.P(...p(a0), LAMP_Z), ...I.P(...p(a1), LAMP_Z), front ? br.l : br.b);
      }
    };
    const candle = ([x, y]) => {
      const [sx, sy] = I.P(x, y, LAMP_Z + 1).map(Math.round);
      g.fillStyle = br.d; g.fillRect(sx - 1, sy, 3, 1);                   // platillo
      g.fillStyle = br.l; g.fillRect(sx - 1, sy - 1, 3, 1);
      g.fillStyle = '#efe2c4'; g.fillRect(sx, sy - 6, 1, 5);              // vela
      g.fillStyle = '#fffaf0'; g.fillRect(sx, sy - 6, 1, 2);
    };
    // Cadena desde el techo (a la altura de los muros) con su florón
    const top = Y(WALL_H), hub = Y(LAMP_Z + 16);
    ellipse(g, LAMP_AX, top, 3, 1, br.d);
    for (let y = top + 1; y < hub; y += 3) { g.fillStyle = chain; g.fillRect(LAMP_AX, y, 1, 2); g.fillStyle = br.d; g.fillRect(LAMP_AX, y + 2, 1, 1); }
    CANDLES.filter(([x, y]) => x + y <= 0).forEach(candle);
    ring(false);
    // Brazos curvos del vástago al aro
    for (const [x, y] of CANDLES) {
      const m = [x * 0.55, y * 0.55, LAMP_Z + 9];
      line(g, ...I.P(0, 0, LAMP_Z + 14), ...I.P(...m), br.d); line(g, ...I.P(...m), ...I.P(x * 0.95, y * 0.95, LAMP_Z + 1), br.d);
    }
    // Vástago con tres remates: arriba, en medio y la gota de abajo
    g.fillStyle = br.d; g.fillRect(LAMP_AX - 1, hub, 3, Y(LAMP_Z - 6) - hub);
    g.fillStyle = br.l; g.fillRect(LAMP_AX - 1, hub, 1, Y(LAMP_Z - 6) - hub);
    ellipse(g, LAMP_AX, Y(LAMP_Z + 15), 2, 1, br.b);
    ellipse(g, LAMP_AX, Y(LAMP_Z + 4), 3, 2, br.b); g.fillStyle = br.l2; g.fillRect(LAMP_AX - 2, Y(LAMP_Z + 5), 1, 1);
    ellipse(g, LAMP_AX, Y(LAMP_Z - 7), 2, 2, br.b); g.fillStyle = br.l2; g.fillRect(LAMP_AX - 1, Y(LAMP_Z - 8), 1, 1);
    ring(true);
    CANDLES.filter(([x, y]) => x + y > 0).forEach(candle);
    return outlined(c, 'rgba(30,20,16,.55)');
  });
}

// Hogar con chimenea: la columna de piedra sube hasta el alero (encima la sigue el tejado)
// q: hacia dónde mira, visto desde la cámara (cuartos de vuelta)
export function hearthSprite(q = 0) {
  return cached(`hogar:${q}`, () => {
    const c = mk(WALL_W, WALL_CH), g = c.getContext('2d'), I = iso(g, WALL_AX, WALL_AY, 1, q);
    drawHearth(I, g, WALL_H + 2);
    I.flush();
    return outlined(c);
  });
}

// ---------- Tejados: a cuatro aguas, con pendiente real ----------
// La superficie de cada casilla es un abanico de triángulos alrededor de su centro, uno por cada par de
// puntos seguidos del borde (esquinas y puntos medios de los lados). Dos casillas vecinas comparten los
// puntos de su lado común con la misma altura, así que las caras encajan sin huecos. Cada triángulo se
// pinta según hacia dónde cae, visto desde la cámara: hacia abajo a la izquierda en pantalla con el color
// base y filas de tejas; hacia abajo a la derecha, más oscuro y también con filas; las caras que caen hacia
// atrás, más oscuras o más claras y lisas (casi nunca se ven: quedan de canto o de espaldas).
export const ROOF_W = 40, ROOF_H = 210, ROOF_AX = 20, ROOF_AY = 198;   // lienzo más alto: el tejado va sobre los muros y sube
export const ROOF_RISE = 16;          // píxeles por nivel de altura
export const ROOF_Z0 = WALL_H + 2;    // z del alero (borde del tejado)
export const ROOF_IDS = ['tejado_rojo', 'tejado_azul', 'tejado_paja', 'tejado_gris', 'tejado_verde'];
const ROOFS = { tejado_rojo: '#c95a3c', tejado_azul: '#4a6aa8', tejado_paja: '#d8b060', tejado_gris: '#6a6e78', tejado_verde: '#4a8a5a' };
const EAVE = 4;     // canto del alero, en píxeles
const ROW = 4;      // separación entre filas de tejas, en z
const RING = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];                      // el borde, en orden
const SIDES = { n: ['nw', 'n', 'ne'], e: ['ne', 'e', 'se'], s: ['se', 's', 'sw'], w: ['sw', 'w', 'nw'] };

// Nivel que se dibuja en el centro. Una casilla suelta (alero por los cuatro lados) sube a nivel 1:
// a 0.5 quedaría casi plana. Como no tiene vecinas, no desencaja con nadie.
const centerLevel = (h, eaves) => (eaves.n && eaves.e && eaves.s && eaves.w ? Math.max(h.c, 1) : h.c);
// z de la superficie del tejado en el centro de la casilla (de ahí arranca la chimenea)
export const roofTopZ = (h, eaves) => ROOF_Z0 + centerLevel(h, eaves) * ROOF_RISE;

// Puntos de la casilla [x, y, z], con la casilla centrada en el origen. h trae los niveles de las esquinas
// (nw, ne, se, sw) y el centro (c); si también trae los puntos medios de los lados (n, e, s, w) se usan,
// y si no, cada punto medio va a media altura entre sus dos esquinas.
function roofPoints(h, eaves) {
  const z = lvl => ROOF_Z0 + lvl * ROOF_RISE;
  const mid = (k, a, b) => z(typeof h[k] === 'number' ? h[k] : (a + b) / 2);
  return {
    c: [0, 0, roofTopZ(h, eaves)],
    nw: [-0.5, -0.5, z(h.nw)], n: [0, -0.5, mid('n', h.nw, h.ne)], ne: [0.5, -0.5, z(h.ne)], e: [0.5, 0, mid('e', h.ne, h.se)],
    se: [0.5, 0.5, z(h.se)], s: [0, 0.5, mid('s', h.se, h.sw)], sw: [-0.5, 0.5, z(h.sw)], w: [-0.5, 0, mid('w', h.sw, h.nw)],
  };
}
// Plano del triángulo (c, p, q): z = zc + a·x + b·y
function plane(c, p, q) {
  const det = p[0] * q[1] - q[0] * p[1], dp = p[2] - c[2], dq = q[2] - c[2];
  return { zc: c[2], a: (dp * q[1] - dq * p[1]) / det, b: (p[0] * dq - q[0] * dp) / det };
}
// Recorta el segmento AB (puntos [x, y] de la rejilla) al triángulo T. Devuelve los dos extremos o null.
function clipToTri(A, B, T) {
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 3; i++) {
    const [x1, y1] = T[i], [x2, y2] = T[(i + 1) % 3], [x3, y3] = T[(i + 2) % 3];
    let nx = y1 - y2, ny = x2 - x1;
    if (nx * (x3 - x1) + ny * (y3 - y1) < 0) { nx = -nx; ny = -ny; }   // normal hacia dentro
    const fa = nx * (A[0] - x1) + ny * (A[1] - y1), fb = nx * (B[0] - x1) + ny * (B[1] - y1);
    if (fa < 0 && fb < 0) return null;
    if (fa < 0) t0 = Math.max(t0, fa / (fa - fb));
    else if (fb < 0) t1 = Math.min(t1, fa / (fa - fb));
  }
  // Se acorta un pelo por cada extremo que toca el borde, que al redondear no asome fuera del triángulo
  const e = 0.04 / Math.hypot(B[0] - A[0], B[1] - A[1]);
  if (t0 > 0) t0 += e;
  if (t1 < 1) t1 -= e;
  if (t0 >= t1) return null;
  const at = t => [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t];
  return [at(t0), at(t1)];
}
// Filas de tejas de un triángulo: líneas de nivel del plano cada ROW píxeles de z, con el canto de cada
// fila en sombra (y una luz debajo en la cara sur) y las juntas entre tejas a tresbolillo.
function roofRows(g, I, r, { pl, T, dir }) {
  const { zc, a, b } = pl, zs = T.map(p => p[2]), zmin = Math.min(...zs), zmax = Math.max(...zs);
  const alongY = Math.abs(b) > Math.abs(a);   // la pendiente va sobre todo en y
  const onLevel = (v, L) => (alongY ? [v, (L - zc - a * v) / b] : [(L - zc - b * v) / a, v]);
  const zAt = p => zc + a * p[0] + b * p[1];
  const dark = dir === 's' ? r.d : r.d2;   // 's': cae hacia la izquierda de la vista; 'e', hacia la derecha
  const seg = (A, B, col, dz = 0) => {
    const s = clipToTri(A, B, T);
    if (s) line(g, ...I.P(s[0][0], s[0][1], zAt(s[0]) + dz), ...I.P(s[1][0], s[1][1], zAt(s[1]) + dz), col);
  };
  for (let k = Math.ceil((zmin - ROOF_Z0) / ROW); k * ROW + ROOF_Z0 < zmax; k++) {
    const L = ROOF_Z0 + k * ROW;
    if (L <= zmin) continue;
    const A = onLevel(-1, L), B = onLevel(1, L);
    seg(A, B, dark);
    if (dir === 's') seg(A, B, r.l, -1);
    for (let u = -0.5 + (k % 2 ? 0.25 : 0); u <= 0.5; u += 0.5) seg(onLevel(u, L - 1), onLevel(u, L - ROW + 1), dark);
  }
}
// Chimenea de piedra sobre la superficie del tejado, desde z0 hasta z0 + 24, con remate oscuro (q: girada)
function roofChimney(g, I, z0, q) {
  const st = ramp(STONE), s = 0.15, top = Math.min(z0 + 24, ROOF_AY - 2);
  // Un poco de sombra sobre las tejas, hacia el sur y el este
  I.quad([-s, s, z0], [s, s, z0], [s + 0.05, 0.4, z0 - 6], [-s + 0.05, 0.4, z0 - 6], 'rgba(30,14,14,.28)');
  I.quad([s, -s, z0], [s, s, z0], [0.4, s + 0.05, z0 - 6], [0.4, -s + 0.05, z0 - 6], 'rgba(30,14,14,.28)');
  const c = mk(ROOF_W, ROOF_H), cg = c.getContext('2d'), J = iso(cg, ROOF_AX, ROOF_AY, 1, q, true);
  J.box(-s, -s, s, s, z0, top - 2, { top: st.l, left: st.b, right: st.d });
  for (let z = z0 + 5; z < top - 4; z += 6) for (const [n, a, b] of [[[0, 1], [-s, s], [s, s]], [[1, 0], [s, -s], [s, s]], [[0, -1], [-s, -s], [s, -s]], [[-1, 0], [-s, -s], [-s, s]]]) J.edge(n, [...a, z], [...b, z], J.side(n) === 'left' ? st.d : st.d2);
  J.box(-s - 0.05, -s - 0.05, s + 0.05, s + 0.05, top - 2, top, { top: st.d, left: st.d, right: st.d2 });
  J.quad([-0.08, -0.08, top], [0.08, -0.08, top], [0.08, 0.08, top], [-0.08, 0.08, top], '#2a2426');
  g.drawImage(outlined(c), 0, 0);
}
// Hacia dónde mira cada lado de la casilla, y qué lado sigue a cada extremo de su borde (para las esquinas)
const NORMAL = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
const NEXT = { n: ['w', 'e'], e: ['n', 's'], s: ['e', 'w'], w: ['s', 'n'] };
// h: { nw, ne, se, sw, c } niveles (múltiplos de 0.5, de 0 a 4) de las esquinas y el centro de la casilla
//   (nw = esquina (x, y), ne = (x+1, y), se = (x+1, y+1), sw = (x, y+1)); puede traer también n, e, s, w.
// eaves: { n, e, s, w } true donde la casilla vecina en esa dirección no tiene tejado (n = y-1, e = x+1…)
// chimney: true si hay un hogar debajo (dibuja la chimenea en el centro)
// Devuelve un lienzo ROOF_W×ROOF_H con apoyo (ROOF_AX, ROOF_AY) en el punto del suelo del centro de la casilla.
// q: girado con la cámara (las alturas y los aleros siguen en el mundo)
export function roofSprite(id, h, eaves, chimney = false, q = 0) {
  const key = `r:${id}:${['nw', 'ne', 'se', 'sw', 'c', 'n', 'e', 's', 'w'].map(k => h[k] ?? '').join(',')}:${+!!eaves.n}${+!!eaves.e}${+!!eaves.s}${+!!eaves.w}:${+!!chimney}:${q}`;
  return cached(key, () => {
    const c = mk(ROOF_W, ROOF_H), g = c.getContext('2d'), I = iso(g, ROOF_AX, ROOF_AY, 1, q, true, SEAM(q)), r = ramp(ROOFS[id] || ROOFS.tejado_rojo);
    const pts = roofPoints(h, eaves), below = p => [p[0], p[1], p[2] - EAVE];
    // Canto del alero: una franja vertical bajo el borde, en los lados que miran a la cámara
    for (const side of ['n', 'w', 's', 'e']) if (eaves[side] && I.shows(NORMAL[side])) {
      const [p, m, q2] = SIDES[side].map(k => pts[k]);
      I.face([p, m, q2, below(q2), below(m), below(p)], I.side(NORMAL[side]) === 'left' ? r.d2 : mixHex(r.d2, '#000000', 0.18));
    }
    // La superficie: un triángulo por cada par de puntos seguidos del borde, solo los que se ven
    const rows = [], seen = {};
    for (let i = 0; i < 8; i++) {
      const p = pts[RING[i]], q = pts[RING[(i + 1) % 8]], [ax, ay] = I.P(...pts.c), [bx, by] = I.P(...p), [cx, cy] = I.P(...q);
      const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);   // > 0: se ve desde arriba
      seen[RING[i] + RING[(i + 1) % 8]] = cross > -1e-6;
      if (cross < 1e-6) continue;   // de canto o de espaldas
      // Hacia dónde cae (cuesta abajo, -∇z), visto desde la cámara: hacia ella a la izquierda ('s') o a la
      // derecha ('e'); de espaldas, hacia arriba a la derecha ('n') o a la izquierda ('w')
      const pl = plane(pts.c, p, q), flat = Math.abs(pl.a) < 1e-6 && Math.abs(pl.b) < 1e-6;
      const [ux, uy] = I.P(-pl.a, -pl.b, 0).map((v, k) => v - I.P(0, 0, 0)[k]), [du, dv] = [(ux / 16 + uy / 8) / 2, (uy / 8 - ux / 16) / 2];
      const dir = flat ? 'flat' : du + dv > 1e-6 ? (dv >= du ? 's' : 'e') : dv <= du ? 'n' : 'w';
      I.face([pts.c, p, q], { s: r.b, e: r.d, n: r.d2, w: r.l, flat: r.b }[dir]);
      if (dir === 's' || dir === 'e') rows.push({ pl, T: [pts.c, p, q], dir });
    }
    for (const row of rows) roofRows(g, I, r, row);
    // Contorno de los aleros: el borde de arriba (en los lados de atrás, solo si queda a la vista), y en los
    // que miran a la cámara también el canto y sus extremos cuando el lado de al lado es otro alero
    const L = (p, q2, col = OUTLINE) => line(g, ...I.P(...p), ...I.P(...q2), col);
    for (const side of ['n', 'w', 'e', 's']) if (eaves[side]) {
      const [a, b, c2] = SIDES[side], p = pts[a], m = pts[b], q2 = pts[c2];
      const front = I.shows(NORMAL[side]);
      if (front || seen[a + b]) L(p, m);
      if (front || seen[b + c2]) L(m, q2);
      if (!front) continue;
      L(below(p), below(m)); L(below(m), below(q2));
      if (eaves[NEXT[side][0]]) L(p, below(p));
      if (eaves[NEXT[side][1]]) L(q2, below(q2));
    }
    if (chimney) roofChimney(g, I, pts.c[2], q);
    return c;
  });
}

// ---------- Vallas: poste con medias barras hacia los vecinos (bits: 1 +x, 2 -x, 4 +y, 8 -y) ----------
const FENCES = { valla: '#c8925a', valla_piedra: '#a09a90' };
export function fenceSprite(id, mask, q = 0) {
  return cached(`v:${id}:${mask}:${q}`, () => {
    const [c, , I] = canvas(q), col = boxCol(FENCES[id]), stone = id === 'valla_piedra';
    const h = stone ? 12 : 16, t = stone ? 0.14 : 0.05;
    const rails = stone ? [[0, 12]] : [[5, 7], [11, 13]];
    const rail = (x0, y0, x1, y1) => { for (const [z0, z1] of rails) I.box(x0, y0, x1, y1, z0, z1, col); };
    if (mask & 8) rail(-t, -0.5, t, 0);
    if (mask & 2) rail(-0.5, -t, 0, t);
    I.box(-0.08, -0.08, 0.08, 0.08, 0, h + 2, col);
    if (mask & 1) rail(0, -t, 0.5, t);
    if (mask & 4) rail(-t, 0, t, 0.5);
    I.flush();
    return outlined(c);
  });
}

// Icono de una pieza de construcción para la paleta: lo dibujado en el sprite (sin el lienzo vacío),
// reducido para que quepa entero y centrado en 36×36
export function pieceIcon(img) {
  const c = mk(36, 36), g = c.getContext('2d'), d = img.getContext('2d').getImageData(0, 0, img.width, img.height).data;
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (d[(y * img.width + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (x1 < 0) return c;
  const w = x1 - x0 + 1, h = y1 - y0 + 1, k = Math.min(34 / w, 34 / h, 1);
  g.imageSmoothingEnabled = false;
  g.drawImage(img, x0, y0, w, h, Math.round(18 - (w * k) / 2), Math.round(18 - (h * k) / 2), Math.round(w * k), Math.round(h * k));
  return c;
}
