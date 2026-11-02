// Partidas en archivos: los datos de una partida (para cifrarlos) y leer una partida exportada sin cifrar
// (de las versiones de antes, para importarla o para visitar lo que ha hecho otra persona sin guardar nada).
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

// Lee un archivo exportado. Devuelve { save, deltas: Map } o lanza un error con el motivo.
export async function readExport(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw new Error('Ese archivo no es una partida de Pueblo Brotes.'); }
  if (data?.format !== FORMAT || !data.save?.player || !Array.isArray(data.deltas)) throw new Error('Ese archivo no es una partida de Pueblo Brotes.');
  return { save: data.save, deltas: new Map(data.deltas) };
}
