// The marked route (Plan J §2, docs/planes/gta/PLAN-J-ruta-musica.md): a pin set on the big map and the way to it,
// found in a worker (world/routeworker.js, world/routegrid.js), drawn on both maps (ui/map.js), as a ribbon on the
// ground (three/route3d.js) and as a pin with its distance (#hud-wp, ui/routemark.js). Interface only: nothing is placed
// in the world. A system (reset, save, update), registered in game.js right after maps.
//
// Public API (other batches call only these: F "route to my horse", H, I missions):
//   route.set(target, opts)   target { x, y, name?, kind: 'point' | 'place' | 'mission', id? } in world tiles;
//                             opts { quiet? } (quiet: no minimap flash, nothing sent to your partner). Replaces the current
//                             route. Ignored with ?ruta=0, on the world server, outside the planet or with non-finite
//                             numbers. Returns whether it was set
//   route.pickAt(x, y, sx, sy) a click on the big map at world (x, y) (MapView.toWorld) and canvas pixels (sx, sy): on the
//                             pin it clears; on a pin shared by someone it adopts it; within 12 px of a named spot (a
//                             house goes to its door) or a neighbour it snaps and takes the name; else a 'point'. Right
//                             click is route.clear('user') (menus.js)
//   route.clear(why)          why 'user' | 'arrived' | 'load': clears the pin, the path and the ribbon
//   route.share()             sends the pin to everyone playing with you (the map's "Share the mark")
//   route.heard(conn, peer, m) a shared pin { t: 'wp', x, y, name, id? } from another player (live.js); checked here
//   route.left()              tiles from the player's nearest point of the path to its end (0 without a route)
// Read-only state (map.js and route3d.js redraw when version changes):
//   active (a target is set), state 'idle' | 'finding' | 'ready' | 'straight', target, pts (Float32Array
//   [x0,y0,x1,y1,…] world tiles, x unwrapped from the start with nearX), kinds (Uint8Array, routegrid.js KIND per point),
//   len (tiles along the path), version (bumps on every new path or clear), pinsVersion (on a shared pin's change), pins (Map conn → { x, y, name,
//   by, at }: pins shared by other players), seg (the segment of pts the player is on: drawing starts there), shown (a
//   route, and you are outside in the world), unknownPart (part of a found path crosses unexplored land), still
//   (seconds without moving, real time), flash (counts the sets and re-plans that show the minimap), debug ({ ms,
//   expanded } of the last search)
// Save: out.route = { v: 1, x, y, kind, name?, id? } (2 decimals), per player, omitted without a route; never in live.js
// SHARED nor WORLD_KEYS. The path is never saved: it is found again after loading.
//
// The worker is made on the first search and ended a minute after the last one once there is no route to follow out in
// the world (memory matters on the Air; while a route is followed it stays, with its caches, for the re-plans). It knows
// the untouched world; what players built, cut, dug or opened, the village and the places of the explore layer reach it
// as override masks (routegrid.js OVR, chunkMask), built here when it asks for them ('need', saying which versions it
// holds), in idle slices (1 ms, 4 while a search waits for them, more while the browser is idle), sent as they are
// built, cached by the chunk's d.v and village changes. A search that had to go on without all of them is made again,
// quietly, once they are all there.
import { Profile } from './accounts.js';
import { inPlanet, nearX, wrapIndex } from './world/planet.js';
import { CHUNK } from './world/gen.js';
import { apagada, opcion } from './opciones.js';
import { KIND, LIMITS, maskWanted, chunkMask } from './world/routegrid.js';
import { roadList } from './world/roads.js';
import { getProjects, familyHouse, onVillageChange, HOUSES } from './world/village.js';
import { GAME_VERSION } from './version.js';
import { Music } from './music.js';
import { RouteMark } from './ui/routemark.js';
import { reportFault } from './faults.js';
import { hud } from './ui/hud.js';
import { t } from './i18n.js';

export const KINDS = ['point', 'place', 'mission'];   // (an old or unknown kind, 'person' included, loads as 'point')
export const ROUTE_V = 1;
export const SNAP_PX = 12, GOAL_NEAR = 4;             // (map snap radius in canvas pixels; arrival radius in tiles)
const NAME_MAX = 40, SHARE_GAP = 2;                    // (a shared pin's name length; seconds between two pins of a peer)
const TICK = 0.25;                                     // s: following, re-planning and arrival at 4 Hz
const OFF_TILES = 8, OFF_S = 2, JUMP_TILES = 20, REPLAN_GAP = 3;   // (off the line this far for this long; a teleport; s between re-plans)
const STRAIGHT_STEP = 4;                               // tiles walked before a straight line is drawn again from you
const RETRY_S = 20, RETRY_TILES = 32;                  // (a search that found no way is tried again after this long and this far)
const MARGIN = 2, WIDE = 8;                            // (chunks round the search's box; the wider box of its second try)
const UNKNOWN_GAP = 6, UNK_SCAN = 1500, UNK_STEP = 8;  // (s between re-plans for land explored on the way; tiles of unknown stretch watched, sampled every 8)
const WIN_BACK = 8, WIN_AHEAD = 48;                    // segments of the path searched around the last one (sliding window)
const WORKER_IDLE_MS = 60000, ANSWER_MS = 8000;        // (the worker ends after a minute idle; a search not answered by then: straight)
// (mask building: at least 1 ms per idle slice, more only while the browser says it is idle, never past 8; masks kept here)
const MASK_SLICE_MS = 1, MASK_SLICE_BUSY = 4, MASK_SLICE_MAX = 8, MASK_CACHE = 300;
const r2 = v => Math.round(v * 100) / 100;
// A shared pin's name from its place id, in this player's language (the sender's house is their house), or null
function placeName(id, by) {
  if (id === 'home') return by ? t('gui.map.house_of', { name: by }) : null;
  if (id === 'tavern') return t('gui.map.tavern');
  if (id === 'chapel') return t('place.chapel');
  if (id === 'law_office') return t('place.law_office');
  const q = id.startsWith('house:') ? HOUSES[id.slice(6)] : null;
  return q?.name ? t('gui.map.house_of', { name: q.name }) : null;
}
const okXY = (x, y) => Number.isFinite(x) && Number.isFinite(y) && inPlanet(x, y);
const now = () => performance.now() / 1000;
const idle = globalThis.requestIdleCallback ? ((fn, ms = 60) => requestIdleCallback(fn, { timeout: ms })) : (fn => setTimeout(() => fn(null), 0));
const NO_PTS = new Float32Array(0), NO_KINDS = new Uint8Array(0);

export class Route {
  constructor(game) {
    this.game = game;
    this.off = apagada('ruta');   // (?ruta=0: no routes at all)
    this.dbg = opcion('ruta') === 'ver';   // (?ruta=ver: the map shows the search's ms and nodes, and the tiles it expanded if the worker sends them)
    this.target = null;
    this.state = 'idle';
    this.pts = NO_PTS;
    this.kinds = NO_KINDS;
    this.cum = NO_PTS;            // (length along the path at each point)
    this.len = 0;
    this.version = 0;
    this.pins = new Map();
    this.pinsVersion = 0;         // (bumps when a shared pin comes or goes: the maps redraw, the ribbon does not)
    this.kept = null;             // (?ruta=0: the saved route, written back untouched)
    this.seg = 0; this.leftT = 0; this.unknownPart = false;
    this.flash = 0; this.still = 0; this.stillAt = now();
    this.debug = null; this.dbgCells = null;
    this.mark = new RouteMark();  // (the pin in the world: SmartHud moves it in the minimal HUD, update() in the full one)
    // (the search)
    this.worker = null; this.failures = 0; this.reqId = 0; this.pending = 0; this.killT = 0;
    this.mode = 'walk'; this.lastPlan = -Infinity; this.wantPlan = false; this.quietPlan = false; this.replanning = false; this.tooFar = false;
    this.offSince = null; this.lastXY = null; this.straightAt = null; this.planXY = null; this.tickAt = -Infinity;
    // (the override masks: built here, cached by version; what the worker has, by version; the 'need' being answered)
    this.masks = new Map(); this.jobs = []; this.villageV = 0; this.maskRetry = 0; this.maskRetried = false;
    // (the explored chunks by row, cy → { cx: [], keys: [] }, kept up to date from game.explored as it grows)
    this.exRows = new Map(); this.exSet = null; this.exCount = 0;
    // (the chunks of the path's unknown stretches ahead that were not explored when it was found: segment index, key)
    this.cutTail = false; this.unkSeg = []; this.unkKey = []; this.unkSize = -1;
    if (game.map) game.map.route = this;   // (the maps draw the route: ui/map.js)
    onVillageChange(() => {
      this.villageV++;
      this.worker?.postMessage({ t: 'village', projects: getProjects(), family: familyHouse() });
    });
  }
  get active() { return !!this.target; }
  // (outside in the world, where the route is drawn: not in a cave, not under a roof)
  get outside() { const g = this.game; return !!g.player && g.scene === g.world && !g.indoors; }
  get shown() { return !!this.target && this.outside; }
  get canShare() { return !!this.game.live?.othersPlaying && !Profile.server; }
  get debugText() { const d = this.dbg && this.debug; return d ? `${Math.round(d.ms)} ms · ${d.expanded} nodes${d.why ? ' · ' + d.why : ''}` : ''; }

  reset(save) {
    this.clear('load');
    if (this.pins.size) { this.pins.clear(); this.pinsVersion++; }
    const r = save?.route;
    this.kept = this.off && r ? r : null;
    if (this.off || !r || typeof r !== 'object' || !okXY(r.x, r.y)) return;
    const name = typeof r.name === 'string' && r.name ? r.name.slice(0, NAME_MAX) : undefined;
    // (deferred: the way is searched on the first step of play, not while the game is still loading)
    this.set({ x: r.x, y: r.y, kind: r.kind, name, id: typeof r.id === 'string' ? r.id : undefined }, { quiet: true, defer: true });
  }
  save(out) {
    if (this.kept) { out.route = this.kept; return; }
    const tg = this.target;
    if (!tg) return;
    out.route = { v: ROUTE_V, x: r2(tg.x), y: r2(tg.y), kind: tg.kind };
    if (tg.name) out.route.name = tg.name;
    if (tg.id) out.route.id = tg.id;
  }

  // ---------- each step of play ----------
  update(dt) {
    const g = this.game;
    // (the full HUD: the pin in the world is moved here, each step; the minimal one moves it in SmartHud.frame)
    if (!g.smartHud) {
      try { this.mark.frame(g, this.outside && !g.busy && !hud.dialogOpen && !g.windowsOpen && !g.build?.on, GOAL_NEAR); } catch (e) { reportFault(e, 'RouteMark.frame'); }
    }
    const T = now();
    if (T - this.tickAt < TICK) return;
    this.tickAt = T;
    if (this.pins.size) this.prunePins();
    if (!this.target) return;
    const p = g.player;
    if (!p || g.scene !== g.world || g.indoors || g.dying || g.gamemode === 'spectator') { this.lastXY = null; this.offSince = null; return; }
    const tg = this.target, d = Math.hypot(nearX(tg.x, p.x) - p.x, tg.y - p.y);
    if (d <= GOAL_NEAR) { this.arrive(); return; }
    // (moved since the last tick; a jump of more than JUMP_TILES is a teleport)
    let need = this.wantPlan, jump = false;
    if (this.lastXY) {
      const m = Math.hypot(nearX(p.x, this.lastXY[0]) - this.lastXY[0], p.y - this.lastXY[1]);
      if (m > 0.05) this.stillAt = T;
      if (m > JUMP_TILES) { jump = true; need = true; }
      this.lastXY[0] = p.x; this.lastXY[1] = p.y;
    } else this.lastXY = [p.x, p.y];
    this.still = T - this.stillAt;
    if (this.modeNow() !== this.mode) need = true;   // (mounting, dismounting, boarding, landing)
    if (this.state === 'ready') {
      const off = this.follow(p, jump);
      if (off > OFF_TILES) { this.offSince ??= T; if (T - this.offSince >= OFF_S) need = true; } else this.offSince = null;
      // (land of an unknown stretch ahead explored since: searched again, quietly, so the way there is a real one)
      if (!need && this.unkKey.length && g.explored && g.explored.size !== this.unkSize && T - this.lastPlan >= UNKNOWN_GAP) {
        this.unkSize = g.explored.size;
        if (this.exploredAhead(g.explored)) { need = true; this.quietPlan = true; }
      }
    } else if (this.state === 'straight') {
      // (a straight line starts at you: drawn again every few tiles; and once a far pin is near enough, searched)
      const s = this.straightAt, m = s ? Math.hypot(nearX(p.x, s[0]) - s[0], p.y - s[1]) : Infinity;
      if (m > STRAIGHT_STEP) this.straight();
      if (this.tooFar && d <= LIMITS.maxTiles * 0.95 && !this.noWorker) need = true;
      // (no way was found from where it was searched: tried again once you are well away from there)
      const q = this.planXY;
      if (!this.tooFar && !this.noWorker && q && T - this.lastPlan > RETRY_S && Math.hypot(nearX(p.x, q[0]) - q[0], p.y - q[1]) > RETRY_TILES) need = true;
    }
    // (at most one search every REPLAN_GAP s, and never over one still running: that one is waited for)
    if (need) {
      if (this.pending || T - this.lastPlan < REPLAN_GAP) this.wantPlan = true;
      else { this.replanning = !this.quietPlan; this.quietPlan = false; this.plan(); }
    }
  }

  // ---------- setting and clearing ----------
  set(target, opts = {}) {
    if (this.off || Profile.server || !target) return false;
    const x = +target.x, y = +target.y;
    if (!okXY(x, y)) return false;
    const kind = KINDS.includes(target.kind) ? target.kind : 'point';
    const name = typeof target.name === 'string' && target.name ? target.name.slice(0, NAME_MAX) : undefined;
    const id = typeof target.id === 'string' && target.id ? target.id.slice(0, 64) : undefined;
    this.cancel();
    this.target = { x, y, kind, name, id };
    this.seg = 0; this.offSince = null; this.replanning = false; this.maskRetried = false;
    this.lastXY = null; this.stillAt = now();   // (the first tick takes where you are: no "teleport" from where you were before)
    this.straight();
    if (!opts.quiet) { this.flash++; this.shareWith(true, opts.from); }
    if (opts.defer) { this.wantPlan = this.quietPlan = true; this.lastPlan = -Infinity; }
    else this.plan();
    return true;
  }
  pickAt(x, y, sx, sy) {
    if (this.off || Profile.server || !okXY(x, y)) return;
    const hit = this.game.map?.spotAt?.(sx, sy, SNAP_PX);
    if (hit?.pin === 'route') { this.clear('user'); return; }
    if (hit?.pin === 'shared') {   // (someone's pin: it becomes your route, and their pin goes)
      const q = this.pins.get(hit.conn);
      if (q) { this.pins.delete(hit.conn); this.pinsVersion++; this.set({ x: q.x, y: q.y, kind: 'point', name: q.name || q.by }, { from: hit.conn }); }
      return;
    }
    if (hit?.to && okXY(hit.to.x, hit.to.y)) { this.set({ ...hit.to, name: hit.name }); return; }
    this.set({ x, y, kind: 'point' });
  }
  clear(why) {
    const had = !!this.target;
    this.cancel();
    this.target = null;
    this.state = 'idle';
    this.pts = NO_PTS; this.kinds = NO_KINDS; this.cum = NO_PTS;
    this.len = 0; this.seg = 0; this.leftT = 0; this.unknownPart = false;
    this.wantPlan = this.quietPlan = false; this.offSince = null; this.straightAt = null; this.tooFar = false;
    this.dbgCells = null; this.lastXY = null; this.stillAt = now(); this.maskRetry = 0;
    this.cutTail = false; this.unkSeg.length = this.unkKey.length = 0;
    this.mark.hide();
    if (had) this.version++;
  }
  left() {
    const p = this.game.player, tg = this.target;
    if (!tg || !p) return 0;
    if (this.state === 'ready') return this.leftT;
    return Math.hypot(nearX(tg.x, p.x) - p.x, tg.y - p.y);
  }
  arrive() {
    const g = this.game;
    this.clear('arrived');
    try { Music.cue?.('arrive'); } catch (e) { reportFault(e, 'Music.cue'); }
    g.gather?.float?.(t('route.arrived'), '#fff3c0');
  }

  // ---------- sharing (Decision 3: a button for everyone, and your partner automatically) ----------
  share() {
    if (!this.target || !this.canShare) return;
    if (this.shareWith(false)) hud.toast(t('route.shared_out'), 'ok');
  }
  // To everyone playing with you (partner: only to your partner, a child in common: social.js isPartner), never back to
  // skip (the player whose pin you just adopted). Returns whether it was sent to someone
  shareWith(partner, skip = null) {
    const g = this.game, L = g.live, tg = this.target;
    if (!tg || !L?.joined || !L.net || Profile.server) return false;
    // (a known place also goes by its id, so the receiver names it in their own language and from their side: your
    // house is not "Your house" to them; older peers read only name, sent empty for your house)
    const m = { t: 'wp', x: r2(tg.x), y: r2(tg.y), name: tg.id === 'home' ? '' : tg.name || '' };
    if (tg.id) m.id = tg.id;
    let sent = false;
    for (const [conn, peer] of L.peers) {
      if (conn === skip || !peer.playing || peer.server) continue;
      if (partner && !g.social?.isPartner?.(peer)) continue;
      try { L.net.send(m, conn); sent = true; } catch (e) { reportFault(e, 'Route.share'); }
    }
    return sent;
  }
  // A pin shared by another player: finite, in the planet, a name of at most 40 characters, one per 2 s per peer. It
  // shows on both maps in blue with their name and a toast; a click on it on the big map adopts it (pickAt)
  heard(conn, peer, m) {
    if (this.off || Profile.server || !peer || !m || !okXY(m.x, m.y)) return;
    const T = now(), was = this.pins.get(conn);
    if (was && T - was.at < SHARE_GAP) return;
    const by = String(peer.name || '').slice(0, NAME_MAX), id = typeof m.id === 'string' ? m.id.slice(0, 64) : '';
    const name = placeName(id, by) ?? (typeof m.name === 'string' ? m.name.slice(0, NAME_MAX) : '');
    this.pins.set(conn, { x: m.x, y: m.y, name, by, own: id === 'home', at: T });
    this.pinsVersion++;
    if (this.game.player) hud.toast(t('route.shared_in', { name: by }));
  }
  // (the pins of players who left or went back to the menu go)
  prunePins() {
    const peers = this.game.live?.peers;
    for (const conn of this.pins.keys()) { const q = peers?.get(conn); if (!q || !q.playing) { this.pins.delete(conn); this.pinsVersion++; } }
  }

  // ---------- the path ----------
  modeNow() { const p = this.game.player; return p?.boat || p?.aboard ? 'row' : p?.mount ? 'ride' : 'walk'; }
  // The fallback, and what is shown while the way is searched: a straight line from the player to the pin, drawn dashed
  // on the maps, no ribbon
  straight() {
    const g = this.game, p = g.player, tg = this.target;
    if (!tg) return;
    const here = p && g.scene === g.world, fx = here ? p.x : tg.x, fy = here ? p.y : tg.y, tx = nearX(tg.x, fx);
    this.setPath(new Float32Array([fx, fy, tx, tg.y]), new Uint8Array([KIND.unknown, KIND.unknown]), this.pending && this.state !== 'ready' ? 'finding' : 'straight');
    this.straightAt = [fx, fy];
  }
  setPath(pts, kinds, state) {
    const n = pts.length >> 1, cum = new Float32Array(n);
    let unknown = false;
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    if (state === 'ready') for (let i = 0; i < n; i++) if (kinds[i] === KIND.unknown) { unknown = true; break; }
    Object.assign(this, { pts, kinds, cum, len: n ? cum[n - 1] : 0, state, unknownPart: unknown, seg: 0 });
    this.leftT = this.len;
    if (state !== 'ready') this.cutTail = false;
    this.scanUnknown();
    if (state === 'ready') { const p = this.game.player; if (p && this.game.scene === this.game.world) this.follow(p, true); }
    else this.straightAt = null;
    this.version++;
  }
  // The nearest segment to the player within a window around the last one (or the whole path), and how far is left.
  // Returns the distance from the player to the path
  follow(p, global = false) {
    const P = this.pts, n = P.length >> 1;
    if (n < 2) return 0;
    const i0 = global ? 0 : Math.max(0, this.seg - WIN_BACK), i1 = global ? n - 1 : Math.min(n - 1, this.seg + WIN_AHEAD);
    let best = Infinity, bi = this.seg, bu = 0;
    for (let i = i0; i < i1; i++) {
      const ax = P[i * 2], ay = P[i * 2 + 1], dx = P[i * 2 + 2] - ax, dy = P[i * 2 + 3] - ay, px = nearX(p.x, ax), L2 = dx * dx + dy * dy;
      const u = L2 > 1e-9 ? Math.max(0, Math.min(1, ((px - ax) * dx + (p.y - ay) * dy) / L2)) : 0;
      const ex = ax + u * dx - px, ey = ay + u * dy - p.y, d2 = ex * ex + ey * ey;
      if (d2 < best) { best = d2; bi = i; bu = u; }
    }
    this.seg = Math.min(bi, n - 2);
    this.leftT = Math.max(0, this.len - (this.cum[this.seg] + bu * (this.cum[this.seg + 1] - this.cum[this.seg])));
    return Math.sqrt(best);
  }
  // The chunks the unknown stretches of a found path cross (sampled every UNK_STEP tiles, the first UNK_SCAN tiles of
  // them; not the gap to a shut-in pin) that were not explored then: when one of them ahead is explored, update()
  // searches again
  scanUnknown() {
    const S = this.unkSeg, Kk = this.unkKey, ex = this.game.explored;
    S.length = Kk.length = 0;
    this.unkSize = ex?.size ?? -1;
    if (this.state !== 'ready' || !this.unknownPart || !ex) return;
    const P = this.pts, K = this.kinds, U = KIND.unknown, last = (P.length >> 1) - (this.cutTail ? 2 : 1), seen = new Set();
    let left = UNK_SCAN;
    for (let i = 0; i < last && left > 0; i++) {
      if (K[i] !== U && K[i + 1] !== U) continue;
      const ax = P[i * 2], ay = P[i * 2 + 1], bx = P[i * 2 + 2], by = P[i * 2 + 3], L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / UNK_STEP));
      for (let k = 0; k <= n; k++) {
        const x = ax + (bx - ax) * k / n, y = ay + (by - ay) * k / n, key = `${wrapIndex(Math.floor(x / CHUNK), CHUNK)},${Math.floor(y / CHUNK)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!ex.has(key)) { S.push(i); Kk.push(key); }
      }
      left -= L;
    }
  }
  // Is one of those chunks, on a segment from the player's on, explored now?
  exploredAhead(ex) {
    const S = this.unkSeg, Kk = this.unkKey;
    for (let i = 0; i < S.length; i++) if (S[i] >= this.seg && ex.has(Kk[i])) return true;
    return false;
  }
  // Ask the worker for the way from the player to the pin (in the player's travel mode). Never waits: the answer comes
  // in onWorker. Over LIMITS.maxTiles, or without a worker, the straight line stays
  plan() {
    const g = this.game, p = g.player, tg = this.target;
    this.wantPlan = false;
    if (!tg) return;
    if (!p || g.scene !== g.world || g.indoors) { this.wantPlan = true; return; }   // (in a cave or a house: once outside)
    this.lastPlan = now();
    this.planXY = [p.x, p.y];
    this.mode = this.modeNow();
    const fx = Math.floor(p.x), fy = Math.floor(p.y), tx = Math.floor(nearX(tg.x, p.x)), ty = Math.floor(tg.y);
    this.tooFar = Math.hypot(tx - fx, ty - fy) > LIMITS.maxTiles;
    const w = this.tooFar ? null : this.ensureWorker();
    if (!w) { this.pending = 0; if (this.state !== 'ready' || this.tooFar) this.straight(); return; }
    const id = ++this.reqId;
    this.pending = id;
    try {
      // (exact ends: the path starts at your feet and ends on the pin; the explored chunks of its box)
      // (the roads the game knows there: the worker need not work them out again)
      const R = this.game.world?.gen?.roads;
      if (this.linesOf !== R) { this.linesOf = R; this.sentLines = new Set(); }
      const lines = R ? R.pack((p.x + nearX(tg.x, p.x)) / 2, (p.y + tg.y) / 2, Math.max(Math.abs(nearX(tg.x, p.x) - p.x), Math.abs(tg.y - p.y)) / 2 + 400, this.sentLines) : [];
      w.postMessage({ t: 'route', id, lines, from: { x: p.x, y: p.y }, to: { x: nearX(tg.x, p.x), y: tg.y }, mode: this.mode, explored: this.exploredAround(fx, fy, tx, ty, WIDE), margin: MARGIN, wide: WIDE, debug: this.dbg });
    } catch (e) { reportFault(e, 'Route.plan'); this.workerFailed(); return; }
    this.touchWorker();
    if (this.state !== 'ready') { this.state = 'finding'; this.version++; }
    // (not answered in time: the straight line meanwhile; a late answer to this same search is still taken)
    setTimeout(() => { if (this.pending !== id) return; this.pending = 0; if (this.state === 'finding') { this.state = 'straight'; this.version++; } }, ANSWER_MS);
  }
  // A newer search supersedes every older one: their answers and their 'need' are dropped
  cancel() { this.reqId++; this.pending = 0; this.jobs.length = 0; }
  onWorker(m) {
    if (!m) return;
    if (m.t === 'need') { this.answerNeed(m); return; }
    if (m.t !== 'path' || m.id !== this.reqId || !this.target) return;
    this.pending = 0;
    this.touchWorker();
    this.debug = { ms: +m.ms || 0, expanded: +m.expanded || 0, why: m.ok ? '' : String(m.why || '') };
    this.dbgCells = this.dbg && m.seen && m.seen.length ? m.seen : null;
    const pts = m.pts instanceof Float32Array ? m.pts : Float32Array.from(m.pts || []), n = pts.length >> 1;
    if (!m.ok || n < 2 || !pts.every(Number.isFinite)) { this.straight(); this.state = 'straight'; return; }
    let kinds = m.kinds instanceof Uint8Array ? m.kinds : Uint8Array.from(m.kinds || []);
    if (kinds.length !== n) { const k = new Uint8Array(n); k.set(kinds.subarray(0, n)); kinds = k; }
    // (the line ends on the pin itself, unwrapped like the rest, whatever the worker rounded)
    const tg = this.target;
    pts[n * 2 - 2] = nearX(tg.x, pts[n * 2 - 4]); pts[n * 2 - 1] = tg.y;
    this.cutTail = !!m.cut;
    this.setPath(pts, kinds, 'ready');
    if (this.replanning) { this.replanning = false; this.flash++; }   // (found again: the minimap shows it a moment)
    // (searched without all the masks: once they are all here, quietly again, once per pin)
    if (m.partial && !this.maskRetried) {
      this.maskRetried = true;
      if (this.jobs.some(j => j.id === m.id)) this.maskRetry = m.id;
      else this.wantPlan = this.quietPlan = true;
    }
  }

  // ---------- the worker ----------
  get noWorker() { return this.failures >= 2 || typeof Worker === 'undefined' || Profile.server; }
  ensureWorker() {
    if (this.worker) {
      const gen = this.game.world?.gen;
      if (gen && gen.roadsV !== this.roadsV) { this.roadsV = gen.roadsV; this.worker.postMessage({ t: 'roads', roads: roadList(gen) }); }
      return this.worker;
    }
    if (this.noWorker) return null;
    try {
      const url = new URL('./world/routeworker.js?v=' + encodeURIComponent(GAME_VERSION) + (this.dbg ? '&ruta=ver' : ''), import.meta.url);
      const w = new Worker(url, { type: 'module' });
      w.onmessage = e => { try { this.onWorker(e.data); } catch (err) { reportFault(err, 'Route.onWorker'); } };
      w.onerror = e => { console.warn('Route: the worker failed; straight lines meanwhile', e?.message || ''); e?.preventDefault?.(); this.workerFailed(); };
      w.postMessage({ t: 'init', seed: this.game.world?.seed, projects: getProjects(), family: familyHouse(), roads: roadList(this.game.world?.gen) });
      this.roadsV = this.game.world?.gen?.roadsV; this.linesOf = undefined;   // (a new worker knows no lines)
      this.worker = w;
    } catch (e) { console.warn('Route: no worker', e?.message || e); this.failures = 2; return null; }
    return this.worker;
  }
  workerFailed() {
    this.failures++;
    this.stopWorker();
    if (this.target && this.state !== 'ready') { this.pending = 0; this.straight(); this.state = 'straight'; }
  }
  // (a minute after the last search or answer it ends, unless a route is being followed out in the world: then it keeps
  // its caches for the re-plans)
  touchWorker() { clearTimeout(this.killT); this.killT = setTimeout(() => { if (this.target && this.outside) this.touchWorker(); else this.stopWorker(); }, WORKER_IDLE_MS); }
  stopWorker() {
    clearTimeout(this.killT);
    if (!this.worker) return;
    try { this.worker.terminate(); } catch { /* gone already */ }
    this.worker = null; this.jobs.length = 0;
    if (this.pending) { this.pending = 0; if (this.state === 'finding') { this.state = 'straight'; this.version++; } }
  }
  // The explored chunk keys (as in game.explored) in the box of the search plus margin chunks, from the rows index (only
  // the explored chunks of the box's rows are looked at; the index takes only the keys added since the last call)
  exploredAround(fx, fy, tx, ty, margin = MARGIN) {
    const rows = this.exploredRows(), out = [];
    if (!rows) return out;
    const c0x = Math.floor(Math.min(fx, tx) / CHUNK) - margin, c1x = Math.floor(Math.max(fx, tx) / CHUNK) + margin;
    const c0y = Math.floor(Math.min(fy, ty) / CHUNK) - margin, c1y = Math.floor(Math.max(fy, ty) / CHUNK) + margin, w = c1x - c0x;
    for (let cy = c0y; cy <= c1y; cy++) {
      const row = rows.get(cy);
      if (!row) continue;
      for (let i = 0; i < row.cx.length; i++) { const dx = wrapIndex(row.cx[i] - c0x, CHUNK); if (dx >= 0 && dx <= w) out.push(row.keys[i]); }
    }
    return out;
  }
  exploredRows() {
    const ex = this.game.explored;
    if (!ex?.size) return null;
    if (ex !== this.exSet || ex.size < this.exCount) { this.exSet = ex; this.exCount = 0; this.exRows = new Map(); }
    if (ex.size !== this.exCount) {
      let i = 0;
      for (const k of ex) {
        if (i++ < this.exCount) continue;   // (a Set iterates in insertion order: what is new is at the end)
        const s = String(k), c = s.indexOf(','), kx = +s.slice(0, c), ky = +s.slice(c + 1);
        if (!Number.isFinite(kx) || !Number.isFinite(ky)) continue;
        let row = this.exRows.get(ky);
        if (!row) this.exRows.set(ky, (row = { cx: [], keys: [] }));
        row.cx.push(kx); row.keys.push(s);
      }
      this.exCount = ex.size;
    }
    return this.exRows;
  }

  // ---------- override masks (§2.4) ----------
  // The worker asks for the masks of the corridor of search id, saying the version of each one it already has (have):
  // each 'need' is answered by one 'masks' message, in the order asked, built in idle slices. Only what it lacks goes:
  // the chunks that want a mask (routegrid.js maskWanted: a delta, the village, a place near) and whose version changed;
  // a chunk that no longer wants one, as null, if the worker holds one. The search waits for this a few seconds at most
  answerNeed(m) {
    if (m.id !== this.reqId || !Array.isArray(m.chunks)) return;
    this.jobs.push({ id: m.id, seq: m.seq, keys: m.chunks, have: Array.isArray(m.have) ? m.have : [], i: 0, out: [] });
    if (this.jobs.length === 1) this.idleMasks();
  }
  // (the next slice: sooner while a search waits for these masks)
  idleMasks() {
    this.runJobs ||= deadline => this.runMasks(deadline);
    idle(this.runJobs, this.pending && this.jobs[0]?.id === this.pending ? 20 : 60);
  }
  runMasks(deadline) {
    const t0 = performance.now(), free = deadline?.didTimeout ? 0 : deadline?.timeRemaining?.() ?? 0;
    const busy = !!this.pending && this.jobs[0]?.id === this.pending;
    const budget = Math.max(busy ? MASK_SLICE_BUSY : MASK_SLICE_MS, Math.min(MASK_SLICE_MAX, free - 0.5));
    while (this.jobs.length) {
      const job = this.jobs[0];
      if (job.id !== this.reqId || !this.worker) { this.jobs.shift(); continue; }   // (an older search: dropped)
      try {
        while (job.i < job.keys.length && performance.now() - t0 < budget) {
          const i = job.i++, e = this.maskFor(String(job.keys[i]), job.have[i]);
          if (e) job.out.push(e);
        }
      } catch (err) { reportFault(err, 'Route.masks'); job.i = job.keys.length; }
      if (job.i < job.keys.length) {
        // (the slice is spent: what is built goes now, so a search that cannot wait longer has it; the rest next time)
        if (job.out.length) { try { this.worker.postMessage({ t: 'masks', id: job.id, seq: job.seq, done: false, masks: job.out }); } catch (err) { reportFault(err, 'Route.masks'); } job.out = []; }
        this.idleMasks();
        return;
      }
      this.jobs.shift();
      try { this.worker.postMessage({ t: 'masks', id: job.id, seq: job.seq, done: true, masks: job.out }); } catch (err) { reportFault(err, 'Route.masks'); }
      // (a path found without all of them: searched again now that they are all there)
      if (this.maskRetry === job.id && !this.jobs.some(j => j.id === job.id)) { this.maskRetry = 0; this.wantPlan = this.quietPlan = true; }
    }
  }
  // The entry [key, v, Uint8Array(256) | null] the worker lacks for chunk key, or null if what it has (have: its v, or
  // null for none) is still right. v is the chunk delta's d.v (-1 without a delta); a village change makes the worker
  // drop the village's masks (routeworker.js) and this side rebuild them
  maskFor(key, have = null) {
    const w = this.game.world, c = key.indexOf(','), cx = wrapIndex(+key.slice(0, c), CHUNK), cy = +key.slice(c + 1);
    if (!w || !Number.isFinite(cx) || !Number.isFinite(cy)) return null;
    if (!maskWanted(w, cx, cy)) return have === null || have === undefined ? null : [key, -1, null];
    const k = `${cx},${cy}`, d = w.deltas?.get(k), v = d ? d.v | 0 : -1;
    let hit = this.masks.get(k);
    if (hit && hit.v === v && hit.vv === this.villageV) { this.masks.delete(k); this.masks.set(k, hit); if (have === v && !hit.fresh) return null; }
    else {
      hit = { v, vv: this.villageV, mask: chunkMask(w, cx, cy), fresh: true };
      this.masks.set(k, hit);
      if (this.masks.size > MASK_CACHE) this.masks.delete(this.masks.keys().next().value);
    }
    hit.fresh = false;   // (built again after a village change: sent even if the worker's v is the same)
    return [key, v, hit.mask];
  }
}
