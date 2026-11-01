// Materiales que se comparten pintando cada pieza con su color por vértice: así, lo de un trozo que es de
// madera (vigas, marcos, muebles…), de piedra, de color liso o de metal va en una sola malla por material,
// en vez de una por cada color (muchas menos llamadas de dibujo).
import * as THREE from 'three';
import { mat } from './geo.js';
import { wood, stone } from './textures.js';

let MATS;
export function tintMats() {
  return (MATS ||= {
    paint: mat({ vertexColors: true, roughness: 0.8 }),
    paintFlat: mat({ vertexColors: true, roughness: 0.9, flatShading: true }),
    paintDouble: mat({ vertexColors: true, roughness: 0.85, flatShading: true, side: THREE.DoubleSide }),
    metal: mat({ vertexColors: true, metalness: 0.6, roughness: 0.4 }),
    woodT: mat({ vertexColors: true, map: wood('#d4d4d4'), roughness: 0.75 }),
    stoneT: mat({ vertexColors: true, map: stone('#d0d0d0'), roughness: 0.9 }),
  });
}
// Clave de material → [material compartido, color]
const WOOD = c => ['woodT', c], STONE = c => ['stoneT', c], PAINT = c => ['paint', c], FLAT = c => ['paintFlat', c], METAL = c => ['metal', c];
const TINT = {
  // piezas de construcción
  stone: STONE('#a59e92'), wallStone: STONE('#b0a898'), fenceStone: STONE('#9a948a'),
  timber: WOOD('#5e3b22'), frame: WOOD('#4a2e1a'), shutter: WOOD('#3f7a44'), door: WOOD('#9a6438'), box: WOOD('#7a4a2a'), fence: WOOD('#9a6a40'), roofEdge: WOOD('#4a2e1a'),
  soil: PAINT('#4a3020'),
  // modelos
  wood: WOOD('#8a5a34'), dark: WOOD('#5e3b22'), light: WOOD('#b88454'), hull: WOOD('#6a4a30'),
  brick: STONE('#b0705a'), ruin: STONE('#b8b0a0'), temple: STONE('#c8bca0'), templeD: STONE('#8a8070'), rock: STONE('#8a857c'),
  soot: PAINT('#2a2220'), sheet: PAINT('#f4efe6'), quilt: PAINT('#d0574a'), quiltB: PAINT('#f0c25a'), cloth: PAINT('#e8e0d0'), pot: PAINT('#b8643c'),
  leaf: FLAT('#4f9a3a'), leafD: FLAT('#3f7a2e'), moss: FLAT('#5a7a3a'), candle: PAINT('#fff4dc'), red: PAINT('#c83a32'), white: PAINT('#f0ece4'),
  straw: PAINT('#e0c060'), hay: PAINT('#d8b860'), rope: PAINT('#c8a870'), sand: PAINT('#d8c08a'), snow: PAINT('#f4f8fc'), dark0: PAINT('#0a0806'),
  stripeR: PAINT('#c83a32'), bee: PAINT('#e8c040'), awningB: null, dry: PAINT('#8a6a3a'),
  iron: METAL('#3a3634'), brass: METAL('#c89a48'), gold: METAL('#f0c840'), copper: METAL('#c8743a'), steel: METAL('#8a929a'),
};
const BOOKS = ['#a83a32', '#3a5aa0', '#3f8a44', '#d8a83a', '#7a4aa0', '#e0e0d0'];
// [material compartido, color] de una clave, o null si va con su propio material
export function tintOf(key) {
  if (key in TINT) return TINT[key];
  if (key.startsWith('books')) return PAINT(BOOKS[+key.slice(5)]);
  if (key.startsWith('fruit:')) return PAINT(key.slice(6));
  if (key.startsWith('leafc:')) return ['paintDouble', key.slice(6)];
  return null;
}
