// Objetos (herramientas, materiales, comida y cosas que se colocan) y qué da cada cosa del mundo al recolectarla.

// Niveles de herramienta: un nivel mejor necesita menos golpes, trabaja más deprisa y saca mejores minerales.
export const TIERS = {
  1: { name: 'de madera', head: '#b08050', power: 1 },
  2: { name: 'de piedra', head: '#8e8a82', power: 1.5 },
  3: { name: 'de cobre', head: '#d8844a', power: 2 },
  4: { name: 'de hierro', head: '#b8c2ce', power: 3 },
  5: { name: 'de oro', head: '#f0c840', power: 4 },
};
const TOOLS = {
  hacha: { name: 'Hacha', desc: 'Tala árboles y corta cactus.' },
  pico: { name: 'Pico', desc: 'Pica rocas y peñascos. Cuanto mejor es, mejores minerales saca.' },
  guadana: { name: 'Guadaña', desc: 'Siega arbustos y matojos de un tajo.' },
  azada: { name: 'Azada', desc: 'Labra la tierra para sembrar.' },
};
const TIER_SUFFIX = { 1: '', 2: '_piedra', 3: '_cobre', 4: '_hierro', 5: '_oro' };
export const toolId = (tool, tier) => tool + TIER_SUFFIX[tier];

export const ITEMS = {
  madera: { name: 'Madera', desc: 'Troncos para construir y fabricar.' },
  piedra: { name: 'Piedra', desc: 'Para construir, y para hacer hornos.' },
  fibra: { name: 'Fibra', desc: 'Hebras vegetales para cuerdas y telas.' },
  carbon: { name: 'Carbón', desc: 'Combustible para el horno. También se hace quemando madera en el horno.' },
  cobre: { name: 'Mineral de cobre', desc: 'Sale de rocas y peñascos con un pico de piedra o mejor. En el horno se funde.' },
  hierro: { name: 'Mineral de hierro', desc: 'Sale de los peñascos con un pico de cobre o mejor. En el horno se funde.' },
  oro: { name: 'Mineral de oro', desc: 'Muy raro: sale de los peñascos con un pico de hierro o mejor.' },
  bellota: { name: 'Bellota', desc: 'Semilla de roble: plántala en la hierba y en unos días tendrás un árbol.', sapling: 'oak' },
  pina: { name: 'Piña', desc: 'Semilla de pino: se planta en la hierba. Tostada, sus piñones están ricos.', sapling: 'pine' },
  tablas: { name: 'Tablas', desc: 'Madera cortada, lista para fabricar.' },
  cuerda: { name: 'Cuerda', desc: 'Fibra trenzada. Sujeta las cabezas de las herramientas.' },
  tela: { name: 'Tela', desc: 'Tejida en el telar con fibra.' },
  lingote_cobre: { name: 'Lingote de cobre', desc: 'Para el yunque, la cocina y las herramientas de cobre.' },
  lingote_hierro: { name: 'Lingote de hierro', desc: 'Para herramientas de hierro en el yunque.' },
  lingote_oro: { name: 'Lingote de oro', desc: 'Para las mejores herramientas.' },
  // Comida (food: energía que da)
  coco: { name: 'Coco', desc: 'Cuesta abrirlo, pero merece la pena.', food: 12 },
  manzana: { name: 'Manzana', desc: 'Crujiente y dulce.', food: 15 },
  bayas: { name: 'Bayas', desc: 'Un puñado de bayas silvestres.', food: 8 },
  pulpa: { name: 'Pulpa de cactus', desc: 'Jugosa, aunque pincha un poco.', food: 10 },
  manzana_asada: { name: 'Manzana asada', desc: 'Caliente y con canela imaginaria.', food: 30 },
  mermelada: { name: 'Mermelada de bayas', desc: 'Un tarro entero. No preguntes de dónde ha salido el tarro.', food: 35 },
  coco_tostado: { name: 'Coco tostado', desc: 'Huele a playa.', food: 28 },
  pinones: { name: 'Piñones tostados', desc: 'Pequeños pero llenan.', food: 18 },
  pan_bellota: { name: 'Pan de bellota', desc: 'Denso, rústico y muy de pueblo.', food: 25 },
  estofado: { name: 'Estofado de cactus', desc: 'La especialidad del desierto. Da energía para rato.', food: 50 },
  // Cosas que se colocan en el mundo (place: estación de trabajo, mueble o algo plano en el suelo)
  banco: { name: 'Banco de carpintero', desc: 'Estación: herramientas de piedra, muebles y otras estaciones.', place: 'station' },
  horno: { name: 'Horno', desc: 'Estación: funde minerales en lingotes y hace carbón.', place: 'station' },
  yunque: { name: 'Yunque', desc: 'Estación: herramientas de cobre, hierro y oro.', place: 'station' },
  telar: { name: 'Telar', desc: 'Estación: teje fibra en tela.', place: 'station' },
  cocina: { name: 'Cocina', desc: 'Estación: platos que dan mucha más energía.', place: 'station' },
  silla: { name: 'Silla', desc: 'Para sentarse a admirar lo talado.', place: 'furniture' },
  mesa: { name: 'Mesa', desc: 'Una mesa robusta de tablas.', place: 'furniture' },
  alfombra: { name: 'Alfombra', desc: 'Da un toque hogareño a cualquier rincón.', place: 'flat' },
  cama: { name: 'Cama', desc: 'Para dormir en tu propia casa, donde la construyas.', place: 'furniture' },
  estanteria: { name: 'Estantería', desc: 'Llena de libros que nadie ha leído.', place: 'furniture' },
  maceta: { name: 'Maceta', desc: 'Flores que no hay que regar. Bueno, un poco.', place: 'furniture' },
  lampara: { name: 'Lámpara', desc: 'Da luz de noche.', place: 'furniture' },
  antorcha: { name: 'Antorcha', desc: 'Luz barata para la noche, las cuevas y los sustos.', place: 'furniture' },
  cofre: { name: 'Cofre', desc: 'Guarda 18 montones de cosas. Ábrelo con E.', place: 'furniture' },
};
// ---------- Huerto, animales y pesca (fase 6) ----------
// Cultivos: estaciones en las que crecen (0 primavera … 3 invierno), días hasta cosechar y si vuelven a dar fruto
export const CROPS = {
  nabo: { name: 'Nabo', seasons: [0], days: 4, color: '#f0e8f0', leaf: '#5aa842', food: 12, price: 35 },
  fresa: { name: 'Fresa', seasons: [0], days: 6, regrow: 3, color: '#e83a4a', leaf: '#4a9a3a', food: 10, price: 40 },
  zanahoria: { name: 'Zanahoria', seasons: [0, 2], days: 5, color: '#f08a2a', leaf: '#6ab84a', food: 14, price: 40 },
  tomate: { name: 'Tomate', seasons: [1], days: 7, regrow: 3, color: '#e04a2a', leaf: '#3f8a32', food: 14, price: 45 },
  maiz: { name: 'Maíz', seasons: [1, 2], days: 8, regrow: 3, color: '#f0d040', leaf: '#5a9a3a', food: 12, price: 50 },
  trigo: { name: 'Trigo', seasons: [1, 2], days: 4, color: '#e0b850', leaf: '#a8a040', price: 25 },
  calabaza: { name: 'Calabaza', seasons: [2], days: 9, color: '#e8822a', leaf: '#4a8a3a', food: 20, price: 120 },
};
const SEASON_NAMES = ['primavera', 'verano', 'otoño', 'invierno'];
for (const [id, c] of Object.entries(CROPS)) {
  ITEMS['semilla_' + id] = { name: `Semillas de ${c.name.toLowerCase()}`, desc: `Siémbralas en tierra labrada y riégalas. Crecen en ${c.seasons.map(s => SEASON_NAMES[s]).join(' y ')} (${c.days} días).`, seed: id };
  ITEMS[id] = { name: c.name, desc: c.food ? 'Recién cogido del huerto.' : 'Para hacer harina y pan.', food: c.food };
}
Object.assign(ITEMS, {
  semilla_manzano: { name: 'Semilla de manzano', desc: 'Plántala en la hierba: en unos días tendrás un manzano que da manzanas.', sapling: 'fruit' },
  regadera: { name: 'Regadera', desc: 'Riega la tierra labrada. Se llena en cualquier agua.', tool: 'regadera', tier: 1, stack: 1 },
  cana: { name: 'Caña de pescar', desc: 'Úsala mirando al agua y pulsa otra vez cuando pique.', tool: 'cana', tier: 1, stack: 1 },
  abono: { name: 'Abono', desc: 'Úsalo en un cultivo: crecerá más deprisa.' },
  aspersor: { name: 'Aspersor', desc: 'Riega solo cada mañana las 8 casillas de alrededor.', place: 'furniture' },
  gallinero: { name: 'Gallinero', desc: 'Casa para hasta 4 gallinas.', place: 'furniture' },
  establo: { name: 'Establo', desc: 'Casa para hasta 4 vacas u ovejas.', place: 'furniture' },
  colmena: { name: 'Colmena', desc: 'Las abejas hacen miel cada pocos días (menos en invierno).', place: 'furniture' },
  comedero: { name: 'Comedero', desc: 'Pon dentro fibra o trigo: tus animales comen de él cada mañana.', place: 'furniture' },
  huevo: { name: 'Huevo', desc: 'Fresco del gallinero.', food: 8 },
  leche: { name: 'Leche', desc: 'De vaca contenta.', food: 10 },
  lana: { name: 'Lana', desc: 'Suave. En el telar se convierte en tela.' },
  miel: { name: 'Miel', desc: 'Dulce y pegajosa.', food: 15 },
  tortilla: { name: 'Tortilla', desc: 'Con o sin cebolla: el eterno debate.', food: 40 },
  queso: { name: 'Queso', desc: 'Curado en tu propia cocina.', food: 35 },
  pan: { name: 'Pan', desc: 'Recién hecho.', food: 30 },
  tarta_calabaza: { name: 'Tarta de calabaza', desc: 'Da energía y te hace ir más rápido un rato.', food: 60, buff: ['rapido', 120] },
  sopa_verduras: { name: 'Sopa de verduras', desc: 'Durante un rato, trabajar no cansa.', food: 55, buff: ['incansable', 120] },
  pescado_asado: { name: 'Pescado asado', desc: 'Con un chorrito de limón imaginario.', food: 30 },
  mermelada_fresa: { name: 'Mermelada de fresa', desc: 'Para untar en pan.', food: 40 },
  palomitas: { name: 'Palomitas', desc: 'Pop.', food: 20 },
  tostada_miel: { name: 'Tostada con miel', desc: 'Desayuno de campeones: da energía y velocidad.', food: 45, buff: ['rapido', 90] },
});
// Peces: dónde viven, cuándo (estaciones y horas) y cuánto cuesta pescarlos (lo rápido que hay que ser)
export const FISH = {
  carpa: { name: 'Carpa', water: ['lago', 'estanque', 'pantano'], color: '#b8904a', size: 5 },
  perca: { name: 'Perca', water: ['lago', 'estanque', 'rio'], color: '#7a9a4a', size: 4 },
  trucha: { name: 'Trucha', water: ['rio', 'lago'], seasons: [0, 2, 3], color: '#a88aa0', size: 5 },
  salmon: { name: 'Salmón', water: ['rio'], seasons: [2], color: '#e0806a', size: 6 },
  lucio: { name: 'Lucio', water: ['lago'], hours: [15, 22], color: '#5a7a4a', size: 7 },
  anguila: { name: 'Anguila', water: ['pantano', 'rio'], hours: [19, 5], color: '#4a5a4a', size: 7, thin: true },
  sardina: { name: 'Sardina', water: ['mar'], color: '#a8c0d8', size: 3 },
  lubina: { name: 'Lubina', water: ['mar'], color: '#8aa0b0', size: 6 },
  pez_globo: { name: 'Pez globo', water: ['mar'], seasons: [1], color: '#e8d080', size: 4, round: true },
  cangrejo: { name: 'Cangrejo', water: ['mar'], color: '#d8502a', size: 4, crab: true },
  pez_hielo: { name: 'Pez de hielo', water: ['hielo'], color: '#c8e8f8', size: 4 },
  pez_dorado: { name: 'Pez dorado', water: ['lago', 'rio', 'mar', 'estanque'], rare: true, color: '#f8c030', size: 5 },
};
// ---------- Exploración (fase 8) ----------
Object.assign(ITEMS, {
  amatista: { name: 'Amatista', desc: 'Gema morada de las cuevas (desde el nivel 3).', gem: true },
  esmeralda: { name: 'Esmeralda', desc: 'Gema verde de las cuevas profundas (nivel 5).', gem: true },
  rubi: { name: 'Rubí', desc: 'Gema roja, muy valiosa (nivel 7).', gem: true },
  diamante: { name: 'Diamante', desc: 'Lo más valioso de las cuevas (nivel 9 o más).', gem: true },
  fosil_concha: { name: 'Fósil de concha', desc: 'Un caracol de hace millones de años.', fossil: true },
  fosil_hueso: { name: 'Fósil de hueso', desc: 'Parte de algo muy grande y muy antiguo.', fossil: true },
  fosil_ambar: { name: 'Ámbar', desc: 'Con un mosquito dentro. No lo despiertes.', fossil: true },
  moneda_antigua: { name: 'Moneda antigua', desc: 'De un reino que ya nadie recuerda.', relic: true },
  calavera: { name: 'Calavera de esqueleto', desc: 'Sonríe todo el rato. Da un poco de mal rollo.' },
  baba: { name: 'Baba de limo', desc: 'Pegajosa. A alguien le servirá.' },
  pocion: { name: 'Poción de vida', desc: 'Cura 6 corazones.', heal: 12 },
  espada: { name: 'Espada', desc: 'Para defenderte en cuevas y mazmorras. Úsala con el clic izquierdo.', weapon: 3, stack: 1 },
  espada_oro: { name: 'Espada de oro', desc: 'Pega el doble de fuerte.', weapon: 6, stack: 1 },
  barca: { name: 'Barca', desc: 'Úsala mirando al agua para navegar por ríos, lagos y el mar.', vehicle: 'barca', stack: 1 },
  caballo: { name: 'Silbato del caballo', desc: 'Úsalo para montar (o bajar) de tu caballo: vas mucho más rápido.', vehicle: 'caballo', stack: 1 },
  brujula: { name: 'Brújula del confín', desc: 'Su aguja no apunta al norte: apunta a algún sitio muy lejano.', stack: 1 },
});
// ---------- Insectos (fase 9): se cazan con la red ----------
export const BUGS = {
  mariposa: { name: 'Mariposa', seasons: [0, 1], hours: [7, 19], col: '#ffe04a' },
  mariquita: { name: 'Mariquita', seasons: [0, 1], hours: [8, 18], col: '#e83a3a' },
  saltamontes: { name: 'Saltamontes', seasons: [1, 2], hours: [8, 19], col: '#6ab84a' },
  libelula: { name: 'Libélula', seasons: [0, 1], hours: [9, 18], col: '#4ab8e8', water: true },
  luciernaga: { name: 'Luciérnaga', seasons: [0, 1], hours: [20, 4], col: '#e8f878' },
  escarabajo: { name: 'Escarabajo', seasons: [0, 1, 2], hours: [0, 24], col: '#3a5a8a', forest: true },
  grillo: { name: 'Grillo', seasons: [2], hours: [18, 2], col: '#6a4a2a' },
  polilla: { name: 'Polilla', seasons: [1, 2, 3], hours: [20, 5], col: '#c8b898' },
};
for (const [id, b] of Object.entries(BUGS)) ITEMS[id] = { name: b.name, desc: 'Un insecto para el museo del pueblo.', bug: true };
ITEMS.red = { name: 'Red de insectos', desc: 'Úsala en la hierba o junto al agua para cazar insectos.', tool: 'red', tier: 1, stack: 1 };
ITEMS.vitrina = { name: 'Vitrina', desc: 'Para lucir tus colecciones en casa.', place: 'furniture' };

for (const [id, f] of Object.entries(FISH)) ITEMS[id] = { name: f.name, desc: f.rare ? '¡Rarísimo! Dicen que da suerte.' : 'Un pez. Se puede asar en la cocina o vender.', food: 6, fish: true };

for (const [tool, def] of Object.entries(TOOLS)) {
  for (const tier of [1, 2, 3, 4, 5]) {
    ITEMS[toolId(tool, tier)] = { name: `${def.name} ${TIERS[tier].name}`, desc: def.desc, tool, tier, stack: 1 };
  }
}
for (const it of Object.values(ITEMS)) it.stack ??= it.place ? 10 : 99;

// Qué herramienta hace falta, cuántos golpes con una de madera, qué cae
// ([id, mínimo, máximo, probabilidad, nivel mínimo de herramienta]) y qué astillas salta al golpear.
// `hand`: golpes a mano (si se puede). `minTier`: nivel de herramienta necesario para poder trabajarlo.
// Nada de esto vuelve a crecer: lo que se tala, pica o siega desaparece para siempre.
const TREE = { tool: 'hacha', hits: 4, chips: 'wood', verb: 'Talar' };
export const HARVEST = {
  oak: { ...TREE, drops: [['madera', 3, 5], ['bellota', 1, 1, 0.3]] },
  fruit: { ...TREE, drops: [['madera', 3, 4], ['manzana', 2, 3]] },
  pine: { ...TREE, drops: [['madera', 3, 5], ['pina', 1, 1, 0.3]] },
  snowPine: { ...TREE, drops: [['madera', 3, 5], ['pina', 1, 1, 0.3]] },
  palm: { ...TREE, hits: 3, drops: [['madera', 2, 3], ['coco', 1, 1, 0.5]] },
  swampTree: { ...TREE, drops: [['madera', 3, 4], ['fibra', 1, 2, 0.4]] },
  cactus: { tool: 'hacha', hits: 2, chips: 'cactus', verb: 'Cortar', drops: [['pulpa', 1, 2], ['fibra', 1, 1, 0.5]] },
  bush: { tool: 'guadana', hand: 2, hits: 1, chips: 'leaf', verb: 'Segar', drops: [['fibra', 1, 2], ['bayas', 1, 2, 0.5], ['semillas', 1, 2, 0.3]] },
  deadBush: { tool: 'guadana', hand: 1, hits: 1, chips: 'twig', verb: 'Segar', drops: [['madera', 1, 1], ['fibra', 1, 2]] },
  rock: { tool: 'pico', hits: 2, chips: 'stone', verb: 'Picar', drops: [['piedra', 2, 3], ['carbon', 1, 1, 0.2], ['cobre', 1, 1, 0.15, 2]] },
  boulder: { tool: 'pico', minTier: 2, hits: 6, chips: 'stone', verb: 'Picar', drops: [['piedra', 5, 7], ['carbon', 1, 2, 0.4], ['cobre', 1, 3, 0.6, 2], ['hierro', 1, 2, 0.45, 3], ['oro', 1, 2, 0.3, 4]] },
  snowBoulder: { tool: 'pico', minTier: 2, hits: 6, chips: 'stone', verb: 'Picar', drops: [['piedra', 4, 6], ['carbon', 1, 1, 0.3], ['hierro', 1, 3, 0.55, 3], ['oro', 1, 2, 0.35, 4]] },
};

// Vetas de las cuevas: necesitan un pico de cierto nivel
const VEIN = (ore, minTier, hits, drops) => ({ tool: 'pico', minTier, hits, chips: 'stone', verb: 'Picar', drops });
Object.assign(HARVEST, {
  veta_piedra: VEIN('piedra', 1, 2, [['piedra', 2, 4], ['carbon', 1, 1, 0.3]]),
  veta_cobre: VEIN('cobre', 1, 3, [['cobre', 1, 3], ['piedra', 1, 2]]),
  veta_hierro: VEIN('hierro', 2, 4, [['hierro', 1, 3], ['piedra', 1, 1]]),
  veta_oro: VEIN('oro', 3, 5, [['oro', 1, 2]]),
  veta_amatista: VEIN('amatista', 2, 4, [['amatista', 1, 1], ['piedra', 1, 1]]),
  veta_esmeralda: VEIN('esmeralda', 3, 5, [['esmeralda', 1, 1]]),
  veta_rubi: VEIN('rubi', 3, 6, [['rubi', 1, 1]]),
  veta_diamante: VEIN('diamante', 4, 7, [['diamante', 1, 1]]),
  veta_fosil: VEIN('fosil', 2, 3, [['fosil_concha', 1, 1, 0.5], ['fosil_hueso', 1, 1, 0.35], ['fosil_ambar', 1, 1, 0.2], ['piedra', 1, 2]]),
});

export const ENERGY_MAX = 100;
export const TOOL_COST = { hacha: 2, pico: 2, guadana: 1, azada: 2, mano: 1, regadera: 1, cana: 1, red: 1 };
export const START_KIT = [['hacha', 1], ['pico', 1], ['guadana', 1], ['azada', 1], ['manzana', 3]];

// Golpes que necesita una herramienta de cierto nivel
export const hitsFor = (rule, tier) => Math.max(1, Math.ceil(rule.hits / TIERS[tier].power));
