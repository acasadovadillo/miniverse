// The maps' satellite pictures (docs/planes/realismo/PLAN-R8-hud-mapa.md §3.4): asks the ground worker for them (terrain.js
// askMap, the lowest priority there is) and keeps them, at most TILES of 64 × 64 px (16 KB each, 14 MB in all) and THUMBS
// of 16 × 16 (1 KB each, 4 MB). The main thread only receives finished bitmaps: it draws no pixel and waits for nothing.
//
//   tiles.tile(gen, cx, cy, season, pri)   the picture of a chunk (cx wrapped, as in game.explored), or null: it is asked for
//   tiles.thumb(gen, cx, cy, season, pri)  the same at 1 px per tile
//   tiles.v       goes up with each picture that arrives (the big map repaints then)
//   tiles.ready   whether there is a worker to make them (no world yet, no worker, ?sat=0: false, and the maps draw as before)
// Who draws asks again each time it draws (pri: the lower, the sooner: the distance): what nobody has asked for in ASK_MS is
// not made, so what left the view before its turn never is. Only explored chunks are asked for (the maps know them).
// A picture out of date (another season, something felled, a place discovered, a village project) stays until its new one.
// Few at a time (FLYING; BUSY while the thread has ground to make), so the thread is never more than one picture away from
// the ground it has to make.
import { CHUNK } from '../world/gen.js';
import { SAT_N } from '../world/satpixels.js';
import { wrapIndex } from '../world/planet.js';
import { onVillageChange, BOUNDS } from '../world/village.js';
import { apagada } from '../opciones.js';

export const TILES = 900, THUMBS = 4000;
const FLYING = 6, BUSY = 2, ASK_MS = 1600, CHECK_MS = 2000, AGAIN_MS = 3000, FAIL_MS = 5000;
export const SAT = !apagada('sat');

export class SatTiles {
  // terrain(): the terrain of the view in 3D (or null); world(): the world of the game (what was felled); places(): the
  // places (the discovered ones have no trees on them)
  constructor({ terrain, world = () => null, places = () => null }) {
    this.terrain = terrain; this.world = world; this.places = places;
    this.v = 0;
    this.kept = { sat: new Map(), thumb: new Map() };   // "cx,cy" → { bmp, season, sig, village, chk }
    this.wanted = new Map();    // "sat:cx,cy" → { kind, cx, cy, pri, at, season, gen }
    this.flying = new Map();
    this.failed = new Map();    // key → when (not asked again for FAIL_MS)
    this.village = 0;           // (goes up with each village project: the paths of its pictures)
    this.gen = null;
    this.stats = { made: 0, ms: 0, msMax: 0, main: 0, mainMax: 0, dropped: 0 };
    onVillageChange(() => { this.village++; });
  }
  get ready() { return SAT && !!this.terrain()?.workers?.length; }
  // Another world: nothing of the last one is any good
  use(gen) {
    if (this.gen === gen) return;
    this.gen = gen;
    this.clear();
  }
  clear() {
    for (const M of Object.values(this.kept)) { for (const r of M.values()) r.bmp.close?.(); M.clear(); }
    this.wanted.clear(); this.flying.clear(); this.failed.clear();
    this.v++;
  }
  get bytes() { return this.kept.sat.size * SAT_N * SAT_N * 4 + this.kept.thumb.size * CHUNK * CHUNK * 4; }

  // (k: "cx,cy", if at hand)
  tile(gen, cx, cy, season, pri = 0, k = `${cx},${cy}`) { return this.get('sat', gen, cx, cy, season, pri, k); }
  thumb(gen, cx, cy, season, pri = 0, k = `${cx},${cy}`) { return this.get('thumb', gen, cx, cy, season, pri, k); }
  get(kind, gen, cx, cy, season, pri, k = `${cx},${cy}`) {
    if (!this.ready) return null;
    this.use(gen);
    const M = this.kept[kind], r = M.get(k), now = performance.now();
    if (r) {
      M.delete(k); M.set(k, r);   // (the last used at the end: the first is the one to drop)
      let old = r.season !== season;
      if (!old && now - r.chk > CHECK_MS) { r.chk = now; r.old = this.sigOf(kind, cx, cy) !== r.sig; }
      old ||= r.old;
      if (old && now - r.at > (r.season !== season ? 0 : AGAIN_MS)) this.want(kind, cx, cy, season, pri + 2000, now);
      return r.bmp;
    }
    this.want(kind, cx, cy, season, pri, now);
    return null;
  }
  want(kind, cx, cy, season, pri, now) {
    const id = `${kind}:${cx},${cy}`;
    if (this.flying.has(id) || now - (this.failed.get(id) ?? -1e9) < FAIL_MS) return;
    const w = this.wanted.get(id);
    if (w) { w.pri = pri; w.at = now; w.season = season; }
    else this.wanted.set(id, { kind, cx, cy, season, pri, at: now });
    if (!this.later && !this.flying.size) { this.later = true; setTimeout(() => { this.later = false; this.pump(); }, 0); }   // (after the drawing: then all it wants is known; while some fly, their arrival sends the next)
  }
  have(kind, cx, cy) { return this.kept[kind].get(`${cx},${cy}`)?.bmp || null; }
  // What a picture depends on besides its chunk and the season: what was felled in it and in the chunks round it (their
  // crowns reach into it), the places discovered there and the village's projects
  sigOf(kind, cx, cy) {
    const near = (cx + 2) * CHUNK > BOUNDS.x0 && (cx - 1) * CHUNK < BOUNDS.x1 && (cy + 2) * CHUNK > BOUNDS.y0 && (cy - 1) * CHUNK < BOUNDS.y1 ? this.village : 0;
    if (kind !== 'sat') return near;
    const W = this.world(), P = this.places();
    let n = 0, f = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const k = `${wrapIndex(cx + dx, CHUNK)},${cy + dy}`, d = W?.deltas?.get(k);
      if (d?.removed) n += this.felled(d);
      if (P?.found?.has(k)) f++;
    }
    return near * 1e8 + f * 1e6 + n;
  }
  // How many things were taken from a chunk (remembered by its version)
  felled(d) {
    const F = (this.counts ||= new WeakMap()), h = F.get(d);
    if (h && h.v === d.v) return h.n;
    const n = Object.keys(d.removed).length;
    F.set(d, { v: d.v, n });
    return n;
  }
  // Send what is most wanted, up to what may be flying (just after a drawing, and as pictures arrive)
  pump() {
    const T = this.terrain();
    if (!this.ready || !this.wanted.size || T.gen !== this.gen) return;
    const now = performance.now(), busy = T.jobs.size > this.flying.size + 1;
    while (this.flying.size < (busy ? BUSY : FLYING)) {
      let best = null, bid = null;
      for (const [id, w] of this.wanted) {
        if (now - w.at > ASK_MS) { this.wanted.delete(id); this.stats.dropped++; continue; }
        if (!best || w.pri < best.pri) { best = w; bid = id; }
      }
      if (!best) return;
      this.wanted.delete(bid);
      this.send(T, bid, best);
    }
  }
  send(T, id, w) {
    const sig = this.sigOf(w.kind, w.cx, w.cy), gen = this.gen, data = { season: w.season };
    if (w.kind === 'sat') {
      const gone = [], W = this.world();
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const r = W?.deltas?.get(`${wrapIndex(w.cx + dx, CHUNK)},${w.cy + dy}`)?.removed; if (r) for (const k of Object.keys(r)) gone.push(k); }
      const clear = this.places()?.clearings?.(w.cx, w.cy);
      if (gone.length) data.gone = gone;
      if (clear?.length) data.clear = clear;
    }
    const n = T.askMap(w.kind, gen, w.cx, w.cy, w.pri, data, m => {
      const t0 = performance.now();
      if (this.gen !== gen) { m?.bmp?.close?.(); return; }   // (of the world before: clear() already forgot it)
      this.flying.delete(id);
      if (!m) this.failed.set(id, t0);
      else if (m.bmp) this.keep(w, sig, m.bmp, m.ms);
      else this.fromPixels(w, sig, m);
      const ms = performance.now() - t0;
      this.stats.main += ms; this.stats.mainMax = Math.max(this.stats.mainMax, ms);
      this.pump();
    });
    if (n) this.flying.set(id, n); else this.failed.set(id, performance.now());
  }
  fromPixels(w, sig, m) {   // (a thread without bitmaps)
    const n = w.kind === 'sat' ? SAT_N : CHUNK, c = document.createElement('canvas');
    c.width = c.height = n;
    c.getContext('2d').putImageData(new ImageData(m.pixels, n, n), 0, 0);
    this.keep(w, sig, c, m.ms);
  }
  keep(w, sig, bmp, ms = 0) {
    const M = this.kept[w.kind], k = `${w.cx},${w.cy}`, was = M.get(k), now = performance.now();
    was?.bmp.close?.();
    M.delete(k); M.set(k, { bmp, season: w.season, sig, at: now, chk: now, old: false });
    const max = w.kind === 'sat' ? TILES : THUMBS;
    while (M.size > max) { const [f, r] = M.entries().next().value; r.bmp.close?.(); M.delete(f); }
    this.v++;
    this.stats.made++; this.stats.ms += ms; this.stats.msMax = Math.max(this.stats.msMax, ms);
  }
}
