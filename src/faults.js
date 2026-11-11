// Errores a la vista. Un fallo en una parte del juego (el huerto, los animales, el tiempo…) no puede parar a las demás
// ni quedarse escondido en la consola: game.js aísla cada sistema y cuenta aquí lo que falla, y lo mismo los errores
// sueltos de la página (un clic, un mensaje de red, una promesa). Aquí se apunta: la primera vez entero, con su pila;
// si se repite, un resumen por minuto (un sistema que falla en cada paso se sigue intentando, pero no inunda la
// consola). Y se ve: un punto rojo discreto abajo a la derecha (al pasar el ratón, el último error; con un clic, se
// copia y se esconde hasta que falle otra cosa) y una línea en F3. En el mundo del servidor no hay pantalla: va a su
// terminal (server.js le dice dónde con setFaultSink).
const REPEAT_MS = 60000;   // (lo que se calla un error que se repite antes de volver a decir cuántas veces ha sido)
const MAX_KINDS = 100;     // (los distintos que se recuerdan: los mensajes con números cambian y no deben crecer sin fin)
const IGNORE = /^ResizeObserver loop|^Script error\.?$/;   // (avisos del navegador que no son fallos del juego)

const kinds = new Map();   // `dónde|mensaje` → { n: las veces, quiet: las calladas desde said, said, place }
let sink = null, el = null, shownAt = 0, dismissed = false;
// total: los fallos desde que se abrió; kinds: cuántos distintos; last: el último ({ where, message, n, at, place, stack })
export const faults = { total: 0, kinds: 0, last: null };

// Adónde más se cuenta (el terminal del servidor): una función que recibe el texto
export function setFaultSink(fn) { sink = fn; }

// Un fallo. where: qué parte (p. ej. 'Ranch.update'). logged: si ya ha salido en la consola (el navegador ya enseña
// los errores sueltos de la página)
export function reportFault(e, where = 'juego', logged = false) {
  const err = e instanceof Error ? e : null;
  const message = String((err ? err.message : e?.message ?? e) || 'error sin mensaje').slice(0, 300);
  if (IGNORE.test(message) || err?.name === 'AbortError') return;
  const id = `${where}|${message}`, now = Date.now();
  let k = kinds.get(id);
  faults.total++;
  if (!k) {
    if (kinds.size >= MAX_KINDS) kinds.delete(kinds.keys().next().value);
    kinds.set(id, (k = { n: 0, quiet: 0, said: now, place: placeOf(err) }));
    faults.kinds++;
    dismissed = false;   // (algo nuevo: el punto vuelve aunque se hubiera escondido)
    if (!logged) console.error(`[${where}]`, e);
    tell(`Fallo en ${where}: ${message.slice(0, 220)}${k.place}`);   // (el terminal corta en 300)
  } else if (now - k.said >= REPEAT_MS) {
    const text = `${where} sigue fallando: ${k.quiet + 1} veces en ${Math.round((now - k.said) / 1000)} s (${message.slice(0, 200)})`;
    console.warn(text);
    tell(text);
    k.quiet = 0; k.said = now;
  } else k.quiet++;
  k.n++;
  faults.last = { where, message, n: k.n, at: now, place: k.place, stack: err?.stack || '' };
  show(now, k.n === 1);
}

// El texto para copiar: versión, dónde, el mensaje y la pila
export function faultReport() {
  const l = faults.last;
  if (!l) return '';
  const version = document.querySelector('meta[name="miniverse-version"]')?.content || '?';
  return `Miniverse ${version} · ${new Date(l.at).toLocaleString()}\nFallo en ${l.where} (${l.n} ${l.n === 1 ? 'vez' : 'veces'}; ${faults.kinds} distintos, ${faults.total} en total)\n${l.message}\n${l.stack}`;
}

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
  if (!l) return;
  shownAt = now;
  el.querySelector('span').textContent = `Algo ha fallado en ${l.where}${l.n > 1 ? ` (${l.n} veces)` : ''}: ${l.message}${l.place}` +
    (more ? `\n(y ${more} ${more === 1 ? 'fallo distinto más' : 'fallos distintos más'}: ver F3)` : '') + '\nClic: copiar el error y esconder el punto';
}
// Clic: se copia el informe (o, si no se puede, a la consola) y el punto se esconde hasta que falle algo distinto
function dismiss() {
  dismissed = true;
  el.hidden = true;
  const text = faultReport();
  Promise.resolve(navigator.clipboard?.writeText(text)).catch(() => console.log(text));
}

// Los errores sueltos de la página (fuera del bucle) también cuentan
if (typeof addEventListener === 'function') {
  addEventListener('error', e => reportFault(e.error || e.message, 'página', true));
  addEventListener('unhandledrejection', e => reportFault(e.reason, 'promesa', true));
}
