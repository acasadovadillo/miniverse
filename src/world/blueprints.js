// Planos de casas hechas de piezas de construcción (las mismas que usa el jugador): la casa del pueblo,
// las de los vecinos y las de las aldeas lejanas. Un plano es lo que se coloca en cada casilla, por capas:
// suelo, objeto (muros, ventanas, puerta, hogar y muebles) y tejado.
//
// Casa pequeña (12×10) con el origen en la esquina de atrás (x0, y0); la puerta, en medio de la fila de
// delante (la que mira al jugador). Hay ventanas cada tres casillas en las cuatro paredes y un cuadro en la de atrás.
// Dentro (10×8): cama (de dos casillas), dos estanterías con una lámpara al lado, hogar y maceta contra la pared de atrás;
// mesa con dos sillas; alfombra, otra maceta y, en la tuya, un cofre. La casa grande (16×12) tiene el mismo reparto.

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
export function houseBlueprint({ x0, y0, big = false, roof = 'tejado_rojo', wall = 'muro_entramado', window = 'ventana_contraventanas', furnish = 'full' }) {
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
    if (furnish === 'full') placed[k(x0 + 1, r + 3)] = 'cofre';
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
  return { placed, floor, roof: roofs };
}

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
