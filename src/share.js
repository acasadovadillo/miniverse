// Las partidas de las versiones de antes, guardadas sin cifrar en este navegador: sus datos, para cifrarlos.
import { Saves } from './save.js';
import { WorldStore } from './worldstore.js';

const FORMAT = 'pueblo-brotes';

// La partida de una cuenta como datos para un archivo: { format, version, exportedAt, save, deltas } (save
// es null si todavía no hay partida)
export async function gameData(accountId) {
  const save = (await Saves.load(accountId)) || null;
  const deltas = save ? [...(await WorldStore.load(accountId))] : [];
  return { format: FORMAT, version: 1, exportedAt: new Date().toISOString(), save, deltas };
}
