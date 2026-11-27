// Tracking (docs/planes/gta/PLAN-G-caza.md §3.1 and §3.3): prints, blood and bent grass on the ground, reading them
// (the crouch aid, the hover tag, E to study a print) and the locked trail. A system (game.tracks), made after hunt.
//
// Every game makes its own marks from the animals it already knows (wildlife.list): no traffic for prints, only the
// wound state travels in the 'wild' message (wildlife.js). Nothing here is saved (wild animals are not either).
// The drawing is src/three/tracks3d.js, which reads the marks through ver, hver, each() and the arrays below.
//
// Contract (Plan G §12; other tracks rely on these names):
//   tracks.print(src, kind, x, y, yaw, { surf, flee, scale, left, type } = {}) → index or -1
//       src: trailKey(w) for a wild animal (wildlife.js), 'p:<id>' for a player (Batch E), 'h:<id>' for a horse (F).
//       kind: one of KINDS. yaw: the direction of travel, Math.atan2(dy, dx) in world x/y. Returns -1 when the surface
//       takes no print (blood is kept on paths and rock, never on water), with no view (the world server) and with
//       ?tracks=0. On tall grass a print becomes one or two bentGrass flecks (the index of the first).
//   tracks.surfaceAt(x, y) → one of SURFACES (cached per tile, cleared with world.digV)
//   tracks.near(x, y, r, out = []) → [idx]; tracks.at(x, y, r) → idx | -1 (the nearest mark); tracks.trail(src) → [idx]
//       (oldest first; a live array: copy it to keep it)
//   tracks.info(idx) → { kind, print, type, src, x, y, born, ttl, age, ageKey, heading, blood: 0 | 1 | 2, flee, surf } | null
//       type: the species id ('ciervo', 'jabali') or null; heading: 'n' | 'ne' | … (tracks.dir.<heading>) or '' (a pool);
//       age: seconds on the mark's own clock (rain ages it faster); ageKey: 'fresh' | 'recent' | 'old'
//   tracks.lock(src, why = 'study')   why 'blood' is the auto lock of a wound (GW): the highlight starts where it was hit
//   tracks.taken(src, bled)           hunt.reward: the animal of this trail was killed by you, or bled out of your wound
//   tracks.unlock(); tracks.locked (src | null); tracks.ahead() → [idx] (the highlighted marks; a reused array)
//   tracks.stalking (bool: locked and the animal within 40 m; music reads it, Plan J)
//   tracks.ver (goes up on every change of the marks), tracks.hver (on every change of the highlighted set)
//   tracks.each(x, y, r, fn) calls fn(idx) for every mark within r (tracks3d's rebuild)
//   For the HUD (fieldhud.js reads, never writes):
//   tracks.hover   → { idx, reach } | null   the mark under the cursor or crosshair, refreshed at 10 Hz (reach: within E)
//   tracks.freshNear (bool)                  a fresh trail passes within 4 m of the player (smarthud: tip 'tracks')
//   tracks.why ('study' | 'blood' | null)    why the locked trail is locked ('blood': its animal was hit by you)
//   tracks.bleeding (bool)                   the trail locked by your own hit, and its animal still bleeds (tip 'blood')
//   tracks.readK (0..1)                      the crouch aid, eased over 0.3 s (tracks3d reads it for its uniform)
//   trackerDone(game) → bool: the 'tracker' achievement (a trail followed 60 m to the prey; GN puts it in ACH)
//   System hooks: update(dt) (marks are made only with a view, game.view3d.world, and only in the world scene: on the
//   world server view3d is the truthy NO_VIEW, so testing view3d alone would run it there), reset(), aimables(p, sc, box)
//   (the E study on a mark: { kind: 'sys', act } entries, as farm.js does).
import { apagada } from './opciones.js';
import { t } from './i18n.js';
import { Audio } from './audio.js';
import { trailKey } from './wildlife.js';
import { B, BIOMES } from './world/biomes.js';
import { CHUNK, WORLD_SEED } from './world/gen.js';
import { inBounds, distToPath } from './world/village.js';
import { wrapX, dxOf, distOf, wrapIndex } from './world/planet.js';
import { seasonalPalette } from './art/seasons.js';
import { ihash } from './util.js';

// Mark kinds: one atlas cell each (tracks3d.js). G uses the wild ones, blood and bent grass; horse, dog, cat, rabbit and
// boot are for Batches E and F
export const KINDS = ['deer', 'boar', 'horse', 'dog', 'cat', 'rabbit', 'boot', 'blood', 'bloodLong', 'bloodPool', 'bentGrass'];
export const BLOOD_KINDS = new Set(['blood', 'bloodLong', 'bloodPool']);
export const SURFACES = ['none', 'snow', 'mud', 'sand', 'soil', 'grass'];
// The print kind of each wild species (and the species of each print kind, for the tag and the book)
export const PRINT_OF = { ciervo: 'deer', jabali: 'boar' };
export const SPECIES_OF = { deer: 'ciervo', boar: 'jabali' };
export const CAP = 3200;     // marks kept at most (the oldest go first)
export const READ_R = 8;     // m: the crouch aid's radius
export const HL_R = 25;      // m: the locked trail's highlight reach at tracking level 0 (+2 per level)
export const DIRS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
const NOSE_R = 40;   // m: how far a searching dog finds the trail again (Plan R3-4)
// Seconds a mark lasts on each surface (none: prints take none; blood there lasts NONE_K of its time)
export const TTL = [0, 1200, 720, 300, 420, 300];
export const BLOOD_TTL = [360, 360, 720], NONE_K = 0.6;
export const RAIN_K = 2.5, SNOW_K = 2;   // how much faster marks age while it rains (all) and snows (prints only)
export const FRESH = 120, RECENT = 600;  // seconds: the age words, and "fresh" for the tip
// Stride in metres, walking and fleeing, and the walking speed above which a gait counts as flight (×1.5)
export const STRIDE = { ciervo: [0.9, 1.6], jabali: [0.6, 1.1] };
const WALK = { ciervo: 0.8, jabali: 0.9 };

// Internal indices (the arrays hold numbers, not strings)
export const K = Object.fromEntries(KINDS.map((k, i) => [k, i]));
export const DEAD = 255;
export const S = { none: 0, snow: 1, mud: 2, sand: 3, soil: 4, grass: 5, water: 6 };   // (water: 'none' outside, no blood either)
// Flag bits of FL: the left foot, a flight print, the bleed level (2 bits), the second bent-grass fleck of a print
export const F_LEFT = 1, F_FLEE = 2, F_BLEED = 2, F_SECOND = 16;   // (bleed: (FL >> F_BLEED) & 3)
const isBlood = k => k >= K.blood && k <= K.bloodPool;

const SIDE = 0.09, RANGE = 90, JUMP = 3, BLOOD_EVERY = [0, 1.6, 0.8], POOL_EVERY = 20, POOL_MAX = 3;
const TICK = 0.1, SCAN = 200, READ_EASE = 0.3, HOVER_R = 0.45, HOVER_SEE = 26, REACH = 2, REACH_MORE = 0.25;   // (HOVER_R: the tag's circle and the E box's half side, so both answer to the same spot)
const FRESH_R = 4, WATER_NEAR = 1.5, LOST_AFTER = 20, FOUND_R = 15, GONE_R = 20, STALK_R = 40, FOLLOW_MIN = 60, AHEAD_MAX = 48;
// FOLLOW_R: walking along the trail counts this near one of its marks. FALLEN_R: its animal bled out, the highlight goes
// this near its end. WATER_WAIT: seconds without a new mark before a trail that ends at a bank says so. FAINT: a mark past
// this share of its time is too faint to be pointed at (unless crouching close, or on the trail you follow)
const FOLLOW_R = 4, FALLEN_R = 6, WATER_WAIT = 4, FAINT = 0.75;
// The backtrail: a walk of BACK_L metres that ends at the spawn point, its end made BACK_AGE seconds ago
const BACK_L = [25, 40], BACK_AGE = [60, 240], BACK_STEP = 0.9, BACK_SPEED = 0.8, BACK_WALK = 4, BACK_LAY = 3;
const SURF_MAX = 8192, NO_OPTS = {}, TWO_PI = Math.PI * 2, TURNS = [0, 0.7, -0.7, 1.4, -1.4], CREDIT_FOR = 180;

// Where the ground painter draws winter snow: its own palette (art/seasons.js), read rather than restated, so a print
// never sits white-tinted on bare ground or the other way round. Snow and ice always; otherwise a near-white, grey
// palette in that season (the same luminance and chroma test as terrain.js's snowy)
const SNOWY = new Int8Array(BIOMES.length * 4).fill(-1);
function snowy(b, season) {
  if (b === B.SNOW || b === B.ICE) return true;
  const k = b * 4 + season;
  if (SNOWY[k] < 0) {
    const info = BIOMES[b], c = !info.water && seasonalPalette(b, info, season)?.[0];
    const lum = c ? (c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114) / 255 : 0, chroma = c ? (Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2])) / 255 : 1;
    SNOWY[k] = lum > 0.72 && chroma < 0.12 ? 1 : 0;
  }
  return SNOWY[k] === 1;
}
// The 8-point compass word of a direction (north is -y: the latitude falls with y; east is +x)
export function compass(dx, dy) { return DIRS[((Math.round(Math.atan2(dx, -dy) / (Math.PI / 4)) % 8) + 8) % 8]; }
// A stable 32-bit hash of a string (FNV-1a): the backtrail's seed from the wild id
function strHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h | 0; }
const chunkKey = (cx, cy) => (wrapIndex(cx, CHUNK) + 8192) * 65536 + (cy + 32768);
const tileKey = (tx, ty) => (tx + 65536) * 131072 + (ty + 65536);
// The 'tracker' achievement (progress.js ACH, track GN): a locked trail followed 60 m or more to the prey
export const trackerDone = g => (g?.stats?.get?.('trailsFollowed') || 0) > 0;

export class Tracks {
  constructor(game) {
    this.game = game;
    this.off = apagada('tracks');
    // The marks, as a structure of arrays in a ring (the oldest slot is reused first)
    this.X = new Float32Array(CAP); this.Y = new Float32Array(CAP); this.H = new Float32Array(CAP);
    this.YAW = new Float32Array(CAP); this.NX = new Float32Array(CAP); this.NZ = new Float32Array(CAP);
    // (when it was made on one clock for prints and blood, which the order of a trail goes by: BORN is on each mark's own
    // clock, and those drift apart with every snowfall)
    this.ORD = new Float64Array(CAP);
    this.BORN = new Float32Array(CAP); this.TTL = new Float32Array(CAP); this.GH = new Float32Array(CAP); this.SC = new Float32Array(CAP);
    this.DG = new Float32Array(CAP);   // (the dug height of its tile when made, NaN if not dug: a change drops it)
    this.CK = new Float64Array(CAP);   // (its chunk key)
    this.KIND = new Uint8Array(CAP).fill(DEAD); this.SUB = new Uint8Array(CAP); this.SURF = new Uint8Array(CAP); this.FL = new Uint8Array(CAP);
    this.HL = new Uint8Array(CAP); this.TR = new Int32Array(CAP); this.SEQ = new Uint32Array(CAP);
    this.chunks = new Map();   // chunk key → Set of mark indices
    this.recs = new Map();     // src → trail { id, src, type, list (indices, oldest first), back, bk, studied, seen, w }
    this.byId = new Map();     // trail id → the same trail
    this.wild = new WeakMap(); // wild animal → its print state
    this.surf = new Map();     // tile → surface (see surfIx)
    this.aheadA = []; this.aheadB = [];
    this.backQ = [];
    this.reset();
  }
  reset() {
    if (this.count) { this.KIND.fill(DEAD); this.HL.fill(0); }
    this.chunks.clear(); this.recs.clear(); this.byId.clear(); this.surf.clear();
    this.wild = new WeakMap();
    this.head = 0; this.scanI = 0; this.nid = 0;
    this.seq ||= 0;            // (never restarts: tracks3d keeps each slot's matrix by it)
    this.count = 0;            // marks alive
    this.ver = (this.ver || 0) + 1;   // bumped on every change of the marks
    this.hver = (this.hver || 0) + 1; // bumped on every change of the highlighted set
    this.now = 0; this.clkP = 0; this.clkB = 0; this.liveT = 0; this.tickT = 0; this.cleanT = 0;
    this.locked = null;        // the src of the locked trail
    this.stalking = false;
    this.hover = null;
    this.freshNear = false;
    this.why = null;           // why it is locked: 'study' or 'blood' (your own hit)
    this.bleeding = false;
    this.fallen = false;       // the locked trail's animal bled out of your wound: its end is its body
    this.readK = 0;
    this.aheadA.length = 0; this.aheadB.length = 0; this.ahead_ = this.aheadA;
    this.backQ.length = 0;
    this.surfStamp = [NaN, NaN, NaN, NaN]; this.digV = undefined; this.touchV = undefined; this.credit = null; this.aimFor = null; this.aimOut = null;
    this.lockGone = false; this.aheadAt = 0; this.saidWater = false; this.saidBed = false; this.walked = 0; this.lastPX = NaN; this.lastPY = 0;
  }

  // ---------- every frame ----------
  update(dt) {
    if (!(dt > 0)) return;
    const g = this.game, w = g.world, p = g.player, info = g.days?.info;
    this.now += dt;
    // (the marks' own clocks: rain washes everything faster, falling snow covers prints faster)
    this.clkP += dt * (info?.rain ? RAIN_K : info?.snow ? SNOW_K : 1);
    this.clkB += dt * (info?.rain ? RAIN_K : 1);
    if (this.count) this.expire();
    if (this.off) return;
    const live = !!g.view3d?.world && !!w && g.scene === w && !!p;
    const read = live && p.crouch && !p.swim ? 1 : 0, step = dt / READ_EASE;
    this.readK = read > this.readK ? Math.min(read, this.readK + step) : Math.max(read, this.readK - step);
    if (!live) { this.hover = null; this.freshNear = false; this.stalking = false; this.lastPX = NaN; return; }
    this.liveT += dt;
    if (w.digV !== this.digV) { const first = this.digV === undefined; this.digV = w.digV; this.surf.clear(); if (!first) this.dropDug(); }
    this.makePrints(p);
    if (this.backQ.length) this.pumpBack();
    if (this.locked) {
      const d = Number.isNaN(this.lastPX) ? 0 : distOf(p.x, p.y, this.lastPX, this.lastPY);
      if (d < 5) this.walked += d;   // (since the last step along the trail: follow)
    }
    this.lastPX = p.x; this.lastPY = p.y;
    if ((this.tickT += dt) >= TICK) { this.tickT = 0; this.tick(p); }
  }
  // Marks past their time go, a slice of the ring per frame (all of it in about a quarter of a second)
  expire() {
    const KIND = this.KIND, BORN = this.BORN, TTL_ = this.TTL;
    for (let n = 0; n < SCAN; n++) {
      const i = this.scanI;
      this.scanI = i + 1 === CAP ? 0 : i + 1;
      const k = KIND[i];
      if (k !== DEAD && (isBlood(k) ? this.clkB : this.clkP) - BORN[i] >= TTL_[i]) this.kill(i);
    }
  }
  // The prints of the wild animals within RANGE of the player: one per stride, alternating feet, blood while bleeding and
  // pools where a wounded one lies
  makePrints(p) {
    const g = this.game, list = g.wildlife?.list;
    if (!list) return;
    for (let n = 0; n < list.length; n++) {
      const a = list[n], kind = PRINT_OF[a.type];
      if (kind === undefined) continue;   // (the swan lives on water: no prints)
      let st = this.wild.get(a);
      if (distOf(a.x, a.y, p.x, p.y) > RANGE) { if (st) st.far = true; continue; }
      if (!st) { st = { key: null, sx: undefined, sy: undefined, rec: null, lx: a.x, ly: a.y, acc: 0, bacc: 0, side: 1, lying: false, poolN: 0, poolT: 0, far: false }; this.wild.set(a, st); }
      if (!st.rec || st.sx !== a.sx || st.sy !== a.sy) { st.sx = a.sx; st.sy = a.sy; st.key = trailKey(a); st.rec = this.recFor(st.key, a.type); }
      const rec = st.rec;
      rec.seen = this.now; rec.w = a; rec.type ||= a.type;
      if (!rec.back) this.planBack(rec, a);
      if (st.far) { st.far = false; st.lx = a.x; st.ly = a.y; st.acc = st.bacc = 0; }   // (back in range: nothing across the gap)
      const dx = dxOf(a.x, st.lx), dy = a.y - st.ly, d = Math.hypot(dx, dy);
      if (d > JUMP) { st.lx = a.x; st.ly = a.y; st.acc = st.bacc = 0; }   // (a teleport or a net correction prints nothing)
      else if (d > 1e-4) {
        st.lx = a.x; st.ly = a.y;
        const ux = dx / d, uy = dy / d, yaw = Math.atan2(uy, ux);
        const flee = a.scared > g.time || Math.hypot(a.vx || 0, a.vy || 0) > 1.5 * WALK[a.type];
        const stride = STRIDE[a.type][flee ? 1 : 0], k = K[kind];
        st.acc += d;
        while (st.acc >= stride) {
          st.acc -= stride;
          st.side = -st.side;
          const bx = a.x - ux * st.acc, by = a.y - uy * st.acc, o = SIDE * st.side;
          this.lay(rec, k, bx - uy * o, by + ux * o, yaw, -1, flee, 1, 0, 0, st.side < 0);
        }
        const bl = a.gutshot ? 1 : Math.min(2, a.bleed | 0);   // (shot in the gut it bleeds little, however bad it is: wildlife.js)
        if (bl > 0) {
          st.bacc += d;
          const every = BLOOD_EVERY[bl];
          while (st.bacc >= every) {
            st.bacc -= every;
            const j = this.seq, ox = (ihash(j, 1, 77) - 0.5) * 0.3, oy = (ihash(j, 2, 77) - 0.5) * 0.3;
            this.lay(rec, flee ? K.bloodLong : K.blood, a.x - ux * st.bacc + ox, a.y - uy * st.bacc + oy, yaw, -1, flee, bl > 1 ? 1.35 : 1, bl, 0, false);   // (a heavy wound drips bigger drops)
          }
        } else st.bacc = 0;
      }
      // (a lying wounded animal bleeds into a pool, another every POOL_EVERY s, up to POOL_MAX each time it lies down)
      if (a.lying) {
        if (!st.lying) { st.lying = true; st.poolN = 0; st.poolT = -1e9; }
        if (st.poolN < POOL_MAX && this.now - st.poolT >= POOL_EVERY) {
          st.poolN++; st.poolT = this.now;
          const j = this.seq;
          this.lay(rec, K.bloodPool, a.x + (ihash(j, 3, 77) - 0.5) * 0.3, a.y + (ihash(j, 4, 77) - 0.5) * 0.3, ihash(j, 5, 77) * TWO_PI, -1, false, 1, 2, 0, false);
        }
      } else st.lying = false;
    }
  }

  // ---------- the backtrail ----------
  // Animals spawn only 14-26 m from a player, so their own prints would be short scribbles: every game lays the same walk
  // of 25-40 m that ends at the spawn point (w.sx, w.sy, sent by the host), aged as if made 1-4 minutes earlier. It is
  // deterministic (ihash of the world seed, the id and the spawn point) and avoids water, the village and what is built.
  // The walk is traced a few steps per frame and its prints laid a few per frame (no hitch when an animal appears)
  planBack(rec, a) {
    rec.back = true;
    if (!Number.isFinite(a.sx) || !Number.isFinite(a.sy) || !STRIDE[a.type]) return;
    const h0 = (ihash(strHash(String(a.id)), Math.round(a.sx * 4), Math.round(a.sy * 4) ^ WORLD_SEED) * 4294967296) | 0;
    const r = k => ihash(h0, k, WORLD_SEED);
    rec.bk = { r, kind: K[PRINT_OF[a.type]], x: a.sx, y: a.sy, th: r(2) * TWO_PI, L: BACK_L[0] + (BACK_L[1] - BACK_L[0]) * r(0), walked: 0, n: 0, pts: [a.sx, a.sy], age0: BACK_AGE[0] + (BACK_AGE[1] - BACK_AGE[0]) * r(1), lay: -1, ages: null };
    this.backQ.push(rec);
  }
  pumpBack() {
    const rec = this.backQ[0], b = rec.bk;
    if (!b) { this.backQ.shift(); return; }
    if (b.lay < 0) {
      // Tracing, backwards from the spawn point: each step turns a little; a blocked step tries turning more, then stops
      for (let s = 0; s < BACK_WALK && b.walked < b.L; s++) {
        b.th += (b.r(10 + b.n) - 0.5) * 0.6;
        let ok = false;
        for (const turn of TURNS) {
          const nx = wrapX(b.x + Math.cos(b.th + turn) * BACK_STEP), ny = b.y + Math.sin(b.th + turn) * BACK_STEP;
          if (!this.walkable(nx, ny)) continue;
          b.th += turn; b.x = nx; b.y = ny; ok = true; break;
        }
        if (!ok) { b.walked = b.L; break; }
        b.pts.push(b.x, b.y); b.walked += BACK_STEP; b.n++;
      }
      if (b.walked < b.L) return;
      // (no way out of the spawn point: an islet, a tight cove, a place it was summoned to; nothing to lay)
      if (b.pts.length < 4) { rec.bk = null; this.backQ.shift(); return; }
      // (the ages: the spawn point is the youngest; each step back took a walking step with its pauses)
      const N = b.pts.length / 2, ages = b.ages = new Float32Array(N);
      ages[0] = b.age0;
      for (let k = 1; k < N; k++) ages[k] = ages[k - 1] + (BACK_STEP / BACK_SPEED) * (1 + 1.5 * b.r(200 + k));
      b.lay = N - 1;
    }
    // Laying, oldest first: each print faces the next point of the walk (towards the spawn point)
    const P = b.pts;
    for (let s = 0; s < BACK_LAY && b.lay >= 0; s++, b.lay--) {
      const k = b.lay, x = P[k * 2], y = P[k * 2 + 1], nx = k ? P[k * 2 - 2] : x, ny = k ? P[k * 2 - 1] : y;
      let dx = dxOf(nx, x), dy = ny - y;
      if (!k) { dx = dxOf(x, P[2]); dy = y - P[3]; }
      const l = Math.hypot(dx, dy) || 1, left = (k & 1) === 1, o = left ? -SIDE : SIDE;
      this.lay(rec, b.kind, x - (dy / l) * o, y + (dx / l) * o, Math.atan2(dy, dx), -1, false, 1, 0, b.ages[k], left);
    }
    if (b.lay < 0) { rec.bk = null; this.backQ.shift(); }
  }
  // Where an animal could have walked: not water, not the village, nothing built
  walkable(x, y) {
    const w = this.game.world;
    if (inBounds(x, y) || w.water(x, y)) return false;
    const tx = Math.floor(x), ty = Math.floor(y);
    return !w.roofAt(tx, ty) && !w.at('floor', tx, ty);
  }

  // ---------- the marks ----------
  // A mark of any source (see the contract at the top)
  print(src, kind, x, y, yaw, opts = NO_OPTS) {
    if (this.off || src == null) return -1;
    const k = K[kind];
    if (k === undefined) return -1;
    const surf = opts.surf != null ? SURFACES.indexOf(opts.surf) : -1;
    if (opts.surf != null && surf < 0) return -1;
    const rec = this.recFor(String(src), opts.type ?? SPECIES_OF[kind] ?? null);
    return this.lay(rec, k, x, y, yaw || 0, surf, !!opts.flee, opts.scale ?? 1, opts.bleed ?? (isBlood(k) ? 1 : 0), opts.age ?? 0, !!opts.left);
  }
  // (s: the surface index, or -1 to read it; bleed: 0-2; age: seconds already passed)
  lay(rec, k, x, y, yaw, s, flee, scale, bleed, age, left) {
    const g = this.game, w = g.world, view = g.view3d;
    if (!w || !view?.world || !Number.isFinite(x) || !Number.isFinite(y)) return -1;
    x = wrapX(x);
    if (s < 0) s = this.surfIx(x, y);
    const blood = isBlood(k);
    if (s === S.water || (s === S.none && !blood) || w.water(x, y)) return -1;   // (the tile may be dry and its edge in the water)
    if (s === S.soil && (view.wetNow || 0) > 0.5) s = S.mud;   // (rain-soaked earth takes prints like mud)
    const ttl = blood ? BLOOD_TTL[k === K.bloodPool ? 2 : Math.min(2, bleed)] * (s === S.none ? NONE_K : 1) : TTL[s];
    if (age >= ttl) return -1;
    const born = (blood ? this.clkB : this.clkP) - age, fl = (left ? F_LEFT : 0) | (flee ? F_FLEE : 0) | ((Math.min(3, bleed | 0)) << F_BLEED);
    const sc = scale * (flee && !blood ? 1.12 : 1) * (s === S.snow && !blood ? 1.15 : 1);
    // (in tall grass a print is one or two bent-grass flecks over the tufts; tracks3d draws it flat beyond the grass LOD)
    const bent = s === S.grass && !blood && k !== K.bentGrass;
    const i = this.put(rec, bent ? K.bentGrass : k, k, x, y, yaw, s, born, ttl, sc, fl, age);
    if (bent && ihash(this.SEQ[i], 9, 77) < 0.5) {
      const o = 0.12, sx = -Math.sin(yaw) * o, sy = Math.cos(yaw) * o;
      this.put(rec, K.bentGrass, k, x + sx, y + sy, yaw + 0.5, s, born, ttl, sc, fl | F_SECOND, age);
    }
    return i;
  }
  // Store one mark in the next slot (the one there, if alive, goes): its height and slope from three ground samples
  put(rec, kind, sub, x, y, yaw, s, born, ttl, sc, fl, age = 0) {
    const g = this.game, w = g.world, view = g.view3d;
    const i = this.head;
    this.head = i + 1 === CAP ? 0 : i + 1;
    if (this.KIND[i] !== DEAD) this.kill(i);
    x = wrapX(x);
    const h = view.groundY(w, x, y), hx = view.groundY(w, x + 0.25, y), hz = view.groundY(w, x, y + 0.25);
    let nx = -(hx - h) / 0.25, nz = -(hz - h) / 0.25;
    const nl = Math.hypot(nx, 1, nz); nx /= nl; nz /= nl;
    const tx = Math.floor(x), ty = Math.floor(y), dg = w.digH?.(tx, ty);
    this.X[i] = x; this.Y[i] = y; this.H[i] = h; this.YAW[i] = yaw; this.NX[i] = nx; this.NZ[i] = nz;
    this.BORN[i] = born; this.TTL[i] = ttl; this.SC[i] = sc; this.DG[i] = dg ?? NaN;
    this.GH[i] = s === S.grass ? (w.gen.grassAt(tx, ty) || 0) * (w.gen.season === 3 ? 0.6 : 1) : 0;
    this.KIND[i] = kind; this.SUB[i] = sub; this.SURF[i] = s; this.FL[i] = fl; this.HL[i] = 0;
    this.TR[i] = rec.id; this.SEQ[i] = ++this.seq;
    const ck = chunkKey(Math.floor(x / CHUNK), Math.floor(y / CHUNK));
    this.CK[i] = ck;
    let set = this.chunks.get(ck);
    if (!set) this.chunks.set(ck, set = new Set());
    set.add(i);
    // (the trail's list stays oldest first: the backtrail is laid while the animal makes fresh prints)
    const L = rec.list, O = this.ORD, ord = O[i] = this.now - age;
    let j = L.length;
    while (j > 0 && O[L[j - 1]] > ord) j--;
    if (j === L.length) L.push(i); else L.splice(j, 0, i);
    this.count++; this.ver++;
    return i;
  }
  kill(i) {
    const ck = this.CK[i], set = this.chunks.get(ck);
    if (set) { set.delete(i); if (!set.size) this.chunks.delete(ck); }
    const rec = this.byId.get(this.TR[i]);
    if (rec) { const j = rec.list.indexOf(i); if (j >= 0) rec.list.splice(j, 1); }
    if (this.HL[i]) { this.HL[i] = 0; this.hver++; }
    this.KIND[i] = DEAD; this.count--; this.ver++;
  }
  // The shovel changed some tiles: marks whose tile is no longer as it was go
  dropDug() {
    const w = this.game.world;
    for (let i = 0; i < CAP; i++) {
      if (this.KIND[i] === DEAD) continue;
      const v = w.digH(Math.floor(this.X[i]), Math.floor(this.Y[i])), was = this.DG[i];
      if (v === null || v === undefined ? !Number.isNaN(was) : Number.isNaN(was) || Math.abs(v - was) > 1e-3) this.kill(i);
    }
  }
  // Something changed in some chunk: where the tall grass is gone (cut or grazed), its bent-grass flecks become the flat
  // prints they stand for (a fleck never stands on cut grass); where a floor or a roof went up, they go
  cutGrass(w) {
    const day = this.game.days?.dayIndex ?? 0;
    for (let i = 0; i < CAP; i++) {
      if (this.KIND[i] !== K.bentGrass) continue;
      const tx = Math.floor(this.X[i]), ty = Math.floor(this.Y[i]);
      const d = w.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK));
      if (!d) continue;   // (a chunk nobody has changed; not grassAt, which samples the ground's slope: a scythe's sweep is many touches)
      const built = w.roofAt(tx, ty) || w.at('floor', tx, ty);
      if (!built && !w.mownAt(tx, ty, day) && d.tilled?.[`${tx},${ty}`] === undefined) continue;
      if (this.FL[i] & F_SECOND || built) { this.kill(i); continue; }
      this.KIND[i] = this.SUB[i]; this.SURF[i] = S.soil; this.GH[i] = 0; this.ver++;
    }
  }
  recFor(src, type) {
    let rec = this.recs.get(src);
    if (!rec) {
      rec = { id: ++this.nid, src, type: type || null, list: [], back: false, bk: null, studied: false, seen: this.now, w: null, from: -Infinity, fol: 0, folOrd: -Infinity };
      this.recs.set(src, rec); this.byId.set(rec.id, rec);
    }
    return rec;
  }
  // (every 2 s: trails with no marks left, not locked and not seen for a while, are forgotten)
  cleanRecs() {
    for (const [src, rec] of this.recs) if (!rec.list.length && !rec.bk && src !== this.locked && this.now - rec.seen > 30) { this.recs.delete(src); this.byId.delete(rec.id); }
  }

  // ---------- the ground ----------
  surfaceAt(x, y) {
    if (!this.game.world) return 'none';
    const s = this.surfIx(wrapX(x), y);
    return SURFACES[s === S.water ? S.none : s];
  }
  // The surface of a tile, cached until something changes there: what is dug (digV), built or mown (touches), the day
  // (grass grows back) or the season
  surfIx(x, y) {
    const g = this.game, w = g.world, st = this.surfStamp, day = g.days?.dayIndex ?? 0;
    if (st[0] !== w.digV || st[1] !== w.touches || st[2] !== day || st[3] !== w.gen.season) { this.surf.clear(); st[0] = w.digV; st[1] = w.touches; st[2] = day; st[3] = w.gen.season; }
    const tx = Math.floor(x), ty = Math.floor(y), key = tileKey(tx, ty);
    let s = this.surf.get(key);
    if (s === undefined) {
      if (this.surf.size >= SURF_MAX) this.surf.clear();
      this.surf.set(key, s = this.surfOf(tx, ty, day));
    }
    return s;
  }
  surfOf(tx, ty, day) {
    const w = this.game.world, x = tx + 0.5, y = ty + 0.5;
    if (w.water(x, y)) return S.water;
    if (inBounds(x, y) && distToPath(x, y) < 1.05) return S.none;   // (the village paths)
    if (w.roofAt(tx, ty) || w.at('floor', tx, ty)) return S.none;   // (built, as wildlife.built: there is no floorAt)
    const L = w.levelAt(x, y);
    if (L !== null && L !== undefined && L > 0.01) return S.none;   // (a lift: a stone foundation, a raised floor)
    const b = w.gen.biomeAt(x, y);
    if (snowy(b, w.gen.season)) return S.snow;
    if (b === B.ROCKY) return S.none;
    if (b === B.SWAMP || this.nearWater(x, y)) return S.mud;
    if (b === B.BEACH || b === B.DESERT) return S.sand;
    if (w.digH(tx, ty) === null && w.grassAt(tx, ty, day)) return S.grass;
    return S.soil;   // (forest and pine floor, dug or tilled earth, mown or grazed grass)
  }
  nearWater(x, y) {
    const w = this.game.world, r = WATER_NEAR;
    return !!(w.water(x, y) || w.water(wrapX(x + r), y) || w.water(wrapX(x - r), y) || w.water(x, y + r) || w.water(x, y - r));
  }

  // ---------- lookups ----------
  // fn(idx) for every mark within r of (x, y)
  each(x, y, r, fn) {
    if (!this.count) return;
    x = wrapX(x);
    const X = this.X, Y = this.Y, r2 = r * r;
    const cx0 = Math.floor((x - r) / CHUNK), cx1 = Math.floor((x + r) / CHUNK), cy0 = Math.floor((y - r) / CHUNK), cy1 = Math.floor((y + r) / CHUNK);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const set = this.chunks.get(chunkKey(cx, cy));
      if (set) for (const i of set) { const dx = dxOf(X[i], x), dy = Y[i] - y; if (dx * dx + dy * dy <= r2) fn(i); }
    }
  }
  near(x, y, r, out = []) { this.each(x, y, r, i => out.push(i)); return out; }
  // How many animals of a species left marks within r of (x, y) (their trails: a group passed), for the tracking perk of
  // reading how many went by (ui/fieldhud.js). The set is kept and reused
  herdAt(x, y, r, type) {
    const S = (this.srcSet ||= new Set());
    S.clear();
    this.each(x, y, r, i => { const rec = this.byId.get(this.TR[i]); if (rec?.type === type) S.add(rec.id); });
    return S.size;
  }
  at(x, y, r) { return this.nearest(x, y, r, false); }
  // (the nearest mark within r; wild: only marks of a trail with a species, so a player's own boots are never tagged)
  nearest(x, y, r, wild) {
    if (!this.count) return -1;
    x = wrapX(x);
    const X = this.X, Y = this.Y;
    let best = -1, bd = r * r;
    const cx0 = Math.floor((x - r) / CHUNK), cx1 = Math.floor((x + r) / CHUNK), cy0 = Math.floor((y - r) / CHUNK), cy1 = Math.floor((y + r) / CHUNK);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const set = this.chunks.get(chunkKey(cx, cy));
      if (set) for (const i of set) {
        const dx = dxOf(X[i], x), dy = Y[i] - y, d = dx * dx + dy * dy;
        if (d <= bd && (!wild || this.byId.get(this.TR[i])?.type)) { bd = d; best = i; }
      }
    }
    return best;
  }
  trail(src) { return this.recs.get(src)?.list || []; }
  info(idx) {
    if (!(idx >= 0 && idx < CAP) || this.KIND[idx] === DEAD) return null;
    const k = this.KIND[idx], sub = this.SUB[idx], rec = this.byId.get(this.TR[idx]), blood = isBlood(k);
    const age = (blood ? this.clkB : this.clkP) - this.BORN[idx];
    return {
      kind: KINDS[k], print: KINDS[sub], type: rec?.type ?? SPECIES_OF[KINDS[sub]] ?? null, src: rec?.src ?? null,
      x: this.X[idx], y: this.Y[idx], born: this.BORN[idx], ttl: this.TTL[idx], age, ageKey: age < FRESH ? 'fresh' : age < RECENT ? 'recent' : 'old',
      heading: this.headingOf(idx, rec), blood: blood ? (this.FL[idx] >> F_BLEED) & 3 : 0, flee: !!(this.FL[idx] & F_FLEE), surf: SURFACES[this.SURF[idx] === S.water ? 0 : this.SURF[idx]],
    };
  }
  // Where the trail goes from a mark: towards its next mark (skipping ones laid on the spot), else the print's own way
  headingOf(idx, rec) {
    const L = rec?.list, j = L ? L.indexOf(idx) : -1, x = this.X[idx], y = this.Y[idx];
    if (j >= 0) for (let n = j + 1; n < L.length && n <= j + 6; n++) {
      const dx = dxOf(this.X[L[n]], x), dy = this.Y[L[n]] - y;
      if (dx * dx + dy * dy > 0.09) return compass(dx, dy);
    }
    const k = this.KIND[idx];
    return k === K.bloodPool || k === K.blood ? '' : compass(Math.cos(this.YAW[idx]), Math.sin(this.YAW[idx]));
  }

  // ---------- the locked trail ----------
  // (rec.from: after your hit only what it left from then on is highlighted, not its wandering before. rec.fol: the metres
  // followed, kept with the trail: locking again the one you just found, by hitting its animal, does not lose them)
  lock(src, why = 'study') {
    if (this.off || src == null) return;
    src = String(src);
    const rec = this.recFor(src, null), other = this.locked !== src;
    rec.seen = this.now;
    if (why === 'blood') { if (other || !(rec.from > -Infinity)) rec.from = this.now; }
    else if (other) rec.from = -Infinity;
    if (other) {
      this.locked = src;
      this.lockGone = false; this.saidWater = false; this.saidBed = false; this.fallen = false; this.aheadAt = this.liveT;
      this.walked = 0;
      this.hver++;
    }
    if (other || why === 'blood') this.why = why;
  }
  // Metres of the locked trail followed (the tracker's reward counts them)
  get followed() { return this.locked === null ? 0 : this.recs.get(this.locked)?.fol || 0; }
  unlock() {
    this.locked = null; this.stalking = false; this.why = null; this.bleeding = false; this.fallen = false;
    const A = this.ahead_;
    for (let n = 0; n < A.length; n++) this.HL[A[n]] = 0;
    A.length = 0;
    this.hver++;
  }
  ahead() { return this.ahead_; }
  // (Plan R3-4: your dog searching the locked trail, huntcode.js) Where it goes next: the furthest mark highlighted ahead of you
  // or, with none (a lost trail), its nose: a few marks on from the one nearest it, within NOSE_R. [x, y] (reused) or null
  scentAhead(ax, ay) {
    const rec = this.locked === null ? null : this.recs.get(this.locked), A = this.ahead_, P = this.noseAt ||= [0, 0];
    if (!rec) return null;
    if (A.length) { const i = A[A.length - 1]; P[0] = this.X[i]; P[1] = this.Y[i]; return P; }
    const L = rec.list;
    let best = -1, bd = NOSE_R * NOSE_R;
    for (let j = 0; j < L.length; j++) { if (this.ORD[L[j]] < rec.from) continue; const dx = dxOf(this.X[L[j]], ax), dy = this.Y[L[j]] - ay, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = j; } }
    if (best < 0) return null;
    const i = L[Math.min(L.length - 1, best + 3)];
    P[0] = this.X[i]; P[1] = this.Y[i];
    return P;
  }
  // (and while it has a mark to go to, the trail is not given up for lost)
  keep() { if (this.locked !== null) this.aheadAt = this.liveT; }

  // ---------- ten times a second ----------
  tick(p) {
    this.hoverTick(p);
    this.freshTick(p);
    this.aimFor = null;   // (the E target is made again from this choice)
    if (this.locked) this.lockTick(p);
    const w = this.game.world;
    if (w.touches !== this.touchV) { const first = this.touchV === undefined; this.touchV = w.touches; if (!first && this.count) this.cutGrass(w); }
    if ((this.cleanT += TICK) >= 2) { this.cleanT = 0; this.cleanRecs(); }
  }
  // The mark under the cursor (in first person the cursor is the crosshair: game.js centres the mouse when locked)
  hoverTick(p) {
    const g = this.game, m = g.mouse;
    let i = -1;
    // (where this frame's ray meets the ground's height at each mark near the player: the same as the ground point under
    // the cursor, without marching the ray over the terrain (engine pointAt, 1.5 ms))
    // (an animal under the cursor hides the marks behind it: the look is at the animal, not at the ground)
    const ray = this.count && !g.nature?.onAnimal && m?.in && g.mode === 'play' && !g.busy ? g.rayNow?.() : null;
    if (ray && ray.d[1] < -1e-3) {
      const { o, d } = ray, X = this.X, Y = this.Y, H = this.H, lk = this.locked;
      let bd = HOVER_R * HOVER_R;
      this.each(p.x, p.y, HOVER_SEE, j => {
        const tt = (H[j] - o[1]) / d[1];
        if (!(tt > 0)) return;
        const dx = dxOf(o[0] + d[0] * tt, X[j]), dy = o[2] + d[2] * tt - Y[j], q = dx * dx + dy * dy;
        if (q > bd) return;
        const rec = this.byId.get(this.TR[j]);
        if (!rec?.type || (rec.src !== lk && this.faint(j) && !(this.readK > 0.5 && distOf(X[j], Y[j], p.x, p.y) <= READ_R))) return;
        bd = q; i = j;
      });
    }
    if (i < 0) { this.hover = null; return; }
    const reach = distOf(this.X[i], this.Y[i], p.x, p.y) <= REACH + REACH_MORE;
    if (!this.hover || this.hover.idx !== i || this.hover.reach !== reach) this.hover = { idx: i, reach };
  }
  faint(i) { return (isBlood(this.KIND[i]) ? this.clkB : this.clkP) - this.BORN[i] > FAINT * this.TTL[i]; }
  // A fresh print of a wild trail within FRESH_R of the player (the first one shows the tracks tip)
  freshTick(p) {
    let fresh = false;
    if (this.count) {
      const X = this.X, Y = this.Y, x = wrapX(p.x), y = p.y, r2 = FRESH_R * FRESH_R;
      const cx0 = Math.floor((x - FRESH_R) / CHUNK), cx1 = Math.floor((x + FRESH_R) / CHUNK), cy0 = Math.floor((y - FRESH_R) / CHUNK), cy1 = Math.floor((y + FRESH_R) / CHUNK);
      for (let cy = cy0; cy <= cy1 && !fresh; cy++) for (let cx = cx0; cx <= cx1 && !fresh; cx++) {
        const set = this.chunks.get(chunkKey(cx, cy));
        if (set) for (const i of set) {
          const k = this.KIND[i];
          if (isBlood(k) || this.clkP - this.BORN[i] >= FRESH) continue;
          const dx = dxOf(X[i], x), dy = Y[i] - y;
          if (dx * dx + dy * dy <= r2 && this.byId.get(this.TR[i])?.type) { fresh = true; break; }
        }
      }
    }
    this.freshNear = fresh;
  }
  // The E target: the mark of the tag (hover), in reach, if there is something left to do with it. The tag and E answer to
  // the same mark, so a tag without "(come closer)" always has its E
  canStudy(i) {
    const rec = this.byId.get(this.TR[i]);
    if (!rec?.type || this.KIND[i] === DEAD) return false;
    if (rec.src !== this.locked) return true;
    return !isBlood(this.KIND[i]) && !this.game.nature?.knowsTracks?.(rec.type);   // (nothing left to study on the trail you already follow)
  }
  aimables(p, sc, box) {
    const g = this.game, h = this.hover;
    if (this.off || !h?.reach || !p || sc !== g.world || !g.view3d?.world || g.gamemode === 'spectator') return null;
    if (this.aimFor !== h) {
      // (made again only when the choice changes or ten times a second: the same entry every frame otherwise; run checks seq)
      this.aimFor = h;
      const i = h.idx, seq = this.SEQ[i], text = isBlood(this.KIND[i]) ? 'tracks.follow' : 'tracks.study';
      this.aimOut = this.canStudy(i) ? [{ kind: 'sys', track: i, box: box(this.X[i], this.Y[i], HOVER_R, HOVER_R, 0, 0.08), act: () => ({ text: t(text), run: () => this.study(i, seq) }) }] : null;
    }
    return this.aimOut;
  }
  // E on a mark: its species' tracks go in the book (prints only: blood tells nothing of the foot), the trail is locked
  study(i, seq) {
    const g = this.game;
    if (this.KIND[i] === DEAD || this.SEQ[i] !== seq) return;
    const rec = this.byId.get(this.TR[i]);
    if (!rec) return;
    const type = rec.type || SPECIES_OF[KINDS[this.SUB[i]]] || null, n = g.nature;
    if (type && !isBlood(this.KIND[i])) {
      const knew = !!n?.knowsTracks?.(type);
      n?.learnTracks?.(type);
      if (!knew && n?.knowsTracks?.(type)) g.gather?.float(t('tracks.learned', { name: t(`nature.name.${type}`) }), '#d6e8a0');
    }
    this.lock(rec.src, 'study');
    this.aimFor = null;
    if (!rec.studied) { rec.studied = true; g.skills?.gain('tracking', 3); }
    g.gather?.float(t('tracks.following', { name: type ? t(`nature.name.${type}`) : t('tracks.label.unknown') }), '#e8d6a8');
    Audio.blip();
  }
  // The locked trail: what to highlight, and whether it was lost, reaches the water, or led to its animal
  lockTick(p) {
    const g = this.game, rec = this.recs.get(this.locked);
    if (!rec) { this.unlock(); return; }
    const list = g.wildlife?.list, a = rec.w && list?.includes(rec.w) ? rec.w : null;
    const da = a ? distOf(a.x, a.y, p.x, p.y) : Infinity, R = HL_R + 2 * (g.skills?.level?.('tracking') || 0);
    this.stalking = !!a && da <= STALK_R;
    this.bleeding = !!a && a.bleed > 0 && this.why === 'blood';
    if (!a || da > GONE_R) this.lockGone = true;
    // (what a kill in the next few minutes would be credited to: also after the trail ends by finding its animal)
    const c = this.credit ||= { src: null, followed: 0, until: 0 };
    if (a || c.src !== rec.src) c.until = this.liveT + CREDIT_FOR;
    c.src = rec.src; c.followed = rec.fol;
    // (found: once it has been out of sight, coming within FOUND_R of it ends the trail, unless it bleeds: it may get up and
    // run again, and that run is what there is to follow. A lying one says so, each time it lies down)
    if (a && da <= FOUND_R && this.lockGone) {
      if (a.lying) { if (!this.saidBed) { this.saidBed = true; g.gather?.float(t('tracks.bedded'), '#fff3c0'); } }
      else if (!(a.bleed > 0)) { this.unlock(); return; }
    }
    if (a && !a.lying) this.saidBed = false;
    this.findAhead(rec, p, R);
    const A = this.ahead_, L = rec.list, end = L.length ? L[L.length - 1] : -1;
    // (it bled out: its body lies at the end of the trail, highlighted until you get there)
    if (this.fallen && (end < 0 || distOf(this.X[end], this.Y[end], p.x, p.y) <= FALLEN_R)) { this.unlock(); return; }
    if (A.length || (a && da <= R)) this.aheadAt = this.liveT;
    else if (this.liveT - this.aheadAt >= LOST_AFTER) { if (!this.fallen) g.gather?.float(t('tracks.lost'), '#ffb0a0'); this.unlock(); return; }
    // (the trail reaches a bank and nothing new comes after it: no animal crosses, so it went along the bank)
    if (!this.saidWater && !this.fallen && A.length && A[A.length - 1] === end && (!a || da > GONE_R) && this.now - this.ORD[end] >= WATER_WAIT && this.nearWater(this.X[end], this.Y[end])) {
      this.saidWater = true; g.gather?.float(t('tracks.water'), '#bcd8ff');
    }
  }
  // Walking along the trail: from its mark nearest the player (d2: that far, squared) when it is further along than any
  // before, the metres walked since then, at most what the trail advanced. Walking in circles or away from it adds nothing
  follow(rec, i, d2) {
    if (d2 > FOLLOW_R * FOLLOW_R || this.ORD[i] <= rec.folOrd) return;
    if (rec.folOrd > -Infinity) rec.fol += Math.min(this.walked, distOf(this.X[i], this.Y[i], rec.folX, rec.folY) + 1);
    rec.folOrd = this.ORD[i]; rec.folX = this.X[i]; rec.folY = this.Y[i];
    this.walked = 0;
  }
  // The marks after the one nearest the player, within R, at most AHEAD_MAX; HL follows them
  findAhead(rec, p, R) {
    const L = rec.list, X = this.X, Y = this.Y, px = wrapX(p.x), py = p.y;
    let best = -1, bd = Infinity;
    for (let j = 0; j < L.length; j++) { const dx = dxOf(X[L[j]], px), dy = Y[L[j]] - py, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = j; } }
    if (best >= 0) this.follow(rec, L[best], bd);
    // (a trail locked by your hit: from where it was hit, not from where it wandered before)
    if (best >= 0 && this.ORD[L[best]] < rec.from) while (best + 1 < L.length && this.ORD[L[best + 1]] < rec.from) best++;
    const old = this.ahead_, nu = old === this.aheadA ? this.aheadB : this.aheadA, R2 = R * R;
    nu.length = 0;
    if (best >= 0) for (let j = best + 1; j < L.length && nu.length < AHEAD_MAX; j++) {
      const i = L[j], dx = dxOf(X[i], px), dy = Y[i] - py;
      if (dx * dx + dy * dy <= R2) nu.push(i);
    }
    let same = nu.length === old.length;
    for (let n = 0; same && n < nu.length; n++) same = nu[n] === old[n];
    if (same) { nu.length = 0; return; }
    for (let n = 0; n < old.length; n++) this.HL[old[n]] = 0;
    for (let n = 0; n < nu.length; n++) this.HL[nu[n]] = 1;
    old.length = 0;
    this.ahead_ = nu;
    this.hver++;
  }
  // You killed the animal of this trail, or it bled out of your wound (bled): hunt.js reward, in the game of whoever gets the
  // reward. The trail you followed FOLLOW_MIN metres or more to it (still locked, or found at most CREDIT_FOR s ago) gives
  // the tracker's reward. Killed, the trail ends; bled out, it stays highlighted until you reach the body
  taken(src, bled = false) {
    if (this.off || !src) return;
    const g = this.game, c = this.credit;
    if (c && c.src === src) {
      if (this.liveT <= c.until && c.followed >= FOLLOW_MIN) { g.skills?.gain('tracking', 10); g.stats?.add('trailsFollowed', 1); }
      this.credit = null;
    }
    if (this.locked !== src) return;
    const p = g.player, L = this.recs.get(src)?.list, end = L?.length ? L[L.length - 1] : -1;
    if (!bled || end < 0 || (g.scene === g.world && p && distOf(this.X[end], this.Y[end], p.x, p.y) <= FALLEN_R)) { this.unlock(); return; }
    this.fallen = true; this.bleeding = false;
    g.gather?.float(t('tracks.fallen'), '#fff3c0');
  }
}
