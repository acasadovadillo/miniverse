// Planos de casas hechas de piezas de construcción (las mismas que usa el jugador): la casa del pueblo,
// las de los vecinos y las de las aldeas lejanas. Un plano es lo que se coloca en cada casilla, por capas:
// suelo, objeto (muros, ventanas, puerta, hogar y muebles) y tejado.
//
// Casa pequeña (12×10) con el origen en la esquina de atrás (x0, y0); la puerta, en medio de la fila de
// delante (la que mira al jugador). Hay ventanas cada tres casillas en las cuatro paredes y un cuadro en la de atrás.
// Dentro (10×8): cama (de dos casillas), dos estanterías con una lámpara al lado, hogar y maceta contra la pared de atrás;
// mesa con dos sillas; alfombra, otra maceta, un candelabro colgado en medio y, en la tuya, un cofre. La casa grande (16×12) tiene el mismo reparto.

export const SMALL = { w: 12, h: 10 };
export const BIG = { w: 16, h: 12 };
export const FAMILY = { w: 18, h: 14 };
// size: false (pequeña), true (grande) o 'family' (la casa familiar)
export const houseSize = size => (size === 'family' ? FAMILY : size ? BIG : SMALL);
// Casilla de la puerta de una casa con el origen en (x0, y0)
export const doorTile = (x0, y0, size = false) => { const { w, h } = houseSize(size); return [x0 + Math.floor(w / 2), y0 + h - 1]; };

// La casa familiar (18×14): detrás, el dormitorio (6×5), el de los niños (5×5) y el baño (3×5), cada uno con su
// puerta; delante, la cocina y el salón, de una pieza, con el hogar contra la pared de los cuartos. Sin muebles:
// los fabrica y los pone el jugador.
export function familyBlueprint({ x0, y0, roof = 'tejado_rojo', wall = 'muro_entramado', inner = 'muro_madera', window = 'ventana_contraventanas' }) {
  const { w, h } = FAMILY, placed = {}, floor = {}, roofs = {}, k = (x, y) => `${x},${y}`;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { floor[k(x, y)] = 'suelo_madera'; roofs[k(x, y)] = roof; }
  const x1 = x0 + w - 1, y1 = y0 + h - 1, mid = y0 + 6, [dx, dy] = doorTile(x0, y0, 'family');
  for (let x = x0; x <= x1; x++) { placed[k(x, y0)] = wall; placed[k(x, y1)] = wall; placed[k(x, mid)] = inner; }
  for (let y = y0; y <= y1; y++) { placed[k(x0, y)] = wall; placed[k(x1, y)] = wall; }
  for (let y = y0 + 1; y < mid; y++) { placed[k(x0 + 7, y)] = inner; placed[k(x0 + 13, y)] = inner; }
  placed[k(x0, mid)] = placed[k(x1, mid)] = wall;
  for (const x of [x0 + 3, x0 + 11]) placed[k(x, y0)] = window;
  for (const y of [y0 + 3, y0 + 9]) { placed[k(x0, y)] = window; placed[k(x1, y)] = window; }
  for (const x of [x0 + 3, x0 + 6, x0 + 12, x0 + 15]) placed[k(x, y1)] = window;
  for (const x of [x0 + 4, x0 + 10, x0 + 15]) placed[k(x, mid)] = 'puerta';
  placed[k(dx, dy)] = 'puerta';
  placed[k(x0 + 11, mid + 1)] = 'chimenea';
  return { placed, floor, roof: roofs };
}

// furnish: 'full' (casa del jugador), 'npc' (vecinos y aldeas: sin cofre) o 'none'
// beds: 2, a second bed along the west wall (Rosa and Lía's house)
export function houseBlueprint({ x0, y0, big = false, roof = 'tejado_rojo', wall = 'muro_entramado', window = 'ventana_contraventanas', furnish = 'full', beds = 1 }) {
  const { w, h } = houseSize(big), placed = {}, floor = {}, roofs = {};
  const k = (x, y) => `${x},${y}`;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { floor[k(x, y)] = 'suelo_madera'; roofs[k(x, y)] = roof; }
  const x1 = x0 + w - 1, y1 = y0 + h - 1, [dx, dy] = doorTile(x0, y0, big), r = y0 + 1;
  // Anillo de muros
  for (let x = x0; x <= x1; x++) { placed[k(x, y0)] = wall; placed[k(x, y1)] = wall; }
  for (let y = y0; y <= y1; y++) { placed[k(x0, y)] = wall; placed[k(x1, y)] = wall; }
  // Ventanas cada tres casillas: delante, a los lados de la puerta; a los lados, desde atrás; detrás, menos
  // donde va el hogar (su chimenea pasa por ahí), y un cuadro
  for (let d = 3; dx - d > x0; d += 3) { placed[k(dx - d, y1)] = window; if (dx + d < x1) placed[k(dx + d, y1)] = window; }
  for (let y = y0 + 2; y < y1; y += 3) { placed[k(x0, y)] = window; placed[k(x1, y)] = window; }
  placed[k(dx, y0)] = window; placed[k(x0 + 3, y0)] = 'muro_cuadro'; placed[k(x1 - 1, y0)] = window;
  placed[k(dx, dy)] = 'puerta';
  // Dentro
  if (furnish !== 'none') {
    placed[k(x0 + 1, r)] = 'cama';
    placed[k(x0 + 5, r)] = 'lampara';
    placed[k(x0 + 3, r)] = 'estanteria';
    placed[k(x0 + 4, r)] = 'estanteria';
    placed[k(dx + 2, r)] = 'chimenea';
    placed[k(x1 - 1, r)] = 'maceta';
    placed[k(dx + 1, r + 3)] = 'silla@1';
    placed[k(dx + 2, r + 3)] = 'mesa';
    placed[k(dx + 3, r + 3)] = 'silla@3';   // (las dos sillas, mirando a la mesa: se meten debajo)
    placed[k(x0 + 3, r + 4)] = 'alfombra@2';   // (de 2×1)
    placed[k(x0 + 1, y1 - 1)] = 'maceta';
    if (beds > 1) placed[k(x0 + 1, y0 + 5)] = 'cama@1';
    if (furnish === 'full') placed[k(x0 + 1, r + 3)] = 'cofre';
    placed[k(x0 + Math.floor(w / 2) - 1, y0 + Math.floor(h / 2) - 1)] = 'candelabro';   // (colgado del techo, en medio)
  }
  return { placed, floor, roof: roofs };
}

// La taberna del pueblo (10×8): de madera, con tejado de paja y suelo de piedra, ventanas a los lados y delante, y la
// puerta en medio de la fila de delante. Al fondo, los barriles y la estantería, y Anselmo tras la barra; delante de la
// barra, los taburetes; y dos mesas con sus sillas, a los lados del paso desde la puerta.
export function tavernBlueprint({ x0, y0 }) {
  const w = 10, h = 8, placed = {}, floor = {}, roofs = {}, k = (x, y) => `${x},${y}`;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { floor[k(x, y)] = 'suelo_piedra'; roofs[k(x, y)] = 'tejado_paja'; }
  const x1 = x0 + w - 1, y1 = y0 + h - 1, dx = x0 + Math.floor(w / 2);
  for (let x = x0; x <= x1; x++) { placed[k(x, y0)] = 'muro_madera'; placed[k(x, y1)] = 'muro_madera'; }
  for (let y = y0; y <= y1; y++) { placed[k(x0, y)] = 'muro_madera'; placed[k(x1, y)] = 'muro_madera'; }
  for (const x of [x0 + 2, x1 - 2]) placed[k(x, y1)] = 'ventana';
  for (const y of [y0 + 2, y0 + 5]) { placed[k(x0, y)] = 'ventana'; placed[k(x1, y)] = 'ventana'; }
  placed[k(dx, y1)] = 'puerta';
  placed[k(x0 + 1, y0 + 1)] = 'barril'; placed[k(x0 + 2, y0 + 1)] = 'barril'; placed[k(x0 + 3, y0 + 1)] = 'estanteria';
  placed[k(x1 - 1, y0 + 1)] = 'lampara'; placed[k(x1 - 1, y1 - 1)] = 'lampara'; placed[k(x0 + 1, y1 - 1)] = 'maceta';
  for (let x = x0 + 1; x <= x0 + 6; x++) placed[k(x, y0 + 2)] = 'barra';
  for (const x of [x0 + 2, x0 + 4, x0 + 6]) placed[k(x, y0 + 3)] = 'taburete@2';
  for (const x of [x0 + 2, x1 - 2]) { placed[k(x, y0 + 5)] = 'mesa'; placed[k(x - 1, y0 + 5)] = 'silla@1'; placed[k(x + 1, y0 + 5)] = 'silla@3'; }
  placed[k(x1 - 1, y0 + 2)] = 'barber_chair@3';   // (Eusebio's barber chair, by the window at the end of the bar, facing the room)
  placed[k(dx, y0 + 4)] = 'candelabro';   // (en medio, sobre el paso)
  return { placed, floor, roof: roofs };
}

// The village chapel (7×11, project 'chapel'): stone and slate, a doorway with its bell in the middle of the front, plain
// inside: pews on both sides of the aisle, all facing a table at the back with its candles and a plant on each side
export function chapelBlueprint({ x0, y0 }) {
  const w = 7, h = 11, placed = {}, floor = {}, roofs = {}, k = (x, y) => `${x},${y}`, x1 = x0 + w - 1, y1 = y0 + h - 1, mid = x0 + 3;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { floor[k(x, y)] = 'suelo_piedra'; roofs[k(x, y)] = 'tejado_gris'; }
  for (let x = x0; x <= x1; x++) { placed[k(x, y0)] = 'muro_piedra'; placed[k(x, y1)] = 'muro_piedra'; }
  for (let y = y0; y <= y1; y++) { placed[k(x0, y)] = 'muro_piedra'; placed[k(x1, y)] = 'muro_piedra'; }
  for (const y of [y0 + 3, y0 + 5, y0 + 7]) { placed[k(x0, y)] = 'ventana'; placed[k(x1, y)] = 'ventana'; }
  for (const x of [mid - 2, mid + 2]) placed[k(x, y0)] = 'ventana';
  placed[k(mid, y1)] = 'bell_gable';
  placed[k(mid, y0 + 1)] = 'mesa'; placed[k(mid - 1, y0 + 1)] = 'maceta'; placed[k(mid + 1, y0 + 1)] = 'maceta';
  placed[k(mid - 2, y0 + 1)] = 'lampara'; placed[k(mid + 2, y0 + 1)] = 'lampara';
  placed[k(mid, y0 + 5)] = 'candelabro';
  for (const q of chapelPews(x0, y0)) placed[k(...q.tile)] = 'pew@2';
  return { placed, floor, roof: roofs };
}
// Its seats, from the front row back: { seat: [x, y], tile: that of its pew }
export function chapelPews(x0, y0) {
  const out = [];
  for (const y of [y0 + 4, y0 + 6, y0 + 8]) for (const dx of [2, 4, 1, 5]) out.push({ seat: [x0 + dx, y], tile: [x0 + (dx < 3 ? 2 : 5), y] });
  return out;
}
// ---------- the houses of the hamlets (hamlets.js; PLAN-R7 §3.6.3) ----------
// Three sizes (and one with a porch, 10 × 10 with it); of what they are built, by the land: thatch and timber frame in the meadows, limewash and red tile in the warm
// south and by the sea, stone and slate in the north and the mountains, boards and thatch in the woods.
export const HOMES = { cottage: { w: 8, h: 8 }, porched: { w: 10, h: 8 }, small: { w: 12, h: 10 }, long: { w: 14, h: 8 } };
export const STYLES = {
  meadow: { wall: 'muro_entramado', window: 'ventana_contraventanas', roof: 'tejado_paja' },
  south: { wall: 'limewash_wall', window: 'ventana_contraventanas', roof: 'tejado_rojo' },
  north: { wall: 'muro_piedra', window: 'ventana', roof: 'tejado_gris' },
  woods: { wall: 'muro_madera', window: 'ventana', roof: 'tejado_paja' },
};
const K = (x, y) => `${x},${y}`;
// A home with its corner at (0, 0) and its door in its south wall (the porched one: under two rows more of roof, on posts)
export function homeBlueprint(kind, style, { furnish = true } = {}) {
  const porch = kind === 'porched', { w, h } = HOMES[kind], S = STYLES[style] || STYLES.meadow, placed = {}, floor = {}, roof = {}, x1 = w - 1, y1 = h - 1, dx = w >> 1, P = porch ? 2 : 0;
  for (let y = 0; y < h + P; y++) for (let x = 0; x < w; x++) { floor[K(x, y)] = y <= y1 ? 'suelo_madera' : 'suelo_piedra'; roof[K(x, y)] = S.roof; }
  for (let x = 0; x <= x1; x++) { placed[K(x, 0)] = S.wall; placed[K(x, y1)] = S.wall; }
  for (let y = 0; y <= y1; y++) { placed[K(0, y)] = S.wall; placed[K(x1, y)] = S.wall; }
  for (let d = 3; dx - d > 0; d += 3) { placed[K(dx - d, y1)] = S.window; if (dx + d < x1) placed[K(dx + d, y1)] = S.window; }
  if (w === 8) { placed[K(dx - 2, y1)] = S.window; delete placed[K(dx - 3, y1)]; placed[K(dx - 3, y1)] = S.wall; placed[K(dx + 2, y1)] = S.window; placed[K(dx + 3, y1)] = S.wall; }
  // (the shutters and the flower boxes, only in front: they are what a house costs most to draw; and no window in the middle of
  // an end wall: the gable is of what is under it)
  for (const y of [2, h - 3]) { placed[K(0, y)] = 'ventana'; placed[K(x1, y)] = 'ventana'; }
  placed[K(2, 0)] = 'ventana'; if (w > 8) placed[K(x1 - 2, 0)] = 'ventana';
  placed[K(dx, y1)] = 'puerta';
  if (porch) { for (let x = 0; x <= x1; x += x + 3 > x1 && x < x1 ? x1 - x : 3) placed[K(x, y1 + P)] = 'post'; placed[K(x1, y1 + P)] = 'post'; }
  if (furnish) {
    placed[K(1, 1)] = 'cama'; placed[K(dx + 1, 1)] = 'chimenea'; placed[K(x1 - 1, 1)] = 'estanteria';
    placed[K(dx + 1, 4)] = 'mesa'; placed[K(dx, 4)] = 'silla@1'; placed[K(dx + 2, 4)] = 'silla@3'; placed[K(1, y1 - 1)] = 'maceta'; placed[K(3, 1)] = 'lampara';
    if (w > 8) { placed[K(3, 4)] = 'alfombra@2'; placed[K(x1 - 1, y1 - 1)] = 'barril'; placed[K(x1 - 2, 1)] = 'estanteria'; }
    if (kind === 'long') placed[K(5, 1)] = 'comoda';
    placed[K(dx - 1, h >> 1)] = 'candelabro';
  }
  return { placed, floor, roof };
}
// An open shed (8 × 5): three walls of boards, its front on posts, under thatch
export function shedBlueprint(style = 'woods', w = 8, h = 5) {
  const S = STYLES[style] || STYLES.woods, wall = style === 'north' ? 'muro_piedra' : 'muro_madera', placed = {}, floor = {}, roof = {};
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) roof[K(x, y)] = S.roof;
  for (let x = 0; x < w; x++) placed[K(x, 0)] = wall;
  for (let y = 0; y < h - 1; y++) { placed[K(0, y)] = wall; placed[K(w - 1, y)] = wall; }
  for (const x of [0, Math.round((w - 1) / 3), Math.round((w - 1) * 2 / 3), w - 1]) placed[K(x, h - 1)] = 'post';
  return { placed, floor, roof };
}
// A shepherds' stone hut (6 × 6)
export function hutBlueprint(roofId = 'tejado_gris') {
  const placed = {}, floor = {}, roof = {}, n = 6;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { floor[K(x, y)] = 'suelo_piedra'; roof[K(x, y)] = roofId; if (!x || !y || x === n - 1 || y === n - 1) placed[K(x, y)] = 'muro_piedra'; }
  Object.assign(placed, { [K(3, n - 1)]: 'puerta', [K(0, 3)]: 'ventana', [K(n - 1, 2)]: 'ventana', [K(1, 1)]: 'cama', [K(3, 1)]: 'chimenea', [K(4, 4)]: 'barril' });
  return { placed, floor, roof };
}
// A temple, of 4, 6 or 8 columns: the cella of dressed stone (its hatch to the vaults in the middle: hamlets.js) behind a portico,
// under slate, the gable to the front (south), on a pavement one tile wider
export const TEMPLES = { 4: { w: 7, h: 9, porch: 2 }, 6: { w: 7, h: 11, porch: 4 }, 8: { w: 11, h: 13, porch: 4 } };
export function templeBlueprint(columns = 4) {
  const { w, h, porch } = TEMPLES[columns], placed = {}, floor = {}, roof = {}, cy = h - 1 - porch, dx = w >> 1;
  for (let y = -1; y < h + 2; y++) for (let x = -1; x <= w; x++) floor[K(x, y)] = 'suelo_piedra';
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { roof[K(x, y)] = 'slab_roof'; if (y <= cy && (!x || !y || x === w - 1 || y === cy)) placed[K(x, y)] = 'ashlar_wall'; }
  for (let x = 0; x < w; x += 2) placed[K(x, h - 1)] = 'stone_column';
  if (porch > 2) for (const x of [0, w - 1]) placed[K(x, h - 3)] = 'stone_column';
  delete placed[K(dx, cy)];   // (its doorway, open)
  return { placed, floor, roof };
}
// A small sanctuary (7 × 8): one nave of dressed stone, its gable to the front
export function sanctuaryBlueprint() {
  const w = 7, h = 8, placed = {}, floor = {}, roof = {};
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { floor[K(x, y)] = 'suelo_piedra'; roof[K(x, y)] = 'slab_roof'; if (!x || !y || x === w - 1 || y === h - 1) placed[K(x, y)] = 'ashlar_wall'; }
  Object.assign(placed, { [K(3, h - 1)]: 'puerta', [K(0, 3)]: 'ventana', [K(w - 1, 3)]: 'ventana', [K(0, 5)]: 'ventana', [K(w - 1, 5)]: 'ventana', [K(3, 1)]: 'mesa', [K(3, 0)]: 'ventana', [K(1, 1)]: 'lampara', [K(w - 2, 1)]: 'lampara' });
  for (const y of [4, 5]) for (const x of [1, 5]) placed[K(x, y)] = 'silla@2';
  return { placed, floor, roof };
}
// A plan turned q quarters (its south front to the east, the north, the west) about its corner, and moved to (dx, dy), as a new
// plan; `size` ([w, h]) so that the corner of what comes out is (dx, dy)
export function turnBlueprint(bp, q, dx = 0, dy = 0, [w, h] = [0, 0]) {
  const out = { placed: {}, floor: {}, roof: {} };
  q = ((q % 4) + 4) % 4;
  const T = [(x, y) => [x, y], (x, y) => [y, w - 1 - x], (x, y) => [w - 1 - x, h - 1 - y], (x, y) => [h - 1 - y, x]][q];
  for (const layer of ['placed', 'floor', 'roof']) for (const [t, id] of Object.entries(bp[layer])) {
    const [x, y] = t.split(',').map(Number), [a, b] = T(x, y), i = id.indexOf('@'), base = i < 0 ? id : id.slice(0, i), rot = i < 0 ? 0 : +id.slice(i + 1), turns = layer === 'placed' && (i >= 0 || TURNS.has(base));
    out[layer][K(a + dx, b + dy)] = turns && (rot + q) % 4 ? `${base}@${(rot + q) % 4}` : base;
  }
  return out;
}
const TURNS = new Set(['cama', 'chimenea', 'estanteria', 'mesa', 'comoda', 'maceta', 'lampara', 'barril', 'alfombra', 'silla']);

// Reparte un plano por trozos: { "cx,cy": { placed, floor, roof } }, para mezclarlo con lo de cada trozo
export function byChunk(bp, chunk, into = {}) {
  for (const layer of ['placed', 'floor', 'roof']) {
    for (const [t, id] of Object.entries(bp[layer])) {
      const [tx, ty] = t.split(',').map(Number), ck = `${Math.floor(tx / chunk)},${Math.floor(ty / chunk)}`;
      const c = (into[ck] ||= { placed: {}, floor: {}, roof: {} });
      c[layer][t] = id;
    }
  }
  return into;
}
