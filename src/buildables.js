// Los construibles que antes eran objetos de la mochila: los muebles, las estaciones (con la noria) y las casas y
// aparatos del rancho, que no caben en la mano. Se ponen
// con el modo construir (B, ver build.js), pagando sus materiales al colocarlos (los de su receta) y con su estación
// cerca (el banco de carpintero para casi todos); al quitarlos devuelven los materiales, y con Mover se cambian de sitio
// sin coste. Siguen estando en ITEMS (su nombre, su icono, su modelo y lo que hacen colocados), pero ya no se fabrican
// con C ni van en la mochila: lo que quedara guardado de antes se cambia por sus materiales (LEGACY_ITEMS).
import { ITEMS, LEGACY_ITEMS } from './items.js';
import { RECIPES } from './recipes.js';

export const BUILD_CATS = {
  Muebles: ['silla', 'mesa', 'mesa_grande', 'mesa_baja', 'mesita', 'sofa', 'sillon', 'cama', 'cama_doble', 'cama_nino', 'cuna', 'cofre', 'armario', 'comoda', 'estanteria', 'vitrina', 'chimenea', 'taburete', 'barra', 'barril'],
  'Cocina y baño': ['encimera', 'alacena', 'fregadero', 'banera', 'lavabo', 'inodoro', 'mueble_bano'],
  Estaciones: ['banco', 'cantero', 'horno', 'telar', 'cocina', 'yunque', 'quesera', 'alambique', 'noria'],
  Exterior: ['barca'],   // (la barca: se amarra en el agua; ver crew.js)
  Rancho: ['gallinero', 'establo', 'cuadra', 'conejera', 'caseta', 'palomar', 'comedero', 'silo', 'colmena', 'incubadora'],
};
// id → { name, cat, cost: [[material, n]…], needs: la estación que hay que tener cerca (o null: a mano), recipe: la
// receta que hay que conocer para que salga en la barra }
export const BUILDABLE = {};
for (const [cat, ids] of Object.entries(BUILD_CATS)) for (const id of ids) {
  const r = RECIPES.find(q => q.out === id && q.n === 1 && !q.variant);
  if (!r || !ITEMS[id]) continue;
  BUILDABLE[id] = { name: ITEMS[id].name, cat, cost: r.ins, needs: r.station === 'mano' ? null : r.station, recipe: r.id };
  for (const q of RECIPES) if (q.out === id) q.build = true;   // (ya no sale en la ventana de fabricar)
  LEGACY_ITEMS[id] = r.ins;
}

// Los planos: todos los muebles (los de casa, los de la cocina y el baño y los de taberna) y la barca no se aprenden solos
// al haber tenido sus materiales, como las estaciones y lo del rancho; su plano se compra en una tienda (economy.js,
// { plan }) y enseña a construirlos para siempre (crafting.js, learnPlan). Quien ya sabía hacerlos cuando llegaron los
// planos, los conserva (crafting.js, reset; PLANS_V: la tanda de planos, para que valga también al añadir más)
export const PLANS = new Set([...BUILD_CATS.Muebles, ...BUILD_CATS['Cocina y baño'], 'barca'].filter(id => BUILDABLE[id]));
export const PLANS_V = 2;
for (const r of RECIPES) if (PLANS.has(r.out)) r.plan = true;
