// The big map (docs/planes/realismo/PLAN-R8-hud-mapa.md §3.8): only what has been explored. Two dimensions, from above, flat and
// with north up, or, at the closest zooms (SOLID and up) unless V says otherwise, with its relief, at a slant and turnable (Z, C:
// src/three/map3d.js): then this file says what is looked at (the middle, the scale, how tilted and turned) and what there is on
// it, and that one draws it. Six steps of zoom (LADDER, px per tile), eased round the cursor. The land is src/ui/mapground.js: the satellite
// pictures (sattiles.js, made in the ground worker) with what players and villages built or dug on top (mapoverlay.js); with no
// worker, or ?sat=0, the thumbnails of 1 px per tile made here in idle time, as before. What there is on it comes from the blip
// registry (blips.js) with its names; where two would overlap, only the one with the higher pri shows. The marked route (Plan J
// §2.7, §4.2; route.js sets map.route): its line and pin, the pins other players shared, toWorld for clicks and spotAt to snap one
// to a named spot. The screen round it (filters, cursor, card, index, keys) is src/ui/mapscreen.js (map.screen), and the minimap
// is ui/minimap.js, which uses the pictures, the overlay and the drawing of the route of this file. game.js sets map.game.
import { CHUNK } from '../world/gen.js';
import { BIOMES, B } from '../world/biomes.js';
import { nearX, wrapIndex, wrapX } from '../world/planet.js';
import { KIND } from '../world/routegrid.js';
import { t, getLang } from '../i18n.js';
import { SatTiles } from './sattiles.js';
import { MapOverlay } from './mapoverlay.js';
import { RoadLines } from './roadlines.js';
import { MapGround } from './mapground.js';
import { blips, blipScale } from './blips.js';
import { sprite } from './mapglyphs.js';
import { accent } from './skin.js';
import { Settings } from '../settings.js';
import { Map3D, MAP3D } from '../three/map3d.js';

const $ = id => document.getElementById(id);
export const LADDER = [0.5, 1, 2, 4, 8, 16];      // (px per tile)
export const ZOOM_NAMES = ['world', 'wide', 'region', 'area', 'close', 'street'];
export const SOLID = 3;                            // (the step of the zoom from which it has relief: 4 px per tile)
const TILT_S = 0.38, TURN_S = 0.35, TURN = Math.PI / 4;   // (s to tilt or flatten the view, and to turn it; a turn)
const ZOOM_S = 0.16, FLY_S = 0.5, PAN = [300, 760];   // (s of a step of the zoom, of a flight to a place; px/s with the keys, and with Shift)
const BIOME_SAMPLES_PER_FRAME = 200;
const rgbCss = c => `rgb(${c[0]},${c[1]},${c[2]})`;
// The dark edge of the route and of the pins; the pins shared by others, blue (not the neighbours' light blue); the land not explored and its grid
export const OUTLINE = '#120a10', SHARED = '#5a8cff', FOG = '#0d1016';
export const GRID = '#161b24';
const GRID_MIN = 24;   // (px between two lines, at least)
const BIG_D = 22, PERSON_D = 14, SMALL_D = 17;   // (a blip's disc, a neighbour's, a mark of your couple's)
const NAMES_FROM = 2, NEAR_NAMES_FROM = 4, PEOPLE_FROM = 6, ROOFS_FROM = 8;   // (px per tile from which names show: of places, of houses and shops, of neighbours; and the roofs, drawn sharp)
const FAR_NAMES = new Set(['home', 'route', 'partner', 'mark', 'goal']), NEAR_NAMES = new Set(['house', 'shop']);
const SPOT_FONT = '600 14px Barlow, system-ui, sans-serif';
const ARRIVE_S = 0.12, IDLE_S = 1.2;   // (s between two drawings as pictures arrive; with nothing new, what dug ground filled with water may have changed)
const still = () => Settings.v.motion === 'reduced' || !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// How a stretch of the route is drawn, by the kind of its points (routegrid.js KIND): solid on land and roads, dotted
// through water, dashed where the land is unexplored (a straight line that reveals nothing)
const DOTS = [2, 3], DASH = [7, 5];
export const styleOf = (a, b) => (a === KIND.unknown || b === KIND.unknown ? 2 : a === KIND.wade || a === KIND.swim || b === KIND.wade || b === KIND.swim ? 1 : 0);
// The route from point i0 on, through proj(x, y, out) (world → canvas pixels), in runs of one style, outline first, in its colour
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
    for (const [col, w] of [[OUTLINE, width + 2], [accent.route, width]]) {
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
  g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = OUTLINE; g.stroke();
  g.fillStyle = col; g.fill();
}
// (lo cavado que se ha llenado de agua, del color de las aguas poco profundas: ver floodOver)
const POOL = sat => (sat ? '#5b909c' : rgbCss(BIOMES[B.SHALLOW].rgb[1]));

export class MapView {
  constructor() {
    this.big = $('bigmap');
    this.thumbs = new Map();
    this.step = 3; this.px = LADDER[3];   // (the step of the zoom, and px per tile now: between two steps while it eases)
    this.zooming = null; this.flying = null;
    this.yaw = 0; this.tilt = 0;   // (3D: towards where the top of the screen looks, 0: north, clockwise; 0: straight from above, 1: at a slant)
    this.turning = null; this.tilting = null;
    this.relief = null;          // (the 3D view, three/map3d.js: made the first time it is wanted)
    this.pan = { x: 0, y: 0 };   // cuánto se ha movido el mapa grande desde el jugador, en casillas
    this.labels = [];            // los nombres que se han podido poner en el último dibujo
    this.people = [];            // los vecinos que están fuera: { x, y, name }
    this.face = null;            // where the player faces ({ x, y }, from game.js): their arrow points there
    this.seenBiomes = new Set(); // los biomas de lo explorado (para la leyenda)
    this.biomesFrom = new Set(); // los trozos ya mirados
    this.queue = [];
    this.route = null;           // the marked route (route.js puts itself here)
    this.center = null;          // where the big map was centred in its last drawing ([x, y], for toWorld)
    this.me = null;              // where you were then
    this.game = null;            // (game.js; until then there are no satellite pictures and no blips)
    this.screen = null;          // (mapscreen.js: frame(), each frame the map is open)
    this.tiles = new SatTiles({ terrain: () => this.game?.view3d?.terrain || null, world: () => this.world || null, places: () => this.game?.places || null });
    this.built = new MapOverlay({ world: () => this.world || null, places: () => this.game?.places || null });
    this.ground = new MapGround(this);
    this.roadLines = new RoadLines(() => this.game, () => this.game?.view3d?.terrain || null);
    this.now = 0;                // (performance.now() of the last drawing, in s)
    this.hits = [];              // the named spots and pins of the last big map, with their place on the screen (sx, sy)
    this.drawn = 0;              // (how many times it has been drawn)
    this.widths = new Map();
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

  // ---------- the zoom and the place ----------
  // Píxeles de pantalla por casilla en el mapa grande
  get tile() { return this.px; }
  // The step of the zoom (0-5), at once
  get zoom() { return this.step; }
  set zoom(v) { this.step = clamp(Math.round(v) || 0, 0, LADDER.length - 1); this.px = LADDER[this.step]; this.zooming = null; }
  // ---------- the 3D view ----------
  // Can it be had at all here and now? (a world with its pictures, not a cave, a graphics card that can)
  get canSolid() { const G = this.game; return MAP3D && !!G && G.mode === 'map' && G.scene?.kind !== 'grid' && this.tiles.ready && !this.relief?.broken && !G.view3d.prep; }
  // Is it wanted: close enough, and not turned off with V (kept in the settings)
  get wantsSolid() { return this.canSolid && this.step >= SOLID && !Settings.v.mapFlat; }
  get solid() { return !!this.relief?.on && this.game.mode === 'map'; }   // (is it what is seen now)
  // V: with relief, or flat. Turning: a step of 45° (Z, C), or north up again (d: 0)
  setFlat(v) { if (!this.canSolid || this.step < SOLID) return false; Settings.set('mapFlat', !!v); return true; }
  turn(d) {
    if (!this.solid || !this.wantsSolid) return false;
    const to = d ? (Math.round((this.turning ? this.turning.to : this.yaw) / TURN) + d) * TURN : Math.round(this.yaw / (Math.PI * 2)) * Math.PI * 2;
    if (!d && Math.abs(to - this.yaw) < 1e-4) return false;
    this.turning = { from: this.yaw, to, t0: performance.now() / 1000 };
    if (still()) this.ease();
    return true;
  }
  tiltTo(v) {
    const T = this.tilting;
    if ((T ? T.to : this.tilt) === v) return;
    this.tilting = { from: this.tilt, to: v, t0: performance.now() / 1000 };
    // (flattening, north comes up again)
    if (!v && (this.yaw || this.turning)) { const y = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw)); this.yaw = y; this.turning = { from: y, to: 0, t0: performance.now() / 1000, s: TILT_S }; }
    if (still()) this.ease();
  }
  // (dx, dy) px of the screen, as tiles of the land
  across(dx, dy) {
    if (!this.solid) return [dx / this.px, dy / this.px];
    const v = dy / (this.px * this.relief.squash), x = dx / this.px, c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return [x * c - v * s, x * s + v * c];
  }
  // Mueve el mapa grande lo que se ha arrastrado o pulsado, en píxeles de pantalla (from, to: where the pointer was and is, so that
  // in 3D what is held stays under it)
  scroll(dx, dy, from = null, to = null) {
    this.flying = null;
    const held = from && this.solid ? this.relief.drag(from, to) : null, [x, y] = held || this.across(dx, dy);
    this.pan.x += x; this.pan.y += y;
    if (this.zooming) { this.zooming.ox += x; this.zooming.oy += y; }
  }
  // Acercar o alejar dejando quieto lo que hay en el punto (sx, sy) de la pantalla (si no se dice, el centro)
  zoomAt(d, sx = innerWidth / 2, sy = innerHeight / 2) {
    const to = clamp(this.step + Math.sign(d), 0, LADDER.length - 1);
    if (to === this.step) return false;
    this.flying = null;
    this.step = to;
    // (vx, vy: from the middle to what is under that point, in px: what does not move while the scale changes)
    const at = this.solid && this.relief.floor(sx, sy), vx = at ? at[0] * this.px : sx - innerWidth / 2, vy = at ? at[1] * this.px : sy - innerHeight / 2;
    this.zooming = { from: this.px, to: LADDER[to], t0: performance.now() / 1000, vx, vy, ox: this.pan.x + vx / this.px, oy: this.pan.y + vy / this.px };
    if (still()) this.ease();
    return true;
  }
  // The middle goes to (x, y), in a moment
  flyTo(x, y) {
    if (!this.me) return;
    this.endZoom();
    this.flying = { x0: this.pan.x, y0: this.pan.y, x1: nearX(x, this.me[0]) - this.me[0], y1: y - this.me[1], t0: performance.now() / 1000 };
    if (still()) this.ease();
  }
  endZoom() { if (this.zooming) { this.zooming.t0 = -Infinity; this.ease(); } }
  ease() {
    const now = performance.now() / 1000, Z = this.zooming, F = this.flying, T = this.tilting, U = this.turning;
    if (Z) {
      const k = still() ? 1 : clamp((now - Z.t0) / ZOOM_S, 0, 1), e = 1 - (1 - k) ** 3;
      this.px = k >= 1 ? Z.to : Z.from * (Z.to / Z.from) ** e;
      this.pan.x = Z.ox - Z.vx / this.px; this.pan.y = Z.oy - Z.vy / this.px;
      if (k >= 1) this.zooming = null;
    }
    if (F) {
      const k = still() ? 1 : clamp((now - F.t0) / FLY_S, 0, 1), e = k < 0.5 ? 4 * k ** 3 : 1 - (2 - 2 * k) ** 3 / 2;
      this.pan.x = F.x0 + (F.x1 - F.x0) * e; this.pan.y = F.y0 + (F.y1 - F.y0) * e;
      if (k >= 1) this.flying = null;
    }
    if (T) {
      const k = still() ? 1 : clamp((now - T.t0) / TILT_S, 0, 1), e = k * k * (3 - 2 * k);
      this.tilt = T.from + (T.to - T.from) * e;
      if (k >= 1) this.tilting = null;
    }
    if (U) {
      const k = still() ? 1 : clamp((now - U.t0) / (U.s || TURN_S), 0, 1), e = 1 - (1 - k) ** 3;
      this.yaw = U.from + (U.to - U.from) * e;
      if (k >= 1) { this.yaw = Math.atan2(Math.sin(U.to), Math.cos(U.to)); if (Math.abs(this.yaw) < 1e-6) this.yaw = 0; this.turning = null; }
    }
  }
  // WASD o flechas con el mapa abierto (Shift, más rápido)
  update(keys, dt) {
    const v = PAN[keys.mapFast ? 1 : 0] * dt, dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0), dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    if (dx || dy) { this.scroll(dx * v, dy * v); this.screen?.byKeys(); }
  }
  // Back to you: at once, or in a flight
  recenter(fly = false) { if (fly && this.me) this.flyTo(this.me[0], this.me[1]); else { this.endZoom(); this.flying = null; this.pan.x = this.pan.y = 0; } }
  get moved() { return Math.hypot(this.pan.x, this.pan.y) > 2; }
  // The map was closed: what only it needs, back
  close() {
    this.endZoom(); this.flying = null; this.ground.free(); this.bigKey = ''; this.hits = []; this.big.width = this.big.height = 1;
    this.yaw = this.tilt = 0; this.turning = this.tilting = null;
    this.relief?.close();
  }

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
    if (this.solid) return this.relief.pick(sx, sy);
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
    const c = this.big, r = clamp(Math.round(devicePixelRatio || 1), 1, 2), w = innerWidth, h = innerHeight;
    this.now = performance.now() / 1000;
    if (!Number.isFinite(this.pan.x) || !Number.isFinite(this.pan.y)) this.recenter();
    this.ease();
    this.me = [px, py];
    const R = this.route, stamp = R ? `${R.version}:${R.pinsVersion}:${R.state}` : '';
    if (this.game) blips.refresh(this.game, this.now, stamp !== this.stamp || this.people !== this.seenPeople);
    this.stamp = stamp; this.seenPeople = this.people;
    this.keepIn(explored, px, py);
    const cx = px + this.pan.x, cy = py + this.pan.y;
    this.center = [cx, cy];
    this.sampleBiomes(gen, explored);
    this.roadLines.warm(gen, cx, cy, w / this.px, h / this.px);
    if (this.drawSolid(gen, explored, cx, cy, stamp, w, h)) { this.screen?.frame(); return; }
    if (c.width !== w * r || c.height !== h * r) { c.width = w * r; c.height = h * r; c.style.width = w + 'px'; c.style.height = h + 'px'; this.bigKey = ''; }
    // Solo si cambia algo de lo que se ve: el sitio, el zoom, el tamaño, las fotos que llegan, lo explorado, los lugares, los
    // vecinos (por casilla); y, por si acaso (lo cavado que se llena de agua), de vez en cuando. Repintarlo a pantalla entera en
    // cada fotograma, con el mapa quieto, era trabajo tirado (y, mientras, el mundo de detrás ya no se dibuja: ver Game.render)
    // (pictures that arrive one after another: painted together, every ARRIVE_S)
    const key = `${w}x${h}x${r}|${this.px}|${cx.toFixed(2)},${cy.toFixed(2)}|${px.toFixed(1)},${py.toFixed(1)}|${this.face ? Math.round(Math.atan2(this.face.y, this.face.x) * 36 / Math.PI) : ''}|${explored.size}|${blips.v}|${stamp}|${accent.v}|${Settings.v.blipSize}|${getLang()}`;
    const came = `${this.tiles.v}|${this.thumbs.size}|${this.built.v}|${this.roadLines.version(gen)}`, due = this.ground.busy || ((came !== this.cameV || this.built.pending) && Math.abs(this.now - (this.cameAt || 0)) > ARRIVE_S);
    if (key !== this.bigKey || due || this.now - this.bigAt > IDLE_S || this.drawnGen !== gen) {
      this.cameV = came; this.cameAt = this.now; this.bigKey = key; this.bigAt = this.now; this.drawnGen = gen;
      this.drawFlat(c.getContext('2d'), gen, explored, cx, cy, r, w, h);
      this.drawn++;
    }
    this.screen?.frame();
  }
  // The 3D view, if it is what is to be seen: it begins flat, just as the 2D map is, and tilts; to go, it flattens first. True if it
  // was drawn (or nothing in it had to be)
  drawSolid(gen, explored, cx, cy, stamp, w, h) {
    const wants = this.wantsSolid;
    if (!wants && !this.solid) { this.relief?.rest(this.now); return false; }
    const D = (this.relief ||= new Map3D(this)), V = { gen, explored, cx, cy, px: this.px, to: this.zooming ? this.zooming.to : this.px, yaw: this.yaw, tilt: this.tilt, w, h, stamp };
    if (!D.on) {
      if (!D.prepare(V)) return false;   // (the relief has not come yet: the flat one, meanwhile)
      this.tilt = this.yaw = 0; this.turning = this.tilting = null;
      D.show();
    } else if (!this.canSolid && (D.broken || this.game?.scene?.kind === 'grid' || !this.tiles.ready)) { D.hide(); this.tilt = this.yaw = 0; this.turning = this.tilting = null; this.bigKey = ''; return false; }
    this.tiltTo(wants ? 1 : 0);
    if (!wants && this.tilt === 0 && this.yaw === 0 && !this.zooming) { D.hide(); this.bigKey = ''; return false; }
    V.yaw = this.yaw; V.tilt = this.tilt;
    D.frame(V);
    if (D.broken) { D.hide(); this.bigKey = ''; return false; }
    if (D.settled && this.big.width > 1) { this.ground.free(); this.big.width = this.big.height = 1; }   // (what only the flat one needs)
    return true;
  }
  // Que no se pueda ir más allá de lo explorado (y perderse en lo negro), ni de lo que hay en el mapa
  // (el límite, contando con que lo explorado puede estar al otro lado de la costura del planeta: si el jugador queda fuera de la
  // caja, no se limita)
  keepIn(explored, px, py) {
    const b = this.bounds(explored);
    let x0 = b.x0, x1 = b.x1, y0 = b.y0, y1 = b.y1;
    if (px < x0 - CHUNK || px > x1 + CHUNK) { x0 = -Infinity; x1 = Infinity; }
    if (py < y0 - CHUNK || py > y1 + CHUNK) { y0 = -Infinity; y1 = Infinity; }
    for (const q of this.game ? blips.list : []) { const x = nearX(q.x, px); if (x < x0) x0 = x; if (x > x1) x1 = x; if (q.y < y0) y0 = q.y; if (q.y > y1) y1 = q.y; }
    const x = clamp(this.pan.x, x0 - px, x1 - px), y = clamp(this.pan.y, y0 - py, y1 - py);
    if (x !== this.pan.x || y !== this.pan.y) {
      if (this.zooming) { this.zooming.ox += x - this.pan.x; this.zooming.oy += y - this.pan.y; }
      this.pan.x = x; this.pan.y = y;
    }
  }
  // Lo explorado en plano, con cada trozo en su sitio, y encima lo que tiene nombre
  drawFlat(g, gen, explored, cx, cy, r, w, h) {
    const a = this.px, Z = this.zooming, me = this.me;
    g.setTransform(r, 0, 0, r, 0, 0);
    g.fillStyle = FOG;
    g.fillRect(0, 0, w, h);
    this.grid(g, cx, cy, a, r, w, h);
    const to = Z ? Z.to : a;
    this.ground.draw(g, { gen, explored, cx, cy, a, w, h, r, to, tx: Z ? me[0] + Z.ox - Z.vx / to : cx, ty: Z ? me[1] + Z.oy - Z.vy / to : cy });
    if (a >= 1) { const x0 = Math.floor(cx - w / 2 / a), y0 = Math.floor(cy - h / 2 / a), [sx, sy] = this.toScreen(x0, y0, cx, cy, w, h); this.floodOver(g, explored, x0, y0, Math.ceil(w / a) + 2, Math.ceil(h / a) + 2, a, sx, sy); }
    if (a >= ROOFS_FROM && this.tiles.ready) this.roofs(g, explored, cx, cy, a, w, h);
    this.roadLines.flat(g, gen, [cx - w / 2 / a, cy - h / 2 / a, cx + w / 2 / a, cy + h / 2 / a], off => g.setTransform(r * a, 0, 0, r * a, r * (w / 2 + a * (off - cx)), r * (h / 2 - a * cy)), a);
    g.setTransform(r, 0, 0, r, 0, 0);
    // The marked route: from where you are on it to the pin (the pin goes with the spots, for its label)
    const R = this.route;
    if (R?.dbgCells?.length) {   // (?ruta=ver: the tiles the last search expanded)
      g.fillStyle = 'rgba(255, 90, 200, .28)';
      const c = R.dbgCells;
      for (let i = 0; i < c.length; i += 2) { const [sx, sy] = this.toScreen(c[i], c[i + 1], cx, cy, w, h); g.fillRect(sx, sy, Math.max(1, a), Math.max(1, a)); }
    }
    if (R?.active) routeLine(g, R.pts, R.kinds, R.seg, (x, y, o) => { o[0] = w / 2 + a * (nearX(x, cx) - cx); o[1] = h / 2 + a * (y - cy); }, 5);
    this.spots(g, cx, cy, a, r, w, h);
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
  // The land not explored: a faint grid, a line every chunk (or every few, far out)
  grid(g, cx, cy, a, r, w, h) {
    let n = CHUNK;
    while (n * a < GRID_MIN) n *= 2;
    const x0 = Math.ceil((cx - w / 2 / a) / n) * n, y0 = Math.ceil((cy - h / 2 / a) / n) * n, at = v => Math.round(v * r) / r;
    g.fillStyle = GRID;
    for (let x = x0; x < cx + w / 2 / a; x += n) g.fillRect(at(w / 2 + (x - cx) * a), 0, 1, h);
    for (let y = y0; y < cy + h / 2 / a; y += n) g.fillRect(0, at(h / 2 + (y - cy) * a), w, 1);
  }
  // The roofs, sharp over their picture at the closest zooms: their two slopes, the ridge, a thin edge and a shadow of 1 px
  roofs(g, explored, cx, cy, a, w, h) {
    const rx = w / 2 / a + 4, ry = h / 2 / a + 4, K = `${Math.floor(cx / 24)},${Math.floor(cy / 24)},${this.step},${w}x${h},${this.built.v},${explored.size}`;
    if ((K !== this.roofKey || this.now - this.roofAt > 2) && (!this.zooming || !this.roofList)) {
      this.roofKey = K; this.roofAt = this.now;
      this.built.begin(4);
      const seen = (x, y) => explored.has(`${wrapIndex(Math.floor(x / CHUNK), CHUNK)},${Math.floor(y / CHUNK)}`);
      this.roofList = this.built.footprints(cx - rx - 24, cy - ry - 24, cx + rx + 24, cy + ry + 24).filter(q => seen((q.x0 + q.x1) / 2, (q.y0 + q.y1) / 2));
      if (this.built.pending) this.roofKey = '';
    }
    for (const q of this.roofList) {
      const x = w / 2 + (nearX(q.x0, cx) - cx) * a, y = h / 2 + (q.y0 - cy) * a, W = (q.x1 - q.x0) * a, H = (q.y1 - q.y0) * a;
      if (x > w || y > h || x + W < 0 || y + H < 0) continue;
      const wide = W >= H, m = Math.min(W, H) / 2, e = m * 0.45, A = wide ? [x + e, y + m] : [x + m, y + e], Bp = wide ? [x + W - e, y + m] : [x + m, y + H - e];
      g.fillStyle = 'rgba(0, 0, 0, .4)'; g.fillRect(x + 1, y + 1, W + 1.5, H + 1.5);
      g.fillStyle = q.color; g.fillRect(x, y, W, H);
      const face = (f, ...p) => { g.beginPath(); p.forEach(([u, v], i) => (i ? g.lineTo(u, v) : g.moveTo(u, v))); g.closePath(); g.fillStyle = f; g.fill(); };
      const nw = [x, y], ne = [x + W, y], se = [x + W, y + H], sw = [x, y + H], LIT = 'rgba(255, 255, 255, .13)', DIM = 'rgba(0, 0, 0, .2)', MID = 'rgba(0, 0, 0, .08)';
      if (wide) { face(LIT, nw, ne, Bp, A); face(DIM, sw, se, Bp, A); face(MID, ne, se, Bp); face(LIT, nw, sw, A); } else { face(LIT, nw, sw, Bp, A); face(DIM, ne, se, Bp, A); face(LIT, nw, ne, A); face(MID, sw, se, Bp); }
      g.beginPath(); g.moveTo(...A); g.lineTo(...Bp); g.lineWidth = 1; g.strokeStyle = 'rgba(255, 255, 255, .22)'; g.stroke();
      g.strokeStyle = 'rgba(0, 0, 0, .45)'; g.strokeRect(x + 0.5, y + 0.5, W - 1, H - 1);
    }
  }
  // Lo que tiene nombre, por orden de importancia: tú y lo que haya en el mapa (blips.js, el de más pri, antes). El nombre va al
  // lado del punto, donde quepa; si no cabe sin pisar otro, ese no sale (al acercarse, sí)
  // (to: where a route to it goes, Plan J: a house's door, a place's centre, where a neighbour is now)
  spotList() {
    const K = blipScale(), me = this.me, spots = [{ x: me[0], y: me[1], name: t('gui.map.you'), col: '#ffffff', size: 13, dir: this.face ? [this.face.x, this.face.y] : [0, -1], kind: 'you' }], rings = [];
    for (const b of this.game ? blips.list : []) {
      if (!blips.shown(b) || (b.kind === 'goal' && !b.name)) continue;
      if (b.r) rings.push(b);   // (an area: a dashed ring)
      if (b.r && !b.name) continue;
      const pinCol = b.pin === 'route' ? accent.route : SHARED;
      spots.push({ x: b.x, y: b.y, z: b.z, name: b.name, sub: b.sub, col: b.pin ? pinCol : b.color, size: b.pin ? (b.pin === 'route' ? 9 : 8) : Math.round((b.kind === 'neighbor' ? PERSON_D : b.small ? SMALL_D : BIG_D) * K), pin: b.pin || undefined, conn: b.conn, to: b.to, kind: b.kind, glyph: b.glyph, dim: b.dim, mark: b.mark || 0 });
    }
    return { spots, rings };
  }
  // Which of them show, where (proj(q): its place on the screen, or null) and which names, beside them where there is room. Both
  // views use it; max: at most so many
  layout(spots, proj, a, w, h, max = Infinity) {
    const taken = [], clear = b => !taken.some(o => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
    const g = (this.measure ||= document.createElement('canvas').getContext('2d'));
    g.font = SPOT_FONT;
    const near = [];
    for (const q of spots) { const at = proj(q); if (at && at[0] > -60 && at[0] < w + 60 && at[1] > -20 && at[1] < h + 20) near.push({ ...q, sx: Math.round(at[0]), sy: Math.round(at[1]) }); }
    // (of two that would cover each other, only the more important: closer, both)
    const shown = [], labels = [];
    for (const q of near) if (shown.length < max && (q.dir || q.pin || !shown.some(o => !o.dir && !o.pin && Math.hypot(o.sx - q.sx, o.sy - q.sy) < (o.size + q.size) * 0.32))) shown.push(q);
    for (const q of shown) { const m = q.dir ? 6 : q.size / 2 - 1; taken.push(q.pin ? [q.sx - 5, q.sy - 14, q.sx + 5, q.sy] : [q.sx - m, q.sy - m, q.sx + m, q.sy + m]); }
    if (this.widths.size > 600) this.widths.clear();
    for (const q of shown) {
      if (!q.name || (q.kind === 'neighbor' ? a < PEOPLE_FROM : NEAR_NAMES.has(q.kind) ? a < NEAR_NAMES_FROM : a < NAMES_FROM && !FAR_NAMES.has(q.kind))) continue;
      let tw = this.widths.get(q.name);
      if (tw === undefined) this.widths.set(q.name, tw = g.measureText(q.name).width);
      const off = (q.size >> 1) + 4, ly = q.pin ? q.sy - 9 : q.sy;   // (a pin's label beside its head)
      const at = [[q.sx + off, ly], [q.sx - off - tw, ly], [q.sx - tw / 2, ly - off - 7], [q.sx - tw / 2, q.sy + off + 7]].find(([tx, ty]) => clear([tx - 1, ty - 8, tx + tw + 1, ty + 8]) && tx > 0 && tx + tw < w && ty > 8 && ty < h - 8);
      if (!at) continue;
      taken.push([at[0] - 1, at[1] - 8, at[0] + tw + 1, at[1] + 8]);
      labels.push({ q, x: at[0], y: at[1] });
    }
    this.hits = shown;
    this.labels = labels.map(l => l.q.name);
    return { shown, labels };
  }
  spots(g, cx, cy, a, r, w, h) {
    const K = blipScale(), { spots, rings } = this.spotList();
    for (const b of rings) {
      const [sx, sy] = this.toScreen(b.x, b.y, cx, cy, w, h);
      g.beginPath(); g.arc(sx, sy, b.r * a, 0, Math.PI * 2);
      g.globalAlpha = 0.12; g.fillStyle = b.color; g.fill(); g.globalAlpha = 0.85; g.setLineDash([7, 5]); g.lineWidth = 2; g.strokeStyle = b.color; g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
    }
    const { shown, labels } = this.layout(spots, q => this.toScreen(q.x, q.y, cx, cy, w, h), a, w, h);
    // (primero los puntos, de abajo arriba, para que los importantes queden encima)
    for (const q of [...shown].reverse()) {
      const n = q.size, m = n / 2;
      if (q.dir) { arrow(g, q.sx, q.sy, q.dir[0], q.dir[1], 10, q.col); continue; }   // (you: an arrow where you face; the map has north up, like the world)
      if (q.pin) { pin(g, q.sx, q.sy, q.size * 0.55 * K, q.col); continue; }   // (the route's pin and the shared ones: a teardrop on the spot)
      g.drawImage(sprite(q.glyph, q.col, n, r, q.dim), q.sx - m - 1, q.sy - m - 1, n + 2, n + 2);
    }
    g.font = SPOT_FONT;   // (the map is painted again now and then, so once the font is in, it is used)
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    for (const l of labels) {
      g.strokeStyle = 'rgba(10, 12, 16, .85)'; g.lineWidth = 3; g.strokeText(l.q.name, l.x, l.y);
      g.fillStyle = '#fff'; g.fillText(l.q.name, l.x, l.y);
    }
  }
  // Los biomas de lo explorado (para la leyenda), unos pocos trozos cada vez
  sampleBiomes(gen, explored) {
    if (this.biomesGen !== gen) { this.biomesGen = gen; this.seenBiomes.clear(); this.biomesFrom.clear(); this.biomesN = -1; }
    if (this.biomesN === explored.size) return;
    let n = 0;
    for (const key of explored) {
      if (this.biomesFrom.has(key)) continue;
      this.biomesFrom.add(key);
      const [kx, ky] = key.split(',').map(Number);
      for (const [i, j] of [[4, 4], [12, 4], [8, 8], [4, 12], [12, 12]]) this.seenBiomes.add(gen.biomeAt(kx * CHUNK + i + 0.5, ky * CHUNK + j + 0.5));
      if (++n >= BIOME_SAMPLES_PER_FRAME) return;
    }
    this.biomesN = explored.size;
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
