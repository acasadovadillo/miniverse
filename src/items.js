// Objetos (herramientas, materiales, comida y cosas que se colocan) y qué da cada cosa del mundo al recolectarla.

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
  coco: { name: 'Coco', desc: 'Se cogen de las palmeras con E (vuelven a salir a los 3 días) o talándolas. Cuesta abrirlo, pero merece la pena.', food: 12 },
  manzana: { name: 'Manzana', desc: 'Crujiente y dulce.', food: 15 },
  bayas: { name: 'Bayas', desc: 'Un puñado de bayas silvestres.', food: 8 },
  pulpa: { name: 'Pulpa de cactus', desc: 'Jugosa, aunque pincha un poco.', food: 10 },
  manzana_asada: { name: 'Manzana asada', desc: 'Caliente y con canela imaginaria.', food: 30 },
  mermelada: { name: 'Mermelada de bayas', desc: 'Un tarro entero. No preguntes de dónde ha salido el tarro.', food: 35 },
  coco_tostado: { name: 'Coco tostado', desc: 'Huele a playa.', food: 28 },
  pinones: { name: 'Piñones tostados', desc: 'Pequeños pero llenan.', food: 18 },
  pan_bellota: { name: 'Pan de bellota', desc: 'Denso, rústico y muy de pueblo.', food: 25 },
  estofado: { name: 'Estofado de cactus', desc: 'La especialidad del desierto. Quita el hambre para rato.', food: 50 },
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
  cana: { name: 'Caña de pescar', desc: 'Mirando al agua, clic para lanzar. Cuando pique, clic otra vez, a tiempo.', tool: 'cana', tier: 1, stack: 1, dur: 80 },
  cana_fibra: { name: 'Caña de fibra', desc: 'Más ligera y sensible: los peces pican antes y da algo más de tiempo.', tool: 'cana', tier: 2, stack: 1, dur: 160 },
  abono: { name: 'Abono', desc: 'Úsalo en un cultivo: crecerá más deprisa.' },
  aspersor: { name: 'Aspersor', desc: 'Riega solo cada mañana las 8 casillas de alrededor.', place: 'furniture' },
  gallinero: { name: 'Gallinero', desc: 'Casa grande para hasta 4 gallinas o patos. Con E: la puerta y asignarle animales. Con la puerta cerrada, se quedan dentro.', place: 'furniture' },
  establo: { name: 'Establo', desc: 'Casa grande para hasta 4 vacas, ovejas, cabras o cerdos. Con E: la puerta y asignarle animales. Con la puerta cerrada, se quedan dentro.', place: 'furniture' },
  colmena: { name: 'Colmena', desc: 'Las abejas hacen miel cada pocos días (menos en invierno).', place: 'furniture' },
  comedero: { name: 'Comedero', desc: 'Pon dentro fibra o trigo: tus animales comen de él cada mañana.', place: 'furniture' },
  huevo: { name: 'Huevo', desc: 'Fresco del gallinero.', food: 8 },
  leche: { name: 'Leche', desc: 'De vaca contenta.', food: 10 },
  lana: { name: 'Lana', desc: 'Suave. En el telar se convierte en tela.' },
  miel: { name: 'Miel', desc: 'Dulce y pegajosa.', food: 15 },
  tortilla: { name: 'Tortilla', desc: 'Con o sin cebolla: el eterno debate.', food: 40 },
  queso: { name: 'Queso', desc: 'Curado en tu propia cocina.', food: 35 },
  pan: { name: 'Pan', desc: 'Recién hecho.', food: 30 },
  tarta_calabaza: { name: 'Tarta de calabaza', desc: 'Quita el hambre y te hace ir más rápido un rato.', food: 60, buff: ['rapido', 120] },
  sopa_verduras: { name: 'Sopa de verduras', desc: 'Durante un rato, trabajar no cansa.', food: 55, buff: ['incansable', 120] },
  pescado_asado: { name: 'Pescado asado', desc: 'Con un chorrito de limón imaginario.', food: 30 },
  mermelada_fresa: { name: 'Mermelada de fresa', desc: 'Para untar en pan.', food: 40 },
  palomitas: { name: 'Palomitas', desc: 'Pop.', food: 20 },
  tostada_miel: { name: 'Tostada con miel', desc: 'Desayuno de campeones: quita el hambre y da velocidad.', food: 45, buff: ['rapido', 90] },
});
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
  sidra: { name: 'Vaso de sidra', desc: 'De las manzanas del pueblo: fresca y ácida.', food: 10, drink: true },
  cerveza: { name: 'Jarra de cerveza', desc: 'Con su espuma. Anselmo dice que la receta es de su abuela.', food: 12, drink: true },
  hidromiel: { name: 'Hidromiel', desc: 'Miel fermentada: dulce y traicionera. Un rato de alegría en las piernas.', food: 14, drink: true, buff: ['rapido', 60] },
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
  leche_cabra: { name: 'Leche de cabra', desc: 'Para hacer queso de cabra en la quesera.', food: 10 },
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
});
// Peces: dónde viven, cuándo (estaciones, horas y tiempo) y lo difíciles que son (los difíciles salen menos y valen más):
// dif: lo difícil que es (0 a 1); mov: cómo se mueve (calmo, mixto, nervioso, fondo: tira hacia abajo,
// flota: tira hacia arriba); cm: la talla, de la más pequeña a la más grande
export const FISH = {
  carpa: { name: 'Carpa', water: ['lago', 'estanque', 'pantano'], color: '#b8904a', size: 5, dif: 0.15, mov: 'calmo', cm: [30, 80] },
  perca: { name: 'Perca', water: ['lago', 'estanque', 'rio'], color: '#7a9a4a', size: 4, dif: 0.25, mov: 'mixto', cm: [15, 40] },
  trucha: { name: 'Trucha', water: ['rio', 'lago'], seasons: [0, 2, 3], color: '#a88aa0', size: 5, dif: 0.4, mov: 'nervioso', cm: [25, 60] },
  salmon: { name: 'Salmón', water: ['rio'], seasons: [2], color: '#e0806a', size: 6, dif: 0.5, mov: 'flota', cm: [50, 100] },
  lucio: { name: 'Lucio', water: ['lago'], hours: [15, 22], color: '#5a7a4a', size: 7, dif: 0.6, mov: 'nervioso', cm: [50, 120] },
  anguila: { name: 'Anguila', water: ['pantano', 'rio'], hours: [19, 5], color: '#4a5a4a', size: 7, thin: true, dif: 0.6, mov: 'mixto', cm: [40, 110] },
  sardina: { name: 'Sardina', water: ['mar'], color: '#a8c0d8', size: 3, dif: 0.1, mov: 'flota', cm: [10, 22] },
  lubina: { name: 'Lubina', water: ['mar'], color: '#8aa0b0', size: 6, dif: 0.4, mov: 'mixto', cm: [30, 75] },
  pez_globo: { name: 'Pez globo', water: ['mar'], seasons: [1], color: '#e8d080', size: 4, round: true, dif: 0.5, mov: 'flota', cm: [12, 35] },
  cangrejo: { name: 'Cangrejo', water: ['mar'], color: '#d8502a', size: 4, crab: true, dif: 0.3, mov: 'fondo', cm: [8, 25] },
  pez_hielo: { name: 'Pez de hielo', water: ['hielo'], color: '#c8e8f8', size: 4, dif: 0.45, mov: 'nervioso', cm: [15, 35] },
  siluro: { name: 'Siluro', water: ['rio', 'lago'], weather: 'lluvia', color: '#6a6250', size: 7, whiskers: true, dif: 0.6, mov: 'fondo', cm: [60, 180] },
  pulpo: { name: 'Pulpo', water: ['mar'], hours: [20, 5], color: '#c86a78', size: 5, octo: true, dif: 0.7, mov: 'fondo', cm: [30, 90] },
  atun: { name: 'Atún', water: ['mar'], seasons: [1], color: '#3a5a8a', size: 7, dif: 0.75, mov: 'nervioso', cm: [80, 200] },
  esturion: { name: 'Esturión', water: ['lago'], seasons: [3], color: '#7a8088', size: 7, dif: 0.8, mov: 'mixto', cm: [80, 220] },
  pez_dorado: { name: 'Pez dorado', water: ['lago', 'rio', 'mar', 'estanque'], rare: true, color: '#f8c030', size: 5, dif: 0.9, mov: 'nervioso', cm: [20, 45] },
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
  pocion: { name: 'Poción de vida', desc: 'Cura 6 corazones.', heal: 12, potion: '#e83a5a' },
  // Las del alambique (potion: el color de lo de dentro; buff: el efecto y cuántos segundos dura)
  pocion_rapidez: { name: 'Poción de rapidez', desc: 'Corres más durante 3 minutos.', buff: ['rapido', 180], potion: '#5ac8f0' },
  pocion_fuerza: { name: 'Poción de fuerza', desc: 'Pegas 2 más fuerte durante 3 minutos.', buff: ['fuerza', 180], potion: '#b83a2a' },
  pocion_resistencia: { name: 'Poción de resistencia', desc: 'Te hacen un 30 % menos de daño durante 3 minutos.', buff: ['resistencia', 180], potion: '#8a8ab8' },
  pocion_regeneracion: { name: 'Poción de regeneración', desc: 'Te cura medio corazón cada 2 segundos y medio durante 45 segundos.', buff: ['regeneracion', 45], potion: '#e86ab8' },
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

for (const [tool, def] of Object.entries(TOOLS)) ITEMS[`${tool}_hierro`] = { name: `${def.name} ${TIERS[4].name}`, desc: def.desc, tool, tier: 4, stack: 1, dur: TIERS[4].dur };
// La pala con un bloque de tierra encima: la misma pala (con su desgaste), que al soltar la tierra vuelve a ser la vacía. No
// sale en la lista del creativo (hide)
ITEMS.pala_hierro.full = 'pala_llena';
ITEMS.pala_llena = { ...ITEMS.pala_hierro, name: 'Pala de hierro con tierra', desc: 'Lleva un bloque de tierra: haz clic donde quieras soltarlo (en un hoyo, lo rellena; en el suelo, hace un montón).', full: undefined, empty: 'pala_hierro', hide: true };
// Ropa y mochila: se llevan puestas en un hueco del cuerpo (wear). Cada prenda lleva su color (en la casilla
// de la mochila o en el hueco); dye es el de las que se fabrican.
export const WEAR_SLOTS = [
  ['cabeza', 'Cabeza'], ['pelo', 'Pelo'], ['torso', 'Torso'], ['encima', 'Encima'], ['piernas', 'Piernas'], ['pies', 'Pies'],
  ['interiorArriba', 'Interior arriba'], ['interiorAbajo', 'Interior abajo'], ['calcetines', 'Calcetines'], ['espalda', 'Espalda'],
];
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
export const CHESTS = { cofre: [18, 'el cofre'], armario: [27, 'el armario'], mochila: [27, 'la mochila'], mesita: [9, 'la mesita'], comoda: [18, 'la cómoda'] };
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
// Lo mismo, dicho en muslos («Quita 2,5 muslos de hambre»)
export const hungerText = def => { const n = hungerOf(def) / 2; return `Quita ${String(n).replace('.', ',')} muslo${n === 1 ? '' : 's'} de hambre.`; };

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
  fruit: { ...TREE, drops: [['madera', 3, 4], ['manzana', 2, 3]] },
  pine: { ...TREE, drops: [['madera', 3, 5], ['pina', 1, 1, 0.3]] },
  snowPine: { ...TREE, drops: [['madera', 3, 5], ['pina', 1, 1, 0.3]] },
  palm: { ...TREE, hits: 3, fruit: 'coco', drops: [['madera', 2, 3], ['coco', 2, 3]] },   // (fruit: lo que no suelta si se le acaba de coger)
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
export const TOOL_COST = { hacha: 1, pico: 1, guadana: 0.5, azada: 1, pala: 1, mano: 0.5, regadera: 0.5, cana: 0.5, red: 0.5 };
export const START_KIT = [['hacha_hierro', 1], ['pico_hierro', 1], ['guadana_hierro', 1], ['azada_hierro', 1], ['pala_hierro', 1], ['manzana', 3]];

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
