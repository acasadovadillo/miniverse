// What clothes do for the body: warmth, rain, sun shade and work protection of every garment, the temperature constants
// and the tear stages. Design: docs/planes/gta/PLAN-E-cuerpo-aspecto.md §2.2 (temperature), §3.1 (values), §3.2 (tear).
// Owner: Track A1 (body core). Pure data and pure functions: no imports, so anything can read it (body.js, the inventory
// tooltip, the tests) without closing an import cycle.
//
// Contract (plan §10; keep the names):
//   TEMP                      the temperature constants of §2.2 (tune here after the user plays; the §12 test pins them)
//   SEASON_C, WEATHER_C       °C added by the local season (index of time.js localSeason) and by the weather id (time.js)
//   GARMENTS                  id → { warm, rain?, shade?, work?, slot?, noTear? } for every garment (existing and new ones)
//   TEAR                      the tear thresholds and warmth multipliers
//   TEAR_RATE                 what tears the clothes and how fast (Body applies it, on worked time)
//   TEAR_TOUGH                id → multiplier for the leather pieces (they last longer)
//   tearStage(t)              0 new, 1 worn (≥ 40), 2 torn (≥ 75); rags (100) is stage 2 too (it stays worn, warmth ×0.4)
//   tearMul(t)                the warmth multiplier of a piece by its tear: 1, ×0.6 torn, ×0.4 rags
//   warmthOf(equip)           W: Σ warm of the worn pieces × tearMul (inv.equip: slot → { id, color, tear? })
//   clothesOf(equip, out)     fills out (reused, never allocated per call) with { warm, rain, shade, work, outer }
//   wornPieces(equip, out)    the worn pieces that can tear, as [slot, piece] pairs (no underwear, hair, backpack, armour)
//   canTear(slot, piece)      the same test for one piece (Body's tear loops use it: no pairs allocated)
//   feelOf(env, out)          the §2.2 formula, pure: { airC, feelC, cold, heat } from what Body polls (the §12 feel table
//                             test calls it with made-up places and hours)
// A piece whose id is not in GARMENTS (armour, the backpack, a newer game's item) counts 0 and never tears.

// ---------- temperature (§2.2) ----------
export const TEMP = {
  base: 15,            // °C in the village (Tl 0.52) on a spring day at the daily mean
  tlRef: 0.52,         // the village's large-scale temperature (climate().Tl, biomes.js)
  tlScale: 60,         // °C per unit of Tl away from the village (snow land starts at Tl 0.32, desert at 0.62)
  dayAmp: 4,           // ± °C of the daily cycle: warmest at warmHour, coldest 12 h later
  warmHour: 15,
  snowCap: 1,          // while it snows (nieve) airC is at most this
  indoorC: 17, indoorPull: 0.7,   // indoors: airC = lerp(airC, indoorC, indoorPull)
  // The pull by the room you are in (structure.js roomAt): closed, with a door open, only a roof, huge. And a lit hearth inside
  // a closed room warms all of it: as at hearthD tiles from it up to hearthSize tiles of room ([tiles, as at])
  pull: { room: 0.85, draughty: 0.55, porch: 0.25, hall: 0.7 },
  hearthRoom: [[60, 1.5], [150, 2.5]],
  caveC: 12,           // in a cave or underground
  fireC: 12, fireR: 5, // + fireC × (1 − d / fireR) for the nearest lit hearth, furnace or forge within fireR tiles
  swimSea: -4, swimFresh: -2,     // while swimming
  warmK: 2,            // °C per warmth point of the clothes
  wetK: 6,             // °C lost at wet 100 (× (1 − rainproof))
  rainK: 2,            // °C lost while raining outdoors
  coldAt: 14, coldSpan: 16,       // cold = clamp((coldAt − feelC) / coldSpan)
  heatAt: 28, heatSpan: 10,       // heat = clamp((airC + max(0, W − heatW) − shadeK × shade − heatAt) / heatSpan)
  heatW: 3.5, shadeK: 3,
  poll: 2,             // s between two temperature polls
  lag: 20,             // s of smoothing (it never flickers)
};
// How far the fire counts as being (tiles) in that room, with the nearest one at fireD
export function roomFire(room, fireD) {
  if (room?.kind === 'room' && room.hearth) for (const [size, d] of TEMP.hearthRoom) if (room.size <= size) return Math.min(fireD, d);
  return fireD;
}
// By localSeason (art/seasons.js order: spring, summer, autumn, winter)
export const SEASON_C = [0, 8, -1, -8];
// By weather id (time.js WEATHER). nieve also caps airC at TEMP.snowCap
export const WEATHER_C = { sol: 0, nubes: -1, lluvia: -3, tormenta: -4, niebla: -2, nieve: -6, ventisca: -15 };
const SNOWING = new Set(['nieve', 'ventisca']);
const clamp01 = v => (v > 0 ? (v < 1 ? v : 1) : 0);

// The felt temperature (§2.2), pure. env (all optional but Tl, season, hour, weather):
//   Tl       climate().Tl at the player (the village is exactly TEMP.tlRef)
//   season   time.js localSeason (0 spring … 3 winter);  hour: localHour (0..24);  weather: weatherHere (time.js ids)
//   indoors  under a roof or inside (game.indoors);  pull: what the room pulls to indoorC (TEMP.pull; else indoorPull);  cave: in a cave or underground (airC = caveC, no weather)
//   glass    °C more under a glass roof, instead of that pull (greenhouse.js; undefined: not under one)
//   fireD    tiles to the nearest lit fire (Infinity: none);  swim: 'sea' | 'fresh' | null
//   W, rain, shade   from clothesOf (warmth, rainproof share, sun shade)
//   wet      0..100 (Body passes wet plus a third of wetLegs);  raining: rain is falling on you (outdoors)
// (a lit hearth in a closed room: roomFire)
// out (reused): { airC, feelC, cold, heat }, cold and heat 0..1; feelC is the shown feel (see the end)
export function feelOf(env, out = {}) {
  const T = TEMP;
  let air;
  if (env.cave) air = T.caveC;
  else {
    air = T.base + (env.Tl - T.tlRef) * T.tlScale + (SEASON_C[env.season] || 0) + T.dayAmp * Math.cos((2 * Math.PI * (env.hour - T.warmHour)) / 24) + (WEATHER_C[env.weather] || 0);
    if (SNOWING.has(env.weather)) air = Math.min(air, T.snowCap);
    if (env.glass !== undefined) air += env.glass;
    else if (env.indoors) air += (T.indoorC - air) * (env.pull ?? T.indoorPull);
  }
  if (env.fireD < T.fireR) air += T.fireC * (1 - Math.max(0, env.fireD) / T.fireR);
  if (env.swim) air += env.swim === 'sea' ? T.swimSea : T.swimFresh;
  const W = env.W || 0;
  const feel = air + T.warmK * W - clamp01((env.wet || 0) / 100) * T.wetK * (1 - (env.rain || 0)) - (env.raining ? T.rainK : 0);
  const hot = air + Math.max(0, W - T.heatW) - T.shadeK * (env.shade || 0);
  out.airC = air;
  out.cold = clamp01((T.coldAt - feel) / T.coldSpan);
  out.heat = clamp01((hot - T.heatAt) / T.heatSpan);
  // What is shown (Tab, the diary) follows the same rule as the stress it explains: the cold side's feel while it is not
  // hot (at most heatAt: warm clothes on a mild day read "comfortable", not 36 °C), the heat side's when it is (a coat in
  // summer: the air plus what the coat adds over heatW, as the heat counts it)
  out.feelC = out.heat > 0 ? hot : Math.min(feel, T.heatAt);
  return out;
}

// ---------- garments (§3.1) ----------
// warm: insulation points; rain: 0..1 rainproof share; shade: sun shade; work: share of the torso's dirt and tear it
// takes (aprons); slot: only for the new garments (the existing ones keep their items.js `wear`); noTear: never tears.
// The creator's outfits give W 3 (shirt and apron, tunic, long tunic) or W 4 (shirt and waistcoat)
export const GARMENTS = {
  // existing (items.js)
  camisa: { warm: 1 },
  tunica: { warm: 1 },
  tunica_larga: { warm: 2 },   // (the "long tunic" outfit has no trousers: 2 keeps it at W 3)
  chaleco: { warm: 1 },
  delantal: { warm: 0, work: 0.3 },
  pantalon: { warm: 1 },
  falda: { warm: 0.5 },
  botas: { warm: 0.5 },
  calcetines: { warm: 0.5 },
  sombrero: { warm: 0, shade: 1, rain: 0.2 },
  gorro: { warm: 1.5 },
  hijab: { warm: 0.5, shade: 0.5 },
  camiseta_interior: { warm: 0, noTear: true },
  calzoncillos: { warm: 0, noTear: true },
  bragas: { warm: 0, noTear: true },
  // new (E2 adds them to items.js; the slot `outer` is new too)
  wool_coat: { warm: 3, rain: 0.3, slot: 'outer' },
  sheepskin_jacket: { warm: 4, slot: 'outer' },
  wolf_lined_coat: { warm: 5, rain: 0.3, slot: 'outer' },
  linen_shirt: { warm: 0.3, slot: 'torso' },
  wool_socks: { warm: 1, slot: 'calcetines' },
  lined_boots: { warm: 1.5, slot: 'pies' },
  leather_apron: { warm: 0, work: 0.7, slot: 'encima' },
};
// Slots whose pieces never tear (hair accessories, the backpack, underwear)
const NO_TEAR_SLOTS = new Set(['pelo', 'espalda', 'interiorArriba', 'interiorAbajo']);

// ---------- tear (§3.2) ----------
export const TEAR = { worn: 40, torn: 75, rags: 100, tornWarm: 0.6, ragsWarm: 0.4 };
// What tears the clothes (Body applies it, §3.2), per second of the action. Like the dirt (E1's lesson), tool work counts the
// TIME worked, never the uses (a use credits the seconds since the one before, 1 s at most), so the click rate changes
// nothing: a shirt with nothing over it reaches Torn (75) after 15 hours of steady tool work; under the default apron
// (work 0.3: the torso piece takes 1 − work of it, the apron itself the full share) after about 21 h, under a leather
// apron (0.7) after about 50 h
export const TEAR_RATE = {
  work: TEAR.torn / (15 * 3600),   // torso, encima and outer, × (1 − the worn apron's work)
  sprint: 0.002,                   // legs: sprinting through a forest, pines or a bush
  ground: 0.0005,                  // lying on the ground (torso layer and legs); crawling, crouched on the move (legs)
  swim: 0.001,                     // every worn piece, swimming clothed
  hit: 0.6,                        // one random worn piece, once per hit taken
};
// Leather wears slower than cloth (× this on every source): the leather apron takes the work's wear and lasts
export const TEAR_TOUGH = { leather_apron: 0.5, sheepskin_jacket: 0.6, wolf_lined_coat: 0.7, lined_boots: 0.6, botas: 0.6 };
export const tearStage = t => (!(t >= TEAR.worn) ? 0 : t < TEAR.torn ? 1 : 2);
export const tearMul = t => (t >= TEAR.rags ? TEAR.ragsWarm : t >= TEAR.torn ? TEAR.tornWarm : 1);

export function warmthOf(equip) {
  let w = 0;
  if (equip) for (const k in equip) { const it = equip[k], g = it && GARMENTS[it.id]; if (g) w += g.warm * tearMul(it.tear || 0); }
  return w;
}
export function clothesOf(equip, out = {}) {
  out.warm = 0; out.rain = 0; out.shade = 0; out.work = 0; out.outer = false;
  if (equip) for (const k in equip) {
    const it = equip[k], g = it && GARMENTS[it.id];
    if (!g) continue;
    out.warm += g.warm * tearMul(it.tear || 0);
    if (g.rain > out.rain) out.rain = g.rain;
    if (g.shade > out.shade) out.shade = g.shade;
    if (g.work > out.work) out.work = g.work;
    if (k === 'outer') out.outer = true;
  }
  return out;
}
// Can the piece `it` worn in `slot` tear? (a garment of GARMENTS, not underwear, a hair accessory or the backpack; armour
// and a newer game's items are not in GARMENTS: they never tear)
export function canTear(slot, it) { const g = it && GARMENTS[it.id]; return !!g && !g.noTear && !NO_TEAR_SLOTS.has(slot); }
export function wornPieces(equip, out = []) {
  out.length = 0;
  if (equip) for (const k in equip) { const it = equip[k]; if (canTear(k, it)) out.push([k, it]); }
  return out;
}
