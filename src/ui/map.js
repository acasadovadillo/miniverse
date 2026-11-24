// The big map: only what has been explored, flat and with north up, like paper maps (each tile 2 px per unit of zoom). On it, your
// house, the neighbours' ones, the neighbours out and about, the places found with their names, and a legend with what has been
// seen. (The minimap is ui/minimap.js; it uses the pictures, the overlay and the drawing of the route of this file.)
// The marked route (Plan J §2.7, §4.2; route.js sets map.route): its line and pin on both maps, the pins other players
// shared, toWorld for map clicks (menus.js) and spotAt to snap a click to a named spot.
// The ground of both maps is the satellite pictures (sattiles.js, made in the ground worker) with what players and villages
// built or dug on top (mapoverlay.js); with no worker, or ?sat=0, the thumbnails of 1 px per tile made here in idle time, as
// before. What there is on them comes from the blip registry (blips.js); where two would overlap, only the one with the higher
// pri shows. game.js sets map.game.
import { CHUNK } from '../world/gen.js';
import { BIOMES, B } from '../world/biomes.js';
import { CENTER } from '../world/village.js';
import { nearX, wrapIndex, wrapX } from '../world/planet.js';
import { KIND } from '../world/routegrid.js';
import { t, getLang } from '../i18n.js';
import { SatTiles } from './sattiles.js';
import { MapOverlay } from './mapoverlay.js';
import { blips } from './blips.js';
import { sprite, svg } from './mapglyphs.js';
import { accent } from './skin.js';

const $ = id => document.getElementById(id);
const ME = '#ffd77a';
const ZOOM = [1, 8], BIOME_SAMPLES_PER_FRAME = 200;
const rgbCss = c => `rgb(${c[0]},${c[1]},${c[2]})`;
// The dark edge of the route and of the pins; the pins shared by others, blue (not the neighbours' light blue); the land not explored
export const OUTLINE = '#120a10', SHARED = '#5a8cff', FOG = '#0d1016';
const BIG_D = 22, PERSON_D = 14;   // (a blip's disc, a neighbour's)
const WIDE = 6;   // (chunks to spare on each side of the widest zooms' picture)
const SAT_VIEW = 800;   // (the big map shows the satellite pictures up to this many chunks in sight; over it, those of 1 px per tile)
const OVERLAY_BIG_MS = 5, ARRIVE_S = 0.12;   // (ms a drawing may spend on what is built; s between the big map's repaints as pictures arrive)
// How a stretch of the route is drawn, by the kind of its points (routegrid.js KIND): solid on land and roads, dotted
// through water, dashed where the land is unexplored (a straight line that reveals nothing)
const DOTS = [2, 3], DASH = [7, 5];
const styleOf = (a, b) => (a === KIND.unknown || b === KIND.unknown ? 2 : a === KIND.wade || a === KIND.swim || b === KIND.wade || b === KIND.swim ? 1 : 0);
// The route from point i0 on, through proj(x, y, out) (world → canvas pixels), in runs of one style, outline first, in your colour
export function routeLine(g, pts, kinds, i0, proj, width) {
  const n = pts.length >> 1, a = [0, 0];
  if (n - i0 < 2) return;
  g.lineJoin = 'round'; g.lineCap = 'round';
  let i = Math.max(0, i0);
  while (i < n - 1) {
    const st = styleOf(kinds[i], kinds[i + 1]);
    let j = i + 1;
    while (j < n - 1 && styleOf(kinds[j], kinds[j + 1]) === st) j++;
    const dash = st === 2 ? DASH : st === 1 ? DOTS : [];
    for (const [col, w] of [[OUTLINE, width + 2], [accent.color, width]]) {
      g.beginPath();
      for (let k = i; k <= j; k++) { proj(pts[k * 2], pts[k * 2 + 1], a); if (k === i) g.moveTo(a[0], a[1]); else g.lineTo(a[0], a[1]); }
      g.setLineDash(dash.map(d => d * width / 3)); g.lineWidth = w; g.strokeStyle = col; g.stroke();
    }
    i = j;
  }
  g.setLineDash([]); g.lineCap = 'butt';
}
// A map pin: a teardrop whose tip is on (x, y); r: its head's radius
export function pin(g, x, y, r, col) {
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
const POOL = sat => (sat ? '#5b909c' : rgbCss(BIOMES[B.SHALLOW].rgb[1]));

export class MapView {
  constructor() {
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
    this.queue = [];
    this.route = null;           // the marked route (route.js puts itself here)
    this.center = null;          // where the big map was centred in its last drawing ([x, y], for toWorld)
    this.game = null;            // (game.js; until then there are no satellite pictures and no blips)
    this.tiles = new SatTiles({ terrain: () => this.game?.view3d?.terrain || null, world: () => this.world || null, places: () => this.game?.places || null });
    this.built = new MapOverlay({ world: () => this.world || null, places: () => this.game?.places || null });
    this.now = 0;                // (performance.now() of the last drawing, in s)
    this.hits = [];              // the named spots and pins of the last big map, with their place on the screen (sx, sy)
  }

  // Las miniaturas que faltan se preparan en los ratos libres del navegador
  // (or, with a worker, they come from it: sattiles.js)
  thumb(gen, key, pri = 0) {
    if (this.tiles.ready) { const i = key.indexOf(','); return this.tiles.thumb(gen, +key.slice(0, i), +key.slice(i + 1), gen.season, pri); }
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
    const v = (keys.mapFast ? 450 : 180) * dt, dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0), dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    if (dx || dy) this.scroll(dx * v, dy * v);
  }
  recenter() { this.pan.x = this.pan.y = 0; }

  // Lo cavado que se ha llenado de agua (las miniaturas son del mundo y no lo tienen): una casilla de agua encima, de las de
  // un rectángulo de casillas [x0, x0 + w) × [y0, y0 + h) que se dibuja desde (ox, oy) con s píxeles por casilla. Son pocas
  // (las que se han cavado) y el mundo ya las tiene a mano (scenes.js, floodList). Solo en lo explorado (las claves de
  // explored, como en game.js): los canales que otro haya cavado lejos no salen en lo negro
  floodOver(g, explored, x0, y0, w, h, s, ox = 0, oy = 0) {
    const list = this.world?.floodList?.(x0, y0, x0 + w, y0 + h);
    if (!list?.length) return;
    g.fillStyle = POOL(this.tiles.ready);
    for (const [x, y] of list) if (explored.has(`${wrapIndex(Math.floor(x / CHUNK), CHUNK)},${Math.floor(y / CHUNK)}`)) g.fillRect(Math.round(ox + (x - x0) * s), Math.round(oy + (y - y0) * s), Math.ceil(s), Math.ceil(s));
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
    this.now = performance.now() / 1000;
    const stamp = R ? `${R.version}:${R.pinsVersion}:${R.state}` : '';
    if (this.game) blips.refresh(this.game, this.now, stamp !== this.stamp || this.people !== this.seenPeople);
    this.stamp = stamp; this.seenPeople = this.people;
    // (pictures that arrive one after another: repainted together, every ARRIVE_S)
    const key = `${w}x${h}x${r}|${this.zoom}|${cx.toFixed(2)},${cy.toFixed(2)}|${px.toFixed(1)},${py.toFixed(1)}|${this.face ? Math.round(Math.atan2(this.face.y, this.face.x) * 36 / Math.PI) : ''}|${Math.sin(time * 6) > 0}|${explored.size}|${blips.v}|${this.biomesFrom.size}|${stamp}|${accent.v}|${getLang()}`;
    const came = this.tiles.v + this.thumbs.size, due = (came !== this.cameV || this.built.pending) && Math.abs(this.now - (this.cameAt || 0)) > ARRIVE_S;
    if (key === this.bigKey && !due && time - this.bigAt < 0.5 && this.legendGen === gen) return;
    this.cameV = came; this.cameAt = this.now;
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
    const a = this.tile, S = CHUNK * a, rx = Math.ceil(w / S / 2) + 1, ry = Math.ceil(h / S / 2) + 1, pcx = Math.floor(cx / CHUNK), pcy = Math.floor(cy / CHUNK), sat = this.tiles.ready;
    g.setTransform(r, 0, 0, r, 0, 0);
    g.imageSmoothingEnabled = sat;
    g.imageSmoothingQuality = 'medium';
    g.fillStyle = FOG;
    g.fillRect(0, 0, w, h);
    const seen = [];
    for (let dy = -ry; dy <= ry; dy++) for (let dx = -rx; dx <= rx; dx++) {
      const kx = wrapIndex(pcx + dx, CHUNK), ky = pcy + dy, key = `${kx},${ky}`;
      if (explored.has(key)) seen.push(kx, ky, Math.hypot(dx, dy), key);
    }
    // (the satellite pictures if they all fit in what is kept of them; meanwhile, those of 1 px per tile)
    const fine = sat && seen.length / 4 <= SAT_VIEW;
    if (sat) this.built.begin(OVERLAY_BIG_MS);
    if (sat && !fine) this.drawWide(g, gen, explored, cx, cy, w, h, a);
    else {
      const over = [];
      for (let i = 0; i < seen.length; i += 4) {
        const kx = seen[i], ky = seen[i + 1], far = seen[i + 2], key = seen[i + 3];
        const t = sat ? this.tiles.tile(gen, kx, ky, gen.season, 1000 + far, key) || this.tiles.thumb(gen, kx, ky, gen.season, far, key) : this.thumb(gen, key);
        const [sx, sy] = this.toScreen(kx * CHUNK, ky * CHUNK, cx, cy, w, h);
        if (t) g.drawImage(t, Math.round(sx), Math.round(sy), S, S);
        const b = sat && this.built.picture(kx, ky, key);
        if (b) over.push(b, Math.round(sx), Math.round(sy));
      }
      for (let i = 0; i < over.length; i += 3) g.drawImage(over[i], over[i + 1], over[i + 2], S, S);
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
    // Lo que tiene nombre, por orden de importancia: tú y lo que haya en el mapa (blips.js, el de más pri, antes). El nombre va al
    // lado del punto, donde quepa; si no cabe sin pisar otro, ese no sale (al acercarse, sí)
    // (to: where a route to it goes, Plan J: a house's door, a place's centre, where a neighbour is now)
    const spots = [{ x: me[0], y: me[1], name: t('gui.map.you'), col: Math.sin(time * 6) > 0 ? ME : '#ff6a4a', size: 11, dir: this.face ? [this.face.x, this.face.y] : [0, -1] }];
    for (const b of this.game ? blips.list : []) {
      if (!blips.shown(b) || (b.kind === 'goal' && !b.name)) continue;
      if (b.r) {   // (an area: a dashed ring)
        const [sx, sy] = this.toScreen(b.x, b.y, cx, cy, w, h);
        g.beginPath(); g.arc(sx, sy, b.r * a, 0, Math.PI * 2);
        g.globalAlpha = 0.12; g.fillStyle = b.color; g.fill(); g.globalAlpha = 0.85; g.setLineDash([7, 5]); g.lineWidth = 2; g.strokeStyle = b.color; g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
      }
      if (b.r && !b.name) continue;
      const pinCol = b.pin === 'route' ? accent.color : SHARED;
      spots.push({ x: b.x, y: b.y, name: b.name, col: b.pin ? pinCol : b.color, size: b.pin ? (b.pin === 'route' ? 9 : 8) : b.kind === 'neighbor' ? PERSON_D : BIG_D, pin: b.pin || undefined, conn: b.conn, to: b.to, kind: b.kind, glyph: b.glyph, dim: b.dim });
    }
    const taken = [], labels = [], clear = b => !taken.some(o => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
    g.font = '600 14px Barlow, system-ui, sans-serif';   // (the map is repainted at least twice a second, so once the font is in, it is used)
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    // (primero los puntos, de abajo arriba, para que los importantes queden encima)
    const near = spots.map(q => { const [sx, sy] = this.toScreen(q.x, q.y, cx, cy, w, h); return { ...q, sx: Math.round(sx), sy: Math.round(sy) }; }).filter(q => q.sx > -60 && q.sx < w + 60 && q.sy > -20 && q.sy < h + 20);
    // (of two that would cover each other, only the more important: closer, both)
    const shown = [];
    for (const q of near) if (q.dir || q.pin || !shown.some(o => !o.dir && !o.pin && Math.hypot(o.sx - q.sx, o.sy - q.sy) < (o.size + q.size) * 0.32)) shown.push(q);
    for (const q of [...shown].reverse()) {
      const n = q.size, m = n / 2;
      if (q.dir) { arrow(g, q.sx, q.sy, q.dir[0], q.dir[1], 8, q.col); continue; }   // (you: an arrow where you face; the map has north up, like the world)
      if (q.pin) { pin(g, q.sx, q.sy, q.size * 0.55, q.col); continue; }   // (the route's pin and the shared ones: a teardrop on the spot)
      g.drawImage(sprite(q.glyph, q.col, n, r, q.dim), q.sx - m - 1, q.sy - m - 1, n + 2, n + 2);
    }
    for (const q of shown) { const m = q.dir ? 5 : q.size / 2 - 1; taken.push(q.pin ? [q.sx - 5, q.sy - 14, q.sx + 5, q.sy] : [q.sx - m, q.sy - m, q.sx + m, q.sy + m]); }
    this.hits = shown;
    for (const q of shown) {
      if (!q.name || (q.kind === 'neighbor' && this.zoom < 3)) continue;
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
  // The widest zooms: the pictures of 1 px per tile put together once, with WIDE chunks to spare on each side (moving the map
  // draws one image), and again when one has come, something was explored or the view gets out of it
  drawWide(g, gen, explored, cx, cy, w, h, a) {
    const S = CHUNK * a, nx = Math.ceil(w / S) + 1 + WIDE * 2, ny = Math.ceil(h / S) + 1 + WIDE * 2, pcx = Math.floor(cx / CHUNK), pcy = Math.floor(cy / CHUNK), v = this.tiles.v + this.built.v * 1e6;
    let W = this.wide;
    const out = !W || W.gen !== gen || W.nx !== nx || W.ny !== ny || Math.abs(pcx - W.cx) >= WIDE || Math.abs(pcy - W.cy) >= WIDE, age = out ? 0 : this.now - W.at;
    if (out || explored.size !== W.n || age > 2 || (age > 0.25 && (v !== W.v || W.missing || this.built.pending))) {
      W ||= this.wide = { pic: document.createElement('canvas') };
      W.gen = gen; W.n = explored.size; W.v = v; W.missing = 0; W.at = this.now; W.cx = pcx; W.cy = pcy;
      if (W.nx !== nx || W.ny !== ny) { W.nx = nx; W.ny = ny; W.pic.width = nx * CHUNK; W.pic.height = ny * CHUNK; }
      const p = W.pic.getContext('2d'), x0 = pcx - (nx >> 1), y0 = pcy - (ny >> 1);
      p.imageSmoothingQuality = 'medium';
      p.clearRect(0, 0, W.pic.width, W.pic.height);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const kx = wrapIndex(x0 + i, CHUNK), ky = y0 + j, key = `${kx},${ky}`;
        if (!explored.has(key)) continue;
        const t = this.tiles.thumb(gen, kx, ky, gen.season, Math.hypot(x0 + i - pcx, ky - pcy), key), b = this.built.picture(kx, ky, key);
        if (t) p.drawImage(t, i * CHUNK, j * CHUNK, CHUNK, CHUNK); else W.missing++;
        if (b) p.drawImage(b, i * CHUNK, j * CHUNK, CHUNK, CHUNK);
      }
      W.v = this.tiles.v + this.built.v * 1e6;
    }
    g.drawImage(W.pic, Math.round(w / 2 + a * ((W.cx - (nx >> 1)) * CHUNK - cx)), Math.round(h / 2 + a * ((W.cy - (ny >> 1)) * CHUNK - cy)), nx * S, ny * S);
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
    // (what there is on the map now, a row per kind: blips.js; the places, by their name)
    const rowsOf = new Map();
    for (const b of this.game ? blips.list : []) if (b.legend && blips.shown(b) && !b.pin && !rowsOf.has(b.legend)) rowsOf.set(b.legend, b);
    const key = `${accent.v}|${[...this.seenBiomes].sort().join()}|${[...rowsOf.keys()].sort().join()}|${route}${pins}${unknown}|${getLang()}`;
    if (key === this.legendKey) return;
    this.legendKey = key;
    const named = l => (l.startsWith('poi:') ? l.slice(4) : t(l)), extra = [...(route ? [[accent.color, t('map.legend.route'), 'pin']] : []), ...(pins ? [[SHARED, t('map.legend.pins'), 'pin']] : []), ...(unknown ? [[FOG, t('map.route.unknown')]] : [])];
    const things = [...rowsOf.entries()].map(([l, b]) => [b.color, named(l), b.glyph, l.startsWith('poi:')]), places = things.filter(q => q[3]).sort((p, q) => p[1].localeCompare(q[1]));
    const rows = [[ME, t('gui.map.you')], ...extra, ...things.filter(q => !q[3]), ...places, ...[...this.seenBiomes].sort((a, b) => a - b).map(b => [rgbCss(BIOMES[b].rgb[1]), BIOMES[b].name])];
    const box = $('map-legend-rows');
    box.textContent = '';
    for (const [col, name, glyph] of rows) {
      const row = document.createElement('div'), chip = document.createElement('i');
      chip.style.background = col;
      if (glyph) { chip.style.cssText = 'width:17px;height:17px;margin:0 -3px;border:0;background:none;line-height:0'; chip.innerHTML = svg(glyph, col); }
      row.append(chip, name);
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
