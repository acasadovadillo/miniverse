// What things weigh, and the big things that are carried in the arms (the weight inventory, a prototype behind
// ?inventario=peso: see carry.js and docs/planes/gta/PLAN-C-peso.md). Only data: it imports items.js and i18n.js and
// nothing else (inventory.js imports this file, and carry.js extends Inventory: importing either here would be a cycle).
// The new ids are always in ITEMS, with or without the prototype, so every game of this version knows them (a log left
// by a player with the prototype is seen and picked up by one without it, as its parts). Hidden from the creative list
import { ITEMS, FISH } from './items.js';
import { defineNames } from './i18n.js';

// Capacity (kg): hands, pockets and belt; the backpack adds BAG_CAP. The load (kg / capacity) never refuses anything:
// above 1 you walk slower, above HEAVY as slow as it gets (see Carry.speedMul)
export const BASE_CAP = 25, BAG_CAP = 45, HEAVY = 1.5;
// Days a carcass lasts on the ground before only bones are left (logs last for ever)
export const CARCASS_DAYS = 2;

// kg each, where the rule by kind (weightOf) is not enough
export const WEIGHT = {
  hacha_hierro: 1.8, pico_hierro: 2.5, guadana_hierro: 2, azada_hierro: 1.6, pala_hierro: 2.2, pala_llena: 8.2,
  regadera: 1, cana: 0.6, cana_fibra: 0.5, red: 0.4, arco: 1, flecha: 0.03, espada: 1.5, espada_oro: 2, brujula: 0.1, mapa: 0.05, mapa_vacio: 0.05,
  madera: 2, tablas: 0.5, piedra: 1, cobre: 1.5, hierro: 1.5, oro: 1.5, lingote_cobre: 1, lingote_hierro: 1, lingote_oro: 1.2, carbon: 0.3,
  fibra: 0.02, cuerda: 0.05, tela: 0.2, cuero: 0.5, piel: 1, lana: 0.1, lana_fina: 0.1, angora: 0.05, fieltro: 0.2, heno: 0.3, harina: 0.5,
  hueso: 0.3, manteca: 0.3, plumas: 0.02, asta: 1, colmillo: 0.2, frasco: 0.2, baba: 0.1, calavera: 1, abono: 1,
  huevo: 0.06, huevo_pato: 0.08, huevo_oro: 0.1, manzana: 0.2, coco: 1, pan: 0.5, leche: 1, leche_cabra: 1, nata: 0.5, queso: 0.5, queso_cabra: 0.5,
  mantequilla: 0.25, miel: 0.5, carne_ave: 0.3, carne_conejo: 0.4, estofado: 1, calabaza: 4, sidra: 0.5, cerveza: 0.6, hidromiel: 0.5,
  vela: 0.2, antorcha: 0.5, lampara: 3, candelabro: 4, maceta: 3, mochila: 1.5, alforjas: 2, caballo: 0.05, barca: 0.5,
  pelota: 0.2, cepillo: 0.3, herraduras: 1, trufa: 0.1,
};
// Armour by piece and metal (copper, iron, gold): the gold is heavier
const ARMOR_KG = { casco: [1.5, 2, 3], peto: [6, 8, 9], grebas: [3, 4, 5], botas: [1.5, 2, 2.5] }, METALS = ['cobre', 'hierro', 'oro'];
// Fish by their size (items.js FISH)
const FISH_KG = { 3: 0.2, 4: 0.5, 5: 1, 6: 2.5, 7: 5 };
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
  carcass_boar: { kg: 30, hold: 'across', slow: 0.8, prey: 'jabali', extra: 'hueso', color: '#4a3a30', drops: [['carne_jabali', 2, 3], ['piel', 1, 1], ['colmillo', 1, 2]] },
  carcass_cow: { kg: 60, hold: 'across', slow: 0.65, prey: 'vaca', extra: 'hueso', color: '#d8d0c4', drops: [['carne_vaca', 2, 4], ['piel', 1, 2], ['hueso', 1, 2]] },
  carcass_sheep: { kg: 25, hold: 'across', slow: 0.8, prey: 'oveja', extra: 'hueso', color: '#e4dccb', drops: [['carne_cordero', 1, 3], ['piel', 1, 1], ['lana', 1, 3]] },
  carcass_goat: { kg: 22, hold: 'across', slow: 0.8, prey: 'cabra', extra: 'hueso', color: '#b0a088', drops: [['carne_cabra', 1, 2], ['piel', 1, 1], ['hueso', 1, 1]] },
  carcass_pig: { kg: 35, hold: 'across', slow: 0.8, prey: 'cerdo', extra: 'manteca', color: '#e0a898', drops: [['carne_cerdo', 2, 3], ['piel', 1, 1], ['manteca', 1, 2]] },
};
// The carcass each prey leaves (only the adults of these; birds, rabbits and the young drop their meat as before)
export const CARCASS_OF = Object.fromEntries(Object.entries(BULKY).filter(([, b]) => b.prey).map(([id, b]) => [b.prey, id]));
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
  if (d.fish) { const f = FISH[id]; return FISH_KG[f?.size] ?? 1; }
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

// The new ids, in ITEMS (their names and descriptions come from the language files: item.<id>, item.<id>.desc)
const NEW = {};
for (const id of Object.keys(BULKY)) NEW[id] = ITEMS[id] = { name: id, desc: '', place: 'furniture', stack: 1, bulky: true, hide: true };
defineNames(NEW, 'item');
