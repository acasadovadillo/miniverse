// What is the village's and what is yours, for the maps (docs/planes/PLAN-pueblo-construido.md §4): the village land (where
// the village says no to digging and building: village.js villageLand) washed in ochre red, and the player's plot (PLOT) with a
// green edge. Everything else is free land. Made once per layout of the village (onVillageChange), never per frame.
//   landPicture()   { canvas (1 px per tile), x0, y0 } over the box round both: the minimap and the big map draw it scaled
//   landEdges()     { land, plot }: the edges of each as segments [x0, y0, x1, y1] (merged runs), for the 3D map's ribbons
//   landVersion()   goes up each time the village changes
//   drawLand(g, explored)   the picture, but only on explored chunks, with g's transform at its corner (x0, y0) and 1 per tile
import { BOUNDS, PLOT, villageLand, inPlot, onVillageChange } from '../world/village.js';
import { CHUNK } from '../world/gen.js';
import { wrapIndex } from '../world/planet.js';

export const LAND_RGB = [208, 96, 58], PLOT_RGB = [65, 198, 168];
let pic = null, edges = null, v = 0, box = null;
onVillageChange(() => { pic = null; edges = null; box = null; v++; });
export const landVersion = () => v;

// The box of tiles both cover, and which tiles are which (1: village land, 2: the plot)
function grid() {
  if (box) return box;
  let x0 = BOUNDS.x0, y0 = BOUNDS.y0, x1 = BOUNDS.x1, y1 = BOUNDS.y1;
  for (const r of PLOT) { x0 = Math.min(x0, r.x0); y0 = Math.min(y0, r.y0); x1 = Math.max(x1, r.x1); y1 = Math.max(y1, r.y1); }
  x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.ceil(x1); y1 = Math.ceil(y1);
  const w = x1 - x0, h = y1 - y0, kind = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const tx = x0 + i, ty = y0 + j; kind[j * w + i] = inPlot(tx, ty) ? 2 : villageLand(tx, ty) ? 1 : 0; }
  return (box = { x0, y0, w, h, kind });
}
// What a tile is, from the same grid: 1 village land, 2 your plot, 0 free (or out of the box)
export function landAt(tx, ty) { const B = grid(), i = tx - B.x0, j = ty - B.y0; return i < 0 || j < 0 || i >= B.w || j >= B.h ? 0 : B.kind[j * B.w + i]; }
export function landPicture() {
  if (pic) return pic;
  const B = grid(), c = document.createElement('canvas');
  c.width = B.w; c.height = B.h;
  const g = c.getContext('2d'), img = g.createImageData(B.w, B.h), d = img.data;
  const at = (i, j) => (i < 0 || j < 0 || i >= B.w || j >= B.h ? 0 : B.kind[j * B.w + i]);
  for (let j = 0; j < B.h; j++) for (let i = 0; i < B.w; i++) {
    const k = at(i, j), o = (j * B.w + i) * 4;
    if (k === 1) { d[o] = LAND_RGB[0]; d[o + 1] = LAND_RGB[1]; d[o + 2] = LAND_RGB[2]; d[o + 3] = 105; }
    else if (k === 2) {
      // (the plot: its edge strong, inside a faint green)
      const edge = at(i + 1, j) !== 2 || at(i - 1, j) !== 2 || at(i, j + 1) !== 2 || at(i, j - 1) !== 2;
      d[o] = PLOT_RGB[0]; d[o + 1] = PLOT_RGB[1]; d[o + 2] = PLOT_RGB[2]; d[o + 3] = edge ? 225 : 34;
    }
  }
  g.putImageData(img, 0, 0);
  return (pic = { canvas: c, x0: B.x0, y0: B.y0, w: B.w, h: B.h });
}
// The edges between a kind and the rest, as horizontal and vertical runs
export function landEdges() {
  if (edges) return edges;
  const B = grid(), at = (i, j) => (i < 0 || j < 0 || i >= B.w || j >= B.h ? 0 : B.kind[j * B.w + i]);
  const runs = k => {
    const out = [];
    // (horizontal edges: between rows j-1 and j; vertical: between columns i-1 and i)
    for (let j = 0; j <= B.h; j++) { let s = null; for (let i = 0; i <= B.w; i++) { const e = i < B.w && (at(i, j) === k) !== (at(i, j - 1) === k); if (e && s === null) s = i; if (!e && s !== null) { out.push([B.x0 + s, B.y0 + j, B.x0 + i, B.y0 + j]); s = null; } } }
    for (let i = 0; i <= B.w; i++) { let s = null; for (let j = 0; j <= B.h; j++) { const e = j < B.h && (at(i, j) === k) !== (at(i - 1, j) === k); if (e && s === null) s = j; if (!e && s !== null) { out.push([B.x0 + i, B.y0 + s, B.x0 + i, B.y0 + j]); s = null; } } }
    return out;
  };
  return (edges = { land: runs(1), plot: runs(2) });
}
export function drawLand(g, explored) {
  const L = landPicture();
  g.imageSmoothingEnabled = false;
  for (let cy = Math.floor(L.y0 / CHUNK); cy * CHUNK < L.y0 + L.h; cy++) for (let cx = Math.floor(L.x0 / CHUNK); cx * CHUNK < L.x0 + L.w; cx++) {
    if (!explored?.has(`${wrapIndex(cx, CHUNK)},${cy}`)) continue;
    const sx = Math.max(0, cx * CHUNK - L.x0), sy = Math.max(0, cy * CHUNK - L.y0), ex = Math.min(L.w, (cx + 1) * CHUNK - L.x0), ey = Math.min(L.h, (cy + 1) * CHUNK - L.y0);
    if (ex > sx && ey > sy) g.drawImage(L.canvas, sx, sy, ex - sx, ey - sy, sx, sy, ex - sx, ey - sy);
  }
  g.imageSmoothingEnabled = true;
}
