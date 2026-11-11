// Errores a la vista. Un fallo en una parte del juego (el huerto, los animales, el tiempo…) no puede parar a las demás
// ni quedarse escondido en la consola: game.js aísla cada sistema y cuenta aquí lo que falla, y lo mismo los errores
// sueltos de la página (un clic, un mensaje de red, una promesa). Aquí se apunta: la primera vez entero, con su pila;
// si se repite, un resumen por minuto (un sistema que falla en cada paso se sigue intentando, pero no inunda la
// consola). Y se ve: un punto rojo discreto abajo a la derecha (al pasar el ratón, el último error; con un clic, se
// copia y se esconde hasta que falle otra cosa) y unas líneas en F3. En el mundo del servidor no hay pantalla: va a su
// terminal (server.js le dice dónde con setFaultSink); y los de los jugadores, también (live.js se lo manda).
const REPEAT_MS = 60000;   // (cada cuánto se dice cuántas veces se ha repetido lo callado)
const MAX_KINDS = 100;     // (los distintos que se recuerdan: que no crezcan sin fin)
const PER_PLACE = 3;       // (los distintos que se dicen enteros de una misma parte por minuto: los demás, se cuentan)
const IGNORE = /^ResizeObserver loop|^Script error\.?$/;   // (avisos del navegador que no son fallos del juego)

// `dónde|mensaje sin números` → { where, message, n: las veces, quiet: las calladas desde said, said, at, place, stack }
// (sin números: «reading '17'» y «reading '18'» al leer la casilla de un animal que se mueve son el mismo fallo)
const kinds = new Map();
const places = new Map();   // dónde → { at: desde cuándo cuenta, told: los distintos dichos, quiet: los callados }
const listeners = new Set();
let sink = null, el = null, shownAt = 0, dismissed = false, seq = 0;
// total: los fallos desde que se abrió (o desde resetFaults); kinds: cuántos distintos se recuerdan; last: el último
export const faults = { total: 0, kinds: 0, last: null };

// Las partes del juego, como las entiende quien juega (el nombre del código se queda para F3, el informe y el terminal)
const NAMES = {
  Stats: 'las estadísticas', Skills: 'las habilidades', TimeSystem: 'el paso de los días', Archery: 'el arco', Board: 'el tablón',
  Farm: 'el huerto', Ranch: 'la granja', Family: 'la familia', Fishing: 'la pesca', Wildlife: 'los animales del campo',
  Rest: 'el descanso', Crew: 'las barcas', Neighbors: 'los vecinos', Hunt: 'la caza', Combat: 'el combate', Mobs: 'las criaturas',
  Experience: 'la experiencia', Maps: 'los mapas', Explore: 'explorar', Collection: 'las colecciones', Achievements: 'los logros',
  Story: 'la historia', Steps: 'los primeros pasos', Live: 'jugar juntos', Gather: 'recoger', Music: 'la música',
  página: 'la página', promesa: 'una tarea en segundo plano', paso: 'el avance del juego', dibujo: 'el dibujo',
  apuntar: 'lo que se apunta', juego: 'el juego',
};
export function faultLabel(where) { return NAMES[String(where).split('.')[0]] || where; }

// Adónde más se cuenta (el terminal del servidor): una función que recibe el texto
export function setFaultSink(fn) { sink = fn; }
// Quién más quiere saber de cada fallo distinto (live.js, para el terminal del servidor; las pruebas): fn(registro)
export function onFault(fn) { listeners.add(fn); return () => listeners.delete(fn); }
// Empezar a contar de nuevo (las pruebas, en cada una: un fallo que ya salió en otra se vuelve a decir entero)
export function resetFaults() { kinds.clear(); places.clear(); clearTimeout(flushT); flushT = null; faults.total = 0; faults.kinds = 0; faults.last = null; dismissed = false; if (el) el.hidden = true; }

// Un fallo. where: qué parte (p. ej. 'Ranch.update'). logged: si ya ha salido en la consola (el navegador ya enseña
// los errores sueltos de la página)
export function reportFault(e, where = 'juego', logged = false) {
  const err = e instanceof Error ? e : null;
  const message = String((err ? err.message : e?.message ?? e) || 'error sin mensaje').slice(0, 300);
  if (IGNORE.test(message) || err?.name === 'AbortError') return;
  const id = `${where}|${message.replace(/\d+(\.\d+)?/g, '#')}`, now = Date.now();
  let k = kinds.get(id);
  faults.total++;
  if (!k) {
    if (kinds.size >= MAX_KINDS) kinds.delete(kinds.keys().next().value);
    kinds.set(id, (k = { where, message, n: 0, quiet: 0, said: now, at: now, seq: 0, place: placeOf(err), stack: err?.stack || '' }));
    faults.kinds = kinds.size;
    dismissed = false;   // (algo nuevo: el punto vuelve aunque se hubiera escondido)
    // (una parte que da muchos fallos distintos seguidos: los primeros enteros, y de los demás, cuántos, por minuto)
    let pl = places.get(where);
    if (!pl || now - pl.at >= REPEAT_MS) places.set(where, (pl = { at: now, told: 0, quiet: 0 }));
    if (pl.told < PER_PLACE) {
      pl.told++;
      if (!logged) console.error(`[${where}]`, e);
      tell(`Fallo en ${where}: ${message.slice(0, 220)}${k.place}`);   // (el terminal corta en 300)
    } else { pl.quiet++; later(); }
  } else { k.quiet++; later(); }
  k.n++; k.at = now; k.seq = ++seq; k.message = message;
  faults.last = { where, message, n: k.n, at: now, place: k.place, stack: err?.stack || k.stack };
  if (k.n === 1) for (const fn of listeners) try { fn(faults.last); } catch { /* (un oyente que falla no cuenta: no hay que entrar en bucle) */ }
  show(now, k.n === 1);
}

// Los distintos más recientes (para F3 y el informe), el último primero
export function recentFaults(n = 4) { return [...kinds.values()].sort((a, b) => b.seq - a.seq).slice(0, n); }

// El texto para copiar: versión, el último con su pila y los demás distintos (el primero suele ser la causa)
export function faultReport() {
  const l = faults.last;
  if (!l) return '';
  const version = typeof document !== 'undefined' && document.querySelector('meta[name="miniverse-version"]')?.content || '?';
  const others = recentFaults(MAX_KINDS).filter(k => !(k.where === l.where && k.message === l.message));
  return `Miniverse ${version} · ${new Date(l.at).toLocaleString()}\nFallo en ${l.where} (${l.n} ${l.n === 1 ? 'vez' : 'veces'}; ${faults.kinds} ${faults.kinds === 1 ? 'distinto' : 'distintos'}, ${faults.total} en total)\n${l.message}\n${l.stack}` +
    others.map(k => `\n\n— ${k.where} (${k.n} ${k.n === 1 ? 'vez' : 'veces'}, la última ${new Date(k.at).toLocaleTimeString()})\n${k.message}\n${k.stack}`).join('');
}

// Lo callado se dice una vez por minuto, también si ya ha dejado de fallar (una racha corta no se pierde)
let flushT = null;
function later() { flushT ??= setTimeout(flush, REPEAT_MS); }
function flush() {
  flushT = null;
  const now = Date.now();
  for (const k of kinds.values()) if (k.quiet) {
    const text = `${k.where} sigue fallando: ${k.quiet} ${k.quiet === 1 ? 'vez más' : 'veces más'} en ${secs(now - k.said)} (${k.message.slice(0, 200)})`;
    console.warn(text);
    tell(text);
    k.quiet = 0; k.said = now;
  }
  for (const [where, pl] of places) if (pl.quiet) { tell(`${where}: ${pl.quiet} ${pl.quiet === 1 ? 'fallo distinto más' : 'fallos distintos más'} en el último minuto (sin contar aquí uno a uno)`); pl.quiet = 0; }
}

function secs(ms) { const s = Math.round(ms / 1000); return s < 120 ? `${s} s` : `${Math.round(s / 60)} min`; }
// El archivo y la línea de src/ donde saltó (lo primero de la pila que sea del juego), para dar con él sin la consola
function placeOf(err) {
  const m = err?.stack && /\/src\/([\w/.-]+\.js):(\d+)/.exec(err.stack);
  return m ? ` (${m[1]}:${m[2]})` : '';
}
function tell(text) { try { sink?.(text); } catch { /* (si contarlo falla, no se cuenta: no hay que entrar en bucle) */ } }

// El punto rojo. Con un fallo por paso se llama 60 veces por segundo: el texto se rehace con cada fallo nuevo, y con
// los repetidos como mucho una vez por segundo (y al pasar el ratón, con la cuenta al día)
function show(now, fresh) {
  if (typeof document === 'undefined') return;
  if (!el) {
    el = document.getElementById('fault');
    el?.addEventListener('click', dismiss);
    el?.addEventListener('pointerenter', () => paint(Date.now()));
  }
  if (!el || dismissed) return;
  if (el.hidden) el.hidden = false;
  if (fresh || now - shownAt >= 1000) paint(now);
}
function paint(now) {
  const l = faults.last, more = faults.kinds - 1;
  if (!l || !el) return;
  shownAt = now;
  el.querySelector('span').textContent = `Algo ha fallado en ${faultLabel(l.where)}${l.n > 1 ? ` (${l.n} veces)` : ''}: ${l.message}${l.place}` +
    (more > 0 ? `\n(y ${more} ${more === 1 ? 'fallo distinto más' : 'fallos distintos más'}: en F3 y en lo que se copia)` : '') + '\nClic: copiar el error (para contarlo) y esconder el punto';
}
// Clic: se copia el informe y el punto se esconde hasta que falle algo distinto. Se dice si se ha copiado o no
function dismiss() {
  dismissed = true;
  el.hidden = true;
  const text = faultReport();
  const say = msg => import('./ui/hud.js').then(m => m.hud.toast(msg)).catch(() => {});
  // (sin permiso, el portapapeles puede no contestar nunca: a los 2 s se da por no copiado)
  Promise.race([navigator.clipboard?.writeText(text) ?? Promise.reject(), new Promise((_, no) => setTimeout(no, 2000))])
    .then(() => say('Error copiado: pégalo en un mensaje para contarlo'))
    .catch(() => { console.log(text); say('No se ha podido copiar el error: está en F3 y en la consola'); });
}

// Los errores sueltos de la página (fuera del bucle) también cuentan
if (typeof addEventListener === 'function') {
  addEventListener('error', e => reportFault(e.error || e.message, 'página', true));
  addEventListener('unhandledrejection', e => reportFault(e.reason, 'promesa', true));
}
