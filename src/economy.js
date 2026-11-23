// Economía: lo que vale cada cosa al venderla y lo que cuesta comprarla en las tiendas de los vecinos.
import { ITEMS, CROPS, FISH } from './items.js';
import { t } from './i18n.js';
import { RECIPES } from './recipes.js';

const BASE = {
  madera: 2, piedra: 2, fibra: 2, carbon: 6, cobre: 10, hierro: 18, oro: 40, bellota: 5, pina: 5,
  coco: 15, harina: 30, manzana: 12, bayas: 6, pulpa: 10, huevo: 20, leche: 30, lana: 45, miel: 40, tablas: 2, abono: 6,
  amatista: 80, esmeralda: 140, rubi: 200, diamante: 400, fosil_concha: 60, fosil_hueso: 120, fosil_ambar: 150,
  calavera: 30, moneda_antigua: 100, lingote_cobre: 36, lingote_hierro: 57, lingote_oro: 114,
  pocion_rapidez: 60, pocion_fuerza: 80, pocion_resistencia: 90, pocion_regeneracion: 90,
  carne_ave: 14, carne_conejo: 16, carne_vaca: 30, carne_cordero: 26, carne_cabra: 24, carne_cerdo: 26, carne_venado: 30, carne_jabali: 30, piel: 20, hueso: 6, manteca: 14, asta: 60, colmillo: 45,
  huevo_pato: 35, huevo_oro: 300, plumas: 12, leche_cabra: 40, nata: 60, lana_fina: 140, angora: 55, trufa: 250, heno: 3,
  // Thirst and diving: what the sea bed gives (Rosa buys it all), and what is made, below what the shops sell it for
  seashell: 5, pearl: 180, mussel: 4, seaweed: 2, canteen: 24, water_jug: 20, apple_juice: 30,
  // The body (Plan E §2.3): soap sells for less than Rosa asks
  soap: 10,
};
const cache = new Map();
const plans = list => Object.entries(list).map(([plan, price]) => ({ plan, price }));

// Precio de venta de un objeto (0 si no se vende)
export function priceOf(id) {
  if (cache.has(id)) return cache.get(id);
  cache.set(id, 0);   // contra recetas circulares
  const def = ITEMS[id];
  let p = BASE[id];
  if (p === undefined) {
    if (CROPS[id]) p = CROPS[id].price;
    else if (def.seed) p = Math.round(CROPS[def.seed].price * 0.2);
    else if (FISH[id]) p = FISH[id].rare ? 400 : Math.round(15 + FISH[id].size * 9 + FISH[id].dif * 80);   // los que pelean más valen más
    else {
      const r = RECIPES.find(r => r.out === id);
      p = r ? Math.round((r.ins.reduce((t, [i, n]) => t + priceOf(i) * n, 0) / r.n) * (def.food ? 1.5 : def.tool ? 0.5 : 1.3) + (def.food ? 8 : 2)) : 5;
    }
  }
  cache.set(id, p);
  return p;
}
export const buyPrice = id => Math.max(5, Math.round(priceOf(id) * 2.5));
// What Marta asks to mend a garment (Plan E §3.2): a quarter of what it costs new (her stall's price when she sells it,
// else buyPrice), × factor (the reputation's buyFactor)
export const MEND_SHARE = 0.25;
export const mendPrice = (id, factor = 1) => Math.max(1, Math.round((SHOPS.marta.stock.find(e => e.id === id)?.price ?? buyPrice(id)) * MEND_SHARE * factor));

// Lo que vende cada vecino. `season`: solo esa estación; `project`: solo con ese proyecto terminado;
// `animal`: no es un objeto, es un animal para tu granja; `price`: precio fijo; `plan`: tampoco es un objeto, es el plano
// de algo que se construye con B (buildables.js, PLANS): se compra una vez y enseña a construirlo
export const SHOPS = {
  rosa: {
    title: 'Puesto de Rosa', hours: [9, 18], buysAll: true,
    stock: [
      ...Object.keys(CROPS).map(c => ({ id: 'semilla_' + c, seasons: CROPS[c].seasons, price: Math.round(CROPS[c].price * 0.5) })),
      { id: 'semilla_manzano', price: 120 }, { id: 'abono', price: 25 },
      { animal: 'gallina', name: 'Gallina', price: 400 }, { animal: 'pato', name: 'Pato', price: 500 }, { animal: 'conejo', name: 'Conejo', price: 700 },
      { animal: 'cabra', name: 'Cabra', price: 1000 }, { animal: 'cerdo', name: 'Cerdo', price: 1300 }, { animal: 'oveja', name: 'Oveja', price: 1200, project: 'mercado' }, { animal: 'vaca', name: 'Vaca', price: 1500, project: 'mercado' },
      { id: 'maceta', price: 90 }, { id: 'alfombra', price: 160, project: 'mercado' }, { id: 'lampara', price: 220, project: 'mercado' },
      { id: 'pan', price: 70 }, { id: 'manzana', price: 30 }, { id: 'soap', price: 25 },
    ],
  },
  anselmo: {
    title: 'Taberna de Anselmo', hours: [10, 26],
    stock: [{ id: 'cerveza', price: 45 }, { id: 'sidra', price: 40 }, { id: 'apple_juice', price: 35 }, { id: 'hidromiel', price: 90 }, { id: 'pan', price: 70 }, { id: 'pollo_asado', price: 90 }, { id: 'estofado', price: 150 }, { id: 'filete', price: 130 }, { id: 'venado_asado', price: 160 }, { plan: 'taburete', price: 40 }, { plan: 'barra', price: 90 }, { plan: 'barril', price: 160 }, { plan: 'barber_chair', price: 220 }],
  },
  bruno: {
    title: 'Herrería de Bruno', hours: [8, 17],
    stock: [{ id: 'carbon', price: 18 }, { id: 'piedra', price: 6 }, { id: 'lingote_cobre', price: 90 }, { id: 'lingote_hierro', price: 160, project: 'mercado' }, { id: 'antorcha', price: 15 }, { id: 'espada', price: 450 }, { id: 'pico_hierro', price: 400 }, { id: 'hacha_hierro', price: 400 }, { id: 'guadana_hierro', price: 400 }, { id: 'azada_hierro', price: 400 }, { id: 'pala_hierro', price: 400 }, { id: 'herraduras', price: 350 }, { id: 'arco', price: 300 }, { id: 'flecha', price: 8 }],
  },
  // (Lía's canteen is sold empty: shop stacks carry no sips)
  lia: {
    title: 'Aparejos de Lía', hours: [6, 20],
    stock: [{ id: 'cana', price: 150 }, { id: 'cana_fibra', price: 1500 }, { id: 'regadera', price: 200 }, { id: 'canteen', price: 60 }, { plan: 'barca', price: 600 }, { id: 'sardina', price: 65 }],
  },
  // Nilo, en la plaza a todas horas: los planos de los muebles de siempre (los demás, Dani, cuando venga al pueblo)
  nilo: {
    title: 'Planos de Nilo', hours: [0, 24],
    stock: plans({ silla: 30, mesa: 40, cofre: 60, estanteria: 50, mesita: 60, cama: 120, cama_nino: 100, cuna: 100, cama_doble: 250, chimenea: 150 }),
  },
  // Marta, the tavern regular who spends the day knitting (Plan E §4.4): clothes by the village season (0 spring, 1 summer,
  // 2 autumn, 3 winter: game.days.season, which the shop window filters by), plus wool and cloth; at her tavern seat's
  // hours. She also mends (neighbors.js, at mendPrice). Her title comes from the language files
  marta: {
    get title() { return t('shop.title.marta'); }, hours: [17, 26],
    stock: [
      { id: 'wool_coat', price: 450, seasons: [2, 3] }, { id: 'sheepskin_jacket', price: 600, seasons: [3] },
      { id: 'wool_socks', price: 90, seasons: [2, 3] }, { id: 'lined_boots', price: 280, seasons: [3] }, { id: 'gorro', price: 120, seasons: [2, 3] },
      { id: 'linen_shirt', price: 120, seasons: [0, 1] }, { id: 'sombrero', seasons: [0, 1] },
      // (her wool at a knitter's price, not buyPrice's 113: the socks are made of one and must cost more than it)
      { id: 'leather_apron', price: 220 }, { id: 'lana', price: 60 }, { id: 'tela' },
    ],
  },
  dani: {
    title: 'Taller de Dani', hours: [10, 19],
    stock: [{ id: 'maceta', price: 80 }, { id: 'alfombra', price: 140 }, { id: 'lampara', price: 200 }, { id: 'caballo', price: 3000 },
      ...plans({ mesa_baja: 60, mesa_grande: 120, sillon: 220, sofa: 300, comoda: 250, armario: 280, vitrina: 200, encimera: 90, alacena: 140, mueble_bano: 110, fregadero: 180, lavabo: 180, inodoro: 180, banera: 320, wheelbarrow: 250 })],
  },
};
