// Encantamientos, como en Minecraft. En la mesa de encantar, una herramienta, un arma, una armadura o una caña sin
// encantar recibe uno (a veces dos) de entre tres ofertas, que cuestan 1, 2 o 3 niveles de experiencia y otras tantas
// amatistas (y piden tener al menos 3, 8 o 15 niveles). Las ofertas no cambian hasta que se encanta algo. En el yunque,
// dos cosas iguales se juntan en una: suman lo que aguantan y sus encantamientos. Se guardan en la casilla: ench.
import { ITEMS } from './items.js';

export const ENCHANTS = {
  filo: { name: 'Filo', max: 3, fits: d => !!d.weapon },                                                 // +1 de daño por nivel
  eficiencia: { name: 'Eficiencia', max: 3, fits: d => !!d.tool && !['cana', 'red', 'regadera'].includes(d.tool) },   // un 15 % más deprisa por nivel
  fortuna: { name: 'Fortuna', max: 2, fits: d => ['pico', 'hacha', 'guadana'].includes(d.tool) },           // a veces suelta uno más
  irrompibilidad: { name: 'Irrompibilidad', max: 3, fits: d => !!d.dur },                                  // a veces no se gasta
  proteccion: { name: 'Protección', max: 3, fits: d => !!d.armor },                                        // un 4 % menos de daño por nivel
};
export const OFFER_COST = [1, 2, 3], OFFER_NEED = [3, 8, 15];
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
export const enchName = ench => Object.entries(ench || {}).map(([k, l]) => `${ENCHANTS[k]?.name || k} ${ROMAN[l] || l}`).join(', ');
export const enchLevel = (it, kind) => it?.ench?.[kind] || 0;
export const canEnchant = id => { const d = ITEMS[id]; return !!d && Object.values(ENCHANTS).some(e => e.fits(d)); };

// Un número al azar que sale siempre igual con la misma semilla
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash = s => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);

// Las tres ofertas para un objeto: [{ cost, need, ench }]
export function offers(id, seed) {
  const pool = Object.keys(ENCHANTS).filter(k => ENCHANTS[k].fits(ITEMS[id]));
  if (!pool.length) return [];
  const r = rng(hash(id) ^ seed);
  return OFFER_COST.map((cost, i) => {
    const ench = {}, first = pool[Math.floor(r() * pool.length)];
    ench[first] = Math.min(ENCHANTS[first].max, Math.max(1, i) + (i ? Math.floor(r() * 2) : 0));   // (la de 1 nivel, I; la de 2, I o II; la de 3, II o III)
    // (la más cara, a veces, con otro más)
    if (i === 2 && pool.length > 1 && r() < 0.4) { const more = pool.filter(k => k !== first)[Math.floor(r() * (pool.length - 1))]; ench[more] = 1; }
    return { cost, need: OFFER_NEED[i], ench };
  });
}

// Juntar dos cosas iguales en el yunque: lo que aguantan las dos y un poco más, y sus encantamientos (si los dos
// tienen el mismo al mismo nivel, uno más). Devuelve { it, cost } (cost: los niveles que cuesta)
export function combine(a, b) {
  const def = ITEMS[a.id], max = def.dur, ench = { ...(a.ench || {}) };
  for (const [k, l] of Object.entries(b.ench || {})) {
    if (!ENCHANTS[k]?.fits(def)) continue;
    ench[k] = Math.min(ENCHANTS[k].max, ench[k] === l ? l + 1 : Math.max(ench[k] || 0, l));
  }
  const dur = max ? Math.min(max, (a.dur ?? max) + (b.dur ?? max) + Math.floor(max * 0.12)) : undefined;
  const it = { ...a, ...(dur !== undefined && { dur }), ...(Object.keys(ench).length && { ench }) };
  return { it, cost: 2 + Object.values(ench).reduce((t, l) => t + l, 0) };
}
