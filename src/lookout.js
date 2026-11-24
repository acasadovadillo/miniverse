// Looking from above (docs/planes/realismo/PLAN-R7-mundo.md §3.4 and §3.5; R7-2): standing still for a moment on a tower's
// terrace or on a lighthouse's gallery (any: those of the world and those one builds) draws the land around on your map and
// makes out the tall places far off, which stay on it with a question mark until you have been there ("spotted"). The tall
// places one walks by are spotted too, and one sees further from the high ground (radius). All of it is each player's own.
import { CHUNK } from './world/gen.js';
import { wrapIndex, distOf, dxOf } from './world/planet.js';
import { screenToWorld } from './camera.js';
import { Audio } from './audio.js';
import { Settings } from './settings.js';
import { hud } from './ui/hud.js';
import { t } from './i18n.js';

export const TALL = new Set(['aldea', 'torre', 'faro', 'templo']);   // (what stands out from afar)
const TIERS = ['hamlet', 'major'];
export const STAND_S = 2;                 // s standing still up there
const HINT_S = 0.5;                       // (and when it says that one sees far)
export const LOOK_CHUNKS = 10, FOG_CHUNKS = 6;   // the land drawn, in chunks; in fog or a dark night
export const SEE_R = 600, SEA_R = 900;    // how far places are made out; from a lighthouse, over the water
const SPOT_R = 140, SPOT_FOG = 60, SPOT_DOT = 0.3, SPOT_EVERY = 0.5, SHARP = 1.3;   // walking by: how far, how much in front, how often; with the perk
const SPOTTED_MAX = 2000, LOOKOUTS_MAX = 200, SAID = 3;
const XP_FIRST = 30, XP_AGAIN = 5;        // a tower's first look-around, and each other day's
// How much higher than the land 48 m round one is to see a chunk further (more at each)
const RISES = [4, 9, 15], RING_R = 48, RING8 = [[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]];
const DIRS = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'];
export const dirOf8 = (dx, dy) => DIRS[((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8];

export class Lookout {
  constructor(places) {
    this.places = places; this.game = places.game;
    this.spotted = new Set();    // keys of places
    this.lookouts = {};          // a tower's key → the real day of the last look-around from it
    this.v = 0;                  // (goes up when spotted changes: the maps)
    this.list = []; this.near = [];
    this.leave();
  }
  reset(save) {
    this.spotted = new Set(Array.isArray(save.spotted) ? save.spotted.filter(k => typeof k === 'string').slice(-SPOTTED_MAX) : []);
    this.lookouts = save.lookouts && typeof save.lookouts === 'object' && !Array.isArray(save.lookouts) ? { ...save.lookouts } : {};
    this.v++; this.spotAt = 0; this.old = null;
    this.leave();
  }
  save(out) {
    if (this.spotted.size) out.spotted = [...this.spotted];
    if (Object.keys(this.lookouts).length) out.lookouts = this.lookouts;
  }
  leave() { this.at = null; this.stood = 0; this.done = false; this.said = false; this.last = null; this.calm = 0; this.breath = 0; }
  get level() { return this.game.skills?.level('explore') || 0; }

  // ---------- which places ----------
  // The tall places within r of (x, y) whose cells are known (Sites.warm), as they are in this world; into out
  tall(x, y, r, out = []) {
    const P = this.places;
    out.length = 0;
    if (!P.places1 || !P.sites) return out;
    for (const s of P.sites.known(x, y, r, TIERS, this.near)) { const p = P.poiOf(s.key); if (p && !p.legacy && p.kind === s.kind && TALL.has(p.kind)) out.push(p); }
    // (those that stay from before: a short list, made again when it changes)
    if (!this.old || this.old.v !== P.version || this.old.of !== P.marks) this.old = { v: P.version, of: P.marks, list: Object.keys(P.marks).map(k => P.poiOf(k)).filter(p => p?.legacy && TALL.has(p.kind)) };
    for (const p of this.old.list) if (distOf(p.x, p.y, x, y) <= r) out.push(p);
    return out;
  }
  // Is it mostly water from one to the other?
  overWater(x, y, p) {
    const dx = dxOf(p.x, x), dy = p.y - y;
    let n = 0;
    for (const k of [0.35, 0.55, 0.75]) if (this.places.sites.wet(x + dx * k, y + dy * k)) n++;
    return n >= 2;
  }
  spot(p) {
    if (this.spotted.has(p.key) || this.places.known(p)) return false;
    this.spotted.add(p.key);
    if (this.spotted.size > SPOTTED_MAX) this.spotted.delete(this.spotted.values().next().value);
    this.v++;
    return true;
  }
  // Been there: it is no longer a question mark
  visited(p) { if (this.spotted.delete(p.key)) this.v++; }
  // For the maps: the spotted ones (their list is made again when it changes)
  marks() {
    const P = this.places;
    if (this.marksV !== this.v || this.marksP !== P.version) {
      this.marksV = this.v; this.marksP = P.version;
      this.marked = [];
      for (const k of this.spotted) { const p = P.poiOf(k); if (p && TALL.has(p.kind) && !P.known(p)) this.marked.push({ x: p.x, y: p.y, kind: p.kind, key: p.key }); }
    }
    return this.marked;
  }

  // ---------- how far one sees ----------
  // Fog, or a night without a clear sky
  blind() {
    const d = this.game.days, w = d?.weatherHere;
    if (!d) return false;
    return w === 'niebla' || !!d.info?.fog || (!!d.isNight?.() && w !== 'sol' && w !== 'nubes');
  }
  // The chunks explored round one, walking: two, and more from the high ground and with the skill
  radius(x, y) {
    const gen = this.places.world.gen, h = q => Math.max(0, q);
    let sum = 0;
    for (const [i, j] of RING8) sum += h(gen.groundAt(x + i * RING_R, y + j * RING_R));
    const rise = h(gen.groundAt(x, y)) - sum / 8;
    return 2 + RISES.filter(q => rise >= q).length + (this.level >= 3 ? 1 : 0);
  }
  // The land within n chunks, on the map. Returns how many are new
  reveal(x, y, n) {
    const E = this.game.explored, cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK), was = E.size, R = (n + 0.4) ** 2;
    for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) if (i * i + j * j <= R) E.add(`${wrapIndex(cx + i, CHUNK)},${cy + j}`);
    return E.size - was;
  }

  // ---------- each frame ----------
  // The tower's terrace or the lighthouse's gallery one stands on: its collider (world/tower.js), or null
  top(p) { const c = p?.tower; return c && p.floor > c.h - 0.05 && Math.abs(p.z - c.h) < 0.1 && !p.mount && !p.boat ? c : null; }
  update() {
    const g = this.game, p = g.player, now = g.time;
    if (g.scene !== g.world || !p || g.gamemode === 'spectator') { this.leave(); return; }
    const c = this.top(p);
    if (!c || !c.key) { if (this.at) this.leave(); }
    else {
      if (this.at?.key !== c.key) { this.leave(); this.at = c; }
      const dt = this.last === null ? 0 : Math.min(0.25, Math.max(0, now - this.last));
      this.last = now;
      // (the cells round it, one a frame, so that nothing waits when one looks)
      const ready = !this.places.places1 || !this.places.sites.warm(c.x, c.y, c.gallery ? SEA_R : SEE_R, TIERS);
      if (!this.done) {
        const still = !p.moving && Math.hypot(p.vx || 0, p.vy || 0) < 0.1 && !p.pose && g.mode === 'play' && !g.busy;
        this.stood = still ? this.stood + dt : 0;
        // (the camera breathes while one looks: degrees of its field of view, engine.js)
        this.calm = Math.min(1, Math.max(0, this.calm + (still ? dt : -2 * dt)));
        if (this.stood >= HINT_S && !this.said && !this.today(c.key) && !this.blind()) { this.said = true; this.breeze(); hud.toast(t('place.lookout.wait'), 'place'); }
        if (this.stood >= STAND_S && ready) { this.done = true; this.look(c); }
      } else this.calm = Math.max(0, this.calm - dt * 0.4);
      this.breath = this.calm > 0.01 && Settings.v.motion !== 'reduced' ? -1.4 * this.calm * Math.sin(Math.min(Math.PI, this.stood * 0.9) / 2) : 0;
    }
    if (!(Math.abs(now - this.spotAt) < SPOT_EVERY)) { this.spotAt = now; this.glance(p); }
  }
  breeze() { Audio.noiseHit(420, 2.2, 0.05, 'lowpass'); setTimeout(() => Audio.noiseHit(760, 1.5, 0.025), 500); }
  today(key) { return this.lookouts[key] === this.game.days?.realDay; }
  // The tall places in front of one, walking by
  glance(p) {
    if (p.headUnder || p.inside) return;
    const r = (this.blind() ? SPOT_FOG : SPOT_R) * (this.level >= 5 ? SHARP : 1), [fx, fy] = screenToWorld(0, -1), f = Math.hypot(fx, fy) || 1;
    for (const q of this.tall(p.x, p.y, r, this.list)) {
      if (this.spotted.has(q.key) || this.places.known(q)) continue;
      const dx = dxOf(q.x, p.x), dy = q.y - p.y, d = Math.hypot(dx, dy) || 1;
      if ((dx * fx + dy * fy) / (d * f) > SPOT_DOT && this.spot(q)) hud.toast(t('place.spotted', { kind: t(`place.kind.${q.kind}`) }), 'place');
    }
  }
  // The look-around from the top of c (a tower or a lighthouse). Returns what it did: { blind, land, seen, fresh }
  look(c) {
    const g = this.game, blind = this.blind(), land = this.reveal(c.x, c.y, blind ? FOG_CHUNKS : LOOK_CHUNKS), again = this.today(c.key);
    if (blind) { hud.toast(t('place.lookout.fog'), 'place'); return { blind, land, seen: [], fresh: 0 }; }
    const seen = [];
    let fresh = 0;
    for (const p of this.tall(c.x, c.y, c.gallery ? SEA_R : SEE_R)) {
      const d = distOf(p.x, p.y, c.x, c.y);
      if (d < 20 || this.places.known(p) || (d > SEE_R && !this.overWater(c.x, c.y, p))) continue;
      const isNew = this.spot(p);
      if (isNew) fresh++;
      seen.push({ p, d, isNew });
    }
    seen.sort((a, b) => b.isNew - a.isNew || a.d - b.d);
    if (!again) {
      const first = this.lookouts[c.key] === undefined;
      delete this.lookouts[c.key];   // (the last one, again at the end of the list)
      this.lookouts[c.key] = g.days?.realDay ?? 0;
      for (const k of Object.keys(this.lookouts)) { if (Object.keys(this.lookouts).length <= LOOKOUTS_MAX) break; delete this.lookouts[k]; }
      g.stats?.add('faros', 1);
      g.skills?.gain('explore', first ? XP_FIRST : XP_AGAIN);
    }
    if (!again || fresh) {
      const line = seen.slice(0, SAID).map(({ p }) => { const s = t('place.lookout.at', { dir: t(`place.dir.${dirOf8(dxOf(p.x, c.x), p.y - c.y)}`), what: t(`place.lookout.${p.kind}`) }); return s[0].toUpperCase() + s.slice(1); }).join(' ');
      hud.toast(line || t('place.lookout.none'), 'place');
      g.onSave?.();
    }
    return { blind, land, seen, fresh };
  }
}
