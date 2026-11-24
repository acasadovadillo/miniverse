// What the dynamic music should play now (Plan J §3.2): a mood (where, when) and an intensity (idle, moving, ride,
// danger), decided by a pure function of the game's flags, polled by Music.update (game.js, every 30 frames: 1-2 Hz).
// Every hysteresis timer runs on real seconds (opts.now, performance.now() by default), never on poll counts, so the
// Air at 30 fps (a poll a second) holds the same times as 60 fps.
//
// musicState(game, prev, opts) → a new state (prev is not changed; null or undefined for the first call)
//   opts { now (ms, performance.now()), venues (Music.venues: [{ x, y, rect, hours, score }]), calm (Settings
//   musicMode === 'calm': never ride, danger or stingers) }
// State:
//   mood       a MOODS id (debounced: a new one must hold HOLD.MOOD_S, leaving 'deep' HOLD.SURFACE_S; menu at once)
//   intensity  the INTENSITY level to play for that mood: outdoor moods 0..3; cave and temple 1 or 3; every other mood 1
//   stalk      Plan G's crouched bow stalk: thin the score to pad and a soft pulse (outdoors, intensity 0 or 1 only)
//   band       0..1, how much of a venue's band is heard: 1 inside an open venue, BAND_OUT at its wall outside, 0 from
//              BAND_R metres (lowpassed below 1: Music's job); 0 when it is closed
//   venue      the venue spec that band belongs to (TAVERN_VENUE or one of opts.venues), or null
//   patrons    seated tavern patrons in sight (0..MAX_PATRONS): one more band voice each (0 for other venues)
//   hour       the village hour (days.hour: the tavern's clock; claps after 20:00), for the band
//   lowAir     under water with air at or below Plan D's LOW.air (NeedsBar's body.uw-low): drop the bell, sink the pad
//   idle, ride, danger   the latched raw levels behind intensity (kept so hysteresis survives moods that clamp it)
//   want       the mood waiting to be confirmed (or null)
//   since      { move, still, gallop, walk, threat, calm, want }: ms timestamps when each condition began, -Infinity
//              while it does not hold (threat: when the current stretch with a threat began; calm: without one)
//   at         ms of this decision
// Flags read (all with ?.: batches land in any order): game.mode, game.scene.kind/.style, game.world, game.indoors,
// game.underRoof, game.days.info.rain/.localSeason/.localHour/.hour, p.sleeping, p.headUnder, p.mount, p.moving, p.vx/vy,
// p.speedMul, game.combat.monsters, game.gamemode, game.difficulty, game.horse?.galloping (Plan F), game.tracks?.stalking
// (Plan G), game.law?.chased (Plan H), game.wildlife?.threats?.(x, y, r) (a future predator batch), game.neighbors.people,
// game.needsBar.uwLow / game.needs.air. The 'found' stinger (g.places.found.size) is decided by Music, not here.
import { inTavern, inBounds, TAVERN } from './world/village.js';
import { distOf, dxOf } from './world/planet.js';

export const MOODS = ['menu', 'sleep', 'deep', 'cave', 'temple', 'tavern', 'home', 'rain', 'winter', 'night', 'dusk', 'day'];
export const INTENSITY = { idle: 0, moving: 1, ride: 2, danger: 3 };
// Hysteresis (s): idle after IDLE_S still, back on MOVE_S moving; ride after GALLOP_S galloping, off after WALK_S not;
// danger off after CALM_S with no threat; a new mood after MOOD_S of wanting it, but leaving 'deep' after SURFACE_S (a
// breath at the surface between dives does not swap the score twice). Danger radius in tiles: outdoors (mobs.js CHASE)
// and in grid scenes
export const HOLD = { IDLE_S: 30, MOVE_S: 1, GALLOP_S: 1.5, WALK_S: 3, CALM_S: 6, MOOD_S: 1, SURFACE_S: 3 };
export const DANGER_R = { out: 10, grid: 6 };
export const BAND_R = 25;   // (the tavern band is heard from this many metres outside)
export const BAND_OUT = 0.35;   // (how much of it is heard right outside the wall; inside 1)
export const MAX_PATRONS = 4;
// The tavern: open while Anselmo is behind the bar (neighbors.js, hours [10, 26]: TAVERN_HOURS is the fallback when
// the neighbours are not there, as in tests and renders)
export const TAVERN_HOURS = [10, 26];
export const TAVERN_VENUE = Object.freeze({ x: (TAVERN.x0 + TAVERN.x1) / 2, y: (TAVERN.y0 + TAVERN.y1) / 2, rect: TAVERN, hours: TAVERN_HOURS, score: 'tavern', tavern: true });
// Fallback gallop when Plan F's game.horse.galloping is not there: mounted and faster than this (m/s, times speedMul):
// between the walk (3.2) and the run (5.3) of entities.js, so it means the top gait whatever key gives it
export const GALLOP_V = 4.5;
const LOW_AIR = 0.3;   // (Plan D needsbar.js LOW.air, when NeedsBar is not there)
const SLACK = 60;      // (ms: a 1 s hold polled once a second lands a frame early or late; this keeps it to one poll)
const OUTDOOR = new Set(['rain', 'winter', 'night', 'dusk', 'day']);

const NEVER = -Infinity;
export const newSince = () => ({ move: NEVER, still: NEVER, gallop: NEVER, walk: NEVER, threat: NEVER, calm: NEVER, want: NEVER });

// A condition that holds now: when it began (kept from before if it already held), else NEVER; and its opposite
function track(since, on, yes, no, now) {
  if (on) { if (since[yes] === NEVER) since[yes] = now; since[no] = NEVER; }
  else { if (since[no] === NEVER) since[no] = now; since[yes] = NEVER; }
}
const held = (since, k, s, now) => since[k] !== NEVER && now - since[k] >= s * 1000 - SLACK;

export function musicState(game, prev = null, opts = {}) {
  const now = opts.now ?? performance.now(), calm = !!opts.calm;
  // (a clock that went back, as a new render script: start the timers again, keep the mood)
  if (prev && !(now >= prev.at)) prev = { ...prev, since: newSince(), want: null, idle: false, ride: false, danger: false };
  const since = prev ? { ...prev.since } : newSince();
  const p = game?.player, sc = game?.scene;
  const out = { mood: 'day', intensity: INTENSITY.moving, stalk: false, band: 0, venue: null, patrons: 0, hour: hourOf(game),
    lowAir: false, idle: false, ride: false, danger: false, want: null, since, at: now };
  if (game?.mode === 'menu' || !p || !sc) {
    // (the menu, or no game yet: nothing to hold; timers start again when play does)
    out.mood = game?.mode === 'menu' ? 'menu' : 'day';
    out.since = newSince();
    return out;
  }

  // Raw levels, latched with their holds
  track(since, !!p.moving, 'move', 'still', now);
  track(since, gallopingOf(game, p), 'gallop', 'walk', now);
  track(since, threatNear(game, p, sc), 'threat', 'calm', now);
  const was = prev || out;
  out.idle = was.idle ? !held(since, 'move', HOLD.MOVE_S, now) : held(since, 'still', HOLD.IDLE_S, now);
  out.ride = was.ride ? !held(since, 'walk', HOLD.WALK_S, now) : held(since, 'gallop', HOLD.GALLOP_S, now);
  out.danger = was.danger ? !held(since, 'calm', HOLD.CALM_S, now) : since.threat !== NEVER;
  if (out.ride) out.idle = false;

  // Where: the venue heard most, then the mood by priority, debounced
  const here = hearVenues(game, p, sc, opts.venues);
  out.band = here.band; out.venue = here.venue; out.patrons = here.patrons;
  const wanted = pickMood(game, here);
  if (!prev || prev.mood === 'menu' || wanted === prev.mood) { out.mood = wanted; since.want = NEVER; }
  else {
    if (prev.want !== wanted) since.want = now;
    out.want = wanted;
    out.mood = held(since, 'want', prev.mood === 'deep' ? HOLD.SURFACE_S : HOLD.MOOD_S, now) ? wanted : prev.mood;
    if (out.mood === wanted) { out.want = null; since.want = NEVER; }
  }
  // (the band is ambience outside; inside a venue whose mood is not yet confirmed it is still heard through the door)
  if (out.mood === 'deep' || out.mood === 'sleep') { out.band = 0; out.patrons = 0; }

  // What intensity that mood plays (calm: never ride or danger)
  const base = out.idle ? INTENSITY.idle : INTENSITY.moving;
  const level = !calm && out.danger ? INTENSITY.danger : !calm && out.ride ? INTENSITY.ride : base;
  if (OUTDOOR.has(out.mood)) out.intensity = level;
  else if (out.mood === 'cave' || out.mood === 'temple') out.intensity = level === INTENSITY.danger ? INTENSITY.danger : INTENSITY.moving;
  else out.intensity = INTENSITY.moving;
  out.stalk = OUTDOOR.has(out.mood) && out.intensity <= INTENSITY.moving && !!(game.tracks?.stalking || game.wildlife?.tension);   // (or a wild animal on its guard near you while you hunt: Plan R3)
  out.lowAir = out.mood === 'deep' && lowAirOf(game);
  return out;
}

// The mood by priority (§3.2 table); outdoors with the player's LOCAL hour and season (time.js localHour/localSeason:
// the old Music.pick read the village hour, so far east or west the night piece played at noon). here: hearVenues'
// answer (computed when not given)
export function pickMood(game, here = null) {
  if (game?.mode === 'menu') return 'menu';
  const p = game?.player, sc = game?.scene, T = game?.days;
  if (!p || !sc) return 'day';
  if (p.sleeping) return 'sleep';
  if (p.headUnder) return 'deep';
  if (sc.kind === 'grid') return sc.style === 'temple' ? 'temple' : 'cave';
  if ((here ?? hearVenues(game, p, sc, null)).band >= 1) return 'tavern';
  if (game.indoors) return 'home';
  if (T?.info?.rain) return 'rain';
  const h = T?.localHour ?? 12, night = h >= 20 || h < 6;
  if (T?.localSeason === 3) return night ? 'night' : 'winter';
  return night ? 'night' : h >= 17 ? 'dusk' : 'day';
}

// Is a venue playing at this village hour? hours [from, to], to may pass 24 (neighbors.js isIn); none: always
export function venueOpen(spec, hour) {
  const hs = spec?.hours;
  if (!hs || !Number.isFinite(hour)) return !hs;
  const [a, b] = hs, h = ((hour % 24) + 24) % 24;
  return (h >= a && h < b) || (h + 24 >= a && h + 24 < b);
}

// How much of a venue's band is heard from (x, y): 1 inside its rect (the tavern also wants the roof, not its patio),
// BAND_OUT at the wall falling to 0 at BAND_R metres, halved from inside another building. Not open: 0
export function bandOf(game, spec, p, open = null) {
  if (!spec?.rect || !p) return 0;
  if (!(open ?? venueOpen(spec, hourOf(game)))) return 0;
  // (inside, or the distance to the rect's edge; across the planet's seam)
  const r = spec.rect, hw = (r.x1 - r.x0) / 2, hh = (r.y1 - r.y0) / 2;
  const ax = Math.abs(dxOf(p.x, (r.x0 + r.x1) / 2)), ay = Math.abs(p.y - (r.y0 + r.y1) / 2);
  if (ax < hw && ay < hh) return !spec.tavern || game?.underRoof || p.underRoof ? 1 : BAND_OUT;
  const d = Math.hypot(Math.max(0, ax - hw), Math.max(0, ay - hh));
  if (d >= BAND_R) return 0;
  return BAND_OUT * (1 - d / BAND_R) * (game?.indoors ? 0.5 : 1);
}

// The venue heard most where the player is (the tavern and every registered one), only in the open world
export function hearVenues(game, p = game?.player, sc = game?.scene, venues = null) {
  const out = { band: 0, venue: null, patrons: 0 };
  if (!p || !sc || sc.kind === 'grid' || (game?.world && sc !== game.world)) return out;
  const tav = tavernNow(game);
  let best = bandOf(game, TAVERN_VENUE, p, tav.open);
  if (best > 0) { out.band = best; out.venue = TAVERN_VENUE; out.patrons = tav.patrons; }
  if (venues) for (let i = 0; i < venues.length; i++) {
    const b = bandOf(game, venues[i], p);
    if (b > best) { best = b; out.band = b; out.venue = venues[i]; out.patrons = 0; }
  }
  return out;
}

// The tavern now: open while Anselmo is at the bar (or in TAVERN_HOURS without neighbours), and its seated patrons
function tavernNow(game) {
  const people = game?.neighbors?.people;
  let keeper = null, patrons = 0;
  if (people?.length) for (let i = 0; i < people.length; i++) {
    const n = people[i];
    if (n.id === 'anselmo') keeper = n;
    else if (!n.hidden && n.def?.sits && inTavern(n.x, n.y)) patrons++;
  }
  const open = keeper ? !keeper.hidden : venueOpen(TAVERN_VENUE, hourOf(game));
  return { open, patrons: open ? Math.min(MAX_PATRONS, patrons) : 0 };
}

const hourOf = game => { const h = game?.days?.hour; return Number.isFinite(h) ? h : 12; };

// Galloping: Plan F's published flag when it is there; else mounted at the top gait
function gallopingOf(game, p) {
  const f = game?.horse?.galloping;
  if (typeof f === 'boolean') return f && !!p.mount;
  return !!p.mount && Math.hypot(p.vx || 0, p.vy || 0) > GALLOP_V * (p.speedMul || 1);
}

// A threat near the player now: survival only (never in peaceful, creative or spectator). A night creature within
// DANGER_R (outdoors across the seam; in caves and temples closer), but not one outside the village while the player is
// in it (mobs.js move: they never chase in); the guest has their positions (live.js mobs), not their targets, so it is
// distance only, which is what Mobs.move does. Also Plan H's law chase and a future wildlife threats hook
export function threatNear(game, p = game?.player, sc = game?.scene) {
  if (!game || !p || !sc || game.gamemode !== 'survival' || game.difficulty === 'peaceful') return false;
  if (game.law?.chased) return true;
  const grid = sc.kind === 'grid', r = grid ? DANGER_R.grid : DANGER_R.out;
  const list = game.combat?.monsters;
  if (list?.length) {
    const safe = !grid && inBounds(p.x, p.y);
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!m || !Number.isFinite(m.x) || !Number.isFinite(m.y)) continue;
      const d = grid ? Math.hypot(m.x - p.x, m.y - p.y) : distOf(p.x, p.y, m.x, m.y);
      if (d < r && !(safe && !inBounds(m.x, m.y))) return true;
    }
  }
  return !grid && !!game.wildlife?.threats?.(p.x, p.y, r);
}

function lowAirOf(game) {
  const nb = game.needsBar?.uwLow;
  if (typeof nb === 'boolean') return nb;
  const n = game.needs, max = n?.airMax;
  return !!(n && max > 0 && Number.isFinite(n.air) && n.air <= LOW_AIR * max);
}
