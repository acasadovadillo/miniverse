// Recetas: qué se fabrica, dónde (a mano o en una estación) y con qué.
// Una receta se desbloquea cuando ya has tenido todos sus ingredientes, salvo las que te enseña alguien (`teach`).
import { ITEMS, toolId, RUG_MADE, rugId, ARMOR_PIECES, ARMOR_METALS } from './items.js';

export const STATIONS = {
  mano: { name: 'A mano' },
  banco: { name: 'Banco de carpintero' },
  horno: { name: 'Horno' },
  yunque: { name: 'Yunque' },
  telar: { name: 'Telar' },
  cocina: { name: 'Cocina' },
  quesera: { name: 'Quesera' },
  alambique: { name: 'Alambique' },
  mesa_encantar: { name: 'Mesa de encantar' },
  noria: { name: 'Noria' },
};

const R = (station, out, n, ins, extra = {}) => ({ id: out, station, out, n, ins, ...extra });
// Una alfombra de cada tamaño: cuesta según lo que ocupa (la de 2×2, cuatro veces lo de la de 1×1). En la lista sale
// la de 1×1 y el tamaño se elige al fabricarla (variant: la alfombra de 1×1 de la que es)
const rugs = (kind, ins) => RUG_MADE.map(size => { const a = size[0] * size[1]; return R('telar', rugId(kind, size), 1, ins.map(([id, n]) => [id, n * a]), a > 1 ? { variant: kind } : {}); });

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
  R('banco', 'mesa_grande', 1, [['tablas', 12]]),
  R('banco', 'cofre', 1, [['tablas', 8]]),
  R('banco', 'estanteria', 1, [['tablas', 6]]),
  R('banco', 'maceta', 1, [['piedra', 3], ['fibra', 2]]),
  R('banco', 'cama', 1, [['tablas', 6], ['tela', 2]]),
  R('banco', 'cama_doble', 1, [['tablas', 10], ['tela', 4]]),
  R('banco', 'sofa', 1, [['tablas', 8], ['tela', 4], ['fibra', 4]]),
  R('banco', 'sillon', 1, [['tablas', 4], ['tela', 3], ['fibra', 3]]),
  R('banco', 'mesa_baja', 1, [['tablas', 4]]),
  R('banco', 'mesita', 1, [['tablas', 5]]),
  R('banco', 'comoda', 1, [['tablas', 10]]),
  R('banco', 'cama_nino', 1, [['tablas', 5], ['tela', 2]]),
  R('banco', 'cuna', 1, [['tablas', 6], ['tela', 1]]),
  R('banco', 'alacena', 1, [['tablas', 8], ['piedra', 2]]),
  R('banco', 'armario', 1, [['tablas', 10], ['cuerda', 1]]),
  R('banco', 'mueble_bano', 1, [['tablas', 4], ['tela', 1]]),
  R('banco', 'chimenea', 1, [['piedra', 8]]),
  // Cuadros: un marco de tablas, el lienzo de tela y bayas para los colores
  ...['cuadro_valle', 'cuadro_mar', 'cuadro_flores', 'cuadro_noche'].map(id => R('banco', id, 1, [['tablas', 1], ['tela', 1], ['bayas', 2]])),
  R('banco', 'encimera', 1, [['tablas', 5], ['piedra', 1]]),
  R('banco', 'fregadero', 1, [['piedra', 8], ['tablas', 2], ['lingote_cobre', 1]]),
  R('banco', 'banera', 1, [['piedra', 12], ['lingote_cobre', 2]]),
  R('banco', 'inodoro', 1, [['piedra', 6], ['tablas', 1], ['lingote_cobre', 1]]),
  R('banco', 'lavabo', 1, [['piedra', 5], ['lingote_cobre', 1], ['lingote_hierro', 1]]),
  R('banco', 'lampara', 1, [['lingote_cobre', 1], ['tablas', 1], ['carbon', 1]]),
  R('mano', 'antorcha', 3, [['madera', 1], ['carbon', 1]]),

  // (fundir minerales y hacer carbón lleva su tiempo y combustible: ver machines.js)
  R('horno', 'yunque', 1, [['lingote_cobre', 3], ['piedra', 6]]),
  R('horno', 'frasco', 3, [['piedra', 2], ['carbon', 1]]),
  R('yunque', 'alambique', 1, [['lingote_hierro', 2], ['piedra', 4], ['frasco', 1]]),
  R('yunque', 'mesa_encantar', 1, [['amatista', 4], ['tablas', 6], ['lingote_hierro', 2]]),
  R('yunque', 'brujula', 1, [['lingote_hierro', 4], ['amatista', 1]]),
  R('banco', 'mapa_vacio', 1, [['tela', 2], ['carbon', 1]]),
  R('banco', 'noria', 1, [['tablas', 24], ['piedra', 12], ['lingote_hierro', 2]]),

  R('telar', 'tela', 1, [['fibra', 4]]),
  R('telar', 'tela', 2, [['lana', 1]], { id: 'tela_lana' }),
  R('banco', 'regadera', 1, [['lingote_cobre', 1], ['tablas', 1]]),
  R('banco', 'cana', 1, [['tablas', 2], ['cuerda', 2]]),
  R('banco', 'gallinero', 1, [['tablas', 20], ['fibra', 10]]),
  R('banco', 'establo', 1, [['tablas', 30], ['piedra', 20]]),
  R('banco', 'colmena', 1, [['tablas', 6], ['fibra', 4]]),
  R('banco', 'comedero', 1, [['tablas', 4]]),
  R('banco', 'silo', 1, [['tablas', 30], ['piedra', 30], ['lingote_cobre', 2]]),
  R('banco', 'cuadra', 1, [['tablas', 35], ['piedra', 15]]),
  R('banco', 'conejera', 1, [['tablas', 12], ['fibra', 6]]),
  R('banco', 'caseta', 1, [['tablas', 10]]),
  R('banco', 'palomar', 1, [['tablas', 14], ['fibra', 4]]),
  R('banco', 'incubadora', 1, [['tablas', 6], ['piedra', 4], ['lingote_cobre', 2]]),
  R('banco', 'quesera', 1, [['tablas', 10], ['piedra', 6], ['lingote_hierro', 1]]),
  R('banco', 'cepillo', 1, [['tablas', 1], ['fibra', 3]]),
  R('telar', 'cojin', 1, [['tela', 2], ['fibra', 4]]),
  R('telar', 'alforjas', 1, [['tela', 4], ['cuerda', 2]]),
  R('telar', 'fieltro', 1, [['angora', 2]]),
  R('mano', 'pelota', 1, [['fibra', 4]]),
  R('mano', 'vela', 2, [['miel', 1], ['fibra', 1]]),
  R('yunque', 'candelabro', 1, [['lingote_hierro', 2], ['vela', 6], ['cuerda', 1]]),
  R('quesera', 'queso', 1, [['leche', 2]], { id: 'queso_quesera' }),
  R('quesera', 'queso_cabra', 1, [['leche_cabra', 2]]),
  R('quesera', 'mantequilla', 1, [['nata', 1]]),
  R('quesera', 'mantequilla', 1, [['leche', 3]], { id: 'mantequilla_leche' }),
  R('cocina', 'tortilla', 1, [['huevo_pato', 1], ['huevo', 1]], { id: 'tortilla_pato' }),
  R('yunque', 'aspersor', 1, [['lingote_cobre', 2], ['lingote_hierro', 1]]),
  R('mano', 'abono', 2, [['fibra', 2], ['bayas', 1]]),
  R('yunque', 'espada', 1, [['lingote_hierro', 2], ['tablas', 1]]),
  R('yunque', 'espada_oro', 1, [['lingote_oro', 3], ['rubi', 1]]),
  // Armaduras: lo mismo que en Minecraft (casco 5 lingotes, peto 8, grebas 7, botas 4)
  ...ARMOR_METALS.flatMap(([metal]) => ARMOR_PIECES.map(([piece], i) => R('yunque', `${piece}_${metal}`, 1, [[`lingote_${metal}`, [5, 8, 7, 4][i]]]))),
  R('cocina', 'pocion', 1, [['baba', 2], ['miel', 1]]),
  R('banco', 'barca', 1, [['tablas', 40], ['cuerda', 6]]),
  R('banco', 'red', 1, [['tablas', 2], ['tela', 1], ['cuerda', 1]]),
  R('banco', 'vitrina', 1, [['tablas', 8], ['piedra', 2]]),
  R('cocina', 'tortilla', 1, [['huevo', 2]]),
  R('cocina', 'queso', 1, [['leche', 2]]),
  R('cocina', 'pan', 1, [['trigo', 3]]),
  R('cocina', 'pan', 1, [['harina', 2]], { id: 'pan_harina' }),
  R('cocina', 'tarta_calabaza', 1, [['calabaza', 1], ['huevo', 1], ['trigo', 1]]),
  R('cocina', 'sopa_verduras', 1, [['nabo', 1], ['zanahoria', 1], ['tomate', 1]]),
  R('cocina', 'pescado_asado', 1, [['sardina', 1]], { id: 'asado_sardina' }),
  R('cocina', 'pescado_asado', 1, [['carpa', 1]], { id: 'asado_carpa' }),
  R('cocina', 'pescado_asado', 1, [['trucha', 1]], { id: 'asado_trucha' }),
  R('cocina', 'pescado_asado', 1, [['perca', 1]], { id: 'asado_perca' }),
  R('cocina', 'mermelada_fresa', 1, [['fresa', 3]]),
  R('cocina', 'palomitas', 1, [['maiz', 2]]),
  R('cocina', 'tostada_miel', 1, [['pan', 1], ['miel', 1]]),
  ...rugs('alfombra', [['tela', 3]]),
  ...rugs('alfombra_persa', [['tela', 3], ['bayas', 2]]),
  ...rugs('alfombra_rayas', [['tela', 2], ['lana', 2]]),
  ...rugs('alfombra_rombos', [['tela', 3], ['lana', 1]]),
  ...rugs('alfombra_trenzada', [['fibra', 6], ['tela', 1]]),
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
  R('telar', 'hijab', 1, [['tela', 2]]),
  R('telar', 'lazo', 1, [['tela', 1]]),
  R('telar', 'diadema', 1, [['tela', 1], ['tablas', 1]]),
  R('mano', 'flor_pelo', 1, [['fibra', 2], ['bayas', 1]]),
  R('yunque', 'horquillas', 2, [['lingote_cobre', 1]]),
  R('mano', 'corona_flores', 1, [['fibra', 4], ['bayas', 2]]),

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
