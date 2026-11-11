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
// Descifrada solo está en memoria, mientras dura la sesión. Si la de GitHub existe pero no se puede abrir (¿dañada?), no
// se entra ni se sube nada encima: se avisa y se ofrece la copia de este ordenador o una anterior de GitHub (damaged).
// Si subir a GitHub falla dos veces seguidas, se avisa con el motivo (onSync: ver savesafety.js).
//
// Para jugar juntos en directo, cada cuenta tiene además la clave del mundo compartido (ver worldkey.js) y el
// admin publica en servidor.json, en el repositorio privado, la dirección de su servidor cuando lo abre. El
// mundo compartido va en mundo.enc, cifrado con esa clave: lo guarda el juego que lo lleva (el primero que
// entra, sea quien sea), así que se puede jugar en él aunque el admin no esté.
import { db } from './db.js';
import { gameData } from './share.js';
import { GAME_REPO, DATA_REPO, readAccounts, getFile, putFile, deleteFile, canWrite, fileHistory, tokenExpiry } from './github.js';
import { dataFile, keyFile, toB64, fromB64, newSalt, deriveKey, encryptText, decryptText, seal, unseal, inviteCode, normalizeCode } from './vault.js';
import { WorldKey, keysFile, WORLD_FILE } from './worldkey.js';

export const ADMIN_ID = 'alberto';
const UPLOAD_EVERY = 3 * 60 * 1000;   // como mucho, una subida automática a GitHub cada 3 minutos
const CHORES_EVERY = 3 * 60 * 1000;   // el admin pone al día las cuentas cada tantos minutos mientras juega
const LIVE_FILE = 'servidor.json';
const RETRY_AFTER = 60 * 1000;          // tras un fallo al subir, lo que se espera para volver a intentarlo solo
const SERVER_COPY = 'servidor-mundo';   // (el mundo del servidor guarda aquí, en este navegador, su copia del mundo)
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
let worldSha, worldUploaded = 0, worldQueue = Promise.resolve();   // el mundo compartido: su sha y cuándo se subió
let damaged = null;         // la partida de GitHub que no se ha podido abrir al entrar: lo que se puede hacer (ver begin)
let worldKeyError = '';     // (el admin) por qué no se ha podido abrir la llave del mundo
let renewing = null;        // (el admin, al entrar) su cuenta, si GitHub ya no acepta su token: pega uno nuevo (renewToken)
// Cómo van las subidas a GitHub, la partida (game) y el mundo compartido (world): cuántos fallos seguidos, desde cuándo y
// el último error (con su motivo, kind: ver github.js)
const uploads = { game: { fails: 0, since: 0, at: 0, error: null, okAt: 0 }, world: { fails: 0, since: 0, at: 0, error: null, okAt: 0 } };
function uploaded(which, error = null) {
  const u = uploads[which], before = u.fails;
  if (error) { if (!u.fails) u.since = Date.now(); u.fails++; u.at = Date.now(); u.error = error; }
  else { u.fails = 0; u.error = null; u.okAt = Date.now(); }
  if (before !== u.fails) Profile.onSync?.(Profile.syncState());
}
const resetUploads = () => { for (const u of Object.values(uploads)) Object.assign(u, { fails: 0, since: 0, at: 0, error: null, okAt: 0 }); };

// El mundo compartido va cifrado con la clave del mundo (AES-GCM): 12 bytes al azar y luego lo cifrado
async function sealWorld(key, world) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(world))));
  const bytes = new Uint8Array(12 + body.length);
  bytes.set(iv); bytes.set(body, 12);
  return bytes;
}
const openWorld = async (key, b) => JSON.parse(text(new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.subarray(0, 12) }, key, b.subarray(12)))));

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
// día la otra. seed: la partida con la que empieza si no tiene ninguna. Si la de GitHub existe pero no se puede
// abrir, no se entra (y nunca se sube nada encima): queda en damaged lo que se puede hacer y lanza el error (damaged)
async function begin(account, seed = null) {
  me = account; damaged = null;
  const remote = await getFile(me.token, DATA_REPO, dataFile(me.id));
  remoteSha = remote?.sha;
  let rData = null, rError = null;
  if (remote) { try { rData = await unseal(remote.bytes, me.key, me.salt); } catch (e) { rError = e; } }
  const local = await db.get('vaults', me.id).catch(() => null);
  const lData = local ? await unseal(local.bytes, me.key, me.salt).catch(() => null) : null;
  if (rError) {
    damaged = { account, local: lData, seed, sha: remote.sha, found: undefined };
    me = null;
    const why = /otra cuenta/.test(rError.message) ? 'no es de esta cuenta (¿está dañada?)' : /no tiene datos/.test(rError.message) ? 'no tiene el formato de las partidas (¿está dañada o cortada?)' : 'no se descifra con tu contraseña (¿está dañada?)';
    throw Object.assign(new Error(`No se puede abrir tu partida guardada en GitHub: ${why}. No se ha tocado nada.`), { damaged: true });
  }
  data = [rData, lData, seed].filter(Boolean).sort((a, b) => timeOf(b) - timeOf(a))[0] || emptyData();
  await opened(!rData || timeOf(data) > timeOf(rData));
}
// Lo que sigue a abrir la partida (upload: subirla ya, porque la de GitHub es más vieja o no la había)
async function opened(upload) {
  changed = false; renewing = null; worldKeyError = '';
  resetUploads();
  await Profile.persist({ upload });
  // La clave del mundo compartido. El admin, además, pone al día las cuentas (pasa a accounts.json las que ya
  // tienen contraseña y da la clave del mundo a quien no la tenga) al entrar y cada pocos minutos
  worldKey = openWorldKey();
  clearInterval(chores);
  if (me.admin) { const run = () => Profile.chores().catch(() => {}); run(); chores = setInterval(run, CHORES_EVERY); }
}
// (si no se puede abrir, null; al admin se le dice por qué en el menú y en Ajustes: ver worldKeyError)
const openWorldKey = () => WorldKey.open(me).then(k => { worldKeyError = ''; return k; }, e => { console.warn('Clave del mundo:', e); if (me?.admin) worldKeyError = e.message; Profile.onWorldKeyError?.(worldKeyError); return null; });

export const Profile = {
  get id() { return me?.id; },
  // Todas las cuentas: [{ id, name }] (para el palomar)
  players() { return Object.entries(book?.accounts || {}).map(([id, a]) => ({ id, name: a.name || id })); },
  get name() { return me?.name; },
  get admin() { return !!me?.admin; },
  // El mundo del servidor (ver server.js): { id: 'servidor', pase… } o null
  get server() { return me?.server ? me : null; },
  get data() { return data; },
  lastError: '',
  // (al entrar) la partida de GitHub no se ha podido abrir: { localAt (la copia de este navegador, o null), found (una
  // anterior de GitHub: { at } tras findOlder, o null si no hay) }, o null
  get damaged() { return damaged && { localAt: damaged.local ? timeOf(damaged.local) || -1 : null, found: damaged.found === undefined ? undefined : damaged.found && { at: damaged.found.at } }; },
  // (al entrar, el admin) GitHub ya no acepta su token: hay que pegar uno nuevo (renewToken)
  get needsToken() { return !!renewing; },
  // (el admin) por qué no se puede abrir la llave del mundo ('' si se puede o aún no se sabe)
  get worldKeyError() { return worldKeyError; },

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
    renewing = null;
    try { await begin({ id, name: acc.name, admin: !!acc.admin, key, salt, token }); } catch (e) {
      me = null;
      // (un token caducado: el admin pega uno nuevo aquí mismo; los demás se lo piden a él)
      if (e.kind === 'expired' && acc.admin) { renewing = { id, name: acc.name, admin: true, key, salt }; return 'GitHub ya no acepta tu token de admin (¿ha caducado?): crea uno nuevo en GitHub y pégalo aquí.'; }
      if (e.kind === 'expired') return `GitHub ya no acepta tu permiso de guardado (¿ha caducado?): pide a ${book.accounts[ADMIN_ID]?.name || 'el admin'} uno nuevo (/account reset ${acc.name}) y entra con el código que te dé.`;
      return e.message;
    }
    return null;
  },
  // (el admin) Cambia su token de GitHub por uno nuevo: al entrar, si el suyo ya no vale (needsToken), o desde Ajustes.
  // Tiene que poder escribir en los dos repositorios; queda cifrado con su contraseña en accounts.json. El mundo del
  // servidor tiene el de antes: con /link en su terminal se le da el nuevo
  async renewToken(token) {
    const acc = renewing || (me?.admin ? me : null), atLogin = !!renewing;
    if (!acc) return 'Solo el admin puede cambiar su token aquí.';
    token = String(token || '').trim();
    if (!token) return 'Pega el token nuevo.';
    try {
      if (!(await canWrite(token, GAME_REPO)) || !(await canWrite(token, DATA_REPO))) return `Ese token no puede escribir en ${GAME_REPO} y ${DATA_REPO}.`;
      await loadBook(token);
      const entry = book.accounts[ADMIN_ID];
      if (!entry || entry.invite) return 'No encuentro tu cuenta en accounts.json.';
      const was = me;
      me = { ...acc, token };
      try { entry.token = await encryptText(acc.key, token); await writeBook('Token nuevo de Alberto'); } catch (e) { me = was; throw e; }
      if (atLogin) { renewing = null; await begin(me); }
    } catch (e) { if (atLogin) me = null; return e.message; }
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

  // El mundo del servidor no entra con una cuenta: se da a conocer al servidor con su pase y este le da la clave del
  // mundo (tal cual) y el token con que guardarlo en GitHub, que a él le dio el juego del admin. No tiene partida
  // propia: solo lleva el mundo
  serverStart(pase) { me = { id: 'servidor', name: 'Servidor', server: true, token: null, pase }; data = null; worldKey = Promise.resolve(null); },
  serverKeys({ key, token }) {
    if (!me?.server) return Promise.resolve(null);
    me.token = token || null;
    return (worldKey = crypto.subtle.importKey('raw', fromB64(key), 'AES-GCM', false, ['encrypt', 'decrypt']).catch(() => null));
  },
  // Solo el admin: lo que necesita el mundo del servidor (la clave del mundo y su token), o null si aún no la tiene
  serverSecrets() { const raw = WorldKey.raw(); return me?.admin && raw ? { key: toB64(raw), token: me.token } : null; },

  logout() { me = null; data = null; damaged = null; renewing = null; worldKeyError = ''; clearInterval(chores); WorldKey.forget(); worldKey = Promise.resolve(null); worldSha = undefined; worldUploaded = 0; resetUploads(); },

  // ---------- La partida de GitHub que no se abre ----------
  // Busca en el historial de GitHub la versión más reciente que sí se abre (de las 30 últimas subidas). Devuelve { at } o
  // null si no hay ninguna (y queda para resolveDamaged('older'))
  async findOlder() {
    const d = damaged;
    if (!d) return null;
    if (d.found !== undefined) return d.found && { at: d.found.at };
    const a = d.account;
    let found = null;
    for (const { commit, at } of await fileHistory(a.token, DATA_REPO, dataFile(a.id))) {
      const f = await getFile(a.token, DATA_REPO, dataFile(a.id), commit).catch(() => null);
      if (!f || f.sha === d.sha) continue;   // (la dañada)
      const v = await unseal(f.bytes, a.key, a.salt).catch(() => null);
      if (v) { found = { data: v, at: timeOf(v) || at }; break; }
    }
    if (damaged === d) d.found = found;
    return found && { at: found.at };
  },
  // Lo que elige el jugador: 'local' (la copia de este navegador), 'older' (la anterior de GitHub, tras findOlder) o
  // 'empty' (empezar sin partida). Solo entonces se sube a GitHub, encima de la dañada (que sigue en el historial)
  async resolveDamaged(choice) {
    const d = damaged;
    const picked = !d ? null : choice === 'local' ? d.local : choice === 'older' ? d.found?.data : choice === 'empty' ? d.seed || emptyData() : null;
    if (!picked) return 'Esa copia no está.';
    try {
      me = d.account; data = picked; remoteSha = d.sha; damaged = null;
      await opened(true);
    } catch (e) { me = null; damaged = d; return e.message; }
    return null;
  },

  // ---------- Cómo va el guardado en GitHub ----------
  // Si falla: { what: 'game' | 'world', fails, since, message, kind } (lo peor de los dos, con dos fallos seguidos o
  // más), o null si va bien. Cada cambio llega a onSync
  syncState() {
    const bad = Object.entries(uploads).filter(([, u]) => u.fails >= 2).sort((a, b) => a[1].since - b[1].since)[0];
    return bad ? { what: bad[0], fails: bad[1].fails, since: bad[1].since, message: bad[1].error?.message || '', kind: bad[1].error?.kind || 'other' } : null;
  },
  // Cuándo caduca su token (ms), si GitHub lo dice (ver tokenExpiry en github.js), o null
  get tokenExpires() { return me?.token ? tokenExpiry(me.token) : null; },

  // ---------- La llave del mundo (solo el admin) ----------
  // Su código de recuperación (para su gestor de contraseñas), o null si no tiene la llave abierta
  worldKeyCode() { return me?.admin ? WorldKey.code() : Promise.resolve(null); },
  worldKeyId() { return me?.admin ? WorldKey.wid() : null; },
  // Vuelve a poner la llave del mundo con el código (si no se podía abrir). Devuelve null o el error
  async recoverWorldKey(code) {
    if (!me?.admin) return 'Solo el admin tiene la llave del mundo.';
    try { const key = await WorldKey.recover(me, code); worldKey = Promise.resolve(key); worldKeyError = ''; }
    catch (e) { return e.message; }
    return null;
  },

  // Guarda la partida: cifrada en este ordenador siempre y en GitHub si se pide (o si hace rato de la última)
  store(save, deltas, { upload = false } = {}) {
    data = { format: 'pueblo-brotes', version: 1, exportedAt: new Date().toISOString(), save: save && { ...save, savedAt: Date.now() }, deltas: [...deltas], ...(data?.local ? { local: data.local } : {}) };   // (el mundo local, si lo hay, sigue con la partida)
    changed = true;
    return this.persist({ upload });
  },
  // El mundo local de la cuenta («Jugar en local»): una partida aparte, con su personaje y su mundo, que no es el de
  // todos ni pasa por el servidor. Va en la misma partida guardada de la cuenta (data.local: { save, deltas }), así
  // que se guarda igual: cifrada en este ordenador y en GitHub, solo con esta cuenta
  storeLocal(save, deltas, { upload = false } = {}) {
    data = { ...(data || emptyData()), exportedAt: new Date().toISOString(), local: { save: { ...save, savedAt: Date.now() }, deltas: [...deltas] } };
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
      if (!upload && !(changed && Date.now() - lastUpload > UPLOAD_EVERY && Date.now() - uploads.game.at > RETRY_AFTER)) return { local, remote: null };
      try {
        remoteSha = await putFile(me.token, DATA_REPO, dataFile(me.id), bytes, `Partida de ${me.name}`, remoteSha);
        lastUpload = Date.now(); changed = false; this.lastError = '';
        uploaded('game');
        return { local, remote: true };
      } catch (e) { this.lastError = e.message; uploaded('game', e); return { local, remote: false }; }
    };
    return (queue = queue.then(run, run));
  },

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
  reopenWorldKey() { if (me) worldKey = openWorldKey(); return worldKey; },
  // El servidor en directo que ha publicado el admin: { url, host, since } o null
  async liveServer() {
    const f = me && await getFile(me.token, DATA_REPO, LIVE_FILE).catch(() => null);
    const v = f && JSON.parse(text(f.bytes));
    return v?.url ? v : null;
  },
  // El mundo compartido, como lo guardó la última vez quien lo llevaba: { savedAt, deltas, shared }, o null si
  // todavía no se ha guardado nunca (o no se tiene la clave del mundo). Si no se puede traer, lanza el error
  async loadWorld() {
    const key = await worldKey;
    if (!key || !me) return null;
    const f = await getFile(me.token, DATA_REPO, WORLD_FILE);
    worldSha = f?.sha ?? null;
    if (!f) return null;
    try { return await openWorld(key, f.bytes); }
    catch { throw Object.assign(new Error('No se puede abrir el mundo compartido (¿es de otra clave del mundo?).'), { wrongKey: true }); }
  },
  // (el mundo del servidor) La copia del mundo que guardó en este navegador, o null
  async localWorld() {
    const key = await worldKey, c = await db.get('vaults', SERVER_COPY).catch(() => null);
    if (!key || !c) return null;
    try { return await openWorld(key, c.bytes); } catch { return null; }
  },
  // Lo guarda quien lo lleva: { deltas, shared }. Se sube a GitHub si se pide o si hace rato de la última vez
  // (y, al subirlo, onWorldBytes recibe lo subido: el menú se lo pasa al servidor como copia).
  // Devuelve true si se ha subido, false si falló y null si no tocaba
  // (el mundo del servidor, además, guarda siempre su copia en este navegador, y se la pasa siempre al servidor para sus
  // copias: así las hay aunque GitHub falle)
  storeWorld(world, { upload = false } = {}) {
    const run = async () => {
      const key = await worldKey;
      if (!me || !key) return false;
      const later = !upload && (Date.now() - worldUploaded < UPLOAD_EVERY || Date.now() - uploads.world.at < RETRY_AFTER);
      if (later && !me.server) return null;
      const savedAt = Date.now(), bytes = await sealWorld(key, { format: 'miniverse-mundo', savedAt, by: me.id, ...world });
      if (me.server) { await db.put('vaults', { bytes, savedAt }, SERVER_COPY).catch(() => {}); this.onWorldBytes?.(bytes); }
      if (later || !me.token) return null;
      try { worldSha = await putFile(me.token, DATA_REPO, WORLD_FILE, bytes, `Mundo compartido (${me.name})`, worldSha); worldUploaded = Date.now(); uploaded('world'); if (!me.server) this.onWorldBytes?.(bytes); return true; }
      catch (e) { this.lastError = e.message; worldSha = undefined; uploaded('world', e); return false; }
    };
    return (worldQueue = worldQueue.then(run, run));
  },
  // El mundo cifrado tal cual se guardaría ahora (para una copia con nombre: ver /backup y /restore en server.js), o null
  async worldBytes(world) {
    const key = await worldKey;
    return key && me ? sealWorld(key, { format: 'miniverse-mundo', savedAt: Date.now(), by: me.id, ...world }) : null;
  },
  // Abre una copia del mundo (los bytes de mundo.enc o de una de backups/): el mundo, o lanza por qué no se puede
  async openWorldCopy(bytes) {
    const key = await worldKey;
    if (!key) throw new Error('falta la llave del mundo');
    let w;
    try { w = await openWorld(key, bytes); } catch { throw new Error('no se abre con la llave del mundo (¿es de otra llave o está dañada?)'); }
    if (!w || w.format !== 'miniverse-mundo' || !Array.isArray(w.deltas)) throw new Error('no es una copia del mundo');
    return w;
  },
  // El admin (o el mundo del servidor): publica la dirección del servidor (o, con null, que está cerrado)
  async announce(url) {
    if (me?.admin || (me?.server && me.token)) await putFile(me.token, DATA_REPO, LIVE_FILE, bytesOf({ url, host: me.id, since: Date.now() }), url ? 'Servidor en directo abierto' : 'Servidor en directo cerrado');
  },
  // Solo el admin: da la clave del mundo a una cuenta (cuando la pide al conectarse)
  async grant(id) {
    if (!me?.admin) return false;
    await worldKey;
    return WorldKey.grant(me, idOf(id));
  },
};
