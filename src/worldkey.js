// La clave del mundo compartido. Con ella van cifrados los mensajes del juego en directo, así que el servidor
// (y quien diera con su dirección) solo ve datos sin sentido. La crea el admin, que es el dueño del mundo, y
// se la da a cada cuenta sin que nadie más pueda leerla:
// - cada cuenta tiene un par de claves ECDH (P-256) en <usuario>-claves.json, en el repositorio privado: la
//   pública tal cual y la privada cifrada con su contraseña;
// - el admin cifra la clave del mundo con el secreto que comparte con esa cuenta (su privada y la pública de
//   la otra: solo ellos dos pueden sacarlo) y la deja en el archivo de esa cuenta;
// - la suya la guarda cifrada con su propia contraseña.
import { DATA_REPO, getFile, putFile } from './github.js';
import { toB64, fromB64, encryptText, decryptText } from './vault.js';

export const keysFile = id => `${id}-claves.json`;
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const read = f => JSON.parse(new TextDecoder().decode(f.bytes));
const bytesOf = obj => new TextEncoder().encode(JSON.stringify(obj, null, 2) + '\n');

// La clave AES-GCM que comparten la privada de uno y la pública del otro
async function shared(priv, pubJwk) {
  const pub = await crypto.subtle.importKey('jwk', pubJwk, ECDH, false, []);
  return crypto.subtle.deriveKey({ name: 'ECDH', public: pub }, priv, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const aesKey = raw => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

let mine = null;   // las claves de la cuenta con la sesión iniciada: { id, priv, raw y wid (la del mundo y su número, solo el admin) }

export const WorldKey = {
  // Prepara las claves de la cuenta (la primera vez las crea) y abre la clave del mundo, si ya se la han dado
  // (el admin, la crea si no la hay). me: { id, name, admin, key, token }. Devuelve la clave (AES-GCM) o null.
  async open(me) {
    mine = null;
    const f = await getFile(me.token, DATA_REPO, keysFile(me.id));
    let info = f ? read(f) : null, sha = f?.sha ?? null, priv = null;
    if (info?.priv) {
      try { priv = await crypto.subtle.importKey('jwk', JSON.parse(await decryptText(me.key, info.priv)), ECDH, false, ['deriveKey']); } catch { info = null; }   // (de otra contraseña: se hacen nuevas)
    }
    if (!priv) {
      const pair = await crypto.subtle.generateKey(ECDH, true, ['deriveKey']);
      priv = pair.privateKey;
      info = { pub: await crypto.subtle.exportKey('jwk', pair.publicKey), priv: await encryptText(me.key, JSON.stringify(await crypto.subtle.exportKey('jwk', priv))), updated: Date.now() };
      sha = await putFile(me.token, DATA_REPO, keysFile(me.id), bytesOf(info), `Claves de ${me.name}`, sha);
    }
    mine = { id: me.id, priv };
    if (me.admin) {
      let raw = null;
      if (info.world?.self) try { raw = fromB64(await decryptText(me.key, info.world.self)); } catch { raw = null; }
      if (!raw) {
        // (wid: el número de esta clave; si algún día cambia, se les vuelve a dar a todos)
        raw = crypto.getRandomValues(new Uint8Array(32));
        info.world = { self: await encryptText(me.key, toB64(raw)), wid: toB64(crypto.getRandomValues(new Uint8Array(6))) };
        await putFile(me.token, DATA_REPO, keysFile(me.id), bytesOf(info), `Clave del mundo de ${me.name}`, sha);
      }
      Object.assign(mine, { raw, wid: info.world.wid });
      return aesKey(raw);
    }
    if (!info.world?.from || info.world.keys !== info.updated) return null;   // todavía no se la han dado (o es de otras claves)
    try {
      const from = await getFile(me.token, DATA_REPO, keysFile(info.world.from));
      return aesKey(fromB64(await decryptText(await shared(priv, read(from).pub), info.world.box)));
    } catch { return null; }
  },

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

  forget() { mine = null; },
};
