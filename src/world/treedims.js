// Las medidas de los árboles, en un solo sitio y sin Three (vale también en los hilos): la edad de cada árbol por su
// sitio, su tamaño (k) y lo que sale de él (alto, copa, tronco). Las usan el árbol de cerca (three/nature3d.js), el
// lejano (three/impostor.js: lo escala con k para que mida lo mismo que el de cerca) y quien necesite saber dónde está
// la copa. Si cada uno copiara las fórmulas, al cambiar una dejarían de cuadrar.
import { ihash } from '../util.js';

// La edad del árbol, por su sitio (igual en todas las pantallas): 15 % maduro, 55 % medio, 30 % joven
export const ageOf = (o) => o.age ?? (h => (h < 0.15 ? 1.25 : h < 0.7 ? 1 : 0.75))(ihash(Math.floor(o.x * 5), Math.floor(o.y * 5), 77));
// El tamaño de un árbol (roble, frutal, sauce, pino, palmera o cactus): ±10 % por su sitio, por la edad
export const treeK = (o) => (0.9 + ihash(Math.floor(o.x * 7), Math.floor(o.y * 7), 11) * 0.2) * ageOf(o);
// Las medidas de un árbol de hoja: altura, radio de la copa y altura de su centro (con el suelo a la altura y)
export function broadDims(o, y) {
  const k = treeK(o), kind = o.kind;
  const H = (kind === 'fruit' ? 3.6 : kind === 'swampTree' ? 4.6 : 4.8) * k, R = (kind === 'fruit' ? 1.45 : kind === 'swampTree' ? 1.75 : 1.85) * k;
  return { k, H, R, Ry: R * 0.82, cy: y + H - R * 0.82, th: H * (kind === 'fruit' ? 0.3 : 0.36) };
}
// Las de un pino, una palmera y un cactus
export function pineDims(o) { const k = treeK(o); return { k, H: 5.6 * k, th: 0.8 * k }; }
export function palmDims(o) { const k = treeK(o); return { k, H: 4.6 * k }; }
export const cactusK = (o) => treeK(o);
// El radio de la copa vista desde arriba (para la sombra de contacto, world/contact.js): lo que mide el árbol de cerca.
// El sauce cuelga más ancho que su copa (willow2: 2,1 k); el pino, su piso de abajo (1,25 k) con algo de margen
export function canopyOf(o) {
  const kind = o.kind || o.nature, k = treeK(o);
  return kind === 'oak' ? 1.85 * k : kind === 'fruit' ? 1.45 * k : kind === 'swampTree' ? 2.1 * k
    : kind === 'pine' || kind === 'snowPine' ? 1.3 * k : kind === 'palm' ? 1.6 * k : 0;
}
