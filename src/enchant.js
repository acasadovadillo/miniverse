// Encantamientos, como en Minecraft. Ya no hay mesa de encantar: los que ya tiene una herramienta siguen funcionando, un
// op los da con /enchant, y en el yunque dos cosas iguales se juntan en una: suman lo que aguantan y sus encantamientos.
// Se guardan en la casilla: ench.
import { ITEMS } from './items.js';

export const ENCHANTS = {
  filo: { name: 'Filo', max: 3, fits: d => !!d.weapon },                                                 // +1 de daño por nivel
  eficiencia: { name: 'Eficiencia', max: 3, fits: d => !!d.tool && !['cana', 'red', 'regadera'].includes(d.tool) },   // un 15 % más deprisa por nivel
  fortuna: { name: 'Fortuna', max: 2, fits: d => ['pico', 'hacha', 'guadana'].includes(d.tool) },           // a veces suelta uno más
  irrompibilidad: { name: 'Irrompibilidad', max: 3, fits: d => !!d.dur },                                  // a veces no se gasta
  proteccion: { name: 'Protección', max: 3, fits: d => !!d.armor },                                        // un 4 % menos de daño por nivel
};
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
export const enchName = ench => Object.entries(ench || {}).map(([k, l]) => `${ENCHANTS[k]?.name || k} ${ROMAN[l] || l}`).join(', ');
export const canEnchant = id => { const d = ITEMS[id]; return !!d && Object.values(ENCHANTS).some(e => e.fits(d)); };
export const enchLevel = (it, kind) => it?.ench?.[kind] || 0;

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
