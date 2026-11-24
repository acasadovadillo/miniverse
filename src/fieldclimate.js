// The weather of a field: the mean, the warmest and the coldest of a day at a place, from the same constants as the body
// (clothing.js) but with a smooth year: the body's season is a step (+8 °C on 21 June), a crop's is a curve that is the
// body's in the middle of each season. Pure: no game state. Design: docs/planes/realismo/PLAN-R2-huerto.md §3.1
import { TEMP, SEASON_C, WEATHER_C } from './clothing.js';
import { latOf } from './world/planet.js';

const MID = 46, LEN = 91;        // the day (1…) in the middle of a season, and how long they are, near enough
const CLEAR_NIGHT = 2;           // °C less in a clear night
const smooth = t => t * t * (3 - 2 * t);

// What the time of the year adds (°C), smooth: season (0 spring … 3 winter) and its day, from 1
export function seasonC(season, dos) {
  const a = SEASON_C[season] || 0;
  if (dos >= MID) { const b = SEASON_C[(season + 1) % 4]; return a + (b - a) * smooth(Math.min(1, (dos - MID) / LEN)); }
  const b = SEASON_C[(season + 3) % 4];
  return a + (b - a) * smooth(Math.min(1, (MID - dos) / LEN));
}

// The season at a latitude: south of the equator, the opposite one
export const seasonAt = (season, ty) => (latOf(ty) < 0 ? (season + 2) % 4 : season);

// A day at a field. season, dos: the calendar's (time.js seasonOf); ty: the tile's row; Tl: its large-scale temperature
// (biomes.js climate); weather: the day's. out (reused): { mean, max, min (the night after it), season (there), weather }
// (It snows only in the north's winter. South of the equator that is summer: there that day's snow is rain)
export function fieldDay(season, dos, ty, Tl, weather, out = {}) {
  const there = seasonAt(season, ty);
  if (weather === 'nieve' && there !== season) weather = 'lluvia';
  const mean = TEMP.base + (Tl - TEMP.tlRef) * TEMP.tlScale + seasonC(there, dos) + (WEATHER_C[weather] || 0);
  out.mean = mean;
  out.max = mean + TEMP.dayAmp;
  out.min = mean - TEMP.dayAmp - (weather === 'sol' ? CLEAR_NIGHT : 0);
  if (weather === 'nieve' || weather === 'ventisca') out.min = Math.min(out.min, TEMP.snowCap - TEMP.dayAmp);
  out.season = there;
  out.weather = weather;
  return out;
}
