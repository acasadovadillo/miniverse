// How a wild animal notices you (Plan R3 §3.2, docs/planes/realismo/PLAN-R3-caza.md): sight (how you move, your posture,
// the light, the weather, cover, where it looks and whether its head is down), hearing (your gait, the ground, the rain,
// loud things) and smell (your scent, carried by the wind). Only the numbers, with no game behind: presence.js says how
// each player can be noticed, wildlife.js runs it on whoever runs the world, and the tests call it alone.
//
// An animal's awareness goes from 0 to 1. ALERT: head up, it stares at you. TENSE: a deer stamps, a boar huffs. ALARM: it
// flees. What it only hears never passes HEARD_CAP (it knows something is there, not what), unless it is loud and close.
import { B } from './world/biomes.js';

export const ALERT = 0.35, CALM = 0.25, TENSE = 0.55, ALARM = 0.75, HEARD_CAP = 0.69;
const DECAY = 0.12, DECAY_AFTER = 1.5;   // per second, with nothing noticed for that long
const HEAR_M = 40, SMELL_M = 45, CONE = Math.cos(35 * Math.PI / 180), TOUCH = 1.2, SOURCE = 130;

// sight, smell and hearing of each one (m; hearing and smell as a factor), fov (the cosine of half of it), how much of its
// sight is left by night, how fast a smell alarms it, how high its eyes are, and its flight: run [min, max] metres, how
// often it stops and looks back, and the trot after it
export const SENSES = {
  ciervo: { sight: 50, fov: Math.cos(150 * Math.PI / 180), hear: 1, smell: 1, whiff: 1, night: 0.5, eye: 1.4, run: [40, 90], look: 0.6, burst: 1.3, trot: 30, cover: true },
  jabali: { sight: 22, fov: Math.cos(130 * Math.PI / 180), hear: 0.9, smell: 1.4, whiff: 1.5, night: 0.6, eye: 0.7, run: [60, 120], look: 0.15, burst: 1, trot: 20, cover: true },
  cisne: { sight: 35, fov: Math.cos(150 * Math.PI / 180), hear: 0.5, smell: 0, whiff: 0, night: 0.5, eye: 0.6, run: [15, 25], look: 0, burst: 1, trot: 0, cover: false },
};
export const HEAD_DOWN = 0.35, STARING = 1.3, BEDDED = 0.6;
export const DIFF_K = { peaceful: 0.75, easy: 0.75, normal: 1, hard: 1.15 };

// ---------- what a player gives away ----------
// How much of you there is to see: posture and motion
export const EXPO = { still: 0.25, walk: 0.6, jog: 0.85, sprint: 1, crouchStill: 0.08, crouch: 0.3, pose: 0.05, rideStill: 0.35, ride: [0.45, 0.7, 1, 0.85], row: 0.45, swim: 0.3, draw: 0.05 };
// How loud you go (before the ground and the rain). ride: by horse gait (entities.js GT: 0 walk, 1 trot, 2 gallop, 3 canter)
export const NOISE = { crouch: 0.15, walk: 0.45, jog: 0.8, sprint: 1, ride: [0.5, 0.8, 1.2, 1], row: 0.3, swim: 0.35, push: 0.1 };
// Loud things: how loud, and for how long they are still heard (they fade out over it)
export const EVENT = { tool: 1.2, arrow: 0.8, drop: 0.8, bark: 1.5, door: 0.8, shout: 0.8 };
export const EVENT_S = 1, ARROW_R = 6;
const GROUND = { [B.MEADOW]: 0.9, [B.FOREST]: 1, [B.PINES]: 1, [B.SWAMP]: 1, [B.SNOW]: 1.2, [B.ICE]: 1.1, [B.ROCKY]: 1, [B.BEACH]: 0.8, [B.DESERT]: 0.8 };
// (season: 2 is the autumn, with its dry leaves; hard: a path, a floor or the village; wading: water under the feet)
export const groundNoise = (biome, season, hard, wading) => (wading ? 1.3 : hard ? 0.7 : biome === B.FOREST && season === 2 ? 1.4 : GROUND[biome] ?? 0.9);
export const weatherNoise = w => (w === 'lluvia' ? 0.6 : w === 'tormenta' || w === 'ventisca' ? 0.4 : 1);
export const weatherSight = w => ({ niebla: 0.5, lluvia: 0.75, tormenta: 0.6, nieve: 0.8, ventisca: 0.4 }[w] ?? 1);
export const woods = biome => biome === B.FOREST || biome === B.PINES;
// The light to see by: 1 by day, 0.75 as the sun rises or sets and `night` with the stars (the hour where it is)
export function lightAt(hour, night) {
  const d = hour < 12 ? hour - 6 : 20 - hour;   // (hours since sunrise, or to sunset)
  return d >= 1 ? 1 : d <= -1 ? night : d >= 0 ? 0.75 + 0.25 * d : 0.75 + (0.75 - night) * d;
}
// The scent of a body: s = { dirt, mud, blood, sweat } (body.js surface, 0..1 each), fresh (a soap bath lately), carcass
// (carrying one). Blood and dirt make it stronger, soap and mud mask it
export function scentOf(s, fresh = false, carcass = false) {
  const k = 1 + (s ? 0.5 * (s.dirt || 0) + (s.blood || 0) + 0.3 * (s.sweat || 0) - 0.3 * (s.mud || 0) : 0) - (fresh ? 0.35 : 0) + (carcass ? 0.5 : 0);
  return Math.max(0.4, Math.min(2.5, k));
}

// ---------- what an animal notices ----------
export const sightRange = (K, expo, light, sky, cover, head, diff) => K.sight * expo * light * sky * cover * head * diff;
export const hearRange = (K, noise, diff) => HEAR_M * noise * K.hear * diff;
export const smellRange = (K, scent, wind, diff) => SMELL_M * scent * (0.5 + wind) * K.smell * diff;
export const sightRate = (d, D) => 0.25 + 0.9 * (1 - d / D);
export const hearRate = (d, H) => 0.15 + 0.5 * (1 - d / H);
export const SMELL_RATE = 0.8;
// Does the wind (wx, wy, a unit vector: where it blows to) carry a smell along (dx, dy), d long?
export const downwind = (wx, wy, dx, dy, d) => d > 1e-6 && (wx * dx + wy * dy) / d > CONE;

// What animal A (K: its SENSES; fx, fy: the way it faces, a unit vector; down: its head is down; staring: at this player;
// bedded) notices this moment of somebody at (dx, dy) from it, d away (dx, dy: from the animal to them):
//   P: { expo, noise, scent, hidden (the cover they are in: tall grass crouched, woods) }
//   E: { light, sky (the weather's sight factor), diff, wx, wy, ws (the wind) }
// into out: { see, hear, smell (rates per second), loud (heard close enough to flee), D, H, S (the distances) }. Whether
// anything stands between them is the caller's: only asked for when see > 0
export function perceive(K, A, P, E, dx, dy, d, out) {
  const D = sightRange(K, P.expo, E.light, E.sky, P.hidden * (A.bedded ? BEDDED : 1), A.down ? HEAD_DOWN : A.staring ? STARING : 1, E.diff);
  const H = hearRange(K, P.noise, E.diff), S = smellRange(K, P.scent, E.ws, E.diff);
  out.D = D; out.H = H; out.S = S;
  out.see = d < TOUCH ? 2 : d < D && (dx * A.fx + dy * A.fy) / (d || 1) >= K.fov ? sightRate(d, D) : 0;
  out.hear = d < H ? hearRate(d, H) : 0;
  out.loud = out.hear > 0 && P.noise >= 0.8 && d < H / 2;
  out.smell = K.smell > 0 && d < S && downwind(E.wx, E.wy, -dx, -dy, d) ? SMELL_RATE * K.whiff : 0;
  return out;
}
// A loud thing n at d (r: no further than this, or Infinity): its hearing rate, into out as perceive
export function hearEvent(K, n, d, r, diff, out) {
  const H = Math.min(r, hearRange(K, n, diff));
  out.H = H; out.see = out.smell = 0;
  out.hear = d < H ? hearRate(d, H) : 0;
  out.loud = out.hear > 0 && n >= 0.8 && d < H / 2;
  return out;
}
// The awareness after dt: sure (rates of what was seen, smelled, or heard loud and close) and heard (rates of what was only
// heard: it never passes HEARD_CAP). quiet: seconds with nothing noticed (the caller keeps it: 0 when something was)
export function advance(a, sure, heard, quiet, dt) {
  a += sure * dt;
  if (heard > 0 && a < HEARD_CAP) a = Math.min(HEARD_CAP, a + heard * dt);
  if (quiet > DECAY_AFTER) a -= DECAY * dt;
  return Math.max(0, Math.min(1, a));
}
// Further than this nobody is noticed at all (a gallop on leaves, at most, is heard under 80 m; a bloody body with a storm
// behind it, smelled under 120)
export const FAR = SOURCE;

// ---------- on the wire ----------
// Index 11 of a 'wild' entry (wildlife.js): f = bits 0-1 the alert (0 calm, 1 alert, 2 alarm, 3 tense), bit 8 the tail
// flag, bit 10 staring, bits 11-15 the way it stares (32 steps). The bits in between are for later phases. An old guest
// ignores it; an old host does not send it: calm
export const A_CALM = 0, A_ALERT = 1, A_ALARM = 2, A_TENSE = 3;
const FLAG = 1 << 8, STARE = 1 << 10, STEP = Math.PI * 2 / 32;
export function packF(w) {
  let f = w.alert || 0;
  if (w.flag) f |= FLAG;
  if (w.staring) f |= STARE | ((Math.round((w.stareYaw || 0) / STEP) & 31) << 11);
  return f;
}
export function unpackF(f, w) {
  const n = Number.isInteger(f) && f > 0 ? f : 0;
  w.alert = n & 3;
  w.flag = !!(n & FLAG);
  w.staring = !!(n & STARE);
  if (w.staring) w.stareYaw = ((n >> 11) & 31) * STEP;
  return w;
}
