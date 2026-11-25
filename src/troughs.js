// The drinking trough's numbers (Plan R4-2, horsecare.js): alone in a file so the world's content (world/scenes.js, also in the
// workers) can read them without the rest. d.trough[k]: the drinks it holds, in the chunk, synced tile by tile
export const TROUGH_MAX = 10;
export const troughModel = n => `trough:${!(n > 0) ? 0 : n <= 3 ? 1 : n <= 7 ? 2 : 3}`;
