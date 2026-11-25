// What things weigh, and the big things that are carried in the arms (the weight inventory, the default: see carry.js
// and docs/planes/gta/PLAN-C-peso.md). Only data: it imports items.js, catch.js (data too) and i18n.js and nothing else (inventory.js imports
// this file, and carry.js extends Inventory: importing either here would be a cycle).
// The new ids are always in ITEMS, with either inventory, so every game of this version knows them (a log left by a
// player with the weight inventory is seen and picked up by one with ?inventario=casillas, as its parts). Hidden from the creative list
import { ITEMS } from './items.js';
import { tracked, typicalG, unitG } from './catch.js';
import { defineNames } from './i18n.js';

// Capacity (kg): hands, pockets and belt; the backpack adds BAG_CAP. The load (kg / capacity) never refuses anything:
// above 1 you walk slower, above HEAVY as slow as it gets (see Carry.speedMul)
export const BASE_CAP = 25, BAG_CAP = 45, HEAVY = 1.5;
// Days a carcass lasts on the ground before only bones are left (logs last for ever)
export const CARCASS_DAYS = 2;

// kg each, where the rule by kind (weightOf) is not enough
export const WEIGHT = {
  hacha_hierro: 1.8, pico_hierro: 2.5, guadana_hierro: 2, azada_hierro: 1.6, pala_hierro: 2.2, pala_llena: 8.2, hammer: 0.9,
  regadera: 1, cana: 0.6, cana_fibra: 0.5, red: 0.4, arco: 1, flecha: 0.03, espada: 1.5, espada_oro: 2, brujula: 0.1, mapa: 0.05, mapa_vacio: 0.05,
  madera: 2, tablas: 0.5, piedra: 1, cobre: 1.5, hierro: 1.5, oro: 1.5, lingote_cobre: 1, lingote_hierro: 1, lingote_oro: 1.2, carbon: 0.3,
  fibra: 0.02, cuerda: 0.05, tela: 0.2, cuero: 0.5, piel: 1, lana: 0.1, lana_fina: 0.1, angora: 0.05, fieltro: 0.2, heno: 0.3, straw: 0.1, harina: 0.5,
  hueso: 0.3, manteca: 0.3, plumas: 0.02, asta: 1, colmillo: 0.2, frasco: 0.2, baba: 0.1, calavera: 1, abono: 1, manure: 1,
  huevo: 0.06, huevo_pato: 0.08, huevo_oro: 0.1, manzana: 0.2, coco: 1, pan: 0.5, leche: 1, leche_cabra: 1, nata: 0.5, queso: 0.5, queso_cabra: 0.5,
  mantequilla: 0.25, miel: 0.5, carne_ave: 0.3, carne_conejo: 0.4, estofado: 1, calabaza: 4, sidra: 0.5, cerveza: 0.6, hidromiel: 0.5,
  vela: 0.2, antorcha: 0.5, lampara: 3, candelabro: 4, maceta: 3, mochila: 1.5, alforjas: 2, caballo: 0.05, barca: 0.5,
  potato: 0.2, cabbage: 1.2, garlic: 0.06, broad_bean: 0.05, seed_potato: 0.06,
  pelota: 0.2, cepillo: 0.3, herraduras: 1, trufa: 0.1,
  // (thirst and diving: the canteen and the jug empty; their water is SIP_KG a sip, see stackKg. The pearl is lighter than
  // the gem rule's 0.02)
  canteen: 0.3, water_jug: 1, apple_juice: 0.4, seashell: 0.02, pearl: 0.01, seaweed: 0.1, mussel: 0.05,
  // (tackle and bait, Plan R1-2)
  worm: 0.005, cut_bait: 0.05, spoon: 0.02, jig: 0.02, landing_net: 0.8, salt: 0.3, fillet: 0.3, salted_fish: 0.4, rotten_fish: 0.5,
  // (Plan E §3.1: the coats and the heavier new garments; the rest are clothes, 0.4)
  wool_coat: 1.5, sheepskin_jacket: 2, lined_boots: 1.2, leather_apron: 0.8,
};
// kg of one sip of water in a canteen or a jug (s.sips)
export const SIP_KG = 0.25;
// Armour by piece and metal (copper, iron, gold): the gold is heavier
const ARMOR_KG = { casco: [1.5, 2, 3], peto: [6, 8, 9], grebas: [3, 4, 5], botas: [1.5, 2, 2.5] }, METALS = ['cobre', 'hierro', 'oro'];
// Rugs by their size
const RUG_KG = { '1x1': 1.5, '1x2': 2.5, '2x2': 4, '2x3': 6, '3x4': 12 };

// The big things, carried one at a time in the arms (or on the shoulder): never in the backpack. hold: how ('shoulder',
// a log on the right shoulder; 'across', a carcass over both shoulders); slow: the speed carrying it; parts: what it is
// worth where there is no carrying (the slot inventory, creative): BULKY_PARTS. The log: split in the field (field)
// gives less than sawn at the bench (saw). A carcass (prey: whose; drops: as PREY in hunt.js, checked by a test) gives
// the least of each in the field and the most, plus extra, at the kitchen
export const BULKY = {
  log: { kg: 25, hold: 'shoulder', slow: 0.8, parts: [['madera', 4]], field: [['madera', 2]], saw: [['tablas', 10]] },
  carcass_deer: { kg: 35, hold: 'across', slow: 0.8, prey: 'ciervo', extra: 'hueso', color: '#8a6a48', drops: [['carne_venado', 2, 3], ['piel', 1, 2], ['asta', 1, 1, 0.6]] },
  carcass_hind: { kg: 28, hold: 'across', slow: 0.8, prey: 'ciervo', female: true, extra: 'hueso', color: '#86643f', drops: [['carne_venado', 2, 3], ['piel', 1, 2]] },
  carcass_boar: { kg: 30, hold: 'across', slow: 0.8, prey: 'jabali', extra: 'hueso', color: '#4a3a30', drops: [['carne_jabali', 2, 3], ['piel', 1, 1], ['colmillo', 1, 2]] },
  carcass_cow: { kg: 60, hold: 'across', slow: 0.65, prey: 'vaca', extra: 'hueso', color: '#d8d0c4', drops: [['carne_vaca', 2, 4], ['piel', 1, 2], ['hueso', 1, 2]] },
  carcass_sheep: { kg: 25, hold: 'across', slow: 0.8, prey: 'oveja', extra: 'hueso', color: '#e4dccb', drops: [['carne_cordero', 1, 3], ['piel', 1, 1], ['lana', 1, 3]] },
  carcass_goat: { kg: 22, hold: 'across', slow: 0.8, prey: 'cabra', extra: 'hueso', color: '#b0a088', drops: [['carne_cabra', 1, 2], ['piel', 1, 1], ['hueso', 1, 1]] },
  carcass_pig: { kg: 35, hold: 'across', slow: 0.8, prey: 'cerdo', extra: 'manteca', color: '#e0a898', drops: [['carne_cerdo', 2, 3], ['piel', 1, 1], ['manteca', 1, 2]] },
};
// The carcass each prey leaves (only the adults of these; birds, rabbits and the young drop their meat as before)
export const CARCASS_OF = Object.fromEntries(Object.entries(BULKY).filter(([, b]) => b.prey).map(([id, b]) => [b.female ? b.prey + ':f' : b.prey, id]));   // ('ciervo:f': a hind's, with no antlers)
// What a big thing is worth as things of the backpack: the log, 4 wood; a carcass, the most of each of its drops
export const BULKY_PARTS = Object.fromEntries(Object.entries(BULKY).map(([id, b]) => [id, b.parts || b.drops.map(([m, , max]) => [m, max])]));
export const isBulky = id => !!BULKY[id];

// kg of one of a thing: its own weight, or by its kind; 0.2 if nothing says
export function weightOf(id) {
  if (WEIGHT[id] !== undefined) return WEIGHT[id];
  const d = ITEMS[id];
  if (!d) return 0.2;
  if (BULKY[id]) return BULKY[id].kg;
  if (d.armor) return ARMOR_KG[d.piece]?.[METALS.indexOf(d.metal)] ?? 3;
  if (d.fish) return typicalG(id) / 1000;   // (one that says nothing of itself: catch.js)
  if (d.rug) return RUG_KG[(d.size || [1, 1]).join('x')] ?? 2;
  if (d.wear) return 0.4;
  if (d.seed || d.sapling || d.bug) return 0.01;
  if (d.flower || d.gem || d.relic) return 0.02;
  if (d.fossil) return 0.3;
  if (d.potion) return 0.3;
  if (/^carne_/.test(id)) return 0.5;
  if (d.food) return 0.4;
  if (d.place === 'wall') return 2;
  if (d.place) return 5;
  if (d.tool || d.weapon) return 1.5;
  return 0.2;
}

// kg of a whole stack ({ id, n, sips?, g? }): what it weighs (fish: its own grams, catch.js) plus the water it holds. Everything that weighs a stack goes
// through here (the load, the list's rows and their order, the tooltip), so they always agree
export const stackKg = s => (s ? (s.g > 0 && tracked(s.id) ? unitG(s) / 1000 : weightOf(s.id)) * (s.n || 1) + (s.sips > 0 ? s.sips * SIP_KG : 0) : 0);

// The new ids, in ITEMS (their names and descriptions come from the language files: item.<id>, item.<id>.desc)
const NEW = {};
for (const id of Object.keys(BULKY)) NEW[id] = ITEMS[id] = { name: id, desc: '', place: 'furniture', stack: 1, bulky: true, hide: true };
defineNames(NEW, 'item');

// ---------- the wheelbarrow (barrow.js; docs/planes/gta/PLAN-C2-fase2.md) ----------
// One geometry for everything that needs it: the movement, parking, doors, and the drawing (three/models.js, carry3d.js).
// Model space (metres): the origin is the centre of its footprint, on the ground; the wheel towards +z, the grips towards −z.
// STACKS: what its chest holds; LOADS: the big things on it; SLOW: the speed pushing it (survival); DEEP: the water it does
// not go into; TURN: how fast it turns (rad/s)
export const BARROW = {
  ID: 'wheelbarrow', STACKS: 12, LOADS: 3, SLOW: 0.85, DEEP: 0.5, TURN: 3.0,
  LEN: 1.45, WIDTH: 0.62,          // the footprint box: x ∈ [−0.31, 0.31], z ∈ [−0.725, 0.725]
  WHEEL_Z: 0.55, WHEEL_R: 0.17,    // the wheel's axle (z) and radius
  GRIP_Z: -0.725, GRIP_X: 0.27,    // the grips' ends (±x)
  GRIP_Y: 0.42,                    // the grips' height when parked (resting on the wheel and the legs)
  GRIP_AHEAD: 0.35,                // pushed: the grips this far ahead of the pusher's centre (out of the body's 0.28)
  GRIP_H: 0.8,                     // pushed: the grips lifted to this height (the hands'), turned round the axle
};
// Parked by its pusher: the model's origin this far ahead (its grips where the hands were, GRIP_AHEAD)
export const CENTER_AHEAD = BARROW.GRIP_AHEAD - BARROW.GRIP_Z;   // 1.075
// Pushed, it is turned round the axle (the wheel on the ground) until the grips are at GRIP_H: LIFT is that turn. Lifted,
// it is shorter on the ground than parked, so its footprint while pushed (entities.js) is where it is drawn (three/carry3d.js
// does the same turn): pushedAhead(z, y) is how far ahead of the pusher a point of the model (z along it, y up) is then
const LIFT_DY = BARROW.GRIP_Y - BARROW.WHEEL_R, LIFT_DZ = BARROW.WHEEL_Z - BARROW.GRIP_Z, LIFT_R = Math.hypot(LIFT_DY, LIFT_DZ);
export const LIFT = Math.asin(Math.min(1, (BARROW.GRIP_H - BARROW.WHEEL_R) / LIFT_R)) - Math.atan2(LIFT_DY, LIFT_DZ);   // ~0.31 rad
export const WHEEL_AHEAD = BARROW.GRIP_AHEAD + LIFT_R * Math.cos(LIFT + Math.atan2(LIFT_DY, LIFT_DZ));               // ~1.49: pushed, the axle ahead of the pusher
export const pushedAhead = (z, y = BARROW.WHEEL_R) => WHEEL_AHEAD + (z - BARROW.WHEEL_Z) * Math.cos(LIFT) + (y - BARROW.WHEEL_R) * Math.sin(LIFT);
// The key of its model, and of st.ca while pushing it: 'wheelbarrow' (empty), 'wheelbarrow:<ids, sorted, with commas>' (with
// big things on it), 'wheelbarrow:<ids>:f' or 'wheelbarrow::f' (with stacks in it): 'wheelbarrow:log,log',
// 'wheelbarrow:carcass_deer,log:f'. Each id one of BULKY, LOADS at most
export function barrowKey(ids = [], full = false) {
  const list = (ids || []).filter(id => typeof id === 'string' && BULKY[id]).slice(0, BARROW.LOADS).sort();
  if (!list.length && !full) return BARROW.ID;
  return `${BARROW.ID}:${list.join(',')}${full ? ':f' : ''}`;
}
// → { ids, full } or null (not a wheelbarrow's key, or an id that is not a big thing, or more than LOADS)
export function parseBarrowKey(key) {
  if (typeof key !== 'string' || key.length > 120) return null;
  const [kind, list = '', flag, more] = key.split(':');
  if (kind !== BARROW.ID || more !== undefined || (flag !== undefined && flag !== 'f')) return null;
  const ids = list ? list.split(',') : [];
  if (ids.length > BARROW.LOADS || ids.some(id => !BULKY[id])) return null;
  return { ids, full: flag === 'f' };
}
// What comes from the network: always a valid key (the plain wheelbarrow if it cannot be read)
export function cleanBarrowKey(key) {
  const k = parseBarrowKey(key);
  return k ? barrowKey(k.ids, k.full) : BARROW.ID;
}
// 8 letters at random: a wheelbarrow's id, the mark of a big thing left in a boat, a request (barrow.js)
export const randomId = () => { let s = ''; for (let i = 0; i < 8; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]; return s; };
