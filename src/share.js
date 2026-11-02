// Compartir sin servidor: exportar la partida a un archivo (para llevarla a otro dispositivo),
// importarla y visitar lo que ha hecho otra persona sin guardar nada.
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

export async function exportGame(accountId) {
  const data = await gameData(accountId);
  if (!data.save) return false;
  const save = data.save;
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pueblo-brotes-${(save.player?.name || 'partida').toLowerCase().replace(/[^a-z0-9ñ]+/g, '-')}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return true;
}

// Lee un archivo exportado. Devuelve { save, deltas: Map } o lanza un error con el motivo.
export async function readExport(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw new Error('Ese archivo no es una partida de Pueblo Brotes.'); }
  if (data?.format !== FORMAT || !data.save?.player || !Array.isArray(data.deltas)) throw new Error('Ese archivo no es una partida de Pueblo Brotes.');
  return { save: data.save, deltas: new Map(data.deltas) };
}
// keepTime: la partida conserva la hora en que se guardó (así se sabe si es más reciente que otra)
export async function importGame(accountId, { save, deltas }, keepTime = false) {
  await WorldStore.clear(accountId);
  await WorldStore.write(accountId, deltas, [...deltas.keys()]);
  const { accountId: _old, ...rest } = save;
  return Saves.write(accountId, rest, keepTime);
}
