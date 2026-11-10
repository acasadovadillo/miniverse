// Materiales que se comparten pintando cada pieza con su color por vértice: así, lo de un trozo que es de
// madera (vigas, marcos, muebles…), de piedra, de color liso o de metal va en una sola malla por material,
// en vez de una por cada color (muchas menos llamadas de dibujo).
import * as THREE from 'three';
import { mat } from './geo.js';
import { wood, stone } from './textures.js';
import { sobrio } from '../arte.js';

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
// Clave de material → [material compartido, color]: la paleta sobria (madera gastada, piedra y cal apagadas, la paja y
// la tela sin chillar; el color lo ponen los postigos, de verdín)
const WOOD = c => ['woodT', c], STONE = c => ['stoneT', c], PAINT = c => ['paint', c], FLAT = c => ['paintFlat', c], METAL = c => ['metal', c];
const TINT = {
  // piezas de construcción
  stone: STONE('#958f84'), wallStone: STONE('#9d968a'), fenceStone: STONE('#8a857b'),
  timber: WOOD('#5f4e3e'), frame: WOOD('#4f4438'), shutter: WOOD('#3f7f5a'), door: WOOD('#7d5e46'), box: WOOD('#76604a'), fence: WOOD('#857058'), roofEdge: WOOD('#4f4438'),
  soil: PAINT('#4f4538'),
  // modelos
  wood: WOOD('#82694f'), dark: WOOD('#5f4e3e'), light: WOOD('#a58c6c'), hull: WOOD('#6a5642'),
  brick: STONE('#9c6e5c'), ruin: STONE('#a8a194'), temple: STONE('#bab09a'), templeD: STONE('#7c7468'), rock: STONE('#7f7b71'),
  soot: PAINT('#2a2220'), sheet: PAINT('#e0dacd'), quilt: PAINT('#a85a4c'), quiltB: PAINT('#c8a660'), cloth: PAINT('#d6cfc0'), pot: PAINT('#a0664a'),
  leaf: FLAT('#5d6d42'), leafD: FLAT('#46553a'), moss: FLAT('#5a6a40'), candle: PAINT('#fff4dc'), red: PAINT('#a8483e'), white: PAINT('#dcd7cc'),
  straw: PAINT('#b8a070'), hay: PAINT('#b39b68'), rope: PAINT('#a8946e'), sand: PAINT('#b1a27f'), snow: PAINT('#dfe4e6'), dark0: PAINT('#0a0806'),
  stripeR: PAINT('#a8483e'), bee: PAINT('#e8c040'), awningB: null, dry: PAINT('#857050'),
  iron: METAL('#4f5254'), brass: METAL('#a08850'), gold: METAL('#f0c840'), copper: METAL('#a8704a'), steel: METAL('#8a929a'),
};
const BOOKS = ['#a83a32', '#3a5aa0', '#3f8a44', '#d8a83a', '#7a4aa0', '#e0e0d0'];
// [material compartido, color] de una clave, o null si va con su propio material
export function tintOf(key) {
  if (key in TINT) return TINT[key];
  if (key.startsWith('books')) return PAINT(sobrio(BOOKS[+key.slice(5)]));
  if (key.startsWith('fruit:')) return PAINT(sobrio(key.slice(6)));   // (los frutos, algo apagados)
  if (key.startsWith('leafc:')) return ['paintDouble', sobrio(key.slice(6))];
  return null;
}
