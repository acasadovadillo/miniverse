// Economía: lo que vale cada cosa al venderla y lo que cuesta comprarla en las tiendas de los vecinos.
import { ITEMS, CROPS, FISH } from './items.js';
import { RECIPES } from './recipes.js';

const BASE = {
  madera: 2, piedra: 2, fibra: 2, carbon: 6, cobre: 10, hierro: 18, oro: 40, bellota: 5, pina: 5,
  coco: 15, harina: 30, manzana: 12, bayas: 6, pulpa: 10, huevo: 20, leche: 30, lana: 45, miel: 40, tablas: 2, abono: 6,
  amatista: 80, esmeralda: 140, rubi: 200, diamante: 400, fosil_concha: 60, fosil_hueso: 120, fosil_ambar: 150,
  calavera: 30, moneda_antigua: 100, lingote_cobre: 36, lingote_hierro: 57, lingote_oro: 114,
  pocion_rapidez: 60, pocion_fuerza: 80, pocion_resistencia: 90, pocion_regeneracion: 90,
  huevo_pato: 35, huevo_oro: 300, plumas: 12, leche_cabra: 40, nata: 60, lana_fina: 140, angora: 55, trufa: 250, heno: 3,
};
const cache = new Map();

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

// Lo que vende cada vecino. `season`: solo esa estación; `project`: solo con ese proyecto terminado;
// `animal`: no es un objeto, es un animal para tu granja; `price`: precio fijo
export const SHOPS = {
  rosa: {
    title: 'Puesto de Rosa', hours: [9, 18], buysAll: true,
    stock: [
      ...Object.keys(CROPS).map(c => ({ id: 'semilla_' + c, seasons: CROPS[c].seasons, price: Math.round(CROPS[c].price * 0.5) })),
      { id: 'semilla_manzano', price: 120 }, { id: 'abono', price: 25 },
      { animal: 'gallina', name: 'Gallina', price: 400 }, { animal: 'pato', name: 'Pato', price: 500 }, { animal: 'conejo', name: 'Conejo', price: 700 },
      { animal: 'cabra', name: 'Cabra', price: 1000 }, { animal: 'cerdo', name: 'Cerdo', price: 1300 }, { animal: 'oveja', name: 'Oveja', price: 1200, project: 'mercado' }, { animal: 'vaca', name: 'Vaca', price: 1500, project: 'mercado' },
      { id: 'maceta', price: 90 }, { id: 'alfombra', price: 160, project: 'mercado' }, { id: 'lampara', price: 220, project: 'mercado' },
      { id: 'pan', price: 70 }, { id: 'manzana', price: 30 },
    ],
  },
  bruno: {
    title: 'Herrería de Bruno', hours: [8, 17],
    stock: [{ id: 'carbon', price: 18 }, { id: 'piedra', price: 6 }, { id: 'lingote_cobre', price: 90 }, { id: 'lingote_hierro', price: 160, project: 'mercado' }, { id: 'antorcha', price: 15 }, { id: 'espada', price: 450 }, { id: 'pico_piedra', price: 120 }, { id: 'hacha_piedra', price: 120 }, { id: 'herraduras', price: 350 }],
  },
  lia: {
    title: 'Aparejos de Lía', hours: [6, 20],
    stock: [{ id: 'cana', price: 150 }, { id: 'cana_fibra', price: 1500 }, { id: 'regadera', price: 200 }, { id: 'barca', price: 1800 }, { id: 'sardina', price: 65 }],
  },
  dani: {
    title: 'Taller de Dani', hours: [10, 19],
    stock: [{ id: 'maceta', price: 80 }, { id: 'alfombra', price: 140 }, { id: 'estanteria', price: 200 }, { id: 'lampara', price: 200 }, { id: 'cama', price: 350 }, { id: 'sofa', price: 420 }, { id: 'caballo', price: 3000 }],
  },
};
