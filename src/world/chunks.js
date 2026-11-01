// El mundo exterior se divide en trozos de 16×16 casillas.
// Cada trozo pinta su suelo una sola vez en un lienzo y se descarta cuando queda lejos.
import { mk, ellipse, poly, ihash, clamp } from '../util.js';
import { toView, toScreen, toGrid, VIEW, STEPS, setViewRot } from '../iso.js';
import { CHUNK, RES } from './gen.js';

const CW = CHUNK * 32, CH = CHUNK * 16;   // tamaño del lienzo de un trozo
const MAX_CHUNKS = 70;

// Máscara con la forma de rombo de un trozo (igual para todos)
const MASK = (() => {
  const c = mk(CW, CH), g = c.getContext('2d'), img = g.createImageData(CW, CH);
  for (let py = 0; py < CH; py++) {
    for (let px = 0; px < CW; px++) {
      const [gx, gy] = toGrid0(px - CHUNK * 16 + 0.5, py + 0.5);
      if (gx >= 0 && gy >= 0 && gx < CHUNK && gy < CHUNK) img.data[(py * CW + px) * 4 + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
})();
// Máscara en bytes (1 = dentro del rombo)
const INSIDE = (() => {
  const m = MASK.getContext('2d').getImageData(0, 0, CW, CH).data, out = new Uint8Array(CW * CH);
  for (let i = 0; i < out.length; i++) out[i] = m[i * 4 + 3] ? 1 : 0;
  return out;
})();

// "Lienzo" en memoria: entiende fillStyle, fillRect y translate (lo que usan las funciones de dibujo),
// pero escribe directamente en los datos de píxeles y solo dentro del rombo del trozo.
const colorCache = new Map();
function parseColor(v) {
  let c = colorCache.get(v);
  if (c) return c;
  if (v[0] === '#') { const n = parseInt(v.slice(1), 16); c = [n >> 16, (n >> 8) & 255, n & 255, 1]; }
  else { const p = v.match(/[\d.]+/g).map(Number); c = [p[0], p[1], p[2], p[3] ?? 1]; }
  colorCache.set(v, c);
  return c;
}
class Surface {
  // (w, h, inside: el tamaño del lienzo y su máscara; por defecto, los del rombo de siempre)
  constructor(data, w = CW, h = CH, inside = INSIDE) { this.d = data; this.w = w; this.h = h; this.inside = inside; this.tx = 0; this.ty = 0; this.c = [0, 0, 0, 1]; }
  set fillStyle(v) { this.c = parseColor(v); }
  translate(x, y) { this.tx += x; this.ty += y; }
  fillRect(x, y, w, h) {
    x = Math.round(x + this.tx); y = Math.round(y + this.ty);
    const W = this.w, x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(W, x + w), y1 = Math.min(this.h, y + h);
    const [r, g, b, a] = this.c, d = this.d, inside = this.inside;
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0, p = yy * W + x0; xx < x1; xx++, p++) {
        if (!inside[p]) continue;
        const o = p * 4;
        if (a >= 1) { d[o] = r; d[o + 1] = g; d[o + 2] = b; }
        else { d[o] += (r - d[o]) * a; d[o + 1] += (g - d[o + 1]) * a; d[o + 2] += (b - d[o + 2]) * a; }
      }
    }
  }
}

// Píxeles que caen dentro del rombo (es igual en todos los trozos): dónde están en el lienzo, dónde caen
// en la vista (en casillas, dentro del trozo), el desplazamiento al azar para tramar los bordes entre
// biomas y un valor al azar para la textura. Se calcula una vez; para cada giro de la cámara solo se gira.
const BASE = (() => {
  const index = [], PX = [], PY = [], U = [], V = [], DU = [], DV = [], H = [];
  for (let py = 0; py < CH; py++) {
    for (let px = 0; px < CW; px++) {
      if (!INSIDE[py * CW + px]) continue;
      const [u, v] = toGrid0(px - CHUNK * 16 + 0.5, py + 0.5);
      index.push(py * CW + px); PX.push(px); PY.push(py); U.push(u); V.push(v);
      DU.push((ihash(px, py, 77) - 0.5) * 0.9 / RES); DV.push((ihash(px, py, 78) - 0.5) * 0.9 / RES); H.push(ihash(px, py, 99));
    }
  }
  return { index: Int32Array.from(index), PX: Int32Array.from(PX), PY: Int32Array.from(PY), U: Float32Array.from(U), V: Float32Array.from(V), DU: Float32Array.from(DU), DV: Float32Array.from(DV), H: Float32Array.from(H) };
})();
function toGrid0(sx, sy) { return [(sx / 16 + sy / 8) / 2, (sy / 8 - sx / 16) / 2]; }
// Un cuarto de vuelta como el de la cámara (iso.js), (x, y) → (y, -x), como matriz [xx, xy, yx, yy] para n vueltas
const TURN = [[1, 0, 0, 1], [0, 1, -1, 0], [-1, 0, 0, -1], [0, -1, 1, 0]];

// Para un giro de la cámara: la posición de cada píxel en el trozo, en el mundo (no en la vista), y la
// muestra de bioma que le toca. Con la cámara girada el rombo es el mismo, pero cada píxel cae en otro sitio.
const PIXELS = [];
function pixelsFor(r) {
  if (PIXELS[r]) return PIXELS[r];
  const { index, PX, PY, U, V, DU, DV, H } = BASE, len = index.length, n = CHUNK * RES + 1;
  const [a, b, c, d] = TURN[(4 - r) % 4], back = (x, y) => [a * x + b * y, c * x + d * y];
  // La esquina del trozo que queda arriba en la vista
  const [ta, tb, tc, td] = TURN[r], view = [[0, 0], [CHUNK, 0], [0, CHUNK], [CHUNK, CHUNK]].map(([x, y]) => [ta * x + tb * y, tc * x + td * y]);
  const [cx0, cy0] = back(Math.min(...view.map(v => v[0])), Math.min(...view.map(v => v[1])));
  const LX = new Float32Array(len), LY = new Float32Array(len), SAMPLE = new Int32Array(len);
  for (let q = 0; q < len; q++) {
    const u = U[q], v = V[q], ju = u + DU[q], jv = v + DV[q];
    LX[q] = cx0 + a * u + b * v; LY[q] = cy0 + c * u + d * v;
    const i = clamp(Math.round((cx0 + a * ju + b * jv) * RES), 0, n - 1), j = clamp(Math.round((cy0 + c * ju + d * jv) * RES), 0, n - 1);
    SAMPLE[q] = j * n + i;
  }
  return (PIXELS[r] = { index, LX, LY, PX, PY, H, SAMPLE });
}

export class ChunkManager {
  // content(cx, cy): objetos, colisiones y sombras del trozo, ya con los cambios del jugador
  constructor(gen, village, content) {
    this.gen = gen;
    this.village = village;
    this.content = content;
    this.views = Array.from({ length: STEPS }, () => new Map());   // lienzos ya pintados, para cada giro de la cámara
    this.stale = new Set();   // trozos que hay que repintar (p. ej., al talar un árbol desaparece su sombra)
  }

  // Esquina superior izquierda del lienzo del trozo, en píxeles del mundo (según hacia dónde mira la cámara)
  origin(cx, cy) {
    const view = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy]) => toView((cx + dx) * CHUNK, (cy + dy) * CHUNK));
    const vx = Math.min(...view.map(v => v[0])) / CHUNK, vy = Math.min(...view.map(v => v[1])) / CHUNK;
    return [(vx - vy - 1) * CHUNK * 16, (vx + vy) * CHUNK * 8];
  }
  // Los del cuarto de vuelta desde el que se pinta ahora (los de los otros se guardan, para que volver a
  // girar sea al momento)
  get chunks() { return this.views[this.base()]; }
  // De la pantalla de ese cuarto de vuelta a la de la cámara: [a, b, c, d] como en setTransform (null si es el mismo)
  warp() {
    const q = this.base();
    if (q === VIEW.r) return null;
    // pantalla → rejilla de la vista q → giro de q a la cámara → pantalla
    const a = (-(VIEW.r - q) * 2 * Math.PI) / STEPS, c = Math.cos(a), s = Math.sin(a);
    const F = (u, v) => [(u - v) * 16, (u + v) * 8], Fi = (x, y) => [(x / 16 + y / 8) / 2, (y / 8 - x / 16) / 2], R = ([u, v]) => [u * c - v * s, u * s + v * c];
    const ex = F(...R(Fi(1, 0))), ey = F(...R(Fi(0, 1)));
    return [ex[0], ex[1], ey[0], ey[1]];
  }
  // La cámara ha girado: se dejan de repintar los de antes y las otras vistas guardan pocos lienzos
  clear() {
    this.stale.clear(); this.pending = [];
    this.views.forEach((m, r) => { if (r === this.base()) return; const old = [...m.values()].sort((a, b) => a.used - b.used); for (const ch of old.slice(0, Math.max(0, m.size - 20))) m.delete(`${ch.cx},${ch.cy}`); });
  }

  // El suelo se pinta siempre desde un cuarto de vuelta (el más cercano al giro de la cámara): con la cámara
  // entre dos, ese mismo lienzo se dibuja deformado (el suelo es un plano), sin repintar nada
  base() { const k = STEPS / 4; return (Math.round(VIEW.r / k) * k) % STEPS; }

  build(cx, cy) {
    // (lo de los trozos se prepara antes de cambiar de vista: sus objetos se dibujan desde la cámara)
    const gen = this.gen, r = VIEW.r, q = this.base(), shadows = [...this.village.shadows];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) shadows.push(...this.content(cx + dx, cy + dy).shadows);
    if (q !== r) setViewRot(q);
    const [ox, oy] = this.origin(cx, cy);
    const c = mk(CW, CH), g = c.getContext('2d');
    const img = g.createImageData(CW, CH), field = gen.field(cx, cy);
    gen.paint(img.data, cx, cy, ox, oy, field, pixelsFor(q / (STEPS / 4)));

    // Sombras (de este trozo y de los vecinos que caen dentro; están en el mundo), detalles del pueblo y decoración
    const surf = new Surface(img.data);
    surf.translate(-ox, -oy);
    for (const s of shadows) {
      const [sx, sy] = toScreen(s.x, s.y);
      if (sx > ox - 40 && sx < ox + CW + 40 && sy > oy - 20 && sy < oy + CH + 20) ellipse(surf, sx, sy, s.rx, s.ry, 'rgba(28,52,20,.32)');
    }
    if (gen.nearVillage(cx, cy)) for (const draw of this.village.decals) draw(surf);
    surf.translate(ox, oy);
    gen.decorate(surf, ox, oy, cx, cy, field);
    g.putImageData(img, 0, 0);
    if (q !== r) setViewRot(r);

    const old = this.get(cx, cy);
    const chunk = { cx, cy, ox, oy, canvas: c, used: old ? old.used : 0 };
    this.chunks.set(`${cx},${cy}`, chunk);
    this.stale.delete(`${cx},${cy}`);
    return chunk;
  }

  // Repinta un trozo en un rato libre (mientras tanto se sigue viendo el lienzo anterior)
  refresh(cx, cy) {
    this.views.forEach((m, r) => { if (r !== this.base()) m.delete(`${cx},${cy}`); });   // en las otras vistas, se pintará de nuevo al volver
    if (!this.get(cx, cy)) return;
    this.stale.add(`${cx},${cy}`);
    this.scheduleIdle();
  }

  get(cx, cy) { return this.chunks.get(`${cx},${cy}`); }

  // Trozos que tocan el rectángulo visible (en píxeles del mundo); se amplía abajo por los árboles altos
  range(x, y, w, h) {
    const pts = [toGrid(x, y), toGrid(x + w, y), toGrid(x, y + h + 110), toGrid(x + w, y + h + 110)];
    const gx = pts.map(p => p[0]), gy = pts.map(p => p[1]);
    return {
      cx0: Math.floor(Math.min(...gx) / CHUNK), cx1: Math.floor(Math.max(...gx) / CHUNK),
      cy0: Math.floor(Math.min(...gy) / CHUNK), cy1: Math.floor(Math.max(...gy) / CHUNK),
    };
  }

  // Prepara los trozos visibles. Los que faltan dentro de la vista se crean ya (o, con `budget`, los que
  // quepan en esos milisegundos: al girar la cámara se pintan poco a poco y `missing` dice cuántos faltan);
  // los del margen se dejan en cola y se crean en los ratos libres del navegador, sin dar tirones.
  update(x, y, w, h, frame, budget = Infinity) {
    const r = this.range(x, y, w, h), start = performance.now();
    const visible = [];
    this.pending = [];
    this.missing = 0;
    for (let cy = r.cy0 - 1; cy <= r.cy1 + 1; cy++) {
      for (let cx = r.cx0 - 1; cx <= r.cx1 + 1; cx++) {
        const inView = cx >= r.cx0 && cx <= r.cx1 && cy >= r.cy0 && cy <= r.cy1;
        let ch = this.get(cx, cy);
        if (!ch && inView && performance.now() - start < budget) ch = this.build(cx, cy);
        if (!ch) { if (inView) this.missing++; this.pending.push([cx, cy]); continue; }
        ch.used = frame;
        if (inView) visible.push(ch);
      }
    }
    this.scheduleIdle();
    if (this.chunks.size > MAX_CHUNKS) {
      const old = [...this.chunks.values()].sort((a, b) => a.used - b.used);
      for (const ch of old.slice(0, this.chunks.size - MAX_CHUNKS)) this.chunks.delete(`${ch.cx},${ch.cy}`);
    }
    return visible;
  }

  scheduleIdle() {
    if (this.waiting || (!this.pending?.length && !this.stale.size)) return;
    this.waiting = true;
    const idle = window.requestIdleCallback || (cb => setTimeout(() => cb({ timeRemaining: () => 10, didTimeout: false }), 20));
    idle(deadline => {
      this.waiting = false;
      // Al menos uno por vuelta, y más mientras quede tiempo libre
      do {
        const stale = this.stale.values().next().value;
        if (stale) { this.build(...stale.split(',').map(Number)); continue; }
        const next = this.pending.shift();
        if (!next) break;
        if (!this.get(...next)) this.build(...next);
      } while (deadline.timeRemaining() > 12);
      this.scheduleIdle();
    }, { timeout: 250 });
  }

  // Colisiones cerca de una posición (trozo actual y vecinos)
  collidersNear(x, y) {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK), out = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const c of this.content(cx + dx, cy + dy).colliders) out.push(c);
    return out;
  }
}
