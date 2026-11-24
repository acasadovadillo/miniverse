// The wind (Plan R3 §3.1, docs/planes/realismo/PLAN-R3-caza.md). One for the whole world, worked out by every game from the
// world's seed and the real clock: nothing goes by the network, and a few seconds between two clocks change nothing. It
// carries the scent of whoever stalks (senses.js; the host uses it for everybody) and points the mark on the minimap's
// rim (ui/huntoverlay.js). The direction drifts over an hour and a half with gusts every twenty minutes; the strength is
// the weather's.
import { ihash } from './util.js';
import { latOf } from './world/planet.js';

const DAY_S = 86400, TAU = Math.PI * 2;
// How strong it blows with each weather (time.js WEATHER), 0..1
export const WIND_S = { sol: 0.4, nubes: 0.5, niebla: 0.15, lluvia: 0.6, tormenta: 1, nieve: 0.4, ventisca: 1 };
const POLAR = 86;   // (beyond this latitude, always a blizzard: time.js)

// The weather where y is: the same for everyone but at the poles (an op's weather holds there too). T: the TimeSystem
export const weatherAt = (T, y) => (!T.locked && Math.abs(latOf(y)) > POLAR ? 'ventisca' : T.weather);

// { dir, gust }: the way it blows TO (radians: x = cos, y = sin, in tiles) and what the gusts leave of its strength
// (0.7..1). Pure: the seed and the real time. The day's own direction turns slowly into the next day's (never a jump at
// midnight)
export function windAt(seed, ms, out = {}) {
  const t = ms / 1000, day = Math.floor(t / DAY_S), k = t / DAY_S - day, s = k * k * (3 - 2 * k);
  const a = ihash(day, 311, seed) * TAU, b = ihash(day + 1, 311, seed) * TAU, turn = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  const p1 = ihash(1, 313, seed) * TAU, p2 = ihash(2, 313, seed) * TAU, p3 = ihash(3, 313, seed) * TAU;
  out.dir = a + turn * s + 0.9 * Math.sin(TAU * t / 5400 + p1) + 0.4 * Math.sin(TAU * t / 1300 + p2);
  out.gust = 0.85 + 0.15 * Math.sin(TAU * t / 700 + p3);
  return out;
}

// game.wind: the wind now, worked out once a second. dir, x, y (the unit vector it blows along), s (its strength where you
// are, 0..1) and sAt(y) (anywhere: the host asks for other players). held: the tests fix it ({ dir, s })
export class Wind {
  constructor(game) { this.game = game; this.dir = 0; this.gust = 1; this.x = 1; this.y = 0; this.s = 0.4; this.t = 1; this.held = null; }
  reset() { this.t = 1; }
  update(dt) {
    const g = this.game;
    if (!g.world || (this.t += dt) < 1) return;
    this.t = 0;
    this.now();
  }
  now() {
    const g = this.game, h = this.held;
    windAt(g.world.seed ?? g.world.gen?.seed ?? 0, Date.now(), this);
    if (h) { this.dir = h.dir; this.gust = 1; }
    this.x = Math.cos(this.dir); this.y = Math.sin(this.dir);
    this.s = this.sAt(g.days.here.y);
  }
  sAt(y) { return this.held ? this.held.s : (WIND_S[weatherAt(this.game.days, y)] ?? 0.4) * this.gust; }
}
