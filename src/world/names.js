// Who a place is (docs/planes/realismo/PLAN-R7-mundo.md §3.2): its name, its state and its history, always the same for
// the same site. Pure, like sites.js. The names are toponyms, the same in every language: a root from the land round it and
// a qualifier. Two sites of a tier less than 3 km apart never share one (see nameOf). What is said of it (the title, the
// line of its history) is texts of the language files: place.title.*, place.story.*, place.builder.*, place.state.*
import { ihash } from '../util.js';
import { CHUNK } from './gen.js';
import { B } from './biomes.js';
import { SITE_TIERS, TIER_OF } from './sites.js';

// The roots by what the land is like, each with its gender (m, f), and the qualifiers: adjectives ([m, f]) or of something
const R = s => s.split(' ').map(w => (w.endsWith('*') ? [w.slice(0, -1), 1] : [w, 0]));   // (*: feminine)
const ROOTS = {
  high: R('Peña* Alto Cerro Cuesta* Mirón Otero Loma* Cabezo Teso Collado Cumbre* Picón Tozal Muela* Sierra* Viso Cerral'),
  woods: R('Robledo Encinar Olmeda* Quejigal Fresneda* Castañar Acebeda* Hayedo Soto Carrascal Alameda* Monte Arboleda* Dehesa* Rebollar Bosque Saúco'),
  pines: R('Pinar Pineda* Sabinar Enebral Tejeda* Abetal Pinarejo Retamar Piornal Brezal Helechal Umbría* Solana* Majada* Braña* Cañada* Robledillo'),
  meadow: R('Prado Pradera* Vega* Campo Llano Ejido Nava* Era* Haza* Majuelo Barbecho Trigal Pastizal Dehesilla* Valle Hoya* Vallejo'),
  water: R('Vado Fuente* Arroyo Laguna* Molino Ribera* Poza* Charca* Remanso Regato Puente Caño Isla* Junquera* Aceña* Tablada* Chorro'),
  coast: R('Punta* Cala* Ensenada* Cabo Playa* Bajo Concha* Roca* Puntal Caleta* Ancón Bahía* Costa* Duna* Varadero Peñón Marina*'),
  rock: R('Nevero Ventisquero Lastra* Pedregal Canto Canchal Risco Peñasco Roquedo Breña* Quebrada* Barranco Garganta* Hoz* Sima* Cueto Peñote Tajo Cantera* Llambria* Morra* Berrocal Grieta* Hondonada* Helero Cascajal Galayo'),
  desert: R('Secano Arenal Aljibe Páramo Yesar Salina* Rambla* Erial Ramblizo Espartal Calvero Cárcava* Llanada* Albero Saladar Barrera* Tomillar'),
};
const QUALS = [
  ['Alto', 'Alta'], ['Hondo', 'Honda'], ['Viejo', 'Vieja'], ['Nuevo', 'Nueva'], ['Rubio', 'Rubia'], ['Negro', 'Negra'], ['Blanco', 'Blanca'], ['Grande', 'Grande'], ['Chico', 'Chica'],
  ['Largo', 'Larga'], ['Frío', 'Fría'], ['Claro', 'Clara'], ['Seco', 'Seca'], ['Escondido', 'Escondida'], ['Quemado', 'Quemada'], ['Redondo', 'Redonda'], ['Dorado', 'Dorada'], ['Pardo', 'Parda'],
  ...['del Cuervo', 'del Lobo', 'de la Corza', 'del Abad', 'de la Reina', 'del Ermitaño', 'de la Viuda', 'del Pastor', 'de los Frailes', 'del Molinero', 'del Santo', 'de la Cruz', 'del Rey',
    'de las Ánimas', 'de la Zorra', 'del Águila', 'del Buitre', 'de las Brujas', 'del Carbonero', 'de la Liebre', 'de la Miel', 'del Trueno', 'del Viento'].map(q => [q, q]),
];
const LANDS = Object.keys(ROOTS);
// The land a site is named after
export function featureOf(s) {
  if (s.kind === 'faro' || s.kind === 'barco') return 'coast';
  if (s.biome === B.DESERT) return 'desert';
  if (s.biome === B.ROCKY || s.biome === B.SNOW || s.kind === 'cueva') return 'rock';
  if (s.kind === 'torre') return 'high';
  if (s.biome === B.BEACH || s.sea) return 'coast';
  if (s.water) return 'water';
  return s.biome === B.FOREST ? 'woods' : s.biome === B.PINES ? 'pines' : s.biome === B.MEADOW ? 'meadow' : 'high';
}
const gcd = (a, b) => (b ? gcd(b, a % b) : a), mod = (a, n) => ((a % n) + n) % n;
// The name: the cells of a tier go over a block of n × n cells, 3 km or more across, each with its own number, and the
// number goes one to one to a pair of root and qualifier (scrambled, so that next cells do not share a root): no two sites
// of a tier less than 3 km apart (and named after the same land) have the same name
export function nameOf(s) {
  const tier = s.tier || TIER_OF[s.kind] || 'minor', land = featureOf(s), roots = ROOTS[land], total = roots.length * QUALS.length;
  const cell = SITE_TIERS[tier].cell, span = s.legacy ? CHUNK : cell * CHUNK, n = s.legacy ? 24 : Math.ceil(3000 / span) + 1;
  const ix = s.legacy ? Math.floor(s.x / CHUNK) : s.ix, iy = s.legacy ? Math.floor(s.y / CHUNK) : s.iy;
  let step = Math.floor(total * 0.382);
  while (gcd(step, total) !== 1) step++;
  const at = mod((mod(ix, n) + n * mod(iy, n)) * step + (tier === 'hamlet' ? 0 : tier === 'major' ? 97 : 211) + LANDS.indexOf(land) * 131, total);
  const [root, f] = roots[at % roots.length];
  return `${root} ${QUALS[Math.floor(at / roots.length)][f]}`;
}
const pick = (s, salt, list) => list[Math.floor(ihash(s.id, salt, 7177) * list.length)];
// lived (someone lives there), kept (looked after, nobody inside), empty (left behind, intact) or null (nature's, a cave).
// hamlet: how far the nearest hamlet is (metres)
export function stateOf(s, hamlet = Infinity) {
  if (s.kind === 'aldea') return 'lived';
  if (s.kind === 'faro') { const r = ihash(s.id, 11, 7177); return r < 0.6 ? 'lived' : r < 0.8 ? 'kept' : 'empty'; }
  if (s.kind === 'torre') return hamlet < 1000 ? 'kept' : 'empty';
  if (s.kind === 'campamento') return hamlet < 1500 || ihash(s.id, 11, 7177) < 0.5 ? 'kept' : 'empty';
  return s.kind === 'templo' || s.kind === 'barco' ? 'empty' : null;
}
const YEARS = { aldea: [1580, 1790], torre: [1180, 1640], faro: [1780, 1930], templo: [880, 1290], barco: [1870, 1931], campamento: [1850, 1930], cueva: [1600, 1900] };
const BUILDERS = { aldea: ['shepherds', 'fishers', 'woodcutters', 'settlers'], torre: ['people', 'guard', 'lord'], faro: ['coast', 'fishers', 'port'], templo: ['pilgrims', 'caravans', 'unknown'], barco: ['fishers', 'family'], campamento: ['shepherds', 'woodcutters', 'charcoal'], cueva: ['shepherds', 'miners', 'smugglers'] };
export const STORIES = 4;   // (lines of history per kind: place.story.<kind>.1 to .4)
// { year, builder, line }: what the line of its history says. hamletName: the hamlet it belongs to, if there is one near
// (without one, nobody built it for a hamlet)
export function storyOf(s, hamletName = null) {
  const [a, b] = YEARS[s.kind] || [1700, 1900];
  const list = (BUILDERS[s.kind] || ['unknown']).filter(q => q !== 'people' || hamletName);
  return { year: a + Math.floor(ihash(s.id, 12, 7177) * (b - a)), builder: pick(s, 13, list), hamlet: hamletName, line: 1 + Math.floor(ihash(s.id, 14, 7177) * STORIES) };
}
export const ROOT_COUNT = Object.fromEntries(Object.entries(ROOTS).map(([k, v]) => [k, v.length]));
export const QUAL_COUNT = QUALS.length;
