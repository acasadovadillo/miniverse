// Minimapa y mapa grande. Solo muestran los trozos ya explorados. El minimapa, en la misma perspectiva isométrica que
// el juego y girado igual que la cámara (cada casilla es un rombo de 2×1 píxeles por unidad de zoom). El mapa grande,
// en plano y con el norte arriba, como los mapas de papel: cada casilla mide 2 píxeles por unidad de zoom, y encima
// van tu casa, las de los vecinos, los vecinos que estén fuera, los lugares descubiertos con su nombre y una leyenda
// con lo que ya se ha visto.
// The marked route (Plan J §2.7, §4.2; route.js sets map.route): its line and pin on both maps, the pins other players
// shared, toWorld for map clicks (menus.js) and spotAt to snap a click to a named spot.
import { CHUNK } from '../world/gen.js';
import { BIOMES, B } from '../world/biomes.js';
import { toView } from '../iso.js';
import { CENTER, HOUSE, HOUSES, TAVERN, DOOR, doorOf, hasProject } from '../world/village.js';
import { nearX, wrapIndex, wrapX } from '../world/planet.js';
import { KIND } from '../world/routegrid.js';
import { t, getLang } from '../i18n.js';

const $ = id => document.getElementById(id);
const COL = { cueva: '#4a4a54', ruinas: '#a8a298', campamento: '#e88a3a', torre: '#d8d0c0', barco: '#7a5030', templo: '#e8c070', aldea: '#4a6aa8', faro: '#ff4a4a' };
const HOME = '#c95a3c', HOUSE_COL = '#c8a878', PERSON = '#7ad0ff', ME = '#ffd77a';
const ZOOM = [1, 8], BIOME_SAMPLES_PER_FRAME = 200;
const rgbCss = c => `rgb(${c[0]},${c[1]},${c[2]})`;
// The route: the HUD cream with a dark outline; the pins shared by others, blue (not the neighbours' light blue)
const ROUTE = '#f2e2b0', OUTLINE = '#2a1c22', SHARED = '#5a8cff';
const TAVERN_DOOR = { x: TAVERN.x0 + 5.5, y: TAVERN.y1 + 1 };   // (as the first steps' mark: the middle of its front)
// How a stretch of the route is drawn, by the kind of its points (routegrid.js KIND): solid on land and roads, dotted
// through water, dashed where the land is unexplored (a straight line that reveals nothing)
const DOTS = [2, 3], DASH = [7, 5];
const styleOf = (a, b) => (a === KIND.unknown || b === KIND.unknown ? 2 : a === KIND.wade || a === KIND.swim || b === KIND.wade || b === KIND.swim ? 1 : 0);
// The route from point i0 on, through proj(x, y, out) (world → canvas pixels), in runs of one style, outline first
function routeLine(g, pts, kinds, i0, proj, width) {
  const n = pts.length >> 1, a = [0, 0];
  if (n - i0 < 2) return;
  g.lineJoin = 'round'; g.lineCap = 'round';
  let i = Math.max(0, i0);
  while (i < n - 1) {
    const st = styleOf(kinds[i], kinds[i + 1]);
    let j = i + 1;
    while (j < n - 1 && styleOf(kinds[j], kinds[j + 1]) === st) j++;
    const dash = st === 2 ? DASH : st === 1 ? DOTS : [];
    for (const [col, w] of [[OUTLINE, width + 2], [ROUTE, width]]) {
      g.beginPath();
      for (let k = i; k <= j; k++) { proj(pts[k * 2], pts[k * 2 + 1], a); if (k === i) g.moveTo(a[0], a[1]); else g.lineTo(a[0], a[1]); }
      g.setLineDash(dash.map(d => d * width / 3)); g.lineWidth = w; g.strokeStyle = col; g.stroke();
    }
    i = j;
  }
  g.setLineDash([]); g.lineCap = 'butt';
}
// A map pin: a teardrop whose tip is on (x, y); r: its head's radius
function pin(g, x, y, r, col) {
  const cy = y - r * 1.9;
  g.beginPath(); g.moveTo(x, y); g.arc(x, cy, r, Math.PI * 0.78, Math.PI * 0.22); g.closePath();
  g.lineJoin = 'round'; g.lineWidth = 2; g.strokeStyle = OUTLINE; g.stroke();
  g.fillStyle = col; g.fill();
  g.beginPath(); g.arc(x, cy, r * 0.38, 0, Math.PI * 2); g.fillStyle = OUTLINE; g.fill();
}
// The player's marker: an arrow at (x, y) pointing along (dx, dy) on the screen, with a dark outline, like the map
// marker of Minecraft. L: from its middle to the tip, in pixels
function arrow(g, x, y, dx, dy, L, col) {
  const n = Math.hypot(dx, dy) || 1, ux = dx / n, uy = dy / n, vx = -uy, vy = ux, W = L * 0.78;
  const pts = [[L, 0], [-L * 0.8, W], [-L * 0.35, 0], [-L * 0.8, -W]].map(([a, b]) => [x + ux * a + vx * b, y + uy * a + vy * b]);
  g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py))); g.closePath();
  g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = '#2a1c22'; g.stroke();
  g.fillStyle = col; g.fill();
}
// (lo cavado que se ha llenado de agua, del color de las aguas poco profundas: ver floodOver)
const POOL = () => rgbCss(BIOMES[B.SHALLOW].rgb[1]);

export class MapView {
  constructor() {
    this.mini = $('minimap');
    this.big = $('bigmap');
    this.thumbs = new Map();
    this.zoom = 3;
    this.pan = { x: 0, y: 0 };   // cuánto se ha movido el mapa grande desde el jugador, en casillas
    this.labels = [];            // los nombres que se han podido poner en el último dibujo
    this.people = [];            // los vecinos que están fuera: { x, y, name }
    this.face = null;            // where the player faces ({ x, y }, from game.js): their arrow points there
    this.seenBiomes = new Set(); // los biomas de lo explorado (para la leyenda)
    this.biomesFrom = new Set(); // los trozos ya mirados
    this.legendKey = '';
    this.lastMini = 0;
    this.queue = [];
    this.route = null;           // the marked route (route.js puts itself here)
    this.center = null;          // where the big map was centred in its last drawing ([x, y], for toWorld)
    this.hits = [];              // the named spots and pins of the last big map, with their place on the screen (sx, sy)
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
      const [cx, cy] = String(key).split(',').map(Number), dcx = wrapIndex(cx - pcx, CHUNK);
      if (!Number.isFinite(dcx) || !Number.isFinite(cy)) continue;
      if (Math.abs(dcx) > reach || Math.abs(cy - pcy) > reach) continue;
      const t = this.thumb(gen, key);
      if (t) fg.drawImage(t, (dcx + reach) * CHUNK, (cy - pcy + reach) * CHUNK);
    }
    this.floodOver(fg, explored, (pcx - reach) * CHUNK, (pcy - reach) * CHUNK, side, side, 1);
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
    // (the marked route and its pin, held on the edge like the goal; the pins others shared, only while on the map)
    const R = this.route;
    if (R?.shown) {
      const proj = (x, y, o) => { const [u, v] = toView(nearX(x, px), y); o[0] = a * (u - v) + e; o[1] = (a / 2) * (u + v) + f; };
      routeLine(g, R.pts, R.kinds, R.seg, proj, 2);
      const [x, y] = toMap(R.target.x, R.target.y);
      pin(g, Math.max(6, Math.min(w - 6, x)), Math.max(12, Math.min(h - 2, y)), 4, ROUTE);
    }
    if (R?.pins.size && R.outside) for (const q of R.pins.values()) {
      const [x, y] = toMap(q.x, q.y);
      if (x > 0 && x < w && y > 0 && y < h) pin(g, x, y, 3.5, SHARED);
    }
    // (where a first step sends you, set by the smart HUD prototype: a gold diamond, held on the edge while it is farther)
    if (this.goal) {
      const [x, y] = toMap(this.goal.x, this.goal.y), gx = Math.max(6, Math.min(w - 6, x)), gy = Math.max(6, Math.min(h - 6, y));
      g.beginPath(); g.moveTo(gx, gy - 6); g.lineTo(gx + 5, gy); g.lineTo(gx, gy + 6); g.lineTo(gx - 5, gy); g.closePath();
      g.fillStyle = '#ffd77a'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#2a1c22'; g.stroke();
    }
    // (the player: an arrow where they face, turned like everything else on the minimap)
    const [mx, my] = toMap(...me), blink = Math.sin(time * 6) > 0, fc = this.face, [fx, fy] = fc ? toMap(me[0] + fc.x * 4, me[1] + fc.y * 4) : [mx, my - 1];
    arrow(g, mx, my, fx - mx, fy - my, 6, blink ? '#ffd77a' : '#ff6a4a');
  }

  // Lo cavado que se ha llenado de agua (las miniaturas son del mundo y no lo tienen): una casilla de agua encima, de las de
  // un rectángulo de casillas [x0, x0 + w) × [y0, y0 + h) que se dibuja desde (ox, oy) con s píxeles por casilla. Son pocas
  // (las que se han cavado) y el mundo ya las tiene a mano (scenes.js, floodList). Solo en lo explorado (las claves de
  // explored, como en game.js): los canales que otro haya cavado lejos no salen en lo negro
  floodOver(g, explored, x0, y0, w, h, s, ox = 0, oy = 0) {
    const list = this.world?.floodList?.(x0, y0, x0 + w, y0 + h);
    if (!list?.length) return;
    g.fillStyle = POOL();
    for (const [x, y] of list) if (explored.has(`${wrapIndex(Math.floor(x / CHUNK), CHUNK)},${Math.floor(y / CHUNK)}`)) g.fillRect(Math.round(ox + (x - x0) * s), Math.round(oy + (y - y0) * s), Math.ceil(s), Math.ceil(s));
  }

  // While the minimap is hidden (minimal HUD, indoors), once a second: ask for the thumbnails it would draw (made in idle
  // time, schedule), so it is not black for seconds when it shows again (Tab, a swap to the full HUD, out of a house)
  warmMini(gen, explored, px, py, time) {
    if (Math.abs(time - (this.warmAt ?? -9)) < 1) return;
    this.warmAt = time;
    const c = this.mini, pcx = Math.floor(px / CHUNK), pcy = Math.floor(py / CHUNK), reach = c ? Math.ceil((c.width + c.height * 2) / 1.5 / CHUNK / 2) + 1 : 3;   // (as draw, at drawMini's scale)
    for (const key of explored) {
      const [cx, cy] = String(key).split(',').map(Number), dcx = wrapIndex(cx - pcx, CHUNK);
      if (Number.isFinite(dcx) && Number.isFinite(cy) && Math.abs(dcx) <= reach && Math.abs(cy - pcy) <= reach) this.thumb(gen, key);
    }
  }
  drawMini(gen, explored, px, py, time) {
    if (time - this.lastMini < 0.15) return;   // no hace falta redibujarlo en cada fotograma
    this.lastMini = time;
    this.draw(this.mini, gen, explored, px, py, 1.5, time);
  }

  // Dónde cae en la pantalla un punto del mundo, con el mapa grande centrado en (cx, cy) y el norte arriba
  toScreen(x, y, cx, cy, w = innerWidth, h = innerHeight) { return [w / 2 + this.tile * (nearX(x, cx) - cx), h / 2 + this.tile * (y - cy)]; }
  // The other way: the world point (tiles, x inside the planet) under the screen pixel (sx, sy) of the big map as it was
  // last drawn (null before the first drawing)
  toWorld(sx, sy, w = innerWidth, h = innerHeight) {
    if (!this.center) return null;
    return [wrapX(this.center[0] + (sx - w / 2) / this.tile), this.center[1] + (sy - h / 2) / this.tile];
  }
  // The named spot or pin nearest to the screen pixel (sx, sy) within r pixels in the last big map (not you), or null
  spotAt(sx, sy, r) {
    let best = null, bd = r;
    for (const q of this.hits) {
      if (q.dir) continue;
      const d = Math.hypot(q.sx - sx, (q.pin ? q.sy - 8 : q.sy) - sy);   // (a pin is aimed at by its head, above its tip)
      if (d <= bd) { bd = d; best = q; }
    }
    return best;
  }

  drawBig(gen, explored, px, py, time) {
    const c = this.big, r = Math.max(1, Math.round(devicePixelRatio || 1)), w = innerWidth, h = innerHeight;
    if (c.width !== w * r || c.height !== h * r) { c.width = w * r; c.height = h * r; c.style.width = w + 'px'; c.style.height = h + 'px'; }
    // Que no se pueda ir más allá de lo explorado (y perderse en lo negro)
    const b = this.bounds(explored);
    if (!Number.isFinite(this.pan.x) || !Number.isFinite(this.pan.y)) this.recenter();
    // (el límite, contando con que lo explorado puede estar al otro lado de la costura del planeta: si el jugador queda
    // fuera de la caja, no se limita)
    if (px >= b.x0 - CHUNK && px <= b.x1 + CHUNK) this.pan.x = Math.max(b.x0 - px, Math.min(b.x1 - px, this.pan.x));
    if (py >= b.y0 - CHUNK && py <= b.y1 + CHUNK) this.pan.y = Math.max(b.y0 - py, Math.min(b.y1 - py, this.pan.y));
    const cx = px + this.pan.x, cy = py + this.pan.y, moved = Math.hypot(this.pan.x, this.pan.y) > 2, R = this.route;
    this.center = [cx, cy];
    // Solo si cambia algo de lo que se ve: el sitio, el zoom, el tamaño, el parpadeo del jugador, las miniaturas que llegan,
    // lo explorado, los lugares, los vecinos (por casilla) o la leyenda a medio mirar; y, por si acaso (lo cavado que se
    // llena de agua), dos veces por segundo. Repintarlo a pantalla entera en cada fotograma, con el mapa quieto, era trabajo
    // tirado (y, mientras, el mundo de detrás ya no se dibuja: ver Game.render)
    const key = `${w}x${h}x${r}|${this.zoom}|${cx.toFixed(2)},${cy.toFixed(2)}|${px.toFixed(1)},${py.toFixed(1)}|${this.face ? Math.round(Math.atan2(this.face.y, this.face.x) * 36 / Math.PI) : ''}|${Math.sin(time * 6) > 0}|${this.thumbs.size}|${explored.size}|${this.markers?.length}|${this.people.map(q => `${q.x | 0},${q.y | 0}`).join()}|${this.biomesFrom.size}|${R ? `${R.version}:${R.pinsVersion}:${R.state}` : ''}|${getLang()}`;
    if (key === this.bigKey && time - this.bigAt < 0.5 && this.legendGen === gen) return;
    this.bigKey = key; this.bigAt = time;
    this.drawFlat(c.getContext('2d'), gen, explored, cx, cy, r, w, h, time, [px, py]);
    this.updateLegend(gen, explored);
    this.info(t('gui.map.position', { x: Math.round(px - CENTER.x), y: Math.round(py - CENTER.y) }) +
      ' · ' + (moved ? t('gui.map.looking', { x: Math.round(cx - CENTER.x), y: Math.round(cy - CENTER.y) }) : t('gui.map.explored', { n: explored.size })));
    $('map-home').disabled = !moved;
    const rb = $('map-route'), sb = $('map-share');
    if (rb) rb.hidden = !R?.active;
    if (sb) sb.hidden = !(R?.active && R.canShare);
  }
  // The line under the map's title: where you are, and the route (how far, to where, whether part of it is unexplored),
  // or, with none, a faint "Click: mark a route"
  info(main) {
    const box = $('map-info');
    if (!box) return;
    if (!this.infoEls) { box.textContent = ''; this.infoEls = [document.createElement('span'), document.createElement('span')]; this.infoEls[1].className = 'mi-route'; box.append(...this.infoEls); }
    const R = this.route;
    let route = '', help = false;
    if (R?.active) {
      const name = R.target.name;
      if (R.state === 'finding') route = (name ? name + ' · ' : '') + t('map.route.finding');   // (the target's name at once: the search may take a second)
      else {
        const n = Math.round(R.left() || R.len);
        route = name ? t('map.route.to', { name, n }) : t('map.route.len', { n });
        if (R.unknownPart) route += ' · ' + t('map.route.straight');
      }
      if (R.debugText) route += ' · ' + R.debugText;
    } else if (R && !R.off) { route = t('map.route.help'); help = true; }
    this.infoEls[0].textContent = main;
    this.infoEls[1].textContent = route ? ' · ' + route : '';
    this.infoEls[1].classList.toggle('mi-help', help);
  }
  // Lo explorado en plano, con cada trozo en su sitio, y encima lo que tiene nombre
  drawFlat(g, gen, explored, cx, cy, r, w, h, time, me) {
    const a = this.tile, S = CHUNK * a, pcx = Math.floor(cx / CHUNK), rx = Math.ceil(w / S / 2) + 1, ry = Math.ceil(h / S / 2) + 1;
    g.setTransform(r, 0, 0, r, 0, 0);
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#1a1410';
    g.fillRect(0, 0, w, h);
    for (const key of explored) {
      const [kx, ky] = String(key).split(',').map(Number), dcx = wrapIndex(kx - pcx, CHUNK);
      if (!Number.isFinite(dcx) || !Number.isFinite(ky)) continue;
      if (Math.abs(dcx) > rx + 1 || Math.abs(ky - Math.floor(cy / CHUNK)) > ry + 1) continue;
      const t = this.thumb(gen, key);
      if (!t) continue;
      const [sx, sy] = this.toScreen(kx * CHUNK, ky * CHUNK, cx, cy, w, h);
      g.drawImage(t, Math.round(sx), Math.round(sy), S, S);
    }
    { const [sx, sy] = this.toScreen(Math.floor(cx - w / 2 / a), Math.floor(cy - h / 2 / a), cx, cy, w, h); this.floodOver(g, explored, Math.floor(cx - w / 2 / a), Math.floor(cy - h / 2 / a), Math.ceil(w / a) + 2, Math.ceil(h / a) + 2, a, sx, sy); }
    // The marked route: from where you are on it to the pin (the pin goes with the spots, for its label)
    const R = this.route;
    if (R?.dbgCells?.length) {   // (?ruta=ver: the tiles the last search expanded)
      g.fillStyle = 'rgba(255, 90, 200, .28)';
      const c = R.dbgCells;
      for (let i = 0; i < c.length; i += 2) { const [sx, sy] = this.toScreen(c[i], c[i + 1], cx, cy, w, h); g.fillRect(sx, sy, Math.max(1, a), Math.max(1, a)); }
    }
    if (R?.active) routeLine(g, R.pts, R.kinds, R.seg, (x, y, o) => { o[0] = w / 2 + a * (nearX(x, cx) - cx); o[1] = h / 2 + a * (y - cy); }, 3);
    // Lo que tiene nombre, por orden de importancia: tú, tu casa, los lugares, las casas y los vecinos. El nombre va al
    // lado del punto, donde quepa; si no cabe sin pisar otro, ese no sale (al acercarse, sí)
    // (to: where a route to it goes, Plan J: a house's door, a place's centre, where a neighbour is now)
    const spots = [{ x: me[0], y: me[1], name: t('gui.map.you'), col: Math.sin(time * 6) > 0 ? ME : '#ff6a4a', size: 11, dir: this.face ? [this.face.x, this.face.y] : [0, -1] }, { x: (HOUSE.x0 + HOUSE.x1) / 2, y: (HOUSE.y0 + HOUSE.y1) / 2, name: t('gui.map.home'), col: HOME, size: 8, to: { ...DOOR, kind: 'place', id: 'home' } }];
    if (R?.active) spots.push({ x: R.target.x, y: R.target.y, name: R.target.name, col: ROUTE, size: 9, pin: 'route' });
    for (const m of this.markers || []) spots.push({ x: m.x, y: m.y, name: m.name, col: COL[m.kind] || '#ffffff', size: 7, to: { x: m.x, y: m.y, kind: 'place', id: `poi:${Math.floor(m.x / CHUNK)},${Math.floor(m.y / CHUNK)}` } });
    for (const [k, q] of Object.entries(HOUSES)) if (!q.project || hasProject(q.project)) spots.push({ x: (q.x0 + q.x1) / 2, y: (q.y0 + q.y1) / 2, name: t('gui.map.house_of', { name: q.name }), col: HOUSE_COL, size: 7, to: { ...doorOf(q), kind: 'place', id: 'house:' + k } });
    spots.push({ x: (TAVERN.x0 + TAVERN.x1) / 2, y: (TAVERN.y0 + TAVERN.y1) / 2, name: t('gui.map.tavern'), col: HOUSE_COL, size: 7, to: { ...TAVERN_DOOR, kind: 'place', id: 'tavern' } });
    for (const q of this.people) spots.push({ x: q.x, y: q.y, name: q.name, col: PERSON, size: 5, to: { x: q.x, y: q.y, kind: 'point' } });
    if (R) for (const [conn, q] of R.pins) spots.push({ x: q.x, y: q.y, name: q.own ? q.name : q.name ? `${q.by}: ${q.name}` : q.by, col: SHARED, size: 8, pin: 'shared', conn });
    const taken = [], labels = [], clear = b => !taken.some(o => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
    g.font = '600 14px Barlow, system-ui, sans-serif';   // (the map is repainted at least twice a second, so once the font is in, it is used)
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    // (primero los puntos, de abajo arriba, para que los importantes queden encima)
    const shown = spots.map(q => { const [sx, sy] = this.toScreen(q.x, q.y, cx, cy, w, h); return { ...q, sx: Math.round(sx), sy: Math.round(sy) }; }).filter(q => q.sx > -60 && q.sx < w + 60 && q.sy > -20 && q.sy < h + 20);
    for (const q of [...shown].reverse()) {
      const n = q.size, m = n >> 1;
      if (q.dir) { arrow(g, q.sx, q.sy, q.dir[0], q.dir[1], 8, q.col); continue; }   // (you: an arrow where you face; the map has north up, like the world)
      if (q.pin) { pin(g, q.sx, q.sy, q.size * 0.55, q.col); continue; }   // (the route's pin and the shared ones: a teardrop on the spot)
      g.fillStyle = '#2a1c22'; g.fillRect(q.sx - m - 1, q.sy - m - 1, n + 2, n + 2);
      g.fillStyle = q.col; g.fillRect(q.sx - m, q.sy - m, n, n);
    }
    for (const q of shown) taken.push(q.pin ? [q.sx - 5, q.sy - 14, q.sx + 5, q.sy] : [q.sx - 5, q.sy - 5, q.sx + 5, q.sy + 5]);
    this.hits = shown;
    for (const q of shown) {
      if (!q.name || (q.col === PERSON && this.zoom < 3)) continue;
      const tw = g.measureText(q.name).width, off = (q.size >> 1) + 4, ly = q.pin ? q.sy - 9 : q.sy;   // (a pin's label beside its head)
      const at = [[q.sx + off, ly], [q.sx - off - tw, ly], [q.sx - tw / 2, ly - off - 7], [q.sx - tw / 2, q.sy + off + 7]].find(([tx, ty]) => clear([tx - 1, ty - 8, tx + tw + 1, ty + 8]) && tx > 0 && tx + tw < w && ty > 8 && ty < h - 8);
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
    const R = this.route, route = !!R?.active, pins = !!R?.pins.size, unknown = route && !!R.unknownPart;
    const kinds = [...new Map((this.markers || []).map(m => [m.kind, m.name])).entries()], key = `${[...this.seenBiomes].sort().join()}|${kinds.map(k => k[0]).sort().join()}|${route}${pins}${unknown}|${getLang()}`;
    if (key === this.legendKey) return;
    this.legendKey = key;
    const extra = [...(route ? [[ROUTE, t('map.legend.route')]] : []), ...(pins ? [[SHARED, t('map.legend.pins')]] : []), ...(unknown ? [['#1a1410', t('map.route.unknown')]] : [])];
    const rows = [[ME, t('gui.map.you')], [HOME, t('gui.map.home')], ...extra, [HOUSE_COL, t('gui.map.houses')], [PERSON, t('gui.map.neighbors')], ...kinds.map(([k, name]) => [COL[k] || '#ffffff', name]).sort((a, b) => a[1].localeCompare(b[1])), ...[...this.seenBiomes].sort((a, b) => a - b).map(b => [rgbCss(BIOMES[b].rgb[1]), BIOMES[b].name])];
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
      for (const key of explored) { const [cx, cy] = String(key).split(',').map(Number); if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue; x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy); }   // (una zona mal apuntada no estropea el mapa)
      this.boundsBox = Number.isFinite(x0) ? { x0: x0 * CHUNK, y0: y0 * CHUNK, x1: (x1 + 1) * CHUNK, y1: (y1 + 1) * CHUNK } : { x0: 0, y0: 0, x1: 0, y1: 0 };
      this.boundsFor = explored.size;
    }
    return this.boundsBox;
  }
}
