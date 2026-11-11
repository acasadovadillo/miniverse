// El mundo del servidor. multijugador.py abre este mismo juego en un Chrome invisible (?modo=servidor&pase=…) y,
// mientras el servidor está abierto, lleva el mundo compartido aunque no juegue nadie, como un servidor de
// Minecraft: hace pasar la hora y crecer los cultivos, mueve los animales, recibe los cambios de los demás (y no deja
// los que no tocan: ver live.js), se los reparte a todos y guarda el mundo, cifrado, en este navegador cada minuto y
// en GitHub cada pocos. No dibuja nada y su personaje no se ve: es un espectador quieto en el pueblo.
//
// Se da a conocer al servidor con su pase (que solo saben multijugador.py y este Chrome) y este le da la clave del
// mundo y el token con que guardarlo. Lo que pasa (quién entra, el chat, si algo falla) sale en el terminal del
// servidor. Si alguien ya llevaba el mundo cuando llega, se lo pide y pasa a llevarlo él.
//
// Las copias: cada vez que guarda, le pasa al servidor el mundo cifrado y este se queda una cada 15 minutos en backups/
// (con retención por horas y por días) y las fijas con nombre que se le piden (/backup, y solas antes de /update y de
// /restore). Con /restore <copia> en el terminal abre una: ver restore.
import { Game } from './game.js';
import { Profile } from './accounts.js';
import { DATA_REPO, canWrite } from './github.js';
import { Settings } from './settings.js';
import { hud } from './ui/hud.js';
import { DEFAULT_LOOK } from './looks.js';
import { SPAWN } from './world/village.js';
import { runCommand } from './commands.js';
import { setFaultSink } from './faults.js';
import { unknownShared } from './livesync.js';
import { fromB64 } from './vault.js';

const SAVE_EVERY = 60000;   // cada cuánto se guarda el mundo (en este navegador; en GitHub, como mucho cada 3 minutos)
const HOST_WAIT = 3000;     // al llegar, lo que se espera a saber si alguien ya llevaba el mundo
const RETRY = 5000;
const SYNC_LOG_EVERY = 10;  // (subir a GitHub falla: se dice en el terminal al segundo fallo seguido y luego cada tantos)
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function runServer() {
  const q = new URLSearchParams(location.search), url = q.get('servidor');
  Settings.load();
  const game = window.pueblo = new Game(document.getElementById('c'), { headless: true });
  const live = game.live;
  const log = text => { console.log(text); live.net?.sendServer({ t: 'log', text: String(text) }); };
  live.say = log;   // (el chat y lo que cuenta el juego, al terminal del servidor)
  hud.toast = log;
  setFaultSink(log);   // (un fallo de cualquier parte del mundo sale en el terminal; si se repite, una vez por minuto: ver faults.js)
  document.title = 'Miniverse · mundo del servidor';

  // Las claves: las da el servidor al ver el pase
  Profile.serverStart(q.get('pase'));
  let tunnel = null;
  live.onKeys = m => { tunnel = m.tunnel || null; Profile.serverKeys(m).then(key => { if (key && live.net) { live.net.key = key; live.up(); } }); };
  await live.connect(url);
  while (live.status !== 'on') await sleep(250);
  log('Con las claves del mundo: abriendo el mundo…');
  // (las subidas a GitHub que fallan, en el terminal: el token caducado o sin conexión no pasan en silencio)
  // (onSync llega también con el primer fallo, que aún no se avisa: «vuelve a guardarse» solo si antes se dijo que no)
  let syncWarned = false;
  Profile.onSync = st => {
    if (!st) { if (syncWarned) log('Vuelve a guardarse en GitHub.'); syncWarned = false; return; }
    syncWarned = true;
    if (st.fails === 2 || st.fails % SYNC_LOG_EVERY === 0) log(`✗ ${st.what === 'world' ? 'El mundo' : 'Lo guardado'} no se sube a GitHub desde las ${new Date(st.since).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} (${st.fails} fallos seguidos): ${st.message}${st.kind === 'expired' ? ' Cambia el token en tu juego (Ajustes › Guardado en GitHub) y escribe /link.' : ''} Mientras, se guarda en este ordenador y en backups/.`);
  };
  // /restore: desde ya, aunque el mundo no llegue a abrirse (si el de GitHub no se abre, es justo lo que hace falta)
  let running = false, restoring = false;
  live.onServerRestore = m => restore(m, { game, live, log, running: () => running, stop: () => { restoring = true; } });
  // (si el admin no ha entrado todavía, los demás encuentran el servidor por la dirección que se publica aquí)
  if (tunnel) Profile.announce(tunnel).catch(e => log(`No se ha podido publicar la dirección del servidor: ${e.message}`));

  // El mundo: el de quien ya lo llevaba (se lo pide) o el más reciente de lo guardado (aquí y en GitHub)
  let world = null;
  if ((await live.waitHost(HOST_WAIT)) && !live.host.server) {
    try { world = await live.requestWorld(); log(`Mundo recibido de ${live.host.name}: ahora lo lleva el servidor.`); }
    catch (e) { log(`${live.host.name} no ha dado el mundo (${e.message}): se abre el guardado.`); }
  }
  if (!world) world = await stored(log, live);
  if (!world || restoring) return;
  live.extraShared = unknownShared(world.shared);   // (lo de una versión más nueva: se vuelve a guardar tal cual)
  game.start({ ...(world.shared || {}), player: { name: 'Servidor', look: { ...DEFAULT_LOOK }, x: SPAWN.x, y: SPAWN.y, inside: false, view: 'back' }, gamemode: 'spectator' }, new Map(world.deltas || []));
  live.join(null, 'host');
  game.runHeadless();
  running = true;
  log(`El mundo está en marcha (${(world.deltas || []).length} trozos con cambios).`);
  // (al servidor: ya lleva el mundo. Hasta ahora no echa a los juegos con una versión más vieja, para que quien lo llevaba
  // se lo haya podido dar: ver reference_version en multijugador.py. Un servidor de antes no lo conoce y no hace nada)
  live.net?.sendServer({ t: 'ready' });

  // Guardar: cada minuto y cuando lo pide el servidor (/save-all, /stop); y una copia para él cada vez que se sube
  // (restaurando una copia, ya no: lo de ahora quedaría encima de la restaurada)
  const save = upload => (restoring ? Promise.resolve(null) : Profile.storeWorld(live.worldOf(game.snapshot(), game.world.deltas), { upload }));
  Profile.onWorldBytes = bytes => { if (!restoring) live.backup(bytes); };
  // Una copia fija con nombre del mundo de ahora (/backup <nombre> en el terminal, y antes de /update)
  const keep = async name => { const bytes = !restoring && await Profile.worldBytes(live.worldOf(game.snapshot(), game.world.deltas)); if (bytes) live.backup(bytes, name); };
  live.onServerKeep = m => keep(String(m.name || 'copia')).catch(e => log(`✗ No se ha podido hacer la copia: ${e.message}`));
  game.onSave = () => {};   // (lo que guardaría la partida de un jugador: aquí el mundo se guarda cada minuto)
  setInterval(() => { if (game.worldSaving !== false) save(false); }, SAVE_EVERY);   // (/save-off en el terminal lo para)
  // Lo del terminal: un comando (lo ejecuta este mundo, que es op) o cómo va (/tps)
  live.onServerCmd = m => {
    if (m.t === 'tps') { const t = game.tps || {}; log(`Pasos por segundo: ${t.steps ?? '?'} de 60 (cada paso, ${(t.ms || 0).toFixed(2)} ms) · ${game.mobs.list.length} criaturas · ${live.others.filter(p => p.playing).length} jugando`); return; }
    if (typeof m.text === 'string' && m.text.startsWith('/')) Promise.resolve(runCommand(game, m.text, (text, kind) => log(kind === 'err' ? `✗ ${text}` : text))).catch(e => log(`Fallo: ${e.message}`));
  };
  const said = r => log(r ? 'Mundo guardado (también en GitHub).' : `Mundo guardado en este ordenador${r === false ? `, pero no en GitHub: ${Profile.lastError}` : ''}.`);
  live.onServerSave = () => save(true).then(said);
  // /update en el terminal: se guarda y se avisa; el servidor cierra este Chrome y lo abre con lo publicado de ahora
  // (keep: antes, una copia fija del mundo de ahora, «antes-de-<versión>», por si la versión nueva lo estropeara)
  // (volviendo a una copia, no: no hay nada que guardar y, si dijera «saved», el servidor lo cerraría a mitad de restaurar)
  live.onServerRestart = async m => { if (restoring) return; if (typeof m?.keep === 'string') await keep(m.keep).catch(() => {}); said(await save(true)); live.net?.sendServer({ t: 'saved' }); };
  // Si se corta o se cierra el servidor: se guarda y, si no es que se cierra, se vuelve a empezar al rato
  live.onHostLeft = async why => {
    said(await save(true));
    live.net?.sendServer({ t: 'saved' });
    if (why !== 'stop') { log('Se ha cortado la conexión: vuelvo a empezar en unos segundos.'); setTimeout(() => location.reload(), RETRY); }
  };
}

// El mundo más reciente de lo guardado: la copia de este navegador o el de GitHub. Sin ninguno, uno nuevo. Si el de
// GitHub no se puede abrir con esta clave, no se empieza otro encima: se avisa (y, si la copia de este navegador sí se
// abre, se le pasa al servidor como copia fija, para poder volver a ella con /restore). Recién vuelto a una copia con
// /restore, la de este navegador es la buena aunque GitHub no deje guardar o su mundo.enc no se abra
async function stored(log, live) {
  const local = await Profile.localWorld();
  const restored = local?.restored ? local : null;   // (se quita con el primer guardado normal: ver worldOf en live.js)
  const useRestored = why => { log(`${why}: se abre la copia restaurada (${restored.restored.from}) de este ordenador; se subirá a GitHub en cuanto se pueda.`); return restored; };
  let warned = false;
  for (;;) {
    try {
      // (con un token que no llega al repositorio, GitHub diría que no hay mundo: antes, se comprueba)
      if (!Profile.server.token || !(await canWrite(Profile.server.token, DATA_REPO))) {
        if (restored) return useRestored(`El token no puede guardar en ${DATA_REPO} (o GitHub no responde bien)`);
        if (!warned) log(`El token no puede guardar en ${DATA_REPO} (o GitHub no responde bien): lo intento cada poco. Si no se arregla, escribe /link en el terminal y entra con la cuenta del admin.`);
        warned = true;
        await sleep(RETRY * 3);
        continue;
      }
      const remote = await Profile.loadWorld();
      const w = [local, remote].filter(Boolean).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))[0];
      if (!w) log('Todavía no hay mundo guardado: empieza uno nuevo.');
      return w || { deltas: [], shared: {} };
    } catch (e) {
      if (e.wrongKey && restored) return useRestored(e.message.replace(/\.$/, ''));
      if (e.wrongKey) {
        const bytes = local && await Profile.serverCopyBytes();
        if (bytes) live.backup(bytes, 'copia-del-servidor');
        log(`${e.message}${bytes ? ` La copia de este ordenador sí se abre (guardada el ${dateOf(local.savedAt)}): queda en backups/fijas/ como copia-del-servidor; para seguir con ella, /restore copia-del-servidor ya.` : ''} Si el problema es la llave del servidor, escribe /link en el terminal y entra con la cuenta del admin.`);
        return null;
      }
      if (local) { log(`GitHub no responde (${e.message}): se abre la copia de este ordenador.`); return local; }
      log(`GitHub no responde (${e.message}): lo intento otra vez en unos segundos.`);
      await sleep(RETRY);
    }
  }
}

// /restore <copia> en el terminal del servidor: el servidor manda la copia (cifrada, como la guardó: él no puede abrirla) y
// este mundo la hace la buena. Ya ha echado al menú a los que jugaban (y no deja entrar hasta que esto acabe): así nadie
// lleva el mundo de antes mientras tanto ni se lo vuelve a dar al mundo del servidor al volver. Si la copia no se abre,
// no se toca nada. Si se abre: deja de guardar, manda una copia fija del mundo de ahora («antes-de-restaurar», para poder
// deshacerlo), guarda la copia como el mundo de ahora (con la fecha de ahora: así gana a todas las demás, la de este
// navegador, mundo.enc en GitHub y la de la partida del admin) y vuelve a empezar, ya con ella
const dateOf = t => (t ? new Date(t).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '?');
async function restore(m, { game, live, log, running, stop }) {
  const answer = (ok, text) => { log(text); live.net?.sendServer({ t: 'restored', ok }); };
  const name = String(m.name || 'copia');
  let w;
  try { w = await Profile.openWorldCopy(fromB64(String(m.d || ''))); }
  catch (e) { answer(false, `✗ No se puede restaurar ${name}: ${e.message}. El mundo sigue como estaba.`); return; }
  stop();
  // (lo de ahora, para poder deshacerlo: el mundo en marcha o, si no ha llegado a abrirse, la copia de este navegador, que
  // puede ser más nueva que cualquiera de backups/ y se va a sustituir)
  const bytes = running() ? await Profile.worldBytes(live.worldOf(game.snapshot(), game.world.deltas)).catch(() => null) : await Profile.serverCopyBytes();
  if (bytes) live.backup(bytes, 'antes-de-restaurar');
  const { format, savedAt, by, restored, ...world } = w;
  const up = await Profile.storeWorld({ ...world, restored: { from: name, savedAt: savedAt || 0 } }, { upload: true });
  answer(true, `Copia ${name} (del ${dateOf(savedAt)}) guardada como el mundo de ahora`
    + (up ? ' (aquí y en GitHub)' : ` en este ordenador${up === false ? `; en GitHub no se ha podido (${Profile.lastError}): se sube en cuanto se pueda` : ''}`) + '. Vuelvo a abrir el mundo con ella…');
  setTimeout(() => location.reload(), 1500);
}
