// Datos cifrados de Alberto, la única cuenta. Su partida (el jugador y sus cambios en el mundo) va en el
// archivo alberto-miniverse-data.enc, junto a la página, cifrada con AES-GCM de 256 bits. La clave sale de
// su contraseña (PBKDF2 con SHA-256 y una sal aleatoria que va en el archivo): sin la contraseña no se puede
// leer, y la contraseña no se guarda en ningún sitio (en la sesión solo queda la clave, en memoria).
// Formato del archivo: "MVENC1" + sal (16 bytes) + iv (12 bytes) + el JSON de la partida cifrado.
const MAGIC = new TextEncoder().encode('MVENC1');
const ITERATIONS = 310000;

export const OWNER = { id: 'alberto', name: 'Alberto' };
export const VAULT_FILE = 'alberto-miniverse-data.enc';
export const isOwner = user => user.trim().toLowerCase() === OWNER.id;
// Con el servidor local (servidor.py) el archivo se guarda directamente en la carpeta del juego
export const canWriteFile = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
// Clave nueva (con su sal) para crear el archivo por primera vez
export async function newKey(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { key: await deriveKey(password, salt), salt };
}
export async function seal({ key, salt }, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data))));
  const out = new Uint8Array(MAGIC.length + 28 + body.length);
  out.set(MAGIC); out.set(salt, MAGIC.length); out.set(iv, MAGIC.length + 16); out.set(body, MAGIC.length + 28);
  return out;
}
export const isVault = bytes => bytes.length > MAGIC.length + 28 && MAGIC.every((v, i) => bytes[i] === v);
// Abre un archivo con la contraseña, o con la clave de la sesión si es de la misma sal. Devuelve
// { data, key, salt }; lanza un error si no es un archivo cifrado o la contraseña no es la buena.
export async function unseal(bytes, { password, session } = {}) {
  if (!isVault(bytes)) throw new Error('Ese archivo no tiene datos cifrados de Miniverse.');
  const salt = bytes.slice(MAGIC.length, MAGIC.length + 16), iv = bytes.slice(MAGIC.length + 16, MAGIC.length + 28);
  const same = session && session.salt.every((v, i) => v === salt[i]);
  if (!same && password === undefined) throw new Error('Ese archivo está cifrado con otra contraseña.');
  const key = same ? session.key : await deriveKey(password, salt);
  let text;
  try { text = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, bytes.slice(MAGIC.length + 28))); } catch { throw new Error('Contraseña incorrecta.'); }
  return { data: JSON.parse(text), key, salt };
}

// El archivo publicado junto a la página (null si todavía no existe)
export async function fetchVault() {
  const res = await fetch(VAULT_FILE, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('No se han podido leer los datos guardados.');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!isVault(bytes)) throw new Error('El archivo de datos guardados está dañado.');
  return bytes;
}
// Guarda el archivo en la carpeta del juego (solo con el servidor local)
export async function writeVault(bytes) {
  if (!canWriteFile) return false;
  try { return (await fetch(VAULT_FILE, { method: 'PUT', body: bytes })).ok; } catch { return false; }
}
// Descarga el archivo (para subirlo luego al repositorio y tenerlo en la web)
export function downloadVault(bytes) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  a.download = VAULT_FILE;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
