// El mundo del servidor. multijugador.py abre este mismo juego en un Chrome invisible (?modo=servidor&pase=…) y,
// mientras el servidor está abierto, lleva el mundo compartido aunque no juegue nadie, como un servidor de
// Minecraft: hace pasar la hora y crecer los cultivos, mueve los animales, recibe los cambios de los demás (y no deja
// los que no tocan: ver live.js), se los reparte a todos y guarda el mundo, cifrado, en este navegador cada minuto y
// en GitHub cada pocos. No dibuja nada y su personaje no se ve: es un espectador quieto en el pueblo.
//
// Se da a conocer al servidor con su pase (que solo saben multijugador.py y este Chrome) y este le da la clave del
// mundo y el token con que guardarlo. Lo que pasa (quién entra, el chat, si algo falla) sale en el terminal del
// servidor. Si alguien ya llevaba el mundo cuando llega, se lo pide y pasa a llevarlo él.
import { Game } from './game.js';
import { Profile } from './accounts.js';
import { DATA_REPO, canWrite } from './github.js';
import { Settings } from './settings.js';
import { hud } from './ui/hud.js';
import { DEFAULT_LOOK } from './looks.js';
import { SPAWN } from './world/village.js';

const SAVE_EVERY = 60000;   // cada cuánto se guarda el mundo (en este navegador; en GitHub, como mucho cada 3 minutos)
const HOST_WAIT = 3000;     // al llegar, lo que se espera a saber si alguien ya llevaba el mundo
const RETRY = 5000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function runServer() {
  const q = new URLSearchParams(location.search), url = q.get('servidor');
  Settings.load();
  const game = window.pueblo = new Game(document.getElementById('c'), { headless: true });
  const live = game.live;
  const log = text => { console.log(text); live.net?.sendServer({ t: 'log', text: String(text) }); };
  live.say = log;   // (el chat y lo que cuenta el juego, al terminal del servidor)
  hud.toast = log;
  game.onError = e => log(`Fallo: ${e.message}`);
  document.title = 'Miniverse · mundo del servidor';

  // Las claves: las da el servidor al ver el pase
  Profile.serverStart(q.get('pase'));
  let tunnel = null;
  live.onKeys = m => { tunnel = m.tunnel || null; Profile.serverKeys(m).then(key => { if (key && live.net) { live.net.key = key; live.up(); } }); };
  await live.connect(url);
  while (live.status !== 'on') await sleep(250);
  log('Con las claves del mundo: abriendo el mundo…');
  // (si el admin no ha entrado todavía, los demás encuentran el servidor por la dirección que se publica aquí)
  if (tunnel) Profile.announce(tunnel).catch(e => log(`No se ha podido publicar la dirección del servidor: ${e.message}`));

  // El mundo: el de quien ya lo llevaba (se lo pide) o el más reciente de lo guardado (aquí y en GitHub)
  let world = null;
  if ((await live.waitHost(HOST_WAIT)) && !live.host.server) {
    try { world = await live.requestWorld(); log(`Mundo recibido de ${live.host.name}: ahora lo lleva el servidor.`); }
    catch (e) { log(`${live.host.name} no ha dado el mundo (${e.message}): se abre el guardado.`); }
  }
  if (!world) world = await stored(log);
  if (!world) return;
  game.start({ ...(world.shared || {}), player: { name: 'Servidor', look: { ...DEFAULT_LOOK }, x: SPAWN.x, y: SPAWN.y, inside: false, view: 'back' }, gamemode: 'spectator' }, new Map(world.deltas || []));
  live.join(null, 'host');
  game.runHeadless();
  log(`El mundo está en marcha (${(world.deltas || []).length} trozos con cambios).`);

  // Guardar: cada minuto y cuando lo pide el servidor (/save-all, /stop); y una copia para él cada vez que se sube
  const save = upload => Profile.storeWorld(live.worldOf(game.snapshot(), game.world.deltas), { upload });
  Profile.onWorldBytes = bytes => live.backup(bytes);
  game.onSave = () => {};   // (lo que guardaría la partida de un jugador: aquí el mundo se guarda cada minuto)
  setInterval(() => save(false), SAVE_EVERY);
  const said = r => log(r ? 'Mundo guardado (también en GitHub).' : `Mundo guardado en este ordenador${r === false ? `, pero no en GitHub: ${Profile.lastError}` : ''}.`);
  live.onServerSave = () => save(true).then(said);
  // Si se corta o se cierra el servidor: se guarda y, si no es que se cierra, se vuelve a empezar al rato
  live.onHostLeft = async why => {
    said(await save(true));
    live.net?.sendServer({ t: 'saved' });
    if (why !== 'stop') { log('Se ha cortado la conexión: vuelvo a empezar en unos segundos.'); setTimeout(() => location.reload(), RETRY); }
  };
}

// El mundo más reciente de lo guardado: la copia de este navegador o el de GitHub. Sin ninguno, uno nuevo. Si el de
// GitHub no se puede abrir con esta clave, no se empieza otro encima: se avisa
async function stored(log) {
  const local = await Profile.localWorld();
  let warned = false;
  for (;;) {
    try {
      // (con un token que no llega al repositorio, GitHub diría que no hay mundo: antes, se comprueba)
      if (!Profile.server.token || !(await canWrite(Profile.server.token, DATA_REPO))) {
        if (!warned) log(`El token no puede guardar en ${DATA_REPO} (o GitHub no responde bien): lo intento cada poco. Si no se arregla, escribe /vincular en el terminal y entra con la cuenta del admin.`);
        warned = true;
        await sleep(RETRY * 3);
        continue;
      }
      const remote = await Profile.loadWorld();
      const w = [local, remote].filter(Boolean).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))[0];
      if (!w) log('Todavía no hay mundo guardado: empieza uno nuevo.');
      return w || { deltas: [], shared: {} };
    } catch (e) {
      if (e.wrongKey) { log(`${e.message} Escribe /vincular en el terminal y entra con la cuenta del admin.`); return null; }
      if (local) { log(`GitHub no responde (${e.message}): se abre la copia de este ordenador.`); return local; }
      log(`GitHub no responde (${e.message}): lo intento otra vez en unos segundos.`);
      await sleep(RETRY);
    }
  }
}
