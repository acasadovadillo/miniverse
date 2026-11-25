// How long each piece takes to wear (wear.js; docs/planes/realismo/PLAN-R5-construccion.md §3.5). Pure: no game state.
//   ruleOf(id)           { at: [weathered, worn], kind (how it is drawn: three/wear3d.js), leaks, air } or null: it does not wear
//   stageAt(id, age)     0 as new, 1 weathered, 2 worn (age: in days of wear, place and eaves already counted)
import { B } from './world/biomes.js';

const NEVER = Infinity;
const rule = (kind, a, b, more = {}) => ({ kind, at: [a, b], leaks: false, air: false, ...more });
const THATCH = rule('thatch', 40, 100, { leaks: true }), CLAY = rule('tile', 120, 400, { leaks: true }), SLATE = rule('slate', 200, NEVER);
const WOOD = rule('wood', 60, 180), WOOD_WALL = rule('wood', 60, 180, { air: true }), FRAMED = rule('plaster', 90, 270, { air: true }), STONE = rule('stone', 150, NEVER);
// (days of wear; what is not here does not wear: glass, the hearth, furniture)
const RULES = {
  tejado_paja: THATCH, tejado_rojo: CLAY, tejado_azul: CLAY, tejado_verde: CLAY, tejado_gris: SLATE,
  muro_madera: WOOD_WALL, ventana: WOOD_WALL, puerta: WOOD_WALL, valla: WOOD, puerta_valla: WOOD, post: WOOD, suelo_madera: WOOD,
  muro_entramado: FRAMED, ventana_contraventanas: FRAMED, muro_cuadro: FRAMED, limewash_wall: FRAMED,
  muro_piedra: STONE, valla_piedra: STONE, suelo_piedra: STONE, camino: STONE, stone_pillar: STONE, bell_gable: STONE,
  ashlar_wall: STONE, stone_column: STONE, slab_roof: STONE,
};
export const ruleOf = id => (Object.prototype.hasOwnProperty.call(RULES, id) ? RULES[id] : null);
export const stageAt = (id, age) => { const r = ruleOf(id); return !r ? 0 : age >= r.at[1] ? 2 : age >= r.at[0] ? 1 : 0; };
export const EAVES = 1.5;       // under a roof, a wall or a floor takes this much longer
export const REPAIR_HITS = 2;
export const AIR_WALLS = 3;     // worn walls (windows, doors) round a room that let the air in
export const LEAK_R = 12, LEAKS = 6;
// What each day counts, by its weather
export const DAY_K = { sol: 0.8, nubes: 0.9, niebla: 1.05, lluvia: 1.35, tormenta: 1.5, nieve: 1.15, ventisca: 1.2 };
// How fast things wear in each land: dry heat, slowly; by the water, in a wood or in a swamp, sooner
const BIOME_K = { [B.DESERT]: 0.75, [B.ROCKY]: 1.05, [B.FOREST]: 1.1, [B.PINES]: 1.1, [B.SNOW]: 1.1, [B.BEACH]: 1.15, [B.OCEAN]: 1.15, [B.SHALLOW]: 1.15, [B.LAKE]: 1.15, [B.ICE]: 1.2, [B.SWAMP]: 1.25 };
export const placeK = biome => BIOME_K[biome] ?? 1;
