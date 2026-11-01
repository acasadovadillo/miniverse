// Cuentas de jugador guardadas en este navegador (IndexedDB).
// La contraseña nunca se guarda tal cual: se guarda su hash SHA-256 con una sal aleatoria por cuenta.
// Ojo: al ser local, protege frente a miradas casuales, no es una cuenta online.
import { db } from './db.js';

const SESSION = 'pueblo-brotes:sesion';
const LEGACY = 'pueblo-brotes:cuentas';   // cuentas de la versión anterior, en localStorage
let current = null;                       // cuenta con la sesión iniciada

const idOf = user => user.trim().toLowerCase();

async function hash(password, salt) {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Navegadores sin crypto.subtle: hash FNV-1a repetido (más débil, pero sigue sin guardar la contraseña)
  let h = 2166136261;
  for (let round = 0; round < 1000; round++) for (const b of data) { h ^= b; h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}
function newSalt() {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}
function remember(id) {
  try { if (id) localStorage.setItem(SESSION, id); else localStorage.removeItem(SESSION); } catch { /* sin almacenamiento */ }
}

// Pasa las cuentas y partidas de la versión anterior (localStorage) a IndexedDB, una sola vez
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

export const Accounts = {
  get id() { return current?.id; },
  get user() { return current?.name; },

  async init() {
    await migrate();
    let id = null;
    try { id = localStorage.getItem(SESSION); } catch { /* sin almacenamiento */ }
    current = id ? (await db.get('accounts', id)) || null : null;
    return !!current;
  },

  async register(user, pass, pass2, keep) {
    const name = user.trim();
    if (!/^[\p{L}\p{N}_-]{3,16}$/u.test(name)) return 'El usuario debe tener entre 3 y 16 letras, números, guiones o guiones bajos.';
    if (pass.length < 4) return 'La contraseña debe tener al menos 4 caracteres.';
    if (pass !== pass2) return 'Las contraseñas no coinciden.';
    const id = idOf(name);
    if (await db.get('accounts', id)) return 'Ese usuario ya existe. Prueba con otro o entra con él.';
    const salt = newSalt();
    current = { id, name, salt, hash: await hash(pass, salt), created: Date.now() };
    try { await db.put('accounts', current); } catch { current = null; return 'No se ha podido guardar la cuenta en este navegador.'; }
    remember(keep ? id : null);
    return null;
  },

  async login(user, pass, keep) {
    const acc = await db.get('accounts', idOf(user));
    if (!acc || (await hash(pass, acc.salt)) !== acc.hash) return 'Usuario o contraseña incorrectos.';
    current = acc;
    remember(keep ? acc.id : null);
    return null;
  },

  logout() { current = null; remember(null); },
};
