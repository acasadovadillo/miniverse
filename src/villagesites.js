// The village is built from day one (docs/planes/PLAN-pueblo-construido.md): the chapel, the law office, Dani's house, the
// fountain, the market stalls and the dock stand from the start. Where each one stands in a world is chosen once, so that
// nothing of a player's is ever built over:
//   - each has an ordered list of candidate sites (village.js SITES); only whoever runs the world chooses (alone, your game;
//     together, the host, or the world server: the wheelbarrow's decides()), and a guest never writes it;
//   - a candidate is taken only if its ground (what it stands on, its margin, its paths and the land it adds to the village)
//     holds nothing of any player: built, planted, dug, tilled, a fence, a boat, the wheelbarrow, a trap… (siteBusy);
//   - the choice is kept in the world (save.village, the shared record 'village': livesync.js) and never moves again. One
//     with no free site waits and is looked at again each morning;
//   - a game from before the change (save.projects, the board's projects): what stood there stays where it was, but the
//     chapel and the law office, which stood against the player's garden, move to their site; whatever a player put in them
//     stays where it is. Nothing of the chunks' deltas is changed, ever.
import { SITES, SITE_ORDER, setVillage, siteOf } from './world/village.js';
import { CHUNK } from './world/gen.js';
import { PEOPLE } from './neighbors.js';
import { hud } from './ui/hud.js';
import { t } from './i18n.js';
import { Profile } from './accounts.js';

// The board's projects of before (board.js until 2026-11-26) and the buildings they brought
const OLD = { fountain: 'fuente', dock: 'muelle', market_a: 'mercado', market_b: 'mercado', dani: 'casa', chapel: 'chapel', law_office: 'law_office' };
const MOVED = new Set(['chapel', 'law_office']);
// What a chunk keeps that is nothing of a player's: the wild (felled, picked, opened, fished, dived), the weather and the
// grass, and the marks of what came with the world and was taken away
const NATURAL = new Set(['v', 'removed', 'picked', 'gone', 'mown', 'moist', 'wet', 'frostYear', 'weeds', 'dived', 'shoo', 'opened', 'fished', 'pilfer']);
const HOUR = 6;   // (the morning look at those still waiting, from this hour)

// The tiles a candidate needs free: its rectangle with its margin (2 round, 3 before the door; the small ones 1), 1.5 tiles
// each side of its paths, and its annex. A Set of 'x,y'
export function siteArea(c) {
  const out = new Set(), m = c.margin ?? 2, R = c.rect;
  const rect = (x0, y0, x1, y1) => { for (let y = Math.floor(y0); y < Math.ceil(y1); y++) for (let x = Math.floor(x0); x < Math.ceil(x1); x++) out.add(`${x},${y}`); };
  rect(R.x0 - m, R.y0 - m, R.x1 + m, R.y1 + m + 1);
  for (const a of c.annex) rect(a.x0, a.y0, a.x1, a.y1);
  for (const w of c.ways) for (let i = 0; i + 1 < w.length; i++) {
    const [ax, ay] = w[i], [bx, by] = w[i + 1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    for (let y = Math.floor(Math.min(ay, by) - 2); y <= Math.ceil(Math.max(ay, by) + 2); y++) for (let x = Math.floor(Math.min(ax, bx) - 2); x <= Math.ceil(Math.max(ax, bx) + 2); x++) {
      const px = x + 0.5, py = y + 0.5, q = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
      if (Math.hypot(px - ax - q * dx, py - ay - q * dy) <= 1.5) out.add(`${x},${y}`);
    }
  }
  return out;
}
// Where in the world an entry of a chunk's layer is: its tile (a key 'x,y', also 'layer:x,y'), or its point (boats, the
// pushed wheelbarrow, a boat's load…), or null if it cannot be told (then it counts wherever the chunk is)
function where(layer, k, v) {
  if (layer === 'boats' && Array.isArray(v) && Number.isFinite(v[0]) && Number.isFinite(v[1])) return [v[0], v[1]];
  if (layer === 'boatLoad' && Array.isArray(v) && Number.isFinite(v[3]) && Number.isFinite(v[4])) return [v[3], v[4]];
  if (v && typeof v === 'object' && !Array.isArray(v) && Number.isFinite(v.x) && Number.isFinite(v.y)) return [v.x, v.y];
  const m = /(-?\d+),(-?\d+)/.exec(k);
  return m ? [+m[1] + 0.5, +m[2] + 0.5] : null;
}
// How many things of players there are on a candidate's ground (0: free). world: what has the chunks' deltas (delta(cx, cy))
export function siteBusy(world, c) {
  const area = siteArea(c);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const k of area) { const [x, y] = k.split(',').map(Number); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  let n = 0;
  for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor(y1 / CHUNK); cy++) for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++) {
    const d = world.delta ? world.delta(cx, cy) : world.deltas?.get?.(`${cx},${cy}`);
    if (!d) continue;
    for (const layer of Object.keys(d)) {
      if (NATURAL.has(layer)) continue;
      const L = d[layer];
      if (!L || typeof L !== 'object') continue;
      for (const [k, v] of Object.entries(L)) {
        if (v === undefined || v === null || v === false) continue;
        const p = where(layer, k, v);
        // (one that cannot be placed counts if the chunk is the area's at all: better a site skipped than something built over)
        if (!p ? [...area].some(q => { const [x, y] = q.split(',').map(Number); return Math.floor(x / CHUNK) === cx && Math.floor(y / CHUNK) === cy; }) : area.has(`${Math.floor(p[0])},${Math.floor(p[1])}`)) n++;
      }
    }
  }
  return n;
}
const overlaps = (a, b, gap) => a.x0 - gap < b.x1 && a.x1 + gap > b.x0 && a.y0 - gap < b.y1 && a.y1 + gap > b.y0;

// The record as it is kept: { v: 2, sites: { id: index | null }, moved?: [ids] }, or null if it is not there or not valid
export function readVillage(v) {
  if (!v || typeof v !== 'object' || !v.sites || typeof v.sites !== 'object') return null;
  const sites = {};
  for (const id of SITE_ORDER) { const i = v.sites[id]; sites[id] = Number.isInteger(i) && SITES[id][i] ? i : null; }
  return { v: 2, sites, ...(Array.isArray(v.moved) ? { moved: v.moved.filter(id => MOVED.has(id)) } : {}) };
}
// The choice, from the deltas of a world and what an old game had built (old: save.projects, or null). The same answer for
// the same deltas: the buildings and their candidates always in the same order. keep: the sites already chosen (the morning
// look: only those still waiting are chosen)
export function chooseSites(world, old = null, keep = null) {
  const sites = {}, taken = [], moved = [];
  for (const id of SITE_ORDER) if (keep && Number.isInteger(keep[id])) { sites[id] = keep[id]; taken.push(SITES[id][keep[id]].rect); }
  for (const id of SITE_ORDER) {
    if (id in sites) continue;
    // (what an old game had built stays where it stood, but the chapel and the law office: those move)
    if (old?.[OLD[id]] && !MOVED.has(id)) { sites[id] = 0; taken.push(SITES[id][0].rect); continue; }
    const i = SITES[id].findIndex(c => !taken.some(r => overlaps(r, c.rect, 1)) && !siteBusy(world, c));
    sites[id] = i >= 0 ? i : null;
    if (i >= 0) taken.push(SITES[id][i].rect);
    if (old?.[OLD[id]] && MOVED.has(id)) moved.push(id);
  }
  // (in the buildings' order, whatever was kept: the same text everywhere)
  return { v: 2, sites: Object.fromEntries(SITE_ORDER.map(id => [id, sites[id]])), ...(moved.length ? { moved } : {}) };
}

export class VillageSites {
  constructor(game) {
    this.game = game;
    this.v = null;     // the record of this world, or null (a shared world whose runner has not chosen yet)
    this.old = null;   // the projects of an old game, until the choice is made
    this.look = -1;    // the day of the last morning look
  }
  get world() { return this.game.world; }
  decides() { return this.game.barrow?.decides?.() ?? true; }
  reset(save) {
    this.v = readVillage(save.village);
    this.old = save.projects && typeof save.projects === 'object' ? { ...save.projects } : null;
    this.look = -1;
    // (your own world, or the server's: chosen now, before the village is made. A shared world that came without one waits
    // for whoever runs it: update, if it is this game)
    const fresh = !this.v && !save.sharedWorld;
    if (fresh) this.v = chooseSites(this.world, this.old);
    setVillage(this.v || { sites: {} });
    this.world.rebuildVillage();
    if (fresh) this.tell();
  }
  save(out) {
    if (this.v) out.village = this.v;
    else if (this.old) out.projects = this.old;   // (not chosen yet: what it was made from stays)
  }
  update() {
    if (!this.game.world || !this.decides()) return;
    if (!this.v) { this.set(chooseSites(this.world, this.old)); this.tell(); return; }
    const D = this.game.days;
    if (!D || D.hour < HOUR || this.look === D.dayIndex) return;
    this.look = D.dayIndex;
    if (!SITE_ORDER.some(id => this.v.sites[id] === null)) return;
    const next = chooseSites(this.world, null, this.v.sites);
    if (SITE_ORDER.some(id => next.sites[id] !== this.v.sites[id])) this.set({ ...this.v, sites: next.sites });
  }
  // (a guest) The record of the world, from whoever runs it
  share(v) { const r = readVillage(v); if (r && JSON.stringify(r) !== JSON.stringify(this.v)) this.set(r); }
  // A new record: the village is made again with it, and whoever lives in what has just been built moves in
  set(v) {
    const was = this.v?.sites || {};
    this.v = v;
    setVillage(v);
    this.world.rebuildVillage();
    const g = this.game;
    for (const [id, d] of Object.entries(PEOPLE)) if (d.site && Number.isInteger(v.sites[d.site]) && !Number.isInteger(was[d.site])) g.neighbors?.moveIn(id);
    g.onSave?.();
  }
  // The game that has just moved an old world's chapel or law office says so, once (that is when the choice is made)
  tell() { if (this.v?.moved?.length && !Profile.server) hud.toast(t('village.moved'), 'good'); }
  // What is drawn on the maps and said of a building: where it stands, or null
  at(id) { return siteOf(id); }
}
