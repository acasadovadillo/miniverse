// La forma de un tejado, sin nada de dibujo: la altura (en niveles) en cualquier punto de una región de tejado. La usan
// el dibujo (three/build3d.js), la cámara (three/world3d.js, para pasar por encima) y el apuntar al construir
// (world/scenes.js), así que los tres coinciden.
//
// A cuatro aguas: la altura sale de la distancia (métrica del máximo) al borde de la región, con las limas a 45°.
// Una región rectangular de al menos 2 × 2 va a dos aguas: la cumbrera a lo largo del lado
// largo, y en los lados cortos, hastiales.
export const ROOF_CAP = 6;   // como mucho, 6 niveles: más adentro, el tejado es plano

// Distancia de un punto al borde de la región (los lados sin tejado al otro lado, como [x0, y0, x1, y1])
export function edgeDistance(px, py, edges) {
  let best = Infinity;
  for (const e of edges) { const d = Math.max(Math.max(e[0] - px, 0, px - e[2]), Math.max(e[1] - py, 0, py - e[3])); if (d < best) best = d; }
  return best;
}
export function regionEdges(tiles, has) {
  const edges = [];
  for (const [x, y] of tiles) {
    if (!has(x, y - 1)) edges.push([x, y, x + 1, y]);
    if (!has(x, y + 1)) edges.push([x, y + 1, x + 1, y + 1]);
    if (!has(x - 1, y)) edges.push([x, y, x, y + 1]);
    if (!has(x + 1, y)) edges.push([x + 1, y, x + 1, y + 1]);
  }
  return edges;
}
// La forma de una región: { gable, alongX (la cumbrera va a lo largo de x), x0, y0, x1, y1, has, H(x, y) }
export function roofShape(tiles, has = null) {
  if (!has) { const set = new Set(tiles.map(([x, y]) => `${x},${y}`)); has = (x, y) => set.has(`${x},${y}`); }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of tiles) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); }
  const w = x1 - x0, h = y1 - y0;
  if (w >= 2 && h >= 2 && tiles.length === w * h) {
    const alongX = w >= h;
    const H = alongX ? (px, py) => Math.max(0, Math.min(py - y0, y1 - py, ROOF_CAP)) : (px, py) => Math.max(0, Math.min(px - x0, x1 - px, ROOF_CAP));
    return { gable: true, alongX, x0, y0, x1, y1, has, H };
  }
  const edges = regionEdges(tiles, has);
  return { gable: false, x0, y0, x1, y1, has, edges, H: (px, py) => Math.min(edgeDistance(px, py, edges), ROOF_CAP) };
}
