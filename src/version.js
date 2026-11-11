// La versión del juego. Cada publicación sube miniverse-version en index.html (2026-11-11.3: el día y la vez de ese
// día). Los juegos se la dicen al conectarse (el saludo hi de live.js, y al servidor, en ident y pase): el que tiene la
// vieja no entra a tocar el mundo con código viejo y se le pide recargar la página. Y una pestaña abierta mucho rato
// mira de vez en cuando la versión publicada (checkPublished), para avisar aunque no haya nadie más.
export const GAME_VERSION = (typeof document !== 'undefined' && document.querySelector('meta[name="miniverse-version"]')?.content) || '';

// Los números de una versión, para compararlas: '2026-11-11.3' → [2026, 11, 11, 3]
const parts = v => (typeof v === 'string' ? v.match(/\d+/g) || [] : []).map(Number);
// <0 si a es más vieja que b, 0 si son la misma y >0 si es más nueva. Sin versión (un juego de antes de que se
// mandara, o lo que no se sabe): más vieja que cualquiera (multijugador.py compara igual: ver version_key)
export function compareVersions(a, b) {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? -1) - (y[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

// La versión publicada ahora: la de index.html de donde viene esta página, pedida sin caché (GitHub Pages guarda
// copias 10 minutos: con una dirección nueva cada vez, la pide de verdad). null si no se sabe (sin conexión, un fallo)
export async function publishedVersion(timeout = 6000) {
  if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return null;
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), timeout);
  try {
    const res = await fetch(new URL(`index.html?version=${Date.now()}`, document.baseURI), { cache: 'no-store', signal: stop.signal });
    if (!res.ok) return null;
    return (await res.text()).match(/<meta name="miniverse-version" content="([^"]+)"/)?.[1] || null;
  } catch { return null; } finally { clearTimeout(timer); }
}
// ¿Hay publicada una más nueva que esta? Devuelve su versión, o null
export async function checkPublished() {
  const v = await publishedVersion();
  return v && compareVersions(v, GAME_VERSION) > 0 ? v : null;
}
