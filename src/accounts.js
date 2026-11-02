// Cuentas. Las crea el admin (Alberto) con /account create <usuario>, y quedan en accounts.json, en el
// repositorio público del juego. Cada cuenta tiene su token de guardado, que solo puede escribir en el
// repositorio privado de las partidas (Miniverse-data); el de Alberto, además, en el del juego.
//
// En accounts.json, por cuenta: { name, admin?, salt, token } (el token, cifrado con la clave de su
// contraseña) o, mientras no ha puesto contraseña, { name, invite: { salt, token, issued } } (cifrado con el
// código de invitación que el admin le ha pasado). La primera vez que entra, el jugador escribe ese código y
// elige su contraseña; se crean <usuario>-key.json (su token, cifrado con su contraseña) y su partida,
// <usuario>-miniverse-data.enc, en el repositorio privado. Cuando Alberto entra, el token cifrado con la
// contraseña pasa a accounts.json y la invitación se borra.
//
// La partida va cifrada en este ordenador (IndexedDB) y en GitHub, y al entrar se usa la más reciente.
// Descifrada solo está en memoria, mientras dura la sesión.
//
// Para jugar juntos en directo, cada cuenta tiene además la clave del mundo compartido (ver worldkey.js) y el
// admin publica en servidor.json, en el repositorio privado, la dirección de su servidor cuando lo abre.
import { db } from './db.js';
import { gameData } from './share.js';
import { GAME_REPO, DATA_REPO, readAccounts, getFile, putFile, deleteFile, canWrite } from './github.js';
import { dataFile, keyFile, toB64, fromB64, newSalt, deriveKey, encryptText, decryptText, seal, unseal, inviteCode, normalizeCode, isVault } from './vault.js';
import { WorldKey, keysFile } from './worldkey.js';

export const ADMIN_ID = 'alberto';
const UPLOAD_EVERY = 3 * 60 * 1000;   // como mucho, una subida automática a GitHub cada 3 minutos
const CHORES_EVERY = 3 * 60 * 1000;   // el admin pone al día las cuentas cada tantos minutos mientras juega
const LIVE_FILE = 'servidor.json';
const NAME_RE = /^[\p{L}\p{N}_-]{3,16}$/u;
const idOf = name => name.trim().toLowerCase();
const text = bytes => new TextDecoder().decode(bytes);
const bytesOf = obj => new TextEncoder().encode(JSON.stringify(obj, null, 2) + '\n');
const today = () => new Date().toISOString().slice(0, 10);
const timeOf = d => d?.save?.savedAt || 0;
const emptyData = () => ({ format: 'pueblo-brotes', version: 1, exportedAt: new Date().toISOString(), save: null, deltas: [] });

let book = null, bookSha;   // accounts.json y su sha (para reescribirlo)
let me = null;              // la cuenta con la sesión iniciada: { id, name, admin, key, salt, token }
let data = null;            // su partida descifrada
let remoteSha, lastUpload = 0, changed = false, queue = Promise.resolve();
let worldKey = Promise.resolve(null), chores = null;   // la clave del mundo compartido (se va abriendo) y las tareas del admin

async function loadBook(token) {
  const r = await readAccounts(token);
  book = r.data || { version: 1, accounts: {} };
  bookSha = r.sha;
  return !!r.data;
}
async function writeBook(message) { bookSha = await putFile(me.token, GAME_REPO, 'accounts.json', bytesOf(book), message, bookSha); }

// La partida más reciente que hubiera en este navegador de versiones anteriores (sin cifrar), si hay
async function legacyData() {
  try {
    const saves = (await db.entries('saves', '')).map(([, s]) => s).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    return saves[0] ? await gameData(saves[0].accountId) : null;
  } catch { return null; }
}

// Abre la sesión: trae su partida de GitHub y la de este ordenador, se queda con la más reciente y pone al
// día la otra. seed: la partida con la que empieza si no tiene ninguna.
async function begin(account, seed = null) {
  me = account;
  const remote = await getFile(me.token, DATA_REPO, dataFile(me.id));
  remoteSha = remote?.sha;
  const rData = remote ? await unseal(remote.bytes, me.key, me.salt).catch(() => null) : null;
  const local = await db.get('vaults', me.id).catch(() => null);
  const lData = local ? await unseal(local.bytes, me.key, me.salt).catch(() => null) : null;
  data = [rData, lData, seed].filter(Boolean).sort((a, b) => timeOf(b) - timeOf(a))[0] || emptyData();
  changed = false;
  await Profile.persist({ upload: !rData || timeOf(data) > timeOf(rData) });
  // La clave del mundo compartido. El admin, además, pone al día las cuentas (pasa a accounts.json las que ya
  // tienen contraseña y da la clave del mundo a quien no la tenga) al entrar y cada pocos minutos
  worldKey = WorldKey.open(me).catch(e => { console.warn('Clave del mundo:', e); return null; });
  clearInterval(chores);
  if (me.admin) { const run = () => Profile.chores().catch(() => {}); run(); chores = setInterval(run, CHORES_EVERY); }
}

export const Profile = {
  get id() { return me?.id; },
  get name() { return me?.name; },
  get admin() { return !!me?.admin; },
  get data() { return data; },
  lastError: '',

  // Qué hace falta para entrar con este usuario: 'login' (contraseña), 'invite' (primera vez: código de
  // invitación y contraseña nueva), 'setup' (la cuenta de admin todavía no existe) o 'unknown'
  async check(user) {
    const id = idOf(user), exists = await loadBook();
    const acc = book.accounts[id];
    if (!acc) return id === ADMIN_ID && (!exists || !book.accounts[ADMIN_ID]) ? 'setup' : 'unknown';
    return acc.invite ? 'invite' : 'login';
  },

  async login(user, password) {
    const id = idOf(user), acc = book?.accounts[id];
    if (!acc || acc.invite) return 'Ese usuario no existe.';
    const salt = fromB64(acc.salt), key = await deriveKey(password, salt);
    let token;
    try { token = await decryptText(key, acc.token); } catch (e) { return e.message; }
    try { await begin({ id, name: acc.name, admin: !!acc.admin, key, salt, token }); } catch (e) { me = null; return e.message; }
    return null;
  },

  // Primera vez (o cuenta renovada): el código de invitación abre el token de guardado. Si la cuenta ya tenía
  // contraseña (se activó en otro dispositivo, o el admin le dio un token nuevo), se comprueba esa y se
  // guarda con ella el token nuevo; si no, la contraseña elegida pasa a ser la suya.
  async activate(user, code, password, password2) {
    const id = idOf(user), acc = book?.accounts[id];
    if (!acc?.invite) return 'Ese usuario no existe.';
    let token;
    try { token = await decryptText(await deriveKey(normalizeCode(code), fromB64(acc.invite.salt)), acc.invite.token, 'El código de invitación no es correcto.'); } catch (e) { return e.message; }
    try {
      const kf = await getFile(token, DATA_REPO, keyFile(id));
      let salt, key;
      if (kf) {
        const info = JSON.parse(text(kf.bytes));
        salt = fromB64(info.salt); key = await deriveKey(password, salt);
        await decryptText(key, info.token);   // (si la contraseña no es la de siempre, lanza «Contraseña incorrecta»)
      } else {
        if (password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
        if (password !== password2) return 'Las contraseñas no coinciden.';
        salt = newSalt(); key = await deriveKey(password, salt);
      }
      await putFile(token, DATA_REPO, keyFile(id), bytesOf({ salt: toB64(salt), token: await encryptText(key, token), updated: Date.now() }), `Contraseña de ${acc.name}`, kf?.sha ?? null);
      await begin({ id, name: acc.name, admin: !!acc.admin, key, salt, token });
    } catch (e) { me = null; return e.message; }
    return null;
  },

  // La cuenta de admin, la primera vez: su contraseña y su token (que puede escribir en los dos repositorios).
  // Su partida empieza con la que hubiera en este navegador.
  async setup(password, password2, token) {
    if (password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
    if (password !== password2) return 'Las contraseñas no coinciden.';
    token = token.trim();
    try {
      if (!(await canWrite(token, GAME_REPO)) || !(await canWrite(token, DATA_REPO))) return `Ese token no puede escribir en ${GAME_REPO} y ${DATA_REPO}.`;
      await loadBook(token);
      if (book.accounts[ADMIN_ID]) return 'La cuenta de Alberto ya existe: entra con tu contraseña.';
      const salt = newSalt(), key = await deriveKey(password, salt);
      me = { id: ADMIN_ID, name: 'Alberto', admin: true, key, salt, token };
      book.accounts[ADMIN_ID] = { name: 'Alberto', admin: true, salt: toB64(salt), token: await encryptText(key, token), created: today() };
      await writeBook('Cuenta de Alberto');
      await begin(me, await legacyData());
    } catch (e) { me = null; return e.message; }
    return null;
  },

  logout() { me = null; data = null; clearInterval(chores); WorldKey.forget(); worldKey = Promise.resolve(null); },

  // Guarda la partida: cifrada en este ordenador siempre y en GitHub si se pide (o si hace rato de la última)
  store(save, deltas, { upload = false, keepTime = false } = {}) {
    data = { format: 'pueblo-brotes', version: 1, exportedAt: new Date().toISOString(), save: save && { ...save, savedAt: (keepTime && save.savedAt) || Date.now() }, deltas: [...deltas] };
    changed = true;
    return this.persist({ upload });
  },
  // Devuelve { local, remote } (remote: true si se ha subido, false si falló y null si no tocaba)
  persist({ upload = false } = {}) {
    const run = async () => {
      if (!me) return { local: false, remote: null };
      const bytes = await seal(me.key, me.salt, data);
      let local = true;
      try { await db.put('vaults', { bytes, savedAt: timeOf(data) }, me.id); } catch { local = false; }
      if (!upload && !(changed && Date.now() - lastUpload > UPLOAD_EVERY)) return { local, remote: null };
      try {
        remoteSha = await putFile(me.token, DATA_REPO, dataFile(me.id), bytes, `Partida de ${me.name}`, remoteSha);
        lastUpload = Date.now(); changed = false; this.lastError = '';
        return { local, remote: true };
      } catch (e) { this.lastError = e.message; return { local, remote: false }; }
    };
    return (queue = queue.then(run, run));
  },
  async sealed() { return me ? seal(me.key, me.salt, data) : null; },
  // Una partida cifrada (para importarla): tiene que ser de esta cuenta
  async openFile(bytes) { if (!me) throw new Error('Inicia sesión para abrir datos cifrados.'); return unseal(bytes, me.key, me.salt); },
  isVault,

  // ---------- Solo el admin ----------
  // Cuenta nueva (o renovada, con reset): su token de guardado queda cifrado con un código de invitación,
  // que se devuelve para pasárselo a esa persona
  async invite(name, token, reset = false) {
    if (!me?.admin) throw new Error('Solo el admin puede crear cuentas.');
    name = name.trim();
    if (!NAME_RE.test(name)) throw new Error('El usuario debe tener entre 3 y 16 letras, números, guiones o guiones bajos.');
    const id = idOf(name);
    if (id === ADMIN_ID) throw new Error('Esa es tu cuenta.');
    if (!(await canWrite(token.trim(), DATA_REPO))) throw new Error(`Ese token no puede escribir en ${DATA_REPO}.`);
    await loadBook(me.token);
    const acc = book.accounts[id];
    if (acc && !reset) throw new Error(`La cuenta ${acc.name} ya existe (para darle un token nuevo: /account reset ${acc.name}).`);
    if (!acc && reset) throw new Error(`No existe la cuenta ${name}.`);
    const code = inviteCode(), salt = newSalt();
    book.accounts[id] = { ...(acc || { name, created: today() }), invite: { salt: toB64(salt), token: await encryptText(await deriveKey(normalizeCode(code), salt), token.trim()), issued: Date.now() } };
    await writeBook(reset ? `Token nuevo para ${book.accounts[id].name}` : `Cuenta nueva: ${name}`);
    return { name: book.accounts[id].name, code };
  },
  async remove(name) {
    if (!me?.admin) throw new Error('Solo el admin puede borrar cuentas.');
    const id = idOf(name);
    if (id === ADMIN_ID) throw new Error('No puedes borrar tu propia cuenta.');
    await loadBook(me.token);
    const acc = book.accounts[id];
    if (!acc) throw new Error(`No existe la cuenta ${name}.`);
    delete book.accounts[id];
    await writeBook(`Cuenta borrada: ${acc.name}`);
    await deleteFile(me.token, DATA_REPO, dataFile(id));
    await deleteFile(me.token, DATA_REPO, keyFile(id));
    await deleteFile(me.token, DATA_REPO, keysFile(id));
    return acc.name;
  },
  async list() {
    if (!me?.admin) throw new Error('Solo el admin puede ver las cuentas.');
    await this.syncAccounts();
    return Object.values(book.accounts).map(a => ({ name: a.name, admin: !!a.admin, pending: !!a.invite }));
  },
  // Pasa a accounts.json los tokens de quienes ya han puesto su contraseña (desde que se les invitó)
  async syncAccounts() {
    if (!me?.admin) return;
    await loadBook(me.token);
    let n = 0;
    for (const [id, acc] of Object.entries(book.accounts)) {
      if (!acc.invite) continue;
      const kf = await getFile(me.token, DATA_REPO, keyFile(id)).catch(() => null);
      if (!kf) continue;
      const info = JSON.parse(text(kf.bytes));
      if ((info.updated || 0) < (acc.invite.issued || 0)) continue;
      acc.salt = info.salt; acc.token = info.token; delete acc.invite; n++;
    }
    if (n) await writeBook(n === 1 ? 'Una cuenta activada' : `${n} cuentas activadas`);
  },
  async chores() {
    await this.syncAccounts();
    await worldKey;
    for (const id of Object.keys(book.accounts)) await WorldKey.grant(me, id).catch(() => false);
  },

  // ---------- Jugar juntos en directo ----------
  // La clave del mundo compartido (AES-GCM), o null si el admin todavía no te la ha dado
  worldKey() { return worldKey; },
  // Vuelve a abrirla (cuando el admin acaba de dártela)
  reopenWorldKey() { if (me) worldKey = WorldKey.open(me).catch(() => null); return worldKey; },
  // El servidor en directo que ha publicado el admin: { url, host, since } o null
  async liveServer() {
    const f = me && await getFile(me.token, DATA_REPO, LIVE_FILE).catch(() => null);
    const v = f && JSON.parse(text(f.bytes));
    return v?.url ? v : null;
  },
  // Solo el admin: publica la dirección de su servidor (o, con null, que está cerrado)
  async announce(url) {
    if (me?.admin) await putFile(me.token, DATA_REPO, LIVE_FILE, bytesOf({ url, host: me.id, since: Date.now() }), url ? 'Servidor en directo abierto' : 'Servidor en directo cerrado');
  },
  // Solo el admin: da la clave del mundo a una cuenta (cuando la pide al conectarse)
  async grant(id) {
    if (!me?.admin) return false;
    await worldKey;
    return WorldKey.grant(me, idOf(id));
  },
};
