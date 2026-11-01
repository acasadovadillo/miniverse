// Piezas de construcción: no son objetos de la mochila, se pagan con materiales al ponerlas
// y devuelven esos materiales al quitarlas. Cada casilla tiene tres capas: suelo, objeto y tejado.
export const PIECES = {
  suelo_madera: { name: 'Suelo de madera', cat: 'Suelos', layer: 'floor', cost: [['tablas', 1]] },
  suelo_piedra: { name: 'Suelo de piedra', cat: 'Suelos', layer: 'floor', cost: [['piedra', 2]] },
  camino: { name: 'Camino de grava', cat: 'Suelos', layer: 'floor', cost: [['piedra', 1]] },
  muro_madera: { name: 'Muro de madera', cat: 'Muros', layer: 'placed', kind: 'wall', cost: [['tablas', 2]] },
  muro_piedra: { name: 'Muro de piedra', cat: 'Muros', layer: 'placed', kind: 'wall', cost: [['piedra', 3]] },
  muro_entramado: { name: 'Muro de entramado', cat: 'Muros', layer: 'placed', kind: 'wall', cost: [['tablas', 2], ['piedra', 1]] },
  ventana: { name: 'Ventana', cat: 'Muros', layer: 'placed', kind: 'wall', cost: [['tablas', 3]] },
  ventana_contraventanas: { name: 'Ventana con contraventanas', cat: 'Muros', layer: 'placed', kind: 'wall', cost: [['tablas', 3], ['piedra', 1]] },
  muro_cuadro: { name: 'Muro con cuadro', cat: 'Muros', layer: 'placed', kind: 'wall', cost: [['tablas', 2], ['tela', 1]] },
  puerta: { name: 'Puerta', cat: 'Muros', layer: 'placed', kind: 'door', cost: [['tablas', 3]] },
  tejado_rojo: { name: 'Tejado rojo', cat: 'Tejados', layer: 'roof', cost: [['tablas', 1], ['piedra', 1]] },
  tejado_azul: { name: 'Tejado azul', cat: 'Tejados', layer: 'roof', cost: [['tablas', 1], ['piedra', 1]] },
  tejado_paja: { name: 'Tejado de paja', cat: 'Tejados', layer: 'roof', cost: [['fibra', 3]] },
  tejado_gris: { name: 'Tejado de pizarra', cat: 'Tejados', layer: 'roof', cost: [['tablas', 1], ['piedra', 1]] },
  tejado_verde: { name: 'Tejado verde', cat: 'Tejados', layer: 'roof', cost: [['tablas', 1], ['piedra', 1]] },
  valla: { name: 'Valla de madera', cat: 'Vallas', layer: 'placed', kind: 'fence', cost: [['tablas', 1]] },
  valla_piedra: { name: 'Murete de piedra', cat: 'Vallas', layer: 'placed', kind: 'fence', cost: [['piedra', 2]] },
  // El hogar da luz y calor; si hay tejado encima, el tejado dibuja su chimenea
  chimenea: { name: 'Hogar con chimenea', cat: 'Casa', layer: 'placed', kind: 'hearth', cost: [['piedra', 8]] },
};
export const CATS = ['Suelos', 'Muros', 'Tejados', 'Vallas', 'Casa'];

// Capa de una cosa colocable: las piezas dicen la suya; los objetos de la mochila van en la de objetos
export const layerOf = id => PIECES[id]?.layer || 'placed';
// "silla@1" → ['silla', 1] (el número es el giro)
export const parsePlaced = raw => { const i = raw.indexOf('@'); return i < 0 ? [raw, 0] : [raw.slice(0, i), +raw.slice(i + 1)]; };
