// Sprites de lo que se coloca en el mundo: estaciones de trabajo y muebles.
// Todos ocupan una casilla y se dibujan centrados en ella (lienzo 40×70, apoyo en 20,58).
import { mk, ellipse, outlined, ramp, line, mixHex } from '../util.js';
import { iso, boxCol, STEPS } from '../iso.js';

export const PLACE_W = 40, PLACE_H = 70, PLACE_AX = 20, PLACE_AY = 58;

const wood = boxCol('#b07a44'), woodD = boxCol('#7a5030'), woodL = boxCol('#c8925a');
const leg = (I, x, y, z1, col = woodD, t = 0.08) => I.box(x, y, x + t, y + t, 0, z1, col);

// Cofre de baúl: cuerpo de tablas, tapa redonda (medio cilindro), dos herrajes que abrazan cuerpo y tapa,
// cantoneras y cerradura. Lo usan el cofre que se fabrica (madera clara y hierro) y los del tesoro
// (madera oscura y oro). Abierto: la tapa echada hacia atrás y el interior vacío.
export function drawChest(I, { wood = '#a8703a', metal = '#5a5a66', lock = '#e8c050', open = false } = {}) {
  const X0 = -0.4, X1 = 0.4, Y0 = -0.25, Y1 = 0.25, H = 8, LID = 5, w = ramp(wood), m = ramp(metal);
  const BANDS = [[-0.3, -0.23], [0.23, 0.3]];
  // Perfil de la tapa cerrada, de atrás adelante: puntos [y, z]
  const N = 8, rad = (Y1 - Y0) / 2;
  const prof = Array.from({ length: N + 1 }, (_, i) => { const t = Math.PI * (1 - i / N); return [rad * Math.cos(t), H + LID * Math.sin(t), t]; });
  const body = () => {
    I.box(X0, Y0, X1, Y1, 0, H, { top: w.l, left: w.b, right: w.d });
    for (const z of [2.5, 5.2]) { I.faceL(Y1, X0, X1, z, z + 0.8, w.d); I.faceR(X1, Y0, Y1, z, z + 0.8, w.d2); }
    for (const [u0, u1] of BANDS) I.faceL(Y1, u0, u1, 0, H, m.b);
    I.faceR(X1, Y0, Y0 + 0.07, 0, H, m.d); I.faceR(X1, Y1 - 0.07, Y1, 0, H, m.d);
    for (const u of [X0, X1 - 0.07]) I.faceL(Y1, u, u + 0.07, 0, 2, m.l);
    I.faceL(Y1, X0, X1, H - 0.8, H, w.d2); I.faceR(X1, Y0, Y1, H - 0.8, H, w.d2);
  };
  if (!open) {
    body();
    // Tapa: tiras de atrás adelante (arriba con luz), herrajes encima y la cara del extremo
    const strips = (u0, u1, c) => {
      for (let i = 0; i < N; i++) {
        const [ya, za] = prof[i], [yb, zb] = prof[i + 1], t = (prof[i][2] + prof[i + 1][2]) / 2;
        I.quad([u0, ya, za], [u1, ya, za], [u1, yb, zb], [u0, yb, zb], t > 2.3 ? c.b : t > 0.7 ? c.l : c.b);
      }
    };
    strips(X0, X1, w);
    for (const [u0, u1] of BANDS) strips(u0, u1, m);
    I.face(prof.map(([y, z]) => [X1, y, z]), w.d);
    I.face(prof.slice(0, 3).map(([y, z]) => [X1, y, z]).concat([[X1, prof[2][0], H]]), w.d2);
    I.faceL(Y1, -0.06, 0.06, H - 4, H + 2, lock);
  } else {
    // Tapa abierta: de pie detrás del cuerpo, un poco echada hacia atrás. Se ve su cara de dentro.
    const back = Y0 - 0.14, top = H + 11;
    I.face([[X1, Y0, H], [X1, back, top], [X1, back - 0.22, top - 3], [X1, Y0 - 0.26, H + 3]], w.d2);
    I.quad([X0, Y0, H], [X1, Y0, H], [X1, back, top], [X0, back, top], w.d);
    for (const [u0, u1] of BANDS) I.quad([u0, Y0, H], [u1, Y0, H], [u1, back, top], [u0, back, top], m.d);
    I.quad([X0, back, top], [X1, back, top], [X1, back - 0.06, top + 1], [X0, back - 0.06, top + 1], w.l);
    body();
    // Interior vacío
    I.quad([X0 + 0.05, Y0 + 0.05, H], [X1 - 0.05, Y0 + 0.05, H], [X1 - 0.05, Y1 - 0.05, H], [X0 + 0.05, Y1 - 0.05, H], '#2a1810');
    I.quad([X0 + 0.05, Y0 + 0.05, H], [X1 - 0.05, Y0 + 0.05, H], [X1 - 0.05, Y0 + 0.13, H], [X0 + 0.05, Y0 + 0.13, H], w.d2);
    I.faceL(Y1, -0.06, 0.06, H - 4, H, lock);
  }
  I.faceL(Y1, -0.015, 0.015, H - 3, H - 1, '#2a1c22');   // ojo de la cerradura
}

const DRAW = {
  banco(I) {
    leg(I, -0.42, -0.3, 12); leg(I, 0.34, -0.3, 12);
    I.box(-0.4, -0.26, 0.4, 0.24, 3, 5, woodD);
    leg(I, -0.42, 0.22, 12); leg(I, 0.34, 0.22, 12);
    I.box(-0.46, -0.32, 0.46, 0.32, 12, 16, woodL);
    I.box(-0.32, -0.16, 0.08, 0.02, 16, 18, boxCol('#e0b878'));        // tabla
    I.quad([0.12, -0.26, 16.5], [0.4, -0.26, 16.5], [0.4, -0.16, 16.5], [0.12, -0.16, 16.5], '#c8ccd4');   // sierra
    I.box(0.05, -0.25, 0.13, -0.17, 16, 19, woodD);
    I.box(0.14, 0.12, 0.34, 0.18, 16, 18, woodD);                       // martillo
    I.box(0.3, 0.06, 0.38, 0.24, 16, 21, boxCol('#8a8e96'));
  },
  horno(I) {
    const st = boxCol('#9a948a');
    I.box(-0.45, -0.42, 0.45, 0.42, 0, 24, st);
    for (const [u0, u1, z0] of [[-0.4, -0.1, 4], [0.1, 0.4, 4], [-0.25, 0.15, 10], [-0.42, -0.2, 16], [0.2, 0.42, 16]]) I.faceL(0.42, u0, u1, z0, z0 + 1, '#7a746a');
    for (const [u0, u1, z0] of [[-0.35, 0.05, 6], [0.15, 0.4, 12], [-0.4, -0.05, 18]]) I.faceR(0.45, u0, u1, z0, z0 + 1, '#6a645c');
    I.faceL(0.42, -0.22, 0.22, 2, 15, '#4a3a30');
    I.faceL(0.42, -0.18, 0.18, 2, 13, '#2a1612');
    I.faceL(0.42, -0.14, 0.14, 2, 7, '#ff8a2a');
    I.faceL(0.42, -0.07, 0.07, 2, 5, '#ffd860');
    I.box(-0.48, -0.45, 0.48, 0.45, 24, 27, boxCol('#8a847a'));
    I.box(-0.15, -0.25, 0.15, 0.05, 27, 44, boxCol('#8a837a'));
    I.box(-0.18, -0.28, 0.18, 0.08, 44, 46, boxCol('#6e6860'));
  },
  yunque(I) {
    I.box(-0.24, -0.24, 0.24, 0.24, 0, 9, boxCol('#7a5232'));
    I.quad([-0.24, -0.24, 9], [0.24, -0.24, 9], [0.24, 0.24, 9], [-0.24, 0.24, 9], '#c8a070');
    I.box(-0.18, -0.12, 0.18, 0.12, 9, 12, boxCol('#3e3e46'));
    I.box(-0.1, -0.07, 0.1, 0.07, 12, 15, boxCol('#4a4a54'));
    I.box(-0.38, -0.14, 0.28, 0.14, 15, 20, boxCol('#62626e'));
    I.box(0.28, -0.08, 0.46, 0.08, 16, 19, boxCol('#62626e'));
  },
  telar(I) {
    const frame = woodD;
    I.box(-0.46, -0.32, -0.36, 0.32, 0, 3, frame);
    I.box(-0.46, -0.05, -0.36, 0.05, 3, 38, frame);
    I.box(-0.36, -0.04, 0.36, 0.04, 8, 11, wood);
    I.faceL(0.0, -0.36, 0.36, 11, 33, '#e8e0d0');
    for (let u = -0.34; u < 0.36; u += 0.1) I.faceL(0.0, u, u + 0.03, 11, 33, '#c8c0b0');
    I.faceL(0.0, -0.36, 0.36, 14, 23, '#c0644a');
    I.faceL(0.0, -0.36, 0.36, 17, 19, '#e8c070');
    I.box(-0.36, -0.04, 0.36, 0.04, 33, 36, wood);
    I.box(0.36, -0.32, 0.46, 0.32, 0, 3, frame);
    I.box(0.36, -0.05, 0.46, 0.05, 3, 38, frame);
  },
  cocina(I) {
    I.box(-0.45, -0.4, 0.45, 0.4, 0, 18, boxCol('#b0563a'));
    for (const z of [6, 12]) { I.faceL(0.4, -0.45, 0.45, z, z + 1, '#7a3424'); I.faceR(0.45, -0.4, 0.4, z, z + 1, '#6a2c1e'); }
    for (const [u, z] of [[-0.2, 1], [0.25, 1], [0.0, 7], [-0.35, 13], [0.3, 13]]) I.faceL(0.4, u, u + 0.03, z, z + 5, '#7a3424');
    I.faceL(0.4, -0.24, 0.24, 2, 11, '#2a2a30');
    I.faceL(0.4, -0.16, 0.16, 2, 6, '#ff8a2a');
    I.box(-0.47, -0.42, 0.47, 0.42, 18, 21, boxCol('#3a3a42'));
    I.box(-0.2, -0.22, 0.16, 0.14, 21, 30, boxCol('#5a5a66'));
    I.quad([-0.17, -0.19, 30], [0.13, -0.19, 30], [0.13, 0.11, 30], [-0.17, 0.11, 30], '#c87a3a');
    I.quad([-0.1, -0.12, 30.5], [0.04, -0.12, 30.5], [0.04, 0.02, 30.5], [-0.1, 0.02, 30.5], '#e8a050');
  },
  silla(I) {
    leg(I, -0.24, -0.24, 10, woodD, 0.07); leg(I, 0.17, -0.24, 10, woodD, 0.07);
    leg(I, -0.24, 0.17, 10, woodD, 0.07); leg(I, 0.17, 0.17, 10, woodD, 0.07);
    I.box(-0.26, -0.26, 0.26, 0.26, 10, 12, wood);
    I.box(-0.26, -0.26, -0.19, -0.19, 12, 27, woodD); I.box(0.19, -0.26, 0.26, -0.19, 12, 27, woodD);
    I.box(-0.26, -0.26, 0.26, -0.2, 20, 26, wood);
  },
  mesa(I) {
    leg(I, -0.42, -0.42, 14); leg(I, 0.34, -0.42, 14);
    leg(I, -0.42, 0.34, 14); leg(I, 0.34, 0.34, 14);
    I.box(-0.46, -0.46, 0.46, 0.46, 14, 17, wood);
    I.box(0.05, -0.15, 0.17, -0.03, 17, 23, boxCol('#e8e0d0'));     // una taza
  },
  // Cama de dos casillas: la cabecera en la suya y los pies en la de delante (+y; girada, +x). Armazón de
  // madera con patas (queda hueco debajo), postes con remate de bola, cabecero alto y arqueado con un
  // cuarterón y piecero bajo; encima, colchón, almohada mullida y una manta acolchada que cae por el lado
  // y por los pies, con la sábana doblada (el embozo) sobre su borde. Se pinta de atrás adelante.
  cama(I, g) {
    const X0 = -0.42, X1 = 0.42, Y0 = -BED_BACK, Y1 = 1.44, P = 0.08, HZ = 30, FZ = 14, RZ0 = 5, RZ1 = 10, MZ = 15;
    const wd = ramp('#b07a44'), WD = { top: wd.l, left: wd.b, right: wd.d };
    // Color de una cara según el lado de la vista al que quede (girada la cama, la de -x puede verse)
    const tone = (n, c) => (I.side(n) === 'left' ? c.b : c.d);
    const post = (x, y, z1) => {
      I.box(x, y, x + P, y + P, 0, z1, WD);
      const cx = x + P / 2, cy = y + P / 2;
      I.box(cx - 0.025, cy - 0.025, cx + 0.025, cy + 0.025, z1, z1 + 1, { top: wd.d, left: wd.d, right: wd.d2 });
      I.ellipse([cx, cy, z1 + 3], 2, 1, wd.b);
      I.px([cx, cy, z1 + 3], -1, -1, 1, 1, wd.l2);
      I.px([cx, cy, z1 + 3], 1, 1, 1, 1, wd.d);
    };
    // Tabla entre dos postes (cara a y + 0.06), con el canto de arriba en arco y un cuarterón hundido
    const panel = (y, z0, z1, arch) => {
      const top = Array.from({ length: 9 }, (_, i) => [X0 + P + (X1 - X0 - 2 * P) * i / 8, z1 + Math.round(Math.sin(Math.PI * i / 8) * arch)]);
      I.face([[X0 + P, y + 0.06, z0], [X1 - P, y + 0.06, z0], ...top.slice().reverse().map(([u, z]) => [u, y + 0.06, z])], wd.b);
      for (let i = 0; i < 8; i++) I.face([[top[i][0], y, top[i][1]], [top[i + 1][0], y, top[i + 1][1]], [top[i + 1][0], y + 0.06, top[i + 1][1]], [top[i][0], y + 0.06, top[i][1]]], wd.l);
      const lo = z0 + 4, hi = z1 - 4;
      if (hi - lo > 3) { I.faceL(y + 0.06, X0 + P + 0.07, X1 - P - 0.07, lo, hi, wd.d); I.faceL(y + 0.06, X0 + P + 0.09, X1 - P - 0.07, lo, hi - 1, mixHex(wd.b, wd.d, 0.5)); }
    };
    post(X0, Y0, HZ); panel(Y0 + 0.01, RZ0, HZ - 3, 3); post(X1 - P, Y0, HZ);
    if (I.q) I.box(X0, Y0 + P, X0 + 0.06, Y1 - P, RZ0, RZ1, WD);              // el otro larguero (girada se ve)
    I.box(X1 - 0.06, Y0 + P, X1, Y1 - P, RZ0, RZ1, WD);                       // larguero
    const sh = ramp('#e6dcc6');
    I.box(X0 + 0.03, Y0 + 0.07, X1 - 0.03, Y1 - 0.07, RZ1, MZ, { top: sh.l, left: sh.b, right: sh.d });   // colchón
    // Almohada: blanco frío, esquinas redondeadas, abombada y con su sombra en el colchón
    const pw = ramp('#e4eaf4'), px0 = X0 + 0.09, px1 = X1 - 0.09, py0 = Y0 + 0.11, py1 = Y0 + 0.43, k = 0.06, pz = MZ + 5;
    I.line([px0 + k, py1 + 0.04, MZ], [px1, py1 + 0.04, MZ], sh.d); I.line([px1 + 0.03, py0 + k, MZ], [px1 + 0.03, py1, MZ], sh.d);
    if (I.q) { I.faceL(py0, px0 + k, px1 - k, MZ, pz - 1, pw.d, -1); I.faceR(px0, py0 + k, py1 - k, MZ, pz - 2, pw.d2, -1); }
    I.faceL(py1, px0 + k, px1 - k, MZ, pz - 2, pw.d);
    I.face([[px1 - k, py1, MZ], [px1, py1 - k, MZ], [px1, py1 - k, pz - 2], [px1 - k, py1, pz - 2]], mixHex(pw.d, pw.d2, 0.5));
    I.faceR(px1, py0 + k, py1 - k, MZ, pz - 2, pw.d2);
    I.face([[px0 + k, py0, pz - 1], [px1 - k, py0, pz - 1], [px1, py0 + k, pz - 1], [px1, py1 - k, pz - 2], [px1 - k, py1, pz - 2], [px0 + k, py1, pz - 2], [px0, py1 - k, pz - 2], [px0, py0 + k, pz - 1]], pw.l);
    I.face([[px0 + 0.12, py0 + 0.07, pz], [px1 - 0.12, py0 + 0.07, pz], [px1 - 0.08, py1 - 0.1, pz], [px0 + 0.16, py1 - 0.1, pz]], pw.l2);
    // Manta acolchada: arriba, el lado y los pies, con el bajo ondulado y las costuras
    const q = ramp('#4a72a8'), by0 = Y0 + 0.62, by1 = Y1 - 0.06, qx0 = X0 + 0.02, qx1 = X1 - 0.02, qz = MZ + 1;
    // La manta cae por los dos lados (de la vista solo se ve uno)
    for (const [x, n] of [[qx1, 1], [qx0, -1]]) {
      I.faceR(x, by0, by1, RZ1, qz, tone([n, 0], q), n);
      for (let y = by0, i = 0; y < by1; y += 0.12, i++) I.faceR(x, y, Math.min(y + 0.12, by1), RZ1, RZ1 + (i % 2 ? 1 : 2), q.d2, n);
    }
    I.faceL(by1, qx0, qx1, RZ1, qz, q.b);
    for (let x = qx0, i = 0; x < qx1; x += 0.12, i++) I.faceL(by1, x, Math.min(x + 0.12, qx1), RZ1, RZ1 + (i % 2 ? 1 : 2), q.d);
    I.quad([qx0, by0, qz], [qx1, by0, qz], [qx1, by1, qz], [qx0, by1, qz], q.l);
    for (const t of [0.4, 0.75]) {
      const y = by0 + (by1 - by0) * t;
      I.line([qx0 + 0.02, y, qz], [qx1, y, qz], q.b);
      I.edge([1, 0], [qx1, y, qz - 1], [qx1, y, RZ1 + 3], q.d2); I.edge([-1, 0], [qx0, y, qz - 1], [qx0, y, RZ1 + 3], q.d2);
    }
    I.line([0, by0 + 0.14, qz], [0, by1, qz], q.b); I.edge([0, 1], [0, by1, qz - 1], [0, by1, RZ1 + 3], q.d);
    // Embozo: la sábana doblada sobre el borde de la manta, con una lista
    const sw = ramp('#fbf8f2');
    I.faceR(qx1 + 0.002, by0, by0 + 0.13, MZ - 2, qz + 1, tone([1, 0], sw), 1); I.faceR(qx0 - 0.002, by0, by0 + 0.13, MZ - 2, qz + 1, tone([-1, 0], sw), -1);
    I.quad([qx0 - 0.002, by0, qz + 1], [qx1 + 0.002, by0, qz + 1], [qx1 + 0.002, by0 + 0.13, qz + 1], [qx0 - 0.002, by0 + 0.13, qz + 1], sw.l);
    I.line([qx0, by0 + 0.13, qz + 1], [qx1, by0 + 0.13, qz + 1], q.d);
    post(X0, Y1 - P, FZ); panel(Y1 - 0.07, RZ0, FZ - 3, 0); post(X1 - P, Y1 - P, FZ);   // piecero
  },
  estanteria(I) {
    I.box(-0.45, -0.2, 0.45, 0.2, 0, 44, wood);
    const books = ['#a83a3a', '#3a6ab8', '#3f8a4a', '#c8902a', '#6a4ab8', '#e8e0d0'];
    for (let k = 0; k < 3; k++) {
      const z = 5 + k * 13;
      I.faceL(0.2, -0.4, 0.4, z, z + 10, '#5a3a22');
      for (let i = 0, u = -0.38; u < 0.36; i++, u += 0.11) I.faceL(0.2, u, u + 0.09, z, z + 6 + ((i * 3 + k) % 4), books[(i + k * 2) % books.length]);
    }
  },
  maceta(I, g) {
    I.box(-0.2, -0.2, 0.2, 0.2, 0, 10, boxCol('#b0603a'));
    I.quad([-0.17, -0.17, 10], [0.17, -0.17, 10], [0.17, 0.17, 10], [-0.17, 0.17, 10], '#5a3a22');
    const top = [0, 0, 18], leaf = ramp('#4f9a3a');
    I.ellipse(top, 9, 7, leaf.d, 0, 2); I.ellipse(top, 7, 6, leaf.b, -1, 0); I.ellipse(top, 3, 2, leaf.l, -3, -2);
    for (const [dx, dy, c] of [[-4, -3, '#ff9ab8'], [3, -1, '#ffe04a'], [0, -6, '#ff9ab8'], [5, 3, '#ffffff']]) I.px(top, dx, dy, 2, 2, c);
  },
  lampara(I, g) {
    I.box(-0.12, -0.12, 0.12, 0.12, 0, 3, boxCol('#4a4a54'));
    I.box(-0.03, -0.03, 0.03, 0.03, 3, 30, boxCol('#4a4a54'));
    I.box(-0.15, -0.15, 0.15, 0.15, 30, 40, boxCol('#ffe6a0'));
    I.box(-0.18, -0.18, 0.18, 0.18, 40, 43, boxCol('#34343c'));
  },
  antorcha(I) {
    I.box(-0.04, -0.04, 0.04, 0.04, 0, 22, boxCol('#7a5030'));
    I.box(-0.07, -0.07, 0.07, 0.07, 20, 24, boxCol('#4a4a54'));
    I.box(-0.05, -0.05, 0.05, 0.05, 24, 29, boxCol('#ff8a2a'));
    I.box(-0.03, -0.03, 0.03, 0.03, 29, 32, boxCol('#ffd860'));
  },
  cofre(I) { drawChest(I); },
  aspersor(I, g) {
    I.box(-0.06, -0.06, 0.06, 0.06, 0, 10, boxCol('#8a8e96'));
    I.box(-0.22, -0.22, 0.22, 0.22, 10, 13, boxCol('#b8c2ce'));
    for (const [x, y] of [[-0.3, 0], [0.3, 0], [0, -0.3], [0, 0.3]]) I.px([x, y, 14], 0, 0, 2, 1, '#7ab8e0');
  },
  gallinero(I) {
    I.box(-0.42, -0.4, 0.42, 0.4, 0, 18, boxCol('#c8925a'));
    I.faceL(0.4, -0.12, 0.12, 0, 10, '#4a3020');
    I.faceR(0.42, -0.3, -0.1, 10, 14, '#4a3020');
    I.box(-0.48, -0.46, 0.48, 0.46, 18, 21, boxCol('#c95a3c'));
    I.box(-0.36, -0.34, 0.36, 0.34, 21, 27, boxCol('#c95a3c'));
    I.box(0.42, -0.1, 0.5, 0.25, 0, 3, boxCol('#a8764a'));
  },
  establo(I) {
    I.box(-0.46, -0.44, 0.46, 0.44, 0, 26, boxCol('#b0563a'));
    I.faceL(0.44, -0.24, 0.24, 0, 18, '#e8e0d0'); I.faceL(0.44, -0.2, 0.2, 0, 16, '#6a4428');
    for (const [a, b] of [[-0.2, 0.2], [0.2, -0.2]]) { const t = [a, b]; I.faceL(0.44, Math.min(...t), Math.min(...t) + 0.03, 0, 16, '#e8e0d0'); }
    I.faceR(0.46, -0.2, 0.2, 14, 22, '#e8e0d0'); I.faceR(0.46, -0.16, 0.16, 15, 21, '#6a4428');
    I.box(-0.5, -0.48, 0.5, 0.48, 26, 29, boxCol('#7a3424'));
    I.box(-0.36, -0.34, 0.36, 0.34, 29, 38, boxCol('#7a3424'));
  },
  colmena(I) {
    I.box(-0.06, -0.06, 0.06, 0.06, 0, 8, boxCol('#7a5030'));
    for (const [z0, z1, w] of [[8, 13, 0.26], [13, 18, 0.3], [18, 23, 0.26], [23, 27, 0.18]]) I.box(-w, -w, w, w, z0, z1, boxCol(z0 % 2 ? '#d09a30' : '#e8b040'));
    I.faceL(0.3, -0.06, 0.06, 13, 16, '#4a3020');
  },
  comedero(I) {
    for (const [x, y] of [[-0.4, -0.2], [0.32, -0.2], [-0.4, 0.12], [0.32, 0.12]]) I.box(x, y, x + 0.08, y + 0.08, 0, 6, woodD);
    I.box(-0.42, -0.24, 0.42, 0.24, 6, 12, wood);
    I.quad([-0.36, -0.18, 12], [0.36, -0.18, 12], [0.36, 0.18, 12], [-0.36, 0.18, 12], '#c8b060');
  },
  vitrina(I) {
    I.box(-0.4, -0.3, 0.4, 0.3, 0, 12, wood);
    I.box(-0.36, -0.26, 0.36, 0.26, 12, 30, boxCol('#c8ecfa'));
    I.box(-0.05, -0.05, 0.08, 0.08, 12, 18, boxCol('#9a5ae0'));
    I.box(-0.25, -0.15, -0.12, -0.02, 12, 16, boxCol('#e8c050'));
    I.box(-0.4, -0.3, 0.4, 0.3, 30, 33, woodD);
  },
  alfombra(I) {
    I.quad([-0.48, -0.48, 0], [0.48, -0.48, 0], [0.48, 0.48, 0], [-0.48, 0.48, 0], '#8a3a3a');
    I.quad([-0.4, -0.4, 0], [0.4, -0.4, 0], [0.4, 0.4, 0], [-0.4, 0.4, 0], '#c0644a');
    I.quad([-0.18, -0.18, 0], [0.18, -0.18, 0], [0.18, 0.18, 0], [-0.18, 0.18, 0], '#e8c070');
    I.quad([-0.08, -0.08, 0], [0.08, -0.08, 0], [0.08, 0.08, 0], [-0.08, 0.08, 0], '#8a3a3a');
  },
  // Hogar con chimenea: caja de piedra con la boca negra hacia delante (el fuego lo dibuja el juego en
  // `o.fire`), repisa de madera y, encima, la columna de piedra. Sube hasta donde cabe en el lienzo
  // (z≈56); lo que queda bajo el tejado lo tapa el tejado y por encima la dibuja el propio tejado.
  chimenea(I, g) { drawHearth(I, g, 56); },
};

// Hogar de piedra: un cuerpo ancho casi como la casilla con la boca grande hacia delante, repisa de madera
// y, encima, el tiro de piedra hasta z = top, apoyado detrás (contra la pared). En una casa, el tiro sube
// hasta el alero (lo dibuja art/build.js en un lienzo más alto) y el tejado pone el remate encima.
export const HEARTH_BACK = 0.34;   // de su centro a su parte de atrás (para arrimarlo a la pared)
export function drawHearth(I, g, top) {
  const st = ramp('#a59e92'), X0 = -0.46, X1 = 0.46, Y0 = -HEARTH_BACK, Y1 = 0.26, H = 40;
  const SX0 = -0.3, SX1 = 0.3, SY1 = 0.02;   // el tiro
  I.box(X0, Y0, X1, Y1, 0, H, { top: st.l, left: st.b, right: st.d });
  // Piedras: hiladas en las dos caras que se ven
  for (const z of [8, 16, 24, 32]) { I.edge([0, 1], [X0, Y1, z], [X1, Y1, z], st.d); I.edge([1, 0], [X1, Y0, z], [X1, Y1, z], st.d2); }
  for (const [u, z] of [[-0.4, 0], [0.38, 0], [-0.4, 16], [0.38, 16], [-0.3, 24], [0.3, 24], [-0.1, 32], [0.2, 32]]) I.faceL(Y1, u, u + 0.02, z, z + 8, st.d);
  for (const [u, z] of [[-0.1, 0], [0.1, 8], [-0.2, 16], [0.05, 24], [-0.12, 32]]) I.faceR(X1, u, u + 0.02, z, z + 8, st.d2);
  // La boca: arco de piedra oscura, hueco negro y la parrilla
  I.faceL(Y1, -0.34, 0.34, 0, 27, '#4a4038');
  I.faceL(Y1, -0.29, 0.29, 0, 24, '#1c1412');
  I.faceL(Y1, -0.22, 0.22, 2, 4, '#3a3036');
  I.faceL(Y1, -0.16, 0.16, 4, 6, '#3a2418');                // brasas apagadas
  I.box(X0 - 0.05, Y0, X1 + 0.05, Y1 + 0.08, H, H + 4, woodD);   // repisa
  // El tiro, contra la pared, con sus hiladas
  I.box(SX0, Y0, SX1, SY1, H + 4, top, { top: st.l, left: st.b, right: st.d });
  for (let z = H + 10; z < top - 2; z += 8) { I.edge([0, 1], [SX0, SY1, z], [SX1, SY1, z], st.d); I.edge([1, 0], [SX1, Y0, z], [SX1, SY1, z], st.d2); }
  for (let z = H + 4, i = 0; z < top - 6; z += 8, i++) I.faceL(SY1, i % 2 ? -0.05 : 0.12, (i % 2 ? -0.05 : 0.12) + 0.02, z, z + 8, st.d);
}

// Dónde está la boca del fuego (para el parpadeo), relativa al apoyo
export const GLOW = { horno: [0, 0.42, 4], cocina: [0, 0.4, 4], chimenea: [0, 0.27, 6] };
// Lo que da luz de noche: [dx, dy, z, radio]
export const LIGHT = { horno: [0, 0.42, 6, 42], cocina: [0, 0.4, 6, 34], lampara: [0, 0, 35, 70], antorcha: [0, 0, 28, 52], chimenea: [0, 0.3, 12, 70] };

// Lo que ocupa dos casillas: la suya y la de delante (+y; girado, la de +x). Su lienzo es más grande:
// [ancho, alto, apoyo x, apoyo y], con el apoyo en medio para que el espejo quede en su sitio.
export const LONG = { cama: [80, 84, 40, 58] };
export const BED_BACK = 0.46;   // de la casilla de la cabecera a la parte de atrás de la cama
export const footTile = (tx, ty, rot) => (rot ? [tx + 1, ty] : [tx, ty + 1]);
export const placeAnchor = id => (LONG[id] ? LONG[id].slice(2) : [PLACE_AX, PLACE_AY]);

const cache = new Map();
// q: hacia dónde mira, visto desde la cámara (en pasos de la cámara: STEPS por vuelta). 0: de frente; un cuarto
// de vuelta: girado (su R); más: de lado o de espaldas, cuando la cámara gira. Cada vista se dibuja con el
// objeto girado (art de cajas en 3D).
export function placeSprite(id, q = 0) {
  q = ((q % STEPS) + STEPS) % STEPS;
  const key = `${id}@${q}`;
  if (cache.has(key)) return cache.get(key);
  const [W, H, AX, AY] = LONG[id] || [PLACE_W, PLACE_H, PLACE_AX, PLACE_AY];
  const c = mk(W, H), I = iso(c.getContext('2d'), AX, AY, 1, q);
  DRAW[id](I, c.getContext('2d'));
  I.flush();
  if (id === 'alfombra') { cache.set(key, c); return c; }
  // Sombra suave debajo (lo largo la dibuja él mismo) y el sprite con contorno encima
  const img = mk(W, H), g = img.getContext('2d');
  if (!LONG[id]) ellipse(g, AX, AY + 1, 14, 6, 'rgba(20,30,15,.28)');
  else iso(g, AX, AY, 1, q).quad([-0.46, -0.48, 0], [0.48, -0.48, 0], [0.48, 1.5, 0], [-0.46, 1.5, 0], 'rgba(20,30,15,.28)');
  g.drawImage(outlined(c), 0, 0);
  cache.set(key, img);
  return img;
}
