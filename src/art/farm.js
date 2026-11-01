// Sprites del huerto y la granja: cultivos en cada fase, arbolitos recién plantados y animales.
import { mk, ramp, ellipse, blob, line, outlined } from '../util.js';
import { CROPS } from '../items.js';

const cache = new Map();
const once = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };

// Cultivo: lienzo 32×44, apoyo en (16, 38). stage: 0 semilla … 3 listo; -1 seco
export const CROP_AX = 16, CROP_AY = 38;
export function cropSprite(id, stage) {
  return once(`c:${id}:${stage}`, () => {
    const c = mk(32, 44), g = c.getContext('2d'), crop = CROPS[id], lf = ramp(crop?.leaf || '#5aa842');
    const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    const X = CROP_AX, Y = CROP_AY;
    if (stage < 0) {   // seco
      R(X - 1, Y - 8, 2, 8, '#8a6a3a'); R(X - 5, Y - 6, 4, 1, '#a8864a'); R(X + 1, Y - 9, 4, 1, '#a8864a');
      return outlined(c);
    }
    if (stage === 0) { for (const [dx, dy] of [[-4, -1], [2, 0], [-1, 2], [4, 2]]) R(X + dx, Y + dy - 2, 2, 1, '#e8d8a0'); return c; }
    if (stage === 1) { R(X, Y - 5, 1, 5, lf.d); R(X - 3, Y - 6, 3, 2, lf.b); R(X + 1, Y - 7, 3, 2, lf.l); return outlined(c); }
    const tall = id === 'maiz' ? 26 : id === 'trigo' ? 16 : id === 'tomate' ? 20 : 10;
    const h = stage === 2 ? Math.round(tall * 0.6) : tall;
    if (id === 'maiz' || id === 'trigo') {
      for (const dx of id === 'trigo' ? [-5, -2, 1, 4] : [0]) {
        R(X + dx, Y - h, 2, h, lf.d);
        for (let k = 4; k < h; k += 5) { R(X + dx - 3, Y - k, 3, 1, lf.b); R(X + dx + 2, Y - k - 2, 3, 1, lf.l); }
        if (stage === 3) R(X + dx - (id === 'maiz' ? 1 : 0), Y - h - (id === 'maiz' ? -6 : 3), id === 'maiz' ? 3 : 2, id === 'maiz' ? 7 : 4, crop.color);
      }
      if (id === 'maiz' && stage === 3) R(X + 1, Y - h - 2, 1, 4, '#c8a040');
      return outlined(c);
    }
    if (id === 'tomate') { R(X + 3, Y - h - 2, 1, h + 2, '#a8864a'); }
    // Mata de hojas
    blob(g, X, Y - Math.round(h / 2) - 2, Math.round(h / 2) + 2, lf.d);
    blob(g, X - 1, Y - Math.round(h / 2) - 3, Math.round(h / 2), lf.b);
    blob(g, X - 3, Y - h + 1, 2, lf.l);
    if (stage === 3) {
      const col = crop.color;
      if (id === 'calabaza') { ellipse(g, X + 2, Y - 3, 7, 4, ramp(col).d); ellipse(g, X + 1, Y - 4, 6, 3, col); R(X + 1, Y - 8, 2, 2, '#5a7a3a'); }
      else if (id === 'nabo' || id === 'zanahoria') { ellipse(g, X, Y - 1, 4, 2, col); R(X - 2, Y - 2, 2, 1, '#ffffff'); }
      else for (const [dx, dy] of [[-4, -4], [2, -7], [-1, -10], [4, -3], [0, -5]]) { R(X + dx, Y + dy - (id === 'tomate' ? 6 : 0), 3, 3, col); R(X + dx, Y + dy - (id === 'tomate' ? 6 : 0), 1, 1, '#ffffff'); }
    }
    return outlined(c);
  });
}

// Arbolito recién plantado (mismo apoyo que los árboles: 72×96 con base en 36,91)
export function saplingSprite(kind) {
  return once('s:' + kind, () => {
    const c = mk(72, 96), g = c.getContext('2d'), leaf = ramp(kind === 'pine' ? '#3f7a44' : '#5aa842');
    g.fillStyle = '#7a5232'; g.fillRect(35, 74, 2, 17);
    if (kind === 'pine') { for (let k = 0; k < 3; k++) { const w = 9 - k * 3; g.fillStyle = k % 2 ? leaf.b : leaf.d; g.fillRect(36 - w, 78 - k * 5, w * 2, 4); } }
    else { blob(g, 36, 72, 7, leaf.d); blob(g, 35, 71, 5, leaf.b); blob(g, 33, 69, 2, leaf.l); if (kind === 'fruit') { g.fillStyle = '#ff9ab8'; g.fillRect(31, 70, 2, 2); g.fillRect(38, 68, 2, 2); } }
    return outlined(c);
  });
}

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
