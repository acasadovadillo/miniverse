// Los construibles que antes eran objetos de la mochila: los muebles, las estaciones (con la noria) y las casas y
// aparatos del rancho, que no caben en la mano. Se ponen
// con el modo construir (B, ver build.js), pagando sus materiales al colocarlos (los de su receta) y con su estación
// cerca (el banco de carpintero para casi todos); al quitarlos devuelven los materiales, y con Mover se cambian de sitio
// sin coste. Siguen estando en ITEMS (su nombre, su icono, su modelo y lo que hacen colocados), pero ya no se fabrican
// con C ni van en la mochila: lo que quedara guardado de antes se cambia por sus materiales (LEGACY_ITEMS).
import { ITEMS, LEGACY_ITEMS } from './items.js';
import { RECIPES } from './recipes.js';

export const BUILD_CATS = {
  Muebles: ['silla', 'mesa', 'mesa_grande', 'mesa_baja', 'mesita', 'sofa', 'sillon', 'cama', 'cama_doble', 'cama_nino', 'cuna', 'cofre', 'armario', 'comoda', 'estanteria', 'vitrina', 'chimenea', 'taburete', 'barra', 'barril', 'barber_chair', 'pew'],
  'Cocina y baño': ['encimera', 'alacena', 'fregadero', 'banera', 'lavabo', 'inodoro', 'mueble_bano'],
  Estaciones: ['banco', 'cantero', 'horno', 'telar', 'cocina', 'yunque', 'quesera', 'alambique', 'noria'],
  Exterior: ['barca', 'pozo', 'big_well', 'wheelbarrow', 'tent', 'campfire', 'brazier', 'signpost', 'stone_bench', 'stone_trough', 'jetty', 'stone_bridge', 'watchtower', 'watchtower_tall', 'lighthouse', 'lighthouse_stone', 'lighthouse_black', 'bell_frame', 'net_rack', 'fish_rack', 'hide_rack', 'log_pile', 'firewood', 'plank_stack', 'sawpit', 'chop_block', 'charcoal_clamp', 'charcoal_heap', 'hayrick', 'hay_pile', 'ore_cart', 'rail', 'spoil_heap', 'mine_front', 'crypt_hatch', 'beached_up', 'beached_trestle', 'beached_side', 'beached_keel', 'beached_buried', 'pennant', 'post_lantern', 'ivy', 'sand_drift', 'salt_lick'],   // (la barca: se amarra en el agua, ver crew.js; el pozo, en un hoyo cavado con la pala, ver scenes.js)
  Rancho: ['gallinero', 'establo', 'cuadra', 'conejera', 'caseta', 'palomar', 'comedero', 'silo', 'colmena', 'incubadora', 'compost_bin', 'scarecrow', 'trough', 'hitching_post'],
};
// id → { name, cat, cost: [[material, n]…], needs: la estación que hay que tener cerca (o null: a mano), recipe: la
// receta que hay que conocer para que salga en la barra }
export const BUILDABLE = {};
for (const [cat, ids] of Object.entries(BUILD_CATS)) for (const id of ids) {
  const r = RECIPES.find(q => q.out === id && q.n === 1 && !q.variant);
  if (!r || !ITEMS[id]) continue;
  // (name read when asked: the big well's comes from the language files, which can change while playing)
  BUILDABLE[id] = { get name() { return ITEMS[id].name; }, cat, cost: r.ins, needs: r.station === 'mano' ? null : r.station, recipe: r.id };
  for (const q of RECIPES) if (q.out === id) q.build = true;   // (ya no sale en la ventana de fabricar)
  LEGACY_ITEMS[id] = r.ins;
}

// Los planos: todos los muebles (los de casa, los de la cocina y el baño y los de taberna) y la barca no se aprenden solos
// al haber tenido sus materiales, como las estaciones y lo del rancho; su plano se compra en una tienda (economy.js,
// { plan }) y enseña a construirlos para siempre (crafting.js, learnPlan). Quien ya sabía hacerlos cuando llegaron los
// planos, los conserva (crafting.js, reset; PLANS_V: la tanda de planos, para que valga también al añadir más)
export const PLANS = new Set([...BUILD_CATS.Muebles, ...BUILD_CATS['Cocina y baño'], 'barca', 'wheelbarrow'].filter(id => BUILDABLE[id]));
export const PLANS_V = 2;
// What was born with its plan: nobody could build it before, so an old save never gets it for free (crafting.js, reset),
// whatever its planos number
export const PLAN_BORN = new Set(['wheelbarrow', 'barber_chair', 'pew']);
for (const r of RECIPES) if (PLANS.has(r.out)) r.plan = true;
