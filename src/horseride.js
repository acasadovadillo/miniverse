// Riding with weight (Plan R4-1, docs/planes/realismo/PLAN-R4-caballo.md §1.1-1.3 and §3.1-3.3): how the ridden horse speeds
// up, brakes, turns and goes through the gaits, what the ground, the slope and the water allow it, and what it brakes or
// refuses for. Pure functions over one small state (the player's R = p.ride, made once, never reallocated): the tests call
// them without a game. entities.js Player.update moves with it; horse.js prepRide writes what it needs to know each step
// (the hearts, the ground, the setting) and horse.js onRide does what happens (the stamina, the acts, the texts).
//
//   rideStep(R, dt) → '' | 'slide' | 'stopped'   the speed (R.v), the heading (R.a, R.face) and the gait (R.gait) of one step
//   probeAhead(R, x, y, z, near, reach, noLow)   the nearest solid thing in the corridor ahead → R.obs (m), R.obsLow
//   dodging(R, x, y, z, near, reach)             a trunk or a rock in its way that it can pass by: R.dodge (rad), how far it bends
//   braking(R, dt, ahead)  the auto-brake: R.max from R.obs; 'fence' when it is a fence and nobody jumps
//   slopeStep(R, scene, x, y)                    the grade along the heading, the caps it gives and whether it refuses
//
// Everything is in metres, seconds and radians; R.a is the heading as atan2(x, y), as the rest of the game has it.
import { collide } from './physics.js';

// The gaits by speed (R.gait is an index here). GT: the same as the network, the art and p.gait number them: 0 walk, 1 trot,
// 2 gallop, as before, and 3 the canter, so an older game never takes it for another gait (live.js reads it as none)
export const GAITS = ['walk', 'trot', 'canter', 'gallop'];
export const GT = [0, 1, 3, 2];
// m/s of a horse with 5 hearts. The bond: the canter and the gallop gain a little with each heart (so a trip takes what it
// took before R4: the tier of the canter was 7.0 m/s with no heart and 8.6 with ten)
export const SPEED = { walk: 3.4, trot: 5.6, canter: 7.6, gallop: 10.2 };
export const BOND_CANTER = 0.15, BOND_GALLOP = 0.05;
export const speedOf = (gait, love = 5) => (gait === 0 ? SPEED.walk : gait === 1 ? SPEED.trot : gait === 2 ? SPEED.canter + BOND_CANTER * (love - 5) : SPEED.gallop + BOND_GALLOP * love);
// The W tiers (input.js gaitOf: one press, a second tap, a third) ask for walk, canter and gallop; the trot comes by itself
const TIER = [0, 2, 3];
// m/s²: speeding up; letting go of W (a gallop stops in about 1 s and 5 m: the short natural braking of the user's rule, never
// a coast); coming down to what the ground allows; the sliding stop; a fence refused; no control (rearing, a stumble)
export const ACCEL = 3.2, EASE = 10, SOFT = 5, SLIDE = 12, REFUSE = 16, HOLD = 30;
// Turning (rad/s) by speed, between these points: the circle grows with the speed (about 1.4 m walking, 10 m galloping)
const DEG = Math.PI / 180;
export const TURN = { still: 180, walk: 140, trot: 110, canter: 80, gallop: 55 };
const TURN_V = [0, SPEED.walk, SPEED.trot, SPEED.canter, SPEED.gallop], TURN_D = [TURN.still, TURN.walk, TURN.trot, TURN.canter, TURN.gallop];
export function turnRate(v) {
  for (let i = 1; i < 5; i++) if (v < TURN_V[i]) return (TURN_D[i - 1] + (TURN_D[i] - TURN_D[i - 1]) * (v - TURN_V[i - 1]) / (TURN_V[i] - TURN_V[i - 1])) * DEG;
  return TURN.gallop * DEG;
}
export const ARCADE = { turn: 1.8, ease: 1.5 };
// Heading error (degrees) from which it collects itself: down to the canter, to the trot, and the sliding stop (from a
// canter up); standing, it pivots on its haunches until it is within PIVOT
export const COLLECT = [70, 110, 135];
const PIVOT = 60, PIVOT_V = 0.6, SLIDE_V = 6.2, SLID = 0.4, AIR_TURN = 0.3;
// The gait shown (the art, the hooves, the network; the gallop's stamina goes by it), by the speed, with a little hysteresis
const GAIT_V = [4.4, 6.6, 9.2], GAIT_H = 0.2;

// ---------- the ground, the slope and the water ----------
// k: the speed; kg: only the gallop's; drain: the gallop's stamina; cap: the highest gait; turn: how well it turns.
// (hard: kShod with shoes on. R4-2 gives the unshod horse its price on hard ground, with the farrier who mends it)
export const GROUND = {
  hard: { k: 1, kShod: 1.04, kg: 1, drain: 0.9, cap: 3, turn: 1 },
  open: { k: 1, kg: 1, drain: 1, cap: 3, turn: 1 },
  sand: { k: 0.9, kg: 1, drain: 1.25, cap: 3, turn: 1 },
  forest: { k: 1, kg: 0.85, drain: 1.1, cap: 3, turn: 1 },
  snow: { k: 0.85, kg: 1, drain: 1.3, cap: 3, turn: 1 },
  rocky: { k: 0.85, kg: 1, drain: 1.2, cap: 3, turn: 1 },
  mud: { k: 0.75, kg: 1, drain: 1.4, cap: 1, turn: 1 },
  ice: { k: 0.8, kg: 1, drain: 1, cap: 1, turn: 1 / 1.2 },
};
// Grade (rise over run, along the heading): from CLIMB the gallop tires it half as much again; from STEEP the canter at
// most, from VERY the walk (uphill, the walk itself tires it: STEEP_WALK a second), and from CLIFF it refuses
export const CLIMB = 0.25, STEEP = 0.4, VERY = 0.6, CLIFF = 0.85, CLIMB_DRAIN = 1.5, STEEP_WALK = 3;
export const slopeCap = grade => { const g = Math.abs(grade); return g >= VERY ? 0 : g >= STEEP ? 2 : 3; };
export const WET = [0.3, 0.6, 0.9];   // m of water from which: the canter, the trot, the walk at most
export const waterCap = depth => (depth >= WET[2] ? 0 : depth >= WET[1] ? 1 : depth >= WET[0] ? 2 : 3);
const SLOPE_EVERY = 0.1, SLOPE_REACH = 1.2, SLOPE_DRY = 0.3;
// ---------- what it brakes for ----------
// The corridor ahead (half of it: less than the horse's own radius, so riding along a wall never brakes it), how far the
// horse's middle stops from a wall, and the slow walk it still takes up to it. A rock this tall is a wall; a smaller one, a
// step (it goes through, as before). SLIP_V: what it keeps when something stops it, so it slips along it and off. STUMBLE_V: hitting something this fast is a
// stumble
export const PROBE_EVERY = 0.1, PROBE_V = 4, HALF = 0.24, KEEP = 1, NEAR_V = 2, ROCK_TOP = 0.6;
export const SLIP_V = 1.6, STUMBLE_V = 6, STAGGER = 0.8, STUMBLE_STAM = 15, FENCE_KEEP = 0.8, FENCE_V = 6;
// Something narrow (a trunk, a rock, a post: a circle of DODGE_R at most) is passed by on the nearer side, if the heading has
// to bend by DODGE_MAX at most (DODGE_SLOW walking); the horse picks its way, so a ride through the trees is not one stop after another
export const DODGE_R = 1, DODGE_MAX = 0.5, DODGE_SLOW = 1.6, DODGE_ERR = 1.7;
const WALKING = 3, CLEAR = 0.42;   // (what it leaves between its middle and the edge of what it passes)
// A jump this fast clears a fence; slower, it is only a hop. The jump's height grows with the speed
export const CLEAR_V = 4;
export const jumpK = v => 0.75 + 0.35 * Math.min(1, Math.max(0, v / SPEED.canter));

export const makeRide = () => ({
  on: false, v: 0, a: 0, face: { x: 0, y: 1 }, dir: [0, 1], gait: 0,
  // what the rider asks (Player.update): the wanted direction (a unit vector), the W tier, the speed factor (a potion, the bow)
  going: false, wx: 0, wy: 1, tier: 0, mul: 1, air: false, look: null,
  // what horse.js prepRide says
  love: 5, shod: false, winded: false, noGallop: false, hold: false, arcade: false, ground: GROUND.open,
  // the caps and the brakes now
  k: 1, capWater: 3, grade: 0, capSlope: 3, hard: false, cliff: false, slopeT: 0, probeT: 0, obs: Infinity, obsLow: false, obsAt: null, max: Infinity, dodge: 0, dodgeAt: null,
  slide: 0, fence: false, blocked: false, target: 0, clears: false, dirt: 0,
});
// Just mounted: standing, facing as the rider did
export function startRide(R, face) {
  R.on = true; R.v = 0; R.gait = 0; R.a = Math.atan2(face.x, face.y); R.look = null;
  R.k = 1; R.grade = 0; R.capSlope = R.capWater = 3; R.cliff = R.hard = R.fence = R.blocked = R.obsLow = R.clears = false;
  R.slide = R.dodge = 0; R.obsAt = R.dodgeAt = null; R.obs = R.max = Infinity; R.slopeT = R.probeT = 0; R.ground = GROUND.open;
  point(R);
}
function point(R) { R.face.x = R.dir[0] = Math.sin(R.a); R.face.y = R.dir[1] = Math.cos(R.a); }
const wrap = d => { while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
// How far the heading is from the wanted one (rad, signed)
export const headingErr = R => (R.going ? wrap(Math.atan2(R.wx, R.wy) - R.a) : 0);
const groundK = R => (R.shod && R.ground.kShod) || R.ground.k;

export function rideStep(R, dt) {
  let ev = '';
  const arc = R.arcade, err0 = headingErr(R), err = R.dodge && Math.abs(err0) < DODGE_ERR ? wrap(err0 + R.dodge) : err0, e = Math.abs(err) / DEG, mul = R.mul;
  // The gait asked for, and the most that the ground, the slope, the water and its breath allow
  const ask = R.going ? TIER[R.tier] : -1, cap = Math.min(R.ground.cap, R.capSlope, R.capWater, R.winded ? 1 : 3, R.noGallop ? 2 : 3);
  const gait = Math.min(ask, cap), gk = gait === 3 ? groundK(R) * R.ground.kg : groundK(R);
  let target = gait < 0 ? 0 : speedOf(gait, R.love) * gk * mul, down = EASE;
  // (what the ground asks is eased into; what the rider asks is braked for)
  if (gait >= 0 && target < R.v && !R.hard && (gait < ask || gk < 1) && R.v <= speedOf(ask, R.love) * mul + 0.3) down = SOFT;
  // Collecting: a sharp turn asked at speed is taken slower; the opposite way, a sliding stop and a turn on the haunches
  if (R.going && !arc && !R.air) {
    if (!R.slide && e > COLLECT[2] && R.v >= SLIDE_V * Math.max(1, mul)) { R.slide = SLIDE; ev = 'slide'; }
    if (e > COLLECT[2]) target = Math.min(target, SPEED.walk * mul);
    else if (e > COLLECT[1]) target = Math.min(target, SPEED.trot * mul);
    else if (e > COLLECT[0]) target = Math.min(target, speedOf(2, R.love) * mul);
    if (R.v < PIVOT_V && e > PIVOT) target = 0;
  }
  if (R.max < target) { target = R.max; down = EASE; }   // (something ahead: braking)
  if (R.cliff || R.blocked) { target = 0; down = EASE; }
  if (R.slide) { target = 0; down = R.slide; }
  if (R.hold) { target = 0; down = HOLD; }
  if (arc && down !== HOLD) down *= ARCADE.ease;
  R.target = target;
  if (R.air) { /* (in the air it goes on as it took off) */ }
  else if (R.v < target) R.v = Math.min(target, R.v + ACCEL * dt);
  else if (R.v > target) R.v = Math.max(target, R.v - down * dt);
  if (R.slide && R.v <= SLID) { R.slide = 0; R.v = Math.min(R.v, SLID); if (!ev) ev = 'stopped'; }
  // Turning: at its own rate for this speed; not while it slides, rears or staggers. Standing, also towards what it was
  // turned to from outside (the bow, a greeting: R.look)
  let d = R.going ? err : 0;
  if (R.going) R.look = null;
  else if (R.look !== null) { d = wrap(R.look - R.a); if (Math.abs(d) < 0.02 || R.v > 1) { R.look = null; d = 0; } }
  if (d && !R.slide && !R.hold) {
    const max = turnRate(R.v) * R.ground.turn * (arc ? ARCADE.turn : 1) * (R.air ? AIR_TURN : 1) * dt;
    R.a = wrap(R.a + (d > max ? max : d < -max ? -max : d));
    point(R);
  }
  // The gait shown: by the speed the ground would have let it (so sand does not turn a gallop into a canter), a potion aside
  const kNow = R.gait === 3 || gait === 3 ? groundK(R) * R.ground.kg : groundK(R);
  R.k += (kNow - R.k) * Math.min(1, dt * 3);
  const vn = R.v / Math.max(1, mul) / Math.min(1, R.k);
  while (R.gait < 3 && vn > GAIT_V[R.gait] + GAIT_H && (R.gait < 2 || gait === 3)) R.gait++;
  while (R.gait > 0 && vn < GAIT_V[R.gait - 1] - GAIT_H) R.gait--;
  return ev;
}

// ---------- the slope (every SLOPE_EVERY) ----------
// The grade under the horse and a little ahead (farther the faster it goes: it slows down before the steep part, not on it).
// In the water, and where the scene has no relief (a cave), none. Returns 'up' or 'down' when it has just refused
export function slopeStep(R, dt, scene, x, y, depth) {
  R.capWater = waterCap(depth);
  if ((R.slopeT -= dt) > 0) return '';
  R.slopeT = SLOPE_EVERY;
  if (R.air) return '';
  if (!scene?.surfaceAt || depth > SLOPE_DRY) { R.grade = 0; R.capSlope = 3; R.cliff = R.hard = false; return ''; }
  const fx = R.face.x, fy = R.face.y, r = SLOPE_REACH;
  const ahead = scene.surfaceAt(x + fx * r, y + fy * r), g0 = (ahead - scene.surfaceAt(x - fx * r, y - fy * r)) / (2 * r);
  let g1 = 0;
  if (R.v > PROBE_V) { const far = r + R.v * R.v / (2 * EASE); g1 = (scene.surfaceAt(x + fx * far, y + fy * far) - ahead) / (far - r); }
  R.grade += (g0 - R.grade) * 0.6;
  const was = R.cliff;
  R.cliff = Math.abs(g0) >= CLIFF && R.going && Math.abs(headingErr(R)) < 1.2;
  R.hard = Math.abs(g1) >= CLIFF;   // (a cliff ahead: braked for, not eased into)
  R.capSlope = R.hard ? 0 : Math.min(slopeCap(g0), slopeCap(g1));
  return R.cliff && !was ? (g0 > 0 ? 'up' : 'down') : '';
}

// ---------- what is ahead (every PROBE_EVERY) ----------
const Q = { x: 0, y: 0 }, ONE = [null];
const solidFor = c => !c.dig && !c.pond && (c.top === undefined || (!c.spiral && c.top >= ROCK_TOP));
// The nearest solid collider in the corridor from (x, y) along (fx, fy), up to reach metres: its distance (from the horse's
// side: 0 is touching it; Infinity, none), and it, in HIT. noLow: in the air the fences do not count. It only reads the list
// Player.update already has this frame
let HIT = null;
function scan(x, y, z, fx, fy, near, reach, noLow) {
  let best = Infinity;
  HIT = null;
  for (let i = 0; i < near.length; i++) {
    const c = near[i];
    if (!solidFor(c) || (noLow && c.low) || (c.zmax !== undefined && z > c.zmax)) continue;
    let cx, cy, r;
    if (c.obb) { cx = c.obb.x; cy = c.obb.y; r = Math.hypot(c.obb.hx, c.obb.hy); }
    else if (c.rx) { cx = c.x; cy = c.y; r = Math.max(c.rx, c.ry); }
    else if (c.r !== undefined) { cx = c.x; cy = c.y; r = c.r; }
    else { cx = (c.x0 + c.x1) / 2; cy = (c.y0 + c.y1) / 2; r = Math.hypot(c.x1 - c.x0, c.y1 - c.y0) / 2; }
    const dx = cx - x, dy = cy - y, along = dx * fx + dy * fy, side = Math.abs(dx * fy - dy * fx);
    if (side > r + HALF || along < -r || along - r - HALF > reach) continue;
    if (c.r !== undefined && !c.obb && !c.rx) {
      const d = along - Math.sqrt((r + HALF) * (r + HALF) - side * side);
      if (along > 0 && d < best && d <= reach) { best = Math.max(0, d); HIT = c; }
      continue;
    }
    // (a box or an ellipse: a few steps along the corridor, as far as it can be)
    ONE[0] = c;
    for (let d = Math.max(0.1, along - r - HALF), to = Math.min(reach, along + r + HALF, best); d <= to; d += 0.2) {
      Q.x = x + fx * d; Q.y = y + fy * d;
      collide(Q, ONE, HALF);
      if (Math.abs(Q.x - x - fx * d) + Math.abs(Q.y - y - fy * d) > 1e-6) { if (d < best) { best = d; HIT = c; } break; }
    }
  }
  ONE[0] = null;
  return best;
}
// What is ahead along the heading: R.obs, R.obsLow (a fence or its gate) and R.obsAt (which collider)
export function probeAhead(R, x, y, z, near, reach, noLow = false) {
  R.obs = scan(x, y, z, R.face.x, R.face.y, near, reach, noLow);
  R.obsAt = HIT; R.obsLow = !!HIT?.low;
  HIT = null;
  return R.obs;
}
// The nearest narrow thing in the way of where the rider wants to go: R.dodge is how far to bend round it (rad, as R.a), on its
// nearer side, or the other if something else is there. Looked at along the wanted direction, so it lessens smoothly as the
// horse moves over, and goes once it is past
export function dodging(R, x, y, z, near, reach) {
  R.dodge = 0; R.dodgeAt = null;
  if (!R.going || R.air || Math.abs(headingErr(R)) > DODGE_ERR) return;
  const fx = R.wx, fy = R.wy;
  let best = reach + 1.5, at = null, th = 0, phi = 0;
  for (let i = 0; i < near.length; i++) {
    const c = near[i];
    if (c.r === undefined || c.rx || c.obb || c.low || c.r > DODGE_R || !solidFor(c)) continue;
    const dx = c.x - x, dy = c.y - y, along = dx * fx + dy * fy;
    if (along <= 0 || along >= best) continue;
    const side = dx * fy - dy * fx, need = c.r + CLEAR;   // (side: + towards larger angles)
    if (Math.abs(side) >= need) continue;
    best = along; at = c; th = Math.atan2(side, along); phi = Math.asin(Math.min(1, need / Math.max(need, Math.hypot(dx, dy))));
  }
  if (!at) return;
  const a0 = Math.atan2(fx, fy);
  for (let k = 0; k < 2; k++) {
    const b = (th > 0) === (k === 0) ? th - phi : th + phi;
    if (Math.abs(b) > (R.v < WALKING ? DODGE_SLOW : DODGE_MAX) || scan(x, y, z, Math.sin(a0 + b), Math.cos(a0 + b), near, best + 0.6, false) < Infinity) continue;
    R.dodge = b; R.dodgeAt = at;
    break;
  }
  HIT = null;
}
// Can it bend round what is ahead in time? (as fast as it turns at this speed, with some to spare)
const passes = R => R.dodgeAt !== null && R.obsAt === R.dodgeAt && Math.abs(R.dodge + headingErr(R)) < 0.7 * turnRate(R.v) * R.ground.turn * Math.max(0, R.obs) / Math.max(1, R.v);
// The auto-brake: R.max, the fastest it goes now for what is ahead. ahead(reach): asks for R.obs (Player.update: the colliders,
// and the deep water, the cave walls and the dug blocks). Returns 'fence' when it refuses a fence (nobody pressed Space)
export function braking(R, dt, ahead) {
  R.obs -= R.v * dt;
  if (R.v < PROBE_V && !(R.going && R.tier > 0)) { R.max = R.obs = Infinity; R.probeT = R.dodge = 0; R.dodgeAt = null; R.blocked = false; return ''; }
  if ((R.probeT -= dt) <= 0) { R.probeT = PROBE_EVERY; ahead(R.v * R.v / (2 * EASE) + KEEP + R.v * PROBE_EVERY + 0.5); }
  if (R.air || R.obs === Infinity || passes(R)) { R.max = Infinity; R.blocked = false; return ''; }
  if (R.obsLow) {
    // (a fence: it lets the rider jump until the last strides, then stops hard, and stays until they let go or turn away)
    R.max = R.blocked ? 0 : R.v < FENCE_V ? Math.max(NEAR_V, Math.sqrt(2 * EASE * Math.max(0, R.obs - KEEP))) : Infinity;
    if (!R.slide && !R.blocked && R.v >= FENCE_V && R.obs <= R.v * R.v / (2 * REFUSE) + FENCE_KEEP) { R.slide = REFUSE; R.fence = R.blocked = true; return 'fence'; }
    if (R.blocked && !R.going) R.blocked = false;
    return '';
  }
  R.blocked = false;
  R.max = Math.max(NEAR_V, Math.sqrt(2 * EASE * Math.max(0, R.obs - KEEP)));
  return '';
}
