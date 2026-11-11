// La clave del mundo compartido. Con ella van cifrados los mensajes del juego en directo, así que el servidor
// (y quien diera con su dirección) solo ve datos sin sentido. La crea el admin, que es el dueño del mundo, y
// se la da a cada cuenta sin que nadie más pueda leerla:
// - cada cuenta tiene un par de claves ECDH (P-256) en <usuario>-claves.json, en el repositorio privado: la
//   pública tal cual y la privada cifrada con su contraseña;
// - el admin cifra la clave del mundo con el secreto que comparte con esa cuenta (su privada y la pública de
//   la otra: solo ellos dos pueden sacarlo) y la deja en el archivo de esa cuenta;
// - la suya la guarda cifrada con su propia contraseña. Si su archivo se dañara, no se hace otra (se perdería el mundo):
//   se vuelve a poner con su código de recuperación, que el admin guarda en su gestor de contraseñas.
import { DATA_REPO, getFile, putFile } from './github.js';
import { toB64, fromB64, encryptText, decryptText } from './vault.js';

export const keysFile = id => `${id}-claves.json`;
export const WORLD_FILE = 'mundo.enc';   // (el mundo compartido, cifrado con la clave del mundo: ver accounts.js)
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const read = f => JSON.parse(new TextDecoder().decode(f.bytes));
const bytesOf = obj => new TextEncoder().encode(JSON.stringify(obj, null, 2) + '\n');
const newWid = () => toB64(crypto.getRandomValues(new Uint8Array(6)));

// La clave AES-GCM que comparten la privada de uno y la pública del otro
async function shared(priv, pubJwk) {
  const pub = await crypto.subtle.importKey('jwk', pubJwk, ECDH, false, []);
  return crypto.subtle.deriveKey({ name: 'ECDH', public: pub }, priv, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const aesKey = raw => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
const openPriv = async (key, box) => crypto.subtle.importKey('jwk', JSON.parse(await decryptText(key, box)), ECDH, false, ['deriveKey']);
async function newPair(me) {
  const pair = await crypto.subtle.generateKey(ECDH, true, ['deriveKey']);
  return { priv: pair.privateKey, info: { pub: await crypto.subtle.exportKey('jwk', pair.publicKey), priv: await encryptText(me.key, JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey))), updated: Date.now() } };
}
// ¿Abre esta clave (32 bytes) el mundo guardado? (12 bytes al azar y lo cifrado, como lo guarda accounts.js)
async function opensWorld(raw, bytes) {
  try { await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, await aesKey(raw), bytes.subarray(12)); return true; } catch { return false; }
}
// La llave del mundo ya existía y no se puede abrir: no se hace otra (dejaría ilegibles el mundo guardado, la copia del
// servidor y todas las de backups/). keyLost: el menú lo dice y Ajustes ofrece recuperarla con el código de recuperación
const lost = why => Object.assign(new Error(`${why} No se crea otra, que dejaría el mundo y sus copias sin poder abrirse: recupérala con tu código de recuperación (Ajustes › Llave del mundo).`), { keyLost: true });

// ---------- El código de recuperación ----------
// La clave del mundo (32 bytes) y 2 bytes de comprobación (del SHA-256 de la clave, para notar una errata), en base 32
// de Crockford (sin I, L, O ni U, que se confunden): «MV1-» y 11 grupos de 5. Lo guarda el admin en su gestor de
// contraseñas; el juego nunca lo guarda ni lo escribe en ningún registro: solo se enseña en su ventana (ver savesafety.js)
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const check = async raw => new Uint8Array(await crypto.subtle.digest('SHA-256', raw)).subarray(0, 2);
export async function recoveryCode(raw) {
  const bytes = new Uint8Array(34);
  bytes.set(raw); bytes.set(await check(raw), 32);
  let v = 0, bits = 0, out = '';
  for (const b of bytes) { v = (v << 8) | b; bits += 8; while (bits >= 5) { out += B32[(v >>> (bits - 5)) & 31]; bits -= 5; } v &= (1 << bits) - 1; }
  if (bits) out += B32[(v << (5 - bits)) & 31];
  return 'MV1-' + out.match(/.{1,5}/g).join('-');
}
// El código, escrito o pegado (con o sin guiones, en minúsculas…) → la clave (32 bytes), o null si no es válido
export async function parseRecoveryCode(text) {
  let s = String(text || '').toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0').replace(/[^0-9A-Z]/g, '');
  if (s.length === 58 && s.startsWith('MV1')) s = s.slice(3);
  if (s.length !== 55) return null;
  const out = [];
  let v = 0, bits = 0;
  for (const ch of s) {
    const i = B32.indexOf(ch);
    if (i < 0) return null;
    v = (v << 5) | i; bits += 5;
    if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; v &= (1 << bits) - 1; }
  }
  const bytes = new Uint8Array(out.slice(0, 34)), raw = bytes.slice(0, 32), sum = await check(raw);
  return sum[0] === bytes[32] && sum[1] === bytes[33] ? raw : null;
}

let mine = null;   // las claves de la cuenta con la sesión iniciada: { id, priv, raw y wid (la del mundo y su número, solo el admin) }

export const WorldKey = {
  // Prepara las claves de la cuenta (la primera vez las crea) y abre la clave del mundo, si ya se la han dado
  // (el admin, la crea si no la hay). me: { id, name, admin, key, token }. Devuelve la clave (AES-GCM) o null.
  // La del mundo NUNCA se crea otra vez si ya existía (en su archivo, o porque hay un mundo guardado con ella): si no se
  // puede abrir, falla con un error claro (keyLost) y se recupera con el código (recover)
  async open(me) {
    mine = null;
    const f = await getFile(me.token, DATA_REPO, keysFile(me.id));
    let info, sha = f?.sha ?? null, priv = null;
    try { info = f ? read(f) : null; } catch { if (me.admin) throw lost('Tu archivo de claves está dañado.'); info = null; }   // (los demás: se hacen nuevas y el admin se la vuelve a dar)
    if (info?.priv) { try { priv = await openPriv(me.key, info.priv); } catch { priv = null; } }   // (de otra contraseña o dañada: se hacen nuevas)
    let raw = null;
    if (me.admin) {
      if (info?.world?.self) {
        try { raw = fromB64(await decryptText(me.key, info.world.self)); } catch { raw = null; }
        if (raw?.length !== 32) throw lost('No se puede abrir la llave del mundo de tu archivo de claves (¿está dañado?).');
      } else if (info?.world || await getFile(me.token, DATA_REPO, WORLD_FILE)) throw lost('Tu archivo de claves no tiene la llave del mundo, pero el mundo ya está guardado con una (mundo.enc).');
    }
    let dirty = false, made = false;
    if (!priv) {
      // (el admin que ya tenía la llave del mundo la conserva; con otro número, se les vuelve a dar a todos con las claves nuevas)
      const pair = await newPair(me);
      priv = pair.priv;
      info = { ...pair.info, ...(raw && { world: { ...info.world, wid: newWid() } }) };
      dirty = true;
    }
    if (me.admin && !raw) {
      // (la primera vez: wid, el número de esta clave; si algún día cambia, se les vuelve a dar a todos)
      raw = crypto.getRandomValues(new Uint8Array(32));
      info.world = { self: await encryptText(me.key, toB64(raw)), wid: newWid() };
      dirty = made = true;
    }
    if (dirty) sha = await putFile(me.token, DATA_REPO, keysFile(me.id), bytesOf(info), made ? `Clave del mundo de ${me.name}` : `Claves de ${me.name}`, sha);
    mine = { id: me.id, priv };
    if (me.admin) {
      Object.assign(mine, { raw, wid: info.world.wid });
      return aesKey(raw);
    }
    if (!info.world?.from || info.world.keys !== info.updated) return null;   // todavía no se la han dado (o es de otras claves)
    try {
      const from = await getFile(me.token, DATA_REPO, keysFile(info.world.from));
      return aesKey(fromB64(await decryptText(await shared(priv, read(from).pub), info.world.box)));
    } catch { return null; }
  },

  // Solo el admin: vuelve a poner la llave del mundo con su código de recuperación (cuando open falla con keyLost). Antes
  // se comprueba que abre el mundo guardado. Si sus claves de cuenta tampoco se abren, se hacen nuevas (eso no toca el
  // mundo) y se les vuelve a dar la llave a todos. Devuelve la clave (AES-GCM)
  async recover(me, code) {
    if (!me?.admin) throw new Error('Solo el admin tiene la llave del mundo.');
    const raw = await parseRecoveryCode(code);
    if (!raw) throw new Error('Ese código no es válido: revisa que esté entero y sin erratas.');
    const w = await getFile(me.token, DATA_REPO, WORLD_FILE);
    if (w && !(await opensWorld(raw, w.bytes))) throw new Error('Ese código no abre el mundo guardado (mundo.enc): no es el de esta llave.');
    const f = await getFile(me.token, DATA_REPO, keysFile(me.id));
    let info = null, priv = null;
    try { info = f ? read(f) : null; } catch { info = null; }
    if (info?.priv) { try { priv = await openPriv(me.key, info.priv); } catch { priv = null; } }
    const keep = !!priv && !!info.world?.wid;   // (las mismas claves: lo que tienen los demás sigue valiendo)
    if (!priv) { const pair = await newPair(me); priv = pair.priv; info = pair.info; }
    info.world = { self: await encryptText(me.key, toB64(raw)), wid: keep ? info.world.wid : newWid() };
    await putFile(me.token, DATA_REPO, keysFile(me.id), bytesOf(info), `Llave del mundo recuperada (${me.name})`, f?.sha ?? null);
    mine = { id: me.id, priv, raw, wid: info.world.wid };
    return aesKey(raw);
  },
  // Solo el admin: el código de recuperación de la llave del mundo (o null si no la tiene abierta)
  code() { return mine?.raw ? recoveryCode(mine.raw) : Promise.resolve(null); },
  // (su número: para recordar si el admin ya ha guardado el código de esta llave)
  wid() { return mine?.wid || null; },

  // Solo el admin: da la clave del mundo a una cuenta que ya tenga sus claves (si no la tiene ya, o es de
  // unas claves anteriores). Devuelve true si se la ha dado ahora.
  async grant(me, id) {
    if (!mine?.raw || id === me.id) return false;
    const f = await getFile(me.token, DATA_REPO, keysFile(id));
    if (!f) return false;
    const info = read(f);
    if (!info.pub || (info.world?.from === me.id && info.world.keys === info.updated && info.world.wid === mine.wid)) return false;
    info.world = { from: me.id, keys: info.updated, wid: mine.wid, box: await encryptText(await shared(mine.priv, info.pub), toB64(mine.raw)) };
    await putFile(me.token, DATA_REPO, keysFile(id), bytesOf(info), `Clave del mundo para ${id}`, f.sha);
    return true;
  },

  // Solo el admin: la clave del mundo tal cual (para el mundo del servidor, que la necesita para llevarlo)
  raw() { return mine?.raw || null; },

  forget() { mine = null; },
};
