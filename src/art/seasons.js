// Las estaciones cambian el color del mundo: nombres de las estaciones y color del suelo de cada bioma.
import { rgbOf, mixHex } from '../util.js';

export const SEASONS = ['Primavera', 'Verano', 'Otoño', 'Invierno'];
// Paleta del suelo según la estación (solo cambia la hierba y la tierra; el agua y la nieve se quedan igual)
const GREENISH = new Set([3, 4, 5, 6]);   // pradera, bosque, pinos y pantano
const palCache = new Map();
export function seasonalPalette(biome, info, season) {
  if (season === 0 || season === 1 && !GREENISH.has(biome)) return info.rgb;
  const key = biome * 4 + season;
  if (palCache.has(key)) return palCache.get(key);
  let pal = info.pal;
  if (season === 1 && GREENISH.has(biome)) pal = pal.map(c => mixHex(c, '#b8b040', 0.12));
  else if (season === 2 && GREENISH.has(biome)) pal = pal.map((c, i) => mixHex(c, i % 2 ? '#b8823a' : '#a8903a', 0.38));
  else if (season === 3 && (GREENISH.has(biome) || biome === 2 || biome === 9)) pal = pal.map((c, i) => mixHex(c, i === 3 ? '#c8d8e6' : '#eef3f8', 0.86));
  const rgb = pal.map(rgbOf);
  palCache.set(key, rgb);
  return rgb;
}
