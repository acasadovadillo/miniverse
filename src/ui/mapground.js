// The land of the big map (docs/planes/realismo/PLAN-R8-hud-mapa.md §3.8), on a canvas of its own with some chunks to spare on
// each side of the screen: moving the map or stepping the zoom draws that one image, and only what comes into sight (or changed)
// is painted. Each explored chunk is painted once, from its satellite picture (while it comes, and at the widest zooms, the one of
// 1 px per tile: sattiles.js) with what was built on top (mapoverlay.js), and again only when one of them is another; so what has
// been painted no longer needs its picture, however many chunks are in sight. The unexplored ones stay see-through.
//
//   ground.draw(g, view)     view: { gen, explored, cx, cy (the middle), a (px per tile), w, h, r (device px per px), to, tx, ty }:
//                            the scale and the middle it is going to while the zoom eases (zooming in, nothing is made again
//                            until it is there; zooming out, the wider one is made first)
// The texture of the 3D map (three/map3d.js) is another of these: it says where the chunks go (put) and which are on it.
//
//   ground.busy              there is more to paint, or to look at, in the next frames;  ground.free(): the map was closed
import { CHUNK } from '../world/gen.js';
import { BIOMES } from '../world/biomes.js';
import { wrapIndex } from '../world/planet.js';

const SPARE = 3, SPARE_PX = 112, MAX_PX = 6e6;    // (chunks to spare on each side, or these px of the screen; the canvas is never over this many px)
const FRESH_MS = 5, FIRST_MS = 14, SCAN_MS = 2;  // (ms a frame may spend painting what came into sight, the first one after another zoom, and looking at what changed)
const OVERLAY_MS = 5, SCAN_S = 1.2;                // (ms making the pictures of what is built; s between two looks with nothing new)
const FINE = 2, FINE_MAX = [800, 950];             // (px per tile from which the satellite pictures are used, if no more chunks than these are in sight: to begin, to go on)
const WANT_MAX = 1200;                             // (pictures asked for at once: the rest, as they come)

export class MapGround {
  // view: the MapView (its tiles, built, thumb)
  constructor(view) {
    this.view = view;
    this.pic = document.createElement('canvas'); this.pic.width = this.pic.height = 1;
    this.g = this.pic.getContext('2d');
    this.B = null;         // what is on the canvas: { gen, sat, fine, b (px per tile), x0, y0 (first chunk, x not wrapped), nx, ny, explored, n, season }
    this.cells = [];       // its explored chunks: { i, j, kx, ky, key, src, best, ov, sig, vb, done, under }
    this.fresh = []; this.budget = 0;
    this.scanAt = 0; this.scanFrom = -1; this.sign = '';
    this.stats = { made: 0, moved: 0, painted: 0, scans: 0 };
  }
  free() { this.pic.width = this.pic.height = 1; this.B = null; this.cells = []; this.fresh = []; this.scanFrom = -1; }
  get busy() { return this.fresh.length > 0 || this.scanFrom >= 0; }
  get bytes() { return this.pic.width * this.pic.height * 4; }

  draw(g, { gen, explored, cx, cy, a, w, h, r, to = a, tx = cx, ty = cy }) {
    const resting = to === a;
    if (resting || to < a || !this.B || this.B.gen !== gen) this.fit(gen, explored, resting || to < a ? tx : cx, resting || to < a ? ty : cy, to < a ? to : a, w, h, r, resting);
    const B = this.B, S = CHUNK * a;
    this.paintFresh(gen);
    if (resting) this.scan(gen);
    const x = w / 2 + (B.x0 * CHUNK - cx) * a, y = h / 2 + (B.y0 * CHUNK - cy) * a;
    g.imageSmoothingEnabled = B.sat || a < 1; g.imageSmoothingQuality = 'medium';
    // (its px are the screen's: on whole ones, nothing blurred. Else, only the part in sight)
    if (resting && Math.abs(a * r - B.b) < 1e-6) { g.drawImage(this.pic, Math.round(x * r) / r, Math.round(y * r) / r, B.nx * S, B.ny * S); return; }
    const k = B.b / a, sx = Math.max(0, -x), sy = Math.max(0, -y), sw = Math.min(B.nx * S, w - x) - sx, sh = Math.min(B.ny * S, h - y) - sy;
    if (sw > 0 && sh > 0) g.drawImage(this.pic, sx * k, sy * k, sw * k, sh * k, x + sx, y + sy, sw, sh);
  }

  // The canvas for this view: the same one, the same moved (what it had is kept), or another
  fit(gen, explored, cx, cy, a, w, h, r, resting) {
    const sat = this.view.tiles.ready, B = this.B, fine = sat && a >= FINE && this.fits(explored, cx, cy, a, w, h);
    const spare = Math.max(SPARE, Math.ceil(SPARE_PX / a / CHUNK)), nx = Math.ceil(w / a / CHUNK) + 1 + spare * 2, ny = Math.ceil(h / a / CHUNK) + 1 + spare * 2;
    // (px per tile of the canvas: the screen's, up to the pictures' own; a power of two, so that a chunk is whole px)
    let b = 0.5;
    while (b < (fine ? 4 : 1) && b < a * r - 1e-6) b *= 2;
    while (b > 0.5 && nx * ny * (CHUNK * b) ** 2 > MAX_PX) b /= 2;
    const px = Math.floor(cx / CHUNK), py = Math.floor(cy / CHUNK), x0 = px - (nx >> 1), y0 = py - (ny >> 1);
    if (!B || B.gen !== gen || B.sat !== sat || B.fine !== fine || B.b !== b || B.nx !== nx || B.ny !== ny || B.explored !== explored || B.season !== gen.season) { this.remake({ gen, sat, fine, b, x0, y0, nx, ny, explored, n: -1, season: gen.season }); return; }
    // (moved: when the screen comes to its edge; while the zoom eases, only once out of it)
    const hx = w / a / CHUNK / 2 + (resting ? 0.5 : -1), hy = h / a / CHUNK / 2 + (resting ? 0.5 : -1), mx = cx / CHUNK - B.x0, my = cy / CHUNK - B.y0;
    if (mx - hx < 0 || my - hy < 0 || mx + hx > nx || my + hy > ny) this.move(x0, y0);
    else if (B.n !== explored.size) this.list(FRESH_MS);
  }
  // Whether the chunks in sight are few enough for the satellite pictures (they are all kept: sattiles.js TILES). Asked again when the
  // view has moved some chunks
  fits(explored, cx, cy, a, w, h) {
    const x0 = Math.floor((cx - w / 2 / a) / CHUNK), y0 = Math.floor((cy - h / 2 / a) / CHUNK), nx = Math.ceil(w / a / CHUNK) + 1, ny = Math.ceil(h / a / CHUNK) + 1;
    if (nx * ny <= FINE_MAX[0]) return true;
    const key = `${a}|${x0 >> 1},${y0 >> 1}|${explored.size}|${nx},${ny}`;
    if (key !== this.fitKey) {
      this.fitKey = key;
      let n = 0;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (explored.has(`${wrapIndex(x0 + i, CHUNK)},${y0 + j}`)) n++;
      this.fit1 = n <= FINE_MAX[this.B?.fine ? 1 : 0];
    }
    return this.fit1;
  }
  // Another canvas, with what the last one had, stretched to it, until each chunk is painted
  remake(N) {
    const was = this.B, old = this.pic, s = CHUNK * N.b, pic = document.createElement('canvas'), under = new Set();
    pic.width = N.nx * s; pic.height = N.ny * s;
    const g = pic.getContext('2d');
    if (was && was.gen === N.gen && was.explored === N.explored) {
      g.imageSmoothingQuality = 'medium'; g.imageSmoothingEnabled = N.sat;
      g.drawImage(old, (was.x0 - N.x0) * s, (was.y0 - N.y0) * s, was.nx * s, was.ny * s);
      for (const q of this.cells) if (q.src || q.under) under.add(q.key);
    }
    old.width = old.height = 1;   // (its memory, now)
    this.pic = pic; this.g = g; this.B = N; this.cells = []; this.fresh = []; this.under = under; this.scanFrom = -1;
    this.stats.made++;
    this.list(FIRST_MS);
    this.cells = this.fresh.slice().reverse();   // (the middle first, here too)
  }
  move(x0, y0) {
    const B = this.B, s = CHUNK * B.b, g = this.g, dx = B.x0 - x0, dy = B.y0 - y0, far = Math.abs(dx) >= B.nx || Math.abs(dy) >= B.ny, kept = [];
    B.x0 = x0; B.y0 = y0;
    if (far) g.clearRect(0, 0, this.pic.width, this.pic.height);
    else {
      g.save(); g.globalCompositeOperation = 'copy'; g.drawImage(this.pic, dx * s, dy * s); g.restore();
      for (const q of this.cells) { q.i += dx; q.j += dy; if (q.i >= 0 && q.j >= 0 && q.i < B.nx && q.j < B.ny) kept.push(q); }
    }
    this.cells = kept; this.under = null;
    this.stats.moved++;
    this.list(far ? FIRST_MS : FRESH_MS);
  }
  // The explored chunks on it: those that are new, to paint (from the end: those in the middle first)
  list(ms) {
    const B = this.B, have = new Uint8Array(B.nx * B.ny), mx = B.nx / 2, my = B.ny / 2;
    for (const q of this.cells) have[q.j * B.nx + q.i] = 1;
    this.fresh = this.fresh.filter(q => !q.done && q.i >= 0 && q.j >= 0 && q.i < B.nx && q.j < B.ny);
    for (let j = 0; j < B.ny; j++) for (let i = 0; i < B.nx; i++) {
      if (have[j * B.nx + i]) continue;
      const kx = wrapIndex(B.x0 + i, CHUNK), ky = B.y0 + j, key = `${kx},${ky}`;
      if (!B.explored.has(key)) continue;
      const q = { i, j, kx, ky, key, src: null, best: false, ov: null, sig: NaN, vb: null, done: false, under: !!this.under?.has(key) };
      this.cells.push(q); this.fresh.push(q);
    }
    this.under = null;
    const far = q => (q.i - mx) ** 2 + (q.j - my) ** 2;
    this.fresh.sort((p, q) => far(q) - far(p));
    B.n = B.explored.size;
    this.budget = Math.max(this.budget, ms);
  }
  paintFresh(gen) {
    if (!this.fresh.length) return;
    const t0 = performance.now(), ms = this.budget || FRESH_MS;
    this.budget = 0;
    this.view.built.begin(OVERLAY_MS);
    for (let n = 1; this.fresh.length; n++) {
      const q = this.fresh.pop();
      this.look(q, gen);
      q.done = true;
      if ((n & 15) === 0 && performance.now() - t0 > ms) break;
    }
  }
  // What may have changed since it was painted, a few ms of it per frame: when a picture came or something was built, or after a while
  scan(gen) {
    const V = this.view, sign = `${V.tiles.v}|${V.built.v}|${V.thumbs.size}`, L = this.cells;
    if (this.scanFrom < 0) {
      if (sign === this.sign && !V.built.pending && V.now - this.scanAt < SCAN_S) return;
      this.scanFrom = 0; this.sign = sign; this.scanAt = V.now;
      this.stats.scans++;
    }
    const t0 = performance.now();
    V.built.begin(OVERLAY_MS);
    let i = this.scanFrom;
    while (i < L.length) {
      if (L[i].done) this.look(L[i], gen, true);
      if ((++i & 31) === 0 && performance.now() - t0 > SCAN_MS) break;
    }
    this.scanFrom = i < L.length ? i : -1;
  }
  // A chunk: painted, if what it is painted from is another. again: it has been before
  look(q, gen, again = false) {
    const V = this.view, T = V.tiles, B = this.B, far = Math.hypot(q.i - B.nx / 2, q.j - B.ny / 2), kind = B.fine ? 'sat' : 'thumb';
    let pic = q.src, best = q.best, ov = q.ov, sig = q.sig, vb = q.vb;
    const ask = () => {
      if (T.wanted.size > WANT_MAX && !T.have(kind, q.kx, q.ky)) { if (!best) pic = (B.fine && T.have('thumb', q.kx, q.ky)) || pic; return; }
      const p = B.fine ? T.tile(gen, q.kx, q.ky, gen.season, 1000 + far, q.key) : T.thumb(gen, q.kx, q.ky, gen.season, far, q.key);
      if (p) { pic = p; best = true; } else if (B.fine && !best) pic = T.thumb(gen, q.kx, q.ky, gen.season, far, q.key) || pic;
    };
    // (painted from its own picture, which was dropped since to make room: it stays as it is; asked for again, it would drop another)
    if (!B.sat) { if (!best) { pic = V.thumb(gen, q.key) || null; best = !!pic; } }
    else if (!(again && best && !T.have(kind, q.kx, q.ky))) ask();
    // What is built on it (made out again only if its chunk, or one round it, was touched)
    if (B.sat && V.built.src(q.kx, q.ky, q.key)) {
      const s = V.built.sig(q.kx, q.ky, true), now = V.built.of.village?.built;
      if (s !== sig || now !== vb) {
        const was = V.built.pending;
        V.built.pending = false;
        ov = V.built.picture(q.kx, q.ky, q.key);
        sig = V.built.pending ? NaN : s; vb = now;
        V.built.pending ||= was;
      }
    } else { ov = null; sig = NaN; }
    if (pic === q.src && ov === q.ov && (pic || q.under || q.plain)) { q.sig = sig; q.vb = vb; q.best = best; return; }
    // (only what was built changed, and the picture under it is gone: once it is back)
    if (B.sat && pic && pic === q.src && pic !== T.have(kind, q.kx, q.ky) && pic !== T.have('thumb', q.kx, q.ky)) { best = false; ask(); if (pic === q.src) { q.best = false; return; } }
    this.put(q, gen, pic, ov);
    q.src = pic; q.best = best; q.ov = ov; q.sig = sig; q.vb = vb;
    this.stats.painted++;
  }
  put(q, gen, pic, ov) {
    const s = CHUNK * this.B.b;
    this.fill(this.g, q, gen, pic, ov, q.i * s, q.j * s, s);
  }
  fill(g, q, gen, pic, ov, x, y, s) {
    g.imageSmoothingEnabled = this.B.sat; g.imageSmoothingQuality = 'medium';
    if (pic) g.drawImage(pic, x, y, s, s);
    else if (!q.under && !q.plain) {   // (known land is never black while its picture comes)
      g.fillStyle = `rgb(${BIOMES[gen.biomeAt((q.kx + 0.5) * CHUNK, (q.ky + 0.5) * CHUNK)].rgb[1]})`;
      g.fillRect(x, y, s, s);
      q.plain = true;
    }
    if (ov) g.drawImage(ov, x, y, s, s);
  }
}
