// Cambios del jugador en el mundo, guardados por trozo en IndexedDB (clave "cuenta|cx,cy").
// Solo se guarda lo que cambia; el resto del mundo sale siempre de la semilla.
import { db } from './db.js';

export const WorldStore = {
  async load(accountId) {
    const map = new Map();
    if (!accountId) return map;
    for (const [key, delta] of await db.entries('chunks', `${accountId}|`)) map.set(key.slice(key.indexOf('|') + 1), delta);
    return map;
  },
  async write(accountId, deltas, keys) {
    if (!accountId) return;
    for (const k of keys) {
      const d = deltas.get(k);
      if (d) await db.put('chunks', d, `${accountId}|${k}`);
    }
  },
  clear: accountId => (accountId ? db.delPrefix('chunks', `${accountId}|`) : Promise.resolve()),
};
