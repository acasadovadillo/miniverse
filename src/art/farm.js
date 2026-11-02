// Animales de la granja: sus datos y su dibujo de lado (el icono de la tienda).
import { mk, ellipse, blob, outlined } from '../util.js';

const cache = new Map();
const once = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };

// Animales: de granja (viven en su casa, home, y dan su producto cada `every` días; los muy felices, a veces,
// `special`; `also`: algo más, con su probabilidad), el caballo (se monta), las mascotas (siguen a su dueño)
// y los salvajes (solo pasean por el mundo). baby: cómo se llama la cría; breeds: sus razas o pelajes.
// w y h: el tamaño del dibujo de lado para la tienda, mirando a la derecha.
export const ANIMALS = {
  gallina: { name: 'Gallina', w: 16, h: 16, product: 'huevo', every: 1, verb: 'Recoger el huevo', home: 'gallinero', bird: true, special: 'huevo_oro', baby: 'pollito', breeds: ['blanca', 'parda', 'negra', 'dorada', 'gallo'], names: ['Pepa', 'Turuleta', 'Clotilde', 'Pío', 'Plumas', 'Cocó', 'Canela', 'Gertru'] },
  pato: { name: 'Pato', w: 18, h: 16, product: 'huevo_pato', every: 2, verb: 'Recoger el huevo', home: 'gallinero', bird: true, special: 'huevo_oro', also: ['plumas', 0.5], baby: 'patito', breeds: ['blanco', 'real'], names: ['Cuac', 'Lucas', 'Patricia', 'Chapuzón', 'Remo', 'Pata'] },
  vaca: { name: 'Vaca', w: 30, h: 24, product: 'leche', every: 1, verb: 'Ordeñar', home: 'establo', special: 'nata', baby: 'ternero', breeds: ['pinta', 'parda'], names: ['Margarita', 'Lechera', 'Manchas', 'Paca', 'Rosita', 'Lola'] },
  oveja: { name: 'Oveja', w: 26, h: 22, product: 'lana', every: 3, verb: 'Esquilar', home: 'establo', special: 'lana_fina', baby: 'cordero', breeds: ['blanca', 'negra'], names: ['Nube', 'Algodón', 'Dolly', 'Bea', 'Copito', 'Rizos'] },
  cabra: { name: 'Cabra', w: 24, h: 22, product: 'leche_cabra', every: 1, verb: 'Ordeñar', home: 'establo', special: 'nata', baby: 'cabrito', breeds: ['blanca', 'parda', 'negra'], names: ['Heidi', 'Barbas', 'Saltarina', 'Tozuda', 'Blanquita', 'Rumi'] },
  cerdo: { name: 'Cerdo', w: 24, h: 18, product: 'trufa', every: 1, verb: 'Coger la trufa que ha encontrado', home: 'establo', truffle: true, baby: 'cerdito', breeds: ['rosa', 'manchado'], names: ['Bellota', 'Jamón', 'Rosita', 'Trufo', 'Barro', 'Pancho'] },
  conejo: { name: 'Conejo', w: 16, h: 16, product: 'angora', every: 3, verb: 'Cepillar el pelo', home: 'conejera', special: 'lana_fina', baby: 'gazapo', breeds: ['blanco', 'gris', 'marron'], names: ['Tambor', 'Copo', 'Orejas', 'Saltitos', 'Bigotes', 'Lucero'] },
  caballo: { name: 'Caballo', w: 30, h: 26, home: 'cuadra', ride: true, baby: 'potro', grow: 7, breeds: ['castano', 'negro', 'blanco', 'tordo', 'pio', 'palomino'], names: ['Rayo', 'Canela', 'Lucero', 'Trueno', 'Estrella', 'Brisa'] },
  perro: { name: 'Perro', home: 'caseta', pet: true, breeds: ['canela', 'negro', 'manchado', 'gris'], names: ['Toby', 'Luna', 'Rocky', 'Kira', 'Coco', 'Nala'] },
  gato: { name: 'Gato', home: 'cojin', pet: true, breeds: ['naranja', 'gris', 'negro', 'blanco', 'tricolor'], names: ['Misi', 'Tigre', 'Pelusa', 'Garfio', 'Nieve', 'Sombra'] },
  ciervo: { name: 'Ciervo', wild: true },
  jabali: { name: 'Jabalí', wild: true },
  cisne: { name: 'Cisne', wild: true, swims: true },
};
// Cómo se llama un pelaje o una raza, para enseñarlo
export const BREED_NAMES = {
  blanca: 'blanca', parda: 'parda', negra: 'negra', dorada: 'dorada', gallo: 'gallo', blanco: 'blanco', real: 'real', pinta: 'pinta', rosa: 'rosa', manchado: 'manchado',
  gris: 'gris', marron: 'marrón', castano: 'castaño', negro: 'negro', tordo: 'tordo', pio: 'pío', palomino: 'palomino', canela: 'canela', naranja: 'naranja', tricolor: 'tricolor',
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
    } else if (type === 'pato') {
      R(5, 12, 1, 3 - leg, '#f0a020'); R(9, 12, 1, 2 + leg, '#f0a020');
      ellipse(g, 8, 10, 7, 4, '#f4f0e8'); R(1, 7, 3, 3, '#f4f0e8');
      R(12, 3, 4, 6, '#3a8a4a'); R(15, 6, 3, 2, '#f0a020'); R(14, 4, 1, 1, '#1a1a1a'); R(12, 9, 4, 1, '#f4f0e8'); R(6, 9, 5, 2, '#e0d8c8');
    } else if (type === 'conejo') {
      ellipse(g, 7, 11, 6, 4, '#f2eee8'); ellipse(g, 12, 8, 3, 3, '#f2eee8'); R(11, 1, 2, 6, '#f2eee8'); R(13, 1, 2, 6, '#e8d8d8');
      R(13, 8, 1, 1, '#c8404a'); R(1, 9, 3, 3, '#ffffff'); R(3, 14, 3, 1 + leg, '#e8e0d8'); R(9, 14, 3, 1, '#e8e0d8');
    } else if (type === 'cabra') {
      for (const [x, d] of [[4, leg], [8, -leg], [15, -leg], [19, leg]]) R(x, 14, 2, 7 + d, '#8a7a6a');
      R(2, 6, 19, 9, '#e8e2d8'); R(19, 2, 5, 8, '#e8e2d8'); R(22, 6, 2, 2, '#c8b8a8'); R(21, 4, 1, 1, '#2a1c22');
      R(19, 0, 1, 3, '#a89878'); R(22, 0, 1, 3, '#a89878'); R(21, 10, 2, 3, '#e8e2d8'); R(1, 5, 2, 3, '#e8e2d8');
    } else if (type === 'cerdo') {
      for (const [x, d] of [[5, leg], [9, -leg], [15, -leg], [19, leg]]) R(x, 13, 2, 4 + d, '#e89a9a');
      ellipse(g, 11, 9, 10, 5, '#f4b0b0'); R(19, 6, 5, 6, '#f4b0b0'); R(22, 8, 2, 3, '#e08a8a'); R(20, 7, 1, 1, '#2a1c22');
      R(18, 4, 2, 2, '#e89a9a'); R(1, 7, 2, 2, '#e89a9a');
    } else if (type === 'caballo') {
      for (const [x, d] of [[5, leg], [9, -leg], [19, -leg], [23, leg]]) R(x, 14, 2, 10 + d, '#7a4e2c');
      R(3, 7, 22, 9, '#8a5a34'); R(22, 1, 5, 9, '#8a5a34'); R(25, 3, 4, 5, '#8a5a34'); R(26, 3, 1, 1, '#1a1a1a');
      R(21, 0, 2, 9, '#2a1e16'); R(0, 7, 3, 8, '#2a1e16'); R(11, 6, 7, 3, '#6a2a1e');
    } else {
      for (const [x, d] of [[5, leg], [9, -leg], [16, -leg], [20, leg]]) R(x, 14, 2, 6 + d, '#3a3a3e');
      for (const [x, y] of [[4, 6], [9, 4], [14, 4], [19, 6], [6, 11], [12, 11], [18, 10]]) blob(g, x + 1, y + 1, 4, '#f4f0e8');
      R(3, 5, 18, 8, '#f4f0e8');
      R(20, 4, 6, 7, '#3a3a3e'); R(23, 6, 1, 1, '#ffffff'); R(19, 4, 2, 2, '#f4f0e8');
    }
    return outlined(c);
  });
}
