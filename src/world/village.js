// Pueblo Brotes: la zona hecha a mano donde empieza la partida. Es igual en todos los mundos.
// Todo va en la cuadrícula: las casas y la taberna están hechas de piezas de construcción (muros, ventanas, puerta,
// tejado, hogar), la valla del jardín son piezas de valla, y los árboles, arbustos, farola, buzón,
// cartel, tablón, vitrina y puestos ocupan casillas enteras.
import { clamp } from '../util.js';
import { CHUNK } from './gen.js';
import { houseBlueprint, tavernBlueprint, chapelBlueprint, lawOfficeBlueprint, byChunk } from './blueprints.js';

export const HOUSE = { x0: 15, y0: 7, x1: 27, y1: 17 };      // huella de tu casa (12×10 casillas)
export const HOUSE_BIG = { x0: 13, y0: 5, x1: 29, y1: 17 };   // la casa ampliada (16×12), con la puerta en el mismo sitio
export const HOUSE_FAMILY = { x0: 12, y0: 4, x1: 30, y1: 18 }; // la casa familiar (18×14), con sus cuartos: ocupa casi todo el jardín
export const DOOR = { x: 21.5, y: 17.5 };                      // casilla de delante de la puerta de tu casa
export const POND = { x: 31.5, y: 27, rx: 3.6, ry: 2.8 };
export const YARD = { x0: 11, y0: 3, x1: 31, y1: 20 };
const GATE = [20, 22];
export const SPAWN = { x: 18.6, y: 31 };
export const CENTER = { x: 21, y: 24 };
export const NILO = { x: 22.4, y: 24.2 };
// Casas de los vecinos (12×10 casillas, como la tuya). Dani's is a sited building (SITES.dani): it stands where its site was
// chosen (its rectangle is set by setVillage), or not yet if none was free
export const HOUSES = {
  rosa: { x0: 22, y0: 32, x1: 34, y1: 42, roof: 'tejado_azul', name: 'Rosa', beds: 2 },   // (and Lía's)
  bruno: { x0: 2, y0: 44, x1: 14, y1: 54, roof: 'tejado_gris', name: 'Bruno' },
  dani: { x0: 21, y0: 46, x1: 33, y1: 56, roof: 'tejado_verde', name: 'Dani', site: 'dani' },
};
// Casilla de delante de la puerta de una casa de vecino (la puerta está en x0+6, en la fila de abajo)
export const doorOf = h => ({ x: h.x0 + 6.5, y: h.y1 + 0.5 });
// La taberna del pueblo (10×8), al oeste del camino: de Anselmo, con su barra, sus mesas y sus clientes
export const TAVERN = { x0: 1, y0: 32, x1: 11, y1: 40 };
export const inTavern = (x, y, m = 0) => x > TAVERN.x0 - m && x < TAVERN.x1 + m && y > TAVERN.y0 - m && y < TAVERN.y1 + m;
export const STALL = { x0: 25, y0: 23, x1: 27, y1: 24 };     // puesto de Rosa (2×1 casillas)
export const BOARD = { x: 16.5, y: 22.5 };                     // tablón de encargos
export const FOUNTAIN = { x: 21.5, y: 28.5 };                  // fuente (3×3 casillas)
export const DOCK = { x0: 26, y0: 30, x1: 30, y1: 31 };

// ---------- the village, built from day one (docs/planes/PLAN-pueblo-construido.md) ----------
// The village land of before (x 0-40, y 1-62). The roads round the village keep away from it (roads.js): it never changes,
// so the roads of every world stay where they were. BOUNDS: the box round the village land as it is now (BASE_BOUNDS and the
// annexes of the sites chosen in this world); inBounds: in the land itself (BASE_BOUNDS or an annex, not the whole box)
export const BASE_BOUNDS = Object.freeze({ x0: 0, y0: 1, x1: 40, y1: 62 });
export const BOUNDS = { ...BASE_BOUNDS };
const ANNEX = [];
// The player's plot: the land round their garden that the village never takes, in any world (12 tiles free to the west, north
// and east of the garden fence, and the west strip down to the tavern, where the chapel and the law office stood before)
export const PLOT = Object.freeze([{ x0: -1, y0: -9, x1: 43, y1: 20 }, { x0: -1, y0: 20, x1: 13, y1: 29 }, { x0: 31, y0: 20, x1: 43, y1: 22 }].map(Object.freeze));
export const inPlot = (tx, ty) => { for (const r of PLOT) if (tx >= r.x0 && tx < r.x1 && ty >= r.y0 && ty < r.y1) return true; return false; };
// The chapel (7×11, its door in the middle of the south row) and the law office (8×9, its door in the south row): where their
// site was chosen (setVillage keeps these up to date; while one waits, its first site)
export const CHAPEL = { x0: 5, y0: 61, x1: 12, y1: 72 };
export const LAW_OFFICE = { x0: 21, y0: 62, x1: 29, y1: 71 };
// Where they stood before 2026-11-26 (on the west strip, now the player's plot): no tree or rock grows there still
const OLD_LOTS = [{ x0: 2, y0: 15, x1: 9, y1: 26 }, { x0: 1, y0: 3, x1: 9, y1: 12 }];
const OLD_WAYS = [[[18.9, 29], [9.5, 28.5]], [[9.5, 28.5], [5.5, 26.6]], [[9.5, 28.5], [10.1, 25.4]], [[10.1, 25.4], [10, 14.6]], [[10, 14.6], [5.5, 13.5]], [[5.5, 13.5], [5.5, 12.3]]];
// The sited buildings, in the order their sites are chosen, and the ordered candidate sites of each (villagesites.js picks the
// first one with nothing of any player on it, once per world). A candidate: rect (what it stands on), ways (the paths it
// brings, as lines of points), nodes and edges (the neighbours' walk to it: the same node names on every candidate), annex
// (village land it adds outside BASE_BOUNDS) and front (the margin before its door, south). None touches PLOT
export const SITE_ORDER = ['chapel', 'law_office', 'dani', 'fountain', 'market_a', 'market_b', 'dock'];
export const SITES = {
  chapel: [
    // (the south entrance: west of the road in, its door on a lane to the road)
    { rect: { x0: 5, y0: 61, x1: 12, y1: 72 }, ways: [[[8.5, 72.0], [8.5, 72.6], [15.4, 72.6]]], annex: [{ x0: 3, y0: 59, x1: 15.5, y1: 76 }],
      nodes: { chapel_south: [16, 66], chapel_turn: [16.6, 72.5], chapel_door: [8.5, 72.4] }, edges: [['road_s', 'chapel_south'], ['chapel_south', 'chapel_turn'], ['chapel_turn', 'chapel_door']] },
    // (the east lane, past Rosa's door)
    { rect: { x0: 49, y0: 31, x1: 56, y1: 42 }, ways: [[[28.5, 43], [40, 43.3], [52.5, 43.3], [52.5, 42.6]]], annex: [{ x0: 40, y0: 29, x1: 59, y1: 46 }],
      nodes: { chapel_turn: [40, 43.3], chapel_door: [52.5, 42.9] }, edges: [['door_rosa', 'chapel_turn'], ['chapel_turn', 'chapel_door']] },
    // (east of Dani's)
    { rect: { x0: 37, y0: 47, x1: 44, y1: 58 }, ways: [[[16.1, 57.2], [33, 57.4], [40.5, 58.6], [40.5, 58.1]]], annex: [{ x0: 35, y0: 45, x1: 46, y1: 61 }],
      nodes: { chapel_turn: [33, 57.4], chapel_door: [40.5, 58.5] }, edges: [['p57', 'chapel_turn'], ['chapel_turn', 'chapel_door']] },
  ],
  law_office: [
    { rect: { x0: 21, y0: 62, x1: 29, y1: 71 }, ways: [[[25.5, 71.2], [25.5, 72.4], [18.2, 72.6]]], annex: [{ x0: 19, y0: 60, x1: 31, y1: 75 }, { x0: 17.5, y0: 71, x1: 19, y1: 74.5 }],
      nodes: { law_south: [16, 66], law_turn: [16.6, 72.5], law_corner: [25.5, 72.4], door_law: [25.5, 71.8] }, edges: [['road_s', 'law_south'], ['law_south', 'law_turn'], ['law_turn', 'law_corner'], ['law_corner', 'door_law']] },
    { rect: { x0: 38, y0: 33, x1: 46, y1: 42 }, ways: [[[28.5, 43], [42.5, 43.3], [42.5, 42.6]]], annex: [{ x0: 36, y0: 31, x1: 48, y1: 46 }],
      nodes: { law_turn: [36, 43.2], law_corner: [42.5, 43.3], door_law: [42.5, 42.8] }, edges: [['door_rosa', 'law_turn'], ['law_turn', 'law_corner'], ['law_corner', 'door_law']] },
    { rect: { x0: 38, y0: 24, x1: 46, y1: 33 }, ways: [[[30.5, 30.8], [42.5, 33.8], [42.5, 33.3]]], annex: [{ x0: 36, y0: 22, x1: 48, y1: 37 }],
      nodes: { law_corner: [42.5, 33.9], door_law: [42.5, 33.7] }, edges: [['pond_s', 'law_corner'], ['law_corner', 'door_law']] },
  ],
  dani: [
    { rect: { x0: 21, y0: 46, x1: 33, y1: 56 }, ways: [[[16.1, 57], [27.5, 57]]], annex: [], nodes: { door_dani: [27.5, 56.9] }, edges: [['p57', 'door_dani']] },
    // (west of the tavern, its door on the tavern's lane)
    { rect: { x0: -13, y0: 32, x1: -1, y1: 42 }, ways: [[[6.5, 41.1], [-6.5, 42.6]]], annex: [{ x0: -15, y0: 30, x1: 1, y1: 46 }], nodes: { door_dani: [-6.5, 42.9] }, edges: [['tavern_door', 'door_dani']] },
  ],
  fountain: [{ rect: { x0: 20, y0: 27, x1: 23, y1: 30 }, ways: [], annex: [], nodes: {}, edges: [], margin: 1 }],
  market_a: [{ rect: { x0: 24, y0: 27, x1: 26, y1: 28 }, ways: [], annex: [], nodes: { market_a: [25, 26.3], browse_a: [25, 28.9] }, edges: [['pond_w', 'market_a'], ['easel', 'browse_a']], margin: 1 }],
  market_b: [{ rect: { x0: 12, y0: 31, x1: 14, y1: 32 }, ways: [], annex: [], nodes: { market_b: [13, 30.3], browse_b: [13.2, 32.9] }, edges: [['p29', 'market_b'], ['p34', 'browse_b']], margin: 1 }],
  dock: [{ rect: { x0: 26, y0: 30, x1: 30, y1: 31 }, ways: [], annex: [], nodes: {}, edges: [], margin: 1 }],
};
// Each building's site in this world: the index of its candidate, or null while none is free (villagesites.js). Until
// the world says (the workers and the tools, a fresh world), every building on its first site
const FIRST = () => Object.fromEntries(SITE_ORDER.map(id => [id, 0]));
let sites = FIRST();
export const hasBuilding = id => Number.isInteger(sites[id]);
export const siteOf = id => (hasBuilding(id) ? SITES[id][sites[id]] : null);
export const getVillage = () => ({ sites: { ...sites } });
// Quien quiera enterarse de que cambia lo que hay en el pueblo (los sitios o la casa familiar): el suelo en 3D, que
// pinta el camino, lo calcula en otro hilo y tiene que contárselo
const listeners = new Set();
export function onVillageChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const changed = () => { for (const fn of listeners) fn(); };
// ¿Es ya tu casa la casa familiar? (entonces ocupa más jardín: los árboles y arbustos de ahí no están)
let family = false;
export function setFamilyHouse(on) { const was = family; family = !!on; if (was !== family) changed(); }
export const familyHouse = () => family;
const ownLot = () => (family ? HOUSE_FAMILY : HOUSE_BIG);
// The main street, its lanes to the houses that never move, and those that come with the chosen sites (set by setVillage)
const PATH = [[21.5, 17], [21.5, 20.5], [19.3, 23.5], [19, 29], [17.5, 34], [16.5, 46], [16, 60]];
const BASE_SPURS = [
  [[16.8, 43], [28.5, 43]],
  [[17.0, 41], [6.5, 41]],   // (a la taberna)
  [[16.1, 55], [8.5, 55.2]],
];
const SPURS = [], WAYS = [];
// The village's paths as lines of points, for the minimap
export const villagePaths = () => [PATH, ...BASE_SPURS, ...WAYS];
// Por dónde andan los vecinos (neighbors.js): puntos del pueblo y cómo se unen. Van en línea recta de uno a otro, casi
// siempre por el camino; fuera de él (al puesto, al estanque, al caballete de Dani) cruzan la hierba, y ahí la pala
// tampoco cava (townDigWhy): así no se meten en un hoyo ni pasan por encima de un montón. Those of a sited building are
// there only while it stands (setVillage)
const BASE_NODES = {
  plaza: [20.4, 23.8], board: [17.6, 23.4], stall: [25.6, 22.1], pond_w: [26.8, 25.8], pond_s: [30.5, 30.6],
  p29: [19, 29], p34: [17.5, 34], p37: [17.3, 37], p46: [16.6, 46], p52: [16.2, 52.2],
  p43: [16.8, 43], p55: [16.1, 55], p57: [16.1, 57],
  door_rosa: [28.5, 42.9], door_bruno: [8.5, 55.1], forge: [12.5, 55.3], easel: [23.2, 29.6],
  // (routines.js: the tavern's door, the road south, and the shop's front)
  p41: [17, 41], tavern_door: [6.5, 40.9], road_s: [16, 60.6], shop_front: [26.1, 25.3],
};
const BASE_EDGES = [['plaza', 'board'], ['plaza', 'stall'], ['stall', 'pond_w'], ['plaza', 'p29'], ['p29', 'easel'], ['easel', 'pond_s'], ['pond_w', 'pond_s'],
  ['p29', 'p34'], ['p34', 'p37'], ['p37', 'p41'], ['p41', 'p43'], ['p41', 'tavern_door'], ['p43', 'door_rosa'], ['p43', 'p46'], ['p46', 'p52'], ['p52', 'p55'], ['p55', 'door_bruno'], ['door_bruno', 'forge'],
  ['p55', 'p57'], ['p57', 'road_s'], ['pond_w', 'shop_front']];
export const WALK_NODES = { ...BASE_NODES };
export const WALK_EDGES = [];
// Lo que hay del pueblo ahora: the chosen sites' rectangles (LOTS: the chapel's and the law office's), the market stalls
export const LOTS = {};
const MARKET = [];
const rectOf = r => ({ x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 });
// The sites of this world ({ sites: { id: index | null } }: villagesites.js, or the workers' message). Lays out what each
// chosen site brings and tells whoever listens (the ground, the routes, the routines)
export function setVillage(v) {
  const next = FIRST();
  if (v && typeof v === 'object' && v.sites && typeof v.sites === 'object') for (const id of SITE_ORDER) { const i = v.sites[id]; next[id] = Number.isInteger(i) && SITES[id][i] ? i : null; }
  sites = next;
  SPURS.length = 0; WAYS.length = 0; ANNEX.length = 0; MARKET.length = 0;
  for (const k of Object.keys(WALK_NODES)) delete WALK_NODES[k];
  Object.assign(WALK_NODES, BASE_NODES);
  WALK_EDGES.length = 0;
  WALK_EDGES.push(...BASE_EDGES);
  for (const k of Object.keys(LOTS)) delete LOTS[k];
  Object.assign(BOUNDS, BASE_BOUNDS);
  for (const id of SITE_ORDER) {
    const c = siteOf(id);
    if (id === 'chapel' || id === 'law_office') Object.assign(id === 'chapel' ? CHAPEL : LAW_OFFICE, rectOf((c || SITES[id][0]).rect));
    if (id === 'dani') Object.assign(HOUSES.dani, rectOf((c || SITES.dani[0]).rect));
    // (its walk points are there even while it waits, at its first site, so that no plan of a day finds a point missing;
    // without its edges nobody walks to them)
    Object.assign(WALK_NODES, (c || SITES[id][0]).nodes);
    if (!c) continue;
    if (id === 'chapel' || id === 'law_office') LOTS[id] = { ...rectOf(c.rect), name: id };
    if (id === 'market_a' || id === 'market_b') MARKET.push([c.rect.x0, c.rect.y0, id === 'market_a' ? 'stall2' : 'stall3']);
    for (const w of c.ways) { WAYS.push(w); for (let i = 0; i + 1 < w.length; i++) SPURS.push([w[i], w[i + 1]]); }
    for (const a of c.annex) { ANNEX.push(a); BOUNDS.x0 = Math.min(BOUNDS.x0, a.x0); BOUNDS.y0 = Math.min(BOUNDS.y0, a.y0); BOUNDS.x1 = Math.max(BOUNDS.x1, a.x1); BOUNDS.y1 = Math.max(BOUNDS.y1, a.y1); }
    for (const [a, b] of c.edges) WALK_EDGES.push([a, b, id]);
  }
  changed();
}
setVillage(null);
export const inChapel = (x, y, m = 0) => hasBuilding('chapel') && x > CHAPEL.x0 - m && x < CHAPEL.x1 + m && y > CHAPEL.y0 - m && y < CHAPEL.y1 + m;
export const inLawOffice = (x, y, m = 0) => hasBuilding('law_office') && x > LAW_OFFICE.x0 - m && x < LAW_OFFICE.x1 + m && y > LAW_OFFICE.y0 - m && y < LAW_OFFICE.y1 + m;
// A neighbour's house stands (Dani's only where its site was chosen)
export const houseStands = h => !h.site || hasBuilding(h.site);
// La plaza: lo de alrededor de Nilo, del puesto de Rosa, del tablón y de la fuente
export const PLAZA = { x: 21.5, y: 25.5, rx: 5.5, ry: 4.5 };

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
export function distToPath(x, y) {
  let d = Infinity;
  for (let i = 0; i + 1 < PATH.length; i++) d = Math.min(d, distSeg(x, y, PATH[i][0], PATH[i][1], PATH[i + 1][0], PATH[i + 1][1]));
  for (const [a, b] of BASE_SPURS) d = Math.min(d, distSeg(x, y, a[0], a[1], b[0], b[1]));
  for (const [a, b] of SPURS) d = Math.min(d, distSeg(x, y, a[0], a[1], b[0], b[1]));
  return d;
}
// Distancia de un segmento a una casilla (0 si la cruza): de las puntas a la casilla y de sus esquinas al segmento
function segTile(ax, ay, bx, by, tx, ty) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  const clip = (p, q) => { if (Math.abs(p) < 1e-12) return q >= 0; const r = q / p; if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; } return true; };
  if (clip(-dx, ax - tx) && clip(dx, tx + 1 - ax) && clip(-dy, ay - ty) && clip(dy, ty + 1 - ay)) return 0;
  const box = (px, py) => Math.hypot(Math.max(tx - px, 0, px - tx - 1), Math.max(ty - py, 0, py - ty - 1));
  return Math.min(box(ax, ay), box(bx, by), distSeg(tx, ty, ax, ay, bx, by), distSeg(tx + 1, ty, ax, ay, bx, by), distSeg(tx, ty + 1, ax, ay, bx, by), distSeg(tx + 1, ty + 1, ax, ay, bx, by));
}
// Lo más cerca que pasa de una casilla el camino (con sus caminitos) y lo que andan los vecinos
const pathToTile = (tx, ty) => {
  let d = Infinity;
  for (let i = 0; i + 1 < PATH.length; i++) d = Math.min(d, segTile(PATH[i][0], PATH[i][1], PATH[i + 1][0], PATH[i + 1][1], tx, ty));
  for (const [a, b] of BASE_SPURS) d = Math.min(d, segTile(a[0], a[1], b[0], b[1], tx, ty));
  for (const [a, b] of SPURS) d = Math.min(d, segTile(a[0], a[1], b[0], b[1], tx, ty));
  return d;
};
const walkToTile = (tx, ty) => { let d = Infinity; for (const [a, b] of WALK_EDGES) if (WALK_NODES[a] && WALK_NODES[b]) d = Math.min(d, segTile(...WALK_NODES[a], ...WALK_NODES[b], tx, ty)); return d; };
// ¿Toca la casilla una elipse (la del estanque o la de la plaza) agrandada k veces? Por su centro, esquinas y lados
const tileInEllipse = (tx, ty, E, k) => { for (let j = 0; j <= 2; j++) for (let i = 0; i <= 2; i++) if (Math.hypot((tx + i / 2 - E.x) / E.rx, (ty + j / 2 - E.y) / E.ry) < k) return true; return false; };
const inRect = (tx, ty, r, m = 0, front = m) => tx >= r.x0 - m && tx < r.x1 + m && ty >= r.y0 - m && ty < r.y1 + front;
// Dónde no cava la pala en el pueblo y por qué ('' si se puede: scenes.js, digWhy). The answer is a key of the language
// files (this file goes in the workers too), with '|name' when it needs one. Lo de los vecinos se respeta: sus casas y su
// jardín (dos casillas alrededor y tres delante, por donde se entra), el camino y la plaza (con que la roce el camino, la
// casilla es suya), lo que andan los vecinos, el estanque y el muelle, la ermita, el cuartelillo y el mercado. Tu casa y lo
// que haya construido se miran aparte (necesitan el mundo); tu jardín, tu parcela y la hierba libre, sí
export function townDigWhy(tx, ty) {
  for (const h of Object.values(HOUSES)) if (houseStands(h) && inRect(tx, ty, h)) return `why.dig.house|${h.name}`;
  if (inRect(tx, ty, TAVERN)) return 'why.dig.tavern';
  for (const id in LOTS) if (inRect(tx, ty, LOTS[id], 0, 1)) return `why.dig.${id}`;
  if (tileInEllipse(tx, ty, POND, 1.3)) return 'why.dig.pond';
  if (hasBuilding('dock') && inRect(tx, ty, DOCK, 1)) return 'why.dig.dock';
  if (pathToTile(tx, ty) < 1.05) return 'why.dig.path';
  if (tileInEllipse(tx, ty, PLAZA, 1)) return 'why.dig.plaza';
  if (MARKET.some(([x, y]) => inRect(tx, ty, { x0: x, y0: y, x1: x + 2, y1: y + 1 }, 1))) return 'why.dig.market';
  if (walkToTile(tx, ty) < 0.75) return 'why.dig.walk';
  for (const h of Object.values(HOUSES)) if (houseStands(h) && inRect(tx, ty, h, 2, 3)) return `why.dig.garden|${h.name}`;
  if (inRect(tx, ty, TAVERN, 2, 3)) return 'why.dig.tavern_yard';
  return '';
}
// Is this tile village land (what the maps tint and build mode shows: where the village says no)? Tiles of the player's plot
// and of their own lot never are
export const villageLand = (tx, ty) => inBounds(tx + 0.5, ty + 0.5) && !inPlot(tx, ty) && !!townDigWhy(tx, ty);
const inHouse = (x, y, m = 0) => inTavern(x, y, m) || inChapel(x, y, m) || inLawOffice(x, y, m) || Object.values(HOUSES).some(h => houseStands(h) && x > h.x0 - m && x < h.x1 + m && y > h.y0 - m && y < h.y1 + m);
// ¿Está dentro del solar de tu casa (el de la casa ampliada)? Ahí se puede construir aunque sea terreno del pueblo
// The tile is of the lot of the player's house in the village, or of its eaves (the village keeps it: wear.js)
export const onOwnLot = (tx, ty) => { const H = ownLot(); return tx >= H.x0 - 1 && tx <= H.x1 && ty >= H.y0 - 1 && ty <= H.y1; };
export const inOwnHouse = (x, y) => { const H = ownLot(); return x > H.x0 && x < H.x1 && y > H.y0 && y < H.y1; };
export const pondDist = (x, y) => Math.hypot((x - POND.x) / POND.rx, (y - POND.y) / POND.ry);
export const inYard = (x, y, m = 0) => x > YARD.x0 - m && x < YARD.x1 + m && y > YARD.y0 - m && y < YARD.y1 + m;
export const inBounds = (x, y) => {
  if (x > BASE_BOUNDS.x0 && x < BASE_BOUNDS.x1 && y > BASE_BOUNDS.y0 && y < BASE_BOUNDS.y1) return true;
  for (let i = 0; i < ANNEX.length; i++) { const r = ANNEX[i]; if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return true; }
  return false;
};
// ¿Dentro de una casa del pueblo o de la taberna? (ahí se puede quitar y poner de todo)
export const inVillageHouse = (x, y) => inHouse(x, y);
export const isGrass = (x, y) => !inBounds(x, y) || (pondDist(x, y) > 1.25 && distToPath(x, y) > 1.05 && !(x > ownLot().x0 - 0.5 && x < ownLot().x1 + 0.5 && y > ownLot().y0 - 0.5 && y < ownLot().y1 + 0.5) && !inHouse(x, y, 0.5));

// ¿Debe quedar libre de árboles y rocas esta casilla?
export function keepClear(x, y) {
  if (!inBounds(x, y)) return false;
  return distToPath(x, y) < 2.4 || inYard(x, y, 1.5) || pondDist(x, y) < 1.6 || Math.hypot(x - SPAWN.x, y - SPAWN.y) < 3 ||
    [...Object.values(HOUSES).filter(houseStands), TAVERN].some(h => x > h.x0 - 2 && x < h.x1 + 2 && y > h.y0 - 2 && y < h.y1 + 3) ||
    // (the chosen sites, and where the chapel and the law office stood before, still: nothing grows now where it did not)
    [...Object.values(LOTS), ...OLD_LOTS].some(h => x > h.x0 - 1.5 && x < h.x1 + 1.5 && y > h.y0 - 1.5 && y < h.y1 + 2.5) || OLD_WAYS.some(([a, b]) => distSeg(x, y, ...a, ...b) < 1.6) ||
    Math.hypot(x - FOUNTAIN.x, y - FOUNTAIN.y) < 2.5 || (x > 23 && x < 28 && y > 21 && y < 25);
}
// Claro alrededor del pueblo: 0 en el centro, 1 lejos
// Los arbustos del jardín del pueblo (menos los que caen donde va tu casa)
const GARDEN_BUSHES = [[17, 18], [25, 18], [12, 16], [29, 13], [27, 22], [22, 30], [13, 25]];
export function gardenBushes() { const lot = ownLot(); return GARDEN_BUSHES.filter(([tx, ty]) => !(tx >= lot.x0 && tx < lot.x1 && ty >= lot.y0 && ty < lot.y1)); }
export const clearing = (x, y) => clamp((Math.hypot(x - CENTER.x, y - CENTER.y) - 10) / 6, 0, 1);

// Objetos y colisiones del pueblo, más lo construido fijo (built: piezas por trozo)
export function buildVillage() {
  const objects = [], colliders = [];
  const add = (x, y, extra) => objects.push({ x, y, ...extra });
  // Piezas fijas del pueblo, por casilla (las casas de los vecinos y la valla del jardín)
  const fixed = { placed: {}, floor: {}, roof: {} };

  // Árboles y arbustos del jardín, cada uno en su casilla
  const lot = ownLot(), onLot = (tx, ty) => tx >= lot.x0 && tx < lot.x1 && ty >= lot.y0 && ty < lot.y1;
  for (const [tx, ty, kind] of [[12, 12, 'fruit'], [29, 8, 'oak']]) {
    if (onLot(tx, ty)) continue;
    const x = tx + 0.5, y = ty + 0.5;
    add(x, y, { nature: kind });
    colliders.push({ x, y, r: 0.35 });
  }
  // (los arbustos del jardín los pone el mundo, como los demás, para que se puedan segar: gen.js, gardenBushes)

  // Valla del jardín: piezas de valla en el anillo de casillas del jardín, con hueco para el camino
  for (let x = YARD.x0; x < YARD.x1; x++) for (let y = YARD.y0; y < YARD.y1; y++) {
    const edge = x === YARD.x0 || x === YARD.x1 - 1 || y === YARD.y0 || y === YARD.y1 - 1;
    if (!edge || (y === YARD.y1 - 1 && x >= GATE[0] && x < GATE[1])) continue;
    fixed.placed[`${x},${y}`] = 'valla';
  }

  // Casas de los vecinos: planos de piezas (muros de entramado, ventanas, puerta, tejado y muebles)
  for (const h of Object.values(HOUSES)) {
    if (!houseStands(h)) continue;
    const bp = houseBlueprint({ x0: h.x0, y0: h.y0, roof: h.roof, furnish: 'npc', beds: h.beds });
    for (const layer of ['placed', 'floor', 'roof']) Object.assign(fixed[layer], bp[layer]);
  }

  // La taberna
  const ws = tavernBlueprint({ x0: TAVERN.x0, y0: TAVERN.y0 });
  for (const layer of ['placed', 'floor', 'roof']) Object.assign(fixed[layer], ws[layer]);

  if (hasBuilding('law_office')) { const lo = lawOfficeBlueprint(LAW_OFFICE); for (const layer of ['placed', 'floor', 'roof']) Object.assign(fixed[layer], lo[layer]); }
  if (hasBuilding('chapel')) { const ch = chapelBlueprint(CHAPEL); for (const layer of ['placed', 'floor', 'roof']) Object.assign(fixed[layer], ch[layer]); }

  // Puesto de Rosa, tablón de encargos, la fuente, el mercado y el muelle (todo en casillas enteras; fx, fy: la huella de
  // lo que ocupa más de una)
  add(STALL.x0, STALL.y0, { fx: [STALL.x0, STALL.x1], fy: [STALL.y0, STALL.y1], model: 'stall' });
  colliders.push({ x0: STALL.x0, y0: STALL.y0, x1: STALL.x1, y1: STALL.y1 });
  add(BOARD.x, BOARD.y, { model: 'board' }); colliders.push({ x: BOARD.x, y: BOARD.y, r: 0.3 });
  if (hasBuilding('fountain')) {
    add(FOUNTAIN.x, FOUNTAIN.y, { fx: [FOUNTAIN.x - 1.5, FOUNTAIN.x + 1.5], fy: [FOUNTAIN.y - 1.5, FOUNTAIN.y + 1.5], model: 'fountain' });
    colliders.push({ x: FOUNTAIN.x, y: FOUNTAIN.y, r: 1.05 });
  }
  {
    for (const [x, y, k] of MARKET) {
      add(x, y, { fx: [x, x + 2], fy: [y, y + 1], model: k });
      colliders.push({ x0: x, y0: y, x1: x + 2, y1: y + 1 });
    }
  }
  if (hasBuilding('dock')) add(DOCK.x0, DOCK.y0, { fx: [DOCK.x0, DOCK.x1], fy: [DOCK.y0, DOCK.y1], model: 'dock' });

  // Buzón, farola y cartel, cada uno en su casilla
  add(22.5, 20.5, { model: 'mailbox' }); colliders.push({ x: 22.5, y: 20.5, r: 0.25 });
  add(19.5, 20.5, { model: 'lamp' }); colliders.push({ x: 19.5, y: 20.5, r: 0.2 });
  add(17.5, 26.5, { model: 'sign' }); colliders.push({ x: 17.5, y: 26.5, r: 0.25 });
  add(4.5, 40.6, { model: 'sign' }); colliders.push({ x: 4.5, y: 40.6, r: 0.25 });   // (el cartel de la taberna)
  if (hasBuilding('law_office')) { const sx = LAW_OFFICE.x0 + 6.6, sy = LAW_OFFICE.y1 + 0.7; add(sx, sy, { model: 'sign' }); colliders.push({ x: sx, y: sy, r: 0.25 }); }   // (and the law office's, by its door)
  add(12.5, 56.3, { model: 'anvil' }); colliders.push({ x: 12.5, y: 56.3, r: 0.32 });   // (Bruno's anvil, beside his forge: the strongbox's lock is broken on it, missions/strongbox.js ANVIL)

  // Estanque (la orilla y los nenúfares los pone la vista). pond: only animals, mobs and children go round it; the player
  // wades or swims through it (entities.js), as in any other water
  colliders.push({ x: POND.x, y: POND.y, rx: POND.rx * 0.98, ry: POND.ry * 0.98, pond: true });
  return { objects, colliders, built: byChunk(fixed, CHUNK) };
}
