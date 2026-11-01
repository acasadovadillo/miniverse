// Minimapa y mapa grande. Solo muestran los trozos ya explorados, dibujados en la misma
// perspectiva isométrica que el juego (cada casilla es un rombo de 2×1 píxeles por unidad de zoom),
// girados igual que la cámara.
import { CHUNK } from '../world/gen.js';
import { toView, fromView } from '../iso.js';
import { CENTER, HOUSE } from '../world/village.js';

const $ = id => document.getElementById(id);
const blinkSlow = t => Math.sin(t * 3) > 0;

export class MapView {
  constructor() {
    this.mini = $('minimap');
    this.big = $('bigmap');
    this.thumbs = new Map();
    this.zoom = 3;
    this.scale = 2;              // píxeles de pantalla por píxel del mapa grande
    this.pan = { x: 0, y: 0 };   // cuánto se ha movido el mapa grande desde el jugador, en casillas
    this.lastMini = 0;
    this.queue = [];
  }

  // Las miniaturas que faltan se preparan en los ratos libres del navegador
  thumb(gen, key) {
    const id = `${gen.seed}:${key}`, t = this.thumbs.get(id);
    if (!t && !this.queue.some(q => q.id === id)) { this.queue.push({ id, gen, key }); this.schedule(); }
    return t;
  }
  schedule() {
    if (this.waiting) return;
    this.waiting = true;
    const idle = window.requestIdleCallback || (cb => setTimeout(() => cb({ timeRemaining: () => 10 }), 20));
    idle(deadline => {
      this.waiting = false;
      do {
        const q = this.queue.shift();
        if (!q) break;
        const [cx, cy] = q.key.split(',').map(Number);
        this.thumbs.set(q.id, q.gen.thumbnail(cx, cy));
        if (this.thumbs.size > 3000) this.thumbs.delete(this.thumbs.keys().next().value);
      } while (deadline.timeRemaining() > 4);
      if (this.queue.length) this.schedule();
    }, { timeout: 300 });
  }

  // Mueve el mapa grande lo que se ha arrastrado o pulsado, en píxeles del mapa (como se ve en pantalla):
  // hacia la derecha en pantalla es (+x, −y) en la rejilla, y hacia abajo es (+x, +y)
  scroll(dx, dy) {
    const a = this.zoom, [gx, gy] = fromView((dx + 2 * dy) / (2 * a), (2 * dy - dx) / (2 * a));   // (con la cámara girada, en la vista)
    this.pan.x += gx;
    this.pan.y += gy;
  }
  // WASD o flechas con el mapa abierto (Shift, más rápido)
  update(keys, dt) {
    const v = (keys.run ? 450 : 180) * dt, dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0), dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    if (dx || dy) this.scroll(dx * v, dy * v);
  }
  recenter() { this.pan.x = this.pan.y = 0; }

  // Dibuja lo explorado centrado en (px, py) con un zoom a; el jugador está en me
  draw(canvas, gen, explored, px, py, a, time, me = [px, py]) {
    const g = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#1a1410';
    g.fillRect(0, 0, w, h);
    // Primero se juntan las miniaturas en una imagen plana (sin huecos entre trozos) y luego se gira
    // entera a la perspectiva isométrica de la cámara: rejilla (x, y) → vista (u, v) ↦ (a·(u − v) + e, a/2·(u + v) + f)
    const [pu, pv] = toView(px, py), e = w / 2 - a * (pu - pv), f = h / 2 - (a / 2) * (pu + pv);
    const toMap = (x, y) => { const [u, v] = toView(x, y); return [Math.round(a * (u - v) + e), Math.round((a / 2) * (u + v) + f)]; };
    const reach = Math.ceil((w + h * 2) / a / CHUNK / 2) + 1;   // trozos que pueden caber en pantalla
    const pcx = Math.floor(px / CHUNK), pcy = Math.floor(py / CHUNK), side = (reach * 2 + 1) * CHUNK;
    if (!this.flat || this.flat.width !== side) { this.flat = document.createElement('canvas'); this.flat.width = this.flat.height = side; }
    const fg = this.flat.getContext('2d');
    fg.clearRect(0, 0, side, side);
    for (const key of explored) {
      const [cx, cy] = key.split(',').map(Number);
      if (Math.abs(cx - pcx) > reach || Math.abs(cy - pcy) > reach) continue;
      const t = this.thumb(gen, key);
      if (t) fg.drawImage(t, (cx - pcx + reach) * CHUNK, (cy - pcy + reach) * CHUNK);
    }
    // Cada eje de la imagen plana (x e y del mundo) va adonde lo lleve la cámara
    const ox = (pcx - reach) * CHUNK, oy = (pcy - reach) * CHUNK, [xu, xv] = toView(1, 0), [yu, yv] = toView(0, 1), [u0, v0] = toView(ox, oy);
    g.setTransform(a * (xu - xv), (a / 2) * (xu + xv), a * (yu - yv), (a / 2) * (yu + yv), a * (u0 - v0) + e, (a / 2) * (u0 + v0) + f);
    g.drawImage(this.flat, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    // Casa del pueblo y jugador
    const [hx, hy] = toMap((HOUSE.x0 + HOUSE.x1) / 2, (HOUSE.y0 + HOUSE.y1) / 2);
    g.fillStyle = '#2a1c22'; g.fillRect(hx - 3, hy - 3, 7, 6);
    g.fillStyle = '#c95a3c'; g.fillRect(hx - 2, hy - 3, 5, 2);
    g.fillStyle = '#f2e2c0'; g.fillRect(hx - 2, hy - 1, 5, 3);
    // Lugares descubiertos (y el faro, si llevas la brújula: en el borde si queda lejos)
    const COL = { cueva: '#4a4a54', ruinas: '#a8a298', campamento: '#e88a3a', torre: '#d8d0c0', barco: '#7a5030', templo: '#e8c070', aldea: '#4a6aa8', faro: '#ff4a4a' };
    for (const m of this.markers || []) {
      let [x, y] = toMap(m.x, m.y);
      if (m.kind === 'faro') { x = Math.max(6, Math.min(w - 6, x)); y = Math.max(6, Math.min(h - 6, y)); }
      g.fillStyle = '#2a1c22'; g.fillRect(x - 3, y - 3, 7, 7);
      g.fillStyle = COL[m.kind] || '#ffffff'; g.fillRect(x - 2, y - 2, 5, 5);
      if (m.kind === 'faro' && blinkSlow(time)) { g.fillStyle = '#ffffff'; g.fillRect(x - 1, y - 1, 3, 3); }
    }
    const [mx, my] = toMap(...me), blink = Math.sin(time * 6) > 0;
    g.fillStyle = '#2a1c22'; g.fillRect(mx - 3, my - 3, 7, 7);
    g.fillStyle = blink ? '#ffd77a' : '#ff6a4a'; g.fillRect(mx - 2, my - 2, 5, 5);
  }

  drawMini(gen, explored, px, py, time) {
    if (time - this.lastMini < 0.15) return;   // no hace falta redibujarlo en cada fotograma
    this.lastMini = time;
    this.draw(this.mini, gen, explored, px, py, 1.5, time);
  }

  drawBig(gen, explored, px, py, time) {
    const c = this.big, scale = this.scale;
    const w = Math.ceil(innerWidth / scale), h = Math.ceil(innerHeight / scale);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; c.style.width = w * scale + 'px'; c.style.height = h * scale + 'px'; }
    // Que no se pueda ir más allá de lo explorado (y perderse en lo negro)
    const b = this.bounds(explored);
    this.pan.x = Math.max(b.x0 - px, Math.min(b.x1 - px, this.pan.x));
    this.pan.y = Math.max(b.y0 - py, Math.min(b.y1 - py, this.pan.y));
    const cx = px + this.pan.x, cy = py + this.pan.y, moved = Math.hypot(this.pan.x, this.pan.y) > 2;
    this.draw(c, gen, explored, cx, cy, this.zoom, time, [px, py]);
    $('map-info').textContent = `Posición ${Math.round(px - CENTER.x)}, ${Math.round(py - CENTER.y)}` +
      (moved ? ` · Mirando ${Math.round(cx - CENTER.x)}, ${Math.round(cy - CENTER.y)}` : ` · ${explored.size} zonas exploradas`);
    $('map-home').disabled = !moved;
  }
  // Rectángulo (en casillas) de lo explorado; se recalcula solo cuando se explora algo nuevo
  bounds(explored) {
    if (this.boundsFor !== explored.size) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const key of explored) { const [cx, cy] = key.split(',').map(Number); x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy); }
      this.boundsBox = explored.size ? { x0: x0 * CHUNK, y0: y0 * CHUNK, x1: (x1 + 1) * CHUNK, y1: (y1 + 1) * CHUNK } : { x0: 0, y0: 0, x1: 0, y1: 0 };
      this.boundsFor = explored.size;
    }
    return this.boundsBox;
  }
}
