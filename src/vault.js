// Cifrado de las cuentas. Cada cuenta tiene una sal; de su contraseña (o, antes de ponerla, de su código de
// invitación) y esa sal sale una clave AES-GCM de 256 bits (PBKDF2 con SHA-256 y 310 000 vueltas). Con esa
// clave se cifran su partida, en el archivo <usuario>-miniverse-data.enc, y su token de guardado. Las
// contraseñas y los tokens nunca se guardan tal cual.
// Formato del archivo: "MVENC1" + sal (16 bytes) + iv (12 bytes) + el JSON de la partida cifrado.
const MAGIC = new TextEncoder().encode('MVENC1');
const ITERATIONS = 310000;

export const dataFile = id => `${id}-miniverse-data.enc`;
export const keyFile = id => `${id}-key.json`;

export const toB64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
export const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export const newSalt = () => crypto.getRandomValues(new Uint8Array(16));

export async function deriveKey(secret, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// Un texto cifrado como { iv, data } en base64 (para el token de guardado)
export async function encryptText(key, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return { iv: toB64(iv), data: toB64(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)))) };
}
export async function decryptText(key, box, wrong = 'Contraseña incorrecta.') {
  try { return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(box.iv) }, key, fromB64(box.data))); } catch { throw new Error(wrong); }
}

// La partida cifrada, como archivo
export async function seal(key, salt, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data))));
  const out = new Uint8Array(MAGIC.length + 28 + body.length);
  out.set(MAGIC); out.set(salt, MAGIC.length); out.set(iv, MAGIC.length + 16); out.set(body, MAGIC.length + 28);
  return out;
}
export const isVault = bytes => bytes.length > MAGIC.length + 28 && MAGIC.every((v, i) => bytes[i] === v);
const sameSalt = (bytes, salt) => salt.every((v, i) => v === bytes[MAGIC.length + i]);
export async function unseal(bytes, key, salt) {
  if (!isVault(bytes)) throw new Error('Ese archivo no tiene datos cifrados de Miniverse.');
  if (salt && !sameSalt(bytes, salt)) throw new Error('Ese archivo es de otra cuenta.');
  const iv = bytes.slice(MAGIC.length + 16, MAGIC.length + 28);
  try { return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, bytes.slice(MAGIC.length + 28)))); } catch { throw new Error('No se puede abrir ese archivo con tu contraseña.'); }
}

// Código de invitación: 12 letras y números fáciles de dictar (sin 0/O ni 1/I/L), en tres grupos
const CODE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function inviteCode() {
  const r = crypto.getRandomValues(new Uint8Array(12)), s = Array.from(r, b => CODE[b % CODE.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
export const normalizeCode = c => c.toUpperCase().replace(/[^A-Z0-9]/g, '');
