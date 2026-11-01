// Animales de la granja: sus datos y su dibujo de lado (el icono de la tienda).
import { mk, ellipse, blob, outlined } from '../util.js';

const cache = new Map();
const once = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };

// Animales vistos de lado, mirando a la derecha. Dos fotogramas (patas). Apoyo: centro de las patas.
export const ANIMALS = {
  gallina: { name: 'Gallina', w: 16, h: 16, product: 'huevo', every: 1, verb: 'Recoger el huevo', names: ['Pepa', 'Turuleta', 'Clotilde', 'Pío', 'Plumas', 'Cocó'] },
  vaca: { name: 'Vaca', w: 30, h: 24, product: 'leche', every: 1, verb: 'Ordeñar', names: ['Margarita', 'Lechera', 'Manchas', 'Paca', 'Rosita'] },
  oveja: { name: 'Oveja', w: 26, h: 22, product: 'lana', every: 3, verb: 'Esquilar', names: ['Nube', 'Algodón', 'Dolly', 'Bea', 'Copito'] },
};
export function animalSprite(type, frame) {
  return once(`a:${type}:${frame}`, () => {
    const A = ANIMALS[type], c = mk(A.w + 2, A.h + 2), g = c.getContext('2d');
    const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x + 1, y + 1, w, h); };
    const leg = frame ? 1 : 0;
    if (type === 'gallina') {
      R(3, 11, 1, 4 - leg, '#e8a020'); R(7, 11, 1, 3 + leg, '#e8a020');
      ellipse(g, 7, 9, 6, 4, '#f4f0e8'); R(2, 6, 4, 3, '#f4f0e8');
      R(10, 3, 4, 5, '#f4f0e8'); R(13, 5, 2, 1, '#f0a020'); R(11, 1, 2, 2, '#e83a3a'); R(12, 4, 1, 1, '#2a1c22'); R(12, 7, 1, 2, '#e83a3a');
      R(5, 8, 4, 2, '#e0d8c8');
    } else if (type === 'vaca') {
      for (const [x, d] of [[4, leg], [8, -leg], [18, -leg], [22, leg]]) R(x, 15, 2, 7 + d, '#e8e0d8');
      R(2, 6, 22, 10, '#f4f0ec'); R(6, 7, 5, 4, '#2a2a2e'); R(15, 10, 6, 4, '#2a2a2e'); R(2, 6, 2, 3, '#2a2a2e');
      R(22, 3, 7, 8, '#f4f0ec'); R(26, 7, 4, 4, '#f0b0a8'); R(24, 5, 1, 1, '#2a1c22'); R(22, 1, 2, 2, '#d8c8a8'); R(27, 1, 2, 2, '#d8c8a8');
      R(10, 16, 4, 2, '#f0b0a8'); R(1, 7, 1, 6, '#e8e0d8');
    } else {
      for (const [x, d] of [[5, leg], [9, -leg], [16, -leg], [20, leg]]) R(x, 14, 2, 6 + d, '#3a3a3e');
      for (const [x, y] of [[4, 6], [9, 4], [14, 4], [19, 6], [6, 11], [12, 11], [18, 10]]) blob(g, x + 1, y + 1, 4, '#f4f0e8');
      R(3, 5, 18, 8, '#f4f0e8');
      R(20, 4, 6, 7, '#3a3a3e'); R(23, 6, 1, 1, '#ffffff'); R(19, 4, 2, 2, '#f4f0e8');
    }
    return outlined(c);
  });
}
