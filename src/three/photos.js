// Las texturas de fotos del arte en revisión (?arte=2): fotos CC0 de ambientCG (ver assets/LICENCIAS.md) reducidas
// y sin su color propio, en assets/tex/ con un nombre que cambia con su contenido. Cada una guarda el dibujo de la foto
// con la media de cada canal en `mean` (de 0 a 255); `m` es lo que mide en el mundo, en metros (ancho, alto); `k`, si
// lo lleva, rebaja su contraste (la pizarra, de lejos, hacía ruido).
// textures.js las pinta encima de su lienzo de siempre cuando llegan, teñidas con el color medio de ese lienzo: hasta
// entonces, y si no llegan, se ve el lienzo pintado por código. Sin ?arte=2 no se descarga ninguna.
import { ARTE } from '../arte.js';

export const PHOTOS = {
  teja: { file: 'teja.eef90e8b.webp', mean: 162, m: [2.9, 2.9] },   // RoofingTiles014B, 512×512
  pizarra: { file: 'pizarra.bbe84806.webp', mean: 135, m: [1.4, 1.4], k: 0.65 },   // RoofingTiles001, 512×512
  piedra: { file: 'piedra.460f689e.webp', mean: 149, m: [2.2, 1.1] },   // Bricks089, 512×256
  tablas: { file: 'tablas.c1ff4ef3.webp', mean: 191, m: [2.2, 2.2] },   // Wood080, 512×512
  entarimado: { file: 'entarimado.699f296d.webp', mean: 167, m: [2.0, 2.0] },   // Planks037A, 512×512
  madera: { file: 'madera.218ae3f9.webp', mean: 191, m: [1.0, 1.0] },   // Wood094, 256×256
  paja: { file: 'paja.3a2d004e.webp', mean: 191, m: [1.5, 1.5] },   // ThatchedRoof001A, 512×512
  grava: { file: 'grava.7b798147.webp', mean: 154, m: [1.6, 1.6] },   // Gravel043, 512×512
  losa: { file: 'losa.a8b61e47.webp', mean: 183, m: [2.3, 1.15] },   // Tiles130, 512×256
  corteza: { file: 'corteza.ad5cdfd8.webp', mean: 145, m: [1.0, 1.0] },   // Bark012, 512×512
  roca: { file: 'roca.c0f05b83.webp', mean: 136, m: [2.0, 2.0] },   // Rock030, 512×512
  hierba: { file: 'hierba.72d24a93.webp', mean: 183, m: [1.4, 1.4] },   // Grass004, 512×512
  tierra: { file: 'tierra.a7d15c50.webp', mean: 183, m: [2.0, 2.0] },   // Ground103, 512×512
  arena: { file: 'arena.9221d77b.webp', mean: 191, m: [2.0, 2.0] },   // Ground080, 512×512
};
const LOADS = new Map();
// La foto de una clave, cuando llegue (o null si falla); null en seguida si no hay que usarla
export function photo(key) {
  const p = PHOTOS[key];
  if (ARTE !== 2 || !p || typeof document === 'undefined') return null;
  if (!LOADS.has(key)) LOADS.set(key, new Promise(res => {
    const img = new Image();
    img.onload = () => res(img); img.onerror = () => { console.warn(`No ha llegado la textura ${p.file}: se queda la pintada`); res(null); };
    img.src = new URL(`../../assets/tex/${p.file}`, import.meta.url).href;
  }));
  return LOADS.get(key);
}
