// Objetos (herramientas, materiales, comida y cosas que se colocan) y qué da cada cosa del mundo al recolectarla.
import { defineNames, has, noun, t, fmt, getLang } from './i18n.js';
import { GARMENTS, TEAR, tearMul } from './clothing.js';
import { apagada } from './opciones.js';
import { seedOf } from './cropdata.js';

// Las herramientas son todas de hierro (hacha, pico, guadaña, azada y pala). tier: el nivel, que además usan la caña y la red
export const TIERS = {
  4: { name: 'de hierro', head: '#b8c2ce', power: 3, dur: 250 },   // (dur: los usos que aguanta antes de romperse)
};
const TOOLS = {
  hacha: { name: 'Hacha', desc: 'Tala árboles y corta cactus.' },
  pico: { name: 'Pico', desc: 'Pica rocas, peñascos y vetas.' },
  guadana: { name: 'Guadaña', desc: 'Siega arbustos y matojos de un tajo.' },
  azada: { name: 'Azada', desc: 'Labra la tierra para sembrar.' },
  pala: { name: 'Pala', desc: 'Cava un bloque de tierra donde apuntes y se lo queda; el siguiente clic lo suelta donde quieras (rellena un hoyo o hace un montón).' },
};

export const ITEMS = {
  madera: { name: 'Madera', desc: 'Troncos para construir y fabricar.' },
  piedra: { name: 'Piedra', desc: 'Para construir, y para hacer hornos.' },
  fibra: { name: 'Fibra', desc: 'Hebras vegetales para cuerdas y telas.' },
  carbon: { name: 'Carbón', desc: 'Combustible para el horno. También se hace quemando madera en el horno.' },
  cobre: { name: 'Mineral de cobre', desc: 'Sale de rocas y peñascos. En el horno se funde.' },
  hierro: { name: 'Mineral de hierro', desc: 'Sale de los peñascos. En el horno se funde.' },
  oro: { name: 'Mineral de oro', desc: 'Sale de algunos peñascos. En el horno se funde.' },
  bellota: { name: 'Bellota', desc: 'Semilla de roble: plántala en la hierba y en unos días tendrás un árbol.', sapling: 'oak' },
  pina: { name: 'Piña', desc: 'Semilla de pino: se planta en la hierba. Tostada, sus piñones están ricos.', sapling: 'pine' },
  tablas: { name: 'Tablas', desc: 'Madera cortada, lista para fabricar.' },
  cuerda: { name: 'Cuerda', desc: 'Fibra trenzada. Sujeta las cabezas de las herramientas.' },
  tela: { name: 'Tela', desc: 'Tejida en el telar con fibra.' },
  lingote_cobre: { name: 'Lingote de cobre', desc: 'Para el yunque, la cocina y la armadura de cobre.' },
  lingote_hierro: { name: 'Lingote de hierro', desc: 'Para las herramientas y la armadura de hierro, en el yunque.' },
  lingote_oro: { name: 'Lingote de oro', desc: 'Para la espada y la armadura de oro.' },
  // Comida (food: lo que alimenta; hungerOf lo pasa a medios muslos de hambre)
  coco: { name: 'Coco', desc: 'Se cogen de las palmeras con E (vuelven a salir a los 3 días) o talándolas. Cuesta abrirlo, pero merece la pena.', food: 12, thirst: 8 },   // (thirst: on a beach or an island all the water is salt, and palms keep you alive)
  manzana: { name: 'Manzana', desc: 'Crujiente y dulce.', food: 15 },
  bayas: { name: 'Bayas', desc: 'Un puñado de bayas silvestres.', food: 8 },
  pulpa: { name: 'Pulpa de cactus', desc: 'Jugosa, aunque pincha un poco.', food: 10, thirst: 4 },
  manzana_asada: { name: 'Manzana asada', desc: 'Caliente y con canela imaginaria.', food: 30 },
  mermelada: { name: 'Mermelada de bayas', desc: 'Un tarro entero. No preguntes de dónde ha salido el tarro.', food: 35 },
  coco_tostado: { name: 'Coco tostado', desc: 'Huele a playa.', food: 28 },
  pinones: { name: 'Piñones tostados', desc: 'Pequeños pero llenan.', food: 18 },
  pan_bellota: { name: 'Pan de bellota', desc: 'Denso, rústico y muy de pueblo.', food: 25 },
  estofado: { name: 'Estofado de cactus', desc: 'La especialidad del desierto. Quita el hambre para rato.', food: 50, thirst: 2 },
  // Cosas que se colocan en el mundo (place: estación de trabajo, mueble o algo plano en el suelo)
  banco: { name: 'Banco de carpintero', desc: 'Estación: muebles y otras estaciones.', place: 'station' },
  cantero: { name: 'Mesa de cantero', desc: 'Estación: con ella cerca se construye lo de piedra (suelos, muros, muretes, caminos, el hogar y el horno).', place: 'station' },
  horno: { name: 'Horno', desc: 'Estación: funde minerales en lingotes y hace carbón.', place: 'station' },
  yunque: { name: 'Yunque', desc: 'Estación: herramientas de hierro, armaduras y espadas.', place: 'station' },
  telar: { name: 'Telar', desc: 'Estación: teje fibra en tela.', place: 'station' },
  cocina: { name: 'Cocina', desc: 'Estación: platos que quitan mucha más hambre.', place: 'station' },
  silla: { name: 'Silla', desc: 'Para sentarse a admirar lo talado. Mirando a una mesa, se mete debajo.', place: 'furniture' },
  mesa: { name: 'Mesa', desc: 'Una mesa robusta de tablas. Las sillas que la miran se meten debajo.', place: 'furniture' },
  mesa_grande: { name: 'Mesa grande', desc: 'De comedor, para toda la familia. Al ponerla, V cambia el tamaño: 2×1, 2×2, 3×1 o 3×2 (y R la gira). Las sillas que la miran se meten debajo.', place: 'furniture' },
  alfombra: { name: 'Alfombra', desc: 'Da un toque hogareño a cualquier rincón. En el telar se teje de cinco tamaños (de 1×1 a 3×4; cuanto más grande, más cuesta); los muebles van encima.', place: 'rug' },
  alfombra_persa: { name: 'Alfombra persa', desc: 'Azul, con un medallón rojo en el centro y cenefa. En el telar se teje de cinco tamaños (de 1×1 a 3×4).', place: 'rug' },
  alfombra_rayas: { name: 'Alfombra de rayas', desc: 'Tejida a franjas de colores, con flecos. En el telar se teje de cinco tamaños (de 1×1 a 3×4).', place: 'rug' },
  alfombra_rombos: { name: 'Alfombra de rombos', desc: 'Lana cruda con rombos verdes y rojos. En el telar se teje de cinco tamaños (de 1×1 a 3×4).', place: 'rug' },
  alfombra_trenzada: { name: 'Alfombra trenzada', desc: 'Ovalada, de trenzas de tela en espiral. En el telar se teje de cinco tamaños (de 1×1 a 3×4).', place: 'rug' },
  cama: { name: 'Cama', desc: 'Para dormir en tu propia casa, donde la construyas.', place: 'furniture' },
  estanteria: { name: 'Estantería', desc: 'Llena de libros que nadie ha leído.', place: 'furniture' },
  maceta: { name: 'Maceta', desc: 'Flores que no hay que regar. Bueno, un poco.', place: 'furniture' },
  lampara: { name: 'Lámpara', desc: 'Da luz de noche.', place: 'furniture' },
  candelabro: { name: 'Candelabro de techo', desc: 'Seis velas en un aro de hierro: se cuelga del techo (solo bajo techo) y se apaga y enciende con E.', place: 'flat' },
  vela: { name: 'Vela', desc: 'Una luz pequeña para la mesa o la mesilla. Se apaga y se enciende con E.', place: 'furniture' },
  antorcha: { name: 'Antorcha', desc: 'Luz barata para la noche, las cuevas y los sustos.', place: 'furniture' },
  cofre: { name: 'Cofre', desc: 'Guarda 18 montones de cosas. Ábrelo con E.', place: 'furniture' },
};
// ---------- Huerto, animales y pesca (fase 6) ----------
// Crops. seasons: when they do well in the village (0 spring … 3 winter): what Rosa sells and the seeds say; whether they
// grow or die is the weather's (cropdata.js, fieldclimate.js). days: days of good weather to ripen; regrow: to give again
export const CROPS = {
  nabo: { name: 'Nabo', seasons: [0, 2], days: 4, color: '#f0e8f0', leaf: '#5aa842', food: 12, price: 35 },
  fresa: { name: 'Fresa', seasons: [0], glass: [3], days: 6, regrow: 3, color: '#e83a4a', leaf: '#4a9a3a', food: 10, price: 40 },
  zanahoria: { name: 'Zanahoria', seasons: [0, 2], days: 5, color: '#f08a2a', leaf: '#6ab84a', food: 14, price: 40 },
  tomate: { name: 'Tomate', seasons: [1], days: 7, regrow: 3, color: '#e04a2a', leaf: '#3f8a32', food: 14, price: 45 },
  maiz: { name: 'Maíz', seasons: [1], days: 8, color: '#f0d040', leaf: '#5a9a3a', food: 12, price: 50 },
  trigo: { name: 'Trigo', seasons: [0, 1, 2], glass: [3], days: 4, color: '#e0b850', leaf: '#a8a040', price: 25 },
  calabaza: { name: 'Calabaza', seasons: [1], days: 9, color: '#e8822a', leaf: '#4a8a3a', food: 20, price: 120 },
  // (their names and texts, in the language files; the ids are English from here on: cropdata.js seedOf. seed: what Rosa asks
  // for one, if not half the price of what it gives: a cabbage is one head from a seed as small as a pinhead)
  potato: { seasons: [0, 1], days: 6, color: '#c4a060', leaf: '#4c7a38', food: 5, price: 25 },
  broad_bean: { seasons: [2, 3, 0], days: 6, color: '#86ac48', leaf: '#6a8f62', food: 8, price: 30 },
  cabbage: { seasons: [0, 2, 3], days: 7, color: '#a8c47c', leaf: '#5e8a66', food: 14, price: 45, seed: 15 },
  garlic: { seasons: [2, 3], days: 8, color: '#ebe4d8', leaf: '#86a45a', food: 3, price: 35 },
};
const SEASON_NAMES = ['primavera', 'verano', 'otoño', 'invierno'];
for (const [id, c] of Object.entries(CROPS)) {
  if (!c.name) {
    const seed = { seed: id }, crop = { food: c.food };
    Object.assign(ITEMS, defineNames({ [seedOf(id)]: seed }, 'item', ['name']), defineNames({ [id]: crop }, 'item'));
    Object.defineProperty(seed, 'desc', { get: () => t('item.seed.desc', { seasons: fmt.list(c.seasons.map(s => t('nature.season.' + s))), days: c.days }), enumerable: true });
    continue;
  }
  ITEMS[seedOf(id)] = { name: `Semillas de ${c.name.toLowerCase()}`, desc: `Siémbralas en tierra labrada y riégalas. Crecen en ${c.seasons.map(s => SEASON_NAMES[s]).join(', ').replace(/, (?=[^,]*$)/, ' y ')} (${c.days} días).`, seed: id };
  if (c.glass) { const seed = ITEMS[seedOf(id)], d = seed.desc; Object.defineProperty(seed, 'desc', { get: () => `${d} ${t('item.seed.glass', { seasons: fmt.list(c.glass.map(s => t('nature.season.' + s))) })}`, enumerable: true }); }
  ITEMS[id] = { name: c.name, desc: c.food ? 'Recién cogido del huerto.' : 'Para hacer harina y pan.', food: c.food };
}
Object.assign(ITEMS, {
  semilla_manzano: { name: 'Semilla de manzano', desc: 'Plántala en la hierba: en unos días tendrás un manzano que da manzanas.', sapling: 'fruit' },
  regadera: { name: 'Regadera', desc: 'Riega la tierra labrada. Se llena en cualquier agua.', tool: 'regadera', tier: 1, stack: 1 },
  cana: { name: 'Caña de pescar', desc: 'Apunta al agua y haz clic para lanzar. Mira el corcho: cuando el pez se lo lleve, clic otra vez.', tool: 'cana', tier: 1, stack: 1, dur: 80 },
  cana_fibra: { name: 'Caña de fibra', desc: 'Más ligera y sensible: los peces pican antes y da algo más de tiempo.', tool: 'cana', tier: 2, stack: 1, dur: 160 },
  abono: {},   // (its name and text: GARDEN_ITEMS, below)
  aspersor: { name: 'Aspersor', desc: 'Riega solo cada mañana las 8 casillas de alrededor.', place: 'furniture' },
  gallinero: { name: 'Gallinero', desc: 'Casa grande para hasta 4 gallinas o patos. Con E: la puerta y asignarle animales. Con la puerta cerrada, se quedan dentro.', place: 'furniture' },
  establo: { name: 'Establo', desc: 'Casa grande para hasta 4 vacas, ovejas, cabras o cerdos. Con E: la puerta y asignarle animales. Con la puerta cerrada, se quedan dentro.', place: 'furniture' },
  colmena: { name: 'Colmena', desc: 'Las abejas hacen miel cada pocos días (menos en invierno).', place: 'furniture' },
  comedero: { name: 'Comedero', desc: '', place: 'furniture' },   // (its text: below, from the language files)
  huevo: { name: 'Huevo', desc: 'Fresco del gallinero.', food: 8 },
  leche: { name: 'Leche', desc: 'De vaca contenta.', food: 10, drink: true, thirst: 6 },
  lana: { name: 'Lana', desc: 'Suave. En el telar se convierte en tela.' },
  miel: { name: 'Miel', desc: 'Dulce y pegajosa.', food: 15 },
  tortilla: { name: 'Tortilla', desc: 'Con o sin cebolla: el eterno debate.', food: 40 },
  queso: { name: 'Queso', desc: 'Curado en tu propia cocina.', food: 35 },
  pan: { name: 'Pan', desc: 'Recién hecho.', food: 30 },
  tarta_calabaza: { name: 'Tarta de calabaza', desc: 'Quita el hambre y te hace ir más rápido un rato.', food: 60, buff: ['rapido', 120] },
  sopa_verduras: { name: 'Sopa de verduras', desc: 'Durante un rato, trabajar no cansa.', food: 55, thirst: 6, buff: ['incansable', 120] },
  pescado_asado: { name: 'Pescado asado', desc: 'Con un chorrito de limón imaginario.', food: 30 },
  mermelada_fresa: { name: 'Mermelada de fresa', desc: 'Para untar en pan.', food: 40 },
  palomitas: { name: 'Palomitas', desc: 'Pop.', food: 20 },
  tostada_miel: { name: 'Tostada con miel', desc: 'Desayuno de campeones: quita el hambre y da velocidad.', food: 45, buff: ['rapido', 90] },
});
// (the dishes of the winter crops: their names and texts, in the language files)
const WINTER_DISHES = { baked_potato: { food: 25 }, potato_omelette: { food: 60 }, garlic_soup: { food: 45, thirst: 6 }, bean_stew: { food: 75, thirst: 4, buff: ['incansable', 180] } };
Object.assign(ITEMS, WINTER_DISHES);
defineNames(WINTER_DISHES, 'item');
// ---------- El arco (archery.js) ----------
Object.assign(ITEMS, {
  arco: { name: 'Arco', desc: 'Mantén pulsado para tensar y suelta para disparar: cuanto más tenso, más lejos llega y más daña.', bow: true, stack: 1, dur: 200 },
  flecha: { name: 'Flecha', desc: 'Vuela en parábola y se clava. Se recoge del suelo con solo pasar por encima.' },
});
// ---------- La taberna ----------
Object.assign(ITEMS, {
  barra: { name: 'Barra de taberna', desc: 'Madera recia y una jarra siempre a mano. Se une a la de al lado.', place: 'furniture' },
  barril: { name: 'Barril', desc: 'De roble, con su espita.', place: 'furniture' },
  taburete: { name: 'Taburete', desc: 'Alto, para la barra. Siéntate con E.', place: 'furniture' },
  sidra: { name: 'Vaso de sidra', desc: 'De las manzanas del pueblo: fresca y ácida.', food: 10, drink: true, thirst: 6 },
  cerveza: { name: 'Jarra de cerveza', desc: 'Con su espuma. Anselmo dice que la receta es de su abuela.', food: 12, drink: true, thirst: 6 },
  hidromiel: { name: 'Hidromiel', desc: 'Miel fermentada: dulce y traicionera. Un rato de alegría en las piernas.', food: 14, drink: true, thirst: 4, buff: ['rapido', 60] },
});
// ---------- Lo que dan los animales al matarlos (hunt.js) ----------
Object.assign(ITEMS, {
  carne_ave: { name: 'Carne de ave', desc: 'De gallina, de pato o de cisne. Cruda alimenta poco: ásala en la cocina.', food: 8 },
  carne_conejo: { name: 'Carne de conejo', desc: 'Magra y tierna. Cruda alimenta poco: ásala en la cocina.', food: 8 },
  carne_vaca: { name: 'Carne de vaca', desc: 'Un buen trozo. Cruda alimenta poco: ásala en la cocina.', food: 10 },
  carne_cordero: { name: 'Carne de cordero', desc: 'De oveja. Cruda alimenta poco: ásala en la cocina.', food: 10 },
  carne_cabra: { name: 'Carne de cabra', desc: 'Sabor fuerte. Cruda alimenta poco: ásala en la cocina.', food: 10 },
  carne_cerdo: { name: 'Carne de cerdo', desc: 'Con su veta de grasa. Cruda alimenta poco: ásala en la cocina.', food: 10 },
  carne_venado: { name: 'Carne de venado', desc: 'Caza del bosque y del prado. Cruda alimenta poco: ásala en la cocina.', food: 10 },
  carne_jabali: { name: 'Carne de jabalí', desc: 'Caza del bosque. Cruda alimenta poco: ásala en la cocina.', food: 10 },
  pollo_asado: { name: 'Muslo asado', desc: 'Dorado por fuera y jugoso por dentro.', food: 30 },
  conejo_asado: { name: 'Conejo asado', desc: 'Con hierbas del monte imaginarias.', food: 28 },
  filete: { name: 'Filete', desc: 'A la brasa, en su punto.', food: 40 },
  cordero_asado: { name: 'Cordero asado', desc: 'Se deshace solo.', food: 36 },
  cabra_asada: { name: 'Cabra asada', desc: 'Curtida, pero con mucho sabor.', food: 34 },
  chuleta: { name: 'Chuleta de cerdo', desc: 'Con la grasita crujiente.', food: 36 },
  venado_asado: { name: 'Venado asado', desc: 'Plato de cazador: llena para rato.', food: 40 },
  jabali_asado: { name: 'Jabalí asado', desc: 'Plato de cazador: llena para rato.', food: 40 },
  piel: { name: 'Piel', desc: 'De un animal. En el telar, dos pieles se curten en cuero.' },
  cuero: { name: 'Cuero', desc: 'Piel curtida: para botas, alforjas y sillones.' },
  hueso: { name: 'Hueso', desc: 'En el banco se muele en abono.' },
  // Flores silvestres (se cogen en la pradera; ver gen.js): para regalar, vender o la colección del diario
  margarita: { name: 'Margarita', desc: 'Blanca, de botón amarillo. Sale en manchas por la pradera, de la primavera al otoño.', flower: true },
  diente_leon: { name: 'Diente de león', desc: 'Amarillo; al madurar se vuelve una bola de vilanos que se lleva el viento.', flower: true },
  manteca: { name: 'Manteca', desc: 'Grasa de cerdo. En el banco se hacen velas con ella.' },
  asta: { name: 'Asta de ciervo', desc: 'Un trofeo: se vende bien.' },
  colmillo: { name: 'Colmillo de jabalí', desc: 'Un trofeo: se vende bien.' },
});
// ---------- Granja, segunda parte: más animales, crías, heno, quesería, caballos y mascotas ----------
Object.assign(ITEMS, {
  huevo_pato: { name: 'Huevo de pato', desc: 'Más grande que el de gallina, y con más sabor.', food: 10 },
  huevo_oro: { name: 'Huevo de oro', desc: 'Solo lo pone un ave muy, muy feliz. Vale una fortuna.' },
  plumas: { name: 'Plumas', desc: 'De pato: suaves y calentitas.' },
  leche_cabra: { name: 'Leche de cabra', desc: 'Para hacer queso de cabra en la quesera.', food: 10, drink: true, thirst: 6 },
  nata: { name: 'Nata', desc: 'La da una vaca o una cabra muy contenta. En la quesera se bate en mantequilla.', food: 12 },
  mantequilla: { name: 'Mantequilla', desc: 'Para untar, o para cocinar platos más ricos.', food: 20 },
  queso_cabra: { name: 'Queso de cabra', desc: 'Curado en la quesera: fuerte y cremoso.', food: 40 },
  lana_fina: { name: 'Lana fina', desc: 'De una oveja o un conejo muy cuidados: se vende muy bien.' },
  angora: { name: 'Pelo de angora', desc: 'Del conejo. En el telar se hace fieltro.' },
  fieltro: { name: 'Fieltro', desc: 'Tela gruesa de angora: abriga mucho.' },
  trufa: { name: 'Trufa', desc: 'La encuentran los cerdos hozando al aire libre. Muy cara.', food: 15 },
  heno: { name: 'Heno', desc: 'Hierba seca. Con un silo, al segar se guarda sola; los animales lo comen cuando no pueden pastar.' },
  cepillo: { name: 'Cepillo', desc: 'Para cepillar a tu caballo cada día: le gusta mucho.' },
  herraduras: { name: 'Herraduras', desc: 'Pónselas a tu caballo: corre más.' },
  alforjas: { name: 'Alforjas', desc: 'Bolsas para el caballo: llevan 9 montones de cosas.' },
  pelota: { name: 'Pelota', desc: 'Lánzala y tu perro te la traerá.', stack: 1 },
  silo: { name: 'Silo', desc: 'Guarda el heno que siegas (hasta 240). Los animales comen de él cuando no pueden pastar.', place: 'furniture' },
  cuadra: { name: 'Cuadra', desc: 'Casa para hasta 2 caballos.', place: 'furniture' },
  conejera: { name: 'Conejera', desc: 'Casa para hasta 4 conejos.', place: 'furniture' },
  caseta: { name: 'Caseta del perro', desc: 'Donde duerme tu perro.', place: 'furniture' },
  cojin: { name: 'Cojín del gato', desc: 'Donde duerme tu gato (cuando no duerme en tu cama).', place: 'furniture' },
  palomar: { name: 'Palomar', desc: 'Envía con una paloma lo que llevas en la mano a otra persona, aunque no esté jugando.', place: 'furniture' },
  incubadora: { name: 'Incubadora', desc: 'Pon un huevo de gallina o de pato: en 4 días sale un polluelo.', place: 'furniture' },
  quesera: { name: 'Quesera', desc: 'Estación: quesos, queso de cabra y mantequilla.', place: 'station' },
  alambique: { name: 'Alambique', desc: 'Estación: destila pociones con carbón, frascos y un ingrediente (miel, bayas, calavera, plumas o amatista).', place: 'station' },
  noria: { name: 'Noria', desc: 'Se pone en un río, cerca de la orilla, y gira con el agua: muele el trigo en harina y cada mañana riega sola la tierra labrada de alrededor (hasta 4 casillas a cada lado).', place: 'station' },
  pozo: { name: 'Pozo', desc: 'Agua para siempre: con la regadera, E o clic en él la llena. Se construye en un hoyo de 5 bloques cavado con la pala, con la mesa de cantero cerca; al desmontarlo, el hoyo queda como estaba.', place: 'furniture' },
  harina: { name: 'Harina', desc: 'Trigo molido en la noria. En la cocina, con dos se hace un pan.' },
  // (the big well: 2 × 2 tiles dug 5 blocks deep; its name and description come from the language files)
  big_well: { place: 'furniture' },
  // (the wheelbarrow: built with B, pushed with E, a chest of 12 stacks and up to 3 big things on it; see barrow.js. Its name
  // and description come from the language files)
  wheelbarrow: { place: 'furniture' },
  // (the barber's chair: tavern furniture, a seat like any other; Eusebio cuts hair in the tavern's, neighbors.js)
  barber_chair: { place: 'furniture' },
  // (the chapel's pew, for two: three/chapel3d.js)
  pew: { place: 'furniture' },
  // (a player's business, business.js: the counter, two tiles; the shelf, against a wall; the crate)
  shop_counter: { place: 'furniture' }, display_shelf: { place: 'furniture' }, goods_crate: { place: 'furniture' },
  // (a writing desk, two tiles: the constable's; three/law3d.js)
  desk: { place: 'furniture' },
  // (table games, tablegames.js: the table with its baize; the dice and the box go on a table. tableKit: what one plays with it)
  game_table: { place: 'furniture' }, dice: { tableKit: 'crows' }, tile_box: { tableKit: 'tiles' },
  // (the watchtowers one builds, 9 and 12 m: world/tower.js)
  watchtower: { place: 'furniture' },
  watchtower_tall: { place: 'furniture' },
});
defineNames({ cana: ITEMS.cana, cana_fibra: ITEMS.cana_fibra }, 'item', ['desc']);
defineNames({ big_well: ITEMS.big_well, wheelbarrow: ITEMS.wheelbarrow, barber_chair: ITEMS.barber_chair, pew: ITEMS.pew, watchtower: ITEMS.watchtower, watchtower_tall: ITEMS.watchtower_tall, shop_counter: ITEMS.shop_counter, display_shelf: ITEMS.display_shelf, goods_crate: ITEMS.goods_crate, desk: ITEMS.desk, game_table: ITEMS.game_table, dice: ITEMS.dice, tile_box: ITEMS.tile_box }, 'item');
// (the saddlebags hold 12 stacks since Plan F, saddlebags.js: their description comes from the language files; with
// ?alforjas=0 they keep 9, and the old text)
if (!apagada('alforjas')) defineNames({ alforjas: ITEMS.alforjas }, 'item', ['desc']);
// ---------- Thirst and diving (docs/planes/gta/PLAN-D-barras-buceo.md §3.2): names and descriptions from the language files ----------
// canteen: the sips it holds when full. The sips left live on the stack as `s.sips` (inventory.js extraOf): a stack
// without them is empty (one just made, bought or from an old save). Never `dur`: the anvil and wearOut treat that as wear.
// thirst: what one quenches, in half-units of 20 (like hunger: thirstOf)
const THIRST_ITEMS = {
  canteen: { stack: 1, canteen: 4 },
  water_jug: { stack: 1, canteen: 10 },
  apple_juice: { food: 4, drink: true, thirst: 10 },
  // (found on the sea bed and at the bottom of lakes: dive.js)
  seashell: { relic: true },
  pearl: { gem: true },
  seaweed: { food: 4, thirst: 1 },
  mussel: { food: 3 },
};
Object.assign(ITEMS, THIRST_ITEMS);
defineNames(THIRST_ITEMS, 'item');
// Fish. What the nature book (nature.js), the neighbours (talktopics.js) and older games read: water (where), seasons (its
// best ones), hours (when it bites most), weather ('lluvia': it likes rain), dif (0..1, how hard: the price and the xp),
// mov (the fight of before), cm (length, smallest to largest of the common ones; a trophy passes it). What the fishing
// model reads (fishwater.js; nothing here is a yes or no but the water and the depth: a pike at noon is rare, not
// impossible): depth [m, m] of the bed under the bobber, temp [°C, °C] of the water it prefers, night (feeds by night),
// base (how common), run (× in its seasons, the salmon's run), bite (how the float tells it: fishing.js BITES), k (kg =
// k × (cm/100)³), pull (how hard it fights for its weight) and bait (what it likes on the hook: an item's id, or 'insect';
// only those with a lure there, spoon or jig, are predators: fishwater.js baitK)
export const FISH = {
  carpa: { name: 'Carpa', water: ['lago', 'estanque', 'pantano'], color: '#b8904a', size: 5, dif: 0.15, mov: 'calmo', cm: [30, 85], depth: [0.4, 5], temp: [14, 26], bite: 'run', k: 14, pull: 1, base: 0.3, bait: { maiz: 2, pan: 1.8, worm: 1.2 } },
  perca: { name: 'Perca', water: ['lago', 'estanque', 'rio'], color: '#7a9a4a', size: 4, dif: 0.25, mov: 'mixto', cm: [15, 45], depth: [0.4, 5], temp: [8, 24], bite: 'dip', k: 13, pull: 1, base: 0.3, bait: { worm: 1.6, insect: 1.5, spoon: 1.4 } },
  trucha: { name: 'Trucha', water: ['rio', 'lago'], seasons: [0, 2, 3], color: '#a88aa0', size: 5, dif: 0.4, mov: 'nervioso', cm: [25, 65], depth: [0.3, 4], temp: [4, 18], bite: 'dip', k: 11, pull: 1.2, base: 0.3, bait: { insect: 2, worm: 1.5, spoon: 1.5 } },
  salmon: { name: 'Salmón', water: ['rio'], seasons: [2], color: '#e0806a', size: 6, dif: 0.5, mov: 'flota', cm: [50, 100], depth: [0.8, 4], temp: [4, 15], bite: 'slam', k: 10, pull: 1.4, base: 0.08, run: 3, bait: { spoon: 2, worm: 1 } },
  lucio: { name: 'Lucio', water: ['lago'], hours: [15, 22], color: '#5a7a4a', size: 7, dif: 0.6, mov: 'nervioso', cm: [50, 120], depth: [1, 5], temp: [6, 22], bite: 'slam', k: 6, pull: 1.2, base: 0.16, bait: { spoon: 2.5, cut_bait: 1.5 } },
  anguila: { name: 'Anguila', water: ['pantano', 'rio'], hours: [19, 5], color: '#4a5a4a', size: 7, thin: true, dif: 0.6, mov: 'mixto', cm: [40, 110], depth: [0.3, 4], temp: [10, 26], night: true, bite: 'taps', k: 1.8, pull: 1.1, base: 0.24, bait: { worm: 1.6, cut_bait: 1.6, rotten_fish: 2 } },
  sardina: { name: 'Sardina', water: ['mar'], color: '#a8c0d8', size: 3, dif: 0.1, mov: 'flota', cm: [10, 22], depth: [1.5, 12], temp: [12, 22], bite: 'dip', k: 8, pull: 0.7, base: 0.34, bait: { pan: 1.5, jig: 1.5, worm: 1.2 } },
  lubina: { name: 'Lubina', water: ['mar'], color: '#8aa0b0', size: 6, dif: 0.4, mov: 'mixto', cm: [30, 80], depth: [1, 8], temp: [10, 22], bite: 'slam', k: 11, pull: 1.2, base: 0.2, bait: { cut_bait: 1.8, spoon: 1.8, jig: 1.5 } },
  pez_globo: { name: 'Pez globo', water: ['mar'], seasons: [1], color: '#e8d080', size: 4, round: true, dif: 0.5, mov: 'flota', cm: [12, 35], depth: [1.5, 12], temp: [18, 28], bite: 'dip', k: 25, pull: 0.8, base: 0.15, bait: { cut_bait: 1.2, worm: 1.2 } },
  cangrejo: { name: 'Cangrejo', water: ['mar'], color: '#d8502a', size: 4, crab: true, dif: 0.3, mov: 'fondo', cm: [8, 25], depth: [0.5, 12], bite: 'taps', k: 150, pull: 0.8, base: 0.2, bait: { cut_bait: 1.8, rotten_fish: 2.2 } },
  pez_hielo: { name: 'Pez de hielo', water: ['hielo'], color: '#c8e8f8', size: 4, dif: 0.45, mov: 'nervioso', cm: [15, 35], depth: [0.3, 10], temp: [0, 8], bite: 'dip', k: 9, pull: 0.9, base: 0.5, bait: { worm: 1.5, cut_bait: 1.3 } },
  siluro: { name: 'Siluro', water: ['rio', 'lago'], weather: 'lluvia', color: '#6a6250', size: 7, whiskers: true, dif: 0.6, mov: 'fondo', cm: [60, 160], depth: [0.9, 5], temp: [14, 28], night: true, bite: 'run', k: 7, pull: 1.3, base: 0.22, bait: { rotten_fish: 2.5, cut_bait: 2, worm: 0.8 } },
  pulpo: { name: 'Pulpo', water: ['mar'], hours: [20, 5], color: '#c86a78', size: 5, octo: true, dif: 0.7, mov: 'fondo', cm: [30, 90], depth: [1.5, 12], temp: [12, 24], night: true, bite: 'taps', k: 4, pull: 1, base: 0.18, bait: { cangrejo: 2, cut_bait: 1.5 } },
  atun: { name: 'Atún', water: ['mar'], seasons: [1], color: '#3a5a8a', size: 7, dif: 0.75, mov: 'nervioso', cm: [50, 130], depth: [6, 13], temp: [17, 26], bite: 'slam', k: 13, pull: 1.5, base: 0.22, bait: { jig: 2.5, cut_bait: 1 } },
  esturion: { name: 'Esturión', water: ['lago'], seasons: [3], color: '#7a8088', size: 7, dif: 0.8, mov: 'mixto', cm: [80, 200], depth: [3, 8], temp: [2, 14], bite: 'run', k: 6, pull: 1.3, base: 0.16, bait: { cut_bait: 1.5, worm: 1.2 } },
  // (Plan R1-2: their names come from the language files)
  tench: { water: ['estanque', 'lago', 'pantano'], color: '#6f7436', size: 5, dif: 0.35, mov: 'calmo', cm: [20, 55], depth: [0.4, 3], temp: [16, 26], bite: 'lift', k: 15, pull: 1.1, base: 0.18, bait: { worm: 1.8, maiz: 1.5, pan: 1.3 } },
  barbel: { water: ['rio'], color: '#a58a52', size: 5, dif: 0.35, mov: 'fondo', cm: [25, 80], depth: [0.5, 3], temp: [10, 24], bite: 'run', k: 10, pull: 1.2, base: 0.2, bait: { worm: 1.6, maiz: 1.4, cut_bait: 1.2 } },
  crayfish: { water: ['rio', 'lago', 'estanque'], color: '#7a4a32', size: 3, crab: true, dif: 0.2, mov: 'fondo', cm: [7, 14], depth: [0.3, 3], temp: [8, 24], night: true, bite: 'taps', k: 120, pull: 0.7, base: 0.14, bait: { rotten_fish: 2.5, cut_bait: 2 } },
  mackerel: { water: ['mar'], seasons: [0, 1], color: '#3f7286', size: 4, dif: 0.25, mov: 'flota', cm: [20, 40], depth: [2, 12], temp: [11, 20], bite: 'dip', k: 9, pull: 1.1, base: 0.22, bait: { jig: 2.5, cut_bait: 1.5 } },
  sea_bream: { water: ['mar'], color: '#b4bcc2', size: 5, dif: 0.4, mov: 'mixto', cm: [20, 55], depth: [1, 8], temp: [14, 24], bite: 'taps', k: 16, pull: 1.2, base: 0.18, bait: { cangrejo: 2, worm: 1.5, cut_bait: 1.2 } },
  squid: { water: ['mar'], hours: [20, 5], color: '#d0a8a0', size: 5, octo: true, dif: 0.45, mov: 'mixto', cm: [15, 45], depth: [3, 12], temp: [12, 20], night: true, bite: 'taps', k: 5, pull: 0.8, base: 0.16, bait: { jig: 2, cut_bait: 0.8 } },
  pez_dorado: { name: 'Pez dorado', water: ['lago', 'rio', 'mar', 'estanque'], rare: true, color: '#f8c030', size: 5, dif: 0.9, mov: 'nervioso', cm: [20, 45], bite: 'dip', k: 12, pull: 1, base: 0 },
};
const NEW_FISH = Object.fromEntries(['tench', 'barbel', 'crayfish', 'mackerel', 'sea_bream', 'squid'].map(id => [id, FISH[id]]));
defineNames(NEW_FISH, 'item', ['name']);
// ---------- Tackle and bait (Plan R1-2, fishing.js): names and descriptions from the language files ----------
// lure: casts a spoon or a jig lasts (counted by fishing.js, log.wear: they stack). landing_net only has to be carried
// (Plan R1-4: the fish trap is dropped in the water, traps.js; the rod rest is placed on the bank, rodrest.js)
const TACKLE_ITEMS = { worm: {}, cut_bait: {}, spoon: { stack: 8, lure: 60 }, jig: { stack: 8, lure: 60 }, landing_net: { stack: 1 }, fish_trap: { stack: 4 }, rod_rest: { place: 'furniture', stack: 4 } };
Object.assign(ITEMS, TACKLE_ITEMS);
defineNames(TACKLE_ITEMS, 'item');
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
  pocion: { name: 'Poción de vida', desc: 'Te devuelve más de la mitad de la salud (un 60 %).', heal: 12, potion: '#e83a5a' },
  // Las del alambique (potion: el color de lo de dentro; buff: el efecto y cuántos segundos dura)
  pocion_rapidez: { name: 'Poción de rapidez', desc: 'Corres más durante 3 minutos.', buff: ['rapido', 180], potion: '#5ac8f0' },
  pocion_fuerza: { name: 'Poción de fuerza', desc: 'Pegas 2 más fuerte durante 3 minutos.', buff: ['fuerza', 180], potion: '#b83a2a' },
  pocion_resistencia: { name: 'Poción de resistencia', desc: 'Te hacen un 30 % menos de daño durante 3 minutos.', buff: ['resistencia', 180], potion: '#8a8ab8' },
  pocion_regeneracion: { name: 'Poción de regeneración', desc: 'Te devuelve un poco de salud (un 5 %) cada 2 segundos y medio durante 45 segundos.', buff: ['regeneracion', 45], potion: '#e86ab8' },
  frasco: { name: 'Frasco de vidrio', desc: 'Para el alambique: al destilar se llena con la poción.' },
  espada: { name: 'Espada', desc: 'Para defenderte en cuevas y mazmorras. Úsala con el clic izquierdo.', weapon: 3, stack: 1, dur: 150 },
  espada_oro: { name: 'Espada de oro', desc: 'Pega el doble de fuerte.', weapon: 6, stack: 1, dur: 500 },
  barca: { name: 'Barca', desc: 'Úsala mirando al agua para navegar por ríos, lagos y el mar.', vehicle: 'barca', stack: 1 },
  caballo: { name: 'Silbato del caballo', desc: 'Con él tienes caballo: úsalo para llamarlo, montar y bajar. Cepíllalo y dale zanahorias: cuanto más te quiere, más corre.', vehicle: 'caballo', stack: 1 },
  brujula: { name: 'Brújula', desc: 'Llévala en la mano: su aguja apunta a tu cama o, si no tienes, a tu casa, por el camino más corto alrededor del planeta.', stack: 1 },
  mapa_vacio: { name: 'Mapa en blanco', desc: 'Úsalo y se convierte en el mapa de la zona donde estás (128 × 128 casillas), que se va dibujando mientras lo llevas encima.' },
  mapa: { name: 'Mapa', desc: 'Llévalo en la mano para verlo. Se dibuja mientras lo llevas encima en su zona. En el banco se copia y se amplía.', stack: 1 },
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
for (const [id, b] of Object.entries(BUGS)) ITEMS[id] = { name: b.name, desc: 'Un insecto para tu colección (diario, J).', bug: true };
ITEMS.red = { name: 'Red de insectos', desc: 'Úsala en la hierba o junto al agua para cazar insectos.', tool: 'red', tier: 1, stack: 1, dur: 120 };
ITEMS.vitrina = { name: 'Vitrina', desc: 'Para lucir tus colecciones en casa.', place: 'furniture' };

for (const [id, f] of Object.entries(FISH)) ITEMS[id] = { name: f.name, desc: f.rare ? '¡Rarísimo! Dicen que da suerte.' : 'Un pez. Se puede asar en la cocina o vender.', food: 6, fish: true };
defineNames(Object.fromEntries(Object.keys(NEW_FISH).map(id => [id, ITEMS[id]])), 'item');

for (const [tool, def] of Object.entries(TOOLS)) ITEMS[`${tool}_hierro`] = { name: `${def.name} ${TIERS[4].name}`, desc: def.desc, tool, tier: 4, stack: 1, dur: TIERS[4].dur };
// La pala con un bloque de tierra encima: la misma pala (con su desgaste), que al soltar la tierra vuelve a ser la vacía. No
// sale en la lista del creativo (hide)
ITEMS.pala_hierro.full = 'pala_llena';
ITEMS.pala_llena = { ...ITEMS.pala_hierro, name: 'Pala de hierro con tierra', desc: 'Lleva un bloque de tierra: haz clic donde quieras soltarlo (en un hoyo, lo rellena; en el suelo, hace un montón).', full: undefined, empty: 'pala_hierro', hide: true };
// The hammer builds what is drawn with B (plans.js): some 500 swings a small house, so it lasts about two
ITEMS.hammer = { tool: 'hammer', tier: 4, stack: 1, dur: 1000 };
defineNames({ hammer: ITEMS.hammer }, 'item');
// Ropa y mochila: se llevan puestas en un hueco del cuerpo (wear). Cada prenda lleva su color (en la casilla
// de la mochila o en el hueco); dye es el de las que se fabrican.
export const WEAR_SLOTS = [
  ['cabeza', 'Cabeza'], ['pelo', 'Pelo'], ['torso', 'Torso'], ['encima', 'Encima'], ['piernas', 'Piernas'], ['pies', 'Pies'],
  ['interiorArriba', 'Interior arriba'], ['interiorAbajo', 'Interior abajo'], ['calcetines', 'Calcetines'], ['espalda', 'Espalda'],
];
// The coats' slot (Plan E §3.1), over everything else, right after `encima`. Its label comes from the language files
// (read when it is shown: wearSlotLabel); an older game does not know it and keeps what is worn there (keptEquip)
WEAR_SLOTS.splice(WEAR_SLOTS.findIndex(([k]) => k === 'encima') + 1, 0, ['outer', 'Outer']);
export const wearSlotLabel = slot => (has(`wear.slot.${slot}`) ? t(`wear.slot.${slot}`) : WEAR_SLOTS.find(([k]) => k === slot)?.[1] ?? slot);
Object.assign(ITEMS, {
  camisa: { name: 'Camisa', desc: 'De manga larga. Encima puede ir un chaleco o un delantal.', wear: 'torso', dye: '#3a5ab8' },
  tunica: { name: 'Túnica con cinturón', desc: 'Hasta las caderas, con cinturón y hebilla.', wear: 'torso', dye: '#4a9a4a' },
  tunica_larga: { name: 'Túnica larga', desc: 'Hasta los tobillos.', wear: 'torso', dye: '#6a4ab8' },
  chaleco: { name: 'Chaleco', desc: 'Va encima de la camisa.', wear: 'encima', dye: '#2a3a6a' },
  delantal: { name: 'Delantal', desc: 'Con peto, bolsillo y lazo detrás. Va encima de la camisa.', wear: 'encima', dye: '#efe6d4' },
  pantalon: { name: 'Pantalón', desc: 'Largo, con cintura.', wear: 'piernas', dye: '#4a3a2a' },
  falda: { name: 'Falda', desc: 'Acampanada, hasta las rodillas.', wear: 'piernas', dye: '#b84a8a' },
  botas: { name: 'Botas', desc: 'Para no ir descalzo.', wear: 'pies', dye: '#5a3a24' },
  camiseta_interior: { name: 'Camiseta interior', desc: 'Sin mangas, debajo de la ropa.', wear: 'interiorArriba', dye: '#f2efe8' },
  calzoncillos: { name: 'Calzoncillos', desc: 'Ropa interior.', wear: 'interiorAbajo', dye: '#f2efe8' },
  bragas: { name: 'Bragas', desc: 'Ropa interior.', wear: 'interiorAbajo', dye: '#f4d8e2' },
  calcetines: { name: 'Calcetines', desc: 'Hasta media pierna. Van debajo de las botas.', wear: 'calcetines', dye: '#ece6da' },
  sombrero: { name: 'Sombrero de paja', desc: 'De ala ancha, para el sol del campo.', wear: 'cabeza', dye: '#e0c070' },
  gorro: { name: 'Gorro de lana', desc: 'Calentito, con pompón.', wear: 'cabeza', dye: '#c83a3a' },
  // Accesorios del pelo (no se ven con algo en la cabeza)
  lazo: { name: 'Lazo', desc: 'Un lazo grande para el pelo.', wear: 'pelo', dye: '#e86aa0' },
  diadema: { name: 'Diadema', desc: 'Sujeta el pelo de oreja a oreja.', wear: 'pelo', dye: '#c83a3a' },
  flor_pelo: { name: 'Flor para el pelo', desc: 'Una flor prendida sobre la oreja.', wear: 'pelo', dye: '#f4f0e8' },
  horquillas: { name: 'Horquillas', desc: 'Un par de horquillas de colores.', wear: 'pelo', dye: '#e8c050' },
  corona_flores: { name: 'Corona de flores', desc: 'Flores trenzadas alrededor de la cabeza.', wear: 'pelo', dye: '#e86aa0' },
  hijab: { name: 'Hiyab', desc: 'Pañuelo que cubre el pelo y el cuello y deja la cara a la vista.', wear: 'cabeza', dye: '#1c1c22' },
  mochila: { name: 'Mochila', desc: 'Póntela a la espalda y podrás llevar 27 cosas más. Sin ella solo llevas lo que cabe en las manos y los bolsillos. También se deja en el suelo, llena, como un cofre que se lleva.', wear: 'espalda', bag: 27, dye: '#8a5a34', place: 'furniture' },
});
// ---------- The new garments (Plan E §3.1, phase E2): English ids, names and descriptions from the language files ----------
// Woven at the loom with no plan (recipes.js) and sold by Marta, by season (economy.js). Drawn in
// their own shapes (three/real/persona.js). Like every garment they carry their colour and never stack
const GARMENT_ITEMS = {
  wool_coat: { wear: 'outer', dye: '#5e5648' },
  sheepskin_jacket: { wear: 'outer', dye: '#8a6440' },
  linen_shirt: { wear: 'torso', dye: '#e6dcc4' },
  wool_socks: { wear: 'calcetines', dye: '#b8a688' },
  lined_boots: { wear: 'pies', dye: '#6a4a30' },
  leather_apron: { wear: 'encima', dye: '#7a5232' },
};
Object.assign(ITEMS, GARMENT_ITEMS);
defineNames(GARMENT_ITEMS, 'item');
// What each garment does for the body (docs/planes/gta/PLAN-E-cuerpo-aspecto.md §3.1): warm (insulation points), rain
// (0..1 rainproof share), shade (sun shade) and work (the share of the torso's dirt it takes). One source of truth, the
// GARMENTS table of clothing.js (what body.js computes with); copied here only so the windows can say it (clothesText).
// (only items this game has: a garment of clothing.js that is not an item yet is skipped)
for (const [id, g] of Object.entries(GARMENTS)) {
  const def = ITEMS[id];
  if (!def?.wear) continue;
  def.warm = g.warm || 0;
  if (g.rain) def.rain = g.rain;
  if (g.shade) def.shade = g.shade;
  if (g.work) def.work = g.work;
}
// ---------- The body (Plan E §2.3): soap. A bath or a scrub at the water with soap in the bag uses one (body.js). Its name
// and description come from the language files ----------
const BODY_ITEMS = { soap: {} };
Object.assign(ITEMS, BODY_ITEMS);
defineNames(BODY_ITEMS, 'item');
// ---------- What the places of the world have, that anyone can build (PLAN-R7 §3.6.1; B › Outside): their models, three/places3d.js; their
// names and descriptions come from the language files. The fires burn for a while after they are lit (FIRE_MS, real ms: the game's
// clock is the real one), with what FIRE_FUEL says (game.js fireAction; kept in d.fire of the chunk) ----------
export const FIRE_MS = { campfire: 2 * 36e5, brazier: 4 * 36e5, charcoal_clamp: 6 * 36e5, lighthouse: 7 * 864e5 };
export const FIRE_FUEL = { campfire: ['madera', 1], brazier: ['madera', 1], charcoal_clamp: ['madera', 2], lighthouse: ['carbon', 4] };
export const PLACE_ITEMS = Object.fromEntries(['tent', 'campfire', 'brazier', 'signpost', 'stone_bench', 'stone_trough', 'jetty', 'stone_bridge', 'timber_bridge', 'bell_frame', 'lighthouse', 'lighthouse_stone', 'lighthouse_black', 'net_rack', 'fish_rack', 'hide_rack', 'log_pile', 'firewood', 'plank_stack', 'sawpit', 'chop_block', 'charcoal_clamp', 'charcoal_heap', 'hayrick', 'hay_pile', 'ore_cart', 'rail', 'spoil_heap', 'mine_front', 'crypt_hatch', 'beached_up', 'beached_trestle', 'beached_side', 'beached_keel', 'beached_buried', 'pennant', 'post_lantern', 'ivy', 'sand_drift', 'salt_lick'].map(id => [id, { place: 'furniture' }]));
Object.assign(ITEMS, PLACE_ITEMS);
defineNames(PLACE_ITEMS, 'item');
// ---------- The garden (docs/planes/realismo/PLAN-R2-huerto.md): straw, from wheat cut with the scythe; on tilled soil it keeps
// the water in (farm.js, mulch) ----------
// Compost (abono: its old id) feeds the soil, and so does the manure of the stables (soil.js); the bin makes it
const GARDEN_ITEMS = { pear: { food: 14 }, cherry: { food: 5 }, pear_sapling: { sapling: 'pear' }, cherry_sapling: { sapling: 'cherry' }, straw: {}, manure: {}, glass: {}, cloche: {}, compost_bin: { place: 'furniture' }, scarecrow: { place: 'furniture' }, trough: { place: 'furniture' }, hitching_post: { place: 'furniture' }, abono: ITEMS.abono };
Object.assign(ITEMS, GARDEN_ITEMS);
defineNames(GARDEN_ITEMS, 'item');
defineNames({ comedero: ITEMS.comedero, herraduras: ITEMS.herraduras }, 'item', ['desc']);
// Muebles de la casa familiar: dormitorios, cocina y baño
Object.assign(ITEMS, {
  sofa: { name: 'Sofá', desc: 'De dos plazas, con cojines. Arrímalo a la pared y siéntate en él con E.', place: 'furniture' },
  cama_doble: { name: 'Cama doble', desc: 'Cama de matrimonio, de dos casillas de ancho. Para dormir y, si os tumbáis cada uno a un lado, para tener un bebé.', place: 'furniture' },
  cama_nino: { name: 'Cama de niño', desc: 'Pequeña, con edredón azul. Cuando el bebé crezca, dormirá en ella.', place: 'furniture' },
  cuna: { name: 'Cuna', desc: 'De barrotes. Para tener un bebé hace falta una libre.', place: 'furniture' },
  alacena: { name: 'Alacena', desc: 'Armario de cocina, con platos y tarros en los estantes.', place: 'furniture' },
  mueble_bano: { name: 'Mueble de baño', desc: 'Bajo y blanco, con un cajón y dos puertas; encima, toallas dobladas y jabón.', place: 'furniture' },
  armario: { name: 'Armario', desc: 'Alto, de dos puertas, para el dormitorio: guarda 27 prendas (solo ropa). Ábrelo con E.', place: 'furniture' },
  chimenea: { name: 'Hogar con chimenea', desc: 'De piedra, con su chimenea: da luz y calor. Se arrima a un muro, dentro de casa (R: girar), y se recoge con X.', place: 'furniture' },
  cuadro_valle: { name: 'Cuadro del valle', desc: 'Colinas verdes y montañas al fondo. Se cuelga de un muro, dentro de casa (también encima de un mueble).', place: 'wall' },
  cuadro_mar: { name: 'Cuadro del mar', desc: 'Un velero al atardecer. Se cuelga de un muro, dentro de casa (también encima de un mueble).', place: 'wall' },
  cuadro_flores: { name: 'Cuadro de flores', desc: 'Un jarrón de flores sobre la mesa. Se cuelga de un muro, dentro de casa (también encima de un mueble).', place: 'wall' },
  cuadro_noche: { name: 'Cuadro de la noche', desc: 'El pueblo dormido bajo la luna. Se cuelga de un muro, dentro de casa (también encima de un mueble).', place: 'wall' },
  encimera: { name: 'Encimera con cajones', desc: 'Mueble bajo de cocina, como la alacena sin los estantes de arriba: dos cajones, dos puertas y la encimera para trabajar.', place: 'furniture' },
  fregadero: { name: 'Fregadero', desc: 'De piedra, sobre un mueble, con su grifo.', place: 'furniture' },
  banera: { name: 'Bañera', desc: 'De porcelana, con patas de latón. Ocupa dos casillas.', place: 'furniture' },
  inodoro: { name: 'Retrete', desc: 'De porcelana, con asiento de madera.', place: 'furniture' },
  lavabo: { name: 'Lavabo', desc: 'De porcelana, con un espejo encima.', place: 'furniture' },
  // Para el salón y el dormitorio
  mesa_baja: { name: 'Mesa baja', desc: 'Mesita de centro, con un estante abajo: para delante del sofá o del sillón.', place: 'furniture' },
  sillon: { name: 'Sillón', desc: 'De cuero, de una plaza, con orejas y un cojín. Siéntate en él con E.', place: 'furniture' },
  mesita: { name: 'Mesita de noche', desc: 'Con un cajón y un hueco para un libro: junto a la cama. Guarda 9 montones de cosas: ábrela con E.', place: 'furniture' },
  comoda: { name: 'Cómoda', desc: 'Tres cajones grandes con tiradores de latón. Guarda 18 montones de cosas: ábrela con E.', place: 'furniture' },
});
// Lo que guarda cosas dentro (se abre con E): cuántos montones y cómo se dice
export const CHESTS = { cofre: [18, 'el cofre'], armario: [27, 'el armario'], mochila: [27, 'la mochila'], mesita: [9, 'la mesita'], comoda: [18, 'la cómoda'], wheelbarrow: [12, 'la carretilla'] };   // (the wheelbarrow's texts go with t(): the second value only gives its gender)
// Armaduras: casco, peto, grebas y botas de cobre, hierro y oro, que se forjan en el yunque y se llevan puestas en
// los huecos de la ropa (cabeza, encima, piernas y pies). armor: lo que protege (cada punto quita un 4 % del daño,
// como en Minecraft); dur: los golpes que aguanta
export const ARMOR_PIECES = [['casco', 'Casco', 'cabeza', 11], ['peto', 'Peto', 'encima', 16], ['grebas', 'Grebas', 'piernas', 15], ['botas', 'Botas', 'pies', 13]];
export const ARMOR_METALS = [['cobre', 'de cobre', '#d08a52', [2, 5, 4, 1], 12], ['hierro', 'de hierro', '#c4ccd6', [2, 6, 5, 2], 15], ['oro', 'de oro', '#f0c840', [3, 8, 6, 3], 33]];
for (const [metal, of, dye, points, base] of ARMOR_METALS) ARMOR_PIECES.forEach(([piece, name, wear, mult], i) => {
  ITEMS[`${piece}_${metal}`] = { name: `${name} ${of}`, desc: `Armadura: protege ${points[i]} punto${points[i] > 1 ? 's' : ''} (cada uno, un 4 % del daño). Se forja en el yunque y se repara allí.`, wear, dye, armor: points[i], dur: base * mult, metal, piece, stack: 1, noDye: true };
});
export const isArmor = id => !!ITEMS[id]?.armor;
// Lo que quita el hambre cada comida (en medios muslos, de 20): si no lo dice, según lo que alimenta (food)
export const hungerOf = def => def.hunger ?? Math.max(1, Math.min(10, Math.round((def.food || 0) / 4)));
// What each one quenches (half-units of THIRST_MAX = 20): its own `thirst`, or a little for any other drink
export const thirstOf = def => def?.thirst ?? (def?.drink ? 4 : 0);
// Units of 20 as the percentage the bars show (12 → 60)
export const pctOf = units => Math.round(100 * units / 20);
// "Restores hunger +25 % and thirst +30 %." for the descriptions (inventory, crafting); '' if it restores nothing
export function restoreText(def) {
  if (!def) return '';
  const list = [];
  if (def.food) list.push(t('item.restores.hunger', { n: pctOf(hungerOf(def)) }));
  if (thirstOf(def) > 0) list.push(t('item.restores.thirst', { n: pctOf(thirstOf(def)) }));
  return list.length ? t('item.restores', { list: fmt.list(list) }) : '';
}
// "Warmth +1 · Keeps off rain" for a garment's description (inventory, crafting); '' if it does nothing for the body
// (underwear, hair accessories, the backpack, armour). s: the stack or the worn piece, when there is one: the warmth is
// then what it gives with its tear (a torn piece keeps less warm) and its condition word goes last ("Torn")
export function clothesText(def, s) {
  if (!def?.wear) return '';
  const list = [], tear = s?.tear || 0;
  if (def.warm > 0) list.push(t('item.warmth', { n: Math.round(def.warm * tearMul(tear) * 10) / 10 }));
  if (def.rain > 0) list.push(t('item.rain'));
  if (def.shade > 0) list.push(t('item.shade'));
  if (def.work > 0) list.push(t('item.work'));
  const cond = conditionText(s);
  if (cond) list.push(cond);
  return list.join(' · ');
}
// The condition of a garment by its tear (Plan E §3.2): '' while it looks new, then Worn (40), Torn (75), In rags (100)
export function conditionText(s) {
  const tear = s?.tear || 0;
  return tear >= TEAR.rags ? t('item.cond.rags') : tear >= TEAR.torn ? t('item.cond.torn') : tear >= TEAR.worn ? t('item.cond.worn') : '';
}
// A thing's name as a noun for the messages ({item, the}, {item, a}…): from the language files when it has a key
// (item.canteen, with its gender), else its Spanish name from ITEMS with a guessed gender (oldNoun)
// The same, for a list that shows nature too (fish, insects, flowers and crops have their name in the nature book)
export const thingNoun = id => (!has(`item.${id}`) && has(`nature.name.${id}`) ? noun('nature.name', id) : itemNoun(id));
export const itemNoun = id => (has(`item.${id}`) ? noun('item', id) : oldNoun(ITEMS[id]?.name ?? String(id)));
// An older id with no language key has only its Spanish name: its gender and number (for el/la/los/las, un/una) are
// guessed from the first word, with the usual exceptions, so "la fresa", "las botas", "el hacha" read right ("item.x.g"
// in the language files wins once the id gets a key). Made once per name
const ES_M = new Set(['mapa', 'día', 'problema', 'tema', 'sistema', 'clima', 'idioma', 'pijama', 'planeta', 'cometa', 'tranvía', 'sofá']);
const ES_F = new Set(['leche', 'carne', 'miel', 'sal', 'piel', 'red', 'nuez', 'llave', 'flor', 'col', 'coliflor', 'lombriz', 'raíz', 'perdiz', 'codorniz', 'liebre', 'nieve', 'torre', 'fuente', 'mano', 'nave', 'cruz', 'luz', 'pared', 'semilla', 'gente']);
const ES_EL = new Set(['hacha', 'agua', 'águila', 'arma', 'ala', 'alma', 'área', 'hambre', 'arca', 'asa', 'ancla', 'ave', 'hada', 'aula', 'haba']);   // (feminine, but "el": stressed a)
const oldNouns = new Map();
function oldNoun(name) {
  let n = oldNouns.get(name);
  if (n) return getLang() === 'es' || !n.the ? n : { name };
  const w = name.split(/[\s,(]/)[0].toLowerCase();
  const plural = w.length > 3 && /[^áéíóú]s$/.test(w) && !/(sis|tis|us)$/.test(w);
  const one = !plural ? w : /(ion|ión)es$/.test(w) ? w.replace(/es$/, '') : /[aeiouáéíóú]s$/.test(w) ? w.slice(0, -1) : w.replace(/es$/, '');
  const fem = !ES_M.has(one) && (ES_F.has(one) || ES_EL.has(one) || /a$/.test(one) || /(ión|ion|dad|tad|tud|umbre|ez)$/.test(one));
  n = { name, g: (fem ? 'f' : 'm') + (plural ? 'p' : '') };
  if (!plural && ES_EL.has(one)) Object.assign(n, { the: `el ${name.toLowerCase()}`, a: `un ${name.toLowerCase()}` });
  oldNouns.set(name, n);
  return getLang() === 'es' || !n.the ? n : { name };
}

// Las alfombras se tejen de cada tamaño en el telar: la de siempre es la de 1×1 y 'alfombra_persa_2x3', la persa de
// 2×3 (rug: de qué alfombra es; size: lo que ocupa, en casillas; plain: su nombre sin el tamaño)
export const RUG_KINDS = ['alfombra', 'alfombra_persa', 'alfombra_rayas', 'alfombra_rombos', 'alfombra_trenzada'];
export const RUG_MADE = [[1, 1], [1, 2], [2, 2], [2, 3], [3, 4]];
export const rugId = (kind, [w, h]) => (w === 1 && h === 1 ? kind : `${kind}_${w}x${h}`);
for (const kind of RUG_KINDS) {
  const base = ITEMS[kind], plain = base.name;
  for (const size of RUG_MADE) ITEMS[rugId(kind, size)] = Object.assign(ITEMS[rugId(kind, size)] || { ...base }, { name: `${plain} ${size[0]}×${size[1]}`, rug: kind, size, plain });
}
for (const it of Object.values(ITEMS)) if (it.wear) it.stack = 1;
for (const it of Object.values(ITEMS)) it.stack ??= it.place ? 10 : 99;

// Qué herramienta hace falta, cuánto cuesta trabajarlo (hits: ver hitsFor), qué cae ([id, mínimo, máximo, probabilidad])
// y qué astillas salta al golpear. `hand`: golpes a mano (si se puede).
// Nada de esto vuelve a crecer: lo que se tala, pica o siega desaparece para siempre.
const TREE = { tool: 'hacha', hits: 4, chips: 'wood', verb: 'Talar' };
export const HARVEST = {
  oak: { ...TREE, drops: [['madera', 3, 5], ['bellota', 1, 1, 0.3]] },
  // (fruit: lo que no suelta si se le acaba de coger o no es su época: farm.js, dress)
  fruit: { ...TREE, fruit: 'manzana', drops: [['madera', 3, 4], ['manzana', 2, 3]] },
  pear: { ...TREE, fruit: 'pear', drops: [['madera', 3, 4], ['pear', 2, 3]] },
  cherry: { ...TREE, fruit: 'cherry', drops: [['madera', 3, 4], ['cherry', 4, 6]] },
  pine: { ...TREE, drops: [['madera', 3, 5], ['pina', 1, 1, 0.3]] },
  snowPine: { ...TREE, drops: [['madera', 3, 5], ['pina', 1, 1, 0.3]] },
  palm: { ...TREE, hits: 3, fruit: 'coco', drops: [['madera', 2, 3], ['coco', 2, 3]] },
  swampTree: { ...TREE, drops: [['madera', 3, 4], ['fibra', 1, 2, 0.4]] },
  cactus: { tool: 'hacha', hits: 2, chips: 'cactus', verb: 'Cortar', drops: [['pulpa', 1, 2], ['fibra', 1, 1, 0.5]] },
  bush: { tool: 'guadana', hand: 2, hits: 1, chips: 'leaf', verb: 'Segar', drops: [['fibra', 1, 2], ['bayas', 1, 2, 0.5], ['semillas', 1, 2, 0.3]] },
  // Las flores silvestres: se cogen a mano (o con la guadaña)
  margarita: { tool: 'guadana', hand: 1, hits: 1, chips: 'leaf', verb: 'Coger', drops: [['margarita', 1, 1]] },
  diente_leon: { tool: 'guadana', hand: 1, hits: 1, chips: 'leaf', verb: 'Coger', drops: [['diente_leon', 1, 1]] },
  deadBush: { tool: 'guadana', hand: 1, hits: 1, chips: 'twig', verb: 'Segar', drops: [['madera', 1, 1], ['fibra', 1, 2]] },
  rock: { tool: 'pico', hits: 2, chips: 'stone', verb: 'Picar', drops: [['piedra', 2, 3], ['carbon', 1, 1, 0.2], ['cobre', 1, 1, 0.15]] },
  boulder: { tool: 'pico', hits: 6, chips: 'stone', verb: 'Picar', drops: [['piedra', 5, 7], ['carbon', 1, 2, 0.4], ['cobre', 1, 3, 0.6], ['hierro', 1, 2, 0.45], ['oro', 1, 2, 0.3]] },
  snowBoulder: { tool: 'pico', hits: 6, chips: 'stone', verb: 'Picar', drops: [['piedra', 4, 6], ['carbon', 1, 1, 0.3], ['hierro', 1, 3, 0.55], ['oro', 1, 2, 0.35]] },
};

// La hierba de una casilla, segada con la guadaña (ver gen.js, grassAt): una fibra y, a veces, semillas
export const GRASS_DROPS = [['fibra', 1, 1], ['semillas', 1, 1, 0.08]];

// Vetas de las cuevas
const VEIN = (ore, hits, drops) => ({ tool: 'pico', hits, chips: 'stone', verb: 'Picar', drops });
Object.assign(HARVEST, {
  veta_piedra: VEIN('piedra', 2, [['piedra', 2, 4], ['carbon', 1, 1, 0.3]]),
  veta_cobre: VEIN('cobre', 3, [['cobre', 1, 3], ['piedra', 1, 2]]),
  veta_hierro: VEIN('hierro', 4, [['hierro', 1, 3], ['piedra', 1, 1]]),
  veta_oro: VEIN('oro', 5, [['oro', 1, 2]]),
  veta_amatista: VEIN('amatista', 4, [['amatista', 1, 1], ['piedra', 1, 1]]),
  veta_esmeralda: VEIN('esmeralda', 5, [['esmeralda', 1, 1]]),
  veta_rubi: VEIN('rubi', 6, [['rubi', 1, 1]]),
  veta_diamante: VEIN('diamante', 7, [['diamante', 1, 1]]),
  veta_fosil: VEIN('fosil', 3, [['fosil_concha', 1, 1, 0.5], ['fosil_hueso', 1, 1, 0.35], ['fosil_ambar', 1, 1, 0.2], ['piedra', 1, 2]]),
});

// Lo que cansa cada uso de herramienta (en cansancio de combat.js: a 4, medio muslo de hambre menos)
export const TOOL_COST = { hacha: 1, pico: 1, guadana: 0.5, azada: 1, pala: 1, mano: 0.5, regadera: 0.5, cana: 0.5, red: 0.5, hammer: 0.08 };
// [id, n, extra?]: the third element is the stack's own data (new players start with a full canteen: game.js passes it)
export const START_KIT = [['hacha_hierro', 1], ['pico_hierro', 1], ['guadana_hierro', 1], ['azada_hierro', 1], ['pala_hierro', 1], ['hammer', 1], ['manzana', 3], ['canteen', 1, { sips: 4 }]];

// Golpes que necesita con su herramienta
export const hitsFor = rule => Math.max(1, Math.ceil(rule.hits / TIERS[4].power));

// Lo de una versión más nueva del juego: un id que esta no conoce (lo ha guardado un juego más nuevo, o llega de él por
// la red). No se usa, pero tampoco se borra: en la mochila se aparta y se vuelve a guardar (Inventory), en los cofres se
// queda en su casilla con un «?» y no se puede sacar, y en el mundo se ve como una caja con «?» (scenes.js, addBuilt)
// NORMA: como lo que no se conoce ya no se borra, un id que se quite del juego tiene que ir en LEGACY_ITEMS (si se cambia
// por sus materiales) o en RETIRED (game.js); si no, se quedaría apartado para siempre como «de una versión más nueva»
export const knownItem = id => !!ITEMS[id] || !!LEGACY_ITEMS[id];
export const UNKNOWN_NAME = 'Algo de una versión más nueva del juego (recarga la página para verlo)';

// Lo que fue un objeto de la mochila y ya no lo es (ahora se construye con B: ver pieces.js y buildables.js, que añade
// aquí los muebles y las estaciones): al cargar una partida o abrir un cofre, lo que quede guardado se cambia por los
// materiales que costaba, para que nadie pierda nada. id → [[material, n]…]
export const LEGACY_ITEMS = { valla: [['tablas', 1]], puerta_valla: [['tablas', 3]] };
// Pone al día una lista de casillas ({ id, n } o null), en el sitio: lo de LEGACY_ITEMS, por sus materiales (el primero
// en su casilla; los demás, con los montones que haya o en los huecos). Lo que este juego no conoce se queda como está
// (es de una versión más nueva: ver knownItem). Devuelve lo que no ha cabido: [[material, n]…]
export function modernSlots(slots) {
  const extra = [], spill = [];
  if (!Array.isArray(slots)) return spill;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i], L = s && LEGACY_ITEMS[s.id];
    if (L) { const n = s.n || 1; slots[i] = { id: L[0][0], n: L[0][1] * n }; for (const [m, k] of L.slice(1)) extra.push([m, k * n]); }
  }
  for (const [m, n] of extra) {
    const same = slots.find(s => s && s.id === m && !s.color);
    if (same) { same.n += n; continue; }
    const free = slots.findIndex(s => !s);
    if (free >= 0) slots[free] = { id: m, n }; else spill.push([m, n]);
  }
  return spill;
}
