// The minimap (docs/planes/realismo/PLAN-R8-hud-mapa.md §3.3): a rounded square at the bottom left, heading-up (what is ahead of
// the camera is up), with the ground of the satellite pictures (sattiles.js, mapoverlay.js), the houses rising out of it, the
// marked route, what there is on it (blips.js; tracked things are held on the rim while they are farther), the distance left over
// it and the heading under it. The faster you go, the more land in view.
//
// Nothing is drawn per frame. Two canvases: the ground, north up and half as big again (its corners stay filled as it turns),
// redrawn when you have moved, the scale has changed or a picture has come, BASE_HZ times a second at most; and what stands
// upright (houses, blips, the notch of the next turn), at most OVER_HZ. Each frame the two are only turned, slid and scaled by
// CSS (rotate, translate, scale: the compositor does it), with strings made beforehand and written only when they change, so the
// map is always exactly where the camera looks, also between two drawings. No layout is ever read.
//
//   Settings.v.mini   'fade' (the default: it comes and goes by the minimal interface's rules, smarthud.js), 'always', 'compass' (no
//                     map: the strip of ui/compass.js) or 'off'. miniMode() gives the one in use
//   minimap.overlays  fn(ctx, toMap, me, a, minimap) drawn over the ground and under the blips, for what is no place (the
//                     hunting ring, ui/huntoverlay.js): toMap(x, y) → [px, py] of the drawing, a: px per tile, minimap.rim(ux,
//                     uy, inset) → where the direction (ux, uy) meets the rim, from the middle. overlay.live: keep redrawing
//   minimap.kick()    draw all of it again at the next frame;  minimap.shown: whether it is in sight
//   minimap.heading   the bearing of the camera in degrees (0 north, 90 east)
import { CHUNK } from '../world/gen.js';
import { wrapIndex, wrapX, nearX } from '../world/planet.js';
import { CAM } from '../camera.js';
import { Settings } from '../settings.js';
import { TOWER } from '../world/tower.js';
import { BIOMES } from '../world/biomes.js';
import { BOUNDS, villagePaths, onVillageChange } from '../world/village.js';
import { t, onLangChange } from '../i18n.js';
import { blips, blipScale } from './blips.js';
import { sprite } from './mapglyphs.js';
import { routeLine, pin, OUTLINE, SHARED, FOG } from './map.js';
import { accent } from './skin.js';
import { Compass, distText } from './compass.js';

const $ = id => document.getElementById(id);
export const MODES = ['fade', 'always', 'compass', 'off'];
export const miniMode = () => (MODES.includes(Settings.v.mini) ? Settings.v.mini : 'fade');
const SIZES = { s: 0.85, m: 1, l: 1.2 };
const S_MIN = 168, S_VW = 0.115, S_MAX = 232, S_VH = 0.26, S_LOW = 140, S_REF = 208;   // (the side, px: a share of the window's width, less in a low window; the scales are those of S_REF)
const PAD = 8;                 // px round the upright canvas (it turns a little between two drawings)
const BASE_K = 1.5, BASE_HZ = 8, BASE_MOVE = 4, ROUTE_MOVE = 2, BASE_ZOOM = 0.04, BASE_AGE = 1;   // (the ground's canvas, in sides; tiles moved, fewer with a route on it, change of scale and s before it is drawn again)
const OVER_HZ = 10, LIVE_HZ = 10, OVER_TURN = 2, OVER_MOVE = 0.4;                  // (and the upright one: degrees and tiles)
const FADE_S = 0.6, TEXT_S = 0.25, OVERLAY_MS = 1.5, WARM_S = 1, K_MAX = 2;
const ZOOM_S = 0.8, SCALE = { walk: 2.6, jog: 2.3, sprint: 2.0, ride: 1.9, gallop: 1.6, boat: 1.7 }, ROUTE_K = 0.9;   // (s to ease; px per tile at S_REF)
const PATH_COL = 'rgba(226, 212, 182, .5)', PATH_W = 1.9;   // (the village's paths over their pictures: a pale ribbon, its tiles wide)
const RISE = 0.85, ROOF_RISE = 0.5, FEET_MAX = 60, FEET_STEP = 8, FEET_ROOM = 10;   // (how much of a metre of wall and of roof shows, in tiles of the map; footprints drawn at most)
const DZ = 4;                  // metres over or under you before a blip says so
const TURN_DEG = 32, TURN_NEAR = 5, TURN_FAR = 160;   // (what is a turn of the route, and from and up to where it is looked for, in tiles)

// The strings: turns of a quarter of a degree, slides of half a pixel, scales of two thousandths
const STEPS = 1440, ROT = Array.from({ length: STEPS }, (_, i) => `${i / 4}deg`);
const SLIDE = 96, slides = new Array((SLIDE * 2 + 1) ** 2), scales = new Map();
const slideOf = (x, y) => { const i = Math.max(-SLIDE, Math.min(SLIDE, Math.round(x * 2))) + SLIDE, j = Math.max(-SLIDE, Math.min(SLIDE, Math.round(y * 2))) + SLIDE, k = j * (SLIDE * 2 + 1) + i; return (slides[k] ??= `${(i - SLIDE) / 2}px ${(j - SLIDE) / 2}px`); };
const scaleOf = n => { let s = scales.get(n); if (!s) scales.set(n, s = String(n / 500)); return s; };
export const stepOf = rad => ((Math.round(rad * STEPS / (2 * Math.PI)) % STEPS) + STEPS) % STEPS;
export const HEADINGS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

const CSS = `
#minimap { position: fixed; left: 16px; bottom: 16px; z-index: 4; width: var(--mm); height: calc(var(--mm) + 18px); cursor: pointer; }
body.indoors #minimap, body.mini-none #minimap { display: none; }
#minimap .mm-box { position: absolute; left: 0; top: 0; width: var(--mm); height: var(--mm); transform-origin: left bottom; transition: transform .2s cubic-bezier(.2, .8, .2, 1); }
#minimap .mm-clip { position: absolute; inset: 0; padding: 0; overflow: hidden; contain: strict; border-radius: calc(var(--mm) * .16); background: ${FOG}; box-shadow: 0 4px 14px rgba(0, 0, 0, .4); }
#minimap .mm-turn { position: absolute; left: 0; top: 0; width: 100%; height: 100%; will-change: rotate, scale; }
#minimap canvas { position: absolute; will-change: translate; }
#minimap .mm-ring { position: absolute; inset: 0; border-radius: calc(var(--mm) * .16); pointer-events: none; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .2), inset 0 0 0 2px rgba(0, 0, 0, .28), inset 0 0 calc(var(--mm) * .11) rgba(0, 0, 0, .42); }
body.ui-wood #minimap .mm-ring { box-shadow: inset 0 0 0 3px #e8c47a, inset 0 0 0 5px #3a2416, inset 0 0 calc(var(--mm) * .11) rgba(0, 0, 0, .42); }
#minimap .mm-me { position: absolute; left: 50%; top: 50%; width: 20px; height: 20px; margin: -10px 0 0 -10px; pointer-events: none; will-change: rotate; }
#minimap .mm-n { position: absolute; left: 50%; top: 50%; width: 16px; height: 16px; margin: -8px 0 0 -8px; font: 600 13px/16px var(--font-title); text-align: center; color: var(--accent); text-shadow: 0 0 2px #000, 0 0 3px #000, 0 1px 2px #000; pointer-events: none; will-change: translate; }
#minimap .mm-dist { position: absolute; left: 2px; bottom: calc(100% + 4px); font: 600 calc(18 * var(--ui-s))/1.15 var(--font-title); font-variant-numeric: tabular-nums; letter-spacing: .03em; color: var(--ink); text-shadow: var(--shadow-bare); white-space: nowrap; pointer-events: none; }
#minimap .mm-dist::before { content: ''; display: inline-block; width: 3px; height: .8em; margin-right: 6px; vertical-align: -.06em; border-radius: 1px; background: var(--accent); }
#minimap .mm-dist:empty { display: none; }
#minimap .mm-head { position: absolute; left: 0; right: 0; bottom: 0; text-align: center; font: 600 13px/16px var(--font-ui); letter-spacing: .08em; color: var(--ink); text-shadow: var(--shadow-bare); pointer-events: none; }
@media (pointer: coarse) { #minimap { top: 96px; bottom: auto; } }
`;

// A canvas the compositor turns round the middle of the map: drawn for a camera (its turn, in steps), a place and a scale, and put
// by CSS where those of now say
class Layer {
  constructor(parent) {
    this.turn = document.createElement('div');
    this.turn.className = 'mm-turn';
    this.canvas = document.createElement('canvas');
    this.turn.append(this.canvas);
    parent.append(this.turn);
    this.g = this.canvas.getContext('2d');
    this.side = 0; this.forget();
  }
  forget() { this.at = -Infinity; this.x = this.y = 0; this.yi = 0; this.a = 1; this.r = this.s = -1; this.t = ''; }
  size(side, S, k) {
    if (this.side === side && this.S === S && this.k === k) return;
    this.side = side; this.S = S; this.k = k;
    this.canvas.width = this.canvas.height = Math.round(side * k);
    const st = this.canvas.style;
    st.width = st.height = `${side}px`; st.left = st.top = `${(S - side) / 2}px`;
    this.forget();
  }
  drawn(now, x, y, yi, a) { this.at = now; this.x = x; this.y = y; this.yi = yi; this.a = a; const q = yi * 2 * Math.PI / STEPS; this.c = Math.cos(q); this.sn = Math.sin(q); }
  place(x, y, yi, a) {
    const r = (yi - this.yi + STEPS) % STEPS, s = Math.round(a / this.a * 500), dx = (nearX(x, this.x) - this.x) * this.a, dy = (y - this.y) * this.a;
    if (r !== this.r) { this.r = r; this.turn.style.rotate = ROT[r]; }
    if (s !== this.s) { this.s = s; this.turn.style.scale = scaleOf(s); }
    const tr = slideOf(-(dx * this.c - dy * this.sn), -(dx * this.sn + dy * this.c));
    if (tr !== this.t) { this.t = tr; this.canvas.style.translate = tr; }
  }
}

export class Minimap {
  constructor(game) {
    this.game = game;
    this.overlays = [];
    this.stats = { base: 0, baseMs: 0, over: 0, overMs: 0, frames: 0, frameMs: 0 };
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.append(this.style);
    const el = this.el = $('minimap');
    el.innerHTML = '<div class="mm-box"><div class="mm-clip"></div><div class="mm-ring"></div>' +
      '<svg class="mm-me" viewBox="0 0 18 18" aria-hidden="true"><path d="M9 1.6 15.4 15.6 9 12.4 2.6 15.6z" fill="#fff" stroke="#0b0d11" stroke-width="1.5" stroke-linejoin="round"/></svg><i class="mm-n"></i><b class="mm-dist"></b></div><span class="mm-head"></span>';
    const q = c => el.querySelector(c);
    this.box = q('.mm-box'); this.me = q('.mm-me'); this.n = q('.mm-n'); this.dist = q('.mm-dist'); this.head = q('.mm-head');
    this.base = new Layer(q('.mm-clip'));
    this.over = new Layer(q('.mm-clip'));
    this.compass = new Compass(game, this);
    this.a = SCALE.walk; this.last = null; this.shown = false; this.mode = '';
    this.plain = new Map();   // ("cx,cy" → the colour of a chunk whose picture has not come yet)
    this.paths = null; onVillageChange(() => { this.paths = null; });
    this.feet = []; this.feetAt = null; this.nPos = [];
    this.now = 0; this.textAt = this.warmAt = this.zAt = this.wantAt = -Infinity; this.force = true;
    this.texts();
    this.offLang = onLangChange(() => this.texts());
    addEventListener('resize', () => { this.S = 0; });   // (measured again at the next frame: by the window's width, not the page)
  }
  texts() { this.n.textContent = t('minimap.heading.n'); this.hi = -1; this.textAt = -Infinity; this.distKey = null; this.compass.texts(); }
  kick() { this.force = true; }
  // How big it is, for this window (and the size setting, once there is one)
  measure() {
    const S = Math.round(Math.max(S_LOW, Math.min(S_MAX, Math.max(S_MIN, innerWidth * S_VW), innerHeight * S_VH)) * (SIZES[Settings.v.miniSize] || 1) / 2) * 2, k = Math.max(1, Math.min(K_MAX, devicePixelRatio || 1));
    this.S = S; this.k = k; this.sizeKey = Settings.v.miniSize; this.blipKey = Settings.v.blipSize;
    document.documentElement.style.setProperty('--mm', `${S}px`);
    this.base.size(Math.round(S * BASE_K / 2) * 2, S, k);
    this.over.size(S + PAD * 2, S, k);
    this.nPos = []; this.nAt = -1;
    this.D = Math.round(Math.max(15, Math.min(20, Math.round(S * 0.0865))) * blipScale());
    this.force = true;
  }
  // Where the direction (ux, uy) from the middle meets the rim (a rounded square), inset px inside it: [x, y] from the middle
  rim(ux, uy, inset) {
    const h = this.S / 2 - inset, r = Math.max(0, this.S * 0.16 - inset), t = Math.min(h / (Math.abs(ux) || 1e-9), h / (Math.abs(uy) || 1e-9));
    let x = ux * t, y = uy * t;
    const c = h - r;
    if (Math.abs(x) > c && Math.abs(y) > c) {   // (in a corner: where it meets its arc)
      const cx = Math.sign(x) * c, cy = Math.sign(y) * c, b = ux * cx + uy * cy, q = b + Math.sqrt(Math.max(0, b * b - (cx * cx + cy * cy - r * r)));
      x = ux * q; y = uy * q;
    }
    return [x, y];
  }
  inside(x, y, inset) {
    const h = this.S / 2 - inset, r = Math.max(0, this.S * 0.16 - inset), ax = Math.abs(x), ay = Math.abs(y), c = h - r;
    return ax <= h && ay <= h && !(ax > c && ay > c && Math.hypot(ax - c, ay - c) > r);
  }
  // The scale it goes to: the faster you go, the more land
  wanted() {
    const g = this.game, p = g.player, go = Math.hypot(p.vx || 0, p.vy || 0) > 0.5;
    const s = p.boat || p.aboard ? SCALE.boat : p.mount ? (g.horse?.galloping ? SCALE.gallop : SCALE.ride) : go && p.gait === 2 ? SCALE.sprint : go && p.gait === 1 ? SCALE.jog : SCALE.walk;
    return s * (g.route?.active ? ROUTE_K : 1) * this.S / S_REF;
  }
  get heading() { return ((-CAM.yaw * 180 / Math.PI) % 360 + 360) % 360; }

  // ---------- each frame (game.render) ----------
  frame() {
    const g = this.game, p = g.player, now = performance.now() / 1000, mode = miniMode();
    if (!p || !g.world) return;
    const dt = Math.min(0.25, Math.max(0, now - (this.last ?? now)));
    this.last = now; this.now = now; g.map.now = now;
    if (mode !== this.mode) { this.mode = mode; document.body.classList.toggle('mini-none', mode === 'compass' || mode === 'off'); document.body.classList.toggle('mini-compass', mode === 'compass'); this.force = true; }
    if (!this.S || this.sizeKey !== Settings.v.miniSize || this.blipKey !== Settings.v.blipSize) this.measure();
    const outside = !g.indoors && g.scene === g.world, play = g.mode === 'play';
    // (it goes on while it fades away)
    if (!g.smartHud || g.smartHud.mini !== false) this.wantAt = now;
    const want = play && now - this.wantAt < FADE_S, on = want && outside && (mode === 'fade' || mode === 'always');
    this.compass.frame(now, play && mode === 'compass' && (g.smartHud ? !!g.smartHud.mini : true));
    if (on !== this.shown) { this.shown = on; if (on) this.force = true; }
    const w = this.wanted();
    this.a = on ? this.a + (w - this.a) * (1 - Math.exp(-dt / ZOOM_S)) : w;
    if (Math.abs(this.a - w) < 0.002) this.a = w;
    if (!on) { if (outside && play && mode !== 'off') this.warm(); return; }
    const t0 = performance.now(), yi = stepOf(CAM.yaw);
    this.groundTurn(now, yi);
    this.overTurn(now, yi);
    this.force = false;
    this.base.place(p.x, p.y, yi, this.a);
    this.over.place(p.x, p.y, yi, this.a);
    // The N on the rim, and you
    if (yi !== this.nAt) {
      this.nAt = yi;
      let s = this.nPos[yi];
      if (!s) { const q = yi * 2 * Math.PI / STEPS, [x, y] = this.rim(Math.sin(q), -Math.cos(q), 11); s = this.nPos[yi] = `${x.toFixed(1)}px ${y.toFixed(1)}px`; }
      this.n.style.translate = s;
      const hi = ((Math.round(-yi * 8 / STEPS) % 8) + 8) % 8;
      if (hi !== this.hi) { this.hi = hi; this.head.textContent = t(`minimap.heading.${HEADINGS[hi]}`); }
    }
    const f = p.face, fi = CAM.first || !f ? 0 : (stepOf(Math.atan2(f.x, -f.y)) + yi) % STEPS;
    if (fi !== this.fi) { this.fi = fi; this.me.style.rotate = ROT[fi]; }
    if (now - this.textAt >= TEXT_S) { this.textAt = now; this.distance(); }
    this.stats.frames++; this.stats.frameMs += performance.now() - t0;
  }
  // How far what you go to is, over the map: the route's end along its way, or where a first step sends you
  distance() {
    const g = this.game, R = g.route, G = g.map.goal, p = g.player, d = R?.active ? R.left() : G ? Math.hypot(nearX(G.x, p.x) - p.x, G.y - p.y) : -1;
    const key = d < 0 ? null : d < 1000 ? Math.round(d) : Math.round(d / 100) * 100;
    if (key === this.distKey) return;
    this.distKey = key;
    this.dist.textContent = key === null ? '' : distText(key);
  }

  // ---------- the ground ----------
  groundTurn(now, yi) {
    const g = this.game, B = this.base, M = g.map, p = g.player, R = g.route;
    const moved = Math.hypot(nearX(p.x, B.x) - B.x, p.y - B.y), v = M.tiles.v + M.built.v * 1e6 + M.thumbs.size;
    const rk = R?.shown ? R.version : -1;
    const due = this.force || moved > (R?.shown ? ROUTE_MOVE : BASE_MOVE) || Math.abs(this.a / B.a - 1) > BASE_ZOOM || v !== this.baseV || M.built.pending || rk !== this.baseRoute || accent.v !== this.baseAcc || now - B.at > BASE_AGE || g.world !== this.baseWorld;
    if (!due || (!this.force && now - B.at < 1 / BASE_HZ)) return;
    const t0 = performance.now();
    this.drawGround();
    B.drawn(now, p.x, p.y, 0, this.a);
    this.baseV = M.tiles.v + M.built.v * 1e6 + M.thumbs.size; this.baseRoute = rk; this.baseAcc = accent.v; this.baseWorld = g.world;
    this.stats.base++; this.stats.baseMs += performance.now() - t0;
  }
  // The explored chunks that fall on the ground's canvas, centred on the player: fn(cx (not wrapped), cy, kx (wrapped), how far, key)
  inSight(fn) {
    const g = this.game, p = g.player, half = this.base.side / 2 / this.a, x0 = Math.floor((p.x - half) / CHUNK), x1 = Math.floor((p.x + half) / CHUNK), y0 = Math.floor((p.y - half) / CHUNK), y1 = Math.floor((p.y + half) / CHUNK);
    const px = p.x / CHUNK - 0.5, py = p.y / CHUNK - 0.5, far = this.S * 0.72 / this.a / CHUNK + 0.75;
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const d = Math.hypot(cx - px, cy - py);
      if (d > far) continue;   // (the corners that never come into sight)
      const kx = wrapIndex(cx, CHUNK), key = `${kx},${cy}`;
      if (g.explored.has(key)) fn(cx, cy, kx, d, key);
    }
  }
  drawGround() {
    const G = this.game, M = G.map, p = G.player, gen = G.world.gen, B = this.base, g = B.g, k = B.k, a = this.a, n = B.side, sat = M.tiles.ready, e = n / 2 - a * p.x, f = n / 2 - a * p.y;
    g.setTransform(k, 0, 0, k, 0, 0);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'low';
    g.fillStyle = FOG; g.fillRect(0, 0, n, n);
    M.built.begin(OVERLAY_MS);
    // (each chunk from and to whole device px: no joints between two)
    const at = v => Math.round(v * k) / k, over = [];
    this.inSight((cx, cy, kx, d, key) => {
      const x = at(e + cx * CHUNK * a), y = at(f + cy * CHUNK * a), w = at(e + (cx + 1) * CHUNK * a) - x, h = at(f + (cy + 1) * CHUNK * a) - y;
      const pic = sat ? M.tiles.tile(gen, kx, cy, gen.season, d, key) || M.tiles.have('thumb', kx, cy) : M.thumb(gen, key);
      if (pic) g.drawImage(pic, x, y, w, h);
      else { g.fillStyle = this.plainOf(gen, kx, cy, key); g.fillRect(x, y, w, h); }   // (known land is never black while its picture comes)
      const b = sat && M.built.picture(kx, cy, key);
      if (b) over.push(b, x, y, w, h);
    });
    for (let i = 0; i < over.length; i += 5) g.drawImage(over[i], over[i + 1], over[i + 2], over[i + 3], over[i + 4]);
    this.pathLines(g, gen, e, f, a, k);
    if (gen.roads) { const R = n / 2 / a; M.roadLines.flat(g, gen, [p.x - R, p.y - R, p.x + R, p.y + R], off => g.setTransform(k * a, 0, 0, k * a, k * (e + a * off), k * f), a); g.setTransform(k, 0, 0, k, 0, 0); }
    const half = n / 2 / a, fx = Math.floor(p.x - half), fy = Math.floor(p.y - half), side = Math.ceil(half * 2) + 2;
    M.floodOver(g, G.explored, fx, fy, side, side, a, e + fx * a, f + fy * a);
    const R = G.route;
    if (R?.shown) routeLine(g, R.pts, R.kinds, R.seg, (x, y, o) => { o[0] = e + a * nearX(x, p.x); o[1] = f + a * y; }, 3.6);
  }
  plainOf(gen, cx, cy, key) {
    if (this.plainGen !== gen) { this.plainGen = gen; this.plain.clear(); }
    let c = this.plain.get(key);
    if (!c) { if (this.plain.size > 4000) this.plain.clear(); const q = BIOMES[gen.biomeAt((cx + 0.5) * CHUNK, (cy + 0.5) * CHUNK)].rgb[1]; this.plain.set(key, c = `rgb(${q.join(',')})`); }
    return c;
  }
  // The village's paths, where explored: their line in tiles is made once (and again when something is explored or built)
  pathLines(g, gen, e, f, a, k) {
    const G = this.game, p = G.player, R = this.base.side / 2 / a;
    if (nearX(BOUNDS.x0, p.x) > p.x + R || nearX(BOUNDS.x1, p.x) < p.x - R || BOUNDS.y0 > p.y + R || BOUNDS.y1 < p.y - R) return;
    if (!this.paths || this.pathsN !== G.explored.size || this.pathsGen !== gen) {
      this.pathsN = G.explored.size; this.pathsGen = gen;
      const P = this.paths = new Path2D(), seen = (x, y) => G.explored.has(`${wrapIndex(Math.floor(x / CHUNK), CHUNK)},${Math.floor(y / CHUNK)}`);
      for (const line of villagePaths()) {
        let on = false;
        for (let i = 0; i + 1 < line.length; i++) {
          const [ax, ay] = line[i], [bx, by] = line[i + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
          for (let j = i ? 1 : 0; j <= n; j++) { const x = ax + (bx - ax) * j / n, y = ay + (by - ay) * j / n; if (!seen(x, y)) { on = false; continue; } if (on) P.lineTo(x, y); else { P.moveTo(x, y); on = true; } }
        }
      }
    }
    g.setTransform(k * a, 0, 0, k * a, k * (e + a * (nearX(BOUNDS.x0, p.x) - BOUNDS.x0)), k * f);
    g.lineJoin = g.lineCap = 'round'; g.lineWidth = PATH_W; g.strokeStyle = PATH_COL; g.stroke(this.paths);
    g.setTransform(k, 0, 0, k, 0, 0);
  }
  // While it is hidden, once a second: ask for the pictures it would draw, so it is whole when it comes back
  warm() {
    if (this.now - this.warmAt < WARM_S || !this.S) return;
    this.warmAt = this.now;
    const M = this.game.map, gen = this.game.world.gen;
    this.inSight((cx, cy, kx, d, key) => { if (M.tiles.ready) M.tiles.tile(gen, kx, cy, gen.season, d, key); else M.thumb(gen, key); });
  }

  // ---------- what stands upright ----------
  overTurn(now, yi) {
    const g = this.game, O = this.over, p = g.player, list = blips.refresh(g, now);
    const turn = Math.abs(((yi - O.yi + STEPS * 1.5) % STEPS) - STEPS / 2) * 360 / STEPS, moved = Math.hypot(nearX(p.x, O.x) - O.x, p.y - O.y);
    let live = false;
    for (const o of this.overlays) live ||= !!o.live?.();
    const sig = g.route?.shown ? g.route.version : -1;
    const due = this.force || turn > OVER_TURN || moved > OVER_MOVE || blips.v !== this.overV || Math.abs(this.a / O.a - 1) > 0.01 || sig !== this.overRoute || live !== this.overLive || this.feetDue(p) || accent.v !== this.overAcc || (live && now - O.at > 1 / LIVE_HZ);
    if (!due || (!this.force && now - O.at < 1 / OVER_HZ)) return;
    const t0 = performance.now();
    O.drawn(now, p.x, p.y, yi, this.a);
    this.overV = blips.v; this.overLive = live; this.overRoute = sig; this.overAcc = accent.v;
    this.drawUpright(list);
    this.stats.over++; this.stats.overMs += performance.now() - t0;
  }
  drawUpright(list) {
    const G = this.game, p = G.player, O = this.over, g = O.g, k = O.k, S = this.S, a = O.a, c = O.c, s = O.sn, D = this.D, R = G.route;
    g.setTransform(k, 0, 0, k, 0, 0);
    g.clearRect(0, 0, O.side, O.side);
    // (from here on, the middle of the map is 0,0)
    g.translate(O.side / 2, O.side / 2);
    const px = (x, y) => { const dx = (nearX(x, p.x) - p.x) * a, dy = (y - p.y) * a; this.qx = dx * c - dy * s; this.qy = dx * s + dy * c; };
    this.houses(g, px, a, c, s);
    for (const f of this.overlays) f(g, (x, y) => { px(x, y); return [this.qx, this.qy]; }, [p.x, p.y], a, this);
    // What there is (blips.js), the important on top; a tracked one is held on the rim while it is farther
    const shown = [];
    this.heights(list);
    for (const b of list) {
      if (!b.mini || !blips.shown(b) || (b.pin === 'route' && !R?.shown) || (b.pin === 'shared' && !R?.outside)) continue;
      px(b.x, b.y);
      let x = this.qx, y = this.qy;
      if (b.r) {   // (an area: a dashed ring on the ground)
        const r = b.r * a;
        if (Math.abs(x) > S / 2 + r || Math.abs(y) > S / 2 + r) continue;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
        g.globalAlpha = 0.12; g.fillStyle = b.color; g.fill(); g.globalAlpha = 0.85; g.setLineDash([4, 3]); g.lineWidth = 1.5; g.strokeStyle = b.color; g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
        if (!b.track) continue;
      }
      let out = 0;
      if (b.track && !this.inside(x, y, D / 2 + 6)) {
        const l = Math.hypot(x, y) || 1, q = this.rim(x / l, y / l, D / 2 + 6);
        out = Math.atan2(y, x); x = q[0]; y = q[1];
        if (!out) out = 1e-6;
      } else if (!this.inside(x, y, -D / 2)) continue;
      if (!b.track && !b.pin && shown.some(q => Math.hypot(q[0] - x, q[1] - y) < 10)) continue;
      shown.push([x, y, b, out]);
    }
    // (the notch on the rim toward the next turn of the route, under them)
    if (R?.shown) this.notch(g, px);
    for (let i = shown.length - 1; i >= 0; i--) {
      const [x, y, b, out] = shown[i];
      if (out) this.chevron(g, x, y, out, b.color, D);
      if (!out && b.pin) { pin(g, x, y, b.pin === 'route' ? 6 : 5, b.pin === 'route' ? b.color : SHARED); continue; }
      if (!out && b.kind === 'goal') {   // (where a first step sends you: a diamond)
        g.beginPath(); g.moveTo(x, y - 8); g.lineTo(x + 6.5, y); g.lineTo(x, y + 8); g.lineTo(x - 6.5, y); g.closePath();
        g.lineJoin = 'round'; g.lineWidth = 2.5; g.strokeStyle = OUTLINE; g.stroke(); g.fillStyle = b.color; g.fill();
        continue;
      }
      const d = b.small ? Math.round(D * 0.8) : D, n = d + 2;
      g.drawImage(sprite(b.glyph, b.color, d, k, b.dim), x - n / 2, y - n / 2, n, n);
      const dz = this.dz.get(b);
      if (dz) this.height(g, x + (x > S / 2 - D * 1.4 ? -1 : 1) * (D / 2 + 4), y, dz > 0);
    }
  }
  // The houses: each footprint with its walls (the faces toward you) and its roof shifted up the screen, as if the map leaned back.
  // The far ones first. Their list is made again only when you have moved a good stretch or something was built
  feetDue(p) { const G = this.game, F = this.feetAt; return !F || F.w !== G.world || F.v !== G.map.built.v || F.n !== G.explored.size || F.f !== (G.places?.found?.size || 0) || F.a > this.a * 1.12 || Math.abs(nearX(p.x, F.x) - F.x) > FEET_STEP || Math.abs(p.y - F.y) > FEET_STEP; }
  houses(g, px, a, c, s) {
    const G = this.game, M = G.map, p = G.player;
    if (this.feetDue(p)) {
      const r = this.S * 0.72 / a * 1.12 + FEET_ROOM;   // (what is not made yet, with what the ground's drawing left of its time: once made, built.v goes up)
      const seen = (x, y) => G.explored.has(`${wrapIndex(Math.floor(x / CHUNK), CHUNK)},${Math.floor(y / CHUNK)}`);
      const F = M.tiles.ready ? M.built.footprints(p.x - r, p.y - r, p.x + r, p.y + r) : [];
      for (const q of blips.list) if (q.kind === 'place' && q.glyph === 'tower') { const x = nearX(q.x, p.x); F.push({ x0: x - TOWER.R, y0: q.y - TOWER.R, x1: x + TOWER.R, y1: q.y + TOWER.R, h: TOWER.H * 0.8, color: 'rgb(150,146,136)', flat: true }); }
      this.feet = F.filter(q => seen(q.x0 + 0.1, q.y0 + 0.1) && seen(q.x1 - 0.1, q.y0 + 0.1) && seen(q.x0 + 0.1, q.y1 - 0.1) && seen(q.x1 - 0.1, q.y1 - 0.1))
        .sort((u, v) => Math.hypot((u.x0 + u.x1) / 2 - p.x, (u.y0 + u.y1) / 2 - p.y) - Math.hypot((v.x0 + v.x1) / 2 - p.x, (v.y0 + v.y1) / 2 - p.y)).slice(0, FEET_MAX);
      this.feetAt = { w: G.world, v: M.built.v, n: G.explored.size, f: G.places?.found?.size || 0, a, x: p.x, y: p.y };
    }
    const H = this.S / 2 + 14, list = this.drawList ||= [];
    list.length = 0;
    for (const q of this.feet) {
      px((q.x0 + q.x1) / 2, (q.y0 + q.y1) / 2);
      if (Math.abs(this.qx) > H + (q.x1 - q.x0 + q.y1 - q.y0) * a / 2 || Math.abs(this.qy) > H + (q.x1 - q.x0 + q.y1 - q.y0) * a / 2) continue;
      q.sy = this.qy;
      list.push(q);
    }
    list.sort((u, v) => u.sy - v.sy);
    for (const q of list) this.house(g, px, q, a, c, s);
  }
  house(g, px, q, a, c, s) {
    const P = this.pts ||= new Float64Array(12), col = shades(q.color), up = q.h * RISE * a;
    const put = (i, x, y) => { px(x, y); P[i * 2] = this.qx; P[i * 2 + 1] = this.qy; };
    put(0, q.x0, q.y0); put(1, q.x1, q.y0); put(2, q.x1, q.y1); put(3, q.x0, q.y1);
    // (the walls that face you: those whose outward side points down the screen. North, east, south, west)
    for (let i = 0; i < 4; i++) {
      const ny = i === 0 ? -c : i === 1 ? s : i === 2 ? c : -s;
      if (ny <= 0.01) continue;
      const j = (i + 1) % 4;
      g.beginPath(); g.moveTo(P[i * 2], P[i * 2 + 1] + 0.4); g.lineTo(P[j * 2], P[j * 2 + 1] + 0.4); g.lineTo(P[j * 2], P[j * 2 + 1] - up); g.lineTo(P[i * 2], P[i * 2 + 1] - up); g.closePath();
      g.fillStyle = col.wall[i]; g.fill();
    }
    const face = (f, ...ix) => { g.beginPath(); for (let n = 0; n < ix.length; n++) { const i = ix[n], y = P[i * 2 + 1] - up - (i > 3 ? rise : 0); if (n) g.lineTo(P[i * 2], y); else g.moveTo(P[i * 2], y); } g.closePath(); g.fillStyle = f; g.fill(); };
    let rise = 0;
    if (q.flat) { face(col.roof[2], 0, 1, 2, 3); g.lineWidth = 1; g.strokeStyle = col.wall[1]; g.stroke(); return; }
    // (the roof: two slopes and two ends, meeting along the longer side; the ones that look away first)
    const w = q.x1 - q.x0, h = q.y1 - q.y0, m = Math.min(w, h) / 2, alongX = w >= h, in_ = m * 0.45;
    rise = m * ROOF_RISE * a;
    if (alongX) { put(4, q.x0 + in_, (q.y0 + q.y1) / 2); put(5, q.x1 - in_, (q.y0 + q.y1) / 2); } else { put(4, (q.x0 + q.x1) / 2, q.y0 + in_); put(5, (q.x0 + q.x1) / 2, q.y1 - in_); }
    const F = alongX ? [[0, 0, 1, 5, 4], [1, 1, 2, 5], [2, 2, 3, 4, 5], [3, 3, 0, 4]] : [[0, 0, 1, 4], [1, 1, 2, 5, 4], [2, 2, 3, 5], [3, 3, 0, 4, 5]];
    for (let pass = 0; pass < 2; pass++) for (const [i, ...ix] of F) {
      const ny = i === 0 ? -c : i === 1 ? s : i === 2 ? c : -s;
      if ((ny > 0) === !!pass) face(col.roof[i], ...ix);
    }
  }
  // How much higher or lower than you each blip near the map is (asked for with the blips, at most four times a second)
  heights(list) {
    const G = this.game, w = G.world, p = G.player, D = this.dz ||= new Map(), far = this.S * 0.8 / this.a;
    if (this.now - this.zAt < TEXT_S && this.zV === blips.v) return;
    this.zAt = this.now; this.zV = blips.v;
    D.clear();
    const me = w.surfaceAt(p.x, p.y) + (p.z || 0);
    for (const b of list) {
      if (!b.mini || b.r || b.kind === 'goal' || Math.hypot(nearX(b.x, p.x) - p.x, b.y - p.y) > far) continue;
      const d = w.surfaceAt(wrapX(b.x), b.y) + (b.z || 0) - me;
      if (Math.abs(d) > DZ) D.set(b, d);
    }
  }
  height(g, x, y, up) {
    const d = up ? -1 : 1;
    g.beginPath(); g.moveTo(x - 3.5, y - d * 2.2); g.lineTo(x + 3.5, y - d * 2.2); g.lineTo(x, y + d * 2.8); g.closePath();
    g.lineJoin = 'round'; g.lineWidth = 2; g.strokeStyle = 'rgba(10, 12, 16, .9)'; g.stroke(); g.fillStyle = '#fff'; g.fill();
  }
  // Out of the rim, past a blip held on it
  chevron(g, x, y, ang, col, D) {
    const r = D / 2 + 1.5, ux = Math.cos(ang), uy = Math.sin(ang);
    g.beginPath(); g.moveTo(x + ux * (r + 4.5), y + uy * (r + 4.5)); g.lineTo(x + ux * r - uy * 4, y + uy * r + ux * 4); g.lineTo(x + ux * r + uy * 4, y + uy * r - ux * 4); g.closePath();
    g.lineJoin = 'round'; g.lineWidth = 2; g.strokeStyle = 'rgba(10, 12, 16, .9)'; g.stroke(); g.fillStyle = col; g.fill();
  }
  // The next turn of the route: where, from here along it, its way leaves the one it has now (or its end)
  nextTurn() {
    const R = this.game.route, p = this.game.player, P = R.pts, n = P.length >> 1, o = this.turnAt ||= [0, 0];
    if (n < 2) { o[0] = R.target.x; o[1] = R.target.y; return o; }
    let x = p.x, y = p.y, left = 0, dir = null;
    for (let i = Math.min(R.seg + 1, n - 1); i < n; i++) {
      const qx = nearX(P[i * 2], x), qy = P[i * 2 + 1], d = Math.hypot(qx - x, qy - y);
      if (left >= TURN_NEAR && d > 1e-6) {
        const way = Math.atan2(qy - y, qx - x);
        if (dir === null) dir = Math.atan2(y - p.y, x - p.x);
        if (Math.abs(Math.atan2(Math.sin(way - dir), Math.cos(way - dir))) * 180 / Math.PI > TURN_DEG) break;
      }
      left += d; x = qx; y = qy;
      if (left > TURN_FAR) break;
    }
    o[0] = x; o[1] = y;
    return o;
  }
  notch(g, px) {
    const q = this.nextTurn();
    px(q[0], q[1]);
    const l = Math.hypot(this.qx, this.qy);
    if (l < 6) return;
    const ux = this.qx / l, uy = this.qy / l, [x, y] = this.rim(ux, uy, 1);
    g.beginPath(); g.moveTo(x - ux * 8, y - uy * 8); g.lineTo(x - uy * 7, y + ux * 7); g.lineTo(x + uy * 7, y - ux * 7); g.closePath();
    g.lineJoin = 'round'; g.lineWidth = 2.5; g.strokeStyle = OUTLINE; g.stroke(); g.fillStyle = accent.route; g.fill();
  }
}
// The colours of a house's faces (north, east, south, west) from its roof's: lit from the north-west, as the land
const tones = new Map();
function shades(css) {
  let v = tones.get(css);
  if (v) return v;
  const c = css.match(/\d+/g).map(Number), by = k => `rgb(${c.map(q => Math.min(255, Math.round(q * k))).join(',')})`;
  tones.set(css, v = { wall: [by(0.72), by(0.52), by(0.5), by(0.72)], roof: [by(1.12), by(0.86), by(0.82), by(1.16)] });
  return v;
}
