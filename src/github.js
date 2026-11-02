// Archivos en GitHub a través de su API (funciona desde el navegador). accounts.json va en el repositorio
// público del juego, junto a la página; las partidas cifradas de cada cuenta van en un repositorio privado
// aparte. Para escribir hace falta un token: el de admin (Alberto) puede escribir en los dos, y el de
// guardado de cada cuenta, solo en el privado.
import { toB64 } from './vault.js';

export const OWNER = 'acasadovadillo';
export const GAME_REPO = 'miniverse';
export const DATA_REPO = 'Miniverse-data';
const API = 'https://api.github.com';

async function call(token, method, path, body) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  let res;
  try { res = await fetch(API + path, { method, headers, body: body && JSON.stringify(body), cache: 'no-store' }); } catch { throw new Error('No hay conexión con GitHub.'); }
  return res;
}
const failure = res => new Error(res.status === 401 ? 'GitHub no acepta el token (¿ha caducado?).' : res.status === 403 || res.status === 404 ? 'El token no tiene permiso para ese repositorio.' : `GitHub ha respondido con un error (${res.status}).`);

// Un archivo: { bytes, sha } o null si no existe
export async function getFile(token, repo, path) {
  const res = await call(token, 'GET', `/repos/${OWNER}/${repo}/contents/${encodeURIComponent(path)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw failure(res);
  const info = await res.json();
  // (los de más de 1 MB no traen el contenido: se pide aparte, tal cual)
  if (!info.content && info.size) {
    const raw = await fetch(`${API}/repos/${OWNER}/${repo}/git/blobs/${info.sha}`, { headers: { Accept: 'application/vnd.github.raw+json', ...(token && { Authorization: `Bearer ${token}` }) }, cache: 'no-store' });
    if (!raw.ok) throw failure(raw);
    return { bytes: new Uint8Array(await raw.arrayBuffer()), sha: info.sha };
  }
  const bin = atob((info.content || '').replace(/\n/g, ''));
  return { bytes: Uint8Array.from(bin, c => c.charCodeAt(0)), sha: info.sha };
}

// Escribe un archivo (lo crea o lo sustituye). sha: el de la versión que se sustituye; si no se sabe (o ha
// cambiado), se pregunta. Devuelve el sha nuevo.
export async function putFile(token, repo, path, bytes, message, sha) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (sha === undefined || attempt) sha = (await getFile(token, repo, path))?.sha;
    const res = await call(token, 'PUT', `/repos/${OWNER}/${repo}/contents/${encodeURIComponent(path)}`, { message, content: toB64(bytes), ...(sha && { sha }) });
    if (res.ok) return (await res.json()).content.sha;
    if (res.status !== 409 && res.status !== 422) throw failure(res);
  }
  throw new Error('No se ha podido guardar en GitHub (el archivo ha cambiado mientras tanto).');
}

export async function deleteFile(token, repo, path) {
  const sha = (await getFile(token, repo, path))?.sha;
  if (!sha) return;
  const res = await call(token, 'DELETE', `/repos/${OWNER}/${repo}/contents/${encodeURIComponent(path)}`, { message: `Borra ${path}`, sha });
  if (!res.ok && res.status !== 404) throw failure(res);
}

// ¿Puede este token escribir en el repositorio?
export async function canWrite(token, repo) {
  const res = await call(token, 'GET', `/repos/${OWNER}/${repo}`);
  if (!res.ok) return false;
  const info = await res.json();
  return !!(info.permissions?.push || info.permissions?.admin);
}

// accounts.json, el más reciente: por la API (sin token o con el de admin) y, si GitHub no responde, el
// publicado junto a la página. Devuelve { data, sha } (data null si todavía no existe); lanza un error si no
// se puede saber.
export async function readAccounts(token = null) {
  try {
    const f = await getFile(token, GAME_REPO, 'accounts.json');
    return f ? { data: JSON.parse(new TextDecoder().decode(f.bytes)), sha: f.sha } : { data: null, sha: null };
  } catch {
    const res = await fetch(`accounts.json?t=${Date.now()}`, { cache: 'no-store' }).catch(() => null);
    if (res?.ok) return { data: await res.json(), sha: undefined };
    throw new Error('No se ha podido leer la lista de cuentas. Prueba dentro de un rato.');
  }
}
