// Proyección isométrica 2:1. Casilla de 32×16 píxeles.
// La cámara gira en STEPS pasos por vuelta (VIEW.r, de 0 a STEPS - 1): el mundo se gira antes de proyectarlo,
// así que todo lo que pasa por toScreen y toGrid ya sale desde el ángulo de la cámara.
import { poly, ramp, line, ellipse } from './util.js';

export const HW = 16, HH = 8;
export const STEPS = 16;
// Coseno y seno de un giro de n pasos (hacia -y → -x, como (x, y) → (y, -x) cada cuarto de vuelta), sin
// errores de redondeo en los cuartos de vuelta
function turnOf(n) {
  const a = (-n * 2 * Math.PI) / STEPS, snap = v => (Math.abs(v) < 1e-9 ? 0 : Math.abs(Math.abs(v) - 1) < 1e-9 ? Math.sign(v) : v);
  return [snap(Math.cos(a)), snap(Math.sin(a))];
}
const rotate = (x, y, c, s) => [x * c - y * s, x * s + y * c];

export const VIEW = { r: 0, c: 1, s: 0 };
export function setViewRot(r) { VIEW.r = ((r % STEPS) + STEPS) % STEPS; [VIEW.c, VIEW.s] = turnOf(VIEW.r); }
// Giro continuo (en radianes, el mismo sentido que turnOf): lo usa el mapa para girar con la cámara 3D
export function setViewAngle(a) {
  VIEW.c = Math.cos(a); VIEW.s = Math.sin(a);
  VIEW.r = ((Math.round((-a * STEPS) / (2 * Math.PI)) % STEPS) + STEPS) % STEPS;
}
// Del mundo a la vista de la cámara y al revés (también vale para direcciones)
export const toView = (x, y) => rotate(x, y, VIEW.c, VIEW.s);
export const fromView = (x, y) => rotate(x, y, VIEW.c, -VIEW.s);
// Hacia dónde se acerca uno a la cámara, en el mundo (lo que está más allá en esta dirección tapa a lo de antes)
export const depthDir = () => fromView(1, 1);

// Rejilla del mundo → píxeles de "pantalla del mundo" (sin cámara). z sube hacia arriba.
export const toScreen = (x, y, z = 0) => { [x, y] = toView(x, y); return [(x - y) * HW, (x + y) * HH - z]; };
export const toGrid = (sx, sy) => fromView((sx / HW + sy / HH) / 2, (sy / HH - sx / HW) / 2);

// Ayudante para dibujar figuras isométricas en un lienzo con origen (ox, oy).
// `s` encoge el dibujo (se usa para hacer iconos con el mismo código que los sprites).
// `q` gira el objeto (en pasos de la cámara) para verlo desde otro lado. Sin girar se pinta todo al momento,
// en el orden del código; girado, las piezas se apuntan y flush() las pinta de atrás adelante (cada una con
// su caja en 3D) — salvo con `now`, para lo que no se tapa a sí mismo (suelos, tejados). Las caras que
// quedan de espaldas no se pintan. `grow` ensancha en planta (no en alto): con la cámara entre dos cuartos de
// vuelta, las casillas caen entre píxeles y, al redondear dónde se dibuja cada una, quedarían rayas entre ellas.
export const SEAM = q => (q % (STEPS / 4) ? 1.07 : 1);
export function iso(g, ox, oy, s = 1, q = 0, now = false, grow = 1) {
  const [c, sn] = turnOf(q), R = (x, y) => rotate(x * grow, y * grow, c, sn);
  const V = (x, y, z = 0) => [ox + (x - y) * HW * s, oy + ((x + y) * HH - z) * s];   // ya en la vista
  const P = (x, y, z = 0) => { [x, y] = R(x, y); return V(x, y, z); };
  const ops = [], defer = q % STEPS !== 0 && !now;
  const toCam = rotate(1, 1, c, -sn);   // hacia la cámara, en el objeto
  // Caja (en el objeto) de unos puntos [x, y, z]
  const bounds = pts => {
    const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
    for (const [x, y, z = 0] of pts) { b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y); b.z0 = Math.min(b.z0, z); b.z1 = Math.max(b.z1, z); }
    return b;
  };
  const run = (pts, draw) => { if (defer) ops.push({ b: bounds(pts), draw, i: ops.length }); else draw(); };
  // ¿Mira a la cámara una cara con normal n ([x, y], en el objeto)? Y de qué lado de la vista queda
  const shows = n => { const [a, b] = R(...n); return a + b > 1e-6; };
  const side = n => { const [a, b] = R(...n); return a + b <= 1e-6 ? null : b >= a ? 'left' : 'right'; };
  return {
    P, q, shows, side,
    // Una línea sobre una cara con normal n: solo si esa cara mira a la cámara
    edge: (n, a, b, col) => { if (shows(n)) run([a, b], () => line(g, ...P(...a), ...P(...b), col)); },
    quad: (a, b, cc, d, col) => run([a, b, cc, d], () => poly(g, [P(...a), P(...b), P(...cc), P(...d)], col)),
    // Polígono con cualquier número de puntos [x, y, z]
    face: (pts, col) => run(pts, () => poly(g, pts.map(p => P(...p)), col)),
    // Caja: los lados que miran a la cámara (col.left o col.right según hacia dónde queden) y arriba
    box(x0, y0, x1, y1, z0, z1, col) {
      run([[x0, y0, z0], [x1, y1, z1]], () => {
        for (const [n, a, b] of [[[0, 1], [x0, y1], [x1, y1]], [[1, 0], [x1, y0], [x1, y1]], [[0, -1], [x0, y0], [x1, y0]], [[-1, 0], [x0, y0], [x0, y1]]]) {
          const sd = side(n);
          if (sd) poly(g, [P(...a, z0), P(...b, z0), P(...b, z1), P(...a, z1)], sd === 'left' ? col.left : col.right);
        }
        poly(g, [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], col.top);
      });
    },
    // Caras planas: plano y = at con la normal hacia +y (o -y con n = -1), o plano x = at hacia +x (o -x)
    faceL: (y, u0, u1, v0, v1, col, n = 1) => { if (shows([0, n])) run([[u0, y, v0], [u1, y, v1]], () => poly(g, [P(u0, y, v0), P(u1, y, v0), P(u1, y, v1), P(u0, y, v1)], col)); },
    faceR: (x, u0, u1, v0, v1, col, n = 1) => { if (shows([n, 0])) run([[x, u0, v0], [x, u1, v1]], () => poly(g, [P(x, u0, v0), P(x, u1, v0), P(x, u1, v1), P(x, u0, v1)], col)); },
    // Línea, óvalo y rectángulo de píxeles en puntos del objeto (dx, dy: desplazamiento en píxeles)
    line: (a, b, col) => run([a, b], () => line(g, ...P(...a), ...P(...b), col)),
    ellipse: (p, rx, ry, col, dx = 0, dy = 0) => run([p], () => { const [x, y] = P(...p); ellipse(g, x + dx, y + dy, rx, ry, col); }),
    px: (p, dx, dy, w, h, col) => run([p], () => { const [x, y] = P(...p); g.fillStyle = col; g.fillRect(Math.round(x + dx), Math.round(y + dy), w, h); }),
    // Pinta lo apuntado (si el objeto está girado), de atrás adelante
    flush() { for (const op of depthOrder(ops, toCam)) op.draw(); ops.length = 0; },
  };
}

// Orden de dibujo de las piezas de un objeto girado: va antes la que queda detrás. Si se pisan en planta,
// la de abajo; si no, la que queda más lejos de la cámara a lo largo de los ejes que las separan; en caso
// de duda, el orden del código. `cam`: hacia dónde está la cámara, en el objeto.
const E = 1e-6;
function behind(a, b, cam) {
  const ox = a.x0 < b.x1 - E && b.x0 < a.x1 - E, oy = a.y0 < b.y1 - E && b.y0 < a.y1 - E;
  if (ox && oy) return a.z1 <= b.z0 + E ? -1 : b.z1 <= a.z0 + E ? 1 : 0;
  const sx = a.x1 <= b.x0 + E ? -1 : b.x1 <= a.x0 + E ? 1 : 0, sy = a.y1 <= b.y0 + E ? -1 : b.y1 <= a.y0 + E ? 1 : 0;
  const k = sx * cam[0] + sy * cam[1];
  return Math.abs(k) < 1e-6 ? 0 : Math.sign(k);
}
function depthOrder(ops, cam) {
  const n = ops.length, after = ops.map(() => []), need = new Int32Array(n);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const c = behind(ops[i].b, ops[j].b, cam);
    if (c < 0) { after[i].push(j); need[j]++; } else if (c > 0) { after[j].push(i); need[i]++; }
  }
  // Kahn: entre las que ya pueden ir, la primera del código
  const out = [], ready = [], done = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (!need[i]) ready.push(i);
  while (out.length < n) {
    if (!ready.length) { const k = done.findIndex(v => !v); need[k] = 0; ready.push(k); }   // un ciclo: se rompe
    ready.sort((a, b) => a - b);
    const i = ready.shift();
    if (done[i]) continue;
    done[i] = 1;
    out.push(ops[i]);
    for (const j of after[i]) if (--need[j] === 0) ready.push(j);
  }
  return out;
}
export const boxCol = hex => { const r = ramp(hex); return { top: r.l, left: r.b, right: r.d }; };
