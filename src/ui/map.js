// Minimapa y mapa grande. Solo muestran los trozos ya explorados. El minimapa, en la misma perspectiva isométrica que
// el juego y girado igual que la cámara (cada casilla es un rombo de 2×1 píxeles por unidad de zoom). El mapa grande,
// en plano y con el norte arriba, como los mapas de papel: cada casilla mide 2 píxeles por unidad de zoom, y encima
// van tu casa, las de los vecinos, los vecinos que estén fuera, los lugares descubiertos con su nombre y una leyenda
// con lo que ya se ha visto.
import { CHUNK } from '../world/gen.js';
import { BIOMES } from '../world/biomes.js';
import { toView } from '../iso.js';
import { CENTER, HOUSE, HOUSES, TAVERN, hasProject } from '../world/village.js';
import { nearX, wrapIndex } from '../world/planet.js';

const $ = id => document.getElementById(id);
const COL = { cueva: '#4a4a54', ruinas: '#a8a298', campamento: '#e88a3a', torre: '#d8d0c0', barco: '#7a5030', templo: '#e8c070', aldea: '#4a6aa8', faro: '#ff4a4a' };
const HOME = '#c95a3c', HOUSE_COL = '#c8a878', PERSON = '#7ad0ff', ME = '#ffd77a';
const ZOOM = [1, 8], BIOME_SAMPLES_PER_FRAME = 200;
const rgbCss = c => `rgb(${c[0]},${c[1]},${c[2]})`;

export class MapView {
  constructor() {
    this.mini = $('minimap');
    this.big = $('bigmap');
    this.thumbs = new Map();
    this.zoom = 3;
    this.pan = { x: 0, y: 0 };   // cuánto se ha movido el mapa grande desde el jugador, en casillas
    this.labels = [];            // los nombres que se han podido poner en el último dibujo
    this.people = [];            // los vecinos que están fuera: { x, y, name }
    this.seenBiomes = new Set(); // los biomas de lo explorado (para la leyenda)
    this.biomesFrom = new Set(); // los trozos ya mirados
    this.legendKey = '';
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

  // Píxeles de pantalla por casilla en el mapa grande
  get tile() { return this.zoom * 2; }
  // Mueve el mapa grande lo que se ha arrastrado o pulsado, en píxeles de pantalla
  scroll(dx, dy) {
    this.pan.x += dx / this.tile;
    this.pan.y += dy / this.tile;
  }
  // Acercar o alejar dejando quieto lo que hay en el punto (sx, sy) de la pantalla (si no se dice, el centro)
  zoomAt(d, sx = innerWidth / 2, sy = innerHeight / 2) {
    const before = this.tile, zoom = Math.max(ZOOM[0], Math.min(ZOOM[1], this.zoom + d));
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    const k = 1 / before - 1 / this.tile;
    this.pan.x += (sx - innerWidth / 2) * k;
    this.pan.y += (sy - innerHeight / 2) * k;
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
    const toMap = (x, y) => { const [u, v] = toView(nearX(x, px), y); return [Math.round(a * (u - v) + e), Math.round((a / 2) * (u + v) + f)]; };   // (por el camino corto alrededor del planeta)
    const reach = Math.ceil((w + h * 2) / a / CHUNK / 2) + 1;   // trozos que pueden caber en pantalla
    const pcx = Math.floor(px / CHUNK), pcy = Math.floor(py / CHUNK), side = (reach * 2 + 1) * CHUNK;
    if (!this.flat || this.flat.width !== side) { this.flat = document.createElement('canvas'); this.flat.width = this.flat.height = side; }
    const fg = this.flat.getContext('2d');
    fg.clearRect(0, 0, side, side);
    for (const key of explored) {
      const [cx, cy] = key.split(',').map(Number), dcx = wrapIndex(cx - pcx, CHUNK);
      if (Math.abs(dcx) > reach || Math.abs(cy - pcy) > reach) continue;
      const t = this.thumb(gen, key);
      if (t) fg.drawImage(t, (dcx + reach) * CHUNK, (cy - pcy + reach) * CHUNK);
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
    // Lugares descubiertos
    for (const m of this.markers || []) {
      const [x, y] = toMap(m.x, m.y);
      g.fillStyle = '#2a1c22'; g.fillRect(x - 3, y - 3, 7, 7);
      g.fillStyle = COL[m.kind] || '#ffffff'; g.fillRect(x - 2, y - 2, 5, 5);
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

  // Dónde cae en la pantalla un punto del mundo, con el mapa grande centrado en (cx, cy) y el norte arriba
  toScreen(x, y, cx, cy, w = innerWidth, h = innerHeight) { return [w / 2 + this.tile * (nearX(x, cx) - cx), h / 2 + this.tile * (y - cy)]; }

  drawBig(gen, explored, px, py, time) {
    const c = this.big, r = Math.max(1, Math.round(devicePixelRatio || 1)), w = innerWidth, h = innerHeight;
    if (c.width !== w * r || c.height !== h * r) { c.width = w * r; c.height = h * r; c.style.width = w + 'px'; c.style.height = h + 'px'; }
    // Que no se pueda ir más allá de lo explorado (y perderse en lo negro)
    const b = this.bounds(explored);
    this.pan.x = Math.max(b.x0 - px, Math.min(b.x1 - px, this.pan.x));
    this.pan.y = Math.max(b.y0 - py, Math.min(b.y1 - py, this.pan.y));
    const cx = px + this.pan.x, cy = py + this.pan.y, moved = Math.hypot(this.pan.x, this.pan.y) > 2;
    this.drawFlat(c.getContext('2d'), gen, explored, cx, cy, r, w, h, time, [px, py]);
    this.updateLegend(gen, explored);
    $('map-info').textContent = `Posición ${Math.round(px - CENTER.x)}, ${Math.round(py - CENTER.y)}` +
      (moved ? ` · Mirando ${Math.round(cx - CENTER.x)}, ${Math.round(cy - CENTER.y)}` : ` · ${explored.size} zonas exploradas`);
    $('map-home').disabled = !moved;
  }
  // Lo explorado en plano, con cada trozo en su sitio, y encima lo que tiene nombre
  drawFlat(g, gen, explored, cx, cy, r, w, h, time, me) {
    const a = this.tile, S = CHUNK * a, pcx = Math.floor(cx / CHUNK), rx = Math.ceil(w / S / 2) + 1, ry = Math.ceil(h / S / 2) + 1;
    g.setTransform(r, 0, 0, r, 0, 0);
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#1a1410';
    g.fillRect(0, 0, w, h);
    for (const key of explored) {
      const [kx, ky] = key.split(',').map(Number), dcx = wrapIndex(kx - pcx, CHUNK);
      if (Math.abs(dcx) > rx + 1 || Math.abs(ky - Math.floor(cy / CHUNK)) > ry + 1) continue;
      const t = this.thumb(gen, key);
      if (!t) continue;
      const [sx, sy] = this.toScreen(kx * CHUNK, ky * CHUNK, cx, cy, w, h);
      g.drawImage(t, Math.round(sx), Math.round(sy), S, S);
    }
    // Lo que tiene nombre, por orden de importancia: tú, tu casa, los lugares, las casas y los vecinos. El nombre va al
    // lado del punto, donde quepa; si no cabe sin pisar otro, ese no sale (al acercarse, sí)
    const spots = [{ x: me[0], y: me[1], name: 'Tú', col: Math.sin(time * 6) > 0 ? ME : '#ff6a4a', size: 7 }, { x: (HOUSE.x0 + HOUSE.x1) / 2, y: (HOUSE.y0 + HOUSE.y1) / 2, name: 'Tu casa', col: HOME, size: 8 }];
    for (const m of this.markers || []) spots.push({ x: m.x, y: m.y, name: m.name, col: COL[m.kind] || '#ffffff', size: 7 });
    for (const q of Object.values(HOUSES)) if (!q.project || hasProject(q.project)) spots.push({ x: (q.x0 + q.x1) / 2, y: (q.y0 + q.y1) / 2, name: `Casa de ${q.name}`, col: HOUSE_COL, size: 7 });
    spots.push({ x: (TAVERN.x0 + TAVERN.x1) / 2, y: (TAVERN.y0 + TAVERN.y1) / 2, name: 'Taberna', col: HOUSE_COL, size: 7 });
    for (const q of this.people) spots.push({ x: q.x, y: q.y, name: q.name, col: PERSON, size: 5 });
    const taken = [], labels = [], clear = b => !taken.some(o => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
    g.font = '13px "Pixelify Sans", system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    // (primero los puntos, de abajo arriba, para que los importantes queden encima)
    const shown = spots.map(q => { const [sx, sy] = this.toScreen(q.x, q.y, cx, cy, w, h); return { ...q, sx: Math.round(sx), sy: Math.round(sy) }; }).filter(q => q.sx > -60 && q.sx < w + 60 && q.sy > -20 && q.sy < h + 20);
    for (const q of [...shown].reverse()) {
      const n = q.size, m = n >> 1;
      g.fillStyle = '#2a1c22'; g.fillRect(q.sx - m - 1, q.sy - m - 1, n + 2, n + 2);
      g.fillStyle = q.col; g.fillRect(q.sx - m, q.sy - m, n, n);
    }
    for (const q of shown) taken.push([q.sx - 5, q.sy - 5, q.sx + 5, q.sy + 5]);
    for (const q of shown) {
      if (!q.name || (q.col === PERSON && this.zoom < 3)) continue;
      const tw = g.measureText(q.name).width, off = (q.size >> 1) + 4;
      const at = [[q.sx + off, q.sy], [q.sx - off - tw, q.sy], [q.sx - tw / 2, q.sy - off - 7], [q.sx - tw / 2, q.sy + off + 7]].find(([tx, ty]) => clear([tx - 1, ty - 8, tx + tw + 1, ty + 8]) && tx > 0 && tx + tw < w && ty > 8 && ty < h - 8);
      if (!at) continue;
      taken.push([at[0] - 1, at[1] - 8, at[0] + tw + 1, at[1] + 8]);
      g.strokeStyle = 'rgba(26,18,14,.9)'; g.lineWidth = 3; g.strokeText(q.name, at[0], at[1]);
      g.fillStyle = '#fff8e8'; g.fillText(q.name, at[0], at[1]);
      labels.push(q.name);
    }
    this.labels = labels;
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
  // La leyenda: lo que ya se ha visto (los biomas de lo explorado, unos pocos trozos cada vez) y lo que se ha descubierto
  updateLegend(gen, explored) {
    if (this.legendGen !== gen) { this.legendGen = gen; this.seenBiomes.clear(); this.biomesFrom.clear(); }
    if (this.biomesFrom.size < explored.size) {
      let n = 0;
      for (const key of explored) {
        if (this.biomesFrom.has(key)) continue;
        this.biomesFrom.add(key);
        const [kx, ky] = key.split(',').map(Number);
        for (const [i, j] of [[4, 4], [12, 4], [8, 8], [4, 12], [12, 12]]) this.seenBiomes.add(gen.biomeAt(kx * CHUNK + i + 0.5, ky * CHUNK + j + 0.5));
        if (++n >= BIOME_SAMPLES_PER_FRAME) break;
      }
    }
    const kinds = [...new Map((this.markers || []).map(m => [m.kind, m.name])).entries()], key = `${[...this.seenBiomes].sort().join()}|${kinds.map(k => k[0]).sort().join()}`;
    if (key === this.legendKey) return;
    this.legendKey = key;
    const rows = [[ME, 'Tú'], [HOME, 'Tu casa'], [HOUSE_COL, 'Casas y taberna'], [PERSON, 'Vecinos'], ...kinds.map(([k, name]) => [COL[k] || '#ffffff', name]).sort((a, b) => a[1].localeCompare(b[1])), ...[...this.seenBiomes].sort((a, b) => a - b).map(b => [rgbCss(BIOMES[b].rgb[1]), BIOMES[b].name])];
    const box = $('map-legend-rows');
    box.textContent = '';
    for (const [col, name] of rows) {
      const row = document.createElement('div'), dot = document.createElement('i');
      dot.style.background = col;
      row.append(dot, name);
      box.append(row);
    }
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
