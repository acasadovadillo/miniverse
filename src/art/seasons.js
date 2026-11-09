// Las estaciones cambian el color del mundo: nombres de las estaciones y color del suelo de cada bioma.
import { rgbOf, mixHex } from '../util.js';
import { ARTE, onArte } from '../arte.js';

export const SEASONS = ['Primavera', 'Verano', 'Otoño', 'Invierno'];
// Paleta del suelo según la estación (solo cambia la hierba y la tierra; el agua y la nieve se quedan igual)
const GREENISH = new Set([3, 4, 5, 6]);   // pradera, bosque, pinos y pantano
const palCache = new Map();
// Hacia qué color va el suelo en verano, otoño (dos tonos) e invierno (la nieve y su sombra); con el arte nuevo, los de su paleta
const ART1 = { summer: '#b8b040', autumn: ['#a8903a', '#b8823a'], snow: ['#eef3f8', '#c8d8e6'], fall: 0.38 };
const ART2 = { summer: '#a89a50', autumn: ['#a0813f', '#97773c'], snow: ['#dfe4e6', '#c3cacc'], fall: 0.22 };   // (en otoño, menos: la hierba se quedaba beige)
onArte(() => palCache.clear());
export function seasonalPalette(biome, info, season) {
  if (season === 0 || season === 1 && !GREENISH.has(biome)) return info.rgb;
  const key = biome * 4 + season;
  if (palCache.has(key)) return palCache.get(key);
  let pal = info.pal;
  const T = ARTE === 2 ? ART2 : ART1;
  if (season === 1 && GREENISH.has(biome)) pal = pal.map(c => mixHex(c, T.summer, 0.12));
  else if (season === 2 && GREENISH.has(biome)) pal = pal.map((c, i) => mixHex(c, T.autumn[i % 2], T.fall));
  else if (season === 3 && (GREENISH.has(biome) || biome === 2 || biome === 9)) pal = pal.map((c, i) => mixHex(c, T.snow[i === 3 ? 1 : 0], 0.86));
  const rgb = pal.map(rgbOf);
  palCache.set(key, rgb);
  return rgb;
}
