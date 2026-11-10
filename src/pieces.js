// Piezas de construcción: no son objetos de la mochila, se pagan con materiales al ponerlas
// y devuelven esos materiales al quitarlas. needs: la estación que hay que tener cerca para ponerlas (lo de madera, el
// banco de carpintero; los tejados de teja y de pizarra, el horno, donde se cuecen: ver build.js, stationFor). Cada casilla tiene tres capas: suelo, objeto y tejado (y los cuadros,
// colgados, la suya).
import { ITEMS } from './items.js';

export const PIECES = {
  suelo_madera: { name: 'Suelo de madera', cat: 'Suelos', layer: 'floor', cost: [['tablas', 1]], needs: 'banco' },
  suelo_piedra: { name: 'Suelo de piedra', cat: 'Suelos', layer: 'floor', cost: [['piedra', 2]] },
  camino: { name: 'Camino de grava', cat: 'Suelos', layer: 'floor', cost: [['piedra', 1]] },
  muro_madera: { name: 'Muro de madera', cat: 'Muros', layer: 'placed', kind: 'wall', cost: [['tablas', 2]], needs: 'banco' },
  muro_piedra: { name: 'Muro de piedra', cat: 'Muros', layer: 'placed', kind: 'wall', cost: [['piedra', 3]] },
  muro_entramado: { name: 'Muro de entramado', cat: 'Muros', layer: 'placed', kind: 'wall', cost: [['tablas', 2], ['piedra', 1]], needs: 'banco' },
  ventana: { name: 'Ventana', cat: 'Muros', layer: 'placed', kind: 'wall', cost: [['tablas', 3]], needs: 'banco' },
  ventana_contraventanas: { name: 'Ventana con contraventanas', cat: 'Muros', layer: 'placed', kind: 'wall', cost: [['tablas', 3], ['piedra', 1]], needs: 'banco' },
  muro_cuadro: { name: 'Muro con cuadro', cat: 'Muros', layer: 'placed', kind: 'wall', cost: [['tablas', 2], ['tela', 1]], needs: 'banco' },
  puerta: { name: 'Puerta', cat: 'Muros', layer: 'placed', kind: 'door', cost: [['tablas', 3]], needs: 'banco' },
  tejado_rojo: { name: 'Tejado rojo', cat: 'Tejados', layer: 'roof', cost: [['tablas', 1], ['piedra', 1]], needs: 'horno' },
  tejado_azul: { name: 'Tejado azul', cat: 'Tejados', layer: 'roof', cost: [['tablas', 1], ['piedra', 1]], needs: 'horno' },
  tejado_paja: { name: 'Tejado de paja', cat: 'Tejados', layer: 'roof', cost: [['fibra', 3]] },
  tejado_gris: { name: 'Tejado de pizarra', cat: 'Tejados', layer: 'roof', cost: [['tablas', 1], ['piedra', 1]], needs: 'horno' },
  tejado_verde: { name: 'Tejado verde', cat: 'Tejados', layer: 'roof', cost: [['tablas', 1], ['piedra', 1]], needs: 'horno' },
  // (las vallas y sus puertas fueron también objetos de la mochila; ya solo se construyen aquí)
  valla: { name: 'Valla de madera', cat: 'Vallas', layer: 'placed', kind: 'fence', cost: [['tablas', 1]], needs: 'banco' },
  puerta_valla: { name: 'Puerta de valla', cat: 'Vallas', layer: 'placed', kind: 'gate', cost: [['tablas', 3]], needs: 'banco' },
  valla_piedra: { name: 'Murete de piedra', cat: 'Vallas', layer: 'placed', kind: 'fence', cost: [['piedra', 2]] },
  // El hogar da luz y calor; si hay tejado encima, el tejado dibuja su chimenea. Es también un objeto (se fabrica
  // en el banco, se coloca girándolo y se recoge con X), así que no sale en la paleta de construir
  chimenea: { name: 'Hogar con chimenea', cat: 'Casa', layer: 'placed', kind: 'hearth', cost: [['piedra', 8]] },
};
export const CATS = ['Suelos', 'Muros', 'Tejados', 'Vallas'];   // (el hogar, de la casa, se fabrica en el banco)

// Capa de una cosa colocable: las piezas dicen la suya; los objetos de la mochila van en la de objetos
// (los cuadros van en su propia capa, colgados del muro: debajo puede haber un mueble)
// (y las alfombras, en la suya, en el suelo: encima puede haber un mueble)
export const layerOf = id => PIECES[id]?.layer || ({ wall: 'hang', rug: 'rug' })[ITEMS[id]?.place] || 'placed';
// "silla@1" → ['silla', 1] (el número es el giro)
export const parsePlaced = raw => { const i = raw.indexOf('@'); return i < 0 ? [raw, 0] : [raw.slice(0, i), +raw.slice(i + 1)]; };
