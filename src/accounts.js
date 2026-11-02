// Quién juega en este navegador. Hay una sola cuenta, la de Alberto: su partida viene cifrada en
// alberto-miniverse-data.enc (ver vault.js) y se abre con su contraseña. Los demás juegan sin cuenta y su
// partida se guarda solo en este navegador (IndexedDB). Si aquí había cuentas de versiones anteriores, la
// partida sin cuenta es la última con la que se entró (o la más reciente), así no se pierde nada.
import { db } from './db.js';
import { Saves } from './save.js';
import { gameData, importGame } from './share.js';
import { OWNER, canWriteFile, fetchVault, newKey, seal, unseal, writeVault } from './vault.js';

const SESSION = 'pueblo-brotes:sesion';
const LEGACY = 'pueblo-brotes:cuentas';   // cuentas de la primera versión, en localStorage
const LOCAL = 'local';
let guest = LOCAL, current = LOCAL;
let session = null;                       // { key, salt } con la sesión de Alberto iniciada

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

// Deja en este navegador la partida de un archivo si es más reciente que la que ya había
async function adopt(data) {
  const local = await Saves.load(OWNER.id);
  if (data.save && (!local || (data.save.savedAt || 0) > (local.savedAt || 0))) await importGame(OWNER.id, { save: data.save, deltas: new Map(data.deltas) }, true);
}

export const Profile = {
  get id() { return current; },
  get owner() { return current === OWNER.id; },

  async init() {
    try { await migrate(); } catch { /* sin almacenamiento */ }
    let id = null;
    try { id = localStorage.getItem(SESSION); } catch { /* sin almacenamiento */ }
    if (!id || id === OWNER.id) {
      // La partida sin cuenta más reciente de este navegador, si hay alguna
      try { id = (await db.entries('saves', '')).map(([, s]) => s).filter(s => s.accountId !== OWNER.id).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))[0]?.accountId; } catch { /* sin almacenamiento */ }
    }
    guest = current = id || LOCAL;
    try { localStorage.setItem(SESSION, guest); } catch { /* sin almacenamiento */ }
  },
  playAsGuest() { current = guest; session = null; },

  // ¿Existe ya el archivo cifrado? (para pedir la contraseña dos veces la primera vez, en local)
  async vaultExists() { return !!(await fetchVault()); },

  // Inicia la sesión de Alberto: abre su archivo y deja lista la partida más reciente (la del archivo o
  // la de este navegador). Devuelve un mensaje de error o null.
  async login(user, password) {
    if (user.trim().toLowerCase() !== OWNER.id) return 'Ese usuario no existe.';
    let bytes;
    try { bytes = await fetchVault(); } catch (e) { return e.message; }
    if (!bytes) return canWriteFile ? 'Todavía no hay datos guardados: elige una contraseña para crearlos.' : 'Los datos de Alberto todavía no están en la web.';
    let opened;
    try { opened = await unseal(bytes, { password }); } catch (e) { return e.message; }
    session = { key: opened.key, salt: opened.salt };
    current = OWNER.id;
    await adopt(opened.data);
    await this.persist();   // si la de este navegador era más reciente, el archivo se pone al día
    return null;
  },
  // Crea el archivo cifrado por primera vez (solo en local), con la partida de Alberto de este navegador o,
  // si no hay, con la partida sin cuenta (en el ordenador de Alberto es la suya)
  async create(password) {
    if (!canWriteFile) return 'Los datos solo se pueden crear jugando en local.';
    if (await fetchVault().catch(() => null)) return 'Los datos ya existen: entra con tu contraseña.';
    session = await newKey(password);
    if (!(await Saves.load(OWNER.id))) {
      const data = await gameData(guest);
      if (data.save) await importGame(OWNER.id, { save: data.save, deltas: new Map(data.deltas) }, true);
    }
    current = OWNER.id;
    if (!(await this.persist())) { session = null; current = guest; return 'No se ha podido crear el archivo de datos.'; }
    return null;
  },
  logout() { current = guest; session = null; },

  // El archivo cifrado con la partida actual de Alberto
  async sealed() { return session ? seal(session, await gameData(OWNER.id)) : null; },
  // Abre un archivo cifrado con la clave de la sesión (para importarlo)
  async open(bytes) { if (!session) throw new Error('Inicia sesión para abrir datos cifrados.'); return (await unseal(bytes, { session })).data; },
  // En local, guarda el archivo cifrado en la carpeta del juego
  async persist() { return this.owner && canWriteFile ? writeVault(await this.sealed()) : false; },
};
