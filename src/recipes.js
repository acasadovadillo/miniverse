// Recetas: qué se fabrica, dónde (a mano o en una estación) y con qué.
// Una receta se desbloquea cuando ya has tenido todos sus ingredientes, salvo las que te enseña alguien (`teach`).
import { ITEMS, toolId } from './items.js';

export const STATIONS = {
  mano: { name: 'A mano' },
  banco: { name: 'Banco de carpintero' },
  horno: { name: 'Horno' },
  yunque: { name: 'Yunque' },
  telar: { name: 'Telar' },
  cocina: { name: 'Cocina' },
};

const R = (station, out, n, ins, extra = {}) => ({ id: out, station, out, n, ins, ...extra });

export const RECIPES = [
  R('mano', 'tablas', 2, [['madera', 1]]),
  R('mano', 'cuerda', 1, [['fibra', 3]]),
  R('mano', 'mochila', 1, [['fibra', 8], ['cuerda', 2]]),
  R('mano', 'sombrero', 1, [['fibra', 6], ['cuerda', 1]]),
  R('mano', 'banco', 1, [['tablas', 6], ['piedra', 2]], { teach: 'Nilo' }),

  R('banco', 'horno', 1, [['piedra', 14]]),
  R('banco', 'telar', 1, [['tablas', 8], ['cuerda', 4]]),
  R('banco', 'cocina', 1, [['piedra', 8], ['tablas', 4], ['lingote_cobre', 2]]),
  R('banco', 'silla', 1, [['tablas', 4]]),
  R('banco', 'mesa', 1, [['tablas', 6]]),
  R('banco', 'cofre', 1, [['tablas', 8]]),
  R('banco', 'estanteria', 1, [['tablas', 6]]),
  R('banco', 'maceta', 1, [['piedra', 3], ['fibra', 2]]),
  R('banco', 'cama', 1, [['tablas', 6], ['tela', 2]]),
  R('banco', 'lampara', 1, [['lingote_cobre', 1], ['tablas', 1], ['carbon', 1]]),
  R('mano', 'antorcha', 3, [['madera', 1], ['carbon', 1]]),

  R('horno', 'carbon', 1, [['madera', 2]]),
  R('horno', 'lingote_cobre', 1, [['cobre', 2], ['carbon', 1]]),
  R('horno', 'lingote_hierro', 1, [['hierro', 2], ['carbon', 1]]),
  R('horno', 'lingote_oro', 1, [['oro', 2], ['carbon', 1]]),
  R('horno', 'yunque', 1, [['lingote_cobre', 3], ['piedra', 6]]),

  R('telar', 'tela', 1, [['fibra', 4]]),
  R('telar', 'tela', 2, [['lana', 1]], { id: 'tela_lana' }),
  R('banco', 'regadera', 1, [['lingote_cobre', 1], ['tablas', 1]]),
  R('banco', 'cana', 1, [['tablas', 2], ['cuerda', 2]]),
  R('banco', 'gallinero', 1, [['tablas', 20], ['fibra', 10]]),
  R('banco', 'establo', 1, [['tablas', 30], ['piedra', 20]]),
  R('banco', 'colmena', 1, [['tablas', 6], ['fibra', 4]]),
  R('banco', 'comedero', 1, [['tablas', 4]]),
  R('yunque', 'aspersor', 1, [['lingote_cobre', 2], ['lingote_hierro', 1]]),
  R('mano', 'abono', 2, [['fibra', 2], ['bayas', 1]]),
  R('yunque', 'espada', 1, [['lingote_hierro', 2], ['tablas', 1]]),
  R('yunque', 'espada_oro', 1, [['lingote_oro', 3], ['rubi', 1]]),
  R('cocina', 'pocion', 1, [['baba', 2], ['miel', 1]]),
  R('banco', 'barca', 1, [['tablas', 40], ['cuerda', 6]]),
  R('banco', 'red', 1, [['tablas', 2], ['tela', 1], ['cuerda', 1]]),
  R('banco', 'vitrina', 1, [['tablas', 8], ['piedra', 2]]),
  R('cocina', 'tortilla', 1, [['huevo', 2]]),
  R('cocina', 'queso', 1, [['leche', 2]]),
  R('cocina', 'pan', 1, [['trigo', 3]]),
  R('cocina', 'tarta_calabaza', 1, [['calabaza', 1], ['huevo', 1], ['trigo', 1]]),
  R('cocina', 'sopa_verduras', 1, [['nabo', 1], ['zanahoria', 1], ['tomate', 1]]),
  R('cocina', 'pescado_asado', 1, [['sardina', 1]], { id: 'asado_sardina' }),
  R('cocina', 'pescado_asado', 1, [['carpa', 1]], { id: 'asado_carpa' }),
  R('cocina', 'pescado_asado', 1, [['trucha', 1]], { id: 'asado_trucha' }),
  R('cocina', 'pescado_asado', 1, [['perca', 1]], { id: 'asado_perca' }),
  R('cocina', 'mermelada_fresa', 1, [['fresa', 3]]),
  R('cocina', 'palomitas', 1, [['maiz', 2]]),
  R('cocina', 'tostada_miel', 1, [['pan', 1], ['miel', 1]]),
  R('telar', 'alfombra', 1, [['tela', 3]]),
  // Ropa (en el telar)
  R('telar', 'camisa', 1, [['tela', 2]]),
  R('telar', 'pantalon', 1, [['tela', 2]]),
  R('telar', 'falda', 1, [['tela', 2]]),
  R('telar', 'chaleco', 1, [['tela', 2]]),
  R('telar', 'delantal', 1, [['tela', 2]]),
  R('telar', 'tunica', 1, [['tela', 3]]),
  R('telar', 'tunica_larga', 1, [['tela', 4]]),
  R('telar', 'camiseta_interior', 1, [['tela', 1]]),
  R('telar', 'calzoncillos', 1, [['tela', 1]]),
  R('telar', 'bragas', 1, [['tela', 1]]),
  R('telar', 'calcetines', 1, [['tela', 1]]),
  R('telar', 'botas', 1, [['tela', 2], ['cuerda', 1]]),
  R('telar', 'gorro', 1, [['lana', 2]]),

  R('cocina', 'manzana_asada', 1, [['manzana', 1]]),
  R('cocina', 'mermelada', 1, [['bayas', 3]]),
  R('cocina', 'coco_tostado', 1, [['coco', 1]]),
  R('cocina', 'pinones', 1, [['pina', 2]]),
  R('cocina', 'pan_bellota', 1, [['bellota', 3]]),
  R('cocina', 'estofado', 1, [['pulpa', 2], ['bayas', 1]]),
];
// Herramientas: las de piedra en el banco; las de metal en el yunque
for (const tool of ['hacha', 'pico', 'guadana', 'azada']) {
  RECIPES.push(R('banco', toolId(tool, 2), 1, [['tablas', 2], ['piedra', 3], ['cuerda', 1]]));
  for (const [tier, bar] of [[3, 'lingote_cobre'], [4, 'lingote_hierro'], [5, 'lingote_oro']]) {
    RECIPES.push(R('yunque', toolId(tool, tier), 1, [[bar, 3], ['tablas', 1]]));
  }
}
for (const r of RECIPES) if (!ITEMS[r.out] || r.ins.some(([id]) => !ITEMS[id])) throw new Error(`Receta rota: ${r.id}`);

// ¿Está desbloqueada? `seen`: objetos que el jugador ha tenido alguna vez; `taught`: recetas aprendidas
export const unlocked = (r, seen, taught) => taught.has(r.id) || (!r.teach && r.ins.every(([id]) => seen.has(id)));

// Pista para una receta bloqueada
export function lockedHint(r, seen) {
  if (r.teach) return `Pregunta a ${r.teach}`;
  const missing = r.ins.filter(([id]) => !seen.has(id)).map(([id]) => ITEMS[id].name.toLowerCase());
  return `Consigue antes: ${missing.join(', ')}`;
}
