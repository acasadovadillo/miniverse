// Partida guardada de cada cuenta: el estado del jugador (el mundo es uno solo; seed dice en cuál se guardó).
// Formato: { accountId, version: 2, seed, savedAt, player: { name, look, x, y, inside, view },
//           explored, inventory: { slots, selected }, hp, hunger, clock, house: { big, built } }
// (built: tu casa ya está levantada en el mundo con piezas; las partidas de antes traían house.placed y
// house.chests con los muebles de la habitación aparte, que se migran al cargar)
// Los cambios del mundo (talado, labrado) van aparte, por trozos: ver worldstore.js
import { db } from './db.js';

export const Saves = {
  load: accountId => (accountId ? db.get('saves', accountId) : Promise.resolve(null)),
  async write(accountId, data) {
    if (!accountId || !data) return false;
    try {
      await db.put('saves', { ...data, accountId, version: 2, savedAt: Date.now() });
      return true;
    } catch {
      return false;
    }
  },
};
