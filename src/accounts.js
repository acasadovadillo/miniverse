// Partida de este navegador. Ya no hay cuentas: se juega directamente y todo se guarda con un perfil local
// (IndexedDB). Si en este navegador había cuentas de antes, se sigue usando la última con la que se entró
// (o la de la partida guardada más reciente), así no se pierde nada.
import { db } from './db.js';

const SESSION = 'pueblo-brotes:sesion';
const LEGACY = 'pueblo-brotes:cuentas';   // cuentas de la primera versión, en localStorage
const LOCAL = 'local';
let current = LOCAL;

// Pasa las cuentas y partidas de la primera versión (localStorage) a IndexedDB, una sola vez
async function migrate() {
  let old;
  try { old = JSON.parse(localStorage.getItem(LEGACY)); } catch { return; }
  if (!old) return;
  for (const [id, acc] of Object.entries(old)) {
    if (await db.get('accounts', id)) continue;
    await db.put('accounts', { id, name: acc.name, salt: acc.salt, hash: acc.hash, created: acc.created });
    if (acc.save) {
      const { name, look, x, y, inside, view, savedAt } = acc.save;
      await db.put('saves', { accountId: id, version: 2, savedAt, player: { name, look, x, y, inside, view } });
    }
  }
  try { localStorage.removeItem(LEGACY); } catch { /* sin almacenamiento */ }
}

export const Profile = {
  get id() { return current; },

  async init() {
    try { await migrate(); } catch { /* sin almacenamiento */ }
    let id = null;
    try { id = localStorage.getItem(SESSION); } catch { /* sin almacenamiento */ }
    if (!id) {
      // La partida más reciente de este navegador, si hay alguna
      try { id = (await db.entries('saves', '')).map(([, s]) => s).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))[0]?.accountId; } catch { /* sin almacenamiento */ }
    }
    current = id || LOCAL;
    try { localStorage.setItem(SESSION, current); } catch { /* sin almacenamiento */ }
  },
};
